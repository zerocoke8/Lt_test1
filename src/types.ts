// Shared contract between sim / render / ui.
// The sim owns and mutates GameState; render and ui only read it and talk back through Command.
// World units: 1 unit ≈ one character width. Ground plane is (x, y); y grows toward the camera (screen-down).

export type Vec2 = { x: number; y: number };

/** 기획 12차: 'healer' split off 'support' (탱커 / 근접딜러 / 원거리딜러 / 힐러 / 서포터, 3 each). */
export type Role = 'tank' | 'melee' | 'ranged' | 'healer' | 'support';
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
  | 'lifesteal' // value = fraction of damage dealt healed
  /** 기획 12차 (흡혼 표식, enemies): value = fraction of damage dealt to this enemy that heals the attacker. */
  | 'drain'
  // 기획 13차 스킬 리뉴얼 (docs/skill-renewal.md 5-2): enemy control statuses + one ally buff
  /** 도발: the enemy must target data.sourceEntityId (released when that unit dies / leaves). Bosses, mid bosses, stationary immune. */
  | 'taunt'
  /** 묶기: cannot move farther than value (= data.radius) from data.anchor. Bosses / mid bosses immune. */
  | 'tether'
  /** 속박: cannot move at all, still attacks (a tether of radius 0 at the spot it was rooted). */
  | 'root'
  /**
   * 정지: no move / attack / wind-up / cooldowns (telegraphed attacks are postponed, not broken). Damage taken is stored
   * (data.stored); when it ends the unit takes value × stored once more ('stasisEnd'). Bosses / mid bosses: ×0.6 time,
   * then STASIS.immune s immune.
   */
  | 'stasis'
  /** 조종: attacks the nearest other enemy; its hits count for the player who charmed it. Bosses / mid / summons immune. */
  | 'charm'
  /** Ally buff: basic-attack splash radius +value (a character without splash gets one). */
  | 'splashUp';

export const DEBUFFS: ReadonlySet<StatusId> = new Set<StatusId>(['stun', 'slow', 'burn', 'atkDown', 'vulnerable', 'drain', 'taunt', 'tether', 'root', 'stasis', 'charm']);

/** 기획 13차: the control statuses that come with a 'statusApplied' event (head icons / sounds). */
export const CONTROL_STATUSES: ReadonlySet<StatusId> = new Set<StatusId>(['taunt', 'tether', 'root', 'stasis', 'charm']);

/** 기획 13차: per-instance data of the new statuses (taunt: who; tether / root: where; stasis: damage stored). */
export interface StatusData {
  sourceEntityId?: number;
  anchor?: Vec2;
  radius?: number;
  stored?: number;
}

export interface StatusInstance {
  id: StatusId;
  remaining: number;
  total: number;
  value: number;
  /** player id that applied it (for contribution), null for monsters */
  sourcePlayer: number | null;
  /** 기획 13차: only on taunt / tether / root / stasis. */
  data?: StatusData;
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
  /** amount × caster atk. crit 'always' (기획 13차): a guaranteed critical hit (no roll). */
  | { kind: 'damage'; amount: number; crit?: 'always' }
  /**
   * amount × target maxHp. overflowShield (기획 13차, 클레릭): the part that overflows max HP becomes a shield of frac ×
   * overflow, never making this source's shield exceed cap × maxHp, for duration s.
   */
  | { kind: 'heal'; amount: number; overflowShield?: { frac: number; cap: number; duration: number } }
  /** amount × target maxHp, absorbs damage, expires after duration */
  | { kind: 'shield'; amount: number; duration: number }
  | { kind: 'status'; status: StatusId; duration: number; value: number }
  /** Push away from action center, or toward a fixed dir when given. */
  | { kind: 'knockback'; distance: number; dir?: Dir }
  /** Pull toward action center (never past it). */
  | { kind: 'pull'; distance: number }
  /** Remove all debuffs. */
  | { kind: 'cleanse' }
  /**
   * Reduce the caster player's bench swap cooldowns (allPlayers 기획 13차: every non-out player's). Applied ONCE per
   * action, not per target. Emits 'swapCdCut'.
   */
  | {
      kind: 'swapCooldownReduce';
      seconds: number;
      allPlayers?: boolean;
      /**
       * 기획 14차 교체 에너지: in energy mode this cut returns exactly this much energy instead of seconds × regen —
       * a character's own refund that is priced into its swapEnergy (크로노 균열), so the cost table holds at any regen.
       */
      energy?: number;
    }
  /**
   * 기획 12차: amount × member maxHp to the bench (not field, not dead) members of the caster player, or of every non-out
   * player when allPlayers. Applied once per action.
   */
  | { kind: 'benchHeal'; amount: number; allPlayers?: boolean }
  /** 기획 12차: dead members' reviveRemaining −= seconds (min 0); out players skipped. Once per action. Emits 'reviveCut'. */
  | { kind: 'reviveReduce'; seconds: number; allPlayers?: boolean }
  /**
   * 기획 13차 (바드 앙코르): a status on every living bench member of the caster player (allPlayers: of every non-out
   * player). It ticks on the bench and comes onto the field with the card. Once per action; emits 'benchBuff'.
   */
  | { kind: 'benchStatus'; status: StatusId; duration: number; value: number; allPlayers?: boolean };

export interface SkillAction {
  /**
   * point  = the drop point (drag skill / pet). For normal/ult it means the current target's position.
   * self   = caster position.
   * target = current target position (falls back to self when no target).
   * woundedAlly = 기획 12차 (normal skills): the ally with the lowest hp/maxHp within castRange (ties → nearer).
   *   기획 13차 (drag skills): within allyRange of the drop point, every player's characters + the 돌발 괴담 patient.
   */
  center: 'point' | 'self' | 'target' | 'woundedAlly';
  /**
   * 기획 13차 스킬 리뉴얼: stage name (render / sound key `skillId:stage`). Sent on 'skillCast' and 'skillStage'.
   * Several actions may share one stage (e.g. a hit on enemies + a shield on self at the same beat).
   */
  stage?: string;
  /**
   * 기획 13차: a delayed 'self' / 'target' action re-resolves its center (and the caster's attack) when it lands, not when
   * cast; its telegraph follows too. A gone target is replaced by the caster's current target, else its last spot.
   */
  follow?: boolean;
  /** 기획 13차: show the telegraph only for the last N s of the delay (0 = no telegraph). Absent = the whole delay. */
  telegraphLead?: number;
  /** 기획 13차 (woundedAlly drag): search radius around the drop point. */
  allyRange?: number;
  /** 기획 13차: hit only the N nearest targets (distance → id). Targets immune to its statuses are picked last. */
  maxTargets?: number;
  /**
   * 기획 13차 (퇴마사 멸): every enemy this action hit (up to maxHits) heals the allies within radius of its center by
   * amount × their max HP, all at once (heal event from = the first enemy hit).
   */
  healPerHit?: { radius: number; amount: number; maxHits: number };
  /**
   * 기획 13차 (블레이드 순보): `count` hits, `interval` apart: before each, the caster teleports next to an enemy within
   * `radius` of itself (enemies hit fewer times first, then nearer, then lower id; at most maxPerTarget each) and the
   * action hits around it. Emits 'blink' per hop.
   */
  blinkChain?: { count: number; radius: number; interval: number; maxPerTarget: number };
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
  summon?: {
    unitId: string;
    count: number;
    duration: number;
    countMax?: number;
    /** 기획 12차: ally summon stats as fractions of the caster's effective maxHp / atk (종이 인형). */
    inherit?: { hp: number; atk: number };
  };
  /** Fixed world offset added to the resolved center, so one skill can hit several spots (e.g. a row of blasts). */
  offset?: Vec2;
  /**
   * Caster dashes from the resolved center toward dir by distance (drag skill: appear at the drop point, then dash).
   * The caster ends at the clamped end point; effects hit along the path (pair with area {shape:'rect', dir, length: distance}).
   */
  dash?: {
    dir: Dir;
    distance: number;
    duration?: number;
    /** 기획 13차 (거너 반동, 섀도우 질주): the caster moves from where it stands when the action lands, not at cast. */
    atFire?: boolean;
  };
  /**
   * 기획 8차 (monsters): the caster rushes from where it stands toward the resolved center by up to `distance`
   * (after `delay`), hitting along the path (pair with area {shape:'line'}). Emits 'dash'.
   * stopAtCenter (기획 13차, 블레이드 되돌아 베기): the rush ends at the center instead of running past it.
   * An echo_seal recast (noDash) hits along the path without moving the caster.
   */
  charge?: { distance: number; duration?: number; stopAtCenter?: boolean };
  /**
   * 기획 8차 (monsters): the caster teleports next to its current target before the action resolves. Emits 'blink'.
   * behind (기획 13차, 섀도우 월영참): on the far side of the target.
   */
  blink?: { offset: number; behind?: boolean };
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
  /** 기획 12차 (메딕): fraction of maxHp per second for my bench members while this character is on field. */
  benchRegen?: number;
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
  /** Re-appearance cooldown in seconds (8~12). This IS the drag-skill cooldown. Starts when the character leaves. */
  swapCooldown: number;
  /**
   * 기획 14차 교체 에너지 (test toggle Tunables.swapEnergyMode): energy one swap-in of this character costs (4~8),
   * set from the measured drag value per cast so value per energy is about equal (docs/balance.md 13-4).
   */
  swapEnergy: number;
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
  /** 기획 12차: never moves, targets or attacks (종이 인형 decoy). */
  inert?: boolean;
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
  /**
   * 기획 13차 보스 그로기 (docs/boss-groggy.md): this boss has a groggy gauge. threshold = boss multiplier of the gauge max
   * (100 × threshold × human-count multiplier × repeat multiplier). Absent = no gauge.
   */
  groggy?: { threshold: number };
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

// ─── 돌발 괴담 (기획 12차, docs/combat-events.md) ───
// A small timed objective that pops up during combat on normal floors 2–19. Success gives every non-out player the
// same reward; failure only loses the chance. Numbers live in src/data/fieldEvents.ts; the open one is state.fieldEvent.

export type FieldEventId = 'lucky_toad' | 'possessed_printer' | 'sleeping_patient' | 'open_shaft' | 'midnight_surge' | 'dark_lamps' | 'sleepwalker';
/** target = toad/printer (not auto-targeted, drag/pet ×2); minion = 23:59 shadows; ward = patient/child (ally, untouchable, ignored by monsters). */
export type FieldEventTag = 'target' | 'minion' | 'ward';
export type FieldEventProgressKind = 'lamp' | 'fall' | 'kill' | 'startle' | 'heal';

/** Party-wide reward (every non-out player, bots and disconnected seats included). */
export type FieldEventReward =
  /** Ult gauge + value (0..1, capped at full). */
  | { kind: 'ultAdd'; value: number }
  /** Every pet cooldown → 0. */
  | { kind: 'petReset' }
  /** Living members (field + bench) heal pct × max HP; dead members' revive wait − reviveCut s. */
  | { kind: 'healParty'; pct: number; reviveCut: number }
  /** Bench members' swap (re-appear) cooldown → 0. */
  | { kind: 'benchSwapReset' }
  /** A 괴담 trace (GOEDAM_TRACES id). */
  | { kind: 'trace'; traceId: string }
  /** Every enemy on the field: vulnerable +vulnerable for duration s and a stun s stun (bosses skip the stun). */
  | { kind: 'exposeAll'; vulnerable: number; duration: number; stun: number };

export interface FieldEventDef {
  id: FieldEventId;
  name: string;
  icon: string;
  /** The 괴담 line (lore; 기획 12차 리뷰: no longer on the start banner, which keeps to name + goal). */
  premise: string;
  /** What to do, for the banner: 「{s}초 안에 {task}면 모두 …」 ('잡으' → '18초 안에 잡으면'). */
  task: string;
  /** 기획 12차 리뷰: how to do it with the existing controls (banner tip line, the first time each event is seen). */
  how: string;
  /** First floor it may come on. */
  from: number;
  /** Not rolled on the floor right before a boss (its reward would carry into the boss fight: ult gauge, 2-floor trace). */
  notBeforeBoss?: boolean;
  /** Pick weight by zone (0 = never there). */
  weights: Record<FloorTheme, number>;
  /** Seconds of the warning (gold mark + banner) before it starts. */
  warn: number;
  /** Seconds to succeed once started. */
  duration: number;
  /** Count to reach (kills, falls, lamps; 1 = kill the target; patient 100 = HP %; child = path length). */
  goal: number;
  reward: FieldEventReward;
  /** Event-specific numbers (hp, speeds, radii …), read by src/sim/fieldEvents.ts. */
  params: Record<string, number>;
}

/** A spot on the ground that belongs to the event: a lamp, the hole, the exit door. doneBy = player who lit it. */
export interface FieldEventMark {
  pos: Vec2;
  radius: number;
  doneBy: number | null;
}

export interface FieldEventState {
  id: FieldEventId;
  stage: 'warn' | 'active';
  warnRemaining: number;
  /** Seconds left once active (= total during the warning). */
  remaining: number;
  total: number;
  /** Where it happens (spawn spot / anchor; the child's start). */
  pos: Vec2;
  /** Its units (toad, printer, patient, child, shadows). */
  entityIds: number[];
  marks: FieldEventMark[];
  /** Toward goal (patient: HP %, child: units walked). */
  progress: number;
  goal: number;
  /** Who gets the name on the success toast (last lamp, killing blow …). */
  creditPlayer: number | null;
  /** Child: seconds of crying left (it does not walk). */
  startled?: number;
  /** Printer: seconds to the next print, and how many it printed. */
  printIn?: number;
  printed?: number;
}

// ─── 보스 그로기 (기획 13차, docs/boss-groggy.md) ───

/**
 * The boss's groggy gauge (boss floors with a BossDef.groggy, else GameState.bossGroggy is null). The HUD draws only
 * from this (rejoin / mid-join safe), never from events.
 */
export interface BossGroggyState {
  /** Gauge 0..1 (points ÷ the current max, so a seat turning bot only changes the fill speed, never the bar). */
  fill: number;
  /** Seconds of groggy left; 0 = not groggy. */
  left: number;
  /** Groggy length of the current / last break. */
  total: number;
  /** Seconds of the after-groggy lock left (the gauge takes no points). */
  lock: number;
  lockTotal: number;
  /** Breaks so far this fight (the max grows ×(1 + 0.5 × count)). */
  count: number;
  /** fill ≥ 80 % and neither groggy nor locked ('next stun drag breaks it'). */
  near: boolean;
  /** Player who filled it last (the last break), null = none / debug. */
  breaker: number | null;
}

export type GroggyGainWhy = 'drag' | 'stun' | 'ult' | 'pet';

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
  /** 기획 12차: a 돌발 괴담 unit ('target' toad/printer, 'minion' 23:59 shadow, 'ward' patient/child). Absent otherwise. */
  eventTag?: FieldEventTag;
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
  /**
   * 기획 14차 궁극기 개별 게이지 (debug toggle Tunables.ultPerCharacter): this character's own gauge. Present on every
   * member while the toggle is on, absent when it is off (then PlayerState.ult is the one shared gauge). src/sim/ultMode.ts.
   */
  ult?: UltGauge;
}

/**
 * 기획 14차 교체 에너지: value 0..max (fractional: it fills continuously), max = Tunables.swapEnergyMax, regen =
 * Tunables.swapEnergyRegen (per second; carried so pure checks on a client snapshot price 빠른 교대 like the sim).
 */
export interface SwapEnergy {
  value: number;
  max: number;
  regen: number;
}

/** An ult gauge: charge 0..1 (1 = usable), fullSince = sim time it became full (null below full). */
export interface UltGauge {
  charge: number;
  fullSince: number | null;
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
  /** 기획 12차: 돌발 괴담 this player resolved (killing blow, last lamp, …). */
  fieldEvents: number;
  /** 기획 13차: boss groggy points this player filled, breaks (last fill), and damage dealt to a groggy boss. No reward. */
  groggyPoints: number;
  groggyBreaks: number;
  groggyDamage: number;
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
  /** The player's shared ult gauge (today's rule). 기획 14차: unused while the members carry their own (PartyMember.ult). */
  ult: UltGauge;
  /**
   * 기획 14차 교체 에너지 (debug toggle Tunables.swapEnergyMode): the pool the player's 3 characters swap in with.
   * Present while the toggle is on (then no character has a re-appear cooldown), absent when it is off. src/sim/energy.ts.
   */
  energy?: SwapEnergy;
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
  /** Members brought back by a 'revive' effect (set only when the outcome has one; 0 = nobody was down). */
  revived?: number;
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
  /** 기획 12차: the 돌발 괴담 running on this floor (warning or active), else null. */
  fieldEvent: FieldEventState | null;
  /** 기획 13차: the boss's groggy gauge on a boss floor (null elsewhere, or with bossGroggyThreshold 0). */
  bossGroggy: BossGroggyState | null;
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
  | { kind: 'goedamNext'; room?: string }
  /** 기획 12차: start a 돌발 괴담 now (normal floor, early in combat) or at 8 s of the next normal floor. */
  | { kind: 'fieldEventNext'; id?: FieldEventId }
  /** 기획 13차: set the boss groggy gauge (default 1 = break now; e.g. 0.85 = near full). Clears the lock. */
  | { kind: 'forceGroggy'; fill?: number };

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
      /** 기획 12차: drag/pet hit on a 돌발 괴담 target (×2) — render tags the number '약점'. */
      weak?: true;
      /** 기획 13차: hit on a groggy boss (×1.5, drag ×2) — render: amber number, drag hits get '×2'. */
      groggy?: true;
      /** 기획 13차: the hit came from a drag cast (only set together with groggy). */
      drag?: true;
    }
  /** from (기획 12차): the 흡혼-marked enemy this heal was drained from (render draws a red wisp from it). */
  | { type: 'heal'; targetId: number; amount: number; pos: Vec2; from?: number }
  /** 기획 12차: a bench member (no entity) was healed — render flashes that card. */
  | { type: 'benchHeal'; player: number; partyIndex: number; amount: number }
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
      /** 기획 13차: SkillAction.stage and the action's index in its skill (character / pet casts with stages). */
      stage?: string;
      actionIndex?: number;
      /** 기획 13차: the telegraph follows the caster / target (SkillAction.follow). */
      follow?: true;
      /** 기획 13차: the telegraph shows only for the last N s (0 = none). */
      telegraphLead?: number;
    }
  /**
   * 기획 13차: one staged action landed (every hit of a multi-hit). center / area = where it hit, targets = units it hit.
   * Only for actions with a SkillAction.stage (the 15 renewed drag / ult skills).
   */
  | {
      type: 'skillStage';
      sourceId: number | null;
      player: number | null;
      slot: SkillSlot | 'pet' | 'monster';
      skillId: string;
      stage: string;
      actionIndex: number;
      center: Vec2;
      area: AreaShape;
      team: Team;
      /** 0-based hit of hits. */
      hit: number;
      hits: number;
      targets: number;
    }
  /** 기획 13차: an ult was tapped — the cut-in starts (before its skillCast events). Effects land ≥ 0.45 s later. */
  | { type: 'ultCast'; player: number; entityId: number; defId: string; skillId: string; name: string }
  /** 기획 13차: a control status landed on a unit (head icon / sound). source = the caster entity, if any. */
  | { type: 'statusApplied'; targetId: number; status: StatusId; duration: number; player: number | null; sourceId: number | null }
  /** 기획 13차: a stasis ended; the unit took `amount` (the stored-damage rebound). */
  | { type: 'stasisEnd'; entityId: number; amount: number; player: number | null }
  /** 기획 13차: a bench card got a status (바드 앙코르). from = the casting player. */
  | { type: 'benchBuff'; player: number; partyIndex: number; status: StatusId; duration: number; value: number; from: number | null }
  /** 기획 13차: a dead card's revive wait got shorter by `seconds` (메딕 골든 아워). from = the casting player. */
  | { type: 'reviveCut'; player: number; partyIndex: number; seconds: number; from: number | null }
  /** 기획 13차: a player's bench swap cooldowns got `seconds` shorter (크로노). from = the casting player. */
  | { type: 'swapCdCut'; player: number; seconds: number; from: number | null }
  | { type: 'appear'; player: number; partyIndex: number; entityId: number; pos: Vec2 }
  /** Caster moved along a dash (render a streak; entity pos is already at `to`). */
  | { type: 'dash'; entityId: number; from: Vec2; to: Vec2; duration: number }
  /** 기획 8차: a monster teleported (render a vanish/appear). 기획 13차: also character blinks (블레이드 순보 hop n of count). */
  | { type: 'blink'; entityId: number; from: Vec2; to: Vec2; hop?: number; hops?: number }
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
  /** A gauge became full. 기획 14차: partyIndex = whose gauge (per-character mode only; absent = the shared gauge). */
  | { type: 'ultReady'; player: number; partyIndex?: number }
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
  | { type: 'goedamTraceExpired'; player: number; traceId: string }
  /** 기획 12차 돌발 괴담: the warning (gold mark + banner) before it starts. */
  | { type: 'fieldEventWarn'; id: FieldEventId; pos: Vec2 }
  | { type: 'fieldEventStart'; id: FieldEventId; pos: Vec2 }
  /** Progress changed (lamp lit, monster fell, shadow killed, child startled, patient healed). player = who did it. */
  | { type: 'fieldEventProgress'; id: FieldEventId; progress: number; goal: number; player: number | null; kind?: FieldEventProgressKind }
  /** Over: success (every non-out player got the reward; player = credit) or failure. */
  | { type: 'fieldEventEnd'; id: FieldEventId; success: boolean; player: number | null }
  /** 기획 13차: the boss broke (groggy for duration s). player = who filled it last (null = debug). count = breaks so far. */
  | { type: 'bossGroggy'; entityId: number; player: number | null; count: number; duration: number }
  | { type: 'bossGroggyEnd'; entityId: number }
  /** 기획 13차: gauge points of one action (only ≥ 5 points, for the '+N' pop). */
  | { type: 'groggyGain'; player: number; amount: number; why: GroggyGainWhy };

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
  /** 기획 12차: chance of a 돌발 괴담 per normal floor 3–19 (floor 2 always has the toad); 0 = off entirely. */
  fieldEventChance: number;
  /** 기획 13차: boss groggy gauge base max (100; 0 = groggy off), groggy seconds, damage taken ×, drag damage taken ×. */
  bossGroggyThreshold: number;
  bossGroggyDuration: number;
  bossGroggyDamageMult: number;
  bossGroggyDragMult: number;
  /**
   * 기획 14차 궁극기 개별 게이지 (test toggle, default off = one gauge per player): every character has its own gauge;
   * the field character's fills in ultFieldChargeTime s, bench characters' at ultBenchRatio × that rate (option C).
   */
  ultPerCharacter: boolean;
  ultFieldChargeTime: number;
  ultBenchRatio: number;
  /**
   * 기획 14차 교체 에너지 (test toggle, default off = per-character re-appear cooldowns): one energy pool per player,
   * swapEnergyMax big, filling swapEnergyRegen per second in combat; a swap-in costs CharacterDef.swapEnergy.
   */
  swapEnergyMode: boolean;
  swapEnergyMax: number;
  swapEnergyRegen: number;
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
  /** 기획 12차: every 돌발 괴담 of the run (absent on old snapshots). credit = player index or null. */
  fieldEvents?: { floor: number; id: FieldEventId; success: boolean; seconds: number; credit: number | null }[];
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
  /** 기획 12차: party index / pet slot being dragged (돌발 괴담 drop highlights). */
  index?: number;
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
  /** Test hook (기획 13차): the last few ult cut-ins this screen showed ('full' = my band, 'mini' = another player's corner banner). */
  cutInLog(): readonly { kind: 'full' | 'short' | 'mini'; name: string; who: string }[];
}

export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;
