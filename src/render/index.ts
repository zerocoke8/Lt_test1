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
import { type BossDrawOpts, drawBoss, drawBossShadow } from './boss';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z, VIEW_WIDTH_UNITS } from './camera';
import { Backdrop } from './ground';
import { COLORS, OTHER_PLAYER_FX, boldFont } from './look';
import { areaCentroid, areaExtent } from '../sim/geometry';
import { drawAreaDirection, drawPreviewBadges, drawPreviewFootprint, previewDashEnd } from './preview';
import { TAU, pathArea, pathCapsule } from './shapes';
import {
  type UnitMemo,
  animProgress,
  barStyleFor,
  bodyTop,
  bodyWidth,
  drawBody,
  drawGroundRing,
  drawHpBar,
  drawLocalMarker,
  drawShadow,
  drawStatusPips,
  drawStunStars,
  newMemo,
  syncMemo,
} from './units';
import { Vfx, type VfxContext, playerColor } from './vfx';

export { Camera } from './camera';

const MAX_DT = 0.1;
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
  const lastBoss = { x: 0, y: 0, radius: 3, color: '#3a0ca3' };
  const bossOpts: BossDrawOpts = { color: '', time: 0, enraged: false, flash: 0, retreat: 0, lookX: null, lookY: null, charge: 0, shake: 0 };
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
      if (!cam.visibleX(z.center.x, (z.area ? areaExtent(z.area) : z.radius) + 1)) continue;
      const color =
        z.kind === 'heal'
          ? COLORS.zoneHeal
          : z.kind === 'buff'
            ? COLORS.zoneBuff
            : z.kind === 'debuff'
              ? COLORS.zoneDebuff
              : z.team === 'enemy'
                ? COLORS.zoneDamageEnemy
                : COLORS.zoneDamageAlly;
      const fadeIn = z.total > 0 ? Math.min(1, (z.total - z.remaining) / 0.25) : 1;
      // other players' fields (paladin/cleric circles …) are drawn softer so they don't bury my own preview/fight
      const others = z.ownerPlayer != null && z.ownerPlayer !== vc.localPlayer ? OTHER_PLAYER_FX : 1;
      const fade = Math.min(1, z.remaining / 0.4, fadeIn) * others;
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

  /** Per-entity pose for this frame: foot screen point + lift (px). Written into tmp fields to avoid allocation. */
  const pose = { fx: 0, fy: 0, z: 0, hMul: 1 };
  function computePose(e: Entity, m: UnitMemo): void {
    let ox = 0;
    let oy = 0;
    let z = 0;
    let hMul = 1;
    const p = animProgress(e, m);
    switch (e.anim) {
      case 'attack': {
        const k = Math.sin(p * Math.PI);
        const L = (m.look.ranged ? 0.08 : 0.32) * k;
        ox = Math.cos(e.facing) * L;
        oy = Math.sin(e.facing) * L;
        hMul = 1 - 0.06 * k;
        break;
      }
      case 'appear':
        z = (1 - p) * (1 - p) * 3.2;
        hMul = p > 0.85 ? 1 - 0.18 * Math.sin(((p - 0.85) / 0.15) * Math.PI) : 1.08;
        break;
      case 'move':
        z = Math.abs(Math.sin(time * 9 + m.phase)) * 0.07;
        break;
      case 'cast':
        hMul = 1 + 0.05 * Math.sin(time * 18);
        break;
      default:
        hMul = 1 + 0.025 * Math.sin(time * 2.6 + m.phase);
    }
    if (vfx.dashPose(e.id, dashOff)) {
      // drag-skill dash: drawn at the replayed streak position; it lands fast at the drop point, then dashes
      ox += dashOff.ox;
      oy += dashOff.oy;
      if (e.anim === 'appear') z = dashOff.z;
    }
    pose.fx = cam.sx(e.pos.x + ox);
    pose.fy = cam.sy(e.pos.y + oy);
    pose.z = z * PX_PER_UNIT_Z;
    pose.hMul = hMul;
  }

  function drawUnitGround(e: Entity, m: UnitMemo, local: number, state: GameState): void {
    const c = ctx!;
    let lift = e.anim === 'appear' ? (1 - animProgress(e, m)) : 0;
    let gx = e.pos.x;
    let gy = e.pos.y;
    if (vfx.dashPose(e.id, dashOff)) {
      gx += dashOff.ox;
      gy += dashOff.oy;
      lift = Math.min(1, dashOff.z / 1.6);
    }
    drawShadow(c, cam, gx, gy, e.radius * (m.look.shape === 'hero' ? 0.9 : 1), 1 - lift * 0.6, 1 - lift * 0.5);
    if (e.anim === 'cast') {
      const k = 0.5 + 0.5 * Math.sin(time * 14);
      c.globalAlpha = 0.25 + 0.25 * k;
      c.fillStyle = m.look.light;
      c.beginPath();
      c.ellipse(cam.sx(gx), cam.sy(gy), e.radius * PX_PER_UNIT * (1.5 + 0.2 * k), e.radius * PX_PER_UNIT_Y * (1.5 + 0.2 * k), 0, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
    }
    if (e.team === 'ally') {
      const owner = e.ownerPlayer;
      const color = owner !== null ? playerColor(state, owner) : '#7fd1ff';
      const mode = e.kind === 'character' ? (owner === local ? 'local' : 'ally') : 'summon';
      drawGroundRing(c, cam, gx, gy, e.radius, color, mode, time);
    } else {
      drawGroundRing(c, cam, gx, gy, e.radius, COLORS.enemyRing, 'enemy', time);
    }
  }

  function drawUnitBody(e: Entity, m: UnitMemo): void {
    const c = ctx!;
    computePose(e, m);
    const look = m.look;
    const w = bodyWidth(e.radius);
    const h = w * look.heightMul * pose.hMul;
    const s = Math.cos(e.facing) >= 0 ? 1 : -1;
    const fy = pose.fy - pose.z;
    let alpha = 1;
    if (e.expiresIn !== null && e.expiresIn < 2 && e.kind === 'summon') alpha = Math.sin(time * 20) > 0 ? 1 : 0.45;
    if (e.anim === 'cast') {
      const k = 0.5 + 0.5 * Math.sin(time * 14);
      c.globalAlpha = 0.25 + 0.2 * k;
      c.fillStyle = look.light;
      c.beginPath();
      c.ellipse(pose.fx, fy - h * 0.5, w * 0.8, h * 0.68, 0, 0, TAU);
      c.fill();
    }
    c.globalAlpha = alpha;
    drawBody(c, look, e.tier, pose.fx, fy, w, h, s, time, m.phase, m.flash > 0);
    if (e.invulnTime > 0 && e.anim !== 'appear') {
      c.globalAlpha = 0.5 + 0.4 * Math.sin(time * 25);
      pathCapsule(c, pose.fx, fy + 3, w + 8, h + 8);
      c.lineWidth = 2;
      c.strokeStyle = '#ffffff';
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  function drawUnitOverhead(e: Entity, m: UnitMemo, local: number, state: GameState): void {
    const c = ctx!;
    computePose(e, m);
    const look = m.look;
    const w = bodyWidth(e.radius);
    const h = w * look.heightMul * pose.hMul;
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
    const stunned = e.anim === 'stunned' || hasStun(e);
    if (stunned) drawStunStars(c, pose.fx, top + 2, w, time + m.phase);
    if (isLocal) drawLocalMarker(c, pose.fx, y - 2, playerColor(state, local), time);
  }

  function drawLocalOutline(e: Entity, m: UnitMemo, color: string): void {
    const c = ctx!;
    computePose(e, m);
    const w = bodyWidth(e.radius);
    const h = w * m.look.heightMul * pose.hMul;
    const fy = pose.fy - pose.z;
    pathCapsule(c, pose.fx, fy + 2, w + 7, h + 6);
    c.globalAlpha = 0.95;
    c.lineWidth = 4.5;
    c.strokeStyle = '#05060a';
    c.stroke();
    c.lineWidth = 2.5;
    c.strokeStyle = color;
    c.stroke();
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
      const trail = Math.min(1.2, 0.25 + p.speed * 0.05);
      const hx = cam.sx(p.pos.x);
      const hy = cam.sy(p.pos.y) - zp;
      const tx1 = cam.sx(p.pos.x - dx * trail);
      const ty1 = cam.sy(p.pos.y - dy * trail) - zp;
      const tx2 = cam.sx(p.pos.x - dx * trail * 0.5);
      const ty2 = cam.sy(p.pos.y - dy * trail * 0.5) - zp;
      // ground shadow
      c.globalAlpha = 0.25;
      c.fillStyle = '#000000';
      c.beginPath();
      c.ellipse(hx, cam.sy(p.pos.y), 5, 2.5, 0, 0, TAU);
      c.fill();
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
          drawBoss(c, cam, lastBoss.x, lastBoss.y, lastBoss.radius, o);
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
      drawBoss(c, cam, e.pos.x, e.pos.y, e.radius, o);
      lastBoss.x = e.pos.x;
      lastBoss.y = e.pos.y;
      lastBoss.radius = e.radius;
      lastBoss.color = m.look.color;
      hasLastBoss = true;
    }
  }

  // ─────────────────────────── frame ───────────────────────────

  function render(state: GameState, events: GameEvent[], realDt: number, ui: RenderUiState): void {
    const c = ctx!;
    const dt = Math.max(0, Math.min(MAX_DT, Number.isFinite(realDt) ? realDt : 0));
    time += dt;
    stamp++;
    ensureBackingStore(dt);

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
    backdrop.ensure(arena.width, arena.height, boss, state.floor, dpr);

    // events first: death/leave ghosts need last frame's memos
    vc.state = state;
    vc.localPlayer = ui.localPlayer;
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
    vfx.drawAir(c, cam);
    for (const e of sorted) if (e !== mine) drawUnitOverhead(e, memos.get(e.id)!, ui.localPlayer, state);
    if (mine) drawUnitOverhead(mine, memos.get(mine.id)!, ui.localPlayer, state);
    if (ui.dragPreview) drawPreviewGhost(ui.dragPreview, state);
    vfx.drawOverlay(c, cam);
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
const dashOff = { ox: 0, oy: 0, z: 0 };
const offSide = { ln: 0, rn: 0, ly: 0, ry: 0, lmid: false, rmid: false };

function hasStun(e: Entity): boolean {
  const st = e.statuses;
  for (let i = 0; i < st.length; i++) if (st[i].id === 'stun') return true;
  return false;
}
