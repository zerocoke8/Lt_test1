// 기획 13차 효과음: sound id families and their mixing rows (docs/sfx.md 3장 ids, 4장 섞는 규칙).
// An id is a dotted name: `drag.<character>.<stage>`, `ult.<character>.cutin`, `boss.windup.<kind>`, `ui.tap` …
// The row of an id = the first rule whose prefix matches: bus, priority (0–5), peak level (dB before the limiter),
// minimum gap between two plays of the same id (ms), concurrency group + cap, and how many baked variants.

export type Bus = 'ui' | 'sfx' | 'hero' | 'bg';

export interface SfxRow {
  bus: Bus;
  prio: number;
  /** Peak level in dB (4-1). */
  db: number;
  /** Same-id minimum gap (ms). */
  gap: number;
  /** Concurrency group (4-2 묶음별 동시 개수). */
  group: string;
  /** Variants baked (frequent sounds: 3). */
  variants: number;
  /** Several in one frame merge into one louder play (4-2). */
  merge?: boolean;
}

type Rule = [prefix: string, row: Partial<SfxRow>];

const BASE: SfxRow = { bus: 'sfx', prio: 2, db: -14, gap: 40, group: 'misc', variants: 1 };

// first match wins: specific ids before their family
const RULES: Rule[] = [
  // 3-1 / 3-2 characters
  ['ult._role.', { bus: 'hero', prio: 5, db: -3, group: 'hero' }],
  ['ult.ready', { bus: 'ui', prio: 4, db: -8, group: 'ui' }],
  ['ult.remind', { bus: 'ui', prio: 0, db: -22, group: 'ui', gap: 2000 }],
  ['ult.', { bus: 'hero', prio: 5, db: -3, group: 'hero' }],
  ['drag.crunch', { bus: 'hero', prio: 4, db: -9, gap: 80, group: 'hero' }],
  ['drag.', { bus: 'hero', prio: 4, db: -5, gap: 30, group: 'hero' }],
  ['char.appear.', { prio: 2, db: -10, gap: 80 }],
  ['char.leave', { prio: 1, db: -18, gap: 80 }],
  ['char.down.far', { prio: 2, db: -16, gap: 200 }],
  ['char.down', { prio: 4, db: -8, gap: 200 }],
  ['char.revive', { prio: 3, db: -10, gap: 200 }],
  ['doll.burst', { prio: 2, db: -12, gap: 60 }],
  ['dash.', { prio: 2, db: -14, gap: 120 }],
  ['normal.', { prio: 2, db: -14, gap: 80 }],
  // 3-3 attacks · hits
  ['atk.', { prio: 1, db: -20, gap: 100, group: 'atk', variants: 3 }],
  ['hit.multi', { prio: 1, db: -16, gap: 45, group: 'hit', variants: 3 }],
  ['hit.crit', { prio: 2, db: -16, gap: 70, group: 'hit', variants: 3 }],
  ['hit.weak', { prio: 2, db: -16, gap: 80, group: 'hit', variants: 3 }],
  ['hit.boss', { prio: 1, db: -18, gap: 100, group: 'hit', variants: 3 }],
  ['hit.skill', { prio: 1, db: -18, gap: 60, group: 'hit', variants: 3, merge: true }],
  ['hit.', { prio: 1, db: -20, gap: 45, group: 'hit', variants: 3, merge: true }],
  ['hurt.lowhp', { bus: 'bg', prio: 2, db: -16, gap: 1100, group: 'tick' }],
  ['hurt.', { prio: 1, db: -18, gap: 150, group: 'hit', variants: 3 }],
  // 3-4 heal · status
  ['heal.tick', { prio: 1, db: -20, gap: 200, variants: 3, merge: true }],
  ['heal.big', { prio: 2, db: -14, gap: 300 }],
  ['heal.', { prio: 2, db: -18, gap: 200 }],
  ['bench.', { prio: 2, db: -16, gap: 150 }],
  ['fx.shield', { prio: 2, db: -16, gap: 250 }],
  ['fx.', { prio: 2, db: -16, gap: 120, merge: true }],
  ['run.out', { bus: 'hero', prio: 5, db: -5, group: 'hero' }],
  ['player.out', { prio: 3, db: -12 }],
  // 3-5 pets
  ['pet.', { prio: 3, db: -8, gap: 80 }],
  // 3-6 monsters
  ['mon.spawnWarn', { prio: 1, db: -22, gap: 250, group: 'mon' }],
  ['mon.spawn', { prio: 1, db: -22, gap: 100, group: 'mon', merge: true }],
  ['mon.windup', { prio: 2, db: -16, gap: 120 }],
  ['mon.impact.', { prio: 2, db: -14, gap: 80, merge: true }],
  ['mon.interrupt', { prio: 4, db: -8, gap: 80 }],
  ['mon.death', { prio: 1, db: -18, gap: 60, group: 'death', variants: 3, merge: true }],
  ['mon.', { prio: 2, db: -16, gap: 100 }],
  ['mid.spawn', { prio: 3, db: -6, gap: 500 }],
  ['mid.', { prio: 3, db: -8, gap: 150 }],
  ['copy.pop', { prio: 1, db: -18, gap: 80 }],
  // 3-7 bosses · groggy
  ['boss.windup.', { prio: 4, db: -8, gap: 100 }],
  ['boss.impact.', { prio: 4, db: -8, gap: 80 }],
  ['boss.enrage', { prio: 3, db: -6 }],
  ['boss.', { bus: 'hero', prio: 5, db: -5, gap: 500, group: 'hero' }],
  ['enrage.heart', { bus: 'bg', prio: 3, db: -18, group: 'loop' }],
  ['groggy.break', { bus: 'hero', prio: 5, db: -4, gap: 500, group: 'hero' }],
  ['groggy.fill', { prio: 2, db: -14, gap: 60 }],
  ['groggy.stars', { prio: 2, db: -20, group: 'loop' }],
  ['groggy.', { prio: 3, db: -10, gap: 300 }],
  // 3-8 floors · ambience
  ['floor.', { prio: 3, db: -8, gap: 500 }],
  ['zone.enter', { prio: 3, db: -10, gap: 500 }],
  ['amb.', { bus: 'bg', prio: 0, db: -28, group: 'loop' }],
  ['ui.timer.', { bus: 'ui', prio: 1, db: -16, gap: 300, group: 'tick' }],
  // 3-9 / 3-10 괴담
  ['gd.result.bad', { bus: 'ui', prio: 4, db: -12, gap: 300 }],
  ['gd.trace.', { bus: 'ui', prio: 2, db: -12, gap: 150 }],
  ['gd.pick', { bus: 'ui', prio: 3, db: -14, gap: 100, group: 'ui' }],
  ['gd.', { bus: 'ui', prio: 4, db: -8, gap: 200 }],
  ['fe.warn', { prio: 4, db: -8, gap: 500 }],
  ['fe.start.', { prio: 4, db: -8, gap: 500 }],
  ['fe.success', { prio: 4, db: -6, gap: 500 }],
  ['fe.fail.', { prio: 4, db: -10, gap: 500 }],
  ['fe.urgent', { prio: 3, db: -14, gap: 400, group: 'tick' }],
  ['fe.', { prio: 3, db: -12, gap: 80 }],
  // 3-11 UI · meta
  ['ui.tap.soft', { bus: 'ui', prio: 3, db: -18, gap: 40, group: 'ui' }],
  // 기획 15차 원정 (UI)
  ['ui.equip', { bus: 'ui', prio: 4, db: -10, gap: 80, group: 'ui' }],
  ['exp.reveal', { bus: 'ui', prio: 4, db: -10, gap: 60 }],
  ['exp.', { bus: 'ui', prio: 4, db: -8, gap: 300 }],
  ['ui.toast.', { bus: 'ui', prio: 2, db: -16, gap: 120, group: 'ui' }],
  ['ui.cardReady', { bus: 'ui', prio: 1, db: -18, gap: 300, group: 'ui' }],
  ['ui.cdcut', { bus: 'ui', prio: 2, db: -16, gap: 150, group: 'ui' }],
  ['ui.ult.press', { bus: 'ui', prio: 4, db: -10, gap: 100, group: 'ui' }],
  ['ui.reward.pulse', { bus: 'ui', prio: 3, db: -12, gap: 200, group: 'ui' }],
  ['ui.', { bus: 'ui', prio: 3, db: -14, gap: 50, group: 'ui' }],
  ['reward.pick.', { bus: 'ui', prio: 4, db: -8, gap: 200 }],
  ['reward.', { bus: 'ui', prio: 4, db: -10, gap: 300 }],
  ['relic.get', { bus: 'ui', prio: 4, db: -8, gap: 300 }],
  ['relic.', { prio: 2, db: -16, gap: 300 }],
  ['result.best', { bus: 'ui', prio: 2, db: -16, gap: 60, group: 'ui' }],
  ['run.', { bus: 'hero', prio: 5, db: -5, gap: 1000, group: 'hero' }],
  ['net.', { bus: 'ui', prio: 3, db: -14, gap: 300, group: 'ui' }],
];

const cache = new Map<string, SfxRow>();

/** The mixing row of a sound id. */
export function sfxRow(id: string): SfxRow {
  let row = cache.get(id);
  if (!row) {
    const rule = RULES.find(([p]) => id.startsWith(p));
    row = { ...BASE, ...(rule?.[1] ?? null) };
    cache.set(id, row);
  }
  return row;
}

/** 4-2 묶음별 동시 개수 (group → cap). Groups not listed are limited by the total voice cap only. */
export const GROUP_CAP: Record<string, number> = { hit: 6, death: 4, ui: 4, tick: 2, atk: 4, mon: 3, loop: 3 };

/** Family default when an id has neither a file nor a recipe (2-2 lookup ④): `drag.<char>.<x>` → `drag._role.<role>`. */
export function familyDefault(id: string, roleOf: (charId: string) => string | null): string | null {
  const [head, who] = id.split('.');
  if ((head === 'drag' || head === 'ult') && who && who !== '_role') {
    const role = roleOf(who);
    return role ? `${head}._role.${role}` : null;
  }
  if (id.startsWith('mon.death.')) return 'mon.death';
  if (id.startsWith('mon.impact.')) return 'mon.impact.circle';
  if (id.startsWith('atk.shot.')) return 'atk.swing.ranged';
  return null;
}

/** dB → linear gain. */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
