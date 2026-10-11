// 기획 20차 (rule N8, docs/bosses.md 3장 — 보스 레이드만): a character walks around the zones an enemy left on the ground.
// Warnings (telegraphs) are never read — those are answered by swapping. Rules, in order:
//   ① standing in a zone → walk out to the nearest clean point
//   ② the spot it would attack from is in a zone → the nearest clean one of 8 spots around the target
//   ③ a zone `look` cells ahead on the way → side-step 35° / 70° / 105° (the side once picked is kept)
//   ④ no way around (`patience` s without getting closer) → give up and walk in (it fights where it stands for `commit` s)
//   ⑤ melee and every spot around the target is covered → walk in at once
// With it comes one more thing a small moving boss needs: a spot another ally already stands on is not a spot (②) — a
// melee character queued straight behind another one would push into its back for ever; it takes the next free spot
// around the target instead.
// 기획 20차 점검 (docs/balance.md 19-7 — each one froze a character in the soft-lock probe): a step must also LAND clean
// (③), only the character's own approach is progress (④), the crowd rule holds after it gave up too, and a body that
// never yields head-on in the way is stepped around (headOn).
// 기획 20차 점검 (rule N9, 안전한 자리 지키기): a character standing outside the warning of a find-the-safe-spot part (a ring
// that covers the arena, a part flagged keepOut) does not walk into it — it waits where it was dropped. And once it gave
// up on the zones (④) it stays given up until it stands in reach: the `commit` seconds count from there.
// No randomness. units.ts calls steer() only for kind 'character' in a boss raid with ZONE_AVOID.on, so the classic
// tower and 원정 keep walking straight through.

import type { AreaShape, Vec2 } from '../types';
import { SAFE_HOLD, ZONE_AVOID } from '../data/bosses/forms';
import { hitsArea } from './geometry';
import { ARENA_MARGIN } from './constants';
import { arena, dist, isAlive, type AvoidRt, type PendingHit, type SimEntity, type SimZone, type World } from './world';

/** 'default' = act as always (walk straight / attack) · 'moved' = it took its step · 'wait' = blocked, standing still. */
export type SteerResult = 'default' | 'moved' | 'wait';

const RAD = Math.PI / 180;
const CIRCLE = (z: SimZone): AreaShape => z.area ?? { shape: 'circle', radius: z.radius };

/** Enemy zones worth walking around: damage / debuff fields with time left, the nearest ZONE_AVOID.maxZones. */
function hazards(w: World, e: SimEntity): SimZone[] {
  const out: SimZone[] = [];
  for (const z of w.state.zones) {
    if (z.team === e.team || (z.kind !== 'damage' && z.kind !== 'debuff') || z.remaining < ZONE_AVOID.minLeft) continue;
    out.push(z);
  }
  if (out.length > ZONE_AVOID.maxZones) {
    out.sort((a, b) => dist(a.center, e.pos) - a.radius - (dist(b.center, e.pos) - b.radius) || a.id - b.id);
    out.length = ZONE_AVOID.maxZones;
  }
  return out;
}

/** Would a body of `radius` at p be touched by one of the zones (with the clearance pad)? */
function covered(zs: readonly SimZone[], p: Vec2, radius: number): boolean {
  for (const z of zs) if (hitsArea(CIRCLE(z), z.center, z.center, p, radius + ZONE_AVOID.pad)) return true;
  return false;
}

function inArena(w: World, p: Vec2): boolean {
  const a = arena(w);
  return p.x >= ARENA_MARGIN - 1e-9 && p.x <= a.width - ARENA_MARGIN + 1e-9 && p.y >= ARENA_MARGIN - 1e-9 && p.y <= a.height - ARENA_MARGIN + 1e-9;
}

const clean = (w: World, zs: readonly SimZone[], p: Vec2, radius: number): boolean => inArena(w, p) && !covered(zs, p, radius);

/** Is another body (either side — the boss too) standing on p? */
function bodyAt(w: World, e: SimEntity, p: Vec2): boolean {
  for (const o of w.state.entities) {
    if (o === e || !isAlive(o) || o.rt.untargetable) continue;
    if (dist(o.pos, p) < (e.radius + o.radius) * TAKEN) return true;
  }
  return false;
}

/**
 * Rule ①: the nearest clean point around e (rings of 0.3 cells, 16 directions) that no body stands on — walking "out"
 * into the boss's body would only be pushed back in. Null within ZONE_AVOID.exit cells.
 */
function exitPoint(w: World, zs: readonly SimZone[], e: SimEntity): Vec2 | null {
  for (let r = 0.3; r <= ZONE_AVOID.exit + 1e-9; r += 0.3) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const p = { x: e.pos.x + Math.cos(a) * r, y: e.pos.y + Math.sin(a) * r };
      if (clean(w, zs, p, e.radius) && !bodyAt(w, e, p)) return p;
    }
  }
  return null;
}

/** Is another ally body standing on p (a spot e could not take without pushing it)? */
function taken(w: World, e: SimEntity, p: Vec2): boolean {
  for (const o of w.state.entities) {
    if (o === e || o.team !== e.team || !isAlive(o) || o.rt.untargetable) continue;
    if (dist(o.pos, p) < (e.radius + o.radius) * TAKEN) return true;
  }
  return false;
}

/** Two bodies closer than this share of their radii count as "on the same spot". */
const TAKEN = 0.9;

/** The straight spot (on the line target → e) is the one plain walking ends on. */
interface Spot {
  pos: Vec2;
  straight: boolean;
}

/**
 * Rule ②: where to stand to attack t from `reach` (centre distance): straight ahead, else the nearest of 8 spots around
 * t — clean (no zone, inside the arena) and not taken by another ally.
 */
function standSpot(w: World, zs: readonly SimZone[], e: SimEntity, t: SimEntity, reach: number): Spot | null {
  const d = dist(e.pos, t.pos);
  if (d > 1e-6) {
    const p = { x: t.pos.x + ((e.pos.x - t.pos.x) / d) * reach, y: t.pos.y + ((e.pos.y - t.pos.y) / d) * reach };
    if (clean(w, zs, p, e.radius) && !taken(w, e, p)) return { pos: p, straight: true };
  }
  let best: Vec2 | null = null;
  let bd = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const p = { x: t.pos.x + Math.cos(a) * reach, y: t.pos.y + Math.sin(a) * reach };
    if (!clean(w, zs, p, e.radius) || taken(w, e, p)) continue;
    const dd = dist(p, e.pos);
    if (dd < bd - 1e-9) {
      bd = dd;
      best = p;
    }
  }
  return best ? { pos: best, straight: false } : null;
}

/**
 * Rule ③: the unit direction of this step (`step` cells) toward `goal` — straight when the way ahead is clean, else a
 * side step. "Clean" = the point `look` cells ahead AND the spot this very step lands on: a step that ends in a zone's
 * edge would be walked back out by rule ① on the next tick, for ever (the character shivers in place).
 */
function stepDir(w: World, zs: readonly SimZone[], e: SimEntity, goal: Vec2, av: AvoidRt, step: number, dt: number): Vec2 | null {
  const d = dist(e.pos, goal);
  if (d < 1e-6) return null;
  const ux = (goal.x - e.pos.x) / d;
  const uy = (goal.y - e.pos.y) / d;
  const k = Math.min(step, d);
  const open = (vx: number, vy: number, look: number): boolean =>
    clean(w, zs, { x: e.pos.x + vx * look, y: e.pos.y + vy * look }, e.radius) && clean(w, zs, { x: e.pos.x + vx * k, y: e.pos.y + vy * k }, e.radius);
  if (open(ux, uy, Math.min(ZONE_AVOID.look, d))) {
    // the side is forgotten only after the straight way stayed clean for a moment (no left / right flicker)
    av.clear += dt;
    if (av.clear >= SIDE_KEEP) av.side = 0;
    return { x: ux, y: uy };
  }
  av.clear = 0;
  const sides = av.side !== 0 ? [av.side, -av.side] : [1, -1];
  for (const s of sides) {
    for (const deg of ZONE_AVOID.angles) {
      const c = Math.cos(deg * RAD * s);
      const sn = Math.sin(deg * RAD * s);
      const vx = ux * c - uy * sn;
      const vy = ux * sn + uy * c;
      if (!open(vx, vy, ZONE_AVOID.look)) continue;
      av.side = s;
      return { x: vx, y: vy };
    }
  }
  return null;
}

/** Seconds the straight way must stay clean before the picked side is dropped. */
const SIDE_KEEP = 0.5;

function giveUp(av: AvoidRt): SteerResult {
  fresh(av);
  av.commit = ZONE_AVOID.commit;
  return 'default';
}

/** A new approach: nothing is held against it yet. */
function fresh(av: AvoidRt): void {
  av.stuck = 0;
  av.best = Infinity;
  av.seen = null;
}

/** Getting this much closer to the target counts as progress (cells). */
const PROGRESS = 0.05;

/** Rule N9: the shown enemy warnings a character does not walk into (safe-spot rings, keepOut parts). */
function keepOuts(w: World, e: SimEntity): PendingHit[] {
  const out: PendingHit[] = [];
  if (!SAFE_HOLD.on) return out;
  for (const p of w.pending) {
    if (p.kind !== 'hit' || p.started || p.cancelled || p.telegraphId == null || p.ctx.team === e.team) continue;
    const a = p.area;
    if (p.action.keepOut || (a.shape === 'ring' && a.outer >= SAFE_HOLD.safeOuter)) out.push(p);
  }
  return out;
}

/** Would a step from `from` to `to` carry e into a held warning it is not standing in yet? */
function entersHeld(held: readonly PendingHit[], e: SimEntity, from: Vec2, to: Vec2): boolean {
  for (const p of held) {
    if (hitsArea(p.area, p.center, p.origin, to, e.radius) && !hitsArea(p.area, p.center, p.origin, from, e.radius)) return true;
  }
  return false;
}

/**
 * One tick of a raid character with target t: `range` = its attack range (edge distance), `step` = the cells it may walk
 * this tick. Moves e itself when it returns 'moved'. Rule N9 on top of the zone rules: a step (its own, or the plain
 * walk units.ts would take on 'default') that enters a held warning is not taken — 'wait'.
 */
export function steer(w: World, e: SimEntity, t: SimEntity, range: number, step: number, dt: number): SteerResult {
  const held = keepOuts(w, e);
  if (held.length === 0) return steerZones(w, e, t, range, step, dt);
  const from = { x: e.pos.x, y: e.pos.y };
  const r = steerZones(w, e, t, range, step, dt);
  if (r === 'wait') return r;
  if (r === 'moved') {
    if (!entersHeld(held, e, from, e.pos)) return r;
    e.pos.x = from.x;
    e.pos.y = from.y;
    return 'wait';
  }
  const far = dist(e.pos, t.pos);
  const gap = far - e.radius - t.radius;
  if (gap <= range || far < 1e-6) return r; // in reach: it attacks from where it stands
  const k = Math.min(step, gap - range + 0.02) / far;
  const to = { x: e.pos.x + (t.pos.x - e.pos.x) * k, y: e.pos.y + (t.pos.y - e.pos.y) * k };
  return entersHeld(held, e, from, to) ? 'wait' : r;
}

/** The zone rules ① – ⑤ (the header of this file). */
function steerZones(w: World, e: SimEntity, t: SimEntity, range: number, step: number, dt: number): SteerResult {
  const av = (e.rt.avoid ??= { side: 0, clear: 0, stuck: 0, best: Infinity, commit: 0, seen: null, seenId: 0 });
  if (av.commit > 0) {
    // it fights where it stands — but never by pushing into an ally's back (the crowd rule holds here too).
    // 기획 20차 점검: the seconds only run once it stands in reach. A character that gave up 8 cells behind a body that
    // keeps walking (커피 머신 along the bottom wall) used to step back out of the footprints after 3 s, wait, walk in
    // again … and never caught up; now it stays on the chase until it has reached its target.
    if (dist(e.pos, t.pos) - e.radius - t.radius <= range) av.commit = Math.max(0, av.commit - dt);
    return crowdStep(w, e, t, range, step);
  }
  const zs = hazards(w, e);
  // ① out of a zone under its feet first
  if (zs.length > 0 && covered(zs, e.pos, e.radius)) {
    const out = exitPoint(w, zs, e);
    if (!out) return giveUp(av);
    fresh(av);
    moveToward(e, out, step);
    return 'moved';
  }
  const far = dist(e.pos, t.pos);
  const gap = far - e.radius - t.radius;
  if (gap <= range) {
    fresh(av);
    return 'default'; // clean and in range: attack as always
  }
  if (zs.length === 0) {
    fresh(av);
    return crowdStep(w, e, t, range, step);
  }
  // ② the spot to attack from
  const found = standSpot(w, zs, e, t, standReach(e, t, range));
  // ④ `patience` s without getting any closer (standing blocked, or sliding along a wall of zones) → walk in
  // the target walking closer by itself is not this character's progress: a slow boss coming its way must not keep
  // it standing (or pacing along a wall of zones) for as long as the zones last
  if (av.seen && av.seenId === t.id) av.best -= Math.max(0, dist(e.pos, av.seen) - far);
  av.seen = { x: t.pos.x, y: t.pos.y };
  av.seenId = t.id;
  if (far < av.best - PROGRESS) {
    av.best = far;
    av.stuck = 0;
  } else {
    av.stuck += dt;
    if (av.stuck >= ZONE_AVOID.patience - 1e-9) return giveUp(av);
  }
  if (!found) return range <= ZONE_AVOID.melee ? giveUp(av) : 'wait'; // ⑤ / waiting
  const spot = found.pos;
  // ③ one step toward it, around what lies on the way
  const dir = stepDir(w, zs, e, spot, av, step, dt);
  if (!dir) return 'wait';
  const k = Math.min(step, dist(e.pos, spot));
  e.pos.x += dir.x * k;
  e.pos.y += dir.y * k;
  return 'moved';
}

/** Centre distance e attacks t from (a hair inside its range). */
function standReach(e: SimEntity, t: SimEntity, range: number): number {
  return e.radius + t.radius + Math.max(0, range - 0.05);
}

/**
 * No zone to mind (none on the floor, or it gave up on them): plain walking, unless an ally stands where that would end
 * — then one step to the next free spot around t — or a body that never yields stands head-on in the way (headOn).
 */
function crowdStep(w: World, e: SimEntity, t: SimEntity, range: number, step: number): SteerResult {
  if (dist(e.pos, t.pos) - e.radius - t.radius <= range) return 'default';
  const found = standSpot(w, [], e, t, standReach(e, t, range));
  const goal = found && !found.straight ? found.pos : t.pos;
  if (headOn(w, e, t, goal, step)) return 'moved';
  if (!found || found.straight) return 'default';
  moveToward(e, found.pos, step);
  return 'moved';
}

/** Walking at a body within this sine of dead centre counts as head-on (about 15°). */
const HEAD_ON = 0.25;

/**
 * An enemy body that is never pushed and is not e's target (a fake window left on a desk, a boss between e and a
 * summon) right on its way: bodies only push apart along the line between their centres, so a character walking
 * straight at one would lean on it for as long as it stands. One step sideways instead (toward the goal's side; dead
 * centre → by its id) — from there it slides around as bodies always do. True when it took that step.
 */
function headOn(w: World, e: SimEntity, t: SimEntity, goal: Vec2, step: number): boolean {
  const gd = dist(e.pos, goal);
  if (gd < 1e-6) return false;
  const ux = (goal.x - e.pos.x) / gd;
  const uy = (goal.y - e.pos.y) / gd;
  for (const o of w.state.entities) {
    if (o === t || o.team === e.team || !isAlive(o) || o.rt.untargetable || !(o.rt.stationary || o.rt.heavy)) continue;
    const ox = o.pos.x - e.pos.x;
    const oy = o.pos.y - e.pos.y;
    const od = Math.hypot(ox, oy);
    const reach = e.radius + o.radius;
    if (od < 1e-6 || od > reach + step || od >= gd) continue; // not touching it yet, or the goal comes first
    const cross = (ux * oy - uy * ox) / od; // > 0: the body lies to the right of the way (screen: clockwise)
    if (ux * ox + uy * oy <= 0 || Math.abs(cross) >= HEAD_ON) continue;
    const side = cross > 1e-9 ? -1 : cross < -1e-9 ? 1 : e.id % 2 === 0 ? 1 : -1;
    for (const s of [side, -side]) {
      const p = { x: e.pos.x + (-oy / od) * s * step, y: e.pos.y + (ox / od) * s * step };
      if (!inArena(w, p)) continue;
      e.pos.x = p.x;
      e.pos.y = p.y;
      return true;
    }
  }
  return false;
}

function moveToward(e: SimEntity, p: Vec2, step: number): void {
  const d = dist(e.pos, p);
  if (d < 1e-6) return;
  const k = Math.min(1, step / d);
  e.pos.x += (p.x - e.pos.x) * k;
  e.pos.y += (p.y - e.pos.y) * k;
}
