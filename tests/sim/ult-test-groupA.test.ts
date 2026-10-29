// 기획 22차 궁극기 테스트 — 그룹 A (가디언 · 팔라딘 · 워든 · 블레이드 · 버서커 · 섀도우 · 레인저 · 메이지)의 캐릭터별
// 조준 / 드래그 궁극기 (src/data/ultTest/groupA.ts, docs/ult-test.md 5장):
//  - the data contract: alt ids, the ult shape, the cut-in rule (effects from 0.45 s), the descriptions true to the
//    numbers (the rules of tests/sim/roster-descriptions.test.ts + the move's / aim's own numbers);
//  - every character × 조준 / 드래그 cast for real in a 궁극기 테스트 game against a boss: the cast carries the alt id, every
//    part lands where the live preview says (the aimed point / the landing spot), the drag honours maxRange and the
//    arena clamp, something real happens (damage + the design's own ally effects), 10 s more run clean;
//  - the same on a roaming and an arena boss (src/data/bosses/forms.ts), and bots playing them in both modes;
//  - 기획 23차 (docs/ult-fx.md 3장 A1–A16): every alt's climax (`finale`, 0.8–2.45 s), the renamed beats, the new and
//    retimed parts landing when and where the tables say (성채 전개 · 성벽 돌파 · 철창 1초 · 혈귀 낙하 · 용암 분출 · 고드름);
//  - 기획 24차 (docs/ult-fx.md 8-3 A12′–A14′): 섀도우 드래그 · 레인저 조준 / 드래그 redesigned — their climax times, every
//    part landing on the fixed boss when the tables say, the shadow staying where it landed (no slide any more).
import { describe, expect, it } from 'vitest';
import { getCharacter } from '../../src/data';
import { ULT_CAST_TIME, ULT_GROUP_A_IDS, ULT_TEST, ultAlt, ultAltBySkill, ultBeats, type UltAltDef } from '../../src/data/ultTest';
import { GROUP_A } from '../../src/data/ultTest/groupA';
import { ARENA_MARGIN } from '../../src/sim/constants';
import { dashEnd } from '../../src/sim/geometry';
import { botUltAim, planUlt, ultPreviewParts } from '../../src/sim/ultTest';
import { hasStatus } from '../../src/sim/status';
import { activeEntity } from '../../src/sim/world';
import type { AreaShape, Effect, GameEvent, PlayerSetup, SkillAction, StatusId, UltAim, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, clearEvents, drain, makeGame, type TestGame } from './helpers';

const IDS = ['guardian', 'paladin', 'warden', 'blade', 'berserker', 'shadow', 'ranger', 'mage'] as const;
const MODES = ['aim', 'drag'] as const;
type Mode = (typeof MODES)[number];

/** Fixed at the top centre (12, −1.2), radius 3 · walks the map · whole-map stage + a small core. */
const FIXED = 'elevator_keeper';
const ROAMING = 'washer_drum';
const ARENA = 'inverted_moon';

const near = (a: Vec2, b: Vec2, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;
const alt = (id: string, mode: Mode): UltAltDef => GROUP_A[id][mode]!;
const finite = (v: Vec2) => Number.isFinite(v.x) && Number.isFinite(v.y);

type Cast = Extract<GameEvent, { type: 'skillCast' }>;
type UltCast = Extract<GameEvent, { type: 'ultCast' }>;

function ultGame(id: string, mode: Mode, boss: string, seed = 22): TestGame {
  const tg = makeGame({
    seed,
    mode: 'ultTest',
    players: [{ ...HUMAN, characters: [id, 'cleric', 'bard'], ultMode: mode }],
    tunables: { invincible: true },
    bossRaid: { onlyBoss: boss, hpMult: 50 },
  });
  advance(tg, 0.5);
  tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
  clearEvents(tg);
  return tg;
}

function bossOf(tg: TestGame) {
  return tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
}

/** My ult's damage on enemies since the last clear (the hits carry the cast's name). */
function ultDamage(tg: TestGame, name: string): number {
  let sum = 0;
  for (const e of drain(tg)) if (e.type === 'damage' && e.targetTeam === 'enemy' && e.skillName === name) sum += e.amount;
  return sum;
}

// ─────────────────────────── descriptions (the roster-descriptions rules, + the move / aim numbers) ───────────────────────────

const fmt = (x: number) => String(Number(x.toFixed(2)));
const pct = (x: number) => fmt(x * 100);

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
      return [e.amount * 100];
    case 'shield':
      return [e.amount * 100, e.duration];
    case 'status':
      return [e.duration, e.value * 100, e.value];
    case 'knockback':
    case 'pull':
      return [e.distance];
    default:
      return [];
  }
}

/** Every number the data explains: the parts (as roster-descriptions) + move.maxRange, the path, aimRange. */
function dataNumbers(def: UltAltDef): number[] {
  const out: number[] = [def.actions.length];
  const stages = new Map<string, number>();
  for (const a of def.actions) if (a.stage) stages.set(a.stage, (stages.get(a.stage) ?? 0) + 1);
  out.push(...stages.values());
  for (const a of def.actions) {
    out.push(...areaNumbers(a.area));
    if (a.offset) out.push(Math.abs(a.offset.x), Math.abs(a.offset.y));
    if (a.delay) out.push(a.delay);
    if (a.hits) out.push(a.hits, a.hitInterval ?? 0.2, (a.delay ?? 0) + (a.hits - 1) * (a.hitInterval ?? 0.2));
    if (a.zone) out.push(a.zone.duration, a.zone.tickInterval, (a.delay ?? 0) + a.zone.duration);
    if (a.dash) out.push(a.dash.distance);
    if (a.charge) out.push(a.charge.distance);
    for (const e of a.effects) out.push(...effectNumbers(e));
  }
  if (def.move) {
    out.push(def.move.maxRange);
    if (def.move.path) {
      out.push(def.move.path.width);
      for (const e of def.move.path.effects) out.push(...effectNumbers(e));
    }
  }
  if (def.aimRange != null) out.push(def.aimRange);
  return out;
}

function statusPhrases(zone: boolean, status: StatusId, duration: number, value: number): string[] {
  const lasting = (strength: string) => (zone ? [strength] : [`${fmt(duration)}초간`, strength]);
  switch (status) {
    case 'stun':
      return [`${fmt(duration)}초 기절`];
    case 'slow':
      return [zone ? `${pct(value)}% 둔화` : `${fmt(duration)}초간 ${pct(value)}% 둔화`];
    case 'burn':
      return [`${fmt(duration)}초 화상(초당 공격력 ${pct(value)}%)`];
    case 'haste':
      return lasting(`공격 속도 +${pct(value)}%`);
    case 'atkUp':
      return lasting(`공격력 +${pct(value)}%`);
    case 'defUp':
      return lasting(`방어 +${pct(value)}%`);
    case 'vulnerable':
      return lasting(`받는 피해 +${pct(value)}%`);
    case 'lifesteal':
      return [`피해의 ${pct(value)}% 흡혈`];
    case 'taunt':
      return [`${fmt(duration)}초 도발`];
    case 'tether':
      return ['밖으로 못 나'];
    case 'splashUp':
      return [`기본 공격 범위 +${fmt(value)}`];
    default:
      return [];
  }
}

function effectPhrases(zone: boolean, e: Effect): string[] {
  switch (e.kind) {
    case 'damage':
      return [`${pct(e.amount)}% 피해`, ...(e.crit === 'always' ? ['치명타 확정'] : [])];
    case 'heal':
      return [`HP ${pct(e.amount)}%`];
    case 'shield':
      return [`최대 HP ${pct(e.amount)}%, ${fmt(e.duration)}초`];
    case 'knockback':
      return [`${fmt(e.distance)}칸 넉백`];
    case 'pull':
      return [`${fmt(e.distance)}칸 끌어당`];
    case 'status':
      return statusPhrases(zone, e.status, e.duration, e.value);
    default:
      return [];
  }
}

function requiredPhrases(def: UltAltDef): string[] {
  const out: string[] = [];
  for (const a of def.actions) {
    for (const e of a.effects) out.push(...effectPhrases(!!a.zone, e));
    if (a.zone) {
      out.push(`${fmt(a.zone.duration)}초간`);
      if (a.effects.some(e => e.kind === 'damage' || e.kind === 'heal')) out.push(`${fmt(a.zone.tickInterval)}초마다`);
    }
    if (a.dash) out.push(a.dash.atFire ? `${fmt(a.dash.distance)}칸` : `${fmt(a.dash.distance)}칸 돌진`);
    if (a.charge) out.push(`${fmt(a.charge.distance)}칸`);
  }
  if (def.move) {
    out.push(`최대 ${fmt(def.move.maxRange)}칸`);
    if (def.move.path) {
      out.push(`폭 ${fmt(def.move.path.width)}`);
      for (const e of def.move.path.effects) out.push(...effectPhrases(false, e));
    }
  }
  if (def.aimRange != null) out.push(`${fmt(def.aimRange)}칸 안`);
  return out;
}

// ─────────────────────────── the data ───────────────────────────

describe('group A data (the content contract)', () => {
  it('has its eight characters, each with an own 조준 and 드래그 ult in the ult shape, wired into the registry', () => {
    expect(Object.keys(GROUP_A)).toEqual(ULT_GROUP_A_IDS);
    expect([...IDS]).toEqual(ULT_GROUP_A_IDS);
    for (const id of IDS) {
      const today = getCharacter(id).ult;
      for (const mode of MODES) {
        const def = alt(id, mode);
        const tag = `${id} ${mode}`;
        expect(def, tag).toBeDefined();
        expect(def.id, tag).toBe(`${id}_u${mode === 'aim' ? 'a' : 'd'}`);
        expect(def.slot, tag).toBe('ult');
        expect(def.castTime, tag).toBe(ULT_CAST_TIME);
        expect(def.name.length, tag).toBeGreaterThan(0);
        expect(def.name, tag).not.toBe(today.name);
        expect(ultAlt(id, mode), tag).toBe(def);
        expect(ultAltBySkill(def.id), tag).toMatchObject({ charId: id, mode });
        // 조준 never moves the character by `move`; 드래그 never has an aim range
        if (mode === 'aim') expect(def.move, tag).toBeUndefined();
        else {
          expect(def.aimRange, tag).toBeUndefined();
          expect(def.move!.maxRange, tag).toBeGreaterThan(0);
          expect(def.move!.maxRange, tag).toBeLessThanOrEqual(ULT_TEST.dragRange);
          expect(def.move!.path?.delay ?? ULT_TEST.firstHit, tag).toBeGreaterThanOrEqual(ULT_TEST.firstHit);
        }
      }
      expect(alt(id, 'aim').name).not.toBe(alt(id, 'drag').name);
    }
  });

  it('every part: effects from 0.45 s (movement only may be earlier), a sound / look stage, only rel aim, no hidden target in 조준', () => {
    for (const id of IDS) {
      for (const mode of MODES) {
        for (const [i, a] of alt(id, mode).actions.entries()) {
          const tag = `${id} ${mode} #${i} ${a.stage}`;
          if (a.effects.length > 0) expect(a.delay ?? 0, tag).toBeGreaterThanOrEqual(ULT_TEST.firstHit);
          expect(a.stage, tag).toMatch(/^[a-z0-9]+$/);
          if (a.rel) expect(a.rel, tag).toBe('aim');
          expect(a.center === 'woundedAlly' || a.center === 'arena', tag).toBe(false);
          expect(a.summon, tag).toBeUndefined();
          // 보이는 곳 = 맞는 곳: a 조준 'target' part with nobody near the point would land on the caster's own target
          if (mode === 'aim') expect(a.center, tag).not.toBe('target');
        }
      }
    }
  });

  it('descriptions state every tuned number and only numbers from the data (+ the move / aim range)', () => {
    for (const id of IDS) {
      for (const mode of MODES) {
        const def = alt(id, mode);
        const d = def.description;
        for (const ph of requiredPhrases(def)) expect(d, `${def.id}: missing "${ph}"`).toContain(ph);
        const known = dataNumbers(def);
        for (const n of (d.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)) expect(known.some(k => Math.abs(k - n) < 1e-6), `${def.id}: "${fmt(n)}" in "${d}" is not in the data`).toBe(true);
      }
    }
  });
});

// ─────────────────────────── cast for real ───────────────────────────

/** What each design does besides hurting enemies, checked 1.1 s after the cast (walls / barriers up, buffs still on). */
const SOON: Record<string, (tg: TestGame, mode: Mode, landed: Vec2) => void> = {
  guardian: (tg, mode, at) => {
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    expect(me.shield, 'every ally shielded').toBeGreaterThan(0);
    expect(hasStatus(me, 'defUp') || mode === 'aim', 'the wall / barrier holds me').toBe(true);
    // the barrier stays where the citadel / the wall fell: the aimed point, or the landing spot
    expect(tg.w.state.zones.some(z => z.ownerPlayer === 0 && near(z.center, at)), 'the barrier zone').toBe(true);
  },
  paladin: (tg, mode) => {
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    expect(me.shield, mode === 'aim' ? 'sanctuary' : 'the path shields the paladin').toBeGreaterThan(0);
    if (mode === 'drag') expect(hasStatus(me, 'defUp'), 'blessing').toBe(true);
  },
  warden: tg => {
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    expect(me.shield).toBeGreaterThan(0);
  },
  berserker: tg => {
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    for (const s of ['atkUp', 'haste', 'lifesteal', 'splashUp'] as const) expect(hasStatus(me, s), s).toBe(true);
  },
  mage: (tg, mode, at) => {
    // 조준: the frost fan stays where the mage stood; 드래그: the short blizzard waits for 1.3 s
    if (mode === 'aim') expect(tg.w.state.zones.some(z => z.ownerPlayer === 0 && z.area?.shape === 'cone' && near(z.center, at)), 'the blizzard fan').toBe(true);
  },
};

/** 보이는 곳 = 맞는 곳 where it counts: each part's first hit (skillStage hit 0) lands where the preview drew it. */
function expectLandedWherePreviewed(events: readonly GameEvent[], skillId: string, actions: readonly SkillAction[], preview: readonly { center: Vec2 }[]): void {
  const landed = events.filter((e): e is Extract<GameEvent, { type: 'skillStage' }> => e.type === 'skillStage' && e.player === 0 && e.skillId === skillId && e.hit === 0);
  let j = 0;
  actions.forEach((a, i) => {
    if (a.affects === 'self') return;
    const part = preview[j++];
    if (a.follow || !a.stage) return;
    const st = landed.find(x => x.actionIndex === i);
    expect(st, `${skillId} #${i} ${a.stage} landed`).toBeDefined();
    expect(near(st!.center, part.center, 1e-6), `${skillId} #${i} ${a.stage} landed at ${JSON.stringify(st!.center)}, drawn at ${JSON.stringify(part.center)}`).toBe(true);
  });
}

describe('cast for real on the fixed boss: every character × 조준 / 드래그', () => {
  for (const id of IDS) {
    for (const mode of MODES) {
      it(`${id} ${mode}: alt id, parts where the preview says, real effects, 10 s clean`, () => {
        const def = alt(id, mode);
        const tg = ultGame(id, mode, FIXED);
        const s = tg.w.state;
        const me = activeEntity(tg.w, s.players[0])!;
        const boss = bossOf(tg);
        const from = { x: me.pos.x, y: me.pos.y };
        // 조준 at the boss (clamped into the arena: it stands above the top edge); 드래그 just in front of it, in reach
        const P = mode === 'aim' ? { x: boss.pos.x, y: boss.pos.y } : { x: boss.pos.x - 1, y: boss.pos.y + boss.radius + 1 };
        const aim: UltAim = { mode, point: P };
        const plan = planUlt(s, 0, aim)!;
        expect(plan.alt).toBe(def);
        const preview = ultPreviewParts(s, 0, plan);

        expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
        const ev = drain(tg).slice();
        const uc = ev.filter((e): e is UltCast => e.type === 'ultCast' && e.player === 0);
        expect(uc).toHaveLength(1);
        expect(uc[0]).toMatchObject({ skillId: def.id, name: def.name, defId: id, aim: { mode, x: plan.point.x, y: plan.point.y, alt: true } });

        if (mode === 'aim') {
          // the point is the aim (clamped to the arena, then to the alt's aim range)
          const clamped = { x: Math.min(Math.max(P.x, ARENA_MARGIN), s.plan.arena.width - ARENA_MARGIN), y: Math.min(Math.max(P.y, ARENA_MARGIN), s.plan.arena.height - ARENA_MARGIN) };
          if (def.aimRange == null) expect(near(plan.point, clamped)).toBe(true);
          else expect(Math.hypot(plan.point.x - from.x, plan.point.y - from.y)).toBeLessThanOrEqual(def.aimRange + 1e-9);
          // 조준 moves the character only by its own rush (버서커 6칸, 섀도우 8칸), along the aim
          const rush = def.actions.find(a => a.dash && !a.dash.atFire);
          const moved = Math.hypot(me.pos.x - from.x, me.pos.y - from.y);
          if (!rush) expect(near(me.pos, from)).toBe(true);
          else {
            // toward the aim, its data distance (an arena edge stops it: it slides along like every dash)
            expect(moved).toBeGreaterThan(0.5);
            expect(moved).toBeLessThanOrEqual(rush.dash!.distance + 1e-9);
            const mg = Math.max(ARENA_MARGIN, Math.min(me.radius, 1));
            expect(near(me.pos, dashEnd(from, 'right', rush.dash!.distance, s.plan.arena, mg, plan.aimDeg), 1e-9), 'rushes toward the aim').toBe(true);
          }
        } else {
          // 드래그: lands on the dragged point (in reach), by its own move
          expect(near(plan.move!.to, P, 1e-9)).toBe(true);
          expect(Math.hypot(P.x - from.x, P.y - from.y)).toBeLessThanOrEqual(def.move!.maxRange);
          const moveEv = ev.find(e => (e.type === 'dash' || e.type === 'blink') && e.entityId === me.id);
          expect(moveEv?.type).toBe(def.move!.kind);
          // the first streak / blink is the move itself (블레이드 then rushes 7 more)
          if (moveEv && (moveEv.type === 'dash' || moveEv.type === 'blink')) expect(near(moveEv.to, P, 1e-9)).toBe(true);
        }

        // every part of the cast carries the alt id (the path hit its own `<id>_path`), one cast per data part
        const casts = ev.filter((e): e is Cast => e.type === 'skillCast' && e.player === 0 && e.slot === 'ult');
        const own = casts.filter(c => c.skillId === def.id);
        expect(own).toHaveLength(def.actions.length);
        expect(casts.filter(c => c.skillId === `${def.id}_path`)).toHaveLength(mode === 'drag' && def.move!.path ? 1 : 0);
        expect(casts.length).toBe(own.length + (mode === 'drag' && def.move!.path ? 1 : 0));
        // 보이는 곳 = 맞는 곳: each part (self-only parts have no footprint) is where the live preview drew it
        let k = 0;
        plan.actions.forEach((a: SkillAction, i: number) => {
          if (a.affects === 'self') return;
          const c = own.find(x => x.actionIndex === i)!;
          const part = preview[k++];
          expect(near(c.center, part.center), `${def.id} #${i} ${a.stage}`).toBe(true);
          // a charge part's band too: as long as the path really travelled (+ the body), cut short by a wall
          expect(c.area, `${def.id} #${i} ${a.stage}`).toEqual(part.area);
          // 'point' parts sit on the aimed point / the landing spot (+ their turned offset)
          if (a.center === 'point' && !a.offset) expect(near(c.center, plan.point), `${def.id} #${i}`).toBe(true);
        });
        expect(k).toBe(preview.length);

        const landed = { x: plan.point.x, y: plan.point.y };
        const at = mode === 'aim' && id === 'mage' ? from : landed;
        expect(() => advance(tg, 0.8)).not.toThrow();
        if (id === 'blade' && mode === 'drag') {
          // 천검 삼연섬: 7 cells on through at once, then back onto the landing spot at 0.75 s
          expect(Math.hypot(me.pos.x - landed.x, me.pos.y - landed.y)).toBeLessThan(0.5);
        }
        expect(() => advance(tg, 0.3)).not.toThrow();
        SOON[id]?.(tg, mode, at);
        expect(() => advance(tg, 10)).not.toThrow();
        expect(s.phase).toBe('combat');
        // …and where each part first really LANDED (skillStage hit 0) is that spot too. A part that follows on purpose
        // (버서커 마무리 일격, a 'target' part riding a moving boss, the blade's storm waves) starts there, not checked
        expectLandedWherePreviewed(drain(tg), def.id, plan.actions, preview);
        expect(ultDamage(tg, def.name), `${def.id} hurts the boss`).toBeGreaterThan(0);
        expect(s.players[0].stats.ultsUsed).toBe(1);
      });
    }
  }
});

describe('드래그 reach: maxRange and the arena clamp', () => {
  it('a point off the arena: each lands inside, at most maxRange away, on the line toward the clamped point', () => {
    for (const id of IDS) {
      const def = alt(id, 'drag');
      for (const P of [
        { x: -50, y: 60 },
        { x: 80, y: -30 },
      ]) {
        const tg = ultGame(id, 'drag', FIXED);
        const s = tg.w.state;
        const me = activeEntity(tg.w, s.players[0])!;
        const from = { x: me.pos.x, y: me.pos.y };
        expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: P } }).ok, id).toBe(true);
        const ev = drain(tg);
        // the landing spot (블레이드 then rushes 7 cells on at once — the move is its first streak)
        const ult = ev.find((e): e is UltCast => e.type === 'ultCast')!;
        const to = { x: ult.aim!.x, y: ult.aim!.y };
        const mv = ev.find(e => (e.type === 'dash' || e.type === 'blink') && e.entityId === me.id);
        expect(mv && (mv.type === 'dash' || mv.type === 'blink') && near(mv.to, to, 1e-9), id).toBe(true);
        const d = Math.hypot(to.x - from.x, to.y - from.y);
        expect(d, id).toBeLessThanOrEqual(def.move!.maxRange + 1e-9);
        expect(d, id).toBeGreaterThan(def.move!.maxRange - 1.5); // the arena is wide enough: it really went
        const m = ARENA_MARGIN;
        expect(to.x, id).toBeGreaterThanOrEqual(m - 1e-9);
        expect(to.x, id).toBeLessThanOrEqual(s.plan.arena.width - m + 1e-9);
        expect(to.y, id).toBeGreaterThanOrEqual(m - 1e-9);
        expect(to.y, id).toBeLessThanOrEqual(s.plan.arena.height - m + 1e-9);
        // on the line from where it stood toward the dragged point pulled into the arena (the arena is convex)
        const mg = Math.max(ARENA_MARGIN, Math.min(me.radius, 1));
        const cp = { x: Math.min(Math.max(P.x, mg), s.plan.arena.width - mg), y: Math.min(Math.max(P.y, mg), s.plan.arena.height - mg) };
        const u = { x: cp.x - from.x, y: cp.y - from.y };
        expect(Math.abs(u.x * (to.y - from.y) - u.y * (to.x - from.x)) / Math.hypot(u.x, u.y), id).toBeLessThan(1e-6);
        expect(u.x * (to.x - from.x) + u.y * (to.y - from.y), id).toBeGreaterThan(0);
        // 기획 24차: 섀도우 드래그 no longer slides on — only the blade's rush moves it past the landing
        if (id !== 'blade') expect(near(me.pos, to, 1e-9), id).toBe(true);
        expect(() => advance(tg, 3)).not.toThrow();
      }
    }
  });

  it('팔라딘 조준: the great cross falls at most 9 cells away (aimRange), on the line toward the aim', () => {
    const tg = ultGame('paladin', 'aim', FIXED);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { x: me.pos.x, y: me.pos.y };
    const P = { x: 23.5, y: 11.5 };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: P } });
    advance(tg, 1.3);
    const cross = drain(tg).find((e): e is Cast => e.type === 'skillCast' && e.stage === 'tribunal')!;
    const d = Math.hypot(cross.center.x - from.x, cross.center.y - from.y);
    expect(d).toBeLessThanOrEqual(9 + 1e-9);
    expect(d).toBeGreaterThan(8.9);
  });
});

describe('boss forms: a roaming and an arena boss', () => {
  for (const boss of [ROAMING, ARENA]) {
    it(`${boss}: all sixteen cast at the bot's aim, land on numbers, hurt it, 10 s clean`, () => {
      for (const id of IDS) {
        for (const mode of MODES) {
          const def = alt(id, mode);
          const tag = `${boss} ${def.id}`;
          const tg = ultGame(id, mode, boss);
          const aim = botUltAim(tg.w.state, 0)!;
          expect(aim.mode, tag).toBe(mode);
          expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok, tag).toBe(true);
          expect(() => advance(tg, 10), tag).not.toThrow();
          const ev = drain(tg);
          const casts = ev.filter((e): e is Cast => e.type === 'skillCast' && e.player === 0 && e.slot === 'ult');
          expect(casts.filter(c => c.skillId === def.id), tag).toHaveLength(def.actions.length);
          for (const c of casts) expect(finite(c.center), `${tag} ${c.stage}`).toBe(true);
          for (const e of tg.w.state.entities) expect(finite(e.pos), tag).toBe(true);
          expect(ultDamage(tg, def.name), tag).toBeGreaterThan(0);
          expect(tg.w.state.players[0].stats.ultsUsed, tag).toBe(1);
        }
      }
    });
  }
});

// ─────────────────────────── 기획 23차: the climax, the renamed beats, the new / retimed parts (docs/ult-fx.md 3장 A1–A16) ───────────────────────────

type StageEv = Extract<GameEvent, { type: 'skillStage' }>;

/** Cast for real (as the fixed-boss test does) and watch every skillStage of mine for `secs`, with its time after the release. */
function watch(id: string, mode: Mode, secs: number): { tg: TestGame; plan: NonNullable<ReturnType<typeof planUlt>>; from: Vec2; stopped: Vec2; stages: { t: number; ev: StageEv }[] } {
  const tg = ultGame(id, mode, FIXED);
  const s = tg.w.state;
  const me = activeEntity(tg.w, s.players[0])!;
  const boss = bossOf(tg);
  const from = { x: me.pos.x, y: me.pos.y };
  const P = mode === 'aim' ? { x: boss.pos.x, y: boss.pos.y } : { x: boss.pos.x - 1, y: boss.pos.y + boss.radius + 1 };
  const aim: UltAim = { mode, point: P };
  const plan = planUlt(s, 0, aim)!;
  expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
  const stopped = { x: me.pos.x, y: me.pos.y }; // where the move / a rush left it at the release
  clearEvents(tg);
  const stages: { t: number; ev: StageEv }[] = [];
  const dt = 1 / 30;
  for (let t = dt; t <= secs + 1e-9; t += dt) {
    advance(tg, dt);
    for (const e of drain(tg)) if (e.type === 'skillStage' && e.player === 0 && e.hit === 0) stages.push({ t, ev: e });
    tg.events.length = 0;
  }
  return { tg, plan, from, stopped, stages };
}

/** The first landing of a stage (by its order among the stage's parts). */
const landing = (w: ReturnType<typeof watch>, skillId: string, stage: string, nth = 0) => w.stages.filter(x => x.ev.skillId === skillId && x.ev.stage === stage)[nth];
const unit = (a: Vec2, b: Vec2) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

describe('기획 23차: the climax and the beats', () => {
  it('every alt names its finale (an enemy stage) and the climax lands between 0.8 and 2.45 s; its sound overrides are its own stages', () => {
    for (const id of IDS) {
      for (const mode of MODES) {
        const def = alt(id, mode);
        expect(def.finale, def.id).toBeTruthy();
        expect(def.actions.some(a => a.stage === def.finale && a.affects === 'enemies'), `${def.id} finale ${def.finale}`).toBe(true);
        const b = ultBeats(def.id)!;
        expect(b.beats[b.finisher].stage, def.id).toBe(def.finale);
        expect(b.finisherKind, def.id).toBe('strike');
        expect(b.finisherAt, def.id).toBeGreaterThanOrEqual(0.8 - 1e-9);
        expect(b.finisherAt, def.id).toBeLessThanOrEqual(2.45 + 1e-9);
        for (const key of Object.keys(def.sfx ?? {})) {
          if (key === '_path') expect(def.move?.path, `${def.id} sfx _path`).toBeDefined();
          else expect(def.actions.some(a => a.stage === key), `${def.id} sfx ${key}`).toBe(true);
        }
      }
    }
  });

  it('기획 24차 검토: 레인저’s hawk swoop (조준 skyshot, 드래그 pierce) is a clean airy whoosh (dash.melee), never ult.ranger.tick (its file is mostly a sub-40 Hz pulse)', () => {
    const cues = (d: UltAltDef, stage: string) => {
      const v = d.sfx?.[stage];
      return v == null ? [] : Array.isArray(v) ? v : [v];
    };
    for (const [mode, stage] of [
      ['aim', 'skyshot'],
      ['drag', 'pierce'],
    ] as const) {
      const c = cues(alt('ranger', mode), stage);
      expect(c.map(x => x.id), `${mode} ${stage}`).toContain('dash.melee');
      expect(c.map(x => x.id), `${mode} ${stage}`).not.toContain('ult.ranger.tick');
    }
    for (const id of IDS) for (const mode of MODES) for (const st of Object.keys(alt(id, mode).sfx ?? {})) expect(cues(alt(id, mode), st).map(x => x.id)).not.toContain('ult.ranger.tick');
  });

  it('each beat has its own stage name (the renames of 3장): the drag skill rows play the matching sounds', () => {
    const stages = (d: UltAltDef) => d.actions.map(a => a.stage);
    expect(stages(alt('guardian', 'aim'))).toEqual(['aegis', 'rally', 'citadel', 'wave', 'barrier', 'barrier']);
    expect(stages(alt('guardian', 'drag'))).toEqual(['slam', 'aegis', 'citadel', 'barrier', 'barrier', 'wave']);
    expect(alt('guardian', 'drag').move?.path?.stage).toBe('rally');
    expect(stages(alt('paladin', 'drag'))).toEqual(['brand', 'blessing', 'tribunal', 'core']);
    expect(alt('paladin', 'drag').move?.path?.stage).toBe('blessing');
    expect(alt('paladin', 'drag').sfx).toEqual({ _path: null });
    expect(stages(alt('blade', 'drag'))).toEqual(['dash', 'return', 'issen']);
    expect(stages(alt('berserker', 'aim'))).toEqual(['split', 'frenzy', 'roar', 'quake', 'finale']);
    expect(stages(alt('berserker', 'drag'))).toEqual(['slam', 'frenzy', 'split', 'quake', 'quake', 'quake']);
    // 기획 24차: the redesigned three
    expect(stages(alt('shadow', 'drag'))).toEqual(['clone', 'dance', 'dance', 'dance', 'dance', 'dance', 'dance', 'moon']);
    expect(stages(alt('ranger', 'drag'))).toEqual(['volley', 'pin', 'pierce']);
    expect(stages(alt('ranger', 'aim'))).toEqual(['mark', 'rain', 'rain', 'rain', 'skyshot']);
    expect(stages(alt('mage', 'aim'))).toEqual(['blizzard', 'hail', 'hail', 'hail', 'hail', 'hail', 'freeze', 'shatter']);
    // the paladin's eight spears warn only briefly (the falling spear is the warning)
    for (const a of alt('paladin', 'aim').actions.filter(x => x.stage === 'spear')) expect(a.telegraphLead).toBe(0.15);
  });

  it('가디언: 성채 전개 bursts on the aimed point at 1.5 s; 성벽 돌파 surges from 1.5 in front of the wall at 1.6 s', () => {
    const a = watch('guardian', 'aim', 1.7);
    const wave = landing(a, 'guardian_ua', 'wave');
    expect(wave.t).toBeCloseTo(1.5, 1);
    expect(near(wave.ev.center, a.plan.point, 1e-6)).toBe(true);
    expect(landing(a, 'guardian_ua', 'citadel').t).toBeCloseTo(0.85, 1);
    const d = watch('guardian', 'drag', 1.8);
    const u = unit(d.from, d.plan.point);
    const surge = landing(d, 'guardian_ud', 'wave');
    expect(surge.t).toBeCloseTo(1.6, 1);
    expect(near(surge.ev.center, { x: d.plan.point.x + u.x * 1.5, y: d.plan.point.y + u.y * 1.5 }, 1e-6)).toBe(true);
    expect(near(landing(d, 'guardian_ud', 'slam').ev.center, d.plan.point, 1e-6)).toBe(true);
  });

  it('워든 조준: the cage falls at 1 s (after the reel-in), the release at 6 s', () => {
    const w = watch('warden', 'aim', 6.1);
    expect(landing(w, 'warden_ua', 'hook').t).toBeCloseTo(0.45, 1);
    expect(landing(w, 'warden_ua', 'cage').t).toBeCloseTo(1, 1);
    expect(landing(w, 'warden_ua', 'release').t).toBeCloseTo(6, 1);
  });

  it('버서커: 혈귀 낙하 slams where the rush stopped at 1.5 s; the drag erupts three times along the crack, back toward the landing (7 · 4.5 · 1.5 cells, 1.25 / 1.38 / 1.5 s)', () => {
    const a = watch('berserker', 'aim', 1.6);
    const quake = landing(a, 'berserker_ua', 'quake');
    expect(quake.t).toBeCloseTo(1.5, 1);
    expect(near(quake.ev.center, a.stopped, 1e-6)).toBe(true);
    expect(landing(a, 'berserker_ua', 'split').t).toBeCloseTo(0.45, 1);
    const d = watch('berserker', 'drag', 1.6);
    const u = unit(d.from, d.plan.point);
    const times = [1.25, 1.38, 1.5];
    for (const [i, x] of [7, 4.5, 1.5].entries()) {
      const g = landing(d, 'berserker_ud', 'quake', i);
      expect(g, `geyser ${i}`).toBeDefined();
      expect(g.t).toBeCloseTo(times[i], 1);
      expect(near(g.ev.center, { x: d.plan.point.x + u.x * x, y: d.plan.point.y + u.y * x }, 1e-6), `geyser ${i}`).toBe(true);
    }
    expect(d.stages.some(x => x.ev.stage === 'finale')).toBe(false); // the old 10-cell aftershock is gone
  });

  it('섀도우 조준: the ★ crescent falls on the aimed point at 1.4 s (at most 8 cells away), the rush still runs its 8 cells', () => {
    const w = watch('shadow', 'aim', 1.5);
    const moon = landing(w, 'shadow_ua', 'moon');
    expect(moon.t).toBeCloseTo(1.4, 1);
    expect(near(moon.ev.center, w.plan.point, 1e-6)).toBe(true);
    expect(Math.hypot(w.plan.point.x - w.from.x, w.plan.point.y - w.from.y)).toBeLessThanOrEqual(8 + 1e-9);
    expect(Math.hypot(w.stopped.x - w.from.x, w.stopped.y - w.from.y)).toBeGreaterThan(0.5);
  });

  // 기획 23차 검토: the ★ fell past a boss the berserker dropped onto (9 cells ahead of its near edge) and past a boss the
  // shadow stood next to (where its 8-cell rush stopped) — now it meets the boss it was cast on
  it('the ★ meets the boss it was cast on: 버서커 드래그 dropped on it, 섀도우 조준 aimed at it from melee range or further', () => {
    const misses: string[] = [];
    const cases: [string, Mode, number[]][] = [
      ['berserker', 'drag', [2.5, 6, 11]],
      ['shadow', 'aim', [0.5, 1.5, 4, 6]],
    ];
    for (const [id, mode, dists] of cases) {
      const def = alt(id, mode);
      const b = ultBeats(def.id)!;
      for (const boss of ['washer_drum', 'reverse_escalator', 'dead_monitor', 'elevator_keeper', 'tank_dweller']) {
        for (const d of dists) {
          for (const side of [-1, 1]) {
            const tg = makeGame({ seed: 7, mode: 'ultTest', players: [{ ...HUMAN, characters: [id, 'cleric', 'bard'], ultMode: mode }], tunables: { invincible: true }, bossRaid: { onlyBoss: boss, hpMult: 50 } });
            advance(tg, 2.5);
            const be = bossOf(tg);
            const me = activeEntity(tg.w, tg.w.state.players[0])!;
            me.pos.x = be.pos.x + side * (be.radius + me.radius + d - 0.5);
            me.pos.y = be.pos.y;
            if (me.pos.x < 1 || me.pos.x > tg.w.state.plan.arena.width - 1) continue;
            tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
            clearEvents(tg);
            expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point: { x: be.pos.x, y: be.pos.y } } }).ok).toBe(true);
            advance(tg, b.finisherAt + 0.3);
            // the boss damage between the part before it and the finisher's own landing is the finisher's
            let pending = 0;
            let fin = -1;
            for (const e of drain(tg)) {
              if (e.type === 'damage' && e.targetId === be.id && e.skillName === def.name) pending += e.amount;
              if (e.type === 'skillStage' && e.skillId === def.id) {
                if (e.actionIndex === b.finisher && fin < 0) fin = pending;
                pending = 0;
              }
            }
            if (!(fin > 0)) misses.push(`${def.id} ${boss} ${d}${side < 0 ? 'L' : 'R'}: ${fin < 0 ? 'no finisher' : 'missed'}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  }, 30_000);

  it('메이지 조준: the blizzard 2 s, five icicles inside the fan (0.9 → 1.7 s), freeze 2.05 s, shatter 2.45 s', () => {
    const m = watch('mage', 'aim', 2.6);
    const u = unit(m.from, m.plan.point);
    const icicles = m.stages.filter(x => x.ev.skillId === 'mage_ua' && x.ev.stage === 'hail');
    expect(icicles.map(x => Math.round(x.t * 10) / 10)).toEqual([0.9, 1.1, 1.3, 1.5, 1.7]);
    for (const ic of icicles) {
      // inside the fan (radius 8, 80°) the mage cast from
      const dx = ic.ev.center.x - m.from.x;
      const dy = ic.ev.center.y - m.from.y;
      const dist = Math.hypot(dx, dy);
      expect(dist).toBeLessThanOrEqual(8);
      expect((dx * u.x + dy * u.y) / dist).toBeGreaterThan(Math.cos((40 * Math.PI) / 180));
    }
    expect(landing(m, 'mage_ua', 'freeze').t).toBeCloseTo(2.05, 1);
    expect(landing(m, 'mage_ua', 'shatter').t).toBeCloseTo(2.45, 1);
    // the fan's field is gone by then (2 s from 0.45)
    expect(m.tg.w.state.zones.some(z => z.ownerPlayer === 0 && z.area?.shape === 'cone')).toBe(false);
  });
});

// ─────────────────────────── 기획 24차: the three redesigned (docs/ult-fx.md 8-3 A12′–A14′) ───────────────────────────

describe('기획 24차: 섀도우 드래그 · 레인저 조준 / 드래그 redesigned', () => {
  /** [character, mode, its parts' stages in landing order, when each lands (s after the release)]. */
  const REDONE: [string, Mode, string[], number[]][] = [
    ['shadow', 'drag', ['clone', 'dance', 'dance', 'dance', 'dance', 'dance', 'dance', 'moon'], [0.45, 0.6, 0.7, 0.79, 0.87, 0.94, 1, 1.5]],
    ['ranger', 'aim', ['mark', 'rain', 'rain', 'rain', 'skyshot'], [0.45, 0.8, 1.05, 1.3, 1.9]],
    ['ranger', 'drag', ['volley', 'pin', 'pierce'], [0.5, 1.1, 1.5]],
  ];

  it('the climax: 흑월 1.5 s, 천공 강하 1.9 s (was 2.3), 관통 1.5 s (was 1.25)', () => {
    expect(ultBeats('shadow_ud')!.finisherAt).toBeCloseTo(1.5, 9);
    expect(ultBeats('ranger_ua')!.finisherAt).toBeCloseTo(1.9, 9);
    expect(ultBeats('ranger_ud')!.finisherAt).toBeCloseTo(1.5, 9);
    // the new beats' roles: the first enemy part opens, the rest build up to the finale
    for (const [id, mode, stages] of REDONE) {
      const b = ultBeats(alt(id, mode).id)!;
      expect(b.beats.map(x => x.role), `${id} ${mode}`).toEqual(stages.map((_, i) => (i === 0 ? 'opener' : i === stages.length - 1 ? 'finisher' : 'build')));
    }
  });

  it('on the fixed boss every part lands when the table says and hits it (targets ≥ 1)', () => {
    for (const [id, mode, stages, times] of REDONE) {
      const def = alt(id, mode);
      const w = watch(id, mode, times[times.length - 1] + 0.2);
      const mine = w.stages.filter(x => x.ev.skillId === def.id);
      expect(mine.map(x => x.ev.stage), def.id).toEqual(stages);
      mine.forEach((x, i) => {
        const tag = `${def.id} #${i} ${x.ev.stage}`;
        expect(x.t, tag).toBeCloseTo(times[i], 1);
        expect(x.ev.targets, tag).toBeGreaterThanOrEqual(1);
      });
    }
  });

  it('섀도우 드래그: the six cuts cross its target (each band through the boss, turned 0° · 60° · 120° · 30° · 90° · 150° from the way it moved); the shadow stays where it landed', () => {
    const w = watch('shadow', 'drag', 1.7);
    const boss = bossOf(w.tg);
    const cuts = w.stages.filter(x => x.ev.skillId === 'shadow_ud' && x.ev.stage === 'dance');
    expect(cuts).toHaveLength(6);
    // rel 'aim' in 드래그 = the way it moved (from where it stood to the landing spot)
    const moved = (Math.atan2(w.plan.point.y - w.from.y, w.plan.point.x - w.from.x) * 180) / Math.PI;
    for (const [i, c] of cuts.entries()) {
      // centred on the boss (it follows it), 9 long, 1.8 wide (기획 24차 검토: was 7 × 1.4)
      expect(near(c.ev.center, boss.pos, 1e-6), `cut ${i}`).toBe(true);
      expect(c.ev.area).toMatchObject({ shape: 'rect', anchor: 'center', length: 9, width: 1.8 });
      const rot = c.ev.area.shape === 'rect' ? c.ev.area.rot! : NaN;
      const want = (((moved + [0, 60, 120, 30, 90, 150][i]) % 360) + 360) % 360;
      const diff = Math.abs((((rot - want) % 360) + 540) % 360 - 180);
      expect(diff, `cut ${i}: rot ${rot}, want ${want}`).toBeLessThan(1e-6);
    }
    // no slide, no rush any more: it stands on the landing spot at the release and no part moves it
    expect(near(w.stopped, w.plan.point, 1e-9)).toBe(true);
    expect(alt('shadow', 'drag').actions.some(a => a.dash || a.charge)).toBe(false);
  });
});

describe('bots', () => {
  /** Three bot seats sharing the eight characters (블레이드 twice), ults every few seconds. */
  const seats = (mode: Mode): PlayerSetup[] => [
    { ...BOT1, name: 'A', characters: ['guardian', 'blade', 'ranger'], ultMode: mode },
    { ...BOT2, name: 'B', characters: ['paladin', 'berserker', 'mage'], ultMode: mode },
    { ...BOT1, name: 'C', characters: ['warden', 'shadow', 'blade'], ultMode: mode },
  ];
  const run = (mode: Mode, boss: string) => {
    const tg = makeGame({ seed: 41, mode: 'ultTest', players: seats(mode), tunables: { invincible: true, ultFieldChargeTime: 3 }, bossRaid: { onlyBoss: boss, hpMult: 50 } });
    advance(tg, 60);
    return { tg, ults: drain(tg).filter((e): e is UltCast => e.type === 'ultCast') };
  };

  for (const mode of MODES) {
    it(`in ${mode === 'aim' ? '조준' : '드래그'} they cast every group-A ult within 60 s (fixed / roaming / arena boss), the same way twice`, () => {
      for (const boss of [FIXED, ROAMING, ARENA]) {
        const { tg, ults } = run(mode, boss);
        expect(tg.w.state.phase, boss).toBe('combat');
        for (const u of ults) {
          expect(u.aim, `${boss} ${u.skillId}`).toMatchObject({ mode, alt: true });
          expect(u.skillId, boss).toBe(alt(u.defId, mode).id);
          expect(Number.isFinite(u.aim!.x) && Number.isFinite(u.aim!.y), boss).toBe(true);
        }
        expect(new Set(ults.map(u => u.defId)), boss).toEqual(new Set(IDS));
      }
      // no randomness in the aims: the same seed plays the same
      const a = run(mode, ROAMING).ults;
      const b = run(mode, ROAMING).ults;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  }
});
