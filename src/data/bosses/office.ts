// 기획 19차 보스 레이드 — 사무실 (6~10층) bosses (docs/bosses.md 2장). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   shredder_maw 문서 파쇄기 (sh_) · coffee_machine 식지 않는 커피 머신 (cf_)
//   dead_monitor 퇴근 못 한 모니터 (dm_) · endless_meeting 끝나지 않는 회의 (em_)
// New summon-only units of this zone: fake_monitor 가짜 창 → OFFICE_UNITS (resolved by getMonster, never in a wave pool).
//
// 기획 20차 보스 형태 (docs/bosses.md 1장 · 4-2): the four new bosses are no longer set pieces at the top centre —
//   문서 파쇄기     roaming, slow to turn, steel in front / paper bin behind (guard) — "drop a character behind it"
//   커피 머신       roaming on a square patrol, leaves a trail of hot coffee (trail) — "fight where it has not walked"
//   퇴근 못 한 모니터 relocating between three desks, leaves a fake window where it sat — "hit the one with the cursor"
//   끝나지 않는 회의  relocating round four chairs, its seat aims its attacks; its call-out is a mark a swap clears
// Every number of a boss is in its entry below (shared form numbers: ./forms.ts). Builders: ./helpers.ts — a moving boss
// uses arenaAt / ahead / chargeAt / relocateTo / rays and rel 'facing' parts; band / row / rowR / at are for fixed bosses.
//
// Rule M1 (boss self-cast): a part with affects 'self' and a delay shows a yellow ring and is broken by groggy.
// Rule M2: telegraphLead on a part = the warning shows only for the last N s. Rule M4: a part's offset also moves its summon.
// Every hit on the party needs a delay (a warning) of at least 0.8 s. To take a boss out of the raid add `raid: false`
// to its entry (docs/boss-raid.md 3-1); after a number change run `npx vite-node tests/review/boss-table.ts write`.
// Checks: tests/sim/bosses-office.test.ts → expectBossContract('<id>') (tests/sim/bossRaidHelpers.ts) + the boss's own
// pattern tests. Soft-lock probe: npx vite-node tests/review/boss-softlock.ts BOSS=<id>
// Tune one boss: npx vite-node tests/review/boss-raid-bench.ts BOSS=<id> RUNS=60

import type { BossDef, Effect, MonsterDef, SkillAction } from '../../types';
import { ENRAGE, ahead, arenaAt, chargeAt, rays, relocateTo, seq, sweep } from './helpers';

// ─────────────────────────── 기획 20차: shared pieces of this zone's patterns ───────────────────────────

/**
 * 문서 파쇄기 · 커피 머신: a cone out of the body, turned with it. rot 0 = out of its front, 180 = out of its back,
 * 90 = to its right, 270 = to its left (rule N2 — authored as "the body faces +x").
 */
function bodyCone(rot: number, radius: number, angle: number, delay: number, effects: Effect[]): SkillAction {
  return { center: 'self', rel: 'facing', area: { shape: 'cone', dir: 'right', rot, radius, angle }, affects: 'enemies', delay, effects };
}

// 문서 파쇄기: the bite out of its mouth and the scraps out of its bin (cone radius · opening angle)
const SH_MOUTH = { radius: 5.5, angle: 110 };
const SH_BIN = { radius: 5, angle: 90 };

// 커피 웅덩이: what every puddle of the machine does each 0.5 s (footprints, 뜨거운 한 잔, 넘치는 커피)
const COFFEE_TICK: Effect[] = [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.3 }];

// 퇴근 못 한 모니터: the three desks (A looks right · B left · C up); 창 닫기 bursts an X on each, in this order
const DM_DESKS: NonNullable<BossDef['spots']> = [{ x: 5, y: 3.5, facing: 'right' }, { x: 19, y: 3.5, facing: 'left' }, { x: 12, y: 9.5, facing: 'up' }];
const DM_CLOSE_DELAYS = [1.2, 1.5, 1.8];

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
    // 기획 20차: 문서 파쇄기 — 배회형 「앞뒤가 있는 보스」. A low black shredder that crawls after the nearest character
    // and turns slowly (60°/s): steel hood in front (damage × 0.5), the paper bin it drags behind is weak (× 1.6).
    // The answer is a swap position: let the tank hold its mouth, drop a dealer behind it. (band 'early')
    id: 'shredder_maw', name: '문서 파쇄기', tier: 'boss', color: '#212529', radius: 1.7, look: 'shredder_maw',
    // 등장: 왼쪽 아래 구석 (기획 20차 통합: 움직이는 보스가 또 맨 위 가운데에 몰려서 옮김)
    form: 'roaming', spawn: { x: 4.5, y: 8.5 }, move: { mode: 'pursue', turnRate: 60 }, signature: 'sh_lunge',
    // 앞 140° ×0.5 (강철 덮개) · 뒤 120° ×1.6 (종이 통). 그로기 중엔 앞 방패가 꺼짐 (rule N5).
    guard: { frontArc: 140, frontMult: 0.5, backArc: 120, backMult: 1.6 },
    // 기획 20차: HP 8400 → 7600 (등 뒤 약점이 생긴 만큼)
    stats: { maxHp: 7600, atk: 30, def: 0.2, atkSpeed: 0.55, range: 1, moveSpeed: 1.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        // 세단: the mouth bites the cone in front of it and leaves a paper-cut burn (atk 40 % / s for 3 s)
        id: 'sh_bite', name: '세단', cooldown: 8, initialDelay: 4, hint: '등 뒤가 약점이에요 — 뒤에 꺼내세요',
        action: bodyCone(0, SH_MOUTH.radius, SH_MOUTH.angle, 1.2, [{ kind: 'damage', amount: 2.8 }, { kind: 'status', status: 'burn', duration: 3, value: 0.4 }]),
      },
      {
        // ★ 급지: a 9-cell lunge at the target; then the paper jams — 3.2 s it can neither walk nor turn (its back is
        // open) — and when the jam clears the body bursts (a circle round it, warned for its last 1.0 s only)
        id: 'sh_lunge', name: '급지', cooldown: 12, initialDelay: 8, hint: '돌진 뒤 3초는 못 돌아요 — 등 뒤로',
        ...seq([
          chargeAt({ distance: 9, width: 3.4, delay: 1.2, recover: 3.2, effects: [{ kind: 'damage', amount: 2.6 }, { kind: 'knockback', distance: 1.5 }] }),
          { center: 'self', follow: true, area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 4.4, telegraphLead: 1, effects: [{ kind: 'damage', amount: 2 }] },
        ]),
      },
      {
        // 파지 배출: scraps blown out of the bin BEHIND it (so a character parked at its back has to leave for a moment)
        id: 'sh_scraps', name: '파지 배출', cooldown: 10, initialDelay: 6, hint: '등 뒤로 종이를 뿜어요 — 잠깐 교체',
        action: bodyCone(180, SH_BIN.radius, SH_BIN.angle, 1.1, [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'slow', duration: 2, value: 0.4 }]),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '걸림 해제', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 역회전: the front cone, then the same cone out of its back 0.7 s later — only its flanks stay safe
            id: 'sh_whirl', name: '역회전', cooldown: 13, initialDelay: 1.5, hint: '앞 다음에 뒤를 물어요 — 옆이 안전',
            ...seq([
              bodyCone(0, SH_MOUTH.radius, SH_MOUTH.angle, 1.1, [{ kind: 'damage', amount: 2.4 }]),
              bodyCone(180, SH_MOUTH.radius, SH_MOUTH.angle, 1.8, [{ kind: 'damage', amount: 2.4 }]),
            ]),
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
    // 기획 20차: 식지 않는 커피 머신 — 배회형 「지나간 길이 남음」. It rounds a square route (0.6 s rest on each corner)
    // and never chases; a taunt pulls it to the tank, then it goes back to the nearest corner. Every 1.2 cells it walks
    // it leaves a coffee puddle (r 1.1, 8 s, at most 14) — about 13 cells of hot trail follow it. (band 'early')
    id: 'coffee_machine', name: '식지 않는 커피 머신', tier: 'boss', color: '#adb5bd', radius: 1.5, look: 'coffee_machine',
    form: 'roaming', spawn: { x: 4, y: 3 }, signature: 'cf_steam',
    move: { mode: 'patrol', waypoints: [{ x: 4, y: 3 }, { x: 20, y: 3 }, { x: 20, y: 9.5 }, { x: 4, y: 9.5 }], dwell: 0.6 },
    // ★ 발자국 (대표 규칙, 패턴이 아님): 캐릭터는 이 줄을 스스로 돌아서 걸음 (rule N8)
    trail: { every: 1.2, max: 14, radius: 1.1, duration: 8, tickInterval: 0.5, look: 'coffee', effects: COFFEE_TICK },
    // 기본 공격 뜨거운 방울: 원거리 (사거리 7), 걸으면서 쏨
    stats: { maxHp: 8800, atk: 29, def: 0.2, atkSpeed: 0.5, range: 7, moveSpeed: 1.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // ★ 스팀: two cones out of its sides (left and right of the way it walks) — its front and its back stay clear
        id: 'cf_steam', name: '스팀', cooldown: 9, initialDelay: 5, hint: '스팀은 양옆 — 앞이나 뒤에 꺼내세요',
        ...seq([90, 270].map(rot => bodyCone(rot, 6, 70, 1.1, [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.4 }]))),
      },
      {
        // 캡슐 투하: three capsules on the road ahead of it — 3, 6 and 9 cells, one after the other
        id: 'cf_capsules', name: '캡슐 투하', cooldown: 11, initialDelay: 9, hint: '머신이 가는 길 앞에 캡슐이 떨어져요',
        ...seq([[3, 1.2], [6, 1.5], [9, 1.8]].map(([d, delay]): SkillAction => ({ ...ahead(d), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay, effects: [{ kind: 'damage', amount: 2.2 }] }))),
      },
      {
        // 뜨거운 한 잔: a splash on the target's spot that stays as a puddle for 7 s
        id: 'cf_pour', name: '뜨거운 한 잔', cooldown: 10, initialDelay: 7, hint: '바닥 커피는 캐릭터가 알아서 피해요',
        action: { center: 'target', area: { shape: 'circle', radius: 2.6 }, affects: 'enemies', delay: 1, effects: COFFEE_TICK, zone: { duration: 7, tickInterval: 0.5 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '넘침', cooldownMult: 0.85,
        skills: [
          {
            // 넘치는 커피: a ring puddle round the spot where the machine stands, for 8 s. The hole is wide enough for a
            // character that touches the body (body 1.5 + character 0.45 + melee reach 0.7 = 2.65 < 3.2 − 0.45): the
            // tip 「바로 옆」 holds. (docs/bosses.md 4-2 first guess was 2–5.5 — a hole nobody could stand in.)
            id: 'cf_overflow', name: '넘치는 커피', cooldown: 16, initialDelay: 1.5, hint: '바로 옆이나 고리 바깥이 안전해요',
            action: { center: 'self', area: { shape: 'ring', inner: 3.2, outer: 6.5 }, affects: 'enemies', delay: 1.5, effects: COFFEE_TICK, zone: { duration: 8, tickInterval: 0.5 } },
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
    // 기획 20차: 퇴근 못 한 모니터 — 자리 이동형 「가짜 창」. A CRT that sits on one of three desks (A → B → C → A) and
    // leaves a fake window on the desk it left. The real one has the blinking cursor (and the HP bar). (band 'mid')
    id: 'dead_monitor', name: '퇴근 못 한 모니터', tier: 'boss', color: '#e9dcc9', radius: 1.6, stationary: true, look: 'dead_monitor',
    form: 'relocating', signature: 'dm_alt_tab', spots: DM_DESKS,
    // 기획 20차 점검: 자리를 옮긴 뒤 4초 동안은 「보스」 표시가 안 뜸 (가짜 창이 서 있는 동안) — 커서를 보고 찾아야 함
    decoy: { unit: 'fake_monitor', hide: 4 },
    stats: { maxHp: 8600, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // ★ 창 전환: a fake window opens where it sits (one per desk, gone after 11 s) and the next desk is warned for
        // 1.2 s — then the screen is there and the circle round that desk is hit (「부팅」)
        id: 'dm_alt_tab', name: '창 전환', cooldown: 12, initialDelay: 6, hint: '커서가 깜빡이는 화면이 진짜예요',
        ...seq([
          { center: 'self', area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [], summon: { unitId: 'fake_monitor', count: 1, duration: 11, spotCap: 1 } },
          relocateTo({ radius: 3.2, delay: 1.2, effects: [{ kind: 'damage', amount: 2.2 }] }),
        ]),
      },
      {
        // 커서 추적: a line from the screen that keeps following its target until it lands — long enough for any desk
        id: 'dm_cursor', name: '커서 추적', cooldown: 10, initialDelay: 7.5, hint: '커서는 따라와요 — 교체로 피하세요',
        action: { center: 'target', area: { shape: 'line', length: 27, width: 1.6 }, affects: 'enemies', follow: true, delay: 1.6, effects: [{ kind: 'damage', amount: 2.8 }] },
      },
      {
        // 블루스크린: an X through the target that slows (기획 19차 그대로)
        id: 'dm_bluescreen', name: '블루스크린', cooldown: 9, initialDelay: 9,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.4, diagonal: true }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.4 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }] },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '재부팅 실패', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 창 닫기: an X bursts on all three desks, A → B → C — stand off a desk's diagonals
            id: 'dm_close', name: '창 닫기', cooldown: 11, initialDelay: 1.5, hint: 'X자로 터져요 — 책상 옆·위아래로',
            ...seq(DM_DESKS.map((desk, i): SkillAction => ({ ...arenaAt(desk.x, desk.y), area: { shape: 'cross', length: 6, width: 1.5, diagonal: true }, affects: 'enemies', delay: DM_CLOSE_DELAYS[i], effects: [{ kind: 'damage', amount: 2.2 }] }))),
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
    // 기획 20차: 끝나지 않는 회의 — 자리 이동형 「앉은 자리가 방향」. A faceless chairman on a wheeled chair who moves
    // round four seats (E → S → W → N); what he hands out flies the way his seat faces. His call-out is a mark: swap
    // the named character out and it is gone (rule N6). (band 'late')
    id: 'endless_meeting', name: '끝나지 않는 회의', tier: 'boss', color: '#495057', radius: 1.7, stationary: true, look: 'endless_meeting',
    form: 'relocating', signature: 'em_call',
    // 의장석 4곳 (동 · 남 · 서 · 북, 시계 방향), 동쪽(오른쪽)에서 시작 (기획 20차 통합: 움직이는 보스가 또 맨 위 가운데에 몰려서 옮김)
    spots: [{ x: 21, y: 6, facing: 'left' }, { x: 12, y: 10, facing: 'up' }, { x: 3, y: 6, facing: 'right' }, { x: 12, y: 3, facing: 'down' }],
    // 기획 20차: 회의 연장 (보호막 · 가속)이 없어진 만큼 HP 7800 → 8400
    stats: { maxHp: 8400, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // ★ 발표 지명: a 3.5 s mark on one character — the big hit on it and a ring round it. Both parts are bound to
        // that character: when it leaves the field the whole mark is dropped, nobody is hit
        id: 'em_call', name: '발표 지명', cooldown: 10, initialDelay: 4, hint: '지명된 캐릭터를 교체로 빼세요',
        ...seq([
          { center: 'target', area: { shape: 'single' }, affects: 'enemies', bound: true, delay: 3.5, effects: [{ kind: 'damage', amount: 3.4 }] },
          { center: 'target', area: { shape: 'ring', inner: 1, outer: 3.2 }, affects: 'enemies', bound: true, delay: 3.5, effects: [{ kind: 'damage', amount: 1.8 }] },
        ]),
      },
      {
        // 자리 이동: the next seat is warned for 1.3 s and hit as he rolls onto it; then 「안건 배포」 — three strips out
        // of the NEW seat the way it faces (straight and ± 25°), shown for their last 1.2 s
        id: 'em_move', name: '자리 이동', cooldown: 14, initialDelay: 8, hint: '안건 세 갈래 — 사이나 의장 뒤로',
        ...seq([
          relocateTo({ radius: 2.8, delay: 1.3, effects: [{ kind: 'damage', amount: 2 }] }),
          ...rays({ angles: [-25, 0, 25], length: 24, width: 2, delays: [2.5], lead: 1.2, follow: true, effects: [{ kind: 'damage', amount: 2.2 }] }),
        ]),
      },
      {
        // 안건 추가: the middle first, then the ring around the same spot (기획 19차 그대로)
        id: 'em_agenda', name: '안건 추가', cooldown: 11, initialDelay: 6.5, hint: '가운데 다음에 둘레가 터져요',
        ...seq([
          { center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 1.3, effects: [{ kind: 'damage', amount: 1.6 }] },
          { center: 'target', area: { shape: 'ring', inner: 2, outer: 4.5 }, affects: 'enemies', delay: 2.1, effects: [{ kind: 'damage', amount: 2 }] },
        ]),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '연장 회의', cooldownMult: 0.85,
        skills: [
          {
            // 레이저포인터: five thin lines out of his seat, wiping from −50° to +50° like a wiper (0.3 s apart, each
            // shown for its last 0.9 s); a character is hit once per cast
            id: 'em_laser', name: '레이저포인터', cooldown: 12, initialDelay: 1.5, hint: '레이저가 지나간 쪽으로 교체',
            ...seq(rays({ angles: [-50, -25, 0, 25, 50], length: 26, width: 1.4, delays: [1.2, 1.5, 1.8, 2.1, 2.4], lead: 0.9, once: true, effects: [{ kind: 'damage', amount: 2 }] })),
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
    // 기획 20차: 가짜 창 — what 퇴근 못 한 모니터 leaves on the desk it left (창 전환; 오류 창 `error_popup`을 대신함). As big
    // as the real screen, but frozen on an hourglass, no cursor, no cables. It shoots like a turret and, left alone,
    // files an 「오류 보고」: a circle round its desk. Gone after 11 s (the summon's duration).
    id: 'fake_monitor', name: '가짜 창', tier: 'normal', color: '#cfc4b2', radius: 1.3, stationary: true, look: 'fake_monitor',
    stats: { maxHp: 240, atk: 12, def: 0, atkSpeed: 0.7, range: 9, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 9 },
    skills: [
      {
        id: 'fm_crash', name: '오류 보고', cooldown: 7, initialDelay: 3.5,
        action: { center: 'self', area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', delay: 1.6, effects: [{ kind: 'damage', amount: 1.8 }] },
      },
    ],
  },
];
