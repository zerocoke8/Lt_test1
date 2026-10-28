// 기획 22차 궁극기 테스트 — 그룹 B의 조준 / 드래그 궁극기 추가 연출 (docs/ult-test.md 5-4). Characters: gunner · cleric ·
// medic · exorcist · bard · chrono · puppeteer. Only the group-B content track edits this file.
//
// Every staged beat of an alt ult already gets the generic landing wave in the character's colour (render/stagefx.ts
// genericLand, keyed `<skillId>:<stage>`); this module adds a few accents where that wave alone reads poorly:
//  - the finishers (거너 대구경 포탄 / 슬러그, 클레릭 큰 종, 메딕 제세동, 퇴마사 멸, 퍼펫티어 커튼콜): a ring + sparks (+ a
//    small shake for my own);
//  - motion the wave cannot show: 클레릭's light rings closing onto the point, 크로노's rewind pulling in and the freeze;
//  - 바드 드래그's right-hand band, which has no stage of its own (one 'beat' per beat keeps the beat sound honest).
// Mine at full strength, another player's softer (never buries my own fight).

import type { AreaShape, GameEvent } from '../../types';
import { registerUltFx, type UltFxView } from './index';

type Stage = Extract<GameEvent, { type: 'skillStage' }>;

/** Another player's accents are drawn at this strength (like render/vfx.ts OTHER_PLAYER_FX). */
const OTHER = 0.6;

const GOLD = '#ffe08a';
const SHELL = '#ffc27a';
const HOLY = '#fff4c2';
const SPARK = '#d9fbff';
const TALISMAN = '#ffd166';
const TIME = '#cfd5ff';
const PUPPET = '#ffb3d9';

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

const STAGES: Record<string, StageFx> = {
  // ── 거너 조준: each shell a puff of sparks, the heavy shell a blast ──
  'gunner_ua:shells': (ev, v, k) => {
    v.host.burst(ev.center.x, ev.center.y, 0.3, Math.round(6 * k), SHELL, 3.2, 2.5, 0.4);
  },
  'gunner_ua:heavy': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.6, 0.5, SHELL, 7 * k, 0.2 * k);
    v.host.ring(x, y, 0.2, 1.6, 0.3, '#ffffff', 3 * k, 0);
    v.host.burst(x, y, 0.4, Math.round(26 * k), SHELL, 5.5, 4.5, 0.7);
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
    v.host.ring(x, y, r + 1, Math.max(0.4, r * 0.35), 0.4, GOLD, 5 * k, 0.08 * k);
    if (ev.actionIndex === 3) {
      // the last, stunning ring
      v.host.ring(x, y, 0.2, r + 0.4, 0.35, HOLY, 4 * k, 0.15 * k);
      v.host.burst(x, y, 0.5, Math.round(18 * k), HOLY, 3.5, 4, 0.7, -2);
    }
  },
  // ── 클레릭 드래그: the big bell ──
  'cleric_ud:judgement': (ev, v, k, local) => {
    const { x, y } = ev.center;
    const r = radiusOf(ev.area);
    v.host.ring(x, y, 0.4, r + 0.5, 0.7, GOLD, 8 * k, 0.18 * k);
    v.host.ring(x, y, 0.2, r * 0.6, 0.45, '#ffffff', 3 * k, 0);
    v.host.burst(x, y, 1.2, Math.round(24 * k), HOLY, 4, 5, 0.9, -1.5);
    if (local) v.host.shake(5);
  },
  // ── 메딕 드래그: the defibrillator ──
  'medic_ud:defib': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.2, 2.2, 0.3, '#e8ffff', 4 * k, 0.15 * k);
    v.host.burst(x, y, 0.5, Math.round(18 * k), SPARK, 6, 3, 0.4);
    if (local) v.host.shake(4);
  },
  // ── 퇴마사 조준: 멸 along the wall ──
  'exorcist_ua:destroy': (ev, v, k, local) => {
    if (ev.actionIndex !== 2) return; // the wall (the allies' heal circle is the twin of this beat)
    const { x, y } = ev.center;
    v.host.flash(x, y, x, y, ev.area, 0.45, TALISMAN, 0.9 * k);
    v.host.burst(x, y, 0.4, Math.round(20 * k), TALISMAN, 4.5, 3.5, 0.6);
    if (local) v.host.shake(5);
  },
  // ── 퇴마사 드래그: 멸 ──
  'exorcist_ud:destroy': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.4, 0.5, TALISMAN, 6 * k, 0.15 * k);
    if (local) v.host.shake(4);
  },
  // ── 바드 드래그: the right-hand band of the second beat (no stage of its own), mirrored from the left one ──
  'bard_ud:beat': (ev, v, k) => {
    if (ev.actionIndex !== 3 || ev.hit !== 0) return;
    const x = ev.center.x + 6;
    const y = ev.center.y;
    v.host.flash(x, y, x, y, ev.area, 0.4, '#f3a6ff', 0.8 * k);
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
    if (ev.actionIndex !== 3) return; // the freeze circle (the X twin lands with it)
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.3, 0.5, TIME, 6 * k, 0.15 * k);
    if (local) v.host.shake(3);
  },
  // ── 퍼펫티어: the curtain call ──
  'puppeteer_ua:curtaincall': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.burst(x, y, 1, Math.round(22 * k), PUPPET, 5, 4, 0.8);
    if (local) v.host.shake(4);
  },
  'puppeteer_ud:curtaincall': (ev, v, k, local) => {
    const { x, y } = ev.center;
    v.host.ring(x, y, 0.3, radiusOf(ev.area) + 0.4, 0.5, PUPPET, 6 * k, 0.15 * k);
    v.host.burst(x, y, 1, Math.round(18 * k), PUPPET, 4.5, 4, 0.8);
    if (local) v.host.shake(4);
  },
};

registerUltFx({ onEvent });
