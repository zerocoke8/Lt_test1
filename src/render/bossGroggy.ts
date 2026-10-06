// 기획 13차 보스 그로기 (docs/boss-groggy.md 6장 '보스 자세'): the shared knocked-down base around every boss set piece
// — sunk 14 px, tilted 6°, 35 % washed out (phase tint and enrage glow stay), big stun stars over its head — the
// 'almost full' tremble (±2 px, ±3 px from 90 %) with two small orbiting stars and gold cracks, and each boss's props:
// 5층 the yellow '점검중' sign swinging in front of the shut doors, 10층 'Zzz', 15층 the flat-lining ECG ('삐—', a spike
// when it stands up) and the scalpel stuck in the floor. The poses themselves (doors shut, asleep on the desk, lamp out,
// eye shut) are in the boss draw functions (bosses.ts / boss.ts).

import { Camera, PX_PER_UNIT } from './camera';
import type { BossDrawOpts } from './boss';
import { BOSS_DROP } from './bosses';
import { TAU } from './shapes';

const SINK_PX = 14;
const TILT = (6 * Math.PI) / 180;
const WASH = 0.35;

/** Screen x and foot line of a set piece (same anchor as the boss art, without its shakes). */
function base(cam: Camera, x: number, y: number): { cx: number; by: number } {
  return { cx: cam.sx(x), by: cam.sy(y) + BOSS_DROP };
}

/** Starts the knocked-down / trembling transform; returns false when there is none (nothing to end). */
export function beginGroggyPose(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, o: BossDrawOpts): boolean {
  const g = o.groggy;
  const tremble = g <= 0 && o.groggyNear > 0 && o.retreat <= 0 ? Math.sin(o.time * 52) * (o.groggyNear >= 2 ? 3 : 2) : 0;
  if (g <= 0 && tremble === 0) return false;
  const { cx, by } = base(cam, x, y);
  const py = by + 90;
  ctx.save();
  ctx.translate(cx + tremble, py + SINK_PX * g);
  ctx.rotate(TILT * g);
  ctx.translate(-cx, -py);
  return true;
}

/** Washes the knocked-down art out (saturation blend over its bounds) and ends the transform. */
export function endGroggyPose(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts): void {
  if (o.groggy > 0) {
    const { cx, by } = base(cam, x, y);
    const R = radius * PX_PER_UNIT;
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = WASH * o.groggy * (1 - o.retreat);
    ctx.fillStyle = '#808080';
    ctx.fillRect(cx - R * 1.7, by - 290, R * 3.4, 420);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Where the boss's head is (stars over it), at full knock-down. */
function headY(defId: string, by: number, R: number, g: number): number {
  switch (defId) {
    case 'elevator_keeper':
      return by + 6 + SINK_PX * g;
    case 'overtime_lord':
      return by + 8 + 44 * g - R * 0.36 * 1.1 + SINK_PX * g;
    case 'surgeon_director':
      return by + 12 + 20 * g - R * 0.34 * 1.2 + SINK_PX * g;
    default:
      return by - 14 - R * 0.55 * 0.9 + SINK_PX * g;
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Stars circling over the head: n of size r on an ellipse of half-width w. */
function orbitStars(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, n: number, r: number, t: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffe066';
  ctx.strokeStyle = '#7a5c00';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = t * 5 + (i * TAU) / n;
    star(ctx, x + Math.cos(a) * w, y + Math.sin(a) * w * 0.35, r, t * 3 + i);
  }
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Gold cracks over the body (gauge ≥ 90 %). */
function cracks(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number): void {
  ctx.globalAlpha = 0.65 + 0.3 * Math.sin(t * 9);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (const k of [-1, 1]) {
    const x0 = cx + k * R * 0.22;
    ctx.moveTo(x0, cy - 34);
    ctx.lineTo(x0 + k * 12, cy - 14);
    ctx.lineTo(x0 - k * 4, cy + 2);
    ctx.lineTo(x0 + k * 16, cy + 24);
  }
  ctx.stroke();
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
}

/** Props and stars drawn over the posed art (screen-aligned). */
export function drawGroggyProps(ctx: CanvasRenderingContext2D, cam: Camera, defId: string, x: number, y: number, radius: number, o: BossDrawOpts): void {
  const alpha = 1 - o.retreat;
  if (alpha <= 0) return;
  const { cx, by } = base(cam, x, y);
  const R = radius * PX_PER_UNIT;
  const t = o.time;
  if (o.groggy <= 0) {
    if (o.groggyNear <= 0) return;
    const shake = Math.sin(t * 52) * (o.groggyNear >= 2 ? 3 : 2);
    orbitStars(ctx, cx + shake, headY(defId, by, R, 0) - 8, 26, 2, 6, t, alpha);
    if (o.groggyNear >= 2) cracks(ctx, cx + shake, by + 30, R, t);
    return;
  }
  const g = o.groggy;
  switch (defId) {
    case 'elevator_keeper':
      inspectionSign(ctx, cx, by + 52 + SINK_PX * g, t, alpha * g);
      break;
    case 'overtime_lord':
      zzz(ctx, cx + R * 0.3, headY(defId, by, R, g) - 4, t, alpha * g);
      break;
    case 'surgeon_director':
      ecg(ctx, cx, headY(defId, by, R, g) - 44, t, o.groggyWake, alpha * g);
      droppedScalpel(ctx, cx + R * 0.62, by + 104, alpha * g);
      break;
  }
  // big stun stars (2× the unit ones) over the head
  orbitStars(ctx, cx, headY(defId, by, R, g) - 10, 44, 3, 10, t, alpha * g);
}

/** 5층: the yellow '점검중' sign that fell off, swinging in front of the shut doors. */
function inspectionSign(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, a: number): void {
  ctx.save();
  ctx.translate(x, y - 22);
  ctx.rotate(Math.sin(t * 3.2) * 0.14);
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(-30, 22);
  ctx.moveTo(22, 0);
  ctx.lineTo(30, 22);
  ctx.stroke();
  ctx.fillStyle = '#ffd60a';
  ctx.fillRect(-46, 22, 92, 30);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 3;
  ctx.strokeRect(-46, 22, 92, 30);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = '900 19px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('점검중', 0, 38);
  ctx.restore();
}

/** 10층: 'Zzz' rising from the sleeping head. */
function zzz(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, a: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0b0e14';
  ctx.fillStyle = '#e6f1ff';
  for (let i = 0; i < 3; i++) {
    const u = (t * 0.6 + i / 3) % 1;
    ctx.globalAlpha = a * Math.sin(u * Math.PI);
    ctx.font = `900 ${14 + Math.round(u * 14)}px sans-serif`;
    const zx = x + u * 34 + Math.sin(u * 6 + i) * 4;
    const zy = y - u * 46;
    ctx.strokeText('Z', zx, zy);
    ctx.fillText('Z', zx, zy);
  }
  ctx.globalAlpha = 1;
}

/** 15층: the heart monitor over its head — '삐—' flat line; a spike as it stands up. */
function ecg(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, wake: number, a: number): void {
  const w = 96;
  const h = 30;
  ctx.globalAlpha = a;
  ctx.fillStyle = '#05140f';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = '#2b5c4c';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = wake > 0 ? '#ff4d4d' : '#4dff9a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 4, y);
  if (wake > 0) {
    const sx = x - w / 2 + 4 + (w - 8) * Math.min(1, wake * 1.4);
    ctx.lineTo(sx - 10, y);
    ctx.lineTo(sx - 5, y - 12);
    ctx.lineTo(sx, y + 10);
    ctx.lineTo(sx + 5, y);
  }
  ctx.lineTo(x + w / 2 - 4, y);
  ctx.stroke();
  if (wake <= 0) {
    ctx.fillStyle = '#4dff9a';
    ctx.font = '900 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(t * 4));
    ctx.fillText('삐—', x + w / 2 + 20, y);
  }
  ctx.globalAlpha = 1;
}

/** 15층: the scalpel that dropped, stuck in the floor. */
function droppedScalpel(ctx: CanvasRenderingContext2D, x: number, y: number, a: number): void {
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#59636d';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 26);
  ctx.lineTo(x - 2, y - 12);
  ctx.stroke();
  ctx.strokeStyle = '#e9eef5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 2, y - 12);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 7, 2.5, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}
