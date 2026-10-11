// 기획 19차 보스 레이드 — 폐병동 boss looks (docs/bosses.md 4장). This zone's track owns this file.
//   morgue_drawers 번호 없는 서랍       가로형: a steel wall of drawers, the wide unnumbered one ajar (two eyes, frost, a toe tag)
//   xray_machine   투시 촬영기          매달린형: a ceiling arm with a C bracket around one black lens (the crosshair is its pupil), a film viewer
//   defibrillator  멈추지 않는 제세동기  탑형: a yellow box with a green ECG face, two paddles on cables for arms
//   empty_beds     빈 병상 행렬         가로형: five iron beds, sheets hanging like curtains; the middle sheet sits up, stains for a face
// No summon-only units in this zone (링거 환자 / 간호 인형 are existing monsters). Warning motifs: eb_lineup pull,
// eb_disinfect linger, md_wake / xr_dolls spawn (a motif only shows on a part with a delay — the summons are instant
// today, so those two rows wait for a warning).
//
// Art rules: read only BossDrawOpts + o.time + hash01 (no Math.random / Date); faces and eyes at screen y 100–230 (the HUD
// boss box covers x 424–856, y < 100); ≤ 360 canvas calls a frame, ≤ 2 fillText, no gradients, no shadowBlur, nothing
// allocated per frame; safe for o.phase 1–3; mix / lighten / darken only with stepped amounts (they cache by amount).
// Poses: idle = sin(o.time) · wind-up = o.charge · attack = o.flash · knocked down = o.groggy · phase 2+ = o.phase >= 2.
// Checks: npx vitest run tests/render/boss-looks.test.ts (every registered look, 15 poses × 30 frames).
// See it: npx vite, then /tests/visual/render-sandbox.html?scene=zoo&boss=<id>&pose=idle|windup|groggy|enraged&phase=2
//         (bench=boss:<id> → window.__sandbox.bench ms/frame); all 20 on one picture: node tests/visual/boss-sheet.mjs

import { Camera, PX_PER_UNIT } from '../camera';
import { TAU, anchor, bigEye, blink, cracks, dripRow, enrageHaze, glowEllipse, hash01, lighten, limb, lookDir, mix, pathRoundRect, plaque, spikes, strobe, swayAngle, wash } from './kit';
import type { BossDrawOpts, BossLook, CreatureDrawFn, TeleMotif } from './types';

const INK = '#14101a';
const RED = '#ff3b3b';

// The colour helpers read hex only: mixing a colour that was already mixed (darken(tinted(…)), or the phase tint and
// then the enrage tint) falls back to grey — a yellow box went dusty pink with a grey base once enraged in phase 2.
// So this file shades from hex constants and tints once: the phase tint (12 % a phase toward #ff2050) and the enrage
// tint (30 % toward #ff0033) folded into one mix, by o.phase − 1.
const PHASE_TINT = '#ff2050';
const RAGE_TINT = ['#ff0033', '#ff0739', '#ff0b3d'];
const RAGE_AMOUNT = [0.3, 0.384, 0.468];

/** `hex` with the phase and enrage tints of the kit's tinted(), in one mix (a stepped amount: cached). */
function tint(hex: string, o: BossDrawOpts): string {
  const p = Math.max(0, Math.min(2, Math.floor(o.phase) - 1));
  if (o.enraged) return mix(hex, RAGE_TINT[p], RAGE_AMOUNT[p]);
  return p > 0 ? mix(hex, PHASE_TINT, 0.12 * p) : hex;
}

// ─────────────────────────── 번호 없는 서랍 ───────────────────────────

const MD_BASE = '#8d99ae';
/** The cabinet wall and its top edge: the steel 60 % / 30 % darker. */
const MD_WALL = '#383d46';
const MD_EDGE = '#636b7a';
const MD_FROST = '#48cae4';
const MD_LIGHT = '#edf2f4';
const MD_W = 132;
const MD_H = 62;
const MD_GAP = 6;
const MD_LEFT = (4 * MD_W + 3 * MD_GAP) / 2;
/** [column, row, columns wide]: four on top; below, one each side of the wide unnumbered drawer (the last entry). */
const MD_CELLS: readonly (readonly [number, number, number])[] = [[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1], [0, 1, 1], [3, 1, 1], [1, 1, 2]];
const MD_BLANK = 6;

const mdX = (cx: number, i: number): number => cx - MD_LEFT + MD_CELLS[i][0] * (MD_W + MD_GAP);
const mdY = (cy: number, i: number): number => cy - 40 + MD_CELLS[i][1] * (MD_H + MD_GAP);
const mdW = (i: number): number => MD_CELLS[i][2] * (MD_W + MD_GAP) - MD_GAP;
const mdH = (i: number): number => (i === MD_BLANK ? 46 : MD_H);

/** 1 for the drawers that open in the attack: the wall side (왼쪽 서랍; both walls from phase 2). */
function mdLead(i: number, o: BossDrawOpts): number {
  const col = MD_CELLS[i][0];
  return i !== MD_BLANK && (col === 0 || (col === 3 && o.phase >= 2)) ? 1 : 0;
}

/** How far drawer i has slid out toward the arena (px). The unnumbered one never shuts. */
function mdOut(i: number, o: BossDrawOpts): number {
  if (i === MD_BLANK) return 35 + Math.sin(o.time * 0.9) * 3 + o.charge * 5 + o.flash * 6 + o.groggy * 6;
  const idle = Math.max(0, Math.sin(o.time * 0.8 + i * 2.1)) * 5 * (1 - o.groggy);
  return idle + o.flash * 22 * (0.25 + 0.75 * mdLead(i, o)) + o.groggy * (12 + (i % 3) * 5);
}

/** The rattle of a drawer about to open (px sideways). */
const mdShake = (i: number, o: BossDrawOpts): number => mdLead(i, o) * Math.sin(o.time * 47 + i * 1.3) * 2.5 * o.charge;

function drawMorgueDrawers(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const steel = tint(MD_BASE, o);
  const blankY = mdY(cy, MD_BLANK);
  const blankOut = mdOut(MD_BLANK, o);
  enrageHaze(ctx, cx, cy + 30, R * 1.9, 96, o, alpha, '#c9f4ff');
  // the cabinet wall
  ctx.fillStyle = tint(MD_WALL, o);
  ctx.fillRect(cx - MD_LEFT - 10, cy - 50, MD_LEFT * 2 + 20, 148);
  ctx.fillStyle = tint(MD_EDGE, o);
  ctx.fillRect(cx - MD_LEFT - 10, cy - 50, MD_LEFT * 2 + 20, 6);
  // the dark inside of every drawer that is out
  ctx.fillStyle = '#07090d';
  ctx.beginPath();
  for (let i = 0; i < MD_CELLS.length; i++) ctx.rect(mdX(cx, i) + 3, mdY(cy, i), mdW(i) - 6, mdOut(i, o) + 8);
  ctx.fill();
  // cold light breathing out of the unnumbered one (out while knocked down: 냉기 꺼짐)
  if (g < 1) glowEllipse(ctx, cx, blankY + blankOut * 0.5, 126, blankOut * 0.5, MD_FROST, alpha * 0.3 * (1 - g));
  ctx.globalAlpha = alpha;
  // drawer fronts
  ctx.beginPath();
  for (let i = 0; i < MD_CELLS.length; i++) ctx.rect(mdX(cx, i) + mdShake(i, o), mdY(cy, i) + mdOut(i, o), mdW(i), mdH(i));
  ctx.fillStyle = steel;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  // handles (red and rattling on the drawers about to open) and the bevel light on each top edge
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < MD_CELLS.length; i++) {
    const hx = mdX(cx, i) + mdShake(i, o) + mdW(i) / 2;
    const hy = mdY(cy, i) + mdOut(i, o) + mdH(i) * 0.66;
    ctx.moveTo(hx - 24, hy);
    ctx.lineTo(hx + 24, hy);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.strokeStyle = MD_LIGHT;
  ctx.lineWidth = 4;
  ctx.stroke();
  if (o.charge > 0) {
    ctx.beginPath();
    for (let i = 0; i < MD_BLANK; i++) {
      if (mdLead(i, o) === 0) continue;
      const hx = mdX(cx, i) + mdShake(i, o) + mdW(i) / 2;
      const hy = mdY(cy, i) + mdOut(i, o) + mdH(i) * 0.66;
      ctx.moveTo(hx - 24, hy);
      ctx.lineTo(hx + 24, hy);
    }
    ctx.globalAlpha = alpha * o.charge;
    ctx.strokeStyle = RED;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  ctx.lineCap = 'butt';
  // number plates; phase 2: every plate is blank and frosted
  const blankAll = o.phase >= 2;
  ctx.beginPath();
  for (let i = 0; i < MD_BLANK; i++) ctx.rect(mdX(cx, i) + mdShake(i, o) + mdW(i) / 2 - 18, mdY(cy, i) + mdOut(i, o) + 9, 36, 17);
  ctx.fillStyle = blankAll ? lighten(MD_FROST, 0.5) : MD_LIGHT;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (!blankAll) {
    ctx.beginPath();
    for (let i = 0; i < MD_BLANK; i++) {
      const px = mdX(cx, i) + mdShake(i, o) + mdW(i) / 2;
      const py = mdY(cy, i) + mdOut(i, o) + 13;
      const n = (i % 3) + 1;
      for (let k = 0; k < n; k++) {
        const sx = px + (k - (n - 1) / 2) * 7;
        ctx.moveTo(sx, py);
        ctx.lineTo(sx, py + 9);
      }
    }
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  // the unnumbered drawer: a frosted empty plate, icicles, the toe tag on its handle
  const fx = mdX(cx, MD_BLANK);
  const fy = blankY + blankOut;
  ctx.fillStyle = lighten(MD_FROST, 0.3);
  ctx.fillRect(cx - 24, fy + 7, 48, 15);
  ctx.strokeRect(cx - 24, fy + 7, 48, 15);
  if (g < 1) {
    ctx.globalAlpha = alpha * (1 - g);
    spikes(ctx, fx + 8, fy + mdH(MD_BLANK), mdW(MD_BLANK) - 16, 11, 9 + Math.sin(t * 1.1) * 2 + o.charge * 5, lighten(MD_FROST, 0.5));
    ctx.globalAlpha = alpha;
  }
  if (g < 0.5) {
    // (knocked down, the tag has dropped: drawMorgueProps)
    const a = swayAngle(t, 1.7, 0.3, 2) + Math.sin(t * 29) * 0.25 * o.charge;
    const tx = cx + 46 + Math.sin(a) * 24;
    const ty = fy + mdH(MD_BLANK) * 0.66 + Math.cos(a) * 24;
    const ux = Math.sin(a);
    const uy = Math.cos(a);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + 46, fy + mdH(MD_BLANK) * 0.66);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx - uy * 8, ty + ux * 8);
    ctx.lineTo(tx + uy * 8, ty - ux * 8);
    ctx.lineTo(tx + uy * 8 + ux * 22, ty - ux * 8 + uy * 22);
    ctx.lineTo(tx - uy * 8 + ux * 22, ty + ux * 8 + uy * 22);
    ctx.closePath();
    ctx.fillStyle = '#f4e9c8';
    ctx.fill();
    ctx.stroke();
  }
  // pale fingers over the edge of the open drawer
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    for (let f = 0; f < 4; f++) {
      const px = cx + side * (104 - f * 11);
      ctx.moveTo(px, fy - 4);
      ctx.lineTo(px, fy + 8 + (f % 2) * 3 + 9 * g + 3 * o.charge);
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = '#d5dde3';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.lineCap = 'butt';
  // two eyes in the dark of the gap
  const ey = blankY + blankOut * 0.5 + 1;
  const { lx, ly } = lookDir(cam, cx, ey, o);
  const open = blink(t, 3) * (1 - g);
  const angry = o.phase >= 2 || o.enraged;
  bigEye(ctx, cx - 32, ey, 14, lx, ly, angry, alpha, open);
  bigEye(ctx, cx + 32, ey, 14, lx, ly, angry, alpha, open);
  // cold mist sinking onto the floor
  if (g < 1) {
    ctx.fillStyle = lighten(MD_FROST, 0.6);
    for (let k = 0; k < 3; k++) {
      const u = (t * 0.22 + k / 3) % 1;
      ctx.globalAlpha = alpha * 0.2 * (1 - u) * (1 - g) * (blankAll ? 1.6 : 1);
      ctx.beginPath();
      ctx.ellipse(cx + (k - 1) * 86 + Math.sin(t * 0.7 + k) * 14, fy + 40 + u * 44, 50 + u * 34, 9 + u * 7, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Knocked down: the name tag has dropped off its handle and swings on its string. */
function drawMorgueProps(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const a = swayAngle(o.time, 2.2, 0.2);
  plaque(ctx, cx + 50 + a * 40, cy + 148, 88, 26, '이름 없음', '#f4e9c8', '#1b1b1b', alpha * o.groggy, a);
}

// ─────────────────────────── 투시 촬영기 ───────────────────────────

const XR_BASE = '#f8f9fa';
/** The jointed arm: the shell 25 % darker. */
const XR_ARM = '#babbbc';
const XR_GREEN = '#38b000';
const XR_FILM = '#caf0f8';
const XR_BONE = '#1b4b5a';
const XR_ARC = 96;
/** 기획 19차 review: the head hangs this far left of the middle (px) — the party stands under the middle and hid the lens. */
const XR_SIDE = -170;

function drawXrayMachine(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const shell = tint(XR_BASE, o);
  const mark = o.phase >= 2 || o.enraged ? '#ff2d2d' : XR_GREEN;
  const bx = cx + XR_SIDE;
  const { lx, ly } = lookDir(cam, bx, cy + 44, o);
  // the head swings toward its target; knocked down, the arm sags
  const hx = bx + lx * 40 * (1 - g) - 26 * g;
  const hy = cy + 44 + (ly * 12 + Math.sin(t * 1.3) * 2) * (1 - g) + 30 * g;
  const aim = Math.atan2(ly, lx);
  const th = aim + (Math.PI * 0.72 - aim) * g;
  enrageHaze(ctx, hx, hy, R * 0.85, 100, o, alpha, '#eaffea');
  // ceiling rail, carriage, the jointed arm
  ctx.fillStyle = '#3a4149';
  ctx.fillRect(cx - R * 1.75, cy - 50, R * 3.5, 9);
  ctx.fillStyle = '#59636d';
  ctx.fillRect(bx * 0.6 + cx * 0.4 - 30 + lx * 14, cy - 46, 60, 18);
  limb(ctx, bx * 0.6 + cx * 0.4 + lx * 14, cy - 30, hx - Math.cos(th) * XR_ARC, hy - Math.sin(th) * XR_ARC, 14 - 30 * g, 13, tint(XR_ARM, o));
  // the C arm, open toward the target
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(hx, hy, XR_ARC, th + 0.85, th + TAU - 0.85);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 26;
  ctx.stroke();
  ctx.strokeStyle = shell;
  ctx.lineWidth = 19;
  ctx.stroke();
  ctx.lineCap = 'butt';
  // the neck that holds the head inside it
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - Math.cos(th) * XR_ARC, hy - Math.sin(th) * XR_ARC);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 20;
  ctx.stroke();
  ctx.strokeStyle = '#59636d';
  ctx.lineWidth = 14;
  ctx.stroke();
  // its two emitter tips light up with the charge
  const lit = Math.max(o.charge, o.flash);
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    const px = hx + Math.cos(th + s * 0.85) * XR_ARC;
    const py = hy + Math.sin(th + s * 0.85) * XR_ARC;
    ctx.moveTo(px + 11, py);
    ctx.arc(px, py, 11, 0, TAU);
  }
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.globalAlpha = alpha * (0.35 + 0.65 * lit) * (1 - g);
  ctx.fillStyle = mark;
  ctx.fill();
  ctx.globalAlpha = alpha;
  // the head and its black lens plate
  ctx.beginPath();
  ctx.arc(hx, hy, 60, 0, TAU);
  ctx.fillStyle = shell;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  const px = hx + lx * 6 * (1 - g);
  const py = hy + ly * 5 * (1 - g);
  ctx.beginPath();
  ctx.arc(px, py, 48, 0, TAU);
  ctx.fillStyle = '#0b0f14';
  ctx.fill();
  ctx.strokeStyle = '#59636d';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, 38, -2.5, -1.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.stroke();
  // the crosshair is its pupil: it wanders, then locks and tightens with the charge
  if (g < 1) {
    const loose = 1 - o.charge;
    const qx = px + lx * 12 + Math.sin(t * 2.3) * 4 * loose;
    const qy = py + ly * 9 + Math.cos(t * 1.7) * 3 * loose;
    const qr = 26 - 8 * o.charge;
    ctx.globalAlpha = alpha * (1 - g);
    ctx.beginPath();
    ctx.arc(qx, qy, qr, 0, TAU);
    for (let k = 0; k < 4; k++) {
      const c = k === 0 ? 1 : k === 2 ? -1 : 0;
      const s = k === 1 ? 1 : k === 3 ? -1 : 0;
      ctx.moveTo(qx + c * (qr - 7), qy + s * (qr - 7));
      ctx.lineTo(qx + c * (qr + 8), qy + s * (qr + 8));
    }
    ctx.strokeStyle = mark;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(qx, qy, 5 + 4 * o.charge, 0, TAU);
    ctx.fillStyle = mark;
    ctx.fill();
    if (lit > 0) glowEllipse(ctx, px, py, 50 * lit, 50 * lit, '#ffffff', alpha * 0.75 * lit);
    ctx.globalAlpha = alpha;
  }
  if (g > 0) cracks(ctx, px, py, 45, 5, 3, '#cfd8dc', alpha * g);
  ctx.globalAlpha = alpha;
  xrViewer(ctx, cx + R * 1.2, cy + 4, t, g, o.flash, mark, alpha);
  // the radiation sign moved to the far right (the head took its left place)
  xrSign(ctx, cx + R * 2.05, cy + 46, t, lit * (1 - g), alpha);
  ctx.globalAlpha = 1;
}

/** The film viewer beside the machine: a rib cage with one bone too many; a skull on the flash; noise, then dark, when down. */
function xrViewer(ctx: CanvasRenderingContext2D, vx: number, vy: number, t: number, g: number, flash: number, mark: string, alpha: number): void {
  ctx.strokeStyle = '#3a4149';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(vx + 20, vy - 46);
  ctx.lineTo(vx + 20, vy);
  ctx.moveTo(vx + 80, vy - 46);
  ctx.lineTo(vx + 80, vy);
  ctx.stroke();
  ctx.fillStyle = '#20262c';
  ctx.fillRect(vx - 6, vy - 6, 112, 100);
  const glow = g > 0 ? strobe(t, 14, 7, 0.6 * (1 - g)) * 0.6 : 0.74 + 0.26 * strobe(t, 9, 3, 0.85);
  if (glow <= 0) return;
  ctx.globalAlpha = alpha * glow;
  ctx.fillStyle = XR_FILM;
  ctx.fillRect(vx, vy, 100, 88);
  const mx = vx + 50;
  if (g > 0) {
    // losing the picture: bars of noise
    const f = Math.floor(t * 14);
    ctx.fillStyle = '#20262c';
    for (let k = 0; k < 5; k++) ctx.fillRect(vx + hash01(k, f) * 70, vy + hash01(k + 9, f) * 80, 30, 5);
  } else if (flash > 0.3) {
    ctx.fillStyle = XR_BONE;
    ctx.beginPath();
    ctx.arc(mx, vy + 36, 25, 0, TAU);
    ctx.rect(mx - 14, vy + 52, 28, 20);
    ctx.fill();
    ctx.fillStyle = XR_FILM;
    ctx.beginPath();
    ctx.ellipse(mx - 10, vy + 36, 7, 9, 0, 0, TAU);
    ctx.ellipse(mx + 10, vy + 36, 7, 9, 0, 0, TAU);
    ctx.rect(mx - 2, vy + 48, 4, 7);
    ctx.fill();
  } else {
    ctx.lineCap = 'round';
    ctx.strokeStyle = XR_BONE;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(mx, vy + 8);
    ctx.lineTo(mx, vy + 80);
    for (let k = 0; k < 4; k++) {
      const ry = vy + 16 + k * 15;
      ctx.moveTo(mx, ry);
      ctx.quadraticCurveTo(mx - 36, ry - 6, mx - 31, ry + 13);
      ctx.moveTo(mx, ry);
      ctx.quadraticCurveTo(mx + 36, ry - 6, mx + 31, ry + 13);
    }
    ctx.stroke();
    // 뼈가 하나 더: it shows only now and then
    if (strobe(t, 5, 11, 0.55) > 0) {
      ctx.strokeStyle = mark;
      ctx.beginPath();
      ctx.moveTo(mx + 6, vy + 78);
      ctx.lineTo(mx + 30, vy + 58);
      ctx.lineTo(mx + 40, vy + 26);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = alpha;
}

/** A radiation sign on the other side; its lamp burns while the machine charges. */
function xrSign(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, lit: number, alpha: number): void {
  ctx.strokeStyle = '#3a4149';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 88);
  ctx.lineTo(sx, sy - 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy, 28, 0, TAU);
  ctx.fillStyle = '#ffd60a';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * TAU) / 3;
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, 21, a - 0.52, a + 0.52);
    ctx.closePath();
  }
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, TAU);
  ctx.fillStyle = '#ffd60a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, TAU);
  ctx.fillStyle = INK;
  ctx.fill();
  if (lit > 0) {
    ctx.globalAlpha = alpha * lit * (0.6 + 0.4 * strobe(t, 10, 2));
    ctx.beginPath();
    ctx.arc(sx, sy - 40, 9, 0, TAU);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
}

// ─────────────────────────── 멈추지 않는 제세동기 ───────────────────────────

const DF_BASE = '#ffd60a';
/** The skirt along the bottom of the box: the yellow 25 % darker. */
const DF_SKIRT = '#bfa108';
const DF_GREEN = '#06d6a0';
const DF_SCREEN = '#06281f';
const DF_DARK = '#2b2f36';
const DF_JOULES = ['200', '240', '280', '320', '360'];
const DF_FONT = '900 15px sans-serif';
const DF_POINTS = 22;

/** One heartbeat over u 0..1 (−1 = the top of the spike). */
function ecgBeat(u: number): number {
  if (u < 0.3 || u >= 0.58) return 0;
  if (u < 0.38) return -0.18 * Math.sin(((u - 0.3) / 0.08) * Math.PI);
  if (u < 0.44) return 0;
  if (u < 0.48) return -(u - 0.44) / 0.04;
  if (u < 0.54) return -1 + ((u - 0.48) / 0.06) * 1.5;
  return 0.5 - ((u - 0.54) / 0.04) * 0.5;
}

function drawDefibrillator(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const body = tint(DF_BASE, o);
  const red = o.phase >= 2 || o.enraged;
  const trace = red ? '#ff4d4d' : DF_GREEN;
  enrageHaze(ctx, cx, cy + 40, R * 1.25, 110, o, alpha, '#d9f6ff');
  // the paddles: arms on cables (drawn first, behind the box)
  const reach = 186 - 34 * o.charge + 12 * g;
  const yl = dfPaddleY(cy, -1, o);
  const yr = dfPaddleY(cy, 1, o);
  dfPaddle(ctx, cx, cy, -1, reach, yl, g);
  dfPaddle(ctx, cx, cy, 1, reach, yr, g);
  ctx.globalAlpha = alpha;
  // the box
  pathRoundRect(ctx, cx - 100, cy - 44, 200, 142, 18);
  ctx.fillStyle = body;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = tint(DF_SKIRT, o);
  ctx.fillRect(cx - 96, cy + 78, 192, 14);
  // the screen: two eyes over the heartbeat (a flat line when knocked down)
  pathRoundRect(ctx, cx - 82, cy - 28, 116, 68, 8);
  ctx.fillStyle = DF_SCREEN;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.stroke();
  const speed = (red ? 1.5 : 1) * (1 + o.charge);
  const amp = 17 * (1 - g) * (1 + 0.3 * o.charge);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let k = 0; k < DF_POINTS; k++) {
    const u = (((k / (DF_POINTS - 1)) * 1.5 - t * 0.9 * speed) % 1 + 1) % 1;
    const px = cx - 76 + k * (104 / (DF_POINTS - 1));
    const py = cy + 22 + ecgBeat(u) * amp;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = trace;
  ctx.lineWidth = 3;
  ctx.stroke();
  const { lx, ly } = lookDir(cam, cx - 24, cy - 8, o);
  const open = blink(t, 4) * (1 - g);
  ctx.fillStyle = trace;
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    const ex = cx - 24 + s * 26 + lx * 4;
    const ey = cy - 9 + ly * 3;
    ctx.moveTo(ex + 9, ey);
    ctx.ellipse(ex, ey, 9, Math.max(1.5, 9 * open), 0, 0, TAU);
  }
  ctx.fill();
  if (red && g < 0.5) {
    // angry brows
    ctx.beginPath();
    ctx.moveTo(cx - 64, cy - 24);
    ctx.lineTo(cx - 38, cy - 17);
    ctx.moveTo(cx + 16, cy - 24);
    ctx.lineTo(cx - 10, cy - 17);
    ctx.strokeStyle = DF_SCREEN;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  // the joule read-out climbs with the charge; the dial turns
  ctx.fillStyle = DF_SCREEN;
  ctx.fillRect(cx + 44, cy - 28, 46, 22);
  if (g <= 0) {
    ctx.fillStyle = trace;
    ctx.font = DF_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(DF_JOULES[Math.min(4, Math.floor(o.charge * 5))], cx + 67, cy - 16);
  }
  const da = -2.4 + o.charge * 3.4 + Math.sin(t * 0.7) * 0.15 + g * 1.2;
  ctx.beginPath();
  ctx.arc(cx + 67, cy + 22, 17, 0, TAU);
  ctx.fillStyle = DF_DARK;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 67, cy + 22);
  ctx.lineTo(cx + 67 + Math.cos(da) * 13, cy + 22 + Math.sin(da) * 13);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  // the shock button (lit while charging), a spare one, the bolt label
  ctx.beginPath();
  ctx.arc(cx + 78, cy + 62, 11, 0, TAU);
  ctx.fillStyle = o.charge > 0 && strobe(t, 12, 4) > 0 ? '#ff9a9a' : '#e63946';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 50, cy + 62, 8, 0, TAU);
  ctx.fillStyle = DF_GREEN;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 80, cy + 46, 60, 28);
  ctx.strokeRect(cx - 80, cy + 46, 60, 28);
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy + 49);
  ctx.lineTo(cx - 58, cy + 62);
  ctx.lineTo(cx - 51, cy + 62);
  ctx.lineTo(cx - 55, cy + 72);
  ctx.lineTo(cx - 42, cy + 58);
  ctx.lineTo(cx - 49, cy + 58);
  ctx.closePath();
  ctx.fillStyle = '#e63946';
  ctx.fill();
  // charging: a thread of electricity sags between the paddles; the hit: both plates flash
  if (o.charge > 0.05 && g <= 0) dfSpark(ctx, cx - reach + 30, yl + 10, cx + reach - 30, yr + 10, t, alpha * o.charge);
  if (o.flash > 0) {
    glowEllipse(ctx, cx - reach, yl + 10, 56, 18, '#ffffff', alpha * 0.8 * o.flash);
    glowEllipse(ctx, cx + reach, yr + 10, 56, 18, '#ffffff', alpha * 0.8 * o.flash);
  }
  ctx.globalAlpha = 1;
}

/** Screen y of a paddle: it breathes, lifts with the charge, slams on the hit, lies on the floor when knocked down. */
function dfPaddleY(cy: number, side: number, o: BossDrawOpts): number {
  return cy + 60 + Math.sin(o.time * 1.4 + side) * 5 * (1 - o.groggy) - 30 * o.charge + 40 * o.flash + 52 * o.groggy;
}

function dfPaddle(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: number, reach: number, py: number, g: number): void {
  const px = cx + side * reach;
  limb(ctx, cx + side * 98, cy + 26, px, py - 20, side * (28 + 26 * g), 7, DF_DARK);
  ctx.fillStyle = DF_DARK;
  ctx.fillRect(px - 20, py - 22, 40, 19);
  ctx.fillStyle = '#e9ecef';
  ctx.fillRect(px - 34, py - 4, 68, 14);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(px - 34, py - 4, 68, 14);
}

function dfSpark(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: number, alpha: number): void {
  const f = Math.floor(t * 24);
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let k = 1; k < 10; k++) {
    const u = k / 10;
    ctx.lineTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + Math.sin(Math.PI * u) * 34 + (hash01(k, f) - 0.5) * 20);
  }
  ctx.lineTo(x1, y1);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#4cc9f0';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineJoin = 'round';
}

/** Knocked down: 「LOW BATTERY」 blinks over the flat line, and the monitor whines. */
function drawDefibProps(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const a = alpha * o.groggy;
  plaque(ctx, cx - 22, cy + 6 + 14 * o.groggy, 112, 22, 'LOW BATTERY', '#e63946', '#ffffff', a * (0.4 + 0.6 * strobe(o.time, 3, 5)), 0.1 * o.groggy);
  plaque(ctx, cx + 132, cy - 4, 54, 26, '삐—', DF_SCREEN, DF_GREEN, a, -0.08);
}

// ─────────────────────────── 빈 병상 행렬 ───────────────────────────

const EB_BASE = '#dee2e6';
const EB_STAIN = '#9b2226';
const EB_HOLE = '#2a0508';
const EB_STEEL = '#8a929c';
const EB_STEP = 116;
const EB_FOOT = 94;

/** The frame of one bed: a tall head rail behind, legs down to two wheels. spin = −1 / +1: that wheel shows a turning spoke. */
function ebFrame(ctx: CanvasRenderingContext2D, bx: number, cy: number, hw: number, t: number, spin: number): void {
  const foot = cy + EB_FOOT;
  const top = cy - 30;
  ctx.beginPath();
  ctx.moveTo(bx - hw, foot);
  ctx.lineTo(bx - hw, top + 10);
  ctx.quadraticCurveTo(bx, top - 12, bx + hw, top + 10);
  ctx.lineTo(bx + hw, foot);
  ctx.moveTo(bx - hw * 0.35, top);
  ctx.lineTo(bx - hw * 0.35, cy + 6);
  ctx.moveTo(bx + hw * 0.35, top);
  ctx.lineTo(bx + hw * 0.35, cy + 6);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = EB_STEEL;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx - hw + 7, foot);
  ctx.arc(bx - hw, foot, 7, 0, TAU);
  ctx.moveTo(bx + hw + 7, foot);
  ctx.arc(bx + hw, foot, 7, 0, TAU);
  ctx.fillStyle = INK;
  ctx.fill();
  if (spin !== 0) {
    // toppled: the wheel left in the air keeps spinning
    const a = t * 9;
    ctx.beginPath();
    ctx.moveTo(bx + spin * hw - Math.cos(a) * 6, foot - Math.sin(a) * 6);
    ctx.lineTo(bx + spin * hw + Math.cos(a) * 6, foot + Math.sin(a) * 6);
    ctx.strokeStyle = '#cfd6dc';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** The hem of a sheet from (right, y) back to (left, y): n tips like fingers, swaying; `reach` = how far they hang. */
function ebHem(ctx: CanvasRenderingContext2D, left: number, right: number, y: number, n: number, reach: number, t: number, seed: number): void {
  const step = (right - left) / n;
  for (let j = n - 1; j >= 0; j--) {
    ctx.lineTo(left + (j + 0.5) * step + Math.sin(t * 1.6 + seed * 1.3 + j * 0.7) * 3, y + reach * (0.55 + 0.45 * hash01(seed, j, 41)));
    ctx.lineTo(left + j * step, y);
  }
}

/** Phase 2: the stain has run into the lower part of the sheet whose outline is the current path (two bands, darker below). */
function ebSoak(ctx: CanvasRenderingContext2D, left: number, right: number, hem: number, alpha: number): void {
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = EB_STAIN;
  ctx.fillRect(left, hem - 28, right - left, 90);
  ctx.fillRect(left, hem - 14, right - left, 76);
  ctx.restore();
}

/** An empty bed: the sheet hangs flat over its foot end, three stains for a face. */
function ebSideBed(ctx: CanvasRenderingContext2D, bx: number, cy: number, i: number, sheet: string, o: BossDrawOpts, alpha: number): void {
  const hw = 44;
  const t = o.time;
  ebFrame(ctx, bx, cy, hw, t, o.groggy > 0 ? (i < 2 ? 1 : -1) : 0);
  // sucked back on the wind-up, slapping down on the hit, sliding off when toppled
  const hem = cy + 66 - 30 * o.charge + 14 * o.flash + 12 * o.groggy;
  const reach = 14 + Math.sin(t * 1.2 + i) * 4 + 24 * o.flash - 6 * o.charge + 10 * o.groggy;
  ctx.beginPath();
  ctx.moveTo(bx - hw - 5, cy + 2);
  ctx.quadraticCurveTo(bx, cy - 6, bx + hw + 5, cy + 2);
  ctx.lineTo(bx + hw + 7, hem);
  ebHem(ctx, bx - hw - 7, bx + hw + 7, hem, 5, reach, t, i);
  ctx.closePath();
  ctx.fillStyle = sheet;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  if (o.phase >= 2) ebSoak(ctx, bx - hw - 9, bx + hw + 9, hem, alpha);
  // stains: two eyes and a mouth (from phase 2 they have run into the lower half of the sheet)
  const sy = cy + 24 - 10 * o.charge;
  ctx.beginPath();
  ctx.moveTo(bx - 5, sy);
  ctx.ellipse(bx - 12, sy, 7, 5, 0.3, 0, TAU);
  ctx.moveTo(bx + 19, sy);
  ctx.ellipse(bx + 12, sy, 7, 5, -0.3, 0, TAU);
  ctx.moveTo(bx + 9, sy + 16);
  ctx.ellipse(bx, sy + 16, 9, 4 + 5 * o.charge, 0, 0, TAU);
  ctx.globalAlpha = alpha * 0.8;
  ctx.fillStyle = EB_STAIN;
  ctx.fill();
  ctx.globalAlpha = alpha;
}

/** The middle bed (the prop): its sheet sits up in the shape of a person, the stains are a face that follows the target. */
function ebFigureBed(ctx: CanvasRenderingContext2D, cam: Camera, bx: number, cy: number, sheet: string, o: BossDrawOpts, alpha: number): void {
  const hw = 58;
  const t = o.time;
  const g = o.groggy;
  ebFrame(ctx, bx, cy, hw, t, 0);
  const y0 = cy + 12 * g - 6 * o.charge + Math.sin(t * 1.1) * 1.5;
  const hem = cy + 80 - 24 * o.charge + 12 * o.flash + 8 * g;
  const reach = 15 + Math.sin(t * 1.2) * 4 + 24 * o.flash - 6 * o.charge + 8 * g;
  ctx.beginPath();
  ctx.moveTo(bx - 68, hem);
  ctx.lineTo(bx - 66, y0 + 64);
  ctx.quadraticCurveTo(bx - 62, y0 + 46, bx - 30, y0 + 46);
  ctx.bezierCurveTo(bx - 46, y0 - 26, bx + 46, y0 - 26, bx + 30, y0 + 46);
  ctx.quadraticCurveTo(bx + 62, y0 + 46, bx + 66, y0 + 64);
  ctx.lineTo(bx + 68, hem);
  ebHem(ctx, bx - 68, bx + 68, hem, 6, reach, t, 9);
  ctx.closePath();
  ctx.fillStyle = sheet;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  if (o.phase >= 2) ebSoak(ctx, bx - 72, bx + 72, hem, alpha);
  ctx.globalAlpha = alpha;
  // the face: stain eyes with dark holes, a mouth that opens on the wind-up, tears running down
  const { lx, ly } = lookDir(cam, bx, y0 + 14, o);
  const open = blink(t, 5) * (1 - g);
  const ey = y0 + 14;
  ctx.fillStyle = EB_STAIN;
  ctx.beginPath();
  ctx.ellipse(bx - 14, ey, 10, Math.max(2, 8 * open), 0.2, 0, TAU);
  ctx.moveTo(bx + 24, ey);
  ctx.ellipse(bx + 14, ey, 10, Math.max(2, 8 * open), -0.2, 0, TAU);
  ctx.moveTo(bx + 12, y0 + 36);
  ctx.ellipse(bx, y0 + 36, 12 + 2 * o.charge, 5 + 9 * o.charge, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = EB_HOLE;
  ctx.beginPath();
  if (open > 0.3) {
    ctx.ellipse(bx - 14 + lx * 4, ey + ly * 3, 4.5, 4.5 * open, 0, 0, TAU);
    ctx.moveTo(bx + 18.5 + lx * 4, ey + ly * 3);
    ctx.ellipse(bx + 14 + lx * 4, ey + ly * 3, 4.5, 4.5 * open, 0, 0, TAU);
  }
  ctx.moveTo(bx + 8 + o.charge * 2, y0 + 36);
  ctx.ellipse(bx, y0 + 36, 8 + 2 * o.charge, 2 + 7 * o.charge, 0, 0, TAU);
  ctx.fill();
  if (g < 1) dripRow(ctx, bx - 26, ey + 6, 52, 3, 30, t * 0.5, EB_STAIN, alpha * 0.9 * (1 - g));
  ctx.globalAlpha = alpha;
}

function drawEmptyBeds(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const sheet = tint(EB_BASE, o);
  enrageHaze(ctx, cx, cy + 36, R * 1.95, 104, o, alpha, '#ffffff');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // the outer beds first, the middle one on top
  for (let n = 0; n < 5; n++) {
    const i = n < 2 ? n : n < 4 ? n + 1 : 2;
    const mid = i === 2;
    // wheels creak; the whole bed jumps on the wind-up
    const bx = cx + (i - 2) * EB_STEP + Math.sin(t * 0.9 + i * 1.7) * 2;
    const by = cy - o.charge * (5 + 4 * Math.sin(t * 31 + i * 2.3)) * (1 - g);
    const dir = mid ? 0.22 : i < 2 ? -1 : 1;
    if (g > 0) {
      // knocked down: every bed falls over its outer wheel (the middle one only slumps)
      const px = bx + (mid ? 0 : dir * 44);
      ctx.save();
      ctx.translate(px, cy + EB_FOOT);
      ctx.rotate(dir * 1.1 * g);
      ctx.translate(-px, -(cy + EB_FOOT));
    }
    ctx.globalAlpha = alpha;
    if (mid) ebFigureBed(ctx, cam, bx, by, sheet, o, alpha);
    else ebSideBed(ctx, bx, by, i, sheet, o, alpha);
    if (g > 0) ctx.restore();
  }
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

// ─────────────────────────── registry ───────────────────────────

/** Boss id → look. */
export const WARD_LOOKS: Record<string, BossLook> = {
  morgue_drawers: { draw: drawMorgueDrawers, color: MD_BASE, headY: (by, _R, g) => by + 8 + 14 * g, props: drawMorgueProps },
  xray_machine: { draw: drawXrayMachine, color: XR_BASE, headY: (by, _R, g) => by - 8 + 40 * g },
  defibrillator: { draw: drawDefibrillator, color: DF_BASE, headY: (by, _R, g) => by - 30 + 14 * g, props: drawDefibProps },
  empty_beds: { draw: drawEmptyBeds, color: EB_BASE, headY: (by, _R, g) => by - 18 + 24 * g },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const WARD_TELE_MOTIF: Record<string, TeleMotif> = {
  eb_lineup: 'pull',
  eb_disinfect: 'linger',
  md_wake: 'spawn',
  xr_dolls: 'spawn',
};

/** MonsterDef.look → the body of this zone's summon-only units (none: this zone summons existing monsters). */
export const WARD_MINION_LOOKS: Record<string, CreatureDrawFn> = {};
