// 기획 17차 (protocol 5): chooseReward.member and rerollReward on the wire, the new debug actions, the 원정 carry fields,
// and the reward timeout picking the bot's card (botPickIndex) with its default member.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../../server/server';
import { parseCommand, parseExpRun } from '../../server/validate';
import { PROTOCOL_VERSION, REWARD_TIMEOUT_SEC } from '../../src/net/protocol';
import { botPickIndex } from '../../src/sim';
import { PRESET_A, PRESET_B, startTestServer, TestClient } from './helpers';

describe('protocol 5: parsing', () => {
  it('version 5, reward timeout 30 s', () => {
    expect(PROTOCOL_VERSION).toBe(5);
    expect(REWARD_TIMEOUT_SEC).toBe(30);
  });

  it('chooseReward takes an optional member 0..2; rerollReward has no fields', () => {
    expect(parseCommand({ type: 'chooseReward', offerIndex: 1 })).toEqual({ type: 'chooseReward', player: 0, offerIndex: 1 });
    expect(parseCommand({ type: 'chooseReward', offerIndex: 1, member: 2, x: 1 })).toEqual({ type: 'chooseReward', player: 0, offerIndex: 1, member: 2 });
    for (const member of [3, -1, 1.5, '1', null]) expect(parseCommand({ type: 'chooseReward', offerIndex: 1, member })).toBeNull();
    expect(parseCommand({ type: 'rerollReward', player: 2, hack: 1 })).toEqual({ type: 'rerollReward', player: 0 });
  });

  it('debug: justDrill, offerFixture, grantReward (known ids, member 0..2)', () => {
    expect(parseCommand({ type: 'debug', action: { kind: 'justDrill', player: 2 } })).toEqual({ type: 'debug', action: { kind: 'justDrill' } });
    expect(parseCommand({ type: 'debug', action: { kind: 'offerFixture' } })).toEqual({ type: 'debug', action: { kind: 'offerFixture' } });
    expect(parseCommand({ type: 'debug', action: { kind: 'grantReward', rewardId: 'atk_rare' } })).toEqual({ type: 'debug', action: { kind: 'grantReward', rewardId: 'atk_rare' } });
    expect(parseCommand({ type: 'debug', action: { kind: 'grantReward', rewardId: 'dragdmg_epic', member: 1 } })).toEqual({
      type: 'debug',
      action: { kind: 'grantReward', rewardId: 'dragdmg_epic', member: 1 },
    });
    expect(parseCommand({ type: 'debug', action: { kind: 'grantReward', rewardId: 'nope' } })).toBeNull();
    expect(parseCommand({ type: 'debug', action: { kind: 'grantReward', rewardId: 'atk_rare', member: 4 } })).toBeNull();
  });

  it('a run carry keeps rerolls / rewardState / dragCharges (shape only; values are runCheck’s)', () => {
    const run = {
      id: 'abcdefgh1234',
      startStage: 1,
      cleared: 1,
      bag: [],
      bossClears: [],
      carry: { rewards: [], goedamTraces: [], ult: [0, 0, 0], rerolls: 2, rewardState: { nails: 4 }, dragCharges: [null, 2, null], junk: 1 },
    };
    expect(parseExpRun(run)?.carry).toEqual({ rewards: [], goedamTraces: [], ult: [0, 0, 0], goedamSeen: [], rerolls: 2, rewardState: { nails: 4 }, dragCharges: [null, 2, null] });
    expect(parseExpRun({ ...run, carry: { ...run.carry, rewardState: [1] } })).toBeUndefined();
    expect(parseExpRun({ ...run, carry: { ...run.carry, dragCharges: [0, 0, 0, 0] } })).toBeUndefined();
  });
});

describe('protocol 5: the server', () => {
  let srv: RunningServer;
  const clients: TestClient[] = [];
  beforeEach(async () => {
    srv = await startTestServer({ rewardTimeoutSec: 0.8 });
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await srv.close();
  });
  const connect = async (name: string) => {
    const c = await TestClient.connect(srv.port, name);
    clients.push(c);
    return c;
  };

  it('a reroll is the sender’s own; the timeout picks the bot’s card for whoever did not choose', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    a.mark();
    a.send({ t: 'createRoom', preset: PRESET_A });
    const code = (await a.next('room', m => !!m.room)).room!.code;
    b.mark();
    b.send({ t: 'joinRoom', code, preset: PRESET_B });
    await b.next('room', m => !!m.room && m.room.code === code);
    a.mark();
    b.mark();
    a.send({ t: 'start' });
    await a.next('start');
    await b.next('start');
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    const rw = await a.snap(m => m.state.phase === 'reward');
    const mineBefore = rw.state.rewardOffersByPlayer[0]!.map(o => o.family);
    const theirs = rw.state.rewardOffersByPlayer[1];
    expect(rw.state.players[0].rerolls).toBe(1);
    // B's player field is ignored: the reroll is A's
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'rerollReward', player: 1 } });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(true);
    const after = await a.snap(m => m.state.players[0].rerolls === 0);
    expect(after.state.rewardOffersByPlayer[0]!.some(o => mineBefore.includes(o.family))).toBe(false);
    expect(after.state.rewardOffersByPlayer[1]).toEqual(theirs);
    // nobody picks: the timeout takes each one's bot card (default member)
    const want = [0, 1].map(i => {
      const offers = after.state.rewardOffersByPlayer[i]!;
      const o = offers[botPickIndex(after.state.players[i], offers)];
      return { rewardId: o.rewardId, partyIndex: o.member ?? o.partyIndex };
    });
    const done = await a.snap(m => m.state.phase === 'combat' && m.state.floor === 2, 5000);
    expect(done.state.players[0].rewards.at(-1)).toEqual(want[0]);
    expect(done.state.players[1].rewards.at(-1)).toEqual(want[1]);
  });

  it('a reroll in the last seconds before the auto-pick is refused by the server, not only greyed out', async () => {
    await srv.close();
    srv = await startTestServer({ rewardTimeoutSec: 2, rerollMinLeftSec: 3 }); // always inside the last 3 s
    const a = await connect('A');
    a.mark();
    a.send({ t: 'createRoom', preset: PRESET_A });
    await a.next('room', m => !!m.room);
    a.mark();
    a.send({ t: 'start' });
    await a.next('start');
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    const rw = await a.snap(m => m.state.phase === 'reward');
    expect(rw.state.players[0].rerolls).toBe(1);
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'rerollReward', player: 0 } });
    const res = await a.next('cmdResult', m => m.seq === 2);
    expect(res.ok).toBe(false);
    const later = await a.snap(m => m.state.phase === 'reward');
    expect(later.state.players[0].rerolls).toBe(1);
  });
});
