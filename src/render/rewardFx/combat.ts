// 기획 17차 Track B — 궁극기·보스·펫·상태이상 + 저스트: reward visuals, kept light (one ring or a few sparks per proc,
// nothing that floods the screen). Events: the 'rewardProc' of this track's families. Every frame on the ground layer:
// the 원한의 쪽지 mark under marked enemies, the 주인 냄새 ring at the drop, and the 두 번 차는 게이지 second ring under
// a field character whose gauge is above 100 %.

import type { Entity, GameEvent, GameState, Vec2 } from '../../types';
import { PX_PER_UNIT, PX_PER_UNIT_Y, type Camera } from '../camera';
import { registerRewardFx, type RewardFxView } from './index';

/** One-shot ring per family: [color, end radius, seconds]. Families not listed draw nothing extra on proc. */
const PROC_RING: Record<string, [string, number, number]> = {
  swap_charge: ['#f9c74f', 0.9, 0.35],
  intermission: ['#f9c74f', 1.4, 0.45],
  ult_linger: ['#f9c74f', 2.2, 0.5],
  duet: ['#f9c74f', 0.9, 0.4],
  overcharge: ['#ffd166', 1.8, 0.5],
  groggy_drop: ['#f3722c', 1.6, 0.45],
  groggy_rush: ['#f3722c', 1.2, 0.4],
  pet_call: ['#90be6d', 0.9, 0.35],
  tamer: ['#90be6d', 0.9, 0.35],
  burn_chain: ['#ff7b00', 2, 0.4],
  possess: ['#c77dff', 0.9, 0.45],
  ghost_hunter: ['#f9c74f', 1.2, 0.45],
  just_counter: ['#ffd166', 1.1, 0.35],
  just_cd: ['#4cc9f0', 0.8, 0.3],
  just_ult: ['#f9c74f', 0.8, 0.3],
  just_guard: ['#43aa8b', 3, 0.45],
  just_freeze: ['#a5d8ff', 4, 0.5],
};

/** 주인 냄새 rings alive (sim time). At most a few: one per player is the rule in the sim. */
interface ScentRing {
  pos: Vec2;
  until: number;
  player: number;
}
const SCENT_MAX = 6;
const scents: ScentRing[] = [];

const GRUDGE_COLOR = '#c77dff';
const SCENT_COLOR = '#90be6d';
const OVER_COLOR = '#ffd166';

function onProc(ev: Extract<GameEvent, { type: 'rewardProc' }>, view: RewardFxView): void {
  const { host } = view;
  const key = ev.rewardId;
  if (key === 'pet_scent' && !ev.text) {
    const radius = 3;
    for (let i = scents.length - 1; i >= 0; i--) if (scents[i].player === ev.player) scents.splice(i, 1);
    scents.push({ pos: { ...ev.pos }, until: view.state.time + 3, player: ev.player });
    while (scents.length > SCENT_MAX) scents.shift();
    host.ring(ev.pos.x, ev.pos.y, 0.3, radius, 0.4, SCENT_COLOR, 2, 0.08);
    return;
  }
  if (key === 'grudge') {
    // '표식' = marked (small purple tick), '폭발' = the stored burst
    if (ev.text === '폭발') {
      host.ring(ev.pos.x, ev.pos.y, 0.2, 1.8, 0.45, GRUDGE_COLOR, 4, 0.2);
      host.burst(ev.pos.x, ev.pos.y, 0.6, 10, GRUDGE_COLOR, 4, 2, 0.5);
    } else {
      host.ring(ev.pos.x, ev.pos.y, 1.2, 0.5, 0.35, GRUDGE_COLOR, 2, 0);
    }
    return;
  }
  const r = PROC_RING[key];
  if (!r) return;
  host.ring(ev.pos.x, ev.pos.y, 0.2, r[1], r[2], r[0], 3, key === 'just_guard' || key === 'just_freeze' ? 0.12 : 0);
  if (key === 'just_counter' || key === 'overcharge') host.burst(ev.pos.x, ev.pos.y, 0.6, 6, r[0], 4, 2, 0.35);
}

function ellipse(ctx: CanvasRenderingContext2D, cam: Camera, at: Vec2, r: number): void {
  ctx.beginPath();
  ctx.ellipse(cam.sx(at.x), cam.sy(at.y), r * PX_PER_UNIT, r * PX_PER_UNIT_Y, 0, 0, Math.PI * 2);
}

/** A small pulsing ring + three ticks under every enemy that carries a 원한 mark. */
function drawGrudge(ctx: CanvasRenderingContext2D, cam: Camera, s: GameState, now: number): void {
  for (const e of s.entities) {
    if (e.team !== 'enemy' || e.hp <= 0 || !e.statuses.some(x => x.id === 'grudge')) continue;
    const r = e.radius + 0.25 + 0.06 * Math.sin(now * 6);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = GRUDGE_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ellipse(ctx, cam, e.pos, r);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawScents(ctx: CanvasRenderingContext2D, cam: Camera, s: GameState, now: number): void {
  for (let i = scents.length - 1; i >= 0; i--) {
    const sc = scents[i];
    const left = sc.until - s.time;
    if (left <= 0 || left > 3.5) {
      scents.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, left) * 0.55;
    ctx.strokeStyle = SCENT_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -now * 20;
    ellipse(ctx, cam, sc.pos, 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
}

/** The field character's gauge above 100 % (두 번 차는 게이지): a second gold ring at its feet, brighter as it fills. */
function drawOvercharge(ctx: CanvasRenderingContext2D, cam: Camera, s: GameState, now: number): void {
  for (const p of s.players) {
    if (p.activeIndex == null || !p.rewards.some(r => r.rewardId.startsWith('overcharge_'))) continue;
    const m = p.party[p.activeIndex];
    const over = (m?.ult?.charge ?? 0) - 1;
    if (!m || !(over > 0)) continue;
    const e: Entity | undefined = s.entities.find(x => x.id === m.entityId);
    if (!e || e.hp <= 0) continue;
    const pulse = 0.5 + 0.5 * Math.sin(now * 5);
    ctx.globalAlpha = 0.35 + 0.45 * Math.min(1, over) * (0.6 + 0.4 * pulse);
    ctx.strokeStyle = OVER_COLOR;
    ctx.lineWidth = over >= 1 - 1e-6 ? 3 : 2;
    ellipse(ctx, cam, e.pos, e.radius + 0.35);
    ctx.stroke();
    ellipse(ctx, cam, e.pos, e.radius + 0.55 + 0.05 * pulse);
    ctx.stroke();
  }
}

export const COMBAT_FX = {
  onEvent(ev: GameEvent, view: RewardFxView): void {
    if (ev.type === 'rewardProc') onProc(ev, view);
  },
  draw(ctx: CanvasRenderingContext2D, state: GameState, view: RewardFxView, now: number): void {
    const cam = view.cam;
    if (!cam) return;
    ctx.save();
    drawGrudge(ctx, cam, state, now);
    if (scents.length) drawScents(ctx, cam, state, now);
    drawOvercharge(ctx, cam, state, now);
    ctx.restore();
  },
};

registerRewardFx(COMBAT_FX);

/** Live 주인 냄새 rings (tests). */
export function scentRings(): readonly ScentRing[] {
  return scents;
}
