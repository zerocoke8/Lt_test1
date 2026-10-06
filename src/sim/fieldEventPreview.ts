// 기획 12차 돌발 괴담: what a card / pet drop does to the running event. PURE over the public GameState + content data,
// so the dragger's preview highlight (render/preview.ts, also on a multiplayer snapshot) equals what the server sim does
// when the drop lands (fieldEventOnDrop) and what the bots score (botEvents.ts).

import type { Entity, GameState, PreviewPart, SkillAction, Vec2 } from '../types';
import { getCharacter, getFieldEvent, getMonster, getPet, lockRadius } from '../data';
import { ARENA_MARGIN } from './constants';
import { hitsArea } from './geometry';
import { partActions, previewPartsFor } from './preview';

export interface DropOutcome {
  /** Event target the dropped character (or the pet's summon) locks onto (rule 2), else null. */
  lockTargetId: number | null;
  /** Event targets an enemy footprint part touches (they take the drag / pet ×2). */
  hitTargetIds: number[];
  /** Indices of unlit lamps this drop lights (비상등). */
  lamps: number[];
  /** An enemy footprint touches the sleepwalking child (it wakes up, steps back and cries). */
  startle: boolean;
  /** A pull / knockback part covers the open shaft (render brightens its rim). */
  holeCovered: boolean;
  /** An ally footprint touches the sleeping patient (bots aim heals at it). */
  patientHeal: boolean;
}

const alive = (e: Entity | undefined): e is Entity => !!e && e.hp > 0;

/** Same clamp as the sim's clampToArena (drop points never leave the arena). */
export function clampDrop(state: GameState, p: Vec2): Vec2 {
  const a = state.plan.arena;
  const c = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
  return {
    x: c(Number.isFinite(p.x) ? p.x : a.width / 2, ARENA_MARGIN, a.width - ARENA_MARGIN),
    y: c(Number.isFinite(p.y) ? p.y : a.height / 2, ARENA_MARGIN, a.height - ARENA_MARGIN),
  };
}

/** The dropped card's actions (drag skill or pet action) in the same order as previewPartsFor's parts. */
function actionsOf(state: GameState, player: number, kind: 'swap' | 'pet', index: number): readonly SkillAction[] {
  const p = state.players[player];
  if (!p) return [];
  if (kind === 'swap') {
    const m = p.party[index];
    return m ? partActions(getCharacter(m.defId).drag.actions) : []; // 기획 13차: one per preview part
  }
  const pet = p.pets[index];
  return pet ? [getPet(pet.defId).action] : [];
}

/** Lock radius of what the drop puts on the field: the character, a pet's summon, or nothing (other pets). */
function dropLockRadius(state: GameState, player: number, kind: 'swap' | 'pet', index: number, actions: readonly SkillAction[]): number | null {
  const p = state.players[player];
  if (!p) return null;
  if (kind === 'swap') {
    const m = p.party[index];
    return m ? lockRadius(getCharacter(m.defId).stats.range) : null;
  }
  const summon = actions.find(a => a.summon)?.summon;
  if (!summon) return null;
  const def = getMonster(summon.unitId);
  return def.inert ? null : lockRadius(def.stats.range);
}

function partHits(part: PreviewPart, at: Vec2, pos: Vec2, radius: number): boolean {
  const c = { x: at.x + part.offset.x, y: at.y + part.offset.y };
  return hitsArea(part.area, c, c, pos, radius);
}

/**
 * What dropping card `index` (kind 'swap' = party member, 'pet' = pet slot) of `player` at `pos` does to the running
 * 돌발 괴담. null when no event is active (the warning stage changes nothing).
 */
export function dropOutcome(state: GameState, player: number, kind: 'swap' | 'pet', index: number, pos: Vec2): DropOutcome | null {
  const ev = state.fieldEvent;
  if (!ev || ev.stage !== 'active') return null;
  const at = clampDrop(state, pos);
  const parts = previewPartsFor(state, player, kind, index);
  const actions = actionsOf(state, player, kind, index);
  const units = ev.entityIds.map(id => state.entities.find(e => e.id === id)).filter(alive);
  const out: DropOutcome = { lockTargetId: null, hitTargetIds: [], lamps: [], startle: false, holeCovered: false, patientHeal: false };
  const enemyParts = parts.filter(pt => pt.affects === 'enemies');
  const fieldParts = parts.filter(pt => pt.affects !== 'self');

  const targets = units.filter(e => e.eventTag === 'target');
  const lockR = dropLockRadius(state, player, kind, index, actions);
  let best = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.pos.x - at.x, t.pos.y - at.y) - t.radius;
    if (lockR != null && d <= lockR + 1e-9 && d < best) {
      best = d;
      out.lockTargetId = t.id;
    }
    if (enemyParts.some(pt => partHits(pt, at, t.pos, t.radius))) out.hitTargetIds.push(t.id);
  }

  if (ev.id === 'dark_lamps') {
    const prm = getFieldEvent(ev.id).params;
    ev.marks.forEach((m, i) => {
      if (m.doneBy != null) return;
      const near = Math.hypot(m.pos.x - at.x, m.pos.y - at.y) <= prm.dropRadius + 1e-9;
      if (near || fieldParts.some(pt => partHits(pt, at, m.pos, prm.partRadius))) out.lamps.push(i);
    });
  }
  const ward = units.find(e => e.eventTag === 'ward');
  if (ward && ev.id === 'sleepwalker') out.startle = enemyParts.some(pt => partHits(pt, at, ward.pos, ward.radius));
  if (ward && ev.id === 'sleeping_patient') out.patientHeal = parts.some(pt => pt.affects === 'allies' && partHits(pt, at, ward.pos, ward.radius));
  if (ev.id === 'open_shaft' && ev.marks[0]) {
    const hole = ev.marks[0];
    out.holeCovered = parts.some((pt, i) => {
      const moves = actions[i]?.effects.some(e => e.kind === 'pull' || e.kind === 'knockback');
      return !!moves && pt.affects === 'enemies' && partHits(pt, at, hole.pos, hole.radius);
    });
  }
  return out;
}
