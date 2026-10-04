// Cast-context factories: snapshot caster stats + reward/relic multipliers at cast time.

import type { BossDef, PetDef, SkillSlot, Vec2 } from '../types';
import { TURRET_POWER } from './constants';
import { hasRelic, relicParam, skillMod } from './modifiers';
import { effStats, petPower } from './stats';
import { copy, getEntity, type CastCtx, type SimEntity, type SimPlayer, type World } from './world';

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
    origin: copy(e.pos),
    isDrag: slot === 'drag',
    summonMult: 1,
  };
}

/** Monsters, bosses and ally summons. */
export function unitCtx(w: World, e: SimEntity, skillId: string, name: string): CastCtx {
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
    if (hasRelic(owner, 'beast_collar')) dmgMult = 1 + relicParam('beast_collar', 'powerPct');
  }
  return {
    casterId: e.id,
    selfId: e.id,
    team: e.team,
    player: e.team === 'ally' ? e.ownerPlayer : null,
    partyIndex: null,
    slot: 'monster',
    source: e.team === 'ally' ? 'summon' : 'basic',
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
    origin: copy(e.pos),
    isDrag: false,
    summonMult,
  };
}

export function petCtx(w: World, p: SimPlayer, def: PetDef, point: Vec2): CastCtx {
  const owner = p.activeIndex != null ? getEntity(w, p.party[p.activeIndex].entityId) : null;
  const mult = hasRelic(p, 'beast_collar') ? 1 + relicParam('beast_collar', 'powerPct') : 1;
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
    origin: copy(point),
    isDrag: false,
    summonMult: 1,
  };
}
