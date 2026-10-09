// 기획 15차 원정: player-facing text of gear and stages (Korean). Pure (no DOM): names (docs/gear-art-prompts.md 6장),
// main-stat lines, effect / relic text (docs/expedition.md 4-4, tier multiplier applied), item comparison, the party
// stat preview and the stage names / hints used by the hub, the choice and the HUD pill.

import { getCharacter, getMonster, RELICS } from '../data';
import {
  BAND_NAME_KO,
  BASE_SLOTS,
  RARITY_STARS,
  SLOT_NAME_KO,
  WEAPON_FAMILY_BY_CHAR,
  bandOf,
  gearMainLines,
  gearMainMods,
  gearOptionText,
  relicTierMult,
  slotTier,
  type GearLoadout,
  type GearSlot,
  type GearSpec,
  type WeaponFamily,
} from '../data/gear';
import { EXPEDITION, EXPEDITION_STAGES, isBossStage, stageZoneIndex } from '../data/stages';

const WEAPON_NAMES: Record<WeaponFamily, readonly string[]> = {
  shield: ['낡은 철판 방패', '강화 진압 방패', '퇴마 부적 방패', '심연의 눈 방패'],
  sword: ['녹슨 장검', '강화 강철검', '퇴마 은검', '심연의 검'],
  axe: ['낡은 소방 도끼', '강화 전투 도끼', '퇴마 도끼', '심연의 도끼'],
  bow: ['낡은 나무 활', '강화 합성궁', '퇴마 신궁', '심연의 활'],
  orb: ['금 간 유리구슬', '강화 수정구', '퇴마 영혼구', '심연의 눈알 구'],
  staff: ['낡은 나무 지팡이', '강화 금속 지팡이', '퇴마 방울 지팡이', '심연의 지팡이'],
  hammer: ['낡은 공사 망치', '강화 전투 망치', '퇴마 성망치', '심연의 망치'],
  gun: ['낡은 나팔총', '강화 산탄총', '퇴마 은탄총', '심연의 총'],
  lute: ['낡은 류트', '강화 류트', '퇴마 류트', '심연의 류트'],
};
const ARMOR_NAMES = ['낡은 작업복 조끼', '강화 방호 조끼', '퇴마 도포 갑옷', '심연의 갑주'];
const CHARM_NAMES = ['낡은 방울 열쇠고리', '강화 군번줄', '퇴마 부적', '심연의 눈 펜던트'];

export const ZONE_NAME_KO = ['로비', '사무실', '병동', '옥상'];

/** The weapon look of a character (its hand prop); null = the party's first / a sword. */
export function familyOf(charId: string | null | undefined): WeaponFamily {
  return (charId && WEAPON_FAMILY_BY_CHAR[charId]) || 'sword';
}

/** '심연의 검' — weapons are named by the wearer's family (spec 8-3: the first party member when nobody wears it). */
export function gearName(g: GearSpec, family: WeaponFamily = 'sword'): string {
  const b = Math.max(1, bandOf(g.tier)) - 1;
  if (g.slot === 'relic') return RELICS.find(r => r.id === g.relicId)?.name ?? '유물';
  if (g.slot === 'weapon') return WEAPON_NAMES[family][b];
  return (g.slot === 'armor' ? ARMOR_NAMES : CHARM_NAMES)[b];
}

/** 'T7 퇴마 · 무기 ★' — the small caption under a name. */
export function gearCaption(g: GearSpec): string {
  const stars = RARITY_STARS[g.rarity];
  const band = g.slot === 'relic' ? `T${g.tier} 유물` : `T${g.tier} ${BAND_NAME_KO[bandOf(g.tier)]} · ${SLOT_NAME_KO[g.slot]}`;
  return stars ? `${band} ${stars}` : band;
}

/** The expedition text of each relic (4-4) with its numbers × the tier multiplier. */
export function relicGearText(relicId: string | undefined, tier: number): string {
  const k = relicTierMult(tier);
  const n = (x: number, unit = '%') => `${Math.round(x * k * 10) / 10}${unit}`;
  switch (relicId) {
    case 'echo_seal':
      return `이 캐릭터의 드래그 스킬이 1초 뒤 ${n(50)} 위력으로 한 번 더`;
    case 'relay_flag':
      return `이 캐릭터가 퇴장할 때 그 자리에 폭발 (반경 2, 공격력 ${n(200)})`;
    case 'vanguard_helm':
      return `이 캐릭터가 등장한 뒤 4초간 공격력 +${n(40)}`;
    case 'hunter_mark':
      return `이 캐릭터가 필드에서 처치할 때마다 대기 카드 재등장 쿨 ${n(0.5, '초')} 감소`;
    case 'phoenix_feather':
      return `이 캐릭터의 부활 시간 −${n(40)}, 부활 시 HP 100%`;
    case 'beast_collar':
      return `이 캐릭터가 필드에 있을 때 펫 쿨 −${n(30)}, 펫 효과 +${n(30)}`;
    case 'rage_breaker':
      return `이 캐릭터가 보스·중형보스에게 주는 피해 +${n(25)} (광폭화면 +${n(50)})`;
    case 'blood_chalice':
      return `이 캐릭터의 드래그 피해 ${n(20)}만큼 HP 회복`;
    default:
      return '유물 효과';
  }
}

/** Every line describing a piece: main stats, then the effect (or the relic text). */
export function gearLines(g: GearSpec): string[] {
  if (g.slot === 'relic') return [relicGearText(g.relicId, g.tier), `등급 배율 ×${relicTierMult(g.tier).toFixed(2)}`];
  const out = gearMainLines(g);
  const opt = gearOptionText(g);
  if (opt) out.push(`✦ ${opt}`);
  return out;
}

/** Where a piece came from: '6단계 보스 · 야근의 군주' / '4단계'. */
export function gearSource(fromStage: number): string {
  if (!isBossStage(fromStage)) return `${fromStage}단계`;
  return `${fromStage}단계 보스 · ${bossNameOfStage(fromStage)}`;
}

export function bossNameOfStage(stage: number): string {
  const id = EXPEDITION.mids[stage - 1]?.[2];
  return BOSS_NAME[id ?? ''] ?? '보스';
}

const BOSS_NAME: Record<string, string> = {
  elevator_keeper: '닫히지 않는 엘리베이터',
  overtime_lord: '야근의 군주',
  surgeon_director: '수술실 원장',
  abyss_watcher: '심연의 감시자',
};

/** The guardian (floor 3 of a normal stage) of a stage. */
export function guardianNameOfStage(stage: number): string {
  const id = EXPEDITION.mids[stage - 1]?.[2] ?? '';
  try {
    return getMonster(id).name;
  } catch {
    return '수문장';
  }
}

/** '4단계 · 사무실'. */
export function stageTitle(stage: number): string {
  return `${stage}단계 · ${ZONE_NAME_KO[stageZoneIndex(stage)]}`;
}

/** Loot line of a stage (3-3): '장비 2' / '장비 3 · 유물 확률'. */
export function stageLootText(stage: number): string {
  return isBossStage(stage) ? '장비 3 · 유물 확률' : '장비 2';
}

/** Stage-start banner sub line (8-4). */
export function stageBannerSub(stage: number): string {
  return isBossStage(stage) ? '보스 단계 · 장비 3개 + 유물 확률' : '3층을 깨면 장비 2개';
}

// ─────────────────────────── comparison / stats ───────────────────────────

export interface StatDelta {
  label: string;
  /** Positive = better. */
  diff: number;
  text: string;
}

/** Main-stat differences 'pick' vs 'worn' (same slot). */
export function compareGear(pick: GearSpec, worn: GearSpec | undefined): StatDelta[] {
  const a = gearMainMods(pick);
  const b = worn ? gearMainMods(worn) : {};
  const rows: [keyof typeof a, string, number, string][] = [
    ['atkPct', '공격력', 100, '%'],
    ['hpPct', '최대 HP', 100, '%'],
    ['defFlat', '받는 피해 감소', 100, '%'],
    ['atkSpeedPct', '공격 속도', 100, '%'],
    ['critChance', '치명타', 100, '%p'],
  ];
  const out: StatDelta[] = [];
  for (const [k, label, mul, unit] of rows) {
    const d = (((a[k] as number) ?? 0) - ((b[k] as number) ?? 0)) * mul;
    if (Math.abs(d) < 0.05) continue;
    const v = Math.round(d * 2) / 2;
    out.push({ label, diff: d, text: `${label} ${v > 0 ? '+' : '−'}${Math.abs(v)}${unit}` });
  }
  return out;
}

/** Better than what the character wears in that slot (tier → rarity)? Relics: any relic beats an empty slot. */
export function isUpgrade(pick: GearSpec, worn: GearSpec | undefined): boolean {
  if (!worn) return true;
  if (pick.slot === 'relic') return pick.tier > worn.tier;
  return gearRank(pick) > gearRank(worn);
}

/** Tier first, then rarity (the order isUpgrade uses for base slots). */
function gearRank(g: GearSpec): number {
  return g.tier * 10 + (g.rarity === 'epic' ? 2 : g.rarity === 'rare' ? 1 : 0);
}

/**
 * Who should wear each new item (null = nobody gains): the best items first, each to the party member whose slot is
 * weakest (an empty slot first, then party order); one item per character · slot.
 */
export function recommendWearers(items: readonly GearSpec[], party: readonly string[], loadouts: readonly (GearLoadout | null | undefined)[]): (string | null)[] {
  const out: (string | null)[] = items.map(() => null);
  const taken = new Set<string>();
  const order = items.map((_, i) => i).sort((a, b) => gearRank(items[b]) - gearRank(items[a]) || a - b);
  for (const i of order) {
    const g = items[i];
    let best = -1;
    let bestRank = Infinity;
    party.forEach((id, k) => {
      const worn = loadouts[k]?.[g.slot];
      if (taken.has(`${id}|${g.slot}`) || !isUpgrade(g, worn)) return;
      const r = worn ? gearRank(worn) : -1;
      if (r < bestRank) [best, bestRank] = [k, r];
    });
    if (best < 0) continue;
    taken.add(`${party[best]}|${g.slot}`);
    out[i] = party[best];
  }
  return out;
}

/** HP / attack of a character with a loadout (main stats only; the sim adds rewards and effects on top). */
export function charStats(charId: string, l: GearLoadout | null | undefined): { hp: number; atk: number } {
  const s = getCharacter(charId).stats;
  let hp = 0;
  let atk = 0;
  for (const slot of BASE_SLOTS) {
    const g = l?.[slot];
    if (!g) continue;
    const m = gearMainMods(g);
    hp += m.hpPct ?? 0;
    atk += m.atkPct ?? 0;
  }
  return { hp: Math.round(s.maxHp * (1 + hp)), atk: Math.round(s.atk * (1 + atk)) };
}

/** The lowest weapon / armor / charm tier of one character (0 = an empty slot). */
export function lowestTier(l: GearLoadout | null | undefined): number {
  return Math.min(...BASE_SLOTS.map(s => slotTier(l, s)));
}

/**
 * Hint for the next stage (8-2): '5단계: 가디언 장신구 T4 필요' — the first party member / slot below `stage − 1`.
 * Null when the party can already start at that stage (or it is past 12).
 */
export function nextStageHint(party: readonly string[], loadouts: readonly GearLoadout[], stage: number): { text: string; charId: string; slot: GearSlot } | null {
  if (stage > EXPEDITION_STAGES) return null;
  const need = stage - 1;
  for (let i = 0; i < party.length; i++)
    for (const slot of BASE_SLOTS)
      if (slotTier(loadouts[i], slot) < need) return { text: `${stage}단계: ${getCharacter(party[i]).name} ${SLOT_NAME_KO[slot]} T${need} 필요`, charId: party[i], slot };
  return null;
}
