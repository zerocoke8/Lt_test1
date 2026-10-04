import { describe, expect, it } from 'vitest';
import { applyStatus } from '../../src/sim/status';
import { edgeDist } from '../../src/sim/world';
import { active, advance, HUMAN, HUMAN2, makeGame, quietFloor, spawnAt } from './helpers';

describe('R6 character targeting', () => {
  it('locks the nearest enemy until it dies; then picks the next nearest', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = active(tg);
    me.pos = { x: 18, y: 6 };
    const a = spawnAt(tg, 'golem', { x: 21, y: 6 });
    const b = spawnAt(tg, 'golem', { x: 26, y: 6 });
    // keep both still so only the lock rule matters
    applyStatus(a, 'stun', 100, 0, null);
    applyStatus(b, 'stun', 100, 0, null);
    advance(tg, 1 / 30);
    expect(me.targetId).toBe(a.id);
    // B now becomes much closer — lock holds (no exceptions)
    b.pos = { x: 17, y: 6 };
    advance(tg, 1);
    expect(me.targetId).toBe(a.id);
    // A dies → retarget to nearest
    a.hp = 1;
    a.shield = 0;
    a.rt.base.def = 0;
    advance(tg, 3);
    expect(a.rt.gone).toBe(true);
    expect(me.targetId).toBe(b.id);
  });

  it('idles when there is no enemy at all', () => {
    const tg = makeGame();
    quietFloor(tg);
    advance(tg, 1);
    const me = active(tg);
    expect(me.targetId).toBeNull();
    expect(me.anim).toBe('idle');
  });

  it('moves toward the target until within range', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = active(tg);
    me.pos = { x: 5, y: 6 };
    const m = spawnAt(tg, 'slime', { x: 15, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    advance(tg, 1);
    expect(me.pos.x).toBeGreaterThan(5.5);
    advance(tg, 4);
    expect(edgeDist(me, m)).toBeLessThanOrEqual(me.rt.base.range + 0.05);
  });
});

describe('R7 monster targeting', () => {
  it('keeps its target and re-picks the nearest when that character swaps out', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    const p0 = active(tg, 0);
    const p1 = active(tg, 1);
    p0.pos = { x: 10, y: 6 };
    p1.pos = { x: 20, y: 6 };
    // keep the characters still (they would walk to the monster)
    applyStatus(p0, 'stun', 100, 0, null);
    applyStatus(p1, 'stun', 100, 0, null);
    const m = spawnAt(tg, 'slime', { x: 12, y: 6 });
    advance(tg, 1 / 30);
    expect(m.targetId).toBe(p0.id);
    // p1 comes closer than p0 → no switch (lock)
    p1.pos = { x: 12.6, y: 6 };
    advance(tg, 0.5);
    expect(m.targetId).toBe(p0.id);
    // p0 swaps out far away → monster re-picks nearest (p1)
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 33, y: 10 } }).ok).toBe(true);
    advance(tg, 1 / 30);
    expect(m.targetId).toBe(p1.id);
  });
});

describe('R8 boss lock release toggle', () => {
  function bossSetup(release: number) {
    const tg = makeGame({ startFloor: 5, tunables: { bossLockReleaseSec: release, invincible: true } });
    const s = tg.game.state;
    const boss = tg.w.state.entities.find(e => e.id === s.bossId)!;
    boss.rt.skillCds = boss.rt.skillCds.map(() => 999);
    const me = active(tg);
    me.pos = { x: 12, y: 2.3 };
    advance(tg, 1 / 30);
    expect(me.targetId).toBe(boss.id);
    const add = spawnAt(tg, 'goblin', { x: 20, y: 9 });
    applyStatus(add, 'stun', 100, 0, null);
    return { tg, me, boss, add };
  }

  it('default (0): a character keeps hitting the boss', () => {
    const { tg, me, boss } = bossSetup(0);
    advance(tg, 4);
    expect(me.targetId).toBe(boss.id);
  });

  it('N > 0: drops the boss after N seconds and takes the nearest non-boss', () => {
    const { tg, me, add } = bossSetup(2);
    advance(tg, 2.2);
    expect(me.targetId).toBe(add.id);
  });
});
