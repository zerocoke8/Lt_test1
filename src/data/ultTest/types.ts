// 기획 22차 궁극기 테스트 (docs/ult-test.md): the shape of a character's own 조준 / 드래그 ult. Types and the shared
// rule numbers only — the two content files (groupA.ts, groupB.ts) import from here, never from index.ts (no cycle).

import type { Affects, Effect, SkillDef } from '../../types';

/**
 * 드래그 방식: how the field character gets to the dragged point before its 드래그 ult is cast.
 *  - kind 'blink': vanishes and appears there; 'dash': a fast rush (a streak) — both move at once (0 s), like a drag
 *    card landing; the ult's effects still wait for the cut-in (≥ 0.45 s).
 *  - maxRange: the farthest it goes (cells); a point farther away is pulled back along the line.
 *  - path (optional): a hit along the way (from where it stood to where it lands), `width` cells wide, landing at
 *    `delay` s (default ULT_TEST.firstHit). Telegraphed only for its last 0 s (no warning: it is our own hit).
 */
export interface UltMove {
  kind: 'dash' | 'blink';
  maxRange: number;
  path?: { width: number; affects: Affects; effects: Effect[]; delay?: number; stage?: string };
}

/**
 * One alternate ult of a character (궁극기 테스트 only): exactly the shape of CharacterDef.ult (a SkillDef with slot
 * 'ult'), plus the fields below. How the actions read the aim:
 *  - center 'point'  = the aimed point (조준) / the spot the character landed on (드래그).
 *  - center 'self'   = the caster (조준: where it stands; 드래그: where it landed).
 *  - center 'target' = the enemy nearest the aimed / landing point within ULT_TEST.snapRadius (조준 with nobody there:
 *    the point itself; 드래그 with nobody there: the character's own target).
 *  - rel 'aim'       = offset / rect / cone / dash direction written as if aiming at +x (ahead = +x, +y = its right),
 *    turned toward the aim when cast. 조준: from the caster to the aimed point. 드래그: the way the character moved.
 *  - follow, delay, hits, zone, summon, dash, charge … work exactly as in every other skill (src/types.ts SkillAction).
 */
export interface UltAltDef extends SkillDef {
  slot: 'ult';
  /** 드래그 only (ignored by 조준): the move to the point. Absent = { kind: 'blink', maxRange: ULT_TEST.dragRange }. */
  move?: UltMove;
  /** 조준 only: the aimed point is kept within this many cells of the caster. Absent = anywhere on the field. */
  aimRange?: number;
  /** Where a bot aims it: 'enemy' (default: the boss / its target), 'ally' (the most hurt ally), 'self' (where it stands). */
  botAim?: 'enemy' | 'ally' | 'self';
}

/** A character's alternates: aim = 조준 방식, drag = 드래그 방식. A missing one uses the fallback (docs/ult-test.md 4장). */
export interface UltAltSet {
  aim?: UltAltDef;
  drag?: UltAltDef;
}

/** The rule numbers of the mode (one place; docs/ult-test.md quotes them). */
export const ULT_TEST = {
  /** An enemy whose edge is within this many cells of the aimed / landing point becomes a 'target' part's target. */
  snapRadius: 2.5,
  /** 드래그 fallback (and an alt without `move`): the farthest the character moves (cells). */
  dragRange: 9,
  /** Seconds the dash streak takes on screen (render only; the sim moves at once). */
  dashDuration: 0.16,
  /** The first beat of an ult (the cut-in rule: effects from 0.45 s, movement may be at 0 s). */
  firstHit: 0.45,
  /** The fallback treats an ally circle this big as 'every ally on the field' (left as it is, never re-centred). */
  wholeField: 50,
  /**
   * 멀티: an aim's `from` (where the sender's screen showed the character, a little behind the server) counts only this
   * many cells from the real spot (≈ the lag of a walking character; a farther one is pulled in to this distance).
   */
  fromSlack: 2.5,
  /**
   * Floor reward families never offered in 궁극기 테스트 (on top of BOSS_RAID.rewardsOff): 두 번 차는 게이지 and 궁극기
   * 여운 replay TODAY's ult, not the 조준 / 드래그 ult that was cast — they would muddle what is being tried out.
   */
  rewardsOff: ['overcharge', 'ult_linger'] as readonly string[],
} as const;

/** 기획 13차: every ult stands still through the cut-in (the same 0.5 s as src/data/characters.ts ULT_CAST). */
export const ULT_CAST_TIME = 0.5;
