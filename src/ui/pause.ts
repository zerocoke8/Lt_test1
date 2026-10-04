// 일시정지 메뉴: 계속 / 디버그 / 전체 화면 / 포기 (포기는 두 번 눌러 확인).

import type { GameState } from '../types';
import { button, h } from './dom';
import { formatClock } from './format';
import { toggleFullscreen } from './stage';

export interface PauseCallbacks {
  onResume(): void;
  onDebug(): void;
  onQuit(): void;
}

export class PauseMenu {
  readonly el: HTMLElement;
  private readonly info: HTMLElement;
  private readonly quitBtn: HTMLButtonElement;
  private armed = false;

  constructor(parent: HTMLElement, cb: PauseCallbacks) {
    this.el = h('div', 'screen pause is-hidden', parent);
    const box = h('div', 'pause-box', this.el);
    h('div', 'pause-title', box, '일시정지');
    this.info = h('div', 'pause-info', box);
    const btns = h('div', 'pause-btns', box);
    button('btn btn-primary', '계속', btns, () => cb.onResume());
    button('btn btn-secondary', '디버그', btns, () => cb.onDebug());
    button('btn btn-secondary', '전체 화면', btns, () => void toggleFullscreen());
    this.quitBtn = button('btn btn-danger', '포기', btns, () => {
      if (!this.armed) {
        this.armed = true;
        this.quitBtn.textContent = '정말 포기할까요? 한 번 더';
        return;
      }
      cb.onQuit();
    });
    // tap on the dim backdrop = resume
    this.el.addEventListener('click', e => {
      if (e.target === this.el) cb.onResume();
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  show(s: GameState | null): void {
    this.armed = false;
    this.quitBtn.textContent = '포기';
    this.info.textContent = s ? `${s.floor}층 · ${s.plan.kind === 'boss' ? '보스층' : '일반층'} · 진행 ${formatClock(s.time)}` : '';
    this.el.classList.remove('is-hidden');
  }

  hide(): void {
    this.el.classList.add('is-hidden');
  }
}
