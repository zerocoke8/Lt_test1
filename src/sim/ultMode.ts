// 기획 15차: the ult gauge is per character (기획 14차 option C, now THE rule — the shared gauge is gone). The whole rule
// lives here; the sim calls in at its few ult choke points (tick, cast, gains/costs, refund, debug) and the HUD, bots
// and audio read the pure helpers.
//  - every member carries its own gauge (PartyMember.ult). The field character's fills in ultFieldChargeTime s; every
//    other one (bench, down) at ultBenchRatio × that rate; trace multipliers (혼선 0.7, 고요 1.3) apply to every gauge.
//    Nothing charges while the player is out.
//  - the ult button shows and casts the field character's gauge (an empty field has nothing to cast).
//  - '궁극기 +X%', '게이지 0', '가득' (괴담 rooms, 금두꺼비) hit the focus character: the field one, else the first living
//    one (it is the one that starts the next floor after a rejoin).

import type { PlayerState, Tunables, UltGauge } from '../types';
import { ultChargeRate } from './modifiers';
import { rwChargeMult, rwGaugeCap } from './rewards/hooks';
import { emit, type SimPlayer, type World } from './world';

// ─────────────────────────── Pure (sim, client snapshot, HUD, bots) ───────────────────────────

/** A fresh, empty gauge (run start, a new party member). */
export function emptyUltGauge(): UltGauge {
  return { charge: 0, fullSince: null };
}

/** The character '+X%' / '게이지 0' go to: the field character, else the first living one (null = all down). */
export function ultFocusIndex(p: PlayerState): number | null {
  if (p.activeIndex != null) return p.activeIndex;
  const i = p.party.findIndex(m => !m.dead);
  return i >= 0 ? i : null;
}

/** The gauge the ult button shows and casts: the field character's (null = empty field). */
export function fieldUltGauge(p: PlayerState): UltGauge | null {
  return p.activeIndex != null ? p.party[p.activeIndex]?.ult ?? null : null;
}

/** A card's own gauge (null = no such card). */
export function memberUltGauge(p: PlayerState, idx: number): UltGauge | null {
  return p.party[idx]?.ult ?? null;
}

type UltTunables = Pick<Tunables, 'ultFieldChargeTime' | 'ultBenchRatio'>;

/** Fill times of this player now (traces included): on the field / on the bench (Infinity at ratio 0). Pure. */
export function ultFillTimes(t: UltTunables, p: PlayerState, idx: number | null = null): { field: number; bench: number } {
  // 기획 17차: floor rewards change the charge speed (#궁극기 set, …)
  const field = Math.max(0.01, t.ultFieldChargeTime) / (ultChargeRate(p) * rwChargeMult(p, idx));
  const ratio = Math.max(0, t.ultBenchRatio);
  return { field, bench: ratio > 0 ? field / ratio : Infinity };
}

/**
 * Seconds for member `idx`'s empty gauge to fill at its current rate (field vs bench; Infinity when the bench ratio is
 * 0). idx null → the field character's (the gauge the ult button shows).
 */
export function ultFillTime(t: UltTunables, p: PlayerState, idx: number | null = null): number {
  const i = idx ?? p.activeIndex;
  const { field, bench } = ultFillTimes(t, p, i);
  return i != null && i === p.activeIndex ? field : bench;
}

/** Seconds until that gauge is full at its current rate (0 = full; Infinity = no gauge / never on the bench at ratio 0). */
export function ultSecondsLeft(t: UltTunables, p: PlayerState, idx: number | null = null): number {
  const g = idx == null ? fieldUltGauge(p) : memberUltGauge(p, idx);
  if (!g) return Infinity;
  const left = 1 - Math.max(0, Math.min(1, g.charge));
  return left <= 0 ? 0 : left * ultFillTime(t, p, idx);
}

/**
 * Sim time the field gauge `g` became castable (the ult-delay stat): when it filled — or when that card came onto the
 * field if later (a gauge that filled on the bench could not be cast there). `appearedAt`: the field entity's
 * rt.appearedAt.
 */
export function ultCastableSince(g: UltGauge, now: number, appearedAt: number | undefined): number {
  const full = g.fullSince ?? now;
  return appearedAt != null ? Math.max(full, appearedAt) : full;
}

// ─────────────────────────── Sim ───────────────────────────

/**
 * Set one gauge (0..1; 기획 17차 두 번 차는 게이지: up to the reward gauge cap). Full: fullSince starts now + 'ultReady';
 * below full: fullSince cleared (기획 10차).
 */
function setGauge(w: World, p: SimPlayer, g: UltGauge, value: number, partyIndex: number): void {
  // near-full snap: 0.7 of tick charge + 0.3 can land at 0.99999… (no ultReady otherwise)
  const cap = rwGaugeCap(p);
  g.charge = value > 1 - 1e-9 ? (value > cap - 1e-9 ? cap : Math.max(1, value)) : Math.max(0, value);
  if (g.charge >= 1) {
    if (g.fullSince == null) {
      g.fullSince = w.state.time;
      emit(w, { type: 'ultReady', player: p.id, partyIndex });
    }
  } else {
    g.fullSince = null;
  }
}

/** The gauge gains/costs hit: the focus character's (null = everyone down). */
function focusGauge(p: SimPlayer): { g: UltGauge; idx: number } | null {
  const f = ultFocusIndex(p);
  return f != null ? { g: p.party[f].ult, idx: f } : null;
}

/** Set the ult gauge (괴담 '가득' / '게이지 0'): the focus character's. */
export function setUltCharge(w: World, p: SimPlayer, value: number): void {
  const f = focusGauge(p);
  if (f) setGauge(w, p, f.g, value, f.idx);
}

/** '궁극기 +X%' (괴담 rooms, 금두꺼비): the focus character's gauge. */
export function addUltCharge(w: World, p: SimPlayer, delta: number): void {
  const f = focusGauge(p);
  if (f) setGauge(w, p, f.g, f.g.charge + delta, f.idx);
}

/** Debug '궁극기 충전': every character's gauge. */
export function fillUlts(w: World, p: SimPlayer): void {
  p.party.forEach((m, i) => setGauge(w, p, m.ult, 1, i));
}

/** Give one ult back (기획 13차 refund): to the character that cast it, else as a gain would go. */
export function refundUlt(w: World, p: SimPlayer, member: number | null): void {
  const g = member != null ? p.party[member]?.ult : undefined;
  if (g && member != null) setGauge(w, p, g, 1, member);
  else setUltCharge(w, p, 1);
}

/** Per-tick charge (R9 time-only) of one player that is not out. */
export function tickUlt(w: World, p: SimPlayer, dt: number): void {
  const t = w.tunables;
  const cap = rwGaugeCap(p);
  p.party.forEach((m, i) => {
    const g = m.ult;
    if (g.charge < cap - 1e-9) {
      const fill = ultFillTime(t, p, i);
      if (Number.isFinite(fill)) setGauge(w, p, g, g.charge + dt / fill, i);
    } else if (g.fullSince == null) setGauge(w, p, g, g.charge, i);
  });
}
