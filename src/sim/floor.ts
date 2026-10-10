// Floors (R15–R21): plan, start, spawner, clear/timeout/enrage/retreat, reward phase.

import type { BossDef, CommandResult, FloorPlan, Tunables, Vec2, WavePlan } from '../types';
import { ARENA_BOSS, ARENA_NORMAL, BOSS_ENRAGED_EMPTY_FIELD_FAIL, BOSS_POS, floorStatMult, ZONES, zoneOf } from '../config';
import { FIELD_EVENT_LAST_WAVE_HOLD, MAX_REROLLS, getBoss, getMonster } from '../data';
import { BOT, FIRST_WAVE_Y_TOP, MID_RING, SPAWN_POINTS, SPAWN_RING, SPAWN_SCATTER, SPAWN_WARNING_TIME, WAVE_NEXT } from './constants';
import { heal } from './combat';
import { createCharacterEntity, createUnit } from './entities';
import { closeFieldEvent, notePrinted, startFloorFieldEvent } from './fieldEvents';
import { clearGroggy, resetGroggy } from './groggy';
import { autoResolveGoedam, chooseGoedam, expireGoedamTraces, goedamAllDone, openGoedamRoom } from './goedam';
import { refundUnlandedUlts, revive, syncMembers } from './players';
import { openRewardScreen, pickOffer, rerollReward as rerollOffers } from './rewards/offers';
import { botPickIndex } from './rewards/botPick';
import { rwOnFloorClear, rwOnFloorStart } from './rewards/hooks';
import { enterStageEnd, expeditionCombatClear, planExpeditionFloor } from './expedition';
import type { Rng } from './rng';
import {
  activeEntity,
  arena,
  clampToArena,
  compactEntities,
  copy,
  countEnemies,
  dist,
  emit,
  endRun,
  getEntity,
  isAlive,
  queuedEnemies,
  type PendingSpawn,
  type SimEntity,
  type World,
} from './world';

// ─────────────────────────── Plan ───────────────────────────

export function planFloor(floor: number, rng: Rng, tunables: Tunables): FloorPlan {
  const f = Math.max(1, Math.floor(floor));
  const statMult = floorStatMult(f, tunables.floorStatGrowth);
  // 기획 8차: 4 zones (1–5 로비·상가, 6–10 사무실, 11–15 폐병동, 16–20 옥상·이계) — pools, mid bosses, boss, background.
  const zone = zoneOf(f);
  const theme = zone.theme;
  if (f % 5 === 0) {
    // boss of the zone that ends here; past the last zone (debug maxFloor > 20) the bosses cycle
    const bossId = f <= ZONES[ZONES.length - 1].to ? zone.boss : ZONES[(f / 5 - 1) % ZONES.length].boss;
    return { floor: f, kind: 'boss', timeLimit: tunables.bossFloorTime, arena: { ...ARENA_BOSS }, statMult, waves: [], bossId, theme };
  }
  // 기획 16차 템포: waves per floor by zone (5 · 5 · 6 · 6); `at` is the nominal max-gap schedule (only wave 0 waits for it).
  const waveCount = Math.max(1, zone.waves);
  const pool = zone.pool.filter(e => (e.from ?? zone.from) <= f);
  const size = zone.waveSize;
  const waves: WavePlan[] = [];
  for (let i = 0; i < waveCount; i++) {
    const n = rng.int(size.min, size.max);
    const counts = new Map<string, number>();
    for (let k = 0; k < n; k++) {
      const id = rng.weighted(pool, e => e.weight).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    waves.push({ at: 1 + i * tunables.waveInterval, spawns: [...counts].map(([monsterId, count]) => ({ monsterId, count })) });
  }
  // the zone's mid bosses in order over its normal floors (floor 1 거대 마네킹, 2 검은 조문객, …)
  const normalIndex = Math.max(0, f - zone.from - Math.floor((f - zone.from) / 5));
  const midBossId = zone.mids[normalIndex % zone.mids.length];
  return { floor: f, kind: 'normal', timeLimit: tunables.normalFloorTime, arena: { ...ARENA_NORMAL }, statMult, waves, midBossId, theme };
}

// ─────────────────────────── Start ───────────────────────────

export function startPos(w: World, pi: number): Vec2 {
  const a = arena(w);
  if (w.state.plan.kind === 'boss') return { x: a.width / 2 + (pi - 1) * 3, y: a.height * 0.7 };
  const offs = [
    { x: -1.6, y: 0.9 },
    { x: 0, y: -0.9 },
    { x: 1.6, y: 0.9 },
  ];
  const o = offs[pi % offs.length];
  return { x: a.width / 2 + o.x, y: a.height / 2 + o.y };
}

function makeSpawnPoints(w: World): Vec2[] {
  const a = arena(w);
  const inset = 0.8;
  const W = a.width - 2 * inset;
  const H = a.height - 2 * inset;
  const per = 2 * (W + H);
  const n = w.rng.int(SPAWN_POINTS.min, SPAWN_POINTS.max);
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const u = ((i + w.rng.range(0.15, 0.85)) / n) * per;
    let p: Vec2;
    if (u < W) p = { x: inset + u, y: inset };
    else if (u < W + H) p = { x: inset + W, y: inset + (u - W) };
    else if (u < 2 * W + H) p = { x: inset + W - (u - W - H), y: inset + H };
    else p = { x: inset, y: inset + H - (u - 2 * W - H) };
    pts.push(p);
  }
  return pts;
}

/**
 * Start floor n. Characters on field stay (state carries over) and move to start positions
 * without a drag skill; everything else is cleared.
 */
export function startFloor(w: World, n: number, reappear: boolean): void {
  const s = w.state;
  // 기획 12차: a leftover 돌발 괴담 (debug jump) fails quietly, logged under the floor it was on
  closeFieldEvent(w);
  for (const e of s.entities) if (e.kind !== 'character') e.rt.gone = true;
  compactEntities(w);
  s.telegraphs.length = 0;
  s.zones.length = 0;
  s.projectiles.length = 0;
  w.pending = [];
  s.floor = Math.max(1, Math.floor(n));
  s.plan = w.expedition ? planExpeditionFloor(w.expedition.stage, w.rng, w.tunables) : planFloor(s.floor, w.rng, w.tunables); // 기획 16차 원정: one floor
  s.floorTime = 0;
  s.timeRemaining = s.plan.timeLimit;
  s.bossId = null;
  s.bossEnraged = false;
  s.midBossSpawned = false;
  s.wavesRemaining = s.plan.waves.length;
  clearRewardOffers(w);
  s.goedam = null;
  w.bossRetreat = false;
  w.enragedEmptyTime = 0;
  s.phase = 'combat';
  w.spawner = { points: s.plan.kind === 'normal' ? makeSpawnPoints(w) : [], nextWave: 0, pending: [], kills: 0, midTriggered: false, deferred: [] };
  // 기획 16차 템포: the wave target rotation starts at a seeded slot (0..5 ≡ uniform for 1, 2 or 3 players on the field)
  w.spawner.lastWarnAt = -Infinity;
  w.spawner.fieldEventSeenAt = -Infinity;
  w.spawner.targetOffset = s.plan.kind === 'normal' ? w.rng.int(0, 5) : 0;
  // 기획 12차: this floor's 돌발 괴담 is planned on its own stream
  startFloorFieldEvent(w);

  for (const p of s.players) {
    if (p.rt.rejoinNextFloor) {
      p.rt.rejoinNextFloor = false;
      if (!p.out && p.activeIndex == null && !p.party[0].dead) {
        // like the run start: slot 0 fights, its cooldown starts only when it is swapped out (R4, 기획 6차)
        createCharacterEntity(w, p, 0, startPos(w, p.id));
        p.activeIndex = 0;
      }
    }
    const e = activeEntity(w, p);
    if (!e) continue;
    e.pos = startPos(w, p.id);
    e.targetId = null;
    e.targetHeldFor = 0;
    e.facing = 0;
    e.rt.lockTime = 0;
    e.anim = 'idle';
    e.animTime = 0;
    if (reappear) {
      // R4/R19: same 0.5 s appear window as a swap (no swap, invulnerable) but no drag skill and no new cooldown.
      e.anim = 'appear';
      e.animTime = w.tunables.appearLockTime;
      e.rt.lockTime = w.tunables.appearLockTime;
      e.invulnTime = Math.max(e.invulnTime, w.tunables.appearInvulnTime);
      p.appearLock = Math.max(p.appearLock, w.tunables.appearLockTime);
    }
  }

  if (s.plan.kind === 'boss' && s.plan.bossId) {
    const def = getBoss(s.plan.bossId);
    const hpMult = s.plan.statMult * w.tunables.monsterHpMult;
    const e = createUnit(w, def, BOSS_POS, 'enemy', {
      kind: 'monster',
      ownerPlayer: null,
      expiresIn: null,
      hpMult: s.plan.bossHpMult ? hpMult * s.plan.bossHpMult : hpMult, // 기획 15차 원정 보스 HP × EXPEDITION.bossHp (기획 16차 밸런스: 0.8)
      atkMult: s.plan.statMult,
    });
    s.bossId = e.id;
    emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: 'boss' });
  }
  resetGroggy(w); // 기획 13차: a fresh gauge on a gauge boss's floor, none elsewhere
  s.monstersAlive = countEnemies(w);
  emit(w, { type: 'floorStart', floor: s.floor, kind: s.plan.kind });
  rwOnFloorStart(w); // 기획 17차 floor rewards (자라는 손톱, #성장, per-floor counters)
}

// ─────────────────────────── Spawner ───────────────────────────

function spawnPending(w: World, ps: PendingSpawn): void {
  const s = w.state;
  const def = getMonster(ps.monsterId);
  // 기획 15차 원정 수문장: the floor-3 mid boss is the enhanced guardian
  const g = ps.mid ? s.plan.guardian : undefined;
  const e = createUnit(w, def, ps.pos, 'enemy', {
    kind: 'monster',
    ownerPlayer: null,
    expiresIn: null,
    hpMult: g ? s.plan.statMult * w.tunables.monsterHpMult * g.hpMult : s.plan.statMult * w.tunables.monsterHpMult,
    atkMult: g ? s.plan.statMult * g.atkMult : s.plan.statMult,
  });
  if (ps.mid) s.midBossSpawned = true;
  if (ps.printed) notePrinted(w, e);
  emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: def.tier === 'mid' ? 'mid' : 'normal' });
}

// ── 기획 16차 템포 (docs/tempo.md 2): waves near the party, inside the screen; the next wave once the field is almost clear ──

/** Living ally field characters, in player order (at most one per player). */
function fieldCharacters(w: World): SimEntity[] {
  const out: SimEntity[] = [];
  for (const p of w.state.players) {
    const e = activeEntity(w, p);
    if (isAlive(e)) out.push(e);
  }
  return out;
}

/**
 * Clamp into the spawn box: x ∈ [xMargin, W − xMargin], y ∈ [top, H − yBottom] (never under the HUD, never off
 * screen; `top` is FIRST_WAVE_Y_TOP for wave 0, below the floor-start banner).
 */
function inSpawnBox(w: World, p: Vec2, top: number = SPAWN_RING.yTop): Vec2 {
  const a = arena(w);
  const r = SPAWN_RING;
  return { x: Math.min(a.width - r.xMargin, Math.max(r.xMargin, p.x)), y: Math.min(a.height - r.yBottom, Math.max(top, p.y)) };
}

function minDistTo(p: Vec2, chars: SimEntity[]): number {
  let d = Infinity;
  for (const c of chars) d = Math.min(d, dist(p, c.pos));
  return d;
}

/** Up to SPAWN_RING.tries seeded samples on the ring around `anchor`; the first ≥ ring.clear from every character wins, else the farthest. */
function ringPoint(w: World, anchor: Vec2, ring: { min: number; max: number; clear: number }, chars: SimEntity[], top?: number): Vec2 {
  let best: Vec2 | null = null;
  let bestD = -Infinity;
  for (let i = 0; i < SPAWN_RING.tries; i++) {
    const ang = w.rng.range(0, Math.PI * 2);
    const r = w.rng.range(ring.min, ring.max);
    const p = inSpawnBox(w, { x: anchor.x + Math.cos(ang) * r, y: anchor.y + Math.sin(ang) * r }, top);
    const d = minDistTo(p, chars);
    if (d >= ring.clear) return p;
    if (d > bestD) {
      best = p;
      bestD = d;
    }
  }
  return best!;
}

function arenaCentre(w: World): Vec2 {
  const a = arena(w);
  return { x: a.width / 2, y: a.height / 2 };
}

/**
 * A wave group's spawn point: on the SPAWN_RING around the wave's target — the players with a field character take
 * turns (from the floor's seeded offset), so with 3 players spread out every one of them gets fights. Empty field →
 * around the arena centre.
 */
export function wavePoint(w: World, waveIdx: number): Vec2 {
  const chars = fieldCharacters(w);
  const target = chars.length > 0 ? chars[((w.spawner.targetOffset ?? 0) + waveIdx) % chars.length] : null;
  return ringPoint(w, target ? target.pos : arenaCentre(w), SPAWN_RING, chars, spawnTop(waveIdx));
}

/** The spawn box top for a wave: wave 0 stays below the floor-start banner (FIRST_WAVE_Y_TOP). */
function spawnTop(waveIdx: number): number {
  return waveIdx === 0 ? FIRST_WAVE_Y_TOP : SPAWN_RING.yTop;
}

/**
 * The mid boss / 수문장 spawn point: on the MID_RING around the centroid of the ally field characters (a crowded party
 * whose ring has no clear sample: pushed out to MID_RING.clear from the nearest one, as keepClear does for members).
 */
export function midPoint(w: World): Vec2 {
  const chars = fieldCharacters(w);
  if (chars.length === 0) return ringPoint(w, arenaCentre(w), MID_RING, chars);
  const c = { x: 0, y: 0 };
  for (const e of chars) {
    c.x += e.pos.x / chars.length;
    c.y += e.pos.y / chars.length;
  }
  return keepClear(w, ringPoint(w, c, MID_RING, chars), chars, undefined, MID_RING.clear);
}

function scatter(w: World, p: Vec2, top?: number): Vec2 {
  return inSpawnBox(w, { x: p.x + w.rng.range(-SPAWN_SCATTER, SPAWN_SCATTER), y: p.y + w.rng.range(-SPAWN_SCATTER, SPAWN_SCATTER) }, top);
}

/** Unit directions tried when a member must be pushed off a character: straight away first, then 8 around. */
const PUSH_DIRS: readonly Vec2[] = Array.from({ length: 8 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 4), y: Math.sin((k * Math.PI) / 4) }));

/**
 * A scattered member closer than `min` (SPAWN_RING.memberClear) to an ally field character (the box clamp or a crowded
 * party can undo the group point's clearance) is moved to `min` from the nearest one — straight away from it,
 * else the first of 8 directions that clears everyone inside the box, else the farthest of them. No rng.
 */
function keepClear(w: World, p: Vec2, chars: SimEntity[], top?: number, min: number = SPAWN_RING.memberClear): Vec2 {
  let near: SimEntity | null = null;
  let nd = Infinity;
  for (const c of chars) {
    const d = dist(p, c.pos);
    if (d < nd) {
      nd = d;
      near = c;
    }
  }
  if (!near || nd >= min - 1e-9) return p;
  const away = nd > 1e-6 ? { x: (p.x - near.pos.x) / nd, y: (p.y - near.pos.y) / nd } : PUSH_DIRS[0];
  let best = p;
  let bestD = nd;
  for (const u of [away, ...PUSH_DIRS]) {
    const q = inSpawnBox(w, { x: near.pos.x + u.x * min, y: near.pos.y + u.y * min }, top);
    const d = minDistTo(q, chars);
    if (d >= min - 1e-9) return q;
    if (d > bestD) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

/**
 * Enemies that hold the next wave back: every enemy 1, a mid boss WAVE_NEXT.midWeight; queued spawns (markers,
 * deferred splits) too. 돌발 괴담 units and the boss count 0 (as in countEnemies).
 */
export function weightedAlive(w: World): number {
  let n = 0;
  for (const e of w.state.entities) {
    if (e.team === 'enemy' && isAlive(e) && e.tier !== 'boss' && !e.eventTag) n += e.tier === 'mid' ? WAVE_NEXT.midWeight : 1;
  }
  for (const ps of w.spawner.pending) n += ps.mid ? WAVE_NEXT.midWeight : 1;
  return n + w.spawner.deferred.length;
}

/** Remember the last floor second a 돌발 괴담 was planned or open (the last wave waits for it). */
function noteFieldEvent(w: World): void {
  if (w.state.fieldEvent || w.fieldEvents.plan) w.spawner.fieldEventSeenAt = w.state.floorTime;
}

/** The last wave is held while a 돌발 괴담 is planned / open and FIELD_EVENT_LAST_WAVE_HOLD s after — a floor never clears under one. */
function lastWaveHeld(w: World): boolean {
  return w.state.floorTime - (w.spawner.fieldEventSeenAt ?? -Infinity) < FIELD_EVENT_LAST_WAVE_HOLD - 1e-9;
}

/** Wave 0 at its `at`; later waves once the field is almost clear (≥ minGap after the last warning) or after the max gap. */
export function nextWaveDue(w: World): boolean {
  const s = w.state;
  const sp = w.spawner;
  const n = s.plan.waves.length;
  const i = sp.nextWave;
  if (i >= n) return false;
  if (i === n - 1 && lastWaveHeld(w)) return false;
  if (i === 0) return s.floorTime >= s.plan.waves[0].at - SPAWN_WARNING_TIME - 1e-9;
  const since = s.floorTime - (sp.lastWarnAt ?? -Infinity);
  const maxGap = s.plan.maxGap ?? w.tunables.waveInterval;
  return (weightedAlive(w) <= WAVE_NEXT.alive && since >= WAVE_NEXT.minGap - 1e-9) || since >= maxGap - 1e-9;
}

/** R15 alive cap: a wave that would push the field over maxAliveMonsters waits (never dropped). */
function waveFits(w: World): boolean {
  const wave = w.state.plan.waves[w.spawner.nextWave];
  const size = wave.spawns.reduce((a, g) => a + g.count, 0);
  const alive = countEnemies(w) + queuedEnemies(w);
  return alive === 0 || alive + size <= w.tunables.maxAliveMonsters;
}

function warnWave(w: World): void {
  const sp = w.spawner;
  const wave = w.state.plan.waves[sp.nextWave];
  const chars = fieldCharacters(w);
  const top = spawnTop(sp.nextWave);
  for (const g of wave.spawns) {
    const pt = wavePoint(w, sp.nextWave);
    for (let k = 0; k < g.count; k++) {
      const pos = keepClear(w, scatter(w, pt, top), chars, top);
      sp.pending.push({ remaining: SPAWN_WARNING_TIME, monsterId: g.monsterId, pos, mid: false, wave: sp.nextWave });
      emit(w, { type: 'spawnWarning', pos: copy(pos), delay: SPAWN_WARNING_TIME });
    }
  }
  sp.lastWarnAt = w.state.floorTime;
  sp.nextWave++;
}

/** The mid boss (수문장 too) comes with the wave midBossFromEnd from the end, or at midBossTimeTrigger s at the latest. */
function midDue(w: World): boolean {
  const s = w.state;
  const withWave = Math.max(0, s.plan.waves.length - w.tunables.midBossFromEnd);
  return w.spawner.nextWave > withWave || s.floorTime >= w.tunables.midBossTimeTrigger;
}

/** onDeath splits that waited for room (ondeath.ts) come out behind a short marker, oldest first, as room frees up. */
function releaseDeferred(w: World): void {
  const sp = w.spawner;
  while (sp.deferred.length > 0 && countEnemies(w) + sp.pending.length < w.tunables.maxAliveMonsters) {
    const d = sp.deferred.shift()!;
    sp.pending.push({ remaining: SPAWN_WARNING_TIME, monsterId: d.monsterId, pos: d.pos, mid: false, wave: -1 });
    emit(w, { type: 'spawnWarning', pos: copy(d.pos), delay: SPAWN_WARNING_TIME });
  }
}

export function tickSpawner(w: World, dt: number): void {
  const s = w.state;
  const plan = s.plan;
  const sp = w.spawner;
  for (let i = 0; i < sp.pending.length; ) {
    const ps = sp.pending[i];
    ps.remaining -= dt;
    if (ps.remaining <= 1e-9) {
      sp.pending.splice(i, 1);
      spawnPending(w, ps);
    } else i++;
  }
  releaseDeferred(w);
  if (plan.kind !== 'normal') return;
  noteFieldEvent(w);
  // 기획 16차 템포: at most one wave per tick; postponed (never dropped) by the alive cap.
  if (nextWaveDue(w) && waveFits(w)) warnWave(w);
  // The mid boss obeys the same alive cap as waves (9-1 동시 최대 maxAliveMonsters): postponed, never dropped.
  const aliveNow = countEnemies(w) + queuedEnemies(w);
  const midRoom = aliveNow === 0 || aliveNow + 1 <= w.tunables.maxAliveMonsters;
  if (plan.midBossId && !sp.midTriggered && midDue(w) && midRoom) {
    sp.midTriggered = true;
    const pos = midPoint(w);
    sp.pending.push({ remaining: SPAWN_WARNING_TIME, monsterId: plan.midBossId, pos, mid: true, wave: -1 });
    emit(w, { type: 'spawnWarning', pos: copy(pos), delay: SPAWN_WARNING_TIME });
  }
  const pendingWaves = new Set<number>();
  for (const ps of sp.pending) if (!ps.mid && ps.wave >= 0) pendingWaves.add(ps.wave);
  s.wavesRemaining = plan.waves.length - sp.nextWave + pendingWaves.size;
}

// ─────────────────────────── Clear / fail / enrage ───────────────────────────

function allOut(w: World): boolean {
  const ps = w.state.players;
  return ps.length > 0 && ps.every(p => p.out);
}

export function tickFloorState(w: World, dt = 0): void {
  const s = w.state;
  if (s.phase !== 'combat') return;
  s.monstersAlive = countEnemies(w);
  s.timeRemaining = Math.max(0, s.plan.timeLimit - s.floorTime);
  if (w.bossRetreat) {
    bossRetreat(w);
    return;
  }
  if (allOut(w)) {
    endRun(w, 'defeat', 'wipe');
    return;
  }
  if (s.plan.kind === 'normal') {
    const sp = w.spawner;
    const allSpawned =
      sp.nextWave >= s.plan.waves.length && sp.pending.length === 0 && sp.deferred.length === 0 && (!s.plan.midBossId || s.midBossSpawned);
    if (allSpawned && s.monstersAlive === 0) {
      floorClear(w);
      return;
    }
    if (s.floorTime >= s.plan.timeLimit - 1e-9) endRun(w, 'defeat', 'timeout');
  } else {
    if (s.floorTime >= s.plan.timeLimit - 1e-9 && !s.bossEnraged) enrage(w);
    // (가정) Boss timeout never fails by itself, but once enraged a fight nobody is in can't go on forever:
    // no ally character on the field for BOSS_ENRAGED_EMPTY_FIELD_FAIL s → defeat (AFK / soft-lock guard).
    if (s.bossEnraged) {
      const anyone = s.entities.some(e => e.kind === 'character' && isAlive(e));
      w.enragedEmptyTime = anyone ? 0 : w.enragedEmptyTime + dt;
      if (w.enragedEmptyTime >= BOSS_ENRAGED_EMPTY_FIELD_FAIL - 1e-9) endRun(w, 'defeat', 'timeout');
    }
  }
}

export function enrage(w: World): void {
  const s = w.state;
  if (s.bossEnraged) return;
  const boss = getEntity(w, s.bossId);
  if (!boss) return;
  s.bossEnraged = true;
  boss.enraged = true;
  const en = (boss.rt.monDef as BossDef).enrage;
  boss.rt.skillCds = boss.rt.skillCds.map(c => c * en.cooldownMult);
  emit(w, { type: 'enrage' });
}

function bossRetreat(w: World): void {
  w.bossRetreat = false;
  emit(w, { type: 'bossRetreat' });
  for (const e of w.state.entities) if (e.team === 'enemy') e.rt.gone = true;
  compactEntities(w);
  floorClear(w);
}

export function floorClear(w: World): void {
  const s = w.state;
  if (s.phase !== 'combat') return;
  emit(w, { type: 'floorClear', floor: s.floor });
  w.floorTimes.push({ floor: s.floor, seconds: s.floorTime, outcome: 'clear' });
  s.telegraphs.length = 0;
  s.projectiles.length = 0;
  refundUnlandedUlts(w); // 기획 13차: an ult still in its cut-in is given back
  w.pending = [];
  w.bossRetreat = false;
  w.spawner.pending = [];
  w.spawner.deferred = [];
  const zones = s.zones.filter(z => z.team !== 'enemy');
  s.zones.length = 0;
  s.zones.push(...zones);
  for (const e of s.entities) if (e.team === 'enemy') e.rt.gone = true;
  clearGroggy(w); // 기획 13차 (also a retreat during groggy)
  // 기획 12차: an unfinished 돌발 괴담 fails quietly; its units (also the ally-side patient / child) go
  closeFieldEvent(w);
  compactEntities(w);
  s.monstersAlive = 0;
  s.wavesRemaining = 0;

  // 기획 10차: timed 괴담 traces run out before the heal, so it reaches the max HP they gave back.
  expireGoedamTraces(w);

  // 기획 17차 다시 뽑기: every boss clear gives each player one more (max 5; 원정 boss stages too, carried)
  if (s.plan.kind === 'boss') for (const p of s.players) p.rerolls = Math.min(MAX_REROLLS, p.rerolls + 1);

  // R19: alive members (field + bench) heal floorHealFrac × maxHp; dead keep their revive timer.
  const frac = w.tunables.floorHealFrac;
  for (const p of s.players) {
    if (p.out) continue;
    if (rwOnFloorClear(w, p).noHeal) continue; // 기획 17차 (피 묻은 계약서)
    for (const m of p.party) {
      if (m.dead) continue;
      const e = getEntity(w, m.entityId);
      if (e) heal(w, null, e, frac * e.maxHp);
      else m.hp = Math.min(m.maxHp, m.hp + frac * m.maxHp);
    }
  }
  syncMembers(w);

  if (w.expedition && expeditionCombatClear(w)) return; // 기획 16차 원정: won — boss stage → 'stageClear', normal → reward
  if (!w.expedition && s.floor >= w.tunables.maxFloor) {
    endRun(w, 'victory', 'cleared');
    return;
  }
  // Boss retreated in the same tick the last player went out: the floor counts as cleared, then the run is over.
  if (allOut(w)) {
    endRun(w, 'defeat', 'wipe');
    return;
  }

  // 기획 5차: a player whose whole party was dead (out, spectating) comes back when someone else clears the floor:
  // every character revives (same HP as a normal revive), cooldowns reset, and party slot 0 starts the next floor.
  for (const p of s.players) {
    if (!p.out) continue;
    p.out = false;
    p.activeIndex = null;
    p.appearLock = 0;
    p.party.forEach((m, idx) => {
      m.swapCooldownRemaining = 0;
      m.normalCooldownRemaining = 0;
      if (m.dead) revive(w, p, idx);
    });
    p.rt.rejoinNextFloor = true;
  }
  syncMembers(w);

  // R20/R33: reward phase (time frozen). Out players get nothing; every human gets their own screen and the next floor
  // starts once all of them chose. 기획 17차: bots pick by score (botPickIndex) right away; a skipped screen (빚) is none.
  s.phase = 'reward';
  const relicFloor = s.plan.kind === 'boss';
  s.rewardOffersByPlayer = s.players.map(() => null);
  for (const p of s.players) {
    if (p.out) continue;
    const offers = openRewardScreen(w, p, relicFloor);
    if (!offers) continue;
    s.rewardOffersByPlayer[p.id] = offers;
    if (p.isBot) botPickAll(w, p.id);
  }
  syncRewardCompat(w);
  finishRewardIfDone(w);
}

/** 기획 17차: a bot (or a seat handed to its bot) takes its picks by score, default members. */
function botPickAll(w: World, pi: number): void {
  const s = w.state;
  const p = s.players[pi];
  for (let guard = 0; guard < 8; guard++) {
    const offers = s.rewardOffersByPlayer[pi];
    const i = botPickIndex(p, offers);
    if (!offers || i < 0) return;
    pickOffer(w, p, i);
  }
}

/** No pending offers for anyone (floor start, run end). */
export function clearRewardOffers(w: World): void {
  const s = w.state;
  for (const p of s.players) {
    delete p.rewardPicksLeft; // 기획 17차
    p.rt.offerScreen = undefined;
  }
  s.rewardOffersByPlayer = s.players.map(() => null);
  s.rewardOffers = null;
  w.humanOffers = null;
}

/** state.rewardOffers / world.humanOffers mirror player 0's entry (compatibility with the single-human API). */
function syncRewardCompat(w: World): void {
  const s = w.state;
  const mine = s.rewardOffersByPlayer[0] ?? null;
  s.rewardOffers = mine;
  w.humanOffers = mine ? { player: 0, offers: mine } : null;
}

/** Reward phase over once nobody has a pending choice → the floor's 괴담 room (기획 10차), if any → next floor. */
function finishRewardIfDone(w: World): void {
  const s = w.state;
  if (s.phase !== 'reward') return;
  if (s.rewardOffersByPlayer.some(o => o != null)) return;
  if (openGoedamRoom(w)) return;
  if (w.expedition) return enterStageEnd(w); // 기획 16차 원정: one floor per stage → back to the 원정 lobby
  startFloor(w, s.floor + 1, true);
}

/** 기획 10차: the room is over once every player pressed 계속 (bots and auto-leaves are done at once) → next floor. */
function finishGoedamIfDone(w: World): void {
  const s = w.state;
  if (s.phase !== 'goedam' || !goedamAllDone(s)) return;
  if (w.expedition) return enterStageEnd(w); // 기획 16차 원정: the stage ends after its room
  startFloor(w, s.floor + 1, true);
}

/** Command 'goedam' (기획 10차): pick an option by id, or 'continue'. */
export function goedamCommand(w: World, pi: number, option: string): CommandResult {
  const r = chooseGoedam(w, pi, option);
  if (r.ok) finishGoedamIfDone(w);
  return r;
}

/** Command 'chooseReward': card offerIndex (member: 기획 17차 지명권); with picks left (욕심쟁이) the screen stays. */
export function chooseReward(w: World, pi: number, offerIndex: number, member?: number): CommandResult {
  const s = w.state;
  if (s.phase !== 'reward') return { ok: false, reason: '보상 단계가 아님' };
  if (!Number.isInteger(pi) || pi < 0 || pi >= s.players.length) return { ok: false, reason: '잘못된 대상' };
  const r = pickOffer(w, s.players[pi], offerIndex, member);
  if (!r.ok) return r;
  syncRewardCompat(w);
  finishRewardIfDone(w);
  return r;
}

/** Command 'rerollReward' (기획 17차 다시 뽑기): new cards for pi's screen, one reroll spent. */
export function rerollRewardCommand(w: World, pi: number): CommandResult {
  if (!Number.isInteger(pi) || pi < 0 || pi >= w.state.players.length) return { ok: false, reason: '잘못된 대상' };
  const r = rerollOffers(w, pi);
  if (r.ok) syncRewardCompat(w);
  return r;
}

/**
 * R34: hand a player slot to the bot (multiplayer disconnect / leave) or back to its human.
 * A slot that becomes a bot during the reward phase picks its pending reward at random right away; in a 괴담 room it leaves.
 */
export function setPlayerBot(w: World, pi: number, isBot: boolean): void {
  const s = w.state;
  const p = Number.isInteger(pi) ? s.players[pi] : undefined;
  if (!p) return;
  const was = p.isBot;
  p.isBot = isBot;
  p.disconnected = isBot;
  if (isBot && !was) {
    // fresh bot brain: react from now on (timers are absolute sim time)
    const b = p.rt.bot;
    b.thinkIn = Math.min(b.thinkIn, BOT.thinkInterval);
    b.reactAt = null;
    b.ultAt = null;
    b.nextSwapAt = s.time + BOT.periodicSwap[0];
  }
  if (isBot && s.phase === 'goedam') {
    // 기획 10차: a slot that drops in a 괴담 room leaves it ('지나간다', then 계속) — the room never waits on it
    autoResolveGoedam(w, pi);
    finishGoedamIfDone(w);
  }
  if (isBot && s.phase === 'reward') {
    const offers = s.rewardOffersByPlayer[pi];
    if (offers && offers.length > 0) {
      botPickAll(w, pi); // 기획 17차: by score, not at random
      syncRewardCompat(w);
      finishRewardIfDone(w);
    }
  }
}
