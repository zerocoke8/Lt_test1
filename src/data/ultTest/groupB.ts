// 기획 22차 궁극기 테스트 — 그룹 B의 캐릭터별 조준 / 드래그 궁극기 (docs/ult-test.md 5장).
// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 3장 B1–B14): every alt names its climax (`finale`), some stage cues are
// overridden (`sfx`), and the slow / climax-less ones were redesigned (클레릭 조준 대천사 강림, 클레릭 드래그 종 2초, 메딕 제세동
// 마무리 ×2, 퇴마사 교차 봉인 · 팔문 2.2 / 2초, 바드 포르티시모, 크로노 시곗바늘 + 시간 재개, 퍼펫티어 인형 던지기 / 끌어오기 2초 안팎).
// Characters (roster order): gunner 거너 · cleric 클레릭 · medic 메딕 · exorcist 퇴마사 · bard 바드 · chrono 크로노 ·
// puppeteer 퍼펫티어.
// A character missing here (or a missing aim / drag) uses the fallback (src/sim/ultTest.ts): 조준 = today's ult
// re-centred on the aimed point (area ults) or turned toward it (direction ults); 드래그 = blink to the point, today's ult.
// Only this file (and src/render/ultTest/groupB.ts) belongs to the group-B content track.
//
// What each one got (조준 = where / which way the button was dragged; 드래그 = an enhanced drag skill cast where it lands):
//   gunner    조준 포화 지원 · 이동 탄막        shells walk in from my side onto the point, then the heavy shell there (★ 1.9 s)
//             드래그 펌프 버스트 · 대구경 슬러그  dash, 3 shotgun cones the way it moved, slug + recoil back (★ 1.3 s)
//   cleric    조준 대천사 강림 · 조여드는 빛    big heal on the point, 3 light rings closing in, the archangel (★ 1.6 s)
//             드래그 성역의 종 · 천상의 울림    blink, cleanse + heal + 4 s sanctuary, the bell tolls twice, falls (★ 2 s)
//   medic     조준 골든 아워 · 응급 거점        heal + haste on the point, siren field charging twice, 「클리어!」 (★ 1.9 s)
//             드래그 코드 블루 · 긴급 출동      dash healing on the way, '+' heal, the cross charges twice, defib (★ 1.6 s)
//   exorcist  조준 봉마 결계 · 부적 장벽        a talisman wall across the aim, a seal along it at 1.1 s, 멸 on both (★ 2.2 s)
//             드래그 팔문 봉인진 · 백귀 결계    blink, seal ring (drain + root), eight gates open in turn, 멸 (★ 2 s)
//   bard      조준 음파 직격 · 포르티시모        a wide sound beam from the bard: 3 beats 0.35 s apart, fortissimo (★ 1.7 s)
//             드래그 공명 삼중주 · 피날레        dash, the drag skill's three up-down bands (bigger) + the forte (★ 1.1 s)
//   chrono    조준 시간 정지 · 시간의 늪        freeze on the point, three clock hands, 시간 재개 (★ 2.3 s), then 5 s mire
//             드래그 시간 균열 · 영겁의 역행    blink, X rift, rewind pull, freeze + the X again (★ 1.2 s)
//   puppeteer 조준 인형극 개막 · 커튼 라인      4 grand dolls tossed one by one across the aim, threads pull taut, curtain (★ 2 s)
//             드래그 대역 인형극 · 대공연        dash, 2 grand dolls tossed ahead, thread between, the yank, curtain (★ 1.9 s)
//
// Stage names: today's ult names (shells, heavy, grace, judgement, golden, siren, greatseal, storm, destroy, choir,
// encore, beat, stasis, open, charm, curtaincall) play today's ult sounds (src/audio/stages.ts, slot 'ult'); a name only
// in the drag skill's row (gunner blast1 / slug, cleric descend / sanctuary / bell, medic firstaid / defib, exorcist seal,
// bard beat1 / beat2 / forte, chrono rift / rewind / stop, puppeteer toss / thread) plays that drag cue
// (src/audio/director.ts); `sfx` overrides a stage (23차); any other name the role's default sound. Visuals are keyed
// `<id>:<stage>`: src/render/ultTest/groupB.ts tells each beat's story (기획 23차).
// Every delay ≥ ULT_TEST.firstHit (0.45, the cut-in rule). No part uses center 'target' (보이는 곳 = 맞는 곳).

import type { AreaShape, Effect, SkillAction } from '../../types';
import type { UltAltSet } from './types';
import { ULT_CAST_TIME } from './types';

/** 바드 드래그: an up-down band through the landing spot (the drag skill's band, longer reach kept). */
const band = (width: number): AreaShape => ({ shape: 'rect', dir: 'down', anchor: 'center', length: 12, width });
/** 바드 드래그: allies in a band. */
const BARD_UD_BUFF: Effect[] = [
  { kind: 'heal', amount: 0.15 },
  { kind: 'status', status: 'atkUp', duration: 10, value: 0.3 },
  { kind: 'status', status: 'haste', duration: 10, value: 0.4 },
];
/** 바드 드래그: enemies in a band. */
const BARD_UD_HIT: Effect[] = [
  { kind: 'damage', amount: 0.6 },
  { kind: 'status', status: 'slow', duration: 3, value: 0.4 },
];
/** 거너 조준: [offset toward the gunner (cells), delay] — the barrage walks onto the point (explicit, no float dust). */
const BARRAGE: readonly (readonly [number, number])[] = [
  [-6, 0.5],
  [-4.5, 0.7],
  [-3, 0.9],
  [-1.5, 1.1],
  [0, 1.3],
];
/** 퍼펫티어 조준: the four grand dolls, [across the aim line through the point, delay] — tossed one by one. */
const DOLL_TOSS: readonly (readonly [number, number])[] = [
  [-4.5, 0.45],
  [-1.5, 0.6],
  [1.5, 0.75],
  [4.5, 0.9],
];
/** 퍼펫티어: one 대형 종이 인형 (today's ult doll). */
const GRAND_DOLL: NonNullable<SkillAction['summon']> = { unitId: 'paper_doll_grand', count: 1, duration: 10, inherit: { hp: 0.65, atk: 1 } };
/** 퇴마사 조준: the wall, across the aim (rel 'aim' + dir 'down' = perpendicular to the caster → point line). */
const WALL: AreaShape = { shape: 'rect', dir: 'down', anchor: 'center', length: 9, width: 2 };
/** 퇴마사 조준: the seal along the aim, across the wall (rel 'aim' + dir 'right'). */
const SEAL_LINE: AreaShape = { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 };
/**
 * 퇴마사 드래그: the eight gates on a ring of 4, [x, y, delay] — k·45° clockwise from the way it moved (rel 'aim': +x =
 * ahead, +y = its right), 0.06 s apart (written out: no float dust in the delays).
 */
const GATES: readonly (readonly [number, number, number])[] = [
  [4, 0, 0.9],
  [2.83, 2.83, 0.96],
  [0, 4, 1.02],
  [-2.83, 2.83, 1.08],
  [-4, 0, 1.14],
  [-2.83, -2.83, 1.2],
  [0, -4, 1.26],
  [2.83, -2.83, 1.32],
];

export const GROUP_B: Record<string, UltAltSet> = {
  // ─────────────────────────── 거너 ───────────────────────────
  gunner: {
    aim: {
      id: 'gunner_ua',
      name: '포화 지원 · 이동 탄막',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      finale: 'heavy',
      description:
        '0.5초부터 겨눈 곳에서 내 쪽으로 6칸 떨어진 곳부터 겨눈 곳까지 포탄 5곳이 1.5칸씩 걸어 들어옴(반경 2.5): 각각 공격력 70% 피해 ×2. 1.9초에 겨눈 곳에 대구경 포탄(반경 3): 공격력 400% 피해 + 1.5칸 넉백 + 0.8초 기절.',
      actions: [
        // rel 'aim': −x = back toward the gunner, so the barrage walks in from its side onto the point
        ...BARRAGE.map(
          ([x, delay]): SkillAction => ({
            stage: 'shells',
            rel: 'aim',
            center: 'point',
            offset: { x, y: 0 },
            delay,
            area: { shape: 'circle', radius: 2.5 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.7 }],
            hits: 2,
            hitInterval: 0.1,
          }),
        ),
        {
          stage: 'heavy',
          center: 'point',
          delay: 1.9,
          telegraphLead: 0.45,
          area: { shape: 'circle', radius: 3 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 4 }, { kind: 'knockback', distance: 1.5 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }],
        },
      ],
    },
    drag: {
      id: 'gunner_ud',
      name: '펌프 버스트 · 대구경 슬러그',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'dash', maxRange: 7 },
      finale: 'slug',
      // 기획 23차: the drag skill's pump + blasts (the stage was 'shells': the incoming-shell whistle of the 조준 barrage)
      sfx: { blast1: [{ id: 'drag.gunner.pump', on: 'cast' }, { id: 'drag.gunner.blast', on: 'hit', step: -1, max: 3 }] },
      description:
        '끌어 놓은 곳까지 돌진(최대 7칸), 이동한 쪽으로 산탄 3연발(부채꼴 반경 6, 75°, 0.25초마다): 각각 공격력 170% 피해 + 1칸 넉백. 1.3초에 슬러그탄(길이 10, 폭 2): 공격력 400% 피해 + 2칸 넉백 + 0.8초 기절, 반동으로 1.5칸 뒤로 밀려남.',
      actions: [
        // center 'point' = the landing spot (the preview's spot): body separation may push the gunner off a boss it was
        // dropped on, the shots still start where it landed (a cone counts a body over its apex). Knockback without a
        // dir = away from the part's centre = forward
        {
          stage: 'blast1',
          rel: 'aim',
          center: 'point',
          delay: 0.45,
          area: { shape: 'cone', dir: 'right', radius: 6, angle: 75 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.7 }, { kind: 'knockback', distance: 1 }],
          hits: 3,
          hitInterval: 0.25,
        },
        // recoil: dash dir 'left' + rel 'aim' = straight back from the way it moved (from where it stands then). Stage
        // 'slug' = the drag skill's slug cue (today's ult 'heavy' is an incoming-shell whistle)
        {
          stage: 'slug',
          rel: 'aim',
          center: 'point',
          delay: 1.3,
          telegraphLead: 0.45,
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 10, width: 2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 4 }, { kind: 'knockback', distance: 2 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }],
          dash: { dir: 'left', distance: 1.5, duration: 0.15, atFire: true },
        },
      ],
    },
  },

  // ─────────────────────────── 클레릭 ───────────────────────────
  cleric: {
    aim: {
      id: 'cleric_ua',
      name: '대천사 강림 · 조여드는 빛',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      botAim: 'ally',
      finale: 'descend',
      sfx: { descend: [{ id: 'drag.cleric.descend' }, { id: 'heal.big', db: -4 }] },
      description:
        '겨눈 곳 반경 6 아군 HP 45% 회복 + 정화(넘친 회복은 보호막, 최대 HP 25%까지 6초) + 6초간 초당 HP 3% 재생 + 6초간 방어 +15%. 빛의 고리 3번이 겨눈 곳으로 조여듦(반경 7.5 / 5 / 2.5): 각각 공격력 80% 피해, 앞의 둘은 1.5칸 끌어당김, 마지막은 1.2초 기절. 1.6초에 대천사 강림: 반경 2.8 적 공격력 200% 피해 + 0.8초 기절, 반경 6 아군 HP 12% 회복.',
      actions: [
        {
          stage: 'grace',
          center: 'point',
          delay: 0.45,
          area: { shape: 'circle', radius: 6 },
          affects: 'allies',
          effects: [
            { kind: 'heal', amount: 0.45, overflowShield: { frac: 1, cap: 0.25, duration: 6 } },
            { kind: 'cleanse' },
            { kind: 'status', status: 'regen', duration: 6, value: 0.03 },
            { kind: 'status', status: 'defUp', duration: 6, value: 0.15 },
          ],
        },
        // full circles shrinking onto the point: a unit near the middle is hit by all three (today's 3 × 80%)
        { stage: 'judgement', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 7.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'pull', distance: 1.5 }] },
        { stage: 'judgement', center: 'point', delay: 0.7, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'pull', distance: 1.5 }] },
        { stage: 'judgement', center: 'point', delay: 0.95, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
        // 기획 23차: the archangel comes down on the point (the enemies there) and lights the allies around it
        {
          stage: 'descend',
          center: 'point',
          delay: 1.6,
          telegraphLead: 0.5,
          area: { shape: 'circle', radius: 2.8 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }],
        },
        { stage: 'descend', center: 'point', delay: 1.6, telegraphLead: 0, area: { shape: 'circle', radius: 6 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.12 }] },
      ],
    },
    drag: {
      id: 'cleric_ud',
      name: '성역의 종 · 천상의 울림',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      botAim: 'ally',
      move: { kind: 'blink', maxRange: 9 },
      finale: 'bell',
      sfx: { bell: [{ id: 'drag.cleric.bell', lead: 0.4 }, { id: 'ult.cleric.grace', db: -6 }] },
      description:
        '끌어 놓은 곳으로 순간 이동(최대 9칸). 반경 5 아군 정화 + HP 25% 회복(넘친 회복은 보호막, 최대 HP 20%까지 6초) + 6초간 방어 +15%. 4초간 성역: 0.5초마다 HP 4% 회복. 하늘에서 종이 내려오며 1초 · 1.4초에 울림(반경 5): 각각 공격력 60% 피해 + 1초간 40% 둔화. 2초에 큰 종: 반경 5 적에게 공격력 300% 피해 + 1.5초 기절, 아군 HP 12% 회복.',
      actions: [
        {
          stage: 'descend',
          center: 'point',
          delay: 0.45,
          area: { shape: 'circle', radius: 5 },
          affects: 'allies',
          effects: [
            { kind: 'cleanse' },
            { kind: 'heal', amount: 0.25, overflowShield: { frac: 1, cap: 0.2, duration: 6 } },
            { kind: 'status', status: 'defUp', duration: 6, value: 0.15 },
          ],
        },
        // the sanctuary stays where it landed (8 ticks, the first at creation)
        { stage: 'sanctuary', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.04 }], zone: { duration: 4, tickInterval: 0.5 } },
        // 기획 23차: the bell comes down from the sky (render) and tolls twice on its way, then falls at 2 s (was 4.5 s)
        { stage: 'judgement', center: 'point', delay: 1, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
        { stage: 'judgement', center: 'point', delay: 1.4, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
        { stage: 'bell', center: 'point', delay: 2, telegraphLead: 1, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
        { stage: 'bell', center: 'point', delay: 2, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.12 }] },
      ],
    },
  },

  // ─────────────────────────── 메딕 ───────────────────────────
  medic: {
    aim: {
      id: 'medic_ua',
      name: '골든 아워 · 응급 거점',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      botAim: 'ally',
      finale: 'defib',
      sfx: { charge: { id: 'drag.medic.defib', db: -10 } },
      description:
        '겨눈 곳 반경 4.5 아군 HP 30% 회복 + 6초간 공격 속도 +25%. 모든 플레이어의 대기 캐릭터 HP 40% 회복 + 쓰러진 캐릭터 부활 대기 20초 감소. 6초간 응급 거점: 1초마다 사이렌, 안의 아군 HP 5% 회복 + 정화. 1초 · 1.4초에 거점이 충전되며 안의 적 공격력 40% 피해 + 1초간 40% 둔화, 1.9초에 「클리어!」 제세동 십자(+, 상하좌우 6칸, 폭 2.4): 공격력 150% 피해 + 1초 기절, 반경 4.5 아군 HP 15% 회복.',
      actions: [
        { stage: 'golden', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 4.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.3 }, { kind: 'status', status: 'haste', duration: 6, value: 0.25 }] },
        // today's global part, unchanged
        {
          stage: 'golden',
          center: 'self',
          delay: 0.45,
          telegraphLead: 0,
          area: { shape: 'single' },
          affects: 'self',
          effects: [{ kind: 'benchHeal', amount: 0.4, allPlayers: true }, { kind: 'reviveReduce', seconds: 20, allPlayers: true }],
        },
        // the field: a siren per tick (6 ticks, the first at creation); the 'siren' cue sounds the first 3
        { stage: 'siren', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.05 }, { kind: 'cleanse' }], zone: { duration: 6, tickInterval: 1 } },
        // 기획 23차: the field charges twice (the enemies in it), then 「클리어!」 — the defib cross + a heal for the allies
        { stage: 'charge', center: 'point', delay: 1, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
        { stage: 'charge', center: 'point', delay: 1.4, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
        { stage: 'defib', center: 'point', delay: 1.9, telegraphLead: 0.5, area: { shape: 'cross', length: 6, width: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] },
        { stage: 'firstaid', center: 'point', delay: 1.9, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.15 }] },
      ],
    },
    drag: {
      id: 'medic_ud',
      name: '코드 블루 · 긴급 출동',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      botAim: 'ally',
      // the path heals every ally on the line from where she stood to where she lands (herself too), at 0.45 s
      move: { kind: 'dash', maxRange: 9, path: { width: 2.4, affects: 'allies', effects: [{ kind: 'heal', amount: 0.2 }, { kind: 'cleanse' }] } },
      finale: 'defib',
      sfx: { _path: { id: 'drag.medic.firstaid', db: -6 }, charge: { id: 'drag.medic.defib', db: -10 } },
      description:
        '끌어 놓은 곳까지 달려가며(최대 9칸) 지나간 길(폭 2.4) 아군 HP 20% 회복 + 정화. 도착 지점 십자(+, 상하좌우 5칸, 폭 2.4) 아군 HP 25% 회복, 모든 플레이어의 대기 캐릭터 HP 40% 회복 + 부활 대기 20초 감소. 0.85초 · 1.2초에 십자가 충전되며 안의 적 공격력 50% 피해 + 1초간 40% 둔화, 1.6초에 제세동: 공격력 150% 피해 + 1초 기절.',
      actions: [
        { stage: 'firstaid', center: 'point', delay: 0.45, area: { shape: 'cross', length: 5, width: 2.4 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.25 }] },
        {
          stage: 'golden',
          center: 'self',
          delay: 0.45,
          telegraphLead: 0,
          area: { shape: 'single' },
          affects: 'self',
          effects: [{ kind: 'benchHeal', amount: 0.4, allPlayers: true }, { kind: 'reviveReduce', seconds: 20, allPlayers: true }],
        },
        // 기획 23차: the cross charges twice, then the defib at 1.6 s (was 0.8 s)
        { stage: 'charge', center: 'point', delay: 0.85, telegraphLead: 0, area: { shape: 'cross', length: 5, width: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
        { stage: 'charge', center: 'point', delay: 1.2, telegraphLead: 0, area: { shape: 'cross', length: 5, width: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }] },
        { stage: 'defib', center: 'point', delay: 1.6, telegraphLead: 0.4, area: { shape: 'cross', length: 5, width: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] },
      ],
    },
  },

  // ─────────────────────────── 퇴마사 ───────────────────────────
  exorcist: {
    aim: {
      id: 'exorcist_ua',
      name: '봉마 결계 · 부적 장벽',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      finale: 'destroy',
      description:
        '겨눈 방향과 직각으로 겨눈 곳을 가로지르는 부적 벽(길이 9, 폭 2): 적 공격력 100% 피해 + 10초간 흡혼 표식(피해의 55%). 2초간 0.4초마다 공격력 25% 피해 + 50% 둔화. 1.1초에 겨눈 방향으로 벽을 가로지르는 봉인(길이 7, 폭 2): 공격력 80% 피해 + 10초간 흡혼 표식(피해의 55%). 2.2초에 두 줄 모두 멸(滅): 공격력 160% 피해 + 1.2초 기절, 겨눈 곳 반경 7 아군 HP 8% 회복.',
      actions: [
        { stage: 'greatseal', rel: 'aim', center: 'point', delay: 0.45, area: WALL, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'drain', duration: 10, value: 0.55 }] },
        // the wall stays (5 ticks, the first at creation); a rect zone keeps its turned footprint
        {
          stage: 'storm',
          rel: 'aim',
          center: 'point',
          delay: 0.45,
          telegraphLead: 0,
          area: WALL,
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }],
          zone: { duration: 2, tickInterval: 0.4 },
        },
        // 기획 23차: the seal along the aim, across the wall (a cross of talismans on the point)
        { stage: 'seal', rel: 'aim', center: 'point', delay: 1.1, telegraphLead: 0.3, area: SEAL_LINE, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'drain', duration: 10, value: 0.55 }] },
        // 멸 on both lines (the wall = the finisher: the bigger footprint), the allies healed around the point
        { stage: 'destroy', rel: 'aim', center: 'point', delay: 2.2, telegraphLead: 0.5, area: WALL, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
        { stage: 'destroy', rel: 'aim', center: 'point', delay: 2.2, telegraphLead: 0, area: SEAL_LINE, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
        { stage: 'destroy', center: 'point', delay: 2.2, telegraphLead: 0, area: { shape: 'circle', radius: 7 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }] },
      ],
    },
    drag: {
      id: 'exorcist_ud',
      name: '팔문 봉인진 · 백귀 결계',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'blink', maxRange: 9 },
      finale: 'destroy',
      sfx: { seal: { id: 'drag.exorcist.seal', on: 'hit', step: 1, max: 8 } },
      description:
        '끌어 놓은 곳으로 순간 이동(최대 9칸). 둘레 고리(안쪽 0.8 ~ 바깥 5.5)에 부적 결계: 공격력 130% 피해 + 10초간 흡혼 표식(피해의 60%) + 2초 속박. 2초간 부적 폭풍(반경 5.5, 0.4초마다 공격력 20% 피해). 0.9초부터 4칸 둘레 여덟 문이 차례로 열림(반경 1.3): 각각 공격력 50% 피해 + 10초간 흡혼 표식(피해의 60%). 2초에 멸(滅): 반경 5.5 적에게 공격력 180% 피해 + 1초 기절, 맞은 적 1명당 반경 6 아군 HP 4% 회복(최대 5명).',
      actions: [
        {
          stage: 'greatseal',
          center: 'point',
          delay: 0.45,
          area: { shape: 'ring', inner: 0.8, outer: 5.5 },
          affects: 'enemies',
          effects: [
            { kind: 'damage', amount: 1.3 },
            { kind: 'status', status: 'drain', duration: 10, value: 0.6 },
            { kind: 'status', status: 'root', duration: 2, value: 0 },
          ],
        },
        { stage: 'storm', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 5.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }], zone: { duration: 2, tickInterval: 0.4 } },
        // 기획 23차: eight gates open one after another on a ring of 4 (from the way it moved, clockwise)
        ...GATES.map(
          ([x, y, delay]): SkillAction => ({
            stage: 'seal',
            rel: 'aim',
            center: 'point',
            offset: { x, y },
            delay,
            telegraphLead: 0.25,
            area: { shape: 'circle', radius: 1.3 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'drain', duration: 10, value: 0.6 }],
          }),
        ),
        {
          stage: 'destroy',
          center: 'point',
          delay: 2,
          telegraphLead: 0.5,
          area: { shape: 'circle', radius: 5.5 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }],
          healPerHit: { radius: 6, amount: 0.04, maxHits: 5 },
        },
      ],
    },
  },

  // ─────────────────────────── 바드 ───────────────────────────
  bard: {
    aim: {
      id: 'bard_ua',
      name: '음파 직격 · 포르티시모',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      finale: 'forte',
      sfx: { beat: { id: 'ult.bard.beat', on: 'hit', max: 3 }, forte: [{ id: 'drag.bard.forte' }, { id: 'ult.bard.beat.last' }] },
      description:
        '겨눈 쪽 직선(길이 14, 폭 4)으로 음파: 띠 안 아군 HP 25% 회복 + 정화 + 10초간 공격력 +40% · 공격 속도 +30%, 적 0.35초마다 공격력 70% 피해 ×3 + 2초간 30% 둔화. 1.7초에 포르티시모(길이 14, 폭 5): 공격력 180% 피해 + 2칸 넉백 + 0.6초 기절. 모든 플레이어의 대기 캐릭터 10초간 공격력 +15% · 공격 속도 +15%.',
      // 'line' + center 'point': the band starts at the bard (she is in it) and points at the aimed point; a 'point' part
      // never re-centres, so every beat stays on the line it was aimed along
      actions: [
        {
          stage: 'choir',
          center: 'point',
          delay: 0.45,
          area: { shape: 'line', length: 14, width: 4 },
          affects: 'allies',
          effects: [
            { kind: 'heal', amount: 0.25 },
            { kind: 'cleanse' },
            { kind: 'status', status: 'atkUp', duration: 10, value: 0.4 },
            { kind: 'status', status: 'haste', duration: 10, value: 0.3 },
          ],
        },
        {
          stage: 'encore',
          center: 'self',
          delay: 0.45,
          telegraphLead: 0,
          area: { shape: 'single' },
          affects: 'self',
          effects: [
            { kind: 'benchStatus', status: 'atkUp', duration: 10, value: 0.15, allPlayers: true },
            { kind: 'benchStatus', status: 'haste', duration: 10, value: 0.15, allPlayers: true },
          ],
        },
        // 기획 23차: the beats 0.35 s apart (was 0.6), then the fortissimo along a wider band
        {
          stage: 'beat',
          center: 'point',
          delay: 0.45,
          area: { shape: 'line', length: 14, width: 4 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.7 }, { kind: 'status', status: 'slow', duration: 2, value: 0.3 }],
          hits: 3,
          hitInterval: 0.35,
        },
        {
          stage: 'forte',
          center: 'point',
          delay: 1.7,
          telegraphLead: 0.4,
          area: { shape: 'line', length: 14, width: 5 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'knockback', distance: 2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }],
        },
      ],
    },
    drag: {
      id: 'bard_ud',
      name: '공명 삼중주 · 피날레',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'dash', maxRange: 9 },
      finale: 'forte',
      sfx: { forte: [{ id: 'drag.bard.forte' }, { id: 'ult.bard.beat.last' }] },
      description:
        '끌어 놓은 곳까지 미끄러져 감(최대 9칸). 세로 띠(길이 12, 폭 3), 0.75초에 좌우 띠(±3칸): 아군 HP 15% 회복 + 10초간 공격력 +30%·공격 속도 +40%, 적 공격력 60% 피해 + 3초간 40% 둔화. 모든 플레이어의 대기 캐릭터 10초간 공격력 +15%·공격 속도 +15%. 1.1초에 가운데 띠(폭 4) 공격력 150% 피해 + 3초간 50% 둔화.',
      // the bands stay up-down like the drag skill's (aimed by where it lands, not by the way it moved). 기획 23차: the
      // drag skill's beat names (beat1 → beat2 left and right → forte), each with its own picture and cue
      actions: [
        { stage: 'choir', center: 'point', delay: 0.45, area: band(3), affects: 'allies', effects: BARD_UD_BUFF },
        { stage: 'beat1', center: 'point', delay: 0.45, area: band(3), affects: 'enemies', effects: BARD_UD_HIT },
        {
          stage: 'encore',
          center: 'self',
          delay: 0.45,
          telegraphLead: 0,
          area: { shape: 'single' },
          affects: 'self',
          effects: [
            { kind: 'benchStatus', status: 'atkUp', duration: 10, value: 0.15, allPlayers: true },
            { kind: 'benchStatus', status: 'haste', duration: 10, value: 0.15, allPlayers: true },
          ],
        },
        { stage: 'beat2', center: 'point', offset: { x: -3, y: 0 }, delay: 0.75, area: band(3), affects: 'enemies', effects: BARD_UD_HIT },
        { stage: 'beat2', center: 'point', offset: { x: 3, y: 0 }, delay: 0.75, area: band(3), affects: 'enemies', effects: BARD_UD_HIT },
        // the allies' twins of the side bands: no stage (one picture per band)
        { center: 'point', offset: { x: -3, y: 0 }, delay: 0.75, telegraphLead: 0, area: band(3), affects: 'allies', effects: BARD_UD_BUFF },
        { center: 'point', offset: { x: 3, y: 0 }, delay: 0.75, telegraphLead: 0, area: band(3), affects: 'allies', effects: BARD_UD_BUFF },
        { stage: 'forte', center: 'point', delay: 1.1, area: band(4), affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'slow', duration: 3, value: 0.5 }] },
      ],
    },
  },

  // ─────────────────────────── 크로노 ───────────────────────────
  chrono: {
    aim: {
      id: 'chrono_ua',
      name: '시간 정지 · 시간의 늪',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      finale: 'stop',
      sfx: { rift: { id: 'drag.chrono.rift', on: 'hit', step: 2, max: 3 }, stop: [{ id: 'drag.chrono.stop' }, { id: 'ult.chrono.resume' }], mire: null },
      description:
        '겨눈 곳 반경 5의 적 1.9초 정지(보스 · 중형보스는 짧게) + 5초간 받는 피해 +20%. 0.95초 · 1.35초에 시곗바늘(십자 +, X자, 상하좌우 5칸, 폭 1.4)이 지나가며 각각 공격력 60% 피해, 1.75초에 굵은 바늘(폭 2) 공격력 80% 피해. 2.3초에 시간 재개(반경 5): 공격력 200% 피해. 정지가 풀릴 때 정지 동안 받은 피해의 30%를 한꺼번에 다시 받음. 그 자리는 5초간 시간의 늪: 안의 적 60% 둔화 + 받는 피해 +20%, 안의 아군 공격 속도 +30%. 모든 플레이어의 대기 캐릭터 재등장 쿨 4초 감소.',
      actions: [
        // 기획 23차: the freeze ends at 2.35 s (was 2.5 s), right after 시간 재개 at 2.3 s (its damage is in the 30 % rebound)
        {
          stage: 'stasis',
          center: 'point',
          delay: 0.45,
          area: { shape: 'circle', radius: 5 },
          affects: 'enemies',
          effects: [{ kind: 'status', status: 'stasis', duration: 1.9, value: 0.3 }, { kind: 'status', status: 'vulnerable', duration: 5, value: 0.2 }],
        },
        // the mire slows and never freezes: a boss's stasis immunity starts only when its stasis ENDS (units.ts), so a
        // zone re-applying stasis would hold a boss for the whole zone. 기획 23차: stage 'mire' (its faint clock, half the
        // field wash; `sfx.mire = null` keeps its ticks silent)
        {
          stage: 'mire',
          center: 'point',
          delay: 0.45,
          telegraphLead: 0,
          area: { shape: 'circle', radius: 5 },
          affects: 'enemies',
          effects: [{ kind: 'status', status: 'slow', duration: 1, value: 0.6 }, { kind: 'status', status: 'vulnerable', duration: 1, value: 0.2 }],
          zone: { duration: 5, tickInterval: 0.5 },
        },
        { stage: 'mire', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'allies', effects: [{ kind: 'status', status: 'haste', duration: 1, value: 0.3 }], zone: { duration: 5, tickInterval: 0.5 } },
        { stage: 'stasis', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'swapCooldownReduce', seconds: 4, allPlayers: true }] },
        // 기획 23차: three clock hands sweep the frozen spot (+, X, a thick +), then 시간 재개
        { stage: 'rift', center: 'point', delay: 0.95, telegraphLead: 0.3, area: { shape: 'cross', length: 5, width: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }] },
        { stage: 'rift', center: 'point', delay: 1.35, telegraphLead: 0.3, area: { shape: 'cross', diagonal: true, length: 5, width: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }] },
        { stage: 'rift', center: 'point', delay: 1.75, telegraphLead: 0.3, area: { shape: 'cross', length: 5, width: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }] },
        { stage: 'stop', center: 'point', delay: 2.3, telegraphLead: 0.4, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] },
      ],
    },
    drag: {
      id: 'chrono_ud',
      name: '시간 균열 · 영겁의 역행',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'blink', maxRange: 9 },
      finale: 'stop',
      description:
        '끌어 놓은 곳으로 순간 이동(최대 9칸). X자 균열(대각선 5칸, 폭 1.8): 공격력 120% 피해 + 3초간 50% 둔화, 모든 플레이어의 대기 캐릭터 재등장 쿨 3초 감소. 0.8초에 반경 6 적 2.5칸 끌어당김. 1.2초에 반경 3.5 적 2초 정지(풀릴 때 받은 피해의 30% 다시) + X자(폭 2.4) 공격력 160% 피해 + 5초간 받는 피해 +20%.',
      actions: [
        { stage: 'rift', center: 'point', delay: 0.45, area: { shape: 'cross', diagonal: true, length: 5, width: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'slow', duration: 3, value: 0.5 }] },
        { stage: 'rift', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'swapCooldownReduce', seconds: 3, allPlayers: true }] },
        { stage: 'rewind', center: 'point', delay: 0.8, area: { shape: 'circle', radius: 6 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 2.5 }] },
        // the freeze first, then the X lands on the frozen ones (its damage is stored for the 30% rebound). 기획 23차: the
        // freeze keeps 'stasis' (the time-stop cue, its length read from this part: 2 s), the X is the drag skill's 'stop'
        { stage: 'stasis', center: 'point', delay: 1.2, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'status', status: 'stasis', duration: 2, value: 0.3 }] },
        {
          stage: 'stop',
          center: 'point',
          delay: 1.2,
          area: { shape: 'cross', diagonal: true, length: 5, width: 2.4 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'vulnerable', duration: 5, value: 0.2 }],
        },
      ],
    },
  },

  // ─────────────────────────── 퍼펫티어 ───────────────────────────
  puppeteer: {
    aim: {
      id: 'puppeteer_ua',
      name: '인형극 개막 · 커튼 라인',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      finale: 'curtaincall',
      sfx: { toss: { id: 'drag.puppeteer.toss', on: 'hit', step: 2, max: 4 }, thread: { id: 'drag.puppeteer.thread', db: -4 } },
      description:
        '겨눈 곳 반경 6 적 8초간 공격력 −35%, 일반 적 4마리까지 2.5초간 조종. 겨눈 방향과 직각으로 대형 인형 4개를 0.45초부터 하나씩 던져 한 줄로 세움(가운데에서 1.5칸 · 4.5칸, 떨어진 자리 반경 1.6 공격력 80% 피해, HP = 내 최대 HP 65%, 10초, 부서지면 반경 2.5 공격력 160% 피해). 1.2초에 인형 사이 실이 팽팽해짐(길이 12, 폭 2.4): 1.5칸 끌어당기고 공격력 80% 피해 + 2초간 40% 둔화. 2초에 커튼콜: 인형 줄(길이 12, 폭 4) 공격력 150% 피해 + 1초 기절.',
      actions: [
        { stage: 'open', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 6 }, affects: 'enemies', effects: [{ kind: 'status', status: 'atkDown', duration: 8, value: 0.35 }] },
        { stage: 'charm', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 6 }, affects: 'enemies', effects: [{ kind: 'status', status: 'charm', duration: 2.5, value: 0 }], maxTargets: 4 },
        // 기획 23차: the four dolls are tossed one by one (the same doll, the same spots: rel 'aim' y offsets = a row across
        // the aim line through the point; summons are clamped into the arena), each landing on whoever is there
        ...DOLL_TOSS.map(
          ([y, delay]): SkillAction => ({
            stage: 'toss',
            rel: 'aim',
            center: 'point',
            offset: { x: 0, y },
            delay,
            telegraphLead: 0,
            area: { shape: 'circle', radius: 1.6 },
            affects: 'enemies',
            effects: [{ kind: 'damage', amount: 0.8 }],
            summon: GRAND_DOLL,
          }),
        ),
        // the threads between the dolls pull taut (dir 'down' + rel 'aim' = along the doll row)
        {
          stage: 'thread',
          rel: 'aim',
          center: 'point',
          delay: 1.2,
          telegraphLead: 0,
          area: { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.4 },
          affects: 'enemies',
          effects: [{ kind: 'pull', distance: 1.5 }, { kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'slow', duration: 2, value: 0.4 }],
        },
        {
          stage: 'curtaincall',
          rel: 'aim',
          center: 'point',
          delay: 2,
          telegraphLead: 0.5,
          area: { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 4 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }],
        },
      ],
    },
    drag: {
      id: 'puppeteer_ud',
      name: '대역 인형극 · 대공연',
      slot: 'ult',
      castTime: ULT_CAST_TIME,
      move: { kind: 'dash', maxRange: 8 },
      finale: 'curtaincall',
      sfx: { yank: [{ id: 'ult.puppeteer.charm' }, { id: 'fx.pull', db: -4 }] },
      description:
        '끌어 놓은 곳까지 뛰어듦(최대 8칸). 반경 5 적 8초간 공격력 −35%. 이동한 쪽 1.5칸 앞 양옆 3칸에 대형 인형 둘(반경 2, HP = 내 최대 HP 65%, 10초): 공격력 180% 피해 + 1.2칸 끌어당김. 두 인형 사이 실(길이 6, 폭 1.4)이 6초간 1초마다 공격력 40% 피해 + 40% 둔화. 1.3초에 실을 당겨 반경 5 적을 2칸 끌어당기고 공격력 80% 피해. 1.9초에 커튼콜: 반경 5 공격력 120% 피해 + 1초 기절.',
      actions: [
        { stage: 'open', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'status', status: 'atkDown', duration: 8, value: 0.35 }] },
        // the two tosses, a little ahead (the way it moved) on both sides — landing just in front of an enemy flanks it:
        // the left first, the right 0.15 s later (like the drag skill); each leaves a grand doll. Stage 'toss' = the drag
        // skill's toss cue (today's ult 'dolls' is silent: its dolls only stand there)
        {
          stage: 'toss',
          rel: 'aim',
          center: 'point',
          offset: { x: 1.5, y: -3 },
          delay: 0.45,
          area: { shape: 'circle', radius: 2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'pull', distance: 1.2 }],
          summon: GRAND_DOLL,
        },
        {
          stage: 'toss',
          rel: 'aim',
          center: 'point',
          offset: { x: 1.5, y: 3 },
          delay: 0.6,
          telegraphLead: 0,
          area: { shape: 'circle', radius: 2 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'pull', distance: 1.2 }],
          summon: GRAND_DOLL,
        },
        // the thread between the two dolls (6 ticks, the first at creation)
        {
          stage: 'thread',
          rel: 'aim',
          center: 'point',
          offset: { x: 1.5, y: 0 },
          delay: 0.75,
          telegraphLead: 0,
          area: { shape: 'rect', dir: 'down', anchor: 'center', length: 6, width: 1.4 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1.2, value: 0.4 }],
          zone: { duration: 6, tickInterval: 1 },
        },
        // 기획 23차: the puppeteer yanks the strings (everyone around is pulled in), then the curtain at 1.9 s (was 3 s) — on
        // the landing spot (the preview's spot), not on wherever the puppeteer has walked by then
        { stage: 'yank', center: 'point', delay: 1.3, telegraphLead: 0, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 2 }, { kind: 'damage', amount: 0.8 }] },
        { stage: 'curtaincall', center: 'point', delay: 1.9, telegraphLead: 0.5, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] },
      ],
    },
  },
};
