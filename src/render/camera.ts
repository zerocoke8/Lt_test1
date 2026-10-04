// Pure quarter-view projection + camera math (no DOM). Unit-tested in tests/render/camera.test.ts.
//
// Ground plane (x, y) is drawn with a vertical squash: screenX scales x, screenY scales y × GROUND_SQUASH.
// Upright height (z, e.g. a body or a flying projectile) goes straight up the screen at PX_PER_UNIT_Z.
// The camera only scrolls horizontally (기획서 3장): `x` is the world x shown at the screen center.

import { VIEW_WIDTH_UNITS } from '../config';
import { LOGICAL_H, LOGICAL_W, type Vec2 } from '../types';

/** World units visible horizontally (≈53 px per unit on the 1280 px logical surface). Defined in config (bots use it). */
export { VIEW_WIDTH_UNITS };
export const PX_PER_UNIT = LOGICAL_W / VIEW_WIDTH_UNITS;
/** Vertical squash of the ground plane (quarter view). */
export const GROUND_SQUASH = 0.55;
export const PX_PER_UNIT_Y = PX_PER_UNIT * GROUND_SQUASH;
/** Upright height scale (px per world unit of height). */
export const PX_PER_UNIT_Z = PX_PER_UNIT * 0.8;
/** Screen y of the arena's top edge (world y = 0). Leaves room for the boss + top HUD. */
export const GROUND_TOP = 150;
/** Follow smoothing rate (1/s). Higher = snappier. */
export const CAMERA_FOLLOW_RATE = 5;

/** Camera x (world x at screen center) clamped so the view never leaves the arena. Narrow arenas are centered. */
export function clampCameraX(x: number, arenaWidth: number): number {
  const half = VIEW_WIDTH_UNITS / 2;
  if (arenaWidth <= VIEW_WIDTH_UNITS) return arenaWidth / 2;
  if (x < half) return half;
  if (x > arenaWidth - half) return arenaWidth - half;
  return x;
}

/**
 * One smoothing step toward `targetX` (frame-rate independent exponential follow).
 * `targetX === null` (field empty / camera frozen) keeps the camera where it is.
 */
export function followCameraX(
  currentX: number,
  targetX: number | null,
  dt: number,
  arenaWidth: number,
  rate: number = CAMERA_FOLLOW_RATE,
): number {
  if (targetX === null) return clampCameraX(currentX, arenaWidth);
  const goal = clampCameraX(targetX, arenaWidth);
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return clampCameraX(currentX + (goal - currentX) * k, arenaWidth);
}

export function worldToScreenX(wx: number, camX: number): number {
  return (wx - camX) * PX_PER_UNIT + LOGICAL_W / 2;
}

export function worldToScreenY(wy: number): number {
  return GROUND_TOP + wy * PX_PER_UNIT_Y;
}

export function screenToWorldX(sx: number, camX: number): number {
  return (sx - LOGICAL_W / 2) / PX_PER_UNIT + camX;
}

export function screenToWorldY(sy: number): number {
  return (sy - GROUND_TOP) / PX_PER_UNIT_Y;
}

/** World (ground point) → logical canvas px. Writes into `out` when given (no allocation). */
export function worldToScreen(v: Vec2, camX: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  out.x = worldToScreenX(v.x, camX);
  out.y = worldToScreenY(v.y);
  return out;
}

/** Logical canvas px → world ground point (inverse of worldToScreen). */
export function screenToWorld(p: Vec2, camX: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  out.x = screenToWorldX(p.x, camX);
  out.y = screenToWorldY(p.y);
  return out;
}

/** Stateful camera used by the renderer. */
export class Camera {
  x = VIEW_WIDTH_UNITS / 2;
  arenaWidth = VIEW_WIDTH_UNITS;
  arenaHeight = 12;

  setArena(width: number, height: number): void {
    this.arenaWidth = width;
    this.arenaHeight = height;
    this.x = clampCameraX(this.x, width);
  }

  snap(targetX: number | null): void {
    this.x = clampCameraX(targetX ?? this.arenaWidth / 2, this.arenaWidth);
  }

  follow(targetX: number | null, dt: number): void {
    this.x = followCameraX(this.x, targetX, dt, this.arenaWidth);
  }

  sx(wx: number): number {
    return worldToScreenX(wx, this.x);
  }

  sy(wy: number): number {
    return worldToScreenY(wy);
  }

  toScreen(v: Vec2, out?: Vec2): Vec2 {
    return worldToScreen(v, this.x, out);
  }

  toWorld(p: Vec2, out?: Vec2): Vec2 {
    return screenToWorld(p, this.x, out);
  }

  /** True when a world x (± margin in units) is inside the horizontal view. */
  visibleX(wx: number, marginUnits: number): boolean {
    const half = VIEW_WIDTH_UNITS / 2 + marginUnits;
    return wx >= this.x - half && wx <= this.x + half;
  }
}

/** Visible logical area, for convenience in tests/tools. */
export const VIEW = { width: LOGICAL_W, height: LOGICAL_H } as const;
