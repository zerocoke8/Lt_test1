// 기획 12차 돌발 괴담 — bot rules (docs/combat-events.md 4장): same rules as a human, simple rules. Bots only drop on
// their own screen, react once per event after the usual reaction time, never bait the shaft or herd the toad.
// bot.ts calls in here at four points (target weight, drop score, pet point, think); all event logic lives here.

import type { Command, CommandResult, FieldEventState, PreviewPart, Vec2 } from '../types';
import { VIEW_WIDTH_UNITS } from '../config';
import { getCharacter, getFieldEvent, getPet } from '../data';
import { BOT } from './constants';
import { dropOutcome } from './fieldEventPreview';
import { canSwap } from './players';
import { previewPartsFor } from './preview';
import { activeEntity, clamp, clampToArena, dist, getEntity, isAlive, type SimEntity, type SimPlayer, type World } from './world';

type Dispatch = (cmd: Command) => CommandResult;

/** Benches only (critic-20f FE_SEAT=ignore): seats whose AI behaves as if 돌발 괴담 did not exist. Empty in the game. */
export const EVENT_BLIND = new Set<number>();

/** Aim weight of an event target (toad, printer): above a boss (3). null = not an event target. */
export const TARGET_WEIGHT = 4;
/** Drop score bonuses: per lamp lit, locking onto a target, startling the child (never). */
const LAMP_BONUS = 3;
const LOCK_BONUS = 2;
const STARTLE_PENALTY = -10;
/** The sleeping patient counts as a hurt ally ×2 in heal aim (hurtWeight = 0.2 + missing HP). */
const PATIENT_WEIGHT = 2;
/** Child escort: the drop goes this far toward the exit from the child. */
const ESCORT_LEAD = 1.5;

function activeEvent(w: World): FieldEventState | null {
  const ev = w.state.fieldEvent;
  return ev && ev.stage === 'active' ? ev : null;
}

function eventUnit(w: World, ev: FieldEventState): SimEntity | null {
  return getEntity(w, ev.entityIds[0]);
}

/** The bot's screen (same window as bot.ts botView: centered on its field character, clamped to the arena). */
function viewOf(w: World, p: SimPlayer): [number, number] {
  const a = w.state.plan.arena;
  const half = VIEW_WIDTH_UNITS / 2;
  const me = activeEntity(w, p);
  const x = me ? me.pos.x : (p.rt.bot.viewX ?? a.width / 2);
  const cx = a.width <= VIEW_WIDTH_UNITS ? a.width / 2 : clamp(x, half, a.width - half);
  return [cx - half, cx + half];
}

function inView(view: [number, number], c: Vec2): boolean {
  return c.x >= view[0] - 1e-9 && c.x <= view[1] + 1e-9;
}

/** Extra score of dropping card `index` at `drop` (bestDropPoint / petPoint score closures). 0 with no event. */
export function eventDropBonus(w: World, p: SimPlayer, kind: 'swap' | 'pet', index: number, drop: Vec2): number {
  if (!activeEvent(w) || EVENT_BLIND.has(p.id)) return 0;
  const out = dropOutcome(w.state, p.id, kind, index, drop);
  if (!out) return 0;
  const patient = out.patientHeal ? PATIENT_WEIGHT * (0.2 + (1 - activeEvent(w)!.progress / 100)) : 0;
  return LAMP_BONUS * out.lamps.length + (out.lockTargetId != null ? LOCK_BONUS : 0) + (out.startle ? STARTLE_PENALTY : 0) + patient;
}

const healsAllies = (actions: readonly { affects: string; effects: { kind: string }[] }[]) =>
  actions.some(a => a.affects === 'allies' && a.effects.some(e => e.kind === 'heal'));

/**
 * Pet drop for an event: golem next to the printer, black-hole cat on the shaft (≥ 2 enemies near it), heal fairy on the
 * patient, one damage / summon pet per event on a lamp. undefined = no event rule (bot.ts decides as usual).
 */
export function eventPetPoint(w: World, p: SimPlayer, i: number): Vec2 | null | undefined {
  const ev = activeEvent(w);
  if (!ev || EVENT_BLIND.has(p.id)) return undefined;
  const def = getPet(p.pets[i].defId);
  const view = viewOf(w, p);
  const unit = eventUnit(w, ev);
  if (ev.id === 'possessed_printer' && def.id === 'golem_turret' && unit && inView(view, unit.pos)) {
    const me = activeEntity(w, p);
    const from = me ? me.pos : { x: (view[0] + view[1]) / 2, y: unit.pos.y };
    const d = Math.max(1e-6, dist(from, unit.pos));
    const gap = unit.radius + 1;
    return clampToArena(w, { x: unit.pos.x + ((from.x - unit.pos.x) / d) * gap, y: unit.pos.y + ((from.y - unit.pos.y) / d) * gap });
  }
  if (ev.id === 'open_shaft' && def.id === 'cat_void' && ev.marks[0] && inView(view, ev.marks[0].pos)) {
    const hole = ev.marks[0].pos;
    const near = w.state.entities.filter(e => e.team === 'enemy' && isAlive(e) && !e.eventTag && dist(e.pos, hole) <= 4).length;
    return near >= 2 ? { x: hole.x, y: hole.y } : undefined;
  }
  if (ev.id === 'sleeping_patient' && healsAllies([def.action]) && unit && inView(view, unit.pos)) return { x: unit.pos.x, y: unit.pos.y };
  if (ev.id === 'dark_lamps' && p.rt.bot.fieldEventPetDone !== w.fieldEvents.startTick && (def.action.affects === 'enemies' || def.action.summon)) {
    const lamp = lampFor(w, p, ev, view);
    if (lamp) {
      p.rt.bot.fieldEventPetDone = w.fieldEvents.startTick;
      return lamp;
    }
  }
  return undefined;
}

/** The lamp this bot goes for: its own (left / middle / right by player index) if unlit and on screen, else the nearest. */
function lampFor(w: World, p: SimPlayer, ev: FieldEventState, view: [number, number]): Vec2 | null {
  const own = ev.marks[p.id % ev.marks.length];
  if (own && own.doneBy == null && inView(view, own.pos)) return { ...own.pos };
  const me = activeEntity(w, p);
  const ref = me ? me.pos : { x: (view[0] + view[1]) / 2, y: w.state.plan.arena.height / 2 };
  let best: Vec2 | null = null;
  for (const m of ev.marks) {
    if (m.doneBy != null || !inView(view, m.pos)) continue;
    if (!best || dist(m.pos, ref) < dist(best, ref)) best = m.pos;
  }
  return best ? { ...best } : null;
}

// ─────────────────────────── Once-per-event swap ───────────────────────────

interface SwapPick {
  idx: number;
  pos: Vec2;
}

function readyCards(w: World, p: SimPlayer): number[] {
  const out: number[] = [];
  p.party.forEach((_, i) => {
    if (canSwap(w, p.id, i).ok) out.push(i);
  });
  return out;
}

const healCard = (p: SimPlayer, idx: number) => healsAllies(getCharacter(p.party[idx].defId).drag.actions);

/** Toad / printer: the card + spot that locks onto the target (and hits it with the drag skill if it can). */
function targetPick(w: World, p: SimPlayer, ev: FieldEventState, ready: number[], view: [number, number]): SwapPick | null {
  const t = eventUnit(w, ev);
  if (!t || !inView(view, t.pos)) return null;
  const me = activeEntity(w, p);
  const from = me ? me.pos : { x: (view[0] + view[1]) / 2, y: t.pos.y };
  const d = Math.max(1e-6, dist(from, t.pos));
  let best: (SwapPick & { score: number }) | null = null;
  for (const idx of ready) {
    for (const k of [0, 1.2, 2]) {
      const pos = clampToArena(w, { x: clamp(t.pos.x + ((from.x - t.pos.x) / d) * k, view[0], view[1]), y: t.pos.y + ((from.y - t.pos.y) / d) * k });
      const out = dropOutcome(w.state, p.id, 'swap', idx, pos);
      if (!out || out.startle) continue;
      const score = (out.lockTargetId != null ? 2 : 0) + (out.hitTargetIds.length > 0 ? 1 : 0) - k * 0.01;
      if (!best || score > best.score) best = { idx, pos, score };
    }
  }
  return best && best.score >= 2 ? best : null;
}

/** Child escort: nobody is with it → the lowest-index bot drops a heal card (else any safe card) just ahead of it. */
function escortPick(w: World, p: SimPlayer, ev: FieldEventState, ready: number[], view: [number, number]): SwapPick | null {
  const ch = eventUnit(w, ev);
  const exit = ev.marks[0];
  if (!ch || !exit || !inView(view, ch.pos)) return null;
  const escort = getFieldEvent(ev.id).params.escort;
  if (w.state.entities.some(e => e.kind === 'character' && isAlive(e) && dist(e.pos, ch.pos) <= escort)) return null;
  // the lowest-index bot does it (benches that drive human seats with these rules: the lowest-index such seat)
  const escorter = w.state.players.find(x => x.isBot && !x.out) ?? w.state.players.find(x => !x.out && !EVENT_BLIND.has(x.id));
  if (escorter !== p) return null;
  const dir = Math.sign(exit.pos.x - ch.pos.x) || 1;
  const order = [...ready.filter(i => healCard(p, i)), ...ready.filter(i => !healCard(p, i))];
  for (const idx of order) {
    // a dash skill carries the character away from the drop: drop so that it ENDS next to the child
    const off = dashOffset(previewPartsFor(w.state, p.id, 'swap', idx));
    for (const [ax, ay] of ESCORT_SPOTS) {
      const stand = { x: ch.pos.x + dir * ax, y: ch.pos.y + ay };
      const pos = clampToArena(w, { x: clamp(stand.x - off.x, view[0], view[1]), y: stand.y - off.y });
      const end = { x: pos.x + off.x, y: pos.y + off.y };
      if (dist(end, ch.pos) > escort - 0.5) continue;
      if (!dropOutcome(w.state, p.id, 'swap', idx, pos)?.startle) return { idx, pos };
    }
  }
  return null;
}

/** Escort spots around the child (x toward the exit, y): ahead first, then beside, then behind. */
const ESCORT_SPOTS: readonly [number, number][] = [
  [ESCORT_LEAD, 0],
  [ESCORT_LEAD, -2.2],
  [ESCORT_LEAD, 2.2],
  [0, -2.8],
  [0, 2.8],
  [-ESCORT_LEAD, 0],
];

/** Where the dropped character stands after its drag skill, relative to the drop point (dash skills move it). */
function dashOffset(parts: PreviewPart[]): Vec2 {
  const off = { x: 0, y: 0 };
  for (const pt of parts) {
    if (!pt.dash) continue;
    const u = pt.dash.dir;
    off.x = pt.offset.x + (u === 'right' ? 1 : u === 'left' ? -1 : 0) * pt.dash.distance;
    off.y = pt.offset.y + (u === 'down' ? 1 : u === 'up' ? -1 : 0) * pt.dash.distance;
  }
  return off;
}

function swapPick(w: World, p: SimPlayer, ev: FieldEventState): SwapPick | null {
  const ready = readyCards(w, p);
  if (ready.length === 0) return null;
  const view = viewOf(w, p);
  switch (ev.id) {
    case 'lucky_toad':
    case 'possessed_printer':
      return targetPick(w, p, ev, ready, view);
    case 'sleeping_patient': {
      const pt = eventUnit(w, ev);
      const idx = ready.find(i => healCard(p, i));
      return pt && idx != null && inView(view, pt.pos) ? { idx, pos: { x: pt.pos.x, y: pt.pos.y } } : null;
    }
    case 'dark_lamps': {
      const lamp = lampFor(w, p, ev, view);
      return lamp ? { idx: ready[0], pos: lamp } : null;
    }
    case 'sleepwalker':
      return escortPick(w, p, ev, ready, view);
    default:
      return null; // 통로: no baiting (a human's job); 23:59: the usual area aim already counts shadows
  }
}

/**
 * Once per event (keyed by its start tick; lamps / escort whenever needed): after the reaction time, if a card is ready
 * and the field character is not in trouble, swap toward the event. Returns true when it swapped.
 */
export function eventThink(w: World, p: SimPlayer, dispatch: Dispatch): boolean {
  const b = p.rt.bot;
  const ev = activeEvent(w);
  if (!ev || EVENT_BLIND.has(p.id)) {
    b.fieldEventReactAt = null;
    return false;
  }
  const key = w.fieldEvents.startTick;
  // lamps and the child's escort are standing jobs (docs 3-6, 3-7): whenever they need it; the rest once per event
  const repeats = ev.id === 'dark_lamps' || ev.id === 'sleepwalker';
  if (!repeats && b.fieldEventSwapDone === key) return false;
  const me = activeEntity(w, p);
  if (me && me.hp < me.maxHp * BOT.lowHpFrac) return false;
  const pick = swapPick(w, p, ev);
  if (!pick) return false;
  const s = w.state;
  if (b.fieldEventReactAt == null) {
    b.fieldEventReactAt = s.time + w.rng.range(BOT.reaction[0], BOT.reaction[1]);
    return false;
  }
  if (s.time < b.fieldEventReactAt) return false;
  b.fieldEventReactAt = null;
  if (!dispatch({ type: 'swap', player: p.id, partyIndex: pick.idx, pos: pick.pos }).ok) return false;
  b.fieldEventSwapDone = key;
  b.nextSwapAt = s.time + w.rng.range(BOT.periodicSwap[0], BOT.periodicSwap[1]);
  b.reactAt = null;
  return true;
}
