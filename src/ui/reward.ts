// 층 보상 선택 (R20, R33 → 기획 17차 docs/floor-rewards.md): my offers = state.rewardOffersByPlayer[localPlayer] → 3 cards
// (욕심쟁이: 4 cards, pick 2) → chooseReward {offerIndex, member}. Each card: rarity pill (일반 희귀 영웅 전설) + kind chip
// (+ red 저주 / pink 협동), icon, 「보유 ×N」, name, description, red 대가 line, synergy tag chips 「#퇴장 ●●○ 2/3」 (gold
// 「3/3 완성!」 + the set bonus when this card completes one), 「누구에게?」 portraits (지명권; the default member is
// preselected so one tap on 「선택」 confirms; a role card follows the tapped member's role) and the pick button.
// Header: 「내 빌드」 chip (the build sheet) and 「다시 뽑기 N」 (hidden on relic screens; disabled at 0 or ≤ 3 s left).
// Multiplayer: a countdown naming the card the server will pick (botPickIndex), and after choosing a waiting panel with
// the card I took. A pick that completes a set stamps 「#퇴장 3개 모음!」 for 1.2 s.

import type { GameEvent, GameState, PlayerState, Rarity, RewardOffer, Role, SynergyTag } from '../types';
import { RARITY_COLOR, RARITY_LABEL, RELIC_TAGS, ROLE_NAME, ROLE_TAGS, TAG_INFO, TAG_SET_BONUS, TAG_SET_SIZE, getCharacter, getFamily, getReward, hasFamily } from '../data';
import { REROLL_MIN_LEFT_SEC } from '../net/protocol';
import { botPickIndex } from '../sim/rewards/botPick';
import { rewardCount, tagCounts } from '../sim/rewards/query';
import { button, h, setClass, setText, show } from './dom';
import { portrait } from './preset';
import { buildSummary, renderBuild } from './buildPanel';

export interface RewardView {
  localPlayer: number;
  /** Multiplayer run: show the waiting panel when I have nothing (left) to pick. */
  multi: boolean;
  /** Auto-pick deadline on the local clock (Date.now() ms), null = none. */
  deadline: number | null;
}

export interface RewardCallbacks {
  /** member: the 지명권 target of a member / role card (absent for party cards). */
  onChoose(index: number, member?: number): void;
  /** 다시 뽑기 (the new cards come with the next state / snapshot). */
  onReroll(): void;
  /** 기획 17차 리뷰 (multiplayer): my screen closed by the server's timeout — 「시간이 다 돼서 「…」을 받았어요」. */
  onAutoPicked?(text: string): void;
}

/** The toast after the server's timeout picked for me (the bot rule, default member), null = nothing to name. PURE. */
export function autoPickText(me: PlayerState, offers: readonly RewardOffer[]): string | null {
  const i = botPickIndex(me, offers);
  if (i < 0) return null;
  const o = offers[i];
  const name = resolvedCard(me, o, o.member ?? o.partyIndex ?? null).name;
  return `시간이 다 돼서 「${name}」${objParticle(name)} 받았어요`;
}

/** 다시 뽑기 is refused this close to the multiplayer auto-pick (s; the server refuses it too). */
export const REROLL_MIN_LEFT = REROLL_MIN_LEFT_SEC;
/** The 「#퇴장 3개 모음!」 stamp (ms). */
export const SET_STAMP_MS = 1200;

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

/** '을' / '를' after a word (Hangul final consonant), '을(를)' otherwise. */
export function objParticle(word: string): string {
  const c = word.trim().slice(-1).charCodeAt(0);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return '을(를)';
  return (c - 0xac00) % 28 === 0 ? '를' : '을';
}

/** The subtitle: relic / 욕심 (pick 2 → one more) / normal, + the 상자 note. */
export function rewardSub(offers: readonly RewardOffer[], me: PlayerState | undefined): string {
  if (offers.some(o => o.isRelic)) return '유물을 하나 고르세요 · 런이 끝날 때까지 유지돼요';
  const left = me?.rewardPicksLeft;
  const base = left != null && left >= 2 ? `${left}장을 고르세요 · 욕심쟁이 계약서` : left === 1 ? '하나 더 고르세요 (1/2)' : '보상을 하나 고르세요';
  return offers.some(o => o.rarityBumped) ? `${base} · 상자 효과 · 등급 한 단계 ↑` : base;
}

/** Countdown line: names the card the server picks when time runs out (the bot rule, botPickIndex). */
export function timerText(left: number, offers: readonly RewardOffer[] | null, me: PlayerState | undefined): string {
  if (!offers || !me) return `${left}초 뒤 자동 선택`;
  const o = offers[botPickIndex(me, offers)];
  if (!o) return `${left}초 안에 고르세요`;
  const name = resolvedCard(me, o, o.member ?? o.partyIndex ?? null).name;
  return `${left}초 안에 안 고르면 '${name}'${objParticle(name)} 골라요`;
}

/** The 다시 뽑기 button: visible on a normal screen of mine; enabled with rerolls left and time left. */
export function rerollState(offers: readonly RewardOffer[] | null, me: PlayerState | undefined, leftSec: number | null): { visible: boolean; enabled: boolean; count: number } {
  const visible = !!offers && offers.length > 0 && !offers.some(o => o.isRelic) && !!me;
  const count = me?.rerolls ?? 0;
  return { visible, count, enabled: visible && count > 0 && (leftSec == null || leftSec > REROLL_MIN_LEFT) };
}

function memberRoleOf(me: PlayerState, idx: number | null): Role | null {
  const m = idx != null ? me.party[idx] : undefined;
  return m ? getCharacter(m.defId).role : null;
}

/** A card's text and tags for the chosen member (member cards rename, role cards switch role). PURE. */
export function resolvedCard(me: PlayerState, o: RewardOffer, member: number | null): { name: string; description: string; tags: SynergyTag[]; role: Role | null } {
  if (o.isRelic) {
    const t = RELIC_TAGS[o.rewardId];
    return { name: o.name, description: o.description, tags: t ? [t] : [], role: null };
  }
  const fallback = { name: o.name, description: o.description, tags: [...(o.tags ?? [])], role: o.role ?? null };
  try {
    const def = getReward(o.rewardId);
    const fam = hasFamily(def.family) ? getFamily(def.family) : null;
    const target = o.target ?? def.target;
    if (!fam || member == null || !me.party[member]) return { ...fallback, tags: o.tags ? [...o.tags] : [...def.tags] };
    if (target === 'member') {
      const char = getCharacter(me.party[member].defId).name;
      return { name: def.name.split('{char}').join(char), description: fam.describe(def.params, { char, card: true }), tags: o.tags ? [...o.tags] : [...def.tags], role: null };
    }
    if (target === 'role') {
      const role = memberRoleOf(me, member) ?? o.role ?? 'tank';
      return { name: `${ROLE_NAME[role]} 특기`, description: fam.describe(def.params, { role, card: true }), tags: [...ROLE_TAGS[role]], role };
    }
    return { ...fallback, tags: o.tags ? [...o.tags] : [...def.tags] };
  } catch {
    return fallback;
  }
}

export interface TagProgress {
  tag: SynergyTag;
  label: string;
  color: string;
  glyph: string;
  /** Held now. */
  have: number;
  /** With this card. */
  after: number;
  /** Set already finished before this card. */
  already: boolean;
  /** This card finishes the set. */
  completes: boolean;
  bonus: string;
}

/** Tag chips of a card from my counts now. PURE. */
export function tagProgress(counts: Readonly<Record<SynergyTag, number>>, tags: readonly SynergyTag[]): TagProgress[] {
  return tags.map(tag => {
    const info = TAG_INFO[tag];
    const have = counts[tag] ?? 0;
    const after = have + 1;
    return {
      tag,
      label: info.label,
      color: info.color,
      glyph: info.glyph,
      have,
      after,
      already: have >= TAG_SET_SIZE,
      completes: have < TAG_SET_SIZE && after >= TAG_SET_SIZE,
      bonus: TAG_SET_BONUS[tag],
    };
  });
}

/** Kind chip text: 파티 / 캐릭터 / 직업 / 나 (relics: 유물). */
export function kindLabel(o: RewardOffer): string {
  if (o.isRelic) return '유물';
  const t = o.target ?? (o.partyIndex != null ? 'member' : 'party');
  return t === 'member' ? '캐릭터' : t === 'role' ? '직업' : t === 'self' ? '나' : '파티';
}

/** Does the card ask 「누구에게?」 (member / role cards). */
export function hasTarget(o: RewardOffer): boolean {
  if (o.isRelic) return false;
  const t = o.target ?? (o.partyIndex != null ? 'member' : 'party');
  return t === 'member' || t === 'role';
}

interface CardRefs {
  el: HTMLElement;
  offer: RewardOffer;
  member: number | null;
  icon: HTMLElement;
  name: HTMLElement;
  desc: HTMLElement;
  tagRow: HTMLElement;
  setLine: HTMLElement;
  who: HTMLButtonElement[];
}

export class RewardOverlay {
  readonly el: HTMLElement;
  private readonly parent: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly timer: HTMLElement;
  /** 기획 16차 원정: 「수령하면 이 보상은 사라져요」. */
  private readonly expNote: HTMLElement;
  private readonly row: HTMLElement;
  private readonly wait: HTMLElement;
  private readonly waitText: HTMLElement;
  private readonly waitPick: HTMLElement;
  private readonly buildChip: HTMLButtonElement;
  private readonly buildSheet: HTMLElement;
  private readonly rerollBtn: HTMLButtonElement;
  private shownKey = '';
  private shown: RewardOffer[] | null = null;
  private cards: CardRefs[] = [];
  private waiting = false;
  private locked = false;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private rerollBusyUntil = 0;
  private lastPick: { name: string; rarity: Rarity } | null = null;
  /** Multiplayer: the last cards I had (and whether I sent a pick for them) — a close without a pick = the timeout. */
  private autoWatch: { offers: readonly RewardOffer[]; me: PlayerState } | null = null;
  private sentPick = false;
  private me: PlayerState | undefined;
  private readonly cb: RewardCallbacks;

  constructor(parent: HTMLElement, cb: RewardCallbacks) {
    this.cb = cb;
    this.parent = parent;
    this.el = h('div', 'screen reward is-hidden', parent);
    const head = h('div', 'rw-head', this.el);
    this.title = h('div', 'rw-title', head);
    this.sub = h('div', 'rw-sub', head);
    this.timer = h('div', 'rw-timer is-hidden', head);
    this.expNote = h('div', 'rw-exp-note is-hidden', head, EXP_REWARD_NOTE);
    this.buildChip = button('rw-build-chip', '내 빌드 ▾', this.el, () => this.toggleBuild());
    this.rerollBtn = button('rw-reroll is-hidden', '', this.el, () => this.reroll());
    this.row = h('div', 'rw-row', this.el);
    this.wait = h('div', 'rw-wait is-hidden', this.el);
    h('div', 'rw-wait-spin', this.wait);
    this.waitText = h('div', 'rw-wait-text', this.wait);
    this.waitPick = h('div', 'rw-wait-pick is-hidden', this.wait);
    this.buildSheet = h('div', 'rw-build is-hidden', this.el);
    this.buildSheet.addEventListener('click', () => this.toggleBuild(false));
    this.buildSheet.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  }

  get visible(): boolean {
    return this.shown != null || this.waiting;
  }

  /** Synergy-set stamps for my picks ('tagSet' events). */
  onEvents(events: readonly GameEvent[], localPlayer: number): void {
    for (const e of events) if (e.type === 'tagSet' && e.player === localPlayer) this.setStamp(e.tag);
  }

  update(s: GameState, view: RewardView = { localPlayer: 0, multi: false, deadline: null }): void {
    const offers = offersFor(s, view.localPlayer);
    const me = s.players[view.localPlayer];
    this.me = me;
    if (view.multi) this.watchAutoPick(offers, me);
    const waiting = !offers && view.multi && s.phase === 'reward' && !!me;
    this.waiting = waiting;
    this.el.classList.toggle('is-hidden', !offers && !waiting);
    show(this.expNote, !!s.expedition && !!offers);
    // countdown (기획 17차: the server picks the bot-rule card + default member when it runs out)
    const leftExact = view.deadline != null && s.phase === 'reward' ? Math.max(0, (view.deadline - Date.now()) / 1000) : null;
    const left = leftExact != null ? Math.ceil(leftExact) : null;
    show(this.timer, left != null && (!!offers || waiting));
    if (left != null) {
      setText(this.timer, timerText(left, offers, me));
      setClass(this.timer, 'is-urgent', left <= 5);
    }
    if (waiting) {
      const { done, total } = rewardProgress(s);
      setText(this.waitText, `다른 플레이어 선택 대기 중 (${done}/${total})`);
      // out players (R11) get no offers this floor: say so instead of "picked"
      setText(this.sub, me.out ? '관전 중 · 보상 없음' : '보상을 골랐어요');
    }
    show(this.wait, waiting);
    show(this.waitPick, waiting && !!this.lastPick && !me?.out);
    show(this.row, !!offers);
    show(this.buildChip, !!offers && !!me);
    if (!offers) this.toggleBuild(false);
    const rr = rerollState(offers, me, leftExact);
    show(this.rerollBtn, rr.visible);
    setText(this.rerollBtn, `다시 뽑기 ${rr.count}`);
    this.rerollBtn.disabled = !rr.enabled || performance.now() < this.rerollBusyUntil;
    // rebuild the cards only when the offers really change (snapshots bring new arrays 15×/s)
    const key = offers ? `${s.floor}|${s.expedition?.stage ?? 0}|${me?.rewardPicksLeft ?? 1}|${offers.map(o => `${o.rewardId}:${o.member ?? o.partyIndex}`).join(',')}` : '';
    if (key === this.shownKey) {
      this.shown = offers;
      if (waiting || offers) this.title.textContent = rewardTitle(s);
      return;
    }
    this.shownKey = key;
    this.shown = offers;
    this.unlock();
    this.rerollBusyUntil = 0;
    this.title.textContent = rewardTitle(s);
    if (!offers || !me) {
      this.row.replaceChildren();
      this.cards = [];
      if (!waiting) this.sub.textContent = '';
      return;
    }
    if (!this.waitPickFresh(offers)) this.lastPick = null;
    this.sub.textContent = rewardSub(offers, me);
    this.row.replaceChildren();
    setClass(this.row, 'is-four', offers.length >= 4);
    this.cards = offers.map((o, i) => this.buildCard(me, o, i, key));
  }

  /** 기획 17차 리뷰: my cards went away and I never sent a pick → the server's timeout chose; say which card. */
  private watchAutoPick(offers: readonly RewardOffer[] | null, me: PlayerState | undefined): void {
    if (offers && me && !me.out) {
      this.autoWatch = { offers, me };
      return;
    }
    const w = this.autoWatch;
    if (w && !this.sentPick) {
      const text = autoPickText(w.me, w.offers);
      if (text) this.cb.onAutoPicked?.(text);
    }
    this.autoWatch = null;
    this.sentPick = false;
  }

  // ─────────────────────────── cards ───────────────────────────

  /** A new screen (not the second pick of a 욕심 screen) forgets the last pick. */
  private waitPickFresh(offers: readonly RewardOffer[]): boolean {
    return !!this.lastPick && this.me?.rewardPicksLeft === 1 && offers.length > 0;
  }

  private buildCard(me: PlayerState, o: RewardOffer, i: number, key: string): CardRefs {
    const curse = o.flag === 'curse';
    const el = h('div', `rw-card rarity-${o.rarity}${curse ? ' is-curse' : ''}`, this.row);
    el.setAttribute('role', 'button');
    el.dataset.reward = o.rewardId;
    el.style.setProperty('--rc', RARITY_COLOR[o.rarity]);
    el.style.animationDelay = `${i * 0.06}s`;
    const top = h('div', 'rw-tags', el);
    h('span', 'rw-rarity', top, `${RARITY_LABEL[o.rarity]}${o.rarityBumped ? ' ↑' : ''}`);
    const chips = h('span', 'rw-chips', top);
    if (curse) h('span', 'rw-flag is-curse', chips, '저주');
    if (o.flag === 'coop') h('span', 'rw-flag is-coop', chips, '협동');
    h('span', o.isRelic ? 'rw-relic' : 'rw-kind', chips, kindLabel(o));
    const headRow = h('div', 'rw-headrow', el);
    const icon = h('div', 'rw-icon', headRow);
    const name = h('div', 'rw-name', headRow);
    const owned = o.isRelic || !o.family ? 0 : rewardCount(me, o.family);
    if (owned > 0) h('span', 'rw-own', icon, `보유 ×${owned}`);
    const desc = h('div', 'rw-desc', el);
    if (o.cost) h('div', 'rw-cost', el, o.cost);
    const tagRow = h('div', 'rw-tagrow', el);
    const setLine = h('div', 'rw-setline is-hidden', el);
    const refs: CardRefs = { el, offer: o, member: o.member ?? o.partyIndex ?? null, icon, name, desc, tagRow, setLine, who: [] };
    if (hasTarget(o)) this.buildWho(me, refs);
    const pickBtn = button('rw-pick', o.cost ? '대가 받고 선택' : '선택', el);
    pickBtn.tabIndex = -1;
    // the whole card picks, except the 「누구에게?」 row (label, gaps, portraits): a near miss there never picks
    el.addEventListener('click', ev => {
      if ((ev.target as HTMLElement).closest('.rw-who')) return;
      this.pick(refs, i, key);
    });
    this.refreshCard(me, refs);
    return refs;
  }

  /** 「누구에게?」: my 3 portraits (dead ones too: the reward waits for them). */
  private buildWho(me: PlayerState, refs: CardRefs): void {
    const who = h('div', 'rw-who', refs.el);
    h('span', 'rw-who-q', who, '누구에게?');
    me.party.forEach((m, idx) => {
      const def = getCharacter(m.defId);
      const b = button('rw-who-p', '', who, ev => {
        ev.stopPropagation();
        refs.member = idx;
        this.refreshCard(me, refs);
      });
      b.dataset.member = String(idx);
      portrait(def, 'portrait-sm', b);
      h('span', 'rw-who-n', b, def.name);
      refs.who.push(b);
    });
  }

  private refreshCard(me: PlayerState, refs: CardRefs): void {
    const o = refs.offer;
    const r = resolvedCard(me, o, refs.member);
    refs.name.textContent = r.name;
    refs.desc.textContent = r.description;
    refs.el.title = `${r.name} — ${r.description}`;
    // icon: the chosen member's portrait, else a gem with the first tag's glyph
    refs.icon.querySelector('.portrait, .rw-gem')?.remove();
    const m = refs.member != null ? me.party[refs.member] : undefined;
    if (m && hasTarget(o)) refs.icon.prepend(portrait(getCharacter(m.defId), 'portrait-md'));
    else {
      const gem = h('div', `rw-gem${o.isRelic ? ' is-relic' : ''}${o.flag === 'curse' ? ' is-curse' : ''}`);
      const g = r.tags[0] ? TAG_INFO[r.tags[0]].glyph : '';
      if (g && !o.isRelic) h('span', 'rw-gem-g', gem, g);
      refs.icon.prepend(gem);
    }
    // 지명권: the chosen portrait (a role card lights every member of that role)
    const role = r.role;
    refs.who.forEach((b, idx) => {
      const on = role ? memberRoleOf(me, idx) === role : idx === refs.member;
      setClass(b, 'is-on', on);
      setClass(b, 'is-picked', idx === refs.member);
    });
    this.renderTags(refs, r.tags);
  }

  private renderTags(refs: CardRefs, tags: readonly SynergyTag[]): void {
    refs.tagRow.replaceChildren();
    const me = this.me;
    const counts = me ? tagCounts(me) : null;
    if (!counts) return;
    const prog = tagProgress(counts, tags);
    const done = prog.find(p => p.completes);
    for (const p of prog) {
      const chip = h('span', `rw-tag${p.completes ? ' is-complete' : p.already ? ' is-done' : ''}`, refs.tagRow);
      chip.dataset.tag = p.tag;
      chip.style.setProperty('--tc', p.color);
      h('span', 'rw-tag-l', chip, `#${p.label}`);
      if (p.already) {
        h('span', 'rw-tag-n', chip, '완성됨');
        continue;
      }
      if (p.completes) {
        h('span', 'rw-tag-n', chip, `${TAG_SET_SIZE}/${TAG_SET_SIZE} 완성!`);
        continue;
      }
      const dots = h('span', 'rw-dots', chip);
      for (let k = 0; k < TAG_SET_SIZE; k++) h('i', k < p.have ? 'is-have' : k < p.after ? 'is-new' : '', dots);
      h('span', 'rw-tag-n', chip, `${p.after}/${TAG_SET_SIZE}`);
    }
    show(refs.setLine, !!done);
    refs.setLine.textContent = done ? `#${done.label} 모음: ${done.bonus}` : '';
  }

  private pick(refs: CardRefs, i: number, key: string): void {
    if (this.locked || this.shownKey !== key) return;
    this.locked = true;
    refs.el.classList.add('is-picked');
    this.row.classList.add('is-locked');
    // a refused pick (multiplayer) or the second pick of a 욕심 screen that never came back unlocks again
    this.lockTimer = setTimeout(() => this.unlock(), 2500);
    const me = this.me;
    if (me) this.lastPick = { name: resolvedCard(me, refs.offer, refs.member).name, rarity: refs.offer.rarity };
    this.sentPick = true;
    this.renderWaitPick();
    this.cb.onChoose(i, hasTarget(refs.offer) && refs.member != null ? refs.member : undefined);
  }

  private unlock(): void {
    this.locked = false;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    this.row.classList.remove('is-locked');
    for (const c of this.cards) c.el.classList.remove('is-picked');
  }

  private renderWaitPick(): void {
    this.waitPick.replaceChildren();
    if (!this.lastPick) return;
    this.waitPick.style.setProperty('--rc', RARITY_COLOR[this.lastPick.rarity]);
    h('span', 'rw-wait-k', this.waitPick, '고른 보상');
    h('span', 'rw-rarity', this.waitPick, RARITY_LABEL[this.lastPick.rarity]);
    h('span', 'rw-wait-n', this.waitPick, this.lastPick.name);
  }

  private reroll(): void {
    if (this.rerollBtn.disabled || this.locked) return;
    this.rerollBusyUntil = performance.now() + 1500;
    this.rerollBtn.disabled = true;
    this.row.classList.add('is-rerolling');
    setTimeout(() => this.row.classList.remove('is-rerolling'), 400);
    this.cb.onReroll();
  }

  // ─────────────────────────── 내 빌드 · stamps ───────────────────────────

  private toggleBuild(on = this.buildSheet.classList.contains('is-hidden')): void {
    const me = this.me;
    if (on && me) renderBuild(this.buildSheet, buildSummary(me.rewards, me.relics, me.party.map(m => m.defId), me.rerolls), { relics: true });
    show(this.buildSheet, on && !!me);
    this.buildChip.textContent = on && me ? '내 빌드 ▴' : '내 빌드 ▾';
  }

  /** 「#퇴장 3개 모음!」 over everything for SET_STAMP_MS (the screen may already be gone). */
  private setStamp(tag: SynergyTag): void {
    const info = TAG_INFO[tag];
    const el = h('div', 'rw-set-stamp', this.parent);
    el.style.setProperty('--tc', info.color);
    h('div', 'rw-set-big', el, `#${info.label} ${TAG_SET_SIZE}개 모음!`);
    h('div', 'rw-set-sub', el, TAG_SET_BONUS[tag]);
    setTimeout(() => el.remove(), SET_STAMP_MS);
  }
}
