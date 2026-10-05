// Low-level path helpers shared by the ground layer (areas) and units (bodies).
// Area geometry (rect frames, cross axes, directions) comes from the pure sim/geometry module so the drawn footprint
// and the hit test can never disagree.

import type { AreaShape, Vec2 } from '../types';
import { DIR_VEC, areaExtent, crossAxes, rectFrame } from '../sim/geometry';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from './camera';

export const TAU = Math.PI * 2;
export const SINGLE_AREA_RADIUS = 0.6;

/** Ground ellipse for a world radius at a world point. Adds to the current path. */
export function groundEllipse(ctx: CanvasRenderingContext2D, cam: Camera, wx: number, wy: number, r: number): void {
  const rx = Math.max(0.5, r * PX_PER_UNIT);
  const ry = Math.max(0.5, r * PX_PER_UNIT_Y);
  ctx.moveTo(cam.sx(wx) + rx, cam.sy(wy));
  ctx.ellipse(cam.sx(wx), cam.sy(wy), rx, ry, 0, 0, TAU);
}

/** Adds the projected world polygon (x0, y0, x1, y1, …) to the current path and closes it. */
function polyWorld(ctx: CanvasRenderingContext2D, cam: Camera, pts: number[]): void {
  ctx.moveTo(cam.sx(pts[0]), cam.sy(pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cam.sx(pts[i]), cam.sy(pts[i + 1]));
  ctx.closePath();
}

const PTS: number[] = [];
const CONE_STEPS = 18;

/** World-space oriented rectangle (start sx,sy · dir ux,uy · length · half-width) added to the path. */
export function addRectPath(ctx: CanvasRenderingContext2D, cam: Camera, sx: number, sy: number, ux: number, uy: number, len: number, hw: number): void {
  const px = -uy * hw;
  const py = ux * hw;
  const ex = sx + ux * len;
  const ey = sy + uy * len;
  PTS.length = 0;
  PTS.push(sx + px, sy + py, ex + px, ey + py, ex - px, ey - py, sx - px, sy - py);
  polyWorld(ctx, cam, PTS);
}

/**
 * Builds the path of an AreaShape on the ground (begins a new path). Everything is laid out in WORLD units and
 * projected point by point, so the drawn footprint is exactly the hit-test footprint (squashed by the quarter view).
 * `progress` (0..1) grows the area: circles/cones/crosses from the center, rects from their start (or both ends when
 * centered), rings outward from the inner edge, lines from the origin.
 * Line direction = origin → center (falls back to +x when they coincide).
 */
export function pathArea(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  center: Vec2,
  origin: Vec2 | null,
  area: AreaShape,
  progress = 1,
): void {
  ctx.beginPath();
  addAreaPath(ctx, cam, center, origin, area, progress);
}

/** Like pathArea but adds to the current path (several parts in one fill). */
export function addAreaPath(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  center: Vec2,
  origin: Vec2 | null,
  area: AreaShape,
  progress = 1,
): void {
  const k = Math.max(0, Math.min(1, progress));
  switch (area.shape) {
    case 'circle':
      groundEllipse(ctx, cam, center.x, center.y, area.radius * k);
      return;
    case 'single':
      groundEllipse(ctx, cam, center.x, center.y, SINGLE_AREA_RADIUS * k);
      return;
    case 'line': {
      const ox = origin ? origin.x : center.x - area.length / 2;
      const oy = origin ? origin.y : center.y;
      let dx = center.x - ox;
      let dy = center.y - oy;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) {
        dx = 1;
        dy = 0;
      } else {
        dx /= len;
        dy /= len;
      }
      addRectPath(ctx, cam, ox, oy, dx, dy, area.length * k, area.width / 2);
      return;
    }
    case 'rect': {
      const f = rectFrame(area, center);
      const L = f.len * k;
      const back = area.anchor === 'center' ? (f.len - L) / 2 : 0;
      addRectPath(ctx, cam, f.sx + f.ux * back, f.sy + f.uy * back, f.ux, f.uy, Math.max(0.01, L), f.hw);
      return;
    }
    case 'cone': {
      const u = DIR_VEC[area.dir];
      const a0 = Math.atan2(u.y, u.x);
      const h = (area.angle * Math.PI) / 360;
      const R = Math.max(0.01, area.radius * k);
      PTS.length = 0;
      PTS.push(center.x, center.y);
      for (let i = 0; i <= CONE_STEPS; i++) {
        const a = a0 - h + (2 * h * i) / CONE_STEPS;
        PTS.push(center.x + Math.cos(a) * R, center.y + Math.sin(a) * R);
      }
      polyWorld(ctx, cam, PTS);
      return;
    }
    case 'ring': {
      const inner = Math.max(0.01, area.inner);
      const outer = Math.max(inner + 0.01, area.inner + (area.outer - area.inner) * k);
      const sx = cam.sx(center.x);
      const sy = cam.sy(center.y);
      ctx.moveTo(sx + outer * PX_PER_UNIT, sy);
      ctx.ellipse(sx, sy, outer * PX_PER_UNIT, outer * PX_PER_UNIT_Y, 0, 0, TAU, false);
      ctx.moveTo(sx + inner * PX_PER_UNIT, sy);
      ctx.ellipse(sx, sy, inner * PX_PER_UNIT, inner * PX_PER_UNIT_Y, 0, TAU, 0, true);
      return;
    }
    case 'fan': {
      // 기획 8차 (monsters): apex at the caster (origin), opening toward center
      const f = fanFrame(center, origin, FAN_TMP);
      const h = (area.angle * Math.PI) / 360;
      const R = Math.max(0.01, area.radius * k);
      PTS.length = 0;
      PTS.push(f.x, f.y);
      for (let i = 0; i <= CONE_STEPS; i++) {
        const a = f.a - h + (2 * h * i) / CONE_STEPS;
        PTS.push(f.x + Math.cos(a) * R, f.y + Math.sin(a) * R);
      }
      polyWorld(ctx, cam, PTS);
      return;
    }
    case 'cross': {
      const hw = area.width / 2;
      const L = Math.max(hw + 0.01, area.length * k);
      const [u1, u2] = crossAxes(area.diagonal);
      // 12-point outline of the union of the two bars (local a along u1, b along u2)
      const loc = [L, hw, hw, hw, hw, L, -hw, L, -hw, hw, -L, hw, -L, -hw, -hw, -hw, -hw, -L, hw, -L, hw, -hw, L, -hw];
      PTS.length = 0;
      for (let i = 0; i < loc.length; i += 2) {
        const a = loc[i];
        const b = loc[i + 1];
        PTS.push(center.x + u1.x * a + u2.x * b, center.y + u1.y * a + u2.y * b);
      }
      polyWorld(ctx, cam, PTS);
      return;
    }
  }
}

/** Rough world radius of an area (for bursts/particles). */
export function areaRadius(area: AreaShape): number {
  if (area.shape === 'circle') return area.radius;
  if (area.shape === 'single') return SINGLE_AREA_RADIUS;
  if (area.shape === 'line') return Math.max(area.width, 1);
  if (area.shape === 'fan') return area.radius;
  return areaExtent(area);
}

/** Reach of an area from its center for culling (areaExtent, plus the 기획 8차 fan). */
export function areaReach(area: AreaShape): number {
  if (area.shape === 'fan') return area.radius;
  const r = areaExtent(area);
  return Number.isFinite(r) ? r : 4;
}

/**
 * Apex + world angle of a 'fan' (기획 8차, auto-aimed monster cone): it opens from the caster (origin) toward center.
 * Without an origin (zones) or when both coincide it sits on center facing +x.
 */
export function fanFrame(center: Vec2, origin: Vec2 | null, out: { x: number; y: number; a: number }): { x: number; y: number; a: number } {
  const ox = origin ? origin.x : center.x;
  const oy = origin ? origin.y : center.y;
  const dx = center.x - ox;
  const dy = center.y - oy;
  out.x = ox;
  out.y = oy;
  out.a = Math.hypot(dx, dy) < 1e-4 ? 0 : Math.atan2(dy, dx);
  return out;
}
const FAN_TMP = { x: 0, y: 0, a: 0 };

/**
 * Direction arrow on the ground from world a to world b (shaft + head), drawn with a dark outline so it reads on any
 * floor. `heads`: 1 = at b, 2 = both ends (centered bands ↔ / ↕).
 */
export function drawGroundArrow(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
  width: number,
  head: number,
  heads: 1 | 2 = 1,
  alpha = 1,
): void {
  const x0 = cam.sx(ax);
  const y0 = cam.sy(ay);
  const x1 = cam.sx(bx);
  const y1 = cam.sy(by);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const hl = Math.min(head, len * 0.45);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(ang);
  ctx.beginPath();
  const s0 = heads === 2 ? hl * 0.8 : 0;
  ctx.moveTo(s0, 0);
  ctx.lineTo(len - hl * 0.8, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha * 0.85;
  ctx.lineWidth = width + 4;
  ctx.strokeStyle = 'rgba(5,6,10,0.85)';
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  const tip = (x: number, s: 1 | -1) => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - s * hl, -hl * 0.62);
    ctx.lineTo(x - s * hl * 0.72, 0);
    ctx.lineTo(x - s * hl, hl * 0.62);
    ctx.closePath();
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(5,6,10,0.85)';
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
  };
  tip(len, 1);
  if (heads === 2) tip(0, -1);
  ctx.restore();
  ctx.lineCap = 'butt';
}

/** Moving chevrons (›››) along world a→b showing the flow direction inside a band / fan. */
export function drawGroundChevrons(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
  size: number,
  spacing: number,
  phase: number,
  alpha: number,
): void {
  const x0 = cam.sx(ax);
  const y0 = cam.sy(ay);
  const x1 = cam.sx(bx);
  const y1 = cam.sy(by);
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < spacing) return;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.32);
  const off = (((phase % 1) + 1) % 1) * spacing;
  for (let x = off + size; x < len - size * 0.2; x += spacing) {
    const fade = Math.min(1, x / (spacing * 1.2), (len - x) / (spacing * 1.2));
    ctx.globalAlpha = alpha * Math.max(0, fade);
    ctx.beginPath();
    ctx.moveTo(x - size, -size * 0.75);
    ctx.lineTo(x, 0);
    ctx.lineTo(x - size, size * 0.75);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

/** Capsule (rounded top, slightly rounded bottom) standing on (fx, fy). Begins a new path. */
export function pathCapsule(ctx: CanvasRenderingContext2D, fx: number, fy: number, w: number, h: number): void {
  const r = w / 2;
  const br = Math.min(r * 0.45, h * 0.2);
  const left = fx - r;
  const right = fx + r;
  const top = fy - h;
  ctx.beginPath();
  ctx.moveTo(left, top + r);
  ctx.arc(fx, top + r, r, Math.PI, 0);
  ctx.lineTo(right, fy - br);
  ctx.quadraticCurveTo(right, fy, right - br, fy);
  ctx.lineTo(left + br, fy);
  ctx.quadraticCurveTo(left, fy, left, fy - br);
  ctx.closePath();
}

/** Rounded rectangle path (no reliance on ctx.roundRect for older mobile browsers). Begins a new path. */
export function pathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Small 5-point star path centered at (x, y). Adds to the current path. */
export function addStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Deterministic hash → [0,1) for cosmetic decoration placement (stable across frames). */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
