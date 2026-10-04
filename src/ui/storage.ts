// localStorage persistence (every access wrapped: private mode / blocked storage must not break the game).

import type { Tunables } from '../types';
import { CHARACTERS, PETS } from '../data';
import { diffFromDefaults, sanitizeOverrides } from './tunables';

const PRESET_KEY = 'swapTower.preset.v1';
const TUNABLES_KEY = 'swapTower.debugTunables.v1';

export interface PresetSave {
  /** 3 character ids; order = slot 1/2/3 (slot 1 starts on field). */
  characters: string[];
  pets: string[];
}

export const DEFAULT_PRESET: PresetSave = {
  characters: ['blade', 'mage', 'cleric'],
  pets: ['frog_bomb', 'fairy_heal', 'cat_void'],
};

function uniqueValid(list: unknown, valid: ReadonlySet<string>, max: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const id of list) {
    if (typeof id === 'string' && valid.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Validate a stored preset; unknown ids dropped, then topped up from the default preset to 3+3. */
export function sanitizePreset(raw: unknown): PresetSave {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const chars = uniqueValid(r.characters, new Set(CHARACTERS.map(c => c.id)), 3);
  const pets = uniqueValid(r.pets, new Set(PETS.map(p => p.id)), 3);
  const fill = (cur: string[], defaults: string[], all: string[]) => {
    for (const id of [...defaults, ...all]) {
      if (cur.length >= 3) break;
      if (!cur.includes(id)) cur.push(id);
    }
    return cur;
  };
  return {
    characters: fill(chars, DEFAULT_PRESET.characters, CHARACTERS.map(c => c.id)),
    pets: fill(pets, DEFAULT_PRESET.pets, PETS.map(p => p.id)),
  };
}

function read(key: string): unknown {
  try {
    const s = globalThis.localStorage?.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function loadPreset(): PresetSave {
  return sanitizePreset(read(PRESET_KEY));
}

export function savePreset(p: PresetSave): void {
  write(PRESET_KEY, p);
}

export function loadTunableOverrides(): Partial<Tunables> {
  return sanitizeOverrides(read(TUNABLES_KEY));
}

export function saveTunableOverrides(t: Tunables): void {
  write(TUNABLES_KEY, diffFromDefaults(t));
}

export function clearTunableOverrides(): void {
  try {
    globalThis.localStorage?.removeItem(TUNABLES_KEY);
  } catch {
    /* ignore */
  }
}
