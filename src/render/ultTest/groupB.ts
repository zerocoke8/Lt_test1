// 기획 23차 궁극기 연출 강화 — 그룹 B의 조준 / 드래그 궁극기 이야기 (docs/ult-fx.md 3장 B1–B14). Characters: gunner ·
// cleric · medic · exorcist · bard · chrono · puppeteer. Only the group-B content track edits this file.
//
// Every beat of an alt is routed by render/vfx.ts through the stories registered here (`<alt>:<stage>`): its wind-up
// (prep, at the cast), its burst (land, at each hit), its kick (impact), and on the finale beat the common finisher
// grammar (render/ultTest/grammar.ts: stop, zoom, the big glyph …) dressed by `finisher` / `charge` / `linger`. Today's
// storyboards are reused through `alias` (the falling heavy shell, the bell, the defib cross, 滅, the clock, the dolls);
// the rest is drawn here with the kit (render/ultTest/kit.ts — the only render import of this file). The looks
// (registerUltLooks) dress the 드래그 moves: knee-slide sparks, feathers, a heart-line beam, talismans flying ahead, notes,
// a rewound film, a thread.
// Rules kept: colour fills stay inside the real footprint (outside it only thin white rings that are gone in 0.35 s);
// another player's / a bot's beat is drawn at its k (0.55) and low detail (no light pillars, half the rings), never a
// screen effect (vignette, grey-out, spotlight) — those are mine only. Particle counts halve on a struggling phone
// (FX_LOAD.low, 2-8).
//
// 「궁극기 연출 강화」 off (ULT_FX.boost false): the router skips every story; the 22차 accents below come back instead.

import type { AreaShape, GameEvent } from '../../types';
import {
  FX_LOAD,
  Fx,
  FallObj,
  GOLD,
  HANJI,
  HOLY,
  INK,
  MEDIC,
  PUPPET,
  Pk,
  TALISMAN,
  TetherStyle,
  ULT_FX,
  aimLine,
  alliesGlow,
  areaFx,
  beam,
  beamAlong,
  boltFx,
  clock,
  eachEnemy,
  fallAt,
  footAlong,
  glyphFx,
  lightPillar,
  notes,
  registerUltLooks,
  registerUltStories,
  rings,
  runStory,
  scorchFx,
  star,
  tetherFx,
  ultAngle,
  ultHitMarks,
  wave,
  xslash,
  type SkillFx,
  type UltBeatInfo,
  type UltHost,
  type UltMoveInfo,
  type UltStory,
  type Vec2,
} from './kit';
import { registerUltFx, type UltFxView } from './index';

// ─────────────────────────── small private helpers ───────────────────────────

const TAU = Math.PI * 2;
/** Particle count at strength k (another player's: × 0.55), halved on a struggling phone (2-8, FX_LOAD.low; 기획 23차 검토). */
const nk = (c: number, k: number) => Math.max(0, Math.round(c * k * (FX_LOAD.low ? 0.5 : 1)));
/** Particle count at the beat's strength. */
const n = (c: number, s: { k: number }) => nk(c, s.k);
const isSelf = (s: UltBeatInfo) => s.action?.affects === 'self';
const isAllies = (s: UltBeatInfo) => s.action?.affects === 'allies';

const P: Vec2 = { x: 0, y: 0 };
const Q: Vec2 = { x: 0, y: 0 };

const FIRE = '#ff9e3d';
const SHELL = '#adb5bd';
const SPARK = '#bdf6ff';
const FEATHER = '#fffbe6';
const HEAL = '#7dffb3';
const BARD = '#e056fd';
const TIME = '#cfd5ff';
const PETAL = '#ffb3d9';

/** The four axes of a cross footprint (a diagonal one turned 45°). */
function crossAxes(a: AreaShape): readonly Vec2[] {
  return a.shape === 'cross' && a.diagonal ? DIAG : PLUS;
}
const R2 = Math.SQRT1_2;
const PLUS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const DIAG: readonly Vec2[] = [
  { x: R2, y: R2 },
  { x: -R2, y: -R2 },
  { x: R2, y: -R2 },
  { x: -R2, y: R2 },
];
const crossLen = (a: AreaShape) => (a.shape === 'cross' ? a.length : 3);
const crossWidth = (a: AreaShape) => (a.shape === 'cross' ? a.width : 1);

/**
 * A band's width (line / rect; 2 otherwise). A beam is drawn in screen pixels at its world width × 0.5 → × 0.75 as it
 * fades, and a band lying across the screen is squashed (render/camera.ts GROUND_SQUASH 0.55): a beam of at most 0.7 ×
 * the band's width stays inside it either way.
 */
const bandW = (s: UltBeatInfo) => (s.area.shape === 'line' || s.area.shape === 'rect' ? s.area.width : 2);

/** A line footprint (from its origin toward its point) as a turned start-anchored rect, a fresh object (an Sfx keeps it). */
function lineRect(s: UltBeatInfo): AreaShape {
  const a = s.area;
  const len = a.shape === 'line' || a.shape === 'rect' ? a.length : 6;
  const w = a.shape === 'line' || a.shape === 'rect' ? a.width : 2;
  return { shape: 'rect', dir: 'right', anchor: 'start', length: len, width: w, rot: (ultAngle(s) * 180) / Math.PI };
}

/** Allies inside a line / band footprint (projected on its axis): a light column + gold dust each, at most `max`. */
function glowAlliesInBand(fx: SkillFx, h: UltHost, s: UltBeatInfo, color: string, max = 4, pillar = true): void {
  footAlong(s, 0, P);
  footAlong(s, 1, Q);
  const dx = Q.x - P.x;
  const dy = Q.y - P.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const hw = (s.area.shape === 'line' || s.area.shape === 'rect' ? s.area.width : 2) / 2;
  let i = 0;
  for (const m of h.allies()) {
    if (i >= max) break;
    const rx = m.x - P.x;
    const ry = m.y - P.y;
    const along = rx * ux + ry * uy;
    const across = Math.abs(-rx * uy + ry * ux);
    if (along < -m.radius || along > L + m.radius || across > hw + m.radius) continue;
    if (pillar) lightPillar(fx, m.x, m.y, 0.45, 4.2, color, s.k, 0.55, m.id);
    h.spray(m.x, m.y, 1, n(4, s), Pk.Gold, color, 0.8, 1.6, 0.8, -1.2, 4);
    i++;
  }
}

/** A talisman flying from (x, y) to (x2, y2): its flight is the first 30 % of dur (render/fxparts.ts talisman). */
function talisman(fx: SkillFx, x: number, y: number, x2: number, y2: number, flySec: number, k: number, wait: number, flip: number): void {
  const f = fx.add(Fx.Talisman, x, y, flySec / 0.3, TALISMAN, k);
  f.x2 = x2;
  f.y2 = y2;
  f.z = 0.6;
  f.flip = flip;
  f.wait = Math.max(0, wait);
}

/** A talisman already pinned at (x, y) from `wait` for `sec` (no flight: it starts past its 30 % flight). */
function pinned(fx: SkillFx, x: number, y: number, wait: number, sec: number, k: number, flip: number): void {
  const dur = sec / 0.7;
  const f = fx.add(Fx.Talisman, x, y, dur, TALISMAN, k);
  f.z = 0.6;
  f.flip = flip;
  f.age = dur * 0.3;
  f.wait = Math.max(0, wait);
}

/**
 * Spots remembered between a beat's wind-up and its landing (거너's shells fall where they burst) or between beats (the
 * dolls a curtain call stars). Render-only, a handful of keys (the oldest go).
 */
const SPOTS = new Map<string, Vec2[]>();
function spots(key: string, fresh = false): Vec2[] {
  let list = SPOTS.get(key);
  if (!list || fresh) {
    if (SPOTS.size > 24) SPOTS.delete(SPOTS.keys().next().value as string);
    list = [];
    SPOTS.set(key, list);
  }
  return list;
}
const shellKey = (s: UltBeatInfo) => `${s.src}|${s.skillId}|${s.actionIndex}`;
const dollKey = (s: UltBeatInfo) => `${s.src}|${s.skillId}|dolls`;
const gateKey = (s: UltBeatInfo) => `${s.src}|${s.skillId}|gates`;

/** A curtain closing over a band: two beams of its width from both ends meeting in the middle (inside the band). */
function curtains(fx: SkillFx, s: UltBeatInfo, color: string, dur: number): void {
  footAlong(s, 0, P);
  footAlong(s, 1, Q);
  const mx = (P.x + Q.x) / 2;
  const my = (P.y + Q.y) / 2;
  const w = bandW(s) * 0.7;
  beam(fx, P.x, P.y, mx, my, w, dur, color, s.k);
  beam(fx, Q.x, Q.y, mx, my, w, dur, color, s.k);
}

// ─────────────────────────── 거너 (B1, B2) ───────────────────────────

const gunner: Record<string, UltStory> = {
  // B1 조준: each spot gets two shells falling from high up onto random points of it; the first spot a red flare
  'gunner_ua:shells': {
    prep: (fx, h, s) => {
      const R = s.beat.radius;
      const g = 1 + 0.06 * s.seq;
      const blast = Math.min(1.5, 1.05 * g);
      const list = spots(shellKey(s), true);
      for (let i = 0; i < s.hits; i++) {
        const a = Math.random() * TAU;
        const rr = Math.sqrt(Math.random()) * Math.max(0, R - blast);
        const p = { x: s.x + Math.cos(a) * rr, y: s.y + Math.sin(a) * rr * 0.8 };
        list.push(p);
        fallAt(fx, p.x, p.y, FallObj.Shell, 0.5 + 0.04 * s.seq, 8, s.delay + i * s.beat.hitInterval - 0.2, 0.2, SHELL, s.k);
      }
      if (s.seq === 0) {
        // the red flare marks where the barrage starts
        lightPillar(fx, s.x, s.y, 0.45, 6, '#ff4d4d', s.k * 0.8, 1.6);
        h.spray(s.x, s.y, 0.5, n(10, s), Pk.Smoke, '#ff6b6b', 0.6, 2.5, 1.4, -0.6, 9);
      }
    },
    land: (fx, h, s) => {
      const g = 1 + 0.06 * s.seq + 0.03 * s.hit;
      const r = Math.min(1.5, 1.05 * g);
      const p = spots(shellKey(s))[s.hit] ?? { x: s.x, y: s.y };
      h.flash(p.x, p.y, p.x, p.y, { shape: 'circle', radius: r }, 0.3, '#ff7b00', 0.75 * s.k);
      h.ring(p.x, p.y, 0.1, r, 0.3, GOLD, 4, 0.25 * s.k);
      star(fx, p.x, p.y, 0.4, 26 * g, '#ffe8a3', s.k, 0, 6);
      h.spray(p.x, p.y, 0.2, n(5, s), Pk.Ember, '#ffb347', 2.5 * g, 3, 0.45, 6, 4);
      h.spray(p.x, p.y, 0.4, n(2, s), Pk.Smoke, '#6b5b4b', 0.6, 1.2, 0.8, -0.5, 7);
      scorchFx(fx, p.x, p.y, 0.8 * g, 1.5, false, '#ff7b00', s.k);
    },
    impact: s => (s.seq === 0 && s.hit === 0 ? { stop: 35, shake: 4, flash: 0.5 } : { shake: 2.5, flash: 0.3 }),
  },
  // ★ the heavy shell: today's reticle + fall, its blast, a column of fire
  'gunner_ua:heavy': {
    alias: { key: 'gunner_u:heavy' },
    land: (fx, h, s) => {
      lightPillar(fx, s.x, s.y, 1.5, 9, FIRE, s.k, 0.6);
      h.spray(s.x, s.y, 0.3, n(8, s), Pk.Rock, '#5c4033', 5, 5, 0.9, 12, 6);
    },
    charge: { vignetteColor: '#000000', vignette: 0.35 },
    finisher: { glyph: '爆', sparks: 30 },
    linger: null, // today's scorch is its own mark
    motif: 'reticle',
  },
  // B2 드래그: three shotgun blasts the way it moved, each bigger
  'gunner_ud:blast1': {
    alias: { key: 'gunner_d:blast1' },
    land: (fx, h, s) => {
      const g = 1 + 0.15 * s.hit;
      const ang = ultAngle(s);
      star(fx, s.x + Math.cos(ang) * 0.7, s.y + Math.sin(ang) * 0.7, 0.6, 34 * g, '#fff3c4', s.k, 0, 6);
      wave(fx, s.x, s.y, s.area, 0.3, '#ffffff', s.k * 0.35 * g);
      h.spray(s.x, s.y, 0.7, n(2, s), Pk.Square, '#c9a227', 2, 3, 0.7, 11, 4);
      if (s.hit === s.hits - 1) ultHitMarks(fx, h, s, 4);
    },
    impact: s => (s.hit === 0 ? { stop: 40, shake: 4, flash: 0.6 } : { shake: 3, flash: 0.5 }),
    motif: 'fan',
  },
  // ★ the slug: the barrel heats, an orange aim line down the lane, then today's slug + the recoil ghost
  'gunner_ud:slug': {
    alias: { key: 'gunner_d:slug' },
    prep: (fx, h, s) => {
      footAlong(s, 0, P);
      footAlong(s, 1, Q);
      aimLine(fx, P.x, P.y, Q.x, Q.y, 2, FIRE, s.k, s.delay - 0.45, 0.45);
      const x = s.ox;
      const y = s.oy;
      const k = s.k;
      h.later(Math.max(0, s.delay - 0.45), () => h.spray(x, y, 0.8, nk(6, k), Pk.Ember, FIRE, 0.6, 2.2, 0.5, -1, 4));
    },
    land: (fx, h, s) => {
      if (s.hit !== 0) return;
      footAlong(s, 0, P);
      footAlong(s, 1, Q);
      h.afterimage(s.src, P.x, P.y, 0.4); // where it fired from, before the recoil
      star(fx, Q.x, Q.y, 0.6, 50, '#ffffff', s.k, 0, 10);
      beamAlong(fx, s, bandW(s) * 0.7, '#ffffff', 0.25);
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        h.spray(P.x + (Q.x - P.x) * t, P.y + (Q.y - P.y) * t, 0.3, n(3, s), Pk.Rock, '#6b5b4b', 3, 3.5, 0.6, 11, 5);
      }
    },
    charge: { vignetteColor: '#000000', vignette: 0.35 },
    finisher: { glyph: '爆' },
    motif: 'fan',
  },
};

// ─────────────────────────── 클레릭 (B3, B4) ───────────────────────────

const cleric: Record<string, UltStory> = {
  // B3 조준: today's grace on the allies, feathers and a ring of light over the point
  'cleric_ua:grace': {
    alias: { key: 'cleric_u:grace' },
    land: (fx, h, s) => {
      rings(fx, s.x, s.y, 0.4, s.beat.radius * 0.95, 2, 0.6, GOLD, s.k, -1, 5);
      lightPillar(fx, s.x, s.y, 1, 7, HOLY, s.k, 0.7);
      h.spray(s.x, s.y, 2.6, n(10, s), Pk.Feather, FEATHER, 1.8, 0.3, 1.5, 0.7, 6);
    },
    impact: { screen: 0.3, screenColor: FEATHER },
  },
  // three rings of light close in on the point (the last one white, the stun)
  'cleric_ua:judgement': {
    alias: { key: 'cleric_u:judgement' },
    land: (fx, h, s) => {
      const r = s.beat.radius;
      const last = s.seq === s.seqN - 1;
      rings(fx, s.x, s.y, r + 0.5, Math.max(0.4, r * 0.35), 1, 0.4, last ? '#ffffff' : GOLD, s.k, -1, 6 + 2 * s.seq);
      h.implode(s.x, s.y, 0.4, Math.max(1.2, r * 0.85), n(8, s), '#fff3c4', 0.4, Pk.Gold);
      if (!last) return;
      star(fx, s.x, s.y, 0.6, 44, '#ffffff', s.k, 0, 10);
      lightPillar(fx, s.x, s.y, 0.8, 7, HOLY, s.k, 0.5);
      ultHitMarks(fx, h, s, 4);
    },
    impact: s => (s.seq === 2 ? { stop: 45, shake: 5, flash: 0.8 } : { shake: 2.5, flash: 0.5 }),
    motif: 'ticks',
  },
  // ★ 대천사 강림: wings open high over the point and a thin column grows, then the great column, rings, feathers
  'cleric_ua:descend': {
    prep: (fx, _h, s) => {
      if (s.role !== 'finisher') return;
      const w = Math.max(0, s.delay - 0.9);
      const wg = fx.add(Fx.Wings, s.x, s.y, 1.15, HOLY, s.k);
      wg.r = 4.5;
      wg.z = 2.4;
      wg.wait = w;
      lightPillar(fx, s.x, s.y, 0.35, 12, '#ffffff', s.k * 0.8, 0.95, -1, w);
    },
    land: (fx, h, s) => {
      if (isAllies(s)) return alliesGlow(fx, h, s, HEAL, false);
      lightPillar(fx, s.x, s.y, 2.2, 12, GOLD, s.k, 0.9);
      rings(fx, s.x, s.y, 0.5, 6, 3, 0.7, HOLY, s.k, -1, 6); // out to the allies' circle (r 6)
      runStory('cleric_d:descend', 'land', fx, h, s, { k: 1.6 });
      h.spray(s.x, s.y, 1, n(12, s), Pk.Gold, GOLD, 3, 3, 1, -1, 5);
    },
    impact: null, // the twin (allies) kicks nothing; the finisher is the grammar's
    charge: { vignette: 0.3 },
    finisher: { glyph: '聖' },
    motif: 'ticks',
  },
  // B4 드래그: today's 강림 on the landing + the allies' light
  'cleric_ud:descend': {
    alias: { key: 'cleric_d:descend' },
    land: (fx, h, s) => alliesGlow(fx, h, s, GOLD),
    impact: { shake: 3, screen: 0.25, screenColor: FEATHER },
  },
  'cleric_ud:sanctuary': { alias: { key: 'cleric_d:sanctuary' }, decor: 'sanctuary', impact: null },
  // the bell tolls twice on its way down: gold rings on the ground, a flash at the bell, notes
  'cleric_ud:judgement': {
    land: (fx, h, s) => {
      const g = 1 + 0.15 * s.seq;
      rings(fx, s.x, s.y, 0.5, s.beat.radius + 0.3, 2, 0.6, GOLD, s.k, -1, 5);
      // the bell is this high now (the fall of cleric_ud:bell's prep: 7 × (1 − t²) over 0.45 → 2 s)
      const t = Math.max(0, Math.min(1, (s.beat.at - BELL.from) / BELL.fall));
      const z = bellZ(s.y) * (1 - t * t);
      star(fx, s.x, s.y, z, 40 * g, HOLY, s.k, 0, 8);
      h.ring(s.x, s.y, 0.3, 2.4 * g, 0.3, '#ffffff', 3, 0);
      notes(fx, s.x, s.y, 1.6, GOLD, s.k);
      h.spray(s.x, s.y, z, n(6, s), Pk.Gold, GOLD, 2.5, 1, 0.8, 3, 5);
    },
    impact: { shake: 3, flash: 0.6 },
    motif: 'ticks',
  },
  // ★ the bell: it comes down slowly from high up through the whole wait, then today's bell ×1.4 + a column, rings
  'cleric_ud:bell': {
    prep: (fx, _h, s) => {
      if (s.role !== 'finisher') return;
      fallAt(fx, s.x, s.y, FallObj.Bell, 2.2, bellZ(s.y), s.delay - BELL.fall, BELL.fall, GOLD, s.k);
    },
    alias: { key: 'cleric_d:bell', prep: false, k: 1.4 }, // (its allies twin: today's green light on the allies)
    land: (fx, h, s) => {
      if (s.role !== 'finisher') return;
      lightPillar(fx, s.x, s.y, 2, 10, HOLY, s.k, 0.8);
      h.ring(s.x, s.y, 0.4, 6.5, 0.3, '#ffffff', 3, 0);
      // the toll runs out to the rim: six columns of light around it (inside the circle)
      const R = s.beat.radius * 0.75;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        lightPillar(fx, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R * 0.8, 0.6, 6, GOLD, s.k, 0.55, -1, 0.03 * i);
      }
      h.spray(s.x, s.y, 0.6, n(16, s), Pk.Gold, GOLD, 4, 3.5, 0.9, 5, 5);
      h.spray(s.x, s.y, 2, n(10, s), Pk.Feather, FEATHER, 2.5, 1, 1.4, 0.8, 6);
    },
    impact: null,
    finisher: { glyph: '聖', screenColor: '#fff3b0' },
    motif: 'ticks',
  },
};

/** 클레릭 드래그's bell: from at most 7 high, falling from 0.45 s for 1.55 s (lands with the 2 s finale). */
const BELL = { z: 7, from: 0.45, fall: 1.55 } as const;
/**
 * How high the bell starts over a spot at world y: 7 (the spec), but never above the top of the field on the fixed
 * phone camera (a landing near the boss at y ≈ 5 would start it under the HUD and keep it there most of its fall).
 */
const bellZ = (y: number) => Math.max(2.4, Math.min(BELL.z, 0.69 * y - 0.1));

// ─────────────────────────── 메딕 (B5, B6) ───────────────────────────

/** 메딕 조준: the white cross burning in on the aimed point before the heal (2.2 arms, 0.9 wide — inside the 4.5 circle). */
const MED_SIGN: AreaShape = { shape: 'cross', length: 2.2, width: 0.9 };

/** Lightning along the four arms of a cross (from its middle), after `wait`. */
function armBolts(fx: SkillFx, s: UltBeatInfo, dur: number, color: string, wait: number): void {
  const L = crossLen(s.area);
  for (const u of crossAxes(s.area)) boltFx(fx, s.x, s.y, s.x + u.x * L, s.y + u.y * L, dur, color, s.k, Math.max(0, wait));
}

const medic: Record<string, UltStory> = {
  // B5 조준: a white cross burns in on the point with a white column, then today's golden hour + the first-aid wave
  'medic_ua:golden': {
    alias: { key: 'medic_u:golden' },
    prep: (fx, _h, s) => {
      if (!isAllies(s)) return;
      areaFx(fx, Fx.Brand, s.x, s.y, MED_SIGN, s.delay + 0.1, '#ffffff', s.k, 0, 2);
      lightPillar(fx, s.x, s.y, 0.9, 6, '#ffffff', s.k, s.delay + 0.15);
    },
    land: (fx, h, s) => {
      if (isAllies(s)) runStory('medic_d:firstaid', 'land', fx, h, s);
    },
    impact: null,
  },
  // the field's siren: teal and red / white rings out to its edge (today's siren reached 11 cells)
  'medic_ua:siren': {
    land: (fx, h, s) => {
      const R = s.beat.radius;
      rings(fx, s.x, s.y, 0.5, R, 2, 0.8, MEDIC, s.k, -1, 6);
      rings(fx, s.x, s.y, 0.5, R * 0.75, 1, 0.6, s.hit % 2 ? '#ffffff' : '#ff4d6d', s.k * 0.8, -1, 4);
      if (s.hit > 0) h.spray(s.x, s.y, 0.4, n(3, s), Pk.Gold, HEAL, R * 0.6, 1.4, 0.7, -1, 4);
    },
    decor: 'sanctuary',
    impact: null,
  },
  // the field charges: lightning runs in from its rim to the middle, a ring closes, every enemy in it is struck
  'medic_ua:charge': {
    land: (fx, h, s) => {
      const g = 1 + 0.25 * s.seq;
      const R = s.beat.radius * 0.92;
      const turn = s.seq * 0.4;
      for (let i = 0; i < 6; i++) {
        const a = turn + (i / 6) * TAU;
        boltFx(fx, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R, s.x, s.y, 0.24, SPARK, s.k, 0.015 * i);
      }
      wave(fx, s.x, s.y, s.area, 0.3, SPARK, s.k * 0.35 * g);
      rings(fx, s.x, s.y, s.beat.radius, 0.6, 1, 0.3, SPARK, s.k, -1, 5);
      star(fx, s.x, s.y, 0.5, 30 * g, SPARK, s.k, 0, 6);
      eachEnemy(h, s, s.area, m => {
        boltFx(fx, s.x, s.y, m.x, m.y, 0.22, SPARK, s.k);
        star(fx, m.x, m.y, 0.65, 24 * g, '#ffffff', s.k, 0, 4);
      }, 6);
    },
    impact: { shake: 2.5, flash: 0.5 },
  },
  // ★ 「클리어!」: lightning runs the arms 0.3 s before, then today's defib ×1.5 + bolts to everyone it hit
  'medic_ua:defib': {
    prep: (fx, _h, s) => {
      armBolts(fx, s, 0.3, SPARK, s.delay - 0.3);
    },
    alias: { key: 'medic_d:defib', prep: false, k: 1.5 },
    land: (fx, h, s) => {
      eachEnemy(h, s, s.area, m => boltFx(fx, s.x, s.y, m.x, m.y, 0.3, '#ffffff', s.k), 6);
      h.spray(s.x, s.y, 0.5, n(10, s), Pk.Square, '#ffffff', 4, 2.5, 0.45, 6, 4);
    },
    charge: { vignette: 0.3 },
    finisher: { glyph: '救' },
    motif: 'outline',
  },
  'medic_ua:firstaid': { alias: { key: 'medic_d:firstaid' }, impact: null },

  // B6 드래그: the path — every ally on it lit, a heart-line of lightning from where she set off
  'medic_ud_path:path': {
    land: (fx, h, s) => {
      boltFx(fx, s.ox, s.oy, s.x, s.y, 0.35, MEDIC, s.k);
      boltFx(fx, s.ox, s.oy, s.x, s.y, 0.25, '#ffffff', s.k, 0.12);
      glowAlliesInBand(fx, h, s, HEAL);
    },
    impact: null,
  },
  'medic_ud:firstaid': { alias: { key: 'medic_d:firstaid' }, impact: null },
  'medic_ud:golden': { wave: false, impact: null }, // the bench heal: no picture
  // the cross charges: lightning along its arms (today's defib wind-up), a growing star, a faint pulse of the cross
  'medic_ud:charge': {
    land: (fx, h, s) => {
      const g = 1 + 0.25 * s.seq;
      runStory('medic_d:defib', 'prep', fx, h, s);
      star(fx, s.x, s.y, 0.5, 30 * g, SPARK, s.k, 0, 6);
      wave(fx, s.x, s.y, s.area, 0.3, SPARK, s.k * 0.4 * g);
      eachEnemy(h, s, s.area, m => star(fx, m.x, m.y, 0.65, 20 * g, '#ffffff', s.k, 0, 4), 4);
    },
    impact: { shake: 2.5, flash: 0.5 },
  },
  // ★ the defib: a last crackle, then today's defib ×1.5 + rings + bolts to everyone it hit
  'medic_ud:defib': {
    prep: (fx, _h, s) => armBolts(fx, s, 0.2, '#ffffff', s.delay - 0.2),
    alias: { key: 'medic_d:defib', prep: false, k: 1.5 },
    land: (fx, h, s) => {
      rings(fx, s.x, s.y, 0.5, crossLen(s.area), 2, 0.5, SPARK, s.k, -1, 6);
      eachEnemy(h, s, s.area, m => boltFx(fx, s.x, s.y, m.x, m.y, 0.3, '#ffffff', s.k), 6);
      h.spray(s.x, s.y, 0.5, n(8, s), Pk.Square, '#ffffff', 4, 2.5, 0.45, 6, 4);
    },
    charge: { vignette: 0.3 },
    finisher: { glyph: '救' },
    motif: 'outline',
  },
};

// ─────────────────────────── 퇴마사 (B7, B8) ───────────────────────────

const exorcist: Record<string, UltStory> = {
  // B7 조준: eight talismans fly from the exorcist onto the wall, an ink brand, then 封 + a wave of talisman light
  'exorcist_ua:greatseal': {
    prep: (fx, _h, s) => {
      for (let i = 0; i < 8; i++) {
        footAlong(s, (i + 0.5) / 8, P);
        talisman(fx, s.ox, s.oy, P.x, P.y, s.delay, s.k, 0, i % 2 ? 1 : -1);
      }
      areaFx(fx, Fx.Brand, s.x, s.y, s.area, s.delay, INK, s.k * 0.8, 0, 2);
    },
    land: (fx, h, s) => {
      glyphFx(fx, s.x, s.y, 1.2, '封', 60, '#ffe8a3', s.k, 0.7);
      wave(fx, s.x, s.y, s.area, 0.45, TALISMAN, s.k);
      for (let i = 0; i < 4; i++) {
        footAlong(s, (i + 0.5) / 4, P);
        h.spray(P.x, P.y, 0.8, n(3, s), Pk.Paper, TALISMAN, 2.5, 2.5, 0.8, 4, 5);
      }
      eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 0.6, n(3, s), Pk.Ink, '#3a0a0c', 1.4, 1.5, 0.6, 4, 5), 6);
    },
    impact: { stop: 45, shake: 4, flash: 0.7 },
  },
  // the wall's storm: spirits out of the enemies in it; the talismans stay pinned on it (the 'talismans' decor is a ring)
  'exorcist_ua:storm': {
    alias: { key: 'exorcist_u:storm' },
    land: (fx, _h, s) => {
      if (s.hit !== 0) return;
      // the greatseal's flying talismans land at 0.45 s and fade from 1.2 s: these take over in place until the end
      const left = s.action?.zone?.duration ?? 2;
      for (let i = 0; i < 8; i++) {
        footAlong(s, (i + 0.5) / 8, P);
        pinned(fx, P.x, P.y, 0.75, Math.max(0.3, left - 0.75), s.k, i % 2 ? 1 : -1);
      }
    },
    impact: null,
  },
  // the seal along the aim: four talismans fly onto it, then a wave of light and 印
  'exorcist_ua:seal': {
    prep: (fx, _h, s) => {
      for (let i = 0; i < 4; i++) {
        footAlong(s, (i + 0.5) / 4, P);
        talisman(fx, s.ox, s.oy, P.x, P.y, 0.3, s.k, s.delay - 0.3, i % 2 ? 1 : -1);
      }
    },
    land: (fx, h, s) => {
      wave(fx, s.x, s.y, s.area, 0.45, TALISMAN, s.k);
      glyphFx(fx, s.x, s.y, 1, '印', 50, '#ff3b3b', s.k, 0.6);
      for (let i = 0; i < 4; i++) {
        footAlong(s, (i + 0.5) / 4, P);
        h.spray(P.x, P.y, 0.8, n(2, s), Pk.Paper, TALISMAN, 2.5, 2.5, 0.7, 4, 5);
      }
    },
    impact: { shake: 4, flash: 0.7 },
    motif: 'outline',
  },
  // ★ 멸 on both lines: 滅 rises over the point, then today's 멸 on the wall, the seal band flares, the allies healed
  'exorcist_ua:destroy': {
    prep: (fx, h, s) => {
      if (s.role === 'finisher') runStory('exorcist_u:destroy', 'prep', fx, h, s, { at: 'point' });
    },
    land: (fx, h, s) => {
      if (isAllies(s)) return alliesGlow(fx, h, s, HEAL, false);
      if (s.role !== 'finisher') {
        // the seal band (twin): its own flare of talisman light
        h.flash(s.x, s.y, s.x, s.y, s.area, 0.3, TALISMAN, 0.9 * s.k);
        wave(fx, s.x, s.y, s.area, 0.5, TALISMAN, s.k);
        beamAlong(fx, s, bandW(s) * 0.6, '#fff3c4', 0.3);
        return;
      }
      runStory('exorcist_u:destroy', 'land', fx, h, s);
      beamAlong(fx, s, bandW(s) * 0.7, '#fff3c4', 0.35);
      h.spray(s.x, s.y, 0.8, n(10, s), Pk.Ember, '#ff7b00', 3, 3, 0.8, 2, 4);
    },
    impact: null,
    charge: { vignette: 0.45 },
    finisher: { glyph: '滅' },
    motif: 'outline',
  },

  // B8 드래그: today's great seal on the landing (the talismans flew there with the blink, the look below)
  'exorcist_ud:greatseal': {
    alias: { key: 'exorcist_u:greatseal' },
    land: (_fx, h, s) => {
      eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 0.6, n(3, s), Pk.Ink, '#3a0a0c', 1.4, 1.5, 0.6, 4, 5), 6);
    },
    impact: { stop: 45, shake: 4, flash: 0.6 },
  },
  'exorcist_ud:storm': { alias: { key: 'exorcist_u:storm' }, decor: 'talismans', impact: null },
  // the eight gates open one after another: a column of talisman light, a ring, paper — each a little bigger
  'exorcist_ud:seal': {
    land: (fx, h, s) => {
      const g = 1 + 0.08 * s.seq;
      lightPillar(fx, s.x, s.y, 0.6 * g, 5, TALISMAN, s.k, 0.5);
      h.ring(s.x, s.y, 0.2, s.beat.radius, 0.35, TALISMAN, 4, 0.12 * s.k);
      spots(gateKey(s), s.seq === 0).push({ x: s.x, y: s.y });
      h.spray(s.x, s.y, 0.8, n(4, s), Pk.Paper, TALISMAN, 2 * g, 2.5, 0.7, 4, 5);
    },
    impact: { shake: 2, flash: 0.5 },
    motif: 'countdown',
  },
  // ★ 멸: a big 滅 rises over the landing, then today's 멸 (both) + the healing dust on the allies
  'exorcist_ud:destroy': {
    prep: (fx, _h, s) => {
      glyphFx(fx, s.x, s.y, 3.2, '滅', 120, '#ffe8a3', s.k, 0.62, Math.max(0, s.delay - 0.6));
    },
    alias: [{ key: 'exorcist_u:destroy', prep: false }, { key: 'exorcist_d:destroy' }],
    land: (fx, h, s) => {
      alliesGlow(fx, h, s, HEAL, false);
      // the eight gates flare once more as 멸 lands (they stand inside its circle)
      for (const p of spots(gateKey(s))) {
        lightPillar(fx, p.x, p.y, 0.8, 7, TALISMAN, s.k, 0.5);
        h.ring(p.x, p.y, 0.2, 1.3, 0.3, '#ffffff', 3, 0);
      }
    },
    charge: { vignette: 0.45 },
    finisher: { glyph: '滅' },
    motif: 'countdown',
  },
};

// ─────────────────────────── 바드 (B9, B10) ───────────────────────────

const bard: Record<string, UltStory> = {
  // B9 조준: a staff runs along the band, the bard lights up, the allies in the band glow
  'bard_ua:choir': {
    prep: (fx, _h, s) => {
      areaFx(fx, Fx.Staff, s.ox, s.oy, lineRect(s), 1.8, s.color, s.k, Math.max(0, s.delay - 0.2));
    },
    land: (fx, h, s) => {
      lightPillar(fx, s.ox, s.oy, 1.1, 8, GOLD, s.k, 0.8, s.src);
      h.ring(s.ox, s.oy, 0.3, 2.4, 0.3, '#ffffff', 3, 0);
      glowAlliesInBand(fx, h, s, GOLD, 4, false);
    },
    impact: null,
  },
  'bard_ua:encore': { alias: { key: 'bard_u:encore' }, impact: null },
  // three beats: a beam of sound from the bard down the band, notes bursting along it, a magenta pulse on my screen
  'bard_ua:beat': {
    land: (fx, h, s) => {
      const g = 1 + 0.15 * s.hit;
      beamAlong(fx, s, bandW(s) * 0.7, s.color, 0.3);
      beamAlong(fx, s, 0.9 * g, '#ffffff', 0.22, 0.02);
      const f = wave(fx, s.x, s.y, s.area, 0.4, s.color, s.k * 0.6);
      f.x2 = s.ox;
      f.y2 = s.oy;
      f.n = 1; // drawn from the bard (render/skillfx.ts drawWave n 1)
      for (const t of [0.3, 0.6, 0.9]) {
        footAlong(s, t, P);
        h.spray(P.x, P.y, 1, n(Math.min(6, 4 + s.hit), s), Pk.Note, s.hit % 2 ? GOLD : s.color, 2.2 * g, 3, 1, 3, 6);
      }
      h.ring(s.ox, s.oy, 0.3, 1.6 * g, 0.3, '#ffffff', 3, 0);
      if (s.local) h.screen.vignette(BARD, 0.25, 0.2, 0);
    },
    impact: { shake: 2.5, flash: 0.5 },
  },
  // ★ 포르티시모: the bard springs up, then a white beam the band's width, a magenta core, notes, a burst mid-band
  'bard_ua:forte': {
    prep: (_fx, h, s) => {
      const src = s.src;
      if (src >= 0) h.later(Math.max(0, s.delay - 0.3), () => h.hop(src, 0.6, 0.3));
    },
    land: (fx, h, s) => {
      beamAlong(fx, s, bandW(s) * 0.7, '#ffffff', 0.4);
      beamAlong(fx, s, bandW(s) * 0.36, BARD, 0.45, 0.02);
      footAlong(s, 0.5, P);
      star(fx, P.x, P.y, 0.6, 56, '#ffffff', s.k, 0, 10);
      h.ring(s.ox, s.oy, 0.5, 6, 0.3, '#ffffff', 3, 0);
      for (let i = 0; i < 5; i++) {
        footAlong(s, (i + 0.5) / 5, P);
        h.spray(P.x, P.y, 1, n(4, s), Pk.Note, i % 2 ? GOLD : BARD, 3, 4, 1.1, 3, 7);
      }
    },
    charge: { vignette: 0.35 },
    finisher: { glyph: '響' },
  },

  // B10 드래그: today's three beats of the drag skill, bigger, and its forte with a white beam down the band
  'bard_ud:beat1': {
    alias: { key: 'bard_d:beat1' },
    land: (fx, _h, s) => {
      footAlong(s, 0.5, P);
      star(fx, P.x, P.y, 0.6, 36, '#ffffff', s.k, 0, 8);
      beamAlong(fx, s, bandW(s) * 0.4, '#ffffff', 0.25);
    },
    impact: { stop: 40, shake: 4, flash: 0.6 },
  },
  'bard_ud:choir': {
    alias: { key: 'bard_u:encore' },
    land: (fx, h, s) => glowAlliesInBand(fx, h, s, GOLD, 4, false),
    impact: null,
  },
  'bard_ud:encore': { alias: { key: 'bard_u:encore' }, impact: null },
  'bard_ud:beat2': {
    alias: { key: 'bard_d:beat2' },
    land: (fx, h, s) => {
      footAlong(s, 0.5, P);
      h.spray(P.x, P.y, 1, n(4, s), Pk.Note, GOLD, 2.5, 3.5, 1, 3, 6);
    },
    impact: { shake: 3, flash: 0.5 },
  },
  // ★ 피날레: today's forte ×1.4 + a white beam the band's width + notes all along it
  'bard_ud:forte': {
    alias: { key: 'bard_d:forte', k: 1.4 },
    land: (fx, h, s) => {
      beamAlong(fx, s, bandW(s) * 0.7, '#ffffff', 0.4);
      beamAlong(fx, s, bandW(s) * 0.3, BARD, 0.45, 0.02);
      for (let i = 0; i < 4; i++) {
        footAlong(s, (i + 0.5) / 4, P);
        h.spray(P.x, P.y, 1, n(3, s), Pk.Note, i % 2 ? GOLD : BARD, 3, 4, 1.1, 3, 7);
      }
    },
    charge: { vignette: 0.3, vignetteLead: 0.3 },
    finisher: { glyph: '響' },
  },
};

// ─────────────────────────── 크로노 (B11, B12) ───────────────────────────

/** A cross's two hands sweeping over it: a white beam along each axis (inside its arms). */
function hands(fx: SkillFx, s: UltBeatInfo, g: number): void {
  const L = crossLen(s.area);
  const w = crossWidth(s.area) * 0.6 * g;
  const ax = crossAxes(s.area);
  for (let i = 0; i < 4; i += 2) beam(fx, s.x + ax[i + 1].x * L, s.y + ax[i + 1].y * L, s.x + ax[i].x * L, s.y + ax[i].y * L, w, 0.25, '#ffffff', s.k, i * 0.02);
}

const chrono: Record<string, UltStory> = {
  // B11 조준: a big clock on the point, its hands racing forward, then — 탁 — today's time stop on the point, grey screen
  'chrono_ua:stasis': {
    prep: (fx, _h, s) => {
      if (isSelf(s)) return;
      const c = clock(fx, s.x, s.y, 4.5, 0.3, s.color, s.k);
      c.wait = Math.max(0, s.delay - 0.3);
    },
    alias: { key: 'chrono_u:stasis', at: 'point' },
    land: (fx, h, s) => {
      if (isSelf(s)) return;
      star(fx, s.x, s.y, 0.6, 48, '#ffffff', s.k, 0, 10);
      if (s.local) h.screen.desaturate(0.6);
    },
    impact: s => (isSelf(s) ? null : { stop: 50, shake: 4, flash: 0.6, screen: 0.3, screenColor: '#eef0ff' }),
  },
  // the mire: one faint clock its size, its hands slowly running backward (the enemies' field only; silent)
  'chrono_ua:mire': {
    land: (fx, _h, s) => {
      if (s.hit !== 0 || s.action?.affects !== 'enemies') return;
      const c = clock(fx, s.x, s.y, s.beat.radius, 5, s.color, s.k * 0.35);
      c.flip = -1;
    },
    impact: null,
  },
  // three clock hands sweep the frozen spot (+, X, a thick +): a brand, a white sweep, an X / + cut, glass
  'chrono_ua:rift': {
    land: (fx, h, s) => {
      const g = 1 + 0.15 * s.seq;
      const diag = s.area.shape === 'cross' && !!s.area.diagonal;
      areaFx(fx, Fx.Brand, s.x, s.y, s.area, 0.5, TIME, s.k, 0, 2);
      xslash(fx, s.x, s.y, 0.5, 50 * g, '#ffffff', s.k, 0, diag ? 0 : Math.PI / 4);
      hands(fx, s, g);
      h.spray(s.x, s.y, 0.5, n(6, s), Pk.Glass, '#e7eaff', 3 * g, 2, 0.5, 8, 4);
    },
    impact: { shake: 2.5, flash: 0.5 },
    motif: 'clock',
  },
  // ★ 시간 재개: the frozen time breaks — today's 정지 ×1.5, white rings, a clock racing forward, glass everywhere
  'chrono_ua:stop': {
    alias: { key: 'chrono_d:stop', k: 1.5 },
    land: (fx, h, s) => {
      rings(fx, s.x, s.y, 0.5, s.beat.radius + 1, 3, 0.4, '#ffffff', s.k, -1, 5);
      clock(fx, s.x, s.y, s.beat.radius * 0.8, 0.5, '#ffffff', s.k);
      h.spray(s.x, s.y, 0.8, n(12, s), Pk.Glass, '#ffffff', 6, 3, 0.8, 8, 6);
    },
    charge: { vignette: 0.35 },
    finisher: { glyph: '止' },
    motif: 'clock',
  },

  // B12 드래그: today's rift (its clock under the landing runs backward), a white X
  'chrono_ud:rift': {
    alias: { key: 'chrono_d:rift' },
    land: (fx, _h, s) => {
      if (!isSelf(s)) xslash(fx, s.x, s.y, 0.5, 44, '#ffffff', s.k, 0, 0);
    },
    impact: s => (isSelf(s) ? null : { stop: 40, shake: 4, flash: 0.6 }),
  },
  'chrono_ud:rewind': {
    alias: { key: 'chrono_d:rewind' },
    land: (_fx, h, s) => h.implode(s.x, s.y, 0.4, s.beat.radius * 0.8, n(10, s), '#e7eaff', 0.4, Pk.Glass),
    impact: { shake: 3 },
  },
  'chrono_ud:stasis': {
    alias: { key: 'chrono_u:stasis', at: 'point' },
    land: (_fx, h, s) => {
      if (s.local) h.screen.desaturate(0.5);
    },
    impact: { flash: 0.6 },
    motif: 'clock',
  },
  // ★ the X on the frozen: today's 정지 ×1.3 and a clock racing forward
  'chrono_ud:stop': {
    alias: { key: 'chrono_d:stop', k: 1.3 },
    land: (fx, _h, s) => {
      clock(fx, s.x, s.y, 3, 0.45, '#ffffff', s.k);
    },
    charge: { vignette: 0.3, vignetteLead: 0.3 },
    finisher: { glyph: '止' },
  },
};

// ─────────────────────────── 퍼펫티어 (B13, B14) ───────────────────────────

/** Where the four dolls stand along the 12-long row (±1.5, ±4.5 from its middle). */
const DOLL_T = [0.125, 0.375, 0.625, 0.875] as const;

/** A doll tossed: today's drag toss (arc + thread) and today's doll pop, a star growing per doll; its spot remembered. */
const TOSS: UltStory = {
  alias: [{ key: 'puppeteer_d:toss' }, { key: 'puppeteer_u:dolls', seqAsHit: true }],
  land: (fx, _h, s) => {
    const g = 1 + 0.12 * s.seq;
    star(fx, s.x, s.y, 0.7, 30 * g, '#ffffff', s.k, 0, 6);
    spots(dollKey(s), s.seq === 0).push({ x: s.x, y: s.y });
  },
  impact: s => (s.seq === 0 ? { stop: 40, shake: 3, flash: 0.6 } : { shake: 2 }),
};

/** ★ The curtain call's extras: a star on every doll, petals raining down along the curtain. */
function curtainExtras(fx: SkillFx, h: UltHost, s: UltBeatInfo): void {
  for (const p of spots(dollKey(s))) star(fx, p.x, p.y, 0.8, 40, '#ffffff', s.k, 0, 6);
  const R = s.beat.radius;
  for (let i = 0; i < 4; i++) {
    if (s.area.shape === 'rect') footAlong(s, DOLL_T[i], P);
    else {
      const a = (i / 4) * TAU + 0.4;
      P.x = s.x + Math.cos(a) * R * 0.55;
      P.y = s.y + Math.sin(a) * R * 0.45;
    }
    h.spray(P.x, P.y, 3, n(4, s), Pk.Petal, PETAL, 1.2, 0.5, 1.3, 2, 6);
  }
}

const puppeteer: Record<string, UltStory> = {
  // B13 조준: today's 「개막」 on the point (the spotlight stays on the puppeteer, mine)
  'puppeteer_ua:open': {
    alias: { key: 'puppeteer_u:open', at: 'point' },
    land: (_fx, h, s) => {
      if (s.local && s.src >= 0) h.screen.spotlight(s.src, 4, 0.9);
    },
    impact: null,
  },
  // the charmed: today's motes, and a thread from the puppeteer to each (bosses never take a charm)
  'puppeteer_ua:charm': {
    alias: { key: 'puppeteer_u:charm' },
    land: (fx, h, s) => {
      let i = 0;
      eachEnemy(h, s, s.area, m => {
        if (i >= 4 || m.tier === 'boss' || m.tier === 'mid' || m.kind === 'summon') return;
        tetherFx(fx, s.ox, s.oy, m.x, m.y, TetherStyle.Thread, 0.6, PUPPET, s.k, s.src, m.id, 0.6, 2);
        i++;
      });
    },
    impact: null,
  },
  'puppeteer_ua:toss': TOSS,
  // the threads between the dolls: loose 0.25 s before, then pulled taut
  'puppeteer_ua:thread': {
    prep: (fx, _h, s) => {
      const w = Math.max(0, s.delay - 0.25);
      for (let i = 0; i < 3; i++) {
        footAlong(s, DOLL_T[i], P);
        footAlong(s, DOLL_T[i + 1], Q);
        tetherFx(fx, P.x, P.y, Q.x, Q.y, TetherStyle.Thread, 0.27, PUPPET, s.k, -1, -1, 0.5, 2, w);
      }
    },
    land: (fx, h, s) => {
      for (let i = 0; i < 3; i++) {
        footAlong(s, DOLL_T[i], P);
        footAlong(s, DOLL_T[i + 1], Q);
        tetherFx(fx, P.x, P.y, Q.x, Q.y, TetherStyle.Thread, 0.5, '#ffd6ea', s.k, -1, -1, 0, 3);
        h.spray((P.x + Q.x) / 2, (P.y + Q.y) / 2, 0.6, n(2, s), Pk.Paper, HANJI, 2, 2, 0.6, 5, 5);
      }
      eachEnemy(h, s, s.area, m => h.afterimage(m.id, m.x, m.y, 0.3), 4);
    },
    impact: { shake: 3, flash: 0.5 },
  },
  // ★ 커튼콜: the house lights go down (0.45 s), then today's curtain call, the curtains close over the row, petals
  'puppeteer_ua:curtaincall': {
    alias: { key: 'puppeteer_u:curtaincall' },
    land: (fx, h, s) => {
      curtains(fx, s, PUPPET, 0.5);
      curtainExtras(fx, h, s);
    },
    charge: { vignette: 0.45, vignetteLead: 0.45 },
    finisher: { glyph: '幕' },
    motif: 'outline',
  },

  // B14 드래그: today's 「개막」 on the landing
  'puppeteer_ud:open': { alias: { key: 'puppeteer_u:open', at: 'point' }, impact: null },
  'puppeteer_ud:toss': TOSS,
  // the thread between the two dolls (its decor holds it); a taut string drawn when it is strung
  'puppeteer_ud:thread': {
    land: (fx, _h, s) => {
      if (s.hit !== 0) return;
      footAlong(s, 0, P);
      footAlong(s, 1, Q);
      tetherFx(fx, P.x, P.y, Q.x, Q.y, TetherStyle.Thread, 0.6, '#ffd6ea', s.k, -1, -1, 0.15, 3);
    },
    decor: 'thread',
    impact: null,
  },
  // the yank: strings reach every enemy around 0.25 s before, then snap taut — each pulled one leaves a ghost
  'puppeteer_ud:yank': {
    prep: (fx, h, s) => {
      const w = Math.max(0, s.delay - 0.25);
      eachEnemy(h, s, s.area, m => tetherFx(fx, s.ox, s.oy, m.x, m.y, TetherStyle.Thread, 0.27, PUPPET, s.k, s.src, m.id, 0.4, 2, w), 6);
    },
    land: (fx, h, s) => {
      eachEnemy(h, s, s.area, m => {
        tetherFx(fx, s.ox, s.oy, m.x, m.y, TetherStyle.Thread, 0.4, '#ffd6ea', s.k, s.src, m.id, 0, 3);
        h.afterimage(m.id, m.x, m.y, 0.35);
      }, 6);
      rings(fx, s.x, s.y, s.beat.radius, 1, 2, 0.4, PUPPET, s.k, -1, 5);
    },
    impact: { shake: 4, flash: 0.6 },
  },
  'puppeteer_ud:curtaincall': {
    alias: { key: 'puppeteer_u:curtaincall' },
    land: (fx, h, s) => {
      rings(fx, s.x, s.y, s.beat.radius, 0.5, 2, 0.45, PETAL, s.k, -1, 6); // the curtain drawn in from the edge
      curtainExtras(fx, h, s);
    },
    charge: { vignette: 0.45, vignetteLead: 0.45 },
    finisher: { glyph: '幕' },
    motif: 'outline',
  },
};

/** Every story of this file. (Integration: render/vfx.ts now routes every staged part of an alt — the parts stacked on
 * one footprint, 클레릭 드래그's six circles, are no longer folded into the first — so no rescue is needed here.) */
const STORIES: Record<string, UltStory> = { ...gunner, ...cleric, ...medic, ...exorcist, ...bard, ...chrono, ...puppeteer };

registerUltStories(STORIES);

// ─────────────────────────── 드래그 moves (2-5) ───────────────────────────

/** Spray n particles at `steps` points along a move (at their time on a dash). */
function along(h: UltHost, m: UltMoveInfo, steps: number, fn: (x: number, y: number) => void): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const x = m.from.x + (m.to.x - m.from.x) * t;
    const y = m.from.y + (m.to.y - m.from.y) * t;
    if (m.kind === 'dash') h.later(m.touchdownAt * t, () => fn(x, y));
    else fn(x, y);
  }
}

registerUltLooks({
  // B2: the knee slide — sparks off the ground, brass casings, a smoke trail (its 0.45 s contact stop: no touchdown stop)
  gunner_ud: {
    touchdownStop: 0,
    move: (_fx, h, m) => {
      along(h, m, 3, (x, y) => {
        h.spray(x, y, 0.1, nk(3, m.k), Pk.Square, '#ffd166', 2.5, 1.2, 0.3, 8, 3);
        h.spray(x, y, 0.3, nk(2, m.k), Pk.Smoke, SHELL, 0.5, 0.8, 0.8, -0.4, 7);
      });
      h.later(m.touchdownAt, () => h.spray(m.to.x, m.to.y, 0.6, nk(4, m.k), Pk.Square, '#c9a227', 2, 3, 0.7, 11, 4));
    },
  },
  // B4: feathers where she vanished and where she appears
  cleric_ud: {
    move: (_fx, h, m) => {
      h.spray(m.from.x, m.from.y, 1, nk(8, m.k), Pk.Feather, FEATHER, 2, 1.5, 1, 0.8, 6);
      h.later(m.touchdownAt, () => h.spray(m.to.x, m.to.y, 1.2, nk(10, m.k), Pk.Feather, FEATHER, 2.2, 1.2, 1.2, 0.8, 6));
    },
  },
  // B6: a thin teal beam along the run, the siren's red / white rings where she set off, white squares
  medic_ud: {
    move: (fx, h, m) => {
      beam(fx, m.from.x, m.from.y, m.to.x, m.to.y, 0.5, 0.35, MEDIC, m.k);
      h.ring(m.from.x, m.from.y, 0.3, 1.6, 0.45, '#ff4d6d', 4, 0);
      h.ring(m.from.x, m.from.y, 0.2, 1.1, 0.35, '#ffffff', 3, 0);
      along(h, m, 3, (x, y) => h.spray(x, y, 0.4, nk(2, m.k), Pk.Square, '#ffffff', 1.6, 1.5, 0.4, 6, 4));
    },
  },
  // B8: an ink pool where it lands; eight talismans fly with it and pin onto the seal ring at 0.45 s
  exorcist_ud: {
    touchdownStop: 0,
    move: (fx, _h, m) => {
      scorchFx(fx, m.to.x, m.to.y, 1.6, 1.4, true, '#3a0a0c', m.k);
      const turn = Math.random() * Math.PI;
      for (let i = 0; i < 8; i++) {
        const a = turn + (i / 8) * TAU;
        talisman(fx, m.from.x, m.from.y, m.to.x + Math.cos(a) * 3.15, m.to.y + Math.sin(a) * 3.15 * 0.85, 0.45, m.k, 0, i % 2 ? 1 : -1);
      }
    },
  },
  // B10: notes scattered along the slide
  bard_ud: {
    touchdownStop: 0,
    move: (_fx, h, m) => {
      along(h, m, 4, (x, y) => h.spray(x, y, 0.8, Math.max(1, nk(2, m.k)), Pk.Note, GOLD, 1.4, 2.5, 0.9, 2, 6));
    },
  },
  // B12: a rewound film — three ghosts from the landing back toward where it left
  chrono_ud: {
    touchdownStop: 0,
    move: (_fx, h, m) => {
      for (let i = 1; i <= 3; i++) {
        const t = 1 - i / 4;
        const x = m.from.x + (m.to.x - m.from.x) * t;
        const y = m.from.y + (m.to.y - m.from.y) * t;
        h.later(0.04 * (i - 1), () => h.afterimage(m.entityId, x, y, 0.35));
      }
    },
  },
  // B14: a thread from where she leapt to where she lands, paper along it
  puppeteer_ud: {
    touchdownStop: 0,
    move: (fx, h, m) => {
      tetherFx(fx, m.from.x, m.from.y, m.to.x, m.to.y, TetherStyle.Thread, 0.35, PUPPET, m.k, -1, m.entityId, 1, 2);
      along(h, m, 3, (x, y) => h.spray(x, y, 0.6, nk(3, m.k), Pk.Paper, HANJI, 1.6, 1.8, 0.7, 4, 5));
    },
  },
  // B9: the band goes from the bard toward the aim — nothing lands ON the aimed point: the small lock only
  bard_ua: { lock: 'small' },
});

// ─────────────────────────── 22차 accents (「궁극기 연출 강화」 off only) ───────────────────────────
// The 22차 picture of these alts, kept for the comparison switch (docs/ult-fx.md 2-8): a ring + sparks on the finishers,
// the motion the generic wave could not show. Keyed on the 23차 stage names (same beats).

type Stage = Extract<GameEvent, { type: 'skillStage' }>;

/** Another player's accents are drawn at this strength (like render/vfx.ts OTHER_PLAYER_FX). */
const OTHER = 0.6;

const SHELL22 = '#ffc27a';
const HOLY22 = '#fff4c2';
const GOLD22 = '#ffe08a';
const SPARK22 = '#d9fbff';
const TALISMAN22 = '#ffd166';

function radiusOf(a: AreaShape): number {
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
  if (ULT_FX.boost) return; // 23차: the stories above draw these beats
  if (ev.type !== 'skillStage' || ev.team !== 'ally' || ev.slot !== 'ult') return;
  const fn = STAGES[`${ev.skillId}:${ev.stage}`];
  if (!fn) return;
  const local = ev.player === view.localPlayer;
  fn(ev, view, local ? 1 : OTHER, local);
}

type StageFx = (ev: Stage, view: UltFxView, k: number, local: boolean) => void;

const STAGES: Record<string, StageFx> = {
  // ── 거너 조준: each shell a puff of sparks, the heavy shell a blast ──
  'gunner_ua:shells': (ev, v, k) => {
    v.host.burst(ev.center.x, ev.center.y, 0.3, Math.round(6 * k), SHELL22, 3.2, 2.5, 0.4);
  },
  'gunner_ua:heavy': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.6, 0.5, SHELL22, 7 * k, 0.2 * k);
    v.host.ring(x, y, 0.2, 1.6, 0.3, '#ffffff', 3 * k, 0);
    v.host.burst(x, y, 0.4, Math.round(26 * k), SHELL22, 5.5, 4.5, 0.7);
    if (local) v.host.shake(6);
  },
  // ── 거너 드래그: the muzzle of the slug ──
  'gunner_ud:slug': (ev, v, k, local) => {
    if (ev.hit !== 0) return;
    v.host.burst(ev.center.x, ev.center.y, 0.6, Math.round(14 * k), '#fff3c4', 6, 1.5, 0.35);
    if (local) v.host.shake(5);
  },
  // ── 클레릭 조준: the light rings close onto the point ──
  'cleric_ua:judgement': (ev, v, k) => {
    if (ev.hit !== 0) return;
    const { x, y } = ev.center;
    const r = radiusOf(ev.area);
    v.host.ring(x, y, r + 1, Math.max(0.4, r * 0.35), 0.4, GOLD22, 5 * k, 0.08 * k);
    if (ev.actionIndex === 3) {
      // the last, stunning ring
      v.host.ring(x, y, 0.2, r + 0.4, 0.35, HOLY22, 4 * k, 0.15 * k);
      v.host.burst(x, y, 0.5, Math.round(18 * k), HOLY22, 3.5, 4, 0.7, -2);
    }
  },
  // ── 클레릭 드래그: the big bell ──
  'cleric_ud:bell': (ev, v, k, local) => {
    if (ev.actionIndex !== 4) return; // the enemies' bell (the allies' heal is its twin)
    const { x, y } = ev.center;
    const r = radiusOf(ev.area);
    v.host.ring(x, y, 0.4, r + 0.5, 0.7, GOLD22, 8 * k, 0.18 * k);
    v.host.ring(x, y, 0.2, r * 0.6, 0.45, '#ffffff', 3 * k, 0);
    v.host.burst(x, y, 1.2, Math.round(24 * k), HOLY22, 4, 5, 0.9, -1.5);
    if (local) v.host.shake(5);
  },
  // ── 메딕 드래그: the defibrillator ──
  'medic_ud:defib': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.2, 2.2, 0.3, '#e8ffff', 4 * k, 0.15 * k);
    v.host.burst(x, y, 0.5, Math.round(18 * k), SPARK22, 6, 3, 0.4);
    if (local) v.host.shake(4);
  },
  // ── 퇴마사 조준: 멸 along the wall ──
  'exorcist_ua:destroy': (ev, v, k, local) => {
    if (ev.actionIndex !== 3) return; // the wall (the seal band and the allies' heal circle are its twins)
    const { x, y } = ev.center;
    v.host.flash(x, y, x, y, ev.area, 0.45, TALISMAN22, 0.9 * k);
    v.host.burst(x, y, 0.4, Math.round(20 * k), TALISMAN22, 4.5, 3.5, 0.6);
    if (local) v.host.shake(5);
  },
  // ── 퇴마사 드래그: 멸 ──
  'exorcist_ud:destroy': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.4, 0.5, TALISMAN22, 6 * k, 0.15 * k);
    if (local) v.host.shake(4);
  },
  // ── 크로노 조준: the clock closes on the point ──
  'chrono_ua:stasis': (ev, v, k) => {
    if (ev.actionIndex !== 0 || ev.hit !== 0) return;
    const { x, y } = ev.center;
    const r = radiusOf(ev.area);
    v.host.ring(x, y, r + 0.8, 0.4, 0.6, TIME, 6 * k, 0.12 * k);
    v.host.ring(x, y, 0.3, r, 0.5, '#ffffff', 2 * k, 0);
  },
  // ── 크로노 드래그: rewind pulls in, then the freeze ──
  'chrono_ud:rewind': (ev, v, k) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, radiusOf(ev.area) + 0.5, 0.4, 0.4, TIME, 5 * k, 0.08 * k);
  },
  'chrono_ud:stasis': (ev, v, k, local) => {
    if (ev.actionIndex !== 3) return; // the freeze circle (the X lands with it)
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.3, 0.5, TIME, 6 * k, 0.15 * k);
    if (local) v.host.shake(3);
  },
  // ── 퍼펫티어: the curtain call ──
  'puppeteer_ua:curtaincall': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.burst(x, y, 1, Math.round(22 * k), PETAL, 5, 4, 0.8);
    if (local) v.host.shake(4);
  },
  'puppeteer_ud:curtaincall': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.4, 0.5, PETAL, 6 * k, 0.15 * k);
    v.host.burst(x, y, 1, Math.round(18 * k), PETAL, 4.5, 4, 0.8);
    if (local) v.host.shake(4);
  },
};

registerUltFx({ onEvent });
