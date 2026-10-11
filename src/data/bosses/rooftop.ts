// 기획 19차 보스 레이드 — 옥상·이계 (16~20층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   tank_dweller 물탱크의 주인 (td_) · thunder_antenna 천둥 안테나 (ta_)
//   answering_pencil 대답하는 연필 (ap_) · inverted_moon 거꾸로 뜬 달 (im_)
// New summon-only units of this zone: (none — 외발 우산 / 그림자 아이 / 붉은 마스크 are existing monsters) → ROOFTOP_UNITS (resolved by getMonster, never in a wave pool).
//
// Template for a new boss (numbers: docs/bosses.md; helpers: ./helpers.ts — seq / sweep / band / row / rowR / at):
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
import { ENRAGE, row, seq, sweep } from './helpers';

// Every number of the four new bosses is in this file: the BossDef literals below plus the few named constants here
// (the parts a pattern repeats). Retune here only — docs/bosses.md 2장 is generated from this data
// (npx vite-node tests/review/boss-table.ts write); the art and the sounds read no pattern number.

// ── 물탱크의 주인: water rows across the whole floor (범람 top-down, 거꾸로 범람 bottom-up) ──
const FLOOD = {
  /** World y of each row's middle, top to bottom (4 rows × width 3 = the 12-high arena). */
  rows: [1.5, 4.5, 7.5, 10.5],
  /** Row size: the arena's full width, 3 high. */
  length: 24,
  width: 3,
  /** Damage of one row (× attack). */
  damage: 2,
  /** When each row lands (s after the cast), in the order the rows are hit: 범람 / 거꾸로 범람. */
  delays: [1.4, 1.85, 2.3, 2.75],
  delaysUp: [1.2, 1.6, 2, 2.4],
};
/** One water row at world y, landing after `delay`. */
const floodRow = (y: number, delay: number): SkillAction => ({
  center: 'self', offset: row(y), area: { shape: 'rect', dir: 'right', length: FLOOD.length, width: FLOOD.width }, affects: 'enemies', delay,
  effects: [{ kind: 'damage', amount: FLOOD.damage }],
});

// ── 천둥 안테나: a bolt on one character — it follows, and its warning only shows for the last BOLT_LEAD s (rule M2: ≥ 0.9) ──
const BOLT_LEAD = 0.9;
const bolt = (delay: number, amount: number): SkillAction => ({
  center: 'target', area: { shape: 'single' }, affects: 'enemies', follow: true, delay, telegraphLead: BOLT_LEAD,
  effects: [{ kind: 'damage', amount }],
});

// ── 대답하는 연필: the ㅁ around the target — four strokes, each centred `half` away from the target ──
const BOX = {
  /** Distance from the target to each stroke's middle (the safe inside is 2 × half − width wide). */
  half: 3,
  /** Stroke size. */
  length: 7,
  width: 1.2,
  /** Damage of one stroke (× attack). */
  damage: 1.8,
  /** When each stroke lands (s after the cast): top, bottom, left, right. */
  delays: [1.2, 1.5, 1.8, 2.1],
};
/** One stroke of the ㅁ: sx / sy = which side of the target (−1 / 0 / +1), dir = the way it is drawn. */
const boxStroke = (sx: number, sy: number, dir: 'right' | 'down', delay: number): SkillAction => ({
  center: 'target', offset: { x: sx * BOX.half, y: sy * BOX.half }, area: { shape: 'rect', dir, length: BOX.length, width: BOX.width, anchor: 'center' }, affects: 'enemies', delay,
  effects: [{ kind: 'damage', amount: BOX.damage }],
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
    // 기획 19차 (앞): 물탱크의 주인 — 녹슨 옥상 물탱크, 뚜껑 틈의 머리카락과 손. 물결 줄을 차례로 피하는 보스.
    id: 'tank_dweller', name: '물탱크의 주인', tier: 'boss', color: '#8ecae6', radius: 3, stationary: true, look: 'tank_dweller',
    stats: { maxHp: 7600, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 가로 물결 4줄이 위 → 아래로 (지나간 줄이 안전)
        id: 'td_flood', name: '범람', cooldown: 13, initialDelay: 4,
        hint: '물결이 위에서 아래로 — 지나간 줄로 교체해서 피하세요',
        ...seq(FLOOD.rows.map((y, i) => floodRow(y, FLOOD.delays[i]))),
      },
      {
        // 남는 소용돌이: 0.5초마다 약한 피해 + 가운데로 0.5칸 끌기 (규칙 M3)
        id: 'td_drain', name: '배수구', cooldown: 12, initialDelay: 8,
        action: {
          center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1,
          effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'pull', distance: 0.5 }], zone: { duration: 4, tickInterval: 0.5 },
        },
      },
      {
        id: 'td_umbrellas', name: '우산 손님', cooldown: 14, initialDelay: 6,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'slime', count: 4, countMax: 6, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '역류', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 같은 4줄이 아래 → 위로
            id: 'td_flood_up', name: '거꾸로 범람', cooldown: 13, initialDelay: 1.5,
            ...seq([...FLOOD.rows].reverse().map((y, i) => floodRow(y, FLOOD.delaysUp[i]))),
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
    // 기획 19차 (앞): 천둥 안테나 — 비뚤어진 TV 안테나와 낡은 브라운관. 소환 없이 짧은 예고(0.9초)의 낙뢰로 압박.
    id: 'thunder_antenna', name: '천둥 안테나', tier: 'boss', color: '#343a40', radius: 3, stationary: true, look: 'thunder_antenna',
    stats: { maxHp: 7000, atk: 32, def: 0.2, atkSpeed: 0.6, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      { id: 'ta_bolt', name: '낙뢰', cooldown: 7, initialDelay: 3, action: bolt(1.5, 3.2) },
      {
        id: 'ta_static', name: '정전기', cooldown: 11, initialDelay: 6,
        action: {
          center: 'target', area: { shape: 'ring', inner: 2, outer: 6 }, affects: 'enemies', delay: 1.4,
          effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }],
        },
      },
      {
        id: 'ta_crackle', name: '지직', cooldown: 10, initialDelay: 9,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.3, diagonal: true }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.4 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '채널 고정', atkSpeedMult: 1.2, cooldownMult: 0.85,
        skills: [{ id: 'ta_double_bolt', name: '두 번 낙뢰', cooldown: 11, initialDelay: 1.5, ...seq([bolt(1.3, 2.6), bolt(1.9, 2.6)]) }],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '옥상 TV 안테나는 채널이 없는 방송을 받는다. 번개가 칠 때마다 누군가의 이름을 한 번씩 부른다.',
    zone: 'rooftop',
  },
  {
    // 기획 19차 (중): 대답하는 연필 — 분신사바. 모눈 종이 위의 큰 연필이 글자 획으로 공격. 소환 없음.
    id: 'answering_pencil', name: '대답하는 연필', tier: 'boss', color: '#ffd166', radius: 3, stationary: true, look: 'answering_pencil',
    stats: { maxHp: 8200, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 대상 둘레에 네모 획 넷: 가로 위 · 아래, 세로 왼 · 오른 (안쪽 4.8 × 4.8이 안전)
        id: 'ap_box', name: 'ㅁ 긋기', cooldown: 12, initialDelay: 4,
        hint: '네모 안쪽은 안전 — 밖에 있으면 안으로 교체',
        ...seq([boxStroke(0, -1, 'right', BOX.delays[0]), boxStroke(0, 1, 'right', BOX.delays[1]), boxStroke(-1, 0, 'down', BOX.delays[2]), boxStroke(1, 0, 'down', BOX.delays[3])]),
      },
      {
        // 속박: 걸어서는 못 피함 → 교체로
        id: 'ap_pin', name: '틀린 답', cooldown: 11, initialDelay: 7,
        action: {
          center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 0.9,
          effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'root', duration: 2.5, value: 0 }],
        },
      },
      {
        id: 'ap_stroke', name: 'ㅣ 긋기', cooldown: 8, initialDelay: 9,
        action: { center: 'target', area: { shape: 'line', length: 16, width: 1.6 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 2.4 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '대답', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 양옆 두 획 → 대상 둘레 동그라미
            id: 'ap_name', name: '이름 쓰기', cooldown: 12, initialDelay: 1.5,
            ...seq([
              ...sweep({ center: 'target', area: { shape: 'line', length: 16, width: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] }, [{ x: -3, y: 0 }, { x: 3, y: 0 }], 1, 0.25),
              { center: 'target', area: { shape: 'ring', inner: 1.4, outer: 3.6 }, affects: 'enemies', delay: 1.8, effects: [{ kind: 'damage', amount: 2.4 }] },
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
    // 기획 19차 (뒤): 거꾸로 뜬 달 — 붉은 하늘의 뒤집힌 달. 달빛이 닿는 자리(불린 사람 곁)만 안전한 월식.
    id: 'inverted_moon', name: '거꾸로 뜬 달', tier: 'boss', color: '#f1faee', radius: 3, stationary: true, look: 'inverted_moon',
    stats: { maxHp: 7400, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 대상 둘레 2.6칸 안만 안전 — 바깥 고리가 아레나 전체를 덮음
        id: 'im_eclipse', name: '월식', cooldown: 14, initialDelay: 5,
        hint: '달빛 안만 안전해요 — 불린 사람 곁으로 교체',
        action: { center: 'target', area: { shape: 'ring', inner: 2.6, outer: 30 }, affects: 'enemies', delay: 2.2, effects: [{ kind: 'damage', amount: 2.6 }] },
      },
      {
        // 대상 네 귀퉁이를 차례로 (가운데는 안전)
        id: 'im_hands', name: '그림자 손', cooldown: 10, initialDelay: 3,
        ...seq(sweep(
          { center: 'target', area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }] },
          [{ x: -2.4, y: -2.4 }, { x: 2.4, y: -2.4 }, { x: 2.4, y: 2.4 }, { x: -2.4, y: 2.4 }], 1.1, 0.15,
        )),
      },
      {
        // 대상 자리에 그림자 아이 떼 + 보스 앞에 붉은 마스크 하나 (규칙 M4: 조각의 offset이 소환 자리)
        id: 'im_shadows', name: '달그림자', cooldown: 15, initialDelay: 8,
        ...seq([
          { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'goblin', count: 3, countMax: 4, duration: 0 } },
          { center: 'self', offset: { x: 0, y: 3 }, area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [], summon: { unitId: 'red_mask', count: 1, duration: 0 } },
        ]),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '붉은 달', cooldownMult: 0.85,
        skills: [
          {
            id: 'im_moonbeam', name: '달빛 기둥', cooldown: 11, initialDelay: 1.5,
            action: { center: 'target', area: { shape: 'fan', radius: 14, angle: 50 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 2.6 }] },
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
