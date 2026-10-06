// 기획 13차 궁극기 컷인 + 화면 효과 (docs/skill-renewal.md 2-3, 2-2, 2-7 "CutIn", "WorldDim / Desaturate / Spotlight /
// Vignette", "ScreenFlash", "ScreenSlash"). The sim never stops for a cut-in (3-player server sim): the ult's data has a
// 0.5 s cast + guard and every effect lands ≥ 0.45 s after the tap, so the band leaves exactly as the first hit lands.
//   · my ult: the world (not the HUD, the caster or the numbers) dims 40 %, a slanted band in the character colour slides
//     in with a code-drawn portrait and the skill name, speed lines; at 0.36–0.45 s it slides out behind a white wipe.
//     Per-character variants: berserker red vignette, shadow band slashed in two, exorcist ink brush band + seal stamp,
//     puppeteer stage curtain, chrono desaturation, medic siren light, mage frost vignette.
//   · another player's / a bot's ult: no dimming — a quarter-size banner top-left for 0.6 s.
//   · "컷인 짧게" (CUTIN.short, pause menu): 0.25 s small banner only. The data timing is the same either way.

import { LOGICAL_H, LOGICAL_W } from '../types';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from './camera';
import { FONT_STACK, boldFont, darken, lighten, mix, type UnitLook } from './look';
import { TAU } from './shapes';
import { HERO_POSE, bodyWidth, drawBody } from './units';

/** Device-local cut-in setting (pause menu "컷인 짧게", persisted by ui/storage). */
export interface CutInSettings {
  short: boolean;
}
export const CUTIN: CutInSettings = { short: false };
export function sanitizeCutIn(raw: unknown): CutInSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { short: r.short === true };
}

/** Full cut-in length (s): the data's ult cast + guard (config ULT_CUTIN.guard). */
export const CUTIN_SEC = 0.5;
/** "컷인 짧게": a small banner only. */
export const CUTIN_SHORT_SEC = 0.25;
/** Another player's ult: the corner banner. */
export const MINI_BANNER_SEC = 0.6;
/** World dim of my cut-in (2-3: 40 %). */
export const CUTIN_DIM = 0.4;

export type CutInVariant = 'plain' | 'rage' | 'slash' | 'ink' | 'curtain' | 'desat' | 'siren' | 'frost';
const VARIANT: Record<string, CutInVariant> = {
  berserker: 'rage',
  shadow: 'slash',
  exorcist: 'ink',
  puppeteer: 'curtain',
  chrono: 'desat',
  medic: 'siren',
  mage: 'frost',
};

export function cutInVariant(defId: string): CutInVariant {
  return VARIANT[defId] ?? 'plain';
}

/** Test hook (ProtoApi.ui.cutIns, 기획 13차): what this screen showed for an ult — my band or someone's corner banner. */
export interface CutInShown {
  kind: 'full' | 'short' | 'mini';
  name: string;
  /** Caster's player name (mini only). */
  who: string;
}

/** The test log keeps only the last few. */
const SHOWN_MAX = 8;

interface Mini {
  age: number;
  look: UnitLook | null;
  color: string;
  who: string;
  name: string;
}

const ease = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Band geometry (logical px): centre y, height ≈ 38 % of the screen, the slant of its ends. */
const BAND_Y = 300;
const BAND_H = 0.38 * LOGICAL_H;
const BAND_SLANT = Math.tan((30 * Math.PI) / 180) * BAND_H;
/** A slight tilt (the band's ends are slanted 30°). */
const BAND_TILT = -0.07;
/** The band runs past both screen edges so its slanted ends only show while it slides. */
const BAND_L = -240;
const BAND_W = LOGICAL_W + 480;
const BAND_TOP = BAND_Y - BAND_H / 2;
const BAND_PAD = 8;

export class CutIn {
  active = false;
  age = 0;
  dur = CUTIN_SEC;
  short = false;
  defId = '';
  name = '';
  sub = '';
  color = '#ffffff';
  look: UnitLook | null = null;
  variant: CutInVariant = 'plain';
  /** The caster entity (index.ts draws it over the dim). */
  casterId = -1;
  private readonly minis: Mini[] = [];
  /** Test hook: the last SHOWN_MAX cut-ins / corner banners, oldest first (never read by the drawing). */
  readonly shown: CutInShown[] = [];
  private bandCache: HTMLCanvasElement | null = null;
  private bandKey = '';

  reset(): void {
    this.active = false;
    this.minis.length = 0;
    this.casterId = -1;
  }

  /** My ult was tapped (ultCast). */
  start(defId: string, name: string, color: string, look: UnitLook | null, casterId: number): void {
    this.active = true;
    this.age = 0;
    this.short = CUTIN.short;
    this.dur = this.short ? CUTIN_SHORT_SEC : CUTIN_SEC;
    this.defId = defId;
    this.name = name;
    this.sub = look ? `${look.name} · 궁극기` : '궁극기';
    this.color = color;
    this.look = look;
    this.variant = cutInVariant(defId);
    this.casterId = casterId;
    this.note({ kind: this.short ? 'short' : 'full', name, who: '' });
  }

  /** Another player's / a bot's ult: the small corner banner (two at most, the newest on top). */
  mini(look: UnitLook | null, color: string, who: string, name: string): void {
    if (this.minis.length >= 2) this.minis.shift();
    this.minis.push({ age: 0, look, color, who, name });
    this.note({ kind: 'mini', name, who });
  }

  private note(s: CutInShown): void {
    this.shown.push(s);
    if (this.shown.length > SHOWN_MAX) this.shown.shift();
  }

  update(dt: number): void {
    if (this.active) {
      this.age += dt;
      if (this.age >= this.dur) {
        this.active = false;
        this.casterId = -1;
      }
    }
    for (let i = this.minis.length - 1; i >= 0; i--) {
      this.minis[i].age += dt;
      if (this.minis[i].age >= MINI_BANNER_SEC) this.minis.splice(i, 1);
    }
  }

  /** World dim (0..CUTIN_DIM) this frame: down in 0.08 s, held, back up over the last 0.08 s. */
  dim(): number {
    if (!this.active || this.short) return 0;
    const t = this.age;
    const k = Math.min(clamp01(t / 0.08), clamp01((this.dur - t) / 0.08));
    return CUTIN_DIM * k;
  }

  /** Chrono's cut-in drains the colour out of the world (0..1). */
  desat(): number {
    return this.variant === 'desat' ? this.dim() / CUTIN_DIM : 0;
  }

  /** Screen layer (logical px, unshaken): the band / small banner, its variant decor, the corner banners. */
  draw(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.active) {
      if (this.short) this.drawSmall(ctx, this.age / this.dur, time);
      else this.drawFull(ctx, time);
    }
    for (let i = 0; i < this.minis.length; i++) drawMini(ctx, this.minis[i], i, time);
    ctx.globalAlpha = 1;
  }

  // ── full cut-in ──

  private drawFull(ctx: CanvasRenderingContext2D, time: number): void {
    const t = this.age;
    const v = this.variant;
    // variant decor under the band
    if (v === 'rage') edgeGlow(ctx, '#ff2a1a', 0.55 * this.dim() / CUTIN_DIM);
    else if (v === 'frost') edgeGlow(ctx, '#bfefff', 0.5 * this.dim() / CUTIN_DIM);
    else if (v === 'siren') siren(ctx, t, this.dim() / CUTIN_DIM);
    if (v === 'curtain') curtain(ctx, t, this.dur);
    // band slide: in over 0.12 s from the right, out over 0.36–0.45 s to the left
    const inK = ease(clamp01(t / 0.12));
    const outK = clamp01((t - 0.36) / 0.09);
    const shift = (1 - inK) * (LOGICAL_W + 480) - outK * outK * (LOGICAL_W + 720);
    ctx.save();
    ctx.translate(LOGICAL_W / 2, BAND_Y);
    ctx.rotate(BAND_TILT);
    ctx.translate(-LOGICAL_W / 2 + shift, -BAND_Y);
    if (v === 'slash' && outK > 0) this.drawSplitBand(ctx, outK, time);
    else this.drawBand(ctx, time, 1);
    ctx.restore();
    // white wipe 0.39 → 0.45: a slanted white sheet sweeping across, then the first hit lands
    const w = clamp01((t - 0.39) / 0.06);
    if (w > 0 && w < 1) {
      const x = -300 + w * (LOGICAL_W + 600);
      ctx.globalAlpha = 0.55 * (1 - Math.abs(w - 0.5) * 1.2);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x - 140, 0);
      ctx.lineTo(x + 60, 0);
      ctx.lineTo(x - 80, LOGICAL_H);
      ctx.lineTo(x - 280, LOGICAL_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The band (in band space, centred on BAND_Y). alpha = overall. Everything but the speed lines is painted once per
   * cut-in into an offscreen canvas at the screen's pixel scale (a held band is one drawImage, not ~20 fills + big text —
   * the phone keeps its frame rate when ults come back to back); tests / workers without a DOM paint it directly.
   */
  private drawBand(ctx: CanvasRenderingContext2D, time: number, alpha: number): void {
    const img = this.bandImage(ctx, time);
    ctx.globalAlpha = alpha;
    if (img) ctx.drawImage(img, BAND_L, BAND_TOP - BAND_PAD, BAND_W, BAND_H + 2 * BAND_PAD);
    else this.paintBand(ctx, time);
    // speed lines (streaming left), kept inside the slanted ends
    const ink = this.variant === 'ink';
    ctx.globalAlpha = alpha * (ink ? 0.25 : 0.5);
    ctx.fillStyle = ink ? '#1b1b1b' : '#ffffff';
    const x0 = BAND_L + BAND_SLANT;
    const x1 = BAND_L + BAND_W - BAND_SLANT;
    for (let i = 0; i < 14; i++) {
      const yy = BAND_TOP + 10 + ((i * 37) % (BAND_H - 20));
      const len = 120 + ((i * 53) % 160);
      const xx = x1 - (((time * 2600 + i * 197) % (x1 - x0 + len)) | 0);
      const a = Math.max(x0, xx);
      const b = Math.min(x1, xx + len);
      if (b > a) ctx.fillRect(a, yy, b - a, i % 3 === 0 ? 3 : 1.5);
    }
    ctx.globalAlpha = alpha;
  }

  /** The band's static picture for this cut-in (null without a DOM). */
  private bandImage(ctx: CanvasRenderingContext2D, time: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const scale = Math.max(1, Math.min(3, m && Number.isFinite(m.a) ? Math.hypot(m.a, m.b) : 1));
    const key = `${this.defId}|${this.name}|${scale.toFixed(3)}`;
    if (this.bandCache && this.bandKey === key) return this.bandCache;
    try {
      const c = this.bandCache ?? document.createElement('canvas');
      c.width = Math.ceil(BAND_W * scale);
      c.height = Math.ceil((BAND_H + 2 * BAND_PAD) * scale);
      const g = c.getContext('2d');
      if (!g) return null;
      g.setTransform(scale, 0, 0, scale, -BAND_L * scale, -(BAND_TOP - BAND_PAD) * scale);
      g.clearRect(BAND_L, BAND_TOP - BAND_PAD, BAND_W, BAND_H + 2 * BAND_PAD);
      this.paintBand(g, time);
      this.bandCache = c;
      this.bandKey = key;
      return c;
    } catch {
      return null;
    }
  }

  /** Band body, stripe, portrait, edges and the name (no speed lines), at globalAlpha 1. */
  private paintBand(ctx: CanvasRenderingContext2D, time: number): void {
    const top = BAND_TOP;
    const bot = BAND_TOP + BAND_H;
    const L = BAND_L;
    const R = BAND_L + BAND_W;
    const ink = this.variant === 'ink';
    const base = ctx.globalAlpha;
    // band body: character colour → darker, slanted ends
    bandPath(ctx, L, R, top, bot);
    ctx.fillStyle = ink ? '#efe6d6' : darken(this.color, 0.35);
    ctx.fill();
    ctx.save();
    bandPath(ctx, L, R, top, bot);
    ctx.clip();
    if (ink) inkStrokes(ctx, L, R, top, bot);
    else {
      ctx.globalAlpha = base * 0.8;
      ctx.fillStyle = this.color;
      ctx.fillRect(L, top + BAND_H * 0.62, R - L, BAND_H * 0.38);
    }
    // portrait: the code-drawn body, 2.8× and cut at the chest (상반신)
    if (this.look) {
      const w = bodyWidth(0.5) * 2.8;
      const h = w * this.look.heightMul;
      const fx = 330;
      const fy = bot + h * 0.32;
      ctx.globalAlpha = base * 0.35;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(fx + 14, fy - h * 0.55, w * 0.8, h * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = base;
      HERO_POSE.swing = -1.4;
      drawBody(ctx, this.look, 'character', fx, fy, w, h, 1, time, 0, false);
      HERO_POSE.swing = 0;
    }
    ctx.restore();
    // edges in the character colour (dark for ink)
    ctx.globalAlpha = base;
    ctx.lineWidth = 6;
    ctx.strokeStyle = ink ? '#1b1b1b' : lighten(this.color, 0.5);
    ctx.beginPath();
    ctx.moveTo(L + BAND_SLANT, top);
    ctx.lineTo(R, top);
    ctx.moveTo(L, bot);
    ctx.lineTo(R - BAND_SLANT, bot);
    ctx.stroke();
    // name: bold white with a character-colour outline (34 px × 1.4: ~26 CSS px on a phone); the sub line above it
    const tx = 520;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 17px ${FONT_STACK}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#05060a';
    ctx.strokeText(this.sub, tx, BAND_Y - 26);
    ctx.fillStyle = ink ? '#a4161a' : lighten(this.color, 0.6);
    ctx.fillText(this.sub, tx, BAND_Y - 26);
    ctx.font = boldFont(34 * 1.4);
    ctx.lineWidth = 9;
    ctx.strokeStyle = ink ? '#1b1b1b' : mix(this.color, '#000000', 0.25);
    ctx.strokeText(this.name, tx, BAND_Y + 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.name, tx, BAND_Y + 26);
    if (ink) sealStamp(ctx, tx + Math.min(560, ctx.measureText(this.name).width) + 54, BAND_Y + 6);
  }

  /** Shadow: the band leaves cut in two along a slash (top half up-left, bottom half down-right). */
  private drawSplitBand(ctx: CanvasRenderingContext2D, k: number, time: number): void {
    for (let half = 0; half < 2; half++) {
      ctx.save();
      ctx.beginPath();
      if (half === 0) ctx.rect(-400, -200, LOGICAL_W + 800, BAND_Y + 200 - 6);
      else ctx.rect(-400, BAND_Y + 6, LOGICAL_W + 800, LOGICAL_H);
      ctx.clip();
      ctx.translate(half === 0 ? -k * 120 : k * 120, half === 0 ? -k * 90 : k * 90);
      this.drawBand(ctx, time, 1 - k);
      ctx.restore();
    }
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-200, BAND_Y - 3, LOGICAL_W + 400, 6);
  }

  // ── "컷인 짧게": a small banner low on the screen (the old one) ──

  private drawSmall(ctx: CanvasRenderingContext2D, p: number, time: number): void {
    const slide = p < 0.3 ? 1 - ease(p / 0.3) : p > 0.75 ? ((p - 0.75) / 0.25) ** 2 : 0;
    const alpha = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
    const cy = 530;
    const h = 58;
    const bw = 620;
    const L = LOGICAL_W - bw + slide * (bw + 80);
    ctx.globalAlpha = alpha * 0.85;
    bandPath(ctx, L, LOGICAL_W + 20, cy - h / 2, cy + h / 2, 28);
    ctx.fillStyle = '#080a12';
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.color;
    ctx.stroke();
    portraitDisc(ctx, this.look, this.color, L + 70, cy, 24, time);
    ctx.textAlign = 'left';
    ctx.font = `700 14px ${FONT_STACK}`;
    ctx.fillStyle = this.color;
    ctx.fillText(this.sub, L + 108, cy - 8);
    ctx.font = boldFont(26);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(this.name, L + 108, cy + 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.name, L + 108, cy + 20);
  }
}

// ─────────────────────────── pieces ───────────────────────────

function bandPath(ctx: CanvasRenderingContext2D, L: number, R: number, top: number, bot: number, slant = BAND_SLANT): void {
  ctx.beginPath();
  ctx.moveTo(L + slant, top);
  ctx.lineTo(R, top);
  ctx.lineTo(R - slant, bot);
  ctx.lineTo(L, bot);
  ctx.closePath();
}

/** Portrait in a disc: the body (≈1.2×) clipped to a circle in the character colour. */
function portraitDisc(ctx: CanvasRenderingContext2D, look: UnitLook | null, color: string, x: number, y: number, r: number, time: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = darken(color, 0.3);
  ctx.fill();
  if (look) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, TAU);
    ctx.clip();
    const w = r * 1.5;
    drawBody(ctx, look, 'character', x, y + r * 1.25, w, w * look.heightMul, 1, time, 0, false);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

/** Another player's ult: a quarter-size slanted banner top-left (under the player chips), 0.6 s. */
function drawMini(ctx: CanvasRenderingContext2D, m: Mini, slot: number, time: number): void {
  const p = m.age / MINI_BANNER_SEC;
  const slide = p < 0.2 ? 1 - ease(p / 0.2) : 0;
  const alpha = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
  const y = 154 + slot * 48;
  const h = 40;
  const w = 330;
  const L = 8 - slide * (w + 40);
  ctx.globalAlpha = alpha * 0.88;
  bandPath(ctx, L, L + w, y - h / 2, y + h / 2, 14);
  ctx.fillStyle = darken(m.color, 0.55);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.strokeStyle = m.color;
  ctx.stroke();
  portraitDisc(ctx, m.look, m.color, L + 34, y, 16, time);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = boldFont(17);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#05060a';
  const text = `${m.who} · ${m.name}`;
  ctx.strokeText(text, L + 58, y + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, L + 58, y + 1);
  ctx.textBaseline = 'alphabetic';
}

/** Coloured glow from the screen edges (two wide border strokes — cheap, no gradient). */
export function edgeGlow(ctx: CanvasRenderingContext2D, color: string, a: number): void {
  if (a <= 0.01) return;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35 * a;
  ctx.lineWidth = 170;
  ctx.strokeRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.globalAlpha = 0.5 * a;
  ctx.lineWidth = 56;
  ctx.strokeRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.globalAlpha = 1;
}

/** Medic: red / cyan siren light sweeping the screen edges. */
function siren(ctx: CanvasRenderingContext2D, t: number, a: number): void {
  const red = Math.sin(t * 28) > 0;
  ctx.globalAlpha = 0.45 * a;
  ctx.fillStyle = red ? '#ff4d6d' : '#bdf6ff';
  ctx.fillRect(red ? 0 : LOGICAL_W - 140, 0, 140, LOGICAL_H);
  ctx.globalAlpha = 1;
}

/** Puppeteer: a red stage curtain drops from the top (0–0.12 s) and lifts as the band leaves. */
function curtain(ctx: CanvasRenderingContext2D, t: number, dur: number): void {
  const down = ease(clamp01(t / 0.12)) * (1 - ease(clamp01((t - (dur - 0.14)) / 0.14)));
  const h = 0.3 * LOGICAL_H * down;
  if (h < 1) return;
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#7a0e2a';
  ctx.fillRect(0, 0, LOGICAL_W, h);
  ctx.fillStyle = '#5a0a1f';
  for (let x = 0; x < LOGICAL_W; x += 64) ctx.fillRect(x + 40, 0, 10, h);
  // scalloped hem
  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  for (let x = 0; x <= LOGICAL_W; x += 64) {
    ctx.moveTo(x, h);
    ctx.arc(x + 32, h, 32, Math.PI, 0, true);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Exorcist: black ink brush strokes across the paper band. */
function inkStrokes(ctx: CanvasRenderingContext2D, L: number, R: number, top: number, bot: number): void {
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.moveTo(L, top + BAND_H * 0.7);
  for (let x = L; x <= R; x += 40) ctx.lineTo(x, top + BAND_H * (0.68 + 0.05 * Math.sin(x * 0.03)));
  ctx.lineTo(R, bot);
  ctx.lineTo(L, bot);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(L, top, R - L, 10);
}

/** Exorcist: a red seal stamp (낙관) with 封. */
function sealStamp(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(-30, -30, 60, 60);
  ctx.fillStyle = '#fff0e8';
  ctx.font = boldFont(40);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('封', 0, 2);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ─────────────────────────── screen effects ───────────────────────────

/**
 * Screen-wide beats of the renewed skills: the full-screen flash (ult finales only), the berserker heartbeat / mage frost
 * vignettes, the puppeteer spotlight, the blade's screen-wide slash. World-layer ones (dim, desaturate, spotlight) are
 * drawn by index.ts between the world and the numbers (drawWorld); the rest over everything (drawTop).
 */
export class ScreenFx {
  readonly cutin = new CutIn();
  private flashT = 99;
  private flashDur = 0.09;
  private flashA = 0;
  private flashColor = '#ffffff';
  private vigT = 99;
  private vigDur = 0;
  private vigColor = '#ff2a1a';
  private vigA = 0;
  private vigBeat = 0;
  private spotT = 99;
  private spotDur = 0;
  private spotId = -1;
  private spotR = 4;
  private slashT = 99;
  private slashY = 0;
  private slashColor = '#ffffff';
  private desatT = 99;
  private desatDur = 0;

  reset(): void {
    this.cutin.reset();
    this.flashT = this.vigT = this.spotT = this.slashT = this.desatT = 99;
  }

  /** Full-screen flash (ult finale 0.08–0.1 s, alpha 0.35–0.4; others' at half). */
  flash(alpha: number, color = '#ffffff', dur = 0.09): void {
    if (alpha <= this.flashA * Math.max(0, 1 - this.flashT / this.flashDur)) return;
    this.flashT = 0;
    this.flashDur = dur;
    this.flashA = alpha;
    this.flashColor = color;
  }

  /** Edge vignette for dur s; beat > 0 = a heartbeat pulse at that rate (Hz). */
  vignette(color: string, alpha: number, dur: number, beat = 0): void {
    this.vigT = 0;
    this.vigDur = dur;
    this.vigColor = color;
    this.vigA = alpha;
    this.vigBeat = beat;
  }

  /** Dark outside a circle around an entity (puppeteer's stage). */
  spotlight(entityId: number, radius: number, dur: number): void {
    this.spotT = 0;
    this.spotDur = dur;
    this.spotId = entityId;
    this.spotR = radius;
  }

  /** A white line cutting the screen sideways at a world y (blade 일섬). */
  slash(worldY: number, color = '#ffffff'): void {
    this.slashT = 0;
    this.slashY = worldY;
    this.slashColor = color;
  }

  /** Drain colour out of the world for dur s (chrono stasis). */
  desaturate(dur: number): void {
    this.desatT = 0;
    this.desatDur = dur;
  }

  update(dt: number): void {
    this.cutin.update(dt);
    this.flashT += dt;
    this.vigT += dt;
    this.spotT += dt;
    this.slashT += dt;
    this.desatT += dt;
  }

  /** Anything on the world layer this frame (index.ts skips the pass otherwise). */
  worldActive(): boolean {
    return this.cutin.dim() > 0 || this.spotT < this.spotDur || this.desatT < this.desatDur;
  }

  /** World layer (after the units / skill effects, before the numbers): dim, desaturate, spotlight. */
  drawWorld(ctx: CanvasRenderingContext2D, cam: Camera, entityPos: (id: number, out: { x: number; y: number }) => boolean): void {
    const desat = Math.max(this.cutin.desat(), this.desatT < this.desatDur ? Math.min(1, this.desatT / 0.1, (this.desatDur - this.desatT) / 0.3) * 0.85 : 0);
    if (desat > 0.01) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = desat;
      ctx.fillStyle = '#808080';
      ctx.fillRect(-40, -40, LOGICAL_W + 80, LOGICAL_H + 80);
      ctx.globalCompositeOperation = 'source-over';
    }
    const dim = this.cutin.dim();
    if (dim > 0) {
      ctx.globalAlpha = dim;
      ctx.fillStyle = '#05060a';
      ctx.fillRect(-40, -40, LOGICAL_W + 80, LOGICAL_H + 80);
    }
    if (this.spotT < this.spotDur && entityPos(this.spotId, SPOT)) {
      const k = Math.min(1, this.spotT / 0.15, (this.spotDur - this.spotT) / 0.3);
      const sx = cam.sx(SPOT.x);
      const sy = cam.sy(SPOT.y);
      ctx.globalAlpha = 0.45 * k;
      ctx.fillStyle = '#05060a';
      ctx.beginPath();
      ctx.rect(-40, -40, LOGICAL_W + 80, LOGICAL_H + 80);
      ctx.ellipse(sx, sy, this.spotR * PX_PER_UNIT, this.spotR * PX_PER_UNIT_Y, 0, 0, TAU, true);
      ctx.fill('evenodd');
      // the light cone from above
      ctx.globalAlpha = 0.12 * k;
      ctx.fillStyle = '#fff6d5';
      ctx.beginPath();
      ctx.moveTo(sx - 40, 0);
      ctx.lineTo(sx + 40, 0);
      ctx.lineTo(sx + this.spotR * PX_PER_UNIT, sy);
      ctx.lineTo(sx - this.spotR * PX_PER_UNIT, sy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Top layer (unshaken, over the world and the numbers): vignette, slash, flash, the cut-in band / banners. */
  drawTop(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    if (this.vigT < this.vigDur) {
      const k = Math.min(1, this.vigT / 0.12, (this.vigDur - this.vigT) / 0.4);
      const beat = this.vigBeat > 0 ? 0.55 + 0.45 * Math.pow(Math.max(0, Math.sin(this.vigT * this.vigBeat * Math.PI)), 6) : 1;
      edgeGlow(ctx, this.vigColor, this.vigA * k * beat);
    }
    if (this.slashT < 0.32) {
      const p = this.slashT / 0.32;
      const y = cam.sy(this.slashY) - 30;
      const grow = ease(Math.min(1, p / 0.25));
      ctx.globalAlpha = (1 - p) * 0.95;
      ctx.fillStyle = this.slashColor;
      ctx.fillRect(0, y - 3 * (1 - p), LOGICAL_W * grow, 6 * (1 - p) + 2);
      ctx.globalAlpha = (1 - p) * 0.35;
      ctx.fillRect(0, y - 14, LOGICAL_W * grow, 28);
    }
    if (this.flashT < this.flashDur + FLASH_FADE) {
      const p = this.flashT < this.flashDur ? 1 : 1 - (this.flashT - this.flashDur) / FLASH_FADE;
      ctx.globalAlpha = this.flashA * p;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    ctx.globalAlpha = 1;
    this.cutin.draw(ctx, time);
  }
}

const SPOT = { x: 0, y: 0 };
/** The screen flash dies out this fast after its 0.08–0.1 s (2-2). */
const FLASH_FADE = 0.07;
