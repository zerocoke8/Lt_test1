// 기획 22차 궁극기 테스트 — 그룹 A의 캐릭터별 조준 / 드래그 궁극기 (docs/ult-test.md 5장).
// Characters (roster order): guardian 가디언 · paladin 팔라딘 · warden 워든 · blade 블레이드 · berserker 버서커 ·
// shadow 섀도우 · ranger 레인저 · mage 메이지.
// A character missing here (or a missing aim / drag) uses the fallback (src/sim/ultTest.ts): 조준 = today's ult
// re-centred on the aimed point (area ults) or turned toward it (direction ults); 드래그 = blink to the point, today's ult.
// Only this file (and src/render/ultTest/groupA.ts) belongs to the group-A content track.
//
// What each one got (조준 = where / which way the button was dragged; 드래그 = an enhanced drag skill cast where it lands,
// rel 'aim' = the way it moved):
//   guardian  조준 성채 투척          every ally shielded, a thrown shield pulls the line onto the point, citadel + barrier there
//             드래그 성벽 대강림      dash (the path hits), slam + every ally shielded, a big wall ACROSS the dash (+ barrier)
//   paladin   조준 성창 심판          every ally healed + shielded, 8 spears walk toward the aim, the big '+' on the point (≤ 9)
//             드래그 축복의 돌격      dash: the path heals + shields the allies it crosses; a bigger brand + blessing, pillar
//   warden    조준 사슬 갈고리 · 철창  self shield, a 12-cell hook pulls the line in, cage + prison in front, release
//             드래그 사슬 대감옥      dash dragging the path along, hook ring at the landing, cage + fence, release
//   blade     조준 천검 · 검기 폭풍    stands: 10 sword waves in a cone toward the aim, then a 16-cell 대일섬 the same way
//             드래그 천검 삼연섬      dash there, 7 cells on through, back to the landing, the path bursts (질풍 삼연섬, bigger)
//   berserker 조준 혈귀 돌진          a 6-cell rush toward the aim (stun), a slam where it stops, 광란 8 s, the finale
//             드래그 혈귀 대지분쇄    blink (leap) there, slam + 광란, the crack and the aftershock the way it leapt
//   shadow    조준 월영 질주          an 8-cell pass-through toward the aim (mark), clones burst on the way, the crescent
//             드래그 그림자 대처형진  blink there, 4 clones ahead + the slide, the X, the crescent on its target
//   ranger    조준 매의 화살비        an arrow storm on the point, rain around it, the sky arrow in the middle
//             드래그 매의 대일격      a leap there, then a piercing volley + the pierce toward its target (bots stay put)
//   mage      조준 블리자드 · 빙결풍  the blizzard as a fan toward the aim (4 s), then freeze and shatter
//             드래그 빙결 유성우      blink there, 8 ice hailstones around (ahead first), the big ice star, a short blizzard
//
// Stage names reuse today's ult stages where the beat matches (they play today's ult sounds, src/audio/stages.ts slot
// 'ult'): aegis rally citadel barrier · sanctuary spear tribunal · chainstorm cage prison release · storm issen hop ·
// frenzy roar finale · vanish dance moon · barrage rain skyshot · blizzard freeze shatter. A name only in the drag
// skill's row (warden 'hook', berserker 'split') plays that drag cue (src/audio/director.ts); the rest (berserker
// 'rush') the role's default ult sound. Visuals are keyed `<id>:<stage>`, so every beat
// gets the generic landing wave in the character colour; src/render/ultTest/groupA.ts adds the finishers' accents.
// Every effect lands at ≥ ULT_TEST.firstHit (0.45 s, the cut-in rule); only movement (dash) happens at 0 s. No part uses
// center 'target' in 조준 (보이는 곳 = 맞는 곳: with nobody near the point it would jump to the caster's own target).

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
/** 섀도우 드래그: [offset ahead of the landing spot, delay] — four clones the way it came in, 2.2 cells / 0.08 s apart. */
const SHADOW_RUN: readonly (readonly [number, number])[] = [
  [0, 0.45],
  [2.2, 0.53],
  [4.4, 0.61],
  [6.6, 0.69],
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
        '모든 아군에게 보호막(최대 HP 30%, 8초). 겨눈 곳으로 방패를 던져 직선(길이 9, 폭 2.6)의 적을 그곳으로 3칸 끌어당기고 공격력 60% 피해 + 4초 도발. 0.85초에 겨눈 곳 반경 3.5에 성채 낙하: 공격력 250% 피해 + 1.5초 기절. 그 자리 반경 4에 6초간 결계(아군 방어 +30%, 적 30% 둔화).',
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
        '끌어 놓은 곳까지 돌진(최대 8칸)하며 지나간 길(폭 2.2)에 공격력 50% 피해. 착지 지점 반경 2.4에 공격력 100% 피해 + 0.8초 기절, 모든 아군에게 보호막(최대 HP 30%, 8초). 0.75초에 돌진 방향을 가로막는 성벽(길이 13, 폭 3): 공격력 220% 피해 + 1.5초 기절 + 4초 도발. 성벽은 6초간 남아 아군 방어 +30%, 적 40% 둔화.',
      actions: [
        { stage: 'rally', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
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
      actions: [
        { stage: 'sanctuary', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }, { kind: 'shield', amount: 0.2, duration: 6 }] },
        ...SPEARS.map(
          ([x, delay]): SkillAction => ({
            stage: 'spear',
            rel: 'aim',
            center: 'self',
            offset: { x, y: 0 },
            delay,
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
      move: { kind: 'dash', maxRange: 9, path: { width: 2.4, affects: 'allies', effects: [{ kind: 'heal', amount: 0.12 }, { kind: 'shield', amount: 0.25, duration: 6 }], stage: 'sanctuary' } },
      description:
        '끌어 놓은 곳까지 돌진(최대 9칸)하며 지나간 길(폭 2.4)의 아군 HP 12% 회복 + 보호막(최대 HP 25%, 6초). 착지 지점에 십자(+) 낙인(상하좌우 5칸, 폭 1.8): 공격력 80% 피해 + 5초간 받는 피해 +15%, 반경 4 아군 6초간 방어 +25%. 0.95초에 낙인 위로 빛기둥: 공격력 200% 피해 + 1.5초 기절, 가운데(반경 2)는 공격력 150% 피해 추가.',
      actions: [
        { stage: 'spear', center: 'point', delay: 0.45, area: P_BRAND, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'vulnerable', duration: 5, value: 0.15 }] },
        { stage: 'sanctuary', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 4 }, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 6, value: 0.25 }] },
        { stage: 'tribunal', center: 'point', delay: 0.95, area: P_BRAND, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
        { stage: 'tribunal', center: 'point', delay: 0.95, telegraphLead: 0, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }] },
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
        '자신에게 보호막(최대 HP 35%, 8초). 겨눈 쪽으로 사슬 갈고리(길이 12, 폭 2.4)를 던져 맞은 적을 8칸 끌어당기고 공격력 100% 피해 + 3초간 60% 둔화. 0.9초에 앞 1.5칸 반경 3에 철창 낙하: 공격력 300% 피해 + 2초 기절, 5초간 감옥(갇힌 적은 밖으로 못 나가고 0.5초마다 공격력 25% 피해 + 60% 둔화). 끝나면 반경 3.2 해방: 공격력 150% 피해 + 1.5칸 넉백.',
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
        // cage / prison / release just in front of where the warden stood at cast (where the catch piles up)
        { stage: 'cage', rel: 'aim', center: 'self', offset: { x: 1.5, y: 0 }, delay: 0.9, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 2, value: 0 }] },
        {
          stage: 'prison',
          rel: 'aim',
          center: 'self',
          offset: { x: 1.5, y: 0 },
          delay: 0.9,
          telegraphLead: 0,
          area: { shape: 'circle', radius: 3 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'slow', duration: 0.6, value: 0.6 }, { kind: 'status', status: 'tether', duration: 0.6, value: 3 }],
          zone: { duration: 5, tickInterval: 0.5 },
        },
        { stage: 'release', rel: 'aim', center: 'self', offset: { x: 1.5, y: 0 }, delay: 5.9, telegraphLead: 0.5, area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'knockback', distance: 1.5 }] },
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
      actions: [
        // NOT atFire on purpose: the blade already stands at landing + 7 when the return part is started (a charge fixes
        // its path at cast), so the return rushes back onto the landing spot
        {
          stage: 'hop',
          rel: 'aim',
          center: 'point',
          delay: 0.45,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 7, width: 2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }],
          dash: { dir: 'right', distance: 7, duration: 0.16 },
        },
        { stage: 'hop', center: 'point', delay: 0.75, telegraphLead: 0, area: { shape: 'line', length: 7, width: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5 }], charge: { distance: 7, duration: 0.16, stopAtCenter: true } },
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
        '겨눈 쪽으로 6칸 돌진(폭 2.6)하며 공격력 150% 피해 + 0.8초 기절, 0.7초에 멈춘 자리 반경 3.2에 공격력 120% 피해. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 끝날 무렵(8.25초) 주변 반경 3.5에 마무리 일격: 공격력 250% 피해 + 1.5칸 넉백.',
      actions: [
        // the rush moves the berserker at once (the hit lands on the path at 0.45 s); the parts after it start where it stopped
        {
          stage: 'rush',
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
        '끌어 놓은 곳으로 뛰어들어(최대 9칸) 반경 3에 공격력 120% 피해 + 0.5초 기절. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 0.7초에 뛰어든 쪽 부채꼴(반경 6.5, 110°)을 갈라 공격력 200% 피해 + 3초간 40% 둔화, 1.05초에 균열 끝까지 여진(반경 10, 45°) 공격력 150% 피해.',
      actions: [
        { stage: 'roar', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
        { stage: 'frenzy', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: FRENZY },
        // the crack runs the way the berserker leapt
        { stage: 'split', rel: 'aim', center: 'point', delay: 0.7, area: { shape: 'cone', dir: 'right', radius: 6.5, angle: 110 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'slow', duration: 3, value: 0.4 }] },
        { stage: 'finale', rel: 'aim', center: 'point', delay: 1.05, area: { shape: 'cone', dir: 'right', radius: 10, angle: 45 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }] },
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
      description:
        '겨눈 쪽으로 8칸 돌진(폭 2)해 꿰뚫으며 공격력 120% 피해 + 4초간 받는 피해 +25%. 0.6초부터 지나온 길 세 곳에 분신 폭발(반경 1.6): 각각 공격력 100% 피해. 1.4초에 멈춘 자리 초승달 베기(반경 2.8): 공격력 280% 피해(치명타 확정) + 0.5초 기절.',
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
        // no follow: the crescent lands where the rush stopped (the preview's spot), even if the shadow walks on after 0.5 s
        { stage: 'moon', center: 'self', delay: 1.4, telegraphLead: 0.3, area: { shape: 'circle', radius: 2.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.8, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
      ],
    },
    drag: {
      id: 'shadow_ud',
      name: '그림자 대처형진',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'blink', maxRange: 9 },
      description:
        '끌어 놓은 곳에 나타나(최대 9칸) 들어온 쪽으로 6.6칸 질주하며 분신 폭발 4번(반경 1.8): 각각 공격력 100% 피해 + 4초간 받는 피해 +20%. 1초에 가운데에 X자 처형(대각선 4칸, 폭 1.8): 공격력 200% 피해 + 0.5초 기절. 1.5초에 대상에게 초승달 베기(반경 2.5): 공격력 250% 피해(치명타 확정).',
      actions: [
        ...SHADOW_RUN.map(
          ([x, delay], i): SkillAction => ({
            stage: 'dance',
            rel: 'aim',
            center: 'point',
            ...(x ? { offset: { x, y: 0 } } : null),
            delay,
            ...(i ? { telegraphLead: 0 } : null),
            area: { shape: 'circle', radius: 1.8 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.2 }],
          }),
        ),
        // the shadow slides through its clones (movement only, from where it stands when it fires)
        { stage: 'vanish', rel: 'aim', center: 'self', delay: 0.75, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [], dash: { dir: 'right', distance: 6.6, duration: 0.16, atFire: true } },
        { stage: 'dance', rel: 'aim', center: 'point', offset: { x: 3.3, y: 0 }, delay: 1, area: { shape: 'cross', diagonal: true, length: 4, width: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
        // 드래그 'target' = the enemy nearest the landing spot, else its own target (the preview shows the same one);
        // follow keeps it on a moving boss
        { stage: 'moon', center: 'target', follow: true, delay: 1.5, telegraphLead: 0.3, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5, crit: 'always' }] },
      ],
    },
  },

  // ─────────────────────────── 레인저 ───────────────────────────
  ranger: {
    aim: {
      id: 'ranger_ua',
      name: '매의 화살비',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      description:
        '겨눈 곳 반경 2.5에 0.5초부터 0.08초마다 화살 폭풍 공격력 70% 피해 ×12. 1.6초에 반경 3.5에 화살비 공격력 40% 피해 ×5, 2.3초에 가운데 하늘 화살(반경 1.6): 공격력 450% 피해(치명타 확정).',
      actions: [
        { stage: 'barrage', center: 'point', delay: 0.5, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.7 }], hits: 12, hitInterval: 0.08 },
        { stage: 'rain', center: 'point', delay: 1.6, telegraphLead: 0.3, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.4 }], hits: 5, hitInterval: 0.1 },
        { stage: 'skyshot', center: 'point', delay: 2.3, telegraphLead: 0.3, area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 4.5, crit: 'always' }] },
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
        '끌어 놓은 곳으로 몸을 날려(최대 9칸) 대상 쪽 직선(길이 16, 폭 2)으로 0.5초부터 0.08초마다 화살 연사: 공격력 70% 피해 ×10. 1.25초에 대상을 꿰뚫는 관통 일격(길이 16, 폭 1.6): 공격력 600% 피해(치명타 확정).',
      actions: [
        // 'line' = from the ranger (landed) through its target (the enemy nearest the landing spot, else its own target);
        // follow keeps both ends live
        { stage: 'barrage', center: 'target', follow: true, delay: 0.5, area: { shape: 'line', length: 16, width: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.7 }], hits: 10, hitInterval: 0.08 },
        { stage: 'skyshot', center: 'target', follow: true, delay: 1.25, telegraphLead: 0.3, area: { shape: 'line', length: 16, width: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 6, crit: 'always' }] },
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
      description: '겨눈 쪽 부채꼴(반경 8, 80°)에 4초간 0.5초마다 공격력 45% 피해 + 50% 둔화. 끝나면 얼려 1초 기절 + 3초간 받는 피해 +25%, 4.85초에 깨지며 공격력 300% 피해.',
      // all three parts on the fan from where the mage stood when it cast (no follow), like today's three on one spot
      actions: [
        { stage: 'blizzard', rel: 'aim', center: 'self', delay: 0.45, area: { shape: 'cone', dir: 'right', radius: 8, angle: 80 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.45 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }], zone: { duration: 4, tickInterval: 0.5 } },
        { stage: 'freeze', rel: 'aim', center: 'self', delay: 4.45, telegraphLead: 0.5, area: { shape: 'cone', dir: 'right', radius: 8, angle: 80 }, affects: 'enemies', effects: [{ kind: 'status', status: 'stun', duration: 1, value: 0 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.25 }] },
        { stage: 'shatter', rel: 'aim', center: 'self', delay: 4.85, telegraphLead: 0, area: { shape: 'cone', dir: 'right', radius: 8, angle: 80 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }] },
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
