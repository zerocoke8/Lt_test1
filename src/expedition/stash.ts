// 기획 15차 원정 모드: the stash (보관함) model — pure, no DOM, no storage (src/ui/expeditionStore.ts persists it under
// localStorage 'swapTower.expedition.v1'). Items, what each of the 15 characters wears, NEW marks, first boss clears,
// the expedition party (kept apart from the classic preset) and the debug 「단계 전부 해금」 flag (docs/expedition.md 10장).
// Every helper mutates the StashData it is given and returns a result; parseStash never throws (corrupt → empty).

import { CHARACTERS, PETS, RELICS } from '../data';
import {
  BASE_SLOTS,
  GEAR_OPTIONS,
  GEAR_RARITIES,
  GEAR_SLOTS,
  RELIC_TIERS,
  cleanSpec,
  gearSpecProblem,
  maxStartStage,
  type GearItem,
  type GearLoadout,
  type GearRarity,
  type GearSlot,
  type GearSpec,
} from '../data/gear';
import { EXPEDITION_STAGES, isBossStage } from '../data/stages';
import { mixSeed, Rng } from '../sim/rng';

export const STASH_KEY = 'swapTower.expedition.v1';
export const MODE_KEY = 'swapTower.mode.v1';
export const STASH_VERSION = 1;

export interface StashPreset {
  characters: string[];
  pets: string[];
}

export interface StashData {
  v: 1;
  /** Next item number (uids are 'g1', 'g2', …; never reused). */
  nextUid: number;
  items: GearItem[];
  /** charId → slot → item uid. An item is worn by at most one character. */
  equipped: Record<string, Partial<Record<GearSlot, string>>>;
  /** Item uids already looked at (no NEW badge). */
  seen: string[];
  /** Boss stages (3 · 6 · 9 · 12) cleared at least once (the boss box is a sure relic until then). */
  bossFirstClears: number[];
  /** The expedition party (null = use the default). */
  preset: StashPreset | null;
  /** Debug 「단계 전부 해금」: ignore the start-stage rule. */
  unlockAll: boolean;
}

export interface StashResult {
  ok: boolean;
  reason?: string;
}

const CHAR_IDS = new Set(CHARACTERS.map(c => c.id));
const PET_IDS = new Set(PETS.map(p => p.id));

export function emptyStash(): StashData {
  return { v: 1, nextUid: 1, items: [], equipped: {}, seen: [], bossFirstClears: [], preset: null, unlockAll: false };
}

// ─────────────────────────── (De)serialisation ───────────────────────────

function cleanPreset(x: unknown): StashPreset | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const ok = (list: unknown, valid: ReadonlySet<string>) =>
    Array.isArray(list) && list.length === 3 && new Set(list).size === 3 && list.every(id => typeof id === 'string' && valid.has(id));
  return ok(r.characters, CHAR_IDS) && ok(r.pets, PET_IDS) ? { characters: [...(r.characters as string[])], pets: [...(r.pets as string[])] } : null;
}

/** A stored stash (JSON text or a parsed object), cleaned: bad items, unknown characters, dangling refs dropped. */
export function parseStash(raw: unknown): StashData {
  let x: unknown = raw;
  try {
    if (typeof raw === 'string') x = JSON.parse(raw);
  } catch {
    return emptyStash();
  }
  if (!x || typeof x !== 'object' || (x as { v?: unknown }).v !== STASH_VERSION) return emptyStash();
  const r = x as Record<string, unknown>;
  const s = emptyStash();
  const uids = new Set<string>();
  let maxN = 0;
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const i = it as Partial<GearItem>;
    if (!i || typeof i.uid !== 'string' || uids.has(i.uid) || gearSpecProblem(i)) continue;
    uids.add(i.uid);
    const fromStage = Number.isInteger(i.fromStage) && i.fromStage! >= 1 && i.fromStage! <= EXPEDITION_STAGES ? i.fromStage! : i.tier!;
    s.items.push({ ...cleanSpec(i as GearSpec), uid: i.uid, fromStage });
    const n = /^g(\d+)$/.exec(i.uid);
    if (n) maxN = Math.max(maxN, Number(n[1]));
  }
  s.nextUid = Math.max(maxN + 1, Number.isInteger(r.nextUid) ? (r.nextUid as number) : 1);
  const taken = new Set<string>();
  const eq = r.equipped && typeof r.equipped === 'object' ? (r.equipped as Record<string, unknown>) : {};
  for (const [charId, slots] of Object.entries(eq)) {
    if (!CHAR_IDS.has(charId) || !slots || typeof slots !== 'object') continue;
    for (const [slot, uid] of Object.entries(slots as Record<string, unknown>)) {
      if (typeof uid !== 'string' || taken.has(uid) || !GEAR_SLOTS.includes(slot as GearSlot)) continue;
      const item = s.items.find(i => i.uid === uid);
      if (!item || item.slot !== slot) continue;
      taken.add(uid);
      (s.equipped[charId] ??= {})[slot as GearSlot] = uid;
    }
  }
  s.seen = (Array.isArray(r.seen) ? r.seen : []).filter((u): u is string => typeof u === 'string' && uids.has(u));
  s.bossFirstClears = [...new Set((Array.isArray(r.bossFirstClears) ? r.bossFirstClears : []).filter((n): n is number => Number.isInteger(n) && isBossStage(n as number) && (n as number) <= EXPEDITION_STAGES))];
  s.preset = cleanPreset(r.preset);
  s.unlockAll = r.unlockAll === true;
  return s;
}

export function serializeStash(s: StashData): string {
  return JSON.stringify(s);
}

// ─────────────────────────── Queries ───────────────────────────

export function itemByUid(s: StashData, uid: string): GearItem | undefined {
  return s.items.find(i => i.uid === uid);
}

/** Who wears the item (charId), or null. */
export function wearerOf(s: StashData, uid: string): string | null {
  for (const [charId, slots] of Object.entries(s.equipped)) for (const u of Object.values(slots)) if (u === uid) return charId;
  return null;
}

export function equippedItem(s: StashData, charId: string, slot: GearSlot): GearItem | undefined {
  const uid = s.equipped[charId]?.[slot];
  return uid ? itemByUid(s, uid) : undefined;
}

/** What a character wears, as the sim sees it. */
export function loadoutOf(s: StashData, charId: string): GearLoadout {
  const out: GearLoadout = {};
  for (const slot of GEAR_SLOTS) {
    const it = equippedItem(s, charId, slot);
    if (it) out[slot] = cleanSpec(it);
  }
  return out;
}

/** PlayerSetup.gear for a party (same order as the party). */
export function loadoutsFor(s: StashData, partyIds: readonly string[]): GearLoadout[] {
  return partyIds.map(id => loadoutOf(s, id));
}

/** Highest stage this party may start at (6장; unlockAll → 12). */
export function maxStartStageFor(s: StashData, partyIds: readonly string[]): number {
  return s.unlockAll ? EXPEDITION_STAGES : maxStartStage(loadoutsFor(s, partyIds));
}

export function canStartAt(s: StashData, partyIds: readonly string[], stage: number): boolean {
  return Number.isInteger(stage) && stage >= 1 && stage <= maxStartStageFor(s, partyIds);
}

/** Items no character wears. */
export function freeItems(s: StashData): GearItem[] {
  const worn = new Set(Object.values(s.equipped).flatMap(x => Object.values(x)));
  return s.items.filter(i => !worn.has(i.uid));
}

export function isNew(s: StashData, uid: string): boolean {
  return !s.seen.includes(uid);
}

/** Per player: is clearing this boss stage the first time (the boss box is a sure relic)? */
export function isFirstBossClear(s: StashData, stage: number): boolean {
  return isBossStage(stage) && !s.bossFirstClears.includes(stage);
}

/** Sort key: tier, then rarity, then newer. Higher = better. */
export function itemScore(i: GearSpec & { uid?: string }): number {
  const n = i.uid ? Number(/^g(\d+)$/.exec(i.uid)?.[1] ?? 0) : 0;
  return i.tier * 1e6 + GEAR_RARITIES.indexOf(i.rarity) * 1e5 + Math.min(n, 99999);
}

// ─────────────────────────── Changes ───────────────────────────

/** Put specs into the stash (extract / debug). Returns the new items (NEW until marked seen). */
export function addItems(s: StashData, specs: readonly GearSpec[], fromStage: number): GearItem[] {
  const out: GearItem[] = [];
  for (const g of specs) {
    if (gearSpecProblem(g)) continue;
    const item: GearItem = { ...cleanSpec(g), uid: `g${s.nextUid++}`, fromStage: Math.max(1, Math.min(EXPEDITION_STAGES, Math.floor(fromStage) || g.tier)) };
    s.items.push(item);
    out.push(item);
  }
  return out;
}

/** Wear item uid on charId (it leaves whoever wore it; the piece it replaces goes back to the stash). */
export function equip(s: StashData, charId: string, uid: string): StashResult {
  if (!CHAR_IDS.has(charId)) return { ok: false, reason: '알 수 없는 캐릭터' };
  const item = itemByUid(s, uid);
  if (!item) return { ok: false, reason: '없는 장비' };
  const was = wearerOf(s, uid);
  if (was) delete s.equipped[was][item.slot];
  (s.equipped[charId] ??= {})[item.slot] = uid;
  return { ok: true };
}

export function unequip(s: StashData, charId: string, slot: GearSlot): StashResult {
  const slots = s.equipped[charId];
  if (!slots?.[slot]) return { ok: false, reason: '빈 칸' };
  delete slots[slot];
  return { ok: true };
}

/** 「버리기」: gone for good (taken off first). */
export function discard(s: StashData, uid: string): StashResult {
  const i = s.items.findIndex(x => x.uid === uid);
  if (i < 0) return { ok: false, reason: '없는 장비' };
  const was = wearerOf(s, uid);
  if (was) delete s.equipped[was][s.items[i].slot];
  s.items.splice(i, 1);
  s.seen = s.seen.filter(u => u !== uid);
  return { ok: true };
}

/**
 * 「최고 등급 자동 장착」: for each party member and slot, the best of what it wears and the free items (tier → rarity →
 * newer). Items worn by other characters are left alone. Returns the uids newly equipped.
 */
export function autoEquip(s: StashData, partyIds: readonly string[]): string[] {
  const changed: string[] = [];
  for (const charId of partyIds) {
    if (!CHAR_IDS.has(charId)) continue;
    for (const slot of GEAR_SLOTS) {
      const cur = equippedItem(s, charId, slot);
      let best = cur;
      for (const it of freeItems(s)) if (it.slot === slot && (!best || itemScore(it) > itemScore(best))) best = it;
      if (best && best !== cur) {
        equip(s, charId, best.uid);
        changed.push(best.uid);
      }
    }
  }
  return changed;
}

export function markSeen(s: StashData, uids: readonly string[]): void {
  for (const u of uids) if (!s.seen.includes(u) && itemByUid(s, u)) s.seen.push(u);
}

export function recordBossClear(s: StashData, stage: number): void {
  if (isBossStage(stage) && !s.bossFirstClears.includes(stage)) s.bossFirstClears.push(stage);
}

export function setPreset(s: StashData, preset: StashPreset): StashResult {
  const p = cleanPreset(preset);
  if (!p) return { ok: false, reason: '편성 오류' };
  s.preset = p;
  return { ok: true };
}

// ─────────────────────────── Debug grants (8-9) ───────────────────────────

/** 「선택 캐릭터 모든 칸 Tn 지급」: a common weapon / armor / charm of that tier, worn at once. */
export function grantSet(s: StashData, charId: string, tier: number): GearItem[] {
  const t = Math.max(1, Math.min(EXPEDITION_STAGES, Math.floor(tier)));
  const items = addItems(s, BASE_SLOTS.map(slot => ({ slot, tier: t, rarity: 'common' as GearRarity })), t);
  for (const it of items) equip(s, charId, it.uid);
  return items;
}

/** 「원정대 3명 한 벌 지급」. */
export function grantPartySet(s: StashData, partyIds: readonly string[], tier: number): GearItem[] {
  return partyIds.flatMap(id => grantSet(s, id, tier));
}

/** 「무작위 장비 10개」 (seeded by the stash's next uid, so it is repeatable in tests). */
export function grantRandom(s: StashData, n: number): GearItem[] {
  const rng = new Rng(mixSeed(0x57a54, s.nextUid));
  const specs: GearSpec[] = [];
  for (let k = 0; k < n; k++) {
    const tier = rng.int(1, EXPEDITION_STAGES);
    const slot = rng.pick(BASE_SLOTS);
    const rarity: GearRarity = tier < 4 ? 'common' : rng.pick(GEAR_RARITIES);
    const spec: GearSpec = { slot, tier, rarity };
    if (rarity !== 'common') spec.optionId = rng.pick(GEAR_OPTIONS.filter(o => o.slot === slot)).id;
    specs.push(spec);
  }
  return specs.map(g => addItems(s, [g], g.tier)[0]);
}

/** 「유물 8종 지급」 at tier 3 (or 6 · 9 · 12). */
export function grantRelics(s: StashData, tier = 3): GearItem[] {
  const t = RELIC_TIERS.includes(tier) ? tier : 3;
  return addItems(s, RELICS.map(r => ({ slot: 'relic' as GearSlot, tier: t, rarity: r.rarity, relicId: r.id })), t);
}

/** 「보관함 초기화」: everything gone (the expedition party and the unlock flag stay). */
export function resetStash(s: StashData): StashData {
  const fresh = emptyStash();
  fresh.preset = s.preset;
  fresh.unlockAll = s.unlockAll;
  return fresh;
}
