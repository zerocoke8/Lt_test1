// 기획 22차 궁극기 테스트 — 그룹 A의 조준 / 드래그 궁극기 추가 연출 (docs/ult-test.md 5-4). Characters: guardian · paladin ·
// warden · blade · berserker · shadow · ranger · mage. Only the group-A content track edits this file.
//
// Every staged beat of an alt ult already gets the generic landing wave in the character's colour (render/stagefx.ts
// genericLand, keyed `<skillId>:<stage>`), and the dash / blink of a move or a rush is drawn from its own event. This
// module adds accents only where that wave alone reads poorly:
//  - the finishers (성채 / 성벽, 대심판 / 빛기둥, 철창 / 해방, 대일섬, 마무리 / 여진, 초승달, 하늘 화살 / 관통 일격, 깨짐 /
//    대빙성): a ring + sparks (+ a small shake for my own) — the stage tables' hit-stop is keyed by today's ids only;
//  - the throws and lines the wave draws flat: 가디언's thrown shield, 워든's hook, 버서커's rush, 섀도우's pass-through,
//    레인저's volley line (a flash along the footprint, once per part);
//  - 메이지 드래그's hailstones (a puff of ice on each).
// Mine at full strength, another player's softer (never buries my own fight).

import type { AreaShape, GameEvent } from '../../types';
import { registerUltFx, type UltFxView } from './index';

type Stage = Extract<GameEvent, { type: 'skillStage' }>;

/** Another player's accents are drawn at this strength (like render/vfx.ts OTHER_PLAYER_FX). */
const OTHER = 0.6;

const STEEL = '#cfe0ff';
const HOLY = '#fff4c2';
const GOLD = '#ffe08a';
const CHAIN = '#c9d6a3';
const EDGE = '#ffe3ec';
const BLOOD = '#ff8a65';
const MOON = '#d9d6ff';
const ARROW = '#c9ffe9';
const ICE = '#bdeeff';

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
  if (ev.type !== 'skillStage' || ev.team !== 'ally' || ev.slot !== 'ult') return;
  const fn = STAGES[`${ev.skillId}:${ev.stage}`];
  if (!fn) return;
  const local = ev.player === view.localPlayer;
  fn(ev, view, local ? 1 : OTHER, local);
}

type StageFx = (ev: Stage, view: UltFxView, k: number, local: boolean) => void;

/** A big landing: ring out to the footprint, a white core ring, sparks, a shake for my own. */
function slam(ev: Stage, v: UltFxView, k: number, local: boolean, color: string, shake: number): void {
  const { x, y } = ev.center;
  v.host.ring(x, y, 0.3, Math.min(8, radiusOf(ev.area)) + 0.5, 0.5, color, 7 * k, 0.18 * k);
  v.host.ring(x, y, 0.2, 1.6, 0.3, '#ffffff', 3 * k, 0);
  v.host.burst(x, y, 0.4, Math.round(22 * k), color, 5, 4, 0.7);
  if (local && shake > 0) v.host.shake(shake);
}

/** A shaped finisher (line / rect / cone / cross): a bright flash of its footprint + sparks on its centre. */
function sweep(ev: Stage, v: UltFxView, k: number, local: boolean, color: string, shake: number): void {
  const { x, y } = ev.center;
  v.host.flash(x, y, x, y, ev.area, 0.4, color, 0.9 * k);
  v.host.burst(x, y, 0.5, Math.round(16 * k), color, 5.5, 2.5, 0.5);
  if (local && shake > 0) v.host.shake(shake);
}

/** A line / rect from where the part started (its origin is the caster: flash it from there). */
function streak(ev: Stage, v: UltFxView, k: number, color: string, ox: number, oy: number): void {
  v.host.flash(ev.center.x, ev.center.y, ox, oy, ev.area, 0.3, color, 0.75 * k);
}

/** The caster's spot now (a line's origin), else the part's centre. */
function casterAt(ev: Stage, v: UltFxView): { x: number; y: number } {
  const id = ev.sourceId;
  const e = id != null ? v.state.entities.find(u => u.id === id) : undefined;
  return e ? e.pos : ev.center;
}

const STAGES: Record<string, StageFx> = {
  // ── 가디언 조준: the thrown shield along its line, the citadel on the point ──
  'guardian_ua:rally': (ev, v, k) => {
    if (ev.hit !== 0) return;
    const o = casterAt(ev, v);
    streak(ev, v, k, STEEL, o.x, o.y);
    v.host.burst(ev.center.x, ev.center.y, 0.6, Math.round(10 * k), STEEL, 3.5, 2, 0.4);
  },
  'guardian_ua:citadel': (ev, v, k, local) => slam(ev, v, k, local, STEEL, 6),
  // ── 가디언 드래그: the wall rises across the dash ──
  'guardian_ud:citadel': (ev, v, k, local) => sweep(ev, v, k, local, STEEL, 6),
  // ── 팔라딘: the great cross / the pillar ──
  'paladin_ua:tribunal': (ev, v, k, local) => {
    sweep(ev, v, k, local, GOLD, 5);
    v.host.burst(ev.center.x, ev.center.y, 1.2, Math.round(18 * k), HOLY, 3, 5, 0.9, -1.5);
  },
  'paladin_ud:tribunal': (ev, v, k, local) => {
    if (ev.area.shape !== 'circle') return; // the core (its cross twin lands with it)
    slam(ev, v, k, local, GOLD, 5);
    v.host.burst(ev.center.x, ev.center.y, 1.2, Math.round(18 * k), HOLY, 3, 5, 0.9, -1.5);
  },
  // ── 워든: the hook line, the cage, the release ──
  'warden_ua:hook': (ev, v, k) => {
    if (ev.hit !== 0) return;
    streak(ev, v, k, CHAIN, ev.center.x, ev.center.y);
  },
  'warden_ua:cage': (ev, v, k, local) => slam(ev, v, k, local, CHAIN, 4),
  'warden_ud:cage': (ev, v, k, local) => slam(ev, v, k, local, CHAIN, 4),
  'warden_ua:release': (ev, v, k, local) => slam(ev, v, k, local, CHAIN, 3),
  'warden_ud:release': (ev, v, k, local) => slam(ev, v, k, local, CHAIN, 3),
  // ── 블레이드: the long cut ──
  'blade_ua:issen': (ev, v, k, local) => sweep(ev, v, k, local, EDGE, 6),
  'blade_ud:issen': (ev, v, k, local) => sweep(ev, v, k, local, EDGE, 6),
  // ── 버서커: the rush, the crack's aftershock, the finale ──
  'berserker_ua:rush': (ev, v, k) => streak(ev, v, k, BLOOD, ev.center.x, ev.center.y),
  'berserker_ua:finale': (ev, v, k, local) => slam(ev, v, k, local, BLOOD, 6),
  'berserker_ud:finale': (ev, v, k, local) => sweep(ev, v, k, local, BLOOD, 5),
  // ── 섀도우: the pass-through mark, the crescent ──
  'shadow_ua:dance': (ev, v, k) => {
    if (ev.area.shape !== 'rect') return; // the rush band (the clone bursts get the generic wave)
    streak(ev, v, k, MOON, ev.center.x, ev.center.y);
  },
  'shadow_ua:moon': (ev, v, k, local) => slam(ev, v, k, local, MOON, 5),
  'shadow_ud:moon': (ev, v, k, local) => slam(ev, v, k, local, MOON, 5),
  // ── 레인저: the sky arrow / the pierce ──
  'ranger_ua:skyshot': (ev, v, k, local) => slam(ev, v, k, local, ARROW, 5),
  'ranger_ud:barrage': (ev, v, k) => {
    if (ev.hit !== 0) return;
    const o = casterAt(ev, v);
    streak(ev, v, k, ARROW, o.x, o.y);
  },
  'ranger_ud:skyshot': (ev, v, k, local) => {
    const o = casterAt(ev, v);
    v.host.flash(ev.center.x, ev.center.y, o.x, o.y, ev.area, 0.45, '#ffffff', 0.95 * k);
    v.host.burst(ev.center.x, ev.center.y, 0.6, Math.round(16 * k), ARROW, 5, 2, 0.5);
    if (local) v.host.shake(5);
  },
  // ── 메이지: the shatter of the fan, the hailstones and the big ice star ──
  'mage_ua:shatter': (ev, v, k, local) => sweep(ev, v, k, local, ICE, 5),
  'mage_ud:freeze': (ev, v, k) => {
    v.host.ring(ev.center.x, ev.center.y, 0.2, radiusOf(ev.area) + 0.2, 0.3, ICE, 3 * k, 0.1 * k);
    v.host.burst(ev.center.x, ev.center.y, 0.8, Math.round(6 * k), ICE, 2.5, 1.5, 0.4);
  },
  'mage_ud:shatter': (ev, v, k, local) => slam(ev, v, k, local, ICE, 6),
};

registerUltFx({ onEvent });
