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
  type Vec2,
} from '../types';
import { type BossDrawOpts, bossPhaseOf, drawBossArt, drawBossShadow } from './boss';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z, VIEW_WIDTH_UNITS } from './camera';
import { Backdrop } from './ground';
import { COLORS, OTHER_ZONE_ALPHA, boldFont, lighten } from './look';
import { CHARACTERS } from '../data';
import { areaCentroid } from '../sim/geometry';
import { drawAimedDirection, drawAreaDirection, drawPreviewBadges, drawPreviewFootprint, previewDashEnd } from './preview';
import { TAU, areaReach, pathArea, pathCapsule } from './shapes';
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
import { DASH_LAND } from './dashtime';
import { CREATURE_POSE, midAura } from './creatures';

export { Camera } from './camera';

const MAX_DT = 0.1;
/** Drop-in height (world units) of a character appearing (swap / floor start). */
const APPEAR_DROP = 3;
const PROJECTILE_Z = 0.75;
const ZONE_DASH = [8, 6];
const NO_DASH: number[] = [];
const byY = (a: Entity, b: Entity) => a.pos.y - b.pos.y || a.id - b.id;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다');
  const cam = new Camera();
  const backdrop = new Backdrop();
  const vfx = new Vfx();
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
  let vignette: CanvasGradient | null = null;
  const lastBoss = { x: 0, y: 0, radius: 3, color: '#3a0ca3', defId: '', phase: 1 };
  const bossOpts: BossDrawOpts = { color: '', time: 0, enraged: false, flash: 0, retreat: 0, lookX: null, lookY: null, charge: 0, shake: 0, phase: 1, phaseFlash: 0 };
  const pruneMemo = (m: UnitMemo, id: number) => {
    if (m.stamp !== stamp) memos.delete(id);
  };
  let hasLastBoss = false;

  // Backing-store resolution follows the pixels actually shown: the stage is CSS-scaled to fit the screen
  // (e.g. ×0.54 on an 844×390 phone), so DPR alone would over-allocate (≈50% more pixels to fill per frame).
  // The displayed width is re-read only on resize-type events and about once a second (avoids forced layouts).
  let shownScale = 1;
  let scaleCheckIn = 0;
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
    const want = Math.max(1, Math.min(2, Math.round(raw * readShownScale(dt) * 8) / 8));
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

  function getVignette(): CanvasGradient {
    if (!vignette) {
      const g = ctx!.createRadialGradient(LOGICAL_W / 2, LOGICAL_H / 2, 260, LOGICAL_W / 2, LOGICAL_H / 2, 760);
      g.addColorStop(0, 'rgba(255,0,40,0)');
      g.addColorStop(1, 'rgba(255,0,40,0.42)');
      vignette = g;
    }
    return vignette;
  }

  // ─────────────────────────── ground-layer passes ───────────────────────────

  function drawZones(state: GameState): void {
    const c = ctx!;
    for (const z of state.zones) {
      if (!cam.visibleX(z.center.x, (z.area ? areaReach(z.area) : z.radius) + 1)) continue;
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
    const c = ctx!;
    for (const t of state.telegraphs) {
      if (t.team !== team) continue;
      const enemy = t.team === 'enemy';
      const color = enemy ? COLORS.telegraphEnemy : COLORS.telegraphAlly;
      const p = t.total > 0 ? Math.max(0, Math.min(1, 1 - t.remaining / t.total)) : 1;
      const area = t.area.shape === 'circle' && t.area.radius > 30 ? BIG_CIRCLE : t.area;
      pathArea(c, cam, t.center, t.origin, area, 1);
      // enemy fill darkens toward the hit so a big slow circle still reads as "get out"
      c.globalAlpha = enemy ? 0.16 + 0.2 * p : 0.12;
      c.fillStyle = color;
      c.fill();
      const urgent = t.remaining < 0.35;
      c.globalAlpha = urgent ? 0.6 + 0.4 * Math.sin(time * 40) : 0.9;
      c.lineWidth = enemy ? 3 : 2.5;
      c.strokeStyle = urgent ? '#ffffff' : color;
      c.stroke();
      if (p > 0.01) {
        pathArea(c, cam, t.center, t.origin, area, p);
        c.globalAlpha = enemy ? 0.38 : 0.3;
        c.fillStyle = color;
        c.fill();
        c.globalAlpha = 0.8;
        c.lineWidth = 1.5;
        c.strokeStyle = color;
        c.stroke();
      }
      if (area.shape === 'rect' || area.shape === 'cone') drawAreaDirection(c, cam, t.center, area, '#ffffff', 0.8, time, false);
      else if (enemy && (area.shape === 'fan' || area.shape === 'line')) drawAimedDirection(c, cam, t.center, t.origin, area, '#ffe2e2', 0.85, time);
    }
    c.globalAlpha = 1;
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
    switch (e.anim) {
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
    let gx = e.pos.x;
    let gy = e.pos.y;
    if (vfx.dashPose(e.id, dashOff)) {
      gx += dashOff.ox;
      gy += dashOff.oy;
      lift = Math.min(1, dashOff.z / 1.6);
    }
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
    }
    drawBody(c, look, e.tier, fx, fy, w, h, s, time, m.phase, m.flash > 0);
    HERO_POSE.swing = 0;
    HERO_POSE.recoil = 0;
    CREATURE_POSE.act = 0;
    CREATURE_POSE.moving = false;
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
    const c = ctx!;
    computePose(e, m);
    const look = m.look;
    const w = bodyWidth(e.radius);
    const h = w * look.heightMul * Math.min(1.12, pose.hMul);
    const top = pose.fy - pose.z - bodyTop(look, e.tier, h, w);
    const isLocal = e.kind === 'character' && e.ownerPlayer === local;
    const ally = e.team === 'ally';
    const showBar = e.kind !== 'monster' || e.tier === 'mid' || e.hp < e.maxHp || e.shield > 0;
    let y = top - 8;
    if (showBar) {
      const style = barStyleFor(e, isLocal, w);
      y -= style.height;
      drawHpBar(c, pose.fx, y, style, e.hp, e.maxHp, e.shield, m.hpLag, ally, isLocal ? playerColor(state, local) : null);
      y -= 3;
    }
    if (e.statuses.length > 0) y -= drawStatusPips(c, pose.fx, y, e.statuses);
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
      if (e.team !== 'enemy' || e.hp <= 0 || e.tier === 'boss') continue;
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
        arenaFloor = -1;
      }
      runSeed = state.seed;
    }
    lastTick = state.tick;

    const arena = state.plan.arena;
    const boss = state.plan.kind === 'boss';
    if (state.floor !== arenaFloor || boss !== arenaBoss || arena.width !== arenaW || arena.height !== arenaH) {
      if (arenaFloor !== -1) vfx.reset();
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
    for (const ev of events) {
      vfx.handle(ev, vc);
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
    vfx.update(dt, vc);

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
    tagBoxes.length = 0;
    for (const e of sorted) if (e !== mine) drawUnitOverhead(e, memos.get(e.id)!, ui.localPlayer, state);
    if (mine) drawUnitOverhead(mine, memos.get(mine.id)!, ui.localPlayer, state);
    if (ui.dragPreview) drawPreviewGhost(ui.dragPreview, state);
    vfx.drawOverlay(c, cam);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (startsFreeze) {
      // hold this picture for the hit-stop (no DOM → no freeze: tests, workers)
      freezeOk = captureFreeze();
      if (!freezeOk) juice.cancelFreeze();
    }
    drawOffscreenEnemies(state);
    vfx.drawScreen(c, state.bossEnraged && state.bossId !== null, time, getVignette());
    c.globalAlpha = 1;
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
    vfx.drawScreen(c, state.bossEnraged && state.bossId !== null, time, getVignette());
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
type ProjStyle = 'ranger' | 'gunner' | 'mage' | 'cleric' | 'bard' | 'chrono';
const PROJ_STYLE = new Map<string, ProjStyle>();
for (const ch of CHARACTERS) {
  if (ch.id === 'ranger' || ch.id === 'gunner' || ch.id === 'mage' || ch.id === 'cleric' || ch.id === 'bard' || ch.id === 'chrono') PROJ_STYLE.set(ch.color.toLowerCase(), ch.id);
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
