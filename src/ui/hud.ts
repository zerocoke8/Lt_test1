// 전투 HUD (기획서 13장 목업 배치). DOM is built once per run; update() diffs cheaply (~30 Hz).
//  좌상단: 봇 2명 · 상단 중앙: 보스 바 / 층 정보 · 우상단: 타이머 + 설정
//  좌하단: 내 캐릭터 카드 3장 · 하단 중앙: 궁극기 게이지 · 우하단: 펫 카드 3장
//  중앙: 배너(층 시작/클리어/광폭화), 필드 비었을 때 안내, 관전 안내

import { DEBUFFS, type Game, type GameEvent, type GameState, type PlayerState, type StatusInstance } from '../types';
import { ROLE_LABEL, getBoss, getCharacter, getMonster, getPet } from '../data';
import { ICON_GEAR, ROLE_ICON, button, h, replayClass, setAttr, setClass, setStyle, setText, show } from './dom';
import { ROLE_GLYPH, STATUS_GLYPH, STATUS_LABEL, countdown, formatClock, refusalText } from './format';
import { petIcon, portrait } from './preset';
import { createToaster, type ToastKind } from './toast';

export const LOCAL_PLAYER = 0;
const DOM_INTERVAL_MS = 1000 / 30 - 2;
const ULT_R = 50;
const ULT_C = 2 * Math.PI * ULT_R;

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
  pips: Pip[];
  cd: HTMLElement;
  count: HTMLElement;
  hpFill: HTMLElement;
  hpShield: HTMLElement;
  state: HTMLElement;
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
  readonly petCards: PetCard[] = [];
  private readonly game: Game;
  private readonly cb: HudCallbacks;
  private readonly toaster;
  private readonly bots: BotPanel[] = [];
  // top center
  private readonly bossBox: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossLv: HTMLElement;
  private readonly bossEnrage: HTMLElement;
  private readonly bossPct: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossLag: HTMLElement;
  private readonly bossPips: Pip[];
  private bossLagFrac = 1;
  /** Boss pattern name ("cast pill") under the boss HP bar, shown until castUntil (performance.now ms). */
  private readonly bossCast: HTMLElement;
  private castUntil = 0;
  private readonly floorBox: HTMLElement;
  private readonly floorNum: HTMLElement;
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

  constructor(layer: HTMLElement, game: Game, cb: HudCallbacks) {
    this.game = game;
    this.cb = cb;
    const s = game.state;
    const me = s.players[LOCAL_PLAYER];
    this.root = h('div', 'hud', layer);

    // ── top-left: other players (bots) ──
    const tl = h('div', 'hud-tl', this.root);
    for (const p of s.players) {
      if (p.id === LOCAL_PLAYER) continue;
      const el = h('div', 'bot hud-block', tl);
      el.style.setProperty('--pc', p.color);
      const por = h('div', 'portrait bot-portrait', el);
      const glyph = h('span', 'portrait-glyph', por);
      const info = h('div', 'bot-info', el);
      const nameRow = h('div', 'bot-name-row', info);
      h('span', 'bot-name', nameRow, p.name);
      const status = h('span', 'bot-status', nameRow);
      const charName = h('div', 'bot-char', info);
      const hp = h('div', 'bar bot-hp', info);
      const hpFill = h('div', 'bar-fill', hp);
      const pips = makePips(el, 6, 'bot-pips');
      this.bots.push({ el, portrait: por, glyph, charName, hpFill, pips, status });
    }

    // ── top-center: boss bar / floor info ──
    const tc = h('div', 'hud-tc', this.root);
    this.bossBox = h('div', 'boss hud-block is-hidden', tc);
    const brow = h('div', 'boss-row', this.bossBox);
    this.bossLv = h('span', 'boss-lv', brow);
    this.bossName = h('span', 'boss-name', brow);
    this.bossEnrage = h('span', 'boss-enrage is-hidden', brow, '광폭화');
    this.bossPct = h('span', 'boss-pct', brow);
    const bbar = h('div', 'bar boss-bar', this.bossBox);
    this.bossLag = h('div', 'bar-lag', bbar);
    this.bossFill = h('div', 'bar-fill', bbar);
    this.bossPips = makePips(this.bossBox, 16, 'boss-pips');
    // over the (mostly empty) status-pip row: right under the HP bar but clear of the boss's big eye below the box
    this.bossCast = h('div', 'boss-cast is-hidden', this.bossBox);
    this.floorBox = h('div', 'floorinfo hud-block', tc);
    const frow = h('div', 'fi-row', this.floorBox);
    this.floorNum = h('span', 'fi-floor', frow);
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
    this.timer = h('div', 'timer hud-block', tr);
    this.timerLabel = h('div', 'timer-label', this.timer, '남은 시간');
    this.timerVal = h('div', 'timer-val', this.timer, '00:00');
    const gear = button('icon-btn hud-block', '', tr, () => cb.onPause());
    gear.innerHTML = ICON_GEAR;
    gear.setAttribute('aria-label', '일시정지');

    // ── bottom-left: my character cards ──
    const bl = h('div', 'hud-bl', this.root);
    me.party.forEach((m, i) => {
      const def = getCharacter(m.defId);
      const el = h('div', 'ccard hud-block', bl);
      el.style.setProperty('--c', def.color);
      el.dataset.idx = String(i);
      const pips = makePips(el, 6, 'cc-pips');
      const frame = h('div', 'cc-frame', el);
      const role = h('div', 'cc-role', frame);
      role.innerHTML = ROLE_ICON[def.role];
      role.title = ROLE_LABEL[def.role];
      h('div', 'cc-slot', frame, String(i + 1));
      const por = portrait(def, 'cc-portrait', frame);
      const cd = h('div', 'cc-cd is-hidden', por);
      const count = h('span', 'cc-count', cd);
      h('div', 'cc-name', frame, def.name);
      const hp = h('div', 'bar cc-hp', frame);
      const hpFill = h('div', 'bar-fill', hp);
      const hpShield = h('div', 'bar-shield', hp);
      const state = h('div', 'cc-state', frame);
      el.addEventListener('pointerdown', ev => cb.onCardDown('swap', i, ev, el));
      this.charCards.push({ el, pips, cd, count, hpFill, hpShield, state });
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
    this.spectate = h('div', 'spectate is-hidden', this.root);
    const sbox = h('div', 'spectate-box hud-block', this.spectate);
    h('div', 'sp-title', sbox, '사망 — 관전 중');
    h('div', 'sp-sub', sbox, '내 캐릭터 3명이 모두 쓰러졌어요. 다른 플레이어가 계속 싸워요.');
    button('btn btn-primary', '결과 보기', sbox, () => cb.onShowResult());

    this.toaster = createToaster(this.root, 'toasts-hud');
    this.prevDead = me.party.map(m => m.dead);
  }

  destroy(): void {
    this.root.remove();
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
    const me = this.game.state.players[LOCAL_PLAYER];
    const m = kind === 'swap' ? me.party[index] : undefined;
    const pet = kind === 'pet' ? me.pets[index] : undefined;
    this.toast(refusalText(reason, { kind, cooldown: m ? m.swapCooldownRemaining : pet?.cooldownRemaining, revive: m?.reviveRemaining }), 'warn');
    this.shake(kind, index);
  }

  /** A full-stage overlay (reward) is up: hide banners/hints/toasts underneath. */
  setCovered(on: boolean): void {
    setClass(this.root, 'is-covered', on);
  }

  setDragging(kind: 'swap' | 'pet' | null, index: number): void {
    const key = kind ? `${kind}:${index}` : '';
    if (key === this.draggingKey) return;
    this.draggingKey = key;
    this.charCards.forEach((c, i) => c.el.classList.toggle('is-dragging', kind === 'swap' && i === index));
    this.petCards.forEach((c, i) => c.el.classList.toggle('is-dragging', kind === 'pet' && i === index));
    this.root.classList.toggle('is-drag', !!kind);
  }

  // ─────────────────────────── events ───────────────────────────

  private banner(big: string, sub: string, kind: string): void {
    this.bannerBox.replaceChildren();
    const b = h('div', `banner banner-${kind}`, this.bannerBox);
    h('div', 'banner-big', b, big);
    if (sub) h('div', 'banner-sub', b, sub);
    setTimeout(() => b.remove(), 2300);
  }

  private onEvents(s: GameState, events: GameEvent[]): void {
    const retreat = events.some(e => e.type === 'bossRetreat');
    for (const e of events) {
      switch (e.type) {
        case 'floorStart':
          if (e.kind === 'boss') {
            const name = s.plan.bossId ? getBoss(s.plan.bossId).name : '보스';
            this.banner(`${e.floor}층 · 보스`, `${name} — HP를 0으로 만들면 퇴각해요`, 'boss');
          } else {
            this.banner(`${e.floor}층`, `몬스터를 모두 처치하세요 · 제한시간 ${formatClock(s.plan.timeLimit)}`, 'floor');
          }
          break;
        case 'floorClear':
          this.banner(retreat ? '보스 퇴각!' : '클리어!', `${e.floor}층 돌파 · 살아 있는 캐릭터 HP 회복`, 'clear');
          break;
        case 'enrage':
          this.banner('보스 광폭화!', '공격력 · 공격 속도 · 소환량 증가', 'enrage');
          break;
        case 'skillCast':
          if (e.sourceId !== null && e.sourceId === s.bossId && e.name) {
            // telegraphed patterns stay up until they land; instant ones (소환) for a moment
            const tg = s.telegraphs.find(t => t.team === 'enemy' && Math.abs(t.center.x - e.center.x) < 1e-6 && Math.abs(t.center.y - e.center.y) < 1e-6);
            const secs = Math.max(1.6, (tg ? tg.remaining : 0) + 0.3);
            setText(this.bossCast, `⚠ ${e.name}`);
            show(this.bossCast, true);
            replayClass(this.bossCast, 'is-new');
            this.castUntil = performance.now() + secs * 1000;
          }
          break;
        case 'runOver':
          this.banner(e.result.outcome === 'victory' ? '승리!' : '런 실패', '', e.result.outcome === 'victory' ? 'clear' : 'enrage');
          break;
        case 'playerOut':
          if (e.player !== LOCAL_PLAYER) this.toast(`${s.players[e.player]?.name ?? '플레이어'} 사망 · 관전 중`, 'warn');
          break;
        case 'revive':
          if (e.player === LOCAL_PLAYER) {
            const m = s.players[LOCAL_PLAYER].party[e.partyIndex];
            if (m) this.toast(`${getCharacter(m.defId).name} 부활! 카드로 돌아왔어요`, 'good');
          }
          break;
      }
    }
  }

  // ─────────────────────────── per-frame ───────────────────────────

  update(s: GameState, events: GameEvent[], force = false): void {
    if (events.length) this.onEvents(s, events);
    const me = s.players[LOCAL_PLAYER];
    // death toasts (state diff, so it also covers DoT/explosions)
    me.party.forEach((m, i) => {
      if (m.dead && !this.prevDead[i] && !me.out) {
        const anyOther = me.party.some((x, j) => j !== i && !x.dead);
        this.toast(`${getCharacter(m.defId).name} 쓰러짐${anyOther ? ' · 다른 카드를 끌어 놓으세요' : ''}`, 'warn');
      }
      this.prevDead[i] = m.dead;
    });
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
  }

  private updateBots(s: GameState): void {
    let k = 0;
    for (const p of s.players) {
      if (p.id === LOCAL_PLAYER) continue;
      const b = this.bots[k++];
      if (!b) continue;
      const m = p.activeIndex != null ? p.party[p.activeIndex] : null;
      const def = m ? getCharacter(m.defId) : null;
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
    show(this.floorBox, !bossFloor);
    if (bossFloor) {
      const boss = s.bossId != null ? s.entities.find(e => e.id === s.bossId) : undefined;
      const name = s.plan.bossId ? getBoss(s.plan.bossId).name : '보스';
      setText(this.bossName, name);
      setText(this.bossLv, `Lv.${s.floor}`);
      show(this.bossEnrage, s.bossEnraged);
      setClass(this.bossBox, 'is-enraged', s.bossEnraged);
      const f = boss ? frac(boss.hp, boss.maxHp) : 0;
      setText(this.bossPct, `${Math.ceil(f * 100)}%`);
      setStyle(this.bossFill, 'transform', sx(f));
      // trailing "damage taken" bar
      this.bossLagFrac = this.bossLagFrac < f ? f : Math.max(f, this.bossLagFrac - dt * 0.35);
      setStyle(this.bossLag, 'transform', sx(this.bossLagFrac));
      updatePips(this.bossPips, boss ? boss.statuses : [], true);
      show(this.bossCast, !!boss && s.phase === 'combat' && performance.now() < this.castUntil);
    } else {
      show(this.bossCast, false);
      this.castUntil = 0;
      this.bossLagFrac = 1;
      setText(this.floorNum, `${s.floor}층`);
      const total = s.plan.waves.length;
      setText(this.floorWaves, `웨이브 ${Math.min(total, total - s.wavesRemaining)}/${total}`);
      setText(this.floorEnemies, `남은 적 ${s.monstersAlive}`);
      const mid = s.midBossSpawned ? s.entities.find(e => e.tier === 'mid' && e.team === 'enemy' && e.hp > 0) : undefined;
      show(this.midBox, s.midBossSpawned);
      if (s.midBossSpawned) {
        setText(this.midName, mid ? getMonster(mid.defId).name : '중형보스 처치!');
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

  private updateCards(s: GameState, me: PlayerState): void {
    const combat = s.phase === 'combat' && !me.out;
    me.party.forEach((m, i) => {
      const c = this.charCards[i];
      if (!c) return;
      const active = me.activeIndex === i;
      const cooling = !m.dead && !active && m.swapCooldownRemaining > 0;
      const locked = !m.dead && !active && !cooling && (!combat || me.appearLock > 0);
      const ready = !m.dead && !active && !cooling && !locked;
      setClass(c.el, 'is-active', active);
      setClass(c.el, 'is-dead', m.dead);
      setClass(c.el, 'is-cool', cooling || locked);
      setClass(c.el, 'is-ready', ready);
      setText(c.state, active ? '활성화' : ready ? '교체가능' : '교체불가');
      // big countdown: revive time when dead, else the re-appear cooldown of a benched card
      const t = m.dead ? m.reviveRemaining : cooling ? m.swapCooldownRemaining : 0;
      const showCd = t > 0;
      show(c.cd, showCd);
      if (showCd) {
        setText(c.count, String(countdown(t)));
        const total = m.dead ? Math.max(m.reviveRemaining, this.game.tunables.reviveTime) : Math.max(0.01, m.swapCooldownTotal);
        setStyle(c.cd, '--p', `${Math.round(frac(t, total) * 360)}deg`);
      }
      const hf = m.dead ? 0 : frac(m.hp, m.maxHp);
      setStyle(c.hpFill, 'transform', sx(hf));
      hpClass(c.hpFill, hf);
      setStyle(c.hpShield, 'transform', sx(m.dead ? 0 : frac(m.shield, m.maxHp)));
      updatePips(c.pips, m.dead ? [] : m.statuses);
    });
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
    setText(this.ultPct, full ? (usable ? 'TAP' : '100%') : `${Math.floor(charge * 100)}%`);
    setText(this.ultSub, !activeDef ? '필드 비었음' : full ? '궁극기 준비' : '궁극기');
    setText(this.ultName, activeDef ? activeDef.ult.name : '—');
    setStyle(this.ultName, 'color', activeDef ? activeDef.color : '');
  }

  private updatePets(s: GameState, me: PlayerState): void {
    const combat = s.phase === 'combat' && !me.out;
    me.pets.forEach((p, i) => {
      const c = this.petCards[i];
      if (!c) return;
      const cooling = p.cooldownRemaining > 0;
      setClass(c.el, 'is-ready', combat && !cooling);
      setClass(c.el, 'is-cool', cooling || !combat);
      show(c.cd, cooling);
      if (cooling) {
        setText(c.count, `${countdown(p.cooldownRemaining)}s`);
        setStyle(c.cd, '--p', `${Math.round(frac(p.cooldownRemaining, Math.max(0.01, p.cooldownTotal)) * 360)}deg`);
      }
      setText(c.state, cooling ? '쿨타임' : combat ? '준비' : '대기');
    });
  }

  private updateCenter(s: GameState, me: PlayerState): void {
    show(this.spectate, me.out && s.phase !== 'runOver');
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
