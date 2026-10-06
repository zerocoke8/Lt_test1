// 기획 13차 효과음: one AudioContext, buses (UI · 효과 · 주인공 · 배경, + 멀리), ducking, limiter, voice management
// (docs/sfx.md 2-1 engine.ts, 4장). Every sound is scheduled at ctx.currentTime + delay (no setTimeout).
//
//   src → [pan] → voice gain → ui  → uiVol ──────────────────────────┐
//                             sfx → low-pass → duck → sfxVol ────────┤
//                             far (−8 dB, 3.5 kHz) ─┘                ├→ mute → master → limiter → out
//                             hero → heroVol (효과음 slider) ────────┤
//                             bg  → duck → bgVol ────────────────────┘

import { dbToGain, familyDefault, GROUP_CAP, sfxRow, type Bus, type SfxRow } from './ids';
import { Baker } from './bake';
import { FILE_TABLE, resolveSource, type FileSource } from './manifest';
import { hasRecipe } from './synth/recipes';
import { SR } from './synth/prims';
import { CHAR_VOICE } from './synth/voices';
import { AUDIO_DEFAULTS, type AudioSettings } from './settings';

export interface PlayOpts {
  delay?: number;
  db?: number;
  pan?: number;
  far?: boolean;
  rate?: number;
  loopFor?: number;
  key?: string;
  skill?: string;
}

interface Voice {
  id: string;
  row: SfxRow;
  t0: number;
  t1: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  key?: string;
  far: boolean;
}

export interface Duck {
  at: number;
  attack: number;
  hold: number;
  release: number;
  db: number;
}

/** Effect-bus ducking never goes below this (4-4). */
export const DUCK_FLOOR_DB = -14;
/** Other players' drag / ult (4-3). */
export const FAR_DB = -8;
export const FAR_LOWPASS = 3500;

/** dB of one duck at time t (0 outside it). */
function duckShape(d: Duck, t: number): number {
  if (t <= d.at) return 0;
  const x = t - d.at;
  if (x < d.attack) return (d.db * x) / Math.max(1e-3, d.attack);
  if (x < d.attack + d.hold) return d.db;
  const r = x - d.attack - d.hold;
  return r < d.release ? d.db * (1 - r / Math.max(1e-3, d.release)) : 0;
}

/** Overlapping ducks: the lowest one wins (not summed), clamped at `floor` (4-4). */
export function duckDb(ducks: readonly Duck[], t: number, floor = -Infinity): number {
  let v = 0;
  for (const d of ducks) v = Math.min(v, duckShape(d, t));
  return Math.max(floor, v);
}

const duckEnd = (d: Duck): number => d.at + d.attack + d.hold + d.release;

export interface EngineDeps {
  random?: () => number;
  /** Voice cap (24; phones with ≤ 4 cores 16). */
  maxVoices?: number;
  files?: Map<string, FileSource>;
  /** Decode / fetch a file (tests stub it). */
  loadFile?: (ctx: AudioContext, url: string) => Promise<AudioBuffer>;
  /** Bake any missing sound on demand, even low-priority ones (tests, debug board). Default: queue them. */
  bakeInFrame?: boolean;
}

export function defaultMaxVoices(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 8;
  return cores <= 4 ? 16 : 24;
}

const roleOf = (charId: string): string | null => CHAR_VOICE[charId]?.role ?? null;

export class AudioEngine {
  readonly baker = new Baker();
  ctx: AudioContext | null = null;
  settings: AudioSettings = { ...AUDIO_DEFAULTS };
  /** ?mute=1: silent even when the setting says on. */
  forced = false;
  /** Solo pause / portrait: only the UI bus plays. */
  halted = false;
  private readonly random: () => number;
  readonly maxVoices: number;
  private readonly files: Map<string, FileSource>;
  private readonly loadFile: (ctx: AudioContext, url: string) => Promise<AudioBuffer>;
  bakeInFrame: boolean;
  private voices: Voice[] = [];
  private readonly last = new Map<string, number>();
  private readonly bufs = new Map<string, AudioBuffer>();
  private readonly fileBufs = new Map<string, AudioBuffer[]>();
  private readonly fileFailed = new Set<string>();
  private readonly ducks: Record<'sfx' | 'bg', Duck[]> = { sfx: [], bg: [] };
  private readonly warned = new Set<string>();
  private nodes: {
    master: GainNode;
    mute: GainNode;
    inputs: Record<Bus | 'far', AudioNode>;
    vols: Record<'ui' | 'sfx' | 'hero' | 'bg', GainNode>;
    duck: Record<'sfx' | 'bg', GainNode>;
    lp: BiquadFilterNode;
  } | null = null;

  constructor(deps: EngineDeps = {}) {
    this.random = deps.random ?? Math.random;
    this.maxVoices = deps.maxVoices ?? defaultMaxVoices();
    this.files = deps.files ?? FILE_TABLE;
    this.loadFile = deps.loadFile ?? defaultLoadFile;
    this.bakeInFrame = deps.bakeInFrame ?? false;
  }

  /** Build the bus graph on a (just unlocked) context and start loading override files. */
  init(ctx: AudioContext): void {
    this.ctx = ctx;
    const g = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    const master = g();
    master.connect(limiter);
    const mute = g();
    mute.connect(master);
    const vols = { ui: g(), sfx: g(), hero: g(), bg: g() };
    for (const v of Object.values(vols)) v.connect(mute);
    const duck = { sfx: g(), bg: g() };
    duck.sfx.connect(vols.sfx);
    duck.bg.connect(vols.bg);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    lp.connect(duck.sfx);
    const far = g(dbToGain(FAR_DB));
    const farLp = ctx.createBiquadFilter();
    farLp.type = 'lowpass';
    farLp.frequency.value = FAR_LOWPASS;
    far.connect(farLp);
    farLp.connect(lp);
    this.nodes = { master, mute, inputs: { ui: vols.ui, sfx: lp, hero: vols.hero, bg: duck.bg, far }, vols, duck, lp };
    this.apply(this.settings);
    for (const [id, f] of this.files) void this.loadFiles(id, f);
  }

  /** Volumes + mute (mute ramps to 0 in 0.05 s and keeps running: un-muting is instant). */
  apply(s: AudioSettings): void {
    this.settings = { ...s };
    const n = this.nodes;
    const ctx = this.ctx;
    if (!n || !ctx) return;
    const t = ctx.currentTime;
    n.master.gain.setTargetAtTime(s.master, t, 0.02);
    n.vols.sfx.gain.setTargetAtTime(s.sfx, t, 0.02);
    n.vols.hero.gain.setTargetAtTime(s.sfx, t, 0.02);
    n.vols.ui.gain.setTargetAtTime(s.ui * s.sfx, t, 0.02);
    n.vols.bg.gain.setTargetAtTime(s.bg, t, 0.02);
    n.mute.gain.setTargetAtTime(s.muted || this.forced ? 0 : 1, t, 0.05 / 3);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Voices playing or scheduled. */
  get active(): number {
    this.prune();
    return this.voices.length;
  }

  activeIds(): string[] {
    this.prune();
    return this.voices.map(v => v.id);
  }

  // ─────────────────────────── play ───────────────────────────

  /** Schedule one sound. Returns false when it was rate-limited, capped, unknown or not baked yet. */
  play(id: string, o: PlayOpts = {}): boolean {
    const ctx = this.ctx;
    const n = this.nodes;
    if (!ctx || !n) return false;
    const row = sfxRow(id);
    if (this.halted && row.bus !== 'ui') return false;
    const t0 = ctx.currentTime + Math.max(0, o.delay ?? 0);
    const prev = this.last.get(id);
    if (prev != null && Math.abs(t0 - prev) < row.gap / 1000) return false;
    const buf = this.buffer(id, row, o.skill);
    if (!buf) return false;
    this.prune();
    if (!this.makeRoom(row, o.far)) return false;
    this.last.set(id, t0);
    this.start(id, row, buf, t0, o);
    return true;
  }

  private start(id: string, row: SfxRow, b: { buf: AudioBuffer; gain: number; rate: number }, t0: number, o: PlayOpts): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = b.buf;
    src.loop = o.loopFor != null;
    src.playbackRate.value = (o.rate ?? 1) * b.rate * (row.variants > 1 ? 1 + (this.random() * 2 - 1) * 0.04 : 1);
    const vary = row.variants > 1 ? (this.random() * 2 - 1) * 1.5 : 0;
    const gain = ctx.createGain();
    const level = dbToGain(row.db + (o.db ?? 0) + vary) * b.gain;
    gain.gain.setValueAtTime(level, t0);
    let tail: AudioNode = src;
    if (o.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      src.connect(p);
      tail = p;
    }
    tail.connect(gain);
    gain.connect(this.nodes!.inputs[o.far ? 'far' : row.bus]);
    let t1 = t0 + b.buf.duration / Math.max(0.1, src.playbackRate.value);
    // start before any stop (stop() on an unstarted source throws)
    src.start(t0);
    if (o.loopFor != null) {
      t1 = t0 + o.loopFor;
      if (Number.isFinite(o.loopFor)) {
        const fade = Math.min(0.3, o.loopFor / 3);
        gain.gain.setValueAtTime(level, Math.max(t0, t1 - fade));
        gain.gain.linearRampToValueAtTime(0, t1);
        src.stop(t1 + 0.02);
      }
    }
    const v: Voice = { id, row, t0, t1, src, gain, key: o.key, far: !!o.far };
    src.onended = () => {
      this.voices = this.voices.filter(x => x !== v);
    };
    this.voices.push(v);
  }

  /** 4-2: total cap and group caps; evict the oldest of equal-or-lower priority, else refuse. */
  private makeRoom(row: SfxRow, far?: boolean): boolean {
    const cap = GROUP_CAP[row.group];
    if (cap != null && !this.evictIf(v => v.row.group === row.group, cap, row.prio)) return false;
    // other players' ults: one at a time (4-3)
    if (far && row.group === 'hero' && !this.evictIf(v => v.far && v.row.group === 'hero', 1, row.prio)) return false;
    return this.evictIf(() => true, this.maxVoices, row.prio);
  }

  private evictIf(match: (v: Voice) => boolean, cap: number, prio: number): boolean {
    const list = this.voices.filter(match);
    if (list.length < cap) return true;
    const victim = list.filter(v => v.row.prio <= prio).sort((a, b) => a.t0 - b.t0)[0];
    if (!victim) return false;
    this.kill(victim, 0.015);
    return true;
  }

  private kill(v: Voice, fade: number): void {
    const t = this.now;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, fade / 3);
      v.src.stop(t + fade);
    } catch {
      /* already stopped */
    }
    this.voices = this.voices.filter(x => x !== v);
  }

  private prune(): void {
    const t = this.now;
    this.voices = this.voices.filter(v => v.t1 > t);
  }

  /** Stop voices whose key starts with `prefix` (scheduled ones too). */
  stop(prefix: string, fade = 0.1): void {
    for (const v of [...this.voices]) if (v.key?.startsWith(prefix)) this.kill(v, fade);
  }

  /** Stop everything except the UI bus (solo pause, run end). */
  stopAll(fade = 0.05): void {
    for (const v of [...this.voices]) if (v.row.bus !== 'ui') this.kill(v, fade);
    this.ducks.sfx = this.ducks.sfx.filter(d => !Number.isFinite(duckEnd(d)));
    this.ducks.bg = [];
    this.scheduleDuck('sfx');
    this.scheduleDuck('bg');
    this.lowpass(null, 0, 0.05);
  }

  // ─────────────────────────── buffers ───────────────────────────

  private buffer(id: string, row: SfxRow, skill?: string): { buf: AudioBuffer; gain: number; rate: number } | null {
    const src = resolveSource(id, { files: this.fileBufs, hasRecipe, family: x => familyDefault(x, roleOf) }, skill);
    if (!src) {
      if (!this.warned.has(id)) {
        this.warned.add(id);
        console.debug(`[sfx] no sound for ${id}`);
      }
      return null;
    }
    if (src.kind === 'file') {
      const list = this.fileBufs.get(src.id)!;
      const f = this.files.get(src.id);
      const [lo, hi] = f?.rate ?? [1, 1];
      return { buf: list[Math.floor(this.random() * list.length)], gain: f?.gain ?? 1, rate: lo + (hi - lo) * this.random() };
    }
    const v = row.variants > 1 ? Math.floor(this.random() * row.variants) % row.variants : 0;
    const key = `${src.id}#${v}`;
    let buf = this.bufs.get(key);
    if (!buf) {
      // never bake low-priority sounds inside a frame: queue it, skip this one
      if (!this.baker.has(src.id, v) && row.prio < 3 && !this.bakeInFrame) {
        this.baker.enqueue([src.id], row.variants);
        return null;
      }
      const samples = this.baker.now(src.id, v);
      if (!samples) return null;
      buf = this.ctx!.createBuffer(1, samples.length, SR);
      buf.getChannelData(0).set(samples);
      this.bufs.set(key, buf);
    }
    return { buf, gain: 1, rate: 1 };
  }

  private async loadFiles(id: string, f: FileSource): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const list = await Promise.all(f.urls.map(u => this.loadFile(ctx, u)));
      this.fileBufs.set(id, list);
    } catch {
      if (!this.fileFailed.has(id)) console.warn(`[sfx] file for ${id} could not be read — using the synth sound`);
      this.fileFailed.add(id);
    }
  }

  /** Ids currently playing from a file (debug board). */
  isFile(id: string): boolean {
    return this.fileBufs.has(id);
  }

  /** Debug 다시 굽기: drop baked synth buffers. */
  rebake(): void {
    this.bufs.clear();
    this.baker.clear();
  }

  // ─────────────────────────── ducking / low-pass ───────────────────────────

  duck(target: 'sfx' | 'bg', db: number, at = 0, hold = 0.6, attack = 0.04, release = 0.4): void {
    const t = this.now;
    this.ducks[target] = this.ducks[target].filter(d => duckEnd(d) > t);
    this.ducks[target].push({ at: t + at, attack, hold, release, db });
    this.scheduleDuck(target);
  }

  /** Current duck of a bus (dB, tests / debug). */
  duckNow(target: 'sfx' | 'bg', dt = 0): number {
    return duckDb(this.ducks[target], this.now + dt, target === 'sfx' ? DUCK_FLOOR_DB : -Infinity);
  }

  private scheduleDuck(target: 'sfx' | 'bg'): void {
    const n = this.nodes;
    if (!n) return;
    const p = n.duck[target].gain;
    const t = this.now;
    const floor = target === 'sfx' ? DUCK_FLOOR_DB : -80;
    const ds = this.ducks[target];
    const times = new Set<number>();
    for (const d of ds) for (const x of [d.at, d.at + d.attack, d.at + d.attack + d.hold, duckEnd(d)]) if (x > t && Number.isFinite(x)) times.add(x);
    p.cancelScheduledValues(t);
    p.setValueAtTime(dbToGain(duckDb(ds, t, floor)), t);
    for (const x of [...times].sort((a, b) => a - b)) p.linearRampToValueAtTime(dbToGain(duckDb(ds, x, floor)), x);
  }

  /** Effect-bus low-pass (크로노 시간 정지): freq null = open. */
  lowpass(freq: number | null, at = 0, ramp = 0.25): void {
    const n = this.nodes;
    if (!n) return;
    n.lp.frequency.setTargetAtTime(freq ?? 20000, this.now + at, Math.max(0.01, ramp / 3));
  }
}

async function defaultLoadFile(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  return ctx.decodeAudioData(await res.arrayBuffer());
}
