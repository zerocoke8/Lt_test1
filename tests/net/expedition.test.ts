// 기획 15차 원정 on the server (server/expedition.ts): per-stage queues (3 joins start at once, a lone joiner gets bots
// after the queue time, 「바로 출발」), gear / start-stage validation, the stage-clear choice (extract → items, continue →
// re-matched at stage + 1 with the carry), the choice timeout, a disconnect at the choice (claimed, delivered after the
// reconnect), a lost stage (bag gone), a quit mid-stage, and classic rooms untouched.
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer, ServerOptions } from '../../server/server';
import type { ClientMsg, PresetChoice, ServerMsg } from '../../src/net/protocol';
import { parseClientMsg } from '../../server/validate';
import type { GearLoadout } from '../../src/data/gear';
import { PRESET_A, PRESET_B, sleep, startTestServer, TestClient } from './helpers';

let srv: RunningServer | null = null;
const clients: TestClient[] = [];

async function server(opts: Partial<ServerOptions> = {}): Promise<RunningServer> {
  srv = await startTestServer({ expQueueSec: 30, expChoiceSec: 30, expLaunchMs: 0, expSharedDebug: true, ...opts });
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

function queueMsg(stage: number, preset: PresetChoice = PRESET_A, gear: GearLoadout[] = NO_GEAR, extra: Record<string, unknown> = {}): ClientMsg {
  return { t: 'expQueue', stage, characters: preset.characters, pets: preset.pets, gear, firstBossClears: [], ...extra } as ClientMsg;
}

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

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

/** The host clears the stage at once; every client gets its expStageClear. */
async function clearStage(host: TestClient, ...cs: TestClient[]): Promise<Msg<'expStageClear'>[]> {
  for (const c of [host, ...cs]) c.mark();
  host.send({ t: 'cmd', seq: 77, cmd: { type: 'debug', action: { kind: 'expeditionClearStage' } } });
  // the clear (and its expStageClear) happens while the command runs, before the cmdResult
  const out: Msg<'expStageClear'>[] = [];
  for (const c of [host, ...cs]) out.push(await c.next('expStageClear'));
  expect((await host.next('cmdResult', m => m.seq === 77)).ok).toBe(true);
  return out;
}

describe('expQueue parsing', () => {
  it('accepts a well-formed join and rebuilds it; junk is dropped', () => {
    const m = parseClientMsg(JSON.stringify({ ...queueMsg(2, PRESET_A, [tierSet(1), tierSet(1), tierSet(1)], { firstBossClears: [3, 3] }), x: 1 }));
    expect(m).toMatchObject({ t: 'expQueue', stage: 2, characters: PRESET_A.characters, pets: PRESET_A.pets, firstBossClears: [3] });
    expect(m).not.toHaveProperty('x');
    expect(parseClientMsg(JSON.stringify(queueMsg(0)))).toBeNull();
    expect(parseClientMsg(JSON.stringify(queueMsg(13)))).toBeNull();
    expect(parseClientMsg(JSON.stringify(queueMsg(1, { characters: ['blade', 'blade', 'mage'], pets: PRESET_A.pets })))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ ...queueMsg(1), firstBossClears: [99] }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'expChoice', choice: 'continue' }))).toEqual({ t: 'expChoice', choice: 'continue' });
    expect(parseClientMsg(JSON.stringify({ t: 'expChoice', choice: 'both' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { type: 'expeditionChoice', choice: 'extract', player: 2 } }))).toEqual({
      t: 'cmd',
      seq: 1,
      cmd: { type: 'expeditionChoice', player: 0, choice: 'extract' },
    });
  });
});

describe('expedition queues', () => {
  it('rejects impossible gear and a start stage above what the gear allows', async () => {
    await server({ expDebugUnlock: false });
    const a = await connect('A');
    a.mark();
    a.send(queueMsg(1, PRESET_A, [{ weapon: { slot: 'weapon', tier: 13, rarity: 'common' } }, {}, {}] as GearLoadout[]));
    expect((await a.next('error')).code).toBe('bad_gear');
    a.send(queueMsg(1, PRESET_A, [{ weapon: { slot: 'armor', tier: 2, rarity: 'common' } }, {}, {}] as GearLoadout[]));
    expect((await a.next('error')).code).toBe('bad_gear');
    a.send(queueMsg(1, PRESET_A, [{ relic: { slot: 'relic', tier: 4, rarity: 'epic', relicId: 'echo_seal' } }, {}, {}] as GearLoadout[]));
    expect((await a.next('error')).code).toBe('bad_gear');
    a.send(queueMsg(1, PRESET_A, [{}, {}] as GearLoadout[]));
    expect((await a.next('error')).code).toBe('bad_gear');
    // combinations that can never drop: an option below T4, an optionless rare, a common with an option, a relic's wrong stars
    for (const bad of [
      { weapon: { slot: 'weapon', tier: 1, rarity: 'epic', optionId: 'w_execute' } },
      { weapon: { slot: 'weapon', tier: 6, rarity: 'rare' } },
      { weapon: { slot: 'weapon', tier: 6, rarity: 'common', optionId: 'w_execute' } },
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
    expect(q.seats).toHaveLength(1);
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
    // one run per player
    d.send(queueMsg(1));
    expect((await d.next('error')).code).toBe('bad_request');
    const starts = await queueAll(1, a, b, c);
    expect(starts.map(s => s.playerIndex)).toEqual([0, 1, 2]);
    expect(starts.every(s => s.mode === 'expedition')).toBe(true);
    const snap = await a.snap();
    expect(snap.state.expedition).toMatchObject({ stage: 1, stageFloor: 1, outcome: 'running', humans: [true, true, true] });
    expect(snap.state.players.map(p => p.name)).toEqual(['A', 'B', 'C']);
    expect(snap.state.players.every(p => !p.isBot)).toBe(true);
    // D (queued at stage 2) is not in this game
    expect(d.count('start')).toBe(0);
    // hidden from the classic room list, not joinable by code
    d.send({ t: 'listRooms' });
    expect((await d.next('rooms')).rooms).toHaveLength(0);
  });

  it('a lone joiner gets 2 bots after the queue time', async () => {
    await server({ expQueueSec: 0.4 });
    const a = await connect('A');
    a.mark();
    a.send(queueMsg(1));
    const first = await a.next('expQueueState');
    expect(first.secondsLeft).toBe(1);
    const launching = await a.next('expQueueState', m => m.launching);
    expect(launching.seats.map(s => s.isBot)).toEqual([false, true, true]);
    await a.next('start');
    const snap = await a.snap();
    expect(snap.state.players.map(p => p.isBot)).toEqual([false, true, true]);
    expect(snap.state.expedition?.humans).toEqual([true, false, false]);
  });

  it('「바로 출발」 starts at once with bots', async () => {
    await server();
    const c = await connect('C');
    c.mark();
    c.send(queueMsg(1));
    await c.next('expQueueState');
    c.send({ t: 'expStartNow' });
    expect((await c.next('start')).mode).toBe('expedition');
  });

  it('cancel in the queue of a fresh run just ends it', async () => {
    await server();
    const a = await connect('A');
    a.mark();
    a.send(queueMsg(1));
    await a.next('expQueueState');
    a.send({ t: 'expCancel' });
    await a.next('expCancelled');
    // a new run can start right away
    a.send(queueMsg(1));
    await a.next('expQueueState');
  });
});

describe('stage clear and the choice', () => {
  it('two continue and are re-matched at stage 2 with the carry; the third extracts its loot', async () => {
    await server({ expQueueSec: 1 });
    const [a, b, c] = [await connect('A'), await connect('B'), await connect('C')];
    await queueAll(1, a, b, c);
    // floor 1 → everyone picks a reward (carried), then straight to the clear
    a.send({ t: 'cmd', seq: 5, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    await a.snap(m => m.state.phase === 'reward');
    for (const x of [a, b, c]) x.send({ t: 'cmd', seq: 6, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } });
    await a.snap(m => m.state.phase !== 'reward');
    a.send({ t: 'cmd', seq: 7, cmd: { type: 'debug', action: { kind: 'chargeUlt' } } });
    const clears = await clearStage(a, b, c);
    for (const cl of clears) {
      expect(cl).toMatchObject({ stage: 1, nextStage: 2, choiceSeconds: 30 });
      expect(cl.loot).toHaveLength(2);
      expect(cl.bag).toEqual(cl.loot);
    }
    const clearSnap = await a.snap(m => m.state.phase === 'stageClear');
    expect(clearSnap.choiceDeadline).toBeGreaterThan(Date.now());
    expect(clearSnap.telemetry).toBeTruthy();
    const ultAtClear = clearSnap.state.players[0].party.map(m => m.ult.charge);
    expect(clearSnap.state.players[0].rewards).toHaveLength(1);

    for (const x of [a, b, c]) x.mark();
    c.send({ t: 'expChoice', choice: 'extract' });
    await c.next('gameEnded');
    const ext = await c.next('expExtracted');
    expect(ext).toMatchObject({ stage: 1, reason: 'choice' });
    expect(ext.items).toEqual(clears[2].loot);
    // the other two still see C's choice in the snapshot
    await a.snap(m => m.state.expedition?.choices[2] === 'extract');

    a.send({ t: 'cmd', seq: 8, cmd: { type: 'expeditionChoice', player: 0, choice: 'continue' } });
    await a.next('gameEnded');
    const qa = await a.next('expQueueState');
    expect(qa).toMatchObject({ stage: 2, continuing: true, bagCount: 2, you: 0 });
    expect(qa.seats[0]).toMatchObject({ name: 'A', continuing: true, buffs: 1 });
    b.send({ t: 'expChoice', choice: 'continue' });
    await b.next('gameEnded');
    const qb = await b.next('expQueueState');
    expect(qb.seats.map(s => s.name)).toEqual(['A', 'B']);

    // queue time → 1 bot; both humans in one stage-2 game, A (first back) at seat 0
    const sa = await a.next('start');
    const sb = await b.next('start');
    expect([sa.playerIndex, sb.playerIndex]).toEqual([0, 1]);
    const s2 = await a.snap();
    expect(s2.state.expedition).toMatchObject({ stage: 2, outcome: 'running', humans: [true, true, false] });
    expect(s2.state.players.map(p => p.isBot)).toEqual([false, false, true]);
    expect(s2.state.players[0].rewards).toEqual(clearSnap.state.players[0].rewards);
    expect(s2.state.players[1].rewards).toEqual(clearSnap.state.players[1].rewards);
    s2.state.players[0].party.forEach((m, i) => expect(m.ult.charge).toBeCloseTo(ultAtClear[i], 1));
    // the bot plays T1 commons on stage 2
    expect(s2.state.players[2].gear?.[0]?.weapon).toMatchObject({ tier: 1, rarity: 'common' });

    // stage 2 cleared: the bag holds both stages
    const clears2 = await clearStage(a, b);
    expect(clears2[0].bag).toHaveLength(4);
    expect(clears2[0].bag.slice(0, 2)).toEqual(clears[0].loot);
    for (const x of [a, b]) x.send({ t: 'expChoice', choice: 'extract' });
    const ea = await a.next('expExtracted');
    expect(ea.items).toHaveLength(4);
    expect(ea.stage).toBe(2);
    expect((await b.next('expExtracted')).items).toEqual(clears2[1].bag);
  });

  it('boss stage: a first clear gets a sure relic; after stage 12 「도전」 claims the bag (원정 완주)', async () => {
    await server();
    const a = await connect('A');
    a.send(queueMsg(12, PRESET_A, NO_GEAR, { debugUnlock: true }));
    a.send({ t: 'expStartNow' });
    expect((await a.next('start')).mode).toBe('expedition');
    const [cl] = await clearStage(a);
    expect(cl).toMatchObject({ stage: 12, nextStage: null });
    expect(cl.loot).toHaveLength(3);
    expect(cl.loot.filter(g => g.slot === 'relic')).toEqual([expect.objectContaining({ slot: 'relic', tier: 12 })]);
    a.send({ t: 'expChoice', choice: 'continue' });
    const ext = await a.next('expExtracted');
    expect(ext).toMatchObject({ stage: 12, reason: 'complete', bossClears: [12] });
    expect(ext.items).toEqual(cl.loot);
  });

  it('no choice in time → extract (timeout)', async () => {
    await server({ expChoiceSec: 0.4 });
    const a = await connect('A');
    a.send(queueMsg(1));
    a.send({ t: 'expStartNow' });
    await a.next('start');
    const [cl] = await clearStage(a);
    const ext = await a.next('expExtracted');
    expect(ext).toMatchObject({ reason: 'timeout', stage: 1 });
    expect(ext.items).toEqual(cl.loot);
  });

  it('a disconnect at the choice claims the bag; delivered after the reconnect', async () => {
    await server();
    const [a, b] = [await connect('A'), await connect('B')];
    // A first: A's seat 0 is the room host (debug commands)
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    const [, clB] = await clearStage(a, b);
    const token = b.token;
    b.kill();
    await sleep(300);
    // the room goes on for A
    a.send({ t: 'expChoice', choice: 'continue' });
    await a.next('expQueueState');
    const b2 = await connect('B', token);
    const ext = await b2.next('expExtracted');
    expect(ext).toMatchObject({ reason: 'disconnect', stage: 1, bossClears: [] });
    expect(ext.items).toEqual(clB.loot);
    expect(b2.count('expExtracted')).toBe(1);
  });

  it('cancel while queued for the next stage claims the bag', async () => {
    await server();
    const a = await connect('A');
    a.send(queueMsg(1));
    a.send({ t: 'expStartNow' });
    await a.next('start');
    const [cl] = await clearStage(a);
    a.send({ t: 'expChoice', choice: 'continue' });
    expect((await a.next('expQueueState')).bagCount).toBe(2);
    a.send({ t: 'expCancel' });
    const ext = await a.next('expExtracted');
    expect(ext).toMatchObject({ reason: 'cancel', stage: 2 });
    expect(ext.items).toEqual(cl.loot);
  });

  it('quitting mid-stage loses the bag of that player only', async () => {
    await server();
    const [a, b] = [await connect('A'), await connect('B')];
    // A first: A's seat 0 is the room host (debug commands)
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    await clearStage(a, b);
    // A back in the queue first: seat 0 = the stage-2 room host (tunables)
    a.send({ t: 'expChoice', choice: 'continue' });
    await a.next('expQueueState', m => m.stage === 2);
    b.send({ t: 'expChoice', choice: 'continue' });
    await a.next('expQueueState', m => m.stage === 2 && m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    // the host (A) quits: only A's run fails, B plays on (the seat turns bot)
    a.mark();
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'quit' } });
    expect((await a.next('expBagLost')).count).toBe(2);
    const snap = await b.snap(m => m.state.players[0].isBot);
    expect(snap.state.phase).toBe('combat');
    expect(b.count('expBagLost')).toBe(0);
  });

  it('a lost stage (wipe / time out) loses the bag for everyone', async () => {
    await server({ endLingerMs: 200 });
    const [a, b] = [await connect('A'), await connect('B')];
    // A first: A's seat 0 is the room host (debug commands)
    a.send(queueMsg(1));
    await a.next('expQueueState');
    b.send(queueMsg(1, PRESET_B));
    await a.next('expQueueState', m => m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    await clearStage(a, b);
    // A back in the queue first: seat 0 = the stage-2 room host (tunables)
    a.send({ t: 'expChoice', choice: 'continue' });
    await a.next('expQueueState', m => m.stage === 2);
    b.send({ t: 'expChoice', choice: 'continue' });
    await a.next('expQueueState', m => m.stage === 2 && m.seats.length === 2);
    a.send({ t: 'expStartNow' });
    await a.next('start');
    await b.next('start');
    // nobody swaps, monsters hit hard and do not die: a wipe or the 120 s limit (15 s at ×8)
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'tunables', patch: { monsterDmgMult: 10, gameSpeed: 8, botDamageMult: 0, monsterHpMult: 10, reviveTime: 600 } } });
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    const la = await a.next('expBagLost', () => true, 30_000);
    const lb = await b.next('expBagLost', () => true, 5000);
    expect(la).toMatchObject({ stage: 2, count: 2 });
    expect(['wipe', 'timeout']).toContain(lb.reason);
    await a.next('gameEnded');
    // the run is over: a new one can start
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
    expect(a.count('expStageClear')).toBe(0);
    // a lone human (bots in the other seats) may still use them
    const c = await connect('C');
    c.send(queueMsg(1));
    c.send({ t: 'expStartNow' });
    await c.next('start');
    c.mark();
    c.send({ t: 'cmd', seq: 3, cmd: { type: 'debug', action: { kind: 'expeditionClearStage' } } });
    await c.next('expStageClear');
    expect((await c.next('cmdResult', m => m.seq === 3)).ok).toBe(true);
  });

  it('nobody connected: bots play the stage on (no abandon), the bag is not lost', async () => {
    await server({ abandonMs: 150 });
    const a = await connect('A');
    a.send(queueMsg(1));
    a.send({ t: 'expStartNow' });
    await a.next('start');
    const token = a.token;
    a.kill();
    await sleep(700);
    const a2 = await connect('A', token);
    const snap = await a2.snap();
    expect(snap.state.phase).toBe('combat');
    expect(snap.state.expedition?.outcome).toBe('running');
    expect(a2.count('expBagLost')).toBe(0);
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
    // joining the classic room drops B out of its expedition queue (nothing to claim)
    b.mark();
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await b.next('expCancelled');
    await b.next('room', m => m.room?.code === room!.code);
    a.send({ t: 'start' });
    const st = await a.next('start');
    expect(st.mode).toBeUndefined();
    const snap = await a.snap();
    expect(snap.state.expedition).toBeUndefined();
    expect(snap.choiceDeadline).toBeUndefined();
    expect(snap.state.players.map(p => p.isBot)).toEqual([false, false, true]);
    expect(snap.state.players[0].gear).toBeUndefined();
  });
});
