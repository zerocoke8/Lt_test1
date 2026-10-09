// 기획 15차 원정: what every expedition screen shares — the live stash (mutated by src/expedition/stash.ts helpers, then
// saved), the expedition party (kept apart from the classic preset) and a toaster.
// 기획 16차: every change goes through update() — 「read → change → save」, so a second tab's save (a claim, a stage
// result) is never overwritten by this tab's older copy (docs/expedition.md 10-4).

import type { StashData, StashPreset } from '../expedition/stash';
import type { ToastKind } from './toast';

export interface ExpCtx {
  /** The live stash (read-only use: changes go through update()). */
  readonly stash: StashData;
  /** 기획 16차: re-read the stored stash, change it with the stash helpers, save it (blocked storage: in memory). */
  update<T>(fn: (s: StashData) => T): T;
  /** Replace the whole stash (debug 「보관함 초기화」: resetStash returns a new one). */
  replace(fn: (s: StashData) => StashData): void;
  /** The expedition party (stash.preset, else the default). */
  party(): StashPreset;
  toast(text: string, kind?: ToastKind): void;
}

/** A starting expedition party when none is saved yet (a sturdy mix: tank, melee, healer). */
export const DEFAULT_EXP_PARTY: StashPreset = { characters: ['guardian', 'blade', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
