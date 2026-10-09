// Cast-context factories: snapshot caster stats + reward/relic multipliers at cast time.

import type { BossDef, DamageSource, PetDef, SkillDef, SkillSlot, Vec2 } from '../types';
import { TURRET_POWER } from './constants';
import { relicParam, relicScale, skillMod } from './modifiers';
import { effStats, petPower } from './stats';
import { copy, dist, getEntity, isAlive, type CastCtx, type SimEntity, type SimPlayer, type SimStatus, type World } from './world';

type RewardSlot = 'normal' | 'drag' | 'ult' | 'basic';
const REWARD_SLOTS: readonly SkillSlot[] = ['normal', 'drag', 'ult', 'basic'];

export function charCtx(w: World, e: SimEntity, slot: SkillSlot, skill: { id: string; name: string } | null): CastCtx {
  const st = effStats(w, e);
  const p = w.state.players[e.ownerPlayer ?? 0];
  const idx = e.partyIndex;
  const t = getEntity(w, e.targetId);
  const rs = REWARD_SLOTS.includes(slot) ? (slot as RewardSlot) : null;
  const dmg = rs ? 1 + skillMod(p, idx, rs, 'damage') : 1;
  const rad = rs ? 1 + skillMod(p, idx, rs, 'radius') : 1;
  return {
    casterId: e.id,
    selfId: e.id,
    team: e.team,
    player: p.id,
    partyIndex: idx,
    slot,
    source: slot,
    skillId: skill?.id ?? `${e.defId}_${slot}`,
    name: skill?.name ?? '',
    atk: st.atk,
    critChance: st.critChance,
    critMult: st.critMult,
    dmgMult: dmg,
    healMult: dmg,
    shieldMult: 1,
    radiusMult: rad,
    point: null,
    targetId: t?.id ?? null,
    targetPos: t ? copy(t.pos) : null,
    allyTargetId: woundedAllyFor(w, e, slot),
    origin: copy(e.pos),
    isDrag: slot === 'drag',
    summonMult: 1,
    ...(GROGGY_SLOTS.includes(slot) ? { groggyMark: { hit: false, stun: 0 } } : null),
  };
}

/** 기획 13차: character casts that can fill the boss groggy gauge (basic attacks never do). */
const GROGGY_SLOTS: readonly SkillSlot[] = ['normal', 'drag', 'ult'];

// ─────────────────────────── 기획 12차: woundedAlly (메딕 응급 주사) ───────────────────────────

/** Only allies below this HP ratio are worth a woundedAlly cast (else the normal skill keeps its cooldown). */
export const WOUNDED_ALLY_HP_FRAC = 0.9;

/** Who a woundedAlly skill may pick: ally characters of every player, and (기획 12차 돌발 괴담) the sleeping patient. */
export function isWoundedAllyCandidate(e: SimEntity): boolean {
  return e.team === 'ally' && (e.kind === 'character' || (e.eventTag === 'ward' && e.defId === PATIENT_UNIT));
}

/** 기획 12차: the 깨어나지 않는 환자 unit (src/data/fieldEvents.ts FIELD_EVENT_UNIT.sleeping_patient). */
const PATIENT_UNIT = 'fe_patient';

/**
 * The ally with the lowest hp/maxHp below maxFrac (default 90 %) within castRange (edge distance) of the caster; ties →
 * nearer. 기획 13차 drag skills pass maxFrac Infinity (always somebody: the drop point is the caster's spot).
 */
export function findWoundedAlly(w: World, caster: SimEntity, castRange: number, maxFrac = WOUNDED_ALLY_HP_FRAC): SimEntity | null {
  let best: SimEntity | null = null;
  let bestRatio = Infinity;
  let bestD = Infinity;
  for (const e of w.state.entities) {
    if (!isAlive(e) || e.team !== caster.team || !isWoundedAllyCandidate(e)) continue;
    if (!(e.hp < maxFrac * e.maxHp)) continue;
    const d = dist(caster.pos, e.pos) - e.radius;
    if (d > castRange) continue;
    const ratio = e.hp / e.maxHp;
    if (ratio < bestRatio - 1e-9 || (Math.abs(ratio - bestRatio) <= 1e-9 && d < bestD)) {
      best = e;
      bestRatio = ratio;
      bestD = d;
    }
  }
  return best;
}

/** The skill of `slot` has a woundedAlly action (only those look for an ally at cast time). */
export function usesWoundedAlly(skill: SkillDef | null | undefined): boolean {
  return !!skill && skill.actions.some(a => a.center === 'woundedAlly');
}

/**
 * The woundedAlly pick of a cast. Normal skills: within castRange, below 90 %. 기획 13차 drag skills (메딕 주사): within
 * the action's allyRange of the drop point — the character appears there — whoever is lowest.
 */
function woundedAllyFor(w: World, e: SimEntity, slot: SkillSlot): number | null {
  const def = e.rt.charDef;
  if (!def || (slot !== 'normal' && slot !== 'drag' && slot !== 'ult')) return null;
  const skill = def[slot];
  if (!usesWoundedAlly(skill)) return null;
  const range = skill.actions.find(a => a.center === 'woundedAlly')?.allyRange ?? skill.castRange ?? 99;
  return findWoundedAlly(w, e, range, slot === 'normal' ? WOUNDED_ALLY_HP_FRAC : Infinity)?.id ?? null;
}

/**
 * 기획 12차: what an ally summon's hits count as. A summon left by a character skill (종이 인형 from 대역 인형) counts
 * under that skill's slot (its burst is part of the drag skill's value); pet turrets and the rest stay 'summon'.
 */
function summonSource(e: SimEntity): DamageSource {
  const slot = e.rt.summonSlot;
  return slot === 'normal' || slot === 'drag' || slot === 'ult' ? slot : 'summon';
}

/**
 * 기획 13차 조종: a charmed enemy fights for the player who charmed it — its hits come from the ally side and count for
 * that player (under the charm's source, the puppeteer's ult).
 */
function charmOf(e: SimEntity): SimStatus | null {
  if (e.team !== 'enemy') return null;
  return (e.statuses.find(s => s.id === 'charm') as SimStatus | undefined) ?? null;
}

/** Monsters, bosses and ally summons. */
export function unitCtx(w: World, e: SimEntity, skillId: string, name: string): CastCtx {
  const charm = charmOf(e);
  if (charm) return { ...baseUnitCtx(w, e, skillId, name), team: 'ally', player: charm.sourcePlayer, source: charm.src ?? 'ult' };
  return baseUnitCtx(w, e, skillId, name);
}

function baseUnitCtx(w: World, e: SimEntity, skillId: string, name: string): CastCtx {
  const st = effStats(w, e);
  const t = getEntity(w, e.targetId);
  const def = e.rt.monDef;
  let summonMult = 1;
  if (e.enraged && def?.tier === 'boss') summonMult = (def as BossDef).enrage.summonCountMult;
  let atk = st.atk;
  let dmgMult = 1;
  if (e.rt.petPowered && e.ownerPlayer != null) {
    // Pet turret: owner's pet power, so pet bonuses (beast_collar "펫 효과 +30%") apply to its shots too.
    const owner = w.state.players[e.ownerPlayer];
    atk = petPower(w, owner) * TURRET_POWER;
    const k = relicScale(owner, owner.activeIndex, 'beast_collar');
    if (k > 0) dmgMult = 1 + relicParam('beast_collar', 'powerPct') * k;
  }
  return {
    casterId: e.id,
    selfId: e.id,
    team: e.team,
    player: e.team === 'ally' ? e.ownerPlayer : null,
    partyIndex: null,
    slot: 'monster',
    source: e.team === 'ally' ? summonSource(e) : 'basic',
    skillId,
    name,
    atk,
    critChance: st.critChance,
    critMult: st.critMult,
    dmgMult,
    healMult: 1,
    shieldMult: 1,
    radiusMult: 1,
    point: null,
    targetId: t?.id ?? null,
    targetPos: t ? copy(t.pos) : null,
    allyTargetId: null,
    origin: copy(e.pos),
    isDrag: false,
    summonMult,
  };
}

export function petCtx(w: World, p: SimPlayer, def: PetDef, point: Vec2): CastCtx {
  const owner = p.activeIndex != null ? getEntity(w, p.party[p.activeIndex].entityId) : null;
  const k = relicScale(p, p.activeIndex, 'beast_collar');
  const mult = k > 0 ? 1 + relicParam('beast_collar', 'powerPct') * k : 1;
  return {
    casterId: null,
    selfId: owner?.id ?? null,
    team: 'ally',
    player: p.id,
    partyIndex: null,
    slot: 'pet',
    source: 'pet',
    skillId: def.id,
    name: def.name,
    atk: petPower(w, p),
    critChance: 0,
    critMult: 1,
    dmgMult: mult,
    healMult: mult,
    shieldMult: mult,
    radiusMult: 1,
    point: copy(point),
    targetId: null,
    targetPos: null,
    allyTargetId: null,
    origin: copy(point),
    isDrag: false,
    summonMult: 1,
    groggyMark: { hit: false, stun: 0 },
  };
}
