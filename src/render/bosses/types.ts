// 기획 19차 보스 레이드: the boss art registry's shapes (docs/bosses.md 4장). One file per zone exports looks keyed by
// boss id; index.ts merges them. A boss without a look gets the old fallback (심연의 감시자's art).

import type { Camera } from '../camera';
import type { BossDrawOpts } from '../boss';

export type { BossDrawOpts };

/** Draws one boss set piece. x / y / radius are the boss's world position and radius (always 12, −1.2, 3). */
export type BossDrawFn = (ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, o: BossDrawOpts) => void;

export interface BossLook {
  /** The set piece. Must be safe for o.phase 1–3, enraged, o.groggy 0..1, o.groggyWake 0..1 and o.retreat 0..1. */
  draw: BossDrawFn;
  /** Hit flash / ghost / label colour (usually the palette base). */
  color: string;
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
