import type { Tunables } from './types';

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

export const ARENA_NORMAL = { width: 36, height: 12 };
export const ARENA_BOSS = { width: 24, height: 12 };
/** Boss sits at the top edge, mostly outside the walkable area. */
export const BOSS_POS = { x: 12, y: -1.2 };

export const PLAYER_COLORS = ['#4cc9f0', '#f9c74f', '#f472b6'];

export const BOT_PRESETS = [
  { name: 'BOT 1', characters: ['guardian', 'ranger', 'cleric'], pets: ['frog_bomb', 'turtle_guard', 'owl_frost'] },
  { name: 'BOT 2', characters: ['blade', 'mage', 'berserker'], pets: ['fairy_heal', 'cat_void', 'drum_raccoon'] },
];

/** Floors at which each normal monster joins the spawn pool. */
export const MONSTER_UNLOCK_FLOOR: Record<string, number> = {
  slime: 1,
  goblin: 1,
  skeleton_archer: 2,
  bomb_bug: 3,
  golem: 4,
};
