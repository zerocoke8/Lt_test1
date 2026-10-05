// One room: members (join order = slot order), host, and while playing the authoritative sim (src/sim) on a
// real-time loop. Snapshots go out at SNAPSHOT_HZ; commands come in from the hub with the sender's slot forced.

import type { WebSocket } from 'ws';
import type { PresetChoice, RoomInfo, RoomSummary, ServerMsg } from '../src/net/protocol';
import { MAX_COMMAND_AGE_MS, MAX_ROOM_PLAYERS } from '../src/net/protocol';
import type { Command, CommandResult, Game, GameEvent, GameSetup, PlayerSetup } from '../src/types';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../src/config';
import { createGame, goedamTimeoutCommands } from '../src/sim';
import { wireJson } from './snapshot';
import { randomSeed } from './util';

export interface ServerOptions {
  port: number;
  host: string;
  /** Folder with the built client (dist/). */
  staticDir: string;
  tickHz: number;
  snapshotHz: number;
  /** R33: real seconds before unchosen rewards are picked at random. */
  rewardTimeoutSec: number;
  /** 기획 10차: real seconds for a 괴담 room (fresh when it opens) before it is finished for whoever is still in it. */
  goedamTimeoutSec: number;
  /** Snapshots keep flowing this long after runOver, then 'gameEnded'. */
  endLingerMs: number;
  /** Waiting room: a dropped member keeps the seat this long (page reload). */
  lobbyGraceMs: number;
  /** Playing room with nobody connected for this long → game ends, room closes. */
  abandonMs: number;
  /** Ping round: a socket that did not answer the previous ping (or send anything) is dropped → its slot goes to a bot. */
  heartbeatMs: number;
  /** A swap/pet whose `atTick` snapshot was sent longer ago than this is refused as stale (stalled link). */
  maxCommandAgeMs: number;
  /** Server-wide limits (one free instance): open sockets, sockets per client address, games running at once. */
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxPlayingRooms: number;
  /**
   * Behind a reverse proxy: true (Render) = first X-Forwarded-For entry;
   * 'fly' (Fly.io) = the Fly-Client-IP header, which Fly's proxy sets itself (clients can't forge it).
   */
  trustProxy: boolean | 'fly';
  /** Hard cap per incoming frame (ws maxPayload). */
  maxMessageBytes: number;
  /** Token bucket per connection. */
  ratePerSec: number;
  rateBurst: number;
  /** Idle sessions (no socket, no room) are forgotten after this. */
  sessionTtlMs: number;
  /** Log snapshot sizes etc. */
  debug: boolean;
  log(msg: string): void;
}

export interface Conn {
  ws: WebSocket;
  /** Client address (per-IP limit). */
  ip: string;
  session: Session | null;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  dropped: number;
}

export interface Session {
  id: string;
  token: string;
  name: string;
  conn: Conn | null;
  room: Room | null;
  lastSeen: number;
}

export interface Member {
  session: Session;
  preset: PresetChoice;
  /** PlayerState index in the running game (null while waiting). */
  playerIndex: number | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/** What a room needs from the hub. */
export interface RoomHost {
  readonly opts: ServerOptions;
  send(s: Session, msg: ServerMsg): void;
  /** Pre-serialized frame; returns false when skipped (closed or congested socket). */
  sendRaw(s: Session, data: string, droppable: boolean): boolean;
  roomChanged(room: Room): void;
  roomClosed(room: Room): void;
}

/** Unchanged tunables are re-sent this often (snapshots) so a late or clamped value always reaches the host's panel. */
const TUNABLES_EVERY = 15;
/** Snapshot send times remembered for the stale-command check (≈10 s at 15 Hz). */
const SENT_TICKS_KEPT = 160;

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

export class Room {
  readonly code: string;
  /** Custom room name; null = "<host>의 방". */
  private readonly customName: string | null;
  readonly createdAt = Date.now();
  status: 'waiting' | 'playing' = 'waiting';
  readonly members: Member[] = [];
  hostId: string;
  game: Game | null = null;
  rewardDeadline: number | null = null;
  /** 기획 10차: server ms when the open 괴담 room is auto-finished (null outside phase 'goedam'). */
  goedamDeadline: number | null = null;
  private readonly host: RoomHost;
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastStep = 0;
  private lastSnap = 0;
  private events: GameEvent[] = [];
  private rewardFloor = -1;
  private endAt: number | null = null;
  private abandonSince: number | null = null;
  private closed = false;
  // debug stats
  private snapBytes = 0;
  private snapCount = 0;
  private snapMax = 0;
  private statsAt = 0;
  /** Snapshots broadcast this game; tunables ride along when changed and on every TUNABLES_EVERY-th one. */
  private snapSeq = 0;
  private lastTunablesJson = '';
  /** (tick, Date.now()) of recent snapshots, oldest first: how old the snapshot a command was based on is. */
  private readonly sentTicks: { tick: number; at: number }[] = [];

  constructor(code: string, name: string | null, host: RoomHost, hostId: string) {
    this.code = code;
    this.customName = name;
    this.host = host;
    this.hostId = hostId;
  }

  // ─────────────────────────── membership ───────────────────────────

  member(sessionId: string): Member | undefined {
    return this.members.find(m => m.session.id === sessionId);
  }

  get hostMember(): Member | undefined {
    return this.member(this.hostId);
  }

  get name(): string {
    return this.customName ?? `${this.hostMember?.session.name ?? ''}의 방`;
  }

  get hostPlayerIndex(): number {
    return this.hostMember?.playerIndex ?? -1;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      name: this.name,
      status: this.status,
      members: this.members.map(m => ({
        id: m.session.id,
        name: m.session.name,
        isHost: m.session.id === this.hostId,
        connected: !!m.session.conn,
        preset: { characters: [...m.preset.characters], pets: [...m.preset.pets] },
      })),
      max: MAX_ROOM_PLAYERS,
    };
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      name: this.name,
      hostName: this.hostMember?.session.name ?? '',
      players: this.members.length,
      max: MAX_ROOM_PLAYERS,
      status: this.status,
    };
  }

  add(s: Session, preset: PresetChoice): void {
    this.members.push({ session: s, preset, playerIndex: null, graceTimer: null });
    s.room = this;
    this.host.roomChanged(this);
  }

  setPreset(s: Session, preset: PresetChoice): void {
    const m = this.member(s.id);
    if (!m) return;
    m.preset = preset;
    this.host.roomChanged(this);
  }

  /** Leave (or get dropped). In a running game the slot is handed to a bot for the rest of the run. */
  remove(s: Session): void {
    const i = this.members.findIndex(m => m.session.id === s.id);
    if (i < 0) return;
    const [m] = this.members.splice(i, 1);
    if (m.graceTimer) clearTimeout(m.graceTimer);
    if (s.room === this) s.room = null;
    if (this.game && m.playerIndex != null) this.game.setPlayerBot(m.playerIndex, true);
    if (this.hostId === s.id) {
      const next = this.members.find(x => !!x.session.conn) ?? this.members[0];
      if (next) this.hostId = next.session.id;
    }
    if (this.members.length === 0) {
      this.close();
      return;
    }
    this.host.roomChanged(this);
  }

  /** Socket dropped (R34). In game → bot takes the slot; waiting → seat kept for lobbyGraceMs. */
  onDisconnect(s: Session): void {
    const m = this.member(s.id);
    if (!m) return;
    if (this.status === 'playing' && this.game && m.playerIndex != null) {
      this.game.setPlayerBot(m.playerIndex, true);
    } else {
      if (m.graceTimer) clearTimeout(m.graceTimer);
      m.graceTimer = setTimeout(() => {
        m.graceTimer = null;
        if (!s.conn && s.room === this) this.remove(s);
      }, this.host.opts.lobbyGraceMs);
    }
    this.host.roomChanged(this);
  }

  /** Same token is back: reattach to the seat (and to the running game). */
  onReconnect(s: Session): void {
    const m = this.member(s.id);
    if (!m) return;
    if (m.graceTimer) {
      clearTimeout(m.graceTimer);
      m.graceTimer = null;
    }
    this.host.roomChanged(this);
    if (this.status === 'playing' && this.game && m.playerIndex != null) {
      this.game.setPlayerBot(m.playerIndex, false);
      this.sendStart(m);
      this.sendSnap(m, '[]');
    }
  }

  // ─────────────────────────── game ───────────────────────────

  start(): void {
    if (this.status !== 'waiting' || this.closed) return;
    const humans: PlayerSetup[] = this.members.map(m => ({
      name: m.session.name,
      isBot: false,
      characters: [...m.preset.characters],
      pets: [...m.preset.pets],
    }));
    const bots: PlayerSetup[] = BOT_PRESETS.slice(0, Math.max(0, MAX_ROOM_PLAYERS - humans.length)).map(b => ({
      name: b.name,
      isBot: true,
      characters: [...b.characters],
      pets: [...b.pets],
    }));
    const setup: GameSetup = { seed: randomSeed(), players: [...humans, ...bots], tunables: { ...DEFAULT_TUNABLES } };
    const game = createGame(setup);
    this.game = game;
    this.events = game.drainEvents();
    this.status = 'playing';
    this.rewardDeadline = null;
    this.rewardFloor = -1;
    this.goedamDeadline = null;
    this.endAt = null;
    this.abandonSince = null;
    this.snapSeq = 0;
    this.lastTunablesJson = '';
    this.sentTicks.length = 0;
    this.members.forEach((m, i) => {
      m.playerIndex = i;
      if (m.graceTimer) {
        clearTimeout(m.graceTimer);
        m.graceTimer = null;
      }
      if (!m.session.conn) game.setPlayerBot(i, true);
    });
    this.host.roomChanged(this);
    for (const m of this.members) this.sendStart(m);
    this.lastStep = performance.now();
    this.lastSnap = this.lastStep;
    this.statsAt = this.lastStep;
    this.broadcastSnap();
    this.loop = setInterval(() => this.tick(), 1000 / this.host.opts.tickHz);
  }

  private sendStart(m: Member): void {
    if (!this.game || m.playerIndex == null) return;
    this.host.send(m.session, {
      t: 'start',
      playerIndex: m.playerIndex,
      hostPlayerIndex: this.hostPlayerIndex,
      seed: this.game.state.seed,
      tunables: { ...this.game.tunables },
    });
  }

  /**
   * In-game command from a member. 'leave' = non-host quit: the hub removes the sender from the room.
   * `atTick` = the newest snapshot the client had: a swap/pet aimed at a picture older than maxCommandAgeMs (a stalled
   * link delivering it seconds late) is refused rather than applied at an outdated spot.
   */
  command(s: Session, cmd: Command, atTick?: number): CommandResult | 'leave' {
    const m = this.member(s.id);
    const g = this.game;
    if (!m || !g || m.playerIndex == null || this.status !== 'playing') return fail('게임 중이 아님');
    const pi = m.playerIndex;
    const isHost = s.id === this.hostId;
    let c: Command;
    switch (cmd.type) {
      case 'swap':
      case 'pet':
        if (atTick != null && this.commandAgeMs(atTick) > this.host.opts.maxCommandAgeMs) return fail('연결이 늦어 취소됐어요');
        c = { ...cmd, player: pi };
        break;
      case 'ult':
      case 'chooseReward':
      case 'goedam':
        c = { ...cmd, player: pi };
        break;
      case 'debug':
        if (!isHost) return fail('방장만 할 수 있어요');
        c = cmd.action.kind === 'chargeUlt' || cmd.action.kind === 'resetCooldowns' ? { type: 'debug', action: { kind: cmd.action.kind, player: pi } } : cmd;
        break;
      case 'tunables':
        if (!isHost) return fail('방장만 할 수 있어요');
        c = cmd;
        break;
      case 'quit':
        if (!isHost) return 'leave';
        c = cmd;
        break;
      default:
        return fail('알 수 없는 명령');
    }
    const r = g.dispatch(c);
    this.collect();
    this.checkPhase();
    return r.ok ? ok : r;
  }

  /** How long ago (ms) the snapshot at `tick` went out; unknown or older than the kept window = Infinity. */
  commandAgeMs(tick: number): number {
    const list = this.sentTicks;
    if (!list.length) return 0;
    // the newest snapshot at or before that tick (ticks only grow; a future tick counts as fresh)
    for (let i = list.length - 1; i >= 0; i--) if (list[i].tick <= tick) return Math.max(0, Date.now() - list[i].at);
    return Infinity;
  }

  private noteSent(tick: number): void {
    const list = this.sentTicks;
    const last = list[list.length - 1];
    if (last && last.tick === tick) last.at = Date.now();
    else list.push({ tick, at: Date.now() });
    if (list.length > SENT_TICKS_KEPT) list.splice(0, list.length - SENT_TICKS_KEPT);
  }

  private collect(): void {
    if (!this.game) return;
    const evs = this.game.drainEvents();
    if (evs.length) {
      for (const e of evs) this.events.push(e);
      // a stalled room never grows without bound
      if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000);
    }
  }

  private checkPhase(): void {
    const g = this.game;
    if (!g) return;
    const now = Date.now();
    this.checkReward(g, now);
    // after the reward check: the last pick (or the reward timeout) may have just opened the room
    this.checkGoedam(g, now);
    if (g.state.phase === 'runOver' && this.endAt == null) this.endAt = now + this.host.opts.endLingerMs;
  }

  private checkReward(g: Game, now: number): void {
    const s = g.state;
    if (s.phase === 'reward') {
      if (this.rewardDeadline == null || this.rewardFloor !== s.floor) {
        this.rewardFloor = s.floor;
        this.rewardDeadline = now + this.host.opts.rewardTimeoutSec * 1000;
      } else if (now >= this.rewardDeadline) {
        // R33: whoever has not chosen gets a random pick
        s.rewardOffersByPlayer.forEach((offers, i) => {
          if (offers && offers.length) g.dispatch({ type: 'chooseReward', player: i, offerIndex: Math.floor(Math.random() * offers.length) });
        });
        this.collect();
        if (g.state.phase !== 'reward') this.rewardDeadline = null;
      }
    } else {
      this.rewardDeadline = null;
      this.rewardFloor = -1;
    }
  }

  /**
   * 기획 10차: the 괴담 room gets its own deadline, started fresh when the room opens (nothing carried over from the
   * reward phase). When it passes: 'leave' for whoever has not chosen (never a gamble), 'continue' for whoever is
   * reading a result; the last of these starts the next floor. Disconnected slots were already resolved by the sim.
   */
  private checkGoedam(g: Game, now: number): void {
    if (g.state.phase !== 'goedam') {
      this.goedamDeadline = null;
      return;
    }
    if (this.goedamDeadline == null) {
      this.goedamDeadline = now + this.host.opts.goedamTimeoutSec * 1000;
      return;
    }
    if (now < this.goedamDeadline) return;
    for (const c of goedamTimeoutCommands(g.state)) g.dispatch(c);
    this.collect();
    if (g.state.phase !== 'goedam') this.goedamDeadline = null;
  }

  private tick(): void {
    const g = this.game;
    if (!g || this.closed) return;
    const now = performance.now();
    const dt = (now - this.lastStep) / 1000;
    this.lastStep = now;
    try {
      g.step(dt);
    } catch (err) {
      this.host.opts.log(`[room ${this.code}] sim error: ${(err as Error)?.stack ?? err}`);
      this.endGame();
      return;
    }
    this.collect();
    this.checkPhase();
    if (now - this.lastSnap >= 1000 / this.host.opts.snapshotHz - 2) {
      this.lastSnap = now;
      this.broadcastSnap();
    }
    // nobody connected for a while → stop burning CPU on a bots-only run
    if (this.members.some(m => !!m.session.conn)) this.abandonSince = null;
    else if (this.abandonSince == null) this.abandonSince = now;
    else if (now - this.abandonSince >= this.host.opts.abandonMs) {
      this.endGame();
      return;
    }
    if (this.endAt != null && Date.now() >= this.endAt) this.endGame();
  }

  /**
   * One member's snapshot frame. `tunablesJson` null = unchanged (omitted). Telemetry (the result screen's tuning log)
   * is computed and sent only once the run is over.
   */
  private snapJson(m: Member, stateJson: string, eventsJson: string, tunablesJson: string | null): string | null {
    const g = this.game;
    if (!g || m.playerIndex == null) return null;
    const telemetry = g.state.phase === 'runOver' ? `,"telemetry":${wireJson(g.telemetry(m.playerIndex))}` : '';
    const tunables = tunablesJson != null ? `,"tunables":${tunablesJson}` : '';
    return (
      `{"t":"snap","tick":${g.state.tick},"serverTime":${Date.now()},"state":${stateJson},"events":${eventsJson}` +
      `${tunables},"hostPlayerIndex":${this.hostPlayerIndex},"rewardDeadline":${this.rewardDeadline ?? 'null'}` +
      `,"goedamDeadline":${this.goedamDeadline ?? 'null'}${telemetry}}`
    );
  }

  private broadcastSnap(): void {
    const g = this.game;
    if (!g) return;
    const stateJson = wireJson(g.state);
    const eventsJson = wireJson(this.events);
    this.events = [];
    const tj = JSON.stringify(g.tunables);
    const tunablesJson = tj !== this.lastTunablesJson || this.snapSeq % TUNABLES_EVERY === 0 ? tj : null;
    this.lastTunablesJson = tj;
    this.snapSeq++;
    this.noteSent(g.state.tick);
    let bytes = 0;
    for (const m of this.members) {
      if (!m.session.conn) continue;
      const msg = this.snapJson(m, stateJson, eventsJson, tunablesJson);
      if (!msg) continue;
      // a congested client skips snapshots (the next one carries the full state anyway; events are cosmetic)
      if (this.host.sendRaw(m.session, msg, true)) bytes = Math.max(bytes, Buffer.byteLength(msg));
    }
    if (this.host.opts.debug && bytes > 0) {
      this.snapBytes += bytes;
      this.snapCount++;
      this.snapMax = Math.max(this.snapMax, bytes);
      const now = performance.now();
      if (now - this.statsAt >= 5000) {
        const avg = this.snapBytes / Math.max(1, this.snapCount);
        this.host.opts.log(
          `[room ${this.code}] snapshot avg ${(avg / 1024).toFixed(1)} KB, max ${(this.snapMax / 1024).toFixed(1)} KB (raw JSON, before deflate), ` +
            `${g.state.entities.length} entities, ~${((avg * this.host.opts.snapshotHz) / 1024).toFixed(0)} KB/s per client`,
        );
        this.snapBytes = 0;
        this.snapCount = 0;
        this.snapMax = 0;
        this.statsAt = now;
      }
    }
  }

  /** One member only (reconnect): current state, no events. */
  private sendSnap(m: Member, eventsJson: string): void {
    const g = this.game;
    if (!g) return;
    const msg = this.snapJson(m, wireJson(g.state), eventsJson, JSON.stringify(g.tunables));
    if (!msg) return;
    this.noteSent(g.state.tick);
    this.host.sendRaw(m.session, msg, false);
  }

  /** Run finished (or abandoned): back to 'waiting'; members who never came back are removed. */
  endGame(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    if (!this.game) return;
    for (const m of this.members) if (m.session.conn) this.host.send(m.session, { t: 'gameEnded' });
    this.game = null;
    this.events = [];
    this.status = 'waiting';
    this.rewardDeadline = null;
    this.goedamDeadline = null;
    this.endAt = null;
    this.abandonSince = null;
    for (const m of this.members) m.playerIndex = null;
    const gone = this.members.filter(m => !m.session.conn);
    for (const m of gone) {
      if (this.closed) return;
      this.remove(m.session);
    }
    if (!this.closed) this.host.roomChanged(this);
  }

  /** Room deleted (empty or server shutdown). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.game = null;
    for (const m of this.members) {
      if (m.graceTimer) clearTimeout(m.graceTimer);
      if (m.session.room === this) m.session.room = null;
    }
    this.members.length = 0;
    this.host.roomClosed(this);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
