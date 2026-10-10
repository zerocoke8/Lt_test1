// Tuning log (R22) per player, and live tuning: validated Tunables patches (debug panel / multiplayer host).

import type { CommandResult, ContributionStats, DamageSource, Telemetry, Tunables } from '../types';
import { DEFAULT_TUNABLES } from '../config';
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
    fieldEvents: 0,
    groggyPoints: 0,
    groggyBreaks: 0,
    groggyDamage: 0,
    justSwaps: 0, // 기획 17차
    justDodged: 0,
  };
}

export function computeTelemetry(w: World, player = 0): Telemetry {
  const p = Number.isInteger(player) ? w.state.players[player] : undefined;
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
    goedam: p ? p.goedamLog.map(e => ({ ...e, outcome: { ...e.outcome, traces: [...e.outcome.traces] } })) : [],
    fieldEvents: w.fieldEvents.history.map(h => ({ ...h })),
    justSwapsPerMinute: minutes > 0 ? (st.justSwaps ?? 0) / minutes : 0, // 기획 17차
  };
}

// ─────────────────────────── Live tunables patch ───────────────────────────

type NumKey = { [K in keyof Tunables]: Tunables[K] extends number ? K : never }[keyof Tunables];

/** Sane bounds for every numeric tunable [min, max, integer?]. Wider than the debug sliders; only guards nonsense. */
const BOUNDS: Partial<Record<NumKey, [number, number, boolean?]>> = {
  gameSpeed: [0, 8],
  swapCooldownMult: [0, 10],
  reviveTime: [0, 600],
  reviveHpFrac: [0.01, 1],
  floorHealFrac: [0, 1],
  appearLockTime: [0, 10],
  appearInvulnTime: [0, 10],
  botDamageMult: [0, 10],
  monsterHpMult: [0.01, 10],
  monsterDmgMult: [0, 10],
  floorStatGrowth: [0, 5],
  normalFloorTime: [5, 3600],
  bossFloorTime: [5, 3600],
  waveInterval: [0.5, 120],
  maxAliveMonsters: [1, 200, true],
  maxFloor: [1, 200, true],
  midBossFromEnd: [1, 6, true], // 기획 16차 템포
  midBossTimeTrigger: [0, 3600],
  bossLockReleaseSec: [0, 600],
  petCooldownMult: [0, 10],
  goedamRoomsPerZone: [0, 2, true],
  fieldEventChance: [0, 1],
  // 기획 13차 보스 그로기 (0 = off)
  bossGroggyThreshold: [0, 2000],
  bossGroggyDuration: [0.5, 30],
  bossGroggyDamageMult: [1, 5],
  bossGroggyDragMult: [1, 5],
  // 기획 15차 궁극기 개별 게이지 (bench ratio 0 = bench gauges never fill)
  ultFieldChargeTime: [1, 600],
  ultBenchRatio: [0, 1],
  // 기획 17차 저스트 교대 (window 0 = off)
  justSwapWindow: [0, 1],
  justSwapDragMult: [1, 3],
  justSwapCdCut: [0, 0.9],
  justSwapIcd: [0, 10],
  botJustChance: [0, 1],
};

/**
 * Validate a Tunables patch: unknown keys and wrong types are dropped, numbers clamped to sane bounds.
 * Returns only the accepted fields (possibly empty).
 */
export function sanitizeTunablesPatch(raw: unknown): Partial<Tunables> {
  const out: Record<string, number | boolean> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out as Partial<Tunables>;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]) {
    if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
    const v = r[k];
    const def = DEFAULT_TUNABLES[k];
    if (typeof def === 'boolean') {
      if (typeof v === 'boolean') out[k] = v;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi, int] = BOUNDS[k as NumKey] ?? [0, 1e6];
    const c = Math.min(hi, Math.max(lo, v));
    out[k] = int ? Math.round(c) : c;
  }
  return out as Partial<Tunables>;
}

/** Command 'tunables': apply a validated patch to the live tunables. Fails when nothing valid was given. */
export function applyTunablesPatch(t: Tunables, patch: unknown): CommandResult {
  const clean = sanitizeTunablesPatch(patch);
  const keys = Object.keys(clean);
  if (keys.length === 0) return { ok: false, reason: '잘못된 튜닝 값' };
  Object.assign(t, clean);
  return { ok: true };
}
