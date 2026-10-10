// 기획 17차 CORE reward group (runs first): the five core set bonuses (#교대 #궁극기 #펫 #생존 #공격), the reward-screen
// cards (여분의 향, 금박 부적), reward guards and mines. The other set bonuses live with the tracks that own their tags
// (#등장 #퇴장 → swap.ts, #저스트 #상태이상 #보스 → combat.ts, #저주 #협동 #성장 → rules.ts).

import type { PlayerState } from '../../types';
import { MAX_REROLLS, TAG_BONUS, familyRarities, getFamily, getReward } from '../../data';
import { refreshMaxHp } from '../players';
import { activeEntity, type SimEntity, type SimPlayer, type World } from '../world';
import { guardOf, proc, tickMines } from './fx';
import { invalidateRewards, tagActive } from './query';
import type { RewardHooks } from './types';

/** #생존 set: heal / shield p's characters receive × this. */
export function receivedMultOf(ps: PlayerState | null | undefined): number {
  return ps && (ps.rewards.length > 0 || ps.relics.length > 0) && tagActive(ps, 'survive') ? 1 + TAG_BONUS.survive.received : 1;
}

/** Heal / shield multiplier for target (an ally character of a player with the #생존 set), else 1. */
export function receivedMult(w: World, target: SimEntity): number {
  if (target.kind !== 'character' || target.ownerPlayer == null) return 1;
  return receivedMultOf(w.state.players[target.ownerPlayer]);
}

/** 금박 부적: p's latest common reward of a family that has a rare tier → its rare tier (in place). */
function gild(w: World, p: SimPlayer): void {
  for (let i = p.rewards.length - 1; i >= 0; i--) {
    const r = p.rewards[i];
    const def = getReward(r.rewardId);
    if (def.rarity !== 'common' || def.target === 'self') continue;
    if (!familyRarities(getFamily(def.family)).includes('rare')) continue;
    p.rewards[i] = { rewardId: `${def.family}_rare`, partyIndex: r.partyIndex };
    invalidateRewards(p);
    refreshMaxHp(w, p);
    proc(w, p, r.partyIndex, 'gilded', activeEntity(w, p)?.pos ?? { x: 0, y: 0 });
    return;
  }
}

export const BASE_HOOKS: RewardHooks = {
  cooldownOnLeave(_w, p, _idx, cd) {
    if (tagActive(p, 'swap')) cd.flat += TAG_BONUS.swap.cd;
  },
  chargeMult(ps) {
    return tagActive(ps, 'ult') ? 1 + TAG_BONUS.ult.charge : 1;
  },
  petCdMult(p) {
    return tagActive(p, 'pet') ? 1 - TAG_BONUS.pet.cd : 1;
  },
  onPet(_w, p, _i, _at, mods) {
    if (tagActive(p, 'pet')) mods.power *= 1 + TAG_BONUS.pet.power;
  },
  statMods(_w, _e, p, into) {
    if (tagActive(p, 'attack')) into.critMult += TAG_BONUS.attack.critMult;
  },
  takenMult(w, target, _p, acc) {
    acc.guard += guardOf(w, target);
  },
  tick(w, p) {
    tickMines(w, p);
  },
  onGrant(w, p, _applied, def) {
    if (def.family === 'incense') p.rerolls = Math.min(MAX_REROLLS, p.rerolls + (def.params.rerolls ?? 0));
    else if (def.family === 'gilded') gild(w, p);
  },
};
