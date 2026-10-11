// 기획 19차 보스 레이드 — 사무실 bosses (docs/bosses.md 2장): 문서 파쇄기 · 식지 않는 커피 머신 · 퇴근 못 한 모니터 ·
// 끝나지 않는 회의. The shared contract of a new boss (expectBossContract), the table's numbers, the order and shapes
// of their warnings, phase / enrage / groggy, the patterns that carry the fight (세단 = the gaps are safe, 웅덩이 =
// puddles that stay, 팝업 광고 = three fixed spots (규칙 M4), 회의 연장 = a shield + haste on itself that a groggy break
// cancels (규칙 M1)), bots-only fights and the looks / voices.
//
// After a retune (docs/boss-raid.md 1장: 예고 시간 · 범위 크기 · 수치 are expected to change after playtests): the numbers
// are copied in THREE tables only — TABLE, DAMAGE (+ its riders) and SHAPES in the first two blocks. The pattern tests
// further down read their timings and sizes from the data (part / wait below), so they follow a retune by themselves
// unless the pattern itself changes (e.g. the comb's strips no longer leave a lane). Then: npx vite-node
// tests/review/boss-table.ts write.
import { describe, expect, it } from 'vitest';
import { BOSS_POS, DEFAULT_TUNABLES } from '../../src/config';
import { BOSSES, BOSS_RAID_BAND, BOSS_UNITS, ZONE_BOSSES, getBoss, getMonster } from '../../src/data';
import { ENRAGE, at } from '../../src/data/bosses';
import { BOSS_VOICE } from '../../src/audio/synth/bossVoices';
import { type BossDrawOpts, drawBossArt } from '../../src/render/boss';
import { BOSS_TELE_MOTIF, MINION_LOOKS, bossLook } from '../../src/render/bosses';
import { BOSS_DROP } from '../../src/render/bosses/kit';
import { Camera } from '../../src/render/camera';
import { unitLook } from '../../src/render/look';
import { applyDamage } from '../../src/sim/combat';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { groggyMax } from '../../src/sim/groggy';
import { justCue } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { hasStatus, statusValue } from '../../src/sim/status';
import { monsterCdMult } from '../../src/sim/units';
import type { SimEntity } from '../../src/sim/world';
import type { AreaShape, Effect, GameEvent, MonsterSkill, SkillAction, StatusId, Telegraph, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, partsOf, raidGame } from './bossRaidHelpers';

const IDS = ['shredder_maw', 'coffee_machine', 'dead_monitor', 'endless_meeting'] as const;
type Id = (typeof IDS)[number];
const CALM = { invincible: true, bossGroggyThreshold: 0 } as const;

type Cast = Extract<GameEvent, { type: 'skillCast' }>;

/** The boss's own casts so far, in order. */
function bossCasts(tg: TestGame): Cast[] {
  const id = tg.w.state.bossId;
  return drain(tg).filter((e): e is Cast => e.type === 'skillCast' && e.sourceId === id);
}

/** A long calm fight against `id` (party invincible, no groggy, the boss never dies). */
function calm(id: Id, players = [HUMAN]): TestGame {
  return raidGame(id, { hpMult: 50, players, tunables: CALM });
}

/** The boss stops casting by itself (the test casts single skills by hand). */
function silence(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.skills = [];
  b.rt.skillCds = [];
  b.rt.phase = 99;
}

/**
 * A silent fight where hits really land (damage events) but nobody dies: the boss hits like a feather, casts nothing by
 * itself and never fires its basic shot — so every damage event on a character is a skill hit.
 */
function soft(id: Id, players = [HUMAN], groggy = false, knobs: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 50, players, tunables: { monsterDmgMult: 0.01, ...(groggy ? null : { bossGroggyThreshold: 0 }), ...knobs } });
  silence(tg);
  bossOf(tg).rt.attackCd = 1e9;
  advance(tg, 0.2); // the boss picks its target
  clearEvents(tg);
  return tg;
}

function skill(id: Id, skillId: string): MonsterSkill {
  const sk = allSkills(getBoss(id)).find(s => s.id === skillId);
  if (!sk) throw new Error(`no skill ${skillId}`);
  return sk;
}

/** Part `i` of a skill, as written in the data (the pattern tests take their timings and sizes from here). */
function part(id: Id, skillId: string, i = 0): SkillAction {
  const a = partsOf(skill(id, skillId))[i];
  if (!a) throw new Error(`no part ${i} of ${skillId}`);
  return a;
}

/** Seconds of warning before part `i` lands. */
const wait = (id: Id, skillId: string, i = 0): number => part(id, skillId, i).delay ?? 0;

/** The footprint of part `i`, narrowed to its shape. */
function areaOf<S extends AreaShape['shape']>(id: Id, skillId: string, shape: S, i = 0): Extract<AreaShape, { shape: S }> {
  const a = part(id, skillId, i).area;
  if (a.shape !== shape) throw new Error(`${skillId}[${i}] is a ${a.shape}, not a ${shape}`);
  return a as Extract<AreaShape, { shape: S }>;
}

/** The status rider of a part (burn / slow / haste …). */
function rider(a: SkillAction, status: StatusId): Extract<Effect, { kind: 'status' }> {
  const fx = a.effects.find((e): e is Extract<Effect, { kind: 'status' }> => e.kind === 'status' && e.status === status);
  if (!fx) throw new Error(`no ${status} rider`);
  return fx;
}

/** A moment after a hit lands (longer than a tick, shorter than any gap between two parts). */
const AFTER = 0.1;

/** Cast every part of one real skill from the boss at `target` (as the boss would). */
function castSkill(tg: TestGame, id: Id, skillId: string, target: SimEntity): void {
  const b = bossOf(tg);
  b.targetId = target.id;
  const sk = skill(id, skillId);
  partsOf(sk).forEach((a, i) => startAction(tg.w, unitCtx(tg.w, b, sk.id, sk.name), a, undefined, i));
}

/** Hold a character still at a spot. */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 999;
}

/** Hits `e` took so far (in a soft fight: skill hits only — a monster skill's damage carries the source 'basic' too). */
function skillHits(tg: TestGame, e: SimEntity): number {
  return eventsOf(tg, 'damage').filter(d => d.targetId === e.id).length;
}

/** Hits on any character so far (in a soft fight: skill hits only). */
function partyHits(tg: TestGame): number {
  return eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally').length;
}

/** Does the warning cover a point (a body of radius r)? */
const covers = (t: Telegraph, p: Vec2, r = 0) => hitsArea(t.area, t.center, t.origin, p, r);

/** Warnings as [shape, seconds], in cast order. */
const warnings = (tg: TestGame) => tg.w.state.telegraphs.map(t => [t.area.shape, t.total]);

describe('사무실: the zone table', () => {
  it('has five bosses — the four new ones with data, then 야근의 군주; bands 앞 · 앞 · 중 · 뒤', () => {
    expect(ZONE_BOSSES.office).toEqual([...IDS, 'overtime_lord']);
    expect(BOSSES.filter(b => b.zone === 'office').map(b => b.id).sort()).toEqual([...IDS, 'overtime_lord'].sort());
    expect(IDS.map(id => BOSS_RAID_BAND[id])).toEqual(['early', 'early', 'mid', 'late']);
    // the classic boss of the zone is untouched
    const lord = getBoss('overtime_lord');
    expect([lord.stats.maxHp, lord.stats.atk, lord.stats.atkSpeed, lord.groggy?.threshold]).toEqual([9000, 30, 0.55, 1]);
    expect(allSkills(lord).map(sk => sk.id)).toEqual(['ol_paperstorm', 'ol_summon', 'ol_stamp', 'ol_stamp_combo']);
  });

  // HP / atk / atkSpeed / groggy, per skill [cooldown, first use], phase [name, HP line, atkSpeed ×, cooldown ×] (docs/bosses.md 2장)
  const TABLE: Record<Id, { name: string; stats: [number, number, number, number]; skills: Record<string, [number, number]>; phase: [string, number, number | undefined, number]; summons: string[]; hints: string[] }> = {
    shredder_maw: { name: '문서 파쇄기', stats: [8400, 30, 0.55, 0.9], skills: { sh_comb: [13, 4], sh_cuts: [9, 7], sh_badge: [10, 10], sh_cross: [14, 1.5] }, phase: ['걸림 해제', 0.5, 1.15, 0.85], summons: [], hints: ['sh_comb'] },
    coffee_machine: { name: '식지 않는 커피 머신', stats: [8800, 29, 0.5, 1], skills: { cf_pour: [9, 4], cf_steam: [10, 7], cf_capsules: [8, 10], cf_overflow: [16, 1.5] }, phase: ['넘침', 0.5, undefined, 0.85], summons: [], hints: [] },
    dead_monitor: { name: '퇴근 못 한 모니터', stats: [8600, 30, 0.55, 1], skills: { dm_popups: [16, 4], dm_cursor: [10, 7], dm_bluescreen: [8, 10], dm_storm: [11, 1.5] }, phase: ['재부팅 실패', 0.5, 1.15, 0.85], summons: ['error_popup', 'error_popup', 'error_popup'], hints: ['dm_cursor'] },
    endless_meeting: { name: '끝나지 않는 회의', stats: [7800, 30, 0.55, 1], skills: { em_call: [9, 4], em_agenda: [11, 7], em_extend: [20, 12], em_laser: [12, 1.5] }, phase: ['연장 회의', 0.5, undefined, 0.85], summons: [], hints: [] },
  };

  for (const id of IDS) {
    it(`${id}: the table's numbers`, () => {
      const def = getBoss(id);
      const row = TABLE[id];
      expect(def.name).toBe(row.name);
      expect(def.zone).toBe('office');
      expect([def.stats.maxHp, def.stats.atk, def.stats.atkSpeed, def.groggy?.threshold]).toEqual(row.stats);
      expect(Object.fromEntries(allSkills(def).map(sk => [sk.id, [sk.cooldown, sk.initialDelay]]))).toEqual(row.skills);
      const ph = def.phases![0];
      expect([ph.name, ph.hpBelow, ph.atkSpeedMult, ph.cooldownMult]).toEqual(row.phase);
      expect(def.enrage).toEqual(ENRAGE);
      const summons = allSkills(def).flatMap(sk => partsOf(sk)).flatMap(a => (a.summon ? [a.summon.unitId] : []));
      expect(summons).toEqual(row.summons);
      expect(allSkills(def).filter(sk => sk.hint).map(sk => sk.id)).toEqual(row.hints);
      // a tip never runs past one HUD line
      for (const sk of allSkills(def)) if (sk.hint) expect(sk.hint.length).toBeLessThanOrEqual(46);
    });
  }

  // damage × attack of every part, in cast order (0 = no damage: a summon / a buff on itself)
  const DAMAGE: Record<string, number[]> = {
    sh_comb: Array(12).fill(2.2), sh_cuts: [1.4], sh_badge: [3.2], sh_cross: Array(18).fill(1.8),
    cf_pour: [0.3], cf_steam: [1.3, 1.3], cf_capsules: [2, 2, 2], cf_overflow: [0.3],
    dm_popups: [0, 0, 0], dm_cursor: [2.8], dm_bluescreen: [2.4], dm_storm: [1.5, 1.5, 1.5, 1.5, 1.5],
    em_call: [3.4], em_agenda: [1.6, 2], em_extend: [0], em_laser: [2.2, 2.2, 2.2],
  };

  it('every part hits for the table amount; riders: burn 40 % / s, slows 30–40 %, shield 8 % + haste 25 %', () => {
    const ids = IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id));
    expect(Object.keys(DAMAGE).sort()).toEqual([...ids].sort());
    for (const id of IDS) {
      for (const sk of allSkills(getBoss(id))) {
        const dmg = partsOf(sk).map(a => a.effects.reduce((n, e) => n + (e.kind === 'damage' ? e.amount : 0), 0));
        expect(dmg, sk.id).toEqual(DAMAGE[sk.id]);
      }
    }
    const fx = (id: Id, skillId: string) => skill(id, skillId).action.effects.filter(e => e.kind !== 'damage');
    expect(fx('shredder_maw', 'sh_cuts')).toEqual([{ kind: 'status', status: 'burn', duration: 3, value: 0.4 }]);
    expect(fx('coffee_machine', 'cf_pour')).toEqual([{ kind: 'status', status: 'slow', duration: 1, value: 0.3 }]);
    expect(fx('coffee_machine', 'cf_steam')).toEqual([{ kind: 'status', status: 'slow', duration: 1.5, value: 0.4 }]);
    expect(fx('coffee_machine', 'cf_overflow')).toEqual([{ kind: 'status', status: 'slow', duration: 1, value: 0.3 }]);
    expect(fx('dead_monitor', 'dm_bluescreen')).toEqual([{ kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }]);
    expect(fx('endless_meeting', 'em_extend')).toEqual([{ kind: 'shield', amount: 0.08, duration: 8 }, { kind: 'status', status: 'haste', duration: 8, value: 0.25 }]);
    // lingering puddles: 7 s and 8 s, a tick every 0.5 s
    expect(skill('coffee_machine', 'cf_pour').action.zone).toEqual({ duration: 7, tickInterval: 0.5 });
    expect(skill('coffee_machine', 'cf_overflow').action.zone).toEqual({ duration: 8, tickInterval: 0.5 });
    // 스팀 = two parts 0.4 s apart (no multi-hit part on a boss: each puff has its own warning)
    expect(partsOf(skill('coffee_machine', 'cf_steam')).map(a => [a.delay, a.hits ?? 1])).toEqual([[1.2, 1], [1.6, 1]]);
  });

  it('오류 창: a summon-only turret (HP 220, attack 14, range 7, shot speed 9, 0.8 shots a second) that never moves', () => {
    const u = getMonster('error_popup');
    expect(BOSS_UNITS).toContain(u);
    expect(u.name).toBe('오류 창');
    expect([u.stats.maxHp, u.stats.atk, u.stats.range, u.stats.atkSpeed, u.radius, u.stats.moveSpeed]).toEqual([220, 14, 7, 0.8, 0.45, 0]);
    expect(u.basic).toEqual({ kind: 'projectile', speed: 9 });
    expect(u.stationary).toBe(true);
    expect(u.tier).toBe('normal');
  });
});

describe('사무실: the contract of a new boss', () => {
  for (const id of IDS) it(`${id}: shape, every skill within 45 s, phase → phase skill, kill → clear, same seed same fight`, () => expectBossContract(id), 30000);

  // 기획 19차 보스 튜닝 (docs/boss-raid.md 4-2): the same fights with the warnings stretched / the areas shrunk, and the other
  // way round — no pattern may depend on the numbers as written
  for (const id of IDS) {
    it(`${id}: the same contract with 예고 ×2 · 범위 ×0.5`, () => expectBossContract(id, { bossTelegraphMult: 2, bossAreaMult: 0.5 }), 30000);
    it(`${id}: the same contract with 예고 ×0.5 · 범위 ×2`, () => expectBossContract(id, { bossTelegraphMult: 0.5, bossAreaMult: 2 }), 30000);
  }
});

describe('사무실: warnings come in order, with the right footprints', () => {
  // first casts in a calm fight: skill ids by their first use, then the footprints of each skill's parts with their delays
  const ORDER: Record<Id, string[]> = {
    shredder_maw: ['sh_comb', 'sh_cuts', 'sh_badge'],
    coffee_machine: ['cf_pour', 'cf_steam', 'cf_capsules'],
    dead_monitor: ['dm_popups', 'dm_cursor', 'dm_bluescreen'],
    endless_meeting: ['em_call', 'em_agenda', 'em_extend'],
  };
  const rep = (shape: AreaShape['shape'], n: number, delay: number): [AreaShape['shape'], number][] => Array.from({ length: n }, () => [shape, delay]);
  const SHAPES: Record<string, [AreaShape['shape'], number][]> = {
    sh_comb: [...rep('rect', 6, 1.4), ...rep('rect', 6, 2.2)],
    sh_cuts: [['fan', 1.1]],
    sh_badge: [['single', 1.4]],
    sh_cross: [...rep('rect', 6, 1.2), ...rep('rect', 6, 1.6), ...rep('rect', 6, 2)],
    cf_pour: [['circle', 1]],
    cf_steam: [['fan', 1.2], ['fan', 1.6]],
    cf_capsules: [['circle', 1.2], ['circle', 1.4], ['circle', 1.6]],
    cf_overflow: [['ring', 1.5]],
    dm_popups: rep('circle', 3, 0),
    dm_cursor: [['line', 1.6]],
    dm_bluescreen: [['cross', 1.2]],
    dm_storm: [['circle', 1.2], ['circle', 1.4], ['circle', 1.6], ['circle', 1.8], ['circle', 2]],
    em_call: [['single', 1.6]],
    em_agenda: [['circle', 1.3], ['ring', 2.1]],
    em_extend: [['circle', 0.8]],
    em_laser: [['line', 1.2], ['line', 1.45], ['line', 1.7]],
  };

  for (const id of IDS) {
    it(`${id}: ${ORDER[id].join(' → ')}`, () => {
      const tg = calm(id);
      advance(tg, 14);
      const casts = bossCasts(tg);
      const firstUse = [...new Set(casts.map(c => c.skillId))];
      expect(firstUse).toEqual(ORDER[id]);
      for (const sk of getBoss(id).skills) {
        const mine = casts.filter(c => c.skillId === sk.id).slice(0, SHAPES[sk.id].length);
        expect(mine.map(c => [c.area.shape, c.delay ?? 0]), sk.id).toEqual(SHAPES[sk.id]);
      }
      // …and the phase skill, once its phase is on
      clearEvents(tg);
      crossPhase(tg);
      advance(tg, 4);
      const ph = getBoss(id).phases![0].skills![0];
      const mine = bossCasts(tg).filter(c => c.skillId === ph.id).slice(0, SHAPES[ph.id].length);
      expect(mine.map(c => [c.area.shape, c.delay ?? 0]), ph.id).toEqual(SHAPES[ph.id]);
    });
  }

  it('every skill of the zone is in the shape table (nothing unchecked); every hit is warned for at least 0.8 s', () => {
    const ids = IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id));
    expect(Object.keys(SHAPES).sort()).toEqual([...ids].sort());
    for (const [id, parts] of Object.entries(SHAPES)) for (const [, delay] of parts) if (delay > 0) expect(delay, id).toBeGreaterThanOrEqual(0.8);
  });
});

describe('사무실: phase, enrage, groggy', () => {
  for (const id of IDS) {
    it(`${id}: the phase starts under its HP line, enrage multiplies attack / speed / cooldowns, the gauge uses its threshold`, () => {
      const def = getBoss(id);
      const ph = def.phases![0];
      const tg = raidGame(id, { hpMult: 50, tunables: { invincible: true } });
      advance(tg, 1);
      const b = bossOf(tg);
      // floor 1: the table's HP × the knob, the table's attack
      expect(b.maxHp).toBeCloseTo(def.stats.maxHp * 50, 3);
      const calmStats = effStats(tg.w, b);
      expect(calmStats.atk).toBeCloseTo(def.stats.atk, 6);
      expect(calmStats.atkSpeed).toBeCloseTo(def.stats.atkSpeed, 6);
      // phase: nothing just above the line, the event just under it
      clearEvents(tg);
      b.hp = ph.hpBelow * b.maxHp + 1;
      advance(tg, 0.2);
      expect(eventsOf(tg, 'bossPhase')).toHaveLength(0);
      expect(monsterCdMult(b)).toBe(1);
      crossPhase(tg);
      expect(eventsOf(tg, 'bossPhase').map(e => [e.phase, e.name])).toEqual([[2, ph.name]]);
      expect(monsterCdMult(b)).toBeCloseTo(ph.cooldownMult ?? 1, 6);
      expect(effStats(tg.w, b).atkSpeed).toBeCloseTo(def.stats.atkSpeed * (ph.atkSpeedMult ?? 1), 6);
      // enrage on top
      expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
      const hot = effStats(tg.w, b);
      expect(hot.atk).toBeCloseTo(def.stats.atk * ENRAGE.atkMult, 6);
      expect(hot.atkSpeed).toBeCloseTo(def.stats.atkSpeed * (ph.atkSpeedMult ?? 1) * ENRAGE.atkSpeedMult, 6);
      expect(monsterCdMult(b)).toBeCloseTo((ph.cooldownMult ?? 1) * ENRAGE.cooldownMult, 6);
      // groggy: one human seat → base 100 × the boss's threshold; a forced break knocks it down
      expect(groggyMax(tg.w)).toBeCloseTo(DEFAULT_TUNABLES.bossGroggyThreshold * def.groggy!.threshold, 6);
      expect(tg.w.state.bossGroggy).not.toBeNull();
      expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
      advance(tg, 0.2);
      expect(eventsOf(tg, 'bossGroggy').some(e => e.entityId === b.id)).toBe(true);
    });
  }

  it('left alone, the floor timer enrages the boss at bossFloorTime (as on a classic boss floor)', () => {
    const tg = calm('coffee_machine');
    expect(tg.w.state.plan.timeLimit).toBe(DEFAULT_TUNABLES.bossFloorTime);
    expect(tg.w.state.plan.theme).toBe('lobby'); // floor 1 of the raid: the band's background, whatever the boss
    advance(tg, DEFAULT_TUNABLES.bossFloorTime - 1);
    expect(tg.w.state.bossEnraged).toBe(false);
    advance(tg, 1.2);
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(eventsOf(tg, 'enrage')).toHaveLength(1);
  });
});

/** A big single hit: it lands on the character it was aimed at wherever it walks; taking that card off the field makes it miss. */
function expectCalledOut(id: Id, skillId: string): void {
  const delay = wait(id, skillId);
  const tg = soft(id);
  const me = active(tg);
  pin(me, { x: 12, y: 6 });
  castSkill(tg, id, skillId, me);
  expect(warnings(tg)).toEqual([['single', delay]]);
  // walking does not help: the hit is on the character, not on the spot
  pin(me, { x: 5, y: 10 });
  advance(tg, delay + AFTER);
  expect(skillHits(tg, me)).toBe(1);
  expect(tg.w.state.telegraphs).toHaveLength(0);
  // again, with a plain swap half-way through the warning (well before the 저스트 window): nobody is hit
  clearEvents(tg);
  castSkill(tg, id, skillId, me);
  advance(tg, delay / 2);
  expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 18, y: 9 } }).ok).toBe(true);
  advance(tg, delay / 2 + 0.2);
  expect(partyHits(tg)).toBe(0);
}

describe('문서 파쇄기', () => {
  const SH: Id = 'shredder_maw';

  it('세단: comb A (x 0–2, 4–6 …) falls first, the gaps second — together they cover the floor, each alone leaves 2-wide lanes', () => {
    const tg = soft(SH, [HUMAN, HUMAN2]);
    const inA = active(tg, 0);
    const inB = active(tg, 1);
    pin(inA, { x: 5, y: 6 });
    pin(inB, { x: 3, y: 6 });
    const n = partsOf(skill(SH, 'sh_comb')).length / 2;
    const [first, second] = [wait(SH, 'sh_comb', 0), wait(SH, 'sh_comb', n)];
    expect(second).toBeGreaterThan(first);
    castSkill(tg, SH, 'sh_comb', inA);
    const tele = tg.w.state.telegraphs;
    expect(tele).toHaveLength(2 * n);
    const a = tele.filter(t => Math.abs(t.total - first) < 1e-6);
    const b = tele.filter(t => Math.abs(t.total - second) < 1e-6);
    expect([a.length, b.length]).toEqual([n, n]);
    for (const t of tele) expect(t.area).toEqual(part(SH, 'sh_comb').area);
    // the layout as written: strips 2 wide, one every 4 (rewrite this loop if the strip width or the spacing changes)
    for (let x = 0.25; x < 24; x += 0.5) {
      for (const y of [0.3, 6, 11.7]) {
        const even = Math.floor(x / 2) % 2 === 0;
        expect(a.some(t => covers(t, { x, y })), `A at ${x},${y}`).toBe(even);
        expect(b.some(t => covers(t, { x, y })), `B at ${x},${y}`).toBe(!even);
      }
    }
    // a body in the middle of a gap is clear of both neighbours
    expect(a.some(t => covers(t, { x: 3, y: 6 }, inB.radius))).toBe(false);
    advance(tg, first + AFTER);
    expect([skillHits(tg, inA), skillHits(tg, inB)]).toEqual([1, 0]);
    advance(tg, second - first);
    expect([skillHits(tg, inA), skillHits(tg, inB)]).toEqual([1, 1]);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });

  /** The tip of 세단: stand in a gap, then step onto a strip that already fell — never hit. */
  function expectCombTip(knobs: Partial<Tunables> = {}): void {
    const k = knobs.bossTelegraphMult ?? 1;
    const tg = soft(SH, [HUMAN], false, knobs);
    const me = active(tg);
    pin(me, { x: 3, y: 6 });
    castSkill(tg, SH, 'sh_comb', me);
    const n = partsOf(skill(SH, 'sh_comb')).length / 2;
    const [first, second] = [wait(SH, 'sh_comb', 0) * k, wait(SH, 'sh_comb', n) * k];
    expect(tg.w.state.telegraphs.map(t => t.total)).toEqual([...Array(n).fill(first), ...Array(n).fill(second)]);
    advance(tg, first + AFTER);
    expect(tg.w.state.telegraphs).toHaveLength(n);
    pin(me, { x: 5, y: 6 });
    advance(tg, second - first + AFTER);
    expect(skillHits(tg, me)).toBe(0);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  }

  it('세단: standing in a gap, then stepping onto a strip that already fell, is never hit (the tip)', () => {
    expectCombTip();
    expect(skill(SH, 'sh_comb').hint).toBe('빗살 사이가 안전해요 — 지나간 빗살 자리로 옮기세요');
  });

  it('세단 under the debug knobs: 예고 ×2 doubles both waves and the pause between them; narrower strips keep the lanes — the tip still works', () => {
    expectCombTip({ bossTelegraphMult: 2 });
    expectCombTip({ bossTelegraphMult: 0.5 });
    expectCombTip({ bossAreaMult: 0.5 });
  });

  it('교차 세단: A, then B, then A again — a strip of A is hit twice, a gap once', () => {
    const tg = soft(SH, [HUMAN, HUMAN2]);
    const inA = active(tg, 0);
    const inB = active(tg, 1);
    pin(inA, { x: 13, y: 8 });
    pin(inB, { x: 15, y: 8 });
    const n = partsOf(skill(SH, 'sh_cross')).length / 3;
    const [d1, d2, d3] = [0, n, 2 * n].map(i => wait(SH, 'sh_cross', i));
    castSkill(tg, SH, 'sh_cross', inA);
    expect(tg.w.state.telegraphs).toHaveLength(3 * n);
    advance(tg, d1 + AFTER);
    expect([skillHits(tg, inA), skillHits(tg, inB)]).toEqual([1, 0]);
    advance(tg, d2 - d1);
    expect([skillHits(tg, inA), skillHits(tg, inB)]).toEqual([1, 1]);
    advance(tg, d3 - d2);
    expect([skillHits(tg, inA), skillHits(tg, inB)]).toEqual([2, 1]);
  });

  it('종이 날림: a fan from the slot toward the target that leaves a burn; a character beside the fan is untouched', () => {
    const fan = part(SH, 'sh_cuts');
    const burn = rider(fan, 'burn');
    const tg = soft(SH, [HUMAN, HUMAN2]);
    const me = active(tg, 0);
    const side = active(tg, 1);
    pin(me, { x: 12, y: 6 });
    pin(side, { x: 20, y: 6 });
    castSkill(tg, SH, 'sh_cuts', me);
    const [t] = tg.w.state.telegraphs;
    expect([t.area, t.total, t.origin]).toEqual([fan.area, wait(SH, 'sh_cuts'), BOSS_POS]);
    // (new points if the fan gets narrower than 24° or wider than 96°)
    expect(covers(t, { x: 13.5, y: 6 })).toBe(true); // 12° off the axis
    expect(covers(t, { x: 20, y: 6 })).toBe(false); // 48° off
    advance(tg, wait(SH, 'sh_cuts') + AFTER);
    expect([skillHits(tg, me), skillHits(tg, side)]).toEqual([1, 0]);
    expect(hasStatus(me, 'burn')).toBe(true);
    expect(hasStatus(side, 'burn')).toBe(false);
    advance(tg, burn.duration - 0.5);
    expect(hasStatus(me, 'burn')).toBe(true);
    advance(tg, 0.8);
    expect(hasStatus(me, 'burn')).toBe(false);
  });

  it('사원증 회수: a warning on one character — walking does not dodge it, taking the card off the field does', () => expectCalledOut(SH, 'sh_badge'));
});

describe('식지 않는 커피 머신', () => {
  const CF: Id = 'coffee_machine';

  it('뜨거운 한 잔: a warning, then a puddle that stays — it slows and ticks on its interval; outside it nothing', () => {
    const pour = part(CF, 'cf_pour');
    const { radius } = areaOf(CF, 'cf_pour', 'circle');
    const slow = rider(pour, 'slow');
    const puddle = pour.zone!;
    const tg = soft(CF, [HUMAN, HUMAN2]);
    const wet = active(tg, 0);
    const dry = active(tg, 1);
    pin(wet, { x: 8, y: 7 });
    pin(dry, { x: 8 + radius + 1.6, y: 7 });
    castSkill(tg, CF, 'cf_pour', wet);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total, t.center])).toEqual([[pour.area, wait(CF, 'cf_pour'), { x: 8, y: 7 }]]);
    advance(tg, wait(CF, 'cf_pour') + AFTER);
    expect(tg.w.state.zones).toHaveLength(1);
    expect(tg.w.state.zones[0].radius).toBe(radius);
    expect(statusValue(wet, 'slow')).toBeCloseTo(slow.value, 6);
    expect(hasStatus(dry, 'slow')).toBe(false);
    const stay = puddle.duration - 0.5;
    advance(tg, stay);
    expect(tg.w.state.zones, 'still there just before its time is up').toHaveLength(1);
    const ticks = Math.floor(stay / puddle.tickInterval);
    const hits = skillHits(tg, wet);
    expect(hits).toBeGreaterThanOrEqual(ticks);
    expect(hits).toBeLessThanOrEqual(ticks + 3);
    expect(skillHits(tg, dry)).toBe(0);
    // stepping out ends it: no more ticks, the slow runs out within its own time
    pin(wet, { x: 8, y: 11.5 });
    advance(tg, slow.duration + 0.2);
    expect(hasStatus(wet, 'slow')).toBe(false);
    expect(tg.w.state.zones).toHaveLength(0);
  });

  it('뜨거운 한 잔 leaves more than one puddle on the floor when it is cast again (an enraged cooldown is shorter than a puddle lasts)', () => {
    const pour = skill(CF, 'cf_pour');
    const again = pour.cooldown * ENRAGE.cooldownMult;
    expect(again).toBeLessThan(pour.action.zone!.duration);
    const tg = soft(CF);
    const me = active(tg);
    pin(me, { x: 6, y: 6 });
    castSkill(tg, CF, 'cf_pour', me);
    advance(tg, again);
    pin(me, { x: 16, y: 6 });
    castSkill(tg, CF, 'cf_pour', me);
    advance(tg, wait(CF, 'cf_pour') + AFTER);
    expect(tg.w.state.zones.map(z => z.center.x).sort((p, q) => p - q)).toEqual([6, 16]);
  });

  it('뜨거운 한 잔 under the debug knob 범위 ×0.5 / ×2: the warning and the puddle it leaves are that much smaller / bigger', () => {
    const { radius } = areaOf(CF, 'cf_pour', 'circle');
    for (const mult of [0.5, 2]) {
      const tg = soft(CF, [HUMAN], false, { bossAreaMult: mult });
      const me = active(tg);
      pin(me, { x: 8, y: 7 });
      castSkill(tg, CF, 'cf_pour', me);
      expect(tg.w.state.telegraphs.map(t => t.area)).toEqual([{ shape: 'circle', radius: radius * mult }]);
      advance(tg, wait(CF, 'cf_pour') + AFTER);
      expect(tg.w.state.zones.map(z => z.radius)).toEqual([radius * mult]);
    }
  });

  it('스팀: a narrow fan that hits twice, one interval apart, and slows', () => {
    const steam = part(CF, 'cf_steam');
    const tg = soft(CF);
    const me = active(tg);
    pin(me, { x: 12, y: 7 });
    castSkill(tg, CF, 'cf_steam', me);
    const puffs = partsOf(skill(CF, 'cf_steam'));
    const gap = (puffs[1].delay ?? 0) - (puffs[0].delay ?? 0);
    // both puffs are warned from the cast on (기획 19차 review: no unwarned second hit)
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total, t.origin])).toEqual(puffs.map(a => [steam.area, a.delay, BOSS_POS]));
    advance(tg, wait(CF, 'cf_steam') + AFTER);
    expect(skillHits(tg, me)).toBe(1);
    expect(statusValue(me, 'slow')).toBeCloseTo(rider(steam, 'slow').value, 6);
    advance(tg, gap);
    expect(skillHits(tg, me)).toBe(2);
    advance(tg, 1);
    expect(skillHits(tg, me)).toBe(puffs.length);
  });

  it('캡슐 투하: three drops left → right around the target, one after the other', () => {
    const drops = partsOf(skill(CF, 'cf_capsules'));
    const [d0, d1, d2] = drops.map(a => a.delay ?? 0);
    const dx = drops.map(a => a.offset!.x);
    expect(dx[0]).toBeLessThan(dx[1]);
    expect(dx[1]).toBeLessThan(dx[2]);
    const tg = soft(CF, [HUMAN, HUMAN2]);
    const mid = active(tg, 0);
    const right = active(tg, 1);
    pin(mid, { x: 12, y: 7 });
    pin(right, { x: 12 + dx[2], y: 7 });
    castSkill(tg, CF, 'cf_capsules', mid);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.center.x, t.center.y, t.total])).toEqual(drops.map((a, i) => [a.area, 12 + dx[i], 7, a.delay]));
    advance(tg, d0 + AFTER);
    expect([skillHits(tg, mid), skillHits(tg, right)]).toEqual([0, 0]);
    advance(tg, d1 - d0);
    expect([skillHits(tg, mid), skillHits(tg, right)]).toEqual([1, 0]);
    advance(tg, d2 - d1);
    expect([skillHits(tg, mid), skillHits(tg, right)]).toEqual([1, 1]);
  });

  it('넘치는 커피: a ring puddle around the machine — next to it and far from it the floor stays dry', () => {
    const spill = part(CF, 'cf_overflow');
    const ring = areaOf(CF, 'cf_overflow', 'ring');
    const puddle = spill.zone!;
    const tg = soft(CF, [HUMAN, HUMAN2]);
    const inBand = active(tg, 0);
    const inHole = active(tg, 1);
    pin(inBand, { x: 12, y: BOSS_POS.y + (ring.inner + ring.outer) / 2 }); // the middle of the band
    pin(inHole, { x: 12, y: BOSS_POS.y + ring.inner / 2 + 0.1 }); // well inside the hole
    castSkill(tg, CF, 'cf_overflow', inBand);
    const [t] = tg.w.state.telegraphs;
    expect([t.area, t.total, t.center]).toEqual([ring, wait(CF, 'cf_overflow'), BOSS_POS]);
    expect(covers(t, { x: 12, y: BOSS_POS.y + ring.outer + 2.7 })).toBe(false); // past the ring
    advance(tg, wait(CF, 'cf_overflow') + AFTER);
    const z = tg.w.state.zones;
    expect(z).toHaveLength(1);
    expect(z[0].area).toEqual(ring);
    advance(tg, 2);
    // the hole must fit a character standing as close to the machine as its body lets it (a smaller hole = no dry spot)
    const reach = Math.hypot(inHole.pos.x - BOSS_POS.x, inHole.pos.y - BOSS_POS.y) + inHole.radius;
    expect(reach, `the hole (${ring.inner}) fits a character next to the machine`).toBeLessThan(ring.inner);
    expect(statusValue(inBand, 'slow')).toBeCloseTo(rider(spill, 'slow').value, 6);
    expect(hasStatus(inHole, 'slow')).toBe(false);
    expect(skillHits(tg, inBand)).toBeGreaterThanOrEqual(Math.floor(2 / puddle.tickInterval));
    expect(skillHits(tg, inHole)).toBe(0);
    advance(tg, puddle.duration - 2.5);
    expect(tg.w.state.zones).toHaveLength(1);
    advance(tg, 1);
    expect(tg.w.state.zones).toHaveLength(0);
  });
});

describe('퇴근 못 한 모니터', () => {
  const DM: Id = 'dead_monitor';
  const SPOTS = [[6, 4], [12, 6], [18, 4]];

  it('팝업 광고: one 오류 창 on each of the three fixed spots, at once, no warning (규칙 M4); they stay put and aim at who is near', () => {
    const tg = calm(DM);
    silence(tg);
    advance(tg, 0.2);
    clearEvents(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 9 });
    castSkill(tg, DM, 'dm_popups', me);
    const spawned = eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss');
    expect(spawned.map(e => [Math.round(e.pos.x * 100) / 100, Math.round(e.pos.y * 100) / 100])).toEqual(SPOTS);
    expect(skill(DM, 'dm_popups').action.offset).toEqual(at(6, 4));
    expect(partsOf(skill(DM, 'dm_popups')).map(a => a.offset)).toEqual([{ x: -6, y: 5.2 }, { x: 0, y: 7.2 }, { x: 6, y: 5.2 }]); // the table's offsets
    expect(tg.w.state.telegraphs).toHaveLength(0);
    const adds = tg.w.state.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss');
    expect(adds.map(a => a.defId)).toEqual(['error_popup', 'error_popup', 'error_popup']);
    for (const a of adds) expect(a.rt.stationary).toBe(true);
    const where = adds.map(a => ({ ...a.pos }));
    advance(tg, 0.6);
    const still = adds.filter(a => !a.rt.gone);
    expect(still.length).toBeGreaterThan(0);
    for (const a of still) expect(a.pos).toEqual(where[adds.indexOf(a)]);
    // the middle window is 3 from the character: it has its target
    const midWin = adds[1];
    if (!midWin.rt.gone) expect(midWin.targetId).toBe(me.id);
  });

  it('팝업 광고 while enraged: still one window per spot (spotCap 1 — summons × 1.5 does not stack turrets)', () => {
    const tg = calm(DM);
    silence(tg);
    advance(tg, 0.2);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
    clearEvents(tg);
    castSkill(tg, DM, 'dm_popups', active(tg));
    const spawned = eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss');
    expect(spawned).toHaveLength(3);
    spawned.forEach((e, i) => expect([e.pos.x, e.pos.y]).toEqual(SPOTS[i]));
    // a second cast while they live adds nothing; a closed window is opened again, alone
    clearEvents(tg);
    castSkill(tg, DM, 'dm_popups', active(tg));
    expect(eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss')).toHaveLength(0);
    const first = tg.w.state.entities.find(e => e.defId === 'error_popup')!;
    const at = { ...first.pos };
    applyDamage(tg.w, { casterId: null, team: 'ally', player: null, source: 'basic', isDrag: false }, first, 1e9, false);
    advance(tg, 0.2);
    clearEvents(tg);
    castSkill(tg, DM, 'dm_popups', active(tg));
    expect(eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss').map(e => e.pos)).toEqual([at]);
    expect(tg.w.state.entities.filter(e => e.defId === 'error_popup' && e.hp > 0 && !e.rt.gone)).toHaveLength(3);
  });

  it('팝업 광고 under the debug knobs: the windows open on the same three spots (범위 배율 never moves a spot, 예고 배율 does not delay an instant summon)', () => {
    for (const knobs of [{ bossAreaMult: 0.5 }, { bossAreaMult: 2 }, { bossTelegraphMult: 2 }]) {
      const tg = raidGame(DM, { hpMult: 50, tunables: { ...CALM, ...knobs } });
      silence(tg);
      advance(tg, 0.2);
      clearEvents(tg);
      castSkill(tg, DM, 'dm_popups', active(tg));
      const spawned = eventsOf(tg, 'spawn').filter(e => e.tier !== 'boss');
      expect(spawned.map(e => [Math.round(e.pos.x * 100) / 100, Math.round(e.pos.y * 100) / 100]), JSON.stringify(knobs)).toEqual(SPOTS);
    }
  });

  it('커서 추적: a line from the screen that keeps following its target — walking away does not dodge it', () => {
    const delay = wait(DM, 'dm_cursor');
    const tg = soft(DM, [HUMAN, HUMAN2]);
    const me = active(tg, 0);
    const other = active(tg, 1);
    pin(me, { x: 6, y: 8 });
    pin(other, { x: 12, y: 10 });
    castSkill(tg, DM, 'dm_cursor', me);
    const first = tg.w.state.telegraphs[0];
    expect([first.area, first.total, first.origin, first.center]).toEqual([part(DM, 'dm_cursor').area, delay, BOSS_POS, { x: 6, y: 8 }]);
    expect(part(DM, 'dm_cursor').follow).toBe(true);
    advance(tg, delay / 2);
    pin(me, { x: 18, y: 8 });
    advance(tg, 0.2);
    expect(tg.w.state.telegraphs[0].center).toEqual({ x: 18, y: 8 });
    expect(covers(tg.w.state.telegraphs[0], other.pos, other.radius)).toBe(false);
    advance(tg, delay / 2 - 0.2 + AFTER);
    expect([skillHits(tg, me), skillHits(tg, other)]).toEqual([1, 0]);
    expect(skill(DM, 'dm_cursor').hint).toBe('커서는 끝까지 따라와요 — 교체로 피하세요');
  });

  it('커서 추적: a 저스트 교대 (the card leaves just before it lands) makes it miss', () => {
    const tg = soft(DM);
    const me = active(tg);
    pin(me, { x: 6, y: 8 });
    castSkill(tg, DM, 'dm_cursor', me);
    advance(tg, wait(DM, 'dm_cursor') - 0.3);
    expect(justCue(tg.w.state, tg.w.tunables, 0).now).toBe(true);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 18, y: 9 } }).ok).toBe(true);
    advance(tg, 0.6);
    expect(eventsOf(tg, 'justSwap')).toHaveLength(1);
    expect(partyHits(tg)).toBe(0);
  });

  it('블루스크린: an X through the target that slows; beside the arms it misses', () => {
    const blue = part(DM, 'dm_bluescreen');
    const x = areaOf(DM, 'dm_bluescreen', 'cross');
    expect(x.diagonal).toBe(true);
    const tg = soft(DM);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    castSkill(tg, DM, 'dm_bluescreen', me);
    const [t] = tg.w.state.telegraphs;
    expect([t.area, t.total, t.center]).toEqual([x, wait(DM, 'dm_bluescreen'), { x: 12, y: 6 }]);
    const k = x.length / 2; // 71 % of the way along a diagonal arm
    expect(covers(t, { x: 12 + k, y: 6 + k })).toBe(true);
    expect(covers(t, { x: 12 - k, y: 6 + k })).toBe(true);
    expect(covers(t, { x: 12 + x.length * 0.6, y: 6 })).toBe(false); // straight to the side: between the arms
    expect(covers(t, { x: 12, y: 6 + x.length * 0.6 })).toBe(false);
    advance(tg, wait(DM, 'dm_bluescreen') + AFTER);
    expect(skillHits(tg, me)).toBe(1);
    expect(statusValue(me, 'slow')).toBeCloseTo(rider(blue, 'slow').value, 6);
  });

  it('팝업 폭주: five small windows in a zigzag over the target, one after the other', () => {
    const wins = partsOf(skill(DM, 'dm_storm'));
    expect(wins).toHaveLength(5);
    const at0 = wins.map(a => a.delay ?? 0);
    const tg = soft(DM);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    castSkill(tg, DM, 'dm_storm', me);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.center.x, t.center.y, t.total])).toEqual(wins.map(a => [a.area, 12 + a.offset!.x, 6 + a.offset!.y, a.delay]));
    // a zigzag: left → right, above and below the target's row
    expect(wins.map(a => a.offset!.x)).toEqual([...wins.map(a => a.offset!.x)].sort((p, q) => p - q));
    expect(wins.map(a => Math.sign(a.offset!.y))).toEqual([0, -1, 0, 1, 0]);
    advance(tg, at0[2] - 0.1);
    expect(skillHits(tg, me)).toBe(0);
    advance(tg, 0.2);
    expect(skillHits(tg, me)).toBe(1); // only the middle one reaches the target
    advance(tg, at0[4] - at0[2] + 0.2);
    expect(skillHits(tg, me)).toBe(1);
  });
});

describe('끝나지 않는 회의', () => {
  const EM: Id = 'endless_meeting';

  it('발표 지명: a long warning on one character — walking does not dodge it, taking the card off the field does', () => expectCalledOut(EM, 'em_call'));

  it('발표 지명 is the biggest single hit of the zone, with the longest warning of the single hits', () => {
    const singles = IDS.flatMap(id => allSkills(getBoss(id))).flatMap(sk => partsOf(sk)).filter(a => a.area.shape === 'single');
    expect(singles).toHaveLength(2);
    const amount = (a: SkillAction) => a.effects.reduce((n, e) => n + (e.kind === 'damage' ? e.amount : 0), 0);
    const call = part(EM, 'em_call');
    expect(Math.max(...singles.map(amount))).toBe(amount(call));
    expect(Math.max(...singles.map(a => a.delay ?? 0))).toBe(call.delay);
  });

  it('안건 추가: the middle first, then the ring around the SAME spot (it does not follow)', () => {
    const [dot, ring] = partsOf(skill(EM, 'em_agenda'));
    const hole = areaOf(EM, 'em_agenda', 'ring', 1);
    expect(hole.inner).toBe(areaOf(EM, 'em_agenda', 'circle', 0).radius); // the ring starts where the middle ends
    const [d0, d1] = [dot.delay ?? 0, ring.delay ?? 0];
    expect(d1).toBeGreaterThan(d0);
    const tg = soft(EM, [HUMAN, HUMAN2]);
    const mid = active(tg, 0);
    const out = active(tg, 1);
    pin(mid, { x: 12, y: 6 });
    pin(out, { x: 12 + (hole.inner + hole.outer) / 2, y: 6 }); // the middle of the ring's band
    castSkill(tg, EM, 'em_agenda', mid);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.center, t.total])).toEqual([
      [dot.area, { x: 12, y: 6 }, d0],
      [ring.area, { x: 12, y: 6 }, d1],
    ]);
    advance(tg, d0 + AFTER);
    expect([skillHits(tg, mid), skillHits(tg, out)]).toEqual([1, 0]);
    expect(tg.w.state.telegraphs.map(t => t.center)).toEqual([{ x: 12, y: 6 }]);
    advance(tg, d1 - d0);
    expect([skillHits(tg, mid), skillHits(tg, out)]).toEqual([1, 1]); // the middle is the hole of the ring
  });

  it('회의 연장 (규칙 M1): a yellow ring that is no danger, then a shield and haste on the boss for their time', () => {
    const extend = part(EM, 'em_extend');
    const delay = wait(EM, 'em_extend');
    const shield = extend.effects.find((e): e is Extract<Effect, { kind: 'shield' }> => e.kind === 'shield')!;
    const haste = rider(extend, 'haste');
    expect(shield.duration).toBe(haste.duration);
    const tg = soft(EM);
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 0.9 }); // inside the ring around the boss
    const speed = effStats(tg.w, b).atkSpeed;
    castSkill(tg, EM, 'em_extend', me);
    const [t] = tg.w.state.telegraphs;
    expect(t).toMatchObject({ team: 'enemy', self: true, total: delay, area: extend.area });
    expect(t.center).toEqual(BOSS_POS);
    advance(tg, delay - 0.3);
    expect(covers(tg.w.state.telegraphs[0], me.pos, me.radius)).toBe(true);
    expect(justCue(tg.w.state, tg.w.tunables, 0)).toEqual({ danger: false, now: false, landIn: null });
    expect(b.shield).toBe(0);
    advance(tg, 0.4);
    expect(b.shield).toBeCloseTo(shield.amount * b.maxHp, 3);
    expect(statusValue(b, 'haste')).toBeCloseTo(haste.value, 6);
    expect(effStats(tg.w, b).atkSpeed).toBeGreaterThan(speed);
    expect(partyHits(tg)).toBe(0);
    // the shield takes the hits first
    const hp = b.hp;
    applyDamage(tg.w, { casterId: null, team: 'ally', player: null, source: 'basic', isDrag: false }, b, 1000, false);
    expect(b.hp).toBe(hp);
    expect(b.shield).toBeLessThan(shield.amount * b.maxHp);
    // both run out after their time
    advance(tg, haste.duration - 1);
    expect(hasStatus(b, 'haste')).toBe(true);
    advance(tg, 1.2);
    expect(hasStatus(b, 'haste')).toBe(false);
    expect(b.shield).toBe(0);
    expect(effStats(tg.w, b).atkSpeed).toBeCloseTo(speed, 6);
  });

  /** A groggy break half-way through the yellow ring: no shield, no haste (also with the ring stretched by 예고 배율). */
  function expectExtendBroken(knobs: Partial<Tunables> = {}): void {
    const delay = wait(EM, 'em_extend') * (knobs.bossTelegraphMult ?? 1);
    const tg = soft(EM, [HUMAN], true, knobs);
    const b = bossOf(tg);
    castSkill(tg, EM, 'em_extend', active(tg));
    expect(tg.w.state.telegraphs.map(t => [t.self, t.total])).toEqual([[true, delay]]);
    advance(tg, delay / 2);
    expect(tg.w.state.telegraphs).toHaveLength(1);
    expect(b.shield).toBe(0);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(tg, delay + 0.7);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(b.shield).toBe(0);
    expect(hasStatus(b, 'haste')).toBe(false);
    expect(eventsOf(tg, 'interrupt').some(e => e.sourceId === b.id)).toBe(true);
  }

  it('회의 연장: a groggy break during the yellow ring cancels it — no shield, no haste', () => expectExtendBroken());

  it('회의 연장 under the debug knob 예고 ×2: the yellow ring lasts twice as long, so there is twice the time to break it', () => expectExtendBroken({ bossTelegraphMult: 2 }));

  it('레이저포인터: three thin lines from the chairman, aimed left of / at / right of the target, one after the other', () => {
    const beams = partsOf(skill(EM, 'em_laser'));
    const [d0, d1, d2] = beams.map(a => a.delay ?? 0);
    const dx = beams.map(a => a.offset!.x);
    expect([Math.sign(dx[0]), dx[1], Math.sign(dx[2])]).toEqual([-1, 0, 1]);
    const tg = soft(EM, [HUMAN, HUMAN2]);
    const me = active(tg, 0);
    const right = active(tg, 1);
    pin(me, { x: 12, y: 8 });
    pin(right, { x: 12 + dx[2], y: 8 });
    castSkill(tg, EM, 'em_laser', me);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.origin, t.center.x, t.center.y, t.total])).toEqual(beams.map((a, i) => [a.area, BOSS_POS, 12 + dx[i], 8, a.delay]));
    advance(tg, d0 + AFTER);
    expect([skillHits(tg, me), skillHits(tg, right)]).toEqual([0, 0]);
    advance(tg, d1 - d0);
    expect([skillHits(tg, me), skillHits(tg, right)]).toEqual([1, 0]);
    advance(tg, d2 - d1);
    expect([skillHits(tg, me), skillHits(tg, right)]).toEqual([1, 1]);
  });
});

describe('사무실: bots-only fights', () => {
  const SEEDS = [3, 11, 19, 27, 101, 202, 303, 404];

  /** One boss fight on floor 1 with three bot seats: 'clear' with its time, 'wipe', or 'late' (the boss enraged first). */
  function fightOnce(id: Id, seed: number): { end: 'clear' | 'late' | 'wipe'; time: number } {
    const tg = raidGame(id, { seed, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
    const s = tg.w.state;
    const limit = (s.plan.timeLimit + 60) * 30;
    let time = 0;
    // bots pick their reward at once, so the run walks on to floor 2 by itself: stop where the first floor ends
    for (let t = 0; t < limit && s.phase === 'combat' && s.floor === 1; t++) {
      time = s.floorTime;
      tick(tg.w);
      if (s.floor === 1 && s.bossEnraged) return { end: 'late', time };
    }
    if (s.runResult?.outcome === 'defeat') return { end: 'wipe', time };
    return { end: s.floor > 1 || s.phase !== 'combat' ? 'clear' : 'late', time };
  }

  for (const id of IDS) {
    it(`${id}: three bots beat it before the enrage timer on most of ${SEEDS.length} seeds, and the same seed gives the same fight`, () => {
      const runs = SEEDS.map(seed => fightOnce(id, seed));
      const clears = runs.filter(r => r.end === 'clear');
      expect(clears.length, JSON.stringify(runs)).toBeGreaterThanOrEqual(6);
      for (const r of clears) {
        expect(r.time).toBeGreaterThan(8); // never a one-shot
        expect(r.time).toBeLessThan(DEFAULT_TUNABLES.bossFloorTime);
      }
      expect(fightOnce(id, SEEDS[0])).toEqual(runs[0]);
    }, 60000);
  }
});

describe('사무실: looks, warning motifs, voices', () => {
  const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: Record<string, Partial<BossDrawOpts>> = {
    idle: {},
    'wind-up': { charge: 0.8 },
    attack: { flash: 1, charge: 1 },
    groggy: { groggy: 1 },
    'standing up': { groggy: 0.4, groggyWake: 0.5 },
    enraged: { enraged: true, shake: 0.6 },
    'phase 2': { phase: 2, phaseFlash: 0.5 },
    'phase 3, enraged, down': { phase: 3, enraged: true, groggy: 1 },
    'no target': { lookX: null, lookY: null },
    leaving: { retreat: 0.6 },
  };

  /** A counting 2D context (every method is a no-op that counts; remembers fill colours, texts and bad numbers). */
  function counter() {
    const c = { n: 0, fills: new Set<string>(), texts: [] as string[], bad: [] as string[], sets: new Set<string>(), ctx: null as unknown as CanvasRenderingContext2D };
    const store: Record<string | symbol, unknown> = {};
    c.ctx = new Proxy(store, {
      get: (target, prop) =>
        prop in target
          ? target[prop]
          : (...args: unknown[]) => {
              c.n++;
              if (prop === 'fillText') c.texts.push(String(args[0]));
              for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) c.bad.push(String(prop));
            },
      set: (target, prop, value) => {
        c.sets.add(String(prop));
        if (prop === 'fillStyle') c.fills.add(String(value));
        if (typeof value === 'number' && !Number.isFinite(value)) c.bad.push(String(prop));
        target[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return c;
  }

  const SIGNS: Record<Id, string> = { shredder_maw: '용지 걸림', coffee_machine: '물을 보충하세요', dead_monitor: '신호 없음', endless_meeting: '휴회' };

  it('each boss has its own look in the registry: every pose draws (with its groggy sign) inside the budget and leaves alpha at 1', () => {
    const cam = new Camera();
    cam.setArena(24, 12);
    const colours = new Set<string>();
    for (const id of IDS) {
      const look = bossLook(id);
      expect(look, `${id} look`).toBeDefined();
      expect(look!.color).toBe(getBoss(id).color);
      expect(unitLook('monster', id).color).toBe(look!.color);
      colours.add(look!.color);
      const c = counter();
      for (const [name, pose] of Object.entries(POSES)) {
        for (let f = 0; f < 12; f++) {
          const o = { ...BASE, ...pose, time: 5.1 + f * 0.13 };
          c.n = 0;
          c.texts.length = 0;
          expect(() => {
            look!.draw(c.ctx, cam, 12, -1.2, 3, o);
            expect((c.ctx as unknown as { globalAlpha: number }).globalAlpha, `${id} ${name}: alpha back at 1`).toBe(1);
            if (o.groggy > 0) look!.props?.(c.ctx, cam, 12, -1.2, 3, o);
          }, `${id} ${name}`).not.toThrow();
          expect(c.n, `${id} ${name}: draws something`).toBeGreaterThan(40);
          expect(c.n, `${id} ${name}: canvas calls`).toBeLessThanOrEqual(360);
          expect(c.texts.length, `${id} ${name}: texts`).toBeLessThanOrEqual(2);
          if (o.groggy > 0) expect(c.texts, `${id} ${name}: its sign`).toContain(SIGNS[id]);
        }
      }
      c.n = 0;
      look!.draw(c.ctx, cam, 12, -1.2, 3, { ...BASE, retreat: 1 });
      expect(c.n, `${id}: nothing once gone`).toBe(0);
      expect(c.bad, `${id}: finite numbers`).toEqual([]);
      expect(c.sets.has('shadowBlur'), `${id}: no shadowBlur`).toBe(false);
      expect(c.fills.size, `${id} uses a palette`).toBeGreaterThan(6);
      const by = cam.sy(-1.2) + BOSS_DROP;
      for (const g of [0, 1]) {
        const y = look!.headY!(by, 160, g);
        expect(y).toBeGreaterThan(60);
        expect(y).toBeLessThan(330);
      }
      // …and through the renderer's entry (groggy pose + props + stars)
      for (const pose of Object.values(POSES)) expect(() => drawBossArt(c.ctx, cam, id, 12, -1.2, 3, { ...BASE, ...pose, time: 2.2 })).not.toThrow();
    }
    expect(colours.size).toBe(4);
  });

  it('a phase changes what is drawn: 파쇄기 opens two more eyes, the agenda of 회의 grows, the monitor and the coffee change colour', () => {
    const cam = new Camera();
    cam.setArena(24, 12);
    for (const id of IDS) {
      const one = counter();
      const two = counter();
      bossLook(id)!.draw(one.ctx, cam, 12, -1.2, 3, { ...BASE, time: 4 });
      bossLook(id)!.draw(two.ctx, cam, 12, -1.2, 3, { ...BASE, time: 4, phase: 2 });
      const same = one.n === two.n && [...one.fills].join() === [...two.fills].join();
      expect(same, `${id}: phase 2 looks different`).toBe(false);
    }
  });

  it('오류 창 has a body in the registry: both facings, idle / shooting / flashing', () => {
    const draw = MINION_LOOKS.error_popup;
    expect(typeof draw).toBe('function');
    expect(unitLook('monster', 'error_popup').name).toBe('오류 창');
    const c = counter();
    for (const s of [-1, 1]) for (const act of [0, 1]) for (const flash of [false, true]) draw(c.ctx, '#0466c8', flash, 300, 400, 44, 53, s, 2.5, 0.7, act);
    expect(c.n).toBeGreaterThan(8 * 12);
    expect(c.bad).toEqual([]);
    expect(c.texts).toEqual([]);
    expect(c.sets.has('shadowBlur')).toBe(false);
  });

  it('warning motifs: both puddles are marked as lingering, the pop-ups as a spawn; every row is a skill of the zone', () => {
    expect(BOSS_TELE_MOTIF.cf_pour).toBe('linger');
    expect(BOSS_TELE_MOTIF.cf_overflow).toBe('linger');
    expect(BOSS_TELE_MOTIF.dm_popups).toBe('spawn');
    const ids = new Set(IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id)));
    const mine = Object.keys(BOSS_TELE_MOTIF).filter(k => /^(sh|cf|dm|em)_/.test(k));
    expect(mine.sort()).toEqual(['cf_overflow', 'cf_pour', 'dm_popups']);
    for (const k of mine) expect(ids.has(k), k).toBe(true);
  });

  it('voices: the table rows (root, motif, timbre) and one sound kind per skill', () => {
    const want: Record<Id, [number, number[], string]> = {
      shredder_maw: [87.3, [0, -5, 0], 'paper'],
      coffee_machine: [73.4, [0, 2, 0], 'hum'],
      dead_monitor: [98, [0, 12, 0], 'static'],
      endless_meeting: [77.8, [0, 1, 0, -5], 'bell'],
    };
    for (const id of IDS) {
      const v = BOSS_VOICE[id];
      expect([v.base, v.motif, v.timbre]).toEqual(want[id]);
      expect(Object.keys(v.kinds).sort()).toEqual(allSkills(getBoss(id)).map(sk => sk.id).sort());
    }
    expect(BOSS_VOICE.shredder_maw.kinds).toEqual({ sh_comb: 'blades', sh_cuts: 'papers', sh_badge: 'slice', sh_cross: 'blades' });
    expect(BOSS_VOICE.coffee_machine.kinds).toEqual({ cf_pour: 'water', cf_steam: 'gas', cf_capsules: 'countdown', cf_overflow: 'water' });
    expect(BOSS_VOICE.dead_monitor.kinds).toEqual({ dm_popups: 'summon', dm_cursor: 'beam', dm_bluescreen: 'static', dm_storm: 'static' });
    expect(BOSS_VOICE.endless_meeting.kinds).toEqual({ em_call: 'stamp', em_agenda: 'papers', em_extend: 'chime', em_laser: 'beam' });
    // the classic row of the zone is as it was
    expect([BOSS_VOICE.overtime_lord.base, BOSS_VOICE.overtime_lord.motif, BOSS_VOICE.overtime_lord.timbre]).toEqual([82.4, [0, 1, 0, -5], 'office']);
  });
});
