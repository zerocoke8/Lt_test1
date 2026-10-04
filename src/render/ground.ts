// Background + ground (기획 8차: 역류하는 빌딩 — every zone is an everyday place gone wrong).
// Four zones by FloorPlan.theme (fallback: floor number): 'lobby' 로비·상가 (tiles, roll-down shutters, elevator
// doors, flickering fluorescent tubes), 'office' 사무실 (carpet, partitions, glowing monitors, stray papers), 'ward'
// 폐병동 (green-grey tiles, bed curtains, IV stands, grime), 'rooftop' 옥상·이계 (concrete, AC units, cables, a purple
// night sky over a warped skyline). Boss floors use the zone's darker variant with the middle left clear for the boss.
// The static part is baked once per floor into an offscreen canvas at backing-store resolution and blitted with the
// camera offset every frame; only a few lights animate. No shadowBlur. The walkable floor stays low-contrast.

import { LOGICAL_H, LOGICAL_W, type FloorTheme } from '../types';
import { Camera, GROUND_TOP, PX_PER_UNIT, PX_PER_UNIT_Y } from './camera';
import { hash01 } from './shapes';

interface Palette {
  voidTop: string;
  voidBottom: string;
  wallTop: string;
  wall: string;
  wallLine: string;
  tileA: string;
  tileB: string;
  grout: string;
  crack: string;
  lip: string;
  cliff: string;
  border: string;
  /** Animated light colour. */
  light: string;
  /** Accent used by floor markings / the boss-floor emblem. */
  accent: string;
}

const PALETTES: Record<FloorTheme, Palette> = {
  lobby: {
    voidTop: '#06070a', voidBottom: '#0a0b0f', wallTop: '#0d0f13', wall: '#262a31', wallLine: '#1c1f25',
    tileA: '#3d4148', tileB: '#373b42', grout: '#2b2e34', crack: '#2c2f35', lip: '#7d838c', cliff: '#16181c',
    border: 'rgba(220,235,255,0.2)', light: '#e8fff4', accent: '#c9a227',
  },
  office: {
    voidTop: '#05070b', voidBottom: '#090c12', wallTop: '#0b0e15', wall: '#232a37', wallLine: '#1a202b',
    tileA: '#323b4b', tileB: '#2f3747', grout: '#283040', crack: '#262d3b', lip: '#68758c', cliff: '#141923',
    border: 'rgba(190,215,255,0.2)', light: '#dfefff', accent: '#5aa9ff',
  },
  ward: {
    voidTop: '#050806', voidBottom: '#080c0a', wallTop: '#0b100e', wall: '#2a3530', wallLine: '#1f2925',
    tileA: '#3a4741', tileB: '#36423c', grout: '#2a3430', crack: '#28312c', lip: '#78887f', cliff: '#141a17',
    border: 'rgba(205,255,225,0.18)', light: '#d6ffe6', accent: '#59d18c',
  },
  rooftop: {
    voidTop: '#0b0618', voidBottom: '#0d0716', wallTop: '#140a2a', wall: '#2c2638', wallLine: '#221d2c',
    tileA: '#3b3744', tileB: '#38343f', grout: '#2b2833', crack: '#2a2531', lip: '#857c96', cliff: '#17131e',
    border: 'rgba(215,190,255,0.22)', light: '#ff4d6d', accent: '#b388ff',
  },
};

/** Zone of a floor: the plan's theme, else 1–5 lobby · 6–10 office · 11–15 ward · 16+ rooftop. */
export function zoneOf(floor: number, theme?: FloorTheme): FloorTheme {
  if (theme && theme in PALETTES) return theme;
  if (floor <= 5) return 'lobby';
  if (floor <= 10) return 'office';
  if (floor <= 15) return 'ward';
  return 'rooftop';
}

/** Screen band baked into the cache (logical px). */
const BAND_TOP = 40;
const CLIFF_H = 46;
/** Animated light spacing along the wall (world units). */
const LIGHT_STEP = 6;

export class Backdrop {
  private cache: HTMLCanvasElement | null = null;
  private key = '';
  private scale = 1;
  private arenaW = 24;
  private arenaH = 12;
  private boss = false;
  private zone: FloorTheme = 'lobby';
  private pal: Palette = PALETTES.lobby;
  private bandBottom = 0;
  private voidGrad: CanvasGradient | null = null;
  private voidGradCtx: CanvasRenderingContext2D | null = null;
  private voidGradKey = '';

  /** Current zone (render: lights, boss set pieces). */
  get theme(): FloorTheme {
    return this.zone;
  }

  ensure(arenaW: number, arenaH: number, boss: boolean, floor: number, scale: number, theme?: FloorTheme, bossId?: string): void {
    const zone = zoneOf(floor, theme);
    const key = `${arenaW}x${arenaH}:${boss ? 'b' : 'n'}:${zone}:${scale}:${bossId ?? ''}`;
    if (key === this.key && this.cache) return;
    this.key = key;
    this.arenaW = arenaW;
    this.arenaH = arenaH;
    this.boss = boss;
    this.scale = scale;
    this.zone = zone;
    this.pal = PALETTES[zone];
    this.bandBottom = GROUND_TOP + arenaH * PX_PER_UNIT_Y + CLIFF_H;
    this.bake();
  }

  private bake(): void {
    if (typeof document === 'undefined') return;
    const wPx = Math.ceil(this.arenaW * PX_PER_UNIT);
    const hPx = Math.ceil(this.bandBottom - BAND_TOP);
    const c = this.cache ?? document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(wPx * this.scale));
    c.height = Math.max(1, Math.ceil(hPx * this.scale));
    const g = c.getContext('2d');
    if (!g) return;
    this.cache = c;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.clearRect(0, 0, wPx, hPx);
    const B: Bake = { g, wPx, groundY: GROUND_TOP - BAND_TOP, groundH: this.arenaH * PX_PER_UNIT_Y, arenaW: this.arenaW, arenaH: this.arenaH, boss: this.boss, p: this.pal };
    switch (this.zone) {
      case 'lobby':
        wallLobby(B);
        floorLobby(B);
        break;
      case 'office':
        wallOffice(B);
        floorOffice(B);
        break;
      case 'ward':
        wallWard(B);
        floorWard(B);
        break;
      case 'rooftop':
        wallRooftop(B);
        floorRooftop(B);
        break;
    }
    if (this.boss) bossEmblem(B);
    shadeFloor(B);
    frontEdge(B, this.zone);
  }

  /** Draws the void + baked band + animated lights. `highlight` brightens the arena bounds (while dragging). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, time: number, highlight: boolean): void {
    const t = this.pal;
    if (this.voidGradCtx !== ctx || this.voidGradKey !== this.key) {
      const vg = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
      vg.addColorStop(0, t.voidTop);
      vg.addColorStop(1, t.voidBottom);
      this.voidGrad = vg;
      this.voidGradCtx = ctx;
      this.voidGradKey = this.key;
    }
    const dx = cam.sx(0);
    const wPx = this.arenaW * PX_PER_UNIT;
    const hPx = this.bandBottom - BAND_TOP;
    const sx0 = Math.max(0, -dx);
    const sx1 = Math.min(wPx, LOGICAL_W - dx);
    ctx.fillStyle = this.voidGrad ?? t.voidBottom;
    const coversWidth = dx <= 0.5 && dx + wPx >= LOGICAL_W - 0.5;
    if (!this.cache || !coversWidth) {
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    } else {
      // only the strips the baked band doesn't cover (avoids a full-screen overdraw)
      ctx.fillRect(0, 0, LOGICAL_W, BAND_TOP + 1);
      ctx.fillRect(0, this.bandBottom - 1, LOGICAL_W, LOGICAL_H - this.bandBottom + 1);
    }
    if (this.cache && sx1 > sx0) {
      ctx.drawImage(this.cache, sx0 * this.scale, 0, (sx1 - sx0) * this.scale, hPx * this.scale, dx + sx0, BAND_TOP, sx1 - sx0, hPx);
    }
    this.drawLights(ctx, cam, time);
    if (highlight) {
      const a = 0.45 + 0.25 * Math.sin(time * 6);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash(DASH);
      ctx.strokeRect(dx + 2, GROUND_TOP + 2, wPx - 4, this.arenaH * PX_PER_UNIT_Y - 4);
      ctx.setLineDash(NO_DASH);
      ctx.globalAlpha = 1;
    }
  }

  /** Per-frame lights: flickering tubes (lobby/office/ward), monitor glow (office), aviation lights + fans (rooftop). */
  private drawLights(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const zone = this.zone;
    const y = GROUND_TOP - 36;
    for (let wx = 3; wx < this.arenaW; wx += LIGHT_STEP) {
      if (!cam.visibleX(wx, 2)) continue;
      if (this.boss && Math.abs(wx - this.arenaW / 2) < 5) continue;
      const x = cam.sx(wx);
      const seed = wx * 7.13;
      if (zone === 'rooftop') {
        // red aviation lamp on the parapet post (slow blink) + a spinning condenser fan
        const on = Math.sin(time * 2.2 + seed) > 0.2;
        ctx.globalAlpha = on ? 0.2 : 0.05;
        ctx.fillStyle = this.pal.light;
        ctx.beginPath();
        ctx.ellipse(x + 34, GROUND_TOP - 32, 20, 12, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = on ? '#ff6b81' : '#5a1f2a';
        ctx.beginPath();
        ctx.arc(x + 34, GROUND_TOP - 32, 3.2, 0, TAU);
        ctx.fill();
        if (!this.boss || Math.abs(wx - this.arenaW / 2) > 7) drawFan(ctx, x - 30, GROUND_TOP - 26, 11, time * 9 + seed);
        continue;
      }
      // fluorescent tube: mostly steady, now and then it stutters (per-tube phase so they never blink together)
      const ph = (time * 0.37 + hash01(wx, 3)) % 1;
      let f = 0.92 + 0.08 * Math.sin(time * 50 + seed);
      if (ph < (zone === 'ward' ? 0.1 : 0.05)) f = Math.sin(time * 61 + seed) > 0.1 ? 0.25 : 1;
      if (zone === 'ward' && hash01(wx, 9) < 0.25) f *= 0.55 + 0.45 * Math.max(0, Math.sin(time * 3.1 + seed));
      const col = zone === 'ward' ? '#cfffe0' : zone === 'office' ? '#e6f1ff' : '#effff6';
      ctx.globalAlpha = 0.13 * f;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y + 16, 70, 26, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.85 * f + 0.1;
      ctx.fillStyle = col;
      ctx.fillRect(x - 30, y - 2, 60, 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1c2025';
      ctx.fillRect(x - 33, y - 5, 66, 3);
    }
    if (zone === 'office') {
      // monitors breathing behind the partitions
      const k = 0.75 + 0.25 * Math.sin(time * 1.7);
      for (let wx = 1.5; wx < this.arenaW; wx += 3) {
        if (!cam.visibleX(wx, 1) || (this.boss && Math.abs(wx - this.arenaW / 2) < 5)) continue;
        if (hash01(Math.round(wx * 10), 5) < 0.35) continue;
        const x = cam.sx(wx);
        ctx.globalAlpha = 0.1 * k;
        ctx.fillStyle = hash01(Math.round(wx * 10), 6) < 0.15 ? '#ff5d73' : '#7cc4ff';
        ctx.beginPath();
        ctx.ellipse(x, GROUND_TOP - 24, 30, 14, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (zone === 'ward') {
      // 비상구 sign glow
      for (let wx = 9; wx < this.arenaW; wx += 18) {
        if (!cam.visibleX(wx, 1)) continue;
        const x = cam.sx(wx);
        const k = 0.6 + 0.4 * Math.sin(time * 1.3 + wx);
        ctx.globalAlpha = 0.12 * k;
        ctx.fillStyle = '#39ff88';
        ctx.beginPath();
        ctx.ellipse(x, GROUND_TOP - 51, 38, 17, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (zone === 'rooftop') {
      // the warped horizon breathes
      const p = 0.5 + 0.5 * Math.sin(time * 0.9);
      ctx.globalAlpha = 0.06 + 0.04 * p;
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(0, GROUND_TOP - 62, LOGICAL_W, 26);
      ctx.globalAlpha = 1;
    }
    if (this.boss) {
      // the boss's corner of the wall breathes in the zone accent (stacked ellipses fake a radial falloff)
      const p = 0.5 + 0.5 * Math.sin(time * 1.3);
      const cx = cam.sx(this.arenaW / 2);
      ctx.fillStyle = zone === 'rooftop' ? '#b388ff' : zone === 'ward' ? '#7dffb3' : zone === 'office' ? '#7cc4ff' : '#ff5d5d';
      for (let i = 0; i < 4; i++) {
        const k = 1 - i * 0.22;
        ctx.globalAlpha = 0.04 + 0.025 * p;
        ctx.beginPath();
        ctx.ellipse(cx, GROUND_TOP - 22, 520 * k, (50 + 10 * p) * k, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}

const DASH = [10, 8];
const NO_DASH: number[] = [];
const TAU = Math.PI * 2;

interface Bake {
  g: CanvasRenderingContext2D;
  wPx: number;
  /** Local y of world y = 0 (the wall base). */
  groundY: number;
  groundH: number;
  arenaW: number;
  arenaH: number;
  boss: boolean;
  p: Palette;
}

/** True when world x is in the middle span a boss set piece occupies. */
function bossSpan(B: Bake, wx: number, half = 5): boolean {
  return B.boss && Math.abs(wx - B.arenaW / 2) < half;
}

function wallBase(B: Bake): void {
  const { g, wPx, groundY, p } = B;
  const wg = g.createLinearGradient(0, 0, 0, groundY);
  wg.addColorStop(0, p.wallTop);
  wg.addColorStop(0.4, p.wall);
  wg.addColorStop(1, p.wall);
  g.fillStyle = wg;
  g.fillRect(0, 0, wPx, groundY);
}

function wallFoot(B: Bake, color = 'rgba(0,0,0,0.38)'): void {
  const { g, wPx, groundY } = B;
  // baseboard + floor shadow line
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, groundY - 10, wPx, 2);
  g.fillStyle = color;
  g.fillRect(0, groundY - 6, wPx, 6);
}

/** Dark void in the middle of a boss wall: the boss looms out of it. */
function bossHole(B: Bake, top: string, bottom: string): void {
  const { g, groundY, arenaW } = B;
  const cx = (arenaW / 2) * PX_PER_UNIT;
  const w = 9 * PX_PER_UNIT;
  const hg = g.createLinearGradient(0, 0, 0, groundY);
  hg.addColorStop(0, top);
  hg.addColorStop(1, bottom);
  g.fillStyle = hg;
  g.fillRect(cx - w / 2, 0, w, groundY - 4);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(cx - w / 2 - 6, 0, 6, groundY - 4);
  g.fillRect(cx + w / 2, 0, 6, groundY - 4);
}

// ─────────────────────────── 로비·상가 ───────────────────────────

const SHOP_SIGNS = ['24시 편의점', '세탁소', '분식', '임대 문의', '약국', '부동산', '사진관', '열쇠'];
const SIGN_COLORS = ['#3fb6a8', '#4a7bd1', '#d1704a', '#8a8f98', '#3fae5d', '#c9a227', '#9b6fd1', '#c94a6a'];

function wallLobby(B: Bake): void {
  const { g, groundY, arenaW } = B;
  wallBase(B);
  if (B.boss) bossHole(B, '#050506', '#160608');
  // storefront every 6 units, an elevator bay between them
  for (let wx = 0; wx < arenaW; wx += 6) {
    const shopX = (wx + 1.6) * PX_PER_UNIT;
    const elevX = (wx + 4.6) * PX_PER_UNIT;
    const i = Math.round(wx / 6);
    if (!bossSpan(B, wx + 1.6)) {
      // roll-down shutter + faded sign (kept low: the top HUD row covers the wall above logical y ≈ 92)
      const sw = 128;
      const top = 66;
      g.fillStyle = '#4b5058';
      g.fillRect(shopX - sw / 2, top, sw, groundY - top - 8);
      g.strokeStyle = '#3a3e45';
      g.lineWidth = 2;
      g.beginPath();
      for (let y = top + 6; y < groundY - 8; y += 6) {
        g.moveTo(shopX - sw / 2, y);
        g.lineTo(shopX + sw / 2, y);
      }
      g.stroke();
      // grime + a lock at the bottom
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(shopX - sw / 2, groundY - 30, sw, 22);
      g.fillStyle = '#c9a227';
      g.fillRect(shopX - 5, groundY - 16, 10, 6);
      g.fillStyle = SIGN_COLORS[i % SIGN_COLORS.length];
      g.globalAlpha = 0.55;
      g.fillRect(shopX - sw / 2 - 4, top - 16, sw + 8, 15);
      g.globalAlpha = 1;
      g.font = '800 11px "Pretendard","Noto Sans KR",sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillText(SHOP_SIGNS[i % SHOP_SIGNS.length], shopX, top - 8.5);
      // a taped paper notice on the shutter
      if (hash01(i, 21) < 0.6) {
        g.fillStyle = '#d9d2bf';
        g.globalAlpha = 0.6;
        g.fillRect(shopX + 18 - hash01(i, 22) * 40, groundY - 36, 14, 16);
        g.globalAlpha = 1;
      }
    }
    if (!bossSpan(B, wx + 4.6, 6)) {
      // elevator doors (brushed steel) with the floor indicator over them
      const ew = 70;
      const top = 52;
      g.fillStyle = '#6f7680';
      g.fillRect(elevX - ew / 2 - 6, top - 6, ew + 12, groundY - top - 2);
      const dg = g.createLinearGradient(elevX - ew / 2, 0, elevX + ew / 2, 0);
      dg.addColorStop(0, '#8a929c');
      dg.addColorStop(0.5, '#a7aeb7');
      dg.addColorStop(1, '#7c838d');
      g.fillStyle = dg;
      g.fillRect(elevX - ew / 2, top, ew, groundY - top - 8);
      g.fillStyle = '#2b2e33';
      g.fillRect(elevX - 1, top, 2, groundY - top - 8);
      // the doors are open a crack: darkness, and something looking out
      if (hash01(i, 31) < 0.5) {
        g.fillStyle = '#050506';
        g.fillRect(elevX - 4, top, 8, groundY - top - 8);
        g.fillStyle = '#ffe9a8';
        g.fillRect(elevX - 2, top + 16, 1.5, 1.5);
        g.fillRect(elevX + 1, top + 16, 1.5, 1.5);
      }
      g.fillStyle = '#111317';
      g.fillRect(elevX - 18, top - 20, 36, 13);
      g.fillStyle = '#ff5d4d';
      g.font = '800 10px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(hash01(i, 33) < 0.5 ? 'B4' : '▲' + (13 - (i % 5)), elevX, top - 13);
      // call button
      g.fillStyle = '#3a3e45';
      g.fillRect(elevX + ew / 2 + 10, groundY - 58, 8, 14);
      g.fillStyle = '#ffd166';
      g.fillRect(elevX + ew / 2 + 12, groundY - 55, 4, 3);
    }
  }
  wallFoot(B);
}

function floorLobby(B: Bake): void {
  const { g, groundY, arenaW, arenaH } = B;
  // big polished tiles with faint marble veins and reflections of the tubes
  const tile = 2;
  for (let ty = 0; ty < arenaH; ty += tile) {
    for (let tx = 0; tx < arenaW; tx += tile) {
      const x0 = tx * PX_PER_UNIT;
      const y0 = groundY + ty * PX_PER_UNIT_Y;
      g.fillStyle = ((tx + ty) / tile) % 2 === 0 ? B.p.tileA : B.p.tileB;
      g.fillRect(x0, y0, tile * PX_PER_UNIT, Math.min(tile, arenaH - ty) * PX_PER_UNIT_Y);
    }
  }
  groutGrid(B, tile, tile, B.p.grout, 2);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1.2;
  g.beginPath();
  const n = Math.round(arenaW * arenaH * 0.06);
  for (let i = 0; i < n; i++) {
    let x = hash01(i, 11) * arenaW * PX_PER_UNIT;
    let y = groundY + hash01(i, 12) * B.groundH;
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += 10 + hash01(i, 20 + s) * 22;
      y += (hash01(i, 30 + s) - 0.5) * 10;
      g.lineTo(x, y);
    }
  }
  g.stroke();
  // tube reflections on the polish
  for (let wx = 3; wx < arenaW; wx += LIGHT_STEP) {
    if (bossSpan(B, wx)) continue;
    const rg = g.createLinearGradient(0, groundY, 0, groundY + 120);
    rg.addColorStop(0, 'rgba(225,255,240,0.09)');
    rg.addColorStop(1, 'rgba(225,255,240,0)');
    g.fillStyle = rg;
    g.fillRect(wx * PX_PER_UNIT - 24, groundY, 48, 120);
  }
  // yellow caution line along the shop fronts + a wet-floor puddle
  g.fillStyle = 'rgba(201,162,39,0.35)';
  g.fillRect(0, groundY + 10, arenaW * PX_PER_UNIT, 3);
  for (let i = 0; i < Math.round(arenaW / 12); i++) {
    const x = (hash01(i, 51) * 0.8 + 0.1) * arenaW * PX_PER_UNIT;
    const y = groundY + (0.35 + hash01(i, 52) * 0.5) * B.groundH;
    g.fillStyle = 'rgba(160,200,230,0.07)';
    g.beginPath();
    g.ellipse(x, y, 46 + hash01(i, 53) * 30, 12, 0, 0, TAU);
    g.fill();
  }
}

// ─────────────────────────── 사무실 ───────────────────────────

function wallOffice(B: Bake): void {
  const { g, groundY, arenaW } = B;
  wallBase(B);
  // night windows with blinds high on the wall
  for (let wx = 0.5; wx < arenaW; wx += 4) {
    if (bossSpan(B, wx + 1.5, 6)) continue;
    const x = wx * PX_PER_UNIT;
    g.fillStyle = '#101a2b';
    g.fillRect(x, 8, 3 * PX_PER_UNIT - 10, 52);
    g.strokeStyle = 'rgba(160,190,230,0.22)';
    g.lineWidth = 2;
    g.beginPath();
    for (let y = 12; y < 60; y += 5) {
      g.moveTo(x, y);
      g.lineTo(x + 3 * PX_PER_UNIT - 10, y);
    }
    g.stroke();
  }
  if (B.boss) bossHole(B, '#05070c', '#0b1424');
  // cubicle partitions with monitors peeking over
  for (let wx = 0; wx < arenaW; wx += 3) {
    if (bossSpan(B, wx + 1.5)) continue;
    const x = wx * PX_PER_UNIT;
    const w = 3 * PX_PER_UNIT - 6;
    g.fillStyle = '#3c4658';
    g.fillRect(x + 3, groundY - 46, w, 40);
    g.fillStyle = '#4a566b';
    g.fillRect(x + 3, groundY - 48, w, 4);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1;
    g.strokeRect(x + 8, groundY - 40, w - 10, 28);
    if (hash01(Math.round(wx), 5) >= 0.35) {
      const mx = x + w / 2 + (hash01(Math.round(wx), 7) - 0.5) * 40;
      g.fillStyle = '#15191f';
      g.fillRect(mx - 18, groundY - 70, 36, 24);
      g.fillStyle = hash01(Math.round(wx * 10 + 15), 6) < 0.15 ? '#ff5d73' : '#7cc4ff';
      g.globalAlpha = 0.85;
      g.fillRect(mx - 15, groundY - 67, 30, 18);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.4)';
      for (let l = 0; l < 3; l++) g.fillRect(mx - 12, groundY - 63 + l * 5, 10 + hash01(Math.round(wx), 40 + l) * 12, 1.5);
    }
    // sticky notes
    if (hash01(Math.round(wx), 9) < 0.5) {
      g.fillStyle = '#ffe066';
      g.fillRect(x + 14 + hash01(Math.round(wx), 10) * 30, groundY - 36, 7, 7);
    }
  }
  wallFoot(B);
}

function floorOffice(B: Bake): void {
  const { g, groundY, arenaW, arenaH } = B;
  // 1×1 carpet tiles, grain turned every other tile
  for (let ty = 0; ty < arenaH; ty++) {
    for (let tx = 0; tx < arenaW; tx++) {
      const x0 = tx * PX_PER_UNIT;
      const y0 = groundY + ty * PX_PER_UNIT_Y;
      const v = hash01(tx, ty, 4);
      g.fillStyle = (tx + ty) % 2 === 0 ? B.p.tileA : B.p.tileB;
      g.fillRect(x0, y0, PX_PER_UNIT, PX_PER_UNIT_Y);
      g.strokeStyle = v > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      g.lineWidth = 1;
      g.beginPath();
      if ((tx + ty) % 2 === 0) for (let k = 4; k < PX_PER_UNIT; k += 6) {
        g.moveTo(x0 + k, y0 + 2);
        g.lineTo(x0 + k, y0 + PX_PER_UNIT_Y - 2);
      }
      else for (let k = 4; k < PX_PER_UNIT_Y; k += 5) {
        g.moveTo(x0 + 2, y0 + k);
        g.lineTo(x0 + PX_PER_UNIT - 2, y0 + k);
      }
      g.stroke();
    }
  }
  groutGrid(B, 1, 1, 'rgba(15,20,30,0.45)', 1);
  // stray papers, a coffee stain, a cable cover strip
  const n = Math.round(arenaW * arenaH * 0.05);
  for (let i = 0; i < n; i++) {
    const x = hash01(i, 61) * arenaW * PX_PER_UNIT;
    const y = groundY + 14 + hash01(i, 62) * (B.groundH - 24);
    g.save();
    g.translate(x, y);
    g.rotate((hash01(i, 63) - 0.5) * 1.4);
    g.scale(1, 0.6);
    g.globalAlpha = 0.16 + hash01(i, 64) * 0.1;
    g.fillStyle = '#e8edf5';
    g.fillRect(-8, -11, 16, 22);
    g.fillStyle = '#9aa6b8';
    g.fillRect(-5, -6, 10, 1.5);
    g.fillRect(-5, -2, 8, 1.5);
    g.restore();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < Math.round(arenaW / 10); i++) {
    const x = hash01(i, 71) * arenaW * PX_PER_UNIT;
    const y = groundY + (0.3 + hash01(i, 72) * 0.6) * B.groundH;
    g.strokeStyle = 'rgba(70,45,25,0.22)';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(x, y, 13, 6, 0, 0.3, TAU - 0.6);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(0, groundY + B.groundH * 0.62, arenaW * PX_PER_UNIT, 7);
}

// ─────────────────────────── 폐병동 ───────────────────────────

function wallWard(B: Bake): void {
  const { g, groundY, arenaW } = B;
  wallBase(B);
  // wainscot tiles on the lower wall
  g.fillStyle = '#34423b';
  g.fillRect(0, groundY - 44, B.wPx, 44);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1;
  g.beginPath();
  for (let y = groundY - 44; y < groundY; y += 11) {
    g.moveTo(0, y);
    g.lineTo(B.wPx, y);
  }
  for (let x = 0; x < B.wPx; x += 11) {
    g.moveTo(x, groundY - 44);
    g.lineTo(x, groundY);
  }
  g.stroke();
  if (B.boss) bossHole(B, '#030504', '#0c1a12');
  // bed curtains on ceiling rails, IV stands between them, a stopped clock, the exit sign
  for (let wx = 0; wx < arenaW; wx += 4.5) {
    const i = Math.round(wx / 4.5);
    const cx = (wx + 2) * PX_PER_UNIT;
    if (!bossSpan(B, wx + 2, 6)) {
      g.fillStyle = '#5b6b62';
      g.fillRect(cx - 80, 18, 160, 3);
      const open = hash01(i, 81) < 0.4;
      const cw = open ? 60 : 150;
      const x0 = cx - 75;
      g.fillStyle = '#7f9a8b';
      g.beginPath();
      g.moveTo(x0, 21);
      for (let k = 0; k <= 12; k++) g.lineTo(x0 + (cw * k) / 12, 21 + (k % 2) * 3);
      g.lineTo(x0 + cw, groundY - 16);
      for (let k = 12; k >= 0; k--) g.lineTo(x0 + (cw * k) / 12, groundY - 16 + Math.sin(k * 1.7 + i) * 3);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 1; k < 12; k += 2) {
        g.moveTo(x0 + (cw * k) / 12, 24);
        g.lineTo(x0 + (cw * k) / 12 + Math.sin(k + i) * 3, groundY - 18);
      }
      g.stroke();
      // grime at the hem
      g.fillStyle = 'rgba(60,50,30,0.25)';
      g.fillRect(x0, groundY - 34, cw, 14);
      if (open) {
        // a shadow behind the open curtain
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.beginPath();
        g.ellipse(x0 + cw + 40, groundY - 50, 12, 26, 0, 0, TAU);
        g.fill();
      }
    }
    const ivx = (wx + 4.2) * PX_PER_UNIT;
    if (!bossSpan(B, wx + 4.2, 6) && hash01(i, 83) < 0.7) {
      g.strokeStyle = '#9aa7a0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ivx, groundY - 4);
      g.lineTo(ivx, groundY - 80);
      g.moveTo(ivx - 10, groundY - 78);
      g.lineTo(ivx + 10, groundY - 78);
      g.moveTo(ivx - 9, groundY - 3);
      g.lineTo(ivx + 9, groundY - 3);
      g.stroke();
      g.fillStyle = 'rgba(190,240,210,0.55)';
      g.fillRect(ivx + 5, groundY - 76, 8, 14);
      g.strokeStyle = 'rgba(190,240,210,0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ivx + 9, groundY - 62);
      g.quadraticCurveTo(ivx + 16, groundY - 40, ivx + 6, groundY - 22);
      g.stroke();
    }
  }
  for (let wx = 9; wx < arenaW; wx += 18) {
    if (bossSpan(B, wx, 4)) continue;
    const x = wx * PX_PER_UNIT;
    g.fillStyle = '#0d3b22';
    g.fillRect(x - 24, 50, 48, 17);
    g.fillStyle = '#39ff88';
    g.fillRect(x - 22, 52, 44, 13);
    g.fillStyle = '#0d3b22';
    g.font = '900 10px "Pretendard","Noto Sans KR",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('비상구 ▶', x, 59);
  }
  wallFoot(B, 'rgba(0,0,0,0.45)');
}

function floorWard(B: Bake): void {
  const { g, groundY, arenaW, arenaH } = B;
  // small 0.5-unit tiles, every one a shade off
  const t = 0.5;
  for (let ty = 0; ty < arenaH; ty += t) {
    for (let tx = 0; tx < arenaW; tx += t) {
      const v = hash01(Math.round(tx * 2), Math.round(ty * 2), 7);
      g.fillStyle = v < 0.5 ? B.p.tileA : B.p.tileB;
      g.fillRect(tx * PX_PER_UNIT, groundY + ty * PX_PER_UNIT_Y, t * PX_PER_UNIT, t * PX_PER_UNIT_Y);
      if (v > 0.93) {
        g.fillStyle = 'rgba(0,0,0,0.08)';
        g.fillRect(tx * PX_PER_UNIT, groundY + ty * PX_PER_UNIT_Y, t * PX_PER_UNIT, t * PX_PER_UNIT_Y);
      }
    }
  }
  groutGrid(B, t, t, 'rgba(25,32,29,0.55)', 1);
  // grime blotches (brown-green, never red), wheel tracks, a floor drain
  const n = Math.round(arenaW * arenaH * 0.03);
  for (let i = 0; i < n; i++) {
    const x = hash01(i, 91) * arenaW * PX_PER_UNIT;
    const y = groundY + hash01(i, 92) * B.groundH;
    const r = 10 + hash01(i, 93) * 24;
    g.fillStyle = hash01(i, 94) < 0.5 ? 'rgba(52,44,22,0.16)' : 'rgba(18,30,22,0.2)';
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU;
      const rr = r * (0.65 + hash01(i, 100 + k) * 0.5);
      if (k === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.5);
      else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.5);
    }
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 3;
  g.beginPath();
  for (let k = 0; k < 2; k++) {
    const y = groundY + B.groundH * (0.42 + k * 0.05);
    g.moveTo(0, y);
    for (let x = 0; x <= arenaW * PX_PER_UNIT; x += 80) g.lineTo(x, y + Math.sin(x * 0.01 + k) * 8);
  }
  g.stroke();
  for (let i = 0; i < Math.round(arenaW / 12); i++) {
    const x = (hash01(i, 97) * 0.8 + 0.1) * arenaW * PX_PER_UNIT;
    const y = groundY + (0.3 + hash01(i, 98) * 0.5) * B.groundH;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(x, y, 13, 6, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(160,180,170,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -2; k <= 2; k++) {
      g.moveTo(x + k * 4, y - 4);
      g.lineTo(x + k * 4, y + 4);
    }
    g.stroke();
  }
}

// ─────────────────────────── 옥상·이계 ───────────────────────────

function wallRooftop(B: Bake): void {
  const { g, groundY, arenaW, wPx } = B;
  // purple night sky with a warped skyline (the city bends as if seen through water)
  const sg = g.createLinearGradient(0, 0, 0, groundY);
  sg.addColorStop(0, '#0d0620');
  sg.addColorStop(0.55, '#2a1150');
  sg.addColorStop(1, '#4a1d6e');
  g.fillStyle = sg;
  g.fillRect(0, 0, wPx, groundY);
  // stars
  g.fillStyle = 'rgba(255,240,255,0.7)';
  for (let i = 0; i < arenaW * 3; i++) g.fillRect(hash01(i, 131) * wPx, hash01(i, 132) * groundY * 0.6, 1.5, 1.5);
  // the skyline: towers whose tops lean and stretch
  for (let i = 0; i < arenaW * 1.2; i++) {
    const x = (i / (arenaW * 1.2)) * wPx + hash01(i, 141) * 20;
    const w = 18 + hash01(i, 142) * 34;
    const h = 22 + hash01(i, 143) * 50;
    const lean = Math.sin(i * 0.7) * 10;
    g.fillStyle = hash01(i, 144) < 0.5 ? '#1a1030' : '#22143a';
    g.beginPath();
    g.moveTo(x, groundY - 18);
    g.lineTo(x + lean, groundY - 18 - h);
    g.quadraticCurveTo(x + w / 2 + lean * 1.6, groundY - 26 - h, x + w + lean, groundY - 18 - h);
    g.lineTo(x + w, groundY - 18);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,214,120,0.35)';
    for (let k = 0; k < 4; k++) {
      if (hash01(i, 150 + k) < 0.5) continue;
      const wy = groundY - 24 - hash01(i, 160 + k) * (h - 10);
      const wxx = x + 4 + hash01(i, 170 + k) * (w - 8) + lean * (1 - (groundY - 18 - wy) / h) * 0.5;
      g.fillRect(wxx, wy, 2.5, 3);
    }
  }
  if (B.boss) {
    // the rift: a tear in the sky behind the boss
    const cx = (arenaW / 2) * PX_PER_UNIT;
    const rg = g.createLinearGradient(0, 0, 0, groundY);
    rg.addColorStop(0, 'rgba(255,90,200,0)');
    rg.addColorStop(0.6, 'rgba(160,60,255,0.35)');
    rg.addColorStop(1, 'rgba(255,90,200,0.5)');
    g.fillStyle = rg;
    g.beginPath();
    g.moveTo(cx - 260, groundY);
    g.quadraticCurveTo(cx - 60, groundY - 110, cx, 0);
    g.quadraticCurveTo(cx + 60, groundY - 110, cx + 260, groundY);
    g.closePath();
    g.fill();
  }
  // parapet with railings, AC units, cables, a water tank
  g.fillStyle = '#3d3748';
  g.fillRect(0, groundY - 18, wPx, 18);
  g.fillStyle = '#4c4558';
  g.fillRect(0, groundY - 20, wPx, 3);
  g.strokeStyle = '#5a536a';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, groundY - 46);
  g.lineTo(wPx, groundY - 46);
  for (let x = 10; x < wPx; x += 26) {
    g.moveTo(x, groundY - 46);
    g.lineTo(x, groundY - 20);
  }
  g.stroke();
  for (let wx = 3; wx < arenaW; wx += LIGHT_STEP) {
    if (bossSpan(B, wx, 7)) continue;
    const x = wx * PX_PER_UNIT - 30;
    // condenser box (the fan itself is animated)
    g.fillStyle = '#6c6f7a';
    g.fillRect(x - 20, groundY - 44, 40, 34);
    g.fillStyle = '#585b66';
    g.fillRect(x - 20, groundY - 14, 40, 4);
    g.fillStyle = '#23242a';
    g.beginPath();
    g.arc(x, groundY - 26, 13, 0, TAU);
    g.fill();
    // cable bundle snaking down to the floor
    g.strokeStyle = '#191720';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + 20, groundY - 30);
    g.bezierCurveTo(x + 40, groundY - 30, x + 30, groundY - 4, x + 60, groundY - 2);
    g.stroke();
    // post for the aviation lamp
    g.fillStyle = '#4c4558';
    g.fillRect(wx * PX_PER_UNIT + 32, GROUND_TOP - BAND_TOP - 32, 4, 30);
  }
  for (let wx = 9; wx < arenaW; wx += 18) {
    if (bossSpan(B, wx, 7)) continue;
    const x = wx * PX_PER_UNIT;
    g.fillStyle = '#4a4f5c';
    g.fillRect(x - 26, groundY - 92, 52, 46);
    g.fillStyle = '#3c404b';
    g.fillRect(x - 30, groundY - 96, 60, 6);
    g.strokeStyle = '#2c2f37';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 22, groundY - 46);
    g.lineTo(x - 22, groundY - 20);
    g.moveTo(x + 22, groundY - 46);
    g.lineTo(x + 22, groundY - 20);
    g.stroke();
  }
}

function floorRooftop(B: Bake): void {
  const { g, groundY, arenaW, arenaH } = B;
  // 3×3 concrete slabs with expansion joints, cracks, puddles that hold the purple sky
  const tile = 3;
  for (let ty = 0; ty < arenaH; ty += tile) {
    for (let tx = 0; tx < arenaW; tx += tile) {
      const v = hash01(tx, ty, 5);
      g.fillStyle = v < 0.5 ? B.p.tileA : B.p.tileB;
      g.fillRect(tx * PX_PER_UNIT, groundY + ty * PX_PER_UNIT_Y, tile * PX_PER_UNIT, Math.min(tile, arenaH - ty) * PX_PER_UNIT_Y);
    }
  }
  groutGrid(B, tile, tile, '#25222c', 3);
  // speckle
  g.fillStyle = 'rgba(255,255,255,0.04)';
  const n = Math.round(arenaW * arenaH * 1.2);
  for (let i = 0; i < n; i++) g.fillRect(hash01(i, 181) * arenaW * PX_PER_UNIT, groundY + hash01(i, 182) * B.groundH, 2, 1.5);
  g.strokeStyle = B.p.crack;
  g.lineWidth = 1.6;
  g.beginPath();
  const nc = Math.round(arenaW * arenaH * 0.08);
  for (let i = 0; i < nc; i++) {
    let x = hash01(i, 11) * arenaW * PX_PER_UNIT;
    let y = groundY + hash01(i, 12) * B.groundH;
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (hash01(i, 20 + s) - 0.5) * 34;
      y += (hash01(i, 30 + s) - 0.5) * 12;
      g.lineTo(x, y);
    }
  }
  g.stroke();
  for (let i = 0; i < Math.round(arenaW / 6); i++) {
    const x = hash01(i, 191) * arenaW * PX_PER_UNIT;
    const y = groundY + (0.2 + hash01(i, 192) * 0.7) * B.groundH;
    g.fillStyle = 'rgba(150,90,230,0.12)';
    g.beginPath();
    g.ellipse(x, y, 30 + hash01(i, 193) * 40, 9 + hash01(i, 194) * 5, 0, 0, TAU);
    g.fill();
  }
  // faded yellow walkway lines
  g.strokeStyle = 'rgba(220,190,60,0.16)';
  g.lineWidth = 5;
  g.setLineDash([26, 18]);
  g.beginPath();
  g.moveTo(0, groundY + B.groundH * 0.18);
  g.lineTo(arenaW * PX_PER_UNIT, groundY + B.groundH * 0.18);
  g.stroke();
  g.setLineDash(NO_DASH);
}

// ─────────────────────────── shared ───────────────────────────

function groutGrid(B: Bake, stepX: number, stepY: number, color: string, width: number): void {
  const { g, groundY, groundH, arenaW, arenaH } = B;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  for (let tx = 0; tx <= arenaW + 1e-6; tx += stepX) {
    g.moveTo(tx * PX_PER_UNIT, groundY);
    g.lineTo(tx * PX_PER_UNIT, groundY + groundH);
  }
  for (let ty = 0; ty <= arenaH + 1e-6; ty += stepY) {
    g.moveTo(0, groundY + ty * PX_PER_UNIT_Y);
    g.lineTo(arenaW * PX_PER_UNIT, groundY + ty * PX_PER_UNIT_Y);
  }
  g.stroke();
}

/** Boss floors: a faint emblem in the zone accent in the middle of the arena (elevator hall seal, stamp, lamp ring, rune). */
function bossEmblem(B: Bake): void {
  const { g, groundY, arenaW, arenaH, p } = B;
  const cx = (arenaW / 2) * PX_PER_UNIT;
  const cy = groundY + (arenaH / 2) * PX_PER_UNIT_Y;
  g.globalAlpha = 0.16;
  g.strokeStyle = p.accent;
  g.lineWidth = 3;
  for (const r of [4.5, 6]) {
    g.beginPath();
    g.ellipse(cx, cy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
    g.stroke();
  }
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.moveTo(cx + Math.cos(a) * 4.6 * PX_PER_UNIT, cy + Math.sin(a) * 4.6 * PX_PER_UNIT_Y);
    g.lineTo(cx + Math.cos(a) * 5.9 * PX_PER_UNIT, cy + Math.sin(a) * 5.9 * PX_PER_UNIT_Y);
  }
  g.stroke();
  g.globalAlpha = 1;
}

/** Depth shading: darker at the back, slightly darker at the front edge (keeps the field low-contrast). */
function shadeFloor(B: Bake): void {
  const { g, groundY, groundH, wPx } = B;
  const dg = g.createLinearGradient(0, groundY, 0, groundY + groundH);
  dg.addColorStop(0, 'rgba(0,0,0,0.35)');
  dg.addColorStop(0.25, 'rgba(0,0,0,0.0)');
  dg.addColorStop(0.85, 'rgba(0,0,0,0.0)');
  dg.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = dg;
  g.fillRect(0, groundY, wPx, groundH);
}

/** Front lip + the drop below it (a floor slab edge; the rooftop gets its low parapet), then the arena border. */
function frontEdge(B: Bake, zone: FloorTheme): void {
  const { g, groundY, groundH, wPx, p } = B;
  const lipY = groundY + groundH;
  g.fillStyle = p.lip;
  g.fillRect(0, lipY - 2, wPx, 4);
  const cg = g.createLinearGradient(0, lipY + 2, 0, lipY + CLIFF_H);
  cg.addColorStop(0, p.cliff);
  cg.addColorStop(1, p.voidBottom);
  g.fillStyle = cg;
  g.fillRect(0, lipY + 2, wPx, CLIFF_H - 2);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  if (zone === 'rooftop') {
    // building facade falling away: rows of dark windows
    for (let x = 8; x < wPx; x += 30) {
      g.moveTo(x, lipY + 8);
      g.lineTo(x, lipY + CLIFF_H - 6);
    }
    g.moveTo(0, lipY + 20);
    g.lineTo(wPx, lipY + 20);
  } else {
    // the slab's broken underside: rebar and torn ceiling tiles
    for (let x = 12; x < wPx; x += 26 + hash01(x, 5) * 30) {
      g.moveTo(x, lipY + 4);
      g.lineTo(x + (hash01(x, 6) - 0.5) * 10, lipY + 14 + hash01(x, 8) * 22);
    }
  }
  g.stroke();
  g.strokeStyle = p.border;
  g.lineWidth = 2;
  g.strokeRect(1, groundY + 1, wPx - 2, groundH - 2);
}

/** Small spinning condenser fan (rooftop, animated). */
function drawFan(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number): void {
  ctx.fillStyle = '#8b8e99';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = ang + (i * TAU) / 3;
    ctx.moveTo(x, y);
    ctx.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.5, r * 0.22, a, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = '#2b2d33';
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, TAU);
  ctx.fill();
}
