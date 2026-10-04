// Drag-skill footprint drawing (3차 2: 드래그 중 미리보기에 모양과 방향이 그대로 보임).
// Draws DragPreview.parts (every action with offsets, delays and the dash path) on the ground, plus direction cues:
// arrows / chevrons along fixed directions, a start→end arrow for dashes, numbered order for delayed multi-hits.
// Pure drawing over (DragPreview, arena); geometry comes from sim/geometry so the picture equals the hit test.

import type { AreaShape, DragPreview, PreviewPart, Vec2 } from '../types';
import { DIR_VEC, areaCentroid, dashEnd, rectFrame } from '../sim/geometry';
import { Camera } from './camera';
import { boldFont } from './look';
import { TAU, addAreaPath, drawGroundArrow, drawGroundChevrons, groundEllipse, pathArea } from './shapes';

/** Buff/heal areas that only touch allies get this tint + dashed outline (enemy-hitting parts use the card colour). */
export const ALLY_TINT = '#7dffb3';
const WHITE = '#ffffff';

interface DrawPart {
  part: PreviewPart;
  center: Vec2;
  enemies: boolean;
  allies: boolean;
  /** 1-based landing order among visible parts (0 = not numbered). */
  order: number;
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** Visible parts of a preview (self-only parts dropped, identical footprints merged) with their landing order. */
export function previewDrawParts(dp: Pick<DragPreview, 'pos' | 'area' | 'parts'>): DrawPart[] {
  const src: PreviewPart[] = dp.parts && dp.parts.length ? dp.parts : [{ area: dp.area, offset: ZERO, delay: 0, affects: 'enemies' }];
  const out: DrawPart[] = [];
  for (const part of src) {
    if (part.affects === 'self') continue;
    const center = { x: dp.pos.x + part.offset.x, y: dp.pos.y + part.offset.y };
    const same = out.find(o => o.center.x === center.x && o.center.y === center.y && sameArea(o.part.area, part.area));
    if (same) {
      if (part.affects === 'enemies') same.enemies = true;
      else same.allies = true;
      if (part.dash && !same.part.dash) same.part = part;
      continue;
    }
    out.push({ part, center, enemies: part.affects === 'enemies', allies: part.affects === 'allies', order: 0 });
  }
  const timed = out.filter(o => o.enemies || o.allies);
  const delays = new Set(timed.map(o => o.part.delay));
  if (timed.length > 1 && delays.size > 1) {
    const sorted = [...timed].sort((a, b) => a.part.delay - b.part.delay);
    sorted.forEach((o, i) => (o.order = i + 1));
  }
  return out;
}

function sameArea(a: AreaShape, b: AreaShape): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Where a dashing preview ends (clamped like the sim), or null. */
export function previewDashEnd(dp: Pick<DragPreview, 'pos' | 'area' | 'parts'>, arena: { width: number; height: number }): { from: Vec2; to: Vec2 } | null {
  for (const p of dp.parts ?? []) {
    if (!p.dash) continue;
    const from = { x: dp.pos.x + p.offset.x, y: dp.pos.y + p.offset.y };
    return { from, to: dashEnd(from, p.dash.dir, p.dash.distance, arena) };
  }
  return null;
}

/**
 * Direction cue for one area: chevrons + arrow along a fixed-direction rect or cone (double arrow for centered
 * bands), nothing for symmetric shapes. Used by the drag preview and by ally/enemy telegraphs.
 */
export function drawAreaDirection(ctx: CanvasRenderingContext2D, cam: Camera, center: Vec2, area: AreaShape, color: string, alpha: number, time: number, strong: boolean): void {
  if (area.shape === 'rect') {
    const f = rectFrame(area, center);
    const inset = Math.min(0.45, f.len * 0.1);
    const ax = f.sx + f.ux * inset;
    const ay = f.sy + f.uy * inset;
    const bx = f.sx + f.ux * (f.len - inset * 0.4);
    const by = f.sy + f.uy * (f.len - inset * 0.4);
    const vertical = f.uy !== 0;
    const head = strong ? (vertical ? 18 : 22) : 14;
    if (area.anchor === 'center') {
      drawGroundArrow(ctx, cam, ax, ay, bx, by, color, strong ? 5 : 3, head, 2, alpha);
    } else {
      drawGroundChevrons(ctx, cam, ax, ay, bx - f.ux * 0.6, by - f.uy * 0.6, color, strong ? 11 : 8, strong ? 34 : 30, time * 1.6, alpha * 0.55);
      drawGroundArrow(ctx, cam, bx - f.ux * Math.min(2.2, f.len * 0.35), by - f.uy * Math.min(2.2, f.len * 0.35), bx, by, color, strong ? 5 : 3, head, 1, alpha);
    }
    return;
  }
  if (area.shape === 'cone') {
    const u = DIR_VEC[area.dir];
    const R = area.radius;
    drawGroundChevrons(ctx, cam, center.x + u.x * 0.3, center.y + u.y * 0.3, center.x + u.x * R * 0.7, center.y + u.y * R * 0.7, color, strong ? 11 : 8, strong ? 30 : 26, time * 1.6, alpha * 0.55);
    drawGroundArrow(ctx, cam, center.x + u.x * R * 0.45, center.y + u.y * R * 0.45, center.x + u.x * R * 0.96, center.y + u.y * R * 0.96, color, strong ? 5 : 3, strong ? 22 : 14, 1, alpha);
  }
}

/** Order badges sit on the camera-side rim of circles (the drop ghost covers the center). */
function badgeAt(p: DrawPart): Vec2 {
  const a = p.part.area;
  if (a.shape === 'circle') return { x: p.center.x, y: p.center.y + a.radius * 0.62 };
  return areaCentroid(a, p.center);
}

/** Small round order badge (1, 2, 3 …) for delayed multi-hits. */
function orderBadge(ctx: CanvasRenderingContext2D, cam: Camera, at: Vec2, n: number, color: string, alpha: number): void {
  const x = cam.sx(at.x);
  const y = cam.sy(at.y);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, TAU);
  ctx.fillStyle = 'rgba(5,6,10,0.85)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.font = boldFont(17);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = WHITE;
  ctx.fillText(String(n), x, y + 1);
  ctx.globalAlpha = 1;
}

/** True when the timed parts march along one axis (e.g. 섀도우 3연속 폭발 →) — they get a chain arrow. */
function chainDir(parts: DrawPart[]): { a: Vec2; b: Vec2 } | null {
  const seq = parts.filter(p => p.order > 0).sort((x, y) => x.order - y.order);
  if (seq.length < 2) return null;
  const sameY = seq.every(p => Math.abs(p.center.y - seq[0].center.y) < 1e-6);
  const sameX = seq.every(p => Math.abs(p.center.x - seq[0].center.x) < 1e-6);
  if (!sameY && !sameX) return null;
  return { a: seq[0].center, b: seq[seq.length - 1].center };
}

/**
 * Ground layer of the drag preview: every footprint part, coloured by validity, with direction cues on top.
 * `color` = card colour when valid, invalid red otherwise.
 */
export function drawPreviewFootprint(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  dp: DragPreview,
  arena: { width: number; height: number },
  color: string,
  time: number,
): void {
  const parts = previewDrawParts(dp);
  const valid = dp.valid;
  const numbered = parts.some(p => p.order > 0);
  const maxOrder = parts.reduce((m, p) => Math.max(m, p.order), 0);

  // 1) ally-only buff areas: soft tint + dashed outline, underneath the damage footprint
  for (const p of parts) {
    if (p.enemies) continue;
    const c = valid ? (parts.some(q => q.enemies) ? ALLY_TINT : color) : color;
    pathArea(ctx, cam, p.center, null, p.part.area, 1);
    ctx.globalAlpha = valid ? 0.14 : 0.12;
    ctx.fillStyle = c;
    ctx.fill();
    if (parts.some(q => q.enemies)) ctx.setLineDash([10, 7]);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#05060a';
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 2) enemy-hitting (or mixed) parts; later delayed parts a little fainter
  for (const p of parts) {
    if (!p.enemies) continue;
    const late = numbered && p.order > 1 ? (p.order - 1) / Math.max(1, maxOrder - 1) : 0;
    pathArea(ctx, cam, p.center, null, p.part.area, 1);
    ctx.globalAlpha = (valid ? 0.3 : 0.2) * (1 - 0.35 * late);
    ctx.fillStyle = color;
    ctx.fill();
    // dark rim under the coloured outline: the footprint edge reads on every floor tint
    ctx.globalAlpha = 0.5 * (1 - 0.3 * late);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#05060a';
    ctx.stroke();
    ctx.globalAlpha = 1 - 0.3 * late;
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (valid && !p.allies) {
      // white dashed edge = "my preview", never mistaken for a solid red enemy telegraph (거너's brown cone)
      ctx.globalAlpha = 0.75 * (1 - 0.3 * late);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = WHITE;
      ctx.setLineDash([8, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.allies && valid) {
      // mixed band (바드): a dashed ally outline just inside tells "아군도 받음"
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.strokeStyle = ALLY_TINT;
      ctx.setLineDash([9, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 3) pulse ring on single circles (as before) so a still finger still reads as "live"
  if (valid && parts.length === 1 && parts[0].part.area.shape === 'circle') {
    const k = (time * 1.4) % 1;
    pathArea(ctx, cam, parts[0].center, null, parts[0].part.area, k);
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  if (valid && parts.length === 1 && parts[0].part.area.shape === 'ring') {
    // ring: inward pulse (끌어당김) from the outer edge to the inner one
    const a = parts[0].part.area as Extract<AreaShape, { shape: 'ring' }>;
    const k = (time * 1.1) % 1;
    const r = a.outer - (a.outer - a.inner) * k;
    ctx.beginPath();
    groundEllipse(ctx, cam, parts[0].center.x, parts[0].center.y, r);
    ctx.globalAlpha = 0.7 * (1 - k * 0.6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = WHITE;
    ctx.stroke();
  }

  // 4) direction cues (white with a dark rim reads on every floor and fill colour)
  const cue = valid ? WHITE : '#ffd0d0';
  const dash = previewDashEnd(dp, arena);
  for (const p of parts) {
    if (p.part.dash) continue; // the dash arrow below says it better
    if (!p.enemies && parts.some(q => q.enemies)) continue;
    drawAreaDirection(ctx, cam, p.center, p.part.area, cue, valid ? 0.95 : 0.7, valid ? time : 0, true);
  }
  if (dash) {
    // 돌진: thick start → end arrow along the path + end ring where the character stops
    drawGroundChevrons(ctx, cam, dash.from.x + 0.3, dash.from.y, dash.to.x - 1.2 * Math.sign(dash.to.x - dash.from.x || 1), dash.to.y, cue, 11, 32, valid ? time * 2 : 0, 0.5);
    drawGroundArrow(ctx, cam, dash.from.x, dash.from.y, dash.to.x, dash.to.y, cue, 6, 24, 1, valid ? 1 : 0.7);
    ctx.beginPath();
    groundEllipse(ctx, cam, dash.to.x, dash.to.y, 0.55);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = cue;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const chain = chainDir(parts);
  if (chain) drawGroundArrow(ctx, cam, chain.a.x, chain.a.y, chain.b.x, chain.b.y, cue, 4, 20, 1, 0.95);

  // drop-point cross
  const sx = cam.sx(dp.pos.x);
  const sy = cam.sy(dp.pos.y);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.strokeStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(sx - 10, sy);
  ctx.lineTo(sx + 10, sy);
  ctx.moveTo(sx, sy - 6);
  ctx.lineTo(sx, sy + 6);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Landing-order badges (1, 2, 3 …) of delayed multi-hits, drawn above the units so bodies never hide them. */
export function drawPreviewBadges(ctx: CanvasRenderingContext2D, cam: Camera, dp: DragPreview, color: string): void {
  for (const p of previewDrawParts(dp)) if (p.order > 0) orderBadge(ctx, cam, badgeAt(p), p.order, color, p.order === 1 ? 1 : 0.85);
}

/** Union path of every enemy-hitting part (tests / tools). */
export function pathPreviewUnion(ctx: CanvasRenderingContext2D, cam: Camera, dp: DragPreview): void {
  ctx.beginPath();
  for (const p of previewDrawParts(dp)) addAreaPath(ctx, cam, p.center, null, p.part.area, 1);
}
