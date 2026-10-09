// 기획 15차 원정 모드: the special effects of gear (docs/expedition.md 4-3) and the equipped relics that act on a swap
// (교대의 깃발, merged with 「교대 폭발」). players.ts calls in at the swap's leave / appear / land beats and once per tick
// for the bench, always behind `if (p.gear)` — a classic player never reaches this file.
// Extra damage from gear never fills the boss groggy gauge (its contexts carry no groggy mark) and counts as 'relic'.

import type { SkillAction, Vec2 } from '../types';
import { GEAR_OPTIONS, optionParam, optionValue, type GearOptionDef } from '../data/gear';
import { addShield, hitDamage, killEntity } from './combat';
import { PULSE_INTERVAL } from './constants';
import { charOptionLevel, charRelicMult } from './expeditionGear';
import { relicParam } from './modifiers';
import { castSkill } from './skills';
import { addUltCharge } from './ultMode';
import { aliveEnemiesOf, copy, dist, emit, type CastCtx, type SimEntity, type SimPlayer, type World } from './world';

const NAME: Record<string, string> = Object.fromEntries(GEAR_OPTIONS.map((o: GearOptionDef) => [o.id, o.name]));

/** A gear context from one of the wearer's casts: no groggy, no reward multipliers, counted as 'relic'. */
function gearCtx(base: CastCtx, id: string, at: Vec2): CastCtx {
  return {
    ...base,
    casterId: null,
    selfId: null,
    slot: 'passive',
    source: 'relic',
    skillId: id,
    name: NAME[id] ?? id,
    dmgMult: 1,
    healMult: 1,
    shieldMult: 1,
    radiusMult: 1,
    isDrag: false,
    point: copy(at),
    origin: copy(at),
    groggyMark: undefined,
    noGroggy: true,
    ultCast: undefined,
  };
}

function proc(w: World, p: SimPlayer, idx: number, id: string, pos: Vec2): void {
  emit(w, { type: 'gearProc', player: p.id, partyIndex: idx, id, pos: copy(pos) });
}

function lv(p: SimPlayer, idx: number, id: string) {
  return charOptionLevel(p, idx, id);
}

/** A round blast at `at` (교대의 깃발 / 교대 폭발). */
function blast(w: World, ctx: CastCtx, at: Vec2, radius: number, amount: number): void {
  emit(w, { type: 'skillCast', sourceId: null, player: ctx.player, slot: 'passive', skillId: ctx.skillId, name: ctx.name, center: copy(at), area: { shape: 'circle', radius }, team: 'ally' });
  for (const t of aliveEnemiesOf(w, 'ally')) if (dist(at, t.pos) <= radius + t.radius) hitDamage(w, ctx, t, amount);
}

/** A lingering circle at `at` that re-applies `effects` every tickInterval s. */
function zoneAt(w: World, ctx: CastCtx, radius: number, duration: number, tick: number, affects: SkillAction['affects'], effects: SkillAction['effects']): void {
  castSkill(w, ctx, [{ center: 'point', area: { shape: 'circle', radius }, affects, effects, zone: { duration, tickInterval: tick } }]);
}

// ─────────────────────────── Leave ───────────────────────────

/**
 * The wearer just left the field at `at` (ctx: its context taken before it left, hpFrac: its HP share then).
 * 교대의 깃발 (equipped) and 「교대 폭발」 merge into one blast (+50 % power, +0.5 radius when both).
 */
export function gearOnLeave(w: World, p: SimPlayer, idx: number, ctx: CastCtx, at: Vec2, hpFrac: number): void {
  const flag = charRelicMult(p, idx, 'relay_flag');
  const bl = lv(p, idx, 'w_relay_blast');
  if (flag > 0 || bl) {
    let radius: number;
    let amount: number;
    if (flag > 0 && bl) {
      radius = relicParam('relay_flag', 'radius') + optionParam('w_relay_blast', 'relicRadius');
      amount = relicParam('relay_flag', 'amount') * flag * (1 + optionParam('w_relay_blast', 'relicPower'));
    } else if (flag > 0) {
      radius = relicParam('relay_flag', 'radius');
      amount = relicParam('relay_flag', 'amount') * flag;
    } else {
      radius = optionParam('w_relay_blast', 'radius', bl || 1);
      amount = optionValue('w_relay_blast', bl || 1);
    }
    const id = bl ? 'w_relay_blast' : 'relay_flag';
    blast(w, { ...gearCtx(ctx, id, at), name: bl ? NAME.w_relay_blast : '교대의 깃발' }, at, radius, amount);
    proc(w, p, idx, id, at);
  }
  const he = lv(p, idx, 'a_heal_echo');
  if (he) {
    const r = optionParam('a_heal_echo', 'radius');
    zoneAt(w, gearCtx(ctx, 'a_heal_echo', at), r, optionParam('a_heal_echo', 'duration'), 1, 'allies', [{ kind: 'heal', amount: optionValue('a_heal_echo', he) }]);
    proc(w, p, idx, 'a_heal_echo', at);
  }
  const ds = lv(p, idx, 'a_drop_shield');
  if (ds) {
    // damage taken −v while inside: a short defUp refreshed every tick (def is the damage-reduction share)
    const r = optionParam('a_drop_shield', 'radius');
    zoneAt(w, gearCtx(ctx, 'a_drop_shield', at), r, optionParam('a_drop_shield', 'duration'), 0.5, 'allies', [
      { kind: 'status', status: 'defUp', duration: 0.6, value: optionValue('a_drop_shield', ds) },
    ]);
    proc(w, p, idx, 'a_drop_shield', at);
  }
  const ev = lv(p, idx, 'a_evac');
  const m = p.party[idx];
  if (ev && hpFrac <= optionParam('a_evac', 'hpBelow') + 1e-9 && w.state.time >= (m.rt.evacReadyAt ?? 0) - 1e-9) {
    m.rt.evac = { left: optionParam('a_evac', 'duration'), rate: optionValue('a_evac', ev), acc: 0 };
    m.rt.evacReadyAt = w.state.time + optionParam('a_evac', 'cooldown');
    proc(w, p, idx, 'a_evac', at);
  }
}

// ─────────────────────────── Appear / land ───────────────────────────

/** The wearer just appeared (before its drag skill). Returns the drag damage multiplier (오래 쉰 자의 분노). */
export function gearOnAppear(w: World, p: SimPlayer, idx: number, e: SimEntity, base: CastCtx): number {
  const sh = lv(p, idx, 'a_appear_shield');
  if (sh) {
    addShield(e, optionValue('a_appear_shield', sh) * e.maxHp, optionParam('a_appear_shield', 'duration'));
    proc(w, p, idx, 'a_appear_shield', e.pos);
  }
  const uc = lv(p, idx, 'c_ult_charge');
  if (uc) {
    addUltCharge(w, p, optionValue('c_ult_charge', uc)); // the field character = this one
    proc(w, p, idx, 'c_ult_charge', e.pos);
  }
  const bo = lv(p, idx, 'w_appear_bolt');
  if (bo) {
    const n = optionParam('w_appear_bolt', 'targets', bo);
    const ctx = gearCtx(base, 'w_appear_bolt', e.pos);
    const near = aliveEnemiesOf(w, 'ally')
      .filter(t => t.eventTag !== 'ward')
      .map(t => ({ t, d: dist(t.pos, e.pos) }))
      .sort((a, b) => a.d - b.d || a.t.id - b.t.id)
      .slice(0, n);
    for (const { t } of near) hitDamage(w, ctx, t, optionValue('w_appear_bolt', bo));
    if (near.length) proc(w, p, idx, 'w_appear_bolt', e.pos);
  }
  const m = p.party[idx];
  const rr = lv(p, idx, 'c_rested_rage');
  const stacks = rr ? Math.min(optionParam('c_rested_rage', 'maxStacks'), Math.floor((m.rt.rested ?? 0) + 1e-9)) : 0;
  m.rt.rested = 0;
  if (stacks > 0) proc(w, p, idx, 'c_rested_rage', e.pos);
  return stacks > 0 ? 1 + stacks * optionValue('c_rested_rage', rr || 1) : 1;
}

/** The wearer's drag landed at `at` (drag: its drag context). */
export function gearOnLand(w: World, p: SimPlayer, idx: number, at: Vec2, drag: CastCtx): void {
  const sc = lv(p, idx, 'w_scorch');
  if (sc) {
    const tick = 0.5;
    zoneAt(w, gearCtx(drag, 'w_scorch', at), optionParam('w_scorch', 'radius'), optionParam('w_scorch', 'duration'), tick, 'enemies', [
      { kind: 'damage', amount: optionValue('w_scorch', sc) * tick },
      { kind: 'status', status: 'burn', duration: optionParam('w_scorch', 'burnDuration'), value: optionParam('w_scorch', 'burnDps') },
    ]);
    proc(w, p, idx, 'w_scorch', at);
  }
  const ex = lv(p, idx, 'w_execute');
  if (ex) {
    const r = optionParam('w_execute', 'radius');
    const frac = optionValue('w_execute', ex);
    const ctx = gearCtx(drag, 'w_execute', at);
    let n = 0;
    for (const t of aliveEnemiesOf(w, 'ally')) {
      if (t.tier !== 'normal' || t.eventTag || t.kind !== 'monster') continue;
      if (dist(at, t.pos) > r + t.radius || t.hp > frac * t.maxHp) continue;
      killEntity(w, t, ctx);
      n++;
    }
    if (n) proc(w, p, idx, 'w_execute', at);
  }
}

// ─────────────────────────── Bench tick ───────────────────────────

/** Per tick (not out): rested stacks grow on ready bench cards; 응급 후송 heals in pulses on the bench. */
export function tickGearBench(w: World, p: SimPlayer, dt: number): void {
  p.party.forEach((m, idx) => {
    if (idx === p.activeIndex || m.dead) {
      if (m.rt.evac) m.rt.evac = undefined;
      return;
    }
    if (m.swapCooldownRemaining <= 0 && lv(p, idx, 'c_rested_rage')) m.rt.rested = Math.min(optionParam('c_rested_rage', 'maxStacks'), (m.rt.rested ?? 0) + dt);
    const ev = m.rt.evac;
    if (!ev) return;
    ev.acc += dt;
    while (ev.acc >= PULSE_INTERVAL - 1e-9 && ev.left > 1e-9) {
      ev.acc -= PULSE_INTERVAL;
      ev.left -= PULSE_INTERVAL;
      const actual = Math.min(m.maxHp - m.hp, ev.rate * PULSE_INTERVAL * m.maxHp);
      if (actual > 0) {
        m.hp += actual;
        p.stats.healing += actual;
        emit(w, { type: 'benchHeal', player: p.id, partyIndex: idx, amount: actual });
      }
    }
    if (ev.left <= 1e-9) m.rt.evac = undefined;
  });
}
