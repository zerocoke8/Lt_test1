// Damage, healing, shields, deaths, basic attacks and projectiles.

import type { DamageSource, StatusId, Team, Vec2 } from '../types';
import { PROJECTILE_MAX_LIFE } from './constants';
import { unitCtx } from './ctx';
import { hasRelic, relicParam } from './modifiers';
import { benchMaxHp, effStats } from './stats';
import { applyStatus, statusValue } from './status';
import {
  aliveEnemiesOf,
  copy,
  dist,
  emit,
  endRun,
  getEntity,
  isAlive,
  newId,
  type CastCtx,
  type SimEntity,
  type SimPlayer,
  type SimProjectile,
  type World,
} from './world';

export interface DmgSrc {
  casterId: number | null;
  team: Team;
  player: number | null;
  source: DamageSource;
  isDrag: boolean;
  /** Skill name (CastCtx carries it); only copied onto the cosmetic damage event. */
  name?: string;
}

/** Damage sources whose hits carry the skill name on the damage event (render shows it under the number). */
const SKILL_NAMED: ReadonlySet<DamageSource> = new Set<DamageSource>(['normal', 'drag', 'ult', 'pet']);

export interface OnHit {
  chance: number;
  status: StatusId;
  duration: number;
  value: number;
}

/** amount × caster atk × mults, with a crit roll. */
export function hitDamage(w: World, ctx: CastCtx, target: SimEntity, amount: number): number {
  if (!isAlive(target)) return 0;
  const crit = ctx.critChance > 0 && w.rng.chance(ctx.critChance);
  const raw = ctx.atk * amount * ctx.dmgMult * (crit ? ctx.critMult : 1);
  return applyDamage(w, ctx, target, raw, crit);
}

/** Apply raw (pre-mitigation) damage. Returns the mitigated hit (incl. shield-absorbed, incl. overkill). */
export function applyDamage(w: World, src: DmgSrc, target: SimEntity, raw: number, crit: boolean): number {
  if (!isAlive(target) || !(raw > 0)) return 0;
  if (target.team === src.team) return 0;
  if (target.invulnTime > 0) return 0;
  if (w.tunables.invincible && target.kind === 'character') return 0;
  let dmg = raw * (1 + statusValue(target, 'vulnerable'));
  const sp = src.player != null ? w.state.players[src.player] : undefined;
  if (sp) {
    if (sp.isBot) dmg *= Math.max(0, w.tunables.botDamageMult);
    if ((target.tier === 'boss' || target.tier === 'mid') && hasRelic(sp, 'rage_breaker')) {
      dmg *= 1 + relicParam('rage_breaker', target.enraged ? 'enragedPct' : 'pct');
    }
  }
  dmg *= 1 - effStats(w, target).def;
  if (!(dmg > 0)) return 0;
  const hpBefore = Math.max(0, target.hp);
  const absorbed = Math.min(target.shield, dmg);
  target.shield -= absorbed;
  target.hp -= dmg - absorbed;
  // The event shows the full hit; stats / lifesteal count only what the target could actually lose (no overkill).
  emit(w, {
    type: 'damage',
    targetId: target.id,
    amount: dmg,
    crit,
    pos: copy(target.pos),
    targetTeam: target.team,
    absorbed,
    source: src.source,
    ...(src.name && SKILL_NAMED.has(src.source) ? { skillName: src.name } : null),
  });
  const dealt = absorbed + Math.min(dmg - absorbed, hpBefore);
  if (sp) {
    sp.stats.damageDealt += dealt;
    if (target.tier === 'boss') sp.stats.damageToBoss += dealt;
    sp.stats.damageBySource[src.source] += dealt;
  }
  if (target.kind === 'character' && target.ownerPlayer != null) w.state.players[target.ownerPlayer].stats.damageTaken += dealt;

  const caster = getEntity(w, src.casterId);
  if (caster) {
    const ls = statusValue(caster, 'lifesteal');
    if (ls > 0) heal(w, src.player, caster, dealt * ls);
    if (src.isDrag && sp && hasRelic(sp, 'blood_chalice')) heal(w, src.player, caster, dealt * relicParam('blood_chalice', 'pct'));
  }

  if (target.hp <= 0) {
    if (target.tier === 'boss') {
      target.hp = 0;
      w.bossRetreat = true;
    } else {
      killEntity(w, target, src);
    }
  }
  return dmg;
}

export function heal(w: World, player: number | null, target: SimEntity, amount: number): number {
  if (!isAlive(target) || !(amount > 0)) return 0;
  const actual = Math.min(target.maxHp - target.hp, amount);
  if (!(actual > 0)) return 0;
  target.hp += actual;
  emit(w, { type: 'heal', targetId: target.id, amount: actual, pos: copy(target.pos) });
  if (player != null) w.state.players[player].stats.healing += actual;
  return actual;
}

export function addShield(target: SimEntity, amount: number, duration: number): void {
  if (!isAlive(target) || !(amount > 0)) return;
  target.shield = Math.min(target.maxHp, target.shield + amount);
  target.rt.shieldTime = Math.max(target.rt.shieldTime, duration);
}

/** Bench swap cooldown reduction (pet rabbit, hunter_mark). */
export function reduceBenchSwapCd(p: SimPlayer, seconds: number): void {
  p.party.forEach((m, i) => {
    if (i === p.activeIndex) return;
    m.swapCooldownRemaining = Math.max(0, m.swapCooldownRemaining - seconds);
  });
}

export function killEntity(w: World, e: SimEntity, killer: DmgSrc | null): void {
  if (e.rt.gone) return;
  e.hp = 0;
  e.rt.gone = true;
  emit(w, { type: 'death', entityId: e.id, pos: copy(e.pos), kind: e.kind, tier: e.tier });
  if (e.kind === 'character') {
    characterDied(w, e);
    return;
  }
  if (e.team === 'enemy') {
    if (e.tier !== 'mid' && e.tier !== 'boss') w.spawner.kills++;
    const kp = killer?.player != null ? w.state.players[killer.player] : undefined;
    if (kp) {
      kp.stats.kills++;
      if (hasRelic(kp, 'hunter_mark')) reduceBenchSwapCd(kp, relicParam('hunter_mark', 'seconds'));
    }
  }
}

function characterDied(w: World, e: SimEntity): void {
  if (e.ownerPlayer == null || e.partyIndex == null) return;
  const p = w.state.players[e.ownerPlayer];
  const idx = e.partyIndex;
  const m = p.party[idx];
  m.dead = true;
  m.hp = 0;
  m.maxHp = benchMaxHp(p, idx);
  m.shield = 0;
  m.rt.shieldTime = 0;
  m.statuses = [];
  m.entityId = null;
  const phoenix = hasRelic(p, 'phoenix_feather') ? 1 - relicParam('phoenix_feather', 'revivePct') : 1;
  m.reviveRemaining = Math.max(0, w.tunables.reviveTime) * phoenix;
  if (p.activeIndex === idx) p.activeIndex = null;
  if (!p.out && p.party.every(x => x.dead)) {
    p.out = true;
    emit(w, { type: 'playerOut', player: p.id });
    // A boss already at 0 HP this tick retreats first (tickFloorState resolves clear → then the wipe).
    if (w.state.players.every(x => x.out) && !w.bossRetreat) endRun(w, 'defeat', 'wipe');
  }
}

/** Basic-attack hit: primary target + splash around `at`, then passive on-hit status. */
export function basicHit(
  w: World,
  ctx: CastCtx,
  target: SimEntity | null,
  at: Vec2,
  amount: number,
  splashRadius: number,
  onHit: OnHit | null,
): void {
  if (target && isAlive(target)) {
    hitDamage(w, ctx, target, amount);
    if (onHit && isAlive(target) && w.rng.chance(onHit.chance)) {
      const value = onHit.status === 'burn' ? onHit.value * ctx.atk : onHit.value;
      applyStatus(target, onHit.status, onHit.duration, value, ctx.player, 'passive');
    }
  }
  if (splashRadius > 0) {
    for (const e of aliveEnemiesOf(w, ctx.team)) {
      if (e === target) continue;
      if (dist(at, e.pos) <= splashRadius + e.radius) hitDamage(w, ctx, e, amount);
    }
  }
}

export function fireProjectile(
  w: World,
  ctx: CastCtx,
  from: SimEntity,
  target: SimEntity,
  speed: number,
  amount: number,
  splashRadius: number,
  onHit: OnHit | null,
  color: string,
): void {
  const p: SimProjectile = {
    id: newId(w),
    team: ctx.team,
    pos: copy(from.pos),
    targetId: target.id,
    targetPos: copy(target.pos),
    speed,
    color,
    rt: { ctx, amount, splashRadius, onHit, life: PROJECTILE_MAX_LIFE },
  };
  w.state.projectiles.push(p);
}

export function tickProjectiles(w: World, dt: number): void {
  const list = w.state.projectiles;
  const snapshot = list.slice();
  const keep: SimProjectile[] = [];
  for (const p of snapshot) {
    const t = getEntity(w, p.targetId);
    if (t) p.targetPos = copy(t.pos);
    else p.targetId = null;
    const dx = p.targetPos.x - p.pos.x;
    const dy = p.targetPos.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    const reach = t ? t.radius * 0.5 : 0;
    p.rt.life -= dt;
    if (d - reach <= step) {
      p.pos = copy(p.targetPos);
      basicHit(w, p.rt.ctx, t, p.targetPos, p.rt.amount, p.rt.splashRadius, p.rt.onHit);
      continue;
    }
    p.pos.x += (dx / d) * step;
    p.pos.y += (dy / d) * step;
    if (p.rt.life > 0) keep.push(p);
  }
  list.length = 0;
  list.push(...keep);
}

/** Bomb bug: damages enemies in radius around itself and dies. */
export function explode(w: World, e: SimEntity, radius: number, amount: number): void {
  const ctx = unitCtx(w, e, `${e.defId}_explode`, '자폭');
  emit(w, {
    type: 'skillCast',
    sourceId: e.id,
    player: null,
    slot: 'monster',
    skillId: ctx.skillId,
    name: ctx.name,
    center: copy(e.pos),
    area: { shape: 'circle', radius },
    team: e.team,
  });
  for (const t of aliveEnemiesOf(w, e.team)) {
    if (dist(e.pos, t.pos) <= radius + t.radius) hitDamage(w, ctx, t, amount);
  }
  killEntity(w, e, null);
}
