// 기획 17차 저스트 교대 연출 (docs/just-swap.md 연출): render-only, never touches the sim.
//  - 「저스트!」 stamp over the incoming character: gold, 1.6× → 1× in 0.12 s, held 0.45 s, rising out over 0.25 s;
//    「저스트! ×2」 when several attacks were dodged. Another player's (or bot's) is 70 % size with that player's colour.
//  - The leaving character's pale afterimage stays where it stood until the first credited telegraph lands → gold
//    shards; a telegraph that was cut (its caster stunned) lets it fade over 0.5 s instead.
//  - Mine only: a white-gold flash 0.35 → 0 over 0.15 s (at most once a second), and in multiplayer (the clock never
//    slows there) the world loses its colour for 0.35 s except around my new character, with a gold edge.
// The solo slow (the local game at 0.3×, ui/app.ts) and the 60 ms hit-stop are started from the same event.

import { LOGICAL_H, LOGICAL_W, type GameEvent, type GameState, type Vec2 } from '../types';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { boldFont, unitLook, type UnitLook } from './look';
import { bodyHeight, bodyTop, bodyWidth, drawBody, type UnitMemo } from './units';

/** Live switches set by the app (like JUICE): multiplayer → the desaturate look instead of the solo slow. */
export const JUST_FX = { multi: false };

/** Test hook (ProtoApi.ui.justStamps): the last stamps this screen showed (mine = big, else small in a player colour). */
export interface JustStampLog {
  text: string;
  mine: boolean;
  player: number;
  /** performance.now() ms (0 outside a browser). */
  at: number;
}
export const JUST_LOG: JustStampLog[] = [];

export const JUST_GOLD = '#ffd166';
/** Stamp timeline (s). */
export const JUST_STAMP = { in: 0.12, hold: 0.45, out: 0.25, rise: 26, small: 0.7 } as const;
/** Mine: flash (alpha, seconds, min gap) and the multiplayer desaturate (seconds). */
export const JUST_FLASH = { alpha: 0.35, dur: 0.15, gap: 1 } as const;
export const JUST_DESAT_SEC = 0.35;
/** Afterimage: longest wait for its telegraph, fade after a cut one (s). */
const AFTER_MAX_WAIT = 3;
const AFTER_FADE = 0.5;
const AFTER_SHATTER = 0.35;

/** Stamp scale / alpha / rise (px) at `age` s (1.6 → 1, hold, fade + rise). PURE. */
export function stampPose(age: number): { scale: number; alpha: number; rise: number } | null {
  const S = JUST_STAMP;
  if (!(age >= 0) || age > S.in + S.hold + S.out) return null;
  if (age < S.in) return { scale: 1.6 - 0.6 * (age / S.in), alpha: 1, rise: 0 };
  if (age < S.in + S.hold) return { scale: 1, alpha: 1, rise: 0 };
  const u = (age - S.in - S.hold) / S.out;
  return { scale: 1, alpha: Math.max(0, 1 - u), rise: S.rise * u };
}

/** 「저스트!」 / 「저스트! ×2」. */
export function stampText(dodged: number): string {
  return dodged >= 2 ? `저스트! ×${Math.floor(dodged)}` : '저스트!';
}

/**
 * Seconds the multiplayer 「지금!」 cue runs early: the snapshot's age plus half the ping (docs/just-swap.md 멀티) — what
 * has already passed on the server when my swap arrives. Unknown / negative parts count 0. PURE.
 */
export function cueAgeSec(snapAgeMs: number | null | undefined, pingMs: number | null | undefined): number {
  const a = typeof snapAgeMs === 'number' && snapAgeMs > 0 && Number.isFinite(snapAgeMs) ? snapAgeMs : 0;
  const p = typeof pingMs === 'number' && pingMs > 0 && Number.isFinite(pingMs) ? pingMs : 0;
  return (a + p / 2) / 1000;
}

interface Stamp {
  entityId: number;
  x: number;
  y: number;
  age: number;
  mine: boolean;
  color: string;
  text: string;
  look: UnitLook;
  radius: number;
}

interface After {
  look: UnitLook;
  radius: number;
  x: number;
  y: number;
  s: number;
  phase: number;
  age: number;
  tele: number | null;
  /** 0 waiting, 1 fading (cut telegraph / timeout), 2 shattering. */
  mode: 0 | 1 | 2;
  modeAge: number;
  mine: boolean;
}

/** Host bits JustFx needs (the Vfx layer). */
export interface JustFxHost {
  burst(x: number, y: number, z: number, n: number, color: string, speed: number, up: number, dur: number): void;
  ring(x: number, y: number, r0: number, r1: number, dur: number, color: string, width: number, fill: number): void;
  hitStopJust(): void;
}

export class JustFx {
  private stamps: Stamp[] = [];
  private afters: After[] = [];
  private flashAge = Infinity;
  private lastFlashAt = -Infinity;
  private desatAge = Infinity;
  private desatEntity = -1;
  private clock = 0;
  private readonly cut = new Set<number>();

  reset(): void {
    this.stamps = [];
    this.afters = [];
    this.flashAge = Infinity;
    this.desatAge = Infinity;
    this.desatEntity = -1;
    this.cut.clear();
  }

  /** A 「저스트!」 stamp is up on this unit (the reward pills wait / sit lower under it). */
  stampOn(entityId: number): boolean {
    return this.stamps.some(s => s.entityId === entityId && s.age < JUST_STAMP.in + JUST_STAMP.hold);
  }

  handle(ev: GameEvent, s: GameState, local: number, memos: ReadonlyMap<number, UnitMemo>, host: JustFxHost): void {
    if (ev.type === 'interrupt') {
      if (ev.telegraphId != null) this.cut.add(ev.telegraphId);
      return;
    }
    if (ev.type !== 'justSwap') return;
    const mine = ev.player === local;
    const p = s.players[ev.player];
    const inDef = p?.party[ev.inIndex]?.defId;
    const outDef = p?.party[ev.outIndex]?.defId;
    const inMemo = memos.get(ev.inEntityId);
    const inLook = inMemo?.look ?? (inDef ? unitLook('character', inDef) : unitLook('character', '?'));
    JUST_LOG.push({ text: stampText(ev.dodged), mine, player: ev.player, at: typeof performance !== 'undefined' ? performance.now() : 0 });
    if (JUST_LOG.length > 16) JUST_LOG.splice(0, JUST_LOG.length - 16);
    if (this.stamps.length >= 4) this.stamps.shift();
    this.stamps.push({
      entityId: ev.inEntityId,
      x: ev.drop.x,
      y: ev.drop.y,
      age: 0,
      mine,
      color: p?.color ?? '#ffffff',
      text: stampText(ev.dodged),
      look: inLook,
      radius: inMemo?.radius ?? 0.5,
    });
    // the leaving character's afterimage (its memo still holds last frame's look and facing)
    const outMemo = [...memos.values()].find(m => m.kind === 'character' && m.ownerPlayer === ev.player && m.partyIndex === ev.outIndex);
    if (this.afters.length >= 4) this.afters.shift();
    this.afters.push({
      look: outMemo?.look ?? (outDef ? unitLook('character', outDef) : inLook),
      radius: outMemo?.radius ?? 0.5,
      x: ev.pos.x,
      y: ev.pos.y,
      s: outMemo && Math.cos(outMemo.facing) < 0 ? -1 : 1,
      phase: outMemo?.phase ?? 0,
      age: 0,
      tele: ev.telegraphIds[0] ?? null,
      mode: 0,
      modeAge: 0,
      mine,
    });
    if (!mine) return;
    host.hitStopJust();
    host.ring(ev.drop.x, ev.drop.y, 0.3, 2.6, 0.35, JUST_GOLD, 5, 0.08);
    if (this.clock - this.lastFlashAt >= JUST_FLASH.gap) {
      this.lastFlashAt = this.clock;
      this.flashAge = 0;
    }
    if (JUST_FX.multi) {
      this.desatAge = 0;
      this.desatEntity = ev.inEntityId;
    }
  }

  update(dt: number, s: GameState, host: JustFxHost): void {
    this.clock += dt;
    this.flashAge += dt;
    this.desatAge += dt;
    for (const st of this.stamps) {
      st.age += dt;
      const e = s.entities.find(x => x.id === st.entityId);
      if (e) {
        st.x = e.pos.x;
        st.y = e.pos.y;
      }
    }
    this.stamps = this.stamps.filter(st => stampPose(st.age) != null);
    for (const a of this.afters) {
      a.age += dt;
      a.modeAge += dt;
      if (a.mode !== 0) continue;
      const live = a.tele != null && s.telegraphs.some(t => t.id === a.tele);
      if (live && a.age < AFTER_MAX_WAIT) continue;
      if (a.tele != null && !live && !this.cut.has(a.tele)) {
        // the attack landed on the empty spot: gold shards
        a.mode = 2;
        a.modeAge = 0;
        host.burst(a.x, a.y, 0.8, a.mine ? 14 : 8, JUST_GOLD, 4.5, 3.5, 0.6);
        host.burst(a.x, a.y, 0.9, a.mine ? 8 : 4, '#ffffff', 3.5, 3, 0.45);
      } else {
        a.mode = 1;
        a.modeAge = 0;
      }
    }
    this.afters = this.afters.filter(a => a.mode === 0 || a.modeAge < (a.mode === 2 ? AFTER_SHATTER : AFTER_FADE));
    if (this.cut.size > 64) this.cut.clear();
  }

  /** Afterimages (world layer, with the ghosts). */
  drawAfterimages(c: CanvasRenderingContext2D, cam: Camera, time: number): void {
    for (const a of this.afters) {
      if (!cam.visibleX(a.x, 3)) continue;
      const w = bodyWidth(a.radius);
      const h = bodyHeight(a.look, a.radius);
      const base = a.mine ? 0.5 : 0.32;
      const k = a.mode === 0 ? 1 : 1 - Math.min(1, a.modeAge / (a.mode === 2 ? AFTER_SHATTER : AFTER_FADE));
      const flicker = a.mode === 0 ? 0.85 + 0.15 * Math.sin(time * 18) : 1;
      c.save();
      c.globalAlpha = base * k * flicker;
      const fx = cam.sx(a.x);
      const fy = cam.sy(a.y);
      if (a.mode === 2) {
        // breaking apart: widen and drop a little as it goes
        const u = Math.min(1, a.modeAge / AFTER_SHATTER);
        c.translate(fx, fy);
        c.scale(1 + u * 0.4, 1 - u * 0.3);
        drawBody(c, a.look, 'character', 0, 0, w, h, a.s, time, a.phase, true);
      } else drawBody(c, a.look, 'character', fx, fy, w, h, a.s, time, a.phase, true);
      c.restore();
      // a thin gold outline ring at its feet while it waits
      if (a.mode === 0) {
        c.save();
        c.globalAlpha = 0.55 * base * 2 * flicker;
        c.strokeStyle = JUST_GOLD;
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(fx, fy, a.radius * PX_PER_UNIT * 1.1, a.radius * PX_PER_UNIT_Y * 1.1, 0, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
    }
  }

  /** Multiplayer: grey out the world for 0.35 s except a soft circle around my new character (after the units). */
  drawDesaturate(c: CanvasRenderingContext2D, cam: Camera, s: GameState): void {
    if (!(this.desatAge < JUST_DESAT_SEC)) return;
    const k = 1 - this.desatAge / JUST_DESAT_SEC;
    const e = s.entities.find(x => x.id === this.desatEntity);
    c.save();
    c.beginPath();
    c.rect(-40, -40, LOGICAL_W + 80, LOGICAL_H + 80);
    if (e) c.ellipse(cam.sx(e.pos.x), cam.sy(e.pos.y) - 30, 70, 80, 0, 0, Math.PI * 2);
    c.clip('evenodd');
    c.globalCompositeOperation = 'saturation';
    c.globalAlpha = 0.9 * k;
    c.fillStyle = '#808080';
    c.fillRect(-40, -40, LOGICAL_W + 80, LOGICAL_H + 80);
    c.restore();
  }

  /** The 「저스트!」 stamps (top world layer). */
  drawStamps(c: CanvasRenderingContext2D, cam: Camera): void {
    for (const st of this.stamps) {
      const pose = stampPose(st.age);
      if (!pose) continue;
      const k = st.mine ? 1 : JUST_STAMP.small;
      const top = bodyTop(st.look, 'character', bodyHeight(st.look, st.radius), bodyWidth(st.radius));
      const x = cam.sx(st.x);
      const y = Math.max(150, cam.sy(st.y) - top - 78 * k - 0.4 * PX_PER_UNIT_Z - pose.rise);
      c.save();
      c.globalAlpha = pose.alpha;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.translate(x, y);
      c.scale(pose.scale * k, pose.scale * k);
      c.rotate(-0.05);
      c.font = boldFont(44);
      // a dark plate behind it: the incoming drag's skill callout sits at the same height
      const tw = c.measureText(st.text)?.width || 120;
      c.beginPath();
      c.roundRect(-tw / 2 - 14, -30, tw + 28, 58, 16);
      c.fillStyle = 'rgba(24, 14, 0, 0.86)';
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = st.mine ? JUST_GOLD : st.color;
      c.stroke();
      c.lineWidth = 9;
      c.strokeStyle = st.mine ? '#2a1600' : st.color;
      c.strokeText(st.text, 0, 0);
      if (!st.mine) {
        c.lineWidth = 4;
        c.strokeStyle = '#1a0f00';
        c.strokeText(st.text, 0, 0);
      }
      c.fillStyle = JUST_GOLD;
      c.fillText(st.text, 0, 0);
      c.restore();
    }
  }

  /** Mine: the white-gold flash and (multiplayer) a gold edge (screen layer). */
  drawScreen(c: CanvasRenderingContext2D): void {
    if (this.flashAge < JUST_FLASH.dur) {
      c.save();
      c.globalAlpha = JUST_FLASH.alpha * (1 - this.flashAge / JUST_FLASH.dur);
      c.fillStyle = '#fff4cf';
      c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      c.restore();
    }
    if (this.desatAge < JUST_DESAT_SEC) {
      const k = 1 - this.desatAge / JUST_DESAT_SEC;
      c.save();
      c.globalAlpha = k;
      const g = c.createRadialGradient(LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.45, LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_W * 0.62);
      g.addColorStop(0, 'rgba(255,209,102,0)');
      g.addColorStop(1, 'rgba(255,209,102,0.55)');
      c.fillStyle = g;
      c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      c.restore();
    }
  }

  /** Test / debug view of what is up. */
  debugState(): { stamps: { text: string; mine: boolean; at: Vec2 }[]; afterimages: number; flash: boolean; desat: boolean } {
    return {
      stamps: this.stamps.map(s => ({ text: s.text, mine: s.mine, at: { x: s.x, y: s.y } })),
      afterimages: this.afters.length,
      flash: this.flashAge < JUST_FLASH.dur,
      desat: this.desatAge < JUST_DESAT_SEC,
    };
  }
}
