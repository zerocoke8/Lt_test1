// 기획 22차 궁극기 테스트: the ult button's live 조준 / 드래그 preview (RenderUiState.ultAim, my screen only). Drawn from
// the same pure plan the cast uses (src/sim/ultTest.ts planUlt → ultPreviewParts), so the picture is where it lands:
//  - every part's footprint in the character's colour (ally-only parts: the light ally tint, dashed), direction
//    arrows on rects / cones, dash paths as arrows;
//  - 조준: a dashed aim line from the character to the point + a crosshair; 드래그: the move arrow (blink = dashed,
//    dash = solid, with its hit band) and a ghost ring where it lands;
//  - a ring on the enemy the ult's 'target' parts would hit;
//  - cancel (finger back on the button): everything grey; not over the field: red.
//  - 기획 23차 (「궁극기 연출 강화」, docs/ult-fx.md 2-4): the part the finisher lands on gets a second rim inside its own
//    and a blinking dot at its middle — where the big blow falls (strokes only, never past the real footprint).

import type { GameState, UltAimView, Vec2 } from '../../types';
import { ULT_TEST, ultAlt, ultBeats } from '../../data/ultTest';
import { areaCentroid } from '../../sim/geometry';
import type { Camera } from '../camera';
import { ALLY_TINT, drawAreaDirection } from '../preview';
import { TAU, drawGroundArrow, groundEllipse, pathArea } from '../shapes';
import { insetArea } from './decals';
import { ULT_FX } from './settings';

const INVALID = '#ef4444';
const CANCEL = '#9aa3b2';
const DARK = '#05060a';

function tint(view: UltAimView): string {
  return view.cancel ? CANCEL : view.valid ? view.color : INVALID;
}

/** Ground layer: footprints, the aim line / move arrow, the target ring. lp = whose preview (the finisher's rim). */
export function drawUltAimGround(ctx: CanvasRenderingContext2D, cam: Camera, view: UltAimView, state: GameState, time: number, lp = -1): void {
  const color = tint(view);
  const live = view.valid && !view.cancel;
  const hasEnemy = view.parts.some(p => p.affects === 'enemies');
  // 1) ally-only parts under the damage ones
  for (const p of view.parts) {
    if (p.affects !== 'allies' || isWhole(p.area)) continue;
    const c = live && hasEnemy ? ALLY_TINT : color;
    pathArea(ctx, cam, p.center, p.origin, p.area, 1);
    ctx.globalAlpha = live ? 0.14 : 0.1;
    ctx.fillStyle = c;
    ctx.fill();
    ctx.setLineDash([10, 7]);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 5;
    ctx.strokeStyle = DARK;
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 2) enemy parts (later beats a little fainter)
  const maxDelay = view.parts.reduce((m, p) => Math.max(m, p.delay), 0);
  for (const p of view.parts) {
    if (p.affects !== 'enemies' || isWhole(p.area)) continue;
    const late = maxDelay > 0 ? (p.delay / maxDelay) * 0.35 : 0;
    pathArea(ctx, cam, p.center, p.origin, p.area, 1);
    ctx.globalAlpha = (live ? 0.28 : 0.18) * (1 - late);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 6;
    ctx.strokeStyle = DARK;
    ctx.stroke();
    ctx.globalAlpha = 1 - late;
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (live) {
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([8, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawAreaDirection(ctx, cam, p.center, p.area, '#ffffff', live ? 0.9 : 0.6, live ? time : 0, false);
  }
  // 2b) 기획 23차: the finisher's part — a second rim and a blinking dot
  if (live && ULT_FX.boost) {
    const fp = view.parts[finisherPart(view, state, lp)];
    if (fp && !isWhole(fp.area)) drawFinisherMark(ctx, cam, fp, time);
  }
  // 3) dash paths of the parts
  for (const p of view.parts) if (p.dash) drawGroundArrow(ctx, cam, p.dash.from.x, p.dash.from.y, p.dash.to.x, p.dash.to.y, '#ffffff', 5, 22, 1, live ? 1 : 0.6);
  // 4) 조준: the aim line; 드래그: the move
  if (view.move) {
    const m = view.move;
    if (m.pathWidth) {
      // the hit band along the way
      const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      if (len > 0.05) {
        pathArea(ctx, cam, m.to, m.from, { shape: 'line', length: len, width: m.pathWidth }, 1);
        ctx.globalAlpha = live ? 0.25 : 0.15;
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
    if (m.kind === 'blink') ctx.setLineDash([12, 9]);
    drawGroundArrow(ctx, cam, m.from.x, m.from.y, m.to.x, m.to.y, color, 6, 26, 1, live ? 1 : 0.7);
    ctx.setLineDash([]);
    // where it lands: a ghost ring
    ctx.beginPath();
    groundEllipse(ctx, cam, m.to.x, m.to.y, 0.6);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const a = view.from;
    const b = view.point;
    ctx.beginPath();
    ctx.moveTo(cam.sx(a.x), cam.sy(a.y));
    ctx.lineTo(cam.sx(b.x), cam.sy(b.y));
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 6;
    ctx.strokeStyle = DARK;
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -((time * 40) % 21);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  // 5) the enemy a 'target' part would hit
  if (view.targetId != null) {
    const t = state.entities.find(e => e.id === view.targetId);
    if (t) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 10);
      ctx.beginPath();
      groundEllipse(ctx, cam, t.pos.x, t.pos.y, t.radius + 0.5);
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 8;
      ctx.strokeStyle = DARK;
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Above the units: the crosshair at the aimed point (so a body never hides where it goes). */
export function drawUltAimOverlay(ctx: CanvasRenderingContext2D, cam: Camera, view: UltAimView): void {
  const color = tint(view);
  const x = cam.sx(view.point.x);
  const y = cam.sy(view.point.y);
  const r = 16;
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r - 8, y);
  ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y);
  ctx.lineTo(x + r + 8, y);
  ctx.moveTo(x, y - r - 8);
  ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x, y + r + 8);
  ctx.lineWidth = 7;
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function isWhole(a: UltAimView['parts'][number]['area']): boolean {
  return a.shape === 'circle' && a.radius >= ULT_TEST.wholeField;
}

/**
 * 기획 23차: which preview part the finisher is (index into view.parts), −1 = none (a fallback, nobody on the field).
 * The parts follow the alt's actions in order without the 'woundedAlly' and self-only ones (src/sim/ultTest.ts
 * ultPreviewParts), so the finisher's action index maps onto them.
 */
export function finisherPart(view: UltAimView, state: GameState, lp: number): number {
  const p = state.players[lp];
  const defId = p && p.activeIndex != null ? p.party[p.activeIndex]?.defId : undefined;
  const alt = defId ? ultAlt(defId, view.mode) : null;
  const b = alt ? ultBeats(alt.id) : null;
  if (!alt || !b || b.finisher < 0) return -1;
  let k = 0;
  for (let i = 0; i < alt.actions.length; i++) {
    const a = alt.actions[i];
    if (a.center === 'woundedAlly' || a.affects === 'self') {
      if (i === b.finisher) return -1;
      continue;
    }
    if (i === b.finisher) return k < view.parts.length ? k : -1;
    k++;
  }
  return -1;
}

/** The middle of a part (a line / fan: half way along from where it starts; a rect / cone: its centroid). */
function partMiddle(p: UltAimView['parts'][number], out: Vec2): Vec2 {
  const a = p.area;
  if ((a.shape === 'line' || a.shape === 'fan') && p.origin) {
    const dx = p.center.x - p.origin.x;
    const dy = p.center.y - p.origin.y;
    const d = Math.hypot(dx, dy);
    const half = (a.shape === 'line' ? a.length : a.radius) / 2;
    if (d > 1e-4) {
      out.x = p.origin.x + (dx / d) * half;
      out.y = p.origin.y + (dy / d) * half;
      return out;
    }
  }
  const c = a.shape === 'rect' || a.shape === 'cone' ? areaCentroid(a, p.center) : p.center;
  out.x = c.x;
  out.y = c.y;
  return out;
}
const MID: Vec2 = { x: 0, y: 0 };

/** The finisher's part: its own rim again in white, a second rim just inside it, a blinking dot at its middle. */
function drawFinisherMark(ctx: CanvasRenderingContext2D, cam: Camera, p: UltAimView['parts'][number], time: number): void {
  const blink = 0.5 + 0.5 * Math.sin(time * 9);
  for (const k of [1, 0.84]) {
    pathArea(ctx, cam, p.center, p.origin, k === 1 ? p.area : insetArea(p.area, k), 1);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 6;
    ctx.strokeStyle = DARK;
    ctx.stroke();
    ctx.globalAlpha = k === 1 ? 0.95 : 0.6 + 0.35 * blink;
    ctx.lineWidth = k === 1 ? 3 : 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  partMiddle(p, MID);
  const x = cam.sx(MID.x);
  const y = cam.sy(MID.y);
  // the dot, and a small ring leaving it now and then
  const ring = (time * 1.4) % 1;
  ctx.beginPath();
  ctx.arc(x, y, 7 + 12 * ring, 0, TAU);
  ctx.globalAlpha = 0.8 * (1 - ring);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5 + 2.5 * blink, 0, TAU);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 4;
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.globalAlpha = 0.55 + 0.45 * blink;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = 1;
}
