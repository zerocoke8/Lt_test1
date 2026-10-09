// 기획 15차 원정 런 화면 (docs/expedition.md 8-5 ~ 8-8): the in-run stage pill (가방 chip, tap = bag preview), the loot
// reveal, the match wait (seats, 15 s ring, bots fill), the failure screen (bag lost, worn gear safe) and the claim
// screen. 기획 16차: the in-game choice screen is gone — every stage ends in the 원정 lobby (src/ui/expeditionHub.ts),
// which shows the loot reveal (LootReveal, moved here from the choice screen) and decides 「수령」 / 「N단계 매칭」.
// The screens only show what they are given and report taps; src/ui/expeditionSolo.ts drives them.

import { getCharacter } from '../data';
import { BAND_COLOR, RARITY_STARS, SLOT_NAME_KO, bandOf, type GearLoadout, type GearSpec } from '../data/gear';
import { EXPEDITION_STAGES, isBossStage } from '../data/stages';
import { bagSummary, runComplete, type ExpeditionRun } from '../expedition/run';
import { runBuffCount } from '../expedition/stash';
import type { GameState, RunResult } from '../types';
import { sfx } from '../audio';
import { button, h, setText, show } from './dom';
import { createDoll } from './expeditionDoll';
import { familyOf, gearName, nextStageCard, recommendWearers, stageTitle } from './expeditionFormat';
import { inspectTiles, type GearInspect } from './expeditionInfo';
import { formatClock, formatNumber } from './format';

// ─────────────────────────── pure helpers (tests/ui/expedition-logic.test.ts) ───────────────────────────

/** 「N단계 매칭」 needs a second tap within this long while the bag is not empty (5-2). */
export const CONFIRM_MS = 3000;
/** Match queue: bots fill the empty seats after this long (7장). */
export const MATCH_SECONDS = 15;
/** Solo / offline: 「혼자 하기 · 봇 2명과 출발」 shows this long before the stage starts (8-6). */
export const SOLO_MATCH_MS = 1000;
/** 기획 16차: a won stage stays on screen this long (the clear banner) before the lobby. */
export const STAGE_END_MS = 1500;

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

// ─────────────────────────── in-run pill (8-5) ───────────────────────────

/**
 * The bag chip of a stage game (기획 16차 review: in the top-right row, left of DBG / the timer — never stacked under
 * the centre panels over the fight; the stage itself is named by the floor box / the boss bar).
 */
export class ExpeditionPill {
  readonly el: HTMLElement;
  private readonly bagChip: HTMLButtonElement;
  private readonly preview: HTMLElement;
  private bag: readonly GearSpec[] = [];
  private family: string | null = null;
  private inspect: GearInspect | null = null;

  /** `row` = the HUD's top-right row (the chip goes first in it; the preview opens under the row). */
  constructor(row: HTMLElement) {
    this.el = h('div', 'exp-pill hud-block');
    row.prepend(this.el);
    this.bagChip = button('exp-pill-bag', '', this.el, () => this.togglePreview());
    this.bagChip.dataset.sfx = 'ui.tap.soft';
    this.preview = h('div', 'exp-bag-preview is-hidden', row);
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
    show(this.el, !!s.expedition);
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

// ─────────────────────────── lobby run view (기획 16차, 8-3) ───────────────────────────

export type PathDot = 'skip' | 'done' | 'next' | 'todo';

export interface RunLobbyView {
  /** '원정 진행 중 · 3단계까지 클리어' (or '원정 시작 · 1단계 대기'). */
  title: string;
  /** 12 dots: before the start stage / cleared / next / later; boss stages get a gold skull. */
  path: { stage: number; dot: PathDot; boss: boolean }[];
  bagCount: number;
  topTier: number;
  /** [tier, count], highest first. */
  tiers: [number, number][];
  /** Bag head line: '가방 5개 · 최고 T3' / '가방이 비었어요'. */
  bagHead: string;
  /** Bag index → NEW (it came from the stage just cleared). */
  isNew: boolean[];
  next: number;
  nextLine: string;
  nextLoot: string;
  nextBoss: boolean;
  /** Red risk line. */
  risk: string;
  buffs: number;
  claimSub: string;
  matchTitle: string;
  matchSub: string;
  /** 「N단계 매칭」 needs a double tap (the bag is at stake). */
  needConfirm: boolean;
  /** A stage of the run is being played / its result is awaited (no buttons). */
  waiting: boolean;
  /** Stage 12 cleared: claim only. */
  complete: boolean;
}

/** The lobby's run panel, from the stored run (pure). */
export function runLobbyView(run: ExpeditionRun): RunLobbyView {
  const sum = bagSummary(run.bag);
  const buffs = runBuffCount(run);
  const last = run.stage - 1;
  const card = nextStageCard(Math.min(run.stage, EXPEDITION_STAGES));
  const path = Array.from({ length: EXPEDITION_STAGES }, (_, i) => {
    const st = i + 1;
    const dot: PathDot = st < run.startStage ? 'skip' : st < run.stage ? 'done' : st === run.stage ? 'next' : 'todo';
    return { stage: st, dot, boss: isBossStage(st) };
  });
  return {
    title: run.cleared > 0 ? `원정 진행 중 · ${last}단계까지 클리어` : `원정 시작 · ${run.stage}단계 대기`,
    path,
    bagCount: sum.count,
    topTier: sum.topTier,
    tiers: tierCounts(run.bag),
    bagHead: sum.count ? `가방 ${sum.count}개 · 최고 T${sum.topTier}` : '가방이 비었어요',
    isNew: run.bag.map(g => g.tier === last),
    next: run.stage,
    nextLine: card.line,
    nextLoot: card.loot,
    nextBoss: card.boss,
    risk: sum.count ? `실패하면 가방 ${sum.count}개를 잃어요 (장착 장비는 안전)` : '가방이 비어 있어요 · 실패해도 잃을 장비가 없어요',
    buffs,
    claimSub: sum.count ? `가방 ${sum.count}개 모두 보관함으로${buffs ? ` · 버프 ${buffs}개는 사라져요` : ''}` : `가방이 비어 있어요 · 원정을 끝내요${buffs ? ` · 버프 ${buffs}개는 사라져요` : ''}`,
    matchTitle: `${run.stage}단계 매칭`,
    matchSub: `새 동료와 매칭${buffs ? ` · 버프 ${buffs}개 유지` : ''}`,
    needConfirm: sum.count > 0,
    waiting: run.status === 'inStage',
    complete: runComplete(run),
  };
}

// ─────────────────────────── loot reveal (8-3: cards flip in the lobby) ───────────────────────────

export interface RevealView {
  stage: number;
  loot: GearSpec[];
  /** Bag size after this stage. */
  bagCount: number;
  family: string | null;
  inspect: GearInspect | null;
}

/**
 * 기획 16차: back in the lobby after a cleared stage, this stage's loot flips face up (band-pitched 「칭」, a gold 「유물!」
 * stamp) over the lobby; 「가방에 넣기」 (or a tap outside the cards) closes it and the NEW tiles pop into the bag grid.
 */
export class LootReveal {
  readonly el: HTMLElement;
  private onDone: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'exp-reveal is-hidden', parent);
    this.el.addEventListener('click', ev => {
      if (ev.target === this.el) this.close();
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  show(v: RevealView, onDone: () => void): void {
    this.onDone = onDone;
    const el = this.el;
    el.replaceChildren();
    el.classList.remove('is-hidden');
    const box = h('div', 'exp-reveal-box', el);
    h('div', 'exp-reveal-title', box, `${v.stage}단계 클리어!`);
    h('div', 'exp-reveal-sub', box, v.loot.length ? `가방 +${v.loot.length} · 이제 가방 ${v.bagCount}개` : `이번 단계 전리품 없음 · 가방 ${v.bagCount}개`);
    const reveal = h('div', 'exp-ch-reveal', box);
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
      const cap = h('div', 'exp-loot-cap', col);
      cap.style.setProperty('--d', `${0.6 + i * 0.32}s`);
      const nm = h('div', 'exp-loot-name', cap, gearName(g, familyOf(wearers[i] ?? v.family)));
      nm.style.color = BAND_COLOR[bandOf(g.tier)];
      const stars = RARITY_STARS[g.rarity];
      h('div', 'exp-loot-slot', cap, `${SLOT_NAME_KO[g.slot]}${stars ? ` ${stars}` : ''}`);
      if (wearers[i]) h('div', 'exp-loot-up', cap, `▲ ${getCharacter(wearers[i]!).name}`);
    });
    h('div', 'exp-reveal-note', box, '가방 장비는 「수령」한 뒤에 낄 수 있어요');
    button('btn btn-primary exp-reveal-ok', '가방에 넣기', box, () => this.close());
    sfx.ui('reward.open');
    v.loot.forEach((g, i) => {
      sfx.ui('exp.reveal', { delay: 0.35 + i * 0.32, rate: Math.pow(2, (bandOf(g.tier) - 1) / 5) });
      if (g.slot === 'relic') sfx.ui('exp.relic', { delay: 0.5 + i * 0.32 });
    });
  }

  hide(): void {
    this.el.classList.add('is-hidden');
    this.onDone = null;
  }

  private close(): void {
    if (!this.visible) return;
    const done = this.onDone;
    this.hide();
    done?.();
  }
}

// ─────────────────────────── match wait (8-6) ───────────────────────────

export interface MatchSeat {
  name: string;
  characters: string[];
  gear: GearLoadout[];
  kind: 'human' | 'bot' | 'empty';
  me?: boolean;
  /** Buffs carried (other people's seats). */
  buffs?: number;
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
        else if (s.kind === 'human' && s.buffs) h('div', 'exp-seat-note', seat, `버프 ${s.buffs}개`);
      }
      this.btns.replaceChildren();
      if (!v.solo) button('btn btn-primary exp-start-now', '바로 출발 (빈자리 봇)', this.btns, () => this.cb.onStartNow());
      // 기획 16차: 「취소」 = back to the lobby, the bag stays (no claiming from the queue)
      button('btn btn-secondary exp-cancel', '취소', this.btns, () => this.cb.onCancel());
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
  /** 기획 16차: overrides the reason line (e.g. a solo stage whose tab was closed). */
  reasonText?: string;
  stage: number;
  lost: GearSpec[];
  party: string[];
  gear: GearLoadout[];
  /** Seconds played in the lost stage (0 = unknown). */
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
    h('div', 'exp-rs-reason', head, v.reasonText ?? (v.reason === 'timeout' ? '시간 초과' : v.reason === 'quit' ? '도중에 나감' : '전멸'));
    const time = v.playTime > 0 ? ` · 이번 단계 ${formatClock(v.playTime)}` : '';
    h('div', 'exp-rs-facts', head, `도달 ${v.stage}단계 · 잃은 장비 ${v.lost.length}개${time}`);
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
    if (v.details.length) button('btn btn-secondary exp-rs-more', '상세 보기', btns, () => detail.classList.toggle('is-hidden'));
    button('btn btn-primary exp-rs-hub', '원정 로비로', btns, () => this.cb.onHub());
    if (v.lost.length) sfx.ui('exp.bagLost', { delay: 0.3 });
  }

  showExtract(v: ExtractView): void {
    const el = this.el;
    el.replaceChildren();
    el.classList.remove('is-hidden', 'is-fail');
    el.classList.add('is-extract');
    const head = h('div', 'exp-rs-head', el);
    h('div', 'exp-exit-icon is-big', head);
    h('div', 'exp-rs-title', head, v.complete ? '원정 완주!' : '수령 완료!');
    el.classList.toggle('is-complete', v.complete);
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
    button('btn btn-primary exp-rs-hub', '원정 로비로', btns, () => this.cb.onHub());
  }
}
