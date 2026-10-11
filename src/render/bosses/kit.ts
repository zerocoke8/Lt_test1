// 기획 19차 보스 레이드: the parts every new boss set piece is built from (docs/bosses.md 4장). Pure drawing, nothing
// allocated per call (anchor / lookDir return shared scratch objects — read them at once, never keep them). The classic
// four (classic.ts, boss.ts) keep their own private copies so their pixels never move.
// Rules for a look: read only BossDrawOpts + o.time + hash01 (no Math.random / Date), no gradients, no shadowBlur,
// ≤ 360 canvas calls a frame, ≤ 2 fillText, faces / eyes at screen y 100–230 (the HUD boss box covers x 424–856, y < 100).
// Colours: mix / lighten / darken cache by their amount — pass stepped amounts (0.1, 0.2 …), never a per-frame float.

import { Camera } from '../camera';
import type { BossDrawOpts } from '../boss';
import { darken, lighten, mix, parseColor } from '../color';
import { TAU, addStar, hash01, pathCapsule, pathRoundRect } from '../shapes';

export { TAU, addStar, hash01, pathCapsule, pathRoundRect, mix, lighten, darken };

/** Px the boss set pieces are drawn below their sim position (clear of the HUD boss panel). */
export const BOSS_DROP = 24;

const ANCHOR = { cx: 0, cy: 0, alpha: 1 };
const LOOK = { lx: 0, ly: 0.3 };

/**
 * Base of a set piece: cx = its screen x (with the enrage / phase shakes), cy = its foot line just inside the arena's
 * back edge (≈ screen y 139; rises 260 px as it retreats), alpha = 1 − retreat. Shared object: destructure at once.
 */
export function anchor(cam: Camera, x: number, y: number, o: BossDrawOpts): { cx: number; cy: number; alpha: number } {
  const shakeX = o.shake > 0 ? Math.sin(o.time * 61) * 6 * o.shake : 0;
  const pf = o.phaseFlash > 0 ? Math.sin(o.time * 73) * 5 * o.phaseFlash : 0;
  ANCHOR.cx = cam.sx(x) + shakeX + pf;
  ANCHOR.cy = cam.sy(y) + BOSS_DROP - o.retreat * 260;
  ANCHOR.alpha = 1 - o.retreat;
  return ANCHOR;
}

const PHASE_TINT = parseColor('#ff2050');
const RAGE_TINT = parseColor('#ff0033');
const tintCache = new Map<string, string>();
const toward = (a: number, b: number, t: number): number => a + (b - a) * t;
const hex2 = (v: number): string => Math.round(v).toString(16).padStart(2, '0');

/**
 * Phase tint: later phases lean red (12 % a phase toward #ff2050), enrage on top (30 % toward #ff0033). `color` is hex
 * and so is the result: the colour helpers read hex only, so a look may shade it again (darken(tinted(…))) and the two
 * tints stack on the boss's own colour instead of falling back to grey.
 */
export function tinted(color: string, o: BossDrawOpts): string {
  const p = o.phase > 1 ? Math.floor(o.phase) - 1 : 0;
  if (p === 0 && !o.enraged) return color;
  const key = `${color}|${p}|${o.enraged ? 1 : 0}`;
  let s = tintCache.get(key);
  if (s) return s;
  let [r, g, b] = parseColor(color);
  const pt = Math.min(1, 0.12 * p);
  [r, g, b] = [toward(r, PHASE_TINT[0], pt), toward(g, PHASE_TINT[1], pt), toward(b, PHASE_TINT[2], pt)];
  if (o.enraged) [r, g, b] = [toward(r, RAGE_TINT[0], 0.3), toward(g, RAGE_TINT[1], 0.3), toward(b, RAGE_TINT[2], 0.3)];
  s = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  tintCache.set(key, s);
  return s;
}

/** Unit vector (screen) from (cx, cy) toward the boss's target; straight down-ish without one. Shared object. */
export function lookDir(cam: Camera, cx: number, cy: number, o: BossDrawOpts): { lx: number; ly: number } {
  if (o.lookX === null || o.lookY === null) {
    LOOK.lx = 0;
    LOOK.ly = 0.3;
    return LOOK;
  }
  const tx = cam.sx(o.lookX) - cx;
  const ty = cam.sy(o.lookY) - cy;
  const d = Math.hypot(tx, ty) || 1;
  LOOK.lx = tx / d;
  LOOK.ly = ty / d;
  return LOOK;
}

/** White wash over the shape in the current path (hit flash / phase flash). */
export function wash(ctx: CanvasRenderingContext2D, alpha: number, o: BossDrawOpts): void {
  const k = Math.max(o.flash * 0.4, o.phaseFlash * 0.75);
  if (k <= 0) return;
  ctx.globalAlpha = alpha * k;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = alpha;
}

/** A soft glow from three stacked ellipses (no gradient). Leaves globalAlpha changed — set it again after. */
export function glowEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, a: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.25;
    ctx.globalAlpha = a * (0.35 + i * 0.25);
    ctx.beginPath();
    ctx.ellipse(x, y, rx * k, ry * k, 0, 0, TAU);
    ctx.fill();
  }
}

/** Eyelid 0..1 (1 = open): a quick blink every 2.6–5 s, per seed. */
export function blink(t: number, seed: number): number {
  const period = 2.6 + hash01(seed, 9) * 2.4;
  const ph = (t + seed * 0.77) % period;
  return ph < 0.18 ? Math.abs(ph - 0.09) / 0.09 : 1;
}

/** The watcher's slower blink (never fully shut: ≥ 0.08). */
export function eyeOpen(t: number, seed: number): number {
  const period = 3.7 + seed * 0.9;
  const ph = (t + seed * 1.3) % period;
  if (ph < 0.16) return Math.max(0.08, Math.abs(ph - 0.08) / 0.08);
  return 1;
}

/** A big cat-pupil eye (dark socket, iris looking along lx / ly). open 0..1 squashes it shut. */
export function bigEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lx: number, ly: number, angry: boolean, alpha: number, open = 1): void {
  const ry = r * 0.72 * Math.max(0, open);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#120818';
  ctx.beginPath();
  ctx.ellipse(x, y, r + 3, Math.max(2, ry + 3), 0, 0, TAU);
  ctx.fill();
  if (ry < 2) return;
  ctx.fillStyle = angry ? '#ffd6d6' : '#f6f0d8';
  ctx.beginPath();
  ctx.ellipse(x, y, r, ry, 0, 0, TAU);
  ctx.fill();
  const ir = Math.min(r * 0.5, ry * 0.8);
  const ix = x + lx * r * 0.32;
  const iy = y + ly * ry * 0.28;
  ctx.fillStyle = angry ? '#ff1a1a' : '#ffb000';
  ctx.beginPath();
  ctx.arc(ix, iy, ir, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.22, ir * 0.85, 0, 0, TAU);
  ctx.fill();
}

/** A small round eye: white + a pupil of `color` looking along lx / ly. open 0..1. Uses the current globalAlpha. */
export function smallEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lx: number, ly: number, open: number, color: string): void {
  const ry = r * Math.max(0, open);
  ctx.fillStyle = '#120818';
  ctx.beginPath();
  ctx.ellipse(x, y, r + 2, Math.max(1.5, ry + 2), 0, 0, TAU);
  ctx.fill();
  if (ry < 1.5) return;
  ctx.fillStyle = '#f6f0d8';
  ctx.beginPath();
  ctx.ellipse(x, y, r, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + lx * r * 0.35, y + ly * ry * 0.35, Math.min(r, ry) * 0.5, 0, TAU);
  ctx.fill();
}

/** A dizzy spiral (over a knocked-down eye / screen). One stroke. */
export function dizzySwirl(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, t: number, alpha: number, color = '#3a0c4a'): void {
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let k = 0; k <= 24; k++) {
    const u = k / 24;
    const a = u * TAU * 2 + t * 6;
    const px = x + Math.cos(a) * rx * u;
    const py = y + Math.sin(a) * ry * u;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

/**
 * A long pale hand gripping an edge at (x, y): the palm stays on the far side (side −1 = reaching from the left), four
 * fingers curl over. s = size in px (≈ 14–24). limp 0..1 lets the fingers hang (groggy).
 */
export function hand(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, s: number, t: number, skin = '#e6e1d8', limp = 0): void {
  const ink = '#1d1418';
  const px = x - side * s * 0.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.62;
  ctx.beginPath();
  ctx.moveTo(px - side * s * 1.4, y + s * 0.5);
  ctx.lineTo(px, y);
  ctx.stroke();
  ctx.strokeStyle = skin;
  ctx.lineWidth = s * 0.46;
  ctx.stroke();
  for (let f = 0; f < 4; f++) {
    const fy = y - s * 0.62 + f * s * 0.4;
    const curl = (0.55 + 0.25 * Math.sin(t * 2.6 + f * 0.9)) * (1 - limp) + limp;
    const len = s * (1.15 - Math.abs(f - 1.4) * 0.16);
    const kx = x + side * len * 0.62;
    const ky = fy - s * 0.06;
    const tx = kx + side * len * 0.38 * (1 - curl * 0.5);
    const ty = ky + len * 0.42 * curl;
    ctx.strokeStyle = ink;
    ctx.lineWidth = s * 0.3;
    ctx.beginPath();
    ctx.moveTo(px, fy);
    ctx.lineTo(kx, ky);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.lineWidth = s * 0.19;
    ctx.stroke();
  }
  ctx.fillStyle = skin;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(px, y - s * 0.05, s * 0.36, s * 0.7, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = 'butt';
}

export type HeldItem = 'stamp' | 'paper' | 'mug' | 'phone' | 'pen' | 'folder';

/** A small office prop at a hand (x, y); side = which way it points. */
export function heldItem(ctx: CanvasRenderingContext2D, item: HeldItem, x: number, y: number, side: number, t: number): void {
  switch (item) {
    case 'stamp':
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(x - 4, y - 18, 8, 12);
      ctx.fillStyle = '#c81d3a';
      ctx.fillRect(x - 9, y - 7, 18, 7);
      break;
    case 'paper':
      ctx.fillStyle = '#f3f1ea';
      ctx.fillRect(x - 2 + side * 4, y - 16, 16 * side, 20);
      ctx.fillStyle = '#9aa6b8';
      ctx.fillRect(x + side * 6, y - 11, 9 * side, 1.5);
      ctx.fillRect(x + side * 6, y - 6, 7 * side, 1.5);
      break;
    case 'mug':
      ctx.fillStyle = '#f2efe8';
      ctx.fillRect(x - 6, y - 16, 12, 13);
      ctx.strokeStyle = 'rgba(220,240,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - 18);
      ctx.quadraticCurveTo(x + Math.sin(t * 3) * 4, y - 24, x, y - 30);
      ctx.stroke();
      break;
    case 'phone':
      ctx.strokeStyle = '#1b1b1f';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 6);
      ctx.quadraticCurveTo(x, y - 16, x + 9, y - 6);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    case 'pen':
      ctx.strokeStyle = '#2f6fb0';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + side * 12, y - 16);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    case 'folder':
      ctx.fillStyle = '#e8b04a';
      ctx.fillRect(x - 10, y - 16, 20, 14);
      break;
  }
}

/**
 * The shared mood behind a set piece: a red pulse while enraged, else a pale glow growing with the wind-up (o.charge).
 * Draw it first. Leaves globalAlpha = alpha.
 */
export function enrageHaze(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, o: BossDrawOpts, alpha: number, glow = '#fff3c4'): void {
  if (o.enraged) {
    const p = 0.5 + 0.5 * Math.sin(o.time * 6);
    ctx.globalAlpha = alpha * (0.18 + 0.18 * p);
    ctx.fillStyle = '#ff1f3d';
    ctx.beginPath();
    ctx.ellipse(x, y, rx * (1.05 + 0.06 * p), ry * (1.05 + 0.08 * p), 0, 0, TAU);
    ctx.fill();
  } else if (o.charge > 0) {
    ctx.globalAlpha = alpha * 0.22 * o.charge;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
}

// ─────────────────────────── 기획 19차: new parts ───────────────────────────

const FONTS = new Map<number, string>();
/** Font strings by px size, built once. */
function plaqueFont(px: number): string {
  let f = FONTS.get(px);
  if (!f) {
    f = `900 ${px}px sans-serif`;
    FONTS.set(px, f);
  }
  return f;
}

/**
 * A two-segment limb (arm, cable, claw rail) from (x0, y0) to (x1, y1); the elbow sits `bend` px off the middle
 * (sign = side). Dark outline + coloured core, round caps.
 */
export function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, bend: number, width: number, color: string, outline = '#14101a'): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  const ex = (x0 + x1) / 2 - (dy / d) * bend;
  const ey = (y0 + y1) / 2 + (dx / d) * bend;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(ex, ey);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = outline;
  ctx.lineWidth = width + 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/**
 * A small sign with one line of text (「고장」, 「용지 걸림」, 「휴회」 …), centred on (x, y), tilted by `rot` rad.
 * One fillText — a look may show at most two texts a frame.
 */
export function plaque(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, bg: string, fg: string, alpha: number, rot = 0): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot !== 0) ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = bg;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 3;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = fg;
  ctx.font = plaqueFont(Math.round(h * 0.62));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

/** n drops falling `len` px below a ledge from (x, y) to (x + width, y), each on its own beat (water, coffee, ink). One fill. */
export function dripRow(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, n: number, len: number, t: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const u = (t * (0.5 + hash01(i, 21) * 0.5) + hash01(i, 22)) % 1;
    const dx = x + ((i + 0.5) / n) * width;
    const dy = y + u * u * len;
    const r = 2 + hash01(i, 23) * 2;
    ctx.moveTo(dx + r, dy);
    ctx.ellipse(dx, dy, r, r * 1.6, 0, 0, TAU);
  }
  ctx.fill();
}

/** A row of n triangle teeth along (x, y) → (x + width, y), pointing down (len > 0) or up (len < 0). One fill. */
export function spikes(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, n: number, len: number, color: string): void {
  const step = width / n;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const sx = x + i * step;
    ctx.moveTo(sx, y);
    ctx.lineTo(sx + step / 2, y + len);
    ctx.lineTo(sx + step, y);
  }
  ctx.fill();
}

/** n jagged cracks spreading from (x, y) out to radius r (broken glass, a cracked lens / screen). One stroke. */
export function cracks(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, seed: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash01(i, seed) * 0.9;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a + 0.25) * r * 0.45, y + Math.sin(a + 0.25) * r * 0.45);
    ctx.lineTo(x + Math.cos(a - 0.1) * r * 0.7, y + Math.sin(a - 0.1) * r * 0.7);
    ctx.lineTo(x + Math.cos(a + 0.12) * r, y + Math.sin(a + 0.12) * r);
  }
  ctx.stroke();
  ctx.lineJoin = 'round';
}

/** A leaning pile of n boxes on (x, y) (paper cups, files, film): each w × h, shifted `lean` px per layer. */
export function stack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, color: string, outline: string, lean = 0): void {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = outline;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.rect(x - w / 2 + lean * i + (hash01(i, 31) - 0.5) * 3, y - (i + 1) * h, w, h - 1);
  ctx.fill();
  ctx.stroke();
}

/** A flicker 0 / 1 at `hz` steps a second (screen noise, a failing lamp): on with probability `duty`. Deterministic. */
export function strobe(t: number, hz: number, seed: number, duty = 0.5): number {
  return hash01(Math.floor(t * hz), seed) < duty ? 1 : 0;
}

/** An idle sway angle (rad): amp × sin(speed × t + seed). */
export function swayAngle(t: number, speed: number, amp: number, seed = 0): number {
  return Math.sin(t * speed + seed * 1.7) * amp;
}
