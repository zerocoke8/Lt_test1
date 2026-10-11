// 기획 19차 보스 레이드: the boss art registry's shapes (docs/bosses.md 4장). One file per zone exports looks keyed by
// boss id; index.ts merges them. A boss without a look gets the old fallback (심연의 감시자's art).

import type { Camera } from '../camera';
import type { BossDrawOpts } from '../boss';

export type { BossDrawOpts };

/** Draws one boss set piece. x / y / radius are the boss's world position and radius (always 12, −1.2, 3). */
export type BossDrawFn = (ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts) => void;

/** 기획 20차: the five poses of a moving body (docs/bosses.md 5-1). */
export type BossPose = 'idle' | 'walk' | 'windup' | 'attack' | 'groggy';

/** What a moving body's draw function gets for one frame. */
export interface BossBodyFrame {
  /** The foot point in px (after the shared walk bob). */
  fx: number;
  fy: number;
  /** The body box in px: it stands on (fx, fy), w wide and h tall. */
  w: number;
  h: number;
  /** −1 = facing left, +1 = right. The shared frame has already mirrored the canvas: always draw "facing right". */
  s: -1 | 1;
  pose: BossPose;
  /** 0..1 through the pose (wind-up: toward the hit; attack: through the swing; groggy: how far down). */
  p: number;
  /** 0..1 walk cycle (advances with the distance walked). */
  stride: number;
  time: number;
  /** The sim facing in radians (0 = +x); bodies that point somewhere (렌즈, 연필) read it. */
  facing: number;
  /** Drawn as a copy (a decoy unit that reuses the boss's body). */
  clone?: boolean;
}

/**
 * A moving body, authored facing right inside its box. Rules: no fillText (it would mirror), at most 220 canvas calls
 * per frame, no gradient / shadowBlur / Math.random, nothing smaller than 6 px.
 */
export type BossBodyFn = (ctx: CanvasRenderingContext2D, f: BossBodyFrame, o: BossDrawOpts) => void;

export interface BossBody {
  /** Body box in world units (× PX_PER_UNIT = px): about 2.8 × 2.6 for a radius-1.5 body. */
  w: number;
  h: number;
  draw: BossBodyFn;
  /** Screen y of the head (groggy stars); absent = the top of the box. */
  headY?(f: BossBodyFrame): number;
  /** Drawn on the ground pass, under every unit (거꾸로 뜬 달: the moon's reflection on the floor). */
  flat?: true;
}

/** 기획 20차: a boss's floor art (docs/bosses.md 5-2) — baked once per boss + phase, one drawImage per frame. */
export interface BossStageLook {
  /** 'light' = a bright floor (paper): enemy warnings get a dark casing so the red stays readable. */
  tone: 'dark' | 'light';
  /** Paint the whole arena floor: (0, 0)–(wPx, hPx) is the arena, one cell = cellX × cellY px. phase = 1, 2 … */
  bake(g: CanvasRenderingContext2D, B: { wPx: number; hPx: number; cellX: number; cellY: number; phase: number }): void;
  /** Moving parts over the bake (at most 40 canvas calls per frame). */
  live?(ctx: CanvasRenderingContext2D, cam: Camera, o: BossDrawOpts, time: number): void;
}

/** 기획 20차: how the zones of one Zone.look are painted (all of them as ONE path + one dashed edge). */
export interface ZoneLook {
  fill: string;
  edge?: string;
}

/**
 * 기획 20차 점검: how a boss's find-the-safe-spot veil is painted (same geometry, its own picture) —
 * ink = the pencil blacks the paper out, the word stays clean · moon = cold shadow, a disc of moonlight ·
 * storm = thunderclouds and bolts, the grounded circle under the antenna. Absent = the plain dark-red veil.
 */
export type SafeVeilLook = 'ink' | 'moon' | 'storm';

export interface BossLook {
  /**
   * The set piece. Must be safe for o.phase 1–3, enraged, o.groggy 0..1, o.groggyWake 0..1 and o.retreat 0..1.
   * 기획 20차: a moving boss passes `asSetPiece(BODY)` (bosses/body.ts) so the sheet tools and tests still draw it.
   */
  draw: BossDrawFn;
  /** 기획 20차: the moving body — required when the boss's form is not 'fixed' (else it is drawn as a plain blob). */
  body?: BossBody;
  /** 기획 20차: floor art under the fight (any form). */
  stage?: BossStageLook;
  /** Hit flash / ghost / label colour (usually the palette base). */
  color: string;
  /** 기획 20차 점검: the picture of its safe-spot veil (fieldMarks.ts drawSafeVeil). */
  veil?: SafeVeilLook;
  /**
   * Screen y of the head, where the groggy stars circle. by = the foot line (screen y of the boss + BOSS_DROP), R = the
   * radius in px, g = how far down it is (0..1). Absent = the watcher's default.
   */
  headY?(by: number, R: number, g: number): number;
  /**
   * Groggy props drawn over the posed art, screen-aligned (a sign, Zzz, a flat ECG …). Only called while o.groggy > 0;
   * fade them with o.groggy × (1 − o.retreat).
   */
  props?: BossDrawFn;
}

/** A small extra drawn on a boss warning — the footprint is unchanged, this only says what it does (docs/bosses.md 3장). */
export type TeleMotif = 'pull' | 'push' | 'linger' | 'spawn';

/**
 * A boss summon's body (the per-look signature of render/creatures.ts): fill = body colour (white-ish while flashing),
 * fx / fy = the foot point in px, w / h = body width / height in px, s = facing (−1 / +1), phase = a per-unit phase
 * offset for idle motion, act = 0..1 attack strength.
 */
export type CreatureDrawFn = (
  ctx: CanvasRenderingContext2D,
  fill: string,
  flash: boolean,
  fx: number,
  fy: number,
  w: number,
  h: number,
  s: number,
  time: number,
  phase: number,
  act: number,
) => void;
