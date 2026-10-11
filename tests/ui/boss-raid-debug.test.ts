// 기획 19차 보스 레이드 디버그 (docs/boss-raid.md 4-2 · 7-1): the four 「보스 튜닝」 sliders (defaults inside their ranges, an
// older browser's saved tuning falls back to the defaults), the 「보스 고르기」 list (20 names in four zone groups, 「(꺼짐)」
// on a boss that is out), the main card's 「보스 N종」 and the win line when a boss is switched off. Pure helpers only.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES, ZONES } from '../../src/config';
import { BOSSES, BOSS_RAID, RAID_BOSS_IDS, RAID_ZONES, ZONE_BOSSES, getBoss } from '../../src/data';
import { raidRosterIds } from '../../src/sim';
import type { RunResult, Tunables } from '../../src/types';
import { RAID_OFF_SUFFIX, raidBossGroups } from '../../src/ui/debug';
import { BOSS_FORM_LABEL } from '../../src/data/bosses/forms';
import { raidResultReason } from '../../src/ui/format';
import { raidCardSub } from '../../src/ui/mainMenu';
import { raidBossNames } from '../../src/ui/result';
import { SLIDERS, diffFromDefaults, formatTunable, sanitizeOverrides } from '../../src/ui/tunables';

const BOSS_KEYS = ['bossTelegraphMult', 'bossAreaMult', 'bossRaidHpMult', 'bossRaidAtkMult'] as const;
const spec = (key: (typeof BOSS_KEYS)[number]) => SLIDERS.find(s => s.key === key)!;

/** Run `fn` with one boss switched off in the data (`raid: false`), then put the data back. */
function withBossOff<T>(id: string, fn: () => T): T {
  const def = getBoss(id);
  def.raid = false;
  try {
    return fn();
  } finally {
    delete def.raid;
  }
}

describe('보스 튜닝 sliders', () => {
  it('one group of five (기획 20차: + 보스 이동 속도 배율), in the order of the spec, with Korean labels', () => {
    expect(SLIDERS.filter(s => s.group === '보스 튜닝').map(s => [s.key, s.label])).toEqual([
      ['bossTelegraphMult', '보스 예고 시간 배율'],
      ['bossAreaMult', '보스 범위 크기 배율'],
      ['bossRaidHpMult', '보스 레이드 HP 배율'],
      ['bossRaidAtkMult', '보스 레이드 공격 배율'],
      ['bossMoveMult', '보스 이동 속도 배율'],
    ]);
  });

  it('ranges of the spec; every default sits inside its range, on a step', () => {
    expect(BOSS_KEYS.map(k => [spec(k).min, spec(k).max, spec(k).step, spec(k).unit])).toEqual([
      [0.5, 3, 0.05, '×'],
      [0.5, 2, 0.05, '×'],
      [0.2, 3, 0.05, '×'],
      [0.2, 3, 0.05, '×'],
    ]);
    for (const k of BOSS_KEYS) {
      const s = spec(k);
      const d = DEFAULT_TUNABLES[k];
      expect(d, k).toBeGreaterThanOrEqual(s.min);
      expect(d, k).toBeLessThanOrEqual(s.max);
      const steps = (d - s.min) / s.step;
      expect(Math.abs(steps - Math.round(steps)), k).toBeLessThan(1e-6);
    }
    expect(DEFAULT_TUNABLES.bossTelegraphMult).toBe(1);
    expect(DEFAULT_TUNABLES.bossAreaMult).toBe(1);
    expect(DEFAULT_TUNABLES.bossRaidHpMult).toBe(BOSS_RAID.hpMult);
    expect(DEFAULT_TUNABLES.bossRaidAtkMult).toBe(BOSS_RAID.atkMult);
    expect(formatTunable(spec('bossTelegraphMult'), 2)).toBe('2.00×');
    expect(formatTunable(spec('bossRaidHpMult'), DEFAULT_TUNABLES.bossRaidHpMult)).toBe('1.00×');
    expect(formatTunable(spec('bossRaidAtkMult'), DEFAULT_TUNABLES.bossRaidAtkMult)).toBe('1.25×');
  });

  it('tuning saved by an older browser (no boss keys) leaves the four at their defaults', () => {
    const old = { swapCooldownMult: 0.5, reviveTime: 20 };
    const merged: Tunables = { ...DEFAULT_TUNABLES, ...sanitizeOverrides(old) };
    for (const k of BOSS_KEYS) expect(merged[k], k).toBe(DEFAULT_TUNABLES[k]);
    expect(merged.swapCooldownMult).toBe(0.5);
    // junk under the new keys is dropped; numbers out of range are clamped to the slider
    expect(sanitizeOverrides({ bossTelegraphMult: 'fast', bossAreaMult: null, bossRaidHpMult: NaN })).toEqual({});
    expect(sanitizeOverrides({ bossTelegraphMult: 99, bossAreaMult: 0, bossRaidHpMult: -1, bossRaidAtkMult: 2 })).toEqual({
      bossTelegraphMult: 3,
      bossAreaMult: 0.5,
      bossRaidHpMult: 0.2,
      bossRaidAtkMult: 2,
    });
  });

  it('a changed boss slider is saved and read back', () => {
    const diff = diffFromDefaults({ ...DEFAULT_TUNABLES, bossTelegraphMult: 2, bossAreaMult: 0.5 });
    expect(diff).toEqual({ bossTelegraphMult: 2, bossAreaMult: 0.5 });
    expect(sanitizeOverrides(diff)).toEqual(diff);
  });
});

describe('debug 「보스 고르기」 list', () => {
  it('four zone groups in run order, five bosses each, table order, Korean names', () => {
    const groups = raidBossGroups();
    expect(groups.map(g => g.zone)).toEqual([...RAID_ZONES]);
    expect(groups.map(g => g.label)).toEqual(RAID_ZONES.map(z => ZONES.find(d => d.theme === z)!.name));
    for (const g of groups) {
      expect(g.options.map(o => o.id), g.zone).toEqual([...ZONE_BOSSES[g.zone]]);
      for (const o of g.options) {
        // 기획 20차: the row says the form after the name ('혼자 도는 세탁기 · 배회형')
        expect(o.name, o.id).toBe(getBoss(o.id).name);
        expect(o.form, o.id).toBe(getBoss(o.id).form ?? 'fixed');
        expect(o.label, o.id).toBe(`${getBoss(o.id).name} · ${BOSS_FORM_LABEL[o.form]}`);
        expect(o.off, o.id).toBe(false);
      }
    }
  });

  it('all 20 bosses, each once, every name different', () => {
    const options = raidBossGroups().flatMap(g => g.options);
    expect(options.map(o => o.id)).toEqual([...RAID_BOSS_IDS]);
    expect(options).toHaveLength(BOSSES.length);
    expect(new Set(options.map(o => o.label)).size).toBe(20);
    expect(options.map(o => o.name)).toContain('문서 파쇄기');
    expect(options.map(o => o.label)).toContain('문서 파쇄기 · 배회형');
  });

  it('기획 20차: the forms of the list — 고정 6 · 배회 8 · 자리 이동 3 · 전장 3, the classic four fixed', () => {
    const options = raidBossGroups().flatMap(g => g.options);
    const count = (f: string) => options.filter(o => o.form === f).length;
    expect([count('fixed'), count('roaming'), count('relocating'), count('arena')]).toEqual([6, 8, 3, 3]);
    for (const id of ['elevator_keeper', 'overtime_lord', 'surgeon_director', 'abyss_watcher']) {
      expect(options.find(o => o.id === id)!.label, id).toBe(`${getBoss(id).name} · 고정형`);
    }
  });

  it('a boss that is off stays in the list with 「(꺼짐)」 after its name', () => {
    withBossOff('shredder_maw', () => {
      const options = raidBossGroups().flatMap(g => g.options);
      expect(options).toHaveLength(20);
      expect(options.filter(o => o.off).map(o => o.id)).toEqual(['shredder_maw']);
      expect(options.find(o => o.id === 'shredder_maw')!.label).toBe(`문서 파쇄기 · 배회형${RAID_OFF_SUFFIX}`);
      expect(RAID_OFF_SUFFIX.trim()).toBe('(꺼짐)');
    });
    // the data is back as it was
    expect(raidBossGroups().flatMap(g => g.options).some(o => o.off)).toBe(false);
  });
});

describe('보스 수 on the card and the result', () => {
  const win: RunResult = { outcome: 'victory', reason: 'cleared', floorReached: 20, duration: 1200 };

  it('main card: 「20층 · 층마다 보스 · 보스 N종」 with N = the bosses that are on', () => {
    expect(raidRosterIds()).toHaveLength(20);
    expect(raidCardSub()).toBe('20층 · 층마다 보스 · 보스 20종');
    withBossOff('shredder_maw', () => expect(raidCardSub()).toBe('20층 · 층마다 보스 · 보스 19종'));
    expect(raidCardSub()).toBe('20층 · 층마다 보스 · 보스 20종');
  });

  it('win line: 「보스 20종을 모두 쓰러뜨렸어요」 only with all 20 on, else 「20층을 모두 돌파했어요」', () => {
    expect(raidResultReason(win, false, 20, raidRosterIds().length)).toBe('보스 20종을 모두 쓰러뜨렸어요');
    withBossOff('claw_machine', () => expect(raidResultReason(win, false, 20, raidRosterIds().length)).toBe('20층을 모두 돌파했어요'));
    // a defeat reads the same either way
    const wipe: RunResult = { outcome: 'defeat', reason: 'wipe', floorReached: 7, duration: 300 };
    expect(raidResultReason(wipe, false, 20, 19)).toBe(raidResultReason(wipe, false, 20, 20));
  });

  it('floor chips name the boss the run logged (after a debug pick the seed order is wrong)', () => {
    const seed = 20261011;
    const plan = { floor: 2, kind: 'boss', timeLimit: 90, arena: { width: 24, height: 12 }, statMult: 1, waves: [], bossId: 'washer_drum' } as never;
    const name = raidBossNames({ seed, floor: 2, plan });
    const bySeed = name(1);
    expect(name(1, 'shredder_maw')).toBe('문서 파쇄기');
    expect(name(1, 'shredder_maw')).not.toBe(bySeed);
    // the logged boss also wins over the plan of the floor on screen; an unknown id never throws
    expect(name(2, 'dead_monitor')).toBe(getBoss('dead_monitor').name);
    expect(name(2)).toBe(getBoss('washer_drum').name);
    expect(name(3, 'no_such_boss')).toBe('보스');
  });
});
