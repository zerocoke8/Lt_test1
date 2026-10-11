// 기획 19차 보스 레이드 — the four rules the new bosses lean on (docs/bosses.md 3장), with synthetic skills so the tests
// do not wait for the boss data:
//   M1 boss self-cast (new code): a boss's delayed part on itself shows a `self` telegraph that is no danger and is
//      broken by groggy; M2 telegraphLead on a monster skill; M3 pull / knock-back on characters, pull on zone ticks;
//   M4 a summon at its part's offset. Plus the shapes the table uses: ring zones, a ring that covers the arena, root.
// And the two boss knobs of docs/boss-raid.md 4-2 (보스 예고 시간 배율 · 보스 범위 크기 배율) over all 20 bosses' real skills:
// what they scale, what they leave alone, and that nothing but a tier-'boss' enemy is touched.
import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { BOSS_POS } from '../../src/config';
import { BOSSES } from '../../src/data';
import { at, row, seq } from '../../src/data/bosses';
import { unitCtx } from '../../src/sim/ctx';
import { hitsArea, scaleArea } from '../../src/sim/geometry';
import { tick } from '../../src/sim/game';
import { findJustThreats, justCue, justParams, justWindow } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import { hasStatus, statusValue } from '../../src/sim/status';
import type { SimEntity } from '../../src/sim/world';
import type { AreaShape, GameEvent, MonsterSkill, SkillAction, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, makeGame, spawnAt, type TestGame } from './helpers';
import { allSkills, bossOf, killBoss, partsOf, raidGame } from './bossRaidHelpers';

const CALM = { invincible: true } as const;

/** A raid fight whose boss only knows `skills` (the first is cast within 0.1 s of the return), with a huge HP pool. */
function fight(skills: MonsterSkill[], players = [HUMAN]): TestGame {
  const tg = raidGame('elevator_keeper', { hpMult: 200, players, tunables: CALM });
  const b = bossOf(tg);
  b.rt.skills = skills;
  b.rt.skillCds = skills.map(s => s.initialDelay ?? 0.25);
  b.rt.phase = 99; // no phase skills
  b.rt.skillGap = 0;
  advance(tg, 0.2); // the boss picks its target
  clearEvents(tg);
  return tg;
}

/** Tick until `e` is displaced (not by walking: it is pinned); returns where it was put, before units push apart. */
function whereMoved(tg: TestGame, e: SimEntity, maxSec = 3): Vec2 {
  const from = { ...e.pos };
  for (let t = 0; t < maxSec * 30; t++) {
    tick(tg.w);
    if (Math.hypot(e.pos.x - from.x, e.pos.y - from.y) > 1e-6) return { ...e.pos };
  }
  throw new Error('never moved');
}

/** Hold a character still at a spot (no walking for the rest of the test). */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 999;
}

/** Cast one part straight from the boss at the given target. */
function cast(tg: TestGame, action: SkillAction, target: SimEntity, id = 'syn_part'): void {
  const b = bossOf(tg);
  b.targetId = target.id;
  startAction(tg.w, unitCtx(tg.w, b, id, '시험'), action);
}

const selfRing: AreaShape = { shape: 'circle', radius: 3.4 };

describe('M1 boss self-cast', () => {
  const revive: MonsterSkill = { id: 'syn_revive', name: '시험 회복', cooldown: 99, action: { center: 'self', area: selfRing, affects: 'self', delay: 2.5, effects: [{ kind: 'heal', amount: 0.06 }] } };

  it('a delayed self part of a boss shows a `self` telegraph around it, on the wire too; it lands on the boss only', () => {
    const tg = fight([revive]);
    const b = bossOf(tg);
    b.hp = b.maxHp * 0.5;
    advance(tg, 0.2);
    const tele = tg.w.state.telegraphs;
    expect(tele).toHaveLength(1);
    expect(tele[0]).toMatchObject({ team: 'enemy', self: true, area: selfRing });
    expect(tele[0].center).toEqual(BOSS_POS);
    expect(cleanState(tg.w.state).telegraphs[0].self).toBe(true);
    const before = b.hp;
    const partyHp = active(tg).hp;
    advance(tg, 2.6);
    const heals = eventsOf(tg, 'heal').filter(e => e.targetId === b.id);
    expect(heals).toHaveLength(1);
    expect(heals[0].amount).toBeCloseTo(0.06 * b.maxHp, 3);
    expect(b.hp).toBeGreaterThan(before);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(active(tg).hp).toBe(partyHp); // nothing reached the party
  });

  it('is never a danger: no 저스트 cue and no 저스트 threat for a character standing in the ring; a hostile part there is', () => {
    const tg = fight([revive]);
    const me = active(tg);
    pin(me, { x: 12, y: 0.9 });
    advance(tg, 2.2); // 0.3 s before it lands: inside every 저스트 window
    expect(tg.w.state.telegraphs[0].self).toBe(true);
    expect(hitsArea(selfRing, BOSS_POS, BOSS_POS, me.pos, me.radius)).toBe(true);
    expect(justCue(tg.w.state, tg.w.tunables, 0)).toEqual({ danger: false, now: false, landIn: null });
    expect(findJustThreats(tg.w, tg.w.state.players[0], me)).toEqual([]);

    const hostile: MonsterSkill = { ...revive, id: 'syn_hit', action: { ...revive.action, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] } };
    const tg2 = fight([hostile]);
    const me2 = active(tg2);
    pin(me2, { x: 12, y: 0.9 });
    advance(tg2, 2.2);
    expect(tg2.w.state.telegraphs[0].self).toBeUndefined();
    expect(justCue(tg2.w.state, tg2.w.tunables, 0).danger).toBe(true);
    expect(justCue(tg2.w.state, tg2.w.tunables, 0).now).toBe(true);
    expect(findJustThreats(tg2.w, tg2.w.state.players[0], me2)).toHaveLength(1);
  });

  it('groggy during the wind-up breaks it: no heal, the ring is gone, an interrupt is emitted', () => {
    const tg = fight([revive]);
    const b = bossOf(tg);
    b.hp = b.maxHp * 0.5;
    advance(tg, 1);
    expect(tg.w.state.telegraphs).toHaveLength(1);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(tg, 3);
    expect(eventsOf(tg, 'heal').filter(e => e.targetId === b.id)).toHaveLength(0);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(eventsOf(tg, 'interrupt').some(e => e.sourceId === b.id)).toBe(true);
  });

  it('shield + haste on itself (회의 연장) and a self part after a hit (간주: vulnerable on the boss)', () => {
    const extend: MonsterSkill = {
      id: 'syn_extend', name: '시험 연장', cooldown: 99,
      action: { center: 'self', area: selfRing, affects: 'self', delay: 0.8, effects: [{ kind: 'shield', amount: 0.08, duration: 8 }, { kind: 'status', status: 'haste', duration: 8, value: 0.25 }] },
    };
    const tg = fight([extend]);
    const b = bossOf(tg);
    advance(tg, 1.2);
    expect(b.shield).toBeGreaterThan(0);
    expect(b.shield).toBeLessThanOrEqual(0.08 * b.maxHp + 1e-6);
    expect(statusValue(b, 'haste')).toBeCloseTo(0.25, 6);

    const note: MonsterSkill = {
      id: 'syn_note', name: '시험 고음', cooldown: 99,
      ...seq([
        { center: 'target', area: { shape: 'fan', radius: 14, angle: 40 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 3 }] },
        { center: 'self', area: selfRing, affects: 'self', delay: 1.6, effects: [{ kind: 'status', status: 'vulnerable', duration: 4, value: 0.3 }] },
      ]),
    };
    const tg2 = fight([note]);
    const b2 = bossOf(tg2);
    advance(tg2, 0.2);
    expect(tg2.w.state.telegraphs.map(t => !!t.self)).toEqual([false, true]);
    advance(tg2, 1.6);
    expect(statusValue(b2, 'vulnerable')).toBeCloseTo(0.3, 6);
    advance(tg2, 3.5);
    expect(hasStatus(b2, 'vulnerable')).toBe(true);
    advance(tg2, 1);
    expect(hasStatus(b2, 'vulnerable')).toBe(false);
  });

  it('only a boss: a mid boss or a normal monster casting on itself keeps a plain telegraph', () => {
    const tg = fight([]);
    for (const id of ['ogre', 'slime']) {
      const m = spawnAt(tg, id, { x: 6, y: 6 });
      m.targetId = active(tg).id;
      startAction(tg.w, unitCtx(tg.w, m, 'syn_self', '시험'), { center: 'self', area: { shape: 'circle', radius: 1 }, affects: 'self', delay: 1, effects: [{ kind: 'heal', amount: 0.1 }] });
    }
    expect(tg.w.state.telegraphs).toHaveLength(2);
    for (const t of tg.w.state.telegraphs) expect('self' in t).toBe(false);
  });
});

describe('M2 short warning (telegraphLead on a monster skill)', () => {
  it('delay 1.5 with lead 0.9: nothing for 0.6 s, then a 0.9 s telegraph that follows the target; the 저스트 window stays 0.5 s', () => {
    const bolt: MonsterSkill = { id: 'syn_bolt', name: '시험 낙뢰', cooldown: 99, action: { center: 'target', area: { shape: 'single' }, affects: 'enemies', follow: true, delay: 1.5, telegraphLead: 0.9, effects: [{ kind: 'damage', amount: 3.2 }] } };
    const tg = fight([bolt]);
    let castAt = -1;
    let seenAt = -1;
    let hitAt = -1;
    const me = active(tg);
    for (let t = 0; t < 90 && hitAt < 0; t++) {
      tick(tg.w);
      const now = tg.w.state.time;
      for (const e of drain(tg).splice(0) as GameEvent[]) {
        if (e.type === 'skillCast' && e.skillId === 'syn_bolt') {
          castAt = now;
          expect(e.telegraphLead).toBe(0.9);
        }
      }
      const tele = tg.w.state.telegraphs[0];
      if (seenAt < 0 && tele) {
        seenAt = now;
        expect(tele.total).toBeGreaterThan(0.85);
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1e-6);
        expect(justWindow(justParams(tg.w, tg.w.state.players[0]), tele.total)).toBeCloseTo(0.5, 6);
      }
      if (tele) expect(tele.center, 'the warning follows its target').toEqual(me.pos);
      // it lands when its warning runs out (the party is invincible here: no damage event to look for)
      if (seenAt >= 0 && !tele) hitAt = now;
    }
    expect(castAt).toBeGreaterThanOrEqual(0);
    expect(seenAt - castAt).toBeGreaterThan(0.55);
    expect(seenAt - castAt).toBeLessThan(0.7);
    expect(hitAt - castAt).toBeGreaterThan(1.45);
    expect(hitAt - castAt).toBeLessThan(1.6);
  });
});

describe('M3 pull / knock-back on characters', () => {
  it('a ring pull drags a character toward its centre by the distance, never past it (집게 내리기)', () => {
    const tg = fight([], [HUMAN, HUMAN2]);
    const a = active(tg, 0);
    const c = active(tg, 1);
    pin(a, { x: 12, y: 6 });
    pin(c, { x: 15, y: 6 });
    const hp = c.hp;
    cast(tg, { center: 'target', area: { shape: 'ring', inner: 1.6, outer: 4.5 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'pull', distance: 2.5 }] }, a);
    const p1 = whereMoved(tg, c);
    expect(tg.w.state.time).toBeGreaterThan(1.3); // only when the warning ran out
    expect(p1.x).toBeCloseTo(12.5, 6);
    expect(p1.y).toBeCloseTo(6, 6);
    expect(a.pos).toEqual({ x: 12, y: 6 }); // the target stands in the hole of the ring
    expect(c.hp).toBe(hp);
    // a second, longer pull from farther out stops 0.3 short of the centre
    pin(a, { x: 12, y: 6 });
    pin(c, { x: 15.5, y: 6 });
    cast(tg, { center: 'target', area: { shape: 'ring', inner: 1.5, outer: 7 }, affects: 'enemies', delay: 0.5, effects: [{ kind: 'pull', distance: 3.5 }] }, a);
    expect(whereMoved(tg, c).x).toBeCloseTo(12.3, 6);
  });

  it('a zone tick pulls too, at most its distance per tick (배수구: 0.5 a tick)', () => {
    const tg = fight([]);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    const drainZone: SkillAction = { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'pull', distance: 0.5 }], zone: { duration: 4, tickInterval: 0.5 } };
    cast(tg, drainZone, me);
    me.pos = { x: 14.6, y: 6 }; // walked 2.6 away from the spot before it lands
    let prev = me.pos.x;
    let moved = 0;
    for (let t = 0; t < 30 * 5.2; t++) {
      tick(tg.w);
      const step = prev - me.pos.x;
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      expect(step).toBeLessThanOrEqual(0.5 + 1e-9);
      if (step > 1e-9) moved++;
      prev = me.pos.x;
    }
    expect(moved).toBeGreaterThanOrEqual(4);
    expect(me.pos.x).toBeCloseTo(12.3, 6); // stops 0.3 from the centre
    expect(tg.w.state.zones).toHaveLength(0);
  });

  it("knock-back with dir 'down' shoves a character straight down, clamped inside the arena (역주행)", () => {
    const tg = fight([]);
    const me = active(tg);
    pin(me, { x: 9, y: 1.2 });
    const stairs: SkillAction = { center: 'self', offset: row(1.25), area: { shape: 'rect', dir: 'right', length: 24, width: 2.5, anchor: 'start' }, affects: 'enemies', delay: 1, effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'knockback', distance: 1.5, dir: 'down' }] };
    cast(tg, stairs, me);
    advance(tg, 1.1);
    expect(me.pos.x).toBeCloseTo(9, 6);
    expect(me.pos.y).toBeCloseTo(2.7, 6);
    // …into the next row (y 3.75 ± 1.25)
    expect(hitsArea({ shape: 'rect', dir: 'right', length: 24, width: 2.5 }, { x: 0, y: 3.75 }, { x: 0, y: 3.75 }, me.pos, me.radius)).toBe(true);
    pin(me, { x: 9, y: 11.4 });
    cast(tg, { ...stairs, offset: row(11.25) }, me);
    advance(tg, 1.1);
    expect(me.pos.y).toBeLessThanOrEqual(12);
    expect(me.pos.y).toBeGreaterThan(11.4 - 1e-9);
  });
});

describe('M4 summon at the part offset', () => {
  it('three parts of one skill bring one unit each at three fixed spots (팝업 광고)', () => {
    const spots: [number, number][] = [[6, 4], [12, 6], [18, 4]];
    const popups: MonsterSkill = {
      id: 'syn_popups', name: '시험 소환', cooldown: 99,
      ...seq(spots.map(([x, y]) => ({ center: 'self' as const, offset: at(x, y), area: { shape: 'circle' as const, radius: 1 }, affects: 'enemies' as const, effects: [], summon: { unitId: 'goblin', count: 1, duration: 0 } }))),
    };
    const tg = fight([popups]);
    advance(tg, 0.1);
    const spawned = eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss');
    expect(spawned).toHaveLength(3);
    expect(spawned.map(e => [Math.round(e.pos.x * 100) / 100, Math.round(e.pos.y * 100) / 100])).toEqual(spots);
    expect(at(12, -1.2)).toEqual({ x: 0, y: 0 });
  });

  it('a summon at the target and one at the boss in the same skill land on their own spots (달그림자)', () => {
    const tg = fight([]);
    const me = active(tg);
    pin(me, { x: 5, y: 8 });
    cast(tg, { center: 'target', area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [], summon: { unitId: 'goblin', count: 1, duration: 0 } }, me);
    cast(tg, { center: 'self', offset: { x: 0, y: 3 }, area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [], summon: { unitId: 'red_mask', count: 1, duration: 0 } }, me);
    const sp = eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss');
    expect(sp).toHaveLength(2);
    expect(sp[0].pos).toEqual({ x: 5, y: 8 });
    expect(sp[1].pos.x).toBeCloseTo(12, 6);
    expect(sp[1].pos.y).toBeCloseTo(1.8, 6);
  });
});

describe('shapes the boss table uses', () => {
  it('a ring zone keeps its ring footprint: only the band is slowed (넘치는 커피)', () => {
    const tg = fight([], [HUMAN, HUMAN2]);
    const inBand = active(tg, 0);
    const inHole = active(tg, 1);
    pin(inBand, { x: 12, y: 4.3 }); // 5.5 from the boss
    pin(inHole, { x: 12, y: 0.9 }); // 2.1 from the boss
    cast(tg, { center: 'self', area: { shape: 'ring', inner: 4, outer: 7 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.3 }], zone: { duration: 8, tickInterval: 0.5 } }, inBand);
    advance(tg, 1.6);
    const z = tg.w.state.zones;
    expect(z).toHaveLength(1);
    expect(z[0].area).toEqual({ shape: 'ring', inner: 4, outer: 7 });
    expect(z[0].radius).toBe(7);
    advance(tg, 2);
    expect(hasStatus(inBand, 'slow')).toBe(true);
    expect(hasStatus(inHole, 'slow')).toBe(false);
    advance(tg, 7);
    expect(tg.w.state.zones).toHaveLength(0);
  });

  it('a ring 2.6–30 around any spot covers the whole arena but its hole (월식)', () => {
    const ring: AreaShape = { shape: 'ring', inner: 2.6, outer: 30 };
    const r = 0.4;
    for (const c of [{ x: 0.5, y: 0.5 }, { x: 23.5, y: 11.5 }, { x: 12, y: 6 }, { x: 0.5, y: 11.5 }]) {
      for (let x = 0.5; x <= 23.5; x += 1) {
        for (let y = 0.5; y <= 11.5; y += 1) {
          const d = Math.hypot(x - c.x, y - c.y);
          if (d > 2.6 + r + 0.01) expect(hitsArea(ring, c, c, { x, y }, r), `${x},${y} from ${c.x},${c.y}`).toBe(true);
          if (d < 2.6 - r - 0.01) expect(hitsArea(ring, c, c, { x, y }, r)).toBe(false);
        }
      }
    }
  });

  it('root lands on a character (it cannot walk) and never on the boss', () => {
    const tg = fight([]);
    const me = active(tg);
    me.pos = { x: 12, y: 8 };
    cast(tg, { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 0.9, effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'root', duration: 2.5, value: 0 }] }, me);
    advance(tg, 1);
    expect(hasStatus(me, 'root')).toBe(true);
    expect(eventsOf(tg, 'statusApplied').some(e => e.targetId === me.id && e.status === 'root')).toBe(true);
    const spot = { ...me.pos };
    advance(tg, 2);
    expect(me.pos).toEqual(spot);
    advance(tg, 1);
    expect(hasStatus(me, 'root')).toBe(false);
    const b = bossOf(tg);
    startAction(tg.w, unitCtx(tg.w, b, 'syn_selfroot', '시험'), { center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'status', status: 'root', duration: 2, value: 0 }] });
    expect(hasStatus(b, 'root')).toBe(false);
  });

  // ── 기획 19차 review fixes ──

  it('속박 stays on the field: a rooted character that is swapped out keeps no root on its card', () => {
    const tg = fight([]);
    const me = active(tg);
    pin(me, { x: 6, y: 6 });
    cast(tg, { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 0.9, effects: [{ kind: 'status', status: 'root', duration: 2.5, value: 0 }] }, me);
    advance(tg, 1);
    expect(hasStatus(me, 'root')).toBe(true);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 18, y: 8 } }).ok).toBe(true);
    const p = tg.w.state.players[0];
    expect(p.party[0].statuses.some(s => s.id === 'root' || s.id === 'tether')).toBe(false);
    expect(hasStatus(active(tg), 'root')).toBe(false);
  });

  it('속박 ends with the floor: the next floor starts at the start spot, not back on the old pin', () => {
    const tg = raidGame('answering_pencil', { tunables: CALM });
    advance(tg, 0.2);
    const me = active(tg);
    pin(me, { x: 20, y: 9 });
    cast(tg, { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 0.9, effects: [{ kind: 'status', status: 'root', duration: 9, value: 0 }] }, me);
    advance(tg, 1);
    expect(hasStatus(me, 'root')).toBe(true);
    killBoss(tg);
    advance(tg, 0.2);
    expect(tg.w.state.phase).toBe('reward');
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(tg.w.state).toMatchObject({ phase: 'combat', floor: 2 });
    const now = active(tg);
    const start = { ...now.pos };
    expect(hasStatus(now, 'root')).toBe(false);
    tick(tg.w);
    expect(Math.hypot(now.pos.x - start.x, now.pos.y - start.y)).toBeLessThan(0.5);
    expect(Math.hypot(now.pos.x - 20, now.pos.y - 9)).toBeGreaterThan(3);
  });

  it('appear invulnerability shrugs off a boss pull and push in the raid (so a 저스트 교대 really gets out); afterwards they move it again', () => {
    const pull: SkillAction = { center: 'point', area: { shape: 'ring', inner: 1.5, outer: 7 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 3.5 }] };
    const push: SkillAction = { center: 'point', area: { shape: 'rect', length: 24, width: 2.5, dir: 'right' }, affects: 'enemies', effects: [{ kind: 'knockback', distance: 1.5, dir: 'down' }] };
    const tg = fight([]);
    const b = bossOf(tg);
    const fire = (a: SkillAction, point: Vec2) => startAction(tg.w, { ...unitCtx(tg.w, b, 'syn_move', '시험'), point, origin: point }, a);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 16, y: 6 } }).ok).toBe(true);
    const fresh = active(tg);
    pin(fresh, { x: 16, y: 6 });
    expect(fresh.invulnTime).toBeGreaterThan(0);
    fire(pull, { x: 12, y: 6 });
    fire(push, { x: 0, y: 6 });
    expect(fresh.pos).toEqual({ x: 16, y: 6 });
    fresh.invulnTime = 0;
    fire(pull, { x: 12, y: 6 });
    expect(fresh.pos.x).toBeCloseTo(12.5, 6);
    fire(push, { x: 0, y: 6 });
    expect(fresh.pos.y).toBeCloseTo(7.5, 6);
  });

  it('enrage does not speed up a skill the boss casts on itself (회의 연장): its cooldown stays, the attacks get ×0.6', () => {
    const tg = raidGame('endless_meeting', { hpMult: 50, tunables: { ...CALM, bossGroggyThreshold: 0 } });
    advance(tg, 0.3);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
    const b = bossOf(tg);
    const ids = b.rt.skills.map(s => s.id);
    const castOnly = (id: string): number => {
      b.rt.skillGap = 0;
      b.rt.skillCds = ids.map(x => (x === id ? 0 : 99));
      tick(tg.w);
      return b.rt.skillCds[ids.indexOf(id)];
    };
    expect(castOnly('em_extend')).toBeCloseTo(20, 0); // its own 20 s, not 12
    expect(castOnly('em_call')).toBeCloseTo(9 * 0.6, 0);
  });

  it("a boss's one-target warning starts at the boss (the aim line); a normal monster's keeps its old origin", () => {
    const one: SkillAction = { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 1.4, effects: [{ kind: 'damage', amount: 1 }] };
    const tg = fight([]);
    const me = active(tg);
    pin(me, { x: 9, y: 7 });
    cast(tg, one, me);
    expect(tg.w.state.telegraphs.map(t => [t.center, t.origin])).toEqual([[{ x: 9, y: 7 }, BOSS_POS]]);
    const mon = spawnAt(tg, 'red_mask', { x: 15, y: 7 });
    mon.targetId = me.id;
    startAction(tg.w, unitCtx(tg.w, mon, 'syn_one', '시험'), one);
    expect(tg.w.state.telegraphs[1]).toMatchObject({ center: { x: 9, y: 7 }, origin: { x: 9, y: 7 } });
  });

  it('the classic tower keeps its displacement: an invulnerable character is still pushed there (bit-identical runs)', () => {
    const tg = makeGame({ seed: 5 });
    const me = active(tg);
    pin(me, { x: 8, y: 6 });
    me.invulnTime = 1;
    const mon = spawnAt(tg, 'goblin', { x: 6, y: 6 });
    const point = { x: 0, y: 6 };
    startAction(tg.w, { ...unitCtx(tg.w, mon, 'syn_move', '시험'), point, origin: point }, { center: 'point', area: { shape: 'rect', length: 24, width: 2.5, dir: 'right' }, affects: 'enemies', effects: [{ kind: 'knockback', distance: 1.5, dir: 'down' }] });
    expect(me.pos.y).toBeCloseTo(7.5, 6);
  });
});

// ─────────────────────────── 기획 19차 보스 튜닝 (docs/boss-raid.md 4-2) ───────────────────────────

type CastEv = Extract<GameEvent, { type: 'skillCast' }>;
const QUIET: Partial<Tunables> = { invincible: true, bossGroggyThreshold: 0 };
const pub = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'rt' ? undefined : x));

/** One cast of `sk` by a fresh raid boss `id` under `tunables`: its 'skillCast' events (part order) and the warnings up. */
function castOnce(id: string, sk: MonsterSkill, tunables: Partial<Tunables>): { parts: CastEv[]; totals: number[]; tg: TestGame } {
  const tg = raidGame(id, { hpMult: 200, tunables: { ...QUIET, ...tunables } });
  const b = bossOf(tg);
  b.rt.skills = [sk];
  b.rt.skillCds = [0.3];
  b.rt.phase = 99;
  b.rt.skillGap = 0;
  advance(tg, 0.2);
  clearEvents(tg);
  for (let t = 0; t < 60; t++) {
    tick(tg.w);
    const parts = eventsOf(tg, 'skillCast').filter(e => e.sourceId === b.id && e.skillId === sk.id);
    if (parts.length > 0) return { parts, totals: tg.w.state.telegraphs.map(x => x.total).sort((p, q) => p - q), tg };
  }
  throw new Error(`${id}: ${sk.id} was never cast`);
}

describe('보스 예고 시간 배율 (bossTelegraphMult)', () => {
  it('every skill of all 20 bosses: ×2 doubles every part wind-up, short warning and the warnings on screen; nothing else moves', () => {
    for (const def of BOSSES) {
      const data = JSON.stringify(allSkills(def));
      for (const sk of allSkills(def)) {
        const base = castOnce(def.id, sk, {});
        const slow = castOnce(def.id, sk, { bossTelegraphMult: 2 });
        const label = `${def.id} ${sk.id}`;
        expect(base.parts, label).toHaveLength(partsOf(sk).length);
        expect(slow.parts, label).toHaveLength(base.parts.length);
        base.parts.forEach((p, i) => {
          const q = slow.parts[i];
          expect(q.delay ?? 0, `${label} part ${i} delay`).toBeCloseTo((p.delay ?? 0) * 2, 9);
          expect(q.telegraphLead ?? -1, `${label} part ${i} lead`).toBeCloseTo(p.telegraphLead != null ? p.telegraphLead * 2 : -1, 9);
          expect(q.area, `${label} part ${i} area`).toEqual(p.area);
          expect(q.center, `${label} part ${i} center`).toEqual(p.center);
          expect(q.hitInterval, `${label} part ${i} hit interval`).toBe(p.hitInterval);
        });
        expect(slow.totals, `${label} warnings`).toHaveLength(base.totals.length);
        base.totals.forEach((t, i) => expect(slow.totals[i], `${label} warning ${i}`).toBeCloseTo(t * 2, 9));
      }
      expect(JSON.stringify(allSkills(def)), `${def.id}: the data is never rewritten`).toBe(data);
    }
  });

  it('the gaps of a sweep stretch with it: a real sweep keeps its part order, twice as far apart', () => {
    const sweeps = BOSSES.flatMap(def => allSkills(def).map(sk => ({ def, sk }))).filter(x => new Set(partsOf(x.sk).map(a => a.delay ?? 0)).size >= 3);
    expect(sweeps.length).toBeGreaterThan(0);
    for (const { def, sk } of sweeps.slice(0, 6)) {
      const gaps = (ev: CastEv[]) => ev.slice(1).map((e, i) => (e.delay ?? 0) - (ev[i].delay ?? 0));
      const g1 = gaps(castOnce(def.id, sk, {}).parts);
      const g2 = gaps(castOnce(def.id, sk, { bossTelegraphMult: 2 }).parts);
      expect(g1.some(g => Math.abs(g) > 1e-9), sk.id).toBe(true);
      g1.forEach((g, i) => expect(g2[i], `${sk.id} gap ${i}`).toBeCloseTo(g * 2, 9));
    }
  });

  it('in time: a 1.0 / 1.5 / 2.0 s sweep lands at 2 / 3 / 4 s with ×2 and 0.5 / 0.75 / 1 s with ×0.5; the cast pose lasts as long', () => {
    const part = (x: number, delay: number): SkillAction => ({ stage: 'syn', center: 'self', offset: at(x, 6), area: { shape: 'circle', radius: 1.5 }, affects: 'enemies', delay, effects: [{ kind: 'damage', amount: 1 }] });
    const sk: MonsterSkill = { id: 'syn_sweep', name: '시험 쓸기', cooldown: 99, ...seq([part(6, 1), part(12, 1.5), part(18, 2)]) };
    for (const [mult, lands] of [[1, [1, 1.5, 2]], [2, [2, 3, 4]], [0.5, [0.5, 0.75, 1]]] as const) {
      const { tg } = castOnce('elevator_keeper', sk, { bossTelegraphMult: mult });
      const b = bossOf(tg);
      expect(b.anim).toBe('cast');
      expect(b.animTime, `pose at ×${mult}`).toBeGreaterThan(lands[0] - 0.1);
      expect(b.animTime).toBeLessThanOrEqual(lands[0] + 1e-9);
      expect(tg.w.state.telegraphs.map(t => t.total).sort((p, q) => p - q)).toEqual([...lands]);
      const t0 = tg.w.state.tick;
      const seen: number[] = [];
      clearEvents(tg);
      for (let t = 0; t < 30 * 5; t++) {
        tick(tg.w);
        for (const e of eventsOf(tg, 'skillStage')) if (e.skillId === 'syn_sweep') seen.push((tg.w.state.tick - t0) / 30);
        clearEvents(tg);
      }
      expect(seen, `×${mult}`).toHaveLength(3);
      seen.forEach((s, i) => expect(Math.abs(s - lands[i]), `×${mult} part ${i} lands at ${s}`).toBeLessThanOrEqual(2 / 30 + 1e-9));
    }
  });

  it('a short warning (M2 telegraphLead) scales too: 2 s wind-up, last 0.9 s shown → 4 s, last 1.8 s shown', () => {
    const sk: MonsterSkill = { id: 'syn_lead', name: '시험 벼락', cooldown: 99, action: { center: 'target', area: { shape: 'circle', radius: 1.5 }, affects: 'enemies', delay: 2, telegraphLead: 0.9, effects: [{ kind: 'damage', amount: 1 }] } };
    const { tg, parts } = castOnce('elevator_keeper', sk, { bossTelegraphMult: 2 });
    expect(parts[0]).toMatchObject({ delay: 4, telegraphLead: 1.8 });
    expect(tg.w.state.telegraphs).toHaveLength(0);
    advance(tg, 2);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    advance(tg, 0.3);
    expect(tg.w.state.telegraphs).toHaveLength(1);
    expect(tg.w.state.telegraphs[0].total).toBeGreaterThan(1.7);
    expect(tg.w.state.telegraphs[0].total).toBeLessThanOrEqual(1.8 + 1e-9);
  });

  it('cooldowns, first casts and zones keep their time: the boss casts at the same tick, a zone lasts as long', () => {
    for (const id of ['overtime_lord', 'washer_drum', 'tank_dweller']) {
      const first = (tunables: Partial<Tunables>) => {
        const tg = raidGame(id, { hpMult: 200, tunables: { ...QUIET, ...tunables } });
        for (let t = 0; t < 30 * 20; t++) {
          tick(tg.w);
          const ev = eventsOf(tg, 'skillCast').find(e => e.sourceId === tg.w.state.bossId);
          if (ev) return { tick: tg.w.state.tick, skill: ev.skillId };
        }
        throw new Error(`${id} never cast`);
      };
      expect(first({ bossTelegraphMult: 3 }), id).toEqual(first({}));
    }
    const zone: MonsterSkill = { id: 'syn_zone', name: '시험 장판', cooldown: 99, action: { center: 'self', offset: at(12, 6), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 1, effects: [{ kind: 'status', status: 'slow', duration: 0.6, value: 0.3 }], zone: { duration: 4, tickInterval: 0.5 } } };
    const { tg } = castOnce('elevator_keeper', zone, { bossTelegraphMult: 2 });
    advance(tg, 2.1);
    expect(tg.w.state.zones).toHaveLength(1);
    expect(tg.w.state.zones[0].total).toBe(4);
  });
});

describe('보스 범위 크기 배율 (bossAreaMult)', () => {
  it('every skill of all 20 bosses at ×0.5 and ×2: circles, bands and cones scale, a ring keeps its hole, 「한 명」 and the spots stay', () => {
    const seen = new Set<string>();
    for (const def of BOSSES) {
      for (const sk of allSkills(def)) {
        const base = castOnce(def.id, sk, {});
        for (const mult of [0.5, 2]) {
          const tuned = castOnce(def.id, sk, { bossAreaMult: mult });
          const label = `${def.id} ${sk.id} ×${mult}`;
          expect(tuned.parts, label).toHaveLength(base.parts.length);
          base.parts.forEach((p, i) => {
            const q = tuned.parts[i];
            const a = p.area;
            const b = q.area;
            seen.add(a.shape);
            expect(b.shape, label).toBe(a.shape);
            expect(q.center, `${label} part ${i}: the spot stays`).toEqual(p.center);
            expect(q.delay, `${label} part ${i}: the wind-up stays`).toBe(p.delay);
            expect(b, `${label} part ${i}`).toEqual(scaleArea(a, mult));
            if (a.shape === 'circle' && b.shape === 'circle') expect(b.radius).toBeCloseTo(a.radius * mult, 9);
            if (a.shape === 'ring' && b.shape === 'ring') {
              expect(b.outer).toBeCloseTo(a.outer * mult, 9);
              expect(b.inner).toBe(Math.min(a.inner, b.outer));
            }
            if (a.shape === 'rect' && b.shape === 'rect') {
              expect(b.length).toBeCloseTo(a.length * mult, 9);
              expect(b.width).toBeCloseTo(a.width * mult, 9);
              expect(b.dir).toBe(a.dir);
            }
            if (a.shape === 'single') expect(b).toBe(a);
          });
          // the warnings on the floor are the scaled areas (what is drawn is what hits)
          for (const t of tuned.tg.w.state.telegraphs) expect(tuned.parts.some(p => JSON.stringify(p.area) === JSON.stringify(t.area)), `${label} telegraph`).toBe(true);
        }
      }
    }
    for (const shape of ['circle', 'ring', 'rect', 'single']) expect(seen.has(shape), `${shape} is used by a boss`).toBe(true);
  });

  it('what hits is the scaled area: a circle of 2 reaches 3.5 away only at ×2; a zone left behind has the scaled size', () => {
    const sk: MonsterSkill = { id: 'syn_area', name: '시험 원', cooldown: 99, action: { center: 'self', offset: at(12, 6), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 0.8, effects: [{ kind: 'status', status: 'slow', duration: 3, value: 0.3 }] } };
    for (const [mult, hit] of [[1, false], [2, true], [0.5, false]] as const) {
      const { tg } = castOnce('elevator_keeper', sk, { bossAreaMult: mult });
      const me = active(tg);
      pin(me, { x: 15.5, y: 6 });
      advance(tg, 1);
      expect(hasStatus(me, 'slow'), `×${mult}`).toBe(hit);
    }
    const zone: MonsterSkill = { ...sk, id: 'syn_area_zone', action: { ...sk.action, zone: { duration: 4, tickInterval: 0.5 } } };
    const { tg } = castOnce('elevator_keeper', zone, { bossAreaMult: 2 });
    advance(tg, 1);
    expect(tg.w.state.zones[0].radius).toBe(4);
  });
});

describe('보스 튜닝: who it reaches', () => {
  const TUNED: Partial<Tunables> = { bossTelegraphMult: 2.5, bossAreaMult: 0.5, bossRaidHpMult: 3, bossRaidAtkMult: 3 };

  it('only a tier-boss enemy cast carries the knobs: a mid boss, a monster and an ally summon cast as written', () => {
    const tg = makeGame({ seed: 4, startFloor: 5, tunables: { ...QUIET, ...TUNED } });
    const boss = bossOf(tg);
    expect(unitCtx(tg.w, boss, 'x', '')).toMatchObject({ radiusMult: 0.5, delayMult: 2.5 });
    for (const id of ['ogre', 'lich', 'skeleton_archer']) {
      const e = spawnAt(tg, id, { x: 12, y: 6 });
      const ctx = unitCtx(tg.w, e, 'x', '');
      expect(ctx.radiusMult, id).toBe(1);
      expect('delayMult' in ctx, id).toBe(false);
    }
    const plain = makeGame({ seed: 4, startFloor: 5 });
    const ctx = unitCtx(plain.w, bossOf(plain), 'x', '');
    expect(ctx.radiusMult).toBe(1);
    expect('delayMult' in ctx).toBe(false);
  });

  it('a classic normal floor with its mid boss plays tick for tick the same under all four knobs', () => {
    const run = (tunables: Partial<Tunables>) => {
      const tg = makeGame({ seed: 23, startFloor: 4, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2], tunables: { invincible: true, ...tunables } });
      let mid = false;
      let casts = 0;
      let h = 2166136261;
      // floor 4 only: floor 5 is a boss floor, where the telegraph / area knobs do apply
      for (let t = 0; t < 30 * 70 && tg.w.state.phase === 'combat' && tg.w.state.floor === 4; t++) {
        tick(tg.w);
        if (tg.w.state.entities.some(e => e.tier === 'mid')) mid = true;
        casts += eventsOf(tg, 'skillCast').filter(e => e.slot === 'monster' && (e.delay ?? 0) > 0).length;
        clearEvents(tg);
        if (t % 10 !== 0) continue;
        const s = pub(tg.w.state);
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
      }
      return { mid, casts, digest: `${h}:${tg.w.state.tick}` };
    };
    const base = run({});
    expect(base.mid, 'the mid boss came').toBe(true);
    expect(base.casts, 'monsters wound up skills').toBeGreaterThanOrEqual(2);
    expect(run(TUNED)).toEqual(base);
  });

  it('a classic boss floor follows the telegraph and area knobs (every mode), not the raid HP / attack knobs', () => {
    const first = (tunables: Partial<Tunables>) => {
      const tg = makeGame({ seed: 9, startFloor: 10, tunables: { ...QUIET, ...tunables } });
      const hp = bossOf(tg).maxHp;
      for (let t = 0; t < 30 * 20; t++) {
        tick(tg.w);
        const ev = eventsOf(tg, 'skillCast').find(e => e.sourceId === tg.w.state.bossId && (e.delay ?? 0) > 0 && e.area.shape !== 'single');
        if (ev) return { tick: tg.w.state.tick, hp, delay: ev.delay!, area: ev.area };
      }
      throw new Error('no telegraphed cast');
    };
    const base = first({});
    const tuned = first(TUNED);
    expect(tuned.tick).toBe(base.tick);
    expect(tuned.hp).toBe(base.hp);
    expect(tuned.delay).toBeCloseTo(base.delay * 2.5, 9);
    expect(tuned.area).toEqual(scaleArea(base.area, 0.5));
  });

  it('with both knobs away from 1 every boss still runs its whole fight: all base skills cast, no throw, still fighting', () => {
    for (const tunables of [{ bossTelegraphMult: 2, bossAreaMult: 0.5 }, { bossTelegraphMult: 0.5, bossAreaMult: 2 }]) {
      for (const def of BOSSES) {
        const tg = raidGame(def.id, { hpMult: 50, tunables: { ...QUIET, ...tunables } });
        advance(tg, 45);
        const cast = new Set(eventsOf(tg, 'skillCast').filter(e => e.sourceId === tg.w.state.bossId).map(e => e.skillId));
        for (const sk of def.skills) expect(cast.has(sk.id), `${def.id} ${sk.id} at ${JSON.stringify(tunables)}`).toBe(true);
        expect(tg.w.state.phase, def.id).toBe('combat');
      }
    }
  });
});
