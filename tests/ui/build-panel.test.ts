// 기획 17차 「내 빌드」 (src/ui/buildPanel.ts buildSummary, pure): rerolls, 13 tags with counts (relics count one each,
// the role card counts its role's tags), finished sets with bonus, lines grouped 파티 → 직업 → 캐릭터별 → 협동 with
// repeats merged ('공격력 강화 ×3 · +38%'), and the 원정 lobby chip text.
import { describe, expect, it } from 'vitest';
import type { AppliedReward } from '../../src/types';
import { ROLE_NAME, SYNERGY_TAGS, TAG_SET_BONUS, getCharacter, getReward } from '../../src/data';
import { appliedTags, buildChipText, buildSummary, countTags } from '../../src/ui/buildPanel';

const PARTY = ['guardian', 'blade', 'mage'];
const a = (rewardId: string, partyIndex: number | null = null): AppliedReward => ({ rewardId, partyIndex }) as AppliedReward;

describe('내 빌드 summary', () => {
  it('empty: 13 tags at 0, no groups', () => {
    const b = buildSummary([], [], PARTY, 1);
    expect(b.tags.map(t => t.id)).toEqual(SYNERGY_TAGS.map(t => t.id));
    expect(b.tags.every(t => t.count === 0 && !t.done)).toBe(true);
    expect(b.groups).toEqual([]);
    expect(b.rerolls).toBe(1);
    expect(b.total).toBe(0);
  });

  it("merges repeats into one summed line ('공격력 강화 ×3 · +48%') and finishes the #공격 set", () => {
    const b = buildSummary([a('atk_common'), a('atk_rare'), a('atk_epic')], [], PARTY, 2);
    expect(b.groups).toHaveLength(1);
    expect(b.groups[0].title).toBe('파티');
    const line = b.groups[0].lines[0];
    expect(line.count).toBe(3);
    expect(line.rarity).toBe('epic');
    expect(line.detail).toBe('+48%');
    const atk = b.tags.find(t => t.id === 'attack')!;
    expect(atk).toMatchObject({ count: 3, done: true, bonus: TAG_SET_BONUS.attack });
    expect(b.sets).toBe(1);
  });

  it('groups 파티 → 직업 → per character (by slot) → 협동', () => {
    const coop = (() => {
      try {
        return getReward('red_thread_common').id;
      } catch {
        return null;
      }
    })();
    const list = [a('dragdmg_rare', 2), a('hp_common'), a('role_common', 0), a('swapcd_common', 0), ...(coop ? [a(coop)] : [])];
    const b = buildSummary(list, [], PARTY, 0);
    const titles = b.groups.map(g => g.title);
    expect(titles.slice(0, 4)).toEqual(['파티', '직업', getCharacter('guardian').name, getCharacter('mage').name]);
    if (coop) expect(titles[titles.length - 1]).toBe('협동');
    const role = b.groups[1].lines[0];
    expect(role.name).toBe(`${ROLE_NAME.tank} 특기`);
    const drag = b.groups[3].lines[0];
    expect(drag.name).not.toContain('{char}');
    expect(drag.detail).toBe('+40%');
  });

  it('tags: relics count one each, the role card counts its role (tank: 생존 + 퇴장)', () => {
    const c = countTags([a('role_rare', 0)], ['relay_flag', 'phoenix_feather'], PARTY);
    expect(c.leave).toBe(2);
    expect(c.survive).toBe(2);
    expect(appliedTags(a('role_rare', 1), PARTY)).toEqual(['appear', 'attack']);
    const b = buildSummary([], ['relay_flag'], PARTY, 0);
    expect(b.relics.map(r => r.id)).toEqual(['relay_flag']);
  });

  it("lobby chip: '버프 N개 · 모음 M' (traces add to the count)", () => {
    const b = buildSummary([a('atk_common'), a('atk_rare'), a('aspd_common')], [], PARTY, 1);
    expect(buildChipText(b)).toBe('버프 3개 · 모음 1');
    expect(buildChipText(buildSummary([a('hp_common')], [], PARTY, 1), 2)).toBe('버프 3개');
  });

  it('unknown ids are skipped (old saves never crash the panel)', () => {
    const b = buildSummary([a('nope_common'), a('hp_common')], ['no_relic'], PARTY, 0);
    expect(b.groups[0].lines).toHaveLength(1);
    expect(b.relics[0].name).toBe('no_relic');
  });
});
