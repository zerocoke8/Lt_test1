// Unit drawing: shadows, ground rings, procedural bodies, HP bars, status pips, markers.
// Pure drawing helpers + the per-entity render memo (animation bookkeeping lives here, never in GameState).

import { DEBUFFS, type Entity, type EntityKind, type MonsterTier, type StatusInstance, type Team } from '../types';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { COLORS, boldFont, type UnitLook, unitLook } from './look';
import { TAU, addStar, pathCapsule, pathRoundRect } from './shapes';

/** Render-side bookkeeping per entity id (updated every frame from GameState, read for death/leave ghosts). */
export interface UnitMemo {
  id: number;
  kind: EntityKind;
  defId: string;
  tier: MonsterTier | 'character';
  team: Team;
  ownerPlayer: number | null;
  partyIndex: number | null;
  radius: number;
  x: number;
  y: number;
  facing: number;
  anim: Entity['anim'];
  animTotal: number;
  lastAnimTime: number;
  /** Seconds of white hit-flash left. */
  flash: number;
  /** Lagging HP fraction (yellow trail behind the bar). */
  hpLag: number;
  maxHp: number;
  stamp: number;
  phase: number;
  look: UnitLook;
}

export function newMemo(e: Entity, stamp: number): UnitMemo {
  return {
    id: e.id,
    kind: e.kind,
    defId: e.defId,
    tier: e.tier,
    team: e.team,
    ownerPlayer: e.ownerPlayer,
    partyIndex: e.partyIndex,
    radius: e.radius,
    x: e.pos.x,
    y: e.pos.y,
    facing: e.facing,
    anim: e.anim,
    animTotal: Math.max(0.05, e.animTime),
    lastAnimTime: e.animTime,
    flash: 0,
    hpLag: e.maxHp > 0 ? e.hp / e.maxHp : 1,
    maxHp: e.maxHp,
    stamp,
    phase: (e.id * 1.618) % TAU,
    look: unitLook(e.kind, e.defId),
  };
}

export function syncMemo(m: UnitMemo, e: Entity, stamp: number, dt: number): void {
  if (m.defId !== e.defId || m.kind !== e.kind) {
    m.defId = e.defId;
    m.kind = e.kind;
    m.look = unitLook(e.kind, e.defId);
  }
  m.tier = e.tier;
  m.team = e.team;
  m.ownerPlayer = e.ownerPlayer;
  m.partyIndex = e.partyIndex;
  m.radius = e.radius;
  m.maxHp = e.maxHp;
  m.x = e.pos.x;
  m.y = e.pos.y;
  m.facing = e.facing;
  if (e.anim !== m.anim || e.animTime > m.lastAnimTime + 1e-3) {
    m.anim = e.anim;
    m.animTotal = Math.max(0.05, e.animTime);
  }
  m.lastAnimTime = e.animTime;
  m.flash = Math.max(0, m.flash - dt);
  const frac = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
  if (frac >= m.hpLag) m.hpLag = frac;
  else m.hpLag = Math.max(frac, m.hpLag - dt * 0.6);
  m.stamp = stamp;
}

/** 0 → 1 progress through the current timed anim. */
export function animProgress(e: Entity, m: UnitMemo): number {
  if (m.animTotal <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - e.animTime / m.animTotal));
}

/** Drawn body width (px) for a world radius. Height = width × look.heightMul. */
export function bodyWidth(radius: number): number {
  return Math.max(14, radius * 2 * PX_PER_UNIT * 0.92);
}

export function bodyHeight(look: UnitLook, radius: number): number {
  return bodyWidth(radius) * look.heightMul;
}

// ─────────────────────────── ground layer ───────────────────────────

export function drawShadow(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, radius: number, alpha: number, scale = 1): void {
  ctx.globalAlpha = 0.38 * alpha;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cam.sx(x), cam.sy(y), radius * PX_PER_UNIT * 1.0 * scale, radius * PX_PER_UNIT_Y * 1.0 * scale, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Owner ring (allies) or thin hostile ring (enemies) on the ground. */
export function drawGroundRing(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  radius: number,
  color: string,
  mode: 'local' | 'ally' | 'enemy' | 'summon',
  time: number,
): void {
  const sx = cam.sx(x);
  const sy = cam.sy(y);
  const rx = radius * PX_PER_UNIT * 1.25;
  const ry = radius * PX_PER_UNIT_Y * 1.25;
  if (mode === 'local') {
    const p = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.35 + 0.35 * (1 - p);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * (1.15 + 0.2 * p), ry * (1.15 + 0.2 * p), 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    return;
  }
  if (mode === 'enemy') {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.enemyRing;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * 0.95, ry * 0.95, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = mode === 'summon' ? 0.6 : 0.95;
  ctx.lineWidth = mode === 'summon' ? 2 : 3;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ─────────────────────────── bodies ───────────────────────────

function eyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, spacing: number, size: number, s: number, white: string, pupil: string, angry = false): void {
  ctx.fillStyle = white;
  ctx.beginPath();
  ctx.ellipse(cx - spacing + s * size * 0.3, cy, size, size * 1.15, 0, 0, TAU);
  ctx.moveTo(cx + spacing + s * size * 0.3 + size, cy);
  ctx.ellipse(cx + spacing + s * size * 0.3, cy, size, size * 1.15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pupil;
  ctx.beginPath();
  const pr = size * 0.55;
  ctx.ellipse(cx - spacing + s * size * 0.65, cy + size * 0.1, pr, pr * 1.1, 0, 0, TAU);
  ctx.moveTo(cx + spacing + s * size * 0.65 + pr, cy + size * 0.1);
  ctx.ellipse(cx + spacing + s * size * 0.65, cy + size * 0.1, pr, pr * 1.1, 0, 0, TAU);
  ctx.fill();
  if (angry) {
    ctx.strokeStyle = pupil;
    ctx.lineWidth = Math.max(1.5, size * 0.45);
    ctx.beginPath();
    ctx.moveTo(cx - spacing - size, cy - size * 1.5);
    ctx.lineTo(cx - spacing + size * 1.1, cy - size * 0.9);
    ctx.moveTo(cx + spacing + size, cy - size * 1.5);
    ctx.lineTo(cx + spacing - size * 1.1, cy - size * 0.9);
    ctx.stroke();
  }
}

function crown(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number): void {
  const cw = w * 0.55;
  const ch = w * 0.3;
  const y = top - ch * 0.55;
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#7a5200';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - cw / 2, y + ch);
  ctx.lineTo(cx - cw / 2, y + ch * 0.25);
  ctx.lineTo(cx - cw / 4, y + ch * 0.6);
  ctx.lineTo(cx, y);
  ctx.lineTo(cx + cw / 4, y + ch * 0.6);
  ctx.lineTo(cx + cw / 2, y + ch * 0.25);
  ctx.lineTo(cx + cw / 2, y + ch);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff006e';
  ctx.beginPath();
  ctx.arc(cx, y + ch * 0.7, Math.max(2, cw * 0.08), 0, TAU);
  ctx.fill();
}

function heroAccessory(ctx: CanvasRenderingContext2D, look: UnitLook, fx: number, fy: number, w: number, h: number, s: number, flash: boolean): void {
  const hx = fx + s * w * 0.5;
  const hy = fy - h * 0.42;
  switch (look.accessory) {
    case 'shield': {
      const sw = w * 0.46;
      const sh = h * 0.52;
      pathRoundRect(ctx, hx - sw / 2, hy - sh / 2, sw, sh, sw * 0.35);
      ctx.fillStyle = flash ? '#ffffff' : '#cfd8e3';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = look.dark;
      ctx.stroke();
      ctx.fillStyle = look.color;
      ctx.beginPath();
      ctx.arc(hx, hy, sw * 0.18, 0, TAU);
      ctx.fill();
      break;
    }
    case 'sword': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hx - s * 4, hy + 4);
      ctx.lineTo(hx + s * 6, hy - 6);
      ctx.stroke();
      ctx.strokeStyle = '#e9eef5';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hx + s * 4, hy - 4);
      ctx.lineTo(hx + s * w * 0.42, hy - h * 0.48);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }
    case 'axe': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#5a3a1f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hx - s * 2, hy + h * 0.15);
      ctx.lineTo(hx + s * w * 0.2, hy - h * 0.45);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const ax = hx + s * w * 0.2;
      const ay = hy - h * 0.4;
      ctx.fillStyle = flash ? '#ffffff' : '#dfe6ee';
      ctx.beginPath();
      ctx.moveTo(ax, ay - h * 0.12);
      ctx.quadraticCurveTo(ax + s * w * 0.45, ay - h * 0.05, ax + s * w * 0.1, ay + h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#3d4650';
      ctx.stroke();
      break;
    }
    case 'bow': {
      const bx = hx - s * w * 0.1;
      const r = h * 0.3;
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (s > 0) ctx.arc(bx, hy, r, -1.15, 1.15);
      else ctx.arc(bx, hy, r, Math.PI - 1.15, Math.PI + 1.15);
      ctx.stroke();
      const sx = bx + s * Math.cos(1.15) * r;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, hy - Math.sin(1.15) * r);
      ctx.lineTo(sx, hy + Math.sin(1.15) * r);
      ctx.stroke();
      break;
    }
    case 'hammer': {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#6b4a2b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hx - s * 2, hy + h * 0.18);
      ctx.lineTo(hx + s * w * 0.12, hy - h * 0.42);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const mx = hx + s * w * 0.12;
      const my = hy - h * 0.46;
      pathRoundRect(ctx, mx - w * 0.2, my - h * 0.1, w * 0.4, h * 0.2, 3);
      ctx.fillStyle = flash ? '#ffffff' : '#ffe8a3';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.dark;
      ctx.stroke();
      break;
    }
    case 'gun': {
      // short blunderbuss pointing forward
      const gx = hx - s * w * 0.05;
      const gy = hy + h * 0.02;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.scale(s, 1);
      ctx.rotate(-0.12);
      ctx.fillStyle = '#5a3a22';
      pathRoundRect(ctx, -w * 0.12, -2, w * 0.2, h * 0.2, 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : '#9aa5b1';
      pathRoundRect(ctx, -w * 0.05, -h * 0.07, w * 0.5, h * 0.1, 2);
      ctx.fill();
      ctx.fillStyle = '#3d4650';
      ctx.fillRect(w * 0.4, -h * 0.09, w * 0.08, h * 0.14);
      ctx.restore();
      break;
    }
    case 'lute': {
      const lx = hx - s * w * 0.08;
      const ly = hy + h * 0.06;
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + s * w * 0.32, ly - h * 0.38);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = flash ? '#ffffff' : '#d9a066';
      ctx.beginPath();
      ctx.ellipse(lx, ly, w * 0.2, h * 0.14, -0.6 * s, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#5a3a1f';
      ctx.stroke();
      ctx.fillStyle = '#3a2412';
      ctx.beginPath();
      ctx.arc(lx, ly, w * 0.05, 0, TAU);
      ctx.fill();
      break;
    }
    case 'orb':
    case 'staff': {
      const orb = look.accessory === 'orb';
      ctx.strokeStyle = orb ? '#4a2f6b' : '#7a5230';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, fy - 2);
      ctx.lineTo(hx, fy - h * 0.95);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const oy = fy - h * 0.98;
      ctx.fillStyle = flash ? '#ffffff' : orb ? '#ff9e3d' : '#fff3b0';
      ctx.beginPath();
      ctx.arc(hx, oy, w * (orb ? 0.15 : 0.12), 0, TAU);
      ctx.fill();
      ctx.globalAlpha *= 0.35;
      ctx.beginPath();
      ctx.arc(hx, oy, w * 0.26, 0, TAU);
      ctx.fill();
      ctx.globalAlpha /= 0.35;
      if (!orb) {
        ctx.strokeStyle = '#fff3b0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx - w * 0.12, oy - w * 0.02);
        ctx.lineTo(hx + w * 0.12, oy - w * 0.02);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Draws a unit body standing on (fx, fy) (screen px, height already applied).
 * s = facing sign (+1 right, -1 left). Caller sets globalAlpha for fades.
 */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  look: UnitLook,
  tier: MonsterTier | 'character',
  fx: number,
  fy: number,
  w: number,
  h: number,
  s: number,
  time: number,
  phase: number,
  flash: boolean,
): void {
  const fill = flash ? look.flash : look.color;
  ctx.lineJoin = 'round';
  switch (look.shape) {
    case 'hero': {
      // accessory behind when facing away from the viewer side is irrelevant in this view; draw after body
      pathCapsule(ctx, fx, fy, w, h);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      // belt + highlight
      ctx.fillStyle = look.dark;
      ctx.fillRect(fx - w / 2 + 1.5, fy - h * 0.3, w - 3, Math.max(3, h * 0.07));
      ctx.globalAlpha *= 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(fx - w * 0.18, fy - h + w * 0.32, w * 0.16, w * 0.22, -0.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha /= 0.3;
      eyes(ctx, fx + s * w * 0.06, fy - h + w * 0.45, w * 0.15, Math.max(2, w * 0.085), s, '#ffffff', '#141414');
      // role glyph
      const gs = Math.max(11, w * 0.42);
      ctx.font = boldFont(gs);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = look.outline;
      const gy = fy - h * 0.55 + gs * 0.62;
      ctx.strokeText(look.glyph, fx, gy);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(look.glyph, fx, gy);
      heroAccessory(ctx, look, fx, fy, w, h, s, flash);
      break;
    }
    case 'slime': {
      const wob = 1 + 0.07 * Math.sin(time * 6 + phase);
      const ww = w * wob;
      const hh = h / wob;
      ctx.beginPath();
      ctx.moveTo(fx - ww / 2, fy);
      ctx.bezierCurveTo(fx - ww / 2, fy - hh * 1.3, fx + ww / 2, fy - hh * 1.3, fx + ww / 2, fy);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      ctx.globalAlpha *= 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(fx - ww * 0.18, fy - hh * 0.7, ww * 0.1, hh * 0.14, -0.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha /= 0.35;
      eyes(ctx, fx + s * ww * 0.08, fy - hh * 0.45, ww * 0.16, Math.max(2, ww * 0.09), s, '#ffffff', '#1b1b1b', true);
      break;
    }
    case 'goblin': {
      // ears
      ctx.fillStyle = flash ? look.flash : look.dark;
      ctx.beginPath();
      ctx.moveTo(fx - w * 0.38, fy - h * 0.72);
      ctx.lineTo(fx - w * 0.85, fy - h * 0.95);
      ctx.lineTo(fx - w * 0.3, fy - h * 0.55);
      ctx.moveTo(fx + w * 0.38, fy - h * 0.72);
      ctx.lineTo(fx + w * 0.85, fy - h * 0.95);
      ctx.lineTo(fx + w * 0.3, fy - h * 0.55);
      ctx.fill();
      pathCapsule(ctx, fx, fy, w * 0.9, h);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      eyes(ctx, fx + s * w * 0.08, fy - h * 0.66, w * 0.15, Math.max(2, w * 0.09), s, '#fff15c', '#1b1b1b', true);
      // dagger
      ctx.strokeStyle = '#d9d9d9';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fx + s * w * 0.45, fy - h * 0.3);
      ctx.lineTo(fx + s * w * 0.8, fy - h * 0.62);
      ctx.stroke();
      break;
    }
    case 'skeleton': {
      pathCapsule(ctx, fx, fy, w * 0.85, h);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#495057';
      ctx.stroke();
      // ribs
      ctx.strokeStyle = '#adb5bd';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const y = fy - h * (0.18 + i * 0.11);
        ctx.moveTo(fx - w * 0.22, y);
        ctx.lineTo(fx + w * 0.22, y);
      }
      ctx.stroke();
      // skull sockets
      ctx.fillStyle = '#212529';
      ctx.beginPath();
      const ey = fy - h * 0.72;
      ctx.ellipse(fx - w * 0.14 + s * 2, ey, w * 0.09, w * 0.11, 0, 0, TAU);
      ctx.moveTo(fx + w * 0.14 + s * 2 + w * 0.09, ey);
      ctx.ellipse(fx + w * 0.14 + s * 2, ey, w * 0.09, w * 0.11, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ff4d4d';
      ctx.fillRect(fx - w * 0.14 + s * 3 - 1, ey - 1, 2, 2);
      ctx.fillRect(fx + w * 0.14 + s * 3 - 1, ey - 1, 2, 2);
      // bow
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const bx = fx + s * w * 0.55;
      if (s > 0) ctx.arc(bx - w * 0.15, fy - h * 0.45, h * 0.28, -1.1, 1.1);
      else ctx.arc(bx + w * 0.15, fy - h * 0.45, h * 0.28, Math.PI - 1.1, Math.PI + 1.1);
      ctx.stroke();
      break;
    }
    case 'bomb': {
      const r = w / 2;
      const cy = fy - h * 0.48;
      // legs
      ctx.strokeStyle = look.outline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = Math.sin(time * 18 + phase) * 3;
      ctx.moveTo(fx - r * 0.5, fy - 4);
      ctx.lineTo(fx - r * 0.8, fy + step * 0.3);
      ctx.moveTo(fx + r * 0.5, fy - 4);
      ctx.lineTo(fx + r * 0.8, fy - step * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, cy, r, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(fx - r * 0.85, cy - r * 0.05, r * 1.7, r * 0.22);
      // fuse
      ctx.strokeStyle = '#3b2f2f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx, cy - r);
      ctx.quadraticCurveTo(fx + s * r * 0.4, cy - r * 1.5, fx + s * r * 0.2, cy - r * 1.8);
      ctx.stroke();
      const blink = Math.sin(time * 16 + phase) > 0;
      ctx.fillStyle = blink ? '#fff3b0' : '#ff6b00';
      ctx.beginPath();
      ctx.arc(fx + s * r * 0.2, cy - r * 1.85, blink ? 3.5 : 2.5, 0, TAU);
      ctx.fill();
      eyes(ctx, fx + s * r * 0.15, cy - r * 0.38, r * 0.3, Math.max(2, r * 0.17), s, '#ffffff', '#1b1b1b', true);
      break;
    }
    case 'golem': {
      const bw = w * 1.05;
      pathRoundRect(ctx, fx - bw / 2, fy - h, bw, h, bw * 0.22);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      // shoulders
      ctx.fillStyle = flash ? look.flash : look.dark;
      pathRoundRect(ctx, fx - bw * 0.62, fy - h * 0.82, bw * 0.28, h * 0.42, 5);
      ctx.fill();
      pathRoundRect(ctx, fx + bw * 0.34, fy - h * 0.82, bw * 0.28, h * 0.42, 5);
      ctx.fill();
      // cracks
      ctx.strokeStyle = look.outline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx - bw * 0.2, fy - h * 0.15);
      ctx.lineTo(fx - bw * 0.05, fy - h * 0.35);
      ctx.lineTo(fx - bw * 0.15, fy - h * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#7df9ff';
      ctx.fillRect(fx - bw * 0.22 + s * 3, fy - h * 0.74, bw * 0.14, h * 0.07);
      ctx.fillRect(fx + bw * 0.08 + s * 3, fy - h * 0.74, bw * 0.14, h * 0.07);
      break;
    }
    case 'ogre': {
      pathCapsule(ctx, fx, fy, w, h);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      // horns
      ctx.fillStyle = '#f1e3c8';
      ctx.beginPath();
      ctx.moveTo(fx - w * 0.36, fy - h * 0.86);
      ctx.lineTo(fx - w * 0.6, fy - h * 1.08);
      ctx.lineTo(fx - w * 0.22, fy - h * 0.95);
      ctx.moveTo(fx + w * 0.36, fy - h * 0.86);
      ctx.lineTo(fx + w * 0.6, fy - h * 1.08);
      ctx.lineTo(fx + w * 0.22, fy - h * 0.95);
      ctx.fill();
      // belly
      ctx.fillStyle = flash ? look.flash : look.light;
      ctx.beginPath();
      ctx.ellipse(fx, fy - h * 0.32, w * 0.3, h * 0.2, 0, 0, TAU);
      ctx.fill();
      eyes(ctx, fx + s * w * 0.06, fy - h * 0.68, w * 0.14, Math.max(2.5, w * 0.06), s, '#fff3b0', '#1b1b1b', true);
      // tusks
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(fx - w * 0.12, fy - h * 0.55);
      ctx.lineTo(fx - w * 0.08, fy - h * 0.62);
      ctx.lineTo(fx - w * 0.04, fy - h * 0.55);
      ctx.moveTo(fx + w * 0.04, fy - h * 0.55);
      ctx.lineTo(fx + w * 0.08, fy - h * 0.62);
      ctx.lineTo(fx + w * 0.12, fy - h * 0.55);
      ctx.fill();
      // club
      ctx.strokeStyle = '#6b4226';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fx + s * w * 0.45, fy - h * 0.35);
      ctx.lineTo(fx + s * w * 0.75, fy - h * 0.85);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }
    case 'lich': {
      ctx.beginPath();
      ctx.moveTo(fx - w * 0.55, fy);
      ctx.lineTo(fx - w * 0.3, fy - h * 0.72);
      ctx.lineTo(fx + w * 0.3, fy - h * 0.72);
      ctx.lineTo(fx + w * 0.55, fy);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      // hood
      ctx.beginPath();
      ctx.arc(fx, fy - h * 0.78, w * 0.32, 0, TAU);
      ctx.fillStyle = flash ? look.flash : look.dark;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0b0614';
      ctx.beginPath();
      ctx.ellipse(fx + s * 2, fy - h * 0.76, w * 0.2, w * 0.19, 0, 0, TAU);
      ctx.fill();
      const glow = 0.7 + 0.3 * Math.sin(time * 5 + phase);
      ctx.fillStyle = '#7CFFCB';
      ctx.globalAlpha *= glow;
      ctx.beginPath();
      ctx.arc(fx - w * 0.07 + s * 3, fy - h * 0.77, Math.max(2, w * 0.045), 0, TAU);
      ctx.arc(fx + w * 0.07 + s * 3, fy - h * 0.77, Math.max(2, w * 0.045), 0, TAU);
      ctx.fill();
      ctx.globalAlpha /= glow;
      // staff
      ctx.strokeStyle = '#3d2b1f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx + s * w * 0.6, fy);
      ctx.lineTo(fx + s * w * 0.6, fy - h * 1.0);
      ctx.stroke();
      ctx.fillStyle = '#c77dff';
      ctx.beginPath();
      ctx.arc(fx + s * w * 0.6, fy - h * 1.02, w * 0.09, 0, TAU);
      ctx.fill();
      break;
    }
    case 'turret': {
      const bw = w * 0.9;
      pathRoundRect(ctx, fx - bw / 2, fy - h * 0.5, bw, h * 0.5, 4);
      ctx.fillStyle = flash ? look.flash : look.dark;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      const hy = fy - h * 0.68;
      ctx.strokeStyle = '#343a40';
      ctx.lineWidth = Math.max(4, w * 0.16);
      ctx.beginPath();
      ctx.moveTo(fx, hy);
      ctx.lineTo(fx + s * w * 0.6, hy - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, hy, w * 0.3, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      ctx.fillStyle = '#ff006e';
      ctx.beginPath();
      ctx.arc(fx + s * w * 0.08, hy, w * 0.07, 0, TAU);
      ctx.fill();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.ellipse(fx, fy - h * 0.5, w / 2, h / 2, 0, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = look.outline;
      ctx.stroke();
      eyes(ctx, fx + s * w * 0.08, fy - h * 0.6, w * 0.15, Math.max(2, w * 0.09), s, '#ffffff', '#1b1b1b');
    }
  }
  if (tier === 'mid') crown(ctx, fx, fy - h - (look.shape === 'ogre' ? h * 0.02 : 0), w);
}

/** Height of the drawn body top above the foot point (px), including the mid-boss crown. */
export function bodyTop(look: UnitLook, tier: MonsterTier | 'character', h: number, w: number): number {
  let top = h;
  if (look.shape === 'lich') top = h * 1.05;
  if (look.shape === 'ogre') top = h * 1.08;
  if (tier === 'mid') top += w * 0.3;
  return top;
}

// ─────────────────────────── overhead ───────────────────────────

export interface BarStyle {
  width: number;
  height: number;
}

export function barStyleFor(e: Entity, isLocal: boolean, w: number): BarStyle {
  if (e.kind === 'character') return isLocal ? { width: 56, height: 7 } : { width: 46, height: 5 };
  if (e.tier === 'mid') return { width: Math.max(84, w * 1.15), height: 7 };
  if (e.kind === 'summon') return { width: 32, height: 4 };
  return { width: Math.max(28, Math.min(50, w * 0.95)), height: 4 };
}

/** HP bar with lagging trail and shield overlay. (cx, y) = bar top-center. */
export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  style: BarStyle,
  hp: number,
  maxHp: number,
  shield: number,
  lag: number,
  ally: boolean,
  frame: string | null = null,
): void {
  const w = style.width;
  const h = style.height;
  const x = cx - w / 2;
  const total = Math.max(maxHp, hp + shield, 1);
  const hpW = (Math.max(0, hp) / total) * w;
  const shW = (Math.max(0, shield) / total) * w;
  const lagW = Math.min(w, lag * (maxHp / total) * w);
  if (frame) {
    ctx.fillStyle = frame;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  }
  ctx.fillStyle = COLORS.barFrame;
  ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = ally ? COLORS.allyHpBack : COLORS.enemyHpBack;
  ctx.fillRect(x, y, w, h);
  if (lagW > hpW) {
    ctx.fillStyle = COLORS.hpLag;
    ctx.fillRect(x + hpW, y, lagW - hpW, h);
  }
  ctx.fillStyle = ally ? COLORS.ally : COLORS.enemy;
  ctx.fillRect(x, y, hpW, h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x, y, hpW, Math.max(1, h * 0.35));
  if (shW > 0.5) {
    ctx.fillStyle = COLORS.shield;
    ctx.fillRect(x + hpW, y, Math.min(shW, w - hpW), h);
    ctx.globalAlpha *= 0.6;
    ctx.fillStyle = '#9fb3c8';
    ctx.fillRect(x + hpW, y + h - 1, Math.min(shW, w - hpW), 1);
    ctx.globalAlpha /= 0.6;
  }
}

/** Status pips row (buff teal / debuff red), centered at cx, bottom at y. Returns the row height used. */
export function drawStatusPips(ctx: CanvasRenderingContext2D, cx: number, y: number, statuses: StatusInstance[], max = 6): number {
  const n = Math.min(max, statuses.length);
  if (n === 0) return 0;
  const size = 6;
  const gap = 2;
  const total = n * size + (n - 1) * gap;
  let x = cx - total / 2;
  for (let i = 0; i < n; i++) {
    const st = statuses[i];
    const debuff = DEBUFFS.has(st.id);
    ctx.fillStyle = COLORS.barFrame;
    ctx.fillRect(x - 1, y - size - 1, size + 2, size + 2);
    ctx.fillStyle = debuff ? COLORS.debuff : COLORS.buff;
    const frac = st.total > 0 ? Math.max(0.25, Math.min(1, st.remaining / st.total)) : 1;
    ctx.fillRect(x, y - size * frac, size, size * frac);
    x += size + gap;
  }
  return size + 3;
}

export function drawLocalMarker(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, color: string, time: number): void {
  const bob = Math.sin(time * 4.5) * 3;
  const y = bottomY - 6 + bob;
  const w = 13;
  const h = 13;
  ctx.beginPath();
  ctx.moveTo(cx - w, y - h);
  ctx.lineTo(cx + w, y - h);
  ctx.lineTo(cx, y);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#05060a';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

export function drawStunStars(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, time: number): void {
  ctx.fillStyle = '#ffe066';
  ctx.strokeStyle = '#7a5c00';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const rx = Math.max(12, w * 0.45);
  for (let i = 0; i < 3; i++) {
    const a = time * 5 + (i * TAU) / 3;
    addStar(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * rx * 0.35, 4.5, time * 3);
  }
  ctx.fill();
  ctx.stroke();
}

/** Height (z) in px for a world height in units. */
export const zPx = (units: number) => units * PX_PER_UNIT_Z;
