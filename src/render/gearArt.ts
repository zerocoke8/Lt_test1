// 기획 15차 원정: gear pictures — the file override slot and the code-drawn icons / dolls (docs/expedition.md 9-6).
// Drop `src/assets/gear/<name>.png` (names: docs/gear-art-prompts.md 6장) and menus use that picture; otherwise the code
// icon. The battle hand keeps the code weapon unless the debug 「장비 그림: 코드 / 파일」 says 파일. An empty folder builds
// to {} (both builds); the single-file artifact inlines whatever files exist (same as src/audio/files).

import type { GearBand, GearBands, GearSlot, WeaponFamily } from '../data/gear';
import { WEAPON_FAMILIES, bandOf, relicIndex } from '../data/gear';
import { RELICS } from '../data/relics';
import { DIAGONAL_FAMILIES, GEAR_HAND, drawGearArmor, drawGearCharm, drawRelicBadge, weaponAxis, drawGearWeapon } from './gear';
import { unitLook } from './look';
import { pathCapsule } from './shapes';
import { HERO_POSE, drawBody } from './units';

/** Bundled files: '../assets/gear/<name>.png' → url (data: URI in the single-file build). Empty folder → {}. */
const FILES = import.meta.glob('../assets/gear/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Every picture name the game looks for (52: 9 weapon families × 4 bands + 4 armor + 4 charms + 8 relics). */
export function gearArtNames(): string[] {
  const out: string[] = [];
  for (const f of WEAPON_FAMILIES) for (let b = 1; b <= 4; b++) out.push(`gear-weapon-${f}-b${b}`);
  for (let b = 1; b <= 4; b++) out.push(`gear-armor-b${b}`);
  for (let b = 1; b <= 4; b++) out.push(`gear-charm-b${b}`);
  for (const r of RELICS) out.push(`gear-relic-${r.id}`);
  return out;
}

/** The picture name of a piece (weapon: by the wearer's family; relic: by its id). */
export function gearArtName(slot: GearSlot, family: WeaponFamily | null, band: number, relicId?: string): string {
  const b = Math.max(1, Math.min(4, Math.floor(band) || 1));
  if (slot === 'relic') return `gear-relic-${relicId ?? ''}`;
  if (slot === 'weapon') return `gear-weapon-${family ?? 'sword'}-b${b}`;
  return `gear-${slot}-b${b}`;
}

/** name → url from a glob result; unknown names are reported (console warning in the game, a test checks the list). */
export function buildArtTable(files: Record<string, string>, known: readonly string[] = gearArtNames()): { table: Map<string, string>; unknown: string[] } {
  const ok = new Set(known);
  const table = new Map<string, string>();
  const unknown: string[] = [];
  for (const [path, url] of Object.entries(files)) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/i, '');
    if (ok.has(name)) table.set(name, url);
    else unknown.push(name);
  }
  return { table, unknown };
}

const ART = buildArtTable(FILES);
if (ART.unknown.length && typeof console !== 'undefined') console.warn(`[gear art] 이름이 목록에 없는 그림 파일: ${ART.unknown.join(', ')} (docs/gear-art-prompts.md 6장)`);

export function gearArtUrl(name: string): string | undefined {
  return ART.table.get(name);
}

export function gearArtCount(): number {
  return ART.table.size;
}

// ─────────────────────────── battle hand: 「장비 그림: 코드 / 파일」 (debug, this device) ───────────────────────────

const handImages = new Map<string, HTMLImageElement | null>();

/** On: weapons in battle use the picture file when one exists (loaded once); off (default): the code drawing. */
export function setBattleGearFiles(on: boolean): void {
  GEAR_HAND.picture = on ? handPicture : null;
}

export function battleGearFiles(): boolean {
  return GEAR_HAND.picture != null;
}

function handPicture(fam: WeaponFamily, band: GearBand): CanvasImageSource | null {
  const name = gearArtName('weapon', fam, band);
  if (!handImages.has(name)) {
    const url = gearArtUrl(name);
    if (!url || typeof Image === 'undefined') handImages.set(name, null);
    else {
      const img = new Image();
      img.src = url;
      handImages.set(name, img);
    }
  }
  const img = handImages.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

// ─────────────────────────── code icons ───────────────────────────

const iconCache = new Map<string, string>();

function canvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** The painted box of a canvas (alpha > 8), or null when empty. */
function paintedBox(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  let d: Uint8ClampedArray;
  try {
    d = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch {
    return null;
  }
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Draw `paint` big on a scratch canvas, then fit its painted part into px × px (80 %), centred. */
function fitted(px: number, paint: (ctx: CanvasRenderingContext2D, S: number) => void): string {
  const S = Math.max(96, px * 3);
  const big = canvas(S, S);
  const out = canvas(px, px);
  const bctx = big?.getContext('2d');
  const octx = out?.getContext('2d');
  if (!big || !out || !bctx || !octx) return '';
  paint(bctx, S);
  const box = paintedBox(big);
  if (box) {
    const k = (px * 0.8) / Math.max(box.w, box.h);
    const w = box.w * k;
    const h = box.h * k;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(big, box.x, box.y, box.w, box.h, (px - w) / 2, (px - h) / 2, w, h);
  }
  try {
    return out.toDataURL('image/png');
  } catch {
    return '';
  }
}

/** A neutral stand-in body (armor icon) — the dark mannequin the vest sits on. */
const MANNEQUIN = '#3a4150';

/**
 * Code icon of a piece as a data URL (cached by 'slot-family-band-relic-px'): the same drawing functions as battle,
 * weapons lying at 45° (long ones) or upright, armor on a dark mannequin torso, the charm alone, the relic badge.
 */
export function gearIcon(slot: GearSlot, family: WeaponFamily | null, band: GearBand, relicId: string | undefined, px: number): string {
  const key = `${slot}-${family ?? '-'}-${band}-${relicId ?? '-'}-${px}`;
  const hit = iconCache.get(key);
  if (hit != null) return hit;
  const b = (Math.max(1, Math.min(4, band)) as GearBand);
  const url = fitted(px, (ctx, S) => {
    const w = S * 0.32;
    const h = w * 1.3;
    const fx = S * 0.42;
    const fy = S * 0.72;
    if (slot === 'weapon') {
      const fam = family ?? 'sword';
      const ax = weaponAxis(fam, fx, fy, w, h, 1);
      ctx.save();
      if (DIAGONAL_FAMILIES.has(fam)) {
        const cx = (ax.gx + ax.tx) / 2;
        const cy = (ax.gy + ax.ty) / 2;
        const now = Math.atan2(ax.ty - ax.gy, ax.tx - ax.gx);
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 4 - now);
        ctx.translate(-cx, -cy);
      }
      drawGearWeapon(ctx, fam, b, fx, fy, w, h, 1, 0.6, false, 1, '#1b2030', '#6c7a96');
      ctx.restore();
    } else if (slot === 'armor') {
      // a dark mannequin cut at the neck, wearing the armor
      const ww = S * 0.46;
      const hh = ww * 1.3;
      const y = S * 0.9;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y - hh * 0.72, S, S);
      ctx.clip();
      pathCapsule(ctx, S / 2, y, ww, hh);
      ctx.fillStyle = MANNEQUIN;
      ctx.fill();
      ctx.restore();
      drawGearArmor(ctx, b, S / 2, y, ww, hh, 1, 0.5, 1);
    } else if (slot === 'charm') {
      const ww = S * 0.9;
      drawGearCharm(ctx, b, S * 0.5 + 0.4 * ww, S * 0.3 + 0.27 * ww, ww, ww, 1, 0, 1);
    } else {
      drawRelicBadge(ctx, relicIndex(relicId) || 1, b, S / 2, S / 2, S * 0.3);
    }
  });
  iconCache.set(key, url);
  return url;
}

/** Menu picture of a piece: the file when one exists, else the code icon. */
export function gearPicture(slot: GearSlot, family: WeaponFamily | null, tier: number, relicId: string | undefined, px: number): string {
  const band = bandOf(tier) || 1;
  return gearArtUrl(gearArtName(slot, family, band, relicId)) ?? gearIcon(slot, family, band as GearBand, relicId, px);
}

// ─────────────────────────── dolls (menus) ───────────────────────────

/** Draw a character with its gear standing on (cx, footY), body width w — the battle drawing, only bigger. */
export function drawHeroDoll(
  ctx: CanvasRenderingContext2D,
  charId: string,
  bands: GearBands | null,
  cx: number,
  footY: number,
  w: number,
  time: number,
  pose: { swing?: number; breathe?: number } = {},
): void {
  const look = unitLook('character', charId);
  const breathe = pose.breathe ?? Math.sin(time * 2.2) * 0.025;
  const h = w * look.heightMul * (1 + breathe);
  // ground shadow
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cx, footY + w * 0.02, w * 0.62, w * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  HERO_POSE.swing = pose.swing ?? 0;
  drawBody(ctx, look, 'character', cx, footY, w * (1 - breathe * 0.5), h, 1, time, 0.4, false, bands, 1);
  HERO_POSE.swing = 0;
}
