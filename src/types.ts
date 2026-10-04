// Shared contract between sim / render / ui.
// The sim owns and mutates GameState; render and ui only read it and talk back through Command.
// World units: 1 unit ≈ one character width. Ground plane is (x, y); y grows toward the camera (screen-down).

export type Vec2 = { x: number; y: number };

export type Role = 'tank' | 'melee' | 'ranged' | 'support';
export type Team = 'ally' | 'enemy';
export type Rarity = 'common' | 'rare' | 'epic';
export type SkillSlot = 'basic' | 'passive' | 'normal' | 'drag' | 'ult';
/** What a point of damage/heal is attributed to, for contribution + tuning logs. */
export type DamageSource = SkillSlot | 'pet' | 'relic' | 'zone' | 'summon';

// ─────────────────────────── Stats & status ───────────────────────────

export interface StatBlock {
  maxHp: number;
  /** Flat attack. Skill damage = atk × Effect.amount. */
  atk: number;
  /** Damage reduction 0..0.9 */
  def: number;
  /** Basic attacks per second. */
  atkSpeed: number;
  /** Basic-attack reach measured edge-to-edge (units). */
  range: number;
  /** Units per second. */
  moveSpeed: number;
  critChance: number;
  critMult: number;
}

/** Additive percentage bonuses (0.1 = +10%). Used by passives, rewards, relics, statuses. */
export interface StatMods {
  hpPct?: number;
  atkPct?: number;
  defFlat?: number;
  atkSpeedPct?: number;
  moveSpeedPct?: number;
  critChance?: number;
  critMult?: number;
}

export type StatusId =
  | 'stun' // cannot act or move
  | 'slow' // value = move+atkSpeed reduction fraction
  | 'burn' // value = damage per second as fraction of source atk at application time (stored as absolute dps)
  | 'atkUp' // value = atk pct
  | 'atkDown'
  | 'defUp' // value = flat def
  | 'haste' // value = atkSpeed pct
  | 'regen' // value = fraction of maxHp per second
  | 'vulnerable' // value = extra damage taken pct
  | 'lifesteal'; // value = fraction of damage dealt healed

export const DEBUFFS: ReadonlySet<StatusId> = new Set<StatusId>(['stun', 'slow', 'burn', 'atkDown', 'vulnerable']);

export interface StatusInstance {
  id: StatusId;
  remaining: number;
  total: number;
  value: number;
  /** player id that applied it (for contribution), null for monsters */
  sourcePlayer: number | null;
}

// ─────────────────────────── Data-driven skills ───────────────────────────

export type AreaShape =
  | { shape: 'circle'; radius: number }
  | { shape: 'single' }
  /** Rectangle starting at caster, pointing at center. */
  | { shape: 'line'; length: number; width: number };

/** Who an action touches, relative to the caster's team. 'allies' = every ally character/summon on field (all players). */
export type Affects = 'enemies' | 'allies' | 'self';

export type Effect =
  /** amount × caster atk */
  | { kind: 'damage'; amount: number }
  /** amount × target maxHp */
  | { kind: 'heal'; amount: number }
  /** amount × target maxHp, absorbs damage, expires after duration */
  | { kind: 'shield'; amount: number; duration: number }
  | { kind: 'status'; status: StatusId; duration: number; value: number }
  /** Push away from action center. */
  | { kind: 'knockback'; distance: number }
  /** Pull toward action center (never past it). */
  | { kind: 'pull'; distance: number }
  /** Remove all debuffs. */
  | { kind: 'cleanse' }
  /** Reduce the caster player's bench swap cooldowns. Applied ONCE per action to the owner player, not per target. */
  | { kind: 'swapCooldownReduce'; seconds: number };

export interface SkillAction {
  /**
   * point  = the drop point (drag skill / pet). For normal/ult it means the current target's position.
   * self   = caster position.
   * target = current target position (falls back to self when no target).
   */
  center: 'point' | 'self' | 'target';
  area: AreaShape;
  affects: Affects;
  effects: Effect[];
  /** Seconds before it resolves (shows a telegraph while waiting). */
  delay?: number;
  /** Repeat the effects `hits` times, hitInterval apart. Default 1. */
  hits?: number;
  hitInterval?: number;
  /** Leave a persistent circle that re-applies effects every tickInterval for duration. */
  zone?: { duration: number; tickInterval: number };
  /** Spawn units at center. countMax (optional): roll count..countMax (inclusive) per cast. */
  summon?: { unitId: string; count: number; duration: number; countMax?: number };
}

export interface SkillDef {
  id: string;
  name: string;
  slot: SkillSlot;
  description: string;
  /** Normal skill only. Drag skill cooldown = CharacterDef.swapCooldown. Ult uses the shared gauge. */
  cooldown?: number;
  /** Normal skill only: cast when current target is within this edge distance. */
  castRange?: number;
  /** Cast time during which the caster stands still. */
  castTime?: number;
  actions: SkillAction[];
}

export interface PassiveDef {
  id: string;
  name: string;
  description: string;
  /** Always-on while this character is on field. */
  stats?: StatMods;
  /** Status given to self on appearing. */
  onAppear?: { status: StatusId; duration: number; value: number };
  /** Chance per basic-attack hit to apply a status to the hit target. */
  onHitStatus?: { chance: number; status: StatusId; duration: number; value: number };
  /** atk bonus that scales linearly from 0 at full HP to this value at 0 HP. */
  lowHpAtkBonus?: number;
  /** Heals allies within radius by fraction of their maxHp per second. */
  aura?: { radius: number; healPerSec: number };
}

export type BasicAttack =
  | { kind: 'melee'; splashRadius?: number }
  | { kind: 'projectile'; speed: number; splashRadius?: number }
  /** Monster only: runs into target and explodes (amount × atk to enemies in radius), dying. */
  | { kind: 'explode'; radius: number; amount: number };

// ─────────────────────────── Content defs ───────────────────────────

export interface CharacterDef {
  id: string;
  name: string;
  role: Role;
  /** Placeholder art color. */
  color: string;
  stats: StatBlock;
  /** Re-appearance cooldown in seconds (8~12). This IS the drag-skill cooldown. Starts when the character appears. */
  swapCooldown: number;
  basic: BasicAttack;
  passive: PassiveDef;
  normal: SkillDef;
  drag: SkillDef;
  ult: SkillDef;
}

export interface PetDef {
  id: string;
  name: string;
  color: string;
  description: string;
  cooldown: number;
  /** center is always the drop point. */
  action: SkillAction;
}

export type MonsterTier = 'normal' | 'mid' | 'boss' | 'summon';

export interface MonsterSkill {
  id: string;
  name: string;
  cooldown: number;
  /** First use after this many seconds alive. */
  initialDelay?: number;
  /** Cast when current target within this edge distance (omit = any distance). */
  castRange?: number;
  action: SkillAction;
}

export interface MonsterDef {
  id: string;
  name: string;
  tier: MonsterTier;
  color: string;
  /** Body radius in units. */
  radius: number;
  stats: StatBlock;
  basic: BasicAttack;
  skills?: MonsterSkill[];
  /** Boss/static units never move. */
  stationary?: boolean;
}

export interface BossDef extends MonsterDef {
  tier: 'boss';
  /** Patterns cycle in order on their own cooldowns. Telegraphed via action.delay. */
  skills: MonsterSkill[];
  /** Applied when floor time runs out. */
  enrage: { atkMult: number; atkSpeedMult: number; cooldownMult: number; summonCountMult: number };
}

/** Summoned ally units (pets, skills) use MonsterDef shape with tier 'summon'. */
export type SummonDef = MonsterDef;

export type RewardScope = 'party' | 'character';

export type RewardEffect =
  /** Party-wide stat bonus for all of the player's characters. */
  | { kind: 'stat'; mods: StatMods }
  /** Bound to one character when rolled. mod applies to that character's skill slot. */
  | { kind: 'skill'; slot: 'normal' | 'drag' | 'ult' | 'basic'; stat: 'damage' | 'radius' | 'cooldown'; value: number }
  /** Bound to one character: reduce its swap cooldown by value seconds (min 4). */
  | { kind: 'swapCooldown'; value: number }
  /** Shield on appear: fraction of maxHp for 4s. */
  | { kind: 'appearShield'; value: number }
  /** Pet cooldown pct reduction. */
  | { kind: 'petCooldown'; value: number };

export interface RewardDef {
  id: string;
  name: string;
  /** May contain {char} placeholder, replaced by the bound character's name. */
  description: string;
  rarity: Rarity;
  scope: RewardScope;
  effect: RewardEffect;
}

export interface RelicDef {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  /** Free-form numeric params read by the sim's relic hooks (keyed by relic id). */
  params: Record<string, number>;
}

// ─────────────────────────── Floor plan ───────────────────────────

export interface WavePlan {
  /** Seconds after floor start. */
  at: number;
  spawns: { monsterId: string; count: number }[];
}

export interface FloorPlan {
  floor: number;
  kind: 'normal' | 'boss';
  timeLimit: number;
  arena: { width: number; height: number };
  /** Monster stat multiplier for this floor (hp & atk). */
  statMult: number;
  waves: WavePlan[];
  /** Normal floors: exactly one mid boss. */
  midBossId?: string;
  bossId?: string;
}

// ─────────────────────────── Runtime state (read model) ───────────────────────────

export type EntityKind = 'character' | 'monster' | 'summon';

export interface Entity {
  id: number;
  kind: EntityKind;
  team: Team;
  defId: string;
  tier: MonsterTier | 'character';
  pos: Vec2;
  radius: number;
  /** Radians, 0 = +x. */
  facing: number;
  hp: number;
  maxHp: number;
  shield: number;
  statuses: StatusInstance[];
  targetId: number | null;
  /** Seconds the current target has been held (for the optional boss-lock-release debug toggle). */
  targetHeldFor: number;
  /** Owning player for characters & ally summons. */
  ownerPlayer: number | null;
  /** Character's index in owner party. */
  partyIndex: number | null;
  anim: 'idle' | 'move' | 'attack' | 'cast' | 'appear' | 'stunned';
  /** Seconds left of the current anim (attack/cast/appear). */
  animTime: number;
  invulnTime: number;
  /** Summon lifetime left, null = permanent. */
  expiresIn: number | null;
  enraged: boolean;
}

export interface PartyMember {
  defId: string;
  hp: number;
  maxHp: number;
  shield: number;
  statuses: StatusInstance[];
  dead: boolean;
  /** Seconds until revive (0 when alive). */
  reviveRemaining: number;
  /** Seconds until this character may be dragged in again. Starts at swapCooldown when it appears. */
  swapCooldownRemaining: number;
  swapCooldownTotal: number;
  normalCooldownRemaining: number;
  /** Entity id while on field. */
  entityId: number | null;
}

export interface PetSlot {
  defId: string;
  cooldownRemaining: number;
  cooldownTotal: number;
}

export interface ContributionStats {
  damageDealt: number;
  damageToBoss: number;
  damageTaken: number;
  healing: number;
  kills: number;
  swaps: number;
  ultsUsed: number;
  petsUsed: number;
  damageBySource: Record<DamageSource, number>;
  /** Sum of seconds between ult gauge full and ult used. */
  ultDelayTotal: number;
  ultDelayCount: number;
}

export interface AppliedReward {
  rewardId: string;
  /** Bound character party index for character-scoped rewards. */
  partyIndex: number | null;
}

export interface PlayerState {
  id: number;
  name: string;
  isBot: boolean;
  /** Placeholder color for this player's ring/marker. */
  color: string;
  party: PartyMember[];
  /** Party index on field, null = field empty. */
  activeIndex: number | null;
  pets: PetSlot[];
  ult: { charge: number; fullSince: number | null };
  /** 사망: all 3 characters dead at the same moment. Spectating for rest of run. */
  out: boolean;
  /** Seconds left where swapping is blocked after an appearance. */
  appearLock: number;
  relics: string[];
  rewards: AppliedReward[];
  stats: ContributionStats;
}

export interface Telegraph {
  id: number;
  team: Team;
  center: Vec2;
  /** Line telegraphs start here and point toward center. */
  origin: Vec2;
  area: AreaShape;
  remaining: number;
  total: number;
}

export interface Zone {
  id: number;
  team: Team;
  ownerPlayer: number | null;
  center: Vec2;
  radius: number;
  remaining: number;
  total: number;
  /** For render tint. */
  kind: 'damage' | 'heal' | 'buff' | 'debuff';
}

export interface Projectile {
  id: number;
  team: Team;
  pos: Vec2;
  /** Homing on entity, or flying to a fixed point. */
  targetId: number | null;
  targetPos: Vec2;
  speed: number;
  color: string;
}

export interface RewardOffer {
  rewardId: string;
  /** For character-scoped rewards. */
  partyIndex: number | null;
  /** Resolved display text (placeholders filled). */
  name: string;
  description: string;
  rarity: Rarity;
  isRelic: boolean;
}

export type SimPhase = 'combat' | 'reward' | 'runOver';

export interface RunResult {
  outcome: 'victory' | 'defeat';
  reason: 'timeout' | 'wipe' | 'cleared' | 'quit';
  floorReached: number;
  duration: number;
}

export interface GameState {
  seed: number;
  tick: number;
  /** Sim seconds since run start (frozen during reward phase). */
  time: number;
  phase: SimPhase;
  floor: number;
  plan: FloorPlan;
  /** Seconds since floor start. */
  floorTime: number;
  timeRemaining: number;
  entities: Entity[];
  players: PlayerState[];
  telegraphs: Telegraph[];
  zones: Zone[];
  projectiles: Projectile[];
  /** Boss entity id on boss floors. */
  bossId: number | null;
  bossEnraged: boolean;
  /** Normal floors: waves not yet spawned + monsters alive. */
  wavesRemaining: number;
  monstersAlive: number;
  midBossSpawned: boolean;
  /** Offers for the local human player (player 0) during 'reward'. Bots choose instantly. */
  rewardOffers: RewardOffer[] | null;
  runResult: RunResult | null;
}

// ─────────────────────────── Commands & events ───────────────────────────

export type DebugAction =
  | { kind: 'chargeUlt' }
  | { kind: 'resetCooldowns' }
  | { kind: 'killAll' }
  | { kind: 'skipFloor' }
  | { kind: 'jumpFloor'; floor: number }
  | { kind: 'forceEnrage' };

export type Command =
  | { type: 'swap'; player: number; partyIndex: number; pos: Vec2 }
  | { type: 'pet'; player: number; petIndex: number; pos: Vec2 }
  | { type: 'ult'; player: number }
  | { type: 'chooseReward'; player: number; offerIndex: number }
  | { type: 'quit' }
  | { type: 'debug'; action: DebugAction };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export type GameEvent =
  | { type: 'damage'; targetId: number; amount: number; crit: boolean; pos: Vec2; targetTeam: Team; absorbed: number }
  | { type: 'heal'; targetId: number; amount: number; pos: Vec2 }
  | { type: 'attack'; sourceId: number; targetId: number; ranged: boolean }
  | { type: 'skillCast'; sourceId: number | null; player: number | null; slot: SkillSlot | 'pet' | 'monster'; skillId: string; name: string; center: Vec2; area: AreaShape; team: Team }
  | { type: 'appear'; player: number; partyIndex: number; entityId: number; pos: Vec2 }
  | { type: 'leave'; player: number; partyIndex: number; pos: Vec2 }
  | { type: 'death'; entityId: number; pos: Vec2; kind: EntityKind; tier: MonsterTier | 'character' }
  | { type: 'spawnWarning'; pos: Vec2; delay: number }
  | { type: 'spawn'; entityId: number; pos: Vec2; tier: MonsterTier }
  | { type: 'revive'; player: number; partyIndex: number }
  | { type: 'playerOut'; player: number }
  | { type: 'ultReady'; player: number }
  | { type: 'floorStart'; floor: number; kind: 'normal' | 'boss' }
  | { type: 'floorClear'; floor: number }
  | { type: 'enrage' }
  | { type: 'bossRetreat' }
  | { type: 'runOver'; result: RunResult };

// ─────────────────────────── Tunables (debug sliders) ───────────────────────────

export interface Tunables {
  gameSpeed: number;
  swapCooldownMult: number;
  ultChargeTime: number;
  reviveTime: number;
  reviveHpFrac: number;
  floorHealFrac: number;
  appearLockTime: number;
  appearInvulnTime: number;
  botDamageMult: number;
  monsterHpMult: number;
  monsterDmgMult: number;
  floorStatGrowth: number;
  normalFloorTime: number;
  bossFloorTime: number;
  waveInterval: number;
  maxAliveMonsters: number;
  maxFloor: number;
  midBossKillTrigger: number;
  midBossTimeTrigger: number;
  /** 0 = off. Otherwise characters drop a boss target after this many seconds (debug comparison for Q4). */
  bossLockReleaseSec: number;
  petCooldownMult: number;
  invincible: boolean;
  instantCooldowns: boolean;
}

// ─────────────────────────── Module APIs ───────────────────────────

export interface PlayerSetup {
  name: string;
  isBot: boolean;
  /** 3 CharacterDef ids, index 0 starts on field. */
  characters: string[];
  /** 3 PetDef ids. */
  pets: string[];
}

export interface GameSetup {
  seed: number;
  /** Index 0 is the local human player. */
  players: PlayerSetup[];
  tunables: Tunables;
  startFloor?: number;
}

/** Implemented by src/sim (createGame). */
export interface Game {
  readonly state: GameState;
  /** Live-editable; the debug panel mutates fields directly. */
  readonly tunables: Tunables;
  dispatch(cmd: Command): CommandResult;
  /** Advance by real seconds (sim applies tunables.gameSpeed and runs fixed 1/30s ticks internally). */
  step(realDt: number): void;
  /** Events since last drain, oldest first. */
  drainEvents(): GameEvent[];
  canSwap(player: number, partyIndex: number): CommandResult;
  canUsePet(player: number, petIndex: number): CommandResult;
  /** Area to preview while dragging a card (drag skill or pet action, including reward/relic radius bonuses). */
  previewArea(player: number, kind: 'swap' | 'pet', index: number): AreaShape;
  /** Clamp/snap a drop point to a legal spot in the arena. */
  clampToArena(p: Vec2): Vec2;
  /** Per-run telemetry for the tuning log. */
  telemetry(): Telemetry;
}

export interface Telemetry {
  swapsPerMinute: number;
  damageShareBySource: Record<DamageSource, number>;
  avgUltDelay: number;
  floorTimes: { floor: number; seconds: number; outcome: 'clear' | 'fail' }[];
}

export interface DragPreview {
  kind: 'swap' | 'pet';
  /** World position under the finger (already offset above the finger by the ui). */
  pos: Vec2;
  area: AreaShape;
  valid: boolean;
  color: string;
}

export interface RenderUiState {
  localPlayer: number;
  dragPreview: DragPreview | null;
  /** Freeze camera while dragging. */
  freezeCamera: boolean;
}

/** Implemented by src/render (createRenderer). Canvas is a fixed 1280×720 logical surface. */
export interface Renderer {
  render(state: GameState, events: GameEvent[], realDt: number, ui: RenderUiState): void;
  /** Logical canvas px (0..1280, 0..720) → world. */
  screenToWorld(p: Vec2): Vec2;
  /** World → logical canvas px. */
  worldToScreen(v: Vec2): Vec2;
}

export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;
