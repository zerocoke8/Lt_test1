// Skill flavour effects (procedural, pooled): what each character's skills LOOK like on the field.
// vfx.ts feeds GameEvents in; this module turns a skill cast into shape-matching, per-character motion:
// slashes (blade/berserker/shadow), arrows (ranger), tracers/pellets (gunner), fire/meteors/ice (mage), holy light
// (cleric/paladin), notes/sound waves (bard), clock ripples (chrono), chains (warden), shield waves (guardian).
// Render-side only: reads world points from events and unit memos, never touches GameState.

import type { AreaShape, Dir } from '../types';
import { DIR_VEC } from '../sim/geometry';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { lighten } from './look';
import { Pool } from './pool';
import { TAU, pathArea } from './shapes';
import type { UnitMemo } from './units';
import { drawPartAir, drawPartGround } from './fxparts';

export const enum Fx {
  Spin,
  Beam,
  Arrow,
  Star,
  Slash,
  Wave,
  Meteor,
  Pillar,
  Rings,
  Clock,
  Chains,
  Notes,
  ShieldWave,
  Pellets,
  Crack,
  Muzzle,
  Aura,
  Snow,
  XSlash,
  Dome,
  Orb,
  // 기획 13차 연출 부품 (skill-renewal.md 2-7), drawn by fxparts.ts
  /** FallingObject: n = FallObj, r = size (units), z = start height; lands at the end of dur (shadow grows under it). */
  Fall,
  /** TetherLine: (x,y)/follow → (x2,y2)/follow2; n = TetherStyle, r = sag (units), w = width px; breaks while fading. */
  Tether,
  /** A big glyph (滅, 印, !, Σ …) at height z; r = px size, text = glyph. */
  Glyph,
  /** Hex shield panels lighting up over a band / dome (guardian). area = footprint. */
  Hex,
  /** Rune magic circle on the ground (mage), r = radius, spins; n = rune ticks. */
  Rune,
  /** A shape burning in from its middle, pulsing faster (paladin brand, shadow / chrono X). area = footprint. */
  Brand,
  /** Three staff lines along a band + a clef (bard). area = rect footprint. */
  Staff,
  /** A talisman flying (x,y) → (x2,y2), then pinned there until dur (exorcist). */
  Talisman,
  /** Lightning zig-zag (x,y) → (x2,y2), re-jittered every few frames (medic). */
  Bolt,
  /** Ice crystal (n 0) or grey stone (n 1) around a unit (follow). r = unit radius. */
  Encase,
  /** Aim reticle following a unit (gunner / ranger follow stages), shrinking toward the hit. r = radius (units). */
  Crosshair,
  /** Ground decal: crater / scorch (n 0) or ink pool (n 1), fades out. r = radius (units). */
  Scorch,
  /** Wings of light on a unit (cleric ult). r = span (units). */
  Wings,
  /** A ghost silhouette rising out of a unit (exorcist), z = start height. */
  Spirit,
  /** Crescent moon hanging over a point (shadow ult), r = px size; drops through the last 25 % of dur. */
  Moon,
  /** Aim line with marching ››› chevrons (x,y) → (x2,y2) (ranger), w = width (units). */
  AimLine,
}

/** What a Fx.Fall drops. */
export const enum FallObj {
  Meteor,
  Shield,
  Cage,
  Shell,
  Crescent,
  Bell,
  Spear,
  Arrow,
}

/** How a Fx.Tether line looks. */
export const enum TetherStyle {
  Chain,
  Thread,
  Dotted,
  Electric,
}

export interface Sfx {
  kind: Fx;
  /** World anchor on the ground. */
  x: number;
  y: number;
  /** Second world point (beam/arrow/orb end). */
  x2: number;
  y2: number;
  /** Height above the ground (world units). */
  z: number;
  r: number;
  r2: number;
  w: number;
  /** Angle (radians): screen-space for slashes, world for pellets/cracks. */
  ang: number;
  age: number;
  dur: number;
  /** Seconds before it starts (sequenced hits). */
  wait: number;
  color: string;
  light: string;
  /** Strength 0..1 (other players' skills are drawn softer). */
  k: number;
  seed: number;
  /** Entity to follow (−1 = fixed point); ox/oy = offset from it (world units). */
  follow: number;
  ox: number;
  oy: number;
  area: AreaShape;
  n: number;
  flip: number;
  /** Impact flavour fired when a travelling effect (meteor/orb) arrives. */
  impact: Impact;
  /** Sparks when a delayed effect starts (off for plain basic-attack swings: there are many of those). */
  sparks: boolean;
  /** 기획 13차: second entity to follow (Tether end), −1 = fixed (x2, y2). */
  follow2: number;
  /** 기획 13차: glyph text (Fx.Glyph). */
  text: string;
}

export const enum Impact {
  None,
  Fire,
  Ice,
  Shell,
  Holy,
}

/** What the effects can ask the particle/flash layer for (implemented by Vfx). */
export interface FxHost {
  burst(x: number, y: number, z: number, n: number, color: string, speed: number, up: number, dur: number, g?: number): void;
  ring(x: number, y: number, r0: number, r1: number, dur: number, color: string, width: number, fill: number): void;
  flash(cx: number, cy: number, ox: number, oy: number, area: AreaShape, dur: number, color: string, strength: number): void;
  shake(amount: number): void;
}

const NO_AREA: AreaShape = { shape: 'single' };
const TMP = { x: 0, y: 0 };

function ease(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Cheap deterministic noise per (seed, i). */
function rnd(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function dirAngle(d: Dir): number {
  const u = DIR_VEC[d];
  return Math.atan2(u.y, u.x);
}

export class SkillFx {
  readonly pool = new Pool<Sfx>(
    () => ({
      kind: Fx.Star,
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
      z: 0,
      r: 1,
      r2: 0,
      w: 1,
      ang: 0,
      age: 0,
      dur: 0.3,
      wait: 0,
      color: '#fff',
      light: '#fff',
      k: 1,
      seed: 0,
      follow: -1,
      ox: 0,
      oy: 0,
      area: NO_AREA,
      n: 0,
      flip: 1,
      impact: Impact.None,
      sparks: true,
      follow2: -1,
      text: '',
    }),
    // 기획 13차: multi-beat skills (3 players' renewed drags / ults at once) need more room than the old 220
    360,
  );
  private seedN = 1;

  clear(): void {
    this.pool.clear();
  }

  /** New record with defaults; caller sets what it needs. */
  add(kind: Fx, x: number, y: number, dur: number, color: string, k = 1): Sfx {
    const f = this.pool.spawn();
    f.kind = kind;
    f.x = x;
    f.y = y;
    f.x2 = x;
    f.y2 = y;
    f.z = 0;
    f.r = 1;
    f.r2 = 0;
    f.w = 1;
    f.ang = 0;
    f.age = 0;
    f.dur = dur;
    f.wait = 0;
    f.color = color;
    f.light = lighten(color, 0.55);
    f.k = k;
    f.seed = this.seedN++ % 9973;
    f.follow = -1;
    f.ox = 0;
    f.oy = 0;
    f.area = NO_AREA;
    f.n = 0;
    f.flip = 1;
    f.impact = Impact.None;
    f.sparks = true;
    f.follow2 = -1;
    f.text = '';
    return f;
  }

  update(dt: number, host: FxHost, memos: Map<number, UnitMemo>): void {
    const ps = this.pool;
    for (let i = ps.count - 1; i >= 0; i--) {
      const f = ps.items[i];
      if (f.wait > 0) {
        f.wait -= dt;
        if (f.wait > 0) continue;
        this.onStart(f, host, memos);
        continue;
      }
      f.age += dt;
      if (f.kind === Fx.Notes || f.kind === Fx.Aura || f.kind === Fx.Snow) this.emitOngoing(f, host, memos, dt);
      if (f.age >= f.dur) {
        this.onEnd(f, host);
        ps.kill(i);
      }
    }
  }

  /** World anchor of an effect this frame (follows its entity while that one is known). */
  at(f: Sfx, memos: Map<number, UnitMemo>): { x: number; y: number } {
    if (f.follow >= 0) {
      const m = memos.get(f.follow);
      if (m) {
        f.x = m.x;
        f.y = m.y;
      }
    }
    TMP.x = f.x + f.ox;
    TMP.y = f.y + f.oy;
    return TMP;
  }

  /** Effects that start after `wait` (sequenced hits) get their burst at that moment. */
  private onStart(f: Sfx, host: FxHost, memos: Map<number, UnitMemo>): void {
    if (!f.sparks) return;
    const p = this.at(f, memos);
    switch (f.kind) {
      case Fx.XSlash:
      case Fx.Slash:
        host.burst(p.x, p.y, f.z, Math.round(5 * f.k), f.light, 2.4, 1.6, 0.3);
        break;
      case Fx.Star:
        host.burst(p.x, p.y, f.z, Math.round(8 * f.k), f.light, 3, 2.5, 0.35);
        break;
      default:
        break;
    }
  }

  private onEnd(f: Sfx, host: FxHost): void {
    if (f.impact === Impact.None) return;
    const k = f.k;
    switch (f.impact) {
      case Impact.Fire: {
        const r = Math.max(0.8, f.r);
        host.flash(f.x2, f.y2, f.x2, f.y2, { shape: 'circle', radius: r }, 0.45, '#ff7b00', 0.9 * k);
        host.ring(f.x2, f.y2, 0.2, r * 1.15, 0.4, '#ffd166', 5, 0.25 * k);
        host.burst(f.x2, f.y2, 0.2, Math.round(16 * k), '#ff9e3d', r * 2.4, 4, 0.55);
        host.burst(f.x2, f.y2, 0.1, Math.round(8 * k), '#ffe8a3', r * 1.6, 2.5, 0.4);
        host.burst(f.x2, f.y2, 0.6, Math.round(5 * k), '#5c4033', 1.2, 1.5, 0.9, -0.8);
        if (k >= 1) host.shake(4);
        break;
      }
      case Impact.Ice: {
        const r = Math.max(0.8, f.r);
        host.flash(f.x2, f.y2, f.x2, f.y2, { shape: 'circle', radius: r }, 0.4, '#a8e8ff', 0.85 * k);
        host.ring(f.x2, f.y2, 0.2, r * 1.1, 0.35, '#ffffff', 4, 0.2 * k);
        host.burst(f.x2, f.y2, 0.4, Math.round(14 * k), '#cdf3ff', r * 2.2, 3, 0.5);
        break;
      }
      case Impact.Shell: {
        host.ring(f.x2, f.y2, 0.1, 1.2, 0.3, '#ffd166', 4, 0.3 * k);
        host.burst(f.x2, f.y2, 0.2, Math.round(9 * k), '#ffb347', 3, 3, 0.45);
        host.burst(f.x2, f.y2, 0.3, Math.round(4 * k), '#6b5b4b', 1.4, 1.5, 0.8, -0.6);
        break;
      }
      case Impact.Holy: {
        host.ring(f.x2, f.y2, 0.2, Math.max(1, f.r), 0.4, '#fff3b0', 4, 0.25 * k);
        host.burst(f.x2, f.y2, 0.3, Math.round(10 * k), '#fff3b0', 2.5, 3, 0.5, 2);
        break;
      }
      default:
        break;
    }
  }

  private emitOngoing(f: Sfx, host: FxHost, memos: Map<number, UnitMemo>, dt: number): void {
    const p = this.at(f, memos);
    // spawn rate ~ n per second
    const want = f.n * dt;
    let count = Math.floor(want);
    if (rnd(f.seed, Math.floor(f.age * 97)) < want - count) count++;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const rr = Math.sqrt(Math.random()) * f.r;
      if (f.kind === Fx.Aura) host.burst(p.x + Math.cos(a) * 0.35, p.y + Math.sin(a) * 0.2, 0.2, 1, Math.random() < 0.5 ? f.color : f.light, 0.3, 3.5, 0.5, -1.5);
      else if (f.kind === Fx.Snow) host.burst(p.x + Math.cos(a) * rr - 0.6, p.y + Math.sin(a) * rr, 2.6 + Math.random(), 1, Math.random() < 0.6 ? '#f4fbff' : '#9ad8ff', 0.25, -1.5, 0.9, 2.5);
    }
  }

  // ─────────────────────────── drawing ───────────────────────────

  /** Ground-level flavour (under the units): waves over footprints, cracks, clock faces, chains, sound rings. */
  drawGround(ctx: CanvasRenderingContext2D, cam: Camera, memos: Map<number, UnitMemo>, time: number): void {
    const ps = this.pool;
    for (let i = 0; i < ps.count; i++) {
      const f = ps.items[i];
      if (f.wait > 0) continue;
      const t = clamp01(f.age / f.dur);
      switch (f.kind) {
        case Fx.Wave:
          this.drawWave(ctx, cam, f, t);
          break;
        case Fx.Crack:
          this.drawCrack(ctx, cam, f, t);
          break;
        case Fx.Clock:
          this.drawClock(ctx, cam, f, t, memos);
          break;
        case Fx.Chains:
          this.drawChains(ctx, cam, f, t, memos);
          break;
        case Fx.Rings:
          this.drawRings(ctx, cam, f, t, memos);
          break;
        case Fx.ShieldWave:
          this.drawShieldWave(ctx, cam, f, t);
          break;
        case Fx.Meteor:
          this.drawMeteorShadow(ctx, cam, f, t);
          break;
        default:
          if (f.kind >= Fx.Fall) drawPartGround(ctx, cam, f, t, this.at(f, memos), memos, time);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Airborne flavour (over the units): beams, arrows, slashes, stars, meteors, pillars, notes, pellets. */
  drawAir(ctx: CanvasRenderingContext2D, cam: Camera, memos: Map<number, UnitMemo>, time: number): void {
    const ps = this.pool;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < ps.count; i++) {
      const f = ps.items[i];
      if (f.wait > 0) continue;
      const t = clamp01(f.age / f.dur);
      switch (f.kind) {
        case Fx.Spin:
          this.drawSpin(ctx, cam, f, t, memos);
          break;
        case Fx.Beam:
          this.drawBeam(ctx, cam, f, t);
          break;
        case Fx.Arrow:
          this.drawArrow(ctx, cam, f, t);
          break;
        case Fx.Star:
          this.drawStar(ctx, cam, f, t, memos);
          break;
        case Fx.Slash:
          this.drawSlash(ctx, cam, f, t, memos);
          break;
        case Fx.XSlash:
          this.drawXSlash(ctx, cam, f, t, memos);
          break;
        case Fx.Meteor:
          this.drawMeteor(ctx, cam, f, t);
          break;
        case Fx.Pillar:
          this.drawPillar(ctx, cam, f, t, memos);
          break;
        case Fx.Notes:
          this.drawNotes(ctx, cam, f, t, memos);
          break;
        case Fx.Pellets:
          this.drawPellets(ctx, cam, f, t);
          break;
        case Fx.Muzzle:
          this.drawMuzzle(ctx, cam, f, t);
          break;
        case Fx.Dome:
          this.drawDome(ctx, cam, f, t, memos);
          break;
        case Fx.Orb:
          this.drawOrb(ctx, cam, f, t, time);
          break;
        case Fx.Aura:
          this.drawAura(ctx, cam, f, t, memos);
          break;
        default:
          if (f.kind >= Fx.Fall) drawPartAir(ctx, cam, f, t, this.at(f, memos), memos, time);
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  // ── ground kinds ──

  /** Shockwave over the exact footprint: the outline sweeps out from the origin of the shape, the fill fades behind. */
  private drawWave(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    TMP.x = f.x;
    TMP.y = f.y;
    const grow = ease(clamp01(t / 0.45));
    const fade = 1 - clamp01((t - 0.35) / 0.65);
    pathArea(ctx, cam, TMP, null, f.area, Math.max(0.02, grow));
    ctx.globalAlpha = 0.32 * fade * f.k;
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.globalAlpha = 0.95 * fade * f.k;
    ctx.lineWidth = 5;
    ctx.strokeStyle = f.light;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  /** Jagged ground cracks fanning out (berserker): grow fast, glow, then fade. */
  private drawCrack(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const grow = ease(clamp01(t / 0.18));
    const fade = 1 - clamp01((t - 0.4) / 0.6);
    const n = f.n;
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const a = f.ang + (n === 1 ? 0 : (j / (n - 1) - 0.5) * f.w) + (rnd(f.seed, j) - 0.5) * 0.12;
      const len = f.r * (0.7 + 0.3 * rnd(f.seed, j + 40)) * grow;
      let px = f.x;
      let py = f.y;
      ctx.moveTo(cam.sx(px), cam.sy(py));
      const segs = 5;
      for (let s = 1; s <= segs; s++) {
        const d = (len * s) / segs;
        const jit = (rnd(f.seed, j * 13 + s) - 0.5) * 0.5;
        px = f.x + Math.cos(a) * d - Math.sin(a) * jit;
        py = f.y + Math.sin(a) * d + Math.cos(a) * jit;
        ctx.lineTo(cam.sx(px), cam.sy(py));
      }
    }
    ctx.globalAlpha = 0.85 * fade * f.k;
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#1a0d08';
    ctx.stroke();
    ctx.globalAlpha = (0.6 + 0.4 * (1 - t)) * fade * f.k;
    ctx.lineWidth = 3;
    ctx.strokeStyle = t < 0.5 ? '#ffd166' : f.color;
    ctx.stroke();
  }

  /** Clock face on the ground (chrono): ring + 12 ticks + two hands sweeping fast, rippling out as it fades. */
  private drawClock(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const appear = ease(clamp01(t / 0.2));
    const fade = 1 - clamp01((t - 0.6) / 0.4);
    const R = f.r * (0.85 + 0.15 * appear);
    const rx = R * PX_PER_UNIT;
    const ry = R * PX_PER_UNIT_Y;
    ctx.globalAlpha = 0.18 * fade * f.k;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.9 * fade * f.k;
    ctx.lineWidth = 3;
    ctx.strokeStyle = f.light;
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = j % 3 === 0 ? 0.8 : 0.88;
      ctx.moveTo(sx + c * rx * r0, sy + s * ry * r0);
      ctx.lineTo(sx + c * rx * 0.97, sy + s * ry * 0.97);
    }
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // hands: the minute hand sweeps a full turn, the hour hand a quarter
    const am = -Math.PI / 2 + t * TAU * 1.5 * f.flip;
    const ah = -Math.PI / 2 + t * TAU * 0.25 * f.flip;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(am) * rx * 0.78, sy + Math.sin(am) * ry * 0.78);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ah) * rx * 0.5, sy + Math.sin(ah) * ry * 0.5);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // ripple ring
    const k = (t * 1.6) % 1;
    ctx.globalAlpha = 0.6 * (1 - k) * fade * f.k;
    ctx.lineWidth = 2;
    ctx.strokeStyle = f.light;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * (1 + k * 0.35), ry * (1 + k * 0.35), 0, 0, TAU);
    ctx.stroke();
  }

  /** Chain links on a ring that closes from the outer radius to the inner one (warden pull). */
  private drawChains(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const close = ease(clamp01(t / 0.5));
    const fade = 1 - clamp01((t - 0.55) / 0.45);
    const R = f.r + (f.r2 - f.r) * close;
    const rx = R * PX_PER_UNIT;
    const ry = R * PX_PER_UNIT_Y;
    const n = Math.max(10, Math.round(R * 7));
    const spin = t * 1.4 * f.flip;
    // inward pull lines
    ctx.globalAlpha = 0.5 * fade * f.k;
    ctx.lineWidth = 2;
    ctx.strokeStyle = f.light;
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * TAU + spin * 0.5;
      ctx.moveTo(sx + Math.cos(a) * rx, sy + Math.sin(a) * ry);
      ctx.lineTo(sx + Math.cos(a) * rx * 0.55, sy + Math.sin(a) * ry * 0.55);
    }
    ctx.stroke();
    // links (alternate orientation)
    for (let j = 0; j < n; j++) {
      const a = (j / n) * TAU + spin;
      const cx = sx + Math.cos(a) * rx;
      const cy = sy + Math.sin(a) * ry;
      const tang = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx);
      ctx.globalAlpha = 0.95 * fade * f.k;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, j % 2 ? 2.2 : 3.6, tang, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#2b3320';
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = j % 2 ? f.light : '#e8f0d0';
      ctx.stroke();
    }
  }

  /** Concentric rings rippling out (bard sound waves, cleric blessing, chrono ripples). r2 < r = contracting. */
  private drawRings(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const n = Math.max(1, f.n);
    for (let j = 0; j < n; j++) {
      const k = clamp01((t - j * (0.5 / n)) / 0.55);
      if (k <= 0 || k >= 1) continue;
      const R = f.r2 + (f.r - f.r2) * ease(k);
      ctx.globalAlpha = (1 - k) * 0.9 * f.k;
      ctx.lineWidth = f.w * (1 - k * 0.6);
      ctx.strokeStyle = j % 2 ? f.light : f.color;
      ctx.beginPath();
      ctx.ellipse(sx, sy, Math.max(1, R * PX_PER_UNIT), Math.max(1, R * PX_PER_UNIT_Y), 0, 0, TAU);
      ctx.stroke();
    }
  }

  /** Spin slash around the caster: two bright crescents sweeping 1¼ turns at the skill radius. */
  private drawSpin(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y) - f.z * PX_PER_UNIT_Z;
    const rx = f.r * PX_PER_UNIT;
    const ry = f.r * PX_PER_UNIT_Y;
    const head = f.ang + ease(t) * TAU * 1.25 * f.flip;
    const fade = 1 - clamp01((t - 0.55) / 0.45);
    const tail = 2.4;
    for (let j = 0; j < 2; j++) {
      const h = head + j * Math.PI;
      // tapered crescent: several arcs, thicker and whiter near the head
      for (let s = 0; s < 4; s++) {
        const a1 = h;
        const a0 = h - f.flip * tail * (1 - s * 0.24);
        ctx.globalAlpha = (0.35 + s * 0.2) * fade * f.k;
        ctx.lineWidth = 4 + s * 3.5;
        ctx.strokeStyle = s === 3 ? '#ffffff' : s === 2 ? f.light : f.color;
        ctx.beginPath();
        if (f.flip > 0) ctx.ellipse(sx, sy, rx, ry, 0, a0, a1);
        else ctx.ellipse(sx, sy, rx, ry, 0, a1, a0);
        ctx.stroke();
      }
    }
  }

  /** Two shield-shaped wavefronts sliding out to both ends of a band (guardian/bard). */
  private drawShieldWave(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const go = ease(clamp01(t / 0.55));
    const fade = 1 - clamp01((t - 0.5) / 0.5);
    const ux = Math.cos(f.ang);
    const uy = Math.sin(f.ang);
    const half = f.r / 2;
    const hw = f.w / 2;
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const d = Math.max(0, go * half - j * 0.45);
        if (d <= 0) continue;
        const cx = f.x + ux * d * side;
        const cy = f.y + uy * d * side;
        // a bowed front across the band (perpendicular), curving forward in the travel direction
        const px = -uy;
        const py = ux;
        const bow = 0.35 * side;
        ctx.beginPath();
        ctx.moveTo(cam.sx(cx + px * hw), cam.sy(cy + py * hw));
        ctx.quadraticCurveTo(cam.sx(cx + ux * bow * 2), cam.sy(cy + uy * bow * 2), cam.sx(cx - px * hw), cam.sy(cy - py * hw));
        ctx.globalAlpha = (j === 0 ? 0.95 : 0.45 - j * 0.1) * fade * f.k;
        ctx.lineWidth = j === 0 ? 6 : 3;
        ctx.strokeStyle = j === 0 ? '#ffffff' : f.light;
        ctx.stroke();
        if (j === 0) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = f.color;
          ctx.stroke();
        }
      }
    }
  }

  private drawMeteorShadow(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const sx = cam.sx(f.x2);
    const sy = cam.sy(f.y2);
    const r = Math.max(0.4, f.r) * (0.3 + 0.7 * t);
    ctx.globalAlpha = 0.35 * t * f.k;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
    ctx.fill();
  }

  // ── air kinds ──

  private drawBeam(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const ext = ease(clamp01(t / 0.18));
    const fade = 1 - clamp01((t - 0.25) / 0.75);
    const zp = f.z * PX_PER_UNIT_Z;
    const x0 = cam.sx(f.x);
    const y0 = cam.sy(f.y) - zp;
    const x1 = cam.sx(f.x + (f.x2 - f.x) * ext);
    const y1 = cam.sy(f.y + (f.y2 - f.y) * ext) - zp;
    const wpx = f.w * PX_PER_UNIT * 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.globalAlpha = 0.35 * fade * f.k;
    ctx.lineWidth = wpx * (1 + 0.5 * (1 - fade));
    ctx.strokeStyle = f.color;
    ctx.stroke();
    ctx.globalAlpha = 0.8 * fade * f.k;
    ctx.lineWidth = Math.max(3, wpx * 0.4);
    ctx.strokeStyle = f.light;
    ctx.stroke();
    ctx.globalAlpha = fade * f.k;
    ctx.lineWidth = Math.max(1.5, wpx * 0.14);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  /** A big arrow (ranger) flying from (x,y) to (x2,y2) with a streak behind it. */
  private drawArrow(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const zp = f.z * PX_PER_UNIT_Z;
    const k = clamp01(t / 0.7);
    const hx = f.x + (f.x2 - f.x) * k;
    const hy = f.y + (f.y2 - f.y) * k;
    const fade = 1 - clamp01((t - 0.7) / 0.3);
    const x0 = cam.sx(f.x);
    const y0 = cam.sy(f.y) - zp;
    const x1 = cam.sx(hx);
    const y1 = cam.sy(hy) - zp;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    // streak
    const tail = Math.max(0, k - 0.45);
    const tx = cam.sx(f.x + (f.x2 - f.x) * tail);
    const ty = cam.sy(f.y + (f.y2 - f.y) * tail) - zp;
    ctx.globalAlpha = 0.45 * fade * f.k;
    ctx.lineWidth = 6 * f.r;
    ctx.strokeStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 0.9 * fade * f.k;
    ctx.lineWidth = 2 * f.r;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (k >= 1) return;
    // arrow body
    const L = 26 * f.r;
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(ang);
    ctx.globalAlpha = f.k;
    ctx.lineWidth = 3 * f.r;
    ctx.strokeStyle = '#6b4a2b';
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.fillStyle = '#e9eef5';
    ctx.beginPath();
    ctx.moveTo(6 * f.r, 0);
    ctx.lineTo(-5 * f.r, -5 * f.r);
    ctx.lineTo(-5 * f.r, 5 * f.r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.lineTo(-L - 6 * f.r, -5 * f.r);
    ctx.lineTo(-L + 6 * f.r, 0);
    ctx.lineTo(-L - 6 * f.r, 5 * f.r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Impact star (rays + core flash). r = size in px. */
  private drawStar(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y) - f.z * PX_PER_UNIT_Z;
    const g = ease(t);
    const fade = 1 - t;
    const n = f.n || 8;
    ctx.globalAlpha = fade * f.k;
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const a = f.ang + (j / n) * TAU;
      const r0 = f.r * (0.25 + 0.5 * g);
      const r1 = f.r * (0.6 + 0.6 * g) * (j % 2 ? 0.7 : 1);
      ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
      ctx.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
    }
    ctx.lineWidth = 5 * (1 - t) + 1;
    ctx.strokeStyle = f.color;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (t < 0.4) {
      ctx.globalAlpha = (1 - t / 0.4) * 0.9 * f.k;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, f.r * 0.35 * (1 + t), 0, TAU);
      ctx.fill();
    }
  }

  /**
   * Weapon slash crescent at a point: ang = screen angle of the swing's middle, r = radius (px), flip = sweep sense.
   * Grows over the first 40% (the swing), then thins and fades.
   */
  private drawSlash(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y) - f.z * PX_PER_UNIT_Z;
    const sweep = f.w;
    const g = ease(clamp01(t / 0.4));
    const fade = 1 - clamp01((t - 0.35) / 0.65);
    const a0 = f.ang - (sweep / 2) * f.flip;
    const a1 = a0 + sweep * g * f.flip;
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    if (hi - lo < 0.01) return;
    // outer coloured band → white core
    for (let s = 0; s < 3; s++) {
      ctx.globalAlpha = (s === 2 ? 1 : 0.4 + 0.2 * s) * fade * f.k;
      ctx.lineWidth = (s === 0 ? 11 : s === 1 ? 6 : 2.5) * (f.n > 0 ? 1.4 : 1) * (1 - 0.4 * t);
      ctx.strokeStyle = s === 2 ? '#ffffff' : s === 1 ? f.light : f.color;
      ctx.beginPath();
      ctx.ellipse(sx, sy, f.r, f.r * 0.62, 0, lo, hi);
      ctx.stroke();
    }
  }

  /** Two crossing slash strokes (shadow / berserker execute). r = half length px. */
  private drawXSlash(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y) - f.z * PX_PER_UNIT_Z;
    const fade = 1 - clamp01((t - 0.4) / 0.6);
    for (let j = 0; j < 2; j++) {
      const k = ease(clamp01((t - j * 0.18) / 0.3));
      if (k <= 0) continue;
      const a = f.ang + (j ? 1 : -1) * 0.75;
      const ux = Math.cos(a) * f.r;
      const uy = Math.sin(a) * f.r;
      const x0 = sx - ux;
      const y0 = sy - uy;
      const x1 = sx - ux + ux * 2 * k;
      const y1 = sy - uy + uy * 2 * k;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.globalAlpha = 0.55 * fade * f.k;
      ctx.lineWidth = 10;
      ctx.strokeStyle = f.color;
      ctx.stroke();
      ctx.globalAlpha = fade * f.k;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  /** Meteor falling from high up toward (x2,y2) during its delay; the impact fires in onEnd. */
  private drawMeteor(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const k = t * t;
    // comes in from the upper left
    const h = (1 - k) * 9;
    const wx = f.x2 - (1 - k) * 2.5;
    const wy = f.y2;
    const x = cam.sx(wx);
    const y = cam.sy(wy) - h * PX_PER_UNIT_Z;
    const tx = cam.sx(wx - 1.2);
    const ty = cam.sy(wy) - (h + 4.2) * PX_PER_UNIT_Z;
    const size = (f.impact === Impact.Shell ? 7 : 13) * (0.75 + 0.25 * k);
    // tail
    ctx.globalAlpha = 0.45 * f.k;
    ctx.lineWidth = size * 1.5;
    ctx.strokeStyle = f.impact === Impact.Shell ? '#9aa5b1' : '#ff7b00';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = 0.8 * f.k;
    ctx.lineWidth = size * 0.7;
    ctx.strokeStyle = f.impact === Impact.Shell ? '#e9ecef' : '#ffd166';
    ctx.stroke();
    // head
    ctx.globalAlpha = f.k;
    ctx.fillStyle = f.impact === Impact.Shell ? '#495057' : '#ff9e3d';
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
    ctx.fillStyle = f.impact === Impact.Shell ? '#ced4da' : '#fff3b0';
    ctx.beginPath();
    ctx.arc(x + size * 0.2, y + size * 0.2, size * 0.5, 0, TAU);
    ctx.fill();
  }

  /** Column of light at a point (holy): a tall tapered beam with a bright core, rising sparks. */
  private drawPillar(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const open = ease(clamp01(t / 0.15));
    const fade = 1 - clamp01((t - 0.4) / 0.6);
    const w = f.r * PX_PER_UNIT * open;
    const h = f.z * PX_PER_UNIT_Z;
    ctx.globalAlpha = 0.35 * fade * f.k;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(sx - w, sy);
    ctx.lineTo(sx - w * 0.55, sy - h);
    ctx.lineTo(sx + w * 0.55, sy - h);
    ctx.lineTo(sx + w, sy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.75 * fade * f.k;
    ctx.fillStyle = f.light;
    ctx.fillRect(sx - w * 0.3, sy - h, w * 0.6, h);
    ctx.globalAlpha = 0.9 * fade * f.k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - w * 0.1, sy - h, w * 0.2, h);
    ctx.globalAlpha = 0.5 * fade * f.k;
    ctx.beginPath();
    ctx.ellipse(sx, sy, w * 1.3, w * 1.3 * 0.55, 0, 0, TAU);
    ctx.fillStyle = f.light;
    ctx.fill();
  }

  /** Musical notes drifting up and outward (bard). */
  private drawNotes(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const n = 6;
    for (let j = 0; j < n; j++) {
      const k = clamp01((t - j * 0.08) / 0.75);
      if (k <= 0 || k >= 1) continue;
      const a = rnd(f.seed, j) * TAU;
      const R = f.r * PX_PER_UNIT * (0.3 + 0.7 * ease(k));
      const x = sx + Math.cos(a) * R;
      const y = sy + Math.sin(a) * R * 0.55 - (30 + 60 * k);
      const s = 1 + 0.3 * Math.sin(k * 12 + j);
      ctx.globalAlpha = (1 - k) * f.k;
      noteGlyph(ctx, x, y, 8 * s, j % 2 ? f.light : '#ffffff', j % 3 === 0);
    }
  }

  /** Shotgun pellets: n tracers fanning out inside the cone. */
  private drawPellets(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const zp = f.z * PX_PER_UNIT_Z;
    const fade = 1 - clamp01((t - 0.3) / 0.7);
    const n = f.n;
    for (let j = 0; j < n; j++) {
      const a = f.ang + (rnd(f.seed, j) - 0.5) * f.w;
      const len = f.r * (0.65 + 0.35 * rnd(f.seed, j + 9));
      const head = ease(clamp01(t / 0.35)) * len;
      const tail = Math.max(0, head - 1.6);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cam.sx(f.x + ux * tail), cam.sy(f.y + uy * tail) - zp);
      ctx.lineTo(cam.sx(f.x + ux * head), cam.sy(f.y + uy * head) - zp);
      ctx.globalAlpha = 0.5 * fade * f.k;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ff9e3d';
      ctx.stroke();
      ctx.globalAlpha = fade * f.k;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff3b0';
      ctx.stroke();
    }
  }

  private drawMuzzle(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number): void {
    const sx = cam.sx(f.x);
    const sy = cam.sy(f.y) - f.z * PX_PER_UNIT_Z;
    const s = f.r * (1 - t * 0.4);
    ctx.globalAlpha = (1 - t) * f.k;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const a = f.ang + (j / 8) * TAU;
      const rr = j % 2 ? s * 0.4 : s * (j === 0 ? 1.6 : 1);
      if (j === 0) ctx.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      else ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, s * 0.35, 0, TAU);
    ctx.fill();
  }

  /** Shield dome over the caster (guardian ult): a squashed hemisphere outline that pops and fades. */
  private drawDome(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const g = ease(clamp01(t / 0.25));
    const fade = 1 - clamp01((t - 0.5) / 0.5);
    const rx = f.r * PX_PER_UNIT * g;
    const ry = f.r * PX_PER_UNIT_Y * g;
    const hz = f.r * PX_PER_UNIT_Z * 0.55 * g;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI);
    ctx.ellipse(sx, sy, rx, hz, 0, Math.PI, TAU);
    ctx.globalAlpha = 0.16 * fade * f.k;
    ctx.fillStyle = f.light;
    ctx.fill();
    ctx.globalAlpha = 0.9 * fade * f.k;
    ctx.lineWidth = 3;
    ctx.strokeStyle = f.light;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * 0.55, hz * 0.95, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  /** Orb flying (x,y)→(x2,y2); impact in onEnd. */
  private drawOrb(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, time: number): void {
    const k = ease(t);
    const wx = f.x + (f.x2 - f.x) * k;
    const wy = f.y + (f.y2 - f.y) * k;
    const z = f.z + Math.sin(k * Math.PI) * 0.8;
    const x = cam.sx(wx);
    const y = cam.sy(wy) - z * PX_PER_UNIT_Z;
    const s = 9 + Math.sin(time * 30) * 1.5;
    ctx.globalAlpha = 0.4 * f.k;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = f.k;
    ctx.fillStyle = f.light;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, s * 0.4, 0, TAU);
    ctx.fill();
  }

  /** Rising flame tongues around the body (berserker rage / ult aura). */
  private drawAura(ctx: CanvasRenderingContext2D, cam: Camera, f: Sfx, t: number, memos: Map<number, UnitMemo>): void {
    const p = this.at(f, memos);
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const fade = Math.min(1, t * 6, (1 - t) * 3);
    const w = f.r * PX_PER_UNIT;
    for (let j = 0; j < 5; j++) {
      const ph = (f.age * 2.2 + j / 5) % 1;
      const x = sx + (j - 2) * w * 0.32 + Math.sin(f.age * 9 + j) * 3;
      const y0 = sy - 4;
      const h = 30 + 30 * (1 - ph);
      ctx.globalAlpha = 0.55 * (1 - ph) * fade * f.k;
      ctx.fillStyle = j % 2 ? f.color : f.light;
      ctx.beginPath();
      ctx.moveTo(x - 6, y0 - ph * 40);
      ctx.quadraticCurveTo(x, y0 - h - ph * 40, x + 6, y0 - ph * 40);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Eighth note: head + stem + flag (double = beamed pair). */
function noteGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, double: boolean): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.28);
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.62, s * 0.45, -0.4, 0, TAU);
  if (double) ctx.ellipse(x + s * 1.4, y - s * 0.3, s * 0.62, s * 0.45, -0.4, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.55, y);
  ctx.lineTo(x + s * 0.55, y - s * 2.2);
  if (double) {
    ctx.moveTo(x + s * 1.95, y - s * 0.3);
    ctx.lineTo(x + s * 1.95, y - s * 2.5);
    ctx.stroke();
    ctx.lineWidth = s * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.55, y - s * 2.2);
    ctx.lineTo(x + s * 1.95, y - s * 2.5);
  } else {
    ctx.quadraticCurveTo(x + s * 1.6, y - s * 1.6, x + s * 1.3, y - s * 0.9);
  }
  ctx.stroke();
}

/** Screen-space angle of a world direction (quarter view squash applied). */
export function screenAngle(dx: number, dy: number): number {
  return Math.atan2(dy * PX_PER_UNIT_Y, dx * PX_PER_UNIT);
}
