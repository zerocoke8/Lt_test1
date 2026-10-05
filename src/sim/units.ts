// Per-tick unit behaviour: timers, DoT/regen/aura pulses, targeting (R6–R8), movement,
// basic attacks, auto normal skills, monster skills, separation.

import type { BasicAttack, BossDef } from '../types';
import { ATTACK_ANIM, MONSTER_SKILL_GAP, PULSE_INTERVAL } from './constants';
import { applyDamage, basicHit, explode, fireProjectile, heal } from './combat';
import { normalCooldownFor } from './cooldowns';
import { LOCK_RELEASE } from '../data';
import { charCtx, findWoundedAlly, unitCtx, usesWoundedAlly } from './ctx';
import { clampUnit } from './entities';
import { onMonsterDeath } from './ondeath';
import { castSkill, startAction } from './skills';
import { effStats } from './stats';
import { hasStatus, tickStatusTimers } from './status';
import { copy, dist, edgeDist, emit, getEntity, isAlive, otherTeam, type PendingHit, type SimEntity, type SimStatus, type World } from './world';

export function tickUnits(w: World, dt: number): void {
  const ents = w.state.entities;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (isAlive(e)) unitTimers(w, e, dt);
  }
  for (let i = 0; i < ents.length; i++) {
    if (w.state.phase !== 'combat') return;
    const e = ents[i];
    if (isAlive(e)) act(w, e, dt);
  }
  separate(w);
}

/** Count a timer down, snapping float dust to 0. */
function dec(x: number, dt: number): number {
  const r = x - dt;
  return r <= 1e-6 ? 0 : r;
}

function unitTimers(w: World, e: SimEntity, dt: number): void {
  const rt = e.rt;
  e.invulnTime = dec(e.invulnTime, dt);
  rt.sinceAppear += dt;
  if (e.targetId != null) e.targetHeldFor += dt;
  // 기획 4차: 기절 중에는 공격 대기시간이 멈춤 (풀리자마자 바로 때리지 못함).
  if (!hasStatus(e, 'stun')) rt.attackCd = dec(rt.attackCd, dt);
  for (let i = 0; i < rt.skillCds.length; i++) rt.skillCds[i] = dec(rt.skillCds[i], dt);
  rt.skillGap = dec(rt.skillGap, dt);
  rt.lockTime = dec(rt.lockTime, dt);
  e.animTime = dec(e.animTime, dt);
  if (e.shield > 0) {
    rt.shieldTime -= dt;
    if (rt.shieldTime <= 0) {
      e.shield = 0;
      rt.shieldTime = 0;
    }
  }
  if (e.expiresIn != null) {
    e.expiresIn -= dt;
    if (e.expiresIn <= 0) {
      rt.gone = true;
      emit(w, { type: 'death', entityId: e.id, pos: copy(e.pos), kind: e.kind, tier: e.tier });
      // 기획 12차: an ally summon with onDeath (종이 인형) also bursts when its time runs out
      if (e.kind === 'summon' && e.team === 'ally' && rt.monDef?.onDeath) onMonsterDeath(w, e);
      return;
    }
  }
  rt.pulseTimer += dt;
  if (rt.pulseTimer >= PULSE_INTERVAL - 1e-9) {
    rt.pulseTimer -= PULSE_INTERVAL;
    pulse(w, e);
    if (!isAlive(e)) return;
  }
  tickStatusTimers(e.statuses, dt);
  if (e.kind === 'character') {
    const mx = effStats(w, e).maxHp;
    if (Math.abs(mx - e.maxHp) > 1e-9) {
      e.maxHp = mx;
      e.hp = Math.min(e.hp, mx);
    }
  }
}

/** Burn / regen / healing aura, applied every PULSE_INTERVAL. */
function pulse(w: World, e: SimEntity): void {
  for (const s of e.statuses.slice() as SimStatus[]) {
    if (!isAlive(e)) return;
    if (s.id === 'burn') {
      const src = { casterId: null, team: otherTeam(e.team), player: s.sourcePlayer, source: s.src ?? 'passive', isDrag: false } as const;
      applyDamage(w, src, e, s.value * PULSE_INTERVAL, false);
    } else if (s.id === 'regen') {
      heal(w, s.sourcePlayer, e, s.value * e.maxHp * PULSE_INTERVAL);
    }
  }
  const aura = e.rt.charDef?.passive.aura;
  if (aura && isAlive(e)) {
    for (const t of w.state.entities) {
      if (t.team !== e.team || !isAlive(t)) continue;
      if (dist(e.pos, t.pos) <= aura.radius + t.radius) heal(w, e.ownerPlayer, t, aura.healPerSec * t.maxHp * PULSE_INTERVAL);
    }
  }
}

function basicOf(e: SimEntity): BasicAttack {
  return (e.rt.charDef ?? e.rt.monDef)!.basic;
}

function act(w: World, e: SimEntity, dt: number): void {
  if (hasStatus(e, 'stun')) {
    e.anim = 'stunned';
    return;
  }
  if (e.anim === 'stunned') e.anim = 'idle';
  if (e.rt.eventAi) return; // 기획 12차: 돌발 괴담 units are moved by src/sim/fieldEvents.ts
  if (e.rt.monDef?.inert) {
    // 기획 12차 (종이 인형): never moves, targets or attacks — it only stands there to be hit
    e.anim = 'idle';
    return;
  }
  if (e.rt.lockTime > 0) return; // casting / appearing: stand still
  if ((e.anim === 'appear' || e.anim === 'cast') && e.animTime <= 0) e.anim = 'idle';

  const t = updateTarget(w, e);
  if (e.kind === 'character') tryNormalSkill(w, e, t);
  else tryMonsterSkills(w, e, t);
  if (e.rt.lockTime > 0 || !isAlive(e)) return;

  if (!t || !isAlive(t)) {
    if (e.anim === 'move' || e.animTime <= 0) e.anim = 'idle';
    return;
  }
  const st = effStats(w, e);
  const d = edgeDist(e, t);
  e.facing = Math.atan2(t.pos.y - e.pos.y, t.pos.x - e.pos.x);
  if (d > st.range) {
    if (e.rt.stationary) {
      if (e.animTime <= 0) e.anim = 'idle';
      return;
    }
    const cd = dist(e.pos, t.pos);
    const step = Math.min(st.moveSpeed * dt, d - st.range + 0.02);
    if (cd > 1e-6) {
      e.pos.x += ((t.pos.x - e.pos.x) / cd) * step;
      e.pos.y += ((t.pos.y - e.pos.y) / cd) * step;
      clampUnit(w, e);
    }
    e.anim = 'move';
    return;
  }
  if (e.rt.attackCd <= 0) basicAttack(w, e, t, st.atkSpeed);
  else if (e.anim === 'move' || e.animTime <= 0) e.anim = 'idle';
}

export function nearestEnemy(w: World, e: SimEntity, filter?: (o: SimEntity) => boolean): SimEntity | null {
  let best: SimEntity | null = null;
  let bd = Infinity;
  for (const o of w.state.entities) {
    if (o.team === e.team || !isAlive(o)) continue;
    if (filter && !filter(o)) continue;
    const d = edgeDist(e, o);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** R6/R7/R8: nearest enemy, locked until it dies or leaves the field. */
/**
 * 기획 12차 돌발 괴담 targeting (docs/combat-events.md 2-1): allies never auto-pick an event 'target' while any other
 * enemy is up (rule 1, 4); monsters never pick a 'ward' (rule 7).
 */
export function pickTarget(w: World, e: SimEntity, extra?: (o: SimEntity) => boolean): SimEntity | null {
  const ok = (o: SimEntity) => !extra || extra(o);
  if (e.team === 'ally') return nearestEnemy(w, e, o => o.eventTag !== 'target' && ok(o)) ?? nearestEnemy(w, e, ok);
  return nearestEnemy(w, e, o => o.eventTag !== 'ward' && ok(o));
}

export function updateTarget(w: World, e: SimEntity): SimEntity | null {
  let t = getEntity(w, e.targetId);
  if (t && t.team === e.team) t = null;
  // 기획 12차 (rule 3): a held event target farther than LOCK_RELEASE is let go
  if (t && t.eventTag === 'target' && dist(e.pos, t.pos) > LOCK_RELEASE) t = null;
  if (t) {
    const release = w.tunables.bossLockReleaseSec;
    if (e.kind === 'character' && t.tier === 'boss' && release > 0 && e.targetHeldFor >= release) {
      const alt = pickTarget(w, e, o => o.tier !== 'boss');
      e.targetHeldFor = 0;
      if (alt) {
        t = alt;
        e.targetId = alt.id;
      }
    }
    // Stationary summons (turret) can't walk to a far target: re-pick when out of reach.
    if (e.rt.stationary && e.tier !== 'boss' && edgeDist(e, t) > e.rt.base.range) {
      const n = pickTarget(w, e);
      if (n && n !== t) {
        t = n;
        e.targetId = n.id;
        e.targetHeldFor = 0;
      }
    }
    return t;
  }
  t = pickTarget(w, e);
  e.targetId = t ? t.id : null;
  e.targetHeldFor = 0;
  return t;
}

function tryNormalSkill(w: World, e: SimEntity, t: SimEntity | null): void {
  const def = e.rt.charDef;
  if (!def || e.ownerPlayer == null || e.partyIndex == null) return;
  const p = w.state.players[e.ownerPlayer];
  const m = p.party[e.partyIndex];
  if (m.normalCooldownRemaining > 0) return;
  const sk = def.normal;
  const castRange = sk.castRange ?? 0;
  let ok: boolean;
  // 기획 12차 (메딕 응급 주사): a woundedAlly skill casts only when an ally below 90 % is in range, else keeps its cooldown
  if (usesWoundedAlly(sk)) ok = !!findWoundedAlly(w, e, castRange);
  else if (castRange >= 99) ok = !!t || w.state.entities.some(o => o.team !== e.team && isAlive(o));
  else ok = !!t && edgeDist(e, t) <= castRange;
  if (!ok) return;
  m.normalCooldownRemaining = normalCooldownFor(w.tunables, p, e.partyIndex);
  if (t) e.facing = Math.atan2(t.pos.y - e.pos.y, t.pos.x - e.pos.x);
  castSkill(w, charCtx(w, e, 'normal', sk), sk.actions);
  if (sk.castTime && sk.castTime > 0) {
    e.rt.lockTime = sk.castTime;
    e.anim = 'cast';
    e.animTime = sk.castTime;
  }
}

/** Cooldown multiplier of a monster's skills right now: enrage (bosses) × entered boss phases (기획 8차). */
export function monsterCdMult(e: SimEntity): number {
  const def = e.rt.monDef;
  const en = e.enraged && def?.tier === 'boss' ? (def as BossDef).enrage.cooldownMult : 1;
  return en * e.rt.phaseCdMult;
}

function tryMonsterSkills(w: World, e: SimEntity, t: SimEntity | null): void {
  const def = e.rt.monDef;
  const skills = e.rt.skills;
  if (!def || skills.length === 0 || !t || e.rt.skillGap > 0) return;
  for (let i = 0; i < skills.length; i++) {
    const sk = skills[i];
    if (e.rt.skillCds[i] > 0) continue;
    if (sk.castRange != null && edgeDist(e, t) > sk.castRange) continue;
    e.rt.skillCds[i] = sk.cooldown * monsterCdMult(e);
    e.rt.skillGap = MONSTER_SKILL_GAP;
    // a telegraphed skill is wound up until it lands: a stun in between breaks every part of it (status.ts)
    const ctx = unitCtx(w, e, sk.id, sk.name);
    const windup: PendingHit[] = [];
    let delay = 0;
    for (const a of sk.extra ? [sk.action, ...sk.extra] : [sk.action]) {
      const p = startAction(w, ctx, a);
      if (p) windup.push(p);
      delay = Math.max(delay, a.delay ?? 0);
    }
    e.rt.windup = windup;
    // the caster stands still until its main part lands (a charge moves it then); later parts of a sequence don't hold it
    const hold = sk.action.delay ?? 0;
    e.anim = 'cast';
    e.animTime = Math.max(0.4, Math.min(delay, hold > 0 ? hold : delay));
    if (!e.rt.stationary && hold > 0) e.rt.lockTime = hold;
    return;
  }
}

function basicAttack(w: World, e: SimEntity, t: SimEntity, atkSpeed: number): void {
  const basic = basicOf(e);
  e.rt.attackCd = 1 / Math.max(0.05, atkSpeed);
  e.anim = 'attack';
  e.animTime = Math.min(ATTACK_ANIM, e.rt.attackCd * 0.8);
  if (basic.kind === 'explode') {
    emit(w, { type: 'attack', sourceId: e.id, targetId: t.id, ranged: false });
    explode(w, e, basic.radius, basic.amount);
    return;
  }
  const ctx = e.kind === 'character' ? charCtx(w, e, 'basic', null) : unitCtx(w, e, `${e.defId}_basic`, '');
  emit(w, { type: 'attack', sourceId: e.id, targetId: t.id, ranged: basic.kind === 'projectile' });
  const onHit = e.rt.charDef?.passive.onHitStatus ?? null;
  if (basic.kind === 'melee') {
    basicHit(w, ctx, t, copy(t.pos), 1, basic.splashRadius ?? 0, onHit);
  } else {
    const color = e.rt.charDef?.color ?? e.rt.monDef?.color ?? '#ffffff';
    fireProjectile(w, ctx, e, t, basic.speed, 1, basic.splashRadius ?? 0, onHit, color);
  }
}

/** Push overlapping units apart (stationary units only push). */
function separate(w: World): void {
  const list = w.state.entities.filter(isAlive);
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    for (let j = i + 1; j < n; j++) {
      const b = list[j];
      if (a.rt.stationary && b.rt.stationary) continue;
      const minD = a.radius + b.radius;
      let dx = b.pos.x - a.pos.x;
      let dy = b.pos.y - a.pos.y;
      if (dx >= minD || dx <= -minD || dy >= minD || dy <= -minD) continue;
      let d = Math.hypot(dx, dy);
      if (d >= minD) continue;
      if (d < 1e-6) {
        const ang = ((a.id * 7919 + b.id * 104729) % 360) * (Math.PI / 180);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 0;
      } else {
        dx /= d;
        dy /= d;
      }
      const push = (minD - d) * 0.5;
      const ra = a.radius * a.radius;
      const rb = b.radius * b.radius;
      const wa = a.rt.stationary ? 0 : b.rt.stationary ? 1 : rb / (ra + rb);
      const wb = b.rt.stationary ? 0 : 1 - wa;
      a.pos.x -= dx * push * wa;
      a.pos.y -= dy * push * wa;
      b.pos.x += dx * push * wb;
      b.pos.y += dy * push * wb;
    }
  }
  for (const e of list) clampUnit(w, e);
}
