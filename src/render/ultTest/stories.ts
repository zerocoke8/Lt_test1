// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 4-4): the registries the two content tracks fill — one story per beat
// (`<alt>:<stage>`, `<alt>_path:<stage>`) and one look per alt (its move / touchdown). render/vfx.ts routes every beat of
// an alt through them (ultPrep / ultLand / ultImpact); a beat without a story gets the role default (grammar.ts), so the
// registries may be empty. Types only otherwise — no drawing here (the sound director reads the looks too: no
// renderer import may ever land in this file).

import type { Vec2 } from '../../types';
import { ULT_TEST } from '../../data/ultTest/types';
import type { UltBeat, UltBeatRole, UltBeats } from '../../data/ultTest';
import type { ImpactSpec } from '../impact';
import type { TeleMotif, ZoneDecor } from '../marks';
import type { SkillFx } from '../skillfx';
import type { StageInfo } from '../stagefx';
import type { DecalSpec } from './decals';
import type { ChargeSpec, FinisherSpec, UltHost } from './grammar';
import type { UltTheme } from './theme';

/** The same reused object vfx passes today (never keep it), with the beat filled in. */
export interface UltBeatInfo extends StageInfo {
  mode: 'aim' | 'drag';
  charId: string;
  role: UltBeatRole;
  beat: UltBeat;
  beats: UltBeats;
  theme: UltTheme;
  seq: number;
  seqN: number;
  /** Seconds from now until the finisher lands (≥ 0). */
  toFinish: number;
}

export type UltStoryFn = (fx: SkillFx, h: UltHost, s: UltBeatInfo) => void;

export interface UltAlias {
  /** A key of today's PREP / LAND (e.g. 'guardian_u:citadel'); a test checks it exists. */
  key: string;
  /** 'point' = re-seat ox, oy := x, y and src, follow := −1 for this call (default 'caster' = as is). */
  at?: 'caster' | 'point';
  /** A 'line' beat is passed as { shape: 'rect', dir: 'right', anchor: 'start', length, width, rot } from its origin. */
  lineAsRect?: boolean;
  /** Strength × (alpha, particle counts) 0.5–1.6; never the footprint. */
  k?: number;
  /** s.hit := seq for the call (today's grow() steps once per beat of the same stage). */
  seqAsHit?: boolean;
  /** Run its PREP (default: true when PREP[key] exists). */
  prep?: boolean;
  /** Run its LAND (default true). */
  land?: boolean;
}

export type UltImpact = Partial<ImpactSpec> | null | ((s: UltBeatInfo) => Partial<ImpactSpec> | null);

export interface UltStory {
  alias?: UltAlias | readonly UltAlias[];
  /** At its skillCast, after the alias PREP. */
  prep?: UltStoryFn;
  /** At each skillStage hit / tick, after the alias LAND. */
  land?: UltStoryFn;
  /** Also draw ultDefault under (default: true only when there is neither alias nor land). */
  wave?: boolean;
  /** Non-finisher kick (mine) + area flash; absent = role default; null = none. stop ≤ 55 except role 'after' (≤ 100). */
  impact?: UltImpact;
  /** Read on the finisher beat only. */
  finisher?: Partial<FinisherSpec>;
  /** Finisher wind-up (null = none). */
  charge?: Partial<ChargeSpec> | null;
  /** Finisher floor mark (null = none, e.g. the story draws its own Fx.Scorch). */
  linger?: Partial<DecalSpec> | null;
  /** The warning look of its delayed parts. */
  motif?: TeleMotif;
  /** The decor of its zone. */
  decor?: ZoneDecor;
}

export interface UltMoveInfo {
  skillId: string;
  charId: string;
  kind: 'dash' | 'blink';
  entityId: number;
  from: Vec2;
  to: Vec2;
  color: string;
  k: number;
  local: boolean;
  touchdownAt: number;
}

export interface UltAltLook {
  /** At the dash / blink event (0 s), after the shared move. */
  move?: (fx: SkillFx, h: UltHost, m: UltMoveInfo) => void;
  /** At touchdownAt, after the shared touchdown. */
  touchdown?: (fx: SkillFx, h: UltHost, m: UltMoveInfo) => void;
  /** Shared move grammar (2-5); 'lite' = no afterimages / speed lines / gash. */
  genericMove?: 'full' | 'lite' | 'none';
  /** Default: dash ULT_TEST.dashDuration, blink 0.18. ≥ 0.4 = no shared touchdown (the first beat is the landing). */
  touchdownAt?: number;
  /** My touchdown hit-stop, ms at the default setting (default 50; 0 when a contact stop lands within 0.8 s — 2-2). */
  touchdownStop?: number;
  /** 착지 컷 start (default touchdownAt + 0.03). */
  stripFrom?: number;
  /** 조준 sight line (default true). */
  sight?: boolean;
  /** 조준 lock-on (default: beats.onPoint ? 'point' : 'small'). */
  lock?: 'point' | 'small' | 'none';
}

/**
 * 기획 23차 (2-5): a blink touches down this long after the release (the body hidden 0.08 s, then dropping in); a
 * touchdown at `none` or later is no shared touchdown (the first beat is the landing). The sound director reads these too.
 */
export const TOUCHDOWN = { blink: 0.18, none: 0.4 } as const;

/** When a dragged alt's move touches down (s after the release): the look's touchdownAt, else dash / blink defaults. */
export function touchdownAt(look: UltAltLook | undefined, kind: 'dash' | 'blink'): number {
  return look?.touchdownAt ?? (kind === 'dash' ? ULT_TEST.dashDuration : TOUCHDOWN.blink);
}

const STORIES = new Map<string, UltStory>();
const LOOKS = new Map<string, UltAltLook>();

/**
 * key = `<alt>:<stage>` or `<alt>_path:<stage>`; a key registered twice throws. Returns the undo (tests only — the
 * content files register once at import).
 */
export function registerUltStories(map: Readonly<Record<string, UltStory>>): () => void {
  const keys = Object.keys(map);
  for (const k of keys) if (STORIES.has(k)) throw new Error(`ult story registered twice: ${k}`);
  for (const k of keys) STORIES.set(k, map[k]);
  return () => {
    for (const k of keys) if (STORIES.get(k) === map[k]) STORIES.delete(k);
  };
}

export function ultStoryKeys(): readonly string[] {
  return [...STORIES.keys()];
}

/** The story of one beat (`<skillId>:<stage>`), if a content track registered one. */
export function ultStory(key: string): UltStory | undefined {
  return STORIES.size === 0 ? undefined : STORIES.get(key);
}

/** key = alt id (e.g. 'berserker_ud'); a key registered twice throws. Returns the undo (tests only). */
export function registerUltLooks(map: Readonly<Record<string, UltAltLook>>): () => void {
  const keys = Object.keys(map);
  for (const k of keys) if (LOOKS.has(k)) throw new Error(`ult look registered twice: ${k}`);
  for (const k of keys) LOOKS.set(k, map[k]);
  return () => {
    for (const k of keys) if (LOOKS.get(k) === map[k]) LOOKS.delete(k);
  };
}

export function ultLookKeys(): readonly string[] {
  return [...LOOKS.keys()];
}

/** The look of an alt (its move / touchdown / lock-on), if one was registered. */
export function ultLook(altId: string): UltAltLook | undefined {
  return LOOKS.size === 0 ? undefined : LOOKS.get(altId);
}
