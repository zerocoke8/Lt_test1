// 기획 20차 보스 형태 — 사무실 bosses (docs/bosses.md 4-2): 문서 파쇄기 · 식지 않는 커피 머신 · 퇴근 못 한 모니터 · 끝나지 않는 회의.
// What this file holds: the zone table and every number of the four (TABLE / DAMAGE below — the only copies of the
// data's numbers), the shared contract of a new boss (also under the 보스 튜닝 knobs), phase / enrage / groggy, and per
// boss its form and each pattern — the right kind of warning, who is hit, and that the answer in its tip really works
// (a scripted swap / drop position avoids it, standing still does not). Then seeded fights with one swapping seat and
// two bots, and the looks / sounds of the zone.
// The classic boss of the zone (overtime_lord) is covered by boss-roster / boss-mechanics / the goldens; the mechanics
// themselves (rot, once, bound, relocate, trail, guard …) by tests/sim/boss-toolkit.test.ts and boss-forms.test.ts.
//
// After a retune: TABLE and DAMAGE are the copies to update; the pattern tests read timings and sizes from the data
// (part / wait below) and place their characters from the boss's own spots, so they follow a number change unless the
// pattern itself changes. Then: npx vite-node tests/review/boss-table.ts write.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import { BOSSES, BOSS_RAID_BAND, BOSS_UNITS, ZONE_BOSSES, getBoss, getMonster } from '../../src/data';
import { BOSS_FORM, ENRAGE } from '../../src/data/bosses';
import { OFFICE_BOSSES } from '../../src/data/bosses/office';
import { BOSS_VOICE } from '../../src/audio/synth/bossVoices';
import type { BossDrawOpts } from '../../src/render/boss';
import { BOSS_TELE_MOTIF, BOSS_ZONE_LOOKS, MINION_LOOKS, bossLook } from '../../src/render/bosses';
import { bossBody, drawBossBody, newBodyAnim, stepBodyAnim } from '../../src/render/bosses/body';
import type { BossPose } from '../../src/render/bosses/types';
import { Camera } from '../../src/render/camera';
import { unitLook } from '../../src/render/look';
import { bossFormOf, isTauntable, spotFacing } from '../../src/sim/bossForm';
import { applyDamage } from '../../src/sim/combat';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { areaDir, hitsArea } from '../../src/sim/geometry';
import { forceGroggy, groggyMax } from '../../src/sim/groggy';
import { justCue } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { applyStatus, hasStatus, statusValue } from '../../src/sim/status';
import { monsterCdMult } from '../../src/sim/units';
import type { PendingHit, SimEntity } from '../../src/sim/world';
import type { AreaShape, BossForm, GameEvent, MonsterSkill, SkillAction, Telegraph, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, inBossBox, partsOf, raidGame } from './bossRaidHelpers';

const IDS = ['shredder_maw', 'coffee_machine', 'dead_monitor', 'endless_meeting'] as const;
type Id = (typeof IDS)[number];
const SH: Id = 'shredder_maw';
const CF: Id = 'coffee_machine';
const DM: Id = 'dead_monitor';
const EM: Id = 'endless_meeting';
const CALM = { invincible: true, bossGroggyThreshold: 0 } as const;
const TWO = [HUMAN, HUMAN2];
const THREE = [HUMAN, HUMAN2, { ...HUMAN, name: '셋' }];
/** A moment after a hit lands (longer than a tick, shorter than any gap between two parts). */
const AFTER = 0.1;
/** The party slot of the ranged character of HUMAN (메이지): its drag skill does not move it, so a drop stays where it is put. */
const MAGE = 2;

// ─────────────────────────── helpers ───────────────────────────

function skill(id: Id, skillId: string): MonsterSkill {
  const sk = allSkills(getBoss(id)).find(s => s.id === skillId);
  if (!sk) throw new Error(`no skill ${skillId}`);
  return sk;
}

/** Part `i` of a skill, as written in the data. */
function part(id: Id, skillId: string, i = 0): SkillAction {
  const a = partsOf(skill(id, skillId))[i];
  if (!a) throw new Error(`no part ${i} of ${skillId}`);
  return a;
}

/** Seconds of warning before part `i` lands. */
const wait = (id: Id, skillId: string, i = 0): number => part(id, skillId, i).delay ?? 0;

/**
 * A fight whose boss does nothing by itself: past its entrance pose, skills silenced, no basic attacks, standing still.
 * Hits land softly (the party is not invincible, so damage events are real) and the boss never dies.
 */
function host(id: Id, players = [HUMAN], knobs: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 50, players, tunables: { monsterDmgMult: 0.01, bossGroggyThreshold: 0, ...knobs } });
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
  advance(tg, BOSS_FORM.entrance + 0.1);
  hold(tg);
  tg.w.state.projectiles.length = 0;
  clearEvents(tg);
  return tg;
}

/** The boss stands still (as if casting) and never swings. */
function hold(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
}

/** Hold a character still at a spot. */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 9999;
}

/** Cast every part of one real skill as ONE cast of the boss (one ctx, like the boss does) at `target`. */
function castSkill(tg: TestGame, id: Id, skillId: string, target?: SimEntity): (PendingHit | null)[] {
  const b = bossOf(tg);
  if (target) b.targetId = target.id;
  const sk = skill(id, skillId);
  const ctx = unitCtx(tg.w, b, sk.id, sk.name);
  return [sk.action, ...(sk.extra ?? [])].map((a, i) => startAction(tg.w, ctx, a, undefined, i));
}

/**
 * Let the boss cast one of its skills BY ITSELF on the next tick (so its cast lock, its wind-up list and its recover
 * are the real ones); it has no other skill and still never swings. Returns the sim time of the cast.
 */
function selfCast(tg: TestGame, id: Id, skillId: string): number {
  const b = bossOf(tg);
  b.rt.skills = [skill(id, skillId)];
  b.rt.skillCds = [0];
  b.rt.skillGap = 0;
  b.rt.lockTime = 0;
  const t0 = tg.w.state.time;
  tick(tg.w);
  b.rt.skillCds = [9999];
  drain(tg);
  return t0;
}

/** Run until the sim clock reads `time` (a cast time + seconds). */
function runTo(tg: TestGame, time: number): void {
  for (let i = 0; i < 30 * 600 && tg.w.state.time < time - 1e-9 && tg.w.state.phase === 'combat'; i++) tick(tg.w);
  drain(tg);
}

/** Swap player 0's field character for party slot `index`, dropped (and then held) at `pos`. */
function swapTo(tg: TestGame, index: number, pos: Vec2): SimEntity {
  expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: index, pos }).ok).toBe(true);
  const e = active(tg);
  pin(e, pos);
  return e;
}

/** Hits a character took so far (in a host fight: skill hits and zone ticks only). */
const hitsOn = (tg: TestGame, e: SimEntity): number => eventsOf(tg, 'damage').filter(d => d.targetId === e.id).length;
/** Hits on any character so far. */
const partyHits = (tg: TestGame): number => eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally').length;
const teles = (tg: TestGame): Telegraph[] => tg.w.state.telegraphs.filter(t => t.team === 'enemy');
const near = (a: Vec2, b: Vec2, eps = 1e-6): boolean => Math.hypot(a.x - b.x, a.y - b.y) < eps;
const dirOf = (t: Telegraph): Vec2 => areaDir(t.area as { dir: 'right'; rot?: number });
/** One hit of 100 raw by `from` on the boss: what landed and its guard flag. */
function strike(tg: TestGame, from: SimEntity): { dealt: number; flag?: string } {
  clearEvents(tg);
  applyDamage(tg.w, { casterId: from.id, team: 'ally', player: 0, source: 'drag', isDrag: false }, bossOf(tg), 100, false);
  const ev = eventsOf(tg, 'damage').find(d => d.targetId === bossOf(tg).id)!;
  return { dealt: ev.amount, flag: ev.guard };
}

// ─────────────────────────── the zone table ───────────────────────────

/** The fields 기획 20차 added to a boss entry — the zone's classic boss must have none of them. */
const FORM_FIELDS = ['form', 'spawn', 'move', 'spots', 'stage', 'guard', 'trail', 'signature'] as const;

/** docs/bosses.md 1-2 · 4-2 (floor 1): form, body, HP / attack / attack speed / groggy, per skill [cooldown, first use], the phase, the signature. */
const TABLE: Record<Id, { name: string; form: BossForm; radius: number; stats: [number, number, number, number]; skills: Record<string, [number, number]>; phase: [string, number, number | undefined, number]; signature: string }> = {
  shredder_maw: { name: '문서 파쇄기', form: 'roaming', radius: 1.7, stats: [7600, 30, 0.55, 0.9], skills: { sh_bite: [8, 4], sh_lunge: [12, 8], sh_scraps: [10, 6], sh_whirl: [13, 1.5] }, phase: ['걸림 해제', 0.5, 1.15, 0.85], signature: 'sh_lunge' },
  coffee_machine: { name: '식지 않는 커피 머신', form: 'roaming', radius: 1.5, stats: [8800, 29, 0.5, 1], skills: { cf_steam: [9, 5], cf_capsules: [11, 9], cf_pour: [10, 7], cf_overflow: [16, 1.5] }, phase: ['넘침', 0.5, undefined, 0.85], signature: 'cf_steam' },
  dead_monitor: { name: '퇴근 못 한 모니터', form: 'relocating', radius: 1.6, stats: [8600, 30, 0.55, 1], skills: { dm_alt_tab: [12, 6], dm_cursor: [10, 7.5], dm_bluescreen: [9, 9], dm_close: [11, 1.5] }, phase: ['재부팅 실패', 0.5, 1.15, 0.85], signature: 'dm_alt_tab' },
  endless_meeting: { name: '끝나지 않는 회의', form: 'relocating', radius: 1.7, stats: [8400, 30, 0.55, 1], skills: { em_call: [10, 4], em_move: [14, 8], em_agenda: [11, 6.5], em_laser: [12, 1.5] }, phase: ['연장 회의', 0.5, undefined, 0.85], signature: 'em_call' },
};

/** Damage × attack of every part, in cast order (0 = no damage: the fake window's summon). */
const DAMAGE: Record<string, number[]> = {
  sh_bite: [2.8], sh_lunge: [2.6, 2], sh_scraps: [1.6], sh_whirl: [2.4, 2.4],
  cf_steam: [1.8, 1.8], cf_capsules: [2.2, 2.2, 2.2], cf_pour: [0.3], cf_overflow: [0.3],
  dm_alt_tab: [0, 2.2], dm_cursor: [2.8], dm_bluescreen: [2.4], dm_close: [2.2, 2.2, 2.2],
  em_call: [3.4, 1.8], em_move: [2, 2.2, 2.2, 2.2], em_agenda: [1.6, 2], em_laser: [2, 2, 2, 2, 2],
};

describe('사무실: the zone table', () => {
  it('has five bosses — the four new ones with data, then the classic boss, which is untouched (no 기획 20차 field)', () => {
    expect(ZONE_BOSSES.office).toEqual([...IDS, 'overtime_lord']);
    for (const id of ZONE_BOSSES.office) expect(BOSSES.some(b => b.id === id && b.zone === 'office'), id).toBe(true);
    expect(IDS.map(id => BOSS_RAID_BAND[id])).toEqual(['early', 'early', 'mid', 'late']);
    const classic = OFFICE_BOSSES[0];
    expect(classic.id).toBe('overtime_lord');
    for (const k of FORM_FIELDS) expect(classic[k], `overtime_lord.${k}`).toBeUndefined();
    expect(classic.radius).toBe(3);
    expect(classic.stationary).toBe(true);
    expect([classic.stats.maxHp, classic.stats.atk, classic.stats.atkSpeed, classic.groggy?.threshold]).toEqual([9000, 30, 0.55, 1]);
    expect(allSkills(classic).map(sk => sk.id)).toEqual(['ol_paperstorm', 'ol_summon', 'ol_stamp', 'ol_stamp_combo']);
    for (const sk of allSkills(classic)) {
      expect(sk.cycle ?? sk.castMove, `${sk.id}: no 기획 20차 skill field`).toBeUndefined();
      for (const a of [sk.action, ...(sk.extra ?? [])]) {
        expect(a.center, sk.id).not.toBe('arena');
        expect(a.rel ?? a.once ?? a.bound ?? a.relocate ?? a.trail, `${sk.id}: no 기획 20차 part field`).toBeUndefined();
      }
    }
  });

  it.each(IDS)('%s: the table row — name, form, body, stats, cooldowns, phase, signature; tips fit one HUD line', id => {
    const def = getBoss(id);
    const row = TABLE[id];
    expect(def.name).toBe(row.name);
    expect(bossFormOf(def)).toBe(row.form);
    expect(def.radius).toBe(row.radius);
    expect([def.stats.maxHp, def.stats.atk, def.stats.atkSpeed, def.groggy?.threshold]).toEqual(row.stats);
    expect(Object.fromEntries(allSkills(def).map(sk => [sk.id, [sk.cooldown, sk.initialDelay]]))).toEqual(row.skills);
    const ph = def.phases![0];
    expect([ph.name, ph.hpBelow, ph.atkSpeedMult, ph.cooldownMult]).toEqual(row.phase);
    expect(def.signature).toBe(row.signature);
    expect(def.enrage).toEqual(ENRAGE);
    for (const sk of allSkills(def)) if (sk.hint) expect(sk.hint.length, sk.id).toBeLessThanOrEqual(46);
    // the signature pattern always comes with its tip
    expect(skill(id, row.signature).hint, `${row.signature} has a tip`).toBeTruthy();
  });

  it('every part hits for the table amount; the riders: burn 40 % / s, slows 30–40 %; every hit is warned ≥ 0.8 s', () => {
    const ids = IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id));
    expect(Object.keys(DAMAGE).sort()).toEqual([...ids].sort());
    for (const id of IDS) {
      for (const sk of allSkills(getBoss(id))) {
        const dmg = partsOf(sk).map(a => a.effects.reduce((n, e) => n + (e.kind === 'damage' ? e.amount : 0), 0));
        expect(dmg, sk.id).toEqual(DAMAGE[sk.id]);
        for (const a of partsOf(sk)) if (a.effects.length > 0) expect(a.delay ?? 0, sk.id).toBeGreaterThanOrEqual(0.8);
      }
    }
    const riders = (id: Id, skillId: string) => skill(id, skillId).action.effects.filter(e => e.kind !== 'damage');
    expect(riders(SH, 'sh_bite')).toEqual([{ kind: 'status', status: 'burn', duration: 3, value: 0.4 }]);
    expect(riders(SH, 'sh_lunge')).toEqual([{ kind: 'knockback', distance: 1.5 }]);
    expect(riders(SH, 'sh_scraps')).toEqual([{ kind: 'status', status: 'slow', duration: 2, value: 0.4 }]);
    expect(riders(CF, 'cf_steam')).toEqual([{ kind: 'status', status: 'slow', duration: 1.5, value: 0.4 }]);
    expect(riders(CF, 'cf_pour')).toEqual([{ kind: 'status', status: 'slow', duration: 1, value: 0.3 }]);
    expect(riders(DM, 'dm_bluescreen')).toEqual([{ kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }]);
    expect(skill(CF, 'cf_pour').action.zone).toEqual({ duration: 7, tickInterval: 0.5 });
    expect(skill(CF, 'cf_overflow').action.zone).toEqual({ duration: 8, tickInterval: 0.5 });
  });

  it('가짜 창: a summon-only copy of the screen (HP 240, attack 12, range 9) that never moves and files an 「오류 보고」', () => {
    const u = getMonster('fake_monitor');
    expect(BOSS_UNITS).toContain(u);
    expect(u.name).toBe('가짜 창');
    expect([u.stats.maxHp, u.stats.atk, u.stats.atkSpeed, u.stats.range, u.radius, u.stats.moveSpeed]).toEqual([240, 12, 0.7, 9, 1.3, 0]);
    expect(u.stationary).toBe(true);
    expect(u.tier).toBe('normal');
    expect(u.skills!.map(sk => [sk.id, sk.cooldown, sk.initialDelay, sk.action.delay, sk.action.area])).toEqual([['fm_crash', 7, 3.5, 1.6, { shape: 'circle', radius: 3.2 }]]);
    // 오류 창 (기획 19차) is gone
    expect(() => getMonster('error_popup')).toThrow();
  });
});

describe('사무실: the contract of a new boss', () => {
  it.each(IDS)('%s: shape by form, every skill within 45 s with no idle stretch, phase → phase skill, kill → clear, same seed same fight', id => {
    expectBossContract(id);
  });
});

// 보스 튜닝 (docs/boss-raid.md 4-2, docs/bosses.md 3장): no pattern may depend on the numbers as written.
describe('사무실: the contract holds under the boss tuning knobs', () => {
  it.each(IDS)('%s: 예고 ×2, 범위 ×0.5, 이동 ×1.5', id => {
    expectBossContract(id, { bossTelegraphMult: 2, bossAreaMult: 0.5, bossMoveMult: 1.5 });
  });
  it.each(IDS)('%s: 예고 ×0.5, 범위 ×2, 이동 ×0.5', id => {
    expectBossContract(id, { bossTelegraphMult: 0.5, bossAreaMult: 2, bossMoveMult: 0.5 });
  });
});

describe('사무실: phase, enrage, groggy', () => {
  it.each(IDS)('%s: the phase starts under its HP line, enrage multiplies attack / speed / cooldowns, a forced break knocks it down', id => {
    const def = getBoss(id);
    const ph = def.phases![0];
    const tg = raidGame(id, { hpMult: 50, tunables: { invincible: true } });
    advance(tg, 1);
    const b = bossOf(tg);
    expect(b.maxHp).toBeCloseTo(def.stats.maxHp * 50, 3);
    const calm = effStats(tg.w, b);
    expect(calm.atk).toBeCloseTo(def.stats.atk, 6);
    expect(calm.atkSpeed).toBeCloseTo(def.stats.atkSpeed, 6);
    // phase: nothing just above the line, the event just under it
    clearEvents(tg);
    b.hp = (ph.hpBelow + 0.01) * b.maxHp; // 1 % above the line: more than the party deals in a moment
    advance(tg, 0.2);
    expect(eventsOf(tg, 'bossPhase')).toHaveLength(0);
    expect(monsterCdMult(b)).toBe(1);
    crossPhase(tg);
    expect(eventsOf(tg, 'bossPhase').map(e => [e.phase, e.name])).toEqual([[2, ph.name]]);
    expect(monsterCdMult(b)).toBeCloseTo(ph.cooldownMult ?? 1, 6);
    expect(effStats(tg.w, b).atkSpeed).toBeCloseTo(def.stats.atkSpeed * (ph.atkSpeedMult ?? 1), 6);
    // enrage on top (a moving boss also walks × 1.25)
    const walk = effStats(tg.w, b).moveSpeed;
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
    const hot = effStats(tg.w, b);
    expect(hot.atk).toBeCloseTo(def.stats.atk * ENRAGE.atkMult, 6);
    expect(hot.atkSpeed).toBeCloseTo(def.stats.atkSpeed * (ph.atkSpeedMult ?? 1) * ENRAGE.atkSpeedMult, 6);
    expect(hot.moveSpeed).toBeCloseTo(walk * BOSS_FORM.enrageMove, 6);
    expect(monsterCdMult(b)).toBeCloseTo((ph.cooldownMult ?? 1) * ENRAGE.cooldownMult, 6);
    // groggy: one human seat → base 100 × the boss's threshold; a forced break knocks it down where it stands
    expect(groggyMax(tg.w)).toBeCloseTo(DEFAULT_TUNABLES.bossGroggyThreshold * def.groggy!.threshold, 6);
    const at = { ...b.pos };
    const facing = b.facing;
    expect(forceGroggy(tg.w)).toBe(true);
    advance(tg, 1.5);
    expect(eventsOf(tg, 'bossGroggy').some(e => e.entityId === b.id)).toBe(true);
    expect(b.pos).toEqual(at);
    expect(b.facing).toBe(facing);
  });
});

// ─────────────────────────── 문서 파쇄기 ───────────────────────────

describe('문서 파쇄기 (배회형 — 앞은 방패, 등 뒤가 약점)', () => {
  /** The shredder at (12, 6) looking right (+x), held still. */
  function lookingRight(players = [HUMAN], knobs: Partial<Tunables> = {}): TestGame {
    const tg = host(SH, players, knobs);
    const b = bossOf(tg);
    b.pos = { x: 12, y: 6 };
    b.facing = 0;
    return tg;
  }
  const FRONT = { x: 15, y: 6 };
  const BACK = { x: 9, y: 6 };
  const FLANK = { x: 12, y: 9.5 };

  it('form and body: a roaming body of radius 1.7 that comes out of the bottom-left corner (4.5, 8.5), melee, slow (1.4) and slow to turn (60°/s), heavy; front 140° × 0.5 · back 120° × 1.6', () => {
    const def = getBoss(SH);
    expect(def.form).toBe('roaming');
    expect(def.stationary).toBeUndefined();
    expect(def.spawn).toEqual({ x: 4.5, y: 8.5 });
    expect(def.move).toEqual({ mode: 'pursue', turnRate: 60 });
    expect(def.guard).toEqual({ frontArc: 140, frontMult: 0.5, backArc: 120, backMult: 1.6 });
    expect([def.basic.kind, def.stats.range, def.stats.moveSpeed]).toEqual(['melee', 1, 1.4]);
    const tg = raidGame(SH, { hpMult: 50, tunables: CALM });
    const b = bossOf(tg);
    expect(b.pos).toEqual({ x: 4.5, y: 8.5 });
    expect(Math.cos(b.facing), 'it comes out looking into the room').toBeGreaterThan(0.9);
    expect(b.radius).toBe(1.7);
    expect(b.rt.heavy).toBe(true);
    expect(isTauntable(b)).toBe(true);
    advance(tg, BOSS_FORM.entrance - 0.1); // the entrance pose: it stands
    expect(b.pos).toEqual({ x: 4.5, y: 8.5 });
  });

  it('it turns in place at 60°/s and only walks once it nearly faces its way — a character behind it keeps its back for 2 s', () => {
    const tg = lookingRight();
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 4, y: 6 }); // straight behind it
    b.targetId = me.id;
    b.rt.lockTime = 0; // free to walk (still no swings, no skills)
    advance(tg, 1);
    expect(Math.abs(b.facing)).toBeCloseTo(Math.PI / 3, 1); // 60° round, either way
    expect(b.pos).toEqual({ x: 12, y: 6 }); // not a step yet
    expect(strike(tg, me).flag).toBe('back');
    advance(tg, 2.5);
    expect(Math.abs(Math.abs(b.facing) - Math.PI)).toBeLessThan(0.05); // it looks at the character now
    expect(b.pos.x).toBeLessThan(12);
    expect(12 - b.pos.x).toBeLessThanOrEqual(getBoss(SH).stats.moveSpeed * 2.5 + 0.01);
    expect(strike(tg, me).flag).toBe('front');
    expect(inBossBox(b.pos)).toBe(true);
  });

  it('the answer is where you stand: a hit from its front lands × 0.5, from behind × 1.6, from its flank × 1', () => {
    const tg = lookingRight();
    const me = active(tg);
    const g = getBoss(SH).guard!;
    pin(me, FLANK);
    const side = strike(tg, me);
    expect(side.flag).toBeUndefined();
    pin(me, FRONT);
    expect(strike(tg, me)).toEqual({ dealt: side.dealt * g.frontMult, flag: 'front' });
    pin(me, BACK);
    const back = strike(tg, me);
    expect(back.flag).toBe('back');
    expect(back.dealt).toBeCloseTo(side.dealt * g.backMult, 6);
  });

  it('a taunt turns its mouth: it goes for the tank, so the dealer on the other side stands at its back', () => {
    const tg = lookingRight(TWO);
    const b = bossOf(tg);
    const [tank, dealer] = [active(tg, 0), active(tg, 1)];
    b.facing = Math.PI; // looking at the dealer
    pin(dealer, { x: 8.5, y: 6 });
    pin(tank, { x: 17, y: 6 });
    b.targetId = dealer.id;
    b.rt.lockTime = 0;
    expect(strike(tg, dealer).flag).toBe('front');
    expect(applyStatus(b, 'taunt', 4, 0, 0, 'drag', { sourceEntityId: tank.id })).toBe(true);
    advance(tg, 3.3); // 180° at 60°/s
    expect(b.targetId).toBe(tank.id);
    expect(Math.abs(b.facing)).toBeLessThan(0.1);
    expect(strike(tg, dealer).flag).toBe('back');
  });

  it('세단: a cone out of its mouth, warned 1.2 s — in front you are bitten and burn; behind it and on its flank nothing', () => {
    const tg = lookingRight(THREE);
    const [front, back, flank] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(front, FRONT);
    pin(back, BACK);
    pin(flank, FLANK);
    castSkill(tg, SH, 'sh_bite', front);
    expect(teles(tg)).toHaveLength(1);
    const t = teles(tg)[0];
    expect([t.area.shape, t.total]).toEqual(['cone', wait(SH, 'sh_bite')]);
    expect(t.center).toEqual({ x: 12, y: 6 });
    expect(dirOf(t).x).toBeCloseTo(1, 9);
    expect(t.area).toMatchObject({ radius: 5.5, angle: 110 });
    advance(tg, wait(SH, 'sh_bite') + AFTER);
    expect([hitsOn(tg, front), hitsOn(tg, back), hitsOn(tg, flank)]).toEqual([1, 0, 0]);
    expect(hasStatus(front, 'burn')).toBe(true); // the paper cut: 40 % of its attack a second for 3 s
    expect([hasStatus(back, 'burn'), hasStatus(flank, 'burn')]).toEqual([false, false]);
  });

  it('세단 bites where it LOOKS: turned round, the same cast reaches the character that stood behind it', () => {
    const tg = lookingRight(TWO);
    const [a, c] = [active(tg, 0), active(tg, 1)];
    bossOf(tg).facing = Math.PI;
    pin(a, FRONT);
    pin(c, BACK);
    castSkill(tg, SH, 'sh_bite', a);
    expect(dirOf(teles(tg)[0]).x).toBeCloseTo(-1, 9);
    advance(tg, wait(SH, 'sh_bite') + AFTER);
    expect([hitsOn(tg, a), hitsOn(tg, c)]).toEqual([0, 1]);
  });

  it('세단: the tip — swap the bitten character out and drop the next one BEHIND it: nobody is hit (standing still is)', () => {
    const tg = lookingRight();
    const me = active(tg);
    pin(me, FRONT);
    castSkill(tg, SH, 'sh_bite', me);
    advance(tg, wait(SH, 'sh_bite') / 2);
    const next = swapTo(tg, MAGE, BACK);
    advance(tg, wait(SH, 'sh_bite') / 2 + AFTER);
    expect(partyHits(tg)).toBe(0);
    // …and from there it hits the weak back
    expect(strike(tg, next).flag).toBe('back');
    expect(skill(SH, 'sh_bite').hint).toContain('등 뒤가 약점');
  });

  /** The shredder at (5, 6) looking right casts 급지 by itself at a character 6 cells ahead; returns the cast time. */
  function lunge(knobs: Partial<Tunables> = {}): { tg: TestGame; t0: number; me: SimEntity } {
    const tg = host(SH, [HUMAN], knobs);
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 5, y: 6 };
    b.facing = 0;
    pin(me, { x: 11, y: 6 });
    const t0 = selfCast(tg, SH, 'sh_lunge');
    return { tg, t0, me };
  }
  const JAM = part(SH, 'sh_lunge').charge!.recover!;
  const BURST = wait(SH, 'sh_lunge', 1);

  it('급지: the path is warned as a rush for 1.2 s, then it runs 9 cells — whoever is on the path is hit and shoved', () => {
    const { tg, t0, me } = lunge();
    const b = bossOf(tg);
    expect(teles(tg)).toHaveLength(1); // the burst that follows is not shown yet
    const t = teles(tg)[0];
    expect(t.motif).toBe('charge');
    expect(t.total).toBeCloseTo(wait(SH, 'sh_lunge'), 6);
    expect(t.origin).toEqual({ x: 5, y: 6 });
    expect(t.center).toEqual({ x: 14, y: 6 });
    expect((t.area as { width: number }).width).toBe(3.4);
    expect(b.pos).toEqual({ x: 5, y: 6 }); // it stands while the path is shown
    runTo(tg, t0 + wait(SH, 'sh_lunge') + AFTER);
    expect(b.pos.x).toBeCloseTo(14, 6);
    expect(hitsOn(tg, me)).toBe(1);
    expect(me.pos.x).not.toBe(11); // knocked off its spot
    expect(eventsOf(tg, 'dash').filter(e => e.entityId === b.id)).toHaveLength(1);
  });

  it('급지: then the paper jams — 3.2 s it neither walks nor turns and its back is open; when the jam clears the circle round it bursts (shown for its last 1.0 s)', () => {
    expect(wait(SH, 'sh_lunge') + JAM).toBeCloseTo(BURST, 6); // the burst lands the moment the jam ends
    const { tg, t0, me } = lunge();
    const b = bossOf(tg);
    runTo(tg, t0 + wait(SH, 'sh_lunge') + AFTER);
    const facing = b.facing;
    pin(me, { x: 11.3, y: 6 }); // behind it, close enough to reach it
    runTo(tg, t0 + BURST - 1.3);
    expect(b.pos.x).toBeCloseTo(14, 6);
    expect(b.facing).toBe(facing); // it cannot turn to the character at its back
    expect(strike(tg, me).flag).toBe('back');
    expect(teles(tg)).toHaveLength(0);
    runTo(tg, t0 + BURST - 0.6);
    expect(teles(tg)).toHaveLength(1);
    const t = teles(tg)[0];
    expect(t.area).toEqual({ shape: 'circle', radius: 3 });
    expect(near(t.center, b.pos)).toBe(true); // round where it stands NOW
    expect(t.total).toBeLessThanOrEqual(1 + 1 / 30 + 1e-6);
    clearEvents(tg);
    runTo(tg, t0 + BURST + AFTER);
    expect(hitsOn(tg, me)).toBe(1); // stayed at its back too long
  });

  it('급지: the tip — hit its back while it is stuck and leave before the jam clears: swapped out in time, nobody is hit; then it turns again', () => {
    const { tg, t0, me } = lunge();
    const b = bossOf(tg);
    runTo(tg, t0 + wait(SH, 'sh_lunge') + AFTER);
    const facing = b.facing;
    pin(me, { x: 11.3, y: 6 });
    clearEvents(tg);
    runTo(tg, t0 + BURST - 0.7);
    swapTo(tg, MAGE, { x: 4, y: 10 }); // far outside the burst
    runTo(tg, t0 + BURST + AFTER);
    expect(partyHits(tg)).toBe(0);
    runTo(tg, t0 + BURST + 3);
    expect(b.facing).not.toBe(facing); // free again: it turns to its target
    expect(skill(SH, 'sh_lunge').hint).toContain('등 뒤로');
  });

  it('급지 under 보스 예고 시간 배율 ×2: the path is shown twice as long, the rush is as far', () => {
    const { tg, t0 } = lunge({ bossTelegraphMult: 2 });
    expect(teles(tg)[0].total).toBeCloseTo(wait(SH, 'sh_lunge') * 2, 6);
    runTo(tg, t0 + wait(SH, 'sh_lunge') + AFTER);
    expect(bossOf(tg).pos.x).toBe(5); // not yet
    runTo(tg, t0 + wait(SH, 'sh_lunge') * 2 + AFTER);
    expect(bossOf(tg).pos.x).toBeCloseTo(14, 6);
  });

  it('파지 배출: out of its BACK — the character parked behind it is hit and slowed, the one in front is not', () => {
    const tg = lookingRight(TWO);
    const [front, back] = [active(tg, 0), active(tg, 1)];
    pin(front, FRONT);
    pin(back, BACK);
    castSkill(tg, SH, 'sh_scraps', front);
    const t = teles(tg)[0];
    expect([t.area.shape, t.total]).toEqual(['cone', wait(SH, 'sh_scraps')]);
    expect(dirOf(t).x).toBeCloseTo(-1, 9);
    expect(t.area).toMatchObject({ radius: 5, angle: 90 });
    advance(tg, wait(SH, 'sh_scraps') + AFTER);
    expect([hitsOn(tg, front), hitsOn(tg, back)]).toEqual([0, 1]);
    expect(statusValue(back, 'slow')).toBe(0.4);
  });

  it('파지 배출: the tip — the character behind it steps out for a moment (swapped to its flank): nobody is hit', () => {
    const tg = lookingRight();
    const me = active(tg);
    pin(me, BACK);
    castSkill(tg, SH, 'sh_scraps', me);
    advance(tg, wait(SH, 'sh_scraps') / 2);
    swapTo(tg, MAGE, FLANK);
    advance(tg, wait(SH, 'sh_scraps') / 2 + AFTER);
    expect(partyHits(tg)).toBe(0);
  });

  it('역회전 (페이즈): its front, then its back 0.7 s later — only its flank is never hit', () => {
    const tg = lookingRight(THREE);
    const [front, back, flank] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(front, FRONT);
    pin(back, BACK);
    pin(flank, FLANK);
    castSkill(tg, SH, 'sh_whirl', front);
    expect(teles(tg).map(t => [t.area.shape, t.total, Math.round(dirOf(t).x)])).toEqual([['cone', 1.1, 1], ['cone', 1.8, -1]]);
    advance(tg, wait(SH, 'sh_whirl', 0) + AFTER);
    expect([hitsOn(tg, front), hitsOn(tg, back), hitsOn(tg, flank)]).toEqual([1, 0, 0]);
    advance(tg, wait(SH, 'sh_whirl', 1) - wait(SH, 'sh_whirl', 0));
    expect([hitsOn(tg, front), hitsOn(tg, back), hitsOn(tg, flank)]).toEqual([1, 1, 0]);
  });
});

// ─────────────────────────── 식지 않는 커피 머신 ───────────────────────────

describe('식지 않는 커피 머신 (배회형 — 지나간 길이 남음)', () => {
  const def = getBoss(CF);
  const WPS = def.move!.waypoints!;
  /** Is p on the machine's square route? */
  const onRoute = (p: Vec2, eps = 0.05): boolean => {
    const xs = WPS.map(w => w.x);
    const ys = WPS.map(w => w.y);
    const inX = p.x >= Math.min(...xs) - eps && p.x <= Math.max(...xs) + eps;
    const inY = p.y >= Math.min(...ys) - eps && p.y <= Math.max(...ys) + eps;
    return (inY && xs.some(x => Math.abs(p.x - x) < eps)) || (inX && ys.some(y => Math.abs(p.y - y) < eps));
  };
  /** The machine at (10, 6) walking right (+x), held still. */
  function walkingRight(players = [HUMAN]): TestGame {
    const tg = host(CF, players);
    const b = bossOf(tg);
    b.pos = { x: 10, y: 6 };
    b.facing = 0;
    return tg;
  }

  it('form and body: a roaming body of radius 1.5 that rounds a square (0.6 s on each corner), ranged (7), footprints r 1.1 smaller than its body', () => {
    expect(def.form).toBe('roaming');
    expect(def.spawn).toEqual({ x: 4, y: 3 });
    expect(def.move).toEqual({ mode: 'patrol', waypoints: [{ x: 4, y: 3 }, { x: 20, y: 3 }, { x: 20, y: 9.5 }, { x: 4, y: 9.5 }], dwell: 0.6 });
    expect([def.basic.kind, def.stats.range, def.stats.moveSpeed]).toEqual(['projectile', 7, 1.6]);
    expect(def.trail).toMatchObject({ every: 1.2, max: 14, radius: 1.1, duration: 8, tickInterval: 0.5, look: 'coffee' });
    expect(def.trail!.effects).toEqual([{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.3 }]);
    expect(def.trail!.radius).toBeLessThan(def.radius);
    expect(def.guard ?? def.spots).toBeUndefined();
  });

  it('it never chases: with a character parked in the middle it keeps to its route, corner after corner, shooting as it walks and trailing coffee', () => {
    const tg = raidGame(CF, { hpMult: 50, tunables: CALM });
    const b = bossOf(tg);
    const me = active(tg);
    b.rt.skillCds = b.rt.skillCds.map(() => 9999);
    expect(b.pos).toEqual(WPS[0]);
    const corners: number[] = [];
    let next = 1;
    let shotsOnTheMove = 0;
    let last = { ...b.pos };
    let most = 0;
    for (let t = 0; t < 45 * 30; t++) {
      pin(me, { x: 12, y: 6.5 });
      tick(tg.w);
      expect(onRoute(b.pos), `(${b.pos.x}, ${b.pos.y}) is on the route`).toBe(true);
      const moved = Math.hypot(b.pos.x - last.x, b.pos.y - last.y) > 1e-6;
      last = { ...b.pos };
      for (const e of tg.game.drainEvents()) if (e.type === 'attack' && e.sourceId === b.id && moved) shotsOnTheMove++;
      if (near(b.pos, WPS[next], 0.02)) {
        corners.push(next);
        next = (next + 1) % WPS.length;
      }
      const puddles = tg.w.state.zones.filter(z => z.look === 'coffee');
      most = Math.max(most, puddles.length);
      for (const z of puddles) expect(onRoute(z.center), 'a footprint lies on the route').toBe(true);
    }
    expect(corners.slice(0, 4)).toEqual([1, 2, 3, 0]);
    expect(shotsOnTheMove).toBeGreaterThan(5);
    // about 13 cells of trail follow it: 8 s of walking at 1.6 cells / s, a footprint every 1.2 cells — never more than 14
    expect(most).toBeGreaterThanOrEqual(9);
    expect(most).toBeLessThanOrEqual(def.trail!.max);
  });

  it('스팀: two cones out of its SIDES (1.1 s) — beside it you are scalded and slowed, ahead of it nothing', () => {
    const tg = walkingRight(THREE);
    const [right, left, ahead] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(right, { x: 10, y: 9.5 }); // its right hand (it walks toward +x)
    pin(left, { x: 10, y: 2.5 });
    pin(ahead, { x: 14.5, y: 6 });
    castSkill(tg, CF, 'cf_steam', ahead);
    expect(teles(tg).map(t => [t.area.shape, t.total, Math.round(dirOf(t).y)])).toEqual([['cone', 1.1, 1], ['cone', 1.1, -1]]);
    for (const t of teles(tg)) {
      expect(t.center).toEqual({ x: 10, y: 6 });
      expect(t.area).toMatchObject({ radius: 6, angle: 70 });
    }
    advance(tg, wait(CF, 'cf_steam') + AFTER);
    expect([hitsOn(tg, right), hitsOn(tg, left), hitsOn(tg, ahead)]).toEqual([1, 1, 0]);
    expect([statusValue(right, 'slow'), statusValue(left, 'slow')]).toEqual([0.4, 0.4]);
  });

  it('스팀: the tip — swap the character at its side out and drop the next one BEHIND the machine: nobody is hit', () => {
    const tg = walkingRight();
    const me = active(tg);
    pin(me, { x: 10, y: 9.5 });
    castSkill(tg, CF, 'cf_steam', me);
    advance(tg, wait(CF, 'cf_steam') / 2);
    swapTo(tg, MAGE, { x: 6, y: 6 });
    advance(tg, wait(CF, 'cf_steam') / 2 + AFTER);
    expect(partyHits(tg)).toBe(0);
    expect(skill(CF, 'cf_steam').hint).toContain('앞이나 뒤');
  });

  it('캡슐 투하: three capsules on the road AHEAD of it — 3, 6 and 9 cells, 0.3 s apart; it turns with the machine', () => {
    const tg = host(CF, TWO);
    const b = bossOf(tg);
    const [onSecond, beside] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 6, y: 6 };
    b.facing = 0;
    pin(onSecond, { x: 12, y: 6 });
    pin(beside, { x: 12, y: 9.2 });
    castSkill(tg, CF, 'cf_capsules', onSecond);
    expect(teles(tg).map(t => [t.center, t.total, t.area])).toEqual([9, 12, 15].map((x, i) => [{ x, y: 6 }, [1.2, 1.5, 1.8][i], { shape: 'circle', radius: 2 }]));
    advance(tg, wait(CF, 'cf_capsules', 0) + AFTER);
    expect(hitsOn(tg, onSecond)).toBe(0); // the first one fell 3 cells before it
    advance(tg, wait(CF, 'cf_capsules', 1) - wait(CF, 'cf_capsules', 0));
    expect([hitsOn(tg, onSecond), hitsOn(tg, beside)]).toEqual([1, 0]);
    advance(tg, 0.5);
    expect(hitsOn(tg, onSecond)).toBe(1);
    // walking down the screen, they fall below it
    clearEvents(tg);
    b.facing = Math.PI / 2;
    castSkill(tg, CF, 'cf_capsules', onSecond);
    expect(near(teles(tg)[0].center, { x: 6, y: 9 })).toBe(true);
  });

  it('뜨거운 한 잔: a warned splash that stays 7 s as a puddle — it ticks every 0.5 s and slows; a free character walks out of it by itself', () => {
    const tg = host(CF);
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 4, y: 3 };
    pin(me, { x: 14, y: 8 });
    castSkill(tg, CF, 'cf_pour', me);
    expect(teles(tg).map(t => [t.area, t.total, t.center])).toEqual([[{ shape: 'circle', radius: 2.6 }, 1, { x: 14, y: 8 }]]);
    advance(tg, wait(CF, 'cf_pour') + AFTER);
    const puddle = tg.w.state.zones.filter(z => z.team === 'enemy');
    expect(puddle).toHaveLength(1);
    expect([puddle[0].kind, puddle[0].radius, puddle[0].total, puddle[0].center]).toEqual(['damage', 2.6, 7, { x: 14, y: 8 }]);
    clearEvents(tg);
    advance(tg, 2.05);
    expect(hitsOn(tg, me)).toBeGreaterThanOrEqual(3); // held in it: tick after tick
    expect(statusValue(me, 'slow')).toBe(0.3);
    // let go, the character leaves the puddle on its own feet (rule N8) — the player only has to give it room
    me.rt.lockTime = 0;
    advance(tg, 2.5);
    expect(hitsArea(puddle[0].area ?? { shape: 'circle', radius: puddle[0].radius }, puddle[0].center, puddle[0].center, me.pos, me.radius)).toBe(false);
    advance(tg, 3);
    expect(tg.w.state.zones.filter(z => z.team === 'enemy')).toHaveLength(0);
  });

  it('넘치는 커피 (페이즈): a ring puddle round where the machine stands for 8 s — touching the machine and beyond the ring the floor is dry', () => {
    const ring = part(CF, 'cf_overflow').area as Extract<AreaShape, { shape: 'ring' }>;
    const tg = host(CF, THREE);
    const b = bossOf(tg);
    const [hug, inRing, far] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    b.pos = { x: 12, y: 6 };
    // the hole really holds a character that stands against the body (the tip 「바로 옆」)
    const touching = b.radius + hug.radius + 0.25;
    expect(touching + hug.radius).toBeLessThan(ring.inner);
    pin(hug, { x: 12, y: 6 + touching });
    pin(inRing, { x: 12 + (ring.inner + ring.outer) / 2, y: 6 });
    pin(far, { x: 12 - ring.outer - 1.5, y: 6 });
    castSkill(tg, CF, 'cf_overflow', hug);
    expect(teles(tg).map(t => [t.area, t.total, t.center])).toEqual([[ring, 1.5, { x: 12, y: 6 }]]);
    advance(tg, wait(CF, 'cf_overflow') + AFTER);
    const z = tg.w.state.zones.filter(x => x.team === 'enemy');
    expect(z).toHaveLength(1);
    expect([z[0].total, z[0].area]).toEqual([8, ring]);
    clearEvents(tg);
    advance(tg, 1.6);
    expect(hitsOn(tg, inRing)).toBeGreaterThanOrEqual(2);
    expect([hitsOn(tg, hug), hitsOn(tg, far)]).toEqual([0, 0]);
    // the puddle stays where it was poured when the machine walks on
    b.pos = { x: 18, y: 6 };
    advance(tg, 0.5);
    expect(z[0].center).toEqual({ x: 12, y: 6 });
  });
});

// ─────────────────────────── 퇴근 못 한 모니터 ───────────────────────────

describe('퇴근 못 한 모니터 (자리 이동형 — 가짜 창)', () => {
  const DESKS = getBoss(DM).spots!;
  const fakes = (tg: TestGame): SimEntity[] => tg.w.state.entities.filter(e => e.defId === 'fake_monitor' && !e.rt.gone && e.hp > 0);

  it('form and body: three desks (A looks right · B left · C up); it sits on A, never walks and cannot be taunted', () => {
    const def = getBoss(DM);
    expect(def.form).toBe('relocating');
    expect(def.stationary).toBe(true);
    expect(DESKS).toEqual([{ x: 5, y: 3.5, facing: 'right' }, { x: 19, y: 3.5, facing: 'left' }, { x: 12, y: 9.5, facing: 'up' }]);
    expect([def.stats.range, def.stats.moveSpeed, def.basic.kind]).toEqual([40, 0, 'projectile']);
    const tg = raidGame(DM, { hpMult: 50, tunables: CALM });
    const b = bossOf(tg);
    b.rt.skillCds = b.rt.skillCds.map(() => 9999);
    expect(near(b.pos, DESKS[0])).toBe(true);
    expect(b.facing).toBeCloseTo(0, 9);
    expect(isTauntable(b)).toBe(false);
    expect(applyStatus(b, 'taunt', 3, 0, 0, 'drag', { sourceEntityId: active(tg).id })).toBe(false);
    advance(tg, 6);
    expect(near(b.pos, DESKS[0])).toBe(true);
  });

  it('창 전환: a fake window stays on the desk it leaves; the next desk is warned 1.2 s (arrive), then the screen is there and that desk is hit', () => {
    const tg = host(DM, TWO);
    const b = bossOf(tg);
    const [atDesk, away] = [active(tg, 0), active(tg, 1)];
    pin(atDesk, { x: DESKS[1].x - 2, y: DESKS[1].y + 2 });
    pin(away, { x: 20, y: 10 }); // off desk B's circle, and out of the fake window's reach
    castSkill(tg, DM, 'dm_alt_tab', atDesk);
    // the fake is there at once, on the desk the screen still sits on
    expect(fakes(tg)).toHaveLength(1);
    expect(near(fakes(tg)[0].pos, DESKS[0])).toBe(true);
    expect(fakes(tg)[0].rt.stationary).toBe(true);
    expect(teles(tg)).toHaveLength(1);
    const t = teles(tg)[0];
    expect([t.motif, t.area, t.total]).toEqual(['arrive', { shape: 'circle', radius: 3.2 }, 1.2]);
    expect(near(t.center, DESKS[1])).toBe(true);
    expect(near(b.pos, DESKS[0])).toBe(true); // it can be hit where it is the whole time
    advance(tg, wait(DM, 'dm_alt_tab', 1) + AFTER);
    expect(near(b.pos, DESKS[1])).toBe(true);
    expect(Math.abs(b.facing)).toBeCloseTo(Math.PI, 9); // desk B looks left
    expect([hitsOn(tg, atDesk), hitsOn(tg, away)]).toEqual([1, 0]);
    expect(eventsOf(tg, 'blink').filter(e => e.entityId === b.id)).toHaveLength(1);
    expect(skill(DM, 'dm_alt_tab').hint).toContain('커서');
  });

  it('가짜 창: it never leaves its desk, files its 「오류 보고」 (a warned circle round the desk) and is gone 11 s after it opened', () => {
    const tg = host(DM);
    const me = active(tg);
    pin(me, { x: DESKS[0].x + 2, y: DESKS[0].y + 1.5 });
    castSkill(tg, DM, 'dm_alt_tab', me);
    const fake = fakes(tg)[0];
    advance(tg, 1.4); // the screen has left for desk B
    let report: Telegraph | undefined;
    for (let t = 0; t < 5 * 30 && !report; t++) {
      tick(tg.w);
      report = teles(tg).find(x => x.area.shape === 'circle' && near(x.center, DESKS[0]));
    }
    expect(report, 'the fake winds its report up').toBeDefined();
    expect([report!.area, report!.total]).toEqual([{ shape: 'circle', radius: 3.2 }, 1.6]);
    expect(near(fake.pos, DESKS[0])).toBe(true);
    clearEvents(tg);
    advance(tg, 1.6 + AFTER);
    expect(hitsOn(tg, me)).toBeGreaterThanOrEqual(1);
    advance(tg, 9);
    expect(fakes(tg)).toHaveLength(0);
  });

  it('창 전환 again and again: A → B → C → A, and never a second fake on a desk — not even enraged (summons × 1.5)', () => {
    const tg = host(DM);
    const b = bossOf(tg);
    pin(active(tg), { x: 12, y: 6.5 });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
    hold(tg);
    for (let i = 0; i < 4; i++) {
      castSkill(tg, DM, 'dm_alt_tab', active(tg));
      expect(fakes(tg).filter(f => near(f.pos, DESKS[i % 3])), `one fake on desk ${i % 3}`).toHaveLength(1);
      advance(tg, wait(DM, 'dm_alt_tab', 1) * 1 + AFTER);
      expect(near(b.pos, DESKS[(i + 1) % 3]), `move ${i + 1}`).toBe(true);
    }
    expect(fakes(tg)).toHaveLength(3); // A, B, C — the fourth cast found A's window still open
  });

  it('창 전환: a groggy break during the warning cancels the move («신호 없음») — the screen stays on its desk', () => {
    const tg = host(DM, [HUMAN], { bossGroggyThreshold: DEFAULT_TUNABLES.bossGroggyThreshold });
    const b = bossOf(tg);
    pin(active(tg), { x: 20, y: 10 }); // out of the fake window's reach
    const t0 = selfCast(tg, DM, 'dm_alt_tab');
    expect(teles(tg).map(t => t.motif)).toEqual(['arrive']);
    runTo(tg, t0 + 0.6);
    expect(forceGroggy(tg.w)).toBe(true);
    runTo(tg, t0 + 2);
    expect(teles(tg)).toHaveLength(0);
    expect(near(b.pos, DESKS[0])).toBe(true);
    expect(eventsOf(tg, 'blink').filter(e => e.entityId === b.id)).toHaveLength(0);
    expect(partyHits(tg)).toBe(0);
  });

  it('커서 추적: a line from the screen that keeps following its target — walking away does not dodge it', () => {
    const delay = wait(DM, 'dm_cursor');
    const tg = host(DM, TWO);
    const [me, other] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 8, y: 8 });
    pin(other, { x: 12, y: 3.5 });
    castSkill(tg, DM, 'dm_cursor', me);
    const first = teles(tg)[0];
    expect([first.area, first.total, first.center]).toEqual([{ shape: 'line', length: 27, width: 1.6 }, delay, { x: 8, y: 8 }]);
    expect(near(first.origin, DESKS[0])).toBe(true);
    advance(tg, delay / 2);
    pin(me, { x: 18, y: 9 });
    advance(tg, 0.2);
    expect(teles(tg)[0].center).toEqual({ x: 18, y: 9 });
    advance(tg, delay / 2 - 0.2 + AFTER);
    expect([hitsOn(tg, me), hitsOn(tg, other)]).toEqual([1, 0]);
  });

  it('커서 추적: the tip — a 저스트 교대 (the card leaves just before it lands) makes it miss', () => {
    const tg = host(DM);
    const me = active(tg);
    pin(me, { x: 8, y: 8 });
    castSkill(tg, DM, 'dm_cursor', me);
    advance(tg, wait(DM, 'dm_cursor') - 0.3);
    expect(justCue(tg.w.state, tg.w.tunables, 0).now).toBe(true);
    swapTo(tg, MAGE, { x: 18, y: 9 });
    advance(tg, 0.6);
    expect(eventsOf(tg, 'justSwap')).toHaveLength(1);
    expect(partyHits(tg)).toBe(0);
    expect(skill(DM, 'dm_cursor').hint).toBe('커서는 따라와요 — 교체로 피하세요');
  });

  it('블루스크린: an X through the target that slows; beside its arms it misses', () => {
    const tg = host(DM, THREE);
    const [me, diagonal, beside] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(me, { x: 12, y: 6 });
    pin(diagonal, { x: 14, y: 8 });
    pin(beside, { x: 12, y: 9 });
    castSkill(tg, DM, 'dm_bluescreen', me);
    expect(teles(tg).map(t => [t.area, t.total])).toEqual([[{ shape: 'cross', length: 5, width: 1.4, diagonal: true }, 1.2]]);
    advance(tg, wait(DM, 'dm_bluescreen') + AFTER);
    expect([hitsOn(tg, me), hitsOn(tg, diagonal), hitsOn(tg, beside)]).toEqual([1, 1, 0]);
    expect(statusValue(diagonal, 'slow')).toBe(0.3);
  });

  it('창 닫기 (페이즈): an X bursts on all three desks, A → B → C — off the diagonals of a desk you are safe', () => {
    const tg = host(DM, THREE);
    const [diagA, straightB, diagC] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(diagA, { x: DESKS[0].x - 2, y: DESKS[0].y + 2 });
    pin(straightB, { x: DESKS[1].x, y: DESKS[1].y + 3.5 }); // straight below desk B: the tip's safe spot
    pin(diagC, { x: DESKS[2].x + 1.5, y: DESKS[2].y - 1.5 });
    castSkill(tg, DM, 'dm_close', diagA);
    expect(teles(tg).map(t => [t.center, t.total, t.area])).toEqual(DESKS.map((d, i) => [{ x: d.x, y: d.y }, [1.2, 1.5, 1.8][i], { shape: 'cross', length: 6, width: 1.5, diagonal: true }]));
    advance(tg, wait(DM, 'dm_close', 0) + AFTER);
    expect([hitsOn(tg, diagA), hitsOn(tg, straightB), hitsOn(tg, diagC)]).toEqual([1, 0, 0]);
    advance(tg, wait(DM, 'dm_close', 2) - wait(DM, 'dm_close', 0));
    expect([hitsOn(tg, diagA), hitsOn(tg, straightB), hitsOn(tg, diagC)]).toEqual([1, 0, 1]);
  });
});

// ─────────────────────────── 끝나지 않는 회의 ───────────────────────────

describe('끝나지 않는 회의 (자리 이동형 — 지명은 교체로 풂, 앉은 자리가 방향)', () => {
  const SEATS = getBoss(EM).spots!;
  /** The north seat (looks down) — the pattern tests below start him there. */
  const NORTH = SEATS.findIndex(s => s.facing === 'down');
  /** Put him on seat `i` as if he had rolled there (place, facing, the seat counter). */
  const sit = (tg: TestGame, i: number): void => {
    const b = bossOf(tg);
    b.pos = { x: SEATS[i].x, y: SEATS[i].y };
    b.facing = spotFacing(getBoss(EM), i);
    b.rt.form!.spot = i;
  };

  it('form and body: four seats round the room (E looks left · S up · W right · N down); he starts on E — not at the top centre — and cannot be taunted', () => {
    const def = getBoss(EM);
    expect(def.form).toBe('relocating');
    expect(def.stationary).toBe(true);
    expect(SEATS).toEqual([{ x: 21, y: 6, facing: 'left' }, { x: 12, y: 10, facing: 'up' }, { x: 3, y: 6, facing: 'right' }, { x: 12, y: 3, facing: 'down' }]);
    expect(NORTH).toBe(3);
    const tg = raidGame(EM, { hpMult: 50, tunables: CALM });
    const b = bossOf(tg);
    expect(near(b.pos, SEATS[0])).toBe(true);
    expect(Math.abs(b.facing)).toBeCloseTo(Math.PI, 9);
    expect(isTauntable(b)).toBe(false);
    // 회의 연장 (the 기획 19차 shield + haste on himself) is gone
    expect(allSkills(def).some(sk => partsOf(sk).some(a => a.affects === 'self'))).toBe(false);
  });

  it('발표 지명: a 3.5 s mark on one character — it follows it, then the big hit lands on it and the ring round it on its neighbour', () => {
    const tg = host(EM, TWO);
    const [me, friend] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 8, y: 8 });
    pin(friend, { x: 18, y: 9 });
    castSkill(tg, EM, 'em_call', me);
    expect(teles(tg).map(t => [t.area.shape, t.total, t.mark])).toEqual([['single', 3.5, me.id], ['ring', 3.5, me.id]]);
    expect(teles(tg)[1].area).toMatchObject({ inner: 1, outer: 3.2 });
    // walking does not shake it off, and it does not jump to the friend
    pin(me, { x: 10, y: 9 });
    pin(friend, { x: 12, y: 9 });
    advance(tg, 1);
    for (const t of teles(tg)) expect(near(t.center, { x: 10, y: 9 })).toBe(true);
    advance(tg, wait(EM, 'em_call') - 1 + AFTER);
    expect([hitsOn(tg, me), hitsOn(tg, friend)]).toEqual([1, 1]);
    expect(eventsOf(tg, 'markClear')).toHaveLength(0);
  });

  it('발표 지명: the tip — swap the named character out and the whole mark is gone: one markClear, no warning left, nobody hit (not the newcomer, not the neighbour)', () => {
    const tg = host(EM, TWO);
    const [me, friend] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 8, y: 8 });
    pin(friend, { x: 10, y: 8 });
    castSkill(tg, EM, 'em_call', me);
    advance(tg, 1.5);
    clearEvents(tg);
    swapTo(tg, MAGE, { x: 8, y: 8 }); // the newcomer stands on the very same spot
    advance(tg, 0.1);
    expect(teles(tg)).toHaveLength(0);
    expect(eventsOf(tg, 'markClear').map(e => e.targetId)).toEqual([me.id]);
    advance(tg, wait(EM, 'em_call'));
    expect(partyHits(tg)).toBe(0);
    expect(skill(EM, 'em_call').hint).toBe('지명된 캐릭터를 교체로 빼세요');
  });

  it('자리 이동: the next seat is warned 1.3 s and hit as he rolls onto it; then three strips fly out of the NEW seat the way it faces — between them and behind his chair it is safe', () => {
    const tg = host(EM, THREE);
    const b = bossOf(tg);
    sit(tg, NORTH); // the seat before E
    const E = SEATS[0]; // (21, 6), looks left
    const [onMiddle, between, behind] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(onMiddle, { x: E.x - 11, y: E.y });
    pin(between, { x: E.x - 10, y: E.y + 2.3 });
    pin(behind, { x: E.x + 2, y: E.y }); // behind the chair — but on the seat's landing circle
    castSkill(tg, EM, 'em_move', onMiddle);
    expect(teles(tg)).toHaveLength(1); // the strips show only once he sits
    const t = teles(tg)[0];
    expect([t.motif, t.area, t.total]).toEqual(['arrive', { shape: 'circle', radius: 2.8 }, 1.3]);
    expect(near(t.center, E)).toBe(true);
    advance(tg, wait(EM, 'em_move', 0) + AFTER);
    expect(near(b.pos, E)).toBe(true);
    expect(Math.abs(b.facing)).toBeCloseTo(Math.PI, 9);
    expect([hitsOn(tg, onMiddle), hitsOn(tg, between), hitsOn(tg, behind)]).toEqual([0, 0, 1]);
    // 안건 배포: three strips from the new seat, pointing left, shown for their last 1.2 s
    const strips = teles(tg).filter(x => x.area.shape === 'rect');
    expect(strips).toHaveLength(3);
    for (const s of strips) {
      expect(near(s.center, E)).toBe(true);
      expect(dirOf(s).x).toBeLessThan(-0.9);
      expect(s.total).toBeLessThanOrEqual(1.2 + 1 / 30 + 1e-6);
      expect(s.area).toMatchObject({ length: 24, width: 2 });
    }
    expect(strips.map(s => Math.round(Math.atan2(dirOf(s).y, -dirOf(s).x) * (180 / Math.PI))).sort((a, c) => a - c)).toEqual([-25, 0, 25]);
    advance(tg, wait(EM, 'em_move', 1) - wait(EM, 'em_move', 0));
    expect([hitsOn(tg, onMiddle), hitsOn(tg, between), hitsOn(tg, behind)]).toEqual([1, 0, 1]);
  });

  it('자리 이동 goes round the room in order: E → S → W → N → E, facing the way each seat says', () => {
    const tg = host(EM);
    const b = bossOf(tg);
    pin(active(tg), { x: 12, y: 6.5 });
    const want = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
    for (let i = 0; i < 4; i++) {
      castSkill(tg, EM, 'em_move', active(tg));
      advance(tg, wait(EM, 'em_move', 1) + AFTER);
      expect(near(b.pos, SEATS[(i + 1) % 4]), `move ${i + 1}`).toBe(true);
      expect(Math.abs(Math.cos(b.facing) - Math.cos(want[i])) + Math.abs(Math.sin(b.facing) - Math.sin(want[i]))).toBeLessThan(1e-6);
    }
  });

  it('안건 추가: the middle first, then the ring around the SAME spot (it does not follow)', () => {
    const tg = host(EM, TWO);
    const [me, other] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 12, y: 7 });
    pin(other, { x: 15, y: 7 });
    castSkill(tg, EM, 'em_agenda', me);
    expect(teles(tg).map(t => [t.area, t.total, t.center])).toEqual([
      [{ shape: 'circle', radius: 2 }, 1.3, { x: 12, y: 7 }],
      [{ shape: 'ring', inner: 2, outer: 4.5 }, 2.1, { x: 12, y: 7 }],
    ]);
    advance(tg, wait(EM, 'em_agenda', 0) + AFTER);
    expect([hitsOn(tg, me), hitsOn(tg, other)]).toEqual([1, 0]);
    advance(tg, wait(EM, 'em_agenda', 1) - wait(EM, 'em_agenda', 0));
    expect([hitsOn(tg, me), hitsOn(tg, other)]).toEqual([1, 1]);
  });

  /** A spot `d` cells from the north seat along the laser's `angle` (° from straight down; + = his right = screen-left). */
  const beamSpot = (angle: number, d: number): Vec2 => ({ x: SEATS[NORTH].x - Math.sin((angle * Math.PI) / 180) * d, y: SEATS[NORTH].y + Math.cos((angle * Math.PI) / 180) * d });

  it('레이저포인터 (페이즈): five lines wipe from one side to the other, 0.3 s apart, each shown for its last 0.9 s — a character is hit once, however many lines cross it', () => {
    const tg = host(EM, THREE);
    sit(tg, NORTH);
    const [first, last, close] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(first, beamSpot(-50, 6));
    pin(last, beamSpot(50, 6));
    pin(close, beamSpot(0, 2.4)); // right in front of his chair: three of the five lines cross it
    castSkill(tg, EM, 'em_laser', first);
    const times = new Map<number, number>();
    let seen = 0;
    for (let t = 0; t < 2.8 * 30; t++) {
      tick(tg.w);
      for (const tele of teles(tg)) {
        expect(tele.motif).toBe('sweep');
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1 / 30 + 1e-6);
        expect(tele.area).toMatchObject({ shape: 'rect', length: 26, width: 1.4 });
      }
      seen = Math.max(seen, teles(tg).length);
      for (const e of [first, last, close]) if (!times.has(e.id) && hitsOn(tg, e) > 0) times.set(e.id, (t + 1) / 30);
    }
    expect(seen).toBeGreaterThanOrEqual(2); // the next line shows while the one before it is still coming
    expect(times.get(first.id)).toBeCloseTo(1.2, 1);
    expect(times.get(last.id)).toBeCloseTo(2.4, 1);
    expect(times.get(close.id)!).toBeLessThan(1.9);
    expect([hitsOn(tg, first), hitsOn(tg, last), hitsOn(tg, close)]).toEqual([1, 1, 1]);
  });

  it('레이저포인터: the tip — swap to the side the laser has already passed: nobody is hit', () => {
    const tg = host(EM);
    sit(tg, NORTH);
    const me = active(tg);
    pin(me, beamSpot(50, 6)); // where the wipe ends
    castSkill(tg, EM, 'em_laser', me);
    advance(tg, wait(EM, 'em_laser', 0) + AFTER); // the first line has fired on the other side
    swapTo(tg, MAGE, beamSpot(-50, 6));
    advance(tg, 1.5);
    expect(partyHits(tg)).toBe(0);
    expect(skill(EM, 'em_laser').hint).toContain('지나간 쪽');
  });
});

// ─────────────────────────── whole fights ───────────────────────────

describe('사무실: seeded fights — one seat that swaps by hand and two bots', () => {
  const SEEDS = [3, 11, 19, 27, 101, 202, 303, 404];

  interface Fight {
    end: 'clear' | 'wipe' | 'late' | 'open';
    time: number;
    /** Longest stretch (s) the boss neither moved, swung nor cast. */
    idle: number;
    swaps: number;
    hp: number;
  }

  /**
   * One fight on floor 1: seat 0 swaps every 4 s to its next ready character, dropped right behind the boss (the answer
   * most tips of this zone give); the two bots play by themselves. Stops when the floor ends or the boss enrages.
   */
  function fight(id: Id, seed: number): Fight {
    const tg = raidGame(id, { seed, players: [HUMAN, BOT1, BOT2], tunables: { bossRaidAtkMult: DEFAULT_TUNABLES.bossRaidAtkMult } });
    const s = tg.w.state;
    const boss = bossOf(tg);
    const out: Fight = { end: 'open', time: 0, idle: 0, swaps: 0, hp: 1 };
    let idle = 0;
    let last = { ...boss.pos };
    const limit = (s.plan.timeLimit + 30) * 30;
    for (let t = 0; t < limit && s.phase === 'combat' && s.floor === 1; t++) {
      if (t > 0 && t % 120 === 0) {
        const p = s.players[0];
        const behind = { x: boss.pos.x - Math.cos(boss.facing) * (boss.radius + 1.2), y: boss.pos.y - Math.sin(boss.facing) * (boss.radius + 1.2) };
        const pos = { x: Math.min(23, Math.max(1, behind.x)), y: Math.min(11, Math.max(1, behind.y)) };
        for (let k = 1; k < p.party.length; k++) {
          const index = ((p.activeIndex ?? 0) + k) % p.party.length;
          if (tg.game.dispatch({ type: 'swap', player: 0, partyIndex: index, pos }).ok) {
            out.swaps++;
            break;
          }
        }
      }
      tick(tg.w);
      out.time = s.floorTime;
      out.hp = boss.hp / boss.maxHp;
      const busy = Math.hypot(boss.pos.x - last.x, boss.pos.y - last.y) > 1e-4 || boss.anim === 'attack' || boss.anim === 'cast' || boss.rt.lockTime > 0 || hasStatus(boss, 'stun');
      idle = busy || boss.rt.gone ? 0 : idle + 1 / 30;
      out.idle = Math.max(out.idle, idle);
      last = { ...boss.pos };
      if (!boss.rt.gone && boss.rt.form?.form !== 'relocating') expect(inBossBox(boss.pos, 1e-3), `${id} left its box`).toBe(true);
      for (const e of s.entities) expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y), `${e.defId} has a position`).toBe(true);
      if (s.bossEnraged) {
        out.end = 'late';
        return out;
      }
    }
    tg.game.drainEvents();
    out.end = s.runResult?.outcome === 'defeat' ? 'wipe' : s.phase !== 'combat' || s.floor > 1 ? 'clear' : 'open';
    return out;
  }

  it.each(IDS)('%s: all 8 seeds end (no soft lock, the boss never stands idle for long), most are clears, and the same seed gives the same fight', id => {
    const runs = SEEDS.map(seed => fight(id, seed));
    const text = JSON.stringify(runs);
    for (const r of runs) {
      expect(r.end, text).not.toBe('open');
      expect(r.idle, text).toBeLessThan(8);
      expect(r.swaps, text).toBeGreaterThan(0);
    }
    const clears = runs.filter(r => r.end === 'clear');
    expect(clears.length, text).toBeGreaterThanOrEqual(5);
    for (const r of clears) {
      expect(r.time, text).toBeGreaterThan(8); // never a one-shot
      expect(r.time, text).toBeLessThan(DEFAULT_TUNABLES.bossFloorTime);
    }
    expect(fight(id, SEEDS[0])).toEqual(runs[0]);
    expect(fight(id, SEEDS[5])).toEqual(runs[5]);
  }, 60000);
});

// ─────────────────────────── looks, warning motifs, voices ───────────────────────────

describe('사무실: looks, warning motifs, voices', () => {
  const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: BossPose[] = ['idle', 'walk', 'windup', 'attack', 'groggy'];
  /** Right, left, toward the camera, away from it. */
  const FACINGS = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

  /** A counting 2D context (every method is a no-op that counts; remembers fill colours, texts and bad numbers). */
  function counter() {
    const c = { n: 0, fills: new Set<string>(), texts: [] as string[], bad: [] as string[], sets: new Set<string>(), calls: new Set<string>(), ctx: null as unknown as CanvasRenderingContext2D };
    const store: Record<string | symbol, unknown> = {};
    c.ctx = new Proxy(store, {
      get: (target, prop) =>
        prop in target
          ? target[prop]
          : (...args: unknown[]) => {
              c.n++;
              c.calls.add(String(prop));
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

  const cam = new Camera();
  cam.setArena(24, 12);

  it.each(IDS)('%s: its own body — every pose × four facings × calm / enraged / phase 2 draws inside the budget (≤ 220 calls, no text, no gradient)', id => {
    const def = getBoss(id);
    const look = bossLook(id)!;
    expect(look.body, `${id} has a body`).toBeDefined();
    expect(bossBody(id)).toBe(look.body);
    expect(look.color).toBe(def.color);
    expect(unitLook('monster', id).color).toBe(look.color);
    // about as wide as its hit circle; low enough that its head stays under the HUD boss box on the top row (y 3)
    expect(look.body!.w).toBeGreaterThanOrEqual(def.radius);
    expect(look.body!.w).toBeLessThanOrEqual(def.radius * 2.2);
    expect(look.body!.h).toBeLessThanOrEqual(2.7);
    const c = counter();
    const shapes = new Set<string>();
    for (const pose of POSES) {
      for (const facing of FACINGS) {
        for (const extra of [{}, { enraged: true, groggyNear: 2 }, { phase: 2, flash: 1 }] as Partial<BossDrawOpts>[]) {
          for (let f = 0; f < 8; f++) {
            const o: BossDrawOpts = { ...BASE, color: def.color, time: 2.3 + f * 0.17, ...extra, groggy: pose === 'groggy' ? Math.min(1, (f + 1) / 4) : 0 };
            const frame = { fx: 400, fy: 400, w: look.body!.w * 53, h: look.body!.h * 53, s: 1 as const, pose, p: f / 7, stride: f / 8, time: o.time, facing };
            c.n = 0;
            look.body!.draw(c.ctx, frame, o);
            expect(c.n, `${id} ${pose} facing ${facing.toFixed(2)} frame ${f}`).toBeLessThanOrEqual(220);
            expect(c.n, `${id} ${pose}: draws something`).toBeGreaterThan(30);
            if (f === 3) shapes.add(`${pose}:${c.n}`);
          }
        }
      }
    }
    expect(c.texts, `${id}: no text on a body (it would mirror)`).toEqual([]);
    expect(c.bad, `${id}: finite numbers`).toEqual([]);
    expect(c.sets.has('shadowBlur')).toBe(false);
    expect(c.calls.has('createLinearGradient') || c.calls.has('createRadialGradient')).toBe(false);
    expect(c.fills.size, `${id} uses a palette`).toBeGreaterThan(6);
    expect(shapes.size, `${id}: the poses differ`).toBeGreaterThan(3);
    // through the shared frame (mirror, bob, groggy wash) and as a set piece for the sheet tools
    const a = newBodyAnim(12, 6, 0);
    for (const pose of POSES) {
      stepBodyAnim(a, 12, 6, 0, 1 / 30);
      expect(() => drawBossBody(c.ctx, cam, a, { defId: id, x: 12, y: 6, facing: 0, pose, p: 0.5, rise: 1 }, { ...BASE, color: def.color, groggy: pose === 'groggy' ? 1 : 0 })).not.toThrow();
    }
    c.n = 0;
    look.draw(c.ctx, cam, 12, -1.2, 3, { ...BASE, retreat: 1 });
    expect(c.n, `${id}: nothing once gone`).toBe(0);
  });

  const SIGNS: Record<Id, string> = { shredder_maw: '용지 걸림', coffee_machine: '물을 보충하세요', dead_monitor: '신호 없음', endless_meeting: '휴회' };

  it.each(IDS)('%s: its groggy sign hangs over the body where it stands (screen-aligned, one text) and fades with the pose', id => {
    const look = bossLook(id)!;
    const c = counter();
    look.props!(c.ctx, cam, 9, 7, getBoss(id).radius, { ...BASE, groggy: 1, time: 0.3 });
    look.props!(c.ctx, cam, 12, -1.2, 3, { ...BASE, groggy: 0.6, time: 0.3 }); // the sheet tools' spot
    expect(c.texts.filter(t => t === SIGNS[id]).length).toBeGreaterThanOrEqual(1);
    expect(c.bad).toEqual([]);
    c.n = 0;
    look.props!(c.ctx, cam, 9, 7, getBoss(id).radius, { ...BASE, groggy: 0 });
    expect(c.n, 'nothing while it is up').toBe(0);
  });

  it('문서 파쇄기 shows which way it looks: its flank, its mouth (toward the camera) and its glowing bin (from behind) are three different pictures', () => {
    const body = bossLook(SH)!.body!;
    const picture = (facing: number): string => {
      const c = counter();
      body.draw(c.ctx, { fx: 400, fy: 400, w: body.w * 53, h: body.h * 53, s: 1, pose: 'idle', p: 0, stride: 0, time: 1, facing }, { ...BASE });
      return `${c.n}:${[...c.fills].join()}`;
    };
    const [side, front, back] = [picture(0), picture(Math.PI / 2), picture(-Math.PI / 2)];
    expect(new Set([side, front, back]).size).toBe(3);
    expect(picture(Math.PI)).toBe(picture(0)); // left = right, mirrored by the shared frame
    expect(back).toContain('#ffd60a'); // the weak bin
    expect(front).toContain('#9db4c8'); // the steel hood
  });

  it('floor art: the three desks (모니터) and the long table (회의) bake from the boss data without a throw, for both phases', () => {
    for (const id of [DM, EM] as const) {
      const stage = bossLook(id)!.stage!;
      expect(stage.tone).toBe('dark');
      for (const phase of [1, 2]) {
        const c = counter();
        stage.bake(c.ctx, { wPx: 1280, hPx: 352, cellX: 1280 / 24, cellY: 352 / 12, phase });
        expect(c.n).toBeGreaterThan(40);
        expect(c.bad).toEqual([]);
        expect(c.texts).toEqual([]);
      }
    }
    expect(bossLook(SH)!.stage ?? bossLook(CF)!.stage).toBeUndefined(); // their floor hints come from the shared code
  });

  it('가짜 창 has a body in the registry (as big as the real screen): both facings, idle / reporting / flashing, no text', () => {
    const draw = MINION_LOOKS.fake_monitor;
    expect(typeof draw).toBe('function');
    expect(MINION_LOOKS.error_popup).toBeUndefined();
    expect(unitLook('monster', 'fake_monitor').name).toBe('가짜 창');
    const c = counter();
    for (const s of [-1, 1]) for (const act of [0, 1]) for (const flash of [false, true]) draw(c.ctx, '#cfc4b2', flash, 300, 400, 128, 153, s, 2.5, 0.7, act);
    expect(c.n).toBeGreaterThan(8 * 30);
    expect(c.bad).toEqual([]);
    expect(c.texts).toEqual([]);
    expect(c.sets.has('shadowBlur')).toBe(false);
    expect(c.sets.has('globalAlpha'), 'it leaves the alpha of the unit pass alone').toBe(false);
  });

  it('the coffee trail has its own paint; warning motifs: both puddles linger, 창 전환 is a spawn; every row is a skill of the zone', () => {
    expect(BOSS_ZONE_LOOKS[getBoss(CF).trail!.look!]).toEqual({ fill: '#5b3a1e', edge: '#ff6b4a' });
    expect(BOSS_TELE_MOTIF.cf_pour).toBe('linger');
    expect(BOSS_TELE_MOTIF.cf_overflow).toBe('linger');
    expect(BOSS_TELE_MOTIF.dm_alt_tab).toBe('spawn');
    const ids = new Set(IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id)));
    const mine = Object.keys(BOSS_TELE_MOTIF).filter(k => /^(sh|cf|dm|em)_/.test(k));
    expect(mine.sort()).toEqual(['cf_overflow', 'cf_pour', 'dm_alt_tab']);
    for (const k of mine) expect(ids.has(k), k).toBe(true);
  });

  it('voices: the 기획 19차 rows (root, motif, timbre) and one sound kind per skill of 4-2', () => {
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
    expect(BOSS_VOICE.shredder_maw.kinds).toEqual({ sh_bite: 'blades', sh_lunge: 'slice', sh_scraps: 'papers', sh_whirl: 'blades' });
    expect(BOSS_VOICE.coffee_machine.kinds).toEqual({ cf_steam: 'gas', cf_capsules: 'countdown', cf_pour: 'water', cf_overflow: 'water' });
    expect(BOSS_VOICE.dead_monitor.kinds).toEqual({ dm_alt_tab: 'static', dm_cursor: 'beam', dm_bluescreen: 'static', dm_close: 'burst' });
    expect(BOSS_VOICE.endless_meeting.kinds).toEqual({ em_call: 'stamp', em_move: 'papers', em_agenda: 'papers', em_laser: 'beam' });
  });
});
