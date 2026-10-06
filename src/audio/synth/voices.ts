// 기획 13차 효과음: who sounds like what (docs/sfx.md 2-1, 3-2). Base pitch, material, chord quality, brightness.
// The parameterised sounds (등장, 일반스킬, 기본 공격, 궁극기 연타, 역할 기본) are built from these rows.

import type { Role } from '../../types';

export type Material =
  | 'steel'
  | 'holy'
  | 'chain'
  | 'blade'
  | 'blood'
  | 'shadow'
  | 'wind'
  | 'magic'
  | 'powder'
  | 'medical'
  | 'talisman'
  | 'music'
  | 'time'
  | 'thread';

export interface Voice {
  /** Base pitch (Hz). */
  base: number;
  mat: Material;
  chord: 'maj' | 'min' | 'dim' | 'sus';
  /** 0 dark … 1 bright (filter cut-offs, click pitch). */
  bright: number;
  role: Role;
}

/** One row per character (CHARACTERS ids; a missing row is a test failure). */
export const CHAR_VOICE: Record<string, Voice> = {
  guardian: { base: 55, mat: 'steel', chord: 'maj', bright: 0.35, role: 'tank' },
  paladin: { base: 73.4, mat: 'holy', chord: 'maj', bright: 0.6, role: 'tank' },
  warden: { base: 41.2, mat: 'chain', chord: 'min', bright: 0.3, role: 'tank' },
  blade: { base: 220, mat: 'blade', chord: 'maj', bright: 0.8, role: 'melee' },
  berserker: { base: 73.4, mat: 'blood', chord: 'min', bright: 0.3, role: 'melee' },
  shadow: { base: 138.6, mat: 'shadow', chord: 'dim', bright: 0.5, role: 'melee' },
  ranger: { base: 196, mat: 'wind', chord: 'sus', bright: 0.75, role: 'ranged' },
  mage: { base: 164.8, mat: 'magic', chord: 'min', bright: 0.6, role: 'ranged' },
  gunner: { base: 87.3, mat: 'powder', chord: 'min', bright: 0.5, role: 'ranged' },
  cleric: { base: 261.6, mat: 'holy', chord: 'maj', bright: 0.8, role: 'healer' },
  medic: { base: 440, mat: 'medical', chord: 'maj', bright: 0.8, role: 'healer' },
  exorcist: { base: 146.8, mat: 'talisman', chord: 'dim', bright: 0.45, role: 'healer' },
  bard: { base: 349.2, mat: 'music', chord: 'maj', bright: 0.75, role: 'support' },
  chrono: { base: 246.9, mat: 'time', chord: 'sus', bright: 0.7, role: 'support' },
  puppeteer: { base: 329.6, mat: 'thread', chord: 'dim', bright: 0.6, role: 'support' },
};

/** Role pitch factor for 등장 (탱커 ×0.7 … 힐러 ×1.3) and role bodies. */
export const ROLE_PITCH: Record<Role, number> = { tank: 0.7, melee: 0.9, ranged: 1.05, support: 1.15, healer: 1.3 };

/** Boss motif rows (boss.intro / boss.phase): root pitch and a short motif in semitones. */
export const BOSS_VOICE: Record<string, { base: number; motif: number[] }> = {
  elevator_keeper: { base: 98, motif: [0, -4, -1] },
  overtime_lord: { base: 82.4, motif: [0, 1, 0, -5] },
  surgeon_director: { base: 110, motif: [0, 6, 5] },
  abyss_watcher: { base: 55, motif: [0, 1, -1, 0] },
};

/** Floor themes (zones) — used by floor.start / amb. */
export const ZONES = ['lobby', 'office', 'ward', 'rooftop'] as const;
