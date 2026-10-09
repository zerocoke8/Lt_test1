// 기획 15차 원정: menu pieces shared by the expedition screens — the breathing gear doll (the battle drawing, scaled up;
// one shared rAF loop redraws the dolls that are on screen) and the item tile (band border, icon, T, NEW, ▲, stars).

import type { GearBands, GearItem, GearLoadout, GearSlot, GearSpec } from '../data/gear';
import { BAND_COLOR, GEAR_SLOTS, RARITY_STARS, bandOf, gearBandsOf } from '../data/gear';
import { getCharacter } from '../data';
import { drawHeroDoll, gearPicture } from '../render/gearArt';
import { ROLE_GLYPH } from './format';
import { button, h } from './dom';
import { familyOf } from './expeditionFormat';

/** Backing-store pixels per logical px (stage ≤ 1× on desktop, ≈ 1.6 device px per logical px on a 3× phone). */
const DOLL_RES = 2;

export interface Doll {
  readonly el: HTMLCanvasElement;
  set(charId: string, loadout: GearLoadout | null | undefined): void;
  /** Equip feedback (8-3): the body pops, a band-coloured ring spreads, a weapon swings once. */
  pop(slot: GearSlot, band: number): void;
}

interface DollState {
  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  charId: string;
  bands: GearBands | null;
  w: number;
  h: number;
  phase: number;
  popAt: number;
  popColor: string;
  popSwing: boolean;
}

const live = new Set<DollState>();
let loopOn = false;
const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

function drawDoll(d: DollState, now: number): void {
  const ctx = d.ctx;
  if (!ctx) return;
  const t = (now - t0) / 1000 + d.phase;
  ctx.setTransform(DOLL_RES, 0, 0, DOLL_RES, 0, 0);
  ctx.clearRect(0, 0, d.w, d.h);
  const pk = Math.max(0, 1 - (now - d.popAt) / 450);
  const bodyW = Math.min(d.w * 0.46, d.h * 0.36);
  const cx = d.w * 0.46;
  const foot = d.h * 0.9;
  if (pk > 0) {
    const r = bodyW * (0.6 + (1 - pk) * 1.3);
    ctx.globalAlpha = pk * 0.9;
    ctx.lineWidth = 5 * pk + 1;
    ctx.strokeStyle = d.popColor;
    ctx.beginPath();
    ctx.ellipse(cx, foot - bodyW * 0.6, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const scale = 1 + 0.12 * Math.sin(pk * Math.PI);
  ctx.save();
  ctx.translate(cx, foot);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -foot);
  const swing = d.popSwing && pk > 0 ? -1.2 * Math.sin(pk * Math.PI) : 0;
  drawHeroDoll(ctx, d.charId, d.bands, cx, foot, bodyW, t, { swing });
  ctx.restore();
}

function loop(now: number): void {
  let any = false;
  for (const d of live) {
    if (!d.el.isConnected) {
      live.delete(d);
      continue;
    }
    if (d.el.offsetParent === null) continue; // hidden screen
    any = true;
    drawDoll(d, now);
  }
  if (live.size > 0) requestAnimationFrame(loop);
  else loopOn = false;
  void any;
}

/** A gear doll canvas (w × h logical px). */
export function createDoll(parent: HTMLElement, cls: string, w: number, h: number, charId: string, loadout?: GearLoadout | null): Doll {
  const el = document.createElement('canvas');
  el.className = `exp-doll ${cls}`.trim();
  el.width = Math.round(w * DOLL_RES);
  el.height = Math.round(h * DOLL_RES);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  parent.appendChild(el);
  const d: DollState = { el, ctx: el.getContext('2d'), charId, bands: gearBandsOf(loadout), w, h, phase: live.size * 0.7, popAt: -1e9, popColor: '#ffffff', popSwing: false };
  live.add(d);
  drawDoll(d, typeof performance !== 'undefined' ? performance.now() : 0);
  if (!loopOn && typeof requestAnimationFrame !== 'undefined') {
    loopOn = true;
    requestAnimationFrame(loop);
  }
  return {
    el,
    set(id, l) {
      d.charId = id;
      d.bands = gearBandsOf(l);
      drawDoll(d, performance.now());
    },
    pop(slot, band) {
      d.popAt = performance.now();
      d.popColor = BAND_COLOR[band] || '#ffffff';
      d.popSwing = slot === 'weapon';
      if (!live.has(d)) live.add(d);
    },
  };
}

/** 4 slot dots under a name (band colours; empty = dark grey). */
export function slotPips(parent: HTMLElement, loadout: GearLoadout | null | undefined): HTMLElement {
  const row = h('div', 'exp-pips', parent);
  for (const slot of GEAR_SLOTS) {
    const g = loadout?.[slot];
    const p = h('span', `exp-pip slot-${slot}${g ? '' : ' is-empty'}`, row);
    if (g) p.style.setProperty('--bc', BAND_COLOR[bandOf(g.tier)]);
  }
  return row;
}

export interface TileOpts {
  /** Weapon look: a CHARACTER id (the one being looked at, else the party's first) — not a WeaponFamily. */
  family?: string | null;
  isNew?: boolean;
  /** Better than what the current character wears. */
  upgrade?: boolean;
  /** Who wears it (role letter at the corner). */
  wearer?: string | null;
  selected?: boolean;
  onClick?: () => void;
  size?: number;
}

/** An item tile (8-3): band border, centred picture, 'T7' top-left, NEW top-right, ▲ bottom-left, stars + wearer bottom-right. */
export function itemTile(parent: HTMLElement, g: GearSpec & Partial<Pick<GearItem, 'uid'>>, o: TileOpts = {}): HTMLElement {
  const band = bandOf(g.tier);
  const el = o.onClick ? button(`exp-tile band-${band}`, '', parent, o.onClick) : h('div', `exp-tile band-${band}`, parent);
  el.style.setProperty('--bc', BAND_COLOR[band]);
  if (o.size) el.style.setProperty('--ts', `${o.size}px`);
  if (g.slot === 'relic') el.classList.add('is-relic');
  if (o.selected) el.classList.add('is-selected');
  if (g.uid) el.dataset.uid = g.uid;
  el.dataset.slot = g.slot;
  el.dataset.tier = String(g.tier);
  const img = h('img', 'exp-tile-img', el);
  img.alt = '';
  img.draggable = false;
  img.src = gearPicture(g.slot, familyOf(o.family ?? null), g.tier, g.relicId, Math.round((o.size ?? 100) * 1.6));
  h('span', 'exp-tile-t', el, `T${g.tier}`);
  if (o.isNew) h('span', 'exp-tile-new', el, 'NEW');
  if (o.upgrade) h('span', 'exp-tile-up', el, '▲');
  const corner = (RARITY_STARS[g.rarity] || '') + (o.wearer ? ` ${ROLE_GLYPH[getCharacter(o.wearer).role]}` : '');
  if (corner.trim()) h('span', 'exp-tile-star', el, corner.trim());
  return el;
}
