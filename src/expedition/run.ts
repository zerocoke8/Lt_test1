// 기획 16차 원정 모드: one player's run across stages (docs/expedition.md 5장 · 7장 · 10장) — the bag, the carry, the
// stages cleared, the locked party and where the run stands. A stage is one floor and every stage ends in the 원정 lobby,
// so the run lives in the browser (StashData.run, src/expedition/stash.ts) between stages; the server only checks it
// at each join (runJoinProblem, ./runCheck.ts) and answers with one StageResult per stage. Pure: the solo / artifact
// controller (src/ui/expeditionSolo.ts) and the server (server/expedition.ts) both drive it the same way:
//   startRun ('matching') → beginStage ('inStage') → (game) → applyStageResult → 'lobby' (cleared / void) | dropped (failed)
//   … lobby → beginStage (next stage) … → claimRun (stash.ts: bag → stash, run gone)

import type { ExpeditionCarry, GameSetup, PlayerSetup, Tunables } from '../types';
import type { ExpResultReason, ExpRunInfo, ExpStageOutcome } from '../net/protocol';
import { BOT_PRESETS } from '../config';
import { bandOf, type GearLoadout, type GearSpec } from '../data/gear';
import { EXPEDITION_STAGES, clampStage, isBossStage } from '../data/stages';
import { mixSeed } from '../sim/rng';

/** lobby = between stages (수령 / N단계 매칭), matching = in a queue (or about to start solo), inStage = a game runs. */
export type RunStatus = 'lobby' | 'matching' | 'inStage';

/** The party the run started with (equipment / party changes are locked while a run exists, 5-4). */
export interface RunLock {
  characters: string[];
  pets: string[];
  /** Equipped gear per party index, as it was at the run start. */
  gear: GearLoadout[];
}

/** The stage game in progress (status 'inStage'). */
export interface RunPending {
  stage: number;
  online: boolean;
  /** The server's boot id at the join (welcome.bootId); a different one later = that stage is gone (void). */
  bootId: string | null;
  /** The tab that plays it (a solo stage whose tab went silent > 10 s is a failure — 5-3). */
  tabId: string;
  /** Date.now() of that tab's last heartbeat. */
  aliveAt: number;
  /**
   * 기획 16차 (solo): the combat is won — what the stage gives if this tab dies before the stage end (floor reward /
   * 괴담 room still open; wonResultFromState). A stale solo stage with it settles as cleared, not failed.
   */
  won?: WonStage;
}

/** A won stage's result, saved at the combat clear (RunPending.won). */
export interface WonStage {
  loot: GearSpec[];
  carry: ExpeditionCarry;
  bossClear: boolean;
}

export interface ExpeditionRun {
  v: 2;
  /** Random id (8–40 chars [A-Za-z0-9_-]); results are matched by it. */
  id: string;
  /** Seed the solo stage seeds derive from. */
  seed: number;
  /** The stage the run started at. */
  startStage: number;
  /** The stage to play next (= startStage + cleared; > 12 once stage 12 is cleared). */
  stage: number;
  /** Stages cleared this run. */
  cleared: number;
  /** Unclaimed loot of the stages cleared (tier = the stage it came from; NEW = tier === stage − 1). Lost on a failure. */
  bag: GearSpec[];
  /** Floor rewards, traces, ult charges, rooms seen, carried into the next stage (null before the first clear). */
  carry: ExpeditionCarry | null;
  /** Boss stages cleared this run (recorded in the stash at the claim). */
  bossClears: number[];
  lock: RunLock;
  status: RunStatus;
  pending: RunPending | null;
}

/** One stage game's meaning for a run (solo: from the final state; online: expStageResult). */
export interface StageResult {
  runId: string;
  stage: number;
  outcome: ExpStageOutcome;
  reason?: ExpResultReason;
  loot: GearSpec[];
  carry: ExpeditionCarry | null;
  bossClear: boolean;
}

export type ApplyKind = 'cleared' | 'failed' | 'void' | 'ignored';

function copyLock(l: RunLock): RunLock {
  return { characters: [...l.characters], pets: [...l.pets], gear: l.gear.map(x => ({ ...x })) };
}

/** A fresh run at `stage` (status 'matching': its first stage is about to be matched / started). */
export function startRun(stage: number, lock: RunLock, id: string, seed: number): ExpeditionRun {
  const s = clampStage(stage);
  return { v: 2, id, seed: seed >>> 0, startStage: s, stage: s, cleared: 0, bag: [], carry: null, bossClears: [], lock: copyLock(lock), status: 'matching', pending: null };
}

/** The seed of one solo stage game of the run. */
export function stageSeed(run: Pick<ExpeditionRun, 'seed'>, stage: number): number {
  return mixSeed(run.seed, 0x57a6e, stage);
}

/** A stage game of the run starts (saved BEFORE the game / the join, so a reload knows a stage was running). */
export function beginStage(run: ExpeditionRun, pending: RunPending): void {
  run.status = 'inStage';
  run.pending = { ...pending, stage: run.stage };
}

/** Back to the lobby without a result (cancelled queue). */
export function toLobby(run: ExpeditionRun): void {
  run.status = 'lobby';
  run.pending = null;
}

/**
 * Apply a stage result once. Ignored unless it is this run's current stage and the run is not in the lobby (so a
 * second delivery of the same result changes nothing). 'cleared': the loot into the bag, the new carry, stage + 1,
 * back to the lobby. 'void': back to the lobby, nothing else. 'failed': the run is over — the caller drops it (the bag
 * is lost; equipped gear is never touched).
 */
export function applyStageResult(run: ExpeditionRun, r: StageResult): ApplyKind {
  if (r.runId !== run.id || r.stage !== run.stage || run.status === 'lobby') return 'ignored';
  run.pending = null;
  run.status = 'lobby';
  if (r.outcome === 'failed') return 'failed';
  if (r.outcome === 'void') return 'void';
  run.bag.push(...r.loot.map(g => ({ ...g })));
  run.carry = r.carry ? copyCarry(r.carry) : run.carry;
  run.cleared++;
  if (r.bossClear && isBossStage(run.stage) && !run.bossClears.includes(run.stage)) run.bossClears.push(run.stage);
  run.stage++;
  return 'cleared';
}

function copyCarry(c: ExpeditionCarry): ExpeditionCarry {
  return {
    rewards: c.rewards.map(r => ({ rewardId: r.rewardId, partyIndex: r.partyIndex })),
    goedamTraces: c.goedamTraces.map(t => ({ id: t.id, floorsLeft: t.floorsLeft })),
    ult: [...c.ult],
    ...(c.goedamSeen ? { goedamSeen: [...c.goedamSeen] } : null),
  };
}

/** The run cleared stage 12 (원정 완주: claim only). */
export function runComplete(run: Pick<ExpeditionRun, 'stage'>): boolean {
  return run.stage > EXPEDITION_STAGES;
}

/**
 * What expQueue carries (`run`). Send it for every stage, the first one too (cleared 0): the server keeps the client's
 * run id and its expStageResult carries it back. (run null = a server-made id the client never sees — tests only.)
 */
export function runToJoin(run: ExpeditionRun): ExpRunInfo {
  return {
    id: run.id,
    startStage: run.startStage,
    cleared: run.cleared,
    bag: run.bag.map(g => ({ ...g })),
    carry: run.carry ? copyCarry(run.carry) : null,
    bossClears: [...run.bossClears],
  };
}

/** Server: the run of a validated join (status 'inStage'; it lives only while queued / playing). */
export function runFromJoin(info: ExpRunInfo, lock: RunLock): ExpeditionRun {
  return {
    v: 2,
    id: info.id,
    seed: 0,
    startStage: info.startStage,
    stage: info.startStage + info.cleared,
    cleared: info.cleared,
    bag: info.bag.map(g => ({ ...g })),
    carry: info.carry ? copyCarry(info.carry) : null,
    bossClears: [...info.bossClears],
    lock: copyLock(lock),
    status: 'inStage',
    pending: null,
  };
}

/** A human seat of a stage game (the local player; the server builds one per human from the join). */
export interface RunSeat {
  name: string;
  /** Party, pets and gear come from run.lock. */
  run: ExpeditionRun;
  /** Clearing this boss stage would be that player's first (the boss box is a sure relic). */
  firstBossClear: boolean;
}

/**
 * GameSetup of a stage game: the human seats in order, then bots up to `seats` (BOT_PRESETS; the sim gives them
 * T(stage − 1) commons). All seats must be at the same stage.
 */
export function stageGameSetup(humans: readonly RunSeat[], tunables: Tunables, seats = 3, seed?: number): GameSetup {
  const stage = clampStage(humans[0]?.run.stage ?? 1);
  const players: PlayerSetup[] = humans.map(h => ({
    name: h.name,
    isBot: false,
    characters: [...h.run.lock.characters],
    pets: [...h.run.lock.pets],
    gear: h.run.lock.gear.map(l => ({ ...l })),
  }));
  for (let i = 0; players.length < seats; i++) {
    const b = BOT_PRESETS[i % BOT_PRESETS.length];
    players.push({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] });
  }
  const pad = <T>(xs: T[], d: T): T[] => [...xs, ...Array<T>(Math.max(0, players.length - xs.length)).fill(d)];
  return {
    seed: seed ?? (humans[0] ? stageSeed(humans[0].run, stage) : stage),
    players,
    tunables: { ...tunables },
    expedition: {
      stage,
      carry: pad(humans.map(h => h.run.carry), null),
      firstBossClear: pad(humans.map(h => h.firstBossClear), false),
      clearedThisRun: pad(humans.map(h => h.run.cleared), 0),
    },
  };
}

/** Bag summary for the HUD chip / lobby: count, highest tier, count per band (index 1..4). */
export function bagSummary(bag: readonly GearSpec[]): { count: number; topTier: number; byBand: number[] } {
  const byBand = [0, 0, 0, 0, 0];
  let topTier = 0;
  for (const g of bag) {
    byBand[bandOf(g.tier)]++;
    topTier = Math.max(topTier, g.tier);
  }
  return { count: bag.length, topTier, byBand };
}

/** 「다음은 보스 단계」: the stage to play next is a boss stage (기획 16차: run.stage is the NEXT stage). */
export function nextIsBoss(run: Pick<ExpeditionRun, 'stage'>): boolean {
  return run.stage <= EXPEDITION_STAGES && isBossStage(run.stage);
}
