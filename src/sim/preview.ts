// Drag-preview footprint (R27: 미리보기 = 실제 판정 범위). PURE over the public GameState + content data, so the
// multiplayer client (RemoteGame) can call it on a snapshot and get exactly what the server sim will hit.

import type { AreaShape, Dir, GameState, PreviewPart, SkillAction, Vec2 } from '../types';
import { getCharacter, getPet } from '../data';
import { scaleArea, scaleDash } from './geometry';
import { skillMod } from './modifiers';
import { rwDragRadiusAdd, rwPetRadiusAdd } from './rewards/hooks';

/** Radius multiplier the sim applies when this card is dropped (drag: skill 'radius' rewards; pets: none). */
export function previewRadiusMult(state: GameState, player: number, kind: 'swap' | 'pet', index: number): number {
  const p = state.players[player];
  if (!p) return 1;
  // 기획 17차: the rewards' pure radius additions (per-swap extras from onAppear are not shown)
  if (kind === 'pet') return 1 + rwPetRadiusAdd(p);
  return 1 + skillMod(p, index, 'drag', 'radius') + rwDragRadiusAdd(p, index);
}

/**
 * The actions that have a preview part, in part order (기획 13차: a woundedAlly pick — 메딕 주사 — lands on an ally
 * somewhere in range, not at the drop point, so it has none). Zip parts with these, never with the raw action list.
 */
export function partActions(actions: readonly SkillAction[]): SkillAction[] {
  return actions.filter(a => a.center !== 'woundedAlly');
}

/** Footprint of a list of actions dropped at (0, 0) with the given radius multiplier (one part per partActions entry). */
export function partsForActions(actions: readonly SkillAction[], radiusMult: number): PreviewPart[] {
  const parts: PreviewPart[] = [];
  // where the caster stands relative to the drop point ('self' actions after a dash happen at the dash end)
  const caster: Vec2 = { x: 0, y: 0 };
  for (const a of partActions(actions)) {
    const base: Vec2 = a.center === 'self' ? { x: caster.x, y: caster.y } : { x: 0, y: 0 };
    const offset = { x: base.x + (a.offset?.x ?? 0), y: base.y + (a.offset?.y ?? 0) };
    const part: PreviewPart = {
      area: chargeArea(a, offset, caster, radiusMult) ?? scaleArea(a.area, radiusMult),
      offset,
      delay: a.delay ?? 0,
      affects: a.affects,
    };
    if (a.dash) {
      const d = scaleDash(a.dash, radiusMult);
      // 기획 13차 atFire (반동, 질주): the caster moves but the move is not a hit path
      if (!a.dash.atFire) part.dash = d;
      const from = a.dash.atFire ? caster : offset;
      const u = d.dir;
      caster.x = from.x + (u === 'right' ? 1 : u === 'left' ? -1 : 0) * d.distance;
      caster.y = from.y + (u === 'down' ? 1 : u === 'up' ? -1 : 0) * d.distance;
    }
    parts.push(part);
    if (a.charge?.stopAtCenter) {
      caster.x = offset.x;
      caster.y = offset.y;
    }
  }
  return parts;
}

/**
 * 기획 13차 (블레이드 되돌아 베기): a rush back to the drop point is drawn as the band it sweeps — from where the caster
 * stands (after its dash) to the center — when that path is axis-aligned; null = use the area as it is.
 */
function chargeArea(a: SkillAction, center: Vec2, caster: Vec2, radiusMult: number): AreaShape | null {
  if (!a.charge || a.area.shape !== 'line') return null;
  const dx = caster.x - center.x;
  const dy = caster.y - center.y;
  const len = Math.min(Math.hypot(dx, dy), a.charge.distance * radiusMult);
  if (len < 1e-6 || (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6)) return null;
  const dir: Dir = Math.abs(dx) > 1e-6 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  return { shape: 'rect', dir, anchor: 'start', length: len, width: a.area.width * radiusMult };
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
  return partsForActions([getPet(pet.defId).action], previewRadiusMult(state, player, kind, index));
}
