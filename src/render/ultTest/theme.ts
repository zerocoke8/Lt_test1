// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-3 캐릭터 표): each character's finisher dress — the big glyph, the screen
// flash colour, the edge tint before the blow, the spark / ember kinds and the floor mark it leaves. A story may change
// any of it per ult (UltStory.finisher / charge / linger).

import { Pk } from '../fxparts';
import type { DecalKind } from './decals';

export interface UltTheme {
  /** The big hanja stamped on the finisher (city 城, cut 斬, freeze 凍 …). */
  glyph: string;
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

const T = (glyph: string, screenColor: string, vignetteColor: string, vignette: number, spark: Pk, decal: DecalKind, decalColor: string, ember: Pk): UltTheme => ({
  glyph,
  screenColor,
  vignetteColor,
  vignette,
  spark,
  decal,
  decalColor,
  ember,
});

const THEMES: Readonly<Record<string, UltTheme>> = {
  guardian: T('城', '#dbe9ff', '#cfe8ff', 0.3, Pk.Glass, 'crater', '#cfe0ff', Pk.Glass),
  paladin: T('審', '#fff3b0', '#fff3b0', 0.3, Pk.Gold, 'sigil', '#ffd166', Pk.Gold),
  warden: T('獄', '#e8f0d0', '#c9d6a3', 0.3, Pk.Square, 'crater', '#c9d6a3', Pk.Square),
  blade: T('斬', '#ffe3ec', '#000000', 0.5, Pk.Petal, 'gash', '#ffe3ec', Pk.Petal),
  berserker: T('破', '#ffd0c2', '#ff3b1f', 0.25, Pk.Ember, 'crater', '#5c4033', Pk.Ember),
  shadow: T('影', '#e6dcff', '#0b0820', 0.45, Pk.Ink, 'ink', '#1b1c3d', Pk.Ink),
  ranger: T('穿', '#fff6d0', '#000000', 0.35, Pk.Feather, 'crater', '#c9ffe9', Pk.Feather),
  mage: T('凍', '#e0f7ff', '#bfefff', 0.35, Pk.Glass, 'frost', '#bdeeff', Pk.Glass),
  gunner: T('爆', '#ffe2b8', '#000000', 0.35, Pk.Square, 'scorch', '#3a2e26', Pk.Ember),
  cleric: T('聖', '#fffbe6', '#fffbe6', 0.3, Pk.Feather, 'sigil', '#ffe08a', Pk.Gold),
  medic: T('救', '#d9fbff', '#bdf6ff', 0.3, Pk.Square, 'sigil', '#2ec4b6', Pk.Gold),
  exorcist: T('滅', '#ffd6d6', '#3a0a0c', 0.45, Pk.Paper, 'ink', '#2a1a1a', Pk.Ember),
  bard: T('響', '#ffe6ff', '#e056fd', 0.35, Pk.Note, 'petals', '#e056fd', Pk.Note),
  chrono: T('止', '#eef0ff', '#eef0ff', 0.35, Pk.Glass, 'sigil', '#cfd5ff', Pk.Glass),
  puppeteer: T('幕', '#ffd6ea', '#2a0a1a', 0.45, Pk.Petal, 'petals', '#ffb3d9', Pk.Petal),
};

const FALLBACK: UltTheme = T('極', '#ffffff', '#ffffff', 0.3, Pk.Square, 'crater', '#cfd5ff', Pk.Gold);

/** The 2-3 table row of a character (an unknown id gets a plain white one). */
export function ultTheme(charId: string): UltTheme {
  return THEMES[charId] ?? FALLBACK;
}

/** Every character with a row (tests: all 15 are there). */
export function ultThemeIds(): readonly string[] {
  return Object.keys(THEMES);
}
