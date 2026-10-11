// 기획 20차 (docs/bosses.md 5-1 · 3장 「예고 덧그림」): the small marks the moving bosses need on the field —
//   · the mark badge over a unit a bound part is tied to (rule N6): a red badge and a ring that runs out with the mark
//   · the X-ray ghost of a character standing behind a boss body: its capsule in the player's colour, so nobody is lost
//   · the telegraph extras of the new part kinds: a rush's flowing chevrons + arrowhead, the violet "it arrives here"
//     ring, the dim veil of a find-the-safe-spot ring (the arena goes dark, the safe circle stays bright)
// Pure drawing; the renderer (render/index.ts) decides when.

import type { Telegraph } from '../../types';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { TAU, drawGroundArrow, drawGroundChevrons, hash01, pathCapsule } from '../shapes';
import type { SafeVeilLook } from './types';

const RED = '#ff3b4d';
const DASH = [10, 7];
const NO_DASH: number[] = [];

/** The badge over a marked unit: head at screen (x, top). `left` = 0..1 of the mark's time still to run. */
export function drawMarkBadge(ctx: CanvasRenderingContext2D, x: number, top: number, left: number, time: number): void {
  const y = top - 26 + Math.sin(time * 8) * 2;
  const urgent = left < 0.3;
  const r = 15;
  ctx.globalAlpha = 1;
  ctx.fillStyle = urgent && Math.sin(time * 30) > 0 ? '#ffffff' : RED;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1a0006';
  ctx.stroke();
  // the eye of the badge: a target mark (no text — it reads at any size)
  ctx.strokeStyle = urgent && Math.sin(time * 30) > 0 ? RED : '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, TAU);
  ctx.moveTo(x - 10, y);
  ctx.lineTo(x - 3, y);
  ctx.moveTo(x + 3, y);
  ctx.lineTo(x + 10, y);
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x, y - 3);
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x, y + 10);
  ctx.stroke();
  // the time ring around it
  const k = Math.max(0, Math.min(1, left));
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1a0006';
  ctx.beginPath();
  ctx.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * k);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffe066';
  ctx.stroke();
}

/** A character hidden behind a boss body, shown through it: its capsule at (fx, fy) in the player's colour. */
export function drawXrayGhost(ctx: CanvasRenderingContext2D, fx: number, fy: number, w: number, h: number, color: string, time: number): void {
  pathCapsule(ctx, fx, fy, w, h);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -time * 20;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  ctx.globalAlpha = 1;
}

/** A rush (Telegraph.motif 'charge'): chevrons flowing from the body to where it will stop, and an arrowhead there. */
export function drawChargeMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, time: number): void {
  const dx = t.center.x - t.origin.x;
  const dy = t.center.y - t.origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const p = t.total > 0 ? 1 - t.remaining / t.total : 1;
  drawGroundChevrons(ctx, cam, t.origin.x, t.origin.y, t.center.x, t.center.y, '#ffffff', 13, 44, time * (1.6 + 2 * p), 0.9);
  const ux = dx / len;
  const uy = dy / len;
  drawGroundArrow(ctx, cam, t.center.x - ux * Math.min(2.2, len * 0.5), t.center.y - uy * Math.min(2.2, len * 0.5), t.center.x, t.center.y, '#ffffff', 7, 26, 1, 0.95);
}

const VIOLET = '#c77dff';

/**
 * A relocate (Telegraph.motif 'arrive'): a violet dashed ring of the body's size closing in on the seat and a faint
 * body silhouette rising there — "the boss comes here", on top of the usual red of what the landing hits.
 */
export function drawArriveMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, bodyRadius: number, bodyW: number, bodyH: number, time: number): void {
  const p = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
  const sx = cam.sx(t.center.x);
  const sy = cam.sy(t.center.y);
  const r = bodyRadius * (1.9 - 0.75 * p);
  ctx.setLineDash(DASH);
  ctx.lineDashOffset = -time * 40;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#1a0a2a';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = VIOLET;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  // the silhouette grows out of the floor as the time runs out
  const hh = bodyH * (0.35 + 0.65 * p);
  ctx.globalAlpha = 0.16 + 0.3 * p;
  ctx.fillStyle = VIOLET;
  ctx.beginPath();
  ctx.ellipse(sx, sy - hh / 2, bodyW * 0.46, hh / 2, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The colours of one veil picture: the dark wash, its tint, the rim's casing and light, the glow in the hole. */
interface VeilInk {
  dark: string;
  darkA: [number, number];
  tint: string;
  tintA: [number, number];
  casing: string;
  rim: string;
  glow: string;
}
const VEIL_PLAIN: VeilInk = { dark: '#12020a', darkA: [0.3, 0.32], tint: RED, tintA: [0.1, 0.16], casing: '#1a0006', rim: '#fff3b0', glow: '#fff3b0' };
const VEILS: Record<SafeVeilLook, VeilInk> = {
  // the pencil blacks the paper out — graphite grey-black, the word stays clean paper
  ink: { dark: '#15151a', darkA: [0.42, 0.4], tint: '#3a3a44', tintA: [0.1, 0.1], casing: '#101014', rim: '#ffd166', glow: '#fffdf2' },
  // the moon: a cold blue shadow over the roof, a disc of pale light
  moon: { dark: '#04102b', darkA: [0.36, 0.34], tint: '#2a5cff', tintA: [0.08, 0.1], casing: '#020a1c', rim: '#e8f6ff', glow: '#cfeaff' },
  // the antenna: thunderclouds, the grounded circle is electric yellow
  storm: { dark: '#0c0a1c', darkA: [0.38, 0.34], tint: '#6f4cff', tintA: [0.06, 0.1], casing: '#0a0814', rim: '#ffe45c', glow: '#fff7b8' },
};

/** The arena minus the hole, as the current path (fill / clip with 'evenodd'). */
function veilPath(ctx: CanvasRenderingContext2D, cam: Camera, sx: number, sy: number, rx: number, ry: number, arenaW: number, arenaH: number): void {
  ctx.beginPath();
  ctx.rect(cam.sx(0), cam.sy(0), arenaW * PX_PER_UNIT, arenaH * PX_PER_UNIT_Y);
  ctx.moveTo(sx + rx, sy);
  ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU, true);
}

/** ink: pencil strokes scribbled across the paper, more of them as the time runs out (one path, clipped to the veil). */
function inkScribble(ctx: CanvasRenderingContext2D, cam: Camera, arenaW: number, arenaH: number, p: number, time: number): void {
  const x0 = cam.sx(0);
  const y0 = cam.sy(0);
  const w = arenaW * PX_PER_UNIT;
  const h = arenaH * PX_PER_UNIT_Y;
  const n = 6 + Math.round(14 * p);
  const step = Math.floor(time * 6);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const y = y0 + h * hash01(i, 7);
    const lean = (hash01(i, 11) - 0.5) * 60 + (hash01(step, i) - 0.5) * 6;
    ctx.moveTo(x0 - 10, y + lean);
    ctx.lineTo(x0 + w * 0.5, y - lean * 0.4);
    ctx.lineTo(x0 + w + 10, y + lean * 0.7);
  }
  ctx.globalAlpha = 0.35 + 0.3 * p;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#0a0a0d';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** storm: three jagged bolts that jump four times a second, and slanting rain (two paths, clipped to the veil). */
function stormBolts(ctx: CanvasRenderingContext2D, cam: Camera, arenaW: number, arenaH: number, p: number, time: number): void {
  const x0 = cam.sx(0);
  const y0 = cam.sy(0);
  const w = arenaW * PX_PER_UNIT;
  const h = arenaH * PX_PER_UNIT_Y;
  ctx.beginPath();
  for (let i = 0; i < 26; i++) {
    const x = x0 + w * hash01(i, 3);
    const y = y0 + ((h * hash01(i, 5) + time * 420) % h);
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + 16);
  }
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#b9c4ff';
  ctx.stroke();
  const step = Math.floor(time * 4);
  ctx.beginPath();
  for (let b = 0; b < 3; b++) {
    let x = x0 + w * (0.08 + 0.84 * hash01(step, b * 13 + 1));
    let y = y0;
    ctx.moveTo(x, y);
    for (let k = 1; k <= 5; k++) {
      x += (hash01(step + k, b * 7 + 2) - 0.5) * 70;
      y = y0 + (h * k) / 5;
      ctx.lineTo(x, y);
    }
  }
  ctx.globalAlpha = (0.35 + 0.5 * p) * (0.5 + 0.5 * Math.sin(time * 31));
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#5a3cff';
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#fff7b8';
  ctx.stroke();
}

/** moon: the light in the hole — three stacked discs (no gradient) and motes turning round the rim. */
function moonLight(ctx: CanvasRenderingContext2D, sx: number, sy: number, rx: number, ry: number, time: number): void {
  ctx.fillStyle = '#dff3ff';
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.28;
    ctx.globalAlpha = 0.1 + 0.03 * Math.sin(time * 3 + i);
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * k, ry * k, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = time * 0.9 + (i * TAU) / 8;
    const px = sx + Math.cos(a) * rx * 1.06;
    const py = sy + Math.sin(a) * ry * 1.06;
    ctx.moveTo(px + 3, py);
    ctx.arc(px, py, 3, 0, TAU);
  }
  ctx.fill();
}

/**
 * Find-the-safe-spot (an enemy ring whose outer edge covers the arena): the arena goes dark and only the hole stays
 * bright, with a pulsing rim — instead of a red fill over the whole screen. 기획 20차 점검: `look` picks the picture
 * (BossLook.veil) — the three rooftop bosses that share this rule no longer share one screen.
 */
export function drawSafeVeil(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, arenaW: number, arenaH: number, time: number, look?: SafeVeilLook): void {
  if (t.area.shape !== 'ring') return;
  const v = look ? VEILS[look] : VEIL_PLAIN;
  const p = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
  const sx = cam.sx(t.center.x);
  const sy = cam.sy(t.center.y);
  const rx = t.area.inner * PX_PER_UNIT;
  const ry = t.area.inner * PX_PER_UNIT_Y;
  veilPath(ctx, cam, sx, sy, rx, ry, arenaW, arenaH);
  ctx.globalAlpha = v.darkA[0] + v.darkA[1] * p;
  ctx.fillStyle = v.dark;
  ctx.fill('evenodd');
  ctx.globalAlpha = v.tintA[0] + v.tintA[1] * p;
  ctx.fillStyle = v.tint;
  ctx.fill('evenodd');
  if (look === 'ink' || look === 'storm') {
    ctx.save();
    veilPath(ctx, cam, sx, sy, rx, ry, arenaW, arenaH);
    ctx.clip('evenodd');
    if (look === 'ink') inkScribble(ctx, cam, arenaW, arenaH, p, time);
    else stormBolts(ctx, cam, arenaW, arenaH, p, time);
    ctx.restore();
  }
  if (look === 'moon') moonLight(ctx, sx, sy, rx, ry, time);
  // the safe rim: bright, breathing, tighter as the time runs out (red flicker in the last moment, whatever the look)
  const urgent = t.remaining < 0.35;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 8;
  ctx.strokeStyle = v.casing;
  ctx.stroke();
  if (look === 'storm') ctx.setLineDash(DASH);
  ctx.lineDashOffset = look === 'storm' ? -time * 60 : 0;
  ctx.lineWidth = 4.5 + 1.5 * Math.sin(time * 9);
  ctx.strokeStyle = urgent && Math.sin(time * 40) > 0 ? RED : v.rim;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  ctx.globalAlpha = 0.12 + 0.08 * Math.sin(time * 5);
  ctx.fillStyle = v.glow;
  ctx.fill();
  ctx.globalAlpha = 1;
}
