// 기획 15차 원정 모드 (docs/expedition.md 3장): 12 stages. 기획 16차: a stage is ONE floor (normal stage = waves + the
// 수문장, boss stage = the zone boss alone) and every stage ends in the 원정 lobby. Every number here is a bench knob —
// the balance bench (tests/review/expedition-bench.ts) patches this object in place (PATCH=…), so keep it a plain
// mutable object.

import type { FloorTheme } from '../types';

export const EXPEDITION_STAGES = 12;

/**
 * 기획 16차: the stage's one big foe — the 수문장 (guardian mid boss) of a normal stage, the zone boss of stages
 * 3 · 6 · 9 · 12 (3-3 표).
 */
export const STAGE_FOE: readonly string[] = [
  'elevator_girl',
  'ogre',
  'elevator_keeper',
  'elevator_girl',
  'copier_beast',
  'overtime_lord',
  'signal_man',
  'head_nurse',
  'surgeon_director',
  'head_nurse',
  'signal_man',
  'abyss_watcher',
];

export const EXPEDITION = {
  stages: EXPEDITION_STAGES,
  /**
   * 원정 전용 단계 배율 (monster HP · attack), stage s → index s − 1. 기획 16차 밸런스 (balance.md 16장): retuned on the
   * one-floor stages to the 11-1 clear targets (15차: 1.3 · 2.4 · 2.0 · 1.72 · 1.55 · 1.42 · 1.2 · 1.18 · 1.18 · 0.98 ·
   * 0.94 · 0.97). Boss stages read with bossHp: their HP is stageMult × bossHp, their attack stageMult alone.
   */
  stageMult: [1.6, 2.4, 1.9, 1.72, 1.5, 1.54, 1.28, 1.25, 1.32, 0.98, 0.96, 1.04] as number[],
  /** 기획 16차: waves per stage (index s − 1); boss stages 0 (the boss alone). */
  waves: [7, 7, 0, 6, 6, 0, 6, 6, 0, 6, 6, 0] as number[],
  /** 기획 16차: the max gap (s) between wave warnings (FloorPlan.maxGap; the classic tower uses tunables.waveInterval). */
  waveGap: 11,
  /** Time limit (s) of a normal stage. A boss stage uses bossEnrage instead. */
  timeLimit: 150,
  /**
   * 수문장: the stage's guardian mid boss × HP / × attack. It comes with the second-to-last wave. 기획 16차 밸런스: HP
   * 1.0 → 0.8 (a 수문장 nobody could finish ran the stage into its 150 s limit: timeouts 2.5–4 % → ≤ 3 %).
   */
  guardianHp: 0.8,
  guardianAtk: 1.0,
  /**
   * Boss stage: boss HP ×, enrage after this many seconds (classic 90). 기획 16차 밸런스: bossHp 1.0 → 0.8 with the
   * boss stages' stageMult raised — the same clear rate in a shorter fight (enrage share 3단계 45 % · 6단계 72 % → ≤ 25 %).
   */
  bossHp: 0.8,
  bossEnrage: 120,
  /** 돌발 괴담 chance on a normal stage (stage 1 = the toad for sure); none on boss stages. */
  fieldEventChance: 0.4,
  /** 괴담 room after a normal stage's floor reward. */
  roomChance: 0.2,
  /** Loot: base items for clearing a normal stage / a boss stage (plus the boss box). */
  lootNormal: 1,
  lootBossBase: 1,
  foes: STAGE_FOE,
};

/** Boss stages (3·6·9·12): the zone boss alone, the loot has a boss box. */
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

/** Most base items one stage can drop (a boss box that rolls no relic adds one): the run check's per-tier cap. */
export function maxStageLoot(stage: number): number {
  return isBossStage(stage) ? EXPEDITION.lootBossBase + 1 : EXPEDITION.lootNormal;
}

/**
 * The classic floor a stage stands for (3-1, 기획 16차): e = 5z − 3 + 1.5k, z = zone 1..4, k = stage within the zone
 * 0..2 → 2 · 3.5 · 5 · 7 · … · 20. Boss stages land exactly on classic 5 · 10 · 15 · 20.
 */
export function equivFloor(stage: number): number {
  const s = clampStage(stage);
  const z = stageZoneIndex(s) + 1;
  const k = (s - 1) % 3;
  return 5 * z - 3 + 1.5 * k;
}
