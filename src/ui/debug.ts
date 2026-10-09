// 디버그 패널 (R24): collapsible side panel that never pauses the game.
// Sliders for every numeric Tunable, toggles, speed buttons and every DebugAction. Mutates game.tunables live.

import type { CommandResult, DebugAction, Game, Tunables } from '../types';
import { DEFAULT_TUNABLES } from '../config';
import { FIELD_EVENTS, GOEDAM_ROOMS } from '../data';
import { button, h } from './dom';
import { SLIDERS, SPEEDS, TOGGLES, formatTunable, type SliderSpec } from './tunables';
import type { ToastKind } from './toast';
import { HIT_STOP_RANGE, JUICE, JUICE_DEFAULTS, SHAKE_RANGE, type JuiceSettings } from '../render/juice';
import { loadJuice, saveJuice } from './storage';
import { mountSfxBoard } from '../audio/devboard';
import { battleGearFiles, setBattleGearFiles } from '../render/gearArt';
import { saveGearArtFiles } from './expeditionStore';

/** Render-only sliders (this device only, never sent to the server): 기획 8차 drag-landing feel. */
const JUICE_SLIDERS: { key: keyof JuiceSettings; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'hitStopMs', label: '타격 멈춤 길이', ...HIT_STOP_RANGE, fmt: v => (v <= 0 ? '끔' : `${Math.round(v)}ms`) },
  { key: 'shake', label: '화면 흔들림 세기', ...SHAKE_RANGE, fmt: v => (v <= 0 ? '끔' : `${v.toFixed(1)}×`) },
];

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

/**
 * 기획 14차 리뷰: a phone scroll that starts on a slider must not move it (the panel is scrolled by swiping across many
 * sliders; in multiplayer the host would broadcast every accidental value). Touch only: the value is taken once the
 * finger moves mostly sideways (a drag) or on a tap; a vertical swipe scrolls the panel (touch-action: pan-y) and puts
 * back the value the slider had. Mouse / keyboard / test fill: applied on every input as before.
 */
export function touchSafeRange(input: HTMLInputElement, apply: () => void): void {
  let g: { x: number; y: number; v: string; mode: 'pending' | 'drag' | 'scroll' } | null = null;
  const SLOP = 8;
  input.addEventListener(
    'touchstart',
    e => {
      const t = e.touches[0];
      g = t ? { x: t.clientX, y: t.clientY, v: input.value, mode: 'pending' } : null;
    },
    { passive: true },
  );
  input.addEventListener(
    'touchmove',
    e => {
      const t = e.touches[0];
      if (!g || !t || g.mode !== 'pending') return;
      const dx = Math.abs(t.clientX - g.x);
      const dy = Math.abs(t.clientY - g.y);
      if (dx >= SLOP && dx > dy) {
        g.mode = 'drag';
        apply();
      } else if (dy >= SLOP) {
        g.mode = 'scroll';
        input.value = g.v;
      }
    },
    { passive: true },
  );
  const end = (e: TouchEvent, cancelled: boolean) => {
    if (!g) return;
    const { mode, v, y } = g;
    g = null;
    // still undecided (the browser may stop sending moves once it scrolls): a finger that ended away vertically scrolled
    const t = e.changedTouches[0];
    const moved = !!t && Math.abs(t.clientY - y) >= SLOP;
    if (mode === 'scroll' || (mode === 'pending' && (cancelled || moved))) input.value = v;
    else apply(); // a tap (or the end of a sideways drag)
  };
  input.addEventListener('touchend', e => end(e, false));
  input.addEventListener('touchcancel', e => end(e, true));
  input.addEventListener('input', () => {
    if (!g) return apply();
    if (g.mode === 'drag') apply();
    else if (g.mode === 'scroll') input.value = g.v;
    // pending: wait for the gesture to declare itself
  });
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
  private readonly juiceRows: { key: keyof JuiceSettings; input: HTMLInputElement; value: HTMLElement; row: HTMLElement; fmt: (v: number) => string }[] = [];
  private jumpTo = 2;
  /** 기획 10차 '다음 클리어에 괴담 방': -1 = any room that fits the floor, else an index into GOEDAM_ROOMS. */
  private roomPick = -1;
  private readonly roomLabel: HTMLElement;
  /** 기획 12차 '다음 돌발 괴담': -1 = any event that fits the floor, else an index into FIELD_EVENTS. */
  private eventPick = -1;
  private readonly eventLabel: HTMLElement;
  private collapsed = false;
  private readonly expSec: HTMLElement;
  private readonly artBtn: HTMLButtonElement;
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

    const toggle = (parent: HTMLElement, t: (typeof TOGGLES)[number]) => {
      const lab = h('label', 'dbg-toggle', parent);
      lab.dataset.key = t.key;
      const input = h('input', '', lab);
      input.type = 'checkbox';
      h('span', 'dbg-switch', lab);
      h('span', 'dbg-toggle-label', lab, t.label);
      input.addEventListener('change', () => this.set(t.key, input.checked));
      this.toggles.push({ key: t.key, input });
    };
    // speed
    const sp = this.section('게임 속도');
    const spRow = h('div', 'dbg-btnrow', sp);
    for (const v of SPEEDS) {
      const b = button('dbg-btn dbg-speed', `${v}×`, spRow, () => this.set('gameSpeed', v));
      this.speedBtns.push({ v, b });
    }

    // 기획 15차 원정: only while an expedition stage runs
    this.expSec = this.section('원정');
    const expRow = h('div', 'dbg-btnrow', this.expSec);
    button('dbg-btn dbg-exp-clear', '단계 즉시 클리어', expRow, () => this.run({ kind: 'expeditionClearStage' }, '단계 즉시 클리어'));
    this.artBtn = button('dbg-btn', '', expRow, () => {
      const on = !battleGearFiles();
      setBattleGearFiles(on);
      saveGearArtFiles(on);
      this.syncExp();
    });

    // actions
    const act = this.section('명령');
    const grid = h('div', 'dbg-grid', act);
    const action = (label: string, a: DebugAction) => button('dbg-btn', label, grid, () => this.run(a, label));
    action('궁극기 충전', { kind: 'chargeUlt' });
    action('쿨 초기화', { kind: 'resetCooldowns' });
    action('적 전멸', { kind: 'killAll' });
    action('층 건너뛰기', { kind: 'skipFloor' });
    action('광폭화', { kind: 'forceEnrage' });
    action('전멸 (패배)', { kind: 'wipeParty' }); // 기획 16차
    // 기획 13차: boss groggy gauge — break now / almost full
    action('그로기', { kind: 'forceGroggy' });
    action('그로기 직전', { kind: 'forceGroggy', fill: 0.85 });
    const jump = h('div', 'dbg-jump', act);
    button('dbg-btn dbg-step', '−', jump, () => this.bumpFloor(-1));
    this.floorInput = h('span', 'dbg-floor', jump, '2층');
    button('dbg-btn dbg-step', '+', jump, () => this.bumpFloor(1));
    button('dbg-btn dbg-go', '층 이동', jump, () => this.run({ kind: 'jumpFloor', floor: this.jumpTo }, `${this.jumpTo}층 이동`));
    // 기획 10차: open a 괴담 room after the next floor clear (any floor, even with the slider at 0)
    const gd = h('div', 'dbg-jump dbg-goedam', act);
    button('dbg-btn dbg-step', '◀', gd, () => this.bumpRoom(-1));
    this.roomLabel = h('span', 'dbg-floor dbg-room', gd);
    button('dbg-btn dbg-step', '▶', gd, () => this.bumpRoom(1));
    button('dbg-btn dbg-go', '다음 클리어에 괴담 방', h('div', 'dbg-btnrow', act), () => {
      const room = GOEDAM_ROOMS[this.roomPick];
      this.run(room ? { kind: 'goedamNext', room: room.id } : { kind: 'goedamNext' }, `다음 클리어에 괴담 방 (${room ? room.name : '아무 방'})`);
    });
    this.bumpRoom(0);
    // 기획 12차: start a 돌발 괴담 now (early in a normal floor) or 8 s into the next normal floor
    const fe = h('div', 'dbg-jump dbg-goedam', act);
    button('dbg-btn dbg-step', '◀', fe, () => this.bumpEvent(-1));
    this.eventLabel = h('span', 'dbg-floor dbg-room', fe);
    button('dbg-btn dbg-step', '▶', fe, () => this.bumpEvent(1));
    button('dbg-btn dbg-go', '다음 돌발 괴담', h('div', 'dbg-btnrow', act), () => {
      const ev = FIELD_EVENTS[this.eventPick];
      this.run(ev ? { kind: 'fieldEventNext', id: ev.id } : { kind: 'fieldEventNext' }, `돌발 괴담 (${ev ? ev.name : '아무거나'})`);
    });
    this.bumpEvent(0);

    // render-only feel (this device): applied right away, saved locally — works in solo and multiplayer
    Object.assign(JUICE, loadJuice());
    const fx = this.section('연출 (이 기기만)');
    for (const js of JUICE_SLIDERS) {
      const row = h('div', 'dbg-slider', fx);
      const top = h('div', 'dbg-slider-top', row);
      h('span', 'dbg-slider-label', top, js.label);
      const value = h('span', 'dbg-slider-value', top);
      const input = h('input', '', row);
      input.type = 'range';
      input.min = String(js.min);
      input.max = String(js.max);
      input.step = String(js.step);
      touchSafeRange(input, () => {
        JUICE[js.key] = Number(input.value);
        saveJuice(JUICE);
        this.syncJuice();
      });
      this.juiceRows.push({ key: js.key, input, value, row, fmt: js.fmt });
    }
    button('dbg-btn', '연출 기본값', h('div', 'dbg-btnrow', fx), () => {
      Object.assign(JUICE, JUICE_DEFAULTS);
      saveJuice(JUICE);
      this.syncJuice();
    });
    this.syncJuice();

    // toggles
    const tg = this.section('토글');
    for (const t of TOGGLES) toggle(tg, t);

    // sliders (grouped)
    let group = '';
    let sec: HTMLElement = tg;
    for (const spec of SLIDERS) {
      if (spec.group !== group) {
        group = spec.group;
        sec = this.section(group);
      }
      this.slider(sec, spec);
    }

    // 기획 13차 효과음: every sound id ▶ (this device)
    mountSfxBoard(this.section('효과음 (이 기기만)'));

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

  private slider(parent: HTMLElement, spec: SliderSpec): void {
    const row = h('div', 'dbg-slider', parent);
    row.dataset.key = spec.key;
    const top = h('div', 'dbg-slider-top', row);
    h('span', 'dbg-slider-label', top, spec.label);
    const value = h('span', 'dbg-slider-value', top);
    const input = h('input', '', row);
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    touchSafeRange(input, () => this.set(spec.key, Number(input.value)));
    this.sliders.push({ spec, input, value, row });
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

  private bumpRoom(d: number): void {
    const n = GOEDAM_ROOMS.length + 1;
    this.roomPick = ((this.roomPick + 1 + d + n) % n) - 1;
    this.roomLabel.textContent = GOEDAM_ROOMS[this.roomPick]?.name ?? '아무 방';
  }

  private bumpEvent(d: number): void {
    const n = FIELD_EVENTS.length + 1;
    this.eventPick = ((this.eventPick + 1 + d + n) % n) - 1;
    const ev = FIELD_EVENTS[this.eventPick];
    this.eventLabel.textContent = ev ? `${ev.icon} ${ev.name}` : '아무거나';
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

  private syncJuice(): void {
    for (const r of this.juiceRows) {
      const v = JUICE[r.key];
      if (typeof document === 'undefined' || document.activeElement !== r.input) r.input.value = String(v);
      r.value.textContent = r.fmt(v);
      r.row.classList.toggle('is-changed', v !== JUICE_DEFAULTS[r.key]);
    }
  }

  private syncExp(): void {
    const g = this.deps.game();
    this.expSec.classList.toggle('is-hidden', !g?.state.expedition);
    this.artBtn.textContent = `장비 그림: ${battleGearFiles() ? '파일' : '코드'}`;
    this.artBtn.classList.toggle('is-on', battleGearFiles());
  }

  /** Reflect game.tunables in the controls. */
  sync(): void {
    this.syncJuice();
    this.syncExp();
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
