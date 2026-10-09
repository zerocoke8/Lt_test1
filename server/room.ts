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
  /** 기획 15차 원정: a stage queue waits this long (from its first joiner) before bots fill the empty seats. */
  expQueueSec: number;
  /** 기획 15차 원정: stage-clear choice time; then 「수령하고 나가기」 for whoever has not chosen. */
  expChoiceSec: number;
  /** 기획 15차 원정: a full queue shows its final seats (bots included) this long before the game starts. */
  expLaunchMs: number;
  /** 기획 15차 원정: honour the client's debug 「단계 전부 해금」 (start above maxStartStage). Prototype default: on. */
  expDebugUnlock: boolean;
  /**
   * 기획 15차 원정: honour the host's debug / tunables commands in a stage room with another human in it (tests).
   * Off (default): only a room whose one human is the host may use them — a matched stranger never decides a stage.
   */
  expSharedDebug: boolean;
  /**
   * 기획 15차 원정: a stage room with nobody connected keeps running (bots play the seats; the stage ends on its own
   * floor timeouts / boss enrage and is settled as usual). This is only the backstop for a stage that somehow never ends.
   */
  expAbandonMs: number;
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

/**
 * A non-classic room (기획 15차 원정): hidden from the room list, no 'room' broadcasts, every quit is a leave, and the
 * mode decides what a stage clear / a run over / a leaving member means. Classic rooms have none.
 */
export interface RoomMode {
  readonly kind: 'expedition';
  /** After every command and tick, after the classic phase checks. May remove members (the room may close). */
  check(room: Room, g: Game, now: number): void;
  /** A member is leaving (quit, leaveRoom, end of game) — before its slot turns bot. */
  onRemove(room: Room, m: Member): void;
  /** The game stops (run over linger done, nobody connected, sim error) — before the members are dropped. */
  onEnd(room: Room, g: Game, why: EndReason): void;
  /** Server ms of the open stage-clear choice deadline (null = none). */
  choiceDeadline(): number | null;
}

const SHARED_DEBUG_REFUSED = '다른 플레이어가 있는 원정 방에서는 디버그를 쓸 수 없어요';

export type EndReason = 'over' | 'abandoned' | 'error';

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

  /** 기획 15차 원정 rooms (null = classic). */
  readonly mode: RoomMode | null;

  constructor(code: string, name: string | null, host: RoomHost, hostId: string, mode: RoomMode | null = null) {
    this.code = code;
    this.customName = name;
    this.host = host;
    this.hostId = hostId;
    this.mode = mode;
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
    this.mode?.onRemove(this, m);
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

  /** Start the game: classic = members' presets + bots; `given` = a mode's own setup (members in seat order first). */
  start(given?: GameSetup): void {
    if (this.status !== 'waiting' || this.closed) return;
    this.launch(createGame(given ?? this.classicSetup()));
  }

  private classicSetup(): GameSetup {
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
    return { seed: randomSeed(), players: [...humans, ...bots], tunables: { ...DEFAULT_TUNABLES } };
  }

  private launch(game: Game): void {
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
      ...(this.mode ? { mode: this.mode.kind } : null),
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
      case 'expeditionChoice':
        c = { ...cmd, player: pi };
        break;
      case 'debug':
        if (!isHost) return fail('방장만 할 수 있어요');
        if (!this.debugAllowed()) return fail(SHARED_DEBUG_REFUSED);
        c = cmd.action.kind === 'chargeUlt' || cmd.action.kind === 'resetCooldowns' ? { type: 'debug', action: { kind: cmd.action.kind, player: pi } } : cmd;
        break;
      case 'tunables':
        if (!isHost) return fail('방장만 할 수 있어요');
        if (!this.debugAllowed()) return fail(SHARED_DEBUG_REFUSED);
        c = cmd;
        break;
      case 'quit':
        // 기획 15차 원정: nobody ends a matched stage for the others — every quit is a leave (that player's bag is lost)
        if (!isHost || this.mode) return 'leave';
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

  /** 기획 15차 원정: debug / tunables in a mode room only when the host is its one human (or the server allows it). */
  private debugAllowed(): boolean {
    return !this.mode || this.members.length <= 1 || this.host.opts.expSharedDebug;
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
    this.mode?.check(this, g, now);
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
      this.endGame('error');
      return;
    }
    this.collect();
    this.checkPhase();
    if (this.closed || this.game !== g) return; // a mode may have emptied (closed) the room
    if (now - this.lastSnap >= 1000 / this.host.opts.snapshotHz - 2) {
      this.lastSnap = now;
      this.broadcastSnap();
    }
    // nobody connected for a while → stop burning CPU on a bots-only run (원정: the stage plays out — its bag is at stake)
    if (this.members.some(m => !!m.session.conn)) this.abandonSince = null;
    else if (this.abandonSince == null) this.abandonSince = now;
    else if (now - this.abandonSince >= (this.mode ? this.host.opts.expAbandonMs : this.host.opts.abandonMs)) {
      this.endGame('abandoned');
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
    const over = g.state.phase === 'runOver' || g.state.phase === 'stageClear';
    const telemetry = over ? `,"telemetry":${wireJson(g.telemetry(m.playerIndex))}` : '';
    const choiceDeadline = this.mode?.choiceDeadline();
    const choice = choiceDeadline != null ? `,"choiceDeadline":${choiceDeadline}` : '';
    const tunables = tunablesJson != null ? `,"tunables":${tunablesJson}` : '';
    // null outside the room: a disconnect can start the next floor before the next tick's checkGoedam clears it
    const goedamDeadline = g.state.phase === 'goedam' ? this.goedamDeadline : null;
    return (
      `{"t":"snap","tick":${g.state.tick},"serverTime":${Date.now()},"state":${stateJson},"events":${eventsJson}` +
      `${tunables},"hostPlayerIndex":${this.hostPlayerIndex},"rewardDeadline":${this.rewardDeadline ?? 'null'}` +
      `,"goedamDeadline":${goedamDeadline ?? 'null'}${telemetry}${choice}}`
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

  /**
   * Run finished (or abandoned): back to 'waiting'; members who never came back are removed. A mode room (원정) settles
   * its members first and then closes: every stage is its own game.
   */
  endGame(why: EndReason = 'over'): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    if (!this.game) return;
    this.mode?.onEnd(this, this.game, why);
    for (const m of this.members) if (m.session.conn) this.host.send(m.session, { t: 'gameEnded' });
    this.game = null;
    this.events = [];
    this.status = 'waiting';
    this.rewardDeadline = null;
    this.goedamDeadline = null;
    this.endAt = null;
    this.abandonSince = null;
    for (const m of this.members) m.playerIndex = null;
    const gone = this.mode ? [...this.members] : this.members.filter(m => !m.session.conn);
    for (const m of gone) {
      if (this.closed) return;
      this.remove(m.session);
    }
    if (!this.closed) this.host.roomChanged(this);
  }

  /** One member's game is over (a mode room's member leaving before the others). */
  endFor(m: Member): void {
    if (m.session.conn) this.host.send(m.session, { t: 'gameEnded' });
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
