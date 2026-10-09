// 기획 15차 원정 on the server (docs/expedition.md 7장 · 10장): per-stage matchmaking queues (max 3; expQueueSec after
// the first joiner, or 「바로 출발」, bots fill the empty seats) and one hidden Room per stage game.
// 기획 16차: a stage is one floor and every stage ends in the player's own 원정 lobby, so the run lives in the browser.
// The server holds a run only while it is queued / playing (checked at the join with runJoinProblem, one live stage
// per run id) and answers each player with ONE expStageResult — kept by run id for opts.expResultKeepMs and sent again
// after a reconnect or on expStatus. Nothing is ever claimed here (「수령」 is the client's stash).
//
// Flow per player: expQueue {run} → (queue) → room game → 'stageClear' / 'runOver' / leave → expStageResult
//   cleared (loot, carry, bossClear) | failed (reason; the bag is lost) | void (server error before the clear).
// A quit / drop after the combat was won is still a clear (its reward is picked at random, its room passed).

import type { ClientMsg, ExpResultReason, ExpRunInfo, ExpSeatInfo, PresetChoice, ServerMsg } from '../src/net/protocol';
import { MAX_ROOM_PLAYERS } from '../src/net/protocol';
import type { Game, RunResult } from '../src/types';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../src/config';
import { botLoadout, cleanPartyGear, maxStartStage, type GearLoadout } from '../src/data/gear';
import { isBossStage } from '../src/data/stages';
import { extractCarry } from '../src/sim';
import { runFromJoin, stageGameSetup, type ExpeditionRun, type RunSeat } from '../src/expedition/run';
import { runJoinProblem } from '../src/expedition/runCheck';
import type { EndReason, Member, Room, RoomMode, ServerOptions, Session } from './room';
import { randomId, randomSeed } from './util';

/** A full server (maxPlayingRooms) retries a launch this often. */
const BUSY_RETRY_MS = 2000;

type Timer = ReturnType<typeof setTimeout>;
type ErrorCode = Extract<ServerMsg, { t: 'error' }>['code'];
type ResultMsg = Extract<ServerMsg, { t: 'expStageResult' }>;

/** What the lobby needs from the hub. */
export interface ExpeditionHost {
  readonly opts: ServerOptions;
  readonly playingRooms: number;
  send(s: Session, msg: ServerMsg): void;
  sendError(s: Session, code: ErrorCode, message: string): void;
  leave(s: Session, notify: boolean): void;
  createModeRoom(hostId: string, mode: RoomMode): Room;
}

/** One player's run while it is queued or playing a stage (the validated join). */
interface Runner {
  session: Session;
  run: ExpeditionRun;
  preset: PresetChoice;
  /** Boss stages this player has cleared once (stash record at the join + this run's). */
  firstBossClears: Set<number>;
  queue: StageQueue | null;
  /** Queued while offline: dropped after lobbyGraceMs. */
  graceTimer: Timer | null;
}

interface StageQueue {
  stage: number;
  runners: Runner[];
  /** Server ms when bots fill the empty seats. */
  deadline: number;
  timer: Timer | null;
  /** Seats are final (bots shown); the game starts after expLaunchMs. No longer joinable. */
  launching: boolean;
}

const FAIL_REASON: Record<RunResult['reason'], ExpResultReason> = { wipe: 'wipe', timeout: 'timeout', quit: 'quit', cleared: 'abandon' };

export class ExpeditionLobby {
  private readonly host: ExpeditionHost;
  /** Session id → its run being queued / played. */
  private readonly runners = new Map<string, Runner>();
  /** Run id → session id of the run being queued / played (one live stage per run: a second tab gets 'run_busy'). */
  private readonly activeRuns = new Map<string, string>();
  /** Run id → its last stage result (re-sent after a reconnect / on expStatus), pruned after opts.expResultKeepMs. */
  private readonly results = new Map<string, { msg: ResultMsg; at: number }>();
  /** Session id → run ids whose result could not be sent (offline): sent on the reconnect. */
  private readonly undelivered = new Map<string, Set<string>>();
  /** Session ids whose queue was dropped while they were offline: told with expCancelled on the reconnect. */
  private readonly lostQueue = new Set<string>();
  /** Open (joinable) queue per stage. */
  private readonly queues = new Map<number, StageQueue>();

  constructor(host: ExpeditionHost) {
    this.host = host;
  }

  // ─────────────────────────── messages ───────────────────────────

  handle(s: Session, msg: Extract<ClientMsg, { t: 'expQueue' | 'expCancel' | 'expStartNow' | 'expStatus' }>): void {
    switch (msg.t) {
      case 'expQueue':
        return this.join(s, msg);
      case 'expCancel':
        return this.cancelAsked(s);
      case 'expStartNow': {
        const q = this.runners.get(s.id)?.queue;
        if (q && !q.launching) this.launch(q);
        return;
      }
      case 'expStatus':
        return this.status(s, msg.runId, msg.stage);
    }
  }

  /**
   * expQueue: the run (fresh or continuing) joins the queue of its next stage. Checked here: the gear's shape, the
   * start-stage rule ('stage_locked'), the run itself (runJoinProblem → 'bad_run') and that the run is not live in
   * another tab ('run_busy').
   */
  private join(s: Session, msg: Extract<ClientMsg, { t: 'expQueue' }>): void {
    if (this.runners.has(s.id)) return this.host.sendError(s, 'bad_request', '이미 원정 중이에요');
    const gear = cleanPartyGear(msg.gear, 3);
    if (!gear) return this.host.sendError(s, 'bad_gear', '장비 정보가 잘못됐어요');
    const debugOk = !!msg.debugUnlock && this.host.opts.expDebugUnlock;
    const max = maxStartStage(gear);
    if ((msg.run == null || msg.run.cleared === 0) && msg.stage > max && !debugOk) {
      return this.host.sendError(s, 'stage_locked', `지금 장비로는 ${max}단계까지 시작할 수 있어요`);
    }
    if (runJoinProblem(msg.run, msg.stage, gear, debugOk)) return this.host.sendError(s, 'bad_run', '원정 기록이 이상해서 출발할 수 없어요');
    const info: ExpRunInfo = msg.run ?? { id: randomId(8), startStage: msg.stage, cleared: 0, bag: [], carry: null, bossClears: [] };
    if (this.activeRuns.has(info.id)) return this.host.sendError(s, 'run_busy', '다른 창에서 이미 진행 중이에요');
    if (s.room) this.host.leave(s, false);
    const preset = { characters: [...msg.characters], pets: [...msg.pets] };
    const r: Runner = {
      session: s,
      run: runFromJoin(info, { ...preset, gear }),
      preset,
      firstBossClears: new Set([...msg.firstBossClears, ...info.bossClears]),
      queue: null,
      graceTimer: null,
    };
    this.runners.set(s.id, r);
    this.activeRuns.set(info.id, s.id);
    this.enqueue(r);
  }

  /** Leave the queue (expCancel, a classic room instead, or the offline grace ran out). Never claims anything. */
  cancel(s: Session): void {
    const r = this.runners.get(s.id);
    if (!r?.queue) return;
    this.leaveQueue(r);
    this.dropRunner(r);
    if (s.conn) this.host.send(s, { t: 'expCancelled' });
    else this.lostQueue.add(s.id);
  }

  /**
   * expCancel. Nothing queued here (dropped after the offline grace, a restarted server) is answered too, so the client
   * never waits on its match screen; a session playing a stage game gets nothing (its result comes instead).
   */
  private cancelAsked(s: Session): void {
    const r = this.runners.get(s.id);
    if (r?.queue) return this.cancel(s);
    if (!r) this.host.send(s, { t: 'expCancelled' });
  }

  /**
   * expStatus: the run's stored result, else expNoStage (unless that run is still queued / played here). With `stage`,
   * a stored result of another (older) stage counts as none — a run that is waiting for stage N never gets stuck on
   * stage N − 1's result.
   */
  private status(s: Session, runId: string, stage?: number): void {
    this.prune();
    const res = this.results.get(runId);
    if (res && (stage == null || res.msg.stage === stage)) return this.host.send(s, res.msg);
    if (!this.activeRuns.has(runId)) this.host.send(s, { t: 'expNoStage', runId });
  }

  // ─────────────────────────── connection ───────────────────────────

  onDisconnect(s: Session): void {
    const r = this.runners.get(s.id);
    if (!r?.queue) return; // in a stage game: the room hands the seat to a bot
    if (r.graceTimer) clearTimeout(r.graceTimer);
    r.graceTimer = setTimeout(() => {
      r.graceTimer = null;
      if (!s.conn) this.cancel(s);
    }, this.host.opts.lobbyGraceMs);
  }

  /** Same token is back: the queue view again, then any result that waited. */
  onReconnect(s: Session): void {
    const r = this.runners.get(s.id);
    if (r?.graceTimer) {
      clearTimeout(r.graceTimer);
      r.graceTimer = null;
    }
    if (r?.queue) this.sendQueue(r.queue, r);
    // its queue was dropped while it was away (lobbyGraceMs): the match screen goes back to the lobby
    if (this.lostQueue.delete(s.id) && !r) this.host.send(s, { t: 'expCancelled' });
    const ids = this.undelivered.get(s.id);
    if (!ids) return;
    this.undelivered.delete(s.id);
    this.prune();
    for (const id of ids) {
      const res = this.results.get(id);
      if (res) this.host.send(s, res.msg);
    }
  }

  /** The hub forgets an idle session: its undelivered list goes (the results stay for expStatus by run id). */
  forget(s: Session): void {
    this.undelivered.delete(s.id);
    this.lostQueue.delete(s.id);
  }

  /** Is this session queued or playing a stage (the hub keeps it alive)? */
  holds(s: Session): boolean {
    return this.runners.has(s.id);
  }

  close(): void {
    for (const q of this.queues.values()) if (q.timer) clearTimeout(q.timer);
    for (const r of this.runners.values()) {
      if (r.graceTimer) clearTimeout(r.graceTimer);
      if (r.queue?.timer) clearTimeout(r.queue.timer);
    }
    this.queues.clear();
    this.runners.clear();
    this.activeRuns.clear();
    this.results.clear();
    this.undelivered.clear();
    this.lostQueue.clear();
  }

  private dropRunner(r: Runner): void {
    if (r.graceTimer) clearTimeout(r.graceTimer);
    r.graceTimer = null;
    if (this.runners.get(r.session.id) === r) this.runners.delete(r.session.id);
    if (this.activeRuns.get(r.run.id) === r.session.id) this.activeRuns.delete(r.run.id);
  }

  private prune(): void {
    const old = Date.now() - this.host.opts.expResultKeepMs;
    for (const [id, x] of this.results) if (x.at < old) this.results.delete(id);
  }

  // ─────────────────────────── queues ───────────────────────────

  private enqueue(r: Runner): void {
    const stage = r.run.stage;
    let q = this.queues.get(stage);
    if (!q) {
      const ms = Math.max(0, this.host.opts.expQueueSec * 1000);
      const fresh: StageQueue = { stage, runners: [], deadline: Date.now() + ms, timer: null, launching: false };
      fresh.timer = setTimeout(() => this.launch(fresh), ms);
      this.queues.set(stage, fresh);
      q = fresh;
    }
    q.runners.push(r);
    r.queue = q;
    if (q.runners.length >= MAX_ROOM_PLAYERS) this.launch(q);
    else this.broadcastQueue(q);
  }

  private leaveQueue(r: Runner): void {
    const q = r.queue;
    r.queue = null;
    if (r.graceTimer) clearTimeout(r.graceTimer);
    r.graceTimer = null;
    if (!q) return;
    const i = q.runners.indexOf(r);
    if (i >= 0) q.runners.splice(i, 1);
    if (q.runners.length === 0 && !q.launching) {
      if (q.timer) clearTimeout(q.timer);
      q.timer = null;
      if (this.queues.get(q.stage) === q) this.queues.delete(q.stage);
      return;
    }
    this.broadcastQueue(q);
  }

  /** Full, timed out or 「바로 출발」: seats final (bots shown), the game starts after expLaunchMs. */
  private launch(q: StageQueue): void {
    if (q.launching) return;
    if (q.timer) clearTimeout(q.timer);
    q.timer = null;
    if (!q.runners.length) {
      if (this.queues.get(q.stage) === q) this.queues.delete(q.stage);
      return;
    }
    if (this.host.playingRooms >= this.host.opts.maxPlayingRooms) {
      // every running game costs CPU on this one instance: wait (the queue stays joinable) and try again
      for (const r of q.runners) this.host.sendError(r.session, 'server_busy', '서버가 붐벼요 · 잠시 뒤에 자동으로 출발해요');
      q.deadline = Date.now() + BUSY_RETRY_MS;
      q.timer = setTimeout(() => this.launch(q), BUSY_RETRY_MS);
      this.broadcastQueue(q);
      return;
    }
    q.launching = true;
    if (this.queues.get(q.stage) === q) this.queues.delete(q.stage);
    this.broadcastQueue(q);
    if (this.host.opts.expLaunchMs <= 0) this.startStage(q);
    else q.timer = setTimeout(() => this.startStage(q), this.host.opts.expLaunchMs);
  }

  /** One stage game: a hidden room with the queued players in seat order, bots in the rest. */
  private startStage(q: StageQueue): void {
    q.timer = null;
    const runners = q.runners.filter(r => r.queue === q);
    if (!runners.length) return;
    const mode = new ExpeditionRoomMode(this, runners);
    const room = this.host.createModeRoom(runners[0].session.id, mode);
    for (const r of runners) {
      r.queue = null;
      if (r.graceTimer) clearTimeout(r.graceTimer);
      r.graceTimer = null;
      if (r.session.room) this.host.leave(r.session, false);
      room.add(r.session, r.preset);
    }
    const seats: RunSeat[] = runners.map(r => ({
      name: r.session.name,
      run: r.run,
      firstBossClear: isBossStage(q.stage) && !r.firstBossClears.has(q.stage),
    }));
    room.start(stageGameSetup(seats, { ...DEFAULT_TUNABLES }, MAX_ROOM_PLAYERS, randomSeed()));
  }

  private seatInfos(q: StageQueue): ExpSeatInfo[] {
    const seats: ExpSeatInfo[] = q.runners.map(r => ({
      name: r.session.name,
      characters: [...r.preset.characters],
      pets: [...r.preset.pets],
      gear: r.run.lock.gear.map(l => ({ ...l })),
      isBot: false,
      continuing: r.run.cleared > 0,
      buffs: r.run.carry?.rewards.length ?? 0,
    }));
    if (!q.launching) return seats;
    const bot = botLoadout(q.stage);
    const botGear = (): GearLoadout[] => (Object.keys(bot).length ? [0, 1, 2].map(() => ({ ...bot })) : []);
    for (let i = 0; seats.length < MAX_ROOM_PLAYERS; i++) {
      const b = BOT_PRESETS[i % BOT_PRESETS.length];
      seats.push({ name: b.name, characters: [...b.characters], pets: [...b.pets], gear: botGear(), isBot: true, continuing: false, buffs: 0 });
    }
    return seats;
  }

  private broadcastQueue(q: StageQueue): void {
    const seats = this.seatInfos(q);
    for (const r of q.runners) this.sendQueue(q, r, seats);
  }

  private sendQueue(q: StageQueue, r: Runner, seats = this.seatInfos(q)): void {
    this.host.send(r.session, {
      t: 'expQueueState',
      stage: q.stage,
      seats,
      you: q.runners.indexOf(r),
      secondsLeft: q.launching ? 0 : Math.max(0, Math.ceil((q.deadline - Date.now()) / 1000)),
      deadline: q.deadline,
      launching: q.launching,
      continuing: r.run.cleared > 0,
      bagCount: r.run.bag.length,
    });
  }

  // ─────────────────────────── results (used by the room mode) ───────────────────────────

  /** The stage is over for this runner: its one result (stored by run id, sent now or after the reconnect). */
  settle(r: Runner, res: Omit<ResultMsg, 't' | 'runId' | 'stage'>): void {
    const msg: ResultMsg = { t: 'expStageResult', runId: r.run.id, stage: r.run.stage, ...res };
    this.dropRunner(r);
    this.prune();
    this.results.set(r.run.id, { msg, at: Date.now() });
    const s = r.session;
    if (s.conn) this.host.send(s, msg);
    else {
      const ids = this.undelivered.get(s.id) ?? new Set<string>();
      ids.add(r.run.id);
      this.undelivered.set(s.id, ids);
    }
  }
}

/** A won stage's result for player pi (its reward already picked / its room passed). */
function clearedResult(g: Game, pi: number): Omit<ResultMsg, 't' | 'runId' | 'stage'> {
  const ex = g.state.expedition!;
  return { outcome: 'cleared', loot: (ex.loot[pi] ?? []).map(x => ({ ...x })), carry: extractCarry(g.state, pi), bossClear: ex.boss };
}

/** onEnd after the clear: hand the seat to its bot (reward / room) and read the result; a broken sim = void. */
function wonOrVoid(g: Game, pi: number): Omit<ResultMsg, 't' | 'runId' | 'stage'> {
  try {
    if (!g.state.players[pi]?.isBot) g.setPlayerBot(pi, true);
    return clearedResult(g, pi);
  } catch {
    return voidResult('error');
  }
}

const failedResult = (reason: ExpResultReason): Omit<ResultMsg, 't' | 'runId' | 'stage'> => ({ outcome: 'failed', reason, loot: [], carry: null, bossClear: false });
const voidResult = (reason: ExpResultReason): Omit<ResultMsg, 't' | 'runId' | 'stage'> => ({ outcome: 'void', reason, loot: [], carry: null, bossClear: false });

/**
 * The RoomMode of one stage game: 'stageClear' → each human's cleared result and out of the room; 'runOver' → failed
 * for everyone (they stay to watch the result screen until the room ends); a leave mid-stage → failed for that one.
 */
class ExpeditionRoomMode implements RoomMode {
  readonly kind = 'expedition' as const;
  private readonly lobby: ExpeditionLobby;
  private readonly runners: Map<string, Runner>;
  /** Session ids whose result this game has settled. */
  private readonly settled = new Set<string>();
  private failed = false;

  constructor(lobby: ExpeditionLobby, runners: Runner[]) {
    this.lobby = lobby;
    this.runners = new Map(runners.map(r => [r.session.id, r]));
  }

  check(room: Room, g: Game): void {
    const s = g.state;
    if (!s.expedition) return;
    if (s.phase === 'stageClear') {
      for (const m of [...room.members]) {
        if (m.playerIndex == null || this.settled.has(m.session.id)) continue;
        const pi = m.playerIndex;
        this.leaveWith(room, m, r => this.lobby.settle(r, clearedResult(g, pi)));
      }
    } else if (s.phase === 'runOver' && !this.failed) {
      // wipe / timeout: everyone here loses the bag; they stay to watch the result until the room ends
      this.failed = true;
      const reason = FAIL_REASON[s.runResult?.reason ?? 'wipe'];
      for (const m of room.members) this.settle(m, r => this.lobby.settle(r, failedResult(reason)));
    }
  }

  /** The member leaves this stage game now: the result first (the client knows the outcome), then 'gameEnded'. */
  private leaveWith(room: Room, m: Member, then: (r: Runner) => void): void {
    this.settle(m, then);
    room.endFor(m);
    room.remove(m.session);
  }

  private settle(m: Member, how: (r: Runner) => void): void {
    if (this.settled.has(m.session.id)) return;
    this.settled.add(m.session.id);
    const r = this.runners.get(m.session.id);
    if (r) how(r);
  }

  /**
   * Quit / leaveRoom (before its slot turns bot). Mid-combat = failed 'quit' (that player's bag only). After the combat
   * was won = still a clear: the seat goes bot now (its reward picked at random, its room passed), then the result.
   */
  onRemove(room: Room, m: Member): void {
    if (this.settled.has(m.session.id)) return;
    const g = room.game;
    const pi = m.playerIndex;
    if (g && pi != null && g.state.expedition?.outcome === 'cleared') {
      g.setPlayerBot(pi, true);
      this.settle(m, r => this.lobby.settle(r, clearedResult(g, pi)));
    } else this.settle(m, r => this.lobby.settle(r, failedResult('quit')));
    room.endFor(m);
  }

  /**
   * The game stops early (nobody connected for expAbandonMs, sim error). Won already = cleared; a server error before
   * the clear = void (the bag is kept, the stage is played again); abandoned before the clear = failed.
   */
  onEnd(room: Room, g: Game, why: EndReason): void {
    const won = g.state.expedition?.outcome === 'cleared';
    for (const m of room.members) {
      const pi = m.playerIndex;
      const res = won && pi != null ? wonOrVoid(g, pi) : why === 'error' ? voidResult('error') : failedResult('abandon');
      this.settle(m, r => this.lobby.settle(r, res));
    }
  }
}
