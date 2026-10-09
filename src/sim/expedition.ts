// 기획 15차 원정 모드 (docs/expedition.md): one game = one stage. 기획 16차: a stage is ONE floor — a normal stage (waves
// + the 수문장) ends with one floor reward (and maybe a 괴담 room), a boss stage right at the clear; then phase
// 'stageClear' and every player goes back to the 원정 lobby (the run itself lives in src/expedition/run.ts). This file:
// the stage plan (3-1 ~ 3-3), the combat clear (loot) and the stage end, the stage's 괴담 room and 돌발 괴담, the carry
// between stages and the loot rolls. The classic tower reaches this file only through `if (w.expedition)` branches
// (floor.ts, goedam.ts, fieldEvents.ts, game.ts) — see docs/prototype-architecture.md for the list.
// Every roll here is on its own seeded stream (mixSeed(seed, salt, …)) except the wave composition, which uses the run
// rng exactly like a classic floor plan.

import type {
  ExpeditionCarry,
  ExpeditionSetup,
  ExpeditionState,
  FieldEventId,
  FloorPlan,
  GameState,
  GoedamRoomDef,
  CommandResult,
  Tunables,
  WavePlan,
} from '../types';
import { ARENA_BOSS, ARENA_NORMAL, LATE_STAT_GROWTH, ZONES } from '../config';
import { FIELD_EVENTS, GOEDAM_ROOMS, RELICS, getFieldEvent, goedamRoomWeight } from '../data';
import {
  BASE_SLOTS,
  BOSS_RELIC_CHANCE,
  EXPEDITION,
  GEAR_OPTIONS,
  GEAR_RARITIES,
  RELIC_RARITY_WEIGHTS,
  botLoadout,
  clampStage,
  equivFloor,
  isBossStage,
  rarityWeights,
  slotWeights,
  stageTheme,
  type BaseSlot,
  type GearLoadout,
  type GearSpec,
} from '../data/gear';
import { stageZoneIndex } from '../data/stages';
import { fieldEventWindow, type FieldEventPlan } from './fieldEvents';
import { benchMaxHp } from './stats';
import { mixSeed, Rng } from './rng';
import { emit, onRunEnd, type World } from './world';

/** Run-time bookkeeping of an expedition game (World.expedition). The public part is state.expedition. */
export interface ExpeditionRt {
  stage: number;
  firstBossClear: boolean[];
  clearedThisRun: number[];
}

const SALT = 0xe6ed15;
const STREAM = { loot: 1, room: 2, fieldPlan: 3, fieldStart: 4 } as const;

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

// ─────────────────────────── Plan (3-1 ~ 3-3) ───────────────────────────

/** The classic monster multiplier formula, continuous (0.5-floor steps, no rounding). */
export function expeditionStatMult(e: number, growth: number): number {
  const early = Math.min(e, LATE_STAT_GROWTH.from) - 1;
  const late = Math.max(0, e - LATE_STAT_GROWTH.from);
  return 1 + growth * early + growth * LATE_STAT_GROWTH.factor * late;
}

/** A stage's waves: the zone pool (filtered by e), zone.waveSize, the nominal "every gap maxed" schedule (`at`). */
function stageWaves(stage: number, e: number, rng: Rng): WavePlan[] {
  const zone = ZONES[stageZoneIndex(stage)];
  const waveCount = Math.max(1, Math.floor(EXPEDITION.waves[stage - 1] ?? 6));
  const pool = zone.pool.filter(x => (x.from ?? zone.from) <= e);
  const waves: WavePlan[] = [];
  for (let i = 0; i < waveCount; i++) {
    const n = rng.int(zone.waveSize.min, zone.waveSize.max);
    const counts = new Map<string, number>();
    for (let k = 0; k < n; k++) {
      const id = rng.weighted(pool, x => x.weight).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    waves.push({ at: 1 + i * EXPEDITION.waveGap, spawns: [...counts].map(([monsterId, count]) => ({ monsterId, count })) });
  }
  return waves;
}

/**
 * 기획 16차: the one floor of a stage (state.floor is always 1). A boss stage = the zone boss alone (enrage after
 * bossEnrage s); a normal stage = waves (drawn with `rng`, the run rng, like planFloor) with the max gap waveGap, and
 * the 수문장 (STAGE_FOE) as the floor's mid boss.
 */
export function planExpeditionFloor(stage: number, rng: Rng, tunables: Tunables): FloorPlan {
  const s = clampStage(stage);
  const e = equivFloor(s);
  const theme = stageTheme(s);
  const statMult = expeditionStatMult(e, tunables.floorStatGrowth) * (EXPEDITION.stageMult[s - 1] ?? 1);
  const foe = EXPEDITION.foes[s - 1];
  const tag = { stage: s, equivFloor: e };
  if (isBossStage(s)) {
    const t = EXPEDITION.bossEnrage;
    return { floor: 1, kind: 'boss', timeLimit: t, arena: { ...ARENA_BOSS }, statMult, waves: [], bossId: foe, theme, ...tag, bossHpMult: EXPEDITION.bossHp };
  }
  return {
    floor: 1,
    kind: 'normal',
    timeLimit: EXPEDITION.timeLimit,
    arena: { ...ARENA_NORMAL },
    statMult,
    waves: stageWaves(s, e, rng),
    maxGap: EXPEDITION.waveGap,
    midBossId: foe,
    guardian: { monsterId: foe, hpMult: EXPEDITION.guardianHp, atkMult: EXPEDITION.guardianAtk },
    theme,
    ...tag,
  };
}

// ─────────────────────────── Setup (createWorld) ───────────────────────────

/** World.expedition for a setup (null = classic). */
export function expeditionRt(setup: ExpeditionSetup | undefined, players: number): ExpeditionRt | undefined {
  if (!setup) return undefined;
  const fill = <T>(a: T[] | undefined, d: T): T[] => Array.from({ length: players }, (_, i) => a?.[i] ?? d);
  return { stage: clampStage(setup.stage), firstBossClear: fill(setup.firstBossClear, false), clearedThisRun: fill(setup.clearedThisRun, 0) };
}

/** Gear a seat plays with: its own, else (bots) T(stage − 1) commons (7장). */
export function seatGear(isBot: boolean, gear: GearLoadout[] | undefined, stage: number, size: number): GearLoadout[] | undefined {
  if (gear) return gear;
  if (!isBot) return undefined;
  const l = botLoadout(stage);
  return Object.keys(l).length ? Array.from({ length: size }, () => botLoadout(stage)) : undefined;
}

/**
 * After the players exist, before any character is on the field: the public expedition state, and each continuing
 * player's carry (floor rewards, traces, ult charge; HP and cooldowns start fresh).
 */
export function initExpedition(w: World, setup: ExpeditionSetup, humans: boolean[]): void {
  const s = w.state;
  const rt = w.expedition!;
  const seen = new Set<string>();
  s.players.forEach((p, i) => {
    const c = setup.carry?.[i];
    if (!c) return;
    p.rewards = c.rewards.map(r => ({ rewardId: r.rewardId, partyIndex: r.partyIndex }));
    p.goedamTraces = c.goedamTraces.filter(t => t.floorsLeft == null || t.floorsLeft > 0).map(t => ({ id: t.id, floorsLeft: t.floorsLeft }));
    for (const id of c.goedamSeen ?? []) seen.add(id);
    p.party.forEach((m, idx) => {
      const v = Math.max(0, Math.min(1, c.ult[idx] ?? 0));
      m.ult.charge = v >= 1 - 1e-9 ? 1 : v;
      m.ult.fullSince = m.ult.charge >= 1 ? 0 : null;
      // carried +max-HP rewards / traces raise the cap; the stage still starts at full HP
      m.maxHp = benchMaxHp(p, idx);
      m.hp = m.maxHp;
    });
  });
  w.goedam.seen.push(...seen);
  const state: ExpeditionState = {
    stage: rt.stage,
    boss: isBossStage(rt.stage),
    outcome: 'running',
    loot: s.players.map(() => []),
    humans: humans.slice(),
    goedamSeen: [...seen],
  };
  s.expedition = state;
}

// ─────────────────────────── Clear → stage end (기획 16차) ───────────────────────────

/**
 * floorClear, after the heal (where the classic tower checks the last floor): the combat is won — the clear is final
 * from here (a quit during the reward / room is still a clear). Loot is rolled per human now. True = a boss stage: the
 * game is over at once (phase 'stageClear', no floor reward); false = a normal stage goes on to the usual reward phase
 * and ends in finishRewardIfDone / finishGoedamIfDone (→ enterStageEnd).
 */
export function expeditionCombatClear(w: World): boolean {
  const s = w.state;
  const ex = s.expedition!;
  const rt = w.expedition!;
  ex.outcome = 'cleared';
  ex.loot = s.players.map((p, i) => (ex.humans[i] ? rollStageLoot(s.seed, rt.stage, i, p.gear ?? [], rt.firstBossClear[i], rt.clearedThisRun[i]) : []));
  emit(w, { type: 'stageClear', stage: rt.stage });
  if (s.plan.kind !== 'boss') return false;
  enterStageEnd(w);
  return true;
}

/** The stage is over and won: terminal phase 'stageClear' (time frozen). Each player's result: stageResultFromState. */
export function enterStageEnd(w: World): void {
  const s = w.state;
  if (s.phase === 'stageClear' || s.phase === 'runOver') return;
  s.phase = 'stageClear';
  s.rewardOffers = null;
  s.rewardOffersByPlayer = s.players.map(() => null);
  w.humanOffers = null;
  s.goedam = null;
  s.runResult = { outcome: 'victory', reason: 'cleared', floorReached: s.floor, duration: s.time };
}

/** Is this an expedition stage whose combat is already won (a quit / drop now still counts as a clear)? */
export function expeditionWon(w: World): boolean {
  return !!w.expedition && w.state.expedition?.outcome === 'cleared';
}

// A wipe / timeout / quit before the clear loses the stage (and the unclaimed bag).
onRunEnd(w => {
  const ex = w.state.expedition;
  if (ex && ex.outcome === 'running') ex.outcome = 'failed';
});

/**
 * Player pi's result of a finished stage, read from the public state (solo controller, server): the loot, the carry
 * for the next stage and whether it was a boss stage. Null unless the stage is over and won (phase 'stageClear').
 */
export function stageResultFromState(s: GameState, pi: number): { loot: GearSpec[]; carry: ExpeditionCarry; bossClear: boolean } | null {
  const ex = s.expedition;
  if (!ex || s.phase !== 'stageClear' || ex.outcome !== 'cleared' || !s.players[pi]) return null;
  return { loot: (ex.loot[pi] ?? []).map(g => ({ ...g })), carry: extractCarry(s, pi), bossClear: ex.boss };
}

/**
 * 기획 16차: player pi's result once the combat is won but the stage is not over yet (floor reward / 괴담 room open).
 * What a drop now would give (as on the server, where the seat's bot finishes): the loot, the carry with the open
 * floor reward picked (a seeded choice among its non-relic offers), the room passed. Null before the clear. The solo
 * controller saves it with the run so a reload / tab kill after the win still counts as a clear (5-3).
 */
export function wonResultFromState(s: GameState, pi: number): { loot: GearSpec[]; carry: ExpeditionCarry; bossClear: boolean } | null {
  const ex = s.expedition;
  if (!ex || ex.outcome !== 'cleared' || !s.players[pi] || s.phase === 'runOver') return null;
  const done = stageResultFromState(s, pi);
  if (done) return done;
  const carry = extractCarry(s, pi);
  const offers = (s.rewardOffersByPlayer[pi] ?? []).filter(o => !o.isRelic);
  if (offers.length > 0) {
    const o = offers[((s.seed >>> 0) + pi) % offers.length];
    carry.rewards.push({ rewardId: o.rewardId, partyIndex: o.partyIndex });
  }
  return { loot: (ex.loot[pi] ?? []).map(g => ({ ...g })), carry, bossClear: ex.boss };
}

// ─────────────────────────── Carry (7장) ───────────────────────────

/** What player pi takes into the next stage (call at 'stageClear'): rewards, traces left, ult charges, rooms seen. */
export function extractCarry(s: GameState, pi: number): ExpeditionCarry {
  const p = s.players[pi];
  const seen = new Set(s.expedition?.goedamSeen ?? []);
  for (const g of p.goedamLog) seen.add(g.roomId);
  return {
    rewards: p.rewards.map(r => ({ rewardId: r.rewardId, partyIndex: r.partyIndex })),
    goedamTraces: p.goedamTraces.filter(t => t.floorsLeft == null || t.floorsLeft > 0).map(t => ({ id: t.id, floorsLeft: t.floorsLeft })),
    ult: p.party.map(m => m.ult.charge),
    goedamSeen: [...seen],
  };
}

// ─────────────────────────── Debug ───────────────────────────

/** Debug 'expeditionClearStage': only while the stage's combat runs. */
export function canDebugClearStage(w: World): CommandResult {
  if (!w.expedition || !w.state.expedition) return fail('원정이 아님');
  if (w.state.phase !== 'combat') return fail('전투 중이 아님');
  return ok;
}

// ─────────────────────────── 괴담 room (3-2) ───────────────────────────

function usesRelicEffect(r: GoedamRoomDef): boolean {
  return r.options.some(o => [...(o.cost ?? []), ...o.outcomes.flatMap(x => x.effects)].some(e => e.kind === 'relic'));
}

/**
 * The room after a normal stage's floor reward (기획 16차: roomChance 0.2; never after a boss stage; 저주받은 유물 never;
 * a room never comes twice per run), or null.
 */
export function expeditionRoomAfter(w: World): GoedamRoomDef | null {
  const s = w.state;
  const rt = w.expedition!;
  if (s.plan.kind !== 'normal') return null;
  const chance = Math.min(1, EXPEDITION.roomChance * Math.max(0, w.tunables.goedamRoomsPerZone));
  const rng = new Rng(mixSeed(s.seed, SALT, STREAM.room, rt.stage));
  if (!(chance > 0) || !rng.chance(chance)) return null;
  const theme = stageTheme(rt.stage);
  const e = Math.floor(equivFloor(rt.stage));
  const cands = GOEDAM_ROOMS.filter(r => r.zone === theme && !usesRelicEffect(r) && !w.goedam.seen.includes(r.id));
  if (cands.length === 0) return null;
  const fit = cands.filter(r => goedamRoomWeight(r, e, theme) > 0);
  return fit.length ? rng.weighted(fit, r => goedamRoomWeight(r, e, theme)) : rng.weighted(cands, r => r.weight);
}

// ─────────────────────────── 돌발 괴담 (3-2) ───────────────────────────

/**
 * 기획 16차: this stage's event — normal stages only, stage 1 = the toad for sure, else EXPEDITION.fieldEventChance on
 * the stage's own stream. The tunable fieldEventChance only switches them off (0). `prev` = the event planned before
 * (never the same twice in a row; with one floor per stage it is always null today). Its start lies in
 * fieldEventWindow (the spawner holds the last wave while it runs, so it always ends before the clear).
 */
export function planExpeditionFieldEvent(w: World, prev: FieldEventId | null): FieldEventPlan | null {
  const s = w.state;
  const rt = w.expedition!;
  if (s.plan.kind !== 'normal' || !(w.tunables.fieldEventChance > 0)) return null;
  let id: FieldEventId;
  if (rt.stage === 1) id = 'lucky_toad';
  else {
    const rng = new Rng(mixSeed(s.seed, SALT, STREAM.fieldPlan, rt.stage));
    if (!rng.chance(EXPEDITION.fieldEventChance)) return null;
    const theme = s.plan.theme ?? stageTheme(rt.stage);
    const e = s.plan.equivFloor ?? equivFloor(rt.stage);
    const cands = FIELD_EVENTS.filter(d => d.from <= Math.max(2, e) && d.weights[theme] > 0 && d.id !== prev);
    if (cands.length === 0) return null;
    id = rng.weighted(cands, d => d.weights[theme]).id;
  }
  const win = fieldEventWindow(getFieldEvent(id), s.plan);
  if (!win) return null;
  const startAt = new Rng(mixSeed(s.seed, SALT, STREAM.fieldStart, rt.stage)).range(win[0], win[1]);
  return { floor: s.floor, id, startAt, latest: win[1] };
}

// ─────────────────────────── Loot (4-5) ───────────────────────────

/** The loot stream of (seed, stage, player): never the run rng, so loot never perturbs combat. */
export function lootRng(seed: number, stage: number, pi: number): Rng {
  return new Rng(mixSeed(seed, SALT, STREAM.loot, stage, pi));
}

function rollBase(rng: Rng, party: readonly (GearLoadout | null | undefined)[], tier: number, boss: boolean, cleared: number): GearSpec {
  const sw = slotWeights(party, tier);
  const slot = rng.weighted(BASE_SLOTS, (x: BaseSlot) => sw[x]);
  const rw = rarityWeights(tier, boss, cleared);
  const rarity = rng.weighted(GEAR_RARITIES, r => rw[r]);
  const spec: GearSpec = { slot, tier, rarity };
  if (rarity !== 'common') spec.optionId = rng.pick(GEAR_OPTIONS.filter(o => o.slot === slot)).id;
  return spec;
}

/**
 * A player's loot for clearing `stage` (tier = stage, 기획 16차): EXPEDITION.lootNormal base items on a normal stage
 * (slot leaning to what the party lacks); on a boss stage lootBossBase base items + the boss box — a relic for sure on
 * the first clear, else BOSS_RELIC_CHANCE, else 1 more base item.
 */
export function rollStageLoot(
  seed: number,
  stage: number,
  pi: number,
  party: readonly (GearLoadout | null | undefined)[],
  firstBossClear: boolean,
  clearedThisRun: number,
): GearSpec[] {
  const s = clampStage(stage);
  const rng = lootRng(seed, s, pi);
  const boss = isBossStage(s);
  const base = Math.max(0, Math.floor(boss ? EXPEDITION.lootBossBase : EXPEDITION.lootNormal));
  const out: GearSpec[] = [];
  for (let i = 0; i < base; i++) out.push(rollBase(rng, party, s, boss, clearedThisRun));
  if (!boss) return out;
  if (firstBossClear || rng.chance(BOSS_RELIC_CHANCE[s] ?? 0)) {
    const r = rng.weighted(RELICS, x => RELIC_RARITY_WEIGHTS[x.rarity]);
    out.push({ slot: 'relic', tier: s, rarity: r.rarity, relicId: r.id });
  } else out.push(rollBase(rng, party, s, boss, clearedThisRun));
  return out;
}
