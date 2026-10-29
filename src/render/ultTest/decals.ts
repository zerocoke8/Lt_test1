// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-6 여운): the floor marks an ult leaves — a crater, a cooling gash, scorch,
// frost, a slowly turning sigil, ink, petals / notes / paper on the floor. Left only by the finisher, a drag landing and
// a dash path. Faint on purpose (fill ≤ 0.32, edge ≤ 0.35, never red, never flickering): an enemy warning must always
// read stronger. Each mark is the real footprint × 0.9, so no colour ever lands outside where the blow hit.
// Ground layer (render/vfx.ts drawGround → the ultTest module draw, inside the arena clip), world clock.

import type { AreaShape, Vec2 } from '../../types';
import { hitsArea } from '../../sim/geometry';
import type { Camera } from '../camera';
import { PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { TAU, hash01, pathArea } from '../shapes';
import { FX_LOAD } from './settings';

export type DecalKind = 'crater' | 'gash' | 'scorch' | 'frost' | 'sigil' | 'ink' | 'petals';

export interface DecalSpec {
  kind: DecalKind;
  /** The footprint's centre and its origin (a line / fan starts at the origin). */
  x: number;
  y: number;
  area: AreaShape;
  ox: number;
  oy: number;
  color: string;
  /** Seconds it stays (2.5–4 for a finisher). */
  dur: number;
  /** Peak fill alpha (capped at 0.32). */
  alpha: number;
}

interface Decal extends DecalSpec {
  local: boolean;
  /** Renderer clock it appeared at. */
  born: number;
  /** Clock it is pushed out at (−1 = not): a newer mark replaced it, it fades in 0.2 s. */
  out: number;
  seed: number;
}

export const DECAL = {
  /** Live marks at once: mine / others'. */
  mine: 4,
  others: 2,
  maxAlpha: 0.32,
  maxEdge: 0.35,
  fadeIn: 0.1,
  fadeOut: 0.8,
  /** A pushed-out mark fades this fast. */
  replaced: 0.2,
  /** Marks are the footprint × this. */
  inset: 0.9,
  /** Another player's mark: × this. */
  other: 0.55,
} as const;

const decals: Decal[] = [];
let clock = 0;
let seedN = 1;

/** A new floor mark (the oldest of its owner past the cap fades out in 0.2 s). */
export function ultDecal(spec: DecalSpec, local: boolean): void {
  const cap = local ? DECAL.mine : DECAL.others;
  let n = 0;
  for (const d of decals) if (d.local === local && d.out < 0) n++;
  if (n >= cap) {
    for (const d of decals) {
      if (d.local === local && d.out < 0) {
        d.out = clock;
        break;
      }
    }
  }
  decals.push({
    ...spec,
    area: insetArea(spec.area, DECAL.inset),
    alpha: Math.min(DECAL.maxAlpha, spec.alpha) * (local ? 1 : DECAL.other),
    local,
    born: clock,
    out: -1,
    seed: seedN++ % 9973,
  });
}

/** Live marks — not counting one pushed out and fading (tests: the pool cap). */
export function decalCount(): number {
  let n = 0;
  for (const d of decals) if (d.out < 0) n++;
  return n;
}

export function clearDecals(): void {
  decals.length = 0;
}

/** The footprint shrunk by k about its own frame (a line / rect keeps its start, a ring keeps its hole). */
export function insetArea(a: AreaShape, k: number): AreaShape {
  switch (a.shape) {
    case 'circle':
      return { shape: 'circle', radius: a.radius * k };
    case 'ring': {
      const m = (a.outer - a.inner) * (1 - k) * 0.5;
      return { shape: 'ring', inner: a.inner + m, outer: a.outer - m };
    }
    case 'cone':
      return { ...a, radius: a.radius * k, angle: a.angle * k };
    case 'fan':
      return { ...a, radius: a.radius * k, angle: a.angle * k };
    case 'cross':
      return { ...a, length: a.length * k, width: a.width * k };
    case 'line':
      return { shape: 'line', length: a.length * k, width: a.width * k };
    case 'rect':
      return { ...a, length: a.length * k, width: a.width * k };
    default:
      return { shape: 'circle', radius: 0.5 };
  }
}

const C: Vec2 = { x: 0, y: 0 };
const O: Vec2 = { x: 0, y: 0 };
const P: Vec2 = { x: 0, y: 0 };

/** A point inside the mark (seeded, so it stays put frame to frame); false when none was found. */
function pointIn(d: Decal, i: number, out: Vec2): boolean {
  const r = reachOf(d.area);
  for (let t = 0; t < 6; t++) {
    const a = hash01(d.seed, i, t) * TAU;
    const rr = Math.sqrt(hash01(d.seed, i + 50, t)) * r;
    out.x = d.x + Math.cos(a) * rr;
    out.y = d.y + Math.sin(a) * rr;
    if (d.area.shape === 'line' || d.area.shape === 'fan') {
      // a line / fan runs from its origin toward the centre: sample along it
      const dx = d.x - d.ox;
      const dy = d.y - d.oy;
      const len = Math.hypot(dx, dy) || 1;
      const s = hash01(d.seed, i + 90, t) * r;
      const side = (hash01(d.seed, i + 130, t) - 0.5) * (d.area.shape === 'line' ? d.area.width : r * 0.6);
      out.x = d.ox + (dx / len) * s - (dy / len) * side;
      out.y = d.oy + (dy / len) * s + (dx / len) * side;
    }
    C.x = d.x;
    C.y = d.y;
    O.x = d.ox;
    O.y = d.oy;
    if (hitsArea(d.area, C, O, out, 0)) return true;
  }
  return false;
}

function reachOf(a: AreaShape): number {
  switch (a.shape) {
    case 'circle':
      return a.radius;
    case 'ring':
      return a.outer;
    case 'cone':
    case 'fan':
      return a.radius;
    case 'cross':
      return a.length;
    case 'line':
    case 'rect':
      return a.length;
    default:
      return 0.5;
  }
}

/** Ground layer, every frame (now = the renderer's world clock). Draws nothing when there is no mark. */
export function drawDecals(ctx: CanvasRenderingContext2D, cam: Camera, now: number): void {
  clock = now;
  if (decals.length === 0) return;
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    const age = now - d.born;
    if (age >= d.dur || (d.out >= 0 && now - d.out >= DECAL.replaced) || age < -1) decals.splice(i, 1);
  }
  for (const d of decals) {
    const age = Math.max(0, now - d.born);
    let k = Math.min(1, age / DECAL.fadeIn, (d.dur - age) / DECAL.fadeOut);
    if (d.out >= 0) k *= Math.max(0, 1 - (now - d.out) / DECAL.replaced);
    if (k <= 0.01) continue;
    drawDecal(ctx, cam, d, age, k);
  }
  ctx.globalAlpha = 1;
}

function drawDecal(ctx: CanvasRenderingContext2D, cam: Camera, d: Decal, age: number, k: number): void {
  C.x = d.x;
  C.y = d.y;
  O.x = d.ox;
  O.y = d.oy;
  const a = d.alpha * k;
  const edge = Math.min(DECAL.maxEdge, d.alpha * 1.1) * k;
  const low = FX_LOAD.low || !d.local;
  pathArea(ctx, cam, C, O, d.area, 1);
  switch (d.kind) {
    case 'crater':
    case 'scorch': {
      ctx.globalAlpha = a * (d.kind === 'crater' ? 0.85 : 1);
      ctx.fillStyle = d.kind === 'crater' ? '#15110e' : '#221a14';
      ctx.fill();
      ctx.globalAlpha = edge * 0.8;
      ctx.lineWidth = 2;
      ctx.strokeStyle = d.color;
      ctx.stroke();
      if (!low) cracks(ctx, cam, d, d.kind === 'crater' ? 6 : 4, a);
      break;
    }
    case 'gash': {
      // a bright cut that cools to a dark brown over 0.6 s
      const hot = Math.max(0, 1 - age / 0.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = hot > 0.5 ? d.color : '#3b2a20';
      ctx.fill();
      ctx.globalAlpha = edge * (0.4 + 0.6 * hot);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hot > 0 ? d.color : '#5a4030';
      ctx.stroke();
      break;
    }
    case 'frost': {
      // a pale wash: a bright disc would read as a warning
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = '#dff6ff';
      ctx.fill();
      ctx.globalAlpha = edge;
      ctx.lineWidth = 2;
      ctx.strokeStyle = d.color;
      ctx.stroke();
      sprinkle(ctx, cam, d, low ? 4 : 8, edge, 'crystal');
      break;
    }
    case 'sigil': {
      ctx.globalAlpha = a * 0.45;
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.globalAlpha = edge;
      ctx.lineWidth = 2;
      ctx.strokeStyle = d.color;
      ctx.stroke();
      if (d.area.shape === 'circle') sigilRing(ctx, cam, d, edge, age);
      break;
    }
    case 'ink': {
      ctx.globalAlpha = a;
      ctx.fillStyle = d.color;
      ctx.fill();
      sprinkle(ctx, cam, d, low ? 3 : 6, a, 'blot');
      break;
    }
    case 'petals': {
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = d.color;
      ctx.fill();
      sprinkle(ctx, cam, d, low ? 5 : 10, Math.min(DECAL.maxEdge, a * 1.4), 'petal');
      break;
    }
  }
}

/** Dark cracks from the centre of a round mark (a shaped one gets none: they would leave the footprint). */
function cracks(ctx: CanvasRenderingContext2D, cam: Camera, d: Decal, n: number, a: number): void {
  if (d.area.shape !== 'circle') return;
  const R = d.area.radius * 0.95;
  const sx = cam.sx(d.x);
  const sy = cam.sy(d.y);
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    const ang = (j / n) * TAU + hash01(d.seed, j) * 0.6;
    const len = R * (0.55 + 0.4 * hash01(d.seed, j + 20));
    ctx.moveTo(sx, sy);
    for (let s = 1; s <= 3; s++) {
      const dd = (len * s) / 3;
      const jit = (hash01(d.seed, j * 7 + s) - 0.5) * 0.35;
      ctx.lineTo(sx + (Math.cos(ang) * dd - Math.sin(ang) * jit) * PX_PER_UNIT, sy + (Math.sin(ang) * dd + Math.cos(ang) * jit) * PX_PER_UNIT_Y);
    }
  }
  ctx.globalAlpha = Math.min(DECAL.maxEdge, a * 1.2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#0b0907';
  ctx.stroke();
}

/** Two thin rings and six ticks turning slowly (a sigil left by a holy / time blow). */
function sigilRing(ctx: CanvasRenderingContext2D, cam: Camera, d: Decal, a: number, age: number): void {
  if (d.area.shape !== 'circle') return;
  const R = d.area.radius;
  const sx = cam.sx(d.x);
  const sy = cam.sy(d.y);
  const rot = age * 0.5;
  ctx.globalAlpha = a;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = d.color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * 0.72 * PX_PER_UNIT, R * 0.72 * PX_PER_UNIT_Y, 0, 0, TAU);
  for (let i = 0; i < 6; i++) {
    const ang = rot + (i / 6) * TAU;
    ctx.moveTo(sx + Math.cos(ang) * R * 0.72 * PX_PER_UNIT, sy + Math.sin(ang) * R * 0.72 * PX_PER_UNIT_Y);
    ctx.lineTo(sx + Math.cos(ang + TAU / 3) * R * 0.72 * PX_PER_UNIT, sy + Math.sin(ang + TAU / 3) * R * 0.72 * PX_PER_UNIT_Y);
  }
  ctx.stroke();
}

/** Small things lying inside the mark (frost crystals, ink blots, petals / notes / paper). */
function sprinkle(ctx: CanvasRenderingContext2D, cam: Camera, d: Decal, n: number, a: number, kind: 'crystal' | 'blot' | 'petal'): void {
  ctx.globalAlpha = a;
  ctx.fillStyle = kind === 'crystal' ? '#ffffff' : d.color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (!pointIn(d, i, P)) continue;
    const sx = cam.sx(P.x);
    const sy = cam.sy(P.y);
    const s = 4 + 4 * hash01(d.seed, i + 300);
    if (kind === 'crystal') {
      for (let j = 0; j < 3; j++) {
        const ang = (j / 3) * Math.PI + hash01(d.seed, i);
        ctx.moveTo(sx - Math.cos(ang) * s, sy - Math.sin(ang) * s * 0.6);
        ctx.lineTo(sx + Math.cos(ang) * s, sy + Math.sin(ang) * s * 0.6);
      }
    } else {
      ctx.moveTo(sx + s, sy);
      ctx.ellipse(sx, sy, s * (kind === 'blot' ? 1.4 : 1), s * 0.5, hash01(d.seed, i + 400) * TAU, 0, TAU);
    }
  }
  if (kind === 'crystal') ctx.stroke();
  else ctx.fill();
}
