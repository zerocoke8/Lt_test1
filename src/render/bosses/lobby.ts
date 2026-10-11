// 기획 19차 보스 레이드 — 로비·상가 boss looks (docs/bosses.md 4장). This zone's track owns this file.
// Bosses: claw_machine 인형 뽑기 기계 · washer_drum 혼자 도는 세탁기 · karaoke_room 지하 7번 노래방 · reverse_escalator 거꾸로 가는 에스컬레이터.
// Summon looks (keyed by MonsterDef.look): prize_doll, lost_sock. Warning motifs (skill id → motif): cm_grab pull · re_handrail pull · re_run / re_run_fast push · wd_suds linger · cm_prizes / wd_socks spawn
// (a motif only shows on a part that has a delay — an instant summon has no warning to decorate).
//
// What the player actually sees of a set piece: the HUD boss box hides y < 100 between x 424 and 856, so the readable
// window is about 400 × 135 px under it (cy − 40 … cy + 95). Each look keeps its face and its signature prop inside
// that window; whatever sticks out sideways (the mirror ball, the detergent bottle, the microphone) stays below y 80.
//
// Art rules: read only BossDrawOpts + o.time + hash01 (no Math.random / Date); faces and eyes at screen y 100–230;
// ≤ 360 canvas calls a frame, ≤ 2 fillText, no gradients, no shadowBlur, nothing allocated per frame; safe for
// o.phase 1–3; mix / lighten / darken only with stepped amounts (they cache by amount).
// Poses: idle = Math.sin(o.time) · wind-up / attack = o.charge (0 → 1 → 0 over a cast) · hit = o.flash (white wash) ·
// phase 2+ and enrage = isHot · knocked down = o.groggy (0..1).
// Checks: npx vitest run tests/render/boss-looks.test.ts (every registered look, 15 poses × 30 frames).
// See it: npx vite, then /tests/visual/render-sandbox.html?scene=zoo&boss=<id>&pose=idle|windup|groggy|enraged&phase=2
//         (bench=boss:<id> → window.__sandbox.bench ms/frame); all 20 on one picture: node tests/visual/boss-sheet.mjs

import { Camera } from '../camera';
import { TAU, anchor, bigEye, blink, cracks, darken, dripRow, enrageHaze, hash01, lighten, lookDir, pathRoundRect, plaque, strobe, tinted, wash } from './kit';
import type { BossDrawOpts, BossLook, CreatureDrawFn, TeleMotif } from './types';

type Ctx = CanvasRenderingContext2D;

const INK = '#14101a';
/** Trim / lamp colour once a boss is in phase 2 or enraged. */
const RED = '#ff3b4d';
const SKIN = '#e6e1d8';

/** Later phases and the enrage share one "hot" look (red trim, red eyes). */
function isHot(o: BossDrawOpts): boolean {
  return o.phase >= 2 || o.enraged;
}

// ─────────────────────────── 인형 뽑기 기계 (claw_machine) ───────────────────────────
// 탑형: a pink cabinet with a glass box. The doll pile behind the glass watches the target; the three-pronged claw on
// its cable is the prop — it slides when idle, opens and drops with the wind-up, hangs limp when knocked down.

const CM = { base: '#ffb3c6', trim: '#ffd60a', glass: '#e0fbfc' } as const;
/** Half width of the cabinet (px). */
const CM_W = 138;
const DOLL_COLORS = ['#ff8fab', '#ffd166', '#9bf6ff', '#caffbf', '#bdb2ff', '#ffc6a5'];
/** The doll pile: x (fraction of the glass half width), y (px from the pile line), head radius. Back row first. */
const DOLLS: readonly (readonly [number, number, number])[] = [
  [-0.56, -19, 15],
  [-0.06, -21, 16],
  [0.46, -19, 15],
  [-0.82, 2, 17],
  [-0.4, 6, 19],
  [0.04, 3, 18],
  [0.46, 7, 19],
  [0.84, 2, 16],
];

/** The plush pile: every doll looks along lx / ly; red pin-point eyes once hot. */
function clawDolls(ctx: Ctx, cx: number, py: number, lx: number, ly: number, o: BossDrawOpts): void {
  const sway = 1 - o.groggy;
  for (let i = 0; i < DOLLS.length; i++) {
    const d = DOLLS[i];
    const x = cx + d[0] * (CM_W - 34);
    const y = py + d[1] + Math.sin(o.time * 1.7 + i) * 1.4 * sway;
    const r = d[2];
    ctx.fillStyle = DOLL_COLORS[i % DOLL_COLORS.length];
    ctx.beginPath();
    ctx.arc(x - r * 0.72, y - r * 0.74, r * 0.4, 0, TAU);
    ctx.moveTo(x + r * 1.12, y - r * 0.74);
    ctx.arc(x + r * 0.72, y - r * 0.74, r * 0.4, 0, TAU);
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = INK;
  ctx.beginPath();
  for (let i = 0; i < DOLLS.length; i++) {
    const d = DOLLS[i];
    const r = d[2];
    const x = cx + d[0] * (CM_W - 34) + lx * r * 0.16;
    const y = py + d[1] + ly * r * 0.14;
    ctx.moveTo(x - r * 0.14, y);
    ctx.arc(x - r * 0.4, y, r * 0.26, 0, TAU);
    ctx.moveTo(x + r * 0.66, y);
    ctx.arc(x + r * 0.4, y, r * 0.26, 0, TAU);
  }
  ctx.fill();
  const hot = isHot(o);
  ctx.fillStyle = hot ? '#ff2a3d' : '#ffffff';
  for (let i = 0; i < DOLLS.length; i++) {
    const d = DOLLS[i];
    const r = d[2];
    const x = cx + d[0] * (CM_W - 34) + lx * r * 0.2;
    const y = py + d[1] + ly * r * 0.18 - (hot ? 1.5 : 3);
    ctx.fillRect(x - r * 0.4 - 1.5, y, 3, 3);
    ctx.fillRect(x + r * 0.4 - 1.5, y, 3, 3);
  }
}

/** The claw on its cable, hub at (x, y): open 0..1 spreads the three prongs, limp 0..1 lets them hang shut. */
function clawArm(ctx: Ctx, x: number, topY: number, y: number, open: number, limp: number, metal: string, hub: string): void {
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const spread = (13 + 27 * open) * (1 - 0.5 * limp);
  const hook = 11 + 9 * (1 - open);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(x + k * 7, y + 4);
    ctx.lineTo(x + k * spread, y + 24);
    ctx.lineTo(x + k * (spread - hook), y + 46 + 4 * limp);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.strokeStyle = metal;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.lineCap = 'butt';
  pathRoundRect(ctx, x - 16, y - 9, 32, 18, 7);
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/** The control panel under the glass: a prize chute with something inside, a joystick that moves by itself, a coin slot. */
function clawPanel(ctx: Ctx, cx: number, y: number, lx: number, o: BossDrawOpts, trim: string): void {
  const t = o.time;
  pathRoundRect(ctx, cx - 116, y + 8, 84, 30, 7);
  ctx.fillStyle = '#1a0d14';
  ctx.fill();
  if (blink(t, 6) > 0.4 && o.groggy < 0.5) {
    ctx.fillStyle = isHot(o) ? '#ff5d5d' : '#ffe9a8';
    ctx.fillRect(cx - 86 + lx * 4, y + 19, 7, 6);
    ctx.fillRect(cx - 68 + lx * 4, y + 19, 7, 6);
  }
  const lean = Math.sin(t * 2.3) * 7 * (1 - o.groggy);
  ctx.beginPath();
  ctx.moveTo(cx + 22, y + 38);
  ctx.lineTo(cx + 22 + lean, y + 16);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 22 + lean, y + 13, 9, 0, TAU);
  ctx.fillStyle = '#e63946';
  ctx.fill();
  ctx.fillStyle = trim;
  ctx.fillRect(cx + 84, y + 8, 26, 30);
  ctx.fillStyle = INK;
  ctx.fillRect(cx + 95, y + 14, 4, 18);
  ctx.fillStyle = CM.glass;
  ctx.fillRect(cx + 50, y + 22, 14, 10);
}

function drawClawMachine(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const t = o.time;
  const g = o.groggy;
  const hot = isHot(o);
  const body = tinted(CM.base, o);
  const trim = hot ? RED : CM.trim;
  const top = cy - 170;
  const bottom = cy + 92;
  const glassTop = top + 16;
  const glassH = cy + 46 - glassTop;
  const gx = cx - CM_W + 16;
  const gw = CM_W * 2 - 32;
  enrageHaze(ctx, cx, cy + 40, CM_W * 1.5, 112, o, alpha);
  // cabinet
  pathRoundRect(ctx, cx - CM_W, top, CM_W * 2, bottom - top, 14);
  ctx.fillStyle = body;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = darken(body, 0.5);
  ctx.lineWidth = 3;
  ctx.stroke();
  // the glass box: dark inside, lit from within by the wind-up
  ctx.fillStyle = '#12303a';
  ctx.fillRect(gx, glassTop, gw, glassH);
  if (o.charge > 0) {
    ctx.globalAlpha = alpha * 0.45 * o.charge;
    ctx.fillStyle = hot ? '#ff9aa8' : '#fff3c4';
    ctx.fillRect(gx, glassTop, gw, glassH);
    ctx.globalAlpha = alpha;
  }
  const { lx, ly } = lookDir(cam, cx, cy + 30, o);
  clawDolls(ctx, cx, cy + 28, lx, ly, o);
  // the claw: slides when idle, moves over the target and drops open with the wind-up, hangs when knocked down
  const idle = (1 - g) * (1 - o.charge);
  const clawX = cx + Math.sin(t * 0.9) * (CM_W - 64) * idle + lx * 52 * o.charge * (1 - g);
  const clawY = cy - 28 + 18 * o.charge * (1 - g) + 40 * g;
  clawArm(ctx, clawX, glassTop, clawY, o.charge * (1 - g), g, hot ? '#ffc2c8' : '#eef1f5', trim);
  // glass shine, cracks when broken, the red wash of the enrage
  ctx.globalAlpha = alpha * 0.16;
  ctx.fillStyle = CM.glass;
  ctx.beginPath();
  ctx.moveTo(gx + 26, glassTop);
  ctx.lineTo(gx + 62, glassTop);
  ctx.lineTo(gx + 12, glassTop + glassH);
  ctx.lineTo(gx, glassTop + glassH);
  ctx.lineTo(gx, glassTop + glassH - 60);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha;
  if (g > 0) {
    cracks(ctx, cx - 40, cy + 2, 78, 5, 3, '#ffffff', alpha * g * 0.9);
    ctx.globalAlpha = alpha;
  }
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.14 + 0.12 * Math.max(0, Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.fillRect(gx, glassTop, gw, glassH);
    ctx.globalAlpha = alpha;
  }
  ctx.strokeStyle = trim;
  ctx.lineWidth = 6;
  ctx.strokeRect(gx, glassTop, gw, glassH);
  // marquee bulbs along the glass sill: every other one lit, swapping; they stutter when knocked down
  const beat = Math.floor(t * 3);
  ctx.fillStyle = '#fffbe0';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const lit = g > 0 ? strobe(t, 9, i, 0.25) === 1 : (i + beat) % 2 === 0;
    if (!lit) continue;
    const bx = gx + 12 + (i * (gw - 24)) / 9;
    ctx.moveTo(bx + 5, cy + 46);
    ctx.arc(bx, cy + 46, 5, 0, TAU);
  }
  ctx.fill();
  clawPanel(ctx, cx, cy + 46, lx, o, trim);
  ctx.globalAlpha = 1;
}

/** Knocked down: the 「고장」 sign taped across the glass. */
function drawClawMachineProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  plaque(ctx, cx + 36, cy + 4, 104, 36, '고장', CM.trim, '#1b1b1b', alpha * o.groggy, -0.14);
}

// ─────────────────────────── 혼자 도는 세탁기 (washer_drum) ───────────────────────────
// 문·구멍형: the round glass door is the eye. The drum swirls behind it (slow when idle, fast with the wind-up, foam
// spilling out); the door bursts open at the peak of an attack and stays open, water pouring out, when knocked down.
// A blue detergent bottle beside it watches too.

const WD = { base: '#8fb3c7', accent: '#ff7a59', light: '#eaf6ff' } as const;
const WD_W = 128;
/** Radius of the door (px). */
const WD_DOOR = 54;
/** 기획 19차 review: the whole washer is drawn this much bigger, around its foot line. */
const WD_SCALE = 1.3;

/** The detergent bottle standing beside the washer (it does not rattle), with two small eyes on its label. */
function washerBottle(ctx: Ctx, cam: Camera, bx: number, floorY: number, o: BossDrawOpts): void {
  pathRoundRect(ctx, bx - 23, floorY - 60, 46, 60, 10);
  ctx.fillStyle = '#2f6fb0';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = isHot(o) ? RED : WD.accent;
  ctx.fillRect(bx - 10, floorY - 75, 20, 16);
  ctx.fillStyle = WD.light;
  ctx.fillRect(bx - 17, floorY - 46, 34, 28);
  const { lx, ly } = lookDir(cam, bx, floorY - 32, o);
  const open = Math.max(0.15, blink(o.time, 7) * (1 - o.groggy));
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(bx - 8 + lx * 2.5, floorY - 33 + ly * 2, 4.5, 6 * open, 0, 0, TAU);
  ctx.ellipse(bx + 8 + lx * 2.5, floorY - 33 + ly * 2, 4.5, 6 * open, 0, 0, TAU);
  ctx.fill();
}

/** The control strip over the door: programme lamps (red and stuttering when knocked down), the drawer, the dial. */
function washerControls(ctx: Ctx, cx: number, y: number, o: BossDrawOpts, body: string): void {
  const t = o.time;
  ctx.fillStyle = darken(body, 0.3);
  ctx.fillRect(cx - WD_W + 8, y, WD_W * 2 - 16, 26);
  ctx.fillStyle = '#0d1b24';
  ctx.fillRect(cx - 110, y + 4, 70, 18);
  ctx.fillStyle = o.groggy > 0 ? RED : '#7cf5ff';
  const step = Math.floor(t * 2);
  for (let k = 0; k < 3; k++) {
    const lit = o.groggy > 0 ? strobe(t, 6, k) === 1 : (step + k) % 3 !== 0;
    if (lit) ctx.fillRect(cx - 104 + k * 21, y + 8, 14, 10);
  }
  ctx.fillStyle = lighten(body, 0.2);
  ctx.fillRect(cx - 20, y + 4, 60, 18);
  const dial = t * (0.7 + 7 * o.charge) * (1 - o.groggy);
  ctx.beginPath();
  ctx.arc(cx + 90, y + 13, 11, 0, TAU);
  ctx.fillStyle = isHot(o) ? RED : WD.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 90, y + 13);
  ctx.lineTo(cx + 90 + Math.cos(dial) * 9, y + 13 + Math.sin(dial) * 9);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** Inside the drum: water sloshing (draining when knocked down), the spinning swirl and its foam. */
function washerDrum(ctx: Ctx, dx: number, dy: number, o: BossDrawOpts, alpha: number, water: string, foam: string): void {
  const g = o.groggy;
  const r = WD_DOOR - 9;
  const spin = o.time * (1.3 + 9 * o.charge) * (1 - g);
  ctx.beginPath();
  ctx.arc(dx, dy, WD_DOOR - 4, 0, TAU);
  ctx.fillStyle = '#0a1420';
  ctx.fill();
  const level = -0.4 + 1.3 * g;
  const tilt = Math.sin(o.time * 2.2) * 0.22 * (1 - g);
  ctx.beginPath();
  ctx.arc(dx, dy, r, level + tilt, Math.PI - level + tilt);
  ctx.fillStyle = water;
  ctx.fill();
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = foam;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  for (let k = 0; k <= 14; k++) {
    const u = k / 14;
    const a = u * TAU * 1.5 + spin;
    const px = dx + Math.cos(a) * r * 0.92 * u;
    const py = dy + Math.sin(a) * r * 0.92 * u;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = foam;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = spin * 0.6 + i * 0.9;
    const d = r * (0.5 + 0.4 * hash01(i, 41));
    const br = 3 + hash01(i, 42) * 4;
    const bx = dx + Math.cos(a) * d;
    const by = dy + Math.sin(a) * d;
    ctx.moveTo(bx + br, by);
    ctx.arc(bx, by, br, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = alpha;
}

/** The door, hinged on the left: open 0..1 swings it out (a narrowing ellipse); the glass keeps a highlight. */
function washerDoor(ctx: Ctx, dx: number, dy: number, open: number, alpha: number): void {
  const rx = WD_DOOR * (1 - 0.8 * open);
  const x = dx - WD_DOOR + rx - 30 * open;
  ctx.globalAlpha = alpha * 0.2;
  ctx.fillStyle = WD.light;
  ctx.beginPath();
  ctx.ellipse(x, dy, rx, WD_DOOR, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.strokeStyle = WD.light;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, dy, rx * 0.72, WD_DOOR * 0.72, 0, -2.5, -1.7);
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

function drawWasher(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx: ax, cy, alpha } = anchor(cam, x, y, o);
  const t = o.time;
  const g = o.groggy;
  const hot = isHot(o);
  // the cabinet rattles: a little when idle, hard during the spin, still when knocked down
  const cx = ax + Math.sin(t * 31) * (1.5 + 3.5 * o.charge) * (1 - g);
  const body = tinted(WD.base, o);
  const water = hot ? '#8a1a2c' : '#1d5a8a';
  const foam = hot ? '#ffd6d6' : WD.light;
  const top = cy - 160;
  const bottom = cy + 92;
  const dy = cy + 38;
  enrageHaze(ctx, ax, cy + 40, WD_W * 1.6, 112, o, alpha, '#d7f0ff');
  // 기획 19차 review: drawn WD_SCALE× around the foot line (the party under the boss hid the drum and its eye)
  ctx.save();
  ctx.translate(ax, bottom);
  ctx.scale(WD_SCALE, WD_SCALE);
  ctx.translate(-ax, -bottom);
  washerBottle(ctx, cam, ax + WD_W + 44, bottom, o);
  pathRoundRect(ctx, cx - WD_W, top, WD_W * 2, bottom - top, 16);
  ctx.fillStyle = body;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = darken(body, 0.5);
  ctx.lineWidth = 3;
  ctx.stroke();
  washerControls(ctx, cx, cy - 42, o, body);
  washerDrum(ctx, cx, dy, o, alpha, water, foam);
  const { lx, ly } = lookDir(cam, cx, dy, o);
  bigEye(ctx, cx, dy, 27, lx, ly, hot, alpha, blink(t, 4) * (1 - g));
  // the door bursts open at the peak of an attack and stays open while knocked down
  const pop = Math.max(0, o.charge - 0.7) / 0.3;
  const open = Math.max(g, pop);
  washerDoor(ctx, cx, dy, open, alpha);
  ctx.fillStyle = foam;
  if (o.charge > 0 && g <= 0) {
    // foam squeezing out under the door, more with the wind-up; it flies when the door pops
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const fr = (5 + hash01(i, 43) * 9) * o.charge;
      const fx = cx - 54 + i * 18;
      const fy = dy + WD_DOOR - 4 + hash01(i, 44) * 12 + pop * hash01(i, 45) * 26;
      ctx.moveTo(fx + fr, fy);
      ctx.arc(fx, fy, fr, 0, TAU);
    }
    ctx.fill();
  }
  if (g > 0) {
    dripRow(ctx, cx - 34, dy + 26, 68, 6, 52, t, water, alpha * g);
    ctx.beginPath();
    ctx.ellipse(cx, bottom + 5, 86 * g, 9, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Knocked down: the blinking 「E-rr」 on the display. */
function drawWasherProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const on = 0.45 + 0.55 * strobe(o.time, 3, 2);
  plaque(ctx, cx - 72, cy - 26, 92, 30, 'E-rr', '#0d1b24', '#ff5d5d', alpha * o.groggy * on);
}

// ─────────────────────────── 지하 7번 노래방 (karaoke_room) ───────────────────────────
// 가로형: a wide karaoke screen is the face (two eyes, the lyric strip as its mouth, the score 「100」), a stairwell down
// to room 7 under it, speakers left and right. Props: a mirror ball on the left and the microphone held up by two
// hands without a body on the right — its head glows and rings with the wind-up, it drops and howls when knocked down.

const KR = { base: '#2b2d42', neon: '#ff006e', light: '#ffffff' } as const;
/** Half width of the screen (px). */
const KR_W = 172;
/** Lyric blocks (px wide) running through the strip; LYRIC_LOOP = their total run with the gaps. */
const LYRIC = [34, 22, 46, 18, 30, 40, 24, 36];
const LYRIC_GAP = 9;
const LYRIC_LOOP = LYRIC.reduce((n, w) => n + w + LYRIC_GAP, 0);
const SPOT_COLORS = ['#ff5fa2', '#ffe14d', '#59e3ff'];
const SCORE_FONT = '900 22px sans-serif';
const ROOM_FONT = '900 19px sans-serif';
/** Where the microphone floats, from the anchor (px). */
const MIC_X = KR_W + 56;
const MIC_Y = 30;

/** The mirror ball on its cord: facets slide across it, three pairs of colour spots circle under it. */
function mirrorBall(ctx: Ctx, x: number, y: number, o: BossDrawOpts, alpha: number): void {
  const spin = o.time * (0.8 + 2.4 * o.charge) * (1 - o.groggy);
  ctx.fillStyle = INK;
  ctx.fillRect(x - 1.5, y - 70, 3, 50);
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, TAU);
  ctx.fillStyle = '#aab4c4';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const u = (i / 6 + spin * 0.12) % 1;
    const w = 7 * Math.sin(u * Math.PI);
    ctx.fillRect(x - 17 + u * 34 - w / 2, y - 14 + (i % 3) * 10, w, 6);
  }
  ctx.globalAlpha = alpha * (o.groggy > 0 ? 0.15 : 0.5);
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = SPOT_COLORS[c];
    ctx.beginPath();
    for (let k = 0; k < 2; k++) {
      const a = spin * 0.7 + c * 2.1 + k * 3.1;
      const px = x + 70 + Math.cos(a) * 92;
      const py = y + 78 + Math.sin(a) * 22;
      ctx.moveTo(px + 13, py);
      ctx.ellipse(px, py, 13, 6, 0, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
}

/** The lyric strip (the screen's mouth): blocks run right → left, the sung half in neon; it gapes with the wind-up. */
function karaokeLyrics(ctx: Ctx, cx: number, y: number, o: BossDrawOpts, neon: string): void {
  const h = 22 + 16 * o.charge;
  ctx.fillStyle = '#07060d';
  ctx.fillRect(cx - 150, y - h / 2, 300, h);
  if (o.groggy > 0) return; // the 「간주 중」 sign sits here
  const flow = (o.time * 46) % LYRIC_LOOP;
  let at = 0;
  for (let i = 0; i < LYRIC.length; i++) {
    const x = ((at - flow + LYRIC_LOOP) % LYRIC_LOOP) - LYRIC_LOOP / 2;
    at += LYRIC[i] + LYRIC_GAP;
    const x0 = Math.max(-146, x);
    const x1 = Math.min(146, x + LYRIC[i]);
    if (x1 <= x0) continue;
    ctx.fillStyle = x < 0 ? neon : KR.light;
    ctx.fillRect(cx + x0, y - 5, x1 - x0, 10);
  }
}

/** Under the screen: the stairwell down to room 7 with its lit number plate, a speaker on each side thumping to the beat. */
function karaokeBase(ctx: Ctx, cx: number, y: number, bottom: number, o: BossDrawOpts, neon: string): void {
  ctx.fillStyle = '#050407';
  ctx.beginPath();
  ctx.moveTo(cx - 30, y + 6);
  ctx.lineTo(cx + 30, y + 6);
  ctx.lineTo(cx + 44, bottom);
  ctx.lineTo(cx - 44, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = neon;
  ctx.fillRect(cx - 35, y + 24, 70, 2.5);
  ctx.fillRect(cx - 40, y + 38, 80, 2.5);
  pathRoundRect(ctx, cx - 78, y + 12, 28, 26, 5);
  ctx.fill();
  ctx.fillStyle = KR.light;
  ctx.font = ROOM_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('7', cx - 64, y + 26);
  const beat = Math.abs(Math.sin(o.time * 6)) * (0.3 + 0.7 * o.charge) * (1 - o.groggy);
  ctx.fillStyle = '#0d0e16';
  ctx.fillRect(cx - 160, y + 8, 60, 38);
  ctx.fillRect(cx + 100, y + 8, 60, 38);
  ctx.fillStyle = '#4a4e69';
  ctx.beginPath();
  ctx.arc(cx - 130, y + 27, 13 + 3 * beat, 0, TAU);
  ctx.moveTo(cx + 146 + 3 * beat, y + 27);
  ctx.arc(cx + 130, y + 27, 13 + 3 * beat, 0, TAU);
  ctx.fill();
  ctx.fillStyle = neon;
  ctx.fillRect(cx - 134, y + 23, 8, 8);
  ctx.fillRect(cx + 126, y + 23, 8, 8);
}

/** The microphone floating at (x, y), a hand on each side: rings from its head with the wind-up, dropped when knocked down. */
function karaokeMic(ctx: Ctx, x: number, y: number, o: BossDrawOpts, alpha: number, neon: string): void {
  const t = o.time;
  const g = o.groggy;
  const my = y + Math.sin(t * 2.1) * 5 * (1 - g) + 36 * g;
  if (o.charge > 0 && g <= 0) {
    ctx.strokeStyle = neon;
    ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      const u = (t * 1.6 + k / 3) % 1;
      ctx.globalAlpha = alpha * o.charge * (1 - u) * 0.8;
      ctx.beginPath();
      ctx.arc(x - 12, my - 18, 14 + u * 40, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
  }
  // the other hand, open beside it: it keeps the beat, and lies flat when knocked down
  ghostHand(ctx, x + 44, my + 34 + 10 * g, -1.9 + Math.sin(t * 6) * 0.18 * (1 - g) + 2.4 * g, 11);
  ctx.save();
  ctx.translate(x, my);
  ctx.rotate(-0.55 + 1.5 * g);
  pathRoundRect(ctx, -8, -4, 16, 62, 7);
  ctx.fillStyle = '#23242e';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -16, 19, 0, TAU);
  ctx.fillStyle = '#c9ced6';
  ctx.fill();
  ctx.stroke();
  if (o.charge > 0) {
    ctx.globalAlpha = alpha * o.charge * (1 - g);
    ctx.fillStyle = '#ff2a3d';
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(-17, -18, 34, 3);
  // the hand that holds it: a fist around the handle
  pathRoundRect(ctx, -15, 18, 30, 26, 10);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillRect(-13, 26, 26, 1.8);
  ctx.fillRect(-13, 34, 26, 1.8);
  ctx.restore();
}

/** An open pale hand with no arm: palm at (x, y), four fingers fanned around `ang` (rad). */
function ghostHand(ctx: Ctx, x: number, y: number, ang: number, s: number): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let f = 0; f < 4; f++) {
    const a = ang + (f - 1.5) * 0.34;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * s * 1.9, y + Math.sin(a) * s * 1.9);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.5 + 4;
  ctx.stroke();
  ctx.strokeStyle = SKIN;
  ctx.lineWidth = s * 0.5;
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(x, y, s * 0.85, 0, TAU);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawKaraoke(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const t = o.time;
  const g = o.groggy;
  const hot = isHot(o);
  const wall = tinted(KR.base, o);
  const neon = hot ? '#ff2a3d' : KR.neon;
  const sTop = cy - 62;
  const sH = 104;
  const bottom = cy + 92;
  enrageHaze(ctx, cx, cy + 30, KR_W * 1.4, 112, o, alpha, '#ffd0e6');
  mirrorBall(ctx, cx - KR_W - 80, cy - 32, o, alpha);
  // the wall the screen hangs on
  pathRoundRect(ctx, cx - KR_W - 14, sTop - 100, KR_W * 2 + 28, bottom - sTop + 100, 10);
  ctx.fillStyle = wall;
  ctx.fill();
  wash(ctx, alpha, o);
  ctx.strokeStyle = darken(wall, 0.5);
  ctx.lineWidth = 3;
  ctx.stroke();
  // the screen: dark when knocked down, a scan band rolling over it, white with the wind-up
  ctx.fillStyle = g > 0 ? '#0b0a14' : hot ? '#3a0a1c' : '#1b1140';
  ctx.fillRect(cx - KR_W, sTop, KR_W * 2, sH);
  ctx.globalAlpha = alpha * 0.14;
  ctx.fillStyle = neon;
  ctx.fillRect(cx - KR_W, sTop + ((t * 40) % (sH - 12)), KR_W * 2, 12);
  if (o.charge > 0) {
    ctx.globalAlpha = alpha * 0.3 * o.charge;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - KR_W, sTop, KR_W * 2, sH);
  }
  ctx.globalAlpha = alpha;
  const { lx, ly } = lookDir(cam, cx, cy - 10, o);
  const open = blink(t, 2) * (1 - g);
  bigEye(ctx, cx - 62, cy - 12, 21, lx, ly, hot, alpha, open);
  bigEye(ctx, cx + 62, cy - 12, 21, lx, ly, hot, alpha, open);
  karaokeLyrics(ctx, cx, cy + 20, o, neon);
  if (g <= 0 && strobe(t, 2, 1, 0.8) === 1) {
    ctx.fillStyle = '#ffe14d';
    ctx.font = SCORE_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('100', cx + KR_W - 10, cy - 26);
  }
  // the neon frame: a soft wide line under a sharp one; it flickers now and then and goes dim when knocked down
  const lit = (g > 0 ? 0.3 : 1) * (strobe(t, 14, 3, 0.93) === 1 ? 1 : 0.55);
  ctx.strokeStyle = neon;
  ctx.globalAlpha = alpha * 0.28 * lit;
  ctx.lineWidth = 13;
  ctx.strokeRect(cx - KR_W, sTop, KR_W * 2, sH);
  ctx.globalAlpha = alpha * lit;
  ctx.lineWidth = 5;
  ctx.strokeRect(cx - KR_W, sTop, KR_W * 2, sH);
  ctx.globalAlpha = alpha;
  karaokeBase(ctx, cx, sTop + sH, bottom, o, neon);
  karaokeMic(ctx, cx + MIC_X, cy + MIC_Y, o, alpha, neon);
  ctx.globalAlpha = 1;
}

/** Knocked down: 「간주 중」 on the screen, the dropped microphone howling. */
function drawKaraokeProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const a = alpha * o.groggy;
  plaque(ctx, cx, cy + 20, 132, 32, '간주 중', '#1b1140', '#ffe14d', a);
  const mx = cx + MIC_X + 8;
  const my = cy + MIC_Y + 14;
  ctx.globalAlpha = a * (0.5 + 0.5 * strobe(o.time, 10, 4));
  ctx.strokeStyle = '#ffe14d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  for (let k = 1; k <= 5; k++) ctx.lineTo(mx + k * 9, my - k * 7 + (k % 2 === 0 ? 8 : -8));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ─────────────────────────── 거꾸로 가는 에스컬레이터 (reverse_escalator) ───────────────────────────
// 비탈형: a metal stair run coming down from a dark landing toward the party, wider toward the viewer. The steps run
// DOWN (it is the "up" escalator); fingers and eyes show in the gaps between them and something watches from the dark
// at the top. Wind-up: the steps pull back and the fingers come up. Knocked down: it stops, one step flips over.

const RE = { base: '#6c757d', warn: '#ffd60a', light: '#dee2e6' } as const;
/** Half widths of the stair run at its top and at its bottom (px). */
const RE_TOP = 76;
const RE_BOT = 156;
const RE_STEPS = 6;

/** Screen y of the stair run at u (0 = top, 1 = bottom): steps get taller toward the viewer. */
function stairY(y0: number, y1: number, u: number): number {
  return y0 + (y1 - y0) * u * (0.5 + 0.5 * u);
}

/** Half width of the stair run at screen y. */
function stairHalf(y0: number, y1: number, sy: number): number {
  return RE_TOP + ((RE_BOT - RE_TOP) * (sy - y0)) / (y1 - y0);
}

/**
 * The moving steps (clipped to the run by the caller): light treads with a warning edge, a dark riser over each; in
 * some risers four fingertips (they rise with the wind-up), in others a pair of eyes. Stops and loses one step
 * (flipped over, fingers hanging) when knocked down.
 */
function escalatorSteps(ctx: Ctx, cx: number, y0: number, y1: number, o: BossDrawOpts, steel: string, warn: string): void {
  const g = o.groggy;
  const T = o.time * (o.phase >= 2 ? 0.8 : 0.6) - 0.6 * o.charge;
  const base = Math.floor(T);
  const flow = (T - base) * (1 - g);
  const treadA = lighten(steel, 0.3);
  const treadB = lighten(steel, 0.1);
  for (let i = -1; i < RE_STEPS; i++) {
    const ya = stairY(y0, y1, Math.max(0, (i + flow) / RE_STEPS));
    const yb = stairY(y0, y1, Math.min(1, (i + 1 + flow) / RE_STEPS));
    const h = yb - ya;
    if (h <= 0.5) continue;
    const flipped = g > 0 && i === 3;
    ctx.fillStyle = flipped ? '#101014' : ((i - base) & 1) === 0 ? treadA : treadB;
    ctx.fillRect(cx - RE_BOT, ya + h * 0.3, RE_BOT * 2, h * 0.7);
    if (flipped) continue;
    ctx.fillStyle = warn;
    ctx.fillRect(cx - RE_BOT, yb - Math.max(2, h * 0.16), RE_BOT * 2, Math.max(2, h * 0.16));
  }
  // fingertips over the tread edge
  const up = 4 + 12 * o.charge * (1 - g);
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  for (let i = 0; i < RE_STEPS; i++) {
    const id = g >= 1 ? i : (i - base) & 15;
    if (hash01(id, 51) > 0.5) continue;
    const ya = stairY(y0, y1, Math.max(0, (i + flow) / RE_STEPS));
    const yb = stairY(y0, y1, Math.min(1, (i + 1 + flow) / RE_STEPS));
    const edge = ya + (yb - ya) * 0.3;
    const s = 0.7 + 0.5 * ((i + flow) / RE_STEPS);
    const fx = cx + (hash01(id, 52) - 0.5) * 1.3 * stairHalf(y0, y1, edge);
    for (let f = 0; f < 4; f++) ctx.rect(fx + f * 10 * s, edge - up * s - (f === 1 || f === 2 ? 3 : 0), 7.5 * s, up * s + 3);
  }
  ctx.fill();
  // eyes in the dark of the other risers
  ctx.fillStyle = isHot(o) ? '#ff5d5d' : '#ffe9a8';
  for (let i = 0; i < RE_STEPS; i++) {
    const id = g >= 1 ? i : (i - base) & 15;
    if (hash01(id, 51) <= 0.5 || hash01(id, 53) > 0.7 || blink(o.time, id) < 0.4) continue;
    const ya = stairY(y0, y1, Math.max(0, (i + flow) / RE_STEPS));
    const yb = stairY(y0, y1, Math.min(1, (i + 1 + flow) / RE_STEPS));
    const h = (yb - ya) * 0.3;
    if (h < 2.5) continue;
    const ex = cx + (hash01(id, 54) - 0.5) * 1.3 * stairHalf(y0, y1, ya);
    ctx.fillRect(ex - 8, ya + h * 0.2, 6, h * 0.6);
    ctx.fillRect(ex + 4, ya + h * 0.2, 6, h * 0.6);
  }
  if (g > 0) {
    // the flipped step: its fingers hang limp into the gap
    const ya = stairY(y0, y1, 3 / RE_STEPS);
    const yb = stairY(y0, y1, 4 / RE_STEPS);
    ctx.fillStyle = SKIN;
    for (let f = 0; f < 4; f++) ctx.fillRect(cx - 30 + f * 10, ya + (yb - ya) * 0.3, 7, (yb - ya) * (0.35 + 0.1 * (f % 2)) * g);
  }
}

/** Balustrades and the black rubber handrails on both sides, a highlight running down each; lamps on the newel posts. */
function escalatorRails(ctx: Ctx, cx: number, y0: number, y1: number, o: BossDrawOpts, steel: string, alpha: number): void {
  const u = (o.time * 0.45 * (1 - o.groggy)) % 0.85;
  const panel = darken(steel, 0.2);
  ctx.lineCap = 'round';
  for (let s = -1; s <= 1; s += 2) {
    const xa = cx + s * RE_TOP;
    const xb = cx + s * RE_BOT;
    const ra = xa + s * 8;
    const rb = xb + s * 14;
    ctx.beginPath();
    ctx.moveTo(xa, y0);
    ctx.lineTo(xb, y1);
    ctx.lineTo(rb, y1 - 44);
    ctx.lineTo(ra, y0 - 24);
    ctx.closePath();
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ra, y0 - 24);
    ctx.lineTo(rb, y1 - 44);
    ctx.strokeStyle = '#0b0b0e';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ra + (rb - ra) * u, y0 - 24 + (y1 - 20 - y0) * u);
    ctx.lineTo(ra + (rb - ra) * (u + 0.15), y0 - 24 + (y1 - 20 - y0) * (u + 0.15));
    ctx.strokeStyle = RE.light;
    ctx.globalAlpha = alpha * 0.45;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  ctx.lineCap = 'butt';
  // newel lamps: 「올라가는 쪽」 (a green arrow that keeps blinking) on the left, no entry on the right
  const hot = isHot(o);
  const lx = cx - RE_BOT - 14;
  const rx = cx + RE_BOT + 14;
  const ly = y1 - 44;
  ctx.fillStyle = '#16171c';
  ctx.beginPath();
  ctx.arc(lx, ly, 15, 0, TAU);
  ctx.moveTo(rx + 15, ly);
  ctx.arc(rx, ly, 15, 0, TAU);
  ctx.fill();
  if (o.groggy <= 0 && strobe(o.time, 3, 8, 0.7) === 1) {
    ctx.fillStyle = hot ? RED : '#3ddc84';
    ctx.beginPath();
    ctx.moveTo(lx, ly - 9);
    ctx.lineTo(lx + 9, ly + 6);
    ctx.lineTo(lx - 9, ly + 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(rx, ly, 10, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(rx - 7, ly - 2, 14, 4);
}

function drawEscalator(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const t = o.time;
  const g = o.groggy;
  const hot = isHot(o);
  const steel = tinted(RE.base, o);
  const warn = hot ? RED : RE.warn;
  const y0 = cy + 8;
  const y1 = cy + 98;
  enrageHaze(ctx, cx, cy + 40, RE_BOT * 1.4, 112, o, alpha);
  // the dark landing at the top, and what looks down from it
  pathRoundRect(ctx, cx - RE_TOP - 18, cy - 160, (RE_TOP + 18) * 2, 172, 18);
  ctx.fillStyle = '#07060a';
  ctx.fill();
  ctx.strokeStyle = steel;
  ctx.lineWidth = 6;
  ctx.stroke();
  const { lx, ly } = lookDir(cam, cx, cy - 16, o);
  bigEye(ctx, cx, cy - 16, 21, lx, ly, hot, alpha, blink(t, 5) * (1 - g));
  ctx.fillStyle = hot ? '#ff5d5d' : '#ffe9a8';
  for (let i = 0; i < 4; i++) {
    if (blink(t, 11 + i) < 0.4 || g > 0.5) continue;
    const ex = cx + (i < 2 ? -1 : 1) * (40 + (i % 2) * 16) + lx * 2;
    const ey = cy - 30 + (i % 2) * 22 + ly * 1.5;
    ctx.fillRect(ex - 6, ey, 4, 4);
    ctx.fillRect(ex + 2, ey, 4, 4);
  }
  // the stair run
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - RE_TOP, y0);
  ctx.lineTo(cx + RE_TOP, y0);
  ctx.lineTo(cx + RE_BOT, y1);
  ctx.lineTo(cx - RE_BOT, y1);
  ctx.closePath();
  ctx.fillStyle = '#101014';
  ctx.fill();
  ctx.clip();
  escalatorSteps(ctx, cx, y0, y1, o, steel, warn);
  // comb grooves running to the vanishing point, then the hit / phase flash over the whole run
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = -3; k <= 3; k++) {
    ctx.moveTo(cx + (k * RE_TOP) / 4, y0);
    ctx.lineTo(cx + (k * RE_BOT) / 4, y1);
  }
  ctx.stroke();
  const glare = Math.max(o.flash * 0.4, o.phaseFlash * 0.75, o.charge > 0.85 ? (o.charge - 0.85) * 3 : 0);
  if (glare > 0) {
    ctx.globalAlpha = alpha * glare;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - RE_BOT, y0, RE_BOT * 2, y1 - y0);
    ctx.globalAlpha = alpha;
  }
  ctx.restore();
  escalatorRails(ctx, cx, y0, y1, o, steel, alpha);
  ctx.globalAlpha = 1;
}

/** Knocked down: the emergency stop button, pushed in, and its sign. */
function drawEscalatorProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const { cx, cy, alpha } = anchor(cam, x, y, o);
  const a = alpha * o.groggy;
  ctx.globalAlpha = a;
  const bx = cx + RE_BOT + 52;
  ctx.fillStyle = RE.warn;
  ctx.fillRect(bx - 24, cy + 50, 48, 46);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(bx - 24, cy + 50, 48, 46);
  ctx.beginPath();
  ctx.arc(bx, cy + 73, 15, 0, TAU);
  ctx.fillStyle = strobe(o.time, 4, 6) === 1 ? '#ff2a3d' : '#8a0f1c';
  ctx.fill();
  ctx.stroke();
  plaque(ctx, cx, cy + 34, 128, 32, '비상정지', '#d00000', '#ffffff', a);
  ctx.globalAlpha = 1;
}

// ─────────────────────────── summon-only units ───────────────────────────

/** 뽑기 인형: a plush bear with one button eye (the other is a loose cross of thread); it lifts its arms to hit. */
const prizeDoll: CreatureDrawFn = (ctx, fill, flash, fx, fy, w, h, s, time, phase, act) => {
  const bob = Math.abs(Math.sin(time * 6 + phase)) * h * 0.06;
  const hr = w * 0.42;
  const hy = fy - h * 0.66 - bob;
  const armY = fy - h * (0.32 + 0.14 * act) - bob;
  ctx.lineWidth = Math.max(1.6, Math.min(3.2, w * 0.055));
  ctx.strokeStyle = flash ? '#ffffff' : '#7a3b52';
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(fx, fy - h * 0.24 - bob, w * 0.34, h * 0.26, 0, 0, TAU);
  ctx.moveTo(fx - w * 0.3, armY);
  ctx.ellipse(fx - w * 0.42, armY, w * 0.12, w * 0.1, 0, 0, TAU);
  ctx.moveTo(fx + w * 0.54, armY);
  ctx.ellipse(fx + w * 0.42, armY, w * 0.12, w * 0.1, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(fx - hr * 0.74, hy - hr * 0.72, hr * 0.36, 0, TAU);
  ctx.moveTo(fx + hr * 1.1, hy - hr * 0.72);
  ctx.arc(fx + hr * 0.74, hy - hr * 0.72, hr * 0.36, 0, TAU);
  ctx.moveTo(fx + hr, hy);
  ctx.arc(fx, hy, hr, 0, TAU);
  ctx.fill();
  ctx.stroke();
  const ex = fx + s * hr * 0.14;
  const er = hr * 0.2;
  ctx.fillStyle = flash ? '#888888' : '#1d1418';
  ctx.beginPath();
  ctx.arc(ex - s * hr * 0.38, hy, er, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = flash ? '#888888' : '#1d1418';
  ctx.beginPath();
  ctx.moveTo(ex + s * hr * 0.38 - er, hy - er);
  ctx.lineTo(ex + s * hr * 0.38 + er, hy + er);
  ctx.moveTo(ex + s * hr * 0.38 + er, hy - er);
  ctx.lineTo(ex + s * hr * 0.38 - er, hy + er);
  ctx.stroke();
  // stitched mouth: red (melee)
  ctx.strokeStyle = '#e63946';
  ctx.beginPath();
  ctx.moveTo(ex - hr * 0.28, hy + hr * 0.46);
  ctx.lineTo(ex + hr * 0.28, hy + hr * (0.46 + 0.2 * act));
  ctx.stroke();
};

/** 외짝 양말: one striped sock hopping on its toe, the empty cuff gaping like a mouth. */
const lostSock: CreatureDrawFn = (ctx, fill, flash, fx, fy, w, h, s, time, phase, act) => {
  const hop = Math.abs(Math.sin(time * 9 + phase)) * h * 0.16;
  const ink = flash ? '#ffffff' : '#5c6b7a';
  const stripe = flash ? '#ffd0c4' : '#ff7a59';
  ctx.save();
  ctx.translate(fx, fy - hop);
  ctx.rotate(s * (0.1 + 0.3 * act));
  ctx.beginPath();
  ctx.moveTo(-s * w * 0.22, -h);
  ctx.lineTo(s * w * 0.22, -h);
  ctx.lineTo(s * w * 0.22, -h * 0.4);
  ctx.quadraticCurveTo(s * w * 0.66, -h * 0.38, s * w * 0.62, -h * 0.15);
  ctx.quadraticCurveTo(s * w * 0.6, 0, s * w * 0.3, 0);
  ctx.lineTo(-s * w * 0.06, 0);
  ctx.quadraticCurveTo(-s * w * 0.3, -h * 0.02, -s * w * 0.22, -h * 0.24);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.6, Math.min(3.2, w * 0.06));
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = stripe;
  ctx.fillRect(-w * 0.22, -h * 0.9, w * 0.44, h * 0.08);
  ctx.fillRect(-w * 0.22, -h * 0.76, w * 0.44, h * 0.08);
  ctx.beginPath();
  ctx.ellipse(s * w * 0.48, -h * 0.12, w * 0.12, h * 0.1, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = flash ? '#888888' : '#1d1418';
  ctx.beginPath();
  ctx.ellipse(0, -h, w * 0.2, h * 0.05, 0, 0, TAU);
  ctx.moveTo(s * w * 0.04, -h * 0.56);
  ctx.arc(s * w * 0.0, -h * 0.56, w * 0.05, 0, TAU);
  ctx.moveTo(s * w * 0.2, -h * 0.56);
  ctx.arc(s * w * 0.15, -h * 0.56, w * 0.05, 0, TAU);
  ctx.fill();
  ctx.restore();
};

// ─────────────────────────── registries ───────────────────────────

/** Boss id → look. */
export const LOBBY_LOOKS: Record<string, BossLook> = {
  claw_machine: { draw: drawClawMachine, color: CM.base, headY: (by, _R, g) => by - 6 + 14 * g, props: drawClawMachineProps },
  washer_drum: { draw: drawWasher, color: WD.base, headY: (by, _R, g) => by - 8 + 14 * g, props: drawWasherProps },
  karaoke_room: { draw: drawKaraoke, color: KR.neon, headY: (by, _R, g) => by - 14 + 14 * g, props: drawKaraokeProps },
  reverse_escalator: { draw: drawEscalator, color: RE.base, headY: (by, _R, g) => by - 22 + 14 * g, props: drawEscalatorProps },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const LOBBY_TELE_MOTIF: Record<string, TeleMotif> = {
  cm_grab: 'pull',
  cm_prizes: 'spawn',
  wd_suds: 'linger',
  wd_socks: 'spawn',
  re_run: 'push',
  re_run_fast: 'push',
  re_handrail: 'pull',
};

/** MonsterDef.look → the body of this zone's summon-only units. */
export const LOBBY_MINION_LOOKS: Record<string, CreatureDrawFn> = {
  prize_doll: prizeDoll,
  lost_sock: lostSock,
};
