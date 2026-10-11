// 기획 19차 보스 레이드: warning motifs (docs/bosses.md 3장 「예고 덧그림」). The footprint of a boss warning is drawn as
// always; this adds a small extra that says what it does — pull (arrows inward), push (arrows outward, or along the
// knock-back direction), linger (hatching: it stays after it lands), spawn (dotted circles: something comes out).
// Keyed by skill id (BOSS_TELE_MOTIF); the classic bosses have no rows, so their warnings are unchanged.

import type { AreaShape, Dir, Telegraph } from '../../types';
import { BOSSES } from '../../data';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { TAU, areaReach, pathArea } from '../shapes';
import type { TeleMotif } from './types';

const DIR_VEC: Record<Dir, { x: number; y: number }> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };
const INK = '#2a0006';
const PAPER = '#ffe2e2';
const DOTS = [3, 6];
const NO_DASH: number[] = [];

/** Skill id → the fixed direction of its knock-back (re_run: 'down'), from the boss data. Built on first use. */
let pushDirs: Map<string, Dir> | null = null;

function pushDirOf(skillId: string): Dir | undefined {
  if (!pushDirs) {
    pushDirs = new Map();
    for (const b of BOSSES) {
      for (const sk of [...b.skills, ...(b.phases ?? []).flatMap(p => p.skills ?? [])]) {
        for (const a of [sk.action, ...(sk.extra ?? [])]) {
          for (const e of a.effects) if (e.kind === 'knockback' && e.dir) pushDirs.set(sk.id, e.dir);
        }
      }
    }
  }
  return pushDirs.get(skillId);
}

/** Middle of a footprint in world units (rect: the middle of its length; everything else: the centre). */
function middle(t: Telegraph, out: { x: number; y: number }): void {
  const a = t.area;
  out.x = t.center.x;
  out.y = t.center.y;
  if (a.shape === 'rect' && a.anchor !== 'center') {
    const u = DIR_VEC[a.dir];
    out.x += (u.x * a.length) / 2;
    out.y += (u.y * a.length) / 2;
  }
}

/** One chevron at screen (x, y) pointing along (ux, uy). */
function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, s: number): void {
  ctx.moveTo(x - ux * s - uy * s, y - uy * s + ux * s);
  ctx.lineTo(x + ux * s * 0.6, y + uy * s * 0.6);
  ctx.lineTo(x - ux * s + uy * s, y - uy * s - ux * s);
}

function strokeMarks(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

const MID = { x: 0, y: 0 };

/** Six chevrons on a circle around the centre, marching inward (pull) or outward (push without a direction). */
function radial(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, time: number, inward: boolean, alpha: number): void {
  const a = t.area;
  const outer = a.shape === 'ring' ? Math.min(a.outer, 6) : Math.min(areaReach(a), 6);
  const inner = a.shape === 'ring' ? a.inner : 0;
  const u = (time * 0.9) % 1;
  const r = inward ? outer - (outer - inner) * (0.15 + 0.6 * u) : inner + (outer - inner) * (0.25 + 0.6 * u);
  const cx = cam.sx(t.center.x);
  const cy = cam.sy(t.center.y);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * TAU + 0.26;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang) * (PX_PER_UNIT_Y / PX_PER_UNIT);
    const k = inward ? -1 : 1;
    chevron(ctx, cx + dx * r * PX_PER_UNIT, cy + dy * r * PX_PER_UNIT, dx * k, dy * k, 8);
  }
  strokeMarks(ctx, alpha * (0.45 + 0.5 * Math.sin(Math.PI * u)));
}

/** Chevrons along a fixed push direction, spread over the footprint (역주행: every stair row shoves down). */
function directed(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, dir: Dir, time: number, alpha: number): void {
  const a = t.area;
  const u = DIR_VEC[dir];
  middle(t, MID);
  // spread across the footprint, at right angles to the push
  const span = a.shape === 'rect' ? (DIR_VEC[a.dir].x * u.x + DIR_VEC[a.dir].y * u.y === 0 ? a.length : a.width) : areaReach(a) * 2;
  const n = Math.max(1, Math.min(6, Math.round(span / 4)));
  const shift = ((time * 1.4) % 1) * 0.5 - 0.25;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : (i / (n - 1) - 0.5) * span * 0.84;
    const wx = MID.x - u.y * f + u.x * shift;
    const wy = MID.y + u.x * f + u.y * shift;
    chevron(ctx, cam.sx(wx), cam.sy(wy), u.x, u.y * (PX_PER_UNIT_Y / PX_PER_UNIT), 9);
  }
  strokeMarks(ctx, alpha * 0.9);
}

/** Diagonal hatching clipped to the footprint: 「떨어진 뒤에도 남아요」. */
function hatch(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, area: AreaShape, alpha: number): void {
  const r = Math.min(areaReach(area), 13);
  const cx = cam.sx(t.center.x);
  const cy = cam.sy(t.center.y);
  const rx = r * PX_PER_UNIT;
  const ry = r * PX_PER_UNIT_Y;
  ctx.save();
  pathArea(ctx, cam, t.center, t.origin, area, 1);
  ctx.clip();
  ctx.beginPath();
  const step = 26;
  for (let x = -rx - ry; x <= rx; x += step) {
    ctx.moveTo(cx + x, cy + ry);
    ctx.lineTo(cx + x + ry * 2, cy - ry);
  }
  ctx.globalAlpha = alpha * 0.5;
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.restore();
}

/** Three small dotted circles inside the footprint: something comes out here. */
function spawnDots(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, time: number, alpha: number): void {
  const r = Math.min(areaReach(t.area), 3) * 0.5;
  const cx = cam.sx(t.center.x);
  const cy = cam.sy(t.center.y);
  ctx.setLineDash(DOTS);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * TAU + time * 0.8;
    const px = cx + Math.cos(ang) * r * PX_PER_UNIT;
    const py = cy + Math.sin(ang) * r * PX_PER_UNIT_Y;
    ctx.moveTo(px + 13, py);
    ctx.ellipse(px, py, 13, 13 * (PX_PER_UNIT_Y / PX_PER_UNIT), 0, 0, TAU);
  }
  ctx.globalAlpha = alpha * 0.9;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}

/**
 * The motif of one boss warning, over its outline. `area` = the footprint as drawn (big circles capped), `later` = a
 * later part of a multi-part cast (drawn fainter). Leaves globalAlpha at 1.
 */
export function drawTeleMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, area: AreaShape, motif: TeleMotif, skillId: string, time: number, later: boolean): void {
  const alpha = later ? 0.45 : 1;
  switch (motif) {
    case 'pull':
      radial(ctx, cam, t, time, true, alpha);
      break;
    case 'push': {
      const dir = pushDirOf(skillId);
      if (dir) directed(ctx, cam, t, dir, time, alpha);
      else radial(ctx, cam, t, time, false, alpha);
      break;
    }
    case 'linger':
      hatch(ctx, cam, t, area, alpha);
      break;
    case 'spawn':
      spawnDots(ctx, cam, t, time, alpha);
      break;
  }
  ctx.globalAlpha = 1;
}
