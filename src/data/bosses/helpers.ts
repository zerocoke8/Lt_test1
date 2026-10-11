// 기획 19차 보스 레이드: the small builders every boss data file shares (moved from monsters.ts, + row / rowR / at).
// 보스는 맨 위 가장자리에 고정 (BOSS_POS x 12, y −1.2). 'self' 중심 = 보스 자리 → offset으로 아레나(24×12) 안의 자리를 지정.

import type { BossDef, MonsterSkill, SkillAction, Vec2 } from '../../types';

/** The shared enrage of every boss (attack ×1.6 · attack speed ×1.5 · cooldowns ×0.6 · summons ×1.5). */
export const ENRAGE: BossDef['enrage'] = { atkMult: 1.6, atkSpeedMult: 1.5, cooldownMult: 0.6, summonCountMult: 1.5 };

/** A sweep: the same action repeated at several world offsets, `step` seconds apart (boss sequences, `extra`). */
export function sweep(base: SkillAction, offsets: Vec2[], firstDelay: number, step: number): SkillAction[] {
  return offsets.map((offset, i) => ({ ...base, offset, delay: Math.round((firstDelay + i * step) * 1000) / 1000 }));
}

/**
 * The same hit again at each delay, one part per hit — so every hit has its own warning (a boss never uses `hits`:
 * later hits of a multi-hit part re-aim without a telegraph, 기획 19차 review).
 */
export function repeat(base: SkillAction, delays: number[]): SkillAction[] {
  return delays.map(delay => ({ ...base, delay }));
}

/** Several parts as one skill: the first is `action`, the rest `extra`. */
export function seq(parts: SkillAction[]): Pick<MonsterSkill, 'action' | 'extra'> {
  return { action: parts[0], extra: parts.slice(1) };
}

/** Vertical band under the boss: starts at the top wall (y 0) at world x, goes down the whole arena (rect dir 'down'). */
export const band = (x: number): Vec2 => ({ x: x - 12, y: 1.2 });

/** Full-width strip from the left wall at world y (pair with rect dir 'right', length 24 — or 11 for a half-width drawer). */
export const row = (y: number): Vec2 => ({ x: -12, y: y + 1.2 });

/** The same strip from the right wall (pair with rect dir 'left'). */
export const rowR = (y: number): Vec2 => ({ x: 12, y: y + 1.2 });

/** A world spot (x, y) of the boss arena as an offset from the boss (center 'self'). */
export const at = (x: number, y: number): Vec2 => ({ x: x - 12, y: y + 1.2 });
