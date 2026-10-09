// 기획 15차 원정 모드 (docs/expedition.md): one game = one stage of 3 floors. Floor plans (3-1 ~ 3-3), the stage clear
// ('stageClear' phase, loot, 수령 / 도전 choices), the stage's 괴담 room and 돌발 괴담, the carry between stages and the
// loot rolls. The classic tower reaches this file only through `if (w.expedition)` branches (floor.ts, goedam.ts,
// fieldEvents.ts, game.ts) — see docs/prototype-architecture.md for the list.
// Every roll here is on its own seeded stream (mixSeed(seed, salt, …)) except the wave composition, which uses the run
// rng exactly like a classic floor plan.

import type {
  ExpeditionCarry,
  ExpeditionChoice,
  ExpeditionSetup,
  ExpeditionState,
  FieldEventId,
  FloorPlan,
  GameState,
  GoedamRoomDef,
  Command,
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

export const STAGE_FLOORS = 3;

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

// ─────────────────────────── Plan (3-1 ~ 3-3) ───────────────────────────

/** The classic monster multiplier formula, continuous (0.5-floor steps, no rounding). */
export function expeditionStatMult(e: number, growth: number): number {
  const early = Math.min(e, LATE_STAT_GROWTH.from) - 1;
  const late = Math.max(0, e - LATE_STAT_GROWTH.from);
  return 1 + growth * early + growth * LATE_STAT_GROWTH.factor * late;
}

/** One stage floor. Waves are drawn with `rng` (the run rng, like planFloor); floor 3 = guardian floor or the zone boss. */
export function planExpeditionFloor(stage: number, stageFloor: number, rng: Rng, tunables: Tunables): FloorPlan {
  const s = clampStage(stage);
  const j = Math.max(1, Math.min(STAGE_FLOORS, Math.floor(stageFloor)));
  const e = equivFloor(s, j);
  const zone = ZONES[stageZoneIndex(s)];
  const theme = stageTheme(s);
  const statMult = expeditionStatMult(e, tunables.floorStatGrowth) * (EXPEDITION.stageMult[s - 1] ?? 1);
  const mids = EXPEDITION.mids[s - 1];
  const tag = { stage: s, stageFloor: j, equivFloor: e };
  if (j === STAGE_FLOORS && isBossStage(s)) {
    const t = EXPEDITION.bossEnrage;
    return { floor: j, kind: 'boss', timeLimit: t, arena: { ...ARENA_BOSS }, statMult, waves: [], bossId: mids[2], theme, ...tag, bossHpMult: EXPEDITION.bossHp };
  }
  const waveCount = Math.max(1, Math.floor(EXPEDITION.waves[j - 1] ?? 6));
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
  const timeLimit = EXPEDITION.timeLimit[j - 1] ?? tunables.normalFloorTime;
  const plan: FloorPlan = { floor: j, kind: 'normal', timeLimit, arena: { ...ARENA_NORMAL }, statMult, waves, midBossId: mids[j - 1], theme, ...tag };
  if (j === STAGE_FLOORS) {
    plan.guardian = { monsterId: mids[2], hpMult: EXPEDITION.guardianHp, atkMult: EXPEDITION.guardianAtk, at: EXPEDITION.guardianAt };
    plan.midBossId = mids[2];
  }
  return plan;
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
    stageFloor: 1,
    boss: isBossStage(rt.stage),
    outcome: 'running',
    loot: s.players.map(() => []),
    choices: s.players.map(() => null),
    humans: humans.slice(),
    goedamSeen: [...seen],
  };
  s.expedition = state;
}

// ─────────────────────────── Floor hooks ───────────────────────────

/** startFloor: keep the read model's floor in step. */
export function noteExpeditionFloor(w: World): void {
  if (w.state.expedition) w.state.expedition.stageFloor = w.state.floor;
}

/**
 * floorClear, after the heal (where the classic tower checks the last floor): floor 3 → the stage is cleared. True =
 * the game is over for this stage (phase 'stageClear'); false = floors 1–2 go on to the usual reward.
 */
export function expeditionFloorClear(w: World): boolean {
  const s = w.state;
  if (s.floor < STAGE_FLOORS) return false;
  stageClear(w);
  return true;
}

function stageClear(w: World): void {
  const s = w.state;
  const ex = s.expedition!;
  const rt = w.expedition!;
  s.phase = 'stageClear';
  ex.outcome = 'cleared';
  ex.stageFloor = s.floor;
  s.rewardOffers = null;
  s.rewardOffersByPlayer = s.players.map(() => null);
  w.humanOffers = null;
  s.goedam = null;
  s.runResult = { outcome: 'victory', reason: 'cleared', floorReached: s.floor, duration: s.time };
  ex.loot = s.players.map((p, i) => (ex.humans[i] ? rollStageLoot(s.seed, rt.stage, i, p.gear ?? [], rt.firstBossClear[i], rt.clearedThisRun[i]) : []));
  emit(w, { type: 'stageClear', stage: rt.stage });
  for (const p of s.players) if (p.isBot) setChoice(w, p.id, 'extract', true);
}

// A wipe / timeout / quit loses the stage (and the unclaimed bag).
onRunEnd(w => {
  const ex = w.state.expedition;
  if (ex && ex.outcome === 'running') ex.outcome = 'failed';
});

// ─────────────────────────── Choice (5장) ───────────────────────────

function setChoice(w: World, pi: number, choice: ExpeditionChoice, auto: boolean): void {
  const ex = w.state.expedition!;
  if (ex.choices[pi] != null) return;
  ex.choices[pi] = choice;
  emit(w, { type: 'expeditionChoice', player: pi, choice, auto });
}

/** Pure check over the public state (the sim and a multiplayer client agree). */
export function canExpeditionChoiceState(s: GameState, pi: number, choice: unknown): CommandResult {
  const ex = s.expedition;
  if (!ex || s.phase !== 'stageClear') return fail('단계 클리어가 아님');
  if (!Number.isInteger(pi) || pi < 0 || pi >= s.players.length) return fail('잘못된 대상');
  if (choice !== 'extract' && choice !== 'continue') return fail('잘못된 선택');
  if (ex.choices[pi] != null) return fail('이미 골랐음');
  return ok;
}

/** Command 'expeditionChoice'. */
export function expeditionChoice(w: World, pi: number, choice: ExpeditionChoice): CommandResult {
  const r = canExpeditionChoiceState(w.state, pi, choice);
  if (r.ok) setChoice(w, pi, choice, false);
  return r;
}

/** A seat that turns bot (disconnect) at / after the clear takes the safe side: 수령하고 나가기. */
export function autoExpeditionChoice(w: World, pi: number): void {
  if (w.state.phase === 'stageClear' && w.state.expedition) setChoice(w, pi, 'extract', true);
}

/** Everyone has chosen (bots at once). */
export function expeditionDecided(s: GameState): boolean {
  return !!s.expedition && s.phase === 'stageClear' && s.expedition.choices.every(c => c != null);
}

/** The server's 20 s choice deadline: 'extract' for whoever has not chosen. Pure. */
export function expeditionChoiceTimeoutCommands(s: GameState): Command[] {
  if (!s.expedition || s.phase !== 'stageClear') return [];
  const out: Command[] = [];
  s.expedition.choices.forEach((c, player) => {
    if (c == null) out.push({ type: 'expeditionChoice', player, choice: 'extract' });
  });
  return out;
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

/** Debug 'expeditionClearStage': jump to floor 3 and clear it at once. */
export function canDebugClearStage(w: World): CommandResult {
  if (!w.expedition || !w.state.expedition) return fail('원정이 아님');
  if (w.state.phase === 'runOver' || w.state.phase === 'stageClear') return fail('이미 끝남');
  return ok;
}

// ─────────────────────────── 괴담 room (3-2) ───────────────────────────

function usesRelicEffect(r: GoedamRoomDef): boolean {
  return r.options.some(o => [...(o.cost ?? []), ...o.outcomes.flatMap(x => x.effects)].some(e => e.kind === 'relic'));
}

/** The room after stage floor `floor` (only floor 1, roomChance; 저주받은 유물 never), or null. */
export function expeditionRoomAfter(w: World, floor: number): GoedamRoomDef | null {
  const s = w.state;
  const rt = w.expedition!;
  if (floor !== 1) return null;
  const chance = Math.min(1, EXPEDITION.roomChance * Math.max(0, w.tunables.goedamRoomsPerZone));
  const rng = new Rng(mixSeed(s.seed, SALT, STREAM.room, rt.stage));
  if (!(chance > 0) || !rng.chance(chance)) return null;
  const theme = stageTheme(rt.stage);
  const e = Math.floor(equivFloor(rt.stage, floor));
  const cands = GOEDAM_ROOMS.filter(r => r.zone === theme && !usesRelicEffect(r) && !w.goedam.seen.includes(r.id));
  if (cands.length === 0) return null;
  const fit = cands.filter(r => goedamRoomWeight(r, e, theme) > 0);
  return fit.length ? rng.weighted(fit, r => goedamRoomWeight(r, e, theme)) : rng.weighted(cands, r => r.weight);
}

// ─────────────────────────── 돌발 괴담 (3-2) ───────────────────────────

/**
 * This stage floor's event: floors 1–2 at EXPEDITION.fieldEventChance (stage 1 floor 2 = the toad), never floor 3.
 * The tunable fieldEventChance only switches them off (0). `prev` = the event of the floor before (no repeat).
 */
export function planExpeditionFieldEvent(w: World, prev: FieldEventId | null): FieldEventPlan | null {
  const s = w.state;
  const rt = w.expedition!;
  if (s.plan.kind !== 'normal' || s.floor >= STAGE_FLOORS || !(w.tunables.fieldEventChance > 0)) return null;
  let id: FieldEventId | null = null;
  if (rt.stage === 1 && s.floor === 2) id = 'lucky_toad';
  else {
    const rng = new Rng(mixSeed(s.seed, SALT, STREAM.fieldPlan, rt.stage, s.floor));
    if (!rng.chance(EXPEDITION.fieldEventChance)) return null;
    const theme = s.plan.theme ?? stageTheme(rt.stage);
    const e = s.plan.equivFloor ?? equivFloor(rt.stage, s.floor);
    const beforeBoss = isBossStage(rt.stage) && s.floor === STAGE_FLOORS - 1;
    const cands = FIELD_EVENTS.filter(d => d.from <= Math.max(2, e) && d.weights[theme] > 0 && d.id !== prev && !(beforeBoss && d.notBeforeBoss));
    if (cands.length === 0) return null;
    id = rng.weighted(cands, d => d.weights[theme]).id;
  }
  const win = fieldEventWindow(getFieldEvent(id), s.plan);
  if (!win) return null;
  const startAt = new Rng(mixSeed(s.seed, SALT, STREAM.fieldStart, rt.stage, s.floor)).range(win[0], win[1]);
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
 * A player's loot for clearing `stage` (tier = stage): 2 base items (slot leaning to what the party lacks), and on a
 * boss stage the boss box — a relic for sure on the first clear, else BOSS_RELIC_CHANCE, else 1 more base item.
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
  const out: GearSpec[] = [rollBase(rng, party, s, boss, clearedThisRun), rollBase(rng, party, s, boss, clearedThisRun)];
  if (!boss) return out;
  if (firstBossClear || rng.chance(BOSS_RELIC_CHANCE[s] ?? 0)) {
    const r = rng.weighted(RELICS, x => RELIC_RARITY_WEIGHTS[x.rarity]);
    out.push({ slot: 'relic', tier: s, rarity: r.rarity, relicId: r.id });
  } else out.push(rollBase(rng, party, s, boss, clearedThisRun));
  return out;
}
