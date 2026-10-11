// 기획 20차 보스 형태 — 옥상·이계 bosses (docs/bosses.md 4-4): 물탱크의 주인 · 천둥 안테나 · 대답하는 연필 · 거꾸로 뜬 달.
// The zone table and each boss's numbers, form and body; every pattern cast as the boss casts it — the kind of warning
// it shows, who it hits when nobody moves, and the swap its tip names (a drop position or a last-moment swap) getting
// out of it; phase, groggy, taunt; fights with one seat that swaps by hand + two bots on 8 seeds (no soft-lock, same
// seed same fight); the looks (every pose of every body, the two floors); and the shared contract of a new boss, also
// under the 보스 튜닝 knobs.
// The classic boss of the zone (abyss_watcher) is covered by boss-roster / boss-mechanics / the goldens.
import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_RAID_BAND, ZONE_BOSSES, getBoss } from '../../src/data';
import { BOSS_FORM, ENRAGE } from '../../src/data/bosses';
import { ROOFTOP_BOSSES } from '../../src/data/bosses/rooftop';
import { BOSS_VOICE } from '../../src/audio/synth/bossVoices';
import type { BossDrawOpts } from '../../src/render/boss';
import { BOSS_TELE_MOTIF, BOSS_ZONE_LOOKS, bossLook } from '../../src/render/bosses';
import { drawBossBody, newBodyAnim, stepBodyAnim } from '../../src/render/bosses/body';
import type { BossPose } from '../../src/render/bosses/types';
import { Camera } from '../../src/render/camera';
import { bossFormOf, isHeavy, isTauntable } from '../../src/sim/bossForm';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { forceGroggy, isGroggy } from '../../src/sim/groggy';
import { startAction } from '../../src/sim/skills';
import { applyStatus, hasStatus } from '../../src/sim/status';
import type { PendingHit, SimEntity } from '../../src/sim/world';
import type { BossForm, GameEvent, MonsterSkill, PlayerSetup, Telegraph, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, inBossBox, partsOf, raidGame } from './bossRaidHelpers';

const IDS = ['tank_dweller', 'thunder_antenna', 'answering_pencil', 'inverted_moon'] as const;
type Id = (typeof IDS)[number];

const TWO: PlayerSetup[] = [HUMAN, { ...HUMAN, name: '둘' }];
const THREE: PlayerSetup[] = [...TWO, { ...HUMAN, name: '셋' }];
const CALM: Partial<Tunables> = { invincible: true, bossGroggyThreshold: 0 };
/** In a soft fight the boss hits like a feather: damage events are real, nobody dies. */
const SOFT = 0.01;

type Cast = Extract<GameEvent, { type: 'skillCast' }>;
type Damage = Extract<GameEvent, { type: 'damage' }>;

/**
 * A fight whose boss does nothing by itself: skills silenced, no basic attacks, standing where the test puts it (as if
 * it were casting). Its hits land softly, so every damage event on the party is the pattern under test.
 */
function host(id: Id, players: PlayerSetup[] = [HUMAN], knobs: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 80, players, tunables: { monsterDmgMult: SOFT, bossGroggyThreshold: 0, ...knobs } });
  silence(tg);
  advance(tg, 1.1); // past the entrance pose
  const b = bossOf(tg);
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
  tg.w.state.projectiles.length = 0;
  clearEvents(tg);
  return tg;
}

/** A calm fight whose boss walks and turns but casts nothing by itself (party invincible, boss never dies). */
function quiet(id: Id, players: PlayerSetup[] = [HUMAN], knobs: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 50, players, tunables: { ...CALM, ...knobs } });
  silence(tg);
  advance(tg, 1.1);
  clearEvents(tg);
  return tg;
}

function silence(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
}

function skill(id: Id, skillId: string): MonsterSkill {
  const sk = allSkills(getBoss(id)).find(s => s.id === skillId);
  if (!sk) throw new Error(`no skill ${skillId}`);
  return sk;
}

/**
 * Cast one real skill of the boss at `target` as ONE cast (one ctx, like the boss does). variant 0 = action / extra,
 * 1 = cycle[0] … Returns the pending part of each telegraphed part.
 */
function castSkill(tg: TestGame, id: Id, skillId: string, target: SimEntity, variant = 0): (PendingHit | null)[] {
  const b = bossOf(tg);
  b.targetId = target.id;
  const sk = skill(id, skillId);
  const v = variant === 0 ? sk : sk.cycle![variant - 1];
  const ctx = unitCtx(tg.w, b, sk.id, sk.name);
  return [v.action, ...(v.extra ?? [])].map((a, i) => startAction(tg.w, ctx, a, undefined, i));
}

/** The boss casts exactly this skill by itself, now (lock, cycle and cooldown as in a real fight). */
function give(tg: TestGame, id: Id, skillId: string): void {
  const b = bossOf(tg);
  b.rt.skills = [skill(id, skillId)];
  b.rt.skillCds = [0];
  b.rt.skillGap = 0;
}

/** Hold a character still at a spot (it no longer walks or attacks). */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 9999;
}

/** Swap player `player`'s field character for its next card, dropped at `pos`; returns the new character. */
function swapTo(tg: TestGame, player: number, pos: Vec2, hold = true): SimEntity {
  const p = tg.w.state.players[player];
  const idx = p.party.findIndex((m, i) => i !== p.activeIndex && !m.dead && m.swapCooldownRemaining <= 0);
  expect(tg.game.dispatch({ type: 'swap', player, partyIndex: idx, pos }).ok).toBe(true);
  const e = active(tg, player);
  if (hold) e.rt.lockTime = 9999;
  // the incoming drag skill may have hurt the boss: nothing here depends on it
  return e;
}

/** Tick until this part has at most `left` s to go. */
function until(tg: TestGame, p: PendingHit | null, left: number): void {
  for (let i = 0; i < 600 && p && p.remaining > left + 1e-9; i++) tick(tg.w);
  drain(tg);
}

const hitsOn = (tg: TestGame, e: SimEntity): Damage[] => eventsOf(tg, 'damage').filter(d => d.targetId === e.id);
/** Enemy warnings that hurt (not a boss's own yellow self-cast ring). */
const teles = (tg: TestGame): Telegraph[] => tg.w.state.telegraphs.filter(t => t.team === 'enemy' && !t.self);
const enemyZones = (tg: TestGame) => tg.w.state.zones.filter(z => z.team === 'enemy');
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: Vec2, b: Vec2, eps = 1e-6): boolean => dist(a, b) < eps;
const bossCasts = (tg: TestGame): Cast[] => drain(tg).filter((e): e is Cast => e.type === 'skillCast' && e.sourceId === tg.w.state.bossId);

/** The fields 기획 20차 added to a boss entry — the zone's classic boss must have none of them. */
const FORM_FIELDS = ['form', 'spawn', 'move', 'spots', 'stage', 'guard', 'trail', 'signature'] as const;

// docs/bosses.md 1-2 · 4-4 (floor 1): form, body radius, [HP, attack, attack speed, groggy], where it appears, how it
// walks, per skill [cooldown, first use], the phase [name, HP below, attack speed ×, cooldown ×], signature, summons
interface Row {
  name: string;
  form: BossForm;
  radius: number;
  stats: [number, number, number, number];
  spawn: Vec2;
  speed: number;
  range: number;
  basic: 'melee' | 'projectile';
  move: string;
  skills: Record<string, [number, number]>;
  phase: [string, number, number | undefined, number];
  signature: string;
  summons: string[];
}
const TABLE: Record<Id, Row> = {
  tank_dweller: {
    name: '물탱크의 주인', form: 'roaming', radius: 1.6, stats: [7600, 30, 0.5, 0.9], spawn: { x: 19.5, y: 8.5 }, speed: 1.3, range: 1.2, basic: 'melee', move: 'pursue',
    skills: { td_dive: [12, 5], td_hair: [11, 9], td_umbrellas: [14, 7], td_hug: [12, 1.5] }, phase: ['역류', 0.5, 1.15, 0.85], signature: 'td_dive', summons: ['slime'],
  },
  thunder_antenna: {
    name: '천둥 안테나', form: 'roaming', radius: 1.4, stats: [7000, 32, 0.6, 1], spawn: { x: 5, y: 3 }, speed: 1.4, range: 40, basic: 'projectile', move: 'keepAway',
    skills: { ta_bolt: [8, 3], ta_ground: [14, 7], ta_crackle: [10, 10], ta_double_bolt: [11, 1.5] }, phase: ['채널 고정', 0.5, 1.2, 0.85], signature: 'ta_ground', summons: [],
  },
  answering_pencil: {
    name: '대답하는 연필', form: 'arena', radius: 1.4, stats: [8200, 30, 0.55, 1.1], spawn: { x: 12, y: 4 }, speed: 0.8, range: 1, basic: 'melee', move: 'pursue',
    skills: { ap_stroke: [8, 4], ap_box: [12, 7], ap_answer: [13, 10], ap_wrong: [12, 1.5] }, phase: ['대답', 0.5, 1.15, 0.85], signature: 'ap_answer', summons: [],
  },
  inverted_moon: {
    name: '거꾸로 뜬 달', form: 'arena', radius: 1.8, stats: [7400, 30, 0.55, 1], spawn: { x: 6, y: 3.5 }, speed: 0.9, range: 40, basic: 'projectile', move: 'path',
    skills: { im_eclipse: [14, 5], im_dark: [12, 9], im_hands: [10, 3], im_turn: [14, 1.5] }, phase: ['붉은 달', 0.5, undefined, 0.85], signature: 'im_eclipse', summons: [],
  },
};

describe('옥상·이계: the zone table', () => {
  it('has five bosses — the four new ones with data, then the classic boss, which is untouched (no 기획 20차 field)', () => {
    expect(ZONE_BOSSES.rooftop).toEqual([...IDS, 'abyss_watcher']);
    for (const id of ZONE_BOSSES.rooftop) expect(BOSSES.some(b => b.id === id && b.zone === 'rooftop'), id).toBe(true);
    expect(IDS.map(id => BOSS_RAID_BAND[id])).toEqual(['early', 'late', 'mid', 'mid']);
    const classic = ROOFTOP_BOSSES[0];
    expect(classic.id).toBe('abyss_watcher');
    for (const k of FORM_FIELDS) expect(classic[k], `abyss_watcher.${k}`).toBeUndefined();
    expect(classic.radius).toBe(3);
    expect(classic.stationary).toBe(true);
    expect(classic.stats).toEqual({ maxHp: 7200, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 });
    expect(allSkills(classic).map(sk => [sk.id, sk.cooldown, sk.initialDelay])).toEqual([
      ['boss_burst', 8, 4], ['boss_summon', 16, 6], ['boss_rift', 12, 10], ['boss_tentacles', 16, 14], ['boss_beams', 13, 1.5], ['boss_abyss_ring', 14, 1.5],
    ]);
    for (const sk of allSkills(classic)) {
      expect(sk.cycle ?? sk.castMove ?? sk.hint, `${sk.id}: no 기획 20차 skill field`).toBeUndefined();
      for (const a of [sk.action, ...(sk.extra ?? [])]) {
        expect(a.center, sk.id).not.toBe('arena');
        expect(a.rel ?? a.once ?? a.bound ?? a.relocate ?? a.trail, `${sk.id}: no 기획 20차 part field`).toBeUndefined();
      }
    }
  });

  it.each(IDS)('%s: the table row — name, form, body, stats, walk, skills, phase, signature', id => {
    const def = getBoss(id);
    const row = TABLE[id];
    expect(def.name).toBe(row.name);
    expect(bossFormOf(def)).toBe(row.form);
    expect(def.radius).toBe(row.radius);
    expect([def.stats.maxHp, def.stats.atk, def.stats.atkSpeed, def.groggy?.threshold]).toEqual(row.stats);
    expect(def.spawn).toEqual(row.spawn);
    expect([def.stats.moveSpeed, def.stats.range, def.basic.kind, def.move?.mode]).toEqual([row.speed, row.range, row.basic, row.move]);
    expect(def.stationary ?? false).toBe(false);
    expect(Object.fromEntries(allSkills(def).map(sk => [sk.id, [sk.cooldown, sk.initialDelay]]))).toEqual(row.skills);
    const ph = def.phases![0];
    expect([ph.name, ph.hpBelow, ph.atkSpeedMult, ph.cooldownMult]).toEqual(row.phase);
    expect(def.signature).toBe(row.signature);
    expect(def.enrage).toEqual(ENRAGE);
    expect(allSkills(def).flatMap(sk => partsOf(sk)).flatMap(a => (a.summon ? [a.summon.unitId] : []))).toEqual(row.summons);
    // the signature pattern carries a tip, and a tip never runs past one HUD line
    expect(skill(id, row.signature).hint, 'the signature has a tip').toBeTruthy();
    for (const sk of allSkills(def)) if (sk.hint) expect(sk.hint.length, sk.hint).toBeLessThanOrEqual(46);
    // one sound kind per skill, no stray ids (docs/bosses.md 6장)
    expect(Object.keys(BOSS_VOICE[id].kinds).sort()).toEqual(Object.keys(row.skills).sort());
  });

  it('the sound kinds and the warning motifs are the rows of docs/bosses.md', () => {
    expect(BOSS_VOICE.tank_dweller.kinds).toEqual({ td_dive: 'water', td_hair: 'tentacle', td_umbrellas: 'summon', td_hug: 'tentacle' });
    expect(BOSS_VOICE.thunder_antenna.kinds).toEqual({ ta_bolt: 'static', ta_ground: 'ring', ta_crackle: 'burst', ta_double_bolt: 'static' });
    expect(BOSS_VOICE.answering_pencil.kinds).toEqual({ ap_stroke: 'slice', ap_box: 'blades', ap_answer: 'chime', ap_wrong: 'stamp' });
    expect(BOSS_VOICE.inverted_moon.kinds).toEqual({ im_eclipse: 'beam', im_dark: 'ring', im_hands: 'tentacle', im_turn: 'beam' });
    const mine = Object.fromEntries(Object.entries(BOSS_TELE_MOTIF).filter(([k]) => /^(td|ta|ap|im)_/.test(k)));
    expect(mine).toEqual({ td_hair: 'pull', td_hug: 'pull', td_dive: 'linger', td_umbrellas: 'spawn' });
  });
});

describe('옥상·이계: form and body', () => {
  it.each(IDS)('%s: appears at its spawn inside the box, heavy, and only the roaming two can be taunted', id => {
    const tg = quiet(id);
    const fresh = raidGame(id, { tunables: CALM });
    expect(bossOf(fresh).pos).toEqual(TABLE[id].spawn);
    expect(inBossBox(bossOf(fresh).pos)).toBe(true);
    const b = bossOf(tg);
    expect(b.radius).toBe(TABLE[id].radius);
    expect(isHeavy(b)).toBe(true);
    expect(isTauntable(b)).toBe(TABLE[id].form === 'roaming');
    expect(applyStatus(b, 'taunt', 3, 0, 0, 'drag', { sourceEntityId: active(tg).id })).toBe(TABLE[id].form === 'roaming');
  });

  it('물탱크의 주인 crawls after the nearest character at 1.3 cells a second and claws it in reach; a taunt pulls it to the tank', () => {
    const tg = quiet('tank_dweller', TWO);
    const b = bossOf(tg);
    const [nearOne, farOne] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 12, y: 4 };
    pin(nearOne, { x: 17, y: 4 });
    pin(farOne, { x: 3, y: 9 });
    b.targetId = nearOne.id; // (a pursuer keeps the target it picked until that one dies or leaves)
    advance(tg, 2);
    expect(b.targetId).toBe(nearOne.id);
    // it turned to its target first (180°/s), then walked: about 1.3 × 2 cells, never more
    expect(b.pos.x).toBeGreaterThan(12 + 1.3 * 2 * 0.6);
    expect(b.pos.x).toBeLessThanOrEqual(12 + 1.3 * 2 + 1e-6);
    advance(tg, 3);
    expect(dist(b.pos, nearOne.pos) - b.radius - nearOne.radius).toBeLessThanOrEqual(1.2 + 0.05);
    expect(eventsOf(tg, 'attack').some(e => e.sourceId === b.id && !e.ranged)).toBe(true);
    // 도발: the far character calls it over
    expect(applyStatus(b, 'taunt', 4, 0, 0, 'drag', { sourceEntityId: farOne.id })).toBe(true);
    const before = dist(b.pos, farOne.pos);
    advance(tg, 3);
    expect(b.targetId).toBe(farOne.id);
    expect(dist(b.pos, farOne.pos)).toBeLessThan(before - 2);
  });

  it('천둥 안테나 backs away from whoever comes within 4 cells and shoots from afar; taunted, it walks up to the tank instead', () => {
    const tg = quiet('thunder_antenna');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 12, y: 6 };
    pin(me, { x: 10, y: 6 });
    advance(tg, 2.5);
    expect(dist(b.pos, me.pos)).toBeGreaterThanOrEqual(4 - 0.05);
    expect(b.pos.x).toBeGreaterThan(13.5);
    expect(eventsOf(tg, 'attack').some(e => e.sourceId === b.id && e.ranged)).toBe(true);
    // beyond 7 cells it closes in again, but never nearer than it keeps
    me.pos = { x: 2, y: 6 };
    advance(tg, 6);
    const kept = dist(b.pos, me.pos);
    expect(kept).toBeLessThanOrEqual(7.05);
    expect(kept).toBeGreaterThanOrEqual(4 - 0.05);
    // 도발: it comes right up to the tank (BOSS_FORM.tauntReach from body to body)
    expect(applyStatus(b, 'taunt', 4, 0, 0, 'drag', { sourceEntityId: me.id })).toBe(true);
    advance(tg, 3.5);
    expect(dist(b.pos, me.pos)).toBeLessThan(kept - 1.5);
    expect(dist(b.pos, me.pos) - b.radius - me.radius).toBeLessThanOrEqual(BOSS_FORM.tauntReach + 0.1);
  });

  it('대답하는 연필 only creeps (0.8 cells a second): its big moves are the strokes; its floor is the paper with the two words', () => {
    const tg = quiet('answering_pencil');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 12, y: 4 };
    pin(me, { x: 20, y: 9 });
    advance(tg, 3);
    const walked = dist(b.pos, { x: 12, y: 4 });
    expect(walked).toBeGreaterThan(0.8 * 3 * 0.5);
    expect(walked).toBeLessThanOrEqual(0.8 * 3 + 1e-6);
    const def = getBoss('answering_pencil');
    expect(def.stage).toEqual({ floor: 'paper', marks: [{ id: 'yes', x: 5, y: 6, r: 3.2, label: '예' }, { id: 'no', x: 19, y: 6, r: 3.2, label: '아니오' }] });
    // 대답 is safe exactly where the words are written: one source for both
    const answers = [skill('answering_pencil', 'ap_answer').action, skill('answering_pencil', 'ap_answer').cycle![0].action];
    expect(answers.map(a => [a.center, a.offset, a.area])).toEqual(def.stage!.marks!.map(m => ['arena', { x: m.x, y: m.y }, { shape: 'ring', inner: m.r, outer: 30 }]));
  });

  it('거꾸로 뜬 달 rounds its four points in order and never stops — not even while it casts (only a groggy holds it)', () => {
    const tg = quiet('inverted_moon');
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    const way = getBoss('inverted_moon').move!.waypoints!;
    expect(way).toEqual([{ x: 6, y: 3.5 }, { x: 18, y: 3.5 }, { x: 18, y: 8.5 }, { x: 6, y: 8.5 }]);
    expect(getBoss('inverted_moon').move!.castMove).toBe(true);
    // along the top side first (it turns to its way, then drifts)
    advance(tg, 1.5);
    expect(b.pos.y).toBeCloseTo(3.5, 6);
    expect(b.pos.x).toBeGreaterThan(6.3);
    give(tg, 'inverted_moon', 'im_eclipse');
    advance(tg, 0.2);
    expect(bossCasts(tg).map(c => c.skillId)).toEqual(['im_eclipse']);
    const at = { ...b.pos };
    advance(tg, 1.8);
    expect(teles(tg)).toHaveLength(1); // still winding up …
    expect(dist(b.pos, at)).toBeGreaterThan(0.9 * 1.8 * 0.8); // … and still drifting
    // the whole round: it comes by every corner
    const seen = new Set<number>();
    for (let t = 0; t < 45 * 30; t++) {
      tick(tg.w);
      way.forEach((p, i) => {
        if (dist(b.pos, p) < 0.2) seen.add(i);
      });
      expect(inBossBox(b.pos, 1e-3)).toBe(true);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('the looks: a body for each (only the moon lies flat), a floor for the two arena bosses, the graphite line', () => {
    for (const id of IDS) {
      const look = bossLook(id)!;
      expect(look.body, `${id} has a body`).toBeDefined();
      expect(look.color).toBe(getBoss(id).color);
      expect(!!look.body!.flat).toBe(id === 'inverted_moon');
      expect(!!look.stage).toBe(TABLE[id].form === 'arena');
    }
    expect(bossLook('answering_pencil')!.stage!.tone).toBe('light');
    expect(bossLook('inverted_moon')!.stage!.tone).toBe('dark');
    // thin, tall, low, flat: no two boxes alike
    const boxes = IDS.map(id => `${bossLook(id)!.body!.w}x${bossLook(id)!.body!.h}`);
    expect(new Set(boxes).size).toBe(4);
    expect(BOSS_ZONE_LOOKS.graphite).toBeDefined();
    expect(partsOf(skill('answering_pencil', 'ap_stroke'))[0].trail?.look).toBe('graphite');
  });
});

// ─────────────────────────── 물탱크의 주인 ───────────────────────────

describe('물탱크의 주인: patterns', () => {
  /** The dweller left of a character at (12, 6), and one more far away. */
  function diveSetup(): { tg: TestGame; b: SimEntity; me: SimEntity; far: SimEntity } {
    const tg = host('tank_dweller', TWO);
    const b = bossOf(tg);
    const [me, far] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 6, y: 6 };
    pin(me, { x: 12, y: 6 });
    pin(far, { x: 20, y: 10 });
    return { tg, b, me, far };
  }

  it('★ 잠수: it comes up BEHIND its target at once, then the burst (r 3, 1.4 s) and a puddle that stays 5 s — standing still is hit', () => {
    const { tg, b, me, far } = diveSetup();
    castSkill(tg, 'tank_dweller', 'td_dive', me);
    // behind = the far side of the target from where it was, 0.3 between the bodies; it looks back at its target
    expect(b.pos.x).toBeCloseTo(12 + me.radius + b.radius + 0.3, 6);
    expect(b.pos.y).toBeCloseTo(6, 6);
    expect(Math.cos(b.facing)).toBeCloseTo(-1, 6);
    expect(eventsOf(tg, 'blink').filter(e => e.entityId === b.id)).toHaveLength(1);
    const t = teles(tg);
    expect(t.map(x => [x.area.shape === 'circle' ? x.area.radius : 0, x.total])).toEqual([[3, 1.4], [2, 1.5]]);
    for (const x of t) expect(near(x.center, b.pos)).toBe(true);
    advance(tg, 1.45);
    expect(hitsOn(tg, me)).toHaveLength(1); // the burst
    expect(hitsOn(tg, far)).toHaveLength(0);
    advance(tg, 0.1);
    const z = enemyZones(tg);
    expect(z).toHaveLength(1);
    expect(z[0].radius).toBe(2); // 기획 20차 점검: 2.4 covered every melee spot around the body
    expect(z[0].total).toBe(5);
    expect(near(z[0].center, b.pos)).toBe(true);
    advance(tg, 1.2);
    expect(hitsOn(tg, me).length).toBeGreaterThanOrEqual(3); // the puddle ticks every 0.5 s
    expect(hasStatus(me, 'slow')).toBe(true);
    advance(tg, 4.5);
    expect(enemyZones(tg)).toHaveLength(0);
  });

  it('★ 잠수 tip 「터지기 전에 멀리 꺼내세요」: swapped out and dropped 6 cells away, nobody is hit; a last-moment swap is a 저스트', () => {
    const a = diveSetup();
    castSkill(a.tg, 'tank_dweller', 'td_dive', a.me);
    advance(a.tg, 0.6);
    clearEvents(a.tg);
    const fresh = swapTo(a.tg, 0, { x: 8, y: 6 });
    advance(a.tg, 3);
    expect(hitsOn(a.tg, fresh)).toHaveLength(0);
    expect(eventsOf(a.tg, 'justSwap')).toHaveLength(0); // early: a plain dodge by position

    const j = diveSetup();
    const [burst] = castSkill(j.tg, 'tank_dweller', 'td_dive', j.me);
    until(j.tg, burst, 0.3);
    clearEvents(j.tg);
    swapTo(j.tg, 0, { x: 8, y: 6 });
    const just = eventsOf(j.tg, 'justSwap');
    expect(just).toHaveLength(1);
    expect(just[0].boss).toBe(true);
  });

  it('잠수 holds the boss until the puddle landed (the last part), then it crawls again', () => {
    const tg = quiet('tank_dweller');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 6, y: 6 };
    pin(me, { x: 14, y: 6 });
    give(tg, 'tank_dweller', 'td_dive');
    advance(tg, 0.1);
    expect(bossCasts(tg).some(c => c.skillId === 'td_dive')).toBe(true);
    const at = { ...b.pos };
    expect(at.x).toBeGreaterThan(14); // it dived: now on the far side
    me.pos = { x: 4, y: 6 };
    advance(tg, 1.3);
    expect(b.pos).toEqual(at);
    advance(tg, 2.5);
    expect(b.pos.x).toBeLessThan(at.x - 0.5);
  });

  /** The dweller at (12, 6); one character in the hair ring (6 away), one right beside the body, one beyond the ring. */
  function hairSetup(): { tg: TestGame; b: SimEntity; me: SimEntity; beside: SimEntity; beyond: SimEntity } {
    const tg = host('tank_dweller', THREE);
    const b = bossOf(tg);
    const [me, beside, beyond] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    b.pos = { x: 12, y: 6 };
    pin(me, { x: 18, y: 6 });
    pin(beside, { x: 12, y: 8.3 });
    pin(beyond, { x: 2, y: 6 });
    return { tg, b, me, beside, beyond };
  }

  it('머리카락: everyone in the ring 3–9 around the body is dragged 4.5 cells to it and hurt — beside it and beyond it nothing', () => {
    const { tg, b, me, beside, beyond } = hairSetup();
    castSkill(tg, 'tank_dweller', 'td_hair', me);
    const t = teles(tg);
    expect(t).toHaveLength(1);
    expect(t[0].area).toEqual({ shape: 'ring', inner: 3, outer: 9 });
    expect(t[0].total).toBe(1.3);
    expect(near(t[0].center, b.pos)).toBe(true);
    advance(tg, 1.4);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(me.pos.x).toBeLessThan(18 - 3.8); // dragged up to the body (which then pushes it off itself)
    expect(me.pos.x).toBeGreaterThan(12 + b.radius);
    expect(hitsOn(tg, beside)).toHaveLength(0);
    expect(beside.pos).toEqual({ x: 12, y: 8.3 });
    expect(hitsOn(tg, beyond)).toHaveLength(0);
    expect(beyond.pos).toEqual({ x: 2, y: 6 });
    expect(b.pos).toEqual({ x: 12, y: 6 }); // the pull never moves the boss
  });

  it('머리카락 tip 「끌려가기 직전에 교체」: the character that comes in at the last moment is neither dragged nor hurt', () => {
    const { tg, me } = hairSetup();
    const [ring] = castSkill(tg, 'tank_dweller', 'td_hair', me);
    until(tg, ring, 0.3);
    clearEvents(tg);
    const fresh = swapTo(tg, 0, { x: 18, y: 6 });
    expect(eventsOf(tg, 'justSwap')).toHaveLength(1);
    const hp = fresh.hp;
    advance(tg, 0.6);
    expect(fresh.pos.x).toBeCloseTo(18, 6);
    expect(fresh.hp).toBe(hp);
  });

  it('우산 손님: 4–6 외발 우산 around the target', () => {
    const tg = host('tank_dweller');
    const me = active(tg);
    pin(me, { x: 16, y: 8 });
    castSkill(tg, 'tank_dweller', 'td_umbrellas', me);
    advance(tg, 0.1);
    const umbrellas = tg.w.state.entities.filter(e => e.defId === 'slime' && !e.rt.gone);
    expect(umbrellas.length).toBeGreaterThanOrEqual(4);
    expect(umbrellas.length).toBeLessThanOrEqual(6);
    for (const u of umbrellas) expect(dist(u.pos, me.pos)).toBeLessThan(4.5);
  });

  it('페이즈 끌어안기: the drag first (no damage), then the burst around the body — pulled in and standing = hit; out right after the drag = safe', () => {
    for (const dodge of [false, true]) {
      const { tg, me, beside } = hairSetup();
      const parts = castSkill(tg, 'tank_dweller', 'td_hug', me);
      expect(teles(tg).map(t => [t.area.shape, t.total])).toEqual([['ring', 1.2], ['circle', 1.9]]);
      expect(parts[0]!.remaining).toBeCloseTo(1.2, 6);
      advance(tg, 1.25);
      expect(hitsOn(tg, me)).toHaveLength(0);
      expect(me.pos.x).toBeLessThan(18 - 3.8);
      let who = me;
      if (dodge) who = swapTo(tg, 0, { x: 20, y: 6 });
      clearEvents(tg);
      advance(tg, 0.8);
      expect(hitsOn(tg, who)).toHaveLength(dodge ? 0 : 1);
      expect(hitsOn(tg, beside)).toHaveLength(1); // whoever stood beside it all along is in the burst too
    }
  });
});

// ─────────────────────────── 천둥 안테나 ───────────────────────────

describe('천둥 안테나: patterns', () => {
  it('낙뢰: one character, 1.5 s — its warning shows only for the last 0.9 s and follows; a last-moment swap takes no damage', () => {
    for (const dodge of [false, true]) {
      const tg = host('thunder_antenna');
      const me = active(tg);
      pin(me, { x: 12, y: 6 });
      const [p] = castSkill(tg, 'thunder_antenna', 'ta_bolt', me);
      expect(teles(tg)).toHaveLength(0);
      advance(tg, 0.5);
      expect(teles(tg)).toHaveLength(0);
      advance(tg, 0.2);
      expect(teles(tg).map(t => t.area.shape)).toEqual(['single']);
      me.pos = { x: 14, y: 8 };
      advance(tg, 0.2);
      expect(near(teles(tg)[0].center, { x: 14, y: 8 })).toBe(true);
      if (!dodge) {
        advance(tg, 0.7);
        expect(hitsOn(tg, me)).toHaveLength(1);
        continue;
      }
      until(tg, p, 0.3);
      clearEvents(tg);
      const fresh = swapTo(tg, 0, { x: 14, y: 8 });
      expect(eventsOf(tg, 'justSwap')).toHaveLength(1);
      const hp = fresh.hp;
      advance(tg, 0.6);
      expect(fresh.hp).toBe(hp);
    }
  });

  /** The antenna at (12, 6); one character hugging it (2.4 away), one 8 cells off. */
  function groundSetup(): { tg: TestGame; b: SimEntity; hug: SimEntity; far: SimEntity } {
    const tg = host('thunder_antenna', TWO);
    const b = bossOf(tg);
    const [hug, far] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 12, y: 6 };
    pin(hug, { x: 14.4, y: 6 });
    pin(far, { x: 20, y: 6 });
    return { tg, b, hug, far };
  }

  it('★ 접지: the whole roof is struck except 3.4 cells around the antenna (a safe ring, 2.2 s) — far away is hit, hugging it is safe', () => {
    const { tg, b, hug, far } = groundSetup();
    castSkill(tg, 'thunder_antenna', 'ta_ground', far);
    const t = teles(tg);
    expect(t).toHaveLength(1);
    expect(t[0].area).toEqual({ shape: 'ring', inner: 3.4, outer: 30 });
    expect(t[0].total).toBe(2.2);
    expect(near(t[0].center, b.pos)).toBe(true);
    advance(tg, 2.25);
    expect(hitsOn(tg, far)).toHaveLength(1);
    expect(hitsOn(tg, hug)).toHaveLength(0);
  });

  it('★ 접지 tip 「보스에 딱 붙여 꺼내세요」: the far character swaps and drops beside the antenna — safe; the hole stays 3.4 under 범위 ×2', () => {
    for (const area of [1, 2]) {
      const tg = host('thunder_antenna', TWO, { bossAreaMult: area });
      const b = bossOf(tg);
      const [hug, far] = [active(tg, 0), active(tg, 1)];
      b.pos = { x: 12, y: 6 };
      pin(hug, { x: 14.4, y: 6 });
      pin(far, { x: 20, y: 6 });
      castSkill(tg, 'thunder_antenna', 'ta_ground', far);
      expect(teles(tg)[0].area).toMatchObject({ shape: 'ring', inner: 3.4 });
      advance(tg, 1);
      clearEvents(tg);
      const fresh = swapTo(tg, 1, { x: 12, y: 8.4 });
      advance(tg, 1.4);
      expect(hitsOn(tg, fresh)).toHaveLength(0);
      expect(hitsOn(tg, hug)).toHaveLength(0);
    }
  });

  it('접지: the antenna does not back away while it gathers the storm — it stands until the strike, then flees again', () => {
    const tg = quiet('thunder_antenna');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 12, y: 6 };
    pin(me, { x: 9.6, y: 6 }); // well inside the 4 cells it keeps
    give(tg, 'thunder_antenna', 'ta_ground');
    advance(tg, 0.1);
    expect(bossCasts(tg).map(c => c.skillId)).toEqual(['ta_ground']);
    const at = { ...b.pos };
    advance(tg, 2);
    expect(b.pos).toEqual(at);
    expect(dist(me.pos, b.pos)).toBeLessThan(3.4 - me.radius); // so whoever chased it is safe
    advance(tg, 2);
    expect(b.pos.x).toBeGreaterThan(at.x + 0.8);
  });

  it('지직: an ✕ on the target — on a diagonal is hit, straight beside it is not; dropped beside it, the swap is safe', () => {
    const tg = host('thunder_antenna', THREE);
    const [me, diag, ortho] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(me, { x: 12, y: 6 });
    pin(diag, { x: 14, y: 8 });
    pin(ortho, { x: 15, y: 6 });
    castSkill(tg, 'thunder_antenna', 'ta_crackle', me);
    expect(teles(tg).map(t => [t.area, t.total])).toEqual([[{ shape: 'cross', length: 5, width: 1.3, diagonal: true }, 1.2]]);
    advance(tg, 0.5);
    clearEvents(tg);
    const fresh = swapTo(tg, 0, { x: 12, y: 9 });
    advance(tg, 0.8);
    expect(hitsOn(tg, diag)).toHaveLength(1);
    expect(hitsOn(tg, ortho)).toHaveLength(0);
    expect(hitsOn(tg, fresh)).toHaveLength(0);
  });

  it('페이즈 두 번 낙뢰: two bolts 0.6 s apart — both hit whoever stands; dodging the first with a swap still leaves the second', () => {
    const tg = host('thunder_antenna');
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    castSkill(tg, 'thunder_antenna', 'ta_double_bolt', me);
    advance(tg, 2);
    expect(hitsOn(tg, me)).toHaveLength(2);

    const again = host('thunder_antenna');
    const first = active(again);
    pin(first, { x: 12, y: 6 });
    const parts = castSkill(again, 'thunder_antenna', 'ta_double_bolt', first);
    until(again, parts[0], 0.3);
    clearEvents(again);
    const fresh = swapTo(again, 0, { x: 12, y: 6 });
    expect(eventsOf(again, 'justSwap')).toHaveLength(1);
    bossOf(again).targetId = fresh.id; // as the boss does the moment it is free
    advance(again, 0.4);
    expect(hitsOn(again, fresh)).toHaveLength(0); // the first bolt whiffed
    advance(again, 0.7);
    expect(hitsOn(again, fresh)).toHaveLength(1); // … the second came for the new one
  });
});

// ─────────────────────────── 대답하는 연필 ───────────────────────────

describe('대답하는 연필: patterns', () => {
  /** The pencil at (4, 5); one character on the line it will draw, one off it. */
  function strokeSetup(): { tg: TestGame; b: SimEntity; me: SimEntity; off: SimEntity } {
    const tg = host('answering_pencil', TWO);
    const b = bossOf(tg);
    const [me, off] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 4, y: 5 };
    pin(me, { x: 10, y: 5 });
    pin(off, { x: 10, y: 9 });
    return { tg, b, me, off };
  }

  it('긋기: a rush warning along the line (13 cells), the pencil runs it, and the line it drew stays 10 s as a graphite trail', () => {
    const { tg, b, me, off } = strokeSetup();
    castSkill(tg, 'answering_pencil', 'ap_stroke', me);
    const t = teles(tg);
    expect(t).toHaveLength(1);
    expect(t[0].motif).toBe('charge');
    expect(t[0].area.shape).toBe('line');
    expect(t[0].total).toBe(1.2);
    expect(t[0].origin).toEqual({ x: 4, y: 5 });
    expect(t[0].center).toEqual({ x: 17, y: 5 });
    expect(b.facing).toBe(0);
    advance(tg, 1.25);
    expect(b.pos).toEqual({ x: 17, y: 5 });
    expect(eventsOf(tg, 'dash').filter(e => e.entityId === b.id)).toHaveLength(1);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, off)).toHaveLength(0);
    const line = enemyZones(tg);
    expect(line).toHaveLength(14); // one circle a cell, the start included
    expect(line.every(z => z.look === 'graphite' && z.radius === 0.6 && z.total === 10)).toBe(true);
    expect(line.map(z => z.center.x)).toEqual(Array.from({ length: 14 }, (_, k) => 4 + k));
    // standing on the line: it keeps hurting and slows
    advance(tg, 1.1);
    expect(hitsOn(tg, me).length).toBeGreaterThanOrEqual(3);
    expect(hasStatus(me, 'slow')).toBe(true);
    expect(hitsOn(tg, off)).toHaveLength(0);
    advance(tg, 9.5);
    expect(enemyZones(tg)).toHaveLength(0);
  });

  it('긋기 tip 「교체로 넘어가세요」: swapped across to the other side of the line before it is drawn — never touched', () => {
    const { tg, me } = strokeSetup();
    castSkill(tg, 'answering_pencil', 'ap_stroke', me);
    advance(tg, 0.5);
    clearEvents(tg);
    const fresh = swapTo(tg, 0, { x: 10, y: 2 });
    advance(tg, 4);
    expect(hitsOn(tg, fresh)).toHaveLength(0);
  });

  it('긋기 stops at the edge of the box, and the line is only as long as the pencil ran', () => {
    const tg = host('answering_pencil');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 14, y: 6 };
    pin(me, { x: 19, y: 6 });
    castSkill(tg, 'answering_pencil', 'ap_stroke', me);
    advance(tg, 1.25);
    expect(b.pos).toEqual({ x: BOSS_FORM.box.xMax, y: 6 });
    expect(enemyZones(tg)).toHaveLength(9);
  });

  it('ㅁ 긋기: four strokes around the target, one after the other — the inside is safe, on a stroke is hit; a swap into the box is safe', () => {
    const tg = host('answering_pencil', THREE);
    const [me, left, top] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(me, { x: 12, y: 6 });
    pin(left, { x: 9, y: 6 });
    pin(top, { x: 12, y: 3 });
    castSkill(tg, 'answering_pencil', 'ap_box', me);
    const t = teles(tg);
    expect(t.map(x => [x.area.shape, x.total])).toEqual([['rect', 1.2], ['rect', 1.5], ['rect', 1.8], ['rect', 2.1]]);
    expect(t.map(x => x.center)).toEqual([{ x: 12, y: 3 }, { x: 12, y: 9 }, { x: 9, y: 6 }, { x: 15, y: 6 }]);
    advance(tg, 1);
    clearEvents(tg);
    const fresh = swapTo(tg, 1, { x: 12.9, y: 6.8 }); // the one on the left stroke comes inside
    advance(tg, 1.3);
    expect(hitsOn(tg, me)).toHaveLength(0);
    expect(hitsOn(tg, fresh)).toHaveLength(0);
    expect(hitsOn(tg, top)).toHaveLength(1);
  });

  it('★ 대답: the paper is blacked out except the ring around one word (2.6 s) — on the word is safe, anywhere else is hit', () => {
    for (const [variant, word, other] of [[0, 5, 19], [1, 19, 5]] as const) {
      const tg = host('answering_pencil', THREE);
      const [onWord, middle, wrong] = [active(tg, 0), active(tg, 1), active(tg, 2)];
      pin(onWord, { x: word + 1.5, y: 7 });
      pin(middle, { x: 12, y: 9 });
      pin(wrong, { x: other, y: 6 });
      bossOf(tg).pos = { x: 12, y: 4 };
      castSkill(tg, 'answering_pencil', 'ap_answer', middle, variant);
      const t = teles(tg);
      expect(t).toHaveLength(1);
      expect(t[0].area).toEqual({ shape: 'ring', inner: 3.2, outer: 30 });
      expect(t[0].center).toEqual({ x: word, y: 6 });
      expect(t[0].total).toBe(2.6);
      advance(tg, 2.65);
      expect(hitsOn(tg, onWord)).toHaveLength(0);
      expect(hitsOn(tg, middle)).toHaveLength(1);
      expect(hitsOn(tg, wrong)).toHaveLength(1);
    }
  });

  it('★ 대답 tip 「빛나는 글자 위로 꺼내세요」: 예 first, then 아니오, then 예 again — and a swap onto the word is safe', () => {
    const tg = quiet('answering_pencil');
    const me = active(tg);
    pin(me, { x: 12, y: 9 });
    give(tg, 'answering_pencil', 'ap_answer');
    const xs: number[] = [];
    for (let t = 0; t < 40 * 30 && xs.length < 3; t++) {
      tick(tg.w);
      for (const e of tg.game.drainEvents()) if (e.type === 'skillCast' && e.skillId === 'ap_answer') xs.push(e.center.x);
    }
    expect(xs).toEqual([5, 19, 5]);

    const soft = host('answering_pencil');
    const who = active(soft);
    pin(who, { x: 12, y: 9 });
    castSkill(soft, 'answering_pencil', 'ap_answer', who);
    advance(soft, 1.2);
    clearEvents(soft);
    const fresh = swapTo(soft, 0, { x: 5.5, y: 6.5 });
    advance(soft, 1.6);
    expect(hitsOn(soft, fresh)).toHaveLength(0);
  });

  it('페이즈 틀린 답: a quick ㅁ, then the stab in its middle — inside is no longer safe; a swap out of the box is', () => {
    for (const dodge of [false, true]) {
      const tg = host('answering_pencil', TWO);
      const [me, left] = [active(tg, 0), active(tg, 1)];
      pin(me, { x: 12, y: 6 });
      pin(left, { x: 9, y: 6 });
      castSkill(tg, 'answering_pencil', 'ap_wrong', me);
      expect(teles(tg).map(t => [t.area.shape, t.total])).toEqual([['rect', 1], ['rect', 1.2], ['rect', 1.4], ['rect', 1.6], ['circle', 2.6]]);
      advance(tg, 1.7);
      expect(hitsOn(tg, me)).toHaveLength(0); // the strokes went around it
      expect(hitsOn(tg, left)).toHaveLength(1);
      let who = me;
      if (dodge) who = swapTo(tg, 0, { x: 16.5, y: 6 });
      clearEvents(tg);
      advance(tg, 1);
      expect(hitsOn(tg, who)).toHaveLength(dodge ? 0 : 1);
    }
  });
});

// ─────────────────────────── 거꾸로 뜬 달 ───────────────────────────

describe('거꾸로 뜬 달: patterns', () => {
  /** The moon parked at the top; the called character at (10, 8), one beside it, one far away. */
  function moonSetup(): { tg: TestGame; me: SimEntity; beside: SimEntity; far: SimEntity } {
    const tg = host('inverted_moon', THREE);
    const [me, beside, far] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    bossOf(tg).pos = { x: 6, y: 3.5 };
    pin(me, { x: 10, y: 8 });
    pin(beside, { x: 11.5, y: 8 });
    pin(far, { x: 18, y: 8 });
    return { tg, me, beside, far };
  }

  it('★ 월식 (모여라): only 2.6 cells around the called character are safe (2.2 s) — beside it is safe, far away is hit', () => {
    const { tg, me, beside, far } = moonSetup();
    castSkill(tg, 'inverted_moon', 'im_eclipse', me);
    const t = teles(tg);
    expect(t).toHaveLength(1);
    expect(t[0].area).toEqual({ shape: 'ring', inner: 2.6, outer: 30 });
    expect(t[0].center).toEqual({ x: 10, y: 8 });
    expect(t[0].total).toBe(2.2);
    advance(tg, 2.25);
    expect(hitsOn(tg, me)).toHaveLength(0);
    expect(hitsOn(tg, beside)).toHaveLength(0);
    expect(hitsOn(tg, far)).toHaveLength(1);
  });

  it('★ 월식 tip 「불린 사람 곁으로 교체」: the far character swaps in beside the called one — safe', () => {
    const { tg, me, beside } = moonSetup();
    castSkill(tg, 'inverted_moon', 'im_eclipse', me);
    advance(tg, 1);
    clearEvents(tg);
    const fresh = swapTo(tg, 2, { x: 9, y: 9 });
    advance(tg, 1.4);
    expect(hitsOn(tg, fresh)).toHaveLength(0);
    expect(hitsOn(tg, beside)).toHaveLength(0);
  });

  it('그믐 (흩어져라): a dark circle (r 3.6) follows the called character — it and whoever stays beside it are hit, far away is safe', () => {
    const { tg, me, beside, far } = moonSetup();
    castSkill(tg, 'inverted_moon', 'im_dark', me);
    const t = teles(tg);
    expect(t.map(x => [x.area, x.total])).toEqual([[{ shape: 'circle', radius: 3.6 }, 2.2]]);
    me.pos = { x: 10.5, y: 9 };
    advance(tg, 0.2);
    expect(near(teles(tg)[0].center, { x: 10.5, y: 9 })).toBe(true); // it follows
    advance(tg, 2.05);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, beside)).toHaveLength(1);
    expect(hitsOn(tg, far)).toHaveLength(0);
  });

  it('그믐 tip: the others spread by a swap (dropped far = safe); the called one swaps out at the last moment — a 저스트, no damage', () => {
    const { tg, me } = moonSetup();
    const [p] = castSkill(tg, 'inverted_moon', 'im_dark', me);
    advance(tg, 0.8);
    clearEvents(tg);
    const spread = swapTo(tg, 1, { x: 17, y: 4 });
    until(tg, p, 0.3);
    clearEvents(tg);
    const fresh = swapTo(tg, 0, { x: 10, y: 8 });
    expect(eventsOf(tg, 'justSwap')).toHaveLength(1);
    const hp = fresh.hp;
    advance(tg, 0.6);
    expect(fresh.hp).toBe(hp);
    expect(hitsOn(tg, spread)).toHaveLength(0);
  });

  it('그림자 손: four hands at the corners around the target, 0.15 s apart — the middle is safe, a corner is hit', () => {
    const tg = host('inverted_moon', TWO);
    const [me, corner] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 12, y: 6 });
    pin(corner, { x: 9.6, y: 3.6 });
    castSkill(tg, 'inverted_moon', 'im_hands', me);
    const t = teles(tg);
    expect(t.map(x => x.total)).toEqual([1.1, 1.25, 1.4, 1.55]);
    expect(t.map(x => x.center)).toEqual([{ x: 9.6, y: 3.6 }, { x: 14.4, y: 3.6 }, { x: 14.4, y: 8.4 }, { x: 9.6, y: 8.4 }]);
    advance(tg, 1.7);
    expect(hitsOn(tg, me)).toHaveLength(0);
    expect(hitsOn(tg, corner)).toHaveLength(1);
  });

  it('페이즈 뒤집힌 월식: gather (2.0 s), then at once spread — the dark circle only shows after the eclipse went off (3.4 s)', () => {
    for (const dodge of [false, true]) {
      const { tg, me, beside, far } = moonSetup();
      castSkill(tg, 'inverted_moon', 'im_turn', me);
      expect(teles(tg).map(t => [t.area.shape, t.total])).toEqual([['ring', 2]]);
      advance(tg, 2.05);
      expect(hitsOn(tg, far)).toHaveLength(1); // the eclipse
      expect(hitsOn(tg, me)).toHaveLength(0);
      expect(hitsOn(tg, beside)).toHaveLength(0);
      expect(teles(tg)).toHaveLength(0);
      advance(tg, 0.15);
      expect(teles(tg).map(t => t.area)).toEqual([{ shape: 'circle', radius: 3.6 }]);
      let who = beside;
      if (dodge) who = swapTo(tg, 1, { x: 17, y: 4 }); // the one that gathered leaves again
      clearEvents(tg);
      advance(tg, 1.3);
      expect(hitsOn(tg, me)).toHaveLength(1);
      expect(hitsOn(tg, who)).toHaveLength(dodge ? 0 : 1);
    }
  });
});

// ─────────────────────────── phase · groggy ───────────────────────────

describe('옥상·이계: phase and groggy', () => {
  it.each(IDS)('%s: under half HP the phase is announced by name and its skill joins the rotation with the phase cooldown', id => {
    const tg = raidGame(id, { hpMult: 50, tunables: CALM });
    advance(tg, 1);
    clearEvents(tg);
    const b = bossOf(tg);
    expect(b.rt.skills.map(s => s.id)).toEqual(getBoss(id).skills.map(s => s.id));
    crossPhase(tg);
    const ev = eventsOf(tg, 'bossPhase');
    expect(ev).toHaveLength(1);
    expect(ev[0].name).toBe(TABLE[id].phase[0]);
    const phaseSkill = getBoss(id).phases![0].skills![0].id;
    expect(b.rt.skills.map(s => s.id)).toContain(phaseSkill);
    expect(b.rt.phaseCdMult).toBeCloseTo(0.85, 9);
    advance(tg, 6);
    expect(bossCasts(tg).some(c => c.skillId === phaseSkill)).toBe(true);
  });

  it.each(IDS)('%s: a groggy break drops the pattern it was winding up, and the body stays put — the moon too — until it stands up', id => {
    const tg = raidGame(id, { hpMult: 50, players: TWO, tunables: { monsterDmgMult: SOFT } });
    silence(tg);
    advance(tg, 1.5);
    const b = bossOf(tg);
    give(tg, id, TABLE[id].signature);
    advance(tg, 0.4);
    expect(bossCasts(tg).some(c => c.skillId === TABLE[id].signature)).toBe(true);
    expect(teles(tg).length).toBeGreaterThan(0);
    b.rt.skills = [];
    b.rt.skillCds = [];
    expect(forceGroggy(tg.w)).toBe(true);
    advance(tg, 0.1);
    expect(isGroggy(tg.w, b)).toBe(true);
    expect(teles(tg)).toHaveLength(0);
    // (잠수 already put the body behind its target at the cast: what the break drops is the burst and the puddle)
    const at = { ...b.pos };
    tg.w.state.projectiles.length = 0;
    clearEvents(tg);
    advance(tg, tg.w.tunables.bossGroggyDuration - 0.4);
    expect(b.pos).toEqual(at);
    expect(eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally')).toHaveLength(0); // the dropped pattern never lands
    expect(enemyZones(tg)).toHaveLength(0);
    advance(tg, 2);
    expect(isGroggy(tg.w, b)).toBe(false);
    if (id === 'inverted_moon') expect(b.pos).not.toEqual(at); // the moon drifts on
    // … and it casts again
    give(tg, id, TABLE[id].signature);
    advance(tg, 1.5);
    expect(bossCasts(tg).some(c => c.skillId === TABLE[id].signature)).toBe(true);
  });
});

// ─────────────────────────── whole fights ───────────────────────────

/** How one whole fight went: one seat swapping by hand every 4 s (dropped beside the boss) + two bots. */
interface FightResult {
  end: 'clear' | 'lost' | 'open';
  seconds: number;
  /** The longest time (s) the boss lost no HP. */
  noDamage: number;
  /** The longest time (s) the boss neither moved, swung nor cast. */
  idle: number;
  swaps: number;
  digest: string;
}

function directFight(id: Id, seed: number, limit = 240): FightResult {
  const tg = raidGame(id, { seed, players: [HUMAN, BOT1, BOT2], tunables: { bossRaidAtkMult: undefined } });
  const w = tg.w;
  const s = w.state;
  const b = bossOf(tg);
  const r: FightResult = { end: 'open', seconds: 0, noDamage: 0, idle: 0, swaps: 0, digest: '' };
  let hp = b.hp;
  let dry = 0;
  let idle = 0;
  let last = { ...b.pos };
  for (let t = 0; t < limit * 30; t++) {
    if (t % 120 === 60 && s.phase === 'combat') {
      // the hand seat: the next ready card, dropped two cells beside the boss (clamped into the arena by the game)
      const p = s.players[0];
      const idx = p.party.findIndex((m, i) => i !== p.activeIndex && !m.dead && m.swapCooldownRemaining <= 0);
      const side = r.swaps % 2 === 0 ? -1 : 1;
      if (idx >= 0 && tg.game.dispatch({ type: 'swap', player: 0, partyIndex: idx, pos: { x: b.pos.x + side * (b.radius + 1.6), y: b.pos.y + 1 } }).ok) r.swaps++;
    }
    tick(w);
    r.seconds = (t + 1) / 30;
    const ev = tg.game.drainEvents();
    if (ev.some(e => e.type === 'floorClear')) {
      r.end = 'clear';
      break;
    }
    if (s.phase !== 'combat') {
      r.end = 'lost';
      break;
    }
    dry = b.hp < hp - 1e-9 ? 0 : dry + 1 / 30;
    hp = b.hp;
    r.noDamage = Math.max(r.noDamage, dry);
    const busy = dist(b.pos, last) > 1e-4 || b.anim === 'attack' || b.anim === 'cast' || b.anim === 'stunned' || b.rt.lockTime > 0;
    idle = busy ? 0 : idle + 1 / 30;
    r.idle = Math.max(r.idle, idle);
    last = { ...b.pos };
    if (!b.rt.gone && !inBossBox(b.pos, 1e-3)) throw new Error(`${id} left its box at (${b.pos.x}, ${b.pos.y})`);
    for (const e of s.entities) if (!e.rt.gone && !(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y))) throw new Error(`${e.defId}: not a number`);
  }
  r.digest = `${s.tick}:${Math.round(b.hp)}:${s.players.map(p => p.party.map(m => Math.round(m.hp)).join(',')).join('|')}`;
  return r;
}

describe('옥상·이계: whole fights — one seat swapping by hand + two bots', () => {
  const SEEDS = [11, 222, 3333, 4444, 5005, 6106, 7207, 8308];

  it.each(IDS)('%s: 8 seeds end (the boss falls or the party does) with no soft-lock — the boss is always reachable and never stands idle', id => {
    let clears = 0;
    for (const seed of SEEDS) {
      const r = directFight(id, seed);
      expect(r.end, `${id} seed ${seed}: still fighting after ${r.seconds.toFixed(0)} s`).not.toBe('open');
      expect(r.noDamage, `${id} seed ${seed}: nobody could hurt the boss`).toBeLessThan(12);
      expect(r.idle, `${id} seed ${seed}: the boss stood idle`).toBeLessThan(8);
      expect(r.swaps, `${id} seed ${seed}: the hand seat swapped`).toBeGreaterThan(2);
      if (r.end === 'clear') clears++;
    }
    // rough only (no fine balance this round): the fight is winnable
    expect(clears, `${id}: clears of 8`).toBeGreaterThanOrEqual(4);
  }, 60000);

  it.each(IDS)('%s: same seed, same fight', id => {
    expect(directFight(id, 4242).digest).toBe(directFight(id, 4242).digest);
  }, 30000);
});

// ─────────────────────────── looks ───────────────────────────

interface Rec {
  ctx: CanvasRenderingContext2D;
  total: number;
  texts: string[];
  sets: Set<string>;
  bad: string[];
  gradients: number;
  reset(): void;
}

/** A recording 2D context: counts calls, remembers what was set, flags non-finite numbers. */
function recorder(): Rec {
  const store: Record<string | symbol, unknown> = {};
  const rec: Rec = {
    ctx: null as unknown as CanvasRenderingContext2D,
    total: 0,
    texts: [],
    sets: new Set(),
    bad: [],
    gradients: 0,
    reset() {
      this.total = 0;
      this.texts.length = 0;
    },
  };
  rec.ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const name = String(prop);
      return (...args: unknown[]) => {
        rec.total++;
        if (name === 'fillText' || name === 'strokeText') rec.texts.push(String(args[0]));
        if (name === 'createLinearGradient' || name === 'createRadialGradient') rec.gradients++;
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) rec.bad.push(`${name}(${args.join(',')})`);
        return undefined;
      };
    },
    set(target, prop, value) {
      rec.sets.add(String(prop));
      if (typeof value === 'number' && !Number.isFinite(value)) rec.bad.push(`${String(prop)}=${value}`);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return rec;
}

const DRAW: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
const POSES: BossPose[] = ['idle', 'walk', 'windup', 'attack', 'groggy'];

describe('옥상·이계: the looks draw', () => {
  const cam = new Camera();
  cam.setArena(24, 12);
  cam.snap(null);

  it.each(IDS)('%s: every pose, both sides, calm / phase 2 / enraged — inside the budget, no text on the body, finite numbers', id => {
    const rec = recorder();
    const body = bossLook(id)!.body!;
    for (const pose of POSES) {
      for (const facing of [0, Math.PI]) {
        for (const extra of [{}, { phase: 2 }, { enraged: true, flash: 1 }] as Partial<BossDrawOpts>[]) {
          const a = newBodyAnim(12, 6, facing);
          for (let f = 0; f <= 10; f++) {
            const o: BossDrawOpts = { ...DRAW, color: getBoss(id).color, time: 2 + f * 0.13, ...extra, groggy: pose === 'groggy' ? f / 10 : 0, charge: pose === 'windup' ? f / 10 : 0 };
            stepBodyAnim(a, 12 + f * 0.06 * Math.cos(facing), 6, facing, 1 / 30);
            rec.reset();
            drawBossBody(rec.ctx, cam, a, { defId: id, x: 12 + f * 0.06 * Math.cos(facing), y: 6, facing, pose, p: f / 10, rise: f === 0 ? 0.4 : 1 }, o);
            expect(rec.total, `${id} ${pose} ${f}`).toBeGreaterThan(8);
            expect(rec.total, `${id} ${pose} ${f}`).toBeLessThanOrEqual(260); // 220 for the body + the shared frame
            expect(rec.texts).toEqual([]);
            // the body alone
            rec.reset();
            body.draw(rec.ctx, { fx: 500, fy: 400, w: body.w * 53, h: body.h * 53, s: 1, pose, p: f / 10, stride: f / 10, time: o.time, facing }, o);
            expect(rec.total, `${id} ${pose} ${f}: the body's own calls`).toBeLessThanOrEqual(220);
          }
        }
      }
    }
    expect(rec.bad).toEqual([]);
    expect(rec.gradients).toBe(0);
    expect(rec.sets.has('shadowBlur')).toBe(false);
  });

  it.each(IDS)('%s: as a set piece (the sheet tools) and its groggy sign', id => {
    const rec = recorder();
    const look = bossLook(id)!;
    for (const o of [{}, { charge: 1 }, { groggy: 1 }, { phase: 2, enraged: true }, { retreat: 0.5 }] as Partial<BossDrawOpts>[]) {
      rec.reset();
      look.draw(rec.ctx, cam, 12, 6.5, getBoss(id).radius, { ...DRAW, time: 3, ...o });
      if ((o.groggy ?? 0) > 0) look.props?.(rec.ctx, cam, 12, 6.5, getBoss(id).radius, { ...DRAW, time: 3, ...o });
      expect(rec.total).toBeGreaterThan(8);
      expect(rec.texts.length).toBeLessThanOrEqual(2);
    }
    rec.reset();
    look.draw(rec.ctx, cam, 12, 6.5, getBoss(id).radius, { ...DRAW, retreat: 1 });
    expect(rec.total).toBe(0);
    expect(rec.bad).toEqual([]);
  });

  it('the paper: 예 and 아니오 are written where the boss data says; the roof at night: the sky moon within its live budget', () => {
    const B = { wPx: 1280, hPx: 352, cellX: 1280 / 24, cellY: (1280 / 24) * 0.55 };
    for (const phase of [1, 2]) {
      const rec = recorder();
      bossLook('answering_pencil')!.stage!.bake(rec.ctx, { ...B, phase });
      expect(rec.texts.filter(t => t === '예' || t === '아니오')).toEqual(['예', '아니오']);
      expect(rec.total).toBeGreaterThan(40);
      expect(rec.bad).toEqual([]);
      expect(rec.gradients).toBe(0);
      const night = recorder();
      const moon = bossLook('inverted_moon')!.stage!;
      moon.bake(night.ctx, { ...B, phase });
      expect(night.total).toBeGreaterThan(5);
      for (const o of [{}, { charge: 0.7 }, { groggy: 1 }, { enraged: true }] as Partial<BossDrawOpts>[]) {
        night.reset();
        night.ctx.globalAlpha = 1;
        moon.live!(night.ctx, cam, { ...DRAW, phase, time: 4, ...o }, 4);
        expect(night.total).toBeGreaterThan(8);
        expect(night.total).toBeLessThanOrEqual(40);
        expect(night.texts).toEqual([]);
      }
      expect(night.bad).toEqual([]);
    }
    expect(bossLook('answering_pencil')!.stage!.live).toBeUndefined();
  });
});

// ─────────────────────────── the shared contract ───────────────────────────

describe('옥상·이계: the contract of a new boss', () => {
  it.each(IDS)('%s: shape by form, every skill within 45 s with no idle stretch, phase → phase skill, kill → clear, same seed same fight', id => {
    expectBossContract(id);
  });
});

// 보스 튜닝 (docs/boss-raid.md 4-2, docs/bosses.md 3장): no pattern may depend on the numbers as written.
describe('옥상·이계: the contract holds under the boss tuning knobs', () => {
  it.each(IDS)('%s: 예고 ×2 · 범위 ×0.5', id => {
    expectBossContract(id, { bossTelegraphMult: 2, bossAreaMult: 0.5 });
  });
  it.each(IDS)('%s: 예고 ×2 · 범위 ×0.5 · 이동 ×1.5', id => {
    expectBossContract(id, { bossTelegraphMult: 2, bossAreaMult: 0.5, bossMoveMult: 1.5 });
  });
  it.each(IDS)('%s: 예고 ×0.6 · 범위 ×1.5 · 이동 ×0.5', id => {
    expectBossContract(id, { bossTelegraphMult: 0.6, bossAreaMult: 1.5, bossMoveMult: 0.5 });
  });
});
