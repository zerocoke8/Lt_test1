// Floors (R15–R21): plan, start, spawner, clear/timeout/enrage/retreat, reward phase.

import type { BossDef, CommandResult, FloorPlan, Tunables, Vec2, WavePlan } from '../types';
import { ARENA_BOSS, ARENA_NORMAL, BOSS_ENRAGED_EMPTY_FIELD_FAIL, BOSS_POS, MONSTER_UNLOCK_FLOOR } from '../config';
import { BOSSES, getBoss, getMonster, MID_BOSS_IDS, NORMAL_MONSTER_IDS } from '../data';
import { SPAWN_POINTS, SPAWN_SCATTER, SPAWN_WARNING_TIME, WAVE_SIZE, WAVES } from './constants';
import { heal } from './combat';
import { createUnit } from './entities';
import { syncMembers } from './players';
import { applyOffer, rollOffers } from './rewards';
import type { Rng } from './rng';
import {
  activeEntity,
  arena,
  clampToArena,
  compactEntities,
  copy,
  countEnemies,
  emit,
  endRun,
  getEntity,
  isAlive,
  type PendingSpawn,
  type World,
} from './world';

// ─────────────────────────── Plan ───────────────────────────

export function planFloor(floor: number, rng: Rng, tunables: Tunables): FloorPlan {
  const f = Math.max(1, Math.floor(floor));
  const statMult = 1 + tunables.floorStatGrowth * (f - 1);
  if (f % 5 === 0) {
    const boss = BOSSES[(f / 5 - 1) % BOSSES.length];
    return { floor: f, kind: 'boss', timeLimit: tunables.bossFloorTime, arena: { ...ARENA_BOSS }, statMult, waves: [], bossId: boss.id };
  }
  /** 1-based index among normal floors (floor 6 is the 5th normal floor) — only used to alternate mid bosses. */
  const normalIndex = f - Math.floor(f / 5);
  // 기획서 9-1 (가정): 1층 first웨이브, 층마다 +perFloor (counted by floor number), capped so every wave fits the time limit.
  const waveCount = Math.max(1, Math.min(WAVES.max, WAVES.first + (f - 1) * WAVES.perFloor));
  const pool = NORMAL_MONSTER_IDS.filter(id => (MONSTER_UNLOCK_FLOOR[id] ?? 1) <= f);
  const waves: WavePlan[] = [];
  for (let i = 0; i < waveCount; i++) {
    const n = rng.int(WAVE_SIZE.min, WAVE_SIZE.max);
    const counts = new Map<string, number>();
    for (let k = 0; k < n; k++) {
      const id = rng.pick(pool);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    waves.push({ at: 1 + i * tunables.waveInterval, spawns: [...counts].map(([monsterId, count]) => ({ monsterId, count })) });
  }
  const midBossId = MID_BOSS_IDS[(normalIndex - 1) % MID_BOSS_IDS.length];
  return { floor: f, kind: 'normal', timeLimit: tunables.normalFloorTime, arena: { ...ARENA_NORMAL }, statMult, waves, midBossId };
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
  for (const e of s.entities) if (e.kind !== 'character') e.rt.gone = true;
  compactEntities(w);
  s.telegraphs.length = 0;
  s.zones.length = 0;
  s.projectiles.length = 0;
  w.pending = [];
  s.floor = Math.max(1, Math.floor(n));
  s.plan = planFloor(s.floor, w.rng, w.tunables);
  s.floorTime = 0;
  s.timeRemaining = s.plan.timeLimit;
  s.bossId = null;
  s.bossEnraged = false;
  s.midBossSpawned = false;
  s.wavesRemaining = s.plan.waves.length;
  s.rewardOffers = null;
  w.humanOffers = null;
  w.bossRetreat = false;
  w.enragedEmptyTime = 0;
  s.phase = 'combat';
  w.spawner = { points: s.plan.kind === 'normal' ? makeSpawnPoints(w) : [], nextWave: 0, pending: [], kills: 0, midTriggered: false };

  for (const p of s.players) {
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
    const e = createUnit(w, def, BOSS_POS, 'enemy', {
      kind: 'monster',
      ownerPlayer: null,
      expiresIn: null,
      hpMult: s.plan.statMult * w.tunables.monsterHpMult,
      atkMult: s.plan.statMult,
    });
    s.bossId = e.id;
    emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: 'boss' });
  }
  s.monstersAlive = countEnemies(w);
  emit(w, { type: 'floorStart', floor: s.floor, kind: s.plan.kind });
}

// ─────────────────────────── Spawner ───────────────────────────

function spawnPending(w: World, ps: PendingSpawn): void {
  const s = w.state;
  const def = getMonster(ps.monsterId);
  const e = createUnit(w, def, ps.pos, 'enemy', {
    kind: 'monster',
    ownerPlayer: null,
    expiresIn: null,
    hpMult: s.plan.statMult * w.tunables.monsterHpMult,
    atkMult: s.plan.statMult,
  });
  if (ps.mid) s.midBossSpawned = true;
  emit(w, { type: 'spawn', entityId: e.id, pos: copy(e.pos), tier: def.tier === 'mid' ? 'mid' : 'normal' });
}

function scatter(w: World, p: Vec2): Vec2 {
  return clampToArena(w, { x: p.x + w.rng.range(-SPAWN_SCATTER, SPAWN_SCATTER), y: p.y + w.rng.range(-SPAWN_SCATTER, SPAWN_SCATTER) });
}

export function tickSpawner(w: World, dt: number): void {
  const s = w.state;
  const plan = s.plan;
  if (plan.kind !== 'normal') return;
  const sp = w.spawner;
  for (let i = 0; i < sp.pending.length; ) {
    const ps = sp.pending[i];
    ps.remaining -= dt;
    if (ps.remaining <= 1e-9) {
      sp.pending.splice(i, 1);
      spawnPending(w, ps);
    } else i++;
  }
  // R15: waves on schedule; postpone (never drop) when the alive cap would be exceeded.
  while (sp.nextWave < plan.waves.length) {
    const wave = plan.waves[sp.nextWave];
    if (s.floorTime < wave.at - SPAWN_WARNING_TIME - 1e-9) break;
    const size = wave.spawns.reduce((a, g) => a + g.count, 0);
    const alive = countEnemies(w) + sp.pending.length;
    if (alive > 0 && alive + size > w.tunables.maxAliveMonsters) break;
    for (const g of wave.spawns) {
      const pt = w.rng.pick(sp.points);
      for (let k = 0; k < g.count; k++) {
        const pos = scatter(w, pt);
        sp.pending.push({ remaining: SPAWN_WARNING_TIME, monsterId: g.monsterId, pos, mid: false, wave: sp.nextWave });
        emit(w, { type: 'spawnWarning', pos: copy(pos), delay: SPAWN_WARNING_TIME });
      }
    }
    sp.nextWave++;
  }
  // The mid boss obeys the same alive cap as waves (9-1 동시 최대 maxAliveMonsters): postponed, never dropped.
  const midDue = sp.kills >= w.tunables.midBossKillTrigger || s.floorTime >= w.tunables.midBossTimeTrigger;
  const aliveNow = countEnemies(w) + sp.pending.length;
  const midRoom = aliveNow === 0 || aliveNow + 1 <= w.tunables.maxAliveMonsters;
  if (plan.midBossId && !sp.midTriggered && midDue && midRoom) {
    sp.midTriggered = true;
    const pos = clampToArena(w, w.rng.pick(sp.points));
    sp.pending.push({ remaining: SPAWN_WARNING_TIME, monsterId: plan.midBossId, pos, mid: true, wave: -1 });
    emit(w, { type: 'spawnWarning', pos: copy(pos), delay: SPAWN_WARNING_TIME });
  }
  const pendingWaves = new Set<number>();
  for (const ps of sp.pending) if (!ps.mid) pendingWaves.add(ps.wave);
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
    const allSpawned = sp.nextWave >= s.plan.waves.length && sp.pending.length === 0 && (!s.plan.midBossId || s.midBossSpawned);
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
  w.pending = [];
  w.bossRetreat = false;
  w.spawner.pending = [];
  const zones = s.zones.filter(z => z.team !== 'enemy');
  s.zones.length = 0;
  s.zones.push(...zones);
  for (const e of s.entities) if (e.team === 'enemy') e.rt.gone = true;
  compactEntities(w);
  s.monstersAlive = 0;
  s.wavesRemaining = 0;

  // R19: alive members (field + bench) heal floorHealFrac × maxHp; dead keep their revive timer.
  const frac = w.tunables.floorHealFrac;
  for (const p of s.players) {
    if (p.out) continue;
    for (const m of p.party) {
      if (m.dead) continue;
      const e = getEntity(w, m.entityId);
      if (e) heal(w, null, e, frac * e.maxHp);
      else m.hp = Math.min(m.maxHp, m.hp + frac * m.maxHp);
    }
  }
  syncMembers(w);

  if (s.floor >= w.tunables.maxFloor) {
    endRun(w, 'victory', 'cleared');
    return;
  }
  // Boss retreated in the same tick the last player went out: the floor counts as cleared, then the run is over.
  if (allOut(w)) {
    endRun(w, 'defeat', 'wipe');
    return;
  }

  // R20: reward phase (time frozen). Bots pick at random right away; out players get nothing.
  s.phase = 'reward';
  const relicFloor = s.plan.kind === 'boss';
  for (const p of s.players) {
    if (p.out) continue;
    const offers = rollOffers(w, p, relicFloor);
    if (offers.length === 0) continue;
    if (p.isBot || p.id !== 0) {
      applyOffer(w, p, offers[w.rng.int(0, offers.length - 1)]);
    } else {
      w.humanOffers = { player: p.id, offers };
      s.rewardOffers = offers;
    }
  }
  if (!w.humanOffers) startFloor(w, s.floor + 1, true);
}

export function chooseReward(w: World, pi: number, offerIndex: number): CommandResult {
  const s = w.state;
  if (s.phase !== 'reward' || !w.humanOffers) return { ok: false, reason: '보상 단계가 아님' };
  if (pi !== w.humanOffers.player) return { ok: false, reason: '잘못된 대상' };
  const offer = w.humanOffers.offers[offerIndex];
  if (!offer) return { ok: false, reason: '잘못된 선택' };
  applyOffer(w, s.players[pi], offer);
  w.humanOffers = null;
  s.rewardOffers = null;
  startFloor(w, s.floor + 1, true);
  return { ok: true };
}
