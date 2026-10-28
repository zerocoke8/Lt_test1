// 기획 15차: 메인 화면 (docs/expedition.md 8-1) — two mode cards before the preset: 「클래식 탑」 (today's game, unchanged)
// and 「원정」 (실험). The last picked mode is highlighted. Sound / fullscreen toggles as on the preset screen.
// 기획 16차: with a run in progress the 원정 card's foot says so (orange): 「진행 중: N단계 대기 · 가방 M」.
// 기획 19차: a third card 「보스 레이드」 (docs/boss-raid.md 7장) — 20 floor lamps in the four zone colours (lit up to my best
// floor) under a watching eye; the foot says 「최고 기록 N층 · 클리어 N회」 or 「첫 도전」.
// 기획 22차: a fourth card 「궁극기 테스트」 (docs/ult-test.md) — the raid with a choice of how the ult is used; its own
// record (never mixed with the raid's) and the ult mode last picked on its preset screen. Four narrower cards (ultTest.css).

import type { GearLoadout } from '../data/gear';
import { BOSS_RAID } from '../data';
import { raidRosterIds } from '../sim';
import { bossRaidFoot, type BossRaidRecord } from './bossRaidStore';
import { button, h, ICON_FULLSCREEN } from './dom';
import { createDoll } from './expeditionDoll';
import type { GameMode } from './expeditionStore';
import type { UltAimMode } from '../types';
import { ULT_MODE_LABEL } from '../sim/ultTest';
import { createSoundToggle } from './soundPanel';
import { toggleFullscreen } from './stage';

export interface MainMenuInfo {
  stashCount: number;
  maxStage: number;
  lastMode: GameMode | null;
  /** 기획 16차: the run in progress (next stage, bag size), else null. */
  run: { stage: number; bag: number; complete: boolean } | null;
  /** 기획 19차: this device's 보스 레이드 record (absent = never played). */
  bossRaid?: BossRaidRecord;
  /** 기획 22차: this device's 궁극기 테스트 record and the ult mode last picked for it. */
  ultTest?: BossRaidRecord;
  ultMode?: UltAimMode;
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

/** 기획 19차: the raid card's line — 「20층 · 층마다 보스 · 보스 N종」, N = the bosses that are on (BossDef.raid). PURE. */
export function raidCardSub(): string {
  return `${BOSS_RAID.floors}층 · 층마다 보스 · 보스 ${raidRosterIds().length}종`;
}

/** 기획 22차: the 궁극기 테스트 card's line. PURE. */
export const ULT_TEST_CARD_SUB = '보스 레이드 · 궁극기 조작 실험';

/** 기획 22차: the 궁극기 테스트 card's foot — the record, then the mode last picked ('최고 기록 3층 · 방식 조준'). PURE. */
export function ultTestFoot(rec: BossRaidRecord, mode: UltAimMode): string {
  const head = rec.runs > 0 || rec.bestFloor > 0 ? `최고 기록 ${rec.bestFloor}층` : '첫 도전';
  return `${head} · 방식 ${ULT_MODE_LABEL[mode]}`;
}

export function createMainMenu(parent: HTMLElement, cb: { onClassic(): void; onExpedition(): void; onBossRaid(): void; onUltTest(): void }): MainMenu {
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
  h('div', 'mm-card-sub', exp, '12단계 · 단계마다 로비 · 나가면 장비를 지켜요');
  const foot = h('div', 'mm-card-foot mm-exp-foot', exp);

  // 기획 19차 보스 레이드: an eye over 20 floor lamps (4 zones × 5, bottom row = floors 1–5)
  const raid = button('mm-card mm-raid', '', cards, () => cb.onBossRaid());
  raid.dataset.sfx = 'ui.start';
  const raidArt = h('div', 'mm-art mm-raid-art', raid);
  const eye = h('div', 'mm-raid-eye', raidArt);
  h('div', 'mm-raid-pupil', eye);
  const lampBox = h('div', 'mm-raid-lamps', raidArt);
  const lamps: HTMLElement[] = [];
  for (let f = 1; f <= BOSS_RAID.floors; f++) {
    const lamp = h('i', `mm-raid-lamp is-zone${Math.ceil(f / BOSS_RAID.perZone)}`, lampBox);
    if (f % BOSS_RAID.relicEvery === 0) lamp.classList.add('is-relic');
    lamps.push(lamp);
  }
  h('div', 'mm-card-title', raid, '보스 레이드');
  h('div', 'mm-card-sub', raid, raidCardSub());
  const raidFoot = h('div', 'mm-card-foot mm-raid-foot', raid);

  // 기획 22차 궁극기 테스트: the ult button, a dashed aim line and a target reticle
  const ult = button('mm-card mm-ult', '', cards, () => cb.onUltTest());
  ult.dataset.sfx = 'ui.start';
  h('span', 'mm-chip', ult, '실험');
  const ultArt = h('div', 'mm-art mm-ult-art', ult);
  h('div', 'mm-ult-path', ultArt);
  const target = h('div', 'mm-ult-target', ultArt);
  h('i', 'mm-ult-ring', target);
  h('i', 'mm-ult-dot', target);
  const ultBtn = h('div', 'mm-ult-btn', ultArt);
  h('span', '', ultBtn, '궁');
  h('div', 'mm-card-title', ult, '궁극기 테스트');
  h('div', 'mm-card-sub', ult, ULT_TEST_CARD_SUB);
  const ultFoot = h('div', 'mm-card-foot mm-ult-foot', ult);

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
      foot.textContent = info.run
        ? info.run.complete
          ? `원정 완주 · 가방 ${info.run.bag} 수령 대기`
          : `진행 중: ${info.run.stage}단계 대기 · 가방 ${info.run.bag}`
        : `보관함 ${info.stashCount}개 · ${info.maxStage}단계부터 출발 가능`;
      foot.classList.toggle('is-run', !!info.run);
      classic.classList.toggle('is-last', info.lastMode === 'classic');
      exp.classList.toggle('is-last', info.lastMode === 'expedition');
      raid.classList.toggle('is-last', info.lastMode === 'bossRaid');
      const rec = info.bossRaid ?? { bestFloor: 0, clears: 0, runs: 0 };
      raidFoot.textContent = bossRaidFoot(rec);
      raidFoot.classList.toggle('is-record', rec.bestFloor > 0);
      lamps.forEach((lamp, i) => lamp.classList.toggle('is-on', i < rec.bestFloor));
      ult.classList.toggle('is-last', info.lastMode === 'ultTest');
      ultFoot.textContent = ultTestFoot(info.ultTest ?? { bestFloor: 0, clears: 0, runs: 0 }, info.ultMode ?? 'now');
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
