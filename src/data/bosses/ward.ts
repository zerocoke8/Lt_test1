// 기획 19차 보스 레이드 — 폐병동 (11~15층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   morgue_drawers 번호 없는 서랍 (md_) · xray_machine 투시 촬영기 (xr_)
//   defibrillator 멈추지 않는 제세동기 (df_) · empty_beds 빈 병상 행렬 (eb_)
// New summon-only units of this zone: bed_decoy 빈 침대 (기획 20차, 빈 병상 행렬의 행렬) → WARD_UNITS (resolved by getMonster,
// never in a wave pool). 링거 환자 is an existing monster.
// The summons (md_wake, eb_procession) are instant, like the classic 응급 호출: a warning on a part that hits nothing would
// still light the HUD's 저스트 cue (justCue reads telegraphs only) for a swap that earns nothing.
//
// 기획 20차 보스 형태 (docs/bosses.md 1장 · 4-3) — the four new bosses, one form and one signature rule each:
//   morgue_drawers 고정형     the floor is six cells; five open in number order, the unnumbered one never does (md_order)
//   xray_machine   자리 이동형  rides a rail between four stations; a scan line slides away from where it hangs (xr_scan)
//   defibrillator  배회형     a cart that chases the nearest character; its body bursts inside → outside (df_clear)
//   empty_beds     배회형     a bed that rushes its target — a taunt steers it — and calls more beds to rush (eb_procession)
// Builders for a moving boss: ./helpers.ts chargeAt / relocateTo / scan (row / rowR stay valid for the fixed 서랍 only).
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

import type { AreaShape, BossDef, Effect, MonsterDef, SkillAction } from '../../types';
import { ENRAGE, chargeAt, relocateTo, repeat, row, rowR, scan, seq, sweep } from './helpers';

// 번호 없는 서랍 (기획 20차): 바닥 6칸 = 가로 2 × 세로 3, 한 칸 12 × 4. 왼쪽 벽 칸은 x 0~12, 오른쪽 벽 칸은 x 12~24,
// 줄 가운데는 y 2 (위) · 6 (가운데) · 10 (아래). 한 번에 5칸이 번호 순서로 열리고 남은 한 칸(번호 없는 칸)이 안전.
const CELL_L: AreaShape = { shape: 'rect', dir: 'right', length: 12, width: 4 };
const CELL_R: AreaShape = { shape: 'rect', dir: 'left', length: 12, width: 4 };
const CELL_ROW = { top: 2, mid: 6, bottom: 10 } as const;
type Cell = readonly ['L' | 'R', keyof typeof CELL_ROW];

/** The cells of one 서랍 cast, opening in this order: the first after `first` s, each next one `gap` s later. */
function drawers(order: readonly Cell[], first: number, gap: number, effects: Effect[]): SkillAction[] {
  return order.map(([side, at], i): SkillAction => ({
    center: 'self',
    area: side === 'L' ? CELL_L : CELL_R,
    offset: side === 'L' ? row(CELL_ROW[at]) : rowR(CELL_ROW[at]),
    affects: 'enemies',
    delay: Math.round((first + i * gap) * 1000) / 1000,
    effects,
    // 기획 20차 점검: the cells stay on their grid whatever the area slider says (the unnumbered one must stay whole), and
    // a character dropped in the safe cell does not walk out into an opening one (rule N9)
    fixedArea: true,
    keepOut: true,
  }));
}

/** 번호 순서: ① 왼쪽 위 ② 오른쪽 위 ③ 왼쪽 가운데 ④ 오른쪽 가운데 ⑤ 왼쪽 아래 — 번호 없는 칸 = 오른쪽 아래. */
const ORDER_A: readonly Cell[] = [['L', 'top'], ['R', 'top'], ['L', 'mid'], ['R', 'mid'], ['L', 'bottom']];
/** 다음 시전은 좌우가 뒤집힘 — 번호 없는 칸 = 왼쪽 아래. */
const ORDER_B: readonly Cell[] = [['R', 'top'], ['L', 'top'], ['R', 'mid'], ['L', 'mid'], ['R', 'bottom']];
/** 거꾸로 순서 (2페이즈): 아래부터 — 번호 없는 칸 = 왼쪽 위. */
const ORDER_BACK: readonly Cell[] = [['R', 'bottom'], ['L', 'bottom'], ['R', 'mid'], ['L', 'mid'], ['R', 'top']];
const DRAWER_HIT: Effect[] = [{ kind: 'damage', amount: 2 }];

// 투시 촬영기: 스캔 줄 한 조각이 남기는 것 — 피해 + 「뼈가 찍힘」(취약 35 %, 4초). 촬영 · 재촬영이 같이 씀.
const XRAY_HIT: Effect[] = [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.35 }];

// 멈추지 않는 제세동기: 몸 둘레 원(안)과 그 바깥 고리(밖)의 크기 — 물러서세요 · 두 번 충격이 같이 씀.
const SHOCK_IN: AreaShape = { shape: 'circle', radius: 4.5 };
const SHOCK_OUT: AreaShape = { shape: 'ring', inner: 4.5, outer: 8 };

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
    // 기획 20차 번호 없는 서랍 (앞) — 고정형 「방 전체가 영안실」: 바닥 6칸 중 5칸이 번호 순서로 열림. 번호 없는 칸으로 교체.
    id: 'morgue_drawers', name: '번호 없는 서랍', tier: 'boss', color: '#8d99ae', radius: 3, stationary: true, look: 'morgue_drawers',
    form: 'fixed', signature: 'md_order',
    stats: { maxHp: 7600, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 번호 순서 ★: 5칸이 0.3초 간격으로 열림 (오른쪽 아래가 안전). 다음 시전은 좌우가 뒤집힘 (왼쪽 아래가 안전).
        id: 'md_order', name: '번호 순서', cooldown: 13, initialDelay: 4, hint: '번호 없는 칸으로 교체하세요',
        ...seq(drawers(ORDER_A, 1.6, 0.3, DRAWER_HIT)),
        cycle: [seq(drawers(ORDER_B, 1.6, 0.3, DRAWER_HIT))],
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
            // 거꾸로 순서: 아래 칸부터, 더 빠르게 (0.25초 간격) — 왼쪽 위가 안전
            id: 'md_reverse', name: '거꾸로 순서', cooldown: 13, initialDelay: 1.5, hint: '이번엔 아래부터 — 왼쪽 위가 안전',
            ...seq(drawers(ORDER_BACK, 1.3, 0.25, DRAWER_HIT)),
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
    // 기획 20차 투시 촬영기 (중) — 자리 이동형 「레일을 타는 촬영기」: 스캔 줄이 기계 쪽에서 밀려옴. 줄이 지나간 쪽으로 교체.
    id: 'xray_machine', name: '투시 촬영기', tier: 'boss', color: '#f8f9fa', radius: 1.8, stationary: true, look: 'xray_machine',
    // 레일 정거장 4곳 (서 · 북 · 동 · 남, 시계 방향), 서쪽에서 시작 (기획 20차 통합: 맨 위 가운데에 나오는 보스를 줄임 — 첫 스캔 줄이 맵을 가로로 다 쓸고 감).
    // 정거장마다 보는 방향 = 스캔 줄이 밀려가는 방향.
    form: 'relocating', signature: 'xr_scan',
    spots: [{ x: 3.5, y: 6, facing: 'right' }, { x: 12, y: 3, facing: 'down' }, { x: 20.5, y: 6, facing: 'left' }, { x: 12, y: 10, facing: 'up' }],
    stats: { maxHp: 7800, atk: 28, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 촬영 ★: 보는 방향에 가로놓인 줄(길이 26 · 폭 2)이 기계 앞 2칸부터 2칸씩 18칸까지. 각 줄은 마지막 0.9초만 예고, 한 번만 맞음.
        id: 'xr_scan', name: '촬영', cooldown: 12, initialDelay: 4, hint: '줄이 지나간 쪽으로 교체하세요',
        ...seq(scan({ from: 2, to: 18, step: 2, length: 26, width: 2, first: 1.2, gap: 0.3, lead: 0.9, effects: XRAY_HIT })),
      },
      {
        // 레일 이동: 다음 정거장이 1.3초 예고된 뒤 기계가 그 자리에 옴 (스캔 줄 방향도 같이 바뀜)
        id: 'xr_rail', name: '레일 이동', cooldown: 14, initialDelay: 9, hint: '자리를 옮기면 줄 방향도 바뀌어요',
        action: relocateTo({ radius: 3, delay: 1.3, effects: [{ kind: 'damage', amount: 2 }] }),
      },
      {
        // 현상: 따라오는 2연타 (조각 둘 — 두 번째도 예고가 따라옴). 뼈가 찍힌(취약) 캐릭터가 맞으면 35 % 더 아픔.
        id: 'xr_develop', name: '현상', cooldown: 11, initialDelay: 6.5, hint: '뼈가 찍힌 캐릭터는 빼세요',
        ...seq(repeat({ center: 'target', area: { shape: 'circle', radius: 2.2 }, affects: 'enemies', follow: true, effects: [{ kind: 'damage', amount: 1.5 }] }, [1.6, 2])),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '과다 노출', cooldownMult: 0.85,
        skills: [
          {
            // 재촬영: 같은 줄이 먼 쪽(18칸)에서 기계 쪽으로 돌아옴, 더 빠르게 (0.24초 간격)
            id: 'xr_scan_back', name: '재촬영', cooldown: 13, initialDelay: 1.5, hint: '줄이 돌아와요 — 기계에서 먼 쪽으로',
            ...seq(scan({ from: 18, to: 2, step: 2, length: 26, width: 2, first: 1.2, gap: 0.24, lead: 0.9, effects: XRAY_HIT })),
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
    // 기획 20차 멈추지 않는 제세동기 (중) — 배회형 「병상을 도는 수레」: 몸 둘레가 안 → 밖으로 터짐 + 자기 회복(규칙 M1: 노란 고리, 그로기로 끊김).
    id: 'defibrillator', name: '멈추지 않는 제세동기', tier: 'boss', color: '#ffd60a', radius: 1.6, look: 'defibrillator',
    // 병상 사이를 도는 수레 (회진): 세 자리를 차례로 돌고 자리마다 3초 섬. 도발한 탱커는 따라옴.
    // (기획 20차 통합: 「가까운 캐릭터 쫓기」로는 파티가 먼저 붙어서 한 칸도 안 움직였음 → 스스로 도는 길로 바꿈)
    form: 'roaming', spawn: { x: 18, y: 4 }, signature: 'df_clear',
    move: { mode: 'patrol', waypoints: [{ x: 18, y: 4 }, { x: 6, y: 4.5 }, { x: 12, y: 9 }], dwell: 3, turnRate: 120 },
    // HP 6800: 심폐소생(6%)만큼 미리 낮춤 — 싸움이 길면 4%로 (docs/bosses.md)
    stats: { maxHp: 6800, atk: 30, def: 0.2, atkSpeed: 0.5, range: 1, moveSpeed: 1.8, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        // 물러서세요 ★: 몸 둘레 원(기절) → 0.5초 뒤 그 바깥 고리. 보스는 끝까지 제자리 — 터진 직후엔 옆이 안전.
        id: 'df_clear', name: '물러서세요', cooldown: 11, initialDelay: 4, hint: '터지기 전엔 멀리, 터진 뒤엔 옆',
        ...seq([
          { center: 'self', area: SHOCK_IN, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
          { center: 'self', area: SHOCK_OUT, affects: 'enemies', delay: 2.1, effects: [{ kind: 'damage', amount: 1.6 }] },
        ]),
      },
      {
        // 패들: 보스에서 대상 쪽 부채꼴 — 옆이나 뒤는 안전
        id: 'df_paddles', name: '패들', cooldown: 10, initialDelay: 7, hint: '패들의 옆이나 뒤에 꺼내세요',
        action: { center: 'target', area: { shape: 'fan', radius: 6.5, angle: 100 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 2.4 }] },
      },
      {
        // 규칙 M1: 보스 자신에게 — 준비 2.5초 동안 노란 고리, 그 사이 그로기가 오면 끊김
        id: 'df_revive', name: '심폐소생', cooldown: 18, initialDelay: 10, hint: '충전 중 — 그로기로 끊으세요',
        action: { center: 'self', area: { shape: 'circle', radius: 3.4 }, affects: 'self', delay: 2.5, effects: [{ kind: 'heal', amount: 0.06 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.45, name: '재충전', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 두 번 충격: 안 → 밖 → 안, 0.5초 간격
            id: 'df_double', name: '두 번 충격', cooldown: 12, initialDelay: 1.5, hint: '안 → 밖 → 안, 박자에 맞춰 꺼내기',
            ...seq([
              { center: 'self', area: SHOCK_IN, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 1.8 }] },
              { center: 'self', area: SHOCK_OUT, affects: 'enemies', delay: 1.7, effects: [{ kind: 'damage', amount: 1.8 }] },
              { center: 'self', area: SHOCK_IN, affects: 'enemies', delay: 2.2, effects: [{ kind: 'damage', amount: 1.8 }] },
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
    // 기획 20차 빈 병상 행렬 (뒤) — 배회형 「침대 떼의 질주」: 대상 쪽으로 벽까지 달림 (도발로 방향을 돌림) + 빈 침대들을 불러 함께 질주.
    id: 'empty_beds', name: '빈 병상 행렬', tier: 'boss', color: '#dee2e6', radius: 1.5, look: 'empty_beds',
    // 가까운 캐릭터를 쫓음 — 질주도 그 대상 쪽이라 탱커 도발로 질주 방향을 정할 수 있음
    form: 'roaming', spawn: { x: 21, y: 6 }, move: { mode: 'pursue' }, signature: 'eb_procession',
    stats: { maxHp: 8000, atk: 30, def: 0.2, atkSpeed: 0.5, range: 1, moveSpeed: 1.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1.2 },
    skills: [
      {
        // 질주: 대상 쪽으로 벽(상자 끝)까지 돌진
        id: 'eb_rush', name: '질주', cooldown: 9, initialDelay: 4, hint: '빨간 길 밖으로 — 도발하면 탱커 쪽',
        action: chargeAt({ distance: 26, width: 2.6, delay: 1.4, effects: [{ kind: 'damage', amount: 2.4 }, { kind: 'knockback', distance: 1.5 }] }),
      },
      {
        // 행렬 ★: 빈 침대 2~3대가 보스 둘레에 나타나 (12초 뒤 사라짐) 한 번씩 질주 → 빨간 길 여러 줄이 한꺼번에
        id: 'eb_procession', name: '행렬', cooldown: 16, initialDelay: 8, hint: '길과 길 사이에 꺼내세요',
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'bed_decoy', count: 2, countMax: 3, duration: 12 } },
      },
      {
        id: 'eb_sheet', name: '시트 덮침', cooldown: 11, initialDelay: 6, hint: '덮치기 직전에 교체하세요',
        action: { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', follow: true, delay: 1.2, effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'slow', duration: 2, value: 0.5 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '연쇄 추돌', cooldownMult: 0.8,
        skills: [
          {
            // 연쇄 추돌: 질주 → 멈춘 자리 둘레가 터짐 (전체 2.2초, 마지막 1.0초만 예고)
            id: 'eb_pileup', name: '연쇄 추돌', cooldown: 10, initialDelay: 1.5, hint: '침대가 멈춘 자리도 터져요',
            ...seq([
              chargeAt({ distance: 26, width: 3.2, delay: 1.2, effects: [{ kind: 'damage', amount: 2.2 }] }),
              { center: 'self', follow: true, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', delay: 2.2, telegraphLead: 1, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
            ]),
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
export const WARD_UNITS: MonsterDef[] = [
  {
    // 기획 20차: 빈 침대 — 시트 없는 작은 침대 (빈 병상 행렬의 「행렬」이 부름, 12초 뒤 사라짐). 사는 동안 한 번 질주:
    // 대상 쪽 10칸, 길 폭 2, 예고 1.4초. 진짜와 헷갈리지 않음 (「가짜 찾기」가 아님).
    id: 'bed_decoy', name: '빈 침대', tier: 'normal', color: '#adb5bd', radius: 1.3, look: 'bed_decoy',
    stats: { maxHp: 240, atk: 18, def: 0, atkSpeed: 0.6, range: 0.6, moveSpeed: 2, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        id: 'bd_rush', name: '질주', cooldown: 9, initialDelay: 3, castRange: 10,
        action: { center: 'target', area: { shape: 'line', length: 10, width: 2 }, affects: 'enemies', delay: 1.4, charge: { distance: 10, duration: 0.3 }, effects: [{ kind: 'damage', amount: 1 }] },
      },
    ],
  },
];
