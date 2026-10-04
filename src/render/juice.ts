// Impact feel (기획 8차 1: "드래그 스킬이 착지할 때 짧은 멈춤과 화면 흔들림"): hit-stop + camera shake.
// Render-only and on the real clock: the sim never pauses (multiplayer-safe), the DOM HUD keeps running; only the
// world picture holds still for a few frames while the camera shakes. Pure logic here (unit-tested in
// tests/render/juice.test.ts); the renderer (index.ts) freezes the frame and the Vfx layer decides when to call it.

/** Device-local render settings (debug panel "연출", persisted per device by ui/storage). */
export interface JuiceSettings {
  /** Base hit-stop length in ms for my drag-skill landing (0 = off). The actual stop scales 0.8–1.2× with impact. */
  hitStopMs: number;
  /** Camera shake strength multiplier (0 = off, 1 = default). */
  shake: number;
}

export const JUICE_DEFAULTS: Readonly<JuiceSettings> = { hitStopMs: 75, shake: 1 };
export const HIT_STOP_RANGE = { min: 0, max: 150, step: 5 } as const;
export const SHAKE_RANGE = { min: 0, max: 2, step: 0.1 } as const;

/** Live settings read every frame by the renderer (the debug panel writes here). */
export const JUICE: JuiceSettings = { ...JUICE_DEFAULTS };

/** Clamp/validate stored settings (unknown → defaults). */
export function sanitizeJuice(raw: unknown): JuiceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return {
    hitStopMs: num(r.hitStopMs, HIT_STOP_RANGE.min, HIT_STOP_RANGE.max, JUICE_DEFAULTS.hitStopMs),
    shake: num(r.shake, SHAKE_RANGE.min, SHAKE_RANGE.max, JUICE_DEFAULTS.shake),
  };
}

/** Never more than this much frozen time inside any rolling second (back-to-back meteors can't stack into a stall). */
export const FREEZE_BUDGET_SEC = 0.16;
/** One freeze never runs longer than this. */
export const FREEZE_MAX_SEC = 0.12;
const BUDGET_WINDOW = 1;
/** Shake decay (s) for a landing; shorter kicks may pass their own. */
export const SHAKE_DECAY_SEC = 0.25;
/** prefers-reduced-motion: shake is cut to this fraction (hit-stop is a pause, not motion, so it stays). */
export const REDUCED_MOTION_SHAKE = 0.3;
/** Shake amplitudes never exceed this (logical px) whatever the multiplier. */
const SHAKE_CAP_PX = 18;

let reducedMotion = false;
let reducedWatched = false;
/** OS "reduce motion" setting (watched for changes; false outside a browser). */
export function prefersReducedMotion(): boolean {
  if (!reducedWatched) {
    reducedWatched = true;
    try {
      const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (mq) {
        reducedMotion = mq.matches;
        mq.addEventListener?.('change', e => (reducedMotion = e.matches));
      }
    } catch {
      reducedMotion = false;
    }
  }
  return reducedMotion;
}

export class Juice {
  /** Seconds of hit-stop left (real time). */
  freeze = 0;
  /** Real-clock seconds since creation. */
  private now = 0;
  /** Freeze time granted, by when (for the rolling budget). */
  private readonly log: { t: number; d: number }[] = [];
  private shakeAmp = 0;
  private shakeAge = 0;
  private shakeDur = SHAKE_DECAY_SEC;
  private phase = 0;
  /** Settings source (tests pass their own). */
  constructor(readonly settings: JuiceSettings = JUICE, private readonly reduced: () => boolean = prefersReducedMotion) {}

  get frozen(): boolean {
    return this.freeze > 0;
  }

  /** Advance on the real clock (shake keeps decaying during a freeze: the frozen frame shakes). */
  update(dt: number): void {
    const d = Math.max(0, dt);
    this.now += d;
    this.freeze = Math.max(0, this.freeze - d);
    this.shakeAge += d;
    while (this.log.length && this.log[0].t < this.now - BUDGET_WINDOW) this.log.shift();
  }

  /** Freeze time still allowed in the current rolling second. */
  budget(): number {
    let used = 0;
    for (const e of this.log) if (e.t >= this.now - BUDGET_WINDOW) used += e.d;
    return Math.max(0, FREEZE_BUDGET_SEC - used);
  }

  /**
   * Ask for a hit-stop of `sec` (already scaled by the caller). Overlapping requests extend the current freeze only by
   * what they add; the rolling budget and the single-freeze cap keep it from ever turning into a stall.
   * Returns the seconds actually added.
   */
  hitStop(sec: number): number {
    if (!(sec > 0) || this.settings.hitStopMs <= 0) return 0;
    const want = Math.min(FREEZE_MAX_SEC, sec);
    const add = Math.min(Math.max(0, want - this.freeze), this.budget());
    if (add < 0.012) return 0;
    this.freeze += add;
    this.log.push({ t: this.now, d: add });
    return add;
  }

  /** Drop any running freeze (the player started a new drag, the floor changed …). */
  cancelFreeze(): void {
    this.freeze = 0;
  }

  /** Camera kick of `px` logical px decaying over `dur` s, × the shake setting (reduced-motion → ×0.3). Keeps the stronger one. */
  shake(px: number, dur = SHAKE_DECAY_SEC): void {
    const mult = this.settings.shake * (this.reduced() ? REDUCED_MOTION_SHAKE : 1);
    const amp = Math.min(SHAKE_CAP_PX, Math.max(0, px * mult));
    if (amp < 0.3) return;
    if (amp >= this.amplitude()) {
      this.shakeAmp = amp;
      this.shakeAge = 0;
      this.shakeDur = Math.max(0.05, dur);
      this.phase = (this.phase + 2.39996) % (Math.PI * 2);
    }
  }

  /** Current shake amplitude (px), ease-out decay to 0 over its duration. */
  amplitude(): number {
    if (this.shakeAmp <= 0 || this.shakeAge >= this.shakeDur) return 0;
    const k = 1 - this.shakeAge / this.shakeDur;
    return this.shakeAmp * k * k;
  }

  /** Screen offset (logical px) of the world layer this frame: two mixed sines, the vertical part a bit smaller. */
  offset(out: { x: number; y: number }): { x: number; y: number } {
    const a = this.amplitude();
    if (a <= 0.05) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    const t = this.shakeAge;
    const p = this.phase;
    out.x = a * (0.68 * Math.sin(t * 73 + p) + 0.32 * Math.sin(t * 131 + p * 1.7));
    out.y = a * 0.62 * (0.6 * Math.cos(t * 89 + p * 0.6) + 0.4 * Math.sin(t * 151 + p * 2.3));
    return out;
  }

  reset(): void {
    this.freeze = 0;
    this.shakeAmp = 0;
    this.shakeAge = 0;
    this.log.length = 0;
  }
}

/**
 * How hard a landing hit (0..1): enemies caught (5+ = full) weighs most, the footprint size a little.
 * `n` = enemies inside the area at impact, `size` = area in world units².
 */
export function impactStrength(n: number, size: number): number {
  const enemies = Math.min(1, Math.max(0, n) / 5);
  const area = Math.min(1, Math.max(0, size) / 30);
  return Math.min(1, enemies * 0.8 + area * 0.2);
}

/** My drag landing: hit-stop seconds and shake px for strength s (n = 0 → a light "thud" only). */
export function landingKick(settings: JuiceSettings, s: number, n: number): { stop: number; shake: number } {
  const base = settings.hitStopMs / 1000;
  if (n <= 0) return { stop: base * 0.6, shake: 4 };
  return { stop: base * (0.8 + 0.4 * s), shake: 6 + 6 * s };
}

/** A delayed part of my drag skill (meteor, chained blast): shorter stop, smaller shake; nothing hit → shake only. */
export function partKick(settings: JuiceSettings, s: number, n: number): { stop: number; shake: number } {
  const base = settings.hitStopMs / 1000;
  if (n <= 0) return { stop: 0, shake: 3 };
  return { stop: base * 0.5 * (0.8 + 0.4 * s), shake: 4 + 4 * s };
}
