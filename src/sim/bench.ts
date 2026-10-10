// 기획 12차 (메딕, docs/new-characters.md 3장): healing the bench — the one exception to 8장 "대기 중 HP 회복 없음".
// Bench members have no entity: their HP lives on the PartyMember card, so these heal the card directly and emit
// 'benchHeal' for the HUD (the card flashes '+N').

import type { DamageSource, Effect } from '../types';
import { PULSE_INTERVAL } from './constants';
import { mergeStatus } from './status';
import { receivedMultOf } from './rewards/base';
import { activeEntity, emit, type SimPlayer, type World } from './world';

/**
 * Heal every living bench member (not the field character, not the dead) of `p` by frac × its max HP × healMult.
 * Credited to `creditPlayer` (stats.healing). Returns the HP actually restored.
 */
export function benchHeal(w: World, p: SimPlayer, frac: number, healMult: number, creditPlayer: number | null): number {
  let total = 0;
  const received = receivedMultOf(p); // 기획 17차 #생존
  p.party.forEach((m, idx) => {
    if (idx === p.activeIndex || m.dead) return;
    const actual = Math.min(m.maxHp - m.hp, frac * m.maxHp * healMult * received);
    if (!(actual > 0)) return;
    m.hp += actual;
    total += actual;
    emit(w, { type: 'benchHeal', player: p.id, partyIndex: idx, amount: actual });
  });
  if (creditPlayer != null && total > 0) w.state.players[creditPlayer].stats.healing += total;
  return total;
}

/**
 * Dead members come back `seconds` sooner (min 0 → revived on the next tick by tickPlayers). 기획 13차: each cut card
 * emits 'reviveCut' (the HUD rolls its revive number down).
 */
export function reduceRevive(w: World, p: SimPlayer, seconds: number, from: number | null = null): void {
  p.party.forEach((m, idx) => {
    if (!m.dead) return;
    const cut = Math.min(m.reviveRemaining, Math.max(0, seconds));
    m.reviveRemaining -= cut;
    if (cut > 0) emit(w, { type: 'reviveCut', player: p.id, partyIndex: idx, seconds: cut, from });
  });
}

/**
 * 기획 13차 (바드 앙코르): a status on every living bench card of `p` — it ticks on the bench (tickPlayers) and comes onto
 * the field with the card (the entity takes the member's status list). Same merge rule as on the field.
 */
export function benchStatus(w: World, p: SimPlayer, eff: Extract<Effect, { kind: 'benchStatus' }>, from: number | null, src?: DamageSource): void {
  p.party.forEach((m, idx) => {
    if (idx === p.activeIndex || m.dead || !(eff.duration > 0)) return;
    mergeStatus(m.statuses, eff.status, eff.duration, eff.value, from, src);
    emit(w, { type: 'benchBuff', player: p.id, partyIndex: idx, status: eff.status, duration: eff.duration, value: eff.value, from });
  });
}

/** Players a benchHeal / reviveReduce reaches: the caster's own, or every player still in the run (allPlayers). */
export function effectPlayers(w: World, casterPlayer: number, allPlayers?: boolean): SimPlayer[] {
  if (allPlayers) return w.state.players.filter(p => !p.out);
  const p = w.state.players[casterPlayer];
  return p && !p.out ? [p] : [];
}

/** PassiveDef.benchRegen (메딕 대기실 간호): while that character is on the field, its bench heals in pulses. */
export function tickBenchRegen(w: World, p: SimPlayer, dt: number): void {
  const regen = activeEntity(w, p)?.rt.charDef?.passive.benchRegen ?? 0;
  if (!(regen > 0)) {
    if (p.rt.benchRegenAcc) p.rt.benchRegenAcc = 0;
    return;
  }
  let acc = (p.rt.benchRegenAcc ?? 0) + dt;
  while (acc >= PULSE_INTERVAL - 1e-9) {
    acc -= PULSE_INTERVAL;
    benchHeal(w, p, regen * PULSE_INTERVAL, 1, p.id);
  }
  p.rt.benchRegenAcc = acc;
}
