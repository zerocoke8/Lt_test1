// 기획 13차 스킬 리뉴얼 연출 (docs/skill-renewal.md 2-1, 3): every renewed drag skill and ult as a storyboard keyed by
// `skillId:stage`, assembled from the shared building blocks (castfx / skillfx / fxparts helpers, Vfx particles,
// ScreenFx). Two moments per stage:
//   PREP — at its skillCast (cast time): the wind-up of a delayed beat (falling objects, rune circles, aim lines, …)
//   LAND — at its skillStage (each hit / zone tick, at the real spot): the burst and its leftovers.
// 3-beat grammar (2-1): wind-up 0.2–0.5 s → burst 0.05–0.15 s (the only place for stops / shakes: impact.ts) →
// lingering 0.3–0.8 s at low alpha. Repeated pictures grow a little each time (hit n of hits).
// Render-only; Math.random is fine here (never in src/sim).

import type { AreaShape, SkillAction } from '../types';
import { DIR_VEC, rectFrame } from '../sim/geometry';
import { DASH_LAND } from './dashtime';
import { arrow, beam, chains, clock, muzzle, notes, pillar, radiusOf, rings, sealCircle, slash, star, wave, xslash } from './castfx';
import { FallObj, Fx, type FxHost, SkillFx, TetherStyle, dirAngle, screenAngle } from './skillfx';
import { Pk } from './fxparts';
import type { ScreenFx } from './cutin';
import type { UnitMemo } from './units';

/** What a storyboard can ask of the effect layer (implemented by Vfx). */
export interface StageHost extends FxHost {
  spray(x: number, y: number, z: number, n: number, kind: Pk, color: string, speed: number, up: number, dur: number, g?: number, size?: number): void;
  /** A translucent copy of a unit at (x, y) fading over dur (분신 / 잔상 / 되감기). */
  afterimage(entityId: number, x: number, y: number, dur: number): void;
  /** Render-only jump of a unit (height in world units over dur s). */
  hop(entityId: number, height: number, dur: number): void;
  readonly screen: ScreenFx;
  /** Living enemy memos inside an area at (x, y) — into a shared array (valid until the next call). */
  enemiesIn(area: AreaShape, x: number, y: number): readonly UnitMemo[];
  /** Ally character memos (every player's). */
  allies(): readonly UnitMemo[];
  memo(id: number): UnitMemo | undefined;
}

/** One stage moment (reused object: never keep it). */
export interface StageInfo {
  skillId: string;
  stage: string;
  slot: string;
  /** Where it lands (LAND: the real hit spot; PREP: where it was aimed at cast time). */
  x: number;
  y: number;
  area: AreaShape;
  /** Caster position and entity (−1 = none). */
  ox: number;
  oy: number;
  src: number;
  /** Unit a follow stage tracks (its target, or the caster), −1 = none. */
  follow: number;
  color: string;
  /** 1 for my casts, OTHER_PLAYER_FX for others'. */
  k: number;
  local: boolean;
  /** Seconds until the picture should start (a drag's beat that lands while its caster is still dropping in). */
  wait: number;
  /** PREP: seconds until the beat lands. */
  delay: number;
  hit: number;
  hits: number;
  targets: number;
  actionIndex: number;
  /** Caster facing on screen (+1 right). */
  face: number;
  dashTravel: number;
  action: SkillAction | null;
}

type Story = (fx: SkillFx, h: StageHost, s: StageInfo) => void;

const GOLD = '#ffd166';
const HOLY = '#fff3b0';
const ICE = '#7fdcff';
const INK = '#c1121f';
const TALISMAN = '#ffd23f';
const PUPPET = '#ff5fa2';
const HANJI = '#f3e9d2';
const LAVA = '#ff3b1f';
const MEDIC = '#2ec4b6';
const BODY_Z = 0.65;

// ─────────────────────────── small helpers ───────────────────────────

/** Grows a repeated picture a little per hit (2-1: "점점 커지게"). */
const grow = (s: StageInfo, step = 0.08) => 1 + step * Math.min(8, s.hit);

function fallAt(fx: SkillFx, x: number, y: number, obj: FallObj, size: number, height: number, wait: number, dur: number, color: string, k: number, follow = -1, ox = 0, oy = 0) {
  const f = fx.add(Fx.Fall, x, y, Math.max(0.08, dur), color, k);
  f.n = obj;
  f.r = size;
  f.z = height;
  f.wait = Math.max(0, wait);
  f.follow = follow;
  f.ox = ox;
  f.oy = oy;
  return f;
}

function tetherFx(fx: SkillFx, x: number, y: number, x2: number, y2: number, style: TetherStyle, dur: number, color: string, k: number, follow = -1, follow2 = -1, sag = 0.4, width = 3, wait = 0) {
  const f = fx.add(Fx.Tether, x, y, dur, color, k);
  f.x2 = x2;
  f.y2 = y2;
  f.n = style;
  f.r = sag;
  f.w = width;
  f.z = 0.5;
  f.follow = follow;
  f.follow2 = follow2;
  f.wait = wait;
  return f;
}

function glyphFx(fx: SkillFx, x: number, y: number, z: number, text: string, px: number, color: string, k: number, dur = 0.7, wait = 0) {
  const f = fx.add(Fx.Glyph, x, y, dur, color, k);
  f.text = text;
  f.r = px;
  f.z = z;
  f.wait = wait;
  return f;
}

function areaFx(fx: SkillFx, kind: Fx, x: number, y: number, area: AreaShape, dur: number, color: string, k: number, wait = 0, n = 0) {
  const f = fx.add(kind, x, y, dur, color, k);
  f.area = area;
  f.wait = wait;
  f.n = n;
  return f;
}

function rune(fx: SkillFx, x: number, y: number, r: number, dur: number, color: string, k: number, wait = 0) {
  const f = fx.add(Fx.Rune, x, y, dur, color, k);
  f.r = r;
  f.n = 16;
  f.wait = wait;
  return f;
}

function scorchFx(fx: SkillFx, x: number, y: number, r: number, dur: number, ink: boolean, color: string, k: number, wait = 0) {
  const f = fx.add(Fx.Scorch, x, y, dur, color, k);
  f.r = r;
  f.n = ink ? 1 : 0;
  f.wait = wait;
  return f;
}

function boltFx(fx: SkillFx, x: number, y: number, x2: number, y2: number, dur: number, color: string, k: number, wait = 0) {
  const f = fx.add(Fx.Bolt, x, y, dur, color, k);
  f.x2 = x2;
  f.y2 = y2;
  f.z = 0.3;
  f.wait = wait;
  return f;
}

function crosshairFx(fx: SkillFx, x: number, y: number, r: number, dur: number, color: string, k: number, follow: number, wait = 0) {
  const f = fx.add(Fx.Crosshair, x, y, dur, color, k);
  f.r = r;
  f.follow = follow;
  f.wait = wait;
  return f;
}

function snow(fx: SkillFx, x: number, y: number, r: number, dur: number, k: number) {
  const f = fx.add(Fx.Snow, x, y, dur, '#e8f8ff', k);
  f.r = r;
  f.n = 55 * k;
}

function aura(fx: SkillFx, x: number, y: number, dur: number, color: string, k: number, follow: number) {
  const f = fx.add(Fx.Aura, x, y, dur, color, k);
  f.r = 0.6;
  f.n = 14;
  f.follow = follow;
}

/** Fire burst (meteor / shell impact): flash circle, hot ring, embers, a few rocks. */
function fireBurst(fx: SkillFx, h: StageHost, x: number, y: number, r: number, k: number, big: boolean): void {
  h.flash(x, y, x, y, { shape: 'circle', radius: r }, big ? 0.5 : 0.35, '#ff7b00', 0.85 * k);
  h.ring(x, y, 0.2, r * 1.15, big ? 0.45 : 0.32, GOLD, big ? 6 : 4, 0.2 * k);
  h.spray(x, y, 0.3, Math.round((big ? 18 : 6) * k), Pk.Ember, '#ff9e3d', r * 2.2, 3.5, 0.6, 6, big ? 5 : 4);
  if (big) h.spray(x, y, 0.4, Math.round(8 * k), Pk.Rock, '#5c4033', 3, 4.5, 0.8, 11, 6);
  star(fx, x, y, 0.3, big ? 52 : 26, '#ffe8a3', k, 0, big ? 12 : 8);
}

/** Holy light column falling on a spot (팔라딘 / 클레릭 / 레인저 / 바드 / 메딕 Pillar). */
function lightPillar(fx: SkillFx, x: number, y: number, w: number, hgt: number, color: string, k: number, dur = 0.6, follow = -1, wait = 0) {
  pillar(fx, x, y, w, hgt, color, k, dur, follow).wait = Math.max(0, wait);
}

/** Each enemy (memo) inside the area: called with the memo. */
function eachEnemy(h: StageHost, s: StageInfo, area: AreaShape, fn: (m: UnitMemo, i: number) => void, max = 12): void {
  const list = h.enemiesIn(area, s.x, s.y);
  const n = Math.min(max, list.length);
  for (let i = 0; i < n; i++) fn(list[i], i);
}

const isAllies = (s: StageInfo) => s.action?.affects === 'allies';
const isSelf = (s: StageInfo) => s.action?.affects === 'self';

/** Self parts of a stage (shield / buff on the caster): a bubble on it. */
function selfBubble(fx: SkillFx, s: StageInfo, color = '#cfe8ff'): void {
  if (s.src < 0) return;
  const d = fx.add(Fx.Dome, s.ox, s.oy, 0.6, color, s.k);
  d.r = 0.9;
  d.follow = s.src;
  d.wait = s.wait;
}

/** Ally parts: a light beam + sparkle on every ally inside the area (or every ally when it reaches the whole field). */
function alliesGlow(fx: SkillFx, h: StageHost, s: StageInfo, color: string, beam = true): void {
  const a = s.area;
  const all = a.shape === 'circle' && a.radius > 30;
  const list = h.allies();
  for (let i = 0; i < list.length && i < 12; i++) {
    const m = list[i];
    if (!all && Math.hypot(m.x - s.x, m.y - s.y) > radiusOf(a) + m.radius) continue;
    if (beam) lightPillar(fx, m.x, m.y, 0.45, 4.2, color, s.k, 0.55, m.id, s.wait);
    h.spray(m.x, m.y, 1, Math.round(4 * s.k), Pk.Gold, color, 0.8, 1.6, 0.8, -1.2, 4);
  }
}

// ─────────────────────────── PREP (wind-ups at cast time) ───────────────────────────

export const PREP: Readonly<Record<string, Story>> = {
  // 가디언: a translucent tower shield drops onto the spot; the hex panels charge from the middle out
  'guardian_d:slam': (fx, _h, s) => {
    if (isSelf(s)) return;
    fallAt(fx, s.x, s.y, FallObj.Shield, 1.2, 4, 0, Math.max(0.12, s.wait), '#5b8def', s.k);
  },
  'guardian_d:wave': (fx, _h, s) => {
    areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.5, s.color, s.k);
  },
  'guardian_u:rally': (fx, _h, s) => {
    const f = fx.add(Fx.Chains, s.ox, s.oy, 0.75, s.color, s.k);
    f.r = 6;
    f.r2 = 1;
    f.flip = 1;
    f.follow = s.src;
    f.wait = Math.max(0, s.delay - 0.3);
  },
  'guardian_u:citadel': (fx, _h, s) => {
    fallAt(fx, s.ox, s.oy, FallObj.Shield, 2.6, 8, s.delay - 0.4, 0.4, s.color, s.k, s.src);
  },
  // 팔라딘: spears of light fall onto their eight spots one after another (outer ones bigger)
  'paladin_u:spear': (fx, _h, s) => {
    const outer = Math.hypot(s.x - s.ox, s.y - s.oy) > 3.5;
    fallAt(fx, s.x, s.y, FallObj.Spear, outer ? 1.3 : 0.95, 7, s.delay - 0.25, 0.25, GOLD, s.k);
  },
  'paladin_u:tribunal': (fx, _h, s) => {
    areaFx(fx, Fx.Brand, s.ox, s.oy, s.area, 0.75, GOLD, s.k * 0.8, s.delay - 0.75, 3);
  },
  // 워든: the cylindrical cage drops from above onto the caster
  'warden_u:cage': (fx, _h, s) => {
    fallAt(fx, s.ox, s.oy, FallObj.Cage, 3, 8, s.delay - 0.38, 0.38, s.color, s.k, s.src);
  },
  'warden_u:release': (fx, _h, s) => {
    rings(fx, s.ox, s.oy, 3.4, 2.6, 2, 0.5, '#e8f0d0', s.k * 0.7, s.src, 3).wait = Math.max(0, s.delay - 0.5);
  },
  // 블레이드: the screen darkens again for the draw before 일섬
  'blade_u:issen': (_fx, h, s) => {
    if (s.local) h.screen.vignette('#000000', 0.55, Math.max(0.3, 0.25), 0);
  },
  // 버서커: the axe goes up — a red pillar of heat on the caster before the finale
  'berserker_u:finale': (fx, _h, s) => {
    lightPillar(fx, s.ox, s.oy, 0.7, 5, LAVA, s.k, 0.6, s.src, s.delay - 0.6);
  },
  // 섀도우: an ink pool at the drop; the X mark gathers before the execution; the crescent fills the sky
  'shadow_d:clone': (fx, _h, s) => {
    if (s.actionIndex === 0) scorchFx(fx, s.x, s.y, 1.2, 0.9, true, s.color, s.k);
  },
  'shadow_d:execute': (fx, _h, s) => {
    areaFx(fx, Fx.Brand, s.x, s.y, s.area, s.delay, s.color, s.k, 0, 3);
    rings(fx, s.x, s.y, 2.6, 0.4, 2, Math.max(0.3, s.delay), '#c9b8ff', s.k * 0.8);
  },
  'shadow_u:moon': (fx, h, s) => {
    const f = fx.add(Fx.Moon, s.x, s.y, 1.0, '#5e60ce', s.k);
    f.r = 34;
    f.z = 3.4;
    f.follow = s.follow;
    f.wait = Math.max(0, s.delay - 1.0);
    if (s.local) h.screen.vignette('#0b0820', 0.5, s.delay - 0.2, 0);
  },
  // 레인저: aim line with ››› along the band; the bow's lens flare before the pierce; the sky shot's reticle
  'ranger_d:volley': (fx, _h, s) => {
    if (s.area.shape !== 'rect') return;
    const fr = rectFrame(s.area, s);
    const f = fx.add(Fx.AimLine, fr.sx, fr.sy, 0.8, s.color, s.k);
    f.x2 = fr.sx + fr.ux * fr.len;
    f.y2 = fr.sy + fr.uy * fr.len;
    f.w = s.area.width;
  },
  'ranger_d:pierce': (fx, _h, s) => {
    rings(fx, s.ox, s.oy, 1.6, 0.2, 2, 0.3, '#eafff6', s.k, s.src, 3).wait = Math.max(0, s.delay - 0.32);
    star(fx, s.ox, s.oy, BODY_Z, 34, '#ffffff', s.k, Math.max(0, s.delay - 0.15), 4);
  },
  'ranger_u:rain': (fx, _h, s) => {
    lightPillar(fx, s.ox, s.oy, 0.3, 9, '#eafff6', s.k, 0.3, s.src, s.delay - 0.35);
  },
  'ranger_u:skyshot': (fx, _h, s) => {
    crosshairFx(fx, s.x, s.y, 1.6, 0.6, '#ffd23f', s.k, s.follow, s.delay - 0.6);
    lightPillar(fx, s.x, s.y, 0.9, 9, '#ffd23f', s.k, 0.35, s.follow, s.delay - 0.35);
    fallAt(fx, s.x, s.y, FallObj.Arrow, 1.1, 9, s.delay - 0.22, 0.22, s.color, s.k, s.follow);
  },
  // 메이지: the rune circle is drawn at the first meteor; each meteor falls onto its spot; the big one grows in the sky
  'mage_d:meteor': (fx, _h, s) => {
    if (s.actionIndex === 0) rune(fx, s.x + 2.6, s.y, 3.4, 1.45, s.color, s.k);
    fallAt(fx, s.x, s.y, FallObj.Meteor, 0.55, 7, s.delay - 0.22, 0.22, '#ff7b00', s.k);
  },
  'mage_d:bigmeteor': (fx, _h, s) => {
    fallAt(fx, s.x, s.y, FallObj.Meteor, 1.5, 10, s.delay - 0.55, 0.55, '#ff7b00', s.k);
  },
  // 거너: the barrel heats before the slug; the flare's red smoke; the heavy shell's reticle and fall
  'gunner_d:slug': (fx, h, s) => {
    star(fx, s.ox, s.oy, BODY_Z, 18, '#ff9e3d', s.k, Math.max(0, s.delay - 0.35), 6);
    void h;
  },
  'gunner_u:shells': (fx, h, s) => {
    lightPillar(fx, s.x, s.y, 0.45, 6, '#ff4d4d', s.k * 0.8, 1.6, s.follow);
    h.spray(s.x, s.y, 0.5, Math.round(10 * s.k), Pk.Smoke, '#ff6b6b', 0.6, 2.5, 1.4, -0.6, 9);
    const hits = Math.max(1, s.hits);
    for (let i = 0; i < hits; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 3.2;
      fallAt(fx, s.x, s.y, FallObj.Shell, 0.5, 8, s.delay + i * 0.16 - 0.2, 0.2, '#adb5bd', s.k, s.follow, Math.cos(a) * rr, Math.sin(a) * rr * 0.8);
    }
  },
  'gunner_u:heavy': (fx, _h, s) => {
    crosshairFx(fx, s.x, s.y, 3, 0.8, '#ff4d4d', s.k, s.follow, s.delay - 0.8);
    fallAt(fx, s.x, s.y, FallObj.Shell, 1.6, 10, s.delay - 0.42, 0.42, '#adb5bd', s.k, s.follow);
  },
  // 클레릭: the bell comes down slowly over the sanctuary
  'cleric_d:bell': (fx, _h, s) => {
    if (isAllies(s)) return;
    fallAt(fx, s.x, s.y, FallObj.Bell, 1.2, 5, s.delay - 0.6, 0.6, GOLD, s.k);
  },
  // 메딕: electricity runs along the cross's arms before the defib
  'medic_d:defib': (fx, _h, s) => {
    const L = s.area.shape === 'cross' ? s.area.length : 3;
    for (let i = 0; i < 4; i++) {
      const u = i === 0 ? DIR_VEC.right : i === 1 ? DIR_VEC.left : i === 2 ? DIR_VEC.up : DIR_VEC.down;
      boltFx(fx, s.x, s.y, s.x + u.x * L, s.y + u.y * L, 0.28, '#bdf6ff', s.k, 0.04);
    }
  },
  // 퇴마사: eight talismans fly out to the ring; the 滅 is written in the air before the destroy
  'exorcist_d:seal': (fx, h, s) => {
    const inner = s.area.shape === 'ring' ? s.area.inner : 0.8;
    const outer = radiusOf(s.area);
    const mid = (inner + outer) / 2;
    const turn = Math.random() * Math.PI;
    for (let i = 0; i < 8; i++) {
      const a = turn + (i / 8) * Math.PI * 2;
      const f = fx.add(Fx.Talisman, s.ox, s.oy, 0.75, TALISMAN, s.k);
      f.x2 = s.x + Math.cos(a) * mid;
      f.y2 = s.y + Math.sin(a) * mid * 0.85;
      f.z = 0.6;
      f.flip = i % 2 ? 1 : -1;
    }
    h.ring(s.x, s.y, outer * 0.9, outer, 0.8, INK, 5, 0.04 * s.k);
  },
  'exorcist_u:destroy': (fx, _h, s) => {
    if (isAllies(s)) return;
    glyphFx(fx, s.ox, s.oy, 3.2, '滅', 96, '#ffe8a3', s.k, 0.65, s.delay - 0.5);
  },
  // 크로노: a clock face on the ground under the rift, the hands running backward
  'chrono_d:rift': (fx, _h, s) => {
    if (isSelf(s)) return;
    clock(fx, s.x, s.y, 2.4, 1.05, s.color, s.k).flip = -1;
  },
  // 퍼펫티어: a paper doll arcs out on two threads
  'puppeteer_d:toss': (fx, _h, s) => {
    const o = fx.add(Fx.Orb, s.ox, s.oy, 0.26, HANJI, s.k);
    o.x2 = s.x;
    o.y2 = s.y;
    o.z = 0.6;
    o.wait = Math.max(0, s.wait + s.delay - 0.26);
    tetherFx(fx, s.ox, s.oy, s.x, s.y, TetherStyle.Thread, 0.7, PUPPET, s.k, s.src, -1, 0.5, 2, Math.max(0, s.wait + s.delay - 0.26));
  },
};

// ─────────────────────────── LAND (bursts at the real hit) ───────────────────────────

export const LAND: Readonly<Record<string, Story>> = {
  // ───────── 가디언 ─────────
  'guardian_d:slam': (fx, h, s) => {
    if (isSelf(s)) return selfBubble(fx, s);
    rings(fx, s.x, s.y, 0.3, radiusOf(s.area), 2, 0.45, s.color, s.k, -1, 5);
    star(fx, s.x, s.y, 0.4, 40, '#cfe8ff', s.k, s.wait, 10);
    h.spray(s.x, s.y, 0.2, Math.round(8 * s.k), Pk.Rock, '#7d8597', 3.2, 3.5, 0.6, 11, 5);
  },
  'guardian_d:wave': (fx, h, s) => {
    const sw = fx.add(Fx.ShieldWave, s.x, s.y, 0.55, s.color, s.k);
    sw.ang = s.area.shape === 'rect' ? dirAngle(s.area.dir) : 0;
    sw.r = s.area.shape === 'rect' ? s.area.length : 9;
    sw.w = s.area.shape === 'rect' ? s.area.width : 2.2;
    wave(fx, s.x, s.y, s.area, 0.5, s.color, s.k);
    h.spray(s.x, s.y, 0.3, Math.round(10 * s.k), Pk.Glass, '#cfe8ff', 4, 2, 0.5, 8, 5);
  },
  'guardian_d:wall': () => {},
  'guardian_u:aegis': (fx, h, s) => alliesGlow(fx, h, s, '#cfe8ff'),
  'guardian_u:rally': (fx, h, s) => {
    rings(fx, s.ox, s.oy, 6, 0.8, 3, 0.45, s.color, s.k, s.src, 5);
    eachEnemy(h, s, s.area, m => tetherFx(fx, s.ox, s.oy, m.x, m.y, TetherStyle.Electric, 0.35, s.color, s.k, s.src, m.id, 0, 3), 8);
  },
  'guardian_u:citadel': (fx, h, s) => {
    areaFx(fx, Fx.Hex, s.x, s.y, s.area, 0.9, s.color, s.k);
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.15, 3, 0.6, '#cfe8ff', s.k, -1, 7);
    star(fx, s.x, s.y, 0.6, 70, '#ffffff', s.k, 0, 12);
    h.spray(s.x, s.y, 0.3, Math.round(16 * s.k), Pk.Rock, '#7d8597', 5, 5, 0.8, 11, 6);
    h.spray(s.x, s.y, 0.6, Math.round(12 * s.k), Pk.Glass, '#cfe8ff', 4, 3, 0.7, 6, 5);
  },
  'guardian_u:barrier': () => {},
  // ───────── 팔라딘 ─────────
  'paladin_d:brand': (fx, _h, s) => {
    areaFx(fx, Fx.Brand, s.x, s.y, s.area, 0.55, GOLD, s.k, s.wait, 3);
    lightPillar(fx, s.x, s.y, 0.28, 5, HOLY, s.k * 0.8, 0.55, -1, s.wait);
  },
  'paladin_d:blessing': (fx, h, s) => {
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area), 1, 0.6, HOLY, s.k * 0.6);
    alliesGlow(fx, h, s, HOLY, false);
  },
  'paladin_d:pillar': (fx, h, s) => {
    lightPillar(fx, s.x, s.y, 1.25, 9, GOLD, s.k, 0.75);
    const L = s.area.shape === 'cross' ? s.area.length : 3.8;
    for (let i = 0; i < 4; i++) {
      const u = i === 0 ? DIR_VEC.right : i === 1 ? DIR_VEC.left : i === 2 ? DIR_VEC.up : DIR_VEC.down;
      lightPillar(fx, s.x + u.x * L * 0.62, s.y + u.y * L * 0.62, 0.55, 4.5, HOLY, s.k, 0.55, -1, 0.04 * i);
    }
    wave(fx, s.x, s.y, s.area, 0.55, GOLD, s.k);
    h.spray(s.x, s.y, 1.2, Math.round(14 * s.k), Pk.Gold, GOLD, 2.5, 3, 0.9, 2, 5);
  },
  'paladin_d:core': (fx, _h, s) => star(fx, s.x, s.y, 0.6, 58, '#ffffff', s.k, 0, 12),
  'paladin_u:sanctuary': (fx, h, s) => {
    for (let i = 0; i < 6; i++) lightPillar(fx, s.ox + (i - 2.5) * 1.6, s.oy - 1.5 + (i % 2) * 0.8, 0.25, 9, GOLD, s.k * 0.7, 0.5, -1, i * 0.03);
    alliesGlow(fx, h, s, GOLD);
  },
  'paladin_u:spear': (fx, h, s) => {
    const g = grow(s, 0.06) * (Math.hypot(s.x - s.ox, s.y - s.oy) > 3.5 ? 1.25 : 1);
    star(fx, s.x, s.y, 0.4, 30 * g, HOLY, s.k, 0, 8);
    h.ring(s.x, s.y, 0.2, 1.3 * g, 0.3, GOLD, 4, 0.18 * s.k);
    h.spray(s.x, s.y, 0.6, Math.round(4 * s.k), Pk.Gold, GOLD, 1.5, 2.5, 0.6, 3, 4);
  },
  'paladin_u:tribunal': (fx, h, s) => {
    wave(fx, s.x, s.y, s.area, 0.8, GOLD, s.k);
    lightPillar(fx, s.x, s.y, 1.8, 12, GOLD, s.k, 0.9);
    const L = s.area.shape === 'cross' ? s.area.length : 7;
    for (let i = 0; i < 4; i++) {
      const u = i === 0 ? DIR_VEC.right : i === 1 ? DIR_VEC.left : i === 2 ? DIR_VEC.up : DIR_VEC.down;
      for (let j = 1; j <= 2; j++) lightPillar(fx, s.x + u.x * L * j * 0.4, s.y + u.y * L * j * 0.4, 0.7, 7 - j, HOLY, s.k, 0.7, -1, 0.03 * j);
    }
    rings(fx, s.x, s.y, 0.5, 6, 2, 0.7, HOLY, s.k, -1, 6);
    h.spray(s.x, s.y, 1.5, Math.round(22 * s.k), Pk.Gold, GOLD, 4, 4, 1.1, 2, 6);
  },
  // ───────── 워든 ─────────
  'warden_d:hook': (fx, h, s) => {
    if (isSelf(s)) return selfBubble(fx, s, '#c7e59a');
    chains(fx, s.x, s.y, radiusOf(s.area), 0.9, 0.5, s.color, s.k);
    eachEnemy(h, s, s.area, m => tetherFx(fx, s.x, s.y, m.x, m.y, TetherStyle.Chain, 0.42, s.color, s.k, -1, m.id, 0.15, 3, s.wait), 8);
  },
  'warden_d:crush': (fx, h, s) => {
    rings(fx, s.x, s.y, radiusOf(s.area) * 1.3, 0.5, 2, 0.35, '#c7e59a', s.k, -1, 6);
    const cr = fx.add(Fx.Crack, s.x, s.y, 1.1, '#80b918', s.k);
    cr.ang = 0;
    cr.w = Math.PI * 2;
    cr.r = radiusOf(s.area) * 1.1;
    cr.n = 8;
    h.spray(s.x, s.y, 0.2, Math.round(10 * s.k), Pk.Rock, '#6c757d', 3.5, 4, 0.7, 11, 5);
  },
  'warden_d:fence': () => {},
  'warden_u:chainstorm': (fx, h, s) => {
    if (isSelf(s)) return selfBubble(fx, s, '#c7e59a');
    chains(fx, s.ox, s.oy, 7, 1.2, 0.6, s.color, s.k, s.src);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      tetherFx(fx, s.ox, s.oy, s.ox + Math.cos(a) * 6.5, s.oy + Math.sin(a) * 6.5 * 0.8, TetherStyle.Chain, 0.5, s.color, s.k * 0.8, s.src, -1, 0.3, 3, i * 0.012);
    }
    eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 0.5, 3, Pk.Square, '#e8f0d0', 1.5, 2, 0.4), 10);
  },
  'warden_u:cage': (fx, h, s) => {
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.2, 3, 0.55, '#c7e59a', s.k, -1, 6);
    h.spray(s.x, s.y, 0.2, Math.round(16 * s.k), Pk.Rock, '#6c757d', 5, 5, 0.8, 11, 6);
    star(fx, s.x, s.y, 0.6, 60, '#ffffff', s.k, 0, 10);
  },
  'warden_u:prison': () => {},
  'warden_u:release': (fx, h, s) => {
    rings(fx, s.x, s.y, 1, radiusOf(s.area) * 1.4, 2, 0.5, '#c7e59a', s.k, -1, 5);
    h.spray(s.x, s.y, 1.2, Math.round(16 * s.k), Pk.Glass, '#9aa5a0', 7, 3, 0.7, 6, 7);
  },
  // ───────── 블레이드 ─────────
  'blade_d:dash': (fx, h, s) => {
    const len = s.area.shape === 'rect' ? s.area.length : 6;
    const u = s.area.shape === 'rect' ? DIR_VEC[s.area.dir] : DIR_VEC.right;
    const travel = s.dashTravel || 0.16;
    for (let i = 0; i < 4; i++) {
      const d = ((i + 0.6) / 4) * len;
      slash(fx, s.x + u.x * d, s.y + u.y * d, BODY_Z, (i % 2 ? 0.5 : -0.5) + screenAngle(u.x, u.y) + Math.PI / 2, 46, i % 2 ? '#ffffff' : s.color, s.k, DASH_LAND + travel * ((i + 0.6) / 4), true);
    }
    for (let i = 1; i <= 3; i++) h.afterimage(s.src, s.x + u.x * len * (i / 4), s.y + u.y * len * (i / 4), 0.45);
    wave(fx, s.x, s.y, s.area, 0.5, s.color, s.k, DASH_LAND);
  },
  'blade_d:return': (fx, h, s) => {
    // the rush back ←: crossed sword marks along the path, from the far end to the drop point
    const L = s.area.shape === 'line' ? s.area.length : 6;
    const dx = s.ox - s.x;
    const dir = Math.abs(dx) > 0.2 ? Math.sign(dx) : 1;
    for (let i = 0; i < 7; i++) {
      const d = ((6.5 - i) / 7) * L;
      xslash(fx, s.x + dir * d, s.y, BODY_Z, 22 + i * 1.5, i % 2 ? '#ffffff' : s.color, s.k, 0.02 * i, i * 0.3);
    }
    h.spray(s.x + dir * L * 0.5, s.y, 0.6, Math.round(6 * s.k), Pk.Petal, '#ffc2d1', 3, 1.5, 0.6, 3, 4);
  },
  'blade_d:burst': (fx, h, s) => {
    wave(fx, s.x, s.y, s.area, 0.45, '#ffffff', s.k);
    if (s.area.shape === 'rect') {
      const fr = rectFrame(s.area, s);
      for (let i = 0; i < 6; i++) lightPillar(fx, fr.sx + fr.ux * fr.len * ((i + 0.5) / 6), fr.sy + fr.uy * fr.len * ((i + 0.5) / 6), 0.3, 4 + (i % 2), '#ffc2d1', s.k, 0.4, -1, i * 0.025);
    }
    h.spray(s.x, s.y, 0.6, Math.round(10 * s.k), Pk.Petal, '#ffc2d1', 4, 2, 0.8, 3, 5);
  },
  'blade_u:hop': (fx, h, s) => {
    const g = grow(s);
    slash(fx, s.x, s.y, BODY_Z, Math.random() * Math.PI * 2, 46 * g, s.hit % 2 ? '#ffffff' : s.color, s.k, 0, true);
    star(fx, s.x, s.y, BODY_Z, 26 * g, '#ffffff', s.k, 0, 6);
    h.spray(s.x, s.y, 0.7, Math.round(4 * s.k), Pk.Petal, '#ffc2d1', 2.5, 1.5, 0.8, 2, 4);
  },
  'blade_u:storm': (fx, _h, s) => {
    const g = grow(s, 0.05);
    for (let j = 0; j < 2; j++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = (0.3 + Math.random() * 0.6) * radiusOf(s.area) * 0.75;
      const f = fx.add(Fx.Slash, s.x, s.y, 0.26, j ? '#ffffff' : s.color, s.k);
      f.z = BODY_Z;
      f.ang = Math.random() * Math.PI * 2;
      f.r = (40 + Math.random() * 22) * g;
      f.w = 2.4;
      f.n = 1;
      f.flip = j ? 1 : -1;
      f.wait = j * 0.06;
      f.follow = s.follow;
      f.ox = Math.cos(ang) * rr;
      f.oy = Math.sin(ang) * rr * 0.7;
    }
    if (s.hit === 0) {
      const sp = fx.add(Fx.Spin, s.x, s.y, 1.2, s.color, s.k);
      sp.r = radiusOf(s.area);
      sp.z = 0.3;
      sp.flip = s.face;
      sp.follow = s.follow;
    }
  },
  'blade_u:issen': (fx, h, s) => {
    h.screen.slash(s.y, '#ffffff');
    wave(fx, s.x, s.y, s.area, 0.5, '#ffffff', s.k);
    for (let i = 0; i < 5; i++) slash(fx, s.x + (i - 2) * 2.4, s.y, BODY_Z, Math.PI / 2, 60, i % 2 ? s.color : '#ffffff', s.k, i * 0.02, true);
    h.spray(s.x, s.y, 0.8, Math.round(14 * s.k), Pk.Petal, '#ffc2d1', 6, 2, 1.0, 2, 5);
  },
  // ───────── 버서커 ─────────
  'berserker_d:slam': (fx, h, s) => {
    if (isSelf(s)) return;
    rings(fx, s.x, s.y, 0.3, radiusOf(s.area) * 1.2, 2, 0.45, '#ff7a45', s.k, -1, 8);
    const cr = fx.add(Fx.Crack, s.x, s.y, 1.0, '#ff7a45', s.k);
    cr.w = Math.PI * 2;
    cr.r = radiusOf(s.area);
    cr.n = 8;
    cr.wait = s.wait;
    h.spray(s.x, s.y, 0.2, Math.round(14 * s.k), Pk.Rock, '#5c4033', 4.5, 5, 0.8, 12, 6);
    star(fx, s.x, s.y, 0.4, 46, '#ffb199', s.k, s.wait, 10);
  },
  'berserker_d:split': (fx, h, s) => {
    const cr = fx.add(Fx.Crack, s.x, s.y, 1.4, LAVA, s.k);
    cr.ang = s.area.shape === 'cone' ? dirAngle(s.area.dir) : 0;
    cr.w = s.area.shape === 'cone' ? (s.area.angle * Math.PI) / 180 : 1.6;
    cr.r = radiusOf(s.area);
    cr.n = 7;
    h.spray(s.x + Math.cos(cr.ang) * 2, s.y + Math.sin(cr.ang) * 2, 0.2, Math.round(10 * s.k), Pk.Ember, '#ff7b00', 2.5, 3, 0.7, 4, 4);
  },
  'berserker_d:quake': (fx, h, s) => {
    const a0 = s.area.shape === 'cone' ? dirAngle(s.area.dir) : 0;
    const R = radiusOf(s.area) * 0.85;
    for (let i = -1; i <= 1; i++) {
      const a = a0 + i * 0.32;
      const x = s.x + Math.cos(a) * R;
      const y = s.y + Math.sin(a) * R;
      lightPillar(fx, x, y, 0.6, 4.5, LAVA, s.k, 0.55, -1, 0.04 * (i + 1));
      h.spray(x, y, 0.4, Math.round(5 * s.k), Pk.Ember, '#ff9e3d', 1.5, 4, 0.7, 3, 4);
    }
  },
  'berserker_u:roar': (fx, h, s) => {
    rings(fx, s.ox, s.oy, 0.5, radiusOf(s.area) * 1.1, 3, 0.6, LAVA, s.k, s.src, 7);
    h.spray(s.ox, s.oy, 0.3, Math.round(10 * s.k), Pk.Rock, '#5c4033', 4, 3, 0.6, 11, 5);
  },
  'berserker_u:frenzy': (fx, h, s) => {
    aura(fx, s.ox, s.oy, 8, LAVA, s.k, s.src);
    if (s.local) h.screen.vignette('#ff1a1a', 0.3, 8, 1.6);
  },
  'berserker_u:finale': (fx, h, s) => {
    const cr = fx.add(Fx.Crack, s.x, s.y, 1.5, LAVA, s.k);
    cr.w = Math.PI * 2;
    cr.r = radiusOf(s.area) * 1.15;
    cr.n = 12;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      lightPillar(fx, s.x + Math.cos(a) * 3, s.y + Math.sin(a) * 3 * 0.8, 0.55, 5, LAVA, s.k, 0.6, -1, i * 0.02);
    }
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.3, 3, 0.6, '#ffb199', s.k, -1, 8);
    h.spray(s.x, s.y, 0.3, Math.round(16 * s.k), Pk.Rock, '#3a1a12', 6, 6, 0.9, 12, 7);
    h.spray(s.x, s.y, 0.5, Math.round(14 * s.k), Pk.Ember, '#ff7b00', 4, 5, 1.0, 3, 5);
  },
  // ───────── 섀도우 ─────────
  'shadow_d:clone': (fx, h, s) => {
    h.afterimage(s.src, s.x, s.y, 0.35);
    xslash(fx, s.x, s.y, BODY_Z, 24 * grow(s, 0.12), s.color, s.k, s.wait, (Math.random() - 0.5) * 0.6);
    h.spray(s.x, s.y, 0.6, Math.round(7 * s.k), Pk.Ink, '#1b1c3d', 3, 2.5, 0.6, 9, 5);
  },
  'shadow_d:slide': (fx, h, s) => {
    h.spray(s.ox, s.oy, 0.2, Math.round(5 * s.k), Pk.Ink, '#1b1c3d', 1.5, 0.5, 0.5, 6, 5);
    void fx;
  },
  'shadow_d:execute': (fx, h, s) => {
    xslash(fx, s.x, s.y, BODY_Z, 64, '#c9b8ff', s.k, 0, 0);
    wave(fx, s.x, s.y, s.area, 0.4, s.color, s.k);
    h.spray(s.x, s.y, 0.7, Math.round(12 * s.k), Pk.Glass, '#c9b8ff', 4, 3, 0.7, 7, 5);
  },
  'shadow_u:vanish': (_fx, h, s) => {
    h.spray(s.ox, s.oy, 0.4, Math.round(12 * s.k), Pk.Ink, '#1b1c3d', 2.5, 2, 0.6, 6, 6);
  },
  'shadow_u:dance': (fx, h, s) => {
    const g = grow(s);
    const ox = (Math.random() - 0.5) * 2.4;
    const oy = (Math.random() - 0.5) * 1.4;
    h.afterimage(s.src, s.x + ox * 1.4, s.y + oy, 0.3);
    xslash(fx, s.x + ox * 0.3, s.y + oy * 0.3, BODY_Z, 34 * g, s.hit % 2 ? '#ffffff' : s.color, s.k, 0, s.hit * 0.7);
    h.spray(s.x, s.y, 0.6, Math.round(3 * s.k), Pk.Ink, '#1b1c3d', 2.5, 2, 0.5, 8, 4);
  },
  'shadow_u:moon': (fx, h, s) => {
    slash(fx, s.x, s.y, 1.2, Math.PI, 90, '#c9b8ff', s.k, 0, true);
    xslash(fx, s.x, s.y, BODY_Z, 70, '#ffffff', s.k, 0.04, Math.PI / 2);
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.2, 2, 0.5, '#c9b8ff', s.k, -1, 6);
    h.spray(s.x, s.y, 1, Math.round(16 * s.k), Pk.Glass, '#c9b8ff', 5, 3, 0.8, 6, 6);
  },
  // ───────── 레인저 ─────────
  'ranger_d:volley': (fx, _h, s) => {
    if (s.area.shape !== 'rect') return;
    const fr = rectFrame(s.area, s);
    const lane = (s.hit - 1) * fr.hw * 0.55;
    const vx = -fr.uy;
    const vy = fr.ux;
    arrow(fx, fr.sx + vx * lane, fr.sy + vy * lane, fr.sx + fr.ux * fr.len + vx * lane, fr.sy + fr.uy * fr.len + vy * lane, 0.22, 1.2 * grow(s, 0.1), s.color, s.k);
  },
  'ranger_d:pierce': (fx, h, s) => {
    if (s.area.shape !== 'rect') return;
    const fr = rectFrame(s.area, s);
    const ex = fr.sx + fr.ux * fr.len;
    const ey = fr.sy + fr.uy * fr.len;
    beam(fx, fr.sx, fr.sy, ex, ey, s.area.width * 1.1, 0.55, s.color, s.k);
    beam(fx, fr.sx, fr.sy, ex, ey, s.area.width * 0.45, 0.4, '#ffffff', s.k, 0.03);
    arrow(fx, fr.sx, fr.sy, ex, ey, 0.26, 2.4, s.color, s.k);
    for (let i = 0; i < 4; i++) h.spray(fr.sx + fr.ux * fr.len * (i / 4 + 0.1), fr.sy, 0.8, Math.round(2 * s.k), Pk.Feather, '#eafff6', 1.6, 1.2, 1.1, 1.2, 5);
  },
  'ranger_u:barrage': (fx, _h, s) => {
    const f = fx.add(Fx.Arrow, s.ox, s.oy, 0.16, s.color, s.k);
    f.x2 = s.x;
    f.y2 = s.y;
    f.z = s.hit % 2 ? 1.1 : 0.4;
    f.r = 1.05 * grow(s, 0.03);
  },
  'ranger_u:rain': (fx, h, s) => {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radiusOf(s.area);
      fallAt(fx, s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr * 0.8, FallObj.Arrow, 0.35, 4, 0, 0.12, s.color, s.k);
    }
    h.ring(s.x, s.y, 0.3, radiusOf(s.area), 0.3, '#eafff6', 2, 0.06 * s.k);
  },
  'ranger_u:skyshot': (fx, h, s) => {
    rings(fx, s.x, s.y, 0.3, radiusOf(s.area) * 1.6, 2, 0.5, '#ffd23f', s.k, -1, 6);
    star(fx, s.x, s.y, 0.6, 64, '#ffffff', s.k, 0, 12);
    h.spray(s.x, s.y, 0.4, Math.round(10 * s.k), Pk.Rock, '#6b5b4b', 4, 4, 0.7, 11, 5);
    h.spray(s.x, s.y, 1.2, Math.round(10 * s.k), Pk.Feather, '#eafff6', 2.5, 2, 1.3, 1, 6);
  },
  // ───────── 메이지 ─────────
  'mage_d:meteor': (fx, h, s) => fireBurst(fx, h, s.x, s.y, radiusOf(s.area), s.k, false),
  'mage_d:bigmeteor': (fx, h, s) => {
    fireBurst(fx, h, s.x, s.y, radiusOf(s.area), s.k, true);
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.4, 2, 0.6, '#ff9e3d', s.k, -1, 7);
    scorchFx(fx, s.x, s.y, radiusOf(s.area) * 0.8, 3.2, false, '#ff7b00', s.k);
  },
  'mage_d:lava': () => {},
  'mage_u:blizzard': (fx, _h, s) => {
    if (s.hit !== 0) return;
    snow(fx, s.x, s.y, radiusOf(s.area), 4.1, s.k);
    rings(fx, s.x, s.y, 0.5, radiusOf(s.area), 2, 0.6, ICE, s.k);
  },
  'mage_u:freeze': (fx, h, s) => {
    eachEnemy(h, s, s.area, m => {
      const f = fx.add(Fx.Encase, m.x, m.y, 0.45, ICE, s.k);
      f.follow = m.id;
      f.n = 0;
      f.r = m.radius;
    });
    rings(fx, s.x, s.y, radiusOf(s.area), 0.6, 2, 0.4, '#e8fbff', s.k, -1, 5);
    if (s.local) h.screen.vignette('#bfefff', 0.45, 0.6, 0);
  },
  'mage_u:shatter': (fx, h, s) => {
    eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 0.8, Math.round(4 * s.k), Pk.Glass, '#cdf3ff', 3.5, 3, 0.6, 9, 5));
    h.spray(s.x, s.y, 0.8, Math.round(16 * s.k), Pk.Glass, '#e8fbff', 6, 3.5, 0.8, 7, 6);
    rings(fx, s.x, s.y, 0.5, radiusOf(s.area) * 1.15, 3, 0.55, ICE, s.k, -1, 7);
    star(fx, s.x, s.y, 0.6, 60, '#ffffff', s.k, 0, 12);
  },
  // ───────── 거너 ─────────
  'gunner_d:blast1': (fx, h, s) => shotgun(fx, h, s),
  'gunner_d:blast2': (fx, h, s) => shotgun(fx, h, s),
  'gunner_d:slug': (fx, h, s) => {
    if (s.area.shape !== 'rect') return;
    const fr = rectFrame(s.area, s);
    const ex = fr.sx + fr.ux * fr.len;
    const ey = fr.sy + fr.uy * fr.len;
    beam(fx, fr.sx, fr.sy, ex, ey, 1.0, 0.45, '#ff9e3d', s.k);
    beam(fx, fr.sx, fr.sy, ex, ey, 0.35, 0.35, '#ffd166', s.k, 0.02);
    muzzle(fx, fr.sx + fr.ux * 0.4, fr.sy, 0.6, 40, screenAngle(fr.ux, fr.uy), '#ffd166', s.k);
    h.spray(fr.sx, fr.sy, 0.6, Math.round(8 * s.k), Pk.Smoke, '#adb5bd', 0.8, 1.2, 1.1, -0.5, 9);
    h.spray(s.ox, s.oy, 0.7, Math.round(2 * s.k), Pk.Square, '#c9a227', 2, 3, 0.7, 11, 4);
  },
  'gunner_u:shells': (fx, h, s) => {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * 3.2;
    const x = s.x + Math.cos(a) * rr;
    const y = s.y + Math.sin(a) * rr * 0.8;
    h.ring(x, y, 0.1, 1.3 * grow(s, 0.04), 0.3, GOLD, 4, 0.3 * s.k);
    h.spray(x, y, 0.2, Math.round(5 * s.k), Pk.Ember, '#ffb347', 2.5, 3, 0.45, 6, 4);
    h.spray(x, y, 0.4, Math.round(2 * s.k), Pk.Smoke, '#6b5b4b', 0.6, 1.2, 0.8, -0.5, 7);
    void fx;
  },
  'gunner_u:heavy': (fx, h, s) => {
    fireBurst(fx, h, s.x, s.y, radiusOf(s.area), s.k, true);
    h.spray(s.x, s.y, 0.8, Math.round(14 * s.k), Pk.Smoke, '#8d8d8d', 1.2, 4.5, 1.6, -0.8, 12);
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.5, 2, 0.6, '#ffd166', s.k, -1, 7);
    scorchFx(fx, s.x, s.y, radiusOf(s.area) * 0.75, 3, false, '#ff7b00', s.k);
  },
  // ───────── 클레릭 ─────────
  'cleric_d:descend': (fx, h, s) => {
    lightPillar(fx, s.x, s.y, 1.2, 8, HOLY, s.k, 0.8, -1, s.wait);
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area), 2, 0.6, GOLD, s.k);
    h.spray(s.x, s.y, 3.5, Math.round(10 * s.k), Pk.Feather, '#fffbe6', 1.8, 0.2, 1.6, 0.8, 6);
  },
  'cleric_d:sanctuary': (_fx, h, s) => {
    if (s.hit > 0) h.spray(s.x, s.y, 0.4, Math.round(2 * s.k), Pk.Gold, GOLD, radiusOf(s.area) * 0.7, 1.2, 0.7, -1, 4);
  },
  'cleric_d:bell': (fx, h, s) => {
    if (isAllies(s)) return alliesGlow(fx, h, s, '#7dffb3', false);
    rings(fx, s.x, s.y, 0.5, radiusOf(s.area) * 1.15, 3, 0.7, GOLD, s.k, -1, 6);
    star(fx, s.x, s.y, 1.2, 40, HOLY, s.k, 0, 10);
    notes(fx, s.x, s.y, 2, GOLD, s.k);
  },
  'cleric_u:grace': (fx, h, s) => alliesGlow(fx, h, s, GOLD),
  'cleric_u:judgement': (fx, h, s) => {
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area), 2, 0.55, s.actionIndex === 3 ? '#ffffff' : GOLD, s.k, s.follow, 5 + s.actionIndex);
    h.spray(s.x, s.y, 0.8, Math.round(4 * s.k), Pk.Gold, GOLD, radiusOf(s.area) * 0.8, 1.5, 0.7, -1, 5);
  },
  // ───────── 메딕 ─────────
  'medic_d:firstaid': (fx, h, s) => {
    if (isSelf(s)) return;
    wave(fx, s.x, s.y, s.area, 0.7, MEDIC, s.k, s.wait);
    wave(fx, s.x, s.y, s.area, 0.45, '#ffffff', s.k * 0.6, s.wait + 0.08);
    lightPillar(fx, s.x, s.y, 0.7, 4.5, '#ffffff', s.k, 0.6, -1, s.wait);
    h.spray(s.x, s.y, 0.4, Math.round(8 * s.k), Pk.Gold, '#7dffb3', 1.4, 2, 0.8, -0.6, 4);
  },
  'medic_d:syringe': (fx, _h, s) => {
    const o = fx.add(Fx.Orb, s.ox, s.oy, 0.22, '#ffffff', s.k);
    o.x2 = s.x;
    o.y2 = s.y;
    o.z = 0.8;
    o.wait = s.wait;
    star(fx, s.x, s.y, BODY_Z, 24, '#7dffb3', s.k, s.wait + 0.2, 4);
  },
  'medic_d:defib': (fx, h, s) => {
    wave(fx, s.x, s.y, s.area, 0.4, '#bdf6ff', s.k);
    const L = s.area.shape === 'cross' ? s.area.length : 3;
    for (let i = 0; i < 4; i++) {
      const u = i === 0 ? DIR_VEC.right : i === 1 ? DIR_VEC.left : i === 2 ? DIR_VEC.up : DIR_VEC.down;
      boltFx(fx, s.x, s.y, s.x + u.x * L, s.y + u.y * L, 0.22, MEDIC, s.k);
    }
    star(fx, s.x, s.y, 0.5, 40, '#bdf6ff', s.k, 0, 8);
    h.spray(s.x, s.y, 0.5, Math.round(6 * s.k), Pk.Square, '#ffffff', 3, 2, 0.35, 6);
  },
  'medic_u:golden': (fx, h, s) => {
    if (isSelf(s)) return;
    alliesGlow(fx, h, s, '#ffe08a');
    if (s.local) h.screen.vignette('#ff4d6d', 0.3, 1.2, 1.4);
  },
  'medic_u:siren': (fx, _h, s) => {
    rings(fx, s.ox, s.oy, 0.5, 11, 2, 0.8, MEDIC, s.k, s.src, 6);
    rings(fx, s.ox, s.oy, 0.5, 8, 1, 0.6, s.hit % 2 ? '#ffffff' : '#ff4d6d', s.k * 0.8, s.src, 4);
  },
  // ───────── 퇴마사 ─────────
  'exorcist_d:seal': (fx, h, s) => {
    wave(fx, s.x, s.y, s.area, 0.5, INK, s.k, s.wait);
    eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 0.2, 3, Pk.Ink, '#3a0a0c', 1, 1.5, 0.6, 4, 4), 8);
  },
  'exorcist_d:destroy': (fx, h, s) => {
    glyphFx(fx, s.x, s.y, 0.6, '印', 70, '#ff3b3b', s.k, 0.6);
    rings(fx, s.x, s.y, 0.4, radiusOf(s.area) * 1.1, 2, 0.5, INK, s.k, -1, 6);
    h.spray(s.x, s.y, 0.6, Math.round(10 * s.k), Pk.Paper, TALISMAN, 3, 3, 0.8, 4, 5);
    h.spray(s.x, s.y, 0.6, Math.round(8 * s.k), Pk.Ember, '#ff7b00', 2.5, 3, 0.6, 2, 4);
  },
  'exorcist_u:greatseal': (fx, h, s) => {
    sealCircle(fx, h, s.x, s.y, s.area, s.k, 16, 0.7);
    rune(fx, s.x, s.y, radiusOf(s.area) * 0.95, 1.2, INK, s.k * 0.8);
  },
  'exorcist_u:storm': (fx, h, s) => {
    if (s.hit === 0 || s.hit % 2) return;
    const list = h.enemiesIn(s.area, s.x, s.y);
    if (!list.length) return;
    const m = list[Math.floor(Math.random() * list.length)];
    const f = fx.add(Fx.Spirit, m.x, m.y, 1.0, INK, s.k);
    f.z = 1;
  },
  'exorcist_u:destroy': (fx, h, s) => {
    if (isAllies(s)) return alliesGlow(fx, h, s, '#7dffb3', false);
    rings(fx, s.x, s.y, 0.5, radiusOf(s.area) * 1.1, 3, 0.65, INK, s.k, -1, 8);
    eachEnemy(h, s, s.area, m => {
      const f = fx.add(Fx.Spirit, m.x, m.y, 1.0, INK, s.k);
      f.z = 1;
    }, 6);
    h.spray(s.x, s.y, 1, Math.round(16 * s.k), Pk.Paper, TALISMAN, 6, 3, 1.0, 3, 5);
  },
  // ───────── 바드 ─────────
  'bard_d:beat1': (fx, _h, s) => bardBand(fx, s, 0),
  'bard_d:encore': (fx, _h, s) => notes(fx, s.ox, s.oy, 1.2, GOLD, s.k, s.src),
  // the left band 0.03 s before the right one (as the sound has it)
  'bard_d:beat2': (fx, _h, s) => bardBand(fx, s, s.actionIndex >= 5 ? 0.03 : 0),
  'bard_d:forte': (fx, h, s) => {
    wave(fx, s.x, s.y, s.area, 0.45, '#ffffff', s.k);
    rings(fx, s.x, s.y, 0.5, 4.5, 3, 0.6, s.color, s.k, -1, 5);
    h.spray(s.x, s.y, 0.4, Math.round(12 * s.k), Pk.Note, GOLD, 2.5, 5, 1.1, 5, 6);
  },
  'bard_u:choir': (fx, h, s) => {
    lightPillar(fx, s.ox, s.oy, 1.1, 8, GOLD, s.k, 0.8, s.src);
    rings(fx, s.ox, s.oy, 0.5, 12, 4, 1.1, s.color, s.k, s.src, 6);
    alliesGlow(fx, h, s, GOLD, false);
  },
  'bard_u:encore': (fx, _h, s) => notes(fx, s.ox, s.oy, 2.2, GOLD, s.k, s.src),
  'bard_u:beat': (fx, h, s) => {
    rings(fx, s.x, s.y, 0.5, radiusOf(s.area), 2, 0.7, s.hit % 2 ? GOLD : s.color, s.k, s.follow, 5 + s.hit);
    if (s.local) h.screen.vignette(s.color, 0.25, 0.35, 0);
    if (s.hit >= s.hits - 1) h.spray(s.x, s.y, 0.5, Math.round(16 * s.k), Pk.Note, GOLD, 3.5, 6, 1.2, 5, 7);
  },
  // ───────── 크로노 ─────────
  'chrono_d:rift': (fx, h, s) => {
    if (isSelf(s)) return;
    areaFx(fx, Fx.Brand, s.x, s.y, s.area, 0.9, s.color, s.k, s.wait, 2);
    h.spray(s.x, s.y, 0.4, Math.round(6 * s.k), Pk.Glass, '#e7eaff', 3, 2, 0.5, 8, 4);
  },
  'chrono_d:rewind': (fx, h, s) => {
    // memos still hold where they were before this tick's pull: the "rewound film" frames stay there
    eachEnemy(h, s, s.area, m => {
      h.afterimage(m.id, m.x, m.y, 0.4);
      h.afterimage(m.id, m.x + (m.x - s.x) * 0.25, m.y + (m.y - s.y) * 0.25, 0.3);
    }, 4);
    rings(fx, s.x, s.y, radiusOf(s.area), 0.5, 2, 0.4, '#ffffff', s.k * 0.7);
  },
  'chrono_d:stop': (fx, h, s) => {
    xslash(fx, s.x, s.y, 0.3, 66, '#ffffff', s.k, 0, Math.PI / 4);
    wave(fx, s.x, s.y, s.area, 0.45, s.color, s.k);
    h.spray(s.x, s.y, 0.5, Math.round(14 * s.k), Pk.Glass, '#e7eaff', 5, 3, 0.7, 8, 6);
  },
  'chrono_u:stasis': (fx, h, s) => {
    if (isSelf(s)) return;
    const c = fx.add(Fx.Clock, s.ox, s.oy, 1.5, s.color, s.k);
    c.r = Math.min(6, radiusOf(s.area) * 0.6);
    // the hands stand still: time has stopped ('탁'); the stopped enemies go grey on their own (statusfx)
    c.flip = 0;
    c.follow = s.src;
    rings(fx, s.ox, s.oy, radiusOf(s.area), 0.6, 3, 0.8, '#ffffff', s.k, s.src, 5);
    h.spray(s.ox, s.oy, 0.6, Math.round(10 * s.k), Pk.Glass, '#e7eaff', 4, 2, 0.6, 6, 5);
  },
  // ───────── 퍼펫티어 ─────────
  'puppeteer_d:toss': (fx, h, s) => {
    h.spray(s.x, s.y, 0.6, Math.round(10 * s.k), Pk.Paper, HANJI, 3, 3, 0.7, 6, 5);
    h.ring(s.x, s.y, 0.2, radiusOf(s.area), 0.35, PUPPET, 4, 0.12 * s.k);
    eachEnemy(h, s, s.area, m => tetherFx(fx, s.x, s.y, m.x, m.y, TetherStyle.Thread, 0.35, PUPPET, s.k, -1, m.id, 0.1, 2), 5);
  },
  'puppeteer_d:thread': () => {},
  'puppeteer_u:open': (fx, h, s) => {
    rings(fx, s.ox, s.oy, 0.5, radiusOf(s.area), 2, 0.8, PUPPET, s.k, s.src, 5);
    h.spray(s.ox, s.oy, 1.5, Math.round(10 * s.k), Pk.Petal, '#ff8fab', 3, 2, 1.2, 1.2, 5);
    if (s.local) h.screen.spotlight(s.src, 4, 2.6);
  },
  'puppeteer_u:charm': (fx, h, s) => {
    eachEnemy(h, s, s.area, m => h.spray(m.x, m.y, 1.4, 3, Pk.Gold, PUPPET, 0.8, 1, 0.6, -1, 4), 4);
    void fx;
  },
  'puppeteer_u:dolls': (fx, h, s) => {
    h.spray(s.x, s.y, 0.6, Math.round(8 * s.k), Pk.Paper, HANJI, 2.5, 3, 0.6, 6, 5);
    star(fx, s.x, s.y, 0.6, 26, HANJI, s.k, 0, 6);
  },
  'puppeteer_u:curtaincall': (fx, h, s) => {
    rings(fx, s.x, s.y, 0.5, radiusOf(s.area) * 1.05, 3, 0.7, PUPPET, s.k, -1, 7);
    h.spray(s.x, s.y, 2.5, Math.round(22 * s.k), Pk.Petal, '#ff4d6d', 6, 1.5, 1.4, 1.5, 6);
  },
  'paper_doll_death:burst': (fx, h, s) => dollBurst(fx, h, s),
  'paper_doll_grand_death:burst': (fx, h, s) => dollBurst(fx, h, s),
};

function shotgun(fx: SkillFx, h: StageHost, s: StageInfo): void {
  const ang = s.area.shape === 'cone' ? dirAngle(s.area.dir) : Math.PI;
  const pe = fx.add(Fx.Pellets, s.x, s.y, 0.35, '#ffd166', s.k);
  pe.ang = ang;
  pe.w = s.area.shape === 'cone' ? (s.area.angle * Math.PI) / 180 : 1.2;
  pe.r = radiusOf(s.area);
  pe.n = 12;
  pe.z = 0.6;
  muzzle(fx, s.x + Math.cos(ang) * 0.5, s.y + Math.sin(ang) * 0.5, 0.6, 30, screenAngle(Math.cos(ang), Math.sin(ang)), '#ffd166', s.k);
  wave(fx, s.x, s.y, s.area, 0.35, s.color, s.k * 0.7);
  h.spray(s.ox, s.oy, 0.7, Math.round(2 * s.k), Pk.Square, '#c9a227', 2, 3, 0.7, 11, 4);
  h.spray(s.x, s.y, 0.6, Math.round(3 * s.k), Pk.Smoke, '#adb5bd', 0.6, 1, 0.8, -0.5, 7);
}

function bardBand(fx: SkillFx, s: StageInfo, wait: number): void {
  if (isAllies(s)) return; // the ally twin of the same band: one picture
  areaFx(fx, Fx.Staff, s.x, s.y, s.area, 1.0, s.color, s.k, wait + s.wait);
  wave(fx, s.x, s.y, s.area, 0.45, s.color, s.k * 0.8, wait + s.wait);
  notes(fx, s.x, s.y, 1.2, s.color, s.k);
}

function dollBurst(fx: SkillFx, h: StageHost, s: StageInfo): void {
  h.spray(s.x, s.y, 0.5, Math.round(12 * s.k), Pk.Paper, HANJI, 3.2, 2.4, 0.7, 6, 5);
  h.spray(s.x, s.y, 0.5, Math.round(8 * s.k), Pk.Gold, PUPPET, 2.4, 1.6, 0.8, 2, 4);
  h.ring(s.x, s.y, 0.3, radiusOf(s.area), 0.4, PUPPET, 4, 0.18 * s.k);
  void fx;
}

/** Fallback for a stage without its own storyboard: a footprint wave. */
export function genericLand(fx: SkillFx, s: StageInfo): void {
  if (s.action?.affects === 'self') return;
  wave(fx, s.x, s.y, s.area, 0.45, s.color, s.k, s.wait);
}
