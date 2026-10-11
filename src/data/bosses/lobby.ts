// 기획 19차 보스 레이드 — 로비·상가 (1~5층) bosses (docs/bosses.md 2장 · 4-1). The zone's classic boss comes first and is unchanged
// (moved from monsters.ts; + lore + zone). The four new bosses of this zone go below it, in this file only:
//   claw_machine 인형 뽑기 기계 (cm_) · washer_drum 혼자 도는 세탁기 (wd_)
//   karaoke_room 지하 7번 노래방 (kr_) · reverse_escalator 거꾸로 가는 에스컬레이터 (re_)
// New summon-only units of this zone: prize_doll 뽑기 인형, lost_sock 외짝 양말 → LOBBY_UNITS (resolved by getMonster, never in a wave pool).
//
// 기획 20차 boss forms (docs/bosses.md 1장 · 4-1): claw_machine and washer_drum are 'roaming' (a body that walks the arena),
// karaoke_room is 'fixed' (the set piece at the top centre, as in 기획 19차), reverse_escalator is 'arena' (the whole floor
// is its stage; a small core rides a path). The classic boss has no form field at all — it plays exactly as before.
// Shape of an entry by form (full examples: docs/bosses.md 1-4; shared numbers: ./forms.ts; builders: ./helpers.ts):
//   roaming : radius 1.4–1.7, form, spawn, move { mode: 'pursue' | 'keepAway' | 'patrol', … }, stats.moveSpeed / range, basic
//   fixed   : radius 3, stationary: true, form: 'fixed', stats.range 40 / moveSpeed 0 — band / row / rowR / at are valid here only
//   arena   : radius 1.3–1.8, form, spawn, stage { floor }, move { mode: 'path', waypoints } (or 'pursue')
//   every form: 3 skills + phases: [{ hpBelow, name, cooldownMult, skills: [ exactly one ] }], signature = one of its skill
//   ids, groggy, enrage: ENRAGE, lore, zone: 'lobby'. A moving boss places its parts with center 'self' (its body),
//   arenaAt(x, y) (an arena coordinate), ahead(d) (relative to where it faces) or chargeAt({ … }) (a rush).
// Rule M1 (boss self-cast): a part with affects 'self' and a delay shows a yellow ring and is broken by groggy.
// Rule M2: telegraphLead on a part = the warning shows only for the last N s. Rule M4: a part's offset also moves its summon.
// Every hit on the party needs a delay (a warning) of at least 0.8 s. To take a boss out of the raid add `raid: false`
// to its entry (docs/boss-raid.md 3-1); after a number change run `npx vite-node tests/review/boss-table.ts write`.
// Checks: tests/sim/bosses-lobby.test.ts → expectBossContract('<id>') (tests/sim/bossRaidHelpers.ts) + the boss's own
// pattern tests on raidGame('<id>', { hpMult: 50, tunables: { invincible: true } }).
// Tune one boss: npx vite-node tests/review/boss-raid-bench.ts BOSS=<id> RUNS=60

import type { AreaShape, BossDef, Dir, Effect, MonsterDef, SkillAction } from '../../types';
import { ENRAGE, arenaAt, band, chargeAt, repeat, seq, spokes, sweep } from './helpers';

// 기획 20차 (docs/bosses.md 4-1): the four new bosses below were rebuilt on the boss forms — 인형 뽑기 기계 and 혼자 도는
// 세탁기 roam the arena, 지하 7번 노래방 stays the place itself (its beam turns around the arena centre), 거꾸로 가는
// 에스컬레이터 is the whole floor with a small core riding the stairs. Every number of a pattern is in this file.

// ── 인형 뽑기 기계 ──
/** The machine's row and column (집게 내리기 · 잭팟): a '+' through the body — arm length and bar width. */
const CM_ARMS = { length: 10, width: 2.4 };
/** The '+' (or the 'X' when diagonal) through the machine, as a part. */
const cmCross = (delay: number, effects: Effect[], diagonal = false): SkillAction => ({
  center: 'self',
  area: { shape: 'cross', ...CM_ARMS, ...(diagonal ? { diagonal: true } : null) },
  affects: 'enemies',
  delay,
  effects,
});
/** 동전 투입: one coin lane out of the machine in each direction, in this order (always along the world's row / column). */
const CM_COIN_DIRS: Dir[] = ['right', 'down', 'left', 'up'];
const CM_COIN_DELAYS = [1, 1.35, 1.7, 2.05];
const CM_COIN_LANE = { length: 11, width: 2.2 };

// ── 혼자 도는 세탁기 ──
/** 탈수 돌진 / 역회전 돌진: the rush runs until the wall of the boss box (any distance longer than the arena). */
const WD_ROLL = { distance: 30, width: 3.2 };
/**
 * 「쿵」 after 탈수 돌진: the ring around the spot it stopped on. The hole (inner) is what makes "hug the washer" safe:
 * a melee character fighting the body (radius 1.6) stands about 2.7 from its centre and a hit reaches 0.45 into a
 * character, so the hole has to be wider than 3.15 (docs/bosses.md's first guess of 2.4 would hit everyone who can
 * stand next to it). The outer edge is at least twice the hole, so the ring survives 「보스 범위 크기 배율」 ×0.5.
 */
const WD_THUD: AreaShape = { shape: 'ring', inner: 3.3, outer: 7 };
/** 역회전 돌진: the opposite — the circle right around the washer. */
const WD_THUD_BACK: AreaShape = { shape: 'circle', radius: 3.4 };

// ── 지하 7번 노래방 ──
/** A boss's wind-up on itself (rule M1): the yellow ring around it. */
const SELF_RING: AreaShape = { shape: 'circle', radius: 3.4 };
/** 미러볼: the arena centre the beam turns around. */
const KR_PIVOT = { x: 12, y: 6 };

// ── 거꾸로 가는 에스컬레이터 ──
/** A part over an arena rectangle given by its middle (x, y) and its size along x / y — the stairs are the whole floor. */
const reBlock = (x: number, y: number, w: number, h: number, delay: number, effects: Effect[]): SkillAction => ({
  ...arenaAt(x, y),
  area: { shape: 'rect', dir: 'right', anchor: 'center', length: w, width: h },
  affects: 'enemies',
  delay,
  effects,
});
/** The whole staircase shoves everyone `distance` cells one way (no damage). */
const reShove = (delay: number, distance: number, dir: Dir): SkillAction => reBlock(12, 6, 24, 12, delay, [{ kind: 'knockback', distance, dir }]);
/** The stair rows are 2.4 high: the bottom row is y 9.6–12, the top row y 0–2.4. */
const RE_ROW = 2.4;
/** 틈 / 맨 윗줄에 낀 피해. */
const RE_CRUSH = 2.6;
/** 손잡이: width of the band along each side wall (x 0–3 and 21–24). */
const RE_RAIL = 3;

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
    // 기획 20차: 인형 뽑기 기계 — 배회형 「집게 게임처럼 움직임」. 기계와 같은 가로·세로 줄만 위험 → 대각선 자리에 꺼내기.
    id: 'claw_machine', name: '인형 뽑기 기계', tier: 'boss', color: '#ffb3c6', radius: 1.7, look: 'claw_machine',
    // 가로 먼저, 그다음 세로로만 미끄러짐. 가장 먼 캐릭터를 노림 (6초마다 다시 고름). 기본 공격: 동전 던지기 (사거리 3 —
    // 기획 20차 점검: 5였을 땐 한 줄에서 모두 닿아 세로로는 한 번도 안 움직였음. 다시 고를 때마다 「가로 먼저」와 「세로 먼저」를
    // 번갈아서(axisAlternate) 위아래로도 다님)
    // 등장: 왼쪽 벽 가운데 (기획 20차 통합: 움직이는 보스가 또 맨 위 가운데에 몰려서 옮김)
    form: 'roaming', spawn: { x: 4, y: 5.5 }, move: { mode: 'pursue', target: 'farthest', retarget: 6, axis: true, axisAlternate: true }, signature: 'cm_grab',
    stats: { maxHp: 8200, atk: 30, def: 0.2, atkSpeed: 0.5, range: 3, moveSpeed: 2.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // ★ 기계 중심 십자(+)가 기계 쪽으로 끌어당기고(피해 없음), 0.8초 뒤 기계 둘레에 집게가 떨어짐
        id: 'cm_grab', name: '집게 내리기', cooldown: 9, initialDelay: 4, hint: '기계와 대각선 자리에 꺼내세요',
        ...seq([
          cmCross(1.2, [{ kind: 'pull', distance: 4.5 }]),
          { center: 'self', area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', delay: 2, effects: [{ kind: 'damage', amount: 3 }] },
        ]),
      },
      {
        // 기계에서 오른쪽 → 아래 → 왼쪽 → 위로 동전 줄 4개 (0.35초 간격)
        id: 'cm_coins', name: '동전 투입', cooldown: 8, initialDelay: 7, hint: '동전은 가로·세로 줄로만 날아가요',
        ...seq(CM_COIN_DIRS.map((dir, i): SkillAction => ({ center: 'self', area: { shape: 'rect', dir, ...CM_COIN_LANE }, affects: 'enemies', delay: CM_COIN_DELAYS[i], effects: [{ kind: 'damage', amount: 1.8 }] }))),
      },
      {
        id: 'cm_prizes', name: '경품 배출', cooldown: 15, initialDelay: 10,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'prize_doll', count: 3, countMax: 4, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '잭팟', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 대각선(X) 먼저, 0.8초 뒤 가로·세로(+)
            id: 'cm_jackpot', name: '잭팟', cooldown: 12, initialDelay: 1.5, hint: '대각선 먼저, 그다음 가로·세로',
            ...seq([cmCross(1.3, [{ kind: 'damage', amount: 2.4 }], true), cmCross(2.1, [{ kind: 'damage', amount: 2.4 }])]),
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
    // 기획 20차: 혼자 도는 세탁기 — 배회형 「굴러다님」. 벽까지 돌진 → 부딪힌 뒤엔 붙으면 안전 (2페이즈는 반대).
    id: 'washer_drum', name: '혼자 도는 세탁기', tier: 'boss', color: '#8fb3c7', radius: 1.6, look: 'washer_drum',
    // 가장 먼 캐릭터 쪽으로 굴러감 (5초마다 다시 고름 → 파티 사이를 가로지름). 기본 공격: 몸통 박치기 (근접 0.9, 주변 1.2)
    form: 'roaming', spawn: { x: 20, y: 3.5 }, move: { mode: 'pursue', target: 'farthest', retarget: 5 }, signature: 'wd_roll',
    stats: { maxHp: 8800, atk: 29, def: 0.2, atkSpeed: 0.5, range: 0.9, moveSpeed: 2.2, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1.2 },
    skills: [
      {
        // ★ 대상 쪽으로 벽까지 돌진, 그 뒤 「쿵」: 도착한 자리 둘레 고리 (세탁기 곁은 안 맞음)
        id: 'wd_roll', name: '탈수 돌진', cooldown: 10, initialDelay: 4, hint: '부딪힌 뒤엔 세탁기에 바짝 붙기',
        ...seq([
          chargeAt({ ...WD_ROLL, delay: 1.3, effects: [{ kind: 'damage', amount: 2.6 }, { kind: 'knockback', distance: 1.5 }] }),
          { center: 'self', follow: true, area: WD_THUD, affects: 'enemies', delay: 2.2, telegraphLead: 0.9, effects: [{ kind: 'damage', amount: 2 }] },
        ]),
      },
      {
        // 거품 웅덩이가 5초 남음 (0.5초마다) — 캐릭터가 알아서 돌아감
        id: 'wd_suds', name: '거품', cooldown: 11, initialDelay: 7, hint: '바닥 거품은 캐릭터가 알아서 피해요',
        action: { center: 'target', area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', delay: 0.9, effects: [{ kind: 'damage', amount: 0.3 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }], zone: { duration: 5, tickInterval: 0.5 } },
      },
      {
        id: 'wd_socks', name: '한 짝 양말', cooldown: 14, initialDelay: 10,
        action: { center: 'self', area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [], summon: { unitId: 'lost_sock', count: 3, countMax: 4, duration: 0 } },
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '헹굼 실패', cooldownMult: 0.85,
        skills: [
          {
            // 같은 돌진, 그 뒤가 반대: 도착한 자리 둘레 원 (세탁기 곁이 맞음)
            id: 'wd_roll_back', name: '역회전 돌진', cooldown: 11, initialDelay: 1.5, hint: '역회전: 부딪힌 뒤엔 멀리 떨어지기',
            ...seq([
              chargeAt({ ...WD_ROLL, delay: 1.1, effects: [{ kind: 'damage', amount: 2.4 }, { kind: 'knockback', distance: 1.5 }] }),
              { center: 'self', follow: true, area: WD_THUD_BACK, affects: 'enemies', delay: 2, telegraphLead: 0.9, effects: [{ kind: 'damage', amount: 2.2 }] },
            ]),
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
    // 기획 20차: 지하 7번 노래방 — 고정형 「장소가 보스」. 맵 한가운데 미러볼 빛줄기가 돎 + 고음 뒤 「간주」 폭딜 창 (규칙 M1).
    id: 'karaoke_room', name: '지하 7번 노래방', tier: 'boss', color: '#2b2d42', radius: 3, stationary: true, look: 'karaoke_room',
    form: 'fixed', signature: 'kr_mirror',
    stats: { maxHp: 8600, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // ★ 맵 가운데를 지나는 빛줄기 한 줄이 시계 방향으로 30°씩 6번 (각 줄 마지막 0.9초만 예고, 한 번만 맞음)
        id: 'kr_mirror', name: '미러볼', cooldown: 13, initialDelay: 4, hint: '빛이 지나간 쪽으로 교체하세요',
        ...seq(spokes({ pivot: KR_PIVOT, from: 0, step: 30, count: 6, arms: 1, length: 22, width: 1.8, first: 1.5, gap: 0.45, lead: 0.9, effects: [{ kind: 'damage', amount: 1.8 }] })),
      },
      {
        // 같은 자리에 0.5초 간격 3연타 (조각 셋 — 박자마다 예고가 따로 보임)
        id: 'kr_beat', name: '박자', cooldown: 9, initialDelay: 6, hint: '세 번 쳐요 — 맞았으면 바로 교체',
        ...seq(repeat({ center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] }, [1.2, 1.7, 2.2])),
      },
      {
        // 부채꼴 고음, 0.1초 뒤 간주: 보스 자신에게 취약 +30% 4초
        id: 'kr_high_note', name: '고음', cooldown: 12, initialDelay: 8, hint: '간주 4초 동안 보스가 더 아파요',
        ...seq([
          { center: 'target', area: { shape: 'fan', radius: 14, angle: 40 }, affects: 'enemies', delay: 1.5, effects: [{ kind: 'damage', amount: 3 }] },
          { center: 'self', area: SELF_RING, affects: 'self', delay: 1.6, effects: [{ kind: 'status', status: 'vulnerable', duration: 4, value: 0.3 }] },
        ]),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '앙코르', atkSpeedMult: 1.15, cooldownMult: 0.85,
        skills: [
          {
            // 십자 빛(두 줄)이 반시계로 30°씩 3번
            id: 'kr_mirror_back', name: '앙코르 미러볼', cooldown: 13, initialDelay: 1.5, hint: '이번엔 십자 빛이 거꾸로 돌아요',
            ...seq(spokes({ pivot: KR_PIVOT, from: 0, step: -30, count: 3, arms: 2, length: 22, width: 1.6, first: 1.3, gap: 0.5, lead: 0.9, effects: [{ kind: 'damage', amount: 1.8 }] })),
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
    // 기획 20차: 거꾸로 가는 에스컬레이터 — 전장형 「맵 전체가 계단」. 계단 전체가 쏠림(아래 / 위) → 쏠리는 반대쪽 절반에 꺼내기.
    id: 'reverse_escalator', name: '거꾸로 가는 에스컬레이터', tier: 'boss', color: '#6c757d', radius: 1.3, look: 'reverse_escalator',
    // 핵 「틈새의 손」이 계단을 타고 네모 길을 돎 (시전 중엔 멈춤). 기본 공격: 원거리
    form: 'arena', spawn: { x: 5, y: 3.5 }, stage: { floor: 'escalator' }, signature: 're_lurch',
    move: { mode: 'path', waypoints: [{ x: 5, y: 3.5 }, { x: 5, y: 9.5 }, { x: 19, y: 9.5 }, { x: 19, y: 3.5 }] },
    stats: { maxHp: 9000, atk: 30, def: 0.2, atkSpeed: 0.5, range: 40, moveSpeed: 1, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 11 },
    skills: [
      {
        // ★ 계단 전체가 아래로 쏠림(피해 없음) → 0.8초 뒤 맨 아래 줄 「틈」
        id: 're_lurch', name: '덜컹', cooldown: 10, initialDelay: 4, hint: '아래로 쏠려요 — 위쪽 절반에 꺼내기',
        ...seq([
          reShove(1.2, 3.5, 'down'),
          reBlock(12, 12 - RE_ROW / 2, 24, RE_ROW, 2, [{ kind: 'damage', amount: RE_CRUSH }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }]),
        ]),
      },
      {
        // 이번엔 위로 쏠림 → 맨 윗줄
        id: 're_stop', name: '비상정지', cooldown: 12, initialDelay: 9, hint: '위로 쏠려요 — 아래쪽 절반이 안전',
        ...seq([reShove(1.2, 3.5, 'up'), reBlock(12, RE_ROW / 2, 24, RE_ROW, 2, [{ kind: 'damage', amount: RE_CRUSH }])]),
      },
      {
        // 양옆 세로 띠(가로 0~3, 21~24)가 가운데 쪽으로 밀어냄 — 왼쪽 먼저, 0.3초 뒤 오른쪽 (같이 떨어지면 예고의 차례 화살표가
        // 「왼쪽에서 오른쪽으로 쓸고 간다」로 읽혀서, 실제로 차례를 둠)
        id: 're_handrail', name: '손잡이', cooldown: 11, initialDelay: 6.5, hint: '손잡이가 조여요 — 가운데 줄로',
        ...seq([
          reBlock(RE_RAIL / 2, 6, RE_RAIL, 12, 1.3, [{ kind: 'damage', amount: 1.8 }, { kind: 'knockback', distance: 3, dir: 'right' }]),
          reBlock(24 - RE_RAIL / 2, 6, RE_RAIL, 12, 1.6, [{ kind: 'damage', amount: 1.8 }, { kind: 'knockback', distance: 3, dir: 'left' }]),
        ]),
      },
    ],
    phases: [
      {
        hpBelow: 0.5, name: '추락 계단', cooldownMult: 0.85,
        skills: [
          {
            // 아래로 3칸씩 두 번 → 아래 두 줄 가까이(세로 8.4~12)
            id: 're_lurch_twice', name: '연속 덜컹', cooldown: 13, initialDelay: 1.5, hint: '두 번 쏠려요 — 맨 위 계단으로',
            ...seq([
              reShove(1.1, 3, 'down'),
              reShove(1.9, 3, 'down'),
              reBlock(12, 12 - RE_ROW * 0.75, 24, RE_ROW * 1.5, 2.7, [{ kind: 'damage', amount: RE_CRUSH }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }]),
            ]),
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
