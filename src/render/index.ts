// Canvas 2D quarter-view renderer. Reads GameState (never mutates it) + GameEvents for one-shot VFX.
// Public API: createRenderer(canvas) → Renderer (see src/types.ts).

import {
  LOGICAL_H,
  LOGICAL_W,
  type AreaShape,
  type DragPreview,
  type Entity,
  type GameEvent,
  type GameState,
  type Renderer,
  type RenderUiState,
  type Telegraph,
  type Vec2,
} from '../types';
import { type BossDrawOpts, bossPhaseOf, drawBossArt, drawBossShadow } from './boss';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z, VIEW_WIDTH_UNITS } from './camera';
import { Backdrop } from './ground';
import { COLORS, OTHER_PLAYER_FX, OTHER_ZONE_ALPHA, boldFont, lighten } from './look';
import { gearBandsOf } from '../data/gear';
import { CHARACTERS } from '../data';
import { areaCentroid, areaExtent } from '../sim/geometry';
import { drawAimedDirection, drawAreaDirection, drawFieldEventPreview, drawPreviewBadges, drawPreviewFootprint, previewDashEnd } from './preview';
import { FieldEventFx } from './fieldEvents';
import { GroggyFx } from './groggyFx';
import { TAU, addAreaPath, areaReach, pathArea, pathCapsule } from './shapes';
import {
  HERO_POSE,
  type UnitMemo,
  animProgress,
  barStyleFor,
  bodyTop,
  bodyWidth,
  drawBody,
  drawGroundRing,
  drawHpBar,
  drawLocalMarker,
  drawNameTag,
  drawShadow,
  drawStatusPips,
  drawStunStars,
  newMemo,
  syncMemo,
  type TagBox,
} from './units';
import { Vfx, type VfxContext, playerColor } from './vfx';
import type { BandAvoid } from './cutin';
import { TeleSequencer, type TeleSeqInfo } from './teleseq';
import { screenBoostFor } from './juice';
import { DASH_LAND } from './dashtime';
import { CREATURE_POSE, midAura } from './creatures';
import { drawStyledTelegraph, drawZoneDecor } from './marks';
import { governScale, newGovernor } from './quality';
import { isStopped } from './statusfx';

export { Camera } from './camera';

const MAX_DT = 0.1;
/** Drop-in height (world units) of a character appearing (swap / floor start). */
const APPEAR_DROP = 3;
const PROJECTILE_Z = 0.75;
const ZONE_DASH = [8, 6];
const NO_DASH: number[] = [];
const LATER_DASH = [10, 7];
const byY = (a: Entity, b: Entity) => a.pos.y - b.pos.y || a.id - b.id;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다');
  const cam = new Camera();
  const backdrop = new Backdrop();
  const vfx = new Vfx();
  /** 기획 12차: 돌발 괴담 rings, markers, arrows and bursts (render/fieldEvents.ts). */
  const fieldFx = new FieldEventFx();
  const teleSeq = new TeleSequencer();
  /** Last monster skill each enemy cast (bodies that change with their pattern: 신호등 인간 빨간불 / 초록불). */
  const lastMonsterSkill = new Map<number, string>();
  const memos = new Map<number, UnitMemo>();
  const vc: VfxContext = { state: null as unknown as GameState, memos, localPlayer: 0 };
  const sorted: Entity[] = [];
  const bosses: Entity[] = [];
  let stamp = 0;
  let time = 0;
  let dpr = 0;
  let arenaFloor = -1;
  let runSeed: number | null = null;
  let lastTick = 0;
  let arenaBoss = false;
  let arenaW = 0;
  let arenaH = 0;
  let snapPending = true;
  const lastBoss = { x: 0, y: 0, radius: 3, color: '#3a0ca3', defId: '', phase: 1 };
  const bossOpts: BossDrawOpts = { color: '', time: 0, enraged: false, flash: 0, retreat: 0, lookX: null, lookY: null, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  /** 기획 13차: boss groggy pose timing, break effects and the 「그로기!」 stamp. */
  const groggyFx = new GroggyFx();
  const pruneMemo = (m: UnitMemo, id: number) => {
    if (m.stamp !== stamp) memos.delete(id);
  };
  let hasLastBoss = false;
  /**
   * The top-centre HUD box in logical px (styles.css `.hud-tc`: centred at x 640, top 8 — `.boss` 420 wide, bottom
   * ≈ 95 on boss floors; `.floorinfo` ≈ 402 wide, bottom ≈ 57 on normal floors), plus a few px of margin.
   */
  const TOP_PANEL_BOSS = { x0: 424, x1: 856, y1: 100 };
  const TOP_PANEL_NORMAL = { x0: 433, x1: 847, y1: 62 };

  // Backing-store resolution follows the pixels actually shown: the stage is CSS-scaled to fit the screen
  // (e.g. ×0.54 on an 844×390 phone), so DPR alone would over-allocate (≈50% more pixels to fill per frame).
  // The displayed width is re-read only on resize-type events and about once a second (avoids forced layouts).
  let shownScale = 1;
  let scaleCheckIn = 0;
  /** 기획 13차 통합: backing-scale governor (slow device → fewer backing pixels). */
  const quality = newGovernor();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const dirty = () => {
      scaleCheckIn = 0;
    };
    window.addEventListener('resize', dirty);
    window.addEventListener('orientationchange', dirty);
    window.visualViewport?.addEventListener('resize', dirty);
  }
  function readShownScale(dt: number): number {
    scaleCheckIn -= dt;
    if (scaleCheckIn > 0) return shownScale;
    scaleCheckIn = 1;
    const el = canvas as HTMLCanvasElement & { getBoundingClientRect?: () => DOMRect };
    if (typeof el.getBoundingClientRect === 'function') {
      const w = el.getBoundingClientRect().width;
      if (w > 0 && Number.isFinite(w)) shownScale = w / LOGICAL_W;
    }
    return shownScale;
  }

  function ensureBackingStore(dt: number): void {
    const raw = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    // device px per logical px, in 1/8 steps so tiny layout jitter never reallocates; never below 1, at most 2
    const shown = readShownScale(dt);
    // 기획 13차 통합: a device that can't keep up renders fewer backing pixels (render/quality.ts)
    const cap = governScale(quality, dt, dpr);
    const want = Math.max(1, Math.min(2, cap, Math.round(raw * shown * 8) / 8));
    // 기획 8차 리뷰: the shake is felt in CSS px — a phone's 0.54× stage gets ~1.5× the logical kick
    vfx.juice.screenBoost = screenBoostFor(shown);
    const w = Math.round(LOGICAL_W * want);
    const h = Math.round(LOGICAL_H * want);
    if (want !== dpr || canvas.width !== w || canvas.height !== h) {
      dpr = want;
      canvas.width = w;
      canvas.height = h;
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function localTargetX(state: GameState, local: number): number | null {
    const p = state.players[local];
    if (!p || p.activeIndex === null) return null;
    const member = p.party[p.activeIndex];
    if (!member || member.entityId === null) return null;
    const m = memos.get(member.entityId);
    return m ? m.x : null;
  }

  // ─────────────────────────── ground-layer passes ───────────────────────────

  function drawZones(state: GameState): void {
    const c = ctx!;
    for (const z of state.zones) {
      if (!cam.visibleX(z.center.x, (z.area ? areaReach(z.area) : z.radius) + 1)) continue;
      // 기획 13차: a renewed skill's field is border decor only (render/marks.ts)
      const deco = vfx.marks.zone(z.id);
      if (deco) {
        if (!deco.skip) drawZoneDecor(c, cam, z, deco, time);
        continue;
      }
      const color =
        vfx.zoneTint(z.center.x, z.center.y) ??
        (z.kind === 'heal'
          ? COLORS.zoneHeal
          : z.kind === 'buff'
            ? COLORS.zoneBuff
            : z.kind === 'debuff'
              ? COLORS.zoneDebuff
              : z.team === 'enemy'
                ? COLORS.zoneDamageEnemy
                : COLORS.zoneDamageAlly);
      const fadeIn = z.total > 0 ? Math.min(1, (z.total - z.remaining) / 0.25) : 1;
      const fade = Math.min(1, z.remaining / 0.4, fadeIn);
      // other players' fields (a bot's pet circle, their cleric spring …): a thin outline in the field colour only —
      // filled, they read as part of my own skill (playtest) and the big translucent fills cost frame time
      if (z.ownerPlayer != null && z.ownerPlayer !== vc.localPlayer && z.team === 'ally') {
        pathArea(c, cam, z.center, null, z.area ?? { shape: 'circle', radius: z.radius }, 1);
        c.globalAlpha = OTHER_ZONE_ALPHA * fade;
        c.lineWidth = 2;
        c.strokeStyle = color;
        c.setLineDash(ZONE_DASH);
        c.stroke();
        c.setLineDash(NO_DASH);
        continue;
      }
      if (z.area && z.area.shape !== 'circle') {
        drawShapedZone(z, z.area, color, fade);
        continue;
      }
      const sx = cam.sx(z.center.x);
      const sy = cam.sy(z.center.y);
      const rx = z.radius * PX_PER_UNIT;
      const ry = z.radius * PX_PER_UNIT_Y;
      c.beginPath();
      c.ellipse(sx, sy, rx, ry, 0, 0, TAU);
      c.globalAlpha = (z.team === 'enemy' ? 0.24 : 0.18) * fade;
      c.fillStyle = color;
      c.fill();
      c.globalAlpha = 0.75 * fade;
      c.lineWidth = 2;
      c.strokeStyle = color;
      if (z.team === 'enemy') c.setLineDash(ZONE_DASH);
      c.stroke();
      c.setLineDash(NO_DASH);
      // swirling inner arcs
      c.globalAlpha = 0.45 * fade;
      c.lineWidth = 2.5;
      const rot = time * (z.kind === 'damage' ? 2.2 : 1.2) + z.id;
      c.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = rot + (i * TAU) / 3;
        c.moveTo(sx + Math.cos(a) * rx * 0.62, sy + Math.sin(a) * ry * 0.62);
        c.ellipse(sx, sy, rx * 0.62, ry * 0.62, 0, a, a + 0.9);
      }
      c.stroke();
      // remaining-time arc
      if (z.total > 0) {
        const frac = Math.max(0, Math.min(1, z.remaining / z.total));
        c.globalAlpha = 0.9 * fade;
        c.lineWidth = 3.5;
        c.beginPath();
        c.ellipse(sx, sy, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  /** Non-circle persistent zone (3차 shapes): exact footprint, slow inner pulse, remaining-time ring at its middle. */
  function drawShapedZone(z: GameState['zones'][number], area: AreaShape, color: string, fade: number): void {
    const c = ctx!;
    pathArea(c, cam, z.center, null, area, 1);
    c.globalAlpha = (z.team === 'enemy' ? 0.24 : 0.18) * fade;
    c.fillStyle = color;
    c.fill();
    c.globalAlpha = 0.75 * fade;
    c.lineWidth = 2;
    c.strokeStyle = color;
    if (z.team === 'enemy') c.setLineDash(ZONE_DASH);
    c.stroke();
    c.setLineDash(NO_DASH);
    const k = (time * 0.8 + z.id * 0.37) % 1;
    pathArea(c, cam, z.center, null, area, 0.35 + 0.65 * k);
    c.globalAlpha = 0.35 * (1 - k) * fade;
    c.lineWidth = 2.5;
    c.stroke();
    if (z.total > 0) {
      const mid = areaCentroid(area, z.center);
      const frac = Math.max(0, Math.min(1, z.remaining / z.total));
      const sx = cam.sx(mid.x);
      const sy = cam.sy(mid.y);
      c.globalAlpha = 0.9 * fade;
      c.lineWidth = 3.5;
      c.beginPath();
      c.ellipse(sx, sy, 0.7 * PX_PER_UNIT, 0.7 * PX_PER_UNIT_Y, 0, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /** Ally telegraphs go on the ground; enemy ones are drawn again later, above the boss body (tentacles hid them). */
  function drawTelegraphs(state: GameState, team: 'ally' | 'enemy'): void {
    if (team === 'enemy') {
      drawEnemyTelegraphs(state);
      return;
    }
    // ally warnings (delayed parts of our own skills, e.g. meteors): light fills, few at once
    const c = ctx!;
    const color = COLORS.telegraphAlly;
    for (const t of state.telegraphs) {
      if (t.team !== 'ally') continue;
      // 기획 13차: a renewed beat's warning in the character's colour + motif (render/marks.ts)
      const st = vfx.marks.tele(t.id);
      if (st) {
        drawStyledTelegraph(c, cam, t, st, time);
        continue;
      }
      const p = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
      const area = t.area.shape === 'circle' && t.area.radius > 30 ? BIG_CIRCLE : t.area;
      pathArea(c, cam, t.center, t.origin, area, 1);
      c.globalAlpha = 0.12;
      c.fillStyle = color;
      c.fill();
      const urgent = t.remaining < 0.35;
      c.globalAlpha = urgent ? 0.6 + 0.4 * Math.sin(time * 40) : 0.9;
      c.lineWidth = 2.5;
      c.strokeStyle = urgent ? '#ffffff' : color;
      c.stroke();
      if (p > 0.01) {
        pathArea(c, cam, t.center, t.origin, area, p);
        c.globalAlpha = 0.3;
        c.fillStyle = color;
        c.fill();
        c.globalAlpha = 0.8;
        c.lineWidth = 1.5;
        c.strokeStyle = color;
        c.stroke();
      }
      if (area.shape === 'rect' || area.shape === 'cone') drawAreaDirection(c, cam, t.center, area, '#ffffff', 0.8, time, false);
    }
    c.globalAlpha = 1;
  }

  // ── enemy warnings (기획 8차 리뷰: "red soup" on 16~20층, the 5층 door sweep reading as one red wall) ──
  // 1. Overlapping footprints fill as ONE even tint (each later one clipped to leave out the earlier ones), so overlaps
  //    no longer darken into a blob; every warning keeps its own outline and countdown fill.
  // 2. Parts of one multi-part cast (TeleSequencer): only the next part is strong; later ones are dashed, numbered
  //    outlines with a sweep arrow from part to part (문짝 1·2·3·4, 메스 3줄, 고리 → 가운데, 도장 연타).
  const seqTmp: TeleSeqInfo = { order: 0, count: 0, next: false, group: 0 };
  const labelTmp = { x: 0, y: 0 };
  const seqChain: { group: number; order: number; x: number; y: number; next: boolean }[] = [];

  /** Strong (not "later part") enemy warnings this frame with their screen boxes (logical px); pooled. */
  interface TeleBox {
    t: Telegraph;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    over: boolean;
  }
  const teleBoxes: TeleBox[] = [];
  let teleBoxN = 0;

  function collectTeleBoxes(state: GameState): boolean {
    teleBoxN = 0;
    for (const t of state.telegraphs) {
      if (t.team !== 'enemy') continue;
      const sq = teleSeq.info(t, seqTmp);
      if (sq && !sq.next) continue;
      const r = (t.area.shape === 'circle' && t.area.radius > 30 ? 40 : areaReach(t.area)) + 0.3;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const pts = t.area.shape === 'line' || t.area.shape === 'fan' ? 2 : 1;
      for (let i = 0; i < pts; i++) {
        const p = i === 0 ? t.center : t.origin;
        const sx = cam.sx(p.x);
        const sy = cam.sy(p.y);
        x0 = Math.min(x0, sx - r * PX_PER_UNIT);
        x1 = Math.max(x1, sx + r * PX_PER_UNIT);
        y0 = Math.min(y0, sy - r * PX_PER_UNIT_Y);
        y1 = Math.max(y1, sy + r * PX_PER_UNIT_Y);
      }
      let b = teleBoxes[teleBoxN];
      if (!b) teleBoxes.push((b = { t, x0, y0, x1, y1, over: false }));
      b.t = t;
      b.x0 = x0;
      b.y0 = y0;
      b.x1 = x1;
      b.y1 = y1;
      b.over = false;
      teleBoxN++;
    }
    let any = false;
    for (let i = 0; i < teleBoxN; i++) {
      const a = teleBoxes[i];
      for (let j = i + 1; j < teleBoxN; j++) {
        const b = teleBoxes[j];
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
          a.over = b.over = true;
          any = true;
        }
      }
    }
    return any;
  }

  function teleProgress(t: Telegraph): number {
    return t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
  }

  /**
   * Fills of the strong warnings: footprint (alpha 0.24) + countdown (0.36). Where footprints overlap, each later one
   * is clipped to leave out the ones already filled (even-odd "box minus shape" clips), so the union is one even tint
   * instead of a darker blob; countdown fills stay per warning (overlapping ones darken only as they are about to land).
   * No offscreen layer: a full-resolution layer blit cost ~10 fps in crowds on a software-rendered phone-sized canvas.
   */
  function fillEnemyTelegraphs(state: GameState, c: CanvasRenderingContext2D): void {
    const overlap = collectTeleBoxes(state);
    const color = COLORS.telegraphEnemy;
    c.fillStyle = color;
    for (let pass = 0; pass < 2; pass++) {
      const full = pass === 0;
      c.globalAlpha = full ? 0.24 : 0.36;
      for (let i = 0; i < teleBoxN; i++) {
        const b = teleBoxes[i];
        const p = teleProgress(b.t);
        if (!full && p <= 0.01) continue;
        let clipped = false;
        if (full && overlap && b.over) {
          for (let j = 0; j < i; j++) {
            const o = teleBoxes[j];
            if (!o.over || o.x0 >= b.x1 || b.x0 >= o.x1 || o.y0 >= b.y1 || b.y0 >= o.y1) continue;
            if (!clipped) {
              c.save();
              clipped = true;
            }
            c.beginPath();
            c.rect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
            addAreaPath(c, cam, o.t.center, o.t.origin, teleArea(o.t), 1);
            c.clip('evenodd');
          }
        }
        pathArea(c, cam, b.t.center, b.t.origin, teleArea(b.t), full ? 1 : p);
        c.fill();
        if (clipped) {
          c.restore();
          c.fillStyle = color;
          c.globalAlpha = full ? 0.24 : 0.36;
        }
      }
    }
    c.globalAlpha = 1;
  }

  function teleArea(t: Telegraph): AreaShape {
    return t.area.shape === 'circle' && t.area.radius > 30 ? BIG_CIRCLE : t.area;
  }

  /** Where a warning's number badge goes (world): the footprint's middle (aimed shapes: along the aim). */
  function teleLabelPoint(t: Telegraph, arena: { width: number; height: number }): { x: number; y: number } {
    const a = t.area;
    if (a.shape === 'line' || a.shape === 'fan') {
      const dx = t.center.x - t.origin.x;
      const dy = t.center.y - t.origin.y;
      const d = Math.hypot(dx, dy) || 1;
      const len = a.shape === 'line' ? a.length * 0.5 : a.radius * 0.55;
      labelTmp.x = t.origin.x + (dx / d) * len;
      labelTmp.y = t.origin.y + (dy / d) * len;
    } else {
      const p = areaCentroid(a, t.center);
      labelTmp.x = p.x;
      labelTmp.y = p.y;
    }
    labelTmp.x = Math.max(0.6, Math.min(arena.width - 0.6, labelTmp.x));
    labelTmp.y = Math.max(0.8, Math.min(arena.height - 0.8, labelTmp.y));
    return labelTmp;
  }

  function drawEnemyTelegraphs(state: GameState): void {
    const c = ctx!;
    const color = COLORS.telegraphEnemy;
    fillEnemyTelegraphs(state, c);
    seqChain.length = 0;
    for (const t of state.telegraphs) {
      if (t.team !== 'enemy') continue;
      const p = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
      const area = t.area.shape === 'circle' && t.area.radius > 30 ? BIG_CIRCLE : t.area;
      const sq = teleSeq.info(t, seqTmp);
      const later = !!sq && !sq.next;
      pathArea(c, cam, t.center, t.origin, area, 1);
      if (later) {
        // a later part of the same cast: a dashed outline only (its number says when)
        c.setLineDash(LATER_DASH);
        c.globalAlpha = 0.6;
        c.lineWidth = 2;
        c.strokeStyle = '#ff9aa2';
        c.stroke();
        c.setLineDash(NO_DASH);
      } else {
        const urgent = t.remaining < 0.35;
        c.globalAlpha = urgent ? 0.6 + 0.4 * Math.sin(time * 40) : 0.9;
        c.lineWidth = 3;
        c.strokeStyle = urgent ? '#ffffff' : color;
        c.stroke();
        if (p > 0.01) {
          pathArea(c, cam, t.center, t.origin, area, p);
          c.globalAlpha = 0.8;
          c.lineWidth = 1.5;
          c.strokeStyle = color;
          c.stroke();
        }
        // a sweep band's own "down" chevrons would point the wrong way (the sweep goes sideways): arrows only on lone rects
        if ((area.shape === 'rect' && !sq) || area.shape === 'cone') drawAreaDirection(c, cam, t.center, area, '#ffffff', 0.8, time, false);
        else if (area.shape === 'fan' || area.shape === 'line') drawAimedDirection(c, cam, t.center, t.origin, area, '#ffe2e2', 0.85, time);
      }
      if (sq) {
        const lp = teleLabelPoint(t, state.plan.arena);
        seqChain.push({ group: sq.group, order: sq.order, x: lp.x, y: lp.y, next: sq.next });
      }
    }
    if (seqChain.length > 1) drawSeqChains();
    c.globalAlpha = 1;
  }

  /** Per multi-part cast: arrows from part to part in landing order, then a number on each part (1 = next). */
  function drawSeqChains(): void {
    const c = ctx!;
    seqChain.sort((a, b) => a.group - b.group || a.order - b.order);
    for (let i = 0; i < seqChain.length; i++) {
      const a = seqChain[i];
      const b = seqChain[i + 1];
      if (!b || b.group !== a.group) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1.2) continue;
      drawSweepArrow(c, cam.sx(a.x), cam.sy(a.y), cam.sx(b.x), cam.sy(b.y), a.next);
    }
    for (let i = 0; i < seqChain.length; i++) {
      const a = seqChain[i];
      // parts stacked on one spot (도장 연타): one badge, the next part's step
      let hidden = false;
      for (let j = 0; j < seqChain.length; j++) {
        const o = seqChain[j];
        if (j === i || o.group !== a.group || Math.hypot(o.x - a.x, o.y - a.y) >= 1.2) continue;
        if (o.order < a.order) hidden = true;
      }
      if (hidden) continue;
      drawSeqBadge(c, cam.sx(a.x), cam.sy(a.y), a.order, a.next);
    }
  }

  function drawSweepArrow(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, strong: boolean): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 30) return;
    const ux = dx / d;
    const uy = dy / d;
    const ax = x0 + ux * 22;
    const ay = y0 + uy * 22;
    const bx = x1 - ux * 22;
    const by = y1 - uy * 22;
    // marching chevrons along the way (the sweep's direction at a glance)
    const n = Math.max(1, Math.floor((d - 44) / 26));
    const shift = (time * 1.6) % 1;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let k = 0; k < n; k++) {
      const f = (k + shift) / n;
      const cx = ax + (bx - ax) * f;
      const cy = ay + (by - ay) * f;
      c.beginPath();
      c.moveTo(cx - ux * 7 - uy * 8, cy - uy * 7 + ux * 8);
      c.lineTo(cx + ux * 3, cy + uy * 3);
      c.lineTo(cx - ux * 7 + uy * 8, cy - uy * 7 - ux * 8);
      c.globalAlpha = (strong ? 0.95 : 0.6) * (0.35 + 0.65 * Math.sin(Math.PI * f));
      c.lineWidth = 6;
      c.strokeStyle = '#2a0006';
      c.stroke();
      c.lineWidth = 3;
      c.strokeStyle = strong ? '#ffffff' : '#ffc2c7';
      c.stroke();
    }
    c.lineCap = 'butt';
    c.globalAlpha = 1;
  }

  function drawSeqBadge(c: CanvasRenderingContext2D, x: number, y: number, n: number, next: boolean): void {
    const r = next ? 15 : 12;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.globalAlpha = next ? 0.95 : 0.75;
    c.fillStyle = next ? '#ffffff' : '#2a0610';
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = next ? '#ff2a3d' : '#ff9aa2';
    c.stroke();
    c.globalAlpha = 1;
    c.font = boldFont(next ? 18 : 15);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = next ? '#d90429' : '#ffd6da';
    c.fillText(String(n), x, y + 1);
  }

  function drawPreviewGround(dp: DragPreview, state: GameState): void {
    drawPreviewFootprint(ctx!, cam, dp, state.plan.arena, previewColor(dp), time);
  }

  function drawPreviewGhost(dp: DragPreview, state: GameState): void {
    const c = ctx!;
    const color = previewColor(dp);
    const fx = cam.sx(dp.pos.x);
    const fy = cam.sy(dp.pos.y);
    const bob = Math.sin(time * 5) * 3;
    const dash = dp.kind === 'swap' ? previewDashEnd(dp, state.plan.arena) : null;
    if (dash) {
      // where the character stops after its dash: a faint body that slides toward the end
      const k = dp.valid ? (time * 0.9) % 1 : 1;
      const e = 1 - (1 - k) * (1 - k);
      const gx = cam.sx(dash.from.x + (dash.to.x - dash.from.x) * e);
      const gy = cam.sy(dash.from.y + (dash.to.y - dash.from.y) * e);
      const w = bodyWidth(0.5);
      pathCapsule(c, gx, gy - 2, w, w * 1.3);
      c.globalAlpha = 0.28 * (dp.valid ? 1 - k * 0.3 : 0.6);
      c.fillStyle = color;
      c.fill();
      c.globalAlpha = 0.85;
      c.lineWidth = 2;
      c.setLineDash([5, 4]);
      c.strokeStyle = '#ffffff';
      c.stroke();
      c.setLineDash(NO_DASH);
    }
    c.globalAlpha = 0.5;
    if (dp.kind === 'swap') {
      const w = bodyWidth(0.5);
      const h = w * 1.3;
      pathCapsule(c, fx, fy - 6 + bob, w, h);
      c.fillStyle = color;
      c.fill();
      c.globalAlpha = 0.9;
      c.lineWidth = 2;
      c.strokeStyle = '#ffffff';
      c.stroke();
    } else {
      const r = 18;
      const cy = fy - 26 + bob;
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(fx - r * 0.9, cy - r * 0.3);
      c.lineTo(fx - r * 0.6, cy - r * 1.25);
      c.lineTo(fx - r * 0.1, cy - r * 0.8);
      c.lineTo(fx + r * 0.1, cy - r * 0.8);
      c.lineTo(fx + r * 0.6, cy - r * 1.25);
      c.lineTo(fx + r * 0.9, cy - r * 0.3);
      c.arc(fx, cy, r, -0.3, Math.PI + 0.3);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.9;
      c.lineWidth = 2;
      c.strokeStyle = '#ffffff';
      c.stroke();
    }
    drawPreviewBadges(c, cam, dp, color);
    c.globalAlpha = 1;
    if (!dp.valid) {
      const cy = fy - 34;
      c.globalAlpha = 1;
      c.lineCap = 'round';
      c.lineWidth = 7;
      c.strokeStyle = '#2a0000';
      c.beginPath();
      c.moveTo(fx - 12, cy - 12);
      c.lineTo(fx + 12, cy + 12);
      c.moveTo(fx + 12, cy - 12);
      c.lineTo(fx - 12, cy + 12);
      c.stroke();
      c.lineWidth = 4;
      c.strokeStyle = COLORS.previewInvalid;
      c.stroke();
      c.lineCap = 'butt';
    }
    c.globalAlpha = 1;
  }

  // ─────────────────────────── units ───────────────────────────

  /**
   * Per-entity pose for this frame (written into tmp fields to avoid allocation): foot screen point, lift (px),
   * height/width multipliers, lean (body skew toward the facing side), tilt (stun wobble) and the weapon pose.
   * Motions read as anticipation → action → recovery: melee winds up, swings and settles; ranged kicks back on the shot.
   */
  const pose = { fx: 0, fy: 0, z: 0, hMul: 1, wMul: 1, lean: 0, tilt: 0, swing: 0, recoil: 0 };
  function computePose(e: Entity, m: UnitMemo): void {
    let ox = 0;
    let oy = 0;
    let z = 0;
    let hMul = 1;
    let wMul = 1;
    let lean = 0;
    let tilt = 0;
    let swing = 0;
    let recoil = 0;
    const p = animProgress(e, m);
    const cf = Math.cos(e.facing);
    const sf = Math.sin(e.facing);
    // 기획 13차: a stopped (정지) unit holds still in whatever pose; a pulled one slides in; a hop lifts the body
    const frozen = isStopped(e);
    switch (frozen ? 'idle' : e.anim) {
      case 'attack': {
        if (m.look.ranged) {
          // kick back at the shot, ease forward again
          const back = p < 0.12 ? p / 0.12 : Math.max(0, 1 - (p - 0.12) / 0.6);
          ox = -cf * 0.13 * back;
          oy = -sf * 0.13 * back;
          recoil = 7 * back;
          lean = -0.12 * back;
          hMul = 1 - 0.05 * back;
          wMul = 1 + 0.04 * back;
        } else {
          // wind-up (lean back, weapon raised) → strike (lunge, weapon sweeps through) → recovery
          let L: number;
          if (p < 0.3) {
            const k = p / 0.3;
            L = -0.08 * k;
            lean = -0.16 * k;
            swing = -1.15 * k;
            hMul = 1 - 0.06 * k;
            wMul = 1 + 0.05 * k;
          } else if (p < 0.55) {
            const k = easeOutQ((p - 0.3) / 0.25);
            L = -0.08 + 0.56 * k;
            lean = -0.16 + 0.4 * k;
            swing = -1.15 + 2.45 * k;
            hMul = 1 + 0.05 * k;
            wMul = 1 - 0.03 * k;
          } else {
            const k = (p - 0.55) / 0.45;
            L = 0.48 * (1 - k);
            lean = 0.24 * (1 - k);
            swing = 1.3 * (1 - k);
            hMul = 1 + 0.05 * (1 - k);
          }
          ox = cf * L;
          oy = sf * L;
        }
        break;
      }
      case 'appear': {
        // 기획 8차: a fast drop (accelerating, DASH_LAND s) → touchdown squash → spring back. The hit-stop lands on the
        // touchdown frame (vfx landings), so the frozen picture is the squash with the skill's shockwave around it.
        const t = m.appearAge;
        if (t < DASH_LAND) {
          const k = t / DASH_LAND;
          z = APPEAR_DROP * (1 - k * k);
          hMul = 1.14;
          wMul = 0.88;
        } else {
          const u = Math.min(1, (t - DASH_LAND) / 0.26);
          const q = 1 - u;
          hMul = 1 - 0.26 * q * q + 0.06 * Math.sin(u * Math.PI);
          wMul = 1 + 0.22 * q * q - 0.03 * Math.sin(u * Math.PI);
        }
        break;
      }
      case 'move': {
        const b = Math.abs(Math.sin(time * 10 + m.phase));
        z = b * 0.13;
        // heroes lean into the run; monsters just bounce (no per-unit transform for a crowd)
        if (e.kind === 'character') lean = 0.1;
        // squash on each footfall
        hMul = 1 - 0.07 * (1 - b) * (1 - b);
        wMul = 1 + 0.05 * (1 - b) * (1 - b);
        break;
      }
      case 'cast':
        // charging the skill: grow a little and raise the weapon
        hMul = 1.09 + 0.03 * Math.sin(time * 22);
        wMul = 1.06;
        swing = -0.9;
        z = 0.06;
        break;
      case 'stunned':
        tilt = Math.sin(time * 7 + m.phase) * 0.14;
        hMul = 0.96;
        break;
      default:
        hMul = 1 + 0.025 * Math.sin(time * 2.6 + m.phase);
        z = 0.025 * (1 + Math.sin(time * 2.6 + m.phase));
    }
    // ult: a strong pose for a moment (bigger, weapon high)
    if (m.ultT < 0.75) {
      const k = Math.sin((m.ultT / 0.75) * Math.PI);
      hMul *= 1 + 0.22 * k;
      wMul *= 1 + 0.14 * k;
      swing = -1.5 * k + swing * (1 - k);
      z += 0.25 * k;
    }
    if (vfx.dashPose(e.id, dashOff)) {
      // drag-skill dash: drawn at the replayed streak position; it lands fast at the drop point, then dashes
      ox += dashOff.ox;
      oy += dashOff.oy;
      if (e.anim === 'appear') z = dashOff.z;
      lean = 0.3;
      swing = 1.2;
    }
    if (frozen) {
      hMul = 1;
      wMul = 1;
      z = 0;
    }
    ox += m.pullX;
    oy += m.pullY;
    z += vfx.liftOf(e.id);
    pose.fx = cam.sx(e.pos.x + ox);
    pose.fy = cam.sy(e.pos.y + oy);
    if (m.joltT > 0) {
      // hit reaction: knocked a few px away, squashed, then springs back
      const k = m.joltT / 0.14;
      pose.fx += m.joltX * 6 * k;
      pose.fy += m.joltY * 3 * k;
      hMul *= 1 - 0.07 * k;
      wMul *= 1 + 0.05 * k;
    }
    pose.z = z * PX_PER_UNIT_Z;
    pose.hMul = hMul;
    pose.wMul = wMul;
    pose.lean = lean;
    pose.tilt = tilt;
    pose.swing = swing;
    pose.recoil = recoil;
  }

  function drawUnitGround(e: Entity, m: UnitMemo, local: number, state: GameState): void {
    const c = ctx!;
    let lift = e.anim === 'appear' && m.appearAge < DASH_LAND ? 1 - (m.appearAge / DASH_LAND) ** 2 : 0;
    let gx = e.pos.x + m.pullX;
    let gy = e.pos.y + m.pullY;
    if (vfx.dashPose(e.id, dashOff)) {
      gx += dashOff.ox;
      gy += dashOff.oy;
      lift = Math.min(1, dashOff.z / 1.6);
    }
    lift = Math.max(lift, Math.min(1, vfx.liftOf(e.id) / 1.6));
    if (vfx.hidden(e.id)) return;
    drawShadow(c, cam, gx, gy, e.radius * (m.look.shape === 'hero' ? 0.9 : 1), 1 - lift * 0.6, 1 - lift * 0.5);
    const sx0 = cam.sx(gx);
    const sy0 = cam.sy(gy);
    if (e.tier === 'mid' && e.team === 'enemy') midAura(c, sx0, sy0, e.radius * PX_PER_UNIT, e.radius * PX_PER_UNIT_Y, time, m.phase);
    if (e.kind === 'character' && e.ownerPlayer != null && e.ownerPlayer !== local) {
      // another player's character: a ring in that player's colour (their name tag colour) — two 가디언 on the
      // field no longer look the same; mine has the bright outline + marker instead
      const r = e.radius * 1.25;
      c.globalAlpha = 0.9 * (1 - lift);
      c.lineWidth = 3;
      c.strokeStyle = playerColor(state, e.ownerPlayer);
      c.beginPath();
      c.ellipse(sx0, sy0, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
      c.stroke();
      c.globalAlpha = 1;
    }
    const casting = e.anim === 'cast' || m.skillT < 0.45;
    if (casting || m.ultT < 0.9) {
      // cast circle under the feet: a glow plus a dashed ring spinning in the character colour
      const ult = m.ultT < 0.9;
      const k = ult ? 1 - m.ultT / 0.9 : e.anim === 'cast' ? 1 : 1 - m.skillT / 0.45;
      const r = e.radius * (ult ? 2.3 : 1.7) + (ult ? 0.6 : 0.25) * (1 - k);
      c.globalAlpha = (ult ? 0.4 : 0.3) * k;
      c.fillStyle = m.look.light;
      c.beginPath();
      c.ellipse(sx0, sy0, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
      c.fill();
      c.globalAlpha = 0.95 * k;
      c.lineWidth = ult ? 4 : 3;
      c.strokeStyle = m.look.light;
      c.setLineDash(CAST_DASH);
      c.lineDashOffset = -time * 60;
      c.stroke();
      c.setLineDash(NO_DASH);
      c.lineDashOffset = 0;
      if (ult) {
        c.globalAlpha = 0.7 * k;
        c.lineWidth = 2;
        c.strokeStyle = '#ffffff';
        c.beginPath();
        c.ellipse(sx0, sy0, r * 0.7 * PX_PER_UNIT, r * 0.7 * PX_PER_UNIT_Y, 0, 0, TAU);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    if (e.statuses.length > 0) vfx.status.drawGround(c, cam, e, sx0, sy0, time);
    if (hasStatus(e, 'slow')) {
      // frost on the ground: a pale-blue ring with ice shards (one stroke + one fill)
      const r = e.radius * 1.15;
      c.globalAlpha = 0.85;
      c.lineWidth = 3;
      c.strokeStyle = '#9ad8ff';
      c.beginPath();
      c.ellipse(sx0, sy0, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
      c.stroke();
      c.fillStyle = '#e6f7ff';
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = m.phase + (i * TAU) / 4;
        const px = sx0 + Math.cos(a) * r * PX_PER_UNIT * 0.9;
        const py = sy0 + Math.sin(a) * r * PX_PER_UNIT_Y * 0.9;
        c.moveTo(px, py - 8);
        c.lineTo(px + 3.5, py);
        c.lineTo(px, py + 2);
        c.lineTo(px - 3.5, py);
        c.closePath();
      }
      c.fill();
      c.globalAlpha = 1;
    }
  }

  function drawUnitBody(e: Entity, m: UnitMemo): void {
    const c = ctx!;
    if (vfx.hidden(e.id)) return;
    computePose(e, m);
    const look = m.look;
    const w = bodyWidth(e.radius) * pose.wMul;
    const h = (w / pose.wMul) * look.heightMul * pose.hMul;
    const s = Math.cos(e.facing) >= 0 ? 1 : -1;
    const fx = pose.fx;
    const fy = pose.fy - pose.z;
    let alpha = 1;
    if (e.expiresIn !== null && e.expiresIn < 2 && e.kind === 'summon') alpha = Math.sin(time * 20) > 0 ? 1 : 0.45;
    if (e.anim === 'cast' || m.ultT < 0.6) {
      const k = 0.5 + 0.5 * Math.sin(time * 14);
      const ult = m.ultT < 0.6;
      c.globalAlpha = (ult ? 0.45 : 0.25) + 0.2 * k;
      c.fillStyle = look.light;
      c.beginPath();
      c.ellipse(fx, fy - h * 0.5, w * (ult ? 1.05 : 0.8), h * (ult ? 0.85 : 0.68), 0, 0, TAU);
      c.fill();
    }
    const skew = pose.lean * s;
    const transformed = skew !== 0 || pose.tilt !== 0;
    if (transformed) {
      c.save();
      c.translate(fx, fy);
      if (pose.tilt !== 0) c.rotate(pose.tilt);
      if (skew !== 0) c.transform(1, 0, -skew, 1, 0, 0);
      c.translate(-fx, -fy);
    }
    c.globalAlpha = alpha;
    HERO_POSE.swing = pose.swing;
    HERO_POSE.recoil = pose.recoil;
    if (e.kind !== 'character') {
      // 괴담 bodies open mouths / raise arms through their attack or cast, and roll / hop while moving
      CREATURE_POSE.act = e.anim === 'attack' || e.anim === 'cast' ? Math.sin(animProgress(e, m) * Math.PI) : 0;
      CREATURE_POSE.moving = e.anim === 'move';
      CREATURE_POSE.skill = lastMonsterSkill.get(e.id) ?? '';
    }
    const frozen = e.statuses.length > 0 && isStopped(e);
    // 기획 15차 원정: worn gear shows on the body (absent in the classic tower → drawn exactly as before)
    const gear = e.kind === 'character' && e.ownerPlayer != null && e.partyIndex != null ? gearBandsOf(vc.state?.players[e.ownerPlayer]?.gear?.[e.partyIndex]) : null;
    const gearFx = e.ownerPlayer === vc.localPlayer ? 1 : OTHER_PLAYER_FX;
    drawBody(c, look, e.tier, fx, fy, w, h, s, frozen ? m.phase : time, m.phase, m.flash > 0 && !frozen, gear, gearFx);
    if (e.statuses.length > 0) vfx.status.drawBodyOverlay(c, e, fx, fy, w, h);
    HERO_POSE.swing = 0;
    HERO_POSE.recoil = 0;
    CREATURE_POSE.act = 0;
    CREATURE_POSE.moving = false;
    CREATURE_POSE.skill = '';
    if (e.kind === 'character' && hasStatus(e, 'slow')) {
      c.globalAlpha = 0.22;
      pathCapsule(c, fx, fy, w * 0.95, h);
      c.fillStyle = '#7fd4ff';
      c.fill();
    }
    if (hasStatus(e, 'burn')) drawFlames(c, fx, fy, w, h, time + m.phase);
    if (transformed) c.restore();
    if (e.invulnTime > 0 && e.anim !== 'appear') {
      c.globalAlpha = 0.5 + 0.4 * Math.sin(time * 25);
      pathCapsule(c, fx, fy + 3, w + 8, h + 8);
      c.lineWidth = 2;
      c.strokeStyle = '#ffffff';
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /** Name tags placed this frame (overlap avoidance). */
  const tagBoxes: TagBox[] = [];

  function drawUnitOverhead(e: Entity, m: UnitMemo, local: number, state: GameState): void {
    if (e.eventTag === 'ward') return; // 기획 12차: the patient / child get their own markers (render/fieldEvents.ts)
    const c = ctx!;
    computePose(e, m);
    const look = m.look;
    const w = bodyWidth(e.radius);
    const h = w * look.heightMul * Math.min(1.12, pose.hMul);
    const top = pose.fy - pose.z - bodyTop(look, e.tier, h, w);
    const isLocal = e.kind === 'character' && e.ownerPlayer === local;
    const ally = e.team === 'ally';
    const showBar = e.kind !== 'monster' || e.tier === 'mid' || e.hp < e.maxHp || e.shield > 0;
    if (e.kind === 'character' && e.ownerPlayer != null && overheadUnderPanel(state, e, top, isLocal, showBar)) {
      drawOverheadBelow(e, m, local, state, isLocal, w);
      return;
    }
    let y = top - 8;
    if (showBar) {
      const style = barStyleFor(e, isLocal, w);
      y -= style.height;
      drawHpBar(c, pose.fx, y, style, e.hp, e.maxHp, e.shield, m.hpLag, ally, isLocal ? playerColor(state, local) : null);
      y -= 3;
    }
    if (e.statuses.length > 0) y -= drawStatusPips(c, pose.fx, y, e.statuses);
    // 기획 13차: up to two status icons over an enemy (도발 · 족쇄 · 정지 · 조종 · 낙인 …)
    if (e.statuses.length > 0 && e.team === 'enemy') y -= vfx.status.drawHead(c, e, pose.fx, y - 4, time);
    const stunned = e.anim === 'stunned' || hasStatus(e, 'stun');
    if (stunned) drawStunStars(c, pose.fx, top + 2, w, time + m.phase);
    // 기획 5차: who is who — name tag over every player character ("나" = mine)
    if (e.kind === 'character' && e.ownerPlayer != null) {
      const owner = state.players[e.ownerPlayer];
      if (owner) y -= drawNameTag(c, pose.fx, y - 1, isLocal ? '나' : owner.name, playerColor(state, e.ownerPlayer), isLocal, tagBoxes);
    }
    if (isLocal) {
      // ▼ sits above my tag and must not cover another player's tag stacked there (marker ≈ 26 wide, 19 tall + bob)
      let my = y - 2;
      for (let guard = 0; guard < 4; guard++) {
        const hit = tagBoxes.find(b => pose.fx - 14 < b.x1 && pose.fx + 14 > b.x0 && my - 22 < b.y1 && my + 3 > b.y0);
        if (!hit) break;
        my = hit.y0 - 2;
      }
      drawLocalMarker(c, pose.fx, my, playerColor(state, local), time);
    }
  }

  /**
   * 기획 8차 리뷰: a player character right under the top-centre HUD box (boss HP panel / floor info) would have its
   * tag + HP bar drawn under that box (my "나" was hidden 22–44 % of the time while fighting at the boss's feet).
   * True when the overhead stack (bar, pips, tag, my ▼) would reach into the box.
   */
  function overheadUnderPanel(state: GameState, e: Entity, top: number, isLocal: boolean, showBar: boolean): boolean {
    const panel = state.plan.kind === 'boss' ? TOP_PANEL_BOSS : TOP_PANEL_NORMAL;
    if (pose.fx + 30 < panel.x0 || pose.fx - 30 > panel.x1) return false;
    const stack = 8 + (showBar ? 12 : 0) + (e.statuses.length > 0 ? 9 : 0) + (isLocal ? 21 + 24 : 18);
    return top - stack < panel.y1;
  }

  /** The overhead stack mirrored under the feet: HP bar, status pips, then the name tag (stacking downward). */
  function drawOverheadBelow(e: Entity, m: UnitMemo, local: number, state: GameState, isLocal: boolean, w: number): void {
    const c = ctx!;
    let y = pose.fy + 9;
    const style = barStyleFor(e, isLocal, w);
    drawHpBar(c, pose.fx, y, style, e.hp, e.maxHp, e.shield, m.hpLag, true, isLocal ? playerColor(state, local) : null);
    y += style.height + 3;
    if (e.statuses.length > 0) y += drawStatusPips(c, pose.fx, y + 7, e.statuses);
    const stunned = e.anim === 'stunned' || hasStatus(e, 'stun');
    if (stunned) {
      const top = pose.fy - pose.z - bodyTop(m.look, e.tier, w * m.look.heightMul, w);
      drawStunStars(c, pose.fx, top + 2, w, time + m.phase);
    }
    const owner = state.players[e.ownerPlayer!];
    if (!owner) return;
    const th = isLocal ? 19 : 16;
    drawNameTag(c, pose.fx, y + th, isLocal ? '나' : owner.name, playerColor(state, e.ownerPlayer!), isLocal, tagBoxes, true);
  }

  function drawLocalOutline(e: Entity, m: UnitMemo, color: string): void {
    const c = ctx!;
    computePose(e, m);
    const w = bodyWidth(e.radius) * pose.wMul;
    const h = bodyWidth(e.radius) * m.look.heightMul * pose.hMul;
    const fy = pose.fy - pose.z;
    const skew = pose.lean * (Math.cos(e.facing) >= 0 ? 1 : -1);
    if (skew !== 0) {
      c.save();
      c.translate(pose.fx, fy);
      c.transform(1, 0, -skew, 1, 0, 0);
      c.translate(-pose.fx, -fy);
    }
    pathCapsule(c, pose.fx, fy + 2, w + 7, h + 6);
    c.globalAlpha = 0.95;
    c.lineWidth = 4.5;
    c.strokeStyle = '#05060a';
    c.stroke();
    c.lineWidth = 2.5;
    c.strokeStyle = color;
    c.stroke();
    if (skew !== 0) c.restore();
    c.globalAlpha = 1;
  }

  /** Edge arrows + count for living enemies left/right of the view (the normal arena is 1.5 screens wide). */
  function drawOffscreenEnemies(state: GameState): void {
    if (cam.arenaWidth <= VIEW_WIDTH_UNITS + 1e-6) return;
    const half = VIEW_WIDTH_UNITS / 2;
    const side = offSide;
    side.ln = side.rn = 0;
    side.ly = side.ry = 0;
    side.lmid = side.rmid = false;
    for (const e of state.entities) {
      // 기획 12차: 돌발 괴담 targets get their own gold arrows (render/fieldEvents.ts), not the red ones
      if (e.team !== 'enemy' || e.hp <= 0 || e.tier === 'boss' || e.eventTag === 'target') continue;
      const dx = e.pos.x - cam.x;
      // counted as off-screen once its body is fully past the edge
      if (dx < -half - e.radius * 0.5) {
        side.ln++;
        side.ly += e.pos.y;
        if (e.tier === 'mid') side.lmid = true;
      } else if (dx > half + e.radius * 0.5) {
        side.rn++;
        side.ry += e.pos.y;
        if (e.tier === 'mid') side.rmid = true;
      }
    }
    if (side.ln > 0) drawEdgeArrow(-1, side.ln, side.ly / side.ln, side.lmid);
    if (side.rn > 0) drawEdgeArrow(1, side.rn, side.ry / side.rn, side.rmid);
  }

  function drawEdgeArrow(dir: -1 | 1, n: number, wy: number, mid: boolean): void {
    const c = ctx!;
    // keep clear of the top HUD row and the bottom card rows
    const y = Math.max(250, Math.min(470, cam.sy(wy)));
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    const tip = dir < 0 ? 10 : LOGICAL_W - 10;
    const back = tip - dir * 30;
    const color = mid ? '#ff4d6d' : '#ff8a5c';
    c.globalAlpha = 0.85 + 0.15 * pulse;
    c.beginPath();
    c.moveTo(tip, y);
    c.lineTo(back, y - 22);
    c.lineTo(back, y + 22);
    c.closePath();
    c.lineJoin = 'round';
    c.lineWidth = 5;
    c.strokeStyle = '#05060a';
    c.stroke();
    c.fillStyle = color;
    c.fill();
    // count badge next to the arrow
    const bx = back - dir * 6;
    const label = mid ? `${n}!` : String(n);
    c.font = boldFont(22);
    c.textAlign = dir < 0 ? 'left' : 'right';
    c.textBaseline = 'middle';
    c.lineWidth = 5;
    c.strokeStyle = '#05060a';
    c.strokeText(label, bx, y + 1);
    c.fillStyle = '#ffffff';
    c.fillText(label, bx, y + 1);
    c.globalAlpha = 1;
  }

  /** Projectiles, styled per shooter: arrows (ranger), tracers (gunner), fireballs (mage), holy orbs (cleric), notes (bard), clock shards (chrono). */
  function drawProjectiles(state: GameState): void {
    const c = ctx!;
    const zp = PROJECTILE_Z * PX_PER_UNIT_Z;
    for (const p of state.projectiles) {
      if (!cam.visibleX(p.pos.x, 1)) continue;
      let tx = p.targetPos.x;
      let ty = p.targetPos.y;
      if (p.targetId !== null) {
        const m = memos.get(p.targetId);
        if (m) {
          tx = m.x;
          ty = m.y;
        }
      }
      let dx = tx - p.pos.x;
      let dy = ty - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-4) {
        dx /= d;
        dy /= d;
      } else {
        dx = 1;
        dy = 0;
      }
      const hx = cam.sx(p.pos.x);
      const hy = cam.sy(p.pos.y) - zp;
      // ground shadow
      c.globalAlpha = 0.25;
      c.fillStyle = '#000000';
      c.beginPath();
      c.ellipse(hx, cam.sy(p.pos.y), 5, 2.5, 0, 0, TAU);
      c.fill();
      const style = p.team === 'ally' ? PROJ_STYLE.get(p.color.toLowerCase()) : undefined;
      const ang = Math.atan2(dy * PX_PER_UNIT_Y, dx * PX_PER_UNIT);
      if (style) {
        drawStyledProjectile(c, style, p.color, hx, hy, ang, time + p.id * 0.37);
        if (style === 'mage' && Math.random() < 0.6) vfx.burst(p.pos.x - dx * 0.2, p.pos.y - dy * 0.2, PROJECTILE_Z, 1, Math.random() < 0.5 ? '#ff9e3d' : '#ffd166', 0.4, 0.6, 0.3, -1);
        continue;
      }
      const trail = Math.min(1.2, 0.25 + p.speed * 0.05);
      const tx1 = cam.sx(p.pos.x - dx * trail);
      const ty1 = cam.sy(p.pos.y - dy * trail) - zp;
      const tx2 = cam.sx(p.pos.x - dx * trail * 0.5);
      const ty2 = cam.sy(p.pos.y - dy * trail * 0.5) - zp;
      c.lineCap = 'round';
      c.globalAlpha = 0.25;
      c.strokeStyle = p.color;
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(tx1, ty1);
      c.lineTo(hx, hy);
      c.stroke();
      c.globalAlpha = 0.7;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(tx2, ty2);
      c.lineTo(hx, hy);
      c.stroke();
      c.lineCap = 'butt';
      c.globalAlpha = 1;
      const enemy = p.team === 'enemy';
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(hx, hy, enemy ? 6 : 5, 0, TAU);
      c.fill();
      if (enemy) {
        c.lineWidth = 2.5;
        c.strokeStyle = '#ff2a2a';
        c.stroke();
      }
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(hx, hy, 2, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawBosses(state: GameState, bossShadowOnly: boolean): void {
    const c = ctx!;
    const retreat = vfx.bossRetreatT >= 0 ? Math.min(1, vfx.bossRetreatT / 2) : 0;
    const shake = vfx.enrageT < 1 ? 1 - vfx.enrageT : 0;
    if (bosses.length === 0) {
      if (hasLastBoss && retreat > 0 && retreat < 1) {
        if (bossShadowOnly) drawBossShadow(c, cam, lastBoss.x, lastBoss.radius, retreat);
        else {
          const o = bossOpts;
          o.color = lastBoss.color;
          o.time = time;
          o.enraged = state.bossEnraged;
          o.flash = 0;
          o.retreat = retreat;
          o.lookX = null;
          o.lookY = null;
          o.charge = 0;
          o.shake = 0;
          o.phase = lastBoss.phase;
          o.phaseFlash = 0;
          o.groggy = 0;
          o.groggyWake = 0;
          o.groggyNear = 0;
          drawBossArt(c, cam, lastBoss.defId, lastBoss.x, lastBoss.y, lastBoss.radius, o);
        }
      }
      return;
    }
    for (const e of bosses) {
      const m = memos.get(e.id);
      if (!m) continue;
      if (bossShadowOnly) {
        drawBossShadow(c, cam, e.pos.x, e.radius, retreat);
        continue;
      }
      const tgt = e.targetId !== null ? memos.get(e.targetId) : undefined;
      const charge = e.anim === 'cast' || e.anim === 'attack' ? Math.sin(animProgress(e, m) * Math.PI) : 0;
      const o = bossOpts;
      o.color = m.look.color;
      o.time = time;
      o.enraged = e.enraged || state.bossEnraged;
      o.flash = vfx.bossFlash;
      o.retreat = retreat;
      o.lookX = tgt ? tgt.x : null;
      o.lookY = tgt ? tgt.y : null;
      o.charge = charge;
      o.shake = shake;
      o.phase = bossPhaseOf(e.defId, e.hp, e.maxHp);
      o.phaseFlash = vfx.phaseFlash;
      const gp = groggyFx.pose(state);
      o.groggy = gp.groggy;
      o.groggyWake = gp.groggyWake;
      o.groggyNear = gp.groggyNear;
      drawBossArt(c, cam, e.defId, e.pos.x, e.pos.y, e.radius, o);
      lastBoss.x = e.pos.x;
      lastBoss.y = e.pos.y;
      lastBoss.radius = e.radius;
      lastBoss.color = m.look.color;
      lastBoss.defId = e.defId;
      lastBoss.phase = o.phase;
      hasLastBoss = true;
    }
  }

  // ─────────────────────────── frame ───────────────────────────

  function render(state: GameState, events: GameEvent[], realDt: number, ui: RenderUiState): void {
    const c = ctx!;
    const realStep = Math.max(0, Math.min(MAX_DT, Number.isFinite(realDt) ? realDt : 0));
    // 기획 8차 hit-stop: while frozen the world clock stands still (render only — the sim and the DOM HUD keep going);
    // a drag in progress always sees the live field
    const juice = vfx.juice;
    juice.update(realStep);
    vfx.updateReal(realStep);
    if (ui.dragPreview) juice.cancelFreeze();
    const dt = juice.frozen && freezeOk ? 0 : realStep;
    time += dt;
    stamp++;
    ensureBackingStore(realStep);

    // A new run (다시 하기 / 프리셋 → 출발) reuses entity ids from 1: drop every memo and effect of the old run.
    if (state.seed !== runSeed || state.tick < lastTick) {
      if (runSeed !== null) {
        memos.clear();
        vfx.reset();
        fieldFx.reset();
        groggyFx.reset();
        teleSeq.reset();
        lastMonsterSkill.clear();
        arenaFloor = -1;
      }
      runSeed = state.seed;
    }
    lastTick = state.tick;

    const arena = state.plan.arena;
    const boss = state.plan.kind === 'boss';
    if (state.floor !== arenaFloor || boss !== arenaBoss || arena.width !== arenaW || arena.height !== arenaH) {
      if (arenaFloor !== -1) {
        vfx.reset();
        fieldFx.reset();
        groggyFx.reset();
        teleSeq.reset();
      }
      arenaFloor = state.floor;
      arenaBoss = boss;
      arenaW = arena.width;
      arenaH = arena.height;
      cam.setArena(arena.width, arena.height);
      snapPending = true;
      hasLastBoss = false;
    }
    backdrop.ensure(arena.width, arena.height, boss, state.floor, dpr, state.plan.theme, state.plan.bossId);

    // events first: death/leave ghosts need last frame's memos. Units that appeared this frame get theirs now, so a
    // drag skill cast by a character that just landed can follow it (callout, cast pose).
    for (const e of state.entities) if (!memos.has(e.id)) memos.set(e.id, newMemo(e, stamp));
    vc.state = state;
    vc.localPlayer = ui.localPlayer;
    vc.camX = cam.x;
    vfx.status.frame(state);
    for (const ev of events) {
      vfx.handle(ev, vc);
      fieldFx.handle(ev, state);
      groggyFx.handle(ev, state, ui.localPlayer, vfx);
      teleSeq.noteEvent(ev);
      if (ev.type === 'skillCast' && ev.slot === 'monster' && ev.sourceId != null) lastMonsterSkill.set(ev.sourceId, ev.skillId);
      else if (ev.type === 'death') lastMonsterSkill.delete(ev.entityId);
      if (ev.type === 'floorStart') {
        snapPending = true;
        hasLastBoss = false;
      }
    }

    // memos
    bosses.length = 0;
    sorted.length = 0;
    for (const e of state.entities) {
      let m = memos.get(e.id);
      if (!m) {
        m = newMemo(e, stamp);
        memos.set(e.id, m);
      } else {
        syncMemo(m, e, stamp, dt);
      }
    }
    memos.forEach(pruneMemo);

    if (juice.frozen && freezeOk && freezeCanvas) {
      drawFrozen(state);
      return;
    }
    freezeOk = false;

    vfx.trackTelegraphs(state.telegraphs);
    teleSeq.track(state.telegraphs);
    vfx.update(dt, vc);
    fieldFx.update(dt);
    groggyFx.update(dt, state);

    // camera
    const target = localTargetX(state, ui.localPlayer);
    if (snapPending) {
      cam.snap(target ?? (cam.arenaWidth > 0 ? cam.x : null));
      snapPending = false;
    } else if (!ui.freezeCamera) {
      cam.follow(target, dt);
    }
    for (const e of state.entities) {
      if (e.tier === 'boss') bosses.push(e);
      else if (cam.visibleX(e.pos.x, 2.5)) sorted.push(e);
    }
    sorted.sort(byY);

    // ── draw ──
    c.globalAlpha = 1;
    c.lineJoin = 'round';
    // camera shake: the world layer moves, the screen overlays below do not. A freeze that starts this frame captures
    // this frame unshaken (the frozen frames then shake it).
    const startsFreeze = juice.frozen && !ui.dragPreview;
    const sh = startsFreeze ? ZERO_OFF : juice.offset(shakeOff);
    if (sh.x !== 0 || sh.y !== 0) {
      c.fillStyle = '#05060a';
      c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      c.translate(sh.x, sh.y);
    }
    backdrop.draw(c, cam, time, ui.dragPreview !== null);
    drawBosses(state, true);
    c.save();
    c.beginPath();
    c.rect(cam.sx(0) - 2, cam.sy(0) - 2, arena.width * PX_PER_UNIT + 4, arena.height * PX_PER_UNIT_Y + 4);
    c.clip();
    drawZones(state);
    drawTelegraphs(state, 'ally');
    vfx.drawGround(c, cam, time);
    fieldFx.drawGround(c, cam, state, time);
    c.restore();
    if (ui.dragPreview) drawPreviewGround(ui.dragPreview, state);
    for (const e of sorted) drawUnitGround(e, memos.get(e.id)!, ui.localPlayer, state);
    drawBosses(state, false);
    if (state.telegraphs.length > 0) {
      c.save();
      c.beginPath();
      c.rect(cam.sx(0) - 2, cam.sy(0) - 2, arena.width * PX_PER_UNIT + 4, arena.height * PX_PER_UNIT_Y + 4);
      c.clip();
      drawTelegraphs(state, 'enemy');
      c.restore();
    }
    vfx.drawGhosts(c, cam, time);
    // my character is drawn last (on top of a pile) with a bright outline, so it never gets lost in a crowd
    let mine: Entity | null = null;
    for (const e of sorted) {
      if (e.kind === 'character' && e.ownerPlayer === ui.localPlayer) mine = e;
      else drawUnitBody(e, memos.get(e.id)!);
    }
    if (mine) {
      drawUnitBody(mine, memos.get(mine.id)!);
      drawLocalOutline(mine, memos.get(mine.id)!, playerColor(state, ui.localPlayer));
    }
    drawProjectiles(state);
    vfx.drawAir(c, cam, time);
    if (vfx.screen.worldActive()) drawWorldScreen(state, sorted);
    tagBoxes.length = 0;
    for (const e of sorted) if (e !== mine) drawUnitOverhead(e, memos.get(e.id)!, ui.localPlayer, state);
    if (mine) drawUnitOverhead(mine, memos.get(mine.id)!, ui.localPlayer, state);
    fieldFx.drawOverlay(c, cam, state, time);
    if (ui.dragPreview) drawPreviewGhost(ui.dragPreview, state);
    if (ui.dragPreview) drawFieldEventPreview(c, cam, state, ui.dragPreview, ui.localPlayer, time);
    vfx.drawOverlay(c, cam);
    groggyFx.drawStamp(c, cam, state);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (startsFreeze) {
      // hold this picture for the hit-stop (no DOM → no freeze: tests, workers)
      freezeOk = captureFreeze();
      if (!freezeOk) juice.cancelFreeze();
    }
    drawOffscreenEnemies(state);
    fieldFx.drawScreen(c, cam, state, time);
    const cut = vfx.screen.cutin;
    if (cut.needsPlacement()) cut.place(bandAvoid(state));
    vfx.drawScreen(c, cam, time);
    // 기획 13차 리뷰: the band never hides an enemy warning (2-3 "예고선은 밝게")
    if (cut.active && !cut.short) drawEnemyDanger(state);
    c.globalAlpha = 1;
  }

  /** Enemy telegraphs again, over a screen-wide layer (cut-in dim / band, spotlight): danger stays readable. */
  function drawEnemyDanger(state: GameState): void {
    if (!state.telegraphs.some(t => t.team === 'enemy')) return;
    const c = ctx!;
    const arena = state.plan.arena;
    c.save();
    c.beginPath();
    c.rect(cam.sx(0) - 2, cam.sy(0) - 2, arena.width * PX_PER_UNIT + 4, arena.height * PX_PER_UNIT_Y + 4);
    c.clip();
    drawTelegraphs(state, 'enemy');
    c.restore();
  }

  /** Screen spans the cut-in band should leave clear: my caster (most), then every enemy warning. */
  function bandAvoid(state: GameState): BandAvoid[] {
    const out: BandAvoid[] = [];
    if (entityPos(vfx.screen.cutin.casterId, BAND_TMP)) {
      const y = cam.sy(BAND_TMP.y);
      out.push({ top: y - 130, bottom: y + 20, weight: 3 });
    }
    for (const t of state.telegraphs) {
      if (t.team !== 'enemy') continue;
      const y = cam.sy(t.center.y);
      const r = Math.min(areaExtent(t.area), 6) * PX_PER_UNIT_Y;
      out.push({ top: y - r, bottom: y + r, weight: 1 });
    }
    return out;
  }

  /**
   * 기획 13차 컷인: the world dims / drains (HUD is DOM, numbers come after), then the caster is drawn again on top so
   * it stays bright; the puppeteer's spotlight goes here too.
   */
  function drawWorldScreen(state: GameState, units: readonly Entity[]): void {
    const c = ctx!;
    vfx.screen.drawWorld(c, cam, entityPos);
    drawEnemyDanger(state); // the dim / spotlight never darkens a warning
    const id = vfx.screen.cutin.casterId;
    if (id < 0 || vfx.screen.cutin.dim() <= 0) return;
    for (const e of units) {
      if (e.id !== id) continue;
      const m = memos.get(e.id);
      if (!m) break;
      drawUnitBody(e, m);
      if (e.ownerPlayer === vc.localPlayer) drawLocalOutline(e, m, playerColor(state, vc.localPlayer));
      break;
    }
  }

  const BAND_TMP = { x: 0, y: 0 };

  function entityPos(id: number, out: { x: number; y: number }): boolean {
    const m = memos.get(id);
    if (!m) return false;
    out.x = m.x;
    out.y = m.y;
    return true;
  }

  /** Copy of the world layer of the frame where a hit-stop began (backing-store pixels). */
  let freezeCanvas: HTMLCanvasElement | null = null;
  let freezeOk = false;
  function captureFreeze(): boolean {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
    try {
      if (!freezeCanvas) freezeCanvas = document.createElement('canvas');
      if (freezeCanvas.width !== canvas.width) freezeCanvas.width = canvas.width;
      if (freezeCanvas.height !== canvas.height) freezeCanvas.height = canvas.height;
      const g = freezeCanvas.getContext('2d');
      if (!g) return false;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(canvas, 0, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** A hit-stop frame: the held world picture, shaken, under live screen overlays (offscreen arrows, enrage tint). */
  function drawFrozen(state: GameState): void {
    const c = ctx!;
    const fc = freezeCanvas!;
    if (fc.width !== canvas.width || fc.height !== canvas.height) {
      vfx.juice.cancelFreeze();
      freezeOk = false;
      return;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    const o = vfx.juice.offset(shakeOff);
    if (o.x !== 0 || o.y !== 0) {
      c.fillStyle = '#05060a';
      c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    c.drawImage(fc, 0, 0, fc.width, fc.height, o.x, o.y, LOGICAL_W, LOGICAL_H);
    drawOffscreenEnemies(state);
    fieldFx.drawScreen(c, cam, state, time);
    vfx.drawScreen(c, cam, time);
    c.globalAlpha = 1;
  }

  return {
    render,
    screenToWorld(p: Vec2): Vec2 {
      return cam.toWorld(p, { x: 0, y: 0 });
    },
    worldToScreen(v: Vec2): Vec2 {
      return cam.toScreen(v, { x: 0, y: 0 });
    },
    cutInLog() {
      return vfx.screen.cutin.shown;
    },
  };

  function previewColor(dp: DragPreview): string {
    return dp.valid ? dp.color || COLORS.previewValid : COLORS.previewInvalid;
  }
}

const BIG_CIRCLE: AreaShape = { shape: 'circle', radius: 30 };
const shakeOff = { x: 0, y: 0 };
const ZERO_OFF = { x: 0, y: 0 } as const;
const dashOff = { ox: 0, oy: 0, z: 0 };
const offSide = { ln: 0, rn: 0, ly: 0, ry: 0, lmid: false, rmid: false };
const CAST_DASH = [10, 7];

function hasStatus(e: Entity, id: Entity['statuses'][number]['id']): boolean {
  const st = e.statuses;
  for (let i = 0; i < st.length; i++) if (st[i].id === id) return true;
  return false;
}

function easeOutQ(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - (1 - k) * (1 - k);
}

/** Ally projectile look by the shooter's character colour (projectiles carry only a colour). */
type ProjStyle = 'ranger' | 'gunner' | 'mage' | 'cleric' | 'bard' | 'chrono' | 'medic' | 'exorcist' | 'puppeteer';
const PROJ_STYLED: readonly string[] = ['ranger', 'gunner', 'mage', 'cleric', 'bard', 'chrono', 'medic', 'exorcist', 'puppeteer'];
const PROJ_STYLE = new Map<string, ProjStyle>();
for (const ch of CHARACTERS) {
  if (PROJ_STYLED.includes(ch.id)) PROJ_STYLE.set(ch.color.toLowerCase(), ch.id as ProjStyle);
}

function drawStyledProjectile(c: CanvasRenderingContext2D, style: ProjStyle, color: string, x: number, y: number, ang: number, t: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.lineCap = 'round';
  switch (style) {
    case 'ranger': {
      c.globalAlpha = 0.35;
      c.strokeStyle = color;
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(-46, 0);
      c.lineTo(-14, 0);
      c.stroke();
      c.globalAlpha = 1;
      c.strokeStyle = '#6b4a2b';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(-20, 0);
      c.lineTo(0, 0);
      c.stroke();
      c.fillStyle = '#eef3f8';
      c.beginPath();
      c.moveTo(6, 0);
      c.lineTo(-4, -4.5);
      c.lineTo(-4, 4.5);
      c.closePath();
      c.fill();
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(-20, 0);
      c.lineTo(-25, -4.5);
      c.lineTo(-16, 0);
      c.lineTo(-25, 4.5);
      c.closePath();
      c.fill();
      break;
    }
    case 'gunner': {
      c.globalAlpha = 0.45;
      c.strokeStyle = '#ff9e3d';
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(-34, 0);
      c.lineTo(0, 0);
      c.stroke();
      c.globalAlpha = 1;
      c.strokeStyle = '#fff3b0';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(-22, 0);
      c.lineTo(2, 0);
      c.stroke();
      break;
    }
    case 'mage': {
      const fl = 1 + 0.12 * Math.sin(t * 40);
      c.globalAlpha = 0.35;
      c.fillStyle = '#ff7b00';
      c.beginPath();
      c.ellipse(-8, 0, 16 * fl, 8 * fl, 0, 0, TAU);
      c.fill();
      c.globalAlpha = 0.85;
      c.fillStyle = '#ff9e3d';
      c.beginPath();
      c.arc(0, 0, 8 * fl, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = '#fff3b0';
      c.beginPath();
      c.arc(1, 0, 4, 0, TAU);
      c.fill();
      break;
    }
    case 'cleric': {
      c.rotate(-ang);
      c.globalAlpha = 0.4;
      c.fillStyle = '#ffd166';
      c.beginPath();
      c.arc(0, 0, 10, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(0, 0, 4.5, 0, TAU);
      c.fill();
      c.strokeStyle = '#fff3b0';
      c.lineWidth = 2;
      const r = 11 + Math.sin(t * 18) * 2;
      c.beginPath();
      c.moveTo(-r, 0);
      c.lineTo(r, 0);
      c.moveTo(0, -r);
      c.lineTo(0, r);
      c.stroke();
      break;
    }
    case 'bard': {
      c.rotate(-ang);
      const bob = Math.sin(t * 16) * 3;
      c.translate(0, bob);
      c.lineWidth = 5;
      c.strokeStyle = '#2a0a33';
      c.fillStyle = color;
      // eighth note
      c.beginPath();
      c.ellipse(-3, 4, 5.5, 4, -0.4, 0, TAU);
      c.stroke();
      c.fill();
      c.beginPath();
      c.moveTo(2, 4);
      c.lineTo(2, -12);
      c.quadraticCurveTo(10, -8, 8, -2);
      c.lineWidth = 5;
      c.stroke();
      c.lineWidth = 2.5;
      c.strokeStyle = '#ffd6ff';
      c.stroke();
      break;
    }
    case 'chrono': {
      c.rotate(t * 9);
      c.fillStyle = lighten(color, 0.4);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(9, 0);
      c.lineTo(0, -5);
      c.lineTo(-9, 0);
      c.lineTo(0, 5);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    }
    // 기획 12차
    case 'medic': {
      // syringe dart: white capsule, teal tip
      c.globalAlpha = 0.3;
      c.strokeStyle = color;
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(-26, 0);
      c.lineTo(-8, 0);
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = '#f4fbff';
      c.strokeStyle = '#0b3d3a';
      c.lineWidth = 1.2;
      c.beginPath();
      c.roundRect(-9, -3, 13, 6, 3);
      c.fill();
      c.stroke();
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(4, -2.5);
      c.lineTo(10, 0);
      c.lineTo(4, 2.5);
      c.closePath();
      c.fill();
      break;
    }
    case 'exorcist': {
      // spinning yellow talisman with a red stroke
      c.rotate(t * 11);
      c.fillStyle = '#ffd23f';
      c.strokeStyle = '#c1121f';
      c.lineWidth = 1.5;
      c.beginPath();
      c.rect(-4, -7, 8, 14);
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(0, -4);
      c.lineTo(0, 4);
      c.moveTo(-2, -1);
      c.lineTo(2, 1);
      c.stroke();
      break;
    }
    case 'puppeteer': {
      // needle trailing a pink thread
      c.globalAlpha = 0.85;
      c.strokeStyle = color;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(-34, Math.sin(t * 14) * 3);
      c.quadraticCurveTo(-18, -Math.sin(t * 14) * 4, -6, 0);
      c.stroke();
      c.globalAlpha = 1;
      c.strokeStyle = '#e9ecef';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-7, 0);
      c.lineTo(8, 0);
      c.stroke();
      break;
    }
  }
  c.restore();
}

/** Small flickering flames on a burning body (one path, one fill). */
function drawFlames(c: CanvasRenderingContext2D, fx: number, fy: number, w: number, h: number, t: number): void {
  c.globalAlpha = 0.85;
  c.fillStyle = '#ff7a1a';
  c.beginPath();
  for (let i = 0; i < 3; i++) {
    const ph = (t * 2.5 + i / 3) % 1;
    const x = fx + (i - 1) * w * 0.3 + Math.sin(t * 11 + i) * 2;
    const y = fy - h * (0.15 + 0.55 * ph);
    const s = 7 * (1 - ph) + 1;
    c.moveTo(x - s * 0.6, y);
    c.quadraticCurveTo(x, y - s * 2.2, x + s * 0.6, y);
    c.closePath();
  }
  c.fill();
  c.globalAlpha = 1;
}
