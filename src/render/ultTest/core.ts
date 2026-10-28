// 기획 22차 궁극기 테스트: what every aimed / dragged ult shows on every screen (from the ultCast event's `aim`).
//  - 조준: a reticle closing onto the aimed point in the caster's colour (0.8 s) — the others see where it went.
//  - 드래그: the landing flourish where the character arrived (a ring + sparks, like a drag card touching down).
// Mine at full strength, another player's softer (never buries my own fight).

import type { GameEvent } from '../../types';
import { getCharacter } from '../../data';
import { areaColor } from '../look';
import { groundEllipse } from '../shapes';
import { registerUltFx, type UltFxView } from './index';

const RETICLE_SEC = 0.8;

interface Reticle {
  x: number;
  y: number;
  color: string;
  k: number;
  /** Renderer clock when it appeared (set on the first draw). */
  t0: number | null;
}

const reticles: Reticle[] = [];

function colorOf(defId: string): string {
  try {
    return areaColor(defId, getCharacter(defId).color);
  } catch {
    return '#ffffff';
  }
}

function onEvent(ev: GameEvent, view: UltFxView): void {
  if (ev.type !== 'ultCast' || !ev.aim) return;
  const color = colorOf(ev.defId);
  const k = ev.player === view.localPlayer ? 1 : 0.6;
  const { x, y } = ev.aim;
  if (ev.aim.mode === 'drag') {
    view.host.ring(x, y, 0.2, 1.8, 0.4, color, 5 * k, 0.18 * k);
    view.host.ring(x, y, 0.1, 1.1, 0.3, '#ffffff', 3 * k, 0);
    view.host.burst(x, y, 0.3, Math.round(14 * k), color, 2.6, 2, 0.45);
    return;
  }
  if (reticles.length > 8) reticles.shift();
  reticles.push({ x, y, color, k, t0: null });
}

function draw(ctx: CanvasRenderingContext2D, _state: unknown, view: UltFxView, now: number): void {
  const cam = view.cam;
  if (!cam || reticles.length === 0) return;
  for (let i = reticles.length - 1; i >= 0; i--) {
    const r = reticles[i];
    r.t0 ??= now;
    const t = (now - r.t0) / RETICLE_SEC;
    if (t >= 1 || t < 0) {
      reticles.splice(i, 1);
      continue;
    }
    const a = (1 - t) * r.k;
    const rad = 1.6 - 0.9 * Math.min(1, t * 2.5);
    ctx.beginPath();
    groundEllipse(ctx, cam, r.x, r.y, rad);
    ctx.globalAlpha = a * 0.7;
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#05060a';
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = r.color;
    ctx.stroke();
    // four ticks pointing in
    const sx = cam.sx(r.x);
    const sy = cam.sy(r.y);
    const R = cam.sx(r.x + rad) - sx;
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 0.6],
      [0, -0.6],
    ]) {
      ctx.moveTo(sx + dx * (R + 10), sy + dy * (R + 10));
      ctx.lineTo(sx + dx * (R - 6), sy + dy * (R - 6));
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

registerUltFx({ onEvent, draw });
