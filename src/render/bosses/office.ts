// 기획 19차 보스 레이드 — 사무실 boss looks (docs/bosses.md 5장). This zone's track owns this file.
// Bosses: shredder_maw 문서 파쇄기 · coffee_machine 식지 않는 커피 머신 · dead_monitor 퇴근 못 한 모니터 · endless_meeting 끝나지 않는 회의.
//
// 기획 20차 보스 형태: the four are MOVING BODIES now (BossLook.body, drawn by bosses/body.ts among the characters) —
// about half the size of the old set pieces, authored facing right in a box that stands on the foot point:
//   파쇄기 (roaming)       a LOW black shredder: steel-blue hood and a toothed maw in front, the clear paper bin it drags
//                          behind glows yellow (the weak back). It inches along; the maw gapes as it winds up.
//   커피 머신 (roaming)     a TALL thin silver machine waddling on its drip tray, a wobbling cup tower on its head, steam
//                          out of both side nozzles (its 스팀 comes out of its sides).
//   모니터 (relocating)    a beige CRT on its own small desk; the REAL one has a face, a blinking block cursor and two
//                          live cables. Its fake (가짜 창, a summon) is the same desk + CRT frozen on an hourglass.
//   회의 (relocating)      a faceless chairman on a wheeled chair, agenda sheets circling him; he stands and points a
//                          laser the way he will hand out the agenda.
// Floor art (BossLook.stage): the three desks and the cable between them (모니터); the long table (회의). 커피 머신's route
// and the seats are drawn by the shared stage code from the data; 파쇄기's shield / weak arcs by the shared body frame.
// Summon looks (keyed by MonsterDef.look): fake_monitor. Zone looks (Zone.look): coffee. Warning motifs (skill id →
// motif): cf_pour / cf_overflow linger · dm_alt_tab spawn.
//
// Art rules of a body (bosses/types.ts): no fillText (the canvas is mirrored), ≤ 220 canvas calls a frame, no gradient /
// shadowBlur / Math.random, read only the frame + BossDrawOpts + hash01. Colours: every mix starts from a hex literal
// with a stepped amount (the colour cache) — hence tint() below. Groggy signs (props) are screen-aligned: text is fine.
// Checks: npx vitest run tests/render (boss-body.test.ts: every pose, both sides; boss-looks.test.ts: the set-piece path).
// See them: node tests/visual/boss-sheet.mjs only=shredder_maw,… · /?mode=bossRaid&boss=<id>

import { getBoss } from '../../data';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { asSetPiece } from './body';
import { TAU, bigEye, blink, dripRow, hash01, limb, mix, pathRoundRect, plaque, stack, strobe } from './kit';
import type { BossBody, BossBodyFrame, BossDrawFn, BossDrawOpts, BossLook, BossStageLook, CreatureDrawFn, TeleMotif, ZoneLook } from './types';

type Ctx = CanvasRenderingContext2D;

const INK = '#0b0c0e';

/** Phase / enrage tint in ONE mix from a hex colour: +12 % red per phase after the first, +30 % while enraged. */
function tint(hex: string, o: BossDrawOpts): string {
  const k = Math.min(3, Math.max(1, o.phase)) - 1;
  const amount = 0.12 * k + (o.enraged ? 0.3 : 0);
  return amount > 0 ? mix(hex, '#ff1038', amount) : hex;
}

/** A glowing lamp eye: dark socket, a lit disc, a slit that looks along lx / ly. open 0 = a shut line. */
function lampEye(ctx: Ctx, x: number, y: number, r: number, lx: number, ly: number, open: number, color: string): void {
  const ry = r * 0.82 * Math.max(0, open);
  ctx.fillStyle = '#050506';
  ctx.beginPath();
  ctx.ellipse(x, y, r + 3, Math.max(2.5, ry + 3), 0, 0, TAU);
  ctx.fill();
  if (ry < 2) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#050506';
  ctx.beginPath();
  ctx.ellipse(x + lx * r * 0.42, y + ly * ry * 0.4, r * 0.24, ry * 0.72, 0, 0, TAU);
  ctx.fill();
}

/** How far a body is into its wind-up (0..1): it opens up in the first third of the pose and holds. */
const windOf = (f: BossBodyFrame): number => (f.pose === 'windup' ? Math.min(1, f.p * 3) : 0);
/** The swing of an attack pose (0 → 1 → 0). */
const swingOf = (f: BossBodyFrame): number => (f.pose === 'attack' ? Math.sin(f.p * Math.PI) : 0);
/** How far down a body is (0..1). */
const downOf = (f: BossBodyFrame): number => (f.pose === 'groggy' ? f.p : 0);

/**
 * Where a groggy sign of a moving body hangs: the body's foot line on screen. A set piece's spot (y < 0, the sheet
 * tools) stands on the arena's back edge, exactly as bosses/body.ts asSetPiece draws it.
 */
function signBase(cam: Camera, y: number, body: BossBody): number {
  const h = body.h * PX_PER_UNIT;
  return cam.sy(Math.max(y, 0)) + (y < 0 ? h * 0.6 : 0);
}

// ─────────────────────────── 문서 파쇄기 (shredder_maw) ───────────────────────────
// base #212529 · accent #ffd60a (eyes, the weak bin) · steel #9db4c8 (the hood = the front shield) · light #f8f9fa (paper).
// A low body: the bin at the back, the box, the two jaws in front.

const SH_BASE = '#212529';
const SH_EDGE = '#868e96';
const SH_ACCENT = '#ffd60a';
const SH_PAPER = '#f8f9fa';
const SH_STEEL = '#9db4c8';

/** Teeth along (x0, y0) → (x1, y1), pointing to its right-hand side (side +1 = down for a left-to-right jaw). One fill. */
function jawTeeth(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, n: number, len: number, side: number, color: string): void {
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * len * side;
  const ny = (dx / l) * len * side;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ax = x0 + dx * i;
    const ay = y0 + dy * i;
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + dx / 2 + nx, ay + dy / 2 + ny);
    ctx.lineTo(ax + dx, ay + dy);
  }
  ctx.fill();
}

/** What the three views of the shredder share for one frame (reused object: read at once). */
const SH = { A: 1, down: 0, awake: 1, wind: 0, snap: 0, crawl: 0, buzz: 0, pulse: 0, steel: SH_STEEL, tooth: '#eef1f4', tl: 8 };

function shredderPose(f: BossBodyFrame, o: BossDrawOpts): typeof SH {
  SH.A = 1 - o.retreat;
  SH.down = downOf(f);
  SH.awake = 1 - SH.down;
  SH.wind = windOf(f);
  SH.snap = swingOf(f);
  SH.crawl = f.pose === 'walk' ? Math.sin(f.stride * TAU) : 0;
  SH.buzz = Math.sin(f.time * 31) * (0.5 + 1.5 * SH.wind) * SH.awake;
  SH.pulse = 0.5 + 0.5 * Math.sin(f.time * 6);
  // the hood stays steel (it is the shield) and goes dull when a groggy break switches the shield off
  SH.steel = SH.down > 0.5 ? '#6f7f8d' : SH_STEEL;
  SH.tooth = o.enraged || SH.wind > 0.5 ? '#ff9d8f' : '#eef1f4';
  SH.tl = 8 + 4 * SH.wind;
  return SH;
}

/** The clear paper bin: glowing yellow (the weak back), shreds wriggling inside, a dark lid. */
function shredderBin(ctx: Ctx, x: number, y: number, bw: number, bh: number, t: number, o: BossDrawOpts): void {
  const { A, awake, pulse } = SH;
  pathRoundRect(ctx, x, y, bw, bh, 7);
  ctx.globalAlpha = A * 0.5;
  ctx.fillStyle = '#dfe6ee';
  ctx.fill();
  ctx.globalAlpha = A * (0.22 + 0.2 * pulse);
  ctx.fillStyle = SH_ACCENT;
  ctx.fill();
  ctx.globalAlpha = A;
  ctx.strokeStyle = SH_ACCENT;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = o.phase >= 2 ? '#ffd9de' : SH_PAPER;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const sx = x + 8 + (i * (bw - 16)) / 5;
    const sy = y + 12 + hash01(i, 42) * 12;
    const wob = Math.sin(t * (3 + hash01(i, 41) * 3) + i * 1.9) * 5 * awake;
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + wob, sy + 9, sx - wob * 0.6, sy + 18 + hash01(i, 43) * 8);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#343a40';
  ctx.fillRect(x - 2, y - 4, bw + 4, 6);
}

/** The box (x0 … x1) on three stepping rubber feet, with its vent, hazard strip and status lamp. */
function shredderBox(ctx: Ctx, f: BossBodyFrame, x0: number, x1: number, top: number, bottom: number, o: BossDrawOpts): void {
  ctx.fillStyle = INK;
  for (let i = 0; i < 3; i++) {
    const lift = f.pose === 'walk' ? Math.max(0, Math.sin(f.stride * TAU + i * 2.1)) * 4 : 0;
    ctx.fillRect(x0 + 6 + (i * (x1 - x0 - 24)) / 2, bottom - lift, 12, 8);
  }
  pathRoundRect(ctx, x0, top, x1 - x0, bottom - top, 10);
  ctx.fillStyle = tint(SH_BASE, o);
  ctx.fill();
  ctx.strokeStyle = SH_EDGE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = tint('#343a40', o);
  ctx.fillRect(x0 + 8, top + 6, x1 - x0 - 16, 5);
  ctx.fillStyle = SH_ACCENT;
  ctx.fillRect(x0 + 6, bottom - 12, x1 - x0 - 12, 4);
  // status lamp: green, red and blinking once it jams
  const jam = SH.down > 0 || o.groggyNear > 0;
  ctx.fillStyle = jam ? (strobe(f.time, 6, 7) > 0 ? '#ff3b30' : '#5c1210') : '#52d273';
  ctx.beginPath();
  ctx.arc(x0 + 13, top + 22, 5, 0, TAU);
  ctx.fill();
}

/** Seen from the side (it faces left or right): the bin behind, the box, the two jaws in front. */
function shredderSide(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h, time: t } = f;
  const { A, down, awake, wind, snap, crawl, buzz } = SH;
  const binW = w * 0.33;
  const binH = h * 0.58;
  const binX = fx - w * 0.49 - crawl * w * 0.02;
  shredderBin(ctx, binX, fy - 10 - binH, binW, binH, t, o);
  // wheels and the hitch to the box
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(binX + 10, fy - 6, 6, 0, TAU);
  ctx.arc(binX + binW - 10, fy - 6, 6, 0, TAU);
  ctx.fill();
  const boxL = fx - w * 0.13 + crawl * w * 0.015;
  ctx.fillRect(binX + binW, fy - 30, boxL - binX - binW + 2, 6);
  // the box humps up as it inches forward
  const boxR = fx + w * 0.22;
  const boxTop = fy - h * 0.84 - 4 * Math.max(0, crawl) + buzz * 0.4;
  const boxB = fy - 8;
  shredderBox(ctx, f, boxL, boxR, boxTop, boxB, o);

  // the maw: a hinge on the box, the steel hood above, the lower jaw below
  const hx = fx + w * 0.1;
  const hy = fy - h * 0.44 + buzz;
  const tipX = fx + w * 0.49 + 5 * snap;
  const gape = ((5 + 2 * Math.sin(t * 2.2)) * awake + 20 * wind + 6 * down) * (1 - 0.8 * snap);
  const upY = hy - gape - 2;
  const loY = hy + gape * 0.8 + 2;
  ctx.beginPath();
  ctx.moveTo(hx - 4, hy);
  ctx.lineTo(tipX - 2, upY);
  ctx.lineTo(tipX - 5, loY);
  ctx.closePath();
  ctx.fillStyle = '#050506';
  ctx.fill();
  if (wind > 0) {
    ctx.globalAlpha = A * 0.6 * wind;
    ctx.fillStyle = '#ff3b30';
    ctx.fill();
    ctx.globalAlpha = A;
  }
  // a sheet half eaten, hanging out like a tongue (pulled in as it winds up) — or the wad that jams it
  if (down > 0.3) {
    ctx.fillStyle = SH_PAPER;
    ctx.beginPath();
    ctx.ellipse(tipX - 22, hy + 1, 17, 9, 0.2, 0, TAU);
    ctx.ellipse(tipX - 4, hy + 3, 13, 8, -0.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const out = 16 * (1 - wind) + Math.sin(t * 9) * 2;
    ctx.fillStyle = SH_PAPER;
    ctx.beginPath();
    ctx.moveTo(hx + 12, hy - 3);
    ctx.lineTo(tipX + out, hy - 2);
    ctx.lineTo(tipX + out + 3, hy + 9 + out * 0.5);
    ctx.lineTo(tipX - 8, hy + 5);
    ctx.lineTo(hx + 12, hy + 3);
    ctx.closePath();
    ctx.fill();
  }
  // lower jaw
  ctx.beginPath();
  ctx.moveTo(hx - 4, hy + 2);
  ctx.lineTo(tipX - 5, loY);
  ctx.lineTo(tipX - 9, loY + 11);
  ctx.lineTo(boxR - 4, boxB);
  ctx.lineTo(hx - 12, boxB);
  ctx.closePath();
  ctx.fillStyle = tint('#343a40', o);
  ctx.fill();
  ctx.strokeStyle = SH_EDGE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // the steel hood (upper jaw): the front shield
  ctx.beginPath();
  ctx.moveTo(boxR - 16, boxTop + 3);
  ctx.lineTo(tipX - 12, upY - 20);
  ctx.lineTo(tipX, upY - 7);
  ctx.lineTo(tipX - 2, upY);
  ctx.lineTo(hx - 4, hy - 2);
  ctx.closePath();
  ctx.fillStyle = SH.steel;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.globalAlpha = A * 0.55;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(boxR - 6, boxTop + 9);
  ctx.lineTo(tipX - 14, upY - 15);
  ctx.stroke();
  ctx.globalAlpha = A;
  // two rows of teeth chewing against each other
  jawTeeth(ctx, hx + 8, hy - 2 - gape * 0.12, tipX - 2, upY, 6, SH.tl, 1, SH.tooth);
  jawTeeth(ctx, hx + 8, hy + 2 + gape * 0.1, tipX - 5, loY, 6, SH.tl, -1, SH.tooth);

  // lamp eyes on the box, looking ahead: two, four from phase 2
  const eyeCol = o.enraged ? '#ff5a3c' : SH_ACCENT;
  const open = blink(t, 2) * awake;
  lampEye(ctx, fx + w * 0.09, boxTop + h * 0.2, 9, 0.7, 0.1, open, eyeCol);
  lampEye(ctx, fx - w * 0.03, boxTop + h * 0.19, 6.5, 0.7, 0.1, open, eyeCol);
  if (o.phase >= 2) {
    lampEye(ctx, fx + w * 0.16, boxTop + h * 0.36, 6, 0.7, 0.2, open, eyeCol);
    lampEye(ctx, fx + w * 0.02, boxTop + h * 0.37, 5, 0.7, 0.2, open, eyeCol);
  }
  if (snap > 0.05) {
    // the bite: strips fly out of the maw
    ctx.globalAlpha = A * snap;
    ctx.fillStyle = SH_PAPER;
    for (let i = 0; i < 6; i++) ctx.fillRect(tipX + 6 + hash01(i, 51) * 34 * snap, hy - 18 + hash01(i, 52) * 36, 12, 4);
    ctx.globalAlpha = A;
  }
}

/** Seen from the front (it faces the camera): the hood over a slot as wide as the box — the bin only peeks over its back. */
function shredderFront(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h, time: t } = f;
  const { A, down, awake, wind, snap, crawl, buzz, pulse } = SH;
  const bw = w * 0.6;
  const boxTop = fy - h * 0.88 - 3 * Math.max(0, crawl) + buzz * 0.4;
  const boxB = fy - 8;
  // the bin behind it
  ctx.globalAlpha = A * (0.45 + 0.25 * pulse);
  ctx.fillStyle = SH_ACCENT;
  ctx.fillRect(fx - bw * 0.34, boxTop - 11, bw * 0.68, 14);
  ctx.globalAlpha = A;
  ctx.fillStyle = '#343a40';
  ctx.fillRect(fx - bw * 0.36, boxTop - 14, bw * 0.72, 5);
  shredderBox(ctx, f, fx - bw / 2, fx + bw / 2, boxTop, boxB, o);
  // lamp eyes over the hood, looking at you
  const eyeCol = o.enraged ? '#ff5a3c' : SH_ACCENT;
  const open = blink(t, 2) * awake;
  lampEye(ctx, fx - bw * 0.2, boxTop + h * 0.22, 9, 0, 0.5, open, eyeCol);
  lampEye(ctx, fx + bw * 0.2, boxTop + h * 0.22, 9, 0, 0.5, open, eyeCol);
  if (o.phase >= 2) {
    lampEye(ctx, fx - bw * 0.38, boxTop + h * 0.3, 5.5, 0, 0.5, open, eyeCol);
    lampEye(ctx, fx + bw * 0.38, boxTop + h * 0.3, 5.5, 0, 0.5, open, eyeCol);
  }
  // the slot
  const my = fy - h * 0.3 + buzz;
  const mw = bw * 0.5;
  const gape = ((4 + 1.5 * Math.sin(t * 2.2)) * awake + 13 * wind + 4 * down) * (1 - 0.8 * snap);
  ctx.fillStyle = '#050506';
  ctx.fillRect(fx - mw, my - gape, mw * 2, gape * 2 + 5);
  if (wind > 0) {
    ctx.globalAlpha = A * 0.6 * wind;
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(fx - mw, my - gape, mw * 2, gape * 2 + 5);
    ctx.globalAlpha = A;
  }
  ctx.fillStyle = SH_PAPER;
  if (down > 0.3) {
    ctx.beginPath();
    ctx.ellipse(fx - 9, my + 2, 17, 9, 0.2, 0, TAU);
    ctx.ellipse(fx + 12, my + 3, 13, 8, -0.3, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillRect(fx - 15, my, 30, 8 + 18 * (1 - wind) + Math.sin(t * 9) * 2);
  }
  // lower lip, then the steel hood jutting out over the slot (the front shield)
  ctx.fillStyle = tint('#343a40', o);
  ctx.fillRect(fx - mw - 5, my + gape + 4, mw * 2 + 10, 9);
  ctx.beginPath();
  ctx.moveTo(fx - mw - 2, my - gape - 17);
  ctx.lineTo(fx + mw + 2, my - gape - 17);
  ctx.lineTo(fx + mw + 9, my - gape);
  ctx.lineTo(fx - mw - 9, my - gape);
  ctx.closePath();
  ctx.fillStyle = SH.steel;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.globalAlpha = A * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(fx - mw + 4, my - gape - 13, mw * 2 - 8, 3);
  ctx.globalAlpha = A;
  jawTeeth(ctx, fx - mw, my - gape, fx + mw, my - gape, 8, SH.tl, 1, SH.tooth);
  jawTeeth(ctx, fx - mw, my + gape + 5, fx + mw, my + gape + 5, 8, SH.tl, -1, SH.tooth);
  if (snap > 0.05) {
    ctx.globalAlpha = A * snap;
    ctx.fillStyle = SH_PAPER;
    for (let i = 0; i < 6; i++) ctx.fillRect(fx - mw + hash01(i, 51) * mw * 2, my + 14 + hash01(i, 52) * 26 * snap, 4, 12);
    ctx.globalAlpha = A;
  }
}

/** Seen from behind (it faces away): the glowing bin is right in front of you — this is where to hit it. */
function shredderBack(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h, time: t } = f;
  const { crawl, buzz } = SH;
  const bw = w * 0.6;
  const boxTop = fy - h * 0.92 - 3 * Math.max(0, crawl) + buzz * 0.4;
  // the tip of the hood beyond the box
  ctx.fillStyle = SH.steel;
  ctx.fillRect(fx - bw * 0.3, boxTop - 7, bw * 0.6, 10);
  shredderBox(ctx, f, fx - bw / 2, fx + bw / 2, boxTop, fy - 16, o);
  // the hitch and the bin, right in front
  const binW = w * 0.42;
  const binH = h * 0.6;
  ctx.fillStyle = INK;
  ctx.fillRect(fx - 4, fy - 12 - binH - 6, 8, 10);
  shredderBin(ctx, fx - binW / 2, fy - 9 - binH, binW, binH, t, o);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(fx - binW / 2 + 9, fy - 6, 6, 0, TAU);
  ctx.arc(fx + binW / 2 - 9, fy - 6, 6, 0, TAU);
  ctx.fill();
}

/**
 * Which side of it we see: 0 = its flank (mirrored by the shared frame), 1 = its front (it faces the camera), −1 = its
 * back. Its nose has to point SH_TURN.in up / down the screen (sin of the facing) to switch, and come back under
 * SH_TURN.out to switch back — so a slow turn never flickers between two views.
 */
const SH_TURN = { in: 0.7, out: 0.5 };
let shView = 0;

function shredderBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  shredderPose(f, o);
  const toward = Math.sin(f.facing);
  if (Math.abs(toward) > SH_TURN.in) shView = toward > 0 ? 1 : -1;
  else if (Math.abs(toward) < SH_TURN.out || toward * shView < 0) shView = 0;
  if (shView > 0) shredderFront(ctx, f, o);
  else if (shView < 0) shredderBack(ctx, f, o);
  else shredderSide(ctx, f, o);
}

const SH_BODY: BossBody = { w: 3.1, h: 1.75, draw: shredderBody, headY: f => f.fy - f.h * 0.92 };

const shredderProps: BossDrawFn = (ctx, cam, x, y, _radius, o) => {
  const base = signBase(cam, y, SH_BODY);
  plaque(ctx, cam.sx(x), base - SH_BODY.h * PX_PER_UNIT - 14, 118, 30, '용지 걸림', '#d00000', '#ffffff', (1 - o.retreat) * o.groggy * (0.65 + 0.35 * strobe(o.time, 4, 3)), -0.05);
};

// ─────────────────────────── 식지 않는 커피 머신 (coffee_machine) ───────────────────────────
// base #adb5bd · accent #e63946 (lamp, gauge) · light #ffffff (cups, steam). A tall thin body; the two spouts are its eyes.

const CF_BASE = '#adb5bd';
const CF_DARK = '#6c757d';
const CF_ACCENT = '#e63946';
const COFFEE = '#5b3a1e';

function coffeeBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { w, h, time: t } = f;
  const A = 1 - o.retreat;
  const down = downOf(f);
  const awake = 1 - down;
  const wind = windOf(f);
  const spray = swingOf(f);
  const sway = f.pose === 'walk' ? Math.sin(f.stride * TAU) : 0;
  const hotSteam = o.phase >= 2 || o.enraged;
  const hw = w * 0.37;

  // the two feet under the tray waddle; everything above leans with them (and slumps back when it is down)
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(f.fx - w * 0.2, f.fy - 4 - 5 * Math.max(0, sway), 13, 6, 0, 0, TAU);
  ctx.ellipse(f.fx + w * 0.2, f.fy - 4 - 5 * Math.max(0, -sway), 13, 6, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(f.fx, f.fy - 6);
  ctx.rotate(sway * 0.07 - 0.14 * down + Math.sin(t * 43) * 0.012 * wind);

  // drip tray
  ctx.fillStyle = tint('#495057', o);
  ctx.fillRect(-w * 0.5, -14, w, 12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-w * 0.5, -14, w, 12);
  ctx.fillStyle = INK;
  for (let i = 0; i < 4; i++) ctx.fillRect(-w * 0.36 + i * w * 0.2, -10, w * 0.12, 3);

  // steam off both side nozzles (red from phase 2; a jet while it winds up)
  const top = -h * 0.74;
  ctx.globalAlpha = A * (0.35 + 0.55 * wind) * awake;
  ctx.strokeStyle = hotSteam ? '#ff8fa3' : '#ffffff';
  ctx.lineWidth = 5 + 3 * wind;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1;
    const sx = side * (hw + 9);
    const sy = top + h * 0.26 + (i % 2) * 6;
    const far = 14 + 30 * wind + (i % 2) * 8;
    const rise = 30 + (i % 2) * 14;
    const w1 = Math.sin(t * 2.3 + i * 1.7) * 9;
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + side * far * 0.5, sy - rise * 0.2 + w1, sx + side * far - w1, sy - rise * 0.6, sx + side * far + w1 * 0.5, sy - rise);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = A;
  // the nozzles themselves
  ctx.fillStyle = '#f1f3f5';
  ctx.fillRect(-hw - 10, top + h * 0.25, 12, 9);
  ctx.fillRect(hw - 2, top + h * 0.25, 12, 9);

  // the column
  pathRoundRect(ctx, -hw, top, hw * 2, h * 0.74 - 14, 16);
  ctx.fillStyle = tint(CF_BASE, o);
  ctx.fill();
  ctx.strokeStyle = '#343a40';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = A * 0.5;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-hw + 7, top + 14, 6, h * 0.42);
  ctx.globalAlpha = A;
  // cup bay with the cup that is always full
  const bayT = -h * 0.33;
  ctx.fillStyle = '#16181b';
  ctx.fillRect(-hw * 0.62, bayT, hw * 1.24, h * 0.33 - 18);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-12, bayT + 16);
  ctx.lineTo(12, bayT + 16);
  ctx.lineTo(8, -18);
  ctx.lineTo(-8, -18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COFFEE;
  ctx.fillRect(-11, bayT + 16, 22, 4);
  dripRow(ctx, -5, bayT + 2, 10, down > 0 ? 3 : 1, 14, t, COFFEE, A);
  ctx.globalAlpha = A;
  if (o.phase >= 2) {
    // 넘침: coffee runs over the tray and down the column
    ctx.fillStyle = COFFEE;
    ctx.fillRect(-w * 0.5, -17, w, 5);
    ctx.fillRect(-hw + 16, top + 4, 7, h * 0.2 + Math.sin(t * 1.9) * 6);
    ctx.fillRect(hw - 20, top + 4, 6, h * 0.3 + Math.sin(t * 1.4 + 1) * 8);
    dripRow(ctx, -w * 0.5, -3, w, 4, 10, t, COFFEE, A);
    ctx.globalAlpha = A;
  }

  // the face: red lamp, pressure gauge, two spout eyes in chrome rings — shifted toward its front
  const lit = wind > 0.2 || o.enraged || strobe(t, 2, 4, 0.3) > 0;
  ctx.fillStyle = down > 0 ? '#5c1210' : lit ? CF_ACCENT : '#8d2f36';
  ctx.beginPath();
  ctx.arc(-hw + 12, top + 15, 5 + 2 * wind, 0, TAU);
  ctx.fill();
  const gx = hw * 0.3;
  const gy = top + 17;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(gx, gy, 10, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#343a40';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.strokeStyle = CF_ACCENT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(gx, gy, 6.5, -0.9, 0.5);
  ctx.stroke();
  const needle = Math.min(0.5, -2.5 + Math.sin(t * 1.7) * 0.25 + 2.7 * wind + (o.enraged ? 2.2 : 0)) * awake - 2.9 * down;
  ctx.strokeStyle = '#16181b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + Math.cos(needle) * 8, gy + Math.sin(needle) * 8);
  ctx.stroke();
  const ey = top + h * 0.25;
  const er = 9 + 2 * wind;
  ctx.strokeStyle = '#f1f3f5';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(-hw * 0.3, ey, 13, 0, TAU);
  ctx.moveTo(hw * 0.5 + 13, ey);
  ctx.arc(hw * 0.5, ey, 13, 0, TAU);
  ctx.stroke();
  const open = blink(t, 3) * awake;
  bigEye(ctx, -hw * 0.3, ey, er, 0.6, 0.15, hotSteam, A, open);
  bigEye(ctx, hw * 0.5, ey, er, 0.6, 0.15, hotSteam, A, open);

  // the cap and the cup tower on its head: it leans a little more with every step
  ctx.fillStyle = tint(CF_DARK, o);
  ctx.fillRect(-hw - 3, top - 5, hw * 2 + 6, 10);
  stack(ctx, -hw * 0.25, top - 5, 26, 7, down > 0.5 ? 2 : 4, '#ffffff', '#868e96', 1.2 + sway * 1.6 + Math.sin(t * 1.1) * 0.5 * awake + 3 * down);

  if (spray > 0.05) {
    // attack: both nozzles spray
    ctx.globalAlpha = A * spray;
    ctx.strokeStyle = COFFEE;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1;
      ctx.moveTo(side * (hw + 8), top + h * 0.28);
      ctx.lineTo(side * (hw + 34 + 16 * spray), top + h * 0.28 + ((i % 2) * 2 - 1) * 14);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.restore();
}

// 2.6 cells tall (docs 5-1 allows a thin body up to 3.2): its route runs along the top row (y 3) — any taller and the
// cup tower pokes into the HUD boss box.
const CF_BODY: BossBody = { w: 1.9, h: 2.6, draw: coffeeBody, headY: f => f.fy - f.h * 0.98 };

const coffeeProps: BossDrawFn = (ctx, cam, x, y, _radius, o) => {
  const base = signBase(cam, y, CF_BODY);
  plaque(ctx, cam.sx(x), base - CF_BODY.h * PX_PER_UNIT * 0.5, 150, 28, '물을 보충하세요', '#0b132b', '#7bdff2', (1 - o.retreat) * o.groggy * (0.75 + 0.25 * strobe(o.time, 3, 5)));
};

// ─────────────────────────── 퇴근 못 한 모니터 (dead_monitor) + 가짜 창 (fake_monitor) ───────────────────────────
// base #e9dcc9 (beige CRT) · accent #0466c8 (blue screen) · light #ffffff. A CRT on a small desk. The screen is its face;
// the real one has the blinking block cursor and two live cables — its fake has neither.
// 기획 20차 점검 (가짜 찾기): the fake shows the SAME lit screen and face (it used to be a grey window with a ✕ — nobody had
// to look for the cursor) and stands in the same red ring; what tells them apart is the cursor, the pointer, the cables.

const DM_BASE = '#e9dcc9';
const DM_SHADE = '#b9ab94';
const DM_ACCENT = '#0466c8';
const DM_RED = '#9d0208';
const DM_DESK = '#7a5c43';

/** The tube of the CRT last drawn by crtOnDesk (px): its top-left corner and size. Read at once. */
const TUBE = { x: 0, y: 0, w: 0, h: 0 };

/**
 * A small desk with a deep CRT on it, standing on (fx, fy) in a w × h box, its back bulging to the side `back` (−1 = the
 * left). The tube is left empty (dark) — the caller paints it (TUBE). 35 canvas calls.
 */
function crtOnDesk(ctx: Ctx, fx: number, fy: number, w: number, h: number, back: number, caseFill: string, shade: string): void {
  const dy = fy - h * 0.33;
  // desk: legs, modesty panel, top
  ctx.fillStyle = '#3d2c20';
  ctx.fillRect(fx - w * 0.46, dy + 6, 7, fy - dy - 6);
  ctx.fillRect(fx + w * 0.46 - 7, dy + 6, 7, fy - dy - 6);
  ctx.fillStyle = '#4f3a2b';
  ctx.fillRect(fx - w * 0.4, dy + 6, w * 0.8, h * 0.14);
  ctx.fillStyle = DM_DESK;
  ctx.fillRect(fx - w * 0.5, dy, w, 8);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(fx - w * 0.5, dy, w, 8);
  // keyboard at the front edge
  ctx.fillStyle = '#d7ccb9';
  ctx.fillRect(fx - back * w * 0.14 - w * 0.13, dy - 5, w * 0.26, 5);
  // the CRT: its deep back, the foot, the case
  const cw = w * 0.66;
  const ch = h * 0.6;
  const cx0 = fx - cw / 2 - back * 4;
  const cy0 = fy - h;
  ctx.fillStyle = shade;
  ctx.fillRect(back < 0 ? cx0 - 13 : cx0 + cw - 7, cy0 + 10, 20, ch - 22);
  ctx.fillRect(fx - 18, dy - 9, 36, 9);
  pathRoundRect(ctx, cx0, cy0, cw, ch, 12);
  ctx.fillStyle = caseFill;
  ctx.fill();
  ctx.strokeStyle = '#6f6452';
  ctx.lineWidth = 3;
  ctx.stroke();
  // buttons under the tube
  ctx.fillStyle = shade;
  ctx.fillRect(cx0 + 12, cy0 + ch - 12, 12, 5);
  ctx.fillRect(cx0 + 28, cy0 + ch - 12, 12, 5);
  // the tube
  TUBE.x = cx0 + 9;
  TUBE.y = cy0 + 8;
  TUBE.w = cw - 18;
  TUBE.h = ch - 26;
  pathRoundRect(ctx, TUBE.x, TUBE.y, TUBE.w, TUBE.h, 14);
  ctx.fillStyle = '#07080c';
  ctx.fill();
  ctx.strokeStyle = '#3d372c';
  ctx.lineWidth = 3.5;
  ctx.stroke();
}

/** A power cable from the case to a plug `reach` px to the side: curled up and alert, hanging to the floor when down. */
function cable(ctx: Ctx, x0: number, y0: number, side: number, reach: number, t: number, lift: number, g: number): void {
  const awake = 1 - g;
  const ex = x0 + side * (reach + 6 * Math.sin(t * 1.3 + side) * awake - reach * 0.4 * g);
  const ey = y0 - (22 + 8 * Math.sin(t * 1.7 + side * 2) + 20 * lift) * awake + 40 * g;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(x0 + side * reach * 0.9, y0 + 24 * awake + 14, ex, ey);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = '#495057';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.lineCap = 'butt';
  // the plug: two prongs pointing up (down once it hangs)
  const dir = g > 0.5 ? 1 : -1;
  ctx.fillStyle = '#ffd60a';
  ctx.fillRect(ex - 5, ey + dir * 7, 3, dir * 8);
  ctx.fillRect(ex + 2, ey + dir * 7, 3, dir * 8);
  ctx.fillStyle = '#f1f3f5';
  ctx.fillRect(ex - 7, ey - 7, 14, 14);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(ex - 7, ey - 7, 14, 14);
}

/** The mouse pointer on the screen, tip at (x, y), s px tall. */
function pointer(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x + s * 0.27, y + s * 0.76);
  ctx.lineTo(x + s * 0.44, y + s * 1.12);
  ctx.lineTo(x + s * 0.6, y + s * 1.04);
  ctx.lineTo(x + s * 0.43, y + s * 0.7);
  ctx.lineTo(x + s * 0.74, y + s * 0.7);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** What the real screen showed on its last frame — the fake copies it. */
const DM_LAST = { red: false };

/**
 * The lit tube both screens share: blue (red from phase 2), a scan band, two noise bars and the pixel face. No cursor,
 * no pointer — those are the real one's. It never touches globalAlpha (a summon is drawn inside the unit pass's own).
 */
function litTube(ctx: Ctx, x: number, y: number, tw: number, th: number, t: number, red: boolean): void {
  // the corners stay dark: a rounded glass
  ctx.fillStyle = red ? DM_RED : DM_ACCENT;
  ctx.fillRect(x + 5, y + 4, tw - 10, th - 8);
  // scan band + two noise bars that jump 12 times a second
  const step = Math.floor(t * 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(x + 8, y + 6 + ((t * 36) % (th - 18)), tw - 16, 6);
  ctx.fillRect(x + 10, y + 8 + hash01(step, 61) * (th - 20), tw - 20, 2);
  ctx.fillRect(x + 10, y + 8 + hash01(step, 62) * (th - 20), tw - 20, 3);
  // the pixel face, pushed toward its front: square eyes, a smile that turns into a zigzag
  const cx = x + tw / 2 + 6;
  const fyy = y + th * 0.42;
  const k = Math.min(1, tw / 92); // the fake's tube is a little smaller
  const eh = 15 * k * blink(t, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 24 * k, fyy - eh / 2, 13 * k, eh);
  ctx.fillRect(cx + 9 * k, fyy - eh / 2, 13 * k, eh);
  ctx.fillStyle = red ? '#ffd6d6' : '#0b1f3a';
  ctx.fillRect(cx - 17 * k, fyy - 3 * k, 6 * k, Math.min(6 * k, eh));
  ctx.fillRect(cx + 16 * k, fyy - 3 * k, 6 * k, Math.min(6 * k, eh));
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const d = Math.abs(i - 2);
    const curve = red ? (i % 2) * 5 - 2 : d === 2 ? -5 : d === 1 ? 0 : 2;
    ctx.fillRect(cx + (-21 + i * 8) * k, fyy + (15 + curve) * k, 7 * k, 5 * k);
  }
}

function monitorBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h, time: t } = f;
  const A = 1 - o.retreat;
  const down = downOf(f);
  const wind = windOf(f);
  const flashT = swingOf(f);
  const red = o.enraged || o.phase >= 2;
  const off = down > 0.5;
  DM_LAST.red = red;

  // the two live cables (behind the desk): they reach out as it winds up, hang when the signal is gone
  const cy = fy - h * 0.62;
  cable(ctx, fx - w * 0.3, cy, -1, w * 0.2, t, wind, down);
  cable(ctx, fx + w * 0.3, cy, 1, w * 0.2, t, wind, down);
  crtOnDesk(ctx, fx, fy, w, h, -1, tint(DM_BASE, o), tint(DM_SHADE, o));
  const { x, y, w: tw, h: th } = TUBE;
  // power light
  ctx.fillStyle = off ? '#ff9f1c' : red ? '#ff3b30' : '#52d273';
  ctx.beginPath();
  ctx.arc(x + tw - 6, y + th + 10, 4, 0, TAU);
  ctx.fill();
  if (off) return;

  litTube(ctx, x, y, tw, th, t, red);
  ctx.fillStyle = '#ffffff';
  // the tell of the REAL screen: a fat block cursor blinking in the corner, and the pointer creeping about
  if (strobe(t, 3, 9, 0.6) > 0) ctx.fillRect(x + 10, y + th - 15, 13, 7);
  pointer(ctx, x + tw * 0.66 + Math.sin(t * 0.9) * 8 - 14 * wind, y + 8 + Math.cos(t * 1.3) * 4, 12 + 14 * wind);
  if (wind > 0 || flashT > 0) {
    // wind-up: the whole tube whites out
    ctx.globalAlpha = A * Math.min(0.85, wind * 0.6 + flashT * 0.6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 5, y + 4, tw - 10, th - 8);
    ctx.globalAlpha = A;
  }
}

const DM_BODY: BossBody = { w: 2.8, h: 2.5, draw: monitorBody, headY: f => f.fy - f.h * 0.98 };

const monitorProps: BossDrawFn = (ctx, cam, x, y, _radius, o) => {
  const base = signBase(cam, y, DM_BODY);
  // the OSD box drifts over the dead screen like a real one
  const dx = Math.sin(o.time * 0.9) * 14;
  const dy = Math.cos(o.time * 1.3) * 6;
  plaque(ctx, cam.sx(x) + dx, base - DM_BODY.h * PX_PER_UNIT * 0.72 + dy, 84, 24, '신호 없음', '#0466c8', '#ffffff', (1 - o.retreat) * o.groggy);
};

/** The red boss ring of the real screen's size (bosses/body.ts draws the real one's), around a foot point in px. */
function fakeBossRing(ctx: Ctx, fx: number, fy: number): void {
  const r = (getBoss('dead_monitor').radius ?? 1.6) * 1.2;
  ctx.beginPath();
  ctx.ellipse(fx, fy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(90, 0, 16, 0.85)';
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 59, 77, 0.85)';
  ctx.stroke();
}

/**
 * 가짜 창: the same desk, CRT and lit face as the real screen, in the same red ring — but no blinking cursor, no
 * pointer, no cables (기획 20차 점검: the tip 「커서가 깜빡이는 화면이 진짜예요」 has to be what finds it). It whites out
 * as it winds its 「오류 보고」 up (act), like the real one before a pattern.
 */
const fakeMonitor: CreatureDrawFn = (ctx, fill, flash, fx, fy, w, h, s, time, _phase, act) => {
  const bw = w * 1.12;
  const bh = h * 0.84;
  fakeBossRing(ctx, fx, fy);
  crtOnDesk(ctx, fx, fy, bw, bh, s >= 0 ? -1 : 1, flash ? '#ffffff' : fill, flash ? '#ffffff' : '#a79b88');
  const { x, y, w: tw, h: th } = TUBE;
  // the power light is green, like the real one's
  ctx.fillStyle = DM_LAST.red ? '#ff3b30' : '#52d273';
  ctx.beginPath();
  ctx.arc(x + tw - 6, y + th + 10, 4, 0, TAU);
  ctx.fill();
  litTube(ctx, x, y, tw, th, time, DM_LAST.red);
  if (flash || act > 0.3) {
    ctx.fillStyle = flash ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, ' + Math.min(0.85, act * 0.7).toFixed(2) + ')';
    ctx.fillRect(x + 5, y + 4, tw - 10, th - 8);
  }
};

/** The three desks on the floor and the cable the screen travels along (read from the boss data). */
const monitorStage: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const spots = getBoss('dead_monitor').spots ?? [];
    if (spots.length === 0) return;
    const px = (i: number): number => spots[i % spots.length].x * B.cellX;
    const py = (i: number): number => spots[i % spots.length].y * B.cellY;
    // the cable loop A → B → C → A, drooping toward the middle of the room
    const mx = spots.reduce((n, s) => n + s.x, 0) / spots.length;
    const my = spots.reduce((n, s) => n + s.y, 0) / spots.length;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px(0), py(0));
    for (let i = 1; i <= spots.length; i++) g.quadraticCurveTo((px(i - 1) + px(i)) / 2 * 0.8 + mx * B.cellX * 0.2, (py(i - 1) + py(i)) / 2 * 0.8 + my * B.cellY * 0.2, px(i), py(i));
    g.globalAlpha = 0.55;
    g.strokeStyle = INK;
    g.lineWidth = 9;
    g.stroke();
    g.globalAlpha = 0.7;
    g.strokeStyle = B.phase >= 2 ? '#c1121f' : '#2f7fd6';
    g.lineWidth = 3;
    g.setLineDash([14, 10]);
    g.stroke();
    g.setLineDash([]);
    // a floor mat with a power strip under every desk
    for (let i = 0; i < spots.length; i++) {
      const mw = 4.4 * B.cellX;
      const mh = 2.6 * B.cellY;
      g.globalAlpha = 0.5;
      g.fillStyle = '#18222e';
      pathRoundRect(g, px(i) - mw / 2, py(i) - mh / 2, mw, mh, 14);
      g.fill();
      g.globalAlpha = 0.6;
      g.strokeStyle = '#6c8196';
      g.lineWidth = 2.5;
      g.stroke();
      g.globalAlpha = 0.8;
      g.fillStyle = '#e9ecef';
      g.fillRect(px(i) - mw / 2 + 12, py(i) + mh / 2 - 16, 42, 9);
      g.fillStyle = B.phase >= 2 ? '#ff3b30' : '#52d273';
      g.fillRect(px(i) - mw / 2 + 15, py(i) + mh / 2 - 14, 5, 5);
    }
    g.globalAlpha = 1;
  },
};

// ─────────────────────────── 끝나지 않는 회의 (endless_meeting) ───────────────────────────
// base #495057 · chair #5b6672 · accent #f77f00 (tie, pointer) · light #f1faee (agenda sheets). A faceless chairman who
// never leaves his wheeled chair; the agenda keeps circling him. Three views: his flank, his front (the seat faces the
// camera) and the chair back (the seat faces away) — a seat faces one of four ways.

const EM_BASE = '#495057';
const EM_CHAIR = '#5b6672';
const EM_CHAIR_EDGE = '#aab4bf';
const EM_SUIT = '#252b33';
const EM_SUIT_EDGE = '#aab4bf';
const EM_ACCENT = '#f77f00';
const EM_LIGHT = '#f1faee';
const EM_SKIN = '#e9e4da';

/** What the three views of the chairman share for one frame (reused object: read at once). */
const EM = { A: 1, down: 0, awake: 1, swing: 0, point: 0, rise: 0, late: false, lean: 0, seatY: 0 };

function meetingPose(f: BossBodyFrame, o: BossDrawOpts): void {
  EM.A = 1 - o.retreat;
  EM.down = downOf(f);
  EM.awake = 1 - EM.down;
  EM.swing = swingOf(f);
  EM.point = Math.max(windOf(f), EM.swing) * EM.awake;
  EM.rise = 10 * EM.point;
  EM.late = o.phase >= 2 || o.enraged;
  EM.lean = (0.05 * Math.sin(f.time * 1.3) + 0.14 * EM.point) * EM.awake - 0.5 * EM.down;
  EM.seatY = f.fy - f.h * 0.34;
}

/** The wheeled base every view stands on: star bar, three casters, the gas column up to the seat. */
function chairBase(ctx: Ctx, f: BossBodyFrame): void {
  const { fx, fy, w } = f;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(fx - w * 0.3, fy - 6);
  ctx.lineTo(fx + w * 0.3, fy - 6);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(fx - w * 0.3, fy - 5, 5.5, 0, TAU);
  ctx.arc(fx, fy - 4, 5.5, 0, TAU);
  ctx.arc(fx + w * 0.3, fy - 5, 5.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#343a40';
  ctx.fillRect(fx - 5, EM.seatY, 10, fy - EM.seatY - 8);
}

/**
 * The agenda that circles him: three sheets, five from the second phase. `front` draws the half of the orbit that
 * passes before him (call once with false before the body, once with true after). Adjourned: the sheets lie on the floor.
 */
function agenda(ctx: Ctx, f: BossBodyFrame, front: boolean): void {
  const { fx, fy, w, h, time: t } = f;
  const sheets = EM.late ? 5 : 3;
  const paper = EM.late ? '#ffd9de' : EM_LIGHT;
  ctx.strokeStyle = '#868e96';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = paper;
  for (let i = 0; i < sheets; i++) {
    if (EM.down > 0.5) {
      if (front) ctx.fillRect(fx - w * 0.46 + i * w * 0.2, fy - 5 + (i % 2) * 3, 20, 7);
      continue;
    }
    const a = t * (1.1 + 0.8 * EM.point) + (i * TAU) / sheets;
    const depth = Math.sin(a);
    if ((depth >= 0) !== front) continue;
    const sx = fx + Math.cos(a) * w * 0.47;
    const sy = fy - h * (0.5 + 0.12 * Math.sin(a * 2 + i)) + depth * 6;
    const k = front ? 1 : 0.85;
    ctx.fillRect(sx - 9 * k, sy - 11 * k, 18 * k, 22 * k);
    ctx.strokeRect(sx - 9 * k, sy - 11 * k, 18 * k, 22 * k);
    if (!front) continue;
    ctx.fillStyle = '#868e96';
    ctx.fillRect(sx - 5, sy - 5, 10, 2);
    ctx.fillRect(sx - 5, sy + 1, 7, 2);
    ctx.fillStyle = paper;
  }
}

/** The head: a pale oval with a cap of hair and no face at all. `back` = seen from behind (all hair). */
function facelessHead(ctx: Ctx, x: number, y: number, tilt: number, back: boolean): void {
  ctx.beginPath();
  ctx.ellipse(x, y, 19, 22, tilt, 0, TAU);
  ctx.fillStyle = back ? INK : EM_SKIN;
  ctx.fill();
  ctx.strokeStyle = back ? '#868e96' : INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  if (back) return;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x, y - 7, 19, 16, tilt, Math.PI, TAU);
  ctx.fill();
}

/** The laser pointer's beam: a red line from (x, y) for `len` px along (ux, uy), one sharp dot at its end. */
function laser(ctx: Ctx, x: number, y: number, ux: number, uy: number, len: number): void {
  ctx.globalAlpha = EM.A * Math.min(1, 0.4 + EM.point);
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2.5 + 3 * EM.swing;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + ux * len, y + uy * len);
  ctx.stroke();
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.arc(x + ux * len, y + uy * len, 5 + 4 * EM.point, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = EM.A;
}

/** Seen from the side (his seat faces left or right): the high chair back behind him, the pointer out in front. */
function meetingSide(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h, time: t } = f;
  const { down, awake, point, rise, lean, seatY } = EM;
  pathRoundRect(ctx, fx - w * 0.46 - 12 * down, fy - h * 0.86 + 10 * down, 22, h * 0.56, 9);
  ctx.fillStyle = tint(EM_CHAIR, o);
  ctx.fill();
  ctx.strokeStyle = EM_CHAIR_EDGE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = tint(EM_CHAIR, o);
  ctx.fillRect(fx - w * 0.38, seatY - 6, w * 0.6, 12);
  // legs: the thigh along the seat, the shin down to a tapping shoe
  const hipX = fx - w * 0.17;
  const hipY = seatY - 12 - rise;
  const kneeX = fx + w * 0.17;
  const kneeY = seatY - 10 - rise * 0.4;
  const footX = fx + w * 0.21;
  const tap = Math.max(0, Math.sin(t * 9)) * 4 * awake * (1 - point);
  limb(ctx, hipX, hipY, kneeX, kneeY, 0, 17, EM_SUIT, EM_SUIT_EDGE);
  limb(ctx, kneeX, kneeY, footX, fy - 9, 0, 13, EM_SUIT, EM_SUIT_EDGE);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(footX + 9, fy - 5 - tap, 14, 6, 0, 0, TAU);
  ctx.fill();
  // the suit: hip to shoulder, leaning in as he points, slumped back when the meeting is adjourned
  const tl = h * 0.34;
  const shX = hipX + Math.sin(lean) * tl + w * 0.07;
  const shY = hipY - Math.cos(lean) * tl;
  limb(ctx, hipX, hipY, shX, shY, 0, 40, EM_SUIT, EM_SUIT_EDGE);
  // shirt front and tie, on the side he faces
  ctx.fillStyle = '#f8f9fa';
  ctx.beginPath();
  ctx.moveTo(shX + 6, shY - 6);
  ctx.lineTo(shX + 20, shY + 4);
  ctx.lineTo(shX + 13, shY + 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = EM.late ? '#d00000' : EM_ACCENT;
  ctx.beginPath();
  ctx.moveTo(shX + 13, shY + 2);
  ctx.lineTo(shX + 20, shY + 7);
  ctx.lineTo(shX + 17, shY + 34);
  ctx.lineTo(shX + 11, shY + 27);
  ctx.closePath();
  ctx.fill();
  facelessHead(ctx, shX + Math.sin(lean) * h * 0.17 + 3, shY - Math.cos(lean) * h * 0.17 - 3, lean, false);
  // the arm with the pointer: resting on his knee, raised straight ahead as he winds up, hanging when down
  const hang = down > 0.5;
  const handX = hang ? hipX - 4 : kneeX - 6 + (w * 0.24 + 6) * point;
  const handY = hang ? seatY + 24 : kneeY - 14 - (h * 0.24 + rise) * point;
  limb(ctx, shX + 2, shY + 10, handX, handY, hang ? 0 : 10 * (1 - point), 11, EM_SUIT, EM_SUIT_EDGE);
  ctx.fillStyle = EM_SKIN;
  ctx.beginPath();
  ctx.ellipse(handX, handY, 8, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#343a40';
  ctx.fillRect(handX, handY - 3, 15, 5);
  if (point > 0.02) {
    laser(ctx, handX + 15, handY, 1, -0.03, 24 + 60 * point);
  } else if (!hang) {
    // the sheaf on his knee
    ctx.fillStyle = EM_LIGHT;
    ctx.fillRect(kneeX - 18, kneeY - 18, 24, 5);
    ctx.fillStyle = '#ced4da';
    ctx.fillRect(kneeX - 17, kneeY - 14, 24, 3);
  }
}

/** Seen from the front (his seat faces the camera): the chair back behind his shoulders, the pointer aimed at you. */
function meetingFront(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h, time: t } = f;
  const { down, awake, point, rise, seatY } = EM;
  pathRoundRect(ctx, fx - w * 0.33, fy - h * 0.88, w * 0.66, h * 0.58, 16);
  ctx.fillStyle = tint(EM_CHAIR, o);
  ctx.fill();
  ctx.strokeStyle = EM_CHAIR_EDGE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // shins down from the seat, a tapping shoe
  const tap = Math.max(0, Math.sin(t * 9)) * 4 * awake * (1 - point);
  limb(ctx, fx - w * 0.13, seatY - 4, fx - w * 0.15, fy - 9, 0, 14, EM_SUIT, EM_SUIT_EDGE);
  limb(ctx, fx + w * 0.13, seatY - 4, fx + w * 0.15, fy - 9, 0, 14, EM_SUIT, EM_SUIT_EDGE);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(fx - w * 0.16, fy - 5, 11, 6, 0, 0, TAU);
  ctx.ellipse(fx + w * 0.16, fy - 5 - tap, 11, 6, 0, 0, TAU);
  ctx.fill();
  // seat edge and armrests
  ctx.fillStyle = tint(EM_CHAIR, o);
  ctx.fillRect(fx - w * 0.36, seatY - 14, w * 0.72, 9);
  // the suit, shoulders wide; shirt and tie down the middle
  const shY = seatY - h * 0.36 - rise + 16 * down;
  const hw = w * 0.28;
  ctx.beginPath();
  ctx.moveTo(fx - hw, shY + 8);
  ctx.quadraticCurveTo(fx - hw, shY - 4, fx - hw * 0.5, shY - 6);
  ctx.lineTo(fx + hw * 0.5, shY - 6);
  ctx.quadraticCurveTo(fx + hw, shY - 4, fx + hw, shY + 8);
  ctx.lineTo(fx + hw * 0.78, seatY - 2);
  ctx.lineTo(fx - hw * 0.78, seatY - 2);
  ctx.closePath();
  ctx.fillStyle = EM_SUIT;
  ctx.fill();
  ctx.strokeStyle = EM_SUIT_EDGE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f8f9fa';
  ctx.beginPath();
  ctx.moveTo(fx - 13, shY - 5);
  ctx.lineTo(fx + 13, shY - 5);
  ctx.lineTo(fx, shY + 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = EM.late ? '#d00000' : EM_ACCENT;
  ctx.beginPath();
  ctx.moveTo(fx - 5, shY - 2);
  ctx.lineTo(fx + 5, shY - 2);
  ctx.lineTo(fx + 6, shY + 26);
  ctx.lineTo(fx, shY + 34);
  ctx.lineTo(fx - 6, shY + 26);
  ctx.closePath();
  ctx.fill();
  facelessHead(ctx, fx + 8 * down, shY - 24 + 4 * down, 0.4 * down, false);
  // hands: one on the armrest, the other holds the pointer — it comes up and the dot runs out toward you
  const hang = down > 0.5;
  ctx.fillStyle = EM_SKIN;
  ctx.beginPath();
  ctx.ellipse(fx - hw - 2, hang ? seatY + 14 : seatY - 16, 8, 6.5, 0, 0, TAU);
  ctx.fill();
  const handX = fx + hw + 2 - 6 * point;
  const handY = hang ? seatY + 14 : seatY - 16 - h * 0.14 * point;
  ctx.beginPath();
  ctx.ellipse(handX, handY, 8, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#343a40';
  ctx.fillRect(handX - 3, handY - 2, 6, 14);
  if (point > 0.02) laser(ctx, handX, handY + 12, 0, 1, 14 + 34 * point);
}

/** Seen from behind (his seat faces away): the chair back hides him — shoulders and the back of his head show. */
function meetingBack(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const { fx, fy, w, h } = f;
  const { down, point, rise, seatY } = EM;
  const shY = seatY - h * 0.36 - rise + 16 * down;
  const hw = w * 0.28;
  // the pointer goes up first (it is beyond him)
  if (point > 0.02) laser(ctx, fx + hw + 2, shY + 4, 0, -1, 14 + 40 * point);
  ctx.fillStyle = EM_SUIT;
  ctx.fillRect(fx - hw - 6, shY - 4, hw * 2 + 12, 30);
  ctx.strokeStyle = EM_SUIT_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(fx - hw - 6, shY - 4, hw * 2 + 12, 30);
  facelessHead(ctx, fx + 8 * down, shY - 22 + 4 * down, 0.4 * down, true);
  pathRoundRect(ctx, fx - w * 0.33, fy - h * 0.78, w * 0.66, h * 0.56, 16);
  ctx.fillStyle = tint(EM_CHAIR, o);
  ctx.fill();
  ctx.strokeStyle = EM_CHAIR_EDGE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // the seams of the chair back
  ctx.globalAlpha = EM.A * 0.5;
  ctx.fillStyle = INK;
  ctx.fillRect(fx - w * 0.2, fy - h * 0.7, 3, h * 0.4);
  ctx.fillRect(fx + w * 0.2 - 3, fy - h * 0.7, 3, h * 0.4);
  ctx.globalAlpha = EM.A;
}

function meetingBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  meetingPose(f, o);
  chairBase(ctx, f);
  agenda(ctx, f, false);
  // a seat faces one of four ways, so the view never flickers: its facing is exactly down, up, left or right
  const toward = Math.sin(f.facing);
  if (toward > 0.7) meetingFront(ctx, f, o);
  else if (toward < -0.7) meetingBack(ctx, f, o);
  else meetingSide(ctx, f, o);
  agenda(ctx, f, true);
}

const EM_BODY: BossBody = { w: 2.5, h: 2.6, draw: meetingBody, headY: f => f.fy - f.h * 0.98 };

const meetingProps: BossDrawFn = (ctx, cam, x, y, _radius, o) => {
  const base = signBase(cam, y, EM_BODY);
  plaque(ctx, cam.sx(x), base - EM_BODY.h * PX_PER_UNIT * 0.62, 78, 32, '휴회', EM_ACCENT, '#1b1b1b', (1 - o.retreat) * o.groggy, -0.07);
};

/** The long table in the middle of the room, a sheet and an empty chair at every place (flat: characters walk over it). */
const meetingStage: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const spots = getBoss('endless_meeting').spots ?? [];
    if (spots.length === 0) return;
    // the table lies between the seats: 4.5 cells clear of the side seats, 2.2 of the head seats
    const xs = spots.map(s => s.x);
    const ys = spots.map(s => s.y);
    const x0 = (Math.min(...xs) + 4.5) * B.cellX;
    const x1 = (Math.max(...xs) - 4.5) * B.cellX;
    const y0 = (Math.min(...ys) + 2.2) * B.cellY;
    const y1 = (Math.max(...ys) - 2.2) * B.cellY;
    if (x1 <= x0 || y1 <= y0) return;
    g.globalAlpha = 0.34;
    g.fillStyle = '#000000';
    pathRoundRect(g, x0 + 6, y0 + 10, x1 - x0, y1 - y0, 34);
    g.fill();
    g.globalAlpha = 0.62;
    g.fillStyle = '#4a3528';
    pathRoundRect(g, x0, y0, x1 - x0, y1 - y0, 34);
    g.fill();
    g.globalAlpha = 0.75;
    g.strokeStyle = '#a5805f';
    g.lineWidth = 4;
    g.stroke();
    g.globalAlpha = 0.3;
    g.strokeStyle = '#d9b48f';
    g.lineWidth = 2;
    pathRoundRect(g, x0 + 12, y0 + 9, x1 - x0 - 24, y1 - y0 - 18, 26);
    g.stroke();
    // six places along each long side: a sheet on the table, an empty chair pushed in
    const n = 6;
    for (let i = 0; i < n; i++) {
      const sx = x0 + ((i + 0.5) / n) * (x1 - x0);
      for (const side of [-1, 1]) {
        const edge = side < 0 ? y0 : y1;
        g.globalAlpha = 0.7;
        g.fillStyle = B.phase >= 2 ? '#ffd9de' : EM_LIGHT;
        g.fillRect(sx - 11, edge - side * 20 - 7, 22, 14);
        g.globalAlpha = 0.6;
        g.fillStyle = EM_CHAIR;
        pathRoundRect(g, sx - 15, edge + side * 14 - 9, 30, 18, 7);
        g.fill();
        g.strokeStyle = '#6c757d';
        g.lineWidth = 2;
        g.stroke();
      }
    }
    // the red agenda item that is added every phase
    g.globalAlpha = 0.75;
    g.fillStyle = '#d00000';
    for (let i = 0; i < Math.min(3, B.phase); i++) g.fillRect((x0 + x1) / 2 - 30 + i * 22, (y0 + y1) / 2 - 5, 16, 10);
    g.globalAlpha = 1;
  },
};

// ─────────────────────────── registries ───────────────────────────

/** Boss id → look. Moving bosses: `draw` is the body as a set piece (sheet tools, look tests); the game draws `body`. */
export const OFFICE_LOOKS: Record<string, BossLook> = {
  shredder_maw: { draw: asSetPiece(SH_BODY), body: SH_BODY, color: SH_BASE, props: shredderProps },
  coffee_machine: { draw: asSetPiece(CF_BODY), body: CF_BODY, color: CF_BASE, props: coffeeProps },
  dead_monitor: { draw: asSetPiece(DM_BODY), body: DM_BODY, stage: monitorStage, color: DM_BASE, props: monitorProps },
  endless_meeting: { draw: asSetPiece(EM_BODY), body: EM_BODY, stage: meetingStage, color: EM_BASE, props: meetingProps },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const OFFICE_TELE_MOTIF: Record<string, TeleMotif> = { cf_pour: 'linger', cf_overflow: 'linger', dm_alt_tab: 'spawn' };

/** MonsterDef.look → the body of this zone's summon-only units. */
export const OFFICE_MINION_LOOKS: Record<string, CreatureDrawFn> = { fake_monitor: fakeMonitor };

/** 기획 20차: Zone.look → fill / edge of this zone's trail zones (커피 머신의 발자국: one brown path, a hot edge). */
export const OFFICE_ZONE_LOOKS: Record<string, ZoneLook> = { coffee: { fill: COFFEE, edge: '#ff6b4a' } };
