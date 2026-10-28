// 기획 19차 보스 레이드 (docs/boss-raid.md): the classic tower's flow with a boss on every floor. Pure helpers only —
// the boss order comes from the run seed on its own streams (never the run rng), so the server, the HUD and the result
// screen can all compute it again. floor.ts picks planBossRaidFloor when World.bossRaid is set; planFloor is untouched.

import type { BossDef, BossRaidSetup, FloorPlan, FloorTheme, RaidMode, Tunables } from '../types';
import { ARENA_BOSS, ZONES, floorStatMult } from '../config';
import { BOSSES, BOSS_RAID, BOSS_RAID_BAND, RAID_ZONES, ZONE_BOSSES, ZONE_CLASSIC_BOSS } from '../data';
import { Rng, mixSeed } from './rng';

/** Salt of the order streams: one per zone, mixSeed(seed, ORDER_SALT, zone index). */
const ORDER_SALT = 0xb055;

/**
 * World.bossRaid: the run's boss order (floor n → order[(n − 1) % length]; debug 「보스 고르기」 rewrites one slot) and the
 * bench's fixed boss HP knob (BossRaidSetup.hpMult; absent = Tunables.bossRaidHpMult, read at each floor start).
 */
export interface BossRaidRt {
  order: string[];
  hpMult?: number;
}

const DEFS: ReadonlyMap<string, BossDef> = new Map(BOSSES.map(b => [b.id, b]));

/** Is this boss's data registered (src/data/bosses)? */
export function hasBossData(id: string): boolean {
  return DEFS.has(id);
}

/**
 * Is the boss in the raid (docs/boss-raid.md 3-1)? Out = `raid: false` on its data, listed in `off` (BossRaidSetup.off,
 * the bench's OFF=), or no data at all. The classic tower never asks.
 */
export function isRaidBossOn(id: string, off?: readonly string[]): boolean {
  const def = DEFS.get(id);
  return !!def && def.raid !== false && !off?.includes(id);
}

/**
 * The bosses of a zone that come in a run, in table order (ZONE_BOSSES). A zone with every boss off still gets its
 * classic boss, so no zone is ever empty.
 */
export function raidRoster(zone: FloorTheme, off?: readonly string[]): string[] {
  const on = ZONE_BOSSES[zone].filter(id => isRaidBossOn(id, off));
  return on.length > 0 ? on : [ZONE_CLASSIC_BOSS[zone]];
}

/** Every boss of a run, zone by zone (the main card's 「보스 N종」 = its length; 20 with everything on). */
export function raidRosterIds(off?: readonly string[]): string[] {
  return RAID_ZONES.flatMap(z => raidRoster(z, off));
}

function shuffle(rng: Rng, list: string[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
}

/** A 'late' boss never opens a zone: swap it with the first boss that is not late (all late → left as is). */
function keepLateOffFirst(ids: string[]): void {
  if (BOSS_RAID_BAND[ids[0]] !== 'late') return;
  const j = ids.findIndex(id => BOSS_RAID_BAND[id] !== 'late');
  if (j <= 0) return;
  const t = ids[0];
  ids[0] = ids[j];
  ids[j] = t;
}

/**
 * One zone's slots (docs/boss-raid.md 3-2): the zone's roster, the final boss set aside for the last slot, the rest in a
 * seeded shuffle with no 'late' boss first; too few bosses → the same shuffled list again from its start.
 */
function zoneSlots(seed: number, zoneIndex: number, zone: FloorTheme, off?: readonly string[]): string[] {
  const roster = raidRoster(zone, off);
  const final = roster.includes(BOSS_RAID.finalBoss);
  const ids = roster.filter(id => id !== BOSS_RAID.finalBoss);
  if (ids.length === 0) return Array.from({ length: BOSS_RAID.perZone }, () => BOSS_RAID.finalBoss);
  shuffle(new Rng(mixSeed(seed, ORDER_SALT, zoneIndex)), ids);
  keepLateOffFirst(ids);
  const slots = Array.from({ length: BOSS_RAID.perZone - (final ? 1 : 0) }, (_, k) => ids[k % ids.length]);
  if (final) slots.push(BOSS_RAID.finalBoss);
  return slots;
}

/**
 * The boss of floors 1..20 by seed (pure, never the run rng): five slots per zone from the bosses that are on. With all
 * 20 on: each once, the final boss on the last floor, no 'late' boss on a zone's first floor. `off` = extra bosses to
 * leave out (BossRaidSetup.off).
 */
export function bossRaidSlots(seed: number, off?: readonly string[]): string[] {
  return RAID_ZONES.flatMap((zone, i) => zoneSlots(seed, i, zone, off));
}

/**
 * The run's boss order (pure; what spawns on floor n is order[(n − 1) % order.length]): bossRaidSlots with setup.off,
 * unless setup.order (as given) or setup.onlyBoss (on every floor) overrides it.
 */
export function bossRaidOrder(seed: number, setup?: BossRaidSetup): string[] {
  if (setup?.order && setup.order.length > 0) return [...setup.order];
  if (setup?.onlyBoss) return Array.from({ length: BOSS_RAID.floors }, () => setup.onlyBoss!);
  return bossRaidSlots(seed, setup?.off);
}

/** The zone background of a raid floor (5 floors per zone; past the last zone — debug — the zones repeat). */
export function bossRaidTheme(floor: number): FloorTheme {
  const f = Math.max(1, Math.floor(floor));
  return ZONES[(Math.ceil(f / BOSS_RAID.perZone) - 1) % ZONES.length].theme;
}

/** The boss of a raid floor (floors past the order repeat it). */
export function bossRaidBossId(floor: number, order: readonly string[]): string {
  const f = Math.max(1, Math.floor(floor));
  return order[(f - 1) % order.length];
}

/**
 * A raid floor: the classic boss floor (arena, enrage timer, floor stat multiplier) with the run's boss and the two raid
 * knobs as they are right now (docs/boss-raid.md 4-2: a slider change shows from the next floor start). `hpMult` = the
 * bench's fixed override of the HP knob.
 */
export function planBossRaidFloor(floor: number, order: readonly string[], tunables: Tunables, hpMult?: number): FloorPlan {
  const f = Math.max(1, Math.floor(floor));
  const bossId = bossRaidBossId(f, order);
  return {
    floor: f,
    kind: 'boss',
    timeLimit: tunables.bossFloorTime,
    arena: { ...ARENA_BOSS },
    statMult: floorStatMult(f, tunables.floorStatGrowth),
    waves: [],
    bossId,
    // the next floor's boss (sound pre-bake); none after the last floor
    ...(f < tunables.maxFloor ? { nextBossId: bossRaidBossId(f + 1, order) } : null),
    theme: bossRaidTheme(f),
    bossHpMult: hpMult != null && hpMult > 0 ? hpMult : tunables.bossRaidHpMult,
    bossAtkMult: tunables.bossRaidAtkMult * (bossId === BOSS_RAID.finalBoss ? BOSS_RAID.finalAtkMult : 1),
  };
}

/**
 * The `boss` field of a floorTimes row (Telemetry): the boss really fought on this floor — raid games only, so the
 * classic tower's telemetry is unchanged. The result screen names its floor chips from it.
 */
export function raidBossOfFloor(w: { bossRaid?: BossRaidRt; state: { plan: FloorPlan } }): { boss: string } | null {
  return w.bossRaid && w.state.plan.bossId ? { boss: w.state.plan.bossId } : null;
}

/** Relic screen (and +1 다시 뽑기) only after floors 5 · 10 · 15 · 20; the other floors give a normal floor reward. */
export function isBossRaidRelicFloor(floor: number): boolean {
  return floor % BOSS_RAID.relicEvery === 0;
}

/** World.bossRaid for a setup (undefined = not a raid). 원정 wins over the mode flag. 기획 22차: 궁극기 테스트 is a raid too. */
export function bossRaidRt(setup: { seed: number; mode?: RaidMode; bossRaid?: BossRaidSetup; expedition?: unknown }): BossRaidRt | undefined {
  if ((setup.mode !== 'bossRaid' && setup.mode !== 'ultTest') || setup.expedition) return undefined;
  const hp = setup.bossRaid?.hpMult;
  return { order: bossRaidOrder(setup.seed, setup.bossRaid), ...(hp != null && hp > 0 ? { hpMult: hp } : null) };
}
