// 기획 15차 원정 UI logic (pure): the 「다음 단계 도전」 double tap, the match countdown and seats, the bag chip, and the
// Korean texts of gear / stages (src/ui/expeditionRun.ts, src/ui/expeditionFormat.ts).
import { describe, expect, it } from 'vitest';
import { CONFIRM_MS, MATCH_SECONDS, bagTopBand, confirmTap, countdownLeft, isArmed, matchSeatsView, tierCounts } from '../../src/ui/expeditionRun';
import {
  charStats,
  compareGear,
  gearCaption,
  gearLines,
  gearName,
  gearSource,
  isUpgrade,
  nextStageHint,
  recommendWearers,
  relicGearText,
  stageBannerSub,
  stageLootText,
  stageTitle,
} from '../../src/ui/expeditionFormat';
import type { GearLoadout, GearSpec } from '../../src/data/gear';
import { getCharacter } from '../../src/data';

describe('choice: double tap to risk the bag (5장)', () => {
  it('empty bag: one tap goes', () => {
    expect(confirmTap(null, 1000, false)).toEqual({ go: true, armedAt: null });
  });
  it('bag at stake: first tap arms, a second within 3 s goes, a late one re-arms', () => {
    const a = confirmTap(null, 1000, true);
    expect(a).toEqual({ go: false, armedAt: 1000 });
    expect(isArmed(a.armedAt, 1000 + CONFIRM_MS)).toBe(true);
    expect(confirmTap(a.armedAt, 1000 + CONFIRM_MS - 1, true)).toEqual({ go: true, armedAt: null });
    expect(isArmed(a.armedAt, 1000 + CONFIRM_MS + 1)).toBe(false);
    expect(confirmTap(a.armedAt, 1000 + CONFIRM_MS + 1, true)).toEqual({ go: false, armedAt: 1000 + CONFIRM_MS + 1 });
  });
});

describe('match wait (7장, 8-6)', () => {
  it('15 s countdown, whole seconds, never below 0', () => {
    expect(MATCH_SECONDS).toBe(15);
    expect(countdownLeft(0, 0)).toBe(15);
    expect(countdownLeft(0, 200)).toBe(15);
    expect(countdownLeft(0, 1000)).toBe(14);
    expect(countdownLeft(0, 14_001)).toBe(1);
    expect(countdownLeft(0, 15_000)).toBe(0);
    expect(countdownLeft(0, 99_000)).toBe(0);
  });
  it('seats: people first, empty seats until the wait is over, then bots', () => {
    expect(matchSeatsView(1, 3, false)).toEqual(['human', 'empty', 'empty']);
    expect(matchSeatsView(2, 3, true)).toEqual(['human', 'human', 'bot']);
    expect(matchSeatsView(3, 3, true)).toEqual(['human', 'human', 'human']);
  });
});

const w = (tier: number, extra: Partial<GearSpec> = {}): GearSpec => ({ slot: 'weapon', tier, rarity: 'common', ...extra });

describe('gear texts', () => {
  it('names follow the prompt sheet (weapon by the wearer’s family)', () => {
    expect(gearName(w(1), 'sword')).toBe('녹슨 장검');
    expect(gearName(w(12), 'bow')).toBe('심연의 활');
    expect(gearName({ slot: 'armor', tier: 5, rarity: 'common' })).toBe('강화 방호 조끼');
    expect(gearName({ slot: 'charm', tier: 8, rarity: 'common' })).toBe('퇴마 부적');
    expect(gearName({ slot: 'relic', tier: 6, rarity: 'rare', relicId: 'relay_flag' })).toBe('교대의 깃발');
    expect(gearCaption(w(7, { rarity: 'epic', optionId: 'w_scorch' }))).toBe('T7 퇴마 · 무기 ★★');
  });
  it('relic text is per character and scaled by the tier (4-4: 메아리 50 → 58 / 65 / 73 %)', () => {
    expect(relicGearText('echo_seal', 3)).toContain('50%');
    expect(relicGearText('echo_seal', 6)).toContain('57.5%');
    expect(relicGearText('echo_seal', 12)).toContain('72.5%');
    expect(relicGearText('vanguard_helm', 9)).toContain('이 캐릭터');
  });
  it('lines: main stats then the effect; comparison deltas; upgrade marks', () => {
    expect(gearLines(w(5))).toEqual(['공격력 +17%']);
    expect(gearLines(w(7, { rarity: 'rare', optionId: 'w_execute' }))[1]).toMatch(/^✦ 처형 착지/);
    const d = compareGear(w(6), w(3));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ label: '공격력', text: '공격력 +9%' });
    expect(d[0].diff).toBeCloseTo(9);
    expect(compareGear(w(3), w(6))[0].text).toBe('공격력 −9%');
    expect(isUpgrade(w(4), undefined)).toBe(true);
    expect(isUpgrade(w(4), w(4))).toBe(false);
    expect(isUpgrade(w(4, { rarity: 'rare' }), w(4))).toBe(true);
    expect(gearSource(6)).toBe('6단계 보스 · 야근의 군주');
    expect(gearSource(4)).toBe('4단계');
  });
  it('stats preview and the next-stage hint (8-2, 8-3)', () => {
    const base = getCharacter('guardian').stats;
    const l: GearLoadout = { weapon: w(10), armor: { slot: 'armor', tier: 10, rarity: 'common' } };
    expect(charStats('guardian', null)).toEqual({ hp: base.maxHp, atk: base.atk });
    expect(charStats('guardian', l)).toEqual({ hp: Math.round(base.maxHp * 1.42), atk: Math.round(base.atk * 1.32) });
    const party = ['guardian', 'blade', 'cleric'];
    const full = (t: number): GearLoadout => ({ weapon: w(t), armor: { slot: 'armor', tier: t, rarity: 'common' }, charm: { slot: 'charm', tier: t, rarity: 'common' } });
    expect(nextStageHint(party, [full(3), full(3), full(3)], 4)).toBeNull();
    const hint = nextStageHint(party, [full(4), { ...full(4), charm: { slot: 'charm', tier: 3, rarity: 'common' } }, full(4)], 5);
    expect(hint).toEqual({ text: '5단계: 블레이드 장신구 T4 필요', charId: 'blade', slot: 'charm' });
    expect(nextStageHint(party, [], 13)).toBeNull();
  });
  it('stage texts', () => {
    expect(stageTitle(4)).toBe('4단계 · 사무실');
    expect(stageTitle(12)).toBe('12단계 · 옥상');
    expect(stageLootText(5)).toBe('장비 2');
    expect(stageLootText(9)).toBe('장비 3 · 유물 확률');
    expect(stageBannerSub(3)).toContain('보스 단계');
  });
  it('bag chip colour = the highest band', () => {
    expect(bagTopBand([])).toBe(0);
    expect(bagTopBand([w(2), w(8), w(5)])).toBe(3);
  });
});

describe('extract / choice recommendations (review fix)', () => {
  const A = (t: number): GearSpec => ({ slot: 'armor', tier: t, rarity: 'common' });
  const W = (t: number): GearSpec => ({ slot: 'weapon', tier: t, rarity: 'common' });
  const party = ['guardian', 'blade', 'cleric'];

  it('one item per character · slot, the weakest slot first, best items first', () => {
    const wearing: GearLoadout[] = [{ armor: A(2) }, {}, { armor: A(1) }];
    // 3 armors + 1 weapon: blade (empty) gets the best armor, then cleric (T1), then guardian (T2) — never all to one
    expect(recommendWearers([A(3), A(4), A(2), W(1)], party, wearing)).toEqual(['cleric', 'blade', null, 'guardian']);
  });

  it('nobody gains → no recommendation', () => {
    const full: GearLoadout[] = party.map(() => ({ weapon: W(9) }));
    expect(recommendWearers([W(3)], party, full)).toEqual([null]);
  });

  it('걸린 장비 chips: [tier, count], highest tier first', () => {
    expect(tierCounts([W(1), A(1), A(4)])).toEqual([
      [4, 1],
      [1, 2],
    ]);
    expect(tierCounts([])).toEqual([]);
  });
});
