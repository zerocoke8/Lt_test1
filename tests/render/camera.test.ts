import { describe, expect, it } from 'vitest';
import {
  Camera,
  GROUND_SQUASH,
  GROUND_TOP,
  PX_PER_UNIT,
  PX_PER_UNIT_Y,
  VIEW_WIDTH_UNITS,
  clampCameraX,
  followCameraX,
  screenToWorld,
  worldToScreen,
} from '../../src/render/camera';
import { ARENA_BOSS, ARENA_NORMAL } from '../../src/config';
import { LOGICAL_W } from '../../src/types';

describe('quarter-view projection', () => {
  it('shows ~24 world units across the 1280px logical width (≈53 px/unit)', () => {
    expect(VIEW_WIDTH_UNITS).toBe(24);
    expect(PX_PER_UNIT).toBeCloseTo(53.333, 2);
    expect(PX_PER_UNIT_Y).toBeCloseTo(PX_PER_UNIT * GROUND_SQUASH, 6);
    expect(GROUND_SQUASH).toBeCloseTo(0.55, 2);
  });

  it('puts the arena top edge at GROUND_TOP and keeps the arena above the card band', () => {
    const top = worldToScreen({ x: 12, y: 0 }, 12);
    const bottom = worldToScreen({ x: 12, y: ARENA_NORMAL.height }, 12);
    expect(top.y).toBe(GROUND_TOP);
    expect(GROUND_TOP).toBeGreaterThanOrEqual(130);
    expect(GROUND_TOP).toBeLessThanOrEqual(170);
    expect(bottom.y).toBeLessThan(580);
    // camera center maps to screen center
    expect(top.x).toBeCloseTo(LOGICAL_W / 2, 6);
  });

  it('y grows toward the camera (screen-down)', () => {
    const a = worldToScreen({ x: 5, y: 2 }, 12);
    const b = worldToScreen({ x: 5, y: 8 }, 12);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('worldToScreen ↔ screenToWorld round-trips for many camera positions', () => {
    for (const camX of [12, 13.37, 18, 24]) {
      for (let wx = -3; wx <= 39; wx += 1.7) {
        for (let wy = -2; wy <= 14; wy += 1.3) {
          const s = worldToScreen({ x: wx, y: wy }, camX);
          const w = screenToWorld(s, camX);
          expect(w.x).toBeCloseTo(wx, 9);
          expect(w.y).toBeCloseTo(wy, 9);
        }
      }
      for (let sx = 0; sx <= 1280; sx += 97) {
        for (let sy = 0; sy <= 720; sy += 61) {
          const w = screenToWorld({ x: sx, y: sy }, camX);
          const s = worldToScreen(w, camX);
          expect(s.x).toBeCloseTo(sx, 9);
          expect(s.y).toBeCloseTo(sy, 9);
        }
      }
    }
  });

  it('writes into an out vector when given', () => {
    const out = { x: 0, y: 0 };
    const r = worldToScreen({ x: 1, y: 1 }, 12, out);
    expect(r).toBe(out);
    const r2 = screenToWorld({ x: 640, y: 300 }, 12, out);
    expect(r2).toBe(out);
  });
});

describe('camera clamp + follow', () => {
  it('기획 16차: the normal arena is the screen width (24), so the camera stays centered', () => {
    expect(ARENA_NORMAL.width).toBe(VIEW_WIDTH_UNITS);
    expect(clampCameraX(0, ARENA_NORMAL.width)).toBe(12);
    expect(clampCameraX(100, ARENA_NORMAL.width)).toBe(12);
    expect(clampCameraX(17, ARENA_NORMAL.width)).toBe(12);
  });

  it('clamps an arena wider than the screen so the view never leaves it', () => {
    expect(clampCameraX(0, 36)).toBe(12);
    expect(clampCameraX(100, 36)).toBe(36 - 12);
    expect(clampCameraX(17, 36)).toBe(17);
  });

  it('centers boss / narrow arenas (no scroll)', () => {
    expect(clampCameraX(3, ARENA_BOSS.width)).toBe(ARENA_BOSS.width / 2);
    expect(clampCameraX(30, ARENA_BOSS.width)).toBe(ARENA_BOSS.width / 2);
    expect(clampCameraX(5, 16)).toBe(8);
  });

  it('follows smoothly and converges, frame-rate independent', () => {
    let a = 12;
    for (let i = 0; i < 60; i++) a = followCameraX(a, 22, 1 / 60, 36);
    let b = 12;
    for (let i = 0; i < 30; i++) b = followCameraX(b, 22, 1 / 30, 36);
    expect(a).toBeGreaterThan(12);
    expect(a).toBeLessThan(22);
    expect(a).toBeCloseTo(b, 6);
    let c = 12;
    for (let i = 0; i < 600; i++) c = followCameraX(c, 22, 1 / 60, 36);
    expect(c).toBeCloseTo(22, 3);
  });

  it('stops when the target is null (field empty) and respects clamping of the goal', () => {
    expect(followCameraX(15, null, 0.5, 36)).toBe(15);
    let x = 15;
    for (let i = 0; i < 1000; i++) x = followCameraX(x, 40, 1 / 60, 36);
    expect(x).toBeCloseTo(24, 6);
  });

  it('Camera.toWorld uses the CURRENT camera x', () => {
    const cam = new Camera();
    cam.setArena(36, 12);
    cam.snap(12);
    const p = { x: 640, y: 300 };
    expect(cam.toWorld(p).x).toBeCloseTo(12, 9);
    cam.snap(20);
    expect(cam.toWorld(p).x).toBeCloseTo(20, 9);
    cam.follow(null, 1);
    expect(cam.x).toBe(20);
    const s = cam.toScreen({ x: 20, y: 6 });
    expect(s.x).toBeCloseTo(640, 9);
    expect(cam.toWorld(s).y).toBeCloseTo(6, 9);
  });

  it('visibleX reports the horizontal view window', () => {
    const cam = new Camera();
    cam.setArena(36, 12);
    cam.snap(12);
    expect(cam.visibleX(0, 0)).toBe(true);
    expect(cam.visibleX(24, 0)).toBe(true);
    expect(cam.visibleX(25, 0)).toBe(false);
    expect(cam.visibleX(25, 2)).toBe(true);
  });
});
