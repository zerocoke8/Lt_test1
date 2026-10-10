// 기획 17차: how a bot (and a human who ran out of time) picks a floor reward — PURE over PlayerState + the offers, so
// the server's timeout, the client's timer text (「안 고르면 '…'을 골라요」), bots and the 원정 won-stage result agree.
// score = rarity (일반 1 · 희귀 1.6 · 영웅 2.4 · 전설 2.6) × the family's bot weight × 1.3 when one of its tags is held
// exactly twice; ties go to a seeded hash of the player and the card. The member is the card's default (지명권).

import type { PlayerState, Rarity, RewardOffer } from '../../types';
import { getReward } from '../../data';
import { mixSeed } from '../rng';
import { tagCounts } from './query';

/**
 * 기획 17차 리뷰: 전설 2.6 (was 3.2) — a legendary still beats any rare and a plain epic, but not an epic basic
 * (2.4 × 1.2 = 2.88), which measured 2–5× a legendary (balance.md 17장).
 */
export const RARITY_SCORE: Record<Rarity, number> = { common: 1, rare: 1.6, epic: 2.4, legendary: 2.6 };
/** Score × this when one of the card's tags is held exactly twice (the pick would complete a set). */
export const TAG_LEAN_SCORE = 1.3;

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A card's bot score for ps (relics: rarity only; economy cards 0). */
export function offerScore(ps: PlayerState, o: RewardOffer): number {
  let score = RARITY_SCORE[o.rarity];
  if (o.isRelic) return score;
  const def = getReward(o.rewardId);
  score *= def.botWeight;
  const tags = o.tags ?? def.tags;
  const c = tagCounts(ps);
  if (tags.some(t => c[t] === 2)) score *= TAG_LEAN_SCORE;
  return score;
}

/** Index of the card a bot picks (−1 = no cards). */
export function botPickIndex(ps: PlayerState, offers: readonly RewardOffer[] | null | undefined): number {
  if (!offers || offers.length === 0) return -1;
  let best = -1;
  let bestScore = -Infinity;
  let bestTie = -1;
  offers.forEach((o, i) => {
    const sc = offerScore(ps, o);
    const tie = mixSeed(ps.id + 1, ps.rewards.length, strHash(o.rewardId), i);
    if (sc > bestScore + 1e-9 || (Math.abs(sc - bestScore) <= 1e-9 && tie > bestTie)) {
      best = i;
      bestScore = sc;
      bestTie = tie;
    }
  });
  return best;
}

/** The member the pick goes to (the card's default; null for party cards). */
export function botPickMember(o: RewardOffer): number | null {
  return o.member ?? o.partyIndex ?? null;
}
