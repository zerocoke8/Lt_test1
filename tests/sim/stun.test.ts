import { describe, expect, it } from 'vitest';
import { applyStatus } from '../../src/sim/status';
import { advance, makeGame, quietFloor, spawnAt } from './helpers';

// 기획 4차: 기절하면 공격 대기시간이 멈춤.
describe('stun pauses the attack timer', () => {
  it('a stunned monster keeps its remaining attack wait and cannot hit right after the stun ends', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    m.rt.attackCd = 1.5;
    applyStatus(m, 'stun', 2, 0, null);
    advance(tg, 1.9);
    expect(m.rt.attackCd).toBeCloseTo(1.5, 5);
    advance(tg, 0.5); // stun over after 2.0 s → 0.4 s of ticking
    expect(m.rt.attackCd).toBeGreaterThan(1.0);
    expect(m.rt.attackCd).toBeLessThan(1.5);
  });

  it('an unstunned unit still counts down normally', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    m.rt.attackCd = 1.5;
    advance(tg, 1);
    expect(m.rt.attackCd).toBeCloseTo(0.5, 1);
  });
});
