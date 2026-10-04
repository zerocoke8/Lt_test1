// Multiplayer wire protocol (기획 3차: 별도 게임 서버, 방 생성/참가, 최대 3명, 빈자리는 봇, 방장이 시작).
// Server-authoritative: the Node server runs the same src/sim, clients send Commands and render snapshots.
// Transport: one WebSocket per client at `/ws` on the same origin that served the page. JSON messages.

import type { Command, GameEvent, GameState, Telemetry, Tunables } from '../types';

export const PROTOCOL_VERSION = 1;
export const MAX_ROOM_PLAYERS = 3;
/** Snapshot broadcast rate (Hz). The server sim still ticks at 30 Hz. */
export const SNAPSHOT_HZ = 15;
/** Real seconds each human gets to pick a floor reward before the server picks at random. */
export const REWARD_TIMEOUT_SEC = 20;
/** A positional command (swap/pet) based on a snapshot sent longer ago than this (ms) is refused as stale. */
export const MAX_COMMAND_AGE_MS = 2000;
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
  | { t: 'ping'; at: number };

// ─────────────── server → client ───────────────

export type ServerMsg =
  | { t: 'welcome'; v: number; sessionId: string; token: string; name: string }
  | { t: 'rooms'; rooms: RoomSummary[] }
  /** Your current room (null = not in a room). Sent on every change. */
  | { t: 'room'; room: RoomInfo | null }
  | {
      t: 'error';
      /** 'server_busy': the server's global limits (running games) are reached — try again later. */
      code: 'bad_version' | 'room_not_found' | 'room_full' | 'room_playing' | 'not_host' | 'bad_request' | 'not_in_room' | 'server_busy';
      message: string;
    }
  /** Game started (or you reconnected into it). `playerIndex` = your PlayerState index = RenderUiState.localPlayer. */
  | { t: 'start'; playerIndex: number; hostPlayerIndex: number; seed: number; tunables: Tunables }
  /**
   * Authoritative state at SNAPSHOT_HZ. `state` is a plain GameState (no sim-internal fields).
   * `events` = everything emitted since the previous snapshot (oldest first).
   * `rewardDeadline` = server ms timestamp when unchosen rewards are auto-picked (null outside the reward phase).
   * `tunables` = only when they changed, on the first snapshot (start / reconnect) and about once a second.
   * `telemetry` = the receiving player's tuning log, only once `state.phase` is 'runOver' (the result screen reads it).
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
      telemetry?: Telemetry;
    }
  | { t: 'cmdResult'; seq: number; ok: boolean; reason?: string }
  /** The game ended and the room returned to 'waiting' (or closed). */
  | { t: 'gameEnded' }
  | { t: 'pong'; at: number; serverTime: number };
