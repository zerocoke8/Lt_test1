// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-3 캐릭터 표): each character's finisher dress — the screen flash colour, the
// edge tint before the blow, the spark / ember kinds and the floor mark it leaves. A story may change any of it per ult
// (UltStory.finisher / charge / linger).
// 기획 24차 (8-2-2): the big hanja is gone — each character's 충격 프레임 star shape (burst) and dark-cut colour instead.

import { Pk } from '../fxparts';
import type { DecalKind } from './decals';

/** 기획 24차 충격 프레임: the white star of my finisher — no letter, no emblem, only its shape differs per character. */
export interface UltBurst {
  /** Points of the star (2 = a slanted line, 12 = clock ticks …). */
  spikes: number;
  /** How ragged the points are (0 = even; each point's length × 1 − jag·random). */
  jag: number;
  /** Turn of the first point (rad, screen). */
  tilt: number;
  /** The dark cut's colour (the whole screen for 0.05 s). */
  ink: string;
}

export interface UltTheme {
  /** 기획 24차: the impact frame's star shape and dark-cut colour (8-2-2 table). */
  burst: UltBurst;
  /** Full-screen flash colour of the finisher. */
  screenColor: string;
  /** Edge tint 0.35 s before the finisher (colour, alpha). */
  vignetteColor: string;
  vignette: number;
  /** Sparks of the burst. */
  spark: Pk;
  /** Floor mark left by the finisher (2-6). */
  decal: DecalKind;
  decalColor: string;
  /** What drifts up after the blow (0.2–2 s). */
  ember: Pk;
}

const B = (spikes: number, jag: number, tilt: number, ink: string): UltBurst => ({ spikes, jag, tilt, ink });

const T = (burst: UltBurst, screenColor: string, vignetteColor: string, vignette: number, spark: Pk, decal: DecalKind, decalColor: string, ember: Pk): UltTheme => ({
  burst,
  screenColor,
  vignetteColor,
  vignette,
  spark,
  decal,
  decalColor,
  ember,
});

const THEMES: Readonly<Record<string, UltTheme>> = {
  guardian: T(B(6, 0.05, 0, '#070a14'), '#dbe9ff', '#cfe8ff', 0.3, Pk.Glass, 'crater', '#cfe0ff', Pk.Glass),
  paladin: T(B(4, 0.05, 0, '#0d0a02'), '#fff3b0', '#fff3b0', 0.3, Pk.Gold, 'sigil', '#ffd166', Pk.Gold),
  warden: T(B(8, 0.1, 0.39, '#080a05'), '#e8f0d0', '#c9d6a3', 0.3, Pk.Square, 'crater', '#c9d6a3', Pk.Square),
  blade: T(B(2, 0, -0.5, '#000000'), '#ffe3ec', '#000000', 0.5, Pk.Petal, 'gash', '#ffe3ec', Pk.Petal),
  berserker: T(B(12, 0.3, 0, '#140402'), '#ffd0c2', '#ff3b1f', 0.25, Pk.Ember, 'crater', '#5c4033', Pk.Ember),
  shadow: T(B(5, 0.15, 0, '#05030f'), '#e6dcff', '#0b0820', 0.45, Pk.Ink, 'ink', '#1b1c3d', Pk.Ink),
  ranger: T(B(4, 0.05, 0.785, '#000000'), '#fff6d0', '#000000', 0.35, Pk.Feather, 'crater', '#c9ffe9', Pk.Feather),
  mage: T(B(6, 0, 0.52, '#03080c'), '#e0f7ff', '#bfefff', 0.35, Pk.Glass, 'frost', '#bdeeff', Pk.Glass),
  gunner: T(B(10, 0.3, 0, '#0c0703'), '#ffe2b8', '#000000', 0.35, Pk.Square, 'scorch', '#3a2e26', Pk.Ember),
  cleric: T(B(8, 0.05, 0, '#0c0a02'), '#fffbe6', '#fffbe6', 0.3, Pk.Feather, 'sigil', '#ffe08a', Pk.Gold),
  medic: T(B(4, 0, 0, '#020a0b'), '#d9fbff', '#bdf6ff', 0.3, Pk.Square, 'sigil', '#2ec4b6', Pk.Gold),
  exorcist: T(B(8, 0.2, 0.39, '#0c0203'), '#ffd6d6', '#3a0a0c', 0.45, Pk.Paper, 'ink', '#2a1a1a', Pk.Ember),
  bard: T(B(10, 0.15, 0, '#0c020d'), '#ffe6ff', '#e056fd', 0.35, Pk.Note, 'petals', '#e056fd', Pk.Note),
  chrono: T(B(12, 0, 0, '#04050c'), '#eef0ff', '#eef0ff', 0.35, Pk.Glass, 'sigil', '#cfd5ff', Pk.Glass),
  puppeteer: T(B(6, 0.2, 0.52, '#0c0208'), '#ffd6ea', '#2a0a1a', 0.45, Pk.Petal, 'petals', '#ffb3d9', Pk.Petal),
};

const FALLBACK: UltTheme = T(B(8, 0.1, 0, '#05060a'), '#ffffff', '#ffffff', 0.3, Pk.Square, 'crater', '#cfd5ff', Pk.Gold);

/** The 2-3 table row of a character (an unknown id gets a plain white one). */
export function ultTheme(charId: string): UltTheme {
  return THEMES[charId] ?? FALLBACK;
}

/** Every character with a row (tests: all 15 are there). */
export function ultThemeIds(): readonly string[] {
  return Object.keys(THEMES);
}
