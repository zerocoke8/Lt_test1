// Snapshot encoding: the sim's live state carries runtime-only fields ('rt' on entities/players/members/zones/
// projectiles, 'src' on statuses). The wire copy keeps only contract fields and rounds floats to 2 decimals.
// Two contract fields the client never reads are thinned (same shape, less churn for deflate):
// - plan.waves[].spawns → [] (the HUD only counts waves; the plan is otherwise ~1.3 KB per snapshot),
// - Entity.targetHeldFor → whole seconds (changes every tick; only the sim's optional boss-lock release reads it).

import type { GameState } from '../src/types';

/** Sim-internal keys that never go on the wire. */
const INTERNAL_KEYS: ReadonlySet<string> = new Set(['rt', 'src']);

export function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (Number.isInteger(v)) return v;
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r; // no "-0"
}

const EMPTY: readonly never[] = [];

function replacer(this: unknown, key: string, value: unknown): unknown {
  if (INTERNAL_KEYS.has(key)) return undefined;
  if (typeof value === 'number') return key === 'targetHeldFor' ? Math.floor(value) || 0 : round2(value);
  if (key === 'spawns' && Array.isArray(value)) return EMPTY;
  return value;
}

/** JSON of any sim value (state, events, telemetry) without internal fields, floats rounded. */
export function wireJson(value: unknown): string {
  return JSON.stringify(value, replacer) ?? 'null';
}

/** Plain deep copy of a GameState as clients receive it (tests / tools; the server sends wireJson directly). */
export function cleanState(s: GameState): GameState {
  return JSON.parse(wireJson(s)) as GameState;
}
