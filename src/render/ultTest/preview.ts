// 기획 22차 궁극기 테스트: the ult button's live 조준 / 드래그 preview (RenderUiState.ultAim, my screen only). Drawn from
// the same pure plan the cast uses (src/sim/ultTest.ts planUlt → ultPreviewParts), so the picture is where it lands:
//  - every part's footprint in the character's colour (ally-only parts: the light ally tint, dashed), direction
//    arrows on rects / cones, dash paths as arrows;
//  - 조준: a dashed aim line from the character to the point + a crosshair; 드래그: the move arrow (blink = dashed,
//    dash = solid, with its hit band) and a ghost ring where it lands;
//  - a ring on the enemy the ult's 'target' parts would hit;
//  - cancel (finger back on the button): everything grey; not over the field: red.

import type { GameState, UltAimView } from '../../types';
import { ULT_TEST } from '../../data/ultTest';
import type { Camera } from '../camera';
import { ALLY_TINT, drawAreaDirection } from '../preview';
import { drawGroundArrow, groundEllipse, pathArea } from '../shapes';

const INVALID = '#ef4444';
const CANCEL = '#9aa3b2';
const DARK = '#05060a';

function tint(view: UltAimView): string {
  return view.cancel ? CANCEL : view.valid ? view.color : INVALID;
}

/** Ground layer: footprints, the aim line / move arrow, the target ring. */
export function drawUltAimGround(ctx: CanvasRenderingContext2D, cam: Camera, view: UltAimView, state: GameState, time: number): void {
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
