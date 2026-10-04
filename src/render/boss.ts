// The floor boss: a giant procedural creature looming above the arena's back edge (eyes + tentacles).

import { Camera, PX_PER_UNIT } from './camera';
import { darken, lighten, mix } from './look';
import { TAU, hash01 } from './shapes';

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
  // Sits low enough that the big eye clears the top-centre HUD boss bar (logical y ≈ 8–82).
  const cy = cam.sy(y) - 14 + breathe - o.retreat * 250;
  const rx = radius * PX_PER_UNIT * 0.95;
  const ry = radius * PX_PER_UNIT * 0.55;
  const alpha = 1 - o.retreat;
  const base = o.enraged ? mix(o.color, '#ff0033', 0.35) : o.color;
  const dark = darken(base, 0.45);
  const darker = darken(base, 0.7);
  const light = lighten(base, 0.3);
  const speed = o.enraged ? 2.6 : 1.5;
  ctx.globalAlpha = alpha;

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
    const dirA = a * 0.55 + (Math.PI / 2) * 0.45;
    const len = (150 + hash01(i, 3) * 70) * (1 - o.retreat * 0.6);
    const segLen = len / SEGS;
    let ang = dirA;
    for (let k = 0; k < SEGS; k++) {
      const u = k / SEGS;
      const sway = Math.sin(t * speed + i * 1.37 + u * 3.2) * (0.18 + u * 0.35);
      const curl = (i < 3 ? -1 : 1) * u * u * 0.9;
      ang = dirA + sway + curl;
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
      px = nx;
      py = ny;
    }
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
    const blink = eyeOpen(t, i + 1);
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
  drawEye(ctx, cx, cy + ry * 0.02, eyeR, eyeR * 0.72 * open, lx, ly, o.enraged, true);

  // overlays: enraged red pulse + hit flash
  if (o.enraged) {
    ctx.globalAlpha = alpha * (0.12 + 0.14 * (0.5 + 0.5 * Math.sin(t * 6)));
    ctx.fillStyle = '#ff0022';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  if (o.flash > 0) {
    ctx.globalAlpha = alpha * 0.4 * o.flash;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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
