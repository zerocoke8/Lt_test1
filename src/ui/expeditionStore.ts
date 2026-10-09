// 기획 15차 원정: browser persistence of the stash (보관함) and the mode choice (docs/expedition.md 10장). The model and
// every change live in src/expedition/stash.ts (pure); this file only reads / writes localStorage. Every access is
// wrapped: blocked or cleared storage starts an empty stash and the game keeps working (nothing is saved then).
// 기획 16차: the run in progress lives in the same record (StashData.run), and two tabs may share it — every change is
// 「read → change → save」 (updateStash), other tabs' saves arrive through onStashChanged, and each page load has its own
// tab id (a solo stage's tab writes a heartbeat into run.pending.aliveAt; docs/expedition.md 10-4).

import { MODE_KEY, STASH_KEY, parseStash, serializeStash, type StashData } from '../expedition/stash';
import type { ExpeditionRun } from '../expedition/run';

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

/**
 * 기획 16차: 「read → change → save」. The stored stash is read again first (another tab may have changed it — e.g. claimed
 * the run), `fn` changes it, and it is saved. Blocked storage (or nothing stored yet) works on `cur` in memory instead.
 * Returns the stash now current and fn's result.
 */
export function updateStash<T>(cur: StashData, fn: (s: StashData) => T, st: KeyValueStore | null = storage()): { stash: StashData; result: T } {
  let s = cur;
  try {
    const raw = st?.getItem(STASH_KEY);
    if (raw != null) s = parseStash(raw);
  } catch {
    s = cur;
  }
  const result = fn(s);
  saveStash(s, st);
  return { stash: s, result };
}

/** 기획 16차: another tab saved the stash (window 'storage' event). Returns the unsubscribe. */
export function onStashChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const on = (e: StorageEvent) => {
    if (e.key === STASH_KEY || e.key === null) cb();
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}

const ID_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 기획 16차: a random id of RUN_ID_RE's alphabet (crypto when there is one; UI only — never in the sim). */
export function randomRunId(n = 16): string {
  const bytes = new Uint8Array(n);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => ID_ABC[b % ID_ABC.length]).join('');
}

/** A random 32-bit seed for a run's solo stage games. */
export function randomSeed(): number {
  const a = new Uint32Array(1);
  try {
    crypto.getRandomValues(a);
    return a[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32) >>> 0;
  }
}

/** 기획 16차: this page load's tab id (run.pending.tabId: which tab plays a stage). */
export const TAB_ID = randomRunId(12);

/** 기획 16차: a solo stage whose tab has not written its heartbeat for this long is over (failed, 5-3). */
export const SOLO_STALE_MS = 10_000;

/** What this page knows when it looks at a stored run it is not playing / queueing itself. */
export interface ReconcileCtx {
  now: number;
  tabId: string;
  /** This page plays a stage or sits in a queue right now (its own run: nothing to settle). */
  busy: boolean;
  /** The solo match screen of this page is up ('matching' is its own). */
  matching: boolean;
  /** The game server is online and its welcome.bootId (null = not connected / no server). */
  bootId: string | null;
}

/**
 * 기획 16차 (10-4): what to do with the stored run. 'toLobby' = a 'matching' run nobody is matching (no live queue);
 * 'void' = an online stage whose server restarted (another boot id); 'status' = ask the same server for the result;
 * 'fail' = a solo stage whose tab went silent > 10 s (closed / reloaded mid-stage); 'won' = the same, but its combat was
 * already won (pending.won saved: a clear, 5-3); 'wait' = keep waiting (another tab plays it, or the server is not
 * reachable yet); 'none' = nothing to settle.
 */
export function reconcileDecision(run: ExpeditionRun | null, c: ReconcileCtx): 'none' | 'toLobby' | 'void' | 'status' | 'fail' | 'won' | 'wait' {
  if (!run || c.busy) return 'none';
  if (run.status === 'matching') return c.matching ? 'none' : 'toLobby';
  if (run.status !== 'inStage' || !run.pending) return 'none';
  const p = run.pending;
  if (p.online) {
    if (!c.bootId) return 'wait';
    return p.bootId && c.bootId !== p.bootId ? 'void' : 'status';
  }
  if (p.tabId !== c.tabId && c.now - p.aliveAt <= SOLO_STALE_MS) return 'wait';
  return p.won ? 'won' : 'fail';
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
