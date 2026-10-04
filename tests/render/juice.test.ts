// 기획 8차 hit-stop + camera shake (render-only): budget caps, scaling, settings, reduced motion, sanitising.
import { describe, expect, it } from 'vitest';
import { FREEZE_BUDGET_SEC, FREEZE_MAX_SEC, JUICE_DEFAULTS, Juice, REDUCED_MOTION_SHAKE, impactStrength, landingKick, partKick, sanitizeJuice } from '../../src/render/juice';

const settings = () => ({ ...JUICE_DEFAULTS });

describe('Juice hit-stop', () => {
  it('a landing freezes for 60–90 ms at the default setting, scaled by how much it hit', () => {
    const s = settings();
    const weak = landingKick(s, impactStrength(1, 3), 1);
    const strong = landingKick(s, impactStrength(8, 40), 8);
    expect(weak.stop).toBeGreaterThanOrEqual(0.06);
    expect(strong.stop).toBeLessThanOrEqual(0.09 + 1e-9);
    expect(strong.stop).toBeGreaterThan(weak.stop);
    expect(strong.shake).toBeGreaterThan(weak.shake);
    expect(weak.shake).toBeGreaterThanOrEqual(6);
    expect(strong.shake).toBeLessThanOrEqual(12);
    // a landing that hits nothing is a light thud; a delayed part that hits nothing does not freeze
    expect(landingKick(s, 0, 0).stop).toBeLessThan(weak.stop);
    expect(partKick(s, 0, 0).stop).toBe(0);
  });

  it('freezes never stack into a stall: one freeze ≤ cap, total in any rolling second ≤ budget', () => {
    const j = new Juice(settings(), () => false);
    let frozen = 0;
    // a meteor shower: a kick every 50 ms for 3 s, each asking for 90 ms
    for (let t = 0; t < 3; t += 1 / 60) {
      if (Math.round(t * 60) % 3 === 0) j.hitStop(0.09);
      expect(j.freeze).toBeLessThanOrEqual(FREEZE_MAX_SEC + 1e-9);
      if (j.frozen) frozen += 1 / 60;
      j.update(1 / 60);
    }
    // ≤ budget per second (+ one frame of rounding per second)
    expect(frozen).toBeLessThanOrEqual(3 * (FREEZE_BUDGET_SEC + 1 / 60));
    expect(frozen).toBeGreaterThan(0.2);
  });

  it('overlapping requests extend only by what they add; 0 ms setting turns it off', () => {
    const j = new Juice(settings(), () => false);
    expect(j.hitStop(0.08)).toBeCloseTo(0.08, 6);
    expect(j.hitStop(0.05)).toBe(0);
    expect(j.freeze).toBeCloseTo(0.08, 6);
    j.update(0.08);
    expect(j.frozen).toBe(false);
    const off = new Juice({ hitStopMs: 0, shake: 1 }, () => false);
    expect(off.hitStop(0.08)).toBe(0);
    expect(off.frozen).toBe(false);
    j.hitStop(0.06);
    j.cancelFreeze();
    expect(j.frozen).toBe(false);
  });
});

describe('Juice shake', () => {
  it('decays to nothing over ~250 ms and keeps the stronger kick', () => {
    const j = new Juice(settings(), () => false);
    j.shake(10);
    expect(j.amplitude()).toBeCloseTo(10, 6);
    j.update(0.125);
    expect(j.amplitude()).toBeCloseTo(2.5, 6);
    j.shake(1); // weaker: ignored
    expect(j.amplitude()).toBeCloseTo(2.5, 6);
    j.update(0.13);
    expect(j.amplitude()).toBe(0);
    const o = j.offset({ x: 9, y: 9 });
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });

  it('the strength setting scales it (0 = off) and reduced motion cuts it', () => {
    const half = new Juice({ hitStopMs: 75, shake: 0.5 }, () => false);
    half.shake(10);
    expect(half.amplitude()).toBeCloseTo(5, 6);
    const off = new Juice({ hitStopMs: 75, shake: 0 }, () => false);
    off.shake(10);
    expect(off.amplitude()).toBe(0);
    const reduced = new Juice(settings(), () => true);
    reduced.shake(10);
    expect(reduced.amplitude()).toBeCloseTo(10 * REDUCED_MOTION_SHAKE, 6);
    // offsets stay within the amplitude
    const j = new Juice(settings(), () => false);
    j.shake(12);
    for (let i = 0; i < 20; i++) {
      const o = j.offset({ x: 0, y: 0 });
      expect(Math.abs(o.x)).toBeLessThanOrEqual(j.amplitude() + 1e-9);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(j.amplitude() + 1e-9);
      j.update(1 / 60);
    }
  });

  it('stored settings are clamped and garbage falls back to defaults', () => {
    expect(sanitizeJuice(null)).toEqual(JUICE_DEFAULTS);
    expect(sanitizeJuice({ hitStopMs: 9999, shake: -3 })).toEqual({ hitStopMs: 150, shake: 0 });
    expect(sanitizeJuice({ hitStopMs: 'x', shake: 1.4 })).toEqual({ hitStopMs: JUICE_DEFAULTS.hitStopMs, shake: 1.4 });
  });
});
