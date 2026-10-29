// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-1 ~ 2-3, 4-4): the common grammar every 조준 / 드래그 ult is dressed in.
//  - ultDefault: the picture of a beat by its role when no story draws it (path · opener · build · twin · after · zone ·
//    support) — so all 30 ults read stronger even before a character story exists.
//  - ultCharge: the wind-up of the finisher (edge tint at t − 0.35, light gathering at t − 0.3, the breath at t − 0.12).
//  - ultFinisher: the climax (flash, rings, pillar, sparks, the big glyph; mine: a 0.13 s stop, a 12 px shake with an
//    aftershock, a 5 % zoom, radial speed lines). Its full picture is up at age 0 — the frozen frame is the blow.
// Another player's / a bot's ult: ground pictures at k 0.55 and low detail, never a stop / shake / zoom / screen glyph.
// Colour fills stay inside the real footprint; outside it only thin white rings that are gone within 0.35 s (2-9).

import type { AreaShape, Vec2 } from '../../types';
import { footprintRadius } from '../../data/ultTest';
import { areaCentroid } from '../../sim/geometry';
import { beam, pillar, star, wave } from '../castfx';
import type { SkillFx, Sfx } from '../skillfx';
import type { UnitMemo } from '../units';
import { Pk } from '../fxparts';
import { lighten } from '../look';
import { ULT_FINISH, type Juice } from '../juice';
import { STAGE_DETAIL, type StageHost, alliesGlow, genericLand, rings, rune, selfBubble } from '../stagefx';
import { pushGlyph, pushSpeedLines, ultCam } from './core';
import { FX_LOAD } from './settings';
import type { UltBeatInfo } from './stories';

export { ultDecal } from './decals';
export type { DecalKind, DecalSpec } from './decals';

/** A kick of my screen (render/vfx.ts Vfx.kick): stop (ms at the default setting), shake, a screen flash. */
export interface UltKick {
  stopMs?: number;
  shake?: number;
  shakeDur?: number;
  screen?: number;
  color?: string;
  /** Pass the per-second hit-stop budget (only a finisher may). */
  ignoreBudget?: boolean;
  /** Longest single stop (s); default FREEZE_MAX_SEC. */
  capSec?: number;
}

/** What the 궁극기 테스트 stories can ask of the effect layer (implemented by render/vfx.ts Vfx). */
export interface UltHost extends StageHost {
  readonly juice: Juice;
  /** World-clock kick after delaySec; stopMs is at the default setting (× hitStopMs / 75). Ignored when !local. */
  kick(delaySec: number, k: UltKick, local: boolean): void;
  /** n particles on a ring of radius r around (x, y, z) flying in to the centre over dur. */
  implode(x: number, y: number, z: number, r: number, n: number, color: string, dur: number, kind?: Pk): void;
  /** Hide a unit's body for sec (world clock). */
  hideFor(entityId: number, sec: number): void;
  /** Run fn after delaySec on the world clock (≤ 48 pending, oldest dropped; cleared on floor change / reset). */
  later(delaySec: number, fn: () => void): void;
  /** A unit's body drops in from `height` over dur s (render only; a blink's arrival). */
  drop(entityId: number, height: number, dur: number): void;
}

export interface FinisherSpec {
  kind: 'strike' | 'bless';
  stopMs: number;
  stopCapMs: number;
  shake: number;
  shakeDur: number;
  tail: number;
  tailDur: number;
  screen: number;
  /** '' = theme. */
  screenColor: string;
  /** Focus-dim alpha at t − 0.12 (0 = none; skipped when the footprint radius > 6). */
  breath: number;
  zoom: number;
  speedLines: boolean;
  /** null = no stamp ('' = theme glyph). */
  glyph: string | null;
  glyphPx: number;
  flash: number;
  star: number;
  rings: number;
  pillar: boolean;
  sparks: number;
  debris: number;
  embers: number;
  hitMarks: number;
}

export interface ChargeSpec {
  lead: number;
  rings: number;
  sparks: number;
  pillar: boolean;
  rumble: number;
  /** Edge tint alpha (−1 = theme). */
  vignette: number;
  /** '' = theme. */
  vignetteColor: string;
  vignetteLead: number;
}

export const FINISH_STRIKE: Readonly<FinisherSpec> = {
  kind: 'strike',
  stopMs: 130,
  stopCapMs: 160,
  shake: 12,
  shakeDur: 0.4,
  tail: 4,
  tailDur: 0.6,
  screen: 0.42,
  screenColor: '',
  breath: 0.35,
  zoom: 0.05,
  speedLines: true,
  glyph: '',
  glyphPx: 150,
  flash: 1,
  star: 70,
  rings: 3,
  pillar: true,
  sparks: 40,
  debris: 10,
  embers: 14,
  hitMarks: 10,
};

/** An allies-only climax (축복): no stop, no shake, a softer flash, 2 % zoom, pillars on the allies, gold dust. */
export const FINISH_BLESS: Readonly<FinisherSpec> = {
  ...FINISH_STRIKE,
  kind: 'bless',
  stopMs: 0,
  stopCapMs: 0,
  shake: 0,
  tail: 0,
  screen: 0.28,
  breath: 0,
  zoom: 0.02,
  speedLines: false,
  flash: 0.7,
  star: 50,
  rings: 2,
  sparks: 20,
  debris: 0,
  embers: 10,
  hitMarks: 0,
};

export const CHARGE: Readonly<ChargeSpec> = { lead: 0.3, rings: 3, sparks: 14, pillar: true, rumble: 1.5, vignette: -1, vignetteColor: '', vignetteLead: 0.35 };

/** Ring / hole size of a footprint for round pictures (a long band gets a small one: never a wide disc around it). */
function roundR(a: AreaShape): number {
  const r = footprintRadius(a);
  switch (a.shape) {
    case 'circle':
    case 'ring':
    case 'single':
      return r;
    case 'rect':
    case 'line':
      return Math.min(r, a.width / 2 + 0.5);
    case 'cross':
      return Math.min(r, a.width / 2 + 0.5);
    default:
      return Math.min(r, 2.5);
  }
}

/**
 * The middle of where the blow lands (the glyph, the zoom, the breath's hole, the gathering light sit there): a line /
 * fan / rect / cone at the middle of its length, anything else at its centre.
 */
export function ultFocus(s: UltBeatInfo, out: Vec2): Vec2 {
  const a = s.area;
  if (a.shape === 'line' || a.shape === 'fan') {
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const d = Math.hypot(dx, dy);
    const half = (a.shape === 'line' ? a.length : a.radius) / 2;
    if (d > 1e-4) {
      out.x = s.ox + (dx / d) * half;
      out.y = s.oy + (dy / d) * half;
      return out;
    }
  }
  if (a.shape === 'rect' || a.shape === 'cone') {
    const c = areaCentroid(a, s);
    out.x = c.x;
    out.y = c.y;
    return out;
  }
  out.x = s.x;
  out.y = s.y;
  return out;
}
const FOCUS: Vec2 = { x: 0, y: 0 };

const isRound = (a: AreaShape) => a.shape === 'circle' || a.shape === 'ring' || a.shape === 'single';
/** Particle counts: another player's half-ish, a struggling phone half. */
const count = (n: number, s: UltBeatInfo) => Math.max(0, Math.round(n * s.k * (FX_LOAD.low ? 0.5 : 1)));

/** A wave over the exact footprint, already grown (the frozen first frame shows it whole). */
function fullWave(fx: SkillFx, s: UltBeatInfo, dur: number, color: string, k: number, pre = 0.3): Sfx {
  const f = wave(fx, s.x, s.y, s.area, dur, color, k);
  if (s.lineFrom && (s.area.shape === 'line' || s.area.shape === 'fan')) {
    f.x2 = s.ox;
    f.y2 = s.oy;
    f.n = 1;
  }
  f.age = dur * pre;
  return f;
}

/** Each enemy in the beat's footprint: a white star and a few sparks (at most `max`). */
export function ultHitMarks(fx: SkillFx, h: UltHost, s: UltBeatInfo, max = 6): void {
  if (max <= 0 || s.action?.affects === 'allies' || s.action?.affects === 'self') return;
  let list: readonly UnitMemo[];
  if (s.area.shape === 'line') {
    // a line runs from its origin toward the point: test it as the same band from there
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
    LINE_RECT.length = s.area.length;
    LINE_RECT.width = s.area.width;
    LINE_RECT.rot = rot;
    list = h.enemiesIn(LINE_RECT, s.ox, s.oy);
  } else list = h.enemiesIn(s.area, s.x, s.y);
  const n = Math.min(max, list.length);
  // no wait on the stars: a waiting star bursts 8 sparks of its own when it starts (skillfx.ts onStart)
  const light = lighten(s.color, 0.5);
  for (let i = 0; i < n; i++) {
    const m = list[i];
    star(fx, m.x, m.y, 0.65, 34, '#ffffff', s.k, 0, 6);
    h.burst(m.x, m.y, 0.6, Math.max(1, Math.round(2 * s.k)), light, 2.4, 1.6, 0.35);
  }
}
const LINE_RECT: Extract<AreaShape, { shape: 'rect' }> = { shape: 'rect', dir: 'right', anchor: 'start', length: 1, width: 1, rot: 0 };

/** The role default picture of a beat (2-1). */
export function ultDefault(fx: SkillFx, h: UltHost, s: UltBeatInfo): void {
  const light = lighten(s.color, 0.45);
  const R = roundR(s.area);
  const lastHit = s.hit >= s.hits - 1;
  // a flurry's later hits grow like build beats (its opener / encore picture is drawn once, on its first hit)
  const role = (s.role === 'finisher' && !lastHit) || ((s.role === 'opener' || s.role === 'after') && s.hit > 0) ? 'build' : s.role;
  switch (role) {
    case 'path': {
      // a beam of light along where the character went, a white core, an X on each enemy it cut
      const len = s.area.shape === 'line' ? s.area.length : footprintRadius(s.area) * 2;
      const w = s.area.shape === 'line' ? s.area.width : 1.5;
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.hypot(dx, dy) || 1;
      const ex = s.ox + (dx / d) * len;
      const ey = s.oy + (dy / d) * len;
      beam(fx, s.ox, s.oy, ex, ey, w * 1.1, 0.3, s.color, s.k);
      beam(fx, s.ox, s.oy, ex, ey, w * 0.35, 0.25, '#ffffff', s.k, 0.02);
      ultHitMarks(fx, h, s, 6);
      return;
    }
    case 'opener':
    case 'after': {
      const g = role === 'after' ? 1.2 : 1;
      genericLand(fx, s);
      star(fx, s.x, s.y, 0.5, 40 * g, '#ffffff', s.k, 0, 10);
      if (isRound(s.area)) h.ring(s.x, s.y, 0.3, R, 0.4, s.color, 5 * g, 0.1 * s.k);
      else h.ring(s.x, s.y, 0.2, Math.min(R + 0.6, 3), 0.3, '#ffffff', 2, 0);
      h.spray(s.x, s.y, 0.5, count(14 * g, s), Pk.Square, light, 4, 3, 0.55, 8, 4);
      ultHitMarks(fx, h, s, 6);
      return;
    }
    case 'build': {
      // grows a little with every beat of its stage (or every hit of a flurry), up to 8
      const n = s.hits > 1 ? s.hit : s.seq;
      const g = Math.pow(1.1, Math.min(8, n));
      genericLand(fx, s);
      star(fx, s.x, s.y, 0.5, 24 * g, '#ffffff', s.k, 0, 8);
      h.spray(s.x, s.y, 0.5, count(Math.min(10, 4 + n), s), Pk.Square, light, 3, 2.5, 0.45, 8, 4);
      return;
    }
    case 'finisher':
      return; // ultFinisher draws it
    case 'twin': {
      if (s.action?.affects === 'allies' || s.action?.affects === 'self') alliesGlow(fx, h, s, light);
      else fullWave(fx, s, 0.5, s.color, s.k, 0.2);
      return;
    }
    case 'zone': {
      if (s.hit === 0) {
        if (isRound(s.area)) rune(fx, s.x, s.y, R * 0.9, 0.6, s.color, s.k);
        else fullWave(fx, s, 0.6, s.color, s.k * 0.6, 0.2);
      } else if (s.targets > 0) h.spray(s.x, s.y, 0.4, 2, Pk.Square, light, 1.6, 1.5, 0.35, 8, 4);
      return;
    }
    case 'support': {
      const a = s.area;
      if (s.action?.affects === 'self') return selfBubble(fx, s, light);
      if (a.shape === 'circle' && a.radius >= 30) {
        // 「모든 아군」: dust only (a field-wide picture would bury the beats landing with it)
        for (const m of h.allies()) h.spray(m.x, m.y, 1, Math.max(1, Math.round(3 * s.k)), Pk.Gold, light, 0.8, 1.6, 0.8, -1.2, 4);
        return;
      }
      alliesGlow(fx, h, s, light);
      return;
    }
  }
}

/**
 * The finisher's wind-up, called from its PREP (cast time): edge tint at t − vignetteLead (mine), light gathering at
 * t − lead (rings closing in, sparks pulled in, a thin pillar rising, a low rumble for me). t = s.toFinish.
 */
export function ultCharge(fx: SkillFx, h: UltHost, s: UltBeatInfo, spec?: Partial<ChargeSpec>): void {
  const sp = spec ? { ...CHARGE, ...spec } : CHARGE;
  const t = s.toFinish;
  const th = s.theme;
  ultFocus(s, FOCUS);
  const x = FOCUS.x;
  const y = FOCUS.y;
  const local = s.local;
  const k = s.k;
  const color = s.color;
  const follow = s.follow;
  const R = roundR(s.area);
  const low = STAGE_DETAIL.low;
  const vig = sp.vignette < 0 ? th.vignette : sp.vignette;
  if (local && vig > 0) {
    const vc = sp.vignetteColor || th.vignetteColor;
    h.later(Math.max(0, t - sp.vignetteLead), () => h.screen.vignette(vc, vig, sp.vignetteLead + 0.15, 0));
  }
  const n = Math.round(sp.sparks * k * (FX_LOAD.low ? 0.5 : 1));
  const spark = th.spark;
  h.later(Math.max(0, t - sp.lead), () => {
    const was = STAGE_DETAIL.low;
    STAGE_DETAIL.low = low;
    rings(fx, x, y, R * 1.8, 0.3, sp.rings, sp.lead, lighten(color, 0.4), k, follow, 3);
    if (n > 0) h.implode(x, y, 0.5, Math.max(1.2, R * 1.3), n, lighten(color, 0.5), sp.lead, spark);
    if (sp.pillar && !low) pillar(fx, x, y, 0.5, 7, lighten(color, 0.6), k, sp.lead + 0.08, follow);
    STAGE_DETAIL.low = was;
    if (local && sp.rumble > 0) h.juice.shake(sp.rumble, sp.lead);
  });
}

/** 숨 고르기 (mine): at t − 0.12 the world darkens but for the blow's spot (+0.4); none for a footprint over 6 cells. */
export function ultBreath(h: UltHost, s: UltBeatInfo, alpha: number): void {
  if (!s.local || !(alpha > 0)) return;
  const R = footprintRadius(s.area);
  if (R > 6) return;
  ultFocus(s, FOCUS);
  const x = FOCUS.x;
  const y = FOCUS.y;
  const t = s.toFinish;
  // a band's hole: half its length around its middle (the hole is round)
  const hole = s.area.shape === 'line' || s.area.shape === 'rect' || s.area.shape === 'fan' || s.area.shape === 'cone' ? R / 2 + 0.6 : R + 0.4;
  h.later(Math.max(0, t - 0.12), () => h.screen.focusDim(x, y, hole, alpha, 0.04, 0.1, 0));
}

/** The climax (2-3). Mine kicks the screen; another player's / a bot's only draws (k 0.55, low detail). */
export function ultFinisher(fx: SkillFx, h: UltHost, s: UltBeatInfo, spec?: Partial<FinisherSpec>): void {
  const base = s.beats.finisherKind === 'bless' ? FINISH_BLESS : FINISH_STRIKE;
  const sp: FinisherSpec = spec ? { ...base, ...spec } : base;
  const th = s.theme;
  const k = s.k;
  const x = s.x;
  const y = s.y;
  const color = s.color;
  const light = lighten(color, 0.5);
  const screenColor = sp.screenColor || th.screenColor;
  const R = roundR(s.area);
  const low = STAGE_DETAIL.low;
  // the point pieces (star, pillar, sparks, debris, embers, glyph, zoom) sit on the middle of a band / fan / cone — its
  // s.x, s.y can be the caster's feet (integration fix: they burst behind the 블레이드 / 거너 / 메이지)
  ultFocus(s, FOCUS);
  const fx0 = FOCUS.x;
  const fy0 = FOCUS.y;

  // ── the picture (whole at age 0) ──
  if (sp.flash > 0) h.flash(x, y, s.ox, s.oy, s.area, 0.35, lighten(color, 0.3), sp.flash * k);
  if (sp.star > 0) star(fx, fx0, fy0, 0.6, sp.star, '#ffffff', k, 0, 12);
  if (isRound(s.area)) {
    const n = low ? Math.ceil(sp.rings / 2) : sp.rings;
    if (n >= 1) h.ring(x, y, R * 0.5, R, 0.5, color, 10, 0.12 * k);
    if (n >= 2) h.ring(x, y, R * 0.3, R * 1.15, 0.4, '#ffffff', 5, 0);
    if (n >= 3) h.ring(x, y, R * 0.8, R * 1.35, 0.3, '#ffffff', 2, 0);
  } else {
    // a band / cross / fan: the colour stays on its own footprint; outside only a thin white ring, gone in 0.3 s
    fullWave(fx, s, 0.55, color, k);
    if (!low) fullWave(fx, s, 0.4, '#ffffff', k * 0.7);
    h.ring(fx0, fy0, 0.3, Math.min(R * 1.35, 3), 0.3, '#ffffff', 2, 0);
  }
  if (sp.pillar && !low) pillar(fx, fx0, fy0, 1.1, 9, lighten(color, 0.6), k, 0.6).age = 0.09;
  ultHitMarks(fx, h, s, sp.hitMarks);
  const nSpark = count(sp.sparks, s);
  if (nSpark > 0) h.spray(fx0, fy0, 0.5, nSpark, th.spark, light, 6, 4.5, 0.8, 8, 6);
  const nDebris = count(sp.debris, s);
  if (nDebris > 0) h.spray(fx0, fy0, 0.3, nDebris, Pk.Rock, '#5c4f45', 4.5, 5, 0.9, 12, 6);
  const nEmber = count(sp.embers, s);
  if (nEmber > 0) h.later(0.2, () => h.spray(fx0, fy0, 0.4, nEmber, th.ember, light, 1.2, 1.2, 1.8, -0.7, 5));
  if (sp.kind === 'bless') {
    // pillars on up to 6 allies in reach
    let i = 0;
    for (const m of h.allies()) {
      if (i >= 6) break;
      if (Math.hypot(m.x - x, m.y - y) > footprintRadius(s.area) + m.radius) continue;
      pillar(fx, m.x, m.y, 0.5, 5, light, k, 0.6, m.id);
      i++;
    }
  }
  if (sp.glyph !== null) ultGlyph(fx0, fy0, 0, sp.glyph || th.glyph, screenColor, s.local, { px: sp.glyphPx });

  // ── the kick: mine only ──
  const cam = ultCam();
  if (!s.local) {
    // another player's / a bot's climax in view: half the screen flash, nothing else (today's rule)
    if (sp.screen > 0 && cam && cam.visibleX(fx0, 2)) h.screen.flash(sp.screen * 0.5, screenColor, 0.06);
    return;
  }
  const j = h.juice;
  h.screen.cancelFocus(); // 「어둠 끊김」: the breath ends on the blow
  if (sp.stopMs > 0) {
    const sec = (sp.stopMs / 1000) * (j.settings.hitStopMs / 75);
    j.finisherStop(Math.min(sec, Math.max(sp.stopCapMs, sp.stopMs) / 1000));
  }
  if (sp.shake > 0) j.shake(sp.shake, sp.shakeDur);
  if (sp.screen > 0) h.screen.flash(sp.screen, screenColor, 0.06);
  if (sp.zoom > 0) {
    const sx = cam ? cam.sx(fx0) : 640;
    const sy = cam ? cam.sy(fy0) : 360;
    j.zoomPunch(sp.zoom, Math.max(0, Math.min(1280, sx)), Math.max(0, Math.min(720, sy)));
  }
  if (sp.speedLines) ultSpeedLines(fx0, fy0, { n: 28 });
  const vc = th.vignetteColor;
  const tail = sp.tail;
  const tailDur = sp.tailDur;
  h.later(ULT_FINISH.tailAt, () => {
    if (tail > 0) j.shake(tail, tailDur);
    h.screen.vignette(vc, 0.4, 0.6, 0);
  });
}

/**
 * The big glyph (2-3 큰 글자): mine = a 150 px stamp on the screen layer above the blow (real clock: it slams in through
 * the stop); another player's = a small faint one (60 px) over the spot. x, y, z = world point.
 */
export function ultGlyph(x: number, y: number, z: number, text: string, color: string, local: boolean, o?: { px?: number; hold?: number }): void {
  pushGlyph(x, y, z, text, color, local, o?.px ?? (local ? 150 : 60), o?.hold ?? 0.35);
}

/**
 * Speed lines on the screen layer (mine): radial around the world point (x, y), or parallel along `dir` (world radians).
 * None with the shake setting 0 / reduced motion; directional ones none on a struggling phone.
 */
export function ultSpeedLines(x: number, y: number, o?: { dir?: number; n?: number; color?: string; alpha?: number }): void {
  pushSpeedLines(x, y, o?.dir, o?.n ?? 28, o?.color ?? '#ffffff', o?.alpha ?? 0.55);
}

/** Particles flying in along a ring (used by Vfx.implode): world velocity that reaches the centre in about dur s. */
export function implodeSpeed(r: number, dur: number, drag = 2.5): number {
  const d = Math.max(0.05, dur);
  return (r * drag) / (1 - Math.exp(-drag * d));
}

