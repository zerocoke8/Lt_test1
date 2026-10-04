// Cooldown formulas (rewards, relics, tunables).

import { getCharacter, getPet } from '../data';
import { MAX_COOLDOWN_REDUCTION, MIN_SWAP_COOLDOWN } from './constants';
import { hasRelic, petCooldownReduction, relicParam, skillMod, swapCooldownReduction } from './modifiers';
import type { SimPlayer, World } from './world';

/** max(4, def.swapCooldown − swapCooldown rewards) × swapCooldownMult. */
export function swapCooldownFor(w: World, p: SimPlayer, idx: number): number {
  if (w.tunables.instantCooldowns) return 0;
  const def = getCharacter(p.party[idx].defId);
  return Math.max(MIN_SWAP_COOLDOWN, def.swapCooldown - swapCooldownReduction(p, idx)) * Math.max(0, w.tunables.swapCooldownMult);
}

/** def.cooldown × petCooldownMult × (1 − Σ petCooldown rewards) × (beast_collar ? 0.7 : 1). */
export function petCooldownFor(w: World, p: SimPlayer, petIndex: number): number {
  if (w.tunables.instantCooldowns) return 0;
  const def = getPet(p.pets[petIndex].defId);
  const red = Math.max(0, 1 - petCooldownReduction(p));
  const collar = hasRelic(p, 'beast_collar') ? 1 - relicParam('beast_collar', 'cdPct') : 1;
  return def.cooldown * Math.max(0, w.tunables.petCooldownMult) * red * collar;
}

export function normalCooldownFor(w: World, p: SimPlayer, idx: number): number {
  if (w.tunables.instantCooldowns) return 0;
  const def = getCharacter(p.party[idx].defId);
  const red = Math.min(MAX_COOLDOWN_REDUCTION, skillMod(p, idx, 'normal', 'cooldown'));
  return (def.normal.cooldown ?? 6) * (1 - red);
}
