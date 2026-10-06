// 기획 13차 상태 연출 (docs/skill-renewal.md 2-5, 5-2): taunt / tether / root / stasis / charm on enemies, splashUp on
// allies, plus the head icons (12–14 px, at most two per enemy: 도발 「!」, 낙인 십자, 족쇄, X 표식, 「혼」, 「약」, 조종 손잡이,
// 정지 시계). Drawn by index.ts from the entity snapshot (statuses + their data), so it works the same in multiplayer.
// Per frame `frame(state)` notes who is charmed / has splashUp (for attack tints) without allocating.

import type { Entity, GameState, StatusId, StatusInstance } from '../types';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from './camera';
import { boldFont } from './look';
import { TAU, pathCapsule } from './shapes';

/** Head icon order (first two present win). */
const ICON_ORDER: readonly StatusId[] = ['stasis', 'charm', 'taunt', 'tether', 'root', 'vulnerable', 'drain', 'atkDown'];
export const MAX_HEAD_ICONS = 2;
export const HEAD_ICON_PX = 14;

export const STATUS_COLOR = {
  taunt: '#5b8def',
  tether: '#80b918',
  root: '#a4161a',
  stasis: '#b8c0ff',
  charm: '#ff5fa2',
  splashUp: '#ff7a45',
} as const;

/** Who marked a vulnerable enemy (from the last skill hit): paladin's cross, shadow's X, or plain. */
type VulnMark = 'cross' | 'x' | 'plain';

export class StatusFx {
  private readonly charmed = new Set<number>();
  private readonly splash = new Set<number>();
  private readonly stoppedIds = new Set<number>();
  /** 기획 13차 크로노 정지: damage seen on a stopped unit (Σ over its head), by entity. */
  private readonly sigma = new Map<number, number>();
  private readonly vuln = new Map<number, VulnMark>();
  private stamp = 0;

  reset(): void {
    this.charmed.clear();
    this.splash.clear();
    this.stoppedIds.clear();
    this.sigma.clear();
    this.vuln.clear();
  }

  /** Once per frame: who is charmed / has splashUp; stopped units that are no longer stopped forget their Σ. */
  frame(state: GameState): void {
    this.charmed.clear();
    this.splash.clear();
    this.stoppedIds.clear();
    this.stamp++;
    for (const e of state.entities) {
      const sts = e.statuses;
      if (sts.length === 0) continue;
      for (let i = 0; i < sts.length; i++) {
        const id = sts[i].id;
        if (id === 'charm') this.charmed.add(e.id);
        else if (id === 'splashUp') this.splash.add(e.id);
        else if (id === 'stasis') this.stoppedIds.add(e.id);
      }
    }
    if (this.sigma.size) for (const id of this.sigma.keys()) if (!this.stoppedIds.has(id)) this.sigma.delete(id);
    if (this.vuln.size > 96) this.vuln.clear();
  }

  isCharmed(id: number): boolean {
    return this.charmed.has(id);
  }

  isStopped(id: number): boolean {
    return this.stoppedIds.has(id);
  }

  hasSplash(id: number): boolean {
    return this.splash.has(id);
  }

  /** A hit landed on a unit: Σ while it is stopped; which character marked it vulnerable. */
  onDamage(targetId: number, amount: number, skillOwner: string | null, stoppedNow: boolean): void {
    if (stoppedNow) this.sigma.set(targetId, (this.sigma.get(targetId) ?? 0) + amount);
    if (skillOwner === 'paladin') this.vuln.set(targetId, 'cross');
    else if (skillOwner === 'shadow') this.vuln.set(targetId, 'x');
  }

  sigmaOf(id: number): number {
    return this.sigma.get(id) ?? 0;
  }

  clearSigma(id: number): void {
    this.sigma.delete(id);
  }

  // ─────────────────────────── ground (under the body) ───────────────────────────

  /** Tether chains to the anchor ring when straining, root tendrils, the splashUp fire ring. */
  drawGround(ctx: CanvasRenderingContext2D, cam: Camera, e: Entity, sx: number, sy: number, time: number): void {
    const sts = e.statuses;
    for (let i = 0; i < sts.length; i++) {
      const st = sts[i];
      if (st.id === 'tether') tetherChain(ctx, cam, e, st, sx, sy, time);
      else if (st.id === 'root') rootTendrils(ctx, e, sx, sy, time);
      else if (st.id === 'splashUp') fireRing(ctx, e, sx, sy, time);
    }
    ctx.globalAlpha = 1;
  }

  // ─────────────────────────── body overlay ───────────────────────────

  /** Stasis: the body goes grey (colour drained, a cold wash); charm: a pink wash. */
  drawBodyOverlay(ctx: CanvasRenderingContext2D, e: Entity, fx: number, fy: number, w: number, h: number): void {
    const stasis = has(e, 'stasis');
    const charm = !stasis && this.charmed.has(e.id);
    if (!stasis && !charm) return;
    pathCapsule(ctx, fx, fy, w + 4, h + 4);
    if (stasis) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#808080';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#d7dcff';
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e7eaff';
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = STATUS_COLOR.charm;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ─────────────────────────── over the head ───────────────────────────

  /**
   * Up to two status icons centred at cx, bottom at y (screen px); the puppet strings for a charmed unit; Σ over a
   * stopped one. Returns the height used.
   */
  drawHead(ctx: CanvasRenderingContext2D, e: Entity, cx: number, y: number, time: number): number {
    if (e.team !== 'enemy' || e.statuses.length === 0) return 0;
    let n = 0;
    let a: StatusId | null = null;
    let b: StatusId | null = null;
    for (let i = 0; i < ICON_ORDER.length && n < MAX_HEAD_ICONS; i++) {
      if (!has(e, ICON_ORDER[i])) continue;
      if (n === 0) a = ICON_ORDER[i];
      else b = ICON_ORDER[i];
      n++;
    }
    if (n === 0) return 0;
    const s = HEAD_ICON_PX;
    const gap = 4;
    const total = n * s + (n - 1) * gap;
    const y0 = y - s / 2;
    if (a) this.icon(ctx, a, e, cx - total / 2 + s / 2, y0, s, time);
    if (b) this.icon(ctx, b, e, cx - total / 2 + s * 1.5 + gap, y0, s, time);
    let used = s + 2;
    if (has(e, 'charm')) puppetStrings(ctx, cx, y - used, time + e.id);
    const sum = has(e, 'stasis') ? this.sigma.get(e.id) ?? 0 : 0;
    if (sum >= 1) {
      ctx.font = boldFont(15);
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#141633';
      const text = `Σ ${Math.round(sum)}`;
      ctx.strokeText(text, cx, y - used - 2);
      ctx.fillStyle = '#e7eaff';
      ctx.fillText(text, cx, y - used - 2);
      used += 17;
    }
    ctx.globalAlpha = 1;
    return used;
  }

  private icon(ctx: CanvasRenderingContext2D, id: StatusId, e: Entity, x: number, y: number, s: number, time: number): void {
    const r = s / 2;
    // dark disc behind every icon (reads over any ground)
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#0b0d14';
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    switch (id) {
      case 'stasis': {
        ctx.lineWidth = 2;
        ctx.strokeStyle = STATUS_COLOR.stasis;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - r * 0.7);
        ctx.moveTo(x, y);
        ctx.lineTo(x + r * 0.5, y);
        ctx.stroke();
        break;
      }
      case 'charm': {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = STATUS_COLOR.charm;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r * 0.3);
        ctx.lineTo(x + r, y - r * 0.3);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y + r * 0.4);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r * 0.3);
        ctx.lineTo(x - r, y + r);
        ctx.moveTo(x + r, y - r * 0.3);
        ctx.lineTo(x + r, y + r);
        ctx.stroke();
        break;
      }
      case 'taunt':
        glyphIcon(ctx, '!', x, y, s + 2, STATUS_COLOR.taunt);
        break;
      case 'tether':
      case 'root': {
        // shackle: a ring and a link
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = id === 'tether' ? STATUS_COLOR.tether : '#ff6b6b';
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y + r * 0.1, r * 0.6, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x + r * 0.55, y - r * 0.45, r * 0.45, r * 0.25, -0.7, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'vulnerable': {
        const mark = this.vuln.get(e.id) ?? 'plain';
        ctx.lineWidth = 3;
        ctx.strokeStyle = mark === 'cross' ? '#ffd166' : mark === 'x' ? '#c9b8ff' : '#ffffff';
        ctx.beginPath();
        if (mark === 'cross') {
          ctx.moveTo(x, y - r);
          ctx.lineTo(x, y + r);
          ctx.moveTo(x - r, y - r * 0.15);
          ctx.lineTo(x + r, y - r * 0.15);
        } else {
          ctx.moveTo(x - r * 0.75, y - r * 0.75);
          ctx.lineTo(x + r * 0.75, y + r * 0.75);
          ctx.moveTo(x + r * 0.75, y - r * 0.75);
          ctx.lineTo(x - r * 0.75, y + r * 0.75);
        }
        ctx.stroke();
        break;
      }
      case 'drain':
        glyphIcon(ctx, '혼', x, y, s - 1, '#ff5c5c');
        break;
      case 'atkDown':
        glyphIcon(ctx, '약', x, y, s - 1, '#ffb3c6');
        break;
      default:
        break;
    }
    ctx.lineCap = 'butt';
    void time;
  }
}

function has(e: Entity, id: StatusId): boolean {
  const sts = e.statuses;
  for (let i = 0; i < sts.length; i++) if (sts[i].id === id) return true;
  return false;
}

/** True when the entity is stopped by a stasis (index.ts freezes its pose). */
export function isStopped(e: Entity): boolean {
  return has(e, 'stasis');
}

function glyphIcon(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: number, color: string): void {
  ctx.font = boldFont(s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 1);
  ctx.textBaseline = 'alphabetic';
}

/** A tethered enemy straining at its fence: a short chain from it back to the ring, shaking. */
function tetherChain(ctx: CanvasRenderingContext2D, cam: Camera, e: Entity, st: StatusInstance, sx: number, sy: number, time: number): void {
  const anchor = st.data?.anchor;
  const R = st.data?.radius ?? st.value;
  if (!anchor || !(R > 0)) return;
  const dx = e.pos.x - anchor.x;
  const dy = e.pos.y - anchor.y;
  const d = Math.hypot(dx, dy);
  // only near the edge (≥ 70 % out): the fence holds it there
  if (d < R * 0.7 || d < 0.05) return;
  const ex = anchor.x + (dx / d) * R;
  const ey = anchor.y + (dy / d) * R;
  const ax = cam.sx(ex);
  const ay = cam.sy(ey);
  const shake = Math.sin(time * 45 + e.id) * 2;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2b3320';
  ctx.setLineDash(LINKS);
  ctx.beginPath();
  ctx.moveTo(ax, ay - 8);
  ctx.quadraticCurveTo((ax + sx) / 2 + shake, (ay + sy) / 2 - 2, sx, sy - 10);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#c7e59a';
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
}

const LINKS = [6, 3];
const NO_DASH: number[] = [];

/** Rooted: dark-red ink tendrils curling up around the feet. */
function rootTendrils(ctx: CanvasRenderingContext2D, e: Entity, sx: number, sy: number, time: number): void {
  const r = e.radius * PX_PER_UNIT;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3a0a0c';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const bx = sx + Math.cos(a) * r * 0.9;
    const by = sy + Math.sin(a) * r * 0.45;
    const sway = Math.sin(time * 5 + i) * 3;
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + sway, by - 12, bx - Math.cos(a) * 5, by - 20);
  }
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#c1121f';
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 1.05, r * 1.05 * (PX_PER_UNIT_Y / PX_PER_UNIT), 0, 0, TAU);
  ctx.stroke();
}

/** splashUp (버서커 광란): a flickering fire ring at the feet. */
function fireRing(ctx: CanvasRenderingContext2D, e: Entity, sx: number, sy: number, time: number): void {
  const r = (e.radius + 0.35 + 0.05 * Math.sin(time * 18)) * PX_PER_UNIT;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4;
  ctx.strokeStyle = STATUS_COLOR.splashUp;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * (PX_PER_UNIT_Y / PX_PER_UNIT), 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffd166';
  ctx.stroke();
}

/** Charmed: three pink strings from a swaying control bar above down to the head. */
function puppetStrings(ctx: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
  const sway = Math.sin(t * 2.4) * 6;
  const top = y - 30;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = STATUS_COLOR.charm;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(cx + sway + i * 12, top);
    ctx.lineTo(cx + i * 6, y);
  }
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8d5a3b';
  ctx.beginPath();
  ctx.moveTo(cx + sway - 16, top);
  ctx.lineTo(cx + sway + 16, top);
  ctx.moveTo(cx + sway, top - 8);
  ctx.lineTo(cx + sway, top + 6);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
