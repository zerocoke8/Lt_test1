// 기획 17차 Track A — 등장·착지 + 퇴장 + 직업 특기 + 교대 연계: reward visuals. Light touches only (one ring / flash /
// spark burst per proc, softer for other players); the head pill and its icons belong to the UI track (vfx.ts).
// - lines (교대선, 근접 착지 참격): the reward's skillCast carries no origin, so the band is flashed from the player's
//   last leave / appear spot of this swap;
// - rings per family on 'rewardProc' (밀기 out, 끌어당기기 in, 깜짝 등장, 맞교대, 도플갱어, 3연타 …);
// - mines: a slow blinking red ring under every reward mine on the ground layer.

import type { Vec2 } from '../../types';
import { PX_PER_UNIT, PX_PER_UNIT_Y } from '../camera';
import { registerRewardFx, type RewardFxView } from './index';

const TAU = Math.PI * 2;

/** Colors per family (tag colors of src/data/rewards/tags.ts where it fits). */
const COLOR: Record<string, string> = {
  bolt: '#ffd166',
  startle: '#ffd166',
  beckon: '#c77dff',
  scorch: '#ff7b39',
  relay_line: '#4cc9f0',
  inplace: '#ffd166',
  prompt: '#ffe08a',
  rested: '#f3722c',
  talisman: '#43aa8b',
  doppel: '#c77dff',
  relay_blast: '#b8c0ff',
  shade: '#b8c0ff',
  mine: '#f94144',
  evac: '#52d273',
  farewell: '#b8c0ff',
  fog: '#6c5b7b',
  shove: '#b8c0ff',
  role: '#7bdff2',
  baton: '#4cc9f0',
  combo: '#4cc9f0',
  handover: '#4cc9f0',
  cover_swap: '#4cc9f0',
  aftercare: '#43aa8b',
  relay3: '#4cc9f0',
  partners: '#4cc9f0',
  tricolor: '#4cc9f0',
};

/** Where each player's field character last left / appeared (the line casts start there). */
const lastLeave = new Map<number, Vec2>();
const lastAppear = new Map<number, Vec2>();

/** Strength for my own effects vs another player's (never buries my fight). */
function k(view: RewardFxView, player: number): number {
  return player === view.localPlayer ? 1 : 0.5;
}

function onProc(ev: { player: number; rewardId: string; pos: Vec2; text?: string }, view: RewardFxView): void {
  const c = COLOR[ev.rewardId];
  if (!c) return;
  const h = view.host;
  const s = k(view, ev.player);
  const { x, y } = ev.pos;
  switch (ev.rewardId) {
    case 'shove':
      h.ring(x, y, 0.4, 3.2, 0.35, c, 4, 0.12 * s);
      break;
    case 'beckon':
      h.ring(x, y, 4.2, 0.5, 0.45, c, 3, 0.1 * s); // closing in: the pull
      break;
    case 'startle':
      h.ring(x, y, 0.3, 2.8, 0.3, c, 4, 0.1 * s);
      h.burst(x, y, 1.2, Math.round(10 * s), c, 2.5, 3, 0.4);
      break;
    case 'prompt':
    case 'inplace':
      h.ring(x, y, 0.2, 1.6, 0.35, c, 3, 0.15 * s);
      h.burst(x, y, 1.4, Math.round(14 * s), c, 3, 3.5, 0.5);
      break;
    case 'doppel':
    case 'relay3':
      h.ring(x, y, 0.3, ev.rewardId === 'relay3' ? 5 : 2.2, 0.5, c, 5, 0.18 * s);
      h.burst(x, y, 0.6, Math.round(18 * s), c, 3, 2.5, 0.6);
      break;
    case 'evac':
    case 'talisman':
    case 'aftercare':
      h.burst(x, y, 1, Math.round(10 * s), c, 1.5, 3, 0.7, -1.5);
      break;
    case 'combo':
    case 'baton':
    case 'handover':
    case 'cover_swap':
    case 'partners':
    case 'rested':
      h.burst(x, y, 1.2, Math.round(8 * s), c, 2, 3, 0.45);
      break;
    case 'mine':
      h.burst(x, y, 0.3, Math.round(16 * s), c, 3.5, 2, 0.5);
      break;
    default:
      break;
  }
}

function onLine(ev: { player: number | null; skillId: string; center: Vec2; area: { shape: string } }, view: RewardFxView): void {
  if (ev.player == null || ev.area.shape !== 'line') return;
  const from = ev.skillId === 'relay_line' ? lastLeave.get(ev.player) : ev.skillId === 'role' ? lastAppear.get(ev.player) : undefined;
  if (!from) return;
  const area = ev.area as Parameters<RewardFxView['host']['flash']>[4];
  view.host.flash(ev.center.x, ev.center.y, from.x, from.y, area, 0.4, COLOR[ev.skillId], 0.9 * k(view, ev.player));
}

registerRewardFx({
  onEvent(ev, view) {
    switch (ev.type) {
      case 'leave':
        lastLeave.set(ev.player, { x: ev.pos.x, y: ev.pos.y });
        break;
      case 'appear':
        lastAppear.set(ev.player, { x: ev.pos.x, y: ev.pos.y });
        break;
      case 'skillCast':
        if (ev.slot === 'passive' && (ev.skillId === 'relay_line' || ev.skillId === 'role')) onLine(ev, view);
        break;
      case 'rewardProc':
        onProc(ev, view);
        break;
      default:
        break;
    }
  },
  draw(ctx, state, view, now) {
    const cam = view.cam;
    if (!cam) return;
    let any = false;
    for (const e of state.entities) {
      if (e.defId !== 'rw_mine' || e.hp <= 0) continue;
      if (!any) {
        ctx.save();
        any = true;
      }
      const blink = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(now * 5 + e.id));
      const mine = e.ownerPlayer === view.localPlayer;
      ctx.globalAlpha = mine ? blink : blink * 0.5;
      ctx.strokeStyle = COLOR.mine;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cam.sx(e.pos.x), cam.sy(e.pos.y), 1.5 * PX_PER_UNIT, 1.5 * PX_PER_UNIT_Y, 0, 0, TAU);
      ctx.stroke();
    }
    if (any) ctx.restore();
  },
});
