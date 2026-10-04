// 층 보상 선택 (R20): state.phase === 'reward' && rewardOffers → 3 cards → chooseReward. Time is frozen by the sim.

import type { GameState, RewardOffer } from '../types';
import { RARITY_COLOR, RARITY_LABEL, getCharacter } from '../data';
import { button, h } from './dom';
import { portrait } from './preset';
import { LOCAL_PLAYER } from './hud';

export class RewardOverlay {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly row: HTMLElement;
  private shown: RewardOffer[] | null = null;
  private readonly onChoose: (index: number) => void;

  constructor(parent: HTMLElement, onChoose: (index: number) => void) {
    this.onChoose = onChoose;
    this.el = h('div', 'screen reward is-hidden', parent);
    const head = h('div', 'rw-head', this.el);
    this.title = h('div', 'rw-title', head);
    this.sub = h('div', 'rw-sub', head);
    this.row = h('div', 'rw-row', this.el);
  }

  get visible(): boolean {
    return this.shown != null;
  }

  update(s: GameState): void {
    const offers = s.phase === 'reward' ? s.rewardOffers : null;
    if (offers === this.shown) return;
    this.shown = offers;
    this.el.classList.toggle('is-hidden', !offers);
    if (!offers) {
      this.row.replaceChildren();
      return;
    }
    const relic = offers.some(o => o.isRelic);
    this.title.textContent = `${s.floor}층 클리어!`;
    this.sub.textContent = relic ? '유물을 하나 고르세요 · 런이 끝날 때까지 유지돼요' : '보상을 하나 고르세요';
    this.row.replaceChildren();
    const me = s.players[LOCAL_PLAYER];
    offers.forEach((o, i) => {
      const c = button(`rw-card rarity-${o.rarity}`, '', this.row, () => {
        if (this.shown !== offers) return;
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
