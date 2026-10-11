// 기획 19차 보스 레이드: this device's record (src/ui/bossRaidStore.ts) — best floor, clears, runs; unreadable or blocked
// storage never throws; the last-mode memory accepts 'bossRaid'.
import { describe, expect, it } from 'vitest';
import {
  BOSS_RAID_KEY,
  applyBossRaidResult,
  bossRaidFoot,
  emptyBossRaidRecord,
  loadBossRaidRecord,
  parseBossRaidRecord,
  recordBossRaidResult,
} from '../../src/ui/bossRaidStore';
import { loadMode, saveMode, type KeyValueStore } from '../../src/ui/expeditionStore';
import { MODE_KEY } from '../../src/expedition/stash';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** Storage that throws on every access (private mode / blocked cookies). */
const broken: KeyValueStore = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

/** Reads work, writes fail (storage full). */
function fullStore(raw: string | null): KeyValueStore {
  return {
    getItem: () => raw,
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
}

const defeat = (floorReached: number) => ({ outcome: 'defeat' as const, floorReached });
const victory = { outcome: 'victory' as const, floorReached: 20 };

describe('보스 레이드 record', () => {
  it('the key is the one the spec names', () => {
    expect(BOSS_RAID_KEY).toBe('swap-tower.bossRaid.v1');
  });

  it('nothing stored reads as an empty record', () => {
    expect(loadBossRaidRecord(memStore())).toEqual({ bestFloor: 0, clears: 0, runs: 0 });
    expect(loadBossRaidRecord(null)).toEqual(emptyBossRaidRecord());
  });

  it('a finished run is stored: best floor, runs and clears', () => {
    const st = memStore();
    const a = recordBossRaidResult(defeat(7), st);
    expect(a).toEqual({ record: { bestFloor: 7, clears: 0, runs: 1 }, prevBest: 0, isNewBest: true, saved: true });
    expect(JSON.parse(st.data.get(BOSS_RAID_KEY)!)).toEqual({ bestFloor: 7, clears: 0, runs: 1 });
    expect(loadBossRaidRecord(st)).toEqual({ bestFloor: 7, clears: 0, runs: 1 });
  });

  it('a lower floor keeps the best; the same floor is not a new record', () => {
    const st = memStore();
    recordBossRaidResult(defeat(7), st);
    const lower = recordBossRaidResult(defeat(3), st);
    expect(lower.record).toEqual({ bestFloor: 7, clears: 0, runs: 2 });
    expect(lower.isNewBest).toBe(false);
    expect(lower.prevBest).toBe(7);
    const same = recordBossRaidResult(defeat(7), st);
    expect(same.isNewBest).toBe(false);
    expect(same.record.runs).toBe(3);
  });

  it('a win counts a clear and floor 20', () => {
    const st = memStore();
    recordBossRaidResult(defeat(12), st);
    const win = recordBossRaidResult(victory, st);
    expect(win.record).toEqual({ bestFloor: 20, clears: 1, runs: 2 });
    expect(win.isNewBest).toBe(true);
    expect(recordBossRaidResult(victory, st).record).toEqual({ bestFloor: 20, clears: 2, runs: 3 });
  });

  it('another tab may have played meanwhile: the stored record is read again before the change', () => {
    const st = memStore();
    recordBossRaidResult(defeat(4), st);
    st.data.set(BOSS_RAID_KEY, JSON.stringify({ bestFloor: 15, clears: 0, runs: 9 }));
    const r = recordBossRaidResult(defeat(6), st);
    expect(r.record).toEqual({ bestFloor: 15, clears: 0, runs: 10 });
    expect(r.isNewBest).toBe(false);
  });

  it('corrupt or odd stored values read as zero, never throw', () => {
    for (const raw of ['', 'nope', '[]', 'null', '{"bestFloor":"7"}', '{"bestFloor":-3,"clears":null,"runs":{}}', '{"bestFloor":NaN}']) {
      expect(parseBossRaidRecord(raw), raw).toEqual({ bestFloor: 0, clears: 0, runs: 0 });
    }
    expect(parseBossRaidRecord('{"bestFloor":7.9,"clears":2,"runs":5,"extra":1}')).toEqual({ bestFloor: 7, clears: 2, runs: 5 });
    expect(parseBossRaidRecord('{"bestFloor":1e9,"clears":1,"runs":1}').bestFloor).toBe(999);
    const st = memStore();
    st.data.set(BOSS_RAID_KEY, '{broken');
    expect(loadBossRaidRecord(st)).toEqual(emptyBossRaidRecord());
    expect(recordBossRaidResult(defeat(2), st).record).toEqual({ bestFloor: 2, clears: 0, runs: 1 });
  });

  it('blocked storage: reads are empty, a result still comes back for the screen (not saved)', () => {
    expect(loadBossRaidRecord(broken)).toEqual(emptyBossRaidRecord());
    const r = recordBossRaidResult(defeat(5), broken);
    expect(r).toEqual({ record: { bestFloor: 5, clears: 0, runs: 1 }, prevBest: 0, isNewBest: true, saved: false });
    expect(recordBossRaidResult(defeat(5), null).saved).toBe(false);
  });

  it('full storage: the old record is kept as the base and the failure is reported', () => {
    const r = recordBossRaidResult(defeat(9), fullStore(JSON.stringify({ bestFloor: 6, clears: 1, runs: 4 })));
    expect(r).toEqual({ record: { bestFloor: 9, clears: 1, runs: 5 }, prevBest: 6, isNewBest: true, saved: false });
  });

  it('applyBossRaidResult is pure and ignores a broken floor number', () => {
    const rec = { bestFloor: 4, clears: 0, runs: 1 };
    expect(applyBossRaidResult(rec, { outcome: 'defeat', floorReached: Number.NaN })).toEqual({ bestFloor: 4, clears: 0, runs: 2 });
    expect(rec).toEqual({ bestFloor: 4, clears: 0, runs: 1 });
  });

  it('main-menu card foot', () => {
    expect(bossRaidFoot(emptyBossRaidRecord())).toBe('첫 도전');
    expect(bossRaidFoot({ bestFloor: 7, clears: 0, runs: 3 })).toBe('최고 기록 7층 · 클리어 0회');
    expect(bossRaidFoot({ bestFloor: 20, clears: 2, runs: 11 })).toBe('최고 기록 20층 · 클리어 2회');
  });
});

describe('last picked mode', () => {
  it("remembers 'bossRaid' next to the classic tower and the expedition", () => {
    const st = memStore();
    saveMode('bossRaid', st);
    expect(st.data.get(MODE_KEY)).toBe('bossRaid');
    expect(loadMode(st)).toBe('bossRaid');
    saveMode('classic', st);
    expect(loadMode(st)).toBe('classic');
  });
});
