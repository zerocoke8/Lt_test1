// 기획 13차 보스 그로기 HUD helpers (pure) + the break kick.
import { describe, expect, it } from 'vitest';
import { groggyBar, groggyDown, groggyPillText } from '../../src/ui/groggyHud';
import { GROGGY_STOP_SEC, Juice, groggyKick } from '../../src/render/juice';
import { breakerLine } from '../../src/render/groggyFx';
import type { BossGroggyState, GameState } from '../../src/types';

const g = (o: Partial<BossGroggyState>): BossGroggyState => ({ fill: 0, left: 0, total: 5, lock: 0, lockTotal: 10, count: 0, near: false, breaker: null, ...o });

describe('groggy HUD', () => {
  it('bar modes: gauge fill, countdown while down (left / total), lock hatch refilling', () => {
    expect(groggyBar(g({ fill: 0.42 }))).toEqual({ mode: 'fill', f: 0.42 });
    expect(groggyBar(g({ fill: 1, left: 2.5 }))).toEqual({ mode: 'down', f: 0.5 });
    expect(groggyBar(g({ lock: 7.5 }))).toEqual({ mode: 'lock', f: 0.25 });
  });

  it('pill text: one decimal, the drag multiplier', () => {
    expect(groggyPillText(g({ left: 4.23 }), 2)).toBe('그로기! 4.2초 · 드래그 ×2');
    expect(groggyPillText(g({ left: 0.04 }), 2.5)).toBe('그로기! 0.0초 · 드래그 ×2.5');
    expect(groggyDown({ bossGroggy: g({ left: 1 }) })).toBe(true);
    expect(groggyDown({ bossGroggy: null })).toBe(false);
  });

  it('stamp third line: only with another human seat; mine says so', () => {
    const players = (bots: boolean[]) => bots.map((isBot, id) => ({ id, isBot, name: ['나', '민지', '준'][id] })) as unknown as GameState['players'];
    const s = (bots: boolean[]) => ({ players: players(bots) }) as GameState;
    expect(breakerLine(s([false, true, true]), 0, 1)).toBe('');
    expect(breakerLine(s([false, false, true]), 0, 0)).toBe('내가 쓰러뜨렸다!');
    expect(breakerLine(s([false, false, false]), 0, 1)).toBe('민지가 쓰러뜨림');
    expect(breakerLine(s([false, false, false]), 0, 2)).toBe('준이 쓰러뜨림');
    expect(breakerLine(s([false, false, false]), 0, null)).toBe('');
  });

  it('break kick: 180 ms stop at the default setting (past the per-landing cap), shake twice a landing', () => {
    const k = groggyKick({ hitStopMs: 75, shake: 1 });
    expect(k.stop).toBeCloseTo(GROGGY_STOP_SEC, 6);
    expect(k.shake).toBeGreaterThanOrEqual(16);
    const j = new Juice({ hitStopMs: 75, shake: 1 }, () => false);
    expect(j.hitStop(k.stop, { cap: k.stop, ignoreBudget: true })).toBeCloseTo(0.18, 6);
    expect(groggyKick({ hitStopMs: 0, shake: 1 }).stop).toBe(0);
  });
});
