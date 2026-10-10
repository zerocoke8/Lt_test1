// Effective stats = base × (1 + Σpct) from passive (on field), party rewards, statuses, relics, berserker bonus.

import type { BossDef, StatBlock, StatMods } from '../types';
import { getCharacter } from '../data';
import { MIN_MAX_HP_FRAC } from './constants';
import { gearStatMods } from './expeditionGear';
import { addMods, partyStatMods, relicParam, relicScale } from './modifiers';
import { clamp, getEntity, type SimEntity, type SimPlayer, type World } from './world';
import { rwStatMods } from './rewards/hooks';

export function effStats(w: World, e: SimEntity): StatBlock {
  const b = e.rt.base;
  const m: Required<StatMods> = { hpPct: 0, atkPct: 0, defFlat: 0, atkSpeedPct: 0, moveSpeedPct: 0, critChance: 0, critMult: 0 };
  const cdef = e.rt.charDef;
  if (cdef && e.ownerPlayer != null) {
    const p = w.state.players[e.ownerPlayer];
    addMods(m, cdef.passive.stats);
    addMods(m, partyStatMods(p));
    const gear = gearStatMods(p, e.partyIndex); // 기획 15차 원정: this character's equipped gear
    if (gear) addMods(m, gear);
    const helm = relicScale(p, e.partyIndex, 'vanguard_helm');
    if (helm > 0 && e.rt.sinceAppear < relicParam('vanguard_helm', 'duration')) {
      m.atkPct += relicParam('vanguard_helm', 'atkPct') * helm;
    }
    rwStatMods(w, e, p, m); // 기획 17차 floor rewards (conditional stats)
  }
  for (const s of e.statuses) {
    switch (s.id) {
      case 'atkUp':
        m.atkPct += s.value;
        break;
      case 'atkDown':
        m.atkPct -= s.value;
        break;
      case 'haste':
        m.atkSpeedPct += s.value;
        break;
      case 'slow':
        m.atkSpeedPct -= s.value;
        m.moveSpeedPct -= s.value;
        break;
      case 'defUp':
        m.defFlat += s.value;
        break;
      default:
        break;
    }
  }
  const maxHp = b.maxHp * maxHpFactor(m.hpPct);
  if (cdef?.passive.lowHpAtkBonus) {
    const frac = clamp(e.hp / Math.max(1, maxHp), 0, 1);
    m.atkPct += cdef.passive.lowHpAtkBonus * (1 - frac);
  }
  let atk = b.atk * Math.max(0, 1 + m.atkPct);
  // 기획 8차 boss phases speed the basic attack up (1 for everyone else)
  let atkSpeed = b.atkSpeed * Math.max(0.1, 1 + m.atkSpeedPct) * e.rt.phaseAtkSpeedMult;
  if (e.team === 'enemy') {
    atk *= w.tunables.monsterDmgMult;
    if (e.enraged && e.rt.monDef?.tier === 'boss') {
      const en = (e.rt.monDef as BossDef).enrage;
      atk *= en.atkMult;
      atkSpeed *= en.atkSpeedMult;
    }
  }
  return {
    maxHp,
    atk,
    def: clamp(b.def + m.defFlat, 0, 0.9),
    atkSpeed,
    range: b.range,
    moveSpeed: b.moveSpeed * Math.max(0.1, 1 + m.moveSpeedPct),
    critChance: clamp(b.critChance + m.critChance, 0, 1),
    critMult: b.critMult + m.critMult,
  };
}

/** Max HP of a party member while on the bench (no passive). */
export function benchMaxHp(p: SimPlayer, idx: number): number {
  const def = getCharacter(p.party[idx].defId);
  const gear = gearStatMods(p, idx); // 기획 15차 원정: armor HP counts on the bench too
  return def.stats.maxHp * maxHpFactor(partyStatMods(p).hpPct + (gear ? gear.hpPct : 0));
}

/** 기획 10차: however many curses stack, max HP never drops below MIN_MAX_HP_FRAC of the base. */
function maxHpFactor(hpPct: number): number {
  return Math.max(MIN_MAX_HP_FRAC, 1 + hpPct);
}

/** Pet power: owner's active character effective atk, else highest base atk in the party. */
export function petPower(w: World, p: SimPlayer): number {
  if (p.activeIndex != null) {
    const e = getEntity(w, p.party[p.activeIndex].entityId);
    if (e) return effStats(w, e).atk;
  }
  let best = 0;
  for (const m of p.party) best = Math.max(best, getCharacter(m.defId).stats.atk);
  return best;
}
