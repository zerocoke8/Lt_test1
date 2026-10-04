// Read-only queries over a player's rewards and relics.

import type { PlayerState, StatMods } from '../types';
import { getRelic, getReward } from '../data';

export function hasRelic(p: PlayerState, id: string): boolean {
  return p.relics.includes(id);
}

export function relicParam(id: string, key: string): number {
  return getRelic(id).params[key] ?? 0;
}

/** Sum of party-wide 'stat' rewards. */
export function partyStatMods(p: PlayerState): Required<StatMods> {
  const m: Required<StatMods> = { hpPct: 0, atkPct: 0, defFlat: 0, atkSpeedPct: 0, moveSpeedPct: 0, critChance: 0, critMult: 0 };
  for (const r of p.rewards) {
    const eff = getReward(r.rewardId).effect;
    if (eff.kind !== 'stat') continue;
    addMods(m, eff.mods);
  }
  return m;
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
  return sum;
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
