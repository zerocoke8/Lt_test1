// 기획 19차 보스 레이드: the small builders every boss data file shares (moved from monsters.ts, + row / rowR / at).
// 보스는 맨 위 가장자리에 고정 (BOSS_POS x 12, y −1.2). 'self' 중심 = 보스 자리 → offset으로 아레나(24×12) 안의 자리를 지정.

import type { AreaShape, BossDef, Effect, MonsterSkill, SkillAction, Vec2 } from '../../types';

/** The shared enrage of every boss (attack ×1.6 · attack speed ×1.5 · cooldowns ×0.6 · summons ×1.5). */
export const ENRAGE: BossDef['enrage'] = { atkMult: 1.6, atkSpeedMult: 1.5, cooldownMult: 0.6, summonCountMult: 1.5 };

/** A sweep: the same action repeated at several world offsets, `step` seconds apart (boss sequences, `extra`). */
export function sweep(base: SkillAction, offsets: Vec2[], firstDelay: number, step: number): SkillAction[] {
  return offsets.map((offset, i) => ({ ...base, offset, delay: Math.round((firstDelay + i * step) * 1000) / 1000 }));
}

/**
 * The same hit again at each delay, one part per hit — so every hit has its own warning (a boss never uses `hits`:
 * later hits of a multi-hit part re-aim without a telegraph, 기획 19차 review).
 */
export function repeat(base: SkillAction, delays: number[]): SkillAction[] {
  return delays.map(delay => ({ ...base, delay }));
}

/** Several parts as one skill: the first is `action`, the rest `extra`. */
export function seq(parts: SkillAction[]): Pick<MonsterSkill, 'action' | 'extra'> {
  return { action: parts[0], extra: parts.slice(1) };
}

// band / row / rowR / at below are offsets from BOSS_POS — for FIXED bosses only (기획 20차: a moving boss uses arenaAt).

/** Vertical band under the boss: starts at the top wall (y 0) at world x, goes down the whole arena (rect dir 'down'). */
export const band = (x: number): Vec2 => ({ x: x - 12, y: 1.2 });

/** Full-width strip from the left wall at world y (pair with rect dir 'right', length 24 — or 11 for a half-width drawer). */
export const row = (y: number): Vec2 => ({ x: -12, y: y + 1.2 });

/** The same strip from the right wall (pair with rect dir 'left'). */
export const rowR = (y: number): Vec2 => ({ x: 12, y: y + 1.2 });

/** A world spot (x, y) of the boss arena as an offset from the boss (center 'self'). */
export const at = (x: number, y: number): Vec2 => ({ x: x - 12, y: y + 1.2 });

// ─────────────────────────── 기획 20차 builders (docs/bosses.md 3장) ───────────────────────────

const ms = (v: number): number => Math.round(v * 1000) / 1000;

/** An absolute arena spot as a part's centre (rule N2) — spread into the part: { ...arenaAt(12, 6), area, … }. */
export const arenaAt = (x: number, y: number): Pick<SkillAction, 'center' | 'offset'> => ({ center: 'arena', offset: { x, y } });

/** A spot `d` cells ahead of the body (`side` cells to its right, negative = left), turned to its facing (rule N2). */
export const ahead = (d: number, side = 0): Pick<SkillAction, 'center' | 'rel' | 'offset'> => ({ center: 'self', rel: 'facing', offset: { x: d, y: side } });

/** Find-the-safe-spot: everything outside `inner` is hit (the renderer dims the arena and lights the hole). */
export const safeRing = (inner: number): AreaShape => ({ shape: 'ring', inner, outer: 30 });

/**
 * A rush toward the target (existing `charge`): the path of `width` is warned for `delay` s, then the body runs up to
 * `distance` cells (a form boss stops at its box), hitting along the way. recover = seconds it then cannot move or
 * turn; trail = circles left along the path (rule N4).
 */
export function chargeAt(o: { distance: number; width: number; delay: number; effects: Effect[]; recover?: number; trail?: SkillAction['trail'] }): SkillAction {
  return {
    center: 'target',
    area: { shape: 'line', length: o.distance, width: o.width },
    affects: 'enemies',
    delay: o.delay,
    effects: o.effects,
    charge: { distance: o.distance, ...(o.recover != null ? { recover: o.recover } : null) },
    ...(o.trail ? { trail: o.trail } : null),
  };
}

/** 자리 이동 (rule N2): a circle on the boss's next spot; when it lands the boss appears there and the circle is hit. */
export function relocateTo(o: { radius: number; delay: number; effects: Effect[] }): SkillAction {
  return { center: 'self', area: { shape: 'circle', radius: o.radius }, affects: 'enemies', delay: o.delay, effects: o.effects, relocate: { to: 'next' } };
}

/**
 * A turning beam (rule N3): `count` strips through an arena pivot, the first at `from`° (clockwise from +x), each
 * `step`° further (negative = counter-clockwise), landing `gap` s apart from `first`; each shows for its last `lead` s
 * and the whole cast hits a unit once. arms 2 = a second strip at +90° on every step (a cross).
 */
export function spokes(o: {
  pivot: Vec2;
  from: number;
  step: number;
  count: number;
  arms: 1 | 2;
  length: number;
  width: number;
  first: number;
  gap: number;
  lead: number;
  effects: Effect[];
}): SkillAction[] {
  const out: SkillAction[] = [];
  for (let i = 0; i < o.count; i++) {
    for (let arm = 0; arm < o.arms; arm++) {
      out.push({
        ...arenaAt(o.pivot.x, o.pivot.y),
        area: { shape: 'rect', dir: 'right', rot: o.from + i * o.step + arm * 90, length: o.length, width: o.width, anchor: 'center' },
        affects: 'enemies',
        delay: ms(o.first + i * o.gap),
        telegraphLead: o.lead,
        once: true,
        effects: o.effects,
      });
    }
  }
  return out;
}

/**
 * Strips from the body, each at an angle from where it faces (0 = straight ahead, + = to its right), landing at
 * `delays[i]`. follow = re-resolved from the body when it lands (after a relocate: the new spot and facing).
 */
export function rays(o: { angles: number[]; length: number; width: number; delays: number[]; lead?: number; effects: Effect[]; once?: true; follow?: true }): SkillAction[] {
  return o.angles.map((angle, i): SkillAction => ({
    center: 'self',
    rel: 'facing',
    area: { shape: 'rect', dir: 'right', rot: angle, length: o.length, width: o.width },
    affects: 'enemies',
    delay: o.delays[i] ?? o.delays[o.delays.length - 1],
    ...(o.lead != null ? { telegraphLead: o.lead } : null),
    ...(o.once ? { once: true as const } : null),
    ...(o.follow ? { follow: true } : null),
    effects: o.effects,
  }));
}

/**
 * A line sliding away from the body (rule N3): strips across its facing, the first `from` cells ahead, then every
 * `step` cells up to `to` (from > to = it comes back), `gap` s apart from `first`; each shows for its last `lead` s and
 * the whole cast hits a unit once.
 */
export function scan(o: { from: number; to: number; step: number; length: number; width: number; first: number; gap: number; lead: number; effects: Effect[] }): SkillAction[] {
  const n = Math.floor(Math.abs(o.to - o.from) / Math.max(0.01, Math.abs(o.step)) + 1e-9) + 1;
  const dir = o.to >= o.from ? 1 : -1;
  return Array.from({ length: n }, (_, i): SkillAction => ({
    ...ahead(o.from + dir * i * Math.abs(o.step)),
    area: { shape: 'rect', dir: 'right', rot: 90, length: o.length, width: o.width, anchor: 'center' },
    affects: 'enemies',
    delay: ms(o.first + i * o.gap),
    telegraphLead: o.lead,
    once: true,
    effects: o.effects,
  }));
}
