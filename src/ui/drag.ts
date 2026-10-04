// Card drag & drop (기획서 4장, 5장): touch-first Pointer Events with pointer capture.
// The world drop point sits LIFT px above the finger so the finger never hides it; a connector links them.
// Release over the field → swap/pet at game.clampToArena(world). Release with neither the finger nor the drop point on
// the bare field (finger and drop point over HUD/cards/letterbox, or the drop point off the arena) → cancel (no cooldown).
// Near the bottom edge the finger rests on the card row while the drop point is still on the floor: that counts.

import type { CommandResult, DragPreview, Game, Renderer, Vec2 } from '../types';
import { getCharacter, getPet } from '../data';
import { h } from './dom';
import { ROLE_GLYPH } from './format';
import { petGlyph } from './preset';
import type { Hud } from './hud';
import type { Stage } from './stage';

/** Logical px between finger and drop point. */
export const LIFT = 80;
/** Logical px of movement before a press becomes a drag (otherwise it's a tap). */
const DRAG_THRESHOLD = 10;
/** How far outside the walkable arena (world units) a drop still counts as "on the field" (it gets clamped). */
const ARENA_MARGIN_X = 0.6;
const ARENA_MARGIN_Y = 1.2;

export type DragKind = 'swap' | 'pet';

interface Press {
  pointerId: number;
  kind: DragKind;
  index: number;
  el: HTMLElement;
  start: Vec2;
  finger: Vec2;
  client: Vec2;
  dragging: boolean;
}

export interface DragDeps {
  stage: Stage;
  game(): Game | null;
  renderer(): Renderer;
  hud(): Hud | null;
  /** The run's local player index (solo 0, multiplayer = server slot). */
  localPlayer(): number;
}

export class DragController {
  private press: Press | null = null;
  private readonly deps: DragDeps;
  private readonly ghost: HTMLElement;
  private readonly ghostIcon: HTMLElement;
  private readonly ghostGlyph: HTMLElement;
  private readonly ghostName: HTMLElement;
  private readonly line: HTMLElement;
  private readonly dot: HTMLElement;
  private preview: DragPreview | null = null;

  constructor(deps: DragDeps) {
    this.deps = deps;
    const top = deps.stage.topLayer;
    this.line = h('div', 'drag-line is-hidden', top);
    this.dot = h('div', 'drag-dot is-hidden', top);
    this.ghost = h('div', 'drag-ghost is-hidden', top);
    this.ghostIcon = h('div', 'drag-ghost-icon', this.ghost);
    this.ghostGlyph = h('span', '', this.ghostIcon);
    this.ghostName = h('div', 'drag-ghost-name', this.ghost);
  }

  get active(): boolean {
    return !!this.press?.dragging;
  }

  private get lp(): number {
    return this.deps.localPlayer();
  }

  /** Current preview for RenderUiState (null when not dragging). */
  get dragPreview(): DragPreview | null {
    return this.press?.dragging ? this.preview : null;
  }

  private can(kind: DragKind, index: number): CommandResult {
    const g = this.deps.game();
    if (!g) return { ok: false, reason: '전투 중이 아님' };
    return kind === 'swap' ? g.canSwap(this.lp, index) : g.canUsePet(this.lp, index);
  }

  /** Card pointerdown (wired by the HUD). */
  begin(kind: DragKind, index: number, ev: PointerEvent, el: HTMLElement): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (this.press) return; // one drag at a time
    ev.preventDefault();
    const r = this.can(kind, index);
    if (!r.ok) {
      this.refuseLater(kind, index, ev, el);
      return;
    }
    const finger = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    this.press = { pointerId: ev.pointerId, kind, index, el, start: finger, finger, client: { x: ev.clientX, y: ev.clientY }, dragging: false };
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onLost);
  }

  /**
   * A card that can't be used right now: say why only once the finger tries to drag it, or on a plain tap. A long
   * press (the skill sheet) on a cooling card is not a failed drag, so it gets no toast and no shake.
   */
  private refuseLater(kind: DragKind, index: number, ev: PointerEvent, el: HTMLElement): void {
    const id = ev.pointerId;
    const start = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    try {
      el.setPointerCapture(id);
    } catch {
      /* synthetic events may not be capturable */
    }
    const done = (refuse: boolean) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('lostpointercapture', cancel);
      try {
        if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      } catch {
        /* ignore */
      }
      if (!refuse) return;
      // the reason as of now (the cooldown may have run out meanwhile: then there is nothing to refuse)
      const r = this.can(kind, index);
      if (!r.ok) this.deps.hud()?.refuse(kind, index, r);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const f = this.deps.stage.toLogical(e.clientX, e.clientY);
      if (Math.hypot(f.x - start.x, f.y - start.y) >= DRAG_THRESHOLD) done(true);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      done(!this.deps.hud()?.takeLongPress());
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === id) done(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
  }

  private onMove = (ev: PointerEvent): void => {
    const p = this.press;
    if (!p || ev.pointerId !== p.pointerId) return;
    p.finger = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    p.client = { x: ev.clientX, y: ev.clientY };
    if (!p.dragging && Math.hypot(p.finger.x - p.start.x, p.finger.y - p.start.y) >= DRAG_THRESHOLD) this.startDrag(p);
    if (p.dragging) this.refresh();
  };

  private onUp = (ev: PointerEvent): void => {
    const p = this.press;
    if (!p || ev.pointerId !== p.pointerId) return;
    p.finger = this.deps.stage.toLogical(ev.clientX, ev.clientY);
    p.client = { x: ev.clientX, y: ev.clientY };
    if (!p.dragging) {
      this.end();
      // a long press opened the skill sheet: that was the point of the press, no "drag it" tip
      if (this.deps.hud()?.takeLongPress()) return;
      this.deps.hud()?.toast(p.kind === 'swap' ? '카드를 필드로 드래그하세요 · 길게 누르면 스킬 정보' : '펫 카드를 필드로 드래그하세요');
      return;
    }
    this.refresh();
    const pv = this.preview;
    const g = this.deps.game();
    this.end();
    if (!g || !pv) return;
    if (!pv.valid) {
      const r = this.can(p.kind, p.index);
      if (!r.ok) this.deps.hud()?.refuse(p.kind, p.index, r);
      else this.deps.hud()?.toast('취소됨 · 필드 위에서 놓아 주세요');
      return;
    }
    const res =
      p.kind === 'swap'
        ? g.dispatch({ type: 'swap', player: this.lp, partyIndex: p.index, pos: pv.pos })
        : g.dispatch({ type: 'pet', player: this.lp, petIndex: p.index, pos: pv.pos });
    if (!res.ok) this.deps.hud()?.refuse(p.kind, p.index, res);
    else
      try {
        navigator.vibrate?.(12);
      } catch {
        /* no haptics */
      }
  };

  private onCancel = (ev: PointerEvent): void => {
    if (this.press && ev.pointerId === this.press.pointerId) this.end();
  };

  private onLost = (ev: PointerEvent): void => {
    // pointerup fires before lostpointercapture, so a live press here means the capture was stolen.
    if (this.press && ev.pointerId === this.press.pointerId) this.end();
  };

  private startDrag(p: Press): void {
    p.dragging = true;
    const me = this.deps.game()?.state.players[this.lp];
    if (p.kind === 'swap') {
      const def = getCharacter(me?.party[p.index]?.defId ?? '');
      this.ghost.style.setProperty('--c', def.color);
      this.ghostGlyph.textContent = ROLE_GLYPH[def.role];
      this.ghostName.textContent = def.name;
      this.ghost.classList.remove('is-pet');
    } else {
      const def = getPet(me?.pets[p.index]?.defId ?? '');
      this.ghost.style.setProperty('--c', def.color);
      this.ghostGlyph.textContent = petGlyph(def);
      this.ghostName.textContent = def.name;
      this.ghost.classList.add('is-pet');
    }
    for (const el of [this.ghost, this.line, this.dot]) el.classList.remove('is-hidden');
    this.deps.hud()?.setDragging(p.kind, p.index);
  }

  /** Cancel any press/drag (phase change, pause, new run). */
  cancel(): void {
    if (this.press) this.end();
  }

  private end(): void {
    const p = this.press;
    if (!p) return;
    this.press = null;
    this.preview = null;
    p.el.removeEventListener('pointermove', this.onMove);
    p.el.removeEventListener('pointerup', this.onUp);
    p.el.removeEventListener('pointercancel', this.onCancel);
    p.el.removeEventListener('lostpointercapture', this.onLost);
    try {
      if (p.el.hasPointerCapture(p.pointerId)) p.el.releasePointerCapture(p.pointerId);
    } catch {
      /* ignore */
    }
    for (const el of [this.ghost, this.line, this.dot]) el.classList.add('is-hidden');
    this.deps.hud()?.setDragging(null, -1);
  }

  /** Per-frame: validity can change while holding still (cooldown ends, phase changes). */
  frame(): void {
    const p = this.press;
    if (!p) return;
    const g = this.deps.game();
    if (!g || g.state.phase !== 'combat') {
      this.end();
      return;
    }
    if (p.dragging) this.refresh();
  }

  private refresh(): void {
    const p = this.press;
    const g = this.deps.game();
    if (!p || !g) return;
    const drop = { x: p.finger.x, y: p.finger.y - LIFT };
    const world = this.deps.renderer().screenToWorld(drop);
    const arena = g.state.plan.arena;
    const inArena =
      world.x >= -ARENA_MARGIN_X && world.x <= arena.width + ARENA_MARGIN_X && world.y >= -ARENA_MARGIN_Y && world.y <= arena.height + ARENA_MARGIN_Y;
    // the finger or the drop point must be over the bare canvas (not a HUD block, panel, overlay or the letterbox).
    // The drop point alone is enough: aiming at the bottom rows of the floor puts the finger on the card/pet row.
    const canvas = this.deps.stage.canvas;
    const onCanvas = (x: number, y: number): boolean => {
      try {
        return document.elementFromPoint(x, y) === canvas;
      } catch {
        return false;
      }
    };
    const dropClient = this.deps.stage.toClient(drop);
    const overField = onCanvas(p.client.x, p.client.y) || onCanvas(dropClient.x, dropClient.y);
    const ok = this.can(p.kind, p.index).ok;
    const valid = ok && overField && inArena;
    const me = g.state.players[this.lp];
    const color = p.kind === 'swap' ? getCharacter(me.party[p.index].defId).color : getPet(me.pets[p.index].defId).color;
    const parts = g.previewParts(this.lp, p.kind, p.index);
    this.preview = { kind: p.kind, pos: g.clampToArena(world), area: parts[0]?.area ?? g.previewArea(this.lp, p.kind, p.index), parts, valid, color };

    // DOM: ghost under the finger, connector up to the drop point
    this.ghost.style.transform = `translate(${p.finger.x.toFixed(1)}px, ${p.finger.y.toFixed(1)}px)`;
    this.ghost.classList.toggle('is-invalid', !valid);
    this.line.style.transform = `translate(${p.finger.x.toFixed(1)}px, ${drop.y.toFixed(1)}px)`;
    this.line.classList.toggle('is-invalid', !valid);
    this.dot.style.transform = `translate(${drop.x.toFixed(1)}px, ${drop.y.toFixed(1)}px)`;
    this.dot.classList.toggle('is-invalid', !valid);
    this.ghost.style.setProperty('--vc', valid ? color : '#ef4444');
  }
}
