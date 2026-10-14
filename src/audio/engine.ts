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
import { FILE_TABLE, resolveSource, type FileSource, type Source } from './manifest';
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
  skill?: string;
  far: boolean;
}

export interface Duck {
  at: number;
  attack: number;
  hold: number;
  release: number;
  db: number;
  /** A held duck that is released by name (unduck), e.g. 'out' while I spectate. */
  key?: string;
}

/** A sound asked for before it was baked: played as soon as it is (기획 13차 리뷰 — no bake inside a frame). */
interface LatePlay {
  id: string;
  o: PlayOpts;
  /** Context time it was asked for, and the last moment it may still start. */
  asked: number;
  until: number;
}

/** How late a sound may start after it was asked for (priority ≥ 3: the player's own beats; lower: incidental). */
export const LATE_MAX_HIGH = 0.25;
export const LATE_MAX_LOW = 0.6;
/** 기획 13차 리뷰 (4-3): other players' drags may overlap up to this many voices (their ults: one cast at a time). */
export const FAR_DRAG_CAP = 3;

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
  /**
   * Decode every file at init. Default: yes for a table passed in (tests, small sets); no for the bundled table
   * (기획 21차: 456 files ≈ 700 s — decoded all at once that is 100+ MB on a phone), whose files decode when a scene
   * prepares them (prepare) or on their first request (played late, like a synth bake). UI files always decode at init.
   */
  preloadFiles?: boolean;
}

/** A playable buffer: gain on top of the row's dB, playback rate, and (files) the part of the buffer that plays. */
interface Playable {
  buf: AudioBuffer;
  gain: number;
  rate: number;
  start: number;
  end?: number;
  /** Seconds a file starts later than asked (its hit would land before a stage cue's lead otherwise; levels.json). */
  delay?: number;
  /** Fade the first few ms in (a file whose start was moved into its build-up to meet a cue's lead). */
  fadeIn?: boolean;
}

/**
 * 기획 21차 리뷰: file decodes running at once. A scene's prepare queues its files in priority order (own cards first)
 * and they decode a few at a time, so the start of floor 1 is not 200 fetch + decodeAudioData calls in one go; a
 * sound asked for now jumps the queue.
 */
const FILE_JOBS = 3;

/** Fade at a file's cut head when it starts inside the sound (removes the click). */
const HEAD_FADE = 0.006;

/** Fade at a file's cut tail (its last sample is already −40 dB under the peak; this removes the click). */
const TAIL_FADE = 0.012;

export function defaultMaxVoices(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 8;
  return cores <= 4 ? 16 : 24;
}

const roleOf = (charId: string): string | null => CHAR_VOICE[charId]?.role ?? null;

/** Which ult cast a far voice belongs to: its skill id, else `ult.<char>` from the sound id. */
const castOf = (id: string, skill?: string): string => skill ?? id.split('.').slice(0, 2).join('.');

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
  private late: LatePlay[] = [];
  private readonly last = new Map<string, number>();
  private readonly bufs = new Map<string, AudioBuffer>();
  private readonly fileBufs = new Map<string, AudioBuffer[]>();
  private readonly fileFailed = new Set<string>();
  private readonly fileLoading = new Set<string>();
  /** Files waiting for a decode slot (FILE_JOBS), most urgent first. */
  private readonly fileQueue: string[] = [];
  private fileJobs = 0;
  private readonly preloadFiles: boolean;
  /** Ids with a file that can still be used (known and not failed): what resolveSource treats as files. */
  private readonly usable = { has: (id: string): boolean => this.files.has(id) && !this.fileFailed.has(id) };
  private readonly ducks: Record<'sfx' | 'bg', Duck[]> = { sfx: [], bg: [] };
  private readonly warned = new Set<string>();
  /** Ids whose last request missed the bake (playLater takes them). */
  private readonly missing = new Set<string>();
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
    this.preloadFiles = deps.preloadFiles ?? deps.files != null;
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
    for (const id of this.files.keys()) if (this.preloadFiles || sfxRow(id).bus === 'ui') this.queueFile(id);
  }

  /**
   * 기획 21차: get these ids ready before they are needed (scene start, next boss): a file decodes, a synth id bakes in
   * idle slices. A file id never bakes its synth sound (it would sit in memory unused).
   */
  prepare(ids: Iterable<string>): void {
    for (const id of ids) {
      const src = this.resolve(id);
      if (src?.kind === 'file') this.queueFile(src.id);
      else this.baker.enqueue([id], sfxRow(id).variants);
    }
  }

  /**
   * 기획 21차 리뷰: let go of decoded files the game is done with (an earlier run's roster, a beaten boss, a past
   * 괴담 / 돌발 괴담, another zone's ambience); a playing voice keeps its buffer until it ends, and the id decodes
   * again if it is asked for later. UI files stay. Queued decodes of those ids are dropped too. Returns how many.
   */
  releaseFiles(drop: (id: string) => boolean): number {
    let n = 0;
    for (const id of [...this.fileBufs.keys()])
      if (sfxRow(id).bus !== 'ui' && drop(id)) {
        this.fileBufs.delete(id);
        n++;
      }
    for (let i = this.fileQueue.length - 1; i >= 0; i--) if (drop(this.fileQueue[i])) this.fileQueue.splice(i, 1);
    return n;
  }

  /** Files waiting for a decode slot (tests / debug). */
  get filesQueued(): number {
    return this.fileQueue.length;
  }

  private resolve(id: string, skill?: string): Source {
    return resolveSource(id, { files: this.usable, hasRecipe, family: x => familyDefault(x, roleOf) }, skill);
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
    if (!buf) {
      this.playLater(id, row, o);
      return false;
    }
    return this.startNow(id, row, buf, t0, o);
  }

  private startNow(id: string, row: SfxRow, buf: Playable, t0: number, o: PlayOpts): boolean {
    this.prune();
    if (!this.makeRoom(id, row, o)) return false;
    this.last.set(id, t0);
    this.start(id, row, buf, t0, o);
    return true;
  }

  /** Not baked yet: bake it next (front of the queue) and start it then, if that is still soon enough. */
  private playLater(id: string, row: SfxRow, o: PlayOpts): void {
    if (!this.missing.has(id) || this.late.length >= 32 || this.late.some(l => l.id === id && l.o.key === o.key)) return;
    this.missing.delete(id);
    const t = this.now;
    this.late.push({ id, o, asked: t, until: t + (row.prio >= 3 ? LATE_MAX_HIGH : LATE_MAX_LOW) + Math.max(0, o.delay ?? 0) });
  }

  /** Sounds waiting for their bake (Sfx pumps the baker while any wait). */
  get waiting(): number {
    return this.late.length;
  }

  /** After a bake slice: start what is ready now (its delay shortened by the wait), drop what waited too long. */
  flushLate(): void {
    if (this.late.length === 0) return;
    const t = this.now;
    const keep: LatePlay[] = [];
    for (const l of this.late) {
      if (t > l.until) continue;
      const row = sfxRow(l.id);
      const buf = this.buffer(l.id, row, l.o.skill);
      if (!buf) {
        keep.push(l);
        continue;
      }
      const delay = Math.max(0, (l.o.delay ?? 0) - (t - l.asked));
      if (this.halted && row.bus !== 'ui') continue;
      this.startNow(l.id, row, buf, t + delay, { ...l.o, delay });
    }
    this.late = keep;
  }

  private start(id: string, row: SfxRow, b: Playable, asked: number, o: PlayOpts): void {
    const ctx = this.ctx!;
    // 기획 21차 리뷰: a file whose hit comes early for its cue's lead starts that much later (levels.json delay)
    const t0 = asked + Math.max(0, b.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = b.buf;
    src.loop = o.loopFor != null;
    src.playbackRate.value = (o.rate ?? 1) * b.rate * (row.variants > 1 ? 1 + (this.random() * 2 - 1) * 0.04 : 1);
    const vary = row.variants > 1 ? (this.random() * 2 - 1) * 1.5 : 0;
    const gain = ctx.createGain();
    const level = dbToGain(row.db + (o.db ?? 0) + vary) * b.gain;
    if (b.fadeIn) {
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(level, t0 + HEAD_FADE);
    } else gain.gain.setValueAtTime(level, t0);
    let tail: AudioNode = src;
    if (o.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      src.connect(p);
      tail = p;
    }
    tail.connect(gain);
    gain.connect(this.nodes!.inputs[o.far ? 'far' : row.bus]);
    // 기획 21차: a file plays from its start offset (leading silence skipped) to its end (silent tail cut); loops loop
    // from the offset. Synth buffers have neither and start exactly as before.
    const off = Math.min(Math.max(0, b.start), Math.max(0, b.buf.duration - 0.01));
    const end = b.end != null && b.end > off ? Math.min(b.end, b.buf.duration) : b.buf.duration;
    let t1 = t0 + (end - off) / Math.max(0.1, src.playbackRate.value);
    // start before any stop (stop() on an unstarted source throws)
    if (src.loop && off > 0) {
      src.loopStart = off;
      src.loopEnd = b.buf.duration;
    }
    if (off === 0 && end === b.buf.duration) src.start(t0);
    else if (src.loop) src.start(t0, off);
    else src.start(t0, off, end - off);
    if (!src.loop && end < b.buf.duration) {
      const fade = Math.min(TAIL_FADE, (t1 - t0) / 3);
      gain.gain.setValueAtTime(level, Math.max(t0, t1 - fade));
      gain.gain.linearRampToValueAtTime(0, t1);
    }
    if (o.loopFor != null) {
      t1 = t0 + o.loopFor;
      if (Number.isFinite(o.loopFor)) {
        const fade = Math.min(0.3, o.loopFor / 3);
        gain.gain.setValueAtTime(level, Math.max(t0, t1 - fade));
        gain.gain.linearRampToValueAtTime(0, t1);
        src.stop(t1 + 0.02);
      }
    }
    const v: Voice = { id, row, t0, t1, src, gain, key: o.key, skill: o.skill, far: !!o.far };
    src.onended = () => {
      this.voices = this.voices.filter(x => x !== v);
    };
    this.voices.push(v);
  }

  /** 4-2: total cap and group caps; evict the oldest of equal-or-lower priority, else refuse. */
  private makeRoom(id: string, row: SfxRow, o: PlayOpts): boolean {
    const cap = GROUP_CAP[row.group];
    if (cap != null && !this.evictIf(v => v.row.group === row.group, cap, row.prio)) return false;
    if (o.far && !this.farRoom(id, row, o.skill)) return false;
    return this.evictIf(() => true, this.maxVoices, row.prio);
  }

  /**
   * 4-3 (기획 13차 리뷰): another player's ult — one cast at a time (the stage cues of that cast coexist, another cast's
   * voices give way when they are not louder in priority); their drags have their own small cap.
   */
  private farRoom(id: string, row: SfxRow, skill?: string): boolean {
    if (id.startsWith('ult.')) {
      const cast = castOf(id, skill);
      const other = this.voices.filter(v => v.far && v.id.startsWith('ult.') && castOf(v.id, v.skill) !== cast);
      if (other.some(v => v.row.prio > row.prio)) return false;
      for (const v of other) this.kill(v, 0.015);
      return true;
    }
    if (id.startsWith('drag.')) return this.evictIf(v => v.far && v.id.startsWith('drag.'), FAR_DRAG_CAP, row.prio);
    return true;
  }

  /** Never a victim: keyed endless loops (ambience, enrage heart) — they would not come back by themselves. */
  private static pinned(v: Voice): boolean {
    return v.key != null && !Number.isFinite(v.t1);
  }

  private evictIf(match: (v: Voice) => boolean, cap: number, prio: number): boolean {
    const list = this.voices.filter(match);
    if (list.length < cap) return true;
    const victim = list.filter(v => v.row.prio <= prio && !AudioEngine.pinned(v)).sort((a, b) => a.t0 - b.t0)[0];
    if (!victim) return false;
    this.kill(victim, 0.015);
    return true;
  }

  /** A keyed voice is playing or scheduled (the director re-asks for a loop that is missing). */
  hasKey(key: string): boolean {
    this.prune();
    return this.voices.some(v => v.key === key);
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
    this.late = [];
    for (const v of [...this.voices]) if (v.row.bus !== 'ui') this.kill(v, fade);
    this.ducks.sfx = this.ducks.sfx.filter(d => !Number.isFinite(duckEnd(d)));
    this.ducks.bg = [];
    this.scheduleDuck('sfx');
    this.scheduleDuck('bg');
    this.lowpass(null, 0, 0.05);
  }

  // ─────────────────────────── buffers ───────────────────────────

  private buffer(id: string, row: SfxRow, skill?: string): Playable | null {
    const src = this.resolve(id, skill);
    if (!src) {
      if (!this.warned.has(id)) {
        this.warned.add(id);
        console.debug(`[sfx] no sound for ${id}`);
      }
      return null;
    }
    if (src.kind === 'file') {
      const list = this.fileBufs.get(src.id);
      if (!list) {
        // 기획 21차: not decoded yet — decode next (front of the queue), play it late (flushLate) like a synth sound
        this.queueFile(src.id, true);
        this.missing.add(id);
        return null;
      }
      const f = this.files.get(src.id);
      const [lo, hi] = f?.rate ?? [1, 1];
      return {
        buf: list[Math.floor(this.random() * list.length)],
        gain: f?.gain ?? 1,
        rate: lo + (hi - lo) * this.random(),
        start: f?.start ?? 0,
        ...(f?.end != null ? { end: f.end } : null),
        ...(f?.delay ? { delay: f.delay } : null),
        ...(f?.align ? { fadeIn: true } : null),
      };
    }
    let v = row.variants > 1 ? Math.floor(this.random() * row.variants) % row.variants : 0;
    if (!this.bakeInFrame && !this.has(src.id, v)) {
      // another variant that is ready plays instead; the rest bake in the background
      for (let k = 0; k < row.variants; k++) {
        if (!this.has(src.id, k)) continue;
        this.baker.enqueue([src.id], row.variants);
        v = k;
        break;
      }
    }
    const key = `${src.id}#${v}`;
    let buf = this.bufs.get(key);
    if (!buf) {
      // 기획 13차 리뷰: never bake inside a frame (a 20–100 ms stall on my own ult): bake it next, play it late (playLater)
      if (!this.baker.ready(src.id, v) && !this.bakeInFrame) {
        this.baker.enqueue([src.id], 1, true);
        this.missing.add(id);
        return null;
      }
      const samples = this.baker.now(src.id, v);
      if (!samples) return null;
      buf = this.ctx!.createBuffer(1, samples.length, SR);
      buf.getChannelData(0).set(samples);
      this.bufs.set(key, buf);
      this.baker.release(src.id, v); // the AudioBuffer holds the samples now (not twice)
    }
    return { buf, gain: 1, rate: 1, start: 0 };
  }

  /** Queue id's file for a decode slot (urgent = front of the queue); nothing when it is decoded, decoding or failed. */
  private queueFile(id: string, urgent = false): void {
    if (!this.ctx || !this.files.has(id) || this.fileBufs.has(id) || this.fileFailed.has(id) || this.fileLoading.has(id)) return;
    const i = this.fileQueue.indexOf(id);
    if (i >= 0) {
      if (!urgent) return;
      this.fileQueue.splice(i, 1);
    }
    if (urgent) this.fileQueue.unshift(id);
    else this.fileQueue.push(id);
    this.pumpFiles();
  }

  private pumpFiles(): void {
    while (this.fileJobs < FILE_JOBS && this.fileQueue.length) {
      const id = this.fileQueue.shift()!;
      this.fileJobs++;
      void this.loadFiles(id).finally(() => {
        this.fileJobs--;
        this.pumpFiles();
      });
    }
  }

  /** Decode id's file(s) once (concurrent asks share it); a sound waiting for it starts when it is ready. */
  private async loadFiles(id: string): Promise<void> {
    const ctx = this.ctx;
    const f = this.files.get(id);
    if (!ctx || !f || this.fileBufs.has(id) || this.fileFailed.has(id) || this.fileLoading.has(id)) return;
    this.fileLoading.add(id);
    try {
      const list = await Promise.all(f.urls.map(u => this.loadFile(ctx, u)));
      this.fileBufs.set(id, list);
    } catch {
      if (!this.fileFailed.has(id)) console.warn(`[sfx] file for ${id} could not be read — using the synth sound`);
      this.fileFailed.add(id);
    } finally {
      this.fileLoading.delete(id);
    }
    this.flushLate();
  }

  /** Ids that play from a file (debug board): it has one and it has not failed to decode. */
  isFile(id: string): boolean {
    return this.usable.has(id);
  }

  /** Ids whose file is decoded and held (tests / debug). */
  isDecoded(id: string): boolean {
    return this.fileBufs.has(id);
  }

  /** Bytes of the decoded files held as AudioBuffers (debug board). */
  fileBytes(): number {
    let b = 0;
    for (const list of this.fileBufs.values()) for (const x of list) b += (x.length ?? 0) * (x.numberOfChannels ?? 1) * 4;
    return b;
  }

  /** Debug 다시 굽기: drop baked synth buffers. */
  rebake(): void {
    this.bufs.clear();
    this.baker.clear();
  }

  /** Variant v of a synth id can play without baking (an AudioBuffer, or samples ready to wrap). */
  private has(id: string, v: number): boolean {
    return this.bufs.has(`${id}#${v}`) || this.baker.ready(id, v);
  }

  /** Bytes of the baked synth sounds held as AudioBuffers (4 per sample; tests / debug). */
  bufferBytes(): number {
    let b = 0;
    for (const x of this.bufs.values()) b += x.length * 4;
    return b;
  }

  // ─────────────────────────── ducking / low-pass ───────────────────────────

  duck(target: 'sfx' | 'bg', db: number, at = 0, hold = 0.6, attack = 0.04, release = 0.4, key?: string): void {
    const t = this.now;
    this.ducks[target] = this.ducks[target].filter(d => duckEnd(d) > t && (key == null || d.key !== key));
    this.ducks[target].push({ at: t + at, attack, hold, release, db, ...(key != null ? { key } : null) });
    this.scheduleDuck(target);
  }

  /** Release a keyed (held) duck now over `release` s (기획 13차 리뷰: '내가 탈락' ends when I am back). */
  unduck(target: 'sfx' | 'bg', key: string, release = 0.4): void {
    const t = this.now;
    let changed = false;
    for (const d of this.ducks[target]) {
      if (d.key !== key || duckEnd(d) <= t) continue;
      d.hold = Math.max(0, t - d.at - d.attack);
      d.release = release;
      changed = true;
    }
    if (changed) this.scheduleDuck(target);
  }

  /** Drop every duck (a new screen / run never inherits one). */
  clearDucks(): void {
    this.ducks.sfx = [];
    this.ducks.bg = [];
    this.scheduleDuck('sfx');
    this.scheduleDuck('bg');
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
  return toMono(ctx, await ctx.decodeAudioData(await res.arrayBuffer()));
}

/** 기획 21차: the generated files are stereo; every sound is mono and panned by the engine — keep half the memory. */
function toMono(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
  if (buf.numberOfChannels < 2) return buf;
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
  const o = out.getChannelData(0);
  const k = 1 / buf.numberOfChannels;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) o[i] += d[i] * k;
  }
  return out;
}
