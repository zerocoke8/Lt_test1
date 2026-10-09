// 기획 15차: 메인 화면 (docs/expedition.md 8-1) — two mode cards before the preset: 「클래식 탑」 (today's game, unchanged)
// and 「원정」 (실험). The last picked mode is highlighted. Sound / fullscreen toggles as on the preset screen.

import type { GearLoadout } from '../data/gear';
import { button, h, ICON_FULLSCREEN } from './dom';
import { createDoll } from './expeditionDoll';
import type { GameMode } from './expeditionStore';
import { createSoundToggle } from './soundPanel';
import { toggleFullscreen } from './stage';

export interface MainMenuInfo {
  stashCount: number;
  maxStage: number;
  lastMode: GameMode | null;
}

export interface MainMenu {
  readonly el: HTMLElement;
  readonly visible: boolean;
  show(info: MainMenuInfo): void;
  hide(): void;
  setNetNote(text: string): void;
}

const SHOWCASE: { id: string; tier: number }[] = [
  { id: 'guardian', tier: 5 },
  { id: 'blade', tier: 11 },
  { id: 'mage', tier: 8 },
];

function showcaseLoadout(tier: number): GearLoadout {
  return {
    weapon: { slot: 'weapon', tier, rarity: 'common' },
    armor: { slot: 'armor', tier, rarity: 'common' },
    charm: { slot: 'charm', tier, rarity: 'common' },
    ...(tier >= 9 ? { relic: { slot: 'relic' as const, tier: 9, rarity: 'rare' as const, relicId: 'phoenix_feather' } } : null),
  };
}

export function createMainMenu(parent: HTMLElement, cb: { onClassic(): void; onExpedition(): void }): MainMenu {
  const el = h('div', 'screen main-menu is-hidden', parent);
  const head = h('div', 'mm-head', el);
  h('div', 'mm-logo', head, '스왑 타워');
  const right = h('div', 'mm-head-right', head);
  const net = h('div', 'mm-net is-hidden', right);
  // the sound toggle is built on first show (one '.snd-mini' on the page while the main menu was never opened)
  let sound: HTMLElement | null = null;
  const fs = button('icon-btn', '', right, () => void toggleFullscreen());
  fs.innerHTML = ICON_FULLSCREEN;
  fs.setAttribute('aria-label', '전체 화면');

  const cards = h('div', 'mm-cards', el);
  const classic = button('mm-card mm-classic', '', cards, () => cb.onClassic());
  classic.dataset.sfx = 'ui.start';
  const tower = h('div', 'mm-art mm-tower', classic);
  for (let i = 0; i < 5; i++) h('div', 'mm-tower-floor', tower);
  h('div', 'mm-card-title', classic, '클래식 탑');
  h('div', 'mm-card-sub', classic, '20층 · 층마다 보상 · 보스층 유물 · 매번 새로 시작');
  h('div', 'mm-card-foot', classic, '지금까지의 게임 그대로');

  const exp = button('mm-card mm-exp', '', cards, () => cb.onExpedition());
  exp.dataset.sfx = 'ui.start';
  h('span', 'mm-chip', exp, '실험');
  const art = h('div', 'mm-art mm-exp-art', exp);
  const door = h('div', 'mm-door', art);
  h('div', 'mm-exit-sign', door, 'EXIT');
  const bag = h('div', 'mm-bag', art);
  h('div', 'mm-bag-strap', bag);
  h('div', 'mm-bag-flap', bag);
  const heroes = h('div', 'mm-heroes', art);
  for (const s of SHOWCASE) createDoll(heroes, 'mm-hero', 120, 150, s.id, showcaseLoadout(s.tier));
  h('div', 'mm-card-title', exp, '원정');
  h('div', 'mm-card-sub', exp, '12단계 × 3층 · 장비 파밍 · 나가면 장비를 지켜요');
  const foot = h('div', 'mm-card-foot mm-exp-foot', exp);

  let visible = false;
  return {
    el,
    get visible() {
      return visible;
    },
    show(info) {
      visible = true;
      if (!sound) right.insertBefore((sound = createSoundToggle(right)), fs);
      el.classList.remove('is-hidden');
      foot.textContent = `보관함 ${info.stashCount}개 · ${info.maxStage}단계부터 출발 가능`;
      classic.classList.toggle('is-last', info.lastMode === 'classic');
      exp.classList.toggle('is-last', info.lastMode === 'expedition');
    },
    hide() {
      visible = false;
      el.classList.add('is-hidden');
    },
    setNetNote(text) {
      net.textContent = text;
      net.classList.toggle('is-hidden', !text);
    },
  };
}
