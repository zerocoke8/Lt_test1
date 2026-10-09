// 기획 15차 원정: gear drawn on a hero (docs/expedition.md 9장) — the held weapon by band, armor on the torso, a charm at
// the waist and the equipped relic orbiting the head. Battle and menus use these same functions (menus only scale up),
// so a character looks the same everywhere. No gear ⇒ units.ts never calls into this file (classic: not one pixel moves).
// Budget (9-1): glow = one translucent thick stroke (never shadowBlur), ≤ 15 extra paths per hero, the outline grows at
// most +30 % of the body width, no red but the band-3 talisman ink line. Other players' glow is drawn × OTHER_PLAYER_FX.

import type { GearBand, GearBands, WeaponFamily } from '../data/gear';
import { TAU, pathCapsule, pathRoundRect } from './shapes';

export interface BandStyle {
  /** Blade / head / plate. */
  metal: string;
  /** Outline of metal parts (b2 cyan edge, b3 violet, b4 gold). */
  edge: string;
  /** Handles, bow limbs, lute body. */
  wood: string;
  /** Orb / bead / gem. */
  gem: string;
  /** Band colour (BAND_COLOR). */
  accent: string;
  /** Held prop size × (1.0 / 1.1 / 1.2 / 1.3). */
  scale: number;
  /** Translucent halo strength (0 = none). */
  glow: number;
}

/** Index = band (0 unused). */
export const BAND_STYLE: readonly BandStyle[] = [
  { metal: '#cfd8e3', edge: '#3d4650', wood: '#7a5230', gem: '#fff3b0', accent: '#ffffff', scale: 1, glow: 0 },
  { metal: '#a39d91', edge: '#4a4640', wood: '#6b4a2b', gem: '#c9c2b0', accent: '#adb5bd', scale: 1, glow: 0 },
  { metal: '#e6edf5', edge: '#2aa7d6', wood: '#2b3440', gem: '#4cc9f0', accent: '#4cc9f0', scale: 1.1, glow: 0 },
  { metal: '#f7f3ea', edge: '#9b5de5', wood: '#e9e2d0', gem: '#e9d5ff', accent: '#c77dff', scale: 1.2, glow: 0.32 },
  { metal: '#231a2e', edge: '#ffd166', wood: '#1a1322', gem: '#c77dff', accent: '#ffd166', scale: 1.3, glow: 0.4 },
];

/** Relic icon aura colours by RELICS index 1..8 (docs/gear-art-prompts.md 6장). */
export const RELIC_AURA: readonly string[] = ['', '#90e0ef', '#ffb703', '#4cc9f0', '#a7c957', '#ffd166', '#74c69d', '#c77dff', '#b388ff'];

const IVORY = '#f3ead2';
const INK = '#c1121f';
const GOLD = '#ffd166';
const VIOLET = '#9d4edd';

export function bandStyle(band: number): BandStyle {
  return BAND_STYLE[Math.max(0, Math.min(4, Math.floor(band)))] ?? BAND_STYLE[0];
}

/** Long props lie at 45° in the item icon (gear-art-prompts.md 3장); the others stand upright. */
export const DIAGONAL_FAMILIES: ReadonlySet<WeaponFamily> = new Set(['sword', 'axe', 'bow', 'staff', 'hammer']);

// ─────────────────────────── weapon (9-2) ───────────────────────────

/**
 * 기획 15차 9-6: the debug 「장비 그림: 파일」 setting puts a loaded picture (src/assets/gear) in the battle hand instead of
 * the code weapon (render/gearArt.ts sets `picture`; null = code drawing, the default). Long pictures are drawn at 45°
 * with the grip at (28 %, 72 %) of the picture on the hand.
 */
export const GEAR_HAND: { picture: ((fam: WeaponFamily, band: GearBand) => CanvasImageSource | null) | null } = { picture: null };

function drawHandPicture(ctx: CanvasRenderingContext2D, img: CanvasImageSource, fam: WeaponFamily, hx: number, hy: number, h: number, s: number): void {
  const L = h * 0.95;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(s, 1);
  if (DIAGONAL_FAMILIES.has(fam)) ctx.drawImage(img, -L * 0.28, -L * 0.72, L, L);
  else ctx.drawImage(img, -L * 0.5, -L * 0.5, L * 0.8, L * 0.8);
  ctx.restore();
}

interface Axis {
  gx: number;
  gy: number;
  tx: number;
  ty: number;
}

/** Grip → tip of the held prop in the battle pose (hand at hx, hy; staff / orb stand on the ground at fy). */
export function weaponAxis(fam: WeaponFamily, fx: number, fy: number, w: number, h: number, s: number): Axis {
  const hx = fx + s * w * 0.5;
  const hy = fy - h * 0.42;
  switch (fam) {
    case 'sword':
      return { gx: hx - s * 4, gy: hy + 4, tx: hx + s * w * 0.42, ty: hy - h * 0.48 };
    case 'axe':
      return { gx: hx - s * 2, gy: hy + h * 0.15, tx: hx + s * w * 0.2, ty: hy - h * 0.45 };
    case 'hammer':
      return { gx: hx - s * 2, gy: hy + h * 0.18, tx: hx + s * w * 0.12, ty: hy - h * 0.46 };
    case 'orb':
    case 'staff':
      return { gx: hx, gy: fy - 2, tx: hx, ty: fy - h * 0.98 };
    case 'bow':
      return { gx: hx - s * w * 0.1, gy: hy + h * 0.3, tx: hx - s * w * 0.1, ty: hy - h * 0.3 };
    case 'lute':
      return { gx: hx - s * w * 0.08, gy: hy + h * 0.06, tx: hx + s * w * 0.24, ty: hy - h * 0.32 };
    case 'gun':
      return { gx: hx - s * w * 0.05, gy: hy + h * 0.02, tx: hx + s * w * 0.42, ty: hy - h * 0.04 };
    case 'shield':
    default:
      return { gx: hx, gy: hy + h * 0.26, tx: hx, ty: hy - h * 0.26 };
  }
}

/**
 * The held weapon of a geared hero, drawn instead of the classic prop (units.ts heroAccessoryAt). Same silhouette per
 * family, band colours, scaled about the hand, plus band extras: b2 cyan edge, b3 violet halo + fluttering talisman,
 * b4 gold pulse + violet eye at the tip + two orbiting sparks. `fxa` scales the halo (other players' units: dimmer).
 */
export function drawGearWeapon(
  ctx: CanvasRenderingContext2D,
  fam: WeaponFamily,
  band: GearBand,
  fx: number,
  fy: number,
  w: number,
  h: number,
  s: number,
  time: number,
  flash: boolean,
  fxa: number,
  bodyDark: string,
  bodyColor: string,
): void {
  const st = bandStyle(band);
  const hx = fx + s * w * 0.5;
  const hy = fy - h * 0.42;
  ctx.save();
  if (st.scale !== 1) {
    ctx.translate(hx, hy);
    ctx.scale(st.scale, st.scale);
    ctx.translate(-hx, -hy);
  }
  const pic = GEAR_HAND.picture?.(fam, band) ?? null;
  if (pic) {
    drawHandPicture(ctx, pic, fam, hx, hy, h, s);
    ctx.restore();
    return;
  }
  const ax = weaponAxis(fam, fx, fy, w, h, s);
  if (st.glow > 0 && fxa > 0) weaponHalo(ctx, fam, ax, st, w, h, time, fxa);
  const metal = flash ? '#ffffff' : st.metal;
  ctx.lineJoin = 'round';
  switch (fam) {
    case 'shield': {
      const sw = w * 0.46;
      const sh = h * 0.52;
      pathRoundRect(ctx, hx - sw / 2, hy - sh / 2, sw, sh, sw * 0.35);
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = band >= 2 ? st.edge : bodyDark;
      ctx.stroke();
      ctx.fillStyle = band === 4 ? GOLD : band === 1 ? '#6b6358' : bodyColor;
      ctx.beginPath();
      ctx.arc(hx, hy, sw * 0.18, 0, TAU);
      ctx.fill();
      break;
    }
    case 'sword': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = st.wood;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ax.gx, ax.gy);
      ctx.lineTo(hx + s * 6, hy - 6);
      ctx.stroke();
      // the blade: an edge-coloured stroke under a metal core
      ctx.beginPath();
      ctx.moveTo(hx + s * 4, hy - 4);
      ctx.lineTo(ax.tx, ax.ty);
      ctx.strokeStyle = st.edge;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }
    case 'axe': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = st.wood;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ax.gx, ax.gy);
      ctx.lineTo(ax.tx, ax.ty);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const x = ax.tx;
      const y = hy - h * 0.4;
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.12);
      ctx.quadraticCurveTo(x + s * w * 0.45, y - h * 0.05, x + s * w * 0.1, y + h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = band >= 2 ? 2 : 1.5;
      ctx.strokeStyle = st.edge;
      ctx.stroke();
      break;
    }
    case 'bow': {
      const bx = ax.gx;
      const r = h * 0.3;
      ctx.strokeStyle = band >= 2 ? st.edge : st.wood;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      if (s > 0) ctx.arc(bx, hy, r, -1.15, 1.15);
      else ctx.arc(bx, hy, r, Math.PI - 1.15, Math.PI + 1.15);
      ctx.stroke();
      ctx.strokeStyle = flash ? '#ffffff' : band >= 2 ? st.metal : st.wood;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      const sx = bx + s * Math.cos(1.15) * r;
      ctx.strokeStyle = band === 4 ? GOLD : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, hy - Math.sin(1.15) * r);
      ctx.lineTo(sx, hy + Math.sin(1.15) * r);
      ctx.stroke();
      break;
    }
    case 'hammer': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = st.wood;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ax.gx, ax.gy);
      ctx.lineTo(hx + s * w * 0.12, hy - h * 0.42);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const mx = hx + s * w * 0.12;
      const my = hy - h * 0.46;
      pathRoundRect(ctx, mx - w * 0.2, my - h * 0.1, w * 0.4, h * 0.2, 3);
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = band >= 2 ? st.edge : bodyDark;
      ctx.stroke();
      break;
    }
    case 'gun': {
      const gx = hx - s * w * 0.05;
      const gy = hy + h * 0.02;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.scale(s, 1);
      ctx.rotate(-0.12);
      ctx.fillStyle = st.wood;
      pathRoundRect(ctx, -w * 0.12, -2, w * 0.2, h * 0.2, 2);
      ctx.fill();
      pathRoundRect(ctx, -w * 0.05, -h * 0.07, w * 0.5, h * 0.1, 2);
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = st.edge;
      ctx.stroke();
      ctx.fillStyle = band >= 3 ? st.accent : '#3d4650';
      ctx.fillRect(w * 0.4, -h * 0.09, w * 0.08, h * 0.14);
      ctx.restore();
      break;
    }
    case 'lute': {
      const lx = ax.gx;
      const ly = ax.gy;
      ctx.strokeStyle = band >= 2 ? st.edge : st.wood;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + s * w * 0.32, ly - h * 0.38);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = flash ? '#ffffff' : band === 1 ? '#b08a5a' : band === 2 ? '#d9a066' : st.metal;
      ctx.beginPath();
      ctx.ellipse(lx, ly, w * 0.2, h * 0.14, -0.6 * s, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = band >= 2 ? st.edge : '#5a3a1f';
      ctx.stroke();
      ctx.fillStyle = band === 4 ? GOLD : '#3a2412';
      ctx.beginPath();
      ctx.arc(lx, ly, w * 0.05, 0, TAU);
      ctx.fill();
      break;
    }
    case 'orb':
    case 'staff': {
      const orb = fam === 'orb';
      ctx.strokeStyle = band === 1 ? (orb ? '#4a3f52' : st.wood) : band >= 3 ? st.edge : st.wood;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, fy - 2);
      ctx.lineTo(hx, fy - h * 0.95);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const oy = fy - h * 0.98;
      ctx.fillStyle = flash ? '#ffffff' : st.gem;
      ctx.beginPath();
      ctx.arc(hx, oy, w * (orb ? 0.15 : 0.12), 0, TAU);
      ctx.fill();
      if (band >= 2) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = st.edge;
        ctx.stroke();
      }
      if (!orb) {
        ctx.strokeStyle = band >= 2 ? st.edge : '#fff3b0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx - w * 0.12, oy - w * 0.02);
        ctx.lineTo(hx + w * 0.12, oy - w * 0.02);
        ctx.stroke();
      }
      break;
    }
  }
  if (band === 3) talismanStrip(ctx, ax.gx, ax.gy, w, time, s);
  if (band === 4) abyssTip(ctx, fam, ax, w, h, s, time, fxa);
  ctx.restore();
}

/** b3 / b4: one translucent thick stroke along the prop (b4 pulses). */
function weaponHalo(ctx: CanvasRenderingContext2D, fam: WeaponFamily, ax: Axis, st: BandStyle, w: number, h: number, time: number, fxa: number): void {
  const pulse = st.accent === GOLD ? 0.75 + 0.25 * Math.sin(time * 5.2) : 1;
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * st.glow * pulse * fxa;
  ctx.strokeStyle = st.accent;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (fam === 'shield') {
    const sw = w * 0.56;
    const sh = h * 0.62;
    pathRoundRect(ctx, ax.gx - sw / 2, (ax.gy + ax.ty) / 2 - sh / 2, sw, sh, sw * 0.38);
    ctx.lineWidth = Math.max(4, w * 0.16);
  } else if (fam === 'lute') {
    ctx.ellipse(ax.gx, ax.gy, w * 0.28, h * 0.2, 0, 0, TAU);
    ctx.lineWidth = Math.max(4, w * 0.12);
  } else {
    ctx.moveTo(ax.gx, ax.gy);
    ctx.lineTo(ax.tx, ax.ty);
    ctx.lineWidth = Math.max(6, w * 0.3);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = a0;
}

/** b3: the ivory paper strip tied below the grip, fluttering (thin red ink line: the one red allowed, 9-1). */
function talismanStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, time: number, s: number): void {
  const sw = Math.max(3, w * 0.1);
  const sh = Math.max(7, w * 0.26);
  ctx.save();
  ctx.translate(x, y + 1);
  ctx.rotate(-s * 0.25 + Math.sin(time * 5.5) * 0.28);
  ctx.fillStyle = IVORY;
  ctx.fillRect(-sw / 2, 0, sw, sh);
  ctx.fillStyle = INK;
  ctx.fillRect(-0.6, sh * 0.2, 1.2, sh * 0.6);
  ctx.restore();
}

/** b4: a violet eye with a gold rim at the tip and two small sparks orbiting it. */
function abyssTip(ctx: CanvasRenderingContext2D, fam: WeaponFamily, ax: Axis, w: number, h: number, s: number, time: number, fxa: number): void {
  let ex = ax.tx;
  let ey = ax.ty;
  if (fam === 'shield' || fam === 'lute') {
    ex = ax.gx;
    ey = fam === 'shield' ? (ax.gy + ax.ty) / 2 : ax.gy;
  } else if (fam === 'gun') {
    ex = ax.gx + s * w * 0.2;
    ey = ax.gy - h * 0.03;
  }
  const r = Math.max(2.2, w * 0.075);
  ctx.beginPath();
  ctx.ellipse(ex, ey, r * 1.35, r, 0, 0, TAU);
  ctx.fillStyle = '#f5ecff';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.fillStyle = VIOLET;
  ctx.beginPath();
  ctx.arc(ex + s * r * 0.15, ey, r * 0.55, 0, TAU);
  // two sparks orbiting the tip (same path: one fill)
  const a = time * 3.4;
  const R = r * 3.2;
  for (let i = 0; i < 2; i++) {
    const b = a + i * Math.PI;
    const px = ex + Math.cos(b) * R;
    const py = ey + Math.sin(b) * R * 0.6;
    ctx.moveTo(px + 1.8, py);
    ctx.arc(px, py, 1.8, 0, TAU);
  }
  ctx.fill();
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * 0.9 * fxa;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const b = a + i * Math.PI;
    const px = ex + Math.cos(b) * R;
    const py = ey + Math.sin(b) * R * 0.6;
    ctx.moveTo(px + 1.1, py);
    ctx.arc(px, py, 1.1, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = a0;
}

// ─────────────────────────── armor (9-3) ───────────────────────────

/**
 * Armor over the torso, under the role glyph (the glyph stays readable): 1 olive work vest + thick brown belt, 2 steel
 * plate + round shoulder pads + an extra cyan outline, 3 ivory V collar + shoulder talismans + violet double outline,
 * 4 black spiked pauldrons + gold trim + a small eye + a gold double outline pulsing every 2 s.
 */
export function drawGearArmor(ctx: CanvasRenderingContext2D, band: GearBand, fx: number, fy: number, w: number, h: number, s: number, time: number, fxa: number): void {
  if (band <= 0) return;
  ctx.lineJoin = 'round';
  if (band === 1) {
    pathRoundRect(ctx, fx - w * 0.44, fy - h * 0.44, w * 0.88, h * 0.4, w * 0.12);
    ctx.fillStyle = '#6b7a3a';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3a4220';
    ctx.stroke();
    ctx.fillStyle = '#556030';
    ctx.fillRect(fx - s * w * 0.3 - w * 0.08, fy - h * 0.2, w * 0.16, w * 0.13);
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(fx - w / 2 + 1, fy - h * 0.32, w - 2, Math.max(4, h * 0.1));
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(fx - w * 0.06, fy - h * 0.32, w * 0.12, Math.max(4, h * 0.1));
    return;
  }
  if (band === 2) {
    outerOutline(ctx, fx, fy, w, h, '#4cc9f0', 0.95 * fxa, 2);
    pathRoundRect(ctx, fx - w * 0.38, fy - h * 0.64, w * 0.76, h * 0.34, w * 0.14);
    ctx.fillStyle = '#c9d3de';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#5b6b7d';
    ctx.stroke();
    pads(ctx, fx, fy, w, h, w * 0.15, '#dfe6ee', '#2aa7d6');
    return;
  }
  if (band === 3) {
    outerOutline(ctx, fx, fy, w, h, '#c77dff', 0.95 * fxa, 2.2);
    ctx.beginPath();
    ctx.moveTo(fx - w * 0.42, fy - h * 0.7);
    ctx.lineTo(fx, fy - h * 0.55);
    ctx.lineTo(fx + w * 0.42, fy - h * 0.7);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(4, w * 0.15);
    ctx.strokeStyle = '#9b5de5';
    ctx.stroke();
    ctx.lineWidth = Math.max(2.5, w * 0.1);
    ctx.strokeStyle = IVORY;
    ctx.stroke();
    ctx.lineCap = 'butt';
    // shoulder talismans: two paper strips swaying (one path)
    const sw = Math.max(3, w * 0.12);
    const sh = Math.max(6, w * 0.3);
    ctx.fillStyle = IVORY;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const x = fx + side * w * 0.46;
      const y = fy - h * 0.66;
      const k = Math.sin(time * 4 + side) * sw * 0.5;
      ctx.moveTo(x - sw / 2, y);
      ctx.lineTo(x + sw / 2, y);
      ctx.lineTo(x + sw / 2 + k, y + sh);
      ctx.lineTo(x - sw / 2 + k, y + sh);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillRect(fx - w * 0.46 - 0.6, fy - h * 0.66 + sh * 0.25, 1.2, sh * 0.45);
    ctx.fillRect(fx + w * 0.46 - 0.6, fy - h * 0.66 + sh * 0.25, 1.2, sh * 0.45);
    return;
  }
  // band 4
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((time * TAU) / 2));
  outerOutline(ctx, fx, fy, w, h, GOLD, pulse * fxa, 2.4);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(fx - w / 2 + 1.5, fy - h * 0.31, w - 3, Math.max(2, h * 0.035));
  // pauldrons: half domes with three spikes (one path), gold trim
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const cx = fx + side * w * 0.43;
    const cy = fy - h * 0.62;
    const r = w * 0.2;
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - r * 0.75, cy - r * 0.9);
    ctx.lineTo(cx - r * 0.45, cy - r * 0.55);
    ctx.lineTo(cx, cy - r * 1.35);
    ctx.lineTo(cx + r * 0.45, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.75, cy - r * 0.9);
    ctx.lineTo(cx + r, cy);
    ctx.quadraticCurveTo(cx, cy + r * 0.7, cx - r, cy);
    ctx.closePath();
  }
  ctx.fillStyle = '#231a2e';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  // the small eye under the chest
  const ey = fy - h * 0.2;
  const er = Math.max(2, w * 0.07);
  ctx.beginPath();
  ctx.ellipse(fx, ey, er * 1.5, er, 0, 0, TAU);
  ctx.fillStyle = '#f5ecff';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  // pupil: a rect (no path — the 15-path budget)
  ctx.fillStyle = VIOLET;
  ctx.fillRect(fx + s * er * 0.2 - er * 0.5, ey - er * 0.5, er, er);
}

/** A second outline outside the body (the clearest band signal on a phone, 9-3). */
function outerOutline(ctx: CanvasRenderingContext2D, fx: number, fy: number, w: number, h: number, color: string, alpha: number, lw: number): void {
  const a = Math.max(0, Math.min(1, alpha));
  if (a <= 0) return;
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * a;
  pathCapsule(ctx, fx, fy + 1.5, w + 6, h + 4);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.globalAlpha = a0;
}

function pads(ctx: CanvasRenderingContext2D, fx: number, fy: number, w: number, h: number, r: number, fill: string, edge: string): void {
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const cx = fx + side * w * 0.45;
    const cy = fy - h * 0.58;
    ctx.moveTo(cx + r, cy);
    ctx.ellipse(cx, cy, r, r * 0.85, 0, 0, TAU);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

// ─────────────────────────── charm (9-4) ───────────────────────────

/** The charm hangs at the waist on the side away from the weapon, swinging: bell / dog tag / talisman / floating eye. */
export function drawGearCharm(ctx: CanvasRenderingContext2D, band: GearBand, fx: number, fy: number, w: number, h: number, s: number, time: number, fxa: number): void {
  if (band <= 0) return;
  const x = fx - s * w * 0.4;
  const y = fy - h * 0.27;
  const len = Math.max(5, w * 0.2);
  const sway = Math.sin(time * 3.1) * 0.35;
  const cx = x + Math.sin(sway) * len;
  const cy = y + Math.cos(sway) * len + (band === 4 ? Math.sin(time * 2.4) * 1.5 - 2 : 0);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(cx, cy);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = band === 4 ? 'rgba(255,209,102,0.55)' : band === 2 ? '#9aa5b1' : '#5a3a1f';
  ctx.stroke();
  const r = Math.max(2.6, w * 0.09);
  ctx.lineWidth = 1.3;
  if (band === 1) {
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.6, r, Math.PI, 0);
    ctx.lineTo(cx + r * 1.15, cy + r * 1.4);
    ctx.lineTo(cx - r * 1.15, cy + r * 1.4);
    ctx.closePath();
    ctx.fillStyle = '#c9a227';
    ctx.fill();
    ctx.strokeStyle = '#6b5310';
    ctx.stroke();
  } else if (band === 2) {
    pathRoundRect(ctx, cx - r * 0.75, cy, r * 1.5, r * 2, r * 0.45);
    ctx.fillStyle = '#d7dee6';
    ctx.fill();
    ctx.strokeStyle = '#2aa7d6';
    ctx.stroke();
  } else if (band === 3) {
    const k = Math.sin(time * 6) * r * 0.35;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy);
    ctx.lineTo(cx + r * 0.7, cy);
    ctx.lineTo(cx + r * 0.7 + k, cy + r * 2.6);
    ctx.lineTo(cx - r * 0.7 + k, cy + r * 2.6);
    ctx.closePath();
    ctx.fillStyle = IVORY;
    ctx.fill();
    ctx.strokeStyle = '#9b5de5';
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(cx - 0.6 + k * 0.5, cy + r * 0.5, 1.2, r * 1.5);
  } else {
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * 0.35 * fxa;
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(cx, cy + r, r * 1.9, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a0;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r, r * 1.2, r, 0, 0, TAU);
    ctx.fillStyle = '#f5ecff';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.fillStyle = VIOLET;
    ctx.beginPath();
    ctx.arc(cx, cy + r, r * 0.5, 0, TAU);
    ctx.fill();
  }
}

// ─────────────────────────── relic (9-5) ───────────────────────────

/** One full turn around the head takes this long. */
export const RELIC_ORBIT_S = 3;

/** Where the orbiting relic is now (and whether it is behind the body). */
export function relicOrbit(fx: number, fy: number, w: number, h: number, time: number, phase: number): { x: number; y: number; back: boolean } {
  const a = (time * TAU) / RELIC_ORBIT_S + phase;
  return { x: fx + Math.cos(a) * w * 0.78, y: fy - h * 0.88 + Math.sin(a) * w * 0.2, back: Math.sin(a) < 0 };
}

/** The orbiting relic: drawn in the back pass when behind the body, in the front pass otherwise. */
export function drawGearRelicOrbit(
  ctx: CanvasRenderingContext2D,
  relic: number,
  band: GearBand,
  fx: number,
  fy: number,
  w: number,
  h: number,
  time: number,
  phase: number,
  back: boolean,
): void {
  if (relic <= 0) return;
  const o = relicOrbit(fx, fy, w, h, time, phase);
  if (o.back !== back) return;
  drawRelicBadge(ctx, relic, band, o.x, o.y, Math.max(5.5, w * 0.19), back ? 0.75 : 1);
}

/** A relic badge: dark disc, band-coloured ring, thin gold rim, the relic's own glyph in its aura colour. */
export function drawRelicBadge(ctx: CanvasRenderingContext2D, relic: number, band: GearBand, x: number, y: number, r: number, alpha = 1): void {
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = '#141824';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.28);
  ctx.strokeStyle = bandStyle(band || 1).accent;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r + Math.max(0.8, r * 0.14), 0, TAU);
  ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  relicGlyph(ctx, relic, x, y, r * 0.62);
  ctx.globalAlpha = a0;
}

/** The 8 relic shapes (seal, flag, helm, mark, feather, collar, horned skull, chalice), each one path. */
export function relicGlyph(ctx: CanvasRenderingContext2D, relic: number, x: number, y: number, r: number): void {
  const c = RELIC_AURA[relic] ?? '#ffffff';
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(1, r * 0.28);
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (relic) {
    case 1: // echo seal: a dot in two ripple rings
      ctx.arc(x, y, r * 0.3, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.95, 0, TAU);
      ctx.stroke();
      break;
    case 2: // relay flag: pole + pennant
      ctx.moveTo(x - r * 0.55, y + r);
      ctx.lineTo(x - r * 0.55, y - r);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5, y - r);
      ctx.lineTo(x + r, y - r * 0.45);
      ctx.lineTo(x - r * 0.5, y + r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 3: // vanguard helm: dome with a visor slit
      ctx.moveTo(x - r, y + r * 0.7);
      ctx.arc(x, y + r * 0.2, r, Math.PI, 0);
      ctx.lineTo(x + r, y + r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#141824';
      ctx.fillRect(x - r * 0.7, y + r * 0.05, r * 1.4, r * 0.25);
      break;
    case 4: // hunter's mark: crosshair
      ctx.arc(x, y, r * 0.7, 0, TAU);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
      break;
    case 5: // phoenix feather: a leaf with a spine
      ctx.ellipse(x, y, r * 0.42, r * 1.05, 0.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#141824';
      ctx.lineWidth = Math.max(0.8, r * 0.14);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.62, y + r * 0.85);
      ctx.lineTo(x + r * 0.5, y - r * 0.7);
      ctx.stroke();
      break;
    case 6: // beast collar: ring + fang
      ctx.arc(x, y - r * 0.15, r * 0.7, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y + r * 0.45);
      ctx.lineTo(x + r * 0.3, y + r * 0.45);
      ctx.lineTo(x, y + r * 1.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 7: // rage breaker: horned skull
      ctx.moveTo(x - r * 0.95, y - r);
      ctx.quadraticCurveTo(x - r * 0.9, y - r * 0.2, x - r * 0.35, y - r * 0.3);
      ctx.moveTo(x + r * 0.95, y - r);
      ctx.quadraticCurveTo(x + r * 0.9, y - r * 0.2, x + r * 0.35, y - r * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + r * 0.15, r * 0.62, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#141824';
      ctx.fillRect(x - r * 0.38, y + r * 0.05, r * 0.24, r * 0.24);
      ctx.fillRect(x + r * 0.14, y + r * 0.05, r * 0.24, r * 0.24);
      break;
    case 8: // blood chalice: cup + stem + base
    default:
      ctx.moveTo(x - r * 0.85, y - r * 0.85);
      ctx.lineTo(x + r * 0.85, y - r * 0.85);
      ctx.quadraticCurveTo(x + r * 0.75, y + r * 0.1, x, y + r * 0.15);
      ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.1, x - r * 0.85, y - r * 0.85);
      ctx.closePath();
      ctx.moveTo(x - r * 0.12, y + r * 0.1);
      ctx.lineTo(x + r * 0.12, y + r * 0.1);
      ctx.lineTo(x + r * 0.12, y + r * 0.7);
      ctx.lineTo(x + r * 0.6, y + r * 0.95);
      ctx.lineTo(x - r * 0.6, y + r * 0.95);
      ctx.lineTo(x - r * 0.12, y + r * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.lineCap = 'butt';
}

// ─────────────────────────── a geared hero (the passes units.ts calls) ───────────────────────────

/** Before the body: the relic's back half of the orbit. */
export function drawGearBack(ctx: CanvasRenderingContext2D, g: GearBands, fx: number, fy: number, w: number, h: number, time: number, phase: number): void {
  if (g.r > 0) drawGearRelicOrbit(ctx, g.r, g.rb, fx, fy, w, h, time, phase, true);
}

/** After the weapon: the relic's front half of the orbit. */
export function drawGearFront(ctx: CanvasRenderingContext2D, g: GearBands, fx: number, fy: number, w: number, h: number, time: number, phase: number): void {
  if (g.r > 0) drawGearRelicOrbit(ctx, g.r, g.rb, fx, fy, w, h, time, phase, false);
}
