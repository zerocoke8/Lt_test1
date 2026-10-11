// 기획 20차 보스 형태 (docs/bosses.md 5-1): the shared frame of a MOVING boss body (roaming, relocating, an arena boss's
// core). A zone file only draws its body "facing right, standing in a box" (BossLook.body); everything every body
// shares lives here — picking the pose, mirroring with a little hysteresis, the walk bob, the wind-up swell, the groggy
// tilt and wash, the enrage aura, rising in / sinking away, the shadow with the red boss ring, the guard arcs and the ▼.
// A moving boss without a body yet is drawn as a blob in its colour with one eye (the 기획 20차 stubs).
// Fixed bosses never come here: boss.ts draws their set pieces exactly as before.

import type { BossDef, BossForm, Entity } from '../../types';
import { getBoss } from '../../data';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { darken, lighten, mix } from '../look';
import { TAU } from '../shapes';
import type { BossBody, BossBodyFrame, BossDrawFn, BossDrawOpts, BossPose } from './types';
import { bossLook } from './index';

const formCache = new Map<string, BossForm>();

/** The form of a boss by id ('fixed' for the classic four, for unknown ids and for anything that is not a boss). */
export function bossFormOf(defId: string): BossForm {
  let f = formCache.get(defId);
  if (f) return f;
  try {
    f = getBoss(defId).form ?? 'fixed';
  } catch {
    f = 'fixed';
  }
  formCache.set(defId, f);
  return f;
}

/** Is this boss drawn as a body inside the arena (not as the top-centre set piece)? */
export function isMovingBoss(defId: string): boolean {
  return bossFormOf(defId) !== 'fixed';
}

function defOf(defId: string): BossDef | null {
  try {
    return getBoss(defId);
  } catch {
    return null;
  }
}

// ─────────────────────────── fallback body ───────────────────────────

/** A boss-colour blob with one eye: what a moving boss looks like until its zone file gives it a body. */
function fallbackDraw(ctx: CanvasRenderingContext2D, f: BossBodyFrame, o: BossDrawOpts): void {
  const base = o.enraged ? mix(o.color, '#ff0033', 0.3) : o.color;
  const squash = f.pose === 'groggy' ? 1 - 0.25 * f.p : f.pose === 'windup' ? 1 + 0.06 * f.p : 1;
  const h = f.h * squash;
  const cx = f.fx;
  const cy = f.fy - h / 2;
  ctx.fillStyle = darken(base, 0.45);
  ctx.beginPath();
  ctx.ellipse(cx, cy, f.w / 2, h / 2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h * 0.05, f.w * 0.44, h * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#14101a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, f.w / 2, h / 2, 0, 0, TAU);
  ctx.stroke();
  // one eye toward where it faces (the canvas is already mirrored: +x = ahead)
  const ex = cx + f.w * 0.16;
  const ey = cy - h * 0.1;
  const er = Math.max(7, f.w * 0.13);
  const open = f.pose === 'groggy' ? 0.18 : f.pose === 'windup' ? 1.15 : 1;
  ctx.fillStyle = '#120818';
  ctx.beginPath();
  ctx.ellipse(ex, ey, er + 3, er * open + 3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.pose === 'windup' ? '#ffe066' : '#f6f0d8';
  ctx.beginPath();
  ctx.ellipse(ex, ey, er, er * open, 0, 0, TAU);
  ctx.fill();
  if (open > 0.3) {
    ctx.fillStyle = o.enraged ? '#ff1a1a' : '#14101a';
    ctx.beginPath();
    ctx.arc(ex + er * 0.3, ey, er * 0.42, 0, TAU);
    ctx.fill();
  }
  // two stub feet that step with the stride
  const step = f.pose === 'walk' ? Math.sin(f.stride * TAU) * f.w * 0.07 : 0;
  ctx.fillStyle = darken(base, 0.6);
  ctx.beginPath();
  ctx.ellipse(cx - f.w * 0.2 + step, f.fy - 3, f.w * 0.12, 6, 0, 0, TAU);
  ctx.ellipse(cx + f.w * 0.2 - step, f.fy - 3, f.w * 0.12, 6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = lighten(base, 0.35);
  ctx.globalAlpha *= 0.5;
  ctx.beginPath();
  ctx.ellipse(cx - f.w * 0.16, cy - h * 0.26, f.w * 0.14, h * 0.07, -0.3, 0, TAU);
  ctx.fill();
}

const fallbacks = new Map<string, BossBody>();

function fallbackBody(defId: string): BossBody {
  let b = fallbacks.get(defId);
  if (!b) {
    const r = defOf(defId)?.radius ?? 1.5;
    b = { w: r * 1.85, h: r * 1.7, draw: fallbackDraw };
    fallbacks.set(defId, b);
  }
  return b;
}

/** 기획 20차 점검 (가짜 찾기): the fakes a boss leaves and how long it hides among them after a jump (BossDef.decoy). */
export function bossDecoy(defId: string): BossDef['decoy'] | null {
  return defOf(defId)?.decoy ?? null;
}

/** The body of a moving boss: its look's, else the fallback blob sized from its radius. */
export function bossBody(defId: string): BossBody {
  return bossLook(defId)?.body ?? fallbackBody(defId);
}

// ─────────────────────────── pose ───────────────────────────

/** The pose of a boss entity this frame; `groggy` = 0..1 how far down the boss art is (GroggyFx.pose). */
export function pickPose(anim: Entity['anim'], groggy: number): BossPose {
  if (groggy > 0.01 || anim === 'stunned') return 'groggy';
  if (anim === 'cast') return 'windup';
  if (anim === 'attack') return 'attack';
  if (anim === 'move') return 'walk';
  return 'idle';
}

/** Per-boss animation memory of the shared frame (the renderer keeps one per boss entity). */
export interface BossBodyAnim {
  side: -1 | 1;
  /** Seconds until it may mirror again (no flicker when it faces almost straight up / down). */
  flipLock: number;
  stride: number;
  lastX: number;
  lastY: number;
  /** Seconds since it appeared / arrived / finished a rush (the ▼ is bright for a moment). */
  sinceArrive: number;
}

export function newBodyAnim(x: number, y: number, facing: number): BossBodyAnim {
  return { side: Math.cos(facing) >= 0 ? 1 : -1, flipLock: 0, stride: 0, lastX: x, lastY: y, sinceArrive: 0 };
}

/** Seconds a body keeps its side after mirroring. */
const FLIP_HOLD = 0.25;
/** Cells walked per walk cycle. */
const STRIDE_CELLS = 1.3;
/** A step longer than this in one frame is a teleport (relocate, blink, rush): no stride from it. */
const JUMP = 1.5;

/** Advance the animation memory by one frame (call once per frame, before drawing). */
export function stepBodyAnim(a: BossBodyAnim, x: number, y: number, facing: number, dt: number): void {
  a.flipLock = Math.max(0, a.flipLock - dt);
  a.sinceArrive += dt;
  const c = Math.cos(facing);
  const want = c >= 0 ? 1 : -1;
  if (want !== a.side && a.flipLock <= 0 && Math.abs(c) > 0.18) {
    a.side = want;
    a.flipLock = FLIP_HOLD;
  }
  const moved = Math.hypot(x - a.lastX, y - a.lastY);
  if (moved >= JUMP) a.sinceArrive = 0;
  else if (moved > 0) a.stride = (a.stride + moved / STRIDE_CELLS) % 1;
  a.lastX = x;
  a.lastY = y;
}

/** The body box of a boss in px. */
export function bodyBox(defId: string): { w: number; h: number } {
  const b = bossBody(defId);
  return { w: b.w * PX_PER_UNIT, h: b.h * PX_PER_UNIT };
}

// ─────────────────────────── ground pass ───────────────────────────

const RING_OUT = '#5a0010';
const RING_IN = '#ff3b4d';

/**
 * Under a moving body: a dark shadow and the boss ring (two red lines at radius × 1.2) — and, for a boss with a front
 * shield (BossDef.guard), a steel-blue arc where it is shielded and a dashed gold arc where it is weak.
 */
export function drawBossBodyGround(ctx: CanvasRenderingContext2D, cam: Camera, defId: string, x: number, y: number, radius: number, facing: number, alpha: number, time: number): void {
  if (alpha <= 0) return;
  const sx = cam.sx(x);
  const sy = cam.sy(y);
  ctx.globalAlpha = 0.45 * alpha;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(sx, sy, radius * PX_PER_UNIT, radius * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.fill();
  const r = radius * 1.2;
  ctx.globalAlpha = 0.85 * alpha;
  ctx.lineWidth = 5;
  ctx.strokeStyle = RING_OUT;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = RING_IN;
  ctx.stroke();
  const guard = defOf(defId)?.guard;
  if (guard) {
    const R = radius * 1.5;
    guardArc(ctx, cam, x, y, R, facing, guard.frontArc, '#9db4c8', 6, false, alpha);
    guardArc(ctx, cam, x, y, R, facing + Math.PI, guard.backArc, '#ffd166', 5, true, alpha * (0.75 + 0.25 * Math.sin(time * 6)));
  }
  ctx.globalAlpha = 1;
}

const GUARD_DASH = [9, 7];
const NO_DASH: number[] = [];

/** An arc of `arcDeg` degrees around the world direction `mid` (radians), on the ground. */
function guardArc(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, R: number, mid: number, arcDeg: number, color: string, width: number, dashed: boolean, alpha: number): void {
  const half = (arcDeg * Math.PI) / 360;
  ctx.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = mid - half + (2 * half * i) / 14;
    const px = cam.sx(x + Math.cos(a) * R);
    const py = cam.sy(y + Math.sin(a) * R);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = '#0b0d14';
  ctx.stroke();
  if (dashed) ctx.setLineDash(GUARD_DASH);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineCap = 'butt';
}

// ─────────────────────────── the body ───────────────────────────

export interface BossBodyDraw {
  defId: string;
  /** Where it is drawn (world; the renderer has already added a dash streak's offset). */
  x: number;
  y: number;
  facing: number;
  pose: BossPose;
  /** 0..1 through the pose. */
  p: number;
  /** 0..1 rising in (floor start, arrival on a seat); 1 = fully there. */
  rise: number;
  clone?: boolean;
}

const FRAME: BossBodyFrame = { fx: 0, fy: 0, w: 0, h: 0, s: 1, pose: 'idle', p: 0, stride: 0, time: 0, facing: 0 };

/**
 * Draws a moving body: mirrored to its side, bobbing while it walks, swelling through a wind-up, tilted and washed out
 * while groggy, with the enrage aura, rising in and sinking away (o.retreat). The body's own draw function sees a box
 * it stands in and always draws facing right.
 */
export function drawBossBody(ctx: CanvasRenderingContext2D, cam: Camera, a: BossBodyAnim, d: BossBodyDraw, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const body = bossBody(d.defId);
  const w = body.w * PX_PER_UNIT;
  const h = body.h * PX_PER_UNIT;
  const fx = cam.sx(d.x) + (o.shake > 0 ? Math.sin(o.time * 61) * 4 * o.shake : 0);
  const g = o.groggy;
  const tremble = g <= 0 && o.groggyNear > 0 && o.retreat <= 0 ? Math.sin(o.time * 52) * (o.groggyNear >= 2 ? 3 : 2) : 0;
  const bob = d.pose === 'walk' ? -Math.abs(Math.sin(a.stride * TAU)) * 5 : d.pose === 'idle' ? Math.sin(o.time * 2.2) * 1.5 : 0;
  // rising in from the floor / sinking away: the body is clipped at its foot line
  const sunk = Math.max(o.retreat, 1 - Math.max(0, Math.min(1, d.rise)));
  const fy = cam.sy(d.y);
  const alpha = 1 - o.retreat;
  ctx.save();
  if (!body.flat && sunk > 0) {
    ctx.beginPath();
    ctx.rect(fx - w, fy - h * 1.6, w * 2, h * 1.6 + 4);
    ctx.clip();
  }
  ctx.translate(fx + tremble, fy + (body.flat ? 0 : sunk * h));
  if (!body.flat) {
    if (g > 0) ctx.rotate(0.1 * g * a.side);
    if (d.pose === 'windup') ctx.scale(1 + 0.04 * Math.sin(d.p * Math.PI), 1 + 0.07 * d.p);
  }
  ctx.scale(a.side, 1);
  ctx.globalAlpha = alpha;
  if (o.enraged && !body.flat) {
    // the aura sits behind the body, so only the body's own art needs to read o.enraged
    ctx.globalAlpha = alpha * (0.16 + 0.12 * (0.5 + 0.5 * Math.sin(o.time * 6)));
    ctx.fillStyle = '#ff1f3d';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.5, w * 0.68, h * 0.66, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  const f = FRAME;
  f.fx = 0;
  f.fy = bob;
  f.w = w;
  f.h = h;
  f.s = a.side;
  f.pose = d.pose;
  f.p = Math.max(0, Math.min(1, d.pose === 'groggy' ? g : d.p));
  f.stride = a.stride;
  f.time = o.time;
  f.facing = d.facing;
  f.clone = d.clone;
  body.draw(ctx, f, o);
  ctx.globalAlpha = 1;
  if (g > 0) {
    // washed out while it is down — over the body box only
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.35 * g * alpha;
    ctx.fillStyle = '#808080';
    ctx.fillRect(-w * 0.55, -h * 1.05, w * 1.1, h * 1.1);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (o.flash > 0 || o.phaseFlash > 0) {
    ctx.globalAlpha = alpha * Math.max(0.35 * o.flash, 0.7 * o.phaseFlash);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.5, w * 0.5, h * 0.52, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Screen y of a body's head (groggy stars, the ▼): its look's own, else the top of its box. */
export function bossHeadY(cam: Camera, defId: string, y: number): number {
  const body = bossBody(defId);
  const h = body.h * PX_PER_UNIT;
  if (body.flat) return cam.sy(y) - 30;
  if (body.headY) {
    FRAME.fx = 0;
    FRAME.fy = cam.sy(y);
    FRAME.w = body.w * PX_PER_UNIT;
    FRAME.h = h;
    return body.headY(FRAME);
  }
  return cam.sy(y) - h;
}

/** The ▼ over a moving boss: bright right after it appeared / arrived / rushed (and while a card is dragged), else faint. */
export function drawBossOverhead(ctx: CanvasRenderingContext2D, cam: Camera, defId: string, x: number, y: number, strong: boolean, time: number, alpha: number): void {
  if (alpha <= 0) return;
  const sx = cam.sx(x);
  const top = bossHeadY(cam, defId, y) - 16 + Math.sin(time * 5) * (strong ? 3 : 1.5);
  ctx.globalAlpha = (strong ? 1 : 0.4) * alpha;
  ctx.beginPath();
  ctx.moveTo(sx - 13, top - 16);
  ctx.lineTo(sx + 13, top - 16);
  ctx.lineTo(sx, top);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1a0006';
  ctx.stroke();
  ctx.fillStyle = RING_IN;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ─────────────────────────── a body as a set piece ───────────────────────────

/**
 * BossLook.draw for a moving boss: the body standing at (x, y), facing right — idle, winding up when o.charge is high,
 * down when o.groggy is. The sheet tools (tests/visual) and the look tests draw every boss through `draw`; in the game
 * a moving boss is drawn by drawBossBody instead.
 */
export function asSetPiece(body: BossBody): BossDrawFn {
  return (ctx, cam, x, y, _radius, o) => {
    if (o.retreat >= 1) return;
    const w = body.w * PX_PER_UNIT;
    const h = body.h * PX_PER_UNIT;
    const pose: BossPose = o.groggy > 0.5 ? 'groggy' : o.charge > 0.5 ? 'windup' : 'idle';
    ctx.save();
    // a set piece's spot (12, −1.2) is above the arena: stand the body on the arena's back edge instead
    ctx.translate(cam.sx(x), cam.sy(Math.max(y, 0)) + (y < 0 ? h * 0.6 : 0) + o.retreat * h);
    ctx.globalAlpha = 1 - o.retreat;
    const f: BossBodyFrame = { fx: 0, fy: 0, w, h, s: 1, pose, p: pose === 'groggy' ? o.groggy : o.charge, stride: 0, time: o.time, facing: 0 };
    body.draw(ctx, f, o);
    ctx.restore();
    ctx.globalAlpha = 1;
  };
}
