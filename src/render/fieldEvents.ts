// 기획 12차 돌발 괴담 (docs/combat-events.md 2-4): everything the field shows for an event — gold rotating dashed rings
// with a shrinking timer, the '!' diamond and last-5-s digits over the event unit, the toad's crouch arc, the printer's
// print cycle, the patient's big HP bar, the shaft, the lamps, the sleepwalker's path / exit door / escort circle, the
// 23:59 edge vignette, gold off-screen arrows (above the red enemy ones) and the success / failure bursts.
// Render-only: reads the public GameState (state.fieldEvent + entities) and GameEvents; no sim imports beyond data.

import type { Entity, FieldEventState, GameEvent, GameState, Vec2 } from '../types';
import { LOGICAL_W } from '../types';
import { getFieldEvent } from '../data';
import { type Camera, PX_PER_UNIT, PX_PER_UNIT_Y, VIEW_WIDTH_UNITS } from './camera';
import { boldFont } from './look';
import { TAU } from './shapes';
import { bodyWidth } from './units';

const GOLD = '#ffd166';
const GOLD_DEEP = '#f4a261';
const INK = '#05060a';
const RING_DASH = [9, 7];
const DOT_DASH = [3, 7];
const NO_DASH: number[] = [];
/** Last seconds shown as a big number over the event unit. */
const COUNTDOWN = 5;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  kind: 'coin' | 'smoke' | 'spark';
}
interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  age: number;
  life: number;
}
interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  age: number;
  life: number;
  color: string;
}

const alive = (e: Entity | undefined): e is Entity => !!e && e.hp > 0;

/** The event's main unit (toad, printer, patient, child), if any. */
function mainUnit(state: GameState, ev: FieldEventState): Entity | undefined {
  if (ev.id === 'midnight_surge') return undefined;
  const id = ev.entityIds[0];
  return id == null ? undefined : state.entities.find(e => e.id === id && e.hp > 0);
}

/** Where the event is "at" (for arrows and bursts): the unit, else the unlit marks, else its spot. */
function focusPoints(state: GameState, ev: FieldEventState): Vec2[] {
  const u = mainUnit(state, ev);
  if (u) return [u.pos];
  if (ev.id === 'dark_lamps') return ev.marks.filter(m => m.doneBy == null).map(m => m.pos);
  if (ev.id === 'open_shaft' && ev.marks[0]) return [ev.marks[0].pos];
  return ev.id === 'midnight_surge' ? [] : [ev.pos];
}

export class FieldEventFx {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  /** Last focus spot of the running event (bursts after it ended). */
  private lastFocus: Vec2 | null = null;
  /** Lamps already flashed (a progress event names no lamp). */
  private readonly litSeen = new Set<string>();
  private seed = 1;

  reset(): void {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.lastFocus = null;
    this.litSeen.clear();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  handle(ev: GameEvent, state: GameState): void {
    switch (ev.type) {
      case 'fieldEventWarn':
      case 'fieldEventStart':
        this.lastFocus = { ...ev.pos };
        this.rings.push({ x: ev.pos.x, y: ev.pos.y, r0: 0.3, r1: 2.2, age: 0, life: 0.6, color: GOLD });
        break;
      case 'fieldEventProgress': {
        const fe = state.fieldEvent;
        if (ev.kind === 'fall' && fe?.marks[0]) {
          const h = fe.marks[0].pos;
          this.burst(h, 10, 'spark', -1);
          this.text(h, '추락!', GOLD, 26);
        } else if (ev.kind === 'lamp' && fe) {
          for (const m of fe.marks) {
            const key = `${m.pos.x},${m.pos.y}`;
            if (m.doneBy == null || this.litSeen.has(key)) continue;
            this.litSeen.add(key);
            this.rings.push({ x: m.pos.x, y: m.pos.y, r0: 0.4, r1: 3, age: 0, life: 0.5, color: '#fff3b0' });
            this.text(m.pos, '켜짐!', GOLD, 26);
          }
        } else if (ev.kind === 'kill' && fe) {
          const u = mainUnit(state, fe);
          if (u) this.text(u.pos, '+5% 처치', GOLD, 22);
        } else if (ev.kind === 'startle' && fe) {
          const u = mainUnit(state, fe);
          if (u) this.text(u.pos, '으앙!', '#ff6b6b', 28);
        }
        break;
      }
      case 'fieldEventEnd': {
        const at = this.lastFocus;
        if (!at) break;
        if (ev.success) {
          this.burst(at, 26, 'coin', 1);
          this.rings.push({ x: at.x, y: at.y, r0: 0.4, r1: 3.2, age: 0, life: 0.7, color: GOLD });
          this.text(at, '성공!', GOLD, 34);
        } else {
          this.burst(at, 12, 'smoke', 1);
          this.text(at, '놓쳤다…', '#c9ced6', 28);
        }
        this.lastFocus = null;
        this.litSeen.clear();
        break;
      }
      case 'damage':
        if (ev.weak) this.text({ x: ev.pos.x + 0.35, y: ev.pos.y }, '약점', GOLD, 20, 0.7);
        break;
    }
  }

  private text(at: Vec2, text: string, color: string, size: number, life = 1.1): void {
    if (this.texts.length > 24) this.texts.shift();
    this.texts.push({ x: at.x, y: at.y, text, color, size, age: 0, life });
  }

  private burst(at: Vec2, n: number, kind: Particle['kind'], dir: 1 | -1): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * TAU;
      const sp = 1.5 + this.rand() * 3;
      const p: Particle =
        dir > 0
          ? { x: at.x, y: at.y, z: 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: 3 + this.rand() * 4, age: 0, life: 0.8 + this.rand() * 0.5, kind }
          : { x: at.x + Math.cos(a) * 1.6, y: at.y + Math.sin(a) * 1.6, z: 0.4, vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 3, vz: -0.5, age: 0, life: 0.5, kind };
      this.parts.push(p);
    }
    if (this.parts.length > 160) this.parts.splice(0, this.parts.length - 160);
  }

  update(dt: number): void {
    for (const p of this.parts) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= (p.kind === 'smoke' ? -1 : 12) * dt;
    }
    this.parts = this.parts.filter(p => p.age < p.life);
    for (const t of this.texts) t.age += dt;
    this.texts = this.texts.filter(t => t.age < t.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter(r => r.age < r.life);
  }

  // ─────────────────────────── ground ───────────────────────────

  drawGround(c: CanvasRenderingContext2D, cam: Camera, state: GameState, time: number): void {
    const ev = state.fieldEvent;
    if (ev) {
      const f = focusPoints(state, ev);
      if (f[0]) this.lastFocus = { ...f[0] };
      if (ev.stage === 'warn') this.drawWarn(c, cam, ev, time);
      else this.drawActiveGround(c, cam, state, ev, time);
    }
    for (const r of this.rings) {
      const k = r.age / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 2);
      c.globalAlpha = 0.9 * (1 - k);
      c.lineWidth = 4;
      c.strokeStyle = r.color;
      c.beginPath();
      c.ellipse(cam.sx(r.x), cam.sy(r.y), rad * PX_PER_UNIT, rad * PX_PER_UNIT_Y, 0, 0, TAU);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  private drawWarn(c: CanvasRenderingContext2D, cam: Camera, ev: FieldEventState, time: number): void {
    const blink = 0.55 + 0.45 * Math.sin(time * 14);
    const spots = ev.marks.length > 0 && ev.id !== 'sleepwalker' ? ev.marks.map(m => ({ p: m.pos, r: m.radius })) : [{ p: ev.pos, r: 1.1 }];
    if (ev.id === 'midnight_surge') return;
    for (const s of spots) goldRing(c, cam, s.p, s.r * (1.2 - 0.2 * (ev.warnRemaining % 0.5) * 2), time, blink, null);
  }

  private drawActiveGround(c: CanvasRenderingContext2D, cam: Camera, state: GameState, ev: FieldEventState, time: number): void {
    const frac = ev.total > 0 ? Math.max(0, Math.min(1, ev.remaining / ev.total)) : 0;
    const def = getFieldEvent(ev.id);
    const u = mainUnit(state, ev);
    switch (ev.id) {
      case 'open_shaft':
        if (ev.marks[0]) drawHole(c, cam, ev.marks[0].pos, ev.marks[0].radius, time, frac);
        return;
      case 'dark_lamps':
        for (const m of ev.marks) {
          if (!cam.visibleX(m.pos.x, 2)) continue;
          if (m.doneBy == null) {
            dottedCircle(c, cam, m.pos, m.radius, GOLD, 0.85, time);
          } else {
            const g = c.createRadialGradient(cam.sx(m.pos.x), cam.sy(m.pos.y), 4, cam.sx(m.pos.x), cam.sy(m.pos.y), 2.2 * PX_PER_UNIT);
            g.addColorStop(0, 'rgba(255,240,160,0.55)');
            g.addColorStop(1, 'rgba(255,240,160,0)');
            c.globalAlpha = 1;
            c.fillStyle = g;
            c.beginPath();
            c.ellipse(cam.sx(m.pos.x), cam.sy(m.pos.y), 2.2 * PX_PER_UNIT, 2.2 * PX_PER_UNIT_Y, 0, 0, TAU);
            c.fill();
          }
        }
        // the shared timer: a ring at the middle lamp
        if (ev.marks[1]) timerArc(c, cam, ev.marks[1].pos, 0.9, frac, ev.remaining);
        return;
      case 'sleepwalker': {
        const exit = ev.marks[0];
        if (exit && u) {
          c.globalAlpha = 0.8;
          c.setLineDash([6, 8]);
          c.lineDashOffset = -time * 24;
          c.lineWidth = 4;
          c.strokeStyle = GOLD;
          c.beginPath();
          c.moveTo(cam.sx(u.pos.x), cam.sy(u.pos.y));
          c.lineTo(cam.sx(exit.pos.x), cam.sy(exit.pos.y));
          c.stroke();
          c.setLineDash(NO_DASH);
          c.lineDashOffset = 0;
          dottedCircle(c, cam, u.pos, def.params.escort, GOLD, 0.45, time);
        }
        break;
      }
      case 'sleeping_patient':
        if (u) dottedCircle(c, cam, u.pos, def.params.killRadius, GOLD, 0.35, time);
        break;
    }
    if (u) goldRing(c, cam, u.pos, u.radius + 0.45, time, 1, frac);
  }

  // ─────────────────────────── overlay (above units) ───────────────────────────

  drawOverlay(c: CanvasRenderingContext2D, cam: Camera, state: GameState, time: number): void {
    const ev = state.fieldEvent;
    if (ev && ev.stage === 'active') this.drawActiveOverlay(c, cam, state, ev, time);
    for (const p of this.parts) {
      if (!cam.visibleX(p.x, 1)) continue;
      const k = p.age / p.life;
      const sx = cam.sx(p.x);
      const sy = cam.sy(p.y) - p.z * PX_PER_UNIT * 0.8;
      c.globalAlpha = 1 - k * k;
      if (p.kind === 'coin') {
        c.fillStyle = GOLD;
        c.strokeStyle = INK;
        c.lineWidth = 1.5;
        c.beginPath();
        c.ellipse(sx, sy, 5, 5 * Math.abs(Math.cos(p.age * 12)) + 1, 0, 0, TAU);
        c.fill();
        c.stroke();
      } else if (p.kind === 'smoke') {
        c.fillStyle = '#9aa0a6';
        c.globalAlpha *= 0.6;
        c.beginPath();
        c.arc(sx, sy, 8 + 14 * k, 0, TAU);
        c.fill();
      } else {
        c.fillStyle = '#fff3b0';
        c.beginPath();
        c.arc(sx, sy, 3, 0, TAU);
        c.fill();
      }
    }
    for (const t of this.texts) {
      if (!cam.visibleX(t.x, 2)) continue;
      const k = t.age / t.life;
      const sy = cam.sy(t.y) - 70 - 40 * (1 - (1 - k) ** 2);
      c.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      outlinedText(c, t.text, cam.sx(t.x), sy, t.size, t.color);
    }
    c.globalAlpha = 1;
  }

  private drawActiveOverlay(c: CanvasRenderingContext2D, cam: Camera, state: GameState, ev: FieldEventState, time: number): void {
    const def = getFieldEvent(ev.id);
    if (ev.id === 'dark_lamps') {
      for (const m of ev.marks) if (cam.visibleX(m.pos.x, 2)) drawLamp(c, cam, m.pos, m.doneBy != null, time);
    }
    if (ev.id === 'sleepwalker' && ev.marks[0] && cam.visibleX(ev.marks[0].pos.x, 2)) drawDoor(c, cam, ev.marks[0].pos, time);
    const u = mainUnit(state, ev);
    if (!u || !cam.visibleX(u.pos.x, 2)) {
      if (ev.id === 'open_shaft' && ev.marks[0]) countdown(c, cam, ev.marks[0].pos, 60, ev.remaining, time);
      if (ev.id === 'dark_lamps' && ev.marks[1]) countdown(c, cam, ev.marks[1].pos, 110, ev.remaining, time);
      return;
    }
    const sx = cam.sx(u.pos.x);
    const top = cam.sy(u.pos.y) - bodyWidth(u.radius) * 1.25 - 12;
    let y = top;
    if (ev.id === 'sleeping_patient') {
      y = patientBar(c, sx, top - 10, ev.progress / 100);
    } else if (ev.id === 'possessed_printer') {
      const stunned = u.statuses.some(s => s.id === 'stun');
      printCycle(c, sx + bodyWidth(u.radius) * 0.75, top + 14, 1 - (ev.printIn ?? def.params.printEvery) / def.params.printEvery, stunned, ev.printed ?? 0);
    } else if (ev.id === 'lucky_toad' && u.anim === 'cast') {
      crouchArc(c, sx, top + 4, time);
    } else if (ev.id === 'sleepwalker') {
      const crying = (ev.startled ?? 0) > 0;
      const escorted = state.entities.some(e => e.kind === 'character' && alive(e) && Math.hypot(e.pos.x - u.pos.x, e.pos.y - u.pos.y) <= def.params.escort);
      const label = crying ? '으앙' : escorted ? 'Zz' : '…';
      outlinedText(c, label, sx + 18, top + 4 - 4 * Math.sin(time * 3), crying ? 22 : 20, crying ? '#ff6b6b' : '#e9ecef');
    }
    diamond(c, sx, y - 4, time);
    countdown(c, cam, u.pos, cam.sy(u.pos.y) - (y - 34), ev.remaining, time);
  }

  // ─────────────────────────── screen ───────────────────────────

  drawScreen(c: CanvasRenderingContext2D, cam: Camera, state: GameState, time: number): void {
    const ev = state.fieldEvent;
    if (!ev) return;
    if (ev.id === 'midnight_surge') vignette(c, ev.stage === 'warn' ? 1 - ev.warnRemaining / 1.5 : 1);
    if (cam.arenaWidth <= VIEW_WIDTH_UNITS + 1e-6) return;
    const half = VIEW_WIDTH_UNITS / 2;
    const icon = getFieldEvent(ev.id).icon;
    const urgent = ev.stage === 'active' && ev.remaining < COUNTDOWN;
    // the red enemy arrows sit at their enemies' mean y on each side: keep the gold ones clear of them
    const redY = [0, 0];
    const redN = [0, 0];
    for (const e of state.entities) {
      if (e.team !== 'enemy' || e.hp <= 0 || e.tier === 'boss' || e.eventTag === 'target') continue;
      const dx = e.pos.x - cam.x;
      const side = dx < -half - e.radius * 0.5 ? 0 : dx > half + e.radius * 0.5 ? 1 : -1;
      if (side < 0) continue;
      redY[side] += e.pos.y;
      redN[side]++;
    }
    const placeY = (side: 0 | 1, wy: number, k: number): number => {
      let y = clampArrowY(cam.sy(wy)) + k * 56;
      if (redN[side] > 0) {
        const ry = clampArrowY(cam.sy(redY[side] / redN[side]));
        if (Math.abs(y - ry) < 58) y = ry > 300 ? ry - 60 : ry + 60;
      }
      return y;
    };
    let left = 0;
    let right = 0;
    for (const p of focusPoints(state, ev)) {
      const dx = p.x - cam.x;
      if (dx < -half - 0.3) goldArrow(c, -1, placeY(0, p.y, left++), icon, time, urgent);
      else if (dx > half + 0.3) goldArrow(c, 1, placeY(1, p.y, right++), icon, time, urgent);
    }
    c.globalAlpha = 1;
  }
}

// ─────────────────────────── pieces ───────────────────────────

function goldRing(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, r: number, time: number, alpha: number, frac: number | null, fill = true): void {
  if (!cam.visibleX(p.x, r + 1)) return;
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const rx = r * PX_PER_UNIT;
  const ry = r * PX_PER_UNIT_Y;
  if (fill) {
    c.globalAlpha = 0.25 * alpha;
    c.fillStyle = GOLD;
    c.beginPath();
    c.ellipse(sx, sy, rx, ry, 0, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 0.9 * alpha;
  c.lineWidth = 6;
  c.strokeStyle = INK;
  c.setLineDash(RING_DASH);
  c.lineDashOffset = -time * 30;
  c.beginPath();
  c.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  c.stroke();
  c.lineWidth = 3;
  c.strokeStyle = GOLD;
  c.stroke();
  c.setLineDash(NO_DASH);
  c.lineDashOffset = 0;
  if (frac != null) {
    c.globalAlpha = alpha;
    c.lineWidth = 5;
    c.strokeStyle = frac < 0.28 ? '#ff6b6b' : GOLD_DEEP;
    c.beginPath();
    c.ellipse(sx, sy, rx + 7, ry + 5, 0, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function timerArc(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, r: number, frac: number, remaining: number): void {
  if (!cam.visibleX(p.x, r + 1)) return;
  c.globalAlpha = 0.95;
  c.lineWidth = 5;
  c.strokeStyle = remaining < COUNTDOWN ? '#ff6b6b' : GOLD_DEEP;
  c.beginPath();
  c.ellipse(cam.sx(p.x), cam.sy(p.y), r * PX_PER_UNIT + 8, r * PX_PER_UNIT_Y + 6, 0, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
  c.stroke();
  c.globalAlpha = 1;
}

function dottedCircle(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, r: number, color: string, alpha: number, time: number): void {
  if (!cam.visibleX(p.x, r + 1)) return;
  c.globalAlpha = alpha;
  c.lineWidth = 3;
  c.strokeStyle = color;
  c.setLineDash(DOT_DASH);
  c.lineDashOffset = -time * 10;
  c.beginPath();
  c.ellipse(cam.sx(p.x), cam.sy(p.y), r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, TAU);
  c.stroke();
  c.setLineDash(NO_DASH);
  c.lineDashOffset = 0;
  c.globalAlpha = 1;
}

/** Open shaft: a black pit, gold dashed rim, hands reaching up from below; the timer on the rim. */
function drawHole(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, r: number, time: number, frac: number): void {
  if (!cam.visibleX(p.x, r + 1)) return;
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const rx = r * PX_PER_UNIT;
  const ry = r * PX_PER_UNIT_Y;
  const g = c.createRadialGradient(sx, sy, 2, sx, sy, rx);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.75, '#07060c');
  g.addColorStop(1, '#2a2233');
  c.globalAlpha = 1;
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(sx, sy, rx, ry, 0, 0, TAU);
  c.fill();
  // hands
  c.fillStyle = '#3b3346';
  for (let i = 0; i < 3; i++) {
    const a = Math.PI * (0.15 + 0.35 * i) + Math.sin(time * 2 + i) * 0.15;
    const hx = sx + Math.cos(a) * rx * 0.6;
    const hy = sy + Math.sin(a) * ry * 0.35;
    const lift = 6 + 5 * Math.sin(time * 3 + i * 1.7);
    c.beginPath();
    c.ellipse(hx, hy - lift, 5, 8, 0, 0, TAU);
    for (let f = -1; f <= 1; f++) {
      c.moveTo(hx + f * 3 + 1.5, hy - lift - 8);
      c.ellipse(hx + f * 3, hy - lift - 10, 1.5, 4, 0, 0, TAU);
    }
    c.fill();
  }
  goldRing(c, cam, p, r, time, 1, frac, false);
}

function drawLamp(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, lit: boolean, time: number): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const h = 62;
  if (lit) {
    const g = c.createLinearGradient(0, sy - 170, 0, sy);
    g.addColorStop(0, 'rgba(255,240,160,0)');
    g.addColorStop(1, 'rgba(255,240,160,0.45)');
    c.globalAlpha = 0.8 + 0.2 * Math.sin(time * 6);
    c.fillStyle = g;
    c.fillRect(sx - 26, sy - 170, 52, 170);
  }
  c.globalAlpha = 1;
  c.lineWidth = 5;
  c.strokeStyle = INK;
  c.beginPath();
  c.moveTo(sx, sy);
  c.lineTo(sx, sy - h);
  c.stroke();
  c.lineWidth = 3;
  c.strokeStyle = '#6c757d';
  c.stroke();
  c.beginPath();
  c.arc(sx, sy - h - 9, 11, 0, TAU);
  c.fillStyle = lit ? '#fff3b0' : '#5c6168';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = INK;
  c.stroke();
  if (!lit) {
    // a small gold "!" so an unlit lamp reads as part of the event
    outlinedText(c, '💡', sx, sy - h - 34 - 3 * Math.sin(time * 4), 20, GOLD);
  }
}

function drawDoor(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, time: number): void {
  const sx = cam.sx(p.x);
  const sy = cam.sy(p.y);
  const w = 40;
  const h = 76;
  c.globalAlpha = 0.35 + 0.15 * Math.sin(time * 3);
  c.fillStyle = GOLD;
  c.beginPath();
  c.ellipse(sx, sy, 34, 14, 0, 0, TAU);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = '#fff3c4';
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.beginPath();
  c.rect(sx - w / 2, sy - h, w, h);
  c.fill();
  c.stroke();
  c.lineWidth = 3;
  c.strokeStyle = GOLD_DEEP;
  c.strokeRect(sx - w / 2 + 5, sy - h + 5, w - 10, h - 5);
  c.fillStyle = GOLD_DEEP;
  c.beginPath();
  c.arc(sx + w / 2 - 10, sy - h / 2, 3, 0, TAU);
  c.fill();
  outlinedText(c, '출구', sx, sy - h - 14, 20, GOLD);
}

/** '!' gold diamond over the event unit. */
function diamond(c: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const bob = Math.sin(time * 4) * 3;
  const r = 13;
  c.globalAlpha = 1;
  c.beginPath();
  c.moveTo(x, y - r * 1.3 + bob);
  c.lineTo(x + r, y + bob);
  c.lineTo(x, y + r * 1.3 + bob);
  c.lineTo(x - r, y + bob);
  c.closePath();
  c.fillStyle = GOLD;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = INK;
  c.stroke();
  c.font = boldFont(18);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  c.fillText('!', x, y + 1 + bob);
}

/** The last COUNTDOWN seconds as a big number above `p` (lift = px above its ground point). */
function countdown(c: CanvasRenderingContext2D, cam: Camera, p: Vec2, lift: number, remaining: number, time: number): void {
  if (remaining > COUNTDOWN || remaining <= 0 || !cam.visibleX(p.x, 1)) return;
  const n = Math.ceil(remaining);
  const k = remaining - Math.floor(remaining);
  outlinedText(c, String(n), cam.sx(p.x), cam.sy(p.y) - lift - 8 * k, 34 + 8 * k, n <= 2 && Math.sin(time * 20) > 0 ? '#ff6b6b' : '#ffffff');
}

function patientBar(c: CanvasRenderingContext2D, x: number, y: number, f: number): number {
  const w = 120;
  const h = 14;
  const x0 = x - w / 2;
  c.globalAlpha = 1;
  c.fillStyle = INK;
  c.fillRect(x0 - 3, y - 3, w + 6, h + 6);
  c.fillStyle = '#0e2a18';
  c.fillRect(x0, y, w, h);
  c.fillStyle = '#52d273';
  c.fillRect(x0, y, w * Math.max(0, Math.min(1, f)), h);
  c.strokeStyle = GOLD;
  c.lineWidth = 2;
  c.strokeRect(x0 - 1, y - 1, w + 2, h + 2);
  // the goal: a gold notch at the right end
  c.fillStyle = GOLD;
  c.fillRect(x0 + w - 4, y - 4, 4, h + 8);
  outlinedText(c, `${Math.floor(f * 100)}%`, x, y - 12, 16, '#c7f9cc');
  return y - 24;
}

function printCycle(c: CanvasRenderingContext2D, x: number, y: number, f: number, stunned: boolean, printed: number): void {
  const r = 13;
  c.globalAlpha = 1;
  c.fillStyle = INK;
  c.beginPath();
  c.arc(x, y, r + 3, 0, TAU);
  c.fill();
  c.fillStyle = stunned ? '#6c757d' : GOLD;
  c.beginPath();
  c.moveTo(x, y);
  c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, Math.min(1, f)));
  c.closePath();
  c.fill();
  // 기획 12차 리뷰: what it printed is a hazard count (red), not progress
  if (printed > 0) outlinedText(c, `졸개 ${printed}`, x, y + r + 14, 14, stunned ? '#adb5bd' : '#ff8a8a');
}

function crouchArc(c: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  c.globalAlpha = 0.6 + 0.4 * Math.sin(time * 24);
  c.lineWidth = 4;
  c.strokeStyle = GOLD;
  c.beginPath();
  c.arc(x, y + 14, 22, Math.PI * 1.15, Math.PI * 1.85);
  c.stroke();
  c.beginPath();
  c.moveTo(x + 22 * Math.cos(Math.PI * 1.85) + 6, y + 14 + 22 * Math.sin(Math.PI * 1.85) - 2);
  c.lineTo(x + 22 * Math.cos(Math.PI * 1.85), y + 14 + 22 * Math.sin(Math.PI * 1.85));
  c.lineTo(x + 22 * Math.cos(Math.PI * 1.85) - 1, y + 14 + 22 * Math.sin(Math.PI * 1.85) - 8);
  c.stroke();
  c.globalAlpha = 1;
}

/** 23:59: the screen edges go dark (the middle stays bright, so the fight is still readable). */
function vignette(c: CanvasRenderingContext2D, k: number): void {
  const g = c.createRadialGradient(LOGICAL_W / 2, 380, 220, LOGICAL_W / 2, 380, 700);
  g.addColorStop(0, 'rgba(8,6,20,0)');
  g.addColorStop(1, `rgba(8,6,20,${(0.8 * Math.max(0, Math.min(1, k))).toFixed(3)})`);
  c.globalAlpha = 1;
  c.fillStyle = g;
  c.fillRect(0, 0, LOGICAL_W, 720);
}

/** Edge arrows stay between the top HUD row and the card rows (same band as the red enemy arrows). */
function clampArrowY(y: number): number {
  return Math.max(250, Math.min(470, y));
}

/** Gold edge arrow with the event icon (drawn above the red enemy arrows). */
function goldArrow(c: CanvasRenderingContext2D, dir: -1 | 1, wy: number, icon: string, time: number, urgent: boolean): void {
  const y = Math.max(200, Math.min(520, wy));
  const pulse = 0.5 + 0.5 * Math.sin(time * (urgent ? 16 : 6));
  const tip = dir < 0 ? 8 : LOGICAL_W - 8;
  const back = tip - dir * 34;
  c.globalAlpha = 0.8 + 0.2 * pulse;
  c.beginPath();
  c.moveTo(tip, y);
  c.lineTo(back, y - 26);
  c.lineTo(back, y + 26);
  c.closePath();
  c.lineJoin = 'round';
  c.lineWidth = 6;
  c.strokeStyle = INK;
  c.stroke();
  c.fillStyle = GOLD;
  c.fill();
  // icon bubble behind the arrow
  const bx = back - dir * 24;
  c.beginPath();
  c.arc(bx, y, 20, 0, TAU);
  c.fillStyle = INK;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = GOLD;
  c.stroke();
  c.globalAlpha = 1;
  c.font = boldFont(22);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(icon, bx, y + 1);
}

function outlinedText(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  c.font = boldFont(size);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(4, size * 0.22);
  c.strokeStyle = INK;
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
}
