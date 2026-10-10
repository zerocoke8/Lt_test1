// 층 보상 화면 (R20 → 기획 17차 docs/floor-rewards.md): rolls, rerolls (다시 뽑기), picks (지명권, 욕심쟁이 pick 2),
// grants, and the 괴담 room draw. Every roll uses the player's own stream offerRng(seed, floor/stage, player, roll) —
// never the run rng — so a reroll changes nothing else in the game and nobody else's cards.
//  - normal screen: slot 1 from the 12 basic families, the rest from every other family (basic when none is left);
//    families distinct; ≥ 1 card tagged #등장/#퇴장/#교대/#저스트; ≤ 1 curse (weight ×0.6), ≤ 1 coop (×0.7 solo);
//    weight ×1.5 for a tag held exactly twice; rarity by band (67/25/6/2 from classic floor 11 / 원정 stage 7);
//    ≤ 1 legendary (unique legendary families not owned, else epic).
//  - relic screen (classic boss floors): relics not owned (3, odds 70/25/5), topped up with normal cards.

import type { AppliedReward, CommandResult, GameState, PlayerState, Rarity, RewardDef, RewardFamilyDef, RewardOffer, Role, SynergyTag } from '../../types';
import {
  FAMILIES,
  MAX_REROLLS,
  PREF_DEALER,
  RARITIES,
  RARITY_BY_BAND,
  RARITY_WEIGHTS,
  RELICS,
  REWARDS,
  ROLE_NAME,
  ROLE_TAGS,
  SWAP_TAGS,
  TAG_INFO,
  familyRarities,
  getCharacter,
  getFamily,
  getReward,
  isBasicFamily,
  rewardFamily,
} from '../../data';
import { MAX_PET_COOLDOWN_REDUCTION } from '../constants';
import { gearOptionValue, petCooldownReduction } from '../modifiers';
import { benchMaxHp, effStats } from '../stats';
import { mixSeed, Rng } from '../rng';
import { emit, getEntity, type OfferMods, type SimPlayer, type World } from '../world';
import { rwOfferMods, rwOnGrant } from './hooks';
import { invalidateRewards, rewardCount, tagCounts } from './query';

export { rewardFamily };

const OFFER_COUNT = 3;
const OFFER_SALT = 0x0ff3a17;
/** Separate streams: normal rolls, relic rolls, single draws (debt, debug fixture). */
export const OFFER_STREAM = { roll: 1, relic: 2, draw: 3 } as const;

/** Pick weights of the family pool. */
export const OFFER_WEIGHT = { curse: 0.6, coopSolo: 0.7, lean: 1.5 } as const;

/** 상자 · 빚 · 욕심 hold a pending effect in these rewardState keys (not offered again while any is > 0). */
export const ECONOMY_STATE: Record<string, readonly string[]> = {
  box_in_box: ['boxBump'],
  debt: ['debt'],
  greedy: ['greedyPicks', 'greedySkip'],
};

/** Families that change the next screen: not offered before a classic boss floor (its screen is the relic screen). */
const NOT_BEFORE_BOSS: ReadonlySet<string> = new Set(['box_in_box', 'greedy']);

const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** The player's own offer stream for this floor (원정: stage) and roll. */
export function offerRng(seed: number, floorKey: number, player: number, rollNo: number, stream: number = OFFER_STREAM.roll): Rng {
  return new Rng(mixSeed(seed, OFFER_SALT, stream, floorKey, player, rollNo));
}

/** Classic: the floor just cleared; 원정: the stage. */
export function floorKey(s: GameState): number {
  return s.expedition ? s.expedition.stage : s.floor;
}

/** Rarity odds of this screen (classic floor ≥ 11, 원정 stage ≥ 7 → with legendary). */
export function rarityBand(s: GameState): readonly number[] {
  const late = s.expedition ? s.expedition.stage >= 7 : s.floor >= 11;
  return RARITY_BY_BAND[late ? 1 : 0];
}

// ─────────────────────────── Eligibility ───────────────────────────

function partyRoles(ps: PlayerState): Role[] {
  return ps.party.map(m => getCharacter(m.defId).role);
}

/** Other seats still in the run (bots count). */
export function otherSeats(s: GameState, ps: PlayerState): number {
  return s.players.filter(x => x.id !== ps.id && !x.out).length;
}

function humanSeats(s: GameState): number {
  return s.players.filter(x => !x.isBot && !x.out).length;
}

/** The party fits the family's requires. */
export function requiresOk(s: GameState | null, ps: PlayerState, f: Pick<RewardFamilyDef, 'requires'>): boolean {
  const roles = partyRoles(ps);
  const has = (r: Role) => roles.includes(r);
  switch (f.requires) {
    case undefined:
      return true;
    case 'tank':
    case 'melee':
    case 'ranged':
    case 'healer':
    case 'support':
      return has(f.requires);
    case 'tankAndDealer':
      return has('tank') && (has('melee') || has('ranged'));
    case 'healerAndDealer':
      return has('healer') && (has('melee') || has('ranged'));
    case 'tankOrMelee':
      return has('tank') || has('melee');
    case 'dupRole':
      return new Set(roles).size < roles.length;
    case 'allRolesDiffer':
      return new Set(roles).size === roles.length && roles.length >= 3;
    case 'otherSeat':
      return !!s && otherSeats(s, ps) > 0;
    case 'burnSource':
      return canBurn(ps);
  }
}

/** Rewards that put my burn on enemies (연쇄 화상 needs one of them, or a burning character / weapon). */
const BURN_REWARDS = ['scorch', 'fire_hand'];
const burnsCache = new Map<string, boolean>();

/** Does this character's data burn (any skill or on-hit status 'burn')? Cached per character. */
function characterBurns(defId: string): boolean {
  let v = burnsCache.get(defId);
  if (v == null) {
    v = JSON.stringify(getCharacter(defId)).includes('"status":"burn"');
    burnsCache.set(defId, v);
  }
  return v;
}

/** 기획 17차: can ps's party burn enemies by itself (characters, owned rewards, 원정 weapon 「그을린 발자국」)? */
export function canBurn(ps: PlayerState): boolean {
  if (ps.party.some(m => characterBurns(m.defId))) return true;
  if (BURN_REWARDS.some(k => rewardCount(ps, k) > 0)) return true;
  return !!ps.gear && ps.party.some((_, i) => gearOptionValue(ps, i, 'w_scorch') > 0);
}

function economyActive(ps: PlayerState, key: string): boolean {
  return (ECONOMY_STATE[key] ?? []).some(k => (ps.rewardState?.[k] ?? 0) > 0);
}

/** 금박 부적 has something to gild: a common reward of a family with a rare tier. */
function canGild(ps: PlayerState): boolean {
  return ps.rewards.some(r => {
    const d = getReward(r.rewardId);
    return d.rarity === 'common' && d.target !== 'self' && familyRarities(getFamily(d.family)).includes('rare');
  });
}

/** May the family be offered to ps on this screen at all (rarity aside)? */
export function familyEligible(s: GameState, ps: PlayerState, f: RewardFamilyDef): boolean {
  if (!requiresOk(s, ps, f)) return false;
  if (f.unique && rewardCount(ps, f.key) > 0) return false;
  if (f.key === 'relay_blast' && ps.relics.includes('relay_flag')) return false;
  if (!s.expedition && NOT_BEFORE_BOSS.has(f.key) && (s.floor + 1) % 5 === 0) return false;
  if (f.flag === 'economy' && economyActive(ps, f.key)) return false;
  if (f.key === 'incense' && ps.rerolls >= MAX_REROLLS) return false;
  if (f.key === 'petcd' && petCooldownReduction(ps) >= MAX_PET_COOLDOWN_REDUCTION - 1e-9) return false; // at its cap
  if (f.key === 'gilded' && !canGild(ps)) return false;
  if (f.flag === 'coop' && otherSeats(s, ps) === 0) return false;
  return true;
}

function onlyLegendary(f: RewardFamilyDef): boolean {
  const r = familyRarities(f);
  return r.length === 1 && r[0] === 'legendary';
}

/** The rarity a family shows for a wanted one: itself, else the nearest lower, else the nearest higher (never 전설). */
export function resolveRarity(f: RewardFamilyDef, want: Rarity): Rarity | null {
  const have = familyRarities(f).filter(r => r !== 'legendary' || want === 'legendary');
  if (have.length === 0) return null;
  if (have.includes(want)) return want;
  const lower = have.filter(r => RANK[r] < RANK[want]);
  return lower.length ? lower[lower.length - 1] : have[0];
}

// ─────────────────────────── Cards ───────────────────────────

function charName(ps: PlayerState, idx: number | null): string | undefined {
  const m = idx != null ? ps.party[idx] : undefined;
  return m ? getCharacter(m.defId).name : undefined;
}

/**
 * 지명권 default member: the first of prefRoles (default 원거리 > 근접 > 탱커 > 서포터 > 힐러) present in the party,
 * among those the one with the most field time, ties → the lower slot. PURE.
 */
export function defaultMember(ps: PlayerState, prefRoles?: readonly Role[]): number {
  const roles = partyRoles(ps);
  for (const role of prefRoles ?? PREF_DEALER) {
    let best = -1;
    roles.forEach((r, i) => {
      if (r !== role) return;
      if (best < 0 || (ps.party[i].fieldTime ?? 0) > (ps.party[best].fieldTime ?? 0) + 1e-9) best = i;
    });
    if (best >= 0) return best;
  }
  return 0;
}

/** Tags a card counts for (the role card: its role's). */
export function cardTags(def: RewardDef, role?: Role): SynergyTag[] {
  return def.family === 'role' && role ? [...ROLE_TAGS[role]] : [...def.tags];
}

/** One offer card of family f at rarity (member / role resolved). */
export function makeOffer(ps: PlayerState, f: RewardFamilyDef, rarity: Rarity, role?: Role): RewardOffer {
  const def = getReward(`${f.key}_${rarity}`);
  const member = f.target === 'member' ? defaultMember(ps, f.prefRoles) : f.target === 'role' && role ? partyRoles(ps).indexOf(role) : null;
  const char = charName(ps, member);
  const name = f.target === 'role' && role ? `${ROLE_NAME[role]} 특기` : def.name.split('{char}').join(char ?? '');
  return {
    rewardId: def.id,
    partyIndex: member,
    name,
    description: f.describe(def.params, { char, role, card: true }),
    rarity: def.rarity,
    isRelic: false,
    family: f.key,
    tags: cardTags(def, role),
    target: f.target,
    member,
    ...(role ? { role } : null),
    ...(f.flag ? { flag: f.flag } : null),
    ...(def.cost ? { cost: def.cost } : null),
  };
}

function relicOffer(id: string): RewardOffer {
  const r = RELICS.find(x => x.id === id)!;
  return { rewardId: r.id, partyIndex: null, name: r.name, description: r.description, rarity: r.rarity, isRelic: true };
}

// ─────────────────────────── Rolls ───────────────────────────

export interface RollOpts {
  /** 0 = first roll, +1 per reroll. */
  rollNo?: number;
  /** Families never shown (a reroll's earlier cards); relaxed when nothing else is left. */
  exclude?: readonly string[];
  /** Cards (normal screens: 3, 욕심쟁이 4). */
  count?: number;
  /** Rarity steps up for every card (상자 속 상자). */
  rarityBump?: number;
  /** Debug 'offerFixture': the last card is a legendary (when one is left). */
  fixture?: boolean;
}

interface RollState {
  s: GameState;
  ps: PlayerState;
  rng: Rng;
  used: Set<string>;
  exclude: Set<string>;
  offers: RewardOffer[];
  lean: Set<SynergyTag>;
  solo: boolean;
}

function weightOf(st: RollState, f: RewardFamilyDef): number {
  let wt = 1;
  if (f.tags.includes('curse')) wt *= OFFER_WEIGHT.curse;
  if (f.tags.includes('coop') && st.solo) wt *= OFFER_WEIGHT.coopSolo;
  if (f.tags.some(t => st.lean.has(t))) wt *= OFFER_WEIGHT.lean;
  return wt;
}

/** The tags capped at one card per screen (#저주, #협동), by the family's own tags (직업 특기 has none of its own). */
const CAPPED_TAGS: readonly SynergyTag[] = ['curse', 'coop'];

/** A capped tag (#저주 / #협동) family f has that a card on the screen already has. */
function capBlocked(st: RollState, f: RewardFamilyDef): boolean {
  return CAPPED_TAGS.some(t => f.tags.includes(t) && st.offers.some(o => !o.isRelic && !!o.family && getFamily(o.family).tags.includes(t)));
}

/** Families that may fill a slot now (distinct, caps, eligibility). */
function slotPool(st: RollState, basic: boolean, relax = false): RewardFamilyDef[] {
  return FAMILIES.filter(f => {
    if (isBasicFamily(f.key) !== basic || onlyLegendary(f)) return false;
    if (st.used.has(f.key) || (!relax && st.exclude.has(f.key))) return false;
    if (capBlocked(st, f)) return false;
    return familyEligible(st.s, st.ps, f);
  });
}

function pickFrom(st: RollState, pool: RewardFamilyDef[]): RewardFamilyDef | null {
  return pool.length ? st.rng.weighted(pool, f => weightOf(st, f)) : null;
}

/** Unique legendary families not owned (and eligible), not on the screen yet. */
function legendaryPool(st: RollState): RewardFamilyDef[] {
  return FAMILIES.filter(f => f.unique && familyRarities(f).includes('legendary') && !st.used.has(f.key) && !st.exclude.has(f.key) && !capBlocked(st, f) && familyEligible(st.s, st.ps, f));
}

function rollRarity(st: RollState): Rarity {
  const band = rarityBand(st.s);
  return st.rng.weighted(RARITIES, r => band[RANK[r]]);
}

/** A role of the party (the role card), in party order. */
function rollRole(st: RollState): Role {
  const roles = [...new Set(partyRoles(st.ps))];
  return st.rng.pick(roles);
}

function addCard(st: RollState, f: RewardFamilyDef, rarity: Rarity): void {
  const role = f.target === 'role' ? rollRole(st) : undefined;
  st.offers.push(makeOffer(st.ps, f, rarity, role));
  st.used.add(f.key);
}

/** One normal slot (slot 0 = basic). False when nothing at all fits. */
function rollSlot(st: RollState, slot: number, forceLegend: boolean): boolean {
  let want = forceLegend ? 'legendary' : rollRarity(st);
  const legendShown = st.offers.some(o => o.rarity === 'legendary');
  if (want === 'legendary' && (slot === 0 || legendShown)) want = 'epic';
  if (want === 'legendary') {
    const f = pickFrom(st, legendaryPool(st));
    if (f) {
      addCard(st, f, 'legendary');
      return true;
    }
    want = 'epic';
  }
  const f = pickFrom(st, slotPool(st, slot === 0)) ?? pickFrom(st, slotPool(st, true)) ?? pickFrom(st, slotPool(st, slot === 0, true)) ?? pickFrom(st, slotPool(st, true, true));
  if (!f) return false;
  addCard(st, f, resolveRarity(f, want)!);
  return true;
}

function hasSwapTag(o: RewardOffer): boolean {
  return (o.tags ?? []).some(t => SWAP_TAGS.includes(t));
}

function familySwapTagged(f: RewardFamilyDef): boolean {
  return f.target === 'role' || f.tags.some(t => SWAP_TAGS.includes(t));
}

/** 교체 보장: no #등장/#퇴장/#교대/#저스트 card → the last plain card becomes one (same rarity). */
function swapGuarantee(st: RollState): void {
  if (st.offers.length < 2 || st.offers.some(hasSwapTag)) return;
  let i = st.offers.length - 1;
  while (i > 0 && st.offers[i].rarity === 'legendary') i--;
  if (i <= 0) return;
  const old = st.offers[i];
  st.used.delete(old.family!);
  st.offers.splice(i, 1);
  const pool = slotPool(st, false).filter(familySwapTagged);
  const f = pickFrom(st, pool);
  if (!f) {
    st.offers.splice(i, 0, old);
    st.used.add(old.family!);
    return;
  }
  const role = f.target === 'role' ? rollRole(st) : undefined;
  st.offers.splice(i, 0, makeOffer(st.ps, f, resolveRarity(f, old.rarity)!, role));
  st.used.add(f.key);
}

/** 상자 속 상자: every card one rarity up (that family's next tier, at most 영웅; 전설 never). */
function bumpRarity(st: RollState, steps: number): void {
  if (steps <= 0) return;
  st.offers = st.offers.map(o => {
    if (o.isRelic || o.rarity === 'legendary') return o;
    const f = getFamily(o.family!);
    const up = familyRarities(f).filter(r => r !== 'legendary' && RANK[r] > RANK[o.rarity]);
    if (!up.length) return o;
    const r = up[Math.min(up.length, steps) - 1];
    return { ...makeOffer(st.ps, f, r, o.role), rarityBumped: true as const };
  });
}

/** Tags held exactly twice (their cards weigh ×1.5 — a pick would complete the set). */
export function tagLean(ps: PlayerState): Set<SynergyTag> {
  const c = tagCounts(ps);
  return new Set((Object.keys(TAG_INFO) as SynergyTag[]).filter(t => c[t] === 2));
}

/**
 * The cards of one screen of player p (pure over the state: no hooks run, the run rng is untouched). relicFloor: a
 * classic boss floor's relic screen.
 */
export function rollOffers(w: World, p: SimPlayer, relicFloor: boolean, opts: RollOpts = {}): RewardOffer[] {
  const s = w.state;
  const rollNo = opts.rollNo ?? 0;
  const st: RollState = {
    s,
    ps: p,
    rng: offerRng(s.seed, floorKey(s), p.id, rollNo, relicFloor ? OFFER_STREAM.relic : OFFER_STREAM.roll),
    used: new Set(),
    exclude: new Set(opts.exclude ?? []),
    offers: [],
    lean: tagLean(p),
    solo: humanSeats(s) <= 1,
  };
  const count = opts.count ?? OFFER_COUNT;
  if (relicFloor) {
    const pool = RELICS.filter(r => !p.relics.includes(r.id));
    while (st.offers.length < OFFER_COUNT && pool.length > 0) {
      const r = st.rng.weighted(pool, x => RARITY_WEIGHTS[x.rarity]);
      pool.splice(pool.indexOf(r), 1);
      st.offers.push(relicOffer(r.id));
    }
  }
  const first = st.offers.length;
  for (let slot = 0; st.offers.length < count; slot++) {
    const legend = !!opts.fixture && st.offers.length === count - 1 && first === 0;
    if (!rollSlot(st, slot, legend)) break;
  }
  if (first === 0) {
    swapGuarantee(st);
    bumpRarity(st, opts.rarityBump ?? 0);
  }
  return st.offers;
}

// ─────────────────────────── Screens ───────────────────────────

function baseMods(): OfferMods {
  return { rarityBump: 0, count: OFFER_COUNT, picks: 1, skip: false };
}

/**
 * Open p's screen after a floor clear: the hooks' offerMods run once (상자 · 욕심 · 빚), then the first roll. Null =
 * no screen (skipped: a 'rewardProc' toast is emitted, or nothing to offer).
 */
export function openRewardScreen(w: World, p: SimPlayer, relicFloor: boolean): RewardOffer[] | null {
  const mods = relicFloor ? baseMods() : rwOfferMods(w, p, baseMods());
  if (mods.skip) {
    p.rt.offerScreen = undefined;
    emit(w, { type: 'rewardProc', player: p.id, partyIndex: null, entityId: null, rewardId: mods.skipBy ?? 'debt', pos: { x: 0, y: 0 }, text: mods.skipText ?? '이번 보상 없음' });
    return null;
  }
  const fixture = !relicFloor && !!p.rt.offerFixture;
  if (fixture) p.rt.offerFixture = false;
  const offers = rollOffers(w, p, relicFloor, { count: mods.count, rarityBump: mods.rarityBump, fixture });
  if (offers.length === 0) return null;
  p.rt.offerScreen = { relic: relicFloor, mods, rollNo: 0, shown: offers.filter(o => !o.isRelic).map(o => o.family!), picksTaken: 0 };
  setPicksLeft(p, Math.min(mods.picks, offers.length));
  return offers;
}

function setPicksLeft(p: SimPlayer, n: number): void {
  if (n > 1) p.rewardPicksLeft = n;
  else delete p.rewardPicksLeft;
}

/** Why p cannot reroll now (null = it can). */
export function rerollProblem(s: GameState, pi: number): string | null {
  if (s.phase !== 'reward') return '보상 단계가 아님';
  const p = s.players[pi];
  const offers = p ? s.rewardOffersByPlayer[pi] : null;
  if (!p || !offers || offers.length === 0) return '고를 보상이 없음';
  if (offers.some(o => o.isRelic)) return '유물은 다시 뽑을 수 없음';
  if (!(p.rerolls > 0)) return '다시 뽑기 없음';
  return null;
}

/** 다시 뽑기: one reroll spent, new cards on p's own stream (families shown on this screen never come back). */
export function rerollReward(w: World, pi: number): CommandResult {
  const s = w.state;
  const why = rerollProblem(s, pi);
  if (why) return { ok: false, reason: why };
  const p = s.players[pi];
  const sc = p.rt.offerScreen ?? { relic: false, mods: baseMods(), rollNo: 0, shown: [], picksTaken: 0 };
  sc.rollNo++;
  const count = Math.max(1, sc.mods.count - sc.picksTaken);
  const offers = rollOffers(w, p, false, { rollNo: sc.rollNo, exclude: sc.shown, count, rarityBump: sc.mods.rarityBump });
  if (offers.length === 0) return { ok: false, reason: '고를 보상이 없음' };
  p.rerolls--;
  sc.shown.push(...offers.map(o => o.family!));
  p.rt.offerScreen = sc;
  s.rewardOffersByPlayer[pi] = offers;
  return { ok: true };
}

/** Where an offer goes: party / self cards → null; member / role cards → member if valid, else the card's default. */
export function offerTarget(ps: PlayerState, offer: RewardOffer, member?: number | null): number | null {
  if (offer.isRelic) return null;
  const target = offer.target ?? (offer.partyIndex != null ? 'member' : 'party');
  if (target === 'party' || target === 'self') return null;
  if (member != null && Number.isInteger(member) && member >= 0 && member < ps.party.length) return member;
  return offer.member ?? offer.partyIndex ?? defaultMember(ps);
}

export function applyOffer(w: World, p: SimPlayer, offer: RewardOffer, member?: number | null): void {
  if (offer.isRelic) {
    if (!p.relics.includes(offer.rewardId)) p.relics.push(offer.rewardId);
    return;
  }
  grantReward(w, p, offer.rewardId, offerTarget(p, offer, member));
}

/**
 * Pick card offerIndex of p's open screen (member: 지명권). The screen stays open while picks are left (욕심쟁이),
 * minus the card taken. Returns the result; state.rewardOffersByPlayer[p.id] is updated.
 */
export function pickOffer(w: World, p: SimPlayer, offerIndex: number, member?: number): CommandResult {
  const s = w.state;
  const offers = s.rewardOffersByPlayer[p.id];
  if (!offers) return { ok: false, reason: '고를 보상이 없음' };
  const offer = Number.isInteger(offerIndex) ? offers[offerIndex] : undefined;
  if (!offer) return { ok: false, reason: '잘못된 선택' };
  if (member !== undefined && !(Number.isInteger(member) && member >= 0 && member < p.party.length)) return { ok: false, reason: '잘못된 대상' };
  applyOffer(w, p, offer, member);
  const left = (p.rewardPicksLeft ?? 1) - 1;
  const rest = offers.filter((_, i) => i !== offerIndex);
  if (left > 0 && rest.length > 0) {
    s.rewardOffersByPlayer[p.id] = rest;
    p.rewardPicksLeft = left; // 1 = 「하나 더 고르세요」
    if (p.rt.offerScreen) p.rt.offerScreen.picksTaken++;
  } else {
    s.rewardOffersByPlayer[p.id] = null;
    delete p.rewardPicksLeft;
    p.rt.offerScreen = undefined;
  }
  return { ok: true };
}

// ─────────────────────────── Grants ───────────────────────────

/** Add a floor reward to p (a max HP bonus also raises living members' HP; HP stays ≥ 1); tags reaching 3 → 'tagSet'. */
export function grantReward(w: World, p: SimPlayer, rewardId: string, partyIndex: number | null): void {
  const def = getReward(rewardId);
  const before = { ...tagCounts(p) };
  const applied: AppliedReward = { rewardId: def.id, partyIndex };
  p.rewards.push(applied);
  if (def.effect.kind === 'stat' && def.effect.mods.hpPct) raiseHp(w, p, def.effect.mods.hpPct);
  rwOnGrant(w, p, applied, def);
  const after = tagCounts(p);
  for (const t of Object.keys(after) as SynergyTag[]) if (before[t] < 3 && after[t] >= 3) emit(w, { type: 'tagSet', player: p.id, tag: t });
}

/** Max HP bonus also raises current HP of living members by the same amount. */
function raiseHp(w: World, p: SimPlayer, hpPct: number): void {
  p.party.forEach((m, idx) => {
    const gain = getCharacter(m.defId).stats.maxHp * hpPct;
    const e = getEntity(w, m.entityId);
    if (e) {
      e.maxHp = effStats(w, e).maxHp;
      e.hp = Math.max(1, Math.min(e.maxHp, e.hp + gain));
      m.hp = e.hp;
      m.maxHp = e.maxHp;
    } else {
      m.maxHp = benchMaxHp(p, idx);
      if (!m.dead) m.hp = Math.max(1, Math.min(m.maxHp, m.hp + gain));
    }
  });
}

/**
 * One reward of `rarity` drawn on p's draw stream (빚쟁이의 방문's epic; tracks pass their own `salt`): any family
 * that has that rarity and may be offered to p, bound to its default member / a rolled role. Null = nothing fits.
 */
export function drawFamilyReward(w: World, p: SimPlayer, rarity: Rarity, salt: number): AppliedReward | null {
  const s = w.state;
  const rng = offerRng(s.seed, floorKey(s), p.id, salt, OFFER_STREAM.draw);
  const pool = FAMILIES.filter(f => f.params[rarity] && f.target !== 'self' && !f.flag && familyEligible(s, p, f));
  if (pool.length === 0) return null;
  const f = rng.pick(pool);
  const role = f.target === 'role' ? rng.pick([...new Set(partyRoles(p))]) : undefined;
  const o = makeOffer(p, f, rarity, role);
  return { rewardId: o.rewardId, partyIndex: o.member ?? null };
}

/**
 * 기획 10차: one normal reward with the given rarity weights (bound to a random member when character-scoped), drawn
 * with the caller's rng — the 괴담 room passes its own, so the run rng's order is untouched. Null when nothing fits.
 * 기획 17차: never a legendary, an economy / coop / reward-screen card, a once-only card owned, or one the party
 * does not fit.
 */
export function drawOne(rng: Rng, p: SimPlayer, weights: Partial<Record<Rarity, number>>, filter?: (r: RewardDef) => boolean): AppliedReward | null {
  const pool = REWARDS.filter(
    r =>
      (weights[r.rarity] ?? 0) > 0 &&
      r.rarity !== 'legendary' &&
      r.target !== 'self' &&
      !r.flag &&
      r.requires !== 'otherSeat' &&
      !(r.unique && rewardCount(p, r.family) > 0) &&
      requiresOk(null, p, r) &&
      (!filter || filter(r)),
  );
  if (pool.length === 0) return null;
  const rarities = RARITIES.filter(r => pool.some(x => x.rarity === r));
  const rarity = rng.weighted(rarities, r => weights[r] ?? 0);
  const r = rng.pick(pool.filter(x => x.rarity === rarity));
  const partyIndex = r.scope === 'character' ? rng.int(0, p.party.length - 1) : null;
  return { rewardId: r.id, partyIndex };
}

/** Rewards that can still be in a 원정 carry (ids of every family × rarity). */
export const REWARD_IDS: ReadonlySet<string> = new Set(REWARDS.map(r => r.id));

export { invalidateRewards };
