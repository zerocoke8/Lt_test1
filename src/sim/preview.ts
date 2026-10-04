// Drag-preview footprint (R27: 미리보기 = 실제 판정 범위). PURE over the public GameState + content data, so the
// multiplayer client (RemoteGame) can call it on a snapshot and get exactly what the server sim will hit.

import type { GameState, PreviewPart, SkillAction, Vec2 } from '../types';
import { getCharacter, getPet } from '../data';
import { scaleArea, scaleDash } from './geometry';
import { skillMod } from './modifiers';

/** Radius multiplier the sim applies when this card is dropped (drag: skill 'radius' rewards; pets: none). */
export function previewRadiusMult(state: GameState, player: number, kind: 'swap' | 'pet', index: number): number {
  const p = state.players[player];
  if (!p || kind === 'pet') return 1;
  return 1 + skillMod(p, index, 'drag', 'radius');
}

/** Footprint of a list of actions dropped at (0, 0) with the given radius multiplier. */
export function partsForActions(actions: readonly SkillAction[], radiusMult: number): PreviewPart[] {
  const parts: PreviewPart[] = [];
  // where the caster stands relative to the drop point ('self' actions after a dash happen at the dash end)
  const caster: Vec2 = { x: 0, y: 0 };
  for (const a of actions) {
    const base: Vec2 = a.center === 'self' ? { x: caster.x, y: caster.y } : { x: 0, y: 0 };
    const offset = { x: base.x + (a.offset?.x ?? 0), y: base.y + (a.offset?.y ?? 0) };
    const part: PreviewPart = {
      area: scaleArea(a.area, radiusMult),
      offset,
      delay: a.delay ?? 0,
      affects: a.affects,
    };
    if (a.dash) {
      part.dash = scaleDash(a.dash, radiusMult);
      const u = part.dash.dir;
      caster.x = offset.x + (u === 'right' ? 1 : u === 'left' ? -1 : 0) * part.dash.distance;
      caster.y = offset.y + (u === 'down' ? 1 : u === 'up' ? -1 : 0) * part.dash.distance;
    }
    parts.push(part);
  }
  return parts;
}

/**
 * Every action of the drag skill (kind 'swap', index = party index) or pet action (kind 'pet', index = pet slot) as
 * preview parts relative to the drop point, with the player's radius rewards applied the same way the sim does.
 * Unknown player/index → [{ single }].
 */
export function previewPartsFor(state: GameState, player: number, kind: 'swap' | 'pet', index: number): PreviewPart[] {
  const p = state.players[player];
  const fallback: PreviewPart[] = [{ area: { shape: 'single' }, offset: { x: 0, y: 0 }, delay: 0, affects: 'enemies' }];
  if (!p) return fallback;
  if (kind === 'swap') {
    const m = p.party[index];
    if (!m) return fallback;
    const parts = partsForActions(getCharacter(m.defId).drag.actions, previewRadiusMult(state, player, kind, index));
    return parts.length ? parts : fallback;
  }
  const pet = p.pets[index];
  if (!pet) return fallback;
  return partsForActions([getPet(pet.defId).action], 1);
}
