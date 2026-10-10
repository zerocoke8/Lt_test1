import type { Rarity, RewardDef, RewardFamilyDef, RewardScope } from '../../types';
import { BASE_FAMILIES, BASIC_KEYS } from './base';
import { COMBAT_FAMILIES } from './combat';
import { RULES_FAMILIES } from './rules';
import { SWAP_FAMILIES } from './swap';
import { SYSTEM_FAMILIES } from './system';

// 층 보상 (기획서 10장 → 기획 17차 docs/floor-rewards.md): reward families × rarities 일반 / 희귀 / 영웅 / 전설.
// Each family lives in the file of the track that owns it (base · system: CORE; swap: A; combat: B; rules: C); this
// file only joins them into the flat REWARDS list (id `${key}_${rarity}`), which keeps its 16차 shape.

export { BASIC_KEYS, PREF_DEALER, pct } from './base';
export { MAX_REROLLS } from './system';
export * from './tags';

export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** 괴담 room draws and relic offers keep the 16차 odds (no legendary there). */
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 25, epic: 5, legendary: 0 };
export const RARITY_LABEL: Record<Rarity, string> = { common: '일반', rare: '희귀', epic: '영웅', legendary: '전설' };
export const RARITY_COLOR: Record<Rarity, string> = { common: '#adb5bd', rare: '#4cc9f0', epic: '#c77dff', legendary: '#ff8c42' };

/**
 * 기획 17차: floor-reward rarity odds by band (common / rare / epic / legendary, percent): classic floors 1–10 and 원정
 * stages 1–6, classic 11+ and 원정 7+ with a 2 % legendary.
 * 기획 17차 밸런스 (docs/balance.md 17-2): 70/25/5/0 · 67/25/6/2 → 86/12/2/0 · 82/13/3/2. Players (and the bots, by score)
 * now pick the rarest card of the three, which made rare/epic basics far more common than the 16차 bench's first card.
 */
export const RARITY_BY_BAND: readonly (readonly [number, number, number, number])[] = [
  [86, 12, 2, 0],
  [82, 13, 3, 2],
];

/** Every family, in pool order (basic, system, then the three content tracks). */
export const FAMILIES: readonly RewardFamilyDef[] = [...BASE_FAMILIES, ...SYSTEM_FAMILIES, ...SWAP_FAMILIES, ...COMBAT_FAMILIES, ...RULES_FAMILIES];

const FAMILY_BY_KEY = new Map(FAMILIES.map(f => [f.key, f]));

export function getFamily(key: string): RewardFamilyDef {
  const f = FAMILY_BY_KEY.get(key);
  if (!f) throw new Error(`unknown reward family: ${key}`);
  return f;
}

export function hasFamily(key: string): boolean {
  return FAMILY_BY_KEY.has(key);
}

/** 'atk_common' → 'atk', 'doppel_legendary' → 'doppel'. Offers are distinct by family. */
export function rewardFamily(id: string): string {
  return id.replace(/_(common|rare|epic|legendary)$/, '');
}

export function isBasicFamily(key: string): boolean {
  return BASIC_KEYS.has(key);
}

function scopeOf(f: RewardFamilyDef): RewardScope {
  return f.target === 'member' || f.target === 'role' ? 'character' : 'party';
}

function defsOf(f: RewardFamilyDef): RewardDef[] {
  return RARITIES.filter(r => f.params[r]).map(rarity => {
    const v = f.params[rarity]!;
    const cost = f.cost?.(v);
    return {
      id: `${f.key}_${rarity}`,
      name: f.name,
      description: f.describe(v, {}),
      rarity,
      scope: scopeOf(f),
      effect: f.legacyEffect ? f.legacyEffect(v) : { kind: 'trigger' },
      family: f.key,
      tags: [...f.tags],
      params: { ...v },
      target: f.target,
      ...(f.prefRoles ? { prefRoles: [...f.prefRoles] } : null),
      ...(f.requires ? { requires: f.requires } : null),
      ...(f.unique ? { unique: true } : null),
      botWeight: f.botWeight,
      ...(f.flag ? { flag: f.flag } : null),
      ...(cost ? { cost } : null),
    };
  });
}

export const REWARDS: RewardDef[] = FAMILIES.flatMap(defsOf);

/** The rarities a family has, low to high. */
export function familyRarities(f: RewardFamilyDef): Rarity[] {
  return RARITIES.filter(r => f.params[r]);
}
