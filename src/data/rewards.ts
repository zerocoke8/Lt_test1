import type { Rarity, RewardDef, RewardEffect, RewardScope } from '../types';

// 층 보상: 스탯 또는 스킬, 레어도 3단계 (기획서 10장). 보상 풀의 1/3 이상은 교체 관련.
// 3개 제시 → 1개 선택. 레어도 확률은 RARITY_WEIGHTS.

export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 25, epic: 5 };
export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅' };
export const RARITY_COLOR: Record<Rarity, string> = { common: '#adb5bd', rare: '#4cc9f0', epic: '#c77dff' };

interface Family {
  key: string;
  name: string;
  description: (v: number) => string;
  scope: RewardScope;
  values: [number, number, number];
  effect: (v: number) => RewardEffect;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const FAMILIES: Family[] = [
  // 파티 전체 스탯
  { key: 'atk', name: '공격력 강화', scope: 'party', values: [0.08, 0.15, 0.25], description: v => `내 캐릭터 전원 공격력 +${pct(v)}`, effect: v => ({ kind: 'stat', mods: { atkPct: v } }) },
  { key: 'hp', name: '체력 강화', scope: 'party', values: [0.1, 0.2, 0.35], description: v => `내 캐릭터 전원 최대 HP +${pct(v)}`, effect: v => ({ kind: 'stat', mods: { hpPct: v } }) },
  { key: 'aspd', name: '공격 속도', scope: 'party', values: [0.08, 0.15, 0.25], description: v => `내 캐릭터 전원 공격 속도 +${pct(v)}`, effect: v => ({ kind: 'stat', mods: { atkSpeedPct: v } }) },
  { key: 'crit', name: '치명타', scope: 'party', values: [0.05, 0.1, 0.18], description: v => `내 캐릭터 전원 치명타 확률 +${pct(v)}`, effect: v => ({ kind: 'stat', mods: { critChance: v } }) },
  { key: 'def', name: '방어 태세', scope: 'party', values: [0.04, 0.08, 0.12], description: v => `내 캐릭터 전원 받는 피해 -${pct(v)}`, effect: v => ({ kind: 'stat', mods: { defFlat: v } }) },
  { key: 'petcd', name: '펫 훈련', scope: 'party', values: [0.1, 0.2, 0.3], description: v => `펫 쿨타임 -${pct(v)}`, effect: v => ({ kind: 'petCooldown', value: v }) },
  // 캐릭터 스킬 (롤할 때 내 캐릭터 1명에게 묶임) — 교체 관련 4종
  { key: 'dragdmg', name: '{char} 드래그스킬 강화', scope: 'character', values: [0.2, 0.4, 0.7], description: v => `{char}의 드래그스킬 피해·회복 +${pct(v)}`, effect: v => ({ kind: 'skill', slot: 'drag', stat: 'damage', value: v }) },
  { key: 'dragrad', name: '{char} 드래그스킬 확장', scope: 'character', values: [0.15, 0.3, 0.5], description: v => `{char}의 드래그스킬 범위 +${pct(v)}`, effect: v => ({ kind: 'skill', slot: 'drag', stat: 'radius', value: v }) },
  { key: 'swapcd', name: '{char} 빠른 교대', scope: 'character', values: [1, 2, 3], description: v => `{char}의 재등장 쿨 -${v}초 (최소 4초)`, effect: v => ({ kind: 'swapCooldown', value: v }) },
  { key: 'appshield', name: '{char} 등장 보호막', scope: 'character', values: [0.1, 0.2, 0.3], description: v => `{char} 등장 시 최대 HP ${pct(v)} 보호막 (4초)`, effect: v => ({ kind: 'appearShield', value: v }) },
  // 캐릭터 스킬 — 기타
  { key: 'normcd', name: '{char} 일반스킬 가속', scope: 'character', values: [0.15, 0.3, 0.45], description: v => `{char}의 일반스킬 쿨타임 -${pct(v)}`, effect: v => ({ kind: 'skill', slot: 'normal', stat: 'cooldown', value: v }) },
  { key: 'ultdmg', name: '{char} 궁극기 강화', scope: 'character', values: [0.2, 0.4, 0.7], description: v => `{char}의 궁극기 피해·회복 +${pct(v)}`, effect: v => ({ kind: 'skill', slot: 'ult', stat: 'damage', value: v }) },
];

const RARITIES: Rarity[] = ['common', 'rare', 'epic'];

export const REWARDS: RewardDef[] = FAMILIES.flatMap(f =>
  RARITIES.map((rarity, i) => ({
    id: `${f.key}_${rarity}`,
    name: f.name,
    description: f.description(f.values[i]),
    rarity,
    scope: f.scope,
    effect: f.effect(f.values[i]),
  })),
);
