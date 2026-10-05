// 기획 12차 돌발 괴담 HUD texts: the success toast (names + particle), the pill's progress and the pill fitting one line.
import { describe, expect, it } from 'vitest';
import { FIELD_EVENTS, fieldEventGoalText, fieldEventRewardText, getFieldEvent } from '../../src/data';
import { fieldEventToast, pillProgress, subjectOf } from '../../src/ui/fieldEventHud';
import { makeGame } from '../sim/helpers';

describe('돌발 괴담 HUD texts', () => {
  it('subject particle: 이 after a final consonant (also digits / letters read aloud), else 가', () => {
    expect(subjectOf('민지')).toBe('민지가');
    expect(subjectOf('하준')).toBe('하준이');
    expect(subjectOf('BOT 1')).toBe('BOT 1이');
    expect(subjectOf('BOT 2')).toBe('BOT 2가');
    expect(subjectOf('Sam')).toBe('Sam이');
  });

  it('success toast names who did it (나 → 내가) and the reward for everyone', () => {
    const tg = makeGame({ players: [{ name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] }, { name: '민지', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] }] });
    const s = tg.w.state;
    expect(fieldEventToast(s, 0, 'lucky_toad', 1)).toBe('민지가 금두꺼비를 잡았다! 모두 궁극기 게이지 +40%');
    expect(fieldEventToast(s, 0, 'lucky_toad', 0)).toBe('내가 금두꺼비를 잡았다! 모두 궁극기 게이지 +40%');
    expect(fieldEventToast(s, 0, 'open_shaft', null)).toBe('열린 엘리베이터 통로 성공! 모두 재등장 쿨 초기화');
  });

  it('banner goal line and pill pieces are generated from the numbers; the pill stays short', () => {
    expect(fieldEventGoalText(getFieldEvent('lucky_toad'))).toBe('18초 안에 잡으면 모두 궁극기 게이지 +40%');
    expect(fieldEventGoalText(getFieldEvent('dark_lamps'))).toContain('비상등 3개 켜면');
    expect(fieldEventRewardText(getFieldEvent('midnight_surge').reward)).toBe('「아침 햇살」 이번 층 공격력 +20%·공격 속도 +15%');
    expect(fieldEventRewardText(getFieldEvent('sleepwalker').reward, true)).toBe('피해−8%');
    const tg = makeGame();
    for (const def of FIELD_EVENTS) {
      const ev = { id: def.id, stage: 'active' as const, warnRemaining: 0, remaining: 12, total: def.duration, pos: { x: 1, y: 1 }, entityIds: [], marks: [], progress: 1, goal: def.goal, creditPlayer: null, printed: 3 };
      const p = pillProgress(tg.w.state, ev);
      // icon · seconds · progress · reward word: ≤ 20 characters (a bar counts as 4)
      const len = 2 + 3 + (p.bar != null ? 4 : 0) + p.text.length + 1 + fieldEventRewardText(def.reward, true).length;
      expect(len, def.id).toBeLessThanOrEqual(20);
    }
  });
});
