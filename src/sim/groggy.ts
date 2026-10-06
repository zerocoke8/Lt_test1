// 기획 13차 보스 그로기 (docs/boss-groggy.md): one gauge per floor boss, filled by the whole team (humans and bots) with
// drag casts and stuns that reach it. Full → the boss is down for bossGroggyDuration s (no attacks, no patterns, skill
// cooldowns frozen, damage taken ×1.5 / drag ×2), then a 10 s lock and the next max is 50 % bigger.
// The gauge is a 0..1 fraction (points ÷ the current max): a seat that turns bot / comes back changes the fill speed,
// never the bar. No randomness.

import type { BossDef, BossGroggyState, GroggyGainWhy, SkillAction } from '../types';
import { GROGGY } from '../config';
import { applyGroggy, clearStun } from './status';
import { emit, getEntity, type CastCtx, type SimEntity, type World } from './world';

// ─────────────────────────── State ───────────────────────────

function newGroggyState(): BossGroggyState {
  return { fill: 0, left: 0, total: 0, lock: 0, lockTotal: GROGGY.lock, count: 0, near: false, breaker: null };
}

/** The floor boss (alive) when it has a groggy gauge, else null. */
function groggyBoss(w: World): SimEntity | null {
  const boss = getEntity(w, w.state.bossId);
  return boss && (boss.rt.monDef as BossDef | null)?.groggy ? boss : null;
}

/** Boss floor in combat with a gauge boss and the feature on (bossGroggyThreshold > 0). */
function groggyWanted(w: World): boolean {
  const s = w.state;
  return s.phase === 'combat' && s.plan.kind === 'boss' && w.tunables.bossGroggyThreshold > 0 && !!groggyBoss(w);
}

/** Floor start / debug jump: a fresh gauge on a gauge boss's floor, else none. */
export function resetGroggy(w: World): void {
  w.state.bossGroggy = groggyWanted(w) ? newGroggyState() : null;
  w.groggy.sinceGain = 0;
}

/** Floor clear / retreat / run end: no gauge (the groggy stun goes with the boss). */
export function clearGroggy(w: World): void {
  w.state.bossGroggy = null;
  w.groggy.sinceGain = 0;
}

/** Human seats right now (a disconnected seat is a bot); at least 1. */
function humanCount(w: World): number {
  let n = 0;
  for (const p of w.state.players) if (!p.isBot) n++;
  return Math.max(1, n);
}

/** Gauge max in points: base × boss multiplier × human-count multiplier (live) × repeat multiplier. */
export function groggyMax(w: World): number {
  const boss = groggyBoss(w);
  const bossMult = (boss?.rt.monDef as BossDef | undefined)?.groggy?.threshold ?? 1;
  const humans = 1 + GROGGY.perHuman * (humanCount(w) - 1);
  const repeat = 1 + GROGGY.escalate * (w.state.bossGroggy?.count ?? 0);
  return Math.max(1, w.tunables.bossGroggyThreshold) * bossMult * humans * repeat;
}

/** The boss is down right now. */
export function isGroggy(w: World, e: { id: number }): boolean {
  const g = w.state.bossGroggy;
  return !!g && g.left > 0 && e.id === w.state.bossId;
}

/** Damage multiplier of an ally hit on the boss: groggy ×bossGroggyDamageMult, a drag cast's hit ×bossGroggyDragMult. */
export function groggyHitMult(w: World, target: SimEntity, isDrag: boolean): number {
  if (!isGroggy(w, target)) return 1;
  return Math.max(0, isDrag ? w.tunables.bossGroggyDragMult : w.tunables.bossGroggyDamageMult);
}

// ─────────────────────────── Points ───────────────────────────

/**
 * Longest stun of an action (s), 0 when it has none. 기획 13차: a stasis (크로노 시간 정지) counts like a stun of its full
 * duration (the boss is stopped for less, docs/skill-renewal.md 5-2).
 */
function stunSeconds(action: SkillAction): number {
  let d = 0;
  for (const eff of action.effects) if (eff.kind === 'status' && (eff.status === 'stun' || eff.status === 'stasis')) d = Math.max(d, eff.duration);
  return d;
}

/** What one action of a cast is worth on the boss (marks the cast so each part counts once), with its kind. */
function actionPoints(ctx: CastCtx, action: SkillAction): { points: number; why: GroggyGainWhy } | null {
  const mark = ctx.groggyMark;
  if (!mark || ctx.noGroggy) return null;
  const d = stunSeconds(action);
  const newStun = Math.max(0, d - mark.stun);
  mark.stun = Math.max(mark.stun, d);
  const W = GROGGY.weights;
  if (ctx.slot === 'drag') {
    const hit = mark.hit ? 0 : W.dragHit;
    mark.hit = true;
    return { points: hit + W.dragStun * newStun, why: 'drag' };
  }
  if (ctx.slot === 'ult') return { points: W.ultStun * newStun, why: 'ult' };
  if (ctx.slot === 'pet') return { points: W.petStun * newStun, why: 'pet' };
  if (ctx.slot === 'normal') return { points: W.normalStun * newStun, why: 'stun' };
  return null;
}

/** The gauge takes points: boss floor, boss alive and not appearing, neither groggy nor locked. */
function canGain(w: World, boss: SimEntity): boolean {
  const g = w.state.bossGroggy;
  return !!g && g.left <= 0 && g.lock <= 0 && boss.invulnTime <= 0 && boss.hp > 0;
}

/**
 * skills.ts applyEffects: an ally action reached these targets. When the boss is among them the cast's points go in
 * (a drag once however many parts / hits land; a stun on the boss turns into points instead of a stun).
 */
export function groggyOnAction(w: World, ctx: CastCtx, action: SkillAction, targets: readonly SimEntity[]): void {
  if (ctx.team !== 'ally' || ctx.player == null || !ctx.groggyMark || ctx.noGroggy) return;
  const bossId = w.state.bossId;
  const boss = bossId != null ? targets.find(t => t.id === bossId) : undefined;
  if (!boss || !w.state.bossGroggy || !canGain(w, boss)) return;
  const r = actionPoints(ctx, action);
  if (r && r.points > 0) addGroggyPoints(w, boss, ctx.player, r.points, r.why);
}

function addGroggyPoints(w: World, boss: SimEntity, player: number, points: number, why: GroggyGainWhy): void {
  const g = w.state.bossGroggy!;
  g.fill = Math.min(1, g.fill + points / groggyMax(w));
  w.groggy.sinceGain = 0;
  const p = w.state.players[player];
  if (p) p.stats.groggyPoints += points;
  if (points >= GROGGY.popMin) emit(w, { type: 'groggyGain', player, amount: points, why });
  if (g.fill >= 1 - 1e-9) breakBoss(w, boss, player);
  else g.near = g.fill >= GROGGY.nearAt;
}

// ─────────────────────────── Break / stand up ───────────────────────────

/** Full gauge: the boss goes down (the same tick), every pattern part it has not started is broken. */
export function breakBoss(w: World, boss: SimEntity, player: number | null): void {
  const g = w.state.bossGroggy;
  if (!g || g.left > 0) return;
  const duration = Math.max(0.1, w.tunables.bossGroggyDuration);
  g.fill = 1;
  g.left = duration;
  g.total = duration;
  g.lock = 0;
  g.near = false;
  g.breaker = player;
  g.count++;
  if (player != null && w.state.players[player]) w.state.players[player].stats.groggyBreaks++;
  applyGroggy(boss, duration, player);
  // also older parts no longer in rt.windup (a pattern started before the last one): all of them break with '끊김!'
  for (const p of w.pending) if (p.kind === 'hit' && p.ctx.casterId === boss.id && !p.started) p.cancelled = true;
  emit(w, { type: 'bossGroggy', entityId: boss.id, player, count: g.count, duration });
}

/** Groggy over: gauge 0, 10 s lock, the first pattern at least wakeGap s later (its cooldowns were frozen). */
function standUp(w: World, g: BossGroggyState): void {
  g.left = 0;
  g.fill = 0;
  g.lock = GROGGY.lock;
  g.lockTotal = GROGGY.lock;
  w.groggy.sinceGain = 0;
  const boss = getEntity(w, w.state.bossId);
  if (!boss) return;
  clearStun(boss);
  if (boss.anim === 'stunned') boss.anim = 'idle';
  boss.rt.skillGap = Math.max(boss.rt.skillGap, GROGGY.wakeGap);
  emit(w, { type: 'bossGroggyEnd', entityId: boss.id });
}

/** Count a timer down, snapping float dust to 0. */
function dec(x: number, dt: number): number {
  const r = x - dt;
  return r <= 1e-6 ? 0 : r;
}

/** game.ts tick (after tickUnits): countdown, lock, decay; the gauge comes / goes with the feature toggle. */
export function tickGroggy(w: World, dt: number): void {
  const s = w.state;
  const wanted = groggyWanted(w);
  if (!s.bossGroggy) {
    if (wanted) resetGroggy(w);
    return;
  }
  const g = s.bossGroggy;
  if (!wanted && g.left <= 0) {
    clearGroggy(w);
    return;
  }
  if (g.left > 0) {
    g.left = dec(g.left, dt);
    if (g.left <= 0) standUp(w, g);
  } else if (g.lock > 0) {
    g.lock = dec(g.lock, dt);
  } else {
    w.groggy.sinceGain += dt;
    if (w.groggy.sinceGain > GROGGY.decayAfter + 1e-9 && g.fill > 0) g.fill = Math.max(0, g.fill - (GROGGY.decayPerSec * dt) / groggyMax(w));
  }
  g.near = g.left <= 0 && g.lock <= 0 && g.fill >= GROGGY.nearAt;
}

/** Debug 'forceGroggy': set the gauge (1 = break now; the lock is cleared). Boss floor, not already groggy. */
export function forceGroggy(w: World, fill = 1): boolean {
  const g = w.state.bossGroggy;
  const boss = groggyBoss(w);
  if (!g || !boss || g.left > 0 || w.state.phase !== 'combat') return false;
  g.lock = 0;
  g.fill = Math.min(1, Math.max(0, Number.isFinite(fill) ? fill : 1));
  w.groggy.sinceGain = 0;
  if (g.fill >= 1 - 1e-9) breakBoss(w, boss, null);
  else g.near = g.fill >= GROGGY.nearAt;
  return true;
}
