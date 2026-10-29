// 기획 22차 궁극기 테스트: what every aimed / dragged ult shows on every screen (from the ultCast event's `aim`).
//  - 조준: a reticle closing onto the aimed point in the caster's colour (0.8 s) — the others see where it went.
//  - 드래그: the landing flourish where the character arrived (a ring + sparks, like a drag card touching down).
// Mine at full strength, another player's softer (never buries my own fight).
//
// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 2-4 ~ 2-6, 4-5) — with 「궁극기 연출 강화」 on (ULT_FX.boost) and a character's
// own design (ultBeats ≠ null) the 22차 reticle / flourish above are replaced by:
//  - 조준: the lock-on (four brackets closing in 2.2× → 1×, a rune ring, 「찰칵」 at 0.4 s; held until the finisher when
//    it falls on the aimed spot ≥ 0.8 s later), the caster gathering light, the sight line (0.38–0.53 s, screen layer)
//    and the muzzle star at 0.45 s;
//  - 드래그: the shared move (dash: afterimages, dust, sparks, a gash on the path, speed lines; blink: an imploding ring,
//    a slit of light, a bolt from → to, the body dropping in) and the touchdown at the real arrival (crater ring, shock
//    ring, cracks, dust, a small crater mark; mine: shake 7 + a 50 ms stop), then the alt's own look (stories.ts);
//  - the floor marks (decals.ts) on the ground layer, world clock;
//  - the screen layer (drawUltScreen, real clock — drawn in the hit-stop's frozen frames too): the impact frame (기획
//    24차 — the big glyph stamp is gone), the sight lines, the speed lines. One of each at a time: a new one replaces
//    the old.

import { type GameEvent, LOGICAL_H, LOGICAL_W, type Vec2 } from '../../types';
import { getCharacter } from '../../data';
import { ULT_TEST, ultBeats, type UltBeats } from '../../data/ultTest';
import { areaColor, lighten, mix } from '../look';
import { type Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from '../camera';
import { TAU, groundEllipse } from '../shapes';
import { JUICE, prefersReducedMotion } from '../juice';
import { pillar, rings as castRings, star } from '../castfx';
import { Fx, type SkillFx } from '../skillfx';
import { Pk } from '../fxparts';
import { STAGE_DETAIL } from '../stagefx';
import { registerUltFx, resetUltFxModules, type UltFxView } from './index';
import { FX_LOAD, ULT_FX } from './settings';
import { clearDecals, drawDecals, ultDecal } from './decals';
import { TOUCHDOWN, touchdownAt as touchdownOf, ultLook, type UltAltLook, type UltMoveInfo } from './stories';
import type { UltHost } from './grammar';
import type { UltTheme } from './theme';

const RETICLE_SEC = 0.8;

interface Reticle {
  x: number;
  y: number;
  color: string;
  k: number;
  /** Renderer clock when it appeared (set on the first draw). */
  t0: number | null;
}

const reticles: Reticle[] = [];

function colorOf(defId: string): string {
  try {
    return areaColor(defId, getCharacter(defId).color);
  } catch {
    return '#ffffff';
  }
}

// ─────────────────────────── 기획 23차 state ───────────────────────────

/** 2-4 lock-on numbers (s after the release). */
export const LOCK = { closeSec: 0.18, clickSec: 0.4, endSec: 0.65, smallR: 1, smallSec: 0.6, keepMin: 0.8, keepMax: 3, otherAlpha: 0.6, lateSec: 0.6 } as const;
/** 2-4 sight line: drawn in 0.38–0.43 s, held, sucked into the aim 0.45–0.53 s; none closer than minDist cells. */
export const SIGHT = { from: 0.38, drawIn: 0.05, fire: 0.45, suck: 0.08, minDist: 1.5, chest: 0.6, otherAlpha: 0.5 } as const;
/** 2-5 the shared move / touchdown. */
export const MOVE = { blinkLand: TOUCHDOWN.blink, hide: 0.08, ghosts: 4, ghostGap: 0.035, ghostSec: 0.28, gashSec: 1.6, touchStopMs: 50, touchShake: 7, noTouchdownFrom: TOUCHDOWN.none } as const;

interface Lock {
  entityId: number;
  x: number;
  y: number;
  r: number;
  color: string;
  local: boolean;
  small: boolean;
  /** Renderer (world) clock at its first draw. */
  born: number | null;
  /** Held until the finisher: target spot / size and the age it bursts at (−1 = not held). */
  keepX: number;
  keepY: number;
  keepR: number;
  keepUntil: number;
  /**
   * 기획 23차 검토: the age a held lock bursts at, set by the real blow (ultLockBurst; −1 = not yet). Until then a blow
   * later than foreseen (the world clock stood still in a hit-stop less than the sim, a slowed game) is waited for
   * ≤ LOCK.lateSec past keepUntil.
   */
  burst: number;
}

interface Sight {
  entityId: number;
  x: number;
  y: number;
  color: string;
  local: boolean;
  /** Real clock at the release. */
  t0: number;
}

/**
 * 기획 24차 충격 프레임 (docs/ult-fx.md 8-2-2): my finisher's screen-layer blow — the dark cut, the character's white
 * star, the light streaks and two shock rings. One record, drawn on the real clock (it slams through the stop).
 */
interface Impact {
  charId: string;
  /** World point of the blow (ultFocus); the star sits at height IMPACT.z on it. */
  x: number;
  y: number;
  /** The star's outer radius (screen px, × burst); 0 = no star. */
  r: number;
  /** Screen colour (the star's rim, the first ring, the streaks' rim). */
  color: string;
  /** The dark cut's colour and alpha (0 = none: the 1 s gate, the hit-stop setting 0, reduced motion, a blessing). */
  ink: string;
  cut: number;
  /** Reduced motion: no slam (the star just appears), no streaks, the rings at half. */
  slam: boolean;
  flare: boolean;
  ring2: boolean;
  ringK: number;
  /** The star outline, computed once: per vertex [angle (rad), radius × of r]; outer and inner alternate. */
  pts: number[];
  /** Real clock at the blow. */
  t0: number;
  /**
   * 기획 24차 검토: how long the record stays (real s): IMPACT.busy + the world freeze my finisher's stop left
   * (extendImpact) — the after-blow vignette runs on the world clock, so the stop pushes its end that much later.
   */
  busy: number;
}

interface Lines {
  x: number;
  y: number;
  /** World radians, NaN = radial. */
  dir: number;
  color: string;
  alpha: number;
  t0: number;
  dur: number;
  /** Per line: angle / offset, start radius, width. */
  a: number[];
  r: number[];
  w: number[];
}

interface PendingMove {
  skillId: string;
  charId: string;
  color: string;
  local: boolean;
  k: number;
}

const locks: Lock[] = [];
const sights: Sight[] = [];
let impact: Impact | null = null;
/** 기획 24차: real clock of my last dark cut (at most one per IMPACT.gap s — never reset, a floor change included). */
let lastCut = -Infinity;
let lines: Lines | null = null;
const pending = new Map<number, PendingMove>();
let realNow = 0;
/** 기획 23차 검토: the renderer (world) clock of the last ground draw — the lock-on ages on it. */
let worldNow = 0;
let lastCam: Camera | null = null;

/** The camera of the last frame (null before the first) — the grammar turns world points into screen ones with it. */
export function ultCam(): Camera | null {
  return lastCam;
}

/** Real clock (render/vfx.ts updateReal): the screen layer keeps moving through a hit-stop. */
export function tickUltReal(dt: number): void {
  realNow += Math.max(0, dt);
}

/** Floor change / new run (render/vfx.ts reset): every 23차 leftover goes (기획 24차 검토: the content modules' own too). */
export function resetUltCore(): void {
  reticles.length = 0;
  locks.length = 0;
  sights.length = 0;
  impact = null;
  lines = null;
  pending.clear();
  clearDecals();
  resetUltFxModules();
}

/** End of an event batch (render/vfx.ts update): a dragged ult's move came in the same batch as its ultCast, or never. */
export function ultFrameEnd(): void {
  if (pending.size) pending.clear();
}

/** Live 23차 / 24차 screen / ground items (tests). */
export function ultCoreCounts(): { locks: number; sights: number; impact: boolean; cut: boolean; lines: boolean; pending: number } {
  return { locks: locks.length, sights: sights.length, impact: impactAge() >= 0, cut: ultImpactCut(), lines: lines !== null, pending: pending.size };
}

/** Seconds since my impact frame's blow while its record is kept (its busy s: IMPACT.busy + the stop), −1 = none. */
function impactAge(): number {
  if (!impact) return -1;
  const t = realNow - impact.t0;
  return t >= 0 && t < impact.busy ? t : -1;
}

/**
 * 기획 23차: a screen-layer climax is up (기획 24차: my impact frame — kept IMPACT.busy s + the stop, the 23차 glyph's
 * window — or the speed lines) — render/index.ts draws the enemy warnings again over the finisher's flash / vignette
 * meanwhile, in the live frames and (기획 24차 검토) in the hit-stop's frozen frames too.
 */
export function ultScreenBusy(): boolean {
  return impactAge() >= 0 || lines !== null;
}

/** 기획 24차: the character id of my impact frame while its record is up (tests; replaces the 23차 glyph text). */
export function ultImpactOf(): string | null {
  return impactAge() >= 0 ? impact!.charId : null;
}

/**
 * 기획 24차: the dark cut is on this frame (full, then fading) — tests (기획 24차 검토: drawFrozen now redraws the enemy
 * warnings for as long as ultScreenBusy, the star after the cut included).
 */
export function ultImpactCut(): boolean {
  const t = impactAge();
  return t >= 0 && impact!.cut > 0 && t < IMPACT.cut + IMPACT.cutFade;
}

// ─────────────────────────── events ───────────────────────────

function onEvent(ev: GameEvent, view: UltFxView): void {
  if (ev.type !== 'ultCast' || !ev.aim) return;
  const color = colorOf(ev.defId);
  const local = ev.player === view.localPlayer;
  const beats = ULT_FX.boost && ev.aim.alt ? ultBeats(ev.skillId) : null;
  if (beats) {
    if (ev.aim.mode === 'aim') startAim(ev, view, beats, color, local);
    else pending.set(ev.entityId, { skillId: ev.skillId, charId: ev.defId, color, local, k: local ? 1 : 0.55 });
    return;
  }
  // ── 22차 ──
  const k = local ? 1 : 0.6;
  const { x, y } = ev.aim;
  if (ev.aim.mode === 'drag') {
    view.host.ring(x, y, 0.2, 1.8, 0.4, color, 5 * k, 0.18 * k);
    view.host.ring(x, y, 0.1, 1.1, 0.3, '#ffffff', 3 * k, 0);
    view.host.burst(x, y, 0.3, Math.round(14 * k), color, 2.6, 2, 0.45);
    return;
  }
  if (reticles.length > 8) reticles.shift();
  reticles.push({ x, y, color, k, t0: null });
}

/** 조준 released (mine or another player's): lock-on, the caster gathering light, the sight line, the muzzle star. */
function startAim(ev: Extract<GameEvent, { type: 'ultCast' }>, view: UltFxView, beats: UltBeats, color: string, local: boolean): void {
  const aim = ev.aim!;
  const look = ultLook(ev.skillId);
  const mode = look?.lock ?? (beats.onPoint ? 'point' : 'small');
  const h = view.host as UltHost;
  const fx = view.fx;
  if (mode !== 'none') {
    if (locks.length > 5) locks.shift();
    const small = mode === 'small';
    locks.push({ entityId: ev.entityId, x: aim.x, y: aim.y, r: small ? LOCK.smallR : ultLockRadius(beats), color, local, small, born: null, keepX: aim.x, keepY: aim.y, keepR: 0, keepUntil: -1, burst: -1 });
  }
  const m = h.memo(ev.entityId);
  if (!m || !fx) return;
  const k = local ? 1 : 0.55;
  // gathering light on the caster while the band runs
  const was = STAGE_DETAIL.low;
  STAGE_DETAIL.low = !local;
  castRings(fx, m.x, m.y, 2.6, 0.4, local ? 3 : 2, 0.4, lighten(color, 0.4), k, ev.entityId, 3);
  STAGE_DETAIL.low = was;
  h.implode(m.x, m.y, 0.6, 2.4, Math.round(12 * k), lighten(color, 0.5), 0.4, Pk.Square);
  // the sight line (screen layer) and the muzzle star when it fires
  const dist = Math.hypot(aim.x - m.x, aim.y - m.y);
  if (look?.sight !== false && dist >= SIGHT.minDist) {
    const end = sightEnd(beats, m.x, m.y, aim.x, aim.y, dist);
    if (sights.length > 3) sights.shift();
    sights.push({ entityId: ev.entityId, x: end.x, y: end.y, color, local, t0: realNow });
    const id = ev.entityId;
    h.later(SIGHT.fire, () => {
      const c = h.memo(id);
      if (c) star(fx, c.x, c.y, SIGHT.chest, 40, '#ffffff', k, 0, 8);
    });
  }
}

/**
 * The lock-on's size = the real shape of the first enemy beat that sits ON the aimed point (a line / fan aimed there
 * only ends there: skipped); none such → the first enemy beat's size. Never under 1 cell. render/vfx.ts sizes the
 * cut-in's bright hole (CutIn.focus) with it too.
 */
export function ultLockRadius(beats: UltBeats): number {
  let best = -1;
  for (const b of beats.beats) {
    if (b.affects !== 'enemies' || b.center !== 'point') continue;
    const a = beats.def.actions[b.actionIndex];
    if (a.offset || a.area.shape === 'line' || a.area.shape === 'fan' || (a.area.shape === 'rect' && a.area.anchor !== 'center')) continue;
    if (best < 0 || b.at < beats.beats[best].at) best = b.actionIndex;
  }
  return Math.max(1, best >= 0 ? beats.beats[best].radius : beats.firstRadius);
}

const END: Vec2 = { x: 0, y: 0 };

/** Where the sight line ends: the aimed point, or (no beat lands there) as far as the first beat reaches. */
function sightEnd(beats: UltBeats, cx: number, cy: number, ax: number, ay: number, dist: number): Vec2 {
  if (beats.onPoint) {
    END.x = ax;
    END.y = ay;
    return END;
  }
  let reach = dist;
  let first = -1;
  for (const b of beats.beats) if (b.affects === 'enemies' && (first < 0 || b.at < beats.beats[first].at)) first = b.actionIndex;
  if (first >= 0) {
    const a = beats.def.actions[first].area;
    const r = a.shape === 'rect' || a.shape === 'line' ? a.length : a.shape === 'cone' || a.shape === 'fan' ? a.radius : a.shape === 'circle' ? a.radius : a.shape === 'cross' ? a.length : 1;
    reach = Math.min(dist, r);
  }
  END.x = cx + ((ax - cx) / dist) * reach;
  END.y = cy + ((ay - cy) / dist) * reach;
  return END;
}

/**
 * 기획 23차 (render/vfx.ts ultPrep): the finisher of a 조준 ult falls on the aimed spot ≥ 0.8 s later — its lock-on stays
 * (alpha 0.6, turning slowly), slides onto the finisher's real footprint and bursts with it (at most 3 s).
 */
export function ultLockKeep(entityId: number, x: number, y: number, r: number, inSec: number): void {
  if (inSec < LOCK.keepMin) return;
  for (let i = locks.length - 1; i >= 0; i--) {
    const l = locks[i];
    if (l.entityId !== entityId || l.small) continue;
    if (Math.hypot(l.x - x, l.y - y) > Math.max(1.5, l.r + 0.5)) return;
    l.keepX = x;
    l.keepY = y;
    l.keepR = Math.max(1, r);
    l.keepUntil = Math.min(LOCK.keepMax, inSec);
    return;
  }
}

/**
 * 기획 23차 검토 (render/vfx.ts ultLand): this caster's finisher just landed — its held lock-on bursts now (it waited on
 * the world clock, which a hit-stop holds while the sim goes on: it burst late, after the blow).
 */
export function ultLockBurst(entityId: number): void {
  for (let i = locks.length - 1; i >= 0; i--) {
    const l = locks[i];
    if (l.entityId !== entityId || l.keepUntil <= 0 || l.burst >= 0 || l.born === null) continue;
    l.burst = Math.max(0, Math.min(worldNow - l.born, l.keepUntil + LOCK.lateSec));
    return;
  }
}

/** A dash / blink of this entity just came in: the ult's move when a dragged ultCast of it came first in this batch. */
export function ultMoveTake(entityId: number): PendingMove | null {
  const p = pending.get(entityId);
  if (!p) return null;
  pending.delete(entityId);
  return p;
}

/**
 * 기획 23차 드래그 (2-5): the shared move (unless the look says 'none'), the alt's own move, and the touchdown at the real
 * arrival (later(touchdownAt)). Called by render/vfx.ts after today's dash / blink picture.
 */
export function ultMoveStart(fx: SkillFx, h: UltHost, p: PendingMove, kind: 'dash' | 'blink', entityId: number, from: Vec2, to: Vec2): void {
  const look = ultLook(p.skillId);
  const touchdownAt = touchdownOf(look, kind);
  const m: UltMoveInfo = { skillId: p.skillId, charId: p.charId, kind, entityId, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, color: p.color, k: p.k, local: p.local, touchdownAt };
  const generic = look?.genericMove ?? 'full';
  const was = STAGE_DETAIL.low;
  STAGE_DETAIL.low = !p.local;
  if (generic !== 'none') sharedMove(fx, h, m, generic === 'full');
  look?.move?.(fx, h, m);
  STAGE_DETAIL.low = was;
  h.later(touchdownAt, () => {
    const w = STAGE_DETAIL.low;
    STAGE_DETAIL.low = !m.local;
    if (touchdownAt < MOVE.noTouchdownFrom) touchdown(fx, h, m, look);
    look?.touchdown?.(fx, h, m);
    STAGE_DETAIL.low = w;
  });
}

function sharedMove(fx: SkillFx, h: UltHost, m: UltMoveInfo, full: boolean): void {
  const { from, to, k, color } = m;
  const light = lighten(color, 0.45);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (m.kind === 'dash') {
    // dust where it set off, sparks along the way, afterimages, a gash on the path
    h.spray(from.x, from.y, 0.2, Math.round(6 * k), Pk.Smoke, '#cfc6b8', 1.2, 1.4, 0.6, -0.4, 8);
    h.spray(from.x, from.y, 0.2, Math.round(4 * k), Pk.Rock, '#7d6b5d', 2.5, 3, 0.5, 11, 4);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const x = from.x + dx * t;
      const y = from.y + dy * t;
      h.later(ULT_TEST.dashDuration * t, () => h.burst(x, y, 0.3, Math.max(1, Math.round(3 * k)), light, 2.2, 1.6, 0.3));
    }
    if (full && len > 0.5) {
      for (let i = 1; i <= MOVE.ghosts; i++) {
        const t = i / MOVE.ghosts;
        const x = from.x + dx * t;
        const y = from.y + dy * t;
        h.later(MOVE.ghostGap * (i - 1), () => h.afterimage(m.entityId, x, y, MOVE.ghostSec));
      }
      ultDecal({ kind: 'gash', x: to.x, y: to.y, area: { shape: 'line', length: len, width: 1.2 }, ox: from.x, oy: from.y, color, dur: MOVE.gashSec, alpha: 0.24 }, m.local);
      if (m.local) {
        h.juice.shake(2, 0.2);
        pushSpeedLines(to.x, to.y, Math.atan2(dy, dx), 12, '#ffffff', 0.3);
      }
    }
    return;
  }
  // blink: a ring imploding where it stood, a slit of light, a bolt from → to; the body reappears and drops in
  h.ring(from.x, from.y, 1.6, 0.1, 0.16, color, 4, 0);
  if (!STAGE_DETAIL.low) pillar(fx, from.x, from.y, 0.25, 5, '#ffffff', k, 0.14);
  const b = fx.add(Fx.Bolt, from.x, from.y, 0.2, color, k);
  b.x2 = to.x;
  b.y2 = to.y;
  b.z = 0.5;
  h.hideFor(m.entityId, MOVE.hide);
  h.later(MOVE.hide, () => {
    if (!STAGE_DETAIL.low || m.local) pillar(fx, to.x, to.y, 0.6, 6, '#ffffff', k, 0.12);
    h.drop(m.entityId, 0.6, MOVE.blinkLand - MOVE.hide);
  });
}

/** The touchdown (2-5): crater ring, shock ring, cracks, dust, a small crater mark; mine: shake 7 + a short stop. */
function touchdown(fx: SkillFx, h: UltHost, m: UltMoveInfo, look: UltAltLook | undefined): void {
  let { x, y } = m.to;
  if (look?.touchdownLive) {
    // 기획 23차 검토: a part already rushed the body on (2-5 / 2-9: the touchdown where it really stands)
    const c = h.memo(m.entityId);
    if (c && Math.hypot(c.x - x, c.y - y) > 1) {
      x = c.x;
      y = c.y;
    }
  }
  const k = m.k;
  h.ring(x, y, 0.3, 2.2, 0.4, m.color, 7, 0.22 * k);
  h.ring(x, y, 0.2, 3.4, 0.3, '#ffffff', 3, 0);
  const cr = fx.add(Fx.Crack, x, y, 0.9, mix(m.color, '#3a2a20', 0.5), k);
  cr.w = TAU;
  cr.r = 1.8;
  cr.n = 7;
  h.spray(x, y, 0.2, Math.round(8 * k), Pk.Smoke, '#cfc6b8', 1.6, 1.6, 0.7, -0.4, 9);
  h.spray(x, y, 0.2, Math.round(8 * k), Pk.Rock, '#6b5b4b', 3.5, 4, 0.6, 11, 5);
  ultDecal({ kind: 'crater', x, y, area: { shape: 'circle', radius: 1.1 }, ox: x, oy: y, color: lighten(m.color, 0.3), dur: 2, alpha: 0.24 }, m.local);
  if (!m.local) return;
  const j = h.juice;
  j.shake(MOVE.touchShake, 0.25);
  const ms = look?.touchdownStop ?? MOVE.touchStopMs;
  if (ms > 0) j.hitStop((ms / 1000) * (j.settings.hitStopMs / 75));
}

// ─────────────────────────── screen layer pushes (grammar.ts) ───────────────────────────

/**
 * 기획 24차 충격 프레임 numbers (8-2-2; s on the real clock from the blow, px on the logical screen):
 *  - the dark cut: `cutAlpha` for `cut` s, then to 0 over `cutFade`; at most once per `gap` s (the same real clock as
 *    Juice.finisherStop's gap);
 *  - the star: slams `slamFrom`× → 1× in `slam`, holds `hold`, its points grow to `grow`× fading over `out`; outer
 *    radius rMin–rMax (= the footprint × rK), inner `inner` × (4 points or fewer: `innerFew`), a `rim` px colour edge
 *    and a 3 px dark one; its centre kept inside x0–x1 / y0–y1, at height z on the blow;
 *  - 기획 24차 검토: its outline never rises above logical y `top` — the boss bar and the raid pattern-tip slot under it
 *    (measured on the 844×390 phone: logical y 100–177 with its 「⚙ …」 line; + 8 px). y0 = top + rMin: a blow higher
 *    up (a fixed boss on the top row) gets its star just under the slot, shrunk to fit (≥ rMin) — never under the tip;
 *    the slam / the grow as it fades push the centre down instead of crossing `top`;
 *  - the streaks: from `flareAt` over `flareSec`, a flareW × flareH flat one and a flareV × flareVH upright one;
 *  - the rings [from, to, width from, width to, sec]: ring1 (screen colour) at `ringAt`, ring2 (white) `ring2At` later;
 *  - the record stays `busy` s (ultScreenBusy: the warnings over the after-blow vignette, as the 23차 glyph did) — 기획
 *    24차 검토: + the world freeze my finisher's stop left (extendImpact): the vignette (ULT_FINISH.tailAt 0.12 → 0.72 s)
 *    runs on the world clock, which stands still through the stop.
 */
export const IMPACT = {
  cut: 0.05, cutFade: 0.06, cutAlpha: 0.65, gap: 1.0,
  slam: 0.06, slamFrom: 1.6, hold: 0.12, out: 0.2, grow: 1.35,
  rMin: 120, rMax: 220, rK: 1.1, inner: 0.42, innerFew: 0.18, rim: 6,
  flareAt: 0.02, flareSec: 0.2, flareW: 1100, flareH: 10, flareV: 280, flareVH: 6,
  ring1: [60, 480, 22, 2, 0.32], ring2: [40, 360, 10, 1, 0.3], ring2At: 0.06, ringAt: 0.03,
  busy: 0.74, x0: 100, x1: 1180, y0: 305, y1: 620, z: 0.6, top: 185,
} as const;

/**
 * 기획 24차: my impact frame (the grammar calls it after its `s.local` check); a new one replaces the old. cut = the dark
 * cut's alpha (zeroed here for the 1 s gate / the hit-stop setting 0 / reduced motion); burst ≤ 0 = no star. The star's
 * points are drawn once here (Math.random jag — render only). Counts toward no particle / effect budget (screen layer).
 */
export function pushImpact(x: number, y: number, rPx: number, charId: string, theme: UltTheme, color: string, cut: number, burst: number): void {
  const reduced = prefersReducedMotion();
  let a = cut > 0 && !reduced && JUICE.hitStopMs > 0 ? Math.min(1, cut) : 0;
  if (a > 0) {
    if (realNow - lastCut < IMPACT.gap) a = 0;
    else lastCut = realNow;
  }
  const b = theme.burst;
  const n = Math.max(2, Math.round(b.spikes));
  const inner = n <= 4 ? IMPACT.innerFew : IMPACT.inner;
  const jag = Math.max(0, Math.min(0.6, b.jag));
  const pts: number[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const out = i % 2 === 0;
    pts.push(b.tilt + (i * Math.PI) / n, out ? 1 - jag * Math.random() : inner * (1 - jag * 0.5 * Math.random()));
  }
  impact = {
    charId,
    x,
    y,
    r: burst > 0 ? Math.max(0, rPx) : 0,
    color,
    ink: b.ink,
    cut: a,
    slam: !reduced,
    flare: !reduced && !FX_LOAD.low,
    ring2: !FX_LOAD.low,
    ringK: reduced ? 0.5 : 1,
    pts,
    t0: realNow,
    busy: IMPACT.busy,
  };
}

/**
 * 기획 24차 검토 (grammar.ts, right after my finisher's stop): the world stays frozen `sec` more s from now — the impact
 * record I just pushed stays that much longer (its after-blow vignette starts and runs on the world clock).
 */
export function extendImpact(sec: number): void {
  if (impact && impact.t0 === realNow) impact.busy = IMPACT.busy + Math.max(0, Number.isFinite(sec) ? sec : 0);
}

/** Speed lines (mine): radial around (x, y), or parallel along dir. Off with shake 0 / reduced motion. */
export function pushSpeedLines(x: number, y: number, dir: number | undefined, n: number, color: string, alpha: number): void {
  if (JUICE.shake <= 0 || prefersReducedMotion()) return;
  const radial = dir === undefined || !Number.isFinite(dir);
  if (!radial && FX_LOAD.low) return;
  const a: number[] = [];
  const r: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    a.push(radial ? (i / n) * TAU + (Math.random() - 0.5) * (TAU / n) : (Math.random() - 0.5) * 2);
    r.push(Math.random());
    w.push(1.5 + Math.random() * 3);
  }
  lines = { x, y, dir: radial ? NaN : dir!, color, alpha, t0: realNow, dur: radial ? 0.22 : 0.2, a, r, w };
}

// ─────────────────────────── drawing: ground ───────────────────────────

function draw(ctx: CanvasRenderingContext2D, _state: unknown, view: UltFxView, now: number): void {
  const cam = view.cam;
  if (!cam) return;
  lastCam = cam;
  worldNow = now;
  drawDecals(ctx, cam, now);
  if (locks.length) drawLocks(ctx, cam, now);
  if (reticles.length === 0) return;
  for (let i = reticles.length - 1; i >= 0; i--) {
    const r = reticles[i];
    r.t0 ??= now;
    const t = (now - r.t0) / RETICLE_SEC;
    if (t >= 1 || t < 0) {
      reticles.splice(i, 1);
      continue;
    }
    const a = (1 - t) * r.k;
    const rad = 1.6 - 0.9 * Math.min(1, t * 2.5);
    ctx.beginPath();
    groundEllipse(ctx, cam, r.x, r.y, rad);
    ctx.globalAlpha = a * 0.7;
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#05060a';
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = r.color;
    ctx.stroke();
    // four ticks pointing in
    const sx = cam.sx(r.x);
    const sy = cam.sy(r.y);
    const R = cam.sx(r.x + rad) - sx;
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 0.6],
      [0, -0.6],
    ]) {
      ctx.moveTo(sx + dx * (R + 10), sy + dy * (R + 10));
      ctx.lineTo(sx + dx * (R - 6), sy + dy * (R - 6));
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** The lock-on brackets, the rune ring under them, the white pops (2-4). World clock. */
function drawLocks(ctx: CanvasRenderingContext2D, cam: Camera, now: number): void {
  for (let i = locks.length - 1; i >= 0; i--) {
    const l = locks[i];
    l.born ??= now;
    const age = now - l.born;
    // 기획 23차 검토: a held lock bursts with the real blow (burst), or — no blow yet — waits ≤ lateSec past keepUntil
    const keep = l.keepUntil <= 0 ? -1 : l.burst >= 0 ? l.burst : age > l.keepUntil ? Math.min(age, l.keepUntil + LOCK.lateSec) : l.keepUntil;
    const end = l.small ? LOCK.smallSec : keep >= 0 ? keep + 0.2 : LOCK.endSec;
    if (age >= end || age < 0) {
      locks.splice(i, 1);
      continue;
    }
    const base = l.local ? 1 : LOCK.otherAlpha;
    // where / how big: the aimed spot, sliding onto the finisher's footprint while it is held
    let x = l.x;
    let y = l.y;
    let r = l.r;
    let alpha = base;
    const held = l.keepUntil > 0 && age > LOCK.clickSec + 0.05;
    if (held) {
      const s = easeOut(clamp01((age - LOCK.clickSec - 0.05) / 0.25));
      x += (l.keepX - l.x) * s;
      y += (l.keepY - l.y) * s;
      r += (l.keepR - l.r) * s;
      alpha = base * LOCK.otherAlpha;
    }
    // scale: 2.2× → 1× (0–0.18 s), breathing ±6 %, 「찰칵」 0.9× at 0.4 s
    const closeEnd = l.small ? LOCK.closeSec * 0.8 : LOCK.closeSec;
    let sc = 1;
    if (age < closeEnd) sc = 2.2 - 1.2 * easeOut(age / closeEnd);
    else if (age < LOCK.clickSec && !l.small) sc = 1 + 0.06 * Math.sin((age - closeEnd) * 28);
    else sc = l.small ? 1 : 0.9;
    // fading out (not held)
    if (l.keepUntil <= 0) {
      const fadeFrom = l.small ? LOCK.smallSec - 0.15 : LOCK.endSec - 0.2;
      if (age > fadeFrom) alpha *= clamp01(1 - (age - fadeFrom) / (end - fadeFrom));
    } else if (age > keep) {
      // bursts with the finisher
      const p = clamp01((age - keep) / 0.2);
      alpha *= 1 - p;
      sc *= 1 + 0.5 * p;
    }
    if (alpha <= 0.01) continue;
    const sx = cam.sx(x);
    const sy = cam.sy(y);
    const rx = r * PX_PER_UNIT;
    const ry = r * PX_PER_UNIT_Y;
    // the rune ring (character colour, ticks turning)
    const spin = age * (held ? 0.9 : 2.4);
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 2;
    ctx.strokeStyle = l.color;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    for (let j = 0; j < 12; j++) {
      const a = spin + (j / 12) * TAU;
      ctx.moveTo(sx + Math.cos(a) * rx * 0.88, sy + Math.sin(a) * ry * 0.88);
      ctx.lineTo(sx + Math.cos(a) * rx, sy + Math.sin(a) * ry);
    }
    ctx.stroke();
    // the brackets (dark under-stroke so they read on any floor)
    const bx = rx * sc + 6;
    const by = ry * sc + 6;
    const arm = Math.max(10, Math.min(34, rx * 0.35));
    const armY = Math.max(8, Math.min(24, ry * 0.4));
    ctx.beginPath();
    for (let cx = -1; cx <= 1; cx += 2) {
      for (let cy = -1; cy <= 1; cy += 2) {
        const px = sx + cx * bx;
        const py = sy + cy * by;
        ctx.moveTo(px - cx * arm, py);
        ctx.lineTo(px, py);
        ctx.lineTo(px, py - cy * armY);
      }
    }
    ctx.globalAlpha = alpha * 0.7;
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#05060a';
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // white pops: when it appears, and the click
    const pop = age < 0.15 ? age / 0.15 : age >= LOCK.clickSec && age < LOCK.clickSec + 0.15 && !l.small ? (age - LOCK.clickSec) / 0.15 : -1;
    if (pop >= 0) {
      ctx.globalAlpha = alpha * (1 - pop);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * (1 + 0.3 * pop), ry * (1 + 0.3 * pop), 0, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ─────────────────────────── drawing: screen layer ───────────────────────────

/**
 * 기획 23차: the screen layer (logical px, unshaken, real clock): 기획 24차 the impact frame first (under the rest), then
 * the sight lines and the speed lines. render/index.ts draws it after vfx.drawScreen and in the hit-stop's frozen
 * frames. Nothing outside the 궁극기 테스트; never a letter (tests/render/ult-fx-core.test.ts 「글자 없음」).
 */
export function drawUltScreen(ctx: CanvasRenderingContext2D, view: UltFxView): void {
  if (view.state.mode !== 'ultTest') return;
  const cam = view.cam;
  if (!cam) return;
  lastCam = cam;
  if (impact && !drawImpact(ctx, cam, impact)) impact = null;
  if (sights.length) drawSights(ctx, cam, view);
  if (lines) drawLines(ctx, cam);
  ctx.globalAlpha = 1;
}

function drawSights(ctx: CanvasRenderingContext2D, cam: Camera, view: UltFxView): void {
  const h = view.host as UltHost;
  for (let i = sights.length - 1; i >= 0; i--) {
    const s = sights[i];
    const t = realNow - s.t0;
    if (t >= SIGHT.fire + SIGHT.suck) {
      sights.splice(i, 1);
      continue;
    }
    if (t < SIGHT.from) continue;
    const m = h.memo(s.entityId);
    if (!m) continue;
    const x0 = cam.sx(m.x);
    const y0 = cam.sy(m.y) - SIGHT.chest * PX_PER_UNIT_Z;
    const x1 = cam.sx(s.x);
    const y1 = cam.sy(s.y);
    const grow = clamp01((t - SIGHT.from) / SIGHT.drawIn);
    const suck = clamp01((t - SIGHT.fire) / SIGHT.suck);
    const ax = x0 + (x1 - x0) * suck;
    const ay = y0 + (y1 - y0) * suck;
    const bx = x0 + (x1 - x0) * grow;
    const by = y0 + (y1 - y0) * grow;
    const a = s.local ? 1 : SIGHT.otherAlpha;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.globalAlpha = a * 0.55;
    ctx.lineWidth = 9;
    ctx.strokeStyle = s.color;
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (s.local && suck < 1) {
      // ››› running toward the aim
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {
        const p = (t * 3 + j / 3) % 1;
        if (p < suck || p > grow) continue;
        const cx = x0 + dx * p;
        const cy = y0 + dy * p;
        ctx.moveTo(cx - ux * 9 - uy * 8, cy - uy * 9 + ux * 8);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - ux * 9 + uy * 8, cy - uy * 9 - ux * 8);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

function drawLines(ctx: CanvasRenderingContext2D, cam: Camera): void {
  const L = lines!;
  const t = (realNow - L.t0) / L.dur;
  if (t >= 1 || t < 0) {
    lines = null;
    return;
  }
  const sx = cam.sx(L.x);
  const sy = cam.sy(L.y);
  ctx.strokeStyle = L.color;
  ctx.lineCap = 'round';
  if (Number.isNaN(L.dir)) {
    // radial: from the screen's edge in toward the blow, closing in as they fade
    const inner = 260 - 120 * easeOut(t);
    for (let i = 0; i < L.a.length; i++) {
      const a = L.a[i];
      const r0 = inner + L.r[i] * 140;
      ctx.globalAlpha = L.alpha * (1 - t);
      ctx.lineWidth = L.w[i];
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
      ctx.lineTo(sx + Math.cos(a) * 1500, sy + Math.sin(a) * 1500);
      ctx.stroke();
    }
  } else {
    // parallel streaks along the move, sliding back past it
    let ux = Math.cos(L.dir) * PX_PER_UNIT;
    let uy = Math.sin(L.dir) * PX_PER_UNIT_Y;
    const n = Math.hypot(ux, uy) || 1;
    ux /= n;
    uy /= n;
    for (let i = 0; i < L.a.length; i++) {
      const off = L.a[i] * 220;
      const len = 120 + L.r[i] * 200;
      const back = 40 + 260 * t + L.r[i] * 80;
      const cx = sx - ux * back - uy * off;
      const cy = sy - uy * back + ux * off;
      ctx.globalAlpha = L.alpha * (1 - t);
      ctx.lineWidth = L.w[i] * 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - ux * len, cy - uy * len);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

/**
 * 기획 24차 충격 프레임: my impact frame this frame (8-2-2); false once its record is over (its busy s — the picture
 * itself is gone after ~0.39 s, the record keeps ultScreenBusy on). Bottom to top: the dark cut over the whole screen,
 * the two shock rings, the streaks, the star.
 */
function drawImpact(ctx: CanvasRenderingContext2D, cam: Camera, m: Impact): boolean {
  const t = realNow - m.t0;
  if (t >= m.busy || t < 0) return false;
  // on the blow (height z), never under the HUD / off the screen: the centre at least y0, the outline under `top` (the
  // boss bar + the pattern-tip slot) — a high blow's star shrinks to fit (≥ rMin, as y0 = top + rMin)
  const cx = Math.max(IMPACT.x0, Math.min(IMPACT.x1, cam.sx(m.x)));
  const cy = Math.max(IMPACT.y0, Math.min(IMPACT.y1, cam.sy(m.y) - IMPACT.z * PX_PER_UNIT_Z));
  const r = Math.min(m.r, cy - IMPACT.top);
  // the dark cut: the whole screen in the character's ink, lifting off the screen flash under it
  if (m.cut > 0 && t < IMPACT.cut + IMPACT.cutFade) {
    ctx.globalAlpha = m.cut * (t < IMPACT.cut ? 1 : 1 - (t - IMPACT.cut) / IMPACT.cutFade);
    ctx.fillStyle = m.ink;
    ctx.fillRect(-40, -40, LOGICAL_W + 80, LOGICAL_H + 80);
  }
  // two shock rings out past the screen's edge (screen colour, then white)
  shockRing(ctx, cx, cy, t - IMPACT.ringAt, IMPACT.ring1, m.color, m.ringK);
  if (m.ring2) shockRing(ctx, cx, cy, t - IMPACT.ringAt - IMPACT.ring2At, IMPACT.ring2, '#ffffff', m.ringK);
  // the streaks through the star's centre: a long flat one and a short upright one, thinning as they fade
  if (m.flare) {
    const p = (t - IMPACT.flareAt) / IMPACT.flareSec;
    if (p >= 0 && p < 1) {
      const k = 1 - p;
      streak(ctx, cx, cy, (IMPACT.flareW / 2) * (0.85 + 0.15 * k), (IMPACT.flareH / 2) * k, m.color, k);
      streak(ctx, cx, cy, (IMPACT.flareVH / 2) * k, (IMPACT.flareV / 2) * (0.85 + 0.15 * k), m.color, k);
    }
  }
  // the star: slams 1.6× → 1× (none with reduced motion), holds, its points grow 1.35× as it fades — its outline kept
  // under `top` all the way (the centre goes down while it is bigger: it lands from below the tip slot)
  const outFrom = IMPACT.slam + IMPACT.hold;
  if (r > 0 && t < outFrom + IMPACT.out) {
    const sc = m.slam && t < IMPACT.slam ? IMPACT.slamFrom - (IMPACT.slamFrom - 1) * easeOut(t / IMPACT.slam) : 1;
    const p = t > outFrom ? clamp01((t - outFrom) / IMPACT.out) : 0;
    const grow = 1 + (IMPACT.grow - 1) * easeOut(p);
    const a = 1 - p;
    const pts = m.pts;
    const sy = Math.max(cy, IMPACT.top + r * sc * grow);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const rr = r * sc * pts[i + 1] * ((i / 2) % 2 === 0 ? grow : 1);
      const x = cx + Math.cos(pts[i]) * rr;
      const y = sy + Math.sin(pts[i]) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a * 0.9;
    ctx.lineWidth = 2 * (IMPACT.rim + 3);
    ctx.strokeStyle = '#05060a';
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.lineWidth = 2 * IMPACT.rim;
    ctx.strokeStyle = m.color;
    ctx.stroke();
    ctx.globalAlpha = a * 0.95;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  return true;
}

/** One shock ring [from, to, width from, width to, sec] at age t (nothing outside 0–sec). */
function shockRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number, spec: readonly number[], color: string, k: number): void {
  const [r0, r1, w0, w1, sec] = spec;
  if (t < 0 || t >= sec) return;
  const p = t / sec;
  const e = easeOut(p);
  ctx.globalAlpha = (1 - p) * 0.9 * k;
  ctx.lineWidth = w0 + (w1 - w0) * e;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r0 + (r1 - r0) * e, 0, TAU);
  ctx.stroke();
}

/** A pointed streak of light (half sizes hw × hh about cx, cy): a colour edge (3 px across) under a white core. */
function streak(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number, color: string, a: number): void {
  const flat = hw >= hh;
  for (let pass = 0; pass < 2; pass++) {
    const ex = pass === 0 && !flat ? 3 : 0;
    const ey = pass === 0 && flat ? 3 : 0;
    ctx.globalAlpha = a * (pass === 0 ? 0.8 : 1);
    ctx.fillStyle = pass === 0 ? color : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - hw - ex, cy);
    ctx.lineTo(cx, cy - hh - ey);
    ctx.lineTo(cx + hw + ex, cy);
    ctx.lineTo(cx, cy + hh + ey);
    ctx.closePath();
    ctx.fill();
  }
}

registerUltFx({ onEvent, draw });
