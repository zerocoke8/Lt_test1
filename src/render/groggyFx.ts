// 기획 13차 보스 그로기 (docs/boss-groggy.md 6장): the break moment — 180 ms hit-stop, a shake twice a drag landing's,
// the boss's white flash, a gold shockwave ring from its feet (radius 9 in 0.45 s), 12 gold shards and the
// 「그로기!」 stamp over the boss art ('받는 피해 ×1.5 · 드래그 ×2', in multiplayer who broke it) — and the pose timing
// the boss art reads (down over 0.25 s, standing up over 0.8 s, the 'almost full' tremble). Render-only: it reads
// GameState.bossGroggy, the events only start the one-shot effects.

import type { GameEvent, GameState } from '../types';
import { Camera, PX_PER_UNIT_Z } from './camera';
import { BOSS_DROP } from './bosses';
import { boldFont } from './look';
import type { Vfx } from './vfx';
import { groggyKick } from './juice';

const DOWN_SEC = 0.25;
const WAKE_SEC = 0.8;
const GOLD = '#ffd166';
/** Stamp timeline (s): 1.6 → 1.0 scale-in, hold, fade. */
const STAMP_IN = 0.18;
const STAMP_HOLD = 0.6;
const STAMP_OUT = 0.3;

interface Stamp {
  age: number;
  /** Third line ('' = none) and its colour. */
  who: string;
  whoColor: string;
}

export interface GroggyPose {
  groggy: number;
  groggyWake: number;
  groggyNear: number;
}

/** Subject particle for a name: 이 after a final consonant, else 가 (same rule as the HUD toasts). */
function subject(name: string): string {
  const code = name.trim().slice(-1).charCodeAt(0);
  const batchim = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 !== 0 : /[013678lmnr]$/i.test(name.trim());
  return `${name}${batchim ? '이' : '가'}`;
}

/** The third stamp line: shown when another human plays (multiplayer); mine says so. */
export function breakerLine(s: GameState, local: number, player: number | null): string {
  if (player == null) return '';
  const others = s.players.some(p => p.id !== local && (!p.isBot || p.disconnected));
  if (!others) return '';
  if (player === local) return '내가 쓰러뜨렸다!';
  const p = s.players[player];
  return p ? `${subject(p.name)} 쓰러뜨림` : '';
}

export class GroggyFx {
  private g = 0;
  private wake = 0;
  private stamp: Stamp | null = null;

  reset(): void {
    this.g = 0;
    this.wake = 0;
    this.stamp = null;
  }

  handle(ev: GameEvent, s: GameState, local: number, vfx: Vfx): void {
    if (ev.type !== 'bossGroggy') return;
    const boss = s.entities.find(e => e.id === ev.entityId);
    const x = boss ? boss.pos.x : 12;
    const y = boss ? boss.pos.y : -1.2;
    const kick = groggyKick(vfx.juice.settings);
    vfx.juice.hitStop(kick.stop, { cap: kick.stop, ignoreBudget: true });
    vfx.juice.shake(kick.shake, 0.4);
    vfx.phaseFlash = Math.max(vfx.phaseFlash, 1);
    vfx.ring(x, y + 2.6, 0.5, 9, 0.45, GOLD, 7, 0.1);
    vfx.ring(x, y + 2.6, 0.3, 5.5, 0.35, '#ffffff', 3, 0);
    vfx.burst(x, y + 2.4, 1.4, 12, GOLD, 6, 5, 0.9);
    const who = breakerLine(s, local, ev.player);
    const p = ev.player != null ? s.players[ev.player] : undefined;
    this.stamp = { age: 0, who, whoColor: p?.color ?? '#ffffff' };
  }

  update(dt: number, s: GameState): void {
    const down = (s.bossGroggy?.left ?? 0) > 0;
    if (down) {
      this.g = Math.min(1, this.g + dt / DOWN_SEC);
      this.wake = 0;
    } else if (this.g > 0) {
      this.g = Math.max(0, this.g - dt / WAKE_SEC);
      this.wake = this.g > 0 ? 1 - this.g : 0;
    }
    if (this.stamp) {
      this.stamp.age += dt;
      if (this.stamp.age > STAMP_IN + STAMP_HOLD + STAMP_OUT) this.stamp = null;
    }
  }

  pose(s: GameState): GroggyPose {
    const gs = s.bossGroggy;
    const near = gs && gs.near ? (gs.fill >= 0.9 ? 2 : 1) : 0;
    return { groggy: easeOut(this.g), groggyWake: this.wake, groggyNear: near };
  }

  /** The 「그로기!」 stamp over the boss art (world layer, never on the drop field). */
  drawStamp(c: CanvasRenderingContext2D, cam: Camera, s: GameState): void {
    const st = this.stamp;
    if (!st) return;
    const boss = s.bossId != null ? s.entities.find(e => e.id === s.bossId) : undefined;
    const x = cam.sx(boss ? boss.pos.x : 12);
    const y = Math.max(176, cam.sy(boss ? boss.pos.y : -1.2) + BOSS_DROP + 1.6 * PX_PER_UNIT_Z);
    const a = st.age;
    const k = a < STAMP_IN ? 1.6 - 0.6 * (a / STAMP_IN) : 1;
    const fade = a > STAMP_IN + STAMP_HOLD ? Math.max(0, 1 - (a - STAMP_IN - STAMP_HOLD) / STAMP_OUT) : 1;
    c.save();
    c.globalAlpha = fade;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.translate(x, y);
    c.scale(k, k);
    c.rotate(-0.06);
    c.font = boldFont(64);
    c.lineWidth = 8;
    c.strokeStyle = '#2a1600';
    c.strokeText('그로기!', 0, 0);
    c.fillStyle = GOLD;
    c.fillText('그로기!', 0, 0);
    c.rotate(0.06);
    c.font = boldFont(22);
    c.lineWidth = 5;
    c.strokeStyle = '#120a00';
    c.strokeText('받는 피해 ×1.5 · 드래그 ×2', 0, 46);
    c.fillStyle = '#ffffff';
    c.fillText('받는 피해 ×1.5 · 드래그 ×2', 0, 46);
    if (st.who) {
      c.font = boldFont(18);
      c.lineWidth = 4;
      c.strokeText(st.who, 0, 74);
      c.fillStyle = st.whoColor;
      c.fillText(st.who, 0, 74);
    }
    c.restore();
  }
}

function easeOut(u: number): number {
  return 1 - (1 - u) * (1 - u);
}
