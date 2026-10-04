// Floor rewards (R20): 3 distinct offers, rarity weights, relics on boss floors, bots pick at random.

import type { Rarity, RewardDef, RewardOffer } from '../types';
import { getCharacter, getReward, RARITY_WEIGHTS, RELICS, REWARDS } from '../data';
import { benchMaxHp, effStats } from './stats';
import { getEntity, type SimPlayer, type World } from './world';

const RARITIES: Rarity[] = ['common', 'rare', 'epic'];
const OFFER_COUNT = 3;

/** 'atk_common' → 'atk'. Offers are distinct by family. */
export function rewardFamily(id: string): string {
  return id.replace(/_(common|rare|epic)$/, '');
}

export function rollOffers(w: World, p: SimPlayer, bossFloor: boolean): RewardOffer[] {
  const offers: RewardOffer[] = [];
  if (bossFloor) {
    const pool = RELICS.filter(r => !p.relics.includes(r.id));
    while (offers.length < OFFER_COUNT && pool.length > 0) {
      const r = w.rng.weighted(pool, x => RARITY_WEIGHTS[x.rarity]);
      pool.splice(pool.indexOf(r), 1);
      offers.push({ rewardId: r.id, partyIndex: null, name: r.name, description: r.description, rarity: r.rarity, isRelic: true });
    }
  }
  const used = new Set<string>();
  while (offers.length < OFFER_COUNT) {
    const rarity = w.rng.weighted(RARITIES, r => RARITY_WEIGHTS[r]);
    let cands: RewardDef[] = REWARDS.filter(r => r.rarity === rarity && !used.has(rewardFamily(r.id)));
    if (cands.length === 0) cands = REWARDS.filter(r => !used.has(rewardFamily(r.id)));
    if (cands.length === 0) break;
    const r = w.rng.pick(cands);
    used.add(rewardFamily(r.id));
    let partyIndex: number | null = null;
    let name = r.name;
    let description = r.description;
    if (r.scope === 'character') {
      partyIndex = w.rng.int(0, p.party.length - 1);
      const cname = getCharacter(p.party[partyIndex].defId).name;
      name = name.split('{char}').join(cname);
      description = description.split('{char}').join(cname);
    }
    offers.push({ rewardId: r.id, partyIndex, name, description, rarity: r.rarity, isRelic: false });
  }
  return offers;
}

export function applyOffer(w: World, p: SimPlayer, offer: RewardOffer): void {
  if (offer.isRelic) {
    if (!p.relics.includes(offer.rewardId)) p.relics.push(offer.rewardId);
    return;
  }
  const def = getReward(offer.rewardId);
  p.rewards.push({ rewardId: def.id, partyIndex: offer.partyIndex });
  if (def.effect.kind === 'stat' && def.effect.mods.hpPct) {
    // Max HP bonus also raises current HP of living members by the same amount.
    p.party.forEach((m, idx) => {
      const gain = getCharacter(m.defId).stats.maxHp * (def.effect.kind === 'stat' ? def.effect.mods.hpPct ?? 0 : 0);
      const e = getEntity(w, m.entityId);
      if (e) {
        e.maxHp = effStats(w, e).maxHp;
        e.hp = Math.min(e.maxHp, e.hp + gain);
        m.hp = e.hp;
        m.maxHp = e.maxHp;
      } else {
        m.maxHp = benchMaxHp(p, idx);
        if (!m.dead) m.hp = Math.min(m.maxHp, m.hp + gain);
      }
    });
  }
}
