// 기획 13차 효과음: the `sfx` singleton the UI talks to (docs/sfx.md 2-1 index.ts). Without an AudioContext (node,
// vitest, server) every call is a cheap no-op that still keeps the `recent` log. The context is created on the first
// finger *release* (pointerup / touchend / click / keydown — never pointerdown, 2-3), so no autoplay warnings.

import type { GameEvent, GameState, Vec2 } from '../types';
import { CHARACTERS } from '../data';
import { ZONES, zoneOf } from '../config';
import { Director, type Ctl, type SoundReq } from './director';
import { AudioEngine, type PlayOpts } from './engine';
import { sfxRow } from './ids';
import { bakeBudget } from './bake';
import { recipeIds } from './synth/recipes';
import { AUDIO_DEFAULTS, forcedMute, loadAudio, saveAudio, type AudioSettings } from './settings';
import { uiSoundFor, type UiTarget } from './uiSfx';

export interface FrameView {
  localPlayer: number;
  gameSpeed: number;
  toScreen?: (p: Vec2) => Vec2;
  /** Real time (ms, performance.now). */
  nowMs: number;
}

export interface RecentEntry {
  id: string;
  at: number;
  far?: boolean;
}

/** Bursts older than this (reconnect, a stalled tab) only play priority ≥ 4 (4-2). */
const STALE_MS = 250;
const RECENT_MAX = 64;
/**
 * Prefixes baked when a run starts (besides the roster's own sounds). 기획 13차 리뷰: no 'fe.' (4 MB, one event a floor at
 * most — it bakes when it is first asked for and plays a moment late) and only this floor's ambience (1 MB each).
 */
const COMMON = ['hit.', 'hurt.', 'heal.', 'fx.', 'mon.', 'mid.', 'char.', 'ui.', 'ult.ready', 'drag.crunch', 'floor.', 'zone.', 'bench.', 'copy.', 'doll.', 'dash.', 'atk.swing.', 'atk.shot.turret'];
const BOSS_COMMON = ['boss.windup.', 'boss.impact.', 'boss.enrage', 'boss.retreat', 'enrage.', 'groggy.', 'amb.boss'];

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

function contextCtor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class Sfx {
  readonly engine: AudioEngine;
  readonly director = new Director();
  readonly recent: RecentEntry[] = [];
  private settingsCache: AudioSettings = { ...AUDIO_DEFAULTS };
  private forced = false;
  private armed = false;
  private hiddenSuspend = false;
  private lastFrameAt = 0;
  private lastHighAt = -1e9;
  private paused = false;
  private members = -1;
  private connected = true;
  private warmedBoss = new Set<string>();
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private urgentTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly makeContext: () => AudioContext | null;

  constructor(opts: { engine?: AudioEngine; makeContext?: () => AudioContext | null } = {}) {
    this.engine = opts.engine ?? new AudioEngine();
    this.makeContext =
      opts.makeContext ??
      (() => {
        const C = contextCtor();
        return C ? new C({ latencyHint: 'interactive' }) : null;
      });
  }

  get settings(): AudioSettings {
    return this.settingsCache;
  }

  /** Forced by ?mute=1 (the setting is untouched). */
  get forcedMute(): boolean {
    return this.forced;
  }

  get unlocked(): boolean {
    return !!this.engine.ctx;
  }

  /** Once at app start: settings, unlock listeners, the button click sounds, tab visibility. */
  attach(root: HTMLElement): void {
    this.settingsCache = loadAudio();
    this.forced = forcedMute();
    this.engine.forced = this.forced;
    this.arm();
    root.addEventListener('click', e => {
      const id = uiSoundFor(e.target as unknown as UiTarget);
      if (id) this.ui(id);
    });
    document.addEventListener('visibilitychange', () => this.onVisibility(document.hidden));
  }

  // ─────────────────────────── unlock (2-3) ───────────────────────────

  private arm(): void {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    for (const t of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(t, this.onGesture, { capture: true, passive: true });
  }

  private disarm(): void {
    this.armed = false;
    for (const t of ['pointerup', 'touchend', 'click', 'keydown']) window.removeEventListener(t, this.onGesture, { capture: true });
  }

  private readonly onGesture = (): void => {
    this.unlock();
  };

  /** Create / resume the context inside a user gesture. ?mute=1 never creates one (nothing to hear, nothing to bake). */
  unlock(): void {
    if (this.forced) {
      this.disarm();
      return;
    }
    let ctx = this.engine.ctx;
    if (!ctx) {
      ctx = this.makeContext();
      if (!ctx) {
        this.disarm();
        return;
      }
      setAmbientSession();
      this.engine.init(ctx);
      this.engine.apply(this.settingsCache);
      ctx.onstatechange = () => this.onState();
      // iOS: one silent sample inside the gesture opens the output
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch {
        /* ignore */
      }
    }
    if (ctx.state === 'running') {
      this.disarm();
      return;
    }
    if (this.hiddenSuspend) return;
    const c = ctx;
    void c
      .resume()
      .then(() => {
        if (c.state === 'running') this.disarm();
      })
      .catch(() => undefined);
  }

  /** Phone call / Bluetooth switch (`interrupted`) → wait for the next touch (2-3). */
  private onState(): void {
    const st = this.engine.ctx?.state as string | undefined;
    if (st === 'interrupted' || (st === 'suspended' && !this.hiddenSuspend)) this.arm();
  }

  private onVisibility(hidden: boolean): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    this.hiddenSuspend = hidden;
    if (hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => this.arm());
  }

  // ─────────────────────────── per frame ───────────────────────────

  /** After renderer.render: route this frame's events + state changes to sounds. */
  frame(state: GameState, events: readonly GameEvent[], view: FrameView): void {
    const stale = this.lastFrameAt > 0 && view.nowMs - this.lastFrameAt > STALE_MS;
    this.lastFrameAt = view.nowMs;
    if (this.paused && events.length === 0) return;
    this.warmBoss(state);
    this.engine.flushLate();
    const out = this.director.route(events, state, {
      localPlayer: view.localPlayer,
      gameSpeed: view.gameSpeed,
      toScreen: view.toScreen,
      now: view.nowMs / 1000,
      playing: key => this.engine.hasKey(key),
    });
    for (const c of out.ctl) this.control(c);
    for (const r of out.sounds) if (!stale || sfxRow(r.id).prio >= 4) this.request(r, view.nowMs);
  }

  /** Screen changes: a new run resets the watchers and bakes this run's sounds; leaving combat cuts the loops. */
  scene(name: 'preset' | 'lobby' | 'combat' | 'result', state?: GameState | null, localPlayer = 0): void {
    // 기획 13차 리뷰: a new screen never inherits a duck (the held '내가 탈락' one included)
    this.engine.clearDucks();
    if (name === 'combat') {
      this.director.reset();
      this.warmedBoss.clear();
      this.engine.stop('', 0.2);
      if (state) this.prewarm(state, localPlayer);
      return;
    }
    if (name !== 'result') this.engine.stopAll(0.3);
    else this.engine.stop('amb', 0.6);
    this.director.forgetLoops();
  }

  /** Solo pause / portrait: everything but UI stops (scheduled sounds too); resume restarts the loops. */
  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    this.engine.halted = on;
    if (on) this.engine.stopAll(0.05);
    this.director.forgetLoops();
  }

  // ─────────────────────────── play ───────────────────────────

  /** A UI sound (buttons, toasts, drag lift …). Toasts stay quiet when a priority ≥ 3 sound just played (3-11). */
  ui(id: string, o: PlayOpts = {}): void {
    const now = performance.now();
    if (id.startsWith('ui.toast.') && now - this.lastHighAt < 80) return;
    this.request({ id, ...o }, now);
  }

  /** Result screen: a small ding per best cell, 0.08 s apart (max 6). */
  bests(n: number): void {
    for (let i = 0; i < Math.min(6, n); i++) this.ui('result.best', { delay: 0.35 + i * 0.08, rate: Math.pow(2, i / 12) });
  }

  /** Room member count (lobby): someone joined / left. */
  roomMembers(n: number): void {
    if (this.members >= 0 && n > 0 && n !== this.members) this.ui(n > this.members ? 'net.playerJoin' : 'net.playerLeave');
    this.members = n;
  }

  /** Multiplayer connection state per frame: lost / back. */
  net(connected: boolean): void {
    if (connected !== this.connected) this.ui(connected ? 'net.reconnect' : 'net.lost');
    this.connected = connected;
  }

  /** Debug board / tests: play an id directly. */
  play(id: string, o: PlayOpts = {}): boolean {
    return this.request({ id, ...o }, performance.now());
  }

  private request(r: SoundReq, nowMs: number): boolean {
    this.recent.push({ id: r.id, at: Math.round(nowMs), ...(r.far ? { far: true } : null) });
    if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
    if (sfxRow(r.id).prio >= 3) this.lastHighAt = nowMs;
    const ok = this.engine.play(r.id, r);
    if (this.engine.waiting) this.pumpNow();
    else if (this.engine.baker.pending) this.pumpSoon();
    return ok;
  }

  private control(c: Ctl): void {
    if (c.kind === 'duck') this.engine.duck(c.target, c.db, c.at, c.hold, c.attack, c.release, c.key);
    else if (c.kind === 'unduck') this.engine.unduck(c.target, c.key, c.release);
    else if (c.kind === 'lowpass') this.engine.lowpass(c.freq, c.at, c.ramp);
    else this.engine.stop(c.key, c.fade);
  }

  // ─────────────────────────── settings ───────────────────────────

  setSettings(patch: Partial<AudioSettings>): void {
    this.settingsCache = { ...this.settingsCache, ...patch };
    saveAudio(this.settingsCache);
    this.engine.apply(this.settingsCache);
  }

  /** Effectively silent (setting or ?mute=1). */
  get muted(): boolean {
    return this.forced || this.settingsCache.muted;
  }

  // ─────────────────────────── baking (2-1 bake.ts) ───────────────────────────

  /**
   * 기획 13차 리뷰: what this run can play, most urgent first — my own cards' drag / ult / cut-in, ult.ready and my pets
   * (whatever my seat), then the groggy, then everyone else's roster and the common sounds. Every variant of a 3-variant id.
   */
  private prewarm(s: GameState, localPlayer: number): void {
    if (!this.engine.ctx) return;
    const lp = localPlayer >= 0 && localPlayer < s.players.length ? localPlayer : 0;
    const mine = new Set(s.players[lp]?.party.map(m => m.defId) ?? []);
    const chars = new Set(s.players.flatMap(p => p.party.map(m => m.defId)));
    const roles = new Set(CHARACTERS.filter(c => chars.has(c.id)).map(c => c.role));
    const pets = s.players[lp]?.pets.map(p => `pet.${p.defId}`) ?? [];
    const own = (c: string, id: string) => id.startsWith(`drag.${c}.`) || id.startsWith(`ult.${c}.`) || id === `normal.${c}` || id === `atk.shot.${c}`;
    const all = recipeIds();
    const first = all.filter(id => [...mine].some(c => own(c, id)) || id === 'ult.ready' || pets.some(p => id.startsWith(p)));
    const groggy = all.filter(id => id.startsWith('groggy.'));
    const amb = [`amb.${s.plan.theme ?? 'lobby'}`, 'amb.goedam'];
    const rest = all.filter(id => [...chars].some(c => own(c, id)) || [...roles].some(r => id.endsWith(`.${r}`)) || COMMON.some(p => id.startsWith(p)));
    this.enqueueAll([...first, ...groggy, ...amb, ...rest]);
    this.pumpSoon();
  }

  private enqueueAll(ids: readonly string[]): void {
    for (const id of new Set(ids)) this.engine.baker.enqueue([id], sfxRow(id).variants);
  }

  /** The boss's sounds bake before its floor: on the reward / 괴담 screen that leads to it (else on its first frame). */
  private warmBoss(s: GameState): void {
    const b = s.plan.bossId ?? (s.phase !== 'combat' ? bossOfFloor(s.floor + 1) : null);
    if (!b || this.warmedBoss.has(b) || !this.engine.ctx) return;
    this.warmedBoss.add(b);
    this.enqueueAll([`boss.intro.${b}`, `boss.phase.${b}`, ...recipeIds().filter(id => BOSS_COMMON.some(p => id.startsWith(p)))]);
    this.pumpSoon();
  }

  /** A sound is waiting for its bake: slices right away (not idle time), starting each waiting sound when it is ready. */
  private pumpNow(): void {
    if (this.urgentTimer || !this.engine.ctx) return;
    const run = () => {
      this.urgentTimer = null;
      this.engine.baker.pump(BAKE_URGENT_MS);
      this.engine.flushLate();
      if (this.engine.waiting) this.pumpNow();
      else if (this.engine.baker.pending) this.pumpSoon();
    };
    this.urgentTimer = setTimeout(run, 0);
  }

  /** Idle slices of ≤ 8 ms until the queue is empty. */
  private pumpSoon(): void {
    if (this.pumpTimer || !this.engine.ctx) return;
    const g = globalThis as unknown as { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number };
    const run = (deadline?: IdleDeadline) => {
      this.pumpTimer = null;
      // 기획 13차 통합: only the idle time the browser reports — a busy (slow) phone bakes a sliver per slice
      this.engine.baker.pump(bakeBudget(deadline));
      if (this.engine.baker.pending) this.pumpSoon();
    };
    this.pumpTimer = setTimeout(() => (g.requestIdleCallback ? g.requestIdleCallback(run, { timeout: 300 }) : run()), 30);
  }

  /** Every id with a synth recipe (debug board, tests). */
  ids(): string[] {
    return recipeIds().sort();
  }
}

/** Boss of a boss floor (same rule as sim planFloor), null on other floors. */
export function bossOfFloor(f: number): string | null {
  if (f < 5 || f % 5 !== 0) return null;
  return f <= ZONES[ZONES.length - 1].to ? zoneOf(f).boss : ZONES[(f / 5 - 1) % ZONES.length].boss;
}

/** One urgent bake slice (ms): short, so a frame in between still makes it. */
const BAKE_URGENT_MS = 4;

/** iOS 17+: follow the silent switch and don't stop the user's music (designer check #1: ambient). */
function setAmbientSession(): void {
  try {
    const nav = globalThis.navigator as unknown as { audioSession?: { type: string } };
    if (nav?.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    /* not supported */
  }
}

/** The app-wide instance. */
export const sfx = new Sfx();
