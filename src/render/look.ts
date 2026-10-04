// Placeholder art palette + per-def "look" cache (colors, glyphs, body shape). Render-only.

import type { EntityKind, Role } from '../types';
import { getCharacter, getMonster, getPet } from '../data';

export const FONT_STACK =
  '"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic","WenQuanYi Zen Hei",system-ui,sans-serif';

/** Other players' skill flashes and fields are drawn at this strength (mine at 1): my own fight stays readable. */
export const OTHER_PLAYER_FX = 0.55;

export const COLORS = {
  ally: '#4ade80',
  allyHpBack: '#0e2a18',
  enemy: '#ef4444',
  enemyHpBack: '#2a0e0e',
  hpLag: '#ffe08a',
  shield: '#ffffff',
  barFrame: '#05060a',
  buff: '#2ec4b6',
  debuff: '#ff4d6d',
  telegraphEnemy: '#ff3b3b',
  telegraphAlly: '#3ba0ff',
  previewValid: '#4cc9f0',
  previewInvalid: '#ff4d4d',
  zoneDamageAlly: '#ff9f1c',
  zoneDamageEnemy: '#e5383b',
  zoneHeal: '#52d273',
  zoneBuff: '#ffd166',
  zoneDebuff: '#9d4edd',
  spawnWarn: '#ff4fa3',
  dmgEnemy: '#ffffff',
  dmgCrit: '#ffd60a',
  dmgAlly: '#ff5c5c',
  heal: '#5cff8d',
  absorbed: '#c7d2fe',
  marker: '#ffffff',
  enemyRing: '#7a1020',
} as const;

export const ROLE_GLYPH: Record<Role, string> = { tank: '방', melee: '근', ranged: '원', support: '지' };

// ─────────────────────────── color helpers (cached, no per-frame churn) ───────────────────────────

const rgbCache = new Map<string, [number, number, number]>();

export function parseColor(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (c) return c;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  c = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [160, 160, 160];
  rgbCache.set(hex, c);
  return c;
}

const mixCache = new Map<string, string>();

/** Mix `hex` toward `toward` by t (0..1). Result cached as css string. */
export function mix(hex: string, toward: string, t: number): string {
  const key = hex + toward + t.toFixed(3);
  let s = mixCache.get(key);
  if (s) return s;
  const a = parseColor(hex);
  const b = parseColor(toward);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  s = `rgb(${r},${g},${bl})`;
  mixCache.set(key, s);
  return s;
}

export const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number) => mix(hex, '#000000', t);

// ─────────────────────────── unit looks ───────────────────────────

export type BodyShape =
  | 'hero'
  | 'slime'
  | 'goblin'
  | 'skeleton'
  | 'bomb'
  | 'golem'
  | 'ogre'
  | 'lich'
  | 'turret'
  | 'blob';

/** Hand-held prop drawn on heroes (placeholder art). */
export type Accessory = 'shield' | 'sword' | 'axe' | 'bow' | 'orb' | 'staff' | 'hammer' | 'gun' | 'lute' | 'none';

const ACCESSORY_BY_ID: Record<string, Accessory> = {
  guardian: 'shield',
  blade: 'sword',
  berserker: 'axe',
  ranger: 'bow',
  mage: 'orb',
  cleric: 'staff',
  paladin: 'hammer',
  warden: 'shield',
  shadow: 'sword',
  gunner: 'gun',
  bard: 'lute',
  chrono: 'orb',
};
const ACCESSORY_BY_ROLE: Record<Role, Accessory> = { tank: 'shield', melee: 'sword', ranged: 'bow', support: 'staff' };

export interface UnitLook {
  name: string;
  color: string;
  light: string;
  dark: string;
  outline: string;
  flash: string;
  glyph: string;
  role: Role | null;
  shape: BodyShape;
  accessory: Accessory;
  ranged: boolean;
  /** Body height as a multiple of diameter. */
  heightMul: number;
}

const SHAPE_BY_ID: Record<string, BodyShape> = {
  slime: 'slime',
  goblin: 'goblin',
  skeleton_archer: 'skeleton',
  bomb_bug: 'bomb',
  golem: 'golem',
  ogre: 'ogre',
  lich: 'lich',
  turret: 'turret',
};

const HEIGHT_BY_SHAPE: Record<BodyShape, number> = {
  hero: 1.3,
  slime: 0.8,
  goblin: 1.05,
  skeleton: 1.3,
  bomb: 0.95,
  golem: 1.05,
  ogre: 1.2,
  lich: 1.35,
  turret: 1.0,
  blob: 1.0,
};

function makeLook(name: string, color: string, glyph: string, role: Role | null, shape: BodyShape, ranged: boolean, accessory: Accessory = 'none'): UnitLook {
  return {
    accessory,
    name,
    color,
    light: lighten(color, 0.35),
    dark: darken(color, 0.35),
    outline: darken(color, 0.7),
    flash: lighten(color, 0.8),
    glyph,
    role,
    shape,
    ranged,
    heightMul: HEIGHT_BY_SHAPE[shape],
  };
}

const lookCache = new Map<string, UnitLook>();
const FALLBACK = makeLook('?', '#9aa0a6', '?', null, 'blob', false);

export function unitLook(kind: EntityKind, defId: string): UnitLook {
  const key = kind + ':' + defId;
  let look = lookCache.get(key);
  if (look) return look;
  try {
    if (kind === 'character') {
      const d = getCharacter(defId);
      look = makeLook(d.name, d.color, ROLE_GLYPH[d.role], d.role, 'hero', d.basic.kind === 'projectile', ACCESSORY_BY_ID[d.id] ?? ACCESSORY_BY_ROLE[d.role]);
    } else {
      const d = getMonster(defId);
      look = makeLook(d.name, d.color, '', null, SHAPE_BY_ID[d.id] ?? 'blob', d.basic.kind === 'projectile');
    }
  } catch {
    look = { ...FALLBACK };
  }
  lookCache.set(key, look);
  return look;
}

export function petColor(petId: string): string | null {
  try {
    return getPet(petId).color;
  } catch {
    return null;
  }
}

/** Pre-built bold font strings by px size (avoids building strings every frame). */
const fontCache = new Map<number, string>();
export function boldFont(px: number): string {
  const k = Math.round(px);
  let f = fontCache.get(k);
  if (!f) {
    f = `800 ${k}px ${FONT_STACK}`;
    fontCache.set(k, f);
  }
  return f;
}
