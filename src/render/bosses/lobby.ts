// 기획 19차 보스 레이드 — 로비·상가 boss looks (docs/bosses.md 5장). This zone's track owns this file.
// Bosses: claw_machine 인형 뽑기 기계 · washer_drum 혼자 도는 세탁기 · karaoke_room 지하 7번 노래방 · reverse_escalator 거꾸로 가는 에스컬레이터.
// Summon looks (keyed by MonsterDef.look): prize_doll, lost_sock.
//
// 기획 20차 boss forms (docs/bosses.md 5-1 · 5-2 · 5-3):
//   claw_machine, washer_drum  — roaming: a BODY (BossLook.body) drawn among the characters, about half the old size
//   reverse_escalator          — arena: the whole floor is the stairs (BossLook.stage); the body is its core, 「틈새의 손」
//   karaoke_room               — fixed: the 기획 19차 set piece, plus a stage (the mirror-ball light at the arena centre)
// A body is authored "facing right, standing in a box" (BossBodyFrame: the foot point is (f.fx, f.fy), the box is f.w
// wide and f.h tall); the shared frame (bosses/body.ts) mirrors it, bobs it, swells it through a wind-up, tilts and
// washes it out while groggy, and draws the shadow, the red boss ring and the ▼. What a body draws itself is the pose:
//   claw_machine      idle: the claw slides behind the glass · walk: it glides (no bob) · wind-up: a crane arm swings
//                     out in front, its big claw open · attack: it drops shut · groggy: everything hangs, bulbs stutter
//   washer_drum       idle: rattles · walk: waddles on its feet · wind-up: tucks its feet in and spins like a wheel ·
//                     attack: lunges · groggy: lies on its side, door open, water running out
//   reverse_escalator idle: five hands sway out of a gap · walk: they crawl forward · wind-up: every finger spreads ·
//                     attack: they slam down · groggy: they hang limp on the floor
// Warning motifs (skill id → motif): cm_grab pull · re_lurch / re_stop / re_lurch_twice push · wd_suds linger ·
// cm_prizes / wd_socks spawn (a motif only shows on a part that has a delay — an instant summon has no warning).
// re_handrail has no push row on purpose: the motif reads ONE knock-back direction per skill id, and its two bands push
// opposite ways.
//
// Art rules of a set piece (karaoke_room): read only BossDrawOpts + o.time + hash01 (no Math.random / Date); faces and
// eyes at screen y 100–230; ≤ 360 canvas calls a frame, ≤ 2 fillText, no gradients, no shadowBlur, nothing allocated per
// frame; safe for o.phase 1–3; mix / lighten / darken only with stepped amounts (they cache by amount).
// Art rules of a body: the same, and ≤ 220 canvas calls a frame, NO fillText (it would mirror), nothing under 6 px.
// A stage look: `bake` paints the arena once per phase, `live` adds at most 40 calls a frame.
// Checks: npx vitest run tests/render (boss-looks: every registered look, 15 poses × 30 frames; boss-body: every body,
// 5 poses × 2 sides).
// See it: /?mode=bossRaid&boss=<id> (the real fight) · npx vite, then
//         /tests/visual/render-sandbox.html?scene=zoo&boss=<id>&pose=idle|windup|groggy|enraged&phase=2

import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { asSetPiece } from './body';
import { TAU, anchor, bigEye, blink, cracks, darken, dripRow, enrageHaze, hash01, lighten, limb, lookDir, pathRoundRect, plaque, spikes, strobe, tinted, wash } from './kit';
import type { BossBody, BossBodyFrame, BossDrawOpts, BossLook, BossStageLook, CreatureDrawFn, TeleMotif } from './types';

type Ctx = CanvasRenderingContext2D;

const INK = '#14101a';
/** Trim / lamp colour once a boss is in phase 2 or enraged. */
const RED = '#ff3b4d';
const SKIN = '#e6e1d8';
/** One ground cell down the screen, as a fraction of one cell across (the floor is drawn squashed). */
const SQUASH = PX_PER_UNIT_Y / PX_PER_UNIT;
const NO_DASH: number[] = [];

/** Later phases and the enrage share one "hot" look (red trim, red eyes). */
function isHot(o: BossDrawOpts): boolean {
  return o.phase >= 2 || o.enraged;
}

/** The alpha the shared frame handed a body (1 − retreat); a body scales its own alphas by it and puts it back. */
function baseAlpha(ctx: Ctx): number {
  const a = ctx.globalAlpha;
  return typeof a === 'number' ? a : 1;
}

/** Pose strengths of a body frame: wind-up 0..1, the swing of an attack 0 → 1 → 0, how far down it is 0..1. */
const windOf = (f: BossBodyFrame): number => (f.pose === 'windup' ? f.p : 0);
const swingOf = (f: BossBodyFrame): number => (f.pose === 'attack' ? Math.sin(f.p * Math.PI) : 0);
const downOf = (f: BossBodyFrame): number => (f.pose === 'groggy' ? f.p : 0);

/** Screen y of the floor a body stands on for a screen-aligned prop (a set piece drawn from the old top spot stands lower). */
function propFootY(cam: Camera, y: number, body: BossBody): number {
  return cam.sy(Math.max(y, 0)) + (y < 0 ? body.h * PX_PER_UNIT * 0.6 : 0);
}

// ─────────────────────────── 인형 뽑기 기계 (claw_machine) ───────────────────────────
// 배회형: a half-size pink cabinet on four coin-tin feet. The plush pile behind the glass looks where it goes, the
// joystick on the ledge in front moves by itself. It only ever slides along a row or a column — two faint rails on the
// floor under it say so (its 집게 내리기 / 동전 투입 reach along exactly those). The crane arm in front is the wind-up.

const CM = { base: '#ffb3c6', trim: '#ffd60a', glass: '#e0fbfc', rail: '#ffe3ea' } as const;
const DOLL_COLORS = ['#ff8fab', '#9bf6ff'] as const;
/** The doll pile: x (fraction of the glass half width), height above the pile line (fraction of the glass height), head radius (fraction of the body width). Back row first; the colour alternates. */
const DOLLS: readonly (readonly [number, number, number])[] = [
  [-0.52, 0.4, 0.082],
  [0.4, 0.38, 0.082],
  [-0.08, 0.16, 0.098],
  [0.7, 0.14, 0.09],
];
/** The floor rails: how far they reach from the body, in cells (near part, then the fainter far part). */
const CM_RAIL = { from: 2.2, mid: 4.4, to: 6.6, upMid: 3, upTo: 3.8 } as const;
const CM_RAIL_DASH = [10, 8];

/** The two rails on the floor: its row and its column, fading out away from the machine. One cell = ux px across, uy px down. */
function clawRails(ctx: Ctx, ux: number, alpha: number): void {
  if (alpha <= 0.02) return;
  const uy = ux * SQUASH;
  const R = CM_RAIL;
  ctx.strokeStyle = CM.rail;
  ctx.lineWidth = 3;
  ctx.setLineDash(CM_RAIL_DASH);
  ctx.globalAlpha = alpha * 0.42;
  ctx.beginPath();
  ctx.moveTo(R.from * ux, 0);
  ctx.lineTo(R.mid * ux, 0);
  ctx.moveTo(-R.from * ux, 0);
  ctx.lineTo(-R.mid * ux, 0);
  ctx.moveTo(0, R.from * uy);
  ctx.lineTo(0, R.upMid * uy);
  ctx.moveTo(0, -R.from * uy);
  ctx.lineTo(0, -R.upMid * uy);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.2;
  ctx.beginPath();
  ctx.moveTo(R.mid * ux, 0);
  ctx.lineTo(R.to * ux, 0);
  ctx.moveTo(-R.mid * ux, 0);
  ctx.lineTo(-R.to * ux, 0);
  ctx.moveTo(0, R.upMid * uy);
  ctx.lineTo(0, R.upTo * uy);
  ctx.moveTo(0, -R.upMid * uy);
  ctx.lineTo(0, -R.upTo * uy);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}

/** The plush pile on the glass floor (cx, py), half width hw: heads with ears, eyes looking ahead; red pin-points once hot. */
function clawDolls(ctx: Ctx, cx: number, py: number, hw: number, gh: number, W: number, t: number, g: number, hot: boolean): void {
  for (let c = 0; c < 2; c++) {
    ctx.fillStyle = DOLL_COLORS[c];
    ctx.beginPath();
    for (let i = c; i < DOLLS.length; i += 2) {
      const d = DOLLS[i];
      const r = d[2] * W;
      const x = cx + d[0] * hw;
      const y = py - d[1] * gh * (1 - 0.35 * g) - r * 0.6 + Math.sin(t * 1.7 + i) * 1.2 * (1 - g);
      ctx.arc(x - r * 0.72, y - r * 0.74, r * 0.4, 0, TAU);
      ctx.moveTo(x + r * 1.12, y - r * 0.74);
      ctx.arc(x + r * 0.72, y - r * 0.74, r * 0.4, 0, TAU);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.fillStyle = INK;
  ctx.beginPath();
  for (let i = 0; i < DOLLS.length; i++) {
    const d = DOLLS[i];
    const r = d[2] * W;
    const x = cx + d[0] * hw + r * 0.18;
    const y = py - d[1] * gh * (1 - 0.35 * g) - r * 0.6;
    ctx.moveTo(x - r * 0.14, y);
    ctx.arc(x - r * 0.4, y, r * 0.27, 0, TAU);
    ctx.moveTo(x + r * 0.67, y);
    ctx.arc(x + r * 0.4, y, r * 0.27, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = hot ? '#ff2a3d' : '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < DOLLS.length; i++) {
    const d = DOLLS[i];
    const r = d[2] * W;
    const x = cx + d[0] * hw + r * 0.26;
    const y = py - d[1] * gh * (1 - 0.35 * g) - r * 0.6 - (hot ? 1.5 : 3);
    ctx.rect(x - r * 0.4 - 1.5, y, 3, 3);
    ctx.rect(x + r * 0.4 - 1.5, y, 3, 3);
  }
  ctx.fill();
}

/** A claw on its cable from (x, topY) down to its hub at (x, y), drawn s× : open 0..1 spreads the three prongs, limp 0..1 lets them hang shut. */
function clawArm(ctx: Ctx, x: number, topY: number, y: number, s: number, open: number, limp: number, metal: string, hub: string): void {
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5 * s;
  ctx.stroke();
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  const spread = (7 + 15 * open) * (1 - 0.5 * limp) * s;
  const hook = (6 + 5 * (1 - open)) * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(x + k * 4 * s, y + 2 * s);
    ctx.lineTo(x + k * spread, y + 13 * s);
    ctx.lineTo(x + k * (spread - hook), y + (25 + 3 * limp) * s);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 8 * s;
  ctx.stroke();
  ctx.strokeStyle = metal;
  ctx.lineWidth = 4.5 * s;
  ctx.stroke();
  ctx.lineCap = 'butt';
  pathRoundRect(ctx, x - 9 * s, y - 5 * s, 18 * s, 10 * s, 4 * s);
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawClawBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const A = baseAlpha(ctx);
  const W = f.w;
  const H = f.h;
  const t = f.time;
  const g = downOf(f);
  const wind = windOf(f);
  const hit = swingOf(f);
  const hot = isHot(o);
  const body = tinted(CM.base, o);
  const trim = hot ? RED : CM.trim;
  const metal = hot ? '#ffc2c8' : '#eef1f5';
  // it glides on its rails: the walk bob of the shared frame is not used
  const gy = f.pose === 'walk' ? 0 : f.fy;
  clawRails(ctx, W / CLAW_BODY.w, A * (1 - g));
  ctx.globalAlpha = A;
  // coin-tin feet; streaks behind them while it slides
  ctx.fillStyle = '#c9a227';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.rect(-W * 0.36, gy - H * 0.08, W * 0.16, H * 0.08);
  ctx.rect(W * 0.2, gy - H * 0.08, W * 0.16, H * 0.08);
  ctx.fill();
  ctx.stroke();
  if (f.pose === 'walk') {
    const u = (f.stride * 2) % 1;
    ctx.globalAlpha = A * 0.6 * (1 - u);
    ctx.strokeStyle = CM.rail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-W * (0.5 + 0.2 * u), gy - H * 0.04);
    ctx.lineTo(-W * (0.66 + 0.2 * u), gy - H * 0.04);
    ctx.moveTo(-W * (0.52 + 0.2 * u), gy - H * 0.3);
    ctx.lineTo(-W * (0.72 + 0.2 * u), gy - H * 0.3);
    ctx.stroke();
    ctx.globalAlpha = A;
  }
  // the lower cabinet
  pathRoundRect(ctx, -W * 0.44, gy - H * 0.5, W * 0.88, H * 0.44, 9);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = darken(body, 0.5);
  ctx.lineWidth = 3;
  ctx.stroke();
  // the prize chute (in front) with something looking out, the coin slot behind it
  ctx.fillStyle = '#1a0d14';
  ctx.fillRect(W * 0.02, gy - H * 0.32, W * 0.34, H * 0.18);
  if (g < 0.5 && blink(t, 6) > 0.4) {
    ctx.fillStyle = hot ? '#ff5d5d' : '#ffe9a8';
    ctx.fillRect(W * 0.14, gy - H * 0.26, 7, 6);
    ctx.fillRect(W * 0.25, gy - H * 0.26, 7, 6);
  }
  ctx.fillStyle = trim;
  ctx.fillRect(-W * 0.36, gy - H * 0.38, W * 0.15, H * 0.24);
  ctx.fillStyle = INK;
  ctx.fillRect(-W * 0.3, gy - H * 0.34, W * 0.03, H * 0.15);
  // the glass box: dark inside, lit from within by the wind-up
  const gx = -W * 0.4;
  const gw = W * 0.74;
  const gt = gy - H * 0.92;
  const gh = H * 0.39;
  ctx.fillStyle = '#12303a';
  ctx.fillRect(gx, gt, gw, gh);
  if (wind > 0) {
    ctx.globalAlpha = A * 0.5 * wind;
    ctx.fillStyle = hot ? '#ff9aa8' : '#fff3c4';
    ctx.fillRect(gx, gt, gw, gh);
    ctx.globalAlpha = A;
  }
  clawDolls(ctx, gx + gw / 2, gt + gh, gw / 2, gh, W, t, g, hot);
  // the small claw behind the glass: slides when idle, parks while the big one works, hangs when knocked down
  const s = W / 160;
  const busy = Math.max(wind, hit);
  const inX = gx + gw / 2 + Math.sin(t * 0.9) * gw * 0.3 * (1 - g) * (1 - busy);
  clawArm(ctx, inX, gt, gt + gh * (0.2 + 0.36 * g), s * 0.8, 0.15 * (1 - g), g, metal, trim);
  // glass shine, cracks when broken, the red wash of the enrage, the frame
  ctx.globalAlpha = A * 0.16;
  ctx.fillStyle = CM.glass;
  ctx.beginPath();
  ctx.moveTo(gx + gw * 0.12, gt);
  ctx.lineTo(gx + gw * 0.3, gt);
  ctx.lineTo(gx + gw * 0.08, gt + gh);
  ctx.lineTo(gx, gt + gh);
  ctx.lineTo(gx, gt + gh * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = A;
  if (g > 0) cracks(ctx, gx + gw * 0.55, gt + gh * 0.5, gh * 0.75, 5, 3, '#ffffff', A * g * 0.9);
  if (o.enraged) {
    ctx.globalAlpha = A * (0.14 + 0.12 * Math.max(0, Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.fillRect(gx, gt, gw, gh);
  }
  ctx.globalAlpha = A;
  ctx.strokeStyle = trim;
  ctx.lineWidth = 5;
  ctx.strokeRect(gx, gt, gw, gh);
  // the control ledge sticks out in front; the joystick on it moves by itself
  ctx.fillStyle = darken(body, 0.2);
  ctx.fillRect(-W * 0.46, gy - H * 0.54, W * 1.02, H * 0.07);
  const lean = Math.sin(t * 2.3) * W * 0.04 * (1 - g) * (1 - busy) + W * 0.05 * busy;
  ctx.beginPath();
  ctx.moveTo(W * 0.46, gy - H * 0.54);
  ctx.lineTo(W * 0.46 + lean, gy - H * 0.66);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W * 0.46 + lean, gy - H * 0.68, W * 0.055, 0, TAU);
  ctx.fillStyle = '#e63946';
  ctx.fill();
  // the roof and its marquee bulbs: every other one lit, swapping; they stutter when knocked down
  pathRoundRect(ctx, -W * 0.44, gy - H, W * 0.82, H * 0.09, 6);
  ctx.fillStyle = trim;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const beat = Math.floor(t * 3);
  ctx.fillStyle = '#fffbe0';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const lit = g > 0 ? strobe(t, 9, i, 0.25) === 1 : wind > 0 || (i + beat) % 2 === 0;
    if (!lit) continue;
    const bx = -W * 0.36 + i * W * 0.165;
    ctx.moveTo(bx + 4.5, gy - H * 0.955);
    ctx.arc(bx, gy - H * 0.955, 4.5, 0, TAU);
  }
  ctx.fill();
  // the crane arm: it swings out over the front through the wind-up and its big claw opens; with the hit the claw
  // drops to the floor and shuts (it stays inside the body box's height: nothing hides under the HUD)
  if (busy > 0 && g <= 0) {
    const reach = W * (0.5 + 0.36 * (wind > 0 ? wind : 1));
    const boomY = gy - H * 0.97;
    limb(ctx, W * 0.3, gy - H * 0.95, reach, boomY, -H * 0.05, 7, trim);
    clawArm(ctx, reach, boomY, gy - H * (0.64 - 0.28 * hit), s * 1.7, wind > 0 ? wind : 1 - hit, 0, metal, trim);
  }
  ctx.globalAlpha = A;
}

/** 인형 뽑기 기계: about the old cabinet at half size (radius 1.7). */
const CLAW_BODY: BossBody = { w: 2.9, h: 2.6, draw: drawClawBody };

/** Knocked down: the 「고장」 sign taped across the glass (screen-aligned, so the text never mirrors). */
function drawClawMachineProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const h = CLAW_BODY.h * PX_PER_UNIT;
  plaque(ctx, cam.sx(x), propFootY(cam, y, CLAW_BODY) - h * 0.72, 78, 28, '고장', CM.trim, '#1b1b1b', o.groggy * (1 - o.retreat), -0.14);
}

// ─────────────────────────── 혼자 도는 세탁기 (washer_drum) ───────────────────────────
// 배회형: a half-size washer on four stubby feet; the round glass door is its eye. It waddles after the farthest
// character, tucks its feet in and spins like a wheel before it rolls (탈수 돌진), and lies on its side with the door
// open and the water running out when knocked down.

const WD = { base: '#8fb3c7', accent: '#ff7a59', light: '#eaf6ff' } as const;

/** Inside the drum at (dx, dy), radius R: water sloshing (draining when knocked down), the swirl and its foam. */
function washerDrum(ctx: Ctx, dx: number, dy: number, R: number, t: number, wind: number, g: number, A: number, water: string, foam: string): void {
  const r = R * 0.84;
  const spin = t * (1.3 + 9 * wind) * (1 - g);
  ctx.beginPath();
  ctx.arc(dx, dy, R * 0.94, 0, TAU);
  ctx.fillStyle = '#0a1420';
  ctx.fill();
  const level = -0.4 + 1.3 * g;
  const tilt = Math.sin(t * 2.2) * 0.22 * (1 - g);
  ctx.beginPath();
  ctx.arc(dx, dy, r, level + tilt, Math.PI - level + tilt);
  ctx.fillStyle = water;
  ctx.fill();
  ctx.globalAlpha = A * 0.55;
  ctx.strokeStyle = foam;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let k = 0; k <= 11; k++) {
    const u = k / 11;
    const a = u * TAU * 1.4 + spin;
    const px = dx + Math.cos(a) * r * 0.92 * u;
    const py = dy + Math.sin(a) * r * 0.92 * u;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = A * 0.85;
  ctx.fillStyle = foam;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = spin * 0.6 + i * 1.26;
    const d = r * (0.5 + 0.4 * hash01(i, 41));
    const br = 3 + hash01(i, 42) * 3;
    const bx = dx + Math.cos(a) * d;
    const by = dy + Math.sin(a) * d;
    ctx.moveTo(bx + br, by);
    ctx.arc(bx, by, br, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = A;
}

/** The door at (dx, dy), radius R, hinged at the back: open 0..1 swings it out (a narrowing ellipse); the glass keeps a highlight. */
function washerDoor(ctx: Ctx, dx: number, dy: number, R: number, open: number, A: number): void {
  const rx = R * (1 - 0.8 * open);
  const x = dx - R + rx - R * 0.55 * open;
  ctx.globalAlpha = A * 0.2;
  ctx.fillStyle = WD.light;
  ctx.beginPath();
  ctx.ellipse(x, dy, rx, R, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = A;
  ctx.strokeStyle = INK;
  ctx.lineWidth = R * 0.26;
  ctx.stroke();
  ctx.strokeStyle = WD.light;
  ctx.lineWidth = R * 0.16;
  ctx.stroke();
  ctx.globalAlpha = A * 0.6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, dy, rx * 0.72, R * 0.72, 0, -2.5, -1.7);
  ctx.stroke();
  ctx.globalAlpha = A;
}

function drawWasherBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const A = baseAlpha(ctx);
  const W = f.w;
  const H = f.h;
  const t = f.time;
  const g = downOf(f);
  const wind = windOf(f);
  const hit = swingOf(f);
  const hot = isHot(o);
  const body = tinted(WD.base, o);
  const water = hot ? '#8a1a2c' : '#1d5a8a';
  const foam = hot ? '#ffd6d6' : WD.light;
  const gy = f.fy;
  const bw = W * 0.8;
  const bh = H * 0.8;
  const foot = H * 0.07;
  /** The cabinet's own centre when it stands. */
  const c0 = gy - foot - bh / 2;
  // the water it lost, on the floor
  if (g > 0) {
    ctx.globalAlpha = A * 0.8 * g;
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.ellipse(W * 0.1, gy + 3, W * 0.6 * g, 10, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = A;
  }
  // how the cabinet sits: rattling, waddling, spinning up like a wheel (it lifts so its corners clear the floor),
  // lunging, or lying on its side
  let ang = 0;
  let cx = 0;
  let cy = c0;
  if (g > 0) {
    ang = (-Math.PI / 2) * g;
    cy = c0 + (gy - bw / 2 - c0) * g;
  } else if (wind > 0) {
    ang = wind * wind * TAU * 2;
    cy = c0 - Math.min(1, wind * 6) * H * 0.11;
  } else if (hit > 0) {
    ang = hit * 0.2;
    cx = hit * W * 0.14;
  } else if (f.pose === 'walk') {
    ang = Math.sin(f.stride * TAU) * 0.1;
    cx = ang * W * 0.15;
  } else {
    cx = Math.sin(t * 31) * 1.2;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.translate(0, -c0);
  const top = gy - foot - bh;
  if (wind <= 0) {
    // stubby feet: they step in turn while it waddles
    const step = f.pose === 'walk' ? Math.sin(f.stride * TAU) : 0;
    ctx.fillStyle = darken(body, 0.5);
    ctx.fillRect(-bw * 0.4, gy - foot - 2 - Math.max(0, step) * 5, bw * 0.22, foot + 2);
    ctx.fillRect(bw * 0.18, gy - foot - 2 - Math.max(0, -step) * 5, bw * 0.22, foot + 2);
  }
  pathRoundRect(ctx, -bw / 2, top, bw, bh, 12 + 16 * Math.min(1, wind * 3));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = darken(body, 0.5);
  ctx.lineWidth = 3;
  ctx.stroke();
  // its back side, a shade darker (it is seen a little from the front corner)
  ctx.fillStyle = darken(body, 0.2);
  ctx.fillRect(-bw / 2 + 4, top + 12, bw * 0.09, bh - 24);
  // the control strip: programme lamps (red and stuttering when knocked down) and the dial
  ctx.fillStyle = darken(body, 0.3);
  ctx.fillRect(-bw * 0.36, top + 7, bw * 0.8, bh * 0.15);
  ctx.fillStyle = g > 0 ? RED : '#7cf5ff';
  const prog = Math.floor(t * 2);
  for (let k = 0; k < 3; k++) {
    const lit = g > 0 ? strobe(t, 6, k) === 1 : (prog + k) % 3 !== 0;
    if (lit) ctx.fillRect(-bw * 0.31 + k * bw * 0.13, top + 7 + bh * 0.04, bw * 0.09, bh * 0.07);
  }
  const dial = t * (0.7 + 7 * wind) * (1 - g);
  const dialX = bw * 0.32;
  const dialY = top + 7 + bh * 0.075;
  ctx.beginPath();
  ctx.arc(dialX, dialY, bh * 0.058, 0, TAU);
  ctx.fillStyle = hot ? RED : WD.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(dialX, dialY);
  ctx.lineTo(dialX + Math.cos(dial) * bh * 0.05, dialY + Math.sin(dial) * bh * 0.05);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // the drum and the eye in it; the door pops open at the peak of a hit and stays open while knocked down
  const dx = bw * 0.05;
  const dy = top + bh * 0.6;
  const R = bh * 0.33;
  washerDrum(ctx, dx, dy, R, t, wind, g, A, water, foam);
  bigEye(ctx, dx, dy, R * 0.52, 0.7, 0.15, hot, A, blink(t, 4) * (1 - g));
  washerDoor(ctx, dx, dy, R, Math.max(g, hit * 0.6), A);
  if (wind > 0) {
    // foam squeezing out around the door as it spins up
    ctx.fillStyle = foam;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + 0.4;
      const fr = (3 + hash01(i, 43) * 5) * wind;
      const px = dx + Math.cos(a) * R * 1.12;
      const py = dy + Math.sin(a) * R * 1.12;
      ctx.moveTo(px + fr, py);
      ctx.arc(px, py, fr, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = A;
  if (wind > 0.15) {
    // two arcs racing around it: it is spinning
    const a0 = wind * 9;
    const rr = bw * 0.78;
    ctx.globalAlpha = A * 0.55 * wind;
    ctx.strokeStyle = foam;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, cy, rr, a0, a0 + 1.1);
    ctx.moveTo(Math.cos(a0 + Math.PI) * rr, cy + Math.sin(a0 + Math.PI) * rr);
    ctx.arc(0, cy, rr, a0 + Math.PI, a0 + Math.PI + 1.1);
    ctx.stroke();
    ctx.globalAlpha = A;
  }
  if (g > 0) dripRow(ctx, -bw * 0.2, gy - bw * 0.36, bw * 0.4, 5, bw * 0.34, t, water, A * g);
  ctx.globalAlpha = A;
}

/** 혼자 도는 세탁기: about the old washer at half size (radius 1.6). */
const WASHER_BODY: BossBody = { w: 2.8, h: 2.7, draw: drawWasherBody };

/** Knocked down: the blinking 「E-rr」 over it (screen-aligned). */
function drawWasherProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const on = 0.45 + 0.55 * strobe(o.time, 3, 2);
  const h = WASHER_BODY.h * PX_PER_UNIT;
  plaque(ctx, cam.sx(x), propFootY(cam, y, WASHER_BODY) - h * 0.86, 82, 26, 'E-rr', '#0d1b24', '#ff5d5d', o.groggy * (1 - o.retreat) * on);
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

/** An open pale hand with no arm: palm at (x, y), four fingers fanned around `ang` (rad), `spread` rad apart. */
function ghostHand(ctx: Ctx, x: number, y: number, ang: number, s: number, spread = 0.34, skin: string = SKIN): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let f = 0; f < 4; f++) {
    const a = ang + (f - 1.5) * spread;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * s * 1.9, y + Math.sin(a) * s * 1.9);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.5 + 4;
  ctx.stroke();
  ctx.strokeStyle = skin;
  ctx.lineWidth = s * 0.5;
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(x, y, s * 0.85, 0, TAU);
  ctx.fillStyle = skin;
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

// 기획 20차 (docs/bosses.md 5-2): the floor of the karaoke fight — the mirror ball's light on the arena centre, the point
// its beam (미러볼 / 앙코르 미러볼) turns around, with faint guides where the six beam steps fall.

/** The arena spot the beam turns around (the data's KR_PIVOT). */
const KR_FLOOR = { x: 12, y: 6 } as const;
/** Half length of a floor guide, in cells (the beam is 22 long). */
const KR_GUIDE = 11;

const KR_STAGE: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const cx = KR_FLOOR.x * B.cellX;
    const cy = KR_FLOOR.y * B.cellY;
    const neon = B.phase >= 2 ? '#ff2a3d' : KR.neon;
    // where the beam steps fall: six faint lines through the centre, 30° apart
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.globalAlpha = 0.07;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 6;
      const ux = Math.cos(a) * KR_GUIDE * B.cellX;
      const uy = Math.sin(a) * KR_GUIDE * B.cellY;
      g.moveTo(cx - ux, cy - uy);
      g.lineTo(cx + ux, cy + uy);
    }
    g.stroke();
    // the pool of light under the ball: stacked ellipses, brighter toward the middle
    g.fillStyle = neon;
    for (let i = 0; i < 3; i++) {
      const r = 2.6 - i * 0.7;
      g.globalAlpha = 0.1 + i * 0.05;
      g.beginPath();
      g.ellipse(cx, cy, r * B.cellX, r * B.cellY, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 0.55;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(cx, cy, 0.5 * B.cellX, 0.5 * B.cellY, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 0.6;
    g.strokeStyle = neon;
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(cx, cy, 2.6 * B.cellX, 2.6 * B.cellY, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  },
  /** Colour spots circling the light (the ball is turning); they dim while the boss is down. */
  live(ctx, cam, o, time) {
    const A = baseAlpha(ctx);
    const spin = time * (0.7 + 1.6 * o.charge);
    const cx = cam.sx(KR_FLOOR.x);
    const cy = cam.sy(KR_FLOOR.y);
    ctx.globalAlpha = A * (o.groggy > 0 ? 0.12 : 0.42);
    for (let c = 0; c < 3; c++) {
      ctx.fillStyle = SPOT_COLORS[c];
      ctx.beginPath();
      for (let k = 0; k < 2; k++) {
        const a = spin + c * 2.1 + k * Math.PI;
        const px = cx + Math.cos(a) * 3.6 * PX_PER_UNIT;
        const py = cy + Math.sin(a) * 3.6 * PX_PER_UNIT_Y;
        ctx.moveTo(px + 20, py);
        ctx.ellipse(px, py, 20, 20 * SQUASH, 0, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = A;
  },
};

// ─────────────────────────── 거꾸로 가는 에스컬레이터 (reverse_escalator) ───────────────────────────
// 전장형: the whole arena floor is the staircase — five stair rows (2.4 cells each) that keep running DOWN, the comb
// plate with its gap along the bottom edge, the black handrails down both sides (the bands 손잡이 squeezes). The boss's
// body is small: 「틈새의 손」, a knot of pale hands reaching out of a gap in the steps, an eye in the palm of the tallest.
// It rides the stairs round a path; the stairs themselves do the damage (덜컹 / 비상정지 shove the whole floor).

const RE = { base: '#6c757d', warn: '#ffd60a', light: '#dee2e6' } as const;
/** Height of one stair row, in cells (the data's RE_ROW: the bottom row is the 「틈」 of 덜컹). */
const RE_STAIR = 2.4;
/** Width of the handrail bands on both sides, in cells (손잡이: x 0–3 and 21–24). */
const RE_RAIL = 3;
/** Arena columns (x) of the arrows that run down the steps; odd rows use the second pair. */
const RE_FLOW_X = [
  [8, 16],
  [4.5, 12, 19.5],
] as const;

const RE_STAGE: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const hot = B.phase >= 2;
    const rowH = RE_STAIR * B.cellY;
    const rows = Math.round(B.hPx / rowH);
    const warn = hot ? RED : RE.warn;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      // the tread, the shadow of the step above it, its warning-yellow nose
      g.globalAlpha = 0.6;
      g.fillStyle = r % 2 === 0 ? (hot ? '#5e4a52' : '#5a626c') : hot ? '#51404a' : '#4b535d';
      g.fillRect(0, y, B.wPx, rowH);
      g.globalAlpha = 0.55;
      g.fillStyle = '#0c0d11';
      g.fillRect(0, y, B.wPx, rowH * 0.16);
      g.globalAlpha = 0.5;
      g.fillStyle = warn;
      g.fillRect(0, y + rowH - 4, B.wPx, 4);
    }
    // comb grooves along every tread
    g.globalAlpha = 0.14;
    g.strokeStyle = '#0b0b0e';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = B.cellX * 0.5; x < B.wPx; x += B.cellX * 0.5) {
      g.moveTo(x, 0);
      g.lineTo(x, B.hPx);
    }
    g.stroke();
    // the bottom edge: the comb plate and the gap things fall into
    g.globalAlpha = 0.85;
    g.fillStyle = '#050407';
    g.fillRect(0, B.hPx - B.cellY * 0.5, B.wPx, B.cellY * 0.5);
    spikes(g, 0, B.hPx - B.cellY * 0.5, B.wPx, 48, -B.cellY * 0.45, warn);
    // the sides: a darker balustrade band, the black rubber handrail along the wall, a yellow safety line inside
    const band = RE_RAIL * B.cellX;
    for (const x0 of [0, B.wPx - band]) {
      const wall = x0 === 0 ? 0 : B.wPx - B.cellX * 0.7;
      const line = x0 === 0 ? band - 3 : x0;
      g.globalAlpha = 0.28;
      g.fillStyle = '#050407';
      g.fillRect(x0, 0, band, B.hPx);
      g.globalAlpha = 0.9;
      g.fillStyle = '#0b0b0e';
      g.fillRect(wall, 0, B.cellX * 0.7, B.hPx);
      g.globalAlpha = 0.5;
      g.fillStyle = RE.light;
      g.fillRect(wall + B.cellX * 0.28, 0, 3, B.hPx);
      g.globalAlpha = 0.55;
      g.fillStyle = warn;
      g.fillRect(line, 0, 3, B.hPx);
    }
    g.globalAlpha = 1;
  },
  /** Arrows running down every step (the stairs never stop); they freeze and dim while the boss is down (비상정지). */
  live(ctx, cam, o, time) {
    const A = baseAlpha(ctx);
    const g = o.groggy;
    const u = g > 0 ? 0.5 : (time * (o.phase >= 2 ? 0.75 : 0.5)) % 1;
    const s = 11;
    ctx.beginPath();
    for (let r = 0; r < 5; r++) {
      const y = cam.sy((r + 0.2 + 0.6 * u) * RE_STAIR);
      for (const wx of RE_FLOW_X[r % 2]) {
        const x = cam.sx(wx);
        ctx.moveTo(x - s, y - s * 0.6);
        ctx.lineTo(x, y + s * 0.4);
        ctx.lineTo(x + s, y - s * 0.6);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = isHot(o) ? '#ffb3ba' : RE.light;
    ctx.globalAlpha = A * (g > 0 ? 0.12 : (0.14 + 0.3 * o.charge) * Math.sin(Math.PI * u) + 0.08);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = A;
  },
};

/** 「틈새의 손」: where each hand's arm leaves the gap (fraction of the body width). The back pair first, the tall middle hand — the one with the eye — last. */
const RE_HANDS = [-0.34, 0.34, -0.17, 0.17, 0] as const;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

function drawGapHands(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const A = baseAlpha(ctx);
  const W = f.w;
  const H = f.h;
  const t = f.time;
  const g = downOf(f);
  const wind = windOf(f);
  const hit = swingOf(f);
  const walk = f.pose === 'walk';
  const hot = isHot(o);
  const skin = hot ? '#ecc9c9' : SKIN;
  // the gap it reaches out of stays on the floor (no bob): a dark slit, comb teeth along its near edge
  ctx.fillStyle = '#07060a';
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.54, H * 0.11, 0, 0, TAU);
  ctx.fill();
  spikes(ctx, -W * 0.42, H * 0.05, W * 0.84, 7, H * 0.07, hot ? RED : RE.warn);
  for (let k = 0; k < RE_HANDS.length; k++) {
    const u = RE_HANDS[k];
    const mid = u === 0;
    const side = u >= 0 ? 1 : -1;
    const tall = mid ? 0.8 : Math.abs(u) > 0.3 ? 0.48 : 0.66;
    let hx = u * W * 1.15 + Math.sin(t * 1.7 + k * 1.9) * W * 0.035 * (1 - g);
    let hy = f.fy - H * tall;
    let ang = -Math.PI / 2 + u * 1.1;
    let spread = 0.34;
    if (walk) {
      // crawling: the hands reach ahead in turn
      const ph = f.stride * TAU + k * 1.3;
      hx += W * (0.1 + 0.08 * Math.sin(ph));
      hy += H * 0.07 * Math.cos(ph);
      ang += 0.45;
    }
    if (wind > 0) {
      // every hand up, every finger spread
      hx = lerp(hx, u * W * 1.5, wind);
      hy -= H * 0.1 * wind;
      ang = lerp(ang, -Math.PI / 2 + u * 0.7, wind);
      spread += 0.3 * wind;
    }
    if (hit > 0) {
      hx += W * 0.3 * hit;
      hy += H * 0.36 * hit;
      ang += 1.1 * hit;
    }
    if (g > 0) {
      // limp: lying on the floor around the gap
      hx = lerp(hx, u * W * 1.7 + (mid ? W * 0.5 : 0), g);
      hy = lerp(hy, -H * (mid ? 0.1 : 0.05), g);
      ang = lerp(ang, side > 0 ? 0.35 : Math.PI - 0.35, g);
      spread = lerp(spread, 0.18, g);
    }
    const s = (mid ? 0.15 : 0.09) * W;
    limb(ctx, u * W * 0.9, -2, hx - Math.cos(ang) * s * 0.5, hy - Math.sin(ang) * s * 0.5, side * W * 0.08 * (1 - g), mid ? 11 : 8, skin);
    ghostHand(ctx, hx, hy, ang, s, spread, skin);
    if (mid) bigEye(ctx, hx, hy, s * 0.6, 0.6, 0.2, hot, A, blink(t, 5) * (1 - g));
  }
  ctx.globalAlpha = A;
}

/** 「틈새의 손」: a small core (radius 1.3) — the staircase is the boss, this is where it can be hit. */
const HANDS_BODY: BossBody = { w: 2.4, h: 2.2, draw: drawGapHands };

/** Knocked down: the emergency stop button, pushed in, and its sign (screen-aligned). */
function drawEscalatorProps(ctx: Ctx, cam: Camera, x: number, y: number, _radius: number, o: BossDrawOpts): void {
  const a = o.groggy * (1 - o.retreat);
  if (a <= 0) return;
  const cx = cam.sx(x);
  const fy = propFootY(cam, y, HANDS_BODY);
  const h = HANDS_BODY.h * PX_PER_UNIT;
  ctx.globalAlpha = a;
  const bx = cx + HANDS_BODY.w * PX_PER_UNIT * 0.62;
  ctx.fillStyle = RE.warn;
  ctx.fillRect(bx - 17, fy - 40, 34, 34);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(bx - 17, fy - 40, 34, 34);
  ctx.beginPath();
  ctx.arc(bx, fy - 23, 11, 0, TAU);
  ctx.fillStyle = strobe(o.time, 4, 6) === 1 ? '#ff2a3d' : '#8a0f1c';
  ctx.fill();
  ctx.stroke();
  plaque(ctx, cx, fy - h * 0.86, 104, 28, '비상정지', '#d00000', '#ffffff', a);
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

/** Boss id → look. A moving boss's `draw` is its body standing still (the sheet tools and the look tests draw through it). */
export const LOBBY_LOOKS: Record<string, BossLook> = {
  claw_machine: { draw: asSetPiece(CLAW_BODY), body: CLAW_BODY, color: CM.base, props: drawClawMachineProps },
  washer_drum: { draw: asSetPiece(WASHER_BODY), body: WASHER_BODY, color: WD.base, props: drawWasherProps },
  karaoke_room: { draw: drawKaraoke, stage: KR_STAGE, color: KR.neon, headY: (by, _R, g) => by - 14 + 14 * g, props: drawKaraokeProps },
  reverse_escalator: { draw: asSetPiece(HANDS_BODY), body: HANDS_BODY, stage: RE_STAGE, color: RE.base, props: drawEscalatorProps },
};

/**
 * Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). The 기획 20차 extras
 * (a rush's chevrons, the turning beam's joined line) come from the part itself, not from this table.
 */
export const LOBBY_TELE_MOTIF: Record<string, TeleMotif> = {
  cm_grab: 'pull',
  cm_prizes: 'spawn',
  wd_suds: 'linger',
  wd_socks: 'spawn',
  re_lurch: 'push',
  re_stop: 'push',
  re_lurch_twice: 'push',
};

/** MonsterDef.look → the body of this zone's summon-only units. */
export const LOBBY_MINION_LOOKS: Record<string, CreatureDrawFn> = {
  prize_doll: prizeDoll,
  lost_sock: lostSock,
};

/** 기획 20차: Zone.look → fill / edge of this zone's trail zones. None here: no lobby boss leaves a trail (거품 is a plain zone). */
export const LOBBY_ZONE_LOOKS: Record<string, { fill: string; edge?: string }> = {};
