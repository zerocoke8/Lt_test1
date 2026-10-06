import type { AreaShape, CharacterDef, Effect, SkillAction } from '../types';

// 캐릭터 15종 (기획 12차: 역할 5개 × 3명 — 탱커 / 근접딜러 / 원거리딜러 / 힐러 / 서포터). 스킬 내용은 임시 (2차 Q5).
// 기획 12차: 힐러 역할 신설 — 클레릭(서포터에서 이동, 수치 그대로) + 메딕 + 퇴마사. 서포터에 퍼펫티어 추가 (docs/new-characters.md).
// 드래그스킬은 놓은 지점(point)이 기준점. 방향이 있는 형태는 데이터에 방향이 고정됨 (3차 2: 오른쪽 돌진은 항상 오른쪽).
// swapCooldown(8~12초) = 드래그스킬 쿨, 강할수록 김. 목록 순서 = 프리셋 화면 순서 (역할별로 묶음).
// 기획 14차 교체 에너지 (실험 토글): swapEnergy = 교체 1번 비용 (4~8). 드래그스킬 시전 1번의 잰 가치 ÷ 38.5 반올림
// (크로노는 균열이 돌려주는 에너지 2를 더함 — 균열은 에너지 차는 속도와 상관없이 늘 에너지 2, effect.energy) → 에너지 1당 가치가 15명 모두 평균 ±8% 안 (docs/balance.md 13-4, 시드 두 세트).
// 기획 13차 스킬 리뉴얼 (docs/skill-renewal.md 3장): 드래그·궁극기는 2~4박자 연속기 (SkillAction.stage = 단계 이름, 연출·소리
// 열쇠). 위력 드래그 약 ×1.6, 궁극기 약 ×1.8. 쿨·궁극기 게이지(30초)·드래그 방향은 그대로. 궁극기는 컷인 0.5초:
// castTime 0.5 + 시전자 무적 0.5초 (ULT_CUTIN), 효과는 0.45초부터 (움직임만 0초 허용). 설명의 숫자는 데이터와 같아야 함
// (tests/sim/roster-descriptions.test.ts).

/** 기획 13차: every ult stands still through the cut-in (src/config.ts ULT_CUTIN). */
const ULT_CAST = 0.5;
/** Every ally on the field (all players' characters, summons and the 돌발 괴담 patient). */
const ALL: AreaShape = { shape: 'circle', radius: 99 };
/** 가디언 성벽: the left-right band through the drop point. */
const WALL: AreaShape = { shape: 'rect', dir: 'right', anchor: 'center', length: 9, width: 2.2 };
/** 팔라딘 낙인: the '+' brand. */
const BRAND: AreaShape = { shape: 'cross', length: 3.8, width: 1.4 };
/** 메딕 코드 블루: the '+' first-aid mark. */
const AID: AreaShape = { shape: 'cross', length: 3.5, width: 1.8 };
/** 팔라딘 빛의 창: 0.6 → 0.95 s, 0.05 s apart. */
const SPEAR_AT = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
/** 바드: an up-down band through the drop point. */
const band = (width: number): AreaShape => ({ shape: 'rect', dir: 'down', anchor: 'center', length: 12, width });
/** 바드 박자 buff on allies in a band. */
const BARD_BUFF: Effect[] = [
  { kind: 'status', status: 'haste', duration: 7, value: 0.4 },
  { kind: 'status', status: 'atkUp', duration: 7, value: 0.3 },
];

/**
 * 퍼펫티어 대역 인형 (기획 12차, 13차 리뉴얼): one doll thrown `x` units sideways of the drop point — lands for 150%
 * damage, pulls 0.8 toward itself and leaves a 종이 인형 decoy (HP = 60% of the caster's max HP, atk = the caster's,
 * 7 s) that bursts on death or expiry.
 */
const dollToss = (x: number, delay?: number): SkillAction => ({
  stage: 'toss',
  center: 'point',
  offset: { x, y: 0 },
  ...(delay ? { delay, telegraphLead: 0 } : null),
  area: { shape: 'circle', radius: 1.5 },
  affects: 'enemies',
  effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'pull', distance: 0.8 }],
  summon: { unitId: 'paper_doll', count: 1, duration: 7, inherit: { hp: 0.6, atk: 1 } },
});

export const CHARACTERS: CharacterDef[] = [
  // ─────────────────────────── 탱커 ───────────────────────────
  {
    id: 'guardian',
    name: '가디언',
    role: 'tank',
    color: '#5b8def',
    stats: { maxHp: 900, atk: 18, def: 0.3, atkSpeed: 0.9, range: 0.6, moveSpeed: 3.2, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 10,
    swapEnergy: 6,
    basic: { kind: 'melee' },
    passive: {
      id: 'guardian_p',
      name: '굳건함',
      description: '최대 HP +10%. 등장 후 4초간 방어 +20%.',
      stats: { hpPct: 0.1 },
      onAppear: { status: 'defUp', duration: 4, value: 0.2 },
    },
    normal: {
      id: 'guardian_n',
      name: '방패 강타',
      slot: 'normal',
      description: '대상에게 공격력 200% 피해 + 1초 기절.',
      cooldown: 7,
      castRange: 0.8,
      castTime: 0.3,
      actions: [{ center: 'target', area: { shape: 'single' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] }],
    },
    drag: {
      id: 'guardian_d',
      name: '성벽 강림',
      slot: 'drag',
      description: '착지 지점에 방패를 내리꽂아 반경 1.8에 공격력 110% 피해 + 0.6초 기절, 자신에게 보호막(최대 HP 30%, 6초). 0.25초 뒤 좌우 가로 띠(길이 9, 폭 2.2)로 성벽 파동: 공격력 220% 피해 + 1.2초 기절 + 2.5초 도발. 띠는 4초간 방패벽으로 남아 안의 아군 방어 +20%, 적 30% 둔화.',
      actions: [
        { stage: 'slam', center: 'point', area: { shape: 'circle', radius: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.1 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
        { stage: 'slam', center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'shield', amount: 0.3, duration: 6 }] },
        { stage: 'wave', center: 'point', delay: 0.25, area: WALL, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }, { kind: 'status', status: 'taunt', duration: 2.5, value: 0 }] },
        { stage: 'wall', center: 'point', delay: 0.25, telegraphLead: 0, area: WALL, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 0.6, value: 0.2 }], zone: { duration: 4, tickInterval: 0.5 } },
        { stage: 'wall', center: 'point', delay: 0.25, telegraphLead: 0, area: WALL, affects: 'enemies', effects: [{ kind: 'status', status: 'slow', duration: 0.6, value: 0.3 }], zone: { duration: 4, tickInterval: 0.5 } },
      ],
    },
    ult: {
      id: 'guardian_u',
      name: '불굴의 성채',
      slot: 'ult',
      description: '모든 아군에게 보호막(최대 HP 30%, 8초). 주변 반경 6의 적을 3.5칸 끌어당기고 공격력 60% 피해 + 4초 도발. 0.85초에 반경 3.5 성채 낙하: 공격력 250% 피해 + 1.5초 기절. 그 자리 반경 4에 6초간 결계(아군 방어 +30%, 적 30% 둔화).',
      castTime: ULT_CAST,
      actions: [
        { stage: 'aegis', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'shield', amount: 0.3, duration: 8 }] },
        { stage: 'rally', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 6 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 3.5 }, { kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'taunt', duration: 4, value: 0 }] },
        { stage: 'citadel', center: 'self', follow: true, delay: 0.85, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
        { stage: 'barrier', center: 'self', delay: 0.85, telegraphLead: 0, area: { shape: 'circle', radius: 4 }, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 0.6, value: 0.3 }], zone: { duration: 6, tickInterval: 0.5 } },
        { stage: 'barrier', center: 'self', delay: 0.85, telegraphLead: 0, area: { shape: 'circle', radius: 4 }, affects: 'enemies', effects: [{ kind: 'status', status: 'slow', duration: 0.6, value: 0.3 }], zone: { duration: 6, tickInterval: 0.5 } },
      ],
    },
  },
  {
    id: 'paladin',
    name: '팔라딘',
    role: 'tank',
    color: '#48bfe3',
    stats: { maxHp: 850, atk: 20, def: 0.25, atkSpeed: 0.9, range: 0.6, moveSpeed: 3.2, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 11,
    swapEnergy: 7,
    basic: { kind: 'melee' },
    passive: {
      id: 'paladin_p',
      name: '신성한 가호',
      description: '최대 HP +5%. 등장 후 5초간 초당 HP 2% 회복.',
      stats: { hpPct: 0.05 },
      onAppear: { status: 'regen', duration: 5, value: 0.02 },
    },
    normal: {
      id: 'paladin_n',
      name: '성스러운 일격',
      slot: 'normal',
      description: '대상에게 공격력 180% 피해, 자신 HP 5% 회복.',
      cooldown: 7,
      castRange: 0.8,
      castTime: 0.3,
      actions: [
        { center: 'target', area: { shape: 'single' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.8 }] },
        { center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'heal', amount: 0.05 }] },
      ],
    },
    drag: {
      id: 'paladin_d',
      name: '심판의 낙인',
      slot: 'drag',
      description: '착지 지점에 십자(+) 낙인(상하좌우 3.8칸, 폭 1.4): 공격력 60% 피해 + 4초간 받는 피해 +12%. 반경 3.5 아군 5초간 방어 +25% + HP 4% 회복. 0.5초 뒤 낙인 위로 빛기둥: 공격력 150% 피해 + 1.2초 기절, 가운데(반경 1.4)는 공격력 100% 피해 추가.',
      actions: [
        { stage: 'brand', center: 'point', area: BRAND, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.12 }] },
        { stage: 'blessing', center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'status', status: 'defUp', duration: 5, value: 0.25 }, { kind: 'heal', amount: 0.04 }] },
        { stage: 'pillar', center: 'point', delay: 0.5, area: BRAND, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
        { stage: 'core', center: 'point', delay: 0.5, telegraphLead: 0, area: { shape: 'circle', radius: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] },
      ],
    },
    ult: {
      id: 'paladin_u',
      name: '천상의 대심판',
      slot: 'ult',
      description: '모든 아군 HP 8% 회복 + 보호막(최대 HP 20%, 6초). 0.6초부터 자기 둘레 여덟 곳(안쪽 2칸, 바깥 5칸)에 빛의 창(반경 1.3): 각각 공격력 70% 피해 + 4초간 받는 피해 +15%. 1.2초에 큰 십자(+, 상하좌우 7칸, 폭 2.2) 대심판: 공격력 200% 피해 + 1.5초 기절.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'sanctuary', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }, { kind: 'shield', amount: 0.2, duration: 6 }] },
        // eight spears clockwise (inner ring, then outer), 0.05 s apart, where the paladin stood when it cast
        ...[
          [0, -2],
          [2, 0],
          [0, 2],
          [-2, 0],
          [0, -5],
          [5, 0],
          [0, 5],
          [-5, 0],
        ].map(([x, y], i): SkillAction => ({
          stage: 'spear',
          center: 'self',
          offset: { x, y },
          delay: SPEAR_AT[i],
          area: { shape: 'circle', radius: 1.3 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.7 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.15 }],
        })),
        { stage: 'tribunal', center: 'self', delay: 1.2, area: { shape: 'cross', length: 7, width: 2.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }, { kind: 'status', status: 'stun', duration: 1.5, value: 0 }] },
      ],
    },
  },
  {
    id: 'warden',
    name: '워든',
    role: 'tank',
    color: '#80b918',
    stats: { maxHp: 950, atk: 16, def: 0.3, atkSpeed: 0.85, range: 0.7, moveSpeed: 3.0, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 10,
    swapEnergy: 5,
    basic: { kind: 'melee' },
    passive: {
      id: 'warden_p',
      name: '쇠사슬 갑주',
      description: '방어 +10%. 기본 공격 적중 시 25% 확률로 2초간 20% 둔화.',
      stats: { defFlat: 0.1 },
      onHitStatus: { chance: 0.25, status: 'slow', duration: 2, value: 0.2 },
    },
    normal: {
      id: 'warden_n',
      name: '사슬 휘두르기',
      slot: 'normal',
      description: '자기 둘레 고리(안쪽 0.8 ~ 바깥 2.6)의 적을 1.2칸 끌어당기고 공격력 140% 피해.',
      cooldown: 7,
      castRange: 1.5,
      castTime: 0.3,
      actions: [{ center: 'self', area: { shape: 'ring', inner: 0.8, outer: 2.6 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 1.2 }, { kind: 'damage', amount: 1.4 }] }],
    },
    drag: {
      id: 'warden_d',
      name: '사슬 감옥',
      slot: 'drag',
      description: '착지 지점 둘레 고리(안쪽 0.6 ~ 바깥 4.5)로 사슬을 던져 적을 2.8칸 끌어당기고 공격력 70% 피해 + 1초간 50% 둔화, 자신에게 보호막(최대 HP 25%, 6초). 0.3초 뒤 반경 2.2를 옥죄어 공격력 180% 피해 + 3초간 50% 둔화. 4초간 사슬 울타리(반경 2.4): 갇힌 적은 밖으로 못 나가고 0.5초마다 공격력 20% 피해 + 40% 둔화.',
      actions: [
        // hole 0.6 (playtest 3차): dropped on the pack itself it still hits the pack; only a unit dead center is spared
        { stage: 'hook', center: 'point', area: { shape: 'ring', inner: 0.6, outer: 4.5 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 2.8 }, { kind: 'damage', amount: 0.7 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }] },
        { stage: 'hook', center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'shield', amount: 0.25, duration: 6 }] },
        { stage: 'crush', center: 'point', delay: 0.3, area: { shape: 'circle', radius: 2.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'slow', duration: 3, value: 0.5 }] },
        { stage: 'fence', center: 'point', delay: 0.3, telegraphLead: 0, area: { shape: 'circle', radius: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }, { kind: 'status', status: 'slow', duration: 0.6, value: 0.4 }, { kind: 'status', status: 'tether', duration: 0.6, value: 2.4 }], zone: { duration: 4, tickInterval: 0.5 } },
      ],
    },
    ult: {
      id: 'warden_u',
      name: '천라지망 철옹성',
      slot: 'ult',
      description: '자신에게 보호막(최대 HP 35%, 8초). 둘레 큰 고리(안쪽 1 ~ 바깥 7)의 적을 4.5칸 끌어당기고 공격력 80% 피해 + 3초간 60% 둔화. 0.9초에 반경 3 철창 낙하: 공격력 300% 피해 + 2초 기절, 5초간 감옥(갇힌 적은 밖으로 못 나가고 0.5초마다 공격력 25% 피해 + 60% 둔화). 끝나면 반경 3.2 해방: 공격력 150% 피해 + 1.5칸 넉백.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'chainstorm', center: 'self', delay: 0.45, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'shield', amount: 0.35, duration: 8 }] },
        { stage: 'chainstorm', center: 'self', delay: 0.45, area: { shape: 'ring', inner: 1, outer: 7 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 4.5 }, { kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'slow', duration: 3, value: 0.6 }] },
        { stage: 'cage', center: 'self', delay: 0.9, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 2, value: 0 }] },
        { stage: 'prison', center: 'self', delay: 0.9, telegraphLead: 0, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.25 }, { kind: 'status', status: 'slow', duration: 0.6, value: 0.6 }, { kind: 'status', status: 'tether', duration: 0.6, value: 3 }], zone: { duration: 5, tickInterval: 0.5 } },
        { stage: 'release', center: 'self', delay: 5.9, telegraphLead: 0.5, area: { shape: 'circle', radius: 3.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'knockback', distance: 1.5 }] },
      ],
    },
  },

  // ─────────────────────────── 근접딜러 ───────────────────────────
  {
    id: 'blade',
    name: '블레이드',
    role: 'melee',
    color: '#ef476f',
    stats: { maxHp: 600, atk: 32, def: 0.1, atkSpeed: 1.4, range: 0.6, moveSpeed: 3.8, critChance: 0.15, critMult: 1.8 },
    swapCooldown: 10,
    swapEnergy: 6,
    basic: { kind: 'melee' },
    passive: {
      id: 'blade_p',
      name: '선수필승',
      description: '등장 후 4초간 공격 속도 +40%.',
      onAppear: { status: 'haste', duration: 4, value: 0.4 },
    },
    normal: {
      id: 'blade_n',
      name: '회전 베기',
      slot: 'normal',
      description: '주변 반경 2에 공격력 160% 피해.',
      cooldown: 6,
      castRange: 1,
      castTime: 0.25,
      actions: [{ center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }] }],
    },
    drag: {
      id: 'blade_d',
      name: '질풍 삼연섬',
      slot: 'drag',
      description: '착지 지점에서 오른쪽으로 6칸 돌진(폭 1.6)하며 공격력 180% 피해 + 0.4초 기절. 0.32초에 착지 지점으로 되돌아 베며(6칸) 공격력 120% 피해, 0.58초에 지나간 길(길이 7, 폭 2.4)이 터져 공격력 100% 피해. 블레이드는 착지 지점에 섬.',
      actions: [
        {
          stage: 'dash',
          center: 'point',
          area: { shape: 'rect', dir: 'right', anchor: 'start', length: 6, width: 1.6 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'stun', duration: 0.4, value: 0 }],
          dash: { dir: 'right', distance: 6, duration: 0.16 },
        },
        // 기획 13차 stopAtCenter: back along the same path, ending on the drop point
        { stage: 'return', center: 'point', delay: 0.32, telegraphLead: 0, area: { shape: 'line', length: 6, width: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }], charge: { distance: 6, duration: 0.16, stopAtCenter: true } },
        { stage: 'burst', center: 'point', offset: { x: 3, y: 0 }, delay: 0.58, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] },
      ],
    },
    ult: {
      id: 'blade_u',
      name: '천검난무',
      slot: 'ult',
      description: '반경 7 안의 적에게 0.12초마다 5번 순간이동하며 반경 1.3에 공격력 110% 피해(같은 적은 2번까지). 이어서 그 자리 반경 4에 공격력 70% 피해 ×8, 마지막으로 가로 일섬(길이 14, 폭 3): 공격력 300% 피해 + 0.6초 기절.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'hop', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 1.3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.1 }], blinkChain: { count: 5, radius: 7, interval: 0.12, maxPerTarget: 2 } },
        { stage: 'storm', center: 'self', follow: true, delay: 1.15, telegraphLead: 0, area: { shape: 'circle', radius: 4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.7 }], hits: 8, hitInterval: 0.15 },
        { stage: 'issen', center: 'self', follow: true, delay: 2.45, telegraphLead: 0.25, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 14, width: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
      ],
    },
  },
  {
    id: 'berserker',
    name: '버서커',
    role: 'melee',
    color: '#e76f51',
    stats: { maxHp: 750, atk: 40, def: 0.15, atkSpeed: 0.8, range: 0.7, moveSpeed: 3.4, critChance: 0.1, critMult: 2.0 },
    swapCooldown: 11,
    swapEnergy: 7,
    basic: { kind: 'melee', splashRadius: 1 },
    passive: {
      id: 'berserker_p',
      name: '피의 갈망',
      description: '잃은 HP에 비례해 공격력 최대 +60%.',
      lowHpAtkBonus: 0.6,
    },
    normal: {
      id: 'berserker_n',
      name: '처형',
      slot: 'normal',
      description: '대상에게 공격력 350% 피해.',
      cooldown: 8,
      castRange: 0.8,
      castTime: 0.4,
      actions: [{ center: 'target', area: { shape: 'single' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3.5 }] }],
    },
    drag: {
      id: 'berserker_d',
      name: '대지 분쇄',
      slot: 'drag',
      description: '착지하며 반경 2.2에 공격력 100% 피해 + 0.3초 기절, 자신 4초간 공격 속도 +25%. 0.22초에 오른쪽 부채꼴(반경 5, 100°)을 갈라 공격력 180% 피해 + 3초간 40% 둔화, 0.55초에 균열 끝까지 여진(반경 7, 50°) 공격력 100% 피해.',
      actions: [
        { stage: 'slam', center: 'point', area: { shape: 'circle', radius: 2.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'stun', duration: 0.3, value: 0 }] },
        { stage: 'slam', center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'status', status: 'haste', duration: 4, value: 0.25 }] },
        { stage: 'split', center: 'point', delay: 0.22, area: { shape: 'cone', dir: 'right', radius: 5, angle: 100 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'slow', duration: 3, value: 0.4 }] },
        { stage: 'quake', center: 'point', delay: 0.55, area: { shape: 'cone', dir: 'right', radius: 7, angle: 50 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] },
      ],
    },
    ult: {
      id: 'berserker_u',
      name: '혈귀 강림',
      slot: 'ult',
      description: '포효: 주변 반경 4.5의 적을 2칸 끌어당기고 공격력 150% 피해. 8초간 공격력 +50%, 공격 속도 +50%, 피해의 25% 흡혈, 기본 공격 범위 +0.4. 끝날 무렵(8.25초) 주변 반경 3.5에 마무리 일격: 공격력 250% 피해 + 1.5칸 넉백.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'roar', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 2 }, { kind: 'damage', amount: 1.5 }] },
        { stage: 'frenzy', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [
          { kind: 'status', status: 'atkUp', duration: 8, value: 0.5 },
          { kind: 'status', status: 'haste', duration: 8, value: 0.5 },
          { kind: 'status', status: 'lifesteal', duration: 8, value: 0.25 },
          { kind: 'status', status: 'splashUp', duration: 8, value: 0.4 },
        ] },
        // follow: lands where the berserker stands then, with its attack then (광란 +50% included)
        { stage: 'finale', center: 'self', follow: true, delay: 8.25, telegraphLead: 0.6, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5 }, { kind: 'knockback', distance: 1.5 }] },
      ],
    },
  },
  {
    id: 'shadow',
    name: '섀도우',
    role: 'melee',
    color: '#5e60ce',
    stats: { maxHp: 560, atk: 34, def: 0.08, atkSpeed: 1.5, range: 0.6, moveSpeed: 4.0, critChance: 0.2, critMult: 1.9 },
    swapCooldown: 9,
    swapEnergy: 6,
    basic: { kind: 'melee' },
    passive: {
      id: 'shadow_p',
      name: '그림자 걸음',
      description: '치명타 확률 +5%. 등장 후 3초간 공격력 +30%.',
      stats: { critChance: 0.05 },
      onAppear: { status: 'atkUp', duration: 3, value: 0.3 },
    },
    normal: {
      id: 'shadow_n',
      name: '암습',
      slot: 'normal',
      description: '대상에게 공격력 220% 피해 + 3초간 받는 피해 +15%.',
      cooldown: 6,
      castRange: 0.8,
      castTime: 0.2,
      actions: [{ center: 'target', area: { shape: 'single' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.15 }] }],
    },
    drag: {
      id: 'shadow_d',
      name: '그림자 처형진',
      slot: 'drag',
      description: '착지 지점에서 오른쪽으로 4.4칸 질주하며 2.2칸 간격 분신 폭발 3번(반경 1.5): 각각 공격력 70% 피해 + 3초간 받는 피해 +15%. 0.5초에 가운데에 X자 처형(대각선 3.2칸, 폭 1.4): 공격력 110% 피해 + 0.3초 기절.',
      actions: [
        ...[0, 2.2, 4.4].map((x, i): SkillAction => ({
          stage: 'clone',
          center: 'point',
          ...(x ? { offset: { x, y: 0 } } : null),
          ...(i ? { delay: i * 0.08, telegraphLead: 0 } : null),
          area: { shape: 'circle', radius: 1.5 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 0.7 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.15 }],
        })),
        // the shadow itself slides through the clones (atFire: from where it stands)
        { stage: 'slide', center: 'self', delay: 0.24, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [], dash: { dir: 'right', distance: 4.4, duration: 0.16, atFire: true } },
        { stage: 'execute', center: 'point', offset: { x: 2.2, y: 0 }, delay: 0.5, area: { shape: 'cross', diagonal: true, length: 3.2, width: 1.4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.1 }, { kind: 'status', status: 'stun', duration: 0.3, value: 0 }] },
      ],
    },
    ult: {
      id: 'shadow_u',
      name: '월영참',
      slot: 'ult',
      description: '대상 뒤로 순간이동해 X자(대각선 4.5칸, 폭 1.6)로 공격력 70% 피해 ×6 + 4초간 받는 피해 +25%. 1.6초에 초승달 베기(반경 2.5): 공격력 250% 피해(치명타 확정) + 0.5초 기절.',
      castTime: ULT_CAST,
      actions: [
        // movement only (allowed during the cut-in): vanish and reappear behind the target
        { stage: 'vanish', center: 'target', area: { shape: 'single' }, affects: 'enemies', effects: [], blink: { offset: 0.3, behind: true } },
        { stage: 'dance', center: 'target', follow: true, delay: 0.45, area: { shape: 'cross', diagonal: true, length: 4.5, width: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.7 }, { kind: 'status', status: 'vulnerable', duration: 4, value: 0.25 }], hits: 6, hitInterval: 0.15 },
        { stage: 'moon', center: 'target', follow: true, delay: 1.6, telegraphLead: 0.3, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.5, crit: 'always' }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }] },
      ],
    },
  },

  // ─────────────────────────── 원거리딜러 ───────────────────────────
  {
    id: 'ranger',
    name: '레인저',
    role: 'ranged',
    color: '#06d6a0',
    stats: { maxHp: 480, atk: 26, def: 0.05, atkSpeed: 1.3, range: 6, moveSpeed: 3.6, critChance: 0.2, critMult: 1.8 },
    swapCooldown: 10,
    swapEnergy: 5,
    basic: { kind: 'projectile', speed: 18 },
    passive: {
      id: 'ranger_p',
      name: '매의 눈',
      description: '치명타 확률 +10%, 치명타 피해 +30%.',
      stats: { critChance: 0.1, critMult: 0.3 },
    },
    normal: {
      id: 'ranger_n',
      name: '관통 사격',
      slot: 'normal',
      description: '대상 방향 직선(길이 9, 폭 1.2)에 공격력 220% 피해.',
      cooldown: 6,
      castRange: 7,
      castTime: 0.3,
      actions: [{ center: 'target', area: { shape: 'line', length: 9, width: 1.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.2 }] }],
    },
    drag: {
      id: 'ranger_d',
      name: '매의 일격',
      slot: 'drag',
      description: '착지 지점에서 오른쪽으로 화살 3연사(길이 14, 폭 1.8, 0.25초부터 0.1초 간격): 각각 공격력 50% 피해. 0.75초에 관통 일격(길이 14, 폭 1.2): 공격력 340% 피해(치명타 확정).',
      actions: [
        { stage: 'volley', center: 'point', delay: 0.25, area: { shape: 'rect', dir: 'right', anchor: 'start', length: 14, width: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }], hits: 3, hitInterval: 0.1 },
        { stage: 'pierce', center: 'point', delay: 0.75, area: { shape: 'rect', dir: 'right', anchor: 'start', length: 14, width: 1.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3.4, crit: 'always' }] },
      ],
    },
    ult: {
      id: 'ranger_u',
      name: '매의 폭풍',
      slot: 'ult',
      description: '대상에게 0.12초마다 공격력 100% 피해 ×12(대상이 쓰러지면 다음 대상). 이어서 대상 둘레 반경 2.5에 화살비 공격력 30% 피해 ×5, 2.75초에 하늘 화살(반경 1.6): 공격력 450% 피해(치명타 확정).',
      castTime: ULT_CAST,
      actions: [
        { stage: 'barrage', center: 'target', follow: true, delay: 0.5, area: { shape: 'single' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }], hits: 12, hitInterval: 0.12 },
        { stage: 'rain', center: 'target', follow: true, delay: 2.05, telegraphLead: 0.3, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.3 }], hits: 5, hitInterval: 0.1 },
        { stage: 'skyshot', center: 'target', follow: true, delay: 2.75, telegraphLead: 0.3, area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 4.5, crit: 'always' }] },
      ],
    },
  },
  {
    id: 'mage',
    name: '메이지',
    role: 'ranged',
    color: '#9b5de5',
    stats: { maxHp: 450, atk: 30, def: 0.05, atkSpeed: 0.8, range: 5.5, moveSpeed: 3.4, critChance: 0.1, critMult: 1.6 },
    swapCooldown: 12,
    swapEnergy: 6,
    basic: { kind: 'projectile', speed: 12, splashRadius: 1.2 },
    passive: {
      id: 'mage_p',
      name: '잔불',
      description: '기본 공격 적중 시 30% 확률로 3초 화상(초당 공격력 30%).',
      onHitStatus: { chance: 0.3, status: 'burn', duration: 3, value: 0.3 },
    },
    normal: {
      id: 'mage_n',
      name: '냉기 구체',
      slot: 'normal',
      description: '대상 주변 반경 1.8에 공격력 180% 피해 + 2.5초간 40% 둔화.',
      cooldown: 7,
      castRange: 6,
      castTime: 0.35,
      actions: [{ center: 'target', area: { shape: 'circle', radius: 1.8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.8 }, { kind: 'status', status: 'slow', duration: 2.5, value: 0.4 }] }],
    },
    drag: {
      id: 'mage_d',
      name: '대유성우',
      slot: 'drag',
      description: '착지 지점 둘레 여섯 곳(좌우 2.6칸, 대각선 1.4·1.6칸)에 0.3초부터 차례로 작은 유성(반경 1.3): 각각 공격력 100% 피해 + 3초 화상(초당 공격력 80%). 1.15초에 가운데 대유성(반경 2.6): 공격력 320% 피해 + 3초 화상(초당 공격력 100%), 그 자리에 3초간 용암(반경 2.2, 0.5초마다 공격력 15% 피해).',
      actions: [
        // six meteors clockwise from the left, 0.08 s apart
        ...[
          [-2.6, 0, 0.3],
          [-1.4, -1.6, 0.38],
          [1.4, -1.6, 0.46],
          [2.6, 0, 0.54],
          [1.4, 1.6, 0.62],
          [-1.4, 1.6, 0.7],
        ].map(([x, y, delay]): SkillAction => ({
          stage: 'meteor',
          center: 'point',
          offset: { x, y },
          delay,
          area: { shape: 'circle', radius: 1.3 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'burn', duration: 3, value: 0.8 }],
        })),
        { stage: 'bigmeteor', center: 'point', delay: 1.15, area: { shape: 'circle', radius: 2.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3.2 }, { kind: 'status', status: 'burn', duration: 3, value: 1 }] },
        { stage: 'lava', center: 'point', delay: 1.15, telegraphLead: 0, area: { shape: 'circle', radius: 2.2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.15 }], zone: { duration: 3, tickInterval: 0.5 } },
      ],
    },
    ult: {
      id: 'mage_u',
      name: '블리자드 · 절대영도',
      slot: 'ult',
      description: '대상 둘레 반경 4.5에 4초간 0.5초마다 공격력 45% 피해 + 50% 둔화. 끝나면 얼려 1초 기절 + 3초간 받는 피해 +25%, 4.85초에 깨지며 공격력 300% 피해.',
      castTime: ULT_CAST,
      // all three parts at the spot the target stood on when cast (no follow)
      actions: [
        { stage: 'blizzard', center: 'target', delay: 0.45, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.45 }, { kind: 'status', status: 'slow', duration: 1, value: 0.5 }], zone: { duration: 4, tickInterval: 0.5 } },
        { stage: 'freeze', center: 'target', delay: 4.45, telegraphLead: 0.5, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies', effects: [{ kind: 'status', status: 'stun', duration: 1, value: 0 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.25 }] },
        { stage: 'shatter', center: 'target', delay: 4.85, telegraphLead: 0, area: { shape: 'circle', radius: 4.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }] },
      ],
    },
  },
  {
    id: 'gunner',
    name: '거너',
    role: 'ranged',
    color: '#c68b59',
    stats: { maxHp: 500, atk: 28, def: 0.05, atkSpeed: 1.1, range: 5.5, moveSpeed: 3.5, critChance: 0.15, critMult: 1.7 },
    swapCooldown: 10,
    swapEnergy: 6,
    basic: { kind: 'projectile', speed: 20 },
    passive: {
      id: 'gunner_p',
      name: '속사 장전',
      description: '공격 속도 +15%, 치명타 피해 +20%.',
      stats: { atkSpeedPct: 0.15, critMult: 0.2 },
    },
    normal: {
      id: 'gunner_n',
      name: '철갑탄',
      slot: 'normal',
      description: '대상 방향 직선(길이 8, 폭 1)에 공격력 200% 피해.',
      cooldown: 6,
      castRange: 6.5,
      castTime: 0.3,
      actions: [{ center: 'target', area: { shape: 'line', length: 8, width: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2.0 }] }],
    },
    drag: {
      id: 'gunner_d',
      name: '펌프 버스트',
      slot: 'drag',
      description: '착지 지점에서 왼쪽으로 산탄 2연발: 0.15초 부채꼴(반경 5, 70°), 0.45초 부채꼴(반경 5.5, 70°) 각각 공격력 170% 피해 + 왼쪽으로 1칸 넉백. 0.85초에 슬러그탄(왼쪽 직선 길이 9, 폭 1.6): 공격력 340% 피해 + 2칸 넉백 + 0.5초 기절, 반동으로 거너는 오른쪽으로 1.2칸 밀려남.',
      actions: [
        { stage: 'blast1', center: 'point', delay: 0.15, area: { shape: 'cone', dir: 'left', radius: 5, angle: 70 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.7 }, { kind: 'knockback', distance: 1, dir: 'left' }] },
        { stage: 'blast2', center: 'point', delay: 0.45, area: { shape: 'cone', dir: 'left', radius: 5.5, angle: 70 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.7 }, { kind: 'knockback', distance: 1, dir: 'left' }] },
        {
          stage: 'slug',
          center: 'point',
          delay: 0.85,
          area: { shape: 'rect', dir: 'left', anchor: 'start', length: 9, width: 1.6 },
          affects: 'enemies',
          effects: [{ kind: 'damage', amount: 3.4 }, { kind: 'knockback', distance: 2, dir: 'left' }, { kind: 'status', status: 'stun', duration: 0.5, value: 0 }],
          // 기획 13차 atFire: the recoil shoves the gunner right the moment it fires
          dash: { dir: 'right', distance: 1.2, duration: 0.15, atFire: true },
        },
      ],
    },
    ult: {
      id: 'gunner_u',
      name: '포화 지원 · 대구경 포격',
      slot: 'ult',
      description: '대상 둘레 반경 4에 0.16초마다 포탄 공격력 50% 피해 ×10. 2.4초에 대구경 포탄(반경 3): 공격력 400% 피해 + 1.5칸 넉백 + 0.8초 기절.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'shells', center: 'target', follow: true, delay: 0.5, area: { shape: 'circle', radius: 4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }], hits: 10, hitInterval: 0.16 },
        { stage: 'heavy', center: 'target', follow: true, delay: 2.4, telegraphLead: 0.45, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 4 }, { kind: 'knockback', distance: 1.5 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
      ],
    },
  },

  // ─────────────────────────── 힐러 (기획 12차) ───────────────────────────
  {
    id: 'cleric',
    name: '클레릭',
    role: 'healer',
    color: '#ffd166',
    stats: { maxHp: 520, atk: 16, def: 0.1, atkSpeed: 1.0, range: 5, moveSpeed: 3.6, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 9,
    swapEnergy: 5,
    basic: { kind: 'projectile', speed: 14 },
    passive: {
      id: 'cleric_p',
      name: '축복의 기운',
      description: '주변 반경 4 아군의 HP를 초당 1% 회복.',
      aura: { radius: 4, healPerSec: 0.01 },
    },
    normal: {
      id: 'cleric_n',
      name: '축복',
      slot: 'normal',
      description: '주변 반경 5 아군 HP 8% 회복 + 5초간 공격력 +25%.',
      cooldown: 8,
      castRange: 99,
      castTime: 0.3,
      actions: [{ center: 'self', area: { shape: 'circle', radius: 5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }, { kind: 'status', status: 'atkUp', duration: 5, value: 0.25 }] }],
    },
    drag: {
      id: 'cleric_d',
      name: '성역의 종',
      slot: 'drag',
      description: '착지 지점 반경 3.5 아군 정화 + HP 11% 회복(넘친 회복은 보호막, 최대 HP 12%까지 4초). 4초간 성역: 0.5초마다 HP 3% 회복. 4초 뒤 종이 울려 범위 안 적에게 공격력 170% 피해 + 0.6초 기절, 아군 HP 7% 회복.',
      actions: [
        { stage: 'descend', center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'cleanse' }, { kind: 'heal', amount: 0.11, overflowShield: { frac: 1, cap: 0.12, duration: 4 } }] },
        { stage: 'sanctuary', center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.03 }], zone: { duration: 4, tickInterval: 0.5 } },
        { stage: 'bell', center: 'point', delay: 4, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.7 }, { kind: 'status', status: 'stun', duration: 0.6, value: 0 }] },
        { stage: 'bell', center: 'point', delay: 4, telegraphLead: 0, area: { shape: 'circle', radius: 3.5 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.07 }] },
      ],
    },
    ult: {
      id: 'cleric_u',
      name: '대천사 강림',
      slot: 'ult',
      description: '모든 아군 HP 40% 회복 + 정화(넘친 회복은 보호막, 최대 HP 25%까지 6초) + 6초간 초당 HP 3% 재생 + 6초간 방어 +15%. 자기 둘레로 빛의 고리 3번(반경 2.5 / 5 / 7.5): 각각 공격력 80% 피해, 마지막은 1.2초 기절.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'grace', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [
          { kind: 'heal', amount: 0.4, overflowShield: { frac: 1, cap: 0.25, duration: 6 } },
          { kind: 'cleanse' },
          { kind: 'status', status: 'regen', duration: 6, value: 0.03 },
          { kind: 'status', status: 'defUp', duration: 6, value: 0.15 },
        ] },
        { stage: 'judgement', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }] },
        { stage: 'judgement', center: 'self', delay: 0.7, area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }] },
        { stage: 'judgement', center: 'self', delay: 0.95, area: { shape: 'circle', radius: 7.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
      ],
    },
  },
  {
    // 기획 12차: 교대 치료사 — "누구를" 고친다 (가장 다친 아군 + 대기 카드). 기획서 8장 "대기 중 HP 회복 없음"의 유일한 예외.
    id: 'medic',
    name: '메딕',
    role: 'healer',
    color: '#2ec4b6',
    stats: { maxHp: 560, atk: 16, def: 0.12, atkSpeed: 1.1, range: 4.5, moveSpeed: 3.7, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 9,
    swapEnergy: 5,
    basic: { kind: 'projectile', speed: 16 },
    passive: {
      id: 'medic_p',
      name: '대기실 간호',
      description: '필드에 있는 동안 내 대기 캐릭터 HP 초당 0.5% 회복.',
      benchRegen: 0.005,
    },
    normal: {
      id: 'medic_n',
      name: '응급 주사',
      slot: 'normal',
      description: '반경 6 안에서 HP 비율이 가장 낮은 아군 HP 8% 회복 + 4초간 초당 HP 1% 재생.',
      cooldown: 8,
      castRange: 6,
      castTime: 0.25,
      actions: [{ center: 'woundedAlly', area: { shape: 'single' }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }, { kind: 'status', status: 'regen', duration: 4, value: 0.01 }] }],
    },
    drag: {
      id: 'medic_d',
      name: '코드 블루',
      slot: 'drag',
      description: '착지 지점 십자(+, 상하좌우 3.5칸, 폭 1.8) 아군 HP 10% 회복, 내 대기 캐릭터 HP 28% 회복. 반경 8 안에서 가장 다친 아군에게 주사: HP 8% + 4초간 초당 HP 1.5% 재생. 0.35초 뒤 십자 안 적에게 제세동: 공격력 100% 피해 + 0.8초 기절.',
      actions: [
        { stage: 'firstaid', center: 'point', area: AID, affects: 'allies', effects: [{ kind: 'heal', amount: 0.1 }] },
        // the card that just left is already benched when the drag skill lands (doSwap), so it gets this heal too
        { stage: 'firstaid', center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'benchHeal', amount: 0.28 }] },
        { stage: 'syringe', center: 'woundedAlly', allyRange: 8, area: { shape: 'single' }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }, { kind: 'status', status: 'regen', duration: 4, value: 0.015 }] },
        { stage: 'defib', center: 'point', delay: 0.35, area: AID, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'stun', duration: 0.8, value: 0 }] },
      ],
    },
    ult: {
      id: 'medic_u',
      name: '골든 아워',
      slot: 'ult',
      description: '모든 아군 HP 25% 회복 + 6초간 공격 속도 +25%. 모든 플레이어의 대기 캐릭터 HP 40% 회복 + 쓰러진 캐릭터 부활 대기 20초 감소. 1초마다 사이렌 3번: 모든 아군 HP 6% 회복 + 정화.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'golden', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [{ kind: 'heal', amount: 0.25 }, { kind: 'status', status: 'haste', duration: 6, value: 0.25 }] },
        { stage: 'golden', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'benchHeal', amount: 0.4, allPlayers: true }, { kind: 'reviveReduce', seconds: 20, allPlayers: true }] },
        { stage: 'siren', center: 'self', delay: 0.45, telegraphLead: 0, area: ALL, affects: 'allies', effects: [{ kind: 'heal', amount: 0.06 }, { kind: 'cleanse' }], hits: 3, hitInterval: 1 },
      ],
    },
  },
  {
    // 기획 12차: 흡혼 퇴마사 — "때리면" 고쳐진다. 적에게 흡혼 표식을 붙이고, 표식 붙은 적을 때린 아군이 피해의 일부를 회복.
    id: 'exorcist',
    name: '퇴마사',
    role: 'healer',
    color: '#a4161a',
    stats: { maxHp: 500, atk: 22, def: 0.08, atkSpeed: 1.0, range: 5, moveSpeed: 3.6, critChance: 0.1, critMult: 1.6 },
    swapCooldown: 10,
    swapEnergy: 6,
    basic: { kind: 'projectile', speed: 14 },
    passive: {
      id: 'exorcist_p',
      name: '흡혼의 먹',
      description: '기본 공격 적중 시 30% 확률로 3초간 흡혼 표식(이 적에게 준 피해의 30%만큼 때린 아군 HP 회복).',
      onHitStatus: { chance: 0.3, status: 'drain', duration: 3, value: 0.3 },
    },
    normal: {
      id: 'exorcist_n',
      name: '축귀 부적',
      slot: 'normal',
      description: '대상 주변 반경 1.5에 공격력 160% 피해 + 4초간 흡혼 표식(피해의 30%).',
      cooldown: 7,
      castRange: 6,
      castTime: 0.3,
      actions: [{ center: 'target', area: { shape: 'circle', radius: 1.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'drain', duration: 4, value: 0.3 }] }],
    },
    drag: {
      id: 'exorcist_d',
      name: '팔문 봉인진',
      slot: 'drag',
      description: '착지 지점 둘레 고리(안쪽 0.8 ~ 바깥 3.5, 한가운데는 비어 있음 — 적 옆에 떨어뜨리기)에 부적 결계: 공격력 110% 피해 + 8초간 흡혼 표식(이 적에게 준 피해의 60%만큼 때린 아군 HP 회복, 보스·중형보스는 절반) + 1.2초 속박. 0.6초 뒤 반경 3.5 멸(滅): 공격력 130% 피해, 맞은 적 1명당 반경 4.5 아군 HP 3% 회복(최대 5명).',
      actions: [
        { stage: 'seal', center: 'point', area: { shape: 'ring', inner: 0.8, outer: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.1 }, { kind: 'status', status: 'drain', duration: 8, value: 0.6 }, { kind: 'status', status: 'root', duration: 1.2, value: 0 }] },
        { stage: 'destroy', center: 'point', delay: 0.6, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.3 }], healPerHit: { radius: 4.5, amount: 0.03, maxHits: 5 } },
      ],
    },
    ult: {
      id: 'exorcist_u',
      name: '백귀야행 봉인',
      slot: 'ult',
      description: '주변 반경 7의 적에게 공격력 100% 피해 + 10초간 흡혼 표식(피해의 55%) + 3초간 40% 둔화. 3초간 부적 폭풍(0.5초마다 공격력 20% 피해). 3.5초에 멸(滅): 적에게 공격력 160% 피해 + 1.2초 기절, 반경 7 아군 HP 8% 회복.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'greatseal', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'drain', duration: 10, value: 0.55 }, { kind: 'status', status: 'slow', duration: 3, value: 0.4 }] },
        { stage: 'storm', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }], zone: { duration: 3, tickInterval: 0.5 } },
        { stage: 'destroy', center: 'self', delay: 3.5, telegraphLead: 0.5, area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.6 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }] },
        { stage: 'destroy', center: 'self', delay: 3.5, telegraphLead: 0, area: { shape: 'circle', radius: 7 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08 }] },
      ],
    },
  },

  // ─────────────────────────── 서포터 ───────────────────────────
  {
    id: 'bard',
    name: '바드',
    role: 'support',
    color: '#e056fd',
    stats: { maxHp: 540, atk: 15, def: 0.1, atkSpeed: 1.0, range: 5, moveSpeed: 3.7, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 9,
    swapEnergy: 6,
    basic: { kind: 'projectile', speed: 14 },
    passive: {
      id: 'bard_p',
      name: '경쾌한 박자',
      description: '이동 속도 +10%, 공격 속도 +10%.',
      stats: { moveSpeedPct: 0.1, atkSpeedPct: 0.1 },
    },
    normal: {
      id: 'bard_n',
      name: '격려의 노래',
      slot: 'normal',
      description: '주변 반경 5 아군 4초간 공격 속도 +20%.',
      cooldown: 8,
      castRange: 99,
      castTime: 0.3,
      actions: [{ center: 'self', area: { shape: 'circle', radius: 5 }, affects: 'allies', effects: [{ kind: 'status', status: 'haste', duration: 4, value: 0.2 }] }],
    },
    drag: {
      id: 'bard_d',
      name: '공명 삼중주',
      slot: 'drag',
      description: '착지 지점을 지나는 세로 띠(길이 12, 폭 2.6): 아군 7초간 공격 속도 +40%·공격력 +30%, 적 공격력 50% 피해 + 3초간 40% 둔화. 내 대기 캐릭터 10초간 공격력 +15%·공격 속도 +15%. 0.3초 뒤 좌우 띠(±2.8칸, 폭 1.8)에 같은 아군 버프와 적 공격력 40% 피해, 0.7초에 가운데(폭 3) 공격력 80% 피해 + 3초간 50% 둔화.',
      actions: [
        { stage: 'beat1', center: 'point', area: band(2.6), affects: 'allies', effects: BARD_BUFF },
        { stage: 'beat1', center: 'point', area: band(2.6), affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }, { kind: 'status', status: 'slow', duration: 3, value: 0.4 }] },
        { stage: 'encore', center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'benchStatus', status: 'atkUp', duration: 10, value: 0.15 }, { kind: 'benchStatus', status: 'haste', duration: 10, value: 0.15 }] },
        ...[-2.8, 2.8].flatMap((x): SkillAction[] => [
          { stage: 'beat2', center: 'point', offset: { x, y: 0 }, delay: 0.3, area: band(1.8), affects: 'enemies', effects: [{ kind: 'damage', amount: 0.4 }] },
          { stage: 'beat2', center: 'point', offset: { x, y: 0 }, delay: 0.3, telegraphLead: 0, area: band(1.8), affects: 'allies', effects: BARD_BUFF },
        ]),
        { stage: 'forte', center: 'point', delay: 0.7, area: band(3), affects: 'enemies', effects: [{ kind: 'damage', amount: 0.8 }, { kind: 'status', status: 'slow', duration: 3, value: 0.5 }] },
      ],
    },
    ult: {
      id: 'bard_u',
      name: '대합창 · 앙코르',
      slot: 'ult',
      description: '모든 아군 HP 20% 회복 + 5초간 초당 HP 2% 재생 + 정화 + 10초간 공격력 +30%·공격 속도 +25%. 모든 플레이어의 대기 캐릭터 10초간 공격력 +15%·공격 속도 +15%. 주변 반경 8에 음파 3번(0.6초마다): 각각 공격력 60% 피해 + 2초간 30% 둔화.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'choir', center: 'self', delay: 0.45, area: ALL, affects: 'allies', effects: [
          { kind: 'heal', amount: 0.2 },
          { kind: 'status', status: 'regen', duration: 5, value: 0.02 },
          { kind: 'cleanse' },
          { kind: 'status', status: 'atkUp', duration: 10, value: 0.3 },
          { kind: 'status', status: 'haste', duration: 10, value: 0.25 },
        ] },
        { stage: 'encore', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'benchStatus', status: 'atkUp', duration: 10, value: 0.15, allPlayers: true }, { kind: 'benchStatus', status: 'haste', duration: 10, value: 0.15, allPlayers: true }] },
        { stage: 'beat', center: 'self', follow: true, delay: 0.45, area: { shape: 'circle', radius: 8 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.6 }, { kind: 'status', status: 'slow', duration: 2, value: 0.3 }], hits: 3, hitInterval: 0.6 },
      ],
    },
  },
  {
    id: 'chrono',
    name: '크로노',
    role: 'support',
    color: '#b8c0ff',
    stats: { maxHp: 500, atk: 18, def: 0.08, atkSpeed: 0.9, range: 5.5, moveSpeed: 3.6, critChance: 0.1, critMult: 1.6 },
    swapCooldown: 9,
    swapEnergy: 6,
    basic: { kind: 'projectile', speed: 13 },
    passive: {
      id: 'chrono_p',
      name: '느려지는 초침',
      description: '기본 공격 적중 시 30% 확률로 2초간 30% 둔화.',
      onHitStatus: { chance: 0.3, status: 'slow', duration: 2, value: 0.3 },
    },
    normal: {
      id: 'chrono_n',
      name: '초침 베기',
      slot: 'normal',
      description: '대상 중심 십자(+, 상하좌우 2칸, 폭 1)에 공격력 150% 피해 + 2초간 30% 둔화.',
      cooldown: 7,
      castRange: 6,
      castTime: 0.3,
      actions: [{ center: 'target', area: { shape: 'cross', length: 2, width: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'slow', duration: 2, value: 0.3 }] }],
    },
    drag: {
      id: 'chrono_d',
      name: '시간 균열 · 역행',
      slot: 'drag',
      description: '착지 지점에 X자 균열(대각선 3.5칸, 폭 1.3): 공격력 100% 피해 + 3초간 50% 둔화, 내 대기 캐릭터 재등장 쿨 2초 감소. 0.5초 뒤 반경 3.8의 적을 1.4칸 끌어당겨 되감고, 0.85초에 다시 X자(폭 1.6)로 정지: 공격력 140% 피해 + 1.2초 기절 + 3초간 받는 피해 +15%.',
      actions: [
        { stage: 'rift', center: 'point', area: { shape: 'cross', diagonal: true, length: 3.5, width: 1.3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }, { kind: 'status', status: 'slow', duration: 3, value: 0.5 }] },
        // 기획 6차 (쿨은 나간 순간부터): the card that just left always carries a fresh full cooldown, so the cut always lands
        { stage: 'rift', center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'swapCooldownReduce', seconds: 2, energy: 2 }] },
        { stage: 'rewind', center: 'point', delay: 0.5, area: { shape: 'circle', radius: 3.8 }, affects: 'enemies', effects: [{ kind: 'pull', distance: 1.4 }] },
        // damage first, then the stun (기획서: 피해 먼저)
        { stage: 'stop', center: 'point', delay: 0.85, area: { shape: 'cross', diagonal: true, length: 3.5, width: 1.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.4 }, { kind: 'status', status: 'stun', duration: 1.2, value: 0 }, { kind: 'status', status: 'vulnerable', duration: 3, value: 0.15 }] },
      ],
    },
    ult: {
      id: 'chrono_u',
      name: '시간 정지 · 영겁의 초침',
      slot: 'ult',
      description: '주변 반경 9의 적 2.5초 정지(보스·중형보스는 짧게) + 5초간 받는 피해 +20%. 정지가 풀릴 때 정지 동안 받은 피해의 30%를 한꺼번에 다시 받음. 모든 플레이어의 대기 캐릭터 재등장 쿨 4초 감소.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'stasis', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 9 }, affects: 'enemies', effects: [{ kind: 'status', status: 'stasis', duration: 2.5, value: 0.3 }, { kind: 'status', status: 'vulnerable', duration: 5, value: 0.2 }] },
        { stage: 'stasis', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'swapCooldownReduce', seconds: 4, allPlayers: true }] },
      ],
    },
  },
  {
    // 기획 12차: 미끼와 약화 — 종이 인형이 가까운 적의 공격을 대신 받고 (도발 아님: "가장 가까운 대상" 규칙), 터지면 공격력 −.
    id: 'puppeteer',
    name: '퍼펫티어',
    role: 'support',
    color: '#ff99c8',
    stats: { maxHp: 540, atk: 17, def: 0.1, atkSpeed: 1.0, range: 5, moveSpeed: 3.6, critChance: 0.05, critMult: 1.5 },
    swapCooldown: 11,
    swapEnergy: 6,
    basic: { kind: 'projectile', speed: 13 },
    passive: {
      id: 'puppeteer_p',
      name: '얽힌 실',
      description: '기본 공격 적중 시 25% 확률로 3초간 공격력 −15%.',
      onHitStatus: { chance: 0.25, status: 'atkDown', duration: 3, value: 0.15 },
    },
    normal: {
      id: 'puppeteer_n',
      name: '실 감기',
      slot: 'normal',
      description: '대상에게 공격력 150% 피해 + 4초간 공격력 −20%.',
      cooldown: 7,
      castRange: 6,
      castTime: 0.3,
      actions: [{ center: 'target', area: { shape: 'single' }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.5 }, { kind: 'status', status: 'atkDown', duration: 4, value: 0.2 }] }],
    },
    drag: {
      id: 'puppeteer_d',
      name: '대역 인형극',
      slot: 'drag',
      description: '착지 지점 좌우 2.5칸에 종이 인형 둘(왼쪽 먼저, 0.15초 뒤 오른쪽, 반경 1.5): 적에게 공격력 150% 피해 + 인형 쪽으로 0.8칸 끌어당김. 인형(HP = 내 최대 HP 60%, 7초)은 가까운 적의 공격을 대신 받고, 0.35초부터 두 인형 사이 실(길이 5, 폭 1)이 6초간 1초마다 공격력 40% 피해 + 1.2초간 40% 둔화. 인형이 부서지거나 시간이 다 되면 반경 2.3 적에게 공격력 200% 피해 + 5초간 공격력 −30%.',
      actions: [
        dollToss(-2.5),
        dollToss(2.5, 0.15),
        { stage: 'thread', center: 'point', delay: 0.35, telegraphLead: 0, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 5, width: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.4 }, { kind: 'status', status: 'slow', duration: 1.2, value: 0.4 }], zone: { duration: 6, tickInterval: 1 } },
      ],
    },
    ult: {
      id: 'puppeteer_u',
      name: '인형극 개막 · 커튼콜',
      slot: 'ult',
      description: '주변 반경 7 적 8초간 공격력 −35%, 가까운 일반 적 4마리까지 2.5초간 조종(가장 가까운 다른 적을 공격). 자기 주변 네 곳(좌우 3칸, 위아래 2칸)에 대형 인형(HP = 내 최대 HP 65%, 10초, 부서지면 반경 2.5 적에게 공격력 160% 피해 + 5초간 공격력 −35%)을 세움. 3초에 커튼콜: 반경 7 적에게 공격력 120% 피해 + 1초 기절.',
      castTime: ULT_CAST,
      actions: [
        { stage: 'open', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'status', status: 'atkDown', duration: 8, value: 0.35 }] },
        { stage: 'charm', center: 'self', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'status', status: 'charm', duration: 2.5, value: 0 }], maxTargets: 4 },
        ...[
          [-3, -2],
          [3, -2],
          [-3, 2],
          [3, 2],
        ].map(([x, y]): SkillAction => ({
          stage: 'dolls',
          center: 'self',
          offset: { x, y },
          delay: 0.45,
          telegraphLead: 0,
          area: { shape: 'circle', radius: 0.8 },
          affects: 'allies',
          effects: [],
          summon: { unitId: 'paper_doll_grand', count: 1, duration: 10, inherit: { hp: 0.65, atk: 1 } },
        })),
        { stage: 'curtaincall', center: 'self', follow: true, delay: 3, telegraphLead: 0.5, area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1.2 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] },
      ],
    },
  },
];
