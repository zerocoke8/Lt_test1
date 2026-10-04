// Player-level rules: swap (R1–R4, R12), ult (R9), pets (R14), revive (R10), bench timers.

import type { CommandResult, GameState, Vec2 } from '../types';
import { getCharacter, getPet } from '../data';
import { APPEAR_SHIELD_DURATION } from './constants';
import { addShield, hitDamage } from './combat';
import { petCooldownFor, swapCooldownFor } from './cooldowns';
import { charCtx, petCtx } from './ctx';
import { benchActive, createCharacterEntity } from './entities';
import { appearShieldFrac, hasRelic, relicParam } from './modifiers';
import { partsForActions } from './preview';
import { addTelegraph, castSkill } from './skills';
import { benchMaxHp } from './stats';
import { applyStatus, tickStatusTimers } from './status';
import {
  activeEntity,
  aliveEnemiesOf,
  clampToArena,
  copy,
  dist,
  emit,
  type CastCtx,
  type SimPlayer,
  type World,
} from './world';

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

function playerOf(w: World, pi: number): SimPlayer | null {
  return Number.isInteger(pi) && pi >= 0 && pi < w.state.players.length ? w.state.players[pi] : null;
}

function statePlayer(s: GameState, pi: number): GameState['players'][number] | null {
  return Number.isInteger(pi) && pi >= 0 && pi < s.players.length ? s.players[pi] : null;
}

// ─────────────────────────── Pure checks over the public GameState ───────────────────────────
// Used by the sim AND by the multiplayer client (RemoteGame) on a snapshot, so both agree on what is allowed.

export function canSwapState(s: GameState, pi: number, idx: number): CommandResult {
  const p = statePlayer(s, pi);
  if (!p || !Number.isInteger(idx) || idx < 0 || idx >= p.party.length) return fail('잘못된 대상');
  if (p.out) return fail('관전 중');
  if (s.phase !== 'combat') return fail('전투 중이 아님');
  const m = p.party[idx];
  if (p.activeIndex === idx) return fail('이미 필드에 있음');
  if (m.dead) return fail('사망');
  // A card's own cooldown is the more useful reason, so it wins over the shared 0.5 s appear lock.
  if (m.swapCooldownRemaining > 0) return fail('쿨타임');
  if (p.appearLock > 0) return fail('등장 중');
  return ok;
}

export function canUsePetState(s: GameState, pi: number, petIndex: number): CommandResult {
  const p = statePlayer(s, pi);
  if (!p || !Number.isInteger(petIndex) || petIndex < 0 || petIndex >= p.pets.length) return fail('잘못된 대상');
  if (p.out) return fail('관전 중');
  if (s.phase !== 'combat') return fail('전투 중이 아님');
  if (p.pets[petIndex].cooldownRemaining > 0) return fail('쿨타임');
  return ok;
}

/** Ult check from the public state (the field character must exist: activeIndex set and that member alive). */
export function canUltState(s: GameState, pi: number): CommandResult {
  const p = statePlayer(s, pi);
  if (!p) return fail('잘못된 대상');
  if (p.out) return fail('관전 중');
  if (s.phase !== 'combat') return fail('전투 중이 아님');
  if (p.ult.charge < 1) return fail('게이지 부족');
  const m = p.activeIndex != null ? p.party[p.activeIndex] : null;
  if (!m || m.dead || m.entityId == null) return fail('필드에 캐릭터 없음');
  return ok;
}

// ─────────────────────────── Swap ───────────────────────────

export function canSwap(w: World, pi: number, idx: number): CommandResult {
  return canSwapState(w.state, pi, idx);
}

export function doSwap(w: World, pi: number, idx: number, pos: Vec2): CommandResult {
  const r = canSwap(w, pi, idx);
  if (!r.ok) return r;
  const p = w.state.players[pi];
  const t = w.tunables;

  // 1) leaving character
  const old = activeEntity(w, p);
  if (old) {
    const leaveIdx = p.activeIndex!;
    const leavePos = copy(old.pos);
    const leaveCtx = charCtx(w, old, 'passive', { id: 'relay_flag', name: '교대의 깃발' });
    benchActive(w, p);
    emit(w, { type: 'leave', player: p.id, partyIndex: leaveIdx, pos: leavePos });
    if (hasRelic(p, 'relay_flag')) relayExplosion(w, leaveCtx, leavePos);
  } else {
    p.activeIndex = null;
  }

  // 2) appearing character at the drop point
  const at = clampToArena(w, pos);
  const e = createCharacterEntity(w, p, idx, at);
  const m = p.party[idx];
  const def = getCharacter(m.defId);
  e.anim = 'appear';
  e.animTime = t.appearLockTime;
  e.rt.lockTime = t.appearLockTime;
  e.invulnTime = t.appearInvulnTime;
  e.rt.sinceAppear = 0;
  const oa = def.passive.onAppear;
  if (oa) applyStatus(e, oa.status, oa.duration, oa.value, p.id, 'passive');
  const shieldFrac = appearShieldFrac(p, idx);
  if (shieldFrac > 0) addShield(e, shieldFrac * e.maxHp, APPEAR_SHIELD_DURATION);

  m.swapCooldownTotal = swapCooldownFor(w, p, idx);
  m.swapCooldownRemaining = m.swapCooldownTotal;
  p.appearLock = t.appearLockTime;
  p.stats.swaps++;
  emit(w, { type: 'appear', player: p.id, partyIndex: idx, entityId: e.id, pos: copy(at) });

  // 3) drag skill at the drop point
  const ctx = charCtx(w, e, 'drag', def.drag);
  ctx.point = copy(at);
  castSkill(w, ctx, def.drag.actions);
  if (hasRelic(p, 'echo_seal')) {
    const power = relicParam('echo_seal', 'power');
    const echo: CastCtx = { ...ctx, dmgMult: ctx.dmgMult * power, healMult: ctx.healMult * power, shieldMult: ctx.shieldMult * power };
    const delay = relicParam('echo_seal', 'delay');
    // telegraph every part of the footprint (e.g. all five meteors), each spot once (bard's two bands share one).
    // Self-only parts (shields, cooldown cuts) have no footprint on the field — the drag preview hides them too.
    const ids: number[] = [];
    const seen = new Set<string>();
    for (const part of partsForActions(def.drag.actions, ctx.radiusMult)) {
      if (part.affects === 'self') continue;
      const c = { x: at.x + part.offset.x, y: at.y + part.offset.y };
      const key = `${c.x},${c.y},${JSON.stringify(part.area)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(addTelegraph(w, 'ally', c, c, part.area, delay).id);
    }
    w.pending.push({ kind: 'echo', ctx: echo, actions: def.drag.actions, remaining: delay, telegraphId: ids[0] ?? null, extraTelegraphIds: ids.slice(1) });
  }
  return ok;
}

function relayExplosion(w: World, ctx: CastCtx, at: Vec2): void {
  const radius = relicParam('relay_flag', 'radius');
  const amount = relicParam('relay_flag', 'amount');
  const c: CastCtx = { ...ctx, casterId: null, selfId: null, source: 'relic', slot: 'passive', isDrag: false, origin: copy(at), point: copy(at) };
  emit(w, { type: 'skillCast', sourceId: null, player: c.player, slot: 'passive', skillId: 'relay_flag', name: c.name, center: copy(at), area: { shape: 'circle', radius }, team: 'ally' });
  for (const t of aliveEnemiesOf(w, 'ally')) {
    if (dist(at, t.pos) <= radius + t.radius) hitDamage(w, c, t, amount);
  }
}

// ─────────────────────────── Ult ───────────────────────────

export function canUlt(w: World, pi: number): CommandResult {
  const p = playerOf(w, pi);
  if (!p) return fail('잘못된 대상');
  if (p.out) return fail('관전 중');
  if (w.state.phase !== 'combat') return fail('전투 중이 아님');
  if (p.ult.charge < 1) return fail('게이지 부족');
  if (!activeEntity(w, p)) return fail('필드에 캐릭터 없음');
  return ok;
}

export function useUlt(w: World, pi: number): CommandResult {
  const r = canUlt(w, pi);
  if (!r.ok) return r;
  const p = w.state.players[pi];
  const e = activeEntity(w, p)!;
  const def = e.rt.charDef!;
  const sk = def.ult;
  const fullSince = p.ult.fullSince ?? w.state.time;
  p.stats.ultDelayTotal += Math.max(0, w.state.time - fullSince);
  p.stats.ultDelayCount++;
  p.stats.ultsUsed++;
  p.ult.charge = 0;
  p.ult.fullSince = null;
  castSkill(w, charCtx(w, e, 'ult', sk), sk.actions);
  if (sk.castTime && sk.castTime > 0) {
    e.rt.lockTime = Math.max(e.rt.lockTime, sk.castTime);
    e.anim = 'cast';
    e.animTime = Math.max(e.animTime, sk.castTime);
  }
  return ok;
}

// ─────────────────────────── Pets ───────────────────────────

export function canUsePet(w: World, pi: number, petIndex: number): CommandResult {
  return canUsePetState(w.state, pi, petIndex);
}

export function usePet(w: World, pi: number, petIndex: number, pos: Vec2): CommandResult {
  const r = canUsePet(w, pi, petIndex);
  if (!r.ok) return r;
  const p = w.state.players[pi];
  const slot = p.pets[petIndex];
  const def = getPet(slot.defId);
  const at = clampToArena(w, pos);
  castSkill(w, petCtx(w, p, def, at), [def.action]);
  slot.cooldownTotal = petCooldownFor(w, p, petIndex);
  slot.cooldownRemaining = slot.cooldownTotal;
  p.stats.petsUsed++;
  return ok;
}

// ─────────────────────────── Per-tick ───────────────────────────

/** Count a timer down, snapping float dust to 0 so "ready" is exact. */
function dec(x: number, dt: number): number {
  const r = x - dt;
  return r <= 1e-6 ? 0 : r;
}

export function tickPlayers(w: World, dt: number): void {
  const t = w.tunables;
  for (const p of w.state.players) {
    if (p.out) continue;
    p.appearLock = dec(p.appearLock, dt);
    // R9: time-only charge, per player
    if (p.ult.charge < 1) {
      p.ult.charge = Math.min(1, p.ult.charge + dt / Math.max(0.01, t.ultChargeTime));
      if (p.ult.charge > 1 - 1e-9) p.ult.charge = 1;
    }
    if (p.ult.charge >= 1 && p.ult.fullSince == null) {
      p.ult.fullSince = w.state.time;
      emit(w, { type: 'ultReady', player: p.id });
    }
    for (const s of p.pets) s.cooldownRemaining = t.instantCooldowns ? 0 : dec(s.cooldownRemaining, dt);
    p.party.forEach((m, idx) => {
      m.swapCooldownRemaining = t.instantCooldowns ? 0 : dec(m.swapCooldownRemaining, dt);
      m.normalCooldownRemaining = t.instantCooldowns ? 0 : dec(m.normalCooldownRemaining, dt);
      if (m.dead) {
        m.reviveRemaining = dec(m.reviveRemaining, dt);
        if (m.reviveRemaining <= 0) revive(w, p, idx);
        return;
      }
      if (idx === p.activeIndex) return;
      // R12 bench: timers only (no regen, no DoT, no damage)
      tickStatusTimers(m.statuses, dt);
      if (m.shield > 0) {
        m.rt.shieldTime -= dt;
        if (m.rt.shieldTime <= 1e-6) {
          m.shield = 0;
          m.rt.shieldTime = 0;
        }
      }
    });
  }
}

function revive(w: World, p: SimPlayer, idx: number): void {
  const m = p.party[idx];
  const frac = hasRelic(p, 'phoenix_feather') ? relicParam('phoenix_feather', 'hpFrac') : w.tunables.reviveHpFrac;
  m.dead = false;
  m.reviveRemaining = 0;
  m.maxHp = benchMaxHp(p, idx);
  m.hp = Math.max(1, m.maxHp * frac);
  emit(w, { type: 'revive', player: p.id, partyIndex: idx });
}

/** Keep the active member's card (hp/shield) in sync with its entity. */
export function syncMembers(w: World): void {
  for (const p of w.state.players) {
    const e = activeEntity(w, p);
    if (!e) continue;
    const m = p.party[p.activeIndex!];
    m.hp = e.hp;
    m.maxHp = e.maxHp;
    m.shield = e.shield;
    m.rt.shieldTime = e.rt.shieldTime;
    m.statuses = e.statuses;
  }
}
