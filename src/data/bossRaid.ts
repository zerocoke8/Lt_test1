// 기획 19차 보스 레이드 (docs/boss-raid.md): the mode's numbers and the fixed zone → boss table. Ids only — which of them
// are in a run (BossDef.raid, BossRaidSetup.off) and in what order is src/sim/bossRaid.ts (docs/boss-raid.md 3-2).

import type { FloorTheme } from '../types';

export const BOSS_RAID = {
  /** Floors of a run (= bosses; Tunables.maxFloor still ends the run). */
  floors: 20,
  /** Bosses (and floors) per zone. */
  perZone: 5,
  /**
   * Default of Tunables.bossRaidHpMult: boss HP × this on every floor (FloorPlan.bossHpMult). Rough value — 기획 19차
   * review: 0.8 → 1 (with attack 1 → 1.25): at 0.8 / 1 a run could not be lost (120 / 120 clears, 17 min).
   */
  hpMult: 1,
  /** Default of Tunables.bossRaidAtkMult: boss attack × this on every floor (FloorPlan.bossAtkMult). */
  atkMult: 1.25,
  /**
   * The final boss's attack × this on top of the attack knob (기획 19차 review): 심연의 감시자 was where almost every lost
   * run ended (12 of 14 at the defaults) — at 0.8 it hits like in the classic tower when the knob is 1.25.
   */
  finalAtkMult: 0.9,
  /** A relic screen (and +1 다시 뽑기) after every N-th floor; the other floors give a normal floor reward. */
  relicEvery: 5,
  /** Always the last floor. */
  finalBoss: 'abyss_watcher',
  /**
   * Floor-reward families never offered in a raid (기획 19차 review): they only work on normal enemies — 홀린 자 (not on
   * bosses or summons), 깜짝 등장 · 원혼의 손짓 (not on bosses), 백 개의 촛불 (+1 % crit per 40 kills) — and 9 of the 20
   * bosses bring no adds at all.
   */
  rewardsOff: ['possess', 'startle', 'beckon', 'candles'] as readonly string[],
} as const;

/** Zone order of a run (= ZONES in src/config.ts). */
export const RAID_ZONES: readonly FloorTheme[] = ['lobby', 'office', 'ward', 'rooftop'];

/** The five bosses of each zone; the zone's classic boss is the last entry. */
export const ZONE_BOSSES: Record<FloorTheme, readonly string[]> = {
  lobby: ['claw_machine', 'washer_drum', 'karaoke_room', 'reverse_escalator', 'elevator_keeper'],
  office: ['shredder_maw', 'coffee_machine', 'dead_monitor', 'endless_meeting', 'overtime_lord'],
  ward: ['morgue_drawers', 'xray_machine', 'defibrillator', 'empty_beds', 'surgeon_director'],
  rooftop: ['tank_dweller', 'thunder_antenna', 'answering_pencil', 'inverted_moon', 'abyss_watcher'],
};

/** All 20 boss ids of the raid, zone by zone. */
export const RAID_BOSS_IDS: readonly string[] = RAID_ZONES.flatMap(z => ZONE_BOSSES[z]);

/** The classic boss of each zone (the stand-in when every boss of the zone is off, so a zone is never empty). */
export const ZONE_CLASSIC_BOSS: Record<FloorTheme, string> = {
  lobby: 'elevator_keeper',
  office: 'overtime_lord',
  ward: 'surgeon_director',
  rooftop: 'abyss_watcher',
};

/**
 * Where in its zone a boss may come: 'late' bosses never open a zone (floors 1 · 6 · 11 · 16). The final boss is not
 * listed (always the last floor).
 */
export const BOSS_RAID_BAND: Record<string, 'early' | 'mid' | 'late'> = {
  claw_machine: 'early',
  washer_drum: 'early',
  karaoke_room: 'mid',
  reverse_escalator: 'late',
  elevator_keeper: 'late',
  shredder_maw: 'early',
  coffee_machine: 'early',
  dead_monitor: 'mid',
  endless_meeting: 'late',
  overtime_lord: 'late',
  morgue_drawers: 'early',
  xray_machine: 'mid',
  defibrillator: 'mid',
  empty_beds: 'late',
  surgeon_director: 'late',
  tank_dweller: 'early',
  // 기획 19차 review (bench): 천둥 안테나 kills most of the rooftop's new bosses, 거꾸로 뜬 달 least — labels swapped
  thunder_antenna: 'late',
  answering_pencil: 'mid',
  inverted_moon: 'mid',
};
