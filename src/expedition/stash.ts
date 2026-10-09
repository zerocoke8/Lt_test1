// 기획 15차 원정 모드: the stash (보관함) model — pure, no DOM, no storage (src/ui/expeditionStore.ts persists it under
// localStorage 'swapTower.expedition.v1'). Items, what each of the 15 characters wears, NEW marks, first boss clears,
// the expedition party (kept apart from the classic preset) and the debug 「단계 전부 해금」 flag (docs/expedition.md 10장).
// 기획 16차: version 2 adds the run in progress (`run`, src/expedition/run.ts) — kept in the same record so 「수령」 (bag →
// stash, run gone) is one save — and locks gear / party changes while it exists (5-4).
// Every helper mutates the StashData it is given and returns a result; parseStash never throws (corrupt → empty).

import { CHARACTERS, PETS, RELICS } from '../data';
import {
  BASE_SLOTS,
  GEAR_OPTIONS,
  GEAR_RARITIES,
  GEAR_SLOTS,
  RELIC_TIERS,
  cleanPartyGear,
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
import { applyStageResult, runToJoin, type ApplyKind, type ExpeditionRun, type RunLock, type RunPending, type StageResult, type WonStage } from './run';
import { RUN_ID_RE, runInfoProblem } from './runCheck';

export const STASH_KEY = 'swapTower.expedition.v1';
export const MODE_KEY = 'swapTower.mode.v1';
export const STASH_VERSION = 2;
/** 기획 16차: why a gear / party change is refused while a run exists. */
export const RUN_LOCK_REASON = '원정 중에는 장비·편성을 바꿀 수 없어요';
/** 기획 16차: a claim that another tab (or a running stage) got first. */
export const RUN_GONE_REASON = '다른 창에서 이미 처리했어요';

export interface StashPreset {
  characters: string[];
  pets: string[];
}

export interface StashData {
  v: 2;
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
  /** 기획 16차: the run in progress (bag not claimed yet), else null. */
  run: ExpeditionRun | null;
}

export interface StashResult {
  ok: boolean;
  reason?: string;
}

const CHAR_IDS = new Set(CHARACTERS.map(c => c.id));
const PET_IDS = new Set(PETS.map(p => p.id));

export function emptyStash(): StashData {
  return { v: 2, nextUid: 1, items: [], equipped: {}, seen: [], bossFirstClears: [], preset: null, unlockAll: false, run: null };
}

// ─────────────────────────── (De)serialisation ───────────────────────────

function cleanPreset(x: unknown): StashPreset | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const ok = (list: unknown, valid: ReadonlySet<string>) =>
    Array.isArray(list) && list.length === 3 && new Set(list).size === 3 && list.every(id => typeof id === 'string' && valid.has(id));
  return ok(r.characters, CHAR_IDS) && ok(r.pets, PET_IDS) ? { characters: [...(r.characters as string[])], pets: [...(r.pets as string[])] } : null;
}

/**
 * A stored stash (JSON text or a parsed object), cleaned: bad items, unknown characters, dangling refs dropped.
 * Version 1 (기획 15차) reads as version 2 with no run; a stored run that is malformed or impossible is dropped.
 */
export function parseStash(raw: unknown): StashData {
  let x: unknown = raw;
  try {
    if (typeof raw === 'string') x = JSON.parse(raw);
  } catch {
    return emptyStash();
  }
  const v = x && typeof x === 'object' ? (x as { v?: unknown }).v : null;
  if (v !== 1 && v !== STASH_VERSION) return emptyStash();
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
  s.run = v === STASH_VERSION ? cleanRun(r.run) : null;
  return s;
}

// ─────────────────────────── The stored run (기획 16차) ───────────────────────────

const STATUSES = new Set(['lobby', 'matching', 'inStage']);

function cleanLock(x: unknown): RunLock | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const preset = cleanPreset(r);
  const gear = cleanPartyGear(r.gear, 3);
  return preset && gear ? { characters: preset.characters, pets: preset.pets, gear } : null;
}

function cleanPending(x: unknown): RunPending | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (!Number.isInteger(r.stage) || typeof r.online !== 'boolean' || typeof r.tabId !== 'string' || typeof r.aliveAt !== 'number') return null;
  if (r.bootId !== null && typeof r.bootId !== 'string') return null;
  const p: RunPending = { stage: r.stage as number, online: r.online, bootId: (r.bootId as string | null) ?? null, tabId: r.tabId, aliveAt: r.aliveAt };
  if (r.won && typeof r.won === 'object') p.won = r.won as WonStage; // checked against the run in cleanRun
  return p;
}

/** A saved won stage is kept only when the run with it applied is still a run that can exist (else it is dropped). */
function wonProblem(run: ExpeditionRun, won: WonStage): boolean {
  if (!Array.isArray(won.loot) || won.loot.some(g => gearSpecProblem(g)) || typeof won.bossClear !== 'boolean') return true;
  try {
    const next: ExpeditionRun = { ...run, bag: run.bag.map(g => ({ ...g })), bossClears: [...run.bossClears], pending: { ...run.pending! } };
    if (applyStageResult(next, { runId: run.id, stage: run.stage, outcome: 'cleared', ...won }) !== 'cleared') return true;
    return !!runInfoProblem(runToJoin(next), next.stage, next.lock.gear, { debugOk: true, allowComplete: true });
  } catch {
    return true;
  }
}

/** A stored run, re-checked like a join (runInfoProblem; stage 13 = cleared stage 12, waiting for its claim), or null. */
function cleanRun(x: unknown): ExpeditionRun | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const lock = cleanLock(r.lock);
  if (r.v !== 2 || typeof r.id !== 'string' || !RUN_ID_RE.test(r.id) || !lock || !STATUSES.has(r.status as string)) return null;
  if (!Number.isInteger(r.seed) || !Number.isInteger(r.stage)) return null;
  const pending = r.status === 'inStage' ? cleanPending(r.pending) : null;
  if (r.status === 'inStage' && !pending) return null;
  const run: ExpeditionRun = {
    v: 2,
    id: r.id,
    seed: (r.seed as number) >>> 0,
    startStage: r.startStage as number,
    stage: r.stage as number,
    cleared: r.cleared as number,
    bag: Array.isArray(r.bag) ? (r.bag as GearSpec[]).map(g => (gearSpecProblem(g) ? g : cleanSpec(g))) : (r.bag as GearSpec[]),
    carry: (r.carry as ExpeditionRun['carry']) ?? null,
    bossClears: r.bossClears as number[],
    lock,
    status: r.status as ExpeditionRun['status'],
    pending,
  };
  try {
    if (runInfoProblem(runToJoin(run), run.stage, lock.gear, { debugOk: true, allowComplete: true })) return null;
  } catch {
    return null; // malformed nested data (runToJoin copies it)
  }
  if (pending?.won) {
    if (wonProblem(run, pending.won)) delete pending.won;
    else pending.won = { loot: pending.won.loot.map(cleanSpec), carry: pending.won.carry, bossClear: pending.won.bossClear };
  }
  return run;
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

/** 기획 16차: gear / party changes are locked while a run exists (5-4). */
export function stashLocked(s: StashData): boolean {
  return s.run != null;
}

const LOCKED: StashResult = { ok: false, reason: RUN_LOCK_REASON };

/** Wear item uid on charId (it leaves whoever wore it; the piece it replaces goes back to the stash). */
export function equip(s: StashData, charId: string, uid: string): StashResult {
  if (stashLocked(s)) return LOCKED;
  if (!CHAR_IDS.has(charId)) return { ok: false, reason: '알 수 없는 캐릭터' };
  const item = itemByUid(s, uid);
  if (!item) return { ok: false, reason: '없는 장비' };
  const was = wearerOf(s, uid);
  if (was) delete s.equipped[was][item.slot];
  (s.equipped[charId] ??= {})[item.slot] = uid;
  return { ok: true };
}

export function unequip(s: StashData, charId: string, slot: GearSlot): StashResult {
  if (stashLocked(s)) return LOCKED;
  const slots = s.equipped[charId];
  if (!slots?.[slot]) return { ok: false, reason: '빈 칸' };
  delete slots[slot];
  return { ok: true };
}

/** 「버리기」: gone for good (taken off first). */
export function discard(s: StashData, uid: string): StashResult {
  if (stashLocked(s)) return LOCKED;
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
  if (stashLocked(s)) return changed;
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
  if (stashLocked(s)) return LOCKED;
  const p = cleanPreset(preset);
  if (!p) return { ok: false, reason: '편성 오류' };
  s.preset = p;
  return { ok: true };
}

// ─────────────────────────── Debug grants (8-9) ───────────────────────────

/** 「선택 캐릭터 모든 칸 Tn 지급」: a common weapon / armor / charm of that tier, worn at once. */
export function grantSet(s: StashData, charId: string, tier: number): GearItem[] {
  if (stashLocked(s)) return [];
  const t = Math.max(1, Math.min(EXPEDITION_STAGES, Math.floor(tier)));
  const items = addItems(s, BASE_SLOTS.map(slot => ({ slot, tier: t, rarity: 'common' as GearRarity })), t);
  for (const it of items) equip(s, charId, it.uid);
  return items;
}

/** 「원정대 3명 한 벌 지급」. */
export function grantPartySet(s: StashData, partyIds: readonly string[], tier: number): GearItem[] {
  if (stashLocked(s)) return [];
  return partyIds.flatMap(id => grantSet(s, id, tier));
}

/** 「무작위 장비 10개」 (seeded by the stash's next uid, so it is repeatable in tests). */
export function grantRandom(s: StashData, n: number): GearItem[] {
  if (stashLocked(s)) return [];
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
  if (stashLocked(s)) return [];
  const t = RELIC_TIERS.includes(tier) ? tier : 3;
  return addItems(s, RELICS.map(r => ({ slot: 'relic' as GearSlot, tier: t, rarity: r.rarity, relicId: r.id })), t);
}

/** 「보관함 초기화」: everything gone (the expedition party and the unlock flag stay). Refused (same `s`) during a run. */
export function resetStash(s: StashData): StashData {
  if (stashLocked(s)) return s;
  const fresh = emptyStash();
  fresh.preset = s.preset;
  fresh.unlockAll = s.unlockAll;
  return fresh;
}

// ─────────────────────────── The run (기획 16차, 5장 · 10장) ───────────────────────────

/** Floor rewards + 괴담 traces a run carries (they vanish at the claim). */
export function runBuffCount(run: Pick<ExpeditionRun, 'carry'> | null | undefined): number {
  return (run?.carry?.rewards.length ?? 0) + (run?.carry?.goedamTraces.length ?? 0);
}

/** A new run (refused while one exists). */
export function beginRun(s: StashData, run: ExpeditionRun): StashResult {
  if (s.run) return { ok: false, reason: '이미 진행 중인 원정이 있어요' };
  s.run = run;
  return { ok: true };
}

export interface ApplyResultOutcome {
  kind: ApplyKind;
  /** 'failed': how many bag items were lost. */
  lost?: number;
  /** 'cleared': this stage's loot (now in the bag). */
  loot?: GearSpec[];
}

/**
 * A stage result for the stored run (applied once: run id + stage must match). 'failed' ends the run (the bag is
 * lost, equipped gear stays). A clear of stage 12 stays a run here — the caller claims it (claimRun, 「원정 완주!」).
 */
export function applyResult(s: StashData, r: StageResult): ApplyResultOutcome {
  const run = s.run;
  if (!run) return { kind: 'ignored' };
  const lost = run.bag.length;
  const kind = applyStageResult(run, r);
  if (kind === 'failed') {
    s.run = null;
    return { kind, lost };
  }
  return kind === 'cleared' ? { kind, loot: r.loot.map(g => ({ ...g })) } : { kind };
}

export type ClaimResult = { ok: true; items: GearItem[]; buffs: number } | { ok: false; reason: string };

/**
 * 「수령」 (or the automatic claim after stage 12): the whole bag into the stash (fromStage = each item's tier), the
 * run's boss clears recorded, the run gone — one mutation, one save. Refused when there is no run, it is another run,
 * or a stage of it is running (another tab got there first).
 */
export function claimRun(s: StashData, runId: string): ClaimResult {
  const run = s.run;
  if (!run || run.id !== runId || run.status === 'inStage') return { ok: false, reason: RUN_GONE_REASON };
  const items = run.bag.flatMap(g => addItems(s, [g], g.tier));
  for (const st of run.bossClears) recordBossClear(s, st);
  const buffs = runBuffCount(run);
  s.run = null;
  return { ok: true, items, buffs };
}

/** A cancelled first match: a run that cleared nothing simply goes away. True when it did. */
export function dropEmptyRun(s: StashData): boolean {
  if (!s.run || s.run.cleared > 0 || s.run.status === 'inStage') return false;
  s.run = null;
  return true;
}
