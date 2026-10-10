import type { RewardFamilyDef, Role } from '../../types';
import { pct } from './base';
import { ROLE_NAME } from './tags';

// 기획 17차 Track A — 등장·착지 + 퇴장 + 직업 특기 + 교대 연계 (docs/floor-rewards.md). Behaviour: src/sim/rewards/swap.ts.
// 26 families. Numbers live in params per rarity (the sim reads them with query.rewardParam); 「두 번」 = power / %
// added, radius / duration / targets the larger one, unless the family says otherwise.

/** 직업 특기 lines per role, by rarity level (1 일반 · 2 희귀 · 3 영웅; each level adds to the one below). */
export const ROLE_LINES: Record<Role, [string, string, string]> = {
  tank: ['육중한 착지: 반경 3 적 1칸 밀기 + 3초 받는 피해 −30%', '버려진 방패: 퇴장 자리 장판 5초, 아군 받는 피해 −20%', '짚 인형: 퇴장 자리 도발 인형 4초, 맞은 피해 30%를 다음 등장 보호막으로'],
  melee: ['착지 참격: 가까운 적 쪽 직선 150%', '처형 착지: 반경 2 HP 16% 이하 일반 적 처치', '참격 220%, 처형 20%'],
  ranged: ['치고 빠지기: 3초 동안 다음 1번 회피 + 이동 속도 +30%', '두고 간 포탑: 퇴장 자리 포탑 6초 (공 40%)', '갈래 사격: 드래그가 좌우 두 곳에서 40%로 한 번 더'],
  healer: ['응급 착지: 가장 다친 캐릭터 최대 HP 15% 회복, 부활 −3초', '치유의 잔향: 퇴장 자리 회복 장판 5초 (초당 3%)', '잔향 초당 5% + 받는 피해 −10%, 드래그를 가장 다친 아군 자리에서 60%로 한 번 더'],
  support: ['다음 타자: 퇴장하면 다음 등장 캐릭터 공격력 +25%·공속 +20% 5초', '응원가: 등장 때 반경 4 팀 공격력·공속 +15% 5초', '대기석 응원단: 대기 서포터 1명당 공격력 +10%'],
};

/** 직업 특기 numbers (src/sim/rewards/swap.ts; taken twice for the same role → ROLE_TWICE ×). */
export const ROLE_NUM = {
  tank: { pushRadius: 3, push: 1, guard: 0.3, guardDur: 3, zoneRadius: 2.5, zoneDur: 5, zoneGuard: 0.2, decoyHp: 0.3, decoyDur: 4, decoyTaunt: 4, store: 0.3, storeCap: 0.25 },
  melee: { slash: 1.5, slash3: 2.2, slashLen: 6, slashWidth: 1.2, execRadius: 2, exec: 0.16, exec3: 0.2 },
  ranged: { dodgeDur: 3, move: 0.3, turretDur: 6, turretInterval: 0.8, turretRange: 6, turret: 0.4, forkDelay: 0.4, forkSide: 1.5, fork: 0.4 },
  healer: { heal: 0.15, revive: 3, zoneRadius: 2.5, zoneDur: 5, zoneHeal: 0.03, zoneHeal3: 0.05, zoneGuard: 0.1, twin: 0.6 },
  support: { atk: 0.25, haste: 0.2, buffDur: 5, cheer: 0.15, cheerRadius: 4, bench: 0.1 },
} as const;
export const ROLE_TWICE = 1.5;

/** A reward card's text longer than this (chars) keeps only the names of the lower 직업 특기 lines (phone: ~5 lines). */
export const ROLE_CARD_MAX = 90;

/**
 * 직업 특기 text up to `level`: every line in full (build sheet), or on the reward card, when that is too long, the lower
 * lines by name only and the newest line in full (「탱커 전원 · 육중한 착지 · 버려진 방패 + 짚 인형: …」).
 */
function roleText(role: Role, level: number, card: boolean): string {
  const lines = ROLE_LINES[role].slice(0, Math.max(1, Math.min(3, level)));
  const full = `${ROLE_NAME[role]} 전원 · ${lines.join(' / ')}`;
  if (!card || full.length <= ROLE_CARD_MAX || lines.length < 2) return full;
  const names = lines.slice(0, -1).map(l => l.split(':')[0]);
  return `${ROLE_NAME[role]} 전원 · ${names.join(' · ')} + ${lines[lines.length - 1]}`;
}

const AUTO = 1;
const POSITIONAL = 0.6;

export const SWAP_FAMILIES: RewardFamilyDef[] = [
  // ─────────── 등장·착지 ───────────
  {
    key: 'bolt',
    name: '등장 에너지탄',
    tags: ['appear'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { targets: 2, power: 0.6 }, rare: { targets: 3, power: 0.75 }, epic: { targets: 4, power: 0.9 } },
    describe: v => `등장할 때 가까운 적 ${v.targets}명에게 에너지탄 (공격력 ${pct(v.power)})`,
  },
  {
    key: 'startle',
    name: '깜짝 등장',
    tags: ['appear', 'status'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { radius: 2.5, stun: 0.6 }, rare: { radius: 3, stun: 0.8 } },
    describe: v => `등장할 때 반경 ${v.radius} 적 ${v.stun}초 기절 (같은 적 5초에 1번, 보스 제외)`,
  },
  {
    key: 'beckon',
    name: '원혼의 손짓',
    tags: ['appear', 'status'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { radius: 3.5, pull: 2.5, slow: 0.3 }, rare: { radius: 4.5, pull: 2.5, slow: 0.4 } },
    describe: v => `등장할 때 반경 ${v.radius} 적을 ${v.pull}칸 끌어당기고 2초 둔화 ${pct(v.slow)} (보스 제외)`,
  },
  {
    key: 'scorch',
    name: '그을린 발자국',
    tags: ['appear', 'status'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { power: 0.2 }, rare: { power: 0.25 }, epic: { power: 0.35 } },
    describe: v => `착지한 자리에 반경 2 불길 4초, 초당 공격력 ${pct(v.power)} + 화상`,
  },
  {
    key: 'relay_line',
    name: '교대선',
    tags: ['swap', 'appear'],
    target: 'party',
    botWeight: POSITIONAL,
    params: { rare: { width: 1.6, power: 2 }, epic: { width: 2, power: 2.6 } },
    describe: v => `퇴장 자리에서 착지 자리까지 직선 위 적에게 공격력 ${pct(v.power)} (너비 ${v.width}, 최소 3칸)`,
  },
  {
    key: 'inplace',
    name: '맞교대',
    tags: ['swap'],
    target: 'party',
    unique: true,
    botWeight: POSITIONAL,
    params: { rare: { range: 1.5, invuln: 1, cdMult: 0.5 } },
    describe: v => `퇴장 자리 ${v.range}칸 안에 착지하면 등장 무적 +${v.invuln}초, 나간 캐릭터 재등장 쿨 ×${v.cdMult} (최소 4초)`,
  },
  {
    key: 'prompt',
    name: '준비 즉시',
    tags: ['swap'],
    target: 'party',
    botWeight: POSITIONAL,
    params: { common: { window: 1, power: 0.3, ult: 0.05 }, rare: { window: 1.5, power: 0.4, ult: 0.05 } },
    describe: v => `카드가 준비되고 ${v.window}초 안에 드래그하면 「즉시!」 드래그 +${pct(v.power)}, 궁 +${pct(v.ult)}`,
  },
  {
    key: 'rested',
    name: '오래 쉰 자의 분노',
    tags: ['swap'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { per: 0.03 }, rare: { per: 0.04 }, epic: { per: 0.05 } },
    describe: v => `준비된 뒤 기다린 1초마다 1중첩 (최대 10), 등장 때 중첩당 드래그 피해 +${pct(v.per)}`,
  },
  {
    key: 'talisman',
    name: '부적 착지',
    tags: ['appear', 'survive'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { radius: 3, per: 0.05, cap: 0.2 }, rare: { radius: 4, per: 0.07, cap: 0.28 } },
    describe: v => `착지 반경 ${v.radius} 팀의 해로운 상태를 없애고, 1개당 보호막 최대 HP ${pct(v.per)} (최대 ${pct(v.cap)}, 4초)`,
  },
  {
    key: 'doppel',
    name: '도플갱어',
    tags: ['swap', 'appear'],
    target: 'party',
    unique: true,
    botWeight: AUTO,
    params: { legendary: { power: 0.5, delay: 0.6, life: 3 } }, // 기획 17차 밸런스: 0.35 → 0.5
    describe: v => `교체하면 퇴장 자리에 분신이 ${v.delay}초 뒤 등장 캐릭터의 드래그를 ${pct(v.power)}로 한 번 더 (이동 없음)`,
  },
  // ─────────── 퇴장 ───────────
  {
    key: 'relay_blast',
    name: '교대 폭발',
    tags: ['leave'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { radius: 1.5, power: 0.6 }, rare: { radius: 2, power: 1 }, epic: { radius: 2, power: 1.5 } },
    describe: v => `퇴장한 자리에 반경 ${v.radius} 폭발, 공격력 ${pct(v.power)} (「교대의 깃발」과는 하나로: 깃발 위력 +50%·반경 +0.5)`,
  },
  {
    key: 'shade',
    name: '잔상',
    tags: ['leave'],
    target: 'party',
    botWeight: AUTO,
    params: { rare: { life: 3, power: 0.5 }, epic: { life: 4, power: 0.6 } },
    describe: v => `퇴장 자리에 잔상 ${v.life}초, 0.6초마다 가까운 적에게 공격력 ${pct(v.power)} (사거리 5, 맞지 않음)`,
  },
  {
    key: 'mine',
    name: '발밑 지뢰',
    tags: ['leave', 'status'],
    target: 'party',
    botWeight: 0.8,
    params: { common: { cap: 2, power: 1.2 }, rare: { cap: 3, power: 1.8 } },
    describe: v => `퇴장 자리에 지뢰 20초 (최대 ${v.cap}개), 밟으면 반경 1.5 공격력 ${pct(v.power)} + 속박 1.5초`,
  },
  {
    key: 'evac',
    name: '응급 후송',
    tags: ['leave', 'survive'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { rate: 0.06, cd: 0 }, rare: { rate: 0.08, cd: 1.5 } },
    describe: v =>
      `HP 35% 이하로 퇴장하면 대기석에서 4초 동안 초당 최대 HP ${pct(v.rate)} 회복${v.cd > 0 ? ` + 재등장 쿨 −${v.cd}초` : ''} (캐릭터별 20초에 1번)`,
  },
  {
    key: 'farewell',
    name: '마지막 인사',
    tags: ['leave'],
    target: 'party',
    unique: true,
    botWeight: AUTO,
    params: { rare: { icd: 6 } },
    describe: v => `퇴장할 때 그 캐릭터 일반스킬을 퇴장 자리에서 1번 (쿨 안 씀, 캐릭터별 ${v.icd}초에 1번)`,
  },
  {
    key: 'fog',
    name: '검은 안개',
    tags: ['leave', 'status'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { radius: 3, life: 3, atkDown: 0.2 }, rare: { radius: 3.5, life: 4, atkDown: 0.25 } },
    describe: v => `퇴장 자리에 반경 ${v.radius} 안개 ${v.life}초, 안의 적 둔화 40% + 공격력 −${pct(v.atkDown)}`,
  },
  {
    key: 'shove',
    name: '물러서!',
    tags: ['leave'],
    target: 'party',
    botWeight: AUTO,
    params: { common: { push: 1, stun: 0.3 }, rare: { push: 1.5, stun: 0.5 } }, // 기획 17차 밸런스: 2/0 · 3/0.4 (pushing out of the drag hurt)
    describe: v => `퇴장 자리 반경 3 적을 ${v.push}칸 밀어냄${v.stun > 0 ? ` + 기절 ${v.stun}초 (같은 적 5초에 1번)` : ''}`,
  },
  // ─────────── 직업 특기 (계열 1개, 직업 값) ───────────
  {
    key: 'role',
    name: '직업 특기',
    tags: [], // resolved per role (ROLE_TAGS, src/sim/rewards/query.ts tagsOf)
    target: 'role',
    botWeight: AUTO,
    params: { common: { level: 1 }, rare: { level: 2 }, epic: { level: 3 } },
    describe: (v, ctx) => (ctx.role ? roleText(ctx.role, v.level, !!ctx.card) : `내 파티 직업 하나의 특기 ${v.level}단계 (그 직업 캐릭터 전원)`),
  },
  // ─────────── 교대 연계·편성 ───────────
  {
    key: 'baton',
    name: '바통 터치',
    tags: ['swap'],
    target: 'party',
    botWeight: AUTO,
    params: { rare: { extra: 2 }, epic: { extra: 3 } },
    describe: v => `나가는 캐릭터의 이로운 상태(공격력·공속·방어·재생·흡혈·범위)를 들어오는 캐릭터가 이어받고 +${v.extra}초`,
  },
  {
    key: 'combo',
    name: '연쇄 교대',
    tags: ['swap'],
    target: 'party',
    botWeight: POSITIONAL,
    params: { rare: { per: 0.15 }, epic: { per: 0.2 } },
    describe: v => `직전 교대 5초 안에 다시 교대하면 1중첩 (최대 3), 중첩당 드래그 +${pct(v.per)}. 5초 쉬면 0`,
  },
  {
    key: 'handover',
    name: '인수인계',
    tags: ['swap'],
    target: 'party',
    unique: true,
    botWeight: AUTO,
    params: { epic: { life: 8 } }, // 기획 17차 밸런스: 6 → 8
    describe: v =>
      `다른 직업으로 교대하면 등장 캐릭터 ${v.life}초 축복: 탱커 받는 피해 −20% / 근접 공속 +20% / 원거리 치명 +15% / 힐러 초당 2% 회복 / 서포터 공격력 +15%`,
  },
  {
    key: 'cover_swap',
    name: '엄호 교대',
    tags: ['swap'],
    target: 'party',
    requires: 'tankAndDealer',
    botWeight: 0.8,
    params: { rare: { power: 0.4, guard: 0.25, life: 3 } },
    describe: v => `탱커가 나가고 근접·원거리딜러가 들어오면 드래그 +${pct(v.power)}, ${v.life}초 받는 피해 −${pct(v.guard)}`,
  },
  {
    key: 'aftercare',
    name: '뒷수습',
    tags: ['swap', 'survive'],
    target: 'party',
    requires: 'healerAndDealer',
    botWeight: 0.8,
    params: { common: { frac: 0.4 }, rare: { frac: 0.6 } },
    describe: v => `딜러가 나가고 힐러가 들어오면 그 드래그의 넘친 회복 ${pct(v.frac)}를 보호막으로 (6초, 최대 HP 30%까지)`,
  },
  {
    key: 'relay3',
    name: '릴레이 3연타',
    tags: ['swap'],
    target: 'party',
    botWeight: 0.8,
    params: { epic: { power: 2.4, radius: 5, ult: 0.15, icd: 12 } }, // 기획 17차 밸런스: 1.8 / 15 s → 2.4 / 12 s
    describe: v => `6초 안에 내 3명이 모두 등장하면 3번째 착지점 반경 ${v.radius} 충격파 ${pct(v.power)} + 궁 +${pct(v.ult)} (${v.icd}초에 1번)`,
  },
  {
    key: 'partners',
    name: '동업자',
    tags: ['swap'],
    target: 'party',
    requires: 'dupRole',
    botWeight: AUTO,
    params: { rare: { cd: 2, power: 0.15 } },
    describe: v => `같은 직업 2명: 그 직업이 등장하면 같은 직업 동료 남은 쿨 −${v.cd}초, 드래그 +${pct(v.power)}`,
  },
  {
    key: 'tricolor',
    name: '삼색 파티',
    tags: ['swap'],
    target: 'party',
    requires: 'allRolesDiffer',
    unique: true,
    botWeight: 1.2,
    params: { common: { stat: 0.03, ult: 0.02 } }, // 기획 17차 밸런스: 5 → 3 % (a common worth an epic: V 17)
    describe: v => `직업 3개가 다르면 공격력·최대 HP +${pct(v.stat)}, 교대할 때마다 등장 캐릭터 궁 +${pct(v.ult)}`,
    legacyEffect: v => ({ kind: 'stat', mods: { atkPct: v.stat, hpPct: v.stat } }),
  },
];
