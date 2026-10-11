// 기획 20차 점검 (the review of the boss forms — docs/balance.md 19-9): the sim rules the fix pass added.
//   · a melee character trailing a body that walks away swings on the tick its step reaches it (달 · 에스컬레이터)
//   · rule N9 안전한 자리 지키기: dropped in the safe cell / on the glowing word, a character stays there until it lands
//   · a character that gave up on the zones stays on the chase until it stands in reach (the `commit` seconds run there)
//   · an `axis` mover lines up against where it CAN stand (a target hugging a side wall)
//   · a mark (bound part) goes to a character, never to a pet / summon the boss happens to hold
//   · 번호 없는 서랍's cells keep their size under the area knob
// None of it reaches the classic tower / 원정 (units.ts: only a target with rt.form, only w.bossRaid).
import { describe, expect, it } from 'vitest';
import { getBoss, getMonster } from '../../src/data';
import { BOSS_FORM, SAFE_HOLD, arenaAt, safeRing } from '../../src/data/bosses';
import { unitCtx } from '../../src/sim/ctx';
import { createUnit } from '../../src/sim/entities';
import { tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { startAction } from '../../src/sim/skills';
import type { SimEntity } from '../../src/sim/world';
import type { AreaShape, MonsterSkill, PlayerSetup, SkillAction, Telegraph, Tunables, Vec2 } from '../../src/types';
import { HUMAN, active, advance, clearEvents, eventsOf, makeGame, type TestGame } from './helpers';
import { bossOf, raidGame } from './bossRaidHelpers';

const CALM: Partial<Tunables> = { invincible: true, bossGroggyThreshold: 0 };
const seat = (...characters: string[]): PlayerSetup => ({ ...HUMAN, characters });

/** A fight against `id` whose boss casts nothing by itself: it only walks, turns and swings. Past its entrance pose. */
function quiet(id: string, players: PlayerSetup[] = [HUMAN], tunables: Partial<Tunables> = CALM): TestGame {
  const tg = raidGame(id, { hpMult: 80, players, tunables });
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
  advance(tg, BOSS_FORM.entrance + 0.1);
  clearEvents(tg);
  return tg;
}

/** The boss stands where it is and never swings. */
function freeze(tg: TestGame, at?: Vec2): SimEntity {
  const b = bossOf(tg);
  if (at) b.pos = { ...at };
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
  return b;
}

function skillOf(bossId: string, skillId: string): MonsterSkill {
  const def = getBoss(bossId);
  const sk = [...def.skills, ...(def.phases ?? []).flatMap(p => p.skills ?? [])].find(s => s.id === skillId);
  if (!sk) throw new Error(`${bossId} has no ${skillId}`);
  return sk;
}

/** Cast every part of one of the boss's skills by hand (variant 0 = action / extra, 1… = cycle). */
function cast(tg: TestGame, bossId: string, skillId: string, target?: SimEntity, variant = 0): void {
  const b = bossOf(tg);
  if (target) b.targetId = target.id;
  const sk = skillOf(bossId, skillId);
  const v = variant === 0 ? sk : sk.cycle![variant - 1];
  const ctx = unitCtx(tg.w, b, sk.id, sk.name);
  [v.action, ...(v.extra ?? [])].forEach((a, i) => startAction(tg.w, ctx, a, undefined, i));
}

const teles = (tg: TestGame): Telegraph[] => tg.w.state.telegraphs.filter(t => t.team === 'enemy');
const inside = (t: Telegraph, e: SimEntity): boolean => hitsArea(t.area, t.center, t.origin, e.pos, e.radius);
const swingsOf = (tg: TestGame, e: SimEntity): number => eventsOf(tg, 'attack').filter(a => a.sourceId === e.id).length;

function swapTo(tg: TestGame, index: number, pos: Vec2): SimEntity {
  expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: index, pos }).ok).toBe(true);
  return active(tg);
}

/** Run until no enemy warning is left; false as soon as `e` stands in one. */
function staysClear(tg: TestGame, e: SimEntity, maxSec = 6): boolean {
  for (let t = 0; t < maxSec * 30 && teles(tg).length > 0; t++) {
    if (teles(tg).some(x => inside(x, e))) return false;
    tick(tg.w);
  }
  return teles(tg).length === 0;
}

describe('a melee character trailing a body that walks away', () => {
  // blade: 1.4 swings a second. Before the fix it landed about 0.5 a second on the moon — every tick it walked the
  // last 0.02 cells into reach, returned, and the moon had drifted out again.
  for (const id of ['inverted_moon', 'reverse_escalator']) {
    it(`${id}: a blade right behind the walking core lands at least 11 swings in 10 s`, () => {
      const tg = quiet(id, [seat('blade', 'guardian', 'mage')]);
      const b = bossOf(tg);
      b.rt.attackCd = 9999;
      const me = active(tg);
      expect(b.rt.form).toBeDefined();
      me.pos = { x: Math.max(1, b.pos.x - 2.6), y: b.pos.y };
      advance(tg, 1); // close in
      clearEvents(tg);
      const from = { ...b.pos };
      advance(tg, 10);
      expect(Math.hypot(b.pos.x - from.x, b.pos.y - from.y)).toBeGreaterThan(3); // it did walk
      expect(swingsOf(tg, me)).toBeGreaterThanOrEqual(11);
    });
  }

  it('the classic tower: a boss without a form never takes the new path (no rt.form on its floor)', () => {
    const tg = makeGame({ seed: 5, startFloor: 5, tunables: CALM });
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    expect(boss.rt.form).toBeUndefined();
    expect(tg.w.bossRaid).toBeUndefined();
  });
});

describe('rule N9: 안전한 자리 지키기 (보스 레이드)', () => {
  it('SAFE_HOLD is on and reads the safe rings (outer ≥ 20) — the same edge the bots and the renderer use', () => {
    expect(SAFE_HOLD).toEqual({ on: true, safeOuter: 20 });
    expect((safeRing(3) as { outer: number }).outer).toBeGreaterThanOrEqual(SAFE_HOLD.safeOuter);
  });

  for (const ch of ['blade', 'ranger', 'cleric']) {
    it(`번호 없는 서랍 「번호 순서」: a ${ch} dropped in the middle of the unnumbered cell right at the cast stays in it — never hit`, () => {
      const tg = quiet('morgue_drawers', [seat('mage', ch, 'guardian')], { bossGroggyThreshold: 0, monsterDmgMult: 0.01 });
      freeze(tg);
      const mage = active(tg);
      mage.pos = { x: 5, y: 6 };
      cast(tg, 'morgue_drawers', 'md_order', mage);
      advance(tg, 0.1);
      const fresh = swapTo(tg, 1, { x: 18, y: 10 });
      expect(staysClear(tg, fresh)).toBe(true);
      // every cell has opened: it goes for the boss again
      const at = { ...fresh.pos };
      advance(tg, 2);
      expect(Math.hypot(fresh.pos.x - at.x, fresh.pos.y - at.y) > 0.5 || swingsOf(tg, fresh) > 0).toBe(true);
    });
  }

  for (const [ch, variant, word] of [['blade', 0, '예'], ['ranger', 1, '아니오']] as const) {
    it(`대답하는 연필 「대답」: a ${ch} dropped on 「${word}」 at the cast waits on the word while the pencil is far away`, () => {
      const tg = quiet('answering_pencil', [seat('mage', ch, 'guardian')], { bossGroggyThreshold: 0, monsterDmgMult: 0.01 });
      freeze(tg, variant === 0 ? { x: 19, y: 8 } : { x: 5, y: 8 }); // the pencil stands by the OTHER word
      const mage = active(tg);
      mage.pos = { x: 12, y: 10 };
      cast(tg, 'answering_pencil', 'ap_answer', mage, variant);
      const hole = teles(tg)[0];
      expect(hole.area).toMatchObject({ shape: 'ring', outer: 30 });
      const fresh = swapTo(tg, 1, { ...hole.center });
      advance(tg, 0.4); // its drag skill plays out first (a blade dashes in from the side — invulnerable as it appears)
      expect(staysClear(tg, fresh)).toBe(true);
      advance(tg, 3);
      expect(Math.hypot(fresh.pos.x - hole.center.x, fresh.pos.y - hole.center.y)).toBeGreaterThan(1); // then it walks on
    });
  }

  it('거꾸로 뜬 달 「월식」: the called character itself does not walk out of its own moonlight', () => {
    const tg = quiet('inverted_moon', [seat('blade', 'guardian', 'mage')], { bossGroggyThreshold: 0, monsterDmgMult: 0.01 });
    freeze(tg, { x: 18, y: 4 });
    const me = active(tg);
    me.pos = { x: 6, y: 9 };
    cast(tg, 'inverted_moon', 'im_eclipse', me);
    expect(staysClear(tg, me)).toBe(true);
  });

  it('a character already standing in a held warning is not frozen there: it walks on through it as always', () => {
    const tg = quiet('washer_drum', [seat('blade', 'guardian', 'mage')]);
    const b = freeze(tg, { x: 18, y: 6 });
    const me = active(tg);
    me.pos = { x: 6, y: 6 };
    const part: SkillAction = { ...arenaAt(7, 6), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 30, keepOut: true, effects: [{ kind: 'damage', amount: 0.1 }] };
    startAction(tg.w, unitCtx(tg.w, b, 'syn_tele', '시험 예고'), part);
    advance(tg, 3);
    expect(me.pos.x).toBeGreaterThan(12);
  });

  it('an ordinary warning is walked into as always (only safe-spot parts are held)', () => {
    const tg = quiet('washer_drum', [seat('blade', 'guardian', 'mage')]);
    const b = freeze(tg, { x: 18, y: 6 });
    const me = active(tg);
    me.pos = { x: 6, y: 6 };
    const part: SkillAction = { ...arenaAt(12, 6), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 30, effects: [{ kind: 'damage', amount: 0.1 }] };
    startAction(tg.w, unitCtx(tg.w, b, 'syn_tele', '시험 예고'), part);
    advance(tg, 2);
    expect(me.pos.x).toBeGreaterThan(10.5);
    // the same circle flagged keepOut: it stops at the rim
    const held = quiet('washer_drum', [seat('blade', 'guardian', 'mage')]);
    const hb = freeze(held, { x: 18, y: 6 });
    const him = active(held);
    him.pos = { x: 6, y: 6 };
    startAction(held.w, unitCtx(held.w, hb, 'syn_tele', '시험 예고'), { ...part, keepOut: true });
    advance(held, 4);
    expect(him.pos.x).toBeLessThan(10 - him.radius + 0.01);
    expect(him.pos.x).toBeGreaterThan(9);
  });

  it('the classic tower: a safe ring holds nobody (the character walks out of the hole toward the boss)', () => {
    const tg = makeGame({ seed: 5, startFloor: 5, tunables: CALM });
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    boss.rt.skillCds = boss.rt.skillCds.map(() => 9999);
    boss.rt.attackCd = 9999;
    advance(tg, 0.6);
    const me = active(tg);
    me.pos = { x: 12, y: 11 };
    const ring: AreaShape = safeRing(1.5);
    startAction(tg.w, unitCtx(tg.w, boss, 'syn_ring', '시험 고리'), { center: 'self', offset: { x: 0, y: 12.2 }, area: ring, affects: 'enemies', delay: 30, effects: [{ kind: 'damage', amount: 0.1 }] });
    advance(tg, 2);
    expect(me.pos.y).toBeLessThan(11 - 1.5);
  });
});

describe('a character that gave up on the zones (rule N8 ④) stays on the chase', () => {
  it('a strip of fire along the bottom wall, the boss 16 cells down it: it never steps back out of the strip and gets there', () => {
    const tg = quiet('washer_drum', [seat('blade', 'guardian', 'mage')]);
    const b = freeze(tg, { x: 21.5, y: 10 });
    const me = active(tg);
    me.pos = { x: 2, y: 10 };
    const strip: SkillAction = { ...arenaAt(0, 10), area: { shape: 'rect', dir: 'right', length: 24, width: 4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.1 }], zone: { duration: 30, tickInterval: 0.5 } };
    startAction(tg.w, unitCtx(tg.w, b, 'syn_zone', '시험 장판'), strip);
    me.rt.avoid = { side: 0, clear: 0, stuck: 0, best: Infinity, commit: 3, seen: null, seenId: 0 }; // it has just given up
    clearEvents(tg);
    let hitAt = -1;
    for (let t = 0; t < 10 * 30 && hitAt < 0; t++) {
      const x = me.pos.x;
      tick(tg.w);
      expect(me.pos.x).toBeGreaterThanOrEqual(x - 1e-9); // never back
      expect(Math.abs(me.pos.y - 10)).toBeLessThan(0.6); // never out of the strip sideways
      if (tg.game.drainEvents().some(d => d.type === 'damage' && d.targetId === b.id)) hitAt = t / 30;
    }
    expect(hitAt).toBeGreaterThan(3); // the walk is longer than the old 3 s of commit
    expect(me.rt.avoid!.commit).toBeGreaterThan(2.8); // … and the seconds only started when it got there
  });
});

describe('an axis mover and a target hugging the side wall (인형 뽑기 기계)', () => {
  it('the character stands at x 0.7 (the box ends at 2): the machine counts x as lined up at the wall and comes down', () => {
    const tg = quiet('claw_machine');
    const b = bossOf(tg);
    const me = active(tg);
    me.pos = { x: 0.7, y: 11.3 };
    me.rt.lockTime = 9999;
    b.pos = { x: 6, y: 3 };
    clearEvents(tg);
    advance(tg, 8);
    expect(b.pos.x).toBeLessThanOrEqual(BOSS_FORM.box.xMin + BOSS_FORM.axisSnap + 1e-6);
    expect(b.pos.y).toBeGreaterThan(4.5);
    expect(swingsOf(tg, b)).toBeGreaterThan(0);
  });

  it('its throw is 3 cells: from its own row it no longer reaches the whole arena', () => {
    expect(getBoss('claw_machine').stats.range).toBe(3);
  });

  it('axisAlternate: x leads on the first pick and the first re-pick, y on the second re-pick, x again on the third', () => {
    expect(getBoss('claw_machine').move).toMatchObject({ axis: true, axisAlternate: true, retarget: 6 });
    const lead = (repicks: number): 'x' | 'y' => {
      const tg = quiet('claw_machine');
      const b = bossOf(tg);
      const me = active(tg);
      me.pos = { x: 18, y: 9 };
      me.rt.lockTime = 9999;
      b.pos = { x: 6, y: 4 };
      b.targetId = me.id;
      b.rt.form!.retargets = repicks;
      b.rt.form!.retargetIn = 9999;
      const from = { ...b.pos };
      advance(tg, 0.5);
      expect(Math.abs(b.pos.x - from.x) < 1e-9 || Math.abs(b.pos.y - from.y) < 1e-9, 'one axis at a time').toBe(true);
      return Math.abs(b.pos.x - from.x) > 1e-9 ? 'x' : 'y';
    };
    expect([0, 1, 2, 3, 4].map(lead)).toEqual(['x', 'x', 'y', 'x', 'y']);
  });
});

describe('a mark is for a character (rule N6)', () => {
  it('끝나지 않는 회의 「발표 지명」 cast while the boss holds a turret: the nearest character is marked, and swapping it out clears the mark', () => {
    const tg = quiet('endless_meeting', [HUMAN], { bossGroggyThreshold: 0, monsterDmgMult: 0.01 });
    const b = freeze(tg);
    const me = active(tg);
    me.pos = { x: 8, y: 8 };
    me.rt.lockTime = 9999;
    const turret = createUnit(tg.w, getMonster('turret'), { x: b.pos.x + 2.5, y: b.pos.y }, 'ally', { kind: 'summon', ownerPlayer: 0, expiresIn: 10, hpMult: 1, atkMult: 1 });
    cast(tg, 'endless_meeting', 'em_call', turret);
    expect(teles(tg).map(t => t.mark)).toEqual([me.id, me.id]);
    clearEvents(tg);
    swapTo(tg, 2, { x: 8, y: 8 });
    advance(tg, 0.1);
    expect(teles(tg)).toHaveLength(0);
    expect(eventsOf(tg, 'markClear').map(e => e.targetId)).toEqual([me.id]);
  });
});

describe('번호 없는 서랍: the cells stay on their grid under 「보스 범위 크기 배율」', () => {
  for (const mult of [0.5, 1.5, 2]) {
    it(`×${mult}: the five cells are still 12 × 4 and the unnumbered one is whole`, () => {
      const tg = quiet('morgue_drawers', [HUMAN], { ...CALM, bossAreaMult: mult });
      freeze(tg);
      cast(tg, 'morgue_drawers', 'md_order', active(tg));
      const t = teles(tg);
      expect(t).toHaveLength(5);
      for (const x of t) expect(x.area).toMatchObject({ shape: 'rect', length: 12, width: 4 });
      // a body anywhere well inside the bottom-right cell is touched by none of them
      for (const p of [{ x: 13, y: 8.6 }, { x: 18, y: 10 }, { x: 23, y: 11.4 }]) {
        expect(t.some(x => hitsArea(x.area, x.center, x.origin, p, 0.45))).toBe(false);
      }
    });
  }

  it('another boss still follows the knob (a moon ring keeps its hole, a circle grows)', () => {
    const tg = quiet('tank_dweller', [HUMAN], { ...CALM, bossAreaMult: 1.5 });
    freeze(tg);
    cast(tg, 'tank_dweller', 'td_hair', active(tg));
    expect(teles(tg)[0].area).toMatchObject({ shape: 'ring', outer: 13.5 });
  });
});

describe('물탱크의 주인 「잠수」: the puddle leaves the melee spots clear', () => {
  it('radius 2: a melee character at arm’s length (body 1.6 + 0.45 + reach 0.6) stands outside it', () => {
    const parts = [skillOf('tank_dweller', 'td_dive').action, ...(skillOf('tank_dweller', 'td_dive').extra ?? [])];
    const puddle = parts.find(p => !!p.zone)!;
    expect(puddle.area).toEqual({ shape: 'circle', radius: 2 });
    const def = getBoss('tank_dweller');
    const standAt = def.radius + 0.45 + 0.6;
    expect(standAt).toBeGreaterThan(2 + 0.45);
  });
});
