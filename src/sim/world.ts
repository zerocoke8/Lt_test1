// Internal sim world: the public GameState plus runtime-only bookkeeping.
// Runtime data hangs off `rt` fields on entities/players/members/zones/projectiles so the read model
// (src/types.ts) keeps its exact shape for render/ui.

import type {
  AreaShape,
  CharacterDef,
  DamageSource,
  Entity,
  FloorPlan,
  GameEvent,
  GameState,
  MonsterDef,
  MonsterSkill,
  PartyMember,
  PlayerState,
  Projectile,
  RewardOffer,
  RunResult,
  SkillAction,
  SkillSlot,
  StatBlock,
  StatusInstance,
  Team,
  Telemetry,
  Tunables,
  Vec2,
  Zone,
} from '../types';
import { ARENA_MARGIN, MAX_EVENTS } from './constants';
import type { FieldEventAi, FieldEventRt } from './fieldEvents';
import { Rng } from './rng';

// ─────────────────────────── Runtime extensions ───────────────────────────

export interface EntityRt {
  /** Character def (characters only). */
  charDef: CharacterDef | null;
  /** Monster/summon/boss def (non-characters only). */
  monDef: MonsterDef | null;
  /** Base stats before mods (monsters: already × floor statMult × monsterHpMult for hp). */
  base: StatBlock;
  /** Removed from play (dead, swapped out, expired, retreated). */
  gone: boolean;
  attackCd: number;
  /** Monster skill rotation: def.skills + skills added by boss phases (기획 8차). skillCds is parallel to it. */
  skills: MonsterSkill[];
  skillCds: number[];
  skillGap: number;
  /** Cannot act (cast / appear) while > 0. */
  lockTime: number;
  shieldTime: number;
  sinceAppear: number;
  pulseTimer: number;
  stationary: boolean;
  /** Ally turret: shoots with owner pet power. */
  petPowered: boolean;
  /** 기획 12차: skill slot (or 'pet') whose cast spawned this ally summon — damage/decoy credit for the benches. */
  summonSlot?: SkillSlot | 'pet';
  /** Monster skill parts being wound up (telegraphed, not landed yet): a stun breaks them (status.ts, skills.ts tickPending). */
  windup: PendingHit[];
  /** Boss phases entered so far (BossDef.phases, 기획 8차). */
  phase: number;
  /** Product of the entered phases' atkSpeedMult / cooldownMult. */
  phaseAtkSpeedMult: number;
  phaseCdMult: number;
  /** 기획 12차: 돌발 괴담 unit moved by src/sim/fieldEvents.ts (act() skips it). */
  eventAi?: FieldEventAi | null;
}
export interface SimEntity extends Entity {
  rt: EntityRt;
}

export interface MemberRt {
  shieldTime: number;
}
export interface SimMember extends PartyMember {
  rt: MemberRt;
}

export interface BotBrain {
  thinkIn: number;
  nextSwapAt: number;
  reactAt: number | null;
  ultAt: number | null;
  /** World x the bot's "camera" follows (last field-character x; null = arena center). */
  viewX: number | null;
  /** 기획 12차: start tick of the 돌발 괴담 this bot already swapped / used a pet for (once per event), its reaction time. */
  fieldEventSwapDone?: number;
  fieldEventPetDone?: number;
  fieldEventReactAt?: number | null;
}
export interface PlayerRt {
  bot: BotBrain;
  /** 기획 5차: came back from 'out' at a floor clear → put party slot 0 on the field when the next floor starts. */
  rejoinNextFloor?: boolean;
  /** 기획 12차 (메딕 대기실 간호): seconds accumulated toward the next bench-regen pulse. */
  benchRegenAcc?: number;
}
export interface SimPlayer extends PlayerState {
  party: SimMember[];
  rt: PlayerRt;
}

/** Status with the damage source kept for DoT attribution. */
export interface SimStatus extends StatusInstance {
  src?: DamageSource;
}

/** Everything needed to resolve a hit/skill after the caster may have left. */
export interface CastCtx {
  /** Entity that performs the action (null for pets). Used for lifesteal, events, line origin. */
  casterId: number | null;
  /** Entity meant by 'self' (caster; for pets the owner's active character). */
  selfId: number | null;
  team: Team;
  player: number | null;
  partyIndex: number | null;
  slot: SkillSlot | 'pet' | 'monster';
  source: DamageSource;
  skillId: string;
  name: string;
  /** Snapshot of caster atk at cast time. */
  atk: number;
  critChance: number;
  critMult: number;
  dmgMult: number;
  healMult: number;
  shieldMult: number;
  radiusMult: number;
  /** Drop point (drag skill / pet). */
  point: Vec2 | null;
  targetId: number | null;
  /** Last known target position at cast time. */
  targetPos: Vec2 | null;
  /** 기획 12차: SkillAction.center 'woundedAlly' — the ally picked at cast time (normal skills only, else null). */
  allyTargetId: number | null;
  /** Caster position at cast time. */
  origin: Vec2;
  isDrag: boolean;
  summonMult: number;
}

export interface SimZone extends Zone {
  rt: { ctx: CastCtx; action: SkillAction; nextTick: number; tickInterval: number };
}

export interface SimProjectile extends Projectile {
  rt: {
    ctx: CastCtx;
    amount: number;
    splashRadius: number;
    onHit: { chance: number; status: StatusInstance['id']; duration: number; value: number } | null;
    life: number;
  };
}

export interface PendingHit {
  kind: 'hit';
  ctx: CastCtx;
  action: SkillAction;
  center: Vec2;
  origin: Vec2;
  area: AreaShape;
  remaining: number;
  hitsLeft: number;
  started: boolean;
  telegraphId: number | null;
  /** Wind-up broken by a stun before it landed: dropped with its telegraph on the next tickPending. */
  cancelled?: boolean;
  /** SkillAction.charge (기획 8차): where the caster ends its rush when the hit lands (fixed at cast time = telegraph). */
  chargeTo?: Vec2;
}
export interface PendingEcho {
  kind: 'echo';
  ctx: CastCtx;
  actions: SkillAction[];
  remaining: number;
  telegraphId: number | null;
  /** The other parts' telegraphs (multi-part drag skills: every spot is shown, not only the first). */
  extraTelegraphIds: number[];
}
export type Pending = PendingHit | PendingEcho;

export interface PendingSpawn {
  remaining: number;
  monsterId: string;
  pos: Vec2;
  mid: boolean;
  wave: number;
  /** 기획 12차: printed by the 돌발 괴담 printer (its minions vanish when it is destroyed). */
  printed?: boolean;
}

export interface SpawnerState {
  points: Vec2[];
  nextWave: number;
  pending: PendingSpawn[];
  kills: number;
  midTriggered: boolean;
  /**
   * 기획 8차 onDeath splits that did not fit under maxAliveMonsters: they come out (oldest first) as soon as there is
   * room, and the floor does not clear while any wait.
   */
  deferred: { monsterId: string; pos: Vec2 }[];
}

export interface SimState extends GameState {
  entities: SimEntity[];
  players: SimPlayer[];
  zones: SimZone[];
  projectiles: SimProjectile[];
}

/** 기획 10차: run-long 괴담 room bookkeeping (the open room itself is state.goedam). */
export interface GoedamRt {
  /** Debug 'goedamNext': open a room after the next floor clear (a room id, or '' = one that fits that floor). */
  forced: string | null;
  /** Rooms opened this run (a room never comes twice). */
  seen: string[];
}

export interface World {
  state: SimState;
  tunables: Tunables;
  rng: Rng;
  events: GameEvent[];
  nextId: number;
  acc: number;
  pending: Pending[];
  spawner: SpawnerState;
  floorTimes: Telemetry['floorTimes'];
  bossRetreat: boolean;
  /** Boss floor, enraged: seconds in a row with no ally character on the field (soft-lock guard). */
  enragedEmptyTime: number;
  byId: Map<number, SimEntity>;
  /** Offers waiting for player 0's choice during 'reward'. */
  humanOffers: { player: number; offers: RewardOffer[] } | null;
  goedam: GoedamRt;
  /** 기획 12차: 돌발 괴담 plan / history (the open one is state.fieldEvent). */
  fieldEvents: FieldEventRt;
}

// ─────────────────────────── Helpers ───────────────────────────

export function newId(w: World): number {
  return w.nextId++;
}

export function emit(w: World, ev: GameEvent): void {
  w.events.push(ev);
  // Headless runs that never drain: keep the newest MAX_EVENTS (trim in batches).
  if (w.events.length > MAX_EVENTS * 2) w.events.splice(0, w.events.length - MAX_EVENTS);
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const copy = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function edgeDist(a: Entity, b: Entity): number {
  return dist(a.pos, b.pos) - a.radius - b.radius;
}
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function isAlive(e: SimEntity | null | undefined): e is SimEntity {
  return !!e && !e.rt.gone && e.hp > 0;
}

export function getEntity(w: World, id: number | null | undefined): SimEntity | null {
  if (id == null) return null;
  const e = w.byId.get(id);
  return isAlive(e) ? e : null;
}

export function addEntity(w: World, e: SimEntity): void {
  w.state.entities.push(e);
  w.byId.set(e.id, e);
}

export function otherTeam(t: Team): Team {
  return t === 'ally' ? 'enemy' : 'ally';
}

export function arena(w: World): FloorPlan['arena'] {
  return w.state.plan.arena;
}

/** Drop-point clamp: x∈[0.5,w−0.5], y∈[0.5,h−0.5]. */
export function clampToArena(w: World, p: Vec2): Vec2 {
  const a = arena(w);
  return {
    x: clamp(Number.isFinite(p.x) ? p.x : a.width / 2, ARENA_MARGIN, a.width - ARENA_MARGIN),
    y: clamp(Number.isFinite(p.y) ? p.y : a.height / 2, ARENA_MARGIN, a.height - ARENA_MARGIN),
  };
}

export function activeEntity(w: World, p: PlayerState): SimEntity | null {
  if (p.activeIndex == null) return null;
  return getEntity(w, p.party[p.activeIndex].entityId);
}

export function aliveEnemiesOf(w: World, team: Team): SimEntity[] {
  const out: SimEntity[] = [];
  for (const e of w.state.entities) if (e.team !== team && isAlive(e)) out.push(e);
  return out;
}

/** Remove gone entities in place (keeps the array identity render may hold). */
export function compactEntities(w: World): void {
  const ents = w.state.entities;
  let j = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (!e.rt.gone) ents[j++] = e;
    else w.byId.delete(e.id);
  }
  ents.length = j;
}

/** Enemies queued to appear (spawn markers + onDeath splits waiting for room) — they count against the alive cap. */
export function queuedEnemies(w: World): number {
  return w.spawner.pending.length + w.spawner.deferred.length;
}

/** Enemies alive (monsters + enemy summons, boss excluded). */
export function countEnemies(w: World): number {
  let n = 0;
  // 기획 12차: 돌발 괴담 units never count (floor clear, alive cap, monstersAlive)
  for (const e of w.state.entities) if (e.team === 'enemy' && isAlive(e) && e.tier !== 'boss' && !e.eventTag) n++;
  return n;
}

export function endRun(w: World, outcome: RunResult['outcome'], reason: RunResult['reason']): void {
  const s = w.state;
  if (s.phase === 'runOver') return;
  const last = w.floorTimes[w.floorTimes.length - 1];
  const alreadyLogged = !!last && last.floor === s.floor && last.outcome === 'clear';
  if (outcome === 'defeat' && (reason === 'timeout' || reason === 'wipe') && !alreadyLogged) {
    w.floorTimes.push({ floor: s.floor, seconds: s.floorTime, outcome: 'fail' });
  }
  s.phase = 'runOver';
  s.rewardOffers = null;
  w.humanOffers = null;
  s.goedam = null;
  s.fieldEvent = null;
  s.runResult = { outcome, reason, floorReached: s.floor, duration: s.time };
  emit(w, { type: 'runOver', result: s.runResult });
}
