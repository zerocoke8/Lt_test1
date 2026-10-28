// 기획 22차 궁극기 테스트 on the server (protocol 8): createRoom.mode 'ultTest' → a raid room whose members bring their
// ult mode with the preset; the ult command carries { mode, point } (parsed strictly: a bad point drops the message);
// the server checks the mode, the sim clamps the point; every client sees the same cast (the same skillCast centres in
// its events); the host's debug 「궁극기 방식」 switches everyone; a stale aimed ult is refused like a stale drop.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../../server/server';
import { parseClientMsg, parseCommand } from '../../server/validate';
import type { GameEvent } from '../../src/types';
import { PRESET_A, PRESET_B, startTestServer, TestClient } from './helpers';

let srv: RunningServer;
const clients: TestClient[] = [];

async function connect(name: string): Promise<TestClient> {
  const c = await TestClient.connect(srv.port, name);
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

describe('parsing (protocol 8)', () => {
  it('the ult command: no aim = a tap; aim = mode aim | drag + a finite point; anything else drops the command', () => {
    expect(parseCommand({ type: 'ult', player: 2 })).toEqual({ type: 'ult', player: 0 });
    expect(parseCommand({ type: 'ult', aim: { mode: 'aim', point: { x: 3.5, y: 4 }, extra: 1 } })).toEqual({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 3.5, y: 4 } } });
    expect(parseCommand({ type: 'ult', aim: { mode: 'drag', point: { x: -40, y: 99 } } })).toEqual({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: -40, y: 99 } } });
    // the sender's view of its character (where its preview measured the aim from)
    expect(parseCommand({ type: 'ult', aim: { mode: 'aim', point: { x: 3, y: 4 }, from: { x: 6, y: 7.5 } } })).toEqual({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 3, y: 4 }, from: { x: 6, y: 7.5 } } });
    const bad = [
      null,
      'aim',
      { mode: 'now', point: { x: 1, y: 1 } },
      { mode: 'aim' },
      { mode: 'aim', point: { x: 'a', y: 1 } },
      { mode: 'aim', point: { x: 1 } },
      { mode: 'aim', point: { x: 1e9, y: 1 } },
      { mode: 'drag', point: [1, 2] },
      { point: { x: 1, y: 1 } },
      { mode: 'aim', point: { x: 1, y: 1 }, from: null },
      { mode: 'aim', point: { x: 1, y: 1 }, from: { x: 'a', y: 1 } },
      { mode: 'drag', point: { x: 1, y: 1 }, from: { x: 1e9, y: 1 } },
    ];
    for (const aim of bad) expect(parseCommand({ type: 'ult', aim }), JSON.stringify(aim)).toBeNull();
    // NaN / Infinity never survive JSON: they arrive as null
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { type: 'ult', aim: { mode: 'aim', point: { x: NaN, y: 1 } } } }))).toBeNull();
  });

  it('createRoom mode ultTest; the preset carries a known ult mode; debug ultMode', () => {
    const raw = (o: object) => parseClientMsg(JSON.stringify(o));
    expect(raw({ t: 'createRoom', preset: { ...PRESET_A, ultMode: 'drag' }, mode: 'ultTest' })).toEqual({ t: 'createRoom', preset: { ...PRESET_A, ultMode: 'drag' }, mode: 'ultTest' });
    expect(raw({ t: 'joinRoom', code: 'ABCD', preset: { ...PRESET_B, ultMode: 'aim' } })).toEqual({ t: 'joinRoom', code: 'ABCD', preset: { ...PRESET_B, ultMode: 'aim' } });
    for (const ultMode of ['fly', 1, null, '']) expect(raw({ t: 'setPreset', preset: { ...PRESET_A, ultMode } }), String(ultMode)).toBeNull();
    const dbg = (action: object) => parseCommand({ type: 'debug', action });
    expect(dbg({ kind: 'ultMode', mode: 'aim', player: 2 })).toEqual({ type: 'debug', action: { kind: 'ultMode', mode: 'aim' } });
    for (const mode of ['x', undefined, 3]) expect(dbg({ kind: 'ultMode', mode }), String(mode)).toBeNull();
  });
});

type Cast = Extract<GameEvent, { type: 'skillCast' }>;

/** Every skillCast / ultCast of player `pi`'s ult this client saw (snapshots' events, in order). */
function ultEvents(c: TestClient, pi: number): { casts: Cast[]; ults: Extract<GameEvent, { type: 'ultCast' }>[] } {
  const casts: Cast[] = [];
  const ults: Extract<GameEvent, { type: 'ultCast' }>[] = [];
  for (const m of c.msgs) {
    if (m.t !== 'snap') continue;
    for (const e of m.events) {
      if (e.type === 'skillCast' && e.slot === 'ult' && e.player === pi) casts.push(e);
      if (e.type === 'ultCast' && e.player === pi) ults.push(e);
    }
  }
  return { casts, ults };
}

describe('a 궁극기 테스트 room', () => {
  it('three players: tagged room, each member’s mode in the game (bots: the host’s); A aims → B and C see the same cast', async () => {
    const a = await connect('A');
    const b = await connect('B');
    const c = await connect('C');
    a.send({ t: 'createRoom', preset: { ...PRESET_A, ultMode: 'aim' }, mode: 'ultTest' });
    const { room } = await a.next('room', m => !!m.room);
    expect(room!.mode).toBe('ultTest');
    b.send({ t: 'joinRoom', code: room!.code, preset: { ...PRESET_B, ultMode: 'drag' } });
    await b.next('room', m => !!m.room && m.room.members.length === 2);
    c.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await c.next('room', m => !!m.room && m.room.members.length === 3);
    b.send({ t: 'listRooms' });
    expect((await b.next('rooms', m => m.rooms.length > 0)).rooms[0].mode).toBe('ultTest');

    for (const x of [a, b, c]) x.mark();
    a.send({ t: 'start' });
    expect((await a.next('start')).mode).toBe('ultTest');
    expect((await c.next('start')).mode).toBe('ultTest');
    const first = await a.snap(m => m.state.phase === 'combat');
    expect(first.state.mode).toBe('ultTest');
    expect(first.state.plan.kind).toBe('boss');
    expect(first.state.players.map(p => p.ultMode)).toEqual(['aim', 'drag', 'now']);

    // A: full gauge, then an aimed ult at a spot with nobody near (the parts land there)
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { invincible: true } } });
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'debug', action: { kind: 'chargeUlt' } } });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(true);
    const point = { x: 4, y: 9 };
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'ult', player: 0, aim: { mode: 'aim', point } } });
    expect(await a.next('cmdResult', m => m.seq === 3)).toMatchObject({ ok: true });
    // every client gets the cast in its snapshot events — the very same events
    const seen = await Promise.all(
      [a, b, c].map(async x => {
        await x.snap(m => m.events.some(e => e.type === 'skillCast' && e.slot === 'ult' && e.player === 0 && e.stage === 'citadel'), 6000);
        return ultEvents(x, 0);
      }),
    );
    for (const s of seen) {
      expect(s.ults.at(-1)?.aim).toEqual({ mode: 'aim', x: 4, y: 9, alt: true }); // the guardian's own 조준 (성채 투척)
      const citadel = s.casts.find(e => e.stage === 'citadel')!;
      expect(citadel.center).toEqual(point);
    }
    expect(JSON.stringify(seen[1].casts)).toBe(JSON.stringify(seen[0].casts));
    expect(JSON.stringify(seen[2].casts)).toBe(JSON.stringify(seen[0].casts));

    // B (드래그): a point off the arena is clamped, the character lands inside, capped at the drag range
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'ult', player: 0, aim: { mode: 'drag', point: { x: -50, y: 60 } } } });
    expect((await b.next('cmdResult', m => m.seq === 1)).ok).toBe(false); // not charged
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'debug', action: { kind: 'chargeUlt' } } }); // fills the host's only (per player)
    await a.next('cmdResult', m => m.seq === 4);
    // B's mode is drag: an aim command from B is refused (mode mismatch), the gauge stays
    a.send({ t: 'cmd', seq: 5, cmd: { type: 'tunables', patch: { ultFieldChargeTime: 1 } } });
    await b.snap(m => (m.state.players[1].party[m.state.players[1].activeIndex ?? 0]?.ult.charge ?? 0) >= 1, 6000);
    b.send({ t: 'cmd', seq: 2, cmd: { type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 5, y: 5 } } } });
    expect(await b.next('cmdResult', m => m.seq === 2)).toMatchObject({ ok: false, reason: '궁극기 방식이 바뀌었어요' });
    b.send({ t: 'cmd', seq: 3, cmd: { type: 'ult', player: 0, aim: { mode: 'drag', point: { x: -50, y: 60 } } } });
    expect((await b.next('cmdResult', m => m.seq === 3)).ok).toBe(true);
    const bs = await c.snap(m => m.events.some(e => e.type === 'ultCast' && e.player === 1), 6000);
    const landed = bs.events.find((e): e is Extract<GameEvent, { type: 'ultCast' }> => e.type === 'ultCast' && e.player === 1)!;
    expect(landed.aim?.mode).toBe('drag');
    expect(landed.aim!.x).toBeGreaterThanOrEqual(0.5);
    expect(landed.aim!.y).toBeLessThanOrEqual(bs.state.plan.arena.height - 0.45);
  });

  it('the host’s 「궁극기 방식」 switches every player; a guest may not', async () => {
    const a = await connect('방장');
    const b = await connect('손님');
    a.send({ t: 'createRoom', preset: { ...PRESET_A, ultMode: 'aim' }, mode: 'ultTest' });
    const { room } = await a.next('room', m => !!m.room);
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await b.next('room', m => !!m.room && m.room.members.length === 2);
    for (const x of [a, b]) x.mark();
    a.send({ t: 'start' });
    await b.snap(m => m.state.phase === 'combat');
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'ultMode', mode: 'drag' } } });
    expect(await b.next('cmdResult', m => m.seq === 1)).toMatchObject({ ok: false, reason: '방장만 할 수 있어요' });
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'ultMode', mode: 'drag' } } });
    expect((await a.next('cmdResult', m => m.seq === 1)).ok).toBe(true);
    const s = await b.snap(m => m.state.players.every(p => p.ultMode === 'drag'));
    expect(s.state.players.map(p => p.ultMode)).toEqual(['drag', 'drag', 'drag']);
  });

  it('an aimed ult based on a too-old picture is refused like a stale drop (a tap never is)', async () => {
    await srv.close();
    srv = await startTestServer({ maxCommandAgeMs: 100 });
    const a = await connect('방장');
    a.send({ t: 'createRoom', preset: { ...PRESET_A, ultMode: 'aim' }, mode: 'ultTest' });
    await a.next('room', m => !!m.room);
    a.mark();
    a.send({ t: 'start' });
    const first = await a.snap(m => m.state.phase === 'combat');
    await new Promise(r => setTimeout(r, 400));
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'chargeUlt' } } });
    await a.next('cmdResult', m => m.seq === 1);
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 6, y: 6 } } }, atTick: first.tick });
    expect(await a.next('cmdResult', m => m.seq === 2)).toMatchObject({ ok: false, reason: '연결이 늦어 취소됐어요' });
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'ult', player: 0 }, atTick: first.tick });
    expect((await a.next('cmdResult', m => m.seq === 3)).ok).toBe(true);
  });

  it('a classic room ignores the aim (the tap happens) and has no ult modes', async () => {
    const a = await connect('A');
    a.send({ t: 'createRoom', preset: { ...PRESET_A, ultMode: 'drag' } });
    await a.next('room', m => !!m.room);
    a.mark();
    a.send({ t: 'start' });
    const snap = await a.snap(m => m.state.phase === 'combat');
    expect(snap.state.mode).toBeUndefined();
    expect(snap.state.players.every(p => p.ultMode === undefined)).toBe(true);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'chargeUlt' } } });
    await a.next('cmdResult', m => m.seq === 1);
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'ult', player: 0, aim: { mode: 'drag', point: { x: 1, y: 1 } } } });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(true);
    const u = await a.snap(m => m.events.some(e => e.type === 'ultCast'));
    const ev = u.events.find(e => e.type === 'ultCast') as Extract<GameEvent, { type: 'ultCast' }>;
    expect(ev.aim).toBeUndefined();
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'debug', action: { kind: 'ultMode', mode: 'aim' } } });
    expect(await a.next('cmdResult', m => m.seq === 3)).toMatchObject({ ok: false, reason: '궁극기 테스트 전용' });
  });
});
