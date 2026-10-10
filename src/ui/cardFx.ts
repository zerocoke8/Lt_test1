// 기획 13차 CardFx (docs/skill-renewal.md 2-7): what the renewed skills do to MY bench cards, shown on the cards
// themselves (the bench has no field entity): 바드 앙코르 — a '♪' badge with a ring running down its time; 메딕 골든
// 아워 — the revive countdown gets a gold '−20' rolling down; 크로노 — a counter-clockwise rewind sweep + '−2초'.
// 기획 17차 저스트 교대 (docs/just-swap.md 연출): the incoming card gets a 0.4 s gold shine and a '×1.5' badge until
// its drag lands; the outgoing card a gold '−N초' (its cooldown ring starts with that chunk already gone).

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

/** The '×1.5' badge stays at least this long, and at most this long after its drag's last part (ms). */
export const JUST_BADGE_MIN_MS = 700;
export const JUST_BADGE_AFTER_MS = 250;
/** Drag skills land after the drop-in (render DASH_LAND ≈ 0.18 s). */
const DROP_IN_MS = 180;

/** '×1.5' / '×2' (one decimal at most). PURE. */
export function multBadge(mult: number): string {
  return `×${Math.round(Math.max(1, mult) * 10) / 10}`;
}

/** How long the badge waits for a drag cast part that lands `delay` s later with `hits` hits `interval` apart (ms). */
export function badgeMs(delay = 0, hits = 1, interval = 0): number {
  const last = Math.max(0, delay) + Math.max(0, hits - 1) * Math.max(0, interval);
  return Math.max(JUST_BADGE_MIN_MS, DROP_IN_MS + last * 1000 + JUST_BADGE_AFTER_MS);
}

export class CardFx {
  private readonly badges = new Map<number, Badge>();
  /** The incoming card's '×1.5' badge: removed when its drag landed. */
  private just: { idx: number; entityId: number; el: HTMLElement; timer: ReturnType<typeof setTimeout>; until: number } | null = null;

  /** justMult: my 저스트 drag multiplier now (tunables + reward bonuses). */
  constructor(
    private readonly cards: () => readonly CardFxTarget[],
    private readonly justMult: () => number = () => 1.5,
  ) {}

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
      case 'justSwap':
        if (e.player === localPlayer) this.justSwap(e.inIndex, e.inEntityId, e.outIndex, e.cdCut);
        return false; // the HUD also reacts (first-time help, learner count)
      case 'skillCast':
        // my 저스트 drag: keep the badge until its last part lands (the event is the HUD's too)
        if (this.just && e.slot === 'drag' && e.sourceId === this.just.entityId) this.extendJust(badgeMs(e.delay, e.hits, e.hitInterval));
        return false;
      default:
        return false;
    }
  }

  destroy(): void {
    for (const b of this.badges.values()) clearTimeout(b.timer);
    this.badges.clear();
    this.clearJust();
  }

  private justSwap(inIdx: number, entityId: number, outIdx: number, cdCut: number): void {
    const cards = this.cards();
    const inCard = cards[inIdx];
    this.clearJust();
    if (inCard) {
      const shine = h('span', 'cc-just-shine', inCard.el);
      setTimeout(() => shine.remove(), 450);
      const el = h('span', 'cc-just-badge', inCard.el, multBadge(this.justMult()));
      const ms = badgeMs();
      this.just = { idx: inIdx, entityId, el, timer: setTimeout(() => this.clearJust(), ms), until: performance.now() + ms };
    }
    if (cdCut >= 0.05) this.pop(outIdx, `−${Math.round(cdCut * 10) / 10}초`, 'cc-just-cut', 1300);
  }

  private extendJust(ms: number): void {
    const j = this.just;
    if (!j) return;
    const until = performance.now() + ms;
    if (until <= j.until) return;
    clearTimeout(j.timer);
    j.until = until;
    j.timer = setTimeout(() => this.clearJust(), ms);
  }

  private clearJust(): void {
    if (!this.just) return;
    clearTimeout(this.just.timer);
    this.just.el.remove();
    this.just = null;
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
