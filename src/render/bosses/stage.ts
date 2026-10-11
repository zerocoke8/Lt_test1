// 기획 20차 보스 형태 (docs/bosses.md 5-2): the floor art of a boss fight — "the whole map is the boss's stage" (연필의
// 종이, 달빛, 계단), and the small floor hints of the other forms. Drawn right over the zone backdrop, under zones,
// warnings and units. A look's `bake` paints the arena once per boss + phase into an offscreen canvas (one drawImage per
// frame, fading in over 0.6 s); `live` adds the few moving parts. Without a look the generic hints still show, read
// straight from the boss data: a dotted socket on every seat (BossDef.spots) and the dotted route of a patrol / path
// boss (move.waypoints). No DOM (tests, workers) → no bake, the hints only.

import type { BossDef } from '../../types';
import { getBoss } from '../../data';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { TAU } from '../shapes';
import type { BossDrawOpts, BossStageLook } from './types';
import { bossLook } from './index';

const FADE_IN = 0.6;
const DOTS = [4, 8];
const NO_DASH: number[] = [];
const DIR_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 } as const;

export class BossStage {
  private cache: HTMLCanvasElement | null = null;
  private key = '';
  private def: BossDef | null = null;
  private look: BossStageLook | undefined;
  private age = 0;
  private baked = false;

  /** Forget the bake (a new floor / a new run). */
  reset(): void {
    this.key = '';
    this.def = null;
    this.look = undefined;
    this.age = 0;
    this.baked = false;
  }

  /** The floor of this boss is 'light' (paper): warnings need a dark casing. */
  get tone(): 'dark' | 'light' {
    return this.look?.tone ?? 'dark';
  }

  /** Anything to draw for this boss? */
  get active(): boolean {
    return !!this.def && (!!this.look || !!this.def.spots?.length || !!this.def.move?.waypoints?.length);
  }

  /** Pick the boss of the floor (undefined = no boss) and bake its floor for `phase` at backing scale `scale`. */
  ensure(bossId: string | undefined, phase: number, arenaW: number, arenaH: number, scale: number): void {
    const key = `${bossId ?? ''}:${phase}:${arenaW}x${arenaH}:${scale}`;
    if (key === this.key) return;
    const sameBoss = this.def?.id === bossId;
    this.key = key;
    this.def = null;
    this.look = undefined;
    if (!bossId) return;
    try {
      this.def = getBoss(bossId);
    } catch {
      return;
    }
    this.look = bossLook(bossId)?.stage;
    if (!sameBoss) this.age = 0; // a phase change repaints without fading in again
    this.baked = this.bake(phase, arenaW, arenaH, scale);
  }

  private bake(phase: number, arenaW: number, arenaH: number, scale: number): boolean {
    if (!this.look || typeof document === 'undefined') return false;
    const wPx = Math.ceil(arenaW * PX_PER_UNIT);
    const hPx = Math.ceil(arenaH * PX_PER_UNIT_Y);
    const c = this.cache ?? document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(wPx * scale));
    c.height = Math.max(1, Math.ceil(hPx * scale));
    const g = c.getContext('2d');
    if (!g) return false;
    this.cache = c;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, wPx, hPx);
    this.look.bake(g, { wPx, hPx, cellX: PX_PER_UNIT, cellY: PX_PER_UNIT_Y, phase });
    return true;
  }

  update(dt: number): void {
    if (this.def) this.age += dt;
  }

  /** Draw the floor: the bake (1 drawImage), the look's moving parts, then the generic seat / route hints. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, arenaW: number, arenaH: number, o: BossDrawOpts, retreat: number): void {
    const def = this.def;
    if (!def) return;
    const alpha = Math.min(1, this.age / FADE_IN) * (1 - Math.min(1, retreat));
    if (alpha <= 0) return;
    if (this.look) {
      if (this.baked && this.cache) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.cache, cam.sx(0), cam.sy(0), arenaW * PX_PER_UNIT, arenaH * PX_PER_UNIT_Y);
      }
      if (this.look.live) {
        ctx.globalAlpha = alpha;
        this.look.live(ctx, cam, o, o.time);
      }
    }
    drawSeats(ctx, cam, def, alpha, this.tone);
    drawRoute(ctx, cam, def, alpha, this.tone, o.time);
    ctx.globalAlpha = 1;
  }
}

const hint = (tone: 'dark' | 'light'): string => (tone === 'light' ? '#3b2f2f' : '#e9ecef');

/** A dotted socket on every seat of a relocating boss, with a small tick the way it faces there. */
function drawSeats(ctx: CanvasRenderingContext2D, cam: Camera, def: BossDef, alpha: number, tone: 'dark' | 'light'): void {
  const spots = def.spots;
  if (!spots || spots.length === 0) return;
  ctx.strokeStyle = hint(tone);
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.3 * alpha;
  ctx.setLineDash(DOTS);
  ctx.beginPath();
  const r = def.radius * 1.15;
  for (const s of spots) {
    const sx = cam.sx(s.x);
    const sy = cam.sy(s.y);
    ctx.moveTo(sx + r * PX_PER_UNIT, sy);
    ctx.ellipse(sx, sy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  }
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.beginPath();
  for (const s of spots) {
    const a = DIR_ANGLE[s.facing];
    ctx.moveTo(cam.sx(s.x + Math.cos(a) * r), cam.sy(s.y + Math.sin(a) * r));
    ctx.lineTo(cam.sx(s.x + Math.cos(a) * (r + 0.6)), cam.sy(s.y + Math.sin(a) * (r + 0.6)));
  }
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** The dotted route of a patrol / path boss (its waypoints, closed), drifting the way it walks. */
function drawRoute(ctx: CanvasRenderingContext2D, cam: Camera, def: BossDef, alpha: number, tone: 'dark' | 'light', time: number): void {
  const wps = def.move?.waypoints;
  if (!wps || wps.length < 2) return;
  ctx.strokeStyle = hint(tone);
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.22 * alpha;
  ctx.setLineDash(DOTS);
  ctx.lineDashOffset = -time * 12;
  ctx.beginPath();
  ctx.moveTo(cam.sx(wps[0].x), cam.sy(wps[0].y));
  for (let i = 1; i < wps.length; i++) ctx.lineTo(cam.sx(wps[i].x), cam.sy(wps[i].y));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
}
