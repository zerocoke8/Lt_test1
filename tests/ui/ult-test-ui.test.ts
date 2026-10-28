// 기획 22차 궁극기 테스트: the pure UI pieces — its own record (never mixed with the raid's), the last-mode memory, the
// card / lobby / result words, the preset's 「궁극기 방식」 lines and the ult button's name per mode.
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/data';
import { setUltAltFixture } from '../../src/data/ultTest';
import { ULT_MODES, ULT_MODE_LABEL, ultNameFor } from '../../src/sim/ultTest';
import type { GameState } from '../../src/types';
import { BOSS_RAID_KEY, ULT_TEST_KEY, loadBossRaidRecord, recordBossRaidResult, recordKeyFor } from '../../src/ui/bossRaidStore';
import { loadMode, saveMode, type KeyValueStore } from '../../src/ui/expeditionStore';
import { ULT_TEST_LABEL, raidModeLabel } from '../../src/ui/format';
import { lobbyHeader } from '../../src/ui/lobby';
import { ULT_TEST_CARD_SUB, ultTestFoot } from '../../src/ui/mainMenu';
import { ULT_CHOICE_HINT, ULT_FALLBACK_LINE } from '../../src/ui/preset';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('궁극기 테스트 UI', () => {
  it('its own record key: a run counts there and never in the raid’s', () => {
    expect(ULT_TEST_KEY).toBe('swap-tower.ultTest.v1');
    expect(recordKeyFor('ultTest')).toBe(ULT_TEST_KEY);
    expect(recordKeyFor('bossRaid')).toBe(BOSS_RAID_KEY);
    expect(recordKeyFor(undefined)).toBe(BOSS_RAID_KEY);
    const st = memStore();
    const up = recordBossRaidResult({ outcome: 'defeat', floorReached: 6 }, st, ULT_TEST_KEY);
    expect(up.isNewBest).toBe(true);
    expect(loadBossRaidRecord(st, ULT_TEST_KEY)).toEqual({ bestFloor: 6, clears: 0, runs: 1 });
    expect(loadBossRaidRecord(st)).toEqual({ bestFloor: 0, clears: 0, runs: 0 });
    expect([...st.data.keys()]).toEqual([ULT_TEST_KEY]);
  });

  it('the last picked mode remembers ultTest', () => {
    const st = memStore();
    saveMode('ultTest', st);
    expect(loadMode(st)).toBe('ultTest');
  });

  it('card, lobby and chips', () => {
    expect(ULT_TEST_CARD_SUB).toBe('보스 레이드 · 궁극기 조작 실험');
    expect(ultTestFoot({ bestFloor: 0, clears: 0, runs: 0 }, 'aim')).toBe('첫 도전 · 방식 조준');
    expect(ultTestFoot({ bestFloor: 7, clears: 0, runs: 2 }, 'drag')).toBe('최고 기록 7층 · 방식 드래그');
    expect(raidModeLabel('ultTest')).toBe(ULT_TEST_LABEL);
    expect(raidModeLabel('bossRaid')).toBe('보스 레이드');
    expect(lobbyHeader(true, 'ultTest').chip).toBe('궁극기 테스트');
    expect(lobbyHeader(false, 'ultTest').sub).toContain('층마다 보스');
    expect(lobbyHeader(false, null).chip).toBe('');
  });

  it('the preset lines: one per mode, plain words', () => {
    expect(ULT_MODES.map(m => ULT_MODE_LABEL[m])).toEqual(['현재', '조준', '드래그']);
    for (const m of ULT_MODES) expect(ULT_CHOICE_HINT[m].length).toBeGreaterThan(5);
    expect(ULT_FALLBACK_LINE.aim).toContain('겨눈 곳');
    expect(ULT_FALLBACK_LINE.drag).toContain('순간이동');
  });

  it('the ult button’s name: today’s ult unless the mode has the character’s own', () => {
    const state = (ultMode: 'now' | 'aim' | 'drag') => ({ mode: 'ultTest', players: [{ ultMode }] }) as unknown as Pick<GameState, 'mode' | 'players'>;
    const mage = CHARACTERS.find(c => c.id === 'mage')!;
    expect(ultNameFor(state('aim'), 0, 'mage')).toBe(mage.ult.name);
    const undo = setUltAltFixture('mage', { aim: { id: 'mage_ua', name: '시험 조준', slot: 'ult', description: '', actions: [] } });
    try {
      expect(ultNameFor(state('aim'), 0, 'mage')).toBe('시험 조준');
      expect(ultNameFor(state('drag'), 0, 'mage')).toBe(mage.ult.name);
      expect(ultNameFor(state('now'), 0, 'mage')).toBe(mage.ult.name);
      expect(ultNameFor({ mode: 'bossRaid', players: [{}] } as unknown as Pick<GameState, 'mode' | 'players'>, 0, 'mage')).toBe(mage.ult.name);
    } finally {
      undo();
    }
  });
});
