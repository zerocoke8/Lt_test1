// Per-skill flavour: maps a skill cast (one action of it) to SkillFx records that match its real footprint.
// Keyed by skill id (`<character>_<n|d|u>`), so every character reads differently: blade slashes, ranger arrows,
// gunner tracers/pellets, mage meteors/ice, cleric/paladin holy light, bard notes, chrono clocks, warden chains,
// guardian shield waves, berserker cracks, shadow X-slashes. Unknown skills fall back to a footprint wave.

import type { AreaShape, GameEvent, SkillAction } from '../types';
import { DIR_VEC, rectFrame } from '../sim/geometry';
import { PX_PER_UNIT } from './camera';
import { DASH_LAND } from './dashtime';
import { Fx, type FxHost, Impact, type Sfx, type SkillFx, dirAngle, screenAngle } from './skillfx';

export type SkillCastEvent = Extract<GameEvent, { type: 'skillCast' }>;

export interface CastInfo {
  ev: SkillCastEvent;
  /** The data action this event is (null for pets/monsters/unknown). */
  action: SkillAction | null;
  /** Caster world position (for dashes: where it landed, i.e. the dash start). */
  ox: number;
  oy: number;
  /** Caster entity id, −1 when none. */
  src: number;
  /** Caster facing sign on screen (+1 right). */
  face: number;
  color: string;
  /** 1 for my casts, OTHER_PLAYER_FX for others. */
  k: number;
  local: boolean;
  /** Dash travel time of this cast, when it dashed. */
  dashTravel: number;
}

const BODY_Z = 0.65;
const GOLD = '#ffd166';
const HOLY = '#fff3b0';
const ICE = '#7fdcff';

export function radiusOf(a: AreaShape): number {
  switch (a.shape) {
    case 'circle':
      return a.radius;
    case 'single':
      return 0.6;
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
  }
}

/** Area wave over the exact footprint. */
export function wave(fx: SkillFx, x: number, y: number, area: AreaShape, dur: number, color: string, k: number, wait = 0): Sfx {
  const f = fx.add(Fx.Wave, x, y, dur, color, k);
  f.area = area;
  f.wait = wait;
  return f;
}

export function star(fx: SkillFx, x: number, y: number, z: number, px: number, color: string, k: number, wait = 0, n = 8): Sfx {
  const f = fx.add(Fx.Star, x, y, 0.28, color, k);
  f.z = z;
  f.r = px;
  f.n = n;
  f.ang = Math.random() * 0.8;
  f.wait = wait;
  return f;
}

export function slash(fx: SkillFx, x: number, y: number, z: number, ang: number, px: number, color: string, k: number, wait = 0, heavy = false): Sfx {
  const f = fx.add(Fx.Slash, x, y, heavy ? 0.3 : 0.22, color, k);
  f.z = z;
  f.ang = ang;
  f.r = px;
  f.w = heavy ? 2.6 : 2.1;
  f.flip = Math.random() < 0.5 ? 1 : -1;
  f.wait = wait;
  f.n = heavy ? 1 : 0;
  return f;
}

export function xslash(fx: SkillFx, x: number, y: number, z: number, px: number, color: string, k: number, wait = 0, ang = 0): Sfx {
  const f = fx.add(Fx.XSlash, x, y, 0.3, color, k);
  f.z = z;
  f.r = px;
  f.ang = ang;
  f.wait = wait;
  return f;
}

export function pillar(fx: SkillFx, x: number, y: number, w: number, h: number, color: string, k: number, dur = 0.6, follow = -1): Sfx {
  const f = fx.add(Fx.Pillar, x, y, dur, color, k);
  f.r = w;
  f.z = h;
  f.follow = follow;
  return f;
}

export function rings(fx: SkillFx, x: number, y: number, from: number, to: number, n: number, dur: number, color: string, k: number, follow = -1, width = 4): Sfx {
  const f = fx.add(Fx.Rings, x, y, dur, color, k);
  f.r2 = from;
  f.r = to;
  f.n = n;
  f.w = width;
  f.follow = follow;
  return f;
}

export function clock(fx: SkillFx, x: number, y: number, r: number, dur: number, color: string, k: number, follow = -1): Sfx {
  const f = fx.add(Fx.Clock, x, y, dur, color, k);
  f.r = r;
  f.flip = 1;
  f.follow = follow;
  return f;
}

export function chains(fx: SkillFx, x: number, y: number, outer: number, inner: number, dur: number, color: string, k: number, follow = -1): Sfx {
  const f = fx.add(Fx.Chains, x, y, dur, color, k);
  f.r = outer;
  f.r2 = inner;
  f.flip = Math.random() < 0.5 ? 1 : -1;
  f.follow = follow;
  return f;
}

export function notes(fx: SkillFx, x: number, y: number, r: number, color: string, k: number, follow = -1): Sfx {
  const f = fx.add(Fx.Notes, x, y, 1.1, color, k);
  f.r = r;
  f.follow = follow;
  return f;
}

export function arrow(fx: SkillFx, x0: number, y0: number, x1: number, y1: number, dur: number, size: number, color: string, k: number, wait = 0): Sfx {
  const f = fx.add(Fx.Arrow, x0, y0, dur, color, k);
  f.x2 = x1;
  f.y2 = y1;
  f.z = 0.7;
  f.r = size;
  f.wait = wait;
  return f;
}

export function beam(fx: SkillFx, x0: number, y0: number, x1: number, y1: number, w: number, dur: number, color: string, k: number, wait = 0): Sfx {
  const f = fx.add(Fx.Beam, x0, y0, dur, color, k);
  f.x2 = x1;
  f.y2 = y1;
  f.z = 0.7;
  f.w = w;
  f.wait = wait;
  return f;
}

export function muzzle(fx: SkillFx, x: number, y: number, z: number, px: number, ang: number, color: string, k: number): Sfx {
  const f = fx.add(Fx.Muzzle, x, y, 0.1, color, k);
  f.z = z;
  f.r = px;
  f.ang = ang;
  return f;
}

export function fall(fx: SkillFx, x: number, y: number, r: number, wait: number, dur: number, impact: Impact, color: string, k: number): void {
  const f = fx.add(Fx.Meteor, x, y, dur, color, k);
  f.x2 = x;
  f.y2 = y;
  f.r = r;
  f.wait = wait;
  f.impact = impact;
}

/** End of a 'line' action: from the caster toward the center, `length` long (sim: rect from origin toward center). */
function lineEnd(c: CastInfo, length: number): { x: number; y: number; ux: number; uy: number } {
  let dx = c.ev.center.x - c.ox;
  let dy = c.ev.center.y - c.oy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) {
    dx = c.face;
    dy = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  return { x: c.ox + dx * length, y: c.oy + dy * length, ux: dx, uy: dy };
}

/**
 * Spawns the flavour for one cast event. `host` gives the particle/flash layer. Returns true when the skill has its own
 * impact look (the caller then skips the generic area flash).
 */
export function castFx(fx: SkillFx, host: FxHost, c: CastInfo): boolean {
  const ev = c.ev;
  const a = ev.area;
  const cx = ev.center.x;
  const cy = ev.center.y;
  const k = c.k;
  const col = c.color;
  const wait = ev.delay ?? 0;
  const hits = Math.max(1, ev.hits ?? 1);
  const every = ev.hitInterval ?? 0.2;
  const affects = c.action?.affects ?? 'enemies';
  const id = ev.skillId;
  const big = ev.slot === 'drag' || ev.slot === 'ult';

  // self-only parts (shields, cooldown cuts): a small bubble on the caster if it shields, otherwise nothing.
  // A whole skill that only buffs the caster (버서커 광란) keeps its own look below.
  if (affects === 'self' && id !== 'berserker_u') {
    const shield = c.action?.effects.some(e => e.kind === 'shield');
    if (shield && c.src >= 0) {
      const d = fx.add(Fx.Dome, c.ox, c.oy, 0.6, '#cfe8ff', k);
      d.r = 0.9;
      d.follow = c.src;
    }
    return true;
  }

  switch (id) {
    // ───────── tanks ─────────
    case 'guardian_n':
      star(fx, cx, cy, BODY_Z, 30, '#cfe8ff', k, 0, 10);
      host.ring(cx, cy, 0.2, 1.1, 0.3, '#cfe8ff', 4, 0.2 * k);
      if (c.local) host.shake(3);
      return true;
    case 'guardian_d': {
      const sw = fx.add(Fx.ShieldWave, cx, cy, 0.55, col, k);
      sw.ang = a.shape === 'rect' ? dirAngle(a.dir) : 0;
      sw.r = a.shape === 'rect' ? a.length : 6;
      sw.w = a.shape === 'rect' ? a.width : 2;
      wave(fx, cx, cy, a, 0.5, col, k);
      return true;
    }
    case 'guardian_u':
      if (affects === 'allies') {
        const d = fx.add(Fx.Dome, cx, cy, 0.9, '#cfe8ff', k);
        d.r = Math.min(radiusOf(a), 6);
        d.follow = c.src;
      } else {
        rings(fx, cx, cy, radiusOf(a), 0.5, 3, 0.6, col, k, c.src, 5);
        star(fx, cx, cy, BODY_Z, 46, '#cfe8ff', k, 0.25, 12);
      }
      return true;
    case 'paladin_n':
      if (affects === 'enemies') {
        pillar(fx, cx, cy, 0.55, 3.6, GOLD, k, 0.5);
        star(fx, cx, cy, BODY_Z, 30, HOLY, k);
      }
      return true;
    case 'paladin_d':
      if (affects === 'enemies') {
        wave(fx, cx, cy, a, 0.7, GOLD, k);
        pillar(fx, cx, cy, 0.8, 5, GOLD, k, 0.7);
        star(fx, cx, cy, 0.3, 40, HOLY, k, 0, 12);
      } else rings(fx, cx, cy, 0.4, radiusOf(a), 1, 0.6, HOLY, k * 0.6);
      return true;
    case 'paladin_u':
      if (affects === 'enemies') {
        wave(fx, cx, cy, a, 0.8, GOLD, k);
        pillar(fx, cx, cy, 1.1, 7, GOLD, k, 0.9, c.src);
      } else {
        const d = fx.add(Fx.Dome, cx, cy, 0.9, HOLY, k);
        d.r = Math.min(radiusOf(a), 6);
        d.follow = c.src;
      }
      return true;
    case 'warden_n':
      if (a.shape === 'ring') chains(fx, cx, cy, a.outer, a.inner + 0.3, 0.5, col, k, c.src);
      wave(fx, cx, cy, a, 0.4, col, k * 0.7);
      return true;
    case 'warden_d':
    case 'warden_u':
      if (a.shape === 'ring') chains(fx, cx, cy, a.outer, Math.max(0.7, a.inner + 0.2), id === 'warden_u' ? 0.85 : 0.7, col, k, id === 'warden_u' ? c.src : -1);
      wave(fx, cx, cy, a, 0.5, col, k);
      if (c.local) host.shake(id === 'warden_u' ? 6 : 4);
      return true;

    // ───────── melee ─────────
    case 'blade_n': {
      const s = fx.add(Fx.Spin, cx, cy, 0.34, col, k);
      s.r = radiusOf(a);
      s.z = 0.25;
      s.flip = c.face;
      s.ang = Math.PI * 0.5;
      s.follow = c.src;
      host.ring(cx, cy, 0.4, radiusOf(a), 0.3, '#ffffff', 3, 0.1 * k);
      return true;
    }
    case 'blade_d': {
      // slashes along the dash path, timed with the streak head
      const len = a.shape === 'rect' ? a.length : 6;
      const u = a.shape === 'rect' ? DIR_VEC[a.dir] : { x: 1, y: 0 };
      const travel = c.dashTravel || 0.18;
      for (let i = 0; i < 4; i++) {
        const d = ((i + 0.6) / 4) * len;
        slash(fx, cx + u.x * d, cy + u.y * d, BODY_Z, (i % 2 ? 0.5 : -0.5) + screenAngle(u.x, u.y) + Math.PI / 2, 44, i % 2 ? '#ffffff' : col, k, DASH_LAND + travel * ((i + 0.6) / 4), true);
      }
      wave(fx, cx, cy, a, 0.55, col, k, DASH_LAND);
      return true;
    }
    case 'blade_u':
      // a storm of blades around the caster: two big crossing slashes per hit, following it
      for (let i = 0; i < hits; i++) {
        for (let j = 0; j < 2; j++) {
          const ang = Math.random() * Math.PI * 2;
          const rr = (0.3 + Math.random() * 0.6) * radiusOf(a) * 0.75;
          const f = fx.add(Fx.Slash, cx, cy, 0.26, j ? '#ffffff' : col, k);
          f.z = BODY_Z;
          f.ang = Math.random() * Math.PI * 2;
          f.r = 40 + Math.random() * 22;
          f.w = 2.4;
          f.n = 1;
          f.flip = j ? 1 : -1;
          f.wait = i * every + j * every * 0.45;
          f.follow = c.src;
          f.ox = Math.cos(ang) * rr;
          f.oy = Math.sin(ang) * rr * 0.7;
        }
      }
      {
        const s = fx.add(Fx.Spin, cx, cy, 0.4, col, k);
        s.r = radiusOf(a);
        s.z = 0.3;
        s.flip = c.face;
        s.follow = c.src;
      }
      return true;
    case 'berserker_n':
      xslash(fx, cx, cy, BODY_Z, 36, '#ff5a36', k, 0, 0);
      star(fx, cx, cy, BODY_Z, 34, '#ffb199', k, 0.08, 10);
      if (c.local) host.shake(5);
      return true;
    case 'berserker_d': {
      const cr = fx.add(Fx.Crack, cx, cy, 1.3, '#ff7a45', k);
      cr.ang = a.shape === 'cone' ? dirAngle(a.dir) : 0;
      cr.w = a.shape === 'cone' ? (a.angle * Math.PI) / 180 : 1.6;
      cr.r = radiusOf(a);
      cr.n = 7;
      wave(fx, cx, cy, a, 0.5, col, k);
      if (c.local) host.shake(7);
      return true;
    }
    case 'berserker_u': {
      const au = fx.add(Fx.Aura, cx, cy, 1.8, '#ff3b1f', k);
      au.r = 0.6;
      au.n = 22;
      au.follow = c.src;
      rings(fx, cx, cy, 0.3, 2.4, 2, 0.5, '#ff3b1f', k, c.src, 5);
      return true;
    }
    case 'shadow_n':
      xslash(fx, cx, cy, BODY_Z, 28, col, k, 0, -0.3);
      star(fx, cx, cy, BODY_Z, 22, '#c9b8ff', k, 0.1, 6);
      return true;
    case 'shadow_d':
      xslash(fx, cx, cy, BODY_Z, 30, col, k, wait, (Math.random() - 0.5) * 0.6);
      wave(fx, cx, cy, a, 0.4, col, k, wait);
      star(fx, cx, cy, 0.3, 30, '#c9b8ff', k, wait, 8);
      return true;
    case 'shadow_u':
      for (let i = 0; i < hits; i++) xslash(fx, cx + (Math.random() - 0.5) * 1.2, cy + (Math.random() - 0.5) * 0.8, BODY_Z, 30, i % 2 ? '#ffffff' : col, k, i * every, i * 0.7);
      wave(fx, cx, cy, a, 0.5, col, k);
      return true;

    // ───────── ranged ─────────
    case 'ranger_n': {
      const len = a.shape === 'line' ? a.length : 9;
      const e = lineEnd(c, len);
      arrow(fx, c.ox, c.oy, e.x, e.y, 0.24, 1.3, col, k);
      beam(fx, c.ox, c.oy, e.x, e.y, a.shape === 'line' ? a.width * 0.35 : 0.4, 0.4, col, k * 0.8, 0.05);
      return true;
    }
    case 'ranger_d': {
      if (a.shape !== 'rect') return false;
      const f = rectFrame(a, ev.center);
      const ex = f.sx + f.ux * f.len;
      const ey = f.sy + f.uy * f.len;
      arrow(fx, f.sx, f.sy, ex, ey, 0.32, 1.9, col, k);
      beam(fx, f.sx, f.sy, ex, ey, a.width * 0.6, 0.5, col, k, 0.06);
      wave(fx, cx, cy, a, 0.45, col, k * 0.8, 0.05);
      return true;
    }
    case 'ranger_u':
      for (let i = 0; i < hits; i++) arrow(fx, c.ox, c.oy, cx + (Math.random() - 0.5) * 0.4, cy + (Math.random() - 0.5) * 0.3, 0.12, 1.1, col, k, i * every);
      return true;
    case 'gunner_n': {
      const len = a.shape === 'line' ? a.length : 8;
      const e = lineEnd(c, len);
      muzzle(fx, c.ox + e.ux * 0.5, c.oy + e.uy * 0.5, 0.7, 16, screenAngle(e.ux, e.uy), '#ffd166', k);
      beam(fx, c.ox, c.oy, e.x, e.y, 0.55, 0.32, '#ff9e3d', k);
      return true;
    }
    case 'gunner_d': {
      const ang = a.shape === 'cone' ? dirAngle(a.dir) : Math.PI;
      const pe = fx.add(Fx.Pellets, cx, cy, 0.35, '#ffd166', k);
      pe.ang = ang;
      pe.w = a.shape === 'cone' ? (a.angle * Math.PI) / 180 : 1.2;
      pe.r = radiusOf(a);
      pe.n = 11;
      pe.z = 0.6;
      muzzle(fx, cx + Math.cos(ang) * 0.5, cy + Math.sin(ang) * 0.5, 0.6, 26, screenAngle(Math.cos(ang), Math.sin(ang)), '#ffd166', k);
      wave(fx, cx, cy, a, 0.4, col, k);
      if (c.local) host.shake(5);
      return true;
    }
    case 'gunner_u': {
      const R = radiusOf(a);
      for (let i = 0; i < hits; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * R * 0.85;
        fall(fx, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 0.6, i * every, 0.2, Impact.Shell, '#adb5bd', k);
      }
      return true;
    }
    case 'mage_n': {
      const o = fx.add(Fx.Orb, c.ox, c.oy, 0.14, ICE, k);
      o.x2 = cx;
      o.y2 = cy;
      o.z = 0.8;
      o.r = radiusOf(a);
      o.impact = Impact.Ice;
      return true;
    }
    case 'mage_d':
      fall(fx, cx, cy, radiusOf(a), Math.max(0, wait - 0.32), Math.min(0.32, Math.max(0.12, wait)), Impact.Fire, '#ff7b00', k);
      return true;
    case 'mage_u': {
      const s = fx.add(Fx.Snow, cx, cy, c.action?.zone?.duration ?? 5, '#e8f8ff', k);
      s.r = radiusOf(a);
      s.n = 70 * k;
      rings(fx, cx, cy, 0.5, radiusOf(a), 2, 0.6, ICE, k);
      host.flash(cx, cy, cx, cy, a, 0.5, ICE, 0.7 * k);
      return true;
    }

    // ───────── support ─────────
    case 'cleric_n':
      rings(fx, cx, cy, 0.5, radiusOf(a), 3, 0.8, GOLD, k, c.src);
      pillar(fx, cx, cy, 0.45, 2.6, HOLY, k, 0.5, c.src);
      return true;
    case 'cleric_d':
      if (c.action?.zone) return true; // the zone itself is drawn by the renderer
      pillar(fx, cx, cy, 0.9, 5.5, HOLY, k, 0.75);
      rings(fx, cx, cy, 0.4, radiusOf(a), 2, 0.6, '#52d273', k);
      return true;
    case 'cleric_u':
      pillar(fx, cx, cy, 1.2, 8, HOLY, k, 1, c.src);
      rings(fx, cx, cy, 0.5, 13, 3, 1.1, GOLD, k, c.src, 6);
      return true;
    case 'bard_n':
      rings(fx, cx, cy, 0.5, radiusOf(a), 3, 0.8, col, k, c.src);
      notes(fx, cx, cy, 1.4, col, k, c.src);
      return true;
    case 'bard_d': {
      const sw = fx.add(Fx.ShieldWave, cx, cy, 0.6, col, k);
      sw.ang = a.shape === 'rect' ? dirAngle(a.dir) : Math.PI / 2;
      sw.r = a.shape === 'rect' ? a.length : 12;
      sw.w = a.shape === 'rect' ? a.width : 2.6;
      notes(fx, cx, cy, 1.2, col, k);
      wave(fx, cx, cy, a, 0.5, col, k * 0.8);
      return true;
    }
    case 'bard_u':
      rings(fx, cx, cy, 0.5, 12, 4, 1.1, col, k, c.src, 6);
      notes(fx, cx, cy, 2.4, col, k, c.src);
      return true;
    case 'chrono_n':
      clock(fx, cx, cy, 1.2, 0.7, col, k);
      wave(fx, cx, cy, a, 0.45, col, k);
      return true;
    case 'chrono_d':
      clock(fx, cx, cy, 2.3, 1.0, col, k);
      wave(fx, cx, cy, a, 0.55, col, k);
      rings(fx, cx, cy, radiusOf(a) + 0.8, 0.5, 2, 0.7, '#ffffff', k * 0.7);
      return true;
    case 'chrono_u':
      clock(fx, cx, cy, Math.min(4.5, radiusOf(a) * 0.55), 1.3, col, k, c.src);
      rings(fx, cx, cy, radiusOf(a), 0.6, 3, 0.9, col, k, c.src, 5);
      return true;

    // ───────── 기획 12차: medic / exorcist / puppeteer ─────────
    case 'medic_n': {
      // a syringe capsule flies to the most hurt ally, then a green '+'
      const o = fx.add(Fx.Orb, c.ox, c.oy, 0.16, MEDIC, k);
      o.x2 = cx;
      o.y2 = cy;
      o.z = 0.8;
      star(fx, cx, cy, BODY_Z, 26, '#7dffb3', k, 0.14, 4);
      return true;
    }
    case 'medic_d':
      medicCross(fx, host, c, cx, cy, a, k);
      return true;
    case 'medic_u':
      // siren rings (teal / white / teal) + a white pillar on the medic
      rings(fx, cx, cy, 0.5, 13, 3, 1.1, MEDIC, k, c.src, 6);
      rings(fx, cx, cy, 0.5, 9, 1, 0.8, '#ffffff', k * 0.8, c.src, 4);
      pillar(fx, cx, cy, 1.1, 7, '#ffffff', k, 0.9, c.src);
      return true;
    case 'exorcist_n': {
      const o = fx.add(Fx.Orb, c.ox, c.oy, 0.16, TALISMAN, k);
      o.x2 = cx;
      o.y2 = cy;
      o.z = 0.8;
      host.ring(cx, cy, 0.3, radiusOf(a), 0.35, INK, 3, 0.12 * k);
      star(fx, cx, cy, BODY_Z, 22, TALISMAN, k, 0.14, 4);
      return true;
    }
    case 'exorcist_d':
      sealCircle(fx, host, cx, cy, a, k, 8, 0.4);
      if (c.local) host.shake(3);
      return true;
    case 'exorcist_u':
      sealCircle(fx, host, cx, cy, a, k, 16, 0.6);
      host.flash(cx, cy, cx, cy, a, 0.25, INK, 0.6 * k);
      if (c.local) host.shake(5);
      return true;
    case 'puppeteer_n':
      beam(fx, c.ox, c.oy, cx, cy, 0.12, 0.45, PUPPET, k);
      star(fx, cx, cy, BODY_Z, 22, PUPPET, k, 0.05, 6);
      return true;
    case 'puppeteer_d':
      // one doll per part: arcs out from the puppeteer, a pink thread stays 0.6 s, a paper puff on landing
      dollThrow(fx, host, c, cx, cy, a, k, wait);
      return true;
    case 'puppeteer_u':
      if (c.action?.summon) dollThrow(fx, host, c, cx, cy, a, k, 0);
      else {
        rings(fx, cx, cy, radiusOf(a), 0.6, 2, 0.8, PUPPET, k, c.src, 5);
        wave(fx, cx, cy, a, 0.6, PUPPET, k * 0.8);
      }
      return true;
    case 'paper_doll_death':
      // the decoy bursts: paper shreds + pink pollen + a ring over its radius
      host.burst(cx, cy, 0.5, 14, HANJI, 3.2, 2.4, 0.7, 6);
      host.burst(cx, cy, 0.5, 10, PUPPET, 2.4, 1.6, 0.8, 2);
      host.ring(cx, cy, 0.3, radiusOf(a), 0.4, PUPPET, 4, 0.18 * k);
      return true;
    default:
      break;
  }
  if (big) wave(fx, cx, cy, a, 0.45, col, k, wait);
  return false;
}

// ─────────────────────────── 기획 12차 helpers ───────────────────────────

const MEDIC = '#2ec4b6';
const INK = '#c1121f';
const TALISMAN = '#ffd23f';
const PUPPET = '#ff5fa2';
const HANJI = '#f3e9d2';

/** 메딕 응급 처치: white-on-teal first-aid cross along the exact arms, a white pillar, '+' stars rising at the arm tips. */
export function medicCross(fx: SkillFx, host: FxHost, c: CastInfo, cx: number, cy: number, a: AreaShape, k: number): void {
  wave(fx, cx, cy, a, 0.7, MEDIC, k);
  wave(fx, cx, cy, a, 0.45, '#ffffff', k * 0.6, 0.08);
  pillar(fx, cx, cy, 0.7, 4.5, '#ffffff', k, 0.6);
  const len = a.shape === 'cross' ? a.length : 3;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    star(fx, cx + dx * len * 0.8, cy + dy * len * 0.8, 0.4, 20, '#7dffb3', k, 0.1, 4);
  }
  host.burst(cx, cy, 0.3, 10, '#7dffb3', 1.2, 2.2, 0.8, -0.4);
  if (c.local) host.shake(2);
}

/** 퇴마사 봉인진: two red ink rings on the band edges, a wave over the band, `n` yellow talismans pinned around it. */
export function sealCircle(fx: SkillFx, host: FxHost, cx: number, cy: number, a: AreaShape, k: number, n: number, dur: number): void {
  const inner = a.shape === 'ring' ? a.inner : 0.6;
  const outer = radiusOf(a);
  host.ring(cx, cy, outer * 0.85, outer, dur + 0.2, INK, 5, 0.05 * k);
  if (inner > 0.2) host.ring(cx, cy, inner * 0.8, inner, dur + 0.2, INK, 4, 0);
  wave(fx, cx, cy, a, dur + 0.15, INK, k);
  const mid = a.shape === 'ring' ? (inner + outer) / 2 : outer * 0.7;
  const turn = Math.random() * Math.PI;
  for (let i = 0; i < n; i++) {
    const ang = turn + (i / n) * Math.PI * 2;
    star(fx, cx + Math.cos(ang) * mid, cy + Math.sin(ang) * mid * 0.85, 0.35, 14, TALISMAN, k, 0.05 + (i / n) * dur * 0.6, 4);
  }
}

/** 퍼펫티어 인형: a paper doll arcs from the puppeteer to the spot, a pink thread lingers, paper puff on landing. */
export function dollThrow(fx: SkillFx, host: FxHost, c: CastInfo, cx: number, cy: number, a: AreaShape, k: number, wait: number): void {
  const o = fx.add(Fx.Orb, c.ox, c.oy, 0.28, HANJI, k);
  o.x2 = cx;
  o.y2 = cy;
  o.z = 0.6;
  o.wait = wait;
  beam(fx, c.ox, c.oy, cx, cy, 0.08, 0.6, PUPPET, k * 0.8, wait);
  if (c.action?.effects.length) wave(fx, cx, cy, a, 0.45, PUPPET, k * 0.8, wait + 0.24);
  star(fx, cx, cy, 0.35, 18, HANJI, k, wait + 0.26, 6);
  if (wait <= 0) host.ring(cx, cy, 0.2, Math.min(1.2, radiusOf(a)), 0.3, HANJI, 3, 0);
  // the doll's lifetime: a thin pink ground ring shrinking until it bursts
  const life = c.action?.summon?.duration ?? 0;
  if (life > 0) host.ring(cx, cy, 0.95, 0.4, life, PUPPET, 2.5, 0);
}

/** Basic-attack swing: a crescent in the attacker's colour across the target, after the wind-up. */
export function swingFx(fx: SkillFx, sx: number, sy: number, tx: number, ty: number, tz: number, color: string, k: number, wait: number, heavy: boolean): void {
  const ang = screenAngle(tx - sx, ty - sy);
  const f = fx.add(Fx.Slash, tx, ty, heavy ? 0.26 : 0.2, color, k);
  f.z = tz;
  // the arc's middle faces back toward the attacker, so the crescent wraps the target from the swing side
  f.ang = ang + Math.PI;
  f.r = Math.max(18, Math.min(34, 0.55 * PX_PER_UNIT));
  f.w = heavy ? 2.4 : 2;
  f.flip = Math.random() < 0.5 ? 1 : -1;
  f.wait = wait;
  f.n = heavy ? 1 : 0;
  f.sparks = false;
}
