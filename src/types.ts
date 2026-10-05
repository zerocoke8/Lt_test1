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

/** Fixed world direction. Quarter view: 'up' = −y (toward the back / top of screen), 'down' = +y. */
export type Dir = 'right' | 'left' | 'up' | 'down';

export type AreaShape =
  | { shape: 'circle'; radius: number }
  | { shape: 'single' }
  /** Rectangle starting at caster, pointing at center (auto-aimed; normal skills / monsters). */
  | { shape: 'line'; length: number; width: number }
  /**
   * Fixed-direction rectangle (기획 3차: 방향형 드래그스킬은 방향 고정, 위치로 조준).
   * anchor 'start' (default): begins at center and extends `length` toward dir. 'center': centered on center.
   */
  | { shape: 'rect'; length: number; width: number; dir: Dir; anchor?: 'start' | 'center' }
  /** Fan from center toward dir, total opening `angle` degrees. */
  | { shape: 'cone'; radius: number; angle: number; dir: Dir }
  /** Donut around center: inner < distance ≤ outer. */
  | { shape: 'ring'; inner: number; outer: number }
  /** Two bars through center: '+' (or 'X' when diagonal), each arm `length` from center, bar thickness `width`. */
  | { shape: 'cross'; length: number; width: number; diagonal?: boolean }
  /** Auto-aimed cone (기획 8차, monsters): fan from the caster toward center, total opening `angle` degrees. */
  | { shape: 'fan'; radius: number; angle: number };

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
  /** Push away from action center, or toward a fixed dir when given. */
  | { kind: 'knockback'; distance: number; dir?: Dir }
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
  /** Fixed world offset added to the resolved center, so one skill can hit several spots (e.g. a row of blasts). */
  offset?: Vec2;
  /**
   * Caster dashes from the resolved center toward dir by distance (drag skill: appear at the drop point, then dash).
   * The caster ends at the clamped end point; effects hit along the path (pair with area {shape:'rect', dir, length: distance}).
   */
  dash?: { dir: Dir; distance: number; duration?: number };
  /**
   * 기획 8차 (monsters): the caster rushes from where it stands toward the resolved center by up to `distance`
   * (after `delay`), hitting along the path (pair with area {shape:'line'}). Emits 'dash'.
   */
  charge?: { distance: number; duration?: number };
  /** 기획 8차 (monsters): the caster teleports next to its current target before the action resolves. Emits 'blink'. */
  blink?: { offset: number };
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
  /**
   * 기획 8차: more parts cast together with `action` (each with its own offset/delay) — sweeps, volleys, countdowns.
   * Each part emits its own skillCast + telegraph; a stun breaks every part that has not landed yet.
   */
  extra?: SkillAction[];
  /** 기획 8차 리뷰: a one-time tip shown (once per device) the first time a boss casts it — how to deal with it. */
  hint?: string;
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
  /** 기획 8차: what happens when it dies (e.g. 복사 인간 splits into copies, a phone explodes). */
  onDeath?: { summon?: { unitId: string; count: number }; action?: SkillAction };
  /** 기획 8차: render theme hint (괴담 / urban anomaly look). */
  look?: string;
}

export interface BossDef extends MonsterDef {
  tier: 'boss';
  /** Patterns cycle in order on their own cooldowns. Telegraphed via action.delay. */
  skills: MonsterSkill[];
  /** Applied when floor time runs out. */
  enrage: { atkMult: number; atkSpeedMult: number; cooldownMult: number; summonCountMult: number };
  /**
   * 기획 8차: HP thresholds (fraction of max, descending). Crossing one emits 'bossPhase' once, adds its skills to the
   * rotation and applies its multipliers (stacking with enrage).
   */
  phases?: { hpBelow: number; name?: string; skills?: MonsterSkill[]; atkSpeedMult?: number; cooldownMult?: number }[];
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

// ─────────────────────────── 괴담 방 (기획 10차, docs/goedam-rooms.md) ───────────────────────────
// Between-floor anomaly rooms: after the reward of a scheduled floor everyone enters the same room and each player picks
// one option (by id). Numbers live in src/data/goedam.ts; every button/result text is generated from them.

/** Risk chip on an option button (〔안전〕〔대가〕〔도박〕〔관찰〕〔영구〕). */
export type GoedamTag = 'safe' | 'cost' | 'gamble' | 'observe' | 'permanent';

/** 끝나지 않는 복도: the one thing that differs from the usual corridor. */
export type GoedamAnomaly = 'clock' | 'door' | 'light';

/** What an option does to the chooser's own party (never to other players, never to the next floor's monsters). */
export type GoedamEffect =
  /** Living members (field + bench): current HP × (1 − pct), never below 1. */
  | { kind: 'hpLoss'; pct: number }
  /** Living members heal pct × max HP (1 = full). */
  | { kind: 'heal'; pct: number }
  /** Dead members revive now with hpFrac × max HP (revive event as usual). */
  | { kind: 'revive'; hpFrac: number }
  /** Ult gauge set to value (0..1). */
  | { kind: 'ultSet'; value: number }
  | { kind: 'ultAdd'; value: number }
  /** 모든 쿨 0 (swap + normal skill of every member, every pet) or 펫 쿨 0. */
  | { kind: 'resetCooldowns'; petsOnly?: boolean }
  /** One normal reward drawn with these rarity weights (percent). */
  | { kind: 'reward'; weights: Record<Rarity, number> }
  /** This exact reward (party scope). */
  | { kind: 'rewardFixed'; rewardId: string }
  /** Another copy of GoedamParams.copy (the most recent common/rare reward). */
  | { kind: 'copyReward' }
  /** GoedamParams.relicId; a player who owns every relic gets an epic reward instead. */
  | { kind: 'relic' }
  | { kind: 'trace'; traceId: string };

export interface GoedamOutcomeDef {
  id: string;
  /** Probability 0..1 (an option's outcomes sum to 1). Absent when `when` decides. */
  chance?: number;
  /** 끝나지 않는 복도: happens when the corridor looked as usual ('normal') or not ('anomaly'). */
  when?: 'normal' | 'anomaly';
  /** Result card title. */
  title: string;
  tone: 'good' | 'bad' | 'neutral';
  effects: GoedamEffect[];
}

export interface GoedamOptionDef {
  /** Stable id; every room's last option is 'leave' (bots / timeout / disconnect pick it). */
  id: string;
  label: string;
  /** Past tense for the 수첩 and the wait panel ('돌아봤다'). */
  done: string;
  tags: GoedamTag[];
  /** Fixed cost paid before the roll. */
  cost?: GoedamEffect[];
  outcomes: GoedamOutcomeDef[];
  /** 'copy': hidden for a player with no common/rare reward to copy. */
  needs?: 'copy';
}

export interface GoedamRoomDef {
  id: string;
  name: string;
  /** Zone it appears in ('any' = 저주받은 유물, floors 6–19). */
  zone: FloorTheme | 'any';
  /** Floors (cleared) it may follow, inclusive. Absent = the whole zone. */
  floors?: { min: number; max: number };
  weight: number;
  /** Weight multiplier after specific floors (엘리베이터: ×2 after floor 4). */
  floorWeight?: Record<number, number>;
  /** Placeholder art glyph. */
  icon: string;
  /** Scene text; {n} = the floor just cleared. */
  desc: string;
  /** Rule note (규칙 쪽지), if the room has one. */
  rule?: string;
  options: GoedamOptionDef[];
}

/** 흔적: a timed (or run-long) curse/blessing. v1 traces only touch stats, ult charge rate and damage taken. */
export interface GoedamTraceDef {
  id: string;
  name: string;
  icon: string;
  /** Floors it lasts (expires at the Nth floor clear, before the heal); null = until the run ends. */
  floors: number | null;
  /** Party stat mods (critChance only ever +). */
  mods?: Pick<StatMods, 'atkPct' | 'hpPct' | 'atkSpeedPct' | 'moveSpeedPct' | 'critChance'>;
  /** Extra damage taken by my characters (+0.12 = +12%, −0.1 = −10%). */
  damageTaken?: number;
  /** Ult charge speed (−0.3 = 30% slower: 30 s → ~43 s). */
  ultCharge?: number;
  /** Floor-start banner flavor ('동승자가 따라 내렸다'). */
  banner: string;
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
  /** 기획 8차: floor zone (1–5 로비·상가, 6–10 사무실, 11–15 폐병동, 16–20 옥상·이계) — drives pools and the background. */
  theme?: FloorTheme;
}

export type FloorTheme = 'lobby' | 'office' | 'ward' | 'rooftop';

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
  /** Multiplayer: this human dropped; a bot drives the slot until they reconnect. */
  disconnected?: boolean;
  /** Seconds left where swapping is blocked after an appearance. */
  appearLock: number;
  relics: string[];
  rewards: AppliedReward[];
  stats: ContributionStats;
  /** 기획 10차: active 흔적 (traces), oldest first. */
  goedamTraces: GoedamTraceSlot[];
  /** 기획 10차: 괴담 수첩 — every room this player went through (result screen, benches). */
  goedamLog: GoedamLogEntry[];
}

export interface GoedamTraceSlot {
  id: string;
  /** Floor clears left before it expires; null = until the run ends. */
  floorsLeft: number | null;
}

/** What a player's pick did (state, log and result card all use it). */
export interface GoedamOutcome {
  /** GoedamOutcomeDef.id ('leave' for the 지나간다 option). */
  id: string;
  /** Reward granted (rolled, copied, fixed, or the relic fallback). */
  reward: AppliedReward | null;
  relicId: string | null;
  /** Traces added or refreshed. */
  traces: string[];
}

/** Per-player values fixed when the room opens (from that player's room rng / party). */
export interface GoedamParams {
  /** 저주받은 유물: a relic this player lacks (null = owns them all → an epic reward instead). */
  relicId?: string | null;
  /** 원본을 넣어 주세요: the reward the copier copies (null = nothing to copy → option hidden). */
  copy?: AppliedReward | null;
  /** 끝나지 않는 복도: what this player sees differ (null = all as usual). */
  anomaly?: GoedamAnomaly | null;
}

export type GoedamStage = 'choosing' | 'result' | 'done';

export interface GoedamProgress {
  stage: GoedamStage;
  /** The room's options in order; hidden ones are not offered to this player. */
  options: { id: string; hidden: boolean }[];
  params: GoedamParams;
  /** Option id once chosen. */
  choice: string | null;
  outcome: GoedamOutcome | null;
}

/** The open room (SimPhase 'goedam'). Results are fixed by seed + floor + player, whatever the click order. */
export interface GoedamState {
  roomId: string;
  /** The floor just cleared (the room sits between it and the next one). */
  floor: number;
  /** '3½층' */
  label: string;
  /** By player index. */
  players: GoedamProgress[];
}

export interface GoedamLogEntry {
  floor: number;
  label: string;
  roomId: string;
  optionId: string;
  outcome: GoedamOutcome;
  /** Picked by the bot (bot slot or a disconnected human). */
  auto: boolean;
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
  /** Circle zones: their radius. Other shapes: rough reach from center (see `area`). */
  radius: number;
  /** Exact footprint (3차: rect/ring/cross/cone zones). Absent = circle of `radius`. */
  area?: AreaShape;
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

/** 'goedam' (기획 10차): the 괴담 room after the reward phase, time frozen like 'reward'. */
export type SimPhase = 'combat' | 'reward' | 'goedam' | 'runOver';

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
  /** Offers for player 0 during 'reward' (kept for compatibility; = rewardOffersByPlayer[0]). */
  rewardOffers: RewardOffer[] | null;
  /**
   * Per player index: offers still waiting for that human's choice, null when none / already chosen.
   * The reward phase lasts until every non-bot, non-out player has chosen (bots pick instantly).
   */
  rewardOffersByPlayer: (RewardOffer[] | null)[];
  /** 기획 10차: the open 괴담 room (phase 'goedam'), else null. */
  goedam: GoedamState | null;
  runResult: RunResult | null;
}

// ─────────────────────────── Commands & events ───────────────────────────

export type DebugAction =
  /** player defaults to 0 (in multiplayer the server fills in the sender). */
  | { kind: 'chargeUlt'; player?: number }
  | { kind: 'resetCooldowns'; player?: number }
  | { kind: 'killAll' }
  | { kind: 'skipFloor' }
  | { kind: 'jumpFloor'; floor: number }
  | { kind: 'forceEnrage' }
  /** 기획 10차: open a 괴담 room after the next floor clear (room id, or a fitting one for that floor). */
  | { kind: 'goedamNext'; room?: string };

export type Command =
  | { type: 'swap'; player: number; partyIndex: number; pos: Vec2 }
  | { type: 'pet'; player: number; petIndex: number; pos: Vec2 }
  | { type: 'ult'; player: number }
  | { type: 'chooseReward'; player: number; offerIndex: number }
  /** 기획 10차: pick a 괴담 room option by id, or 'continue' after reading the result card. */
  | { type: 'goedam'; player: number; option: string }
  | { type: 'quit' }
  | { type: 'debug'; action: DebugAction }
  /** Live tunables change (debug panel). In multiplayer only the room host may send it. */
  | { type: 'tunables'; patch: Partial<Tunables> };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export type GameEvent =
  | {
      type: 'damage';
      targetId: number;
      amount: number;
      crit: boolean;
      pos: Vec2;
      targetTeam: Team;
      absorbed: number;
      /** What dealt it (render: skill numbers look different from basic attacks). Optional for old snapshots/tests. */
      source?: DamageSource;
      /** Skill name for normal/drag/ult hits (render: tiny label under the number). */
      skillName?: string;
    }
  | { type: 'heal'; targetId: number; amount: number; pos: Vec2 }
  | { type: 'attack'; sourceId: number; targetId: number; ranged: boolean }
  | {
      type: 'skillCast';
      sourceId: number | null;
      player: number | null;
      slot: SkillSlot | 'pet' | 'monster';
      skillId: string;
      name: string;
      center: Vec2;
      area: AreaShape;
      team: Team;
      /** Seconds until this part lands (telegraphed multi-part skills, e.g. meteors). Absent = instant. */
      delay?: number;
      /** Repeated hits (ult flurries): count and spacing. Absent = one hit. */
      hits?: number;
      hitInterval?: number;
    }
  | { type: 'appear'; player: number; partyIndex: number; entityId: number; pos: Vec2 }
  /** Caster moved along a dash (render a streak; entity pos is already at `to`). */
  | { type: 'dash'; entityId: number; from: Vec2; to: Vec2; duration: number }
  /** 기획 8차: a monster teleported (render a vanish/appear). */
  | { type: 'blink'; entityId: number; from: Vec2; to: Vec2 }
  /** 기획 8차: a boss crossed an HP threshold. */
  | { type: 'bossPhase'; entityId: number; phase: number; name: string }
  | { type: 'leave'; player: number; partyIndex: number; pos: Vec2 }
  | { type: 'death'; entityId: number; pos: Vec2; kind: EntityKind; tier: MonsterTier | 'character' }
  | { type: 'spawnWarning'; pos: Vec2; delay: number }
  /** A stun broke a monster's telegraphed wind-up: its red area is gone and nothing lands (render: "끊김!", no impact). */
  | { type: 'interrupt'; sourceId: number | null; telegraphId: number | null; pos: Vec2; name: string }
  | { type: 'spawn'; entityId: number; pos: Vec2; tier: MonsterTier }
  | { type: 'revive'; player: number; partyIndex: number }
  | { type: 'playerOut'; player: number }
  | { type: 'ultReady'; player: number }
  | { type: 'floorStart'; floor: number; kind: 'normal' | 'boss' }
  | { type: 'floorClear'; floor: number }
  | { type: 'enrage' }
  | { type: 'bossRetreat' }
  | { type: 'runOver'; result: RunResult }
  /** 기획 10차: a 괴담 room opened (state.goedam holds the rest). */
  | { type: 'goedamOpen'; floor: number; roomId: string }
  /** A player's pick resolved (bots and auto-leaves too). */
  | { type: 'goedamOutcome'; player: number; optionId: string; outcomeId: string; tone: GoedamOutcomeDef['tone'] }
  /** A trace was added or refreshed. */
  | { type: 'goedamTrace'; player: number; traceId: string; floorsLeft: number | null }
  | { type: 'goedamTraceExpired'; player: number; traceId: string };

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
  /** 기획 10차: 괴담 rooms per zone (0 = off, 1 = default, 2 max). */
  goedamRoomsPerZone: number;
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
  /** Area to preview while dragging a card (drag skill or pet action, including reward/relic radius bonuses). First part only. */
  previewArea(player: number, kind: 'swap' | 'pet', index: number): AreaShape;
  /** Full footprint for the drag preview (every action with offsets/dash, radius bonuses applied). */
  previewParts(player: number, kind: 'swap' | 'pet', index: number): PreviewPart[];
  /** Hand a player slot to the bot (multiplayer disconnect) or back to its human. Sets PlayerState.isBot/disconnected. */
  setPlayerBot(player: number, isBot: boolean): void;
  /** Clamp/snap a drop point to a legal spot in the arena. */
  clampToArena(p: Vec2): Vec2;
  /** Per-run telemetry for the tuning log (player defaults to 0). */
  telemetry(player?: number): Telemetry;
}

export interface Telemetry {
  swapsPerMinute: number;
  damageShareBySource: Record<DamageSource, number>;
  avgUltDelay: number;
  floorTimes: { floor: number; seconds: number; outcome: 'clear' | 'fail' }[];
  /** 기획 10차: this player's 괴담 수첩 (absent on old snapshots). */
  goedam?: GoedamLogEntry[];
}

/** One piece of a drag/pet skill footprint, relative to the drop point (for previews and bot aiming). */
export interface PreviewPart {
  area: AreaShape;
  /** World offset from the drop point. */
  offset: Vec2;
  /** Seconds after the drop when this part lands (0 = instantly). */
  delay: number;
  affects: Affects;
  dash?: { dir: Dir; distance: number };
}

export interface DragPreview {
  kind: 'swap' | 'pet';
  /** World position under the finger (already offset above the finger by the ui). */
  pos: Vec2;
  area: AreaShape;
  /** Full footprint (all actions, offsets, dash). When present the renderer draws these instead of `area`. */
  parts?: PreviewPart[];
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
