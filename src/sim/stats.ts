// Effective stats = base × (1 + Σpct) from passive (on field), party rewards, statuses, relics, berserker bonus.

import type { BossDef, StatBlock, StatMods } from '../types';
import { getCharacter } from '../data';
import { addMods, hasRelic, partyStatMods, relicParam } from './modifiers';
import { clamp, getEntity, type SimEntity, type SimPlayer, type World } from './world';

export function effStats(w: World, e: SimEntity): StatBlock {
  const b = e.rt.base;
  const m: Required<StatMods> = { hpPct: 0, atkPct: 0, defFlat: 0, atkSpeedPct: 0, moveSpeedPct: 0, critChance: 0, critMult: 0 };
  const cdef = e.rt.charDef;
  if (cdef && e.ownerPlayer != null) {
    const p = w.state.players[e.ownerPlayer];
    addMods(m, cdef.passive.stats);
    addMods(m, partyStatMods(p));
    if (hasRelic(p, 'vanguard_helm') && e.rt.sinceAppear < relicParam('vanguard_helm', 'duration')) {
      m.atkPct += relicParam('vanguard_helm', 'atkPct');
    }
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
  const maxHp = b.maxHp * (1 + m.hpPct);
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
  return def.stats.maxHp * (1 + partyStatMods(p).hpPct);
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
