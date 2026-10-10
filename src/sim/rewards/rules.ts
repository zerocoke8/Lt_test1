// 기획 17차 Track C reward group — 규칙 변경·성장 + 저주·도박 + 협동 + 경제 (docs/floor-rewards.md; data:
// src/data/rewards/rules.ts). One small hook object per family, joined with hookGroup at the bottom; each hook reads its
// own family through query.ts. Extra hits go through fx.ts reward contexts (no groggy, 'relic' damage). The three set
// bonuses this track owns: #저주 (HP costs halved — fx.hpCost / plainCost here), #협동 (statMods), #성장 (onFloorStart).
// Coop rules: bots count as other players; players who are out are left out. Run counters live in p.rewardState
// (whitelisted keys), runtime numbers in p.rt.reward ('<family>.<what>').

import type { PlayerState, Role, Vec2 } from '../../types';
import { TAG_BONUS, getCharacter } from '../../data';
import {
  CANDLES_KILLS,
  CANDLES_MAX,
  DEBT_SKIPS,
  NAILS_MAX,
  RULES_NUM,
  UNDERSTUDY_TWICE,
  WINDOW_FIRE_EVERY,
} from '../../data/rewards/rules';
import { heal } from '../combat';
import { charCtx } from '../ctx';
import { applyStatus } from '../status';
import { addUltCharge } from '../ultMode';
import { activeEntity, aliveEnemiesOf, copy, dist, emit, getEntity, isAlive, type SimEntity, type SimMember, type SimPlayer, type World } from '../world';
import {
  addRewardGroggy,
  blast,
  fireBolt,
  forceSwap,
  hpCost,
  icdReady,
  memberCtx,
  nearestEnemies,
  proc,
  rewardCtx,
  rewardShield,
  rtNum,
  scheduleReward,
  setRtNum,
  setStateNum,
  stateNum,
} from './fx';
import { rwGaugeCap } from './hooks';
import { drawFamilyReward, grantReward } from './offers';
import { familyRewards, rewardCount, rewardParam, tagActive } from './query';
import { hookGroup, type AppearInfo, type RewardHooks } from './types';

// ─────────────────────────── Helpers ───────────────────────────

const has = (p: PlayerState, fam: string): boolean => rewardCount(p, fam) > 0;
const sum = (p: PlayerState, fam: string, key: string): number => rewardParam(p, fam, key, 'sum');
const max = (p: PlayerState, fam: string, key: string): number => rewardParam(p, fam, key, 'max');

function roleOf(p: PlayerState, idx: number | null | undefined): Role | null {
  const m = idx != null ? p.party[idx] : undefined;
  return m ? getCharacter(m.defId).role : null;
}

/** Other players still in the run (bots count) — the coop families' partners. */
function others(w: World, p: SimPlayer): SimPlayer[] {
  return w.state.players.filter(q => q.id !== p.id && !q.out);
}

/** Sim time the current floor started (floorTime resets per floor). */
function floorStartTime(w: World): number {
  return w.state.time - w.state.floorTime;
}

/** p's party heals its bench (메딕 in it, or 응급 후송 owned) — fx.hpCost doubles costs then. */
function benchHeals(p: SimPlayer): boolean {
  return p.party.some(m => !!getCharacter(m.defId).passive.benchRegen) || has(p, 'evac');
}

/**
 * An HP cost that does NOT double with bench healing (굶주린 펫, 영혼 담보 대출, 피의 서약 — the doc names only 서두르는
 * 대가 / 피의 등장 for that): fx.hpCost with the doubling taken back out (the #저주 halving and the 1-HP floor stay).
 */
function plainCost(w: World, p: SimPlayer, target: SimEntity | SimMember, frac: number, current = false): number {
  return hpCost(w, p, target, benchHeals(p) ? frac / 2 : frac, { current });
}

/** One member's own ult gauge + delta (up to the reward gauge cap), like ultMode's setGauge. */
function addMemberUlt(w: World, p: SimPlayer, idx: number, delta: number): void {
  const g = p.party[idx]?.ult;
  if (!g || !(delta > 0)) return;
  const cap = rwGaugeCap(p);
  const v = g.charge + delta;
  g.charge = v > 1 - 1e-9 ? Math.max(1, Math.min(cap, v)) : v;
  if (g.charge >= 1 && g.fullSince == null) {
    g.fullSince = w.state.time;
    emit(w, { type: 'ultReady', player: p.id, partyIndex: idx });
  }
}

/** A reward context of p's field character (null: nobody on the field). */
function fieldCtx(w: World, p: SimPlayer, key: string, at: Vec2) {
  const e = activeEntity(w, p);
  return e ? rewardCtx(charCtx(w, e, 'passive', null), key, at) : null;
}

/** Living party members of p. */
function living(p: PlayerState): number {
  return p.party.filter(m => !m.dead).length;
}

// ─────────────────────────── 규칙 변경·성장 ───────────────────────────

/** The member double_load is bound to (null: not owned). */
function doubleLoadIdx(p: PlayerState): number | null {
  return familyRewards(p, 'double_load')[0]?.partyIndex ?? null;
}

/**
 * 이중 장전: the bound card holds 2 charges (PartyMember.dragCharges). Coming in spends one; with one left it may come in
 * while its cooldown runs; a cooldown finishing on the bench refills one (and restarts while not full). Its cooldown
 * +30 %.
 */
const doubleLoad: RewardHooks = {
  canSwap(ps, idx) {
    if (doubleLoadIdx(ps) !== idx) return null;
    return (ps.party[idx]?.dragCharges ?? 0) >= 1 ? 'allow' : null;
  },
  onGrant(_w, p, applied, def) {
    if (def.family !== 'double_load' || applied.partyIndex == null) return;
    const m = p.party[applied.partyIndex];
    if (m) m.dragCharges = def.params.charges ?? 2;
  },
  onAppear(w, p, info) {
    if (doubleLoadIdx(p) !== info.idx) return;
    const m = p.party[info.idx];
    m.dragCharges = Math.max(0, (m.dragCharges ?? 0) - 1);
    if (info.cooling > 0) proc(w, p, info.idx, 'double_load', info.at, '장전!');
  },
  cooldownOnLeave(_w, p, idx, cd) {
    if (doubleLoadIdx(p) === idx) cd.mult *= 1 + max(p, 'double_load', 'cdPct');
  },
  tick(_w, p) {
    const idx = doubleLoadIdx(p);
    if (idx == null) return;
    const m = p.party[idx];
    if (!m) return;
    const prev = rtNum(p, 'double_load.prev');
    if (idx !== p.activeIndex && !m.dead && prev > 0 && m.swapCooldownRemaining <= 0) {
      const full = max(p, 'double_load', 'charges') || 2;
      m.dragCharges = Math.min(full, (m.dragCharges ?? 0) + 1);
      if (m.dragCharges < full && m.swapCooldownTotal > 0) m.swapCooldownRemaining = m.swapCooldownTotal;
    }
    setRtNum(p, 'double_load.prev', m.swapCooldownRemaining);
  },
};

function understudyUses(p: PlayerState): number {
  const n = rewardCount(p, 'understudy');
  return n >= 2 ? UNDERSTUDY_TWICE : n > 0 ? max(p, 'understudy', 'uses') : 0;
}

/** The living bench card with the shortest cooldown (ties: lower slot). */
function shortestBench(p: SimPlayer, not: number): number | null {
  let best: number | null = null;
  p.party.forEach((m, i) => {
    if (i === not || i === p.activeIndex || m.dead) return;
    if (best == null || m.swapCooldownRemaining < p.party[best].swapCooldownRemaining - 1e-9) best = i;
  });
  return best;
}

/** 빈자리의 대타: the field character falls → the shortest-cooldown bench card takes its spot at once (2 / floor). */
const understudy: RewardHooks = {
  onGrant(_w, p, _a, def) {
    if (def.family === 'understudy') setStateNum(p, 'understudyLeft', understudyUses(p));
  },
  onFloorStart(_w, p) {
    if (has(p, 'understudy')) setStateNum(p, 'understudyLeft', understudyUses(p));
  },
  onCharacterDeath(w, p, idx, wasField) {
    if (!wasField || !has(p, 'understudy') || stateNum(p, 'understudyLeft') <= 0) return;
    if (shortestBench(p, idx) == null) return;
    const body = w.state.entities.find(e => e.kind === 'character' && e.ownerPlayer === p.id && e.partyIndex === idx);
    scheduleReward(w, p, 'understudy', 0, { died: idx }, body ? body.pos : { x: 0, y: 0 });
  },
  onDelay(w, p, pd) {
    if (pd.tag !== 'understudy' || p.out || p.activeIndex != null || stateNum(p, 'understudyLeft') <= 0) return;
    const idx = shortestBench(p, pd.data.died ?? -1);
    if (idx == null) return;
    const at = pd.pos ?? { x: 0, y: 0 };
    if (!forceSwap(w, p, idx, at)) return;
    setStateNum(p, 'understudyLeft', stateNum(p, 'understudyLeft') - 1);
    proc(w, p, idx, 'understudy', at, '대타!');
  },
};

/** 출근 도장: the first 2 / 3 swaps of a floor put no cooldown on the leaver. */
const punchIn: RewardHooks = {
  onGrant(_w, p, _a, def) {
    if (def.family === 'punch_in') setStateNum(p, 'punchInLeft', max(p, 'punch_in', 'swaps'));
  },
  onFloorStart(_w, p) {
    if (has(p, 'punch_in')) setStateNum(p, 'punchInLeft', max(p, 'punch_in', 'swaps'));
  },
  onLeave(w, p, info) {
    if (!has(p, 'punch_in') || stateNum(p, 'punchInLeft') <= 0) return;
    setStateNum(p, 'punchInLeft', stateNum(p, 'punchInLeft') - 1);
    setRtNum(p, 'punch_in.zero', 1);
    proc(w, p, info.idx, 'punch_in', info.pos, '출근!');
  },
  cooldownOnLeave(_w, p, _idx, cd) {
    if (rtNum(p, 'punch_in.zero') > 0) {
      cd.zero = true;
      setRtNum(p, 'punch_in.zero', 0);
    }
  },
};

/** 창문 너머 지원사격: every 5 s, one bolt per living bench card from the field character (that card's attack × %). */
const windowFire: RewardHooks = {
  onFloorStart(_w, p) {
    setRtNum(p, 'window_fire.t', 0);
  },
  tick(w, p, dt) {
    if (!has(p, 'window_fire')) return;
    const e = activeEntity(w, p);
    if (!e) return; // the field is empty: the timer waits
    const t = rtNum(p, 'window_fire.t') + dt;
    if (t < WINDOW_FIRE_EVERY - 1e-9) {
      setRtNum(p, 'window_fire.t', t);
      return;
    }
    setRtNum(p, 'window_fire.t', t - WINDOW_FIRE_EVERY);
    const target = nearestEnemies(w, e.pos, 1)[0];
    if (!target) return;
    const power = sum(p, 'window_fire', 'power');
    let shots = 0;
    p.party.forEach((m, idx) => {
      if (idx === p.activeIndex || m.dead) return;
      fireBolt(w, memberCtx(w, p, idx, 'window_fire', e.pos), e.pos, target, power, '#4cc9f0');
      shots++;
    });
    // a continuous effect: the head pill only on the first volley of a floor
    if (shots > 0 && rtNum(p, 'window_fire.shown', -1) < floorStartTime(w)) {
      setRtNum(p, 'window_fire.shown', w.state.time);
      proc(w, p, p.activeIndex, 'window_fire', e.pos);
    }
  },
};

/** 자라는 손톱 (nails): every floor / stage start after picking, attack +2 / +3 % (rewardState.nails, max 30). */
const nails: RewardHooks = {
  onFloorStart(w, p) {
    if (!has(p, 'nails')) return;
    const before = stateNum(p, 'nails');
    const next = Math.min(NAILS_MAX, before + sum(p, 'nails', 'pct'));
    if (next === before) return;
    setStateNum(p, 'nails', next);
    const e = activeEntity(w, p);
    if (e) proc(w, p, p.activeIndex, 'nails', e.pos, `+${next - before}%`);
  },
  statMods(_w, _e, p, into) {
    const n = stateNum(p, 'nails');
    if (n > 0 && has(p, 'nails')) into.atkPct += n / 100;
  },
};

/** 백 개의 촛불: every 40 team kills after picking, crit +1 % for the run (max +10 %). */
const candles: RewardHooks = {
  onKill(w, p) {
    if (!has(p, 'candles')) return;
    const kills = Math.min(100000, stateNum(p, 'candlesKills') + 1);
    setStateNum(p, 'candlesKills', kills);
    const every = max(p, 'candles', 'kills') || CANDLES_KILLS;
    const bonus = stateNum(p, 'candlesBonus');
    if (kills % every !== 0 || bonus >= CANDLES_MAX) return;
    const next = Math.min(CANDLES_MAX, bonus + sum(p, 'candles', 'pct'));
    setStateNum(p, 'candlesBonus', next);
    const e = activeEntity(w, p);
    if (e) proc(w, p, p.activeIndex, 'candles', e.pos, `+${next - bonus}%`);
  },
  statMods(_w, _e, p, into) {
    const n = stateNum(p, 'candlesBonus');
    if (n > 0 && has(p, 'candles')) into.critChance += n / 100;
  },
};

// ─────────────────────────── 괴담 저주·도박 ───────────────────────────

/** 피 묻은 계약서: atk +30 % (legacy stat effect). Classic: no between-floor heal; 원정: every stage starts at 80 % HP. */
const bloodContract: RewardHooks = {
  onFloorClear(w, p) {
    if (has(p, 'blood_contract') && !w.state.expedition) return { noHeal: true };
  },
  onFloorStart(w, p) {
    if (!w.state.expedition || !has(p, 'blood_contract')) return;
    const k = max(p, 'blood_contract', 'stageHp');
    p.party.forEach(m => {
      if (m.dead) return;
      const e = getEntity(w, m.entityId);
      const t = e ?? m;
      t.hp = Math.max(1, Math.min(t.hp, t.maxHp * k));
      if (e) m.hp = e.hp;
    });
  },
};

/** 동전 던지기: each drag flips a coin (run rng): ×1.8 damage or ×0.5 (heal / shield untouched). */
const coin: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!has(p, 'coin')) return;
    const heads = w.rng.chance(RULES_NUM.coin.chance);
    mods.dmgMult *= heads ? max(p, 'coin', 'heads') : max(p, 'coin', 'tails');
    proc(w, p, info.idx, 'coin', info.at, heads ? '앞면' : '뒷면');
  },
};

/** 서두르는 대가: re-appear cooldown −25 % (min 4); leaving costs 8 % max HP of that character (×2 with bench heal). */
const hasteCost: RewardHooks = {
  cooldownOnLeave(_w, p, _idx, cd) {
    if (has(p, 'haste_cost')) cd.mult *= 1 - Math.min(0.5, sum(p, 'haste_cost', 'cd'));
  },
  onLeave(w, p, info) {
    if (!has(p, 'haste_cost')) return;
    const m = p.party[info.idx];
    if (m && hpCost(w, p, m, sum(p, 'haste_cost', 'hp')) > 0) proc(w, p, info.idx, 'haste_cost', info.pos);
  },
};

/** 피의 등장: appearing costs 10 % max HP (×2 with bench heal), the drag +30 %. */
const bloodEntry: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!has(p, 'blood_entry')) return;
    hpCost(w, p, info.e, sum(p, 'blood_entry', 'hp'));
    const k = 1 + sum(p, 'blood_entry', 'drag');
    mods.dmgMult *= k;
    mods.healMult *= k;
    proc(w, p, info.idx, 'blood_entry', info.at);
  },
};

/** 옥상 난간 위: field HP ≤ 50 % atk +20 %; ≤ 25 % atk +45 % and crit +15 %. */
const ledge: RewardHooks = {
  statMods(_w, e, p, into) {
    if (!has(p, 'ledge')) return;
    const f = e.hp / Math.max(1, e.maxHp);
    if (f <= max(p, 'ledge', 'edge') + 1e-9) {
      into.atkPct += sum(p, 'ledge', 'edgeAtk');
      into.critChance += sum(p, 'ledge', 'edgeCrit');
    } else if (f <= max(p, 'ledge', 'low') + 1e-9) {
      into.atkPct += sum(p, 'ledge', 'lowAtk');
    }
  },
};

/** 굶주린 펫: pet power +60 %; each pet use costs the field character 6 % max HP. */
const hungryPet: RewardHooks = {
  onPet(w, p, _i, at, mods) {
    if (!has(p, 'hungry_pet')) return;
    mods.power *= 1 + sum(p, 'hungry_pet', 'power');
    const e = activeEntity(w, p);
    if (e) plainCost(w, p, e, sum(p, 'hungry_pet', 'hp'));
    proc(w, p, p.activeIndex, 'hungry_pet', e?.pos ?? at);
  },
};

/** 영혼 담보 대출: ult damage / heal +60 %, ult charge +20 %; casting costs 20 % of the caster's current HP. */
const soulLoan: RewardHooks = {
  ultMult(ps) {
    return has(ps, 'soul_loan') ? 1 + sum(ps, 'soul_loan', 'power') : 1;
  },
  chargeMult(ps) {
    return has(ps, 'soul_loan') ? 1 + sum(ps, 'soul_loan', 'charge') : 1;
  },
  onUlt(w, p, idx, e) {
    if (!has(p, 'soul_loan')) return;
    if (plainCost(w, p, e, Math.min(0.9, sum(p, 'soul_loan', 'hp')), true) > 0) proc(w, p, idx, 'soul_loan', e.pos);
  },
};

const bossFloor = (w: World): boolean => w.state.plan.kind === 'boss';

/** 붉은 달: boss floors — +40 % to an enraged boss, my groggy points ×1.5; my characters take +15 %. */
const redMoon: RewardHooks = {
  dealtMult(w, p, _src, target) {
    if (!has(p, 'red_moon') || !bossFloor(w) || target.tier !== 'boss' || !target.enraged) return 1;
    return 1 + max(p, 'red_moon', 'enraged');
  },
  groggyMult(w, p) {
    return has(p, 'red_moon') && bossFloor(w) ? max(p, 'red_moon', 'groggy') : 1;
  },
  takenMult(w, _t, p, acc) {
    if (has(p, 'red_moon') && bossFloor(w)) acc.mult *= 1 + max(p, 'red_moon', 'taken');
  },
};

/** 마감 직전's condition: ≤ 40 s left, an enraged boss, or a living boss / mid boss at ≤ 50 % HP. */
export function deadlineOn(w: World): boolean {
  const s = w.state;
  if (s.phase !== 'combat') return false;
  if (s.timeRemaining <= RULES_NUM.deadline.timeLeft + 1e-9 || s.bossEnraged) return true;
  for (const e of s.entities) {
    if (e.team !== 'enemy' || (e.tier !== 'boss' && e.tier !== 'mid') || !isAlive(e)) continue;
    if (e.enraged || e.hp <= e.maxHp * RULES_NUM.deadline.bossHp + 1e-9) return true;
  }
  return false;
}

/** 마감 직전: while it is on — aspd +30 %, cooldowns set meanwhile −30 % (min 4). Checked once per tick. */
const deadline: RewardHooks = {
  tick(w, p) {
    if (!has(p, 'deadline')) return;
    const on = deadlineOn(w);
    const was = rtNum(p, 'deadline.on') > 0;
    setRtNum(p, 'deadline.on', on ? 1 : 0);
    if (on && !was) {
      const e = activeEntity(w, p);
      if (e) proc(w, p, p.activeIndex, 'deadline', e.pos, '마감!');
    }
  },
  statMods(_w, _e, p, into) {
    if (has(p, 'deadline') && rtNum(p, 'deadline.on') > 0) into.atkSpeedPct += sum(p, 'deadline', 'aspd');
  },
  cooldownOnLeave(_w, p, _idx, cd) {
    if (has(p, 'deadline') && rtNum(p, 'deadline.on') > 0) cd.mult *= 1 - Math.min(0.6, sum(p, 'deadline', 'cd'));
  },
  onFloorStart(_w, p) {
    setRtNum(p, 'deadline.on', 0);
  },
};

const lastOneOn = (p: PlayerState): boolean => has(p, 'last_one') && living(p) === 1;

/** 최후의 1인: one living member — atk +50 % (+15 % per other player out), damage taken −20 % (a guard). */
const lastOne: RewardHooks = {
  statMods(w, _e, p, into) {
    if (!lastOneOn(p)) return;
    const out = w.state.players.filter(q => q.id !== p.id && q.out).length;
    into.atkPct += sum(p, 'last_one', 'atk') + out * sum(p, 'last_one', 'perOut');
  },
  takenMult(_w, _t, p, acc) {
    if (lastOneOn(p)) acc.guard += sum(p, 'last_one', 'guard');
  },
};

/**
 * 상자 · 빚 · 욕심 (offers.ECONOMY_STATE keys): the pending effect is taken when the next normal screen opens. A debt
 * skip comes first (the screen is gone; the box waits for a screen that shows). greedySkip is only read (a 17차 save from
 * before the review fix may still hold one).
 */
const economy: RewardHooks = {
  onGrant(w, p, _a, def) {
    if (def.family === 'box_in_box') setStateNum(p, 'boxBump', 1);
    else if (def.family === 'greedy') setStateNum(p, 'greedyPicks', def.params.picks ?? 2);
    else if (def.family === 'debt') payDebt(w, p, def.params.skips ?? DEBT_SKIPS);
  },
  offerMods(w, p, acc) {
    const unit = w.state.expedition ? '단계' : '층';
    const debt = stateNum(p, 'debt');
    if (debt > 0) {
      setStateNum(p, 'debt', debt - 1);
      acc.skip = true;
      acc.skipBy = 'debt';
      acc.skipText = debt - 1 > 0 ? `빚 · 이번 보상 없음 (${debt - 1}${unit} 남음)` : '빚 · 이번 보상 없음 (마지막)';
      return;
    }
    if (stateNum(p, 'greedySkip') > 0) {
      setStateNum(p, 'greedySkip', 0);
      acc.skip = true;
      acc.skipBy = 'greedy';
      acc.skipText = '욕심 · 이번 보상 없음';
      return;
    }
    const picks = stateNum(p, 'greedyPicks');
    if (picks > 0) {
      // 기획 17차 리뷰: no skip after it — the contract's own screen is its cost (the total stays the same as the idea says)
      setStateNum(p, 'greedyPicks', 0);
      acc.count = Math.max(acc.count, 4);
      acc.picks = Math.max(acc.picks, picks);
    }
    if (stateNum(p, 'boxBump') > 0) {
      setStateNum(p, 'boxBump', 0);
      acc.rarityBump += 1;
    }
  },
};

/** 빚쟁이의 방문: one epic now (p's own draw stream), the next `skips` normal screens skipped. */
function payDebt(w: World, p: SimPlayer, skips: number): void {
  setStateNum(p, 'debt', Math.min(DEBT_SKIPS, skips));
  const r = drawFamilyReward(w, p, 'epic', 0xdeb7 + rewardCount(p, 'debt'));
  if (r) grantReward(w, p, r.rewardId, r.partyIndex);
  const e = activeEntity(w, p);
  proc(w, p, null, 'debt', e?.pos ?? { x: 0, y: 0 }, '빚!');
}

// ─────────────────────────── 멀티 협동 ───────────────────────────

/** Remember another player's swap (listener p): time and drop point by player id. */
function noteSwap(w: World, p: SimPlayer, key: string, pid: number, at: Vec2): void {
  setRtNum(p, `${key}.t.${pid}`, w.state.time);
  setRtNum(p, `${key}.x.${pid}`, at.x);
  setRtNum(p, `${key}.y.${pid}`, at.y);
}

function swapAge(w: World, p: SimPlayer, key: string, pid: number): number {
  const t = rtNum(p, `${key}.t.${pid}`, -Infinity);
  return t >= floorStartTime(w) - 1e-9 ? w.state.time - t : Infinity;
}

function swapPos(p: SimPlayer, key: string, pid: number): Vec2 {
  return { x: rtNum(p, `${key}.x.${pid}`), y: rtNum(p, `${key}.y.${pid}`) };
}

/** 팀 릴레이: I swap within 2 s of another player's swap → both players' next drag +25 % / radius +20 %, field ult +5 %. */
const teamRelay: RewardHooks = {
  onTeamSwap(w, p, actor, info) {
    if (has(p, 'team_relay')) noteSwap(w, p, 'team_relay', actor.id, info.at);
  },
  onAppear(w, p, info, mods) {
    // the partner's half (any player with a reward hears it)
    if (rtNum(p, 'team_relay.buff') > 0) {
      setRtNum(p, 'team_relay.buff', 0);
      relayMods(w, p, mods, rtNum(p, 'team_relay.from'));
    }
    if (!has(p, 'team_relay') || info.forced) return;
    let partner: SimPlayer | null = null;
    let best = Infinity;
    for (const q of others(w, p)) {
      const age = swapAge(w, p, 'team_relay', q.id);
      if (age <= RULES_NUM.teamRelay.window + 1e-9 && age < best) {
        best = age;
        partner = q;
      }
    }
    if (!partner || !icdReady(w, p, 'team_relay.icd', RULES_NUM.teamRelay.icd)) return;
    relayMods(w, p, mods, p.id);
    proc(w, p, info.idx, 'team_relay', info.at);
    setRtNum(partner, 'team_relay.buff', 1);
    setRtNum(partner, 'team_relay.from', p.id);
    const ult = sum(p, 'team_relay', 'ult');
    addUltCharge(w, p, ult);
    addUltCharge(w, partner, ult);
    const pe = activeEntity(w, partner);
    if (pe) proc(w, partner, partner.activeIndex, 'team_relay', pe.pos);
  },
  onFloorStart(_w, p) {
    setRtNum(p, 'team_relay.buff', 0);
  },
};

/** The team relay drag bonus of giver's card numbers on this swap. */
function relayMods(w: World, p: SimPlayer, mods: { dmgMult: number; healMult: number; radiusMult: number }, giver: number): void {
  const g = w.state.players[giver] ?? p;
  const drag = sum(g, 'team_relay', 'drag') || 0.25;
  const radius = sum(g, 'team_relay', 'radius') || 0.2;
  mods.dmgMult *= 1 + drag;
  mods.healMult *= 1 + drag;
  mods.radiusMult *= 1 + radius;
}

/** 합동 의식: two players' drops within r3 and 1.5 s → a 250 % blast at the midpoint + boss groggy +5 %. ICD 6 s. */
const jointRite: RewardHooks = {
  onTeamSwap(w, p, actor, info) {
    if (!has(p, 'joint_rite')) return;
    noteSwap(w, p, 'joint_rite', actor.id, info.at);
    if (swapAge(w, p, 'joint_rite', p.id) <= RULES_NUM.jointRite.window + 1e-9) tryRite(w, p, swapPos(p, 'joint_rite', p.id), info.at);
  },
  onAppear(w, p, info) {
    if (!has(p, 'joint_rite') || info.forced) return;
    noteSwap(w, p, 'joint_rite', p.id, info.at);
    for (const q of others(w, p)) {
      if (swapAge(w, p, 'joint_rite', q.id) > RULES_NUM.jointRite.window + 1e-9) continue;
      if (tryRite(w, p, info.at, swapPos(p, 'joint_rite', q.id))) return;
    }
  },
};

function tryRite(w: World, p: SimPlayer, mine: Vec2, theirs: Vec2): boolean {
  if (dist(mine, theirs) > RULES_NUM.jointRite.range + 1e-9) return false;
  const mid = { x: (mine.x + theirs.x) / 2, y: (mine.y + theirs.y) / 2 };
  const ctx = fieldCtx(w, p, 'joint_rite', mid);
  if (!ctx || !icdReady(w, p, 'joint_rite.icd', RULES_NUM.jointRite.icd)) return false;
  blast(w, ctx, mid, RULES_NUM.jointRite.radius, sum(p, 'joint_rite', 'power'));
  addRewardGroggy(w, sum(p, 'joint_rite', 'groggy'), p.id);
  proc(w, p, p.activeIndex, 'joint_rite', mid);
  return true;
}

/** 삼인 분향: every player still in (min 2) swaps within 5 s → stun all (no boss), +20 % taken 4 s, groggy +25 %. */
const threeIncense: RewardHooks = {
  onTeamSwap(w, p, actor, info) {
    if (!has(p, 'three_incense')) return;
    noteSwap(w, p, 'three_incense', actor.id, info.at);
    tryIncense(w, p);
  },
  onAppear(w, p, info) {
    if (!has(p, 'three_incense') || info.forced) return;
    noteSwap(w, p, 'three_incense', p.id, info.at);
    tryIncense(w, p);
  },
};

function tryIncense(w: World, p: SimPlayer): void {
  const team = w.state.players.filter(q => !q.out);
  if (team.length < 2) return;
  if (!team.every(q => swapAge(w, p, 'three_incense', q.id) <= RULES_NUM.threeIncense.window + 1e-9)) return;
  // once per team per floor: any owner that already fired this floor blocks the rest
  const start = floorStartTime(w);
  if (w.state.players.some(q => rtNum(q, 'three_incense.used', -Infinity) >= start - 1e-9)) return;
  setRtNum(p, 'three_incense.used', w.state.time);
  const n = RULES_NUM.threeIncense;
  const stun = max(p, 'three_incense', 'stun') || n.stun;
  for (const t of aliveEnemiesOf(w, 'ally')) {
    if (t.eventTag === 'ward') continue;
    applyStatus(t, 'stun', stun, 0, p.id, 'relic');
    applyStatus(t, 'vulnerable', n.vulnDur, max(p, 'three_incense', 'vuln') || n.vuln, p.id, 'relic');
  }
  addRewardGroggy(w, max(p, 'three_incense', 'groggy') || n.groggy, p.id);
  const e = activeEntity(w, p);
  proc(w, p, p.activeIndex, 'three_incense', e?.pos ?? { x: 0, y: 0 });
}

/** 빨간 실: another player appears → my field character's shield 8 % (tank 12 %) max HP 3 s. ICD 6 s. */
const redThread: RewardHooks = {
  onTeamSwap(w, p) {
    if (!has(p, 'red_thread')) return;
    const me = activeEntity(w, p);
    if (!me || !icdReady(w, p, 'red_thread.icd', RULES_NUM.redThread.icd)) return;
    const frac = roleOf(p, p.activeIndex) === 'tank' ? sum(p, 'red_thread', 'tankShield') : sum(p, 'red_thread', 'shield');
    rewardShield(w, me, frac, RULES_NUM.redThread.dur);
    proc(w, p, p.activeIndex, 'red_thread', me.pos);
  },
};

/** 대신 맞아 줄게: my tank appears → every other player's field character shield 15 % 4 s + taunt enemies within 4 for 3 s. */
const standIn: RewardHooks = {
  onLand(w, p, info: AppearInfo) {
    if (!has(p, 'stand_in') || roleOf(p, info.idx) !== 'tank') return;
    const frac = sum(p, 'stand_in', 'shield');
    let n = 0;
    for (const q of others(w, p)) {
      const qe = activeEntity(w, q);
      if (!qe) continue;
      rewardShield(w, qe, frac, RULES_NUM.standIn.dur);
      n++;
    }
    for (const t of aliveEnemiesOf(w, 'ally')) {
      if (dist(t.pos, info.e.pos) <= RULES_NUM.standIn.tauntRadius + t.radius) applyStatus(t, 'taunt', RULES_NUM.standIn.taunt, 0, p.id, 'relic', { sourceEntityId: info.e.id });
    }
    if (n > 0) proc(w, p, info.idx, 'stand_in', info.at);
  },
};

/** 손 내밀기: drop within 3 of another player's field character → that player's dead members wait −50 %, come back at 50 % HP. */
const helpingHand: RewardHooks = {
  onAppear(w, p, info) {
    if (!has(p, 'helping_hand') || info.forced) return;
    const near = others(w, p).filter(q => {
      const qe = activeEntity(w, q);
      return qe && dist(qe.pos, info.at) <= RULES_NUM.helpingHand.range + qe.radius && q.party.some(m => m.dead);
    });
    if (!near.length || !icdReady(w, p, 'helping_hand.icd', RULES_NUM.helpingHand.icd)) return;
    const cut = Math.min(0.9, sum(p, 'helping_hand', 'cut'));
    const hp = max(p, 'helping_hand', 'hp');
    for (const q of near) {
      q.party.forEach((m, idx) => {
        if (!m.dead) return;
        const s = m.reviveRemaining * cut;
        m.reviveRemaining -= s;
        if (s > 0) emit(w, { type: 'reviveCut', player: q.id, partyIndex: idx, seconds: s, from: p.id });
        setRtNum(q, `helping_hand.hp.${idx}`, hp);
      });
      const qe = activeEntity(w, q)!;
      proc(w, p, info.idx, 'helping_hand', qe.pos);
    }
  },
  tick(w, p) {
    // the revive HP of the members this player helped (any player's flags; the owner's tick applies them)
    if (!has(p, 'helping_hand')) return;
    for (const q of w.state.players) {
      if (q.id === p.id) continue;
      q.party.forEach((m, idx) => {
        const key = `helping_hand.hp.${idx}`;
        const frac = rtNum(q, key);
        if (!(frac > 0) || m.dead) return;
        setRtNum(q, key, 0);
        const e = getEntity(w, m.entityId);
        const t = e ?? m;
        t.hp = Math.max(t.hp, Math.min(t.maxHp, t.maxHp * frac));
        if (e) m.hp = e.hp;
      });
    }
  },
  onFloorStart(w, p) {
    for (const q of w.state.players) for (let i = 0; i < q.party.length; i++) if (q.id !== p.id && rtNum(q, `helping_hand.hp.${i}`) > 0) setRtNum(q, `helping_hand.hp.${i}`, 0);
  },
};

/** 나눠 쓰는 영혼: my ult → other players' field characters ult +12 %; my caster's gauge restarts at 15 %. */
const sharedSoul: RewardHooks = {
  onUlt(w, p, idx, e) {
    if (!has(p, 'shared_soul')) return;
    const give = sum(p, 'shared_soul', 'ult');
    for (const q of others(w, p)) if (q.activeIndex != null) addUltCharge(w, q, give);
    const g = p.party[idx]?.ult;
    if (g && g.charge < 1) g.charge = Math.max(g.charge, max(p, 'shared_soul', 'restart'));
    proc(w, p, idx, 'shared_soul', e.pos);
  },
};

/** 피의 서약: appear within 3 of another player's field character at ≤ 30 % HP → give 25 % of my current HP, ×1.5 heal. */
const bloodOath: RewardHooks = {
  onLand(w, p, info) {
    if (!has(p, 'blood_oath')) return;
    let target: SimEntity | null = null;
    for (const q of others(w, p)) {
      const qe = activeEntity(w, q);
      if (!qe || dist(qe.pos, info.at) > RULES_NUM.bloodOath.range + qe.radius) continue;
      const f = qe.hp / Math.max(1, qe.maxHp);
      if (f > RULES_NUM.bloodOath.lowHp + 1e-9) continue;
      if (!target || f < target.hp / Math.max(1, target.maxHp)) target = qe;
    }
    if (!target || !icdReady(w, p, 'blood_oath.icd', RULES_NUM.bloodOath.icd)) return;
    const given = plainCost(w, p, info.e, Math.min(0.9, sum(p, 'blood_oath', 'give')), true);
    if (!(given > 0)) return;
    heal(w, p.id, target, given * max(p, 'blood_oath', 'healMult'));
    proc(w, p, info.idx, 'blood_oath', target.pos);
  },
};

// ─────────────────────────── Set bonuses (#협동 · #성장; #저주 is in fx.hpCost) ───────────────────────────

const setBonus: RewardHooks = {
  statMods(w, e, p, into) {
    if (!tagActive(p, 'coop')) return;
    const near = others(w, p).some(q => {
      const qe = activeEntity(w, q);
      return qe && dist(qe.pos, e.pos) <= TAG_BONUS.coop.range + 1e-9;
    });
    if (near) into.atkPct += TAG_BONUS.coop.atk;
  },
  onFloorStart(w, p) {
    if (!tagActive(p, 'growth')) return;
    p.party.forEach((m, i) => {
      if (!m.dead) addMemberUlt(w, p, i, TAG_BONUS.growth.ult);
    });
  },
};

export const RULES_HOOKS: RewardHooks = hookGroup(
  doubleLoad,
  understudy,
  punchIn,
  windowFire,
  nails,
  candles,
  bloodContract,
  coin,
  hasteCost,
  bloodEntry,
  ledge,
  hungryPet,
  soulLoan,
  redMoon,
  deadline,
  lastOne,
  economy,
  teamRelay,
  jointRite,
  threeIncense,
  redThread,
  standIn,
  helpingHand,
  sharedSoul,
  bloodOath,
  setBonus,
);

