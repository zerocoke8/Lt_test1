// Background + ground. The static part (wall, tiles, cliff) is baked once per floor into an offscreen
// canvas at backing-store resolution and blitted with the camera offset every frame.

import { LOGICAL_H, LOGICAL_W } from '../types';
import { Camera, GROUND_TOP, PX_PER_UNIT, PX_PER_UNIT_Y } from './camera';
import { hash01 } from './shapes';

interface Theme {
  voidTop: string;
  voidBottom: string;
  wall: string;
  wallLine: string;
  pillar: string;
  tileA: string;
  tileB: string;
  grout: string;
  crack: string;
  lip: string;
  cliff: string;
  border: string;
  light: string;
}

const NORMAL_THEMES: Theme[] = [
  // 푸른 석재
  { voidTop: '#07080d', voidBottom: '#0b0d14', wall: '#1f2638', wallLine: '#161b29', pillar: '#2b3449', tileA: '#3a4359', tileB: '#333b50', grout: '#272d3e', crack: '#252a39', lip: '#66708e', cliff: '#171b27', border: 'rgba(190,210,255,0.22)', light: '#ffb347' },
  // 이끼 낀 석재
  { voidTop: '#060906', voidBottom: '#0a0e0b', wall: '#1e2a22', wallLine: '#151e18', pillar: '#2b3a2f', tileA: '#3b4a3d', tileB: '#344236', grout: '#28332a', crack: '#232c25', lip: '#6b7f68', cliff: '#151c16', border: 'rgba(200,255,200,0.2)', light: '#ffc65c' },
  // 붉은 벽돌
  { voidTop: '#0c0807', voidBottom: '#110c0b', wall: '#2e2220', wallLine: '#221816', pillar: '#3d2e2a', tileA: '#4a3d36', tileB: '#433730', grout: '#352a25', crack: '#2e2420', lip: '#8a7466', cliff: '#1c1513', border: 'rgba(255,220,190,0.2)', light: '#ff9f43' },
];

const BOSS_THEME: Theme = {
  voidTop: '#05030a',
  voidBottom: '#0a0612',
  wall: '#140c22',
  wallLine: '#0d0817',
  pillar: '#22163a',
  tileA: '#2e2542',
  tileB: '#28203b',
  grout: '#1f182f',
  crack: '#3d2a5c',
  lip: '#6d5a99',
  cliff: '#120c1d',
  border: 'rgba(200,170,255,0.25)',
  light: '#b388ff',
};

/** Screen band baked into the cache (logical px). */
const BAND_TOP = 40;
const BACK_WALL_H = GROUND_TOP - BAND_TOP;
const CLIFF_H = 46;

export class Backdrop {
  private cache: HTMLCanvasElement | null = null;
  private key = '';
  private scale = 1;
  private arenaW = 24;
  private arenaH = 12;
  private boss = false;
  private theme: Theme = NORMAL_THEMES[0];
  private bandBottom = 0;
  private voidGrad: CanvasGradient | null = null;
  private voidGradCtx: CanvasRenderingContext2D | null = null;
  private voidGradKey = '';

  ensure(arenaW: number, arenaH: number, boss: boolean, floor: number, scale: number): void {
    const key = `${arenaW}x${arenaH}:${boss ? 'b' : 'n'}:${boss ? 0 : (floor - 1) % NORMAL_THEMES.length}:${scale}`;
    if (key === this.key && this.cache) return;
    this.key = key;
    this.arenaW = arenaW;
    this.arenaH = arenaH;
    this.boss = boss;
    this.scale = scale;
    this.theme = boss ? BOSS_THEME : NORMAL_THEMES[(((floor - 1) % NORMAL_THEMES.length) + NORMAL_THEMES.length) % NORMAL_THEMES.length];
    this.bandBottom = GROUND_TOP + arenaH * PX_PER_UNIT_Y + CLIFF_H;
    this.bake();
  }

  private bake(): void {
    if (typeof document === 'undefined') return;
    const t = this.theme;
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
    const groundY = GROUND_TOP - BAND_TOP; // local y of world y = 0
    const groundH = this.arenaH * PX_PER_UNIT_Y;

    // ── back wall / abyss ──
    if (!this.boss) {
      const wg = g.createLinearGradient(0, 0, 0, groundY);
      wg.addColorStop(0, t.voidBottom);
      wg.addColorStop(0.35, t.wall);
      wg.addColorStop(1, t.wall);
      g.fillStyle = wg;
      g.fillRect(0, 0, wPx, groundY);
      // brick rows
      g.strokeStyle = t.wallLine;
      g.lineWidth = 2;
      const rowH = 18;
      for (let row = 0, y = groundY - rowH; y > 10; row++, y -= rowH) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(wPx, y);
        const off = row % 2 === 0 ? 0 : 22;
        for (let x = off; x < wPx; x += 44) {
          g.moveTo(x, y);
          g.lineTo(x, y + rowH);
        }
        g.stroke();
      }
      // pillars every 6 units
      for (let wx = 3; wx < this.arenaW; wx += 6) {
        const x = wx * PX_PER_UNIT;
        g.fillStyle = t.pillar;
        g.fillRect(x - 16, 6, 32, groundY - 6);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x - 16, 6, 6, groundY - 6);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + 10, 6, 6, groundY - 6);
        // sconce
        g.fillStyle = '#3a2f25';
        g.fillRect(x - 6, groundY - 62, 12, 8);
      }
      // floor shadow line at the wall base
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, groundY - 6, wPx, 6);
    } else {
      const ag = g.createLinearGradient(0, 0, 0, groundY);
      ag.addColorStop(0, t.voidTop);
      ag.addColorStop(0.6, '#1a0d2e');
      ag.addColorStop(1, '#2a1350');
      g.fillStyle = ag;
      g.fillRect(0, 0, wPx, groundY);
      // jagged rock rim in front of the abyss
      g.fillStyle = t.wall;
      g.beginPath();
      g.moveTo(0, groundY);
      for (let x = 0; x <= wPx; x += 24) {
        const hgt = 10 + hash01(x, 7) * 26;
        g.lineTo(x, groundY - hgt);
      }
      g.lineTo(wPx, groundY);
      g.closePath();
      g.fill();
    }

    // ── ground tiles (2×2 units) ──
    const tile = 2;
    for (let ty = 0; ty < this.arenaH; ty += tile) {
      for (let tx = 0; tx < this.arenaW; tx += tile) {
        const x0 = tx * PX_PER_UNIT;
        const y0 = groundY + ty * PX_PER_UNIT_Y;
        const w = tile * PX_PER_UNIT;
        const h = Math.min(tile, this.arenaH - ty) * PX_PER_UNIT_Y;
        g.fillStyle = ((tx + ty) / tile) % 2 === 0 ? t.tileA : t.tileB;
        g.fillRect(x0, y0, w, h);
        const v = hash01(tx, ty, 3);
        if (v > 0.55) {
          g.fillStyle = v > 0.8 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
          g.fillRect(x0, y0, w, h);
        }
      }
    }
    // grout
    g.strokeStyle = t.grout;
    g.lineWidth = 2;
    g.beginPath();
    for (let tx = 0; tx <= this.arenaW; tx += tile) {
      g.moveTo(tx * PX_PER_UNIT, groundY);
      g.lineTo(tx * PX_PER_UNIT, groundY + groundH);
    }
    for (let ty = 0; ty <= this.arenaH; ty += tile) {
      g.moveTo(0, groundY + ty * PX_PER_UNIT_Y);
      g.lineTo(wPx, groundY + ty * PX_PER_UNIT_Y);
    }
    g.stroke();
    // cracks + pebbles
    g.strokeStyle = t.crack;
    g.lineWidth = this.boss ? 2 : 1.5;
    g.beginPath();
    const n = Math.round(this.arenaW * this.arenaH * 0.12);
    for (let i = 0; i < n; i++) {
      let x = hash01(i, 11) * wPx;
      let y = groundY + hash01(i, 12) * groundH;
      g.moveTo(x, y);
      const segs = 2 + Math.floor(hash01(i, 13) * 3);
      for (let s = 0; s < segs; s++) {
        x += (hash01(i, 20 + s) - 0.5) * 30;
        y += (hash01(i, 30 + s) - 0.5) * 12;
        g.lineTo(x, y);
      }
    }
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < n; i++) {
      const x = hash01(i, 41) * wPx;
      const y = groundY + hash01(i, 42) * groundH;
      g.beginPath();
      g.ellipse(x, y, 2 + hash01(i, 43) * 3, 1 + hash01(i, 44) * 1.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (this.boss) {
      // glowing runes ring in the middle of the boss arena
      g.strokeStyle = 'rgba(179,136,255,0.18)';
      g.lineWidth = 3;
      const cx = (this.arenaW / 2) * PX_PER_UNIT;
      const cy = groundY + (this.arenaH / 2) * PX_PER_UNIT_Y;
      for (const r of [4.5, 6]) {
        g.beginPath();
        g.ellipse(cx, cy, r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // depth shading: darker at the back, slightly darker at the front edge
    const dg = g.createLinearGradient(0, groundY, 0, groundY + groundH);
    dg.addColorStop(0, 'rgba(0,0,0,0.35)');
    dg.addColorStop(0.25, 'rgba(0,0,0,0.0)');
    dg.addColorStop(0.85, 'rgba(0,0,0,0.0)');
    dg.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = dg;
    g.fillRect(0, groundY, wPx, groundH);

    // ── front lip + cliff ──
    const lipY = groundY + groundH;
    g.fillStyle = t.lip;
    g.fillRect(0, lipY - 2, wPx, 4);
    const cg = g.createLinearGradient(0, lipY + 2, 0, lipY + CLIFF_H);
    cg.addColorStop(0, t.cliff);
    cg.addColorStop(1, t.voidBottom);
    g.fillStyle = cg;
    g.fillRect(0, lipY + 2, wPx, CLIFF_H - 2);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 12; x < wPx; x += 26 + hash01(x, 5) * 30) {
      g.moveTo(x, lipY + 4);
      g.lineTo(x + (hash01(x, 6) - 0.5) * 10, lipY + 14 + hash01(x, 8) * 22);
    }
    g.stroke();

    // arena bounds
    g.strokeStyle = t.border;
    g.lineWidth = 2;
    g.strokeRect(1, groundY + 1, wPx - 2, groundH - 2);
  }

  /** Draws the void + baked band + animated lights. `highlight` brightens the arena bounds (while dragging). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, time: number, highlight: boolean): void {
    const t = this.theme;
    // void
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
    if (this.cache) {
      if (sx1 > sx0) {
        ctx.drawImage(
          this.cache,
          sx0 * this.scale,
          0,
          (sx1 - sx0) * this.scale,
          hPx * this.scale,
          dx + sx0,
          BAND_TOP,
          sx1 - sx0,
          hPx,
        );
      }
    }

    // animated lights
    if (!this.boss) {
      for (let wx = 3; wx < this.arenaW; wx += 6) {
        if (!cam.visibleX(wx, 1)) continue;
        const x = cam.sx(wx);
        const y = GROUND_TOP - 62;
        const f = 0.75 + 0.25 * Math.sin(time * 11 + wx * 1.7) * Math.sin(time * 7.3 + wx);
        ctx.globalAlpha = 0.16 * f;
        ctx.fillStyle = t.light;
        ctx.beginPath();
        ctx.ellipse(x, y + 4, 46 * f, 34 * f, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = t.light;
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.quadraticCurveTo(x, y - 18 * f, x + 5, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.ellipse(x, y - 3, 2, 4 * f, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // abyss glow breathing behind the rim (stacked ellipses fake a radial falloff)
      const p = 0.5 + 0.5 * Math.sin(time * 1.3);
      const cx = cam.sx(this.arenaW / 2);
      ctx.fillStyle = t.light;
      for (let i = 0; i < 4; i++) {
        const k = 1 - i * 0.22;
        ctx.globalAlpha = 0.05 + 0.03 * p;
        ctx.beginPath();
        ctx.ellipse(cx, GROUND_TOP - 22, 560 * k, (54 + 10 * p) * k, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

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
}

const DASH = [10, 8];
const NO_DASH: number[] = [];
