// 일시정지 메뉴: 계속 / 디버그 / 전체 화면 / 포기 (포기는 두 번 눌러 확인).
// Multiplayer (R35): "메뉴" — the game keeps running underneath; 닫기 / 디버그 (방장만) / 전체 화면 / 나가기.
// 기획 10차: next to the buttons, my 흔적 (name · effect · floors left) and owned relics (no other way to see them mid-run).

import type { GameState, PlayerState } from '../types';
import { getGoedamTrace, getRelic, goedamTraceDuration, goedamTraceEffectText, goedamTraceKind } from '../data';
import { button, h } from './dom';
import { formatClock } from './format';
import { toggleFullscreen } from './stage';

export interface PauseCallbacks {
  onResume(): void;
  onDebug(): void;
  onQuit(): void;
}

export interface PauseView {
  multi: boolean;
  /** Multiplayer host: may open the debug panel; leaving ends the run for everyone. */
  isHost: boolean;
  /** Whose traces/relics to list (default 0). */
  localPlayer?: number;
}

export class PauseMenu {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly info: HTMLElement;
  private readonly note: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly debugBtn: HTMLButtonElement;
  private readonly quitBtn: HTMLButtonElement;
  private readonly lists: HTMLElement;
  private armed = false;
  private view: PauseView = { multi: false, isHost: true };

  constructor(parent: HTMLElement, cb: PauseCallbacks) {
    this.el = h('div', 'screen pause is-hidden', parent);
    const wrap = h('div', 'pause-wrap', this.el);
    const box = h('div', 'pause-box', wrap);
    this.title = h('div', 'pause-title', box, '일시정지');
    this.info = h('div', 'pause-info', box);
    const btns = h('div', 'pause-btns', box);
    this.resumeBtn = button('btn btn-primary', '계속', btns, () => cb.onResume());
    this.debugBtn = button('btn btn-secondary', '디버그', btns, () => cb.onDebug());
    button('btn btn-secondary', '전체 화면', btns, () => void toggleFullscreen());
    this.quitBtn = button('btn btn-danger', '포기', btns, () => {
      if (!this.armed) {
        this.armed = true;
        this.quitBtn.textContent = this.view.multi && this.view.isHost ? '모두의 런이 끝나요 · 한 번 더' : this.view.multi ? '정말 나갈까요? 한 번 더' : '정말 포기할까요? 한 번 더';
        return;
      }
      cb.onQuit();
    });
    this.note = h('div', 'pause-note is-hidden', box);
    this.lists = h('div', 'pause-lists is-hidden', wrap);
    this.lists.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    // tap on the dim backdrop = resume
    this.el.addEventListener('click', e => {
      if (e.target === this.el || e.target === wrap) cb.onResume();
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  show(s: GameState | null, view: PauseView = { multi: false, isHost: true }): void {
    this.view = view;
    this.armed = false;
    this.el.classList.toggle('is-multi', view.multi);
    this.title.textContent = view.multi ? '메뉴' : '일시정지';
    this.resumeBtn.textContent = view.multi ? '닫기' : '계속';
    this.debugBtn.classList.toggle('is-hidden', view.multi && !view.isHost);
    this.quitBtn.textContent = view.multi ? '나가기' : '포기';
    this.note.classList.toggle('is-hidden', !view.multi);
    this.note.textContent = view.multi
      ? view.isHost
        ? '멀티 게임은 멈추지 않아요 · 방장이 나가면 모두의 런이 끝나요'
        : '멀티 게임은 멈추지 않아요 · 나가면 내 자리는 봇이 이어서 해요'
      : '';
    this.info.textContent = s ? `${s.floor}층 · ${s.plan.kind === 'boss' ? '보스층' : '일반층'} · 진행 ${formatClock(s.time)}` : '';
    this.renderLists(s?.players[view.localPlayer ?? 0] ?? null);
    this.el.classList.remove('is-hidden');
  }

  /** 흔적 then 유물 of my player; the panel is hidden when there is neither. */
  private renderLists(me: PlayerState | null): void {
    this.lists.replaceChildren();
    const traces = me?.goedamTraces ?? [];
    const relics = me?.relics ?? [];
    this.lists.classList.toggle('is-hidden', traces.length === 0 && relics.length === 0);
    if (traces.length) {
      h('div', 'pl-title', this.lists, `흔적 ${traces.length}`);
      for (const slot of traces) {
        const t = getGoedamTrace(slot.id);
        const row = h('div', `pl-row pl-trace kind-${goedamTraceKind(t)}`, this.lists);
        h('span', 'pl-icon', row, t.icon);
        const txt = h('div', 'pl-text', row);
        h('div', 'pl-name', txt, t.name);
        h('div', 'pl-desc', txt, goedamTraceEffectText(t));
        h('span', 'pl-left', row, goedamTraceDuration(slot.floorsLeft));
      }
    }
    if (relics.length) {
      h('div', 'pl-title', this.lists, `유물 ${relics.length}`);
      for (const id of relics) {
        const r = getRelic(id);
        const row = h('div', 'pl-row pl-relic', this.lists);
        h('span', 'pl-gem', row);
        const txt = h('div', 'pl-text', row);
        h('div', 'pl-name', txt, r.name);
        h('div', 'pl-desc', txt, r.description);
      }
    }
  }

  hide(): void {
    this.el.classList.add('is-hidden');
  }
}
