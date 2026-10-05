// Sim-internal constants that are structural (not balance sliders).
// Balance numbers live in Tunables (src/config.ts) and content data (src/data).

/** Character body radius (world units, diameter ≈ 1). */
export const CHAR_RADIUS = 0.45;
/** Units are kept at least this far inside the arena edge. */
export const ARENA_MARGIN = 0.5;
/** Cosmetic attack anim length (s). */
export const ATTACK_ANIM = 0.25;
/** DoT / regen / aura are applied in discrete pulses of this length (s). */
export const PULSE_INTERVAL = 0.5;
/** Seconds between a spawn marker and the spawn (기획서 9-1: 스폰 1초 전 바닥 마커). */
export const SPAWN_WARNING_TIME = 1;
export const SPAWN_POINTS = { min: 6, max: 8 };
/** Balance numbers live in src/config.ts; re-exported here under the names the sim (and tools) use. */
export { FLOOR_WAVES as WAVES, WAVE_SIZE } from '../config';
/** Monsters of a group are scattered this far around their spawn point. */
export const SPAWN_SCATTER = 1.1;
/** Summoned units appear this far around the action center. */
export const SUMMON_SPREAD = 1.4;
/** Hard floor for a character's swap cooldown after rewards (기획서 보상: 최소 4초). */
export const MIN_SWAP_COOLDOWN = 4;
/** Reward appearShield duration (s). */
export const APPEAR_SHIELD_DURATION = 4;
/** Ally turret shot = owner pet power × this. */
export const TURRET_POWER = 0.5;
/** Max normal-skill cooldown reduction from rewards. */
export const MAX_COOLDOWN_REDUCTION = 0.8;
/** Min gap between two monster skill casts of the same unit (boss patterns don't stack). */
export const MONSTER_SKILL_GAP = 1.5;
/** Normal monsters' first skill cast is delayed by a seeded 0..this (≤ 35 % of its cooldown) so a group never syncs. */
export const SKILL_START_JITTER = 1.5;
/** Projectiles that never arrive are dropped after this many seconds. */
export const PROJECTILE_MAX_LIFE = 4;
/** Game events buffer cap when nobody drains (headless). */
export const MAX_EVENTS = 5000;

// Bots (R23)
export const BOT = {
  thinkInterval: 0.5,
  lowHpFrac: 0.3,
  periodicSwap: [20, 30] as const,
  reaction: [0.5, 1.5] as const,
  ultDelay: [0.5, 3] as const,
  healPetHpFrac: 0.6,
  shieldPetHpFrac: 0.7,
};
