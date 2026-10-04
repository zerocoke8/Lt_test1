// Shared skill-action executor (drag / normal / ult / pet / monster skills):
// center → area → targets → effects, with telegraphed delays, multi-hits, zones and summons.

import { DEBUFFS, type Affects, type AreaShape, type Effect, type SkillAction, type Team, type Telegraph, type Vec2 } from '../types';
import { getMonster } from '../data';
import { SUMMON_SPREAD } from './constants';
import { addShield, heal, hitDamage, reduceBenchSwapCd } from './combat';
import { clampUnit, createUnit } from './entities';
import { applyStatus, cleanse } from './status';
import {
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

export function castSkill(w: World, ctx: CastCtx, actions: readonly SkillAction[]): void {
  for (const a of actions) startAction(w, ctx, a);
}

export function scaleArea(a: AreaShape, mult: number): AreaShape {
  if (a.shape === 'circle' && mult !== 1) return { shape: 'circle', radius: a.radius * mult };
  return a;
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

export function startAction(w: World, ctx: CastCtx, action: SkillAction): void {
  const center = resolveCenter(w, ctx, action.center);
  const origin = action.area.shape === 'line' ? originOf(w, ctx) : center;
  const area = scaleArea(action.area, ctx.radiusMult);
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
    return;
  }
  fireHit(w, p);
  if (p.hitsLeft > 0) w.pending.push(p);
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
    p.center = resolveCenter(w, p.ctx, a.center);
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
    p.remaining -= dt;
    if (p.remaining > 1e-9) {
      keep.push(p);
      continue;
    }
    removeTelegraph(w, p.telegraphId);
    p.telegraphId = null;
    if (p.kind === 'echo') {
      castSkill(w, p.ctx, p.actions);
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
  switch (area.shape) {
    case 'single': {
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
    case 'circle':
      return pool.filter(e => dist(center, e.pos) <= area.radius + e.radius);
    case 'line': {
      let dx = center.x - origin.x;
      let dy = center.y - origin.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        const c = getEntity(w, ctx.casterId);
        const f = c ? c.facing : 0;
        dx = Math.cos(f);
        dy = Math.sin(f);
      } else {
        dx /= len;
        dy /= len;
      }
      return pool.filter(e => {
        const rx = e.pos.x - origin.x;
        const ry = e.pos.y - origin.y;
        const along = rx * dx + ry * dy;
        const perp = Math.abs(rx * dy - ry * dx);
        return along >= -e.radius && along <= area.length + e.radius && perp <= area.width / 2 + e.radius;
      });
    }
  }
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
      displace(w, t, center, eff.distance, true);
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

function displace(w: World, t: SimEntity, center: Vec2, distance: number, away: boolean): void {
  if (t.rt.stationary || distance <= 0) return;
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

function createZone(w: World, ctx: CastCtx, action: SkillAction, center: Vec2, area: AreaShape): void {
  const zone = action.zone!;
  const radius = area.shape === 'circle' ? area.radius : 1;
  const z: SimZone = {
    id: newId(w),
    team: ctx.team,
    ownerPlayer: ctx.player,
    center: copy(center),
    radius,
    remaining: zone.duration,
    total: zone.duration,
    kind: zoneKind(action),
    rt: { ctx, action, nextTick: zone.tickInterval, tickInterval: Math.max(0.05, zone.tickInterval) },
  };
  w.state.zones.push(z);
  applyEffects(w, ctx, action, z.center, z.center, { shape: 'circle', radius });
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
      applyEffects(w, z.rt.ctx, z.rt.action, z.center, z.center, { shape: 'circle', radius: z.radius });
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
