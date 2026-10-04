// Shared skill-action executor (drag / normal / ult / pet / monster skills):
// center → area → targets → effects, with telegraphed delays, multi-hits, zones and summons.

import { DEBUFFS, type Affects, type AreaShape, type Dir, type Effect, type SkillAction, type Team, type Telegraph, type Vec2 } from '../types';
import { getMonster } from '../data';
import { ARENA_MARGIN, SUMMON_SPREAD } from './constants';
import { addShield, heal, hitDamage, reduceBenchSwapCd } from './combat';
import { clampUnit, createUnit } from './entities';
import { DASH_DEFAULT_DURATION, DIR_VEC, areaExtent, dashEnd, hitsArea, scaleArea, scaleDash } from './geometry';
import { applyStatus, cleanse } from './status';
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
  type CastCtx,
  type PendingHit,
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
  for (const a of actions) startAction(w, ctx, a, opts);
}

export function resolveCenter(w: World, ctx: CastCtx, which: SkillAction['center']): Vec2 {
  if (which === 'point' && ctx.point) return copy(ctx.point);
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

export function addTelegraph(w: World, team: Team, center: Vec2, origin: Vec2, area: AreaShape, delay: number): Telegraph {
  const t: Telegraph = { id: newId(w), team, center: copy(center), origin: copy(origin), area, remaining: delay, total: delay };
  w.state.telegraphs.push(t);
  return t;
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
    c.x += action.offset.x;
    c.y += action.offset.y;
  }
  return c;
}

/**
 * R28 dash: the caster (already standing at the resolved center) moves toward dir by distance, clamped into the
 * arena. Implemented as an immediate reposition; the 'dash' event lets the renderer animate the streak.
 */
function doDash(w: World, ctx: CastCtx, from: Vec2, dash: NonNullable<SkillAction['dash']>): void {
  const caster = getEntity(w, ctx.casterId);
  if (!caster) return;
  const d = scaleDash(dash, ctx.radiusMult);
  const mg = Math.max(ARENA_MARGIN, Math.min(caster.radius, 1));
  const to = dashEnd(from, d.dir, d.distance, arena(w), mg);
  caster.pos.x = to.x;
  caster.pos.y = to.y;
  caster.facing = facingOf(d.dir);
  emit(w, { type: 'dash', entityId: caster.id, from: copy(from), to: copy(to), duration: dash.duration ?? DASH_DEFAULT_DURATION });
}

function facingOf(d: Dir): number {
  const u = DIR_VEC[d];
  return Math.atan2(u.y, u.x);
}

/** Starts one action; returns its pending hit when it is delayed (telegraphed), else null. */
export function startAction(w: World, ctx: CastCtx, action: SkillAction, opts?: CastOpts): PendingHit | null {
  const center = actionCenter(w, ctx, action);
  const origin = action.area.shape === 'line' ? originOf(w, ctx) : center;
  const area = scaleArea(action.area, ctx.radiusMult);
  if (action.dash && !opts?.noDash) doDash(w, ctx, center, action.dash);
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
    ...(action.delay && action.delay > 0 ? { delay: action.delay } : null),
    ...(action.hits && action.hits > 1 ? { hits: action.hits, hitInterval: action.hitInterval ?? 0.2 } : null),
  });
  const delay = action.delay ?? 0;
  const p: PendingHit = {
    kind: 'hit',
    ctx,
    action,
    center,
    origin,
    area,
    remaining: delay,
    hitsLeft: Math.max(1, action.hits ?? 1),
    started: false,
    telegraphId: null,
  };
  if (delay > 0) {
    p.telegraphId = addTelegraph(w, ctx.team, center, origin, area, delay).id;
    w.pending.push(p);
    return p;
  }
  fireHit(w, p);
  if (p.hitsLeft > 0) w.pending.push(p);
  return null;
}

function fireHit(w: World, p: PendingHit): void {
  const a = p.action;
  if (!p.started) {
    p.started = true;
    if (a.summon) spawnSummons(w, p.ctx, a.summon, p.center);
    if (a.zone) {
      createZone(w, p.ctx, a, p.center, p.area);
      p.hitsLeft = 0;
      return;
    }
  } else if (a.center !== 'point') {
    // Follow a moving caster/target for later hits; retarget when the original target is gone.
    if (a.center === 'target' && !getEntity(w, p.ctx.targetId)) {
      const caster = getEntity(w, p.ctx.casterId);
      const nt = caster ? getEntity(w, caster.targetId) : null;
      if (nt) p.ctx = { ...p.ctx, targetId: nt.id, targetPos: copy(nt.pos) };
    }
    p.center = actionCenter(w, p.ctx, a);
    if (p.area.shape === 'line') p.origin = originOf(w, p.ctx);
  }
  applyEffects(w, p.ctx, a, p.center, p.origin, p.area);
  p.hitsLeft--;
  p.remaining = a.hitInterval ?? 0.2;
}

/** Delayed actions, multi-hits and echo recasts. Telegraphs count down with them. */
export function tickPending(w: World, dt: number): void {
  for (const t of w.state.telegraphs) t.remaining = Math.max(0, t.remaining - dt);
  const list = w.pending;
  w.pending = [];
  const keep: typeof list = [];
  for (const p of list) {
    if (w.state.phase !== 'combat') break;
    if (p.kind === 'hit' && p.cancelled) {
      // a stunned monster's wind-up (status.ts): gone with its telegraph, nothing lands
      const caster = getEntity(w, p.ctx.casterId);
      emit(w, { type: 'interrupt', sourceId: p.ctx.casterId, telegraphId: p.telegraphId, pos: copy(caster ? caster.pos : p.center), name: p.ctx.name });
      removeTelegraph(w, p.telegraphId);
      continue;
    }
    p.remaining -= dt;
    if (p.remaining > 1e-9) {
      keep.push(p);
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
    const pref = affects === 'enemies' ? getEntity(w, ctx.targetId) : getEntity(w, ctx.selfId);
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
  let fallback: Vec2 | undefined;
  if (area.shape === 'line') {
    const c = getEntity(w, ctx.casterId);
    const f = c ? c.facing : 0;
    fallback = { x: Math.cos(f), y: Math.sin(f) };
  }
  return pool.filter(e => hitsArea(area, center, origin, e.pos, e.radius, fallback));
}

export function applyEffects(w: World, ctx: CastCtx, action: SkillAction, center: Vec2, origin: Vec2, area: AreaShape): void {
  if (ctx.player != null) {
    for (const eff of action.effects) {
      if (eff.kind === 'swapCooldownReduce') reduceBenchSwapCd(w.state.players[ctx.player], eff.seconds);
    }
  }
  const targets = collectTargets(w, ctx, action.affects, center, origin, area);
  for (const t of targets) {
    for (const eff of action.effects) {
      if (!isAlive(t)) break;
      applyEffect(w, ctx, eff, t, center);
    }
  }
}

function applyEffect(w: World, ctx: CastCtx, eff: Effect, t: SimEntity, center: Vec2): void {
  switch (eff.kind) {
    case 'damage':
      hitDamage(w, ctx, t, eff.amount);
      break;
    case 'heal':
      heal(w, ctx.player, t, eff.amount * t.maxHp * ctx.healMult);
      break;
    case 'shield':
      addShield(t, eff.amount * t.maxHp * ctx.shieldMult, eff.duration);
      break;
    case 'status': {
      const value = eff.status === 'burn' ? eff.value * ctx.atk * ctx.dmgMult : eff.value;
      applyStatus(t, eff.status, eff.duration, value, ctx.player, ctx.source);
      break;
    }
    case 'knockback':
      displace(w, t, center, eff.distance, true, eff.dir);
      break;
    case 'pull':
      displace(w, t, center, eff.distance, false);
      break;
    case 'cleanse':
      cleanse(t.statuses);
      break;
    case 'swapCooldownReduce':
      break; // applied once per action in applyEffects
  }
}

function displace(w: World, t: SimEntity, center: Vec2, distance: number, away: boolean, dir?: Dir): void {
  if (t.rt.stationary || distance <= 0) return;
  if (away && dir) {
    // fixed-direction knockback (e.g. 거너 산탄: always pushed left)
    const u = DIR_VEC[dir];
    t.pos.x += u.x * distance;
    t.pos.y += u.y * distance;
    clampUnit(w, t);
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
}

function zoneKind(action: SkillAction): SimZone['kind'] {
  const kinds = action.effects.map(e => e.kind);
  if (kinds.includes('damage')) return 'damage';
  if (kinds.includes('heal')) return 'heal';
  const debuff = action.effects.some(e => e.kind === 'status' && DEBUFFS.has(e.status));
  return debuff ? 'debuff' : 'buff';
}

/** Footprint a zone re-applies its effects on ('single' / 'line' have no fixed footprint → small circle). */
function zoneArea(area: AreaShape): AreaShape {
  if (area.shape === 'single' || area.shape === 'line') return { shape: 'circle', radius: 1 };
  return area;
}

function createZone(w: World, ctx: CastCtx, action: SkillAction, center: Vec2, area: AreaShape): void {
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
    rt: { ctx, action, nextTick: zone.tickInterval, tickInterval: Math.max(0.05, zone.tickInterval) },
  };
  w.state.zones.push(z);
  applyEffects(w, ctx, action, z.center, z.center, zArea);
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
      applyEffects(w, z.rt.ctx, z.rt.action, z.center, z.center, zoneFootprint(z));
    }
    keep.push(z);
  }
  list.length = 0;
  list.push(...keep);
}

function spawnSummons(w: World, ctx: CastCtx, summon: NonNullable<SkillAction['summon']>, center: Vec2): void {
  const def = getMonster(summon.unitId);
  const base = summon.countMax != null && summon.countMax > summon.count ? w.rng.int(summon.count, summon.countMax) : summon.count;
  let count = Math.max(1, Math.round(base * ctx.summonMult));
  const enemy = ctx.team === 'enemy';
  const s = w.state;
  if (enemy) {
    // 기획서 9-1 동시 최대 maxAliveMonsters: enemy adds only fill the room that is left (boss excluded).
    const room = w.tunables.maxAliveMonsters - countEnemies(w) - w.spawner.pending.length;
    count = Math.min(count, Math.max(0, Math.floor(room)));
  }
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + w.rng.range(0, 0.6);
    const r = count === 1 ? 0 : SUMMON_SPREAD;
    const pos = clampToArena(w, { x: center.x + Math.cos(ang) * r, y: center.y + Math.sin(ang) * r });
    const e = createUnit(w, def, pos, ctx.team, {
      kind: 'summon',
      ownerPlayer: enemy ? null : ctx.player,
      expiresIn: summon.duration > 0 ? summon.duration : null,
      hpMult: enemy ? s.plan.statMult * w.tunables.monsterHpMult : 1,
      atkMult: enemy ? s.plan.statMult : 1,
    });
    emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: e.tier as Exclude<typeof e.tier, 'character'> });
  }
}
