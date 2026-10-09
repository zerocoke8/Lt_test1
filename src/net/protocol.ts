// Multiplayer wire protocol (기획 3차: 별도 게임 서버, 방 생성/참가, 최대 3명, 빈자리는 봇, 방장이 시작).
// Server-authoritative: the Node server runs the same src/sim, clients send Commands and render snapshots.
// Transport: one WebSocket per client at `/ws` on the same origin that served the page. JSON messages.

import type { Command, ExpeditionCarry, GameEvent, GameState, Telemetry, Tunables } from '../types';
import type { GearLoadout, GearSpec } from '../data/gear';

/**
 * 2 = 기획 10차 (괴담 방: 'goedam' command, phase and snapshot deadline).
 * 3 = 기획 15차 원정: exp* messages (per-stage queues, stage-clear choice, extract / bag lost), 'start.mode',
 *     'snap.choiceDeadline'.
 * 4 = 기획 16차 원정: one floor per stage, the run lives in the browser — expQueue carries the run (ExpRunInfo), one
 *     expStageResult per stage (kept by run id), expStatus / expNoStage, welcome.bootId; the in-game choice is gone
 *     (expChoice, expStageClear, expExtracted, expBagLost, snap.choiceDeadline removed).
 */
export const PROTOCOL_VERSION = 4;
export const MAX_ROOM_PLAYERS = 3;
/** Snapshot broadcast rate (Hz). The server sim still ticks at 30 Hz. */
export const SNAPSHOT_HZ = 15;
/** Real seconds each human gets to pick a floor reward before the server picks at random. */
export const REWARD_TIMEOUT_SEC = 20;
/** 기획 10차: real seconds for the whole 괴담 room (fresh when it opens); then 'leave' for the unchosen, 'continue' for the rest. */
export const GOEDAM_TIMEOUT_SEC = 25;
/** A 괴담 option id on the wire ('leave', 'press', … or 'continue'). */
export const GOEDAM_OPTION_RE = /^[a-z0-9_]{1,32}$/;
/** A positional command (swap/pet) based on a snapshot sent longer ago than this (ms) is refused as stale. */
export const MAX_COMMAND_AGE_MS = 2000;
/** 기획 15차 원정: real seconds a stage queue waits for players (from its first joiner) before bots fill the seats. */
export const EXP_QUEUE_SEC = 15;
/** 기획 15차 원정: a full (or timed-out) queue shows its seats, bots included, this long before the game starts. */
export const EXP_LAUNCH_MS = 1000;
/** Room codes: 4 chars from this alphabet (no 0/O/1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PresetChoice {
  /** 3 CharacterDef ids, index 0 starts on field. */
  characters: string[];
  /** 3 PetDef ids. */
  pets: string[];
}

export interface RoomMember {
  /** Server session id (stable across reconnects with the same token). */
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  preset: PresetChoice;
}

export interface RoomInfo {
  code: string;
  name: string;
  status: 'waiting' | 'playing';
  /** Join order = player slot order in the game. Empty slots are filled with bots on start. */
  members: RoomMember[];
  max: number;
}

export interface RoomSummary {
  code: string;
  name: string;
  hostName: string;
  players: number;
  max: number;
  status: 'waiting' | 'playing';
}

/** 기획 15차 원정: one seat of a stage queue (expQueueState). */
export interface ExpSeatInfo {
  name: string;
  characters: string[];
  pets: string[];
  /** Equipped gear per party index (bots: T(stage − 1) commons, [] on stage 1). */
  gear: GearLoadout[];
  isBot: boolean;
  /** A continuing run (기획 16차: 「N단계 매칭」 from the lobby — has a bag and carried buffs). */
  continuing: boolean;
  /** Floor-reward buffs carried in. */
  buffs: number;
}

/**
 * 기획 16차 원정: why a stage was lost ('failed': party wiped, time ran out, left mid-stage, game abandoned) or voided
 * ('void': the server restarted / the game broke before the clear — the bag is kept, the same stage is played again).
 */
export type ExpResultReason = 'wipe' | 'timeout' | 'quit' | 'abandon' | 'server' | 'error';

/**
 * 기획 16차 원정: a continuing run as the client sends it with expQueue (the browser keeps the run; the server only
 * checks it with runJoinProblem, src/expedition/runCheck.ts). The stage to play = startStage + cleared.
 */
export interface ExpRunInfo {
  /** Run id (8–40 chars of A–Z a–z 0–9 _ -). */
  id: string;
  startStage: number;
  /** Stages cleared this run. */
  cleared: number;
  /** Unclaimed loot (tier = the stage it came from). */
  bag: GearSpec[];
  /** Floor rewards, traces, ult charges, rooms seen (null before the first clear). */
  carry: ExpeditionCarry | null;
  /** Boss stages cleared this run. */
  bossClears: number[];
}

/** 기획 16차 원정: what a stage game meant for one player's run (expStageResult). */
export type ExpStageOutcome = 'cleared' | 'failed' | 'void';

// ─────────────── client → server ───────────────

export type ClientMsg =
  /** First message. `token` reclaims a previous session (reconnect into a running game). */
  | { t: 'hello'; v: number; name: string; token?: string }
  | { t: 'setName'; name: string }
  | { t: 'listRooms' }
  | { t: 'createRoom'; preset: PresetChoice; roomName?: string }
  | { t: 'joinRoom'; code: string; preset: PresetChoice }
  | { t: 'setPreset'; preset: PresetChoice }
  | { t: 'leaveRoom' }
  /** Host only, room status 'waiting'. */
  | { t: 'start' }
  /**
   * In-game command. The server overwrites any `player` field with the sender's slot; debug/tunables are host-only.
   * `atTick` (optional) = tick of the newest snapshot the client had when it sent this: a swap/pet whose snapshot is
   * older than MAX_COMMAND_AGE_MS on the server (a stalled link delivering it late) is refused instead of applied.
   */
  | { t: 'cmd'; seq: number; cmd: Command; atTick?: number }
  | { t: 'ping'; at: number }
  /**
   * 기획 15차 원정: join the queue of `stage` (1..12). `gear` = the party's equipped gear (3 loadouts, checked for shape /
   * ids / tiers). `firstBossClears` = boss stages this player has already cleared once (the stash's record).
   * 기획 16차: `run` = the continuing run (null = a fresh run: stage ≤ maxStartStage(gear) unless `debugUnlock` and the
   * server allows it); checked by runJoinProblem ('bad_run'), one live stage per run id ('run_busy').
   */
  | {
      t: 'expQueue';
      stage: number;
      characters: string[];
      pets: string[];
      gear: GearLoadout[];
      firstBossClears: number[];
      debugUnlock?: boolean;
      run: ExpRunInfo | null;
    }
  /** Leave the stage queue (never claims anything — the bag stays in the browser's run): expCancelled. */
  | { t: 'expCancel' }
  /** Start my queue now: empty seats become bots. */
  | { t: 'expStartNow' }
  /**
   * 기획 16차: the result of the run's last stage game, if the server has one (expStageResult, else expNoStage). With
   * `stage`, only a result of that stage answers: an older stage's result counts as none (expNoStage when the run is
   * not queued / playing here).
   */
  | { t: 'expStatus'; runId: string; stage?: number };

// ─────────────── server → client ───────────────

export type ServerMsg =
  /** `bootId` (기획 16차) = random per server process: a stage that was running under another bootId is gone (void). */
  | { t: 'welcome'; v: number; sessionId: string; token: string; name: string; bootId: string }
  | { t: 'rooms'; rooms: RoomSummary[] }
  /** Your current room (null = not in a room). Sent on every change. */
  | { t: 'room'; room: RoomInfo | null }
  | {
      t: 'error';
      /** 'server_busy': the server's global limits (running games) are reached — try again later. */
      code:
        | 'bad_version'
        | 'room_not_found'
        | 'room_full'
        | 'room_playing'
        | 'not_host'
        | 'bad_request'
        | 'not_in_room'
        | 'server_busy'
        /** 기획 15차 원정: the gear sent with expQueue is not legal gear. */
        | 'bad_gear'
        /** 기획 15차 원정: the start stage is above what the party's gear allows. */
        | 'stage_locked'
        /** 기획 16차 원정: the run sent with expQueue is not a run that can exist (runJoinProblem). */
        | 'bad_run'
        /** 기획 16차 원정: this run id is already queued / playing (another tab). */
        | 'run_busy';
      message: string;
    }
  /** Game started (or you reconnected into it). `playerIndex` = your PlayerState index = RenderUiState.localPlayer. */
  /** `mode` = 'expedition' for a 원정 stage game (absent = the classic tower). */
  | { t: 'start'; playerIndex: number; hostPlayerIndex: number; seed: number; tunables: Tunables; mode?: 'expedition' }
  /**
   * Authoritative state at SNAPSHOT_HZ. `state` is a plain GameState (no sim-internal fields).
   * `events` = everything emitted since the previous snapshot (oldest first).
   * `rewardDeadline` = server ms timestamp when unchosen rewards are auto-picked (null outside the reward phase).
   * `goedamDeadline` = server ms timestamp when the 괴담 room is auto-finished (null outside the 'goedam' phase).
   * `tunables` = only when they changed, on the first snapshot (start / reconnect) and about once a second.
   * `telemetry` = the receiving player's tuning log, only once `state.phase` is 'runOver' or 'stageClear'.
   */
  | {
      t: 'snap';
      tick: number;
      serverTime: number;
      state: GameState;
      events: GameEvent[];
      tunables?: Tunables;
      hostPlayerIndex: number;
      rewardDeadline: number | null;
      goedamDeadline: number | null;
      telemetry?: Telemetry;
    }
  | { t: 'cmdResult'; seq: number; ok: boolean; reason?: string }
  /** The game ended and the room returned to 'waiting' (or closed). */
  | { t: 'gameEnded' }
  | { t: 'pong'; at: number; serverTime: number }
  /**
   * 기획 15차 원정: my stage queue (sent on join, on every seat change, on reconnect). `you` = my seat; `deadline` =
   * server ms when bots fill the empty seats; `launching` = the seats are final (bots shown), the game starts shortly.
   */
  | {
      t: 'expQueueState';
      stage: number;
      seats: ExpSeatInfo[];
      you: number;
      secondsLeft: number;
      deadline: number;
      launching: boolean;
      continuing: boolean;
      bagCount: number;
    }
  /** I left the queue (expCancel). Nothing changed on the server; the run's bag stays where it is (the browser). */
  | { t: 'expCancelled' }
  /**
   * 기획 16차 원정: my stage game is over for my run `runId` at `stage` — sent when it ends for me, kept by run id for
   * opts.expResultKeepMs and sent again after a reconnect / on expStatus. Apply once (run id + stage must match):
   * 'cleared' = `loot` into the bag, `carry` for the next stage, `bossClear` = a boss stage was cleared;
   * 'failed' (`reason`) = the bag is lost; 'void' (`reason` 'error' / 'server') = nothing happened, the same stage again.
   */
  | {
      t: 'expStageResult';
      runId: string;
      stage: number;
      outcome: ExpStageOutcome;
      reason?: ExpResultReason;
      loot: GearSpec[];
      carry: ExpeditionCarry | null;
      bossClear: boolean;
    }
  /** 기획 16차 원정: expStatus answer — this server has no result for that run (e.g. it restarted): treat as void. */
  | { t: 'expNoStage'; runId: string };
