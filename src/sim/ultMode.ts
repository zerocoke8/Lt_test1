// 기획 14차 궁극기 개별 게이지 (test toggle Tunables.ultPerCharacter, the designer's option C). The whole rule lives
// here; the sim calls in at its few ult choke points (tick, cast, gains/costs, refund, debug) and the HUD, bots and
// audio read the pure helpers.
//
// The MODE IS IN THE STATE: while the toggle is on every member carries its own gauge (PartyMember.ult); while it is
// off none does and PlayerState.ult is today's shared gauge. Pure checks (canUltState on a client snapshot, the HUD)
// read the mode from the state; the tunable only drives syncUltMode (run start, every tick, after a tunables command).
//  - the field character's gauge fills in ultFieldChargeTime s; every other one (bench, down) at ultBenchRatio × that
//    rate; trace multipliers (혼선 0.7, 고요 1.3) apply to every gauge. Nothing charges while the player is out.
//  - the ult button shows and casts the field character's gauge (an empty field has nothing to cast).
//  - '궁극기 +X%', '게이지 0', '가득' (괴담 rooms, 금두꺼비) hit the focus character: the field one, else the first living
//    one (it is the one that starts the next floor after a rejoin). Same amounts as the shared gauge.
//  - off → on mid-run: the focus character takes over the shared gauge, the others start empty; on → off: the shared
//    gauge takes the focus character's (a player who is out: party slot 0 — nothing is lost while spectating). Turning it on before the run = every gauge starts empty, like today's.
// Default off: every function below runs today's code path unchanged (tests/sim/default-off-golden.test.ts).

import type { PlayerState, Tunables, UltGauge } from '../types';
import { ultChargeRate } from './modifiers';
import { emit, type SimPlayer, type World } from './world';

// ─────────────────────────── Pure (sim, client snapshot, HUD, bots) ───────────────────────────

/** Per-character gauges are live for this player (the members carry them). */
export function perCharUlt(p: PlayerState): boolean {
  return p.party.length > 0 && p.party[0].ult != null;
}

/** The character '+X%' / '게이지 0' go to: the field character, else the first living one (null = all down). */
export function ultFocusIndex(p: PlayerState): number | null {
  if (p.activeIndex != null) return p.activeIndex;
  const i = p.party.findIndex(m => !m.dead);
  return i >= 0 ? i : null;
}

/** The gauge the ult button shows and casts: the shared one, or the field character's (null = empty field). */
export function fieldUltGauge(p: PlayerState): UltGauge | null {
  if (!perCharUlt(p)) return p.ult;
  return p.activeIndex != null ? p.party[p.activeIndex]?.ult ?? null : null;
}

/** A card's own gauge (null while the toggle is off: the cards show no ring then). */
export function memberUltGauge(p: PlayerState, idx: number): UltGauge | null {
  return p.party[idx]?.ult ?? null;
}

/**
 * Seconds for an empty shared gauge to fill (R9 time-only charge × 기획 10차 trace rate: 혼선 30 s → ~43 s). Pure
 * (tunables + PlayerState): the sim charges with it and the HUD's 'N초 후' / skill sheet show it.
 */
export function ultChargeTimeFor(tunables: Pick<Tunables, 'ultChargeTime'>, p: PlayerState): number {
  return Math.max(0.01, tunables.ultChargeTime) / ultChargeRate(p);
}

type UltTunables = Pick<Tunables, 'ultChargeTime' | 'ultFieldChargeTime' | 'ultBenchRatio'>;

/**
 * Seconds for an empty gauge to fill at its current rate: the shared gauge (today), or member `idx`'s (field vs bench
 * rate; Infinity when the bench ratio is 0). idx null / no per-character gauges → the gauge the ult button shows.
 */
export function ultFillTime(t: UltTunables, p: PlayerState, idx: number | null = null): number {
  if (!perCharUlt(p)) return ultChargeTimeFor(t, p);
  const { field, bench } = ultFillTimes(t, p);
  const i = idx ?? p.activeIndex;
  return i != null && i === p.activeIndex ? field : bench;
}

/** Per-character fill times of this player now (traces included): on the field / on the bench (Infinity at ratio 0). */
export function ultFillTimes(t: UltTunables, p: PlayerState): { field: number; bench: number } {
  const field = Math.max(0.01, t.ultFieldChargeTime) / ultChargeRate(p);
  const ratio = Math.max(0, t.ultBenchRatio);
  return { field, bench: ratio > 0 ? field / ratio : Infinity };
}

/** Seconds until that gauge is full at its current rate (0 = full; Infinity = never on the bench at ratio 0). */
export function ultSecondsLeft(t: UltTunables, p: PlayerState, idx: number | null = null): number {
  const g = idx == null ? fieldUltGauge(p) : memberUltGauge(p, idx) ?? (perCharUlt(p) ? null : p.ult);
  if (!g) return Infinity;
  const left = 1 - Math.max(0, Math.min(1, g.charge));
  return left <= 0 ? 0 : left * ultFillTime(t, p, idx);
}

/**
 * Sim time the field gauge `g` became castable (the ult-delay stat): when it filled — or, per character, when that card
 * came onto the field if later (a gauge that filled on the bench could not be cast there). `appearedAt`: the field
 * entity's rt.appearedAt. Shared gauge: fullSince as today.
 */
export function ultCastableSince(p: PlayerState, g: UltGauge, now: number, appearedAt: number | undefined): number {
  const full = g.fullSince ?? now;
  return perCharUlt(p) && appearedAt != null ? Math.max(full, appearedAt) : full;
}

// ─────────────────────────── Sim ───────────────────────────

const empty = (): UltGauge => ({ charge: 0, fullSince: null });

/** Make the state's mode follow the toggle (run start, every tick, a tunables command). No-op when they agree. */
export function syncUltMode(w: World): void {
  const on = !!w.tunables.ultPerCharacter;
  for (const p of w.state.players) {
    if (perCharUlt(p) === on) continue;
    // an out player (all down) keeps the gauge on slot 0, the one that starts the next floor after a rejoin
    const f = ultFocusIndex(p) ?? (p.party.length > 0 ? 0 : null);
    if (on) {
      p.party.forEach((m, i) => (m.ult = i === f ? { ...p.ult } : empty()));
      p.ult = empty();
    } else {
      const g = f != null ? p.party[f].ult : null;
      p.ult = g ? { ...g } : empty();
      for (const m of p.party) delete m.ult;
    }
  }
}

/** Set one gauge (0..1). Full: fullSince starts now + 'ultReady'; below full: fullSince cleared (기획 10차). */
function setGauge(w: World, p: SimPlayer, g: UltGauge, value: number, partyIndex: number | null): void {
  // near-full snap: 0.7 of tick charge + 0.3 can land at 0.99999… (no ultReady otherwise)
  g.charge = value > 1 - 1e-9 ? 1 : Math.max(0, value);
  if (g.charge >= 1) {
    if (g.fullSince == null) {
      g.fullSince = w.state.time;
      emit(w, partyIndex == null ? { type: 'ultReady', player: p.id } : { type: 'ultReady', player: p.id, partyIndex });
    }
  } else {
    g.fullSince = null;
  }
}

/** The gauge gains/costs hit: the shared one, or the focus character's (null = everyone down). */
function focusGauge(p: SimPlayer): { g: UltGauge; idx: number | null } | null {
  if (!perCharUlt(p)) return { g: p.ult, idx: null };
  const f = ultFocusIndex(p);
  const g = f != null ? p.party[f].ult : undefined;
  return g ? { g, idx: f } : null;
}

/** Set the ult gauge (괴담 '가득' / '게이지 0'): the shared one, or the focus character's. */
export function setUltCharge(w: World, p: SimPlayer, value: number): void {
  const f = focusGauge(p);
  if (f) setGauge(w, p, f.g, value, f.idx);
}

/** '궁극기 +X%' (괴담 rooms, 금두꺼비): the shared gauge, or the focus character's. */
export function addUltCharge(w: World, p: SimPlayer, delta: number): void {
  const f = focusGauge(p);
  if (f) setGauge(w, p, f.g, f.g.charge + delta, f.idx);
}

/** Debug '궁극기 충전': the shared gauge, or every character's. */
export function fillUlts(w: World, p: SimPlayer): void {
  if (!perCharUlt(p)) return setGauge(w, p, p.ult, 1, null);
  p.party.forEach((m, i) => m.ult && setGauge(w, p, m.ult, 1, i));
}

/** Give one ult back (기획 13차 refund): to the character that cast it, else as a gain would go. */
export function refundUlt(w: World, p: SimPlayer, member: number | null): void {
  const g = member != null ? p.party[member]?.ult : undefined;
  if (g) setGauge(w, p, g, 1, member);
  else setUltCharge(w, p, 1);
}

/** Per-tick charge (R9 time-only) of one player that is not out. */
export function tickUlt(w: World, p: SimPlayer, dt: number): void {
  const t = w.tunables;
  if (!perCharUlt(p)) {
    // today's shared gauge, per player
    if (p.ult.charge < 1) {
      p.ult.charge = Math.min(1, p.ult.charge + dt / ultChargeTimeFor(t, p));
      if (p.ult.charge > 1 - 1e-9) p.ult.charge = 1;
    }
    if (p.ult.charge >= 1 && p.ult.fullSince == null) {
      p.ult.fullSince = w.state.time;
      emit(w, { type: 'ultReady', player: p.id });
    }
    return;
  }
  p.party.forEach((m, i) => {
    const g = m.ult;
    if (!g) return;
    if (g.charge < 1) {
      const fill = ultFillTime(t, p, i);
      if (Number.isFinite(fill)) setGauge(w, p, g, g.charge + dt / fill, i);
    } else if (g.fullSince == null) setGauge(w, p, g, 1, i);
  });
}
