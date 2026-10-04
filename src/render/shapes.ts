// Low-level path helpers shared by the ground layer (areas) and units (bodies).

import type { AreaShape, Vec2 } from '../types';
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

/**
 * Builds the path of an AreaShape on the ground (begins a new path).
 * `progress` (0..1) scales the area: circles grow from the center, lines extend from the origin.
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
  if (area.shape === 'circle') {
    groundEllipse(ctx, cam, center.x, center.y, area.radius * progress);
    return;
  }
  if (area.shape === 'single') {
    groundEllipse(ctx, cam, center.x, center.y, SINGLE_AREA_RADIUS * progress);
    return;
  }
  // line: rectangle from origin toward center
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
  const L = area.length * progress;
  const hw = area.width / 2;
  const px = -dy * hw;
  const py = dx * hw;
  const ex = ox + dx * L;
  const ey = oy + dy * L;
  ctx.moveTo(cam.sx(ox + px), cam.sy(oy + py));
  ctx.lineTo(cam.sx(ex + px), cam.sy(ey + py));
  ctx.lineTo(cam.sx(ex - px), cam.sy(ey - py));
  ctx.lineTo(cam.sx(ox - px), cam.sy(oy - py));
  ctx.closePath();
}

/** Rough world radius of an area (for bursts/particles). */
export function areaRadius(area: AreaShape): number {
  if (area.shape === 'circle') return area.radius;
  if (area.shape === 'line') return Math.max(area.width, 1);
  return SINGLE_AREA_RADIUS;
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
