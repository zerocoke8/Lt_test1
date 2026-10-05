// 기획 8차 boss set pieces (giant procedural art looming over the arena's back edge, like 심연의 감시자):
// 5층 닫히지 않는 엘리베이터 (huge doors, eyes and hands in the gap, floor display), 10층 야근의 군주 (many-armed office
// specter behind a desk of paper), 15층 수술실 원장 (operating lamp + masked face + scalpels). 20층 심연의 감시자 is in
// boss.ts. Each reads the shared BossDrawOpts (+ phase / phaseFlash): later phases tint harder and add parts.
// The top HUD box (boss HP panel) covers logical y < ~95 between x ≈ 430–850. 기획 8차 리뷰: the set pieces are drawn
// BOSS_DROP px lower than their foot line so the faces/eyes clear it (the 5층 doors read as a dark slit under it).

import { Camera, PX_PER_UNIT } from './camera';
import type { BossDrawOpts } from './boss';
import { darken, lighten, mix } from './look';
import { TAU, hash01, pathRoundRect } from './shapes';

/** Px the boss set pieces are drawn below their sim position (clear of the HUD boss panel). */
export const BOSS_DROP = 24;

/** Base y of a set piece: its foot line just inside the arena's back edge. */
function anchor(cam: Camera, x: number, y: number, o: BossDrawOpts): { cx: number; cy: number; alpha: number } {
  const shakeX = o.shake > 0 ? Math.sin(o.time * 61) * 6 * o.shake : 0;
  const pf = o.phaseFlash > 0 ? Math.sin(o.time * 73) * 5 * o.phaseFlash : 0;
  return { cx: cam.sx(x) + shakeX + pf, cy: cam.sy(y) + BOSS_DROP - o.retreat * 260, alpha: 1 - o.retreat };
}

/** Phase tint: later phases lean red (enrage on top). */
function tinted(color: string, o: BossDrawOpts): string {
  let c = color;
  if (o.phase > 1) c = mix(c, '#ff2050', 0.12 * (o.phase - 1));
  if (o.enraged) c = mix(c, '#ff0033', 0.3);
  return c;
}

function lookDir(cam: Camera, cx: number, cy: number, o: BossDrawOpts): { lx: number; ly: number } {
  if (o.lookX === null || o.lookY === null) return { lx: 0, ly: 0.3 };
  const tx = cam.sx(o.lookX) - cx;
  const ty = cam.sy(o.lookY) - cy;
  const d = Math.hypot(tx, ty) || 1;
  return { lx: tx / d, ly: ty / d };
}

/** White wash over a shape already in the current path (hit flash / phase flash). */
function wash(ctx: CanvasRenderingContext2D, alpha: number, o: BossDrawOpts): void {
  const k = Math.max(o.flash * 0.4, o.phaseFlash * 0.75);
  if (k <= 0) return;
  ctx.globalAlpha = alpha * k;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = alpha;
}

function glowEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, a: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.25;
    ctx.globalAlpha = a * (0.35 + i * 0.25);
    ctx.beginPath();
    ctx.ellipse(x, y, rx * k, ry * k, 0, 0, TAU);
    ctx.fill();
  }
}

// ─────────────────────────── 5층: 닫히지 않는 엘리베이터 ───────────────────────────

export function drawElevatorKeeper(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  if (alpha <= 0) return;
  const t = o.time;
  const W = radius * PX_PER_UNIT * 1.25; // half width of the frame
  const bottom = cy + 92;
  const top = cy - 260;
  const steel = tinted('#8a929c', o);
  ctx.globalAlpha = alpha;
  // the doors never quite close: they twitch, open on attacks, and gape in phase 2
  const want = 0.2 + 0.32 * o.charge + (o.phase >= 2 ? 0.18 : 0) + (o.enraged ? 0.08 : 0);
  const gap = W * 2 * 0.82 * Math.min(0.85, want + 0.02 * Math.sin(t * 9) * (o.phase >= 2 ? 3 : 1));
  const inner = W * 0.86;
  // shaft: darkness with light spilling onto the floor
  ctx.fillStyle = '#050407';
  ctx.fillRect(cx - inner, top, inner * 2, bottom - top);
  const spill = o.phase >= 2 ? '#ff2a3d' : '#ffd36b';
  ctx.globalAlpha = alpha * (0.1 + 0.08 * o.charge);
  ctx.fillStyle = spill;
  ctx.beginPath();
  ctx.moveTo(cx - gap / 2, bottom);
  ctx.lineTo(cx + gap / 2, bottom);
  ctx.lineTo(cx + gap * 1.1, bottom + 120);
  ctx.lineTo(cx - gap * 1.1, bottom + 120);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha;
  // what lives in the gap: a swarm of eyes (looking at the target) + one huge eye when it opens wide
  const { lx, ly } = lookDir(cam, cx, cy, o);
  if (gap > 6) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - gap / 2, top, gap, bottom - top);
    ctx.clip();
    if (o.phase >= 2) {
      // emergency light strobing inside
      ctx.globalAlpha = alpha * (0.18 + 0.12 * Math.max(0, Math.sin(t * 7)));
      ctx.fillStyle = '#ff1f3d';
      ctx.fillRect(cx - gap / 2, top, gap, bottom - top);
      ctx.globalAlpha = alpha;
    }
    for (let i = 0; i < 14; i++) {
      const ex = cx + (hash01(i, 1) - 0.5) * W * 1.6;
      const ey = cy - 40 + hash01(i, 2) * 120;
      const open = blink(t, i);
      if (open < 0.2) continue;
      const r = 3 + hash01(i, 3) * 4;
      ctx.fillStyle = i % 4 === 0 ? '#ff5d5d' : '#ffe9a8';
      ctx.beginPath();
      ctx.ellipse(ex - r * 1.1 + lx * 1.5, ey + ly, r * 0.7, r * 0.55 * open, 0, 0, TAU);
      ctx.ellipse(ex + r * 1.1 + lx * 1.5, ey + ly, r * 0.7, r * 0.55 * open, 0, 0, TAU);
      ctx.fill();
    }
    if (gap > W * 0.45) {
      const er = Math.min(gap * 0.32, 46);
      bigEyeAt(ctx, cx, cy + 52, er, lx, ly, o.phase >= 2 || o.enraged, alpha);
    }
    ctx.restore();
  }
  // door panels (brushed steel) with dents
  const doors: [number, number][] = [
    [cx - inner, cx - gap / 2],
    [cx + gap / 2, cx + inner],
  ];
  const g = ctx.createLinearGradient(cx - inner, 0, cx + inner, 0);
  g.addColorStop(0, darken(steel, 0.15));
  g.addColorStop(0.5, lighten(steel, 0.18));
  g.addColorStop(1, darken(steel, 0.2));
  for (const [a, b] of doors) {
    if (b - a < 1) continue;
    ctx.beginPath();
    ctx.rect(a, top, b - a, bottom - top);
    ctx.fillStyle = g;
    ctx.fill();
    wash(ctx, alpha, o);
    ctx.strokeStyle = darken(steel, 0.55);
    ctx.lineWidth = 2;
    ctx.strokeRect(a, top, b - a, bottom - top);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    for (let k = 1; k < 5; k++) {
      ctx.moveTo(a + ((b - a) * k) / 5, top);
      ctx.lineTo(a + ((b - a) * k) / 5, bottom);
    }
    ctx.stroke();
  }
  // the gap's edges glow (warm, red in phase 2)
  if (gap > 4) {
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = o.phase >= 2 ? '#ff3b4d' : '#ffb36b';
    ctx.fillRect(cx - gap / 2 - 3, top, 3, bottom - top);
    ctx.fillRect(cx + gap / 2, top, 3, bottom - top);
    ctx.globalAlpha = alpha;
  }
  // hands gripping the door edges, pulling them open (more of them in phase 2)
  const hands = o.phase >= 2 ? 4 : 2;
  for (let i = 0; i < hands; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const hy = cy + 22 + (i >> 1) * 44 + (side > 0 ? 14 : 0) + Math.sin(t * 2.3 + i) * 4;
    const hx = cx + side * (gap / 2);
    drawHand(ctx, hx, hy, side, 24 - (i >> 1) * 3, t + i, o);
  }
  // frame + sill
  ctx.fillStyle = darken(steel, 0.45);
  ctx.fillRect(cx - W - 18, top, 18 + (W - inner), bottom - top + 6);
  ctx.fillRect(cx + inner, top, 18 + (W - inner), bottom - top + 6);
  ctx.fillStyle = darken(steel, 0.25);
  ctx.fillRect(cx - W - 22, bottom - 6, (W + 22) * 2, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let k = -10; k <= 10; k++) ctx.fillRect(cx + k * (W / 10), bottom - 3, 2, 6);
  // floor display on the left post (falling numbers), call buttons on the right post
  const dx = cx - W - 8;
  const dy = cy + 6;
  pathRoundRect(ctx, dx - 44, dy - 20, 62, 40, 6);
  ctx.fillStyle = '#0b0b0e';
  ctx.fill();
  ctx.strokeStyle = '#6f7680';
  ctx.lineWidth = 2;
  ctx.stroke();
  const speed = o.phase >= 2 ? 6 : 1.4;
  const fl = 13 - Math.floor(t * speed) % 18;
  ctx.fillStyle = o.phase >= 2 ? '#ff3b3b' : '#ff7a4d';
  ctx.font = '900 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fl > 0 ? `${fl}` : `B${1 - fl}`, dx - 13, dy + 1);
  ctx.font = '900 13px monospace';
  ctx.fillText('▼', dx - 13, dy - 14 < top ? dy : dy - 13);
  const bx = cx + W + 8;
  for (let k = 0; k < 2; k++) {
    const by = cy + 2 + k * 26;
    const lit = k === 1 || Math.sin(t * 4) > 0;
    ctx.fillStyle = '#2b2e33';
    ctx.beginPath();
    ctx.arc(bx, by, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lit ? '#ffd166' : '#5a4a20';
    ctx.font = '900 12px sans-serif';
    ctx.fillText(k === 0 ? '▲' : '▼', bx, by + 1);
  }
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.12 + 0.12 * Math.max(0, Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.fillRect(cx - W - 22, top, (W + 22) * 2, bottom - top);
  }
  ctx.globalAlpha = 1;
}

function blink(t: number, seed: number): number {
  const period = 2.6 + hash01(seed, 9) * 2.4;
  const ph = (t + seed * 0.77) % period;
  return ph < 0.18 ? Math.abs(ph - 0.09) / 0.09 : 1;
}

/**
 * A long pale hand from the gap gripping a door edge (side −1 = the left door's edge): the palm stays in the dark gap,
 * the fingers curl over the door panel.
 */
function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, s: number, t: number, o: BossDrawOpts): void {
  const skin = o.phase >= 2 ? '#ead0d0' : '#e6e1d8';
  const ink = '#1d1418';
  const px = x - side * s * 0.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // wrist back into the dark
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
    const curl = 0.55 + 0.25 * Math.sin(t * 2.6 + f * 0.9);
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
    ctx.fillStyle = '#5b4148';
    ctx.beginPath();
    ctx.arc(tx, ty, s * 0.07, 0, TAU);
    ctx.fill();
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

function bigEyeAt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lx: number, ly: number, angry: boolean, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#120818';
  ctx.beginPath();
  ctx.ellipse(x, y, r + 3, r * 0.72 + 3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = angry ? '#ffd6d6' : '#f6f0d8';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.72, 0, 0, TAU);
  ctx.fill();
  const ir = r * 0.5;
  const ix = x + lx * r * 0.32;
  const iy = y + ly * r * 0.2;
  ctx.fillStyle = angry ? '#ff1a1a' : '#ffb000';
  ctx.beginPath();
  ctx.arc(ix, iy, ir, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.22, ir * 0.85, 0, 0, TAU);
  ctx.fill();
}

// ─────────────────────────── 10층: 야근의 군주 ───────────────────────────

/** What each of the lord's hands holds. */
const HELD = ['stamp', 'paper', 'mug', 'phone', 'pen', 'folder', 'stamp', 'paper'] as const;

export function drawOvertimeLord(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  if (alpha <= 0) return;
  const t = o.time;
  const R = radius * PX_PER_UNIT;
  const suit = tinted('#24324d', o);
  const skin = o.phase >= 2 ? '#c9d8e8' : '#d8e4ee';
  const speed = o.phase >= 2 || o.enraged ? 2.4 : 1.4;
  ctx.globalAlpha = alpha;
  // aura of cold monitor light
  glowEllipse(ctx, cx, cy - 10, R * 1.3, R * 0.75, o.phase >= 2 ? '#ff5d73' : '#5aa9ff', alpha * (0.12 + 0.1 * o.charge));
  ctx.globalAlpha = alpha;
  // arms behind the body: 3–4 per side fanning out, each holding office junk
  const n = o.phase >= 2 ? 4 : 3;
  const sh = { x: cx, y: cy + 30 };
  ctx.lineCap = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < n; i++) {
      const k = i / Math.max(1, n - 1);
      const base = -0.15 - k * 1.05 + Math.sin(t * speed + i * 1.3 + side) * 0.12 - o.charge * 0.25;
      const a1 = side < 0 ? Math.PI - base : base;
      const len1 = R * (0.75 + 0.1 * k);
      const ex = sh.x + side * R * 0.45 + Math.cos(a1) * len1;
      const ey = sh.y + Math.sin(a1) * len1 * 0.8;
      const a2 = a1 + side * (0.6 + 0.25 * Math.sin(t * speed * 1.3 + i));
      const hx = ex + Math.cos(a2) * len1 * 0.7;
      const hy = ey + Math.sin(a2) * len1 * 0.55;
      ctx.strokeStyle = darken(suit, 0.3);
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(sh.x + side * R * 0.45, sh.y);
      ctx.lineTo(ex, ey);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.strokeStyle = suit;
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.strokeStyle = '#f2f4f7';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(hx - Math.cos(a2) * 9, hy - Math.sin(a2) * 7);
      ctx.lineTo(hx - Math.cos(a2) * 4, hy - Math.sin(a2) * 3);
      ctx.stroke();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(hx, hy, 7.5, 0, TAU);
      ctx.fill();
      heldItem(ctx, HELD[(i + (side > 0 ? 3 : 0)) % HELD.length], hx, hy, side, t + i);
    }
  }
  ctx.lineCap = 'butt';
  // torso: slumped suit, white shirt, loose tie
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.62, cy + 95);
  ctx.quadraticCurveTo(cx - R * 0.7, cy + 30, cx - R * 0.32, cy + 22);
  ctx.lineTo(cx + R * 0.32, cy + 22);
  ctx.quadraticCurveTo(cx + R * 0.7, cy + 30, cx + R * 0.62, cy + 95);
  ctx.closePath();
  ctx.fillStyle = suit;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.fillStyle = '#eef2f6';
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.18, cy + 24);
  ctx.lineTo(cx, cy + 70);
  ctx.lineTo(cx + R * 0.18, cy + 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = o.phase >= 2 ? '#c81d3a' : '#2f6fb0';
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + 32);
  ctx.lineTo(cx + 6, cy + 32);
  ctx.lineTo(cx + 12 + Math.sin(t * 2) * 3, cy + 78);
  ctx.lineTo(cx + 1 + Math.sin(t * 2) * 3, cy + 84);
  ctx.closePath();
  ctx.fill();
  // head: long pale face, eye bags, glowing eyes that follow the target, messy hair
  const hx = cx;
  const hy = cy + 8 + Math.sin(t * 1.2) * 3;
  const hr = R * 0.36;
  const { lx, ly } = lookDir(cam, hx, hy, o);
  ctx.fillStyle = '#141820';
  ctx.beginPath();
  ctx.ellipse(hx, hy - hr * 0.55, hr * 1.12, hr * 0.85, 0, Math.PI, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 0.9, hr * 1.12, 0, 0, TAU);
  ctx.fillStyle = skin;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = '#141820';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#141820';
  for (let i = 0; i < 7; i++) {
    const ax = hx - hr * 0.9 + (i / 6) * hr * 1.8;
    ctx.beginPath();
    ctx.moveTo(ax - 8, hy - hr * 0.7);
    ctx.lineTo(ax + (hash01(i, 5) - 0.5) * 14, hy - hr * (0.3 + hash01(i, 6) * 0.3));
    ctx.lineTo(ax + 8, hy - hr * 0.7);
    ctx.closePath();
    ctx.fill();
  }
  const eyeCol = o.phase >= 2 || o.enraged ? '#ff4d6d' : '#7fe3ff';
  for (const k of [-1, 1]) {
    const ex = hx + k * hr * 0.38;
    const ey = hy + hr * 0.02;
    ctx.fillStyle = '#5b4a7a';
    ctx.beginPath();
    ctx.ellipse(ex, ey + hr * 0.2, hr * 0.27, hr * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b0e14';
    ctx.beginPath();
    ctx.ellipse(ex, ey, hr * 0.22, hr * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.arc(ex + lx * hr * 0.08, ey + ly * hr * 0.05, hr * (0.08 + 0.03 * o.charge), 0, TAU);
    ctx.fill();
  }
  // sigh: an open mouth
  ctx.fillStyle = '#0b0e14';
  ctx.beginPath();
  ctx.ellipse(hx, hy + hr * 0.6, hr * (0.16 + 0.1 * o.charge), hr * (0.1 + 0.12 * o.charge), 0, 0, TAU);
  ctx.fill();
  // the desk + paper towers in front
  const dTop = cy + 70;
  ctx.fillStyle = '#4a3527';
  ctx.fillRect(cx - R * 1.05, dTop, R * 2.1, 26);
  ctx.fillStyle = '#5e4433';
  ctx.fillRect(cx - R * 1.1, dTop - 6, R * 2.2, 8);
  for (const side of [-1, 1]) {
    for (let s = 0; s < 3; s++) {
      const px = cx + side * R * (0.55 + s * 0.17);
      const ph = 26 + hash01(s, side + 3) * 30 + (o.phase >= 2 ? 16 : 0);
      for (let k = 0; k < ph; k += 4) {
        ctx.fillStyle = k % 8 === 0 ? '#f3f1ea' : '#dcd8cc';
        ctx.fillRect(px - 16 + Math.sin(k + s) * 1.5, dTop - 6 - k - 4, 32, 4);
      }
    }
  }
  // papers whirling around
  const nP = o.phase >= 2 ? 16 : 10;
  for (let i = 0; i < nP; i++) {
    const a = t * (0.6 + hash01(i, 7) * 0.5) * (i % 2 ? 1 : -1) + i * 1.7;
    const rr = R * (0.95 + hash01(i, 8) * 0.55);
    const px = cx + Math.cos(a) * rr;
    const py = cy + 10 + Math.sin(a) * rr * 0.35;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a * 2);
    ctx.fillStyle = '#f3f1ea';
    ctx.fillRect(-7, -9, 14, 18);
    ctx.fillStyle = '#9aa6b8';
    ctx.fillRect(-4, -5, 8, 1.5);
    ctx.fillRect(-4, -1, 6, 1.5);
    ctx.restore();
  }
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.12 + 0.1 * Math.max(0, Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 30, R * 1.2, R * 0.8, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function heldItem(ctx: CanvasRenderingContext2D, item: (typeof HELD)[number], x: number, y: number, side: number, t: number): void {
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
      break;
    case 'pen':
      ctx.strokeStyle = '#2f6fb0';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + side * 12, y - 16);
      ctx.stroke();
      break;
    case 'folder':
      ctx.fillStyle = '#e8b04a';
      ctx.fillRect(x - 10, y - 16, 20, 14);
      break;
  }
}

// ─────────────────────────── 15층: 수술실 원장 ───────────────────────────

export function drawSurgeonDirector(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  if (alpha <= 0) return;
  const t = o.time;
  const R = radius * PX_PER_UNIT;
  const gown = tinted('#2f8f78', o);
  const red = o.phase >= 2 || o.enraged;
  ctx.globalAlpha = alpha;
  // the operating lamp (upper left, clear of the HUD box) and its light cone onto the target
  const lampX = cx - R * 1.42;
  const lampY = cy - 42;
  const { lx, ly } = lookDir(cam, lampX, lampY, o);
  const tx = o.lookX !== null ? cam.sx(o.lookX) : cx;
  const ty = o.lookY !== null ? cam.sy(o.lookY) : cy + 200;
  const flick = o.phase >= 3 ? (Math.sin(t * 37) > -0.2 ? 1 : 0.35) : 1;
  const lightCol = red ? '#ff6b6b' : '#e6fbff';
  ctx.globalAlpha = alpha * 0.1 * flick * (1 + o.charge);
  ctx.fillStyle = lightCol;
  ctx.beginPath();
  ctx.moveTo(lampX - 30, lampY + 10);
  ctx.lineTo(tx - 70, ty);
  ctx.lineTo(tx + 70, ty);
  ctx.lineTo(lampX + 30, lampY + 10);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha * 0.16 * flick;
  ctx.beginPath();
  ctx.ellipse(tx, ty, 74, 30, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;
  // lamp arm
  ctx.strokeStyle = '#59636d';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(lampX + 60, cy - 160);
  ctx.lineTo(lampX + 40, lampY - 40);
  ctx.lineTo(lampX, lampY);
  ctx.stroke();
  ctx.fillStyle = '#c9d2d9';
  ctx.beginPath();
  ctx.ellipse(lampX, lampY, 58, 36, -0.15 + lx * 0.1, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#59636d';
  ctx.lineWidth = 3;
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    const bx = lampX + (i === 6 ? 0 : Math.cos(a) * 32) + lx * 3;
    const by = lampY + (i === 6 ? 0 : Math.sin(a) * 19) + ly * 2;
    ctx.globalAlpha = alpha * flick;
    ctx.fillStyle = lightCol;
    ctx.beginPath();
    ctx.arc(bx, by, 9, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // extra arms in the last phase (thin, many-jointed, holding scalpels)
  const arms = o.phase >= 3 ? 3 : o.phase >= 2 ? 2 : 1;
  ctx.lineCap = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < arms; i++) {
      const k = i / 3;
      const sx0 = cx + side * R * 0.55;
      const sy0 = cy + 40 + i * 8;
      const reach = R * (0.9 + 0.25 * k) + o.charge * 20;
      const a = side < 0 ? Math.PI - (0.15 + k * 0.7 + Math.sin(t * 2 + i) * 0.1) : 0.15 + k * 0.7 + Math.sin(t * 2 + i + 1) * 0.1;
      const mx = sx0 + Math.cos(a) * reach * 0.6;
      const my = sy0 - Math.abs(Math.sin(a)) * reach * 0.35 - 10;
      const hx = mx + side * reach * 0.45;
      const hy = my + 34 + Math.sin(t * 3 + i) * 6;
      ctx.strokeStyle = darken(gown, 0.35);
      ctx.lineWidth = i === 0 ? 18 : 9;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(mx, my);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.strokeStyle = i === 0 ? gown : '#cfe9e0';
      ctx.lineWidth = i === 0 ? 13 : 5;
      ctx.stroke();
      // gloved hand + scalpel pointing down at the arena
      ctx.fillStyle = '#9fd8e8';
      ctx.beginPath();
      ctx.arc(hx, hy, i === 0 ? 8 : 5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#e9eef5';
      ctx.lineWidth = i === 0 ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + side * 4, hy + (i === 0 ? 28 : 20));
      ctx.stroke();
      ctx.strokeStyle = '#59636d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy - 6);
      ctx.lineTo(hx, hy + 4);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
  // gowned shoulders
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.78, cy + 100);
  ctx.quadraticCurveTo(cx - R * 0.82, cy + 34, cx - R * 0.3, cy + 26);
  ctx.lineTo(cx + R * 0.3, cy + 26);
  ctx.quadraticCurveTo(cx + R * 0.82, cy + 34, cx + R * 0.78, cy + 100);
  ctx.closePath();
  ctx.fillStyle = gown;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = darken(gown, 0.4);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 30);
  ctx.lineTo(cx, cy + 100);
  ctx.moveTo(cx - R * 0.3, cy + 26);
  ctx.lineTo(cx - R * 0.12, cy + 58);
  ctx.moveTo(cx + R * 0.3, cy + 26);
  ctx.lineTo(cx + R * 0.12, cy + 58);
  ctx.stroke();
  // head: cap, round glasses with glare, mask
  const hx = cx;
  const hy = cy + 12 + Math.sin(t * 1.1) * 2;
  const hr = R * 0.34;
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 0.92, hr * 1.06, 0, 0, TAU);
  ctx.fillStyle = '#e7d9cf';
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = '#1d2a28';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = gown;
  ctx.beginPath();
  ctx.ellipse(hx, hy - hr * 0.55, hr * 1.02, hr * 0.68, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(hx - hr * 1.02, hy - hr * 0.6, hr * 2.04, hr * 0.22);
  ctx.fillStyle = '#bfe7ef';
  pathRoundRect(ctx, hx - hr * 0.85, hy + hr * 0.12, hr * 1.7, hr * 0.85, hr * 0.3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,80,90,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.7, hy + hr * 0.42);
  ctx.lineTo(hx + hr * 0.7, hy + hr * 0.42);
  ctx.moveTo(hx - hr * 0.7, hy + hr * 0.64);
  ctx.lineTo(hx + hr * 0.7, hy + hr * 0.64);
  ctx.stroke();
  for (const k of [-1, 1]) {
    const gx = hx + k * hr * 0.4;
    const gy = hy - hr * 0.12;
    ctx.fillStyle = '#0d1514';
    ctx.beginPath();
    ctx.arc(gx, gy, hr * 0.27, 0, TAU);
    ctx.fill();
    ctx.fillStyle = red ? '#ff4d4d' : '#9cf7ff';
    ctx.beginPath();
    ctx.ellipse(gx + lx * hr * 0.08, gy + ly * hr * 0.05, hr * 0.08, hr * (0.05 + 0.04 * o.charge), 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#c9d2d9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(gx, gy, hr * 0.29, 0, TAU);
    ctx.stroke();
    // glare from the lamp
    ctx.globalAlpha = alpha * 0.55 * flick;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(gx - hr * 0.2, gy - hr * 0.05);
    ctx.lineTo(gx - hr * 0.05, gy - hr * 0.22);
    ctx.lineTo(gx + hr * 0.02, gy - hr * 0.16);
    ctx.lineTo(gx - hr * 0.14, gy + hr * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.12 + 0.1 * Math.max(0, Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 30, R * 1.0, R * 0.7, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
