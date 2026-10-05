// Adversarial review of the game server (server/*, R30–R35): hostile / malformed / fast clients, token abuse,
// room lifecycle (cleanup, handoff, linger), reward edge cases, bounded memory, wire hygiene.
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer, ServerOptions } from '../../server/server';
import type { Room } from '../../server/room';
import { randomRoomCode, normalizeRoomCode } from '../../server/util';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET } from '../../src/net/protocol';
import { PRESET_A, PRESET_B, sleep, startTestServer, TestClient } from '../net/helpers';

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
async function makeRoom(host: TestClient, ...others: TestClient[]): Promise<string> {
  host.mark();
  host.send({ t: 'createRoom', preset: PRESET_A });
  const { room } = await host.next('room', m => !!m.room);
  const code = room!.code;
  for (const c of others) {
    c.mark();
    c.send({ t: 'joinRoom', code, preset: PRESET_B });
    await c.next('room', m => !!m.room && m.room.code === code);
  }
  return code;
}
async function startGame(host: TestClient, ...others: TestClient[]) {
  for (const c of [host, ...others]) c.mark();
  host.send({ t: 'start' });
  const starts = [await host.next('start')];
  for (const c of others) starts.push(await c.next('start'));
  return starts;
}
const roomOf = (code: string) => srv!.hub.rooms.get(code) as Room | undefined;
const internals = (r: Room) => r as unknown as { loop: unknown; events: unknown[] };
const hubInternals = () => srv!.hub as unknown as { byToken: Map<string, unknown>; conns: Set<unknown> };

afterEach(async () => {
  for (const c of clients.splice(0)) c.kill();
  if (srv) await srv.close();
  srv = null;
});

// ─────────────────────────── malformed / fast ───────────────────────────

/** Hostile payloads: every message type with wrong shapes, prototype keys, absurd numbers, deep nesting. */
function junk(): (string | Record<string, unknown>)[] {
  const deep = '['.repeat(5000) + ']'.repeat(5000);
  const big = 1e308;
  return [
    '',
    'null',
    '[]',
    '"str"',
    '123',
    deep,
    '{"t":{"toString":1}}',
    '{"__proto__":{"polluted":1},"t":"listRooms"}',
    '{"t":"hello","v":"1"}',
    { t: 'hello', v: PROTOCOL_VERSION, name: 7 },
    { t: 'setName', name: { a: 1 } },
    { t: 'setName', name: 'x'.repeat(5000) },
    { t: 'createRoom', preset: { characters: ['guardian', 'guardian'], pets: ['frog_bomb', 'frog_bomb', 'frog_bomb'] } },
    { t: 'createRoom', preset: { characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'], __proto__: { x: 1 } }, roomName: 5 },
    { t: 'joinRoom', code: { length: 4 }, preset: PRESET_A },
    { t: 'joinRoom', code: '../../', preset: PRESET_A },
    { t: 'setPreset', preset: null },
    { t: 'cmd', seq: 1.5, cmd: { type: 'ult' } },
    { t: 'cmd', seq: big, cmd: { type: 'ult' } },
    { t: 'cmd', seq: 1, cmd: null },
    { t: 'cmd', seq: 1, cmd: { type: 'swap', partyIndex: 1, pos: { x: big, y: 1 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'swap', partyIndex: 7, pos: { x: 1, y: 1 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'swap', partyIndex: -1, pos: { x: 1, y: 1 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'swap', partyIndex: '1', pos: { x: 1, y: 1 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'swap', partyIndex: 1, pos: [1, 2] } },
    { t: 'cmd', seq: 1, cmd: { type: 'swap', partyIndex: 1, pos: { x: '1', y: 2 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'pet', petIndex: 9, pos: { x: 1, y: 1 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'chooseReward', offerIndex: 99 } },
    { t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'jumpFloor', floor: 1e9 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'chargeUlt', player: 2 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'nope' } } },
    { t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { constructor: 1, toString: 2, hasOwnProperty: 3 } } },
    '{"t":"cmd","seq":1,"cmd":{"type":"tunables","patch":{"__proto__":{"invincible":true},"gameSpeed":"8"}}}',
    { t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { gameSpeed: -5, maxAliveMonsters: 1e9, normalFloorTime: 0, ultChargeTime: 0 } } },
    { t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: [1, 2] } },
    { t: 'ping', at: 'now' },
    { t: 'ping' },
  ];
}

describe('hostile input never crashes the server or leaks into the sim', () => {
  it('junk on every message type, from the lobby, the room and in game (host): server answers, snapshots stay finite, nothing polluted', async () => {
    await server({ ratePerSec: 100_000, rateBurst: 100_000 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    for (const m of junk()) a.send(m as never); // lobby
    const code = await makeRoom(a, b);
    for (const m of junk()) b.sendRaw(typeof m === 'string' ? m : JSON.stringify(m)); // room member
    await startGame(a, b);
    for (const m of junk()) a.sendRaw(typeof m === 'string' ? m : JSON.stringify(m)); // in game, host
    for (const m of junk()) b.sendRaw(typeof m === 'string' ? m : JSON.stringify(m)); // in game, member
    a.mark();
    a.send({ t: 'ping', at: 42 });
    expect((await a.next('pong')).at).toBe(42);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).invincible).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'x')).toBe(false);
    const room = roomOf(code)!;
    const t = room.game!.tunables;
    // the host's absurd patch was clamped, not rejected wholesale and not applied raw
    expect([t.gameSpeed, t.maxAliveMonsters, t.normalFloorTime, t.ultChargeTime]).toEqual([0, 200, 5, 0.5]);
    expect(Object.keys(t)).not.toContain('constructor');
    a.send({ t: 'cmd', seq: 99, cmd: { type: 'tunables', patch: { gameSpeed: 1, normalFloorTime: 300 } } });
    const snap = await a.snap(m => m.state.tick > 30, 6000);
    for (const e of snap.state.entities) {
      expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y)).toBe(true);
      expect(Number.isFinite(e.hp)).toBe(true);
    }
    expect(snap.state.floor).toBeLessThanOrEqual(t.maxFloor);
    // B (not host) could not change anything host-only: still in the room, game still running
    expect(room.status).toBe('playing');
    expect(room.members.map(m => m.session.name)).toEqual(['A', 'B']);
  });

  it('a flood closes only the flooding socket; the other player in the room keeps playing', async () => {
    await server();
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    for (let i = 0; i < 2000; i++) b.send({ t: 'cmd', seq: i, cmd: { type: 'ult', player: 0 } });
    // under a loaded full-suite run the server may need longer than 0.5 s to chew through the flood
    for (let i = 0; i < 50 && !b.closed; i++) await sleep(100);
    expect(b.closed).toBe(true);
    expect(b.closeCode).toBe(1008);
    a.mark();
    const s = await a.snap(m => m.state.players[1].isBot); // B's slot → bot (R34)
    expect(s.state.phase).toBe('combat');
  });

  it('invalid UTF-8 text frame / binary frame: socket closed or ignored, server fine', async () => {
    await server();
    const a = await connect('A');
    a.ws.send(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), { binary: false });
    await sleep(200);
    expect(a.closed).toBe(true);
    const b = await connect('B');
    b.sendRaw(Buffer.alloc(1000, 1));
    b.mark();
    b.send({ t: 'ping', at: 1 });
    expect((await b.next('pong')).at).toBe(1);
  });

  it('many idle sockets that never say hello are tolerated, and closing them frees everything', async () => {
    // all from 127.0.0.1: lift the per-address cap here (it has its own test in tests/net/server-limits.test.ts)
    await server({ maxConnectionsPerIp: 1000 });
    const idle = await Promise.all(Array.from({ length: 60 }, () => TestClient.open(srv!.port)));
    clients.push(...idle);
    expect(srv!.hub.connectionCount).toBe(60);
    await Promise.all(idle.map(c => c.close()));
    await sleep(100);
    expect(srv!.hub.connectionCount).toBe(0);
    expect(hubInternals().byToken.size).toBe(0);
  });
});

// ─────────────────────────── tokens ───────────────────────────

describe('tokens (R34)', () => {
  it('an unknown or malformed token never becomes a session token (no session fixation) and lands in the lobby', async () => {
    await server();
    const a = await connect('A');
    await makeRoom(a);
    const forged = 'a'.repeat(32);
    const x = await connect('X', forged);
    expect(x.token).not.toBe(forged);
    expect(x.sessionId).not.toBe(a.sessionId);
    expect((await x.next('room')).room).toBeNull();
    const y = await TestClient.open(srv!.port);
    clients.push(y);
    y.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Y', token: '../../etc' });
    const w = await y.next('welcome');
    expect(w.token).toMatch(/^[0-9a-f]{32}$/);
    expect((await y.next('room')).room).toBeNull();
  });

  it("a second hello on the same socket can't switch to another player's session", async () => {
    await server();
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a);
    b.mark();
    b.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'A', token: a.token });
    expect((await b.next('error')).code).toBe('bad_request');
    await sleep(100);
    expect(a.closed).toBe(false);
  });

  it('presenting a live token takes the seat over and closes the old socket with 4001 (the old tab must not fight back)', async () => {
    await server();
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    const thief = await connect('thief', b.token);
    expect(thief.sessionId).toBe(b.sessionId);
    expect((await thief.next('start')).playerIndex).toBe(1);
    await sleep(100);
    expect(b.closed).toBe(true);
    expect(b.closeCode).toBe(4001);
    // nothing tells the old client to stop: see tests/review/connection-replaced.test.ts (reconnect loop)
  });
});

// ─────────────────────────── rooms ───────────────────────────

describe('room codes', () => {
  it('collisions are retried; codes stay in the alphabet; a full 4-letter space falls back to 5 letters', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const c = randomRoomCode(x => taken.has(x));
      expect(taken.has(c)).toBe(false);
      expect([...c].every(ch => ROOM_CODE_ALPHABET.includes(ch))).toBe(true);
      taken.add(c);
    }
    expect(randomRoomCode(c => c.length === 4)).toHaveLength(5);
    expect(normalizeRoomCode(' ab-c d ')).toBe('ABCD');
    expect(normalizeRoomCode('0O1I')).toBe('');
  });
});

describe('room lifecycle', () => {
  it('everyone leaves mid-game → room deleted at once, game loop stopped', async () => {
    await server();
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    const code = await makeRoom(a, b);
    await startGame(a, b);
    const room = roomOf(code)!;
    expect(internals(room).loop).not.toBeNull();
    a.send({ t: 'leaveRoom' });
    b.send({ t: 'leaveRoom' });
    await sleep(150);
    expect(srv!.hub.rooms.size).toBe(0);
    expect(room.isClosed).toBe(true);
    expect(internals(room).loop).toBeNull();
    expect(room.game).toBeNull();
  });

  it('everyone drops mid-game → bots play on until abandonMs, then the room closes and its loop stops; idle sessions are swept', async () => {
    await server({ abandonMs: 300, sessionTtlMs: 400 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    const code = await makeRoom(a, b);
    await startGame(a, b);
    const room = roomOf(code)!;
    a.kill();
    b.kill();
    await sleep(150);
    expect(room.status).toBe('playing');
    await sleep(600);
    expect(room.isClosed).toBe(true);
    expect(internals(room).loop).toBeNull();
    expect(srv!.hub.rooms.size).toBe(0);
    await sleep(1300); // sweep runs every max(1 s, ttl / 4)
    expect(hubInternals().byToken.size).toBe(0);
  });

  it('the host only DROPS mid-game: nobody may debug meanwhile; when the run ends the absent host is removed and the role (and auto room name) moves on', async () => {
    await server({ endLingerMs: 200 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    const code = await makeRoom(a, b);
    await startGame(a, b);
    // make the run end by itself soon: floor 2 gets a 5 s limit (normal floor timeout = defeat)
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { normalFloorTime: 5, gameSpeed: 4 } } });
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    await a.next('cmdResult', m => m.seq === 2);
    a.kill();
    await b.snap(m => m.state.players[0].isBot);
    b.mark();
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    expect((await b.next('cmdResult', m => m.seq === 1)).ok).toBe(false); // documented limitation (host away = no debug)
    expect((await b.snap(m => m.state.phase === 'runOver', 6000)).hostPlayerIndex).toBe(0);
    const r = (await b.next('room', m => m.room?.status === 'waiting', 4000)).room!;
    expect(r.members.map(m => [m.name, m.isHost])).toEqual([['B', true]]);
    expect(r.name).toBe('B의 방');
    expect(roomOf(code)!.hostId).toBe(b.sessionId);
  }, 15_000);

  it('joining during the end linger (runOver, still "playing") is refused; after it the room takes newcomers again', async () => {
    await server({ endLingerMs: 600 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    const code = await makeRoom(a);
    await startGame(a);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'quit' } });
    await a.snap(m => m.state.phase === 'runOver');
    b.mark();
    b.send({ t: 'joinRoom', code, preset: PRESET_B });
    expect((await b.next('error')).code).toBe('room_playing');
    await a.next('room', m => m.room?.status === 'waiting', 3000);
    b.send({ t: 'joinRoom', code, preset: PRESET_B });
    await b.next('room', m => m.room?.members.length === 2);
    const [, sb] = await startGame(a, b);
    expect(sb.playerIndex).toBe(1);
  });

  it('createRoom while playing in another room: the old slot goes to a bot, the old game keeps running', async () => {
    await server();
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    const code = await makeRoom(a, b);
    await startGame(a, b);
    b.mark();
    b.send({ t: 'createRoom', preset: PRESET_B });
    const r = (await b.next('room', m => !!m.room && m.room.code !== code)).room!;
    expect(r.members.map(m => m.name)).toEqual(['B']);
    const s = await a.snap(m => m.state.players[1].isBot);
    expect(s.state.phase).toBe('combat');
    expect(roomOf(code)!.members.map(m => m.session.name)).toEqual(['A']);
  });
});

// ─────────────────────────── rewards ───────────────────────────

describe('R33 reward edge cases', () => {
  it('a human who drops during the reward phase gets a random pick at once: the others do not wait for the timeout', async () => {
    await server({ rewardTimeoutSec: 30 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    const r = await a.snap(m => m.state.phase === 'reward');
    expect(r.rewardDeadline).toBeGreaterThan(Date.now() + 20_000);
    expect(r.state.rewardOffersByPlayer[1]?.length).toBe(3);
    b.kill();
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'chooseReward', player: 1, offerIndex: 2 } });
    const next = await a.snap(m => m.state.floor === 2 && m.state.phase === 'combat', 3000);
    expect(next.state.players.map(p => p.rewards.length + p.relics.length)).toEqual([1, 1, 1]);
  });

  it('every human drops during the reward phase: bots pick, the run continues bots-only', async () => {
    await server({ rewardTimeoutSec: 30, abandonMs: 5000 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    const code = await makeRoom(a, b);
    await startGame(a, b);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    await a.snap(m => m.state.phase === 'reward');
    a.kill();
    b.kill();
    await sleep(300);
    const g = roomOf(code)!.game!;
    expect(g.state.phase).toBe('combat');
    expect(g.state.floor).toBe(2);
  });

  it('the reward timeout picks only for the human who has not chosen', async () => {
    await server({ rewardTimeoutSec: 0.5 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    await b.snap(m => m.state.phase === 'reward');
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } }); // player field ignored
    const mid = await a.snap(m => m.state.phase === 'reward' && m.state.rewardOffersByPlayer[1] === null);
    expect(mid.state.rewardOffersByPlayer[0]?.length).toBe(3); // A still choosing
    const next = await a.snap(m => m.state.floor === 2 && m.state.phase === 'combat', 3000);
    expect(next.state.players[0].rewards.length + next.state.players[0].relics.length).toBe(1);
  });
});

// ─────────────────────────── bounded memory / wire hygiene ───────────────────────────

describe('bounded state over a long, fast run', () => {
  it('8× speed, 60 monsters cap, ~6 s real (≈ 48 s sim): event buffer, entity index and telegraphs stay bounded', async () => {
    await server();
    const a = await connect('A');
    const code = await makeRoom(a);
    await startGame(a);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { gameSpeed: 8, invincible: true, maxAliveMonsters: 60, monsterHpMult: 10, waveInterval: 0.5 } } });
    await sleep(6000);
    const room = roomOf(code)!;
    expect(internals(room).events.length).toBeLessThan(4001);
    const w = (room.game as unknown as { state: { entities: unknown[]; telegraphs: unknown[]; time: number } }).state;
    expect(w.time).toBeGreaterThan(30);
    expect(w.entities.length).toBeLessThan(120);
    expect(w.telegraphs.length).toBeLessThan(60);
    const snap = await a.snap();
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThan(120 * 1024);
  }, 20_000);
});
