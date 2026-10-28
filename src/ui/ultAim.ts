// 기획 22차 궁극기 테스트 (docs/ult-test.md 3장): the ult button's 조준 / 드래그 gestures. Like a card drag (src/ui/drag.ts):
// Pointer Events with pointer capture on the ult button, the aimed point LIFT px above the finger (the finger never hides
// it), a dashed connector, the live preview drawn on the field (RenderUiState.ultAim, from the same pure plan the sim
// casts — src/sim/ultTest.ts planUlt). One command per gesture: { type: 'ult', aim: { mode, point, from } } — the very
// inputs of the preview (from = where my screen shows the field character, so a room aims the way my preview did).
//  - press and release without leaving the button (a tap, a thumb wobble included): today's ult (useUlt, no aim).
//  - 조준: hold + drag → the area / direction follows the finger; release over the field → the 조준 ult there.
//  - 드래그: drag onto the field → release → the character goes there and casts its 드래그 ult.
//  - dragging back onto the ult button after leaving it (or releasing off the field) cancels: nothing is cast, the
//    gauge stays full. Losing the ult mid-aim (the character falls, the gauge was spent) cancels with the reason.
// Only in 궁극기 테스트 with mode 조준 / 드래그 and a castable ult; otherwise the press is not taken and the button's
// click does what it always did (today's ult, or the "charging" toast).

import { LOGICAL_W, type CommandResult, type Game, type Renderer, type UltAim, type UltAimView, type Vec2 } from '../types';
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
/**
 * CSS px of slack around the ult button's box taken at the press. Its live box shrinks while aiming (scale 0.92, and
 * :active 0.95), so a thumb pressed near the edge that rolls a little would leave it — that is still a tap, not an aim.
 */
const BUTTON_SLACK = 6;

/** A box in client (CSS) px. */
export interface ClientBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The ult button's box for a whole press: its rect at the press, BUTTON_SLACK px larger each side (exported for tests). */
export function pressBox(r: ClientBox): ClientBox {
  return { left: r.left - BUTTON_SLACK, right: r.right + BUTTON_SLACK, top: r.top - BUTTON_SLACK, bottom: r.bottom + BUTTON_SLACK };
}

/** Client point inside a box (exported for tests). */
export function inBox(b: ClientBox, x: number, y: number): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

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
  /** The finger has been off the ult button (only then does coming back onto it cancel). */
  left: boolean;
  /** The button's box at the press (pressBox): its live rect shrinks while aiming, this one does not. */
  box: ClientBox;
}

/** Why an aimed release cannot cast now (canUltState's reason in plain words, like the app's useUlt toast). */
function blockedText(reason: string | undefined): string {
  if (reason === '게이지 부족') return '궁극기 충전 중이에요';
  if (reason === '필드에 캐릭터 없음') return '필드에 캐릭터가 없어요';
  if (reason === '관전 중') return '사망 — 관전 중이에요';
  return '지금은 쓸 수 없어요';
}

export class UltAimController {
  private press: Press | null = null;
  private view: UltAimView | null = null;
  /** The command the release would send (the preview's own inputs; null = no plan). */
  private aim: UltAim | null = null;
  /** The plain-words reason while the ult cannot be cast any more (null = castable). */
  private blocked: string | null = null;
  /** The tag's measured width for its current text (it is kept inside the stage). */
  private tagW = { text: '', w: 0 };
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
    const box = pressBox(el.getBoundingClientRect());
    this.press = { pointerId: ev.pointerId, el, mode, start: finger, finger, client: { x: ev.clientX, y: ev.clientY }, aiming: false, left: false, box };
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
    const aim = this.aim;
    const blocked = this.blocked;
    this.end();
    if (!p.left) {
      // the finger never left the button (a wobbly tap): today's ult, like a tap
      this.deps.cast(null);
      return;
    }
    if (!v || v.cancel) {
      sfx.ui('ui.card.cancel');
      this.deps.hud()?.toast('궁극기 취소 · 게이지는 그대로예요');
      return;
    }
    if (blocked) {
      sfx.ui('ui.card.cancel');
      this.deps.hud()?.toast(`취소됨 · ${blocked}`, 'warn');
      return;
    }
    if (!v.valid || !aim) {
      sfx.ui('ui.card.cancel');
      this.deps.hud()?.toast('취소됨 · 필드 위에서 놓아 주세요');
      return;
    }
    this.deps.cast(aim);
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
    this.aim = null;
    this.blocked = null;
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
    // back on the ult button after leaving it: releasing cancels (still on it and never left: a tap). The box is the
    // one taken at the press (the live one shrinks while aiming: a thumb on the edge would "leave" without moving)
    const onButton = inBox(p.box, p.client.x, p.client.y);
    if (!onButton) p.left = true;
    const cancel = onButton && p.left;
    const tap = onButton && !p.left;
    const point = clampUltPoint(s, world);
    const me = s.players[lp];
    const field = me?.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!]?.entityId) : undefined;
    // the command carries the preview's own inputs: the point and where this screen shows the field character
    const aim: UltAim = { mode: p.mode, point, ...(field ? { from: { x: field.pos.x, y: field.pos.y } } : null) };
    const plan = planUlt(s, lp, aim);
    const can = canUltState(s, lp);
    this.blocked = !can.ok ? blockedText(can.reason) : !plan ? blockedText(undefined) : null;
    this.aim = plan ? aim : null;
    const ok = !this.blocked;
    const defId = me?.activeIndex != null ? me.party[me.activeIndex]?.defId : undefined;
    const color = defId ? areaColor(defId, getCharacter(defId).color) : '#ffffff';
    this.view = {
      mode: p.mode,
      from: field ? { x: field.pos.x, y: field.pos.y } : point,
      point: plan ? plan.point : point,
      parts: plan ? ultPreviewParts(s, lp, plan) : [],
      move: plan?.move ? { kind: plan.move.kind, from: plan.move.from, to: plan.move.to, ...(plan.move.path ? { pathWidth: plan.move.path.width } : null) } : null,
      targetId: plan?.targetId ?? null,
      valid: ok && overField && inArena,
      // grey while releasing would not cast this (back on the button: cancel; never left it: a tap = today's ult)
      cancel: cancel || tap,
      color,
    };
    // DOM: the dot on the aimed point — moved onto the spot the ult really goes when the plan pulled it in (조준
    // aimRange, the 드래그 reach, a boss body), the connector then joining it to the finger — and a word at the finger
    const vColor = cancel || tap ? '#9aa3b2' : this.view.valid ? color : '#ef4444';
    const shown = plan ? this.deps.renderer().worldToScreen(this.view.point) : drop;
    const pulled = Math.hypot(shown.x - drop.x, shown.y - drop.y) > 8;
    const dot = pulled ? shown : drop;
    const lx = p.finger.x - dot.x;
    const ly = p.finger.y - dot.y;
    const turn = pulled ? (Math.atan2(ly, lx) * 180) / Math.PI - 90 : 0;
    this.line.style.height = `${(pulled ? Math.hypot(lx, ly) : 36).toFixed(1)}px`;
    this.line.style.transformOrigin = '50% 0';
    this.line.style.transform = `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px) rotate(${turn.toFixed(1)}deg)`;
    this.dot.style.transform = `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px)`;
    this.line.classList.toggle('is-invalid', !this.view.valid || cancel);
    this.dot.classList.toggle('is-invalid', !this.view.valid || cancel);
    const text = tap
      ? '놓으면 지금 궁극기'
      : cancel
        ? '놓으면 취소'
        : this.blocked
          ? this.blocked
          : !this.view.valid
            ? '필드 위에서 놓기'
            : p.mode === 'aim'
              ? '놓으면 발사'
              : '놓으면 이동 · 발사';
    if (this.tag.textContent !== text) this.tag.textContent = text;
    if (this.tagW.text !== text) this.tagW = { text, w: this.tag.offsetWidth || 200 };
    // centred on the finger (translate -50%) but kept inside the 1280-px stage
    const half = this.tagW.w / 2 + 8;
    const tx = Math.min(LOGICAL_W - half, Math.max(half, p.finger.x));
    this.tag.style.transform = `translate(${tx.toFixed(1)}px, ${(p.finger.y + 46).toFixed(1)}px)`;
    this.tag.style.setProperty('--vc', vColor);
    p.el.classList.add('is-aiming');
    p.el.classList.toggle('is-cancel', cancel);
  }
}
