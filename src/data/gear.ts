// 기획 15차 원정 모드 — gear (docs/expedition.md 4장). Four slots per character (무기 · 방어구 · 장신구 · 유물), tier 1..12 =
// the stage it came from. Main stats are fixed by tier (no rolls); only the slot, the rarity and the special effect
// are random. Everything a piece of gear does applies to the ONE character wearing it (armor HP also on the bench).
// Pure data + pure helpers (sim, ui, server and the benches all use them). Expedition-only: the classic tower never
// reads this file except through the single-line branches listed in docs/prototype-architecture.md.

import type { Rarity, StatMods } from '../types';
import { RELICS } from './relics';
import { EXPEDITION_STAGES } from './stages';

export { EXPEDITION, STAGE_FOE, isBossStage, equivFloor, maxStageLoot, stageTheme, clampStage } from './stages';

export type GearSlot = 'weapon' | 'armor' | 'charm' | 'relic';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'charm', 'relic'];
/** The three slots every stage drops (and the start-stage rule counts). Relics only come from boss stages. */
export const BASE_SLOTS = ['weapon', 'armor', 'charm'] as const;
export type BaseSlot = (typeof BASE_SLOTS)[number];

/** 기획 17차: gear keeps 3 rarities (전설 is a floor-reward rarity only). */
export type GearRarity = Exclude<Rarity, 'legendary'>;
export const GEAR_RARITIES: readonly GearRarity[] = ['common', 'rare', 'epic'];

/** What the sim sees of one piece (PlayerSetup.gear / PlayerState.gear). */
export interface GearSpec {
  slot: GearSlot;
  /** 1..12; a relic's tier is its boss stage (3 · 6 · 9 · 12). */
  tier: number;
  rarity: GearRarity;
  /** Special effect (rare / epic base gear; GEAR_OPTIONS id of the same slot). */
  optionId?: string;
  /** Relic slot: RELICS id. */
  relicId?: string;
}

/** A stash item (client side only): a spec + identity + where it came from. */
export interface GearItem extends GearSpec {
  uid: string;
  fromStage: number;
}

/** One character's equipped gear by slot (empty slots absent). */
export type GearLoadout = Partial<Record<GearSlot, GearSpec>>;

/** Visual band: 0 = none, 1 = T1–3 낡은, 2 = T4–6 강화, 3 = T7–9 퇴마, 4 = T10–12 심연. */
export type GearBand = 0 | 1 | 2 | 3 | 4;

export function bandOf(tier: number | null | undefined): GearBand {
  if (tier == null || !(tier >= 1)) return 0;
  return Math.min(4, Math.ceil(Math.min(EXPEDITION_STAGES, Math.floor(tier)) / 3)) as GearBand;
}

export const BAND_COLOR: readonly string[] = ['', '#adb5bd', '#4cc9f0', '#c77dff', '#ffd166'];
export const BAND_NAME_KO: readonly string[] = ['', '낡은', '강화', '퇴마', '심연'];
export const SLOT_NAME_KO: Record<GearSlot, string> = { weapon: '무기', armor: '방어구', charm: '장신구', relic: '유물' };
/** 희귀도는 별로 표시 (테두리 색은 등급 묶음 전용). */
export const RARITY_STARS: Record<GearRarity, string> = { common: '', rare: '★', epic: '★★' };

/** Weapon look = the wearer's hand prop (9 families; spec 9-2). Mirrors render/look.ts ACCESSORY_BY_ID. */
export type WeaponFamily = 'shield' | 'sword' | 'axe' | 'bow' | 'orb' | 'staff' | 'hammer' | 'gun' | 'lute';
export const WEAPON_FAMILIES: readonly WeaponFamily[] = ['shield', 'sword', 'axe', 'bow', 'orb', 'staff', 'hammer', 'gun', 'lute'];
export const WEAPON_FAMILY_BY_CHAR: Record<string, WeaponFamily> = {
  guardian: 'shield',
  warden: 'shield',
  blade: 'sword',
  shadow: 'sword',
  berserker: 'axe',
  ranger: 'bow',
  mage: 'orb',
  chrono: 'orb',
  puppeteer: 'orb',
  cleric: 'staff',
  medic: 'staff',
  exorcist: 'staff',
  paladin: 'hammer',
  gunner: 'gun',
  bard: 'lute',
};

// ─────────────────────────── Main stats (4-2) ───────────────────────────

/** Epic gear: main stats × this (and one special effect). */
export const EPIC_MAIN_MULT = 1.2;

/**
 * Main stats of one piece: weapon atk +(2 + 3T)%, armor max HP +(2 + 4T)% and damage taken −0.5T%, charm attack speed
 * +1.5T% and crit +0.75T%p; epic ×1.2; relics have none (effect only).
 */
export function gearMainMods(g: GearSpec): StatMods {
  const t = g.tier;
  const k = g.rarity === 'epic' ? EPIC_MAIN_MULT : 1;
  switch (g.slot) {
    case 'weapon':
      return { atkPct: ((2 + 3 * t) / 100) * k };
    case 'armor':
      return { hpPct: ((2 + 4 * t) / 100) * k, defFlat: 0.005 * t * k };
    case 'charm':
      return { atkSpeedPct: 0.015 * t * k, critChance: 0.0075 * t * k };
    case 'relic':
      return {};
  }
}

/** '공격력 +17%' style lines of a piece's main stats (0.5 steps, spec 4-2). */
export function gearMainLines(g: GearSpec): string[] {
  const m = gearMainMods(g);
  const p = (x: number) => `${Math.round(x * 200) / 2}`;
  const out: string[] = [];
  if (m.atkPct) out.push(`공격력 +${p(m.atkPct)}%`);
  if (m.hpPct) out.push(`최대 HP +${p(m.hpPct)}%`);
  if (m.defFlat) out.push(`받는 피해 −${p(m.defFlat)}%`);
  if (m.atkSpeedPct) out.push(`공격 속도 +${p(m.atkSpeedPct)}%`);
  if (m.critChance) out.push(`치명타 +${p(m.critChance)}%p`);
  return out;
}

// ─────────────────────────── Special effects (4-3) ───────────────────────────

export type OptionLevel = 1 | 2 | 3;

/** Effect level by tier: T4–6 Lv1, T7–9 Lv2, T10–12 Lv3 (T1–3 never roll one). */
export function optionLevel(tier: number): OptionLevel {
  return tier <= 6 ? 1 : tier <= 9 ? 2 : 3;
}

type Lv3 = readonly [number, number, number];

export interface GearOptionDef {
  id: string;
  slot: BaseSlot;
  name: string;
  /** The main number by level (Lv1 / Lv2 / Lv3). */
  values: Lv3;
  /** Other numbers (by level, or one fixed value). */
  params: Record<string, Lv3 | number>;
  description(lv: OptionLevel): string;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}`;

export const GEAR_OPTIONS: readonly GearOptionDef[] = [
  {
    id: 'w_appear_bolt',
    slot: 'weapon',
    name: '등장 에너지탄',
    values: [0.6, 0.75, 0.9],
    params: { targets: [2, 3, 4] },
    description: lv => `등장할 때 가까운 적 ${optionParam('w_appear_bolt', 'targets', lv)}명에게 공격력 ${pct(optionValue('w_appear_bolt', lv))}%`,
  },
  {
    id: 'w_relay_blast',
    slot: 'weapon',
    name: '교대 폭발',
    values: [0.6, 1, 1.5],
    params: { radius: [1.5, 2, 2], relicPower: 0.5, relicRadius: 0.5 },
    description: lv =>
      `퇴장한 자리에 공격력 ${pct(optionValue('w_relay_blast', lv))}% 폭발 (반경 ${optionParam('w_relay_blast', 'radius', lv)}) · 「교대의 깃발」과 합쳐지면 위력 +50%·반경 +0.5`,
  },
  {
    id: 'w_scorch',
    slot: 'weapon',
    name: '그을린 발자국',
    values: [0.2, 0.25, 0.35],
    params: { radius: 2, duration: 4, burnDuration: 2, burnDps: 0.1 },
    description: lv => `착지한 자리에 반경 2 불길 4초, 초당 공격력 ${pct(optionValue('w_scorch', lv))}% + 화상`,
  },
  {
    id: 'w_execute',
    slot: 'weapon',
    name: '처형 착지',
    values: [0.12, 0.16, 0.2],
    params: { radius: 2 },
    description: lv => `착지 반경 2 안의 HP ${pct(optionValue('w_execute', lv))}% 이하 일반 적 즉시 처치 (중형보스·보스 제외)`,
  },
  {
    id: 'a_appear_shield',
    slot: 'armor',
    name: '등장 보호막',
    values: [0.1, 0.15, 0.2],
    params: { duration: 4 },
    description: lv => `등장할 때 최대 HP ${pct(optionValue('a_appear_shield', lv))}% 보호막 4초`,
  },
  {
    id: 'a_heal_echo',
    slot: 'armor',
    name: '치유의 잔향',
    values: [0.02, 0.03, 0.04],
    params: { radius: 2.5, duration: 5 },
    description: lv => `퇴장한 자리에 반경 2.5 회복 장판 5초, 초당 최대 HP ${pct(optionValue('a_heal_echo', lv))}%`,
  },
  {
    id: 'a_evac',
    slot: 'armor',
    name: '응급 후송',
    values: [0.05, 0.065, 0.08],
    params: { hpBelow: 0.35, duration: 4, cooldown: 20 },
    description: lv => `HP 35% 이하에서 퇴장하면 대기에서 4초 동안 초당 최대 HP ${pct(optionValue('a_evac', lv))}% 회복 (20초에 1번)`,
  },
  {
    id: 'a_drop_shield',
    slot: 'armor',
    name: '버려진 방패',
    values: [0.12, 0.16, 0.2],
    params: { radius: 2.5, duration: 5 },
    description: lv => `퇴장한 자리에 반경 2.5, 5초 동안 안의 아군이 받는 피해 −${pct(optionValue('a_drop_shield', lv))}%`,
  },
  {
    id: 'c_quick_swap',
    slot: 'charm',
    name: '빠른 교대',
    values: [0.5, 1, 1.5],
    params: {},
    description: lv => `재등장 쿨 −${optionValue('c_quick_swap', lv)}초 (최소 4초)`,
  },
  {
    id: 'c_ult_charge',
    slot: 'charm',
    name: '교대 충전',
    values: [0.04, 0.06, 0.08],
    params: {},
    description: lv => `등장할 때 이 캐릭터 궁극기 게이지 +${pct(optionValue('c_ult_charge', lv))}%`,
  },
  {
    id: 'c_normal_haste',
    slot: 'charm',
    name: '일반스킬 가속',
    values: [0.1, 0.15, 0.2],
    params: {},
    description: lv => `일반 스킬 쿨 −${pct(optionValue('c_normal_haste', lv))}%`,
  },
  {
    id: 'c_rested_rage',
    slot: 'charm',
    name: '오래 쉰 자의 분노',
    values: [0.03, 0.04, 0.05],
    params: { maxStacks: 10 },
    description: lv => `준비된 뒤 기다린 1초마다 1중첩(최대 10), 등장할 때 중첩당 드래그 피해 +${pct(optionValue('c_rested_rage', lv))}%`,
  },
];

const OPTION_BY_ID = new Map(GEAR_OPTIONS.map(o => [o.id, o]));

export function getGearOption(id: string): GearOptionDef {
  const o = OPTION_BY_ID.get(id);
  if (!o) throw new Error(`unknown gear option: ${id}`);
  return o;
}

export function isGearOptionId(id: unknown): id is string {
  return typeof id === 'string' && OPTION_BY_ID.has(id);
}

export function optionValue(id: string, lv: OptionLevel): number {
  return getGearOption(id).values[lv - 1];
}

export function optionParam(id: string, key: string, lv: OptionLevel = 1): number {
  const v = getGearOption(id).params[key];
  if (v == null) return 0;
  return typeof v === 'number' ? v : v[lv - 1];
}

/** The option text of a piece (null = none). */
export function gearOptionText(g: GearSpec): string | null {
  if (!g.optionId || !isGearOptionId(g.optionId)) return null;
  const o = getGearOption(g.optionId);
  return `${o.name}: ${o.description(optionLevel(g.tier))}`;
}

// ─────────────────────────── Relics (4-4) ───────────────────────────

/** Relic tier → multiplier on its numeric effect (echo 50 → 58 / 65 / 73 %). */
export const RELIC_TIER_MULT: Record<number, number> = { 3: 1, 6: 1.15, 9: 1.3, 12: 1.45 };
export const RELIC_TIERS: readonly number[] = [3, 6, 9, 12];
/** Boss box: chance of a relic (else one more base item) when it is not the first clear of that boss stage. */
export const BOSS_RELIC_CHANCE: Record<number, number> = { 3: 0.5, 6: 0.6, 9: 0.7, 12: 0.8 };
/** Relic pick weights by relic rarity (classic relic weights). */
export const RELIC_RARITY_WEIGHTS: Record<GearRarity, number> = { common: 70, rare: 25, epic: 5 };

export function relicTierMult(tier: number): number {
  return RELIC_TIER_MULT[tier] ?? 1;
}

/** 1..8 = RELICS index + 1 (render: which icon orbits the head), 0 = none. */
export function relicIndex(relicId: string | undefined): number {
  if (!relicId) return 0;
  return RELICS.findIndex(r => r.id === relicId) + 1;
}

// ─────────────────────────── Drops (4-3, 4-5) ───────────────────────────

/** Rarity percent by band (index 1..4): common / rare / epic. */
export const RARITY_BY_BAND: readonly Record<GearRarity, number>[] = [
  { common: 100, rare: 0, epic: 0 },
  { common: 100, rare: 0, epic: 0 },
  { common: 65, rare: 30, epic: 5 },
  { common: 45, rare: 45, epic: 10 },
  { common: 25, rare: 60, epic: 15 },
];
/** Boss stage loot: this much moves from common to rare (T4+). */
export const BOSS_RARE_SHIFT = 0.15;
/** Per stage already cleared this run: this much more rare (max STREAK_RARE_MAX, T4+). */
export const STREAK_RARE_BONUS = 0.1;
export const STREAK_RARE_MAX = 0.3;
/** Rarity and effects start at this tier. */
export const OPTION_MIN_TIER = 4;

/** The rarity weights (percent) of a drop at `tier` (boss stage / stages already cleared this run shift common → rare). */
export function rarityWeights(tier: number, bossStage: boolean, clearedThisRun: number): Record<GearRarity, number> {
  const base = RARITY_BY_BAND[bandOf(tier)] ?? RARITY_BY_BAND[1];
  if (tier < OPTION_MIN_TIER) return { common: 100, rare: 0, epic: 0 };
  const shift = 100 * ((bossStage ? BOSS_RARE_SHIFT : 0) + Math.min(STREAK_RARE_MAX, STREAK_RARE_BONUS * Math.max(0, clearedThisRun)));
  const moved = Math.min(base.common, shift);
  return { common: base.common - moved, rare: base.rare + moved, epic: base.epic };
}

/** Tier of a character's slot (0 = empty). */
export function slotTier(l: GearLoadout | null | undefined, slot: GearSlot): number {
  return l?.[slot]?.tier ?? 0;
}

/**
 * Slot pick weight (4-5): 1 + 3 × (party members whose slot is below this tier) — loot leans toward what the party lacks.
 */
export function slotWeights(party: readonly (GearLoadout | null | undefined)[], tier: number): Record<BaseSlot, number> {
  const w = { weapon: 1, armor: 1, charm: 1 };
  for (const s of BASE_SLOTS) for (const l of party) if (slotTier(l, s) < tier) w[s] += 3;
  return w;
}

// ─────────────────────────── Start-stage rule (6장) ───────────────────────────

/**
 * Highest stage the party may start at: 1 + the lowest tier over the 3 characters' weapon / armor / charm (empty = 0),
 * max 12. The relic slot does not count.
 */
export function maxStartStage(party: readonly (GearLoadout | null | undefined)[]): number {
  if (party.length === 0) return 1;
  let low = Infinity;
  for (const l of party) for (const s of BASE_SLOTS) low = Math.min(low, slotTier(l, s));
  return Math.max(1, Math.min(EXPEDITION_STAGES, 1 + (Number.isFinite(low) ? low : 0)));
}

/** Bots (7장): T(stage − 1) common weapon · armor · charm, nothing on stage 1. */
export function botLoadout(stage: number): GearLoadout {
  const t = Math.min(EXPEDITION_STAGES, Math.floor(stage) - 1);
  if (!(t >= 1)) return {};
  return { weapon: { slot: 'weapon', tier: t, rarity: 'common' }, armor: { slot: 'armor', tier: t, rarity: 'common' }, charm: { slot: 'charm', tier: t, rarity: 'common' } };
}

// ─────────────────────────── Render bands ───────────────────────────

/** What the renderer needs of a character's gear (w/a/c bands, relic icon 1..8, relic band). */
export interface GearBands {
  w: GearBand;
  a: GearBand;
  c: GearBand;
  r: number;
  rb: GearBand;
}

/** Null when the character wears nothing (draw exactly as the classic tower). */
export function gearBandsOf(l: GearLoadout | null | undefined): GearBands | null {
  if (!l) return null;
  const b: GearBands = {
    w: bandOf(l.weapon?.tier),
    a: bandOf(l.armor?.tier),
    c: bandOf(l.charm?.tier),
    r: relicIndex(l.relic?.relicId),
    rb: l.relic ? bandOf(l.relic.tier) : 0,
  };
  return b.w || b.a || b.c || b.r ? b : null;
}

// ─────────────────────────── Validation (server, store) ───────────────────────────

const RELIC_IDS = new Set(RELICS.map(r => r.id));

/** Why a spec is not a legal piece of gear (null = fine). Checks slot, tier, rarity, option / relic ids. */
export function gearSpecProblem(g: unknown, slot?: GearSlot): string | null {
  if (!g || typeof g !== 'object') return '형식';
  const x = g as Partial<GearSpec>;
  if (!GEAR_SLOTS.includes(x.slot as GearSlot)) return '칸';
  if (slot && x.slot !== slot) return '칸 불일치';
  if (!Number.isInteger(x.tier) || x.tier! < 1 || x.tier! > EXPEDITION_STAGES) return '등급';
  if (!GEAR_RARITIES.includes(x.rarity as GearRarity)) return '희귀도';
  if (x.slot === 'relic') {
    if (!RELIC_TIERS.includes(x.tier!)) return '유물 등급';
    if (typeof x.relicId !== 'string' || !RELIC_IDS.has(x.relicId)) return '유물 종류';
    if (x.optionId != null) return '유물 효과';
    // a relic's stars are that relic's own rarity
    if (RELICS.find(r => r.id === x.relicId)!.rarity !== x.rarity) return '유물 희귀도';
    return null;
  }
  if (x.relicId != null) return '유물 종류';
  // only what can drop: commons below OPTION_MIN_TIER; a rare / epic piece always has one option, a common none
  if (x.tier! < OPTION_MIN_TIER && x.rarity !== 'common') return '희귀도 등급';
  if ((x.optionId != null) !== (x.rarity !== 'common')) return '효과';
  if (x.optionId != null) {
    if (!isGearOptionId(x.optionId)) return '효과';
    if (getGearOption(x.optionId).slot !== x.slot) return '효과 칸';
  }
  return null;
}

/** A clean copy of one loadout (only the known fields), or null when any piece is illegal. */
export function cleanLoadout(l: unknown): GearLoadout | null {
  if (l == null) return {};
  if (typeof l !== 'object' || Array.isArray(l)) return null;
  const out: GearLoadout = {};
  for (const [k, v] of Object.entries(l as Record<string, unknown>)) {
    if (v == null) continue;
    if (!GEAR_SLOTS.includes(k as GearSlot) || gearSpecProblem(v, k as GearSlot)) return null;
    out[k as GearSlot] = cleanSpec(v as GearSpec);
  }
  return out;
}

export function cleanSpec(g: GearSpec): GearSpec {
  return {
    slot: g.slot,
    tier: g.tier,
    rarity: g.rarity,
    ...(g.optionId != null ? { optionId: g.optionId } : null),
    ...(g.relicId != null ? { relicId: g.relicId } : null),
  };
}

/** A party's loadouts (exactly `size` entries), cleaned, or null when malformed. */
export function cleanPartyGear(x: unknown, size = 3): GearLoadout[] | null {
  if (!Array.isArray(x) || x.length !== size) return null;
  const out: GearLoadout[] = [];
  for (const l of x) {
    const c = cleanLoadout(l);
    if (!c) return null;
    out.push(c);
  }
  return out;
}
