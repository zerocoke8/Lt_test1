// 기획 19차 보스 레이드 — 옥상·이계 boss looks (docs/bosses.md 4장). This zone's track owns this file.
// Bosses: tank_dweller 물탱크의 주인 · thunder_antenna 천둥 안테나 · answering_pencil 대답하는 연필 · inverted_moon 거꾸로 뜬 달.
// Four silhouettes that never read alike: a squat blue cylinder with a lifted lid (탑형), a wide fishbone antenna over a
// small TV (매달린형), a sheet of graph paper with one upright pencil (책상형), a disc in a red sky (하늘).
// Summon looks: none (외발 우산 / 그림자 아이 / 붉은 마스크 are existing monsters).
// Warning motifs (skill id → motif): td_drain pull (pull wins over linger) · td_umbrellas / im_shadows spawn
// (a motif only shows on a part that has a delay — an instant summon has no warning to decorate).
//
// Art rules: read only BossDrawOpts + o.time + hash01 (no Math.random / Date); faces and eyes at screen y 100–230 (the HUD
// boss box covers x 424–856, y < 100); ≤ 360 canvas calls a frame, ≤ 2 fillText, no gradients, no shadowBlur, nothing
// allocated per frame; safe for o.phase 1–3; mix / lighten / darken only with stepped amounts (they cache by amount).
// The foot line cy is ≈ screen y 139; everything hangs down from it (to ≈ cy + 96) and rises behind the HUD boxes
// (boss box x 429–849 y < 95, player panels x < 410 y < 78, buttons x > 960 y < 90 — the gap x 856–960 is open sky).
// Ground marks (zones, rings) are drawn UNDER the boss art: keep opaque parts narrow or shallow.
// Checks: npx vitest run tests/render/boss-looks.test.ts (every registered look, 15 poses × 30 frames).
// See it: npx vite, then /tests/visual/render-sandbox.html?scene=zoo&boss=<id>&pose=idle|windup|groggy|enraged&phase=2
//         (bench=boss:<id> → window.__sandbox.bench ms/frame); all 20 on one picture: node tests/visual/boss-sheet.mjs

import { Camera, PX_PER_UNIT } from '../camera';
import { TAU, anchor, bigEye, blink, dripRow, enrageHaze, glowEllipse, hand, hash01, limb, lookDir, pathRoundRect, plaque, smallEye, strobe, swayAngle, tinted, wash } from './kit';
import type { BossDrawOpts, BossLook, CreatureDrawFn, TeleMotif } from './types';

type Ctx = CanvasRenderingContext2D;

// ─────────────────────────── 물탱크의 주인 (탑형: 옥상 물탱크, 뚜껑 틈의 머리카락과 손) ───────────────────────────

// (shades are literal hex: tinted() / darken() return rgb() strings that cannot be mixed again)
const TANK = { base: '#8ecae6', lid: '#6b98ad', shade: '#55798a', rib: '#476573', rust: '#52796f', rustDark: '#39554e', light: '#e0fbfc', dark: '#081216', water: '#c4ecf8', blood: '#8a1525', hair: '#0d0b10', skin: '#e6e1d8', ink: '#1d1418' };

/** An arm over the rim: a palm with four fingers hanging down the tank's front; knocked down, the whole forearm slides out. */
function rimHand(ctx: Ctx, x: number, y: number, t: number, seed: number, g: number): void {
  const len = 9 + 40 * g;
  const grip = Math.sin(t * 2.2 + seed) * 2 * (1 - g);
  limb(ctx, x, y - 4, x + 5 * g, y + len, 0, 15, TANK.skin, TANK.ink);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let f = 0; f < 4; f++) {
    const fx = x + 5 * g + (f - 1.5) * 5.4;
    ctx.moveTo(fx, y + len - 2);
    ctx.lineTo(fx + (f - 1.5) * 0.9, y + len + 12 + (f === 1 || f === 2 ? 3 : 0) + grip);
  }
  ctx.strokeStyle = TANK.ink;
  ctx.lineWidth = 6.5;
  ctx.stroke();
  ctx.strokeStyle = TANK.skin;
  ctx.lineWidth = 3.6;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawTankDweller(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const base = tinted(TANK.base, o);
  const water = o.phase >= 2 ? TANK.blood : TANK.water;
  // wind-up: the tank swells and shudders
  const W = R * 0.68 * (1 + 0.05 * o.charge * (0.6 + 0.4 * Math.sin(t * 22)));
  const top = cy + 6;
  const bot = cy + 82;
  const ry = 15;

  // thin rain over the whole roof
  ctx.globalAlpha = alpha * 0.4;
  ctx.strokeStyle = TANK.light;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const u = (t * (1.3 + hash01(i, 71) * 0.6) + hash01(i, 72)) % 1;
    const rx = cx + (hash01(i, 73) - 0.5) * R * 3.8;
    const ry0 = cy - 140 + u * 250;
    ctx.moveTo(rx, ry0);
    ctx.lineTo(rx - 5, ry0 + 22);
  }
  ctx.stroke();
  enrageHaze(ctx, cx, cy + 50, R * 1.25, 110, o, alpha, TANK.light);

  // legs + the ladder on the right
  ctx.fillStyle = '#1f2a30';
  ctx.fillRect(cx - W * 0.78, bot, 12, 24);
  ctx.fillRect(cx - 6, bot, 12, 26);
  ctx.fillRect(cx + W * 0.78 - 12, bot, 12, 24);
  ctx.strokeStyle = TANK.rustDark;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx + W + 9, top - 30);
  ctx.lineTo(cx + W + 9, cy + 104);
  ctx.moveTo(cx + W + 31, top - 30);
  ctx.lineTo(cx + W + 31, cy + 104);
  for (let k = 0; k < 7; k++) {
    ctx.moveTo(cx + W + 9, top - 18 + k * 19);
    ctx.lineTo(cx + W + 31, top - 18 + k * 19);
  }
  ctx.stroke();

  // the cylinder
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.rect(cx - W, top, W * 2, bot - top);
  ctx.ellipse(cx, bot, W, ry, 0, 0, TAU);
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillStyle = tinted(TANK.shade, o);
  ctx.fillRect(cx + W * 0.5, top, W * 0.5, bot - top + 8);
  ctx.fillStyle = TANK.light;
  ctx.fillRect(cx - W * 0.82, top + 8, W * 0.1, bot - top - 4);
  ctx.globalAlpha = alpha;
  // hoops, and rust running down from them
  ctx.strokeStyle = TANK.rust;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let k = 1; k <= 3; k++) {
    const hy = top + ((bot - top) * k) / 3;
    ctx.moveTo(cx + W, hy);
    ctx.ellipse(cx, hy, W, ry, 0, 0, Math.PI);
  }
  ctx.stroke();
  // pressed ribs down the wall
  ctx.globalAlpha = alpha * 0.3;
  ctx.strokeStyle = TANK.rib;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = -4; k <= 4; k++) {
    const u = k / 5;
    const dy = ry * Math.sqrt(1 - u * u);
    ctx.moveTo(cx + W * u, top + dy);
    ctx.lineTo(cx + W * u, bot + dy);
  }
  ctx.stroke();
  ctx.fillStyle = TANK.rust;
  ctx.globalAlpha = alpha * 0.75;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const u = hash01(i, 41) * 1.7 - 0.85;
    const hy = top + ((bot - top) * (1 + (i % 2))) / 3 + ry * Math.sqrt(1 - u * u);
    ctx.rect(cx + W * u, hy, 3 + hash01(i, 43) * 4, 8 + hash01(i, 42) * 18);
  }
  ctx.fill();
  ctx.globalAlpha = alpha;

  // the opening, and the dark wedge under the lifted lid (hinged on the right)
  const rattle = o.charge > 0 ? Math.sin(t * 31) * 0.03 * o.charge : 0;
  const lidA = (0.17 + 0.03 * Math.sin(t * 1.1) + 0.1 * o.charge + rattle) * (1 - g) + 0.27 * g;
  const gapH = Math.sin(lidA) * W * 2;
  ctx.fillStyle = o.phase >= 2 ? '#2a070c' : TANK.dark;
  ctx.beginPath();
  ctx.ellipse(cx, top, W, ry, 0, 0, TAU);
  ctx.moveTo(cx + W, top);
  ctx.lineTo(cx - W, top);
  ctx.lineTo(cx - W, top - gapH);
  ctx.closePath();
  ctx.fill();
  // two eyes far back in the dark (shut when knocked down, wide and red as it stands up)
  const { lx, ly } = lookDir(cam, cx - W * 0.4, top - 10, o);
  const angry = o.enraged || o.phase >= 2 || o.groggyWake > 0;
  const open = o.groggyWake > 0 ? 1 : blink(t, 3) * (1 - g);
  for (let k = 0; k < 2; k++) {
    const ex = cx - W * (0.62 - k * 0.34);
    const h = (gapH * (cx + W - ex)) / (W * 2);
    smallEye(ctx, ex, top - h * 0.45 + 2, Math.min(9, h * 0.3), lx, ly, open, angry ? '#ff1a1a' : '#16242b');
  }
  // the lid
  ctx.save();
  ctx.translate(cx + W, top);
  ctx.rotate(lidA);
  ctx.fillStyle = tinted(TANK.lid, o);
  ctx.strokeStyle = TANK.rustDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(-W, 0, W + 4, ry * 0.75, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TANK.rust;
  ctx.fillRect(-W - 16, -ry * 0.75 - 6, 32, 7);
  ctx.restore();

  // long black hair spilling out of the gap and down the front
  ctx.strokeStyle = TANK.hair;
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const hx = cx - W * 0.86 + i * W * 0.1;
    const len = 30 + hash01(i, 5) * 34 + 8 * g;
    const sway = Math.sin(t * 1.6 + i * 0.8) * 7 * (1 - g);
    ctx.moveTo(hx, top - 3);
    ctx.quadraticCurveTo(hx + sway * 0.4 - 3, top + ry + len * 0.45, hx + sway, top + ry + len);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';

  // water: over the rim while it winds up, a wave on the hit, drips from the bottom rim
  const spill = Math.max(o.charge, o.flash);
  if (spill > 0) {
    ctx.globalAlpha = alpha * 0.85 * spill;
    ctx.fillStyle = o.phase >= 2 ? '#c2283c' : '#f1fdff';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const sx = cx - W * 0.9 + i * W * 0.42;
      const len = (bot - top + 26) * spill * (0.55 + 0.45 * hash01(i, 61));
      ctx.rect(sx, top + 8, W * 0.2, len);
      ctx.moveTo(sx + W * 0.24, top + 8 + len);
      ctx.arc(sx + W * 0.1, top + 8 + len, W * 0.14, 0, TAU);
    }
    ctx.ellipse(cx, bot + 26, W * 1.7 * o.flash, 14 * o.flash, 0, 0, TAU);
    ctx.fill();
  }
  // knocked down: it drains out over the low side
  if (g > 0) {
    ctx.globalAlpha = alpha * 0.8 * g;
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.moveTo(cx + W * 0.5, top + 4);
    ctx.lineTo(cx + W * 0.86, top + 4);
    ctx.lineTo(cx + W * 1.02 + Math.sin(t * 9) * 3, cy + 106);
    ctx.lineTo(cx + W * 0.7, cy + 106);
    ctx.closePath();
    ctx.ellipse(cx + W * 0.86, cy + 107, 74 * g, 9, 0, 0, TAU);
    ctx.fill();
  }
  dripRow(ctx, cx - W * 0.9, bot + ry, W * 1.8, 6, 28, t, water, alpha * 0.9);
  ctx.globalAlpha = alpha * (1 - 0.3 * g);
  rimHand(ctx, cx - W * 0.93, top + 3, t, 0, g);
  rimHand(ctx, cx + W * 0.12, top + ry - 2, t, 2, g);
  ctx.globalAlpha = 1;
}

function drawTankProps(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  // the notice every tenant knows: 「단수」 (water is off)
  plaque(ctx, cx - radius * PX_PER_UNIT * 0.3, cy + 66, 78, 30, '단수', '#f8f9fa', '#c1121f', alpha * o.groggy, -0.08 + swayAngle(o.time, 2.4, 0.03));
}

// ─────────────────────────── 천둥 안테나 (매달린형: 생선뼈 안테나 + 피뢰침, 아래 브라운관 TV) ───────────────────────────

const ANT = { base: '#343a40', rim: '#7d858d', metal: '#adb5bd', zap: '#ffea00', light: '#f8f9fa', dark: '#0d0f12', off: '#495057' };
/** Cross rods along the boom (px from its middle), long on the lightning-rod side (the right: its rod stands in the gap between the HUD boxes). */
const RODS = [-226, -166, -106, -46, 46, 106, 166, 226];
const rodLen = (i: number) => 45 + i * 7;
const ROD_X = 266;
/** 기획 19차 review: the TV hangs this far left of the middle (px), clear of the party under the boss. */
const TV_SIDE = -150;

/** A jagged bolt from (x0, y0) to (x1, y1) into the current path; re-rolled 24 times a second. */
function boltPath(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, n: number, jitter: number, t: number, seed: number): void {
  const step = Math.floor(t * 24);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  ctx.moveTo(x0, y0);
  for (let k = 1; k < n; k++) {
    const j = (hash01(step + k * 7, seed) - 0.5) * 2 * jitter;
    ctx.lineTo(x0 + (dx * k) / n - (dy / d) * j, y0 + (dy * k) / n + (dx / d) * j);
  }
  ctx.lineTo(x1, y1);
}

/** How bright bulb i is (0 / 1): the two by the TV are its eyes; all of them from phase 2; a chase toward the rod while it winds up. */
function bulbLit(i: number, o: BossDrawOpts): number {
  if (o.groggy > 0.5) return 0;
  if (o.phase >= 2 || o.enraged || o.flash > 0.5) return 1;
  if (i === 3 || i === 4) return 1;
  if (o.charge > 0 && Math.floor(o.time * 16) % 8 === i) return 1;
  return strobe(o.time, 5, 30 + i, 0.06);
}

/** One half of the antenna in its own (tilted) frame: boom, cross rods, the bulbs hanging at their lower ends. */
function antennaHalf(ctx: Ctx, i0: number, dir: number, o: BossDrawOpts, lx: number, ly: number, alpha: number): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(dir * (dir > 0 ? ROD_X + 6 : 252), 0);
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 15;
  ctx.stroke();
  ctx.strokeStyle = ANT.metal;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.beginPath();
  for (let i = i0; i < i0 + 4; i++) {
    ctx.moveTo(RODS[i], -rodLen(i) * 0.42);
    ctx.lineTo(RODS[i], rodLen(i) * 0.58);
  }
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = ANT.metal;
  ctx.lineWidth = 5.5;
  ctx.stroke();
  // sparks crawling between the rods while it winds up
  if (o.charge > 0) {
    ctx.globalAlpha = alpha * o.charge;
    ctx.strokeStyle = ANT.zap;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = i0; i < i0 + 3; i++) boltPath(ctx, RODS[i], -16, RODS[i + 1], -12, 4, 9, o.time, 80 + i);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  ctx.lineCap = 'butt';
  for (let i = i0; i < i0 + 4; i++) {
    const bx = RODS[i];
    const by = rodLen(i) * 0.58 + 6;
    const lit = bulbLit(i, o);
    if (lit > 0) {
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = ANT.zap;
      ctx.beginPath();
      ctx.arc(bx, by, 17, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.fillStyle = ANT.dark;
    ctx.beginPath();
    ctx.arc(bx, by, 10.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lit > 0 ? (o.enraged ? '#ff6b3d' : ANT.zap) : ANT.off;
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, TAU);
    ctx.fill();
    if (lit > 0) {
      ctx.fillStyle = ANT.dark;
      ctx.beginPath();
      ctx.arc(bx + lx * 3.2, by + ly * 3.2, 3.2, 0, TAU);
      ctx.fill();
    }
  }
}

function drawThunderAntenna(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const body = tinted(ANT.base, o);
  const boomY = cy - 14;
  const tilt = -0.04 + swayAngle(t, 1.3, 0.012) * (1 - g);
  ctx.globalAlpha = alpha;
  enrageHaze(ctx, cx, cy + 34, R * 1.3, 84, o, alpha);

  // far lightning now and then
  if (g <= 0 && strobe(t, 6, 17, 0.07) > 0) {
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = ANT.light;
    ctx.lineWidth = 2;
    ctx.beginPath();
    boltPath(ctx, cx - R * 1.36, cy - 150, cx - R * 1.3, cy - 30, 5, 12, t, 3);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // the TV under the boom's left half, on its cable (기획 19차 review: under the middle the party hid it — and 1.3×)
  const tvW = 214;
  const tvH = 104;
  const tvC = cx + TV_SIDE;
  const tvX = tvC - tvW / 2;
  const tvY = cy + 20;
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(tvC - 8, boomY + 6);
  ctx.quadraticCurveTo(tvC - 28 + Math.sin(t * 2) * 3, cy + 8, tvC - 38, tvY + 4);
  ctx.moveTo(tvC + 8, boomY + 6);
  ctx.quadraticCurveTo(tvC + 32 - Math.sin(t * 2) * 3, cy + 6, tvC + 38, tvY + 4);
  ctx.stroke();
  ctx.fillStyle = ANT.dark;
  ctx.fillRect(tvX + 20, tvY + tvH - 2, 20, 10);
  ctx.fillRect(tvX + tvW - 40, tvY + tvH - 2, 20, 10);
  pathRoundRect(ctx, tvX, tvY, tvW, tvH, 12);
  ctx.fillStyle = body;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = tinted(ANT.rim, o);
  ctx.lineWidth = 3;
  ctx.stroke();
  const sx = tvX + 13;
  const sy = tvY + 12;
  const sw = 138;
  const sh = tvH - 24;
  const off = g > 0.5;
  pathRoundRect(ctx, sx, sy, sw, sh, 14);
  ctx.fillStyle = off ? '#07090b' : o.phase >= 2 ? '#c9b458' : '#9aa3ab';
  ctx.fill();
  if (off) {
    // switched off: the picture collapses to a line, then a dot
    const w = (sw - 20) * (1 - g) * 2 + 6;
    ctx.fillStyle = ANT.light;
    ctx.fillRect(sx + sw / 2 - w / 2, sy + sh / 2 - 1.5, w, 3);
  } else {
    // snow
    const step = Math.floor(t * 14);
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = c === 0 ? ANT.light : ANT.base;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const w = 12 + hash01(step + i, 50 + c) * 22;
        ctx.rect(sx + 8 + hash01(step + i, 52 + c) * (sw - 16 - w), sy + 7 + hash01(step + i, 54 + c) * (sh - 16), w, 3);
      }
      ctx.fill();
    }
    // a figure shows through while it winds up; white on the strike
    if (o.charge > 0) {
      ctx.globalAlpha = alpha * Math.min(1, o.charge * 1.2);
      ctx.fillStyle = ANT.dark;
      ctx.beginPath();
      ctx.arc(sx + sw / 2, sy + sh * 0.4, 14, 0, TAU);
      ctx.ellipse(sx + sw / 2, sy + sh - 2, 31, 25, 0, Math.PI, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    if (o.flash > 0) {
      pathRoundRect(ctx, sx, sy, sw, sh, 14);
      ctx.globalAlpha = alpha * o.flash;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
  }
  ctx.fillStyle = ANT.metal;
  ctx.beginPath();
  ctx.arc(tvX + tvW - 31, tvY + 29, 12, 0, TAU);
  ctx.arc(tvX + tvW - 31, tvY + 59, 9, 0, TAU);
  ctx.rect(tvX + tvW - 47, tvY + 78, 32, 4);
  ctx.rect(tvX + tvW - 47, tvY + 86, 32, 4);
  ctx.fill();

  // the antenna: the far half (knocked down, it snaps and droops), then the lightning-rod half
  const { lx, ly } = lookDir(cam, cx, boomY + 40, o);
  ctx.save();
  ctx.translate(cx, boomY);
  ctx.rotate(tilt - 0.36 * g);
  antennaHalf(ctx, 0, -1, o, lx, ly, alpha);
  ctx.restore();
  ctx.save();
  ctx.translate(cx, boomY);
  ctx.rotate(tilt);
  // lightning rod at the right end, up between the HUD boxes
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ROD_X, 0);
  ctx.lineTo(ROD_X, -84);
  ctx.stroke();
  ctx.strokeStyle = ANT.metal;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = ANT.metal;
  ctx.beginPath();
  ctx.arc(ROD_X, -60, 7, 0, TAU);
  ctx.moveTo(ROD_X - 5, -82);
  ctx.lineTo(ROD_X, -108);
  ctx.lineTo(ROD_X + 5, -82);
  ctx.fill();
  const tip = Math.max(o.charge, o.flash, g <= 0 ? strobe(t, 9, 23, 0.1) * 0.5 : 0);
  if (tip > 0) glowEllipse(ctx, ROD_X, -106, 22, 22, '#ffffff', alpha * tip);
  ctx.globalAlpha = alpha;
  antennaHalf(ctx, 4, 1, o, lx, ly, alpha);
  ctx.restore();

  // the strike: from the rod's tip down the boom into the TV
  if (o.flash > 0) {
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    boltPath(ctx, cx + ROD_X + 4, boomY - 118, tvC + 30, tvY + 6, 8, 16, t, 9);
    ctx.globalAlpha = alpha * 0.5 * o.flash;
    ctx.strokeStyle = ANT.zap;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.globalAlpha = alpha * o.flash;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineJoin = 'round';
  }
  ctx.globalAlpha = 1;
}

function drawAntennaProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const a = alpha * o.groggy;
  // smoke off the dead set, and the last thing it said
  ctx.fillStyle = '#9aa3ab';
  for (let i = 0; i < 3; i++) {
    const u = (o.time * 0.5 + i / 3) % 1;
    ctx.globalAlpha = a * 0.5 * Math.sin(u * Math.PI);
    ctx.beginPath();
    ctx.arc(cx + TV_SIDE + 60 + Math.sin(u * 5 + i) * 8, cy + 18 - u * 50, 7 + u * 9, 0, TAU);
    ctx.fill();
  }
  plaque(ctx, cx + TV_SIDE - 14, cy + 72, 84, 26, '지지직…', '#0d0f12', '#f8f9fa', a * (0.6 + 0.4 * strobe(o.time, 9, 4, 0.7)), 0);
}

// ─────────────────────────── 대답하는 연필 (책상형: 모눈 종이 위에 손 둘이 세워 잡은 큰 연필) ───────────────────────────

const PEN = { base: '#ffd166', side: '#cca752', shine: '#ffe6ab', rage: '#f6c1b0', lead: '#1d1d1d', paper: '#f7efd2', edge: '#cdbb8a', wood: '#e9c9a1', grid: '#8fb0c8', red: '#c1121f', skin: '#e6e1d8', ink: '#3a2c0a' };

function drawAnsweringPencil(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const paper = o.enraged ? PEN.rage : PEN.paper; // the page stays a page; phase 2 shows in the red writing
  const ink = o.phase >= 2 || o.enraged ? PEN.red : PEN.lead;
  // shallow on purpose: the sheet is opaque and ground marks under it (puddles, rings) would be lost
  const pTop = cy - 12;
  const pBot = cy + 60;
  const wTop = R * 1.85;
  const wBot = R * 2.04;
  ctx.globalAlpha = alpha;
  enrageHaze(ctx, cx, cy + 26, R * 1.9, 76, o, alpha, PEN.base);

  // the sheet of yellowed graph paper along the back edge
  ctx.fillStyle = paper;
  ctx.strokeStyle = PEN.edge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - wTop, pTop);
  ctx.lineTo(cx + wTop, pTop);
  ctx.lineTo(cx + wBot, pBot);
  ctx.lineTo(cx - wBot, pBot);
  ctx.closePath();
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = PEN.grid;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 1; k < 5; k++) {
    const u = k / 5;
    const w = wTop + (wBot - wTop) * u;
    ctx.moveTo(cx - w, pTop + (pBot - pTop) * u);
    ctx.lineTo(cx + w, pTop + (pBot - pTop) * u);
  }
  for (let k = -8; k <= 8; k++) {
    ctx.moveTo(cx + (k * wTop) / 9, pTop);
    ctx.lineTo(cx + (k * wBot) / 9, pBot);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha;

  // what it has written so far: ㄱ  ㅇ  (pencil)  ㅇ  ㄷ — the two ㅇ watch the target
  const ly0 = cy + 23;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 262, ly0 - 13);
  ctx.lineTo(cx - 228, ly0 - 13);
  ctx.lineTo(cx - 233, ly0 + 15);
  ctx.moveTo(cx + 262, ly0 - 13);
  ctx.lineTo(cx + 230, ly0 - 13);
  ctx.lineTo(cx + 229, ly0 + 14);
  ctx.lineTo(cx + 264, ly0 + 14);
  for (let s = -1; s <= 1; s += 2) {
    ctx.moveTo(cx + s * 128 + 25, ly0);
    ctx.ellipse(cx + s * 128, ly0, 25, 16, 0, 0, TAU);
  }
  // phase 2: it starts writing a name under them, line after line
  if (o.phase >= 2) {
    for (let s = -1; s <= 1; s += 2) {
      ctx.moveTo(cx + s * 60, cy + 50);
      for (let k = 1; k <= 9; k++) ctx.lineTo(cx + s * (60 + k * 15), cy + 50 + (k % 2 === 0 ? 4 : -4) * (0.5 + hash01(k, 12)));
    }
  }
  ctx.stroke();
  const { lx, ly } = lookDir(cam, cx, ly0, o);
  const open = o.groggyWake > 0 ? 1 : blink(t, 5) * (1 - g);
  ctx.fillStyle = ink;
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    const ex = cx + s * 128 + lx * 10;
    const ey = ly0 + ly * 6;
    ctx.moveTo(ex + 8, ey);
    ctx.ellipse(ex, ey, 8, Math.max(1.2, 6.5 * open), 0, 0, TAU);
  }
  ctx.fill();

  // the pencil: its tip circles on the paper; winding up it lifts and points at the target; knocked down it topples
  const tipX = cx + Math.cos(t * 3.1) * 9 * (1 - g) + lx * 46 * o.charge + 26 * g;
  const tipY = cy + 46 + Math.sin(t * 3.1) * 3 * (1 - g) - 26 * o.charge + Math.sin(t * 40) * 2 * o.charge;
  const topX = cx + 14 + 150 * g;
  const topY = cy - 250;
  const dx = topX - tipX;
  const dy = topY - tipY;
  const len = Math.hypot(dx, dy) || 1;
  // the small circles it keeps drawing, and the stroke of a hit
  ctx.strokeStyle = PEN.lead;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = alpha * 0.7;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 47, 11, 4.5, 0, 0, TAU);
  ctx.moveTo(cx + 9, cy + 48);
  ctx.ellipse(cx + 2, cy + 48, 7, 3, 0, 0, TAU);
  ctx.stroke();
  if (o.flash > 0) {
    ctx.globalAlpha = alpha * o.flash;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + lx * 210, Math.min(pBot - 6, tipY + Math.abs(ly) * 18));
    ctx.stroke();
    ctx.fillStyle = PEN.lead;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) ctx.rect(tipX + (hash01(i, 14) - 0.5) * 70, tipY - 4 + (hash01(i, 15) - 0.5) * 24, 4, 4);
    ctx.fill();
  }
  // knocked down: a big red ✕ over the page (틀린 답)
  if (g > 0) {
    ctx.globalAlpha = alpha * g;
    ctx.strokeStyle = PEN.red;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx - 78, cy - 4);
    ctx.lineTo(cx + 78, cy + 54);
    ctx.moveTo(cx + 78, cy - 4);
    ctx.lineTo(cx - 78, cy + 54);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;

  // two long pale arms come down from above and hold it (one hand over the other)
  const h1 = 86 - 16 * g;
  const h2 = 58 - 16 * g;
  const g1x = tipX + (dx / len) * h1;
  const g1y = tipY + (dy / len) * h1;
  const g2x = tipX + (dx / len) * h2;
  const g2y = tipY + (dy / len) * h2;
  const HW = 21;
  limb(ctx, cx - 190, cy - 120, g1x - HW - 28, g1y + 10, -26, 13, PEN.skin, PEN.ink);
  limb(ctx, cx + 200, cy - 110, g2x + HW + 28, g2y + 10, 26, 13, PEN.skin, PEN.ink);

  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.rotate(Math.atan2(dx, -dy));
  const body = tinted(PEN.base, o);
  ctx.beginPath();
  ctx.rect(-HW, -340, HW * 2, 298);
  ctx.fillStyle = body;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.fillStyle = tinted(PEN.side, o);
  ctx.fillRect(-HW, -340, HW * 0.6, 298);
  ctx.fillStyle = tinted(PEN.shine, o);
  ctx.fillRect(HW * 0.35, -340, HW * 0.3, 298);
  ctx.strokeStyle = PEN.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-HW, -340, HW * 2, 298);
  ctx.fillStyle = PEN.wood;
  ctx.beginPath();
  ctx.moveTo(-HW, -42);
  ctx.lineTo(HW, -42);
  ctx.lineTo(7, -14);
  ctx.lineTo(-7, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // the lead (snapped off when knocked down)
  if (g < 0.5) {
    ctx.fillStyle = PEN.lead;
    ctx.beginPath();
    ctx.moveTo(-7, -14);
    ctx.lineTo(7, -14);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.globalAlpha = alpha * (1 - 0.3 * g);
  hand(ctx, g1x - HW + 2, g1y + 14 * g, 1, 21, t * (1 - g) + o.charge * 3, PEN.skin, g);
  hand(ctx, g2x + HW - 2, g2y + 14 * g, -1, 21, t * (1 - g) + 1.7 + o.charge * 3, PEN.skin, g);
  ctx.lineJoin = 'miter';
  ctx.globalAlpha = 1;
}

function drawPencilProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const a = alpha * o.groggy;
  // the broken lead on the page, and the sound it made
  ctx.globalAlpha = a;
  ctx.fillStyle = PEN.lead;
  ctx.beginPath();
  ctx.moveTo(cx - 52, cy + 52);
  ctx.lineTo(cx - 34, cy + 46);
  ctx.lineTo(cx - 37, cy + 58);
  ctx.closePath();
  ctx.fill();
  plaque(ctx, cx - 76, cy + 28, 44, 28, '툭', PEN.paper, PEN.lead, a, -0.12);
}

// ─────────────────────────── 거꾸로 뜬 달 (하늘: 붉은 하늘의 뒤집힌 달, 가운데 세로 눈) ───────────────────────────

const MOON = { base: '#f1faee', rim: '#9da39b', pit: '#d2dacf', bloodRim: '#7a2226', bloodPit: '#c0393e', red: '#d00000', blood: '#e5484d', sky: '#6a0012', shadow: '#0b0508', halo: '#fff3c4' };
/** Small craters (x, y, r as fractions of the radius) — the face itself is drawn apart. */
const CRATERS = [-0.55, -0.2, 0.16, 0.5, 0.38, 0.12, 0.62, -0.42, 0.1, -0.3, 0.66, 0.09, -0.1, -0.7, 0.07];

function drawInvertedMoon(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const red = o.phase >= 2 || o.enraged;
  const base = tinted(red ? MOON.blood : MOON.base, o);
  const mr = 76;
  const mx = cx + Math.sin(t * 0.6) * 7 * (1 - g);
  const my = cy + 28 + Math.sin(t * 0.9) * 3 * (1 - g);
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.5);

  // the red sky around it
  glowEllipse(ctx, cx, cy + 18, R * 2.5, 130, MOON.sky, alpha * (0.5 + 0.15 * (o.phase - 1)));
  ctx.globalAlpha = alpha;
  enrageHaze(ctx, mx, my, mr * 1.7, mr * 1.5, o, alpha, MOON.halo);
  glowEllipse(ctx, mx, my, mr + 30, mr + 30, red ? '#ff5d5d' : MOON.halo, alpha * 0.22 * (1 - 0.6 * g));

  // shadow hanging off the moon to both sides, pooling at the corners of the roof's back edge — off the fighting floor,
  // so no ground mark hides under it (it breathes; knocked down it thins out)
  const sa = alpha * 0.85 * (1 - 0.75 * g);
  ctx.strokeStyle = MOON.shadow;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = sa * (1 - k * 0.22);
    ctx.lineWidth = 18 - k * 4;
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      ctx.moveTo(mx + s * mr * (0.93 - k * 0.2), my + mr * (0.3 + k * 0.27));
      ctx.quadraticCurveTo(mx + s * (mr + 40 + k * 26), cy + 84 - k * 10 + breathe * 6, cx + s * (R * 1.62 + k * 40), cy + 24 + k * 2);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.globalAlpha = sa;
  ctx.fillStyle = MOON.shadow;
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    ctx.moveTo(cx + s * R * 1.95 + 84 + breathe * 10, cy + 26);
    ctx.ellipse(cx + s * R * 1.95, cy + 26, 84 + breathe * 10, 13 + breathe * 2, 0, 0, TAU);
  }
  ctx.fill();
  // …and something in each pool looks back
  ctx.globalAlpha = sa * blink(t, 8);
  ctx.fillStyle = red ? '#ff5d5d' : '#f6f0d8';
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    ctx.rect(cx + s * R * 1.95 - 9, cy + 23, 5, 3);
    ctx.rect(cx + s * R * 1.95 + 4, cy + 23, 5, 3);
  }
  ctx.fill();
  ctx.globalAlpha = alpha;

  // the disc and its face — upside down: the smile on top, the eye pits below (knocked down it turns the right way up)
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(swayAngle(t, 0.7, 0.06) * (1 - g) + Math.PI * g);
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(0, 0, mr, 0, TAU);
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = red ? MOON.bloodRim : MOON.rim;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = red ? MOON.bloodPit : MOON.pit;
  ctx.beginPath();
  for (let i = 0; i < CRATERS.length; i += 3) {
    ctx.moveTo((CRATERS[i] + CRATERS[i + 2]) * mr, CRATERS[i + 1] * mr);
    ctx.arc(CRATERS[i] * mr, CRATERS[i + 1] * mr, CRATERS[i + 2] * mr, 0, TAU);
  }
  ctx.fill();
  const face = red ? '#4a0006' : '#4b4a5a';
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(-mr * 0.44, mr * 0.42, mr * 0.17, mr * 0.14, 0, 0, TAU);
  ctx.ellipse(mr * 0.44, mr * 0.42, mr * 0.17, mr * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = face;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, -mr * 0.02, mr * 0.62, Math.PI * 1.17, Math.PI * 1.83);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.restore();

  // 월식: while it winds up the dark slides over the disc; a red rim stays
  const dark = Math.max(o.charge, o.flash);
  if (dark > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = alpha * 0.93;
    ctx.fillStyle = '#12060a';
    ctx.beginPath();
    ctx.arc(mx + (1 - dark) * mr * 2, my, mr * 1.03, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha * dark;
    ctx.strokeStyle = MOON.red;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mx, my, mr + 3, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // the one upright eye in the middle (it stays lit through the eclipse; shut when knocked down)
  const { lx, ly } = lookDir(cam, mx, my, o);
  const open = o.groggyWake > 0 ? 1 : blink(t, 2) * (1 - g);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.PI / 2);
  bigEye(ctx, 0, 0, 25, ly, -lx, red || dark > 0.3 || o.groggyWake > 0, alpha, open);
  ctx.restore();
  ctx.globalAlpha = alpha;

  // phase 2: the red moon drips
  if (o.phase >= 2) dripRow(ctx, mx - mr * 0.6, my + mr * 0.8, mr * 1.2, 5, 46, t, '#b00012', alpha * 0.9 * (1 - g));

  // black moths around it (knocked down they scatter)
  ctx.globalAlpha = alpha * 0.9 * (1 - 0.8 * g);
  ctx.fillStyle = MOON.shadow;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = t * (0.5 + hash01(i, 91) * 0.5) + i * 1.3;
    const rr = (mr + 34 + hash01(i, 92) * 60) * (1 + g * 0.7);
    const px = mx + Math.cos(a) * rr * 1.7;
    const py = my + Math.sin(a) * rr * 0.5 - 6;
    const flap = Math.sin(t * 16 + i * 2) * 6;
    ctx.moveTo(px, py + 5);
    ctx.lineTo(px - 14, py - flap);
    ctx.lineTo(px, py - 2);
    ctx.lineTo(px + 14, py - flap);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawMoonProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  // moths that fell out of the sky lie on the roof, wings still twitching
  ctx.globalAlpha = alpha * o.groggy;
  ctx.fillStyle = MOON.shadow;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const px = cx + (i - 1.5) * 78 + hash01(i, 93) * 20;
    const py = cy + 100 + hash01(i, 94) * 8;
    const flap = 2 + Math.abs(Math.sin(o.time * 7 + i)) * 3;
    ctx.moveTo(px, py);
    ctx.lineTo(px - 10, py - flap);
    ctx.lineTo(px - 7, py + 3);
    ctx.lineTo(px + 7, py + 3);
    ctx.lineTo(px + 10, py - flap);
    ctx.closePath();
  }
  ctx.fill();
}

/** Boss id → look. */
export const ROOFTOP_LOOKS: Record<string, BossLook> = {
  tank_dweller: { draw: drawTankDweller, color: TANK.base, headY: (by, _R, g) => by + 4 + 14 * g, props: drawTankProps },
  thunder_antenna: { draw: drawThunderAntenna, color: ANT.base, headY: (by, _R, g) => by + 14 + 14 * g, props: drawAntennaProps },
  answering_pencil: { draw: drawAnsweringPencil, color: PEN.base, headY: (by, _R, g) => by + 8 + 14 * g, props: drawPencilProps },
  inverted_moon: { draw: drawInvertedMoon, color: MOON.base, headY: (by, _R, g) => by - 22 + 14 * g, props: drawMoonProps },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const ROOFTOP_TELE_MOTIF: Record<string, TeleMotif> = {
  td_drain: 'pull',
  td_umbrellas: 'spawn',
  im_shadows: 'spawn',
};

/** MonsterDef.look → the body of this zone's summon-only units (none: the rooftop bosses call existing monsters). */
export const ROOFTOP_MINION_LOOKS: Record<string, CreatureDrawFn> = {};
