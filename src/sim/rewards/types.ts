// 기획 17차 층 보상 hook bus — the interface every reward group implements (src/sim/rewards/hooks.ts runs them).
// Kept in its own module (no imports of the groups) so the track files can import it without a cycle.

import type { AppliedReward, PlayerState, RewardDef, StatMods, StatusId, StatusInstance, Vec2 } from '../../types';
import type { DmgSrc } from '../combat';
import type { CastCtx, PendingReward, SimEntity, SimPlayer, World } from '../world';

/** The field character just left (hooks.onLeave): after it went to the bench, before its re-appear cooldown is set. */
export interface LeaveInfo {
  idx: number;
  /** The entity that left (already gone; read its last pos / stats only). */
  entity: SimEntity;
  pos: Vec2;
  /** Its HP share when it left (before any HP cost). */
  hpFrac: number;
  /** Its context taken before it left (atk, crit, player) — build reward contexts with fx.rewardCtx. */
  ctx: CastCtx;
  /** This swap is a 저스트 교대. */
  just: boolean;
}

/** A character appeared by a swap (hooks.onAppear / onLand / onTeamSwap). */
export interface AppearInfo {
  idx: number;
  e: SimEntity;
  /** The drop point. */
  at: Vec2;
  /** Who left for it (null = the field was empty). */
  leave: { idx: number; pos: Vec2; defId: string } | null;
  just: boolean;
  /** Seconds since this card's cooldown reached 0 (0 when it came in on cooldown). */
  sinceReady: number;
  /** Re-appear seconds it still had when it came in (> 0 only through a canSwap 'allow', e.g. 이중 장전). */
  cooling: number;
  /** Forced in by a reward (빈자리의 대타): no player input. */
  forced: boolean;
}

/** Multipliers onAppear may raise for this swap's drag (the core applies them to the drag context). */
export interface DragMods {
  dmgMult: number;
  healMult: number;
  shieldMult: number;
  radiusMult: number;
  forceCrit: boolean;
  groggyMult: number;
  /** Extra appear invulnerability (s). */
  invulnAdd: number;
}

/** cooldownOnLeave accumulator: final = zero ? 0 : max(4, base × mult − flat) (then the 저스트 cut). */
export interface CdAcc {
  mult: number;
  flat: number;
  zero: boolean;
}

export interface JustThreatInfo {
  telegraphId: number;
  sourceId: number | null;
  skillId: string;
  boss: boolean;
  landIn: number;
}

/** A 저스트 교대 that just happened (hooks.onJustSwap: after the drag cast and onLand, before the echo). */
export interface JustInfo {
  outIndex: number;
  inIndex: number;
  /** The incoming entity. */
  e: SimEntity;
  /** Where the leaving character stood / the drop point. */
  pos: Vec2;
  drop: Vec2;
  /** Dodged attacks, the one that would have landed first first. */
  threats: JustThreatInfo[];
  /** Re-appear seconds cut from the leaving card. */
  cdCut: number;
  /** The incoming drag's context (its just power already applied). */
  drag: CastCtx;
}

/** 저스트 bonuses (justMods): added to the tunables; the core applies the caps (window 0.9 s, ×2.0, cut 0.7). */
export interface JustAcc {
  window: number;
  power: number;
  cdCut: number;
}

export interface OfferAcc {
  rarityBump: number;
  count: number;
  picks: number;
  skip: boolean;
  skipBy?: string;
  skipText?: string;
}

/**
 * Every hook is optional. Dispatchers (hooks.ts) run the groups in order BASE → SWAP → COMBAT → RULES (deterministic),
 * multiply the multipliers, add the adds, and skip a player with no reward and no relic. A hook gets the player whose
 * rewards it serves; it checks its own family with query.ts (rewardCount / rewardLevel / rewardParam). Hooks marked
 * PURE run on a multiplayer client's snapshot too: read PlayerState only, never World.
 */
export interface RewardHooks {
  /** Run these groups in order (hookGroup). */
  group?: RewardHooks[];
  onLeave?(w: World, p: SimPlayer, info: LeaveInfo): void;
  cooldownOnLeave?(w: World, p: SimPlayer, idx: number, cd: CdAcc): void;
  /** Before the drag cast: raise mods (they multiply), cast extra things, give shields. */
  onAppear?(w: World, p: SimPlayer, info: AppearInfo, mods: DragMods): void;
  /** After the drag cast (and the gear's land effects), before the echo. */
  onLand?(w: World, p: SimPlayer, info: AppearInfo, drag: CastCtx): void;
  /** The drag's last part landed (delay + hits; instant drags right after the swap). */
  onDragEnd?(w: World, p: SimPlayer, idx: number, at: Vec2, drag: CastCtx): void;
  /** A beat scheduled with fx.scheduleReward came due (pd.tag tells whose). */
  onDelay?(w: World, p: SimPlayer, pd: PendingReward): void;
  /** Another player (bots too, not out) just swapped: p = the listener, actor = who swapped. */
  onTeamSwap?(w: World, p: SimPlayer, actor: SimPlayer, info: AppearInfo): void;
  /** PURE. 'allow' = this card may come in although its cooldown runs (이중 장전). */
  canSwap?(ps: PlayerState, idx: number): 'allow' | null;
  /** After the ult cast: spent = the gauge it used (> 1 with 두 번 차는 게이지). */
  onUlt?(w: World, p: SimPlayer, idx: number, e: SimEntity, ctx: CastCtx, spent: number): void;
  /** PURE. Ult damage / heal / shield × this for member idx. */
  ultMult?(ps: PlayerState, idx: number): number;
  /** PURE. Ult charge speed × this (idx null = the player's general rate, HUD). */
  chargeMult?(ps: PlayerState, idx: number | null): number;
  /** PURE. Highest gauge value (default 1; the largest answer wins). */
  gaugeCap?(ps: PlayerState): number;
  /** Before the pet's cast: raise its power / radius. */
  onPet?(w: World, p: SimPlayer, petIndex: number, at: Vec2, mods: { power: number; radius: number }): void;
  /** Pet cooldown × this (set when the pet is used). */
  petCdMult?(p: SimPlayer): number;
  /** PURE. Pet radius +this (the drag preview shows it). */
  petRadiusAdd?(ps: PlayerState): number;
  /** PURE. Drag radius +this for member idx (the drag preview shows it; per-swap extras go through onAppear). */
  dragRadiusAdd?(ps: PlayerState, idx: number): number;
  /** Damage p's hits deal × this (src.player = p). */
  dealtMult?(w: World, p: SimPlayer, src: DmgSrc, target: SimEntity): number;
  /** Damage p's character takes: acc.mult × …, acc.guard += reduction (all guards together max 0.5). */
  takenMult?(w: World, target: SimEntity, p: SimPlayer, acc: { mult: number; guard: number }): void;
  /** Conditional stats of p's field character e (effStats). */
  statMods?(w: World, e: SimEntity, p: SimPlayer, into: Required<StatMods>): void;
  /** An enemy died (every player hears it; mine = p's kill). */
  onKill?(w: World, p: SimPlayer, victim: SimEntity, mine: boolean): void;
  /** p's character idx died (wasField = it was on the field). Before the 'out' check. */
  onCharacterDeath?(w: World, p: SimPlayer, idx: number, wasField: boolean): void;
  /** A heal of p's cast overflowed `amount` on e. */
  onHealOverflow?(w: World, p: SimPlayer, e: SimEntity, amount: number, ctx: CastCtx): void;
  /** p's drag cast (echo too) dealt `dealt` to target. */
  onDragHit?(w: World, p: SimPlayer, ctx: CastCtx, target: SimEntity, dealt: number): void;
  /** A hostile status p's cast puts on an enemy lasts this long (never changes groggy points). */
  statusDuration?(p: PlayerState, ctx: CastCtx, status: StatusId, d: number): number;
  /** A status p put on enemy e ran out. */
  statusExpire?(w: World, p: SimPlayer, e: SimEntity, status: StatusInstance): void;
  /** Groggy points of p's cast × this (the core caps the product at ×2 per cast). */
  groggyMult?(w: World, p: SimPlayer, ctx: CastCtx): number;
  /** The boss broke (every player hears it). */
  onGroggyBreak?(w: World, p: SimPlayer, boss: SimEntity): void;
  /** A 돌발 괴담 succeeded (every non-out player). */
  onFieldEventSuccess?(w: World, p: SimPlayer): void;
  /** A floor (원정: the stage's floor) started — non-out players. */
  onFloorStart?(w: World, p: SimPlayer): void;
  /** The floor was cleared, before the between-floor heal. noHeal = p's party skips it. */
  onFloorClear?(w: World, p: SimPlayer): { noHeal?: boolean } | void;
  /** PURE. Revive wait of p's character idx (base = the core's). */
  reviveTime?(ps: PlayerState, idx: number, base: number): number;
  /** Every combat tick, non-out players. */
  tick?(w: World, p: SimPlayer, dt: number): void;
  onJustSwap?(w: World, p: SimPlayer, info: JustInfo): void;
  /** PURE. 저스트 bonuses (added). */
  justMods?(ps: PlayerState, acc: JustAcc): void;
  /** When p's normal reward screen opens (not relic screens, not on rerolls). */
  offerMods?(w: World, p: SimPlayer, acc: OfferAcc): void;
  /** A reward was just added to p (picks, 괴담 rooms, debt, debug). */
  onGrant?(w: World, p: SimPlayer, applied: AppliedReward, def: RewardDef): void;
}

/** Bundle several hook objects into one (run in order). */
export function hookGroup(...hs: RewardHooks[]): RewardHooks {
  return { group: hs };
}
