// 기획 13차 통합: the backing-scale governor (render/quality.ts) — slow devices step down, fast ones back up.
import { describe, expect, it } from 'vitest';
import { QUALITY, governScale, newGovernor } from '../../src/render/quality';

/** Feed `sec` seconds of frames of `dt` and follow the scale like ensureBackingStore does (natural scale 1.625). */
function run(g: ReturnType<typeof newGovernor>, dt: number, sec: number, scale: number): number {
  for (let t = 0; t < sec; t += dt) scale = Math.min(1.625, governScale(g, dt, scale));
  return scale;
}

describe('backing-scale governor', () => {
  it('a device that keeps up (60 or 30 fps) never changes', () => {
    const g = newGovernor();
    expect(run(g, 1 / 60, 30, 1.625)).toBe(1.625);
    expect(run(g, 1 / 30, 30, 1.625)).toBe(1.625);
  });

  it('sustained slow frames step down 1/8 at a time to 1, never below', () => {
    const g = newGovernor();
    expect(run(g, 0.09, 1, 1.625)).toBe(1.625); // a short spike does nothing
    expect(run(g, 0.09, 2, 1.625)).toBe(1.5);
    expect(run(g, 0.09, 30, 1.5)).toBe(QUALITY.min);
  });

  it('comes back up after sustained fast frames, one step per 6 s', () => {
    const g = newGovernor();
    const low = run(g, 0.09, 30, 1.625);
    expect(low).toBe(1);
    let s = run(g, 1 / 60, 6.5, low);
    expect(s).toBe(1.125);
    s = run(g, 1 / 60, 40, s);
    expect(s).toBe(1.625);
  });

  it('ignores bad dt', () => {
    const g = newGovernor();
    expect(governScale(g, NaN, 1.5)).toBe(QUALITY.max);
    expect(governScale(g, 0, 1.5)).toBe(QUALITY.max);
  });
});
