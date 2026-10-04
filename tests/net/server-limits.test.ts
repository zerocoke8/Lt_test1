// Game server hardening (review 3차): stale positional commands (atTick), server-wide limits (sockets, sockets per
// address, running games), one party = 3 different characters/pets, and the 5 s heartbeat that hands a silently dead
// player's slot to a bot quickly.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RunningServer, ServerOptions } from '../../server/server';
import { clientIp } from '../../server/server';
import { parseClientMsg } from '../../server/validate';
import type { IncomingMessage } from 'node:http';
import { PRESET_A, PRESET_B, sleep, startTestServer, TestClient } from './helpers';

let srv: RunningServer | null = null;
const clients: TestClient[] = [];

async function server(opts: Partial<ServerOptions> = {}): Promise<RunningServer> {
  srv = await startTestServer(opts);
  return srv;
}

async function connect(name: string, token?: string): Promise<TestClient> {
  const c = await TestClient.connect(srv!.port, name, token);
  clients.push(c);
  return c;
}

async function soloGame(host: TestClient) {
  host.mark();
  host.send({ t: 'createRoom', preset: PRESET_A });
  await host.next('room', m => !!m.room);
  host.mark();
  host.send({ t: 'start' });
  await host.next('start');
  return host.snap();
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.kill();
  await srv?.close();
  srv = null;
});

describe('stale commands (atTick)', () => {
  it('a swap/pet based on a snapshot older than maxCommandAgeMs is refused; fresh ones and ones without atTick pass', async () => {
    await server({ maxCommandAgeMs: 300 });
    const a = await connect('A');
    const first = await soloGame(a);
    await sleep(500); // the client "stalled" on that snapshot; the server kept sending newer ones
    a.mark();
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'pet', player: 0, petIndex: 0, pos: { x: 5, y: 5 } }, atTick: first.tick });
    expect(await a.next('cmdResult', m => m.seq === 1)).toEqual({ t: 'cmdResult', seq: 1, ok: false, reason: '연결이 늦어 취소됐어요' });
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 5 } }, atTick: first.tick });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(false);
    // fresh: the newest snapshot
    const fresh = await a.snap();
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 5 } }, atTick: fresh.tick });
    expect(await a.next('cmdResult', m => m.seq === 3)).toEqual({ t: 'cmdResult', seq: 3, ok: true });
    // no atTick (older client): accepted as before
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'pet', player: 0, petIndex: 1, pos: { x: 6, y: 5 } } });
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    // non-positional commands are never stale-checked (ult/reward/quit)
    a.send({ t: 'cmd', seq: 5, cmd: { type: 'ult', player: 0 }, atTick: first.tick });
    expect((await a.next('cmdResult', m => m.seq === 5)).reason).toBe('게이지 부족');
  });

  it('atTick is validated (non-integers are dropped, not trusted)', () => {
    const cmd = { type: 'ult' };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd, atTick: 12 }))).toEqual({ t: 'cmd', seq: 1, cmd: { type: 'ult', player: 0 }, atTick: 12 });
    for (const atTick of [-1, 1.5, '3', null, 1e300]) {
      expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd, atTick }))).toEqual({ t: 'cmd', seq: 1, cmd: { type: 'ult', player: 0 } });
    }
  });
});

describe('presets', () => {
  it('one party needs 3 different characters and 3 different pets (players may still share characters)', async () => {
    await server();
    const a = await connect('A');
    const b = await connect('B');
    a.mark();
    a.send({ t: 'createRoom', preset: { characters: ['blade', 'blade', 'blade'], pets: PRESET_A.pets } });
    a.send({ t: 'createRoom', preset: { characters: PRESET_A.characters, pets: ['frog_bomb', 'frog_bomb', 'cat_void'] } });
    await sleep(150);
    expect(a.msgs.slice(a.msgs.length - 2).some(m => m.t === 'room' && m.room)).toBe(false);
    a.send({ t: 'createRoom', preset: PRESET_A });
    const { room } = await a.next('room', m => !!m.room);
    b.mark();
    b.send({ t: 'joinRoom', code: room!.code, preset: { characters: [...PRESET_A.characters], pets: PRESET_B.pets } });
    const joined = await b.next('room', m => !!m.room);
    expect(joined.room!.members.map(m => m.preset.characters)).toEqual([PRESET_A.characters, PRESET_A.characters]);
  });
});

describe('server-wide limits', () => {
  it('sockets per address and in total are capped (503 before the handshake); closing frees the slot', async () => {
    await server({ maxConnectionsPerIp: 2, maxConnections: 3 });
    const a = await connect('A');
    await connect('B');
    await expect(TestClient.open(srv!.port)).rejects.toThrow(/503/);
    expect(srv!.hub.connectionCount).toBe(2);
    await a.close();
    await sleep(50);
    clients.push(await TestClient.connect(srv!.port, 'C'));
    expect(srv!.hub.connectionCount).toBe(2);
  });

  it('total cap counts every address', async () => {
    await server({ maxConnectionsPerIp: 100, maxConnections: 2 });
    await connect('A');
    await connect('B');
    await expect(TestClient.open(srv!.port)).rejects.toThrow(/503/);
  });

  it('games running at once are capped: the next host gets server_busy until one ends', async () => {
    await server({ maxPlayingRooms: 1 });
    const a = await connect('A');
    const b = await connect('B');
    await soloGame(a);
    b.mark();
    b.send({ t: 'createRoom', preset: PRESET_B });
    await b.next('room', m => !!m.room);
    b.send({ t: 'start' });
    const err = await b.next('error');
    expect(err.code).toBe('server_busy');
    expect(err.message).toContain('붐벼요');
    // host A ends its game → B can start
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'quit' } });
    for (let i = 0; i < 40 && srv!.hub.playingRooms > 0; i++) await sleep(100);
    expect(srv!.hub.playingRooms).toBe(0);
    b.mark();
    b.send({ t: 'start' });
    expect((await b.next('start')).playerIndex).toBe(0);
  });

  it('client address: socket peer by default; first X-Forwarded-For hop only behind a trusted proxy', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage;
    expect(clientIp(req, false)).toBe('10.0.0.1');
    expect(clientIp(req, true)).toBe('203.0.113.7');
    const plain = { headers: {}, socket: { remoteAddress: '::1' } } as unknown as IncomingMessage;
    expect(clientIp(plain, true)).toBe('::1');
  });

  it('client address on Fly.io: Fly-Client-IP wins over a forged X-Forwarded-For; falls back when absent', () => {
    const req = {
      headers: { 'fly-client-ip': '198.51.100.9', 'x-forwarded-for': '1.2.3.4, 198.51.100.9' },
      socket: { remoteAddress: '172.16.0.2' },
    } as unknown as IncomingMessage;
    expect(clientIp(req, 'fly')).toBe('198.51.100.9');
    const noHeader = { headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '172.16.0.2' } } as unknown as IncomingMessage;
    expect(clientIp(noHeader, 'fly')).toBe('203.0.113.7');
  });
});

describe('heartbeat', () => {
  it('a socket that stops answering pings is dropped within two heartbeat rounds → its slot goes to a bot', async () => {
    await server({ heartbeatMs: 200 });
    const a = await connect('A');
    const b = await connect('B');
    a.mark();
    a.send({ t: 'createRoom', preset: PRESET_A });
    const { room } = await a.next('room', m => !!m.room);
    b.send({ t: 'joinRoom', code: room!.code, preset: PRESET_B });
    await a.next('room', m => (m.room?.members.length ?? 0) === 2);
    a.mark();
    a.send({ t: 'start' });
    await a.next('start');
    // B's link goes silent: its socket stays open but never answers a ping (ws auto-pong disabled)
    const raw = (b.ws as unknown as { _receiver?: { removeAllListeners(ev: string): void } })._receiver;
    raw?.removeAllListeners('ping');
    b.ws.pause();
    const t0 = Date.now();
    const s = await a.snap(m => m.state.players[1].isBot && !!m.state.players[1].disconnected, 3000);
    expect(s.state.players[1].disconnected).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(b.ws.readyState === WebSocket.OPEN || b.ws.readyState === WebSocket.CLOSING || b.ws.readyState === WebSocket.CLOSED).toBe(true);
  });
});
