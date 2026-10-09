// 기획 16차 원정 모드: is a run (as the browser sends / keeps it) a run that can exist? (docs/expedition.md 10-3)
// The server checks every expQueue with it ('bad_run'); parseStash drops a stored run that fails it. It checks the
// shape and the values that can come out of a real run (tiers, counts, ids) — not that this player really earned them
// (the stash lives in the browser anyway; prototype level, like the 15차 gear check). Pure.
// So the start-stage gate and the run lock are ADVISORY against a modified client: a forged continuing run
// (cleared > 0) skips the 'stage_locked' check, and gear / party come from each join. Checking against the server's
// stored results would break every continuing run after a deploy (results live in memory), so it is not done.

import type { ExpeditionCarry } from '../types';
import type { ExpRunInfo } from '../net/protocol';
import { GOEDAM_ROOMS, GOEDAM_TRACES, REWARDS } from '../data';
import { gearSpecProblem, maxStartStage, type GearLoadout } from '../data/gear';
import { EXPEDITION_STAGES, isBossStage, maxStageLoot } from '../data/stages';

/** Run ids: random letters (the client makes 16, the server 16; anything 8–40 of these is accepted). */
export const RUN_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
/** Floor rewards a stage can add (its floor reward + a 괴담 room's). */
export const REWARDS_PER_STAGE = 2;

const REWARD_IDS = new Set(REWARDS.map(r => r.id));
const ROOM_IDS = new Set(GOEDAM_ROOMS.map(r => r.id));
const TRACE_FLOORS = new Map(GOEDAM_TRACES.map(t => [t.id, t.floors]));

const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

export interface RunCheckOpts {
  /** Ignore the start-stage gear rule (debug 「단계 전부 해금」). */
  debugOk: boolean;
  /** Stage 13 allowed (a stored run that cleared stage 12 and waits for its claim). */
  allowComplete?: boolean;
}

/**
 * Why `info` cannot be a run that plays `stage` next with this gear (null = fine). `info` null = a fresh run: only
 * the stage range and the start-stage rule.
 */
export function runJoinProblem(info: ExpRunInfo | null, stage: number, gear: readonly GearLoadout[], debugOk: boolean): string | null {
  return runInfoProblem(info, stage, gear, { debugOk });
}

export function runInfoProblem(info: ExpRunInfo | null, stage: number, gear: readonly GearLoadout[], opts: RunCheckOpts): string | null {
  const top = opts.allowComplete ? EXPEDITION_STAGES + 1 : EXPEDITION_STAGES;
  if (!isInt(stage, 1, top)) return '단계';
  if (!info) return stage > EXPEDITION_STAGES || (!opts.debugOk && stage > maxStartStage(gear)) ? '출발 단계' : null;
  if (typeof info !== 'object') return '형식';
  if (typeof info.id !== 'string' || !RUN_ID_RE.test(info.id)) return '런 번호';
  if (!isInt(info.startStage, 1, EXPEDITION_STAGES) || !isInt(info.cleared, 0, EXPEDITION_STAGES)) return '단계 수';
  if (info.startStage + info.cleared !== stage) return '다음 단계';
  if (!opts.debugOk && info.startStage > maxStartStage(gear)) return '출발 단계';
  if (info.cleared === 0 && ((info.bag?.length ?? 0) > 0 || info.carry != null || (info.bossClears?.length ?? 0) > 0)) return '빈 런';
  return bagProblem(info, stage) ?? bossClearProblem(info, stage) ?? carryProblem(info.carry, info.cleared);
}

/** Every bag item legal, tier in [startStage, stage − 1], relics only at boss tiers, per-tier count ≤ the stage's loot. */
function bagProblem(info: ExpRunInfo, stage: number): string | null {
  if (!Array.isArray(info.bag)) return '가방';
  const perTier = new Map<number, number>();
  for (const g of info.bag) {
    if (gearSpecProblem(g)) return '가방 장비';
    if (g.tier < info.startStage || g.tier > stage - 1) return '가방 등급';
    if (g.slot === 'relic' && !isBossStage(g.tier)) return '가방 유물';
    const n = (perTier.get(g.tier) ?? 0) + 1;
    if (n > maxStageLoot(g.tier)) return '가방 개수';
    perTier.set(g.tier, n);
  }
  return null;
}

function bossClearProblem(info: ExpRunInfo, stage: number): string | null {
  const b = info.bossClears;
  if (!Array.isArray(b) || new Set(b).size !== b.length) return '보스 클리어';
  return b.every(n => isInt(n, info.startStage, stage - 1) && isBossStage(n)) ? null : '보스 클리어';
}

/** Rewards / traces / rooms are real ids, traces ≤ their length, 3 ult charges in [0, 1], rewards ≤ cleared × 2. */
function carryProblem(c: ExpeditionCarry | null, cleared: number): string | null {
  if (c == null) return null;
  if (typeof c !== 'object' || !Array.isArray(c.rewards) || !Array.isArray(c.goedamTraces) || !Array.isArray(c.ult)) return '버프 형식';
  if (c.rewards.length > cleared * REWARDS_PER_STAGE) return '버프 수';
  for (const r of c.rewards) {
    if (!r || !REWARD_IDS.has(r.rewardId) || !(r.partyIndex === null || isInt(r.partyIndex, 0, 2))) return '버프';
  }
  for (const t of c.goedamTraces) {
    if (!t || !TRACE_FLOORS.has(t.id)) return '흔적';
    const max = TRACE_FLOORS.get(t.id)!;
    if (max == null ? t.floorsLeft !== null : !isInt(t.floorsLeft, 1, max)) return '흔적 단계';
  }
  if (c.ult.length !== 3 || !c.ult.every(v => typeof v === 'number' && v >= 0 && v <= 1)) return '궁극기';
  const seen = c.goedamSeen ?? [];
  if (!Array.isArray(seen) || !seen.every(id => typeof id === 'string' && ROOM_IDS.has(id))) return '괴담 방';
  return null;
}
