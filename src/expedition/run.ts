// 기획 15차 원정 모드: one player's run across stages (docs/expedition.md 5장 · 7장) — the bag, the carry, the stages
// cleared, and the GameSetup of the next stage. Pure: the solo / artifact controller (src/ui/expeditionSolo.ts) and the
// server (server/expedition.ts, session-held, never trusted from the client) both drive it the same way:
//   startRun → stageGameSetup → (game runs) → onStageCleared (state at 'stageClear') → continueRun → stageGameSetup …
//   … → extractRun (bag → stash) | failRun (bag lost; equipped gear is never touched).

import type { ExpeditionCarry, GameSetup, GameState, PlayerSetup, Tunables } from '../types';
import { BOT_PRESETS } from '../config';
import { bandOf, type GearLoadout, type GearSpec } from '../data/gear';
import { EXPEDITION_STAGES, clampStage, isBossStage } from '../data/stages';
import { extractCarry } from '../sim/expedition';
import { mixSeed } from '../sim/rng';

export interface ExpeditionRun {
  /** The stage being / to be played. */
  stage: number;
  /** The stage the run started at. */
  startStage: number;
  /** Loot of the stages cleared this run, not claimed yet (lost on a failure). */
  bag: GearSpec[];
  /** Floor rewards, traces, ult charges carried into the next stage (null before the first clear). */
  carry: ExpeditionCarry | null;
  /** Stages cleared this run. */
  cleared: number;
  /** Seed the stage seeds derive from. */
  seed: number;
  /** 'playing' → 'choosing' (after a clear) → 'playing' (continue) … → 'extracted' | 'failed'. */
  status: 'playing' | 'choosing' | 'extracted' | 'failed';
}

export function startRun(stage: number, seed: number): ExpeditionRun {
  const s = clampStage(stage);
  return { stage: s, startStage: s, bag: [], carry: null, cleared: 0, seed: seed >>> 0, status: 'playing' };
}

/** The seed of one stage game of the run. */
export function stageSeed(run: Pick<ExpeditionRun, 'seed'>, stage: number): number {
  return mixSeed(run.seed, 0x57a6e, stage);
}

/** The human seat of a run (the local player; the server builds one per human from its session). */
export interface RunSeat {
  name: string;
  characters: string[];
  pets: string[];
  gear: GearLoadout[];
  run: ExpeditionRun;
  /** That player's boss first-clear state of this stage (true = the boss box is a sure relic). */
  firstBossClear: boolean;
}

/**
 * GameSetup of a stage game: the human seats in order, then bots up to `seats` (BOT_PRESETS; the sim gives them
 * T(stage − 1) commons). All seats must be at the same stage.
 */
export function stageGameSetup(humans: readonly RunSeat[], tunables: Tunables, seats = 3, seed?: number): GameSetup {
  const stage = humans[0]?.run.stage ?? 1;
  const players: PlayerSetup[] = humans.map(h => ({ name: h.name, isBot: false, characters: [...h.characters], pets: [...h.pets], gear: h.gear.map(l => ({ ...l })) }));
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

/** At 'stageClear': player pi's loot goes into the bag; the carry for the next stage is taken. Returns this stage's loot. */
export function onStageCleared(run: ExpeditionRun, s: GameState, pi: number): GearSpec[] {
  const loot = s.expedition?.loot[pi] ?? [];
  run.bag.push(...loot.map(g => ({ ...g })));
  run.carry = extractCarry(s, pi);
  run.cleared++;
  run.status = 'choosing';
  return loot;
}

/** The run just cleared the last stage (원정 완주: extract only). */
export function runComplete(run: ExpeditionRun): boolean {
  return run.stage >= EXPEDITION_STAGES && run.status === 'choosing';
}

/** 「다음 단계 도전」: on to stage + 1 with the bag and the carry. False when there is no next stage. */
export function continueRun(run: ExpeditionRun): boolean {
  if (run.status !== 'choosing' || run.stage >= EXPEDITION_STAGES) return false;
  run.stage++;
  run.status = 'playing';
  return true;
}

/** 「장비 수령하고 나가기」 (or a cancel in the match queue / the choice timeout): the bag to put into the stash. */
export function extractRun(run: ExpeditionRun): GearSpec[] {
  const items = run.bag;
  run.bag = [];
  run.carry = null;
  run.status = 'extracted';
  return items;
}

/** Wipe / timeout / quit: the bag is lost (returns how many items). Equipped gear is untouched. */
export function failRun(run: ExpeditionRun): number {
  const n = run.bag.length;
  run.bag = [];
  run.carry = null;
  run.status = 'failed';
  return n;
}

/** Bag summary for the HUD chip / choice screen: count, highest tier, count per band (index 1..4). */
export function bagSummary(bag: readonly GearSpec[]): { count: number; topTier: number; byBand: number[] } {
  const byBand = [0, 0, 0, 0, 0];
  let topTier = 0;
  for (const g of bag) {
    byBand[bandOf(g.tier)]++;
    topTier = Math.max(topTier, g.tier);
  }
  return { count: bag.length, topTier, byBand };
}

/** 「다음은 보스 단계」 chip. */
export function nextIsBoss(run: ExpeditionRun): boolean {
  return run.stage < EXPEDITION_STAGES && isBossStage(run.stage + 1);
}
