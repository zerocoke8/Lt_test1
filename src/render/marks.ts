// 기획 13차 (docs/skill-renewal.md 2-4, 2-7 "StyledTelegraph", "ZoneDecor"): what the renewed skills leave ON the ground.
//   · StyledTelegraph — a delayed beat of a character's drag / ult is warned in the character's colour with its own
//     motif (outline only, no red fill): ranger aim line ›››, mage rune circle, cleric 8 ticks, gunner fans fading by
//     order, chrono shrinking dotted circle, a reticle on follow-a-target beats, a countdown arc on very late ones.
//   · ZoneDecor — the renewed skills' fields are drawn as border decor only (the enemies inside stay visible): hex
//     panels, stakes + sagging chains, a cylindrical cage, lava cracks, blizzard + countdown arc, the sanctuary's 8 ticks
//     going out every 0.5 s, a ring of talismans, the puppet thread.
// Telegraphs and zones carry no skill id (sim types), so the binding is render-side: a delayed skillCast leaves a hint
// (same footprint, near the same spot) that the next new ally telegraph picks up; a zone is bound by its stage's first
// skillStage (hit 0, same centre).

import type { AreaShape, GameEvent, Telegraph, Zone } from '../types';
import { rectFrame } from '../sim/geometry';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { lighten } from './look';
import { TAU, areaReach, pathArea } from './shapes';
import { Pool } from './pool';

export type TeleMotif = 'outline' | 'aim' | 'rune' | 'ticks' | 'fan' | 'clock' | 'reticle' | 'countdown';
export type ZoneDecor = 'hexWall' | 'hexDome' | 'fence' | 'prison' | 'lava' | 'blizzard' | 'sanctuary' | 'talismans' | 'thread';

/** Motif per `skillId:stage` (default 'outline'). */
export const TELE_MOTIF: Readonly<Record<string, TeleMotif>> = {
  'ranger_d:volley': 'aim',
  'ranger_d:pierce': 'aim',
  'mage_d:meteor': 'rune',
  'mage_d:bigmeteor': 'rune',
  'cleric_d:bell': 'ticks',
  'gunner_d:blast1': 'fan',
  'gunner_d:blast2': 'fan',
  'gunner_d:slug': 'fan',
  'chrono_d:rewind': 'clock',
  'ranger_u:rain': 'reticle',
  'ranger_u:skyshot': 'reticle',
  'gunner_u:heavy': 'reticle',
  'shadow_u:moon': 'reticle',
  'warden_u:release': 'countdown',
  'berserker_u:finale': 'countdown',
  'mage_u:freeze': 'countdown',
  'exorcist_u:destroy': 'countdown',
};

/** Decor per zone stage. */
export const ZONE_DECOR: Readonly<Record<string, ZoneDecor>> = {
  'guardian_d:wall': 'hexWall',
  'guardian_u:barrier': 'hexDome',
  'warden_d:fence': 'fence',
  'warden_u:prison': 'prison',
  'mage_d:lava': 'lava',
  'mage_u:blizzard': 'blizzard',
  'cleric_d:sanctuary': 'sanctuary',
  'exorcist_u:storm': 'talismans',
  'puppeteer_d:thread': 'thread',
};

/** Gunner fans: the later the stage, the fainter / more dashed its warning (2-4 "단계별로 흐려지는 부채꼴"). */
const FAN_ORDER: Readonly<Record<string, number>> = { 'gunner_d:blast1': 0, 'gunner_d:blast2': 1, 'gunner_d:slug': 2 };

export interface MarkStyle {
  key: string;
  color: string;
  light: string;
  /** 1 mine, 0.55 others'. */
  k: number;
  motif: TeleMotif;
  decor: ZoneDecor | null;
  /** A second zone of the same stage (ally + enemy twin): drawn by its twin. */
  skip: boolean;
  seen: number;
}

interface Hint {
  key: string;
  x: number;
  y: number;
  area: AreaShape;
  color: string;
  k: number;
  until: number;
  follow: boolean;
}

export class SkillMarks {
  private readonly hints = new Pool<Hint>(() => ({ key: '', x: 0, y: 0, area: { shape: 'single' }, color: '#fff', k: 1, until: 0, follow: false }), 48);
  private readonly teles = new Map<number, MarkStyle>();
  private readonly zones = new Map<number, MarkStyle>();
  private clock = 0;
  private stamp = 0;

  reset(): void {
    this.hints.clear();
    this.teles.clear();
    this.zones.clear();
  }

  /** A delayed beat was cast: its warning (when the sim makes one) gets this look. */
  hint(ev: Extract<GameEvent, { type: 'skillCast' }>, key: string, color: string, k: number): void {
    const h = this.hints.spawn();
    h.key = key;
    h.x = ev.center.x;
    h.y = ev.center.y;
    h.area = ev.area;
    h.color = color;
    h.k = k;
    h.until = this.clock + (ev.delay ?? 0) + 0.2;
    h.follow = !!ev.follow;
  }

  /** A zone stage landed (hit 0): bind the new zone at that spot. */
  bindZone(zones: readonly Zone[], ev: Extract<GameEvent, { type: 'skillStage' }>, key: string, color: string, k: number): void {
    const decor = ZONE_DECOR[key];
    if (!decor) return;
    let twin = false;
    for (const st of this.zones.values()) if (st.key === key && st.seen === -1) twin = true;
    for (const z of zones) {
      if (this.zones.has(z.id)) continue;
      if (Math.abs(z.center.x - ev.center.x) > 0.05 || Math.abs(z.center.y - ev.center.y) > 0.05) continue;
      // the second zone of a twin stage (방패벽: allies' def buff + enemies' slow on the same band) rides along
      const st = style(key, color, k, 'outline', decor);
      st.skip = twin;
      st.seen = -1;
      this.zones.set(z.id, st);
      twin = true;
    }
  }

  /** Per frame: bind new ally telegraphs to the hints, forget gone telegraphs / zones. */
  update(dt: number, teles: readonly Telegraph[], zones: readonly Zone[]): void {
    this.clock += dt;
    const stamp = ++this.stamp;
    for (const t of teles) {
      if (t.team !== 'ally') continue;
      const st = this.teles.get(t.id);
      if (st) {
        st.seen = stamp;
        continue;
      }
      const h = this.takeHint(t);
      if (!h) continue;
      const s = style(h.key, h.color, h.k, TELE_MOTIF[h.key] ?? 'outline', null);
      s.seen = stamp;
      this.teles.set(t.id, s);
    }
    for (const [id, st] of this.teles) if (st.seen !== stamp) this.teles.delete(id);
    for (const z of zones) {
      const st = this.zones.get(z.id);
      if (st) st.seen = stamp;
    }
    for (const [id, st] of this.zones) if (st.seen !== stamp && st.seen !== -1) this.zones.delete(id);
    for (const st of this.zones.values()) if (st.seen === -1) st.seen = stamp;
    const hs = this.hints;
    for (let i = hs.count - 1; i >= 0; i--) if (hs.items[i].until < this.clock) hs.kill(i);
  }

  tele(id: number): MarkStyle | undefined {
    return this.teles.get(id);
  }

  zone(id: number): MarkStyle | undefined {
    return this.zones.get(id);
  }

  /** The closest hint with the same footprint (follow beats may have moved with their target). */
  private takeHint(t: Telegraph): Hint | null {
    const hs = this.hints;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < hs.count; i++) {
      const h = hs.items[i];
      if (!sameArea(h.area, t.area)) continue;
      const d = Math.hypot(h.x - t.center.x, h.y - t.center.y);
      if (d > (h.follow ? 9 : 0.3) || d >= bestD) continue;
      best = i;
      bestD = d;
    }
    if (best < 0) return null;
    const h = hs.items[best];
    const out = TAKEN;
    out.key = h.key;
    out.color = h.color;
    out.k = h.k;
    hs.kill(best);
    return out;
  }
}

const TAKEN: Hint = { key: '', x: 0, y: 0, area: { shape: 'single' }, color: '#fff', k: 1, until: 0, follow: false };

function style(key: string, color: string, k: number, motif: TeleMotif, decor: ZoneDecor | null): MarkStyle {
  return { key, color, light: lighten(color, 0.45), k, motif, decor, skip: false, seen: 0 };
}

function sameArea(a: AreaShape, b: AreaShape): boolean {
  if (a === b) return true;
  if (a.shape !== b.shape) return false;
  return areaReach(a) === areaReach(b);
}

// ─────────────────────────── drawing ───────────────────────────

const NO_DASH: number[] = [];
const DASH_SOFT = [10, 7];
const DOTS = [3, 7];

/**
 * A styled warning (instead of the generic ally fill): the footprint outline in the character colour, a light
 * countdown fill growing in, the motif on top. Urgent (< 0.35 s) it flickers white like the others.
 */
export function drawStyledTelegraph(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, st: MarkStyle, time: number): void {
  const p = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
  const urgent = t.remaining < 0.35;
  const fade = FAN_ORDER[st.key] !== undefined ? 1 - FAN_ORDER[st.key] * 0.28 : 1;
  const k = st.k * fade;
  // 기획 13차 리뷰 (2-4): 퇴마사's big seal circles are outline + talismans only — a filled disc read as a monster warning
  const fill = !st.key.startsWith('exorcist_');
  pathArea(ctx, cam, t.center, t.origin, t.area, 1);
  ctx.globalAlpha = fill ? 0.07 * k : 0;
  ctx.fillStyle = st.color;
  ctx.fill();
  if (FAN_ORDER[st.key] === 2) ctx.setLineDash(DASH_SOFT);
  ctx.globalAlpha = (urgent ? 0.6 + 0.4 * Math.sin(time * 40) : 0.9) * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = urgent ? '#ffffff' : st.light;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  if (p > 0.02) {
    pathArea(ctx, cam, t.center, t.origin, t.area, p);
    ctx.globalAlpha = (fill ? 0.16 : 0) * k;
    ctx.fillStyle = st.color;
    ctx.fill();
    ctx.globalAlpha = 0.7 * k;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = st.color;
    ctx.stroke();
  }
  switch (st.motif) {
    case 'aim':
      aimMotif(ctx, cam, t, k, time);
      break;
    case 'rune':
      runeMotif(ctx, cam, t, st, k, time);
      break;
    case 'ticks':
      ticksMotif(ctx, cam, t, st, k);
      break;
    case 'clock':
      clockMotif(ctx, cam, t, st, k, p);
      break;
    case 'reticle':
      reticleMotif(ctx, cam, t, st, k, p, time);
      break;
    case 'countdown':
      countdownMotif(ctx, cam, t, st, k, p);
      break;
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

function aimMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, k: number, time: number): void {
  if (t.area.shape !== 'rect') return;
  const fr = rectFrame(t.area, t.center);
  const x0 = cam.sx(fr.sx);
  const y0 = cam.sy(fr.sy);
  const len = fr.len * PX_PER_UNIT;
  const step = 40;
  const shift = (time * 160) % step;
  ctx.globalAlpha = 0.9 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  for (let d = shift; d < len - 8; d += step) {
    for (let j = 0; j < 3; j++) {
      const x = x0 + fr.ux * (d + j * 7);
      ctx.moveTo(x - fr.ux * 6, y0 - 7);
      ctx.lineTo(x, y0);
      ctx.lineTo(x - fr.ux * 6, y0 + 7);
    }
  }
  ctx.stroke();
}

function runeMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, st: MarkStyle, k: number, time: number): void {
  const r = t.area.shape === 'circle' ? t.area.radius : 1;
  const sx = cam.sx(t.center.x);
  const sy = cam.sy(t.center.y);
  const rx = r * PX_PER_UNIT * 0.72;
  const ry = r * PX_PER_UNIT_Y * 0.72;
  const spin = time * 2.2;
  ctx.globalAlpha = 0.85 * k;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = st.light;
  ctx.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = spin + (i * 2 * TAU) / 5;
    const x = sx + Math.cos(a) * rx;
    const y = sy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Cleric bell: 8 ticks around the rim, one going out every 1/8 of the wait. */
function ticksMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, st: MarkStyle, k: number): void {
  const r = t.area.shape === 'circle' ? t.area.radius : 3;
  const sx = cam.sx(t.center.x);
  const sy = cam.sy(t.center.y);
  const left = Math.ceil((t.remaining / Math.max(0.01, t.total)) * 8);
  ctx.lineWidth = 5;
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * TAU;
    const on = i < left;
    ctx.globalAlpha = (on ? 0.95 : 0.25) * k;
    ctx.strokeStyle = on ? '#ffffff' : st.color;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * r * PX_PER_UNIT * 0.9, sy + Math.sin(a) * r * PX_PER_UNIT_Y * 0.9);
    ctx.lineTo(sx + Math.cos(a) * r * PX_PER_UNIT * 1.06, sy + Math.sin(a) * r * PX_PER_UNIT_Y * 1.06);
    ctx.stroke();
  }
}

/** Chrono rewind: a dotted circle shrinking toward the middle. */
function clockMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, st: MarkStyle, k: number, p: number): void {
  const r = (t.area.shape === 'circle' ? t.area.radius : 3) * (1 - 0.7 * p);
  ctx.setLineDash(DOTS);
  ctx.globalAlpha = 0.95 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cam.sx(t.center.x), cam.sy(t.center.y), r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  void st;
}

/** Follow-a-target beats: a reticle riding the target, closing in. */
function reticleMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, st: MarkStyle, k: number, p: number, time: number): void {
  const sx = cam.sx(t.center.x);
  const sy = cam.sy(t.center.y) - 0.5 * PX_PER_UNIT_Z;
  const r = 26 * (1.5 - 0.5 * p);
  ctx.globalAlpha = 0.95 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = st.light;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, TAU);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + time * 1.5;
    ctx.moveTo(sx + Math.cos(a) * r * 0.5, sy + Math.sin(a) * r * 0.5);
    ctx.lineTo(sx + Math.cos(a) * r * 1.35, sy + Math.sin(a) * r * 1.35);
  }
  ctx.stroke();
}

/** Late beats (shown only for their last moments): an arc around the footprint filling up. */
function countdownMotif(ctx: CanvasRenderingContext2D, cam: Camera, t: Telegraph, st: MarkStyle, k: number, p: number): void {
  const r = Math.min(8, areaReach(t.area)) + 0.35;
  ctx.globalAlpha = 0.95 * k;
  ctx.lineWidth = 5;
  ctx.strokeStyle = st.light;
  ctx.beginPath();
  ctx.ellipse(cam.sx(t.center.x), cam.sy(t.center.y), r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, -Math.PI / 2, -Math.PI / 2 + TAU * p);
  ctx.stroke();
}

// ── zone decor ──

/** A renewed skill's field: border decor only. */
export function drawZoneDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, st: MarkStyle, time: number): void {
  const fadeIn = z.total > 0 ? Math.min(1, (z.total - z.remaining) / 0.25) : 1;
  const k = st.k * Math.min(1, z.remaining / 0.4, fadeIn);
  const area: AreaShape = z.area ?? CIRCLE_TMP(z.radius);
  switch (st.decor) {
    case 'hexWall':
    case 'hexDome':
      hexDecor(ctx, cam, z, area, st, k, time);
      break;
    case 'fence':
    case 'prison':
      cageDecor(ctx, cam, z, st, k, time, st.decor === 'prison');
      break;
    case 'lava':
      lavaDecor(ctx, cam, z, st, k, time);
      break;
    case 'blizzard':
      blizzardDecor(ctx, cam, z, st, k, time);
      break;
    case 'sanctuary':
      sanctuaryDecor(ctx, cam, z, st, k);
      break;
    case 'talismans':
      talismanDecor(ctx, cam, z, st, k, time);
      break;
    case 'thread':
      threadDecor(ctx, cam, z, area, st, k, time);
      break;
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

const CIRCLE_AREA = { shape: 'circle' as const, radius: 1 };
function CIRCLE_TMP(r: number): AreaShape {
  CIRCLE_AREA.radius = r;
  return CIRCLE_AREA;
}

/** Hex panels on the rim of a band / dome, shimmering; they crack away in the last 0.4 s. */
function hexDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, area: AreaShape, st: MarkStyle, k: number, time: number): void {
  pathArea(ctx, cam, z.center, null, area, 1);
  ctx.globalAlpha = 0.08 * k;
  ctx.fillStyle = st.light;
  ctx.fill();
  ctx.globalAlpha = 0.85 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = st.light;
  ctx.stroke();
  const size = 0.5;
  const crack = z.remaining < 0.4;
  ctx.lineWidth = 2.5;
  if (area.shape === 'rect') {
    const fr = rectFrame(area, z.center);
    const n = Math.max(3, Math.round(fr.len / 0.9));
    const vx = -fr.uy;
    const vy = fr.ux;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const along = ((i + 0.5) / n) * fr.len;
        const x = fr.sx + fr.ux * along + vx * fr.hw * side * 0.8;
        const y = fr.sy + fr.uy * along + vy * fr.hw * side * 0.8;
        hex(ctx, cam, x, y, size, st, k * (crack && (i + side) % 2 ? 0.3 : 0.6 + 0.4 * Math.sin(time * 4 + i)));
      }
    }
  } else {
    const R = area.shape === 'circle' ? area.radius : 2;
    const n = Math.max(8, Math.round(R * 3.2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + time * 0.4;
      hex(ctx, cam, z.center.x + Math.cos(a) * R * 0.9, z.center.y + Math.sin(a) * R * 0.9, size, st, k * (crack && i % 2 ? 0.3 : 0.6 + 0.4 * Math.sin(time * 4 + i)));
    }
    // the dome's top arc
    ctx.globalAlpha = 0.5 * k;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cam.sx(z.center.x), cam.sy(z.center.y), R * PX_PER_UNIT, R * PX_PER_UNIT_Z * 0.55, 0, Math.PI, TAU);
    ctx.stroke();
  }
}

function hex(ctx: CanvasRenderingContext2D, cam: Camera, wx: number, wy: number, size: number, st: MarkStyle, a: number): void {
  const sx = cam.sx(wx);
  const sy = cam.sy(wy);
  const rx = size * PX_PER_UNIT;
  const ry = size * PX_PER_UNIT_Y;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * TAU + Math.PI / 6;
    if (i === 0) ctx.moveTo(sx + Math.cos(ang) * rx, sy + Math.sin(ang) * ry);
    else ctx.lineTo(sx + Math.cos(ang) * rx, sy + Math.sin(ang) * ry);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.85 * a;
  ctx.strokeStyle = st.light;
  ctx.stroke();
}

/**
 * Warden: iron stakes around the rim with sagging chains between them (fence), or a full cylindrical cage of bars
 * (prison) whose bars tremble. The stakes keel over in the last 0.4 s.
 */
function cageDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, st: MarkStyle, k: number, time: number, prison: boolean): void {
  const R = z.area && z.area.shape === 'circle' ? z.area.radius : z.radius;
  const sx = cam.sx(z.center.x);
  const sy = cam.sy(z.center.y);
  const n = prison ? 16 : 8;
  const h = (prison ? 2.4 : 1.1) * PX_PER_UNIT_Z;
  const fall = z.remaining < 0.4 ? 1 - z.remaining / 0.4 : 0;
  ctx.globalAlpha = 0.5 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = st.color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
  // stakes / bars
  ctx.lineWidth = prison ? 4 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const bx = sx + Math.cos(a) * R * PX_PER_UNIT;
    const by = sy + Math.sin(a) * R * PX_PER_UNIT_Y;
    const wob = prison ? Math.sin(time * 30 + i * 1.7) * 1.5 : 0;
    const lean = fall * (i % 2 ? 1 : -1) * h * 0.8;
    ctx.globalAlpha = 0.95 * k;
    ctx.strokeStyle = '#2b3320';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + wob + lean, by - h * (1 - fall * 0.6));
    ctx.stroke();
    ctx.lineWidth = prison ? 2 : 3;
    ctx.strokeStyle = '#9aa5a0';
    ctx.stroke();
    ctx.lineWidth = prison ? 4 : 6;
  }
  // chains: sagging links between stake tops (fence) / the lid ring (prison)
  if (prison) {
    ctx.globalAlpha = 0.9 * k;
    ctx.lineWidth = 4;
    ctx.strokeStyle = st.light;
    ctx.beginPath();
    ctx.ellipse(sx, sy - h * (1 - fall * 0.6), R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
    ctx.stroke();
    return;
  }
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = st.light;
  ctx.globalAlpha = 0.9 * k * (1 - fall);
  ctx.setLineDash(DOTS);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 1) / n) * TAU;
    const x0 = sx + Math.cos(a0) * R * PX_PER_UNIT;
    const y0 = sy + Math.sin(a0) * R * PX_PER_UNIT_Y - h * 0.8;
    const x1 = sx + Math.cos(a1) * R * PX_PER_UNIT;
    const y1 = sy + Math.sin(a1) * R * PX_PER_UNIT_Y - h * 0.8;
    const sag = 10 + Math.sin(time * 6 + i) * 2;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1);
  }
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}

/** Mage lava: a dark rim, glowing cracks pulsing with each 0.5 s tick. */
function lavaDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, st: MarkStyle, k: number, time: number): void {
  const R = z.radius;
  const sx = cam.sx(z.center.x);
  const sy = cam.sy(z.center.y);
  const tick = 1 - ((z.total - z.remaining) % 0.5) / 0.5;
  ctx.globalAlpha = 0.28 * k;
  ctx.fillStyle = '#3a1208';
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = (0.55 + 0.45 * tick * tick) * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ff7b00';
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + z.id;
    let x = sx;
    let y = sy;
    ctx.moveTo(x, y);
    for (let s = 1; s <= 3; s++) {
      const rr = (R * s) / 3.3;
      const j = Math.sin(z.id * 7 + i * 3 + s) * 0.35;
      x = sx + Math.cos(a + j) * rr * PX_PER_UNIT;
      y = sy + Math.sin(a + j) * rr * PX_PER_UNIT_Y;
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 0.8 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffd166';
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
  void st;
  void time;
}

/** Mage blizzard: an icy rim and the countdown arc to 절대영도 filling over the field's 4 s. */
function blizzardDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, st: MarkStyle, k: number, time: number): void {
  const R = z.radius;
  const sx = cam.sx(z.center.x);
  const sy = cam.sy(z.center.y);
  const p = z.total > 0 ? 1 - z.remaining / z.total : 1;
  ctx.globalAlpha = 0.12 * k;
  ctx.fillStyle = '#bfefff';
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.8 * k;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#e8fbff';
  ctx.setLineDash(DASH_SOFT);
  ctx.lineDashOffset = -time * 40;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
  ctx.globalAlpha = 0.95 * k;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#7fdcff';
  ctx.beginPath();
  ctx.ellipse(sx, sy, (R + 0.35) * PX_PER_UNIT, (R + 0.35) * PX_PER_UNIT_Y, 0, -Math.PI / 2, -Math.PI / 2 + TAU * p);
  ctx.stroke();
  void st;
}

/** Cleric sanctuary: a gold rim with 8 ticks; one goes out with every 0.5 s heal. */
function sanctuaryDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, st: MarkStyle, k: number): void {
  const R = z.radius;
  const sx = cam.sx(z.center.x);
  const sy = cam.sy(z.center.y);
  ctx.globalAlpha = 0.1 * k;
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.85 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = st.light;
  ctx.stroke();
  const left = Math.ceil((z.remaining / Math.max(0.01, z.total)) * 8);
  ctx.lineWidth = 5;
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * TAU;
    const on = i < left;
    ctx.globalAlpha = (on ? 0.95 : 0.2) * k;
    ctx.strokeStyle = on ? '#ffffff' : st.color;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * R * PX_PER_UNIT * 0.88, sy + Math.sin(a) * R * PX_PER_UNIT_Y * 0.88);
    ctx.lineTo(sx + Math.cos(a) * R * PX_PER_UNIT * 1.06, sy + Math.sin(a) * R * PX_PER_UNIT_Y * 1.06);
    ctx.stroke();
  }
}

/** Exorcist storm: talismans circling the seal's rim (drawn as small yellow slips), a dark red ring. */
function talismanDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, st: MarkStyle, k: number, time: number): void {
  const R = z.radius;
  const sx = cam.sx(z.center.x);
  const sy = cam.sy(z.center.y);
  ctx.globalAlpha = 0.8 * k;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#c1121f';
  ctx.beginPath();
  ctx.ellipse(sx, sy, R * PX_PER_UNIT, R * PX_PER_UNIT_Y, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#a4161a';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + time * 1.6;
    const rr = R * (0.75 + 0.2 * Math.sin(time * 3 + i));
    const x = sx + Math.cos(a) * rr * PX_PER_UNIT;
    const y = sy + Math.sin(a) * rr * PX_PER_UNIT_Y - (20 + 10 * Math.sin(time * 5 + i));
    ctx.globalAlpha = 0.9 * k;
    ctx.fillRect(x - 4, y - 9, 8, 18);
    ctx.strokeRect(x - 4, y - 9, 8, 18);
  }
  void st;
}

/** Puppeteer thread: a pink thread along the band between the two dolls, trembling; it twangs on each tick. */
function threadDecor(ctx: CanvasRenderingContext2D, cam: Camera, z: Zone, area: AreaShape, st: MarkStyle, k: number, time: number): void {
  if (area.shape !== 'rect') return;
  const fr = rectFrame(area, z.center);
  const tick = 1 - ((z.total - z.remaining) % 1) / 1;
  const x0 = cam.sx(fr.sx);
  const y0 = cam.sy(fr.sy) - 0.6 * PX_PER_UNIT_Z;
  const x1 = cam.sx(fr.sx + fr.ux * fr.len);
  const y1 = cam.sy(fr.sy + fr.uy * fr.len) - 0.6 * PX_PER_UNIT_Z;
  const amp = 2 + 8 * tick * tick;
  ctx.globalAlpha = 0.95 * k;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ff5fa2';
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const s = i / 12;
    const wob = Math.sin(s * Math.PI) * Math.sin(time * 40) * amp;
    const x = x0 + (x1 - x0) * s;
    const y = y0 + (y1 - y0) * s + wob + Math.sin(s * Math.PI) * 6;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.35 * k;
  ctx.lineWidth = 2;
  ctx.setLineDash(DASH_SOFT);
  pathArea(ctx, cam, z.center, null, area, 1);
  ctx.strokeStyle = st.light;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}
