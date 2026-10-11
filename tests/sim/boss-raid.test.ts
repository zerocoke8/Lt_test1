// 기획 19차 보스 레이드 (docs/boss-raid.md): the seeded boss order, the 20 boss-floor plans, the run from floor 1 to the
// win, the reward / relic / reroll / 괴담 cadence, no 돌발 괴담, and the classic tower left alone.
import { describe, expect, it } from 'vitest';
import { ARENA_BOSS, DEFAULT_TUNABLES, ZONES, floorStatMult } from '../../src/config';
import { BOSS_RAID, BOSS_RAID_BAND, RAID_BOSS_IDS, RAID_ZONES, ZONE_BOSSES, ZONE_CLASSIC_BOSS, getBoss, getFamily, getMonster, rewardFamily } from '../../src/data';
import {
  bossRaidOrder,
  bossRaidSlots,
  bossRaidTheme,
  goedamSchedule,
  goedamTimeoutCommands,
  hasBossData,
  isBossRaidRelicFloor,
  isRaidBossOn,
  planBossRaidFloor,
  raidRoster,
  raidRosterIds,
} from '../../src/sim';
import { tick } from '../../src/sim/game';
import { familyEligible } from '../../src/sim/rewards/offers';
import type { GameEvent } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, drain, makeGame, type TestGame } from './helpers';
import { bossOf, raidGame } from './bossRaidHelpers';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);
const pub = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'rt' ? undefined : x));

describe('boss raid table', () => {
  it('20 boss ids, five per zone, the classic boss of each zone among them, a band for all but the final boss', () => {
    expect(RAID_BOSS_IDS).toHaveLength(BOSS_RAID.floors);
    expect(new Set(RAID_BOSS_IDS).size).toBe(20);
    expect(RAID_ZONES).toEqual(ZONES.map(z => z.theme));
    for (const z of ZONES) {
      expect(ZONE_BOSSES[z.theme]).toHaveLength(BOSS_RAID.perZone);
      expect(ZONE_BOSSES[z.theme]).toContain(z.boss);
      expect(ZONE_CLASSIC_BOSS[z.theme]).toBe(z.boss);
    }
    for (const id of RAID_BOSS_IDS) {
      if (id === BOSS_RAID.finalBoss) expect(BOSS_RAID_BAND[id]).toBeUndefined();
      else expect(['early', 'mid', 'late']).toContain(BOSS_RAID_BAND[id]);
    }
    // every zone has a boss that may open it
    for (const z of RAID_ZONES) expect(ZONE_BOSSES[z].some(id => BOSS_RAID_BAND[id] === 'early' || BOSS_RAID_BAND[id] === 'mid')).toBe(true);
    // 기획 19차 review: 0.8 / 1 → 1 / 1.25 (a run could not be lost); the final boss's attack × 0.9 on top
    expect(BOSS_RAID.hpMult).toBe(1);
    expect(BOSS_RAID.finalAtkMult).toBe(0.9);
    // the four debug knobs default to the data as written (docs/boss-raid.md 4-2)
    expect(DEFAULT_TUNABLES).toMatchObject({ bossTelegraphMult: 1, bossAreaMult: 1, bossRaidHpMult: BOSS_RAID.hpMult, bossRaidAtkMult: BOSS_RAID.atkMult });
    expect(BOSS_RAID.atkMult).toBe(1.25);
  });
});

describe('boss raid order (pure, by seed)', () => {
  it('every seed: 20 unique bosses, five per zone in zone order, floor 20 = 심연의 감시자, no late boss on 1 · 6 · 11 · 16', () => {
    for (const seed of SEEDS) {
      const slots = bossRaidSlots(seed);
      expect(slots).toHaveLength(20);
      expect(new Set(slots).size).toBe(20);
      RAID_ZONES.forEach((zone, i) => {
        const band = slots.slice(i * 5, i * 5 + 5);
        expect([...band].sort()).toEqual([...ZONE_BOSSES[zone]].sort());
        expect(BOSS_RAID_BAND[band[0]], `seed ${seed} floor ${i * 5 + 1}`).not.toBe('late');
      });
      expect(slots[19]).toBe(BOSS_RAID.finalBoss);
    }
  });

  it('same seed → same order; the order really varies by seed, every non-final slot sees several bosses', () => {
    for (const seed of SEEDS.slice(0, 40)) expect(bossRaidSlots(seed)).toEqual(bossRaidSlots(seed));
    const seen = Array.from({ length: 20 }, () => new Set<string>());
    for (const seed of SEEDS) bossRaidSlots(seed).forEach((id, i) => seen[i].add(id));
    for (let i = 0; i < 19; i++) expect(seen[i].size, `floor ${i + 1}`).toBeGreaterThanOrEqual(2);
    // 16–19 shuffle the four non-final rooftop bosses
    expect(seen[17].size).toBe(4);
    expect(seen[19].size).toBe(1);
  });

  it('what spawns: all 20 have data and are on, so the order is the slots and every boss is of its floor zone', () => {
    expect(RAID_BOSS_IDS.every(hasBossData)).toBe(true);
    expect(hasBossData('no_such_boss')).toBe(false);
    for (const seed of SEEDS.slice(0, 60)) {
      const order = bossRaidOrder(seed);
      expect(order).toEqual(bossRaidSlots(seed));
      order.forEach((id, i) => expect(getBoss(id).zone, `floor ${i + 1} boss is of its zone`).toBe(RAID_ZONES[Math.floor(i / 5)]));
    }
  });

  it('with every boss on the order is exactly what it was before the on / off rule (golden)', () => {
    expect(bossRaidOrder(1)).toEqual(GOLDEN_ORDER_SEED_1);
    let h = 2166136261;
    for (const seed of SEEDS) {
      for (const id of bossRaidOrder(seed)) {
        for (let i = 0; i < id.length; i++) {
          h ^= id.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
      }
    }
    // re-pinned after the review's band swap (천둥 안테나 → late, 거꾸로 뜬 달 → mid: the rooftop's first slot changes on some seeds)
    expect(h).toBe(3157152347);
  });

  it('bench / test overrides: onlyBoss on every floor, order as given', () => {
    expect(bossRaidOrder(5, { onlyBoss: 'overtime_lord' })).toEqual(Array.from({ length: 20 }, () => 'overtime_lord'));
    expect(bossRaidOrder(5, { order: ['abyss_watcher', 'elevator_keeper'] })).toEqual(['abyss_watcher', 'elevator_keeper']);
    expect(bossRaidOrder(5, { order: [] })).toEqual(bossRaidOrder(5));
    // the overrides win over an off list
    expect(bossRaidOrder(5, { onlyBoss: 'overtime_lord', off: ['overtime_lord'] })[0]).toBe('overtime_lord');
  });
});

/** The order of seed 1 as it was with the 20 bosses and no on / off rule (기획 19차, captured before the rule landed). */
const GOLDEN_ORDER_SEED_1 = [
  'karaoke_room', 'elevator_keeper', 'washer_drum', 'reverse_escalator', 'claw_machine',
  'dead_monitor', 'endless_meeting', 'overtime_lord', 'coffee_machine', 'shredder_maw',
  'xray_machine', 'empty_beds', 'surgeon_director', 'defibrillator', 'morgue_drawers',
  'tank_dweller', 'answering_pencil', 'thunder_antenna', 'inverted_moon', 'abyss_watcher',
];

/**
 * docs/boss-raid.md 3-2 for one zone: `on` = its bosses that are on (table order; empty → the zone's classic boss).
 * The final boss takes the last slot; the others fill the slots in one shuffled order, again from its start when they
 * run out; a 'late' boss opens the zone only when there is nothing else.
 */
function expectZoneRule(slots: string[], zoneIndex: number, on: readonly string[], label: string): void {
  const zone = RAID_ZONES[zoneIndex];
  const band = slots.slice(zoneIndex * 5, zoneIndex * 5 + 5);
  const roster = on.length > 0 ? [...on] : [ZONE_CLASSIC_BOSS[zone]];
  const final = roster.includes(BOSS_RAID.finalBoss);
  const rest = roster.filter(id => id !== BOSS_RAID.finalBoss);
  if (rest.length === 0) {
    expect(band, label).toEqual(Array.from({ length: 5 }, () => BOSS_RAID.finalBoss));
    return;
  }
  const n = final ? 4 : 5;
  const head = band.slice(0, Math.min(n, rest.length));
  expect(new Set(head).size, `${label}: no repeat before every boss came once`).toBe(head.length);
  for (const id of head) expect(rest, label).toContain(id);
  if (rest.length <= n) expect([...head].sort(), `${label}: every boss that is on comes`).toEqual([...rest].sort());
  for (let k = 0; k < n; k++) expect(band[k], `${label}: slot ${k} repeats the shuffled list`).toBe(head[k % rest.length]);
  if (final) expect(band[4], label).toBe(BOSS_RAID.finalBoss);
  if (rest.some(id => BOSS_RAID_BAND[id] !== 'late')) expect(BOSS_RAID_BAND[band[0]], `${label}: no late boss first`).not.toBe('late');
  if (rest.length >= 2) for (let k = 1; k < n; k++) expect(band[k], `${label}: never the same boss twice in a row`).not.toBe(band[k - 1]);
}

describe('boss raid on / off (docs/boss-raid.md 3-1 · 3-2)', () => {
  const LOBBY = ZONE_BOSSES.lobby;
  const ROOF = ZONE_BOSSES.rooftop;
  const without = (zone: readonly string[], off: readonly string[]) => zone.filter(id => !off.includes(id));
  /** Off lists: a zone with 3, 2, 1, 0 bosses on; the final boss off; only the final boss on; the final boss + two. */
  const CASES: { name: string; off: string[] }[] = [
    { name: 'lobby 3 on', off: ['washer_drum', 'elevator_keeper'] },
    { name: 'lobby 2 on (both late)', off: ['claw_machine', 'washer_drum', 'karaoke_room'] },
    { name: 'lobby 1 on', off: without(LOBBY, ['karaoke_room']) },
    { name: 'lobby 0 on', off: [...LOBBY] },
    { name: 'office 0 on · ward 1 on', off: [...ZONE_BOSSES.office, ...without(ZONE_BOSSES.ward, ['defibrillator'])] },
    { name: 'final boss off', off: ['abyss_watcher'] },
    { name: 'only the final boss on', off: without(ROOF, ['abyss_watcher']) },
    { name: 'final boss + two', off: ['tank_dweller', 'inverted_moon'] },
    { name: 'rooftop 0 on', off: [...ROOF] },
    { name: 'everything off', off: [...RAID_BOSS_IDS] },
  ];

  it('isRaidBossOn / raidRoster / raidRosterIds: everything on by default; an off list or unknown id is out', () => {
    for (const id of RAID_BOSS_IDS) expect(isRaidBossOn(id), id).toBe(true);
    expect(isRaidBossOn('no_such_boss')).toBe(false);
    expect(isRaidBossOn('karaoke_room', ['karaoke_room'])).toBe(false);
    expect(raidRosterIds()).toEqual(RAID_BOSS_IDS);
    expect(raidRoster('lobby', ['washer_drum', 'elevator_keeper'])).toEqual(['claw_machine', 'karaoke_room', 'reverse_escalator']);
    // a zone with everything off keeps its classic boss, so it is never empty
    expect(raidRoster('office', [...ZONE_BOSSES.office])).toEqual(['overtime_lord']);
    expect(raidRosterIds([...RAID_BOSS_IDS])).toEqual(RAID_ZONES.map(z => ZONE_CLASSIC_BOSS[z]));
    expect(raidRosterIds(['dead_monitor'])).toHaveLength(19);
  });

  it('every off list, every seed: 20 slots filled by the slot rule; zones without a change keep their all-on order', () => {
    for (const c of CASES) {
      for (const seed of SEEDS.slice(0, 120)) {
        const slots = bossRaidSlots(seed, c.off);
        const all = bossRaidSlots(seed);
        expect(slots, c.name).toHaveLength(20);
        RAID_ZONES.forEach((zone, z) => {
          const on = without(ZONE_BOSSES[zone], c.off);
          expectZoneRule(slots, z, on, `${c.name} seed ${seed} ${zone}`);
          if (on.length === ZONE_BOSSES[zone].length) expect(slots.slice(z * 5, z * 5 + 5)).toEqual(all.slice(z * 5, z * 5 + 5));
        });
        expect(bossRaidSlots(seed, c.off), 'same seed + same off list → same order').toEqual(slots);
        expect(bossRaidOrder(seed, { off: c.off })).toEqual(slots);
      }
    }
  });

  it('the cases by hand: A·B·C·A·B, one boss five times, the stand-in, the final boss rules', () => {
    const seed = 2026;
    const three = bossRaidSlots(seed, ['washer_drum', 'elevator_keeper']).slice(0, 5);
    expect(three.slice(3)).toEqual(three.slice(0, 2));
    expect(new Set(three).size).toBe(3);
    expect(bossRaidSlots(seed, without(LOBBY, ['karaoke_room'])).slice(0, 5)).toEqual(Array.from({ length: 5 }, () => 'karaoke_room'));
    expect(bossRaidSlots(seed, [...LOBBY]).slice(0, 5)).toEqual(Array.from({ length: 5 }, () => 'elevator_keeper'));
    // the final boss off: floor 20 is one of the other four (the first of the shuffled list again)
    const noFinal = bossRaidSlots(seed, ['abyss_watcher']).slice(15);
    expect(noFinal).not.toContain('abyss_watcher');
    expect(noFinal[4]).toBe(noFinal[0]);
    expect(new Set(noFinal).size).toBe(4);
    // only the final boss on (and a rooftop with nothing on — its stand-in is the final boss too): it takes 16–20
    expect(bossRaidSlots(seed, without(ROOF, ['abyss_watcher'])).slice(15)).toEqual(Array.from({ length: 5 }, () => 'abyss_watcher'));
    expect(bossRaidSlots(seed, [...ROOF]).slice(15)).toEqual(Array.from({ length: 5 }, () => 'abyss_watcher'));
    const two = bossRaidSlots(seed, ['tank_dweller', 'inverted_moon']).slice(15);
    expect(two).toEqual([two[0], two[1], two[0], two[1], 'abyss_watcher']);
  });

  it('`raid: false` on the data is the same as the off list; the classic tower still plans that boss', () => {
    const def = getBoss('elevator_keeper');
    const before = bossRaidSlots(77);
    const expected = bossRaidSlots(77, ['elevator_keeper']);
    expect(expected).not.toContain('elevator_keeper');
    def.raid = false;
    try {
      expect(isRaidBossOn('elevator_keeper')).toBe(false);
      expect(raidRosterIds()).toHaveLength(19);
      expect(bossRaidSlots(77)).toEqual(expected);
      expect(bossRaidOrder(77)).toEqual(expected);
      expect(makeGame({ seed: 77, mode: 'bossRaid' }).w.bossRaid!.order).toEqual(expected);
      expect(makeGame({ seed: 5, startFloor: 5 }).w.state.plan.bossId).toBe('elevator_keeper');
      def.raid = true;
      expect(bossRaidSlots(77)).toEqual(before);
    } finally {
      delete def.raid;
    }
    expect(bossRaidSlots(77)).toEqual(before);
  });

  it('a run with an off list (BossRaidSetup.off) plays only the bosses that are on', () => {
    const off = ['karaoke_room', 'dead_monitor', 'abyss_watcher'];
    const tg = makeGame({ seed: 12, mode: 'bossRaid', bossRaid: { off } });
    expect(tg.w.bossRaid!.order).toEqual(bossRaidSlots(12, off));
    for (const id of off) expect(tg.w.bossRaid!.order).not.toContain(id);
    expect(tg.w.state.plan.bossId).toBe(tg.w.bossRaid!.order[0]);
  });
});

describe('boss raid floor plans', () => {
  it('floors 1–20: a boss plan with the run order, the zone theme, the classic floor multiplier and the two raid knobs', () => {
    const t = { ...DEFAULT_TUNABLES };
    const order = bossRaidOrder(77);
    for (let f = 1; f <= 20; f++) {
      const plan = planBossRaidFloor(f, order, t);
      expect(plan).toEqual({
        floor: f,
        kind: 'boss',
        timeLimit: t.bossFloorTime,
        arena: ARENA_BOSS,
        statMult: floorStatMult(f, t.floorStatGrowth),
        waves: [],
        bossId: order[f - 1],
        ...(f < 20 ? { nextBossId: order[f] } : null),
        theme: ZONES[Math.ceil(f / 5) - 1].theme,
        bossHpMult: BOSS_RAID.hpMult,
        // the attack knob; the final boss (floor 20) gets finalAtkMult on top
        bossAtkMult: BOSS_RAID.atkMult * (f === 20 ? BOSS_RAID.finalAtkMult : 1),
      });
      expect(bossRaidTheme(f)).toBe(plan.theme);
    }
  });

  it('the plan reads the two raid knobs from the tunables; a fixed HP override (bench) wins over the HP knob', () => {
    const t = { ...DEFAULT_TUNABLES, bossRaidHpMult: 1.5, bossRaidAtkMult: 0.5 };
    const order = bossRaidOrder(77);
    expect(planBossRaidFloor(3, order, t)).toMatchObject({ bossHpMult: 1.5, bossAtkMult: 0.5 });
    expect(order[19]).toBe(BOSS_RAID.finalBoss);
    expect(planBossRaidFloor(20, order, t).bossAtkMult).toBeCloseTo(0.5 * BOSS_RAID.finalAtkMult, 9);
    expect(planBossRaidFloor(3, order, t, 4)).toMatchObject({ bossHpMult: 4, bossAtkMult: 0.5 });
    expect(planBossRaidFloor(3, order, t, 0)).toMatchObject({ bossHpMult: 1.5 });
  });

  it('floors past 20 (debug maxFloor) repeat the order and the zones', () => {
    const t = { ...DEFAULT_TUNABLES, maxFloor: 40 };
    const order = bossRaidOrder(3);
    for (const f of [21, 25, 26, 40]) {
      const plan = planBossRaidFloor(f, order, t, 1);
      expect(plan.bossId).toBe(order[(f - 1) % 20]);
      expect(plan.theme).toBe(ZONES[(Math.ceil(f / 5) - 1) % 4].theme);
    }
    expect(planBossRaidFloor(20, order, t, 1).nextBossId).toBe(order[0]);
  });

  it('relic floors are 5 · 10 · 15 · 20', () => {
    expect(Array.from({ length: 20 }, (_, i) => i + 1).filter(isBossRaidRelicFloor)).toEqual([5, 10, 15, 20]);
  });
});

/** Clear the floor with the debug skip and answer whatever screen follows; returns what was seen. */
function clearFloor(tg: TestGame): { floor: number; relic: boolean | null; goedam: boolean } {
  const s = tg.w.state;
  const floor = s.floor;
  expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
  let relic: boolean | null = null;
  let goedam = false;
  for (let guard = 0; guard < 12 && s.floor === floor && s.phase !== 'runOver'; guard++) {
    if (s.phase === 'reward') {
      const offers = s.rewardOffersByPlayer[0]!;
      relic = offers.every(o => o.isRelic);
      expect(offers.some(o => o.isRelic), 'never a mixed screen').toBe(relic);
      tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    } else if (s.phase === 'goedam') {
      goedam = true;
      for (const c of goedamTimeoutCommands(s)) tg.game.dispatch(c);
    }
  }
  return { floor, relic, goedam };
}

describe('boss raid run', () => {
  it('starts on a boss floor: state.mode, the planned boss with HP × floor × knob, a groggy gauge, no waves', () => {
    const seed = 404;
    const tg = makeGame({ seed, mode: 'bossRaid' });
    const s = tg.w.state;
    const order = bossRaidOrder(seed);
    expect(s.mode).toBe('bossRaid');
    expect(tg.w.bossRaid).toEqual({ order });
    expect(s.plan.kind).toBe('boss');
    expect(s.plan.bossId).toBe(order[0]);
    expect(s.plan.theme).toBe('lobby');
    const boss = bossOf(tg);
    expect(boss.defId).toBe(order[0]);
    expect(boss.maxHp).toBeCloseTo(getBoss(order[0]).stats.maxHp * BOSS_RAID.hpMult, 6);
    expect(boss.rt.base.atk).toBeCloseTo(getBoss(order[0]).stats.atk * BOSS_RAID.atkMult, 6);
    expect(s.bossGroggy).not.toBeNull();
    expect(s.wavesRemaining).toBe(0);
    expect(drain(tg).some(e => e.type === 'floorStart' && e.kind === 'boss')).toBe(true);
  });

  it('boss HP and attack follow the floor like the classic tower; the HP knob can be overridden', () => {
    const tg = raidGame('overtime_lord', { floor: 12, hpMult: 0.5 });
    const def = getBoss('overtime_lord');
    const m = floorStatMult(12, DEFAULT_TUNABLES.floorStatGrowth);
    expect(bossOf(tg).maxHp).toBeCloseTo(def.stats.maxHp * m * 0.5, 6);
    expect(tg.w.state.plan.statMult).toBeCloseTo(m, 9);
    expect(tg.w.state.plan.theme).toBe('ward'); // the zone follows the floor, not the boss
  });

  it('20 × 「다음 보스로」 → victory on floor 20: every floor a boss in the run order, relic screens only on 5 · 10 · 15', () => {
    const seed = 2026;
    const tg = makeGame({ seed, mode: 'bossRaid' });
    const s = tg.w.state;
    const order = bossRaidOrder(seed);
    const bosses: string[] = [];
    const relicFloors: number[] = [];
    const rerolls: number[] = [];
    for (let f = 1; f <= 20; f++) {
      expect(s.floor).toBe(f);
      expect(s.plan.kind).toBe('boss');
      expect(s.fieldEvent).toBeNull();
      bosses.push(bossOf(tg).defId);
      rerolls.push(s.players[0].rerolls);
      const r = clearFloor(tg);
      if (r.relic) relicFloors.push(f);
      if (f < 20) expect(r.relic, `floor ${f} has a reward screen`).not.toBeNull();
    }
    expect(bosses).toEqual(order);
    expect(relicFloors).toEqual([5, 10, 15]);
    expect(s.phase).toBe('runOver');
    expect(s.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 20 });
    expect(tg.game.telemetry().floorTimes.map(x => x.floor)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // 다시 뽑기: 1 at the start, +1 only after floors 5 · 10 · 15 · 20
    for (let f = 1; f <= 20; f++) expect(rerolls[f - 1], `rerolls entering floor ${f}`).toBe(1 + Math.floor((f - 1) / 5));
    expect(s.players[0].rerolls).toBe(5);
    expect(s.players[0].relics).toHaveLength(3);
    expect(s.players[0].rewards.length).toBeGreaterThanOrEqual(16);
  });

  it('괴담 rooms follow the classic schedule (after floors 2–4 · 7–9 · 12–14 · 17–19), never after a relic floor', () => {
    for (const seed of [11, 12, 13]) {
      const tg = makeGame({ seed, mode: 'bossRaid', tunables: { goedamRoomsPerZone: 1 } });
      const planned = goedamSchedule(seed, 1).map(x => x.floor);
      const opened: number[] = [];
      for (let f = 1; f <= 20; f++) if (clearFloor(tg).goedam) opened.push(f);
      expect(opened.length).toBeGreaterThanOrEqual(3);
      for (const f of opened) {
        expect(planned).toContain(f);
        expect(f % 5).not.toBe(0);
      }
      expect(tg.w.state.runResult?.outcome).toBe('victory');
    }
  });

  it('no 돌발 괴담 on any floor, even with the chance at 1 (and none can be forced)', () => {
    const tg = makeGame({ seed: 9, mode: 'bossRaid', players: [HUMAN, BOT1, BOT2], tunables: { fieldEventChance: 1, invincible: true } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'fieldEventNext' } });
    for (let f = 1; f <= 4; f++) {
      for (let t = 0; t < 30 * 14 && tg.w.state.phase === 'combat' && tg.w.state.floor === f; t++) {
        tick(tg.w);
        expect(tg.w.state.fieldEvent).toBeNull();
      }
      if (tg.w.state.floor === f && tg.w.state.phase === 'combat') clearFloor(tg);
    }
    const types = new Set(drain(tg).map((e: GameEvent) => e.type));
    expect(types.has('fieldEventWarn')).toBe(false);
    expect(tg.w.state.entities.some(e => e.eventTag)).toBe(false);
  });

  it('a boss past its floor time enrages like a classic boss floor; a wipe is a defeat on that floor', () => {
    const tg = raidGame('elevator_keeper', { floor: 3, hpMult: 50, tunables: { invincible: true } });
    advance(tg, DEFAULT_TUNABLES.bossFloorTime + 0.5);
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(tg.w.state.phase).toBe('combat');
    tg.game.dispatch({ type: 'debug', action: { kind: 'wipeParty' } });
    expect(tg.w.state.runResult).toMatchObject({ outcome: 'defeat', floorReached: 3 });
  });

  it('debug jump keeps the order; same seed → the same run, bots only', () => {
    const tg = makeGame({ seed: 31, mode: 'bossRaid' });
    const order = bossRaidOrder(31);
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 20 } });
    expect(bossOf(tg).defId).toBe('abyss_watcher');
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 7 } });
    expect(bossOf(tg).defId).toBe(order[6]);
    const run = (seed: number) => {
      const g = makeGame({ seed, mode: 'bossRaid', players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
      for (let t = 0; t < 30 * 40; t++) tick(g.w);
      return pub(g.w.state);
    };
    expect(run(8)).toBe(run(8));
    expect(run(8)).not.toBe(run(9));
  });
});

describe('보스 레이드 HP · 공격 배율 (docs/boss-raid.md 4-2)', () => {
  const growth = DEFAULT_TUNABLES.floorStatGrowth;

  it('a slider change shows on the next floor start only: the boss in front keeps its HP and attack', () => {
    const tg = makeGame({ seed: 61, mode: 'bossRaid' });
    const order = bossRaidOrder(61);
    const first = bossOf(tg);
    const hp1 = first.maxHp;
    const atk1 = first.rt.base.atk;
    expect(tg.game.dispatch({ type: 'tunables', patch: { bossRaidHpMult: 2, bossRaidAtkMult: 3 } }).ok).toBe(true);
    expect(first.maxHp).toBe(hp1);
    expect(first.rt.base.atk).toBe(atk1);
    expect(tg.w.state.plan).toMatchObject({ bossHpMult: BOSS_RAID.hpMult, bossAtkMult: BOSS_RAID.atkMult });
    clearFloor(tg);
    expect(tg.w.state.floor).toBe(2);
    const def = getBoss(order[1]);
    const m = floorStatMult(2, growth);
    expect(tg.w.state.plan).toMatchObject({ bossHpMult: 2, bossAtkMult: 3, statMult: m });
    expect(bossOf(tg).maxHp).toBeCloseTo(def.stats.maxHp * m * 2, 6);
    expect(bossOf(tg).rt.base.atk).toBeCloseTo(def.stats.atk * m * 3, 6);
  });

  it('「층 이동」 / 「이 보스로」 restart the floor, so the new values show at once; the bounds clamp nonsense', () => {
    const tg = makeGame({ seed: 61, mode: 'bossRaid' });
    tg.game.dispatch({ type: 'tunables', patch: { bossRaidHpMult: 0.5, bossRaidAtkMult: 1000 } });
    expect(tg.w.tunables.bossRaidAtkMult).toBe(10);
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 1 } });
    const def = getBoss(bossOf(tg).defId);
    expect(bossOf(tg).maxHp).toBeCloseTo(def.stats.maxHp * 0.5, 6);
    expect(bossOf(tg).rt.base.atk).toBeCloseTo(def.stats.atk * 10, 6);
    tg.game.dispatch({ type: 'tunables', patch: { bossTelegraphMult: 99, bossAreaMult: 0 } });
    expect(tg.w.tunables.bossTelegraphMult).toBe(4);
    expect(tg.w.tunables.bossAreaMult).toBe(0.25);
  });

  it('the bench override (BossRaidSetup.hpMult) stays fixed whatever the HP slider says', () => {
    const tg = raidGame('overtime_lord', { hpMult: 0.5 });
    tg.game.dispatch({ type: 'tunables', patch: { bossRaidHpMult: 3 } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 2 } });
    expect(bossOf(tg).maxHp).toBeCloseTo(getBoss('overtime_lord').stats.maxHp * floorStatMult(2, growth) * 0.5, 6);
  });

  it('the boss summons get neither knob: floor multiplier only', () => {
    const tg = raidGame('overtime_lord', { floor: 6, hpMult: 50, tunables: { invincible: true, bossRaidAtkMult: 3 } });
    const m = floorStatMult(6, growth);
    expect(bossOf(tg).rt.base.atk).toBeCloseTo(getBoss('overtime_lord').stats.atk * m * 3, 6);
    advance(tg, 40);
    const adds = tg.w.state.entities.filter(e => e.team === 'enemy' && e.kind === 'summon');
    expect(adds.length).toBeGreaterThan(0);
    for (const e of adds) {
      const def = getMonster(e.defId);
      expect(e.rt.base.atk, e.defId).toBeCloseTo(def.stats.atk * m, 6);
      expect(e.maxHp, e.defId).toBeCloseTo(def.stats.maxHp * m, 6);
    }
  });

  it('a classic boss floor has no attack knob on its plan and ignores both raid knobs', () => {
    const base = makeGame({ seed: 5, startFloor: 5 });
    const tuned = makeGame({ seed: 5, startFloor: 5, tunables: { bossRaidHpMult: 3, bossRaidAtkMult: 3 } });
    expect('bossAtkMult' in tuned.w.state.plan).toBe(false);
    expect(bossOf(tuned).maxHp).toBe(bossOf(base).maxHp);
    expect(bossOf(tuned).rt.base.atk).toBe(bossOf(base).rt.base.atk);
  });
});

describe('debug 「보스 고르기」 (raidBoss)', () => {
  it('restarts the floor with the picked boss: the floor number and multiplier stay, later floors keep the order', () => {
    const seed = 404;
    const tg = makeGame({ seed, mode: 'bossRaid' });
    const order = bossRaidOrder(seed);
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    const pick = order[2] === 'shredder_maw' ? 'coffee_machine' : 'shredder_maw';
    advance(tg, 3);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: pick } })).toEqual({ ok: true });
    const s = tg.w.state;
    expect(s.floor).toBe(3);
    expect(s.phase).toBe('combat');
    expect(s.floorTime).toBe(0);
    expect(s.plan).toMatchObject({ bossId: pick, theme: 'lobby', statMult: floorStatMult(3, DEFAULT_TUNABLES.floorStatGrowth), nextBossId: order[3] });
    expect(bossOf(tg).defId).toBe(pick);
    expect(bossOf(tg).maxHp).toBeCloseTo(getBoss(pick).stats.maxHp * s.plan.statMult * BOSS_RAID.hpMult, 6);
    expect(s.entities.filter(e => e.tier === 'boss')).toHaveLength(1);
    expect(s.bossGroggy).not.toBeNull();
    clearFloor(tg);
    expect(s.floor).toBe(4);
    expect(bossOf(tg).defId).toBe(order[3]);
    // the pick sticks to that floor of this run (a jump back shows it again)
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    expect(bossOf(tg).defId).toBe(pick);
  });

  it('a boss that is off can be picked; an unknown boss and a classic game are refused', () => {
    const tg = makeGame({ seed: 7, mode: 'bossRaid', bossRaid: { off: ['dead_monitor'] } });
    expect(tg.w.bossRaid!.order).not.toContain('dead_monitor');
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'dead_monitor' } }).ok).toBe(true);
    expect(bossOf(tg).defId).toBe('dead_monitor');
    expect(tg.w.state.floor).toBe(1);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'no_such_boss' } })).toEqual({ ok: false, reason: '알 수 없는 보스' });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'ogre' } })).toEqual({ ok: false, reason: '알 수 없는 보스' });
    expect(bossOf(tg).defId).toBe('dead_monitor');
    const classic = makeGame({ seed: 7, startFloor: 5 });
    expect(classic.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'dead_monitor' } })).toEqual({ ok: false, reason: '보스 레이드 전용' });
    expect(bossOf(classic).defId).toBe('elevator_keeper');
    const ex = makeGame({ seed: 7, expedition: { stage: 3 } });
    expect(ex.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'dead_monitor' } }).ok).toBe(false);
  });

  it('only during a fight: on the reward screen it is refused (the reward stays, the floor is not logged twice), and not after the run is over', () => {
    const tg = makeGame({ seed: 7, mode: 'bossRaid' });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(tg.w.state.phase).toBe('reward');
    const offers = JSON.stringify(tg.w.state.rewardOffersByPlayer);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'xray_machine' } })).toEqual({ ok: false, reason: '전투 중에만 고를 수 있어요' });
    expect(tg.w.state).toMatchObject({ phase: 'reward', floor: 1 });
    expect(JSON.stringify(tg.w.state.rewardOffersByPlayer)).toBe(offers);
    expect(tg.game.telemetry().floorTimes).toHaveLength(1);
    // back in a fight (the next floor) the picker works again
    for (let guard = 0; guard < 12 && tg.w.state.floor === 1; guard++) {
      if (tg.w.state.phase === 'reward') tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      else if (tg.w.state.phase === 'goedam') for (const c of goedamTimeoutCommands(tg.w.state)) tg.game.dispatch(c);
    }
    expect(tg.w.state).toMatchObject({ phase: 'combat', floor: 2 });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'xray_machine' } }).ok).toBe(true);
    expect(tg.w.state).toMatchObject({ phase: 'combat', floor: 2 });
    expect(bossOf(tg).defId).toBe('xray_machine');
    tg.game.dispatch({ type: 'debug', action: { kind: 'wipeParty' } });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'xray_machine' } }).ok).toBe(false);
  });
});

describe('floor rewards of a raid (기획 19차 review)', () => {
  it('the families that only work on normal enemies are never offered in a raid; the classic tower still offers them', () => {
    expect(BOSS_RAID.rewardsOff).toEqual(['possess', 'startle', 'beckon', 'candles']);
    const raid = makeGame({ seed: 3, mode: 'bossRaid' });
    const classic = makeGame({ seed: 3 });
    for (const key of BOSS_RAID.rewardsOff) {
      const f = getFamily(key);
      expect(familyEligible(raid.w.state, raid.w.state.players[0], f), key).toBe(false);
      expect(familyEligible(classic.w.state, classic.w.state.players[0], f), key).toBe(true);
    }
    // forty reward screens of raid runs: none of them on a card
    for (let seed = 1; seed <= 40; seed++) {
      const tg = makeGame({ seed, mode: 'bossRaid' });
      tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
      const offers = tg.w.state.rewardOffersByPlayer[0] ?? [];
      expect(offers.length).toBeGreaterThan(0);
      for (const o of offers) expect(BOSS_RAID.rewardsOff, `seed ${seed}`).not.toContain(o.family ?? rewardFamily(o.rewardId));
    }
  });
});

describe('telemetry: the boss really fought on each floor', () => {
  it('raid rows carry `boss` (clear and fail), also after a debug pick; classic rows have no such key', () => {
    const seed = 88;
    const tg = makeGame({ seed, mode: 'bossRaid' });
    const order = bossRaidOrder(seed);
    clearFloor(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'inverted_moon' } });
    clearFloor(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'wipeParty' } });
    expect(tg.game.telemetry().floorTimes).toEqual([
      { floor: 1, seconds: expect.any(Number), outcome: 'clear', boss: order[0] },
      { floor: 2, seconds: expect.any(Number), outcome: 'clear', boss: 'inverted_moon' },
      { floor: 3, seconds: expect.any(Number), outcome: 'fail', boss: order[2] },
    ]);
    const classic = makeGame({ seed, startFloor: 5 });
    classic.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    classic.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    classic.game.dispatch({ type: 'debug', action: { kind: 'wipeParty' } });
    const rows = classic.game.telemetry().floorTimes;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect('boss' in r).toBe(false);
  });
});

describe('the classic tower is not a raid', () => {
  it('no mode key on the state, no raid runtime, floor 1 is a normal floor; 원정 ignores the flag', () => {
    const tg = makeGame({ seed: 404 });
    expect('mode' in tg.w.state).toBe(false);
    expect(tg.w.bossRaid).toBeUndefined();
    expect(tg.w.state.plan.kind).toBe('normal');
    expect('nextBossId' in tg.w.state.plan).toBe(false);
    const ex = makeGame({ seed: 404, mode: 'bossRaid', expedition: { stage: 1 } });
    expect(ex.w.bossRaid).toBeUndefined();
    expect(ex.w.state.mode).toBeUndefined();
    expect(ex.w.state.expedition).toBeDefined();
  });

  it('a classic boss floor still gives the relic screen and +1 다시 뽑기 on its clear', () => {
    const tg = makeGame({ seed: 5, startFloor: 5 });
    expect(tg.w.state.plan.bossId).toBe('elevator_keeper');
    expect(tg.w.state.plan.bossHpMult).toBeUndefined();
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(tg.w.state.rewardOffersByPlayer[0]!.every(o => o.isRelic)).toBe(true);
    expect(tg.w.state.players[0].rerolls).toBe(2);
  });
});
