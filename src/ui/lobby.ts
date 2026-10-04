// 매칭 화면 (R30/R31, 기획 3차 3): after the preset screen.
//  목록: 닉네임 · 혼자 하기 (봇 2명) · 방 만들기 · 코드로 참가 · 열린 방 목록 (탭해서 참가)
//  방:   큰 방 코드 · 슬롯 3칸 (닉네임 + 캐릭터 3 + 펫 3, 빈자리 → 봇) · 방장 표시 · 시작(방장) · 나가기 · 프리셋 변경
// Pure view: the app wires the callbacks to LobbyClient and calls update() whenever the lobby state changes.

import type { NetStatus } from '../net/connection';
import type { RoomInfo, RoomMember, RoomSummary } from '../net/protocol';
import { MAX_ROOM_PLAYERS, ROOM_CODE_ALPHABET } from '../net/protocol';
import { BOT_PRESETS } from '../config';
import { CHARACTERS, PETS, getCharacter, getPet } from '../data';
import { button, h, replayClass, setClass, setText, show } from './dom';
import { petIcon, portrait } from './preset';
import type { PresetSave } from './storage';
import { NICKNAME_MAX } from './storage';
import { createToaster, type ToastKind } from './toast';

export interface LobbyCallbacks {
  onSolo(): void;
  /** Back to the preset screen (keeps the room, if any). */
  onPreset(): void;
  onCreate(): void;
  onJoin(code: string): void;
  onLeave(): void;
  onStart(): void;
  onNameChange(name: string): void;
  onRetry(): void;
  onRefresh(): void;
}

export interface LobbyModel {
  status: NetStatus;
  latencyMs: number | null;
  /** Nickname shown in the input (local). */
  name: string;
  rooms: RoomSummary[];
  room: RoomInfo | null;
  myId: string | null;
  preset: PresetSave;
  /** Start pressed / game starting: waiting for the first snapshot. */
  starting: boolean;
}

export const OFFLINE_TEXT = '게임 서버에 연결할 수 없어요 — 혼자 하기만 가능';
/** Another tab/window of this browser took over this session (R34, close 4001). */
export const REPLACED_TEXT = '다른 탭에서 접속 중이에요';
/** Solo-only build (claude.ai 링크): not an error, just how this page works. */
export const SOLO_BUILD_TEXT = '혼자 하기 전용 링크 · 멀티는 게임 서버 주소에서';

const knownChar = new Set(CHARACTERS.map(c => c.id));
const knownPet = new Set(PETS.map(p => p.id));

function statusText(st: NetStatus, latency: number | null): string {
  switch (st) {
    case 'online':
      return latency != null ? `서버 연결됨 · ${Math.round(latency)}ms` : '서버 연결됨';
    case 'idle':
    case 'probing':
    case 'connecting':
      return '서버 연결 중…';
    case 'reconnecting':
      return '다시 연결하는 중…';
    case 'offline':
      return '오프라인 · 혼자 하기만 가능';
    case 'replaced':
      return '다른 탭에서 접속 중';
  }
}

function cleanCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
  return out.slice(0, 4);
}

/** Party chips: 3 character portraits + 3 pet icons (shared by "내 편성" and the room slots). */
function partyChips(parent: HTMLElement, chars: readonly string[], pets: readonly string[], cls = ''): void {
  const row = h('div', `lb-party ${cls}`.trim(), parent);
  const cr = h('div', 'lb-chars', row);
  chars.forEach((id, i) => {
    if (!knownChar.has(id)) return;
    const def = getCharacter(id);
    const chip = h('div', 'lb-char', cr);
    const p = portrait(def, 'lb-char-por', chip);
    if (i === 0) h('span', 'lb-lead', p, '1');
    h('div', 'lb-char-name', chip, def.name);
  });
  const pr = h('div', 'lb-pets', row);
  for (const id of pets) {
    if (!knownPet.has(id)) continue;
    const def = getPet(id);
    const chip = h('div', 'lb-pet', pr);
    chip.title = def.name;
    petIcon(def, 'lb-pet-icon', chip);
    h('div', 'lb-pet-name', chip, def.name);
  }
}

export class LobbyScreen {
  readonly el: HTMLElement;
  private readonly cb: LobbyCallbacks;
  private readonly toaster;
  // header
  private readonly backBtn: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly statusPill: HTMLElement;
  // list view
  private readonly listView: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly myParty: HTMLElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly offlineBox: HTMLElement;
  private readonly offlineText: HTMLElement;
  private readonly retryBtn: HTMLButtonElement;
  private readonly roomList: HTMLElement;
  private readonly listCount: HTMLElement;
  // room view
  private readonly roomView: HTMLElement;
  private readonly roomCode: HTMLElement;
  private readonly roomName: HTMLElement;
  private readonly roomHint: HTMLElement;
  private readonly slots: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly waitText: HTMLElement;
  private readonly starting: HTMLElement;
  private model: LobbyModel | null = null;
  private renderedKey = '';

  constructor(parent: HTMLElement, cb: LobbyCallbacks) {
    this.cb = cb;
    this.el = h('div', 'screen lobby is-hidden', parent);

    // ── header ──
    const head = h('div', 'lb-head', this.el);
    this.backBtn = button('btn btn-secondary lb-back', '← 편성', head, () => this.cb.onPreset());
    const titles = h('div', 'lb-titles', head);
    this.title = h('div', 'lb-title', titles, '매칭');
    this.sub = h('div', 'lb-sub', titles, '최대 3명 협동 · 빈자리는 시작할 때 봇이 채워요');
    this.statusPill = h('div', 'lb-status', head);

    // ── list view ──
    this.listView = h('div', 'lb-list-view', this.el);
    const left = h('div', 'lb-left', this.listView);
    const nameRow = h('label', 'lb-field lb-name', left);
    h('span', 'lb-label', nameRow, '닉네임');
    this.nameInput = h('input', 'lb-input', nameRow);
    this.nameInput.type = 'text';
    this.nameInput.maxLength = NICKNAME_MAX;
    this.nameInput.placeholder = `최대 ${NICKNAME_MAX}자`;
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.enterKeyHint = 'done';
    const commitName = () => {
      const v = Array.from(this.nameInput.value.trim()).slice(0, NICKNAME_MAX).join('');
      if (v !== this.nameInput.value) this.nameInput.value = v;
      this.cb.onNameChange(v);
    };
    this.nameInput.addEventListener('change', commitName);
    this.nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.nameInput.blur();
    });
    const partyBox = h('div', 'lb-myparty', left);
    h('span', 'lb-label', partyBox, '내 편성');
    this.myParty = h('div', 'lb-myparty-chips', partyBox);

    const solo = button('btn btn-secondary lb-solo', '', left, () => this.cb.onSolo());
    h('span', 'lb-btn-main', solo, '혼자 하기');
    h('span', 'lb-btn-sub', solo, '봇 2명과 함께');
    this.createBtn = button('btn btn-primary lb-create', '방 만들기', left, () => {
      if (this.model?.status !== 'online') return this.refuse(this.createBtn, '서버에 연결된 뒤에 만들 수 있어요');
      this.cb.onCreate();
    });
    const codeRow = h('div', 'lb-field lb-code', left);
    h('span', 'lb-label', codeRow, '코드로 참가');
    this.codeInput = h('input', 'lb-input lb-code-input', codeRow);
    this.codeInput.type = 'text';
    this.codeInput.maxLength = 4;
    this.codeInput.placeholder = 'ABCD';
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('autocapitalize', 'characters');
    this.codeInput.enterKeyHint = 'go';
    this.codeInput.addEventListener('input', () => {
      const v = cleanCode(this.codeInput.value);
      if (v !== this.codeInput.value) this.codeInput.value = v;
      setClass(this.joinBtn, 'is-disabled', v.length !== 4 || this.model?.status !== 'online');
    });
    this.codeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.join();
    });
    this.joinBtn = button('btn btn-secondary lb-join is-disabled', '참가', codeRow, () => this.join());
    this.offlineBox = h('div', 'lb-offline is-hidden', left);
    this.offlineText = h('span', 'lb-offline-text', this.offlineBox, OFFLINE_TEXT);
    this.retryBtn = button('lb-retry', '다시 시도', this.offlineBox, () => this.cb.onRetry());

    const right = h('div', 'lb-right', this.listView);
    const rhead = h('div', 'lb-rhead', right);
    h('span', 'lb-rtitle', rhead, '열린 방');
    this.listCount = h('span', 'lb-rcount', rhead);
    button('lb-refresh', '새로고침', rhead, () => this.cb.onRefresh());
    this.roomList = h('div', 'lb-rooms', right);
    this.roomList.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

    // ── room view ──
    this.roomView = h('div', 'lb-room-view is-hidden', this.el);
    const codeBox = h('div', 'lb-codebox', this.roomView);
    const codeCol = h('div', 'lb-code-col', codeBox);
    h('div', 'lb-code-label', codeCol, '방 코드');
    this.roomCode = h('div', 'lb-roomcode', codeCol);
    const codeInfo = h('div', 'lb-code-info', codeBox);
    this.roomName = h('div', 'lb-roomname', codeInfo);
    this.roomHint = h('div', 'lb-roomhint', codeInfo, '친구에게 코드를 알려 주세요 · 매칭 화면의 "코드로 참가"에 입력하면 들어와요');
    this.slots = h('div', 'lb-slots', this.roomView);
    const foot = h('div', 'lb-foot', this.roomView);
    button('btn btn-secondary lb-preset', '프리셋 변경', foot, () => this.cb.onPreset());
    button('btn btn-danger lb-leave', '나가기', foot, () => this.cb.onLeave());
    const footRight = h('div', 'lb-foot-right', foot);
    this.waitText = h('div', 'lb-wait', footRight, '방장이 시작하기를 기다리는 중…');
    this.startBtn = button('btn btn-primary btn-start lb-start', '시작', footRight, () => {
      if (this.model?.room?.status === 'playing') return this.refuse(this.startBtn, '이미 게임 중이에요');
      this.cb.onStart();
    });

    this.starting = h('div', 'lb-starting is-hidden', this.el);
    const sbox = h('div', 'lb-starting-box', this.starting);
    h('div', 'lb-spinner', sbox);
    h('div', 'lb-starting-text', sbox, '게임 시작 중…');

    this.toaster = createToaster(this.el, 'toasts-lobby');
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
    if (!on) {
      this.nameInput.blur();
      this.codeInput.blur();
    }
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.toaster.show(text, kind);
  }

  private refuse(el: HTMLElement, text: string): void {
    replayClass(el, 'shake');
    this.toast(text, 'warn');
  }

  private join(): void {
    const code = cleanCode(this.codeInput.value);
    if (this.model?.status !== 'online') return this.refuse(this.joinBtn, '서버에 연결된 뒤에 참가할 수 있어요');
    if (code.length !== 4) return this.refuse(this.joinBtn, '방 코드 4자리를 입력해 주세요');
    this.codeInput.blur();
    this.cb.onJoin(code);
  }

  update(m: LobbyModel): void {
    this.model = m;
    const online = m.status === 'online';
    const inRoom = !!m.room;
    setText(this.statusPill, statusText(m.status, m.latencyMs));
    setClass(this.statusPill, 'is-online', online);
    setClass(this.statusPill, 'is-offline', m.status === 'offline' || m.status === 'replaced');
    show(this.listView, !inRoom);
    show(this.roomView, inRoom);
    show(this.backBtn, !inRoom);
    setText(this.title, inRoom ? '방' : '매칭');
    setText(this.sub, inRoom ? '최대 3명 · 빈자리는 시작할 때 봇이 채워요' : '최대 3명 협동 · 빈자리는 시작할 때 봇이 채워요');
    show(this.starting, m.starting);
    if (document.activeElement !== this.nameInput && this.nameInput.value !== m.name) this.nameInput.value = m.name;
    setClass(this.createBtn, 'is-disabled', !online);
    setClass(this.joinBtn, 'is-disabled', !online || cleanCode(this.codeInput.value).length !== 4);
    const replaced = m.status === 'replaced';
    this.codeInput.disabled = m.status === 'offline' || replaced;
    show(this.offlineBox, m.status === 'offline' || replaced);
    setText(this.offlineText, replaced ? `${REPLACED_TEXT} · 이 탭은 멈췄어요` : OFFLINE_TEXT);
    // "여기서 계속" takes the seat back (the other tab stops instead)
    setText(this.retryBtn, replaced ? '여기서 계속' : '다시 시도');

    // re-render lists only when their content changed (inputs keep focus/caret)
    const key = JSON.stringify([m.preset, m.rooms, m.room, m.myId, m.status]);
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.myParty.replaceChildren();
    partyChips(this.myParty, m.preset.characters, m.preset.pets, 'is-compact');
    if (inRoom) this.renderRoom(m, m.room!);
    else this.renderRooms(m);
  }

  private renderRooms(m: LobbyModel): void {
    this.roomList.replaceChildren();
    const rooms = m.rooms;
    setText(this.listCount, m.status === 'online' ? `${rooms.length}개` : '');
    if (m.status !== 'online') {
      const empty = h('div', 'lb-empty', this.roomList);
      const big = m.status === 'offline' ? '게임 서버에 연결할 수 없어요' : m.status === 'replaced' ? REPLACED_TEXT : '서버에 연결하는 중…';
      const sub =
        m.status === 'offline'
          ? '혼자 하기는 언제든 할 수 있어요'
          : m.status === 'replaced'
            ? '이 탭에서 하려면 「여기서 계속」을 누르세요'
            : '무료 서버는 처음 깨어날 때 1분쯤 걸릴 수 있어요';
      h('div', 'lb-empty-big', empty, big);
      h('div', 'lb-empty-sub', empty, sub);
      return;
    }
    if (!rooms.length) {
      const empty = h('div', 'lb-empty', this.roomList);
      h('div', 'lb-empty-big', empty, '열린 방이 없어요');
      h('div', 'lb-empty-sub', empty, '방을 만들고 친구에게 코드를 알려 주세요');
      return;
    }
    for (const r of rooms) {
      const joinable = r.status === 'waiting' && r.players < r.max;
      const row = button(`lb-room-row ${joinable ? '' : 'is-closed'}`.trim(), '', this.roomList, () => {
        if (r.status === 'playing') return this.refuse(row, '게임 중인 방이에요 · 끝나면 들어갈 수 있어요');
        if (r.players >= r.max) return this.refuse(row, '방이 가득 찼어요');
        this.cb.onJoin(r.code);
      });
      row.dataset.code = r.code;
      const main = h('div', 'lb-room-main', row);
      h('div', 'lb-room-name', main, r.name);
      h('div', 'lb-room-host', main, `방장 ${r.hostName} · 코드 ${r.code}`);
      const count = h('div', 'lb-room-count', row);
      for (let i = 0; i < r.max; i++) h('span', `lb-dot ${i < r.players ? 'is-on' : ''}`, count);
      h('span', 'lb-room-n', count, `${r.players}/${r.max}`);
      h('div', `lb-room-state ${r.status === 'playing' ? 'is-playing' : ''}`, row, r.status === 'playing' ? '게임 중' : r.players >= r.max ? '가득 참' : '참가');
    }
  }

  private renderRoom(m: LobbyModel, room: RoomInfo): void {
    setText(this.roomCode, room.code);
    setText(this.roomName, room.name);
    const me = room.members.find(x => x.id === m.myId);
    const iAmHost = !!me?.isHost;
    show(this.startBtn, iAmHost);
    show(this.waitText, !iAmHost);
    setText(this.waitText, room.status === 'playing' ? '게임 중이에요' : '방장이 시작하기를 기다리는 중…');
    setClass(this.startBtn, 'is-disabled', room.status !== 'waiting' || m.status !== 'online');
    this.slots.replaceChildren();
    let botN = 0;
    for (let i = 0; i < MAX_ROOM_PLAYERS; i++) {
      const mem: RoomMember | undefined = room.members[i];
      if (!mem) {
        const bot = BOT_PRESETS[botN++];
        const slot = h('div', 'lb-slot is-empty', this.slots);
        const top = h('div', 'lb-slot-top', slot);
        h('span', 'lb-slot-n', top, String(i + 1));
        h('span', 'lb-slot-name', top, '빈자리 → 봇');
        if (bot) {
          h('div', 'lb-slot-botnote', slot, `시작하면 봇이 들어와요 · ${bot.name} 편성`);
          partyChips(slot, bot.characters, bot.pets, 'is-ghost');
        }
        continue;
      }
      const isMe = mem.id === m.myId;
      const slot = h('div', `lb-slot ${isMe ? 'is-me' : ''} ${mem.isHost ? 'is-host' : ''} ${mem.connected ? '' : 'is-away'}`.replace(/\s+/g, ' ').trim(), this.slots);
      const top = h('div', 'lb-slot-top', slot);
      h('span', 'lb-slot-n', top, String(i + 1));
      h('span', 'lb-slot-name', top, mem.name);
      if (isMe) h('span', 'lb-badge lb-badge-me', top, '나');
      if (mem.isHost) h('span', 'lb-badge lb-badge-host', top, '방장');
      if (!mem.connected) h('span', 'lb-badge lb-badge-away', top, '연결 끊김');
      partyChips(slot, mem.preset.characters, mem.preset.pets);
    }
  }
}
