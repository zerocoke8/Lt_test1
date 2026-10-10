// 기획 17차 층 보상 hook bus (docs/floor-rewards.md, docs/prototype-architecture.md): the sim calls these dispatchers at
// its few reward points (swap, ult, pet, hits, kills, statuses, groggy, floors, ticks, offers). Each runs the reward
// groups in a fixed order — BASE (core: tag bonuses, system cards, guards, mines) → SWAP (track A) → COMBAT (track B) →
// RULES (track C) — multiplying multipliers and adding adds. A player with no reward and no relic is skipped at once,
// so a run without rewards takes exactly the 16차 path.

import type { AppliedReward, PlayerState, RewardDef, StatMods, StatusId, StatusInstance, Vec2 } from '../../types';
import type { DmgSrc } from '../combat';
import type { CastCtx, OfferMods, PendingReward, SimEntity, SimPlayer, World } from '../world';
import { BASE_HOOKS } from './base';
import { COMBAT_HOOKS } from './combat';
import { RULES_HOOKS } from './rules';
import { SWAP_HOOKS } from './swap';
import type { AppearInfo, CdAcc, DragMods, JustAcc, JustInfo, LeaveInfo, RewardHooks } from './types';

/** Total reward damage reduction cap (all guards together). */
export const GUARD_CAP = 0.5;
/** Groggy multiplier cap per cast (rewards together). */
export const GROGGY_MULT_CAP = 2;

let flat: RewardHooks[] | null = null;

function flatten(list: RewardHooks[], out: RewardHooks[]): RewardHooks[] {
  for (const h of list) {
    if (h.group) flatten(h.group, out);
    out.push(h);
  }
  return out;
}

/** The groups in run order (built on first use: the group modules import helpers that import this one). */
function hooks(): RewardHooks[] {
  return (flat ??= flatten([BASE_HOOKS, SWAP_HOOKS, COMBAT_HOOKS, RULES_HOOKS], []));
}

/** Does p have anything a hook could act on (a reward or a classic relic)? */
export function hasRewards(p: PlayerState | null | undefined): p is PlayerState {
  return !!p && (p.rewards.length > 0 || p.relics.length > 0);
}

function playerOf(w: World, pi: number | null | undefined): SimPlayer | null {
  return pi != null ? (w.state.players[pi] ?? null) : null;
}

// ─────────────────────────── Swap ───────────────────────────

export function rwOnLeave(w: World, p: SimPlayer, info: LeaveInfo): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onLeave?.(w, p, info);
}

export function rwCooldownOnLeave(w: World, p: SimPlayer, idx: number): CdAcc {
  const cd: CdAcc = { mult: 1, flat: 0, zero: false };
  if (!hasRewards(p)) return cd;
  for (const h of hooks()) h.cooldownOnLeave?.(w, p, idx, cd);
  return cd;
}

export function noDragMods(): DragMods {
  return { dmgMult: 1, healMult: 1, shieldMult: 1, radiusMult: 1, forceCrit: false, groggyMult: 1, invulnAdd: 0 };
}

export function rwOnAppear(w: World, p: SimPlayer, info: AppearInfo): DragMods {
  const mods = noDragMods();
  if (!hasRewards(p)) return mods;
  for (const h of hooks()) h.onAppear?.(w, p, info, mods);
  return mods;
}

export function rwOnLand(w: World, p: SimPlayer, info: AppearInfo, drag: CastCtx): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onLand?.(w, p, info, drag);
}

export function rwOnDragEnd(w: World, p: SimPlayer, idx: number, at: Vec2, drag: CastCtx): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onDragEnd?.(w, p, idx, at, drag);
}

export function rwOnDelay(w: World, pd: PendingReward): void {
  const p = playerOf(w, pd.player);
  if (!p) return;
  for (const h of hooks()) h.onDelay?.(w, p, pd);
}

/** Every other non-out player hears actor's swap. */
export function rwOnTeamSwap(w: World, actor: SimPlayer, info: AppearInfo): void {
  for (const p of w.state.players) {
    if (p === actor || p.out || !hasRewards(p)) continue;
    for (const h of hooks()) h.onTeamSwap?.(w, p, actor, info);
  }
}

/** PURE: may card idx come in although it is cooling (이중 장전)? */
export function rwCanSwap(ps: PlayerState, idx: number): boolean {
  if (ps.rewards.length === 0) return false;
  for (const h of hooks()) if (h.canSwap?.(ps, idx) === 'allow') return true;
  return false;
}

// ─────────────────────────── Ult / pets ───────────────────────────

export function rwOnUlt(w: World, p: SimPlayer, idx: number, e: SimEntity, ctx: CastCtx, spent: number): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onUlt?.(w, p, idx, e, ctx, spent);
}

export function rwUltMult(ps: PlayerState, idx: number): number {
  if (!hasRewards(ps)) return 1;
  let m = 1;
  for (const h of hooks()) if (h.ultMult) m *= h.ultMult(ps, idx);
  return m;
}

export function rwChargeMult(ps: PlayerState, idx: number | null): number {
  if (!hasRewards(ps)) return 1;
  let m = 1;
  for (const h of hooks()) if (h.chargeMult) m *= h.chargeMult(ps, idx);
  return Math.max(0.05, m);
}

export function rwGaugeCap(ps: PlayerState): number {
  if (ps.rewards.length === 0) return 1;
  let cap = 1;
  for (const h of hooks()) if (h.gaugeCap) cap = Math.max(cap, h.gaugeCap(ps));
  return cap;
}

export function rwOnPet(w: World, p: SimPlayer, petIndex: number, at: Vec2): { power: number; radius: number } {
  const mods = { power: 1, radius: 1 };
  if (!hasRewards(p)) return mods;
  for (const h of hooks()) h.onPet?.(w, p, petIndex, at, mods);
  return mods;
}

export function rwPetCdMult(p: SimPlayer): number {
  if (!hasRewards(p)) return 1;
  let m = 1;
  for (const h of hooks()) if (h.petCdMult) m *= h.petCdMult(p);
  return Math.max(0, m);
}

export function rwPetRadiusAdd(ps: PlayerState): number {
  if (!hasRewards(ps)) return 0;
  let a = 0;
  for (const h of hooks()) if (h.petRadiusAdd) a += h.petRadiusAdd(ps);
  return a;
}

export function rwDragRadiusAdd(ps: PlayerState, idx: number): number {
  if (!hasRewards(ps)) return 0;
  let a = 0;
  for (const h of hooks()) if (h.dragRadiusAdd) a += h.dragRadiusAdd(ps, idx);
  return a;
}

// ─────────────────────────── Hits ───────────────────────────

export function rwDealtMult(w: World, src: DmgSrc, target: SimEntity): number {
  const p = playerOf(w, src.player);
  if (!hasRewards(p)) return 1;
  let m = 1;
  for (const h of hooks()) if (h.dealtMult) m *= h.dealtMult(w, p as SimPlayer, src, target);
  return Math.max(0, m);
}

/** Damage p's character `target` takes × this: the hooks' multipliers × (1 − guards, max GUARD_CAP). */
export function rwTakenMult(w: World, target: SimEntity, p: SimPlayer): number {
  if (!hasRewards(p) && !target.rt.guards?.length) return 1;
  const acc = { mult: 1, guard: 0 };
  for (const h of hooks()) h.takenMult?.(w, target, p, acc);
  return Math.max(0, acc.mult) * (1 - Math.min(GUARD_CAP, Math.max(0, acc.guard)));
}

export function rwStatMods(w: World, e: SimEntity, p: SimPlayer, into: Required<StatMods>): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.statMods?.(w, e, p, into);
}

/** An enemy died: every player with rewards hears it (killer = the player credited, null = none). */
export function rwOnKill(w: World, victim: SimEntity, killer: number | null): void {
  for (const p of w.state.players) {
    if (!hasRewards(p)) continue;
    for (const h of hooks()) h.onKill?.(w, p, victim, p.id === killer);
  }
}

export function rwOnCharacterDeath(w: World, p: SimPlayer, idx: number, wasField: boolean): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onCharacterDeath?.(w, p, idx, wasField);
}

export function rwOnHealOverflow(w: World, e: SimEntity, amount: number, ctx: CastCtx): void {
  const p = playerOf(w, ctx.player);
  if (!hasRewards(p) || !(amount > 0)) return;
  for (const h of hooks()) h.onHealOverflow?.(w, p as SimPlayer, e, amount, ctx);
}

export function rwOnDragHit(w: World, ctx: CastCtx, target: SimEntity, dealt: number): void {
  const p = playerOf(w, ctx.player);
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onDragHit?.(w, p as SimPlayer, ctx, target, dealt);
}

// ─────────────────────────── Statuses / groggy ───────────────────────────

/** Duration of a hostile status an ally cast puts on (unchanged without rewards). */
export function rwStatusDuration(w: World, ctx: CastCtx, status: StatusId, d: number): number {
  const p = playerOf(w, ctx.player);
  if (!hasRewards(p)) return d;
  let out = d;
  for (const h of hooks()) if (h.statusDuration) out = h.statusDuration(p, ctx, status, out);
  return Math.max(0, out);
}

export function rwStatusExpire(w: World, e: SimEntity, status: StatusInstance): void {
  const p = playerOf(w, status.sourcePlayer);
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.statusExpire?.(w, p as SimPlayer, e, status);
}

/** Groggy multiplier of one cast: its DragMods.groggyMult × the hooks', at most GROGGY_MULT_CAP. */
export function rwGroggyMult(w: World, ctx: CastCtx): number {
  let m = ctx.groggyMult ?? 1;
  const p = playerOf(w, ctx.player);
  if (hasRewards(p)) for (const h of hooks()) if (h.groggyMult) m *= h.groggyMult(w, p as SimPlayer, ctx);
  return Math.max(0, Math.min(GROGGY_MULT_CAP, m));
}

export function rwOnGroggyBreak(w: World, boss: SimEntity): void {
  for (const p of w.state.players) {
    if (!hasRewards(p)) continue;
    for (const h of hooks()) h.onGroggyBreak?.(w, p, boss);
  }
}

// ─────────────────────────── Floors / ticks ───────────────────────────

export function rwOnFieldEventSuccess(w: World): void {
  for (const p of w.state.players) {
    if (p.out || !hasRewards(p)) continue;
    for (const h of hooks()) h.onFieldEventSuccess?.(w, p);
  }
}

export function rwOnFloorStart(w: World): void {
  for (const p of w.state.players) {
    if (p.out || !hasRewards(p)) continue;
    for (const h of hooks()) h.onFloorStart?.(w, p);
  }
}

export function rwOnFloorClear(w: World, p: SimPlayer): { noHeal: boolean } {
  const out = { noHeal: false };
  if (!hasRewards(p)) return out;
  for (const h of hooks()) if (h.onFloorClear?.(w, p)?.noHeal) out.noHeal = true;
  return out;
}

export function rwReviveTime(ps: PlayerState, idx: number, base: number): number {
  if (!hasRewards(ps)) return base;
  let t = base;
  for (const h of hooks()) if (h.reviveTime) t = h.reviveTime(ps, idx, t);
  return Math.max(0, t);
}

export function rwTick(w: World, p: SimPlayer, dt: number): void {
  if (p.rewards.length === 0 && p.relics.length === 0 && !p.rt.mines?.length) return;
  for (const h of hooks()) h.tick?.(w, p, dt);
}

// ─────────────────────────── 저스트 ───────────────────────────

export function rwOnJustSwap(w: World, p: SimPlayer, info: JustInfo): void {
  if (!hasRewards(p)) return;
  for (const h of hooks()) h.onJustSwap?.(w, p, info);
}

/** PURE: the 저스트 bonuses of ps (added up; caps are applied by justParams). */
export function rwJustMods(ps: PlayerState): JustAcc {
  const acc: JustAcc = { window: 0, power: 0, cdCut: 0 };
  if (!hasRewards(ps)) return acc;
  for (const h of hooks()) h.justMods?.(ps, acc);
  return acc;
}

// ─────────────────────────── Offers ───────────────────────────

export function rwOfferMods(w: World, p: SimPlayer, base: OfferMods): OfferMods {
  const acc = { ...base };
  if (!hasRewards(p)) return acc;
  for (const h of hooks()) h.offerMods?.(w, p, acc);
  return acc;
}

export function rwOnGrant(w: World, p: SimPlayer, applied: AppliedReward, def: RewardDef): void {
  for (const h of hooks()) h.onGrant?.(w, p, applied, def);
}
