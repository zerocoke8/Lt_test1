// Tuning log (R22) for the local player (player 0).

import type { ContributionStats, DamageSource, Telemetry } from '../types';
import type { World } from './world';

export const DAMAGE_SOURCES: DamageSource[] = ['basic', 'passive', 'normal', 'drag', 'ult', 'pet', 'relic', 'zone', 'summon'];

export function emptyContribution(): ContributionStats {
  const bySource = {} as Record<DamageSource, number>;
  for (const k of DAMAGE_SOURCES) bySource[k] = 0;
  return {
    damageDealt: 0,
    damageToBoss: 0,
    damageTaken: 0,
    healing: 0,
    kills: 0,
    swaps: 0,
    ultsUsed: 0,
    petsUsed: 0,
    damageBySource: bySource,
    ultDelayTotal: 0,
    ultDelayCount: 0,
  };
}

export function computeTelemetry(w: World): Telemetry {
  const p = w.state.players[0];
  const st = p ? p.stats : emptyContribution();
  const minutes = w.state.time / 60;
  let total = 0;
  for (const k of DAMAGE_SOURCES) total += st.damageBySource[k];
  const share = {} as Record<DamageSource, number>;
  for (const k of DAMAGE_SOURCES) share[k] = total > 0 ? st.damageBySource[k] / total : 0;
  return {
    swapsPerMinute: minutes > 0 ? st.swaps / minutes : 0,
    damageShareBySource: share,
    avgUltDelay: st.ultDelayCount > 0 ? st.ultDelayTotal / st.ultDelayCount : 0,
    floorTimes: w.floorTimes.map(f => ({ ...f })),
  };
}
