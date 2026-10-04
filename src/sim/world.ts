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
}
export interface PlayerRt {
  bot: BotBrain;
  /** 기획 5차: came back from 'out' at a floor clear → put party slot 0 on the field when the next floor starts. */
  rejoinNextFloor?: boolean;
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
}

export interface SpawnerState {
  points: Vec2[];
  nextWave: number;
  pending: PendingSpawn[];
  kills: number;
  midTriggered: boolean;
}

export interface SimState extends GameState {
  entities: SimEntity[];
  players: SimPlayer[];
  zones: SimZone[];
  projectiles: SimProjectile[];
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

/** Enemies alive (monsters + enemy summons, boss excluded). */
export function countEnemies(w: World): number {
  let n = 0;
  for (const e of w.state.entities) if (e.team === 'enemy' && isAlive(e) && e.tier !== 'boss') n++;
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
  s.runResult = { outcome, reason, floorReached: s.floor, duration: s.time };
  emit(w, { type: 'runOver', result: s.runResult });
}
