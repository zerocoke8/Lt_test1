// 기획 13차 연출 부품 (docs/skill-renewal.md 2-7): the reusable building blocks the renewed drag skills and ults are
// assembled from — falling objects, tether lines (chain / thread / dotted / electric), glyphs, hex panels, rune circles,
// burning brands, staff lines, talismans, lightning, encasing ice / stone, aim reticles, craters, wings, spirits, the
// crescent moon and the ranger's aim line. They are pooled SkillFx records (skillfx.ts) drawn here; stagefx.ts picks
// and times them per `skillId:stage`. Render-only, allocation-free per frame.

import type { AreaShape } from '../types';
import { crossAxes, rectFrame } from '../sim/geometry';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { boldFont } from './look';
import { TAU, pathArea } from './shapes';
import { FallObj, Fx, type Sfx, TetherStyle } from './skillfx';
import type { UnitMemo } from './units';

type Pt = { x: number; y: number };

const ease = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Fade-out over the last `tail` fraction of the life. */
const fadeOut = (t: number, tail: number) => 1 - clamp01((t - (1 - tail)) / tail);
function rnd(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
const P0: Pt = { x: 0, y: 0 };

/** Ground-level parts (under the units). */
export function drawPartGround(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, memos: Map<number, UnitMemo>, time: number): void {
  switch (f.kind) {
    case Fx.Fall:
      fallShadow(ctx, cam, f, t, p);
      break;
    case Fx.Hex:
      hexPanels(ctx, cam, f, t, p);
      break;
    case Fx.Rune:
      runeCircle(ctx, cam, f, t, p, time);
      break;
    case Fx.Brand:
      brand(ctx, cam, f, t, p, time);
      break;
    case Fx.Staff:
      staffLines(ctx, cam, f, t, p);
      break;
    case Fx.Scorch:
      scorch(ctx, cam, f, t, p);
      break;
    case Fx.Crosshair:
      crosshair(ctx, cam, f, t, p, time);
      break;
    case Fx.AimLine:
      aimLine(ctx, cam, f, t, time);
      break;
    default:
      break;
  }
  void memos;
}

/** Airborne parts (over the units). */
export function drawPartAir(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, memos: Map<number, UnitMemo>, time: number): void {
  switch (f.kind) {
    case Fx.Fall:
      fallObject(ctx, cam, f, t, p);
      break;
    case Fx.Tether:
      tether(ctx, cam, f, t, p, memos, time);
      break;
    case Fx.Glyph:
      glyph(ctx, cam, f, t, p);
      break;
    case Fx.Talisman:
      talisman(ctx, cam, f, t);
      break;
    case Fx.Bolt:
      bolt(ctx, cam, f, t, time);
      break;
    case Fx.Encase:
      encase(ctx, cam, f, t, p, memos);
      break;
    case Fx.Wings:
      wings(ctx, cam, f, t, p);
      break;
    case Fx.Spirit:
      spirit(ctx, cam, f, t, p);
      break;
    case Fx.Moon:
      moon(ctx, cam, f, t, p);
      break;
    default:
      break;
  }
}

// ─────────────────────────── FallingObject ───────────────────────────

/** Height (world units) of a falling object at life fraction t: ease-in from z to the ground. */
function fallHeight(f: Sfx, t: number): number {
  return f.z * (1 - t * t);
}

function fallShadow(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const r = Math.max(0.3, f.r) * (0.25 + 0.75 * t);
  ctx.globalAlpha = 0.4 * t * f.k;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cam.sx(p.x), cam.sy(p.y), r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.fill();
  // a thin ring on the landing spot (where it will hit), tightening as it comes
  ctx.globalAlpha = 0.7 * t * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.light;
  ctx.beginPath();
  const rr = Math.max(0.4, f.r) * (1.6 - 0.6 * t);
  ctx.ellipse(cam.sx(p.x), cam.sy(p.y), rr * PX_PER_UNIT, rr * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
}

function fallObject(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const h = fallHeight(f, t);
  const x = cam.sx(p.x);
  const y = cam.sy(p.y) - h * PX_PER_UNIT_Z;
  const s = Math.max(0.3, f.r) * PX_PER_UNIT;
  // a speed streak above it
  ctx.globalAlpha = 0.35 * f.k;
  ctx.lineWidth = Math.max(4, s * 0.5);
  ctx.strokeStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.4);
  ctx.lineTo(x, y - s * 0.4 - Math.min(160, 30 + h * 18));
  ctx.stroke();
  ctx.globalAlpha = f.k;
  switch (f.n) {
    case FallObj.Shield:
      shieldShape(ctx, x, y, s, f.color, f.light);
      break;
    case FallObj.Cage:
      cageShape(ctx, x, y, s, f.color, f.light);
      break;
    case FallObj.Shell:
      orbShape(ctx, x, y, s * 0.35, '#495057', '#ced4da');
      break;
    case FallObj.Crescent:
      crescentShape(ctx, x, y, s * 0.9, f.light, 0);
      break;
    case FallObj.Bell:
      bellShape(ctx, x, y, s, f.color, f.light);
      break;
    case FallObj.Spear:
      spearShape(ctx, x, y, s, f.light);
      break;
    case FallObj.Arrow:
      giantArrow(ctx, x, y, s, f.color);
      break;
    default:
      orbShape(ctx, x, y, s * 0.55, '#ff9e3d', '#fff3b0');
  }
}

function orbShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, body: string, core: string): void {
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y + r * 0.2, r * 0.5, 0, TAU);
  ctx.fill();
}

/** Tower shield (guardian): a tall rounded slab with a boss and a rim. */
function shieldShape(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, light: string): void {
  const w = s * 0.55;
  const h = s * 0.85;
  ctx.beginPath();
  ctx.moveTo(x - w, y - h);
  ctx.lineTo(x + w, y - h);
  ctx.lineTo(x + w, y + h * 0.35);
  ctx.quadraticCurveTo(x + w, y + h, x, y + h * 1.15);
  ctx.quadraticCurveTo(x - w, y + h, x - w, y + h * 0.35);
  ctx.closePath();
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.6;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.lineWidth = 4;
  ctx.strokeStyle = light;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y - h * 0.2, s * 0.12, 0, TAU);
  ctx.fill();
}

/** Cylindrical cage (warden): a lid ellipse and bars down to a base ellipse. */
function cageShape(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, light: string): void {
  const rx = s;
  const ry = s * GROUND_RATIO;
  const h = s * 1.3;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2b3320';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const bx = x + Math.cos(a) * rx;
    ctx.moveTo(bx, y + Math.sin(a) * ry);
    ctx.lineTo(bx, y + Math.sin(a) * ry - h);
  }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = light;
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - h, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.stroke();
}

const GROUND_RATIO = PX_PER_UNIT_Y / PX_PER_UNIT;

/** Crescent moon (shadow): an outer disc minus an offset disc, outlined. rot = tilt. */
export function crescentShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rot: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, rot + 0.35 * Math.PI, rot + 1.65 * Math.PI, false);
  ctx.arc(x + Math.cos(rot) * -r * 0.45, y + Math.sin(rot) * -r * 0.45, r * 0.82, rot + 1.55 * Math.PI, rot + 0.45 * Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

/** Bell silhouette (cleric). */
function bellShape(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, light: string): void {
  const w = s * 0.55;
  const h = s * 0.8;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.35, y - h);
  ctx.quadraticCurveTo(x, y - h * 1.25, x + w * 0.35, y - h);
  ctx.quadraticCurveTo(x + w * 0.6, y - h * 0.2, x + w, y + h * 0.4);
  ctx.lineTo(x - w, y + h * 0.4);
  ctx.quadraticCurveTo(x - w * 0.6, y - h * 0.2, x - w * 0.35, y - h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = light;
  ctx.stroke();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(x, y + h * 0.55, s * 0.12, 0, TAU);
  ctx.fill();
}

/** Spear of light (paladin): a long white-gold lance pointing down. */
function spearShape(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, light: string): void {
  const L = s * 1.6;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.lineTo(x - s * 0.16, y - s * 0.25);
  ctx.lineTo(x - s * 0.06, y - L);
  ctx.lineTo(x + s * 0.06, y - L);
  ctx.lineTo(x + s * 0.16, y - s * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - s * 0.03, y - L, s * 0.06, L);
}

/** Giant arrow falling point first (ranger sky shot). */
function giantArrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const L = s * 2.2;
  ctx.lineWidth = Math.max(4, s * 0.12);
  ctx.strokeStyle = '#6b4a2b';
  ctx.beginPath();
  ctx.moveTo(x, y - L);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.lineTo(x - s * 0.22, y - s * 0.1);
  ctx.lineTo(x + s * 0.22, y - s * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - L + s * 0.3);
  ctx.lineTo(x - s * 0.25, y - L - s * 0.1);
  ctx.lineTo(x, y - L + s * 0.05);
  ctx.lineTo(x + s * 0.25, y - L - s * 0.1);
  ctx.closePath();
  ctx.fill();
}

// ─────────────────────────── TetherLine ───────────────────────────

const T_A: Pt = { x: 0, y: 0 };
const T_B: Pt = { x: 0, y: 0 };

function tetherEnds(f: Sfx, p: Pt, memos: Map<number, UnitMemo>): void {
  T_A.x = p.x;
  T_A.y = p.y;
  if (f.follow2 >= 0) {
    const m = memos.get(f.follow2);
    if (m) {
      f.x2 = m.x;
      f.y2 = m.y;
    }
  }
  T_B.x = f.x2;
  T_B.y = f.y2;
}

/**
 * A line between two points (or units): a sagging chain of links, a pink thread, a dotted line or an electric arc.
 * It shoots out over the first 15 %, holds (trembling), then breaks in the middle and curls away while it fades.
 */
function tether(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, memos: Map<number, UnitMemo>, time: number): void {
  tetherEnds(f, p, memos);
  const zp = f.z * PX_PER_UNIT_Z;
  const x0 = cam.sx(T_A.x);
  const y0 = cam.sy(T_A.y) - zp;
  const x1 = cam.sx(T_B.x);
  const y1 = cam.sy(T_B.y) - zp;
  const reach = ease(clamp01(t / 0.15));
  const breakAt = 0.8;
  const broken = t > breakAt;
  const gap = broken ? ease((t - breakAt) / (1 - breakAt)) * 0.5 : 0;
  const fade = broken ? 1 - (t - breakAt) / (1 - breakAt) : 1;
  const sag = f.r * PX_PER_UNIT_Z * (broken ? 1 + gap * 2 : 1);
  const tremble = Math.sin(time * 38 + f.seed) * (f.n === TetherStyle.Electric ? 0 : 1.5);
  ctx.globalAlpha = fade * f.k;
  const n = f.n === TetherStyle.Chain ? Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 12)) : 14;
  // two halves when broken (each end keeps its piece)
  for (let half = 0; half < (broken ? 2 : 1); half++) {
    const a0 = broken ? (half === 0 ? 0 : 0.5 + gap) : 0;
    const a1 = broken ? (half === 0 ? 0.5 - gap : 1) : reach;
    if (a1 <= a0) continue;
    if (f.n === TetherStyle.Chain) chainLinks(ctx, f, x0, y0, x1, y1, sag, tremble, a0, a1, n);
    else smoothTether(ctx, f, x0, y0, x1, y1, sag, tremble, a0, a1, n, time);
  }
}

/** Point on the sagging tether at s ∈ [0, 1] (screen px). */
function sagPoint(x0: number, y0: number, x1: number, y1: number, sag: number, wob: number, s: number, out: Pt): Pt {
  out.x = x0 + (x1 - x0) * s;
  out.y = y0 + (y1 - y0) * s + 4 * s * (1 - s) * sag + Math.sin(s * Math.PI) * wob;
  return out;
}

function chainLinks(ctx: CanvasRenderingContext2D, f: Sfx, x0: number, y0: number, x1: number, y1: number, sag: number, wob: number, a0: number, a1: number, n: number): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  for (let i = 0; i <= n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    sagPoint(x0, y0, x1, y1, sag, wob, s, P0);
    ctx.beginPath();
    ctx.ellipse(P0.x, P0.y, 6, i % 2 ? 2.2 : 3.6, ang, 0, TAU);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2b3320';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = i % 2 ? f.light : '#e8f0d0';
    ctx.stroke();
  }
}

function smoothTether(ctx: CanvasRenderingContext2D, f: Sfx, x0: number, y0: number, x1: number, y1: number, sag: number, wob: number, a0: number, a1: number, n: number, time: number): void {
  const electric = f.n === TetherStyle.Electric;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    sagPoint(x0, y0, x1, y1, sag, wob, s, P0);
    let jx = 0;
    let jy = 0;
    if (electric && i > 0 && i < n) {
      const k = Math.floor(time * 24);
      jx = (rnd(f.seed + k, i) - 0.5) * 12;
      jy = (rnd(f.seed + k, i + 50) - 0.5) * 12;
    }
    if (i === 0) ctx.moveTo(P0.x + jx, P0.y + jy);
    else ctx.lineTo(P0.x + jx, P0.y + jy);
  }
  if (f.n === TetherStyle.Dotted) ctx.setLineDash(DOTS);
  ctx.lineWidth = f.w + 3;
  ctx.strokeStyle = electric ? f.color : '#1a0a12';
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * (electric ? 0.45 : 0.6);
  ctx.stroke();
  ctx.globalAlpha = a;
  ctx.lineWidth = f.w;
  ctx.strokeStyle = electric ? '#ffffff' : f.light;
  ctx.stroke();
  if (f.n === TetherStyle.Dotted) ctx.setLineDash(NO_DASH);
}

const DOTS = [4, 7];
const NO_DASH: number[] = [];

// ─────────────────────────── Glyph ───────────────────────────

/** A big glyph popping in (×1.6 → 1), holding, then fading; stamped ones (印) slam down with a ring. */
function glyph(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y) - f.z * PX_PER_UNIT_Z;
  const pop = t < 0.15 ? 1 + 0.6 * (1 - t / 0.15) : 1;
  const a = fadeOut(t, 0.35) * f.k;
  const size = f.r * pop;
  ctx.globalAlpha = a;
  ctx.font = boldFont(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, size * 0.14);
  ctx.strokeStyle = '#120508';
  ctx.strokeText(f.text, sx, sy);
  ctx.fillStyle = f.color;
  ctx.fillText(f.text, sx, sy);
  ctx.textBaseline = 'alphabetic';
}

// ─────────────────────────── Hex panels ───────────────────────────

/**
 * Hexagonal shield panels over a band (rect) or a dome footprint (circle): they light up from the middle outward over
 * the first 30 % (charging), hold, and crack away at the end.
 */
function hexPanels(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const a = f.area;
  const light = ease(clamp01(t / 0.3));
  const fade = fadeOut(t, 0.2);
  const size = 0.55;
  ctx.lineWidth = 3;
  if (a.shape === 'rect') {
    const fr = rectFrame(a, p);
    const cols = Math.max(2, Math.round(fr.len / (size * 1.6)));
    const rows = Math.max(1, Math.round((fr.hw * 2) / (size * 1.5)));
    const vx = -fr.uy;
    const vy = fr.ux;
    for (let c = 0; c < cols; c++) {
      const along = ((c + 0.5) / cols) * fr.len;
      const fromMid = Math.abs(along - fr.len / 2) / (fr.len / 2);
      if (fromMid > light) continue;
      for (let r = 0; r < rows; r++) {
        const across = ((r + 0.5) / rows - 0.5) * fr.hw * 2 + (c % 2 ? size * 0.4 : 0) * (rows > 1 ? 1 : 0);
        const wx = fr.sx + fr.ux * along + vx * across;
        const wy = fr.sy + fr.uy * along + vy * across;
        hexAt(ctx, cam, wx, wy, size, f, fade * (0.55 + 0.45 * (1 - fromMid)), rnd(f.seed, c * 7 + r));
      }
    }
  } else {
    const R = a.shape === 'circle' ? a.radius : 2;
    const rings = Math.max(1, Math.round(R / (size * 1.7)));
    for (let ring = 0; ring <= rings; ring++) {
      const rr = (ring / rings) * R * 0.92;
      if (ring / Math.max(1, rings) > light) continue;
      const n = ring === 0 ? 1 : Math.round(ring * 6);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + ring * 0.3;
        hexAt(ctx, cam, p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr, size, f, fade * (1 - 0.3 * (ring / rings)), rnd(f.seed, ring * 31 + i));
      }
    }
  }
}

function hexAt(ctx: CanvasRenderingContext2D, cam: Camera, wx: number, wy: number, size: number, f: Sfx, a: number, r: number): void {
  const sx = cam.sx(wx);
  const sy = cam.sy(wy);
  const rx = size * PX_PER_UNIT * 0.9;
  const ry = size * PX_PER_UNIT_Y * 0.9;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * TAU + Math.PI / 6;
    const x = sx + Math.cos(ang) * rx;
    const y = sy + Math.sin(ang) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.16 * a * f.k;
  ctx.fillStyle = f.light;
  ctx.fill();
  ctx.globalAlpha = (0.65 + 0.35 * r) * a * f.k;
  ctx.strokeStyle = r > 0.8 ? '#ffffff' : f.light;
  ctx.stroke();
}

// ─────────────────────────── Rune circle ───────────────────────────

/** A magic circle drawn on the ground: two rings drawn in (stroke grows), rune ticks, an inner hexagram, slow spin. */
function runeCircle(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, time: number): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const draw = ease(clamp01(t / 0.25));
  const fade = fadeOut(t, 0.25);
  const rx = f.r * PX_PER_UNIT;
  const ry = f.r * PX_PER_UNIT_Y;
  const spin = time * 0.9 * (f.flip || 1);
  ctx.globalAlpha = 0.85 * fade * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.light;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, spin, spin + TAU * draw);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * 0.78, ry * 0.78, 0, -spin, -spin + TAU * draw);
  ctx.stroke();
  // rune ticks between the rings
  const n = f.n || 12;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.light;
  ctx.beginPath();
  for (let i = 0; i < n * draw; i++) {
    const a = spin + (i / n) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(sx + c * rx * 0.82, sy + s * ry * 0.82);
    ctx.lineTo(sx + c * rx * 0.95, sy + s * ry * 0.95);
  }
  ctx.stroke();
  // hexagram
  if (draw >= 1) {
    ctx.globalAlpha = 0.55 * fade * f.k;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i <= 3; i++) {
        const a = spin * 0.5 + k * (Math.PI / 3) + (i / 3) * TAU;
        const x = sx + Math.cos(a) * rx * 0.76;
        const y = sy + Math.sin(a) * ry * 0.76;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

// ─────────────────────────── Brand ───────────────────────────

/**
 * A footprint burning in from its middle to its tips (outline only, no fill — the enemies inside stay visible), then
 * pulsing faster and faster until it goes (paladin cross, shadow X mark, chrono X crack).
 */
function brand(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, time: number): void {
  const burn = ease(clamp01(t / 0.3));
  const fade = fadeOut(t, 0.15);
  // pulses: 3 over the life, each faster (n = pulse count)
  const k = Math.pow(clamp01(t), 1.6) * (f.n || 3);
  const pulse = 0.5 + 0.5 * Math.cos(k * TAU);
  pathArea(ctx, cam, p, null, f.area, Math.max(0.05, burn));
  ctx.globalAlpha = (0.12 + 0.14 * pulse) * fade * f.k;
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.globalAlpha = (0.6 + 0.4 * pulse) * fade * f.k;
  ctx.lineWidth = 3 + 2 * pulse;
  ctx.strokeStyle = f.light;
  ctx.stroke();
  ctx.globalAlpha = 0.9 * fade * f.k;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  void time;
}

// ─────────────────────────── Staff lines ───────────────────────────

/** Three staff lines run down the band from one end (bard), with a treble clef at its top; they fade at the end. */
function staffLines(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const a = f.area;
  if (a.shape !== 'rect') return;
  const fr = rectFrame(a, p);
  const run = ease(clamp01(t / 0.25));
  const fade = fadeOut(t, 0.3);
  const vx = -fr.uy;
  const vy = fr.ux;
  ctx.globalAlpha = 0.85 * fade * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.light;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const off = i * fr.hw * 0.55;
    ctx.moveTo(cam.sx(fr.sx + vx * off), cam.sy(fr.sy + vy * off));
    ctx.lineTo(cam.sx(fr.sx + vx * off + fr.ux * fr.len * run), cam.sy(fr.sy + vy * off + fr.uy * fr.len * run));
  }
  ctx.stroke();
  // a note glyph at the start of the band (the clef: system fonts rarely have 𝄞)
  ctx.font = boldFont(34);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2a0b30';
  const cx = cam.sx(fr.sx + fr.ux * 0.6);
  const cy = cam.sy(fr.sy + fr.uy * 0.6) - 6;
  ctx.strokeText('♬', cx, cy);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('♬', cx, cy);
  ctx.textBaseline = 'alphabetic';
}

// ─────────────────────────── Talisman ───────────────────────────

/** A yellow paper talisman flying from (x,y) to (x2,y2) over the first 30 %, spinning, then pinned upright. */
function talisman(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
  const fly = ease(clamp01(t / 0.3));
  const wx = f.x + (f.x2 - f.x) * fly;
  const wy = f.y + (f.y2 - f.y) * fly;
  const z = f.z + Math.sin(fly * Math.PI) * 1.2;
  const x = cam.sx(wx);
  const y = cam.sy(wy) - z * PX_PER_UNIT_Z;
  const rot = fly < 1 ? (1 - fly) * 9 * f.flip : Math.sin(t * 20 + f.seed) * 0.05;
  const fade = fadeOut(t, 0.2);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = fade * f.k;
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(-6, -13, 12, 26);
  ctx.strokeStyle = '#a4161a';
  ctx.lineWidth = 2;
  ctx.strokeRect(-6, -13, 12, 26);
  ctx.beginPath();
  ctx.moveTo(-3, -8);
  ctx.lineTo(3, -2);
  ctx.moveTo(3, -8);
  ctx.lineTo(-3, -2);
  ctx.moveTo(0, 1);
  ctx.lineTo(0, 9);
  ctx.stroke();
  ctx.restore();
}

// ─────────────────────────── Lightning ───────────────────────────

/** Electric zig-zag between two points, re-jittered ~20× a second, fading out. */
function bolt(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, time: number): void {
  const zp = f.z * PX_PER_UNIT_Z;
  const x0 = cam.sx(f.x);
  const y0 = cam.sy(f.y) - zp;
  const x1 = cam.sx(f.x2);
  const y1 = cam.sy(f.y2) - zp;
  const n = f.n || 7;
  const k = Math.floor(time * 20);
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const nl = Math.hypot(nx, ny) || 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i < n; i++) {
    const s = i / n;
    const j = (rnd(f.seed + k, i) - 0.5) * 22;
    ctx.lineTo(x0 + (x1 - x0) * s + (nx / nl) * j, y0 + (y1 - y0) * s + (ny / nl) * j);
  }
  ctx.lineTo(x1, y1);
  const fade = 1 - t;
  ctx.globalAlpha = 0.5 * fade * f.k;
  ctx.lineWidth = 7;
  ctx.strokeStyle = f.color;
  ctx.stroke();
  ctx.globalAlpha = fade * f.k;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

// ─────────────────────────── Encase ───────────────────────────

/** An ice crystal (n 0: pale-blue facets) or a grey stone block (n 1) closing around a unit. */
function encase(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, memos: Map<number, UnitMemo>): void {
  const m = f.follow >= 0 ? memos.get(f.follow) : undefined;
  const r = (m ? m.radius : f.r) * PX_PER_UNIT;
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const grow = ease(clamp01(t / 0.2));
  const h = r * 2.6 * grow;
  const w = r * 1.35;
  const ice = f.n === 0;
  ctx.globalAlpha = (ice ? 0.45 : 0.5) * f.k;
  ctx.fillStyle = ice ? '#bfefff' : '#9aa0a6';
  ctx.beginPath();
  ctx.moveTo(sx - w, sy);
  ctx.lineTo(sx - w * 1.1, sy - h * 0.6);
  ctx.lineTo(sx - w * 0.3, sy - h);
  ctx.lineTo(sx + w * 0.5, sy - h * 0.92);
  ctx.lineTo(sx + w * 1.1, sy - h * 0.55);
  ctx.lineTo(sx + w, sy);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.95 * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = ice ? '#e8fbff' : '#e9ecef';
  ctx.stroke();
  // facets
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx - w * 0.3, sy - h);
  ctx.lineTo(sx - w * 0.1, sy - h * 0.3);
  ctx.lineTo(sx + w * 0.5, sy - h * 0.92);
  ctx.moveTo(sx - w * 0.1, sy - h * 0.3);
  ctx.lineTo(sx - w, sy);
  ctx.stroke();
}

// ─────────────────────────── Crosshair ───────────────────────────

/** Red / colour reticle on the ground following a unit, closing in toward the hit (gunner heavy, ranger sky shot). */
function crosshair(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt, time: number): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const close = 1.6 - 0.6 * ease(t);
  const rx = f.r * close * PX_PER_UNIT;
  const ry = f.r * close * PX_PER_UNIT_Y;
  const blink = t > 0.75 ? 0.6 + 0.4 * Math.sin(time * 40) : 1;
  ctx.globalAlpha = 0.95 * blink * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + t * 1.5;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(sx + c * rx * 0.55, sy + s * ry * 0.55);
    ctx.lineTo(sx + c * rx * 1.25, sy + s * ry * 1.25);
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx - 2, sy - 2, 4, 4);
}

// ─────────────────────────── Scorch ───────────────────────────

/** A dark crater (n 0) or ink pool (n 1) on the ground that fades out over its life. */
function scorch(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const grow = ease(clamp01(t / 0.1));
  const a = fadeOut(t, 0.5);
  const rx = f.r * PX_PER_UNIT * grow;
  const ry = f.r * PX_PER_UNIT_Y * grow;
  ctx.globalAlpha = 0.5 * a * f.k;
  ctx.fillStyle = f.n === 1 ? '#14102a' : '#1a0d08';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.6 * a * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.n === 1 ? f.color : '#ff7b00';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * 0.85, ry * 0.85, 0, 0, TAU);
  ctx.stroke();
}

// ─────────────────────────── Wings / Spirit / Moon ───────────────────────────

/** Two wings of light spreading from a unit's back (cleric ult). */
function wings(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y) - f.z * PX_PER_UNIT_Z;
  const open = ease(clamp01(t / 0.3));
  const fade = fadeOut(t, 0.35);
  const span = f.r * PX_PER_UNIT * open;
  ctx.globalAlpha = 0.75 * fade * f.k;
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 0; i < 4; i++) {
      const k = (i + 1) / 4;
      ctx.quadraticCurveTo(sx + side * span * (k - 0.1), sy - span * (0.9 - k * 0.35), sx + side * span * k, sy - span * (0.25 - k * 0.15));
    }
    ctx.quadraticCurveTo(sx + side * span * 0.5, sy + span * 0.15, sx, sy);
    ctx.fillStyle = f.light;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}

/** A pale ghost silhouette floating up and fading (exorcist: the 괴담 leaving an enemy). */
function spirit(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const sx = cam.sx(p.x) + Math.sin(t * 9 + f.seed) * 6;
  const sy = cam.sy(p.y) - (f.z + t * 2.2) * PX_PER_UNIT_Z;
  const a = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * f.k;
  const s = 14;
  ctx.globalAlpha = 0.7 * a;
  ctx.fillStyle = '#f1e9ff';
  ctx.beginPath();
  ctx.arc(sx, sy - s * 0.5, s * 0.6, Math.PI, 0);
  ctx.lineTo(sx + s * 0.6, sy + s * 0.5);
  for (let i = 0; i < 3; i++) ctx.quadraticCurveTo(sx + s * (0.4 - i * 0.4), sy + s * 0.2, sx + s * (0.2 - i * 0.4), sy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = f.color;
  ctx.fillRect(sx - 5, sy - s * 0.6, 3, 4);
  ctx.fillRect(sx + 2, sy - s * 0.6, 3, 4);
}

/** Crescent moon hanging high over a point, growing; through the last 25 % it drops onto the point. */
function moon(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, p: Pt): void {
  const drop = clamp01((t - 0.75) / 0.25);
  const z = f.z * (1 - drop * drop);
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y) - z * PX_PER_UNIT_Z;
  const grow = ease(clamp01(t / 0.4));
  ctx.globalAlpha = 0.35 * grow * f.k;
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.arc(sx, sy, f.r * 1.5 * grow, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = grow * f.k;
  crescentShape(ctx, sx, sy, f.r * grow, f.light, -0.5 + drop * 1.2);
}

// ─────────────────────────── Aim line ───────────────────────────

/** Ranger aim: a thin band edge-lit in the character colour with ››› chevrons marching toward the end. */
function aimLine(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, time: number): void {
  const x0 = cam.sx(f.x);
  const y0 = cam.sy(f.y);
  const x1 = cam.sx(f.x2);
  const y1 = cam.sy(f.y2);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const hw = (f.w * PX_PER_UNIT_Y) / 2;
  const draw = ease(clamp01(t / 0.25));
  const fade = fadeOut(t, 0.15);
  ctx.globalAlpha = 0.85 * fade * f.k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.light;
  ctx.beginPath();
  ctx.moveTo(x0 - uy * hw, y0 + ux * hw);
  ctx.lineTo(x0 - uy * hw + ux * len * draw, y0 + ux * hw + uy * len * draw);
  ctx.moveTo(x0 + uy * hw, y0 - ux * hw);
  ctx.lineTo(x0 + uy * hw + ux * len * draw, y0 - ux * hw + uy * len * draw);
  ctx.stroke();
  // chevrons
  const step = 42;
  const shift = (time * 140) % step;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  for (let d = shift; d < len * draw - 10; d += step) {
    const cx = x0 + ux * d;
    const cy = y0 + uy * d;
    for (let j = 0; j < 3; j++) {
      const o = j * 7;
      ctx.moveTo(cx + ux * o - ux * 6 - uy * 7, cy + uy * o - uy * 6 + ux * 7);
      ctx.lineTo(cx + ux * o, cy + uy * o);
      ctx.lineTo(cx + ux * o - ux * 6 + uy * 7, cy + uy * o - uy * 6 - ux * 7);
    }
  }
  ctx.stroke();
}

/** Unit vectors of a cross / X footprint's two bars (for parts that run along them). */
export function barAxes(a: AreaShape): [Pt, Pt] {
  return crossAxes(a.shape === 'cross' ? a.diagonal : false);
}

// ─────────────────────────── Particles (kinds) ───────────────────────────

/** Particle looks (Vfx.spray): the lingering bits of each character's beats. */
export const enum Pk {
  Square,
  Feather,
  Paper,
  Ink,
  Glass,
  Note,
  Gold,
  Petal,
  Ember,
  Rock,
  Smoke,
}

/**
 * One particle of a kind at screen (x, y), size s px, `spin` = its own rotation phase. Simple paths only (≤ 1 fill);
 * the caller has set globalAlpha.
 */
export function drawParticle(ctx: CanvasRenderingContext2D, kind: Pk, x: number, y: number, s: number, color: string, spin: number): void {
  switch (kind) {
    case Pk.Feather: {
      const c = Math.cos(spin);
      const d = Math.sin(spin);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 1.6, s * 0.55, spin, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - c * s * 1.7, y - d * s * 1.7);
      ctx.lineTo(x + c * s * 1.7, y + d * s * 1.7);
      ctx.stroke();
      return;
    }
    case Pk.Paper:
    case Pk.Petal: {
      ctx.fillStyle = color;
      ctx.beginPath();
      const w = s * (0.6 + 0.4 * Math.abs(Math.cos(spin * 2)));
      if (kind === Pk.Petal) ctx.ellipse(x, y, w, s * 0.5, spin, 0, TAU);
      else {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(spin);
        ctx.rect(-w, -s * 0.7, w * 2, s * 1.4);
        ctx.restore();
      }
      ctx.fill();
      return;
    }
    case Pk.Ink:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.8, 0, TAU);
      ctx.arc(x + s * 0.7, y - s * 0.4, s * 0.4, 0, TAU);
      ctx.fill();
      return;
    case Pk.Glass:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(spin) * s * 1.4, y + Math.sin(spin) * s * 1.4);
      ctx.lineTo(x + Math.cos(spin + 2.3) * s, y + Math.sin(spin + 2.3) * s);
      ctx.lineTo(x + Math.cos(spin + 4) * s * 0.8, y + Math.sin(spin + 4) * s * 0.8);
      ctx.closePath();
      ctx.fill();
      return;
    case Pk.Note:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.75, s * 0.55, -0.4, 0, TAU);
      ctx.fill();
      ctx.fillRect(x + s * 0.5, y - s * 2.2, Math.max(1.5, s * 0.3), s * 2.2);
      return;
    case Pk.Gold:
    case Pk.Ember: {
      // a 4-point sparkle (gold) or a hot dot with a glow (ember)
      if (kind === Pk.Ember) {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.35;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, s * 1.4, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff3b0';
        ctx.fillRect(x - s * 0.4, y - s * 0.4, s * 0.8, s * 0.8);
        return;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.5);
      ctx.lineTo(x + s * 0.35, y - s * 0.35);
      ctx.lineTo(x + s * 1.5, y);
      ctx.lineTo(x + s * 0.35, y + s * 0.35);
      ctx.lineTo(x, y + s * 1.5);
      ctx.lineTo(x - s * 0.35, y + s * 0.35);
      ctx.lineTo(x - s * 1.5, y);
      ctx.lineTo(x - s * 0.35, y - s * 0.35);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case Pk.Rock:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s * 0.3);
      ctx.lineTo(x - s * 0.2, y - s);
      ctx.lineTo(x + s, y - s * 0.4);
      ctx.lineTo(x + s * 0.6, y + s * 0.8);
      ctx.lineTo(x - s * 0.7, y + s * 0.6);
      ctx.closePath();
      ctx.fill();
      return;
    case Pk.Smoke:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
      return;
    default:
      ctx.fillStyle = color;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
}
