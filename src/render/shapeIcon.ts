// Mini diagram of a drag-skill footprint (preset cards + detail panel): the real parts (offsets, dash, delays) drawn
// in the same squashed quarter view as the field, fitted into a small canvas, with the drop point and direction.

import type { PreviewPart, Vec2 } from '../types';
import { DIR_VEC, crossAxes, rectFrame } from '../sim/geometry';
import { Camera, GROUND_SQUASH } from './camera';
import { boldFont } from './look';
import { ALLY_TINT, previewDrawParts } from './preview';
import { TAU, addAreaPath } from './shapes';

export interface ShapeIconOpts {
  /** CSS px of the canvas. */
  width: number;
  height: number;
  color: string;
  /** Bigger diagram: floor grid, order numbers, thicker cues. */
  detail?: boolean;
}

/** World points that bound a part (for fitting). */
function partBounds(p: PreviewPart, at: Vec2, out: number[]): void {
  const a = p.area;
  const push = (x: number, y: number) => out.push(x, y);
  const cx = at.x + p.offset.x;
  const cy = at.y + p.offset.y;
  switch (a.shape) {
    case 'circle':
      push(cx - a.radius, cy - a.radius);
      push(cx + a.radius, cy + a.radius);
      break;
    case 'single':
      push(cx - 0.6, cy - 0.6);
      push(cx + 0.6, cy + 0.6);
      break;
    case 'line':
      push(cx - a.length / 2, cy - a.width / 2);
      push(cx + a.length / 2, cy + a.width / 2);
      break;
    case 'rect': {
      const f = rectFrame(a, { x: cx, y: cy });
      const px = -f.uy * f.hw;
      const py = f.ux * f.hw;
      for (const t of [0, f.len]) for (const s of [-1, 1]) push(f.sx + f.ux * t + px * s, f.sy + f.uy * t + py * s);
      break;
    }
    case 'cone': {
      const u = DIR_VEC[a.dir];
      const a0 = Math.atan2(u.y, u.x);
      const h = (a.angle * Math.PI) / 360;
      push(cx, cy);
      for (let i = 0; i <= 8; i++) {
        const ang = a0 - h + (2 * h * i) / 8;
        push(cx + Math.cos(ang) * a.radius, cy + Math.sin(ang) * a.radius);
      }
      break;
    }
    case 'ring':
      push(cx - a.outer, cy - a.outer);
      push(cx + a.outer, cy + a.outer);
      break;
    case 'cross': {
      const [u1, u2] = crossAxes(a.diagonal);
      const L = a.length;
      const w = a.width / 2;
      for (const u of [u1, u2]) for (const s of [-1, 1]) for (const t of [-1, 1]) push(cx + u.x * L * s - u.y * w * t, cy + u.y * L * s + u.x * w * t);
      break;
    }
  }
}

/** Draws the footprint of `parts` into `canvas` (sizes its backing store for the device pixel ratio). */
export function drawShapeIcon(canvas: HTMLCanvasElement, parts: PreviewPart[], opts: ShapeIconOpts): void {
  const dpr = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const W = opts.width;
  const H = opts.height;
  const bw = Math.round(W * dpr);
  const bh = Math.round(H * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);

  // lay the footprint out around a drop point at (0, 0)
  const at = { x: 0, y: 0 };
  const dp = { pos: at, area: parts[0]?.area ?? { shape: 'single' as const }, parts };
  const draw = previewDrawParts(dp);
  const pts: number[] = [0, 0];
  for (const d of draw) partBounds(d.part, at, pts);
  let dash: { from: Vec2; to: Vec2 } | null = null;
  for (const p of parts) {
    if (!p.dash) continue;
    const from = { x: p.offset.x, y: p.offset.y };
    const u = DIR_VEC[p.dash.dir];
    dash = { from, to: { x: from.x + u.x * p.dash.distance, y: from.y + u.y * p.dash.distance } };
    pts.push(dash.to.x, dash.to.y);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1] * GROUND_SQUASH);
    maxY = Math.max(maxY, pts[i + 1] * GROUND_SQUASH);
  }
  // world → icon px: uniform scale on the squashed plane, centered, with a margin
  const pad = opts.detail ? 10 : 4;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(0.5, maxY - minY);
  const s = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = W / 2 - ((minX + maxX) / 2) * s;
  const oy = H / 2 - ((minY + maxY) / 2) * s;
  const ix = (x: number) => (ox + x * s) * dpr;
  const iy = (y: number) => (oy + y * GROUND_SQUASH * s) * dpr;

  // pathArea works in the game's logical px through a Camera; map that space onto the icon with one transform
  const cam = new Camera();
  cam.x = 0;
  const L0x = cam.sx(0);
  const L0y = cam.sy(0);
  const k = s / (cam.sx(1) - L0x); // logical px per world unit → icon px per world unit
  const toIcon = () => ctx.setTransform(k * dpr, 0, 0, k * dpr, (ox - L0x * k) * dpr, (oy - L0y * k) * dpr);
  const reset = () => ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (opts.detail) {
    // faint floor grid (1 unit tiles) so sizes read like the field
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(-ox / s); x <= (W - ox) / s; x++) {
      ctx.moveTo(ix(x), 0);
      ctx.lineTo(ix(x), bh);
    }
    for (let y = Math.floor(-oy / (s * GROUND_SQUASH)); y <= (H - oy) / (s * GROUND_SQUASH); y++) {
      ctx.moveTo(0, iy(y));
      ctx.lineTo(bw, iy(y));
    }
    ctx.stroke();
  }

  const lw = (opts.detail ? 2 : 1.5) * dpr;
  const hasEnemy = draw.some(d => d.enemies);
  for (const pass of [0, 1]) {
    for (const d of draw) {
      const allyOnly = !d.enemies;
      if ((pass === 0) !== allyOnly) continue;
      const c = allyOnly && hasEnemy ? ALLY_TINT : opts.color;
      toIcon();
      ctx.beginPath();
      addAreaPath(ctx, cam, d.center, null, d.part.area, 1);
      reset();
      ctx.globalAlpha = allyOnly && hasEnemy ? 0.16 : 0.42;
      ctx.fillStyle = c;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = lw;
      ctx.strokeStyle = c;
      if (allyOnly && hasEnemy) ctx.setLineDash([3 * dpr, 2 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // direction cues in icon px
  const arrow = (ax: number, ay: number, bx: number, by: number, heads: 1 | 2, w: number) => {
    const x0 = ix(ax);
    const y0 = iy(ay);
    const x1 = ix(bx);
    const y1 = iy(by);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 3 * dpr) return;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const hl = Math.min((opts.detail ? 9 : 6) * dpr, len * 0.45);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = w * dpr;
    ctx.beginPath();
    ctx.moveTo(heads === 2 ? hl * 0.7 : 0, 0);
    ctx.lineTo(len - hl * 0.7, 0);
    ctx.stroke();
    const tip = (x: number, sg: number) => {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - sg * hl, -hl * 0.6);
      ctx.lineTo(x - sg * hl, hl * 0.6);
      ctx.closePath();
      ctx.fill();
    };
    tip(len, 1);
    if (heads === 2) tip(0, -1);
    ctx.restore();
  };
  const aw = opts.detail ? 2.2 : 1.6;
  for (const d of draw) {
    if (d.part.dash) continue;
    if (!d.enemies && hasEnemy) continue;
    const a = d.part.area;
    if (a.shape === 'rect') {
      const f = rectFrame(a, d.center);
      const i0 = Math.min(0.3, f.len * 0.1);
      arrow(f.sx + f.ux * i0, f.sy + f.uy * i0, f.sx + f.ux * (f.len - i0 * 0.3), f.sy + f.uy * (f.len - i0 * 0.3), a.anchor === 'center' ? 2 : 1, aw);
    } else if (a.shape === 'cone') {
      const u = DIR_VEC[a.dir];
      arrow(d.center.x + u.x * a.radius * 0.15, d.center.y + u.y * a.radius * 0.15, d.center.x + u.x * a.radius * 0.95, d.center.y + u.y * a.radius * 0.95, 1, aw);
    }
  }
  if (dash) arrow(dash.from.x, dash.from.y, dash.to.x, dash.to.y, 1, aw + 0.6);
  const seq = draw.filter(d => d.order > 0).sort((a, b) => a.order - b.order);
  if (seq.length > 1 && seq.every(d => Math.abs(d.center.y - seq[0].center.y) < 1e-6)) {
    arrow(seq[0].center.x, seq[0].center.y, seq[seq.length - 1].center.x, seq[seq.length - 1].center.y, 1, aw);
  }
  if (opts.detail && seq.length > 1) {
    ctx.font = boldFont(11 * dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of seq) {
      const r = d.part.area.shape === 'circle' ? d.part.area.radius * 0.55 : 0;
      const x = ix(d.center.x);
      const y = iy(d.center.y + r);
      ctx.beginPath();
      ctx.arc(x, y, 7 * dpr, 0, TAU);
      ctx.fillStyle = 'rgba(5,6,10,0.85)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(d.order), x, y + 0.5 * dpr);
    }
  }
  // drop point (where the card lands)
  ctx.beginPath();
  ctx.arc(ix(0), iy(0), (opts.detail ? 3.5 : 2.5) * dpr, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.2 * dpr;
  ctx.strokeStyle = 'rgba(5,6,10,0.9)';
  ctx.stroke();
}
