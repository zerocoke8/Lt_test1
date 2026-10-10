// Status effects: one instance per id; re-applying keeps the stronger value and the longer timer.

import { CONTROL_STATUSES, DEBUFFS, type DamageSource, type StatusId, type StatusInstance, type Vec2 } from '../types';
import { STASIS } from '../config';
import type { SimEntity, SimStatus } from './world';

/** 기획 13차: where / who a new status came from (tether anchor = the action center, taunt source = the caster). */
export interface StatusOpts {
  anchor?: Vec2;
  sourceEntityId?: number | null;
}

export function statusValue(e: { statuses: StatusInstance[] }, id: StatusId): number {
  for (const s of e.statuses) if (s.id === id) return s.value;
  return 0;
}

export function hasStatus(e: { statuses: StatusInstance[] }, id: StatusId): boolean {
  for (const s of e.statuses) if (s.id === id) return true;
  return false;
}

/** Boss or mid boss (기획 13차: the 'bossy' column of the new statuses, docs/skill-renewal.md 5-2). */
export function isBossy(e: { tier: SimEntity['tier'] }): boolean {
  return e.tier === 'boss' || e.tier === 'mid';
}

/**
 * Who shrugs a status off. Bosses never get stunned (they are stationary pattern machines; the boss groggy is the
 * one exception, applyGroggy). 기획 13차 control statuses: 돌발 괴담 units ignore them all; taunt / tether skip bosses,
 * mid bosses and stationary units, root skips what never moves, charm skips bosses / mid bosses / summons, and a
 * boss / mid boss is immune to stasis for STASIS.immune s after one.
 */
export function statusImmune(target: SimEntity, id: StatusId): boolean {
  if (id === 'stun') return target.tier === 'boss';
  if (!CONTROL_STATUSES.has(id)) return false;
  if (target.eventTag) return true;
  switch (id) {
    case 'taunt':
    case 'tether':
      return isBossy(target) || target.rt.stationary;
    case 'root':
      return target.tier === 'boss' || target.rt.stationary;
    case 'charm':
      return isBossy(target) || target.kind === 'summon';
    case 'stasis':
      return isBossy(target) && (target.rt.stasisImmune ?? 0) > 0;
    default:
      return false;
  }
}

/** Merge a status into a list: one instance per id, the stronger value and the longer timer win. Returns the instance. */
export function mergeStatus(list: StatusInstance[], id: StatusId, duration: number, value: number, sourcePlayer: number | null, src?: DamageSource): SimStatus {
  const ex = list.find(s => s.id === id) as SimStatus | undefined;
  if (ex) {
    if (value >= ex.value) {
      ex.value = value;
      ex.sourcePlayer = sourcePlayer;
      if (src) ex.src = src;
    }
    if (duration >= ex.remaining) {
      ex.remaining = duration;
      ex.total = duration;
    }
    return ex;
  }
  const s: SimStatus = { id, remaining: duration, total: duration, value, sourcePlayer };
  if (src) s.src = src;
  list.push(s);
  return s;
}

export function applyStatus(
  target: SimEntity,
  id: StatusId,
  duration: number,
  value: number,
  sourcePlayer: number | null,
  src?: DamageSource,
  opts?: StatusOpts,
): boolean {
  if (duration <= 0 || target.rt.gone || target.hp <= 0) return false;
  if (DEBUFFS.has(id) && target.invulnTime > 0) return false;
  if (statusImmune(target, id)) return false;
  const d = id === 'stasis' && isBossy(target) ? duration * STASIS.bossTimeMult : duration;
  const s = mergeStatus(target.statuses, id, d, value, sourcePlayer, src);
  setStatusData(target, s, opts);
  if (id === 'stun') breakWindup(target);
  return true;
}

/** 기획 13차: the data a new status keeps (re-applying a root keeps its spot, a stasis keeps what it stored). */
function setStatusData(target: SimEntity, s: StatusInstance, opts?: StatusOpts): void {
  switch (s.id) {
    case 'taunt':
      if (opts?.sourceEntityId != null) s.data = { sourceEntityId: opts.sourceEntityId };
      break;
    case 'tether':
      s.data = { anchor: { ...(opts?.anchor ?? target.pos) }, radius: Math.max(0, s.value) };
      break;
    case 'root':
      if (!s.data) s.data = { anchor: { ...target.pos }, radius: 0 };
      break;
    case 'stasis':
      if (!s.data) s.data = { stored: 0 };
      break;
    default:
      break;
  }
}

/**
 * 기획 13차 묶기 / 속박: keep a tethered (rooted) unit within its radius of the anchor — after it moved, was pushed or
 * separated. Returns true when it was pulled back.
 */
export function constrainTether(e: SimEntity): boolean {
  let moved = false;
  for (const s of e.statuses) {
    if ((s.id !== 'tether' && s.id !== 'root') || !s.data?.anchor) continue;
    const a = s.data.anchor;
    const r = s.data.radius ?? 0;
    const dx = e.pos.x - a.x;
    const dy = e.pos.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= r + 1e-9) continue;
    e.pos.x = d > 1e-9 ? a.x + (dx / d) * r : a.x;
    e.pos.y = d > 1e-9 ? a.y + (dy / d) * r : a.y;
    moved = true;
  }
  return moved;
}

/** 기획 13차 정지: damage a stopped unit takes is stored for the rebound. */
export function storeStasisDamage(e: SimEntity, dealt: number): void {
  if (!(dealt > 0)) return;
  for (const s of e.statuses) if (s.id === 'stasis' && s.data) s.data.stored = (s.data.stored ?? 0) + dealt;
}

/**
 * A stun interrupts a cast lock and breaks a monster's telegraphed wind-up (오우거 내려찍기, 리치 저주 장판, 돌진, 순간이동 뒤
 * 찌르기 — every part): it never lands — skills.ts tickPending drops it with its red area. The skill's cooldown stays
 * spent. (Characters' casts are never wound up.) Shared by stuns and the boss groggy (기획 13차).
 */
export function breakWindup(target: SimEntity): void {
  if (target.anim === 'cast') {
    target.rt.lockTime = 0;
    target.animTime = 0;
  }
  for (const wu of target.rt.windup) if (!wu.started) wu.cancelled = true;
  target.rt.windup = [];
}

/**
 * 기획 13차 보스 그로기: the one stun a boss takes — skips the boss stun immunity (and the appear invulnerability) for
 * this source only. Same rules as a stun: no action, attack timer frozen, wind-ups broken, stun icon on the boss row.
 */
export function applyGroggy(boss: SimEntity, duration: number, sourcePlayer: number | null): void {
  if (duration <= 0 || boss.rt.gone || boss.hp <= 0) return;
  const ex = boss.statuses.find(s => s.id === 'stun');
  if (ex) {
    ex.remaining = Math.max(ex.remaining, duration);
    ex.total = Math.max(ex.total, duration);
    ex.sourcePlayer = sourcePlayer;
  } else {
    boss.statuses.push({ id: 'stun', remaining: duration, total: duration, value: 0, sourcePlayer });
  }
  boss.anim = 'stunned';
  breakWindup(boss);
}

/** 기획 13차: the groggy stun leaves with the groggy (stand-up, retreat, debug). */
export function clearStun(e: SimEntity): void {
  for (let i = e.statuses.length - 1; i >= 0; i--) if (e.statuses[i].id === 'stun') e.statuses.splice(i, 1);
}

export function cleanse(statuses: StatusInstance[]): void {
  for (let i = statuses.length - 1; i >= 0; i--) if (DEBUFFS.has(statuses[i].id)) statuses.splice(i, 1);
}

/** Count down timers and drop expired statuses (used for field and bench). onExpire (기획 17차): each one that ran out. */
export function tickStatusTimers(statuses: StatusInstance[], dt: number, onExpire?: (s: StatusInstance) => void): void {
  for (let i = statuses.length - 1; i >= 0; i--) {
    const s = statuses[i];
    s.remaining -= dt;
    if (s.remaining <= 1e-6) {
      statuses.splice(i, 1);
      onExpire?.(s);
    }
  }
}
