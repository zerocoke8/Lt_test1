// 기획 17차: read-only queries over a player's floor rewards — family counts / levels / params, member and role rewards,
// synergy tag counts. PURE over PlayerState (the multiplayer client, the HUD and the reward screen import them too).
// Results are cached per rewards array and invalidated when it changes length (invalidateRewards after an in-place edit).

import type { AppliedReward, PlayerState, Rarity, RewardDef, Role, SynergyTag } from '../../types';
import { RARITIES, RELIC_TAGS, ROLE_TAGS, SYNERGY_TAGS, TAG_SET_SIZE, getCharacter, getReward } from '../../data';

interface RewardIndex {
  ref: AppliedReward[];
  len: number;
  relics: number;
  byFamily: Map<string, AppliedReward[]>;
  tags: Record<SynergyTag, number>;
}

const cache = new WeakMap<PlayerState, RewardIndex>();

function emptyTags(): Record<SynergyTag, number> {
  return Object.fromEntries(SYNERGY_TAGS.map(t => [t.id, 0])) as Record<SynergyTag, number>;
}

/** The role a member-bound reward works for (role family: the member's role). */
export function memberRole(ps: PlayerState, idx: number | null | undefined): Role | null {
  const m = idx != null ? ps.party[idx] : undefined;
  return m ? getCharacter(m.defId).role : null;
}

/** Tags one applied reward counts for (the role family: its role's tags). */
export function tagsOf(ps: PlayerState, a: AppliedReward): readonly SynergyTag[] {
  const def = getReward(a.rewardId);
  if (def.family !== 'role') return def.tags;
  const role = memberRole(ps, a.partyIndex);
  return role ? ROLE_TAGS[role] : [];
}

function build(ps: PlayerState): RewardIndex {
  const byFamily = new Map<string, AppliedReward[]>();
  const tags = emptyTags();
  for (const a of ps.rewards) {
    const fam = getReward(a.rewardId).family;
    let list = byFamily.get(fam);
    if (!list) byFamily.set(fam, (list = []));
    list.push(a);
    for (const t of tagsOf(ps, a)) tags[t]++;
  }
  for (const r of ps.relics) {
    const t = RELIC_TAGS[r];
    if (t) tags[t]++;
  }
  return { ref: ps.rewards, len: ps.rewards.length, relics: ps.relics.length, byFamily, tags };
}

function index(ps: PlayerState): RewardIndex {
  const c = cache.get(ps);
  if (c && c.ref === ps.rewards && c.len === ps.rewards.length && c.relics === ps.relics.length) return c;
  const n = build(ps);
  cache.set(ps, n);
  return n;
}

/** Call after changing p.rewards in place without changing its length (금박 부적). */
export function invalidateRewards(ps: PlayerState): void {
  cache.delete(ps);
}

/** Applied rewards of one family (oldest first). */
export function familyRewards(ps: PlayerState, family: string): readonly AppliedReward[] {
  return index(ps).byFamily.get(family) ?? [];
}

/** How many times the family was taken (0 = not owned). */
export function rewardCount(ps: PlayerState, family: string): number {
  return familyRewards(ps, family).length;
}

const RANK: Record<Rarity, number> = { common: 1, rare: 2, epic: 3, legendary: 4 };

/** Highest rarity owned of the family: 1 일반 · 2 희귀 · 3 영웅 · 4 전설, 0 = not owned. */
export function rewardLevel(ps: PlayerState, family: string): number {
  let best = 0;
  for (const a of familyRewards(ps, family)) best = Math.max(best, RANK[getReward(a.rewardId).rarity]);
  return best;
}

/** The rarity of a level (rewardLevel) — 'common' for 0. */
export function levelRarity(level: number): Rarity {
  return RARITIES[Math.max(0, Math.min(3, level - 1))];
}

/**
 * One number of the family over everything owned: 'sum' (default; 「두 번」 adds power / %) or 'max' (radius, duration,
 * targets). member: only the copies bound to that party index. 0 when not owned.
 */
export function rewardParam(ps: PlayerState, family: string, key: string, mode: 'sum' | 'max' = 'sum', member?: number | null): number {
  let out = 0;
  for (const a of familyRewards(ps, family)) {
    if (member !== undefined && a.partyIndex !== member) continue;
    const v = getReward(a.rewardId).params[key] ?? 0;
    out = mode === 'max' ? Math.max(out, v) : out + v;
  }
  return out;
}

/** Applied rewards bound to party index idx (member cards and role cards taken through that member). */
export function memberRewards(ps: PlayerState, idx: number): AppliedReward[] {
  return ps.rewards.filter(a => a.partyIndex === idx);
}

/** 「직업 특기」 copies working for `role` (bound to any member of that role). */
export function roleRewards(ps: PlayerState, role: Role): AppliedReward[] {
  return familyRewards(ps, 'role').filter(a => memberRole(ps, a.partyIndex) === role);
}

/** Highest 「직업 특기」 level for role (0 = none) and whether it was taken twice (its numbers +50 %). */
export function roleLevel(ps: PlayerState, role: Role): { level: number; twice: boolean } {
  const list = roleRewards(ps, role);
  let level = 0;
  for (const a of list) level = Math.max(level, RANK[getReward(a.rewardId).rarity]);
  return { level, twice: list.length >= 2 };
}

/** Tag counts of rewards + classic relics (the same card twice counts 2). */
export function tagCounts(ps: PlayerState): Readonly<Record<SynergyTag, number>> {
  return index(ps).tags;
}

/** The tag's set bonus is on (≥ 3). */
export function tagActive(ps: PlayerState, tag: SynergyTag): boolean {
  return index(ps).tags[tag] >= TAG_SET_SIZE;
}

/** The def of an applied reward. */
export function defOf(a: AppliedReward): RewardDef {
  return getReward(a.rewardId);
}
