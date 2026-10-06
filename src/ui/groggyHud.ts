// 기획 13차 보스 그로기 HUD (docs/boss-groggy.md 6장): the groggy row right under the boss HP bar (amber gauge with
// 25/50/75 % ticks, star icon, white flash + '+N' in the filler's colour on a gain, blink + ⚡ + gold box when almost
// full), the countdown while the boss is down (bright gold bar shrinking right → left + the '그로기! 4.2초' pill in the
// cast-pill spot, red blink for the last 1.5 s), the grey hatch refilling during the lock, the phase banner held back
// until the boss stands up (+0.4 s), and the one-time tip. Everything is drawn from state.bossGroggy (rejoin-safe);
// events only add the flashes. Hud (hud.ts) owns the boss box and calls onEvents() / update().

import type { BossGroggyState, GameEvent, GameState, Tunables } from '../types';
import { h, replayClass, setClass, setStyle, setText, show } from './dom';
import { markTipSeen, tipSeen } from './storage';
import type { ToastKind } from './toast';

const TIP_ID = 'hint:groggy';
/** The held phase banner shows this long after the boss stands up. */
const PHASE_DELAY_MS = 400;
/** Countdown turns red (곧 일어나요) for the last seconds. */
const ENDING_SEC = 1.5;
const POP_MS = 600;

type PhaseEvent = Extract<GameEvent, { type: 'bossPhase' }>;

export interface GroggyHudDeps {
  localPlayer: number;
  toast(text: string, kind: ToastKind): void;
  /** Show the (held) phase banner now. */
  phaseBanner(e: PhaseEvent): void;
  tunables(): Pick<Tunables, 'bossGroggyDuration' | 'bossGroggyDragMult'>;
}

/** The boss is down right now. */
export function groggyDown(s: Pick<GameState, 'bossGroggy'>): boolean {
  return (s.bossGroggy?.left ?? 0) > 0;
}

/** Pill text while the boss is down: '그로기! 4.2초 · 드래그 ×2'. */
export function groggyPillText(g: BossGroggyState, dragMult: number): string {
  const m = Math.round(dragMult * 10) / 10;
  return `그로기! ${Math.max(0, g.left).toFixed(1)}초 · 드래그 ×${m}`;
}

/** Bar fill 0..1 and mode: gauge, down (countdown), lock (hatch refilling). */
export function groggyBar(g: BossGroggyState): { mode: 'fill' | 'down' | 'lock'; f: number } {
  if (g.left > 0) return { mode: 'down', f: g.total > 0 ? g.left / g.total : 0 };
  if (g.lock > 0) return { mode: 'lock', f: g.lockTotal > 0 ? 1 - g.lock / g.lockTotal : 1 };
  return { mode: 'fill', f: Math.max(0, Math.min(1, g.fill)) };
}

export class GroggyHud {
  private readonly box: HTMLElement;
  private readonly row: HTMLElement;
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly hatch: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly deps: GroggyHudDeps;
  private held: PhaseEvent[] = [];
  private heldAt = 0;
  private wasDown = false;

  /** row goes right under the HP bar (before `before`), the pill in the boss box like the cast pill. */
  constructor(box: HTMLElement, before: HTMLElement, deps: GroggyHudDeps) {
    this.box = box;
    this.deps = deps;
    this.row = h('div', 'boss-groggy is-hidden');
    box.insertBefore(this.row, before);
    h('span', 'bg-icon', this.row, '✦');
    this.track = h('div', 'bg-track', this.row);
    this.fill = h('div', 'bg-fill', this.track);
    this.hatch = h('div', 'bg-hatch', this.track);
    for (const at of [25, 50, 75]) h('i', 'bg-tick', this.track).style.left = `${at}%`;
    h('span', 'bg-bolt', this.row, '⚡');
    this.pill = h('div', 'boss-gpill is-hidden', box);
  }

  /** Events of this frame. Returns true when a 'bossPhase' banner is held back (the boss is down). */
  onEvent(s: GameState, e: GameEvent): boolean {
    switch (e.type) {
      case 'floorStart':
        this.held = [];
        this.heldAt = 0;
        if (e.kind === 'boss' && s.bossGroggy && !tipSeen(TIP_ID)) {
          markTipSeen(TIP_ID);
          this.deps.toast('ⓘ 드래그·기절로 그로기 게이지를 채우면 보스가 5초간 쓰러져요', 'info');
        }
        return false;
      case 'groggyGain':
        this.gainPop(s, e.player, e.amount);
        return false;
      case 'bossGroggy':
        replayClass(this.box, 'is-break');
        return false;
      case 'bossPhase':
        if (!groggyDown(s)) return false;
        this.held.push(e);
        return true;
      default:
        return false;
    }
  }

  private gainPop(s: GameState, player: number, amount: number): void {
    const g = s.bossGroggy;
    if (!g) return;
    replayClass(this.track, 'is-gain');
    const pop = h('span', 'bg-pop', this.row, `+${Math.round(amount)}`);
    pop.style.left = `${Math.round(Math.min(1, g.fill) * 100)}%`;
    pop.style.color = s.players[player]?.color ?? '#ffd166';
    setTimeout(() => pop.remove(), POP_MS);
  }

  /** Per DOM frame (boss floors). */
  update(s: GameState): void {
    const g = s.plan.kind === 'boss' ? s.bossGroggy : null;
    show(this.row, !!g);
    const down = !!g && g.left > 0;
    show(this.pill, down && s.phase === 'combat');
    setClass(this.box, 'is-groggy', down);
    setClass(this.box, 'is-near', !!g && g.near);
    this.releaseHeld(s, down);
    if (!g) return;
    const bar = groggyBar(g);
    const ending = down && g.left <= ENDING_SEC;
    setClass(this.row, 'is-near', g.near);
    setClass(this.row, 'is-down', down);
    setClass(this.row, 'is-lock', bar.mode === 'lock');
    setClass(this.row, 'is-ending', ending);
    setClass(this.pill, 'is-ending', ending);
    setStyle(this.fill, 'transform', `scaleX(${bar.mode === 'lock' ? 0 : (Math.round(bar.f * 400) / 400).toFixed(4)})`);
    setStyle(this.hatch, 'transform', `scaleX(${bar.mode === 'lock' ? (Math.round(bar.f * 200) / 200).toFixed(3) : 0})`);
    if (down) setText(this.pill, groggyPillText(g, this.deps.tunables().bossGroggyDragMult));
  }

  /** Phase banners held while the boss was down: 0.4 s after it stands up (or right away off the boss floor). */
  private releaseHeld(s: GameState, down: boolean): void {
    if (this.wasDown && !down) this.heldAt = performance.now() + PHASE_DELAY_MS;
    this.wasDown = down;
    if (this.held.length === 0 || down) return;
    if (s.phase !== 'combat' || s.plan.kind !== 'boss') {
      this.held = [];
      return;
    }
    if (performance.now() < this.heldAt) return;
    const last = this.held[this.held.length - 1];
    this.held = [];
    this.deps.phaseBanner(last);
  }
}
