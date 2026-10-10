// 기획 17차 Track B reward group — 궁극기·보스·펫·상태이상 + 저스트 (docs/floor-rewards.md; data:
// src/data/rewards/combat.ts). One small hook object per family, joined with hookGroup at the bottom; each hook reads its
// own family through query.ts and makes its extra hits through fx.ts reward contexts (no groggy, 'relic' damage). The
// three set bonuses this track owns live here too: #저스트 (justMods), #상태이상 (statusDuration), #보스 (dealtMult).

import type { PlayerState, Role, SkillAction, StatusId, Vec2 } from '../../types';
import { JUST_SWAP } from '../../config';
import { TAG_BONUS } from '../../data';
import { GRUDGE_TWICE } from '../../data/rewards/combat';
import { hitDamage, reduceBenchSwapCd } from '../combat';
import { charCtx } from '../ctx';
import { isGroggy } from '../groggy';
import { applyStatus, hasStatus, isBossy, statusImmune } from '../status';
import { addUltCharge } from '../ultMode';
import { aliveEnemiesOf, copy, dist, emit, getEntity, isAlive, type CastCtx, type SimEntity, type SimPlayer, type World } from '../world';
import { castSkill } from '../skills';
import { isHostile, memberStats, nearestEnemies, proc, pureHit, rewardCtx, rewardShield, rtNum, scheduleReward, setRtNum, icdReady, spawnShooter } from './fx';
import { memberRole, rewardCount, rewardParam, tagActive } from './query';
import { hookGroup, type RewardHooks } from './types';

// ─────────────────────────── Helpers ───────────────────────────

const has = (p: PlayerState, fam: string): boolean => rewardCount(p, fam) > 0;
const sum = (p: PlayerState, fam: string, key: string): number => rewardParam(p, fam, key, 'sum');
const max = (p: PlayerState, fam: string, key: string): number => rewardParam(p, fam, key, 'max');

/** The statuses 주문 연장 lengthens. */
const SPELL_EXT: ReadonlySet<StatusId> = new Set<StatusId>(['stun', 'root', 'slow']);

/**
 * How long a hostile status p puts on lasts with p's rewards: 주문 연장 (stun / root / slow) and the #상태이상 set.
 * Used by the statusDuration hook (skill statuses) and by this track's own reward statuses.
 */
export function rewardStatusDuration(p: PlayerState, status: StatusId, d: number): number {
  if (!isHostile(status)) return d;
  let out = d;
  if (SPELL_EXT.has(status)) out *= 1 + sum(p, 'spell_ext', 'pct');
  if (tagActive(p, 'status')) out *= 1 + TAG_BONUS.status.duration;
  return out;
}

/** A hostile status from one of p's rewards (durations as rewardStatusDuration). True when it took. */
function rewardStatus(w: World, p: SimPlayer, t: SimEntity, status: StatusId, d: number, value: number, sourceEntityId: number | null = null): boolean {
  return applyStatus(t, status, rewardStatusDuration(p, status, d), value, p.id, 'relic', { anchor: copy(t.pos), sourceEntityId });
}

/** Bench cards of p (not the field one): their indices. */
function benchIdx(p: SimPlayer): number[] {
  const out: number[] = [];
  p.party.forEach((_m, i) => {
    if (i !== p.activeIndex) out.push(i);
  });
  return out;
}

/** Cut every bench card's remaining re-appear cooldown by share (0..1); the card pop shows the largest cut. */
function cutBenchShare(w: World, p: SimPlayer, share: number): number {
  const k = Math.max(0, Math.min(1, share));
  let most = 0;
  for (const i of benchIdx(p)) {
    const m = p.party[i];
    const cut = m.swapCooldownRemaining * k;
    m.swapCooldownRemaining = Math.max(0, m.swapCooldownRemaining - cut);
    most = Math.max(most, cut);
  }
  if (most > 0) emit(w, { type: 'swapCdCut', player: p.id, seconds: most, from: p.id });
  return most;
}

/** Cut every bench card's remaining re-appear cooldown by s seconds (+ the card pop). */
function cutBenchSeconds(w: World, p: SimPlayer, s: number): void {
  if (!(s > 0)) return;
  reduceBenchSwapCd(p, s);
  emit(w, { type: 'swapCdCut', player: p.id, seconds: s, from: p.id });
}

/** Living enemies whose body is within r of at. */
function enemiesNear(w: World, at: Vec2, r: number): SimEntity[] {
  return aliveEnemiesOf(w, 'ally').filter(t => t.eventTag !== 'ward' && !t.rt.untargetable && dist(at, t.pos) - t.radius <= r);
}

/** Boss or mid boss: the #보스 set and 그로기 낙하 count both. */
const bossy = (t: SimEntity): boolean => t.kind === 'monster' && isBossy(t);

/**
 * An ult's actions as a reward replay (궁극기 여운 / 두 번 차는 게이지): no caster moves (dash, charge, blink), no
 * summons, no self-only parts, no player effects (cooldown cuts, bench heals) — only hits, heals, shields, statuses and
 * pushes at the spot. Empty when nothing is left.
 */
export function replayActions(actions: readonly SkillAction[], o: { lastOnly?: boolean; maxDelay?: number } = {}): SkillAction[] {
  const keep: SkillAction[] = [];
  for (const a of actions) {
    if (a.affects === 'self' || a.blinkChain) continue;
    const effects = a.effects.filter(e => e.kind === 'damage' || e.kind === 'heal' || e.kind === 'shield' || e.kind === 'status' || e.kind === 'knockback' || e.kind === 'pull');
    if (!effects.length) continue;
    const { dash: _d, charge: _c, blink: _b, summon: _s, follow: _f, ...rest } = a;
    const delay = o.maxDelay != null ? Math.min(a.delay ?? 0, o.maxDelay) : a.delay;
    keep.push({ ...rest, effects, ...(delay != null ? { delay } : null) });
  }
  if (!o.lastOnly) return keep;
  // 「마지막 동작」: the last part that hits enemies (else the last part at all)
  const hit = keep.filter(a => a.effects.some(e => e.kind === 'damage'));
  return (hit.length ? hit : keep).slice(-1);
}

/** A casterless reward context at `at` with the power of `power` (damage, heal, shield) — targets kept from base. */
function replayCtx(base: CastCtx, key: string, at: Vec2, power: number): CastCtx {
  const c = rewardCtx(base, key, at);
  c.targetId = base.targetId;
  c.targetPos = base.targetPos ? copy(base.targetPos) : null;
  c.dmgMult = power;
  c.healMult = power;
  c.shieldMult = power;
  return c;
}

// ─────────────────────────── 궁극기 ───────────────────────────

/** 교대 충전: the incoming character's own gauge + (it is the focus character now). */
const swapCharge: RewardHooks = {
  onAppear(w, p, info) {
    const v = sum(p, 'swap_charge', 'ult');
    if (!(v > 0)) return;
    addUltCharge(w, p, v);
    proc(w, p, info.idx, 'swap_charge', info.at);
  },
};

/** 막간 박수: an ult cuts the bench cards' remaining cooldown by 50 % (two rares or the epic: to 0). */
const intermission: RewardHooks = {
  onUlt(w, p, idx, e) {
    const cut = sum(p, 'intermission', 'cut');
    if (!(cut > 0)) return;
    if (cutBenchShare(w, p, cut) > 0) proc(w, p, idx, 'intermission', e.pos);
  },
};

/** 궁극기 여운: a character that leaves within 8 s of its ult replays the ult's last action at the leave spot (40 %). */
const ultLinger: RewardHooks = {
  onUlt(w, p, idx) {
    if (has(p, 'ult_linger')) setRtNum(p, `ult_linger.${idx}`, w.state.time);
  },
  onLeave(w, p, info) {
    if (!has(p, 'ult_linger')) return;
    const key = `ult_linger.${info.idx}`;
    const at = rtNum(p, key, -1e9);
    if (w.state.time - at > max(p, 'ult_linger', 'window') + 1e-9) return;
    setRtNum(p, key, -1e9); // once per ult
    const def = info.entity.rt.charDef;
    const actions = def ? replayActions(def.ult.actions, { lastOnly: true, maxDelay: 0.3 }) : [];
    if (!actions.length) return;
    castSkill(w, replayCtx(info.ctx, 'ult_linger', info.pos, sum(p, 'ult_linger', 'power')), actions);
    proc(w, p, info.idx, 'ult_linger', info.pos);
  },
};

/** 둘이서: an ult calls an 8 s afterimage of the stronger bench character (0.6 s bolts, 60 % of its attack). */
const duet: RewardHooks = {
  onUlt(w, p, idx, e) {
    if (!has(p, 'duet')) return;
    let best = -1;
    let atk = 0;
    for (const i of benchIdx(p)) {
      if (p.party[i].dead) continue;
      const a = memberStats(w, p, i).atk;
      if (a > atk + 1e-9) {
        best = i;
        atk = a;
      }
    }
    if (best < 0) return;
    const at = { x: e.pos.x - 1.2, y: e.pos.y - 0.8 };
    const u = spawnShooter(w, p, 'duet', at, { duration: max(p, 'duet', 'duration'), interval: max(p, 'duet', 'interval'), range: max(p, 'duet', 'range'), amount: sum(p, 'duet', 'power'), atk });
    if (u) proc(w, p, idx, 'duet', u.pos);
  },
};

/** 두 번 차는 게이지: the gauge holds up to 200 %; an ult cast above 100 % fires again 0.8 s later at 70 % (no groggy). */
const overcharge: RewardHooks = {
  gaugeCap(ps) {
    return has(ps, 'overcharge') ? max(ps, 'overcharge', 'cap') : 1;
  },
  onUlt(w, p, idx, e, _ctx, spent) {
    if (!has(p, 'overcharge') || !(spent > 1 + 1e-6)) return;
    scheduleReward(w, p, 'overcharge', max(p, 'overcharge', 'delay'), { entityId: e.id, idx });
    proc(w, p, idx, 'overcharge', e.pos);
  },
  onDelay(w, p, pd) {
    if (pd.tag !== 'overcharge') return;
    const e = getEntity(w, pd.data.entityId);
    const def = e?.rt.charDef;
    if (!e || !def || e.ownerPlayer !== p.id) return;
    const actions = replayActions(def.ult.actions);
    if (!actions.length) return;
    const base = charCtx(w, e, 'ult', def.ult);
    const power = sum(p, 'overcharge', 'power') * base.dmgMult;
    castSkill(w, replayCtx(base, 'overcharge', e.pos, power), actions);
    proc(w, p, e.partyIndex, 'overcharge', e.pos, '한 번 더!');
  },
};

// ─────────────────────────── 보스 ───────────────────────────

/** 그로기 낙하: a drop near a boss / mid boss → that swap's groggy ×1.6 and the boss takes +15 % for 1 s. */
const groggyDrop: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!has(p, 'groggy_drop')) return;
    const r = max(p, 'groggy_drop', 'range');
    const near = enemiesNear(w, info.at, r)
      .filter(bossy)
      .sort((a, b) => dist(info.at, a.pos) - dist(info.at, b.pos) || a.id - b.id)[0];
    if (!near) return;
    mods.groggyMult *= max(p, 'groggy_drop', 'groggy');
    applyStatus(near, 'vulnerable', max(p, 'groggy_drop', 'vulnTime'), max(p, 'groggy_drop', 'vuln'), p.id, 'relic');
    proc(w, p, info.idx, 'groggy_drop', copy(near.pos));
  },
};

/** 그로기 러시: the boss breaks → my bench cooldowns −50 %; appearing while it is groggy → drag +30 %. */
const groggyRush: RewardHooks = {
  onGroggyBreak(w, p, boss) {
    if (!has(p, 'groggy_rush') || p.out) return;
    if (cutBenchShare(w, p, sum(p, 'groggy_rush', 'cdCut')) > 0) proc(w, p, null, 'groggy_rush', boss.pos);
  },
  onAppear(w, p, info, mods) {
    if (!has(p, 'groggy_rush')) return;
    const boss = getEntity(w, w.state.bossId);
    if (!boss || !isGroggy(w, boss)) return;
    const k = 1 + sum(p, 'groggy_rush', 'drag');
    mods.dmgMult *= k;
    mods.healMult *= k;
    mods.shieldMult *= k;
    proc(w, p, info.idx, 'groggy_rush', info.at);
  },
};

const CRUSHERS: ReadonlySet<Role> = new Set<Role>(['tank', 'melee']);

/** 파쇄자: a tank / melee dealer's drag reaching the boss gives ×1.5 / ×1.75 groggy (two copies add their extras). */
const crusher: RewardHooks = {
  groggyMult(_w, p, ctx) {
    if (ctx.slot !== 'drag' || !has(p, 'crusher')) return 1;
    const role = memberRole(p, ctx.partyIndex);
    if (!role || !CRUSHERS.has(role)) return 1;
    return 1 + Math.max(0, sum(p, 'crusher', 'groggy') - rewardCount(p, 'crusher'));
  },
};

// ─────────────────────────── 펫 ───────────────────────────

/** 펫 호출 신호: on appear, the pet with the most cooldown left −1.5 / −2.5 s. */
const petCall: RewardHooks = {
  onAppear(w, p, info) {
    const s = sum(p, 'pet_call', 'seconds');
    if (!(s > 0)) return;
    let best = -1;
    p.pets.forEach((pet, i) => {
      if (pet.cooldownRemaining > 1e-9 && (best < 0 || pet.cooldownRemaining > p.pets[best].cooldownRemaining + 1e-9)) best = i;
    });
    if (best < 0) return;
    const pet = p.pets[best];
    pet.cooldownRemaining = Math.max(0, pet.cooldownRemaining - s);
    proc(w, p, info.idx, 'pet_call', info.at);
  },
};

/** 주인 냄새: for 3 s after an appear, a pet used within 3 of the drop is +40 %. */
const petScent: RewardHooks = {
  onAppear(w, p, info) {
    if (!has(p, 'pet_scent')) return;
    setRtNum(p, 'pet_scent.until', w.state.time + max(p, 'pet_scent', 'duration'));
    setRtNum(p, 'pet_scent.x', info.at.x);
    setRtNum(p, 'pet_scent.y', info.at.y);
    proc(w, p, info.idx, 'pet_scent', info.at);
  },
  onPet(w, p, _i, at, mods) {
    if (!has(p, 'pet_scent') || w.state.time > rtNum(p, 'pet_scent.until', -1e9) + 1e-9) return;
    const c = { x: rtNum(p, 'pet_scent.x'), y: rtNum(p, 'pet_scent.y') };
    if (dist(at, c) > max(p, 'pet_scent', 'radius') + 1e-9) return;
    mods.power *= 1 + sum(p, 'pet_scent', 'power');
    proc(w, p, null, 'pet_scent', at);
  },
};

/** The field character is a support (조련사의 손길). */
function supportOnField(w: World, p: SimPlayer): SimEntity | null {
  if (memberRole(p, p.activeIndex) !== 'support') return null;
  const e = getEntity(w, p.party[p.activeIndex!].entityId);
  return isAlive(e) ? e : null;
}

/** 조련사의 손길: with a support on the field, a pet's cooldown is 30 % shorter and the support gets +20 % attack speed. */
const tamer: RewardHooks = {
  petCdMult(p) {
    if (!has(p, 'tamer') || memberRole(p, p.activeIndex) !== 'support') return 1;
    return 1 - Math.min(0.6, sum(p, 'tamer', 'refund'));
  },
  onPet(w, p) {
    if (!has(p, 'tamer')) return;
    const e = supportOnField(w, p);
    if (!e) return;
    applyStatus(e, 'haste', max(p, 'tamer', 'duration'), sum(p, 'tamer', 'haste'), p.id, 'relic');
    proc(w, p, p.activeIndex, 'tamer', e.pos);
  },
};

/** 펫 사육사: pet power +20 / 35 / 50 %, pet radius +20 % (the preview shows it). */
const petBreeder: RewardHooks = {
  onPet(_w, p, _i, _at, mods) {
    const v = sum(p, 'pet_breeder', 'power');
    if (v > 0) mods.power *= 1 + v;
  },
  petRadiusAdd(ps) {
    return max(ps, 'pet_breeder', 'radius');
  },
};

// ─────────────────────────── 상태이상 ───────────────────────────

/** 불붙은 손: drag hits burn 3 s (15 / 25 % of the caster's attack per second). */
const fireHand: RewardHooks = {
  onDragHit(w, p, ctx, target) {
    const dps = sum(p, 'fire_hand', 'dps');
    if (!(dps > 0) || !isAlive(target) || !(ctx.atk > 0)) return;
    rewardStatus(w, p, target, 'burn', max(p, 'fire_hand', 'duration'), dps * ctx.atk);
  },
};

/** 연쇄 화상: an enemy dying with my burn passes it to enemies within 2 (its time left, at least 2 s). */
const burnChain: RewardHooks = {
  onKill(w, p, victim) {
    if (!has(p, 'burn_chain')) return;
    const burn = victim.statuses.find(s => s.id === 'burn' && s.sourcePlayer === p.id);
    if (!burn || !(burn.value > 0)) return;
    const d = Math.max(max(p, 'burn_chain', 'min'), burn.remaining);
    let n = 0;
    for (const t of enemiesNear(w, victim.pos, max(p, 'burn_chain', 'radius'))) {
      if (t === victim) continue;
      if (applyStatus(t, 'burn', d, burn.value, p.id, 'relic')) n++;
    }
    if (n > 0) proc(w, p, null, 'burn_chain', victim.pos);
  },
};

/** 주문 연장 (stun / root / slow +25 / 40 %) and the #상태이상 set (every hostile status +20 %). */
const statusTime: RewardHooks = {
  statusDuration(p, _ctx, status, d) {
    return rewardStatusDuration(p, status, d);
  },
};

/** 약점 노출: +30 / 45 % on stunned / rooted enemies and the groggy boss, +15 / 20 % on slowed ones. */
const expose: RewardHooks = {
  dealtMult(w, p, _src, target) {
    if (!has(p, 'expose')) return 1;
    if (hasStatus(target, 'stun') || hasStatus(target, 'root') || isGroggy(w, target)) return 1 + sum(p, 'expose', 'control');
    if (hasStatus(target, 'slow')) return 1 + sum(p, 'expose', 'slow');
    return 1;
  },
};

/** 홀린 자: a drag hit charms one normal enemy for 3 s (once per 10 s). */
const possess: RewardHooks = {
  onDragHit(w, p, ctx, target) {
    if (!has(p, 'possess') || !isAlive(target) || target.kind !== 'monster' || target.tier !== 'normal') return;
    if (target.eventTag || target.invulnTime > 0 || statusImmune(target, 'charm') || hasStatus(target, 'charm')) return;
    if (!icdReady(w, p, 'possess', max(p, 'possess', 'icd'))) return;
    if (!rewardStatus(w, p, target, 'charm', max(p, 'possess', 'duration'), 0, ctx.casterId)) return;
    const s = target.statuses.find(x => x.id === 'charm');
    emit(w, { type: 'statusApplied', targetId: target.id, status: 'charm', duration: s?.total ?? 0, player: p.id, sourceId: ctx.casterId });
    proc(w, p, ctx.partyIndex, 'possess', target.pos);
  },
};

/** 괴담 사냥꾼: a 돌발 괴담 success → field ult +25 %, bench cooldowns −3 s. */
const ghostHunter: RewardHooks = {
  onFieldEventSuccess(w, p) {
    if (!has(p, 'ghost_hunter')) return;
    addUltCharge(w, p, sum(p, 'ghost_hunter', 'ult'));
    cutBenchSeconds(w, p, sum(p, 'ghost_hunter', 'seconds'));
    const e = getEntity(w, p.activeIndex != null ? p.party[p.activeIndex].entityId : null);
    proc(w, p, null, 'ghost_hunter', e ? e.pos : { x: 0, y: 0 });
  },
};

/** 원한의 쪽지 bookkeeping keys (p.rt.reward): the HP an enemy had when marked, and when it may be marked again. */
const GRUDGE_HP = 'grudge.hp.';
const GRUDGE_ICD = 'grudge.icd.';

function pruneGrudge(w: World, p: SimPlayer, all = false): void {
  const r = p.rt.reward;
  if (!r) return;
  for (const k of Object.keys(r)) {
    if (all && k.startsWith('grudge.')) delete r[k];
    else if (k.startsWith(GRUDGE_ICD) && r[k] <= w.state.time) delete r[k];
  }
}

/**
 * 원한의 쪽지: leaving marks the nearest enemy within 6 for 4 s (the same enemy once per 10 s); when the mark runs out
 * it bursts 35 % (+15 %p per extra copy) of the damage it took meanwhile — a boss / mid boss at most 6 % of its max HP.
 */
const grudge: RewardHooks = {
  onLeave(w, p, info) {
    if (!has(p, 'grudge')) return;
    pruneGrudge(w, p);
    const t = nearestEnemies(w, info.pos, 8, max(p, 'grudge', 'range')).find(x => !x.rt.untargetable && rtNum(p, GRUDGE_ICD + x.id, -1e9) <= w.state.time);
    if (!t) return;
    if (!rewardStatus(w, p, t, 'grudge', max(p, 'grudge', 'duration'), 0)) return;
    setRtNum(p, GRUDGE_ICD + t.id, w.state.time + max(p, 'grudge', 'icd'));
    setRtNum(p, GRUDGE_HP + t.id, t.hp + t.shield);
    proc(w, p, info.idx, 'grudge', t.pos, '표식');
  },
  statusExpire(w, p, e, status) {
    if (status.id !== 'grudge') return;
    const key = GRUDGE_HP + e.id;
    const before = rtNum(p, key, NaN);
    if (p.rt.reward) delete p.rt.reward[key];
    if (!Number.isFinite(before) || !has(p, 'grudge') || !isAlive(e)) return;
    const taken = Math.max(0, before - (e.hp + e.shield));
    const share = max(p, 'grudge', 'pct') + GRUDGE_TWICE * (rewardCount(p, 'grudge') - 1);
    let amount = taken * share;
    if (bossy(e)) amount = Math.min(amount, max(p, 'grudge', 'bossCap') * e.maxHp);
    if (!(amount > 0)) return;
    pureHit(w, p, e, amount);
    proc(w, p, null, 'grudge', e.pos, '폭발');
  },
  onFloorStart(w, p) {
    pruneGrudge(w, p, true);
  },
};

// ─────────────────────────── 저스트 교대 ───────────────────────────

/** 되받아치기: every attacker of a dodged attack (up to 3) takes 150 / 250 % of the incoming attack + a 0.5 s stun. */
const justCounter: RewardHooks = {
  onJustSwap(w, p, info) {
    const power = sum(p, 'just_counter', 'power');
    if (!(power > 0)) return;
    const ids: number[] = [];
    for (const th of info.threats) if (th.sourceId != null && !ids.includes(th.sourceId)) ids.push(th.sourceId);
    const ctx = rewardCtx(info.drag, 'just_counter', info.drop);
    for (const id of ids.slice(0, 3)) {
      const t = getEntity(w, id);
      if (!isAlive(t) || t.team !== 'enemy') continue;
      ctx.point = copy(t.pos);
      hitDamage(w, ctx, t, power);
      if (isAlive(t)) rewardStatus(w, p, t, 'stun', max(p, 'just_counter', 'stun'), 0);
      proc(w, p, info.inIndex, 'just_counter', t.pos);
    }
  },
};

/**
 * 간발의 차: a 저스트 교대 cuts my bench cards' remaining cooldown. The card the 저스트 just took out keeps the 저스트
 * floor (JUST_SWAP.minCooldown), so two cards cannot ping-pong 저스트 swaps.
 */
const justCd: RewardHooks = {
  onJustSwap(w, p, info) {
    const s = sum(p, 'just_cd', 'seconds');
    if (!(s > 0)) return;
    const out = p.party[info.outIndex];
    const before = out?.swapCooldownRemaining ?? 0;
    cutBenchSeconds(w, p, s);
    if (out) out.swapCooldownRemaining = Math.max(out.swapCooldownRemaining, Math.min(before, JUST_SWAP.minCooldown));
    proc(w, p, info.inIndex, 'just_cd', info.drop);
  },
};

/** 아슬아슬: a 저스트 교대 gives the incoming character's gauge +8 / 12 / 16 %. */
const justUlt: RewardHooks = {
  onJustSwap(w, p, info) {
    const v = sum(p, 'just_ult', 'ult');
    if (!(v > 0)) return;
    addUltCharge(w, p, v);
    proc(w, p, info.inIndex, 'just_ult', info.drop);
  },
};

/** 헛손질: a 저스트 교대 shields every player's characters within 3 of the drop (10 / 15 % max HP, 3 s). */
const justGuard: RewardHooks = {
  onJustSwap(w, p, info) {
    const frac = sum(p, 'just_guard', 'shield');
    if (!(frac > 0)) return;
    const r = max(p, 'just_guard', 'radius');
    const dur = max(p, 'just_guard', 'duration');
    for (const e of w.state.entities) {
      if (e.kind !== 'character' || e.team !== 'ally' || !isAlive(e)) continue;
      if (dist(info.drop, e.pos) - e.radius <= r) rewardShield(w, e, frac, dur);
    }
    proc(w, p, info.inIndex, 'just_guard', info.drop);
  },
};

/** 멈춘 숨: a 저스트 교대 slows enemies within 4 by 60 % for 2 s and the incoming drag always crits. */
const justFreeze: RewardHooks = {
  onAppear(w, p, info, mods) {
    if (!info.just || !has(p, 'just_freeze')) return;
    const slow = max(p, 'just_freeze', 'slow');
    const d = max(p, 'just_freeze', 'duration');
    for (const t of enemiesNear(w, info.at, max(p, 'just_freeze', 'radius'))) rewardStatus(w, p, t, 'slow', d, slow);
    mods.forceCrit = true;
    proc(w, p, info.idx, 'just_freeze', info.at);
  },
};

/** 찰나의 감각 (+0.2 s), 귀신 같은 몸놀림 (power +0.5, cut +0.3, window +0.1) and the #저스트 set (window +0.1, power +0.25). */
const justNumbers: RewardHooks = {
  justMods(ps, acc) {
    acc.window += max(ps, 'just_window', 'window');
    if (has(ps, 'just_ghost')) {
      acc.window += max(ps, 'just_ghost', 'window');
      acc.power += max(ps, 'just_ghost', 'power');
      acc.cdCut += max(ps, 'just_ghost', 'cut');
    }
    if (tagActive(ps, 'just')) {
      acc.window += TAG_BONUS.just.window;
      acc.power += TAG_BONUS.just.power;
    }
  },
};

// ─────────────────────────── #보스 set ───────────────────────────

/** #보스 set: damage to a boss / mid boss +10 %. */
const bossSet: RewardHooks = {
  dealtMult(_w, p, _src, target) {
    return bossy(target) && tagActive(p, 'boss') ? 1 + TAG_BONUS.boss.dmg : 1;
  },
};

export const COMBAT_HOOKS: RewardHooks = hookGroup(
  swapCharge,
  intermission,
  ultLinger,
  duet,
  overcharge,
  groggyDrop,
  groggyRush,
  crusher,
  petCall,
  petScent,
  tamer,
  petBreeder,
  fireHand,
  burnChain,
  statusTime,
  expose,
  possess,
  ghostHunter,
  grudge,
  justCounter,
  justCd,
  justUlt,
  justGuard,
  justFreeze,
  justNumbers,
  bossSet,
);
