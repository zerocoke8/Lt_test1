// 기획 19차 보스 레이드 — 폐병동 (11~15층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   morgue_drawers 번호 없는 서랍 (md_) · xray_machine 투시 촬영기 (xr_)
//   defibrillator 멈추지 않는 제세동기 (df_) · empty_beds 빈 병상 행렬 (eb_)
// New summon-only units of this zone: (none — 링거 환자 / 간호 인형 are existing monsters) → WARD_UNITS (resolved by getMonster, never in a wave pool).
// The summons (md_wake, xr_dolls) are instant, like the classic 응급 호출: a warning on a part that hits nothing would
// still light the HUD's 저스트 cue (justCue reads telegraphs only) for a swap that earns nothing.
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
//     zone: 'ward',
//   },
// Rule M1 (boss self-cast): a part with affects 'self' and a delay shows a yellow ring and is broken by groggy.
// Rule M2: telegraphLead on a part = the warning shows only for the last N s. Rule M4: a part's offset also moves its summon.
// Every hit on the party needs a delay (a warning) of at least 0.8 s. Every gameplay number of a boss is in its literal
// below (or a named constant just above the table) — the art and the sounds read none of them, so a retune is one edit
// here (+ `npx vite-node tests/review/boss-table.ts write` for docs/bosses.md 2장). Taking a boss out of the raid is
// one line in its entry, `raid: false` (its slots go to the zone's other bosses: src/sim/bossRaid.ts); try sizes and
// warning times live first with the debug sliders 「보스 튜닝」 (bossTelegraphMult / bossAreaMult).
// Checks: tests/sim/bosses-ward.test.ts → expectBossContract('<id>') (tests/sim/bossRaidHelpers.ts) + the boss's own
// pattern tests on raidGame('<id>', { hpMult: 50, tunables: { invincible: true } }).
// Tune one boss: npx vite-node tests/review/boss-raid-bench.ts BOSS=<id> RUNS=60

import type { AreaShape, BossDef, MonsterDef } from '../../types';
import { ENRAGE, repeat, row, rowR, seq, sweep } from './helpers';

// 번호 없는 서랍: 반 폭 서랍 (벽에서 11칸, 폭 2.6) 세 줄 — 왼쪽 벽 것은 x 0~11, 오른쪽 벽 것은 x 13~24를 덮음.
const DRAWER_ROWS = [2.2, 6, 9.8];
const DRAWER_L: AreaShape = { shape: 'rect', dir: 'right', length: 11, width: 2.6 };
const DRAWER_R: AreaShape = { shape: 'rect', dir: 'left', length: 11, width: 2.6 };

export const WARD_BOSSES: BossDef[] = [
  {
    // 15층: 수술실 원장.
    id: 'surgeon_director', name: '수술실 원장', tier: 'boss', color: '#90e0ef', radius: 3, stationary: true, look: 'surgeon',
    // 기획 8차 리뷰: HP 8000 → 7400 (광폭화 48% → 약 30%; 6층부터 강해지는 속도 0.6 → 0.66과 같이)
    stats: { maxHp: 7400, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 12 },
    skills: [
      {
        // 메스 투척: 보스에서 대상 쪽 직선 3개 (좌·가운데·우) 시간차
        id: 'sd_scalpels', name: '메스 투척', cooldown: 9, initialDelay: 4,
        ...seq(sweep({ center: 'target', area: { shape: 'line', length: 16, width: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }, [{ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }], 1, 0.25)),
      },
      {
        id: 'sd_summon', name: '응급 호출', cooldown: 16, initialDelay: 7,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'iv_zombie', count: 2, countMax: 3, duration: 0 } },
      },
      {
        id: 'sd_gas', name: '마취 가스', cooldown: 11, initialDelay: 9,
        action: { center: 'target', area: { shape: 'circle', radius: 2.6 }, affects: 'enemies', delay: 0.8, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }], zone: { duration: 5, tickInterval: 0.5 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.6, name: '집도 개시', cooldownMult: 0.85,
        skills: [
          {
            id: 'sd_incision', name: '절개', cooldown: 12, initialDelay: 1.5,
            action: { center: 'target', area: { shape: 'fan', radius: 14, angle: 70 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 3 }] },
          },
        ],
      },
      {
        hpBelow: 0.25, name: '폭주 수술', atkSpeedMult: 1.4, cooldownMult: 0.7,
        skills: [
          {
            id: 'sd_scalpel_storm', name: '메스 폭풍', cooldown: 10, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'line', length: 16, width: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] }, [{ x: -6, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }], 1, 0.2)),
          },
        ],
      },
    ],
    // 기획 13차 보스 그로기: gauge ×1
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    // 기획 19차 보스 레이드: the one-line 괴담 + the zone (the only additions; numbers unchanged)
    lore: '폐쇄된 수술실에 조명이 켜진다. 원장은 아직 집도 중이다.',
    zone: 'ward',
  },
  {
    // 기획 19차 번호 없는 서랍 (앞): 왼쪽 벽에서 반 폭 서랍 3줄 — 오른쪽 절반이 안전. 페이즈 2에는 오른쪽 벽에서도 열림.
    id: 'morgue_drawers', name: '번호 없는 서랍', tier: 'boss', color: '#8d99ae', radius: 3, stationary: true, look: 'morgue_drawers',
    stats: { maxHp: 7600, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        id: 'md_drawers', name: '서랍 열림', cooldown: 12, initialDelay: 4, hint: '왼쪽 서랍이 열려요 — 오른쪽 절반으로 교체해서 피하세요',
        ...seq(sweep({ center: 'self', area: DRAWER_L, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] }, DRAWER_ROWS.map(row), 1.3, 0.4)),
      },
      {
        id: 'md_frost', name: '냉기', cooldown: 11, initialDelay: 8,
        action: { center: 'target', area: { shape: 'ring', inner: 1.5, outer: 4.5 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'slow', duration: 2, value: 0.4 }] },
      },
      {
        id: 'md_wake', name: '일어난 환자', cooldown: 15, initialDelay: 7,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'iv_zombie', count: 2, countMax: 3, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '전원 개방', atkSpeedMult: 1.1, cooldownMult: 0.85,
        skills: [
          {
            // 같은 3줄이 오른쪽 벽에서 (왼쪽 절반이 안전)
            id: 'md_drawers_right', name: '오른쪽 서랍', cooldown: 12, initialDelay: 1.5,
            ...seq(sweep({ center: 'self', area: DRAWER_R, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] }, DRAWER_ROWS.map(rowR), 1.2, 0.3)),
          },
        ],
      },
    ],
    groggy: { threshold: 0.9 },
    enrage: ENRAGE,
    lore: '영안실 서랍은 번호 순서대로만 열린다. 번호가 없는 서랍이 열리는 밤에는 누군가 들어가야 한다.',
    zone: 'ward',
  },
  {
    // 기획 19차 투시 촬영기 (중): 투시(취약 표식) → 현상(따라오는 2연타) 콤보 — 표식 받은 캐릭터를 교체로 빼면 끊김.
    id: 'xray_machine', name: '투시 촬영기', tier: 'boss', color: '#f8f9fa', radius: 3, stationary: true, look: 'xray_machine',
    stats: { maxHp: 7800, atk: 28, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        id: 'xr_scan', name: '투시', cooldown: 10, initialDelay: 4,
        action: { center: 'target', area: { shape: 'line', length: 16, width: 2 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.35 }] },
      },
      {
        id: 'xr_develop', name: '현상', cooldown: 10, initialDelay: 6.5,
        // 따라오는 2연타 (조각 둘 — 두 번째도 예고가 따라옴)
        ...seq(repeat({ center: 'target', area: { shape: 'circle', radius: 2.2 }, affects: 'enemies', follow: true, effects: [{ kind: 'damage', amount: 1.5 }] }, [1.6, 2])),
      },
      {
        // 대상 자리에 간호 인형 2
        id: 'xr_dolls', name: '필름 교체', cooldown: 16, initialDelay: 9,
        action: { center: 'target', area: { shape: 'circle', radius: 1.5 }, affects: 'enemies', effects: [], summon: { unitId: 'nurse_doll', count: 2, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '과다 노출', cooldownMult: 0.85,
        skills: [
          {
            id: 'xr_sweep', name: '연속 촬영', cooldown: 13, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'line', length: 16, width: 1.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.35 }] }, [{ x: -6, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }], 1, 0.2)),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '밤에 혼자 찍힌 엑스레이에는 뼈가 하나 더 있었다. 기계는 그게 누구 뼈인지 알고 있다.',
    zone: 'ward',
  },
  {
    // 기획 19차 멈추지 않는 제세동기 (중): 밖으로 번지는 전기 고리 3겹 + 자기 회복(규칙 M1: 노란 고리, 그로기로 끊김).
    id: 'defibrillator', name: '멈추지 않는 제세동기', tier: 'boss', color: '#ffd60a', radius: 3, stationary: true, look: 'defibrillator',
    // HP 6800: 심폐소생(6%)만큼 미리 낮춤 — 싸움이 길면 4%로 (docs/bosses.md)
    stats: { maxHp: 6800, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        id: 'df_shock', name: '물러서세요', cooldown: 11, initialDelay: 4, hint: '전기가 고리로 번져요 — 지나간 고리 안으로 교체',
        ...seq([
          { center: 'self', area: { shape: 'ring', inner: 2.5, outer: 5.5 }, affects: 'enemies', delay: 1.4, effects: [{ kind: 'damage', amount: 1.6 }] },
          { center: 'self', area: { shape: 'ring', inner: 5.5, outer: 8.5 }, affects: 'enemies', delay: 1.8, effects: [{ kind: 'damage', amount: 1.6 }] },
          { center: 'self', area: { shape: 'ring', inner: 8.5, outer: 12 }, affects: 'enemies', delay: 2.2, effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
        ]),
      },
      {
        // 규칙 M1: 보스 자신에게 — 준비 2.5초 동안 노란 고리, 그 사이 그로기가 오면 끊김
        id: 'df_revive', name: '심폐소생', cooldown: 18, initialDelay: 10, hint: '충전 중 — 그로기로 끊을 수 있어요',
        action: { center: 'self', area: { shape: 'circle', radius: 3.4 }, affects: 'self', delay: 2.5, effects: [{ kind: 'heal', amount: 0.06 }] },
      },
      {
        id: 'df_jolt', name: '전기 충격', cooldown: 8, initialDelay: 7,
        action: { center: 'target', area: { shape: 'cross', length: 4.5, width: 1.4 }, affects: 'enemies', delay: 1.1, effects: [{ kind: 'damage', amount: 2.4 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.45, name: '재충전', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 한 명을 따라가는 두 번의 충격 — 첫 번째를 교체로 흘려도 두 번째가 새 캐릭터를 따라옴
            id: 'df_double', name: '두 번 충격', cooldown: 12, initialDelay: 1.5,
            ...seq([
              { center: 'target', area: { shape: 'single' }, affects: 'enemies', follow: true, delay: 1, effects: [{ kind: 'damage', amount: 2.6 }] },
              { center: 'target', area: { shape: 'single' }, affects: 'enemies', follow: true, delay: 1.6, effects: [{ kind: 'damage', amount: 2.6 }] },
            ]),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '응급실 구석의 제세동기는 꺼도 다시 켜진다. 「물러서세요」 뒤에 아무도 없는 침대가 들썩인다.',
    zone: 'ward',
  },
  {
    // 기획 19차 빈 병상 행렬 (뒤): 끌어 모은 뒤 한꺼번에 덮침 + 따라오는 시트 + 남는 소독약 장판.
    id: 'empty_beds', name: '빈 병상 행렬', tier: 'boss', color: '#dee2e6', radius: 3, stationary: true, look: 'empty_beds',
    stats: { maxHp: 8000, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 병상 정렬: 고리 안의 모두를 가운데로 끌고(피해 0), 0.8초 뒤 같은 자리에 큰 원
        id: 'eb_lineup', name: '병상 정렬', cooldown: 13, initialDelay: 5,
        ...seq([
          { center: 'target', area: { shape: 'ring', inner: 1.5, outer: 7 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'pull', distance: 3.5 }] },
          { center: 'target', area: { shape: 'circle', radius: 2.8 }, affects: 'enemies', delay: 2.1, effects: [{ kind: 'damage', amount: 2.8 }] },
        ]),
      },
      {
        id: 'eb_sheet', name: '시트 덮침', cooldown: 9, initialDelay: 4,
        action: { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', follow: true, delay: 1.2, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'slow', duration: 2, value: 0.5 }] },
      },
      {
        id: 'eb_disinfect', name: '소독약', cooldown: 12, initialDelay: 9,
        action: { center: 'target', area: { shape: 'circle', radius: 2.6 }, affects: 'enemies', delay: 0.8, effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'atkDown', duration: 1.5, value: 0.25 }], zone: { duration: 5, tickInterval: 0.5 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '연쇄 추돌', cooldownMult: 0.8,
        skills: [
          {
            id: 'eb_double', name: '겹친 병상', cooldown: 10, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.9 }, { kind: 'status', status: 'slow', duration: 2, value: 0.5 }] }, [{ x: -2.5, y: 0 }, { x: 2.5, y: 0 }], 1.1, 0.3)),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '비어 있는 침대가 밤마다 복도를 달린다. 시트는 늘 사람 모양으로 구겨져 있다.',
    zone: 'ward',
  },
];

/** Summon-only units of this zone's bosses (tier 'summon' or 'normal'; look = the key in render/bosses/ward.ts WARD_MINION_LOOKS). */
export const WARD_UNITS: MonsterDef[] = [];
