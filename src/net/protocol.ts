// Multiplayer wire protocol (기획 3차: 별도 게임 서버, 방 생성/참가, 최대 3명, 빈자리는 봇, 방장이 시작).
// Server-authoritative: the Node server runs the same src/sim, clients send Commands and render snapshots.
// Transport: one WebSocket per client at `/ws` on the same origin that served the page. JSON messages.

import type { Command, ExpeditionChoice, GameEvent, GameState, Telemetry, Tunables } from '../types';
import type { GearLoadout, GearSpec } from '../data/gear';

/**
 * 2 = 기획 10차 (괴담 방: 'goedam' command, phase and snapshot deadline).
 * 3 = 기획 15차 원정: exp* messages (per-stage queues, stage-clear choice, extract / bag lost), 'start.mode',
 *     'snap.choiceDeadline'.
 */
export const PROTOCOL_VERSION = 3;
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
/** 기획 15차 원정: real seconds for the stage-clear choice; then 「장비 수령하고 나가기」 for whoever has not chosen. */
export const EXP_CHOICE_SEC = 20;
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
  /** Came from a 「다음 단계 도전」 (has a bag and carried buffs). */
  continuing: boolean;
  /** Floor-reward buffs carried in. */
  buffs: number;
}

/** Why the bag went to the stash: own pick, the 20 s choice timeout, dropped at the clear, quit the queue, stage 12 done, server error. */
export type ExpExtractReason = 'choice' | 'timeout' | 'disconnect' | 'cancel' | 'complete' | 'error';
/** Why the bag was lost: party wiped, time ran out, left the game mid-stage, game abandoned. */
export type ExpLostReason = 'wipe' | 'timeout' | 'quit' | 'abandon';

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
   * 기획 15차 원정: start a run at `stage` (1..12) and join that stage's queue. `gear` = the party's equipped gear (3
   * loadouts, checked for shape / ids / tiers; stage ≤ maxStartStage(gear) unless `debugUnlock` and the server allows it).
   * `firstBossClears` = boss stages this player has already cleared once (the stash's record).
   */
  | { t: 'expQueue'; stage: number; characters: string[]; pets: string[]; gear: GearLoadout[]; firstBossClears: number[]; debugUnlock?: boolean }
  /** Leave the stage queue. A run with stages cleared extracts its bag (expExtracted), a fresh one just ends (expCancelled). */
  | { t: 'expCancel' }
  /** Start my queue now: empty seats become bots. */
  | { t: 'expStartNow' }
  /** The stage-clear choice (same as the in-game command 'expeditionChoice'). */
  | { t: 'expChoice'; choice: ExpeditionChoice };

// ─────────────── server → client ───────────────

export type ServerMsg =
  | { t: 'welcome'; v: number; sessionId: string; token: string; name: string }
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
        | 'stage_locked';
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
   * `choiceDeadline` = 기획 15차 원정: server ms when the stage-clear choice auto-extracts (absent outside 'stageClear').
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
      choiceDeadline?: number | null;
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
  /** I left the queue of a run that had cleared nothing (nothing to claim). */
  | { t: 'expCancelled' }
  /**
   * 기획 15차 원정: the stage is cleared. `loot` = mine this stage (already in `bag`); choose within `choiceSeconds`
   * (`deadline` server ms). `nextStage` null = stage 12 was the last (extract only).
   */
  | { t: 'expStageClear'; stage: number; loot: GearSpec[]; bag: GearSpec[]; choiceSeconds: number; deadline: number; nextStage: number | null }
  /**
   * The run ended with a claim: put `items` into the stash (also delivered after a reconnect). `bossClears` = boss
   * stages this player has cleared (record them: an offline seat never got that stage's expStageClear).
   */
  | { t: 'expExtracted'; stage: number; items: GearSpec[]; reason: ExpExtractReason; bossClears: number[] }
  /** The run failed: the bag (`count` items) is gone; equipped gear is untouched. */
  | { t: 'expBagLost'; stage: number; count: number; reason: ExpLostReason };
