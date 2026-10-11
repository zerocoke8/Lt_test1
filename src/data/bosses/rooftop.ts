// 기획 19차 보스 레이드 — 옥상·이계 (16~20층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   tank_dweller 물탱크의 주인 (td_) · thunder_antenna 천둥 안테나 (ta_)
//   answering_pencil 대답하는 연필 (ap_) · inverted_moon 거꾸로 뜬 달 (im_)
// New summon-only units of this zone: (none — 외발 우산 is an existing monster) → ROOFTOP_UNITS (resolved by getMonster, never in a wave pool).
// 기획 20차 보스 형태: the four new bosses move (docs/bosses.md 1장 · 4-4) — see the block above ROOFTOP_BOSSES.
//
// Template for a FIXED boss (numbers: docs/bosses.md; helpers: ./helpers.ts — seq / sweep / band / row / rowR / at;
// a moving boss adds form / spawn / move / stage and uses arenaAt / ahead / chargeAt / safeRing instead — the four below):
//   {
//     id: '<boss_id>', name: '<이름>', tier: 'boss', color: '<palette base>', radius: 3, stationary: true, look: '<boss_id>',
//     stats: { maxHp: 0, atk: 0, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
//     basic: { kind: 'projectile', speed: 11 },
//     skills: [ /* 3 skills, ids with the boss's two-letter prefix (unique in the whole game) */ ],
//     phases: [{ hpBelow: 0.5, name: '<페이즈 이름>', atkSpeedMult: 1.15, cooldownMult: 0.85, skills: [ /* exactly one */ ] }],
//     groggy: { threshold: 1 },
//     enrage: ENRAGE,
//     lore: '<괴담 한 줄>',
//     zone: 'rooftop',
//   },
// Rule M1 (boss self-cast): a part with affects 'self' and a delay shows a yellow ring and is broken by groggy.
// Rule M2: telegraphLead on a part = the warning shows only for the last N s. Rule M4: a part's offset also moves its summon.
// Every hit on the party needs a delay (a warning) of at least 0.8 s. To take a boss out of the raid add `raid: false`
// to its entry (docs/boss-raid.md 3-1); after a number change run `npx vite-node tests/review/boss-table.ts write`.
// Checks: tests/sim/bosses-rooftop.test.ts → expectBossContract('<id>') (tests/sim/bossRaidHelpers.ts) + the boss's own
// pattern tests on raidGame('<id>', { hpMult: 50, tunables: { invincible: true } }).
// Tune one boss: npx vite-node tests/review/boss-raid-bench.ts BOSS=<id> RUNS=60

import type { BossDef, MonsterDef, SkillAction } from '../../types';
import { ENRAGE, arenaAt, chargeAt, safeRing, seq, sweep } from './helpers';

// 기획 20차 보스 형태 (docs/bosses.md 4-4): the four new bosses of this zone, one signature each —
//   물탱크의 주인  roaming · crawls after the nearest · 잠수: sinks and comes up BEHIND its target, then bursts
//   천둥 안테나    roaming · backs away from whoever is near · 접지: only the ring around the antenna itself is safe
//   대답하는 연필  arena · the whole floor is the paper · 대답: only the glowing word (예 ↔ 아니오) is safe; strokes stay
//   거꾸로 뜬 달   arena · the moon's reflection drifts round its path and never stops · 월식 gather ↔ 그믐 spread
// The classic boss above them (abyss_watcher) has no 기획 20차 field and is byte-for-byte as before.

// Every number of the four new bosses is in this file: the BossDef literals below plus the few named constants here
// (the parts a pattern repeats). Retune here only — docs/bosses.md 2장 is generated from this data
// (npx vite-node tests/review/boss-table.ts write); the art and the sounds read no pattern number.

// ── 물탱크의 주인: the hair ring that drags everyone in it to the body (머리카락, and the first beat of 끌어안기) ──
const HAIR = {
  /** The ring around the body: inside `inner` the hair does not reach. */
  inner: 3,
  outer: 9,
  /** Cells everyone in the ring is dragged toward the body. */
  pull: 4.5,
};
/** The hair ring landing after `delay`; `damage` (× attack) only when the pattern says so. */
const hairPull = (delay: number, damage = 0): SkillAction => ({
  center: 'self', area: { shape: 'ring', inner: HAIR.inner, outer: HAIR.outer }, affects: 'enemies', delay,
  effects: [...(damage > 0 ? [{ kind: 'damage' as const, amount: damage }] : []), { kind: 'pull', distance: HAIR.pull }],
});

// ── 천둥 안테나: a bolt on one character — it follows, and its warning only shows for the last BOLT_LEAD s (rule M2: ≥ 0.9) ──
const BOLT_LEAD = 0.9;
const bolt = (delay: number, amount: number): SkillAction => ({
  center: 'target', area: { shape: 'single' }, affects: 'enemies', follow: true, delay, telegraphLead: BOLT_LEAD,
  effects: [{ kind: 'damage', amount }],
});

// ── 대답하는 연필: the two words on the paper (also the floor art's anchors) and the ㅁ around the target ──
/** 「예」 and 「아니오」: where each word is written and how far around it is safe during 대답. */
const ANSWERS = [
  { id: 'yes', x: 5, y: 6, r: 3.2, label: '예' },
  { id: 'no', x: 19, y: 6, r: 3.2, label: '아니오' },
];
const ANSWER = { delay: 2.6, damage: 2.4 };
/** 대답: the whole paper is blacked out except the circle around word `i`. */
const answerAt = (i: number): SkillAction => ({
  ...arenaAt(ANSWERS[i].x, ANSWERS[i].y), area: safeRing(ANSWERS[i].r), affects: 'enemies', delay: ANSWER.delay,
  effects: [{ kind: 'damage', amount: ANSWER.damage }],
});
const BOX = {
  /** Distance from the target to each stroke's middle (the safe inside is 2 × half − width wide). */
  half: 3,
  /** Stroke size. */
  length: 7,
  width: 1.2,
  /** Damage of one stroke (× attack): ㅁ 긋기 / 틀린 답. */
  damage: 1.8,
  damageFast: 1.6,
  /** When each stroke lands (s after the cast): top, bottom, left, right — ㅁ 긋기 / 틀린 답. */
  delays: [1.2, 1.5, 1.8, 2.1],
  delaysFast: [1, 1.2, 1.4, 1.6],
};
/** One stroke of the ㅁ: sx / sy = which side of the target (−1 / 0 / +1), dir = the way it is drawn. */
const boxStroke = (sx: number, sy: number, dir: 'right' | 'down', delay: number, damage: number): SkillAction => ({
  center: 'target', offset: { x: sx * BOX.half, y: sy * BOX.half }, area: { shape: 'rect', dir, length: BOX.length, width: BOX.width, anchor: 'center' }, affects: 'enemies', delay,
  effects: [{ kind: 'damage', amount: damage }],
});
/** The four strokes of the ㅁ, landing at `delays` (top, bottom, left, right). */
const box = (delays: number[], damage: number): SkillAction[] => [
  boxStroke(0, -1, 'right', delays[0], damage), boxStroke(0, 1, 'right', delays[1], damage),
  boxStroke(-1, 0, 'down', delays[2], damage), boxStroke(1, 0, 'down', delays[3], damage),
];

// ── 거꾸로 뜬 달: 월식 (only the circle around the called one is safe) and its opposite 그믐 (a dark circle that follows them) ──
const MOON = {
  /** 월식: safe within this many cells of the called character. */
  light: 2.6,
  /** 그믐: the dark circle around the called character. */
  dark: 3.6,
  /** 뒤집힌 월식: the 그믐 that follows shows only for this long before it lands (right after the 월식 went off). */
  turnLead: 1.3,
};
/** 월식: everything outside the moonlight around the called character (where it stood at the cast) is hit. */
const eclipse = (delay: number, amount: number): SkillAction => ({
  center: 'target', area: safeRing(MOON.light), affects: 'enemies', delay, effects: [{ kind: 'damage', amount }],
});
/** 그믐: the dark circle follows the called character until it lands (`lead` = shown only for the last N s). */
const darkMoon = (delay: number, amount: number, lead?: number): SkillAction => ({
  center: 'target', area: { shape: 'circle', radius: MOON.dark }, affects: 'enemies', follow: true, delay,
  ...(lead != null ? { telegraphLead: lead } : null),
  effects: [{ kind: 'damage', amount }],
});

export const ROOFTOP_BOSSES: BossDef[] = [
  {
    // 20층 (옥상): 심연의 감시자 — 하늘에 뜬 거대한 눈 + 촉수. 원래 5층 보스, 기획 8차에 20층 최종 보스로.
    id: 'abyss_watcher', name: '심연의 감시자', tier: 'boss', color: '#3a0ca3', radius: 3, stationary: true, look: 'abyss_watcher',
    // 기획 8차 리뷰: HP 8000 → 7200 — 20층은 패턴보다 90초 광폭화 타이머에 지던 벽 (광폭화 42%, 그때 보스 HP ~9%)
    stats: { maxHp: 7200, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        id: 'boss_burst', name: '심연 폭발', cooldown: 8, initialDelay: 4,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 3 }] },
      },
      {
        id: 'boss_summon', name: '눈알 심기', cooldown: 16, initialDelay: 6,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'eye_stalk', count: 2, countMax: 3, duration: 0 } },
      },
      {
        id: 'boss_rift', name: '눈빛 광선', cooldown: 12, initialDelay: 10,
        action: { center: 'target', area: { shape: 'line', length: 16, width: 2.4 }, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 3.2 }] },
      },
      {
        // 촉수: 대상 둘레 고리가 먼저, 0.8초 뒤 가운데 내려찍기 (넉백)
        id: 'boss_tentacles', name: '촉수 난무', cooldown: 16, initialDelay: 14,
        ...seq([
          { center: 'target', area: { shape: 'ring', inner: 2, outer: 5 }, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 2.4 }] },
          { center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 2.4, effects: [{ kind: 'damage', amount: 2.8 }, { kind: 'knockback', distance: 2 }] },
        ]),
      },
    ],
    phases: [
      {
        hpBelow: 0.6, name: '심연의 눈 뜸', cooldownMult: 0.85,
        skills: [
          {
            id: 'boss_beams', name: '광선 소사', cooldown: 13, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'line', length: 16, width: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.6 }] }, [{ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }], 1.2, 0.3)),
          },
        ],
      },
      {
        hpBelow: 0.3, name: '심연 개방', atkSpeedMult: 1.4, cooldownMult: 0.7,
        skills: [
          {
            // 보스를 둘러싼 큰 고리 (아레나 가운데 띠) → 대상 자리 폭발
            id: 'boss_abyss_ring', name: '심연 개방', cooldown: 14, initialDelay: 1.5,
            ...seq([
              { center: 'self', area: { shape: 'ring', inner: 6, outer: 9.5 }, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 2.4 }] },
              { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', delay: 2.4, effects: [{ kind: 'damage', amount: 2.6 }] },
            ]),
          },
        ],
      },
    ],
    // 기획 13차 보스 그로기: gauge ×1.1 (최종 보스)
    groggy: { threshold: 1.1 },
    enrage: ENRAGE,
    // 기획 19차 보스 레이드: the one-line 괴담 + the zone (the only additions; numbers unchanged)
    lore: '잠겨 있던 옥상 문이 열려 있다. 하늘이 눈을 뜨고 있다.',
    zone: 'rooftop',
  },
  {
    // 기획 20차: 물탱크의 주인 — 배회형. 탱크에서 기어 나온 긴 머리의 물귀신: 느리게 기어 오다가 웅덩이로 꺼져 등 뒤에서 솟음.
    id: 'tank_dweller', name: '물탱크의 주인', tier: 'boss', color: '#8ecae6', radius: 1.6, look: 'tank_dweller',
    // 등장: 오른쪽 아래 구석 (기획 20차 통합: 움직이는 보스가 또 맨 위 가운데에 몰려서 옮김)
    form: 'roaming', spawn: { x: 19.5, y: 8.5 }, move: { mode: 'pursue' }, signature: 'td_dive',
    stats: { maxHp: 7600, atk: 30, def: 0.2, atkSpeed: 0.5, range: 1.2, moveSpeed: 1.3, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        // 웅덩이로 꺼졌다가 대상 등 뒤에서 솟음 (시전 순간 순간이동) → 몸 둘레 폭발 + 솟은 자리에 남는 웅덩이
        id: 'td_dive', name: '잠수', cooldown: 12, initialDelay: 5,
        hint: '등 뒤에서 솟아요 — 멀리 꺼내세요',
        ...seq([
          { center: 'self', blink: { offset: 0.3, behind: true }, area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1.4, effects: [{ kind: 'damage', amount: 2.6 }] },
          {
            // 기획 20차 점검: 반지름 2.4 → 2.0 — 2.4는 근접이 때리는 자리(몸 1.6 + 0.45 + 사거리 0.6)를 전부 덮어 피할 길이 없었음
            center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 1.5,
            effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'slow', duration: 1, value: 0.3 }], zone: { duration: 5, tickInterval: 0.5 },
          },
        ]),
      },
      {
        // 몸 둘레 고리 안의 모두를 보스 쪽으로 끌어옴 (바로 곁 3칸 안과 9칸 밖은 안 닿음)
        id: 'td_hair', name: '머리카락', cooldown: 11, initialDelay: 9,
        hint: '끌려가기 직전에 교체하세요',
        action: hairPull(1.3, 1.2),
      },
      {
        id: 'td_umbrellas', name: '우산 손님', cooldown: 14, initialDelay: 7,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'slime', count: 4, countMax: 6, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '역류', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 끌어온 다음 몸 둘레를 터뜨림
            id: 'td_hug', name: '끌어안기', cooldown: 12, initialDelay: 1.5,
            hint: '끌린 뒤 바로 빼세요 — 곧 터져요',
            ...seq([hairPull(1.2), { center: 'self', area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', delay: 1.9, effects: [{ kind: 'damage', amount: 2.6 }] }]),
          },
        ],
      },
    ],
    groggy: { threshold: 0.9 },
    enrage: ENRAGE,
    lore: '옥상 물탱크 물이 자꾸 짠맛이 난다. 뚜껑을 열어 본 사람은 비 오는 날에만 보인다.',
    zone: 'rooftop',
  },
  {
    // 기획 20차: 천둥 안테나 — 배회형. 안테나 다리로 걷는 낡은 브라운관: 가까이 오면 물러나고(4~7칸 유지), 뇌우 때는 제 곁만 안전.
    id: 'thunder_antenna', name: '천둥 안테나', tier: 'boss', color: '#343a40', radius: 1.4, look: 'thunder_antenna',
    form: 'roaming', spawn: { x: 5, y: 3 }, move: { mode: 'keepAway', keep: { min: 4, max: 7 } }, signature: 'ta_ground',
    stats: { maxHp: 7000, atk: 32, def: 0.2, atkSpeed: 0.6, range: 40, moveSpeed: 1.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      { id: 'ta_bolt', name: '낙뢰', cooldown: 8, initialDelay: 3, hint: '번쩍 보이면 바로 교체', action: bolt(1.5, 3.2) },
      {
        // 옥상 전체 뇌우 — 보스 몸 둘레 3.4칸 안만 안전 (준비하는 동안 보스는 안 물러남)
        id: 'ta_ground', name: '접지', cooldown: 14, initialDelay: 7,
        hint: '보스에 딱 붙여 꺼내세요',
        action: { center: 'self', area: safeRing(3.4), affects: 'enemies', delay: 2.2, effects: [{ kind: 'damage', amount: 2.6 }] },
      },
      {
        id: 'ta_crackle', name: '지직', cooldown: 10, initialDelay: 10,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.3, diagonal: true }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.4 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '채널 고정', atkSpeedMult: 1.2, cooldownMult: 0.85,
        skills: [{ id: 'ta_double_bolt', name: '두 번 낙뢰', cooldown: 11, initialDelay: 1.5, hint: '첫 번개를 피해도 한 번 더 와요', ...seq([bolt(1.3, 2.6), bolt(1.9, 2.6)]) }],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '옥상 TV 안테나는 채널이 없는 방송을 받는다. 번개가 칠 때마다 누군가의 이름을 한 번씩 부른다.',
    zone: 'rooftop',
  },
  {
    // 기획 20차: 대답하는 연필 — 전장형. 맵 전체가 분신사바 종이, 두 손이 잡은 연필(핵)이 그 위를 천천히 미끄러짐. 큰 이동은 「긋기」로만.
    id: 'answering_pencil', name: '대답하는 연필', tier: 'boss', color: '#ffd166', radius: 1.4, look: 'answering_pencil',
    form: 'arena', spawn: { x: 12, y: 4 }, move: { mode: 'pursue' }, signature: 'ap_answer',
    stage: { floor: 'paper', marks: ANSWERS },
    stats: { maxHp: 8200, atk: 30, def: 0.2, atkSpeed: 0.55, range: 1, moveSpeed: 0.8, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        // 대상 쪽으로 13칸을 그으며 돌진 — 그은 선이 10초 남음 (1칸마다 작은 원)
        id: 'ap_stroke', name: '긋기', cooldown: 8, initialDelay: 4,
        hint: '그은 선은 남아요 — 교체로 넘어가기',
        action: chargeAt({
          distance: 13, width: 1.4, delay: 1.2, effects: [{ kind: 'damage', amount: 2.2 }],
          trail: { radius: 0.6, spacing: 1, duration: 10, tickInterval: 0.5, look: 'graphite', effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.25 }] },
        }),
      },
      {
        // 대상 둘레에 네모 획 넷: 가로 위 · 아래, 세로 왼 · 오른 (안쪽 4.8 × 4.8이 안전)
        id: 'ap_box', name: 'ㅁ 긋기', cooldown: 12, initialDelay: 7,
        hint: '네모 안쪽이 안전해요',
        ...seq(box(BOX.delays, BOX.damage)),
      },
      {
        // 종이 전체가 까맣게 — 빛나는 글자 둘레만 안전. 「예」와 「아니오」가 번갈아 (규칙 N7)
        id: 'ap_answer', name: '대답', cooldown: 13, initialDelay: 10,
        hint: '빛나는 글자 위로 꺼내세요',
        action: answerAt(0),
        cycle: [{ action: answerAt(1) }],
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '대답', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 빠른 네모 → 네모 가운데를 찍음 (이번엔 안쪽이 위험)
            id: 'ap_wrong', name: '틀린 답', cooldown: 12, initialDelay: 1.5,
            hint: '이번엔 네모 밖으로 교체',
            ...seq([
              ...box(BOX.delaysFast, BOX.damageFast),
              { center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 2.6, effects: [{ kind: 'damage', amount: 2.8 }] },
            ]),
          },
        ],
      },
    ],
    groggy: { threshold: 1.1 },
    enrage: ENRAGE,
    lore: '분신사바, 분신사바. 종이 위 연필이 혼자 움직이면 사람 이름을 쓰기 시작한다.',
    loreShort: '연필이 혼자 움직이면 이름을 쓰기 시작한다.',
    zone: 'rooftop',
  },
  {
    // 기획 20차: 거꾸로 뜬 달 — 전장형. 바닥에 비친 달(핵, 납작해서 캐릭터를 안 가림)이 제 길로 떠다님, 패턴 중에도 안 멈춤.
    id: 'inverted_moon', name: '거꾸로 뜬 달', tier: 'boss', color: '#f1faee', radius: 1.8, look: 'inverted_moon',
    form: 'arena', spawn: { x: 6, y: 3.5 }, stage: { floor: 'moon' }, signature: 'im_eclipse',
    move: { mode: 'path', waypoints: [{ x: 6, y: 3.5 }, { x: 18, y: 3.5 }, { x: 18, y: 8.5 }, { x: 6, y: 8.5 }], castMove: true },
    stats: { maxHp: 7400, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0.9, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 모여라: 불린 사람 둘레 2.6칸 안만 안전 — 바깥 고리가 아레나 전체를 덮음
        id: 'im_eclipse', name: '월식', cooldown: 14, initialDelay: 5,
        hint: '달빛 안만 안전 — 불린 사람 곁으로',
        action: eclipse(2.2, 2.6),
      },
      {
        // 흩어져라: 불린 사람을 따라가는 어두운 원 — 곁에 있으면 같이 맞음
        id: 'im_dark', name: '그믐', cooldown: 12, initialDelay: 9,
        hint: '흩어지세요 — 불린 캐릭터는 빼기',
        action: darkMoon(2.2, 2.4),
      },
      {
        // 대상 네 귀퉁이를 차례로 (가운데는 안전)
        id: 'im_hands', name: '그림자 손', cooldown: 10, initialDelay: 3,
        ...seq(sweep(
          { center: 'target', area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }] },
          [{ x: -2.4, y: -2.4 }, { x: 2.4, y: -2.4 }, { x: 2.4, y: 2.4 }, { x: -2.4, y: 2.4 }], 1.1, 0.15,
        )),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '붉은 달', cooldownMult: 0.85,
        skills: [
          {
            // 월식 → 바로 그믐 (모였다가 흩어짐): 그믐의 예고는 월식이 터진 직후에야 보임
            id: 'im_turn', name: '뒤집힌 월식', cooldown: 14, initialDelay: 1.5,
            hint: '모였다가 바로 흩어지세요',
            ...seq([eclipse(2, 2.2), darkMoon(3.4, 2.2, MOON.turnLead)]),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '옥상에서 보는 달은 거꾸로 떠 있다. 달빛이 닿는 자리만 안전하고, 그림자 진 곳에선 뒤에서 누가 숨을 쉰다.',
    zone: 'rooftop',
  },
];

/** Summon-only units of this zone's bosses (tier 'summon' or 'normal'; look = the key in render/bosses/rooftop.ts ROOFTOP_MINION_LOOKS). */
export const ROOFTOP_UNITS: MonsterDef[] = [];
