// 기획 19차 보스 레이드 — 폐병동 boss looks (docs/bosses.md 5장). This zone's track owns this file.
// 기획 20차 보스 형태: one boss stays a set piece at the top, three became bodies that live inside the arena.
//   morgue_drawers 번호 없는 서랍       고정형 (set piece): a steel wall of drawers, the wide unnumbered one ajar (two eyes, frost,
//                                      a toe tag) + a floor of six numbered cells (stage)
//   xray_machine   투시 촬영기          자리 이동형 (body): a C bracket around one black lens (the crosshair is its pupil), hanging
//                                      from a trolley; it turns to where its station looks + the rail's shadow (stage)
//   defibrillator  멈추지 않는 제세동기  배회형 (body): a yellow cart with a green ECG face, two paddles held out in front
//   empty_beds     빈 병상 행렬         배회형 (body): one long iron bed, its sheet crumpled into a person sitting up
// Summon-only unit: bed_decoy 빈 침대 (a small bare bed — never mistaken for the boss). Warning motifs: md_wake /
// eb_procession spawn (a motif only shows on a part with a delay — the summons are instant today, so the rows wait).
//
// Set-piece rules (서랍): read only BossDrawOpts + o.time + hash01 (no Math.random / Date); faces and eyes at screen y
// 100–230 (the HUD boss box covers x 424–856, y < 100); ≤ 360 canvas calls a frame, ≤ 2 fillText, no gradients, no
// shadowBlur, nothing allocated per frame; safe for o.phase 1–3; mix / lighten / darken only with stepped amounts.
// Body rules (the other three, src/render/bosses/types.ts BossBodyFn): drawn facing right in a box standing on
// (f.fx, f.fy) — the shared frame (body.ts) mirrors, bobs, swells, tilts and tints; ≤ 220 canvas calls, NO fillText (it
// would mirror: texts go in `props`, which is screen-aligned), nothing smaller than 6 px. Poses: f.pose idle / walk /
// windup / attack / groggy with f.p 0..1; f.stride = the walk cycle; f.facing = where it looks (radians).
// Checks: npx vitest run tests/render (boss-looks: every look, 15 poses × 30 frames; boss-body: 5 poses × 2 sides).
// See it: /?mode=bossRaid&boss=<id>, or node tests/visual/boss-phone-sheet.mjs only=<id>; all 20: node tests/visual/boss-sheet.mjs

import { Camera, PX_PER_UNIT } from '../camera';
import { getBoss } from '../../data';
import { asSetPiece } from './body';
import { TAU, anchor, bigEye, blink, cracks, dripRow, enrageHaze, glowEllipse, hash01, lighten, limb, lookDir, mix, pathRoundRect, plaque, spikes, strobe, swayAngle, wash } from './kit';
import type { BossBody, BossBodyFrame, BossDrawOpts, BossLook, BossStageLook, CreatureDrawFn, TeleMotif } from './types';

const INK = '#14101a';
const RED = '#ff3b3b';
const NO_DASH: number[] = [];

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
/** Dashes of the floor joints between the six cells (stage). */
const MD_JOINT = [16, 12];

const mdX = (cx: number, i: number): number => cx - MD_LEFT + MD_CELLS[i][0] * (MD_W + MD_GAP);
const mdY = (cy: number, i: number): number => cy - 40 + MD_CELLS[i][1] * (MD_H + MD_GAP);
const mdW = (i: number): number => MD_CELLS[i][2] * (MD_W + MD_GAP) - MD_GAP;
const mdH = (i: number): number => (i === MD_BLANK ? 46 : MD_H);

/** 1 for the drawers that open in the attack: every numbered one (기획 20차 번호 순서) — the unnumbered one never does. */
function mdLead(i: number, _o: BossDrawOpts): number {
  return i !== MD_BLANK ? 1 : 0;
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

/**
 * 기획 20차 floor of the morgue (docs/bosses.md 5-2): the six cells of 번호 순서 as cold joints in the floor, a drawer
 * front on the side walls for every row, and a number plate in every cell — one tally for the row that opens first, two
 * for the next; the bottom row, where the unnumbered cell is, has frosted blank plates (all of them from phase 2, when
 * 거꾸로 순서 makes the top-left cell the safe one). Baked once per phase; the warnings themselves show the order.
 */
const MORGUE_STAGE: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const cw = B.wPx / 2;
    const ch = B.hPx / 3;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(205,228,238,0.26)';
    g.lineWidth = 3;
    g.setLineDash(MD_JOINT);
    g.beginPath();
    g.moveTo(cw, 0);
    g.lineTo(cw, B.hPx);
    for (let r = 1; r < 3; r++) {
      g.moveTo(0, r * ch);
      g.lineTo(B.wPx, r * ch);
    }
    g.stroke();
    g.setLineDash(NO_DASH);
    for (let side = 0; side < 2; side++) {
      for (let r = 0; r < 3; r++) {
        const x = side === 0 ? 0 : B.wPx - 14;
        const y = r * ch + 9;
        g.fillStyle = 'rgba(56,61,70,0.85)';
        g.fillRect(x, y, 14, ch - 18);
        g.fillStyle = 'rgba(237,242,244,0.8)';
        g.fillRect(x + 4, y + (ch - 18) / 2 - 13, 6, 26);
      }
    }
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const px = c * cw + cw / 2;
        const py = r * ch + ch / 2;
        const frosted = B.phase >= 2 || r === 2;
        g.fillStyle = frosted ? 'rgba(150,222,240,0.34)' : 'rgba(237,242,244,0.3)';
        g.fillRect(px - 34, py - 13, 68, 26);
        g.strokeStyle = 'rgba(12,14,20,0.55)';
        g.lineWidth = 2.5;
        g.strokeRect(px - 34, py - 13, 68, 26);
        if (frosted) continue;
        g.beginPath();
        for (let k = 0; k <= r; k++) {
          const sx = px + (k - r / 2) * 12;
          g.moveTo(sx, py - 7);
          g.lineTo(sx, py + 7);
        }
        g.lineWidth = 4;
        g.stroke();
      }
    }
  },
};

// ─────────────────────────── 투시 촬영기 (기획 20차: 자리 이동형 — 레일에 매달린 C자 팔) ───────────────────────────

const XR_BASE = '#f8f9fa';
/** The jointed arm: the shell 25 % darker. */
const XR_ARM = '#babbbc';
const XR_GREEN = '#38b000';
const XR_RED = '#ff2d2d';
const XR_DARK = '#3a4149';
const XR_STEEL = '#59636d';

/**
 * The hanging head, authored facing right: a trolley on a stub of ceiling rail, a jointed arm, the C bracket open the
 * way the machine looks (f.facing: a station looks down / left / up / right) around one black lens whose crosshair is
 * its pupil. Wind-up: the two emitter tips and the lens charge white. Groggy: the arm sags, the lens cracks.
 */
function xrBody(ctx: CanvasRenderingContext2D, f: BossBodyFrame, o: BossDrawOpts): void {
  const A = 1 - o.retreat;
  const { fx, fy, w, h, pose, p } = f;
  const t = f.time;
  const g = pose === 'groggy' ? p : 0;
  const lit = pose === 'windup' ? p : pose === 'attack' ? 1 - 0.6 * p : 0;
  const shell = tint(XR_BASE, o);
  const mark = o.phase >= 2 || o.enraged ? XR_RED : XR_GREEN;
  // the canvas is mirrored to its side: the way it looks, seen in this box
  const aim = Math.atan2(Math.sin(f.facing), Math.cos(f.facing) * f.s);
  const th = aim + (Math.PI * 0.72 - aim) * g;
  const top = fy - h;
  const hx = fx + Math.sin(t * 1.3) * 3 * (1 - g) - 8 * g;
  const hy = fy - h * 0.47 + Math.sin(t * 1.7) * 2 * (1 - g) + h * 0.1 * g;
  const rc = w * 0.27;
  // a stub of the ceiling rail and the trolley that hangs on it (hazard stripes)
  ctx.fillStyle = XR_DARK;
  ctx.fillRect(fx - w * 0.46, top, w * 0.92, 7);
  ctx.fillStyle = XR_STEEL;
  ctx.fillRect(fx - w * 0.17, top + 4, w * 0.34, 15);
  ctx.fillStyle = '#ffd60a';
  for (let k = 0; k < 3; k++) ctx.fillRect(fx - w * 0.13 + k * w * 0.1, top + 7, w * 0.055, 9);
  limb(ctx, fx, top + 17, hx, hy, 10 - 28 * g, 11, tint(XR_ARM, o));
  // the C bracket, open toward where it looks
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(hx, hy, rc, th + 0.9, th + TAU - 0.9);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 22;
  ctx.stroke();
  ctx.strokeStyle = shell;
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.lineCap = 'butt';
  // its two emitter tips light up with the charge
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    const px = hx + Math.cos(th + s * 0.9) * rc;
    const py = hy + Math.sin(th + s * 0.9) * rc;
    ctx.moveTo(px + 9, py);
    ctx.arc(px, py, 9, 0, TAU);
  }
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.globalAlpha = A * (0.35 + 0.65 * lit) * (1 - g);
  ctx.fillStyle = mark;
  ctx.fill();
  ctx.globalAlpha = A;
  // the head and its black lens plate
  ctx.beginPath();
  ctx.arc(hx, hy, w * 0.165, 0, TAU);
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  const lx = hx + Math.cos(th) * 5 * (1 - g);
  const ly = hy + Math.sin(th) * 4 * (1 - g);
  const lr = w * 0.12;
  ctx.beginPath();
  ctx.arc(lx, ly, lr, 0, TAU);
  ctx.fillStyle = '#0b0f14';
  ctx.fill();
  ctx.strokeStyle = XR_STEEL;
  ctx.lineWidth = 3;
  ctx.stroke();
  if (g < 1) {
    // the crosshair is its pupil: it wanders, then locks and tightens with the charge
    const loose = pose === 'windup' || pose === 'attack' ? 0 : 1;
    const qx = lx + Math.cos(th) * 4 + Math.sin(t * 2.3) * 3 * loose;
    const qy = ly + Math.sin(th) * 3 + Math.cos(t * 1.7) * 2 * loose;
    const qr = lr * (0.62 - 0.2 * lit);
    ctx.globalAlpha = A * (1 - g);
    ctx.beginPath();
    ctx.arc(qx, qy, qr, 0, TAU);
    ctx.moveTo(qx + qr - 4, qy);
    ctx.lineTo(qx + qr + 5, qy);
    ctx.moveTo(qx - qr + 4, qy);
    ctx.lineTo(qx - qr - 5, qy);
    ctx.moveTo(qx, qy + qr - 4);
    ctx.lineTo(qx, qy + qr + 5);
    ctx.moveTo(qx, qy - qr + 4);
    ctx.lineTo(qx, qy - qr - 5);
    ctx.strokeStyle = mark;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(qx, qy, 3.5 + 2.5 * lit, 0, TAU);
    ctx.fillStyle = mark;
    ctx.fill();
    if (lit > 0) glowEllipse(ctx, lx, ly, lr * 1.15 * lit, lr * 1.15 * lit, '#ffffff', A * 0.75 * lit);
    ctx.globalAlpha = A;
  }
  if (g > 0) cracks(ctx, lx, ly, lr * 0.95, 5, 3, '#cfd8dc', A * g);
  ctx.globalAlpha = A;
}

const XR_BODY: BossBody = { w: 3.2, h: 2.5, draw: xrBody, headY: f => f.fy - f.h * 0.86 };

const XR_SLEEPERS = [10, 9];

/**
 * The floor under the machine: the shadow of its ceiling rail joining the four stations (BossDef.spots, in order) and a
 * faint lit pad under each — the shared stage adds the dotted seat rings and the ticks of where each station looks.
 */
const XRAY_STAGE: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const spots = getBoss('xray_machine').spots ?? [];
    if (spots.length < 2) return;
    g.lineJoin = 'round';
    g.beginPath();
    spots.forEach((s, i) => (i === 0 ? g.moveTo(s.x * B.cellX, s.y * B.cellY) : g.lineTo(s.x * B.cellX, s.y * B.cellY)));
    g.closePath();
    g.strokeStyle = 'rgba(6,8,12,0.42)';
    g.lineWidth = 18;
    g.stroke();
    g.setLineDash(XR_SLEEPERS);
    g.strokeStyle = 'rgba(190,200,210,0.3)';
    g.lineWidth = 5;
    g.stroke();
    g.setLineDash(NO_DASH);
    g.fillStyle = B.phase >= 2 ? 'rgba(255,45,45,0.09)' : 'rgba(56,176,0,0.09)';
    for (const s of spots) {
      g.beginPath();
      g.ellipse(s.x * B.cellX, s.y * B.cellY, 2.5 * B.cellX, 2.5 * B.cellY, 0, 0, TAU);
      g.fill();
    }
  },
};

// ─────────────────────────── 멈추지 않는 제세동기 (기획 20차: 배회형 — 쫓아오는 노란 수레) ───────────────────────────

const DF_BASE = '#ffd60a';
/** The skirt along the bottom of the box: the yellow 25 % darker. */
const DF_SKIRT = '#bfa108';
const DF_GREEN = '#06d6a0';
const DF_SCREEN = '#06281f';
const DF_DARK = '#2b2f36';
const DF_STEEL = '#8a929c';
const DF_POINTS = 12;

/** One heartbeat over u 0..1 (−1 = the top of the spike). */
function ecgBeat(u: number): number {
  if (u < 0.3 || u >= 0.58) return 0;
  if (u < 0.38) return -0.18 * Math.sin(((u - 0.3) / 0.08) * Math.PI);
  if (u < 0.44) return 0;
  if (u < 0.48) return -(u - 0.44) / 0.04;
  if (u < 0.54) return -1 + ((u - 0.48) / 0.06) * 1.5;
  return 0.5 - ((u - 0.54) / 0.04) * 0.5;
}

/** A jagged thread of electricity from (x0, y0) to (x1, y1), bowing `sag` px to its side. Sets globalAlpha. */
function dfSpark(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, sag: number, t: number, alpha: number): void {
  const f = Math.floor(t * 24);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d;
  const ny = dx / d;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let k = 1; k < 7; k++) {
    const u = k / 7;
    const off = Math.sin(Math.PI * u) * sag + (hash01(k, f) - 0.5) * 14;
    ctx.lineTo(x0 + dx * u + nx * off, y0 + dy * u + ny * off);
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

/** One paddle held out in front: a dark grip and the bright plate (the plate faces ahead). */
function dfPaddle(ctx: CanvasRenderingContext2D, sx: number, sy: number, px: number, py: number, slack: number): void {
  limb(ctx, sx, sy, px - 8, py, slack, 5, DF_DARK);
  ctx.fillStyle = DF_DARK;
  ctx.fillRect(px - 16, py - 7, 16, 14);
  ctx.fillStyle = '#e9ecef';
  ctx.fillRect(px, py - 16, 8, 32);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(px, py - 16, 8, 32);
}

/** A cart wheel with one spoke that turns as it rolls. */
function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - Math.cos(turn) * (r - 2), y - Math.sin(turn) * (r - 2));
  ctx.lineTo(x + Math.cos(turn) * (r - 2), y + Math.sin(turn) * (r - 2));
  ctx.strokeStyle = '#cfd6dc';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/**
 * The cart, authored facing right: two wheels, a shelf with a push handle at the back, the yellow box with a green ECG
 * face, and two paddles held out in front on cables. Walk: the wheels turn and the box rattles. Wind-up: the paddles
 * rise apart with a thread of electricity between them. Attack: they thrust forward. Groggy: a flat line, the battery
 * lid open, the paddles on the floor.
 */
function dfBody(ctx: CanvasRenderingContext2D, f: BossBodyFrame, o: BossDrawOpts): void {
  const A = 1 - o.retreat;
  const { fx, fy, w, h, pose, p } = f;
  const t = f.time;
  const g = pose === 'groggy' ? p : 0;
  const wind = pose === 'windup' ? p : 0;
  const hit = pose === 'attack' ? Math.sin(p * Math.PI) : 0;
  const red = o.phase >= 2 || o.enraged;
  const trace = red ? '#ff4d4d' : DF_GREEN;
  const rattle = pose === 'walk' ? Math.sin(f.stride * TAU * 2) * 2 : 0;
  const turn = f.stride * TAU * 2;
  const shelf = fy - h * 0.26;
  const top = fy - h * 0.9 + rattle;
  const bl = fx - w * 0.32;
  const bw = w * 0.56;
  const bh = shelf - 3 - top;
  // cart: legs, shelf, push handle, wheels
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.27, fy - 12);
  ctx.lineTo(fx - w * 0.27, shelf);
  ctx.moveTo(fx + w * 0.18, fy - 12);
  ctx.lineTo(fx + w * 0.18, shelf);
  ctx.moveTo(fx - w * 0.37, shelf);
  ctx.lineTo(fx + w * 0.29, shelf);
  ctx.moveTo(fx - w * 0.34, shelf);
  ctx.lineTo(fx - w * 0.45, fy - h * 0.76);
  ctx.lineTo(fx - w * 0.5, fy - h * 0.76);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = DF_STEEL;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineCap = 'butt';
  wheel(ctx, fx - w * 0.27, fy - 11, 11, turn);
  wheel(ctx, fx + w * 0.18, fy - 11, 11, turn + 1.3);
  // the box
  pathRoundRect(ctx, bl, top, bw, bh, 10);
  ctx.fillStyle = tint(DF_BASE, o);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.fillStyle = tint(DF_SKIRT, o);
  ctx.fillRect(bl + 3, top + bh - 12, bw - 6, 9);
  // battery lid on top: shut, or flung open with the dark slot showing
  ctx.fillStyle = DF_DARK;
  if (g > 0) {
    ctx.fillRect(bl + bw * 0.3, top - 1, bw * 0.34, 6);
    ctx.beginPath();
    ctx.moveTo(bl + bw * 0.3, top);
    ctx.lineTo(bl + bw * 0.3 + Math.cos(-0.3 - 1.1 * g) * bw * 0.34, top + Math.sin(-0.3 - 1.1 * g) * bw * 0.34);
    ctx.strokeStyle = DF_DARK;
    ctx.lineWidth = 6;
    ctx.stroke();
  } else ctx.fillRect(bl + bw * 0.3, top - 6, bw * 0.34, 7);
  // the screen: two eyes over the heartbeat (a flat line when knocked down)
  const sx = bl + bw * 0.09;
  const sy = top + bh * 0.1;
  const sw = bw * 0.62;
  const sh = bh * 0.52;
  pathRoundRect(ctx, sx, sy, sw, sh, 6);
  ctx.fillStyle = DF_SCREEN;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const speed = (red ? 1.5 : 1) * (1 + wind);
  const amp = sh * 0.3 * (1 - g) * (1 + 0.3 * wind);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let k = 0; k < DF_POINTS; k++) {
    const u = (((k / (DF_POINTS - 1)) * 1.2 - t * 0.9 * speed) % 1 + 1) % 1;
    const px = sx + 4 + k * ((sw - 8) / (DF_POINTS - 1));
    const py = sy + sh * 0.74 + ecgBeat(u) * amp;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = trace;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const open = blink(t, 4) * (1 - g);
  const look = 3 * (1 - g);
  ctx.fillStyle = trace;
  ctx.beginPath();
  for (let s = 0; s < 2; s++) {
    const ex = sx + sw * (0.34 + 0.34 * s) + look;
    const ey = sy + sh * 0.3;
    ctx.moveTo(ex + 6, ey);
    ctx.ellipse(ex, ey, 6, Math.max(1.5, 6.5 * open), 0, 0, TAU);
  }
  ctx.fill();
  if (red && g < 0.5) {
    // angry brows
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.2 + look, sy + sh * 0.06);
    ctx.lineTo(sx + sw * 0.46 + look, sy + sh * 0.18);
    ctx.moveTo(sx + sw * 0.84 + look, sy + sh * 0.06);
    ctx.lineTo(sx + sw * 0.58 + look, sy + sh * 0.18);
    ctx.strokeStyle = DF_SCREEN;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  // the shock button (blinking while it charges) and the dial that climbs with the charge
  const kx = bl + bw * 0.85;
  ctx.beginPath();
  ctx.arc(kx, top + bh * 0.24, 7.5, 0, TAU);
  ctx.fillStyle = wind > 0 && strobe(t, 12, 4) > 0 ? '#ff9a9a' : '#e63946';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const da = -2.4 + wind * 3.4 + Math.sin(t * 0.7) * 0.15 + g * 1.2;
  ctx.beginPath();
  ctx.arc(kx, top + bh * 0.54, 8.5, 0, TAU);
  ctx.fillStyle = DF_DARK;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(kx, top + bh * 0.54);
  ctx.lineTo(kx + Math.cos(da) * 7, top + bh * 0.54 + Math.sin(da) * 7);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  // the bolt label
  const ly = top + bh * 0.68;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, ly, sw * 0.6, bh * 0.17);
  ctx.beginPath();
  ctx.moveTo(sx + sw * 0.34, ly + 1);
  ctx.lineTo(sx + sw * 0.2, ly + bh * 0.1);
  ctx.lineTo(sx + sw * 0.29, ly + bh * 0.1);
  ctx.lineTo(sx + sw * 0.24, ly + bh * 0.17 - 1);
  ctx.lineTo(sx + sw * 0.4, ly + bh * 0.07);
  ctx.lineTo(sx + sw * 0.31, ly + bh * 0.07);
  ctx.closePath();
  ctx.fillStyle = '#e63946';
  ctx.fill();
  // the paddles, held out in front (they hang to the floor when it is down)
  const bob = Math.sin(t * 1.4) * 3 * (1 - g);
  const reach = fx + w * 0.4 - 7 * wind + w * 0.1 * hit;
  const y1 = top + bh * 0.2 + bob - h * 0.2 * wind;
  const y2 = top + bh * 0.7 - bob + h * 0.1 * wind;
  const p1x = reach + (fx + w * 0.36 - reach) * g;
  const p1y = y1 + (fy - 20 - y1) * g;
  const p2x = reach + 6 + (fx + w * 0.46 - reach - 6) * g;
  const p2y = y2 + (fy - 17 - y2) * g;
  dfPaddle(ctx, bl + bw, top + bh * 0.3, p1x, p1y, -8 - 14 * g);
  dfPaddle(ctx, bl + bw, top + bh * 0.6, p2x, p2y, 8 + 14 * g);
  if (wind > 0.05) dfSpark(ctx, p1x + 4, p1y + 16, p2x + 4, p2y - 16, 10, t, A * wind);
  if (hit > 0) {
    glowEllipse(ctx, p1x + 6, p1y, 14, 24, '#ffffff', A * 0.8 * hit);
    glowEllipse(ctx, p2x + 6, p2y, 14, 24, '#ffffff', A * 0.8 * hit);
  }
  ctx.globalAlpha = A;
}

const DF_BODY: BossBody = { w: 2.9, h: 2.6, draw: dfBody, headY: f => f.fy - f.h * 0.94 };

/** Knocked down: 「LOW BATTERY」 blinks over the open lid, and the monitor whines (screen-aligned: text never mirrors). */
function drawDefibProps(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const cx = cam.sx(x);
  const cy = cam.sy(Math.max(y, 0)) - DF_BODY.h * PX_PER_UNIT;
  const a = (1 - o.retreat) * o.groggy;
  plaque(ctx, cx, cy - 16 + 6 * o.groggy, 112, 22, 'LOW BATTERY', '#e63946', '#ffffff', a * (0.4 + 0.6 * strobe(o.time, 3, 5)), 0.08 * o.groggy);
  plaque(ctx, cx + 86, cy + 26, 54, 26, '삐—', DF_SCREEN, DF_GREEN, a, -0.08);
}

// ─────────────────────────── 빈 병상 행렬 (기획 20차: 배회형 — 달리는 침대 한 대) ───────────────────────────

const EB_BASE = '#dee2e6';
const EB_STAIN = '#9b2226';
const EB_HOLE = '#2a0508';
const EB_STEEL = '#8a929c';
const EB_MATTRESS = '#b9c0c8';

/**
 * The hem of a sheet from (right, y) back to (left, y): n tips like fingers, swaying; `reach` = how far they hang,
 * `back` = px the tips trail behind (the wind of a rush).
 */
function ebHem(ctx: CanvasRenderingContext2D, left: number, right: number, y: number, n: number, reach: number, back: number, t: number, seed: number): void {
  const step = (right - left) / n;
  for (let j = n - 1; j >= 0; j--) {
    ctx.lineTo(left + (j + 0.5) * step - back + Math.sin(t * 1.6 + seed * 1.3 + j * 0.7) * 3, y + reach * (0.55 + 0.45 * hash01(seed, j, 41)));
    ctx.lineTo(left + j * step, y);
  }
}

/** Phase 2: the stain has run into the lower part of the sheet whose outline is the current path (two bands, darker below). */
function ebSoak(ctx: CanvasRenderingContext2D, left: number, right: number, hem: number, alpha: number): void {
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = EB_STAIN;
  ctx.fillRect(left, hem - 22, right - left, 70);
  ctx.fillRect(left, hem - 10, right - left, 58);
  ctx.restore();
}

/** The iron frame of a bed seen from its side: the tall head rail at the back (left), the low foot rail in front, legs, wheels. */
function ebFrame(ctx: CanvasRenderingContext2D, fx: number, fy: number, half: number, deck: number, headTop: number, footTop: number, turn: number, wr: number): void {
  const post = half * 0.16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  // head rail: two posts joined by a bow
  ctx.moveTo(fx - half, fy - wr);
  ctx.lineTo(fx - half, headTop + post * 0.6);
  ctx.quadraticCurveTo(fx - half + post * 0.5, headTop - post * 0.5, fx - half + post, headTop + post * 0.6);
  ctx.lineTo(fx - half + post, deck);
  // foot rail
  ctx.moveTo(fx + half, fy - wr);
  ctx.lineTo(fx + half, footTop + post * 0.6);
  ctx.quadraticCurveTo(fx + half - post * 0.5, footTop - post * 0.5, fx + half - post, footTop + post * 0.6);
  ctx.lineTo(fx + half - post, deck);
  // the deck under the mattress
  ctx.moveTo(fx - half, deck);
  ctx.lineTo(fx + half, deck);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(4, half * 0.085);
  ctx.stroke();
  ctx.strokeStyle = EB_STEEL;
  ctx.lineWidth = Math.max(2, half * 0.04);
  ctx.stroke();
  ctx.lineCap = 'butt';
  wheel(ctx, fx - half, fy - wr, wr, turn);
  wheel(ctx, fx + half, fy - wr, wr, turn + 1.3);
}

/**
 * One long iron bed, authored facing right (it runs foot end first): the sheet is crumpled into a person sitting up at
 * the back, stains for a face. Walk: the wheels creak round. Wind-up: the sheet streams back, the mouth opens.
 * Attack: the figure lunges. Groggy: the bed tips back on its rear wheels, the front ones spinning in the air.
 */
function ebBody(ctx: CanvasRenderingContext2D, f: BossBodyFrame, o: BossDrawOpts): void {
  const A = 1 - o.retreat;
  const { fx, fy, w, h, pose, p } = f;
  const t = f.time;
  const g = pose === 'groggy' ? p : 0;
  const wind = pose === 'windup' ? p : 0;
  const hit = pose === 'attack' ? Math.sin(p * Math.PI) : 0;
  const half = w * 0.44;
  const wr = 8;
  const deck = fy - h * 0.4;
  const mat = fy - h * 0.52;
  const sheet = tint(EB_BASE, o);
  const turn = pose === 'groggy' ? t * 9 : f.stride * TAU * 2;
  ctx.save();
  if (g > 0) {
    // tipped back over its rear wheel
    ctx.translate(fx - half, fy - wr);
    ctx.rotate(-0.5 * g);
    ctx.translate(-(fx - half), -(fy - wr));
  }
  ebFrame(ctx, fx, fy, half, deck, fy - h * 0.92, fy - h * 0.68, turn, wr);
  // mattress
  ctx.fillStyle = EB_MATTRESS;
  ctx.fillRect(fx - half + 4, mat, half * 2 - 8, deck - mat);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(fx - half + 4, mat, half * 2 - 8, deck - mat);
  // the sheet: a figure sitting up at the back, its legs a ridge toward the foot end, the hem hanging in tips
  const lean = w * 0.05 * wind + w * 0.09 * hit - w * 0.03 * g;
  const hx = fx - w * 0.2 + lean;
  const ht = fy - h * 0.99 + h * 0.16 * g - h * 0.05 * wind + Math.sin(t * 1.1) * 1.5;
  const hr = w * 0.13;
  // the hem stops above the legs: the wheels and the iron frame must show under it (it is a bed, not a ghost)
  const hem = fy - h * 0.36 - h * 0.06 * wind;
  const reach = h * 0.1 + Math.sin(t * 1.2) * 2 + h * 0.1 * hit - h * 0.03 * wind + h * 0.05 * g;
  const left = fx - half - 5;
  const right = fx + half + 4;
  ctx.beginPath();
  ctx.moveTo(left, hem);
  ctx.lineTo(left + 2, mat - 2);
  ctx.quadraticCurveTo(hx - hr * 1.5, mat - h * 0.1, hx - hr, ht + hr * 1.1);
  ctx.bezierCurveTo(hx - hr, ht - hr * 0.35, hx + hr, ht - hr * 0.35, hx + hr, ht + hr * 1.1);
  ctx.bezierCurveTo(hx + hr * 1.2, mat - h * 0.02, fx + w * 0.04, mat - h * 0.2, fx + w * 0.14, mat - h * 0.17);
  ctx.quadraticCurveTo(fx + w * 0.32, mat - h * 0.12, right - 2, mat - 3);
  ctx.lineTo(right, hem);
  ebHem(ctx, left, right, hem, 7, reach, w * 0.09 * wind + w * 0.04 * hit, t, 9);
  ctx.closePath();
  ctx.fillStyle = sheet;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  if (o.phase >= 2) ebSoak(ctx, left - 12, right + 6, hem, A);
  ctx.globalAlpha = A;
  // the face looks ahead: stain eyes with dark holes, a mouth that opens on the wind-up, tears running down
  const open = blink(t, 5) * (1 - g);
  const ex = hx + hr * 0.2;
  const ey = ht + hr * 0.75;
  const eo = hr * 0.5;
  ctx.fillStyle = EB_STAIN;
  ctx.beginPath();
  ctx.ellipse(ex - eo * 0.55, ey, 5.5, Math.max(2, 6 * open), 0.2, 0, TAU);
  ctx.moveTo(ex + eo + 5.5, ey);
  ctx.ellipse(ex + eo, ey, 5.5, Math.max(2, 6 * open), -0.2, 0, TAU);
  ctx.moveTo(ex + eo * 0.3 + 7, ey + hr * 0.8);
  ctx.ellipse(ex + eo * 0.3, ey + hr * 0.8, 7 + 2 * wind, 3.5 + 6 * Math.max(wind, hit), 0, 0, TAU);
  ctx.fill();
  if (open > 0.3) {
    ctx.fillStyle = EB_HOLE;
    ctx.beginPath();
    ctx.arc(ex - eo * 0.55 + 1.5, ey, 3, 0, TAU);
    ctx.moveTo(ex + eo + 4.5, ey);
    ctx.arc(ex + eo + 1.5, ey, 3, 0, TAU);
    ctx.fill();
  }
  if (g < 1) dripRow(ctx, ex - eo, ey + 5, eo * 2.2, 2, h * 0.2, t * 0.5, EB_STAIN, A * 0.9 * (1 - g));
  ctx.restore();
  ctx.globalAlpha = A;
}

const EB_BODY: BossBody = { w: 3.2, h: 2, draw: ebBody, headY: f => f.fy - f.h * 1.02 };

/**
 * 빈 침대 (a summon of 행렬): a small bare bed — striped mattress, no sheet, nobody on it — so it never reads as the
 * boss. s = the way it faces; act = its swing / rush (it lurches forward).
 */
const bedDecoy: CreatureDrawFn = (ctx, fill, flash, fx, fy, w, h, s, time, phase, act) => {
  const half = w * 0.5;
  const bh = h * 0.42;
  const wr = Math.max(3, w * 0.07);
  const x = fx + s * act * w * 0.1;
  const y = fy - Math.abs(Math.sin(time * 7 + phase)) * 2 * (1 - act);
  const deck = y - wr * 2 - bh * 0.18;
  const mat = deck - bh * 0.3;
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(s, 1);
  ebFrame(ctx, 0, y, half * 0.92, deck, y - bh * 1.15, y - bh * 0.8, time * (3 + 9 * act) + phase, wr);
  ctx.fillStyle = flash ? '#ffffff' : fill;
  ctx.fillRect(-half * 0.86, mat, half * 1.72, deck - mat);
  // ticking stripes of a bare mattress
  ctx.beginPath();
  for (let k = 1; k < 5; k++) {
    ctx.moveTo(-half * 0.86 + (k * half * 1.72) / 5, mat + 1);
    ctx.lineTo(-half * 0.86 + (k * half * 1.72) / 5, deck - 1);
  }
  ctx.strokeStyle = '#5c6670';
  ctx.lineWidth = Math.max(1.5, w * 0.025);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, w * 0.02);
  ctx.strokeRect(-half * 0.86, mat, half * 1.72, deck - mat);
  ctx.restore();
};

// ─────────────────────────── registry ───────────────────────────

/** Boss id → look. 기획 20차: the three moving bosses are bodies (drawn in the arena); the 서랍 keeps its set piece. */
export const WARD_LOOKS: Record<string, BossLook> = {
  morgue_drawers: { draw: drawMorgueDrawers, color: MD_BASE, headY: (by, _R, g) => by + 8 + 14 * g, props: drawMorgueProps, stage: MORGUE_STAGE },
  xray_machine: { draw: asSetPiece(XR_BODY), color: XR_BASE, body: XR_BODY, stage: XRAY_STAGE },
  defibrillator: { draw: asSetPiece(DF_BODY), color: DF_BASE, body: DF_BODY, props: drawDefibProps },
  empty_beds: { draw: asSetPiece(EB_BODY), color: EB_BASE, body: EB_BODY },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const WARD_TELE_MOTIF: Record<string, TeleMotif> = {
  md_wake: 'spawn',
  eb_procession: 'spawn',
};

/** MonsterDef.look → the body of this zone's summon-only units (빈 침대: 빈 병상 행렬의 행렬). */
export const WARD_MINION_LOOKS: Record<string, CreatureDrawFn> = { bed_decoy: bedDecoy };

/** 기획 20차: Zone.look → fill / edge of this zone's trail zones (none: no ward boss leaves a trail). */
export const WARD_ZONE_LOOKS: Record<string, { fill: string; edge?: string }> = {};
