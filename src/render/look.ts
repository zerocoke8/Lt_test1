// Placeholder art palette + per-def "look" cache (colors, glyphs, body shape). Render-only.

import type { EntityKind, MonsterDef, Role } from '../types';
import { getCharacter, getMonster, getPet } from '../data';
import { type CreatureShape, creatureArtFor } from './creatures';
import { darken, lighten } from './color';
import { MINION_LOOKS, bossLook } from './bosses';

export const FONT_STACK =
  '"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic","WenQuanYi Zen Hei",system-ui,sans-serif';

/** Other players' skill flashes and fields are drawn at this strength (mine at 1): my own fight stays readable. */
export const OTHER_PLAYER_FX = 0.55;
/** Other players' persistent fields (their pets, their cleric spring …): dashed outline only, at this opacity. */
export const OTHER_ZONE_ALPHA = 0.32;

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

export const ROLE_GLYPH: Record<Role, string> = { tank: '방', melee: '근', ranged: '원', healer: '힐', support: '지' };

// colour helpers (cached): src/render/color.ts (기획 19차: a leaf module, re-exported here for every older import)
export { darken, lighten, mix, parseColor } from './color';

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
  | 'blob'
  | CreatureShape;

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
  // 기획 12차 (placeholder props: syringe / talisman bundle / spool later)
  medic: 'staff',
  exorcist: 'staff',
  puppeteer: 'orb',
};
const ACCESSORY_BY_ROLE: Record<Role, Accessory> = { tank: 'shield', melee: 'sword', ranged: 'bow', healer: 'staff', support: 'staff' };

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
  umbrella: 1.15,
  shadow_child: 1.15,
  vending: 1.4,
  phone: 0.95,
  mannequin: 1.3,
  office_ghost: 1.25,
  copy: 1.35,
  copy_mini: 1.3,
  patient: 1.35,
  wheelchair: 1.05,
  doll: 1.2,
  paper_doll: 1.25, // 기획 12차
  eye_stalk: 1.6,
  red_mask: 1.5,
  giant_mannequin: 1.3,
  mourner: 1.45,
  elevator_girl: 1.45,
  copier: 1.05,
  head_nurse: 1.55,
  signal: 1.5,
  // 기획 12차: 돌발 괴담 (render/creatures.ts)
  lucky_toad: 0.95,
  event_printer: 0.85,
  event_patient: 0.75,
  night_shadow: 1.35,
  sleepwalker_child: 1.3,
};

/** Boss set-piece colours (the boss renderer draws the body; this tints hit flashes / ghosts / labels). */
const BOSS_COLOR: Record<string, { name: string; color: string }> = {
  elevator_keeper: { name: '닫히지 않는 엘리베이터', color: '#8a929c' },
  overtime_lord: { name: '야근의 군주', color: '#5aa9ff' },
  surgeon_director: { name: '수술실 원장', color: '#3fae8c' },
  abyss_watcher: { name: '심연의 감시자', color: '#3a0ca3' },
};

function tryMonster(id: string): MonsterDef | null {
  try {
    return getMonster(id);
  } catch {
    return null;
  }
}

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

/** 기획 19차: body height × diameter of a boss summon drawn through MINION_LOOKS. */
const MINION_HEIGHT = 1.2;

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
      // 기획 8차: 괴담 looks by id (content contract) or MonsterDef.look; data may not know a new id yet
      const d = tryMonster(defId);
      // 기획 19차: a new boss's summon-only unit (뽑기 인형 …) draws through MINION_LOOKS — before the look aliases
      const minion = d?.look != null && MINION_LOOKS[d.look] ? d.look : null;
      const art = minion ? null : creatureArtFor(defId, d?.look);
      const boss = BOSS_COLOR[defId];
      // 기획 19차: a registered boss look (src/render/bosses/) names its own colour (hit flashes / ghosts / labels)
      const raidBoss = !boss && d?.tier === 'boss' ? bossLook(defId) : undefined;
      if (minion && d) {
        look = makeLook(d.name, d.color, '', null, minion as BodyShape, d.basic.kind === 'projectile');
        look.heightMul = MINION_HEIGHT;
      } else if (raidBoss && d) {
        look = makeLook(d.name, raidBoss.color, '', null, 'blob', true);
      } else if (art) {
        look = makeLook(d?.name ?? art.name, art.color, '', null, art.shape, d ? d.basic.kind === 'projectile' : art.ranged);
        look.heightMul = art.heightMul;
      } else if (boss) {
        look = makeLook(d?.name ?? boss.name, boss.color, '', null, 'blob', true);
      } else if (d) {
        look = makeLook(d.name, d.color, '', null, SHAPE_BY_ID[d.id] ?? 'blob', d.basic.kind === 'projectile');
      } else look = { ...FALLBACK };
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

/**
 * 기획 13차 리뷰 (skill-renewal 2-4: red = monster warnings): a character whose own colour is red draws its skill areas
 * (drag preview, warnings, beats) in another colour — 퇴마사's are talisman yellow, its ink red stays for thin strokes.
 */
const AREA_COLOR: Readonly<Record<string, string>> = { exorcist: '#ffd166' };

export function areaColor(defId: string, base: string): string {
  return AREA_COLOR[defId] ?? base;
}
