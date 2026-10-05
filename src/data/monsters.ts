import type { BossDef, MonsterDef, MonsterSkill, SkillAction } from '../types';

// 기획 8차 (2026-10-04): 괴담 / 이상현상 빌딩 — "역류하는 빌딩". 파티는 일상 공간이 뒤틀린 고층 빌딩을 옥상까지 오름.
// 층 구역(FloorPlan.theme): 1–5 로비·상가 · 6–10 사무실 · 11–15 폐병동 · 16–20 옥상·이계. 자세한 표: docs/content-20f.md.
// 이름·모습은 모두 오리지널 이상현상 + 널리 알려진 한국 도시 괴담에서 따옴 (다른 게임의 캐릭터·몬스터 이름은 쓰지 않음).
//
// 수치는 1층 기준. 층마다 FloorPlan.statMult(기본 +12%/층)가 HP·공격력에 곱해짐.
// 1~5층 일반몹 5종·중형보스 2종은 id를 그대로 두고 모습만 바꿈 (수치도 그대로: 2026-10-04 플레이테스트 반영값).
// `look` = render가 그리는 모습 키. 새 형태(기획 8차): fan(시전자→대상 부채꼴), charge(예고 뒤 돌진), blink(대상 옆으로 순간이동),
// onDeath(죽으면 분열), BossDef.phases(HP 구간마다 패턴 추가).

const ENRAGE: BossDef['enrage'] = { atkMult: 1.6, atkSpeedMult: 1.5, cooldownMult: 0.6, summonCountMult: 1.5 };

/** A sweep: the same action repeated at several world offsets, `step` seconds apart (boss sequences, `extra`). */
function sweep(base: SkillAction, offsets: { x: number; y: number }[], firstDelay: number, step: number): SkillAction[] {
  return offsets.map((offset, i) => ({ ...base, offset, delay: Math.round((firstDelay + i * step) * 1000) / 1000 }));
}

function seq(parts: SkillAction[]): Pick<MonsterSkill, 'action' | 'extra'> {
  return { action: parts[0], extra: parts.slice(1) };
}

// ─────────────────────────── 일반몹 ───────────────────────────

export const MONSTERS: MonsterDef[] = [
  // ── 로비·상가층 (1~5층): 원래 5종, 수치 그대로 ──
  {
    id: 'slime', name: '외발 우산', tier: 'normal', color: '#74c69d', radius: 0.4, look: 'umbrella',
    // 비 오는 날 혼자 깡충깡충 따라오는 우산. 느리고 무름.
    stats: { maxHp: 150, atk: 15, def: 0, atkSpeed: 0.8, range: 0.4, moveSpeed: 2.0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
  {
    id: 'goblin', name: '그림자 아이', tier: 'normal', color: '#a7c957', radius: 0.35, look: 'shadow_kid',
    // 복도 끝에서 뛰어오는 아이 그림자. 빠르고 자주 때림.
    stats: { maxHp: 112, atk: 17.5, def: 0, atkSpeed: 1.2, range: 0.4, moveSpeed: 3.6, critChance: 0.05, critMult: 1.5 },
    basic: { kind: 'melee' },
  },
  {
    id: 'skeleton_archer', name: '자판기 미믹', tier: 'normal', color: '#e9ecef', radius: 0.35, look: 'vending',
    // 동전을 넣지 않았는데 캔을 던지는 자판기 (원거리).
    stats: { maxHp: 100, atk: 20, def: 0, atkSpeed: 0.7, range: 5, moveSpeed: 2.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 10 },
  },
  {
    id: 'bomb_bug', name: '울리는 전화', tier: 'normal', color: '#ffb703', radius: 0.3, look: 'phone',
    // 받으면 안 되는 전화. 달려와서 터짐.
    stats: { maxHp: 62, atk: 25, def: 0, atkSpeed: 1, range: 0.2, moveSpeed: 4.2, critChance: 0, critMult: 1 },
    basic: { kind: 'explode', radius: 1.6, amount: 3 },
  },
  {
    id: 'golem', name: '웃는 마네킹', tier: 'normal', color: '#8d99ae', radius: 0.6, look: 'mannequin',
    // 쇼윈도에서 걸어 나온 마네킹. 느리고 단단, 주변까지 휩씀.
    stats: { maxHp: 500, atk: 35, def: 0.2, atkSpeed: 0.5, range: 0.5, moveSpeed: 1.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1 },
  },

  // ── 사무실층 (6~10층) ──
  {
    id: 'overtime_ghost', name: '야근 유령', tier: 'normal', color: '#9bb7d4', radius: 0.4, look: 'overtime_ghost',
    // 퇴근하지 못한 사람. 둥둥 떠서 느린 원거리 공격 + 가끔 서류 더미를 떨어뜨림 (둔화).
    stats: { maxHp: 140, atk: 18, def: 0, atkSpeed: 0.5, range: 6, moveSpeed: 1.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 6, splashRadius: 0.8 },
    skills: [
      {
        id: 'ghost_papers', name: '서류 더미', cooldown: 8, initialDelay: 4, castRange: 6,
        action: { center: 'target', area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }] },
      },
    ],
  },
  {
    id: 'copy_man', name: '복사 인간', tier: 'normal', color: '#ced4da', radius: 0.42, look: 'copy_man',
    // 복사기에서 나온 똑같은 얼굴. 쓰러지면 복사본 2개로 갈라짐.
    stats: { maxHp: 190, atk: 16, def: 0, atkSpeed: 1, range: 0.4, moveSpeed: 2.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    onDeath: { summon: { unitId: 'copy_mini', count: 2 } },
  },
  {
    id: 'copy_mini', name: '복사본', tier: 'normal', color: '#e9ecef', radius: 0.28, look: 'copy_mini',
    // 복사 인간이 갈라진 작은 복사본 (복사 인간만 만듦, 웨이브에는 없음). 작고 약하지만 처치해야 층이 끝남.
    stats: { maxHp: 55, atk: 9, def: 0, atkSpeed: 1.2, range: 0.35, moveSpeed: 3.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
  },

  // ── 폐병동층 (11~15층) ──
  {
    id: 'iv_zombie', name: '링거 환자', tier: 'normal', color: '#b5c99a', radius: 0.45, look: 'iv_zombie',
    // 링거대를 끌고 다니는 환자. 근접 + 주변 괴이를 회복 (보스는 회복 안 됨). 기획 8차 리뷰: 수액 6 → 4% (수간호사 층이 늘어짐).
    stats: { maxHp: 260, atk: 18, def: 0.05, atkSpeed: 0.7, range: 0.45, moveSpeed: 1.8, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        id: 'zombie_drip', name: '수액 공급', cooldown: 7, initialDelay: 4,
        action: { center: 'self', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.04 }] },
      },
    ],
  },
  {
    id: 'wheelchair_rush', name: '질주 휠체어', tier: 'normal', color: '#adb5bd', radius: 0.45, look: 'wheelchair',
    // 아무도 타지 않은 휠체어. 빨간 줄로 예고한 뒤 그 줄을 따라 돌진.
    stats: { maxHp: 180, atk: 20, def: 0.05, atkSpeed: 0.8, range: 0.45, moveSpeed: 2.2, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        id: 'wheelchair_charge', name: '폭주', cooldown: 6, initialDelay: 2.5, castRange: 8,
        action: { center: 'target', area: { shape: 'line', length: 9, width: 1.4 }, affects: 'enemies', delay: 1, charge: { distance: 9, duration: 0.3 }, effects: [{ kind: 'damage', amount: 2.4 }, { kind: 'knockback', distance: 1.5 }] },
      },
    ],
  },
  {
    id: 'nurse_doll', name: '간호 인형', tier: 'normal', color: '#ffc8dd', radius: 0.35, look: 'nurse_doll',
    // 고개가 돌아가는 간호사 인형. 대상 바로 옆으로 순간이동 → 잠깐 뒤 주사 (둔화). 이때 기절시키면 끊김.
    // 기획 8차 리뷰: 예고 0.6 → 0.8초 (0.6초는 사람 반응 한계라 교체로 거의 못 피함 → 급사 절반)
    stats: { maxHp: 150, atk: 20, def: 0, atkSpeed: 1, range: 0.4, moveSpeed: 2.4, critChance: 0.05, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        id: 'doll_needle', name: '주사 바늘', cooldown: 8, initialDelay: 3, castRange: 9,
        action: { center: 'self', area: { shape: 'circle', radius: 1.3 }, affects: 'enemies', delay: 0.8, blink: { offset: 0.3 }, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.4 }] },
      },
    ],
  },

  // ── 옥상·이계 (16~20층) ──
  {
    id: 'eye_stalk', name: '눈알 줄기', tier: 'normal', color: '#e5383b', radius: 0.5, look: 'eye_stalk',
    // 바닥 틈에서 자란 눈알. 뿌리째 아주 느리게 기어 오고, 대상 쪽으로 부채꼴 시선을 뿜음. 쓰러지면 0.6초 뒤 터짐 (바로 옆만).
    // 기획 8차 리뷰: 원래 움직이지 않음 → 16~19층 마지막에 혼자 남아 층이 늘어짐 (마지막 생존 77~93%). 이동 0.6 + 시선 1.5 → 1.2.
    stats: { maxHp: 190, atk: 16, def: 0.1, atkSpeed: 0.6, range: 7, moveSpeed: 0.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 9 },
    skills: [
      {
        id: 'eye_glare', name: '시선 난사', cooldown: 6, initialDelay: 2, castRange: 7,
        action: { center: 'target', area: { shape: 'fan', radius: 7, angle: 50 }, affects: 'enemies', delay: 1, effects: [{ kind: 'damage', amount: 1.2 }] },
      },
    ],
    onDeath: { action: { center: 'self', area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: 0.6, effects: [{ kind: 'damage', amount: 1.2 }] } },
  },
  {
    id: 'red_mask', name: '붉은 마스크', tier: 'normal', color: '#d00000', radius: 0.38, look: 'red_mask',
    // "나 예뻐?" 빠른 암살자: 대상 옆으로 순간이동 → 0.8초 뒤 강한 한 방.
    // 기획 8차 리뷰: 0.4초 · 피해 3.0은 사실상 못 피함 (급사의 33%, 피해는 1.9%) → 예고 0.8초 · 피해 2.4.
    stats: { maxHp: 170, atk: 22, def: 0, atkSpeed: 1, range: 0.4, moveSpeed: 4, critChance: 0.1, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        id: 'mask_ambush', name: '그림자 습격', cooldown: 7, initialDelay: 2, castRange: 12,
        action: { center: 'target', area: { shape: 'single' }, affects: 'enemies', delay: 0.8, blink: { offset: 0.2 }, effects: [{ kind: 'damage', amount: 2.4 }] },
      },
    ],
  },

  // ─────────────────────────── 중형보스 ───────────────────────────
  {
    id: 'ogre', name: '거대 마네킹', tier: 'mid', color: '#bc4749', radius: 0.9, look: 'giant_mannequin',
    // 백화점 천장까지 닿는 마네킹. 내려찍기 (기절).
    stats: { maxHp: 2250, atk: 33, def: 0.15, atkSpeed: 0.6, range: 0.8, moveSpeed: 2.2, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1.5 },
    skills: [
      {
        id: 'ogre_slam', name: '내려찍기', cooldown: 7, initialDelay: 4, castRange: 2.5,
        action: { center: 'target', area: { shape: 'circle', radius: 3 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
      },
    ],
  },
  {
    id: 'lich', name: '검은 조문객', tier: 'mid', color: '#7b2cbf', radius: 0.8, look: 'mourner',
    // 장례식장에서 길을 잃은 조문객. 그림자 아이를 부르고 발밑에 저주 장판 (둔화).
    stats: { maxHp: 1750, atk: 27, def: 0.1, atkSpeed: 0.6, range: 6, moveSpeed: 1.8, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 9, splashRadius: 1 },
    skills: [
      {
        id: 'lich_summon', name: '그림자 부르기', cooldown: 12, initialDelay: 3,
        action: { center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [], summon: { unitId: 'goblin', count: 3, duration: 0 } },
      },
      {
        id: 'lich_curse', name: '저주 장판', cooldown: 9, initialDelay: 6,
        action: { center: 'target', area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', delay: 0.8, effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1, value: 0.4 }], zone: { duration: 4, tickInterval: 0.5 } },
      },
    ],
  },
  {
    id: 'elevator_girl', name: '엘리베이터 걸', tier: 'mid', color: '#ff8fab', radius: 0.7, look: 'elevator_girl',
    // "올라가십니까?" 대상 옆으로 순간이동 → "문이 닫힙니다" 고리 (기절). 층 버튼 십자.
    stats: { maxHp: 1900, atk: 28, def: 0.1, atkSpeed: 0.8, range: 0.6, moveSpeed: 2.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    skills: [
      {
        id: 'egirl_doors', name: '문이 닫힙니다', cooldown: 9, initialDelay: 4, castRange: 12,
        action: { center: 'self', area: { shape: 'ring', inner: 1.2, outer: 3.6 }, affects: 'enemies', delay: 1.2, blink: { offset: 1.1 }, effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
      },
      {
        id: 'egirl_buttons', name: '층 버튼', cooldown: 7, initialDelay: 7, castRange: 6,
        action: { center: 'target', area: { shape: 'cross', length: 4, width: 1.2 }, affects: 'enemies', delay: 1, effects: [{ kind: 'damage', amount: 1.8 }] },
      },
    ],
  },
  {
    id: 'copier_beast', name: '복사기 괴물', tier: 'mid', color: '#6c757d', radius: 0.9, look: 'copier',
    // 종이를 토해 내는 복사기. 복사 인간을 찍어 내고, 대상 쪽으로 종이 부채꼴 3연타.
    stats: { maxHp: 2500, atk: 26, def: 0.15, atkSpeed: 0.6, range: 5, moveSpeed: 1.6, critChance: 0, critMult: 1.5 },
    basic: { kind: 'projectile', speed: 9 },
    skills: [
      {
        id: 'copier_print', name: '복사 개시', cooldown: 13, initialDelay: 4,
        action: { center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [], summon: { unitId: 'copy_man', count: 2, duration: 0 } },
      },
      {
        id: 'copier_paper', name: '종이 폭풍', cooldown: 7, initialDelay: 7, castRange: 7,
        action: { center: 'target', area: { shape: 'fan', radius: 7, angle: 60 }, affects: 'enemies', delay: 1, hits: 3, hitInterval: 0.35, effects: [{ kind: 'damage', amount: 0.9 }] },
      },
    ],
  },
  {
    id: 'head_nurse', name: '수간호사', tier: 'mid', color: '#f1faee', radius: 0.8, look: 'head_nurse',
    // 회진을 도는 수간호사. 주변 괴이 회복 (자기 포함) + 침대를 밀고 돌진.
    // 기획 8차 리뷰: 회진 6 → 3% (자기 회복 포함 싸움 동안 최대 HP의 ~50%를 회복해 11·14·19층 마지막에 혼자 남음).
    stats: { maxHp: 2500, atk: 30, def: 0.15, atkSpeed: 0.8, range: 0.8, moveSpeed: 2.4, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1 },
    skills: [
      {
        id: 'nurse_rounds', name: '회진', cooldown: 10, initialDelay: 5,
        action: { center: 'self', area: { shape: 'circle', radius: 6 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.03 }] },
      },
      {
        id: 'nurse_gurney', name: '환자 이송', cooldown: 8, initialDelay: 3, castRange: 9,
        action: { center: 'target', area: { shape: 'line', length: 10, width: 1.8 }, affects: 'enemies', delay: 1.1, charge: { distance: 10, duration: 0.35 }, effects: [{ kind: 'damage', amount: 2.6 }, { kind: 'knockback', distance: 2 }] },
      },
    ],
  },
  {
    id: 'signal_man', name: '신호등 인간', tier: 'mid', color: '#2b9348', radius: 0.8, look: 'signal_man',
    // 머리가 신호등. 빨간불 = 십자(+) 내려찍기, 초록불 = X자 내려찍기를 번갈아.
    // 기획 8차 리뷰: 공격 32 → 29 (옥상 웨이브 5~7로 늘린 뒤 16·18층이 가장 큰 벽이 됨).
    stats: { maxHp: 2900, atk: 29, def: 0.15, atkSpeed: 0.7, range: 0.8, moveSpeed: 2.2, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee', splashRadius: 1.2 },
    skills: [
      {
        id: 'signal_red', name: '빨간불', cooldown: 8, initialDelay: 3,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.4 }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.3 }] },
      },
      {
        id: 'signal_green', name: '초록불', cooldown: 8, initialDelay: 7,
        action: { center: 'target', area: { shape: 'cross', length: 5, width: 1.4, diagonal: true }, affects: 'enemies', delay: 1.2, effects: [{ kind: 'damage', amount: 2.3 }, { kind: 'status', status: 'slow', duration: 1.5, value: 0.3 }] },
      },
    ],
  },

  // ── 아군 소환체 ──
  {
    id: 'turret', name: '포탑', tier: 'summon', color: '#adb5bd', radius: 0.45, stationary: true,
    stats: { maxHp: 300, atk: 0, def: 0.2, atkSpeed: 2, range: 6, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    // atk 0 → sim uses owner's pet power (same as pet damage source) × 0.5 per shot.
    basic: { kind: 'projectile', speed: 16 },
  },
  {
    // 기획 12차 (퍼펫티어): decoy. inert = never moves/targets/attacks; monsters hit it under the usual "nearest" rule.
    // hp/atk are replaced by the caster's (SkillAction.summon.inherit). atk ≠ 0 so it never takes the petPowered path.
    // Explodes on death AND on expiry (units.ts). Never in a wave pool.
    id: 'paper_doll', name: '종이 인형', tier: 'summon', color: '#ff99c8', radius: 0.45, stationary: true, inert: true, look: 'paper_doll',
    stats: { maxHp: 100, atk: 10, def: 0.2, atkSpeed: 0.01, range: 0, moveSpeed: 0, critChance: 0, critMult: 1.5 },
    basic: { kind: 'melee' },
    onDeath: {
      action: { center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'atkDown', duration: 4, value: 0.25 }] },
    },
  },
];

// ─────────────────────────── 보스 (5·10·15·20층) ───────────────────────────
// 보스는 맨 위 가장자리에 고정 (BOSS_POS x 12, y −1.2). 'self' 중심 = 보스 자리 → offset으로 아레나(24×12) 안의 띠를 지정.

/** Vertical band under the boss: starts at the top wall (y 0) at world x, goes down the whole arena. */
const band = (x: number) => ({ x: x - 12, y: 1.2 });

export const BOSSES: BossDef[] = [
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
    enrage: ENRAGE,
  },
  {
    // 10층: 야근의 군주 — 팔이 여러 개인 사무실 유령.
    id: 'overtime_lord', name: '야근의 군주', tier: 'boss', color: '#3d5a80', radius: 3, stationary: true, look: 'overtime_lord',
    stats: { maxHp: 8000, atk: 30, def: 0.2, atkSpeed: 0.55, range: 40, moveSpeed: 0, critChance: 0, critMult: 1.5 },
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
    enrage: ENRAGE,
  },
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
    enrage: ENRAGE,
  },
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
    enrage: ENRAGE,
  },
];

/** Every normal monster that waves can bring (copy_mini only comes from a 복사 인간 split). */
export const NORMAL_MONSTER_IDS = ['slime', 'goblin', 'skeleton_archer', 'bomb_bug', 'golem', 'overtime_ghost', 'copy_man', 'iv_zombie', 'wheelchair_rush', 'nurse_doll', 'eye_stalk', 'red_mask'];
export const MID_BOSS_IDS = ['ogre', 'lich', 'elevator_girl', 'copier_beast', 'head_nurse', 'signal_man'];
export const BOSS_IDS = ['elevator_keeper', 'overtime_lord', 'surgeon_director', 'abyss_watcher'];
