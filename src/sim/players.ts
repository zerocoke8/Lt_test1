// Player-level rules: swap (R1–R4, R12), ult (R9), pets (R14), revive (R10), bench timers.

import type { CommandResult, GameState, PlayerState, Tunables, Vec2 } from '../types';
import { ULT_CUTIN } from '../config';
import { getCharacter, getPet } from '../data';
import { tickBenchRegen } from './bench';
import { APPEAR_SHIELD_DURATION } from './constants';
import { addShield, hitDamage } from './combat';
import { petCooldownFor, swapCooldownFor } from './cooldowns';
import { charCtx, petCtx } from './ctx';
import { benchActive, createCharacterEntity } from './entities';
import { fieldEventOnDrop } from './fieldEvents';
import { appearShieldFrac, hasRelic, relicParam, ultChargeRate } from './modifiers';
import { partsForActions } from './preview';
import { addTelegraph, castSkill } from './skills';
import { benchMaxHp, effStats } from './stats';
import { applyStatus, tickStatusTimers } from './status';
import {
  activeEntity,
  aliveEnemiesOf,
  clampToArena,
  copy,
  dist,
  emit,
  getEntity,
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
    // 기획 6차: the re-appear (= drag skill) cooldown starts when a character is swapped OUT, not when it appears.
    const lm = p.party[leaveIdx];
    lm.swapCooldownTotal = swapCooldownFor(w, p, leaveIdx);
    lm.swapCooldownRemaining = lm.swapCooldownTotal;
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

  // the appearing character has no cooldown while on field (기획 6차: it starts when this one is swapped out)
  m.swapCooldownRemaining = 0;
  p.appearLock = t.appearLockTime;
  p.stats.swaps++;
  emit(w, { type: 'appear', player: p.id, partyIndex: idx, entityId: e.id, pos: copy(at) });
  fieldEventOnDrop(w, p, 'swap', idx, at, e); // 기획 12차: lock onto a 돌발 괴담 target, light lamps, startle the child

  // 3) drag skill at the drop point
  const ctx = charCtx(w, e, 'drag', def.drag);
  ctx.point = copy(at);
  castSkill(w, ctx, def.drag.actions);
  if (hasRelic(p, 'echo_seal')) {
    const power = relicParam('echo_seal', 'power');
    // 기획 13차: the echo never fills the boss groggy gauge (one swap = one score)
    const echo: CastCtx = { ...ctx, dmgMult: ctx.dmgMult * power, healMult: ctx.healMult * power, shieldMult: ctx.shieldMult * power, noGroggy: true };
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
  // 기획 13차 컷인 (docs/skill-renewal.md 2-3): the cut-in starts on every screen; the sim keeps running, the caster is
  // invulnerable for the guard and stands still for castTime, and the effects land from ULT_CUTIN.firstHit s on
  emit(w, { type: 'ultCast', player: p.id, entityId: e.id, defId: def.id, skillId: sk.id, name: sk.name });
  e.invulnTime = Math.max(e.invulnTime, ULT_CUTIN.guard);
  castSkill(w, charCtx(w, e, 'ult', sk), sk.actions);
  if (sk.castTime && sk.castTime > 0) {
    e.rt.lockTime = Math.max(e.rt.lockTime, sk.castTime);
    e.anim = 'cast';
    e.animTime = Math.max(e.animTime, sk.castTime);
  }
  return ok;
}

/**
 * Seconds for an empty gauge to fill (R9 time-only charge × 기획 10차 trace rate: 혼선 30 s → ~43 s). Pure (tunables +
 * PlayerState): the sim charges with it and the HUD's 'N초 후' / skill sheet show it, also on a client's snapshot.
 */
export function ultChargeTimeFor(tunables: Pick<Tunables, 'ultChargeTime'>, p: PlayerState): number {
  return Math.max(0.01, tunables.ultChargeTime) / ultChargeRate(p);
}

/** Set the ult gauge (0..1). Full: fullSince starts now + 'ultReady'; below full: fullSince cleared (기획 10차). */
export function setUltCharge(w: World, p: SimPlayer, value: number): void {
  // same near-full snap as tickPlayers: 0.7 of tick charge + 0.3 can land at 0.99999… (no ultReady otherwise)
  p.ult.charge = value > 1 - 1e-9 ? 1 : Math.max(0, value);
  if (p.ult.charge >= 1) {
    if (p.ult.fullSince == null) {
      p.ult.fullSince = w.state.time;
      emit(w, { type: 'ultReady', player: p.id });
    }
  } else {
    p.ult.fullSince = null;
  }
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
  fieldEventOnDrop(w, p, 'pet', petIndex, at, null); // 기획 12차 (after the cast: new summons lock on too)
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
      p.ult.charge = Math.min(1, p.ult.charge + dt / ultChargeTimeFor(t, p));
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
    // 기획 12차: 메딕 대기실 간호 — the one bench regen (src/sim/bench.ts)
    tickBenchRegen(w, p, dt);
  }
}

export function revive(w: World, p: SimPlayer, idx: number): void {
  const m = p.party[idx];
  const frac = hasRelic(p, 'phoenix_feather') ? relicParam('phoenix_feather', 'hpFrac') : w.tunables.reviveHpFrac;
  m.dead = false;
  m.reviveRemaining = 0;
  m.maxHp = benchMaxHp(p, idx);
  m.hp = Math.max(1, m.maxHp * frac);
  emit(w, { type: 'revive', player: p.id, partyIndex: idx });
}

/**
 * 기획 10차: re-derive every member's max HP after traces change (field: effective stats, bench: benchMaxHp) and keep
 * living members' HP within [1, max]. Dead members only get the new cap.
 */
export function refreshMaxHp(w: World, p: SimPlayer, raiseHp = false): void {
  // raiseHp: living members also gain the max HP added (like a +HP reward), so a heal before it stays a full heal
  const gain = (before: number, after: number) => (raiseHp ? Math.max(0, after - before) : 0);
  p.party.forEach((m, idx) => {
    const e = getEntity(w, m.entityId);
    if (e) {
      const before = e.maxHp;
      e.maxHp = effStats(w, e).maxHp;
      e.hp = Math.min(e.maxHp, Math.max(1, e.hp + gain(before, e.maxHp)));
      return;
    }
    const before = m.maxHp;
    m.maxHp = benchMaxHp(p, idx);
    if (!m.dead) m.hp = Math.min(m.maxHp, Math.max(1, m.hp + gain(before, m.maxHp)));
  });
  syncMembers(w);
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
