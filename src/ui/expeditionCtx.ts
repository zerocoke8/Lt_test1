// 기획 15차 원정: what every expedition screen shares — the live stash (mutated by src/expedition/stash.ts helpers, then
// saved), the expedition party (kept apart from the classic preset) and a toaster.

import type { StashData, StashPreset } from '../expedition/stash';
import type { ToastKind } from './toast';

export interface ExpCtx {
  /** The live stash (screens mutate it through the stash helpers, then call save()). */
  readonly stash: StashData;
  /** Persist the stash (localStorage; a blocked storage keeps it in memory only). */
  save(): void;
  /** Replace the whole stash (debug 「보관함 초기화」). */
  replace(s: StashData): void;
  /** The expedition party (stash.preset, else the default). */
  party(): StashPreset;
  toast(text: string, kind?: ToastKind): void;
}

/** A starting expedition party when none is saved yet (a sturdy mix: tank, melee, healer). */
export const DEFAULT_EXP_PARTY: StashPreset = { characters: ['guardian', 'blade', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
