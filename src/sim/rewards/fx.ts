// 기획 17차: shared effect helpers for the reward groups (docs/floor-rewards.md 「공통 안전장치」). Every extra hit a
// reward makes goes through a reward context (no groggy, no reward / relic multipliers, counted as 'relic' damage);
// summons, zones and mines obey the per-player caps here so no track has to count them.

import type { AreaShape, Effect, SkillAction, StatusId, Vec2 } from '../../types';
import { DEBUFFS } from '../../types';
import { TAG_BONUS, getCharacter, getFamily, getMonster, hasFamily } from '../../data';
import { addShield, applyDamage, hitDamage } from '../combat';
import { PROJECTILE_MAX_LIFE } from '../constants';
import { charCtx } from '../ctx';
import { createUnit } from '../entities';
import { gearStatMods } from '../expeditionGear';
import { hitsArea } from '../geometry';
import { rewardGroggy } from '../groggy';
import { partyStatMods } from '../modifiers';
import { forceSwapIn } from '../players';
import { castSkill } from '../skills';
import { effStats } from '../stats';
import { applyStatus } from '../status';
import {
  activeEntity,
  aliveEnemiesOf,
  clampToArena,
  copy,
  dist,
  emit,
  getEntity,
  isAlive,
  newId,
  type CastCtx,
  type RewardUnitGroup,
  type SimEntity,
  type SimMember,
  type SimPlayer,
  type SimProjectile,
  type SimZone,
  type World,
} from '../world';
import { tagActive } from './query';

// ─────────────────────────── Caps ───────────────────────────

/** Per player: reward zones (발자국 · 안개 · 방패 · 잔향 …) alive at once; the oldest goes first. */
export const REWARD_ZONE_CAP = 4;
/** Per player: afterimages (잔상 · 도플갱어 분신 · 둘이서) / reward turrets / straw dolls (with the 종이 인형) alive at once. */
export const UNIT_CAPS: Record<RewardUnitGroup, number> = { afterimage: 2, turret: 1, decoy: 2 };
/** Gauge share rewards may fill directly per groggy cycle (합동 의식, 삼인 분향). */
export const REWARD_GROGGY_CAP = 0.3;

// ─────────────────────────── Contexts ───────────────────────────

function familyName(id: string): string {
  return hasFamily(id) ? getFamily(id).name : id;
}

/**
 * A reward context from one of p's casts (gearCtx-like): no caster, no groggy, no reward multipliers, 'relic' damage.
 * id = the family key (also the skillCast skillId render keys on).
 */
export function rewardCtx(base: CastCtx, id: string, at: Vec2): CastCtx {
  return {
    ...base,
    casterId: null,
    selfId: null,
    slot: 'passive',
    source: 'relic',
    skillId: id,
    name: familyName(id),
    dmgMult: 1,
    healMult: 1,
    shieldMult: 1,
    radiusMult: 1,
    isDrag: false,
    point: copy(at),
    origin: copy(at),
    targetId: null,
    targetPos: null,
    allyTargetId: null,
    groggyMark: undefined,
    noGroggy: true,
    ultCast: undefined,
    justMult: undefined,
    forceCrit: undefined,
    groggyMult: undefined,
  };
}

/** Attack / crit of member idx now: its field stats, or (bench, down) base × party rewards × gear. */
export function memberStats(w: World, p: SimPlayer, idx: number): { atk: number; critChance: number; critMult: number } {
  const e = getEntity(w, p.party[idx]?.entityId);
  if (e) {
    const st = effStats(w, e);
    return { atk: st.atk, critChance: st.critChance, critMult: st.critMult };
  }
  const def = getCharacter(p.party[idx].defId);
  const mods = partyStatMods(p);
  const gear = gearStatMods(p, idx);
  const atkPct = mods.atkPct + (gear?.atkPct ?? 0);
  const crit = mods.critChance + (gear?.critChance ?? 0);
  return {
    atk: def.stats.atk * Math.max(0, 1 + atkPct),
    critChance: Math.max(0, Math.min(1, def.stats.critChance + crit)),
    critMult: def.stats.critMult + mods.critMult + (gear?.critMult ?? 0),
  };
}

/** A reward context for member idx of p (on the field or not) at `at`. */
export function memberCtx(w: World, p: SimPlayer, idx: number, id: string, at: Vec2): CastCtx {
  const e = getEntity(w, p.party[idx]?.entityId);
  if (e) return rewardCtx(charCtx(w, e, 'passive', null), id, at);
  const st = memberStats(w, p, idx);
  return {
    casterId: null,
    selfId: null,
    team: 'ally',
    player: p.id,
    partyIndex: idx,
    slot: 'passive',
    source: 'relic',
    skillId: id,
    name: familyName(id),
    atk: st.atk,
    critChance: st.critChance,
    critMult: st.critMult,
    dmgMult: 1,
    healMult: 1,
    shieldMult: 1,
    radiusMult: 1,
    point: copy(at),
    targetId: null,
    targetPos: null,
    allyTargetId: null,
    origin: copy(at),
    isDrag: false,
    summonMult: 1,
    noGroggy: true,
  };
}

// ─────────────────────────── Procs / delays ───────────────────────────

/** The head pill: family `key` of p fired (idx = whose head; null = the field character's). */
export function proc(w: World, p: SimPlayer, idx: number | null, key: string, pos: Vec2, text?: string): void {
  const i = idx ?? p.activeIndex;
  const entityId = i != null ? (p.party[i]?.entityId ?? null) : null;
  emit(w, { type: 'rewardProc', player: p.id, partyIndex: i ?? null, entityId, rewardId: key, pos: copy(pos), ...(text ? { text } : null) });
}

/** A delayed beat for the hooks' onDelay (tag tells whose: use '<family>' or '<family>.<what>'). */
export function scheduleReward(w: World, p: SimPlayer, tag: string, remaining: number, data: Record<string, number> = {}, pos?: Vec2, ctx?: CastCtx): void {
  w.pending.push({ kind: 'rewardDelay', player: p.id, tag, remaining: Math.max(0, remaining), data, ...(pos ? { pos: copy(pos) } : null), ...(ctx ? { ctx } : null) });
}

/** Reward runtime numbers of p (internal cooldowns as sim times, stacks): never on the wire. */
export function rtNum(p: SimPlayer, key: string, def = 0): number {
  return p.rt.reward?.[key] ?? def;
}

export function setRtNum(p: SimPlayer, key: string, v: number): void {
  (p.rt.reward ??= {})[key] = v;
}

/** Internal cooldown: true (and starts it) when `key` is ready at sim time now. */
export function icdReady(w: World, p: SimPlayer, key: string, seconds: number): boolean {
  if (w.state.time < rtNum(p, key, -Infinity) - 1e-9) return false;
  setRtNum(p, key, w.state.time + seconds);
  return true;
}

/** Run counters (public, carried in the 원정 run): PlayerState.rewardState[key] (integers). */
export function stateNum(p: SimPlayer, key: string): number {
  return p.rewardState?.[key] ?? 0;
}

export function setStateNum(p: SimPlayer, key: string, v: number): void {
  (p.rewardState ??= {})[key] = Math.round(v);
}

// ─────────────────────────── Hits ───────────────────────────

/** Alive enemies around `at` (within range of their body), nearest first (ties: lower id), at most n. */
export function nearestEnemies(w: World, at: Vec2, n: number, range = Infinity): SimEntity[] {
  return aliveEnemiesOf(w, 'ally')
    .filter(t => t.eventTag !== 'ward' && dist(at, t.pos) - t.radius <= range)
    .map(t => ({ t, d: dist(at, t.pos) }))
    .sort((a, b) => a.d - b.d || a.t.id - b.t.id)
    .slice(0, Math.max(0, n))
    .map(x => x.t);
}

function castEvent(w: World, ctx: CastCtx, at: Vec2, area: AreaShape): void {
  emit(w, { type: 'skillCast', sourceId: null, player: ctx.player, slot: 'passive', skillId: ctx.skillId, name: ctx.name, center: copy(at), area, team: 'ally' });
}

/** A round blast at `at` (amount × ctx atk to every enemy touching it). Returns how many it hit. */
export function blast(w: World, ctx: CastCtx, at: Vec2, radius: number, amount: number, status?: { id: StatusId; duration: number; value: number }): number {
  castEvent(w, ctx, at, { shape: 'circle', radius });
  let n = 0;
  for (const t of aliveEnemiesOf(w, 'ally')) {
    if (dist(at, t.pos) > radius + t.radius) continue;
    if (amount > 0) hitDamage(w, ctx, t, amount);
    if (status && isAlive(t)) applyStatus(t, status.id, status.duration, status.value, ctx.player, ctx.source, { anchor: at, sourceEntityId: null });
    n++;
  }
  return n;
}

/**
 * A straight band from `from` toward `to`, `width` wide, at least `minLen` long (shorter paths are extended toward `to`;
 * from = to → toward +x). Returns how many it hit.
 */
export function lineHit(w: World, ctx: CastCtx, from: Vec2, to: Vec2, width: number, minLen: number, amount: number): number {
  const d = dist(from, to);
  const u = d > 1e-6 ? { x: (to.x - from.x) / d, y: (to.y - from.y) / d } : { x: 1, y: 0 };
  const len = Math.max(minLen, d);
  const center = { x: from.x + u.x * len, y: from.y + u.y * len };
  const area: AreaShape = { shape: 'line', length: len, width };
  emit(w, { type: 'skillCast', sourceId: null, player: ctx.player, slot: 'passive', skillId: ctx.skillId, name: ctx.name, center: copy(center), area, team: 'ally' });
  let n = 0;
  for (const t of aliveEnemiesOf(w, 'ally')) {
    if (!hitsArea(area, center, from, t.pos, t.radius, u)) continue;
    hitDamage(w, ctx, t, amount);
    n++;
  }
  return n;
}

/** A homing bolt from `from` to target (amount × ctx atk on arrival, like a basic projectile). */
export function fireBolt(w: World, ctx: CastCtx, from: Vec2, target: SimEntity, amount: number, color = '#ffd166'): void {
  const pr: SimProjectile = {
    id: newId(w),
    team: 'ally',
    pos: copy(from),
    targetId: target.id,
    targetPos: copy(target.pos),
    speed: 16,
    color,
    rt: { ctx, amount, splashRadius: 0, onHit: null, life: PROJECTILE_MAX_LIFE },
  };
  w.state.projectiles.push(pr);
}

/** Shield frac × e's max HP for dur s (받는 보호막 bonuses apply). */
export function rewardShield(w: World, e: SimEntity, frac: number, dur: number): void {
  addShield(e, frac * e.maxHp, dur, w);
}

/** A reward damage reduction on e (all guards together max −50 %, hooks.GUARD_CAP); ends when e leaves the field. */
export function guardAdd(w: World, e: SimEntity, frac: number, dur: number): void {
  const now = w.state.time;
  const list = (e.rt.guards ??= []).filter(g => g.until > now + 1e-9);
  list.push({ frac, until: now + dur });
  e.rt.guards = list;
}

/** Sum of e's running guards. */
export function guardOf(w: World, e: SimEntity): number {
  let g = 0;
  for (const x of e.rt.guards ?? []) if (x.until > w.state.time + 1e-9) g += x.frac;
  return g;
}

/**
 * HP cost of a curse card on a character (entity or bench card): frac × max HP (current: × current HP), ×2 when the
 * party has bench healing (메딕, 응급 후송), ×0.5 with the #저주 set. Never below 1 HP. Returns the HP taken.
 */
export function hpCost(w: World, p: SimPlayer, target: SimEntity | SimMember, frac: number, opts: { current?: boolean } = {}): number {
  if ('dead' in target && target.dead) return 0;
  let k = frac;
  if (benchHealer(p)) k *= 2;
  if (tagActive(p, 'curse')) k *= TAG_BONUS.curse.costMult;
  const base = opts.current ? target.hp : target.maxHp;
  const want = Math.max(0, base * k);
  const taken = Math.max(0, Math.min(want, target.hp - 1));
  if (!(taken > 0)) return 0;
  target.hp -= taken;
  if ('rt' in target && 'kind' in target) {
    emit(w, { type: 'damage', targetId: target.id, amount: taken, crit: false, pos: copy(target.pos), targetTeam: 'ally', absorbed: 0, source: 'relic' });
  }
  return taken;
}

/** The party heals its bench (메딕 in it, or 응급 후송 owned): curse HP costs double. */
function benchHealer(p: SimPlayer): boolean {
  if (p.party.some(m => !!getCharacter(m.defId).passive.benchRegen)) return true;
  return p.rewards.some(r => r.rewardId.startsWith('evac_'));
}

/** Fill the boss groggy gauge by frac directly (not while groggy / locked; at most REWARD_GROGGY_CAP per cycle). */
export function addRewardGroggy(w: World, frac: number, player: number | null): number {
  return rewardGroggy(w, frac, player, REWARD_GROGGY_CAP);
}

// ─────────────────────────── Zones ───────────────────────────

/**
 * A lingering circle at `at` re-applying `effects` every `tick` s (allies: every player's characters). At most
 * REWARD_ZONE_CAP per player (the oldest goes). Returns the zone (null when it could not be made).
 */
export function zoneAt(
  w: World,
  p: SimPlayer,
  ctx: CastCtx,
  radius: number,
  duration: number,
  tick: number,
  affects: SkillAction['affects'],
  effects: Effect[],
): SimZone | null {
  const before = w.state.zones.length;
  castSkill(w, { ...ctx, point: copy(ctx.point ?? ctx.origin) }, [{ center: 'point', area: { shape: 'circle', radius }, affects, effects, zone: { duration, tickInterval: tick } }]);
  if (w.state.zones.length <= before) return null;
  const z = w.state.zones[w.state.zones.length - 1];
  const mine = (p.rt.rewardZones ??= []).filter(id => w.state.zones.some(x => x.id === id));
  mine.push(z.id);
  while (mine.length > REWARD_ZONE_CAP) {
    const old = mine.shift()!;
    const i = w.state.zones.findIndex(x => x.id === old);
    if (i >= 0) w.state.zones.splice(i, 1);
  }
  p.rt.rewardZones = mine;
  return z;
}

// ─────────────────────────── Summons ───────────────────────────

/** Drop one reward unit into its cap group (the oldest of the group leaves when it is full). */
function capUnit(w: World, p: SimPlayer, e: SimEntity, group: RewardUnitGroup, extraCount = 0): void {
  const list = (p.rt.rewardUnits ??= []).filter(u => isAlive(getEntity(w, u.id)));
  list.push({ id: e.id, group });
  const cap = Math.max(0, UNIT_CAPS[group] - extraCount);
  let n = list.filter(u => u.group === group).length;
  while (n > Math.max(1, cap)) {
    const i = list.findIndex(u => u.group === group);
    const old = getEntity(w, list[i].id);
    list.splice(i, 1);
    n--;
    if (old) removeUnit(w, old);
  }
  p.rt.rewardUnits = list;
}

function removeUnit(w: World, e: SimEntity): void {
  e.rt.gone = true;
  emit(w, { type: 'death', entityId: e.id, pos: copy(e.pos), kind: e.kind, tier: e.tier });
}

export type ShooterKind = 'shade' | 'turret' | 'duet' | 'doppel';

/**
 * An untargetable reward shooter at `at` for `duration` s: every `interval` s it shoots the nearest enemy within
 * `range` for amount × atk ('relic' damage; atk default = p's field character's). Afterimages (shade / duet / doppel)
 * share a cap of 2, the turret 1.
 */
export function spawnShooter(
  w: World,
  p: SimPlayer,
  kind: ShooterKind,
  at: Vec2,
  o: { duration: number; interval: number; range: number; amount: number; atk?: number },
): SimEntity | null {
  const def = getMonster(`rw_${kind}`);
  const field = activeEntity(w, p);
  const atk = o.atk ?? (field ? effStats(w, field).atk : 0);
  const e = createUnit(w, def, clampToArena(w, at), 'ally', { kind: 'summon', ownerPlayer: p.id, expiresIn: Math.max(0.1, o.duration), hpMult: 1, atkMult: Math.max(0, o.amount * atk) });
  e.rt.base.atkSpeed = 1 / Math.max(0.1, o.interval);
  e.rt.base.range = Math.max(0, o.range);
  e.rt.attackCd = Math.min(e.rt.attackCd, o.interval);
  e.rt.untargetable = true;
  e.rt.rewardSource = true;
  emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: 'summon' });
  capUnit(w, p, e, kind === 'turret' ? 'turret' : 'afterimage');
  return e;
}

/**
 * A straw-doll decoy at `at`: hp HP for duration s, taunting enemies within tauntRadius (statuses for its life). Shares
 * the 종이 인형 cap: p's paper dolls + straw dolls ≤ 2 (only straw dolls are ever removed for it; when paper dolls alone
 * fill it, no straw doll comes → null).
 */
export function spawnDecoy(w: World, p: SimPlayer, at: Vec2, o: { hp: number; duration: number; tauntRadius: number }): SimEntity | null {
  const dolls = w.state.entities.filter(x => isAlive(x) && x.ownerPlayer === p.id && (x.defId === 'paper_doll' || x.defId === 'paper_doll_grand')).length;
  if (dolls >= UNIT_CAPS.decoy) return null;
  const def = getMonster('rw_straw');
  const e = createUnit(w, def, clampToArena(w, at), 'ally', { kind: 'summon', ownerPlayer: p.id, expiresIn: Math.max(0.1, o.duration), hpMult: Math.max(1, o.hp) / def.stats.maxHp, atkMult: 1 });
  e.rt.rewardSource = true;
  emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: 'summon' });
  for (const t of aliveEnemiesOf(w, 'ally')) {
    if (dist(e.pos, t.pos) <= o.tauntRadius + t.radius) applyStatus(t, 'taunt', o.duration, 0, p.id, 'relic', { sourceEntityId: e.id });
  }
  capUnit(w, p, e, 'decoy', dolls);
  return e;
}

/**
 * A mine at `at` for duration s (cap per call: the oldest of p's mines goes). An enemy stepping within radius sets it
 * off: amount × ctx atk around it + root s (fx.tickMines, core).
 */
export function placeMine(w: World, p: SimPlayer, at: Vec2, o: { duration: number; radius: number; amount: number; root: number; cap: number; ctx: CastCtx; family: string }): SimEntity {
  const def = getMonster('rw_mine');
  const e = createUnit(w, def, clampToArena(w, at), 'ally', { kind: 'summon', ownerPlayer: p.id, expiresIn: Math.max(0.1, o.duration), hpMult: 1, atkMult: 1 });
  e.rt.untargetable = true;
  e.rt.rewardSource = true;
  emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: 'summon' });
  const mines = (p.rt.mines ??= []).filter(m => isAlive(getEntity(w, m.id)));
  mines.push({ id: e.id, radius: o.radius, amount: o.amount, root: o.root, ctx: o.ctx, family: o.family });
  while (mines.length > Math.max(1, o.cap)) {
    const old = getEntity(w, mines.shift()!.id);
    if (old) removeUnit(w, old);
  }
  p.rt.mines = mines;
  return e;
}

/** Core tick: p's mines go off under enemies (BASE_HOOKS.tick). */
export function tickMines(w: World, p: SimPlayer): void {
  const list = p.rt.mines;
  if (!list?.length) return;
  const keep = [];
  for (const m of list) {
    const e = getEntity(w, m.id);
    if (!e) continue;
    const hit = aliveEnemiesOf(w, 'ally').some(t => t.eventTag !== 'ward' && dist(e.pos, t.pos) <= m.radius + t.radius);
    if (!hit) {
      keep.push(m);
      continue;
    }
    const at = copy(e.pos);
    removeUnit(w, e);
    blast(w, { ...m.ctx, point: at, origin: at }, at, m.radius, m.amount, m.root > 0 ? { id: 'root', duration: m.root, value: 0 } : undefined);
    proc(w, p, null, m.family, at);
  }
  p.rt.mines = keep;
}

// ─────────────────────────── Swap ───────────────────────────

/** Put p's card idx on the field at `at` now (no cooldown / lock check; 빈자리의 대타). False when it cannot come. */
export function forceSwap(w: World, p: SimPlayer, idx: number, at: Vec2): boolean {
  return forceSwapIn(w, p, idx, at);
}

/** Hostile status? (statusDuration hooks only change these.) */
export function isHostile(status: StatusId): boolean {
  return DEBUFFS.has(status);
}

/** Fixed damage that ignores every multiplier (stored bursts like 원한의 쪽지): credited to p as 'relic'. */
export function pureHit(w: World, p: SimPlayer, target: SimEntity, amount: number): number {
  return applyDamage(w, { casterId: null, team: 'ally', player: p.id, source: 'relic', isDrag: false, pure: true }, target, amount, false);
}
