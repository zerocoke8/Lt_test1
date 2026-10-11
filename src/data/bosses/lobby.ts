// 기획 19차 보스 레이드 — 로비·상가 (1~5층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   claw_machine 인형 뽑기 기계 (cm_) · washer_drum 혼자 도는 세탁기 (wd_)
//   karaoke_room 지하 7번 노래방 (kr_) · reverse_escalator 거꾸로 가는 에스컬레이터 (re_)
// New summon-only units of this zone: prize_doll 뽑기 인형, lost_sock 외짝 양말 → LOBBY_UNITS (resolved by getMonster, never in a wave pool).
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
//     zone: 'lobby',
//   },
// Rule M1 (boss self-cast): a part with affects 'self' and a delay shows a yellow ring and is broken by groggy.
// Rule M2: telegraphLead on a part = the warning shows only for the last N s. Rule M4: a part's offset also moves its summon.
// Every hit on the party needs a delay (a warning) of at least 0.8 s. To take a boss out of the raid add `raid: false`
// to its entry (docs/boss-raid.md 3-1); after a number change run `npx vite-node tests/review/boss-table.ts write`.
// Checks: tests/sim/bosses-lobby.test.ts → expectBossContract('<id>') (tests/sim/bossRaidHelpers.ts) + the boss's own
// pattern tests on raidGame('<id>', { hpMult: 50, tunables: { invincible: true } }).
// Tune one boss: npx vite-node tests/review/boss-raid-bench.ts BOSS=<id> RUNS=60

import type { AreaShape, BossDef, MonsterDef, SkillAction } from '../../types';
import { ENRAGE, band, repeat, row, seq, sweep } from './helpers';

/** 역주행: the five stair rows (world y of each row's middle), top → bottom. */
const STAIR_ROWS = [1.25, 3.75, 6.25, 8.75, 11.25].map(row);
/** 역주행: one stair row — the full width, 2.5 high; it shoves whoever it hits down into the next row. */
const STAIR_ROW: SkillAction = { center: 'self', area: { shape: 'rect', length: 24, width: 2.5, dir: 'right' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'knockback', distance: 1.5, dir: 'down' }] };
/** 탈수: the three rings around the boss, inside → out. */
const SPIN_RINGS: AreaShape[] = [{ shape: 'ring', inner: 3, outer: 5.5 }, { shape: 'ring', inner: 5.5, outer: 8 }, { shape: 'ring', inner: 8, outer: 10.5 }];
/** 탈수 / 역회전: damage of each ring (× the boss's attack). */
const SPIN_DAMAGE = 2;
/** The spin rings as skill parts, each landing after its own delay. */
const spin = (areas: AreaShape[], delays: number[]): SkillAction[] => areas.map((area, i) => ({ center: 'self', area, affects: 'enemies', delay: delays[i], effects: [{ kind: 'damage', amount: SPIN_DAMAGE }] }));
/** A boss's wind-up on itself (rule M1): the yellow ring around it. */
const SELF_RING: AreaShape = { shape: 'circle', radius: 3.4 };

export const LOBBY_BOSSES: BossDef[] = [
  {
    // 5층: 닫히지 않는 엘리베이터 — 맨 위의 거대한 엘리베이터 문.
    id: 'elevator_keeper', name: '닫히지 않는 엘리베이터', tier: 'boss', color: '#b08968', radius: 3, stationary: true, look: 'elevator_keeper',
    stats: { maxHp: 8500, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 문짝이 왼쪽 → 오른쪽으로 쓸고 지나감 (세로 띠 4개, 0.5초 간격)
        id: 'ek_doors', name: '문이 닫힙니다', cooldown: 13, initialDelay: 4, hint: '문짝이 차례로 지나가요 — 지나간 자리로 교체해서 피하세요',
        ...seq(sweep({ center: 'self', area: { shape: 'rect', length: 13, width: 6, dir: 'down' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }, [band(3), band(9), band(15), band(21)], 1.4, 0.5)),
      },
      {
        id: 'ek_summon', name: '그림자 아이 호출', cooldown: 15, initialDelay: 6,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'goblin', count: 4, countMax: 6, duration: 0 } },
      },
      {
        // 층수 표시등 카운트다운: 바깥 고리가 먼저 터지고, 1초 뒤 가운데
        id: 'ek_counter', name: '층수 카운트다운', cooldown: 9, initialDelay: 9,
        ...seq([
          { center: 'target', area: { shape: 'ring', inner: 1.6, outer: 4 }, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 2.4 }] },
          { center: 'target', area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: 2.6, effects: [{ kind: 'damage', amount: 3 }] },
        ]),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '추락', atkSpeedMult: 1.2, cooldownMult: 0.85,
        skills: [
          {
            // 반대 방향(오른쪽 → 왼쪽)으로 더 빠르게
            id: 'ek_doors_back', name: '문이 다시 닫힙니다', cooldown: 13, initialDelay: 1.5, hint: '이번엔 오른쪽부터 — 지나간 자리로 교체해서 피하세요',
            ...seq(sweep({ center: 'self', area: { shape: 'rect', length: 13, width: 6, dir: 'down' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }, [band(21), band(15), band(9), band(3)], 1.2, 0.4)),
          },
        ],
      },
    ],
    // 기획 13차 보스 그로기: gauge ×0.8 (첫 보스, 배우는 자리)
    groggy: { threshold: 0.8 },
    enrage: ENRAGE,
    // 기획 19차 보스 레이드: the one-line 괴담 + the zone (the only additions; numbers unchanged)
    lore: '문이 닫히지 않는 엘리베이터. 층수 표시는 없는 층을 가리킨다.',
    zone: 'lobby',
  },
  {
    // 기획 19차: 인형 뽑기 기계 — 집게가 끌어다 놓고 내려찍는다 (끌린 뒤 0.7초가 교체 창).
    id: 'claw_machine', name: '인형 뽑기 기계', tier: 'boss', color: '#ffb3c6', radius: 3, stationary: true, look: 'claw_machine',
    stats: { maxHp: 8200, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 둘레 고리가 가운데로 끌어당기고(피해 없음), 0.7초 뒤 같은 자리에 집게가 떨어짐
        id: 'cm_grab', name: '집게 내리기', cooldown: 10, initialDelay: 4,
        ...seq([
          { center: 'target', area: { shape: 'ring', inner: 1.6, outer: 4.5 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'pull', distance: 2.5 }] },
          { center: 'target', area: { shape: 'circle', radius: 1.8 }, affects: 'enemies', delay: 1.9, effects: [{ kind: 'damage', amount: 3 }] },
        ]),
      },
      {
        id: 'cm_prizes', name: '경품 배출', cooldown: 15, initialDelay: 7,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'prize_doll', count: 3, countMax: 4, duration: 0 } },
      },
      {
        // 동전 세 닢이 대상 위쪽부터 차례로 떨어짐 (위 → 아래, 0.3초 간격)
        id: 'cm_coins', name: '동전 투입', cooldown: 8, initialDelay: 9,
        ...seq(sweep({ center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }] }, [{ x: 0, y: -4 }, { x: 0, y: -2 }, { x: 0, y: 0 }], 1, 0.3)),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '잭팟', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 집게 셋이 왼쪽 → 가운데 → 오른쪽으로
            id: 'cm_triple', name: '삼연 집게', cooldown: 12, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }, [{ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }], 1.3, 0.3)),
          },
        ],
      },
    ],
    groggy: { threshold: 0.8 },
    enrage: ENRAGE,
    lore: '동전을 넣지 않아도 집게가 내려온다. 뽑히는 건 인형이 아니라 손님이다.',
    zone: 'lobby',
  },
  {
    // 기획 19차: 혼자 도는 세탁기 — 탈수 고리가 안에서 밖으로 번진다 (지나간 고리 안이 안전).
    id: 'washer_drum', name: '혼자 도는 세탁기', tier: 'boss', color: '#8fb3c7', radius: 3, stationary: true, look: 'washer_drum',
    stats: { maxHp: 8800, atk: 29, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 보스 둘레 고리 3겹, 안 → 밖
        id: 'wd_spin', name: '탈수', cooldown: 12, initialDelay: 4,
        ...seq(spin(SPIN_RINGS, [1.4, 1.8, 2.2])),
      },
      {
        // 거품 웅덩이가 5초 남음 (0.5초마다)
        id: 'wd_suds', name: '거품', cooldown: 10, initialDelay: 7,
        action: { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', delay: 0.9, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }], zone: { duration: 5, tickInterval: 0.5 } },
      },
      {
        id: 'wd_socks', name: '한 짝 양말', cooldown: 14, initialDelay: 9,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'lost_sock', count: 3, countMax: 4, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '헹굼 실패', cooldownMult: 0.85,
        skills: [
          {
            // 같은 고리 3겹, 밖 → 안으로 더 빠르게
            id: 'wd_spin_back', name: '역회전', cooldown: 12, initialDelay: 1.5,
            ...seq(spin([...SPIN_RINGS].reverse(), [1.2, 1.5, 1.8])),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '24시 빨래방 맨 끝 세탁기. 아무도 넣지 않았는데 늘 돌아간다. 양말은 늘 한 짝만 나온다.',
    loreShort: '아무도 넣지 않았는데 늘 도는 세탁기.',
    zone: 'lobby',
  },
  {
    // 기획 19차: 지하 7번 노래방 — 고음 뒤의 「간주」 4초가 폭딜 창 (보스가 스스로 취약, 규칙 M1).
    id: 'karaoke_room', name: '지하 7번 노래방', tier: 'boss', color: '#2b2d42', radius: 3, stationary: true, look: 'karaoke_room',
    stats: { maxHp: 8600, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 부채꼴 고음, 0.1초 뒤 간주: 보스 자신에게 취약 +30% 4초
        id: 'kr_high_note', name: '고음', cooldown: 12, initialDelay: 4,
        ...seq([
          { center: 'target', area: { shape: 'fan', radius: 14, angle: 40 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 3 }] },
          { center: 'self', area: SELF_RING, affects: 'self', delay: 1.6, effects: [{ kind: 'status', status: 'vulnerable', duration: 4, value: 0.3 }] },
        ]),
      },
      {
        // 같은 자리에 0.5초 간격 3연타 (조각 셋 — 박자마다 예고가 따로 보임)
        id: 'kr_beat', name: '박자', cooldown: 9, initialDelay: 7,
        ...seq(repeat({ center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] }, [1.2, 1.7, 2.2])),
      },
      {
        id: 'kr_tambourine', name: '탬버린', cooldown: 8, initialDelay: 9,
        action: { center: 'target', area: { shape: 'ring', inner: 1.5, outer: 3.5 }, affects: 'enemies', delay: 1.1, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '앙코르', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 좁은 부채꼴 셋이 왼쪽 → 가운데 → 오른쪽
            id: 'kr_sing_along', name: '떼창', cooldown: 13, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'fan', radius: 14, angle: 30 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] }, [{ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }], 1.2, 0.3)),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '아무도 없는데 예약곡이 줄지 않는다. 마지막 소절을 들은 사람은 없다.',
    zone: 'lobby',
  },
  {
    // 기획 19차: 거꾸로 가는 에스컬레이터 — 계단 줄이 위에서 아래로 쓸고, 맞으면 아래로 밀려 다음 줄에 또 맞는다.
    id: 'reverse_escalator', name: '거꾸로 가는 에스컬레이터', tier: 'boss', color: '#6c757d', radius: 3, stationary: true, look: 'reverse_escalator',
    stats: { maxHp: 9000, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 가로 띠 5줄 (폭 24 · 높이 2.5), 위 → 아래 0.35초 간격, 아래로 넉백 1.5
        id: 're_run', name: '역주행', cooldown: 13, initialDelay: 4, hint: '계단이 위에서 아래로 쓸어 내려와요 — 교체로 피하세요',
        ...seq(sweep(STAIR_ROW, STAIR_ROWS, 1.4, 0.35)),
      },
      {
        // 아레나 아래쪽 고리가 보스 쪽으로 끌어당김
        id: 're_handrail', name: '손잡이', cooldown: 10, initialDelay: 7,
        action: { center: 'self', area: { shape: 'ring', inner: 8, outer: 12 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'pull', distance: 3 }] },
      },
      {
        id: 're_stop', name: '비상정지', cooldown: 9, initialDelay: 10,
        action: { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 2.6 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '추락 계단', cooldownMult: 0.85,
        skills: [
          {
            // 같은 5줄을 더 빠르게 (0.25초 간격)
            id: 're_run_fast', name: '빠른 역주행', cooldown: 13, initialDelay: 1.5,
            ...seq(sweep(STAIR_ROW, STAIR_ROWS, 1.2, 0.25)),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '올라가는 에스컬레이터인데 서 있으면 내려간다. 계단 틈 사이로 손가락이 보인다.',
    zone: 'lobby',
  },
];

/** Summon-only units of this zone's bosses (tier 'summon' or 'normal'; look = the key in render/bosses/lobby.ts LOBBY_MINION_LOOKS). */
export const LOBBY_UNITS: MonsterDef[] = [
  {
    // 뽑기 인형: 단추 눈 하나 떨어진 봉제 인형 (인형 뽑기 기계의 경품)
    id: 'prize_doll', name: '뽑기 인형', tier: 'normal', color: '#ffafcc', radius: 0.35, look: 'prize_doll',
    stats: { maxHp: 130, atk: 16, def: 0, atkSpeed: 1, range: 0.4, moveSpeed: 3, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
  {
    // 외짝 양말: 빠르고 약한 떼 (혼자 도는 세탁기에서 한 짝씩 나옴)
    id: 'lost_sock', name: '외짝 양말', tier: 'normal', color: '#e9f1f5', radius: 0.3, look: 'lost_sock',
    stats: { maxHp: 90, atk: 14, def: 0, atkSpeed: 1.2, range: 0.4, moveSpeed: 4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
];
