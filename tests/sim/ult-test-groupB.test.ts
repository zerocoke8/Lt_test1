// 기획 22차 궁극기 테스트 — 그룹 B (거너 · 클레릭 · 메딕 · 퇴마사 · 바드 · 크로노 · 퍼펫티어)의 전용 조준 / 드래그 궁극기
// (src/data/ultTest/groupB.ts). Each of the 14 is cast for real in a 궁극기 테스트 game against a boss: the alt id is
// what is cast, every part lands where the plan (= the live preview) says, the drag lands within its range and inside
// the arena, and something real happens (damage, heal, status, field, dolls). Then the roaming / arena bosses, the bots
// (조준 and 드래그) and the texts (every number from the data, the tuned phrases present).
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter, getMonster } from '../../src/data';
import { ULT_CAST_TIME, ULT_GROUP_B_IDS, ULT_TEST, setUltAltFixture, ultAlt, type UltAltDef } from '../../src/data/ultTest';
import { GROUP_B } from '../../src/data/ultTest/groupB';
import { createRenderer } from '../../src/render';
import { ARENA_MARGIN } from '../../src/sim/constants';
import { hasStatus } from '../../src/sim/status';
import { botUltAim, planUlt, ultPreviewParts, type UltPlan } from '../../src/sim/ultTest';
import { activeEntity, type SimEntity } from '../../src/sim/world';
import type { AreaShape, Effect, GameEvent, PlayerSetup, RenderUiState, SkillAction, StatusId, UltAimMode, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, clearEvents, drain, makeGame, type TestGame } from './helpers';

const FIXED = 'elevator_keeper'; // top centre (12, −1.2), radius 3, stationary
const ROAMING = 'washer_drum'; // walks the map
const ARENA = 'inverted_moon'; // whole-map stage + a small core

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

const near = (a: Vec2, b: Vec2, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;
const len = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function alt(id: string, mode: 'aim' | 'drag'): UltAltDef {
  const a = ultAlt(id, mode);
  if (!a) throw new Error(`no ${mode} alt for ${id}`);
  return a;
}

function game(charId: string, mode: UltAimMode, opts: { boss?: string; seed?: number; players?: PlayerSetup[]; hpMult?: number } = {}): TestGame {
  const tg = makeGame({
    seed: opts.seed ?? 22,
    mode: 'ultTest',
    players: opts.players ?? [{ ...HUMAN, characters: [charId, 'guardian', 'blade'], ultMode: mode }],
    tunables: { invincible: true },
    bossRaid: { onlyBoss: opts.boss ?? FIXED, hpMult: opts.hpMult ?? 50 },
  });
  advance(tg, 0.5);
  return tg;
}

function me(tg: TestGame): SimEntity {
  return activeEntity(tg.w, tg.w.state.players[0])!;
}

function boss(tg: TestGame): SimEntity {
  return tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
}

/** Put my field character at `at` (and at `hpFrac` of its HP) right before a cast. */
function place(tg: TestGame, at: Vec2, hpFrac = 1): SimEntity {
  const e = me(tg);
  e.pos.x = at.x;
  e.pos.y = at.y;
  e.hp = e.maxHp * hpFrac;
  return e;
}

interface Cast {
  plan: UltPlan;
  from: Vec2;
  /** Where my character stands right after the command (드래그: the landing spot). */
  after: Vec2;
  ult: Ev<'ultCast'>;
  /** The alt's own skillCast events (in action order) and the drag path's (if any). */
  parts: Ev<'skillCast'>[];
  path: Ev<'skillCast'>[];
  events: GameEvent[];
}

/** Charge, plan, cast at `point`; the plan is computed first (the client previews exactly it). */
function cast(tg: TestGame, mode: 'aim' | 'drag', point: Vec2): Cast {
  tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
  clearEvents(tg);
  const aim = { mode, point };
  const plan = planUlt(tg.w.state, 0, aim);
  expect(plan).not.toBeNull();
  const from = { ...me(tg).pos };
  expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
  const after = { ...me(tg).pos };
  const events = drain(tg).slice();
  const ult = events.find((e): e is Ev<'ultCast'> => e.type === 'ultCast' && e.player === 0)!;
  const id = plan!.skill.id;
  const ults = events.filter((e): e is Ev<'skillCast'> => e.type === 'skillCast' && e.slot === 'ult' && e.player === 0);
  return { plan: plan!, from, after, ult, parts: ults.filter(e => e.skillId === id), path: ults.filter(e => e.skillId === `${id}_path`), events };
}

/** The generic checks every alt cast passes: the alt id and name, every part where the plan puts it. */
function expectCastFollowsPlan(c: Cast, def: UltAltDef, mode: 'aim' | 'drag'): void {
  expect(c.ult.skillId).toBe(def.id);
  expect(c.ult.name).toBe(def.name);
  expect(c.ult.aim).toMatchObject({ mode, alt: true, x: c.plan.point.x, y: c.plan.point.y });
  expect(c.plan.alt).toBe(def);
  expect(c.parts).toHaveLength(def.actions.length);
  c.plan.actions.forEach((a, i) => {
    const ev = c.parts[i];
    const base = a.center === 'point' ? c.plan.point : c.plan.caster;
    const want = { x: base.x + (a.offset?.x ?? 0), y: base.y + (a.offset?.y ?? 0) };
    expect(near(ev.center, want, 1e-6), `${def.id} part ${i} (${a.stage}) at ${JSON.stringify(ev.center)}, want ${JSON.stringify(want)}`).toBe(true);
    expect(ev.area, `${def.id} part ${i}`).toEqual(a.area);
    expect(ev.stage).toBe(a.stage);
  });
  if (mode === 'aim') {
    expect(c.after).toEqual(c.from); // 조준 never moves the caster
    expect(c.path).toHaveLength(0);
  } else {
    const max = def.move?.maxRange ?? ULT_TEST.dragRange;
    expect(len(c.from, c.after)).toBeLessThanOrEqual(max + 1e-9);
    expect(near(c.after, c.plan.point, 1e-9)).toBe(true);
    const moveEv = c.events.find(e => (e.type === 'dash' || e.type === 'blink') && e.entityId === c.ult.entityId) as Ev<'dash'> | Ev<'blink'> | undefined;
    expect(moveEv?.type).toBe(def.move?.kind === 'dash' ? 'dash' : 'blink');
    expect(c.path).toHaveLength(def.move?.path && len(c.from, c.after) > 1e-6 ? 1 : 0);
  }
}

function stages(tg: TestGame, skillId: string, stage?: string): Ev<'skillStage'>[] {
  return drain(tg).filter((e): e is Ev<'skillStage'> => e.type === 'skillStage' && e.skillId === skillId && (stage == null || e.stage === stage));
}

/** Damage my ult dealt to enemies since the last clear. */
function ultDamage(tg: TestGame, def: UltAltDef, targetId?: number): number {
  return drain(tg)
    .filter((e): e is Ev<'damage'> => e.type === 'damage' && e.targetTeam === 'enemy' && e.skillName === def.name && (targetId == null || e.targetId === targetId))
    .reduce((s, e) => s + e.amount, 0);
}

function finiteWorld(tg: TestGame): void {
  for (const e of tg.w.state.entities) expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y) && Number.isFinite(e.hp), `entity ${e.id} ${e.defId}`).toBe(true);
}

/** 10 s more of play after a cast: nothing throws, nothing goes NaN, the ult counted once. */
function settle(tg: TestGame): void {
  const t0 = tg.w.state.time;
  expect(() => advance(tg, 10)).not.toThrow();
  expect(tg.w.state.phase).toBe('combat'); // the boss (×50 HP) is still up: the 10 s really ran
  expect(tg.w.state.time - t0).toBeCloseTo(10, 1);
  finiteWorld(tg);
  expect(tg.w.state.players[0].stats.ultsUsed).toBe(1);
}

const unit = (a: Vec2, b: Vec2): Vec2 => {
  const d = len(a, b);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

// ─────────────────────────── the data ───────────────────────────

describe('group B data (docs/ult-test.md 5-2 rules)', () => {
  it('every group-B character has its own 조준 and 드래그 ult; ids, slot, cast time, cut-in delays, no target parts', () => {
    expect(Object.keys(GROUP_B).sort()).toEqual([...ULT_GROUP_B_IDS].sort());
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        const def = alt(id, mode);
        expect(def.id).toBe(`${id}_${mode === 'aim' ? 'ua' : 'ud'}`);
        expect(def.slot).toBe('ult');
        expect(def.castTime).toBe(ULT_CAST_TIME);
        expect(def.name.length, def.id).toBeGreaterThan(0);
        expect(def.aimRange, def.id).toBeUndefined();
        if (mode === 'aim') expect(def.move, def.id).toBeUndefined();
        else expect(def.move && def.move.maxRange > 0 && def.move.maxRange <= 10, def.id).toBe(true);
        if (def.move?.path) expect(def.move.path.delay ?? ULT_TEST.firstHit).toBeGreaterThanOrEqual(ULT_TEST.firstHit);
        for (const a of def.actions) {
          expect(a.delay ?? 0, `${def.id} ${a.stage}`).toBeGreaterThanOrEqual(ULT_TEST.firstHit);
          expect(a.center, `${def.id} ${a.stage}`).not.toBe('target'); // 보이는 곳 = 맞는 곳
          expect(['point', 'self'], `${def.id} ${a.stage}`).toContain(a.center);
          if (a.rel) expect(a.rel).toBe('aim');
        }
      }
    }
  });

  it('every description number comes from the data (move range / path too) and the tuned phrases are there', () => {
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        const def = alt(id, mode);
        const d = def.description;
        const known = dataNumbers(def);
        for (const n of descNumbers(d)) expect(known.some(k => Math.abs(k - n) < 1e-6), `${def.id}: "${fmt(n)}" in "${d}" is not in the data`).toBe(true);
        for (const a of def.actions) for (const ph of requiredPhrases(a)) expect(d, `${def.id}: missing "${ph}"`).toContain(ph);
        if (def.move) {
          expect(d, `${def.id}: the move range`).toContain(`최대 ${fmt(def.move.maxRange)}칸`);
          if (def.move.path) for (const e of def.move.path.effects) for (const ph of effectPhrases({ area: { shape: 'single' }, center: 'point', affects: def.move.path.affects, effects: [] }, e)) expect(d, `${def.id}: path "${ph}"`).toContain(ph);
        }
      }
    }
  });

  it('the texts fit the preset panel (844×390): none longer than today’s longest ult text', () => {
    const longest = Math.max(...CHARACTERS.map(c => c.ult.description.length));
    for (const id of ULT_GROUP_B_IDS) for (const mode of ['aim', 'drag'] as const) expect(alt(id, mode).description.length, alt(id, mode).id).toBeLessThanOrEqual(longest);
  });
});

describe('the fallback is still there', () => {
  it('with its alts switched off (test fixture), a group-B character casts today’s ult (re-centred / after a blink)', () => {
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        const undo = setUltAltFixture(id, {});
        try {
          const tg = game(id, mode);
          tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
          clearEvents(tg);
          expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point: { x: 6, y: 4 } } }).ok).toBe(true);
          advance(tg, 9);
          const ev = drain(tg);
          const today = getCharacter(id).ult;
          expect(ev.find((e): e is Ev<'ultCast'> => e.type === 'ultCast')?.aim?.alt, `${id} ${mode}`).toBeUndefined();
          expect(ev.filter(e => e.type === 'skillCast' && e.slot === 'ult' && e.player === 0 && e.skillId === today.id), `${id} ${mode}`).toHaveLength(today.actions.length);
        } finally {
          undo();
        }
        expect(ultAlt(id, mode)?.id).toBe(`${id}_${mode === 'aim' ? 'ua' : 'ud'}`); // back to the data
      }
    }
  });
});

// ─────────────────────────── each alt, cast for real (fixed boss) ───────────────────────────

describe('거너', () => {
  it('조준 포화 지원 · 이동 탄막: shells walk 1.5 apart from my side onto the point, the heavy shell lands on it', () => {
    const def = alt('gunner', 'aim');
    const tg = game('gunner', 'aim');
    place(tg, { x: 6, y: 8 });
    const c = cast(tg, 'aim', { x: 12, y: -1.2 }); // on the boss → clamped into the arena
    expect(c.plan.point).toEqual({ x: 12, y: ARENA_MARGIN });
    expectCastFollowsPlan(c, def, 'aim');
    const back = unit(c.plan.point, c.from); // toward the gunner
    const shells = c.parts.filter(p => p.stage === 'shells');
    expect(shells.map(p => p.delay)).toEqual([0.5, 0.7, 0.9, 1.1, 1.3]);
    [6, 4.5, 3, 1.5, 0].forEach((d, i) => expect(near(shells[i].center, { x: c.plan.point.x + back.x * d, y: c.plan.point.y + back.y * d }, 1e-6), `shell ${i}`).toBe(true));
    advance(tg, 2.2);
    expect(stages(tg, def.id, 'shells')).toHaveLength(10); // 5 spots × 2
    expect(stages(tg, def.id, 'heavy')[0].targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });

  it('드래그 펌프 버스트 · 대구경 슬러그: dashes (capped at 7), cones the way it moved, slug + recoil straight back', () => {
    const def = alt('gunner', 'drag');
    const tg = game('gunner', 'drag');
    place(tg, { x: 12, y: 10.5 });
    const c = cast(tg, 'drag', { x: 12, y: 0.5 }); // 10 away → 7
    expectCastFollowsPlan(c, def, 'drag');
    expect(c.after.x).toBeCloseTo(12, 9);
    expect(c.after.y).toBeCloseTo(3.5, 9);
    expect(c.plan.aimDeg).toBe(270); // straight up
    expect(c.parts[0].area).toMatchObject({ shape: 'cone', rot: 270 });
    expect(c.parts[1].area).toMatchObject({ shape: 'rect', rot: 270 });
    clearEvents(tg);
    advance(tg, 1.6);
    const ev = drain(tg);
    const recoil = ev.find((e): e is Ev<'dash'> => e.type === 'dash' && e.entityId === c.ult.entityId);
    expect(recoil).toBeDefined();
    expect(recoil!.to.y - recoil!.from.y).toBeCloseTo(1.5, 6); // pushed down, away from where it fired
    expect(stages(tg, def.id, 'shells').filter(s => s.targets > 0)).toHaveLength(3);
    expect(stages(tg, def.id, 'slug')[0].targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });

  it('드래그 to a far point outside the arena: at most 7 cells, inside the arena', () => {
    const tg = game('gunner', 'drag');
    place(tg, { x: 20, y: 9 });
    const c = cast(tg, 'drag', { x: 40, y: 30 });
    expectCastFollowsPlan(c, alt('gunner', 'drag'), 'drag');
    const a = tg.w.state.plan.arena;
    expect(c.after.x).toBeLessThanOrEqual(a.width - ARENA_MARGIN + 1e-9);
    expect(c.after.y).toBeLessThanOrEqual(a.height - ARENA_MARGIN + 1e-9);
    expect(len(c.from, c.after)).toBeLessThanOrEqual(7 + 1e-9);
    settle(tg);
  });
});

describe('클레릭', () => {
  it('조준 대천사 강림 · 조여드는 빛: the big heal on the point, three rings closing on it hit the boss', () => {
    const def = alt('cleric', 'aim');
    const tg = game('cleric', 'aim');
    const e = place(tg, { x: 12, y: 4 }, 0.3);
    const c = cast(tg, 'aim', { x: 12, y: 2.5 });
    expectCastFollowsPlan(c, def, 'aim');
    expect(c.parts.slice(1).map(p => (p.area as { radius: number }).radius)).toEqual([7.5, 5, 2.5]);
    advance(tg, 0.6);
    expect(e.hp / e.maxHp).toBeGreaterThanOrEqual(0.74);
    expect(hasStatus(e, 'regen')).toBe(true);
    expect(hasStatus(e, 'defUp')).toBe(true);
    advance(tg, 0.6);
    const rings = stages(tg, def.id, 'judgement');
    expect(rings).toHaveLength(3);
    for (const r of rings) expect(r.targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });

  it('조준 far from the cleric: nobody in reach is not healed (the heal is where it was aimed)', () => {
    const tg = game('cleric', 'aim');
    const e = place(tg, { x: 3, y: 9 }, 0.3);
    cast(tg, 'aim', { x: 20, y: 3 });
    advance(tg, 0.6);
    expect(e.hp / e.maxHp).toBeLessThan(0.4);
    settle(tg);
  });

  it('드래그 성역의 종 · 천상의 울림: blinks there, heals + leaves the sanctuary, the bell at 4.5 s', () => {
    const def = alt('cleric', 'drag');
    const tg = game('cleric', 'drag');
    const e = place(tg, { x: 6, y: 9 }, 0.3);
    const c = cast(tg, 'drag', { x: 12, y: 3.5 });
    expectCastFollowsPlan(c, def, 'drag');
    expect(near(c.after, { x: 12, y: 3.5 }, 1e-9)).toBe(true);
    advance(tg, 0.6);
    expect(e.hp / e.maxHp).toBeGreaterThanOrEqual(0.55);
    expect(hasStatus(e, 'defUp')).toBe(true);
    expect(tg.w.state.zones.some(z => z.ownerPlayer === 0 && z.kind === 'heal' && near(z.center, c.after, 1e-6))).toBe(true);
    advance(tg, 4.2);
    const bell = stages(tg, def.id, 'judgement');
    expect(bell).toHaveLength(1);
    expect(bell[0].targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });
});

describe('메딕', () => {
  it('조준 골든 아워 · 응급 거점: heal + haste on the point, the bench as today, a 6-tick siren field', () => {
    const def = alt('medic', 'aim');
    const tg = game('medic', 'aim');
    const e = place(tg, { x: 12, y: 6 }, 0.3);
    const p = tg.w.state.players[0];
    p.party[1].hp = p.party[1].maxHp * 0.3;
    const c = cast(tg, 'aim', { x: 12, y: 6 });
    expectCastFollowsPlan(c, def, 'aim');
    advance(tg, 0.6);
    expect(e.hp / e.maxHp).toBeGreaterThanOrEqual(0.6);
    expect(hasStatus(e, 'haste')).toBe(true);
    expect(p.party[1].hp / p.party[1].maxHp).toBeGreaterThanOrEqual(0.69);
    expect(tg.w.state.zones.some(z => z.ownerPlayer === 0 && z.kind === 'heal' && near(z.center, { x: 12, y: 6 }))).toBe(true);
    advance(tg, 6);
    expect(stages(tg, def.id, 'siren').map(s => s.hit)).toEqual([0, 1, 2, 3, 4, 5]);
    settle(tg);
  });

  it('드래그 코드 블루 · 긴급 출동: dashes (capped at 9) healing along the way, the cross heal, then the defib on the boss', () => {
    const def = alt('medic', 'drag');
    const tg = game('medic', 'drag');
    const e = place(tg, { x: 4, y: 9 }, 0.3);
    const c = cast(tg, 'drag', { x: 12, y: 3.5 }); // √94.25 ≈ 9.7 away → 9
    expectCastFollowsPlan(c, def, 'drag');
    expect(len(c.from, c.after)).toBeCloseTo(9, 9);
    expect(c.path[0].area).toMatchObject({ shape: 'line', width: 2.4 });
    expect(near(c.path[0].center, c.after, 1e-9)).toBe(true);
    advance(tg, 0.6);
    expect(e.hp / e.maxHp).toBeGreaterThanOrEqual(0.74); // path 20 % + cross 25 %
    advance(tg, 0.5);
    expect(stages(tg, def.id, 'defib')[0].targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });
});

describe('퇴마사', () => {
  it('조준 봉마 결계 · 부적 장벽: a wall across the aim (perpendicular), drain on the boss, the storm field, 멸', () => {
    const def = alt('exorcist', 'aim');
    const tg = game('exorcist', 'aim');
    place(tg, { x: 6, y: 8 });
    const c = cast(tg, 'aim', { x: 12, y: 2 });
    expectCastFollowsPlan(c, def, 'aim');
    const across = (c.plan.aimDeg + 90) % 360;
    for (const i of [0, 1, 2]) expect((c.parts[i].area as { rot: number }).rot).toBeCloseTo(across, 6);
    advance(tg, 0.6);
    const b = boss(tg);
    expect(hasStatus(b, 'drain')).toBe(true);
    const zone = tg.w.state.zones.find(z => z.ownerPlayer === 0 && z.kind === 'damage');
    expect(zone?.area).toMatchObject({ shape: 'rect', length: 9, width: 2 });
    advance(tg, 3.1);
    expect(stages(tg, def.id, 'destroy').find(s => s.actionIndex === 2)?.targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, b.id)).toBeGreaterThan(0);
    settle(tg);
  });

  it('드래그 팔문 봉인진 · 백귀 결계: blinks, the seal ring marks the boss, storm, 멸 heals per enemy hit', () => {
    const def = alt('exorcist', 'drag');
    const tg = game('exorcist', 'drag');
    const e = place(tg, { x: 12, y: 10 }, 0.5);
    const c = cast(tg, 'drag', { x: 12, y: 3.5 });
    expectCastFollowsPlan(c, def, 'drag');
    advance(tg, 0.6);
    const b = boss(tg);
    expect(hasStatus(b, 'drain')).toBe(true);
    expect(stages(tg, def.id, 'greatseal')[0].targets).toBeGreaterThanOrEqual(1);
    expect(tg.w.state.zones.some(z => z.ownerPlayer === 0 && z.kind === 'damage' && near(z.center, c.after))).toBe(true);
    clearEvents(tg);
    advance(tg, 3);
    expect(stages(tg, def.id, 'destroy')[0].targets).toBeGreaterThanOrEqual(1);
    expect(drain(tg).some(ev => ev.type === 'heal' && ev.targetId === e.id)).toBe(true);
    expect(ultDamage(tg, def, b.id)).toBeGreaterThan(0);
    settle(tg);
  });
});

describe('바드', () => {
  it('조준 음파 직격 · 포르티시모: a 14-long beam from the bard toward the aim — allies in it buffed, the boss hit 3 times', () => {
    const def = alt('bard', 'aim');
    const tg = game('bard', 'aim');
    const e = place(tg, { x: 6, y: 8 });
    const c = cast(tg, 'aim', { x: 12, y: -1.2 });
    expectCastFollowsPlan(c, def, 'aim');
    expect(c.parts[0].area).toEqual({ shape: 'line', length: 14, width: 4 });
    advance(tg, 0.6);
    expect(hasStatus(e, 'atkUp')).toBe(true);
    expect(hasStatus(e, 'haste')).toBe(true);
    expect(drain(tg).some(ev => ev.type === 'benchBuff' && ev.player === 0)).toBe(true);
    advance(tg, 1.2);
    const beats = stages(tg, def.id, 'beat');
    expect(beats.map(s => s.hit)).toEqual([0, 1, 2]);
    // the beam never slides: every beat is where the first one was
    for (const s of beats) expect(near(s.center, c.plan.point)).toBe(true);
    for (const s of beats) expect(s.targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });

  it('조준 the other way: the boss is not in the beam, the bard still is', () => {
    const def = alt('bard', 'aim');
    const tg = game('bard', 'aim');
    const e = place(tg, { x: 12, y: 8 });
    cast(tg, 'aim', { x: 12, y: 11.5 }); // straight down, away from the boss
    advance(tg, 2);
    expect(hasStatus(e, 'atkUp')).toBe(true);
    expect(ultDamage(tg, def, boss(tg).id)).toBe(0);
    settle(tg);
  });

  it('드래그 공명 삼중주 · 피날레: slides there, up-down bands through it and ±3, the forte last', () => {
    const def = alt('bard', 'drag');
    const tg = game('bard', 'drag');
    const e = place(tg, { x: 12, y: 10 });
    const c = cast(tg, 'drag', { x: 12, y: 4 });
    expectCastFollowsPlan(c, def, 'drag');
    // the bands do not turn with the move (the drag skill's rule)
    for (const p of c.parts) if (p.area.shape === 'rect') expect(p.area.rot).toBeUndefined();
    const xs = c.parts.filter(p => p.area.shape === 'rect').map(p => p.center.x - c.after.x);
    expect([...new Set(xs.map(x => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b)).toEqual([-3, 0, 3]);
    advance(tg, 1.4);
    expect(hasStatus(e, 'atkUp')).toBe(true);
    expect(hasStatus(e, 'haste')).toBe(true);
    const beats = stages(tg, def.id, 'beat');
    expect(beats).toHaveLength(3); // one 'beat' per beat (0.45 / 0.75 left / 1.1)
    for (const s of beats) expect(s.targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });
});

describe('크로노', () => {
  it('조준 시간 정지 · 시간의 늪: freezes the boss on the point, then the mire (enemies slowed, allies hasted)', () => {
    const def = alt('chrono', 'aim');
    const tg = game('chrono', 'aim');
    const e = place(tg, { x: 12, y: 6 });
    const c = cast(tg, 'aim', { x: 12, y: 3 });
    expectCastFollowsPlan(c, def, 'aim');
    advance(tg, 0.6);
    const b = boss(tg);
    expect(hasStatus(b, 'stasis')).toBe(true);
    expect(hasStatus(b, 'vulnerable')).toBe(true);
    expect(hasStatus(e, 'haste')).toBe(true);
    expect(drain(tg).some(ev => ev.type === 'swapCdCut' && ev.player === 0 && ev.seconds === 4)).toBe(true);
    const mine = tg.w.state.zones.filter(z => z.ownerPlayer === 0 && near(z.center, c.plan.point));
    expect(mine.map(z => z.kind).sort()).toEqual(['buff', 'debuff']);
    advance(tg, 2.5);
    expect(hasStatus(b, 'slow')).toBe(true); // the mire after the freeze
    settle(tg);
  });

  it('드래그 시간 균열 · 영겁의 역행: blinks in, X rift, rewind, then freeze + X on the boss', () => {
    const def = alt('chrono', 'drag');
    const tg = game('chrono', 'drag');
    place(tg, { x: 12, y: 10 });
    const c = cast(tg, 'drag', { x: 12, y: 3.5 });
    expectCastFollowsPlan(c, def, 'drag');
    expect(c.parts[0].area).toMatchObject({ shape: 'cross', diagonal: true, length: 5 });
    advance(tg, 1.3);
    const b = boss(tg);
    expect(stages(tg, def.id, 'rift')[0].targets).toBeGreaterThanOrEqual(1);
    expect(stages(tg, def.id, 'rewind')).toHaveLength(1);
    expect(hasStatus(b, 'stasis')).toBe(true);
    expect(hasStatus(b, 'vulnerable')).toBe(true);
    expect(ultDamage(tg, def, b.id)).toBeGreaterThan(0);
    advance(tg, 2);
    expect(drain(tg).some(ev => ev.type === 'stasisEnd' && ev.entityId === b.id && ev.amount > 0)).toBe(true); // the stored X damage comes back
    settle(tg);
  });
});

describe('퍼펫티어', () => {
  it('조준 인형극 개막 · 커튼 라인: four grand dolls in a row across the aim, atk down on the boss, the curtain along the row', () => {
    const def = alt('puppeteer', 'aim');
    const tg = game('puppeteer', 'aim');
    place(tg, { x: 6, y: 8 });
    const c = cast(tg, 'aim', { x: 12, y: 6 }); // the row fits in the arena (a doll off the edge is pulled in)
    expectCastFollowsPlan(c, def, 'aim');
    advance(tg, 0.6);
    const dolls = tg.w.state.entities.filter(e => e.defId === 'paper_doll_grand' && e.team === 'ally');
    expect(dolls).toHaveLength(4);
    const u = unit(c.from, c.plan.point);
    const across = dolls.map(d => (d.pos.x - c.plan.point.x) * -u.y + (d.pos.y - c.plan.point.y) * u.x).sort((a, b) => a - b);
    expect(across.map(a => Math.round(a * 1e6) / 1e6)).toEqual([-4.5, -1.5, 1.5, 4.5]);
    for (const d of dolls) expect(Math.abs((d.pos.x - c.plan.point.x) * u.x + (d.pos.y - c.plan.point.y) * u.y)).toBeLessThan(1e-6);
    const b = boss(tg);
    expect(hasStatus(b, 'atkDown')).toBe(true);
    advance(tg, 2.6);
    expect(stages(tg, def.id, 'curtaincall')[0].targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, b.id)).toBeGreaterThan(0);
    settle(tg);
  });

  it('드래그 대역 인형극 · 대공연: dashes in, two grand dolls tossed ahead on both sides flank the boss, thread, curtain', () => {
    const def = alt('puppeteer', 'drag');
    const tg = game('puppeteer', 'drag');
    place(tg, { x: 12, y: 10 });
    const c = cast(tg, 'drag', { x: 12, y: 2.5 });
    expectCastFollowsPlan(c, def, 'drag');
    expect(c.plan.aimDeg).toBe(270);
    // ahead = up: the left doll first at (9, 1), the right one 0.15 s later at (15, 1)
    expect(near(c.parts[1].center, { x: 9, y: 1 })).toBe(true);
    expect(near(c.parts[2].center, { x: 15, y: 1 })).toBe(true);
    expect(c.parts[3].area).toMatchObject({ shape: 'rect', rot: 0 }); // the thread runs between them
    advance(tg, 0.9);
    const dolls = tg.w.state.entities.filter(e => e.defId === 'paper_doll_grand' && e.team === 'ally');
    expect(dolls.map(d => [d.pos.x, d.pos.y])).toEqual([
      [9, 1],
      [15, 1],
    ]);
    expect(stages(tg, def.id, 'toss').filter(s => s.targets > 0)).toHaveLength(2);
    expect(stages(tg, def.id, 'thread')[0].targets).toBeGreaterThanOrEqual(1);
    advance(tg, 2.4);
    expect(stages(tg, def.id, 'curtaincall')[0].targets).toBeGreaterThanOrEqual(1);
    expect(ultDamage(tg, def, boss(tg).id)).toBeGreaterThan(0);
    settle(tg);
  });
});

// ─────────────────────────── 보이는 곳 = 맞는 곳 (where each part first lands) ───────────────────────────

describe('each part first lands where the live preview drew it', () => {
  for (const id of ULT_GROUP_B_IDS) {
    for (const mode of ['aim', 'drag'] as const) {
      it(`${id} ${mode}`, () => {
        const def = alt(id, mode);
        const tg = game(id, mode);
        place(tg, { x: 12, y: 8 }, 0.6);
        tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
        clearEvents(tg);
        const aim = { mode, point: { x: 12, y: 3.5 } };
        const plan = planUlt(tg.w.state, 0, aim)!;
        const preview = ultPreviewParts(tg.w.state, 0, plan);
        expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
        advance(tg, 6);
        // skillStage hit 0 of each staged part with a footprint; a part that follows on purpose is not checked
        const landed = drain(tg).filter((e): e is Ev<'skillStage'> => e.type === 'skillStage' && e.player === 0 && e.skillId === def.id && e.hit === 0);
        let j = 0;
        plan.actions.forEach((a, i) => {
          if (a.affects === 'self') return;
          const part = preview[j++];
          if (a.follow || !a.stage) return;
          const st = landed.find(x => x.actionIndex === i);
          expect(st, `${def.id} #${i} ${a.stage} landed`).toBeDefined();
          expect(near(st!.center, part.center, 1e-6), `${def.id} #${i} ${a.stage} landed at ${JSON.stringify(st!.center)}, drawn at ${JSON.stringify(part.center)}`).toBe(true);
        });
        // only the parts meant to ride something keep follow: none of group B's
        expect(def.actions.filter(a => a.follow).map(a => a.stage), def.id).toEqual([]);
      });
    }
  }
});

// ─────────────────────────── roaming / arena bosses ───────────────────────────

describe('a roaming and an arena boss (the bot aim: 조준 on the boss, 드래그 just in front of it; healers on the most hurt ally)', () => {
  for (const bossId of [ROAMING, ARENA]) {
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        it(`${bossId}: ${id} ${mode}`, () => {
          const def = alt(id, mode);
          const tg = game(id, mode, { boss: bossId });
          advance(tg, 1);
          const b = boss(tg);
          // 4.5 cells below the boss (or above when it walks low), at 60 % HP: the only hurt ally
          const at = { x: b.pos.x, y: b.pos.y + (b.pos.y < 6 ? 4.5 : -4.5) };
          const e = place(tg, at, 0.6);
          const aim = botUltAim(tg.w.state, 0)!;
          expect(aim.mode).toBe(mode);
          const c = cast(tg, mode, aim.point);
          expectCastFollowsPlan(c, def, mode);
          const hp0 = e.hp;
          advance(tg, 1);
          const hit = stages(tg, def.id).filter(s => s.targets > 0);
          expect(hit.length, `${def.id} reached nobody`).toBeGreaterThan(0);
          if ((def.botAim ?? 'enemy') === 'enemy') {
            // an enemy beat landed on someone, and the boss itself took the damage or a status of mine
            expect(hit.some(s => def.actions[s.actionIndex].affects === 'enemies'), `${def.id} reached no enemy`).toBe(true);
            advance(tg, 3);
            const touched = ultDamage(tg, def, b.id) > 0 || b.statuses.some(s => s.sourcePlayer === 0);
            expect(touched, `${def.id} did nothing to ${bossId}`).toBe(true);
          } else {
            expect(e.hp, `${def.id} healed nobody`).toBeGreaterThan(hp0);
          }
          settle(tg);
        });
      }
    }
  }
});

// ─────────────────────────── bots ───────────────────────────

describe('bots', () => {
  const B_IDS = new Set(ULT_GROUP_B_IDS.flatMap(id => [`${id}_ua`, `${id}_ud`]));
  for (const [mode, bossId] of [
    ['aim', FIXED],
    ['drag', ROAMING],
    ['drag', FIXED],
    ['aim', ARENA],
  ] as const) {
    it(`bots in ${mode} cast group-B alts within 60 s on ${bossId}, nothing throws`, () => {
      const players: PlayerSetup[] = [
        { ...HUMAN, characters: ['puppeteer', 'chrono', 'bard'], ultMode: mode },
        { ...BOT1, characters: ['gunner', 'cleric', 'medic'] },
        { ...BOT2, characters: ['exorcist', 'bard', 'chrono'] },
      ];
      const tg = makeGame({ seed: 7, mode: 'ultTest', players, tunables: { invincible: true, ultFieldChargeTime: 4 }, bossRaid: { onlyBoss: bossId, hpMult: 400 } });
      expect(tg.w.state.players.map(p => p.ultMode)).toEqual([mode, mode, mode]);
      for (let s = 0; s < 60; s++) expect(() => advance(tg, 1)).not.toThrow();
      finiteWorld(tg);
      expect(tg.w.state.phase).toBe('combat');
      const casts = drain(tg).filter((e): e is Ev<'ultCast'> => e.type === 'ultCast' && e.player > 0);
      for (const pi of [1, 2]) {
        const mine = casts.filter(c => c.player === pi);
        expect(mine.length, `bot ${pi}`).toBeGreaterThanOrEqual(3);
        for (const c of mine) {
          expect(c.aim?.mode).toBe(mode);
          expect(c.aim?.alt, c.skillId).toBe(true);
          expect(B_IDS.has(c.skillId), c.skillId).toBe(true);
        }
      }
      // several different characters' alts came out (bots swap their cards)
      expect(new Set(casts.map(c => c.skillId)).size).toBeGreaterThanOrEqual(3);
    });
  }
});

// ─────────────────────────── render smoke (src/render/ultTest/groupB.ts) ───────────────────────────

function fakeCanvas(): HTMLCanvasElement {
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return { width: 300, height: 150, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe('render', () => {
  it('every group-B alt (조준 and 드래그) is drawn through its whole cast without throwing', () => {
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        const tg = game(id, mode);
        const r = createRenderer(fakeCanvas());
        const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
        place(tg, { x: 12, y: 8 }, 0.5);
        tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
        tg.game.drainEvents();
        tg.events.length = 0;
        expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point: { x: 12, y: 2.5 } } }).ok).toBe(true);
        expect(() => r.render(tg.w.state, tg.game.drainEvents(), 1 / 60, ui), `${id} ${mode}`).not.toThrow();
        let beats = 0;
        for (let i = 0; i < 150; i++) {
          advance(tg, 1 / 30);
          // advance() already drained the tick's events into tg.events: hand those on (drainEvents() would be empty)
          const evs = tg.events.splice(0);
          beats += evs.filter(e => e.type === 'skillStage' && e.slot === 'ult').length;
          expect(() => r.render(tg.w.state, evs, 1 / 30, ui), `${id} ${mode} frame ${i}`).not.toThrow();
        }
        expect(beats, `${id} ${mode}: its beats reached the renderer`).toBeGreaterThan(0);
      }
    }
  });
});

// ─────────────────────────── text rules (as tests/sim/roster-descriptions.test.ts) ───────────────────────────

const fmt = (x: number) => String(Number(x.toFixed(2)));
const pct = (x: number) => fmt(x * 100);
const descNumbers = (d: string) => (d.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

function areaNumbers(a: AreaShape): number[] {
  switch (a.shape) {
    case 'circle':
      return [a.radius];
    case 'line':
    case 'rect':
      return [a.length, a.width];
    case 'cone':
    case 'fan':
      return [a.radius, a.angle];
    case 'ring':
      return [a.inner, a.outer];
    case 'cross':
      return [a.length, a.width, 4];
    default:
      return [];
  }
}

function effectNumbers(e: Effect): number[] {
  switch (e.kind) {
    case 'damage':
      return [e.amount * 100];
    case 'heal':
      return [e.amount * 100, ...(e.overflowShield ? [e.overflowShield.cap * 100, e.overflowShield.duration] : [])];
    case 'shield':
      return [e.amount * 100, e.duration];
    case 'status':
      return [e.duration, e.value * 100, e.value];
    case 'knockback':
    case 'pull':
      return [e.distance];
    case 'swapCooldownReduce':
    case 'reviveReduce':
      return [e.seconds];
    case 'benchHeal':
      return [e.amount * 100];
    case 'benchStatus':
      return [e.duration, e.value * 100];
    case 'cleanse':
      return [];
  }
}

function dataNumbers(skill: UltAltDef): number[] {
  const out: number[] = [skill.actions.length];
  const stageCount = new Map<string, number>();
  for (const a of skill.actions) if (a.stage) stageCount.set(a.stage, (stageCount.get(a.stage) ?? 0) + 1);
  out.push(...stageCount.values());
  for (const a of skill.actions) {
    out.push(...areaNumbers(a.area));
    if (a.offset) out.push(Math.abs(a.offset.x), Math.abs(a.offset.y));
    if (a.delay) out.push(a.delay);
    if (a.hits) out.push(a.hits, a.hitInterval ?? 0.2, (a.delay ?? 0) + (a.hits - 1) * (a.hitInterval ?? 0.2));
    if (a.zone) out.push(a.zone.duration, a.zone.tickInterval, (a.delay ?? 0) + a.zone.duration);
    if (a.dash) out.push(a.dash.distance);
    if (a.summon) {
      const s = a.summon;
      out.push(s.count, s.duration);
      if (s.inherit) out.push(s.inherit.hp * 100, s.inherit.atk * 100);
      const od = getMonster(s.unitId).onDeath?.action;
      if (od) {
        out.push(...areaNumbers(od.area));
        for (const e of od.effects) out.push(...effectNumbers(e));
      }
    }
    if (a.maxTargets) out.push(a.maxTargets);
    if (a.healPerHit) out.push(a.healPerHit.radius, a.healPerHit.amount * 100, a.healPerHit.maxHits);
    for (const e of a.effects) out.push(...effectNumbers(e));
  }
  // 기획 22차: the move (range, path width, path effects)
  if (skill.move) {
    out.push(skill.move.maxRange);
    if (skill.move.path) {
      out.push(skill.move.path.width);
      for (const e of skill.move.path.effects) out.push(...effectNumbers(e));
    }
  }
  return out;
}

function requiredPhrases(a: SkillAction): string[] {
  const out: string[] = [];
  for (const e of a.effects) out.push(...effectPhrases(a, e));
  if (a.zone) {
    out.push(`${fmt(a.zone.duration)}초간`);
    if (a.effects.some(e => e.kind === 'damage' || e.kind === 'heal')) out.push(`${fmt(a.zone.tickInterval)}초마다`);
  }
  if (a.dash) out.push(a.dash.atFire ? `${fmt(a.dash.distance)}칸` : `${fmt(a.dash.distance)}칸 돌진`);
  if (a.maxTargets) out.push(`${a.maxTargets}마리까지`);
  if (a.healPerHit) out.push('맞은 적 1명당', `HP ${pct(a.healPerHit.amount)}%`);
  return out;
}

function effectPhrases(a: SkillAction, e: Effect): string[] {
  switch (e.kind) {
    case 'damage':
      return [`${pct(e.amount)}% 피해`];
    case 'heal':
      return [`HP ${pct(e.amount)}%`, ...(e.overflowShield ? ['넘친 회복은 보호막', `최대 HP ${pct(e.overflowShield.cap)}%`] : [])];
    case 'shield':
      return [`최대 HP ${pct(e.amount)}%, ${fmt(e.duration)}초`];
    case 'knockback':
      return [`${fmt(e.distance)}칸 넉백`];
    case 'pull':
      return [`${fmt(e.distance)}칸 끌어당`];
    case 'swapCooldownReduce':
      return [`쿨 ${fmt(e.seconds)}초 감소`];
    case 'cleanse':
      return ['정화'];
    case 'benchHeal':
      return [`대기 캐릭터 HP ${pct(e.amount)}%`];
    case 'reviveReduce':
      return [`부활 대기 ${fmt(e.seconds)}초 감소`];
    case 'benchStatus':
      return ['대기 캐릭터', ...statusPhrases(a, e.status, e.duration, e.value)];
    case 'status':
      return statusPhrases(a, e.status, e.duration, e.value);
  }
}

function statusPhrases(a: SkillAction, status: StatusId, duration: number, value: number): string[] {
  const z = !!a.zone;
  const lasting = (strength: string) => (z ? [strength] : [`${fmt(duration)}초간`, strength]);
  switch (status) {
    case 'stun':
      return [`${fmt(duration)}초 기절`];
    case 'slow':
      return [z ? `${pct(value)}% 둔화` : `${fmt(duration)}초간 ${pct(value)}% 둔화`];
    case 'haste':
      return lasting(`공격 속도 +${pct(value)}%`);
    case 'atkUp':
      return lasting(`공격력 +${pct(value)}%`);
    case 'defUp':
      return lasting(`방어 +${pct(value)}%`);
    case 'atkDown':
      return lasting(`공격력 −${pct(value)}%`);
    case 'drain':
      return [`${fmt(duration)}초간 흡혼 표식`, `피해의 ${pct(value)}%`];
    case 'vulnerable':
      return lasting(`받는 피해 +${pct(value)}%`);
    case 'regen':
      return [`${fmt(duration)}초간 초당 HP ${pct(value)}% 재생`];
    case 'root':
      return [`${fmt(duration)}초 속박`];
    case 'stasis':
      return [`${fmt(duration)}초 정지`, `피해의 ${pct(value)}%`];
    case 'charm':
      return [`${fmt(duration)}초간 조종`];
    default:
      return [];
  }
}

// the roster ids exist (a typo in GROUP_B would be a silent fallback)
it('group B keys are real characters', () => {
  const ids = new Set(CHARACTERS.map(c => c.id));
  for (const id of Object.keys(GROUP_B)) expect(ids.has(id), id).toBe(true);
});
