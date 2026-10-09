// 기획 15차 원정 모드: what equipped gear does to ONE character's numbers (docs/expedition.md 4장) — main stats, the
// per-character relic and the special-effect lookups. Pure reads over PlayerState.gear (set once from PlayerSetup.gear,
// never changed during a game). A player without gear (every classic run) never gets past the first `if`.

import type { PlayerState, StatMods } from '../types';
import { BASE_SLOTS, gearMainMods, optionLevel, relicTierMult, type GearLoadout, type OptionLevel } from '../data/gear';
import { addMods } from './modifiers';

/** The loadout of party member idx (undefined = nothing / classic). */
export function gearOf(p: Pick<PlayerState, 'gear'>, idx: number | null | undefined): GearLoadout | undefined {
  if (!p.gear || idx == null) return undefined;
  return p.gear[idx];
}

const modsCache = new WeakMap<GearLoadout, Required<StatMods>>();

/** Sum of a character's main stats (weapon · armor · charm; relics have none). Null when it wears nothing. */
export function gearStatMods(p: Pick<PlayerState, 'gear'>, idx: number | null | undefined): Required<StatMods> | null {
  const l = gearOf(p, idx);
  if (!l) return null;
  let m = modsCache.get(l);
  if (!m) {
    m = { hpPct: 0, atkPct: 0, defFlat: 0, atkSpeedPct: 0, moveSpeedPct: 0, critChance: 0, critMult: 0 };
    for (const s of BASE_SLOTS) {
      const g = l[s];
      if (g) addMods(m, gearMainMods(g));
    }
    modsCache.set(l, m);
  }
  return m;
}

/** The relic equipped on that character: id and its tier multiplier (null = none). */
export function charRelic(p: Pick<PlayerState, 'gear'>, idx: number | null | undefined): { id: string; mult: number } | null {
  const r = gearOf(p, idx)?.relic;
  return r?.relicId ? { id: r.relicId, mult: relicTierMult(r.tier) } : null;
}

/** Multiplier of relic `id` on that character (0 = not equipped there). */
export function charRelicMult(p: Pick<PlayerState, 'gear'>, idx: number | null | undefined, id: string): number {
  const r = charRelic(p, idx);
  return r && r.id === id ? r.mult : 0;
}

export function charHasRelic(p: Pick<PlayerState, 'gear'>, idx: number | null | undefined, id: string): boolean {
  return charRelicMult(p, idx, id) > 0;
}

/** Level (1..3) of special effect `optionId` on that character's weapon / armor / charm, 0 = none. */
export function charOptionLevel(p: Pick<PlayerState, 'gear'>, idx: number | null | undefined, optionId: string): OptionLevel | 0 {
  const l = gearOf(p, idx);
  if (!l) return 0;
  for (const s of BASE_SLOTS) {
    const g = l[s];
    if (g && g.optionId === optionId && g.rarity !== 'common') return optionLevel(g.tier);
  }
  return 0;
}
