// 기획 17차 Track A reward group — 등장·착지 + 퇴장 + 직업 특기 + 교대 연계 (docs/floor-rewards.md; data:
// src/data/rewards/swap.ts). Each family is one small hook object; SWAP_HOOKS runs them in a fixed order. Extra damage
// goes through fx.rewardCtx (no groggy, 'relic' damage); recasts of a drag (도플갱어, 갈래 사격, 두 갈래 손길) never
// fill the groggy gauge either. Gear (원정) with the same effect is merged here: the gear side stays quiet
// (expeditionOptions.rewardTakesOver) and the reward adds the gear's power (radius / targets: the larger).

import type { Role, SkillAction, StatusId, Vec2 } from '../../types';
import { DEBUFFS } from '../../types';
import { ROLE_NUM, ROLE_TWICE } from '../../data/rewards/swap';
import { TAG_BONUS, getCharacter } from '../../data';
import { optionParam, optionValue } from '../../data/gear';
import { addShield, heal, killEntity } from '../combat';
import { PULSE_INTERVAL } from '../constants';
import { charCtx } from '../ctx';
import { clampUnit } from '../entities';
import { charOptionLevel, charRelicMult } from '../expeditionGear';
import { hasRelic, relicParam } from '../modifiers';
import { addTelegraph, castSkill } from '../skills';
import { applyStatus, cleanse, constrainTether, isBossy } from '../status';
import { addUltCharge } from '../ultMode';
import { reduceRevive } from '../bench';
import { aliveEnemiesOf, clampToArena, copy, dist, emit, getEntity, isAlive, type CastCtx, type SimEntity, type SimPlayer, type World } from '../world';
import { receivedMultOf } from './base';
import {
  blast,
  fireBolt,
  guardAdd,
  icdReady,
  lineHit,
  nearestEnemies,
  placeMine,
  proc,
  rewardCtx,
  rewardShield,
  rtNum,
  scheduleReward,
  setRtNum,
  spawnDecoy,
  spawnShooter,
  zoneAt,
} from './fx';
import { rwStatusDuration } from './hooks';
import { rewardCount, rewardParam, roleLevel, tagActive } from './query';
import { hookGroup, type DragMods, type RewardHooks } from './types';

// ─────────────────────────── Shared helpers ───────────────────────────

/** #등장 set: appear / land reward power and radius ×. */
function appearPower(p: SimPlayer): number {
  return tagActive(p, 'appear') ? 1 + TAG_BONUS.appear.power : 1;
}
function appearRadius(p: SimPlayer): number {
  return tagActive(p, 'appear') ? 1 + TAG_BONUS.appear.radius : 1;
}
/** #퇴장 set: leave reward radius ×, lingering things +s. */
function leaveRadius(p: SimPlayer): number {
  return tagActive(p, 'leave') ? 1 + TAG_BONUS.leave.radius : 1;
}
function linger(p: SimPlayer): number {
  return tagActive(p, 'leave') ? TAG_BONUS.leave.linger : 0;
}

function roleOf(p: SimPlayer, idx: number): Role {
  return getCharacter(p.party[idx].defId).role;
}

/** 직업 특기 for a role: highest level owned (0 = none) and the 「두 번」 multiplier (×1.5). */
function roleK(p: SimPlayer, role: Role): { level: number; k: number } {
  const r = roleLevel(p, role);
  return { level: r.level, k: r.twice ? ROLE_TWICE : 1 };
}

function gearLv(p: SimPlayer, idx: number, id: string): 0 | 1 | 2 | 3 {
  return p.gear ? charOptionLevel(p, idx, id) : 0;
}
function gearVal(p: SimPlayer, idx: number, id: string): number {
  const lv = gearLv(p, idx, id);
  return lv ? optionValue(id, lv) : 0;
}

/** Enemies whose body touches the circle (돌발 괴담 wards excluded). */
function enemiesNear(w: World, at: Vec2, r: number): SimEntity[] {
  return aliveEnemiesOf(w, 'ally').filter(t => t.eventTag !== 'ward' && dist(at, t.pos) <= r + t.radius);
}

/** Every player's living characters on the field whose body touches the circle. */
function alliesNear(w: World, at: Vec2, r: number): SimEntity[] {
  return w.state.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e) && dist(at, e.pos) <= r + e.radius);
}

/** Per-enemy internal cooldown (깜짝 등장, 물러서!): keys '<family>.e<id>' (pruned at each floor start). */
function enemyReady(w: World, p: SimPlayer, family: string, t: SimEntity, s: number): boolean {
  return icdReady(w, p, `${family}.e${t.id}`, s);
}

/** Push (away) or pull a unit. Bosses, mid bosses, fixed units and 돌발 괴담 units never move. */
function displaceUnit(w: World, t: SimEntity, center: Vec2, distance: number, away: boolean): void {
  if (!(distance > 0) || t.rt.stationary || isBossy(t) || t.eventTag) return;
  const dx = t.pos.x - center.x;
  const dy = t.pos.y - center.y;
  const d = Math.hypot(dx, dy);
  if (away) {
    const ux = d > 1e-6 ? dx / d : 1;
    const uy = d > 1e-6 ? dy / d : 0;
    t.pos.x += ux * distance;
    t.pos.y += uy * distance;
  } else {
    if (d < 1e-6) return;
    const m = Math.min(distance, Math.max(0, d - 0.3));
    t.pos.x -= (dx / d) * m;
    t.pos.y -= (dy / d) * m;
  }
  clampUnit(w, t);
  constrainTether(t);
}

/** A hostile status from a reward (its duration through the statusDuration hooks: 주문 연장, #상태이상). */
function hostile(w: World, p: SimPlayer, ctx: CastCtx, t: SimEntity, id: StatusId, d: number, value: number): boolean {
  return applyStatus(t, id, rwStatusDuration(w, ctx, id, d), value, p.id, 'relic', { anchor: copy(t.pos) });
}

/** Drag power ×k (damage, heal, shield). */
function boostDrag(mods: DragMods, k: number): void {
  mods.dmgMult *= k;
  mods.healMult *= k;
  mods.shieldMult *= k;
}

/**
 * A recast of a drag at `at` (도플갱어, 갈래 사격, 두 갈래 손길): no caster (no move / dash), power ×k, no groggy.
 * Its damage is reward damage ('relic', not a drag hit: no drag ×2 on a groggy boss, no 약점, no drag on-hit hooks).
 */
function recastCtx(drag: CastCtx, at: Vec2, k: number): CastCtx {
  return {
    ...drag,
    source: 'relic',
    isDrag: false,
    casterId: null,
    selfId: null,
    point: copy(at),
    origin: copy(at),
    dmgMult: drag.dmgMult * k,
    healMult: drag.healMult * k,
    shieldMult: drag.shieldMult * k,
    groggyMark: undefined,
    noGroggy: true,
    justMult: undefined,
    ultCast: undefined,
  };
}

/** The parts of a skill a recast repeats: no self-only parts, teleports or summons (dashes are cast with noDash). */
function recastActions(actions: readonly SkillAction[]): SkillAction[] {
  return actions.filter(a => a.affects !== 'self' && !a.blink && !a.blinkChain && !a.summon);
}

function recastDrag(w: World, ctx: CastCtx, defId: string): void {
  const actions = recastActions(getCharacter(defId).drag.actions);
  if (actions.length) castSkill(w, ctx, actions, { noDash: true });
}

/** Heal member idx by amount HP (field: a normal heal; bench: the card, like 메딕 간호). */
function healMember(w: World, p: SimPlayer, idx: number, amount: number): number {
  const m = p.party[idx];
  if (!m || m.dead || !(amount > 0)) return 0;
  const e = getEntity(w, m.entityId);
  if (e) return heal(w, p.id, e, amount);
  const actual = Math.min(m.maxHp - m.hp, amount * receivedMultOf(p));
  if (!(actual > 0)) return 0;
  m.hp += actual;
  p.stats.healing += actual;
  emit(w, { type: 'benchHeal', player: p.id, partyIndex: idx, amount: actual });
  return actual;
}

/** Guard hold: how long a zone guard lasts after the unit stepped out (a little more than a tick). */
const GUARD_HOLD = 0.1;

type HeldGuard = { frac: number; until: number; key?: string };

/** Keep a guard on e while it stands in a zone: one refreshed entry per key (fx.guardOf sums them, cap 50 %). */
function holdGuard(w: World, e: SimEntity, key: string, frac: number): void {
  const now = w.state.time;
  const list = (e.rt.guards ??= []) as HeldGuard[];
  const g = list.find(x => x.key === key && x.until > now + 1e-9);
  if (g) {
    g.frac = frac;
    g.until = now + GUARD_HOLD;
    return;
  }
  e.rt.guards = [...list.filter(x => x.until > now + 1e-9), { frac, until: now + GUARD_HOLD, key }];
}

/** A zone whose allies get a guard while inside: rt key 'zg.<zoneId>' = guard share (ticked by zoneGuards). */
function guardZone(p: SimPlayer, zoneId: number, frac: number): void {
  setRtNum(p, `zg.${zoneId}`, frac);
}

function rtKeys(p: SimPlayer, prefix: string): string[] {
  return p.rt.reward ? Object.keys(p.rt.reward).filter(k => k.startsWith(prefix)) : [];
}

// ─────────────────────────── 등장·착지 ───────────────────────────

/** 등장 에너지탄 (bolt): on appear, the nearest N enemies get a bolt each; twice → +1 target (max 5). */
const BOLT_MAX_TARGETS = 5;

const bolt: RewardHooks = {
  onAppear(w, p, info) {
    const n = rewardCount(p, 'bolt');
    if (!n) return;
    const gl = gearLv(p, info.idx, 'w_appear_bolt');
    const targets = Math.min(BOLT_MAX_TARGETS, Math.max(rewardParam(p, 'bolt', 'targets', 'max') + (n - 1), gl ? optionParam('w_appear_bolt', 'targets', gl) : 0));
    const power = (rewardParam(p, 'bolt', 'power', 'sum') + gearVal(p, info.idx, 'w_appear_bolt')) * appearPower(p);
    const ctx = rewardCtx(charCtx(w, info.e, 'passive', null), 'bolt', info.at);
    const near = nearestEnemies(w, info.at, targets);
    for (const t of near) fireBolt(w, ctx, info.e.pos, t, power);
    if (near.length) proc(w, p, info.idx, 'bolt', info.at);
  },
};

/** 깜짝 등장 (startle): before the drag, stun around the drop (same enemy once per 5 s, no bosses); twice +0.2 s (max 1.2). */
const STARTLE = { icd: 5, twice: 0.2, max: 1.2 };

const startle: RewardHooks = {
  onAppear(w, p, info) {
    const n = rewardCount(p, 'startle');
    if (!n) return;
    const r = rewardParam(p, 'startle', 'radius', 'max') * appearRadius(p);
    const d = Math.min(STARTLE.max, rewardParam(p, 'startle', 'stun', 'max') + STARTLE.twice * (n - 1));
    const ctx = rewardCtx(charCtx(w, info.e, 'passive', null), 'startle', info.at);
    blast(w, ctx, info.at, r, 0);
    let hit = 0;
    for (const t of enemiesNear(w, info.at, r)) {
      if (isBossy(t) || !enemyReady(w, p, 'startle', t, STARTLE.icd)) continue;
      if (hostile(w, p, ctx, t, 'stun', d, 0)) hit++;
    }
    if (hit) proc(w, p, info.idx, 'startle', info.at);
  },
};

/** 원혼의 손짓 (beckon): before the drag, pull enemies toward the drop + slow 2 s (bosses / fixed units stay). */
const BECKON = { slowDur: 2, slowMax: 0.6 };

const beckon: RewardHooks = {
  onAppear(w, p, info) {
    if (!rewardCount(p, 'beckon')) return;
    const r = rewardParam(p, 'beckon', 'radius', 'max') * appearRadius(p);
    const pull = rewardParam(p, 'beckon', 'pull', 'max');
    const slow = Math.min(BECKON.slowMax, rewardParam(p, 'beckon', 'slow', 'sum'));
    const ctx = rewardCtx(charCtx(w, info.e, 'passive', null), 'beckon', info.at);
    blast(w, ctx, info.at, r, 0);
    const list = enemiesNear(w, info.at, r);
    for (const t of list) {
      displaceUnit(w, t, info.at, pull, false);
      hostile(w, p, ctx, t, 'slow', BECKON.slowDur, slow);
    }
    if (list.length) proc(w, p, info.idx, 'beckon', info.at);
  },
};

/** 그을린 발자국 (scorch): after the drag, a fire circle (r 2, 4 s) — damage per second + burn. Merges with gear w_scorch. */
const SCORCH = { radius: 2, life: 4, tick: 0.5, burnDur: 2, burnDps: 0.1 };

const scorch: RewardHooks = {
  onLand(w, p, info, drag) {
    if (!rewardCount(p, 'scorch')) return;
    const power = (rewardParam(p, 'scorch', 'power', 'sum') + gearVal(p, info.idx, 'w_scorch')) * appearPower(p);
    const r = SCORCH.radius * appearRadius(p);
    zoneAt(w, p, rewardCtx(drag, 'scorch', info.at), r, SCORCH.life, SCORCH.tick, 'enemies', [
      { kind: 'damage', amount: power * SCORCH.tick },
      { kind: 'status', status: 'burn', duration: SCORCH.burnDur, value: SCORCH.burnDps },
    ]);
    proc(w, p, info.idx, 'scorch', info.at);
  },
};

/** 교대선 (relay_line): a band from the leave spot to the drop (at least 3 cells long). No leaver → nothing. */
const RELAY_LINE_MIN = 3;

const relayLine: RewardHooks = {
  onLand(w, p, info, drag) {
    if (!info.leave || !rewardCount(p, 'relay_line')) return;
    const width = rewardParam(p, 'relay_line', 'width', 'max') * appearRadius(p);
    const power = rewardParam(p, 'relay_line', 'power', 'sum') * appearPower(p);
    const n = lineHit(w, rewardCtx(drag, 'relay_line', info.leave.pos), info.leave.pos, info.at, width, RELAY_LINE_MIN, power);
    if (n) proc(w, p, info.idx, 'relay_line', info.at);
  },
};

/** 맞교대 (inplace): drop within 1.5 of the leave spot → appear invulnerable +1 s, the leaver's cooldown ×0.5 (min 4). */
const inplace: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!info.leave || !rewardCount(p, 'inplace')) return;
    if (dist(info.leave.pos, info.at) > rewardParam(p, 'inplace', 'range', 'max') + 1e-9) return;
    mods.invulnAdd += rewardParam(p, 'inplace', 'invuln', 'max');
    const m = p.party[info.leave.idx];
    const rem = m.swapCooldownRemaining;
    m.swapCooldownRemaining = Math.max(Math.min(rem, MIN_COOLDOWN), rem * rewardParam(p, 'inplace', 'cdMult', 'max'));
    proc(w, p, info.idx, 'inplace', info.at, '맞교대');
  },
};

/** Every re-appear cooldown cut ends at 4 s at least (the 저스트 cut and 출근 도장 are the exceptions). */
const MIN_COOLDOWN = 4;

/** 준비 즉시 (prompt): dragged within 1 / 1.5 s of the card getting ready → '즉시!', drag +30 / 40 %, ult +5 %. */
const prompt: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!rewardCount(p, 'prompt') || info.forced || info.cooling > 0) return;
    if (info.sinceReady > rewardParam(p, 'prompt', 'window', 'max') + 1e-9) return;
    boostDrag(mods, 1 + rewardParam(p, 'prompt', 'power', 'sum'));
    addUltCharge(w, p, rewardParam(p, 'prompt', 'ult', 'max'));
    proc(w, p, info.idx, 'prompt', info.at, '즉시!');
  },
};

/** 오래 쉰 자의 분노 (rested): 1 stack per whole second waited while ready (max 10), drag damage + per stack. */
const RESTED_MAX = 10;

const rested: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!rewardCount(p, 'rested') || info.cooling > 0) return;
    const stacks = Math.min(RESTED_MAX, Math.floor(info.sinceReady + 1e-9));
    if (stacks <= 0) return;
    const per = rewardParam(p, 'rested', 'per', 'sum') + gearVal(p, info.idx, 'c_rested_rage');
    mods.dmgMult *= 1 + stacks * per;
    proc(w, p, info.idx, 'rested', info.at, `×${stacks}`);
  },
};

/** 부적 착지 (talisman): cleanse every player's characters near the drop; per status removed a shield on the lander. */
const TALISMAN_SHIELD_DUR = 4;

const talisman: RewardHooks = {
  onLand(w, p, info) {
    if (!rewardCount(p, 'talisman')) return;
    const r = rewardParam(p, 'talisman', 'radius', 'max') * appearRadius(p);
    let removed = 0;
    for (const a of alliesNear(w, info.at, r)) {
      const n = a.statuses.filter(s => DEBUFFS.has(s.id)).length;
      if (!n) continue;
      cleanse(a.statuses);
      removed += n;
    }
    if (!removed) return;
    const frac = Math.min(rewardParam(p, 'talisman', 'cap', 'sum'), removed * rewardParam(p, 'talisman', 'per', 'sum'));
    rewardShield(w, info.e, frac, TALISMAN_SHIELD_DUR);
    proc(w, p, info.idx, 'talisman', info.at);
  },
};

/** 도플갱어 (doppel, 전설): the incoming drag again at the leave spot after a 0.6 s telegraph, 35 %; a 3 s afterimage. */
const DOPPEL_MARK = 1.2;

const doppel: RewardHooks = {
  onLand(w, p, info, drag) {
    if (!info.leave || !rewardCount(p, 'doppel')) return;
    const at = info.leave.pos;
    const delay = rewardParam(p, 'doppel', 'delay', 'max');
    const k = rewardParam(p, 'doppel', 'power', 'max') * appearPower(p);
    const tg = addTelegraph(w, 'ally', at, at, { shape: 'circle', radius: DOPPEL_MARK }, delay);
    spawnShooter(w, p, 'doppel', at, { duration: rewardParam(p, 'doppel', 'life', 'max'), interval: 99, range: 0, amount: 0, atk: 0 });
    scheduleReward(w, p, 'doppel', delay, { idx: info.idx, tg: tg.id }, at, recastCtx(drag, at, k));
  },
  onDelay(w, p, pd) {
    if (pd.tag !== 'doppel' || !pd.ctx || !pd.pos) return;
    removeTelegraphById(w, pd.data.tg);
    const m = p.party[pd.data.idx];
    if (!m) return;
    recastDrag(w, pd.ctx, m.defId);
    proc(w, p, null, 'doppel', pd.pos);
  },
};

function removeTelegraphById(w: World, id: number | undefined): void {
  const i = id != null ? w.state.telegraphs.findIndex(t => t.id === id) : -1;
  if (i >= 0) w.state.telegraphs.splice(i, 1);
}

// ─────────────────────────── 퇴장 ───────────────────────────

/**
 * 교대 폭발 (relay_blast): a blast at the leave spot. Classic relic 교대의 깃발 owned → players.ts casts the flag's
 * blast boosted (relayFlagBoost) and this stays quiet. 원정: merged with an equipped 교대의 깃발 (flag ×1.5, radius +0.5)
 * or the weapon effect 교대 폭발 (power added, radius the larger).
 */
const RELAY_FLAG_BOOST = { amountMult: 1.5, radiusAdd: 0.5 };

const relayBlast: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'relay_blast') || hasRelic(p, 'relay_flag')) return;
    const flag = p.gear ? charRelicMult(p, info.idx, 'relay_flag') : 0;
    let radius: number;
    let amount: number;
    if (flag > 0) {
      radius = relicParam('relay_flag', 'radius') + RELAY_FLAG_BOOST.radiusAdd;
      amount = relicParam('relay_flag', 'amount') * flag * RELAY_FLAG_BOOST.amountMult;
    } else {
      const bl = gearLv(p, info.idx, 'w_relay_blast');
      radius = Math.max(rewardParam(p, 'relay_blast', 'radius', 'max'), bl ? optionParam('w_relay_blast', 'radius', bl) : 0);
      amount = rewardParam(p, 'relay_blast', 'power', 'sum') + gearVal(p, info.idx, 'w_relay_blast');
    }
    blast(w, rewardCtx(info.ctx, 'relay_blast', info.pos), info.pos, radius * leaveRadius(p), amount);
    proc(w, p, info.idx, 'relay_blast', info.pos);
  },
};

/** 잔상 (shade): an untargetable afterimage at the leave spot shooting the nearest enemy every 0.6 s (cap 2). */
const SHADE = { interval: 0.6, range: 5 };

const shade: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'shade')) return;
    spawnShooter(w, p, 'shade', info.pos, {
      duration: rewardParam(p, 'shade', 'life', 'max') + linger(p),
      interval: SHADE.interval,
      range: SHADE.range,
      amount: rewardParam(p, 'shade', 'power', 'sum'),
      atk: info.ctx.atk,
    });
    proc(w, p, info.idx, 'shade', info.pos);
  },
};

/** 발밑 지뢰 (mine): a 20 s mine at the leave spot (cap 2 / 3): r 1.5 damage + root 1.5 s (fx.tickMines fires it). */
const MINE = { life: 20, radius: 1.5, root: 1.5 };

const mine: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'mine')) return;
    placeMine(w, p, info.pos, {
      duration: MINE.life + linger(p),
      radius: MINE.radius * leaveRadius(p),
      amount: rewardParam(p, 'mine', 'power', 'sum'),
      root: MINE.root,
      cap: rewardParam(p, 'mine', 'cap', 'max'),
      ctx: rewardCtx(info.ctx, 'mine', info.pos),
      family: 'mine',
    });
  },
};

/**
 * 응급 후송 (evac): leaving at HP ≤ 35 % → the card heals on the bench for 4 s (rare: its cooldown −1.5 s), once per
 * character per 20 s. Merged with the armor effect 응급 후송 (rates added). rt: 'evac.left|rate|acc|cd|ready.<idx>'.
 */
const EVAC = { hpBelow: 0.35, life: 4, icd: 20 };

const evac: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'evac') || info.hpFrac > EVAC.hpBelow + 1e-9) return;
    if (!icdReady(w, p, `evac.ready.${info.idx}`, EVAC.icd)) return;
    setRtNum(p, `evac.left.${info.idx}`, EVAC.life);
    setRtNum(p, `evac.acc.${info.idx}`, 0);
    setRtNum(p, `evac.rate.${info.idx}`, rewardParam(p, 'evac', 'rate', 'sum') + gearVal(p, info.idx, 'a_evac'));
    setRtNum(p, `evac.cd.${info.idx}`, rewardParam(p, 'evac', 'cd', 'max'));
    proc(w, p, info.idx, 'evac', info.pos);
  },
  cooldownOnLeave(_w, p, idx, cd) {
    const cut = rtNum(p, `evac.cd.${idx}`);
    if (!(cut > 0)) return;
    cd.flat += cut;
    setRtNum(p, `evac.cd.${idx}`, 0);
  },
  tick(w, p, dt) {
    if (!rewardCount(p, 'evac')) return;
    p.party.forEach((m, idx) => {
      let left = rtNum(p, `evac.left.${idx}`);
      if (!(left > 1e-9)) return;
      if (idx === p.activeIndex || m.dead) {
        setRtNum(p, `evac.left.${idx}`, 0);
        return;
      }
      let acc = rtNum(p, `evac.acc.${idx}`) + dt;
      const rate = rtNum(p, `evac.rate.${idx}`);
      while (acc >= PULSE_INTERVAL - 1e-9 && left > 1e-9) {
        acc -= PULSE_INTERVAL;
        left -= PULSE_INTERVAL;
        healMember(w, p, idx, rate * PULSE_INTERVAL * m.maxHp);
      }
      setRtNum(p, `evac.acc.${idx}`, acc);
      setRtNum(p, `evac.left.${idx}`, Math.max(0, left));
    });
  },
};

/** 마지막 인사 (farewell): the leaver's normal skill once at the leave spot (no cooldown used), per character every 6 s. */
const FAREWELL_RANGE = 6;

const farewell: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'farewell')) return;
    const skill = getCharacter(p.party[info.idx].defId).normal;
    const actions = recastActions(skill.actions);
    if (!actions.length) return;
    const target = nearestEnemies(w, info.pos, 1, skill.castRange ?? FAREWELL_RANGE)[0];
    if (!target) return;
    if (!icdReady(w, p, `farewell.${info.idx}`, rewardParam(p, 'farewell', 'icd', 'max'))) return;
    const ctx: CastCtx = { ...rewardCtx(info.ctx, 'farewell', info.pos), targetId: target.id, targetPos: copy(target.pos) };
    castSkill(w, ctx, actions, { noDash: true });
    proc(w, p, info.idx, 'farewell', info.pos);
  },
};

/** 검은 안개 (fog): a fog circle at the leave spot: enemies inside slowed 40 % and attack down. */
const FOG = { tick: 0.5, hold: 0.6, slow: 0.4, atkDownMax: 0.5 };

const fog: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'fog')) return;
    const r = rewardParam(p, 'fog', 'radius', 'max') * leaveRadius(p);
    const life = rewardParam(p, 'fog', 'life', 'max') + linger(p);
    const down = Math.min(FOG.atkDownMax, rewardParam(p, 'fog', 'atkDown', 'sum'));
    zoneAt(w, p, rewardCtx(info.ctx, 'fog', info.pos), r, life, FOG.tick, 'enemies', [
      { kind: 'status', status: 'slow', duration: FOG.hold, value: FOG.slow },
      { kind: 'status', status: 'atkDown', duration: FOG.hold, value: down },
    ]);
    proc(w, p, info.idx, 'fog', info.pos);
  },
};

/** 물러서! (shove): push enemies around the leave spot (rare: + stun 0.4 s, same enemy once per 5 s). */
const SHOVE = { radius: 3, icd: 5 };

const shove: RewardHooks = {
  onLeave(w, p, info) {
    if (!rewardCount(p, 'shove')) return;
    const r = SHOVE.radius * leaveRadius(p);
    const push = rewardParam(p, 'shove', 'push', 'max');
    const stun = rewardParam(p, 'shove', 'stun', 'max');
    const ctx = rewardCtx(info.ctx, 'shove', info.pos);
    blast(w, ctx, info.pos, r, 0);
    const list = enemiesNear(w, info.pos, r);
    for (const t of list) {
      displaceUnit(w, t, info.pos, push, true);
      if (stun > 0 && !isBossy(t) && enemyReady(w, p, 'shove', t, SHOVE.icd)) hostile(w, p, ctx, t, 'stun', stun, 0);
    }
    if (list.length) proc(w, p, info.idx, 'shove', info.pos);
  },
};

// ─────────────────────────── 직업 특기 ───────────────────────────

/** 탱커: 육중한 착지 (appear) / 버려진 방패 (leave zone) / 짚 인형 (leave decoy; damage it takes → next appear shield). */
const roleTank: RewardHooks = {
  onAppear(w, p, info) {
    if (roleOf(p, info.idx) !== 'tank') return;
    const { level, k } = roleK(p, 'tank');
    if (level < 1) return;
    const T = ROLE_NUM.tank;
    const r = T.pushRadius * appearRadius(p);
    blast(w, rewardCtx(charCtx(w, info.e, 'passive', null), 'role', info.at), info.at, r, 0);
    for (const t of enemiesNear(w, info.at, r)) displaceUnit(w, t, info.at, T.push * k, true);
    guardAdd(w, info.e, T.guard * k, T.guardDur);
    const stored = rtNum(p, `straw.store.${info.idx}`);
    if (stored > 0) {
      addShield(info.e, Math.min(stored, T.storeCap * info.e.maxHp), T.decoyDur, w);
      setRtNum(p, `straw.store.${info.idx}`, 0);
    }
    proc(w, p, info.idx, 'role', info.at);
  },
  onLeave(w, p, info) {
    if (roleOf(p, info.idx) !== 'tank') return;
    const { level, k } = roleK(p, 'tank');
    if (level < 2) return;
    const T = ROLE_NUM.tank;
    const gl = gearLv(p, info.idx, 'a_drop_shield');
    const r = Math.max(T.zoneRadius, gl ? optionParam('a_drop_shield', 'radius', gl) : 0) * leaveRadius(p);
    const z = zoneAt(w, p, rewardCtx(info.ctx, 'role', info.pos), r, T.zoneDur + linger(p), PULSE_INTERVAL, 'allies', []);
    if (z) guardZone(p, z.id, T.zoneGuard * k + gearVal(p, info.idx, 'a_drop_shield'));
    if (level >= 3) {
      const doll = spawnDecoy(w, p, info.pos, { hp: T.decoyHp * k * info.entity.maxHp, duration: T.decoyDur + linger(p), tauntRadius: T.decoyTaunt });
      if (doll) {
        setRtNum(p, `straw.id.${info.idx}`, doll.id);
        setRtNum(p, `straw.hp.${info.idx}`, doll.hp);
        setRtNum(p, `straw.k.${info.idx}`, k);
      }
    }
    proc(w, p, info.idx, 'role', info.pos);
  },
  tick(w, p) {
    for (const key of rtKeys(p, 'straw.id.')) {
      const idx = key.slice('straw.id.'.length);
      const doll = w.byId.get(rtNum(p, key));
      const last = rtNum(p, `straw.hp.${idx}`);
      const hp = doll ? Math.max(0, doll.hp) : 0;
      const lost = doll ? last - hp : 0;
      if (lost > 0) setRtNum(p, `straw.store.${idx}`, rtNum(p, `straw.store.${idx}`) + lost * ROLE_NUM.tank.store * rtNum(p, `straw.k.${idx}`, 1));
      setRtNum(p, `straw.hp.${idx}`, hp);
      if (!doll || doll.rt.gone || doll.hp <= 0) delete p.rt.reward![key];
    }
  },
};

/** 근접딜러: 착지 참격 (after the drag's last part, a band toward the nearest enemy) / 처형 착지 (normal enemies at low HP die). */
const roleMelee: RewardHooks = {
  onDragEnd(w, p, idx, at, drag) {
    if (roleOf(p, idx) !== 'melee') return;
    const { level, k } = roleK(p, 'melee');
    if (level < 1) return;
    const M = ROLE_NUM.melee;
    const t = nearestEnemies(w, at, 1, M.slashLen * 1.5)[0];
    if (!t) return;
    const d = dist(at, t.pos);
    const u = d > 1e-6 ? { x: (t.pos.x - at.x) / d, y: (t.pos.y - at.y) / d } : { x: 1, y: 0 };
    const to = { x: at.x + u.x * M.slashLen, y: at.y + u.y * M.slashLen };
    const power = (level >= 3 ? M.slash3 : M.slash) * k * appearPower(p);
    lineHit(w, rewardCtx(drag, 'role', at), at, to, M.slashWidth * appearRadius(p), M.slashLen, power);
    proc(w, p, idx, 'role', at);
  },
  onLand(w, p, info, drag) {
    if (roleOf(p, info.idx) !== 'melee') return;
    const { level, k } = roleK(p, 'melee');
    if (level < 2) return;
    const M = ROLE_NUM.melee;
    const gl = gearLv(p, info.idx, 'w_execute');
    const frac = (level >= 3 ? M.exec3 : M.exec) * k + gearVal(p, info.idx, 'w_execute');
    const r = Math.max(M.execRadius, gl ? optionParam('w_execute', 'radius', gl) : 0) * appearRadius(p);
    const ctx = rewardCtx(drag, 'role', info.at);
    let n = 0;
    for (const t of enemiesNear(w, info.at, r)) {
      if (t.tier !== 'normal' || t.eventTag || t.kind !== 'monster' || t.hp > frac * t.maxHp) continue;
      killEntity(w, t, ctx);
      n++;
    }
    if (n) proc(w, p, info.idx, 'role', info.at, '처형');
  },
};

/** 원거리딜러: 치고 빠지기 (dodge the next hit + move speed, 3 s) / 두고 간 포탑 (leave) / 갈래 사격 (drag recast left / right). */
const roleRanged: RewardHooks = {
  onAppear(w, p, info) {
    if (roleOf(p, info.idx) !== 'ranged') return;
    const { level } = roleK(p, 'ranged');
    if (level < 1) return;
    setRtNum(p, 'dodge.id', info.e.id);
    setRtNum(p, 'dodge.until', w.state.time + ROLE_NUM.ranged.dodgeDur);
    setRtNum(p, 'dodge.move', w.state.time + ROLE_NUM.ranged.dodgeDur);
    proc(w, p, info.idx, 'role', info.at);
  },
  statMods(w, e, p, into) {
    if (e.id !== rtNum(p, 'dodge.id', -1) || w.state.time >= rtNum(p, 'dodge.move')) return;
    into.moveSpeedPct += ROLE_NUM.ranged.move * roleK(p, 'ranged').k;
  },
  takenMult(w, target, p, acc) {
    if (target.id !== rtNum(p, 'dodge.id', -1) || w.state.time >= rtNum(p, 'dodge.until') - 1e-9) return;
    acc.mult = 0;
    setRtNum(p, 'dodge.until', 0);
    proc(w, p, target.partyIndex, 'role', target.pos, '회피');
  },
  onLeave(w, p, info) {
    if (roleOf(p, info.idx) !== 'ranged') return;
    const { level, k } = roleK(p, 'ranged');
    if (level < 2) return;
    const R = ROLE_NUM.ranged;
    spawnShooter(w, p, 'turret', info.pos, { duration: R.turretDur + linger(p), interval: R.turretInterval, range: R.turretRange, amount: R.turret * k, atk: info.ctx.atk });
    proc(w, p, info.idx, 'role', info.pos);
  },
  onLand(w, p, info, drag) {
    if (roleOf(p, info.idx) !== 'ranged') return;
    const { level, k } = roleK(p, 'ranged');
    if (level < 3) return;
    const R = ROLE_NUM.ranged;
    scheduleReward(w, p, 'role.fork', R.forkDelay, { idx: info.idx }, info.at, recastCtx(drag, info.at, R.fork * k * appearPower(p)));
  },
  onDelay(w, p, pd) {
    if (pd.tag !== 'role.fork' || !pd.ctx || !pd.pos) return;
    const m = p.party[pd.data.idx];
    if (!m) return;
    for (const dx of [-ROLE_NUM.ranged.forkSide, ROLE_NUM.ranged.forkSide]) {
      const at = clampToArena(w, { x: pd.pos.x + dx, y: pd.pos.y });
      recastDrag(w, { ...pd.ctx, point: at, origin: copy(at) }, m.defId);
    }
    proc(w, p, pd.data.idx, 'role', pd.pos);
  },
};

/** 힐러: 응급 착지 (heal the most wounded member, revive −3 s) / 치유의 잔향 (leave heal zone) / 두 갈래 손길 (drag again). */
const roleHealer: RewardHooks = {
  onAppear(w, p, info) {
    if (roleOf(p, info.idx) !== 'healer') return;
    const { level, k } = roleK(p, 'healer');
    if (level < 1) return;
    const H = ROLE_NUM.healer;
    const low = mostWoundedMember(w, p);
    if (low != null) healMember(w, p, low, H.heal * k * p.party[low].maxHp);
    if (p.party.some(m => m.dead)) reduceRevive(w, p, H.revive * k, p.id);
    proc(w, p, info.idx, 'role', info.at);
  },
  onLeave(w, p, info) {
    if (roleOf(p, info.idx) !== 'healer') return;
    const { level, k } = roleK(p, 'healer');
    if (level < 2) return;
    const H = ROLE_NUM.healer;
    const gl = gearLv(p, info.idx, 'a_heal_echo');
    const r = Math.max(H.zoneRadius, gl ? optionParam('a_heal_echo', 'radius', gl) : 0) * leaveRadius(p);
    const rate = (level >= 3 ? H.zoneHeal3 : H.zoneHeal) * k + gearVal(p, info.idx, 'a_heal_echo');
    const z = zoneAt(w, p, rewardCtx(info.ctx, 'role', info.pos), r, H.zoneDur + linger(p), 1, 'allies', [{ kind: 'heal', amount: rate }]);
    if (z && level >= 3) guardZone(p, z.id, H.zoneGuard * k);
    proc(w, p, info.idx, 'role', info.pos);
  },
  onLand(w, p, info, drag) {
    if (roleOf(p, info.idx) !== 'healer') return;
    const { level, k } = roleK(p, 'healer');
    if (level < 3) return;
    const ally = mostWoundedAlly(w, info.e);
    if (!ally) return;
    const ctx = { ...recastCtx(drag, ally.pos, ROLE_NUM.healer.twin * k), allyTargetId: ally.id };
    recastDrag(w, ctx, p.party[info.idx].defId);
    proc(w, p, info.idx, 'role', ally.pos);
  },
};

/** The living member with the lowest HP share below full (field or bench); ties: lower slot. */
function mostWoundedMember(w: World, p: SimPlayer): number | null {
  let best: number | null = null;
  let bf = 1 - 1e-9;
  p.party.forEach((m, idx) => {
    if (m.dead) return;
    const e = getEntity(w, m.entityId);
    const f = e ? e.hp / Math.max(1, e.maxHp) : m.hp / Math.max(1, m.maxHp);
    if (f < bf) {
      bf = f;
      best = idx;
    }
  });
  return best;
}

/** Any player's field character below full HP with the lowest share (not `self`); ties: lower id. */
function mostWoundedAlly(w: World, self: SimEntity): SimEntity | null {
  let best: SimEntity | null = null;
  let bf = 1 - 1e-9;
  for (const e of w.state.entities) {
    if (e === self || e.team !== 'ally' || e.kind !== 'character' || !isAlive(e)) continue;
    const f = e.hp / Math.max(1, e.maxHp);
    if (f < bf - 1e-12 || (Math.abs(f - bf) <= 1e-12 && best && e.id < best.id)) {
      bf = f;
      best = e;
    }
  }
  return best;
}

/** 서포터: 다음 타자 (leaving support → the next one is buffed) / 응원가 (appear: team buff r 4) / 대기석 응원단 (bench). */
const roleSupport: RewardHooks = {
  onAppear(w, p, info) {
    const S = ROLE_NUM.support;
    if (info.leave && getCharacter(info.leave.defId).role === 'support') {
      const { level, k } = roleK(p, 'support');
      if (level >= 1) {
        applyStatus(info.e, 'atkUp', S.buffDur, S.atk * k, p.id, 'relic');
        applyStatus(info.e, 'haste', S.buffDur, S.haste * k, p.id, 'relic');
        proc(w, p, info.idx, 'role', info.at);
      }
    }
    if (roleOf(p, info.idx) !== 'support') return;
    const { level, k } = roleK(p, 'support');
    if (level < 2) return;
    for (const a of alliesNear(w, info.at, S.cheerRadius * appearRadius(p))) {
      applyStatus(a, 'atkUp', S.buffDur, S.cheer * k, p.id, 'relic');
      applyStatus(a, 'haste', S.buffDur, S.cheer * k, p.id, 'relic');
    }
    proc(w, p, info.idx, 'role', info.at);
  },
  statMods(_w, e, p, into) {
    const { level, k } = roleK(p, 'support');
    if (level < 3) return;
    let n = 0;
    p.party.forEach((m, idx) => {
      if (idx !== e.partyIndex && !m.dead && getCharacter(m.defId).role === 'support') n++;
    });
    into.atkPct += n * ROLE_NUM.support.bench * k;
  },
};

// ─────────────────────────── 교대 연계·편성 ───────────────────────────

/** 바통 터치 (baton): the leaver's whitelisted buffs pass to the incoming character, +2 / +3 s (twice +1 s). */
const BATON_STATUSES: ReadonlySet<StatusId> = new Set<StatusId>(['atkUp', 'haste', 'defUp', 'regen', 'lifesteal', 'splashUp']);

const baton: RewardHooks = {
  onAppear(w, p, info) {
    const n = rewardCount(p, 'baton');
    if (!n || !info.leave) return;
    const extra = rewardParam(p, 'baton', 'extra', 'max') + (n - 1);
    let passed = 0;
    for (const s of p.party[info.leave.idx].statuses) {
      if (!BATON_STATUSES.has(s.id) || !(s.remaining > 0)) continue;
      if (applyStatus(info.e, s.id, s.remaining + extra, s.value, p.id, 'relic')) passed++;
    }
    if (passed) proc(w, p, info.idx, 'baton', info.at);
  },
};

/** 연쇄 교대 (combo): a swap within 5 s of the previous one → +1 stack (max 3), drag + per stack; 5 s idle → 0. */
const COMBO = { gap: 5, max: 3 };

const combo: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!rewardCount(p, 'combo') || info.forced) return;
    const now = w.state.time;
    const chained = now - rtNum(p, 'combo.last', -Infinity) <= COMBO.gap + 1e-9;
    const stacks = chained ? Math.min(COMBO.max, rtNum(p, 'combo.stacks') + 1) : 0;
    setRtNum(p, 'combo.stacks', stacks);
    setRtNum(p, 'combo.last', now);
    if (stacks <= 0) return;
    boostDrag(mods, 1 + stacks * rewardParam(p, 'combo', 'per', 'sum'));
    proc(w, p, info.idx, 'combo', info.at, `연쇄 ×${stacks}`);
  },
};

/** 인수인계 (handover): swapping to a different role blesses the incoming one with the leaver's role for 6 s. */
const HANDOVER = { tank: 0.2, melee: 0.2, ranged: 0.15, healer: 0.02, support: 0.15 };

const handover: RewardHooks = {
  onAppear(w, p, info) {
    if (!info.leave || !rewardCount(p, 'handover')) return;
    const from = getCharacter(info.leave.defId).role;
    if (from === roleOf(p, info.idx)) return;
    const life = rewardParam(p, 'handover', 'life', 'max');
    const e = info.e;
    if (from === 'tank') guardAdd(w, e, HANDOVER.tank, life);
    else if (from === 'melee') applyStatus(e, 'haste', life, HANDOVER.melee, p.id, 'relic');
    else if (from === 'healer') applyStatus(e, 'regen', life, HANDOVER.healer, p.id, 'relic');
    else if (from === 'support') applyStatus(e, 'atkUp', life, HANDOVER.support, p.id, 'relic');
    else {
      setRtNum(p, 'handover.id', e.id);
      setRtNum(p, 'handover.until', w.state.time + life);
    }
    proc(w, p, info.idx, 'handover', info.at);
  },
  statMods(w, e, p, into) {
    if (e.id === rtNum(p, 'handover.id', -1) && w.state.time < rtNum(p, 'handover.until')) into.critChance += HANDOVER.ranged;
  },
};

/** 엄호 교대 (cover_swap): tank out → melee / ranged in: drag +40 %, guard 25 % for 3 s. */
const coverSwap: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!info.leave || !rewardCount(p, 'cover_swap')) return;
    const r = roleOf(p, info.idx);
    if (getCharacter(info.leave.defId).role !== 'tank' || (r !== 'melee' && r !== 'ranged')) return;
    boostDrag(mods, 1 + rewardParam(p, 'cover_swap', 'power', 'sum'));
    guardAdd(w, info.e, rewardParam(p, 'cover_swap', 'guard', 'max'), rewardParam(p, 'cover_swap', 'life', 'max'));
    proc(w, p, info.idx, 'cover_swap', info.at);
  },
};

/** 뒷수습 (aftercare): dealer out → healer in: that drag's overflow heal turns into a shield (6 s, ≤ 30 % max HP). */
const AFTERCARE = { window: 3, life: 6, cap: 0.3 };

const aftercare: RewardHooks = {
  onAppear(w, p, info) {
    if (!info.leave || !rewardCount(p, 'aftercare') || roleOf(p, info.idx) !== 'healer') return;
    const from = getCharacter(info.leave.defId).role;
    if (from !== 'melee' && from !== 'ranged') return;
    setRtNum(p, 'aftercare.id', info.e.id);
    setRtNum(p, 'aftercare.until', w.state.time + AFTERCARE.window);
  },
  onHealOverflow(w, p, e, amount, ctx) {
    if (!ctx.isDrag || ctx.casterId !== rtNum(p, 'aftercare.id', -1) || w.state.time > rtNum(p, 'aftercare.until')) return;
    const room = AFTERCARE.cap * e.maxHp - e.shield;
    const add = Math.min(room, amount * rewardParam(p, 'aftercare', 'frac', 'sum'));
    if (!(add > 0)) return;
    addShield(e, add, AFTERCARE.life, w);
    proc(w, p, ctx.partyIndex, 'aftercare', e.pos);
  },
};

/** 릴레이 3연타 (relay3): all 3 members appeared within 6 s → shockwave at the 3rd drop + incoming ult (ICD 15 s). */
const RELAY3_GAP = 6;

const relay3: RewardHooks = {
  onLand(w, p, info, drag) {
    if (!rewardCount(p, 'relay3')) return;
    const now = w.state.time;
    setRtNum(p, `relay3.t.${info.idx}`, now);
    if (!p.party.every((_m, i) => now - rtNum(p, `relay3.t.${i}`, -Infinity) <= RELAY3_GAP + 1e-9)) return;
    if (!icdReady(w, p, 'relay3.icd', rewardParam(p, 'relay3', 'icd', 'max'))) return;
    blast(w, rewardCtx(drag, 'relay3', info.at), info.at, rewardParam(p, 'relay3', 'radius', 'max'), rewardParam(p, 'relay3', 'power', 'sum'));
    addUltCharge(w, p, rewardParam(p, 'relay3', 'ult', 'max'));
    proc(w, p, info.idx, 'relay3', info.at, '3연타!');
  },
};

/** 동업자 (partners): a role with 2 members appears → the same-role mates' cooldown −2 s, its drag +15 %. */
const partners: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!rewardCount(p, 'partners')) return;
    const role = roleOf(p, info.idx);
    const mates = p.party.map((m, i) => ({ m, i })).filter(x => x.i !== info.idx && !x.m.dead && getCharacter(x.m.defId).role === role);
    if (!mates.length) return;
    const cut = rewardParam(p, 'partners', 'cd', 'max');
    for (const { m } of mates) m.swapCooldownRemaining = Math.max(0, m.swapCooldownRemaining - cut);
    boostDrag(mods, 1 + rewardParam(p, 'partners', 'power', 'sum'));
    proc(w, p, info.idx, 'partners', info.at);
  },
};

/** 삼색 파티 (tricolor): attack / max HP +5 % (a stat reward), +2 % ult to the incoming character per swap. */
const tricolor: RewardHooks = {
  onAppear(w, p) {
    if (!rewardCount(p, 'tricolor')) return;
    addUltCharge(w, p, rewardParam(p, 'tricolor', 'ult', 'max'));
  },
};

// ─────────────────────────── Set bonuses / upkeep ───────────────────────────

/** #등장 set: appear invulnerability +0.3 s on every swap. Zone guards, per-enemy cooldown keys. */
const upkeep: RewardHooks = {
  onAppear(_w, p, _info, mods) {
    if (tagActive(p, 'appear')) mods.invulnAdd += TAG_BONUS.appear.invuln;
  },
  tick(w, p) {
    for (const key of rtKeys(p, 'zg.')) {
      const id = Number(key.slice(3));
      const z = w.state.zones.find(x => x.id === id);
      if (!z) {
        delete p.rt.reward![key];
        continue;
      }
      for (const a of alliesNear(w, z.center, z.radius)) holdGuard(w, a, key, rtNum(p, key));
    }
  },
  onFloorStart(_w, p) {
    for (const key of rtKeys(p, '')) if (/\.e\d+$/.test(key) || key.startsWith('zg.') || key.startsWith('straw.id.')) delete p.rt.reward![key];
  },
};

export const SWAP_HOOKS: RewardHooks = hookGroup(
  upkeep,
  // appear / land
  bolt,
  startle,
  beckon,
  scorch,
  relayLine,
  inplace,
  prompt,
  rested,
  talisman,
  doppel,
  // leave
  relayBlast,
  shade,
  mine,
  evac,
  farewell,
  fog,
  shove,
  // role
  roleTank,
  roleMelee,
  roleRanged,
  roleHealer,
  roleSupport,
  // swap links
  baton,
  combo,
  handover,
  coverSwap,
  aftercare,
  relay3,
  partners,
  tricolor,
);

/**
 * 교대 폭발 owned together with the classic relic 교대의 깃발: one blast, the flag's power ×1.5 and radius +0.5
 * (players.ts relayExplosion). Without 교대 폭발: unchanged.
 */
export function relayFlagBoost(p: SimPlayer): { amountMult: number; radiusAdd: number } {
  return rewardCount(p, 'relay_blast') ? { ...RELAY_FLAG_BOOST } : { amountMult: 1, radiusAdd: 0 };
}

/** 원정 gear effects a floor reward takes over for member idx (one proc; the reward adds the gear's power). */
export function rewardTakesOver(p: SimPlayer, idx: number, optionId: string): boolean {
  switch (optionId) {
    case 'w_appear_bolt':
      return rewardCount(p, 'bolt') > 0;
    case 'w_relay_blast':
    case 'relay_flag':
      return rewardCount(p, 'relay_blast') > 0;
    case 'w_scorch':
      return rewardCount(p, 'scorch') > 0;
    case 'a_evac':
      return rewardCount(p, 'evac') > 0;
    case 'c_rested_rage':
      return rewardCount(p, 'rested') > 0;
    case 'w_execute':
      return roleOf(p, idx) === 'melee' && roleLevel(p, 'melee').level >= 2;
    case 'a_heal_echo':
      return roleOf(p, idx) === 'healer' && roleLevel(p, 'healer').level >= 2;
    case 'a_drop_shield':
      return roleOf(p, idx) === 'tank' && roleLevel(p, 'tank').level >= 2;
    default:
      return false;
  }
}
