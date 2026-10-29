// 기획 22차 궁극기 테스트 — 그룹 A의 조준 / 드래그 궁극기 연출. Characters: guardian · paladin · warden · blade ·
// berserker · shadow · ranger · mage. Only the group-A content track edits this file.
//
// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 3장 A1–A16): one story per beat (`<alt>:<stage>`, `<alt>_path:<stage>`) and
// one look per dragged alt, registered at import. The core (render/ultTest/kit.ts) dresses every beat by its role —
// the finisher gets the common climax (stop, zoom, the big glyph …) — and these stories add each character's own
// pictures: today's storyboards aliased where the tables say (the falling shield / cage / spears, the crescent …), the
// wind-ups of each finisher, the chains, cracks, beams and afterimages along the real footprints. Rules kept here:
//  - 보이는 곳 = 맞는 곳: every picture sits on the beat's real spot / band (a band from its real start, a cone from the
//    caster along its real direction); colour fills stay inside the footprint (outside: thin strokes only).
//  - Another player's / a bot's beat: k 0.55 and low detail (the router sets both); screen effects (vignettes, the
//    screen slash) and hops of the camera are mine only.
//  - Particle counts are small (≈ ≤ 120 per cast with the climax) and halve on a struggling phone (FX_LOAD.low).
//
// The 22차 accents (a ring + sparks on the finishers, flashes on the throws) are kept below for 「궁극기 연출 강화」 off.

import type { AreaShape, GameEvent } from '../../types';
import { ULT_TEST } from '../../data/ultTest/types';
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
  eachEnemy,
  fallAt,
  footAlong,
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

/** n afterimages of a unit along (x0, y0) → (x1, y1) (the last one at the end), `gap` s apart. */
function ghostsAlong(h: UltHost, id: number, x0: number, y0: number, x1: number, y1: number, n: number, dur: number, gap = 0): void {
  if (id < 0) return;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (gap > 0 && i > 1) h.later(gap * (i - 1), () => h.afterimage(id, x, y, dur));
    else h.afterimage(id, x, y, dur);
  }
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
    finisher: { glyph: '城' },
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
    finisher: { glyph: '城', ...OFF_ANCHOR },
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
    finisher: { glyph: '審' },
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
    finisher: { glyph: '審' },
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
  finisher: { glyph: '獄' },
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
    finisher: { glyph: '斬', ...OFF_ANCHOR },
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
    finisher: { glyph: '斬' },
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
    finisher: { glyph: '破' },
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
    finisher: { glyph: '破' },
  },
};

// ─────────────────────────── 섀도우 (A11, A12) ───────────────────────────

/** ★ the crescent's cut: four shadow clones strike in from all round with it, a wide crescent slash, ink. */
function moonCut(fx: SkillFx, h: UltHost, s: UltBeatInfo, ink: number): void {
  const R = (s.area.shape === 'circle' ? s.area.radius : 2.5) * 0.8;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    h.afterimage(s.src, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R * 0.8, 0.35);
  }
  slash(fx, s.x, s.y, 0.9, -0.25, 130, MOONLIGHT, s.k, 0, true);
  h.spray(s.x, s.y, 0.6, cnt(ink, s.k), Pk.Ink, INK_DARK, 3, 2.5, 0.7, 8, 5);
}

/** 섀도우 드래그: where each caster's clones started (its landing) — the slide's ghosts run from there. */
const slideFrom = new Map<number, Vec2>();

const shadow: Record<string, UltStory> = {
  // ── 조준 「월영 질주」: an ink pool, the pass-through band → three clones burst → 1.4 s the crescent over where it stopped ──
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
      beamAlong(fx, s, 2, '#5e60ce', 0.4);
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
    finisher: { glyph: '影' },
    motif: 'reticle',
  },

  // ── 드래그 「그림자 대처형진」: four clones the way it came → the slide → 1 s the X → 1.5 s the crescent on its target ──
  'shadow_ud:clone': {
    alias: { key: 'shadow_d:clone', seqAsHit: true, prep: false }, // (the ink pool is the look's, at the landing)
    land: (_fx, _h, s) => {
      if (s.seq === 0 && s.src >= 0) slideFrom.set(s.src, { x: s.x, y: s.y });
    },
    impact: s => (s.seq === 0 ? { stop: 40, shake: 4 } : { shake: 1.5 }),
  },
  'shadow_ud:vanish': {
    alias: { key: 'shadow_u:vanish' },
    land: (_fx, h, s) => {
      // three afterimages on the slide (from the first clone to where it ends up)
      const id = s.src;
      const from = id >= 0 ? slideFrom.get(id) : undefined;
      if (!from) return;
      h.later(0.17, () => {
        const m = h.memo(id);
        if (!m || Math.hypot(m.x - from.x, m.y - from.y) < 1) return;
        for (let i = 1; i <= 3; i++) h.afterimage(id, from.x + ((m.x - from.x) * i) / 4, from.y + ((m.y - from.y) * i) / 4, 0.4);
      });
    },
  },
  'shadow_ud:execute': {
    alias: { key: 'shadow_d:execute' }, // the X mark gathers (PREP), then the X cut (LAND)
    impact: { shake: 6, flash: 0.9 },
  },
  'shadow_ud:moon': {
    alias: { key: 'shadow_u:moon' },
    land: (fx, h, s) => moonCut(fx, h, s, 8),
    finisher: { glyph: '影' },
    motif: 'reticle',
  },
};

// ─────────────────────────── 레인저 (A13, A14) ───────────────────────────

const ranger: Record<string, UltStory> = {
  // ── 조준 「매의 화살비」: a storm of arrows on the point → the rain → 2.3 s the sky arrow ──
  'ranger_ua:barrage': {
    prep: (fx, _h, s) => {
      aimLine(fx, s.ox, s.oy, s.x, s.y, 0.8, ARROW, s.k, 0, Math.min(0.45, s.delay));
      star(fx, s.ox, s.oy, BODY_Z, 30, '#ffffff', s.k, Math.max(0, s.delay - 0.12), 6); // the bow flashes
    },
    land: (fx, h, s) => {
      randomIn(s, P0);
      runStory('ranger_u:barrage', 'land', fx, h, s, { x: P0.x, y: P0.y }); // an arrow from the bow onto a spot in the circle
      // where it strikes (as the arrow arrives): a small ring, every third a puff of dust and a star
      const x = P0.x;
      const y = P0.y;
      const k = s.k;
      const third = s.hit % 3 === 2;
      const g = 1 + 0.06 * Math.min(8, s.hit);
      h.later(0.14, () => {
        h.ring(x, y, 0.1, 0.7 * g, 0.22, ARROW, 3, 0);
        if (!third) return;
        h.spray(x, y, 0.2, cnt(3, k), Pk.Smoke, '#d8cbb8', 0.8, 1, 0.5, -0.3, 7);
        star(fx, x, y, 0.3, 22 * g, '#ffffff', k, 0, 6);
      });
    },
    impact: s => (s.hit === s.hits - 1 ? { shake: 1, flash: 0.3 } : { shake: 0.8 }),
  },
  'ranger_ua:rain': {
    alias: { key: 'ranger_u:rain' }, // shot up from the bow, then arrows pour onto the circle
    impact: { shake: 2, flash: 0.4 },
    motif: 'reticle',
  },
  'ranger_ua:skyshot': {
    alias: { key: 'ranger_u:skyshot' }, // ★ the reticle, a gold column, the giant arrow falls (today's 하늘 화살)
    prep: (fx, _h, s) => {
      // a ring of six arrows comes down with it
      const R = (s.area.shape === 'circle' ? s.area.radius : 1.6) * 0.75;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        fallAt(fx, s.x, s.y, FallObj.Arrow, 0.45, 7, s.delay - 0.2 - 0.015 * i, 0.2, s.color, s.k, s.follow, Math.cos(a) * R, Math.sin(a) * R * 0.8);
      }
    },
    land: (fx, h, s) => {
      scorchFx(fx, s.x, s.y, 1.2, 2.5, false, '#3a2e26', s.k);
      lightPillar(fx, s.x, s.y, 1.4, 11, '#ffd23f', s.k, 0.5);
      h.ring(s.x, s.y, 0.3, 3, 0.3, '#ffffff', 2, 0);
      h.spray(s.x, s.y, 1.4, cnt(12, s.k), Pk.Feather, FEATHER, 3.5, 2.5, 1.2, 1, 6);
    },
    charge: { vignetteColor: '#000000', vignette: 0.35 },
    finisher: { glyph: '穿' },
    motif: 'reticle',
  },

  // ── 드래그 「매의 대일격」: a roll on landing → three lanes of arrows at the target → 1.25 s the pierce ──
  'ranger_ud:volley': {
    alias: { key: 'ranger_d:volley', lineAsRect: true, land: false }, // the aim line along the band (PREP)
    land: (fx, _h, s) => {
      // three lanes, in turn, each arrow a little bigger
      footAlong(s, 0, P0);
      footAlong(s, 1, P1);
      const a = ultAngle(s);
      const half = (s.area.shape === 'line' ? s.area.width : 2) / 2;
      const lane = ((s.hit % 3) - 1) * half * 0.55;
      const vx = -Math.sin(a) * lane;
      const vy = Math.cos(a) * lane;
      arrow(fx, P0.x + vx, P0.y + vy, P1.x + vx, P1.y + vy, 0.22, 1.2 * (1 + 0.05 * Math.min(8, s.hit)), s.color, s.k);
    },
    impact: s => (s.hit === s.hits - 1 ? { shake: 1, flash: 0.35 } : { shake: 0.8 }),
    motif: 'aim',
  },
  'ranger_ud:pierce': {
    alias: { key: 'ranger_d:pierce', lineAsRect: true }, // ★ the closing ring + the lens flare (PREP) · the beams + the big arrow
    land: (fx, _h, s) => {
      star(fx, s.x, s.y, BODY_Z, 60, '#ffffff', s.k, 0, 12);
    },
    charge: { vignetteColor: '#000000', vignette: 0.4 },
    finisher: { glyph: '穿' },
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
    finisher: { glyph: '凍', flash: 0, ...OFF_ANCHOR },
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
    finisher: { glyph: '凍' },
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
  shadow_ua: { lock: 'small' },
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

registerUltFx({ onEvent });
