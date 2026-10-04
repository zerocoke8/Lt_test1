// 디버그 패널 (R24): collapsible side panel that never pauses the game.
// Sliders for every numeric Tunable, toggles, speed buttons and every DebugAction. Mutates game.tunables live.

import type { CommandResult, DebugAction, Game, Tunables } from '../types';
import { DEFAULT_TUNABLES } from '../config';
import { button, h } from './dom';
import { SLIDERS, SPEEDS, TOGGLES, formatTunable, type SliderSpec } from './tunables';
import type { ToastKind } from './toast';

export interface DebugDeps {
  game(): Game | null;
  onTunablesChanged(t: Tunables): void;
  toast(text: string, kind?: ToastKind): void;
}

interface SliderRow {
  spec: SliderSpec;
  input: HTMLInputElement;
  value: HTMLElement;
  row: HTMLElement;
}

export class DebugPanel {
  readonly el: HTMLElement;
  private readonly deps: DebugDeps;
  private readonly body: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly sliders: SliderRow[] = [];
  private readonly toggles: { key: (typeof TOGGLES)[number]['key']; input: HTMLInputElement }[] = [];
  private readonly speedBtns: { v: number; b: HTMLButtonElement }[] = [];
  private readonly floorInput: HTMLElement;
  private jumpTo = 2;
  private collapsed = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement, deps: DebugDeps) {
    this.deps = deps;
    this.el = h('div', 'debug-panel is-hidden', parent);
    const head = h('div', 'dbg-head', this.el);
    h('span', 'dbg-title', head, '디버그');
    h('span', 'dbg-note', head, '게임은 계속 진행돼요');
    this.collapseBtn = button('dbg-hbtn', '접기', head, () => this.setCollapsed(!this.collapsed));
    button('dbg-hbtn', '✕', head, () => this.close()).setAttribute('aria-label', '닫기');
    this.body = h('div', 'dbg-body', this.el);
    // keep wheel/touch scrolling inside the panel
    this.body.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

    // speed
    const sp = this.section('게임 속도');
    const spRow = h('div', 'dbg-btnrow', sp);
    for (const v of SPEEDS) {
      const b = button('dbg-btn dbg-speed', `${v}×`, spRow, () => this.set('gameSpeed', v));
      this.speedBtns.push({ v, b });
    }

    // actions
    const act = this.section('명령');
    const grid = h('div', 'dbg-grid', act);
    const action = (label: string, a: DebugAction) => button('dbg-btn', label, grid, () => this.run(a, label));
    action('궁극기 충전', { kind: 'chargeUlt' });
    action('쿨 초기화', { kind: 'resetCooldowns' });
    action('적 전멸', { kind: 'killAll' });
    action('층 건너뛰기', { kind: 'skipFloor' });
    action('광폭화', { kind: 'forceEnrage' });
    const jump = h('div', 'dbg-jump', act);
    button('dbg-btn dbg-step', '−', jump, () => this.bumpFloor(-1));
    this.floorInput = h('span', 'dbg-floor', jump, '2층');
    button('dbg-btn dbg-step', '+', jump, () => this.bumpFloor(1));
    button('dbg-btn dbg-go', '층 이동', jump, () => this.run({ kind: 'jumpFloor', floor: this.jumpTo }, `${this.jumpTo}층 이동`));

    // toggles
    const tg = this.section('토글');
    for (const t of TOGGLES) {
      const lab = h('label', 'dbg-toggle', tg);
      const input = h('input', '', lab);
      input.type = 'checkbox';
      h('span', 'dbg-switch', lab);
      h('span', 'dbg-toggle-label', lab, t.label);
      input.addEventListener('change', () => this.set(t.key, input.checked));
      this.toggles.push({ key: t.key, input });
    }

    // sliders (grouped)
    let group = '';
    let sec: HTMLElement = tg;
    for (const spec of SLIDERS) {
      if (spec.group !== group) {
        group = spec.group;
        sec = this.section(group);
      }
      const row = h('div', 'dbg-slider', sec);
      const top = h('div', 'dbg-slider-top', row);
      h('span', 'dbg-slider-label', top, spec.label);
      const value = h('span', 'dbg-slider-value', top);
      const input = h('input', '', row);
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.addEventListener('input', () => this.set(spec.key, Number(input.value)));
      this.sliders.push({ spec, input, value, row });
    }

    const foot = this.section('');
    button('dbg-btn dbg-reset', '모든 수치 기본값으로', foot, () => {
      const g = this.deps.game();
      if (!g) return;
      const speed = g.tunables.gameSpeed;
      Object.assign(g.tunables, DEFAULT_TUNABLES, { gameSpeed: speed });
      this.persist();
      this.sync();
      this.deps.toast('튜닝 수치를 기본값으로 되돌렸어요', 'good');
    });
  }

  private section(title: string): HTMLElement {
    const s = h('div', 'dbg-sec', this.body);
    if (title) h('div', 'dbg-sec-title', s, title);
    return s;
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('is-hidden');
  }

  open(): void {
    this.el.classList.remove('is-hidden');
    const g = this.deps.game();
    if (g) this.jumpTo = Math.min(g.tunables.maxFloor, g.state.floor + 1);
    this.setCollapsed(false);
    this.sync();
  }

  close(): void {
    this.el.classList.add('is-hidden');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private setCollapsed(on: boolean): void {
    this.collapsed = on;
    this.el.classList.toggle('is-collapsed', on);
    this.collapseBtn.textContent = on ? '펼치기' : '접기';
  }

  private bumpFloor(d: number): void {
    const g = this.deps.game();
    const max = g ? Math.max(1, g.tunables.maxFloor) : 20;
    this.jumpTo = Math.max(1, Math.min(max, this.jumpTo + d));
    this.floorInput.textContent = `${this.jumpTo}층`;
  }

  private run(a: DebugAction, label: string): void {
    const g = this.deps.game();
    if (!g) return;
    const r: CommandResult = g.dispatch({ type: 'debug', action: a });
    this.deps.toast(r.ok ? `디버그: ${label}` : `${label} 실패 · ${r.reason ?? ''}`, r.ok ? 'good' : 'warn');
  }

  private set<K extends keyof Tunables>(key: K, v: Tunables[K]): void {
    const g = this.deps.game();
    if (!g) return;
    g.tunables[key] = v;
    this.sync();
    if (key !== 'gameSpeed') this.persist();
  }

  private persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      const g = this.deps.game();
      if (g) this.deps.onTunablesChanged(g.tunables);
    }, 250);
  }

  /** Reflect game.tunables in the controls. */
  sync(): void {
    const g = this.deps.game();
    if (!g) return;
    const t = g.tunables;
    for (const s of this.sliders) {
      const v = t[s.spec.key];
      if (document.activeElement !== s.input) s.input.value = String(v);
      s.value.textContent = formatTunable(s.spec, v);
      s.row.classList.toggle('is-changed', v !== DEFAULT_TUNABLES[s.spec.key]);
    }
    for (const tg of this.toggles) tg.input.checked = t[tg.key];
    for (const sb of this.speedBtns) sb.b.classList.toggle('is-on', Math.abs(sb.v - t.gameSpeed) < 1e-6);
    this.floorInput.textContent = `${this.jumpTo}층`;
  }
}
