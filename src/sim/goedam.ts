// 기획 10차: 층 사이 괴담 방 「이상한 방」 (docs/goedam-rooms.md) — schedule, open, choose, continue, auto-resolve, traces.
// Rooms roll only on their own streams (mixSeed(seed, salt, floor, player)), never on w.rng: with the slider at 0 or
// everyone leaving, a run is bit-identical to one without rooms (only the 수첩 differs).

import type {
  Command,
  CommandResult,
  GameState,
  GoedamEffect,
  GoedamOptionDef,
  GoedamOutcome,
  GoedamOutcomeDef,
  GoedamParams,
  GoedamProgress,
  GoedamRoomDef,
} from '../types';
import { ZONES, zoneOf, type ZoneDef } from '../config';
import {
  GOEDAM_ANOMALIES,
  GOEDAM_ANOMALY_CHANCE,
  GOEDAM_RELIC_FALLBACK,
  GOEDAM_ROOMS,
  RARITY_WEIGHTS,
  RELICS,
  getGoedamRoom,
  getGoedamTrace,
  getReward,
  goedamLabel,
  goedamRoomWeight,
} from '../data';
import { heal } from './combat';
import { refreshMaxHp, revive, syncMembers } from './players';
import { addUltCharge, setUltCharge } from './ultMode';
import { resetSwapCooldowns } from './energy';
import { drawOne, grantReward } from './rewards';
import { mixSeed, Rng } from './rng';
import { emit, getEntity, type SimPlayer, type World } from './world';

const SALT = 0x60eda3;
const STREAM = { schedule: 1, forced: 2, params: 3, roll: 4 } as const;

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** A room's own rng for one purpose (+ floor + player): results never depend on click order or the run rng. */
export function goedamRng(seed: number, stream: number, floor = 0, player = 0): Rng {
  return new Rng(mixSeed(seed, SALT, stream, floor, player));
}

// ─────────────────────────── Schedule ───────────────────────────

export interface GoedamSlot {
  floor: number;
  roomId: string;
}

/** Floors of a zone a room may follow: never floor 1 (learn the reward first), a boss floor or the last floor. */
export function goedamFloorsOf(zone: ZoneDef): number[] {
  const last = ZONES[ZONES.length - 1].to;
  const out: number[] = [];
  for (let f = zone.from; f <= zone.to; f++) if (f > 1 && f % 5 !== 0 && f < last) out.push(f);
  return out;
}

/** Every set of n floors out of `floors` with no two in a row. */
function spacedSets(floors: number[], n: number): number[][] {
  const sets: number[][] = [];
  const walk = (from: number, acc: number[]) => {
    if (acc.length === n) return void sets.push(acc);
    for (let i = from; i < floors.length; i++) {
      if (acc.length === 0 || floors[i] - acc[acc.length - 1] > 1) walk(i + 1, [...acc, floors[i]]);
    }
  };
  walk(0, []);
  return sets;
}

/** k floors (fewer if they cannot be spaced), every allowed set equally likely. */
function pickFloors(rng: Rng, floors: number[], k: number): number[] {
  for (let n = k; n > 0; n--) {
    const sets = spacedSets(floors, n);
    if (sets.length) return rng.pick(sets);
  }
  return [];
}

/**
 * The run's rooms (pure: seed + rooms per zone): `perZone` floors per zone picked by seed, then a room for each by
 * weight among the ones that fit that floor and were not used yet. A slot with no candidate is skipped.
 */
export function goedamSchedule(seed: number, perZone: number, rooms: readonly GoedamRoomDef[] = GOEDAM_ROOMS): GoedamSlot[] {
  const k = Math.max(0, Math.min(2, Math.round(perZone)));
  if (k === 0) return [];
  const rng = goedamRng(seed, STREAM.schedule);
  const used = new Set<string>();
  const out: GoedamSlot[] = [];
  for (const zone of ZONES) {
    for (const floor of pickFloors(rng, goedamFloorsOf(zone), k)) {
      const cands = rooms.filter(r => !used.has(r.id) && goedamRoomWeight(r, floor, zone.theme) > 0);
      if (cands.length === 0) continue;
      const room = rng.weighted(cands, r => goedamRoomWeight(r, floor, zone.theme));
      used.add(room.id);
      out.push({ floor, roomId: room.id });
    }
  }
  return out;
}

function usesEffect(room: GoedamRoomDef, kind: GoedamEffect['kind']): boolean {
  return room.options.some(o => [...(o.cost ?? []), ...o.outcomes.flatMap(x => x.effects)].some(e => e.kind === kind));
}

/** 저주받은 유물 only opens when someone still lacks a relic. */
function fitsNow(w: World, room: GoedamRoomDef): boolean {
  return !usesEffect(room, 'relic') || w.state.players.some(p => RELICS.some(r => !p.relics.includes(r.id)));
}

/** Debug 'goedamNext': that room, else one that fits this floor (unseen first, then any of the zone, then any). */
function forcedRoom(w: World, floor: number, wanted: string): GoedamRoomDef {
  if (wanted) return getGoedamRoom(wanted);
  const theme = zoneOf(floor).theme;
  const weight = (r: GoedamRoomDef) => goedamRoomWeight(r, floor, theme);
  const fresh = GOEDAM_ROOMS.filter(r => !w.goedam.seen.includes(r.id) && fitsNow(w, r));
  const tiers = [fresh.filter(r => weight(r) > 0), fresh.filter(r => r.zone === theme), fresh, GOEDAM_ROOMS];
  const cands = tiers.find(t => t.length > 0)!;
  const rng = goedamRng(w.state.seed, STREAM.forced, floor);
  return rng.weighted(cands, r => Math.max(weight(r), 0.01));
}

/** The room after the floor just cleared, or null. */
function roomAfter(w: World, floor: number): GoedamRoomDef | null {
  const forced = w.goedam.forced;
  w.goedam.forced = null;
  if (forced != null) return forcedRoom(w, floor, forced);
  const slot = goedamSchedule(w.state.seed, w.tunables.goedamRoomsPerZone).find(x => x.floor === floor);
  if (!slot || w.goedam.seen.includes(slot.roomId)) return null;
  const room = getGoedamRoom(slot.roomId);
  return fitsNow(w, room) ? room : null;
}

// ─────────────────────────── Open ───────────────────────────

/** Most recent common/rare reward (원본을 넣어 주세요). */
function lastCopyable(p: SimPlayer): GoedamParams['copy'] {
  for (let i = p.rewards.length - 1; i >= 0; i--) {
    const r = p.rewards[i];
    if (getReward(r.rewardId).rarity !== 'epic') return { rewardId: r.rewardId, partyIndex: r.partyIndex };
  }
  return null;
}

function newProgress(w: World, room: GoedamRoomDef, p: SimPlayer): GoedamProgress {
  const rng = goedamRng(w.state.seed, STREAM.params, w.state.floor, p.id);
  const params: GoedamParams = {};
  if (usesEffect(room, 'relic')) {
    const missing = RELICS.filter(r => !p.relics.includes(r.id));
    params.relicId = missing.length ? rng.weighted(missing, r => RARITY_WEIGHTS[r.rarity]).id : null;
  }
  if (usesEffect(room, 'copyReward')) params.copy = lastCopyable(p);
  if (room.options.some(o => o.outcomes.some(x => x.when))) {
    params.anomaly = rng.chance(GOEDAM_ANOMALY_CHANCE) ? rng.pick(GOEDAM_ANOMALIES) : null;
  }
  const options = room.options.map(o => ({ id: o.id, hidden: o.needs === 'copy' && !params.copy }));
  return { stage: 'choosing', options, params, choice: null, outcome: null };
}

/**
 * After the reward phase: open the scheduled (or debug-forced) room for everyone. Bots leave at once.
 * Returns true while someone still has to choose / read their result (phase 'goedam'); false = go to the next floor.
 */
export function openGoedamRoom(w: World): boolean {
  const s = w.state;
  const room = roomAfter(w, s.floor);
  if (!room) return false;
  w.goedam.seen.push(room.id);
  s.phase = 'goedam';
  s.goedam = { roomId: room.id, floor: s.floor, label: goedamLabel(s.floor), players: s.players.map(p => newProgress(w, room, p)) };
  emit(w, { type: 'goedamOpen', floor: s.floor, roomId: room.id });
  for (const p of s.players) if (p.isBot) autoResolveGoedam(w, p.id);
  return !goedamAllDone(s);
}

export function goedamAllDone(s: GameState): boolean {
  return !!s.goedam && s.goedam.players.every(x => x.stage === 'done');
}

// ─────────────────────────── Choose / continue ───────────────────────────

/** Pure check over the public state (sim and the multiplayer client agree): option id or 'continue'. */
export function canGoedamState(s: GameState, pi: number, option: string): CommandResult {
  if (s.phase !== 'goedam' || !s.goedam) return fail('괴담 방이 아님');
  const pr = Number.isInteger(pi) ? s.goedam.players[pi] : undefined;
  if (!pr) return fail('잘못된 대상');
  if (option === 'continue') return pr.stage === 'result' ? ok : fail(pr.stage === 'choosing' ? '먼저 고르세요' : '이미 끝남');
  if (pr.stage !== 'choosing') return fail('이미 골랐음');
  const slot = typeof option === 'string' ? pr.options.find(o => o.id === option) : undefined;
  return slot && !slot.hidden ? ok : fail('잘못된 선택');
}

/** Command 'goedam': pick an option (fixed cost → roll on the room rng → outcome stored) or 'continue'. */
export function chooseGoedam(w: World, pi: number, option: string): CommandResult {
  const r = canGoedamState(w.state, pi, option);
  if (!r.ok) return r;
  const pr = w.state.goedam!.players[pi];
  if (option === 'continue') pr.stage = 'done';
  else resolve(w, w.state.players[pi], pr, option, w.state.players[pi].isBot);
  return ok;
}

/** Bot / disconnect / timeout: 'leave' if not chosen yet, then continue. Never rolls anything. */
export function autoResolveGoedam(w: World, pi: number): void {
  const pr = w.state.goedam?.players[pi];
  if (!pr) return;
  if (pr.stage === 'choosing') resolve(w, w.state.players[pi], pr, 'leave', true);
  pr.stage = 'done';
}

/**
 * Server room deadline (25 s): the commands that finish the room for everyone still in it — 'leave' for whoever has
 * not chosen, 'continue' for whoever is reading a result. Pure over the public state.
 */
export function goedamTimeoutCommands(s: GameState): Command[] {
  const out: Command[] = [];
  if (s.phase !== 'goedam' || !s.goedam) return out;
  s.goedam.players.forEach((pr, player) => {
    if (pr.stage === 'choosing') out.push({ type: 'goedam', player, option: 'leave' });
    if (pr.stage !== 'done') out.push({ type: 'goedam', player, option: 'continue' });
  });
  return out;
}

function pickOutcome(o: GoedamOptionDef, params: GoedamParams, rng: Rng): GoedamOutcomeDef {
  if (o.outcomes.some(x => x.when)) {
    const seen = params.anomaly ? 'anomaly' : 'normal';
    return o.outcomes.find(x => x.when === seen) ?? o.outcomes[0];
  }
  let r = rng.next();
  for (const x of o.outcomes) {
    r -= x.chance ?? 0;
    if (r < 0) return x;
  }
  return o.outcomes[o.outcomes.length - 1];
}

function resolve(w: World, p: SimPlayer, pr: GoedamProgress, optionId: string, auto: boolean): void {
  const g = w.state.goedam!;
  const o = getGoedamRoom(g.roomId).options.find(x => x.id === optionId)!;
  const rng = goedamRng(w.state.seed, STREAM.roll, g.floor, p.id);
  const outcome: GoedamOutcome = { id: '', reward: null, relicId: null, traces: [] };
  for (const e of o.cost ?? []) applyEffect(w, p, e, pr.params, rng, outcome);
  const out = pickOutcome(o, pr.params, rng);
  outcome.id = out.id;
  for (const e of out.effects) applyEffect(w, p, e, pr.params, rng, outcome);
  syncMembers(w);
  pr.choice = optionId;
  pr.outcome = outcome;
  pr.stage = 'result';
  p.goedamLog.push({ floor: g.floor, label: g.label, roomId: g.roomId, optionId, outcome: { ...outcome, traces: [...outcome.traces] }, auto });
  emit(w, { type: 'goedamOutcome', player: p.id, optionId, outcomeId: out.id, tone: out.tone });
}

// ─────────────────────────── Effects (my party only; never kill) ───────────────────────────

function applyEffect(w: World, p: SimPlayer, e: GoedamEffect, params: GoedamParams, rng: Rng, out: GoedamOutcome): void {
  switch (e.kind) {
    case 'hpLoss':
      return loseHp(w, p, e.pct);
    case 'heal':
      return healParty(w, p, e.pct);
    case 'revive': {
      let n = 0;
      p.party.forEach((m, idx) => {
        if (!m.dead) return;
        revive(w, p, idx);
        m.hp = Math.max(1, m.maxHp * e.hpFrac);
        n++;
      });
      out.revived = n; // 0: the result card drops '쓰러진 캐릭터 부활'
      return;
    }
    case 'ultSet':
      return setUltCharge(w, p, e.value);
    case 'ultAdd':
      return addUltCharge(w, p, e.value); // 기획 14차: the field character's gauge in per-character mode
    case 'resetCooldowns':
      for (const pet of p.pets) pet.cooldownRemaining = 0;
      if (!e.petsOnly) {
        for (const m of p.party) m.normalCooldownRemaining = 0;
        resetSwapCooldowns(p); // 기획 14차 교체 에너지: a full pool instead
      }
      return;
    case 'reward':
      return giveReward(w, p, drawOne(rng, p, e.weights), out);
    case 'rewardFixed':
      return giveReward(w, p, { rewardId: e.rewardId, partyIndex: null }, out);
    case 'copyReward':
      return giveReward(w, p, params.copy ?? null, out);
    case 'relic':
      if (params.relicId && !p.relics.includes(params.relicId)) {
        p.relics.push(params.relicId);
        out.relicId = params.relicId;
      } else giveReward(w, p, drawOne(rng, p, GOEDAM_RELIC_FALLBACK), out); // owns every relic: a reward instead
      return;
    case 'trace':
      addGoedamTrace(w, p, e.traceId);
      out.traces.push(e.traceId);
      return;
  }
}

function giveReward(w: World, p: SimPlayer, r: GoedamOutcome['reward'], out: GoedamOutcome): void {
  if (!r) return;
  grantReward(w, p, r.rewardId, r.partyIndex);
  out.reward = { rewardId: r.rewardId, partyIndex: r.partyIndex };
}

/** Living members lose pct of their current HP; nobody drops below 1 HP. */
function loseHp(w: World, p: SimPlayer, pct: number): void {
  const cut = (hp: number) => Math.max(Math.min(hp, 1), hp * (1 - pct));
  for (const m of p.party) {
    if (m.dead) continue;
    const e = getEntity(w, m.entityId);
    if (e) e.hp = cut(e.hp);
    else m.hp = cut(m.hp);
  }
}

function healParty(w: World, p: SimPlayer, pct: number): void {
  for (const m of p.party) {
    if (m.dead) continue;
    const e = getEntity(w, m.entityId);
    if (e) heal(w, null, e, pct * e.maxHp);
    else m.hp = Math.min(m.maxHp, m.hp + pct * m.maxHp);
  }
}

// ─────────────────────────── Traces ───────────────────────────

/** Add a trace (the same one again only refreshes its duration) and re-derive max HP (gains also raise current HP). */
export function addGoedamTrace(w: World, p: SimPlayer, id: string): void {
  const def = getGoedamTrace(id);
  const slot = p.goedamTraces.find(t => t.id === id);
  if (slot) slot.floorsLeft = def.floors;
  else p.goedamTraces.push({ id, floorsLeft: def.floors });
  emit(w, { type: 'goedamTrace', player: p.id, traceId: id, floorsLeft: def.floors });
  refreshMaxHp(w, p, true); // a +max HP trace raises current HP too (맑은 수액 after 'HP 가득' stays full)
}

/** Floor clear, before the heal: timed traces count down and the finished ones go (max HP comes back first). */
export function expireGoedamTraces(w: World): void {
  for (const p of w.state.players) {
    for (const t of p.goedamTraces) if (t.floorsLeft != null) t.floorsLeft--;
    const gone = p.goedamTraces.filter(t => t.floorsLeft != null && t.floorsLeft <= 0);
    if (gone.length === 0) continue;
    p.goedamTraces = p.goedamTraces.filter(t => !gone.includes(t));
    for (const t of gone) emit(w, { type: 'goedamTraceExpired', player: p.id, traceId: t.id });
    refreshMaxHp(w, p);
  }
}
