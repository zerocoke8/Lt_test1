// 기획 16차 원정 on the server (server/expedition.ts): per-stage queues (3 joins start at once, a lone joiner gets bots
// after the queue time, 「바로 출발」), gear / start-stage / run validation ('bad_run', 'run_busy'), one expStageResult per
// player per stage (normal stage: after the floor reward; boss stage: at the clear), a continuing join with the run the
// browser keeps (carry applied), results kept by run id (reconnect, expStatus, expNoStage), a quit before / after the
// clear, a lost stage, a server error before the clear (void), welcome.bootId, and classic rooms untouched.
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer, ServerOptions } from '../../server/server';
import type { ClientMsg, ExpRunInfo, PresetChoice, ServerMsg } from '../../src/net/protocol';
import { parseClientMsg } from '../../server/validate';
import type { GearLoadout } from '../../src/data/gear';
import { PRESET_A, PRESET_B, sleep, startTestServer, TestClient } from './helpers';

let srv: RunningServer | null = null;
const clients: TestClient[] = [];

async function server(opts: Partial<ServerOptions> = {}): Promise<RunningServer> {
  srv = await startTestServer({ expQueueSec: 30, expLaunchMs: 0, expSharedDebug: true, ...opts });
  return srv;
}

async function connect(name: string, token?: string): Promise<TestClient> {
  const c = await TestClient.connect(srv!.port, name, token);
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.kill();
  await srv?.close();
  srv = null;
});

const tierSet = (t: number): GearLoadout => ({
  weapon: { slot: 'weapon', tier: t, rarity: 'common' },
  armor: { slot: 'armor', tier: t, rarity: 'common' },
  charm: { slot: 'charm', tier: t, rarity: 'common' },
});
const NO_GEAR: GearLoadout[] = [{}, {}, {}];

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;
type Result = Msg<'expStageResult'>;

let runSerial = 0;
/** A fresh run (cleared nothing) at `stage`. */
function freshRun(stage: number): ExpRunInfo {
  return { id: `testRun${String(++runSerial).padStart(8, '0')}`, startStage: stage, cleared: 0, bag: [], carry: null, bossClears: [] };
}

/** The run after a cleared result (what the browser stores). */
function afterClear(run: ExpRunInfo, r: Result): ExpRunInfo {
  return { ...run, cleared: run.cleared + 1, bag: [...run.bag, ...r.loot], carry: r.carry, bossClears: r.bossClear ? [...run.bossClears, r.stage] : run.bossClears };
}

function queueMsg(stage: number, preset: PresetChoice = PRESET_A, gear: GearLoadout[] = NO_GEAR, extra: Record<string, unknown> = {}): ClientMsg {
  return { t: 'expQueue', stage, characters: preset.characters, pets: preset.pets, gear, firstBossClears: [], run: freshRun(stage), ...extra } as ClientMsg;
}

/** Queue every client at `stage`, one after another (the first is seat 0 = the room host); returns each one's 'start'. */
async function queueAll(stage: number, ...cs: TestClient[]): Promise<Msg<'start'>[]> {
  for (const c of cs) c.mark();
  for (const [i, c] of cs.entries()) {
    c.send(queueMsg(stage, i % 2 ? PRESET_B : PRESET_A));
    if (i < cs.length - 1) await c.next('expQueueState');
  }
  const starts: Msg<'start'>[] = [];
  for (const c of cs) starts.push(await c.next('start'));
  return starts;
}

/** A lone player (seat 0 + 2 bots) starts `run` at its next stage. */
async function soloStart(c: TestClient, run: ExpRunInfo, gear: GearLoadout[] = NO_GEAR, extra: Record<string, unknown> = {}): Promise<void> {
  c.mark();
  c.send(queueMsg(run.startStage + run.cleared, PRESET_A, gear, { run, ...extra }));
  await c.next('expQueueState');
  c.send({ t: 'expStartNow' });
  expect((await c.next('start')).mode).toBe('expedition');
}

/** The host wins the stage's combat at once (debug). */
async function winCombat(host: TestClient, seq = 77): Promise<void> {
  host.send({ t: 'cmd', seq, cmd: { type: 'debug', action: { kind: 'expeditionClearStage' } } });
  expect((await host.next('cmdResult', m => m.seq === seq)).ok).toBe(true);
}

/** A boss stage is over at its clear: the result comes while the command runs (before its cmdResult). */
async function winBoss(host: TestClient, seq = 77): Promise<Result> {
  host.send({ t: 'cmd', seq, cmd: { type: 'debug', action: { kind: 'expeditionClearStage' } } });
  const r = await host.next('expStageResult');
  expect((await host.next('cmdResult', m => m.seq === seq)).ok).toBe(true);
  return r;
}

const pick = (c: TestClient, seq = 6) => c.send({ t: 'cmd', seq, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } });

describe('expQueue parsing (protocol 4)', () => {
  it('accepts a well-formed join with its run and rebuilds it; junk is dropped', () => {
    const run: ExpRunInfo = {
      id: 'abcdefgh1234',
      startStage: 2,
      cleared: 1,
      bag: [{ slot: 'weapon', tier: 2, rarity: 'common' }],
      carry: { rewards: [{ rewardId: 'atk_common', partyIndex: null }], goedamTraces: [{ id: 'silence', floorsLeft: 1 }], ult: [0, 0.5, 1], goedamSeen: [] },
      bossClears: [],
    };
    const raw = { ...queueMsg(3, PRESET_A, [tierSet(1), tierSet(1), tierSet(1)], { firstBossClears: [3, 3] }), x: 1, run: { ...run, extra: 1, bag: [{ ...run.bag[0], evil: 1 }] } };
    const m = parseClientMsg(JSON.stringify(raw));
    expect(m).toMatchObject({ t: 'expQueue', stage: 3, characters: PRESET_A.characters, pets: PRESET_A.pets, firstBossClears: [3] });
    expect(m).not.toHaveProperty('x');
    expect((m as Extract<ClientMsg, { t: 'expQueue' }>).run).toEqual(run);
    expect((parseClientMsg(JSON.stringify({ ...raw, run: null })) as Extract<ClientMsg, { t: 'expQueue' }>).run).toBeNull();
    expect(parseClientMsg(JSON.stringify(queueMsg(0)))).toBeNull();
    expect(parseClientMsg(JSON.stringify(queueMsg(13)))).toBeNull();
    expect(parseClientMsg(JSON.stringify(queueMsg(1, { characters: ['blade', 'blade', 'mage'], pets: PRESET_A.pets })))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...queueMsg(1), firstBossClears: [99] }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...raw, run: { ...run, id: 'no spaces allowed' } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...raw, run: { ...run, bag: Array.from({ length: 65 }, () => run.bag[0]) } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...raw, run: { ...run, carry: { ...run.carry, ult: [0, 0, 0, 0] } } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...raw, run: 'x' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'expStatus', runId: 'abcdefgh1234' }))).toEqual({ t: 'expStatus', runId: 'abcdefgh1234' });
    expect(parseClientMsg(JSON.stringify({ t: 'expStatus', runId: 'x' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'expStatus', runId: 'abcdefgh1234', stage: 2 }))).toEqual({ t: 'expStatus', runId: 'abcdefgh1234', stage: 2 });
    // the 15차 in-game choice is gone
    expect(parseClientMsg(JSON.stringify({ t: 'expChoice', choice: 'continue' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { type: 'expeditionChoice', choice: 'extract', player: 2 } }))).toBeNull();
  });
});

describe('expedition queues', () => {
  it('welcome carries the boot id of this server process', async () => {
    await server();
    const [a, b] = [await connect('A'), await connect('B')];
    const wa = a.last('welcome')!;
    expect(wa.bootId).toMatch(/^[0-9a-f]{16}$/);
    expect(b.last('welcome')!.bootId).toBe(wa.bootId);
    expect(wa.v).toBe(5); // 기획 17차: protocol 5
  });

  it('rejects impossible gear and a start stage above what the gear allows', async () => {
    await server({ expDebugUnlock: false });
    const a = await connect('A');
    a.mark();
    a.send(queueMsg(1, PRESET_A, [{ weapon: { slot: 'weapon', tier: 13, rarity: 'common' } }, {}, {}] as GearLoadout[]));
    expect((await a.next('error')).code).toBe('bad_gear');
    a.send(queueMsg(1, PRESET_A, [{}, {}] as GearLoadout[]));
    expect((await a.next('error')).code).toBe('bad_gear');
    for (const bad of [
      { weapon: { slot: 'weapon', tier: 1, rarity: 'epic', optionId: 'w_execute' } },
      { weapon: { slot: 'weapon', tier: 6, rarity: 'rare' } },
      { relic: { slot: 'relic', tier: 3, rarity: 'common', relicId: 'echo_seal' } },
    ]) {
      a.send(queueMsg(1, PRESET_A, [bad, {}, {}] as GearLoadout[]));
      expect((await a.next('error')).code).toBe('bad_gear');
    }
    // empty slots → stage 1 only; full T1 → stage 2; the debug unlock is refused on this server
    a.send(queueMsg(2));
    expect((await a.next('error')).code).toBe('stage_locked');
    a.send(queueMsg(3, PRESET_A, [tierSet(1), tierSet(1), tierSet(1)], { debugUnlock: true }));
    expect((await a.next('error')).code).toBe('stage_locked');
    a.send(queueMsg(2, PRESET_A, [tierSet(1), tierSet(1), tierSet(1)]));
    const q = await a.next('expQueueState');
    expect(q).toMatchObject({ stage: 2, you: 0, launching: false, continuing: false, bagCount: 0 });
    expect(q.seats[0].gear[0].weapon?.tier).toBe(1);
  });

  it('honours the debug unlock when the server allows it', async () => {
    await server();
    const a = await connect('A');
    a.mark();
    a.send(queueMsg(7, PRESET_A, NO_GEAR, { debugUnlock: true }));
    expect((await a.next('expQueueState')).stage).toBe(7);
  });

  it('3 joiners at the same stage start at once (others queue apart)', async () => {
    await server();
    const [a, b, c, d] = [await connect('A'), await connect('B'), await connect('C'), await connect('D')];
    d.mark();
    d.send(queueMsg(2, PRESET_A, [tierSet(1), tierSet(1), tierSet(1)]));
    await d.next('expQueueState');
    d.send(queueMsg(1));
    expect((await d.next('error')).code).toBe('bad_request'); // one run per player
    const starts = await queueAll(1, a, b, c);
    expect(starts.map(s => s.playerIndex)).toEqual([0, 1, 2]);
    expect(starts.every(s => s.mode === 'expedition')).toBe(true);
    const snap = await a.snap();
    expect(snap.state.expedition).toEqual({ stage: 1, boss: false, outcome: 'running', loot: [[], [], []], humans: [true, true, true], goedamSeen: [] });
    expect(snap.state.plan).toMatchObject({ floor: 1, stage: 1, maxGap: 11 });
    expect(snap).not.toHaveProperty('choiceDeadline');
    expect(d.count('start')).toBe(0);
    d.send({ t: 'listRooms' });
    expect((await d.next('rooms')).rooms).toHaveLength(0);
  });

  it('a lone joiner gets 2 bots after the queue time; 「바로 출발」 starts at once', async () => {
    await server({ expQueueSec: 0.4 });
    const a = await connect('A');
    a.mark();
    a.send(queueMsg(1));
    expect((await a.next('expQueueState')).secondsLeft).toBe(1);
    const launching = await a.next('expQueueState', m => m.launching);
    expect(launching.seats.map(s => s.isBot)).toEqual([false, true, true]);
    await a.next('start');
    expect((await a.snap()).state.players.map(p => p.isBot)).toEqual([false, true, true]);
    const c = await connect('C');
    await soloStart(c, freshRun(1));
  });

  it('cancel leaves the queue and never claims; the same run can queue again', async () => {
    await server();
    const a = await connect('A');
    const run = { ...freshRun(2), cleared: 1, startStage: 1, bag: [{ slot: 'armor' as const, tier: 1, rarity: 'common' as const }] };
    a.mark();
    a.send(queueMsg(2, PRESET_A, NO_GEAR, { run }));
    expect(await a.next('expQueueState')).toMatchObject({ stage: 2, continuing: true, bagCount: 1 });
    a.send({ t: 'expCancel' });
    await a.next('expCancelled');
    expect(a.count('expStageResult')).toBe(0);
    a.send(queueMsg(2, PRESET_A, NO_GEAR, { run }));
    await a.next('expQueueState');
  });
});

describe('runs: validation and one live stage per run', () => {
  it("'bad_run' for a run that cannot exist; 'run_busy' for the same run from another tab", async () => {
    await server({ expDebugUnlock: false });
    const [a, b] = [await connect('A'), await connect('B')];
    a.mark();
    const run: ExpRunInfo = { ...freshRun(1), cleared: 1, bag: [{ slot: 'weapon', tier: 1, rarity: 'common' }] };
    for (const bad of [
      { ...run, cleared: 2 }, // stage 2 ≠ 1 + 2
      { ...run, bag: [{ slot: 'weapon', tier: 2, rarity: 'common' }] }, // tier of a stage not played yet
      { ...run, bag: [run.bag[0], run.bag[0]] }, // 2 items from one normal stage
      { ...run, bossClears: [3] },
      { ...run, carry: { rewards: [{ rewardId: 'nope', partyIndex: null }], goedamTraces: [], ult: [0, 0, 0] } },
    ]) {
      a.send(queueMsg(2, PRESET_A, NO_GEAR, { run: bad }));
      expect((await a.next('error')).code).toBe('bad_run');
    }
    a.send(queueMsg(2, PRESET_A, NO_GEAR, { run }));
    await a.next('expQueueState');
    b.mark();
    b.send(queueMsg(2, PRESET_A, NO_GEAR, { run }));
    expect(await b.next('error')).toMatchObject({ code: 'run_busy', message: '다른 창에서 이미 진행 중이에요' });
    a.send({ t: 'expCancel' });
    await a.next('expCancelled');
    b.send(queueMsg(2, PRESET_A, NO_GEAR, { run }));
    await b.next('expQueueState');
  });
});

describe('stage results', () => {
  it('normal stage: one reward pick each, then each human gets a cleared result; continuing joins carry it', async () => {
    await server({ expQueueSec: 1 });
    const [a, b, c] = [await connect('A'), await connect('B'), await connect('C')];
    const runs = new Map<TestClient, ExpRunInfo>();
    for (const [i, x] of [a, b, c].entries()) {
      const run = freshRun(1);
      runs.set(x, run);
      x.mark();
      x.send(queueMsg(1, i % 2 ? PRESET_B : PRESET_A, NO_GEAR, { run }));
      if (i < 2) await x.next('expQueueState');
    }
    for (const x of [a, b, c]) await x.next('start');
    a.send({ t: 'cmd', seq: 7, cmd: { type: 'debug', action: { kind: 'chargeUlt' } } });
    await winCombat(a);
    await a.snap(m => m.state.phase === 'reward');
    expect(a.count('expStageResult')).toBe(0); // not before the floor reward
    for (const x of [a, b, c]) pick(x);
    const results: Result[] = [];
    for (const x of [a, b, c]) {
      results.push(await x.next('expStageResult'));
      await x.next('gameEnded'); // after the result: the client knows the outcome when the game ends
    }
    for (const [i, r] of results.entries()) {
      expect(r).toMatchObject({ runId: runs.get([a, b, c][i])!.id, stage: 1, outcome: 'cleared', bossClear: false });
      expect(r.loot).toHaveLength(1);
      expect(r.loot[0].tier).toBe(1);
      expect(r.carry!.rewards).toHaveLength(1);
      expect(r.carry!.ult).toHaveLength(3);
    }
    expect(results[0].carry!.ult.every(u => u > 0.9)).toBe(true);
    // A and B continue with the run their browser keeps; C claims (nothing to tell the server)
    const ra = afterClear(runs.get(a)!, results[0]);
    const rb = afterClear(runs.get(b)!, results[1]);
    for (const x of [a, b]) x.mark();
    a.send(queueMsg(2, PRESET_A, NO_GEAR, { run: ra }));
    const qa = await a.next('expQueueState');
    expect(qa).toMatchObject({ stage: 2, continuing: true, bagCount: 1, you: 0 });
    expect(qa.seats[0]).toMatchObject({ name: 'A', continuing: true, buffs: 1 });
    b.send(queueMsg(2, PRESET_B, NO_GEAR, { run: rb }));
    await b.next('expQueueState');
    await a.next('start');
    await b.next('start');
    const s2 = await a.snap();
    expect(s2.state.expedition).toMatchObject({ stage: 2, outcome: 'running', humans: [true, true, false] });
    expect(s2.state.players[0].rewards).toEqual(results[0].carry!.rewards);
    expect(s2.state.players[1].rewards).toEqual(results[1].carry!.rewards);
    s2.state.players[0].party.forEach((m, i) => expect(m.ult.charge).toBeCloseTo(results[0].carry!.ult[i], 1));
    expect(s2.state.players[2].gear?.[0]?.weapon).toMatchObject({ tier: 1, rarity: 'common' }); // the bot: T1 commons
    // a 2-human stage: B leaves after the clear (during the reward) → still a clear for B; A picks → A's result
    await winCombat(a, 78);
    await b.snap(m => m.state.phase === 'reward');
    b.send({ t: 'leaveRoom' });
    const lb = await b.next('expStageResult');
    expect(lb).toMatchObject({ runId: rb.id, stage: 2, outcome: 'cleared' });
    expect(lb.carry!.rewards).toHaveLength(2); // its reward was picked at random
    pick(a, 9);
    const la = await a.next('expStageResult');
    expect(la).toMatchObject({ runId: ra.id, stage: 2, outcome: 'cleared' });
    expect(afterClear(ra, la).bag).toHaveLength(2);
  });

  it('boss stage: the result comes at the clear (no floor reward) with the boss box; a first clear is a sure relic', async () => {
    await server();
    const a = await connect('A');
    await soloStart(a, freshRun(12), NO_GEAR, { debugUnlock: true });
    const r = await winBoss(a);
    expect(r).toMatchObject({ stage: 12, outcome: 'cleared', bossClear: true });
    expect(r.loot).toHaveLength(2);
    expect(r.loot.filter(g => g.slot === 'relic')).toEqual([expect.objectContaining({ slot: 'relic', tier: 12 })]);
    expect(r.carry!.rewards).toEqual([]);
  });

  it('a result waits for a disconnected player: delivered on the reconnect, and by run id (expStatus) later', async () => {
    await server();
    const [a, b] = [await connect('A'), await connect('B')];
    const runB = freshRun(1);
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B, NO_GEAR, { run: runB }));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    const token = b.token;
    b.kill();
    await sleep(200);
    await winCombat(a);
    pick(a);
    await a.next('expStageResult'); // B's reward was picked by its bot at the drop
    const b2 = await connect('B', token);
    const rb = await b2.next('expStageResult');
    expect(rb).toMatchObject({ runId: runB.id, stage: 1, outcome: 'cleared' });
    expect(b2.count('expStageResult')).toBe(1);
    // any session can ask by run id (a new tab, the hub having forgotten the old session)
    const c = await connect('C');
    c.send({ t: 'expStatus', runId: runB.id });
    expect(await c.next('expStageResult')).toEqual(rb);
    c.send({ t: 'expStatus', runId: 'neverPlayed00000' });
    expect(await c.next('expNoStage')).toEqual({ t: 'expNoStage', runId: 'neverPlayed00000' });
  });

  it('expStatus with a stage: an older stage\'s stored result counts as none (a dropped stage-2 queue is void, never stuck)', async () => {
    await server();
    const a = await connect('A');
    const run = freshRun(1);
    await soloStart(a, run);
    await winCombat(a);
    pick(a);
    const r1 = await a.next('expStageResult');
    expect(r1).toMatchObject({ runId: run.id, stage: 1, outcome: 'cleared' });
    // 「2단계 매칭」, then the page dies while queued: the queue is dropped after lobbyGraceMs
    const next = afterClear(run, r1);
    a.send(queueMsg(2, PRESET_A, NO_GEAR, { run: next }));
    await a.next('expQueueState');
    a.kill();
    await sleep(700);
    const b = await connect('A2');
    b.send({ t: 'expStatus', runId: run.id, stage: 2 });
    expect(await b.next('expNoStage')).toEqual({ t: 'expNoStage', runId: run.id });
    expect(b.count('expStageResult')).toBe(0);
    // without a stage (older clients) the last result still answers
    b.send({ t: 'expStatus', runId: run.id });
    expect(await b.next('expStageResult')).toEqual(r1);
  });

  it('a queue dropped while offline: expCancelled on the reconnect, and expCancel with nothing queued is answered', async () => {
    await server();
    const a = await connect('A');
    a.send(queueMsg(1));
    await a.next('expQueueState');
    const token = a.token;
    a.kill();
    await sleep(700);
    const a2 = await connect('A', token);
    await a2.next('expCancelled');
    a2.mark();
    a2.send({ t: 'expCancel' });
    await a2.next('expCancelled');
    a2.send({ t: 'expStartNow' });
    await sleep(100);
    expect(a2.count('start')).toBe(0);
  });

  it('results are pruned after expResultKeepMs', async () => {
    await server({ expResultKeepMs: 100 });
    const a = await connect('A');
    const run = freshRun(3);
    await soloStart(a, run, NO_GEAR, { debugUnlock: true });
    await winBoss(a);
    await sleep(250);
    a.send({ t: 'expStatus', runId: run.id });
    await a.next('expNoStage');
  });

  it('a server error before the clear voids the stage (the bag is kept); after the clear it is still a clear', async () => {
    await server();
    const a = await connect('A');
    const run: ExpRunInfo = { ...freshRun(1), cleared: 1, bag: [{ slot: 'weapon', tier: 1, rarity: 'common' }] };
    await soloStart(a, run);
    const room = () => [...srv!.hub.rooms.values()].find(r => r.mode && r.game)!;
    room().endGame('error');
    expect(await a.next('expStageResult')).toMatchObject({ runId: run.id, stage: 2, outcome: 'void', reason: 'error', loot: [] });
    await soloStart(a, run); // the same stage again
    await winCombat(a);
    await a.snap(m => m.state.phase === 'reward');
    room().endGame('error');
    const r = await a.next('expStageResult');
    expect(r).toMatchObject({ stage: 2, outcome: 'cleared' });
    expect(r.carry!.rewards).toHaveLength(1);
  });

  it('quitting mid-stage fails that player only; the others play on', async () => {
    await server();
    const [a, b] = [await connect('A'), await connect('B')];
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    a.mark();
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'quit' } });
    expect(await a.next('expStageResult')).toMatchObject({ stage: 1, outcome: 'failed', reason: 'quit' });
    const snap = await b.snap(m => m.state.players[0].isBot);
    expect(snap.state.phase).toBe('combat');
    expect(b.count('expStageResult')).toBe(0);
  });

  it('a lost stage (wipe / time out) fails everyone', async () => {
    await server({ endLingerMs: 200 });
    const [a, b] = [await connect('A'), await connect('B')];
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'tunables', patch: { monsterDmgMult: 10, gameSpeed: 8, botDamageMult: 0, monsterHpMult: 10, reviveTime: 600 } } });
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    const la = await a.next('expStageResult', () => true, 30_000);
    const lb = await b.next('expStageResult', () => true, 5000);
    expect(la).toMatchObject({ stage: 1, outcome: 'failed', loot: [], carry: null });
    expect(['wipe', 'timeout']).toContain(lb.reason);
    await a.next('gameEnded');
    a.mark();
    a.send(queueMsg(1));
    await a.next('expQueueState');
  }, 40_000);
});

describe('matched rooms are safe from the host', () => {
  it('debug / tunables only when the host is the one human (unless the server allows it)', async () => {
    await server({ expSharedDebug: false });
    const [a, b] = [await connect('A'), await connect('B')];
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    a.mark();
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'expeditionClearStage' } } });
    expect((await a.next('cmdResult', m => m.seq === 1)).ok).toBe(false);
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'tunables', patch: { monsterDmgMult: 10 } } });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(false);
    const c = await connect('C');
    await soloStart(c, freshRun(3), NO_GEAR, { debugUnlock: true });
    expect((await winBoss(c, 3)).outcome).toBe('cleared');
  });

  it('nobody connected: bots play the stage on (no abandon), nothing is lost', async () => {
    await server({ abandonMs: 150 });
    const a = await connect('A');
    await soloStart(a, freshRun(1));
    const token = a.token;
    a.kill();
    await sleep(700);
    const a2 = await connect('A', token);
    const snap = await a2.snap();
    expect(['combat', 'reward']).toContain(snap.state.phase);
    expect(snap.state.expedition?.outcome).not.toBe('failed');
    expect(a2.count('expStageResult')).toBe(0);
  });
});

describe('classic rooms', () => {
  it('a classic room still works next to the expedition queues', async () => {
    await server();
    const [a, b] = [await connect('A'), await connect('B')];
    b.send(queueMsg(1));
    await b.next('expQueueState');
    a.mark();
    a.send({ t: 'createRoom', preset: PRESET_A });
    const { room } = await a.next('room', m => !!m.room);
    // joining the classic room drops B out of its expedition queue (nothing claimed)
    b.mark();
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await b.next('expCancelled');
    await b.next('room', m => m.room?.code === room!.code);
    a.send({ t: 'start' });
    const st = await a.next('start');
    expect(st.mode).toBeUndefined();
    const snap = await a.snap();
    expect(snap.state.expedition).toBeUndefined();
    expect(snap).not.toHaveProperty('choiceDeadline');
    expect(snap.state.players.map(p => p.isBot)).toEqual([false, false, true]);
    expect(snap.state.players[0].gear).toBeUndefined();
  });
});
