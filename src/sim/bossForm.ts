// 기획 20차 보스 형태 (docs/bosses.md 1장 · 3장 N1 · N4): where a boss appears, how a roaming / arena boss walks and
// turns, a relocating boss's seat, taunt immunity after a taunt, and the footprints a walking boss leaves. Everything is
// keyed on BossDef.form — a boss without one (the classic four) never gets rt.form and takes none of these paths.
// No randomness: targets, waypoints, seats and footprints are all "next in order".

import type { BossDef, BossForm, MonsterDef, SkillAction, Vec2 } from '../types';
import { BOSS_POS } from '../config';
import { BOSS_FORM } from '../data/bosses/forms';
import { unitCtx } from './ctx';
import { clampUnit } from './entities';
import { DIR_VEC, type MoveBox } from './geometry';
import { effStats } from './stats';
import { hasStatus } from './status';
import { copy, dist, edgeDist, isAlive, newId, type BossFormRt, type SimEntity, type SimZone, type World } from './world';

/** The form of a def ('fixed' for every non-boss and every boss without the field). */
export function bossFormOf(def: MonsterDef | null | undefined): BossForm {
  return (def as BossDef | null | undefined)?.form ?? 'fixed';
}

/** Centre positions a moving boss may take. */
export function moveBounds(): MoveBox {
  return BOSS_FORM.box;
}

function intoBox(p: Vec2): Vec2 {
  const b = BOSS_FORM.box;
  return { x: Math.min(b.xMax, Math.max(b.xMin, p.x)), y: Math.min(b.yMax, Math.max(b.yMin, p.y)) };
}

/** Where a boss appears: top centre (fixed, as always), its first seat (relocating), its spawn / first waypoint. */
export function bossSpawnPos(def: BossDef): Vec2 {
  const form = bossFormOf(def);
  if (form === 'fixed') return BOSS_POS;
  if (form === 'relocating') return def.spots?.length ? { x: def.spots[0].x, y: def.spots[0].y } : intoBox(BOSS_FORM.roamSpawn);
  return intoBox(def.spawn ?? def.move?.waypoints?.[0] ?? BOSS_FORM.roamSpawn);
}

function dirAngle(d: keyof typeof DIR_VEC): number {
  const u = DIR_VEC[d];
  return Math.atan2(u.y, u.x);
}

/**
 * Floor start (floor.ts, right after the boss is created): a boss with a non-fixed form gets its state, the heavy flag
 * (roaming / arena) and the entrance pose. A relocating boss faces the way its first seat says.
 */
export function initBossForm(e: SimEntity): void {
  const def = e.rt.monDef as BossDef | null;
  const form = bossFormOf(def);
  if (!def || def.tier !== 'boss' || form === 'fixed') return;
  e.rt.form = { form, def, spot: 0, wp: 0, dwell: 0, retargetIn: def.move?.retarget ?? 0, tauntImmune: 0, taunted: false, pinned: false, walked: 0, footprints: [] };
  if (form !== 'relocating') e.rt.heavy = true;
  if (form === 'relocating' && def.spots?.length) e.facing = dirAngle(def.spots[0].facing);
  else if (form !== 'relocating') faceCentre(e);
  e.rt.lockTime = BOSS_FORM.entrance;
  e.anim = 'appear';
  e.animTime = BOSS_FORM.entrance;
}

/**
 * A walking boss comes out looking into the room (the middle of its box), not at the wall behind a side spawn. A spawn
 * on the middle column keeps the default "down".
 */
function faceCentre(e: SimEntity): void {
  const b = BOSS_FORM.box;
  const dx = (b.xMin + b.xMax) / 2 - e.pos.x;
  const dy = (b.yMin + b.yMax) / 2 - e.pos.y;
  if (Math.abs(dx) > 1e-6) e.facing = Math.atan2(dy, dx);
}

/** Heavy bodies push others and are never pushed, pulled or knocked back. */
export function isHeavy(e: SimEntity): boolean {
  return !!e.rt.heavy;
}

/** Only a roaming boss can be taunted, and not for BOSS_FORM.tauntImmune s after a taunt ended (status.ts). */
export function isTauntable(e: SimEntity): boolean {
  const f = e.rt.form;
  return !!f && f.form === 'roaming' && f.tauntImmune <= 0;
}

/**
 * Every tick, also while stunned or casting (units.ts unitTimers): the taunt immunity counts down; the tick a taunt
 * ends it starts, and a patrol boss heads for the nearest point of its route again.
 */
export function tickBossForm(e: SimEntity, f: BossFormRt, dt: number): void {
  const taunted = hasStatus(e, 'taunt');
  if (f.taunted && !taunted) {
    f.tauntImmune = BOSS_FORM.tauntImmune;
    const wps = f.def.move?.waypoints;
    if (wps?.length) f.wp = nearestIndex(wps, e.pos);
  } else if (f.tauntImmune > 0) {
    f.tauntImmune = Math.max(0, f.tauntImmune - dt);
  }
  f.taunted = taunted;
}

function nearestIndex(points: readonly Vec2[], p: Vec2): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = dist(points[i], p);
    if (d < bd - 1e-9) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** The enemy of `e` farthest from it (characters first; 돌발 괴담 wards and untargetable units never; ties → lower id). */
export function farthestEnemy(w: World, e: SimEntity): SimEntity | null {
  let best: SimEntity | null = null;
  let bd = -Infinity;
  let bestChar = false;
  for (const o of w.state.entities) {
    if (o.team === e.team || !isAlive(o) || o.eventTag === 'ward' || o.rt.untargetable) continue;
    const ch = o.kind === 'character';
    const d = edgeDist(e, o);
    if ((ch && !bestChar) || (ch === bestChar && d > bd + 1e-9)) {
      best = o;
      bd = d;
      bestChar = ch;
    }
  }
  return best;
}

const TAU = Math.PI * 2;

function wrapAngle(a: number): number {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Turn e toward `want` (radians) by at most `maxStep`; returns how far off it still is (radians, ≥ 0). */
export function turnToward(e: SimEntity, want: number, maxStep: number): number {
  const d = wrapAngle(want - e.facing);
  const off = Math.abs(d);
  if (off <= maxStep) {
    e.facing = want;
    return 0;
  }
  e.facing = wrapAngle(e.facing + Math.sign(d) * maxStep);
  return off - maxStep;
}

const RAD = Math.PI / 180;

/** Radians the body may turn this tick (data turn rate, faster while enraged). */
function turnStep(e: SimEntity, f: BossFormRt, dt: number): number {
  return (f.def.move?.turnRate ?? BOSS_FORM.turnRate) * (e.enraged ? BOSS_FORM.enrageMove : 1) * RAD * dt;
}

/** Walk `step` cells toward `goal` (already faced); returns the cells really moved (the box may stop it). */
function walk(w: World, e: SimEntity, f: BossFormRt, goal: Vec2, step: number): number {
  const d = dist(e.pos, goal);
  if (d < 1e-6 || step <= 0) return 0;
  const from = copy(e.pos);
  const k = Math.min(1, step / d);
  e.pos.x += (goal.x - e.pos.x) * k;
  e.pos.y += (goal.y - e.pos.y) * k;
  clampUnit(w, e);
  const moved = dist(from, e.pos);
  if (moved > 1e-6) footprints(w, e, f, moved);
  return moved;
}

/** Rule N4 ①: a zone under the body every `every` cells walked, at most `max` (the oldest goes first). */
function footprints(w: World, e: SimEntity, f: BossFormRt, moved: number): void {
  const tr = f.def.trail;
  if (!tr || tr.every <= 0) return;
  f.walked += moved;
  while (f.walked >= tr.every - 1e-9) {
    f.walked -= tr.every;
    const z = dropTrailZone(w, e, e.pos, tr.radius * w.tunables.bossAreaMult, tr, (f.trailHit ??= new Map()));
    const live = new Set(w.state.zones.map(x => x.id));
    f.footprints = f.footprints.filter(id => live.has(id));
    f.footprints.push(z.id);
    while (f.footprints.length > Math.max(1, tr.max)) removeZone(w, f.footprints.shift()!);
  }
}

function removeZone(w: World, id: number): void {
  const list = w.state.zones;
  const i = list.findIndex(z => z.id === id);
  if (i >= 0) list.splice(i, 1);
}

/** What a trail zone needs (BossTrailDef and SkillAction.trail both fit). */
export interface TrailSpec {
  duration: number;
  tickInterval: number;
  effects: SkillAction['effects'];
  look?: string;
}

/**
 * A trail circle of `caster` at `at` (rule N4): it lingers for `duration` s and re-applies the effects every
 * tickInterval — the first time one interval after it appeared (never on the tick it is laid: the body stands on it,
 * or the charge that drew it has just hit). `hit` = the map shared by every circle of this trail: overlapping circles
 * reach a unit once per interval between them, so a trail hurts like the one field it looks like.
 */
export function dropTrailZone(w: World, caster: SimEntity, at: Vec2, radius: number, spec: TrailSpec, hit: Map<number, number>): SimZone {
  const tick = Math.max(0.05, spec.tickInterval);
  const area = { shape: 'circle' as const, radius };
  const action: SkillAction = { center: 'point', area, affects: 'enemies', effects: spec.effects, zone: { duration: spec.duration, tickInterval: tick } };
  const debuffOnly = !spec.effects.some(x => x.kind === 'damage');
  const z: SimZone = {
    id: newId(w),
    team: caster.team,
    ownerPlayer: null,
    center: copy(at),
    radius,
    area,
    remaining: spec.duration,
    total: spec.duration,
    kind: debuffOnly ? 'debuff' : 'damage',
    ...(spec.look ? { look: spec.look } : null),
    rt: { ctx: { ...unitCtx(w, caster, `${caster.defId}_trail`, ''), radiusMult: 1, fromZone: true, trail: { hit, gap: tick } }, action, nextTick: tick, tickInterval: tick, actionIndex: 0, tickNo: 1 },
  };
  w.state.zones.push(z);
  return z;
}

/** What the body did this tick: it walked, and / or its target is in reach and faced (it may swing). */
export interface BossStepResult {
  moved: boolean;
  attack: boolean;
}
const STEP: BossStepResult = { moved: false, attack: false };
function stepResult(moved: boolean, attack: boolean): BossStepResult {
  STEP.moved = moved;
  STEP.attack = attack;
  return STEP;
}

/**
 * One tick of a form boss that is free to act (not casting, not stunned): turn, walk by its move mode, and say whether
 * it may swing now (units.ts then fires the basic attack). The returned object is reused — read it before the next call.
 *   seated (relocating) — never turns or walks; shoots from its seat like a fixed boss
 *   pursue              — walks to the target and stops in range (`axis`: x first, then y only; axisAlternate:
 *                         every second re-pick y first, then x)
 *   keepAway            — backs off inside keep.min, closes in beyond keep.max; shoots all the while
 *   patrol / path       — rounds its waypoints, resting `dwell` s on each; shoots on the move
 * A taunt (roaming only) turns any mode into "walk up to the taunter".
 */
export function bossStep(w: World, e: SimEntity, f: BossFormRt, t: SimEntity | null, dt: number): BossStepResult {
  const mv = f.def.move;
  const st = effStats(w, e);
  const target = t && isAlive(t) ? t : null;
  const inReach = (reach: number): boolean => !!target && edgeDist(e, target) <= reach;
  if (f.form === 'relocating' || !mv) return stepResult(false, inReach(st.range));

  const speed = st.moveSpeed * dt;
  const turn = turnStep(e, f, dt);
  const cone = BOSS_FORM.walkCone * RAD;
  const taunted = f.form === 'roaming' && hasStatus(e, 'taunt');
  const mode = taunted ? 'pursue' : mv.mode;
  /** Turn to `goal`, then walk up to `step` when it is within the walk cone. */
  const go = (goal: Vec2, step: number): boolean => {
    const off = turnToward(e, Math.atan2(goal.y - e.pos.y, goal.x - e.pos.x), turn);
    return off <= cone + 1e-9 && walk(w, e, f, goal, step) > 1e-6;
  };
  const faceTarget = (): boolean => !!target && turnToward(e, Math.atan2(target.pos.y - e.pos.y, target.pos.x - e.pos.x), turn) <= cone + 1e-9;

  if (mode === 'pursue') {
    if (!target) return stepResult(false, false);
    // a taunted ranged boss still walks up to its taunter
    const range = taunted && mv.mode !== 'pursue' ? Math.min(st.range, BOSS_FORM.tauntReach) : st.range;
    const d = edgeDist(e, target);
    // 기획 20차 점검: x is lined up against where the body CAN stand — a target outside the box (hugging a side wall)
    // used to keep an `axis` mover pressed against that wall for ever, never taking its vertical leg
    const at = intoBox(target.pos);
    const axis = !!mv.axis && !taunted;
    // axisAlternate: x leads on the first two picks, then y and x take turns with every re-pick
    const yFirst = axis && !!mv.axisAlternate && (f.retargets ?? 0) > 0 && (f.retargets ?? 0) % 2 === 0;
    const lead = yFirst ? at.y - e.pos.y : at.x - e.pos.x;
    let goal: Vec2 | null = null;
    let step = speed;
    if (axis && Math.abs(lead) > BOSS_FORM.axisSnap) {
      goal = yFirst ? { x: e.pos.x, y: at.y } : { x: at.x, y: e.pos.y };
      step = Math.min(speed, Math.abs(lead));
    } else if (d > range) {
      goal = !axis ? target.pos : yFirst ? { x: target.pos.x, y: e.pos.y } : { x: e.pos.x, y: target.pos.y };
      step = Math.min(speed, d - range + 0.02);
    }
    if (!goal) {
      f.pinned = false;
      // in range: face the target and swing once it is inside the walk cone (an `axis` mover tosses without turning)
      return stepResult(false, faceTarget() || axis);
    }
    const walked = go(goal, step);
    // it faces the way but the box stops it (a character in the very corner): it reaches a little farther
    f.pinned = !walked && isFacing(e, goal, cone);
    const reach = st.range + (f.pinned ? BOSS_FORM.pinReach : 0);
    return stepResult(walked, inReach(reach) && (axis || isFacing(e, target.pos, cone)));
  }

  if (mode === 'keepAway') {
    if (!target) return stepResult(false, false);
    const keep = mv.keep ?? { min: 4, max: 7 };
    const d = dist(e.pos, target.pos);
    let walked = false;
    if (d < keep.min) {
      const ux = d > 1e-6 ? (e.pos.x - target.pos.x) / d : Math.cos(e.facing);
      const uy = d > 1e-6 ? (e.pos.y - target.pos.y) / d : Math.sin(e.facing);
      const far = keep.min - d + 1;
      walked = go({ x: e.pos.x + ux * far, y: e.pos.y + uy * far }, Math.min(speed, keep.min - d + 0.02));
    } else if (d > keep.max) {
      walked = go(target.pos, Math.min(speed, d - keep.max + 0.02));
    } else {
      faceTarget();
    }
    return stepResult(walked, inReach(st.range));
  }

  // patrol / path
  const wps = mv.waypoints;
  let walked = false;
  if (wps && wps.length > 0) {
    if (f.dwell > 0) {
      f.dwell = Math.max(0, f.dwell - dt);
    } else {
      const goal = intoBox(wps[f.wp % wps.length]);
      const d = dist(e.pos, goal);
      if (d <= 1e-6) {
        f.wp = (f.wp + 1) % wps.length;
        f.dwell = mv.dwell ?? 0;
      } else {
        walked = go(goal, Math.min(speed, d));
      }
    }
  }
  return stepResult(walked, inReach(st.range));
}

function isFacing(e: SimEntity, goal: Vec2, cone: number): boolean {
  return Math.abs(wrapAngle(Math.atan2(goal.y - e.pos.y, goal.x - e.pos.x) - e.facing)) <= cone + 1e-9;
}

/** The facing of a relocating boss's seat (radians). */
export function spotFacing(def: BossDef, index: number): number {
  const s = def.spots?.[index];
  return s ? dirAngle(s.facing) : Math.PI / 2;
}
