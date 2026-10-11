// 기획 19차 보스 레이드: helpers of the boss tests (tests/sim/boss-*.test.ts, tests/sim/bosses-<zone>.test.ts).
//   raidGame(bossId, opts)   a raid game with that boss on every floor (BossRaidSetup.onlyBoss)
//   bossOf(tg)               the boss entity
//   expectBossContract(id)   what every NEW boss must hold: data shape, every base skill cast within 45 s, the phase
//                            event at its threshold then the phase skill, kill → floor clear, same seed → same digest
//   expectBossContract(id, { bossTelegraphMult: 2, bossAreaMult: 0.5 })   the same fights under the debug knobs
//                            (docs/boss-raid.md 4-2): the patterns must not depend on the numbers as written
import { expect } from 'vitest';
import { BOSS_IDS, BOSS_RAID, ZONE_BOSSES, getBoss, getMonster } from '../../src/data';
import { ENRAGE } from '../../src/data/bosses';
import { applyDamage } from '../../src/sim/combat';
import { tick } from '../../src/sim/game';
import { checkPhases } from '../../src/sim/phases';
import type { SimEntity } from '../../src/sim/world';
import type { BossDef, GameEvent, MonsterSkill, PlayerSetup, SkillAction, Tunables } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, clearEvents, drain, makeGame, type TestGame } from './helpers';

export interface RaidOpts {
  seed?: number;
  /** Start floor (default 1). */
  floor?: number;
  /** Boss HP × this instead of BOSS_RAID.hpMult (a big value keeps the boss alive for a pattern test). */
  hpMult?: number;
  players?: PlayerSetup[];
  tunables?: Partial<Tunables>;
}

/**
 * A boss raid game with `bossId` on every floor. Default: one human seat (no bot swaps), 괴담 rooms off, and the raid
 * attack knob at 1 — the pattern tests read each boss's numbers as written in its data file (the mode's default knobs,
 * BOSS_RAID.hpMult / atkMult / finalAtkMult, are checked in boss-raid.test.ts).
 */
export function raidGame(bossId: string, opts: RaidOpts = {}): TestGame {
  return makeGame({
    seed: opts.seed ?? 19,
    players: opts.players ?? [HUMAN],
    tunables: { bossRaidAtkMult: 1, ...opts.tunables },
    startFloor: opts.floor,
    mode: 'bossRaid',
    bossRaid: { onlyBoss: bossId, ...(opts.hpMult != null ? { hpMult: opts.hpMult } : null) },
  });
}

/** The boss entity of the floor (throws without one). */
export function bossOf(tg: TestGame): SimEntity {
  const s = tg.w.state;
  const e = s.entities.find(x => x.id === s.bossId && !x.rt.gone);
  if (!e) throw new Error('no boss on this floor');
  return e;
}

/** Every part of a skill. */
export function partsOf(sk: MonsterSkill): SkillAction[] {
  return [sk.action, ...(sk.extra ?? [])];
}

/** Base skills + phase skills of a boss. */
export function allSkills(def: BossDef): MonsterSkill[] {
  return [...def.skills, ...(def.phases ?? []).flatMap(p => p.skills ?? [])];
}

/** Skill ids the boss cast so far (its 'skillCast' events). */
export function castIds(tg: TestGame): Set<string> {
  const boss = tg.w.state.bossId;
  return new Set(drain(tg).filter((e): e is Extract<GameEvent, { type: 'skillCast' }> => e.type === 'skillCast' && e.sourceId === boss).map(e => e.skillId));
}

/** Kill the boss with one huge hit (→ retreat → floor clear on the next tick). */
export function killBoss(tg: TestGame): void {
  const b = bossOf(tg);
  b.invulnTime = 0;
  b.shield = 0;
  applyDamage(tg.w, { casterId: null, team: 'ally', player: null, source: 'basic', isDrag: false }, b, 1e12, false);
}

/** Put the boss just under its first phase threshold and run the phase check (as a hit would). */
export function crossPhase(tg: TestGame, index = 0): void {
  const b = bossOf(tg);
  const ph = getBoss(b.defId).phases![index];
  b.hp = ph.hpBelow * b.maxHp - 1;
  checkPhases(tg.w, b);
}

const pub = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'rt' ? undefined : x));

/** A digest of a bots-only raid fight against `bossId`: the public state every 10 ticks, for `seconds`. */
export function raidDigest(bossId: string, seed: number, seconds = 25, tunables?: Partial<Tunables>): string {
  const tg = raidGame(bossId, { seed, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2], tunables });
  let h = 2166136261;
  for (let t = 0; t < seconds * 30 && tg.w.state.phase === 'combat'; t++) {
    tick(tg.w);
    if (t % 10 !== 0) continue;
    const s = pub(tg.w.state);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return `${h}:${tg.w.state.tick}`;
}

const KOREAN = /[가-힣]/;

/** Data shape every NEW boss holds (docs/bosses.md 1장). The classic four are checked by tests/sim/boss-roster.test.ts. */
function expectShape(def: BossDef): void {
  const id = def.id;
  expect(BOSS_IDS, `${id} is a new boss`).not.toContain(id);
  expect(def.tier).toBe('boss');
  expect(def.radius).toBe(3);
  expect(def.stationary).toBe(true);
  expect(def.look, 'look = the boss id').toBe(id);
  expect(def.stats.def).toBe(0.2);
  expect(def.stats.range).toBe(40);
  expect(def.stats.moveSpeed).toBe(0);
  expect(def.stats.maxHp).toBeGreaterThanOrEqual(6000);
  expect(def.stats.maxHp).toBeLessThanOrEqual(10200);
  expect(def.basic).toEqual({ kind: 'projectile', speed: 11 });
  expect(KOREAN.test(def.name), 'Korean name').toBe(true);
  expect(def.lore.length, 'a one-line 괴담').toBeGreaterThan(8);
  expect(ZONE_BOSSES[def.zone], `${id} is in its zone's table`).toContain(id);
  expect(def.enrage).toEqual(ENRAGE);
  expect(def.groggy?.threshold ?? 0).toBeGreaterThanOrEqual(0.8);
  expect(def.groggy?.threshold ?? 0).toBeLessThanOrEqual(1.1);
  expect(def.skills).toHaveLength(3);
  expect(def.phases, 'exactly one HP phase').toHaveLength(1);
  const ph = def.phases![0];
  expect(KOREAN.test(ph.name ?? ''), 'Korean phase name').toBe(true);
  expect(ph.hpBelow).toBeGreaterThanOrEqual(0.4);
  expect(ph.hpBelow).toBeLessThanOrEqual(0.6);
  expect(ph.skills, 'one added skill').toHaveLength(1);
  const prefix = def.skills[0].id.split('_')[0];
  expect(prefix, 'two-letter skill prefix').toHaveLength(2);
  for (const sk of allSkills(def)) {
    expect(sk.id.startsWith(`${prefix}_`), `${sk.id} has the boss prefix`).toBe(true);
    expect(KOREAN.test(sk.name), `${sk.id} has a Korean name`).toBe(true);
    expect(sk.cooldown).toBeGreaterThanOrEqual(7);
    for (const a of partsOf(sk)) {
      if (a.summon) expect(() => getMonster(a.summon!.unitId), `${sk.id} summons a known unit`).not.toThrow();
      // one part = one hit: a later hit of a multi-hit part re-aims with no warning (use helpers.ts repeat)
      expect(a.hits ?? 1, `${sk.id}: no multi-hit part on a boss`).toBe(1);
      if (a.delay != null) expect(a.delay, `${sk.id}: a warning of at least 0.8 s`).toBeGreaterThanOrEqual(0.8);
      if (a.telegraphLead != null) expect(a.telegraphLead, `${sk.id}: a short warning is still ≥ 0.9 s (M2)`).toBeGreaterThanOrEqual(0.9);
      // every hit on the party is warned
      if (a.affects === 'enemies' && a.effects.length > 0) expect(a.delay ?? 0, `${sk.id}: a hit has a warning`).toBeGreaterThan(0);
    }
  }
}

/**
 * The whole contract of one new boss (see the header). `tunables` = debug knobs to run the same fights under
 * (기획 19차 보스 튜닝: { bossTelegraphMult, bossAreaMult }); the data shape is checked as written either way.
 */
export function expectBossContract(id: string, tunables: Partial<Tunables> = {}): void {
  const def = getBoss(id);
  expectShape(def);

  // every base skill within 45 s (party invincible, boss kept alive, no groggy in the way)
  const calm: Partial<Tunables> = { invincible: true, bossGroggyThreshold: 0, ...tunables };
  const a = raidGame(id, { hpMult: 50, tunables: calm });
  expect(a.w.state.plan.bossId).toBe(id);
  expect(a.w.state.plan.kind).toBe('boss');
  advance(a, 45);
  const cast = castIds(a);
  for (const sk of def.skills) expect(cast.has(sk.id), `${sk.id} cast within 45 s`).toBe(true);
  expect(a.w.state.phase, 'still fighting').toBe('combat');

  // the phase event at its threshold, then the phase skill
  const b = raidGame(id, { hpMult: 50, tunables: calm });
  advance(b, 1);
  clearEvents(b);
  crossPhase(b);
  const ev = drain(b).filter((e): e is Extract<GameEvent, { type: 'bossPhase' }> => e.type === 'bossPhase');
  expect(ev).toHaveLength(1);
  expect(ev[0].phase).toBe(2);
  expect(ev[0].name).toBe(def.phases![0].name);
  advance(b, 12);
  expect(castIds(b).has(def.phases![0].skills![0].id), 'the phase skill is cast').toBe(true);

  // kill → retreat → floor clear (floor 1: a normal floor reward for the human)
  const c = raidGame(id, { tunables });
  advance(c, 0.5);
  killBoss(c);
  advance(c, 0.2);
  const types = drain(c).map(e => e.type);
  expect(types).toContain('bossRetreat');
  expect(types).toContain('floorClear');
  expect(c.w.state.phase).toBe('reward');
  expect(c.w.state.entities.some(e => e.team === 'enemy')).toBe(false);

  // same seed → same fight
  expect(raidDigest(id, 7, 25, tunables)).toBe(raidDigest(id, 7, 25, tunables));
}

export { BOSS_RAID };
