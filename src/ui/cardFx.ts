// 기획 13차 CardFx (docs/skill-renewal.md 2-7): what the renewed skills do to MY bench cards, shown on the cards
// themselves (the bench has no field entity): 바드 앙코르 — a '♪' badge with a ring running down its time; 메딕 골든
// 아워 — the revive countdown gets a gold '−20' rolling down; 크로노 — a counter-clockwise rewind sweep + '−2초'.

import type { GameEvent } from '../types';
import { h, replayClass } from './dom';

export interface CardFxTarget {
  el: HTMLElement;
  por: HTMLElement;
}

/** Bench-buff badges per card (one at a time; a fresh buff restarts it). */
interface Badge {
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

export class CardFx {
  private readonly badges = new Map<number, Badge>();

  constructor(private readonly cards: () => readonly CardFxTarget[]) {}

  /** Handles the card events for `localPlayer`; true when it was one. */
  onEvent(e: GameEvent, localPlayer: number): boolean {
    switch (e.type) {
      case 'benchBuff':
        if (e.player === localPlayer) this.buff(e.partyIndex, e.duration, e.from !== null && e.from !== localPlayer);
        return true;
      case 'reviveCut':
        if (e.player === localPlayer) this.pop(e.partyIndex, `−${Math.round(e.seconds)}`, 'cc-revive-cut', 1100);
        return true;
      case 'swapCdCut':
        if (e.player === localPlayer) this.rewind(e.seconds);
        return true;
      default:
        return false;
    }
  }

  destroy(): void {
    for (const b of this.badges.values()) clearTimeout(b.timer);
    this.badges.clear();
  }

  private buff(idx: number, duration: number, fromOther: boolean): void {
    const card = this.cards()[idx];
    if (!card) return;
    const old = this.badges.get(idx);
    if (old) {
      clearTimeout(old.timer);
      old.el.remove();
    }
    const el = h('span', `cc-buff-badge${fromOther ? ' is-encore' : ''}`, card.el, '♪');
    el.style.setProperty('--buff-dur', `${Math.max(0.5, duration)}s`);
    replayClass(card.por, 'is-buffed');
    const timer = setTimeout(() => {
      el.remove();
      this.badges.delete(idx);
    }, Math.max(0.5, duration) * 1000);
    this.badges.set(idx, { el, timer });
  }

  private pop(idx: number, text: string, cls: string, ms: number): void {
    const card = this.cards()[idx];
    if (!card) return;
    const el = h('span', cls, card.el, text);
    setTimeout(() => el.remove(), ms);
  }

  private rewind(seconds: number): void {
    const cards = this.cards();
    for (let i = 0; i < cards.length; i++) {
      const sweep = h('span', 'cc-rewind', cards[i].el);
      const el = h('span', 'cc-cd-cut', cards[i].el, `−${seconds}초`);
      setTimeout(() => (sweep.remove(), el.remove()), 900);
    }
  }
}
