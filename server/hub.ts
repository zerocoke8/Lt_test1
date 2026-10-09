// Connections, sessions (token → reconnect), room registry and message routing (src/net/protocol.ts).

import { WebSocket } from 'ws';
import type { ClientMsg, RoomSummary, ServerMsg } from '../src/net/protocol';
import { MAX_ROOM_PLAYERS, PROTOCOL_VERSION } from '../src/net/protocol';
import { Room, type Conn, type RoomHost, type RoomMode, type ServerOptions, type Session } from './room';
import { ExpeditionLobby } from './expedition';
import { normalizeRoomCode, randomId, randomRoomCode, ROOM_NAME_MAX, sanitizeName } from './util';
import { parseClientMsg } from './validate';

/** Above this many queued bytes a socket only gets non-droppable messages (snapshots are skipped). */
const CONGESTED_BYTES = 512 * 1024;
const MAX_LISTED_ROOMS = 50;

export class Hub implements RoomHost {
  readonly opts: ServerOptions;
  readonly rooms = new Map<string, Room>();
  private readonly byToken = new Map<string, Session>();
  private readonly conns = new Set<Conn>();
  private readonly perIp = new Map<string, number>();
  private nameCounter = 0;
  private roomsDirty = false;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  /** 기획 15차 원정: stage queues and session-held runs. */
  readonly expedition: ExpeditionLobby;

  constructor(opts: ServerOptions) {
    this.opts = opts;
    this.expedition = new ExpeditionLobby(this);
    this.timers.push(setInterval(() => this.heartbeat(), opts.heartbeatMs));
    this.timers.push(setInterval(() => this.sweep(), Math.min(60_000, Math.max(1000, opts.sessionTtlMs / 4))));
  }

  // ─────────────────────────── transport ───────────────────────────

  /** Room for one more socket from `ip`? (opts.maxConnections overall, opts.maxConnectionsPerIp per address) */
  admit(ip: string): boolean {
    return this.conns.size < this.opts.maxConnections && (this.perIp.get(ip) ?? 0) < this.opts.maxConnectionsPerIp;
  }

  get playingRooms(): number {
    let n = 0;
    for (const r of this.rooms.values()) if (!r.isClosed && r.status === 'playing') n++;
    return n;
  }

  attach(ws: WebSocket, ip = '?'): Conn {
    const conn: Conn = { ws, ip, session: null, alive: true, tokens: this.opts.rateBurst, lastRefill: performance.now(), dropped: 0 };
    this.conns.add(conn);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      if (isBinary || !this.allow(conn)) return;
      const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      const msg = parseClientMsg(text);
      if (!msg) return; // junk is ignored
      try {
        this.handle(conn, msg);
      } catch (err) {
        this.opts.log(`handler error (${msg.t}): ${(err as Error)?.stack ?? err}`);
      }
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {
      /* 'close' follows */
    });
    return conn;
  }

  /** Token bucket: ratePerSec sustained, rateBurst peak. Persistent flooding closes the socket. */
  private allow(conn: Conn): boolean {
    const now = performance.now();
    conn.tokens = Math.min(this.opts.rateBurst, conn.tokens + ((now - conn.lastRefill) / 1000) * this.opts.ratePerSec);
    conn.lastRefill = now;
    if (conn.tokens < 1) {
      conn.dropped++;
      if (conn.dropped > this.opts.rateBurst * 4) conn.ws.close(1008, 'rate limit');
      return false;
    }
    conn.tokens -= 1;
    if (conn.dropped > 0) conn.dropped -= 0.01;
    return true;
  }

  send(s: Session, msg: ServerMsg): void {
    if (s.conn) this.sendConn(s.conn, JSON.stringify(msg), false);
  }

  sendRaw(s: Session, data: string, droppable: boolean): boolean {
    return s.conn ? this.sendConn(s.conn, data, droppable) : false;
  }

  private sendConn(c: Conn, data: string, droppable: boolean): boolean {
    if (c.ws.readyState !== WebSocket.OPEN) return false;
    if (droppable && c.ws.bufferedAmount > CONGESTED_BYTES) return false;
    c.ws.send(data);
    return true;
  }

  private onClose(conn: Conn): void {
    if (this.conns.delete(conn)) {
      const n = (this.perIp.get(conn.ip) ?? 1) - 1;
      if (n > 0) this.perIp.set(conn.ip, n);
      else this.perIp.delete(conn.ip);
    }
    const s = conn.session;
    conn.session = null;
    if (!s || s.conn !== conn) return; // never said hello, or replaced by a newer socket
    s.conn = null;
    s.lastSeen = Date.now();
    s.room?.onDisconnect(s);
    this.expedition.onDisconnect(s);
  }

  /** Drop sockets that missed a ping round (dead mobile connections). */
  private heartbeat(): void {
    for (const c of this.conns) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* closing */
      }
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, s] of this.byToken) {
      if (!s.conn && !s.room && !this.expedition.holds(s) && now - s.lastSeen > this.opts.sessionTtlMs) {
        this.byToken.delete(token);
        this.expedition.forget(s);
      }
    }
  }

  // ─────────────────────────── rooms broadcast ───────────────────────────

  roomChanged(room: Room): void {
    if (room.isClosed || room.mode) return; // 원정 rooms: no lobby room info (the queue messages carry the seats)
    const info = room.info();
    for (const m of room.members) this.send(m.session, { t: 'room', room: info });
    this.scheduleRooms();
  }

  roomClosed(room: Room): void {
    if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
    this.scheduleRooms();
  }

  roomList(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(r => !r.isClosed && !r.mode && r.members.length > 0)
      .sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'waiting' ? -1 : 1))
      .slice(0, MAX_LISTED_ROOMS)
      .map(r => r.summary());
  }

  /** 'rooms' to everyone in the lobby (not in a room), coalesced per event-loop turn. */
  private scheduleRooms(): void {
    if (this.roomsDirty) return;
    this.roomsDirty = true;
    setImmediate(() => {
      this.roomsDirty = false;
      const msg = JSON.stringify({ t: 'rooms', rooms: this.roomList() } satisfies ServerMsg);
      for (const c of this.conns) if (c.session && !c.session.room) this.sendConn(c, msg, false);
    });
  }

  // ─────────────────────────── messages ───────────────────────────

  private error(s: Session | Conn, code: Extract<ServerMsg, { t: 'error' }>['code'], message: string): void {
    const msg: ServerMsg = { t: 'error', code, message };
    if ('ws' in s) this.sendConn(s, JSON.stringify(msg), false);
    else this.send(s, msg);
  }

  private handle(conn: Conn, msg: ClientMsg): void {
    if (msg.t === 'ping') {
      this.sendConn(conn, JSON.stringify({ t: 'pong', at: msg.at, serverTime: Date.now() } satisfies ServerMsg), false);
      return;
    }
    if (msg.t === 'hello') {
      this.hello(conn, msg);
      return;
    }
    const s = conn.session;
    if (!s) {
      this.error(conn, 'bad_request', '먼저 hello를 보내 주세요');
      return;
    }
    s.lastSeen = Date.now();
    switch (msg.t) {
      case 'setName': {
        const name = sanitizeName(msg.name);
        if (name) s.name = name;
        this.send(s, { t: 'welcome', v: PROTOCOL_VERSION, sessionId: s.id, token: s.token, name: s.name });
        if (s.room) this.roomChanged(s.room);
        return;
      }
      case 'listRooms':
        this.send(s, { t: 'rooms', rooms: this.roomList() });
        return;
      case 'createRoom': {
        this.expedition.cancel(s);
        if (s.room) this.leave(s, false);
        const code = randomRoomCode(c => this.rooms.has(c));
        // no custom name → "<방장>의 방", following the host (also after a host handoff or rename)
        const room = new Room(code, sanitizeName(msg.roomName, ROOM_NAME_MAX) || null, this, s.id);
        this.rooms.set(code, room);
        room.add(s, msg.preset);
        return;
      }
      case 'joinRoom': {
        const room = this.rooms.get(normalizeRoomCode(msg.code));
        if (!room || room.isClosed || room.mode) return this.error(s, 'room_not_found', '방을 찾을 수 없어요');
        if (room === s.room) return room.setPreset(s, msg.preset);
        if (room.status === 'playing') return this.error(s, 'room_playing', '이미 게임 중인 방이에요');
        if (room.members.length >= MAX_ROOM_PLAYERS) return this.error(s, 'room_full', '방이 가득 찼어요 (최대 3명)');
        this.expedition.cancel(s);
        if (s.room) this.leave(s, false);
        room.add(s, msg.preset);
        return;
      }
      case 'setPreset':
        s.room?.setPreset(s, msg.preset);
        return;
      case 'leaveRoom':
        this.leave(s, true);
        return;
      case 'start': {
        const room = s.room;
        if (!room) return this.error(s, 'not_in_room', '방에 들어가 있지 않아요');
        if (room.hostId !== s.id) return this.error(s, 'not_host', '방장만 시작할 수 있어요');
        if (room.status !== 'waiting') return this.error(s, 'bad_request', '이미 게임 중이에요');
        // every running game costs CPU on this one instance: cap them server-wide
        if (this.playingRooms >= this.opts.maxPlayingRooms) return this.error(s, 'server_busy', '서버가 붐벼요 · 잠시 뒤에 다시 시작해 주세요');
        room.start();
        return;
      }
      case 'cmd': {
        const room = s.room;
        if (!room) {
          this.send(s, { t: 'cmdResult', seq: msg.seq, ok: false, reason: '방에 들어가 있지 않아요' });
          return;
        }
        const r = room.command(s, msg.cmd, msg.atTick);
        if (r === 'leave') {
          this.send(s, { t: 'cmdResult', seq: msg.seq, ok: true });
          this.leave(s, true);
          return;
        }
        this.send(s, r.ok ? { t: 'cmdResult', seq: msg.seq, ok: true } : { t: 'cmdResult', seq: msg.seq, ok: false, reason: r.reason });
        return;
      }
      case 'expQueue':
      case 'expCancel':
      case 'expStartNow':
      case 'expChoice':
        this.expedition.handle(s, msg);
        return;
    }
  }

  private hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (conn.session) return this.error(conn, 'bad_request', '이미 연결됨');
    if (msg.v !== PROTOCOL_VERSION) {
      this.error(conn, 'bad_version', '게임 버전이 달라요 · 페이지를 새로고침해 주세요');
      conn.ws.close(4002, 'bad version');
      return;
    }
    let s = msg.token ? this.byToken.get(msg.token) : undefined;
    if (s?.conn && s.conn !== conn) {
      // same player opened a second socket (reload, second tab): the newest wins
      const old = s.conn;
      old.session = null;
      try {
        old.ws.close(4001, 'replaced');
      } catch {
        /* ignore */
      }
    }
    if (!s) {
      s = { id: randomId(8), token: randomId(16), name: '', conn: null, room: null, lastSeen: Date.now() };
      this.byToken.set(s.token, s);
    }
    s.conn = conn;
    s.lastSeen = Date.now();
    conn.session = s;
    const name = sanitizeName(msg.name);
    if (name) s.name = name;
    else if (!s.name) s.name = `플레이어${++this.nameCounter}`;
    this.send(s, { t: 'welcome', v: PROTOCOL_VERSION, sessionId: s.id, token: s.token, name: s.name });
    if (s.room) s.room.onReconnect(s);
    else {
      this.send(s, { t: 'room', room: null });
      this.send(s, { t: 'rooms', rooms: this.roomList() });
    }
    this.expedition.onReconnect(s);
  }

  /** Error reply (also used by the expedition lobby). */
  sendError(s: Session, code: Extract<ServerMsg, { t: 'error' }>['code'], message: string): void {
    this.error(s, code, message);
  }

  /** 기획 15차 원정: a new hidden room for a launched stage queue (hostId = its first seat). */
  createModeRoom(hostId: string, mode: RoomMode): Room {
    const code = randomRoomCode(c => this.rooms.has(c));
    const room = new Room(code, null, this, hostId, mode);
    this.rooms.set(code, room);
    return room;
  }

  /** Leave the current room (slot → bot if a game runs). */
  leave(s: Session, notify: boolean): void {
    const room = s.room;
    if (room) room.remove(s);
    s.room = null;
    if (notify) {
      this.send(s, { t: 'room', room: null });
      this.send(s, { t: 'rooms', rooms: this.roomList() });
    }
  }

  // ─────────────────────────── shutdown / introspection ───────────────────────────

  get connectionCount(): number {
    return this.conns.size;
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    this.expedition.close();
    for (const r of [...this.rooms.values()]) r.close();
    for (const c of this.conns) {
      try {
        c.ws.close(1001, 'server shutdown');
      } catch {
        /* ignore */
      }
    }
  }
}
