// 기획 19차 보스 레이드 — 사무실 boss looks (docs/bosses.md 4장). This zone's track owns this file.
// Bosses: shredder_maw 문서 파쇄기 · coffee_machine 식지 않는 커피 머신 · dead_monitor 퇴근 못 한 모니터 · endless_meeting 끝나지 않는 회의.
// Summon looks (keyed by MonsterDef.look): error_popup. Warning motifs (skill id → motif): cf_pour / cf_overflow linger · dm_popups spawn
// (a motif only shows on a part that has a delay — an instant summon has no warning to decorate).
//
// Silhouettes (so the five office bosses read apart on a phone): 파쇄기 = a black box with a toothed slot over a clear
// bin · 커피 머신 = a round silver dome with two spout eyes, steam and a cup tower · 모니터 = a beige CRT with a blue
// face on its screen and two cable arms · 회의 = a table as wide as the screen with empty chairs, a faceless chairman
// and a whiteboard (야근의 군주 keeps the narrow desk with the many arms).
//
// Art rules: read only BossDrawOpts + o.time + hash01 (no Math.random / Date); faces and eyes at screen y 100–230 (the HUD
// boss box covers x 424–856, y < 100); ≤ 360 canvas calls a frame, ≤ 2 fillText, no gradients, no shadowBlur, nothing
// allocated per frame; safe for o.phase 1–3. Colours: every mix / lighten / darken starts from a hex literal (the colour
// cache cannot read its own 'rgb()' results back, so a tint of a tint would turn grey) — hence tint() below.
// Checks: npx vitest run tests/render/boss-looks.test.ts (every registered look, 15 poses × 30 frames).
// See it: npx vite, then /tests/visual/render-sandbox.html?scene=zoo&boss=<id>&pose=idle|windup|groggy|enraged&phase=2
//         (bench=boss:<id> → window.__sandbox.bench ms/frame); all 20 on one picture: node tests/visual/boss-sheet.mjs

import { Camera, PX_PER_UNIT } from '../camera';
import { TAU, anchor, bigEye, blink, dripRow, enrageHaze, hash01, lookDir, mix, pathRoundRect, plaque, spikes, stack, strobe, wash } from './kit';
import type { BossDrawOpts, BossLook, CreatureDrawFn, TeleMotif } from './types';

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

// ─────────────────────────── 문서 파쇄기 (shredder_maw) ───────────────────────────
// base #212529 · accent #ffd60a (eyes, hazard strip) · light #f8f9fa (paper). The feed slot is a mouth of steel teeth.

const SH_BASE = '#212529';
const SH_EDGE = '#868e96';
const SH_ACCENT = '#ffd60a';
const SH_PAPER = '#f8f9fa';

function drawShredder(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const awake = 1 - g;
  const hw = R * 0.74;
  const top = cy - 36;
  const hot = o.enraged || o.charge > 0.5;
  // the motor: the whole box buzzes, harder while it winds up
  const bx = cx + Math.sin(t * 31) * (0.8 + 2 * o.charge) * awake;
  enrageHaze(ctx, cx, cy + 36, R * 0.98, 98, o, alpha, '#ffe9a8');

  // the clear bin under the box: shreds that keep wriggling
  const bw = hw * 0.86;
  pathRoundRect(ctx, cx - bw, cy + 48, bw * 2, 54, 8);
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillStyle = '#dfe6ee';
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = SH_EDGE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = o.phase >= 2 ? '#ffd9de' : SH_PAPER;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 11; i++) {
    const sx = cx - bw + 14 + (i * (bw * 2 - 28)) / 10;
    const sy = cy + 60 + hash01(i, 42) * 16;
    const wob = Math.sin(t * (3 + hash01(i, 41) * 3) + i * 1.9) * 6 * awake;
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + wob, sy + 10, sx - wob * 0.6, sy + 20 + hash01(i, 43) * 8);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = INK;
  ctx.fillRect(cx - bw + 10, cy + 100, 26, 6);
  ctx.fillRect(cx + bw - 36, cy + 100, 26, 6);

  // the box
  pathRoundRect(ctx, bx - hw, top, hw * 2, 90, 12);
  ctx.fillStyle = tint(SH_BASE, o);
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = SH_EDGE;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.fillStyle = tint('#343a40', o);
  ctx.fillRect(bx - hw + 8, top + 6, hw * 2 - 16, 5);
  // status lamp: green, red and blinking once it jams
  const jam = g > 0 || o.groggyNear > 0;
  ctx.fillStyle = jam ? (strobe(t, 6, 7) > 0 ? '#ff3b30' : '#5c1210') : '#52d273';
  ctx.beginPath();
  ctx.arc(bx + hw - 18, top + 22, 5, 0, TAU);
  ctx.fill();

  // lamp eyes: two, four from phase 2
  const { lx, ly } = lookDir(cam, bx, cy - 14, o);
  const eyeCol = o.enraged ? '#ff5a3c' : SH_ACCENT;
  const open = blink(t, 2) * awake;
  const n = o.phase >= 2 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? hw * 0.4 : hw * (0.24 + i * 0.36);
    const r = n === 1 ? 12 : 10 - i * 2;
    lampEye(ctx, bx - off, cy - 14, r, lx, ly, open, eyeCol);
    lampEye(ctx, bx + off, cy - 14, r, lx, ly, open, eyeCol);
  }

  // the slot: opens as it winds up, the two rows of teeth chew against each other
  const my = cy + 26;
  const mw = hw * 0.86;
  const gap = (6 + 2 * Math.sin(t * 2.2)) * awake + 10 * o.charge + 4 * g;
  ctx.fillStyle = SH_ACCENT;
  ctx.fillRect(bx - mw, my - gap - 9, mw * 2, 3);
  ctx.fillRect(bx - mw, my + gap + 6, mw * 2, 3);
  ctx.fillStyle = '#050506';
  ctx.fillRect(bx - mw, my - gap - 6, mw * 2, gap * 2 + 12);
  if (o.charge > 0) {
    ctx.globalAlpha = alpha * 0.55 * o.charge;
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(bx - mw + 3, my - gap, mw * 2 - 6, gap * 2);
    ctx.globalAlpha = alpha;
  }
  const chew = Math.sin(t * (4 + 12 * o.charge)) * 3 * awake;
  const steel = hot ? '#ff9d8f' : '#dee2e6';
  spikes(ctx, bx - mw + 3 + chew, my - gap - 6, mw * 2 - 6, 11, gap + 5, steel);
  spikes(ctx, bx - mw + 3 - chew, my + gap + 6, mw * 2 - 6, 11, -(gap + 5), steel);

  if (g > 0.3) {
    // jammed: a crumpled wad stuck between the teeth
    ctx.fillStyle = SH_PAPER;
    ctx.beginPath();
    ctx.ellipse(bx - 14, my, 26, 13, 0.2, 0, TAU);
    ctx.ellipse(bx + 16, my + 2, 22, 11, -0.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    // a sheet half eaten, hanging out like a tongue (pulled in as it winds up)
    const len = 34 * (1 - o.charge) + 8 + Math.sin(t * 9) * 2;
    ctx.fillStyle = SH_PAPER;
    ctx.fillRect(bx - 24, my, 48, len);
    ctx.fillStyle = '#868e96';
    ctx.fillRect(bx - 17, my + len - 8, 34, 2);
    if (len > 20) ctx.fillRect(bx - 17, my + len - 15, 24, 2);
  }
  if (o.flash > 0.05) {
    // attack: strips burst out of the slot
    const f = 1 - o.flash;
    ctx.globalAlpha = alpha * o.flash;
    ctx.fillStyle = SH_PAPER;
    for (let i = 0; i < 9; i++) ctx.fillRect(bx + (hash01(i, 51) - 0.5) * mw * 2 * (0.5 + f), my + 16 + f * (40 + hash01(i, 52) * 60), 5, 15);
  }
  ctx.globalAlpha = 1;
}

function shredderProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  plaque(ctx, cx, cy + 84, 118, 30, '용지 걸림', '#d00000', '#ffffff', alpha * o.groggy * (0.65 + 0.35 * strobe(o.time, 4, 3)), -0.05);
}

// ─────────────────────────── 식지 않는 커피 머신 (coffee_machine) ───────────────────────────
// base #adb5bd · accent #e63946 (lamp, gauge) · light #ffffff (cups, steam). The two spouts are its eyes.

const CF_BASE = '#adb5bd';
const CF_DARK = '#6c757d';
const CF_ACCENT = '#e63946';
const COFFEE = '#5b3a1e';

function drawCoffee(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const awake = 1 - g;
  const hw = R * 0.64;
  const press = o.charge * awake;
  // pressure: the dome swells and rattles
  const top = cy - 36 - 3 * press;
  const hx = cx + Math.sin(t * 43) * 2 * press;
  enrageHaze(ctx, cx, cy + 36, R * 0.98, 98, o, alpha, '#ffd9c2');

  // the puddle that never dries (wider from phase 2)
  const wide = o.phase >= 2 ? 1.3 : 0.86;
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = COFFEE;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 98, R * wide + Math.sin(t * 1.3) * 5, o.phase >= 2 ? 15 : 10, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // column, cup bay and drip tray
  ctx.fillStyle = tint(CF_DARK, o);
  ctx.fillRect(cx - hw * 0.72, cy + 40, hw * 1.44, 44);
  ctx.fillStyle = '#16181b';
  ctx.fillRect(cx - hw * 0.5, cy + 46, hw, 36);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - 17, cy + 56);
  ctx.lineTo(cx + 17, cy + 56);
  ctx.lineTo(cx + 12, cy + 82);
  ctx.lineTo(cx - 12, cy + 82);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COFFEE;
  ctx.fillRect(cx - 15, cy + 57, 30, 4);
  ctx.fillStyle = tint('#495057', o);
  ctx.fillRect(cx - hw * 1.2, cy + 82, hw * 2.4, 13);
  // the cup tower beside it leans a little more each beat
  stack(ctx, cx + hw * 1.42, cy + 82, 26, 8, 6, '#ffffff', '#868e96', 1.4 + Math.sin(t * 1.1) * 0.5 * awake);

  // steam off both shoulders (red from phase 2, taller with the pressure)
  ctx.globalAlpha = alpha * (0.4 + 0.4 * press) * awake;
  ctx.strokeStyle = o.phase >= 2 || o.enraged ? '#ff8fa3' : '#ffffff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1;
    const sx = cx + side * (hw + 14 + (i % 2) * 22);
    const sy = top + 58 - (i % 2) * 10;
    const rise = 40 + 26 * press;
    const w1 = Math.sin(t * 2.3 + i * 1.7) * 12;
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + w1, sy - rise * 0.35, sx - w1, sy - rise * 0.7, sx + side * 8 + w1 * 0.5, sy - rise);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = alpha;

  // the dome
  pathRoundRect(ctx, hx - hw, top, hw * 2, 88 + 3 * press, 38);
  ctx.fillStyle = tint(CF_BASE, o);
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = '#343a40';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(hx - hw + 30, top + 7, hw * 2 - 60, 5);
  ctx.globalAlpha = alpha;
  // the lamp: dim red, burning while it winds up
  const lit = press > 0.2 || o.enraged || strobe(t, 2, 4, 0.3) > 0;
  ctx.fillStyle = g > 0 ? '#5c1210' : lit ? CF_ACCENT : '#8d2f36';
  ctx.beginPath();
  const lr = 6 + 3 * press;
  ctx.arc(hx + hw - 30, top + 26, lr, 0, TAU);
  ctx.moveTo(hx - hw + 30 + lr, top + 26);
  ctx.arc(hx - hw + 30, top + 26, lr, 0, TAU);
  ctx.fill();

  // pressure gauge on the forehead: the needle swings into the red as it winds up, drops to zero when down
  const gx = hx;
  const gy = top + 30;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(gx, gy, 16, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#343a40';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = CF_ACCENT;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(gx, gy, 11, -0.9, 0.5);
  ctx.stroke();
  const needle = Math.min(0.5, -2.5 + Math.sin(t * 1.7) * 0.25 + 2.7 * o.charge + (o.enraged ? 2.2 : 0)) * awake - 2.9 * g;
  ctx.strokeStyle = '#16181b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + Math.cos(needle) * 13, gy + Math.sin(needle) * 13);
  ctx.stroke();

  // spout eyes in chrome rings; coffee keeps dripping from them
  const ey = top + 62;
  const { lx, ly } = lookDir(cam, hx, ey, o);
  const open = blink(t, 3) * awake;
  ctx.strokeStyle = '#f1f3f5';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(hx - 44, ey, 19, 0, TAU);
  ctx.moveTo(hx + 44 + 19, ey);
  ctx.arc(hx + 44, ey, 19, 0, TAU);
  ctx.stroke();
  const er = 14 + 3 * press;
  bigEye(ctx, hx - 44, ey, er, lx, ly, o.enraged || o.phase >= 2, alpha, open);
  bigEye(ctx, hx + 44, ey, er, lx, ly, o.enraged || o.phase >= 2, alpha, open);
  const drops = g > 0 ? 3 : 1;
  dripRow(ctx, hx - 50, ey + 16, 12, drops, 46, t, COFFEE, alpha);
  dripRow(ctx, hx + 38, ey + 16, 12, drops, 46, t + 0.37, COFFEE, alpha);

  if (o.flash > 0.05) {
    // attack: both spouts spray
    ctx.globalAlpha = alpha * o.flash;
    ctx.strokeStyle = COFFEE;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const a = Math.PI / 2 - side * (0.1 + (i % 3) * 0.32);
      ctx.moveTo(hx + side * 44, ey + 14);
      ctx.lineTo(hx + side * 44 + Math.cos(a) * 80, ey + 14 + Math.sin(a) * 64);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = 1;
}

function coffeeProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  plaque(ctx, cx, cy + 68, 172, 30, '물을 보충하세요', '#0b132b', '#7bdff2', alpha * o.groggy * (0.75 + 0.25 * strobe(o.time, 3, 5)));
}

// ─────────────────────────── 퇴근 못 한 모니터 (dead_monitor) ───────────────────────────
// base #e9dcc9 (beige CRT) · accent #0466c8 (blue screen) · light #ffffff. The screen is its face; two power cables are its arms.

const DM_BASE = '#e9dcc9';
const DM_SHADE = '#b9ab94';
const DM_ACCENT = '#0466c8';
const DM_RED = '#9d0208';

/** A power cable from the case to a plug: curled up and alert, hanging to the floor when down. */
function cable(ctx: Ctx, x0: number, y0: number, side: number, t: number, lift: number, g: number): void {
  const awake = 1 - g;
  const ex = x0 + side * (52 + 8 * Math.sin(t * 1.3 + side) * awake - 20 * g);
  const ey = y0 - (34 + 10 * Math.sin(t * 1.7 + side * 2) + 26 * lift) * awake + 54 * g;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(x0 + side * 46, y0 + 34 * awake + 20, ex, ey);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = '#495057';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.lineCap = 'butt';
  // the plug: two prongs pointing up (down once it hangs)
  const dir = g > 0.5 ? 1 : -1;
  ctx.fillStyle = '#ffd60a';
  ctx.fillRect(ex - 6, ey + dir * 8, 3, dir * 10);
  ctx.fillRect(ex + 3, ey + dir * 8, 3, dir * 10);
  ctx.fillStyle = '#f1f3f5';
  ctx.fillRect(ex - 9, ey - 9, 18, 18);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(ex - 9, ey - 9, 18, 18);
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

function drawMonitor(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const hw = R * 0.76;
  const top = cy - 36;
  const red = o.enraged || o.phase >= 2;
  enrageHaze(ctx, cx, cy + 36, R * 1.1, 98, o, alpha, '#cfe8ff');
  ctx.globalAlpha = alpha;

  cable(ctx, cx - hw + 6, cy + 44, -1, t, o.charge, g);
  cable(ctx, cx + hw - 6, cy + 44, 1, t, o.charge, g);

  // neck + foot
  ctx.fillStyle = tint(DM_SHADE, o);
  ctx.fillRect(cx - 24, cy + 62, 48, 18);
  ctx.fillRect(cx - 74, cy + 78, 148, 16);
  ctx.strokeStyle = '#6f6452';
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - 74, cy + 78, 148, 16);
  // the case
  pathRoundRect(ctx, cx - hw, top, hw * 2, 102, 16);
  ctx.fillStyle = tint(DM_BASE, o);
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = '#6f6452';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // buttons and the power light under the screen
  ctx.fillStyle = tint(DM_SHADE, o);
  ctx.fillRect(cx - hw + 22, top + 87, 16, 7);
  ctx.fillRect(cx - hw + 44, top + 87, 16, 7);
  ctx.fillStyle = g > 0.5 ? '#ff9f1c' : red ? '#ff3b30' : '#52d273';
  ctx.beginPath();
  ctx.arc(cx + hw - 26, top + 90, 4.5, 0, TAU);
  ctx.fill();

  // the tube: blue, red from phase 2, black once it is down
  const sw = hw - 14;
  const off = g > 0.5;
  pathRoundRect(ctx, cx - sw, top + 9, sw * 2, 72, 26);
  ctx.fillStyle = off ? '#07080c' : red ? DM_RED : DM_ACCENT;
  ctx.fill();
  ctx.strokeStyle = '#3d372c';
  ctx.lineWidth = 4;
  ctx.stroke();
  if (o.charge > 0 || o.flash > 0) {
    // wind-up: the whole tube whites out
    ctx.globalAlpha = alpha * Math.min(0.85, o.charge * 0.6 + o.flash * 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  if (!off) {
    // scan band + two noise bars that jump 12 times a second
    const step = Math.floor(t * 12);
    ctx.globalAlpha = alpha * 0.16;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - sw + 20, top + 14 + ((t * 44) % 56), sw * 2 - 40, 7);
    ctx.fillRect(cx - sw + 24, top + 16 + hash01(step, 61) * 54, sw * 2 - 48, 2);
    ctx.fillRect(cx - sw + 24, top + 16 + hash01(step, 62) * 54, sw * 2 - 48, 3);
    ctx.globalAlpha = alpha;
    // white text + the blinking caret
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - sw + 26, top + 18, 46, 3);
    ctx.fillRect(cx - sw + 26, top + 25, 30, 3);
    if (strobe(t, 3, 9) > 0) ctx.fillRect(cx - sw + 60, top + 24, 9, 4);
    // the pixel face: square eyes that follow the target, a smile that turns into a zigzag
    const { lx, ly } = lookDir(cam, cx, top + 44, o);
    const fx = cx + lx * 9;
    const fy = top + 40 + ly * 4;
    const eh = 20 * blink(t, 5);
    ctx.fillRect(fx - 42, fy - eh / 2, 18, eh);
    ctx.fillRect(fx + 24, fy - eh / 2, 18, eh);
    ctx.fillStyle = red ? '#ffd6d6' : '#0b1f3a';
    ctx.fillRect(fx - 36 + lx * 4, fy - 4 + ly * 3, 8, Math.min(8, eh));
    ctx.fillRect(fx + 30 + lx * 4, fy - 4 + ly * 3, 8, Math.min(8, eh));
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const d = Math.abs(i - 2);
      const curve = red ? (i % 2) * 7 - 2 : d === 2 ? -7 : d === 1 ? 0 : 3;
      ctx.fillRect(fx - 29 + i * 12, fy + 24 + curve, 10, 6);
    }
    // the pointer creeps toward whoever it watches and grows as it winds up
    pointer(ctx, cx + 58 + lx * 22 + Math.sin(t * 0.9) * 10 - 40 * o.charge, top + 30 + ly * 10 + Math.cos(t * 1.3) * 6, 15 + 26 * o.charge);
  }
  if (o.flash > 0.05) {
    // attack: two pop-up windows jump out of the screen
    const f = 1 - o.flash;
    ctx.globalAlpha = alpha * o.flash;
    for (let side = -1; side <= 1; side += 2) {
      const wx = cx + side * (hw + 20 + 46 * f) - 26;
      const wy = cy + 24 - 34 * f;
      ctx.fillStyle = '#f1f3f5';
      ctx.fillRect(wx, wy, 52, 36);
      ctx.fillStyle = DM_ACCENT;
      ctx.fillRect(wx, wy, 52, 10);
      ctx.fillStyle = '#e63946';
      ctx.fillRect(wx + 41, wy + 1, 9, 8);
    }
  }
  ctx.globalAlpha = 1;
}

function monitorProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  // the OSD box drifts over the dead screen like a real one
  const dx = Math.sin(o.time * 0.9) * 26;
  const dy = Math.cos(o.time * 1.3) * 8;
  plaque(ctx, cx + dx, cy + 14 + dy, 112, 28, '신호 없음', '#0466c8', '#ffffff', alpha * o.groggy);
}

// ─────────────────────────── 끝나지 않는 회의 (endless_meeting) ───────────────────────────
// base #495057 (table) · accent #f77f00 (projector) · light #f1faee (whiteboard). A table as wide as the screen.

const EM_BASE = '#495057';
const EM_TOP = '#6c757d';
const EM_CHAIR = '#2b3035';
const EM_SUIT = '#16191d';
const EM_ACCENT = '#f77f00';
const EM_LIGHT = '#f1faee';
const EM_SKIN = '#e9e4da';
const CHAIR_X = [-250, -172, -94, 94, 172, 250];

function drawMeeting(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  const g = o.groggy;
  const awake = 1 - g;
  const hw = R * 1.85;
  const top = cy - 36;
  const rise = 9 * o.charge * awake;
  enrageHaze(ctx, cx, cy + 36, R * 1.7, 100, o, alpha, '#ffe2bf');
  ctx.globalAlpha = alpha;

  // whiteboard: the agenda gets one more line each phase, the chart only goes up
  ctx.fillStyle = EM_LIGHT;
  ctx.fillRect(cx - 124, top, 248, 68);
  ctx.strokeStyle = '#868e96';
  ctx.lineWidth = 4;
  ctx.strokeRect(cx - 124, top, 248, 68);
  const rows = 2 + Math.min(3, Math.max(1, o.phase));
  for (let i = 0; i < rows; i++) {
    ctx.fillStyle = i >= 3 ? '#d00000' : '#343a40';
    ctx.fillRect(cx - 114, top + 8 + i * 11, 6, 5);
    ctx.fillRect(cx - 104, top + 9 + i * 11, 24 + hash01(i, 71) * 22, 3);
  }
  ctx.strokeStyle = EM_ACCENT;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx + 64, top + 54);
  ctx.lineTo(cx + 80, top + 40);
  ctx.lineTo(cx + 92, top + 46);
  ctx.lineTo(cx + 112, top + 14);
  ctx.stroke();

  // ceiling projector: its beam lies on the board; one sharp dot while it winds up; off when the meeting is adjourned
  const px = cx + hw - 84;
  if (g < 0.5) {
    ctx.globalAlpha = alpha * (0.2 + 0.1 * Math.sin(t * 3) + 0.25 * o.charge);
    ctx.fillStyle = EM_ACCENT;
    ctx.beginPath();
    ctx.moveTo(px, top + 20);
    ctx.lineTo(cx + 124, top + 4 + 22 * o.charge);
    ctx.lineTo(cx + 124, top + 64 - 22 * o.charge);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  ctx.fillStyle = '#212529';
  ctx.fillRect(px, top + 8, 46, 22);
  ctx.fillRect(px + 18, top - 6, 8, 14);
  ctx.fillStyle = g < 0.5 ? EM_ACCENT : '#5a4632';
  ctx.beginPath();
  ctx.arc(px, top + 20, 7, 0, TAU);
  ctx.fill();

  // six empty chairs behind the table, each turning a little on its own
  ctx.fillStyle = tint(EM_CHAIR, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < CHAIR_X.length; i++) {
    const turn = 0.62 + 0.38 * Math.abs(Math.cos(t * 0.55 * awake + i * 1.7));
    const sx = cx + CHAIR_X[i];
    const w = 25 * turn;
    ctx.moveTo(sx - w, cy + 66);
    ctx.lineTo(sx - w, cy + 26);
    ctx.quadraticCurveTo(sx - w, cy + 8, sx, cy + 8);
    ctx.quadraticCurveTo(sx + w, cy + 8, sx + w, cy + 26);
    ctx.lineTo(sx + w, cy + 66);
  }
  ctx.fill();
  ctx.stroke();

  // the chairman: a dark suit that stands up as it winds up and falls on the table when down
  const sy = cy + 26 - rise + 28 * g;
  ctx.fillStyle = '#3a2420';
  ctx.fillRect(cx - 44, cy + 2, 88, 66);
  ctx.beginPath();
  ctx.moveTo(cx - 62, cy + 70);
  ctx.quadraticCurveTo(cx - 64, sy, cx - 28, sy - 5);
  ctx.lineTo(cx + 28, sy - 5);
  ctx.quadraticCurveTo(cx + 64, sy, cx + 62, cy + 70);
  ctx.closePath();
  ctx.fillStyle = EM_SUIT;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = '#868e96';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f8f9fa';
  ctx.beginPath();
  ctx.moveTo(cx - 14, sy - 4);
  ctx.lineTo(cx, sy + 30);
  ctx.lineTo(cx + 14, sy - 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = o.phase >= 2 || o.enraged ? '#d00000' : EM_ACCENT;
  ctx.beginPath();
  ctx.moveTo(cx - 5, sy);
  ctx.lineTo(cx + 5, sy);
  ctx.lineTo(cx + 7, sy + 28);
  ctx.lineTo(cx, sy + 36);
  ctx.lineTo(cx - 7, sy + 28);
  ctx.closePath();
  ctx.fill();

  // the table: top face, front panel, a sheet at every seat, the name tag
  ctx.beginPath();
  ctx.rect(cx - hw, cy + 60, hw * 2, 14);
  ctx.fillStyle = tint(EM_TOP, o);
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.fillStyle = tint(EM_BASE, o);
  ctx.fillRect(cx - hw + 8, cy + 74, hw * 2 - 16, 26);
  ctx.fillStyle = INK;
  ctx.fillRect(cx - hw, cy + 73, hw * 2, 3);
  ctx.fillStyle = EM_LIGHT;
  ctx.beginPath();
  for (let i = 0; i < CHAIR_X.length; i++) ctx.rect(cx + CHAIR_X[i] - 15, cy + 63, 30, 7);
  ctx.fill();
  plaque(ctx, cx, cy + 87, 82, 22, '회의 중', EM_LIGHT, '#212529', alpha);

  // the head: no face at all
  const hx = cx + 10 * g;
  const hy = cy - 2 - rise + 56 * g;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 23, 27, 0.5 * g, 0, TAU);
  ctx.fillStyle = EM_SKIN;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(hx - 2 * g, hy - 9 + 4 * g, 24, 20, 0.5 * g, Math.PI, TAU);
  ctx.fill();

  // hands: one taps the table, the other holds the laser pointer (the dot runs out toward its target)
  const tap = Math.max(0, Math.sin(t * 9)) * 5 * awake * (1 - o.charge);
  const ly0 = cy + 58 - 26 * o.charge * awake;
  ctx.fillStyle = EM_SKIN;
  ctx.beginPath();
  ctx.ellipse(cx - 46, cy + 62 - tap, 11, 7, 0, 0, TAU);
  ctx.moveTo(cx + 57, ly0);
  ctx.ellipse(cx + 46, ly0, 11, 7, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  const k = Math.max(o.charge * 0.7, o.flash) * awake;
  if (k > 0.02) {
    const { lx, ly } = lookDir(cam, cx + 46, ly0, o);
    const len = 50 + 190 * k;
    ctx.globalAlpha = alpha * Math.min(1, 0.35 + k);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2 + 4 * o.flash;
    ctx.beginPath();
    ctx.moveTo(cx + 46, ly0);
    ctx.lineTo(cx + 46 + lx * len, ly0 + ly * len);
    ctx.stroke();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(cx + 46 + lx * len, ly0 + ly * len, 5 + 4 * k, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function meetingProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  plaque(ctx, cx, cy + 4, 84, 34, '휴회', EM_ACCENT, '#1b1b1b', alpha * o.groggy, -0.07);
}

// ─────────────────────────── 오류 창 (error_popup, 퇴근 못 한 모니터's summon) ───────────────────────────

/** A floating pop-up window: title bar with ✕, a warning sign, a 「확인」 button. It jolts when it shoots. */
const errorPopup: CreatureDrawFn = (ctx, fill, flash, fx, fy, w, h, s, time, phase, act) => {
  const bw = w * 1.5 * (1 + 0.12 * act);
  const bh = h * 0.92 * (1 + 0.12 * act);
  const x0 = fx - bw / 2 + Math.sin(time * 23 + phase) * act * 2;
  const y0 = fy - h * 0.22 - bh + Math.sin(time * 2.4 + phase) * h * 0.05;
  const bar = bh * 0.24;
  // a second window peeking out behind it
  ctx.fillStyle = '#8d99ae';
  ctx.fillRect(x0 + s * bw * 0.12, y0 - bh * 0.1, bw, bh);
  ctx.fillStyle = flash ? '#ffffff' : '#f1f3f5';
  ctx.fillRect(x0, y0, bw, bh);
  ctx.fillStyle = flash ? '#ffffff' : fill;
  ctx.fillRect(x0, y0, bw, bar);
  ctx.fillStyle = '#e63946';
  ctx.fillRect(x0 + bw - bar * 1.05, y0 + bar * 0.12, bar * 0.9, bar * 0.76);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.2, bar * 0.14);
  ctx.beginPath();
  ctx.moveTo(x0 + bw - bar * 0.85, y0 + bar * 0.28);
  ctx.lineTo(x0 + bw - bar * 0.35, y0 + bar * 0.72);
  ctx.moveTo(x0 + bw - bar * 0.35, y0 + bar * 0.28);
  ctx.lineTo(x0 + bw - bar * 0.85, y0 + bar * 0.72);
  ctx.stroke();
  // warning triangle (red while it shoots) with its '!'
  const tx = x0 + bw * 0.27;
  const ty = y0 + bar + (bh - bar) * 0.42;
  const tr = (bh - bar) * 0.3;
  ctx.fillStyle = act > 0.3 ? '#ff3b30' : '#ffd60a';
  ctx.beginPath();
  ctx.moveTo(tx, ty - tr);
  ctx.lineTo(tx + tr, ty + tr * 0.8);
  ctx.lineTo(tx - tr, ty + tr * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(tx - tr * 0.1, ty - tr * 0.45, tr * 0.2, tr * 0.7);
  ctx.fillRect(tx - tr * 0.1, ty + tr * 0.4, tr * 0.2, tr * 0.2);
  // two text lines and the button
  ctx.fillStyle = '#868e96';
  ctx.fillRect(x0 + bw * 0.5, y0 + bar + (bh - bar) * 0.2, bw * 0.38, Math.max(1.5, bh * 0.05));
  ctx.fillRect(x0 + bw * 0.5, y0 + bar + (bh - bar) * 0.38, bw * 0.28, Math.max(1.5, bh * 0.05));
  ctx.fillStyle = '#ced4da';
  ctx.fillRect(x0 + bw * 0.5, y0 + bh * 0.72, bw * 0.36, bh * 0.18);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = Math.max(1.5, w * 0.05);
  ctx.strokeRect(x0, y0, bw, bh);
};

/** Boss id → look. */
export const OFFICE_LOOKS: Record<string, BossLook> = {
  shredder_maw: { draw: drawShredder, color: SH_BASE, headY: (by, _R, g) => by - 20 + 14 * g, props: shredderProps },
  coffee_machine: { draw: drawCoffee, color: CF_BASE, headY: (by, _R, g) => by - 22 + 14 * g, props: coffeeProps },
  dead_monitor: { draw: drawMonitor, color: DM_BASE, headY: (by, _R, g) => by - 24 + 14 * g, props: monitorProps },
  endless_meeting: { draw: drawMeeting, color: EM_BASE, headY: (by, _R, g) => by - 24 + 62 * g, props: meetingProps },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const OFFICE_TELE_MOTIF: Record<string, TeleMotif> = { cf_pour: 'linger', cf_overflow: 'linger', dm_popups: 'spawn' };

/** MonsterDef.look → the body of this zone's summon-only units. */
export const OFFICE_MINION_LOOKS: Record<string, CreatureDrawFn> = { error_popup: errorPopup };
