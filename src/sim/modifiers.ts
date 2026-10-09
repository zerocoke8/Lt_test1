// Read-only queries over a player's rewards and relics.

import type { PlayerState, StatMods } from '../types';
import { getGoedamTrace, getRelic, getReward } from '../data';
import { charOptionLevel, charRelicMult } from './expeditionGear';
import { optionValue } from '../data/gear';

export function hasRelic(p: PlayerState, id: string): boolean {
  return p.relics.includes(id);
}

/**
 * How strongly relic `id` works for party member idx: 1 when the player owns it (classic party relic), else 기획 15차
 * 원정 the tier multiplier of that relic equipped on THAT character, else 0. Callers scale the relic's numeric effect by it.
 */
export function relicScale(p: PlayerState, idx: number | null | undefined, id: string): number {
  if (hasRelic(p, id)) return 1;
  return p.gear ? charRelicMult(p, idx, id) : 0;
}

export function relicParam(id: string, key: string): number {
  return getRelic(id).params[key] ?? 0;
}

/** Sum of party-wide 'stat' rewards and 괴담 traces (기획 10차). */
export function partyStatMods(p: PlayerState): Required<StatMods> {
  const m: Required<StatMods> = { hpPct: 0, atkPct: 0, defFlat: 0, atkSpeedPct: 0, moveSpeedPct: 0, critChance: 0, critMult: 0 };
  for (const r of p.rewards) {
    const eff = getReward(r.rewardId).effect;
    if (eff.kind !== 'stat') continue;
    addMods(m, eff.mods);
  }
  for (const t of p.goedamTraces) addMods(m, getGoedamTrace(t.id).mods);
  return m;
}

/** 기획 10차: damage my characters take × this (traces: 동승자 +12%, 파란 휴지 −10% …). */
export function damageTakenMult(p: PlayerState): number {
  let sum = 0;
  for (const t of p.goedamTraces) sum += getGoedamTrace(t.id).damageTaken ?? 0;
  return Math.max(0, 1 + sum);
}

/** 기획 10차: ult charge speed (1 = normal; 혼선 0.7, 고요 1.3). */
export function ultChargeRate(p: PlayerState): number {
  let sum = 0;
  for (const t of p.goedamTraces) sum += getGoedamTrace(t.id).ultCharge ?? 0;
  return Math.max(0.1, 1 + sum);
}

export function addMods(into: Required<StatMods>, m: StatMods | undefined): void {
  if (!m) return;
  into.hpPct += m.hpPct ?? 0;
  into.atkPct += m.atkPct ?? 0;
  into.defFlat += m.defFlat ?? 0;
  into.atkSpeedPct += m.atkSpeedPct ?? 0;
  into.moveSpeedPct += m.moveSpeedPct ?? 0;
  into.critChance += m.critChance ?? 0;
  into.critMult += m.critMult ?? 0;
}

/** Sum of character-bound 'skill' rewards for one slot/stat. */
export function skillMod(
  p: PlayerState,
  partyIndex: number | null,
  slot: 'normal' | 'drag' | 'ult' | 'basic',
  stat: 'damage' | 'radius' | 'cooldown',
): number {
  if (partyIndex == null) return 0;
  let sum = 0;
  for (const r of p.rewards) {
    if (r.partyIndex !== partyIndex) continue;
    const eff = getReward(r.rewardId).effect;
    if (eff.kind === 'skill' && eff.slot === slot && eff.stat === stat) sum += eff.value;
  }
  return sum;
}

export function swapCooldownReduction(p: PlayerState, partyIndex: number): number {
  let sum = 0;
  for (const r of p.rewards) {
    if (r.partyIndex !== partyIndex) continue;
    const eff = getReward(r.rewardId).effect;
    if (eff.kind === 'swapCooldown') sum += eff.value;
  }
  if (p.gear) sum += gearOptionValue(p, partyIndex, 'c_quick_swap'); // 기획 15차 원정 장신구 「빠른 교대」
  return sum;
}

/** 기획 15차 원정: the value of special effect `optionId` on that character's gear (0 = none). */
export function gearOptionValue(p: PlayerState, partyIndex: number | null | undefined, optionId: string): number {
  const lv = charOptionLevel(p, partyIndex, optionId);
  return lv ? optionValue(optionId, lv) : 0;
}

export function appearShieldFrac(p: PlayerState, partyIndex: number): number {
  let sum = 0;
  for (const r of p.rewards) {
    if (r.partyIndex !== partyIndex) continue;
    const eff = getReward(r.rewardId).effect;
    if (eff.kind === 'appearShield') sum += eff.value;
  }
  return sum;
}

export function petCooldownReduction(p: PlayerState): number {
  let sum = 0;
  for (const r of p.rewards) {
    const eff = getReward(r.rewardId).effect;
    if (eff.kind === 'petCooldown') sum += eff.value;
  }
  return sum;
}
