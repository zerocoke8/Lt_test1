// 기획 22차 궁극기 테스트 (docs/ult-test.md 3장): the ult button's 조준 / 드래그 gestures. Like a card drag (src/ui/drag.ts):
// Pointer Events with pointer capture on the ult button, the aimed point LIFT px above the finger (the finger never hides
// it), a dashed connector, the live preview drawn on the field (RenderUiState.ultAim, from the same pure plan the sim
// casts — src/sim/ultTest.ts planUlt). One command per gesture: { type: 'ult', aim: { mode, point } }.
//  - press and release without moving (a tap): today's ult (the app's useUlt, no aim).
//  - 조준: hold + drag → the area / direction follows the finger; release over the field → the 조준 ult there.
//  - 드래그: drag onto the field → release → the character goes there and casts its 드래그 ult.
//  - dragging back onto the ult button (or releasing off the field) cancels: nothing is cast, the gauge stays full.
// Only in 궁극기 테스트 with mode 조준 / 드래그 and a castable ult; otherwise the press is not taken and the button's
// click does what it always did (today's ult, or the "charging" toast).

import type { CommandResult, Game, Renderer, UltAim, UltAimView, Vec2 } from '../types';
import { getCharacter } from '../data';
import { canUltState } from '../sim/players';
import { clampUltPoint, planUlt, ultModeOf, ultPreviewParts } from '../sim/ultTest';
import { areaColor } from '../render/look';
import { sfx } from '../audio';
import { h } from './dom';
import { LIFT } from './drag';
import type { Hud } from './hud';
import type { Stage } from './stage';

/** Logical px of movement before a press becomes an aim (otherwise it is a tap). */
const AIM_THRESHOLD = 12;
/** How far outside the walkable arena (world units) a release still counts as "on the field" (it gets clamped). */
const ARENA_MARGIN_X = 0.6;
const ARENA_MARGIN_Y = 1.2;

export interface UltAimDeps {
  stage: Stage;
  game(): Game | null;
  renderer(): Renderer;
  hud(): Hud | null;
  localPlayer(): number;
  /** Cast: aim null = a tap (today's ult). The app dispatches, plays the sound and says why on a refusal. */
  cast(aim: UltAim | null): CommandResult;
}

interface Press {
  pointerId: number;
  el: HTMLElement;
  mode: 'aim' | 'drag';
  start: Vec2;
  finger: Vec2;
  client: Vec2;
  aiming: boolean;
}

export class UltAimController {
  private press: Press | null = null;
  private view: UltAimView | null = null;
  private readonly deps: UltAimDeps;
  private readonly line: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly tag: HTMLElement;

  constructor(deps: UltAimDeps) {
    this.deps = deps;
    const top = deps.stage.topLayer;
    this.line = h('div', 'drag-line ult-aim-line is-hidden', top);
    this.dot = h('div', 'drag-dot ult-aim-dot is-hidden', top);
    this.tag = h('div', 'ult-aim-tag is-hidden', top);
  }

  /** The finger is aiming (the preview is up). */
  get active(): boolean {
    return !!this.press?.aiming;
  }

  /** RenderUiState.ultAim: the live preview while aiming (null otherwise). */
  get preview(): UltAimView | null {
    return this.press?.aiming ? this.view : null;
  }

  /**
   * The ult button's pointerdown (wired by the HUD). True = this gesture is mine (the HUD then ignores the click that
   * follows); false = a plain button press (today's click).
   */
  begin(ev: PointerEvent, el: HTMLElement): boolean {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return false;
    if (this.press) return true;
    const g = this.deps.game();
    if (!g || g.state.phase !== 'combat') return false;
    const lp = this.deps.localPlayer();
    const mode = ultModeOf(g.state, lp);
    if (mode === 'now') return false;
    if (!canUltState(g.state, lp).ok) return false; // the click says why (charging, no field character …)
    ev.preventDefault();
    const finger = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    this.press = { pointerId: ev.pointerId, el, mode, start: finger, finger, client: { x: ev.clientX, y: ev.clientY }, aiming: false };
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onLost);
    return true;
  }

  /** Drop any press (phase change, pause, new run). Nothing is cast. */
  cancel(): void {
    if (this.press) this.end();
  }

  /** Per frame: the plan follows the field (units move, the gauge or the phase can change while holding still). */
  frame(): void {
    const p = this.press;
    if (!p) return;
    const g = this.deps.game();
    if (!g || g.state.phase !== 'combat' || ultModeOf(g.state, this.deps.localPlayer()) !== p.mode) {
      this.end();
      return;
    }
    if (p.aiming) this.refresh();
  }

  private onMove = (ev: PointerEvent): void => {
    const p = this.press;
    if (!p || ev.pointerId !== p.pointerId) return;
    p.finger = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    p.client = { x: ev.clientX, y: ev.clientY };
    if (!p.aiming && Math.hypot(p.finger.x - p.start.x, p.finger.y - p.start.y) >= AIM_THRESHOLD) {
      p.aiming = true;
      sfx.ui('ui.card.lift');
      for (const e of [this.line, this.dot, this.tag]) e.classList.remove('is-hidden');
    }
    if (p.aiming) this.refresh();
  };

  private onUp = (ev: PointerEvent): void => {
    const p = this.press;
    if (!p || ev.pointerId !== p.pointerId) return;
    p.finger = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    p.client = { x: ev.clientX, y: ev.clientY };
    if (!p.aiming) {
      // a tap: today's ult
      this.end();
      this.deps.cast(null);
      return;
    }
    this.refresh();
    const v = this.view;
    this.end();
    if (!v || v.cancel) {
      sfx.ui('ui.card.cancel');
      this.deps.hud()?.toast('궁극기 취소 · 게이지는 그대로예요');
      return;
    }
    if (!v.valid) {
      sfx.ui('ui.card.cancel');
      this.deps.hud()?.toast('취소됨 · 필드 위에서 놓아 주세요');
      return;
    }
    this.deps.cast({ mode: p.mode, point: { x: v.point.x, y: v.point.y } });
  };

  private onCancel = (ev: PointerEvent): void => {
    if (this.press && ev.pointerId === this.press.pointerId) this.end();
  };

  private onLost = (ev: PointerEvent): void => {
    // pointerup fires before lostpointercapture, so a live press here means the capture was stolen
    if (this.press && ev.pointerId === this.press.pointerId) this.end();
  };

  private end(): void {
    const p = this.press;
    if (!p) return;
    this.press = null;
    this.view = null;
    p.el.removeEventListener('pointermove', this.onMove);
    p.el.removeEventListener('pointerup', this.onUp);
    p.el.removeEventListener('pointercancel', this.onCancel);
    p.el.removeEventListener('lostpointercapture', this.onLost);
    try {
      if (p.el.hasPointerCapture(p.pointerId)) p.el.releasePointerCapture(p.pointerId);
    } catch {
      /* ignore */
    }
    for (const e of [this.line, this.dot, this.tag]) e.classList.add('is-hidden');
    p.el.classList.remove('is-aiming', 'is-cancel');
  }

  private refresh(): void {
    const p = this.press;
    const g = this.deps.game();
    if (!p || !g) return;
    const lp = this.deps.localPlayer();
    const s = g.state;
    const drop = { x: p.finger.x, y: p.finger.y - LIFT };
    const world = this.deps.renderer().screenToWorld(drop);
    const arena = s.plan.arena;
    const inArena = world.x >= -ARENA_MARGIN_X && world.x <= arena.width + ARENA_MARGIN_X && world.y >= -ARENA_MARGIN_Y && world.y <= arena.height + ARENA_MARGIN_Y;
    const canvas = this.deps.stage.canvas;
    const at = (x: number, y: number): Element | null => {
      try {
        return document.elementFromPoint(x, y);
      } catch {
        return null;
      }
    };
    const dropClient = this.deps.stage.toClient(drop);
    const overField = at(p.client.x, p.client.y) === canvas || at(dropClient.x, dropClient.y) === canvas;
    // back on the ult button: releasing cancels
    const r = p.el.getBoundingClientRect();
    const cancel = p.client.x >= r.left && p.client.x <= r.right && p.client.y >= r.top && p.client.y <= r.bottom;
    const point = clampUltPoint(s, world);
    const aim: UltAim = { mode: p.mode, point };
    const plan = planUlt(s, lp, aim);
    const ok = canUltState(s, lp).ok && !!plan;
    const me = s.players[lp];
    const defId = me?.activeIndex != null ? me.party[me.activeIndex]?.defId : undefined;
    const color = defId ? areaColor(defId, getCharacter(defId).color) : '#ffffff';
    const field = me?.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!]?.entityId) : undefined;
    this.view = {
      mode: p.mode,
      from: field ? { x: field.pos.x, y: field.pos.y } : point,
      point: plan ? plan.point : point,
      parts: plan ? ultPreviewParts(s, lp, plan) : [],
      move: plan?.move ? { kind: plan.move.kind, from: plan.move.from, to: plan.move.to, ...(plan.move.path ? { pathWidth: plan.move.path.width } : null) } : null,
      targetId: plan?.targetId ?? null,
      valid: ok && overField && inArena,
      cancel,
      color,
    };
    // DOM: a connector from the finger up to the aimed point, a word at the finger
    const vColor = cancel ? '#9aa3b2' : this.view.valid ? color : '#ef4444';
    this.line.style.transform = `translate(${p.finger.x.toFixed(1)}px, ${drop.y.toFixed(1)}px)`;
    this.dot.style.transform = `translate(${drop.x.toFixed(1)}px, ${drop.y.toFixed(1)}px)`;
    this.line.classList.toggle('is-invalid', !this.view.valid || cancel);
    this.dot.classList.toggle('is-invalid', !this.view.valid || cancel);
    this.tag.style.transform = `translate(${p.finger.x.toFixed(1)}px, ${(p.finger.y + 46).toFixed(1)}px)`;
    this.tag.style.setProperty('--vc', vColor);
    this.tag.textContent = cancel ? '놓으면 취소' : !this.view.valid ? '필드 위에서 놓기' : p.mode === 'aim' ? '놓으면 발사' : '놓으면 이동 · 발사';
    p.el.classList.add('is-aiming');
    p.el.classList.toggle('is-cancel', cancel);
  }
}
