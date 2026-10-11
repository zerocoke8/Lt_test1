// 기획 19차 보스 레이드 — 폐병동 bosses (docs/bosses.md 2장): 번호 없는 서랍 · 투시 촬영기 · 멈추지 않는 제세동기 · 빈 병상 행렬.
// The shared contract of a new boss (expectBossContract), the table's numbers, the order and shapes of their warnings,
// phase / enrage / groggy, the patterns that carry the zone's ideas (서랍 열림 = the other half is safe, 투시 → 현상 = a
// combo a swap breaks, 심폐소생 = a heal a groggy cancels, 병상 정렬 = gathered, then hit), bots-only fights and the looks.
import { describe, expect, it } from 'vitest';
import { BOSS_POS, DEFAULT_TUNABLES } from '../../src/config';
import { BOSSES, BOSS_RAID_BAND, ZONE_BOSSES, getBoss } from '../../src/data';
import { ENRAGE } from '../../src/data/bosses';
import { BOSS_VOICE } from '../../src/audio/synth/bossVoices';
import { type BossDrawOpts } from '../../src/render/boss';
import { BOSS_TELE_MOTIF, bossLook } from '../../src/render/bosses';
import { BOSS_DROP } from '../../src/render/bosses/kit';
import { Camera } from '../../src/render/camera';
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
import type { AreaShape, GameEvent, MonsterSkill, Telegraph, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, partsOf, raidGame } from './bossRaidHelpers';

const IDS = ['morgue_drawers', 'xray_machine', 'defibrillator', 'empty_beds'] as const;
type Id = (typeof IDS)[number];
const CALM = { invincible: true, bossGroggyThreshold: 0 } as const;
const R = 0.4; // a character's body radius, roughly
const SOFT = 0.01;
const THIRD = { ...HUMAN, name: '셋' };

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

/** A silent boss whose hits really land (damage events) but hurt like a feather; no basic shots: every hit is a skill. */
function soft(id: Id, players = [HUMAN], groggy = false): TestGame {
  const tg = raidGame(id, { hpMult: 50, players, tunables: { monsterDmgMult: SOFT, ...(groggy ? null : { bossGroggyThreshold: 0 }) } });
  silence(tg);
  advance(tg, 0.2); // the boss picks its target
  bossOf(tg).rt.attackCd = 1e9;
  clearEvents(tg);
  return tg;
}

function skill(id: Id, skillId: string): MonsterSkill {
  const sk = allSkills(getBoss(id)).find(s => s.id === skillId);
  if (!sk) throw new Error(`no skill ${skillId}`);
  return sk;
}

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

/** The skill hits `e` took so far, oldest first. */
function hitsOn(tg: TestGame, e: SimEntity): number[] {
  return eventsOf(tg, 'damage').filter(d => d.targetId === e.id).map(d => d.amount);
}

/** What one skill hit of `amount` × the boss's attack does to `e` in a soft fight (its defence applies). */
function softHit(tg: TestGame, id: Id, e: SimEntity, amount: number): number {
  return amount * getBoss(id).stats.atk * SOFT * (1 - effStats(tg.w, e).def);
}

const covers = (t: Telegraph, p: Vec2) => hitsArea(t.area, t.center, t.origin, p, R);
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const spot = (v: Vec2): [number, number] => [r6(v.x), r6(v.y)];
const adds = (tg: TestGame) => tg.w.state.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss' && !e.rt.gone);

describe('폐병동: the zone table', () => {
  it('has five bosses — the four new ones with data, then 수술실 원장; bands 앞 · 중 · 중 · 뒤', () => {
    expect(ZONE_BOSSES.ward).toEqual([...IDS, 'surgeon_director']);
    expect(BOSSES.filter(b => b.zone === 'ward').map(b => b.id).sort()).toEqual([...IDS, 'surgeon_director'].sort());
    expect(IDS.map(id => BOSS_RAID_BAND[id])).toEqual(['early', 'mid', 'mid', 'late']);
  });

  // HP / atk / atkSpeed / groggy, then per skill [cooldown, first use], the phase [name, HP line, atkSpeed ×, cooldown ×]
  const TABLE: Record<Id, { name: string; stats: [number, number, number, number]; skills: Record<string, [number, number]>; phase: [string, number, number | undefined, number]; summons: string[]; hints: string[] }> = {
    morgue_drawers: { name: '번호 없는 서랍', stats: [7600, 30, 0.5, 0.9], skills: { md_drawers: [12, 4], md_frost: [11, 8], md_wake: [15, 7], md_drawers_right: [12, 1.5] }, phase: ['전원 개방', 0.5, 1.1, 0.85], summons: ['iv_zombie'], hints: ['md_drawers'] },
    xray_machine: { name: '투시 촬영기', stats: [7800, 28, 0.55, 1], skills: { xr_scan: [10, 4], xr_develop: [10, 6.5], xr_dolls: [16, 9], xr_sweep: [13, 1.5] }, phase: ['과다 노출', 0.5, undefined, 0.85], summons: ['nurse_doll'], hints: [] },
    defibrillator: { name: '멈추지 않는 제세동기', stats: [6800, 30, 0.5, 1], skills: { df_shock: [11, 4], df_revive: [18, 10], df_jolt: [8, 7], df_double: [12, 1.5] }, phase: ['재충전', 0.45, 1.15, 0.85], summons: [], hints: ['df_shock', 'df_revive'] },
    empty_beds: { name: '빈 병상 행렬', stats: [8000, 30, 0.5, 1], skills: { eb_lineup: [13, 5], eb_sheet: [9, 4], eb_disinfect: [12, 9], eb_double: [10, 1.5] }, phase: ['연쇄 추돌', 0.5, undefined, 0.8], summons: [], hints: [] },
  };

  for (const id of IDS) {
    it(`${id}: the table's numbers`, () => {
      const def = getBoss(id);
      const row = TABLE[id];
      expect(def.name).toBe(row.name);
      expect(def.zone).toBe('ward');
      expect([def.stats.maxHp, def.stats.atk, def.stats.atkSpeed, def.groggy?.threshold]).toEqual(row.stats);
      expect(Object.fromEntries(allSkills(def).map(sk => [sk.id, [sk.cooldown, sk.initialDelay]]))).toEqual(row.skills);
      const ph = def.phases![0];
      expect([ph.name, ph.hpBelow, ph.atkSpeedMult, ph.cooldownMult]).toEqual(row.phase);
      expect(def.enrage).toEqual(ENRAGE);
      const summons = allSkills(def).flatMap(sk => partsOf(sk)).flatMap(a => (a.summon ? [a.summon.unitId] : []));
      expect(summons).toEqual(row.summons);
      // tips where the table gives one; a tip never runs past one HUD line
      expect(allSkills(def).filter(sk => sk.hint).map(sk => sk.id)).toEqual(row.hints);
      for (const sk of allSkills(def)) if (sk.hint) expect(sk.hint.length).toBeLessThanOrEqual(46);
      expect(def.lore.length).toBeLessThanOrEqual(80);
    });
  }
});

describe('폐병동: the contract of a new boss', () => {
  for (const id of IDS) it(`${id}: shape, every skill within 45 s, phase → phase skill, kill → clear, same seed same fight`, () => expectBossContract(id), 30000);
});

// 기획 19차 보스 튜닝 (docs/boss-raid.md 4-2): warning times and area sizes will be retuned after playtests, so no
// pattern may depend on the numbers as written — the same contract holds with the two debug knobs at both ends.
describe('폐병동: the contract holds under the boss tuning knobs', () => {
  const KNOBS = [
    { bossTelegraphMult: 2, bossAreaMult: 0.5 },
    { bossTelegraphMult: 0.5, bossAreaMult: 2 },
  ] as const;
  for (const id of IDS) {
    for (const knobs of KNOBS) {
      it(`${id}: 예고 ×${knobs.bossTelegraphMult}, 범위 ×${knobs.bossAreaMult}`, () => expectBossContract(id, knobs), 30000);
    }
  }

  // the knobs scale what the data says, pattern by pattern: every part's warning, a ring's outer edge (its hole stays)
  it('the knobs reach every pattern of the zone: warnings ×2 (gaps too), areas ×0.5 at the same spots; ring holes and one-target hits stay', () => {
    for (const id of IDS) {
      for (const sk of allSkills(getBoss(id))) {
        const plain = soft(id);
        const tuned = raidGame(id, { hpMult: 50, tunables: { monsterDmgMult: SOFT, bossGroggyThreshold: 0, bossTelegraphMult: 2, bossAreaMult: 0.5 } });
        silence(tuned);
        advance(tuned, 0.2);
        for (const tg of [plain, tuned]) pin(active(tg), { x: 12, y: 6 });
        castSkill(plain, id, sk.id, active(plain));
        castSkill(tuned, id, sk.id, active(tuned));
        const a = plain.w.state.telegraphs;
        const b = tuned.w.state.telegraphs;
        expect(b.length, sk.id).toBe(a.length);
        // a warned part shows a warning (the two summons are instant: nothing to scale)
        expect(a.length, sk.id).toBe(partsOf(sk).filter(p => (p.delay ?? 0) > 0).length);
        a.forEach((t, i) => {
          const u = b[i];
          expect(u.total, `${sk.id} warning ${i}`).toBeCloseTo(t.total * 2, 6);
          expect(spot(u.center), `${sk.id} spot ${i}`).toEqual(spot(t.center));
          expect(u.area.shape).toBe(t.area.shape);
          if (t.area.shape === 'ring' && u.area.shape === 'ring') {
            // the hole is kept (never wider than the shrunk ring itself)
            expect(u.area.outer, `${sk.id} outer`).toBeCloseTo(t.area.outer * 0.5, 6);
            expect(u.area.inner, `${sk.id} hole`).toBeCloseTo(Math.min(t.area.inner, u.area.outer), 6);
          }
          if (t.area.shape === 'circle' && u.area.shape === 'circle') expect(u.area.radius, `${sk.id} radius`).toBeCloseTo(t.area.radius * 0.5, 6);
          if (t.area.shape === 'single') expect(u.area).toEqual(t.area);
        });
      }
    }
  });
});

describe('폐병동: warnings come in order, with the right footprints', () => {
  // first casts in a calm fight: skill ids by their first use, then the footprint of each part with its delay
  const ORDER: Record<Id, string[]> = {
    morgue_drawers: ['md_drawers', 'md_wake', 'md_frost'],
    xray_machine: ['xr_scan', 'xr_develop', 'xr_dolls'],
    defibrillator: ['df_shock', 'df_jolt', 'df_revive'],
    empty_beds: ['eb_sheet', 'eb_lineup', 'eb_disinfect'],
  };
  const SHAPES: Record<string, [AreaShape['shape'], number][]> = {
    md_drawers: [['rect', 1.3], ['rect', 1.7], ['rect', 2.1]],
    md_frost: [['ring', 1.2]],
    md_wake: [['circle', 0]],
    md_drawers_right: [['rect', 1.2], ['rect', 1.5], ['rect', 1.8]],
    xr_scan: [['line', 1.2]],
    xr_develop: [['circle', 1.6]],
    xr_dolls: [['circle', 0]],
    xr_sweep: [['line', 1], ['line', 1.2], ['line', 1.4], ['line', 1.6], ['line', 1.8]],
    df_shock: [['ring', 1.4], ['ring', 1.8], ['ring', 2.2]],
    df_revive: [['circle', 2.5]],
    df_jolt: [['cross', 1.1]],
    df_double: [['single', 1], ['single', 1.6]],
    eb_lineup: [['ring', 1.3], ['circle', 2.1]],
    eb_sheet: [['circle', 1.2]],
    eb_disinfect: [['circle', 0.8]],
    eb_double: [['circle', 1.1], ['circle', 1.4]],
  };

  for (const id of IDS) {
    it(`${id}: ${ORDER[id].join(' → ')}`, () => {
      const tg = calm(id);
      advance(tg, 13);
      const casts = bossCasts(tg);
      expect([...new Set(casts.map(c => c.skillId))]).toEqual(ORDER[id]);
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

  it('every skill of the zone is in the shape table (nothing unchecked)', () => {
    const ids = IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id));
    expect(Object.keys(SHAPES).sort()).toEqual(ids.sort());
  });
});

describe('폐병동: phase, enrage, groggy', () => {
  for (const id of IDS) {
    it(`${id}: the phase starts under its HP line, enrage multiplies attack / speed / cooldowns, the gauge uses its threshold`, () => {
      const def = getBoss(id);
      const ph = def.phases![0];
      const tg = raidGame(id, { hpMult: 50, tunables: { invincible: true } });
      advance(tg, 1);
      const b = bossOf(tg);
      // floor 1: the table's HP × the knob, the table's attack
      expect(b.maxHp).toBeCloseTo(def.stats.maxHp * 50, 3);
      const before = effStats(tg.w, b);
      expect(before.atk).toBeCloseTo(def.stats.atk, 6);
      expect(before.atkSpeed).toBeCloseTo(def.stats.atkSpeed, 6);
      // phase: nothing just above the line, the event just under it
      clearEvents(tg);
      b.hp = ph.hpBelow * b.maxHp + 1;
      advance(tg, 0.2);
      expect(eventsOf(tg, 'bossPhase')).toHaveLength(0);
      expect(monsterCdMult(b)).toBe(1);
      crossPhase(tg);
      expect(eventsOf(tg, 'bossPhase').map(e => e.name)).toEqual([ph.name]);
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
    const tg = calm('morgue_drawers');
    expect(tg.w.state.plan.timeLimit).toBe(DEFAULT_TUNABLES.bossFloorTime);
    advance(tg, DEFAULT_TUNABLES.bossFloorTime - 1);
    expect(tg.w.state.bossEnraged).toBe(false);
    advance(tg, 1.2);
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(eventsOf(tg, 'enrage')).toHaveLength(1);
  });

  it('a raid on the ward floors (11–15) meets these bosses on the ward background, with the floor scaling on top', () => {
    const tg = raidGame('empty_beds', { floor: 13 });
    expect(tg.w.state.plan).toMatchObject({ kind: 'boss', bossId: 'empty_beds', theme: 'ward' });
    expect(bossOf(tg).maxHp).toBeGreaterThan(getBoss('empty_beds').stats.maxHp);
  });
});

describe('번호 없는 서랍', () => {
  const LEFT: AreaShape = { shape: 'rect', dir: 'right', length: 11, width: 2.6 };
  const RIGHT: AreaShape = { shape: 'rect', dir: 'left', length: 11, width: 2.6 };

  it('서랍 열림: three half-width drawers slide out of the left wall, 0.4 s apart — the right half of the floor is safe', () => {
    const tg = soft('morgue_drawers', [HUMAN, HUMAN2]);
    const inRow = active(tg, 0);
    const away = active(tg, 1);
    pin(inRow, { x: 4, y: 6 });
    pin(away, { x: 20, y: 6 });
    castSkill(tg, 'morgue_drawers', 'md_drawers', inRow);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => t.area)).toEqual([LEFT, LEFT, LEFT]);
    expect(tele.map(t => spot(t.center))).toEqual([[0, 2.2], [0, 6], [0, 9.8]]); // from the left wall
    expect(tele.map(t => t.total)).toEqual([1.3, 1.7, 2.1]);
    for (let y = 0.5; y < 12; y += 0.5) {
      // nothing reaches past the middle; the three rows fill the left half
      for (let x = 11.5; x < 24; x += 0.5) expect(tele.some(t => covers(t, { x, y })), `${x},${y}`).toBe(false);
      if (y >= 1 && y <= 11 && Math.abs(y - 4.1) > 0.3 && Math.abs(y - 7.9) > 0.3) expect(tele.some(t => covers(t, { x: 5, y })), `5,${y}`).toBe(true);
    }
    // standing in the middle drawer's way: one hit when it opens (1.7 s), nothing from the other two
    advance(tg, 1.6);
    expect(hitsOn(tg, inRow)).toHaveLength(0);
    advance(tg, 0.2);
    expect(hitsOn(tg, inRow)).toHaveLength(1);
    expect(hitsOn(tg, inRow)[0]).toBeCloseTo(softHit(tg, 'morgue_drawers', inRow, 2), 6);
    advance(tg, 0.6);
    expect(hitsOn(tg, inRow)).toHaveLength(1);
    expect(hitsOn(tg, away)).toHaveLength(0);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });

  it('오른쪽 서랍 (phase 2): the same three rows from the right wall, faster — now the left half is safe', () => {
    const tg = soft('morgue_drawers', [HUMAN, HUMAN2]);
    const away = active(tg, 0);
    const inRow = active(tg, 1);
    pin(away, { x: 4, y: 9.8 });
    pin(inRow, { x: 20, y: 9.8 });
    castSkill(tg, 'morgue_drawers', 'md_drawers_right', inRow);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => t.area)).toEqual([RIGHT, RIGHT, RIGHT]);
    expect(tele.map(t => spot(t.center))).toEqual([[24, 2.2], [24, 6], [24, 9.8]]);
    expect(tele.map(t => t.total)).toEqual([1.2, 1.5, 1.8]);
    for (let y = 0.5; y < 12; y += 0.5) for (let x = 0.5; x <= 12.5; x += 0.5) expect(tele.some(t => covers(t, { x, y })), `${x},${y}`).toBe(false);
    advance(tg, 1.9);
    expect(hitsOn(tg, inRow)).toHaveLength(1);
    expect(hitsOn(tg, away)).toHaveLength(0);
  });

  it('냉기: a ring of frost around the target — the target stands in its hole, whoever is next to it is hit and slowed 40 % for 2 s', () => {
    const tg = soft('morgue_drawers', [HUMAN, HUMAN2]);
    const called = active(tg, 0);
    const near = active(tg, 1);
    pin(called, { x: 12, y: 6 });
    pin(near, { x: 15, y: 6 });
    castSkill(tg, 'morgue_drawers', 'md_frost', called);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total, t.center])).toEqual([[{ shape: 'ring', inner: 1.5, outer: 4.5 }, 1.2, { x: 12, y: 6 }]]);
    advance(tg, 1.3);
    expect(hitsOn(tg, called)).toHaveLength(0);
    expect(hitsOn(tg, near)).toHaveLength(1);
    expect(hitsOn(tg, near)[0]).toBeCloseTo(softHit(tg, 'morgue_drawers', near, 2.2), 6);
    expect(statusValue(near, 'slow')).toBeCloseTo(0.4, 6);
    expect(hasStatus(called, 'slow')).toBe(false);
    advance(tg, 1.7);
    expect(hasStatus(near, 'slow')).toBe(true);
    advance(tg, 0.4);
    expect(hasStatus(near, 'slow')).toBe(false);
  });

  it('일어난 환자: 2–3 링거 환자 climb out by the cabinet, with no warning (an instant summon)', () => {
    const tg = calm('morgue_drawers');
    silence(tg);
    advance(tg, 0.2);
    castSkill(tg, 'morgue_drawers', 'md_wake', active(tg));
    const out = adds(tg);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(3);
    for (const a of out) {
      expect(a.defId).toBe('iv_zombie');
      expect(Math.hypot(a.pos.x - BOSS_POS.x, a.pos.y)).toBeLessThan(3);
    }
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });
});

describe('투시 촬영기', () => {
  /** 투시 on the pinned field character, then 현상 cast at it; returns once 현상's warning is up. */
  function scanThenDevelop(): { tg: TestGame; marked: SimEntity } {
    const tg = soft('xray_machine');
    const marked = active(tg);
    pin(marked, { x: 12, y: 7 });
    castSkill(tg, 'xray_machine', 'xr_scan', marked);
    const beam = tg.w.state.telegraphs[0];
    expect([beam.area, beam.total, beam.origin]).toEqual([{ shape: 'line', length: 16, width: 2 }, 1.2, BOSS_POS]);
    expect(covers(beam, { x: 12, y: 11 })).toBe(true);
    expect(covers(beam, { x: 15, y: 7 })).toBe(false);
    advance(tg, 1.3);
    expect(hitsOn(tg, marked)).toHaveLength(1);
    expect(hitsOn(tg, marked)[0]).toBeCloseTo(softHit(tg, 'xray_machine', marked, 1.4), 6);
    expect(statusValue(marked, 'vulnerable')).toBeCloseTo(0.35, 6);
    clearEvents(tg);
    castSkill(tg, 'xray_machine', 'xr_develop', marked);
    // two parts: both hits are warned (and follow) from the cast on
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total])).toEqual([[{ shape: 'circle', radius: 2.2 }, 1.6], [{ shape: 'circle', radius: 2.2 }, 2]]);
    return { tg, marked };
  }

  it('투시 → 현상: the beam marks its target (취약 35 %, 4 s), then both hits of 현상 land 35 % harder on it', () => {
    const { tg, marked } = scanThenDevelop();
    advance(tg, 1.5);
    expect(hitsOn(tg, marked)).toHaveLength(0);
    advance(tg, 0.2);
    expect(hitsOn(tg, marked)).toHaveLength(1);
    advance(tg, 0.4);
    const hits = hitsOn(tg, marked);
    expect(hits).toHaveLength(2); // 0.4 s apart
    for (const h of hits) expect(h).toBeCloseTo(softHit(tg, 'xray_machine', marked, 1.5) * 1.35, 6);
    // the mark runs out 4 s after the beam
    expect(hasStatus(marked, 'vulnerable')).toBe(true);
    advance(tg, 1.9);
    expect(hasStatus(marked, 'vulnerable')).toBe(false);
  });

  it('a swap breaks the combo: 현상 follows the fresh character, who carries no mark — plain hits', () => {
    const { tg, marked } = scanThenDevelop();
    advance(tg, 0.4);
    // well before the 저스트 window (0.5 s): an ordinary swap, far from the warning
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 5, y: 9 } }).ok).toBe(true);
    const fresh = active(tg);
    expect(fresh.id).not.toBe(marked.id);
    expect(hasStatus(fresh, 'vulnerable')).toBe(false);
    advance(tg, 0.6);
    const tele = tg.w.state.telegraphs[0];
    expect(spot(tele.center), 'the warning went with the new field character').toEqual(spot(fresh.pos));
    advance(tg, 1.2);
    const hits = hitsOn(tg, fresh);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h).toBeCloseTo(softHit(tg, 'xray_machine', fresh, 1.5), 6);
    expect(eventsOf(tg, 'damage').some(d => d.targetId === marked.id)).toBe(false);
  });

  it('필름 교체: exactly two 간호 인형 at the target, no warning', () => {
    const tg = calm('xray_machine');
    silence(tg);
    advance(tg, 0.2);
    const me = active(tg);
    pin(me, { x: 7, y: 8 });
    castSkill(tg, 'xray_machine', 'xr_dolls', me);
    const out = adds(tg);
    expect(out.map(a => a.defId)).toEqual(['nurse_doll', 'nurse_doll']);
    for (const a of out) expect(Math.hypot(a.pos.x - 7, a.pos.y - 8)).toBeLessThan(1.6);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });

  it('연속 촬영 (phase 2): five thin beams fan across the target, 0.2 s apart; a hit marks for 3 s', () => {
    const tg = soft('xray_machine', [HUMAN, HUMAN2]);
    const me = active(tg, 0);
    const side = active(tg, 1);
    pin(me, { x: 12, y: 7 });
    pin(side, { x: 18, y: 7 });
    castSkill(tg, 'xray_machine', 'xr_sweep', me);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => t.area)).toEqual(Array(5).fill({ shape: 'line', length: 16, width: 1.2 }));
    expect(tele.map(t => spot(t.center))).toEqual([6, 9, 12, 15, 18].map(x => [x, 7]));
    expect(tele.map(t => t.total)).toEqual([1, 1.2, 1.4, 1.6, 1.8]);
    advance(tg, 1.3);
    expect(hitsOn(tg, me)).toHaveLength(0);
    advance(tg, 0.2);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, me)[0]).toBeCloseTo(softHit(tg, 'xray_machine', me, 1.6), 6);
    advance(tg, 0.4);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, side)).toHaveLength(1); // the last beam
    expect(statusValue(me, 'vulnerable')).toBeCloseTo(0.35, 6);
    advance(tg, 2.4);
    expect(hasStatus(me, 'vulnerable')).toBe(true);
    advance(tg, 0.4);
    expect(hasStatus(me, 'vulnerable')).toBe(false);
  });
});

describe('멈추지 않는 제세동기', () => {
  it('물러서세요: three rings spread out from the machine, 0.4 s apart; a ring that passed is safe; the last one stuns 0.5 s', () => {
    const tg = soft('defibrillator', [HUMAN, HUMAN2, THIRD]);
    const close = active(tg, 0);
    const far = active(tg, 1);
    const mid = active(tg, 2);
    pin(close, { x: 12, y: 2.8 }); // 4 from the machine: the first ring
    pin(far, { x: 12, y: 8.8 }); // 10 away: the third
    pin(mid, { x: 12, y: 5.8 }); // 7 away: the second
    castSkill(tg, 'defibrillator', 'df_shock', close);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => t.area)).toEqual([{ shape: 'ring', inner: 2.5, outer: 5.5 }, { shape: 'ring', inner: 5.5, outer: 8.5 }, { shape: 'ring', inner: 8.5, outer: 12 }]);
    expect(tele.map(t => t.total)).toEqual([1.4, 1.8, 2.2]);
    for (const t of tele) expect(t.center).toEqual(BOSS_POS);
    // together they cover everything between 2.5 and 12 from the machine (its own body fills the hole); the far corners stay safe
    for (let x = 0.5; x < 24; x += 1) {
      for (let y = 0.5; y < 12; y += 1) {
        const d = Math.hypot(x - BOSS_POS.x, y - BOSS_POS.y);
        if (d > 2.5 + R + 0.01 && d < 12 - R - 0.01) expect(tele.some(t => covers(t, { x, y })), `${x},${y}`).toBe(true);
        if (d > 12 + R + 0.01 || d < 2.5 - R - 0.01) expect(tele.some(t => covers(t, { x, y })), `${x},${y}`).toBe(false);
      }
    }
    advance(tg, 1.5);
    expect(hitsOn(tg, close)).toHaveLength(1);
    expect(hitsOn(tg, close)[0]).toBeCloseTo(softHit(tg, 'defibrillator', close, 1.6), 6);
    expect(hasStatus(close, 'stun')).toBe(false);
    expect(hitsOn(tg, mid)).toHaveLength(0);
    expect(hitsOn(tg, far)).toHaveLength(0);
    advance(tg, 0.4);
    expect(hitsOn(tg, mid)).toHaveLength(1);
    expect(hasStatus(mid, 'stun')).toBe(false);
    expect(hitsOn(tg, far)).toHaveLength(0);
    advance(tg, 0.4);
    expect(hitsOn(tg, close)).toHaveLength(1); // the rings moved on past them
    expect(hitsOn(tg, mid)).toHaveLength(1);
    expect(hitsOn(tg, far)).toHaveLength(1);
    expect(hasStatus(far, 'stun')).toBe(true);
    advance(tg, 0.6);
    expect(hasStatus(far, 'stun')).toBe(false);
  });

  it('심폐소생: 2.5 s of charging shown as its own ring (no danger to the party), then it heals 6 % of its max HP (규칙 M1)', () => {
    const tg = soft('defibrillator');
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 0.9 }); // standing inside the ring
    b.hp = b.maxHp * 0.5;
    castSkill(tg, 'defibrillator', 'df_revive', me);
    const tele = tg.w.state.telegraphs;
    expect(tele).toHaveLength(1);
    expect(tele[0]).toMatchObject({ team: 'enemy', self: true, total: 2.5, area: { shape: 'circle', radius: 3.4 } });
    expect(tele[0].center).toEqual(BOSS_POS);
    advance(tg, 2.2);
    expect(justCue(tg.w.state, tg.w.tunables, 0)).toEqual({ danger: false, now: false, landIn: null });
    expect(eventsOf(tg, 'heal')).toHaveLength(0);
    advance(tg, 0.4);
    const heals = eventsOf(tg, 'heal').filter(e => e.targetId === b.id);
    expect(heals).toHaveLength(1);
    expect(heals[0].amount).toBeCloseTo(0.06 * b.maxHp, 3);
    expect(b.hp).toBeCloseTo(0.56 * b.maxHp, 3);
    expect(hitsOn(tg, me)).toHaveLength(0);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });

  it('심폐소생 is cancelled by a groggy during the charge: no heal, the ring is gone', () => {
    const tg = soft('defibrillator', [HUMAN], true);
    const b = bossOf(tg);
    b.hp = b.maxHp * 0.5;
    castSkill(tg, 'defibrillator', 'df_revive', active(tg));
    advance(tg, 1.2);
    expect(tg.w.state.telegraphs).toHaveLength(1);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(tg, 3);
    expect(eventsOf(tg, 'heal').filter(e => e.targetId === b.id)).toHaveLength(0);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(eventsOf(tg, 'interrupt').some(e => e.sourceId === b.id)).toBe(true);
    expect(b.hp).toBeLessThanOrEqual(b.maxHp * 0.5);
  });

  it('in a real fight it starts charging about 10 s in and never heals past full', () => {
    const tg = calm('defibrillator');
    const b = bossOf(tg);
    advance(tg, 14);
    expect(bossCasts(tg).some(c => c.skillId === 'df_revive' && c.delay === 2.5)).toBe(true);
    expect(b.hp).toBeLessThanOrEqual(b.maxHp);
  });

  it('전기 충격: a + of two bars on the target (arms 4.5 long, 1.4 wide)', () => {
    const tg = soft('defibrillator', [HUMAN, HUMAN2, THIRD]);
    const me = active(tg, 0);
    const onArm = active(tg, 1);
    const diagonal = active(tg, 2);
    pin(me, { x: 12, y: 6 });
    pin(onArm, { x: 15.5, y: 6 });
    pin(diagonal, { x: 14.4, y: 8.4 });
    castSkill(tg, 'defibrillator', 'df_jolt', me);
    const cross = tg.w.state.telegraphs[0];
    expect([cross.area, cross.total, cross.center]).toEqual([{ shape: 'cross', length: 4.5, width: 1.4 }, 1.1, { x: 12, y: 6 }]);
    advance(tg, 1.2);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, me)[0]).toBeCloseTo(softHit(tg, 'defibrillator', me, 2.4), 6);
    expect(hitsOn(tg, onArm)).toHaveLength(1);
    expect(hitsOn(tg, diagonal)).toHaveLength(0);
  });

  it('두 번 충격 (phase 2): two shocks on one character, 1.0 s and 1.6 s — both follow it wherever it stands', () => {
    const tg = soft('defibrillator');
    const me = active(tg);
    pin(me, { x: 9, y: 5 });
    castSkill(tg, 'defibrillator', 'df_double', me);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total])).toEqual([[{ shape: 'single' }, 1], [{ shape: 'single' }, 1.6]]);
    me.pos = { x: 16, y: 9 };
    advance(tg, 0.5);
    for (const t of tg.w.state.telegraphs) expect(t.center).toEqual({ x: 16, y: 9 });
    advance(tg, 0.6);
    expect(hitsOn(tg, me)).toHaveLength(1);
    advance(tg, 0.6);
    const hits = hitsOn(tg, me);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h).toBeCloseTo(softHit(tg, 'defibrillator', me, 2.6), 6);
  });
});

describe('빈 병상 행렬', () => {
  it('병상 정렬: everyone in the ring is dragged 3.5 toward the called spot (no damage), then the spot is hit 0.8 s later', () => {
    const tg = soft('empty_beds', [HUMAN, HUMAN2, THIRD]);
    const called = active(tg, 0);
    const near = active(tg, 1);
    const far = active(tg, 2);
    pin(called, { x: 12, y: 6 });
    pin(near, { x: 17, y: 6 }); // 5 away: in the ring
    pin(far, { x: 21, y: 6 }); // 9 away: out of it
    castSkill(tg, 'empty_beds', 'eb_lineup', called);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => [t.area, t.total, t.center])).toEqual([
      [{ shape: 'ring', inner: 1.5, outer: 7 }, 1.3, { x: 12, y: 6 }],
      [{ shape: 'circle', radius: 2.8 }, 2.1, { x: 12, y: 6 }],
    ]);
    advance(tg, 1.2);
    expect(near.pos).toEqual({ x: 17, y: 6 });
    advance(tg, 0.2);
    expect(near.pos.x).toBeCloseTo(13.5, 6); // dragged into the blast
    expect(near.pos.y).toBeCloseTo(6, 6);
    expect(called.pos).toEqual({ x: 12, y: 6 }); // the hole of the ring
    expect(far.pos).toEqual({ x: 21, y: 6 });
    expect(eventsOf(tg, 'damage')).toHaveLength(0);
    // both warnings stay where they were called, whatever the target does next
    expect(tg.w.state.telegraphs.map(t => t.center)).toEqual([{ x: 12, y: 6 }]);
    advance(tg, 0.8);
    expect(hitsOn(tg, called)).toHaveLength(1);
    expect(hitsOn(tg, near)).toHaveLength(1);
    expect(hitsOn(tg, near)[0]).toBeCloseTo(softHit(tg, 'empty_beds', near, 2.8), 6);
    expect(hitsOn(tg, far)).toHaveLength(0);
  });

  it('시트 덮침: the sheet follows its target until it drops — 2.2 × attack and a 50 % slow for 2 s', () => {
    const tg = soft('empty_beds');
    const me = active(tg);
    pin(me, { x: 6, y: 4 });
    castSkill(tg, 'empty_beds', 'eb_sheet', me);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total])).toEqual([[{ shape: 'circle', radius: 2.4 }, 1.2]]);
    me.pos = { x: 15, y: 9 };
    advance(tg, 0.6);
    expect(tg.w.state.telegraphs[0].center).toEqual({ x: 15, y: 9 });
    advance(tg, 0.7);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, me)[0]).toBeCloseTo(softHit(tg, 'empty_beds', me, 2.2), 6);
    expect(statusValue(me, 'slow')).toBeCloseTo(0.5, 6);
    advance(tg, 1.7);
    expect(hasStatus(me, 'slow')).toBe(true);
    advance(tg, 0.4);
    expect(hasStatus(me, 'slow')).toBe(false);
  });

  it('소독약: a 0.8 s warning, then a puddle that stays 5 s — whoever stands in it is weakened (공격력 −25 %) and stung twice a second', () => {
    const tg = soft('empty_beds', [HUMAN, HUMAN2]);
    const inside = active(tg, 0);
    const outside = active(tg, 1);
    pin(inside, { x: 12, y: 6 });
    pin(outside, { x: 16, y: 6 }); // 4 away
    castSkill(tg, 'empty_beds', 'eb_disinfect', inside);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total])).toEqual([[{ shape: 'circle', radius: 2.6 }, 0.8]]);
    advance(tg, 0.9);
    const zones = tg.w.state.zones;
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ team: 'enemy', center: { x: 12, y: 6 }, radius: 2.6, total: 5 });
    advance(tg, 2);
    expect(statusValue(inside, 'atkDown')).toBeCloseTo(0.25, 6);
    expect(hasStatus(outside, 'atkDown')).toBe(false);
    const n = hitsOn(tg, inside).length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(hitsOn(tg, inside)[0]).toBeCloseTo(softHit(tg, 'empty_beds', inside, 0.25), 6);
    // walking out of it ends both
    inside.pos = { x: 4, y: 10 };
    advance(tg, 1.8);
    expect(hitsOn(tg, inside).length).toBeLessThanOrEqual(n + 1);
    expect(hasStatus(inside, 'atkDown')).toBe(false);
    expect(hitsOn(tg, outside)).toHaveLength(0);
    advance(tg, 1.5);
    expect(tg.w.state.zones).toHaveLength(0);
  });

  it('겹친 병상 (phase 2): two beds crash down left and right of the target, 0.3 s apart, each slowing 50 %', () => {
    const tg = soft('empty_beds', [HUMAN, HUMAN2]);
    const me = active(tg, 0);
    const right = active(tg, 1);
    pin(me, { x: 12, y: 6 });
    pin(right, { x: 16, y: 6 }); // under the second bed only
    castSkill(tg, 'empty_beds', 'eb_double', me);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => [t.area, t.total, t.center])).toEqual([
      [{ shape: 'circle', radius: 2.4 }, 1.1, { x: 9.5, y: 6 }],
      [{ shape: 'circle', radius: 2.4 }, 1.4, { x: 14.5, y: 6 }],
    ]);
    advance(tg, 1.2);
    expect(hitsOn(tg, right)).toHaveLength(0);
    advance(tg, 0.3);
    expect(hitsOn(tg, right)).toHaveLength(1);
    expect(hitsOn(tg, right)[0]).toBeCloseTo(softHit(tg, 'empty_beds', right, 1.9), 6);
    expect(statusValue(right, 'slow')).toBeCloseTo(0.5, 6);
  });
});

describe('폐병동: bots-only fights', () => {
  const SEEDS = [3, 11, 19, 27, 101, 202, 303, 404];

  /** One boss fight on floor 1 with three bot seats: 'clear' with its time, 'wipe', or 'late' (the boss enraged first). */
  function fightOnce(id: Id, seed: number): { end: 'clear' | 'late' | 'wipe'; time: number } {
    const tg = raidGame(id, { seed, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
    const s = tg.w.state;
    let time = 0;
    // bots pick their reward at once and the run goes on: stop when floor 1 is over
    while (s.phase === 'combat' && s.floor === 1 && !s.bossEnraged) {
      time = s.floorTime;
      tick(tg.w);
    }
    if (s.runResult?.outcome === 'defeat') return { end: 'wipe', time };
    return { end: s.bossEnraged ? 'late' : 'clear', time };
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

describe('폐병동: looks, warning motifs, voices', () => {
  const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: Record<string, Partial<BossDrawOpts>> = {
    idle: {},
    'wind-up': { charge: 0.8 },
    attack: { flash: 1, charge: 1 },
    groggy: { groggy: 1 },
    'standing up': { groggy: 0.4, groggyWake: 0.5 },
    enraged: { enraged: true, shake: 0.6 },
    'phase 2': { phase: 2, phaseFlash: 0.5 },
    'the worst frame': { phase: 3, enraged: true, flash: 1, charge: 1, groggy: 0.5 },
    'no target': { lookX: null, lookY: null },
    leaving: { retreat: 0.6 },
  };

  /** A counting 2D context (every method is a no-op that counts). */
  function counter(): { ctx: CanvasRenderingContext2D; n: () => number; texts: () => number; fills: Set<string>; reset(): void } {
    let n = 0;
    let texts = 0;
    const fills = new Set<string>();
    const store: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(store, {
      get: (target, prop) =>
        prop in target
          ? target[prop]
          : () => {
              n++;
              if (prop === 'fillText') texts++;
            },
      set: (target, prop, value) => {
        if (prop === 'fillStyle') fills.add(String(value));
        target[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, n: () => n, texts: () => texts, fills, reset: () => { n = 0; texts = 0; } };
  }

  it('each boss has its own look in the registry: it draws every pose (and its groggy props) inside the budget', () => {
    const cam = new Camera();
    cam.setArena(24, 12);
    const colours = new Set<string>();
    for (const id of IDS) {
      const look = bossLook(id);
      expect(look, `${id} look`).toBeDefined();
      expect(look!.color).toBe(getBoss(id).color);
      colours.add(look!.color);
      const c = counter();
      for (const [name, pose] of Object.entries(POSES)) {
        for (let f = 0; f < 12; f++) {
          const o = { ...BASE, ...pose, time: 5.1 + f * 0.13 };
          c.reset();
          expect(() => {
            look!.draw(c.ctx, cam, 12, -1.2, 3, o);
            if (o.groggy > 0) look!.props?.(c.ctx, cam, 12, -1.2, 3, o);
          }, `${id} ${name}`).not.toThrow();
          expect(c.n(), `${id} ${name}: draws something`).toBeGreaterThan(40);
          expect(c.n(), `${id} ${name}: canvas calls`).toBeLessThanOrEqual(330); // the shared budget is 360: some room left
          expect(c.texts(), `${id} ${name}: texts`).toBeLessThanOrEqual(2);
        }
      }
      c.reset();
      look!.draw(c.ctx, cam, 12, -1.2, 3, { ...BASE, retreat: 1 });
      expect(c.n(), `${id}: nothing once gone`).toBe(0);
      expect(c.fills.size, `${id} uses a palette`).toBeGreaterThan(4);
      const by = cam.sy(-1.2) + BOSS_DROP;
      for (const g of [0, 1]) {
        const y = look!.headY!(by, 160, g);
        expect(y).toBeGreaterThan(60);
        expect(y).toBeLessThan(330);
      }
    }
    expect(colours.size).toBe(4);
    // groggy signs: the dropped name tag, the dead battery
    expect(typeof bossLook('morgue_drawers')!.props).toBe('function');
    expect(typeof bossLook('defibrillator')!.props).toBe('function');
  });

  it("the phase tint and the enrage tint stack on each boss's own colour (a colour mixed twice must not fall back to grey)", () => {
    const cam = new Camera();
    cam.setArena(24, 12);
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
    const STATES: [number, boolean][] = [[2, false], [1, true], [2, true], [3, true]];
    for (const id of IDS) {
      const look = bossLook(id)!;
      const seen = new Set<string>();
      for (const [phase, enraged] of STATES) {
        // what the kit's tinted() means: 12 % a phase toward #ff2050, then 30 % toward #ff0033 when enraged
        let want = rgb(look.color);
        if (phase > 1) want = lerp(want, rgb('#ff2050'), 0.12 * (phase - 1));
        if (enraged) want = lerp(want, rgb('#ff0033'), 0.3);
        const c = counter();
        look.draw(c.ctx, cam, 12, -1.2, 3, { ...BASE, phase, enraged, time: 5.1 });
        const fills = [...c.fills].map(f => /^rgb\((\d+),(\d+),(\d+)\)$/.exec(f)).filter(m => m !== null).map(m => [+m[1], +m[2], +m[3]]);
        const hit = fills.find(f => f.every((v, i) => Math.abs(v - want[i]) <= 1.5));
        expect(hit, `${id} phase ${phase}${enraged ? ' enraged' : ''}: body ${want.map(Math.round)} among ${JSON.stringify(fills)}`).toBeDefined();
        seen.add(`${id}:${hit}`);
      }
      expect(seen.size, `${id}: four states, four body colours`).toBe(STATES.length);
    }
  });

  it('warning motifs: 병상 정렬 pulls, 소독약 lingers, the two summons are marked spawn; every row is a skill of the zone', () => {
    expect(BOSS_TELE_MOTIF.eb_lineup).toBe('pull');
    expect(BOSS_TELE_MOTIF.eb_disinfect).toBe('linger');
    expect(BOSS_TELE_MOTIF.md_wake).toBe('spawn');
    expect(BOSS_TELE_MOTIF.xr_dolls).toBe('spawn');
    const ids = new Set(IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id)));
    for (const k of Object.keys(BOSS_TELE_MOTIF)) if (/^(md|xr|df|eb)_/.test(k)) expect(ids.has(k), k).toBe(true);
  });

  it('voices: the table rows (root, motif, timbre) and one sound kind per skill', () => {
    const want: Record<Id, [number, number[], string]> = {
      morgue_drawers: [116.5, [0, -1, -1], 'wind'],
      xray_machine: [146.8, [0, 7, 0], 'hum'],
      defibrillator: [123.5, [0, 0, 12], 'static'],
      empty_beds: [103.8, [0, -2, -5], 'clatter'],
    };
    for (const id of IDS) {
      const v = BOSS_VOICE[id];
      expect([v.base, v.motif, v.timbre]).toEqual(want[id]);
      expect(Object.keys(v.kinds).sort()).toEqual(allSkills(getBoss(id)).map(sk => sk.id).sort());
    }
    expect(BOSS_VOICE.morgue_drawers.kinds).toMatchObject({ md_drawers: 'doors', md_drawers_right: 'doors', md_frost: 'gas', md_wake: 'summon' });
    expect(BOSS_VOICE.xray_machine.kinds).toMatchObject({ xr_scan: 'beam', xr_sweep: 'beam', xr_develop: 'burst', xr_dolls: 'summon' });
    expect(BOSS_VOICE.defibrillator.kinds).toMatchObject({ df_shock: 'static', df_double: 'static', df_revive: 'countdown', df_jolt: 'burst' });
    expect(BOSS_VOICE.empty_beds.kinds).toMatchObject({ eb_lineup: 'tentacle', eb_sheet: 'papers', eb_double: 'papers', eb_disinfect: 'gas' });
  });
});
