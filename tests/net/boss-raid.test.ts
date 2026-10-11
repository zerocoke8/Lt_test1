// 기획 19차 보스 레이드 on the server (protocol 6): createRoom.mode → room info / room list tag → start.mode → the first
// snapshot is a raid (state.mode, a boss plan on floor 1). A raid room is a classic room otherwise: listed, joinable by
// code whatever the mode, the host hands over, a reconnect comes back into it, and after the run it waits again.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../../server/server';
import { parseClientMsg } from '../../server/validate';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { bossRaidOrder } from '../../src/sim';
import { PRESET_A, PRESET_B, startTestServer, TestClient } from './helpers';

let srv: RunningServer;
const clients: TestClient[] = [];

async function connect(name: string, token?: string): Promise<TestClient> {
  const c = await TestClient.connect(srv.port, name, token);
  clients.push(c);
  return c;
}

beforeEach(async () => {
  srv = await startTestServer();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.kill();
  await srv.close();
});

describe('protocol 6', () => {
  it('is version 7 today (the raid messages came with 6); createRoom takes mode bossRaid and refuses any other mode', () => {
    expect(PROTOCOL_VERSION).toBe(7); // 기획 20차: 7 (보스 형태)
    const raw = (o: object) => parseClientMsg(JSON.stringify(o));
    expect(raw({ t: 'createRoom', preset: PRESET_A, mode: 'bossRaid' })).toEqual({ t: 'createRoom', preset: PRESET_A, mode: 'bossRaid' });
    expect(raw({ t: 'createRoom', preset: PRESET_A, roomName: '레이드', mode: 'bossRaid' })).toEqual({ t: 'createRoom', preset: PRESET_A, roomName: '레이드', mode: 'bossRaid' });
    expect(raw({ t: 'createRoom', preset: PRESET_A })).toEqual({ t: 'createRoom', preset: PRESET_A });
    for (const mode of ['expedition', 'classic', '', 7, null, {}]) expect(raw({ t: 'createRoom', preset: PRESET_A, mode }), String(mode)).toBeNull();
  });

  it('debug raidBoss (「보스 고르기」) is parsed only with a known boss id; extra fields are dropped', () => {
    const cmd = (action: object) => parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { type: 'debug', action } }));
    expect(cmd({ kind: 'raidBoss', boss: 'shredder_maw', player: 2, floor: 9 })).toEqual({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'raidBoss', boss: 'shredder_maw' } } });
    expect(cmd({ kind: 'raidBoss', boss: 'abyss_watcher' })).not.toBeNull();
    for (const boss of ['no_such_boss', 'ogre', '', 7, null, undefined, ['shredder_maw'], 'x'.repeat(41)]) expect(cmd({ kind: 'raidBoss', boss }), String(boss)).toBeNull();
  });

  it('the four boss knobs travel in a tunables patch (the sim clamps them)', () => {
    const patch = { bossTelegraphMult: 2, bossAreaMult: 0.5, bossRaidHpMult: 0.6, bossRaidAtkMult: 1.5 };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch } }))).toEqual({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch } });
  });
});

describe('a boss raid room', () => {
  it('create with the mode → tagged in the room, the list and the start; the first snapshot is floor 1 of a raid', async () => {
    const a = await connect('방장');
    const b = await connect('손님');
    a.send({ t: 'createRoom', preset: PRESET_A, mode: 'bossRaid' });
    const { room } = await a.next('room', m => !!m.room);
    expect(room!.mode).toBe('bossRaid');
    expect(room!.status).toBe('waiting');

    // listed like any room, with its tag
    b.send({ t: 'listRooms' });
    const list = await b.next('rooms', m => m.rooms.length > 0);
    expect(list.rooms).toHaveLength(1);
    expect(list.rooms[0]).toMatchObject({ code: room!.code, mode: 'bossRaid', players: 1 });

    // a second client joins by code (it never says which mode it expects)
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    const joined = await b.next('room', m => !!m.room && m.room.members.length === 2);
    expect(joined.room!.mode).toBe('bossRaid');

    for (const c of [a, b]) c.mark();
    a.send({ t: 'start' });
    const sa = await a.next('start');
    const sb = await b.next('start');
    expect(sa.mode).toBe('bossRaid');
    expect(sb.mode).toBe('bossRaid');
    expect(sb.playerIndex).toBe(1);

    const snap = await b.snap();
    const s = snap.state;
    expect(s.mode).toBe('bossRaid');
    expect(s.floor).toBe(1);
    expect(s.plan.kind).toBe('boss');
    expect(s.plan.theme).toBe('lobby');
    const order = bossRaidOrder(sa.seed);
    expect(s.seed).toBe(sa.seed);
    expect(s.plan.bossId).toBe(order[0]);
    expect(s.plan.nextBossId).toBe(order[1]);
    expect(s.players).toHaveLength(3); // two humans + one bot
    expect(s.players.map(p => p.isBot)).toEqual([false, false, true]);
    const boss = s.entities.find(e => e.id === s.bossId);
    expect(boss?.defId).toBe(order[0]);
    expect(s.bossGroggy).not.toBeNull();
  });

  it('「다음 보스로」 by the host → reward → floor 2 is the next boss of the order; a classic room next to it stays classic', async () => {
    const a = await connect('방장');
    const c = await connect('클래식');
    a.send({ t: 'createRoom', preset: PRESET_A, mode: 'bossRaid' });
    await a.next('room', m => !!m.room);
    c.send({ t: 'createRoom', preset: PRESET_B });
    const classic = await c.next('room', m => !!m.room);
    expect(classic.room!.mode).toBeUndefined();
    c.send({ t: 'listRooms' });
    const list = await c.next('rooms', m => m.rooms.length === 2);
    expect(list.rooms.map(r => r.mode ?? 'classic').sort()).toEqual(['bossRaid', 'classic']);

    a.mark();
    a.send({ t: 'start' });
    const start = await a.next('start');
    const order = bossRaidOrder(start.seed);
    await a.snap(m => m.state.phase === 'combat');
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    expect((await a.next('cmdResult', m => m.seq === 1)).ok).toBe(true);
    const reward = await a.snap(m => m.state.phase === 'reward');
    expect(reward.state.rewardOffersByPlayer[0]!.some(o => o.isRelic)).toBe(false); // floor 1: a normal floor reward
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } });
    const f2 = await a.snap(m => m.state.floor === 2 && m.state.phase === 'combat');
    expect(f2.state.plan.kind).toBe('boss');
    expect(f2.state.plan.bossId).toBe(order[1]);
    expect(f2.state.mode).toBe('bossRaid');

    c.mark();
    c.send({ t: 'start' });
    const cs = await c.next('start');
    expect(cs.mode).toBeUndefined();
    const snap = await c.snap();
    expect(snap.state.mode).toBeUndefined();
    expect(snap.state.plan.kind).toBe('normal');
  });

  it('「보스 고르기」: the host restarts the floor with the picked boss for everyone; a guest may not; a classic room refuses it', async () => {
    const a = await connect('방장');
    const b = await connect('손님');
    a.send({ t: 'createRoom', preset: PRESET_A, mode: 'bossRaid' });
    const { room } = await a.next('room', m => !!m.room);
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await b.next('room', m => !!m.room && m.room.members.length === 2);
    for (const c of [a, b]) c.mark();
    a.send({ t: 'start' });
    const start = await a.next('start');
    await b.next('start');
    const order = bossRaidOrder(start.seed);
    const pick = order[0] === 'shredder_maw' ? 'coffee_machine' : 'shredder_maw';
    await b.snap(m => m.state.phase === 'combat');

    // a guest: refused, the boss stays
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'raidBoss', boss: pick } } });
    const refused = await b.next('cmdResult', m => m.seq === 1);
    expect(refused).toMatchObject({ ok: false, reason: '방장만 할 수 있어요' });
    b.send({ t: 'cmd', seq: 2, cmd: { type: 'tunables', patch: { bossTelegraphMult: 2 } } });
    expect((await b.next('cmdResult', m => m.seq === 2)).ok).toBe(false);
    expect((await b.snap()).state.plan.bossId).toBe(order[0]);

    // the host: floor 1 again with the picked boss, on both screens; floor 2 is still the order's
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'debug', action: { kind: 'raidBoss', boss: pick } } });
    expect((await a.next('cmdResult', m => m.seq === 3)).ok).toBe(true);
    for (const c of [a, b]) {
      const snap = await c.snap(m => m.state.plan.bossId === pick);
      expect(snap.state).toMatchObject({ floor: 1, phase: 'combat', mode: 'bossRaid' });
      expect(snap.state.plan.nextBossId).toBe(order[1]);
      expect(snap.state.entities.find(e => e.id === snap.state.bossId)?.defId).toBe(pick);
    }
    // the host's sliders reach the game (next cast / next floor)
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'tunables', patch: { bossTelegraphMult: 2, bossAreaMult: 0.5, bossRaidHpMult: 0.6, bossRaidAtkMult: 1.5 } } });
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    a.send({ t: 'cmd', seq: 5, cmd: { type: 'debug', action: { kind: 'raidBoss', boss: pick } } });
    expect((await a.next('cmdResult', m => m.seq === 5)).ok).toBe(true);
    const tuned = await b.snap(m => m.state.plan.bossHpMult === 0.6);
    expect(tuned.state.plan).toMatchObject({ bossId: pick, bossHpMult: 0.6, bossAtkMult: 1.5 });

    // the run's telemetry names the boss really fought
    a.send({ t: 'cmd', seq: 6, cmd: { type: 'debug', action: { kind: 'wipeParty' } } });
    const over = await b.snap(m => m.state.phase === 'runOver');
    expect(over.telemetry!.floorTimes).toEqual([{ floor: 1, seconds: expect.any(Number), outcome: 'fail', boss: pick }]);

    // a classic room: the sim refuses it
    const c = await connect('클래식');
    c.send({ t: 'createRoom', preset: PRESET_B });
    await c.next('room', m => !!m.room);
    c.mark();
    c.send({ t: 'start' });
    await c.next('start');
    await c.snap(m => m.state.phase === 'combat');
    c.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'raidBoss', boss: pick } } });
    expect(await c.next('cmdResult', m => m.seq === 1)).toMatchObject({ ok: false, reason: '보스 레이드 전용' });
  });

  it('keeps the classic room life cycle: a reconnect comes back into the raid, the host hands over, the room waits again after the run', async () => {
    const a = await connect('방장');
    const b = await connect('손님');
    a.send({ t: 'createRoom', preset: PRESET_A, mode: 'bossRaid' });
    const { room } = await a.next('room', m => !!m.room);
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await b.next('room', m => !!m.room);
    for (const c of [a, b]) c.mark();
    a.send({ t: 'start' });
    await a.next('start');
    await b.next('start');
    await b.snap();

    // b drops and comes back with its token: start (with the mode) + a snapshot again
    const token = b.token;
    b.kill();
    const b2 = await connect('손님', token);
    const again = await b2.next('start');
    expect(again.mode).toBe('bossRaid');
    expect((await b2.snap()).state.mode).toBe('bossRaid');

    // the host leaves mid-run: b is the host now and may use the debug skip
    a.send({ t: 'leaveRoom' });
    await b2.next('room', m => !!m.room && m.room.members.length === 1 && m.room.members[0].isHost);
    b2.send({ t: 'cmd', seq: 5, cmd: { type: 'debug', action: { kind: 'wipeParty' } } });
    expect((await b2.next('cmdResult', m => m.seq === 5)).ok).toBe(true);
    const over = await b2.snap(m => m.state.phase === 'runOver');
    expect(over.state.runResult).toMatchObject({ outcome: 'defeat', floorReached: 1 });
    expect(over.telemetry).toBeDefined();
    await b2.next('gameEnded');
    const back = await b2.next('room', m => !!m.room && m.room.status === 'waiting');
    expect(back.room!.mode).toBe('bossRaid'); // still a raid room: 「시작」 starts another raid
  });
});
