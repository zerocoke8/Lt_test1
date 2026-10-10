// 기획 17차 HUD helpers (pure): the first-저스트 help line, learner chevrons, reward counter chips, the card badge
// ('×1.5' until the drag lands), the result row and the device settings (진동 · 저스트 도우미 · 저스트 슬로).
import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../../src/types';
import { justHelpText, rewardChips, showsLearner } from '../../src/ui/justHud';
import { JUST_BADGE_MIN_MS, badgeMs, multBadge } from '../../src/ui/cardFx';
import { justText } from '../../src/ui/result';
import { FEEL_DEFAULTS, JUST_TUTOR_GOAL, sanitizeFeel } from '../../src/ui/storage';
import { grantReward } from '../../src/sim/rewards/offers';
import { HUMAN, makeGame, quietFloor } from '../sim/helpers';

describe('저스트 HUD helpers', () => {
  it('help line uses the live numbers', () => {
    expect(justHelpText(1.5, 0.4)).toBe('저스트 교대! 맞기 직전에 바꾸면 다음 캐릭터 드래그 +50%, 나간 캐릭터 쿨 −40%');
    expect(justHelpText(1.3, 0.3)).toContain('+30%');
  });

  it(`learner chevrons: help on, fewer than ${JUST_TUTOR_GOAL} successes, cue 'now'`, () => {
    expect(showsLearner(true, 0, true)).toBe(true);
    expect(showsLearner(true, JUST_TUTOR_GOAL - 1, true)).toBe(true);
    expect(showsLearner(true, JUST_TUTOR_GOAL, true)).toBe(false);
    expect(showsLearner(false, 0, true)).toBe(false);
    expect(showsLearner(true, 0, false)).toBe(false);
  });

  it("card badge: '×1.5' and it waits for the drag's last part (at least 0.7 s)", () => {
    expect(multBadge(1.5)).toBe('×1.5');
    expect(multBadge(2)).toBe('×2');
    expect(multBadge(1.75)).toBe('×1.8');
    expect(badgeMs()).toBe(JUST_BADGE_MIN_MS);
    expect(badgeMs(1, 3, 0.25)).toBeCloseTo(180 + 1500 + 250, 6);
  });

  it("result row: '3회', with more attacks dodged '3회 · 공격 4번 피함'", () => {
    expect(justText(0, 0)).toBe('0회');
    expect(justText(3, 3)).toBe('3회');
    expect(justText(3, 4)).toBe('3회 · 공격 4번 피함');
  });

  it('settings: unknown → defaults (all on), booleans kept', () => {
    expect(sanitizeFeel(null)).toEqual(FEEL_DEFAULTS);
    expect(sanitizeFeel({ vibrate: false, justSlow: 'x' })).toEqual({ vibrate: false, justHelper: true, justSlow: true });
  });
});

describe('reward counter chips', () => {
  function me(): { p: PlayerState; tg: ReturnType<typeof makeGame> } {
    const tg = makeGame({ seed: 3, players: [HUMAN], tunables: { invincible: true } });
    quietFloor(tg);
    return { tg, p: tg.w.state.players[0] };
  }

  it('none without counters; 빚 / 상자 / 욕심 from rewardState (원정 says 단계)', () => {
    const { p } = me();
    expect(rewardChips(p, false)).toEqual([]);
    const q = { ...p, rewardState: { debt: 2, boxBump: 1, greedySkip: 1 } };
    expect(rewardChips(q, false).map(c => c.text)).toEqual(['빚 2층', '상자 ↑', '욕심 · 다음 없음']);
    expect(rewardChips(q, true)[0].text).toBe('빚 2단계');
  });

  it("촛불: kills toward the next +1 % and the bonus so far (only while owned)", () => {
    const { tg, p } = me();
    const q = { ...p, rewardState: { candlesKills: 47, candlesBonus: 1 } };
    expect(rewardChips(q, false)).toEqual([]);
    grantReward(tg.w, tg.w.state.players[0], 'candles_rare', null);
    const owned = { ...tg.w.state.players[0], rewardState: { candlesKills: 47, candlesBonus: 1 } };
    expect(rewardChips(owned, false).find(c => c.key === 'candles')?.text).toBe('촛불 7/40 · +1%');
  });
});
