import type { FloorTheme, Tunables } from './types';

/** Draft numbers (기획서 2차 Q8: 개발 초안 + 디버그 슬라이더). */
export const DEFAULT_TUNABLES: Tunables = {
  gameSpeed: 1,
  swapCooldownMult: 1,
  ultChargeTime: 30,
  reviveTime: 30,
  reviveHpFrac: 0.5,
  floorHealFrac: 0.2,
  appearLockTime: 0.5,
  appearInvulnTime: 0.5,
  botDamageMult: 1,
  monsterHpMult: 1,
  monsterDmgMult: 1,
  floorStatGrowth: 0.12,
  normalFloorTime: 120,
  bossFloorTime: 90,
  waveInterval: 8,
  maxAliveMonsters: 30,
  maxFloor: 20,
  midBossKillTrigger: 12,
  midBossTimeTrigger: 45,
  bossLockReleaseSec: 0,
  petCooldownMult: 1,
  invincible: false,
  instantCooldowns: false,
};

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

/** World units visible horizontally on screen (camera follows the field character). Drops are limited to this view. */
export const VIEW_WIDTH_UNITS = 24;

export const ARENA_NORMAL = { width: 36, height: 12 };
export const ARENA_BOSS = { width: 24, height: 12 };
/** Boss sits at the top edge, mostly outside the walkable area. */
export const BOSS_POS = { x: 12, y: -1.2 };

export const PLAYER_COLORS = ['#4cc9f0', '#f9c74f', '#f472b6'];

export const BOT_PRESETS = [
  { name: 'BOT 1', characters: ['guardian', 'ranger', 'cleric'], pets: ['frog_bomb', 'turtle_guard', 'owl_frost'] },
  { name: 'BOT 2', characters: ['blade', 'mage', 'berserker'], pets: ['fairy_heal', 'cat_void', 'drum_raccoon'] },
];

/**
 * Normal-floor waves (기획서 9-1 (가정): 1층 first웨이브, 층마다 +perFloor).
 * Counted by floor number; capped at `max` (기획 8차: 10 → 8) so the last wave (1 + (n−1) × waveInterval s = 57 s)
 * leaves floors 6–19 around 60–90 s inside the 120 s limit — later zones get harder through bigger waves
 * (ZONES[].waveSize), their monsters and the floor stat growth instead of more waves.
 */
export const FLOOR_WAVES = { first: 5, perFloor: 1, max: 8 };
/**
 * 기획 8차 (20층): monster HP·attack grow by `floorStatGrowth` per floor up to floor `from` (1~5층 unchanged), then by
 * `factor` × that per floor — the party only grows through rewards, so the full slope would outrun it by floor ~12.
 * statMult(f) = 1 + g·(min(f, from) − 1) + g·factor·max(0, f − from).
 */
export const LATE_STAT_GROWTH = { from: 5, factor: 0.6 };

/** Monster stat multiplier of a floor (HP & attack, FloorPlan.statMult). */
export function floorStatMult(floor: number, growth: number): number {
  const f = Math.max(1, Math.floor(floor));
  const early = Math.min(f, LATE_STAT_GROWTH.from) - 1;
  const late = Math.max(0, f - LATE_STAT_GROWTH.from);
  return 1 + growth * early + growth * LATE_STAT_GROWTH.factor * late;
}

/** Normal monsters per wave (기획서 9-1: 4~6마리) — the lobby default; later zones override it (ZONES[].waveSize). */
export const WAVE_SIZE = { min: 4, max: 6 };

/**
 * Boss floor (가정, soft-lock guard): the timeout only enrages the boss, but once enraged, if no ally character is on
 * the field (every player out or with an empty field) for this many seconds in a row, the run fails.
 */
export const BOSS_ENRAGED_EMPTY_FIELD_FAIL = 30;

/**
 * 기획 8차 — 괴담 빌딩의 4구역 (docs/content-20f.md). Floors `from`..`to` (boss on `to`).
 * pool: wave monsters with pick weights; an entry joins at floor `from` (default: the zone's first floor).
 * mids: the mid boss of each normal floor of the zone, in order. boss: the boss of the zone's last floor.
 */
export interface ZoneDef {
  theme: FloorTheme;
  name: string;
  from: number;
  to: number;
  pool: { id: string; weight: number; from?: number }[];
  mids: string[];
  boss: string;
  waveSize: { min: number; max: number };
}

export const ZONES: ZoneDef[] = [
  {
    theme: 'lobby',
    name: '로비·상가층',
    from: 1,
    to: 5,
    // 1~4층은 7차까지와 같은 5종·같은 등장 층·같은 확률 (균등)
    pool: [
      { id: 'slime', weight: 1 },
      { id: 'goblin', weight: 1 },
      { id: 'skeleton_archer', weight: 1, from: 2 },
      { id: 'bomb_bug', weight: 1, from: 3 },
      { id: 'golem', weight: 1, from: 4 },
    ],
    mids: ['ogre', 'lich', 'elevator_girl', 'ogre'],
    boss: 'elevator_keeper',
    waveSize: WAVE_SIZE,
  },
  {
    theme: 'office',
    name: '사무실층',
    from: 6,
    to: 10,
    pool: [
      { id: 'overtime_ghost', weight: 3 },
      { id: 'copy_man', weight: 3, from: 7 },
      { id: 'goblin', weight: 1.5 },
      { id: 'skeleton_archer', weight: 1.5 },
      { id: 'bomb_bug', weight: 1 },
      { id: 'golem', weight: 1 },
    ],
    mids: ['copier_beast', 'lich', 'copier_beast', 'elevator_girl'],
    boss: 'overtime_lord',
    waveSize: { min: 4, max: 6 },
  },
  {
    theme: 'ward',
    name: '폐병동층',
    from: 11,
    to: 15,
    pool: [
      { id: 'iv_zombie', weight: 2.5 },
      { id: 'wheelchair_rush', weight: 3 },
      { id: 'nurse_doll', weight: 3, from: 12 },
      { id: 'copy_man', weight: 1 },
      { id: 'overtime_ghost', weight: 1 },
      { id: 'golem', weight: 1 },
      { id: 'bomb_bug', weight: 1 },
    ],
    mids: ['head_nurse', 'copier_beast', 'signal_man', 'head_nurse'],
    boss: 'surgeon_director',
    waveSize: { min: 4, max: 6 },
  },
  {
    theme: 'rooftop',
    name: '옥상·이계',
    from: 16,
    to: 20,
    pool: [
      { id: 'eye_stalk', weight: 2 },
      { id: 'red_mask', weight: 3.5, from: 17 },
      { id: 'nurse_doll', weight: 1.5 },
      { id: 'wheelchair_rush', weight: 1.5 },
      { id: 'iv_zombie', weight: 1 },
      { id: 'overtime_ghost', weight: 1 },
      { id: 'goblin', weight: 1 },
      { id: 'golem', weight: 1 },
    ],
    mids: ['signal_man', 'copier_beast', 'signal_man', 'head_nurse'],
    boss: 'abyss_watcher',
    waveSize: { min: 4, max: 6 },
  },
];

/** Zone of a floor (beyond the last zone — debug maxFloor > 20 — the last zone repeats). */
export function zoneOf(floor: number): ZoneDef {
  const f = Math.max(1, Math.floor(floor));
  return ZONES.find(z => f >= z.from && f <= z.to) ?? ZONES[ZONES.length - 1];
}

/** Floor at which each normal monster first joins a wave pool (any zone). */
export const MONSTER_UNLOCK_FLOOR: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const z of ZONES) {
    for (const e of z.pool) {
      const f = e.from ?? z.from;
      out[e.id] = Math.min(out[e.id] ?? Infinity, f);
    }
  }
  return out;
})();
