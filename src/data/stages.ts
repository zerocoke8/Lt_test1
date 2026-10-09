// 기획 15차 원정 모드 (docs/expedition.md 3장): 12 stages × 3 floors. Every number here is a bench knob — the balance
// bench (tests/playtest/expedition-bench.ts) patches this object in place (PATCH=…), so keep it a plain mutable object.

import type { FloorTheme } from '../types';

export const EXPEDITION_STAGES = 12;

/** [floor 1 mid boss, floor 2 mid boss, floor 3 guardian (normal stages) / boss (stages 3·6·9·12)] per stage (3-3 표). */
export const MID_BY_STAGE: readonly (readonly [string, string, string])[] = [
  ['ogre', 'lich', 'elevator_girl'],
  ['lich', 'elevator_girl', 'ogre'],
  ['ogre', 'elevator_girl', 'elevator_keeper'],
  ['copier_beast', 'lich', 'elevator_girl'],
  ['lich', 'elevator_girl', 'copier_beast'],
  ['copier_beast', 'elevator_girl', 'overtime_lord'],
  ['head_nurse', 'copier_beast', 'signal_man'],
  ['copier_beast', 'signal_man', 'head_nurse'],
  ['signal_man', 'head_nurse', 'surgeon_director'],
  ['signal_man', 'copier_beast', 'head_nurse'],
  ['copier_beast', 'head_nurse', 'signal_man'],
  ['head_nurse', 'signal_man', 'abyss_watcher'],
];

export const EXPEDITION = {
  stages: EXPEDITION_STAGES,
  /**
   * 원정 전용 단계 배율 (monster HP · attack), stage s → index s − 1. 기획 15차 밸런스 (balance.md 15장): tuned so a fresh
   * party in T(s − 1) commons (직접 교체 1명 + 봇 2명) clears about the 11-1 target. The per-character ult made the early
   * zones easy (> 1); the rooftop has no floor rewards to lean on (< 1).
   */
  stageMult: [1.3, 2.4, 2.0, 1.72, 1.55, 1.42, 1.2, 1.18, 1.18, 0.98, 0.94, 0.97] as number[],
  /** Waves on stage floor 1 / 2 / 3 (guardian floor). 기획 15차 밸런스: 7 / 8 / 6 → 6 / 7 / 5 with a longer gap. */
  waves: [6, 7, 5] as number[],
  /** Seconds between waves (8 → 11: early stages were spawn-bound at ~2.6 min of combat). */
  waveGap: 11,
  /** Time limit of stage floor 1 / 2 / 3 (guardian floor). The boss floor uses bossEnrage instead. */
  timeLimit: [120, 120, 150] as number[],
  /** 수문장: the stage's guardian mid boss × HP / × attack, spawning at `guardianAt` s. (HP 1.8 → 1.5: floor 3 ≤ 95 s.) */
  guardianHp: 1.5,
  guardianAtk: 1.1,
  guardianAt: 10,
  /** Boss stage floor 3: boss HP ×, enrage after this many seconds (classic 90). (HP 1.15 → 1.0: enrage ≤ 25 %.) */
  bossHp: 1.0,
  bossEnrage: 120,
  /** 돌발 괴담 chance on stage floors 1–2 (stage 1 floor 2 = the toad); none on floor 3. */
  fieldEventChance: 0.5,
  /** 괴담 room after the floor-1 reward. */
  roomChance: 1 / 3,
  mids: MID_BY_STAGE,
};

/** Boss stages (3·6·9·12): floor 3 is the zone boss, the loot has a boss box. */
export function isBossStage(stage: number): boolean {
  return stage % 3 === 0;
}

/** Zone index 0..3 of a stage (1–3 lobby, 4–6 office, 7–9 ward, 10–12 rooftop). */
export function stageZoneIndex(stage: number): number {
  return Math.floor((clampStage(stage) - 1) / 3);
}

export const STAGE_THEMES: readonly FloorTheme[] = ['lobby', 'office', 'ward', 'rooftop'];

export function stageTheme(stage: number): FloorTheme {
  return STAGE_THEMES[stageZoneIndex(stage)];
}

export function clampStage(stage: number): number {
  return Math.max(1, Math.min(EXPEDITION_STAGES, Math.floor(Number.isFinite(stage) ? stage : 1)));
}

/**
 * The classic floor a stage floor stands for (3-1): e = (5z − 4) + 0.5 × (3k + j), z = zone 1..4, k = stage within the
 * zone 0..2, j = stage floor 0..2. Boss floors land exactly on classic 5 · 10 · 15 · 20.
 */
export function equivFloor(stage: number, stageFloor: number): number {
  const s = clampStage(stage);
  const z = stageZoneIndex(s) + 1;
  const k = (s - 1) % 3;
  const j = Math.max(1, Math.min(3, Math.floor(stageFloor))) - 1;
  return 5 * z - 4 + 0.5 * (3 * k + j);
}
