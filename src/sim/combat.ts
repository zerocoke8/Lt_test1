// Damage, healing, shields, deaths, basic attacks and projectiles.

import type { DamageSource, StatusId, Team, Vec2 } from '../types';
import { PROJECTILE_MAX_LIFE } from './constants';
import { unitCtx } from './ctx';
import { WEAK_MULT } from '../data';
import { fieldEventDeath } from './fieldEvents';
import { groggyHitMult } from './groggy';
import { damageTakenMult, hasRelic, relicParam } from './modifiers';
import { onMonsterDeath } from './ondeath';
import { checkPhases } from './phases';
import { benchMaxHp, effStats } from './stats';
import { applyStatus, statusValue, storeStasisDamage } from './status';
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
  type GroggyMark,
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
  /** 기획 13차: the cast's groggy mark (CastCtx); a cast that broke the boss gets no groggy multiplier. */
  groggyMark?: GroggyMark;
  /** 기획 13차 (정지 반동): fixed damage — no vulnerable / weak / groggy / bot / relic / defense / trace multipliers. */
  pure?: boolean;
}

/** Damage sources whose hits carry the skill name on the damage event (render shows it under the number). */
const SKILL_NAMED: ReadonlySet<DamageSource> = new Set<DamageSource>(['normal', 'drag', 'ult', 'pet']);

/** 기획 12차: 흡혼 표식 heals at this fraction on boss / mid-boss targets. */
export const DRAIN_BOSS_MULT = 0.5;

export interface OnHit {
  chance: number;
  status: StatusId;
  duration: number;
  value: number;
}

/** amount × caster atk × mults, with a crit roll (forceCrit 기획 13차: a guaranteed crit, no roll). */
export function hitDamage(w: World, ctx: CastCtx, target: SimEntity, amount: number, forceCrit = false): number {
  if (!isAlive(target)) return 0;
  const crit = forceCrit || (ctx.critChance > 0 && w.rng.chance(ctx.critChance));
  const raw = ctx.atk * amount * ctx.dmgMult * (crit ? ctx.critMult : 1);
  return applyDamage(w, ctx, target, raw, crit);
}

/**
 * 기획 12차: drag skills and pets hit a 돌발 괴담 target ×2 ('약점'), including what they left on the field — the pet
 * turret's shots (source 'summon') and the paper doll's burst (source 'drag', not a drag cast). byId, not getEntity:
 * the doll bursts as it dies.
 */
function weakHit(w: World, src: DmgSrc): boolean {
  if (src.isDrag || src.source === 'pet') return true;
  const slot = src.casterId != null ? w.byId.get(src.casterId)?.rt.summonSlot : undefined;
  return slot === 'pet' || slot === 'drag';
}

/** Every multiplier of a hit (vulnerable, 약점, groggy, bot, relic, defense, 괴담 trace) applied to raw. */
function hitMults(w: World, src: DmgSrc, target: SimEntity, raw: number): { dmg: number; weak: boolean; groggy: boolean } {
  let dmg = raw * (1 + statusValue(target, 'vulnerable'));
  const weak = target.eventTag === 'target' && weakHit(w, src);
  if (weak) dmg *= WEAK_MULT;
  // 기획 13차: a groggy boss takes ×1.5, a drag cast's hit ×2 (after vulnerable, before defense; stacks with the rest)
  const groggyMult = target.tier === 'boss' && !src.groggyMark?.broke ? groggyHitMult(w, target, src.isDrag) : 1;
  const groggy = groggyMult !== 1;
  dmg *= groggyMult;
  const sp = src.player != null ? w.state.players[src.player] : undefined;
  if (sp) {
    if (sp.isBot) dmg *= Math.max(0, w.tunables.botDamageMult);
    if ((target.tier === 'boss' || target.tier === 'mid') && hasRelic(sp, 'rage_breaker')) {
      dmg *= 1 + relicParam('rage_breaker', target.enraged ? 'enragedPct' : 'pct');
    }
  }
  dmg *= 1 - effStats(w, target).def;
  // 기획 10차: 괴담 traces change the damage my characters take (once per hit)
  if (target.kind === 'character' && target.ownerPlayer != null) dmg *= damageTakenMult(w.state.players[target.ownerPlayer]);
  return { dmg, weak, groggy };
}

/** Apply raw (pre-mitigation) damage. Returns the mitigated hit (incl. shield-absorbed, incl. overkill). */
export function applyDamage(w: World, src: DmgSrc, target: SimEntity, raw: number, crit: boolean): number {
  if (target.eventTag === 'ward') return 0; // 기획 12차: the patient / sleepwalker never take damage
  if (!isAlive(target) || !(raw > 0)) return 0;
  if (target.team === src.team) return 0;
  if (target.invulnTime > 0) return 0;
  if (w.tunables.invincible && target.kind === 'character') return 0;
  const sp = src.player != null ? w.state.players[src.player] : undefined;
  const m = src.pure ? { dmg: raw, weak: false, groggy: false } : hitMults(w, src, target, raw);
  const dmg = m.dmg;
  const weak = m.weak;
  const groggy = m.groggy;
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
    ...(weak ? { weak: true as const } : null),
    ...(groggy ? { groggy: true as const, ...(src.isDrag ? { drag: true as const } : null) } : null),
  });
  const dealt = absorbed + Math.min(dmg - absorbed, hpBefore);
  storeStasisDamage(target, dealt); // 기획 13차 정지: stored for the rebound
  if (sp) {
    sp.stats.damageDealt += dealt;
    if (target.tier === 'boss') sp.stats.damageToBoss += dealt;
    if (groggy) sp.stats.groggyDamage += dealt;
    sp.stats.damageBySource[src.source] += dealt;
  }
  if (target.kind === 'character' && target.ownerPlayer != null) w.state.players[target.ownerPlayer].stats.damageTaken += dealt;

  const caster = getEntity(w, src.casterId);
  if (caster) {
    const ls = statusValue(caster, 'lifesteal');
    if (ls > 0) heal(w, src.player, caster, dealt * ls);
    if (src.isDrag && sp && hasRelic(sp, 'blood_chalice')) heal(w, src.player, caster, dealt * relicParam('blood_chalice', 'pct'));
  }
  if (target.team === 'enemy') drainHeal(w, src, caster, target, dealt);

  if (target.hp <= 0) {
    if (target.tier === 'boss') {
      target.hp = 0;
      w.bossRetreat = true;
    } else {
      killEntity(w, target, src);
    }
  } else if (target.rt.monDef) {
    checkPhases(w, target);
  }
  return dmg;
}

/**
 * 기획 12차 흡혼 표식 (퇴마사): a hit on a marked enemy heals the attacker by dealt × mark value (boss / mid boss: half).
 * The attacker is the hitting ally character; pets, turrets, zones and DoTs heal that player's field character instead.
 * Credited to the player who placed the mark.
 */
function drainHeal(w: World, src: DmgSrc, caster: SimEntity | null, target: SimEntity, dealt: number): void {
  const mark = target.statuses.find(s => s.id === 'drain');
  if (!mark || !(mark.value > 0) || !(dealt > 0)) return;
  const healer = caster && caster.kind === 'character' && caster.team === 'ally' ? caster : fieldCharacterOf(w, src.player);
  if (!healer) return;
  const bossHalf = target.tier === 'boss' || target.tier === 'mid' ? DRAIN_BOSS_MULT : 1;
  heal(w, mark.sourcePlayer, healer, dealt * mark.value * bossHalf, target.id);
}

function fieldCharacterOf(w: World, player: number | null): SimEntity | null {
  if (player == null) return null;
  const p = w.state.players[player];
  if (!p || p.activeIndex == null) return null;
  return getEntity(w, p.party[p.activeIndex].entityId);
}

/** fromId (기획 12차): the 흡혼-marked enemy a drain heal came from (cosmetic, on the event only). */
export function heal(w: World, player: number | null, target: SimEntity, amount: number, fromId?: number): number {
  if (!isAlive(target) || !(amount > 0)) return 0;
  const actual = Math.min(target.maxHp - target.hp, amount);
  if (!(actual > 0)) return 0;
  target.hp += actual;
  emit(w, { type: 'heal', targetId: target.id, amount: actual, pos: copy(target.pos), ...(fromId != null ? { from: fromId } : null) });
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

/**
 * opts.noOnDeath: remove without the monster's onDeath (debug "적 전멸" clears the field; splits would refill it).
 */
export function killEntity(w: World, e: SimEntity, killer: DmgSrc | null, opts?: { noOnDeath?: boolean }): void {
  if (e.rt.gone) return;
  e.hp = 0;
  e.rt.gone = true;
  emit(w, { type: 'death', entityId: e.id, pos: copy(e.pos), kind: e.kind, tier: e.tier });
  if (e.kind === 'character') {
    characterDied(w, e);
    return;
  }
  if (!opts?.noOnDeath) onMonsterDeath(w, e);
  if (e.team === 'enemy') {
    // 기획 12차: 돌발 괴담 units never count toward the mid boss
    if (e.tier !== 'mid' && e.tier !== 'boss' && !e.eventTag) w.spawner.kills++;
    const kp = killer?.player != null ? w.state.players[killer.player] : undefined;
    if (kp) {
      kp.stats.kills++;
      if (hasRelic(kp, 'hunter_mark')) reduceBenchSwapCd(kp, relicParam('hunter_mark', 'seconds'));
    }
  }
  if (w.state.fieldEvent) fieldEventDeath(w, e, killer);
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
    team: ctx.team,
  });
  // 기획 13차: a charmed bomb (ctx team flipped) blows up its own side
  for (const t of aliveEnemiesOf(w, ctx.team)) {
    if (t !== e && dist(e.pos, t.pos) <= radius + t.radius) hitDamage(w, ctx, t, amount);
  }
  killEntity(w, e, null);
}
