// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 4-4): everything the two content tracks (groupA.ts / groupB.ts) may use, in
// one place — the registries, the common grammar, the theme, the floor marks, today's storyboard parts (re-exported
// unchanged) and a few small helpers. A group file imports render helpers ONLY from here; a helper that is missing is
// written privately inside the group's own file, never added to a core file.

import type { AreaShape, Vec2 } from '../../types';
import { crossAxes, rectFrame } from '../../sim/geometry';
import { beam } from '../castfx';
import { Fx, type SkillFx, type Sfx, dirAngle } from '../skillfx';
import { LAND, PREP, type StageInfo } from '../stagefx';
import type { UltHost } from './grammar';
import type { UltAlias, UltBeatInfo } from './stories';

// ── the 23차 core ──
export { FX_LOAD, ULT_FX, sanitizeUltFx } from './settings';
export { ultTheme, type UltTheme } from './theme';
export {
  CHARGE,
  FINISH_BLESS,
  FINISH_STRIKE,
  ultBreath,
  ultCharge,
  ultDecal,
  ultDefault,
  ultFinisher,
  ultGlyph,
  ultHitMarks,
  ultSpeedLines,
  type ChargeSpec,
  type DecalKind,
  type DecalSpec,
  type FinisherSpec,
  type UltHost,
  type UltKick,
} from './grammar';
export {
  registerUltLooks,
  registerUltStories,
  ultStoryKeys,
  type UltAlias,
  type UltAltLook,
  type UltBeatInfo,
  type UltImpact,
  type UltMoveInfo,
  type UltStory,
  type UltStoryFn,
} from './stories';
export { footprintRadius, type UltBeat, type UltBeatRole, type UltBeats } from '../../data/ultTest';

// ── today's parts, unchanged ──
export {
  GOLD,
  HANJI,
  HOLY,
  ICE,
  INK,
  LAND,
  LAVA,
  MEDIC,
  PREP,
  PUPPET,
  STAGE_DETAIL,
  TALISMAN,
  alliesGlow,
  areaFx,
  aura,
  bardBand,
  boltFx,
  crosshairFx,
  dollBurst,
  eachEnemy,
  fallAt,
  fireBurst,
  glyphFx,
  grow,
  lightPillar,
  rings,
  rune,
  scorchFx,
  selfBubble,
  shotgun,
  snow,
  tetherFx,
  type StageHost,
  type StageInfo,
} from '../stagefx';
export { arrow, beam, chains, clock, muzzle, notes, pillar, radiusOf, slash, star, wave, xslash } from '../castfx';
export { FallObj, Fx, SkillFx, TetherStyle, dirAngle, screenAngle, type Sfx } from '../skillfx';
export { Pk } from '../fxparts';
export type { TeleMotif, ZoneDecor } from '../marks';
export type { ImpactSpec } from '../impact';
export type { Juice } from '../juice';
export type { AreaShape, Vec2 } from '../../types';

// ─────────────────────────── small helpers ───────────────────────────

/** Radians (world): a line / fan with an origin → atan2(y − oy, x − ox); a rect / cone → rot ?? dir; else the facing. */
export function ultAngle(s: StageInfo): number {
  const a = s.area;
  if (a.shape === 'line' || a.shape === 'fan') {
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    if (Math.hypot(dx, dy) > 1e-4) return Math.atan2(dy, dx);
  }
  if (a.shape === 'rect' || a.shape === 'cone') {
    if (s.rot !== undefined) return s.rot;
    if (a.rot != null) return (a.rot * Math.PI) / 180;
    return dirAngle(a.dir);
  }
  return s.face >= 0 ? 0 : Math.PI;
}

/** The point at t ∈ [0, 1] along the footprint's long axis (a line / fan / rect from its start, a round one across). */
export function footAlong(s: StageInfo, t: number, out: Vec2): Vec2 {
  const a = s.area;
  const ang = ultAngle(s);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  switch (a.shape) {
    case 'line':
      out.x = s.ox + ux * a.length * t;
      out.y = s.oy + uy * a.length * t;
      return out;
    case 'fan':
      out.x = s.ox + ux * a.radius * t;
      out.y = s.oy + uy * a.radius * t;
      return out;
    case 'rect': {
      const fr = rectFrame(withRot(a, s), s);
      out.x = fr.sx + fr.ux * fr.len * t;
      out.y = fr.sy + fr.uy * fr.len * t;
      return out;
    }
    case 'cone':
      out.x = s.x + ux * a.radius * t;
      out.y = s.y + uy * a.radius * t;
      return out;
    case 'cross': {
      const [u1] = crossAxes(a.diagonal);
      out.x = s.x + u1.x * a.length * (2 * t - 1);
      out.y = s.y + u1.y * a.length * (2 * t - 1);
      return out;
    }
    default: {
      const R = a.shape === 'circle' ? a.radius : a.shape === 'ring' ? a.outer : 0.6;
      out.x = s.x + ux * R * (2 * t - 1);
      out.y = s.y + uy * R * (2 * t - 1);
      return out;
    }
  }
}

/** A random point inside the footprint (Math.random — render only). */
export function randomIn(s: StageInfo, out: Vec2): Vec2 {
  const a = s.area;
  switch (a.shape) {
    case 'circle':
    case 'ring':
    case 'single': {
      const r0 = a.shape === 'ring' ? a.inner : 0;
      const r1 = a.shape === 'circle' ? a.radius : a.shape === 'ring' ? a.outer : 0.6;
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0));
      out.x = s.x + Math.cos(ang) * rr;
      out.y = s.y + Math.sin(ang) * rr;
      return out;
    }
    case 'cone':
    case 'fan': {
      const base = ultAngle(s);
      const half = (a.angle * Math.PI) / 360;
      const ang = base + (Math.random() * 2 - 1) * half;
      const rr = Math.sqrt(Math.random()) * a.radius;
      const cx = a.shape === 'fan' ? s.ox : s.x;
      const cy = a.shape === 'fan' ? s.oy : s.y;
      out.x = cx + Math.cos(ang) * rr;
      out.y = cy + Math.sin(ang) * rr;
      return out;
    }
    case 'cross': {
      const [u1, u2] = crossAxes(a.diagonal);
      const along = (Math.random() * 2 - 1) * a.length;
      const side = (Math.random() - 0.5) * a.width;
      const [p, q] = Math.random() < 0.5 ? [u1, u2] : [u2, u1];
      out.x = s.x + p.x * along + q.x * side;
      out.y = s.y + p.y * along + q.y * side;
      return out;
    }
    default: {
      // line / rect: along its axis, across its width
      const w = a.shape === 'line' || a.shape === 'rect' ? a.width : 1;
      footAlong(s, Math.random(), out);
      const ang = ultAngle(s);
      const side = (Math.random() - 0.5) * w;
      out.x += -Math.sin(ang) * side;
      out.y += Math.cos(ang) * side;
      return out;
    }
  }
}

/** A rect with the info's real direction (s.rot) when the area itself has none. */
function withRot(a: Extract<AreaShape, { shape: 'rect' }>, s: StageInfo): Extract<AreaShape, { shape: 'rect' }> {
  if (a.rot != null || s.rot === undefined) return a;
  return { ...a, rot: (s.rot * 180) / Math.PI };
}

/**
 * Run today's PREP / LAND story `a.key` on this beat with the alias options (render/vfx.ts runs every UltStory.alias
 * through here). The info is restored afterwards.
 */
export function runAlias(a: UltAlias, phase: 'prep' | 'land', fx: SkillFx, h: UltHost, s: UltBeatInfo, at?: { x?: number; y?: number }): void {
  if (phase === 'prep' ? a.prep === false : a.land === false) return;
  const fn = (phase === 'prep' ? PREP : LAND)[a.key];
  if (!fn) return;
  const x = s.x;
  const y = s.y;
  const ox = s.ox;
  const oy = s.oy;
  const src = s.src;
  const follow = s.follow;
  const area = s.area;
  const k = s.k;
  const hit = s.hit;
  const rot = s.rot;
  if (at?.x !== undefined) s.x = at.x;
  if (at?.y !== undefined) s.y = at.y;
  if (a.lineAsRect && s.area.shape === 'line') {
    // the band from where it started toward its point, as a turned rect (a fresh object: stories may keep it)
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const r = Math.hypot(dx, dy) > 1e-4 ? Math.atan2(dy, dx) : s.face >= 0 ? 0 : Math.PI;
    s.area = { shape: 'rect', dir: 'right', anchor: 'start', length: s.area.length, width: s.area.width, rot: (r * 180) / Math.PI };
    s.x = s.ox;
    s.y = s.oy;
    s.rot = r;
  }
  if (a.at === 'point') {
    s.ox = s.x;
    s.oy = s.y;
    s.src = -1;
    s.follow = -1;
  }
  if (a.k !== undefined) s.k = k * Math.max(0.5, Math.min(1.6, a.k));
  if (a.seqAsHit) s.hit = s.seq;
  try {
    fn(fx, h, s);
  } finally {
    s.x = x;
    s.y = y;
    s.ox = ox;
    s.oy = oy;
    s.src = src;
    s.follow = follow;
    s.area = area;
    s.k = k;
    s.hit = hit;
    s.rot = rot;
  }
}

/** Run today's story `key` (PREP or LAND) on this beat, optionally at another spot (x, y) and with alias options. */
export function runStory(key: string, phase: 'prep' | 'land', fx: SkillFx, h: UltHost, s: UltBeatInfo, o?: Omit<UltAlias, 'key' | 'prep' | 'land'> & { x?: number; y?: number }): void {
  runAlias(o ? { ...o, key } : { key }, phase, fx, h, s, o);
}

/** An aim line with marching ››› from (x, y) to (x2, y2), w cells wide, starting after `wait`. */
export function aimLine(fx: SkillFx, x: number, y: number, x2: number, y2: number, w: number, color: string, k: number, wait: number, dur: number): Sfx {
  const f = fx.add(Fx.AimLine, x, y, Math.max(0.08, dur), color, k);
  f.x2 = x2;
  f.y2 = y2;
  f.w = w;
  f.wait = Math.max(0, wait);
  return f;
}

/** A glowing orb flying from (x, y) to (x2, y2) over dur at height z (a thrown shield, a doll, a syringe). */
export function orbFly(fx: SkillFx, x: number, y: number, x2: number, y2: number, dur: number, color: string, k: number, z = 0.6): Sfx {
  const f = fx.add(Fx.Orb, x, y, Math.max(0.06, dur), color, k);
  f.x2 = x2;
  f.y2 = y2;
  f.z = z;
  return f;
}

/** Ground cracks from (x, y): n lines out to r, fanned over `spread` radians around `ang` (default all round). */
export function crackFx(fx: SkillFx, x: number, y: number, r: number, n: number, color: string, k: number, o?: { ang?: number; spread?: number; dur?: number; wait?: number }): Sfx {
  const f = fx.add(Fx.Crack, x, y, o?.dur ?? 1.1, color, k);
  f.ang = o?.ang ?? 0;
  f.w = o?.spread ?? Math.PI * 2;
  f.r = r;
  f.n = Math.max(1, Math.round(n));
  f.wait = Math.max(0, o?.wait ?? 0);
  return f;
}

const A: Vec2 = { x: 0, y: 0 };
const B: Vec2 = { x: 0, y: 0 };

/** A beam of light along a line / rect / cone axis (across a round footprint along its angle). */
export function beamAlong(fx: SkillFx, s: StageInfo, w: number, color: string, dur: number, wait = 0): Sfx {
  footAlong(s, 0, A);
  footAlong(s, 1, B);
  return beam(fx, A.x, A.y, B.x, B.y, w, dur, color, s.k, wait);
}
