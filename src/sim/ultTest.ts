// 기획 22차 궁극기 테스트 (docs/ult-test.md): how an aimed ('aim' 조준) or dragged ('drag' 드래그) ult is cast.
// Everything here is PURE over the public GameState + content data, so the sim (cast, bots), the multiplayer client
// (its local preview and pre-check) and the HUD all compute the very same plan. The sim side (move, cast) is in
// players.ts useUlt; nothing here runs outside mode 'ultTest', so every other mode is bit-identical.
//
// The plan of one cast:
//  - 조준: the point (clamped to the arena, then to the alt's aimRange) and the aim direction (caster → point).
//    The character's own 조준 ult (src/data/ultTest) is turned toward the aim (rel 'aim' parts); without one the
//    FALLBACK takes today's ult: a direction ult (a rect / cone / line / fan / dash / charge part) is turned toward the
//    point, any other ult is re-centred on it ('self' parts → the point; whole-field ally parts and self-only parts as
//    they are; 'target' parts → the enemy nearest the point).
//  - 드래그: the field character moves to the point (blink by default; at most move.maxRange cells) and casts its own
//    드래그 ult there (rel 'aim' = the way it moved), or today's ult unchanged (FALLBACK).
//  - 'target' parts: the enemy whose edge is within ULT_TEST.snapRadius of the point (nearest, then lower id).
//    조준 with nobody there: the point itself. 드래그 with nobody there: the character's own target.

import type { CommandResult, Entity, GameState, PlayerState, RaidMode, SkillAction, SkillDef, UltAim, UltAimMode, UltPreviewPart, Vec2 } from '../types';
import { getCharacter } from '../data';
import { ULT_TEST, ultAlt, type UltAltDef, type UltMove } from '../data/ultTest';
import { ARENA_MARGIN } from './constants';
import { areaRot, dashEnd, faceVec, scaleArea, scaleDash } from './geometry';
import { skillMod } from './modifiers';

// ─────────────────────────── mode ───────────────────────────

/** 기획 19차 / 22차: the boss-raid-shaped modes (the raid's floors, rewards, HUD, result). */
export function isRaidMode(mode: GameState['mode'] | null | undefined): mode is RaidMode {
  return mode === 'bossRaid' || mode === 'ultTest';
}

export const ULT_MODES: readonly UltAimMode[] = ['now', 'aim', 'drag'];

/** The words the preset screen, the debug panel and the HUD use. */
export const ULT_MODE_LABEL: Readonly<Record<UltAimMode, string>> = { now: '현재', aim: '조준', drag: '드래그' };

export function isUltAimMode(v: unknown): v is UltAimMode {
  return v === 'now' || v === 'aim' || v === 'drag';
}

/** How player `pi` uses the ult now ('now' outside 궁극기 테스트). */
export function ultModeOf(state: Pick<GameState, 'mode' | 'players'>, pi: number): UltAimMode {
  if (state.mode !== 'ultTest') return 'now';
  return state.players[pi]?.ultMode ?? 'now';
}

/**
 * The extra check of an aimed / dragged ult command (after the usual canUlt): outside 궁극기 테스트 the aim is ignored
 * (ok). Inside, the aim's mode must be the player's mode (debug may have switched it while the finger was down) and
 * the point a real number pair.
 */
export function ultAimProblem(state: Pick<GameState, 'mode' | 'players'>, pi: number, aim: UltAim | undefined): CommandResult {
  if (!aim || state.mode !== 'ultTest') return { ok: true };
  if (aim.mode !== 'aim' && aim.mode !== 'drag') return { ok: false, reason: '잘못된 방식' };
  if (!aim.point || !Number.isFinite(aim.point.x) || !Number.isFinite(aim.point.y)) return { ok: false, reason: '잘못된 지점' };
  if (ultModeOf(state, pi) !== aim.mode) return { ok: false, reason: '궁극기 방식이 바뀌었어요' };
  return { ok: true };
}

// ─────────────────────────── plan ───────────────────────────

export interface UltMovePlan {
  kind: UltMove['kind'];
  from: Vec2;
  to: Vec2;
  path?: UltMove['path'];
}

export interface UltPlan {
  mode: 'aim' | 'drag';
  /** What is cast: the character's own alt (name / id / castTime), else today's ult (the fallback). */
  skill: SkillDef;
  alt: UltAltDef | null;
  /** The actions to cast, already turned / re-centred (no rel 'aim' left). */
  actions: SkillAction[];
  /** Where the field character stands when it casts (드래그: after the move). */
  caster: Vec2;
  /** 조준: the aimed point (clamped). 드래그: where the character lands. ctx.point of the cast. */
  point: Vec2;
  /** The aim, degrees clockwise from +x on screen (조준: caster → point; 드래그: the move; no length: its facing). */
  aimDeg: number;
  /** 드래그: the move (null in 조준). */
  move: UltMovePlan | null;
  /** 'target' parts: the snapped enemy (null = nobody near the point). */
  targetId: number | null;
  /** 조준 with nobody near: 'target' parts land on this point. Null otherwise. */
  targetPoint: Vec2 | null;
}

type Ent = Pick<Entity, 'id' | 'team' | 'pos' | 'radius' | 'hp' | 'facing' | 'kind'>;

function gone(e: Ent): boolean {
  return e.hp <= 0 || !!(e as { rt?: { gone?: boolean } }).rt?.gone;
}

function fieldEntity(state: GameState, p: PlayerState): Ent | null {
  if (p.activeIndex == null) return null;
  const id = p.party[p.activeIndex]?.entityId;
  const e = id != null ? state.entities.find(x => x.id === id) : undefined;
  return e && !gone(e) ? e : null;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** A point kept `margin` inside the arena (non-numbers → the middle), like the sim's clampToArena. */
export function clampUltPoint(state: Pick<GameState, 'plan'>, p: Vec2, margin = ARENA_MARGIN): Vec2 {
  const a = state.plan.arena;
  return {
    x: clamp(Number.isFinite(p.x) ? p.x : a.width / 2, margin, a.width - margin),
    y: clamp(Number.isFinite(p.y) ? p.y : a.height / 2, margin, a.height - margin),
  };
}

/** `to` pulled back toward `from` so it is at most `max` away. */
function within(from: Vec2, to: Vec2, max: number): Vec2 {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(max >= 0) || d <= max || d < 1e-9) return { x: to.x, y: to.y };
  const k = max / d;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/** Degrees with float dust removed, in [0, 360). */
function normDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  const r = Math.round(d * 1e6) / 1e6;
  return r === 360 || r === 0 ? 0 : r;
}

function aimDegOf(from: Vec2, to: Vec2, facing: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return normDeg(((Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : facing) * 180) / Math.PI);
}

/** The enemy nearest `at` whose edge is within ULT_TEST.snapRadius (ties → lower id), or null. */
export function snapUltTarget(state: Pick<GameState, 'entities'>, at: Vec2): Ent | null {
  let best: Ent | null = null;
  let bd = Infinity;
  for (const e of state.entities) {
    if (e.team !== 'enemy' || gone(e)) continue;
    const d = Math.hypot(e.pos.x - at.x, e.pos.y - at.y) - e.radius;
    if (d > ULT_TEST.snapRadius) continue;
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && e.id < best.id)) {
      best = e;
      bd = d;
    }
  }
  return best;
}

/**
 * The plan of player `pi`'s aimed / dragged ult (null: no field character, not 궁극기 테스트, or a mode problem). PURE —
 * the sim casts exactly this, the client previews exactly this.
 */
export function planUlt(state: GameState, pi: number, aim: UltAim): UltPlan | null {
  if (state.mode !== 'ultTest' || !ultAimProblem(state, pi, aim).ok) return null;
  const p = state.players[pi];
  const e = p ? fieldEntity(state, p) : null;
  if (!p || !e || p.activeIndex == null) return null;
  const def = getCharacter(p.party[p.activeIndex].defId);
  const from = { x: e.pos.x, y: e.pos.y };
  if (aim.mode === 'aim') {
    const alt = ultAlt(def.id, 'aim');
    let point = clampUltPoint(state, aim.point);
    if (alt?.aimRange != null && alt.aimRange > 0) point = clampUltPoint(state, within(from, point, alt.aimRange));
    const aimDeg = aimDegOf(from, point, e.facing);
    const actions = alt ? turnAimParts(alt.actions, aimDeg) : aimFallback(def.ult.actions, aimDeg);
    const t = snapUltTarget(state, point);
    return { mode: 'aim', skill: alt ?? def.ult, alt, actions, caster: from, point, aimDeg, move: null, targetId: t?.id ?? null, targetPoint: t ? null : point };
  }
  const alt = ultAlt(def.id, 'drag');
  const move: UltMove = alt?.move ?? { kind: 'blink', maxRange: ULT_TEST.dragRange };
  const margin = Math.max(ARENA_MARGIN, Math.min(e.radius, 1)); // where a character may stand (entities.ts clampUnit)
  const to = clampUltPoint(state, within(from, clampUltPoint(state, aim.point, margin), move.maxRange), margin);
  const aimDeg = aimDegOf(from, to, e.facing);
  const actions = alt ? turnAimParts(alt.actions, aimDeg) : def.ult.actions.slice();
  const t = snapUltTarget(state, to);
  return {
    mode: 'drag',
    skill: alt ?? def.ult,
    alt,
    actions,
    caster: to,
    point: to,
    aimDeg,
    move: { kind: move.kind, from, to, ...(move.path ? { path: move.path } : null) },
    targetId: t?.id ?? null,
    targetPoint: null,
  };
}

/** The name the ult button shows for this player's mode now (the alt's name, else today's ult). */
export function ultNameFor(state: Pick<GameState, 'mode' | 'players'>, pi: number, defId: string): string {
  const mode = ultModeOf(state, pi);
  const def = getCharacter(defId);
  if (mode === 'now') return def.ult.name;
  return ultAlt(defId, mode)?.name ?? def.ult.name;
}

// ─────────────────────────── preview ───────────────────────────

/**
 * The plan's parts in world space for the live preview (my screen): where each part lands with the player's ult radius
 * rewards applied the way the cast applies them. Self-only parts and woundedAlly picks have no footprint (skipped);
 * whole-field parts are kept (the renderer leaves them out). PURE.
 */
export function ultPreviewParts(state: GameState, pi: number, plan: UltPlan): UltPreviewPart[] {
  const p = state.players[pi];
  const idx = p?.activeIndex ?? null;
  const mult = p && idx != null ? 1 + skillMod(p, idx, 'ult', 'radius') : 1;
  const target = plan.targetId != null ? state.entities.find(e => e.id === plan.targetId) : undefined;
  const own = (() => {
    const e = p ? fieldEntity(state, p) : null;
    const t = e && (e as Entity).targetId != null ? state.entities.find(x => x.id === (e as Entity).targetId && !gone(x)) : undefined;
    return t?.pos ?? null;
  })();
  const targetAt = target?.pos ?? plan.targetPoint ?? own ?? plan.point;
  const caster = { x: plan.caster.x, y: plan.caster.y };
  const out: UltPreviewPart[] = [];
  for (const a of plan.actions) {
    if (a.affects === 'self' || a.center === 'woundedAlly') continue;
    const base = a.center === 'point' ? plan.point : a.center === 'self' ? caster : a.center === 'arena' ? { x: 0, y: 0 } : targetAt;
    const center = { x: base.x + (a.offset?.x ?? 0), y: base.y + (a.offset?.y ?? 0) };
    const part: UltPreviewPart = { area: scaleArea(a.area, mult), center, origin: { x: caster.x, y: caster.y }, affects: a.affects, delay: a.delay ?? 0 };
    if (a.dash) {
      const d = scaleDash(a.dash, mult);
      const from = a.dash.atFire ? { x: caster.x, y: caster.y } : center;
      const to = dashEnd(from, d.dir, d.distance, state.plan.arena, ARENA_MARGIN, d.rot);
      if (!a.dash.atFire) part.dash = { from, to };
      caster.x = to.x;
      caster.y = to.y;
    }
    out.push(part);
  }
  return out;
}

// ─────────────────────────── action transforms ───────────────────────────

const DIR_DEG = { right: 0, down: 90, left: 180, up: 270 } as const;

function dashRot(d: NonNullable<SkillAction['dash']>): number {
  return d.rot ?? DIR_DEG[d.dir];
}

/** Turn an offset `deg` degrees clockwise (quarter turns exact). */
function turnVec(v: Vec2, deg: number): Vec2 {
  const r = faceVec(v, (deg * Math.PI) / 180);
  return { x: r.x === 0 ? 0 : r.x, y: r.y === 0 ? 0 : r.y };
}

/** One part turned by `deg`: rect / cone direction, dash direction and offset. */
function turnPart(a: SkillAction, deg: number): SkillAction {
  const out: SkillAction = { ...a };
  delete out.rel;
  if (a.area.shape === 'rect' || a.area.shape === 'cone') out.area = { ...a.area, rot: normDeg(areaRot(a.area) + deg) };
  if (a.dash) out.dash = { ...a.dash, rot: normDeg(dashRot(a.dash) + deg) };
  if (a.offset) out.offset = turnVec(a.offset, deg);
  return out;
}

/** An alt's rel 'aim' parts turned toward the aim (written as if aiming at +x); the other parts as written. */
export function turnAimParts(actions: readonly SkillAction[], aimDeg: number): SkillAction[] {
  return actions.map(a => (a.rel === 'aim' ? turnPart(a, aimDeg) : { ...a }));
}

/** A part that has a direction of its own (turned by the fallback) or aims itself at its center. */
function isDirectional(a: SkillAction): boolean {
  const s = a.area.shape;
  return s === 'rect' || s === 'cone' || s === 'line' || s === 'fan' || !!a.dash || !!a.charge;
}

/** The fallback's whole-field part (every ally on the field: guardian 보호막, cleric 은총 …): never moved. */
function isWholeField(a: SkillAction): boolean {
  return a.area.shape === 'circle' && a.area.radius >= ULT_TEST.wholeField;
}

/**
 * FALLBACK 조준 (no own 조준 ult yet): today's ult aimed at the point.
 *  - direction ult (any rect / cone / line / fan / dash / charge part): every part turned by (aim − the first own
 *    direction) — rect / cone / dash directions and offsets — and auto-aimed parts (line / fan / charge) pointed at
 *    the point; centers stay (the ult happens where the caster is, toward the point).
 *  - area ult: 'self'-centred parts land on the point (follow dropped); whole-field and self-only parts unchanged;
 *    'target' parts keep 'target' (the cast snaps the target to the point).
 */
export function aimFallback(actions: readonly SkillAction[], aimDeg: number): SkillAction[] {
  if (actions.some(isDirectional)) {
    let base: number | null = null;
    for (const a of actions) {
      if (a.area.shape === 'rect' || a.area.shape === 'cone') base = areaRot(a.area);
      else if (a.dash) base = dashRot(a.dash);
      if (base != null) break;
    }
    const delta = base == null ? 0 : aimDeg - base;
    return actions.map(a => {
      const out = delta !== 0 ? turnPart(a, delta) : { ...a };
      const aimed = a.area.shape === 'line' || a.area.shape === 'fan' || !!a.charge;
      if (aimed && (a.center === 'self' || a.center === 'target')) {
        out.center = 'point';
        delete out.follow;
      }
      return out;
    });
  }
  return actions.map(a => {
    if (a.affects === 'self' || isWholeField(a) || a.center !== 'self') return { ...a };
    const out: SkillAction = { ...a, center: 'point' };
    delete out.follow;
    return out;
  });
}

// ─────────────────────────── bots ───────────────────────────

/**
 * Where a bot aims its ult in 조준 / 드래그 (null = tap, today's ult). No randomness. 'enemy' (default): the boss, else
 * its own target, else the nearest enemy — 조준 on it, 드래그 next to it on its near side. 'ally': the most hurt ally
 * character. 'self': where it stands.
 */
export function botUltAim(state: GameState, pi: number): UltAim | null {
  const mode = ultModeOf(state, pi);
  if (mode === 'now') return null;
  const p = state.players[pi];
  const e = p ? fieldEntity(state, p) : null;
  if (!p || !e || p.activeIndex == null) return null;
  const how = ultAlt(p.party[p.activeIndex].defId, mode)?.botAim ?? 'enemy';
  if (how === 'self') return { mode, point: { x: e.pos.x, y: e.pos.y } };
  if (how === 'ally') {
    let best: Ent | null = null;
    let br = Infinity;
    for (const o of state.entities) {
      if (o.team !== 'ally' || o.kind !== 'character' || gone(o)) continue;
      const maxHp = (o as Entity).maxHp || 1;
      const r = o.hp / maxHp;
      if (r < br - 1e-9) {
        br = r;
        best = o;
      }
    }
    const at = best ?? e;
    return { mode, point: { x: at.pos.x, y: at.pos.y } };
  }
  const boss = state.bossId != null ? state.entities.find(x => x.id === state.bossId && !gone(x)) : undefined;
  const own = (e as Entity).targetId != null ? state.entities.find(x => x.id === (e as Entity).targetId && x.team === 'enemy' && !gone(x)) : undefined;
  let foe: Ent | undefined = boss ?? own;
  if (!foe) {
    let bd = Infinity;
    for (const o of state.entities) {
      if (o.team !== 'enemy' || gone(o)) continue;
      const d = Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y);
      if (d < bd - 1e-9) {
        bd = d;
        foe = o;
      }
    }
  }
  if (!foe) return { mode, point: { x: e.pos.x, y: e.pos.y } };
  if (mode === 'aim') return { mode, point: { x: foe.pos.x, y: foe.pos.y } };
  const dx = e.pos.x - foe.pos.x;
  const dy = e.pos.y - foe.pos.y;
  const d = Math.hypot(dx, dy);
  const gap = foe.radius + e.radius + 0.5;
  const ux = d > 1e-6 ? dx / d : -1;
  const uy = d > 1e-6 ? dy / d : 0;
  return { mode, point: { x: foe.pos.x + ux * gap, y: foe.pos.y + uy * gap } };
}
