// 기획 17차 Track C — 규칙 변경·성장 + 저주·도박 + 협동 + 경제: reward visuals, kept light (one ring or a few sparks per
// proc; other players' effects at half strength). The head pill and its icons, the economy toasts (빚 · 욕심 «이번
// 보상 없음»), the debt / candle chips and the 이중 장전 pips belong to the UI track. Drawn here every frame:
// - 동전 던지기: the coin face over the field character for a moment (gold 앞면 / grey 뒷면);
// - 빨간 실: a red thread from my field character to the player who just appeared;
// - 합동 의식: a link ring at the midpoint (and the two drop spots joined).

import type { Entity, GameEvent, GameState, Vec2 } from '../../types';
import { PX_PER_UNIT, PX_PER_UNIT_Y, type Camera } from '../camera';
import { registerRewardFx, type RewardFxView } from './index';

const TAU = Math.PI * 2;

/** Colors per family (tag colors of src/data/rewards/tags.ts where it fits). */
const COLOR: Record<string, string> = {
  double_load: '#4cc9f0',
  understudy: '#43aa8b',
  punch_in: '#4cc9f0',
  window_fire: '#4cc9f0',
  nails: '#a7c957',
  candles: '#ffd166',
  coin: '#ffd166',
  haste_cost: '#e5383b',
  blood_entry: '#e5383b',
  hungry_pet: '#e5383b',
  soul_loan: '#e5383b',
  deadline: '#f3722c',
  team_relay: '#f472b6',
  joint_rite: '#f472b6',
  three_incense: '#f472b6',
  red_thread: '#ff4d6d',
  stand_in: '#f472b6',
  helping_hand: '#f472b6',
  shared_soul: '#f472b6',
  blood_oath: '#e5383b',
};

const TAILS = '#8d99ae';

/** Strength for my own effects vs another player's (never buries my fight). */
function k(view: RewardFxView, player: number): number {
  return player === view.localPlayer ? 1 : 0.5;
}

// ─────────────────────────── Lingering marks (sim time) ───────────────────────────

interface CoinMark {
  entityId: number;
  heads: boolean;
  until: number;
  player: number;
}
interface Thread {
  from: number;
  to: number;
  until: number;
}
interface Link {
  a: Vec2;
  b: Vec2;
  mid: Vec2;
  until: number;
  player: number;
}

const MAX_MARKS = 6;
const coins: CoinMark[] = [];
const threads: Thread[] = [];
const links: Link[] = [];

/** The last appear of each player (the thread goes to it; the rite joins two of them). */
const lastAppear = new Map<number, { entityId: number; pos: Vec2; t: number }>();

/** Sim time of the last event seen: a jump back means a new game (or a rewind), so the old marks go. */
let lastTime = 0;

function resetIfRewound(now: number): void {
  if (now < lastTime - 0.5) {
    coins.length = 0;
    threads.length = 0;
    links.length = 0;
    lastAppear.clear();
  }
  lastTime = now;
}

function push<T>(list: T[], item: T): void {
  list.push(item);
  while (list.length > MAX_MARKS) list.shift();
}

function onProc(ev: Extract<GameEvent, { type: 'rewardProc' }>, view: RewardFxView): void {
  const c = COLOR[ev.rewardId];
  if (!c || (ev.entityId == null && ev.rewardId !== 'joint_rite' && ev.rewardId !== 'three_incense')) return;
  const h = view.host;
  const s = k(view, ev.player);
  const { x, y } = ev.pos;
  const now = view.state.time;
  switch (ev.rewardId) {
    case 'coin': {
      for (let i = coins.length - 1; i >= 0; i--) if (coins[i].player === ev.player) coins.splice(i, 1);
      if (ev.entityId != null) push(coins, { entityId: ev.entityId, heads: ev.text === '앞면', until: now + 0.9, player: ev.player });
      h.burst(x, y, 1.6, Math.round(6 * s), ev.text === '앞면' ? c : TAILS, 2, 2.5, 0.4);
      break;
    }
    case 'red_thread': {
      if (ev.entityId == null) break;
      let best: { entityId: number; t: number } | null = null;
      for (const [pid, a] of lastAppear) if (pid !== ev.player && (!best || a.t > best.t)) best = a;
      if (best && now - best.t < 0.5) push(threads, { from: ev.entityId, to: best.entityId, until: now + 0.7 });
      h.ring(x, y, 0.2, 1, 0.35, c, 2, 0.1 * s);
      break;
    }
    case 'joint_rite': {
      let other: Vec2 | null = null;
      for (const [pid, a] of lastAppear) if (pid !== ev.player && now - a.t < 2) other = a.pos;
      const mine = lastAppear.get(ev.player)?.pos;
      if (mine && other) push(links, { a: { ...mine }, b: { ...other }, mid: { x, y }, until: now + 0.6, player: ev.player });
      h.ring(x, y, 0.3, 2.5, 0.45, c, 4, 0.14 * s);
      h.burst(x, y, 0.8, Math.round(14 * s), c, 3.5, 2.5, 0.5);
      break;
    }
    case 'three_incense':
      h.ring(x, y, 0.5, 9, 0.7, c, 5, 0.08 * s);
      h.burst(x, y, 1.5, Math.round(20 * s), c, 2, 4, 0.8, -1);
      h.shake(0.3 * s);
      break;
    case 'stand_in':
      h.ring(x, y, 0.3, 4, 0.45, c, 4, 0.1 * s);
      break;
    case 'understudy':
    case 'double_load':
    case 'punch_in':
      h.ring(x, y, 0.2, 1.6, 0.35, c, 3, 0.12 * s);
      h.burst(x, y, 1.2, Math.round(10 * s), c, 2.5, 3, 0.45);
      break;
    case 'deadline':
      h.ring(x, y, 2.2, 0.6, 0.45, c, 3, 0.1 * s);
      break;
    case 'nails':
    case 'candles':
      h.burst(x, y, 1, Math.round(8 * s), c, 1.2, 3.5, 0.6, -1.5);
      break;
    case 'team_relay':
    case 'shared_soul':
    case 'helping_hand':
      h.burst(x, y, 1.2, Math.round(10 * s), c, 2, 3, 0.5, -1);
      break;
    case 'blood_oath':
    case 'blood_entry':
    case 'haste_cost':
    case 'hungry_pet':
    case 'soul_loan':
      h.burst(x, y, 0.8, Math.round(8 * s), c, 1.8, 1.5, 0.45);
      break;
    default:
      break;
  }
}

// ─────────────────────────── Drawing ───────────────────────────

function entityAt(s: GameState, id: number): Entity | undefined {
  return s.entities.find(e => e.id === id && e.hp > 0);
}

function drawCoins(ctx: CanvasRenderingContext2D, cam: Camera, s: GameState, view: RewardFxView): void {
  for (let i = coins.length - 1; i >= 0; i--) {
    const m = coins[i];
    const left = m.until - s.time;
    const e = entityAt(s, m.entityId);
    if (left <= 0 || left > 2 || !e) {
      coins.splice(i, 1);
      continue;
    }
    const x = cam.sx(e.pos.x);
    const y = cam.sy(e.pos.y) - (e.radius * 2.6 + 0.6) * PX_PER_UNIT_Y - (0.9 - left) * 10;
    const r = 9;
    // spin: the coin is a squashed circle that widens as it lands on its face
    const spin = Math.min(1, (0.9 - left) / 0.3);
    ctx.globalAlpha = Math.min(1, left / 0.25) * (m.player === view.localPlayer ? 1 : 0.6);
    ctx.fillStyle = m.heads ? COLOR.coin : TAILS;
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.25 + 0.75 * spin), r, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (spin >= 1) {
      ctx.fillStyle = '#1b1b1b';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.heads ? '앞' : '뒤', x, y + 0.5);
    }
  }
}

function drawThreads(ctx: CanvasRenderingContext2D, cam: Camera, s: GameState, now: number): void {
  for (let i = threads.length - 1; i >= 0; i--) {
    const t = threads[i];
    const left = t.until - s.time;
    const a = entityAt(s, t.from);
    const b = entityAt(s, t.to);
    if (left <= 0 || left > 2 || !a || !b) {
      threads.splice(i, 1);
      continue;
    }
    const ax = cam.sx(a.pos.x);
    const ay = cam.sy(a.pos.y);
    const bx = cam.sx(b.pos.x);
    const by = cam.sy(b.pos.y);
    // a slack thread: a gentle curve that sways
    const sway = 14 * Math.sin(now * 9 + t.from);
    ctx.globalAlpha = Math.min(1, left / 0.3) * 0.85;
    ctx.strokeStyle = COLOR.red_thread;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 18 + sway, bx, by);
    ctx.stroke();
  }
}

function drawLinks(ctx: CanvasRenderingContext2D, cam: Camera, s: GameState, view: RewardFxView): void {
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    const left = l.until - s.time;
    if (left <= 0 || left > 2) {
      links.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, left / 0.3) * (l.player === view.localPlayer ? 0.8 : 0.4);
    ctx.strokeStyle = COLOR.joint_rite;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(cam.sx(l.a.x), cam.sy(l.a.y));
    ctx.lineTo(cam.sx(l.b.x), cam.sy(l.b.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(cam.sx(l.mid.x), cam.sy(l.mid.y), 2.5 * PX_PER_UNIT, 2.5 * PX_PER_UNIT_Y, 0, 0, TAU);
    ctx.stroke();
  }
}

export const RULES_FX = {
  onEvent(ev: GameEvent, view: RewardFxView): void {
    if (ev.type !== 'appear' && ev.type !== 'rewardProc') return;
    resetIfRewound(view.state.time);
    switch (ev.type) {
      case 'appear':
        lastAppear.set(ev.player, { entityId: ev.entityId, pos: { x: ev.pos.x, y: ev.pos.y }, t: view.state.time });
        break;
      case 'rewardProc':
        onProc(ev, view);
        break;
      default:
        break;
    }
  },
  draw(ctx: CanvasRenderingContext2D, state: GameState, view: RewardFxView, now: number): void {
    const cam = view.cam;
    if (!cam || (coins.length === 0 && threads.length === 0 && links.length === 0)) return;
    ctx.save();
    if (links.length) drawLinks(ctx, cam, state, view);
    if (threads.length) drawThreads(ctx, cam, state, now);
    if (coins.length) drawCoins(ctx, cam, state, view);
    ctx.restore();
  },
};

registerRewardFx(RULES_FX);

/** Live marks (tests). */
export function rulesFxMarks(): { coins: number; threads: number; links: number } {
  return { coins: coins.length, threads: threads.length, links: links.length };
}

