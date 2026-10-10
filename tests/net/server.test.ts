// Game server (server/*): HTTP, hello/sessions, rooms (create/join/full/host handoff), start fills bots, command
// player override, host-only debug/tunables, reward timeout (R33), disconnect → bot → reconnect (R34), quit, robustness,
// 괴담 방 (기획 10차): own fresh deadline, timeout = 'leave' then continue, disconnect / host drop / reconnect mid-room.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer, ServerOptions } from '../../server/server';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { PRESET_A, PRESET_B, sleep, startTestServer, TestClient } from './helpers';

let srv: RunningServer;
const clients: TestClient[] = [];

async function connect(name: string, token?: string): Promise<TestClient> {
  const c = await TestClient.connect(srv.port, name, token);
  clients.push(c);
  return c;
}

/** A creates a room, the others join in order. Returns the room code. */
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

beforeEach(async () => {
  srv = await startTestServer();
});

/** Same test server with other options (e.g. a longer 괴담 deadline). */
async function restart(opts: Partial<ServerOptions>): Promise<void> {
  await srv.close();
  srv = await startTestServer(opts);
}

/** Host forces a 괴담 room after floor 1, clears it, every human picks reward 0 → the room is open. */
async function openGoedamRoom(host: TestClient, ...others: TestClient[]) {
  host.send({ t: 'cmd', seq: 901, cmd: { type: 'debug', action: { kind: 'goedamNext', room: 'broken_vending' } } });
  expect((await host.next('cmdResult', m => m.seq === 901)).ok).toBe(true);
  host.send({ t: 'cmd', seq: 902, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
  await host.snap(m => m.state.phase === 'reward');
  for (const c of [host, ...others]) c.send({ t: 'cmd', seq: 903, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } });
  return host.snap(m => m.state.phase === 'goedam');
}

const goedamCmd = (c: TestClient, seq: number, option: string, player = 0) =>
  c.send({ t: 'cmd', seq, cmd: { type: 'goedam', player, option } });

afterEach(async () => {
  for (const c of clients.splice(0)) c.kill();
  await srv.close();
});

describe('HTTP', () => {
  it('serves /healthz, the client build and nothing outside it', async () => {
    const base = `http://127.0.0.1:${srv.port}`;
    const h = await fetch(`${base}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.text()).toBe('ok');
    const index = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } });
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await index.text()).toContain('스왑 타워');
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('hello / sessions', () => {
  it('welcome with session + token; nickname sanitised (1–12 chars, default 플레이어N)', async () => {
    const a = await connect('  에이\u0000​  ');
    expect(a.name).toBe('에이');
    expect(a.sessionId).toMatch(/^[0-9a-f]+$/);
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    const b = await connect('가나다라마바사아자차카타파하');
    expect(b.name).toBe('가나다라마바사아자차카타');
    const c = await connect('   ');
    expect(c.name).toMatch(/^플레이어\d+$/);
    // lobby clients get the room list right away
    expect((await c.next('rooms')).rooms).toEqual([]);
    c.mark();
    c.send({ t: 'setName', name: '새 이름' });
    expect((await c.next('welcome')).name).toBe('새 이름');
  });

  it('rejects another protocol version', async () => {
    const c = await TestClient.open(srv.port);
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'x' });
    expect((await c.next('error')).code).toBe('bad_version');
  });

  it('ignores junk, answers ping, closes on oversized frames', async () => {
    const c = await connect('junk');
    c.sendRaw('not json');
    c.sendRaw('{"t":"nope"}');
    c.sendRaw('{"t":"cmd","seq":-1,"cmd":{"type":"swap"}}');
    c.sendRaw('{"t":"joinRoom","code":"ABCD","preset":{"characters":["x","y","z"],"pets":[]}}');
    c.sendRaw(Buffer.from([1, 2, 3]));
    c.mark();
    c.send({ t: 'ping', at: 123 });
    const pong = await c.next('pong');
    expect(pong.at).toBe(123);
    expect(pong.serverTime).toBeGreaterThan(0);
    expect(c.msgs.some(m => m.t === 'error')).toBe(false);
    c.sendRaw('x'.repeat(64 * 1024));
    await sleep(200);
    expect(c.closed).toBe(true);
    expect(c.closeCode).toBe(1009);
  });

  it('rate-limits floods', async () => {
    const c = await connect('flood');
    c.mark();
    for (let i = 0; i < 200; i++) c.send({ t: 'ping', at: i });
    await sleep(300);
    const pongs = c.msgs.filter(m => m.t === 'pong').length;
    expect(pongs).toBeGreaterThan(50);
    expect(pongs).toBeLessThan(120);
  });
});

describe('rooms', () => {
  it('create / join by code / full / not found; lobby sees the list', async () => {
    const [a, b, c, d, lobby] = await Promise.all(['A', 'B', 'C', 'D', 'L'].map(n => connect(n)));
    lobby.mark();
    const code = await makeRoom(a, b);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    const info = (await a.next('room', m => m.room?.members.length === 2)).room!;
    expect(info.members.map(m => [m.name, m.isHost, m.connected])).toEqual([
      ['A', true, true],
      ['B', false, true],
    ]);
    expect(info.members[1].preset).toEqual(PRESET_B);
    expect(info.status).toBe('waiting');
    const listed = await lobby.next('rooms', m => m.rooms.some(r => r.code === code && r.players === 2));
    expect(listed.rooms[0]).toMatchObject({ code, hostName: 'A', players: 2, max: 3, status: 'waiting', name: 'A의 방' });
    // join by lower-case code
    c.send({ t: 'joinRoom', code: code.toLowerCase(), preset: PRESET_A });
    await c.next('room', m => m.room?.members.length === 3);
    d.send({ t: 'joinRoom', code, preset: PRESET_A });
    expect((await d.next('error')).code).toBe('room_full');
    d.send({ t: 'joinRoom', code: 'ZZZZ', preset: PRESET_A });
    expect((await d.next('error')).code).toBe('room_not_found');
  });

  it('host handoff when the host leaves; an empty room is deleted', async () => {
    const [a, b, c, lobby] = await Promise.all(['A', 'B', 'C', 'L'].map(n => connect(n)));
    const code = await makeRoom(a, b, c);
    a.mark();
    a.send({ t: 'leaveRoom' });
    // wait for the leave reply itself: a late "C joined" broadcast to A may still be in flight after mark()
    expect((await a.next('room', m => m.room === null)).room).toBeNull();
    const r = (await b.next('room', m => m.room?.members.length === 2)).room!;
    expect(r.members.find(m => m.isHost)?.name).toBe('B');
    expect(r.name).toBe('B의 방'); // the automatic name follows the host
    b.send({ t: 'leaveRoom' });
    const r2 = (await c.next('room', m => m.room?.members.length === 1)).room!;
    expect(r2.members[0]).toMatchObject({ name: 'C', isHost: true });
    lobby.mark();
    c.send({ t: 'leaveRoom' });
    await lobby.next('rooms', m => !m.rooms.some(x => x.code === code));
    expect(srv.hub.rooms.size).toBe(0);
  });

  it('a dropped member keeps the waiting seat briefly (reload), then is removed', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    a.mark();
    b.kill();
    const r = (await a.next('room', m => m.room?.members.length === 2 && !m.room.members[1].connected)).room!;
    expect(r.members[1].name).toBe('B');
    await a.next('room', m => m.room?.members.length === 1, 2000);
  });
});

describe('game', () => {
  it('start: host only; humans in slot order, bots fill to 3; clean, rounded snapshots', async () => {
    const [a, b, lobby] = await Promise.all(['A', 'B', 'L'].map(n => connect(n)));
    const code = await makeRoom(a, b);
    b.send({ t: 'start' });
    expect((await b.next('error')).code).toBe('not_host');
    const [sa, sb] = await startGame(a, b);
    expect([sa.playerIndex, sb.playerIndex]).toEqual([0, 1]);
    expect(sa.hostPlayerIndex).toBe(0);
    expect(sb.hostPlayerIndex).toBe(0);
    const snap = await a.snap();
    const s = snap.state;
    expect(s.players.map(p => [p.name, p.isBot])).toEqual([
      ['A', false],
      ['B', false],
      ['BOT 1', true],
    ]);
    expect(s.players[0].party.map(m => m.defId)).toEqual(PRESET_A.characters);
    expect(s.players[1].pets.map(p => p.defId)).toEqual(PRESET_B.pets);
    expect(snap.hostPlayerIndex).toBe(0);
    expect(snap.rewardDeadline).toBeNull();
    // first snapshot carries the tunables; the tuning log only comes with the run's end
    expect(snap.tunables?.gameSpeed).toBe(1);
    expect(snap.telemetry).toBeUndefined();
    const raw = JSON.stringify(snap.state);
    expect(raw).not.toContain('"rt"');
    expect(raw).not.toContain('"src"');
    expect(raw).not.toMatch(/\d\.\d{3,}/);
    // the room is listed as playing and cannot be joined
    await lobby.next('rooms', m => m.rooms.some(r => r.code === code && r.status === 'playing'));
    lobby.send({ t: 'joinRoom', code, preset: PRESET_A });
    expect((await lobby.next('error')).code).toBe('room_playing');
    // snapshots keep flowing at ~15 Hz
    a.mark();
    await sleep(500);
    const n = a.msgs.slice(-40).filter(m => m.t === 'snap').length;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('a 1-human room gets 2 bots', async () => {
    const a = await connect('Solo');
    await makeRoom(a);
    const [sa] = await startGame(a);
    expect(sa.playerIndex).toBe(0);
    const s = (await a.snap()).state;
    expect(s.players.map(p => p.isBot)).toEqual([false, true, true]);
    expect(s.players.map(p => p.name)).toEqual(['Solo', 'BOT 1', 'BOT 2']);
  });

  it("commands act for the sender's slot whatever `player` says", async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    await a.snap();
    b.mark();
    b.send({ t: 'cmd', seq: 7, cmd: { type: 'swap', player: 0, partyIndex: 1, pos: { x: 14, y: 6 } } });
    const res = await b.next('cmdResult', m => m.seq === 7);
    expect(res.ok).toBe(true);
    const s = (await a.snap(m => m.state.players[1].activeIndex === 1)).state;
    expect(s.players[0].activeIndex).toBe(0);
    expect(s.players[1].stats.swaps).toBe(1);
    // the same card again right away is refused by the sim
    b.send({ t: 'cmd', seq: 8, cmd: { type: 'swap', player: 1, partyIndex: 1, pos: { x: 14, y: 6 } } });
    expect((await b.next('cmdResult', m => m.seq === 8)).ok).toBe(false);
  });

  it('debug and tunables are host-only; debug player is the sender', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    expect(await b.next('cmdResult', m => m.seq === 1)).toMatchObject({ ok: false, reason: '방장만 할 수 있어요' });
    b.send({ t: 'cmd', seq: 2, cmd: { type: 'tunables', patch: { gameSpeed: 2 } } });
    expect((await b.next('cmdResult', m => m.seq === 2)).ok).toBe(false);
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'debug', action: { kind: 'chargeUlt', player: 1 } } as never });
    expect((await a.next('cmdResult', m => m.seq === 3)).ok).toBe(true);
    // 기획 15차: debug 충전 fills every character's own gauge (the other player's stay as they are)
    const s = (await b.snap(m => m.state.players[0].party.every(x => x.ult.charge === 1))).state;
    expect(s.players[1].party.every(x => x.ult.charge < 1)).toBe(true);
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'tunables', patch: { ultFieldChargeTime: 9, invincible: true } } });
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    const snap = await b.snap(m => m.tunables?.ultFieldChargeTime === 9);
    expect(snap.tunables?.invincible).toBe(true);
  });

  it('기획 15차: every client sees per-character gauges; the host\'s ult sliders reach everyone; the dropped 14차 toggles do nothing', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    const first = await b.snap();
    expect(first.state.players.every(p => !('ult' in p) && !('energy' in p) && p.party.every(x => x.ult != null))).toBe(true);
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { ultBenchRatio: 0.5 } } });
    expect((await b.next('cmdResult', m => m.seq === 1)).ok).toBe(false);
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'tunables', patch: { ultFieldChargeTime: 20, ultBenchRatio: 0.5 } } });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(true);
    for (const c of [a, b]) {
      const snap = await c.snap(m => m.tunables?.ultBenchRatio === 0.5);
      expect(snap.tunables?.ultFieldChargeTime).toBe(20);
    }
    // an old client's 14차 toggles alone: nothing valid → refused; mixed in: ignored (never reach the tunables)
    const stale = { ultPerCharacter: false, ultChargeTime: 5, swapEnergyMode: true, swapEnergyMax: 99, swapEnergyRegen: 2 };
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'tunables', patch: stale } as never });
    expect((await a.next('cmdResult', m => m.seq === 3)).ok).toBe(false);
    a.send({ t: 'cmd', seq: 4, cmd: { type: 'tunables', patch: { ...stale, invincible: true } } as never });
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    const snap = await b.snap(m => m.tunables?.invincible === true);
    for (const k of Object.keys(stale)) expect(snap.tunables).not.toHaveProperty(k);
  });

  it('snapshots: tunables only when changed (+ ~1/s), telemetry only after runOver, wave spawns thinned', async () => {
    const a = await connect('A');
    await makeRoom(a);
    await startGame(a);
    await a.snap();
    a.mark();
    const from = a.msgs.length;
    await sleep(1300); // ~19 snapshots at 15 Hz
    const snaps = a.msgs.slice(from).filter(m => m.t === 'snap') as Extract<(typeof a.msgs)[number], { t: 'snap' }>[];
    expect(snaps.length).toBeGreaterThan(10);
    const withTunables = snaps.filter(m => m.tunables).length;
    expect(withTunables).toBeGreaterThanOrEqual(1); // the periodic resend
    expect(withTunables).toBeLessThanOrEqual(2);
    expect(snaps.every(m => m.telemetry === undefined)).toBe(true);
    const plan = snaps[snaps.length - 1].state.plan;
    expect(plan.waves.length).toBeGreaterThan(0);
    expect(plan.waves.every(w => w.spawns.length === 0)).toBe(true);
    expect(snaps[snaps.length - 1].state.entities.every(e => Number.isInteger(e.targetHeldFor))).toBe(true);
    // a change goes out on the next snapshot
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { ultFieldChargeTime: 11 } } });
    expect((await a.snap(m => m.tunables?.ultFieldChargeTime === 11, 1000)).tunables?.ultFieldChargeTime).toBe(11);
    // host ends the run → the runOver snapshots carry this player's tuning log
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'quit' } });
    const over = await a.snap(m => m.state.phase === 'runOver');
    expect(over.telemetry).toBeDefined();
    expect(over.telemetry!.damageShareBySource).toHaveProperty('drag');
  });

  it('R33 reward phase: everyone picks their own; the timeout picks for the rest', async () => {
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(n => connect(n)));
    await makeRoom(a, b, c);
    await startGame(a, b, c);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    const snap = await b.snap(m => m.state.phase === 'reward');
    expect(snap.rewardDeadline).not.toBeNull();
    expect(snap.rewardDeadline! - snap.serverTime).toBeGreaterThan(300);
    expect(snap.state.rewardOffersByPlayer.map(o => o?.length)).toEqual([3, 3, 3]);
    expect(snap.state.rewardOffers).toEqual(snap.state.rewardOffersByPlayer[0]);
    // 기획 17차: 빚쟁이의 방문 grants a second (epic) reward at once — B takes a new-family card that adds exactly one
    const bPick = Math.max(1, (snap.state.rewardOffersByPlayer[1] ?? []).findIndex((o, i) => i >= 1 && o.family !== 'debt'));
    b.send({ t: 'cmd', seq: 5, cmd: { type: 'chooseReward', player: 0, offerIndex: bPick } });
    expect((await b.next('cmdResult', m => m.seq === 5)).ok).toBe(true);
    const after = await a.snap(m => m.state.phase === 'reward' && m.state.rewardOffersByPlayer[1] === null);
    expect(after.state.phase).toBe('reward');
    expect(after.state.rewardOffersByPlayer[0]).not.toBeNull();
    expect(after.state.players[1].rewards.length).toBe(1);
    a.send({ t: 'cmd', seq: 6, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } });
    // C never picks: after the (test) 0.6 s timeout the server picks for C
    const next = await c.snap(m => m.state.floor === 2 && m.state.phase === 'combat', 3000);
    expect(next.rewardDeadline).toBeNull();
    expect(next.state.players.map(p => p.rewards.length + p.relics.length)).toEqual([1, 1, 1]);
  });

  it('R34 disconnect → bot takes the slot → same token reclaims it', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    const token = b.token;
    const sid = b.sessionId;
    a.mark();
    b.kill();
    const r = (await a.next('room', m => m.room?.members[1]?.connected === false)).room!;
    expect(r.status).toBe('playing');
    const s = (await a.snap(m => m.state.players[1].isBot)).state;
    expect(s.players[1].disconnected).toBe(true);
    expect(s.players[1].name).toBe('B');
    // back with the same token
    const b2 = await connect('B', token);
    expect(b2.sessionId).toBe(sid);
    expect((await b2.next('room')).room?.status).toBe('playing');
    const st = await b2.next('start');
    expect(st.playerIndex).toBe(1);
    const s2 = (await b2.snap(m => !m.state.players[1].isBot)).state;
    expect(s2.players[1].disconnected).toBe(false);
    await a.next('room', m => m.room?.members[1]?.connected === true);
  });

  it("non-host quit leaves (slot → bot); host quit ends the run; afterwards the room waits and drops absentees", async () => {
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(n => connect(n)));
    await makeRoom(a, b, c);
    await startGame(a, b, c);
    b.mark();
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'quit' } });
    expect((await b.next('cmdResult', m => m.seq === 1)).ok).toBe(true);
    expect((await b.next('room', m => m.room === null)).room).toBeNull();
    await a.next('room', m => m.room?.members.length === 2);
    expect((await a.snap(m => m.state.players[1].isBot)).state.phase).toBe('combat');
    // C drops; the host ends the run
    c.kill();
    await a.next('room', m => m.room?.members[1]?.connected === false);
    a.mark();
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'quit' } });
    const over = await a.snap(m => m.state.phase === 'runOver');
    expect(over.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'quit' });
    await a.next('gameEnded', () => true, 3000);
    const room = (await a.next('room', m => m.room?.status === 'waiting')).room!;
    expect(room.members.map(m => m.name)).toEqual(['A']);
    // and the host can start again
    const [again] = await startGame(a);
    expect(again.playerIndex).toBe(0);
  });

  it('host leaving mid-game hands the host role (and its debug rights) to the next member', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    a.send({ t: 'leaveRoom' });
    const snap = await b.snap(m => m.hostPlayerIndex === 1);
    expect(snap.state.players[0].isBot).toBe(true);
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'killAll' } } });
    expect((await b.next('cmdResult', m => m.seq === 1)).ok).toBe(true);
  });

  it('snapshot size stays reasonable mid-fight', async () => {
    const a = await connect('A');
    await makeRoom(a);
    await startGame(a);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { gameSpeed: 4, invincible: true, monsterHpMult: 10 } } });
    const s = await a.snap(m => m.state.entities.length > 12, 8000);
    const bytes = Buffer.byteLength(JSON.stringify(s));
    console.log(`snapshot: ${s.state.entities.length} entities, ${(bytes / 1024).toFixed(1)} KB raw JSON`);
    expect(bytes).toBeLessThan(80 * 1024);
  });
});

describe('괴담 방 (기획 10차)', () => {
  it('the room deadline starts fresh after the reward timeout; an idle human gets "leave" and everyone moves on', async () => {
    await restart({ rewardTimeoutSec: 0.6, goedamTimeoutSec: 1.2 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'goedamNext', room: 'broken_vending' } } });
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'debug', action: { kind: 'skipFloor' } } });
    const rw = await a.snap(m => m.state.phase === 'reward');
    expect(rw.goedamDeadline).toBeNull();
    a.send({ t: 'cmd', seq: 3, cmd: { type: 'chooseReward', player: 0, offerIndex: 0 } });
    // B never picks: the reward timeout picks for B and the room opens with a full deadline of its own
    const room = await b.snap(m => m.state.phase === 'goedam', 3000);
    expect(room.rewardDeadline).toBeNull();
    expect(room.goedamDeadline! - room.serverTime).toBeGreaterThan(900);
    expect(room.state.goedam).toMatchObject({ roomId: 'broken_vending', floor: 1 });
    expect(room.state.goedam!.players[2]).toMatchObject({ stage: 'done', choice: 'leave' }); // the bot left at once
    // A gambles and stays on the result card; B idles
    goedamCmd(a, 4, 'press');
    expect((await a.next('cmdResult', m => m.seq === 4)).ok).toBe(true);
    const next = await b.snap(m => m.state.floor === 2 && m.state.phase === 'combat', 4000);
    expect(next.goedamDeadline).toBeNull();
    expect(next.state.goedam).toBeNull();
    const logs = next.state.players.map(p => p.goedamLog.map(e => [e.optionId, e.outcome.id === 'leave', e.auto]));
    // a human's timeout is not a bot pick (auto=false); A's gamble rolled a real outcome
    expect(logs).toEqual([[['press', false, false]], [['leave', true, false]], [['leave', true, true]]]);
  });

  it("commands act for the sender's slot; refusals carry the sim's reasons; all done → next floor before the deadline", async () => {
    await restart({ goedamTimeoutSec: 30 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'goedamNext', room: 'no_such_room' } } });
    expect(await a.next('cmdResult', m => m.seq === 1)).toMatchObject({ ok: false, reason: '알 수 없는 방' });
    b.send({ t: 'cmd', seq: 1, cmd: { type: 'debug', action: { kind: 'goedamNext' } } });
    expect(await b.next('cmdResult', m => m.seq === 1)).toMatchObject({ ok: false, reason: '방장만 할 수 있어요' });
    goedamCmd(a, 2, 'leave');
    expect(await a.next('cmdResult', m => m.seq === 2)).toMatchObject({ ok: false, reason: '괴담 방이 아님' });
    const room = await openGoedamRoom(a, b);
    expect(room.goedamDeadline! - room.serverTime).toBeGreaterThan(20_000);
    goedamCmd(a, 10, 'press');
    expect((await a.next('cmdResult', m => m.seq === 10)).ok).toBe(true);
    // `player: 0` from B still means B: B has not chosen, so 'continue' is refused (A's slot would have taken it)
    goedamCmd(b, 11, 'continue', 0);
    expect(await b.next('cmdResult', m => m.seq === 11)).toMatchObject({ ok: false, reason: '먼저 고르세요' });
    goedamCmd(b, 12, 'not_an_option');
    expect(await b.next('cmdResult', m => m.seq === 12)).toMatchObject({ ok: false, reason: '잘못된 선택' });
    goedamCmd(b, 13, 'coin_slot', 0);
    expect((await b.next('cmdResult', m => m.seq === 13)).ok).toBe(true);
    const mid = await a.snap(m => m.state.goedam?.players[1].stage === 'result');
    expect(mid.state.goedam!.players.map(p => [p.stage, p.choice])).toEqual([
      ['result', 'press'],
      ['result', 'coin_slot'],
      ['done', 'leave'],
    ]);
    goedamCmd(a, 14, 'press');
    expect(await a.next('cmdResult', m => m.seq === 14)).toMatchObject({ ok: false, reason: '이미 골랐음' });
    goedamCmd(a, 15, 'continue');
    goedamCmd(b, 16, 'continue');
    const next = await a.snap(m => m.state.floor === 2 && m.state.phase === 'combat', 3000);
    expect(next.goedamDeadline).toBeNull();
    goedamCmd(a, 17, 'continue');
    expect(await a.next('cmdResult', m => m.seq === 17)).toMatchObject({ ok: false, reason: '괴담 방이 아님' });
  });

  it('host drop mid-room resolves only its slot; reconnect redraws the room (wait panel); a drop on the result card continues', async () => {
    await restart({ goedamTimeoutSec: 30 });
    const [a, b] = await Promise.all(['A', 'B'].map(n => connect(n)));
    await makeRoom(a, b);
    await startGame(a, b);
    const room = await openGoedamRoom(a, b);
    goedamCmd(b, 10, 'press');
    expect((await b.next('cmdResult', m => m.seq === 10)).ok).toBe(true);
    const token = a.token;
    b.mark();
    a.kill(); // the host only drops: a normal disconnect, the room is not cleared
    const dropped = await b.snap(m => m.state.players[0].isBot);
    expect(dropped.state.phase).toBe('goedam');
    expect(dropped.state.goedam!.players.map(p => [p.stage, p.choice])).toEqual([
      ['done', 'leave'],
      ['result', 'press'],
      ['done', 'leave'],
    ]);
    expect(dropped.state.players[0].goedamLog.map(e => [e.optionId, e.auto])).toEqual([['leave', true]]);
    expect(dropped.goedamDeadline).toBe(room.goedamDeadline); // nothing restarts the deadline
    // back with the same token: the whole room is in the state, my slot is done → the client shows the wait panel
    const a2 = await connect('A', token);
    expect((await a2.next('start')).playerIndex).toBe(0);
    const back = await a2.snap(m => !m.state.players[0].isBot);
    expect(back.state.phase).toBe('goedam');
    expect(back.state.goedam!.players[0].stage).toBe('done');
    expect(back.state.goedam!.players[1].outcome).not.toBeNull();
    expect(back.goedamDeadline).toBe(room.goedamDeadline);
    goedamCmd(a2, 20, 'continue');
    expect(await a2.next('cmdResult', m => m.seq === 20)).toMatchObject({ ok: false, reason: '이미 끝남' });
    // B drops while reading the result: continued for B, the room never waits on it
    b.kill();
    const next = await a2.snap(m => m.state.floor === 2 && m.state.phase === 'combat', 3000);
    expect(next.state.players[1].goedamLog.map(e => [e.optionId, e.auto])).toEqual([['press', false]]);
    expect(next.goedamDeadline).toBeNull(); // never a stale room deadline outside the room
  });
});
