// 기획 22차 궁극기 테스트 (docs/ult-test.md): the registry of the characters' own 조준 / 드래그 ults. The two content
// files (groupA.ts / groupB.ts, split by roster order) fill it; a character or a mode that has none uses the fallback
// in src/sim/ultTest.ts, so all 15 always work. Read by the sim (cast + bots), the multiplayer client (preview), the
// HUD (name), the renderer (stage looks) and the sound director (stage cues) — every lookup goes through here.

import type { UltAltDef, UltAltSet } from './types';
import { GROUP_A } from './groupA';
import { GROUP_B } from './groupB';

export type { UltAltDef, UltAltSet, UltMove } from './types';
export { ULT_TEST, ULT_CAST_TIME } from './types';

/** Characters of each content group, in roster order (docs/ult-test.md 5-3; tests check the split covers the roster). */
export const ULT_GROUP_A_IDS: readonly string[] = ['guardian', 'paladin', 'warden', 'blade', 'berserker', 'shadow', 'ranger', 'mage'];
export const ULT_GROUP_B_IDS: readonly string[] = ['gunner', 'cleric', 'medic', 'exorcist', 'bard', 'chrono', 'puppeteer'];

/** Every character's alternates (group A, then group B). Live: tests may add a fixture with setUltAltFixture. */
const ALTS = new Map<string, UltAltSet>([...Object.entries(GROUP_A), ...Object.entries(GROUP_B)]);

/** Every registered character id with its alternates (tests check the data; a key that is not a character is an error). */
export function ultAltEntries(): [string, UltAltSet][] {
  return [...ALTS.entries()];
}

/** The character's own ult for this mode (null = none yet → the fallback). */
export function ultAlt(charId: string, mode: 'aim' | 'drag'): UltAltDef | null {
  return ALTS.get(charId)?.[mode] ?? null;
}

/**
 * An alternate ult by its skill id (render / sound look up a cast's actions and owner by skillId). Null for an id that is
 * not an alternate — a fallback cast keeps today's ult id.
 */
export function ultAltBySkill(skillId: string): { charId: string; mode: 'aim' | 'drag'; def: UltAltDef } | null {
  for (const [charId, set] of ALTS) {
    for (const mode of ['aim', 'drag'] as const) {
      const def = set[mode];
      if (def?.id === skillId) return { charId, mode, def };
    }
  }
  return null;
}

/**
 * TESTS ONLY: put a fixture set in for a character (null = back to the data files' set). Returns the undo. Never call
 * it from game code — the data lives in groupA.ts / groupB.ts.
 */
export function setUltAltFixture(charId: string, set: UltAltSet | null): () => void {
  const before = ALTS.get(charId);
  const data = GROUP_A[charId] ?? GROUP_B[charId];
  if (set) ALTS.set(charId, set);
  else if (data) ALTS.set(charId, data);
  else ALTS.delete(charId);
  return () => {
    if (before) ALTS.set(charId, before);
    else ALTS.delete(charId);
  };
}
