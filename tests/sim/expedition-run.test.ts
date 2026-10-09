// 기획 16차 원정 모드: the run model (src/expedition/run.ts) the solo controller and the server drive, and the run check
// (src/expedition/runCheck.ts) the server applies to every join and parseStash to a stored run (docs/expedition.md 5장,
// 7장, 10-3).
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import type { ExpRunInfo } from '../../src/net/protocol';
import type { GearLoadout, GearSpec } from '../../src/data/gear';
import {
  applyStageResult,
  bagSummary,
  beginStage,
  nextIsBoss,
  runComplete,
  runFromJoin,
  runToJoin,
  stageGameSetup,
  startRun,
  toLobby,
  type StageResult,
} from '../../src/expedition/run';
import { runJoinProblem } from '../../src/expedition/runCheck';
import { stageResultFromState } from '../../src/sim';
import { createGameWithWorld } from '../../src/sim/game';

const PARTY = ['guardian', 'blade', 'mage'];
const PETS = ['frog_bomb', 'fairy_heal', 'cat_void'];
const ID = 'runRUN_run-12345';
const set = (t: number): GearLoadout => ({ weapon: { slot: 'weapon', tier: t, rarity: 'common' }, armor: { slot: 'armor', tier: t, rarity: 'common' }, charm: { slot: 'charm', tier: t, rarity: 'common' } });
const GEAR3 = [set(3), set(3), set(3)];
const lock = (gear: GearLoadout[] = [{}, {}, {}]) => ({ characters: PARTY, pets: PETS, gear });
const pending = { stage: 0, online: false, bootId: null, tabId: 'tab', aliveAt: 0 };

/** Play one stage of the run (debug clear, first reward, no room) and return its result. */
function playStage(run: ReturnType<typeof startRun>): StageResult {
  const setup = stageGameSetup([{ name: '나', run, firstBossClear: false }], { ...DEFAULT_TUNABLES, invincible: true, goedamRoomsPerZone: 0, fieldEventChance: 0 });
  const { game } = createGameWithWorld(setup);
  game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
  if (game.state.phase === 'reward') game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
  const r = stageResultFromState(game.state, 0)!;
  return { runId: run.id, stage: run.stage, outcome: 'cleared', ...r };
}

describe('run model', () => {
  it('stage 1 → clear → lobby → stage 2 → clear → stage 3 (boss): bag, carry, bots, seeds', () => {
    const run = startRun(1, lock(), ID, 1234);
    expect(run).toMatchObject({ v: 2, id: ID, startStage: 1, stage: 1, cleared: 0, bag: [], carry: null, bossClears: [], status: 'matching', pending: null });
    const setup1 = stageGameSetup([{ name: '나', run, firstBossClear: false }], DEFAULT_TUNABLES);
    expect(setup1.players.map(p => p.isBot)).toEqual([false, true, true]);
    expect(setup1.players[0]).toMatchObject({ characters: PARTY, pets: PETS, gear: [{}, {}, {}] });
    expect(setup1.expedition).toEqual({ stage: 1, carry: [null, null, null], firstBossClear: [false, false, false], clearedThisRun: [0, 0, 0] });
    beginStage(run, pending);
    expect(run.status).toBe('inStage');
    expect(run.pending).toEqual({ ...pending, stage: 1 });
    const r1 = playStage(run);
    expect(applyStageResult(run, r1)).toBe('cleared');
    expect(run).toMatchObject({ stage: 2, cleared: 1, status: 'lobby', pending: null });
    expect(run.bag).toEqual(r1.loot);
    expect(run.carry!.rewards).toHaveLength(1);
    expect(nextIsBoss(run)).toBe(false);
    const setup2 = stageGameSetup([{ name: '나', run, firstBossClear: false }], DEFAULT_TUNABLES);
    expect(setup2.expedition!.carry![0]).toEqual(run.carry);
    expect(setup2.expedition!.clearedThisRun![0]).toBe(1);
    expect(setup2.seed).not.toBe(setup1.seed);
    beginStage(run, pending);
    applyStageResult(run, playStage(run));
    expect(run.stage).toBe(3);
    expect(nextIsBoss(run)).toBe(true);
    expect(bagSummary(run.bag)).toMatchObject({ count: 2, topTier: 2, byBand: [0, 2, 0, 0, 0] });
    beginStage(run, pending);
    const r3 = playStage(run);
    expect(r3.bossClear).toBe(true);
    applyStageResult(run, r3);
    expect(run.bossClears).toEqual([3]);
    expect(runJoinProblem(runToJoin(run), run.stage, [{}, {}, {}], false)).toBeNull();
  });

  it('a result applies once, only to its run and stage, never in the lobby', () => {
    const run = startRun(4, lock(GEAR3), ID, 1);
    beginStage(run, pending);
    const r: StageResult = { runId: ID, stage: 4, outcome: 'cleared', loot: [{ slot: 'armor', tier: 4, rarity: 'common' }], carry: null, bossClear: false };
    expect(applyStageResult(run, { ...r, runId: 'otherRUN12345678' })).toBe('ignored');
    expect(applyStageResult(run, { ...r, stage: 5 })).toBe('ignored');
    expect(applyStageResult(run, r)).toBe('cleared');
    expect(applyStageResult(run, r)).toBe('ignored');
    expect(run.bag).toHaveLength(1);
    expect(run.carry).toBeNull(); // a cleared result without a carry keeps the old one
    beginStage(run, pending);
    expect(applyStageResult(run, { ...r, stage: 5, outcome: 'void', reason: 'server', loot: [] })).toBe('void');
    expect(run).toMatchObject({ stage: 5, cleared: 1, status: 'lobby', pending: null });
    beginStage(run, pending);
    expect(applyStageResult(run, { ...r, stage: 5, outcome: 'failed', reason: 'wipe', loot: [] })).toBe('failed');
    toLobby(run);
    expect(run.status).toBe('lobby');
  });

  it('stage 12 cleared = complete; the server rebuilds a run from its join', () => {
    const run = startRun(12, lock([set(11), set(11), set(11)]), ID, 1);
    expect(runComplete(run)).toBe(false);
    beginStage(run, pending);
    applyStageResult(run, { runId: ID, stage: 12, outcome: 'cleared', loot: [], carry: null, bossClear: true });
    expect(runComplete(run)).toBe(true);
    expect(nextIsBoss(run)).toBe(false);
    const info: ExpRunInfo = { id: ID, startStage: 2, cleared: 2, bag: [{ slot: 'weapon', tier: 3, rarity: 'common' }], carry: null, bossClears: [3] };
    const srv = runFromJoin(info, lock(GEAR3));
    expect(srv).toMatchObject({ id: ID, startStage: 2, stage: 4, cleared: 2, bossClears: [3], status: 'inStage' });
    expect(runToJoin(srv)).toEqual(info);
  });
});

describe('runJoinProblem (10-3)', () => {
  const carry = { rewards: [{ rewardId: 'atk_common', partyIndex: null }, { rewardId: 'atk_common', partyIndex: 1 }], goedamTraces: [{ id: 'silence', floorsLeft: 2 }, { id: 'red_paper', floorsLeft: null }], ult: [0, 0.5, 1], goedamSeen: ['broken_vending'] };
  const good: ExpRunInfo = {
    id: ID,
    startStage: 2,
    cleared: 2,
    bag: [
      { slot: 'weapon', tier: 2, rarity: 'common' },
      { slot: 'armor', tier: 3, rarity: 'common' },
      { slot: 'relic', tier: 3, rarity: 'rare', relicId: 'relay_flag' },
    ],
    carry,
    bossClears: [3],
  };
  const gear = [set(1), set(1), set(1)];
  const bad = (patch: Partial<ExpRunInfo>, stage = 4) => runJoinProblem({ ...good, ...patch }, stage, gear, false);

  it('accepts a run that can exist', () => {
    expect(runJoinProblem(good, 4, gear, false)).toBeNull();
    expect(runJoinProblem(null, 2, gear, false)).toBeNull();
    expect(runJoinProblem({ ...good, startStage: 1, cleared: 0, bag: [], carry: null, bossClears: [] }, 1, [{}, {}, {}], false)).toBeNull();
  });

  it('rejects a fresh / continuing run above the start-stage rule unless the debug unlock is honoured', () => {
    expect(runJoinProblem(null, 3, gear, false)).not.toBeNull();
    expect(runJoinProblem(null, 3, gear, true)).toBeNull();
    expect(runJoinProblem(null, 13, gear, true)).not.toBeNull();
    expect(runJoinProblem({ ...good, startStage: 5, cleared: 0, bag: [], carry: null, bossClears: [] }, 5, gear, false)).not.toBeNull();
    expect(runJoinProblem({ ...good, startStage: 5, cleared: 0, bag: [], carry: null, bossClears: [] }, 5, gear, true)).toBeNull();
  });

  it('rejects impossible runs', () => {
    const cases: [string, string | null][] = [
      ['wrong next stage', bad({}, 5)],
      ['bad id', bad({ id: 'short' })],
      ['bad id chars', bad({ id: 'abc def ghi jkl' })],
      ['cleared out of range', bad({ cleared: 13 }, 15)],
      ['bag tier above played', bad({ bag: [{ slot: 'weapon', tier: 4, rarity: 'common' }] })],
      ['bag tier below start', bad({ bag: [{ slot: 'weapon', tier: 1, rarity: 'common' }] })],
      ['illegal spec', bad({ bag: [{ slot: 'weapon', tier: 2, rarity: 'epic', optionId: 'w_scorch' }] })],
      ['relic off a boss tier', bad({ bag: [{ slot: 'relic', tier: 2, rarity: 'rare', relicId: 'relay_flag' } as GearSpec] })],
      ['too many per normal tier', bad({ bag: [{ slot: 'weapon', tier: 2, rarity: 'common' }, { slot: 'armor', tier: 2, rarity: 'common' }] })],
      ['too many per boss tier', bad({ bag: [0, 1, 2].map(() => ({ slot: 'armor', tier: 3, rarity: 'common' }) as GearSpec) })],
      ['bag not an array', bad({ bag: 'x' as never })],
      ['empty run with a bag', bad({ cleared: 0, startStage: 4, bag: [{ slot: 'weapon', tier: 2, rarity: 'common' }], carry: null, bossClears: [] })],
      ['empty run with a carry', runJoinProblem({ ...good, startStage: 2, cleared: 0, bag: [], carry, bossClears: [] }, 2, gear, false)],
      ['boss clear not a boss stage', bad({ bossClears: [2] })],
      ['boss clear not played', bad({ bossClears: [6] })],
      ['boss clear twice', bad({ bossClears: [3, 3] })],
      ['unknown reward', bad({ carry: { ...carry, rewards: [{ rewardId: 'nope', partyIndex: null }] } })],
      ['reward party index', bad({ carry: { ...carry, rewards: [{ rewardId: 'atk_common', partyIndex: 7 }] } })],
      ['too many rewards', bad({ carry: { ...carry, rewards: Array.from({ length: 5 }, () => ({ rewardId: 'atk_common', partyIndex: null })) } })],
      ['unknown trace', bad({ carry: { ...carry, goedamTraces: [{ id: 'nope', floorsLeft: 1 }] } })],
      ['trace too long', bad({ carry: { ...carry, goedamTraces: [{ id: 'silence', floorsLeft: 9 }] } })],
      ['timed trace forever', bad({ carry: { ...carry, goedamTraces: [{ id: 'silence', floorsLeft: null }] } })],
      ['ult count', bad({ carry: { ...carry, ult: [0, 0] } })],
      ['ult range', bad({ carry: { ...carry, ult: [0, 2, 0] } })],
      ['unknown room', bad({ carry: { ...carry, goedamSeen: ['nope'] } })],
      ['carry shape', bad({ carry: { rewards: 'x' } as never })],
    ];
    for (const [why, problem] of cases) expect(problem, why).not.toBeNull();
  });
});
