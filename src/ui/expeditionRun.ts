// 기획 15차 원정 런 화면 (docs/expedition.md 8-4 ~ 8-8): the in-run stage pill (floor dots + 가방 chip, tap = bag preview),
// the stage-clear screen (loot reveal + 수령하고 나가기 / 다음 단계 도전, double tap when the bag is at stake), the match
// wait (seats, 15 s ring, bots fill), the failure screen (bag lost, worn gear safe) and the extract screen.
// The screens only show what they are given and report taps; src/ui/expeditionSolo.ts drives them.

import { getCharacter } from '../data';
import { BAND_COLOR, RARITY_STARS, SLOT_NAME_KO, bandOf, type GearLoadout, type GearSpec } from '../data/gear';
import { isBossStage } from '../data/stages';
import { bagSummary } from '../expedition/run';
import type { GameState, RunResult } from '../types';
import { sfx } from '../audio';
import { button, h, setClass, setText, show } from './dom';
import { createDoll } from './expeditionDoll';
import { familyOf, gearName, recommendWearers, stageTitle } from './expeditionFormat';
import { inspectTiles, type GearInspect } from './expeditionInfo';
import { formatClock, formatNumber } from './format';

// ─────────────────────────── pure helpers (tests/ui/expedition-logic.test.ts) ───────────────────────────

/** 「다음 단계 도전」 needs a second tap within this long while the bag is not empty (5장). */
export const CONFIRM_MS = 3000;
/** Match queue: bots fill the empty seats after this long (7장). */
export const MATCH_SECONDS = 15;
/** Solo / offline: 「혼자 하기 · 봇 2명과 출발」 shows this long before the stage starts (8-6). */
export const SOLO_MATCH_MS = 1000;

/** Double-tap guard: returns whether this tap goes through, and the new armed time (null = disarmed). */
export function confirmTap(armedAt: number | null, now: number, needConfirm: boolean, windowMs = CONFIRM_MS): { go: boolean; armedAt: number | null } {
  if (!needConfirm) return { go: true, armedAt: null };
  if (armedAt != null && now - armedAt <= windowMs) return { go: true, armedAt: null };
  return { go: false, armedAt: now };
}

/** Whether a guard armed at `armedAt` is still armed at `now`. */
export function isArmed(armedAt: number | null, now: number, windowMs = CONFIRM_MS): boolean {
  return armedAt != null && now - armedAt <= windowMs;
}

/** Whole seconds left of a countdown that started at `startedAt` (ms) and lasts `total` s (never below 0). */
export function countdownLeft(startedAt: number, now: number, total = MATCH_SECONDS): number {
  return Math.max(0, Math.ceil(total - (now - startedAt) / 1000 - 1e-9));
}

/** Seat labels of the match screen: who is there, then bots once the wait is over, else empty seats. */
export function matchSeatsView(humans: number, seats: number, botsIn: boolean): ('human' | 'bot' | 'empty')[] {
  return Array.from({ length: seats }, (_, i) => (i < humans ? 'human' : botsIn ? 'bot' : 'empty'));
}

/** [tier, count] of a bag, highest tier first (the choice screen's 걸린 장비 chips). */
export function tierCounts(bag: readonly GearSpec[]): [number, number][] {
  const m = new Map<number, number>();
  for (const g of bag) m.set(g.tier, (m.get(g.tier) ?? 0) + 1);
  return [...m].sort((a, b) => b[0] - a[0]);
}

/** Highest band in a bag (0 = empty): the HUD chip border colour. */
export function bagTopBand(bag: readonly GearSpec[]): number {
  return bag.reduce((m, g) => Math.max(m, bandOf(g.tier)), 0);
}

// ─────────────────────────── in-run pill (8-4) ───────────────────────────

export class ExpeditionPill {
  readonly el: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly bagChip: HTMLButtonElement;
  private readonly preview: HTMLElement;
  private bag: readonly GearSpec[] = [];
  private family: string | null = null;
  private inspect: GearInspect | null = null;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'exp-pill hud-block', parent);
    const dots = h('div', 'exp-pill-dots', this.el);
    for (let i = 0; i < 3; i++) this.dots.push(h('span', 'exp-pill-dot', dots));
    this.bagChip = button('exp-pill-bag', '', this.el, () => this.togglePreview());
    this.bagChip.dataset.sfx = 'ui.tap.soft';
    this.preview = h('div', 'exp-bag-preview is-hidden', parent);
  }

  setBag(bag: readonly GearSpec[], family: string | null, inspect: GearInspect | null = null): void {
    this.bag = bag;
    this.family = family;
    this.inspect = inspect;
    const top = bagTopBand(bag);
    setText(this.bagChip, `가방 ${bag.length}`);
    this.bagChip.style.setProperty('--bc', top ? BAND_COLOR[top] : 'rgba(255,255,255,0.25)');
    if (!this.preview.classList.contains('is-hidden')) this.fillPreview();
  }

  update(s: GameState): void {
    const ex = s.expedition;
    show(this.el, !!ex);
    if (!ex) return;
    this.dots.forEach((d, i) => {
      const f = i + 1;
      setClass(d, 'is-done', f < s.floor || (f === s.floor && ex.outcome === 'cleared'));
      setClass(d, 'is-now', f === s.floor && ex.outcome === 'running');
      setClass(d, 'is-last', f === 3);
      setClass(d, 'is-boss', f === 3 && ex.boss);
      setText(d, f === 3 ? (ex.boss ? '☠' : '◆') : '');
    });
  }

  private togglePreview(): void {
    const open = this.preview.classList.contains('is-hidden');
    this.preview.classList.toggle('is-hidden', !open);
    if (open) this.fillPreview();
  }

  private fillPreview(): void {
    this.preview.replaceChildren();
    h('div', 'exp-bag-preview-title', this.preview, this.bag.length ? `원정 가방 ${this.bag.length}개 · 실패하면 잃어요` : '가방이 비었어요 · 단계를 깨면 장비가 들어와요');
    const g = h('div', 'exp-bag-preview-grid', this.preview);
    const host = this.preview.parentElement ?? this.preview;
    inspectTiles(g, host, this.bag, this.inspect, () => ({ family: this.family, size: 80 }));
  }

  destroy(): void {
    this.el.remove();
    this.preview.remove();
  }
}

// ─────────────────────────── stage clear + choice (8-5) ───────────────────────────

export interface ChoiceView {
  stage: number;
  /** This stage's loot (revealed one by one). */
  loot: GearSpec[];
  /** The whole bag including this stage's loot. */
  bag: GearSpec[];
  /** Floor-reward buffs carried / lost. */
  buffs: number;
  /** Stage 12 cleared: extract only (원정 완주). */
  complete: boolean;
  /** Multiplayer: auto-extract deadline (Date.now() ms), null = none (solo). */
  deadline: number | null;
  /** Weapon look for the tiles (the party's first character id). */
  family: string | null;
  /** Tap a tile → its sheet, compared with what the party wears (null = no compare). */
  inspect: GearInspect | null;
}

export class ChoiceScreen {
  readonly el: HTMLElement;
  private view: ChoiceView | null = null;
  private armedAt: number | null = null;
  private contBtn: HTMLButtonElement | null = null;
  private contSub: HTMLElement | null = null;
  private timer: HTMLElement | null = null;
  private decided = false;
  private readonly cb: { onExtract(): void; onContinue(): void };

  constructor(parent: HTMLElement, cb: { onExtract(): void; onContinue(): void }) {
    this.cb = cb;
    this.el = h('div', 'screen exp-choice exp-screen is-hidden', parent);
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  show(v: ChoiceView): void {
    this.view = v;
    this.armedAt = null;
    this.decided = false;
    this.el.classList.remove('is-hidden');
    this.render();
    sfx.ui('reward.open');
    v.loot.forEach((g, i) => {
      const band = bandOf(g.tier);
      sfx.ui('exp.reveal', { delay: 0.35 + i * 0.32, rate: Math.pow(2, (band - 1) / 5) });
      if (g.slot === 'relic') sfx.ui('exp.relic', { delay: 0.5 + i * 0.32 });
    });
  }

  hide(): void {
    this.el.classList.add('is-hidden');
    this.view = null;
  }

  /** Per frame: countdown text and the double-tap guard running out. */
  tick(): void {
    const v = this.view;
    if (!v) return;
    if (this.timer && v.deadline != null) {
      const left = Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000));
      setText(this.timer, `${left}초 뒤 자동으로 수령해요`);
      setClass(this.timer, 'is-urgent', left <= 5);
    }
    if (this.armedAt != null && !isArmed(this.armedAt, performance.now())) {
      this.armedAt = null;
      this.syncContinue();
    }
  }

  private render(): void {
    const v = this.view!;
    const el = this.el;
    el.replaceChildren();
    const head = h('div', 'exp-ch-head', el);
    h('div', 'exp-ch-title', head, v.complete ? '원정 완주!' : `${v.stage}단계 클리어!`);
    h('div', 'exp-ch-sub', head, v.complete ? '12단계를 모두 깼어요 · 가방을 모두 받아요' : '장비를 가방에 담았어요');
    this.timer = v.deadline != null ? h('div', 'exp-ch-timer', head) : null;

    const main = h('div', 'exp-ch-main', el);
    const left = h('div', 'exp-ch-left', main);
    const reveal = h('div', 'exp-ch-reveal', left);
    const wearers = v.inspect ? recommendWearers(v.loot, v.inspect.party, v.inspect.loadouts) : [];
    v.loot.forEach((g, i) => {
      const col = h('div', 'exp-loot-col', reveal);
      const card = h('div', `exp-loot band-${bandOf(g.tier)}${g.slot === 'relic' ? ' is-relic' : ''}`, col);
      card.style.setProperty('--bc', BAND_COLOR[bandOf(g.tier)]);
      card.style.setProperty('--d', `${0.3 + i * 0.32}s`);
      const inner = h('div', 'exp-loot-inner', card);
      h('div', 'exp-loot-back', inner, '?');
      const front = h('div', 'exp-loot-front', inner);
      inspectTiles(front, el, [g], v.inspect, () => ({ family: v.family, size: 128 }), [wearers[i] ?? null]);
      if (g.slot === 'relic') h('div', 'exp-loot-stamp', front, '유물!');
      // what it is, readable before deciding (name · slot · stars; ▲ = better than what someone wears)
      const cap = h('div', 'exp-loot-cap', col);
      cap.style.setProperty('--d', `${0.6 + i * 0.32}s`);
      const nm = h('div', 'exp-loot-name', cap, gearName(g, familyOf(wearers[i] ?? v.family)));
      nm.style.color = BAND_COLOR[bandOf(g.tier)];
      const stars = RARITY_STARS[g.rarity];
      h('div', 'exp-loot-slot', cap, `${SLOT_NAME_KO[g.slot]}${stars ? ` ${stars}` : ''}`);
      if (wearers[i]) h('div', 'exp-loot-up', cap, `▲ ${getCharacter(wearers[i]!).name}`);
    });
    const sum = bagSummary(v.bag);
    h('div', 'exp-ch-baghead', left, `원정 가방 ${sum.count}개 · 최고 T${sum.topTier} · 눌러서 보기`);
    const grid = h('div', 'exp-ch-bag', left);
    const newFrom = v.bag.length - v.loot.length;
    inspectTiles(grid, el, v.bag, v.inspect, i => ({ family: v.family, isNew: i >= newFrom, size: 84 }));

    const right = h('div', 'exp-ch-right', main);
    // what 「도전」 puts at stake: a count and band-coloured tier chips (T1×2 · T4×1)
    const risk = h('div', 'exp-risk', right);
    h('span', 'exp-risk-label', risk, `걸린 장비 ${sum.count}개`);
    for (const [tier, n] of tierCounts(v.bag)) {
      const chip = h('span', 'exp-risk-chip', risk, `T${tier}×${n}`);
      chip.style.setProperty('--bc', BAND_COLOR[bandOf(tier)]);
    }
    const ext = button('exp-choice-btn exp-extract', '', right, () => this.choose('extract'));
    ext.dataset.sfx = '';
    h('div', 'exp-exit-icon', ext);
    const et = h('div', 'exp-choice-text', ext);
    h('div', 'exp-choice-title', et, v.complete ? '모두 수령하기' : '장비 수령하고 나가기');
    h('div', 'exp-choice-sub', et, `가방 ${sum.count}개 모두 보관함으로${v.buffs ? ` · 층 보상 버프 ${v.buffs}개는 사라져요` : ''}`);
    if (!v.complete) {
      const next = v.stage + 1;
      if (isBossStage(next)) h('div', 'exp-next-boss', right, '다음은 보스 단계 — 장비 3개 + 유물 확률');
      const cont = button('exp-choice-btn exp-continue', '', right, () => this.choose('continue'));
      cont.dataset.sfx = '';
      const ct = h('div', 'exp-choice-text', cont);
      h('div', 'exp-choice-title', ct, '다음 단계 도전');
      h('div', 'exp-choice-sub', ct, `${stageTitle(next)} · 새 동료와 매칭${v.buffs ? ` · 버프 ${v.buffs}개 유지` : ''}`);
      this.contSub = h('div', 'exp-choice-risk', ct);
      this.contBtn = cont;
      this.syncContinue();
    } else {
      this.contBtn = null;
      this.contSub = null;
    }
  }

  private syncContinue(): void {
    const v = this.view;
    if (!v || !this.contBtn || !this.contSub) return;
    const armed = isArmed(this.armedAt, performance.now());
    this.contBtn.classList.toggle('is-armed', armed);
    this.contSub.textContent = armed ? `한 번 더 누르면 도전 · 가방 ${v.bag.length}개가 걸려요` : v.bag.length ? `실패하면 가방 ${v.bag.length}개를 잃어요 (장착 장비는 안전)` : '실패해도 잃을 장비가 없어요';
  }

  private choose(c: 'extract' | 'continue'): void {
    if (this.decided || !this.view) return;
    if (c === 'continue') {
      const r = confirmTap(this.armedAt, performance.now(), this.view.bag.length > 0);
      this.armedAt = r.armedAt;
      if (!r.go) {
        sfx.ui('ui.warn');
        this.syncContinue();
        return;
      }
      sfx.ui('ui.start');
    } else sfx.ui('exp.extract');
    this.decided = true;
    if (c === 'extract') this.cb.onExtract();
    else this.cb.onContinue();
  }
}

// ─────────────────────────── match wait (8-6) ───────────────────────────

export interface MatchSeat {
  name: string;
  characters: string[];
  gear: GearLoadout[];
  kind: 'human' | 'bot' | 'empty';
  me?: boolean;
}

export interface MatchView {
  stage: number;
  seats: MatchSeat[];
  /** null = no countdown (solo: bots at once). */
  secondsLeft: number | null;
  solo: boolean;
  continuing: boolean;
  buffs: number;
}

export class MatchScreen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly seatsEl: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly ringText: HTMLElement;
  private readonly btns: HTMLElement;
  private key = '';
  private readonly cb: { onStartNow(): void; onCancel(): void };

  constructor(parent: HTMLElement, cb: { onStartNow(): void; onCancel(): void }) {
    this.cb = cb;
    this.el = h('div', 'screen exp-match exp-screen is-hidden', parent);
    const head = h('div', 'exp-mt-head', this.el);
    this.title = h('div', 'exp-mt-title', head);
    this.sub = h('div', 'exp-mt-sub', head);
    const mid = h('div', 'exp-mt-mid', this.el);
    this.seatsEl = h('div', 'exp-mt-seats', mid);
    this.ring = h('div', 'exp-mt-ring', mid);
    this.ringText = h('div', 'exp-mt-ring-text', this.ring);
    this.btns = h('div', 'exp-mt-btns', this.el);
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  show(v: MatchView): void {
    this.el.classList.remove('is-hidden');
    this.update(v);
  }

  hide(): void {
    this.el.classList.add('is-hidden');
    this.key = '';
  }

  update(v: MatchView): void {
    setText(this.title, v.solo ? '혼자 하기 · 봇 2명과 출발' : `${v.stage}단계 동료 찾는 중`);
    setText(this.sub, v.solo ? `${stageTitle(v.stage)} · 빈자리는 봇이 채워요` : '같은 단계로 가는 사람과 최대 3명');
    const key = `${v.stage}|${v.solo}|${v.continuing}|${v.seats.map(s => `${s.kind}:${s.name}`).join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.seatsEl.replaceChildren();
      for (const s of v.seats) {
        const seat = h('div', `exp-seat is-${s.kind}${s.me ? ' is-me' : ''}`, this.seatsEl);
        if (s.kind === 'empty') {
          h('div', 'exp-seat-wait', seat, '기다리는 중…');
          continue;
        }
        // online seats are '플레이어N': mark mine like the battle does
        h('div', 'exp-seat-name', seat, s.me && s.name !== '나' ? `나 · ${s.name}` : s.name);
        const dolls = h('div', 'exp-seat-dolls', seat);
        s.characters.forEach((id, i) => createDoll(dolls, '', 86, 108, id, s.gear[i]));
        if (s.me) h('div', 'exp-seat-note', seat, v.buffs ? `버프 ${v.buffs}개 유지` : v.continuing ? '이어 가는 중' : '새 원정');
      }
      this.btns.replaceChildren();
      if (!v.solo) button('btn btn-primary exp-start-now', '바로 출발 (빈자리 봇)', this.btns, () => this.cb.onStartNow());
      button('btn btn-secondary exp-cancel', v.continuing ? '그만두고 수령하기' : '취소', this.btns, () => this.cb.onCancel());
    }
    show(this.ring, v.secondsLeft != null);
    if (v.secondsLeft != null) {
      setText(this.ringText, String(v.secondsLeft));
      this.ring.style.setProperty('--p', String(Math.max(0, Math.min(1, v.secondsLeft / MATCH_SECONDS))));
    }
  }
}

// ─────────────────────────── fail / extract (8-7, 8-8) ───────────────────────────

export interface FailView {
  reason: RunResult['reason'];
  stage: number;
  floor: number;
  lost: GearSpec[];
  party: string[];
  gear: GearLoadout[];
  /** Seconds played this run (all stages). */
  playTime: number;
  family: string | null;
  /** Detail rows (my contribution of the last stage). */
  details: { label: string; value: number }[];
}

export interface ExtractView {
  items: GearSpec[];
  /** Per item: '▲ 가디언 장착 추천' (or ''). */
  recommend: string[];
  buffsLost: number;
  complete: boolean;
  family: string | null;
  /** Tap a tile → its sheet, compared with what the party wears. */
  inspect?: GearInspect | null;
}

export class RunResultScreen {
  readonly el: HTMLElement;
  private readonly cb: { onHub(): void; onEquipNew(): void };

  constructor(parent: HTMLElement, cb: { onHub(): void; onEquipNew(): void }) {
    this.cb = cb;
    this.el = h('div', 'screen exp-result exp-screen is-hidden', parent);
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  hide(): void {
    this.el.classList.add('is-hidden');
  }

  showFail(v: FailView): void {
    const el = this.el;
    el.replaceChildren();
    el.classList.remove('is-hidden', 'is-extract');
    el.classList.add('is-fail');
    const head = h('div', 'exp-rs-head', el);
    h('div', 'exp-rs-title', head, '원정 실패');
    h('div', 'exp-rs-reason', head, v.reason === 'timeout' ? '시간 초과' : v.reason === 'quit' ? '도중에 나감' : '전멸');
    h('div', 'exp-rs-facts', head, `도달 ${v.stage}단계 ${v.floor}층 · 잃은 장비 ${v.lost.length}개 · 플레이 시간 ${formatClock(v.playTime)}`);
    const main = h('div', 'exp-rs-main', el);
    const left = h('div', 'exp-rs-col exp-rs-lost', main);
    h('div', 'exp-rs-col-title', left, v.lost.length ? '가방을 잃었어요' : '가방이 비어 있었어요');
    const g = h('div', 'exp-rs-grid', left);
    inspectTiles(g, el, v.lost, null, () => ({ family: v.family, size: 84 })).forEach((t, i) => t.style.setProperty('--d', `${0.4 + i * 0.12}s`));
    const right = h('div', 'exp-rs-col exp-rs-safe', main);
    h('div', 'exp-rs-col-title', right, '장착 장비는 그대로예요');
    const dolls = h('div', 'exp-rs-dolls', right);
    v.party.forEach((id, i) => {
      const c = h('div', 'exp-rs-doll', dolls);
      createDoll(c, '', 110, 138, id, v.gear[i]);
      h('div', 'exp-rs-doll-name', c, getCharacter(id).name);
    });
    const detail = h('div', 'exp-rs-detail is-hidden', el);
    for (const d of v.details) h('span', 'exp-rs-detail-row', detail, `${d.label} ${formatNumber(d.value)}`);
    const btns = h('div', 'exp-rs-btns', el);
    button('btn btn-secondary exp-rs-more', '상세 보기', btns, () => detail.classList.toggle('is-hidden'));
    button('btn btn-primary exp-rs-hub', '원정 허브로', btns, () => this.cb.onHub());
    if (v.lost.length) sfx.ui('exp.bagLost', { delay: 0.3 });
  }

  showExtract(v: ExtractView): void {
    const el = this.el;
    el.replaceChildren();
    el.classList.remove('is-hidden', 'is-fail');
    el.classList.add('is-extract');
    const head = h('div', 'exp-rs-head', el);
    h('div', 'exp-exit-icon is-big', head);
    h('div', 'exp-rs-title', head, v.complete ? '원정 완주!' : '탈출 성공!');
    const top = v.items.reduce<GearSpec | null>((m, g) => (!m || g.tier > m.tier ? g : m), null);
    const slotKo = top ? { weapon: '무기', armor: '방어구', charm: '장신구', relic: '유물' }[top.slot] : '';
    h('div', 'exp-rs-facts', head, `보관함 +${v.items.length}${top ? ` · 최고 T${top.tier} ${slotKo}` : ''}${v.buffsLost ? ` · 사라진 버프 ${v.buffsLost}개` : ''}`);
    const g = h('div', 'exp-rs-grid exp-rs-gained', el);
    const wearers = v.inspect ? recommendWearers(v.items, v.inspect.party, v.inspect.loadouts) : [];
    v.items.forEach((it, i) => {
      const cell = h('div', 'exp-rs-item', g);
      const [tile] = inspectTiles(cell, el, [it], v.inspect ?? null, () => ({ family: v.family, isNew: true, upgrade: !!v.recommend[i], size: 84 }), [wearers[i] ?? null]);
      tile.style.setProperty('--d', `${0.2 + i * 0.14}s`);
      if (v.recommend[i]) h('div', 'exp-rs-reco', cell, v.recommend[i]);
    });
    if (!v.items.length) h('div', 'exp-empty', g, '가져온 장비가 없어요');
    const btns = h('div', 'exp-rs-btns', el);
    if (v.items.length) button('btn btn-secondary exp-rs-equip', '바로 장착하기', btns, () => this.cb.onEquipNew());
    button('btn btn-primary exp-rs-hub', '원정 허브로', btns, () => this.cb.onHub());
  }
}
