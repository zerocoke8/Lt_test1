// 기획 8차: boss phases. BossDef.phases are HP thresholds (fraction of max HP, descending). Crossing one — once —
// emits 'bossPhase', puts that phase's skills at the FRONT of the rotation (its opener comes first) and applies its
// multipliers on top of the enrage ones (units.ts monsterCdMult, stats.ts atkSpeed). A boss knocked to 0 HP retreats
// instead (R18), so a killing blow never starts a phase.

import type { BossDef } from '../types';
import { emit, type SimEntity, type World } from './world';

export function checkPhases(w: World, e: SimEntity): void {
  const phases = (e.rt.monDef as BossDef | null)?.phases;
  if (!phases || phases.length === 0 || e.rt.gone || !(e.hp > 0)) return;
  while (e.rt.phase < phases.length && e.hp < phases[e.rt.phase].hpBelow * e.maxHp - 1e-9) {
    const ph = phases[e.rt.phase];
    e.rt.phase++;
    const cdM = ph.cooldownMult ?? 1;
    if (cdM !== 1) {
      e.rt.skillCds = e.rt.skillCds.map(c => c * cdM);
      e.rt.phaseCdMult *= cdM;
    }
    e.rt.phaseAtkSpeedMult *= ph.atkSpeedMult ?? 1;
    const added = ph.skills ?? [];
    // initialDelay counts from the phase start
    e.rt.skills.unshift(...added);
    e.rt.skillCds.unshift(...added.map(sk => sk.initialDelay ?? sk.cooldown));
    const phase = e.rt.phase + 1; // the fight starts in phase 1; the first threshold starts phase 2
    emit(w, { type: 'bossPhase', entityId: e.id, phase, name: ph.name ?? `${phase}페이즈` });
  }
}
