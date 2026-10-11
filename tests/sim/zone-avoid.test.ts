// 기획 20차 rule N8 (docs/bosses.md 3장 — 보스 레이드만): characters walk around the zones an enemy left on the ground.
// ① out of a zone under the feet ② a clean spot to attack from ③ side-steps around what lies on the way ④ no way →
// wait 1.5 s, then walk in ⑤ melee and the boss ringed → walk in at once. Never in the classic tower / 원정. Plus the
// crowd rule that came with small moving bosses: a spot an ally stands on is not a spot.
import { describe, expect, it } from 'vitest';
import { arenaAt } from '../../src/data/bosses';
import { ZONE_AVOID } from '../../src/data/bosses/forms';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { startAction } from '../../src/sim/skills';
import type { SimEntity, SimZone } from '../../src/sim/world';
import type { AreaShape, PlayerSetup, SkillAction, Vec2 } from '../../src/types';
import { HUMAN, active, advance, clearEvents, eventsOf, makeGame, spawnAt, type TestGame } from './helpers';
import { bossOf, raidGame } from './bossRaidHelpers';

const MAGE: PlayerSetup = { ...HUMAN, characters: ['mage', 'guardian', 'blade'] };

/** A raid fight against a boss that stands still at `at` and does nothing; the party is invincible. */
function arena(at: Vec2, players: PlayerSetup[] = [HUMAN]): TestGame {
  const tg = raidGame('washer_drum', { hpMult: 80, players, tunables: { invincible: true, bossGroggyThreshold: 0 } });
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
  advance(tg, 1.1);
  b.pos = { ...at };
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
  clearEvents(tg);
  return tg;
}

/** Lay an enemy zone (it stays 30 s and ticks twice a second). */
function zone(tg: TestGame, at: Vec2, area: AreaShape): SimZone {
  const b = bossOf(tg);
  const part: SkillAction = { ...arenaAt(at.x, at.y), area, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.1 }], zone: { duration: 30, tickInterval: 0.5 } };
  startAction(tg.w, unitCtx(tg.w, b, 'syn_zone', '시험 장판'), part);
  return tg.w.state.zones[tg.w.state.zones.length - 1];
}

const inZone = (z: SimZone, e: SimEntity): boolean => hitsArea(z.area ?? { shape: 'circle', radius: z.radius }, z.center, z.center, e.pos, e.radius);
const hitsBoss = (tg: TestGame): number => eventsOf(tg, 'damage').filter(d => d.targetId === bossOf(tg).id).length;

/** Run until the character has hit the boss (returns the seconds it took, −1 = never) while counting ticks spent in `z`. */
function walkIn(tg: TestGame, e: SimEntity, z: SimZone | null, maxSec = 20): { at: number; inZone: number } {
  let inside = 0;
  for (let t = 0; t < maxSec * 30; t++) {
    tick(tg.w);
    if (z && inZone(z, e)) inside++;
    if (tg.game.drainEvents().some(d => d.type === 'damage' && d.targetId === bossOf(tg).id)) return { at: (t + 1) / 30, inZone: inside };
  }
  return { at: -1, inZone: inside };
}

describe('rule N8: walking around zones (보스 레이드)', () => {
  it('③ a puddle on the straight way to the boss: the character walks around it, never through, and still gets there', () => {
    const tg = arena({ x: 18, y: 6 });
    const me = active(tg);
    me.pos = { x: 6, y: 6 };
    const z = zone(tg, { x: 12, y: 6 }, { shape: 'circle', radius: 2 });
    const r = walkIn(tg, me, z);
    expect(r.at).toBeGreaterThan(0);
    expect(r.inZone).toBe(0);
    // the detour costs a little: longer than the straight walk, not by much
    const straight = arena({ x: 18, y: 6 });
    active(straight).pos = { x: 6, y: 6 };
    const s = walkIn(straight, active(straight), null);
    expect(r.at).toBeGreaterThan(s.at);
    expect(r.at).toBeLessThan(s.at + 3);
  });

  it('① a zone laid under a character that is attacking: it steps out within moments and goes on from a clean spot', () => {
    const tg = arena({ x: 12, y: 6 });
    const me = active(tg);
    me.pos = { x: 9, y: 6 };
    advance(tg, 3);
    expect(hitsBoss(tg)).toBeGreaterThan(0);
    const z = zone(tg, { ...me.pos }, { shape: 'circle', radius: 1.2 });
    expect(inZone(z, me)).toBe(true);
    advance(tg, 1.5);
    expect(inZone(z, me)).toBe(false);
    clearEvents(tg);
    let inside = 0;
    for (let t = 0; t < 6 * 30; t++) {
      tick(tg.w);
      if (inZone(z, me)) inside++;
    }
    expect(inside).toBe(0);
    expect(hitsBoss(tg)).toBeGreaterThan(0);
  });

  it('② the spot it would attack from is covered: it takes the nearest clean spot around the boss instead', () => {
    const tg = arena({ x: 12, y: 6 });
    const me = active(tg);
    me.pos = { x: 5, y: 6 };
    // a puddle on the boss's left side: the straight spot is in it
    const z = zone(tg, { x: 9.6, y: 6 }, { shape: 'circle', radius: 1.3 });
    const r = walkIn(tg, me, z);
    expect(r.at).toBeGreaterThan(0);
    expect(r.inZone).toBe(0);
    expect(Math.abs(me.pos.y - 6)).toBeGreaterThan(0.8); // it stands above or below, not on the left
  });

  it('④ no way around (a wall of fire across the arena): it waits about 1.5 s, then walks in and fights', () => {
    const tg = arena({ x: 18, y: 6 });
    const me = active(tg);
    me.pos = { x: 6, y: 6 };
    const z = zone(tg, { x: 12, y: 0 }, { shape: 'rect', dir: 'down', length: 12, width: 2 });
    // walk up to the wall
    let stoodAt = -1;
    let crossedAt = -1;
    let last = me.pos.x;
    for (let t = 0; t < 20 * 30 && crossedAt < 0; t++) {
      tick(tg.w);
      if (stoodAt < 0 && me.pos.x <= last + 1e-9 && me.pos.x > 8) stoodAt = t / 30; // no closer any more
      if (inZone(z, me)) crossedAt = t / 30;
      last = me.pos.x;
    }
    expect(stoodAt).toBeGreaterThan(0);
    expect(crossedAt - stoodAt).toBeGreaterThan(ZONE_AVOID.patience - 0.2);
    expect(crossedAt - stoodAt).toBeLessThan(ZONE_AVOID.patience + 1);
    expect(walkIn(tg, me, null, 10).at).toBeGreaterThan(0); // through the wall, at the boss
  });

  it('wedged between a stroke and the wall while the slow boss comes closer: it stands about 1.5 s, then goes — no shivering', () => {
    // found by the soft-lock probe (대답하는 연필, 예고 ×0.5): a line of graphite across the arena, a melee character
    // between the line and the bottom wall. Two things kept it there for as long as the line lasted: the boss walking
    // closer counted as its own progress (the patience clock never ran), and a step whose end touched the line's edge
    // was walked back out by rule ① on the next tick, which started the clock again
    const tg = arena({ x: 6.7, y: 9.1 });
    const me = active(tg);
    for (let k = 0; k < 14; k++) zone(tg, { x: 5.7 + k, y: 9 + k * 0.06 }, { shape: 'circle', radius: 0.6 });
    me.pos = { x: 17.9, y: 11.06 };
    let stood = 0;
    let longest = 0;
    let back = 0;
    let last = { ...me.pos };
    for (let t = 0; t < 4 * 30; t++) {
      bossOf(tg).pos.x += 0.8 / 30; // the pencil's pace
      tick(tg.w);
      const moved = Math.hypot(me.pos.x - last.x, me.pos.y - last.y);
      stood = moved < 1e-4 ? stood + 1 / 30 : 0;
      longest = Math.max(longest, stood);
      if (me.pos.x > last.x + 1e-4) back++; // a step away from the boss
      last = { ...me.pos };
    }
    expect(longest).toBeGreaterThan(0.5); // the test really wedges it …
    expect(longest).toBeLessThan(ZONE_AVOID.patience + 0.2); // … for its patience only
    expect(back).toBeLessThan(3); // and it never steps in and out
    expect(me.pos.x).toBeLessThan(14); // 4 s later it is well on its way to the boss
  });

  it('⑤ melee, and the boss stands in the middle of a ring of fire: it walks in at once (no 1.5 s wait)', () => {
    const tg = arena({ x: 12, y: 6 });
    const me = active(tg);
    me.pos = { x: 4, y: 6 };
    zone(tg, { x: 12, y: 6 }, { shape: 'ring', inner: 0.2, outer: 4.5 });
    const free = arena({ x: 12, y: 6 });
    active(free).pos = { x: 4, y: 6 };
    const a = walkIn(tg, me, null);
    const b = walkIn(free, active(free), null);
    expect(a.at).toBeGreaterThan(0);
    expect(a.at).toBeLessThan(b.at + 0.5);
  });

  it('never trapped: the whole floor on fire → it gives up looking for a way out and simply fights', () => {
    const tg = arena({ x: 14, y: 6 });
    const me = active(tg);
    me.pos = { x: 8, y: 6 };
    zone(tg, { x: 12, y: 6 }, { shape: 'circle', radius: 30 });
    expect(walkIn(tg, me, null, 12).at).toBeGreaterThan(0);
  });

  it('a ranged character keeps its distance and shoots from outside the puddle', () => {
    const tg = arena({ x: 18, y: 6 }, [MAGE]);
    const me = active(tg);
    me.pos = { x: 4, y: 6 };
    const z = zone(tg, { x: 11, y: 6 }, { shape: 'circle', radius: 2.5 });
    const r = walkIn(tg, me, z);
    expect(r.at).toBeGreaterThan(0);
    expect(r.inZone).toBe(0);
  });

  it('warnings are not zones: a character walks straight through a red telegraph (that is what swapping is for)', () => {
    const tg = arena({ x: 18, y: 6 });
    const me = active(tg);
    me.pos = { x: 6, y: 6 };
    const b = bossOf(tg);
    startAction(tg.w, unitCtx(tg.w, b, 'syn_tele', '시험 예고'), { ...arenaAt(12, 6), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 30, effects: [{ kind: 'damage', amount: 0.1 }] });
    let through = false;
    for (let t = 0; t < 8 * 30; t++) {
      tick(tg.w);
      if (Math.hypot(me.pos.x - 12, me.pos.y - 6) < 1) through = true;
    }
    expect(through).toBe(true);
  });

  it('an ally field (a heal circle) and a zone about to end are not walked around', () => {
    const tg = arena({ x: 18, y: 6 });
    const me = active(tg);
    me.pos = { x: 6, y: 6 };
    const z = zone(tg, { x: 12, y: 6 }, { shape: 'circle', radius: 2 });
    z.remaining = 0.3; // gone before it gets there
    z.total = 0.3;
    z.team = 'ally';
    advance(tg, 0.1);
    z.remaining = 30;
    let through = false;
    for (let t = 0; t < 8 * 30; t++) {
      tick(tg.w);
      if (Math.hypot(me.pos.x - 12, me.pos.y - 6) < 1) through = true;
    }
    expect(through).toBe(true);
  });
});

describe('the crowd rule: a spot an ally stands on is not a spot', () => {
  it('two melee characters in one line with the boss: the one behind takes another spot and both hit it', () => {
    const tg = arena({ x: 12, y: 6 }, [HUMAN, { ...HUMAN, name: '둘' }]);
    const [a, b] = [active(tg, 0), active(tg, 1)];
    a.pos = { x: 8, y: 6 };
    b.pos = { x: 6.5, y: 6 }; // straight behind a
    clearEvents(tg);
    const hit = new Set<number>();
    for (let t = 0; t < 10 * 30 && hit.size < 2; t++) {
      tick(tg.w);
      for (const e of tg.game.drainEvents()) if (e.type === 'attack' && e.targetId === bossOf(tg).id) hit.add(e.sourceId);
    }
    expect([...hit].sort()).toEqual([a.id, b.id].sort());
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(0.7);
  });

  it('it holds for a character that gave up on the zones too (④): the whole floor on fire, two in a line → both still hit', () => {
    // found by the soft-lock probe at 보스 범위 크기 배율 ×2: the one behind pushed into the other's back while it "fought where it stood"
    const tg = arena({ x: 12, y: 6 }, [HUMAN, { ...HUMAN, name: '둘' }]);
    const [a, b] = [active(tg, 0), active(tg, 1)];
    a.pos = { x: 8, y: 6 };
    b.pos = { x: 6.5, y: 6 };
    zone(tg, { x: 12, y: 6 }, { shape: 'circle', radius: 30 });
    clearEvents(tg);
    const hit = new Set<number>();
    for (let t = 0; t < 10 * 30 && hit.size < 2; t++) {
      tick(tg.w);
      for (const e of tg.game.drainEvents()) if (e.type === 'attack' && e.targetId === bossOf(tg).id) hit.add(e.sourceId);
    }
    expect([...hit].sort()).toEqual([a.id, b.id].sort());
  });
});

describe('a body that never yields, head-on in the way (a fake window between the character and the real screen)', () => {
  /** A character at `from` held on the boss at (19, 3.5), a 가짜 창 on the desk at (5, 3.5); seconds until its first hit. */
  function reach(from: Vec2): number {
    const tg = arena({ x: 19, y: 3.5 });
    const me = active(tg);
    const b = bossOf(tg);
    me.pos = { ...from };
    me.targetId = b.id; // it was already fighting the boss when the window appeared (a held target stays)
    const fake = spawnAt(tg, 'fake_monitor', { x: 5, y: 3.5 });
    fake.rt.skillCds = fake.rt.skillCds.map(() => 9999);
    fake.rt.attackCd = 9999;
    clearEvents(tg);
    for (let t = 0; t < 12 * 30; t++) {
      tick(tg.w);
      if (tg.game.drainEvents().some(d => d.type === 'attack' && d.sourceId === me.id && d.targetId === b.id)) return (t + 1) / 30;
    }
    return -1;
  }

  it('dead centre: it steps aside, slides around the window and reaches the boss (it used to lean on it for good)', () => {
    const at = reach({ x: 2.5, y: 3.5 });
    expect(at).toBeGreaterThan(0);
    // not much slower than a character that starts beside the line
    const beside = reach({ x: 2.5, y: 5.5 });
    expect(beside).toBeGreaterThan(0);
    expect(at).toBeLessThan(beside + 2);
  });

  it('same seed, same walk (no randomness in the side it takes)', () => {
    expect(reach({ x: 2.5, y: 3.5 })).toBe(reach({ x: 2.5, y: 3.5 }));
  });
});

describe('the classic tower is untouched', () => {
  it('on a classic boss floor the same puddle is walked straight through, and two characters in a line stay in a line', () => {
    const tg = makeGame({ seed: 5, startFloor: 5, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    expect(tg.w.bossRaid).toBeUndefined();
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    boss.rt.skillCds = boss.rt.skillCds.map(() => 9999);
    boss.rt.attackCd = 9999;
    advance(tg, 0.6);
    const me = active(tg);
    me.pos = { x: 12, y: 11 };
    const part: SkillAction = { center: 'self', offset: { x: 0, y: 7.2 }, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.1 }], zone: { duration: 30, tickInterval: 0.5 } };
    startAction(tg.w, unitCtx(tg.w, boss, 'syn_zone', '시험 장판'), part); // a puddle at (12, 6), between it and the boss
    const z = tg.w.state.zones[tg.w.state.zones.length - 1];
    expect(z.center).toEqual({ x: 12, y: 6 });
    let inside = 0;
    for (let t = 0; t < 8 * 30; t++) {
      tick(tg.w);
      if (inZone(z, me)) inside++;
      expect(Math.abs(me.pos.x - 12)).toBeLessThan(1e-6); // a straight line up, as always
    }
    expect(inside).toBeGreaterThan(30);
    expect(me.rt.avoid).toBeUndefined();
  });
});
