// 기획 19차 보스 레이드: the texts of the mode's screens (docs/boss-raid.md 7장) — HUD pill and banners, result facts and
// floor chips, pause line, lobby header, debug skip label. Pure helpers only (no DOM).
import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_RAID, getBoss } from '../../src/data';
import { bossRaidOrder } from '../../src/sim';
import { DEFAULT_TUNABLES } from '../../src/config';
import type { FloorPlan, RunResult } from '../../src/types';
import {
  RAID_LABEL,
  RAID_BANNER_LORE_MAX,
  raidBanner,
  raidBannerLore,
  raidBossesBeaten,
  raidClearSub,
  raidFloorTitle,
  raidProgress,
  raidResultReason,
  resultReason,
} from '../../src/ui/format';
import { raidBossNames } from '../../src/ui/result';
import { lobbyHeader } from '../../src/ui/lobby';
import { placeLabel, raidLoreLine } from '../../src/ui/pause';
import { SKIP_LABEL } from '../../src/ui/debug';

const TOTAL = DEFAULT_TUNABLES.maxFloor;
const result = (over: Partial<RunResult>): RunResult => ({ outcome: 'defeat', reason: 'wipe', floorReached: 7, duration: 300, ...over });
const bossPlan = (floor: number, bossId?: string): FloorPlan =>
  ({ floor, kind: 'boss', timeLimit: 90, arena: { width: 24, height: 12 }, statMult: 1, waves: [], ...(bossId ? { bossId } : null) }) as FloorPlan;

describe('보스 레이드 HUD texts', () => {
  it('the run has as many floors as the mode has bosses', () => {
    expect(TOTAL).toBe(BOSS_RAID.floors);
    expect(RAID_LABEL).toBe('보스 레이드');
  });

  it("progress pill: '보스 N/20'", () => {
    expect(raidProgress(1, TOTAL)).toBe('보스 1/20');
    expect(raidProgress(20, TOTAL)).toBe('보스 20/20');
    expect(raidProgress(-1, TOTAL)).toBe('보스 0/20');
  });

  it("floor banner: 'N층 · 보스 이름', the boss's 괴담 line, the goal with the progress", () => {
    const boss = getBoss('elevator_keeper');
    const b = raidBanner(5, boss, TOTAL);
    expect(b.big).toBe(`5층 · ${boss.name}`);
    // 기획 19차 review: one short sentence on the banner — the first of the 괴담 line, or the boss's own loreShort
    expect(b.lore).toBe('문이 닫히지 않는 엘리베이터.');
    expect(boss.lore.startsWith(b.lore)).toBe(true);
    expect(raidBanner(6, getBoss('endless_meeting'), TOTAL).lore).toBe(getBoss('endless_meeting').loreShort);
    expect(raidBannerLore({ lore: '한 문장뿐.' })).toBe('한 문장뿐.');
    expect(b.sub).toBe('보스 5/20 · HP를 0으로 만들면 퇴각해요');
    expect(raidBanner(1, { name: '보스' }, TOTAL).lore).toBe('');
  });

  it('every registered boss has a short banner: a name that fits one line and one short lore sentence', () => {
    for (const boss of BOSSES) {
      const b = raidBanner(20, boss, TOTAL);
      // 54 px title on a 1280 px stage: at most ~18 full-width glyphs with the banner's side padding
      expect(b.big.length, boss.id).toBeLessThanOrEqual(20);
      expect(b.lore.length, boss.id).toBeGreaterThan(0);
      // readable in the ~2 s the banner is fully up, and one line on a phone (review: 39–61 glyphs were not)
      expect(b.lore.length, boss.id).toBeLessThanOrEqual(RAID_BANNER_LORE_MAX);
      expect(b.lore.endsWith('.'), boss.id).toBe(true);
    }
  });

  it("clear banner: 'N층 돌파 · 보스 N/20'", () => {
    expect(raidClearSub(7, TOTAL)).toBe('7층 돌파 · 보스 7/20');
    expect(raidFloorTitle(3, '문서 파쇄기')).toBe('3층 · 문서 파쇄기');
  });
});

describe('보스 레이드 result texts', () => {
  it('bosses beaten: the floors below the one the run ended on; all of them on a win', () => {
    expect(raidBossesBeaten(result({ floorReached: 7 }))).toBe(6);
    expect(raidBossesBeaten(result({ floorReached: 1 }))).toBe(0);
    expect(raidBossesBeaten(result({ outcome: 'victory', reason: 'cleared', floorReached: 20 }))).toBe(20);
    expect(raidBossesBeaten(result({ floorReached: 0 }))).toBe(0);
  });

  it('the win line names all 20 bosses; other reasons read like the classic ones without "(보스층)"', () => {
    expect(raidResultReason(result({ outcome: 'victory', reason: 'cleared', floorReached: 20 }), false, TOTAL)).toBe('보스 20종을 모두 쓰러뜨렸어요');
    const wipe = result({ reason: 'wipe' });
    expect(raidResultReason(wipe, false, TOTAL)).toBe(resultReason(wipe, false, true));
    const timeout = raidResultReason(result({ reason: 'timeout' }), false, TOTAL);
    expect(timeout).toContain('광폭화');
    expect(timeout).not.toContain('보스층');
    expect(timeout).not.toContain('일반층');
    const quit = result({ reason: 'quit' });
    expect(raidResultReason(quit, true, TOTAL)).not.toBe(raidResultReason(quit, false, TOTAL));
  });

  it('floor chips name the boss of each floor from the run seed (the order the sim uses)', () => {
    const seed = 20261011;
    const order = bossRaidOrder(seed);
    const name = raidBossNames({ seed, floor: 3, plan: bossPlan(3, order[2]) });
    for (let f = 1; f <= TOTAL; f++) expect(name(f), `floor ${f}`).toBe(getBoss(order[f - 1]).name);
    // debug floors past the order repeat it, like the sim
    expect(name(TOTAL + 1)).toBe(getBoss(order[0]).name);
  });

  it('the floor on screen reads its own plan (a test / bench order), and an unknown id never throws', () => {
    const seed = 5;
    expect(raidBossNames({ seed, floor: 2, plan: bossPlan(2, 'abyss_watcher') })(2)).toBe(getBoss('abyss_watcher').name);
    expect(raidBossNames({ seed, floor: 2, plan: bossPlan(2, 'no_such_boss') })(2)).toBe('보스');
  });
});

describe('보스 레이드 labels on other screens', () => {
  it("pause line: 'N층 · 보스 레이드' (classic and 원정 keep theirs)", () => {
    expect(placeLabel({ floor: 7, plan: bossPlan(7, 'overtime_lord'), mode: 'bossRaid' })).toBe('7층 · 보스 레이드');
    expect(placeLabel({ floor: 5, plan: bossPlan(5, 'elevator_keeper') })).toBe('5층 · 보스층');
    expect(placeLabel({ floor: 4, plan: { ...bossPlan(4), kind: 'normal' } })).toBe('4층 · 일반층');
    // 기획 19차 review: the whole 괴담 line of the floor's boss is on the pause screen (the banner only has a short sentence)
    const meeting = getBoss('endless_meeting');
    expect(raidLoreLine({ plan: bossPlan(8, 'endless_meeting'), mode: 'bossRaid' })).toBe(`${meeting.name} — ${meeting.lore}`);
    expect(raidLoreLine({ plan: bossPlan(10, 'overtime_lord') })).toBe('');
  });

  it('lobby header: the chip only for a raid, in the list (my pick) and in the room (the room)', () => {
    expect(lobbyHeader(false, 'bossRaid')).toMatchObject({ title: '매칭', chip: '보스 레이드' });
    expect(lobbyHeader(true, 'bossRaid')).toMatchObject({ title: '방', chip: '보스 레이드' });
    expect(lobbyHeader(false, 'bossRaid').sub).toContain('층마다 보스');
    // classic texts are unchanged
    expect(lobbyHeader(false, null)).toEqual({ title: '매칭', sub: '최대 3명 협동 · 빈자리는 시작할 때 봇이 채워요', chip: '' });
    expect(lobbyHeader(true, undefined)).toEqual({ title: '방', sub: '최대 3명 · 빈자리는 시작할 때 봇이 채워요', chip: '' });
  });

  it('debug skip button: 「다음 보스로」 in a raid', () => {
    expect(SKIP_LABEL).toEqual({ classic: '층 건너뛰기', bossRaid: '다음 보스로' });
  });
});
