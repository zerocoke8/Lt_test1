// Player-level rules: swap (R1–R4, R12), ult (R9), pets (R14), revive (R10), bench timers.

import type { CommandResult, GameState, PlayerState, SkillAction, Tunables, Vec2 } from '../types';
import { ULT_CUTIN } from '../config';
import { getCharacter, getPet } from '../data';
import { tickBenchRegen } from './bench';
import { APPEAR_SHIELD_DURATION, MIN_SWAP_COOLDOWN } from './constants';
import { addShield, hitDamage } from './combat';
import { petCooldownFor, swapCooldownFor } from './cooldowns';
import { charCtx, petCtx } from './ctx';
import { benchActive, createCharacterEntity } from './entities';
import { fieldEventOnDrop } from './fieldEvents';
import { gearOnAppear, gearOnLand, gearOnLeave, tickGearBench } from './expeditionOptions';
import { appearShieldFrac, hasRelic, relicParam, relicScale } from './modifiers';
import { partsForActions } from './preview';
import { addTelegraph, castSkill } from './skills';
import { benchMaxHp, effStats } from './stats';
import { applyStatus, tickStatusTimers } from './status';
import { fieldUltGauge, refundUlt, tickUlt, ultCastableSince } from './ultMode';
import { creditJust, findJustThreats, justCooldown, justParams, type JustThreat } from './justSwap';
import {
  hasRewards,
  rwCanSwap,
  rwCooldownOnLeave,
  rwOnAppear,
  rwOnDragEnd,
  rwOnJustSwap,
  rwOnLand,
  rwOnLeave,
  rwOnPet,
  rwOnTeamSwap,
  rwOnUlt,
  rwDragRadiusAdd,
  rwPetRadiusAdd,
  rwTick,
  rwUltMult,
} from './rewards/hooks';
import { relayFlagBoost } from './rewards/swap';
import type { AppearInfo, DragMods } from './rewards/types';
import {
  activeEntity,
  aliveEnemiesOf,
  clampToArena,
  copy,
  dist,
  emit,
  getEntity,
  type CastCtx,
  type SimEntity,
  type SimMember,
  type SimPlayer,
  type World,
} from './world';

// the gauge rules (per character, 기획 15차) live in ./ultMode; re-exported for older importers
export { setUltCharge } from './ultMode';

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
  // 기획 17차: a reward may let a cooling card in (이중 장전: a charge left) — pure, so the client agrees.
  if (m.swapCooldownRemaining > 0 && !rwCanSwap(p, idx)) return fail('쿨타임');
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
  const m = p.activeIndex != null ? p.party[p.activeIndex] : null;
  // 기획 15차: the field character's own gauge (an empty field has none → '필드에 캐릭터 없음')
  const g = fieldUltGauge(p);
  if (g && g.charge < 1) return fail('게이지 부족');
  if (!g || !m || m.dead || m.entityId == null) return fail('필드에 캐릭터 없음');
  return ok;
}

// ─────────────────────────── Swap ───────────────────────────

export function canSwap(w: World, pi: number, idx: number): CommandResult {
  return canSwapState(w.state, pi, idx);
}

export function doSwap(w: World, pi: number, idx: number, pos: Vec2): CommandResult {
  const r = canSwap(w, pi, idx);
  if (!r.ok) return r;
  swapIn(w, w.state.players[pi], idx, pos, false);
  return ok;
}

/**
 * 기획 17차 (빈자리의 대타, fx.forceSwap): put card idx on the field now — no cooldown, appear-lock or 저스트 check.
 * False when it cannot come (down, already on the field, out, not in combat).
 */
export function forceSwapIn(w: World, p: SimPlayer, idx: number, pos: Vec2): boolean {
  const m = p.party[idx];
  if (!m || m.dead || p.out || p.activeIndex === idx || w.state.phase !== 'combat') return false;
  swapIn(w, p, idx, pos, true);
  return true;
}

/** What a 저스트 교대 of this swap carries from the leave to the appear beat. */
interface JustLeave {
  threats: JustThreat[];
  outIndex: number;
  pos: Vec2;
  cdCut: number;
  mult: number;
}

/**
 * The re-appear cooldown card idx gets now (기획 6차: it starts when the card is swapped OUT): the rewards' cooldown
 * rules (기획 17차: final = zero ? 0 : max(4, base × mult − flat); base already ≥ 4 unless a debug slider made it shorter).
 */
function leaveCooldown(w: World, p: SimPlayer, idx: number): number {
  const base = swapCooldownFor(w, p, idx);
  const cd = rwCooldownOnLeave(w, p, idx);
  if (cd.zero || base <= 0) return 0;
  if (cd.mult === 1 && cd.flat === 0) return base;
  return Math.max(Math.min(base, MIN_SWAP_COOLDOWN), base * cd.mult - cd.flat);
}

/**
 * 기획 17차 (준비 즉시, 오래 쉰 자의 분노): keep m.rt.readyAt = the time the card last became ready. A cooldown that
 * counts down, is cut to 0 directly (rewards, 괴담, debug) or starts at 0 (출근 도장) all stamp it here.
 */
function markCooling(w: World, m: SimMember, leaving = false): void {
  if (m.swapCooldownRemaining > 0) {
    m.rt.cooling = true;
    return;
  }
  if (m.rt.cooling === false && !leaving) return;
  m.rt.readyAt = w.state.time;
  m.rt.cooling = false;
}

/** 1) The field character leaves (its cooldown starts, leave effects): who left where, and the 저스트 it makes. */
function leaveField(w: World, p: SimPlayer, forced: boolean): { leave: AppearInfo['leave']; just: JustLeave | null } {
  const old = activeEntity(w, p);
  if (!old) {
    p.activeIndex = null;
    return { leave: null, just: null };
  }
  const leaveIdx = p.activeIndex!;
  const leavePos = copy(old.pos);
  // 기획 17차 저스트 교대: judged before the character leaves (what would have hit it)
  const threats = forced ? [] : findJustThreats(w, p, old);
  const jp = threats.length ? justParams(w, p) : null;
  const leaveCtx = charCtx(w, old, 'passive', { id: 'relay_flag', name: '교대의 깃발' });
  const hpFrac = old.hp / Math.max(1, old.maxHp);
  benchActive(w, p);
  rwOnLeave(w, p, { idx: leaveIdx, entity: old, pos: leavePos, hpFrac, ctx: leaveCtx, just: threats.length > 0 });
  // 기획 6차: the re-appear (= drag skill) cooldown starts when a character is swapped OUT, not when it appears.
  // 기획 17차: the 저스트 cut takes a share of what is left (the ring keeps its full length).
  const lm = p.party[leaveIdx];
  const cd = leaveCooldown(w, p, leaveIdx);
  lm.swapCooldownTotal = cd;
  lm.swapCooldownRemaining = jp ? justCooldown(cd, jp.cut) : cd;
  markCooling(w, lm, true);
  emit(w, { type: 'leave', player: p.id, partyIndex: leaveIdx, pos: leavePos });
  if (hasRelic(p, 'relay_flag')) relayExplosion(w, p, leaveCtx, leavePos);
  else if (p.gear) gearOnLeave(w, p, leaveIdx, leaveCtx, leavePos, hpFrac); // 기획 15차 원정
  const leave = { idx: leaveIdx, pos: copy(leavePos), defId: lm.defId };
  if (!jp) return { leave, just: null };
  return { leave, just: { threats, outIndex: leaveIdx, pos: leavePos, cdCut: cd - lm.swapCooldownRemaining, mult: jp.mult } };
}

function swapIn(w: World, p: SimPlayer, idx: number, pos: Vec2, forced: boolean): void {
  const t = w.tunables;
  const m = p.party[idx];
  const cooling = m.swapCooldownRemaining;
  const sinceReady = cooling > 0 || m.rt.cooling ? 0 : Math.max(0, w.state.time - (m.rt.readyAt ?? 0));

  // 1) leaving character
  const { leave, just } = leaveField(w, p, forced);

  // 2) appearing character at the drop point
  const at = clampToArena(w, pos);
  const e = createCharacterEntity(w, p, idx, at);
  const def = getCharacter(m.defId);
  e.anim = 'appear';
  e.animTime = t.appearLockTime;
  e.rt.lockTime = t.appearLockTime;
  e.invulnTime = t.appearInvulnTime;
  e.rt.sinceAppear = 0;
  const oa = def.passive.onAppear;
  if (oa) applyStatus(e, oa.status, oa.duration, oa.value, p.id, 'passive');
  const shieldFrac = appearShieldFrac(p, idx);
  if (shieldFrac > 0) addShield(e, shieldFrac * e.maxHp, APPEAR_SHIELD_DURATION, w);

  // the appearing character has no cooldown while on field (기획 6차: it starts when this one is swapped out)
  m.swapCooldownRemaining = 0;
  m.rt.cooling = false;
  p.appearLock = t.appearLockTime;
  p.stats.swaps++;
  emit(w, { type: 'appear', player: p.id, partyIndex: idx, entityId: e.id, pos: copy(at) });
  if (just) emitJust(w, p, just, idx, e, at);
  fieldEventOnDrop(w, p, 'swap', idx, at, e); // 기획 12차: lock onto a 돌발 괴담 target, light lamps, startle the child
  // 기획 15차 원정: appear effects of the gear (shield, ult charge, bolts) and the rested-rage drag bonus
  const rage = p.gear ? gearOnAppear(w, p, idx, e, charCtx(w, e, 'passive', null)) : 1;
  const info: AppearInfo = { idx, e, at: copy(at), leave, just: !!just, sinceReady, cooling, forced };
  const mods = rwOnAppear(w, p, info); // 기획 17차 floor rewards

  // 3) drag skill at the drop point
  const ctx = charCtx(w, e, 'drag', def.drag);
  ctx.point = copy(at);
  if (rage !== 1) ctx.dmgMult *= rage;
  ctx.radiusMult += rwDragRadiusAdd(p, idx); // 기획 17차: the pure radius additions (the drag preview shows them too)
  applyDragMods(ctx, e, mods, just?.mult ?? null);
  castSkill(w, ctx, def.drag.actions);
  if (p.gear) gearOnLand(w, p, idx, at, ctx);
  rwOnLand(w, p, info, ctx);
  if (just) justLanded(w, p, just, idx, e, at, ctx);
  echoSeal(w, p, idx, at, ctx, def.drag.actions);
  dragEnd(w, p, idx, at, ctx, def.drag.actions);
  rwOnTeamSwap(w, p, info);
}

/** 기획 17차: the onAppear multipliers and the 저스트 power (damage / heal / shield only — statuses, radius, groggy as they are). */
function applyDragMods(ctx: CastCtx, e: SimEntity, mods: DragMods, justMult: number | null): void {
  ctx.dmgMult *= mods.dmgMult;
  ctx.healMult *= mods.healMult;
  ctx.shieldMult *= mods.shieldMult;
  ctx.radiusMult *= mods.radiusMult;
  if (mods.forceCrit) ctx.forceCrit = true;
  if (mods.groggyMult !== 1) ctx.groggyMult = mods.groggyMult;
  if (mods.invulnAdd > 0) e.invulnTime += mods.invulnAdd;
  if (justMult != null) {
    ctx.dmgMult *= justMult;
    ctx.healMult *= justMult;
    ctx.shieldMult *= justMult;
    ctx.justMult = justMult;
  }
}

function emitJust(w: World, p: SimPlayer, j: JustLeave, idx: number, e: SimEntity, at: Vec2): void {
  const first = j.threats[0];
  emit(w, {
    type: 'justSwap',
    player: p.id,
    outIndex: j.outIndex,
    inIndex: idx,
    inEntityId: e.id,
    pos: copy(j.pos),
    drop: copy(at),
    sourceId: first.sourceId,
    skillId: first.skillId,
    boss: first.boss,
    dodged: j.threats.length,
    telegraphIds: j.threats.map(x => x.telegraphId),
    landIn: first.landIn,
    cdCut: j.cdCut,
  });
}

/** 기획 17차: after the drag cast + onLand — credit the 저스트 (stats, once per telegraph) and run the reward hooks. */
function justLanded(w: World, p: SimPlayer, j: JustLeave, idx: number, e: SimEntity, at: Vec2, drag: CastCtx): void {
  creditJust(w, p, j.threats);
  const threats = j.threats.map(x => ({ telegraphId: x.telegraphId, sourceId: x.sourceId, skillId: x.skillId, boss: x.boss, landIn: x.landIn }));
  rwOnJustSwap(w, p, { outIndex: j.outIndex, inIndex: idx, e, pos: copy(j.pos), drop: copy(at), threats, cdCut: j.cdCut, drag });
}

/** Relic 메아리 인장: the drag again 1 s later at 50 % (기획 15차 원정: an equipped seal echoes its wearer only). */
function echoSeal(w: World, p: SimPlayer, idx: number, at: Vec2, ctx: CastCtx, actions: SkillAction[]): void {
  const echoK = relicScale(p, idx, 'echo_seal');
  if (!(echoK > 0)) return;
  const power = relicParam('echo_seal', 'power') * echoK;
  // 기획 13차: the echo never fills the boss groggy gauge (one swap = one score)
  const echo: CastCtx = { ...ctx, dmgMult: ctx.dmgMult * power, healMult: ctx.healMult * power, shieldMult: ctx.shieldMult * power, noGroggy: true };
  const delay = relicParam('echo_seal', 'delay');
  // telegraph every part of the footprint (e.g. all five meteors), each spot once (bard's two bands share one).
  // Self-only parts (shields, cooldown cuts) have no footprint on the field — the drag preview hides them too.
  const ids: number[] = [];
  const seen = new Set<string>();
  for (const part of partsForActions(actions, ctx.radiusMult)) {
    if (part.affects === 'self') continue;
    const c = { x: at.x + part.offset.x, y: at.y + part.offset.y };
    const key = `${c.x},${c.y},${JSON.stringify(part.area)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(addTelegraph(w, 'ally', c, c, part.area, delay).id);
  }
  w.pending.push({ kind: 'echo', ctx: echo, actions, remaining: delay, telegraphId: ids[0] ?? null, extraTelegraphIds: ids.slice(1) });
}

/** 기획 17차: the reward hooks' onDragEnd when the drag's last part lands (instant drags: now). Players with rewards only. */
function dragEnd(w: World, p: SimPlayer, idx: number, at: Vec2, ctx: CastCtx, actions: readonly SkillAction[]): void {
  if (!hasRewards(p)) return;
  let last = 0;
  for (const a of actions) last = Math.max(last, (a.delay ?? 0) + (Math.max(1, a.hits ?? 1) - 1) * (a.hitInterval ?? 0.2));
  if (last <= 1e-9) rwOnDragEnd(w, p, idx, at, ctx);
  else w.pending.push({ kind: 'rewardDelay', player: p.id, tag: 'dragEnd', remaining: last, data: { idx }, pos: copy(at), ctx });
}

/** Relic 교대의 깃발 at the leave spot (기획 17차: with 교대 폭발 owned the two are one blast, relayFlagBoost). */
function relayExplosion(w: World, p: SimPlayer, ctx: CastCtx, at: Vec2): void {
  const boost = relayFlagBoost(p);
  const radius = relicParam('relay_flag', 'radius') + boost.radiusAdd;
  const amount = relicParam('relay_flag', 'amount') * boost.amountMult;
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
  const g = fieldUltGauge(p);
  if (g && g.charge < 1) return fail('게이지 부족');
  if (!g || !activeEntity(w, p)) return fail('필드에 캐릭터 없음');
  return ok;
}

export function useUlt(w: World, pi: number): CommandResult {
  const r = canUlt(w, pi);
  if (!r.ok) return r;
  const p = w.state.players[pi];
  const e = activeEntity(w, p)!;
  const def = e.rt.charDef!;
  const sk = def.ult;
  const g = fieldUltGauge(p)!; // the field character's own gauge (기획 15차)
  // a gauge that filled on the bench counts from the swap-in (ultCastableSince)
  const fullSince = ultCastableSince(g, w.state.time, e.rt.appearedAt);
  p.stats.ultDelayTotal += Math.max(0, w.state.time - fullSince);
  p.stats.ultDelayCount++;
  p.stats.ultsUsed++;
  const spent = g.charge; // 기획 17차: > 1 with 두 번 차는 게이지
  g.charge = 0;
  g.fullSince = null;
  // 기획 13차 컷인 (docs/skill-renewal.md 2-3): the cut-in starts on every screen; the sim keeps running, the caster is
  // invulnerable for the guard and stands still for castTime, and the effects land from ULT_CUTIN.firstHit s on
  emit(w, { type: 'ultCast', player: p.id, entityId: e.id, defId: def.id, skillId: sk.id, name: sk.name });
  e.invulnTime = Math.max(e.invulnTime, ULT_CUTIN.guard);
  const idx = p.activeIndex!;
  const ctx: CastCtx = { ...charCtx(w, e, 'ult', sk), ultCast: { landed: false, member: idx } };
  const um = rwUltMult(p, idx); // 기획 17차 floor rewards
  if (um !== 1) {
    ctx.dmgMult *= um;
    ctx.healMult *= um;
    ctx.shieldMult *= um;
  }
  castSkill(w, ctx, sk.actions);
  if (sk.castTime && sk.castTime > 0) {
    e.rt.lockTime = Math.max(e.rt.lockTime, sk.castTime);
    e.anim = 'cast';
    e.animTime = Math.max(e.animTime, sk.castTime);
  }
  rwOnUlt(w, p, idx, e, ctx, spent);
  return ok;
}

/**
 * 기획 13차: floor clear / boss retreat during the cut-in (every ult effect waits ≥ ULT_CUTIN.firstHit s): an ult none
 * of whose parts fired yet is given back — a full gauge, not counted as used.
 */
export function refundUnlandedUlts(w: World): void {
  // 기획 14차: two characters of one player can both be in their cut-in — each gets its own back. Casts are told apart
  // by the member recorded at cast time (each counted as used once).
  const refund = new Map<string, { pi: number; member: number | null }>();
  for (const pd of w.pending) {
    if (pd.kind !== 'hit' || !pd.ctx.ultCast || pd.ctx.ultCast.landed || pd.ctx.player == null) continue;
    const pi = pd.ctx.player;
    if (!w.state.players[pi]) continue;
    const member = pd.ctx.ultCast.member ?? null;
    refund.set(`${pi}:${member}`, { pi, member });
  }
  for (const { pi, member } of refund.values()) {
    const p = w.state.players[pi];
    p.stats.ultsUsed = Math.max(0, p.stats.ultsUsed - 1);
    refundUlt(w, p, member);
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
  const ctx = petCtx(w, p, def, at);
  // 기획 17차 floor rewards: pet power / radius
  const mods = rwOnPet(w, p, petIndex, at);
  const radius = (1 + rwPetRadiusAdd(p)) * mods.radius;
  if (mods.power !== 1 || radius !== 1) {
    ctx.dmgMult *= mods.power;
    ctx.healMult *= mods.power;
    ctx.shieldMult *= mods.power;
    ctx.radiusMult *= radius;
  }
  castSkill(w, ctx, [def.action]);
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
    // R9: time-only charge, per character (기획 15차 — src/sim/ultMode.ts)
    tickUlt(w, p, dt);
    for (const s of p.pets) s.cooldownRemaining = t.instantCooldowns ? 0 : dec(s.cooldownRemaining, dt);
    p.party.forEach((m, idx) => {
      m.swapCooldownRemaining = t.instantCooldowns ? 0 : dec(m.swapCooldownRemaining, dt);
      markCooling(w, m); // 기획 17차 (준비 즉시, 오래 쉰 자의 분노)
      if (idx === p.activeIndex && !m.dead) m.fieldTime = (m.fieldTime ?? 0) + dt; // 기획 17차 지명권 default
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
    if (p.gear) tickGearBench(w, p, dt); // 기획 15차 원정: rested stacks, 응급 후송
    rwTick(w, p, dt); // 기획 17차 floor rewards
  }
}

export function revive(w: World, p: SimPlayer, idx: number): void {
  const m = p.party[idx];
  const frac = relicScale(p, idx, 'phoenix_feather') > 0 ? relicParam('phoenix_feather', 'hpFrac') : w.tunables.reviveHpFrac;
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
