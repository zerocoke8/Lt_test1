// Bot controller (R23). Same rules as a human: it only issues Commands that go through dispatch validation.
// Uses the sim Rng so runs stay deterministic.

import type { Command, CommandResult, PreviewPart, Vec2 } from '../types';
import { VIEW_WIDTH_UNITS } from '../config';
import type { SkillDef } from '../types';
import { getCharacter, getPet } from '../data';
import { BOT } from './constants';
import { TARGET_WEIGHT, eventDropBonus, eventPetPoint, eventThink } from './botEvents';
import { aimSamples, containsPoint, hitsArea } from './geometry';
import { canSwap, canUsePet } from './players';
import { fieldUltGauge, memberUltGauge, perCharUlt } from './ultMode';
import { previewPartsFor } from './preview';
import { activeEntity, clamp, clampToArena, copy, dist, getEntity, isAlive, type SimEntity, type SimPlayer, type World } from './world';

type Dispatch = (cmd: Command) => CommandResult;

export function tickBots(w: World, dt: number, dispatch: Dispatch): void {
  for (const p of w.state.players) {
    if (!p.isBot || p.out) continue;
    const b = p.rt.bot;
    const me = activeEntity(w, p);
    if (me) b.viewX = me.pos.x;
    groggyReact(w, p);
    b.thinkIn -= dt;
    if (b.thinkIn > 1e-9) continue;
    b.thinkIn += BOT.thinkInterval;
    think(w, p, dispatch);
    if (w.state.phase !== 'combat') return;
  }
}

function enemiesAlive(w: World): SimEntity[] {
  return w.state.entities.filter(e => e.team === 'enemy' && isAlive(e));
}
function alliesAlive(w: World): SimEntity[] {
  return w.state.entities.filter(e => e.team === 'ally' && isAlive(e));
}

function weightOf(e: SimEntity): number {
  return e.eventTag === 'target' ? TARGET_WEIGHT : e.tier === 'boss' ? 3 : e.tier === 'mid' ? 2 : 1; // 기획 12차: 돌발 괴담 target 4
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

// ─────────────────────────── R29: aim with the real footprint ───────────────────────────

function partCenter(part: PreviewPart, drop: Vec2): Vec2 {
  return { x: drop.x + part.offset.x, y: drop.y + part.offset.y };
}

function partHits(part: PreviewPart, drop: Vec2, e: SimEntity): boolean {
  const c = partCenter(part, drop);
  return hitsArea(part.area, c, c, e.pos, e.radius);
}

/** Enemy score of a drop: every (part, enemy) hit by weight, a bonus when the enemy is fully inside (well aimed). */
function enemyScore(parts: PreviewPart[], drop: Vec2, enemies: SimEntity[]): number {
  let n = 0;
  for (const part of parts) {
    if (part.affects !== 'enemies') continue;
    const c = partCenter(part, drop);
    for (const e of enemies) {
      if (!hitsArea(part.area, c, c, e.pos, e.radius)) continue;
      n += weightOf(e);
      if (containsPoint(part.area, c, e.pos)) n += 0.05;
    }
  }
  return n;
}

/** Ally score: hurt allies count more (heals), healthy ones a little (buffs / shields). */
function allyScore(parts: PreviewPart[], drop: Vec2, allies: SimEntity[], perAlly: (a: SimEntity) => number): number {
  let n = 0;
  for (const part of parts) {
    if (part.affects !== 'allies') continue;
    for (const a of allies) if (partHits(part, drop, a)) n += perAlly(a);
  }
  return n;
}

const hurtWeight = (a: SimEntity) => 0.2 + (1 - a.hp / a.maxHp);

/** 기획 13차: how much a healer's drop also counts the enemies its damage parts reach (allies come first). */
const HEALER_ENEMY_WEIGHT = 0.15;

/**
 * Candidate drop points that put a unit on a representative spot of some part (its offset + aim samples):
 * fixed-direction shapes get candidates BEHIND the unit (e.g. LEFT of a cluster for a 'right' rect / cone / dash).
 * Each candidate is pulled onto the bot's screen and into the arena, then scored as dropped there.
 */
function bestDrop(
  w: World,
  parts: PreviewPart[],
  units: SimEntity[],
  aimWith: PreviewPart['affects'],
  score: (c: Vec2) => number,
  near: Vec2 | null,
  view: View,
): { pos: Vec2; score: number } | null {
  let best: { pos: Vec2; score: number } | null = null;
  for (const part of parts) {
    if (part.affects !== aimWith) continue;
    const samples = aimSamples(part.area);
    for (const u of units) {
      for (const s of samples) {
        const c = toView(w, view, { x: u.pos.x - part.offset.x - s.x, y: u.pos.y - part.offset.y - s.y });
        let sc = score(c);
        if (near) sc -= dist(c, near) * 0.001; // tiebreak: closer to the bot
        if (!best || sc > best.score) best = { pos: c, score: sc };
      }
    }
  }
  return best;
}

/** Where to drop party member idx: spot where its real drag footprint covers the most enemies (or hurt allies). */
export function bestDropPoint(w: World, p: SimPlayer, idx: number): Vec2 {
  const parts = previewPartsFor(w.state, p.id, 'swap', idx);
  const me = activeEntity(w, p);
  const near = me ? copy(me.pos) : null;
  const view = botView(w, p);
  const enemies = enemiesAlive(w);
  const allies = alliesAlive(w).filter(a => a.kind === 'character');
  // 기획 13차: a healer's renewed drag also hits enemies (종, 제세동) — it still aims at the hurt allies first
  const healer = getCharacter(p.party[idx].defId).role === 'healer' && parts.some(pt => pt.affects === 'allies');
  if (!parts.some(pt => pt.affects === 'enemies') || healer) {
    const hurt = allies.filter(a => a.hp < a.maxHp * 0.9);
    const foes = (c: Vec2) => (healer ? enemyScore(parts, c, enemies) * HEALER_ENEMY_WEIGHT : 0);
    const score = (c: Vec2) => allyScore(parts, c, allies, hurtWeight) + foes(c) + eventDropBonus(w, p, 'swap', idx, c);
    const best = bestDrop(w, parts, hurt.length ? hurt : allies, 'allies', score, near, view);
    if (best) return best.pos;
  } else {
    const score = (c: Vec2) => enemyScore(parts, c, enemies) + allyScore(parts, c, allies, () => 0.3) + eventDropBonus(w, p, 'swap', idx, c);
    const best = bestDrop(w, parts, enemies, 'enemies', score, near, view);
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

  // Ult: 0.5–3 s after full (기획 14차: the field character's own gauge in per-character mode). Deliberately from
  // fullSince, not the swap-in: a bench card that is already full is cast right after it comes on — the bot pulls full
  // cards for exactly that (ultCard), like the measured human seat (docs/balance.md 13-1); the ult-delay STAT uses
  // ultCastableSince instead.
  const ult = fieldUltGauge(p);
  if (ult && ult.charge >= 1) {
    if (b.ultAt == null) b.ultAt = (ult.fullSince ?? s.time) + w.rng.range(BOT.ultDelay[0], BOT.ultDelay[1]);
    // 기획 13차: a full ult goes into a groggy boss soon (never saved up for one)
    if (groggyDown(w)) b.ultAt = Math.min(b.ultAt, s.time + BOT.ultGroggy);
    if (s.time >= b.ultAt && enemies.length > 0 && p.activeIndex != null) {
      if (dispatch({ type: 'ult', player: p.id }).ok) b.ultAt = null;
    }
  } else {
    b.ultAt = null;
  }

  eventThink(w, p, dispatch); // 기획 12차: once per 돌발 괴담, swap toward it (src/sim/botEvents.ts)
  if (s.phase !== 'combat') return;

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
      swapTo(emergencyCard(p, ready, byHp));
    } else if (ready.length > 0 && enemies.length > 0 && s.time >= b.nextSwapAt) {
      swapTo(groggyCard(w, p, ready) ?? ultCard(p, ready, enemies) ?? periodicCard(p, ready) ?? w.rng.pick(ready));
    } else {
      // 기획 14차: no need to wait for the periodic swap when a full-ult card is ready and the field one is spent
      const u = ultCard(p, ready, enemies);
      if (u != null) swapTo(u);
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
  const ev = eventPetPoint(w, p, i); // 기획 12차: 돌발 괴담 pet rules first (undefined = none)
  if (ev !== undefined) return ev;
  const a = getPet(p.pets[i].defId).action;
  const parts = previewPartsFor(w.state, p.id, 'pet', i);
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
    const best = bestDrop(w, parts, enemies, 'enemies', c => enemyScore(parts, c, enemies) + eventDropBonus(w, p, 'pet', i, c), near, view);
    return best && best.score >= 2 ? best.pos : null;
  }
  // allies
  const allies = alliesAlive(w).filter(x => x.kind === 'character');
  if (allies.length === 0) return null;
  const heals = a.effects.some(e => e.kind === 'heal');
  if (heals) {
    const hurt = allies.filter(x => x.hp < x.maxHp * BOT.healPetHpFrac);
    if (hurt.length === 0) return null;
    const best = bestDrop(w, parts, hurt, 'allies', c => allyScore(parts, c, allies, hurtWeight), near, view);
    return best ? best.pos : null;
  }
  if (enemies.length < 2) return null;
  const shields = a.effects.some(e => e.kind === 'shield');
  if (shields && !allies.some(x => x.hp < x.maxHp * BOT.shieldPetHpFrac)) return null;
  const best = bestDrop(w, parts, allies, 'allies', c => allyScore(parts, c, allies, x => (x.ownerPlayer === p.id ? 1.5 : 1)), near, view);
  return best ? best.pos : null;
}

// ─────────────────────────── 기획 12차: new characters (docs/new-characters.md 8장) ───────────────────────────
// Both only change the pick when a new character is in the party, so the BOT_PRESETS runs (and their rng draws) stay.

/** Emergency swap (field < 30 %): a ready 메딕 (the leaving card heals on the bench), else 퍼펫티어 (decoys), else the healthiest. */
function emergencyCard(p: SimPlayer, ready: number[], byHp: (a: number, c: number) => number): number {
  const medic = ready.find(i => p.party[i].defId === 'medic');
  if (medic != null) return medic;
  const puppeteer = ready.find(i => p.party[i].defId === 'puppeteer');
  if (puppeteer != null) return puppeteer;
  return [...ready].sort(byHp)[0];
}

/** Periodic swap: a ready 메딕 when a bench card is down or the bench averages under 60 % HP; null = random as before. */
function periodicCard(p: SimPlayer, ready: number[]): number | null {
  const medic = ready.find(i => p.party[i].defId === 'medic');
  if (medic == null) return null;
  const bench = p.party.filter((_, i) => i !== p.activeIndex);
  if (bench.length === 0) return null;
  const down = bench.some(m => m.dead);
  const avg = bench.reduce((sum, m) => sum + (m.dead ? 0 : m.hp / Math.max(1, m.maxHp)), 0) / bench.length;
  return down || avg < BENCH_LOW_HP_FRAC ? medic : null;
}

const BENCH_LOW_HP_FRAC = 0.6;

/**
 * 기획 14차 궁극기 개별 게이지: the field character's ult is not ready but a ready bench card's own gauge is full and the
 * fight is worth an ult (boss / mid boss on field, or BOT.ultSwapEnemies+ enemies) → that card (fullest wait first).
 * Null while the toggle is off (no rng draw: today's bot runs stay identical).
 */
function ultCard(p: SimPlayer, ready: number[], enemies: SimEntity[]): number | null {
  if (!perCharUlt(p) || ready.length === 0) return null;
  const field = fieldUltGauge(p);
  if (field && field.charge >= 1) return null;
  if (!enemies.some(e => e.tier === 'boss' || e.tier === 'mid') && enemies.length < BOT.ultSwapEnemies) return null;
  let best: number | null = null;
  let since = Infinity;
  for (const i of ready) {
    const g = memberUltGauge(p, i);
    if (g && g.charge >= 1 && (g.fullSince ?? 0) < since) {
      best = i;
      since = g.fullSince ?? 0;
    }
  }
  return best;
}

// ─────────────────────────── 기획 13차: boss groggy (docs/boss-groggy.md 7장) ───────────────────────────
// Same gauge rules as a human (no seat weights); emergency swaps and the 돌발 괴담 rules come first.

function groggyDown(w: World): boolean {
  return (w.state.bossGroggy?.left ?? 0) > 0;
}

/** The boss just broke: a bot with a ready card pulls its next periodic swap to 0.5–1.5 s from now (one draw per break). */
function groggyReact(w: World, p: SimPlayer): void {
  const g = w.state.bossGroggy;
  const b = p.rt.bot;
  const serial = w.groggy.breakSerial;
  if (!g || g.left <= 0 || b.groggySeen === serial) return;
  b.groggySeen = serial;
  if (!p.party.some((_, i) => canSwap(w, p.id, i).ok)) return;
  b.nextSwapAt = Math.min(b.nextSwapAt, w.state.time + w.rng.range(BOT.reaction[0], BOT.reaction[1]));
}

function stunOf(sk: SkillDef): number {
  let d = 0;
  for (const a of sk.actions) for (const e of a.effects) if (e.kind === 'status' && e.status === 'stun' && a.affects === 'enemies') d = Math.max(d, e.duration);
  return d;
}

function damageOf(sk: SkillDef): number {
  let n = 0;
  for (const a of sk.actions) {
    if (a.affects !== 'enemies') continue;
    for (const e of a.effects) if (e.kind === 'damage') n += e.amount * Math.max(1, a.hits ?? 1);
  }
  return n;
}

/**
 * Periodic pick around a groggy boss: while it is down the finisher (no-stun drag with the most damage); while the
 * gauge is almost full (not locked) the stun drag with the longest stun (the breaker). Null = as before.
 */
export function groggyCard(w: World, p: SimPlayer, ready: number[]): number | null {
  const g = w.state.bossGroggy;
  if (!g || ready.length === 0) return null;
  const drag = (i: number) => getCharacter(p.party[i].defId).drag;
  let best: number | null = null;
  let bestV = 0;
  if (g.left > 0) {
    for (const i of ready) {
      const sk = drag(i);
      const v = stunOf(sk) > 0 ? 0 : damageOf(sk);
      if (v > bestV + 1e-9) {
        best = i;
        bestV = v;
      }
    }
    return best;
  }
  if (g.lock > 0 || g.fill < BOT.nearFull) return null;
  for (const i of ready) {
    const v = stunOf(drag(i));
    if (v > bestV + 1e-9) {
      best = i;
      bestV = v;
    }
  }
  return best;
}
