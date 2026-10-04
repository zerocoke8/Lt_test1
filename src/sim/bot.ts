// Bot controller (R23). Same rules as a human: it only issues Commands that go through dispatch validation.
// Uses the sim Rng so runs stay deterministic.

import type { AreaShape, Command, CommandResult, SkillAction, Vec2 } from '../types';
import { VIEW_WIDTH_UNITS } from '../config';
import { getCharacter, getPet } from '../data';
import { BOT } from './constants';
import { canSwap, canUsePet } from './players';
import { skillMod } from './modifiers';
import { scaleArea } from './skills';
import { activeEntity, clamp, clampToArena, copy, dist, getEntity, isAlive, type SimEntity, type SimPlayer, type World } from './world';

type Dispatch = (cmd: Command) => CommandResult;

export function tickBots(w: World, dt: number, dispatch: Dispatch): void {
  for (const p of w.state.players) {
    if (!p.isBot || p.out) continue;
    const b = p.rt.bot;
    const me = activeEntity(w, p);
    if (me) b.viewX = me.pos.x;
    b.thinkIn -= dt;
    if (b.thinkIn > 1e-9) continue;
    b.thinkIn += BOT.thinkInterval;
    think(w, p, dispatch);
    if (w.state.phase !== 'combat') return;
  }
}

function areaRadius(a: AreaShape): number {
  if (a.shape === 'circle') return a.radius;
  if (a.shape === 'line') return Math.max(a.width, 1);
  return 0.8;
}

function enemiesAlive(w: World): SimEntity[] {
  return w.state.entities.filter(e => e.team === 'enemy' && isAlive(e));
}
function alliesAlive(w: World): SimEntity[] {
  return w.state.entities.filter(e => e.team === 'ally' && isAlive(e));
}

function weightOf(e: SimEntity): number {
  return e.tier === 'boss' ? 3 : e.tier === 'mid' ? 2 : 1;
}

/** Horizontal slice of the arena a human in this bot's seat would see (camera follows the field character). */
interface View {
  lo: number;
  hi: number;
}

/**
 * Fairness (R23 "same rules"): a human can only drop on the visible screen (VIEW_WIDTH_UNITS wide, centered on the
 * field character, clamped to the arena). Bots get the same window; with an empty field it stays where it last was.
 */
function botView(w: World, p: SimPlayer): View {
  const a = w.state.plan.arena;
  const half = VIEW_WIDTH_UNITS / 2;
  const me = activeEntity(w, p);
  if (me) p.rt.bot.viewX = me.pos.x;
  const x = p.rt.bot.viewX ?? a.width / 2;
  const cx = a.width <= VIEW_WIDTH_UNITS ? a.width / 2 : clamp(x, half, a.width - half);
  return { lo: cx - half, hi: cx + half };
}

function inView(view: View, c: Vec2): boolean {
  return c.x >= view.lo - 1e-9 && c.x <= view.hi + 1e-9;
}

function toView(w: World, view: View, c: Vec2): Vec2 {
  return clampToArena(w, { x: clamp(c.x, view.lo, view.hi), y: c.y });
}

/** Candidate drop points: around every relevant unit on the bot's screen (clamped into the arena). */
function bestPoint(w: World, units: SimEntity[], score: (c: Vec2) => number, near: Vec2 | null, view: View): { pos: Vec2; score: number } | null {
  let best: { pos: Vec2; score: number } | null = null;
  for (const u of units) {
    const c = clampToArena(w, u.pos);
    if (!inView(view, c)) continue;
    let sc = score(c);
    if (near) sc -= dist(c, near) * 0.001; // tiebreak: closer to the bot
    if (!best || sc > best.score) best = { pos: c, score: sc };
  }
  return best;
}

function coverEnemies(enemies: SimEntity[], radius: number): (c: Vec2) => number {
  return c => {
    let n = 0;
    for (const e of enemies) if (dist(c, e.pos) <= radius + e.radius) n += weightOf(e);
    return n;
  };
}

function coverHurtAllies(allies: SimEntity[], radius: number): (c: Vec2) => number {
  return c => {
    let n = 0;
    for (const a of allies) if (dist(c, a.pos) <= radius + a.radius) n += 0.2 + (1 - a.hp / a.maxHp);
    return n;
  };
}

/** Where to drop party member idx: spot where its drag skill covers the most enemies (or hurt allies). */
export function bestDropPoint(w: World, p: SimPlayer, idx: number): Vec2 {
  const def = getCharacter(p.party[idx].defId);
  const action: SkillAction = def.drag.actions[0];
  const radius = areaRadius(scaleArea(action.area, 1 + skillMod(p, idx, 'drag', 'radius')));
  const me = activeEntity(w, p);
  const near = me ? copy(me.pos) : null;
  const view = botView(w, p);
  const enemies = enemiesAlive(w);
  if (action.affects === 'allies') {
    const allies = alliesAlive(w).filter(a => a.kind === 'character');
    const hurt = allies.filter(a => a.hp < a.maxHp * 0.9);
    const best = bestPoint(w, hurt.length ? hurt : allies, coverHurtAllies(allies, radius), near, view);
    if (best) return best.pos;
  } else {
    const best = bestPoint(w, enemies, coverEnemies(enemies, radius), near, view);
    if (best && best.score > 0) return best.pos;
  }
  const t = me ? getEntity(w, me.targetId) : null;
  if (t) return toView(w, view, t.pos);
  if (me) return copy(me.pos);
  if (enemies.length) {
    // nearest enemy to the screen, dropped at the screen edge facing it
    const cx = (view.lo + view.hi) / 2;
    let n = enemies[0];
    for (const e of enemies) if (Math.abs(e.pos.x - cx) < Math.abs(n.pos.x - cx)) n = e;
    return toView(w, view, n.pos);
  }
  const a = w.state.plan.arena;
  return toView(w, view, { x: a.width / 2, y: a.height / 2 });
}

function think(w: World, p: SimPlayer, dispatch: Dispatch): void {
  const s = w.state;
  if (s.phase !== 'combat') return;
  const b = p.rt.bot;
  const enemies = enemiesAlive(w);

  // Ult: 0.5–3 s after full.
  if (p.ult.charge >= 1) {
    if (b.ultAt == null) b.ultAt = (p.ult.fullSince ?? s.time) + w.rng.range(BOT.ultDelay[0], BOT.ultDelay[1]);
    if (s.time >= b.ultAt && enemies.length > 0 && p.activeIndex != null) {
      if (dispatch({ type: 'ult', player: p.id }).ok) b.ultAt = null;
    }
  } else {
    b.ultAt = null;
  }

  // Swap.
  const ready: number[] = [];
  p.party.forEach((_, i) => {
    if (canSwap(w, p.id, i).ok) ready.push(i);
  });
  const me = activeEntity(w, p);
  const byHp = (a: number, c: number) => p.party[c].hp / p.party[c].maxHp - p.party[a].hp / p.party[a].maxHp;
  const swapTo = (idx: number) => {
    const pos = bestDropPoint(w, p, idx);
    if (dispatch({ type: 'swap', player: p.id, partyIndex: idx, pos }).ok) {
      b.nextSwapAt = s.time + w.rng.range(BOT.periodicSwap[0], BOT.periodicSwap[1]);
      b.reactAt = null;
    }
  };
  if (!me) {
    if (ready.length > 0) {
      if (b.reactAt == null) b.reactAt = s.time + w.rng.range(BOT.reaction[0], BOT.reaction[1]);
      else if (s.time >= b.reactAt) swapTo([...ready].sort(byHp)[0]);
    }
  } else {
    b.reactAt = null;
    if (ready.length > 0 && me.hp < me.maxHp * BOT.lowHpFrac) {
      swapTo([...ready].sort(byHp)[0]);
    } else if (ready.length > 0 && enemies.length > 0 && s.time >= b.nextSwapAt) {
      swapTo(w.rng.pick(ready));
    }
  }
  if (s.phase !== 'combat') return;

  // Pets: when ready and worth it.
  for (let i = 0; i < p.pets.length; i++) {
    if (!canUsePet(w, p.id, i).ok) continue;
    const pos = petPoint(w, p, i, enemies);
    if (pos && dispatch({ type: 'pet', player: p.id, petIndex: i, pos }).ok) break;
  }
}

function petPoint(w: World, p: SimPlayer, i: number, enemies: SimEntity[]): Vec2 | null {
  const def = getPet(p.pets[i].defId);
  const a = def.action;
  const radius = areaRadius(a.area);
  const me = activeEntity(w, p);
  const near = me ? copy(me.pos) : null;
  const view = botView(w, p);
  if (a.summon) {
    if (enemies.length < 2) return null;
    const anchor = me ?? alliesAlive(w).find(x => x.kind === 'character' && inView(view, x.pos)) ?? null;
    if (!anchor) return null;
    let nearest = enemies[0];
    for (const e of enemies) if (dist(anchor.pos, e.pos) < dist(anchor.pos, nearest.pos)) nearest = e;
    return toView(w, view, { x: (anchor.pos.x + nearest.pos.x) / 2, y: (anchor.pos.y + nearest.pos.y) / 2 });
  }
  if (a.affects === 'enemies') {
    const best = bestPoint(w, enemies, coverEnemies(enemies, radius), near, view);
    return best && best.score >= 2 ? best.pos : null;
  }
  // allies
  const allies = alliesAlive(w).filter(x => x.kind === 'character');
  if (allies.length === 0) return null;
  const heals = a.effects.some(e => e.kind === 'heal');
  if (heals) {
    const hurt = allies.filter(x => x.hp < x.maxHp * BOT.healPetHpFrac);
    if (hurt.length === 0) return null;
    const best = bestPoint(w, hurt, coverHurtAllies(allies, radius), near, view);
    return best ? best.pos : null;
  }
  if (enemies.length < 2) return null;
  const shields = a.effects.some(e => e.kind === 'shield');
  if (shields && !allies.some(x => x.hp < x.maxHp * BOT.shieldPetHpFrac)) return null;
  const cover = (c: Vec2) => {
    let n = 0;
    for (const x of allies) if (dist(c, x.pos) <= radius + x.radius) n += x.ownerPlayer === p.id ? 1.5 : 1;
    return n;
  };
  const best = bestPoint(w, allies, cover, near, view);
  return best ? best.pos : null;
}
