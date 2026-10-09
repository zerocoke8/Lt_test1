// 기획 12차: 돌발 괴담 (docs/combat-events.md) — a small timed objective in the middle of a normal floor: schedule, warning,
// spawn, behaviour (fleeing toad, printer, patient, shaft, 23:59 shadows, lamps, sleepwalker), success / failure, the
// party-wide reward and cleanup.
// Every roll is on the event's own streams (mixSeed(seed, salt, stream, floor)), never on w.rng: with the slider at 0 a
// run is bit-identical to one without events, and until the first warning a run with events equals one without.

import type { FieldEventDef, FieldEventId, FieldEventMark, FieldEventReward, FieldEventState, FieldEventTag, FloorPlan, Tunables, Vec2 } from '../types';
import { zoneOf } from '../config';
import {
  FIELD_EVENT_EARLIEST,
  FIELD_EVENT_FIRST_FLOOR,
  FIELD_EVENT_LAST_FLOOR,
  FIELD_EVENT_LATEST,
  FIELD_EVENT_MAX_PER_RUN,
  FIELD_EVENT_SALT,
  FIELD_EVENT_SPREAD,
  FIELD_EVENT_UNIT,
  FIELD_EVENTS,
  LAMP_BANDS,
  LAMP_Y,
  PRINTER_MINION,
  getFieldEvent,
  getMonster,
} from '../data';
import { reduceRevive, benchHeal } from './bench';
import { applyDamage, heal, killEntity, type DmgSrc } from './combat';
import { SPAWN_WARNING_TIME, SUMMON_SPREAD } from './constants';
import { clampUnit, createUnit } from './entities';
import { dropOutcome } from './fieldEventPreview';
import { addGoedamTrace } from './goedam';
import { syncMembers } from './players';
import { addUltCharge } from './ultMode';
import { planExpeditionFieldEvent } from './expedition';
import { mixSeed, Rng } from './rng';
import { effStats } from './stats';
import { applyStatus, hasStatus } from './status';
import {
  arena,
  copy,
  countEnemies,
  dist,
  emit,
  getEntity,
  isAlive,
  onRunEnd,
  queuedEnemies,
  type SimEntity,
  type SimPlayer,
  type World,
} from './world';

const STREAM = { plan: 1, start: 2, pos: 3, ai: 4, forced: 5 } as const;

/** Per-unit behaviour state (EntityRt.eventAi): the toad's hop timer / crouch and idle wander goal. */
export interface FieldEventAi {
  kind: 'toad' | 'printer' | 'patient' | 'child';
  hopIn: number;
  crouch: number;
  wander: Vec2 | null;
  wanderIn: number;
}

/** This floor's scheduled event (not started yet). latest = last floor second it may still start. */
export interface FieldEventPlan {
  floor: number;
  id: FieldEventId;
  startAt: number;
  latest: number;
}

export type FieldEventLog = NonNullable<import('../types').Telemetry['fieldEvents']>[number];

/** Run-long bookkeeping (World.fieldEvents); the open event itself is state.fieldEvent. */
export interface FieldEventRt {
  plan: FieldEventPlan | null;
  history: FieldEventLog[];
  /** Planned per id this run (max FIELD_EVENT_MAX_PER_RUN). */
  counts: Partial<Record<FieldEventId, number>>;
  /** Event planned for a floor (no repeat on the very next floor). */
  lastPlanned: { floor: number; id: FieldEventId } | null;
  /** Debug 'fieldEventNext' waiting for the next normal floor (id null = any that fits). */
  forced: { id: FieldEventId | null } | null;
  /** The running event's behaviour stream (null when none). */
  rng: Rng | null;
  /** Tick it became active (bots react once per event, keyed by it). */
  startTick: number;
  /** Seconds it has been active. */
  activeTime: number;
  /** 비상등: seconds an ally character has stood at each lamp. */
  stand: number[];
  /** 23:59: seconds of spawn-in left (the clock waits) and shadows out so far. */
  spawnIn: number;
  spawned: number;
  /** Printer: a print is queued this cycle; ids of what it printed. */
  printQueued: boolean;
  printedIds: number[];
  /** Shaft: the mid boss already stumbled (once). */
  midHit: boolean;
}

export function newFieldEventRt(): FieldEventRt {
  return {
    plan: null,
    history: [],
    counts: {},
    lastPlanned: null,
    forced: null,
    rng: null,
    startTick: 0,
    activeTime: 0,
    stand: [],
    spawnIn: 0,
    spawned: 0,
    printQueued: false,
    printedIds: [],
    midHit: false,
  };
}

export function fieldEventRng(seed: number, stream: number, floor: number): Rng {
  return new Rng(mixSeed(seed, FIELD_EVENT_SALT, stream, floor));
}

// ─────────────────────────── Schedule (pure) ───────────────────────────

/** Can this floor have an event at all (normal floor 2..19)? */
export function fieldEventFloor(floor: number, plan: Pick<FloorPlan, 'kind'>): boolean {
  return plan.kind === 'normal' && floor >= FIELD_EVENT_FIRST_FLOOR && floor <= FIELD_EVENT_LAST_FLOOR;
}

/** Seconds from the warning to the end (23:59 adds its spawn-in). */
export function fieldEventSpan(def: FieldEventDef): number {
  return def.warn + def.duration + (def.id === 'midnight_surge' ? def.params.spawnIn : 0);
}

/**
 * [earliest, latest] start second on a floor plan (null without waves). 기획 16차 템포: a fixed window — the spawner
 * holds the last wave while the event is planned / open and FIELD_EVENT_LAST_WAVE_HOLD s after, so any event fits.
 */
export function fieldEventWindow(def: FieldEventDef, plan: Pick<FloorPlan, 'waves'>): [number, number] | null {
  return plan.waves.length > 0 ? [FIELD_EVENT_EARLIEST, FIELD_EVENT_LATEST] : null;
}

/** Which event (if any) a floor rolls: floor 2 = the toad; else chance, then zone weights (no repeat, ≤ 2 per run). */
export function rollFieldEvent(
  seed: number,
  floor: number,
  chance: number,
  prev: FieldEventId | null,
  counts: Partial<Record<FieldEventId, number>>,
): FieldEventId | null {
  if (!(chance > 0) || floor < FIELD_EVENT_FIRST_FLOOR || floor > FIELD_EVENT_LAST_FLOOR) return null;
  if (floor === FIELD_EVENT_FIRST_FLOOR) return 'lucky_toad';
  const rng = fieldEventRng(seed, STREAM.plan, floor);
  if (!rng.chance(chance)) return null;
  const theme = zoneOf(floor).theme;
  const beforeBoss = (floor + 1) % 5 === 0;
  const cands = FIELD_EVENTS.filter(
    d => d.from <= floor && d.weights[theme] > 0 && d.id !== prev && (counts[d.id] ?? 0) < FIELD_EVENT_MAX_PER_RUN && !(beforeBoss && d.notBeforeBoss),
  );
  if (cands.length === 0) return null;
  return rng.weighted(cands, d => d.weights[theme]).id;
}

/** The floor's event with its start second, or null. Pure (seed + floor + plan + what was planned before). */
export function planFieldEventFor(
  seed: number,
  floor: number,
  chance: number,
  plan: Pick<FloorPlan, 'kind' | 'waves'>,
  lastPlanned: FieldEventRt['lastPlanned'],
  counts: FieldEventRt['counts'],
): FieldEventPlan | null {
  if (!fieldEventFloor(floor, plan)) return null;
  const prev = lastPlanned && lastPlanned.floor === floor - 1 ? lastPlanned.id : null;
  const id = rollFieldEvent(seed, floor, chance, prev, counts);
  if (!id) return null;
  const win = fieldEventWindow(getFieldEvent(id), plan);
  if (!win) return null;
  const startAt = fieldEventRng(seed, STREAM.start, floor).range(win[0], win[1]);
  return { floor, id, startAt, latest: win[1] };
}

/** A whole run's schedule for a seed (tests / benches): floors 1..maxFloor planned in order. */
export function fieldEventSchedule(seed: number, tunables: Tunables, planOf: (floor: number) => FloorPlan): FieldEventPlan[] {
  const out: FieldEventPlan[] = [];
  const counts: FieldEventRt['counts'] = {};
  let last: FieldEventRt['lastPlanned'] = null;
  for (let f = 1; f <= Math.min(tunables.maxFloor, FIELD_EVENT_LAST_FLOOR); f++) {
    const p = planFieldEventFor(seed, f, tunables.fieldEventChance, planOf(f), last, counts);
    if (!p) continue;
    out.push(p);
    counts[p.id] = (counts[p.id] ?? 0) + 1;
    last = { floor: f, id: p.id };
  }
  return out;
}

// ─────────────────────────── Floor start / debug ───────────────────────────

/** startFloor (after planFloor; it already closed a leftover event under the old floor): plan this floor's. */
export function startFloorFieldEvent(w: World): void {
  const s = w.state;
  const fe = w.fieldEvents;
  fe.plan = null;
  if (s.plan.kind !== 'normal') return;
  if (fe.forced) {
    const id = fe.forced.id ?? forcedPick(w);
    fe.forced = null;
    fe.plan = { floor: s.floor, id, startAt: FIELD_EVENT_EARLIEST, latest: FIELD_EVENT_EARLIEST };
    return;
  }
  const plan = w.expedition
    ? planExpeditionFieldEvent(w, fe.lastPlanned && fe.lastPlanned.floor === s.floor - 1 ? fe.lastPlanned.id : null) // 기획 15차 원정
    : planFieldEventFor(s.seed, s.floor, w.tunables.fieldEventChance, s.plan, fe.lastPlanned, fe.counts);
  if (!plan) return;
  fe.plan = plan;
  fe.counts[plan.id] = (fe.counts[plan.id] ?? 0) + 1;
  fe.lastPlanned = { floor: s.floor, id: plan.id };
}

function forcedPick(w: World): FieldEventId {
  const theme = w.state.plan.theme ?? zoneOf(w.state.floor).theme;
  const cands = FIELD_EVENTS.filter(d => d.weights[theme] > 0);
  return fieldEventRng(w.state.seed, STREAM.forced, w.state.floor).weighted(cands, d => d.weights[theme]).id;
}

/**
 * Debug 'fieldEventNext': start now when this is a normal floor in combat with no event yet and floorTime < 30,
 * else 8 s into the next normal floor.
 */
export function forceFieldEvent(w: World, id: FieldEventId | undefined): void {
  const s = w.state;
  if (s.phase === 'combat' && s.plan.kind === 'normal' && !s.fieldEvent && s.floorTime < 30) {
    const plan: FieldEventPlan = { floor: s.floor, id: id ?? forcedPick(w), startAt: s.floorTime, latest: s.floorTime };
    w.fieldEvents.plan = null;
    beginWarn(w, plan);
    return;
  }
  w.fieldEvents.forced = { id: id ?? null };
}

/** Floor clear / floor start / run end: an open event fails quietly and its units go (characters stay). */
export function closeFieldEvent(w: World): void {
  if (w.state.fieldEvent) finish(w, false);
  w.fieldEvents.plan = null;
  for (const e of w.state.entities) if (e.eventTag) e.rt.gone = true;
}

// A wipe / timeout / quit mid-event still logs it (telemetry success rates) and leaves no orphan units.
onRunEnd(closeFieldEvent);

// ─────────────────────────── Tick ───────────────────────────

/** game.ts tick(), right after tickSpawner (combat only). */
export function tickFieldEvents(w: World, dt: number): void {
  const s = w.state;
  const fe = w.fieldEvents;
  if (s.phase !== 'combat' || s.plan.kind !== 'normal') return;
  const ev = s.fieldEvent;
  if (!ev) {
    if (fe.plan && s.floorTime >= fe.plan.startAt - 1e-9) tryBegin(w, fe.plan);
    return;
  }
  if (ev.stage === 'warn') {
    ev.warnRemaining = Math.max(0, ev.warnRemaining - dt);
    if (ev.warnRemaining <= 1e-9) activate(w, ev);
    return;
  }
  fe.activeTime += dt;
  const waiting = ev.id === 'midnight_surge' && fe.spawnIn > 0;
  if (!waiting) ev.remaining = Math.max(0, ev.remaining - dt);
  TICK[ev.id](w, ev, dt);
  if (s.fieldEvent === ev && ev.remaining <= 1e-9) finish(w, false);
}

function tryBegin(w: World, plan: FieldEventPlan): void {
  const def = getFieldEvent(plan.id);
  if (plan.id === 'midnight_surge' && countEnemies(w) + queuedEnemies(w) > def.params.crowdMax) {
    // too crowded: wait up to `recheck` s (inside the window), else skip silently
    if (w.state.floorTime > Math.min(plan.startAt + def.params.recheck, plan.latest)) w.fieldEvents.plan = null;
    return;
  }
  beginWarn(w, plan);
}

function beginWarn(w: World, plan: FieldEventPlan): void {
  const s = w.state;
  const fe = w.fieldEvents;
  const def = getFieldEvent(plan.id);
  fe.plan = null;
  fe.rng = fieldEventRng(s.seed, STREAM.ai, s.floor);
  const where = placeEvent(w, def, fieldEventRng(s.seed, STREAM.pos, s.floor));
  s.fieldEvent = {
    id: def.id,
    stage: 'warn',
    warnRemaining: def.warn,
    remaining: def.duration,
    total: def.duration,
    pos: where.pos,
    entityIds: [],
    marks: where.marks,
    progress: def.id === 'sleeping_patient' ? def.params.startPct : 0,
    goal: def.goal,
    creditPlayer: null,
  };
  emit(w, { type: 'fieldEventWarn', id: def.id, pos: copy(where.pos) });
}

function activate(w: World, ev: FieldEventState): void {
  const s = w.state;
  const fe = w.fieldEvents;
  const def = getFieldEvent(ev.id);
  ev.stage = 'active';
  fe.startTick = s.tick;
  fe.activeTime = 0;
  fe.stand = ev.marks.map(() => 0);
  fe.spawnIn = 0;
  fe.spawned = 0;
  fe.printQueued = false;
  fe.printedIds = [];
  fe.midHit = false;
  switch (ev.id) {
    case 'lucky_toad':
      spawnEventUnit(w, ev, ev.pos, 'enemy', 'target', 'toad');
      break;
    case 'possessed_printer':
      spawnEventUnit(w, ev, ev.pos, 'enemy', 'target', 'printer');
      ev.printIn = def.params.printEvery;
      ev.printed = 0;
      break;
    case 'sleeping_patient': {
      const pt = spawnEventUnit(w, ev, ev.pos, 'ally', 'ward', 'patient');
      pt.hp = pt.maxHp * (def.params.startPct / 100);
      break;
    }
    case 'sleepwalker':
      spawnEventUnit(w, ev, ev.pos, 'ally', 'ward', 'child').rt.stationary = true;
      ev.startled = 0;
      break;
    case 'midnight_surge':
      fe.spawnIn = def.params.spawnIn;
      break;
  }
  emit(w, { type: 'fieldEventStart', id: ev.id, pos: copy(ev.pos) });
}

function spawnEventUnit(
  w: World,
  ev: FieldEventState,
  pos: Vec2,
  team: 'ally' | 'enemy',
  tag: FieldEventTag,
  ai: FieldEventAi['kind'] | null,
  expiresIn: number | null = null,
): SimEntity {
  const s = w.state;
  const def = getMonster(FIELD_EVENT_UNIT[ev.id]!);
  const enemy = team === 'enemy';
  const e = createUnit(w, def, pos, team, {
    kind: enemy ? 'monster' : 'summon',
    ownerPlayer: null,
    expiresIn,
    hpMult: enemy ? s.plan.statMult * w.tunables.monsterHpMult : 1,
    atkMult: enemy ? s.plan.statMult : 1,
    rng: w.fieldEvents.rng ?? undefined,
  });
  e.eventTag = tag;
  e.rt.petPowered = false;
  if (ai) e.rt.eventAi = { kind: ai, hopIn: getFieldEvent(ev.id).params.hopEvery ?? 0, crouch: 0, wander: null, wanderIn: 0 };
  ev.entityIds.push(e.id);
  emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: def.tier });
  return e;
}

// ─────────────────────────── Placement ───────────────────────────

function aliveChars(w: World): SimEntity[] {
  return w.state.entities.filter(e => e.kind === 'character' && isAlive(e));
}

/** Centroid of the field characters (all players), else the arena center. */
function anchorOf(w: World): Vec2 {
  const cs = aliveChars(w);
  const a = arena(w);
  if (cs.length === 0) return { x: a.width / 2, y: a.height / 2 };
  return { x: cs.reduce((t, c) => t + c.pos.x, 0) / cs.length, y: cs.reduce((t, c) => t + c.pos.y, 0) / cs.length };
}

function minDistToChars(w: World, p: Vec2): number {
  let d = Infinity;
  for (const c of aliveChars(w)) d = Math.min(d, dist(c.pos, p));
  return d;
}

/** x range of the party's screen (anchor ± FIELD_EVENT_SPREAD, inside the arena). */
function band(w: World, anchor: Vec2, margin = 1.5): [number, number] {
  const a = arena(w);
  return [Math.max(margin, anchor.x - FIELD_EVENT_SPREAD), Math.min(a.width - margin, anchor.x + FIELD_EVENT_SPREAD)];
}

function randomIn(w: World, rng: Rng, xs: [number, number], margin = 1.5): Vec2 {
  const a = arena(w);
  return { x: rng.range(xs[0], xs[1]), y: rng.range(margin, a.height - margin) };
}

function inside(w: World, p: Vec2, margin: number, top = margin): Vec2 {
  const a = arena(w);
  return { x: Math.min(a.width - margin, Math.max(margin, p.x)), y: Math.min(a.height - margin, Math.max(top, p.y)) };
}

/** Event units carry markers above their heads (diamond, bars): keep them this far below the arena's top edge. */
const UNIT_TOP = 3.4;

/** Pick among candidates passing `ok` (seeded), else the one with the best score. */
function pickSpot(rng: Rng, cands: Vec2[], ok: (p: Vec2) => boolean, score: (p: Vec2) => number): Vec2 {
  const good = cands.filter(ok);
  if (good.length > 0) return rng.pick(good);
  let best = cands[0];
  for (const c of cands) if (score(c) > score(best)) best = c;
  return best;
}

function placeEvent(w: World, def: FieldEventDef, rng: Rng): { pos: Vec2; marks: FieldEventMark[] } {
  const anchor = anchorOf(w);
  const xs = band(w, anchor);
  const a = arena(w);
  const prm = def.params;
  const randoms = (n: number, margin = 1.5) => Array.from({ length: n }, () => randomIn(w, rng, xs, margin));
  const points = w.spawner.points.filter(p => p.x >= xs[0] && p.x <= xs[1]);
  switch (def.id) {
    case 'lucky_toad': {
      const cands = [...points, ...randoms(8)].map(p => inside(w, p, 1, UNIT_TOP));
      return { pos: pickSpot(rng, cands, p => minDistToChars(w, p) >= prm.spawnMin, p => minDistToChars(w, p)), marks: [] };
    }
    case 'possessed_printer': {
      // in front of an edge spawn point, pushed toward the middle
      const base = points.length > 0 ? rng.pick(points) : { x: rng.range(xs[0], xs[1]), y: rng.chance(0.5) ? 0.8 : a.height - 0.8 };
      const c = { x: a.width / 2, y: a.height / 2 };
      const d = Math.max(1e-6, dist(base, c));
      const p = { x: base.x + ((c.x - base.x) / d) * 1.4, y: base.y + ((c.y - base.y) / d) * 1.4 };
      return { pos: inside(w, p, 1.4, UNIT_TOP), marks: [] };
    }
    case 'sleeping_patient': {
      const cands = Array.from({ length: 10 }, () => {
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(prm.minDist, prm.maxDist);
        return inside(w, { x: anchor.x + Math.cos(ang) * r, y: anchor.y + Math.sin(ang) * r }, 1.5, UNIT_TOP);
      });
      return { pos: pickSpot(rng, cands, p => minDistToChars(w, p) >= prm.minDist, p => -Math.abs(minDistToChars(w, p) - 4)), marks: [] };
    }
    case 'open_shaft': {
      // on the monsters' way in: between the party and the enemies' middle (they walk straight at their target)
      const foes = w.state.entities.filter(e => e.team === 'enemy' && isAlive(e) && !e.eventTag && e.tier !== 'boss');
      if (foes.length > 0) {
        const fx = foes.reduce((t, e) => t + e.pos.x, 0) / foes.length;
        const fy = foes.reduce((t, e) => t + e.pos.y, 0) / foes.length;
        const way = [0.45, 0.55, 0.65].map(k => inside(w, { x: anchor.x + (fx - anchor.x) * k + rng.range(-0.5, 0.5), y: anchor.y + (fy - anchor.y) * k + rng.range(-0.5, 0.5) }, 2));
        const ok = way.filter(p => minDistToChars(w, p) >= prm.minDist);
        if (ok.length > 0) {
          const pos = rng.pick(ok);
          return { pos, marks: [{ pos, radius: prm.radius, doneBy: null }] };
        }
      }
      const cands = randoms(12, 2);
      const crowd = (p: Vec2) => w.state.entities.filter(e => e.team === 'enemy' && isAlive(e) && !e.eventTag && dist(e.pos, p) <= 6).length;
      const far = cands.filter(p => minDistToChars(w, p) >= prm.minDist);
      const pool = far.length > 0 ? far : cands;
      let best = pool[0];
      let bs = -Infinity;
      for (const p of pool) {
        const sc = crowd(p) + rng.next() * 0.5;
        if (sc > bs) {
          bs = sc;
          best = p;
        }
      }
      return { pos: best, marks: [{ pos: best, radius: prm.radius, doneBy: null }] };
    }
    case 'dark_lamps': {
      const marks = LAMP_BANDS.map(([lo, hi]) => ({ pos: { x: rng.range(lo, hi), y: rng.range(LAMP_Y[0], LAMP_Y[1]) }, radius: prm.dropRadius, doneBy: null }));
      return { pos: copy(marks[1].pos), marks };
    }
    case 'sleepwalker': {
      const dir = rng.chance(0.5) ? 1 : -1;
      const len = def.goal;
      const y = rng.range(prm.yMin, prm.yMax);
      let x = anchor.x - dir * (len / 2) + rng.range(-2, 2);
      const lo = dir > 0 ? 2 : 2 + len;
      const hi = dir > 0 ? a.width - 2 - len : a.width - 2;
      x = Math.min(hi, Math.max(lo, x));
      return { pos: { x, y }, marks: [{ pos: { x: x + dir * len, y }, radius: 0.8, doneBy: null }] };
    }
    case 'midnight_surge':
      return { pos: copy(anchor), marks: [] };
  }
}

// ─────────────────────────── Per-event behaviour ───────────────────────────

const TICK: Record<FieldEventId, (w: World, ev: FieldEventState, dt: number) => void> = {
  lucky_toad: tickToad,
  possessed_printer: tickPrinter,
  sleeping_patient: tickPatient,
  open_shaft: tickShaft,
  midnight_surge: tickMidnight,
  dark_lamps: tickLamps,
  sleepwalker: tickChild,
};

function unitOf(w: World, ev: FieldEventState): SimEntity | null {
  return getEntity(w, ev.entityIds[0]);
}

function evRng(w: World): Rng {
  return (w.fieldEvents.rng ??= fieldEventRng(w.state.seed, STREAM.ai, w.state.floor));
}

function moveToward(w: World, e: SimEntity, ux: number, uy: number, step: number): void {
  const l = Math.hypot(ux, uy);
  if (l < 1e-6 || step <= 0) return;
  e.pos.x += (ux / l) * step;
  e.pos.y += (uy / l) * step;
  clampUnit(w, e);
  e.facing = Math.atan2(uy, ux);
}

/** 금두꺼비: flees allies within fleeRadius (walls make it slide), hops away every hopEvery s after a crouch; a stun cancels the hop. */
function tickToad(w: World, ev: FieldEventState, dt: number): void {
  const t = unitOf(w, ev);
  if (!t?.rt.eventAi) return;
  const ai = t.rt.eventAi;
  const prm = getFieldEvent(ev.id).params;
  if (hasStatus(t, 'stun')) {
    ai.crouch = 0;
    ai.hopIn = prm.hopEvery;
    t.anim = 'stunned';
    return;
  }
  const near = aliveChars(w).filter(c => dist(c.pos, t.pos) <= prm.fleeRadius);
  if (ai.crouch > 0) {
    ai.crouch -= dt;
    if (ai.crouch <= 1e-9) hop(w, t, near.length > 0 ? near : aliveChars(w), prm.hopDist);
    return;
  }
  ai.hopIn -= dt;
  if (ai.hopIn <= 1e-9 && near.length > 0) {
    ai.crouch = prm.crouch;
    ai.hopIn = prm.hopEvery;
    t.anim = 'cast';
    t.animTime = prm.crouch;
    return;
  }
  const speed = effStats(w, t).moveSpeed;
  if (near.length > 0) {
    const cx = near.reduce((s, c) => s + c.pos.x, 0) / near.length;
    const cy = near.reduce((s, c) => s + c.pos.y, 0) / near.length;
    let ux = t.pos.x - cx;
    let uy = t.pos.y - cy;
    if (Math.hypot(ux, uy) < 1e-6) {
      const ang = evRng(w).range(0, Math.PI * 2);
      ux = Math.cos(ang);
      uy = Math.sin(ang);
    }
    moveToward(w, t, ux, uy, speed * dt);
    t.anim = 'move';
    return;
  }
  // nobody near: wander slowly around the middle
  ai.wanderIn -= dt;
  const a = arena(w);
  if (!ai.wander || ai.wanderIn <= 0 || dist(ai.wander, t.pos) < 0.3) {
    const rng = evRng(w);
    ai.wander = { x: a.width / 2 + rng.range(-6, 6), y: a.height / 2 + rng.range(-3, 3) };
    ai.wanderIn = 3;
  }
  const slowed = speed / Math.max(1e-6, t.rt.base.moveSpeed);
  moveToward(w, t, ai.wander.x - t.pos.x, ai.wander.y - t.pos.y, prm.idleSpeed * slowed * dt);
  t.anim = 'move';
}

function hop(w: World, t: SimEntity, from: SimEntity[], distance: number): void {
  let n = from[0];
  for (const c of from) if (dist(c.pos, t.pos) < dist(n.pos, t.pos)) n = c;
  const start = copy(t.pos);
  let ux = n ? t.pos.x - n.pos.x : 1;
  let uy = n ? t.pos.y - n.pos.y : 0;
  if (Math.hypot(ux, uy) < 1e-6) {
    ux = 1;
    uy = 0;
  }
  moveToward(w, t, ux, uy, distance);
  t.anim = 'move';
  t.animTime = 0;
  emit(w, { type: 'dash', entityId: t.id, from: start, to: copy(t.pos), duration: 0.35 });
}

/** 프린터: prints printCount of the zone's weak monster every printEvery s (paused while stunned), printMax in all. */
function tickPrinter(w: World, ev: FieldEventState, dt: number): void {
  const pr = unitOf(w, ev);
  if (!pr || hasStatus(pr, 'stun')) return;
  const prm = getFieldEvent(ev.id).params;
  const fe = w.fieldEvents;
  ev.printIn = (ev.printIn ?? prm.printEvery) - dt;
  if (!fe.printQueued && ev.printIn <= SPAWN_WARNING_TIME + 1e-9) {
    fe.printQueued = true;
    queuePrint(w, ev, pr, prm);
  }
  if (ev.printIn <= 1e-9) {
    ev.printIn += prm.printEvery;
    fe.printQueued = false;
  }
}

function queuePrint(w: World, ev: FieldEventState, pr: SimEntity, prm: Record<string, number>): void {
  const printed = ev.printed ?? 0;
  const room = Math.floor(w.tunables.maxAliveMonsters - countEnemies(w) - queuedEnemies(w));
  const n = Math.max(0, Math.min(prm.printCount, prm.printMax - printed, room));
  if (n === 0) return;
  const a = arena(w);
  const d = Math.max(1e-6, Math.hypot(a.width / 2 - pr.pos.x, a.height / 2 - pr.pos.y));
  const ux = (a.width / 2 - pr.pos.x) / d;
  const uy = (a.height / 2 - pr.pos.y) / d;
  const monsterId = PRINTER_MINION[w.state.plan.theme ?? zoneOf(w.state.floor).theme];
  for (let i = 0; i < n; i++) {
    const side = (i - (n - 1) / 2) * 0.9;
    const pos = inside(w, { x: pr.pos.x + ux * (pr.radius + prm.outlet) - uy * side, y: pr.pos.y + uy * (pr.radius + prm.outlet) + ux * side }, 0.6);
    w.spawner.pending.push({ remaining: SPAWN_WARNING_TIME, monsterId, pos, mid: false, wave: -1, printed: true });
    emit(w, { type: 'spawnWarning', pos: copy(pos), delay: SPAWN_WARNING_TIME });
  }
  ev.printed = printed + n;
}

/** floor.ts spawnPending: a printed minion came out (it vanishes if the printer is destroyed). */
export function notePrinted(w: World, e: SimEntity): void {
  w.fieldEvents.printedIds.push(e.id);
}

/** 환자: HP is the progress; an ally character nearby makes it regain nearPerSec %/s. */
function tickPatient(w: World, ev: FieldEventState, dt: number): void {
  const pt = unitOf(w, ev);
  if (!pt) return;
  const prm = getFieldEvent(ev.id).params;
  if (aliveChars(w).some(c => dist(c.pos, pt.pos) <= prm.nearRadius)) pt.hp = Math.min(pt.maxHp, pt.hp + (prm.nearPerSec / 100) * pt.maxHp * dt);
  ev.progress = (pt.hp / pt.maxHp) * 100;
  if (ev.progress >= ev.goal - 1e-6) {
    ev.progress = ev.goal;
    ev.creditPlayer = nearestOwner(w, pt.pos);
    finish(w, true);
  }
}

/** 통로: normal monsters whose center comes within fallRadius fall (count as kills); a mid boss stumbles once. */
function tickShaft(w: World, ev: FieldEventState, dt: number): void {
  const hole = ev.marks[0];
  const prm = getFieldEvent(ev.id).params;
  const fe = w.fieldEvents;
  for (const e of w.state.entities) {
    if (w.state.fieldEvent !== ev) return;
    if (e.team !== 'enemy' || !isAlive(e) || e.eventTag) continue;
    const d = dist(e.pos, hole.pos);
    // 기획 12차 tuning: the pit breathes in — normal monsters near the rim slide toward it (bait / pull / push finish it)
    if (e.tier === 'normal' && d > prm.fallRadius && d <= prm.suckRadius && !e.rt.stationary) {
      const step = Math.min(prm.suck * dt, d - prm.fallRadius + 0.01);
      e.pos.x += ((hole.pos.x - e.pos.x) / d) * step;
      e.pos.y += ((hole.pos.y - e.pos.y) / d) * step;
      continue;
    }
    if (e.tier === 'normal' && d <= prm.fallRadius + 1e-9) {
      killEntity(w, e, null, { noOnDeath: true });
      addProgress(w, ev, 1, null, 'fall');
    } else if (e.tier === 'mid' && !fe.midHit && d <= hole.radius + 1e-9) {
      fe.midHit = true;
      const src: DmgSrc = { casterId: null, team: 'ally', player: null, source: 'zone', isDrag: false, name: getFieldEvent(ev.id).name };
      applyDamage(w, src, e, (prm.midDmg * e.maxHp) / Math.max(0.1, 1 - effStats(w, e).def), false);
      if (isAlive(e)) applyStatus(e, 'stun', prm.midStun, 0, null, 'zone');
      addProgress(w, ev, prm.midProgress, null, 'fall');
    }
  }
}

/** 23:59: shadows come out over spawnIn s from every spawn point; each kill counts. */
function tickMidnight(w: World, ev: FieldEventState, dt: number): void {
  const fe = w.fieldEvents;
  const prm = getFieldEvent(ev.id).params;
  fe.spawnIn = Math.max(0, fe.spawnIn - dt);
  if (fe.spawned >= prm.count) return;
  const due = fe.spawnIn <= 1e-9 ? prm.count : Math.ceil((1 - fe.spawnIn / prm.spawnIn) * prm.count);
  const pts = w.spawner.points.length > 0 ? w.spawner.points : [ev.pos];
  const rng = evRng(w);
  while (fe.spawned < due) {
    const base = pts[fe.spawned % pts.length];
    const pos = inside(w, { x: base.x + rng.range(-0.8, 0.8), y: base.y + rng.range(-0.8, 0.8) }, 0.6);
    spawnEventUnit(w, ev, pos, 'enemy', 'minion', null, ev.remaining + fe.spawnIn);
    fe.spawned++;
  }
}

/** 비상등: an ally character standing within standRadius for standTime s lights it. */
function tickLamps(w: World, ev: FieldEventState, dt: number): void {
  const prm = getFieldEvent(ev.id).params;
  const fe = w.fieldEvents;
  const chars = aliveChars(w);
  ev.marks.forEach((m, i) => {
    if (m.doneBy != null || w.state.fieldEvent !== ev) return;
    const by = chars.find(c => dist(c.pos, m.pos) <= prm.standRadius);
    fe.stand[i] = by ? (fe.stand[i] ?? 0) + dt : 0;
    if (by && fe.stand[i] >= prm.standTime - 1e-9) lightLamp(w, ev, i, by.ownerPlayer);
  });
}

function lightLamp(w: World, ev: FieldEventState, i: number, player: number | null): void {
  const m = ev.marks[i];
  if (!m || m.doneBy != null) return;
  const prm = getFieldEvent(ev.id).params;
  m.doneBy = player ?? -1;
  // the flash: nearby enemies (not the boss) are stunned
  for (const e of w.state.entities) {
    if (e.team === 'enemy' && isAlive(e) && e.tier !== 'boss' && dist(e.pos, m.pos) <= prm.flashRadius + e.radius) {
      applyStatus(e, 'stun', prm.flashStun, 0, player, 'zone');
    }
  }
  addProgress(w, ev, 1, player, 'lamp');
}

/** 아이: walks along its row only while an ally character is within escort; crying = standing still. */
function tickChild(w: World, ev: FieldEventState, dt: number): void {
  const ch = unitOf(w, ev);
  const exit = ev.marks[0];
  if (!ch || !exit) return;
  const prm = getFieldEvent(ev.id).params;
  if ((ev.startled ?? 0) > 0) {
    ev.startled = Math.max(0, (ev.startled ?? 0) - dt);
    ch.anim = 'stunned';
    return;
  }
  const escort = aliveChars(w).some(c => dist(c.pos, ch.pos) <= prm.escort);
  if (!escort) {
    ch.anim = 'idle';
    return;
  }
  ev.progress = Math.min(ev.goal, ev.progress + prm.speed * dt);
  placeChild(ev, ch);
  ch.anim = 'move';
  if (ev.progress >= ev.goal - 1e-6) {
    ev.creditPlayer = nearestOwner(w, ch.pos);
    finish(w, true);
  }
}

function placeChild(ev: FieldEventState, ch: SimEntity): void {
  const exit = ev.marks[0];
  const dir = Math.sign(exit.pos.x - ev.pos.x) || 1;
  ch.pos.x = ev.pos.x + dir * ev.progress;
  ch.pos.y = ev.pos.y;
  ch.facing = dir > 0 ? 0 : Math.PI;
}

function startleChild(w: World, ev: FieldEventState, player: number): void {
  const ch = unitOf(w, ev);
  if (!ch) return;
  const prm = getFieldEvent(ev.id).params;
  ev.progress = Math.max(0, ev.progress - prm.startleBack);
  ev.startled = prm.cry;
  placeChild(ev, ch);
  emit(w, { type: 'fieldEventProgress', id: ev.id, progress: ev.progress, goal: ev.goal, player, kind: 'startle' });
}

function nearestOwner(w: World, p: Vec2): number | null {
  let best: SimEntity | null = null;
  for (const c of aliveChars(w)) if (!best || dist(c.pos, p) < dist(best.pos, p)) best = c;
  return best?.ownerPlayer ?? null;
}

function addProgress(w: World, ev: FieldEventState, n: number, player: number | null, kind: 'lamp' | 'fall' | 'kill'): void {
  ev.progress = Math.min(ev.goal, ev.progress + n);
  if (player != null) ev.creditPlayer = player;
  emit(w, { type: 'fieldEventProgress', id: ev.id, progress: ev.progress, goal: ev.goal, player, kind });
  if (ev.progress >= ev.goal - 1e-9) finish(w, true);
}

// ─────────────────────────── Hooks (combat.ts / players.ts) ───────────────────────────

/** killEntity: an event target / shadow died, or an enemy died next to the patient. */
export function fieldEventDeath(w: World, e: SimEntity, killer: DmgSrc | null): void {
  const ev = w.state.fieldEvent;
  if (!ev || ev.stage !== 'active') return;
  const by = killer?.player ?? null;
  if (e.eventTag === 'target' && ev.entityIds.includes(e.id)) {
    ev.progress = ev.goal;
    ev.creditPlayer = by;
    finish(w, true);
    return;
  }
  if (ev.id === 'midnight_surge' && e.eventTag === 'minion') {
    addProgress(w, ev, 1, by, 'kill');
    return;
  }
  if (ev.id === 'sleeping_patient' && e.team === 'enemy') {
    const pt = unitOf(w, ev);
    const prm = getFieldEvent(ev.id).params;
    if (pt && dist(pt.pos, e.pos) <= prm.killRadius) {
      pt.hp = Math.min(pt.maxHp, pt.hp + (prm.killBonus / 100) * pt.maxHp);
      ev.progress = (pt.hp / pt.maxHp) * 100;
      emit(w, { type: 'fieldEventProgress', id: ev.id, progress: ev.progress, goal: ev.goal, player: by, kind: 'kill' });
    }
  }
}

/**
 * A card (doSwap: after the appear, before its drag skill) or pet (usePet: after the cast) landed at `at`:
 * the appearing character / new summons lock onto a nearby target, lamps light, the child startles.
 */
export function fieldEventOnDrop(w: World, p: SimPlayer, kind: 'swap' | 'pet', index: number, at: Vec2, appeared: SimEntity | null): void {
  const ev = w.state.fieldEvent;
  if (!ev || ev.stage !== 'active') return;
  const out = dropOutcome(w.state, p.id, kind, index, at);
  if (!out) return;
  if (out.lockTargetId != null) {
    if (appeared) lockOn(appeared, out.lockTargetId);
    if (kind === 'pet') {
      for (const e of w.state.entities) {
        if (e.team !== 'ally' || e.kind !== 'summon' || e.ownerPlayer !== p.id || e.eventTag || !isAlive(e)) continue;
        if (e.targetId == null && dist(e.pos, at) <= SUMMON_SPREAD + 0.1 && !e.rt.monDef?.inert) lockOn(e, out.lockTargetId);
      }
    }
  }
  for (const i of out.lamps) lightLamp(w, ev, i, p.id);
  if (out.startle && w.state.fieldEvent === ev) startleChild(w, ev, p.id);
}

function lockOn(e: SimEntity, targetId: number): void {
  e.targetId = targetId;
  e.targetHeldFor = 0;
}

// ─────────────────────────── End + reward ───────────────────────────

function finish(w: World, success: boolean): void {
  const s = w.state;
  const ev = s.fieldEvent;
  if (!ev) return;
  const fe = w.fieldEvents;
  const def = getFieldEvent(ev.id);
  s.fieldEvent = null;
  fe.rng = null;
  const credit = success ? ev.creditPlayer : null;
  for (const id of ev.entityIds) {
    const e = w.byId.get(id);
    if (e) e.rt.gone = true;
  }
  if (success && ev.id === 'possessed_printer') removePrinted(w);
  fe.history.push({ floor: s.floor, id: ev.id, success, seconds: Math.round(fe.activeTime * 100) / 100, credit });
  if (ev.stage === 'warn') return; // cut before it started (floor ended): nothing to announce
  emit(w, { type: 'fieldEventEnd', id: ev.id, success, player: credit });
  if (!success) return;
  if (credit != null && s.players[credit]) s.players[credit].stats.fieldEvents++;
  applyReward(w, def.reward);
}

/** The printer was destroyed: what it printed turns to paper (no kill credit) and queued prints never come. */
function removePrinted(w: World): void {
  for (const id of w.fieldEvents.printedIds) {
    const e = getEntity(w, id);
    if (!e) continue;
    e.rt.gone = true;
    emit(w, { type: 'death', entityId: e.id, pos: copy(e.pos), kind: e.kind, tier: e.tier });
  }
  w.fieldEvents.printedIds = [];
  w.spawner.pending = w.spawner.pending.filter(ps => !ps.printed);
}

/** Every player still in the run (bots and disconnected seats too) gets the same reward. */
export function applyReward(w: World, r: FieldEventReward): void {
  const s = w.state;
  const players = s.players.filter(p => !p.out);
  switch (r.kind) {
    case 'ultAdd':
      for (const p of players) addUltCharge(w, p, r.value); // the field character's gauge (기획 15차 per character)
      return;
    case 'petReset':
      for (const p of players) for (const pet of p.pets) pet.cooldownRemaining = 0;
      return;
    case 'healParty':
      for (const p of players) {
        const e = getEntity(w, p.activeIndex != null ? p.party[p.activeIndex].entityId : null);
        if (e) heal(w, null, e, r.pct * e.maxHp);
        benchHeal(w, p, r.pct, 1, null);
        reduceRevive(w, p, r.reviveCut);
      }
      syncMembers(w);
      return;
    case 'benchSwapReset':
      for (const p of players) p.party.forEach((m, i) => (i !== p.activeIndex ? (m.swapCooldownRemaining = 0) : 0));
      return;
    case 'trace':
      for (const p of players) addGoedamTrace(w, p, r.traceId);
      return;
    case 'exposeAll':
      for (const e of s.entities) {
        if (e.team !== 'enemy' || !isAlive(e)) continue;
        applyStatus(e, 'vulnerable', r.duration, r.vulnerable, null, 'zone');
        applyStatus(e, 'stun', r.stun, 0, null, 'zone');
      }
      return;
  }
}
