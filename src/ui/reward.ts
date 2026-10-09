// 층 보상 선택 (R20, R33): my offers = state.rewardOffersByPlayer[localPlayer] → 3 cards → chooseReward.
// Multiplayer: a countdown to the server's auto-pick, and after choosing "다른 플레이어 선택 대기 중 (n/3)".

import type { GameState, RewardOffer } from '../types';
import { RARITY_COLOR, RARITY_LABEL, getCharacter } from '../data';
import { button, h, setText, show } from './dom';
import { portrait } from './preset';

export interface RewardView {
  localPlayer: number;
  /** Multiplayer run: show the waiting panel when I have nothing (left) to pick. */
  multi: boolean;
  /** Auto-pick deadline on the local clock (Date.now() ms), null = none. */
  deadline: number | null;
}

/** My pending offers (falls back to the single-human field for player 0). */
export function offersFor(s: GameState, pi: number): RewardOffer[] | null {
  if (s.phase !== 'reward') return null;
  const by = s.rewardOffersByPlayer;
  if (Array.isArray(by) && by.length > pi) return by[pi] ?? null;
  return pi === 0 ? s.rewardOffers : null;
}

/** Players done choosing (bots, out players and humans who picked) / everyone. */
export function rewardProgress(s: GameState): { done: number; total: number } {
  const by = s.rewardOffersByPlayer ?? [];
  const total = s.players.length;
  let pending = 0;
  for (let i = 0; i < total; i++) if (by[i]) pending++;
  return { done: total - pending, total };
}

/** '7층 클리어!' (기획 16차 원정: '4단계 클리어!' — one floor per stage). */
export function rewardTitle(s: GameState): string {
  return s.expedition ? `${s.expedition.stage}단계 클리어!` : `${s.floor}층 클리어!`;
}

/** 기획 16차 원정: the floor reward is a run buff — 「수령」 in the lobby ends the run and it goes away (5-2). */
export const EXP_REWARD_NOTE = '수령하면 이 보상은 사라져요';

export class RewardOverlay {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly timer: HTMLElement;
  /** 기획 16차 원정: 「수령하면 이 보상은 사라져요」. */
  private readonly expNote: HTMLElement;
  private readonly row: HTMLElement;
  private readonly wait: HTMLElement;
  private readonly waitText: HTMLElement;
  private shownKey = '';
  private shown: RewardOffer[] | null = null;
  private waiting = false;
  private readonly onChoose: (index: number) => void;

  constructor(parent: HTMLElement, onChoose: (index: number) => void) {
    this.onChoose = onChoose;
    this.el = h('div', 'screen reward is-hidden', parent);
    const head = h('div', 'rw-head', this.el);
    this.title = h('div', 'rw-title', head);
    this.sub = h('div', 'rw-sub', head);
    this.timer = h('div', 'rw-timer is-hidden', head);
    this.expNote = h('div', 'rw-exp-note is-hidden', head, EXP_REWARD_NOTE);
    this.row = h('div', 'rw-row', this.el);
    this.wait = h('div', 'rw-wait is-hidden', this.el);
    h('div', 'rw-wait-spin', this.wait);
    this.waitText = h('div', 'rw-wait-text', this.wait);
  }

  get visible(): boolean {
    return this.shown != null || this.waiting;
  }

  update(s: GameState, view: RewardView = { localPlayer: 0, multi: false, deadline: null }): void {
    const offers = offersFor(s, view.localPlayer);
    const me = s.players[view.localPlayer];
    const waiting = !offers && view.multi && s.phase === 'reward' && !!me;
    this.waiting = waiting;
    this.el.classList.toggle('is-hidden', !offers && !waiting);
    show(this.expNote, !!s.expedition && !!offers);
    // countdown (R33: the server picks at random when it runs out)
    const left = view.deadline != null && s.phase === 'reward' ? Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000)) : null;
    show(this.timer, left != null && (!!offers || waiting));
    if (left != null) {
      setText(this.timer, offers ? `${left}초 안에 고르지 않으면 무작위로 골라요` : `${left}초 뒤 자동 선택`);
      this.timer.classList.toggle('is-urgent', left <= 5);
    }
    if (waiting) {
      const { done, total } = rewardProgress(s);
      setText(this.waitText, `다른 플레이어 선택 대기 중 (${done}/${total})`);
      // out players (R11) get no offers this floor: say so instead of "picked"
      setText(this.sub, me.out ? '관전 중 · 보상 없음' : '보상을 골랐어요');
    }
    show(this.wait, waiting);
    show(this.row, !!offers);
    // rebuild the cards only when the offers really change (snapshots bring new arrays 15×/s)
    const key = offers ? `${s.floor}|${offers.map(o => `${o.rewardId}:${o.partyIndex}`).join(',')}` : '';
    if (key === this.shownKey) {
      this.shown = offers;
      if (waiting || offers) this.title.textContent = rewardTitle(s);
      return;
    }
    this.shownKey = key;
    this.shown = offers;
    this.title.textContent = rewardTitle(s);
    if (!offers) {
      this.row.replaceChildren();
      if (!waiting) this.sub.textContent = '';
      return;
    }
    const relic = offers.some(o => o.isRelic);
    this.sub.textContent = relic ? '유물을 하나 고르세요 · 런이 끝날 때까지 유지돼요' : '보상을 하나 고르세요';
    this.row.replaceChildren();
    const picked = { done: false };
    offers.forEach((o, i) => {
      const c = button(`rw-card rarity-${o.rarity}`, '', this.row, () => {
        if (picked.done || this.shownKey !== key) return;
        picked.done = true;
        c.classList.add('is-picked');
        this.onChoose(i);
      });
      c.style.setProperty('--rc', RARITY_COLOR[o.rarity]);
      const tags = h('div', 'rw-tags', c);
      h('span', 'rw-rarity', tags, RARITY_LABEL[o.rarity]);
      if (o.isRelic) h('span', 'rw-relic', tags, '유물');
      else h('span', 'rw-kind', tags, o.partyIndex != null ? '캐릭터' : '파티');
      const icon = h('div', 'rw-icon', c);
      const m = o.partyIndex != null ? me?.party[o.partyIndex] : undefined;
      if (m) portrait(getCharacter(m.defId), 'portrait-md', icon);
      else h('div', `rw-gem ${o.isRelic ? 'is-relic' : ''}`, icon);
      h('div', 'rw-name', c, o.name);
      h('div', 'rw-desc', c, o.description);
      h('div', 'rw-pick', c, '선택');
    });
  }
}
