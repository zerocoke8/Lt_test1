// Shared skill-action executor (drag / normal / ult / pet / monster skills):
// center → area → targets → effects, with telegraphed delays, multi-hits, zones and summons.

import { CONTROL_STATUSES, DEBUFFS, type Affects, type AreaShape, type Dir, type Effect, type MonsterDef, type SkillAction, type Team, type Telegraph, type Vec2 } from '../types';
import { getMonster } from '../data';
import { BOSS_FORM } from '../data/bosses/forms';
import { dropTrailZone, spotFacing } from './bossForm';
import { ARENA_MARGIN, SUMMON_SPREAD } from './constants';
import { benchHeal, benchStatus, effectPlayers, reduceRevive } from './bench';
import { addShield, heal, hitDamage, reduceBenchSwapCd } from './combat';
import { clampUnit, createUnit } from './entities';
import { DASH_DEFAULT_DURATION, DIR_VEC, aimDir, areaExtent, chargeEnd, chargeEndIn, dashEnd, faceArea, faceVec, hitsArea, scaleArea, scaleDash } from './geometry';
import { groggyOnAction, isGroggy } from './groggy';
import { effStats } from './stats';
import { applyStatus, cleanse, constrainTether, hasStatus, statusImmune } from './status';
import { rwOnDelay, rwOnDragEnd, rwOnDragHit, rwOnHealOverflow, rwStatusDuration } from './rewards/hooks';
import {
  arena,
  clampToArena,
  copy,
  countEnemies,
  dist,
  emit,
  getEntity,
  isAlive,
  newId,
  otherTeam,
  queuedEnemies,
  type CastCtx,
  type PendingHit,
  type PendingReward,
  type SimEntity,
  type SimZone,
  type World,
} from './world';

export { scaleArea };

export interface CastOpts {
  /** Recast without moving the caster (echo_seal repeats a dash skill's hits, not the dash). */
  noDash?: boolean;
}

export function castSkill(w: World, ctx: CastCtx, actions: readonly SkillAction[], opts?: CastOpts): void {
  actions.forEach((a, i) => startAction(w, ctx, a, opts, i));
}

export function resolveCenter(w: World, ctx: CastCtx, which: SkillAction['center']): Vec2 {
  if (which === 'arena') return { x: 0, y: 0 }; // 기획 20차 (rule N2): the part's offset is the arena coordinate
  if (which === 'point' && ctx.point) return copy(ctx.point);
  if (which === 'woundedAlly') {
    // 기획 12차 (메딕 응급 주사): the ally picked at cast time (ctx.ts), else the caster itself
    const a = getEntity(w, ctx.allyTargetId) ?? getEntity(w, ctx.selfId);
    return copy(a ? a.pos : ctx.origin);
  }
  if (which === 'self') {
    const s = getEntity(w, ctx.selfId);
    if (s) return copy(s.pos);
    return copy(ctx.point ?? ctx.origin);
  }
  const t = getEntity(w, ctx.targetId);
  if (t) return copy(t.pos);
  if (ctx.targetPos) return copy(ctx.targetPos);
  if (ctx.point) return copy(ctx.point);
  const s = getEntity(w, ctx.selfId);
  return s ? copy(s.pos) : copy(ctx.origin);
}

function originOf(w: World, ctx: CastCtx): Vec2 {
  const c = getEntity(w, ctx.casterId) ?? getEntity(w, ctx.selfId);
  return c ? copy(c.pos) : copy(ctx.origin);
}

export function addTelegraph(w: World, team: Team, center: Vec2, origin: Vec2, area: AreaShape, delay: number, self = false, extra?: TeleExtra): Telegraph {
  const t: Telegraph = { id: newId(w), team, center: copy(center), origin: copy(origin), area, remaining: delay, total: delay };
  if (self) t.self = true; // 기획 19차 (rule M1)
  // 기획 20차: what the part is (charge / arrive / sweep) and who a bound part is tied to — absent on every old part
  if (extra?.motif) t.motif = extra.motif;
  if (extra?.mark != null) t.mark = extra.mark;
  w.state.telegraphs.push(t);
  return t;
}

/** 기획 20차: the optional Telegraph fields of a part's warning. */
interface TeleExtra {
  motif?: Telegraph['motif'];
  mark?: number;
}

function teleExtra(p: PendingHit): TeleExtra | undefined {
  const mark = p.action.bound ? p.ctx.bound?.ent.id : undefined;
  return p.motif || mark != null ? { motif: p.motif, mark } : undefined;
}

/** Where the caster faces (radians; 0 without one) — rule N2's `rel: 'facing'`. */
function casterFacing(w: World, ctx: CastCtx): number {
  return getEntity(w, ctx.casterId)?.facing ?? 0;
}

/** A part's area for this cast: scaled by the cast's radius multiplier, a rel 'facing' rect / cone turned to the caster. */
function partArea(w: World, ctx: CastCtx, action: SkillAction): AreaShape {
  const a = action.fixedArea ? action.area : scaleArea(action.area, ctx.radiusMult); // 기획 20차 점검: grid cells keep their size
  return action.rel === 'facing' ? faceArea(a, casterFacing(w, ctx)) : a;
}

/**
 * 기획 19차 (rule M1, docs/bosses.md 3장): a boss's delayed part on itself (heal / shield / haste / 간주). Its telegraph
 * is marked `self` — a yellow ring, never a danger. Only a tier-'boss' caster, so nothing else changes.
 */
function isBossSelfCast(w: World, ctx: CastCtx, action: SkillAction): boolean {
  if (action.affects !== 'self' || ctx.team !== 'enemy') return false;
  return getEntity(w, ctx.casterId)?.tier === 'boss';
}

/** A tier-'boss' enemy's one-target part (no classic boss has one, so classic telegraphs are unchanged). */
function isBossSingle(w: World, ctx: CastCtx, action: SkillAction): boolean {
  if (action.area.shape !== 'single' || action.affects !== 'enemies' || ctx.team !== 'enemy') return false;
  return getEntity(w, ctx.casterId)?.tier === 'boss';
}

function removeTelegraph(w: World, id: number | null): void {
  if (id == null) return;
  const list = w.state.telegraphs;
  const i = list.findIndex(t => t.id === id);
  if (i >= 0) list.splice(i, 1);
}

/** Resolved center + the action's fixed world offset (3차: one skill hitting several spots). */
export function actionCenter(w: World, ctx: CastCtx, action: SkillAction): Vec2 {
  const c = resolveCenter(w, ctx, action.center);
  if (action.offset) {
    // 기획 20차 (rule N2): a rel 'facing' offset is "ahead / to the right of the caster"
    const o = action.rel === 'facing' ? faceVec(action.offset, casterFacing(w, ctx)) : action.offset;
    c.x += o.x;
    c.y += o.y;
  }
  return c;
}

/**
 * R28 dash: the caster (already standing at the resolved center) moves toward dir by distance, clamped into the
 * arena. Implemented as an immediate reposition; the 'dash' event lets the renderer animate the streak.
 */
function doDash(w: World, ctx: CastCtx, from: Vec2 | null, dash: NonNullable<SkillAction['dash']>): void {
  const caster = getEntity(w, ctx.casterId);
  if (!caster) return;
  const start = from ?? copy(caster.pos);
  const d = scaleDash(dash, ctx.radiusMult);
  const mg = Math.max(ARENA_MARGIN, Math.min(caster.radius, 1));
  const to = dashEnd(start, d.dir, d.distance, arena(w), mg, d.rot);
  caster.pos.x = to.x;
  caster.pos.y = to.y;
  // 기획 13차 atFire (거너 반동): the caster is shoved, it keeps facing where it fired. 기획 22차: an aimed dash (rot)
  if (!dash.atFire) caster.facing = d.rot != null ? (d.rot * Math.PI) / 180 : facingOf(d.dir);
  constrainTether(caster);
  emit(w, { type: 'dash', entityId: caster.id, from: copy(start), to: copy(caster.pos), duration: dash.duration ?? DASH_DEFAULT_DURATION });
}

function facingOf(d: Dir): number {
  const u = DIR_VEC[d];
  return Math.atan2(u.y, u.x);
}

/** Auto-aimed shapes start at the caster and point at the resolved center (geometry.ts). */
function isAimed(a: AreaShape): boolean {
  return a.shape === 'line' || a.shape === 'fan';
}

/** Default rush animation length for SkillAction.charge (render only; the sim moves the caster at once). */
export const CHARGE_DEFAULT_DURATION = 0.3;

/**
 * 기획 8차 blink: the caster vanishes and reappears next to its current target (on the side it came from), `offset`
 * units of gap between the two bodies. Happens at cast time, so the telegraph that follows is drawn at the new spot.
 */
function doBlink(w: World, ctx: CastCtx, blink: NonNullable<SkillAction['blink']>): void {
  const c = getEntity(w, ctx.casterId);
  const t = getEntity(w, ctx.targetId);
  if (!c || !t || c.rt.stationary) return;
  blinkTo(w, c, t, blink.offset, !!blink.behind);
}

/** Teleport `c` next to `t` (the side it came from, or the far side when behind), `gap` units between the bodies. */
function blinkTo(w: World, c: SimEntity, t: SimEntity, gap: number, behind: boolean, hop?: { n: number; of: number }): void {
  const from = copy(c.pos);
  const u = aimDir(t.pos, c.pos, { x: -1, y: 0 });
  const k = (t.radius + c.radius + Math.max(0, gap)) * (behind ? -1 : 1);
  c.pos.x = t.pos.x + u.x * k;
  c.pos.y = t.pos.y + u.y * k;
  clampUnit(w, c);
  c.facing = Math.atan2(t.pos.y - c.pos.y, t.pos.x - c.pos.x);
  emit(w, { type: 'blink', entityId: c.id, from, to: copy(c.pos), ...(hop ? { hop: hop.n, hops: hop.of } : null) });
}

/** Hits of an action (blinkChain: its hop count) and the gap between them. */
function hitCount(a: SkillAction): number {
  return Math.max(1, a.blinkChain?.count ?? a.hits ?? 1);
}
function hitGap(a: SkillAction): number {
  return a.blinkChain?.interval ?? a.hitInterval ?? 0.2;
}

/**
 * A part's wind-up of this cast: its data delay × the cast's delayMult (기획 19차 보스 예고 시간 배율 — bosses only, 1
 * elsewhere). The gaps between the parts of a sweep scale with it; hit intervals, zones and cooldowns do not.
 */
export function actionDelay(ctx: CastCtx, action: SkillAction): number {
  return (action.delay ?? 0) * (ctx.delayMult ?? 1);
}

/**
 * 기획 20차 점검 (rule N6): a mark is for a character. A boss that holds a pet or a summon when it casts a `bound` part
 * marks the character nearest to it instead (lower id on a tie) — a turret cannot be swapped out, so the mark would
 * never have been anyone's to answer. No character on the field → the target stays.
 */
function markCharacter(w: World, ctx: CastCtx): void {
  const t = getEntity(w, ctx.targetId);
  const c = getEntity(w, ctx.casterId);
  if (!t || !c || t.kind === 'character') return;
  let best: SimEntity | null = null;
  let bd = Infinity;
  for (const o of w.state.entities) {
    if (o.team === ctx.team || o.kind !== 'character' || o.rt.gone || o.hp <= 0) continue;
    const d = dist(c.pos, o.pos);
    if (d < bd - 1e-9) {
      bd = d;
      best = o;
    }
  }
  if (!best) return;
  ctx.targetId = best.id;
  ctx.targetPos = copy(best.pos);
}

/** Starts one action; returns its pending hit when it is delayed (telegraphed), else null. index = its place in the skill. */
export function startAction(w: World, ctx: CastCtx, action: SkillAction, opts?: CastOpts, index = 0): PendingHit | null {
  if (action.bound && !ctx.bound) markCharacter(w, ctx);
  if (action.blink) doBlink(w, ctx, action.blink);
  let center = actionCenter(w, ctx, action);
  // 기획 20차 (rule N1 · N2): a boss with a form — its seats, its box, the way it faces
  const form = getEntity(w, ctx.casterId)?.rt.form;
  let relocateTo: number | undefined;
  if (action.relocate && form?.def.spots?.length) {
    // 자리 이동: the next seat in order is fixed now (the warning shows it); the boss appears there when the part lands
    relocateTo = (form.spot + 1) % form.def.spots.length;
    center = { x: form.def.spots[relocateTo].x, y: form.def.spots[relocateTo].y };
  }
  // 기획 19차 review: a boss's one-target part keeps the boss's spot as its origin (the renderer draws the aim line
  // from it); every other unaimed part starts where it lands, as before
  const origin = isAimed(action.area) || isBossSingle(w, ctx, action) ? originOf(w, ctx) : center;
  let area = partArea(w, ctx, action);
  let chargeTo: Vec2 | undefined;
  if (action.charge) {
    // 기획 8차 charge: the path is fixed now (the telegraph shows exactly it); the rush happens when the hit lands.
    const caster = getEntity(w, ctx.casterId);
    const mg = caster ? Math.max(ARENA_MARGIN, Math.min(caster.radius, 1)) : ARENA_MARGIN;
    const fb = caster ? { x: Math.cos(caster.facing), y: Math.sin(caster.facing) } : undefined;
    // 기획 20차: a form boss's rush is as long as its data says (the area knob widens the path only) and ends in its box
    let reach = action.charge.distance * (form ? 1 : ctx.radiusMult);
    // 기획 13차 stopAtCenter (블레이드 되돌아 베기): the rush ends on the center, never past it
    if (action.charge.stopAtCenter) reach = Math.min(reach, dist(origin, center));
    chargeTo = form ? chargeEndIn(origin, center, reach, BOSS_FORM.box, fb) : chargeEnd(origin, center, reach, arena(w), mg, fb);
    const len = Math.hypot(chargeTo.x - origin.x, chargeTo.y - origin.y);
    if (len > 1e-6) center = copy(chargeTo);
    else if (fb) center = { x: origin.x + fb.x * 0.01, y: origin.y + fb.y * 0.01 };
    // the hit band runs along the path actually travelled (plus the body at the end)
    if (area.shape === 'line') area = { shape: 'line', length: len + (caster?.radius ?? 0), width: area.width };
    // 기획 20차: it turns to the path at once and holds that facing through the wind-up
    if (form && caster && len > 1e-6) caster.facing = Math.atan2(chargeTo.y - origin.y, chargeTo.x - origin.x);
  }
  // 기획 20차 (rule N3): one hit set for the `once` parts of this cast; (rule N6) the unit its `bound` parts are tied to
  if (action.once) ctx.onceHit ??= new Set();
  if (action.bound && !ctx.bound) {
    const bt = getEntity(w, ctx.targetId);
    if (bt) ctx.bound = { ent: bt, cleared: false };
  }
  const motif: Telegraph['motif'] = relocateTo != null ? 'arrive' : action.charge && form ? 'charge' : action.once && area.shape === 'rect' ? 'sweep' : undefined;
  if (action.dash && !action.dash.atFire && !opts?.noDash) doDash(w, ctx, center, action.dash);
  const delay = actionDelay(ctx, action);
  // 기획 13차 telegraphLead: shown only for the last N s (0 = never); absent = the whole delay. 기획 19차: × delayMult too
  const lead = action.telegraphLead != null ? action.telegraphLead * (ctx.delayMult ?? 1) : undefined;
  const hits = hitCount(action);
  emit(w, {
    type: 'skillCast',
    sourceId: ctx.casterId,
    player: ctx.player,
    slot: ctx.slot,
    skillId: ctx.skillId,
    name: ctx.name,
    center: copy(center),
    area,
    team: ctx.team,
    ...(delay > 0 ? { delay } : null),
    ...(hits > 1 ? { hits, hitInterval: hitGap(action) } : null),
    ...(action.stage ? { stage: action.stage, actionIndex: index } : null),
    ...(action.follow ? { follow: true as const } : null),
    ...(lead != null && delay > 0 ? { telegraphLead: lead } : null),
  });
  const p: PendingHit = {
    kind: 'hit',
    ctx,
    action,
    center,
    origin,
    area,
    remaining: delay,
    hitsLeft: hits,
    started: false,
    telegraphId: null,
    actionIndex: index,
    hitNo: 0,
    ...(chargeTo ? { chargeTo } : null),
    ...(opts?.noDash ? { noDash: true } : null),
    ...(relocateTo != null ? { relocateTo } : null),
    ...(motif ? { motif } : null),
  };
  if (delay > 0) {
    if (lead == null || lead >= delay - 1e-9) p.telegraphId = addTelegraph(w, ctx.team, center, origin, area, delay, isBossSelfCast(w, ctx, action), teleExtra(p)).id;
    else if (lead > 0) p.telegraphLead = lead;
    w.pending.push(p);
    return p;
  }
  fireHit(w, p);
  if (p.hitsLeft > 0) w.pending.push(p);
  return null;
}

/** 기획 8차 charge lands: the caster rushes along its telegraphed path (a dead caster never lands it). */
function doCharge(w: World, p: PendingHit): boolean {
  const caster = getEntity(w, p.ctx.casterId);
  if (!caster || !p.chargeTo) return false;
  if (hasStatus(caster, 'tether') || hasStatus(caster, 'root')) {
    // 기획 13차 묶기 / 속박 caught it during the wind-up: it cannot rush, so the charge breaks (nothing lands)
    emit(w, { type: 'interrupt', sourceId: caster.id, telegraphId: null, pos: copy(caster.pos), name: p.ctx.name });
    return false;
  }
  const from = copy(caster.pos);
  caster.pos.x = p.chargeTo.x;
  caster.pos.y = p.chargeTo.y;
  clampUnit(w, caster);
  const dx = p.chargeTo.x - p.origin.x;
  const dy = p.chargeTo.y - p.origin.y;
  if (Math.hypot(dx, dy) > 1e-6) caster.facing = Math.atan2(dy, dx);
  emit(w, { type: 'dash', entityId: caster.id, from, to: copy(caster.pos), duration: p.action.charge?.duration ?? CHARGE_DEFAULT_DURATION });
  // 기획 20차: a form boss recovers (no move, no turn) after the rush; a charge trail is laid along the path it ran
  const recover = caster.rt.form ? (p.action.charge?.recover ?? 0) : 0;
  if (recover > 0) caster.rt.lockTime = Math.max(caster.rt.lockTime, recover);
  if (p.action.trail) layChargeTrail(w, caster, p);
  return true;
}

/** 기획 20차 (rule N4 ②): circles every `spacing` cells along the path a charge ran (the warning already showed it). */
function layChargeTrail(w: World, caster: SimEntity, p: PendingHit): void {
  const tr = p.action.trail!;
  const to = p.chargeTo!;
  const len = dist(p.origin, to);
  const gap = Math.max(0.1, tr.spacing);
  const ux = len > 1e-6 ? (to.x - p.origin.x) / len : 0;
  const uy = len > 1e-6 ? (to.y - p.origin.y) / len : 0;
  const n = Math.floor(len / gap + 1e-9);
  const hit = new Map<number, number>(); // one field: its circles reach a unit once per tick between them
  for (let k = 0; k <= n; k++) dropTrailZone(w, caster, { x: p.origin.x + ux * k * gap, y: p.origin.y + uy * k * gap }, tr.radius * p.ctx.radiusMult, tr, hit);
}

/**
 * 기획 20차 (rule N2, 자리 이동): the part lands — its caster appears on the seat picked at cast, faces the way the seat
 * says and stands in its appear pose for BOSS_FORM.arrive s. A caster that is gone never lands it.
 */
function doRelocate(w: World, p: PendingHit): boolean {
  const c = getEntity(w, p.ctx.casterId);
  const f = c?.rt.form;
  const spot = f?.def.spots?.[p.relocateTo!];
  if (!c || !f || !spot) return false;
  const from = copy(c.pos);
  c.pos.x = spot.x;
  c.pos.y = spot.y;
  c.facing = spotFacing(f.def, p.relocateTo!);
  f.spot = p.relocateTo!;
  c.rt.lockTime = Math.max(c.rt.lockTime, BOSS_FORM.arrive);
  c.anim = 'appear';
  c.animTime = BOSS_FORM.arrive;
  emit(w, { type: 'blink', entityId: c.id, from, to: copy(c.pos) });
  return true;
}

/**
 * 기획 20차 (rule N6, 표식): the unit a bound part is tied to left the field (or died) — the part is dropped with its
 * warning, nobody is hit. One 'markClear' per cast, only when the unit left alive (a swap).
 */
function boundGone(w: World, p: PendingHit): boolean {
  const b = p.ctx.bound;
  if (!b || (!b.ent.rt.gone && b.ent.hp > 0)) return false;
  removeTelegraph(w, p.telegraphId);
  if (!b.cleared) {
    b.cleared = true;
    if (b.ent.hp > 0) emit(w, { type: 'markClear', targetId: b.ent.id, pos: copy(p.center) });
  }
  return true;
}

function fireHit(w: World, p: PendingHit): void {
  const a = p.action;
  if (!p.started && a.charge && !p.noDash && !doCharge(w, p)) {
    p.hitsLeft = 0;
    return;
  }
  if (!p.started && p.relocateTo != null && !doRelocate(w, p)) {
    p.hitsLeft = 0;
    return;
  }
  if (!p.started) {
    p.started = true;
    if (p.ctx.ultCast) p.ctx.ultCast.landed = true;
    if (a.follow) {
      refollow(w, p);
      refreshAtk(w, p);
    } else if (a.bound) {
      refollow(w, p); // 기획 20차: a mark goes off where its unit stands now
    }
    // 기획 13차 atFire: the caster moves now, from where it stands (거너 반동, 섀도우 질주)
    if (a.dash?.atFire && !p.noDash) doDash(w, p.ctx, null, a.dash);
    if (a.summon) spawnSummons(w, p.ctx, a.summon, p.center);
    if (a.zone) {
      const n = createZone(w, p.ctx, a, p.center, p.area, p.actionIndex);
      emitStage(w, p.ctx, a, p.actionIndex, p.center, p.area, 0, zoneTicks(a), n, p.origin);
      p.hitsLeft = 0;
      return;
    }
  } else if (a.follow) {
    refollow(w, p);
  } else if (a.center !== 'point') {
    // Follow a moving caster/target for later hits; retarget when the original target is gone.
    if (a.center === 'target' && !getEntity(w, p.ctx.targetId)) {
      const caster = getEntity(w, p.ctx.casterId);
      const nt = caster ? getEntity(w, caster.targetId) : null;
      if (nt) p.ctx = { ...p.ctx, targetId: nt.id, targetPos: copy(nt.pos) };
    }
    p.center = actionCenter(w, p.ctx, a);
    if (isAimed(p.area)) p.origin = originOf(w, p.ctx);
  }
  if (!a.blinkChain || blinkHop(w, p, a.blinkChain)) {
    const n = applyEffects(w, p.ctx, a, p.center, p.origin, p.area);
    emitStage(w, p.ctx, a, p.actionIndex, p.center, p.area, p.hitNo, hitCount(a), n, p.origin);
  }
  p.hitNo++;
  p.hitsLeft--;
  p.remaining = hitGap(a);
}

/**
 * 기획 13차 follow: re-resolve a 'self' / 'target' action's center now. A gone target is replaced by the caster's
 * current target; with none (or a gone caster for 'self') the action keeps its last spot.
 */
function refollow(w: World, p: PendingHit): void {
  const a = p.action;
  if (a.center === 'target' && !getEntity(w, p.ctx.targetId)) {
    if (a.bound) return; // 기획 20차 (rule N6): a mark never jumps to another unit
    const caster = getEntity(w, p.ctx.casterId);
    const nt = caster ? getEntity(w, caster.targetId) : null;
    if (!nt || nt.team === p.ctx.team) return;
    p.ctx = { ...p.ctx, targetId: nt.id, targetPos: copy(nt.pos) };
  } else if (a.center === 'self') {
    if (!getEntity(w, p.ctx.selfId)) return;
  } else if (a.center !== 'target') {
    return; // the drop point and a woundedAlly pick never move
  }
  p.center = actionCenter(w, p.ctx, a);
  if (isAimed(p.area)) p.origin = originOf(w, p.ctx);
  // 기획 20차 (rule N2): a rel 'facing' part turns with its caster (after a relocate: the new seat's facing)
  if (a.rel === 'facing') p.area = partArea(w, p.ctx, a);
}

/** 기획 13차 follow: a character's staged hit uses its attack when it lands (버서커 마무리 gets the 광란 bonus). */
function refreshAtk(w: World, p: PendingHit): void {
  const c = getEntity(w, p.ctx.casterId);
  if (!c || c.kind !== 'character') return;
  const st = effStats(w, c);
  p.ctx = { ...p.ctx, atk: st.atk, critChance: st.critChance, critMult: st.critMult };
}

/**
 * 기획 13차 blinkChain hop: the caster teleports next to the enemy within `radius` it hit the fewest times (then
 * nearest, then lowest id; at most maxPerTarget each) and the action hits around it. No caster → no hit; no enemy in
 * reach → it hits where it stands.
 */
function blinkHop(w: World, p: PendingHit, bc: NonNullable<SkillAction['blinkChain']>): boolean {
  const c = getEntity(w, p.ctx.casterId);
  if (!c) return false;
  const hitsOn = (p.blinkHits ??= {});
  let best: SimEntity | null = null;
  let bestKey: [number, number, number] | null = null;
  for (const e of w.state.entities) {
    if (e.team === c.team || !isAlive(e) || e.eventTag === 'ward') continue;
    const n = hitsOn[e.id] ?? 0;
    const d = dist(c.pos, e.pos) - e.radius;
    if (n >= bc.maxPerTarget || d > bc.radius * p.ctx.radiusMult) continue;
    const key: [number, number, number] = [n, d, e.id];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] - 1e-9 || (Math.abs(key[1] - bestKey[1]) <= 1e-9 && key[2] < bestKey[2])))) {
      best = e;
      bestKey = key;
    }
  }
  if (best) {
    hitsOn[best.id] = (hitsOn[best.id] ?? 0) + 1;
    blinkTo(w, c, best, BLINK_HOP_GAP, false, { n: p.hitNo + 1, of: bc.count });
  }
  p.center = copy(c.pos);
  return true;
}

/** Gap between the blade and the enemy it hops to (blinkChain). */
const BLINK_HOP_GAP = 0.1;

/** Ticks a zone gets (its first application included). */
function zoneTicks(a: SkillAction): number {
  const z = a.zone!;
  return Math.max(1, Math.ceil(z.duration / Math.max(0.05, z.tickInterval) - 1e-9));
}

/**
 * 기획 13차: 'skillStage' for an action with a stage (each hit / zone tick); render and sound key on skillId + stage.
 * 기획 22차 궁극기 테스트: a line / fan part also says where it started (the renderer draws it from there — an aimed band
 * or a 드래그 path no longer shows as a flat band on the point); every other mode's events are unchanged.
 */
function emitStage(w: World, ctx: CastCtx, a: SkillAction, index: number, center: Vec2, area: AreaShape, hit: number, hits: number, targets: number, origin?: Vec2): void {
  if (!a.stage) return;
  emit(w, {
    type: 'skillStage',
    sourceId: ctx.casterId,
    player: ctx.player,
    slot: ctx.slot,
    skillId: ctx.skillId,
    stage: a.stage,
    actionIndex: index,
    center: copy(center),
    area,
    team: ctx.team,
    hit,
    hits,
    targets,
    ...(origin && w.state.mode === 'ultTest' && isAimed(area) ? { origin: copy(origin) } : null),
  });
}

/** Casters frozen by a stasis (기획 13차): their wind-ups and telegraphs wait, they are not broken. */
function frozenCaster(w: World, p: { ctx: CastCtx }): boolean {
  const c = p.ctx.casterId != null ? getEntity(w, p.ctx.casterId) : null;
  return !!c && c.team === 'enemy' && hasStatus(c, 'stasis');
}

/**
 * 기획 13차: an unstarted part of a groggy boss. breakBoss cancels what is in w.pending, but a break that happens inside
 * this loop (a delayed drag beat, an ult) sees the list swapped out, so the check runs here too.
 */
function brokenByGroggy(w: World, p: PendingHit): boolean {
  if (p.started || p.ctx.team !== 'enemy' || p.ctx.casterId == null) return false;
  return isGroggy(w, { id: p.ctx.casterId });
}

/**
 * 기획 17차 저스트 교대: an enemy part still winding up that will really land — not broken (stun / groggy), not frozen
 * by a stasis, its caster not stunned or charmed (a charmed caster fights for us), a charge only with its caster alive.
 * Casterless parts (debug 저스트 연습) count.
 */
export function isLiveEnemyWindup(w: World, p: PendingHit): boolean {
  if (p.cancelled || p.started || p.ctx.team !== 'enemy') return false;
  if (frozenCaster(w, p) || brokenByGroggy(w, p)) return false;
  if (p.ctx.casterId == null) return true;
  const c = getEntity(w, p.ctx.casterId);
  if (!c) return !p.action.charge;
  return !hasStatus(c, 'stun') && !hasStatus(c, 'charm');
}

/** Delayed actions, multi-hits and echo recasts. Telegraphs count down with them. */
export function tickPending(w: World, dt: number): void {
  const frozenTele = new Set<number>();
  for (const p of w.pending) if (p.kind === 'hit' && p.telegraphId != null && frozenCaster(w, p)) frozenTele.add(p.telegraphId);
  for (const t of w.state.telegraphs) if (!frozenTele.has(t.id)) t.remaining = Math.max(0, t.remaining - dt);
  const list = w.pending;
  w.pending = [];
  const keep: typeof list = [];
  for (const p of list) {
    if (w.state.phase !== 'combat') break;
    if (p.kind === 'hit' && (p.cancelled || brokenByGroggy(w, p))) {
      // a stunned monster's wind-up (status.ts) / a groggy boss's unstarted part: gone with its telegraph, nothing lands
      const caster = getEntity(w, p.ctx.casterId);
      emit(w, { type: 'interrupt', sourceId: p.ctx.casterId, telegraphId: p.telegraphId, pos: copy(caster ? caster.pos : p.center), name: p.ctx.name });
      removeTelegraph(w, p.telegraphId);
      continue;
    }
    if (p.kind === 'hit' && !p.started && p.action.bound && boundGone(w, p)) continue; // 기획 20차 (rule N6)
    if (p.kind === 'hit' && frozenCaster(w, p)) {
      keep.push(p); // 기획 13차 정지: postponed
      continue;
    }
    p.remaining -= dt;
    if (p.remaining > 1e-9) {
      if (p.kind === 'hit') waitingHit(w, p);
      keep.push(p);
      continue;
    }
    if (p.kind === 'rewardDelay') {
      fireRewardDelay(w, p); // 기획 17차
      continue;
    }
    removeTelegraph(w, p.telegraphId);
    p.telegraphId = null;
    if (p.kind === 'echo') {
      for (const id of p.extraTelegraphIds.splice(0)) removeTelegraph(w, id);
      castSkill(w, p.ctx, p.actions, { noDash: true });
    } else {
      fireHit(w, p);
      if (p.hitsLeft > 0) keep.push(p);
    }
  }
  if (w.state.phase !== 'combat') {
    w.pending = [];
    return;
  }
  w.pending = keep.concat(w.pending);
}

/** 기획 17차: a reward's delayed beat came due ('dragEnd' = the drag's last part landed, else the hooks' onDelay). */
function fireRewardDelay(w: World, pd: PendingReward): void {
  const p = w.state.players[pd.player];
  if (!p) return;
  if (pd.tag === 'dragEnd' && pd.ctx && pd.pos) rwOnDragEnd(w, p, pd.data.idx ?? 0, pd.pos, pd.ctx);
  else rwOnDelay(w, pd);
}

/** A hit still waiting: a following telegraph moves with its caster / target; a telegraphLead one appears in time. */
function waitingHit(w: World, p: PendingHit): void {
  if (p.started) return;
  if (p.action.follow || p.action.bound) {
    refollow(w, p);
    const t = p.telegraphId != null ? w.state.telegraphs.find(x => x.id === p.telegraphId) : undefined;
    if (t) {
      t.center = copy(p.center);
      t.origin = copy(p.origin);
      if (p.action.rel === 'facing') t.area = p.area; // 기획 20차
    }
  }
  if (p.telegraphLead != null && p.telegraphId == null && p.remaining <= p.telegraphLead + 1e-9) {
    p.telegraphId = addTelegraph(w, p.ctx.team, p.center, p.origin, p.area, p.remaining, isBossSelfCast(w, p.ctx, p.action), teleExtra(p)).id;
    p.telegraphLead = undefined;
  }
}

export function collectTargets(
  w: World,
  ctx: CastCtx,
  affects: Affects,
  center: Vec2,
  origin: Vec2,
  area: AreaShape,
): SimEntity[] {
  if (affects === 'self') {
    const s = getEntity(w, ctx.selfId);
    return s ? [s] : [];
  }
  const team = affects === 'enemies' ? otherTeam(ctx.team) : ctx.team;
  const pool: SimEntity[] = [];
  for (const e of w.state.entities) if (e.team === team && isAlive(e)) pool.push(e);
  if (area.shape === 'single') {
    // 기획 12차: an ally 'single' prefers the woundedAlly pick (메딕 응급 주사), else the caster
    const pref = affects === 'enemies' ? getEntity(w, ctx.targetId) : (getEntity(w, ctx.allyTargetId) ?? getEntity(w, ctx.selfId));
    if (pref && pref.team === team) return [pref];
    let best: SimEntity | null = null;
    let bd = Infinity;
    for (const e of pool) {
      const d = dist(center, e.pos) - e.radius;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best && bd <= 1 ? [best] : [];
  }
  return pool.filter(e => inActionArea(w, ctx, area, center, origin, e));
}

/**
 * Would a (non-single) area action of ctx centered at `center` reach e? The hit test of collectTargets — 기획 17차 the
 * 저스트 check uses the same one. Aimed shapes without a direction point where the caster faces.
 */
export function inActionArea(w: World, ctx: CastCtx, area: AreaShape, center: Vec2, origin: Vec2, e: SimEntity): boolean {
  let fallback: Vec2 | undefined;
  if (isAimed(area)) {
    const c = getEntity(w, ctx.casterId);
    const f = c ? c.facing : 0;
    fallback = { x: Math.cos(f), y: Math.sin(f) };
  }
  return hitsArea(area, center, origin, e.pos, e.radius, fallback);
}

/** Applies an action at center; returns how many units it reached (for 'skillStage'). */
export function applyEffects(w: World, ctx: CastCtx, action: SkillAction, center: Vec2, origin: Vec2, area: AreaShape): number {
  if (ctx.player != null) playerEffects(w, ctx, action);
  let targets = collectTargets(w, ctx, action.affects, center, origin, area);
  if (action.maxTargets != null) targets = nearestTargets(targets, center, action, action.maxTargets);
  if (ctx.trail) {
    // 기획 20차 (rule N4): the circles of one trail reach a unit once per interval between them
    const { hit, gap } = ctx.trail;
    const now = w.state.time;
    targets = targets.filter(t => now - (hit.get(t.id) ?? -Infinity) >= gap - 1e-6);
    for (const t of targets) hit.set(t.id, now);
  }
  if (action.once && ctx.onceHit) {
    // 기획 20차 (rule N3): the `once` parts of one cast reach a unit once between them
    const seen = ctx.onceHit;
    targets = targets.filter(t => !seen.has(t.id));
    for (const t of targets) seen.add(t.id);
  }
  // 기획 13차: reaching the boss fills its groggy gauge (before the effects: a stun on the boss becomes points)
  if (ctx.groggyMark && w.state.bossGroggy) groggyOnAction(w, ctx, action, targets);
  for (const t of targets) {
    for (const eff of action.effects) {
      if (!isAlive(t)) break;
      applyEffect(w, ctx, eff, t, center);
    }
  }
  if (action.healPerHit && action.affects === 'enemies') healPerHit(w, ctx, action.healPerHit, center, targets);
  return targets.length;
}

/** Effects on players, not units: once per action, on the caster player or every non-out player (allPlayers). */
function playerEffects(w: World, ctx: CastCtx, action: SkillAction): void {
  const pi = ctx.player!;
  for (const eff of action.effects) {
    if (eff.kind === 'swapCooldownReduce') {
      for (const p of effectPlayers(w, pi, eff.allPlayers)) {
        reduceBenchSwapCd(p, eff.seconds);
        emit(w, { type: 'swapCdCut', player: p.id, seconds: eff.seconds, from: pi });
      }
    }
    // 기획 12차 (메딕): bench heal / revive cut
    if (eff.kind === 'benchHeal') for (const p of effectPlayers(w, pi, eff.allPlayers)) benchHeal(w, p, eff.amount, ctx.healMult, pi);
    if (eff.kind === 'reviveReduce') for (const p of effectPlayers(w, pi, eff.allPlayers)) reduceRevive(w, p, eff.seconds, pi);
    // 기획 13차 (바드 앙코르): a status on the bench cards
    if (eff.kind === 'benchStatus') for (const p of effectPlayers(w, pi, eff.allPlayers)) benchStatus(w, p, eff, pi, ctx.source);
  }
}

/** 기획 13차 maxTargets: the n nearest (distance → id); units immune to the action's statuses come last. */
function nearestTargets(targets: SimEntity[], center: Vec2, action: SkillAction, n: number): SimEntity[] {
  const immune = (t: SimEntity) => (action.effects.some(e => e.kind === 'status' && statusImmune(t, e.status)) ? 1 : 0);
  const key = targets.map(t => ({ t, im: immune(t), d: dist(t.pos, center) }));
  key.sort((a, b) => a.im - b.im || a.d - b.d || a.t.id - b.t.id);
  return key.slice(0, Math.max(0, n)).map(k => k.t);
}

/** 기획 13차 healPerHit (퇴마사 멸): allies near the center heal amount × (enemies hit, capped) of their max HP, at once. */
function healPerHit(w: World, ctx: CastCtx, hp: NonNullable<SkillAction['healPerHit']>, center: Vec2, enemies: readonly SimEntity[]): void {
  const n = Math.min(hp.maxHits, enemies.length);
  if (n <= 0) return;
  const allies = collectTargets(w, ctx, 'allies', center, center, { shape: 'circle', radius: hp.radius * ctx.radiusMult });
  for (const a of allies) heal(w, ctx.player, a, hp.amount * n * a.maxHp * ctx.healMult, enemies[0].id);
}

function applyEffect(w: World, ctx: CastCtx, eff: Effect, t: SimEntity, center: Vec2): void {
  switch (eff.kind) {
    case 'damage': {
      // 기획 17차: forceCrit (멈춘 숨); a drag hit tells the reward hooks
      const dealt = hitDamage(w, ctx, t, eff.amount, eff.crit === 'always' || !!ctx.forceCrit);
      if (ctx.isDrag && dealt > 0 && ctx.player != null) rwOnDragHit(w, ctx, t, dealt);
      break;
    }
    case 'heal': {
      // (가정, 기획 8차) monster heals (링거 환자, 수간호사) never reach a boss: bosses only lose HP, and characters
      // locked on a boss could not switch to the healers anyway (R6).
      if (ctx.team === 'enemy' && t.tier === 'boss' && t.id !== ctx.casterId) break;
      const want = eff.amount * t.maxHp * ctx.healMult;
      const got = heal(w, ctx.player, t, want);
      if (eff.overflowShield) overflowShield(w, t, want - got, eff.overflowShield);
      if (ctx.team === 'ally' && ctx.player != null && want - got > 1e-9) rwOnHealOverflow(w, t, want - got, ctx); // 기획 17차
      break;
    }
    case 'shield':
      addShield(t, eff.amount * t.maxHp * ctx.shieldMult, eff.duration, w);
      break;
    case 'status':
      applySkillStatus(w, ctx, eff, t, center);
      break;
    case 'knockback':
      if (!shrugsOff(w, ctx, t)) displace(w, t, center, eff.distance, true, eff.dir);
      break;
    case 'pull':
      if (!shrugsOff(w, ctx, t)) displace(w, t, center, eff.distance, false);
      break;
    case 'cleanse':
      cleanse(t.statuses);
      break;
    case 'swapCooldownReduce':
    case 'benchHeal':
    case 'reviveReduce':
    case 'benchStatus':
      break; // applied once per action in applyEffects
  }
}

/** 기획 13차 클레릭: the heal that overflows max HP turns into a shield, up to cap × max HP from this source. */
function overflowShield(w: World, t: SimEntity, over: number, o: { frac: number; cap: number; duration: number }): void {
  if (!(over > 0) || !isAlive(t)) return;
  const room = o.cap * t.maxHp - t.shield;
  const amount = Math.min(over * o.frac, room);
  if (amount > 0) addShield(t, amount, o.duration, w);
}

/** A status effect of a skill; a control status that newly lands emits 'statusApplied' (icons / sounds). */
function applySkillStatus(w: World, ctx: CastCtx, eff: Extract<Effect, { kind: 'status' }>, t: SimEntity, center: Vec2): void {
  const value = eff.status === 'burn' ? eff.value * ctx.atk * ctx.dmgMult : eff.value;
  const control = CONTROL_STATUSES.has(eff.status);
  const fresh = control && !hasStatus(t, eff.status);
  // 기획 17차: reward hooks may lengthen a hostile status an ally cast puts on (주문 연장, #상태이상; never groggy points)
  const duration = ctx.team === 'ally' && ctx.player != null && DEBUFFS.has(eff.status) ? rwStatusDuration(w, ctx, eff.status, eff.duration) : eff.duration;
  const ok = applyStatus(t, eff.status, duration, value, ctx.player, ctx.source, { anchor: center, sourceEntityId: ctx.casterId });
  if (!ok || !fresh) return;
  if (eff.status === 'tether' || eff.status === 'root') constrainTether(t);
  const s = t.statuses.find(x => x.id === eff.status);
  emit(w, { type: 'statusApplied', targetId: t.id, status: eff.status, duration: s?.total ?? duration, player: ctx.player, sourceId: ctx.casterId });
}

/**
 * 기획 19차 보스 레이드 (review): a character still inside its appear invulnerability is not pushed or pulled by an enemy
 * part — like damage (combat.ts) and debuffs (status.ts), so a 저스트 교대 on a pull / push pattern really gets out of it.
 * Raid games only: the classic tower and 원정 keep their old displacement (bit-identical runs).
 */
function shrugsOff(w: World, ctx: CastCtx, t: SimEntity): boolean {
  return !!w.bossRaid && ctx.team === 'enemy' && t.kind === 'character' && t.invulnTime > 0;
}

function displace(w: World, t: SimEntity, center: Vec2, distance: number, away: boolean, dir?: Dir): void {
  if (t.rt.stationary || t.rt.heavy || distance <= 0) return; // 기획 20차: a heavy boss is never pushed or pulled
  if (away && dir) {
    // fixed-direction knockback (e.g. 거너 산탄: always pushed left)
    const u = DIR_VEC[dir];
    t.pos.x += u.x * distance;
    t.pos.y += u.y * distance;
    clampUnit(w, t);
    constrainTether(t);
    return;
  }
  const dx = t.pos.x - center.x;
  const dy = t.pos.y - center.y;
  const d = Math.hypot(dx, dy);
  if (away) {
    const ux = d > 1e-6 ? dx / d : Math.cos(t.facing + Math.PI);
    const uy = d > 1e-6 ? dy / d : Math.sin(t.facing + Math.PI);
    t.pos.x += ux * distance;
    t.pos.y += uy * distance;
  } else {
    if (d < 1e-6) return;
    const m = Math.min(distance, Math.max(0, d - 0.3));
    t.pos.x -= (dx / d) * m;
    t.pos.y -= (dy / d) * m;
  }
  clampUnit(w, t);
  constrainTether(t); // 기획 13차: a tethered / rooted unit is never pushed out
}

function zoneKind(action: SkillAction): SimZone['kind'] {
  const kinds = action.effects.map(e => e.kind);
  if (kinds.includes('damage')) return 'damage';
  if (kinds.includes('heal')) return 'heal';
  const debuff = action.effects.some(e => e.kind === 'status' && DEBUFFS.has(e.status));
  return debuff ? 'debuff' : 'buff';
}

/** Footprint a zone re-applies its effects on ('single' / 'line' / 'fan' have no fixed footprint → circle). */
function zoneArea(area: AreaShape): AreaShape {
  if (area.shape === 'single' || area.shape === 'line') return { shape: 'circle', radius: 1 };
  if (area.shape === 'fan') return { shape: 'circle', radius: Math.max(1, area.radius / 2) };
  return area;
}

function createZone(w: World, ctx: CastCtx, action: SkillAction, center: Vec2, area: AreaShape, actionIndex: number): number {
  const zone = action.zone!;
  const zArea = zoneArea(area);
  const z: SimZone = {
    id: newId(w),
    team: ctx.team,
    ownerPlayer: ctx.player,
    center: copy(center),
    radius: zArea.shape === 'circle' ? zArea.radius : areaExtent(zArea),
    area: zArea,
    remaining: zone.duration,
    total: zone.duration,
    kind: zoneKind(action),
    // 기획 20차: the ticks know they come from a zone (rule N5: no front / back multiplier); the cast itself does not
    rt: { ctx: { ...ctx, fromZone: true }, action, nextTick: zone.tickInterval, tickInterval: Math.max(0.05, zone.tickInterval), actionIndex, tickNo: 1 },
  };
  w.state.zones.push(z);
  return applyEffects(w, ctx, action, z.center, z.center, zArea);
}

function zoneFootprint(z: SimZone): AreaShape {
  return z.area ?? { shape: 'circle', radius: z.radius };
}

export function tickZones(w: World, dt: number): void {
  const list = w.state.zones;
  const snapshot = list.slice();
  const keep: SimZone[] = [];
  for (const z of snapshot) {
    z.remaining -= dt;
    z.rt.nextTick -= dt;
    if (z.remaining <= 1e-6) continue;
    if (z.rt.nextTick <= 1e-6) {
      z.rt.nextTick += z.rt.tickInterval;
      const fp = zoneFootprint(z);
      const n = applyEffects(w, z.rt.ctx, z.rt.action, z.center, z.center, fp);
      emitStage(w, z.rt.ctx, z.rt.action, z.rt.actionIndex, z.center, fp, z.rt.tickNo++, zoneTicks(z.rt.action), n);
    }
    keep.push(z);
  }
  list.length = 0;
  list.push(...keep);
}

/** Living enemy units of that kind at a summon spot (within the summon spread of it). */
function aliveNear(w: World, unitId: string, center: Vec2): number {
  let n = 0;
  for (const e of w.state.entities) if (e.team === 'enemy' && e.defId === unitId && isAlive(e) && dist(e.pos, center) <= SUMMON_SPREAD + 0.5) n++;
  return n;
}

function spawnSummons(w: World, ctx: CastCtx, summon: NonNullable<SkillAction['summon']>, center: Vec2): void {
  const def = getMonster(summon.unitId);
  const base = summon.countMax != null && summon.countMax > summon.count ? w.rng.int(summon.count, summon.countMax) : summon.count;
  let count = Math.max(1, Math.round(base * ctx.summonMult));
  const enemy = ctx.team === 'enemy';
  const s = w.state;
  if (enemy) {
    // 기획서 9-1 동시 최대 maxAliveMonsters: enemy adds only fill the room that is left (boss excluded).
    const room = w.tunables.maxAliveMonsters - countEnemies(w) - queuedEnemies(w);
    count = Math.min(count, Math.max(0, Math.floor(room)));
    // 기획 19차 (review): a capped spot only gets what is missing (오류 창 never stack on one coordinate)
    if (summon.spotCap != null) count = Math.min(count, Math.max(0, summon.spotCap - aliveNear(w, summon.unitId, center)));
  }
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + w.rng.range(0, 0.6);
    const r = count === 1 ? 0 : SUMMON_SPREAD;
    const pos = clampToArena(w, { x: center.x + Math.cos(ang) * r, y: center.y + Math.sin(ang) * r });
    const inherit = enemy ? null : inheritMults(w, ctx, summon, def);
    const e = createUnit(w, def, pos, ctx.team, {
      kind: 'summon',
      ownerPlayer: enemy ? null : ctx.player,
      expiresIn: summon.duration > 0 ? summon.duration : null,
      hpMult: enemy ? s.plan.statMult * w.tunables.monsterHpMult : (inherit?.hp ?? 1),
      atkMult: enemy ? s.plan.statMult : (inherit?.atk ?? 1),
    });
    if (!enemy && ctx.slot !== 'monster') e.rt.summonSlot = ctx.slot;
    emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: e.tier as Exclude<typeof e.tier, 'character'> });
  }
}

/**
 * 기획 12차 (종이 인형): SkillAction.summon.inherit → hp/atk multipliers so the summon gets inherit.hp × the caster's
 * effective max HP and inherit.atk × its atk. Null when not inheriting or the caster is gone.
 */
function inheritMults(w: World, ctx: CastCtx, summon: NonNullable<SkillAction['summon']>, def: MonsterDef): { hp: number; atk: number } | null {
  if (!summon.inherit) return null;
  const caster = getEntity(w, ctx.casterId ?? ctx.selfId);
  if (!caster) return null;
  const st = effStats(w, caster);
  // 기획 17차 저스트 교대: the doll's attack (its burst) gets the just power, its HP does not
  const just = ctx.justMult ?? 1;
  return {
    hp: (st.maxHp * summon.inherit.hp) / Math.max(1, def.stats.maxHp),
    atk: def.stats.atk > 0 ? (st.atk * summon.inherit.atk * just) / def.stats.atk : 1,
  };
}
