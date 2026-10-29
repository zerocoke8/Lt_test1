// 기획 22차 궁극기 테스트 — 그룹 A의 캐릭터별 조준 / 드래그 궁극기 (docs/ult-test.md 5장).
// Characters (roster order): guardian 가디언 · paladin 팔라딘 · warden 워든 · blade 블레이드 · berserker 버서커 ·
// shadow 섀도우 · ranger 레인저 · mage 메이지.
// A character missing here (or a missing aim / drag) uses the fallback (src/sim/ultTest.ts): 조준 = today's ult
// re-centred on the aimed point (area ults) or turned toward it (direction ults); 드래그 = blink to the point, today's ult.
// Only this file (and src/render/ultTest/groupA.ts) belongs to the group-A content track.
//
// What each one got (조준 = where / which way the button was dragged; 드래그 = an enhanced drag skill cast where it lands,
// rel 'aim' = the way it moved):
//   guardian  조준 성채 투척          every ally shielded, a thrown shield pulls the line onto the point, citadel + barrier there,
//                                    the citadel unfolds (1.5 s)
//             드래그 성벽 대강림      dash (the path hits), slam + every ally shielded, a big wall ACROSS the dash (+ barrier),
//                                    the wall surges forward (1.6 s)
//   paladin   조준 성창 심판          every ally healed + shielded, 8 spears walk toward the aim, the big '+' on the point (≤ 9)
//             드래그 축복의 돌격      dash: the path heals + shields the allies it crosses; a bigger brand + blessing, pillar
//   warden    조준 사슬 갈고리 · 철창  self shield, a 12-cell hook pulls the line in, cage + prison in front, release
//             드래그 사슬 대감옥      dash dragging the path along, hook ring at the landing, cage + fence, release
//   blade     조준 천검 · 검기 폭풍    stands: 10 sword waves in a cone toward the aim, then a 16-cell 대일섬 the same way
//             드래그 천검 삼연섬      dash there, 7 cells on through, back to the landing, the path bursts (질풍 삼연섬, bigger)
//   berserker 조준 혈귀 돌진          a 6-cell rush toward the aim (stun), a roar where it stops, a leap-slam there (1.5 s),
//                                    광란 8 s, the finale
//             드래그 혈귀 대지분쇄    blink (leap) there, slam + 광란, the crack the way it leapt, three lava geysers along it
//   shadow    조준 월영 질주          an 8-cell pass-through toward the aim (mark), clones burst on the way, the crescent
//             드래그 흑월 대처형진    blink there, an ink circle round its target, six clones cut across it (faster and
//                                    faster), then the black moon falls on it (1.5 s)
//   ranger    조준 매의 화살비 · 천공 강하  a marking arrow on the point, three rings of rain closing in on it, then the
//                                    hawk of light dives as the sky arrow (1.9 s)
//             드래그 매의 대일격      a leap there, a three-lane volley at its target, three arrows pin it, then the pierce
//                                    (1.5 s) (bots stay put)
//   mage      조준 블리자드 · 빙결풍  the blizzard as a fan toward the aim (2 s), five icicles in it, then freeze and shatter
//             드래그 빙결 유성우      blink there, 8 ice hailstones around (ahead first), the big ice star, a short blizzard
//
// Stage names reuse today's ult stages where the beat matches (they play today's ult sounds, src/audio/stages.ts slot
// 'ult'): aegis rally citadel barrier · sanctuary spear tribunal · chainstorm cage prison release · storm issen ·
// frenzy roar finale · dance moon · rain skyshot · blizzard freeze shatter. A name only in the drag skill's row (가디언
// 'slam', 팔라딘 'brand' 'blessing', 워든 'hook', 블레이드 'dash' 'return', 버서커 'slam' 'split', 섀도우 'clone',
// 레인저 'volley' 'pierce') plays that drag cue (src/audio/director.ts); a name in neither (레인저 'mark' 'pin', 기획
// 24차) has its cue in the alt's own `sfx`; the rest the role's default sound. Visuals are keyed `<id>:<stage>`
// (src/render/ultTest/groupA.ts).
// Every effect lands at ≥ ULT_TEST.firstHit (0.45 s, the cut-in rule); only movement (dash) happens at 0 s. No part uses
// center 'target' in 조준 (보이는 곳 = 맞는 곳: with nobody near the point it would jump to the caster's own target).
//
// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 3장 그룹 A): every alt names its climax (`finale`, render / sound only — the
// sim never reads it) and may override a stage's sounds (`sfx`, existing ids only). Design changes: 가디언 조준 / 드래그
// got a closing blow (성채 전개 1.5 s / 성벽 돌파 1.6 s), 워든 조준's cage at 1 s, 버서커 조준 a leap-slam at 1.5 s
// (혈귀 낙하), 버서커 드래그 three lava geysers along the crack instead of the aftershock, 메이지 조준 2.45 s instead of
// 4.85 s with five hailstones. The others only renamed stages (each beat its own picture / sound).
//
// 기획 24차 (docs/ult-fx.md 8-3 A12′–A14′): three weak ones redesigned (data + looks, power by eye like the rest) —
// 섀도우 드래그 「흑월 대처형진」 (an ink circle, six clones cutting across its target, the moon at 1.5 s; the run of
// clones, the slide and the X are gone), 레인저 조준 「매의 화살비 · 천공 강하」 (a marking arrow, three rings of rain
// closing in, the sky arrow at 1.9 s instead of 2.3 s; the 12-arrow storm and the 5-hit rain are gone), 레인저 드래그
// (seven arrows instead of ten, three arrows pinning its target at 1.1 s, the pierce at 1.5 s instead of 1.25 s, wider).

import type { AreaShape, Effect, SkillAction } from '../../types';
import type { UltAltSet } from './types';
import { ULT_CAST_TIME } from './types';

/** Every ally on the field (all players' characters, summons and the 돌발 괴담 patient) — like characters.ts ALL. */
const ALL: AreaShape = { shape: 'circle', radius: 99 };
/** 가디언 드래그: the wall, written 'down' (= to the right of +x) so after the aim turn it lies ACROSS the dash. */
const G_WALL: AreaShape = { shape: 'rect', dir: 'down', anchor: 'center', length: 13, width: 3 };
/** 팔라딘 드래그: the bigger '+' brand. */
const P_BRAND: AreaShape = { shape: 'cross', length: 5, width: 1.8 };
/** 팔라딘 조준: the eight spears, 0.05 s apart (today's rhythm), 1.5 → 8.5 cells toward the aim. */
const SPEARS: readonly (readonly [number, number])[] = [
  [1.5, 0.6],
  [2.5, 0.65],
  [3.5, 0.7],
  [4.5, 0.75],
  [5.5, 0.8],
  [6.5, 0.85],
  [7.5, 0.9],
  [8.5, 0.95],
];
/** 버서커 광란 (today's numbers). */
const FRENZY: Effect[] = [
  { kind: 'status', status: 'atkUp', duration: 8, value: 0.5 },
  { kind: 'status', status: 'haste', duration: 8, value: 0.5 },
  { kind: 'status', status: 'lifesteal', duration: 8, value: 0.25 },
  { kind: 'status', status: 'splashUp', duration: 8, value: 0.4 },
];
/** 섀도우 조준: [offset ahead of where it stood, delay] — the clones burst on the band it rushed through, first in first. */
const SHADOW_CLONES: readonly (readonly [number, number])[] = [
  [2, 0.6],
  [4, 0.7],
  [6, 0.8],
];
/** 섀도우 드래그 (기획 24차): six clones cut through its target, faster and faster — [rot° from the way it moved, delay]. */
const SHADOW_CUTS: readonly (readonly [number, number])[] = [
  [0, 0.6],
  [60, 0.7],
  [120, 0.79],
  [30, 0.87],
  [90, 0.94],
  [150, 1],
];
/** 레인저 조준 (기획 24차): the arrow rain closes in on the mark — [radius, delay, damage]; the innermost = the sky arrow's size. */
const HAWK_RAIN: readonly (readonly [number, number, number])[] = [
  [3.6, 0.8, 1.6],
  [2.8, 1.05, 1.8],
  [2, 1.3, 2],
];
/** 메이지 조준 (기획 23차): five icicles inside the fan, [ahead, right, delay] — far and near in turn, the last in the middle. */
const ICICLES: readonly (readonly [number, number, number])[] = [
  [3, -1.5, 0.9],
  [4.5, 1.5, 1.1],
  [6, -1, 1.3],
  [7, 1.2, 1.5],
  [5, 0, 1.7],
];
/**
 * 버서커 드래그 (기획 23차): three lava geysers along the crack, [ahead, delay, radius] — they run back along the crack
 * toward the landing, the last, biggest one on the spot it dropped on (기획 23차 검토: a drag dropped on a boss lands at
 * its near edge, so a ★ 9 cells ahead fell past it).
 */
const GEYSERS: readonly (readonly [number, number, number])[] = [
  [7, 1.25, 1.8],
  [4.5, 1.38, 2],
  [1.5, 1.5, 2.6],
];
/** 메이지 드래그: eight hailstones on a ring of 3, clockwise from straight ahead (the way it moved), 0.08 s apart. */
const HAIL: readonly (readonly [number, number, number])[] = [
  [3, 0, 0.45],
  [2.1, 2.1, 0.53],
  [0, 3, 0.61],
  [-2.1, 2.1, 0.69],
  [-3, 0, 0.77],
  [-2.1, -2.1, 0.85],
  [0, -3, 0.93],
  [2.1, -2.1, 1.01],
];

export const GROUP_A: Record<string, UltAltSet> = {
  // ─────────────────────────── 가디언 ───────────────────────────
  guardian: {
    aim: {
      id: 'guardian_ua',
      name: '성채 투척',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description:
        '모든 아군에게 보호막(최대 HP 30%, 8초). 겨눈 곳으로 방패를 던져 직선(길이 9, 폭 2.6)의 적을 그곳으로 3칸 끌어당기고 공격력 60% 피해 + 4초 도발. 0.85초에 겨눈 곳 반경 3.5에 성채 낙하: 공격력 250% 피해 + 1.5초 기절, 그 자리 반경 4에 6초간 결계(아군 방어 +30%, 적 30% 둔화). 1.5초에 성채 전개(반경 4.5): 공격력 140% 피해 + 1.5칸 넉백 + 0.5초 기절.',
      finale: 'wave',
      sfx: { wave: [{ id: 'drag.guardian.charge', lead: 0.5 }, { id: 'drag.guardian.wave' }] },
      actions: [
        { stage: 'aegis', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'shield', amount: 0.3, duration: 8 }] },
        // the thrown shield: a band from the guardian through the point ('line' = from the caster toward its centre);
        // the pull is toward the part's centre = the point, where the citadel falls
        {
          stage: 'rally',
          center: 'point',
          delay: 0.45,
          area: { shape: 'line', length: 9, width: 2.6 },
          affects: 'enemies',
          effects: [{ kind: 'pull', distance: 3 }, { kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'taunt', duration: 4, value: 0 }],
        },
        { stage: 'citadel', center: 'point', delay: 0.85, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
        // 기획 23차 ★ 성채 전개: the hex shield unfolds over the citadel and bursts outward
        {
          stage: 'wave',
          center: 'point',
          delay: 1.5,
          telegraphLead: 0.35,
          area: { shape: 'circle', radius: 4.5 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'knockback', distance: 1.5 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }],
        },
        { stage: 'barrier', center: 'point', delay: 0.85, telegraphLead: 0, area: { shape: 'circle', radius: 4 }, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 0.6, value: 0.3 }], zone: { duration: 6, tickInterval: 0.5 } },
        { stage: 'barrier', center: 'point', delay: 0.85, telegraphLead: 0, area: { shape: 'circle', radius: 4 }, affects: 'enemies', effects: [{ kind: 'status', status: 'slow', duration: 0.6, value: 0.3 }], zone: { duration: 6, tickInterval: 0.5 } },
      ],
    },
    drag: {
      id: 'guardian_ud',
      name: '성벽 대강림',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'dash', maxRange: 8, path: { width: 2.2, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }], stage: 'rally' } },
      description:
        '끌어 놓은 곳까지 돌진(최대 8칸)하며 지나간 길(폭 2.2)에 공격력 50% 피해. 착지 지점 반경 2.4에 공격력 100% 피해 + 0.8초 기절, 모든 아군에게 보호막(최대 HP 30%, 8초). 0.75초에 돌진 방향을 가로막는 성벽(길이 13, 폭 3): 공격력 220% 피해 + 1.5초 기절 + 4초 도발. 성벽은 6초간 남아 아군 방어 +30%, 적 40% 둔화. 1.6초에 성벽이 앞으로 밀려 나감(성벽 앞 1.5칸부터 길이 5, 폭 13): 공격력 160% 피해 + 2.5칸 넉백 + 0.5초 기절.',
      finale: 'wave',
      sfx: { wave: [{ id: 'drag.guardian.charge', lead: 0.5 }, { id: 'drag.guardian.wave' }] },
      actions: [
        // the slam where it lands (the path keeps 'rally': its hit is the thrown-shield sound)
        { stage: 'slam', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
        { stage: 'aegis', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'shield', amount: 0.3, duration: 8 }] },
        {
          stage: 'citadel',
          rel: 'aim',
          center: 'point',
          delay: 0.75,
          area: G_WALL,
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }, { kind: 'status', status: 'taunt', duration: 4, value: 0 }],
        },
        { stage: 'barrier', rel: 'aim', center: 'point', delay: 0.75, telegraphLead: 0, area: G_WALL, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 0.6, value: 0.3 }], zone: { duration: 6, tickInterval: 0.5 } },
        { stage: 'barrier', rel: 'aim', center: 'point', delay: 0.75, telegraphLead: 0, area: G_WALL, affects: 'enemies', effects: [{ kind: 'status', status: 'slow', duration: 0.6, value: 0.4 }], zone: { duration: 6, tickInterval: 0.5 } },
        // 기획 23차 ★ 성벽 돌파: the wall surges forward — the band just in front of it, 5 deep, as wide as the wall
        {
          stage: 'wave',
          rel: 'aim',
          center: 'point',
          offset: { x: 1.5, y: 0 },
          delay: 1.6,
          telegraphLead: 0.4,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 5, width: 13 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'knockback', distance: 2.5 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }],
        },
      ],
    },
  },

  // ─────────────────────────── 팔라딘 ───────────────────────────
  paladin: {
    aim: {
      id: 'paladin_ua',
      name: '성창 심판',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      aimRange: 9,
      description:
        '모든 아군 HP 8% 회복 + 보호막(최대 HP 20%, 6초). 0.6초부터 겨눈 쪽으로 빛의 창 8개가 차례로 꽂혀 길을 냄(반경 1.2, 8.5칸까지): 각각 공격력 45% 피해 + 4초간 받는 피해 +15%. 1.2초에 겨눈 곳(9칸 안)에 큰 십자(+, 상하좌우 7칸, 폭 2.2) 대심판: 공격력 200% 피해 + 1.5초 기절.',
      finale: 'tribunal',
      actions: [
        { stage: 'sanctuary', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }, { kind: 'shield', amount: 0.2, duration: 6 }] },
        ...SPEARS.map(
          ([x, delay]): SkillAction => ({
            stage: 'spear',
            rel: 'aim',
            center: 'self',
            offset: { x, y: 0 },
            delay,
            // 기획 23차: a short warning each (eight long ones covered the field — the falling spear is the warning)
            telegraphLead: 0.15,
            area: { shape: 'circle', radius: 1.2 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.45 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.15 }],
          }),
        ),
        { stage: 'tribunal', center: 'point', delay: 1.2, area: { shape: 'cross', length: 7, width: 2.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
      ],
    },
    drag: {
      id: 'paladin_ud',
      name: '축복의 돌격',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      // the path is the heal: every ally it runs through (the paladin itself included) is healed and shielded
      move: { kind: 'dash', maxRange: 9, path: { width: 2.4, affects: 'allies', effects: [{ kind: 'heal', amount: 0.12 }, { kind: 'shield', amount: 0.25, duration: 6 }], stage: 'blessing' } },
      description:
        '끌어 놓은 곳까지 돌진(최대 9칸)하며 지나간 길(폭 2.4)의 아군 HP 12% 회복 + 보호막(최대 HP 25%, 6초). 착지 지점에 십자(+) 낙인(상하좌우 5칸, 폭 1.8): 공격력 80% 피해 + 5초간 받는 피해 +15%, 반경 4 아군 6초간 방어 +25%. 0.95초에 낙인 위로 빛기둥: 공격력 200% 피해 + 1.5초 기절, 가운데(반경 2)는 공격력 150% 피해 추가.',
      finale: 'tribunal',
      // the path's heal lands with the brand's own sound
      sfx: { _path: null },
      // 기획 23차: each beat its own stage (the drag skill's brand / blessing sounds, the core its own picture)
      actions: [
        { stage: 'brand', center: 'point', delay: 0.45, area: P_BRAND, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'vulnerable', duration: 5, value: 0.15 }] },
        { stage: 'blessing', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 4 }, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 6, value: 0.25 }] },
        { stage: 'tribunal', center: 'point', delay: 0.95, area: P_BRAND, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
        { stage: 'core', center: 'point', delay: 0.95, telegraphLead: 0, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }] },
      ],
    },
  },

  // ─────────────────────────── 워든 ───────────────────────────
  warden: {
    aim: {
      id: 'warden_ua',
      name: '사슬 갈고리 · 철창',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description:
        '자신에게 보호막(최대 HP 35%, 8초). 겨눈 쪽으로 사슬 갈고리(길이 12, 폭 2.4)를 던져 맞은 적을 8칸 끌어당기고 공격력 100% 피해 + 3초간 60% 둔화. 1초에 앞 1.5칸 반경 3에 철창 낙하: 공격력 300% 피해 + 2초 기절, 5초간 감옥(갇힌 적은 밖으로 못 나가고 0.5초마다 공격력 25% 피해 + 60% 둔화). 끝나면 반경 3.2 해방: 공격력 150% 피해 + 1.5칸 넉백.',
      finale: 'cage',
      actions: [
        { stage: 'chainstorm', center: 'self', delay: 0.45, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'shield', amount: 0.35, duration: 8 }] },
        // the hook: a band from the warden toward the aim; the pull is toward the band's start (the warden)
        {
          stage: 'hook',
          rel: 'aim',
          center: 'self',
          delay: 0.45,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 12, width: 2.4 },
          affects: 'enemies',
          effects: [{ kind: 'pull', distance: 8 }, { kind: 'damage', amount: 1 }, { kind: 'status', status: 'slow', duration: 3, value: 0.6 }],
        },
        // cage / prison / release just in front of where the warden stood at cast (where the catch piles up). 기획 23차:
        // 0.9 → 1 s, so the pulled ones have finished sliding in when the cage falls
        { stage: 'cage', rel: 'aim', center: 'self', offset: { x: 1.5, y: 0 }, delay: 1, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 2, value: 0 }] },
        {
          stage: 'prison',
          rel: 'aim',
          center: 'self',
          offset: { x: 1.5, y: 0 },
          delay: 1,
          telegraphLead: 0,
          area: { shape: 'circle', radius: 3 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'slow', duration: 0.6, value: 0.6 }, { kind: 'status', status: 'tether', duration: 0.6, value: 3 }],
          zone: { duration: 5, tickInterval: 0.5 },
        },
        { stage: 'release', rel: 'aim', center: 'self', offset: { x: 1.5, y: 0 }, delay: 6, telegraphLead: 0.5, area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'knockback', distance: 1.5 }] },
      ],
    },
    drag: {
      id: 'warden_ud',
      name: '사슬 대감옥',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      // the path's centre is the landing spot, so its pull reels everything on the way toward where the warden lands
      move: { kind: 'dash', maxRange: 8, path: { width: 2.6, affects: 'enemies', effects: [{ kind: 'pull', distance: 3 }, { kind: 'damage', amount: 0.5 }], stage: 'chainstorm' } },
      description:
        '끌어 놓은 곳까지 돌진(최대 8칸)하며 지나간 길(폭 2.6)의 적을 착지 지점 쪽으로 3칸 끌어당기고 공격력 50% 피해. 착지 고리(안쪽 0.6 ~ 바깥 6)의 적을 3.5칸 끌어당기고 공격력 80% 피해, 자신에게 보호막(최대 HP 35%, 8초). 0.8초에 반경 3을 옥죄어 공격력 260% 피해 + 1.5초 기절, 5초간 울타리(반경 3.2, 밖으로 못 나가고 0.5초마다 공격력 25% 피해 + 50% 둔화). 끝나면 반경 3.4 해방: 공격력 150% 피해 + 2칸 넉백.',
      finale: 'cage',
      actions: [
        { stage: 'hook', center: 'point', delay: 0.45, area: { shape: 'ring', inner: 0.6, outer: 6 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 3.5 }, { kind: 'damage', amount: 0.8 }] },
        { stage: 'chainstorm', center: 'self', delay: 0.45, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'shield', amount: 0.35, duration: 8 }] },
        { stage: 'cage', center: 'point', delay: 0.8, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.6 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
        {
          stage: 'prison',
          center: 'point',
          delay: 0.8,
          telegraphLead: 0,
          area: { shape: 'circle', radius: 3.2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'slow', duration: 0.6, value: 0.5 }, { kind: 'status', status: 'tether', duration: 0.6, value: 3.2 }],
          zone: { duration: 5, tickInterval: 0.5 },
        },
        { stage: 'release', center: 'point', delay: 5.8, telegraphLead: 0.5, area: { shape: 'circle', radius: 3.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'knockback', distance: 2 }] },
      ],
    },
  },

  // ─────────────────────────── 블레이드 ───────────────────────────
  blade: {
    aim: {
      id: 'blade_ua',
      name: '천검 · 검기 폭풍',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description: '제자리에서 겨눈 쪽 부채꼴(반경 8, 60°)로 0.1초마다 검기 10번: 각각 공격력 70% 피해. 1.8초에 겨눈 쪽 대일섬(길이 16, 폭 3): 공격력 400% 피해 + 0.6초 기절.',
      finale: 'issen',
      actions: [
        // follow: each wave comes from where the blade stands then (the direction stays the aimed one); once it is swapped
        // out or down the rest stay where it left (never the aimed point)
        { stage: 'storm', rel: 'aim', center: 'self', follow: true, delay: 0.5, telegraphLead: 0, area: { shape: 'cone', dir: 'right', radius: 8, angle: 60 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.7 }], hits: 10, hitInterval: 0.1 },
        { stage: 'issen', rel: 'aim', center: 'self', delay: 1.8, telegraphLead: 0.25, area: { shape: 'rect', dir: 'right', anchor: 'start', length: 16, width: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 4 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
      ],
    },
    drag: {
      id: 'blade_ud',
      name: '천검 삼연섬',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'dash', maxRange: 8 },
      description:
        '끌어 놓은 곳까지 달려가(최대 8칸) 그대로 7칸 돌진(폭 2)하며 공격력 300% 피해 + 0.5초 기절. 0.75초에 착지 지점으로 되돌아 베며(7칸) 공격력 250% 피해, 1.1초에 지나간 길(길이 9, 폭 3)이 터져 공격력 400% 피해 + 0.6초 기절. 블레이드는 착지 지점에 섬.',
      finale: 'issen',
      // 기획 23차: the two rushes have their own stages (the drag skill's dash / return pictures and sounds)
      actions: [
        // NOT atFire on purpose: the blade already stands at landing + 7 when the return part is started (a charge fixes
        // its path at cast), so the return rushes back onto the landing spot
        {
          stage: 'dash',
          rel: 'aim',
          center: 'point',
          delay: 0.45,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 7, width: 2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }],
          dash: { dir: 'right', distance: 7, duration: 0.16 },
        },
        { stage: 'return', center: 'point', delay: 0.75, telegraphLead: 0, area: { shape: 'line', length: 7, width: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5 }], charge: { distance: 7, duration: 0.16, stopAtCenter: true } },
        { stage: 'issen', rel: 'aim', center: 'point', offset: { x: 3.5, y: 0 }, delay: 1.1, telegraphLead: 0.25, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 9, width: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 4 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
      ],
    },
  },

  // ─────────────────────────── 버서커 ───────────────────────────
  berserker: {
    aim: {
      id: 'berserker_ua',
      name: '혈귀 돌진',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description:
        '겨눈 쪽으로 6칸 돌진(폭 2.6)하며 공격력 150% 피해 + 0.8초 기절, 0.7초에 멈춘 자리 반경 3.2에 공격력 120% 피해. 1.5초에 그 자리로 뛰어올라 내려찍기(반경 3.8): 공격력 220% 피해 + 0.6초 기절 + 1칸 넉백. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 끝날 무렵(8.25초) 주변 반경 3.5에 마무리 일격: 공격력 250% 피해 + 1.5칸 넉백.',
      finale: 'quake',
      sfx: { quake: [{ id: 'drag.berserker.slam', lead: 0.12 }, { id: 'drag.berserker.quake' }] },
      actions: [
        // the rush moves the berserker at once (the hit lands on the path at 0.45 s); the parts after it start where it
        // stopped. 기획 23차: stage 'split' (the ground splits along the rush: the drag skill's split sound)
        {
          stage: 'split',
          rel: 'aim',
          center: 'self',
          delay: 0.45,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 6, width: 2.6 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }],
          dash: { dir: 'right', distance: 6, duration: 0.2 },
        },
        { stage: 'frenzy', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: FRENZY },
        { stage: 'roar', center: 'self', delay: 0.7, area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }] },
        // 기획 23차 ★ 혈귀 낙하: it leaps up and slams down where the rush stopped ('self' with no follow = that spot, as
        // the preview draws it)
        {
          stage: 'quake',
          center: 'self',
          delay: 1.5,
          telegraphLead: 0.4,
          area: { shape: 'circle', radius: 3.8 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }, { kind: 'knockback', distance: 1 }],
        },
        // follow: lands where the berserker stands then, with its attack then (광란 +50% included)
        { stage: 'finale', center: 'self', follow: true, delay: 8.25, telegraphLead: 0.6, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'knockback', distance: 1.5 }] },
      ],
    },
    drag: {
      id: 'berserker_ud',
      name: '혈귀 대지분쇄',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'blink', maxRange: 9 },
      description:
        '끌어 놓은 곳으로 뛰어들어(최대 9칸) 반경 3에 공격력 120% 피해 + 0.5초 기절. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 0.7초에 뛰어든 쪽 부채꼴(반경 6.5, 110°)을 갈라 공격력 200% 피해 + 3초간 40% 둔화. 1.25초부터 갈라진 쪽 7칸 · 4.5칸 · 1.5칸 앞에서 착지 쪽으로 차례로 용암 분출:앞의 둘(반경 1.8, 2)은 각각 공격력 150% 피해, 마지막(반경 2.6)은 공격력 250% 피해 + 0.6초 기절, 모두 3초 화상(초당 공격력 20%).',
      finale: 'quake',
      // the three geysers: a thud each, a step up every time, the last one the quake. The thud file has a built-in
      // run-up (its row's lead 0.12): each is asked for 0.12 s before its geyser (기획 23차 검토), the quake on the blow
      sfx: { quake: { id: 'drag.berserker.slam', on: 'hit', step: 2, max: 3, last: 'drag.berserker.quake', lead: 0.12 } },
      actions: [
        // 기획 23차: stage 'slam' (the leap lands on it: the drag skill's slam sound)
        { stage: 'slam', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
        { stage: 'frenzy', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: FRENZY },
        // the crack runs the way the berserker leapt
        { stage: 'split', rel: 'aim', center: 'point', delay: 0.7, area: { shape: 'cone', dir: 'right', radius: 6.5, angle: 110 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'slow', duration: 3, value: 0.4 }] },
        // 기획 23차 (replaces the 10-cell aftershock cone): lava erupts three times along the crack, coming back toward the
        // landing — the last, the biggest ★, 1.5 cells ahead (on a boss it was dropped on)
        ...GEYSERS.map(
          ([x, delay, radius], i): SkillAction => ({
            stage: 'quake',
            rel: 'aim',
            center: 'point',
            offset: { x, y: 0 },
            delay,
            telegraphLead: 0.45,
            area: { shape: 'circle', radius },
            affects: 'enemies',
            effects:
              i < GEYSERS.length - 1
                ? [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'burn', duration: 3, value: 0.2 }]
                : [{ kind: 'damage', amount: 2.5 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }, { kind: 'status', status: 'burn', duration: 3, value: 0.2 }],
          }),
        ),
      ],
    },
  },

  // ─────────────────────────── 섀도우 ───────────────────────────
  shadow: {
    aim: {
      id: 'shadow_ua',
      name: '월영 질주',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      // 기획 23차 검토: the ★ crescent falls on the aimed point, so the aim may reach 8 cells (the rush's length)
      aimRange: 8,
      description:
        '겨눈 쪽으로 8칸 돌진(폭 2)해 꿰뚫으며 공격력 120% 피해 + 4초간 받는 피해 +25%. 0.6초부터 지나온 길 세 곳에 분신 폭발(반경 1.6): 각각 공격력 100% 피해. 1.4초에 겨눈 곳(8칸 안) 초승달 베기(반경 2.8): 공격력 280% 피해(치명타 확정) + 0.5초 기절.',
      finale: 'moon',
      actions: [
        // started BEFORE the rush moves it: 'self' = where it stood, so the clones sit on the band it cuts (even when
        // the rush is cut short by the arena edge and slides along it)
        ...SHADOW_CLONES.map(
          ([x, delay]): SkillAction => ({
            stage: 'dance',
            rel: 'aim',
            center: 'self',
            offset: { x, y: 0 },
            delay,
            telegraphLead: 0,
            area: { shape: 'circle', radius: 1.6 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 1 }],
          }),
        ),
        // passes through (a guard boss's weak back ends up in front of it); the parts after it start where it stopped
        {
          stage: 'dance',
          rel: 'aim',
          center: 'self',
          delay: 0.45,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 8, width: 2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.25 }],
          dash: { dir: 'right', distance: 8, duration: 0.16 },
        },
        // 기획 23차 검토: the crescent falls on the aimed point, at most 8 cells away (the preview's spot) — the rush still
        // runs its 8 cells toward it (it used to fall where the rush stopped: past a boss the shadow stood next to)
        { stage: 'moon', center: 'point', delay: 1.4, telegraphLead: 0.3, area: { shape: 'circle', radius: 2.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.8, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
      ],
    },
    drag: {
      id: 'shadow_ud',
      name: '흑월 대처형진',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'blink', maxRange: 9 },
      description:
        '끌어 놓은 곳에 나타나(최대 9칸) 대상 둘레 반경 3.5에 먹물 진: 공격력 60% 피해 + 4초간 받는 피해 +20%. 0.6초부터 1초까지 분신 여섯이 점점 빠르게 대상을 가로질러 벰(길이 9, 폭 1.8): 각각 공격력 50% 피해. 1.5초에 흑월: 대상에게 초승달 베기(반경 3): 공격력 280% 피해(치명타 확정) + 0.6초 기절.',
      finale: 'moon',
      // 기획 24차: 'clone' and 'dance' keep their rows (drag.shadow.clone; ult.shadow.dance on every cut, +1 step) — also
      // right with the switch off. The moon restates its row cue (an override replaces the row) and lays the X-cut under it.
      sfx: { moon: [{ id: 'ult.shadow.moon', lead: 0.35, duck: [-10, 0.35] }, { id: 'drag.shadow.execute', lead: 0.25, db: -6 }] },
      // 드래그 'target' = the enemy nearest the landing spot, else its own target (the preview shows the same one);
      // follow keeps every part on a moving boss
      actions: [
        { stage: 'clone', center: 'target', follow: true, delay: 0.45, telegraphLead: 0.3, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.2 }] },
        // the six cuts across its target, each turned from the way the shadow moved (rel 'aim')
        ...SHADOW_CUTS.map(
          ([rot, delay]): SkillAction => ({
            stage: 'dance',
            rel: 'aim',
            center: 'target',
            follow: true,
            delay,
            telegraphLead: 0,
            // 기획 24차 검토: 7 × 1.4 → 9 × 1.8 (bigger on the phone, a boss on the top row included)
            area: { shape: 'rect', dir: 'right', anchor: 'center', length: 9, width: 1.8, rot },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.5 }],
          }),
        ),
        { stage: 'moon', center: 'target', follow: true, delay: 1.5, telegraphLead: 0.4, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.8, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
      ],
    },
  },

  // ─────────────────────────── 레인저 ───────────────────────────
  ranger: {
    aim: {
      id: 'ranger_ua',
      name: '매의 화살비 · 천공 강하',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description:
        '겨눈 곳에 표적 화살(반경 2): 공격력 100% 피해 + 4초간 받는 피해 +15%. 화살비가 표적으로 좁혀 옴: 0.8초에 반경 3.6 공격력 160% 피해 + 2초간 30% 둔화, 1.05초에 반경 2.8 공격력 180% 피해, 1.3초에 반경 2 공격력 200% 피해. 1.9초에 빛의 매가 하늘 화살이 되어 내리꽂힘(반경 2): 공격력 600% 피해(치명타 확정) + 0.5초 기절.',
      finale: 'skyshot',
      // 기획 24차: the mark has no row of its own (the ranger's shot); a shot-up + pour per ring, rising; the row + the
      // hawk's swoop on the sky arrow. 기획 24차 검토: the swoop is dash.melee (an airy rush falling in pitch; effect bus
      // −14 + 4) — ult.ranger.tick's file is mostly a sub-40 Hz pulse (DC 0.08) that hit the limiter as the cast's
      // loudest sound
      sfx: {
        mark: { id: 'normal.ranger' },
        rain: { id: 'ult.ranger.rain', on: 'hit', step: 2, max: 3, lead: 0.3 },
        skyshot: [{ id: 'ult.ranger.skyshot', lead: 0.3 }, { id: 'dash.melee', lead: 0.45, db: 4 }],
      },
      actions: [
        { stage: 'mark', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.15 }] },
        ...HAWK_RAIN.map(
          ([radius, delay, amount], i): SkillAction => ({
            stage: 'rain',
            center: 'point',
            delay,
            telegraphLead: 0.25,
            area: { shape: 'circle', radius },
            affects: 'enemies',
            effects: i === 0 ? [{ kind: 'damage', amount }, { kind: 'status', status: 'slow', duration: 2, value: 0.3 }] : [{ kind: 'damage', amount }],
          }),
        ),
        { stage: 'skyshot', center: 'point', delay: 1.9, telegraphLead: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 6, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
      ],
    },
    drag: {
      id: 'ranger_ud',
      name: '매의 대일격',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'dash', maxRange: 9 },
      // a bot keeps its distance (a sniper never leaps next to the boss): it casts where it stands
      botAim: 'self',
      description:
        '끌어 놓은 곳으로 몸을 날려(최대 9칸) 대상 쪽 직선(길이 16, 폭 2.6)으로 0.5초부터 0.08초마다 화살 연사: 공격력 70% 피해 ×7. 1.1초에 화살 셋이 대상 둘레(반경 1.8)에 꽂혀 공격력 80% 피해 + 1.5초간 60% 둔화. 1.5초에 매와 함께 대상을 꿰뚫는 관통 일격(길이 16, 폭 3): 공격력 600% 피해(치명타 확정) + 1.5칸 넉백.',
      finale: 'pierce',
      sfx: {
        // the bow drawn at the cast, then a twang every other arrow (six at most)
        volley: [{ id: 'drag.ranger.draw', on: 'cast' }, { id: 'drag.ranger.volley', on: 'hit', step: 2, max: 6 }],
        // 기획 24차: the three arrows planted (the tether's snap + a soft shot); the row + the hawk's whoosh on the pierce
        // (기획 24차 검토: dash.melee, as 조준's swoop — not the broken ult.ranger.tick file)
        pin: [{ id: 'fx.tether' }, { id: 'normal.ranger', db: -4 }],
        pierce: [{ id: 'drag.ranger.pierce', lead: 0.25 }, { id: 'dash.melee', lead: 0.35, db: 4 }],
      },
      // 기획 23차: the drag skill's stages (its volley / pierce pictures and sounds)
      actions: [
        // 'line' = from the ranger (landed) through its target (the enemy nearest the landing spot, else its own target);
        // follow keeps both ends live. 기획 24차: 7 arrows (was 10); 검토: width 2 → 2.6 (a wider band on the phone)
        { stage: 'volley', center: 'target', follow: true, delay: 0.5, area: { shape: 'line', length: 16, width: 2.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.7 }], hits: 7, hitInterval: 0.08 },
        // 기획 24차: a slow, not a root — bosses are immune to root
        { stage: 'pin', center: 'target', follow: true, delay: 1.1, telegraphLead: 0, area: { shape: 'circle', radius: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.6 }] },
        // 기획 24차: 1.25 s → 1.5 s, width 1.6 → 2.2 (검토: → 3), a knock-back
        { stage: 'pierce', center: 'target', follow: true, delay: 1.5, telegraphLead: 0.4, area: { shape: 'line', length: 16, width: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 6, crit: 'always' }, { kind: 'knockback', distance: 1.5 }] },
      ],
    },
  },

  // ─────────────────────────── 메이지 ───────────────────────────
  mage: {
    aim: {
      id: 'mage_ua',
      name: '블리자드 · 빙결풍',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description:
        '겨눈 쪽 부채꼴(반경 8, 80°)에 2초간 0.4초마다 공격력 45% 피해 + 50% 둔화. 0.9초부터 부채꼴 안 다섯 곳에 고드름(반경 1.3)이 차례로 떨어짐: 각각 공격력 60% 피해 + 2초간 50% 둔화. 2.05초에 얼려 1초 기절 + 3초간 받는 피해 +25%, 2.45초에 깨지며 공격력 300% 피해.',
      finale: 'shatter',
      // an icy chime per icicle, a step up each
      sfx: { hail: { id: 'fx.frost', on: 'hit', step: 1, max: 5 } },
      // all parts on the fan from where the mage stood when it cast (no follow), like today's three on one spot. 기획 23차:
      // 4.85 s → 2.45 s (the blizzard 2 s, five icicles inside the fan in between, then freeze and shatter)
      actions: [
        { stage: 'blizzard', rel: 'aim', center: 'self', delay: 0.45, area: { shape: 'cone', dir: 'right', radius: 8, angle: 80 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.45 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }], zone: { duration: 2, tickInterval: 0.4 } },
        ...ICICLES.map(
          ([x, y, delay]): SkillAction => ({
            stage: 'hail',
            rel: 'aim',
            center: 'self',
            offset: { x, y },
            delay,
            telegraphLead: 0.25,
            area: { shape: 'circle', radius: 1.3 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 2, value: 0.5 }],
          }),
        ),
        { stage: 'freeze', rel: 'aim', center: 'self', delay: 2.05, telegraphLead: 0.4, area: { shape: 'cone', dir: 'right', radius: 8, angle: 80 }, affects: 'enemies', effects: [{ kind: 'status', status: 'stun', duration: 1, value: 0 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.25 }] },
        { stage: 'shatter', rel: 'aim', center: 'self', delay: 2.45, telegraphLead: 0, area: { shape: 'cone', dir: 'right', radius: 8, angle: 80 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }] },
      ],
    },
    drag: {
      id: 'mage_ud',
      name: '빙결 유성우',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'blink', maxRange: 9 },
      description:
        '끌어 놓은 곳에 나타나(최대 9칸) 둘레 여덟 곳(3칸)에 앞쪽부터 차례로 얼음 유성(반경 1.4): 각각 공격력 70% 피해 + 3초간 50% 둔화. 1.3초에 가운데 대빙성(반경 3): 공격력 400% 피해 + 1초 기절 + 3초간 받는 피해 +25%, 그 자리에 3초간 눈보라(반경 2.8, 0.5초마다 공격력 30% 피해 + 50% 둔화).',
      finale: 'shatter',
      // the rune drawn at the cast, an icy chime per hailstone (a step up each)
      sfx: { freeze: [{ id: 'drag.mage.sigil', on: 'cast', db: -4 }, { id: 'fx.frost', on: 'hit', step: 1, max: 8 }] },
      actions: [
        ...HAIL.map(
          ([x, y, delay]): SkillAction => ({
            stage: 'freeze',
            rel: 'aim',
            center: 'point',
            offset: { x, y },
            delay,
            area: { shape: 'circle', radius: 1.4 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.7 }, { kind: 'status', status: 'slow', duration: 3, value: 0.5 }],
          }),
        ),
        {
          stage: 'shatter',
          center: 'point',
          delay: 1.3,
          area: { shape: 'circle', radius: 3 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 4 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.25 }],
        },
        { stage: 'blizzard', center: 'point', delay: 1.3, telegraphLead: 0, area: { shape: 'circle', radius: 2.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }], zone: { duration: 3, tickInterval: 0.5 } },
      ],
    },
  },
};
