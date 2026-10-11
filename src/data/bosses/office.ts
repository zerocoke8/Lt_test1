// 기획 19차 보스 레이드 — 사무실 (6~10층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   shredder_maw 문서 파쇄기 (sh_) · coffee_machine 식지 않는 커피 머신 (cf_)
//   dead_monitor 퇴근 못 한 모니터 (dm_) · endless_meeting 끝나지 않는 회의 (em_)
// New summon-only units of this zone: error_popup 오류 창 → OFFICE_UNITS (resolved by getMonster, never in a wave pool).
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
//     zone: 'office',
//   },
// Rule M1 (boss self-cast): a part with affects 'self' and a delay shows a yellow ring and is broken by groggy.
// Rule M2: telegraphLead on a part = the warning shows only for the last N s. Rule M4: a part's offset also moves its summon.
// Every hit on the party needs a delay (a warning) of at least 0.8 s. To take a boss out of the raid add `raid: false`
// to its entry (docs/boss-raid.md 3-1); after a number change run `npx vite-node tests/review/boss-table.ts write`.
// Checks: tests/sim/bosses-office.test.ts → expectBossContract('<id>') (tests/sim/bossRaidHelpers.ts) + the boss's own
// pattern tests on raidGame('<id>', { hpMult: 50, tunables: { invincible: true } }).
// Tune one boss: npx vite-node tests/review/boss-raid-bench.ts BOSS=<id> RUNS=60

import type { BossDef, MonsterDef, SkillAction, Vec2 } from '../../types';
import { ENRAGE, at, band, repeat, seq, sweep } from './helpers';

// 문서 파쇄기: the two interleaved combs (world x of each 2-wide strip). A covers x 0–2, 4–6 …; B the gaps 2–4, 6–8 …
const COMB_A = [1, 5, 9, 13, 17, 21];
const COMB_B = [3, 7, 11, 15, 19, 23];

/** One comb: a strip (width 2) down the whole arena at each x, all landing after `delay`. */
function comb(xs: readonly number[], delay: number, amount: number): SkillAction[] {
  return xs.map(x => ({ center: 'self', offset: band(x), area: { shape: 'rect', length: 13, width: 2, dir: 'down' }, affects: 'enemies', delay, effects: [{ kind: 'damage', amount }] }));
}

// 퇴근 못 한 모니터: where the three pop-ups open (world spots; docs/bosses.md offsets (−6, 5.2) / (0, 7.2) / (6, 5.2))
const POPUP_SPOTS: readonly Vec2[] = [at(6, 4), at(12, 6), at(18, 4)];

export const OFFICE_BOSSES: BossDef[] = [
  {
    // 10층: 야근의 군주 — 팔이 여러 개인 사무실 유령.
    id: 'overtime_lord', name: '야근의 군주', tier: 'boss', color: '#3d5a80', radius: 3, stationary: true, look: 'overtime_lord',
    // 기획 13차 밸런스: HP 8000 → 9000 (그로기 설계 8장 +12% 묶음을 10층에만 — 15·20층은 6층 이후 성장만으로 싸움 길이가 12차 수준)
    stats: { maxHp: 9000, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 서류 폭풍: 보스에서 대상 쪽으로 부채꼴 3번, 왼쪽 → 오른쪽으로 쓸어 냄
        id: 'ol_paperstorm', name: '서류 폭풍', cooldown: 11, initialDelay: 4,
        ...seq(sweep({ center: 'target', area: { shape: 'fan', radius: 14, angle: 34 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }, [{ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }], 1.2, 0.4)),
      },
      {
        id: 'ol_summon', name: '야근 소집', cooldown: 16, initialDelay: 7,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'overtime_ghost', count: 3, countMax: 4, duration: 0 } },
      },
      {
        id: 'ol_stamp', name: '결재 도장', cooldown: 8, initialDelay: 9,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.6 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 2.8 }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
      },
    ],
    phases: [
      {
        // 기획 8차 리뷰: 2페이즈가 첫 벽 (사망 2.77/판 vs 1페이즈 0.30) → 공속 ×1.3 → 1.15, 쿨 ×0.75 → 0.85, 도장 연타 1.8/1.8/2.2 → 1.4/1.4/1.8
        hpBelow: 0.5, name: '무한 야근', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 도장 연타: + → X → 동그라미, 같은 자리에 0.5초 간격
            id: 'ol_stamp_combo', name: '도장 연타', cooldown: 12, initialDelay: 1.5,
            ...seq([
              { center: 'target', area: { shape: 'cross', length: 5, width: 1.6 }, affects: 'enemies', delay: 1, effects: [{ kind: 'damage', amount: 1.4 }] },
              { center: 'target', area: { shape: 'cross', length: 5, width: 1.6, diagonal: true }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 1.4 }] },
              { center: 'target', area: { shape: 'circle', radius: 2.2 }, affects: 'enemies', delay: 2, effects: [{ kind: 'damage', amount: 1.8 }] },
            ]),
          },
        ],
      },
    ],
    // 기획 13차 보스 그로기: gauge ×1
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    // 기획 19차 보스 레이드: the one-line 괴담 + the zone (the only additions; numbers unchanged)
    lore: '시계는 계속 23:59. 결재 도장이 혼자 찍힌다.',
    zone: 'office',
  },
  {
    // 기획 19차: 문서 파쇄기 — a black box whose slot is a toothed mouth. The comb fight: stand in the gaps, then step
    // into a strip that already fell. (band 'early')
    id: 'shredder_maw', name: '문서 파쇄기', tier: 'boss', color: '#212529', radius: 3, stationary: true, look: 'shredder_maw',
    stats: { maxHp: 8400, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 세단: six strips (width 2, 2 wide gaps), then the six gaps 0.8 s later
        id: 'sh_comb', name: '세단', cooldown: 13, initialDelay: 4, hint: '빗살 사이가 안전해요 — 지나간 빗살 자리로 옮기세요',
        ...seq([...comb(COMB_A, 1.4, 2.2), ...comb(COMB_B, 2.2, 2.2)]),
      },
      {
        // 종이 날림: a paper-cut fan that leaves a burn (atk 40 % / s for 3 s)
        id: 'sh_cuts', name: '종이 날림', cooldown: 9, initialDelay: 7,
        action: { center: 'target', area: { shape: 'fan', radius: 12, angle: 50 }, affects: 'enemies', delay: 1.1, effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'status', status: 'burn', duration: 3, value: 0.4 }] },
      },
      {
        // 사원증 회수: one big hit on one character (the 저스트 교대 lesson of this boss)
        id: 'sh_badge', name: '사원증 회수', cooldown: 10, initialDelay: 10,
        action: { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 1.4, effects: [{ kind: 'damage', amount: 3.2 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '걸림 해제', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 교차 세단: comb A → B → A, 0.4 s apart
            id: 'sh_cross', name: '교차 세단', cooldown: 14, initialDelay: 1.5,
            ...seq([...comb(COMB_A, 1.2, 1.8), ...comb(COMB_B, 1.6, 1.8), ...comb(COMB_A, 2, 1.8)]),
          },
        ],
      },
    ],
    groggy: { threshold: 0.9 },
    enrage: ENRAGE,
    lore: '서류를 넣으면 아침에 사원증이 조각나 있다. 투입구가 조금씩 넓어진다.',
    zone: 'office',
  },
  {
    // 기획 19차: 식지 않는 커피 머신 — puddles that stay: the arena gets smaller the longer the fight. (band 'early')
    id: 'coffee_machine', name: '식지 않는 커피 머신', tier: 'boss', color: '#adb5bd', radius: 3, stationary: true, look: 'coffee_machine',
    stats: { maxHp: 8800, atk: 29, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 뜨거운 한 잔: a small splash, then a 7 s puddle (damage + slow every 0.5 s)
        id: 'cf_pour', name: '뜨거운 한 잔', cooldown: 9, initialDelay: 4,
        action: { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', delay: 1, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.3 }], zone: { duration: 7, tickInterval: 0.5 } },
      },
      {
        // 스팀: a narrow fan that hits twice (two parts, so the second puff is warned too)
        id: 'cf_steam', name: '스팀', cooldown: 10, initialDelay: 7,
        ...seq(repeat({ center: 'target', area: { shape: 'fan', radius: 13, angle: 36 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.3 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.4 }] }, [1.2, 1.6])),
      },
      {
        // 캡슐 투하: three drops left → right around the target
        id: 'cf_capsules', name: '캡슐 투하', cooldown: 8, initialDelay: 10,
        ...seq(sweep({ center: 'target', area: { shape: 'circle', radius: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] }, [{ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }], 1.2, 0.2)),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '넘침', cooldownMult: 0.85,
        skills: [
          {
            // 넘치는 커피: a ring puddle around the machine for 8 s (the hole next to it and the far field stay dry)
            id: 'cf_overflow', name: '넘치는 커피', cooldown: 16, initialDelay: 1.5,
            action: { center: 'self', area: { shape: 'ring', inner: 4, outer: 7 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.3 }], zone: { duration: 8, tickInterval: 0.5 } },
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '아무도 안 눌렀는데 종이컵이 채워진다. 컵을 치우면 바닥에 바로 내린다.',
    zone: 'office',
  },
  {
    // 기획 19차: 퇴근 못 한 모니터 — pop-up turrets on three fixed spots (rule M4) and a cursor that follows. (band 'mid')
    id: 'dead_monitor', name: '퇴근 못 한 모니터', tier: 'boss', color: '#e9dcc9', radius: 3, stationary: true, look: 'dead_monitor',
    stats: { maxHp: 8600, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 팝업 광고: one 오류 창 on each of three spots (a part's offset also places its summon); a spot whose window is
        // still open gets no second one (spotCap) — at most three turrets, never two on one coordinate
        id: 'dm_popups', name: '팝업 광고', cooldown: 16, initialDelay: 4,
        ...seq(POPUP_SPOTS.map((offset): SkillAction => ({ center: 'self', offset, area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [], summon: { unitId: 'error_popup', count: 1, duration: 0, spotCap: 1 } }))),
      },
      {
        // 커서 추적: an aimed line that keeps following its target until it lands
        id: 'dm_cursor', name: '커서 추적', cooldown: 10, initialDelay: 7, hint: '커서는 끝까지 따라와요 — 교체로 피하세요',
        action: { center: 'target', area: { shape: 'line', length: 16, width: 1.6 }, affects: 'enemies', follow: true, delay: 1.6, effects: [{ kind: 'damage', amount: 2.8 }] },
      },
      {
        // 블루스크린: an X on the target
        id: 'dm_bluescreen', name: '블루스크린', cooldown: 8, initialDelay: 10,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.4, diagonal: true }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.4 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '재부팅 실패', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 팝업 폭주: five small windows in a zigzag over the target, 0.2 s apart
            id: 'dm_storm', name: '팝업 폭주', cooldown: 11, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }] }, [{ x: -4, y: 0 }, { x: -2, y: -2 }, { x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 0 }], 1.2, 0.2)),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '꺼 둔 모니터가 아침마다 켜져 있다. 화면 속 커서가 가끔 나를 따라온다.',
    zone: 'office',
  },
  {
    // 기획 19차: 끝나지 않는 회의 — the longest warning with the biggest single hit, and a shield + haste on itself that
    // a groggy break cancels (rule M1). (band 'late')
    id: 'endless_meeting', name: '끝나지 않는 회의', tier: 'boss', color: '#495057', radius: 3, stationary: true, look: 'endless_meeting',
    // 기획 19차 review: HP 9200 → 7800 — with the 회의 연장 shield it was the one fight that always ran to the enrage
    stats: { maxHp: 7800, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // 발표 지명: one character is called on
        id: 'em_call', name: '발표 지명', cooldown: 9, initialDelay: 4,
        action: { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 3.4 }] },
      },
      {
        // 안건 추가: the middle first, then the ring around the same spot
        id: 'em_agenda', name: '안건 추가', cooldown: 11, initialDelay: 7,
        ...seq([
          { center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 1.6 }] },
          { center: 'target', area: { shape: 'ring', inner: 2, outer: 4.5 }, affects: 'enemies', delay: 2.1, effects: [{ kind: 'damage', amount: 2 }] },
        ]),
      },
      {
        // 회의 연장 (rule M1): a yellow ring for 0.8 s, then a shield of 8 % max HP and 25 % haste for 8 s on the boss
        id: 'em_extend', name: '회의 연장', cooldown: 20, initialDelay: 12,
        action: { center: 'self', area: { shape: 'circle', radius: 3.4 }, affects: 'self', delay: 0.8, effects: [{ kind: 'shield', amount: 0.08, duration: 8 }, { kind: 'status', status: 'haste', duration: 8, value: 0.25 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '연장 회의', cooldownMult: 0.85,
        skills: [
          {
            // 레이저포인터: three thin aimed lines, left → right
            id: 'em_laser', name: '레이저포인터', cooldown: 12, initialDelay: 1.5,
            ...seq(sweep({ center: 'target', area: { shape: 'line', length: 16, width: 1.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }, [{ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }], 1.2, 0.25)),
          },
        ],
      },
    ],
    groggy: { threshold: 1 },
    enrage: ENRAGE,
    lore: '회의실 B. 들어간 사람은 회의가 끝나야 나갈 수 있다. 안건은 매번 하나씩 늘어난다.',
    loreShort: '들어가면 회의가 끝나야 나갈 수 있다.',
    zone: 'office',
  },
];

/** Summon-only units of this zone's bosses (tier 'summon' or 'normal'; look = the key in render/bosses/office.ts OFFICE_MINION_LOOKS). */
export const OFFICE_UNITS: MonsterDef[] = [
  {
    // 기획 19차: 오류 창 — a pop-up window that stays where it opened and shoots like a turret (퇴근 못 한 모니터 only)
    id: 'error_popup', name: '오류 창', tier: 'normal', color: '#0466c8', radius: 0.45, stationary: true, look: 'error_popup',
    stats: { maxHp: 220, atk: 14, def: 0, atkSpeed: 0.8, range: 7, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 9 },
  },
];
