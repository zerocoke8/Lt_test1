// The floor bosses: giant procedural set pieces looming above the arena's back edge. 심연의 감시자 (eye + tentacles,
// the 20층 rooftop boss) lives here; the 기획 8차 bosses are in bosses.ts. drawBossArt routes by boss id.

import { Camera, PX_PER_UNIT } from './camera';
import { darken, lighten, mix } from './look';
import { TAU, hash01 } from './shapes';
import { BOSS_DROP, drawElevatorKeeper, drawOvertimeLord, drawSurgeonDirector } from './bosses';
import { beginGroggyPose, endGroggyPose, drawGroggyProps } from './bossGroggy';
import { getBoss } from '../data';

export interface BossDrawOpts {
  color: string;
  time: number;
  enraged: boolean;
  /** 0..1 hit flash strength. */
  flash: number;
  /** 0 = present, 1 = fully retreated (sunk into the abyss). */
  retreat: number;
  /** World point the eyes look at (current target), or null. */
  lookX: number | null;
  lookY: number | null;
  /** 0..1 strength of the casting/attack glow. */
  charge: number;
  /** 0..1 enrage-moment shake strength. */
  shake: number;
  /** 기획 8차: current phase (1 = start; each crossed HP threshold +1). */
  phase: number;
  /** 0..1 flash right after a phase change. */
  phaseFlash: number;
  /** 기획 13차 그로기: 0..1 how far down the boss is (eases in over 0.25 s, back up over 0.8 s). */
  groggy: number;
  /** 기획 13차: 0..1 progress of standing up again (0 = not standing up). */
  groggyWake: number;
  /** 기획 13차: the gauge is almost full — 0 no, 1 (≥ 80 %), 2 (≥ 90 %): the art trembles. */
  groggyNear: number;
}

/** Phase from HP vs the boss's thresholds (robust to joining mid-fight; the 'bossPhase' event only adds the flash). */
export function bossPhaseOf(defId: string, hp: number, maxHp: number): number {
  let phases: { hpBelow: number }[] | undefined;
  try {
    phases = getBoss(defId).phases;
  } catch {
    return 1;
  }
  if (!phases || maxHp <= 0) return 1;
  let n = 1;
  for (const ph of phases) if (hp < ph.hpBelow * maxHp - 1e-9) n++;
  return n;
}

/**
 * Draws the boss set piece for `defId` (unknown ids get the watcher). 기획 13차 그로기: the shared knocked-down base
 * (sunk 14 px, tilted 6°, 35 % washed out, big stun stars) and the 'almost full' tremble wrap the boss's own pose
 * (bossGroggy.ts adds the props: 점검중 sign, Zzz, flat ECG …).
 */
export function drawBossArt(ctx: CanvasRenderingContext2D, cam: Camera, defId: string, x: number, y: number, radius: number, o: BossDrawOpts): void {
  const posed = beginGroggyPose(ctx, cam, x, y, o);
  drawBossPiece(ctx, cam, defId, x, y, radius, o);
  if (posed) endGroggyPose(ctx, cam, x, y, radius, o);
  drawGroggyProps(ctx, cam, defId, x, y, radius, o);
}

function drawBossPiece(ctx: CanvasRenderingContext2D, cam: Camera, defId: string, x: number, y: number, radius: number, o: BossDrawOpts): void {
  switch (defId) {
    case 'elevator_keeper':
      drawElevatorKeeper(ctx, cam, x, y, radius, o);
      return;
    case 'overtime_lord':
      drawOvertimeLord(ctx, cam, x, y, radius, o);
      return;
    case 'surgeon_director':
      drawSurgeonDirector(ctx, cam, x, y, radius, o);
      return;
    default:
      drawBoss(ctx, cam, x, y, radius, o);
  }
}

const TENTACLE_ANGLES = [0.12, 0.27, 0.4, 0.6, 0.73, 0.88];
const SEGS = 9;
const SMALL_EYES: [number, number, number][] = [
  [-0.62, -0.32, 0.075],
  [0.62, -0.32, 0.075],
  [-0.38, -0.62, 0.06],
  [0.38, -0.62, 0.06],
];

/** Shadow of the boss mass on the arena's back edge (ground layer). */
export function drawBossShadow(ctx: CanvasRenderingContext2D, cam: Camera, x: number, radius: number, retreat: number): void {
  ctx.globalAlpha = 0.45 * (1 - retreat);
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cam.sx(x), cam.sy(0) + 6, radius * PX_PER_UNIT * 1.1, 30, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawBoss(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.retreat >= 1) return;
  const t = o.time;
  const shakeX = o.shake > 0 ? Math.sin(t * 61) * 6 * o.shake : 0;
  const cx = cam.sx(x) + shakeX;
  const breathe = Math.sin(t * 1.4) * 4;
  // Sits low enough that the big eye clears the top-centre HUD boss panel (logical y ≈ 8–95, 기획 8차 리뷰: +BOSS_DROP).
  const cy = cam.sy(y) - 14 + BOSS_DROP + breathe - o.retreat * 250;
  const rx = radius * PX_PER_UNIT * 0.95;
  const ry = radius * PX_PER_UNIT * 0.55;
  const alpha = 1 - o.retreat;
  let base = o.color;
  if (o.phase > 1) base = mix(base, '#c4106a', 0.16 * (o.phase - 1));
  if (o.enraged) base = mix(base, '#ff0033', 0.35);
  const dark = darken(base, 0.45);
  const darker = darken(base, 0.7);
  const light = lighten(base, 0.3);
  const speed = o.enraged ? 2.6 : o.phase >= 3 ? 2.2 : o.phase === 2 ? 1.8 : 1.5;
  ctx.globalAlpha = alpha;

  // the rift halo behind it (rooftop sky tears open wider each phase)
  {
    const p = 0.5 + 0.5 * Math.sin(t * 1.7);
    const hr = 1.25 + 0.12 * (o.phase - 1) + 0.04 * p;
    // 기획 13차: knocked down, the rift halo dims to 30 %
    ctx.globalAlpha = alpha * (0.1 + 0.05 * o.phase) * (1 - 0.7 * o.groggy);
    ctx.fillStyle = o.phase >= 3 ? '#ff4fa3' : '#9d4edd';
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.1, rx * hr, ry * (hr + 0.25), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }

  // aura
  if (o.enraged) {
    const p = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.globalAlpha = alpha * (0.18 + 0.18 * p);
    ctx.fillStyle = '#ff1f3d';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (1.25 + 0.06 * p), ry * (1.45 + 0.08 * p), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  } else if (o.charge > 0) {
    ctx.globalAlpha = alpha * 0.22 * o.charge;
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.2, ry * 1.4, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }

  // tentacles (behind the body)
  ctx.lineCap = 'round';
  for (let i = 0; i < TENTACLE_ANGLES.length; i++) {
    const a = TENTACLE_ANGLES[i] * Math.PI;
    let px = cx + Math.cos(a) * rx * 0.82;
    let py = cy + Math.sin(a) * ry * 0.7;
    // 기획 13차: knocked down, the tentacles hang limp to the floor
    const g = o.groggy;
    const dirA = (a * 0.55 + (Math.PI / 2) * 0.45) * (1 - g * 0.8) + (Math.PI / 2) * g * 0.8;
    const len = (150 + hash01(i, 3) * 70) * (1 - o.retreat * 0.6) * (1 + 0.25 * g);
    const segLen = len / SEGS;
    let ang = dirA;
    for (let k = 0; k < SEGS; k++) {
      const u = k / SEGS;
      const sway = Math.sin(t * speed + i * 1.37 + u * 3.2) * (0.18 + u * 0.35);
      const curl = (i < 3 ? -1 : 1) * u * u * 0.9;
      ang = dirA + (sway + curl) * (1 - g * 0.85);
      const nx = px + Math.cos(ang) * segLen;
      const ny = py + Math.sin(ang) * segLen * 0.75;
      ctx.lineWidth = 26 * (1 - u) + 4;
      ctx.strokeStyle = k % 2 === 0 ? dark : darker;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      if (k % 2 === 1 && k < SEGS - 1) {
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc((px + nx) / 2, (py + ny) / 2, Math.max(1.5, 4 * (1 - u)), 0, TAU);
        ctx.fill();
      }
      if (o.phase >= 2 && k === 4 && i % 2 === 0) {
        // phase 2+: eyes open along the tentacles
        const open = eyeOpen(t, i + 7);
        ctx.fillStyle = '#120818';
        ctx.beginPath();
        ctx.ellipse(nx, ny, 9, 7, 0, 0, TAU);
        ctx.fill();
        if (open > 0.3) {
          ctx.fillStyle = '#f6f0d8';
          ctx.beginPath();
          ctx.ellipse(nx, ny, 7, 5 * open, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = o.phase >= 3 ? '#ff1a1a' : '#ff5d5d';
          ctx.beginPath();
          ctx.arc(nx, ny, 3, 0, TAU);
          ctx.fill();
        }
      }
      px = nx;
      py = ny;
    }
    // sucker tip curling at the end
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, TAU);
    ctx.fill();
  }
  ctx.lineCap = 'butt';

  // spikes on top
  ctx.fillStyle = darker;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + ((i + 0.5) / 7) * Math.PI;
    const bx = cx + Math.cos(a) * rx * 0.86;
    const by = cy + Math.sin(a) * ry * 0.86;
    const len = 26 + hash01(i, 9) * 22;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    ctx.moveTo(bx - ny * 12, by + nx * 12);
    ctx.lineTo(bx + nx * len, by + ny * len);
    ctx.lineTo(bx + ny * 12, by - nx * 12);
  }
  ctx.fill();

  // body
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.12, rx * 0.9, ry * 0.8, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.25, cy - ry * 0.45, rx * 0.35, ry * 0.18, -0.15, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.strokeStyle = darker;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();

  // phase 3: the body cracks open with abyss light
  if (o.phase >= 3) {
    ctx.globalAlpha = alpha * (0.6 + 0.3 * Math.sin(t * 5));
    ctx.strokeStyle = '#ff7ad9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.6;
      ctx.moveTo(cx + Math.cos(a) * rx * 0.4, cy + Math.sin(a) * ry * 0.45);
      ctx.lineTo(cx + Math.cos(a + 0.2) * rx * 0.62, cy + Math.sin(a + 0.2) * ry * 0.62);
      ctx.lineTo(cx + Math.cos(a - 0.1) * rx * 0.9, cy + Math.sin(a - 0.1) * ry * 0.88);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }
  // veins when enraged
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.5 + 0.4 * Math.sin(t * 8));
    ctx.strokeStyle = '#ff3355';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      ctx.moveTo(cx + Math.cos(a) * rx * 0.45, cy + Math.sin(a) * ry * 0.45);
      ctx.lineTo(cx + Math.cos(a + 0.15) * rx * 0.7, cy + Math.sin(a + 0.15) * ry * 0.7);
      ctx.lineTo(cx + Math.cos(a - 0.05) * rx * 0.88, cy + Math.sin(a - 0.05) * ry * 0.88);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // look direction
  let lx = 0;
  let ly = 0;
  if (o.lookX !== null && o.lookY !== null) {
    const tx = cam.sx(o.lookX) - cx;
    const ty = cam.sy(o.lookY) - cy;
    const d = Math.hypot(tx, ty) || 1;
    lx = tx / d;
    ly = ty / d;
  }

  // small eyes
  for (let i = 0; i < SMALL_EYES.length; i++) {
    const [ox, oy, rr] = SMALL_EYES[i];
    const ex = cx + ox * rx;
    const ey = cy + oy * ry;
    const r = rr * rx;
    const blink = eyeOpen(t, i + 1) * (1 - o.groggy);
    drawEye(ctx, ex, ey, r, r * 0.8 * blink, lx, ly, o.enraged, false);
  }
  // main eye
  const eyeR = rx * 0.32;
  const open = eyeOpen(t, 0);
  if (o.charge > 0 || o.enraged) {
    ctx.globalAlpha = alpha * (o.enraged ? 0.35 : 0.3 * o.charge);
    ctx.fillStyle = o.enraged ? '#ff2a2a' : '#ffe066';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.02, eyeR * 1.45, eyeR * 1.05, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  // 기획 13차: knocked down, the big eye is shut — now and then it peeks (a dizzy swirl); standing up it flashes blood red
  const shut = o.groggy > 0 ? groggyPeek(t) * o.groggy + (1 - o.groggy) : 1;
  drawEye(ctx, cx, cy + ry * 0.02, eyeR, eyeR * 0.72 * open * shut, lx, ly, o.enraged || o.groggyWake > 0, true);
  if (o.groggy > 0.5 && shut > 0.12) drawDizzySwirl(ctx, cx, cy + ry * 0.02, eyeR * 0.5, eyeR * 0.72 * shut * 0.7, t, alpha);
  if (o.groggyWake > 0) {
    ctx.globalAlpha = alpha * 0.55 * (1 - o.groggyWake);
    ctx.fillStyle = '#ff0022';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.02, eyeR * 1.6, eyeR * 1.15, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }

  // overlays: enraged red pulse + hit flash
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.12 + 0.14 * (0.5 + 0.5 * Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  if (o.flash > 0 || o.phaseFlash > 0) {
    ctx.globalAlpha = alpha * Math.max(0.4 * o.flash, 0.75 * o.phaseFlash);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 기획 13차: the knocked-down eye's peek — shut, opening a slit for ~0.5 s every ~1.8 s. */
function groggyPeek(t: number): number {
  const ph = t % 1.8;
  return ph < 0.5 ? 0.3 * Math.sin((ph / 0.5) * Math.PI) : 0;
}

/** Dizzy spiral over a peeking eye. */
function drawDizzySwirl(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, t: number, alpha: number): void {
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = '#3a0c4a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let k = 0; k <= 24; k++) {
    const u = k / 24;
    const a = u * TAU * 2 + t * 6;
    const px = x + Math.cos(a) * rx * u;
    const py = y + Math.sin(a) * ry * u;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

function eyeOpen(t: number, seed: number): number {
  const period = 3.7 + seed * 0.9;
  const ph = (t + seed * 1.3) % period;
  if (ph < 0.16) return Math.max(0.08, Math.abs(ph - 0.08) / 0.08);
  return 1;
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, lx: number, ly: number, enraged: boolean, main: boolean): void {
  ctx.fillStyle = '#120818';
  ctx.beginPath();
  ctx.ellipse(x, y, rx + 3, Math.max(2, ry + 3), 0, 0, TAU);
  ctx.fill();
  if (ry < 2) return;
  ctx.fillStyle = enraged ? '#ffd6d6' : '#f6f0d8';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  const ir = Math.min(rx, ry) * 0.72;
  const ix = x + lx * rx * 0.32;
  const iy = y + ly * ry * 0.3;
  ctx.fillStyle = enraged ? '#ff1a1a' : main ? '#ffb000' : '#ff5d5d';
  ctx.beginPath();
  ctx.arc(ix, iy, ir, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.22, ir * 0.85, 0, 0, TAU);
  ctx.fill();
  if (main) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(ix - ir * 0.35, iy - ir * 0.4, ir * 0.18, 0, TAU);
    ctx.fill();
  }
}
