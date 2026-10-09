// 기획 15차 원정 on the server (docs/expedition.md 5장 · 7장): per-stage matchmaking queues (max 3; expQueueSec after
// the first joiner, or 「바로 출발」, bots fill the empty seats), one hidden Room per stage game, and each session's run
// (bag, carry, stages cleared, gear) held here — after the queue join nothing about the run is taken from the client.
// The run model itself is src/expedition/run.ts, shared with the solo controller.
//
// Flow per player: expQueue → (queue) → room game → 'stageClear' → expStageClear → choice
//   extract  → expExtracted (bag → the client's stash), run over
//   continue → back into the queue of stage + 1 with the carry (rewards, traces, ult charges) and the bag
//   wipe / timeout / quit mid-stage → expBagLost. No choice within expChoiceSec, or dropped at the clear → extract.
// A result for a player who is offline waits here and is delivered after the reconnect (hello with the same token).

import type { ClientMsg, ExpExtractReason, ExpLostReason, ExpSeatInfo, PresetChoice, ServerMsg } from '../src/net/protocol';
import { MAX_ROOM_PLAYERS } from '../src/net/protocol';
import type { ExpeditionChoice, Game, RunResult } from '../src/types';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../src/config';
import { botLoadout, cleanPartyGear, maxStartStage, type GearLoadout } from '../src/data/gear';
import { EXPEDITION_STAGES, isBossStage } from '../src/data/stages';
import { expeditionChoiceTimeoutCommands } from '../src/sim/expedition';
import {
  continueRun,
  extractRun,
  failRun,
  onStageCleared,
  startRun,
  stageGameSetup,
  type ExpeditionRun,
  type RunSeat,
} from '../src/expedition/run';
import type { EndReason, Member, Room, RoomMode, ServerOptions, Session } from './room';
import { randomSeed } from './util';

/** A full server (maxPlayingRooms) retries a launch this often. */
const BUSY_RETRY_MS = 2000;

type Timer = ReturnType<typeof setTimeout>;
type ErrorCode = Extract<ServerMsg, { t: 'error' }>['code'];

/** What the lobby needs from the hub. */
export interface ExpeditionHost {
  readonly opts: ServerOptions;
  readonly playingRooms: number;
  send(s: Session, msg: ServerMsg): void;
  sendError(s: Session, code: ErrorCode, message: string): void;
  leave(s: Session, notify: boolean): void;
  createModeRoom(hostId: string, mode: RoomMode): Room;
}

/** One player's run on the server. */
interface Runner {
  session: Session;
  run: ExpeditionRun;
  preset: PresetChoice;
  gear: GearLoadout[];
  /** Boss stages this player has cleared once (stash record at the join + this run's). */
  firstBossClears: Set<number>;
  queue: StageQueue | null;
  /** Queued while offline: dropped (and extracted) after lobbyGraceMs. */
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

const LOST_REASON: Record<RunResult['reason'], ExpLostReason> = { wipe: 'wipe', timeout: 'timeout', quit: 'quit', cleared: 'abandon' };

export class ExpeditionLobby {
  private readonly host: ExpeditionHost;
  /** Session id → active run (queued or playing a stage). */
  private readonly runners = new Map<string, Runner>();
  /** Session id → results that could not be delivered (offline), oldest first. */
  private readonly pending = new Map<string, ServerMsg[]>();
  /** Open (joinable) queue per stage. */
  private readonly queues = new Map<number, StageQueue>();

  constructor(host: ExpeditionHost) {
    this.host = host;
  }

  // ─────────────────────────── messages ───────────────────────────

  handle(s: Session, msg: Extract<ClientMsg, { t: 'expQueue' | 'expCancel' | 'expStartNow' | 'expChoice' }>): void {
    switch (msg.t) {
      case 'expQueue':
        return this.join(s, msg);
      case 'expCancel':
        return this.cancel(s);
      case 'expStartNow': {
        const q = this.runners.get(s.id)?.queue;
        if (q && !q.launching) this.launch(q);
        return;
      }
      case 'expChoice': {
        const room = s.room;
        if (!room?.mode) return this.host.sendError(s, 'not_in_room', '원정 단계 중이 아니에요');
        const r = room.command(s, { type: 'expeditionChoice', player: 0, choice: msg.choice });
        if (r !== 'leave' && !r.ok) this.host.sendError(s, 'bad_request', r.reason ?? '고를 수 없어요');
        return;
      }
    }
  }

  /** expQueue: a fresh run at `stage` (gear and start stage checked here; the client's stash is trusted otherwise). */
  private join(s: Session, msg: Extract<ClientMsg, { t: 'expQueue' }>): void {
    if (this.runners.has(s.id)) return this.host.sendError(s, 'bad_request', '이미 원정 중이에요');
    const gear = cleanPartyGear(msg.gear, 3);
    if (!gear) return this.host.sendError(s, 'bad_gear', '장비 정보가 잘못됐어요');
    const max = maxStartStage(gear);
    if (msg.stage > max && !(msg.debugUnlock && this.host.opts.expDebugUnlock)) {
      return this.host.sendError(s, 'stage_locked', `지금 장비로는 ${max}단계까지 시작할 수 있어요`);
    }
    if (s.room) this.host.leave(s, false);
    const r: Runner = {
      session: s,
      run: startRun(msg.stage, randomSeed()),
      preset: { characters: [...msg.characters], pets: [...msg.pets] },
      gear,
      firstBossClears: new Set(msg.firstBossClears),
      queue: null,
      graceTimer: null,
    };
    this.runners.set(s.id, r);
    this.enqueue(r);
  }

  /** Leave the queue (expCancel, or a classic room instead): a run with a bag claims it (전투 밖이니까 수령). */
  cancel(s: Session): void {
    const r = this.runners.get(s.id);
    if (!r?.queue) return;
    this.leaveQueue(r);
    if (r.run.cleared > 0) this.settleExtract(r, 'cancel');
    else {
      this.runners.delete(s.id);
      this.deliver(s, { t: 'expCancelled' });
    }
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
    const msgs = this.pending.get(s.id);
    if (!msgs) return;
    this.pending.delete(s.id);
    for (const m of msgs) this.host.send(s, m);
  }

  /** The hub forgets an idle session: drop what waited for it. */
  forget(s: Session): void {
    this.pending.delete(s.id);
    const r = this.runners.get(s.id);
    if (r && !r.queue) this.runners.delete(s.id);
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
    this.pending.clear();
  }

  private deliver(s: Session, msg: ServerMsg): void {
    if (s.conn) this.host.send(s, msg);
    else this.pending.set(s.id, [...(this.pending.get(s.id) ?? []), msg]);
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
    const mode = new ExpeditionRoomMode(this, runners, this.host.opts.expChoiceSec * 1000);
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
      characters: [...r.preset.characters],
      pets: [...r.preset.pets],
      gear: r.gear,
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
      gear: r.gear.map(l => ({ ...l })),
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

  // ─────────────────────────── settling a run (used by the room mode) ───────────────────────────

  /** At 'stageClear': the player's loot into the bag, the carry taken; the choice screen data. */
  stageCleared(r: Runner, g: Game, pi: number, deadline: number): void {
    const stage = r.run.stage;
    const loot = onStageCleared(r.run, g.state, pi);
    if (isBossStage(stage)) r.firstBossClears.add(stage);
    this.host.send(r.session, {
      t: 'expStageClear',
      stage,
      loot,
      bag: r.run.bag.map(x => ({ ...x })),
      choiceSeconds: this.host.opts.expChoiceSec,
      deadline,
      nextStage: stage < EXPEDITION_STAGES ? stage + 1 : null,
    });
  }

  /** The stage-clear choice is final (the player has already left the room). */
  settleChoice(r: Runner, choice: ExpeditionChoice, reason: ExpExtractReason): void {
    if (choice === 'continue' && continueRun(r.run)) this.enqueue(r);
    else this.settleExtract(r, choice === 'continue' ? 'complete' : reason);
  }

  settleExtract(r: Runner, reason: ExpExtractReason): void {
    const stage = r.run.stage;
    const items = extractRun(r.run);
    this.runners.delete(r.session.id);
    const bossClears = [...r.firstBossClears].sort((a, b) => a - b);
    this.deliver(r.session, { t: 'expExtracted', stage, items, reason, bossClears });
  }

  settleFail(r: Runner, reason: ExpLostReason): void {
    const stage = r.run.stage;
    const count = failRun(r.run);
    this.runners.delete(r.session.id);
    this.deliver(r.session, { t: 'expBagLost', stage, count, reason });
  }
}

/** The RoomMode of one stage game: stage clear → loot + choice deadline, choices → settle, a lost stage → bags lost. */
class ExpeditionRoomMode implements RoomMode {
  readonly kind = 'expedition' as const;
  private readonly lobby: ExpeditionLobby;
  private readonly runners: Map<string, Runner>;
  private readonly choiceMs: number;
  /** Session ids whose run this game has settled (or handed on to the next queue). */
  private readonly settled = new Set<string>();
  /** Server ms of the choice deadline (set at the clear). */
  private deadline: number | null = null;
  /** Player indices that got the timeout's automatic 'extract'. */
  private readonly timedOut = new Set<number>();
  private failed = false;

  constructor(lobby: ExpeditionLobby, runners: Runner[], choiceMs: number) {
    this.lobby = lobby;
    this.runners = new Map(runners.map(r => [r.session.id, r]));
    this.choiceMs = Math.max(0, choiceMs);
  }

  choiceDeadline(): number | null {
    return this.deadline;
  }

  check(room: Room, g: Game, now: number): void {
    const s = g.state;
    if (!s.expedition) return;
    if (s.phase === 'stageClear') this.checkChoices(room, g, now);
    else if (s.phase === 'runOver' && !this.failed) {
      // wipe / timeout: everyone here loses the bag; they stay to watch the result until the room ends
      this.failed = true;
      const reason = LOST_REASON[s.runResult?.reason ?? 'wipe'];
      for (const m of room.members) this.settle(m, r => this.lobby.settleFail(r, reason));
    }
  }

  private checkChoices(room: Room, g: Game, now: number): void {
    const ex = g.state.expedition!;
    if (this.deadline == null) {
      this.deadline = now + this.choiceMs;
      for (const m of room.members) {
        const r = this.runners.get(m.session.id);
        if (r && m.playerIndex != null && !this.settled.has(m.session.id)) this.lobby.stageCleared(r, g, m.playerIndex, this.deadline);
      }
    } else if (now >= this.deadline) {
      for (const c of expeditionChoiceTimeoutCommands(g.state)) {
        if (c.type === 'expeditionChoice') this.timedOut.add(c.player);
        g.dispatch(c);
      }
    }
    for (const m of [...room.members]) {
      const pi = m.playerIndex;
      const choice = pi != null ? ex.choices[pi] : null;
      if (pi == null || choice == null || this.settled.has(m.session.id)) continue;
      const reason: ExpExtractReason = this.timedOut.has(pi) ? 'timeout' : m.session.conn ? 'choice' : 'disconnect';
      this.leaveWith(room, m, r => this.lobby.settleChoice(r, choice, reason));
    }
  }

  /** The member leaves this stage game now: 'gameEnded' first, then the result (or the next queue). */
  private leaveWith(room: Room, m: Member, then: (r: Runner) => void): void {
    const r = this.runners.get(m.session.id);
    this.settled.add(m.session.id);
    room.endFor(m);
    room.remove(m.session);
    if (r) then(r);
  }

  private settle(m: Member, how: (r: Runner) => void): void {
    if (this.settled.has(m.session.id)) return;
    this.settled.add(m.session.id);
    const r = this.runners.get(m.session.id);
    if (r) how(r);
  }

  /** Quit / leaveRoom: mid-stage = the bag is lost; at the choice = claim it (전투 밖). */
  onRemove(room: Room, m: Member): void {
    if (this.settled.has(m.session.id)) return;
    const g = room.game;
    const atClear = g?.state.phase === 'stageClear';
    room.endFor(m);
    this.settle(m, r => (atClear ? this.lobby.settleExtract(r, 'choice') : this.lobby.settleFail(r, 'quit')));
  }

  /** The game stops early (nobody connected / sim error): claim at the choice or on a server error, else lost. */
  onEnd(room: Room, g: Game, why: EndReason): void {
    const atClear = g.state.phase === 'stageClear';
    for (const m of room.members) {
      this.settle(m, r => {
        if (atClear || why === 'error') this.lobby.settleExtract(r, atClear ? 'disconnect' : 'error');
        else this.lobby.settleFail(r, 'abandon');
      });
    }
  }
}
