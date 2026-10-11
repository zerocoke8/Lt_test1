// 기획 19차 보스 레이드 — 옥상·이계 bosses (docs/bosses.md 2장): 물탱크의 주인 · 천둥 안테나 · 대답하는 연필 · 거꾸로 뜬 달.
// The shared contract of a new boss (expectBossContract), the table's numbers, the order and shapes of their warnings,
// phase / enrage / groggy, the four patterns that carry a rule (낙뢰 = a 0.9 s warning, 배수구 = a dragging puddle,
// 월식 = only the lit disc is safe, 틀린 답 = a root only a swap gets out of), bots-only fights and the looks.
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
import { justParams, justWindow } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { hasStatus } from '../../src/sim/status';
import { monsterCdMult } from '../../src/sim/units';
import type { SimEntity } from '../../src/sim/world';
import type { AreaShape, GameEvent, MonsterSkill, Telegraph, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, partsOf, raidGame } from './bossRaidHelpers';

const IDS = ['tank_dweller', 'thunder_antenna', 'answering_pencil', 'inverted_moon'] as const;
type Id = (typeof IDS)[number];
const CALM = { invincible: true, bossGroggyThreshold: 0 } as const;
const R = 0.4; // a character's body radius, roughly

type Cast = Extract<GameEvent, { type: 'skillCast' }>;

/** The boss's own casts so far, in order. */
function bossCasts(tg: TestGame): Cast[] {
  const id = tg.w.state.bossId;
  return drain(tg).filter((e): e is Cast => e.type === 'skillCast' && e.sourceId === id);
}

/** A long calm fight against `id` (party invincible, no groggy, boss never dies). */
function calm(id: Id, players = [HUMAN], knobs: Partial<Tunables> = {}): TestGame {
  return raidGame(id, { hpMult: 50, players, tunables: { ...CALM, ...knobs } });
}

/** A fight where hits really land (damage events) but nobody dies: the boss hits like a feather and only with skills. */
function soft(id: Id, players = [HUMAN], knobs: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 50, players, tunables: { bossGroggyThreshold: 0, monsterDmgMult: SOFT, ...knobs } });
  silence(tg);
  advance(tg, 0.2); // the boss picks its target
  bossOf(tg).rt.attackCd = 1e9; // no basic shots: every hit on the party is a skill
  clearEvents(tg);
  return tg;
}
const SOFT = 0.01;

/** The boss stops casting by itself (the test casts single skills by hand). */
function silence(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.skills = [];
  b.rt.skillCds = [];
  b.rt.phase = 99;
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

/** Hits `e` took so far (in a soft fight: skill hits only). */
function skillHits(tg: TestGame, e: SimEntity): number {
  return eventsOf(tg, 'damage').filter(d => d.targetId === e.id).length;
}

/** What one skill hit of `amount` × the boss's attack does to `e` in a soft fight (its defence applies). */
function softHit(tg: TestGame, id: Id, e: SimEntity, amount: number): number {
  return amount * getBoss(id).stats.atk * SOFT * (1 - effStats(tg.w, e).def);
}

const covers = (t: Telegraph, p: Vec2) => hitsArea(t.area, t.center, t.origin, p, R);

describe('옥상·이계: the zone table', () => {
  it('has five bosses — the four new ones with data, then 심연의 감시자; bands 앞 · 뒤 · 중 · 중', () => {
    expect(ZONE_BOSSES.rooftop).toEqual([...IDS, 'abyss_watcher']);
    expect(BOSSES.filter(b => b.zone === 'rooftop').map(b => b.id).sort()).toEqual([...IDS, 'abyss_watcher'].sort());
    // review: 천둥 안테나 (the rooftop's deadliest new boss) never opens the zone; 거꾸로 뜬 달 may
    expect(IDS.map(id => BOSS_RAID_BAND[id])).toEqual(['early', 'late', 'mid', 'mid']);
  });

  // HP / atk / atkSpeed / groggy, then per skill [cooldown, first use] (docs/bosses.md 2장)
  const TABLE: Record<Id, { name: string; stats: [number, number, number, number]; skills: Record<string, [number, number]>; phase: [string, number, number | undefined, number]; summons: string[] }> = {
    tank_dweller: { name: '물탱크의 주인', stats: [7600, 30, 0.5, 0.9], skills: { td_flood: [13, 4], td_drain: [12, 8], td_umbrellas: [14, 6], td_flood_up: [13, 1.5] }, phase: ['역류', 0.5, 1.15, 0.85], summons: ['slime'] },
    thunder_antenna: { name: '천둥 안테나', stats: [7000, 32, 0.6, 1], skills: { ta_bolt: [7, 3], ta_static: [11, 6], ta_crackle: [10, 9], ta_double_bolt: [11, 1.5] }, phase: ['채널 고정', 0.5, 1.2, 0.85], summons: [] },
    answering_pencil: { name: '대답하는 연필', stats: [8200, 30, 0.55, 1.1], skills: { ap_box: [12, 4], ap_pin: [11, 7], ap_stroke: [8, 9], ap_name: [12, 1.5] }, phase: ['대답', 0.5, 1.15, 0.85], summons: [] },
    inverted_moon: { name: '거꾸로 뜬 달', stats: [7400, 30, 0.55, 1], skills: { im_eclipse: [14, 5], im_hands: [10, 3], im_shadows: [15, 8], im_moonbeam: [11, 1.5] }, phase: ['붉은 달', 0.5, undefined, 0.85], summons: ['goblin', 'red_mask'] },
  };

  for (const id of IDS) {
    it(`${id}: the table's numbers`, () => {
      const def = getBoss(id);
      const row = TABLE[id];
      expect(def.name).toBe(row.name);
      expect([def.stats.maxHp, def.stats.atk, def.stats.atkSpeed, def.groggy?.threshold]).toEqual(row.stats);
      expect(Object.fromEntries(allSkills(def).map(sk => [sk.id, [sk.cooldown, sk.initialDelay]]))).toEqual(row.skills);
      const ph = def.phases![0];
      expect([ph.name, ph.hpBelow, ph.atkSpeedMult, ph.cooldownMult]).toEqual(row.phase);
      expect(def.enrage).toEqual(ENRAGE);
      const summons = allSkills(def).flatMap(sk => partsOf(sk)).flatMap(a => (a.summon ? [a.summon.unitId] : []));
      expect(summons).toEqual(row.summons);
      // a tip never runs past one HUD line
      for (const sk of allSkills(def)) if (sk.hint) expect(sk.hint.length).toBeLessThanOrEqual(46);
    });
  }
});

describe('옥상·이계: the contract of a new boss', () => {
  for (const id of IDS) it(`${id}: shape, every skill within 45 s, phase → phase skill, kill → clear, same seed same fight`, () => expectBossContract(id), 30000);
});

describe('옥상·이계: warnings come in order, with the right footprints', () => {
  // first casts in a calm fight: skill ids by their first use, then the footprints of each skill's parts with their delays
  const ORDER: Record<Id, string[]> = {
    tank_dweller: ['td_flood', 'td_umbrellas', 'td_drain'],
    thunder_antenna: ['ta_bolt', 'ta_static', 'ta_crackle'],
    answering_pencil: ['ap_box', 'ap_pin', 'ap_stroke'],
    inverted_moon: ['im_hands', 'im_eclipse', 'im_shadows'],
  };
  const SHAPES: Record<string, [AreaShape['shape'], number][]> = {
    td_flood: [['rect', 1.4], ['rect', 1.85], ['rect', 2.3], ['rect', 2.75]],
    td_drain: [['circle', 1]],
    td_umbrellas: [['circle', 0]],
    td_flood_up: [['rect', 1.2], ['rect', 1.6], ['rect', 2], ['rect', 2.4]],
    ta_bolt: [['single', 1.5]],
    ta_static: [['ring', 1.4]],
    ta_crackle: [['cross', 1.2]],
    ta_double_bolt: [['single', 1.3], ['single', 1.9]],
    ap_box: [['rect', 1.2], ['rect', 1.5], ['rect', 1.8], ['rect', 2.1]],
    ap_pin: [['single', 0.9]],
    ap_stroke: [['line', 1.3]],
    ap_name: [['line', 1], ['line', 1.25], ['ring', 1.8]],
    im_eclipse: [['ring', 2.2]],
    im_hands: [['circle', 1.1], ['circle', 1.25], ['circle', 1.4], ['circle', 1.55]],
    im_shadows: [['circle', 0], ['circle', 0]],
    im_moonbeam: [['fan', 1.5]],
  };

  for (const id of IDS) {
    it(`${id}: ${ORDER[id].join(' → ')}`, () => {
      const tg = calm(id);
      advance(tg, 12);
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

  it('every skill of the zone is in the shape table (nothing unchecked)', () => {
    const ids = IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id));
    expect(Object.keys(SHAPES).sort()).toEqual(ids.sort());
  });
});

describe('옥상·이계: phase, enrage, groggy', () => {
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
    const tg = calm('tank_dweller');
    expect(tg.w.state.plan.timeLimit).toBe(DEFAULT_TUNABLES.bossFloorTime);
    advance(tg, DEFAULT_TUNABLES.bossFloorTime - 1);
    expect(tg.w.state.bossEnraged).toBe(false);
    advance(tg, 1.2);
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(eventsOf(tg, 'enrage')).toHaveLength(1);
  });
});

describe('물탱크의 주인', () => {
  it('범람: four rows cover the whole floor top-down, 0.45 s apart; a row that passed is safe; 거꾸로 범람 runs bottom-up', () => {
    const tg = soft('tank_dweller');
    const me = active(tg);
    pin(me, { x: 9, y: 1.4 });
    castSkill(tg, 'tank_dweller', 'td_flood', me);
    const rows = [...tg.w.state.telegraphs];
    expect(rows.map(t => t.area)).toEqual(Array(4).fill({ shape: 'rect', dir: 'right', length: 24, width: 3 }));
    expect(rows.map(t => [t.center.x, Math.round(t.center.y * 1e6) / 1e6])).toEqual([1.5, 4.5, 7.5, 10.5].map(y => [0, y])); // from the left wall
    expect(rows.map(t => t.total)).toEqual([1.4, 1.85, 2.3, 2.75]);
    for (let x = 0.5; x < 24; x += 1) for (let y = 0.5; y < 12; y += 0.5) expect(rows.some(t => covers(t, { x, y })), `${x},${y}`).toBe(true);
    // standing in the first row: one hit at 1.4 s, nothing from the rows below
    advance(tg, 1.3);
    expect(skillHits(tg, me)).toBe(0);
    advance(tg, 0.2);
    expect(skillHits(tg, me)).toBe(1);
    advance(tg, 1.6);
    expect(skillHits(tg, me)).toBe(1);
    expect(tg.w.state.telegraphs).toHaveLength(0);

    castSkill(tg, 'tank_dweller', 'td_flood_up', me);
    const up = [...tg.w.state.telegraphs];
    expect(up.map(t => Math.round(t.center.y * 1e6) / 1e6)).toEqual([10.5, 7.5, 4.5, 1.5]);
    expect(up.map(t => t.total)).toEqual([1.2, 1.6, 2, 2.4]);
  });

  it('배수구: a puddle of 4 s that drags at most 0.5 a tick toward its centre and never past it (규칙 M3)', () => {
    const tg = calm('tank_dweller');
    silence(tg);
    advance(tg, 0.2);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    castSkill(tg, 'tank_dweller', 'td_drain', me);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total])).toEqual([[{ shape: 'circle', radius: 3 }, 1]]);
    me.pos = { x: 14.6, y: 6 }; // 2.6 from the drain when it opens
    let prev = me.pos.x;
    let drags = 0;
    let zoneTicks = 0;
    for (let t = 0; t < 30 * 5.5; t++) {
      tick(tg.w);
      if (tg.w.state.zones.length > 0) zoneTicks++;
      const step = prev - me.pos.x;
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      expect(step).toBeLessThanOrEqual(0.5 + 1e-9);
      if (step > 1e-9) drags++;
      prev = me.pos.x;
    }
    expect(drags).toBeGreaterThanOrEqual(4);
    expect(me.pos.x).toBeCloseTo(12.3, 6);
    expect(me.pos.y).toBeCloseTo(6, 6);
    expect(zoneTicks / 30).toBeGreaterThan(3.8);
    expect(zoneTicks / 30).toBeLessThan(4.2);
    expect(tg.w.state.zones).toHaveLength(0);
  });

  it('우산 손님: 4–6 외발 우산 around the target, no warning (an instant summon)', () => {
    const tg = calm('tank_dweller');
    silence(tg);
    advance(tg, 0.2);
    clearEvents(tg);
    const me = active(tg);
    pin(me, { x: 8, y: 7 });
    castSkill(tg, 'tank_dweller', 'td_umbrellas', me);
    const adds = tg.w.state.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss');
    expect(adds.length).toBeGreaterThanOrEqual(4);
    expect(adds.length).toBeLessThanOrEqual(6);
    for (const a of adds) {
      expect(a.defId).toBe('slime');
      expect(Math.hypot(a.pos.x - 8, a.pos.y - 7)).toBeLessThan(3);
    }
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });
});

describe('천둥 안테나', () => {
  it('낙뢰: cast 1.5 s ahead but the warning shows only the last 0.9 s, on the target; the 저스트 window stays 0.5 s (규칙 M2)', () => {
    const tg = calm('thunder_antenna');
    const me = active(tg);
    let castAt = -1;
    let seenAt = -1;
    let goneAt = -1;
    for (let t = 0; t < 30 * 5.5 && goneAt < 0; t++) {
      tick(tg.w);
      const now = tg.w.state.time;
      for (const e of drain(tg).splice(0)) if (e.type === 'skillCast' && e.skillId === 'ta_bolt' && castAt < 0) castAt = now;
      const tele = tg.w.state.telegraphs[0];
      if (castAt >= 0 && seenAt < 0 && tele) {
        seenAt = now;
        expect(tele.area).toEqual({ shape: 'single' });
        expect(tele.total).toBeGreaterThan(0.85);
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1e-6);
        expect(justWindow(justParams(tg.w, tg.w.state.players[0]), tele.total)).toBeCloseTo(0.5, 6);
      }
      if (tele) expect(tele.center, 'the bolt follows its target').toEqual(me.pos);
      if (seenAt >= 0 && !tele) goneAt = now;
    }
    expect(castAt).toBeGreaterThan(2.9); // first use at 3 s
    expect(castAt).toBeLessThan(3.4);
    expect(seenAt - castAt).toBeGreaterThan(0.55);
    expect(seenAt - castAt).toBeLessThan(0.7);
    expect(goneAt - castAt).toBeGreaterThan(1.45);
    expect(goneAt - castAt).toBeLessThan(1.6);
  });

  it('낙뢰 hits the character it was aimed at for 3.2 × attack; swapping it out makes the bolt miss', () => {
    const tg = soft('thunder_antenna');
    const me = active(tg);
    castSkill(tg, 'thunder_antenna', 'ta_bolt', me);
    advance(tg, 1.6);
    expect(skillHits(tg, me)).toBe(1);
    expect(eventsOf(tg, 'damage')[0].amount).toBeCloseTo(softHit(tg, 'thunder_antenna', me, 3.2), 6);
    // again, swapped out 0.3 s before it lands
    clearEvents(tg);
    castSkill(tg, 'thunder_antenna', 'ta_bolt', me);
    advance(tg, 1.2);
    expect(tg.w.state.telegraphs).toHaveLength(1);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 6, y: 9 } }).ok).toBe(true);
    advance(tg, 0.6);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id)).toHaveLength(0);
  });

  it('두 번 낙뢰: two short warnings 0.6 s apart, 0.9 s each; no summon anywhere in the fight', () => {
    const tg = calm('thunder_antenna');
    silence(tg);
    advance(tg, 0.2);
    const me = active(tg);
    castSkill(tg, 'thunder_antenna', 'ta_double_bolt', me);
    const seen: number[] = [];
    const ids = new Set<number>();
    const t0 = tg.w.state.time;
    for (let t = 0; t < 30 * 2.2; t++) {
      tick(tg.w);
      for (const tele of tg.w.state.telegraphs) {
        if (ids.has(tele.id)) continue;
        ids.add(tele.id);
        seen.push(tg.w.state.time - t0);
        expect(tele.total).toBeGreaterThan(0.85);
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1e-6);
      }
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeGreaterThan(0.35);
    expect(seen[0]).toBeLessThan(0.5);
    expect(seen[1] - seen[0]).toBeGreaterThan(0.55);
    expect(seen[1] - seen[0]).toBeLessThan(0.65);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(allSkills(getBoss('thunder_antenna')).flatMap(partsOf).some(a => a.summon)).toBe(false);
  });

  it('정전기 slows whoever stands in the ring (not the target in its hole); 지직 is an X through the target', () => {
    const tg = soft('thunder_antenna', [HUMAN, HUMAN2]);
    const a = active(tg, 0);
    const c = active(tg, 1);
    pin(a, { x: 12, y: 6 });
    pin(c, { x: 16, y: 6 });
    castSkill(tg, 'thunder_antenna', 'ta_static', a);
    expect(tg.w.state.telegraphs[0].area).toEqual({ shape: 'ring', inner: 2, outer: 6 });
    advance(tg, 1.5);
    expect(hasStatus(c, 'slow')).toBe(true);
    expect(hasStatus(a, 'slow')).toBe(false);
    expect(skillHits(tg, c)).toBe(1);
    expect(skillHits(tg, a)).toBe(0);
    castSkill(tg, 'thunder_antenna', 'ta_crackle', a);
    const x = tg.w.state.telegraphs[0];
    expect(x.area).toEqual({ shape: 'cross', length: 5, width: 1.3, diagonal: true });
    expect(covers(x, { x: 14.5, y: 8.5 })).toBe(true); // on a diagonal arm
    expect(covers(x, { x: 15.5, y: 6 })).toBe(false); // straight to the side: between the arms
  });
});

describe('대답하는 연필', () => {
  it('ㅁ 긋기: four strokes around the target, 0.3 s apart — the 4.8 × 4.8 inside is safe, each side is not', () => {
    const tg = soft('answering_pencil');
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    castSkill(tg, 'answering_pencil', 'ap_box', me);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => t.total)).toEqual([1.2, 1.5, 1.8, 2.1]);
    expect(tele.map(t => t.center)).toEqual([{ x: 12, y: 3 }, { x: 12, y: 9 }, { x: 9, y: 6 }, { x: 15, y: 6 }]);
    expect(tele.map(t => (t.area as { dir: string }).dir)).toEqual(['right', 'right', 'down', 'down']);
    for (const dx of [-1.9, 0, 1.9]) for (const dy of [-1.9, 0, 1.9]) expect(tele.some(t => covers(t, { x: 12 + dx, y: 6 + dy })), `${dx},${dy}`).toBe(false);
    for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0], [3, 3], [-3.4, 2]]) expect(tele.some(t => covers(t, { x: 12 + dx, y: 6 + dy })), `${dx},${dy}`).toBe(true);
    // the strokes are 7 long: 4 to the side of the middle is outside the box altogether
    expect(tele.some(t => covers(t, { x: 12, y: 6 + 4.2 }))).toBe(false);
    advance(tg, 2.3);
    expect(skillHits(tg, me)).toBe(0); // the target itself stands in the safe middle
  });

  it('틀린 답: a 0.9 s warning, then a root of 2.5 s the character cannot walk out of — a swap brings a free one (속박은 교체로)', () => {
    const tg = soft('answering_pencil');
    const me = active(tg);
    me.pos = { x: 12, y: 8 };
    castSkill(tg, 'answering_pencil', 'ap_pin', me);
    expect(tg.w.state.telegraphs.map(t => [t.area.shape, t.total])).toEqual([['single', 0.9]]);
    advance(tg, 1);
    expect(hasStatus(me, 'root')).toBe(true);
    expect(skillHits(tg, me)).toBe(1);
    const spot = { ...me.pos };
    advance(tg, 1);
    expect(me.pos).toEqual(spot);
    expect(hasStatus(me, 'root')).toBe(true);
    // swap: the next card comes in unrooted and walks
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 9 } }).ok).toBe(true);
    advance(tg, 0.1);
    const next = active(tg);
    expect(next.id).not.toBe(me.id);
    expect(hasStatus(next, 'root')).toBe(false);
    const from = { ...next.pos };
    advance(tg, 1.2);
    expect(Math.hypot(next.pos.x - from.x, next.pos.y - from.y)).toBeGreaterThan(0.5);
    // …and without a swap it lasts its 2.5 s
    const tg2 = soft('answering_pencil');
    const me2 = active(tg2);
    me2.pos = { x: 12, y: 8 };
    castSkill(tg2, 'answering_pencil', 'ap_pin', me2);
    advance(tg2, 0.95 + 2.3);
    expect(hasStatus(me2, 'root')).toBe(true);
    advance(tg2, 0.4);
    expect(hasStatus(me2, 'root')).toBe(false);
  });

  it('ㅣ 긋기 is a line from the boss through the target; 이름 쓰기 = two side strokes, then a circle around the target', () => {
    const tg = soft('answering_pencil');
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    castSkill(tg, 'answering_pencil', 'ap_stroke', me);
    const line = tg.w.state.telegraphs[0];
    expect(line.area).toEqual({ shape: 'line', length: 16, width: 1.6 });
    expect(line.origin).toEqual(BOSS_POS);
    expect(covers(line, { x: 12, y: 10 })).toBe(true);
    expect(covers(line, { x: 14, y: 6 })).toBe(false);
    advance(tg, 1.4);
    expect(skillHits(tg, me)).toBe(1);
    clearEvents(tg);
    castSkill(tg, 'answering_pencil', 'ap_name', me);
    const parts = [...tg.w.state.telegraphs];
    expect(parts.map(t => [t.area.shape, t.total])).toEqual([['line', 1], ['line', 1.25], ['ring', 1.8]]);
    expect(parts.map(t => t.center)).toEqual([{ x: 9, y: 6 }, { x: 15, y: 6 }, { x: 12, y: 6 }]);
    expect(parts[2].area).toEqual({ shape: 'ring', inner: 1.4, outer: 3.6 });
    advance(tg, 2);
    expect(skillHits(tg, me)).toBe(0); // between the strokes, in the hole of the ring
  });
});

describe('거꾸로 뜬 달', () => {
  it('월식: only the disc of 2.6 around the called character is safe — next to it no hit, anywhere else 2.6 × attack', () => {
    const tg = soft('inverted_moon', [HUMAN, HUMAN2, { ...HUMAN, name: '셋' }]);
    const called = active(tg, 0);
    const near = active(tg, 1);
    const far = active(tg, 2);
    pin(called, { x: 6, y: 8 });
    pin(near, { x: 7.6, y: 8.8 }); // 1.8 away
    pin(far, { x: 20, y: 3 });
    castSkill(tg, 'inverted_moon', 'im_eclipse', called);
    const tele = tg.w.state.telegraphs;
    expect(tele.map(t => [t.area, t.total, t.center])).toEqual([[{ shape: 'ring', inner: 2.6, outer: 30 }, 2.2, { x: 6, y: 8 }]]);
    // the footprint: every spot of the floor but the disc
    for (let x = 0.5; x < 24; x += 1) {
      for (let y = 0.5; y < 12; y += 1) {
        const d = Math.hypot(x - 6, y - 8);
        if (d > 2.6 + R + 0.01) expect(covers(tele[0], { x, y }), `${x},${y}`).toBe(true);
        if (d < 2.6 - R - 0.01) expect(covers(tele[0], { x, y }), `${x},${y}`).toBe(false);
      }
    }
    advance(tg, 2.1);
    expect(skillHits(tg, far)).toBe(0);
    advance(tg, 0.2);
    expect(skillHits(tg, far)).toBe(1);
    expect(eventsOf(tg, 'damage')[0].amount).toBeCloseTo(softHit(tg, 'inverted_moon', far, 2.6), 6);
    expect(skillHits(tg, called)).toBe(0);
    expect(skillHits(tg, near)).toBe(0);
  });

  it('그림자 손: four corners around the target one after another, the middle stays safe', () => {
    const tg = soft('inverted_moon', [HUMAN, HUMAN2]);
    const me = active(tg, 0);
    const corner = active(tg, 1);
    pin(me, { x: 12, y: 6 });
    pin(corner, { x: 14.4, y: 8.4 });
    castSkill(tg, 'inverted_moon', 'im_hands', me);
    const tele = [...tg.w.state.telegraphs];
    expect(tele.map(t => t.total)).toEqual([1.1, 1.25, 1.4, 1.55]);
    expect(tele.map(t => t.center)).toEqual([{ x: 9.6, y: 3.6 }, { x: 14.4, y: 3.6 }, { x: 14.4, y: 8.4 }, { x: 9.6, y: 8.4 }]);
    expect(tele.every(t => t.area.shape === 'circle' && t.area.radius === 1.6)).toBe(true);
    expect(tele.some(t => covers(t, me.pos))).toBe(false);
    advance(tg, 1.7);
    expect(skillHits(tg, me)).toBe(0);
    expect(skillHits(tg, corner)).toBe(1);
  });

  it('달그림자: 3–4 그림자 아이 at the target and one 붉은 마스크 in front of the boss (규칙 M4)', () => {
    const tg = calm('inverted_moon');
    silence(tg);
    advance(tg, 0.2);
    clearEvents(tg);
    const me = active(tg);
    pin(me, { x: 5, y: 8 });
    castSkill(tg, 'inverted_moon', 'im_shadows', me);
    const adds = tg.w.state.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss');
    const kids = adds.filter(e => e.defId === 'goblin');
    const masks = adds.filter(e => e.defId === 'red_mask');
    expect(kids.length).toBeGreaterThanOrEqual(3);
    expect(kids.length).toBeLessThanOrEqual(4);
    for (const k of kids) expect(Math.hypot(k.pos.x - 5, k.pos.y - 8)).toBeLessThan(3);
    expect(masks).toHaveLength(1);
    const sp = eventsOf(tg, 'spawn').find(e => e.entityId === masks[0].id)!;
    expect(sp.pos.x).toBeCloseTo(12, 6);
    expect(sp.pos.y).toBeCloseTo(1.8, 6);
  });

  it('달빛 기둥: a 50° fan from the moon toward the target', () => {
    const tg = soft('inverted_moon');
    const me = active(tg);
    pin(me, { x: 12, y: 7 });
    castSkill(tg, 'inverted_moon', 'im_moonbeam', me);
    const fan = tg.w.state.telegraphs[0];
    expect([fan.area, fan.total, fan.origin]).toEqual([{ shape: 'fan', radius: 14, angle: 50 }, 1.5, BOSS_POS]);
    expect(covers(fan, { x: 12, y: 11 })).toBe(true);
    expect(covers(fan, { x: 20, y: 4 })).toBe(false);
  });
});

// 기획 19차 보스 튜닝: the designer will retune warning times and area sizes after playing (and may drop a boss), so the
// patterns must keep working when the two debug knobs move — nothing here may lean on the numbers as written.
describe('옥상·이계: under the 보스 튜닝 knobs (예고 시간 배율 · 범위 크기 배율)', () => {
  const SLOW_SMALL = { bossTelegraphMult: 2, bossAreaMult: 0.5 } as const;
  const FAST_BIG = { bossTelegraphMult: 0.5, bossAreaMult: 2 } as const;

  for (const id of IDS) {
    for (const knobs of [SLOW_SMALL, FAST_BIG]) {
      it(`${id}: the contract holds at 예고 ×${knobs.bossTelegraphMult} · 범위 ×${knobs.bossAreaMult}`, () => expectBossContract(id, knobs), 30000);
    }
  }

  it('범람: the rows land twice as late and twice as far apart, and thin out where they are (자리는 그대로)', () => {
    const tg = soft('tank_dweller', [HUMAN], SLOW_SMALL);
    const me = active(tg);
    pin(me, { x: 9, y: 1.4 });
    const parts = partsOf(skill('tank_dweller', 'td_flood'));
    castSkill(tg, 'tank_dweller', 'td_flood', me);
    const rows = [...tg.w.state.telegraphs];
    expect(rows).toHaveLength(parts.length);
    rows.forEach((t, i) => {
      const a = parts[i].area as Extract<AreaShape, { shape: 'rect' }>;
      expect(t.total).toBeCloseTo(parts[i].delay! * 2, 6);
      expect(t.area).toEqual({ ...a, length: a.length * 0.5, width: a.width * 0.5 });
      expect([t.center.x, t.center.y]).toEqual([0, expect.closeTo(parts[i].offset!.y + BOSS_POS.y, 6)]);
    });
    // the first row still hits who stands on its middle line — at twice its written time, not before
    advance(tg, parts[0].delay! * 2 - 0.1);
    expect(skillHits(tg, me)).toBe(0);
    advance(tg, 0.2);
    expect(skillHits(tg, me)).toBe(1);
  });

  it('낙뢰: the short warning scales with the cast (예고 ×2 → shown for the last 1.8 s of 3 s); the bolt itself has no size to scale', () => {
    const tg = soft('thunder_antenna', [HUMAN], SLOW_SMALL);
    const me = active(tg);
    const part = skill('thunder_antenna', 'ta_bolt').action;
    castSkill(tg, 'thunder_antenna', 'ta_bolt', me);
    let seenAfter = -1;
    let total = 0;
    for (let t = 1; t <= 30 * 4 && seenAfter < 0; t++) {
      tick(tg.w);
      const tele = tg.w.state.telegraphs[0];
      if (tele) {
        seenAfter = t / 30;
        total = tele.total;
        expect(tele.area).toEqual({ shape: 'single' });
      }
    }
    expect(seenAfter).toBeGreaterThan((part.delay! - part.telegraphLead!) * 2 - 0.1);
    expect(seenAfter).toBeLessThan((part.delay! - part.telegraphLead!) * 2 + 0.1);
    expect(total).toBeGreaterThan(part.telegraphLead! * 2 - 0.1);
    expect(total).toBeLessThanOrEqual(part.telegraphLead! * 2 + 1e-6);
    advance(tg, part.telegraphLead! * 2 + 0.1);
    expect(skillHits(tg, me)).toBe(1);
  });

  it('월식 · ㅁ 긋기: the safe middle is kept — a ring only grows outward, the strokes stay where they were drawn', () => {
    for (const knobs of [SLOW_SMALL, FAST_BIG]) {
      const k = knobs.bossAreaMult;
      const tg = soft('inverted_moon', [HUMAN, HUMAN2], knobs);
      const called = active(tg, 0);
      const near = active(tg, 1);
      pin(called, { x: 12, y: 6 });
      pin(near, { x: 13.5, y: 6 });
      const ring = skill('inverted_moon', 'im_eclipse').action.area as Extract<AreaShape, { shape: 'ring' }>;
      castSkill(tg, 'inverted_moon', 'im_eclipse', called);
      expect(tg.w.state.telegraphs[0].area).toEqual({ shape: 'ring', inner: ring.inner, outer: ring.outer * k });
      advance(tg, skill('inverted_moon', 'im_eclipse').action.delay! * knobs.bossTelegraphMult + 0.2);
      expect(skillHits(tg, called) + skillHits(tg, near), `월식 ×${k}`).toBe(0);

      const tp = soft('answering_pencil', [HUMAN], knobs);
      const me = active(tp);
      pin(me, { x: 12, y: 6 });
      const strokes = partsOf(skill('answering_pencil', 'ap_box'));
      castSkill(tp, 'answering_pencil', 'ap_box', me);
      expect(tp.w.state.telegraphs.map(t => t.center)).toEqual(strokes.map(a => ({ x: 12 + a.offset!.x, y: 6 + a.offset!.y })));
      expect(covers(tp.w.state.telegraphs[0], me.pos)).toBe(false);
      advance(tp, Math.max(...strokes.map(a => a.delay!)) * knobs.bossTelegraphMult + 0.2);
      expect(skillHits(tp, me), `ㅁ 긋기 ×${k}`).toBe(0);
    }
  });

  it('배수구 · 틀린 답: only the warning stretches — the puddle still lasts 4 s (at the scaled size) and the root 2.5 s', () => {
    const tg = calm('tank_dweller', [HUMAN], SLOW_SMALL);
    silence(tg);
    advance(tg, 0.2);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    const drain = skill('tank_dweller', 'td_drain').action;
    castSkill(tg, 'tank_dweller', 'td_drain', me);
    expect(tg.w.state.telegraphs[0].total).toBeCloseTo(drain.delay! * 2, 6);
    advance(tg, drain.delay! * 2 + 0.1);
    expect(tg.w.state.zones.map(z => z.radius)).toEqual([(drain.area as { radius: number }).radius * 0.5]);
    advance(tg, drain.zone!.duration - 0.3);
    expect(tg.w.state.zones).toHaveLength(1);
    advance(tg, 0.4);
    expect(tg.w.state.zones).toHaveLength(0);

    const tp = soft('answering_pencil', [HUMAN], SLOW_SMALL);
    const pinned = active(tp);
    const wrong = skill('answering_pencil', 'ap_pin').action;
    const rootFor = wrong.effects.flatMap(e => (e.kind === 'status' && e.status === 'root' ? [e.duration] : []))[0];
    castSkill(tp, 'answering_pencil', 'ap_pin', pinned);
    advance(tp, wrong.delay! * 2 - 0.1);
    expect(hasStatus(pinned, 'root')).toBe(false);
    advance(tp, 0.2);
    expect(hasStatus(pinned, 'root')).toBe(true);
    advance(tp, rootFor - 0.3);
    expect(hasStatus(pinned, 'root')).toBe(true);
    advance(tp, 0.4);
    expect(hasStatus(pinned, 'root')).toBe(false);
  });
});

describe('옥상·이계: bots-only fights', () => {
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

describe('옥상·이계: looks, warning motifs, voices', () => {
  const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: Record<string, Partial<BossDrawOpts>> = {
    idle: {},
    'wind-up': { charge: 0.8 },
    attack: { flash: 1, charge: 1 },
    groggy: { groggy: 1 },
    'standing up': { groggy: 0.4, groggyWake: 0.5 },
    enraged: { enraged: true, shake: 0.6 },
    'phase 2': { phase: 2, phaseFlash: 0.5 },
    'no target': { lookX: null, lookY: null },
    leaving: { retreat: 0.6 },
  };

  /** A counting 2D context (every method is a no-op that counts). */
  function counter(): { ctx: CanvasRenderingContext2D; n: () => number; fills: Set<string>; reset(): void } {
    let n = 0;
    const fills = new Set<string>();
    const store: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(store, {
      get: (target, prop) => (prop in target ? target[prop] : () => void n++),
      set: (target, prop, value) => {
        if (prop === 'fillStyle') fills.add(String(value));
        target[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, n: () => n, fills, reset: () => { n = 0; } };
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
          expect(c.n(), `${id} ${name}: canvas calls`).toBeLessThanOrEqual(360);
        }
      }
      c.reset();
      look!.draw(c.ctx, cam, 12, -1.2, 3, { ...BASE, retreat: 1 });
      expect(c.n(), `${id}: nothing once gone`).toBe(0);
      expect(c.fills.has(look!.color) || c.fills.size > 6, `${id} uses its palette`).toBe(true);
      expect(typeof look!.props, `${id} has groggy props`).toBe('function');
      const by = cam.sy(-1.2) + BOSS_DROP;
      for (const g of [0, 1]) {
        const y = look!.headY!(by, 160, g);
        expect(y).toBeGreaterThan(60);
        expect(y).toBeLessThan(330);
      }
    }
    expect(colours.size).toBe(4);
  });

  it('warning motifs: 배수구 pulls; the two summons are marked spawn; every row is a skill of the zone', () => {
    expect(BOSS_TELE_MOTIF.td_drain).toBe('pull');
    expect(BOSS_TELE_MOTIF.td_umbrellas).toBe('spawn');
    expect(BOSS_TELE_MOTIF.im_shadows).toBe('spawn');
    const ids = new Set(IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id)));
    for (const k of Object.keys(BOSS_TELE_MOTIF)) if (/^(td|ta|ap|im)_/.test(k)) expect(ids.has(k), k).toBe(true);
  });

  it('voices: the table rows (root, motif, timbre) and one sound kind per skill', () => {
    const want: Record<Id, [number, number[], string]> = {
      tank_dweller: [65.4, [0, 3, -2], 'water'],
      thunder_antenna: [49, [0, 12, 0], 'static'],
      answering_pencil: [58.3, [0, 1, 2, -1], 'paper'],
      inverted_moon: [61.7, [0, 2, -3, 0], 'wind'],
    };
    for (const id of IDS) {
      const v = BOSS_VOICE[id];
      expect([v.base, v.motif, v.timbre]).toEqual(want[id]);
      expect(Object.keys(v.kinds).sort()).toEqual(allSkills(getBoss(id)).map(sk => sk.id).sort());
    }
    expect(BOSS_VOICE.thunder_antenna.kinds).toMatchObject({ ta_bolt: 'static', ta_double_bolt: 'static' });
    expect(BOSS_VOICE.tank_dweller.kinds).toMatchObject({ td_flood: 'water', td_flood_up: 'water' });
  });
});
