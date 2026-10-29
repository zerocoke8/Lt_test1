// 기획 22차 궁극기 테스트 — 그룹 A의 조준 / 드래그 궁극기 연출. Characters: guardian · paladin · warden · blade ·
// berserker · shadow · ranger · mage. Only the group-A content track edits this file.
//
// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 3장 A1–A16): one story per beat (`<alt>:<stage>`, `<alt>_path:<stage>`) and
// one look per dragged alt, registered at import. The core (render/ultTest/kit.ts) dresses every beat by its role —
// the finisher gets the common climax (stop, zoom, the impact frame …) — and these stories add each character's own
// pictures: today's storyboards aliased where the tables say (the falling shield / cage / spears, the crescent …), the
// wind-ups of each finisher, the chains, cracks, beams and afterimages along the real footprints. Rules kept here:
//  - 보이는 곳 = 맞는 곳: every picture sits on the beat's real spot / band (a band from its real start, a cone from the
//    caster along its real direction); colour fills stay inside the footprint (outside: thin strokes only).
//  - Another player's / a bot's beat: k 0.55 and low detail (the router sets both); screen effects (vignettes, the
//    screen slash) and hops of the camera are mine only.
//  - Particle counts are small (≈ ≤ 120 per cast with the climax) and halve on a struggling phone (FX_LOAD.low).
//
// The 22차 accents (a ring + sparks on the finishers, flashes on the throws) are kept below for 「궁극기 연출 강화」 off.
//
// 기획 24차 (docs/ult-fx.md 8장): no letters — the finishers name no glyph (the core's impact frame took its place);
// 섀도우 드래그 (A12′) and 레인저 조준 / 드래그 (A13′, A14′) redesigned with their data.

import type { AreaShape, GameEvent } from '../../types';
import { ULT_TEST } from '../../data/ultTest/types';
import { GROUND_TOP, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from '../camera';
import { registerUltFx, type UltFxView } from './index';
import {
  FX_LOAD,
  FallObj,
  Fx,
  GOLD,
  HOLY,
  ICE,
  LAVA,
  Pk,
  type SkillFx,
  TetherStyle,
  ULT_FX,
  type UltAltLook,
  type UltBeatInfo,
  type UltHost,
  type UltMoveInfo,
  type UltStory,
  type Vec2,
  aimLine,
  areaFx,
  arrow,
  beam,
  beamAlong,
  chains,
  crackFx,
  crosshairFx,
  eachEnemy,
  fallAt,
  footAlong,
  footprintRadius,
  lightPillar,
  orbFly,
  randomIn,
  registerUltLooks,
  registerUltStories,
  rings,
  rune,
  runStory,
  scorchFx,
  screenAngle,
  selfBubble,
  slash,
  star,
  tetherFx,
  ultAngle,
  ultSpeedLines,
  wave,
  xslash,
} from './kit';

// ─────────────────────────── colours ───────────────────────────

const STEEL = '#cfe0ff';
const STEEL_LIGHT = '#cfe8ff';
const CHAIN = '#c9d6a3';
const CHAIN_LIGHT = '#c7e59a';
const CHAIN_PALE = '#e8f0d0';
const EDGE = '#ffe3ec';
const CRIMSON = '#ff4d6d';
const PETAL = '#ffc2d1';
const EMBER = '#ff9e3d';
const SCORCH = '#3a1a12';
const INK_DARK = '#1b1c3d';
const MOONLIGHT = '#c9b8ff';
const ARROW = '#c9ffe9';
const FEATHER = '#eafff6';
const FROST = '#bdeeff';
const FROST_WHITE = '#e8fbff';
const SHARD = '#cdf3ff';

/** Body height of a unit's middle (slashes, stars on a body). */
const BODY_Z = 0.65;

// ─────────────────────────── small private helpers ───────────────────────────

const P0: Vec2 = { x: 0, y: 0 };
const P1: Vec2 = { x: 0, y: 0 };
const P2: Vec2 = { x: 0, y: 0 };

/** A particle count: × the beat's strength, halved on a struggling phone. */
const cnt = (n: number, k: number) => Math.max(0, Math.round(n * k * (FX_LOAD.low ? 0.5 : 1)));

type Memo = ReturnType<UltHost['enemiesIn']>[number];

const BAND: Extract<AreaShape, { shape: 'rect' }> = { shape: 'rect', dir: 'right', anchor: 'start', length: 1, width: 1, rot: 0 };

/** The enemies a beat's band covers: a 'line' runs from its origin toward its point (tested as that turned rect). */
function bandEnemies(h: UltHost, s: UltBeatInfo): readonly Memo[] {
  const a = s.area;
  if (a.shape !== 'line') return h.enemiesIn(a, s.x, s.y);
  BAND.length = a.length;
  BAND.width = a.width;
  BAND.rot = (Math.atan2(s.y - s.oy, s.x - s.ox) * 180) / Math.PI;
  return h.enemiesIn(BAND, s.ox, s.oy);
}

/** n afterimages of a unit along (x0, y0) → (x1, y1) (the last one at the end), `gap` s apart, × `scale` its size. */
function ghostsAlong(h: UltHost, id: number, x0: number, y0: number, x1: number, y1: number, n: number, dur: number, gap = 0, scale = 1): void {
  if (id < 0) return;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (gap > 0 && i > 1) h.later(gap * (i - 1), () => h.afterimage(id, x, y, dur, scale));
    else h.afterimage(id, x, y, dur, scale);
  }
}

/** 기획 24차 검토: the logical y a picture "on" a target should clear — the boss bar and the raid pattern-tip slot (y 100–177 on the phone). */
const CLEAR_Y = 190;
/**
 * 기획 24차 검토: where a picture "on" its target goes — the beat's spot, pushed toward the camera INSIDE the target's
 * own body (≤ 0.95 × its radius) until the picture at height z clears logical y `minY`. A fixed boss on the top row
 * (엘리베이터: y −1.2, radius 3) put every slash / star / X on it under the boss bar; a small or lower target never moves.
 */
function onBody(h: UltHost, s: UltBeatInfo, z: number, out: Vec2, minY = CLEAR_Y): Vec2 {
  out.x = s.x;
  out.y = s.y;
  const m = s.follow >= 0 ? h.memo(s.follow) : undefined;
  if (!m) return out;
  const sy = GROUND_TOP + s.y * PX_PER_UNIT_Y - z * PX_PER_UNIT_Z;
  if (sy < minY) out.y = s.y + Math.min(m.radius * 0.95, (minY - sy) / PX_PER_UNIT_Y);
  return out;
}

/** A thin glint along a whole line through (x, y) at world angle a, `half` cells each way (outside a footprint: a stroke only). */
function glint(fx: SkillFx, x: number, y: number, a: number, half: number, w: number, dur: number, color: string, k: number, z = 0.15, wait = 0): void {
  const ux = Math.cos(a) * half;
  const uy = Math.sin(a) * half;
  const f = beam(fx, x - ux, y - uy, x + ux, y + uy, w, dur, color, k, wait);
  f.z = z;
}

/** A spray of particles at `n` evenly spaced points of a beat's long axis (t from t0 to t1). */
function sprayAlong(h: UltHost, s: UltBeatInfo, pts: number, each: number, kind: Pk, color: string, speed: number, up: number, dur: number, g = 8, size = 5, t0 = 0.1, t1 = 0.9): void {
  if (each <= 0) return;
  for (let i = 0; i < pts; i++) {
    footAlong(s, pts === 1 ? (t0 + t1) / 2 : t0 + ((t1 - t0) * i) / (pts - 1), P0);
    h.spray(P0.x, P0.y, 0.5, each, kind, color, speed, up, dur, g, size);
  }
}

/** A snowfall over a disc: `n` flakes a second for dur s (the kit's snow is 55 a second — too many inside a climax). */
function snowIn(fx: SkillFx, x: number, y: number, r: number, dur: number, n: number, k: number): void {
  const f = fx.add(Fx.Snow, x, y, dur, '#e8f8ff', k);
  f.r = r;
  f.n = n * k * (FX_LOAD.low ? 0.5 : 1);
}

/** Ice crystals around each enemy in the footprint (follow it), at most `max`. */
function encaseEach(fx: SkillFx, h: UltHost, s: UltBeatInfo, dur: number, max = 6): void {
  eachEnemy(
    h,
    s,
    s.area,
    m => {
      const f = fx.add(Fx.Encase, m.x, m.y, dur, ICE, s.k);
      f.follow = m.id;
      f.n = 0;
      f.r = m.radius;
    },
    max,
  );
}

/**
 * The climax's light pillar, white star, sparks, debris and rising embers at the MIDDLE of a band / fan that starts at
 * the caster (the common grammar puts them on the footprint's anchor = the caster's feet). Used with OFF_ANCHOR below.
 */
function midBurst(fx: SkillFx, h: UltHost, s: UltBeatInfo): void {
  const k = s.k;
  footAlong(s, s.area.shape === 'cone' || s.area.shape === 'fan' ? 0.55 : 0.5, P0);
  const x = P0.x;
  const y = P0.y;
  const th = s.theme;
  const light = s.color;
  lightPillar(fx, x, y, 1.1, 9, '#ffffff', k, 0.6);
  star(fx, x, y, 0.6, 70, '#ffffff', k, 0, 12);
  h.spray(x, y, 0.5, cnt(30, k), th.spark, light, 6, 4.5, 0.8, 8, 6);
  h.spray(x, y, 0.3, cnt(8, k), Pk.Rock, '#5c4f45', 4.5, 5, 0.9, 12, 6);
  const n = cnt(12, k);
  h.later(0.2, () => h.spray(x, y, 0.4, n, th.ember, light, 1.2, 1.2, 1.8, -0.7, 5));
}
/** The grammar's own pillar / star / sparks / debris / embers off (midBurst draws them where the blow really is). */
const OFF_ANCHOR = { pillar: false, star: 0, sparks: 0, debris: 0, embers: 0 } as const;

/**
 * 기획 24차 (8-3 공통): the height (world z) of a picture hung in the sky over ground y (섀도우's moon, 레인저's hawk) whose
 * top rises `px` logical px above its anchor — kept so the top stays under logical y 110 (the boss bar): screen y =
 * 150 + 29.33·y − 42.67·z, so z ≤ 0.6875·y + (40 − px) / 42.67 (the camera's exact ratios: 0.55 / 0.8 and 3 / 128 —
 * the rounded 0.687 / 42.7 of the spec land a hair inside the bar); then clamped to [lo, hi].
 */
function skyZ(y: number, px: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, skyTop(y, px)));
}
const skyTop = (y: number, px: number) => 0.6875 * y + (40 - px) * (3 / 128);
/**
 * 기획 24차: a fixed boss on the top row (엘리베이터 at y −1.2) leaves no room even at `lo` — how far toward the camera
 * (world y) to hang the picture at height z so its top still clears the bar (0 almost always: y ≥ 2.6 for the moon).
 */
function skyNudge(y: number, px: number, z: number): number {
  return Math.max(0, (z - skyTop(y, px)) / 0.6875);
}
/**
 * 기획 24차 검토: a pair of wings (Fx.Wings, its span r cells) over ground y hung at height ≤ `hi` (≥ 0.6) so its top —
 * the outline peaks at 0.47 × its span (fxparts.ts wings) + the stroke — stays under the boss bar (skyZ / skyNudge).
 */
function hangWings(w: { r: number; z: number; oy: number }, y: number, hi: number): void {
  const px = 0.47 * w.r * PX_PER_UNIT + 2;
  w.z = skyZ(y, px, 0.6, hi);
  w.oy = skyNudge(y, px, w.z);
}

const CROSS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ─────────────────────────── 가디언 (A1, A2) ───────────────────────────

const guardian: Record<string, UltStory> = {
  // ── 조준 「성채 투척」: the thrown shield pulls the line in → the citadel falls → 1.5 s the hex shell unfolds and bursts ──
  'guardian_ua:rally': {
    alias: { key: 'guardian_u:rally' }, // chains round the guardian (PREP) · electric tethers to the pulled (LAND)
    prep: (fx, _h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      aimLine(fx, P0.x, P0.y, P1.x, P1.y, 2.6, STEEL, s.k, 0, s.delay);
    },
    land: (fx, h, s) => {
      if (s.hit !== 0) return;
      orbFly(fx, s.ox, s.oy, s.x, s.y, 0.2, STEEL_LIGHT, s.k, 0.8); // the thrown shield
      // the shield wave runs the band's whole length (from its middle out to both ends)
      footAlong(s, 0.5, P0);
      const sw = fx.add(Fx.ShieldWave, P0.x, P0.y, 0.5, s.color, s.k);
      sw.ang = ultAngle(s);
      sw.r = s.area.shape === 'line' ? s.area.length : 9;
      sw.w = s.area.shape === 'line' ? s.area.width : 2.6;
      beamAlong(fx, s, 0.9, STEEL_LIGHT, 0.22);
      h.spray(s.x, s.y, 0.6, cnt(8, s.k), Pk.Glass, STEEL_LIGHT, 3, 2, 0.5);
    },
    impact: { shake: 3, flash: 0.6 },
  },
  'guardian_ua:aegis': { alias: { key: 'guardian_u:aegis' } },
  'guardian_ua:citadel': {
    alias: { key: 'guardian_u:citadel', at: 'point' }, // the tower shield drops onto the aimed point, then today's burst
    land: (fx, _h, s) => {
      crackFx(fx, s.x, s.y, 3.8, 10, STEEL, s.k);
    },
    impact: { stop: 55, shake: 7, flash: 0.9 },
    motif: 'outline',
  },
  'guardian_ua:barrier': { alias: { key: 'guardian_u:barrier' }, decor: 'hexDome' },
  'guardian_ua:wave': {
    // ★ 성채 전개: the hex shell fills from the middle out over 0.6 s, two rings close in, then it bursts outward
    prep: (fx, _h, s) => {
      areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.6, STEEL_LIGHT, s.k, Math.max(0, s.delay - 0.6));
      rings(fx, s.x, s.y, 4.5, 1, 2, 0.4, STEEL_LIGHT, s.k).wait = Math.max(0, s.delay - 0.4);
    },
    land: (fx, h, s) => {
      rings(fx, s.x, s.y, 0.5, 5.5, 3, 0.5, '#ffffff', s.k, -1, 8);
      areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.4, '#ffffff', s.k);
      // six shield plates thrown to the rim
      const R = s.area.shape === 'circle' ? s.area.radius : 4.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        orbFly(fx, s.x, s.y, s.x + Math.cos(a) * R * 0.9, s.y + Math.sin(a) * R * 0.72, 0.28, STEEL_LIGHT, s.k, 0.7);
      }
      h.spray(s.x, s.y, 0.6, cnt(14, s.k), Pk.Glass, STEEL_LIGHT, 4, 3, 0.7);
      h.spray(s.x, s.y, 0.4, cnt(6, s.k), Pk.Square, '#ffffff', 3, 2, 0.5);
    },
    charge: { vignette: 0.3 },
    motif: 'countdown',
  },

  // ── 드래그 「성벽 대강림」: dash → slam → four shields fall into a wall across the dash → 1.6 s the wall surges forward ──
  'guardian_ud_path:rally': {
    wave: true, // the role's beam along the path + an X on each one it cut
    land: (_fx, h, s) => {
      const list = bandEnemies(h, s);
      const n = Math.min(3, list.length);
      for (let i = 0; i < n; i++) h.spray(list[i].x, list[i].y, 0.3, cnt(2, s.k), Pk.Rock, '#7d8597', 3, 3.5, 0.6, 11, 5);
    },
  },
  'guardian_ud:slam': {
    alias: { key: 'guardian_d:slam', prep: false }, // today's slam rings / star / rocks (its own shield falls too early here)
    prep: (fx, _h, s) => {
      fallAt(fx, s.x, s.y, FallObj.Shield, 1.4, 6, s.delay - 0.25, 0.25, STEEL, s.k);
    },
    land: (fx, _h, s) => {
      crackFx(fx, s.x, s.y, 2.6, 8, STEEL, s.k);
    },
    impact: { shake: 5, flash: 0.7 },
  },
  'guardian_ud:aegis': { alias: { key: 'guardian_u:aegis' } },
  'guardian_ud:citadel': {
    prep: (fx, _h, s) => {
      areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.35, STEEL_LIGHT, s.k, Math.max(0, s.delay - 0.35));
      // four tower shields drop one after another onto the wall's line, the last with the burst
      const a = ultAngle(s); // the wall's long axis (across the dash)
      for (let i = 0; i < 4; i++) {
        const d = -4.5 + 3 * i;
        fallAt(fx, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, FallObj.Shield, 1.4, 7, s.delay - 0.35 - 0.04 * (3 - i), 0.35, STEEL, s.k);
      }
    },
    land: (fx, h, s) => {
      const sw = fx.add(Fx.ShieldWave, s.x, s.y, 0.55, s.color, s.k);
      sw.ang = ultAngle(s);
      sw.r = s.area.shape === 'rect' ? s.area.length : 13;
      sw.w = s.area.shape === 'rect' ? s.area.width : 3;
      wave(fx, s.x, s.y, s.area, 0.45, '#ffffff', s.k);
      star(fx, s.x, s.y, 0.6, 60, '#ffffff', s.k, 0, 12);
      sprayAlong(h, s, 3, cnt(5, s.k), Pk.Glass, STEEL_LIGHT, 4, 3, 0.7, 6, 5);
      sprayAlong(h, s, 3, cnt(4, s.k), Pk.Rock, '#7d8597', 4, 4.5, 0.8, 11, 6);
    },
    impact: { stop: 55, shake: 7, flash: 0.9 },
  },
  'guardian_ud:barrier': { decor: 'hexWall', wave: false },
  'guardian_ud:wave': {
    // ★ 성벽 돌파: rings close on the wall, then the wall's front surges forward through the band in three pushes
    prep: (fx, _h, s) => {
      const a = ultAngle(s);
      const wx = s.x - Math.cos(a) * 1.5; // the wall's middle (the band starts 1.5 in front of it)
      const wy = s.y - Math.sin(a) * 1.5;
      rings(fx, wx, wy, 3, 0.5, 2, 0.4, STEEL_LIGHT, s.k).wait = Math.max(0, s.delay - 0.4);
      areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.4, STEEL_LIGHT, s.k * 0.7, Math.max(0, s.delay - 0.4));
    },
    land: (fx, h, s) => {
      const a = ultAngle(s);
      const L = s.area.shape === 'rect' ? s.area.length : 5;
      const W = s.area.shape === 'rect' ? s.area.width : 13;
      for (let i = 0; i < 3; i++) {
        footAlong(s, (i + 0.5) / 3, P0);
        const sw = fx.add(Fx.ShieldWave, P0.x, P0.y, 0.45, i === 2 ? '#ffffff' : s.color, s.k);
        sw.ang = a;
        sw.r = L / 3;
        sw.w = W;
        sw.age = 0.05 * (2 - i); // the near front pushed first (ages, no waits: the frozen first frame shows all three)
      }
      wave(fx, s.x, s.y, s.area, 0.5, s.color, s.k);
      // glass along the far edge, across the band
      footAlong(s, 0.9, P1);
      const px = -Math.sin(a);
      const py = Math.cos(a);
      for (let j = -1; j <= 1; j++) h.spray(P1.x + px * j * W * 0.3, P1.y + py * j * W * 0.3, 0.6, cnt(5, s.k), Pk.Glass, STEEL_LIGHT, 4, 3, 0.7, 6, 5);
      midBurst(fx, h, s);
    },
    finisher: OFF_ANCHOR,
    motif: 'outline',
  },
};

// ─────────────────────────── 팔라딘 (A3, A4) ───────────────────────────

const paladin: Record<string, UltStory> = {
  // ── 조준 「성창 심판」: eight spears walk in → 1.2 s the great cross, four giant spears planted on its tips ──
  'paladin_ua:sanctuary': { alias: { key: 'paladin_u:sanctuary' } },
  'paladin_ua:spear': {
    alias: { key: 'paladin_u:spear', seqAsHit: true }, // each spear falls (outer ones bigger), each lands a bit bigger
    land: (fx, _h, s) => {
      lightPillar(fx, s.x, s.y, 0.3, 4 + 0.3 * s.seq, HOLY, s.k * 0.8, 0.35);
    },
    impact: s => (s.seq === 0 ? { stop: 30, shake: 3, flash: 0.5 } : { shake: 1.5, flash: 0.3 }),
  },
  'paladin_ua:tribunal': {
    alias: { key: 'paladin_u:tribunal', at: 'point' }, // the brand burns on the aimed point (PREP) · today's 대심판 (LAND)
    prep: (fx, h, s) => {
      const L = s.area.shape === 'cross' ? s.area.length : 7;
      const x = s.x;
      const y = s.y;
      const k = s.k;
      for (let i = 0; i < 4; i++) {
        const [ux, uy] = CROSS4[i];
        const tx = x + ux * L;
        const ty = y + uy * L;
        const wait = s.delay - 0.45 + 0.03 * i;
        fallAt(fx, tx, ty, FallObj.Spear, 1.6, 8, wait, 0.3, GOLD, k);
        h.later(Math.max(0, wait + 0.3), () => h.spray(tx, ty, 0.4, cnt(3, k), Pk.Gold, GOLD, 2, 2.5, 0.5, 4, 4));
      }
    },
  },

  // ── 드래그 「축복의 돌격」: the dash blesses the path → the brand pulses faster → 0.95 s the pillar of light ──
  'paladin_ud_path:blessing': {
    land: (fx, h, s) => {
      // each ally on the path: a beam of light; gold dust along the path
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const L2 = dx * dx + dy * dy || 1;
      const half = (s.area.shape === 'line' ? s.area.width : 2.4) / 2;
      let n = 0;
      for (const m of h.allies()) {
        if (n >= 4) break;
        const t = Math.max(0, Math.min(1, ((m.x - s.ox) * dx + (m.y - s.oy) * dy) / L2));
        if (Math.hypot(m.x - (s.ox + dx * t), m.y - (s.oy + dy * t)) > half + m.radius) continue;
        lightPillar(fx, m.x, m.y, 0.45, 4.2, HOLY, s.k, 0.55, m.id);
        n++;
      }
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        h.spray(s.ox + dx * t, s.oy + dy * t, 0.6, cnt(2, s.k), Pk.Gold, GOLD, 0.8, 1.8, 0.8, -1.2, 4);
      }
    },
  },
  'paladin_ud:brand': {
    alias: { key: 'paladin_d:brand' },
    impact: { stop: 40, shake: 4, flash: 0.7 },
  },
  'paladin_ud:blessing': { alias: { key: 'paladin_d:blessing' } },
  'paladin_ud:tribunal': {
    // ★ the brand keeps burning, pulsing faster and faster, then the pillar comes down on it
    prep: (fx, _h, s) => {
      areaFx(fx, Fx.Brand, s.x, s.y, s.area, 0.4, GOLD, s.k * 0.8, Math.max(0, s.delay - 0.4), 6);
    },
    alias: { key: 'paladin_d:pillar', k: 1.3 },
    land: (fx, _h, s) => {
      rings(fx, s.x, s.y, 0.5, 5, 3, 0.55, HOLY, s.k, -1, 6);
    },
  },
  'paladin_ud:core': { alias: { key: 'paladin_d:core' }, impact: { flash: 0.7 } },
};

// ─────────────────────────── 워든 (A5, A6) ───────────────────────────

const wardenCage: UltStory = {
  // ★ the cage drops from the sky onto its spot (today's 철창), the ground cracks, chains snap in from the rim
  alias: { key: 'warden_u:cage', at: 'point' },
  land: (fx, _h, s) => {
    const R = s.area.shape === 'circle' ? s.area.radius : 3;
    crackFx(fx, s.x, s.y, R * 1.1, 8, CHAIN, s.k);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      tetherFx(fx, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R * 0.8, s.x, s.y, TetherStyle.Chain, 0.35, CHAIN, s.k, -1, -1, 0.1, 3);
    }
  },
};

const wardenRelease: UltStory = {
  // the encore: the prison bursts open, chain links fly
  alias: { key: 'warden_u:release', at: 'point' },
  land: (_fx, h, s) => {
    h.spray(s.x, s.y, 0.8, cnt(12, s.k), Pk.Square, CHAIN_PALE, 6, 4, 0.7, 9, 6);
  },
  impact: { stop: 70, shake: 6, flash: 0.8 },
  motif: 'countdown',
};

const warden: Record<string, UltStory> = {
  // ── 조준 「사슬 갈고리 · 철창」: the hook flies and reels them in → 1 s the cage → 6 s the release ──
  'warden_ua:chainstorm': {
    land: (fx, _h, s) => {
      selfBubble(fx, s, CHAIN_LIGHT);
      chains(fx, s.ox, s.oy, 3, 1, 0.5, s.color, s.k, s.src); // a chain swirl closing round the warden
    },
  },
  'warden_ua:hook': {
    prep: (fx, _h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      aimLine(fx, P0.x, P0.y, P1.x, P1.y, s.area.shape === 'rect' ? s.area.width : 2.4, CHAIN, s.k, 0, s.delay);
      chains(fx, s.ox, s.oy, 1.8, 0.9, s.delay, s.color, s.k, s.src); // the chain whirls round the warden
    },
    land: (fx, h, s) => {
      if (s.hit !== 0) return;
      footAlong(s, 1, P1);
      // the hook flies out to the band's end, then every one it caught is chained to the warden and reeled in
      orbFly(fx, s.ox, s.oy, P1.x, P1.y, 0.18, CHAIN_PALE, s.k, 0.6);
      tetherFx(fx, s.ox, s.oy, P1.x, P1.y, TetherStyle.Chain, 0.22, CHAIN, s.k, s.src, -1, 0.05, 4);
      eachEnemy(
        h,
        s,
        s.area,
        m => {
          tetherFx(fx, s.ox, s.oy, m.x, m.y, TetherStyle.Chain, 0.45, CHAIN, s.k, s.src, m.id, 0.15, 3, 0.12);
          h.spray(m.x, m.y, 0.5, cnt(3, s.k), Pk.Square, CHAIN_PALE, 2, 2, 0.4);
        },
        6,
      );
    },
    impact: { stop: 45, shake: 4, flash: 0.6 },
  },
  'warden_ua:cage': wardenCage,
  'warden_ua:prison': { decor: 'prison', wave: false },
  'warden_ua:release': wardenRelease,

  // ── 드래그 「사슬 대감옥」: dash dragging a chain → the hook ring reels them in → 0.8 s the cage → 5.8 s the release ──
  'warden_ud_path:chainstorm': {
    wave: true,
    land: (fx, h, s) => {
      const list = bandEnemies(h, s);
      const n = Math.min(6, list.length);
      for (let i = 0; i < n; i++) tetherFx(fx, s.x, s.y, list[i].x, list[i].y, TetherStyle.Chain, 0.4, CHAIN, s.k, -1, list[i].id, 0.15, 3);
    },
  },
  'warden_ud:hook': {
    alias: { key: 'warden_d:hook' }, // the chain ring at the landing + a chain to every one it caught
    land: (fx, _h, s) => {
      // eight chains lashing out all round (today's chain storm, halved)
      chains(fx, s.ox, s.oy, 6.5, 1.2, 0.6, s.color, s.k, s.src);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        tetherFx(fx, s.x, s.y, s.x + Math.cos(a) * 6, s.y + Math.sin(a) * 6 * 0.8, TetherStyle.Chain, 0.45, s.color, s.k * 0.8, -1, -1, 0.3, 3, i * 0.015);
      }
    },
    impact: { shake: 5, flash: 0.6 },
  },
  'warden_ud:chainstorm': {
    land: (fx, _h, s) => selfBubble(fx, s, CHAIN_LIGHT),
  },
  'warden_ud:cage': wardenCage,
  'warden_ud:prison': { decor: 'prison', wave: false },
  'warden_ud:release': wardenRelease,
};

// ─────────────────────────── 블레이드 (A7, A8) ───────────────────────────

/** A white cut across the whole screen when the band runs (nearly) level — mine only. */
function screenCut(h: UltHost, s: UltBeatInfo): void {
  if (!s.local) return;
  const a = ultAngle(s);
  if (Math.abs(Math.sin(a)) >= 0.35) return;
  footAlong(s, 0.5, P0);
  h.screen.slash(P0.y, '#ffffff');
}

const blade: Record<string, UltStory> = {
  // ── 조준 「천검 · 검기 폭풍」: ten sword waves anywhere in the fan (growing) → 1.8 s the 16-cell 대일섬 ──
  'blade_ua:storm': {
    land: (fx, h, s) => {
      const g = 1 + 0.05 * Math.min(8, s.hit);
      const a = ultAngle(s);
      const across = screenAngle(Math.cos(a), Math.sin(a)) + Math.PI / 2;
      for (let j = 0; j < 2; j++) {
        randomIn(s, P0);
        slash(fx, P0.x, P0.y, BODY_Z, across + (Math.random() - 0.5) * 1.4, (52 + Math.random() * 24) * g, j ? '#ffffff' : s.color, s.k, j * 0.05, j === 0);
      }
      if (s.hit % 3 === 2) {
        randomIn(s, P0);
        xslash(fx, P0.x, P0.y, BODY_Z, 46 * g, '#ffffff', s.k, 0, Math.random() * Math.PI);
      }
      if (s.hit === 0) {
        // the blade spins once where it stands, the fan lights up
        const sp = fx.add(Fx.Spin, s.x, s.y, 0.5, s.color, s.k);
        sp.r = 1.5;
        sp.z = 0.3;
        sp.flip = s.face;
        sp.follow = s.follow;
        wave(fx, s.x, s.y, s.area, 0.45, s.color, s.k * 0.7);
        h.spray(s.x, s.y, 0.7, cnt(6, s.k), Pk.Petal, PETAL, 2.5, 1.5, 0.8, 2, 4);
      }
    },
    impact: s => (s.hit === s.hits - 1 ? { shake: 3, flash: 0.4 } : { shake: 1.5 }),
  },
  'blade_ua:issen': {
    // ★ the world goes dark, a white line draws the cut, the blade's ghost stands at its start → the 16-cell flash
    prep: (fx, h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      aimLine(fx, P0.x, P0.y, P1.x, P1.y, s.area.shape === 'rect' ? s.area.width : 3, '#ffffff', s.k, s.delay - 0.25, 0.25);
      const id = s.src;
      const x = s.ox;
      const y = s.oy;
      h.later(Math.max(0, s.delay - 0.25), () => h.afterimage(id, x, y, 0.3));
    },
    land: (fx, h, s) => {
      beamAlong(fx, s, 3.3, '#ffffff', 0.35);
      beamAlong(fx, s, 1.2, CRIMSON, 0.4);
      // seven heavy cuts across the band (all at once: the frozen first frame shows them whole)
      const a = ultAngle(s);
      const across = screenAngle(Math.cos(a), Math.sin(a)) + Math.PI / 2;
      for (let i = 0; i < 7; i++) {
        footAlong(s, (i + 0.5) / 7, P0);
        slash(fx, P0.x, P0.y, BODY_Z, across + (i % 2 ? 0.35 : -0.35), 84, i % 2 ? s.color : '#ffffff', s.k, 0, true).age = 0.02 * (6 - i);
      }
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      ghostsAlong(h, s.src, P0.x, P0.y, P1.x, P1.y, 3, 0.35);
      sprayAlong(h, s, 3, cnt(6, s.k), Pk.Petal, PETAL, 5, 2, 1.0, 2, 5);
      screenCut(h, s);
      midBurst(fx, h, s);
    },
    charge: { vignetteColor: '#000000', vignette: 0.55 },
    finisher: OFF_ANCHOR,
    motif: 'aim',
  },

  // ── 드래그 「천검 삼연섬」: through 7 more → back to the landing → 1.1 s the whole path bursts ──
  'blade_ud:dash': {
    alias: { key: 'blade_d:dash', k: 1.3 }, // today's dash cut, turned the way it went
    impact: { stop: 45, shake: 5, flash: 0.7 },
  },
  'blade_ud:return': {
    alias: { key: 'blade_d:return', lineAsRect: true }, // the cut back runs along the real line (far end first)
    land: (_fx, h, s) => {
      h.spray((s.x + s.ox) / 2, (s.y + s.oy) / 2, 0.6, cnt(6, s.k), Pk.Petal, PETAL, 3, 1.5, 0.6, 3, 4);
    },
    impact: { shake: 4, flash: 0.6 },
  },
  'blade_ud:issen': {
    // ★ dark, a white line along the path → today's burst (petal pillars) + a white beam the band's length
    prep: (fx, _h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      aimLine(fx, P0.x, P0.y, P1.x, P1.y, s.area.shape === 'rect' ? s.area.width : 3, '#ffffff', s.k, s.delay - 0.3, 0.3);
    },
    alias: { key: 'blade_d:burst' },
    land: (fx, h, s) => {
      beamAlong(fx, s, 3.3, '#ffffff', 0.35);
      beamAlong(fx, s, 1.1, CRIMSON, 0.4);
      star(fx, s.x, s.y, 0.6, 60, '#ffffff', s.k, 0, 12);
      screenCut(h, s);
    },
    charge: { vignetteColor: '#000000', vignette: 0.5 },
  },
};

// ─────────────────────────── 버서커 (A9, A10) ───────────────────────────

/** Lava geyser sizes [width, height] of 버서커 드래그's three eruptions, the last the biggest. */
const GEYSER: readonly (readonly [number, number])[] = [
  [0.8, 5],
  [1, 6],
  [1.3, 8],
];

const berserker: Record<string, UltStory> = {
  // ── 조준 「혈귀 돌진」: the rush splits the ground → the roar → 1.5 s it leaps and slams down (혈귀 낙하) → 8.25 s encore ──
  'berserker_ua:split': {
    prep: (fx, h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      aimLine(fx, P0.x, P0.y, P1.x, P1.y, s.area.shape === 'rect' ? s.area.width : 2.6, LAVA, s.k, 0, s.delay);
      h.spray(s.ox, s.oy, 0.6, cnt(6, s.k), Pk.Ember, EMBER, 1.5, 2.5, 0.6, -0.5, 4);
    },
    land: (fx, h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      crackFx(fx, P0.x, P0.y, s.area.shape === 'rect' ? s.area.length : 6, 5, LAVA, s.k, { ang: ultAngle(s), spread: 0.5 });
      beamAlong(fx, s, 1.4, LAVA, 0.25);
      sprayAlong(h, s, 2, cnt(5, s.k), Pk.Rock, '#5c4033', 3.5, 4, 0.7, 11, 5, 0.3, 0.8);
      ghostsAlong(h, s.src, P0.x, P0.y, P1.x, P1.y, 3, 0.3, 0.03);
      star(fx, P1.x, P1.y, 0.5, 40, '#ffffff', s.k, 0, 10);
    },
    impact: { stop: 45, shake: 5, flash: 0.7 },
  },
  'berserker_ua:frenzy': { alias: { key: 'berserker_u:frenzy' } },
  'berserker_ua:roar': { alias: { key: 'berserker_u:roar' }, impact: { shake: 4, flash: 0.6 } },
  'berserker_ua:quake': {
    // ★ 혈귀 낙하: a lava pillar on the berserker, it leaps up (when it still stands on the spot) and crashes down
    prep: (fx, h, s) => {
      const id = s.src;
      const x = s.x;
      const y = s.y;
      const lead = 0.5;
      const at = Math.max(0, s.delay - lead);
      const k = s.k;
      h.later(at, () => {
        const m = id >= 0 ? h.memo(id) : undefined;
        if (m && Math.hypot(m.x - x, m.y - y) <= 1.5) h.hop(id, 2.4, lead);
        // it walked off the spot: a molten boulder crashes onto it instead (the blow lands there either way)
        else fallAt(fx, x, y, FallObj.Meteor, 1.4, 9, 0, lead, LAVA, k);
      });
      lightPillar(fx, s.ox, s.oy, 0.7, 5, LAVA, s.k, lead, s.src, at);
    },
    alias: { key: 'berserker_d:slam', k: 1.4 }, // today's drag slam, stronger
    land: (fx, h, s) => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        lightPillar(fx, s.x + Math.cos(a) * 3, s.y + Math.sin(a) * 3 * 0.8, 0.55, 5, LAVA, s.k, 0.6);
      }
      scorchFx(fx, s.x, s.y, 2.5, 3, false, SCORCH, s.k);
      h.spray(s.x, s.y, 0.4, cnt(8, s.k), Pk.Ember, EMBER, 3, 4.5, 0.9, 3, 5);
    },
    charge: { vignette: 0.25 },
    linger: null, // the scorch above is its mark
    motif: 'countdown',
  },
  'berserker_ua:finale': {
    alias: { key: 'berserker_u:finale' },
    impact: { stop: 100, shake: 10, flash: 1, screen: 0.38, screenColor: '#ffd0c2' },
  },

  // ── 드래그 「혈귀 대지분쇄」: the leap crashes down → the fan splits → lava erupts three times along the crack ──
  'berserker_ud:slam': {
    alias: { key: 'berserker_d:slam' }, // the leap's touchdown
    land: (fx, _h, s) => {
      scorchFx(fx, s.x, s.y, 2, 2.5, false, SCORCH, s.k);
    },
    impact: { stop: 50, shake: 6, flash: 0.8 },
  },
  'berserker_ud:frenzy': { alias: { key: 'berserker_u:frenzy' } },
  'berserker_ud:split': {
    prep: (fx, _h, s) => {
      const spread = s.area.shape === 'cone' ? (s.area.angle * Math.PI) / 180 : 1.6;
      crackFx(fx, s.x, s.y, s.area.shape === 'cone' ? s.area.radius : 6.5, 5, LAVA, s.k * 0.5, { ang: ultAngle(s), spread, dur: 0.3, wait: Math.max(0, s.delay - 0.3) });
    },
    alias: { key: 'berserker_d:split', k: 1.3 }, // today's split, turned the way it leapt
    impact: { shake: 4, flash: 0.7 },
  },
  'berserker_ud:quake': {
    prep: (fx, h, s) => {
      // the line of the eruptions: from the landing (where it stands) out through each geyser
      const a = Math.atan2(s.y - s.oy, s.x - s.ox);
      const lx = s.ox;
      const ly = s.oy;
      const k = s.k;
      if (s.seq === 0) crackFx(fx, lx, ly, 9, 3, LAVA, k * 0.6, { ang: a, spread: 0.25, dur: 0.85, wait: Math.max(0, s.delay - 0.55) });
      if (s.role === 'finisher') h.later(Math.max(0, s.delay), () => crackFx(fx, lx, ly, 9.5, 4, '#ffb199', k, { ang: a, spread: 0.2, dur: 0.9 }));
      // embers rise from the spot just before it erupts
      const x = s.x;
      const y = s.y;
      h.later(Math.max(0, s.delay - 0.3), () => h.spray(x, y, 0.2, cnt(5, k), Pk.Ember, EMBER, 0.6, 3.5, 0.5, -0.5, 4));
    },
    land: (fx, h, s) => {
      const [w, ht] = GEYSER[Math.min(GEYSER.length - 1, s.seq)];
      const R = s.area.shape === 'circle' ? s.area.radius : 2;
      lightPillar(fx, s.x, s.y, w, ht, LAVA, s.k, 0.6);
      h.ring(s.x, s.y, 0.2, R, 0.35, LAVA, 4, 0.16 * s.k);
      h.spray(s.x, s.y, 0.3, cnt(6, s.k), Pk.Ember, EMBER, 2.5, 5, 0.8, 4, 5);
      h.spray(s.x, s.y, 0.3, cnt(6, s.k), Pk.Rock, '#5c4033', 3, 4.5, 0.8, 11, 5);
      if (s.role === 'finisher') {
        rings(fx, s.x, s.y, 0.4, 3.5, 2, 0.5, '#ffb199', s.k, -1, 7);
        star(fx, s.x, s.y, 0.6, 52, '#ffe8a3', s.k, 0, 12);
      }
    },
    impact: { shake: 3, flash: 0.6 }, // the two first geysers (the third is the finisher: the grammar kicks)
  },
};

// ─────────────────────────── 섀도우 (A11, A12) ───────────────────────────

/**
 * ★ the crescent's cut: four shadow clones strike in from all round with it, a wide crescent slash (`px`, 기획 24차:
 * 섀도우 드래그's bigger moon cuts bigger), ink. `at` = where on its target it is drawn (default: the beat's spot).
 */
function moonCut(fx: SkillFx, h: UltHost, s: UltBeatInfo, ink: number, px = 130, at?: Vec2, ghost = 1): void {
  const x = at ? at.x : s.x;
  const y = at ? at.y : s.y;
  const R = (s.area.shape === 'circle' ? s.area.radius : 2.5) * 0.8;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    h.afterimage(s.src, x + Math.cos(a) * R, y + Math.sin(a) * R * 0.8, 0.35, ghost);
  }
  slash(fx, x, y, 0.9, -0.25, px, MOONLIGHT, s.k, 0, true);
  h.spray(x, y, 0.6, cnt(ink, s.k), Pk.Ink, INK_DARK, 3, 2.5, 0.7, 8, 5);
}

/** 섀도우 드래그 (기획 24차): one key per caster's cast of an alt. */
const castKey = (s: UltBeatInfo) => `${s.src}|${s.skillId}`;
/**
 * 기획 24차 검토: the per-cast maps below keep at most CAST_KEYS keys (the oldest goes, as group B's spots) — a cast cut
 * short by a floor won mid-way never reaches the land that deletes its key; a floor change / a new run clears them all
 * (the module's reset, from resetUltCore).
 */
const CAST_KEYS = 24;
function capSet<V>(m: Map<string, V>, k: string, v: V): void {
  if (!m.has(k) && m.size >= CAST_KEYS) m.delete(m.keys().next().value as string);
  m.set(k, v);
}
/** 섀도우 드래그: the way each of the six cuts runs (world radians, by seq) — read by the clone beat, which lands first. */
const cutAngles = new Map<string, number[]>();
/**
 * 섀도우 드래그 (기획 24차 검토): the end of each cut its clone stands at and dashes from (+1 = the cut's far end, −1 =
 * its near end; by seq) — set by the clone beat, read by the cuts.
 */
const cutSides = new Map<string, number[]>();
/** 섀도우 드래그: the six cuts as they were drawn (their middle + way; cleared at the first cut) — they burst white with the moon. */
const cutLines = new Map<string, { x: number; y: number; a: number }[]>();
/** 섀도우 드래그 (기획 24차 검토): a clone's size × (the six that cut, the four of the moon). */
const CLONE_SCALE = 1.6;
/** 섀도우 드래그 (기획 24차 검토): each cut's glint runs this × its length each way from its middle (mine; others' 0.6). */
const CUT_GLINT = 1.15;
/** 섀도우 드래그 (기획 24차 검토): the moon's radius (logical px; was 60) — its crescent's top kept under the boss bar. */
const MOON_R = 92;
/**
 * 섀도우 드래그 (기획 24차 검토 2): a clone whose feet would stand above this logical y (its 1.6× body off the top of the
 * screen or behind the top HUD — a fixed boss on the top row) stands at the other end of its cut, lower on the screen.
 */
const CLONE_FEET_Y = CLEAR_Y;
const DUSK = '#5e60ce';

const shadow: Record<string, UltStory> = {
  // ── 조준 「월영 질주」: an ink pool, the pass-through band → three clones burst → 1.4 s the crescent over the aimed point ──
  'shadow_ua:dance': {
    prep: (fx, _h, s) => {
      if (s.area.shape === 'rect') scorchFx(fx, s.x, s.y, 1.2, 0.9, true, INK_DARK, s.k); // it sinks into the ink
    },
    land: (fx, h, s) => {
      if (s.area.shape !== 'rect') {
        runStory('shadow_u:dance', 'land', fx, h, s, { seqAsHit: true }); // today's clone burst, growing
        return;
      }
      // the pass-through: a dark violet band with a thin white core, four afterimages along it, ink
      beamAlong(fx, s, 2, DUSK, 0.4);
      beamAlong(fx, s, 0.5, '#ffffff', 0.3, 0.02);
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      ghostsAlong(h, s.src, P0.x, P0.y, P1.x, P1.y, 4, 0.35, 0.03);
      sprayAlong(h, s, 2, cnt(5, s.k), Pk.Ink, INK_DARK, 3, 2.5, 0.6, 9, 5);
    },
    impact: s => (s.area.shape === 'rect' ? { stop: 45, shake: 4, flash: 0.7 } : { shake: 1.5, flash: 0.4 }),
  },
  'shadow_ua:moon': {
    alias: { key: 'shadow_u:moon' }, // ★ the crescent hangs over the spot (the world turns violet), then cuts down
    land: (fx, h, s) => moonCut(fx, h, s, 10),
    motif: 'reticle',
  },

  // ── 드래그 「흑월 대처형진」 (기획 24차 A12′): an ink circle round its target → six clones cut across it, faster and faster,
  //    each cut left branded → 0.5 s of stillness, a big crescent fills low over it → 1.5 s the moon falls, the six cuts
  //    burst white at once (「이미 베었다」).
  //    기획 24차 검토 (8-8-6): bigger and readable against ANY boss, a fixed one on the top row included — big clones, cuts
  //    as wide as their band with a glint the whole way across the screen, the slashes / X / star on the target's VISIBLE
  //    front (onBody), the ink 진 where it sank too, a bigger moon, the burst along the whole glints + ground shock rings ──
  'shadow_ud:clone': {
    prep: (fx, _h, s) => {
      // the ink ring spreads round its target as the clone lands, then the ink pool (the look's small one is at the landing)
      rings(fx, s.x, s.y, 0.5, 3.5, 1, s.delay, INK_DARK, s.k, s.follow, 7);
      scorchFx(fx, s.x, s.y, 3.5, 1.2, true, INK_DARK, s.k, 0.3);
    },
    land: (fx, h, s) => {
      const k = s.k;
      const src = s.src;
      // today's 「분신」 (an afterimage on its target, one X, ink) on the target's visible front
      onBody(h, s, BODY_Z, P2);
      runStory('shadow_d:clone', 'land', fx, h, s, { x: P2.x, y: P2.y });
      // six big clones rise from the ink at the starts of their cuts (even ones behind, odd ones ahead) and stand until
      // their turn — afterimages, so they show while the body itself is hidden below. 기획 24차 검토: one whose feet would
      // stand above CLONE_FEET_Y (a fixed boss on the top row: its body off the screen / behind the top HUD) stands at
      // the other end of its cut (the mirror through its target: lower on the screen) and its cut dashes from there
      const key = castKey(s);
      const angs = cutAngles.get(key);
      const cuts = s.beats.beats.filter(b => b.stage === 'dance');
      const sides: number[] = [];
      for (const b of cuts) {
        const a = angs?.[b.seq];
        if (a === undefined) continue;
        const ar = s.beats.def.actions[b.actionIndex].area;
        const half = (ar.shape === 'rect' ? ar.length : 2 * footprintRadius(ar)) / 2; // its cut's ends (footAlong 0 / 1)
        let side = b.seq % 2 ? 1 : -1;
        const feet = GROUND_TOP + (s.y + Math.sin(a) * half * side) * PX_PER_UNIT_Y;
        if (feet < CLONE_FEET_Y && Math.sin(a) * side < 0) side = -side;
        sides[b.seq] = side;
        const cx = s.x + Math.cos(a) * half * side;
        const cy = s.y + Math.sin(a) * half * side;
        const stand = Math.max(0.1, b.at - s.beat.at);
        h.afterimage(src, cx, cy, stand, CLONE_SCALE);
        // each rises in a column of violet light with an ink ring at its feet (a pale copy alone hardly reads)
        lightPillar(fx, cx, cy, 0.5, 3.2, DUSK, k, stand + 0.1);
        h.ring(cx, cy, 0.2, 1.3, 0.3, MOONLIGHT, 4, 0.1 * k);
      }
      capSet(cutSides, key, sides);
      h.ring(s.x, s.y, 0.3, 3.5, 0.35, MOONLIGHT, 6, 0.12 * k);
      h.spray(s.x, s.y, 0.5, cnt(12, k), Pk.Ink, INK_DARK, 3, 2.5, 0.7, 8, 5);
      if (src >= 0) {
        // the 진 where it sinks (its landing spot: always on the open floor): an ink pool with a violet rune ring
        scorchFx(fx, s.ox, s.oy, 2.4, 1.1, true, INK_DARK, k);
        rune(fx, s.ox, s.oy, 2.4, 1.05, DUSK, k);
        // the clones are the shadow now: its body sinks into the ink, then drops back in before the moon
        h.later(0.1, () => h.hideFor(src, 0.6));
        h.later(0.7, () => h.drop(src, 0.8, 0.2));
      }
    },
    impact: { stop: 40, shake: 4, flash: 0.7 },
  },
  'shadow_ud:dance': {
    prep: (_fx, _h, s) => {
      // the way this cut runs (its aim turn + its own rot) — the clone beat (0.45 s) stands each clone at its start
      const key = castKey(s);
      let angs = cutAngles.get(key);
      if (!angs) capSet(cutAngles, key, (angs = []));
      angs[s.seq] = ultAngle(s);
    },
    land: (fx, h, s) => {
      const k = s.k;
      const key = castKey(s);
      const a = ultAngle(s);
      const W = s.area.shape === 'rect' ? s.area.width : 1.8;
      const L = s.area.shape === 'rect' ? s.area.length : 9;
      // a big clone dashes across its target, from alternate ends (its start = where the clone beat stood it — 기획 24차
      // 검토: the end it picked there; the alternate one when the clone beat did not run)
      const side = cutSides.get(key)?.[s.seq] ?? (s.seq % 2 ? 1 : -1);
      footAlong(s, side > 0 ? 1 : 0, P0);
      footAlong(s, side > 0 ? 0 : 1, P1);
      ghostsAlong(h, s.src, P0.x, P0.y, P1.x, P1.y, 4, 0.28, 0.02, 1.3);
      // the cut: as wide as its band (violet; the beam's own core is white), low (a boss on the top row keeps it out
      // from under the bar), and a thin glint the whole way across the screen along it
      beamAlong(fx, s, W, DUSK, 0.36).z = 0.2;
      glint(fx, s.x, s.y, a, L * (s.local ? CUT_GLINT : 0.6), 0.14, 0.36, MOONLIGHT, k);
      // the crescent of the cut on the target's visible front, bigger every cut
      onBody(h, s, BODY_Z, P2);
      slash(fx, P2.x, P2.y, BODY_Z, screenAngle(Math.cos(a), Math.sin(a)) + Math.PI / 2, 92 * (1 + 0.1 * s.seq), MOONLIGHT, k, 0, true);
      // the cut stays branded on the ground, pulsing, until the moon bursts it
      areaFx(fx, Fx.Brand, s.x, s.y, s.area, s.toFinish + 0.08, MOONLIGHT, k * 0.9, 0, 3);
      h.spray(P2.x, P2.y, 0.6, cnt(4, k), Pk.Ink, INK_DARK, 3, 2.2, 0.5, 8, 5);
      let lines = cutLines.get(key);
      if (s.seq === 0 || !lines) capSet(cutLines, key, (lines = []));
      lines.push({ x: s.x, y: s.y, a });
      if (s.seq === 5) {
        // the sixth: a big white X, then a twelve-point star once all six are drawn
        xslash(fx, P2.x, P2.y, BODY_Z, 130, '#ffffff', k);
        star(fx, P2.x, P2.y, BODY_Z, 96, '#ffffff', k, 0, 12);
        // the six scars over everything through the stillness (the ground brand hides under a big body) until the
        // moon bursts them
        for (const l of lines) {
          const hx = Math.cos(l.a) * (L / 2);
          const hy = Math.sin(l.a) * (L / 2);
          beam(fx, l.x - hx, l.y - hy, l.x + hx, l.y + hy, 0.42, s.toFinish + 0.05, MOONLIGHT, k, 0.06).z = 0.2;
        }
      }
    },
    impact: s => ({ shake: 1.5 + 0.3 * s.seq, flash: s.seq === 5 ? 0.35 : 0 }),
  },
  'shadow_ud:moon': {
    // today's crescent cut (its LAND) is run below on the target's visible front; its PREP hung the moon at height 3.4,
    // behind the boss bar
    prep: (fx, _h, s) => {
      // ★ 흑월: a big crescent fills low over its target through the last second (the crescent's top under the boss
      // bar; its faint glow may tuck under it)
      const f = fx.add(Fx.Moon, s.x, s.y, 1.0, DUSK, s.k);
      f.r = MOON_R;
      f.z = skyZ(s.y, MOON_R, 0.6, 3.4);
      f.oy = skyNudge(s.y, MOON_R, f.z); // a boss on the top row: just in front of it
      f.follow = s.follow;
      f.wait = Math.max(0, s.delay - 1.0);
    },
    land: (fx, h, s) => {
      const k = s.k;
      onBody(h, s, 1.2, P2); // today's crescent hangs at 1.2
      runStory('shadow_u:moon', 'land', fx, h, s, { x: P2.x, y: P2.y });
      moonCut(fx, h, s, 18, 250, P2, CLONE_SCALE);
      // the six branded cuts burst white all at once — the whole way along their glints
      const key = castKey(s);
      const lines = cutLines.get(key);
      if (lines) for (const l of lines) glint(fx, l.x, l.y, l.a, 4.5 * (s.local ? 2 * CUT_GLINT : 1), 1.3, 0.32, '#ffffff', k, 0.2);
      // the cast is over: its keys go (기획 24차 검토: the angles and the sides too)
      cutLines.delete(key);
      cutAngles.delete(key);
      cutSides.delete(key);
      crackFx(fx, s.x, s.y, 4.5, 8, INK_DARK, k);
      // a violet shock over the floor round it (its front half shows below any boss) and a white one inside
      rings(fx, s.x, s.y, 0.6, 6.5, 2, 0.5, DUSK, k, -1, 9);
      h.ring(s.x, s.y, 0.4, 4.5, 0.35, '#ffffff', 5, 0);
    },
    charge: { vignette: 0.5, vignetteLead: 0.6 },
    finisher: { sparks: 30 },
    motif: 'reticle',
  },
};

// ─────────────────────────── 레인저 (A13, A14) ───────────────────────────

/** 레인저 조준 (기획 24차): the six spots each ring of rain falls on (`${src}|${skillId}|${seq}`), from its PREP to its land. */
const rainSpots = new Map<string, Vec2[]>();
/** 레인저 드래그: the volley's lanes (× half the band's width × 0.55) — left, right, then all three at once. */
const LANE_L = [-1] as const;
const LANE_R = [1] as const;
const LANE_ALL = [-1, 0, 1] as const;
/** 레인저 드래그: the shock tunnel's four white lines across the band (cells from its axis). */
const TUNNEL = [-0.9, -0.5, 0.5, 0.9] as const;
/** 레인저 드래그: where the three wings of the hawk fly — the share of the way from the ranger to its target (기획 24차 검토: was of the band). */
const HAWK_ALONG = [0.25, 0.55, 0.85] as const;
/** 레인저 드래그 (기획 24차 검토): the three pins' triangle round the target's visible front (cells; was 1.6 round its middle). */
const PIN_R = 1.8;

const ranger: Record<string, UltStory> = {
  // ── 조준 「매의 화살비 · 천공 강하」 (기획 24차 A13′): a thick marking arrow → three rings of rain close in on the mark →
  //    the hawk of light spreads its wings and dives as the sky arrow (1.9 s) ──
  'ranger_ua:mark': {
    prep: (fx, h, s) => {
      // the bow drawn: a thick gold aim line to the point, feathers pulled into the bow, a flash on it
      aimLine(fx, s.ox, s.oy, s.x, s.y, 1.0, '#ffd23f', s.k, 0, 0.45);
      h.implode(s.ox, s.oy, BODY_Z, 1.6, cnt(10, s.k), FEATHER, 0.4, Pk.Feather);
      star(fx, s.ox, s.oy, BODY_Z, 36, '#ffffff', s.k, 0.35);
    },
    land: (fx, h, s) => {
      // a white beam and a big arrow from the bow; the gold mark (the ★'s own size) stays until the sky arrow
      beam(fx, s.ox, s.oy, s.x, s.y, 0.9, 0.2, ARROW, s.k);
      beam(fx, s.ox, s.oy, s.x, s.y, 0.3, 0.16, '#ffffff', s.k, 0.02);
      arrow(fx, s.ox, s.oy, s.x, s.y, 0.16, 2.8, ARROW, s.k);
      crosshairFx(fx, s.x, s.y, s.area.shape === 'circle' ? s.area.radius : 2, s.toFinish + 0.1, '#ffd23f', s.k, -1);
      h.ring(s.x, s.y, 0.2, 2, 0.3, '#ffffff', 3, 0);
      h.spray(s.x, s.y, 0.6, cnt(8, s.k), Pk.Feather, FEATHER, 2.5, 2, 1, 1, 5);
      h.spray(s.x, s.y, 0.2, cnt(5, s.k), Pk.Smoke, '#d8cbb8', 0.8, 1, 0.5, -0.3, 7);
    },
    impact: { stop: 45, shake: 4, flash: 0.7 },
  },
  'ranger_ua:rain': {
    alias: { key: 'ranger_u:rain', land: false }, // a light shot up from the bow 0.35 s before each ring (PREP)
    prep: (fx, h, s) => {
      // six thick arrows fall inside the ring as it lands — the spots kept for the land; started on the sim clock just
      // before (no effects waiting in the pool from the cast: the budget)
      const pts: Vec2[] = [];
      for (let i = 0; i < 6; i++) {
        randomIn(s, P0);
        pts.push({ x: P0.x, y: P0.y });
      }
      capSet(rainSpots, `${castKey(s)}|${s.seq}`, pts);
      const k = s.k;
      h.laterSim(Math.max(0, s.delay - 0.18), late => {
        const d = Math.max(0.06, 0.18 - late);
        for (const p of pts) fallAt(fx, p.x, p.y, FallObj.Arrow, 1, 6, 0, d, ARROW, k);
      });
    },
    land: (fx, h, s) => {
      const key = `${castKey(s)}|${s.seq}`;
      const pts = rainSpots.get(key);
      rainSpots.delete(key);
      if (pts) {
        for (const p of pts) {
          star(fx, p.x, p.y, 0.3, 26, '#ffffff', s.k, 0, 6);
          h.spray(p.x, p.y, 0.3, cnt(1, s.k), Pk.Feather, FEATHER, 1.5, 1.5, 0.9, 1, 5);
        }
      }
      // a thin white ring closes onto the ring's edge; the third (innermost) a big star in the middle
      const R = s.area.shape === 'circle' ? s.area.radius : 2;
      h.ring(s.x, s.y, R + 0.5, R, 0.25, '#ffffff', 4, 0.08 * s.k);
      if (s.seq === 2) star(fx, s.x, s.y, 0.4, 70, '#ffffff', s.k, 0, 10);
    },
    impact: s => ({ shake: 2 + s.seq, flash: 0.45 }),
    motif: 'reticle',
  },
  'ranger_ua:skyshot': {
    // today's 하늘 화살 LAND (gold rings, a star, rocks, feathers); its PREP's 1.1 arrow is too small here
    alias: { key: 'ranger_u:skyshot', prep: false },
    prep: (fx, h, s) => {
      // ★ the hawk of light, built on the sim clock 0.6 s before the blow (the mark's stop never pushes it late):
      // three wings over the mark, from above the ranger's side down onto it (the dive's trail), a gold beat of the
      // wings 0.45 s before, a gold column, the giant arrow from 11 high with a crown of eight arrows following it
      const x = s.x;
      const y = s.y;
      const k = s.k;
      const local = s.local;
      const d = Math.hypot(s.ox - x, s.oy - y);
      const ux = d > 1e-4 ? (s.ox - x) / d : 0;
      const uy = d > 1e-4 ? (s.oy - y) / d : 0;
      const lead = Math.min(0.6, s.delay);
      h.laterSim(s.delay - lead, late => {
        const t0 = lead - late; // seconds left to the blow
        const at = (sec: number) => Math.max(0, t0 - sec); // the wait for a moment `sec` before the blow
        let zLow = 0.6;
        for (let i = 0; i < (local ? 3 : 1); i++) {
          const g = 1 - i / 2; // 1.2 cells toward the ranger → over the mark
          const wx = x + ux * 1.2 * g;
          const wy = y + uy * 1.2 * g;
          const w = fx.add(Fx.Wings, wx, wy, 0.5, FEATHER, k);
          w.r = 2.9 - 0.15 * i;
          w.z = zLow = Math.max(0.6, skyZ(wy, 100, 0.6, 3) - 0.6 * i);
          w.oy = skyNudge(wy, 100, w.z);
          w.wait = at(0.6 - 0.07 * i);
        }
        const flap = fx.add(Fx.Wings, x, y, 0.3, '#ffd23f', k);
        flap.r = 2.5;
        flap.z = zLow;
        flap.oy = skyNudge(y, 100, zLow);
        flap.wait = at(0.45);
        const z = zLow;
        const fy = y + flap.oy;
        h.later(at(0.45), () => h.implode(x, fy, z, 2, cnt(10, k), '#ffd23f', 0.3, Pk.Feather));
        // (the router's low detail is off by now: another player's skips the column here)
        if (local) lightPillar(fx, x, y, 1.2, 11, '#ffd23f', k, 0.45, -1, at(0.45));
        fallAt(fx, x, y, FallObj.Arrow, 2.6, 11, at(0.26), Math.min(0.26, t0), '#fff6d0', k);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          fallAt(fx, x, y, FallObj.Arrow, 0.8, 9, at(0.24 - 0.012 * i), 0.24, ARROW, k, -1, Math.cos(a) * 1.6, Math.sin(a) * 1.6 * 0.8);
        }
      });
    },
    land: (fx, h, s) => {
      crackFx(fx, s.x, s.y, 3, 10, '#ffd23f', s.k);
      h.ring(s.x, s.y, 0.3, 4, 0.35, '#ffffff', 3, 0);
      scorchFx(fx, s.x, s.y, 1.5, 2.5, false, '#3a2e26', s.k);
      h.spray(s.x, s.y, 1.2, cnt(16, s.k), Pk.Feather, FEATHER, 3.5, 2.5, 1.2, 1, 6);
    },
    charge: { vignetteColor: '#000000', vignette: 0.35 },
    finisher: { sparks: 24 },
    motif: 'reticle',
  },

  // ── 드래그 「매의 대일격」 (기획 24차 A14′): a roll on landing → three lanes of thick arrows at the target → 1.1 s three
  //    arrows from the sky pin it → the sniper's breath (only the band stays lit) → 1.5 s the pierce, the hawk with it.
  //    기획 24차 검토 (8-8-6): bigger and readable against ANY boss — a wider band (data 2.6 / 3), bigger arrows with a white
  //    trail as wide as a lane, a muzzle flash and a gold stance circle at the bow (always on the open floor), the pins
  //    as big lit arrows round the target's VISIBLE front, the pierce a full-width gold band with the hawk (big wings)
  //    between the ranger and its target, a hawk rising behind the ranger and a ground shock at the bow ──
  'ranger_ud:volley': {
    alias: { key: 'ranger_d:volley', lineAsRect: true, land: false }, // the aim line along the band (PREP)
    land: (fx, h, s) => {
      // left lane, right lane, then all three at once; each arrow a little bigger, a white trail on each
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      const a = ultAngle(s);
      const k = s.k;
      const half = (s.area.shape === 'line' ? s.area.width : 2.6) / 2;
      const vx = -Math.sin(a) * half * 0.6;
      const vy = Math.cos(a) * half * 0.6;
      const all = s.hit % 3 === 2;
      const size = 2.4 * Math.pow(1.06, Math.min(6, s.hit));
      for (const j of all ? LANE_ALL : s.hit % 3 === 0 ? LANE_L : LANE_R) {
        arrow(fx, P0.x + vx * j, P0.y + vy * j, P1.x + vx * j, P1.y + vy * j, 0.2, size, s.color, k);
        beam(fx, P0.x + vx * j, P0.y + vy * j, P1.x + vx * j, P1.y + vy * j, 0.7, 0.16, '#ffffff', k);
      }
      // the bow's flash (the ranger stands on the open floor: always seen), a wind ring off it on the three-lane shots
      star(fx, s.ox, s.oy, BODY_Z, all ? 60 : 38, '#ffffff', k, 0, 6);
      if (all) h.ring(s.ox, s.oy, 0.3, 2, 0.25, FEATHER, 4, 0);
      onBody(h, s, BODY_Z, P2);
      star(fx, P2.x, P2.y, BODY_Z, all ? 64 : 34, '#ffffff', k, 0, all ? 8 : 6);
      if (all) h.spray(P2.x, P2.y, 0.6, cnt(3, k), Pk.Feather, FEATHER, 2, 1.5, 0.8, 1, 5);
      // the first arrow: a gold stance circle under the ranger, until the pierce
      if (s.hit === 0) rune(fx, s.ox, s.oy, 2.2, s.toFinish + 0.15, '#ffd23f', k);
    },
    impact: s => (s.hit === s.hits - 1 ? { shake: 2, flash: 0.4 } : { shake: s.hit % 3 === 2 ? 1.8 : 1 }),
    motif: 'aim',
  },
  'ranger_ud:pin': {
    prep: (fx, h, s) => {
      // three big arrows fall from high up onto a triangle round its target's visible front
      onBody(h, s, 0.4, P2);
      const dy = P2.y - s.y;
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
        fallAt(fx, s.x, s.y, FallObj.Arrow, 1.3, 9, Math.max(0, s.delay - 0.2), Math.min(0.2, s.delay), ARROW, s.k, s.follow, Math.cos(a) * PIN_R, dy + Math.sin(a) * PIN_R * 0.8);
      }
    },
    land: (fx, h, s) => {
      // an electric thread from each planted arrow to its target, a gold column on each arrow and a gold reticle on it,
      // until the pierce
      const k = s.k;
      onBody(h, s, 0.4, P2);
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const px = P2.x + Math.cos(a) * PIN_R;
        const py = P2.y + Math.sin(a) * PIN_R * 0.8;
        tetherFx(fx, px, py, P2.x, P2.y, TetherStyle.Electric, s.toFinish + 0.05, ARROW, k, -1, -1, 0, 3);
        lightPillar(fx, px, py, 0.4, 5, '#ffd23f', k, 0.45);
      }
      crosshairFx(fx, P2.x, P2.y, 1.8, s.toFinish, '#ffd23f', k, -1);
      h.ring(P2.x, P2.y, 0.3, 2.6, 0.3, '#ffffff', 4, 0);
      h.spray(P2.x, P2.y, 0.6, cnt(8, k), Pk.Feather, FEATHER, 2.2, 1.6, 0.8, 1, 5);
    },
    impact: { shake: 4, flash: 0.7 },
  },
  'ranger_ud:pierce': {
    alias: { key: 'ranger_d:pierce', lineAsRect: true }, // ★ the closing ring + the lens flare (PREP) · the beams + the big arrow
    prep: (fx, h, s) => {
      // the hawk of light hovers over the ranger through the breath, wings spread (its top under the boss bar)
      const hw = fx.add(Fx.Wings, s.ox, s.oy, 0.5, FEATHER, s.k);
      hw.r = 2.6;
      hw.z = skyZ(s.oy, 75, 0.8, 2.2);
      hw.oy = skyNudge(s.oy, 75, hw.z);
      hw.follow = s.src;
      hw.wait = Math.max(0, s.delay - 0.5);
      if (!s.local) return;
      // 저격의 숨 (mine): 0.4 s before, the world dims but for the band it will shoot along (+ 0.3 round it) and a thick
      // gold aim line runs it — measured again then (the ranger and its target may have moved); the ★ cuts it
      // (cancelFocus). It stands in for the common breath, which a band this long (8.1 > 6 across) never gets.
      const src = s.src;
      const tgt = s.follow;
      const k = s.k;
      const L = s.area.shape === 'line' ? s.area.length : 16;
      const W = s.area.shape === 'line' ? s.area.width : 3;
      const ox0 = s.ox;
      const oy0 = s.oy;
      const tx0 = s.x;
      const ty0 = s.y;
      const lead = Math.min(0.4, s.delay);
      h.laterSim(s.delay - lead, late => {
        const me = src >= 0 ? h.memo(src) : undefined;
        const tg = tgt >= 0 ? h.memo(tgt) : undefined;
        const ox = me?.x ?? ox0;
        const oy = me?.y ?? oy0;
        const tx = tg?.x ?? tx0;
        const ty = tg?.y ?? ty0;
        const d = Math.hypot(tx - ox, ty - oy);
        const ang = d > 1e-4 ? Math.atan2(ty - oy, tx - ox) : Math.atan2(ty0 - oy0, tx0 - ox0);
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const left = Math.max(0.05, lead - late);
        const center = { x: ox - ux * 0.3, y: oy - uy * 0.3 };
        const area: AreaShape = { shape: 'rect', dir: 'right', anchor: 'start', length: L + 0.6, width: W + 0.6, rot: (ang * 180) / Math.PI };
        h.screen.focusDim(ox + (ux * L) / 2, oy + (uy * L) / 2, L / 2, 0.4, 0.08, left, 0, { area, center, origin: null });
        aimLine(fx, ox, oy, ox + ux * L, oy + uy * L, W, '#ffd23f', k, 0, left);
      });
    },
    land: (fx, h, s) => {
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      const a = ultAngle(s);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const vx = -uy;
      const vy = ux;
      const k = s.k;
      const W = s.area.shape === 'line' ? s.area.width : 3;
      // the band itself goes off: gold as wide as it is, a white core
      beamAlong(fx, s, W, '#ffd23f', 0.32);
      // the hawk of light flies with it between the ranger and its target (where the band is on screen), big wings
      // 0.04 s apart (another player's: one)
      // (기획 24차 검토: hung like the hover hawk — each wing's top under the boss bar, a boss on the top row included)
      onBody(h, s, 1.2, P2);
      const toT = Math.max(2, Math.hypot(P2.x - s.ox, P2.y - s.oy));
      for (let i = 0; i < (s.local ? 3 : 1); i++) {
        const t = Math.min(HAWK_ALONG[s.local ? i : 1] * toT, 16);
        const wy = s.oy + uy * t;
        const w = fx.add(Fx.Wings, s.ox + ux * t, wy, 0.22, FEATHER, k);
        w.r = 2.6 - 0.2 * i;
        hangWings(w, wy, 1.2);
        w.wait = 0.04 * i;
      }
      // a shock tunnel: four thin white lines inside the band; a giant white arrow down it; a big star on its target
      for (let j = 0; j < TUNNEL.length; j++) {
        const o = TUNNEL[j] * (W / 2.2);
        beam(fx, P0.x + vx * o, P0.y + vy * o, P1.x + vx * o, P1.y + vy * o, 0.22, 0.22, '#ffffff', k, 0.015 * j);
      }
      arrow(fx, P0.x, P0.y, P1.x, P1.y, 0.2, 4.2, '#ffffff', k);
      onBody(h, s, BODY_Z, P2);
      star(fx, P2.x, P2.y, BODY_Z, 110, '#ffffff', k, 0, 12);
      // the recoil: a shock round the bow over the floor, a gold hawk rising behind the ranger, an afterimage pushed back
      rings(fx, s.ox, s.oy, 0.3, 3.6, 2, 0.35, '#ffffff', k, -1, 7);
      const hy = s.oy - uy * 0.6;
      const hk = fx.add(Fx.Wings, s.ox - ux * 0.6, hy, 0.4, '#ffd23f', k);
      hk.r = 3.2;
      hangWings(hk, hy, 1.4);
      h.afterimage(s.src, s.ox - ux * 1.1, s.oy - uy * 1.1, 0.35, 1.2);
      sprayAlong(h, s, 4, cnt(3, k), Pk.Feather, FEATHER, 1.6, 1.2, 1.1, 1.2, 5);
      // speed lines along the band (mine) — the finisher's radial ones are off below, or they would replace these
      if (s.local) ultSpeedLines(s.x, s.y, { dir: a, n: 16 });
    },
    charge: { vignetteColor: '#000000', vignette: 0.4 },
    finisher: { speedLines: false },
    linger: { kind: 'gash' }, // a cut along the band
    motif: 'aim',
  },
};

// ─────────────────────────── 메이지 (A15, A16) ───────────────────────────

const mage: Record<string, UltStory> = {
  // ── 조준 「블리자드 · 빙결풍」: the blizzard fan → five icicles → 2.05 s freeze → 2.45 s shatter ──
  'mage_ua:blizzard': {
    prep: (fx, _h, s) => {
      rune(fx, s.ox, s.oy, 1.8, Math.max(0.3, s.delay), ICE, s.k); // the ice rune under the mage
    },
    land: (fx, h, s) => {
      if (s.hit !== 0) {
        footAlong(s, 0.3 + Math.random() * 0.6, P0);
        h.spray(P0.x, P0.y, 0.6, cnt(4, s.k), Pk.Glass, FROST, 2.5, 1.5, 0.5, 4, 4);
        return;
      }
      // snow in the fan's middle, an icy wave over the fan, glass swept out along it
      footAlong(s, 0.55, P0);
      snowIn(fx, P0.x, P0.y, 3.2, 2.1, 30, s.k);
      wave(fx, s.x, s.y, s.area, 0.6, ICE, s.k);
      rings(fx, P0.x, P0.y, 0.5, 3.2, 2, 0.6, ICE, s.k);
      for (let i = 0; i < 4; i++) {
        footAlong(s, 0.25 + 0.25 * i, P1);
        const x = P1.x;
        const y = P1.y;
        const k = s.k;
        h.later(0.07 * i, () => h.spray(x, y, 0.6, cnt(4, k), Pk.Glass, FROST, 4, 2, 0.6, 5, 5));
      }
    },
    impact: s => (s.hit === 0 ? { stop: 40, shake: 4, flash: 0.6 } : null),
    decor: 'blizzard',
  },
  'mage_ua:hail': {
    prep: (fx, _h, s) => {
      fallAt(fx, s.x, s.y, FallObj.Spear, 0.9, 7, s.delay - 0.22, 0.22, ICE, s.k); // an icicle drops
    },
    land: (fx, h, s) => {
      const g = 1 + 0.12 * s.seq;
      h.ring(s.x, s.y, 0.2, s.area.shape === 'circle' ? s.area.radius : 1.3, 0.35, ICE, 4, 0.16 * s.k);
      h.ring(s.x, s.y, 0.3, 1.5, 0.25, '#ffffff', 2, 0);
      h.spray(s.x, s.y, 0.4, cnt(6, s.k), Pk.Glass, FROST, 3.5, 3, 0.55, 8, 5);
      star(fx, s.x, s.y, 0.4, 24 * g, '#ffffff', s.k, 0, 8);
    },
    impact: { shake: 2, flash: 0.5 },
  },
  'mage_ua:freeze': {
    prep: (_fx, h, s) => {
      if (s.local) h.later(Math.max(0, s.delay - 0.3), () => h.screen.vignette('#bfefff', 0.3, 0.45, 0));
    },
    land: (fx, h, s) => {
      // ice on every enemy in the fan, rings closing in on the fan's middle, a frosty wave over it
      encaseEach(fx, h, s, 0.45);
      footAlong(s, 0.55, P0);
      rings(fx, P0.x, P0.y, 3.4, 0.6, 2, 0.4, FROST_WHITE, s.k, -1, 5);
      wave(fx, s.x, s.y, s.area, 0.4, FROST_WHITE, s.k * 0.8);
      if (s.local) h.screen.vignette('#bfefff', 0.45, 0.6, 0);
    },
    impact: { shake: 5, flash: 0.7 },
    motif: 'outline', // integration: 'countdown' rings the cone's whole reach (r 6+) around the 메이지 — outside the fan
  },
  'mage_ua:shatter': {
    // ★ the fan shatters: shards off every frozen enemy, a white wave over the fan, glass flying out along it
    land: (fx, h, s) => {
      // an icy flash over the fan (the grammar's own flash is the mage's colour: off)
      h.flash(s.x, s.y, s.ox, s.oy, s.area, 0.35, '#c8f2ff', s.k);
      eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 0.8, cnt(5, s.k), Pk.Glass, SHARD, 3.5, 3, 0.6, 9, 5), 6);
      wave(fx, s.x, s.y, s.area, 0.5, '#ffffff', s.k);
      footAlong(s, 0.55, P0);
      rings(fx, P0.x, P0.y, 0.5, 3.6, 3, 0.55, ICE, s.k, -1, 7);
      sprayAlong(h, s, 3, cnt(6, s.k), Pk.Glass, FROST_WHITE, 6, 3.5, 0.8, 7, 6, 0.25, 0.85);
      // ice spikes burst up across the fan
      for (let i = 0; i < 5; i++) {
        randomIn(s, P1);
        lightPillar(fx, P1.x, P1.y, 0.35, 3 + Math.random() * 2, FROST, s.k, 0.45);
      }
      midBurst(fx, h, s);
    },
    charge: { vignette: 0 }, // the freeze already tinted the edges
    finisher: { flash: 0, ...OFF_ANCHOR },
  },

  // ── 드래그 「빙결 유성우」: eight icicles round the landing → 1.3 s the great ice star → the blizzard ──
  'mage_ud:freeze': {
    prep: (fx, _h, s) => {
      fallAt(fx, s.x, s.y, FallObj.Spear, 0.9, 7, s.delay - 0.22, 0.22, ICE, s.k);
    },
    land: (fx, h, s) => {
      const g = 1 + 0.1 * s.seq;
      h.ring(s.x, s.y, 0.2, s.area.shape === 'circle' ? s.area.radius : 1.4, 0.3, ICE, 3, 0.14 * s.k);
      h.spray(s.x, s.y, 0.3, cnt(3, s.k), Pk.Smoke, FROST_WHITE, 0.8, 1, 0.6, -0.3, 8);
      h.spray(s.x, s.y, 0.4, cnt(5, s.k), Pk.Glass, FROST, 3, 3, 0.55, 8, 5);
      star(fx, s.x, s.y, 0.4, 22 * g, '#ffffff', s.k, 0, 8);
    },
    impact: s => (s.seq === 0 ? { stop: 35, shake: 3, flash: 0.5 } : { shake: 1.5 }),
    motif: 'rune',
  },
  'mage_ud:shatter': {
    // ★ a great icicle falls from high up for 0.55 s → today's shatter on the spot + an ice burst, everyone in it frozen
    prep: (fx, _h, s) => {
      fallAt(fx, s.x, s.y, FallObj.Spear, 2.2, 11, s.delay - 0.55, 0.55, ICE, s.k);
    },
    alias: { key: 'mage_u:shatter', at: 'point' },
    land: (fx, h, s) => {
      h.flash(s.x, s.y, s.x, s.y, s.area, 0.4, '#a8e8ff', 0.85 * s.k);
      h.ring(s.x, s.y, 0.2, (s.area.shape === 'circle' ? s.area.radius : 3) * 1.1, 0.35, '#ffffff', 4, 0);
      encaseEach(fx, h, s, 0.6);
    },
    charge: { vignette: 0.35 },
    linger: { kind: 'frost', dur: 3 }, // a frost mark (today's scorch is a fire crater: dark with an orange rim)
    motif: 'rune',
  },
  'mage_ud:blizzard': {
    land: (fx, _h, s) => {
      if (s.hit === 0) snowIn(fx, s.x, s.y, s.area.shape === 'circle' ? s.area.radius : 2.8, 3, 24, s.k);
    },
    decor: 'blizzard',
  },
};

registerUltStories({ ...guardian, ...paladin, ...warden, ...blade, ...berserker, ...shadow, ...ranger, ...mage });

// ─────────────────────────── the dragged alts' moves (2-5) ───────────────────────────

/** Points along a move (t ∈ (0, 1)), n of them, each called after the dash reaches it. */
function alongMove(h: UltHost, m: UltMoveInfo, n: number, fn: (x: number, y: number) => void): void {
  const dur = m.kind === 'dash' ? ULT_TEST.dashDuration : 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = m.from.x + (m.to.x - m.from.x) * t;
    const y = m.from.y + (m.to.y - m.from.y) * t;
    if (dur > 0) h.later(dur * t, () => fn(x, y));
    else fn(x, y);
  }
}

const LOOKS: Record<string, UltAltLook> = {
  // 조준 alts that strike from where the caster stands toward the aim (nothing lands ON the aimed point): a small lock
  blade_ua: { lock: 'small' },
  berserker_ua: { lock: 'small' },
  // 섀도우 조준 (기획 23차 검토): the ★ crescent falls ON the aimed point — the full lock-on holds there until it lands
  shadow_ua: { lock: 'point' },
  mage_ua: { lock: 'small' },
  // 가디언: a shield wave runs the dash, steel sparks along it; the touchdown only shakes (the wall's stop is near)
  guardian_ud: {
    touchdownStop: 0,
    move: (fx, h, m) => {
      const dx = m.to.x - m.from.x;
      const dy = m.to.y - m.from.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) return;
      const sw = fx.add(Fx.ShieldWave, (m.from.x + m.to.x) / 2, (m.from.y + m.to.y) / 2, 0.35, m.color, m.k);
      sw.ang = Math.atan2(dy, dx);
      sw.r = len;
      sw.w = 2.2;
      alongMove(h, m, 5, (x, y) => h.spray(x, y, 0.4, cnt(2, m.k), Pk.Square, STEEL_LIGHT, 2.5, 2, 0.4, 8, 4));
    },
  },
  // 팔라딘: a gold beam along the dash; the touchdown only shakes (the brand's stop lands 0.3 s later)
  paladin_ud: {
    touchdownStop: 0,
    move: (fx, h, m) => {
      beam(fx, m.from.x, m.from.y, m.to.x, m.to.y, 1.2, 0.3, GOLD, m.k);
      alongMove(h, m, 4, (x, y) => h.spray(x, y, 0.6, cnt(2, m.k), Pk.Gold, GOLD, 0.8, 1.6, 0.7, -1, 4));
    },
  },
  // 워든: a chain dragged from where it set off to the warden (its touchdown keeps the default stop)
  warden_ud: {
    move: (fx, _h, m) => {
      tetherFx(fx, m.from.x, m.from.y, m.to.x, m.to.y, TetherStyle.Chain, 0.35, CHAIN, m.k, -1, m.entityId, 0.2, 4);
    },
  },
  // 블레이드: three more afterimages and petals on the way; the touchdown only shakes (the dash cut stops at 0.45 s)
  blade_ud: {
    touchdownStop: 0,
    touchdownLive: true, // 기획 23차 검토: its 'dash' part rushes it 7 cells on at cast — the crater where it stands
    move: (_fx, h, m) => {
      alongMove(h, m, 3, (x, y) => {
        h.afterimage(m.entityId, x, y, 0.4);
        h.spray(x, y, 0.6, cnt(2, m.k), Pk.Petal, PETAL, 1.5, 1, 0.6, 2, 4);
      });
    },
  },
  // 버서커: a leap — a ghost and embers where it set off, hidden, then it crashes down from 2.6 onto the 0.45 s slam
  // (no shared touchdown: the slam is the landing; the 착지 컷 runs while it hangs in the air)
  berserker_ud: {
    touchdownAt: 0.45,
    stripFrom: 0.08,
    genericMove: 'lite',
    touchdownStop: 0,
    move: (fx, h, m) => {
      h.afterimage(m.entityId, m.from.x, m.from.y, 0.4);
      h.spray(m.from.x, m.from.y, 0.4, cnt(10, m.k), Pk.Ember, LAVA, 2, 3, 0.6, -1, 5);
      rings(fx, m.to.x, m.to.y, 3, 0.6, 2, 0.45, LAVA, m.k * 0.7);
      h.hideFor(m.entityId, 0.08);
      // after the shared blink's own drop-in (same moment, queued first): this one wins
      h.later(0.08, () => h.drop(m.entityId, 2.6, 0.37));
    },
  },
  // 섀도우: an ink pool where it appears; the touchdown only shakes (the first clone's stop is 0.27 s later)
  shadow_ud: {
    touchdownStop: 0,
    move: (fx, _h, m) => {
      scorchFx(fx, m.to.x, m.to.y, 1.2, 0.9, true, INK_DARK, m.k);
    },
  },
  // 레인저: feathers on the way, a forward roll on landing
  ranger_ud: {
    move: (_fx, h, m) => {
      alongMove(h, m, 4, (x, y) => h.spray(x, y, 0.8, cnt(2, m.k), Pk.Feather, FEATHER, 1.4, 1.2, 0.9, 1, 5));
    },
    touchdown: (_fx, h, m) => {
      h.hop(m.entityId, 1.2, 0.35);
    },
  },
  // 메이지: an ice ring and glass where it appears, the rune under the hail; the touchdown only shakes
  mage_ud: {
    touchdownStop: 0,
    touchdown: (fx, h, m) => {
      h.ring(m.to.x, m.to.y, 0.2, 2.2, 0.4, ICE, 5, 0);
      h.spray(m.to.x, m.to.y, 0.4, cnt(8, m.k), Pk.Glass, FROST, 3, 2.5, 0.5, 8, 5);
      rune(fx, m.to.x, m.to.y, 3.4, 1.5, ICE, m.k);
    },
  },
};

registerUltLooks(LOOKS);

// ─────────────────────────── 22차 accents (「궁극기 연출 강화」 off) ───────────────────────────
// Every staged beat of an alt ult gets the generic landing wave in the character's colour (render/stagefx.ts genericLand);
// these add a ring + sparks (+ a small shake for my own) on the finishers and a flash along the throws. Mine at full
// strength, another player's softer. Keys follow the 23차 stage names (the data is the same either way).

type Stage = Extract<GameEvent, { type: 'skillStage' }>;

/** Another player's accents are drawn at this strength (like render/vfx.ts OTHER_PLAYER_FX). */
const OTHER = 0.6;

const C22 = { steel: '#cfe0ff', holy: '#fff4c2', gold: '#ffe08a', chain: '#c9d6a3', edge: EDGE, blood: '#ff8a65', moon: '#d9d6ff', arrow: ARROW, ice: FROST } as const;

function radiusOf22(a: AreaShape): number {
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
      return a.length / 2;
    default:
      return 1;
  }
}

function onEvent(ev: GameEvent, view: UltFxView): void {
  if (ULT_FX.boost) return; // 기획 23차: the stories above draw everything
  if (ev.type !== 'skillStage' || ev.team !== 'ally' || ev.slot !== 'ult') return;
  const fn = STAGES22[`${ev.skillId}:${ev.stage}`];
  if (!fn) return;
  const local = ev.player === view.localPlayer;
  fn(ev, view, local ? 1 : OTHER, local);
}

type StageFx = (ev: Stage, view: UltFxView, k: number, local: boolean) => void;

/** A big landing: ring out to the footprint, a white core ring, sparks, a shake for my own. */
function slam22(ev: Stage, v: UltFxView, k: number, local: boolean, color: string, shake: number): void {
  const { x, y } = ev.center;
  v.host.ring(x, y, 0.3, Math.min(8, radiusOf22(ev.area)) + 0.5, 0.5, color, 7 * k, 0.18 * k);
  v.host.ring(x, y, 0.2, 1.6, 0.3, '#ffffff', 3 * k, 0);
  v.host.burst(x, y, 0.4, Math.round(22 * k), color, 5, 4, 0.7);
  if (local && shake > 0) v.host.shake(shake);
}

/** A shaped finisher (line / rect / cone / cross): a bright flash of its footprint + sparks on its centre. */
function sweep22(ev: Stage, v: UltFxView, k: number, local: boolean, color: string, shake: number): void {
  const { x, y } = ev.center;
  v.host.flash(x, y, x, y, ev.area, 0.4, color, 0.9 * k);
  v.host.burst(x, y, 0.5, Math.round(16 * k), color, 5.5, 2.5, 0.5);
  if (local && shake > 0) v.host.shake(shake);
}

/** A line / rect from where the part started (its origin is the caster: flash it from there). */
function streak22(ev: Stage, v: UltFxView, k: number, color: string, ox: number, oy: number): void {
  v.host.flash(ev.center.x, ev.center.y, ox, oy, ev.area, 0.3, color, 0.75 * k);
}

/** The caster's spot now (a line's origin), else the part's centre. */
function casterAt(ev: Stage, v: UltFxView): { x: number; y: number } {
  const id = ev.sourceId;
  const e = id != null ? v.state.entities.find(u => u.id === id) : undefined;
  return e ? e.pos : ev.center;
}

const STAGES22: Record<string, StageFx> = {
  // ── 가디언 조준: the thrown shield along its line, the citadel on the point ──
  'guardian_ua:rally': (ev, v, k) => {
    if (ev.hit !== 0) return;
    const o = casterAt(ev, v);
    streak22(ev, v, k, C22.steel, o.x, o.y);
    v.host.burst(ev.center.x, ev.center.y, 0.6, Math.round(10 * k), C22.steel, 3.5, 2, 0.4);
  },
  'guardian_ua:citadel': (ev, v, k, local) => slam22(ev, v, k, local, C22.steel, 6),
  'guardian_ua:wave': (ev, v, k, local) => slam22(ev, v, k, local, C22.steel, 6),
  // ── 가디언 드래그: the wall rises across the dash, then surges ──
  'guardian_ud:citadel': (ev, v, k, local) => sweep22(ev, v, k, local, C22.steel, 6),
  'guardian_ud:wave': (ev, v, k, local) => sweep22(ev, v, k, local, C22.steel, 6),
  // ── 팔라딘: the great cross / the pillar ──
  'paladin_ua:tribunal': (ev, v, k, local) => {
    sweep22(ev, v, k, local, C22.gold, 5);
    v.host.burst(ev.center.x, ev.center.y, 1.2, Math.round(18 * k), C22.holy, 3, 5, 0.9, -1.5);
  },
  'paladin_ud:core': (ev, v, k, local) => {
    slam22(ev, v, k, local, C22.gold, 5);
    v.host.burst(ev.center.x, ev.center.y, 1.2, Math.round(18 * k), C22.holy, 3, 5, 0.9, -1.5);
  },
  // ── 워든: the hook line, the cage, the release ──
  'warden_ua:hook': (ev, v, k) => {
    if (ev.hit !== 0) return;
    streak22(ev, v, k, C22.chain, ev.center.x, ev.center.y);
  },
  'warden_ua:cage': (ev, v, k, local) => slam22(ev, v, k, local, C22.chain, 4),
  'warden_ud:cage': (ev, v, k, local) => slam22(ev, v, k, local, C22.chain, 4),
  'warden_ua:release': (ev, v, k, local) => slam22(ev, v, k, local, C22.chain, 3),
  'warden_ud:release': (ev, v, k, local) => slam22(ev, v, k, local, C22.chain, 3),
  // ── 블레이드: the long cut ──
  'blade_ua:issen': (ev, v, k, local) => sweep22(ev, v, k, local, C22.edge, 6),
  'blade_ud:issen': (ev, v, k, local) => sweep22(ev, v, k, local, C22.edge, 6),
  // ── 버서커: the rush, the leap-slam, the geysers, the finale ──
  'berserker_ua:split': (ev, v, k) => streak22(ev, v, k, C22.blood, ev.center.x, ev.center.y),
  'berserker_ua:quake': (ev, v, k, local) => slam22(ev, v, k, local, C22.blood, 6),
  'berserker_ua:finale': (ev, v, k, local) => slam22(ev, v, k, local, C22.blood, 6),
  'berserker_ud:quake': (ev, v, k, local) => slam22(ev, v, k, local, C22.blood, 4),
  // ── 섀도우: the pass-through mark, the crescent ──
  'shadow_ua:dance': (ev, v, k) => {
    if (ev.area.shape !== 'rect') return; // the rush band (the clone bursts get the generic wave)
    streak22(ev, v, k, C22.moon, ev.center.x, ev.center.y);
  },
  'shadow_ua:moon': (ev, v, k, local) => slam22(ev, v, k, local, C22.moon, 5),
  'shadow_ud:moon': (ev, v, k, local) => slam22(ev, v, k, local, C22.moon, 5),
  // ── 레인저: the sky arrow / the pierce ──
  'ranger_ua:skyshot': (ev, v, k, local) => slam22(ev, v, k, local, C22.arrow, 5),
  'ranger_ud:volley': (ev, v, k) => {
    if (ev.hit !== 0) return;
    const o = casterAt(ev, v);
    streak22(ev, v, k, C22.arrow, o.x, o.y);
  },
  'ranger_ud:pierce': (ev, v, k, local) => {
    const o = casterAt(ev, v);
    v.host.flash(ev.center.x, ev.center.y, o.x, o.y, ev.area, 0.45, '#ffffff', 0.95 * k);
    v.host.burst(ev.center.x, ev.center.y, 0.6, Math.round(16 * k), C22.arrow, 5, 2, 0.5);
    if (local) v.host.shake(5);
  },
  // ── 메이지: the shatter of the fan, the hailstones and the big ice star ──
  'mage_ua:shatter': (ev, v, k, local) => sweep22(ev, v, k, local, C22.ice, 5),
  'mage_ud:freeze': (ev, v, k) => {
    v.host.ring(ev.center.x, ev.center.y, 0.2, radiusOf22(ev.area) + 0.2, 0.3, C22.ice, 3 * k, 0.1 * k);
    v.host.burst(ev.center.x, ev.center.y, 0.8, Math.round(6 * k), C22.ice, 2.5, 1.5, 0.4);
  },
  'mage_ud:shatter': (ev, v, k, local) => slam22(ev, v, k, local, C22.ice, 6),
};

/** 기획 24차 검토 (tests): the keys the per-cast maps hold now (0 once every cast landed its last part, or after a reset). */
export function ultCastKeysA(): number {
  return cutAngles.size + cutSides.size + cutLines.size + rainSpots.size;
}

// 기획 24차 검토: a floor change / a new run drops the per-cast maps (resetUltCore → the modules' reset)
registerUltFx({
  onEvent,
  reset: () => {
    cutAngles.clear();
    cutSides.clear();
    cutLines.clear();
    rainSpots.clear();
  },
});
