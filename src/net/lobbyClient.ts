// Lobby state on top of Connection: room list, my room, start/gameEnded/error events (R30/R31).

import type { PresetChoice, RoomInfo, RoomSummary, ServerMsg } from './protocol';
import { Connection, type NetStatus } from './connection';

export type StartMsg = Extract<ServerMsg, { t: 'start' }>;
export type LobbyError = Extract<ServerMsg, { t: 'error' }>;

export interface LobbyEvents {
  /** Anything shown by the lobby changed (status, rooms, room, name). */
  onChange?(): void;
  onStart?(msg: StartMsg): void;
  onGameEnded?(): void;
  onError?(err: LobbyError): void;
  /** I am no longer in a room (left, kicked by quitting, room closed). */
  onLeftRoom?(): void;
  /** Another tab took over this session (close 4001): this tab is out of the room/game until it retries. */
  onReplaced?(): void;
}

export class LobbyClient {
  readonly conn: Connection;
  rooms: RoomSummary[] = [];
  room: RoomInfo | null = null;
  lastError: LobbyError | null = null;
  private readonly ev: LobbyEvents;
  private nameGetter: () => string;

  constructor(nameGetter: () => string, ev: LobbyEvents = {}) {
    this.nameGetter = nameGetter;
    this.ev = ev;
    this.conn = new Connection({ name: () => this.nameGetter() });
    this.conn.onStatus(st => {
      if (st === 'replaced') {
        // the other tab holds the seat now; the server re-sends room/rooms when this tab takes it back
        this.room = null;
        this.rooms = [];
        this.ev.onReplaced?.();
      }
      this.changed();
    });
    this.conn.on('welcome', () => this.changed());
    this.conn.on('rooms', m => {
      this.rooms = m.rooms;
      this.changed();
    });
    this.conn.on('room', m => {
      const had = !!this.room;
      this.room = m.room;
      this.changed();
      if (had && !m.room) this.ev.onLeftRoom?.();
    });
    this.conn.on('start', m => this.ev.onStart?.(m));
    this.conn.on('gameEnded', () => this.ev.onGameEnded?.());
    this.conn.on('error', m => {
      this.lastError = m;
      this.ev.onError?.(m);
      this.changed();
    });
  }

  get status(): NetStatus {
    return this.conn.status;
  }

  get online(): boolean {
    return this.conn.online;
  }

  get sessionId(): string | null {
    return this.conn.sessionId;
  }

  get name(): string {
    return this.conn.name || this.nameGetter();
  }

  /** Am I the host of my room? */
  get isHost(): boolean {
    return !!this.room && this.room.members.some(m => m.isHost && m.id === this.conn.sessionId);
  }

  start(): void {
    this.conn.start();
  }

  retry(): void {
    this.conn.retryNow();
  }

  setName(name: string): void {
    this.conn.send({ t: 'setName', name });
  }

  listRooms(): void {
    this.conn.send({ t: 'listRooms' });
  }

  createRoom(preset: PresetChoice): boolean {
    this.lastError = null;
    return this.conn.send({ t: 'createRoom', preset });
  }

  joinRoom(code: string, preset: PresetChoice): boolean {
    this.lastError = null;
    return this.conn.send({ t: 'joinRoom', code, preset });
  }

  setPreset(preset: PresetChoice): void {
    this.conn.send({ t: 'setPreset', preset });
  }

  leaveRoom(): void {
    this.conn.send({ t: 'leaveRoom' });
    // optimistic: the server answers with room:null anyway
    if (this.room) {
      this.room = null;
      this.changed();
    }
  }

  /** I already left by other means (in-game 나가기 = quit command): forget the room locally right away. */
  markLeft(): void {
    if (!this.room) return;
    this.room = null;
    this.changed();
  }

  startGame(): boolean {
    return this.conn.send({ t: 'start' });
  }

  private changed(): void {
    this.ev.onChange?.();
  }
}
