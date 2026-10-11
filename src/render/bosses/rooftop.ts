// 기획 20차 보스 형태 — 옥상·이계 boss looks (docs/bosses.md 5장). This zone's track owns this file.
// Bosses: tank_dweller 물탱크의 주인 · thunder_antenna 천둥 안테나 · answering_pencil 대답하는 연필 · inverted_moon 거꾸로 뜬 달.
// All four move, so each is a BODY drawn among the characters (about half the old set piece), never a prop at the top:
//   물탱크의 주인  low and long — a drowned thing on its belly, wet hair dragging behind, two long arms ahead (배회)
//   천둥 안테나    tall and spindly — an old tube TV scurrying on four antenna legs, rabbit ears with lamp eyes (배회)
//   대답하는 연필  thin and upright — a big pencil held by two pale arms that come up out of the paper (전장형의 핵)
//   거꾸로 뜬 달   flat — the moon's reflection on the wet roof, drawn on the ground pass under every unit (전장형의 핵)
// and the two arena bosses dress the whole floor (BossStageLook): 「paper」 = yellowed graph paper with 예 / 아니오 written
// on it, 「moon」 = the roof at night with the real (upside-down) moon in the open sky between the HUD boxes.
// Summon looks: none (외발 우산 is an existing monster).
// Warning motifs (skill id → motif): td_hair / td_hug pull · td_dive linger · td_umbrellas spawn.
// Trail looks (Zone.look): graphite = the line 긋기 leaves on the paper.
//
// Body rules (types.ts BossBodyFn): drawn facing right inside its box — the shared frame (body.ts) mirrors, bobs, swells,
// tilts and tints it; no fillText (it would mirror), ≤ 220 canvas calls, no gradient / shadowBlur / Math.random; read
// only the frame, BossDrawOpts and hash01. Poses: idle · walk (f.stride) · windup (f.p toward the hit) · attack · groggy.
// Checks: npx vitest run tests/render (boss-body.test.ts: 5 poses × 2 sides inside the budget; boss-looks.test.ts).
// See it: /?mode=bossRaid&boss=<id> · node tests/visual/boss-phone-sheet.mjs only=<id>

import { getBoss } from '../../data';
import type { Camera } from '../camera';
import { asSetPiece } from './body';
import { TAU, bigEye, blink, dripRow, hand, hash01, limb, pathRoundRect, plaque, smallEye, strobe, swayAngle, tinted } from './kit';
import type { BossBody, BossBodyFrame, BossDrawOpts, BossLook, BossStageLook, CreatureDrawFn, TeleMotif, ZoneLook } from './types';

type Ctx = CanvasRenderingContext2D;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** The alpha the shared frame set for this body (1 − retreat); parts fade relative to it. */
const alphaOf = (ctx: Ctx): number => (typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1);

// ─────────────────────────── 물탱크의 주인 (배회형: 엎드려 기는 물귀신, 젖은 긴 머리가 뒤로 끌림) ───────────────────────────

// (shades are literal hex: tinted() needs hex in and gives hex out)
const TANK = { base: '#8ecae6', shade: '#5f9bb5', light: '#e0fbfc', water: '#c4ecf8', blood: '#8a1525', hair: '#0d0b10', skin: '#dfe7e4', far: '#a9b9bb', ink: '#12202a' };

/** A long arm: shoulder → hand with the elbow lifted, four fingers fanned around `aim` (rad). */
function dwellerArm(ctx: Ctx, sx: number, sy: number, hx: number, hy: number, aim: number, skin: string): void {
  limb(ctx, sx, sy, hx, hy, -Math.max(8, Math.hypot(hx - sx, hy - sy) * 0.24), 9, skin, TANK.ink);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = aim + (i - 1.5) * 0.3;
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(a) * 16, hy + Math.sin(a) * 16);
  }
  ctx.strokeStyle = TANK.ink;
  ctx.lineWidth = 6.5;
  ctx.stroke();
  ctx.strokeStyle = skin;
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawDweller(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const t = f.time;
  const W = f.w;
  const H = f.h;
  const x = f.fx;
  const y = f.fy;
  const A = alphaOf(ctx);
  const g = f.pose === 'groggy' ? f.p : 0;
  const wind = f.pose === 'windup' ? f.p : 0;
  const hit = f.pose === 'attack' ? Math.sin(f.p * Math.PI) : 0;
  const step = f.pose === 'walk' ? Math.sin(f.stride * TAU) : 0;
  // 잠수: it comes up out of its puddle (hands first), then rears up before the burst
  const emerge = f.pose === 'windup' ? clamp01(0.15 + f.p * 2) : 1;
  const reach = f.pose === 'windup' ? clamp01(f.p * 3) : 0;
  const rear = wind * wind;
  const k = 1 - 0.45 * g;
  const red = o.phase >= 2 || o.enraged;
  const water = red ? TANK.blood : TANK.water;
  const gown = tinted(TANK.base, o);
  const breathe = Math.sin(t * 2.4) * 2 * (1 - g);

  // the puddle it drags along (it widens while the thing comes up, and when it lies in it)
  ctx.globalAlpha = A * 0.62;
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.ellipse(x - W * 0.03, y + 1, W * (0.47 + 0.08 * g + 0.1 * (1 - emerge)), 9 + 3 * g, 0, 0, TAU);
  ctx.fill();
  if (wind > 0) {
    ctx.globalAlpha = A * (1 - wind) * 0.9;
    ctx.strokeStyle = TANK.light;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y + 1, W * (0.3 + 0.36 * wind), 6 + 9 * wind, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = A;

  // everything below is the body: sunk into the puddle while it comes up (cut off at the floor line)
  const y0 = y + (1 - emerge) * H * 0.8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - W, y - H * 2.4, W * 2, H * 2.4 + 3);
  ctx.clip();

  // a crawler seen from the side: shoulders propped up on the arms, the back sagging to the hips, the gown trailing
  const shX = x + W * 0.13;
  const shY = y0 - H * (0.5 + 0.38 * rear) * k + breathe;
  const hipX = x - W * 0.18;
  const hipY = y0 - H * 0.3 * k + step * 2;
  const hr = H * 0.23;
  const headX = x + W * (0.29 + 0.04 * hit);
  const headY = y0 - H * (0.4 + 0.5 * rear) * k + 4 * g + breathe * 0.5;
  // hands: on the floor ahead, walking in turn — raised high through the wind-up, flung down on the swing
  const nearX = x + W * (0.44 + 0.06 * step - 0.1 * reach + 0.06 * hit) + W * 0.03 * g;
  const nearY = y - 3 - reach * H * (0.5 + 0.55 * rear) - hit * H * 0.2;
  const farX = x + W * (0.37 - 0.06 * step - 0.12 * reach);
  const farY = y - 6 - reach * H * (0.42 + 0.5 * rear);
  const aim = reach > 0 ? -1.1 + 0.4 * rear : 0.12;

  dwellerArm(ctx, shX - 7, shY + 6, farX, farY, aim, TANK.far);

  // the soaked gown
  ctx.fillStyle = gown;
  ctx.strokeStyle = TANK.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - W * 0.5, y0 - 2);
  ctx.quadraticCurveTo(x - W * 0.36, hipY - 2, hipX, hipY);
  ctx.quadraticCurveTo(x - W * 0.02, hipY + H * 0.05, shX, shY);
  ctx.quadraticCurveTo(shX + W * 0.11, shY + 2, shX + W * 0.07, shY + H * 0.3 * k);
  ctx.lineTo(x + W * 0.1, y0 - 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // folds, and water still running off it
  ctx.globalAlpha = A * 0.6;
  ctx.strokeStyle = TANK.shade;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(x - W * (0.36 - i * 0.12), y0 - 4);
    ctx.quadraticCurveTo(x - W * (0.32 - i * 0.12), (hipY + y0) / 2, x - W * (0.26 - i * 0.11), hipY + 5);
  }
  ctx.stroke();
  ctx.globalAlpha = A;
  dripRow(ctx, x - W * 0.42, hipY + H * 0.1, W * 0.4, 4, H * 0.24, t, water, A * 0.9);
  ctx.globalAlpha = A;

  // the hair: a black sheet from the crown over the shoulders and down the back, its ends dragging through the puddle
  ctx.fillStyle = TANK.hair;
  ctx.beginPath();
  ctx.moveTo(headX + hr * 0.25, headY - hr * 1.08);
  ctx.quadraticCurveTo(headX - hr * 1.3, headY - hr * 1.15, shX - W * 0.05, shY - 3);
  ctx.quadraticCurveTo(x - W * 0.06, hipY - H * 0.02, hipX - W * 0.08, hipY + H * 0.08);
  ctx.lineTo(x - W * 0.3, y0 - 3);
  ctx.lineTo(x - W * 0.02, y0 - 3);
  ctx.quadraticCurveTo(shX - W * 0.03, shY + H * 0.3, headX - hr * 0.5, headY + hr * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = TANK.hair;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const sway = Math.sin(t * 1.7 + i) * 3 * (1 - g) - step * 4;
    ctx.moveTo(x - W * (0.06 + 0.06 * i), y0 - 6 - i);
    ctx.quadraticCurveTo(x - W * (0.2 + 0.06 * i), y0 - 9, x - W * (0.3 + 0.05 * i) + sway, Math.min(y - 1, y0 - 1 - (i % 2) * 2));
  }
  ctx.stroke();
  ctx.lineCap = 'butt';

  // the head: a pale face under the curtain, one eye showing
  ctx.fillStyle = TANK.hair;
  ctx.beginPath();
  ctx.ellipse(headX - hr * 0.1, headY - hr * 0.05, hr * 1.12, hr * 1.08, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = TANK.skin;
  ctx.beginPath();
  ctx.ellipse(headX + hr * 0.36, headY + hr * 0.12, hr * 0.6, hr * 0.8, 0, 0, TAU);
  ctx.fill();
  const open = g > 0 ? 0 : f.pose === 'windup' || f.pose === 'attack' ? 1.15 : blink(t, 3);
  smallEye(ctx, headX + hr * 0.52, headY + hr * 0.02, hr * 0.3, 0.7, 0.25, open, red ? '#ff1a1a' : '#16242b');
  const gape = Math.max(wind, hit);
  ctx.fillStyle = TANK.ink;
  ctx.beginPath();
  ctx.ellipse(headX + hr * 0.5, headY + hr * 0.58, hr * 0.2, hr * (0.07 + 0.2 * gape), 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = TANK.hair;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const hx = i < 4 ? headX - hr * 0.5 + i * hr * 0.27 : headX + hr * 1;
    const sway = Math.sin(t * 2 + i * 1.3) * 2.5 * (1 - g);
    ctx.moveTo(hx, headY - hr * 0.9);
    ctx.quadraticCurveTo(hx + 2, headY + hr * 0.5, hx + sway + (i - 1.5) * 2, Math.min(y - 1, headY + hr * (1.7 + 0.5 * hash01(i, 5))));
  }
  ctx.stroke();
  ctx.lineCap = 'butt';

  dwellerArm(ctx, shX, shY + 2, nearX, nearY, aim, TANK.skin);
  ctx.restore();

  // the burst: water thrown up around it
  const burst = Math.max(hit, wind > 0.7 ? (wind - 0.7) / 0.3 : 0);
  if (burst > 0) {
    ctx.globalAlpha = A * 0.85 * burst;
    ctx.fillStyle = red ? '#c2283c' : TANK.light;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const px = x + (hash01(i, 61) - 0.5) * W * 1.1;
      const h = H * (0.3 + 0.6 * hash01(i, 62)) * burst;
      ctx.rect(px, y - h, 5, h * 0.4);
    }
    ctx.fill();
    ctx.globalAlpha = A;
  }
}

const DWELLER_BODY: BossBody = { w: 3.2, h: 2, draw: drawDweller, headY: f => f.fy - f.h * (f.pose === 'groggy' ? 0.5 : 0.85) };

function drawDwellerProps(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  // the notice every tenant knows: 「단수」 (water is off)
  plaque(ctx, cam.sx(x - radius * 0.9), cam.sy(Math.max(y, 0)) - 64, 70, 28, '단수', '#f8f9fa', '#c1121f', (1 - o.retreat) * o.groggy, -0.08 + swayAngle(o.time, 2.4, 0.03));
}

// ─────────────────────────── 천둥 안테나 (배회형: 안테나 다리 넷으로 종종걸음 치는 브라운관 TV) ───────────────────────────

const ANT = { base: '#343a40', rim: '#7d858d', metal: '#adb5bd', dim: '#6c757d', zap: '#ffea00', light: '#f8f9fa', dark: '#0d0f12', off: '#07090b' };

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

/** Two of the four legs into the current path: hip on the set's underside → a knee out to the side → the foot. */
function antennaLegs(ctx: Ctx, x: number, y: number, hipY: number, W: number, hip: number, foot: number, back: number, scurry: number, i0: number, splay: number, walking: boolean): void {
  for (let s = -1; s <= 1; s += 2) {
    const ph = scurry + (i0 + (s > 0 ? 1 : 0)) * Math.PI * 0.5 + (s > 0 ? Math.PI : 0);
    const lift = walking ? Math.max(0, Math.sin(ph)) * 8 : 0;
    const swing = walking ? Math.cos(ph) * 6 : 0;
    const hx = x + s * W * hip;
    const fx = x + s * W * (foot + splay) + swing;
    ctx.moveTo(hx, hipY);
    ctx.lineTo(hx + s * W * 0.15, hipY - 6 + (y - hipY) * 0.2);
    ctx.lineTo(fx, y - back - lift);
  }
}

function drawAntenna(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const t = f.time;
  const W = f.w;
  const H = f.h;
  const x = f.fx;
  const y = f.fy;
  const A = alphaOf(ctx);
  const g = f.pose === 'groggy' ? f.p : 0;
  const wind = f.pose === 'windup' ? f.p : 0;
  const hit = f.pose === 'attack' ? Math.sin(f.p * Math.PI) : 0;
  const walking = f.pose === 'walk';
  const scurry = f.stride * TAU * 2;
  const charged = o.phase >= 2 || o.enraged;
  const tvW = W * 0.8;
  const tvH = H * 0.36;
  // knocked down the legs fold and the set sits on the roof
  const legH = H * 0.27 * (1 - 0.88 * g);
  const hipY = y - legH + (walking ? Math.sin(scurry * 2) * 1.5 : 0);
  const jit = wind > 0 ? Math.sin(t * 47) * 1.5 * wind : 0;

  // legs: the far pair, then the near pair (telescopic rods with a rubber foot)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  antennaLegs(ctx, x, y, hipY, W, 0.2, 0.3, 7, scurry, 0, 0.1 * g, walking);
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = ANT.dim;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  antennaLegs(ctx, x, y, hipY, W, 0.32, 0.47, 1, scurry, 2, 0.08 * g, walking);
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = ANT.metal;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineCap = 'butt';

  // the set and its aerials lean as one (a little with each step, a lot when it is down)
  ctx.save();
  ctx.translate(x + jit, hipY);
  ctx.rotate(0.13 * g + (walking ? Math.sin(scurry) * 0.035 : 0));

  // aerials: a fishbone mast and two rabbit ears with a lamp on each tip — its eyes
  const mastH = H * 0.34;
  const earLX = -tvW * 0.44;
  const earLY = -tvH - H * 0.24;
  const earRX = tvW * 0.4;
  const earRY = -tvH - H * 0.29;
  ctx.save();
  ctx.translate(-tvW * 0.04, -tvH + 2);
  ctx.rotate(-0.06 + 0.75 * g + swayAngle(t, 1.3, 0.02) * (1 - g));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -mastH);
  for (let i = 0; i < 3; i++) {
    const half = W * (0.3 - i * 0.075);
    const ry = -mastH * (0.4 + i * 0.24);
    ctx.moveTo(-half, ry + 4);
    ctx.lineTo(half, ry - 4);
  }
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = ANT.metal;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.fillStyle = ANT.metal;
  ctx.beginPath();
  ctx.arc(0, -mastH, 5, 0, TAU);
  ctx.fill();
  // the strike gathers on the tip, then a bolt stands from it into the sky (접지: the antenna is the lightning rod)
  const sky = Math.max(hit, clamp01((wind - 0.3) / 0.3));
  if (sky > 0) {
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    boltPath(ctx, 0, -mastH, 8, -mastH - 250, 7, 13, t, 9);
    ctx.globalAlpha = A * 0.5 * sky;
    ctx.strokeStyle = ANT.zap;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.globalAlpha = A * sky;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineJoin = 'round';
    ctx.globalAlpha = A;
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(-tvW * 0.12, -tvH + 2);
  ctx.lineTo(earLX, earLY);
  ctx.moveTo(tvW * 0.06, -tvH + 2);
  ctx.lineTo(earRX, earRY);
  ctx.strokeStyle = ANT.dark;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = ANT.metal;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (wind > 0) {
    // sparks crawl between the aerials while it winds up
    ctx.globalAlpha = A * Math.min(1, wind * 1.5);
    ctx.strokeStyle = ANT.zap;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    boltPath(ctx, earLX, earLY, -tvW * 0.04, -tvH - mastH * 0.7, 4, 8, t, 81);
    boltPath(ctx, -tvW * 0.04, -tvH - mastH * 0.7, earRX, earRY, 4, 8, t, 82);
    ctx.stroke();
    ctx.globalAlpha = A;
  }
  const lit = g > 0.5 ? 0 : charged || wind > 0 || hit > 0 ? 1 : 1 - 0.6 * strobe(t, 5, 31, 0.08);
  for (let s = 0; s < 2; s++) {
    const bx = s === 0 ? earLX : earRX;
    const by = s === 0 ? earLY : earRY;
    ctx.fillStyle = ANT.dark;
    ctx.beginPath();
    ctx.arc(bx, by, 9.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lit > 0 ? (o.enraged ? '#ff6b3d' : ANT.zap) : ANT.dim;
    ctx.globalAlpha = A * (lit > 0 ? lit : 1);
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = A;
    if (lit > 0) {
      ctx.fillStyle = ANT.dark;
      ctx.beginPath();
      ctx.arc(bx + 2.6, by + 1, 3, 0, TAU);
      ctx.fill();
    }
  }

  // the cabinet: the tube faces ahead, two knobs and a speaker grille behind it
  pathRoundRect(ctx, -tvW / 2, -tvH, tvW, tvH, 10);
  ctx.fillStyle = tinted(ANT.base, o);
  ctx.fill();
  ctx.strokeStyle = ANT.rim;
  ctx.lineWidth = 3;
  ctx.stroke();
  const sx = -tvW / 2 + tvW * 0.27;
  const sy = -tvH + 8;
  const sw = tvW * 0.66;
  const sh = tvH - 16;
  const off = g > 0.5;
  pathRoundRect(ctx, sx, sy, sw, sh, 11);
  ctx.fillStyle = off ? ANT.off : charged ? '#c9b458' : '#9aa3ab';
  ctx.fill();
  if (off) {
    // switched off: the picture collapses to a line
    const w = (sw - 14) * (1 - g) * 2 + 6;
    ctx.fillStyle = ANT.light;
    ctx.fillRect(sx + sw / 2 - w / 2, sy + sh / 2 - 1.5, w, 3);
  } else {
    // snow
    const frame = Math.floor(t * 14);
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = c === 0 ? ANT.light : ANT.base;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const w = 8 + hash01(frame + i, 50 + c) * 16;
        ctx.rect(sx + 5 + hash01(frame + i, 52 + c) * (sw - 10 - w), sy + 5 + hash01(frame + i, 54 + c) * (sh - 13), w, 3);
      }
      ctx.fill();
    }
    // somebody shows through while it winds up — the one it is calling; white on the strike
    if (wind > 0) {
      ctx.globalAlpha = A * Math.min(1, wind * 1.4);
      ctx.fillStyle = ANT.dark;
      ctx.beginPath();
      ctx.arc(sx + sw / 2, sy + sh * 0.38, sh * 0.2, 0, TAU);
      ctx.ellipse(sx + sw / 2, sy + sh, sw * 0.26, sh * 0.42, 0, Math.PI, TAU);
      ctx.fill();
      ctx.globalAlpha = A;
    }
    if (hit > 0) {
      ctx.globalAlpha = A * hit;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx + 3, sy + 3, sw - 6, sh - 6);
      ctx.globalAlpha = A;
    }
  }
  ctx.fillStyle = ANT.metal;
  ctx.beginPath();
  ctx.arc(-tvW / 2 + tvW * 0.14, -tvH + tvH * 0.28, tvW * 0.07, 0, TAU);
  ctx.moveTo(-tvW / 2 + tvW * 0.2, -tvH + tvH * 0.56);
  ctx.arc(-tvW / 2 + tvW * 0.14, -tvH + tvH * 0.56, tvW * 0.055, 0, TAU);
  ctx.rect(-tvW / 2 + tvW * 0.06, -tvH + tvH * 0.76, tvW * 0.16, 3);
  ctx.rect(-tvW / 2 + tvW * 0.06, -tvH + tvH * 0.86, tvW * 0.16, 3);
  ctx.fill();
  if (g > 0) {
    // smoke off the dead set
    ctx.fillStyle = '#9aa3ab';
    for (let i = 0; i < 3; i++) {
      const u = (t * 0.5 + i / 3) % 1;
      ctx.globalAlpha = A * g * 0.5 * Math.sin(u * Math.PI);
      ctx.beginPath();
      ctx.arc(tvW * 0.2 + Math.sin(u * 5 + i) * 7, -tvH - u * 46, 6 + u * 8, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = A;
  }
  ctx.restore();
  ctx.lineJoin = 'miter';
}

const ANTENNA_BODY: BossBody = { w: 2.4, h: 3, draw: drawAntenna, headY: f => f.fy - f.h * (f.pose === 'groggy' ? 0.62 : 0.98) };

function drawAntennaProps(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  // the last thing it said
  const a = (1 - o.retreat) * o.groggy;
  plaque(ctx, cam.sx(x + radius * 0.95), cam.sy(Math.max(y, 0)) - 58, 84, 26, '지지직…', '#0d0f12', '#f8f9fa', a * (0.6 + 0.4 * strobe(o.time, 9, 4, 0.7)), 0);
}

// ─────────────────────────── 대답하는 연필 (전장형의 핵: 종이에서 솟은 두 팔이 세워 잡은 연필) ───────────────────────────

const PEN = { base: '#ffd166', side: '#cca752', shine: '#ffe6ab', lead: '#1d1d1d', wood: '#e9c9a1', metal: '#b7bcc2', eraser: '#e5989b', red: '#c1121f', skin: '#e6e1d8', ink: '#3a2c0a', pool: '#17130f' };

function drawPencil(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const t = f.time;
  const W = f.w;
  const H = f.h;
  const x = f.fx;
  const y = f.fy;
  const A = alphaOf(ctx);
  const g = f.pose === 'groggy' ? f.p : 0;
  const wind = f.pose === 'windup' ? f.p : 0;
  const hit = f.pose === 'attack' ? Math.sin(f.p * Math.PI) : 0;
  const red = o.phase >= 2 || o.enraged;
  const L = H * 0.95;
  const pw = Math.max(16, W * 0.2);
  const wob = f.pose === 'walk' ? Math.sin(f.stride * TAU) * 0.07 : Math.sin(t * 1.3) * 0.03;
  const shiver = wind > 0 ? Math.sin(t * 44) * 0.02 * wind : 0;
  // it leans the way it writes; lifted and tipped further while it winds up; its lead snapped, it lies on the paper
  const ang = (0.2 + wob + 0.26 * wind + shiver + 0.3 * hit) * (1 - g) + 1.42 * g;
  const tipX = x + 6 * (1 - g) - L * 0.45 * g;
  const tipY = y - 16 * wind - 7 * g;
  const ux = Math.sin(ang);
  const uy = -Math.cos(ang);
  const h1 = L * 0.6;
  const h2 = L * 0.42;
  // where the two hands hold it (the rear one higher)
  const g1x = tipX + ux * h1 + uy * (pw / 2);
  const g1y = tipY + uy * h1 - ux * (pw / 2);
  const g2x = tipX + ux * h2 - uy * (pw / 2);
  const g2y = tipY + uy * h2 + ux * (pw / 2);
  const b1x = x - W * 0.5;
  const b2x = x + W * 0.62;

  // what its tip is doing on the paper: small circles, a hard stroke on the hit
  if (g <= 0) {
    ctx.globalAlpha = A * 0.7;
    ctx.strokeStyle = red ? PEN.red : PEN.lead;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x + 4, y, 11, 4.5, 0, 0, TAU);
    ctx.moveTo(x + 13, y + 1);
    ctx.ellipse(x + 6, y + 1, 7, 3, 0, 0, TAU);
    ctx.stroke();
    if (hit > 0) {
      ctx.globalAlpha = A * hit;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tipX, y - 1);
      ctx.lineTo(tipX + W * 0.95 * hit, y - 1);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.globalAlpha = A;
  }
  // the two arms come up out of the paper, each from its own blot of ink
  ctx.globalAlpha = A * 0.75;
  ctx.fillStyle = PEN.pool;
  ctx.beginPath();
  ctx.ellipse(b1x, y - 1, 15, 5.5, 0, 0, TAU);
  ctx.moveTo(b2x + 15, y - 1);
  ctx.ellipse(b2x, y - 1, 15, 5.5, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = A;
  limb(ctx, b1x, y - 2, g1x - 9, g1y + 6, -20 * (1 - g), 10, PEN.skin, PEN.ink);
  limb(ctx, b2x, y - 2, g2x + 9, g2y + 6, 20 * (1 - g), 10, PEN.skin, PEN.ink);

  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.rotate(ang);
  const top = -L + 17;
  const len = L - 17 - 30;
  ctx.fillStyle = tinted(PEN.base, o);
  ctx.fillRect(-pw / 2, top, pw, len);
  ctx.fillStyle = tinted(PEN.side, o);
  ctx.fillRect(-pw / 2, top, pw * 0.3, len);
  ctx.fillStyle = PEN.shine;
  ctx.fillRect(pw * 0.12, top, pw * 0.22, len);
  ctx.strokeStyle = PEN.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-pw / 2, top, pw, len);
  // the metal band and the chewed eraser
  ctx.fillStyle = PEN.eraser;
  ctx.fillRect(-pw / 2, -L, pw, 10);
  ctx.strokeRect(-pw / 2, -L, pw, 10);
  ctx.fillStyle = PEN.metal;
  ctx.fillRect(-pw / 2 - 1, -L + 9, pw + 2, 9);
  ctx.strokeRect(-pw / 2 - 1, -L + 9, pw + 2, 9);
  ctx.fillStyle = PEN.wood;
  ctx.beginPath();
  ctx.moveTo(-pw / 2, -30);
  ctx.lineTo(pw / 2, -30);
  ctx.lineTo(pw * 0.22, -11);
  ctx.lineTo(-pw * 0.22, -11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // the lead (snapped off when it is down)
  if (g < 0.5) {
    ctx.fillStyle = red ? PEN.red : PEN.lead;
    ctx.beginPath();
    ctx.moveTo(-pw * 0.22, -11);
    ctx.lineTo(pw * 0.22, -11);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
  }
  const grip = t * (1 - g) + wind * 3;
  hand(ctx, -pw / 2 + 2, -h1, 1, 15, grip, PEN.skin, g);
  hand(ctx, pw / 2 - 2, -h2, -1, 15, grip + 1.7, PEN.skin, g);
  ctx.restore();
  ctx.lineJoin = 'miter';

  if (g > 0) {
    // the broken lead on the page
    ctx.globalAlpha = A * g;
    ctx.fillStyle = PEN.lead;
    ctx.beginPath();
    ctx.moveTo(tipX - 26, y - 2);
    ctx.lineTo(tipX - 12, y - 8);
    ctx.lineTo(tipX - 14, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = A;
  }
}

const PENCIL_BODY: BossBody = { w: 1.7, h: 3.2, draw: drawPencil, headY: f => f.fy - f.h * (f.pose === 'groggy' ? 0.3 : 0.97) };

function drawPencilProps(ctx: Ctx, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  // the sound it made
  plaque(ctx, cam.sx(x - radius * 1.1), cam.sy(Math.max(y, 0)) - 44, 44, 28, '툭', '#f7efd2', PEN.lead, (1 - o.retreat) * o.groggy, -0.12);
}

// ── the paper: the whole arena floor (docs/bosses.md 5-2) ──

const PAPER = { base: '#d9cfae', edge: '#a8996c', grid: '#7fa2bd', ink: '#2b2420', red: '#a3121d', stain: '#8a6a3b', glow: '#fff6d6' };
const PAPER_FONTS = new Map<number, string>();
const paperFont = (px: number): string => {
  let s = PAPER_FONTS.get(px);
  if (!s) PAPER_FONTS.set(px, (s = `900 ${px}px sans-serif`));
  return s;
};

/** The words written on the paper (BossDef.stage.marks: where 대답 is safe) — read from the boss data, never copied. */
function paperMarks(): { x: number; y: number; r: number; label?: string }[] {
  try {
    return getBoss('answering_pencil').stage?.marks ?? [];
  } catch {
    return [];
  }
}

const PAPER_STAGE: BossStageLook = {
  tone: 'light',
  bake(g, B) {
    const ink = B.phase >= 2 ? PAPER.red : PAPER.ink;
    const flat = B.cellY / B.cellX;
    g.globalAlpha = 1;
    g.fillStyle = PAPER.base;
    g.fillRect(0, 0, B.wPx, B.hPx);
    // old stains
    g.fillStyle = PAPER.stain;
    g.globalAlpha = 0.07;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const sx = hash01(i, 201) * B.wPx;
      const sy = hash01(i, 202) * B.hPx;
      const r = B.cellX * (0.8 + hash01(i, 203) * 1.6);
      g.moveTo(sx + r, sy);
      g.ellipse(sx, sy, r, r * flat, 0, 0, TAU);
    }
    g.fill();
    // graph lines: one a cell, every fourth heavier
    g.strokeStyle = PAPER.grid;
    for (let pass = 0; pass < 2; pass++) {
      g.globalAlpha = pass === 0 ? 0.3 : 0.5;
      g.lineWidth = pass === 0 ? 1 : 2;
      g.beginPath();
      for (let cx = pass === 0 ? 1 : 4; cx * B.cellX < B.wPx - 1; cx += pass === 0 ? 1 : 4) {
        g.moveTo(cx * B.cellX, 0);
        g.lineTo(cx * B.cellX, B.hPx);
      }
      for (let cy = pass === 0 ? 1 : 4; cy * B.cellY < B.hPx - 1; cy += pass === 0 ? 1 : 4) {
        g.moveTo(0, cy * B.cellY);
        g.lineTo(B.wPx, cy * B.cellY);
      }
      g.stroke();
    }
    // the folds of a sheet kept in a pocket, and its worn edge
    g.strokeStyle = PAPER.edge;
    g.globalAlpha = 0.45;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(B.wPx / 2, 0);
    g.lineTo(B.wPx / 2, B.hPx);
    g.moveTo(0, B.hPx / 2);
    g.lineTo(B.wPx, B.hPx / 2);
    g.stroke();
    g.globalAlpha = 0.9;
    g.lineWidth = 6;
    g.strokeRect(3, 3, B.wPx - 6, B.hPx - 6);
    // the scribble in the middle, where the pencil went round and round before it answered
    g.strokeStyle = ink;
    g.globalAlpha = 0.28;
    g.lineWidth = 3;
    g.beginPath();
    for (let k = 0; k <= 90; k++) {
      const u = k / 90;
      const a = u * TAU * 4.5;
      const rr = B.cellX * (0.3 + 1.5 * u) * (1 + 0.08 * Math.sin(a * 3.1));
      const px = B.wPx / 2 + Math.cos(a) * rr;
      const py = B.hPx / 2 + Math.sin(a) * rr * flat;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    // the rows a 분신사바 sheet has: consonants along the top, numbers along the bottom
    g.fillStyle = ink;
    g.globalAlpha = 0.4;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = paperFont(Math.round(B.cellX * 0.62));
    const rows: [string, number][] = [['ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ', 1.05], ['1234567890', 11]];
    for (const [text, row] of rows) {
      const gap = B.cellX * 0.95;
      for (let i = 0; i < text.length; i++) {
        g.save();
        g.translate(B.wPx / 2 + (i - (text.length - 1) / 2) * gap, row * B.cellY);
        g.scale(1, flat);
        g.fillText(text[i], 0, 0);
        g.restore();
      }
    }
    // 「예」 and 「아니오」: each in its ring — the only safe ground when the paper is blacked out (대답)
    for (const m of paperMarks()) {
      const mx = m.x * B.cellX;
      const my = m.y * B.cellY;
      g.beginPath();
      g.ellipse(mx, my, m.r * B.cellX, m.r * B.cellY, 0, 0, TAU);
      g.globalAlpha = 0.3;
      g.fillStyle = PAPER.glow;
      g.fill();
      g.globalAlpha = 0.75;
      g.strokeStyle = ink;
      g.lineWidth = 5;
      g.stroke();
      const label = m.label ?? '';
      if (label.length === 0) continue;
      g.save();
      g.translate(mx, my);
      g.scale(1, flat);
      g.globalAlpha = 0.9;
      g.fillStyle = ink;
      g.font = paperFont(Math.round((Math.min(2.5, (m.r * 1.55) / label.length) + 0.25) * B.cellX));
      g.fillText(label, 0, 4);
      g.restore();
    }
    g.globalAlpha = 1;
  },
};

// ─────────────────────────── 거꾸로 뜬 달 (전장형의 핵: 젖은 옥상 바닥에 비친 납작한 달) ───────────────────────────

const MOON = { base: '#f1faee', rim: '#9da39b', pit: '#d2dacf', blood: '#ff7b7b', bloodRim: '#ffe3e3', bloodPit: '#d9434a', red: '#d00000', dark: '#12060a', halo: '#fff3c4', bloodHalo: '#ff5d5d', face: '#4b4a5a', faceRed: '#4a0006' };
/** Small craters (x, y, r as fractions of the radius) — the face itself is drawn apart. */
const CRATERS = [-0.55, -0.2, 0.16, 0.5, 0.38, 0.12, 0.62, -0.42, 0.1, -0.3, 0.66, 0.09, -0.1, -0.7, 0.07];

/**
 * The moon's disc and its face — upside down: the smile on top, the eye pits below. squash = how flat it lies (1 = the
 * round one in the sky), turn = radians it is turned (π = the right way up: knocked down), eye = 0..1 how far the one
 * upright eye is open (< 0 = a shut slit, the sky's moon), dark = 0..1 the eclipse creeping in from the rim, craters =
 * how many of the small ones (the sky's moon is small: fewer).
 */
function moonDisc(ctx: Ctx, cx: number, cy: number, r: number, squash: number, red: boolean, fill: string, turn: number, eye: number, dark: number, A: number, craters = CRATERS.length / 3): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, squash);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // (the red moon keeps a pale rim: it must be found under the red of a 월식 warning too)
  ctx.strokeStyle = red ? MOON.bloodRim : MOON.rim;
  ctx.lineWidth = red ? 4.5 : 3;
  ctx.stroke();
  ctx.rotate(turn);
  ctx.fillStyle = red ? MOON.bloodPit : MOON.pit;
  ctx.beginPath();
  for (let i = 0; i < craters * 3; i += 3) {
    ctx.moveTo((CRATERS[i] + CRATERS[i + 2]) * r, CRATERS[i + 1] * r);
    ctx.arc(CRATERS[i] * r, CRATERS[i + 1] * r, CRATERS[i + 2] * r, 0, TAU);
  }
  ctx.fill();
  const face = red ? MOON.faceRed : MOON.face;
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(-r * 0.44, r * 0.42, r * 0.17, r * 0.14, 0, 0, TAU);
  ctx.moveTo(r * 0.61, r * 0.42);
  ctx.ellipse(r * 0.44, r * 0.42, r * 0.17, r * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = face;
  ctx.lineWidth = r * 0.11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, -r * 0.02, r * 0.62, Math.PI * 1.17, Math.PI * 1.83);
  ctx.stroke();
  if (dark > 0) {
    // 월식: the dark comes in from the rim; a red edge stays
    ctx.lineCap = 'butt';
    ctx.globalAlpha = A * 0.9;
    ctx.strokeStyle = MOON.dark;
    ctx.lineWidth = r * 0.8 * dark;
    ctx.beginPath();
    ctx.arc(0, 0, r - r * 0.4 * dark, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = A * dark;
    ctx.strokeStyle = MOON.red;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = A;
  }
  if (eye >= 0) {
    // the one upright eye in the middle (it stays lit through the eclipse; shut when it is down)
    ctx.rotate(Math.PI / 2 - turn);
    bigEye(ctx, 0, 0, r * 0.28, 0, 0, red || dark > 0.3, A, eye);
  } else {
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.22);
    ctx.lineTo(0, r * 0.22);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.restore();
}

function drawMoonBody(ctx: Ctx, f: BossBodyFrame, o: BossDrawOpts): void {
  const t = f.time;
  const A = alphaOf(ctx);
  const g = f.pose === 'groggy' ? f.p : 0;
  const wind = f.pose === 'windup' ? f.p : 0;
  const red = o.phase >= 2 || o.enraged;
  const cx = f.fx;
  // a reflection drifts, it does not step: undo the walk bob the shared frame adds (body.ts: −|sin(stride)| × 5)
  const cy = f.fy + (f.pose === 'walk' ? Math.abs(Math.sin(f.stride * TAU)) * 5 : 0);
  const rx = f.w / 2 - 3;
  const ry = f.h / 2 - 2;

  // moonlight pooling on the wet roof around it
  ctx.fillStyle = red ? MOON.bloodHalo : MOON.halo;
  for (let i = 0; i < 2; i++) {
    ctx.globalAlpha = A * (0.12 + 0.1 * i) * (1 - 0.6 * g);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (1.34 - 0.16 * i), ry * (1.34 - 0.16 * i), 0, 0, TAU);
    ctx.fill();
  }
  // slow ripples running out from it (it is water it lies in)
  ctx.strokeStyle = red ? MOON.bloodHalo : MOON.base;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 2; i++) {
    const u = (t * 0.35 + i * 0.5) % 1;
    ctx.globalAlpha = A * 0.4 * (1 - u) * (1 - g);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (1.06 + 0.5 * u), ry * (1.06 + 0.5 * u), 0, 0.4 + i * 2.6, 2.3 + i * 2.6);
    ctx.stroke();
  }
  ctx.globalAlpha = A * 0.95;
  const open = g > 0 ? Math.max(0, 0.6 - g) : f.pose === 'attack' ? 1.1 : blink(t, 2);
  moonDisc(ctx, cx, cy, rx, ry / rx, red, tinted(red ? MOON.blood : MOON.base, o), swayAngle(t, 0.7, 0.06) * (1 - g) + Math.PI * g, open, wind, A * 0.95);
  ctx.globalAlpha = A;
}

const MOON_BODY: BossBody = { w: 3.6, h: 1.95, draw: drawMoonBody, flat: true };

// ── the roof at night: the whole arena floor, and the real moon in the sky (docs/bosses.md 5-2) ──

/** Where the sky's moon hangs: over the railing, in the strip between the HUD row and the arena (px right of the arena's middle, screen y). */
const SKY_MOON = { dx: 318, y: 122, r: 30 };

const MOON_STAGE: BossStageLook = {
  tone: 'dark',
  bake(g, B) {
    const red = B.phase >= 2;
    const flat = B.cellY / B.cellX;
    // night over the whole roof (the warnings light it: 월식 leaves only the moonlit circle bright)
    g.globalAlpha = 0.45;
    g.fillStyle = '#04050d';
    g.fillRect(0, 0, B.wPx, B.hPx);
    if (red) {
      g.globalAlpha = 0.2;
      g.fillStyle = '#5a0010';
      g.fillRect(0, 0, B.wPx, B.hPx);
    }
    // rain water standing on the roof catches a little light
    g.globalAlpha = 0.07;
    g.fillStyle = red ? '#ff8a8a' : '#dfe9f5';
    g.beginPath();
    for (let i = 0; i < 11; i++) {
      const sx = hash01(i, 301) * B.wPx;
      const sy = hash01(i, 302) * B.hPx;
      const r = B.cellX * (0.9 + hash01(i, 303) * 1.5);
      g.moveTo(sx + r, sy);
      g.ellipse(sx, sy, r, r * flat * 0.8, 0, 0, TAU);
    }
    g.fill();
    g.globalAlpha = 1;
  },
  live(ctx, cam, o, time) {
    // the moon itself, upside down in a red sky — an ornament: what the party fights is its reflection on the roof
    const A = alphaOf(ctx);
    const red = o.phase >= 2 || o.enraged;
    const mx = cam.sx(12) + SKY_MOON.dx;
    const my = SKY_MOON.y + Math.sin(time * 0.9) * 2;
    ctx.fillStyle = red ? '#7a0014' : '#6a0012';
    ctx.globalAlpha = A * 0.45;
    ctx.beginPath();
    ctx.arc(mx, my, SKY_MOON.r * 1.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = A;
    moonDisc(ctx, mx, my, SKY_MOON.r, 1, red, red ? MOON.blood : MOON.base, swayAngle(time, 0.7, 0.05) + Math.PI * o.groggy, -1, o.groggy > 0 ? 0 : o.charge, A, 3);
    ctx.globalAlpha = A;
  },
};

/** Boss id → look. A moving boss's `draw` is its body as a set piece (the sheet tools and the look tests draw through it). */
export const ROOFTOP_LOOKS: Record<string, BossLook> = {
  tank_dweller: { draw: asSetPiece(DWELLER_BODY), body: DWELLER_BODY, color: TANK.base, props: drawDwellerProps },
  thunder_antenna: { draw: asSetPiece(ANTENNA_BODY), body: ANTENNA_BODY, color: ANT.base, props: drawAntennaProps, veil: 'storm' },
  answering_pencil: { draw: asSetPiece(PENCIL_BODY), body: PENCIL_BODY, stage: PAPER_STAGE, color: PEN.base, props: drawPencilProps, veil: 'ink' },
  inverted_moon: { draw: asSetPiece(MOON_BODY), body: MOON_BODY, stage: MOON_STAGE, color: MOON.base, veil: 'moon' },
};

/** Skill id → the small extra on its warning (pull / push / linger / spawn; docs/bosses.md 3장). */
export const ROOFTOP_TELE_MOTIF: Record<string, TeleMotif> = {
  td_hair: 'pull',
  td_hug: 'pull',
  td_dive: 'linger',
  td_umbrellas: 'spawn',
};

/** MonsterDef.look → the body of this zone's summon-only units (none: the rooftop bosses call existing monsters). */
export const ROOFTOP_MINION_LOOKS: Record<string, CreatureDrawFn> = {};

/** 기획 20차: Zone.look → fill / edge of this zone's trail zones. graphite = the line 긋기 leaves on the paper. */
export const ROOFTOP_ZONE_LOOKS: Record<string, ZoneLook> = {
  graphite: { fill: '#26221f', edge: '#ff3b4d' },
};
