// Pure area geometry shared by the skill executor, drag previews, bots and tests (기획 3차 2: 드래그스킬 형태).
// Every AreaShape is laid on the ground plane (x, y) at a center; a unit is a circle (pos, radius) and counts as
// hit when its circle touches the shape (exact circle–shape distance, except 'line' which keeps its original
// "rectangle grown by the unit radius" test so monster/normal-skill behaviour is unchanged).
// 'line' and 'fan' (기획 8차) are auto-aimed: they start at `origin` (the caster) and point toward `center`.
// No DOM, no randomness.

import type { AreaShape, Dir, SkillAction, Vec2 } from '../types';

export const DIR_VEC: Readonly<Record<Dir, Readonly<Vec2>>> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export function dirVec(d: Dir): Vec2 {
  const v = DIR_VEC[d];
  return { x: v.x, y: v.y };
}

/** Edge distance used by the 'single' shape when it has to pick a unit near the center. */
export const SINGLE_REACH = 1;

/** Oriented rectangle: starts at (sx, sy), runs `len` along (ux, uy), half-width hw on both sides. */
export interface RectFrame {
  sx: number;
  sy: number;
  ux: number;
  uy: number;
  len: number;
  hw: number;
}

/** The world rectangle of a 'rect' area placed at center. */
export function rectFrame(area: Extract<AreaShape, { shape: 'rect' }>, center: Vec2): RectFrame {
  const u = DIR_VEC[area.dir];
  const back = area.anchor === 'center' ? area.length / 2 : 0;
  return { sx: center.x - u.x * back, sy: center.y - u.y * back, ux: u.x, uy: u.y, len: area.length, hw: area.width / 2 };
}

/** Axes of a cross: '+' = world x/y, diagonal 'X' = the two 45° diagonals. */
export function crossAxes(diagonal: boolean | undefined): [Vec2, Vec2] {
  if (!diagonal) return [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  const k = Math.SQRT1_2;
  return [{ x: k, y: k }, { x: k, y: -k }];
}

/** Distance from p to the oriented rectangle (0 inside). */
function distToRect(p: Vec2, sx: number, sy: number, ux: number, uy: number, len: number, hw: number): number {
  const rx = p.x - sx;
  const ry = p.y - sy;
  const along = rx * ux + ry * uy;
  const perp = rx * -uy + ry * ux;
  const ca = along < 0 ? 0 : along > len ? len : along;
  const cp = perp < -hw ? -hw : perp > hw ? hw : perp;
  return Math.hypot(along - ca, perp - cp);
}

/** Distance from p to segment a→b. */
function distToSegment(p: Vec2, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - ax) * dx + (p.y - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t));
}

const EPS = 1e-9;

/** Circle (pos, r) vs circular sector at c (dir u, half-angle h rad, radius R). Exact for opening ≤ 180°. */
function hitsCone(c: Vec2, u: Vec2, half: number, R: number, pos: Vec2, r: number): boolean {
  const dx = pos.x - c.x;
  const dy = pos.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d <= r + EPS) return true;
  if (d > R + r + EPS) return false;
  const cosA = (dx * u.x + dy * u.y) / d;
  if (cosA >= Math.cos(half) - EPS) return true; // inside the wedge and within R + r
  // outside the wedge: nearest point lies on one of the two edge segments
  for (const s of [-1, 1]) {
    const a = Math.atan2(u.y, u.x) + s * half;
    if (distToSegment(pos, c.x, c.y, c.x + Math.cos(a) * R, c.y + Math.sin(a) * R) <= r + EPS) return true;
  }
  return false;
}

/** Unit direction origin → center, or `fallback` when they coincide (auto-aimed 'line' / 'fan'). */
export function aimDir(origin: Vec2, center: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const dx = center.x - origin.x;
  const dy = center.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: fallback.x, y: fallback.y };
  return { x: dx / len, y: dy / len };
}

/**
 * Does a unit circle (pos, radius) touch `area` placed at `center`?
 * `origin` is only used by the auto-aimed shapes: 'line' (rectangle from origin toward center) and 'fan' (sector
 * with its apex at origin, opening toward center); `fallbackDir` is their direction when origin and center
 * coincide (caster facing).
 */
export function hitsArea(area: AreaShape, center: Vec2, origin: Vec2, pos: Vec2, radius: number, fallbackDir: Vec2 = { x: 1, y: 0 }): boolean {
  switch (area.shape) {
    case 'circle':
      return Math.hypot(pos.x - center.x, pos.y - center.y) <= area.radius + radius + EPS;
    case 'single':
      return Math.hypot(pos.x - center.x, pos.y - center.y) - radius <= SINGLE_REACH + EPS;
    case 'line': {
      let dx = center.x - origin.x;
      let dy = center.y - origin.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        dx = fallbackDir.x;
        dy = fallbackDir.y;
      } else {
        dx /= len;
        dy /= len;
      }
      const rx = pos.x - origin.x;
      const ry = pos.y - origin.y;
      const along = rx * dx + ry * dy;
      const perp = Math.abs(rx * dy - ry * dx);
      return along >= -radius && along <= area.length + radius && perp <= area.width / 2 + radius;
    }
    case 'rect': {
      const f = rectFrame(area, center);
      return distToRect(pos, f.sx, f.sy, f.ux, f.uy, f.len, f.hw) <= radius + EPS;
    }
    case 'cone':
      return hitsCone(center, DIR_VEC[area.dir], ((area.angle / 2) * Math.PI) / 180, area.radius, pos, radius);
    case 'ring': {
      const d = Math.hypot(pos.x - center.x, pos.y - center.y);
      return d > area.inner - radius && d <= area.outer + radius + EPS;
    }
    case 'cross': {
      const hw = area.width / 2;
      const L = area.length;
      for (const u of crossAxes(area.diagonal)) {
        if (distToRect(pos, center.x - u.x * L, center.y - u.y * L, u.x, u.y, 2 * L, hw) <= radius + EPS) return true;
      }
      return false;
    }
    case 'fan':
      return hitsCone(origin, aimDir(origin, center, fallbackDir), ((area.angle / 2) * Math.PI) / 180, area.radius, pos, radius);
  }
}

/** True when the unit's center itself lies inside the area (used by bots to prefer well-covered drops). */
export function containsPoint(area: AreaShape, center: Vec2, p: Vec2): boolean {
  if (area.shape === 'ring') {
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    return d > area.inner && d <= area.outer;
  }
  return hitsArea(area, center, center, p, 0);
}

/**
 * Radius rewards (스킬 강화 "범위") scale every shape evenly: circle radius, rect/line length + width, cone radius,
 * cross arm length + thickness (like a band), ring OUTER edge only — the hole stays its size, so a ring that grows
 * never stops hitting what stands near the drop point.
 */
export function scaleArea(a: AreaShape, mult: number): AreaShape {
  if (mult === 1) return a;
  switch (a.shape) {
    case 'circle':
      return { shape: 'circle', radius: a.radius * mult };
    case 'single':
      return a;
    case 'line':
      return { shape: 'line', length: a.length * mult, width: a.width * mult };
    case 'rect':
      return { ...a, length: a.length * mult, width: a.width * mult };
    case 'cone':
      return { ...a, radius: a.radius * mult };
    case 'ring':
      return { shape: 'ring', inner: Math.min(a.inner, a.outer * mult), outer: a.outer * mult };
    case 'cross':
      return { ...a, length: a.length * mult, width: a.width * mult };
    case 'fan':
      return { ...a, radius: a.radius * mult };
  }
}

/** Dash distance scales with the same radius bonus so the path keeps matching its rect. */
export function scaleDash(d: NonNullable<SkillAction['dash']>, mult: number): { dir: Dir; distance: number } {
  return { dir: d.dir, distance: d.distance * mult };
}

export const DASH_DEFAULT_DURATION = 0.18;

/** Dash end point: start + dir × distance, kept `margin` inside the arena. */
export function dashEnd(start: Vec2, dir: Dir, distance: number, arena: { width: number; height: number }, margin = 0.5): Vec2 {
  const u = DIR_VEC[dir];
  const x = start.x + u.x * distance;
  const y = start.y + u.y * distance;
  return {
    x: Math.min(arena.width - margin, Math.max(margin, x)),
    y: Math.min(arena.height - margin, Math.max(margin, y)),
  };
}

/**
 * 기획 8차 charge: where a rush from `origin` toward `center` by up to `distance` stops — shortened (never bent) so
 * the caster stays inside the arena.
 */
export function chargeEnd(origin: Vec2, center: Vec2, distance: number, arenaSize: { width: number; height: number }, margin: number, fallback?: Vec2): Vec2 {
  const u = aimDir(origin, center, fallback);
  let t = Math.max(0, distance);
  const lo = margin;
  const hiX = arenaSize.width - margin;
  const hiY = arenaSize.height - margin;
  // keep a start that is already outside the walkable area from walking further out
  if (u.x > 1e-9) t = Math.min(t, Math.max(0, (hiX - origin.x) / u.x));
  else if (u.x < -1e-9) t = Math.min(t, Math.max(0, (lo - origin.x) / u.x));
  if (u.y > 1e-9) t = Math.min(t, Math.max(0, (hiY - origin.y) / u.y));
  else if (u.y < -1e-9) t = Math.min(t, Math.max(0, (lo - origin.y) / u.y));
  return { x: origin.x + u.x * t, y: origin.y + u.y * t };
}

/** Rough reach of an area from its center (zone bookkeeping, culling, effect sizes). */
export function areaExtent(a: AreaShape): number {
  switch (a.shape) {
    case 'circle':
      return a.radius;
    case 'single':
      return SINGLE_REACH;
    case 'line':
    case 'rect':
      return Math.hypot(a.length, a.width / 2);
    case 'cone':
    case 'fan':
      return a.radius;
    case 'ring':
      return a.outer;
    case 'cross':
      return Math.hypot(a.length, a.width / 2);
  }
}

/** Visual/logical middle of an area placed at center (rect from its start, cone along its dir). */
export function areaCentroid(a: AreaShape, center: Vec2): Vec2 {
  if (a.shape === 'rect') {
    const f = rectFrame(a, center);
    return { x: f.sx + (f.ux * f.len) / 2, y: f.sy + (f.uy * f.len) / 2 };
  }
  if (a.shape === 'cone') {
    const u = DIR_VEC[a.dir];
    return { x: center.x + u.x * a.radius * 0.5, y: center.y + u.y * a.radius * 0.5 };
  }
  return { x: center.x, y: center.y };
}

/** Area of the shape in world units² (bots: spread score; tests). */
export function areaSize(a: AreaShape): number {
  switch (a.shape) {
    case 'circle':
      return Math.PI * a.radius * a.radius;
    case 'single':
      return Math.PI * SINGLE_REACH * SINGLE_REACH;
    case 'line':
    case 'rect':
      return a.length * a.width;
    case 'cone':
    case 'fan':
      return (Math.PI * a.radius * a.radius * a.angle) / 360;
    case 'ring':
      return Math.PI * (a.outer * a.outer - a.inner * a.inner);
    case 'cross':
      return 2 * (2 * a.length * a.width) - a.width * a.width;
  }
}

/**
 * Representative points inside an area, relative to its center (bots aim by putting an enemy on one of them).
 * Always includes the centroid.
 */
export function aimSamples(a: AreaShape): Vec2[] {
  switch (a.shape) {
    case 'circle':
    case 'single':
      return [{ x: 0, y: 0 }];
    case 'line':
    case 'fan':
      // auto-aimed from the caster: the drop point itself is the aim point
      return [{ x: 0, y: 0 }];
    case 'rect': {
      const f = rectFrame(a, { x: 0, y: 0 });
      const out: Vec2[] = [];
      const n = Math.max(2, Math.min(6, Math.round(f.len / 2)));
      for (let i = 0; i < n; i++) {
        const t = (f.len * (i + 0.5)) / n;
        out.push({ x: f.sx + f.ux * t, y: f.sy + f.uy * t });
      }
      return out;
    }
    case 'cone': {
      const u = DIR_VEC[a.dir];
      return [0.3, 0.55, 0.8].map(k => ({ x: u.x * a.radius * k, y: u.y * a.radius * k }));
    }
    case 'ring': {
      const m = (a.inner + a.outer) / 2;
      return [{ x: m, y: 0 }, { x: -m, y: 0 }, { x: 0, y: m }, { x: 0, y: -m }];
    }
    case 'cross': {
      const out: Vec2[] = [{ x: 0, y: 0 }];
      const [u1, u2] = crossAxes(a.diagonal);
      for (const u of [u1, u2]) for (const s of [-1, 1]) out.push({ x: u.x * a.length * 0.6 * s, y: u.y * a.length * 0.6 * s });
      return out;
    }
  }
}
