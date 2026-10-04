// 일시정지 메뉴: 계속 / 디버그 / 전체 화면 / 포기 (포기는 두 번 눌러 확인).
// Multiplayer (R35): "메뉴" — the game keeps running underneath; 닫기 / 디버그 (방장만) / 전체 화면 / 나가기.

import type { GameState } from '../types';
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
}

export class PauseMenu {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly info: HTMLElement;
  private readonly note: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly debugBtn: HTMLButtonElement;
  private readonly quitBtn: HTMLButtonElement;
  private armed = false;
  private view: PauseView = { multi: false, isHost: true };

  constructor(parent: HTMLElement, cb: PauseCallbacks) {
    this.el = h('div', 'screen pause is-hidden', parent);
    const box = h('div', 'pause-box', this.el);
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
    // tap on the dim backdrop = resume
    this.el.addEventListener('click', e => {
      if (e.target === this.el) cb.onResume();
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
    this.el.classList.remove('is-hidden');
  }

  hide(): void {
    this.el.classList.add('is-hidden');
  }
}
