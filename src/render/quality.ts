// 기획 13차 통합: frame-time governor for the canvas backing store. On a device that cannot keep up, raster cost
// (∝ backing-store pixels) dominates the frame — the renewed skills draw more layers — so sustained slow frames lower
// the backing scale in 1/8 steps (never below 1 backing px per logical px) and sustained fast frames raise it again.
// A phone that keeps up never sees a change.

export const QUALITY = {
  /**
   * Smoothed frame time above this (s) counts as slow (below ~45 fps). 기획 13차 리뷰: was 1/24 — a phone sitting at
   * 30 fps through three seats' ults never stepped down; now it does, and comes back once frames are fast again.
   */
  slowSec: 1 / 45,
  /** Smoothed frame time below this (s) counts as fast (above ~55 fps; the gap to slowSec keeps it from flapping). */
  fastSec: 1 / 55,
  /** Seconds of slow frames before one step down / of fast frames before one step up. */
  downAfter: 1.5,
  upAfter: 6,
  step: 0.125,
  min: 1,
  max: 2,
  /** EMA weight of the newest frame. */
  smooth: 0.1,
} as const;

export interface QualityGovernor {
  /** Upper bound for the backing scale (device px per logical px). */
  cap: number;
  /** Smoothed real frame time (s). */
  ema: number;
  slowFor: number;
  fastFor: number;
}

export function newGovernor(): QualityGovernor {
  return { cap: QUALITY.max, ema: 1 / 60, slowFor: 0, fastFor: 0 };
}

/** Feed one frame's real dt (s) and the scale in use now; returns the cap for the next backing store (one step at most). */
export function governScale(g: QualityGovernor, dt: number, current: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return g.cap;
  g.ema += (dt - g.ema) * QUALITY.smooth;
  if (g.ema > QUALITY.slowSec) {
    g.slowFor += dt;
    g.fastFor = 0;
  } else if (g.ema < QUALITY.fastSec) {
    g.fastFor += dt;
    g.slowFor = 0;
  } else {
    g.slowFor = 0;
    g.fastFor = 0;
  }
  if (g.slowFor >= QUALITY.downAfter && current > QUALITY.min) {
    g.cap = Math.max(QUALITY.min, current - QUALITY.step);
    g.slowFor = 0;
  } else if (g.fastFor >= QUALITY.upAfter && g.cap < QUALITY.max) {
    g.cap = Math.min(QUALITY.max, g.cap + QUALITY.step);
    g.fastFor = 0;
  }
  return g.cap;
}
