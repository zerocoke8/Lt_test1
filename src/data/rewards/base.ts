import type { RewardFamilyDef, Role } from '../../types';

// 층 보상 기본 12계열 (기획서 10장 → 기획 17차): ids, numbers and effects unchanged since 16차 (saved 원정 runs read as
// they are) — 17차 only adds tags, the 지명권 role order and the bot weight. params.v = the old value.

export const pct = (v: number): string => `${Math.round(v * 100)}%`;

const levels = (c: number, r: number, e: number) => ({ common: { v: c }, rare: { v: r }, epic: { v: e } });

/** 지명권 default order: drag / swap / ult cards (원거리딜러 > 근접딜러 > 탱커 > 서포터 > 힐러). */
export const PREF_DEALER: Role[] = ['ranged', 'melee', 'tank', 'support', 'healer'];
const PREF_SHIELD: Role[] = ['tank', 'melee', 'ranged', 'support', 'healer'];
const PREF_NORMAL: Role[] = ['healer', 'support', 'ranged', 'melee', 'tank'];

const who = (ctx: { char?: string }) => ctx.char ?? '{char}';

const BASIC_BOT = 1.2;

export const BASE_FAMILIES: RewardFamilyDef[] = [
  // 파티 전체 스탯
  { key: 'atk', name: '공격력 강화', tags: ['attack'], target: 'party', botWeight: BASIC_BOT, params: levels(0.08, 0.15, 0.25), describe: v => `내 캐릭터 전원 공격력 +${pct(v.v)}`, legacyEffect: v => ({ kind: 'stat', mods: { atkPct: v.v } }) },
  { key: 'hp', name: '체력 강화', tags: ['survive'], target: 'party', botWeight: BASIC_BOT, params: levels(0.1, 0.2, 0.35), describe: v => `내 캐릭터 전원 최대 HP +${pct(v.v)}`, legacyEffect: v => ({ kind: 'stat', mods: { hpPct: v.v } }) },
  { key: 'aspd', name: '공격 속도', tags: ['attack'], target: 'party', botWeight: BASIC_BOT, params: levels(0.08, 0.15, 0.25), describe: v => `내 캐릭터 전원 공격 속도 +${pct(v.v)}`, legacyEffect: v => ({ kind: 'stat', mods: { atkSpeedPct: v.v } }) },
  { key: 'crit', name: '치명타', tags: ['attack'], target: 'party', botWeight: BASIC_BOT, params: levels(0.05, 0.1, 0.18), describe: v => `내 캐릭터 전원 치명타 확률 +${pct(v.v)}`, legacyEffect: v => ({ kind: 'stat', mods: { critChance: v.v } }) },
  { key: 'def', name: '방어 태세', tags: ['survive'], target: 'party', botWeight: BASIC_BOT, params: levels(0.04, 0.08, 0.12), describe: v => `내 캐릭터 전원 받는 피해 -${pct(v.v)}`, legacyEffect: v => ({ kind: 'stat', mods: { defFlat: v.v } }) },
  { key: 'petcd', name: '펫 훈련', tags: ['pet'], target: 'party', botWeight: BASIC_BOT, params: levels(0.1, 0.2, 0.3), describe: v => `펫 쿨타임 −${pct(v.v)}`, legacyEffect: v => ({ kind: 'petCooldown', value: v.v }) },
  // 캐릭터 1명 (지명권) — 교체 관련 4종
  { key: 'dragdmg', name: '{char} 드래그스킬 강화', tags: ['appear'], target: 'member', prefRoles: PREF_DEALER, botWeight: BASIC_BOT, params: levels(0.2, 0.4, 0.7), describe: (v, c) => `${who(c)}의 드래그스킬 피해·회복 +${pct(v.v)}`, legacyEffect: v => ({ kind: 'skill', slot: 'drag', stat: 'damage', value: v.v }) },
  { key: 'dragrad', name: '{char} 드래그스킬 확장', tags: ['appear'], target: 'member', prefRoles: PREF_DEALER, botWeight: BASIC_BOT, params: levels(0.15, 0.3, 0.5), describe: (v, c) => `${who(c)}의 드래그스킬 범위 +${pct(v.v)}`, legacyEffect: v => ({ kind: 'skill', slot: 'drag', stat: 'radius', value: v.v }) },
  { key: 'swapcd', name: '{char} 빠른 교대', tags: ['swap'], target: 'member', prefRoles: PREF_DEALER, botWeight: BASIC_BOT, params: levels(1, 2, 3), describe: (v, c) => `${who(c)}의 재등장 쿨 -${v.v}초 (최소 4초)`, legacyEffect: v => ({ kind: 'swapCooldown', value: v.v }) },
  { key: 'appshield', name: '{char} 등장 보호막', tags: ['appear', 'survive'], target: 'member', prefRoles: PREF_SHIELD, botWeight: BASIC_BOT, params: levels(0.1, 0.2, 0.3), describe: (v, c) => `${who(c)} 등장 시 최대 HP ${pct(v.v)} 보호막 (4초)`, legacyEffect: v => ({ kind: 'appearShield', value: v.v }) },
  // 캐릭터 1명 — 기타
  { key: 'normcd', name: '{char} 일반스킬 가속', tags: ['attack'], target: 'member', prefRoles: PREF_NORMAL, botWeight: BASIC_BOT, params: levels(0.15, 0.3, 0.45), describe: (v, c) => `${who(c)}의 일반스킬 쿨타임 -${pct(v.v)}`, legacyEffect: v => ({ kind: 'skill', slot: 'normal', stat: 'cooldown', value: v.v }) },
  { key: 'ultdmg', name: '{char} 궁극기 강화', tags: ['ult'], target: 'member', prefRoles: PREF_DEALER, botWeight: BASIC_BOT, params: levels(0.2, 0.4, 0.7), describe: (v, c) => `${who(c)}의 궁극기 피해·회복 +${pct(v.v)}`, legacyEffect: v => ({ kind: 'skill', slot: 'ult', stat: 'damage', value: v.v }) },
];

/** The 12 basic family keys (slot 1 of every normal screen comes from these). */
export const BASIC_KEYS: ReadonlySet<string> = new Set(BASE_FAMILIES.map(f => f.key));
