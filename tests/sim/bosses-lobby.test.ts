// 기획 19차 보스 레이드 — 로비·상가 bosses (docs/bosses.md 2장): 인형 뽑기 기계 · 혼자 도는 세탁기 · 지하 7번 노래방 ·
// 거꾸로 가는 에스컬레이터 (+ the classic 닫히지 않는 엘리베이터, untouched). Per boss: the numbers of the table, the
// shared contract (expectBossContract), its patterns in order with the right warning shapes, phase / enrage / groggy,
// its own mechanics, a bots-only fight that ends before the enrage, and its look / voice rows.
import { describe, expect, it } from 'vitest';
import { BOSS_VOICE } from '../../src/audio/synth/bossVoices';
import { BOSSES, BOSS_RAID_BAND, ZONE_BOSSES, getBoss, getMonster } from '../../src/data';
import { ENRAGE } from '../../src/data/bosses';
import { LOBBY_BOSSES, LOBBY_UNITS } from '../../src/data/bosses/lobby';
import { type BossDrawOpts, drawBossArt } from '../../src/render/boss';
import { BOSS_TELE_MOTIF, MINION_LOOKS, bossLook } from '../../src/render/bosses';
import { Camera } from '../../src/render/camera';
import { applyDamage } from '../../src/sim/combat';
import { unitCtx } from '../../src/sim/ctx';
import { enrage } from '../../src/sim/floor';
import { tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { groggyMax } from '../../src/sim/groggy';
import { checkPhases } from '../../src/sim/phases';
import { startAction } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { hasStatus, statusValue } from '../../src/sim/status';
import { monsterCdMult } from '../../src/sim/units';
import type { SimEntity } from '../../src/sim/world';
import type { AreaShape, GameEvent, PlayerSetup, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, partsOf, raidGame } from './bossRaidHelpers';

const NEW_IDS = ['claw_machine', 'washer_drum', 'karaoke_room', 'reverse_escalator'] as const;
type LobbyId = (typeof NEW_IDS)[number];

/** docs/bosses.md 2장, 로비·상가 rows: HP / attack / attack speed / groggy · phase (HP, name, attack-speed ×, cooldown ×). */
const TABLE: Record<LobbyId, { name: string; hp: number; atk: number; atkSpeed: number; groggy: number; phase: [number, string, number, number]; band: string }> = {
  claw_machine: { name: '인형 뽑기 기계', hp: 8200, atk: 30, atkSpeed: 0.5, groggy: 0.8, phase: [0.5, '잭팟', 1.15, 0.85], band: 'early' },
  washer_drum: { name: '혼자 도는 세탁기', hp: 8800, atk: 29, atkSpeed: 0.5, groggy: 1, phase: [0.5, '헹굼 실패', 1, 0.85], band: 'early' },
  karaoke_room: { name: '지하 7번 노래방', hp: 8600, atk: 30, atkSpeed: 0.55, groggy: 1, phase: [0.5, '앙코르', 1.15, 0.85], band: 'mid' },
  reverse_escalator: { name: '거꾸로 가는 에스컬레이터', hp: 9000, atk: 30, atkSpeed: 0.5, groggy: 1, phase: [0.5, '추락 계단', 1, 0.85], band: 'late' },
};

interface PatternRow {
  cd: number;
  first: number;
  /** One entry per part: its warning shape and its delay (0 = no warning: a summon). */
  parts: [AreaShape['shape'], number][];
}

/** Every pattern of the four bosses, base skills in cast order (= by first use), the phase skill last. */
const PATTERNS: Record<LobbyId, Record<string, PatternRow>> = {
  claw_machine: {
    cm_grab: { cd: 10, first: 4, parts: [['ring', 1.2], ['circle', 1.9]] },
    cm_prizes: { cd: 15, first: 7, parts: [['circle', 0]] },
    cm_coins: { cd: 8, first: 9, parts: [['circle', 1], ['circle', 1.3], ['circle', 1.6]] },
    cm_triple: { cd: 12, first: 1.5, parts: [['circle', 1.3], ['circle', 1.6], ['circle', 1.9]] },
  },
  washer_drum: {
    wd_spin: { cd: 12, first: 4, parts: [['ring', 1.4], ['ring', 1.8], ['ring', 2.2]] },
    wd_suds: { cd: 10, first: 7, parts: [['circle', 0.9]] },
    wd_socks: { cd: 14, first: 9, parts: [['circle', 0]] },
    wd_spin_back: { cd: 12, first: 1.5, parts: [['ring', 1.2], ['ring', 1.5], ['ring', 1.8]] },
  },
  karaoke_room: {
    kr_high_note: { cd: 12, first: 4, parts: [['fan', 1.5], ['circle', 1.6]] },
    kr_beat: { cd: 9, first: 7, parts: [['circle', 1.2], ['circle', 1.7], ['circle', 2.2]] },
    kr_tambourine: { cd: 8, first: 9, parts: [['ring', 1.1]] },
    kr_sing_along: { cd: 13, first: 1.5, parts: [['fan', 1.2], ['fan', 1.5], ['fan', 1.8]] },
  },
  reverse_escalator: {
    re_run: { cd: 13, first: 4, parts: [['rect', 1.4], ['rect', 1.75], ['rect', 2.1], ['rect', 2.45], ['rect', 2.8]] },
    re_handrail: { cd: 10, first: 7, parts: [['ring', 1.3]] },
    re_stop: { cd: 9, first: 10, parts: [['circle', 1.3]] },
    re_run_fast: { cd: 13, first: 1.5, parts: [['rect', 1.2], ['rect', 1.45], ['rect', 1.7], ['rect', 1.95], ['rect', 2.2]] },
  },
};

const CALM: Partial<Tunables> = { invincible: true, bossGroggyThreshold: 0 };
/** 기획 19차 보스 튜닝: the two knob corners every boss must still work under (slow and small · fast and big). */
const KNOBS: Partial<Tunables>[] = [
  { bossTelegraphMult: 2, bossAreaMult: 0.5 },
  { bossTelegraphMult: 0.5, bossAreaMult: 2 },
];
const BOT_PARTY: PlayerSetup[] = [{ ...HUMAN, isBot: true }, BOT1, BOT2];

type Cast = Extract<GameEvent, { type: 'skillCast' }>;
type Damage = Extract<GameEvent, { type: 'damage' }>;

/** A raid fight against `id` whose boss casts nothing by itself (huge HP pool): the test casts its patterns by hand. */
function quiet(id: LobbyId, players: PlayerSetup[] = [HUMAN], tunables: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 200, players, tunables });
  const b = bossOf(tg);
  b.rt.skills = [];
  b.rt.skillCds = [];
  b.rt.phase = 99; // no phase skills either
  b.rt.attackCd = 1e9; // …and no basic shots: every hit on the party is the pattern under test
  advance(tg, 0.2);
  clearEvents(tg);
  return tg;
}

/** Cast one whole pattern (every part) of the boss at `target`, now. */
function castPattern(tg: TestGame, skillId: string, target: SimEntity): void {
  const b = bossOf(tg);
  const sk = allSkills(getBoss(b.defId)).find(s => s.id === skillId);
  if (!sk) throw new Error(`no skill ${skillId}`);
  b.targetId = target.id;
  const ctx = unitCtx(tg.w, b, sk.id, sk.name);
  partsOf(sk).forEach((a, i) => startAction(tg.w, ctx, a, undefined, i));
}

/** Hold a character still at a spot (it no longer walks; pulls and knock-backs still move it). */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 999;
}

/** Tick until `e` is displaced; returns where it was put (units push apart only on the next tick). */
function whereMoved(tg: TestGame, e: SimEntity, maxSec = 3): Vec2 {
  const from = { ...e.pos };
  for (let t = 0; t < maxSec * 30; t++) {
    tick(tg.w);
    if (Math.hypot(e.pos.x - from.x, e.pos.y - from.y) > 1e-6) return { ...e.pos };
  }
  throw new Error('never moved');
}

/** Pattern hits `e` took so far (a `quiet` boss fires no basic shots). */
function patternHits(tg: TestGame, e: SimEntity): Damage[] {
  return eventsOf(tg, 'damage').filter(d => d.targetId === e.id);
}

/** Round to 3 decimals (offsets are sums of floats). */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The boss's casts in a calm fight (party invincible, no groggy), with the time of each. */
function castLog(id: LobbyId, seconds: number, prepare?: (tg: TestGame) => void): { at: number; ev: Cast; telegraphs: number }[] {
  const tg = raidGame(id, { hpMult: 50, tunables: CALM });
  prepare?.(tg);
  const boss = tg.w.state.bossId;
  const log: { at: number; ev: Cast; telegraphs: number }[] = [];
  for (let t = 0; t < seconds * 30; t++) {
    tick(tg.w);
    for (const ev of tg.game.drainEvents()) {
      if (ev.type === 'skillCast' && ev.sourceId === boss) log.push({ at: tg.w.state.time, ev, telegraphs: tg.w.state.telegraphs.length });
    }
  }
  return log;
}

describe('로비·상가: the zone table', () => {
  it('five bosses — the classic one first and untouched, then the four new ones — all in BOSSES with zone lobby', () => {
    expect(ZONE_BOSSES.lobby).toHaveLength(5);
    expect([...ZONE_BOSSES.lobby].sort()).toEqual([...NEW_IDS, 'elevator_keeper'].sort());
    expect(LOBBY_BOSSES.map(b => b.id)).toEqual(['elevator_keeper', ...NEW_IDS]);
    for (const id of ZONE_BOSSES.lobby) {
      const def = BOSSES.find(b => b.id === id);
      expect(def, id).toBeDefined();
      expect(def!.zone).toBe('lobby');
    }
    const classic = getBoss('elevator_keeper');
    expect(classic.stats.maxHp).toBe(8500);
    expect(classic.skills.map(s => s.id)).toEqual(['ek_doors', 'ek_summon', 'ek_counter']);
    expect(classic.phases).toHaveLength(1);
  });

  it.each(NEW_IDS)('%s: name, numbers, phase, groggy, enrage and band are the table rows', id => {
    const def = getBoss(id);
    const row = TABLE[id];
    expect(def.name).toBe(row.name);
    expect(def.stats).toMatchObject({ maxHp: row.hp, atk: row.atk, atkSpeed: row.atkSpeed, def: 0.2, range: 40, moveSpeed: 0 });
    expect(def.groggy).toEqual({ threshold: row.groggy });
    expect(def.enrage).toEqual(ENRAGE);
    expect(ENRAGE).toEqual({ atkMult: 1.6, atkSpeedMult: 1.5, cooldownMult: 0.6, summonCountMult: 1.5 });
    const ph = def.phases![0];
    expect([ph.hpBelow, ph.name, ph.atkSpeedMult ?? 1, ph.cooldownMult ?? 1]).toEqual(row.phase);
    expect(BOSS_RAID_BAND[id]).toBe(row.band);
    expect(def.lore.length).toBeLessThanOrEqual(80);
    // every pattern: cooldown, first use, one part per warning with the table's shape and delay
    const rows = PATTERNS[id];
    expect(allSkills(def).map(s => s.id)).toEqual(Object.keys(rows));
    for (const sk of allSkills(def)) {
      expect([sk.cooldown, sk.initialDelay], sk.id).toEqual([rows[sk.id].cd, rows[sk.id].first]);
      expect(partsOf(sk).map(a => [a.area.shape, a.delay ?? 0]), sk.id).toEqual(rows[sk.id].parts);
    }
  });

  it('the two summon-only units: 뽑기 인형 and 외짝 양말, with the table numbers and a body to draw', () => {
    expect(LOBBY_UNITS.map(u => u.id)).toEqual(['prize_doll', 'lost_sock']);
    expect(getMonster('prize_doll')).toMatchObject({ name: '뽑기 인형', radius: 0.35, basic: { kind: 'melee' }, stats: { maxHp: 130, atk: 16, moveSpeed: 3 } });
    expect(getMonster('lost_sock')).toMatchObject({ name: '외짝 양말', radius: 0.3, basic: { kind: 'melee' }, stats: { maxHp: 90, atk: 14, moveSpeed: 4 } });
    for (const u of LOBBY_UNITS) expect(typeof MINION_LOOKS[u.look!]).toBe('function');
  });
});

describe.each(NEW_IDS)('%s', id => {
  const def = getBoss(id);
  const rows = PATTERNS[id];

  it('holds the shared boss contract (shape, every skill within 45 s, phase → phase skill, kill → clear, determinism)', () => {
    expectBossContract(id);
  });

  // 기획 19차 보스 튜닝: the same fights under the debug knobs — nothing in a pattern depends on the numbers as written
  it.each(KNOBS)('holds the same contract with 보스 예고 시간 ×$bossTelegraphMult and 보스 범위 크기 ×$bossAreaMult', knobs => {
    expectBossContract(id, knobs);
  });

  it('spawns as the floor boss and casts its three patterns in order, each part with the right warning shape and delay', () => {
    const tg = raidGame(id, { hpMult: 50, tunables: CALM });
    const b = bossOf(tg);
    expect(b.defId).toBe(id);
    expect(b.tier).toBe('boss');
    expect(tg.w.state.plan).toMatchObject({ kind: 'boss', bossId: id, theme: 'lobby' });

    const log = castLog(id, 13.5);
    const order = [...new Set(log.map(l => l.ev.skillId))];
    expect(order).toEqual(def.skills.map(s => s.id));
    for (const sk of def.skills) {
      const casts = log.filter(l => l.ev.skillId === sk.id);
      const first = casts.filter(l => l.at === casts[0].at);
      expect(first[0].at, `${sk.id} first use`).toBeGreaterThanOrEqual(rows[sk.id].first - 0.05);
      expect(first[0].at, `${sk.id} first use`).toBeLessThan(rows[sk.id].first + 1.5);
      expect(first.map(l => [l.ev.area.shape, l.ev.delay ?? 0]), sk.id).toEqual(rows[sk.id].parts);
      expect(first.every(l => l.ev.team === 'enemy')).toBe(true);
    }
    // the first pattern's warnings are on the field the moment it is cast: one telegraph per delayed part
    const opener = log.filter(l => l.ev.skillId === def.skills[0].id && l.at === log[0].at);
    expect(opener[opener.length - 1].telegraphs).toBe(rows[def.skills[0].id].parts.filter(p => p[1] > 0).length);
  });

  it('enters its phase exactly under the HP threshold, with the table multipliers, and then casts the phase pattern', () => {
    const tg = raidGame(id, { hpMult: 50, tunables: CALM });
    advance(tg, 1);
    clearEvents(tg);
    const b = bossOf(tg);
    const ph = def.phases![0];
    b.hp = ph.hpBelow * b.maxHp + 1;
    checkPhases(tg.w, b);
    expect(eventsOf(tg, 'bossPhase')).toHaveLength(0);
    expect(monsterCdMult(b)).toBe(1);
    const speed = effStats(tg.w, b).atkSpeed;
    crossPhase(tg);
    const ev = eventsOf(tg, 'bossPhase');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ entityId: b.id, phase: 2, name: TABLE[id].phase[1] });
    expect(effStats(tg.w, b).atkSpeed / speed).toBeCloseTo(TABLE[id].phase[2], 6);
    expect(monsterCdMult(b)).toBeCloseTo(TABLE[id].phase[3], 6);
    // the phase pattern comes 1.5 s later, with its own warning shapes
    const phaseId = ph.skills![0].id;
    const log = castLog(id, 6, g => {
      advance(g, 1);
      crossPhase(g);
    }).filter(l => l.ev.skillId === phaseId);
    expect(log.length).toBeGreaterThan(0);
    const first = log.filter(l => l.at === log[0].at);
    expect(first.map(l => [l.ev.area.shape, l.ev.delay ?? 0])).toEqual(rows[phaseId].parts);
    expect(first[0].at).toBeLessThan(1 + 1.5 + 1.5);
  });

  it('enrages when the floor time runs out: attack ×1.6, attack speed ×1.5, cooldowns ×0.6', () => {
    const tg = raidGame(id, { hpMult: 50, tunables: { ...CALM, bossFloorTime: 3 } });
    const b = bossOf(tg);
    advance(tg, 2.5);
    expect(tg.w.state.bossEnraged).toBe(false);
    const before = effStats(tg.w, b);
    advance(tg, 0.7);
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(b.enraged).toBe(true);
    expect(eventsOf(tg, 'enrage')).toHaveLength(1);
    const after = effStats(tg.w, b);
    expect(after.atk / before.atk).toBeCloseTo(1.6, 6);
    expect(after.atkSpeed / before.atkSpeed).toBeCloseTo(1.5, 6);
    expect(monsterCdMult(b)).toBeCloseTo(0.6, 6);
    expect(tg.w.state.phase, 'the fight goes on').toBe('combat');
  });

  it('has a groggy gauge scaled by its threshold; a break during a wind-up drops the parts that have not landed', () => {
    const tg = quiet(id);
    const b = bossOf(tg);
    expect(tg.w.state.bossGroggy, 'a groggy gauge').not.toBeNull();
    expect(groggyMax(tg.w)).toBeCloseTo(tg.w.tunables.bossGroggyThreshold * TABLE[id].groggy, 6);
    castPattern(tg, def.skills[0].id, active(tg));
    advance(tg, 0.5);
    expect(tg.w.state.telegraphs.length).toBeGreaterThan(0);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(tg, 0.1);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(eventsOf(tg, 'bossGroggy')).toHaveLength(1);
    expect(eventsOf(tg, 'interrupt').some(e => e.sourceId === b.id)).toBe(true);
    expect(tg.w.state.bossGroggy!.left).toBeGreaterThan(0);
  });
});

describe('인형 뽑기 기계 patterns', () => {
  it('cm_grab: the ring drags whoever stands around the target to the middle without hurting, then the claw lands there 0.7 s later', () => {
    const tg = quiet('claw_machine', [HUMAN, HUMAN2]);
    const a = active(tg, 0);
    const c = active(tg, 1);
    pin(a, { x: 12, y: 6 });
    pin(c, { x: 15, y: 6 });
    const t0 = tg.w.state.time;
    castPattern(tg, 'cm_grab', a);
    expect(tg.w.state.telegraphs.map(t => [t.area.shape, t.total])).toEqual([['ring', 1.2], ['circle', 1.9]]);
    expect(tg.w.state.telegraphs.map(t => t.center)).toEqual([{ x: 12, y: 6 }, { x: 12, y: 6 }]);
    const put = whereMoved(tg, c);
    expect(tg.w.state.time - t0).toBeGreaterThan(1.15);
    expect(tg.w.state.time - t0).toBeLessThan(1.3);
    expect(put.x).toBeCloseTo(12.5, 6); // 2.5 toward the middle
    expect(put.y).toBeCloseTo(6, 6);
    expect(a.pos).toEqual({ x: 12, y: 6 }); // the target stands in the hole of the ring
    expect(patternHits(tg, a)).toHaveLength(0);
    expect(patternHits(tg, c)).toHaveLength(0);
    // 0.7 s to swap out — then both stand inside the r 1.8 circle
    advance(tg, 0.6);
    expect(patternHits(tg, c)).toHaveLength(0);
    advance(tg, 0.2);
    expect(patternHits(tg, a)).toHaveLength(1);
    expect(patternHits(tg, c)).toHaveLength(1);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });

  it('cm_grab: someone who was outside the ring is neither dragged nor hit', () => {
    const tg = quiet('claw_machine', [HUMAN, HUMAN2]);
    const a = active(tg, 0);
    const far = active(tg, 1);
    pin(a, { x: 12, y: 6 });
    pin(far, { x: 17.2, y: 6 });
    castPattern(tg, 'cm_grab', a);
    advance(tg, 2.1);
    expect(far.pos).toEqual({ x: 17.2, y: 6 });
    expect(patternHits(tg, far)).toHaveLength(0);
    expect(patternHits(tg, a)).toHaveLength(1);
  });

  it('cm_coins drops three coins from above the target down onto it; cm_triple lands left → middle → right', () => {
    const tg = quiet('claw_machine');
    const me = active(tg);
    pin(me, { x: 12, y: 7 });
    castPattern(tg, 'cm_coins', me);
    expect(tg.w.state.telegraphs.map(t => [t.center.y, t.total])).toEqual([[3, 1], [5, 1.3], [7, 1.6]]);
    advance(tg, 1.2);
    expect(patternHits(tg, me)).toHaveLength(0); // the first coin falls 4 above it
    advance(tg, 0.2);
    expect(patternHits(tg, me)).toHaveLength(1); // the second (2 above, r 2) already reaches: standing still costs two coins
    advance(tg, 0.3);
    expect(patternHits(tg, me)).toHaveLength(2);
    castPattern(tg, 'cm_triple', me);
    expect(tg.w.state.telegraphs.map(t => [t.center.x, t.total])).toEqual([[8, 1.3], [12, 1.6], [16, 1.9]]);
  });

  it('cm_prizes pushes out 3–4 뽑기 인형 at the boss (5–6 once enraged)', () => {
    for (const seed of [3, 4, 5, 6]) {
      const tg = quiet('claw_machine', [HUMAN], { invincible: true });
      tg.w.rng.int(0, seed); // move the stream so the roll differs
      castPattern(tg, 'cm_prizes', active(tg));
      const dolls = tg.w.state.entities.filter(e => e.defId === 'prize_doll');
      expect(dolls.length).toBeGreaterThanOrEqual(3);
      expect(dolls.length).toBeLessThanOrEqual(4);
      expect(tg.w.state.telegraphs).toHaveLength(0);
      enrage(tg.w);
      castPattern(tg, 'cm_prizes', active(tg));
      const more = tg.w.state.entities.filter(e => e.defId === 'prize_doll').length - dolls.length;
      expect(more).toBeGreaterThanOrEqual(5);
      expect(more).toBeLessThanOrEqual(6);
    }
  });
});

describe('혼자 도는 세탁기 patterns', () => {
  it('wd_spin: three rings inside → out; each hits only its own band once, the bottom of the arena is out of reach', () => {
    const tg = quiet('washer_drum', [HUMAN, HUMAN2]);
    const near = active(tg, 0);
    const mid = active(tg, 1);
    pin(near, { x: 12, y: 2.3 }); // against the boss (3.5 from its middle): the first ring
    pin(mid, { x: 15, y: 4.85 }); // 6.75 from the boss: the second ring
    castPattern(tg, 'wd_spin', near);
    expect(tg.w.state.telegraphs.map(t => [t.area, t.total])).toEqual([
      [{ shape: 'ring', inner: 3, outer: 5.5 }, 1.4],
      [{ shape: 'ring', inner: 5.5, outer: 8 }, 1.8],
      [{ shape: 'ring', inner: 8, outer: 10.5 }, 2.2],
    ]);
    advance(tg, 1.5);
    expect(patternHits(tg, near)).toHaveLength(1);
    expect(patternHits(tg, mid)).toHaveLength(0);
    advance(tg, 0.4);
    expect(patternHits(tg, mid)).toHaveLength(1);
    advance(tg, 0.5);
    expect(patternHits(tg, near)).toHaveLength(1); // the ring that passed is safe ground
    expect(patternHits(tg, mid)).toHaveLength(1);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    // the third ring ends 10.5 from the boss: the bottom edge is never reached
    clearEvents(tg);
    pin(near, { x: 12, y: 8.1 }); // 9.3: the third ring
    pin(mid, { x: 12, y: 11.2 }); // 12.4
    castPattern(tg, 'wd_spin', near);
    advance(tg, 2.4);
    expect(patternHits(tg, near)).toHaveLength(1);
    expect(patternHits(tg, mid)).toHaveLength(0);
  });

  it('wd_spin_back runs the same rings outside → in, faster', () => {
    const tg = quiet('washer_drum');
    castPattern(tg, 'wd_spin_back', active(tg));
    expect(tg.w.state.telegraphs.map(t => [(t.area as { inner: number }).inner, t.total])).toEqual([[8, 1.2], [5.5, 1.5], [3, 1.8]]);
  });

  it('wd_suds leaves a foam puddle for 5 s that slows by 40 %', () => {
    const tg = quiet('washer_drum');
    const me = active(tg);
    pin(me, { x: 10, y: 7 });
    castPattern(tg, 'wd_suds', me);
    advance(tg, 1);
    expect(tg.w.state.zones).toHaveLength(1);
    expect(tg.w.state.zones[0]).toMatchObject({ center: { x: 10, y: 7 }, radius: 2.4 });
    advance(tg, 0.6);
    expect(statusValue(me, 'slow')).toBeCloseTo(0.4, 6);
    advance(tg, 3.5);
    expect(tg.w.state.zones).toHaveLength(1);
    advance(tg, 1);
    expect(tg.w.state.zones).toHaveLength(0);
  });

  it('wd_socks throws out 3–4 외짝 양말 (fast and frail)', () => {
    const tg = quiet('washer_drum', [HUMAN], { invincible: true });
    castPattern(tg, 'wd_socks', active(tg));
    const socks = tg.w.state.entities.filter(e => e.defId === 'lost_sock');
    expect(socks.length).toBeGreaterThanOrEqual(3);
    expect(socks.length).toBeLessThanOrEqual(4);
    expect(socks.every(s => s.team === 'enemy' && s.tier === 'normal')).toBe(true);
  });
});

describe('지하 7번 노래방 patterns', () => {
  it('kr_high_note: a fan at the target, then the interlude — the boss itself is vulnerable (+30 %) for 4 s (rule M1)', () => {
    const tg = quiet('karaoke_room');
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    const hit = (): number => {
      clearEvents(tg);
      applyDamage(tg.w, { casterId: null, team: 'ally', player: null, source: 'basic', isDrag: false }, b, 1000, false);
      return eventsOf(tg, 'damage').filter(d => d.targetId === b.id)[0].amount;
    };
    const plain = hit();
    castPattern(tg, 'kr_high_note', me);
    expect(tg.w.state.telegraphs.map(t => [t.area.shape, !!t.self, t.total])).toEqual([['fan', false, 1.5], ['circle', true, 1.6]]);
    advance(tg, 1.4);
    expect(hasStatus(b, 'vulnerable')).toBe(false);
    expect(patternHits(tg, me)).toHaveLength(0);
    advance(tg, 0.25);
    expect(patternHits(tg, me)).toHaveLength(1);
    expect(statusValue(b, 'vulnerable')).toBeCloseTo(0.3, 6);
    expect(hit() / plain).toBeCloseTo(1.3, 6);
    advance(tg, 3.7);
    expect(hasStatus(b, 'vulnerable')).toBe(true);
    advance(tg, 0.4);
    expect(hasStatus(b, 'vulnerable')).toBe(false);
    expect(hit()).toBeCloseTo(plain, 6);
  });

  it('kr_high_note: a groggy break during the note also cancels the interlude', () => {
    const tg = quiet('karaoke_room');
    const b = bossOf(tg);
    castPattern(tg, 'kr_high_note', active(tg));
    advance(tg, 1);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    advance(tg, 1.5);
    expect(hasStatus(b, 'vulnerable')).toBe(false);
  });

  it('kr_beat hits the same spot three times 0.5 s apart; kr_tambourine spares the middle and slows the ring by 30 %', () => {
    const tg = quiet('karaoke_room', [HUMAN, HUMAN2]);
    const a = active(tg, 0);
    const c = active(tg, 1);
    pin(a, { x: 8, y: 6 });
    pin(c, { x: 18, y: 8 });
    castPattern(tg, 'kr_beat', a);
    const seen: number[] = [];
    for (let t = 0; t < 30 * 2.6; t++) {
      tick(tg.w);
      const n = patternHits(tg, a).length;
      if (n > seen.length) seen.push(tg.w.state.time);
    }
    expect(seen).toHaveLength(3);
    expect(seen[1] - seen[0]).toBeCloseTo(0.5, 1);
    expect(seen[2] - seen[1]).toBeCloseTo(0.5, 1);
    // 기획 19차 review: every beat has its own warning on the cast-time spot — a target that leaves is not followed
    clearEvents(tg);
    castPattern(tg, 'kr_beat', a);
    expect(tg.w.state.telegraphs.filter(t => t.team === 'enemy').map(t => [t.center, t.total])).toEqual([[{ x: 8, y: 6 }, 1.2], [{ x: 8, y: 6 }, 1.7], [{ x: 8, y: 6 }, 2.2]]);
    advance(tg, 1.3);
    expect(patternHits(tg, a)).toHaveLength(1);
    pin(a, { x: 8, y: 11 }); // walked out after beat 1
    advance(tg, 1.1);
    expect(patternHits(tg, a)).toHaveLength(1);
    expect(tg.w.state.telegraphs.filter(t => t.team === 'enemy')).toHaveLength(0);
    pin(a, { x: 8, y: 6 });
    clearEvents(tg);
    pin(c, { x: 10.5, y: 6 }); // 2.5 from the target: on the ring
    castPattern(tg, 'kr_tambourine', a);
    advance(tg, 1.2);
    expect(patternHits(tg, a)).toHaveLength(0);
    expect(patternHits(tg, c)).toHaveLength(1);
    expect(statusValue(c, 'slow')).toBeCloseTo(0.3, 6);
    expect(hasStatus(a, 'slow')).toBe(false);
  });

  it('kr_sing_along: three narrow fans from the boss, aimed 4 left of, at, and 4 right of the target', () => {
    const tg = quiet('karaoke_room');
    const me = active(tg);
    pin(me, { x: 12, y: 8 });
    castPattern(tg, 'kr_sing_along', me);
    const tele = tg.w.state.telegraphs;
    expect(tele.map(t => [t.center.x, t.total])).toEqual([[8, 1.2], [12, 1.5], [16, 1.8]]);
    for (const t of tele) expect(t.origin).toEqual(bossOf(tg).pos);
    // only the middle fan covers the target; 4 to a side only that side's fan does; far out to the side is safe
    expect(tele.map(t => hitsArea(t.area, t.center, t.origin, me.pos, me.radius))).toEqual([false, true, false]);
    expect(tele.map(t => hitsArea(t.area, t.center, t.origin, { x: 16, y: 8 }, 0.3))).toEqual([false, false, true]);
    expect(tele.some(t => hitsArea(t.area, t.center, t.origin, { x: 1.5, y: 8 }, 0.3))).toBe(false);
  });
});

describe('거꾸로 가는 에스컬레이터 patterns', () => {
  it('re_run: five rows sweep down; a hit shoves 1.5 down into the next row, which hits again', () => {
    const tg = quiet('reverse_escalator');
    const me = active(tg);
    pin(me, { x: 9, y: 1.2 });
    castPattern(tg, 're_run', me);
    const tele = tg.w.state.telegraphs;
    expect(tele).toHaveLength(5);
    expect(tele.map(t => [t.center.x, r3(t.center.y), t.total])).toEqual([[0, 1.25, 1.4], [0, 3.75, 1.75], [0, 6.25, 2.1], [0, 8.75, 2.45], [0, 11.25, 2.8]]);
    for (const t of tele) expect(t.area).toEqual({ shape: 'rect', length: 24, width: 2.5, dir: 'right' });
    advance(tg, 1.45);
    expect(patternHits(tg, me)).toHaveLength(1);
    expect(me.pos.x).toBeCloseTo(9, 6);
    expect(me.pos.y).toBeCloseTo(2.7, 6); // now inside the second row (2.5–5)
    advance(tg, 0.35);
    expect(patternHits(tg, me)).toHaveLength(2);
    expect(me.pos.y).toBeCloseTo(4.2, 6);
    advance(tg, 1.2); // the third row (5–7.5) passes under its feet
    expect(patternHits(tg, me)).toHaveLength(2);
    expect(me.pos.y).toBeCloseTo(4.2, 6);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });

  it('re_run: the bottom row cannot push anyone out of the arena; re_run_fast is the same sweep, 0.25 s apart', () => {
    const tg = quiet('reverse_escalator');
    const me = active(tg);
    pin(me, { x: 15, y: 11 });
    castPattern(tg, 're_run', me);
    advance(tg, 2.9);
    expect(patternHits(tg, me)).toHaveLength(1);
    expect(me.pos.y).toBeGreaterThan(11);
    expect(me.pos.y).toBeLessThanOrEqual(12);
    castPattern(tg, 're_run_fast', me);
    expect(tg.w.state.telegraphs.map(t => [r3(t.center.y), t.total])).toEqual([[1.25, 1.2], [3.75, 1.45], [6.25, 1.7], [8.75, 1.95], [11.25, 2.2]]);
  });

  it('re_handrail: the far band (8–12 from the boss) is dragged 3 toward it and hit; closer in nothing happens', () => {
    const tg = quiet('reverse_escalator', [HUMAN, HUMAN2]);
    const far = active(tg, 0);
    const close = active(tg, 1);
    pin(far, { x: 12, y: 9.3 }); // 10.5 from the boss
    pin(close, { x: 12, y: 4 }); // 5.2
    castPattern(tg, 're_handrail', far);
    const put = whereMoved(tg, far);
    expect(put.x).toBeCloseTo(12, 6);
    expect(put.y).toBeCloseTo(6.3, 6);
    expect(patternHits(tg, far)).toHaveLength(1);
    expect(close.pos).toEqual({ x: 12, y: 4 });
    expect(patternHits(tg, close)).toHaveLength(0);
  });

  it('re_stop stuns for 0.5 s', () => {
    const tg = quiet('reverse_escalator');
    const me = active(tg);
    pin(me, { x: 14, y: 6 });
    castPattern(tg, 're_stop', me);
    advance(tg, 1.25);
    expect(hasStatus(me, 'stun')).toBe(false);
    advance(tg, 0.1);
    expect(hasStatus(me, 'stun')).toBe(true);
    expect(patternHits(tg, me)).toHaveLength(1);
    advance(tg, 0.6);
    expect(hasStatus(me, 'stun')).toBe(false);
  });
});

describe('보스 튜닝 knobs on the lobby patterns (기획 19차: retuning must be cheap)', () => {
  it('예고 ×2 doubles every warning and the gaps of a sweep; the hit interval and the status length stay', () => {
    const tg = quiet('reverse_escalator', [HUMAN], { bossTelegraphMult: 2 });
    castPattern(tg, 're_run', active(tg));
    // 1.4 / 1.75 / 2.1 / 2.45 / 2.8 → the same rows, twice as late, 0.7 s apart
    expect(tg.w.state.telegraphs.map(t => [r3(t.center.y), r3(t.total)])).toEqual([[1.25, 2.8], [3.75, 3.5], [6.25, 4.2], [8.75, 4.9], [11.25, 5.6]]);

    const kr = quiet('karaoke_room', [HUMAN], { bossTelegraphMult: 2 });
    const b = bossOf(kr);
    const me = active(kr);
    pin(me, { x: 12, y: 6 });
    castPattern(kr, 'kr_high_note', me);
    expect(kr.w.state.telegraphs.map(t => [t.area.shape, !!t.self, r3(t.total)])).toEqual([['fan', false, 3], ['circle', true, 3.2]]);
    advance(kr, 3.1);
    expect(hasStatus(b, 'vulnerable'), 'the interlude waits for the longer note').toBe(false);
    advance(kr, 0.2);
    expect(statusValue(b, 'vulnerable')).toBeCloseTo(0.3, 6);
    advance(kr, 3.7);
    expect(hasStatus(b, 'vulnerable'), 'still 4 s long').toBe(true);
    advance(kr, 0.4);
    expect(hasStatus(b, 'vulnerable')).toBe(false);
    // kr_beat (three parts since the review): the first beat lands at 2.4 s and the gaps double too (1 s apart)
    clearEvents(kr);
    const t0 = kr.w.state.time;
    castPattern(kr, 'kr_beat', me);
    const seen: number[] = [];
    for (let t = 0; t < 30 * 4.8; t++) {
      tick(kr.w);
      if (patternHits(kr, me).length > seen.length) seen.push(kr.w.state.time - t0);
    }
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBeCloseTo(2.4, 1);
    expect(seen[1] - seen[0]).toBeCloseTo(1, 1);
    expect(seen[2] - seen[1]).toBeCloseTo(1, 1);
  });

  it('예고 ×0.5 halves them: the claw still lands after the drag, 0.35 s later instead of 0.7', () => {
    const tg = quiet('claw_machine', [HUMAN], { bossTelegraphMult: 0.5 });
    castPattern(tg, 'cm_grab', active(tg));
    expect(tg.w.state.telegraphs.map(t => [t.area.shape, r3(t.total)])).toEqual([['ring', 0.6], ['circle', 0.95]]);
  });

  it('범위 ×2 / ×0.5 resize every footprint where it stands: ring holes and part offsets are kept', () => {
    const big = quiet('washer_drum', [HUMAN], { invincible: true, bossAreaMult: 2 });
    const me = active(big);
    pin(me, { x: 10, y: 7 });
    castPattern(big, 'wd_spin', me);
    expect(big.w.state.telegraphs.map(t => t.area)).toEqual([
      { shape: 'ring', inner: 3, outer: 11 },
      { shape: 'ring', inner: 5.5, outer: 16 },
      { shape: 'ring', inner: 8, outer: 21 },
    ]);
    expect(big.w.state.telegraphs.every(t => t.total === 1.4 || t.total === 1.8 || t.total === 2.2), 'the timing is untouched').toBe(true);
    advance(big, 2.4);
    // the foam puddle that stays behind is as big as its warning, and still lasts 5 s
    castPattern(big, 'wd_suds', me);
    advance(big, 1);
    expect(big.w.state.zones).toHaveLength(1);
    expect(big.w.state.zones[0]).toMatchObject({ center: { x: 10, y: 7 }, radius: 4.8 });
    advance(big, 4.1);
    expect(big.w.state.zones).toHaveLength(1);
    advance(big, 1);
    expect(big.w.state.zones).toHaveLength(0);

    const small = quiet('claw_machine', [HUMAN], { bossAreaMult: 0.5 });
    const you = active(small);
    pin(you, { x: 12, y: 7 });
    castPattern(small, 'cm_grab', you);
    expect(small.w.state.telegraphs.map(t => t.area)).toEqual([{ shape: 'ring', inner: 1.6, outer: 2.25 }, { shape: 'circle', radius: 0.9 }]);
    advance(small, 2);
    castPattern(small, 'cm_coins', you);
    // the coins fall on the same three spots, each half as wide
    expect(small.w.state.telegraphs.map(t => [t.center.y, t.area])).toEqual([[3, { shape: 'circle', radius: 1 }], [5, { shape: 'circle', radius: 1 }], [7, { shape: 'circle', radius: 1 }]]);

    const stairs = quiet('reverse_escalator', [HUMAN], { bossAreaMult: 0.5 });
    castPattern(stairs, 're_run', active(stairs));
    // the rows keep their places and get thinner (gaps open between them) — and shorter: a band scales both ways, so
    // at ×0.5 the right half of the arena is out of reach (the existing scaleArea rule, see docs/bosses.md 3장)
    expect(stairs.w.state.telegraphs.map(t => [r3(t.center.y), t.area])).toEqual(
      [1.25, 3.75, 6.25, 8.75, 11.25].map(y => [y, { shape: 'rect', length: 12, width: 1.25, dir: 'right' }]),
    );
  });

  it('neither knob touches the summons: 뽑기 인형 and 외짝 양말 keep their numbers', () => {
    const tg = quiet('claw_machine', [HUMAN], { invincible: true, bossTelegraphMult: 2, bossAreaMult: 2, bossRaidAtkMult: 3 });
    castPattern(tg, 'cm_prizes', active(tg));
    const dolls = tg.w.state.entities.filter(e => e.defId === 'prize_doll');
    expect(dolls.length).toBeGreaterThanOrEqual(3);
    expect(dolls.length).toBeLessThanOrEqual(4);
    const plain = quiet('claw_machine', [HUMAN], { invincible: true });
    castPattern(plain, 'cm_prizes', active(plain));
    const ref = plain.w.state.entities.find(e => e.defId === 'prize_doll')!;
    for (const d of dolls) {
      expect(d.maxHp).toBe(ref.maxHp);
      expect(effStats(tg.w, d).atk).toBe(effStats(plain.w, ref).atk);
      expect(d.radius).toBe(ref.radius);
    }
  });
});

/** A whole fight of three bot seats against `id` on floor 1 with the real raid HP knob. */
function botFight(id: LobbyId, seed: number): { cleared: boolean; seconds: number; enraged: boolean; phase2: boolean } {
  const tg = raidGame(id, { seed, players: BOT_PARTY });
  let enraged = false;
  let cleared = false;
  let phase2 = false;
  let t = 0;
  // bots pick their reward at once and walk on to floor 2, so stop at the first clear (or the wipe)
  for (; t < 30 * 240 && !cleared && tg.w.state.phase === 'combat'; t++) {
    tick(tg.w);
    for (const ev of tg.game.drainEvents()) {
      if (ev.type === 'enrage') enraged = true;
      if (ev.type === 'bossPhase') phase2 = true;
      if (ev.type === 'floorClear') cleared = true;
    }
  }
  return { cleared, seconds: t / 30, enraged, phase2 };
}

describe('a bots-only fight (1 seat + 2 bots, raid HP ×0.8, floor 1)', () => {
  const SEEDS = [11, 23, 37, 41, 59, 67, 73, 89];

  it.each(NEW_IDS)('%s: most of 8 seeded fights end in a kill before the enrage; the same seed gives the same fight', id => {
    const runs = SEEDS.map(seed => botFight(id, seed));
    const inTime = runs.filter(r => r.cleared && !r.enraged).length;
    expect(inTime, `${id}: kills before the enrage (${runs.map(r => `${r.cleared ? 'kill' : 'wipe'} ${Math.round(r.seconds)}s`).join(', ')})`).toBeGreaterThanOrEqual(6);
    for (const r of runs) {
      expect(r.seconds, 'a real fight, not a one-shot').toBeGreaterThan(15);
      expect(r.seconds, 'no endless fight').toBeLessThan(200);
      if (r.cleared) expect(r.phase2, 'the phase was seen on the way').toBe(true);
    }
    expect(botFight(id, SEEDS[0])).toEqual(runs[0]);
  }, 120_000);
});

describe('looks and voices of the four', () => {
  /** A 2D context that accepts everything (property sets are kept, calls are counted). */
  function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: () => number } {
    let n = 0;
    const store: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(store, {
      get: (t, p) => (p in t ? t[p] : () => void n++),
      set: (t, p, v) => ((t[p] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls: () => n };
  }
  const BASE: BossDrawOpts = { color: '#888888', time: 2.4, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: Partial<BossDrawOpts>[] = [{}, { charge: 0.6 }, { charge: 1, flash: 1 }, { groggy: 1 }, { groggy: 0.4, groggyWake: 0.5 }, { phase: 2, phaseFlash: 0.6 }, { enraged: true, shake: 0.5 }, { lookX: null, lookY: null }, { retreat: 0.5 }];

  it.each(NEW_IDS)('%s: a registered look that draws every pose, its own colour, a voice row with the table kinds', id => {
    const look = bossLook(id);
    expect(look, 'registered').toBeDefined();
    expect(look!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(typeof look!.props).toBe('function');
    const cam = new Camera();
    cam.setArena(24, 12);
    for (const pose of POSES) {
      const f = fakeCtx();
      expect(() => drawBossArt(f.ctx, cam, id, 12, -1.2, 3, { ...BASE, ...pose })).not.toThrow();
      expect(f.calls()).toBeGreaterThan(40);
    }
    const gone = fakeCtx();
    look!.draw(gone.ctx, cam, 12, -1.2, 3, { ...BASE, retreat: 1 });
    expect(gone.calls()).toBe(0);
    const voice = BOSS_VOICE[id];
    expect(voice.base).toBeGreaterThanOrEqual(90);
    expect(voice.base).toBeLessThanOrEqual(135);
    expect(Object.keys(voice.kinds)).toEqual(Object.keys(PATTERNS[id]));
  });

  it('the four looks are four different colours; voices and warning motifs are the rows of docs/bosses.md', () => {
    expect(new Set(NEW_IDS.map(id => bossLook(id)!.color)).size).toBe(4);
    expect(NEW_IDS.map(id => [BOSS_VOICE[id].base, BOSS_VOICE[id].motif, BOSS_VOICE[id].timbre])).toEqual([
      [123.5, [0, 4, 7], 'clatter'],
      [110, [0, 0, -2], 'water'],
      [130.8, [0, 5, 7, 5], 'bell'],
      [92.5, [0, -1, -2, -3], 'steps'],
    ]);
    expect(BOSS_VOICE.claw_machine.kinds).toEqual({ cm_grab: 'tentacle', cm_prizes: 'summon', cm_coins: 'countdown', cm_triple: 'chime' });
    expect(BOSS_VOICE.washer_drum.kinds).toEqual({ wd_spin: 'ring', wd_suds: 'water', wd_socks: 'summon', wd_spin_back: 'ring' });
    expect(BOSS_VOICE.karaoke_room.kinds).toEqual({ kr_high_note: 'chime', kr_beat: 'countdown', kr_tambourine: 'ring', kr_sing_along: 'chime' });
    expect(BOSS_VOICE.reverse_escalator.kinds).toEqual({ re_run: 'doors', re_handrail: 'tentacle', re_stop: 'stamp', re_run_fast: 'doors' });
    const mine = Object.fromEntries(Object.entries(BOSS_TELE_MOTIF).filter(([k]) => /^(cm|wd|kr|re)_/.test(k)));
    expect(mine).toEqual({ cm_grab: 'pull', cm_prizes: 'spawn', wd_suds: 'linger', wd_socks: 'spawn', re_run: 'push', re_run_fast: 'push', re_handrail: 'pull' });
  });
});
