// Debug-panel slider/toggle specs for every Tunable (R24), plus sanitizing for persisted overrides. Pure.

import type { Tunables } from '../types';
import { DEFAULT_TUNABLES } from '../config';

export type NumericTunable = { [K in keyof Tunables]: Tunables[K] extends number ? K : never }[keyof Tunables];
export type BoolTunable = { [K in keyof Tunables]: Tunables[K] extends boolean ? K : never }[keyof Tunables];

export interface SliderSpec {
  key: NumericTunable;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
  /** Display suffix. */
  unit?: string;
}

export const SLIDERS: SliderSpec[] = [
  { group: '교체·궁극기', key: 'swapCooldownMult', label: '재등장 쿨 배율', min: 0.25, max: 2, step: 0.05, unit: '×' },
  { group: '교체·궁극기', key: 'ultChargeTime', label: '궁극기 충전 시간', min: 5, max: 90, step: 1, unit: '초' },
  { group: '교체·궁극기', key: 'appearLockTime', label: '등장 후 교체 잠금', min: 0, max: 2, step: 0.1, unit: '초' },
  { group: '교체·궁극기', key: 'appearInvulnTime', label: '등장 무적 시간', min: 0, max: 2, step: 0.1, unit: '초' },
  { group: '교체·궁극기', key: 'petCooldownMult', label: '펫 쿨 배율', min: 0.25, max: 2, step: 0.05, unit: '×' },
  { group: '생존', key: 'reviveTime', label: '부활 시간', min: 5, max: 60, step: 1, unit: '초' },
  { group: '생존', key: 'reviveHpFrac', label: '부활 HP 비율', min: 0.1, max: 1, step: 0.05, unit: '×' },
  { group: '생존', key: 'floorHealFrac', label: '층 클리어 회복', min: 0, max: 1, step: 0.05, unit: '×' },
  { group: '전투', key: 'botDamageMult', label: '봇 화력 배율', min: 0, max: 3, step: 0.1, unit: '×' },
  { group: '전투', key: 'monsterHpMult', label: '몬스터 HP 배율', min: 0.2, max: 3, step: 0.1, unit: '×' },
  { group: '전투', key: 'monsterDmgMult', label: '몬스터 피해 배율', min: 0, max: 3, step: 0.1, unit: '×' },
  { group: '전투', key: 'floorStatGrowth', label: '층당 몬스터 강화', min: 0, max: 0.5, step: 0.01, unit: '×' },
  { group: '전투', key: 'bossLockReleaseSec', label: '보스 타겟 고정 해제 (0=끔)', min: 0, max: 20, step: 0.5, unit: '초' },
  { group: '층 구성', key: 'normalFloorTime', label: '일반층 제한시간', min: 30, max: 300, step: 5, unit: '초' },
  { group: '층 구성', key: 'bossFloorTime', label: '보스층 제한시간', min: 30, max: 300, step: 5, unit: '초' },
  { group: '층 구성', key: 'waveInterval', label: '웨이브 간격', min: 2, max: 20, step: 0.5, unit: '초' },
  { group: '층 구성', key: 'maxAliveMonsters', label: '동시 최대 몬스터', min: 5, max: 60, step: 1 },
  { group: '층 구성', key: 'maxFloor', label: '최고층', min: 1, max: 50, step: 1, unit: '층' },
  { group: '층 구성', key: 'midBossKillTrigger', label: '중형보스 등장 처치 수', min: 0, max: 40, step: 1, unit: '마리' },
  { group: '층 구성', key: 'midBossTimeTrigger', label: '중형보스 강제 등장', min: 5, max: 120, step: 5, unit: '초' },
  { group: '층 구성', key: 'goedamRoomsPerZone', label: '괴담 방 (구역당)', min: 0, max: 2, step: 1, unit: '개' },
  // 기획 12차: 0 = 돌발 괴담 off entirely (also the floor-2 toad)
  { group: '층 구성', key: 'fieldEventChance', label: '돌발 괴담 확률', min: 0, max: 1, step: 0.05, unit: '×' },
  { group: '진행', key: 'gameSpeed', label: '게임 속도', min: 0.25, max: 4, step: 0.25, unit: '×' },
];

export const TOGGLES: { key: BoolTunable; label: string }[] = [
  { key: 'invincible', label: '무적' },
  { key: 'instantCooldowns', label: '쿨타임 없음' },
];

export const SPEEDS = [0.5, 1, 2, 4];

/** Keys that are NOT persisted between runs (session-only). */
const SESSION_ONLY: ReadonlySet<keyof Tunables> = new Set<keyof Tunables>(['gameSpeed']);

export function formatTunable(spec: SliderSpec, v: number): string {
  const digits = spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : 2;
  return `${v.toFixed(digits)}${spec.unit ?? ''}`;
}

/** Keep only known keys with the right type (numbers clamped to the slider range). */
export function sanitizeOverrides(raw: unknown): Partial<Tunables> {
  const out: Partial<Tunables> = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const s of SLIDERS) {
    if (SESSION_ONLY.has(s.key)) continue;
    const v = r[s.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[s.key] = Math.min(s.max, Math.max(s.min, v));
  }
  for (const t of TOGGLES) {
    const v = r[t.key];
    if (typeof v === 'boolean') out[t.key] = v;
  }
  return out;
}

/** Fields of `t` that differ from DEFAULT_TUNABLES (for persistence). */
export function diffFromDefaults(t: Tunables): Partial<Tunables> {
  const out: Record<string, number | boolean> = {};
  for (const k of Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]) {
    if (SESSION_ONLY.has(k)) continue;
    if (t[k] !== DEFAULT_TUNABLES[k]) out[k] = t[k];
  }
  return out as Partial<Tunables>;
}
