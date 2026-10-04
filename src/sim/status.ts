// Status effects: one instance per id; re-applying keeps the stronger value and the longer timer.

import { DEBUFFS, type DamageSource, type StatusId, type StatusInstance } from '../types';
import type { SimEntity, SimStatus } from './world';

export function statusValue(e: { statuses: StatusInstance[] }, id: StatusId): number {
  for (const s of e.statuses) if (s.id === id) return s.value;
  return 0;
}

export function hasStatus(e: { statuses: StatusInstance[] }, id: StatusId): boolean {
  for (const s of e.statuses) if (s.id === id) return true;
  return false;
}

export function applyStatus(
  target: SimEntity,
  id: StatusId,
  duration: number,
  value: number,
  sourcePlayer: number | null,
  src?: DamageSource,
): boolean {
  if (duration <= 0 || target.rt.gone || target.hp <= 0) return false;
  if (DEBUFFS.has(id) && target.invulnTime > 0) return false;
  // Bosses never get stunned (they are stationary pattern machines).
  if (id === 'stun' && target.tier === 'boss') return false;
  const ex = target.statuses.find(s => s.id === id) as SimStatus | undefined;
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
  } else {
    const s: SimStatus = { id, remaining: duration, total: duration, value, sourcePlayer };
    if (src) s.src = src;
    target.statuses.push(s);
  }
  if (id === 'stun') {
    // Stun interrupts a cast lock …
    if (target.anim === 'cast') {
      target.rt.lockTime = 0;
      target.animTime = 0;
    }
    // … and breaks a monster's telegraphed wind-up (오우거 내려찍기, 리치 저주 장판): it never lands — skills.ts
    // tickPending drops it with its red area. The skill's cooldown stays spent. (Characters' casts are never wound up.)
    const wu = target.rt.windup;
    if (wu) {
      if (!wu.started) wu.cancelled = true;
      target.rt.windup = null;
    }
  }
  return true;
}

export function cleanse(statuses: StatusInstance[]): void {
  for (let i = statuses.length - 1; i >= 0; i--) if (DEBUFFS.has(statuses[i].id)) statuses.splice(i, 1);
}

/** Count down timers and drop expired statuses (used for field and bench). */
export function tickStatusTimers(statuses: StatusInstance[], dt: number): void {
  for (let i = statuses.length - 1; i >= 0; i--) {
    const s = statuses[i];
    s.remaining -= dt;
    if (s.remaining <= 1e-6) statuses.splice(i, 1);
  }
}
