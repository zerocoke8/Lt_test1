// 기획 15차 원정: browser persistence of the stash (보관함) and the mode choice (docs/expedition.md 10장). The model and
// every change live in src/expedition/stash.ts (pure); this file only reads / writes localStorage. Every access is
// wrapped: blocked or cleared storage starts an empty stash and the game keeps working (nothing is saved then).

import { MODE_KEY, STASH_KEY, parseStash, serializeStash, type StashData } from '../expedition/stash';

export type GameMode = 'classic' | 'expedition';

/** Client-only debug setting 「장비 그림: 코드 / 파일」 (battle hand). Not a sim tunable. */
export const GEAR_ART_KEY = 'swapTower.gearArt.v1';

/** Minimal Storage surface (tests pass a Map-backed fake). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function storage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRaw(key: string, st: KeyValueStore | null = storage()): string | null {
  try {
    return st?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string, st: KeyValueStore | null = storage()): boolean {
  try {
    if (!st) return false;
    st.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The saved stash (corrupt, old-version or missing → an empty one). Never throws. */
export function loadStash(st: KeyValueStore | null = storage()): StashData {
  return parseStash(readRaw(STASH_KEY, st));
}

/** False when it could not be saved (storage blocked / full). */
export function saveStash(s: StashData, st: KeyValueStore | null = storage()): boolean {
  return writeRaw(STASH_KEY, serializeStash(s), st);
}

export function loadMode(st: KeyValueStore | null = storage()): GameMode | null {
  const v = readRaw(MODE_KEY, st);
  return v === 'classic' || v === 'expedition' ? v : null;
}

export function saveMode(m: GameMode, st: KeyValueStore | null = storage()): void {
  writeRaw(MODE_KEY, m, st);
}

export function loadGearArtFiles(st: KeyValueStore | null = storage()): boolean {
  return readRaw(GEAR_ART_KEY, st) === 'file';
}

export function saveGearArtFiles(on: boolean, st: KeyValueStore | null = storage()): void {
  writeRaw(GEAR_ART_KEY, on ? 'file' : 'code', st);
}
