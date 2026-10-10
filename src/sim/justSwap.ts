// 기획 17차 저스트 교대 (docs/just-swap.md): swapping the field character out in the last moment before an enemy attack
// that would hit it lands. The swap rules and the hit rules do not change (a character that left is never hit) — this
// only recognizes the timing, credits it once per telegraph and rewards it: the incoming drag ×1.5 (damage, heal,
// shield, the paper doll's attack — never status times, radius or groggy points) and the leaving card's re-appear
// cooldown −40 % (after every other rule, never below 2.4 s). Judged on the tick the swap is processed (server-side in
// multiplayer); no randomness except the bots' try (botJustChance, the run rng — 0 = no extra draw).

import type { PendingHit } from './world';
import { DEBUFFS, type GameState, type PlayerState, type Tunables } from '../types';
import { hitsArea } from './geometry';
import { JUST_SWAP } from '../config';
import { inActionArea, isLiveEnemyWindup } from './skills';
import { rwJustMods } from './rewards/hooks';
import type { JustThreatInfo } from './rewards/types';
import type { SimEntity, SimPlayer, World } from './world';

/** The numbers of p's 저스트 now: window bonus (the window itself depends on the telegraph), drag power, cooldown cut. */
export interface JustParams {
  /** 0 = 저스트 off (tunable justSwapWindow 0). */
  base: number;
  bonus: number;
  cap: number;
  mult: number;
  cut: number;
}

/** Tunables + p's reward bonuses, with the caps (window 0.9 s, drag ×2.0, cut 70 % — a debug slider above them wins). */
export function justParams(w: Pick<World, 'tunables'>, p: PlayerState): JustParams {
  const t = w.tunables;
  const base = Math.max(0, t.justSwapWindow);
  if (!(base > 0)) return { base: 0, bonus: 0, cap: 0, mult: 1, cut: 0 };
  const acc = rwJustMods(p);
  const mult = Math.max(1, t.justSwapDragMult);
  const cut = Math.max(0, t.justSwapCdCut);
  return {
    base,
    bonus: Math.max(0, acc.window),
    cap: Math.max(JUST_SWAP.maxWindow, base),
    mult: acc.power > 0 ? Math.min(Math.max(JUST_SWAP.maxPower, mult), mult + acc.power) : mult,
    cut: acc.cdCut > 0 ? Math.min(Math.max(JUST_SWAP.maxCut, cut), cut + acc.cdCut) : cut,
  };
}

/** The window of one telegraph of `total` s: min(base + bonus, short × total + bonus, cap). */
export function justWindow(jp: JustParams, total: number): number {
  if (!(jp.base > 0)) return 0;
  return Math.min(jp.base + jp.bonus, JUST_SWAP.short * total + jp.bonus, jp.cap);
}

/** Does the action hurt or hinder (damage, a hostile status, a push / pull)? Heals and summons only do not count. */
function hostile(pd: PendingHit): boolean {
  return pd.action.effects.some(e => e.kind === 'damage' || e.kind === 'knockback' || e.kind === 'pull' || (e.kind === 'status' && DEBUFFS.has(e.status)));
}

function damageAmount(pd: PendingHit): number {
  let n = 0;
  for (const e of pd.action.effects) if (e.kind === 'damage') n += e.amount;
  return n;
}

export interface JustThreat extends JustThreatInfo {
  amount: number;
}

/**
 * Enemy attacks that make swapping `leaving` (p's field character) out now a 저스트: a visible telegraph of an enemy
 * part that has not landed its first hit, hurts, lands within the window (and after leaving's invulnerability), was
 * not credited to p yet, and would hit leaving (single: aimed at it; area: leaving stands in it — the hit test itself).
 * Order: lands first → bigger damage → older telegraph.
 */
export function findJustThreats(w: World, p: SimPlayer, leaving: SimEntity): JustThreat[] {
  const jp = justParams(w, p);
  if (!(jp.base > 0)) return [];
  if (w.state.time < (p.rt.justReadyAt ?? -Infinity) - 1e-9) return [];
  const credited = p.rt.justCredited ?? [];
  const out: JustThreat[] = [];
  for (const pd of w.pending) {
    if (pd.kind !== 'hit' || pd.telegraphId == null || credited.includes(pd.telegraphId)) continue;
    if (pd.action.affects !== 'enemies' || !hostile(pd) || !isLiveEnemyWindup(w, pd)) continue;
    const tele = w.state.telegraphs.find(t => t.id === pd.telegraphId);
    if (!tele) continue;
    const landIn = pd.remaining;
    if (!(landIn > 1e-9) || landIn > justWindow(jp, tele.total) + 1e-9) continue;
    if (leaving.invulnTime >= landIn - 1e-9) continue;
    const aimed = pd.area.shape === 'single' ? pd.ctx.targetId === leaving.id : inActionArea(w, pd.ctx, pd.area, pd.center, pd.origin, leaving);
    if (!aimed) continue;
    const caster = pd.ctx.casterId != null ? w.byId.get(pd.ctx.casterId) : undefined;
    out.push({
      telegraphId: pd.telegraphId,
      sourceId: pd.ctx.casterId,
      skillId: pd.ctx.skillId,
      boss: !!caster && (caster.tier === 'boss' || caster.tier === 'mid'),
      landIn,
      amount: damageAmount(pd),
    });
  }
  out.sort((a, b) => a.landIn - b.landIn || b.amount - a.amount || a.telegraphId - b.telegraphId);
  return out;
}

/** The leaving card's cooldown after the 저스트 cut: cd × (1 − cut), never below JUST_SWAP.minCooldown (a shorter cd stays). */
export function justCooldown(cd: number, cut: number): number {
  if (!(cd > JUST_SWAP.minCooldown)) return cd;
  return Math.max(JUST_SWAP.minCooldown, cd * (1 - Math.max(0, Math.min(1, cut))));
}

/** Remember the credited telegraphs (each counts once per player) and start the internal cooldown. */
export function creditJust(w: World, p: SimPlayer, threats: readonly JustThreatInfo[]): void {
  const list = (p.rt.justCredited ?? []).concat(threats.map(t => t.telegraphId));
  p.rt.justCredited = list.slice(-JUST_SWAP.credited);
  p.rt.justReadyAt = w.state.time + Math.max(0, w.tunables.justSwapIcd);
  p.stats.justSwaps++;
  p.stats.justDodged += threats.length;
}

// ─────────────────────────── HUD cue (PURE, also on a multiplayer snapshot) ───────────────────────────

/**
 * The card cue of player pi's field character from the public state (telegraphs only — pending parts and casters are
 * not on the wire, so a stunned / charmed caster's telegraph may still light it): danger = an enemy telegraph covers
 * the character; now = one of them lands within its 저스트 window after `ageSec` (multiplayer: snapshot age + half the
 * ping, so the gold cue comes early by the delay). landIn = the soonest such landing (s), null = none.
 */
export function justCue(s: GameState, tunables: Pick<Tunables, 'justSwapWindow' | 'justSwapDragMult' | 'justSwapCdCut'>, pi: number, ageSec = 0): { danger: boolean; now: boolean; landIn: number | null } {
  const out = { danger: false, now: false, landIn: null as number | null };
  const p = s.players[pi];
  const id = p && p.activeIndex != null ? p.party[p.activeIndex]?.entityId : null;
  const me = id != null ? s.entities.find(e => e.id === id) : undefined;
  if (!p || !me) return out;
  const jp = justParams({ tunables: tunables as Tunables }, p);
  for (const t of s.telegraphs) {
    if (t.team !== 'enemy' || !hitsArea(t.area, t.center, t.origin, me.pos, me.radius)) continue;
    out.danger = true;
    const left = t.remaining - Math.max(0, ageSec);
    if (left > 1e-9 && left <= justWindow(jp, t.total) + 1e-9 && left > me.invulnTime) {
      out.now = true;
      out.landIn = out.landIn == null ? left : Math.min(out.landIn, left);
    }
  }
  return out;
}
