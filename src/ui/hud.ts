// 전투 HUD (기획서 13장 목업 배치). DOM is built once per run; update() diffs cheaply (~30 Hz).
//  좌상단: 다른 플레이어 2명 (사람 이름 또는 BOT) · 상단 중앙: 보스 바 / 층 정보 · 우상단: 타이머 + 설정
//  좌하단: 내 캐릭터 카드 3장 (카드마다 일반스킬 쿨 마름모) · 하단 중앙: 궁극기 게이지 · 우하단: 펫 카드 3장
//  중앙: 배너(층 시작/클리어/광폭화), 필드 비었을 때 안내, 관전 안내
//  기획 10차: 우상단 타이머 아래 흔적 칩 (아이콘 + 남은 층, 최대 4개 + '+n'), 층 시작 배너의 흔적 한 줄, 흔적 만료 토스트

import { DEBUFFS, LOGICAL_W, type CharacterDef, type Entity, type Game, type GameEvent, type GameState, type PlayerState, type StatusInstance, type Vec2 } from '../types';
import {
  ROLE_LABEL,
  getBoss,
  getCharacter,
  getGoedamTrace,
  getMonster,
  getPet,
  goedamTraceBanner,
  goedamTraceDuration,
  goedamTraceEffectText,
  goedamTraceExpiredText,
  goedamTraceKind,
} from '../data';
import { ZONES } from '../config';
import { ICON_GEAR, button, h, replayClass, setAttr, setClass, setStyle, setText, show } from './dom';
import { ROLE_GLYPH, STATUS_GLYPH, STATUS_LABEL, countdown, formatClock, refusalText } from './format';
import { petIcon, portrait } from './preset';
import { normalCooldownFor, swapCooldownOf } from '../sim/cooldowns';
import { ultChargeTimeFor } from '../sim/players';
import { type SkillRowKind, cdText, secs, skillRows } from './skillinfo';
import { markTipSeen, tipSeen } from './storage';
import { createToaster, type ToastKind } from './toast';
import { GroggyHud, groggyDown } from './groggyHud';
import { CardFx } from './cardFx';
import { FieldEventHud } from './fieldEventHud';
import { sfx } from '../audio';

/** Solo runs: the human is player 0. Multiplayer passes the server slot as HudOptions.localPlayer. */
export const LOCAL_PLAYER = 0;
const DOM_INTERVAL_MS = 1000 / 30 - 2;
const ULT_R = 50;
const ULT_C = 2 * Math.PI * ULT_R;
/** Hold a card this long without moving → skill sheet. */
const LONG_PRESS_MS = 420;
/** Finger travel (client px) that turns a long-press into a drag. */
const LONG_PRESS_SLOP = 7;
/** The skill sheet closes by itself after this long (it never blocks play: pointer-events none). */
const SHEET_MS = 7000;
/** Skill sheet width (logical px, styles.css .skill-sheet; 560 on phones) and the gap it keeps from my character. */
const SHEET_W = 520;
const SHEET_EDGE = 12;
const SHEET_CLEAR = 46;
/** "카드를 길게 누르면 스킬 정보" pill at the start of floor 1, until the player has opened the sheet once. */
const TIP_ID = 'skillSheet';
const TIP_MS = 9000;
/** A bench card's cooldown dropping this much faster than time passes = a cooldown cut (크로노 …): "-N초" pop. */
const CUT_MIN = 0.4;
/** HUD trace chips shown before '+n' (기획 10차 5-2). */
const TRACE_CHIPS = 4;

/** 기획 12차: bench heals below this many HP (메딕 대기실 간호 ticks) only glow, no '+N'. */
const BENCH_HEAL_POP_MIN = 10;

interface SheetRow {
  kind: SkillRowKind;
  live: HTMLElement;
  trigger: HTMLElement;
}

export interface HudOptions {
  /** This client's PlayerState index (solo 0, multi = server slot). */
  localPlayer?: number;
  /** Multiplayer run (other players are people; bot tags; no pause). */
  multi?: boolean;
  /** World → logical screen px (the renderer's camera): the skill sheet keeps clear of my character. */
  locate?: (world: Vec2) => Vec2;
}

/** A slot driven by the AI although it is not one of the stock bots (a dropped human, R34). */
export function showsBotTag(p: PlayerState): boolean {
  return p.isBot && (!!p.disconnected || !/^BOT\b/.test(p.name));
}

export interface HudCallbacks {
  onCardDown(kind: 'swap' | 'pet', index: number, ev: PointerEvent, el: HTMLElement): void;
  onUlt(): void;
  onPause(): void;
  onDebug(): void;
  onShowResult(): void;
}

interface Pip {
  el: HTMLElement;
  glyph: HTMLElement;
}

interface CharCard {
  el: HTMLElement;
  def: CharacterDef;
  pips: Pip[];
  cd: HTMLElement;
  count: HTMLElement;
  hpFill: HTMLElement;
  hpShield: HTMLElement;
  state: HTMLElement;
  /** Portrait: flashes when this character's drag skill fires. */
  por: HTMLElement;
  /** Normal (auto) skill cooldown: small diamond at the portrait's lower-left (목업의 마름모 + '0.99') + its seconds. */
  norm: HTMLElement;
  normT: HTMLElement;
}

interface PetCard {
  el: HTMLElement;
  cd: HTMLElement;
  count: HTMLElement;
  state: HTMLElement;
}

interface BotPanel {
  el: HTMLElement;
  portrait: HTMLElement;
  glyph: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  charName: HTMLElement;
  hpFill: HTMLElement;
  pips: Pip[];
  status: HTMLElement;
}

function makePips(parent: HTMLElement, n: number, cls: string): Pip[] {
  const row = h('div', `pips ${cls}`, parent);
  const out: Pip[] = [];
  for (let i = 0; i < n; i++) {
    const el = h('div', 'pip is-hidden', row);
    const glyph = h('span', 'pip-g', el);
    out.push({ el, glyph });
  }
  return out;
}

/** Debuffs first (more urgent), then buffs; each sorted by time left. */
function orderStatuses(list: readonly StatusInstance[]): StatusInstance[] {
  return [...list].sort((a, b) => {
    const da = DEBUFFS.has(a.id) ? 0 : 1;
    const db = DEBUFFS.has(b.id) ? 0 : 1;
    return da - db || b.remaining - a.remaining;
  });
}

function updatePips(pips: Pip[], list: readonly StatusInstance[], emptySlots = false): void {
  const sorted = list.length > 1 ? orderStatuses(list) : list;
  for (let i = 0; i < pips.length; i++) {
    const p = pips[i];
    const st = sorted[i];
    if (!st) {
      setClass(p.el, 'is-hidden', !emptySlots);
      setClass(p.el, 'is-empty', true);
      setClass(p.el, 'is-buff', false);
      setClass(p.el, 'is-debuff', false);
      setText(p.glyph, '');
      continue;
    }
    const debuff = DEBUFFS.has(st.id);
    setClass(p.el, 'is-hidden', false);
    setClass(p.el, 'is-empty', false);
    setClass(p.el, 'is-buff', !debuff);
    setClass(p.el, 'is-debuff', debuff);
    setText(p.glyph, STATUS_GLYPH[st.id]);
    const f = st.total > 0 ? Math.max(0, Math.min(1, st.remaining / st.total)) : 1;
    setStyle(p.el, '--f', (Math.round(f * 20) / 20).toFixed(2));
    setAttr(p.el, 'title', `${STATUS_LABEL[st.id]} ${Math.ceil(st.remaining)}초`);
  }
}

function hpClass(el: HTMLElement, frac: number): void {
  setClass(el, 'hp-mid', frac <= 0.5 && frac > 0.25);
  setClass(el, 'hp-low', frac <= 0.25);
}

/** Gap between two bodies (same as the sim's edgeDist). */
function edge(a: Entity, b: Entity): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) - a.radius - b.radius;
}

function frac(v: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
}

/** scaleX string quantized to 0.5% steps (fewer style writes). */
function sx(f: number): string {
  return `scaleX(${(Math.round(f * 200) / 200).toFixed(3)})`;
}

export class Hud {
  readonly root: HTMLElement;
  readonly charCards: CharCard[] = [];
  /** 기획 13차: bench-card effects of the renewed skills (앙코르 badge, revive cut, rewind). */
  private readonly cardFx = new CardFx(() => this.charCards);
  readonly petCards: PetCard[] = [];
  readonly localPlayer: number;
  readonly multi: boolean;
  private readonly game: Game;
  private readonly cb: HudCallbacks;
  private readonly dbgBtn: HTMLButtonElement;
  private readonly netBanner: HTMLElement;
  private readonly spectateBtn: HTMLButtonElement;
  private prevBot: boolean[] = [];
  private readonly toaster;
  private readonly bots: BotPanel[] = [];
  // top center
  private readonly bossBox: HTMLElement;
  private readonly enrageVignette: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossLv: HTMLElement;
  private readonly bossEnrage: HTMLElement;
  private readonly bossPct: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossLag: HTMLElement;
  private readonly bossPips: Pip[];
  /** 기획 8차 boss phases: one diamond per phase (filled up to the current one) + threshold ticks on the HP bar. */
  private readonly bossPhase: HTMLElement;
  private readonly bossBar: HTMLElement;
  private phaseKey = '';
  private phaseMarks: HTMLElement[] = [];
  private phaseTicks: { el: HTMLElement; at: number }[] = [];
  private bossLagFrac = 1;
  /** Boss pattern name ("cast pill") under the boss HP bar, shown until castUntil (performance.now ms). */
  private readonly bossCast: HTMLElement;
  private castUntil = 0;
  private readonly floorBox: HTMLElement;
  private readonly floorNum: HTMLElement;
  private readonly floorZone: HTMLElement;
  private readonly floorWaves: HTMLElement;
  private readonly floorEnemies: HTMLElement;
  private readonly midBox: HTMLElement;
  private readonly midName: HTMLElement;
  private readonly midFill: HTMLElement;
  // top right
  private readonly timer: HTMLElement;
  private readonly timerVal: HTMLElement;
  private readonly timerLabel: HTMLElement;
  // ult
  private readonly ult: HTMLElement;
  private readonly ultArc: SVGCircleElement;
  private readonly ultPct: HTMLElement;
  private readonly ultSub: HTMLElement;
  private readonly ultName: HTMLElement;
  // center
  private readonly bannerBox: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintBig: HTMLElement;
  private readonly hintSub: HTMLElement;
  private readonly spectate: HTMLElement;
  private lastDom = -1e9;
  private prevDead: boolean[] = [];
  private draggingKey = '';
  // skill sheet (tap the active card / long-press any card)
  private readonly sheet: HTMLElement;
  private sheetIdx = -1;
  private sheetUntil = 0;
  private sheetRows: SheetRow[] = [];
  private sheetName: HTMLElement | null = null;
  private longPress: { idx: number; pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private longPressFired = false;
  /** Sheet side: on the half of the screen away from my character. */
  private sheetRight = false;
  private readonly locate: ((world: Vec2) => Vec2) | null;
  private readonly tip: HTMLElement;
  private tipUntil = 0;
  /** Bench cooldowns as last seen (sim time), to spot cuts. */
  private readonly prevSwapRem: number[] = [];
  private prevSimTime = -1;
  /** 기획 10차: trace chips under the timer, and expiry toasts held while a screen covers the HUD. */
  private readonly traces: HTMLElement;
  private tracesKey = '';
  private covered = false;
  private readonly pendingToasts: string[] = [];
  /** 기획 12차: 돌발 괴담 pill / banner / toasts / reward pulses (ui/fieldEventHud.ts). */
  private fieldEvent!: FieldEventHud;
  /** 기획 13차: boss groggy row / pill / held phase banner (ui/groggyHud.ts). */
  private readonly groggy: GroggyHud;

  constructor(layer: HTMLElement, game: Game, cb: HudCallbacks, opts: HudOptions = {}) {
    this.game = game;
    this.cb = cb;
    this.localPlayer = opts.localPlayer ?? LOCAL_PLAYER;
    this.multi = !!opts.multi;
    this.locate = opts.locate ?? null;
    const s = game.state;
    const me = s.players[this.localPlayer];
    this.root = h('div', 'hud', layer);
    setClass(this.root, 'is-multi', this.multi);
    // 기획 8차 리뷰: the enrage vignette is a compositor-animated overlay (under every HUD widget) instead of a
    // full-screen canvas gradient redrawn each frame (that cost ~15 fps on a phone-sized software raster)
    this.enrageVignette = h('div', 'enrage-vignette is-hidden', this.root);

    // ── top-left: the other two players (people or bots) ──
    const tl = h('div', 'hud-tl', this.root);
    for (const p of s.players) {
      if (p.id === this.localPlayer) continue;
      const el = h('div', 'bot hud-block', tl);
      el.style.setProperty('--pc', p.color);
      el.dataset.player = String(p.id);
      const por = h('div', 'portrait bot-portrait', el);
      const glyph = h('span', 'portrait-glyph', por);
      const info = h('div', 'bot-info', el);
      const nameRow = h('div', 'bot-name-row', info);
      const name = h('span', 'bot-name', nameRow, p.name);
      const tag = h('span', 'bot-tag is-hidden', nameRow, 'BOT');
      const status = h('span', 'bot-status', nameRow);
      const charName = h('div', 'bot-char', info);
      const hp = h('div', 'bar bot-hp', info);
      const hpFill = h('div', 'bar-fill', hp);
      const pips = makePips(el, 6, 'bot-pips');
      this.bots.push({ el, portrait: por, glyph, name, tag, charName, hpFill, pips, status });
    }
    this.prevBot = s.players.map(p => p.isBot);

    // ── top-center: boss bar / floor info ──
    const tc = h('div', 'hud-tc', this.root);
    this.bossBox = h('div', 'boss hud-block is-hidden', tc);
    const brow = h('div', 'boss-row', this.bossBox);
    this.bossLv = h('span', 'boss-lv', brow);
    this.bossName = h('span', 'boss-name', brow);
    this.bossEnrage = h('span', 'boss-enrage is-hidden', brow, '광폭화');
    this.bossPhase = h('span', 'boss-phase is-hidden', brow);
    this.bossPct = h('span', 'boss-pct', brow);
    const bbar = h('div', 'bar boss-bar', this.bossBox);
    this.bossBar = bbar;
    this.bossLag = h('div', 'bar-lag', bbar);
    this.bossFill = h('div', 'bar-fill', bbar);
    this.bossPips = makePips(this.bossBox, 16, 'boss-pips');
    // over the (mostly empty) status-pip row: right under the HP bar but clear of the boss's big eye below the box
    this.bossCast = h('div', 'boss-cast is-hidden', this.bossBox);
    // 기획 13차: the groggy row right under the HP bar (above the status pips)
    this.groggy = new GroggyHud(this.bossBox, bbar.nextElementSibling as HTMLElement, {
      localPlayer: this.localPlayer,
      toast: (text, kind) => this.toast(text, kind),
      phaseBanner: e => this.phaseBanner(e),
      tunables: () => this.game.tunables,
    });
    this.floorBox = h('div', 'floorinfo hud-block', tc);
    const frow = h('div', 'fi-row', this.floorBox);
    this.floorNum = h('span', 'fi-floor', frow);
    this.floorZone = h('span', 'fi-zone', frow);
    this.floorWaves = h('span', 'fi-chip', frow);
    this.floorEnemies = h('span', 'fi-chip', frow);
    this.midBox = h('div', 'fi-mid is-hidden', this.floorBox);
    this.midName = h('span', 'fi-mid-name', this.midBox);
    const mbar = h('div', 'bar fi-mid-bar', this.midBox);
    this.midFill = h('div', 'bar-fill', mbar);

    // ── top-right: timer + buttons ──
    const tr = h('div', 'hud-tr', this.root);
    const dbg = button('icon-btn btn-dbg hud-block', 'DBG', tr, () => cb.onDebug());
    dbg.setAttribute('aria-label', '디버그');
    this.dbgBtn = dbg;
    this.timer = h('div', 'timer hud-block', tr);
    this.timerLabel = h('div', 'timer-label', this.timer, '남은 시간');
    this.timerVal = h('div', 'timer-val', this.timer, '00:00');
    const gear = button('icon-btn hud-block', '', tr, () => cb.onPause());
    gear.innerHTML = ICON_GEAR;
    gear.setAttribute('aria-label', '일시정지');
    // 기획 10차: 흔적 chips at the top (not under the ult: no room there, and a mis-tap would fire it)
    this.traces = h('div', 'hud-traces is-hidden', this.root);

    // ── bottom-left: my character cards ──
    const bl = h('div', 'hud-bl', this.root);
    me.party.forEach((m, i) => {
      const def = getCharacter(m.defId);
      const el = h('div', 'ccard hud-block', bl);
      el.style.setProperty('--c', def.color);
      el.dataset.idx = String(i);
      const pips = makePips(el, 6, 'cc-pips');
      const frame = h('div', 'cc-frame', el);
      // 기획 9차: the re-appear (= drag-skill) cooldown shows only as the big number on the portrait
      // (no top-left badge/bar, no seconds in the label under the name)
      h('div', 'cc-slot', frame, String(i + 1));
      const por = portrait(def, 'cc-portrait', frame);
      const cd = h('div', 'cc-cd is-hidden', por);
      const count = h('span', 'cc-count', cd);
      h('div', 'cc-name', frame, def.name);
      const hp = h('div', 'bar cc-hp', frame);
      const hpFill = h('div', 'bar-fill', hp);
      const hpShield = h('div', 'bar-shield', hp);
      const state = h('div', 'cc-state', frame);
      // "i" on the field character's card: a tap there opens the skill sheet (CSS shows it on .is-active only)
      h('span', 'cc-info', frame, 'i');
      // the auto (normal) skill fires by itself, so its timer is the only way to know when: a small diamond at the
      // portrait's lower-left, over the card's edge (outside the clipped frame). Lit = ready; dark + sweep + seconds = cooling.
      const norm = h('div', 'cc-norm', el);
      h('div', 'cc-norm-gem', norm);
      const normT = h('span', 'cc-norm-t', norm);
      // hover help on the card itself (the diamond lets pointers through to the card, so a title there never shows)
      el.title = `${def.name} · 왼쪽 아래 마름모 = 일반스킬 ${def.normal.name} 쿨 (자동) · 길게 누르면 스킬 정보`;
      el.addEventListener('pointerdown', ev => this.onCardPointerDown(i, ev, el));
      this.charCards.push({ el, def, pips, cd, count, hpFill, hpShield, state, por, norm, normT });
    });

    // ── bottom-center: ult gauge ──
    const bc = h('div', 'hud-bc', this.root);
    this.ult = h('div', 'ult hud-block', bc);
    this.ult.setAttribute('role', 'button');
    this.ult.setAttribute('aria-label', '궁극기');
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.classList.add('ult-ring');
    const track = document.createElementNS(svgNs, 'circle');
    track.setAttribute('class', 'ult-track');
    this.ultArc = document.createElementNS(svgNs, 'circle');
    this.ultArc.setAttribute('class', 'ult-arc');
    for (const c of [track, this.ultArc]) {
      c.setAttribute('cx', '60');
      c.setAttribute('cy', '60');
      c.setAttribute('r', String(ULT_R));
      svg.appendChild(c);
    }
    this.ultArc.setAttribute('stroke-dasharray', ULT_C.toFixed(2));
    this.ultArc.setAttribute('transform', 'rotate(-90 60 60)');
    this.ult.appendChild(svg);
    const core = h('div', 'ult-core', this.ult);
    this.ultPct = h('div', 'ult-pct', core);
    this.ultSub = h('div', 'ult-sub', core, '궁극기');
    this.ultName = h('div', 'ult-name', bc);
    this.ult.addEventListener('click', () => cb.onUlt());

    // ── bottom-right: pets ──
    const br = h('div', 'hud-br', this.root);
    me.pets.forEach((slot, i) => {
      const def = getPet(slot.defId);
      const el = h('div', 'pcard hud-block', br);
      el.style.setProperty('--c', def.color);
      const icon = petIcon(def, 'pc-icon', el);
      const cd = h('div', 'pc-cd is-hidden', icon);
      const count = h('span', 'pc-count', cd);
      h('div', 'pc-name', el, def.name);
      const state = h('div', 'pc-state', el);
      el.addEventListener('pointerdown', ev => cb.onCardDown('pet', i, ev, el));
      this.petCards.push({ el, cd, count, state });
    });

    // ── center ──
    this.bannerBox = h('div', 'banners', this.root);
    this.hint = h('div', 'empty-hint is-hidden', this.root);
    this.hintBig = h('div', 'eh-big', this.hint);
    this.hintSub = h('div', 'eh-sub', this.hint);
    // spectating: a slim bar under the field (the fight stays visible), the way out as a secondary button
    this.spectate = h('div', 'spectate is-hidden', this.root);
    const sbox = h('div', 'spectate-box hud-block', this.spectate);
    h('div', 'sp-title', sbox, '사망 — 관전 중');
    h('div', 'sp-sub', sbox, '누군가 이 층을 클리어하면 다음 층에서 부활해요');
    this.spectateBtn = button('btn btn-secondary sp-btn', '결과 보기', sbox, () => cb.onShowResult());
    this.netBanner = h('div', 'net-banner is-hidden', this.root);
    this.sheet = h('div', 'skill-sheet is-hidden', this.root);
    // short and left-aligned: clear of the centred toasts that share this height
    this.tip = h('div', 'sheet-tip is-hidden', this.root, 'ⓘ 카드 길게 누르기 = 스킬 정보');

    this.toaster = createToaster(this.root, 'toasts-hud');
    this.prevDead = me.party.map(m => m.dead);
    // 기획 12차: the 돌발 괴담 pill sits under the floor box (inside hud-tc)
    this.fieldEvent = new FieldEventHud(tc, this.bannerBox, {
      localPlayer: this.localPlayer,
      toast: (text, kind) => this.toast(text, kind),
      pulseTargets: () => ({ ult: this.ult, pets: this.petCards.map(c => c.el), chars: this.charCards.map(c => c.el), traces: this.traces }),
    });
  }

  destroy(): void {
    this.cancelLongPress();
    this.cardFx.destroy();
    this.root.remove();
  }

  // ─────────────────────────── card press: tap active / long-press → skill sheet ───────────────────────────

  private onCardPointerDown(i: number, ev: PointerEvent, el: HTMLElement): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const me = this.game.state.players[this.localPlayer];
    if (me && !me.out && me.activeIndex === i) {
      // the field character can't be dragged again: a tap shows what it does instead of a refusal
      ev.preventDefault();
      this.toggleSheet(i);
      return;
    }
    this.startLongPress(i, ev, el);
    this.cb.onCardDown('swap', i, ev, el);
  }

  private startLongPress(i: number, ev: PointerEvent, el: HTMLElement): void {
    this.cancelLongPress();
    this.longPressFired = false;
    const timer = setTimeout(() => {
      this.longPress = null;
      this.longPressFired = true;
      this.openSheet(i);
    }, LONG_PRESS_MS);
    this.longPress = { idx: i, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, timer };
    const move = (e: PointerEvent) => {
      const lp = this.longPress;
      if (!lp || e.pointerId !== lp.pointerId) return;
      if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) this.cancelLongPress();
    };
    const end = (e: PointerEvent) => {
      if (this.longPress && e.pointerId !== this.longPress.pointerId) return;
      this.cancelLongPress();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private cancelLongPress(): void {
    if (this.longPress) clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  /** The press that just ended opened the skill sheet (the drag controller then skips its "drag the card" tip). */
  takeLongPress(): boolean {
    const f = this.longPressFired;
    this.longPressFired = false;
    return f;
  }

  get sheetOpenFor(): number {
    return this.sheetIdx;
  }

  toggleSheet(i: number): void {
    if (this.sheetIdx === i) this.closeSheet();
    else this.openSheet(i);
  }

  closeSheet(): void {
    this.sheetIdx = -1;
    show(this.sheet, false);
  }

  /** My field character's x on screen (logical px); the screen centre when unknown / field empty. */
  private myScreenX(): number {
    const s = this.game.state;
    const me = s.players[this.localPlayer];
    const id = me && me.activeIndex != null ? me.party[me.activeIndex]?.entityId : null;
    const e = id != null ? s.entities.find(x => x.id === id) : undefined;
    if (!e || !this.locate) return LOGICAL_W / 2;
    const p = this.locate(e.pos);
    return Number.isFinite(p.x) ? p.x : LOGICAL_W / 2;
  }

  /** Compact, non-blocking list of the 5 skills of party member i (type · trigger/cooldown · one-line effect · live). */
  openSheet(i: number): void {
    const s = this.game.state;
    const me = s.players[this.localPlayer];
    const m = me?.party[i];
    const card = this.charCards[i];
    if (!m || !card) return;
    const def = card.def;
    this.sheetIdx = i;
    this.sheetUntil = performance.now() + SHEET_MS;
    if (this.tipUntil > 0) {
      this.tipUntil = 0;
      show(this.tip, false);
    }
    markTipSeen(TIP_ID);
    this.sheetRight = this.myScreenX() < LOGICAL_W / 2;
    setClass(this.sheet, 'is-right', this.sheetRight);
    this.sheet.replaceChildren();
    this.sheet.style.setProperty('--c', def.color);
    const head = h('div', 'ss-head', this.sheet);
    h('span', 'ss-glyph', head, ROLE_GLYPH[def.role]).style.setProperty('--c', def.color);
    this.sheetName = h('span', 'ss-name', head, def.name);
    h('span', 'ss-role', head, ROLE_LABEL[def.role]);
    h('span', 'ss-hint', head, '평타·일반스킬은 자동 · 드래그스킬은 교체할 때');
    // what this card gets when it is next swapped out (기획 6차), with its rewards and the multiplier as of now
    const dragCd = swapCooldownOf(this.game.tunables, me, i);
    const rows = skillRows(def, { normal: this.normalTotal(i), drag: dragCd, ult: ultChargeTimeFor(this.game.tunables, me) });
    // two lines per skill: type · name · trigger · live, then the whole effect line (wraps, never cut off)
    this.sheetRows = rows.map(r => {
      const row = h('div', `ss-row ss-${r.kind}`, this.sheet);
      h('span', 'ss-type', row, r.type);
      h('b', 'ss-skill', row, r.name);
      const trigger = h('span', 'ss-trigger', row, r.trigger);
      const live = h('span', 'ss-live', row);
      h('span', 'ss-sum', row, r.summary);
      return { kind: r.kind, live, trigger };
    });
    show(this.sheet, true);
    replayClass(this.sheet, 'is-new');
    sfx.ui('ui.sheet.open');
    this.updateSheet(s, me);
  }

  private updateSheet(s: GameState, me: PlayerState): void {
    if (this.sheetIdx < 0) return;
    if (performance.now() > this.sheetUntil || s.phase === 'runOver') {
      this.closeSheet();
      return;
    }
    const i = this.sheetIdx;
    const m = me.party[i];
    if (!m) return;
    // my character walked under the sheet → move it to the other half
    const x = this.myScreenX();
    const sw = this.sheet.offsetWidth || SHEET_W;
    const under = this.sheetRight ? x > LOGICAL_W - SHEET_EDGE - sw - SHEET_CLEAR : x < SHEET_EDGE + sw + SHEET_CLEAR;
    if (under) {
      this.sheetRight = !this.sheetRight;
      setClass(this.sheet, 'is-right', this.sheetRight);
    }
    const active = me.activeIndex === i;
    for (const r of this.sheetRows) {
      let txt = '';
      let ready = false;
      if (r.kind === 'normal') {
        // a benched card's timer runs too (same as its diamond); it only goes off on the field
        if (!active) txt = !m.dead && m.normalCooldownRemaining > 0 ? `${cdText(m.normalCooldownRemaining)}초` : '필드에서만';
        else if (m.normalCooldownRemaining > 0) txt = `${cdText(m.normalCooldownRemaining)}초`;
        else if (this.normalWaiting(getCharacter(m.defId), m.entityId)) txt = '대기';
        else {
          txt = '준비';
          ready = true;
        }
      } else if (r.kind === 'drag') {
        if (m.dead) txt = '쓰러짐';
        else if (active) txt = '필드'; // 기획 6차: no cooldown while on the field; it starts when this card leaves
        else if (m.swapCooldownRemaining > 0) txt = `${secs(m.swapCooldownRemaining)}초`;
        else {
          txt = '준비';
          ready = true;
        }
      } else if (r.kind === 'ult') {
        const c = Math.max(0, Math.min(1, me.ult.charge));
        ready = c >= 1;
        txt = ready ? '준비' : `${Math.floor(c * 100)}%`;
      } else if (r.kind === 'passive') txt = active ? '적용 중' : '';
      setText(r.live, txt);
      setClass(r.live, 'is-ready', ready);
      if (r.kind === 'normal') setText(r.trigger, `${secs(this.normalTotal(i))}초마다 자동`);
    }
  }

  /** DBG button only for whoever may tune (solo: always; multi: the room host, R35). */
  setDebugAllowed(on: boolean): void {
    show(this.dbgBtn, on);
  }

  /** Spectating: the button under "사망 — 관전 중" (null = no button). */
  setSpectateAction(label: string | null): void {
    show(this.spectateBtn, label != null);
    if (label != null) setText(this.spectateBtn, label);
  }

  /** Connection trouble banner (multiplayer); null hides it. */
  setNetStatus(text: string | null): void {
    show(this.netBanner, text != null);
    if (text != null) setText(this.netBanner, text);
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.toaster.show(text, kind);
  }

  shake(kind: 'swap' | 'pet', index: number): void {
    const el = kind === 'swap' ? this.charCards[index]?.el : this.petCards[index]?.el;
    if (el) replayClass(el, 'shake');
  }

  /** Toast with the reason a card can't be used right now. */
  refuse(kind: 'swap' | 'pet', index: number, reason: { ok: boolean; reason?: string }): void {
    sfx.ui('ui.refuse');
    const me = this.game.state.players[this.localPlayer];
    const m = kind === 'swap' ? me.party[index] : undefined;
    const pet = kind === 'pet' ? me.pets[index] : undefined;
    this.toast(refusalText(reason, { kind, cooldown: m ? m.swapCooldownRemaining : pet?.cooldownRemaining, revive: m?.reviveRemaining }), 'warn');
    this.shake(kind, index);
  }

  /** A full-stage overlay (reward) is up: hide banners/hints/toasts underneath. */
  setCovered(on: boolean): void {
    setClass(this.root, 'is-covered', on);
    this.covered = on;
    // trace expiry happens at the floor clear, under the reward screen: say it once the field is visible again
    if (!on) for (const t of this.pendingToasts.splice(0)) this.toast(t, 'info');
  }

  setDragging(kind: 'swap' | 'pet' | null, index: number): void {
    const key = kind ? `${kind}:${index}` : '';
    if (key === this.draggingKey) return;
    this.draggingKey = key;
    if (kind) {
      // a drag started: the field matters now, not the sheet
      this.cancelLongPress();
      this.closeSheet();
    }
    this.charCards.forEach((c, i) => c.el.classList.toggle('is-dragging', kind === 'swap' && i === index));
    this.petCards.forEach((c, i) => c.el.classList.toggle('is-dragging', kind === 'pet' && i === index));
    this.root.classList.toggle('is-drag', !!kind);
    this.benchHealChips(kind === 'swap' ? index : null);
  }

  /** 기획 12차 (메딕): while a bench-healing card is dragged, the other cards (= the bench after the swap) show '+N%'. */
  private benchHealChips(dragged: number | null): void {
    const def = dragged != null ? this.charCards[dragged]?.def : undefined;
    const eff = def?.drag.actions.flatMap(a => a.effects).find(e => e.kind === 'benchHeal');
    const text = eff?.kind === 'benchHeal' ? `+${Math.round(eff.amount * 100)}%` : '';
    this.charCards.forEach((c, i) => {
      if (text && i !== dragged) c.el.dataset.benchHeal = text;
      else delete c.el.dataset.benchHeal;
    });
  }

  // ─────────────────────────── events ───────────────────────────

  private banner(big: string, sub: string, kind: string, lore = '', trace = ''): void {
    this.bannerBox.replaceChildren();
    // 기획 8차 리뷰: mid-fight boss banners (phase change, enrage) must not cover the fight at the boss's feet, where
    // the new phase's first pattern lands right away → a smaller, shorter strip low over the arena's front edge
    const low = kind === 'phase' || kind === 'enrage';
    setClass(this.bannerBox, 'is-low', low);
    const b = h('div', `banner banner-${kind}`, this.bannerBox);
    h('div', 'banner-big', b, big);
    if (lore) h('div', 'banner-lore', b, lore);
    if (sub) h('div', 'banner-sub', b, sub);
    if (trace) h('div', 'banner-trace', b, trace);
    setTimeout(() => b.remove(), low ? 1500 : 2300);
  }

  private onEvents(s: GameState, events: GameEvent[]): void {
    const retreat = events.some(e => e.type === 'bossRetreat');
    let revivedAll = false;
    for (const e of events) {
      if (this.groggy.onEvent(s, e)) continue; // 기획 13차: a phase crossed while the boss is down waits for it to stand up
      if (this.cardFx.onEvent(e, this.localPlayer)) continue;
      switch (e.type) {
        case 'floorStart':
          if (e.kind === 'boss') {
            const name = bossName(s.plan.bossId);
            this.banner(`${e.floor}층 · 보스`, `${name} — HP를 0으로 만들면 퇴각해요`, 'boss', '', traceBannerLine(s.players[this.localPlayer]));
          } else {
            const zone = zoneName(s.plan.theme, e.floor);
            // 기획 8차 리뷰: entering a new zone (1·6·11·16층) opens with its 괴담 line
            const lore = zoneLore(s.plan.theme, e.floor);
            this.banner(
              zone ? `${e.floor}층 · ${zone}` : `${e.floor}층`,
              `몬스터를 모두 처치하세요 · 제한시간 ${formatClock(s.plan.timeLimit)}`,
              'floor',
              lore,
              traceBannerLine(s.players[this.localPlayer]),
            );
          }
          if (e.floor === 1 && !tipSeen(TIP_ID)) {
            this.tipUntil = performance.now() + TIP_MS;
            show(this.tip, true);
            replayClass(this.tip, 'is-new');
          }
          break;
        case 'floorClear':
          this.banner(retreat ? '보스 퇴각!' : '클리어!', `${e.floor}층 돌파 · 살아 있는 캐릭터 HP 회복`, 'clear');
          break;
        case 'enrage':
          this.banner('보스 광폭화!', '공격력 · 공격 속도 · 소환량 증가', 'enrage');
          break;
        case 'bossPhase':
          this.phaseBanner(e);
          break;
        case 'skillCast':
          if (e.player === this.localPlayer && (e.slot === 'normal' || e.slot === 'drag') && e.sourceId != null) {
            // the caster's card (by entity: the event may arrive after a swap)
            const idx = s.players[this.localPlayer]?.party.findIndex(m => m.entityId === e.sourceId) ?? -1;
            const card = this.charCards[idx];
            if (card) replayClass(e.slot === 'normal' ? card.norm : card.por, 'is-fired');
          }
          if (e.sourceId !== null && e.sourceId === s.bossId && e.name) {
            // telegraphed patterns stay up until they land; instant ones (소환) for a moment
            const tg = s.telegraphs.find(t => t.team === 'enemy' && Math.abs(t.center.x - e.center.x) < 1e-6 && Math.abs(t.center.y - e.center.y) < 1e-6);
            const secs = Math.max(1.6, (tg ? tg.remaining : 0) + 0.3);
            setText(this.bossCast, `⚠ ${e.name}`);
            show(this.bossCast, true);
            replayClass(this.bossCast, 'is-new');
            this.castUntil = performance.now() + secs * 1000;
            // 기획 8차 리뷰: patterns with a "how to" tip (문짝 쓸기 → 교체로 피하기) say it once per device
            const hint = bossSkillHint(s.plan.bossId, e.skillId);
            if (hint && !tipSeen(`hint:${e.skillId}`)) {
              markTipSeen(`hint:${e.skillId}`);
              this.toast(`ⓘ ${hint}`, 'warn');
            }
          }
          break;
        case 'runOver':
          this.banner(e.result.outcome === 'victory' ? '승리!' : '런 실패', '', e.result.outcome === 'victory' ? 'clear' : 'enrage');
          break;
        case 'goedamTraceExpired':
          if (e.player === this.localPlayer) {
            const text = goedamTraceExpiredText(e.traceId);
            // the clear opens the reward screen in the same frame: hold it until the field shows again
            if (this.covered || s.phase !== 'combat') this.pendingToasts.push(text);
            else this.toast(text, 'info');
          }
          break;
        case 'benchHeal':
          // 기획 12차 (메딕): my bench card got healed — portrait glows green, '+N' floats up (small regen ticks: glow only)
          if (e.player === this.localPlayer) this.benchHealPop(e.partyIndex, e.amount);
          break;
        case 'playerOut':
          if (e.player !== this.localPlayer) this.toast(`${s.players[e.player]?.name ?? '플레이어'} 사망 · 관전 중`, 'warn');
          break;
        case 'revive':
          if (e.player === this.localPlayer) {
            // 기획 5차: the whole party comes back at a floor clear after being out → one toast, not three
            if (s.phase === 'reward') {
              if (!revivedAll) this.toast('전원 부활! 다음 층에서 1번 캐릭터로 다시 싸워요', 'good');
              revivedAll = true;
              break;
            }
            const m = s.players[this.localPlayer].party[e.partyIndex];
            if (m) this.toast(`${getCharacter(m.defId).name} 부활! 카드로 돌아왔어요`, 'good');
          }
          break;
      }
    }
  }

  /** 기획 8차: "2페이즈 · 추락" — new patterns join, the boss speeds up. */
  private phaseBanner(e: Extract<GameEvent, { type: 'bossPhase' }>): void {
    this.banner(`${e.phase}페이즈`, e.name && !/^\d+페이즈$/.test(e.name) ? `${e.name} — 새 패턴이 추가돼요` : '새 패턴이 추가돼요', 'phase');
    replayClass(this.bossBox, 'is-phase');
  }

  /** 기획 12차: a bench card healed by 메딕 (no entity on the field, so the card itself shows it). */
  private benchHealPop(idx: number, amount: number): void {
    const card = this.charCards[idx];
    if (!card) return;
    replayClass(card.por, 'is-bench-heal');
    if (amount < BENCH_HEAL_POP_MIN) return;
    const pop = h('span', 'cc-heal-pop', card.el, `+${Math.round(amount)}`);
    setTimeout(() => pop.remove(), 900);
  }

  // ─────────────────────────── per-frame ───────────────────────────

  update(s: GameState, events: GameEvent[], force = false): void {
    if (events.length) this.onEvents(s, events);
    const me = s.players[this.localPlayer];
    // multiplayer: someone dropped (a bot takes over, R34) or came back
    if (this.multi) {
      for (const p of s.players) {
        const was = this.prevBot[p.id];
        if (was === false && p.isBot && p.id !== this.localPlayer) this.toast(`${p.name} 자리를 봇이 이어받았어요`, 'warn');
        else if (was === true && !p.isBot && p.id !== this.localPlayer) this.toast(`${p.name} 다시 연결됨`, 'good');
        this.prevBot[p.id] = p.isBot;
      }
    }
    // death toasts (state diff, so it also covers DoT/explosions)
    me.party.forEach((m, i) => {
      if (m.dead && !this.prevDead[i] && !me.out) {
        const anyOther = me.party.some((x, j) => j !== i && !x.dead);
        this.toast(`${getCharacter(m.defId).name} 쓰러짐${anyOther ? ' · 다른 카드를 끌어 놓으세요' : ''}`, 'warn');
      }
      this.prevDead[i] = m.dead;
    });
    this.fieldEvent.update(s, events); // 기획 12차
    const now = performance.now();
    if (!force && now - this.lastDom < DOM_INTERVAL_MS) return;
    const dt = Math.min(0.2, (now - this.lastDom) / 1000);
    this.lastDom = now;
    this.updateBots(s);
    this.updateTop(s, dt);
    this.updateCards(s, me);
    this.updateUlt(s, me);
    this.updatePets(s, me);
    this.updateCenter(s, me);
    this.updateSheet(s, me);
    this.updateTraces(me);
    if (this.tipUntil > 0 && (now > this.tipUntil || s.phase !== 'combat')) {
      this.tipUntil = 0;
      show(this.tip, false);
    }
  }

  /** 흔적 chips: icon + floors left ('∞' = until the run ends); timed ones first, max TRACE_CHIPS then '+n'. */
  private updateTraces(me: PlayerState): void {
    const list = me.goedamTraces ?? [];
    const key = list.map(t => `${t.id}:${t.floorsLeft}`).join(',');
    if (key === this.tracesKey) return;
    this.tracesKey = key;
    this.traces.replaceChildren();
    show(this.traces, list.length > 0);
    const sorted = [...list].sort((a, b) => (a.floorsLeft ?? Infinity) - (b.floorsLeft ?? Infinity));
    for (const slot of sorted.slice(0, TRACE_CHIPS)) {
      const t = getGoedamTrace(slot.id);
      const chip = h('span', `hud-trace kind-${goedamTraceKind(t)}`, this.traces);
      chip.dataset.trace = t.id;
      h('span', 'ht-icon', chip, t.icon);
      h('span', 'ht-n', chip, slot.floorsLeft == null ? '∞' : String(slot.floorsLeft));
      chip.title = `${t.name} · ${goedamTraceEffectText(t)} · ${goedamTraceDuration(slot.floorsLeft)}`;
    }
    if (sorted.length > TRACE_CHIPS) h('span', 'hud-trace is-more', this.traces, `+${sorted.length - TRACE_CHIPS}`);
  }

  private updateBots(s: GameState): void {
    let k = 0;
    for (const p of s.players) {
      if (p.id === this.localPlayer) continue;
      const b = this.bots[k++];
      if (!b) continue;
      const m = p.activeIndex != null ? p.party[p.activeIndex] : null;
      const def = m ? getCharacter(m.defId) : null;
      setText(b.name, p.name);
      const tagged = showsBotTag(p);
      show(b.tag, tagged);
      setClass(b.el, 'is-bot-driven', tagged);
      setAttr(b.el, 'title', tagged ? `${p.name} · 봇이 대신 조작 중` : p.name);
      setClass(b.el, 'is-out', p.out);
      setClass(b.el, 'is-empty', !p.out && !m);
      setStyle(b.portrait, '--c', def ? def.color : '#3a4152');
      setText(b.glyph, p.out ? '✕' : def ? ROLE_GLYPH[def.role] : '·');
      setText(b.charName, p.out ? '' : def ? def.name : '교체 대기');
      setText(b.status, p.out ? '사망' : '');
      const f = m ? frac(m.hp, m.maxHp) : 0;
      setStyle(b.hpFill, 'transform', sx(f));
      hpClass(b.hpFill, f);
      updatePips(b.pips, m && !p.out ? m.statuses : []);
    }
  }

  private updateTop(s: GameState, dt: number): void {
    const bossFloor = s.plan.kind === 'boss';
    show(this.bossBox, bossFloor);
    show(this.enrageVignette, bossFloor && s.bossEnraged && s.bossId !== null);
    show(this.floorBox, !bossFloor);
    this.groggy.update(s); // 기획 13차
    if (bossFloor) {
      const boss = s.bossId != null ? s.entities.find(e => e.id === s.bossId) : undefined;
      const name = bossName(s.plan.bossId);
      setText(this.bossName, name);
      setClass(this.bossName, 'is-long', name.length > 8);
      setText(this.bossLv, `Lv.${s.floor}`);
      this.updatePhases(s.plan.bossId, boss);
      show(this.bossEnrage, s.bossEnraged);
      setClass(this.bossBox, 'is-enraged', s.bossEnraged);
      const f = boss ? frac(boss.hp, boss.maxHp) : 0;
      setText(this.bossPct, `${Math.ceil(f * 100)}%`);
      setStyle(this.bossFill, 'transform', sx(f));
      // trailing "damage taken" bar
      this.bossLagFrac = this.bossLagFrac < f ? f : Math.max(f, this.bossLagFrac - dt * 0.35);
      setStyle(this.bossLag, 'transform', sx(this.bossLagFrac));
      updatePips(this.bossPips, boss ? boss.statuses : [], true);
      // 기획 13차: a groggy boss casts nothing — its spot shows the groggy pill
      show(this.bossCast, !!boss && s.phase === 'combat' && performance.now() < this.castUntil && !groggyDown(s));
    } else {
      show(this.bossCast, false);
      this.castUntil = 0;
      this.bossLagFrac = 1;
      setText(this.floorNum, `${s.floor}층`);
      const zone = zoneName(s.plan.theme, s.floor);
      setText(this.floorZone, zone ? `· ${zone}` : '');
      show(this.floorZone, !!zone);
      const total = s.plan.waves.length;
      setText(this.floorWaves, `웨이브 ${Math.min(total, total - s.wavesRemaining)}/${total}`);
      setText(this.floorEnemies, `남은 적 ${s.monstersAlive}`);
      const mid = s.midBossSpawned ? s.entities.find(e => e.tier === 'mid' && e.team === 'enemy' && e.hp > 0) : undefined;
      show(this.midBox, s.midBossSpawned);
      if (s.midBossSpawned) {
        setText(this.midName, mid ? monsterName(mid.defId) : '중형보스 처치!');
        setClass(this.midBox, 'is-dead', !mid);
        setStyle(this.midFill, 'transform', sx(mid ? frac(mid.hp, mid.maxHp) : 0));
      }
    }
    // timer
    const enraged = bossFloor && s.bossEnraged;
    setText(this.timerLabel, bossFloor ? (enraged ? '보스' : '광폭화까지') : '남은 시간');
    setText(this.timerVal, enraged ? '광폭화' : formatClock(s.timeRemaining));
    setClass(this.timer, 'is-urgent', !enraged && s.timeRemaining < 10 && s.phase === 'combat');
    setClass(this.timer, 'is-enraged', enraged);
  }

  /** Phase diamonds (◆◆◇) next to the HP %, and a tick on the HP bar at each threshold (crossed ones dim). */
  private updatePhases(bossId: string | undefined, boss: Entity | undefined): void {
    const phases = bossPhases(bossId);
    const key = `${bossId ?? ''}:${phases.length}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.bossPhase.replaceChildren();
      this.phaseMarks = [];
      for (const t of this.phaseTicks) t.el.remove();
      this.phaseTicks = [];
      for (let i = 0; i <= phases.length; i++) this.phaseMarks.push(h('i', 'bp-mark', this.bossPhase));
      for (const ph of phases) {
        const el = h('div', 'boss-tick', this.bossBar);
        el.style.left = `${Math.round(ph.hpBelow * 1000) / 10}%`;
        this.phaseTicks.push({ el, at: ph.hpBelow });
      }
      show(this.bossPhase, phases.length > 0);
    }
    if (!phases.length) return;
    const f = boss ? frac(boss.hp, boss.maxHp) : 1;
    let phase = 1;
    for (const ph of phases) if (f < ph.hpBelow) phase++;
    this.phaseMarks.forEach((m, i) => setClass(m, 'is-on', i < phase));
    for (const t of this.phaseTicks) setClass(t.el, 'is-past', f < t.at);
    setAttr(this.bossPhase, 'title', `${phase}페이즈 / ${phases.length + 1}`);
  }

  private updateCards(s: GameState, me: PlayerState): void {
    const combat = s.phase === 'combat' && !me.out;
    const simDt = this.prevSimTime >= 0 ? Math.max(0, s.time - this.prevSimTime) : 0;
    this.prevSimTime = s.time;
    me.party.forEach((m, i) => {
      const c = this.charCards[i];
      if (!c) return;
      const active = me.activeIndex === i;
      // a bench cooldown that fell faster than time passed was cut (크로노 시간 균열, 토끼 펫 …): show by how much
      const prevRem = this.prevSwapRem[i];
      this.prevSwapRem[i] = m.swapCooldownRemaining;
      if (prevRem != null && !active && !m.dead && combat) {
        const cut = prevRem - simDt - m.swapCooldownRemaining;
        if (cut >= CUT_MIN) this.cutPop(c, cut);
      }
      const cooling = !m.dead && !active && m.swapCooldownRemaining > 0;
      const locked = !m.dead && !active && !cooling && (!combat || me.appearLock > 0);
      const ready = !m.dead && !active && !cooling && !locked;
      setClass(c.el, 'is-active', active);
      setClass(c.el, 'is-dead', m.dead);
      setClass(c.el, 'is-cool', cooling || locked);
      setClass(c.el, 'is-ready', ready);
      // 기획 13차: the boss is down — every ready card says '지금!' (the finishing swap)
      setClass(c.el, 'is-now', ready && groggyDown(s));
      // re-appear cooldown = drag-skill cooldown (기획서 4장): the seconds are the big number on the portrait only
      setText(c.state, me.out ? '사망' : active ? '활성화' : m.dead ? '쓰러짐' : cooling ? '쿨타임' : ready ? '교체가능' : '교체불가');
      // big countdown: revive time when dead, else the re-appear cooldown of a benched card.
      // Out (all three down = spectating, R11): timers are frozen → no number; all three come back at the next floor
      // if someone clears this one (기획 5차).
      const t = me.out ? 0 : m.dead ? m.reviveRemaining : cooling ? m.swapCooldownRemaining : 0;
      const showCd = t > 0;
      show(c.cd, showCd);
      if (showCd) {
        setText(c.count, String(countdown(t)));
        const total = m.dead ? Math.max(m.reviveRemaining, this.game.tunables.reviveTime) : Math.max(0.01, m.swapCooldownTotal);
        setStyle(c.cd, '--p', `${Math.round(frac(t, total) * 360)}deg`);
      }
      this.updateNormal(c, m, i, me.out, active);
      const hf = m.dead ? 0 : frac(m.hp, m.maxHp);
      setStyle(c.hpFill, 'transform', sx(hf));
      hpClass(c.hpFill, hf);
      setStyle(c.hpShield, 'transform', sx(m.dead ? 0 : frac(m.shield, m.maxHp)));
      updatePips(c.pips, m.dead ? [] : m.statuses);
    });
  }

  /** "-3초" floating off a card whose re-appear cooldown was just cut, plus a flash of its countdown. */
  private cutPop(c: CharCard, seconds: number): void {
    const pop = h('div', 'cc-cut', c.el, `-${secs(seconds)}초`);
    replayClass(c.cd, 'is-cut');
    setTimeout(() => pop.remove(), 1300);
  }

  /** Full normal-skill cooldown of card i now (the sim's own formula: data × reward cuts; 0 with instant cooldowns). */
  private normalTotal(i: number): number {
    const me = this.game.state.players[this.localPlayer];
    return me?.party[i] ? normalCooldownFor(this.game.tunables, me, i) : 0;
  }

  /**
   * Card diamond: lit = ready (goes off by itself once something is in reach), cooling = dark with the colour sweeping
   * back in clockwise (--p = part elapsed) and the seconds left ("6", "2.4"). Bench timers run too (the sim ticks them).
   * Ready on the field but nothing in reach / stunned: lit but dimmed (waiting, like "대기" in the skill sheet).
   * Dead / spectating: dimmed, no number (the revive countdown is the card's big number).
   */
  private updateNormal(c: CharCard, m: PlayerState['party'][number], i: number, out: boolean, active: boolean): void {
    const rem = out || m.dead ? 0 : Math.max(0, m.normalCooldownRemaining);
    const cooling = rem > 0.001;
    // never shorter than what is left (a reward picked mid-cooldown, a tunables change)
    const total = Math.max(rem, this.normalTotal(i), 0.01);
    const ready = !cooling && !m.dead && !out;
    setClass(c.norm, 'is-cool', cooling);
    setClass(c.norm, 'is-ready', ready);
    setClass(c.norm, 'is-waiting', ready && active && this.normalWaiting(c.def, m.entityId));
    setStyle(c.norm, '--p', `${cooling ? Math.round((1 - rem / total) * 180) * 2 : 360}deg`);
    setText(c.normT, cooling ? cdText(rem) : '');
  }

  /** Ready but not going off: stunned, or nothing in reach (same rules as the sim's tryNormalSkill). */
  private normalWaiting(def: CharacterDef, entityId: number | null): boolean {
    const e = entityId != null ? this.game.state.entities.find(x => x.id === entityId) : undefined;
    return !e || e.statuses.some(st => st.id === 'stun') || !this.normalInReach(def, entityId);
  }

  /** Would the field character's normal skill fire now (same reach rule as the sim: target within castRange)? */
  private normalInReach(def: CharacterDef, entityId: number | null): boolean {
    const s = this.game.state;
    const e = entityId != null ? s.entities.find(x => x.id === entityId) : undefined;
    if (!e) return false;
    const range = def.normal.castRange ?? 0;
    if (range >= 99) return s.entities.some(o => o.team !== e.team && o.hp > 0);
    const t = e.targetId != null ? s.entities.find(x => x.id === e.targetId) : undefined;
    return !!t && t.hp > 0 && edge(e, t) <= range;
  }

  private updateUlt(s: GameState, me: PlayerState): void {
    const charge = Math.max(0, Math.min(1, me.ult.charge));
    const full = charge >= 1;
    const activeDef = me.activeIndex != null ? getCharacter(me.party[me.activeIndex].defId) : null;
    const usable = full && !!activeDef && !me.out && s.phase === 'combat';
    setAttr(this.ultArc, 'stroke-dashoffset', (ULT_C * (1 - charge)).toFixed(1));
    setClass(this.ult, 'is-full', usable);
    setClass(this.ult, 'is-charged', full);
    setClass(this.ult, 'is-disabled', !activeDef || me.out);
    setText(this.ultPct, me.out ? '—' : full ? (usable ? '탭!' : '100%') : `${Math.floor(charge * 100)}%`);
    // charge is time-only (R9): seconds until full = what's left × charge time (기획 10차: traces change its speed)
    const left = (1 - charge) * ultChargeTimeFor(this.game.tunables, me);
    setText(this.ultSub, me.out ? '관전 중' : full ? (activeDef ? '궁극기 준비' : '필드 비었음') : `${countdown(left)}초 후`);
    setText(this.ultName, activeDef ? activeDef.ult.name : '—');
    setStyle(this.ultName, 'color', activeDef ? activeDef.color : '');
  }

  private updatePets(s: GameState, me: PlayerState): void {
    const combat = s.phase === 'combat' && !me.out;
    me.pets.forEach((p, i) => {
      const c = this.petCards[i];
      if (!c) return;
      // spectating: pet timers stop with the player (no frozen countdown)
      const cooling = !me.out && p.cooldownRemaining > 0;
      setClass(c.el, 'is-ready', combat && !cooling);
      setClass(c.el, 'is-cool', cooling || !combat);
      show(c.cd, cooling);
      if (cooling) {
        setText(c.count, `${countdown(p.cooldownRemaining)}s`);
        setStyle(c.cd, '--p', `${Math.round(frac(p.cooldownRemaining, Math.max(0.01, p.cooldownTotal)) * 360)}deg`);
      }
      setText(c.state, me.out ? '—' : cooling ? '쿨타임' : combat ? '준비' : '대기');
    });
  }

  private updateCenter(s: GameState, me: PlayerState): void {
    const spectating = me.out && s.phase !== 'runOver';
    show(this.spectate, spectating);
    setClass(this.root, 'is-spectating', spectating);
    const empty = !me.out && s.phase === 'combat' && me.activeIndex == null;
    show(this.hint, empty);
    setClass(this.root, 'has-hint', empty);
    if (!empty) return;
    let ready = false;
    let wait = Infinity;
    for (const m of me.party) {
      if (!m.dead && m.swapCooldownRemaining <= 0) ready = true;
      const t = m.dead ? Math.max(m.reviveRemaining, m.swapCooldownRemaining) : m.swapCooldownRemaining;
      wait = Math.min(wait, t);
    }
    if (ready && me.appearLock <= 0) {
      setText(this.hintBig, '카드를 필드로 드래그!');
      setText(this.hintSub, '내 필드가 비어 있어요');
      setClass(this.hint, 'is-ready', true);
    } else {
      setText(this.hintBig, `교체 가능까지 ${countdown(Number.isFinite(wait) ? wait : 0)}초`);
      setText(this.hintSub, '내 필드가 비어 있어요');
      setClass(this.hint, 'is-ready', false);
    }
  }
}

// ─────────────────────────── 기획 8차 names ───────────────────────────

/** Zone name of a floor ("사무실층"), from the plan's theme (or the floor number). */
export function zoneName(theme: GameState['plan']['theme'], floor: number): string {
  const z = theme ? ZONES.find(x => x.theme === theme) : ZONES.find(x => floor >= x.from && floor <= x.to);
  return z ? z.name : '';
}

/** The zone's 괴담 line on its first floor (ZoneDef.lore), else ''. */
export function zoneLore(theme: GameState['plan']['theme'], floor: number): string {
  const z = ZONES.find(x => floor >= x.from && floor <= x.to && (!theme || x.theme === theme));
  return z && z.from === floor ? z.lore : '';
}

/** Floor-start banner line for my traces: the newest one ('동승자가 따라 내렸다 — 받는 피해 +12%'), '외 n개' for more. */
function traceBannerLine(me: PlayerState | undefined): string {
  const list = me?.goedamTraces ?? [];
  if (!list.length) return '';
  const line = goedamTraceBanner(list[list.length - 1].id);
  return list.length > 1 ? `${line} · 흔적 외 ${list.length - 1}개` : line;
}

/** A boss pattern's one-time tip (MonsterSkill.hint), phase patterns included. */
function bossSkillHint(bossId: string | undefined, skillId: string): string | null {
  if (!bossId) return null;
  try {
    const def = getBoss(bossId);
    for (const sk of [...def.skills, ...(def.phases ?? []).flatMap(p => p.skills ?? [])]) if (sk.id === skillId) return sk.hint ?? null;
  } catch {
    return null;
  }
  return null;
}

function bossName(id: string | undefined): string {
  if (!id) return '보스';
  try {
    return getBoss(id).name;
  } catch {
    return '보스';
  }
}

function monsterName(id: string): string {
  try {
    return getMonster(id).name;
  } catch {
    return '중형보스';
  }
}

function bossPhases(id: string | undefined): { hpBelow: number }[] {
  if (!id) return [];
  try {
    return getBoss(id).phases ?? [];
  } catch {
    return [];
  }
}
