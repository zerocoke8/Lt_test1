// localStorage persistence (every access wrapped: private mode / blocked storage must not break the game).

import type { Tunables } from '../types';
import { type JuiceSettings, sanitizeJuice } from '../render/juice';
import { type CutInSettings, sanitizeCutIn } from '../render/cutin';
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

// ─────────────── multiplayer nickname (매칭 화면) ───────────────

const NICK_KEY = 'swapTower.nickname.v1';
/** Same limit as the server (1–12 chars); the server sanitises again. */
export const NICKNAME_MAX = 12;

export function loadNickname(): string {
  const v = read(NICK_KEY);
  return typeof v === 'string' ? Array.from(v.trim()).slice(0, NICKNAME_MAX).join('') : '';
}

export function saveNickname(name: string): void {
  write(NICK_KEY, Array.from(name.trim()).slice(0, NICKNAME_MAX).join(''));
}

// ─────────────── one-time tips (스킬 정보 안내 …) ───────────────

const TIPS_KEY = 'swapTower.tipsSeen.v1';

/** Has this device already seen tip `id`? (storage blocked → treat as unseen; the tip is harmless) */
export function tipSeen(id: string): boolean {
  const v = read(TIPS_KEY);
  return Array.isArray(v) && v.includes(id);
}

export function markTipSeen(id: string): void {
  const v = read(TIPS_KEY);
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  if (!list.includes(id)) write(TIPS_KEY, [...list, id].slice(-20));
}

// ─────────────── render-only impact feel (기획 8차: 타격 멈춤 · 화면 흔들림), per device ───────────────

const JUICE_KEY = 'swapTower.juice.v1';

export function loadJuice(): JuiceSettings {
  return sanitizeJuice(read(JUICE_KEY));
}

export function saveJuice(j: JuiceSettings): void {
  write(JUICE_KEY, sanitizeJuice(j));
}

// ─────────────── 기획 13차: ult cut-in length ("컷인 짧게"), per device ───────────────

const CUTIN_KEY = 'swapTower.cutin.v1';

export function loadCutIn(): CutInSettings {
  return sanitizeCutIn(read(CUTIN_KEY));
}

export function saveCutIn(c: CutInSettings): void {
  write(CUTIN_KEY, sanitizeCutIn(c));
}

// ─────────────── 기획 17차 저스트 교대: device settings (진동 · 저스트 도우미 · 저스트 슬로) + the learner count ───────────────

const FEEL_KEY = 'swapTower.feel.v1';
/** docs/just-swap.md: the 「지금!」 chevrons show until this many 저스트 교대 succeeded on this device. */
const JUST_TUTOR_KEY = 'justTutor';
export const JUST_TUTOR_GOAL = 5;

export interface FeelSettings {
  /** Short vibration on my 저스트 (Android Chrome; iPhones ignore it). */
  vibrate: boolean;
  /** 「지금!」 chevrons over ready bench cards (learner help, until JUST_TUTOR_GOAL successes). */
  justHelper: boolean;
  /** Solo: my device runs the game at 0.3× for 0.3 s after my 저스트 (multiplayer never slows). */
  justSlow: boolean;
}

export const FEEL_DEFAULTS: Readonly<FeelSettings> = { vibrate: true, justHelper: true, justSlow: true };

/** Live settings (the pause menu writes here). */
export const FEEL: FeelSettings = { ...FEEL_DEFAULTS };

export function sanitizeFeel(raw: unknown): FeelSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return { vibrate: flag(r.vibrate, FEEL_DEFAULTS.vibrate), justHelper: flag(r.justHelper, FEEL_DEFAULTS.justHelper), justSlow: flag(r.justSlow, FEEL_DEFAULTS.justSlow) };
}

export function loadFeel(): FeelSettings {
  return sanitizeFeel(read(FEEL_KEY));
}

export function saveFeel(f: FeelSettings): void {
  write(FEEL_KEY, sanitizeFeel(f));
}

/** 저스트 교대 successes on this device (storage blocked → 0: the help shows every time). */
export function justTutorCount(): number {
  const v = read(JUST_TUTOR_KEY);
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

export function bumpJustTutor(): number {
  const n = Math.min(999, justTutorCount() + 1);
  write(JUST_TUTOR_KEY, n);
  return n;
}
