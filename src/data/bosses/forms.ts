// 기획 20차 보스 형태 (docs/bosses.md 1장 · 3장): every number the four boss forms share. Per-boss numbers (radius, spawn,
// move, spots, guard, trail) stay in the boss's own entry (src/data/bosses/<zone>.ts); a boss without `form` reads none
// of this — the classic four play exactly as in 기획 19차.

import type { BossForm } from '../../types';

export const BOSS_FORM = {
  /** A moving body's centre stays inside this box (clear of the top boss panel and the card row). */
  box: { xMin: 2, xMax: 22, yMin: 3, yMax: 10 },
  /** Where a roaming / arena boss appears without a `spawn` of its own. */
  roamSpawn: { x: 12, y: 4 },
  /** Body turn speed, degrees per second (BossMoveDef.turnRate overrides it). */
  turnRate: 180,
  /** It walks only while its way is within this many degrees of where it faces; else it turns on the spot. */
  walkCone: 60,
  /** Seconds a moving boss stands in its entrance pose when the floor starts. */
  entrance: 1,
  /** Seconds a relocating boss stands in its appear pose after it arrived on a spot. */
  arrive: 0.4,
  /** Enraged: walking and turning × this. */
  enrageMove: 1.25,
  /** Seconds a roaming boss cannot be taunted again after a taunt ended. */
  tauntImmune: 6,
  /** `axis` movers: x counts as lined up within this many cells. */
  axisSnap: 0.6,
  /** A pursuing boss held back by the box still reaches this much farther (a character in the very corner). */
  pinReach: 1,
  /** A taunted boss that normally keeps its distance (ranged patrol / keep-away) walks up to this edge distance. */
  tauntReach: 1.5,
} as const;

/**
 * Rule N8 (보스 레이드만): characters walk around enemy zones that linger. `on: false` turns it off (one line, no slider).
 * pad = extra clearance around a zone · look = how far ahead a step is checked · angles = side steps tried (one side is
 * kept) · patience = seconds blocked before it walks in anyway · commit = seconds it then fights where it stands ·
 * minLeft = zones about to end are ignored · maxZones = only the nearest ones are read · exit = how far it looks for a
 * way out of a zone it stands in · melee = attack ranges up to this walk in at once when every spot around the target
 * is covered.
 */
export const ZONE_AVOID = { on: true, pad: 0.3, look: 1.2, angles: [35, 70, 105], patience: 1.5, commit: 3, minLeft: 0.4, maxZones: 8, exit: 4, melee: 1.5 } as const;

/**
 * Rule N9 (보스 레이드만, 기획 20차 점검): 안전한 자리 지키기 — a character standing outside the warning of a find-the-safe-spot
 * part does not walk into it while it is shown (it waits, and attacks when its target is in reach). Read: an enemy ring
 * whose outer edge is ≥ safeOuter (helpers.ts safeRing) and every part flagged `keepOut` (번호 없는 서랍's cells).
 * Warnings are still never dodged: a character already inside one stays in. `on: false` turns it off.
 */
export const SAFE_HOLD = { on: true, safeOuter: 20 } as const;

/**
 * Raid-only extras of a bot's drop score (src/sim/bot.ts bestDropPoint; no rng): inside an enemy zone, inside a warning
 * that lands within `soon` s, the hole / the outside of a safe ring (an enemy ring whose outer edge is ≥ safeOuter),
 * behind a guard boss. markSwapAt = a marked field character is swapped out when its mark has this many seconds left.
 */
export const BOT_RAID = { zone: -1.5, telegraph: -1.5, soon: 1.5, safeIn: 2, safeOut: -3, safeOuter: 20, back: 0.5, markSwapAt: 1.2 } as const;

/** 기획 20차 (rule N5): the word on MY damage number when the hit met a guard boss's weak back / its front shield. */
export const GUARD_HIT_TEXT = { back: '뒤!', front: '막힘' } as const;
export const GUARD_HIT_COLOR = { back: '#ffd166', front: '#b9c9d8' } as const;

/** Player-facing names of the forms (floor banner, boss box, debug picker). */
export const BOSS_FORM_LABEL: Record<BossForm, string> = { fixed: '고정형', roaming: '배회형', relocating: '자리 이동형', arena: '전장형' };

/** One short line per form for the HUD. */
export const BOSS_FORM_TIP: Record<BossForm, string> = {
  fixed: '맨 위에서 움직이지 않아요',
  roaming: '맵을 걸어 다녀요 — 탱커 도발이 통해요',
  relocating: '정해진 자리를 옮겨 다녀요',
  arena: '맵 전체가 보스의 무대예요',
};
