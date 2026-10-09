// 기획 15차 · 16차 원정 UI logic (pure): the lobby's 「N단계 매칭」 double tap, the lobby run view model, the match
// countdown and seats, the bag chip / pill label, and the Korean texts of gear / stages / buffs
// (src/ui/expeditionRun.ts, src/ui/expeditionFormat.ts, src/ui/reward.ts).
import { describe, expect, it } from 'vitest';
import { CONFIRM_MS, MATCH_SECONDS, bagTopBand, confirmTap, countdownLeft, isArmed, matchSeatsView, runLobbyView, tierCounts } from '../../src/ui/expeditionRun';
import { applyStageResult, beginStage, startRun, type ExpeditionRun } from '../../src/expedition/run';
import { EXP_REWARD_NOTE, rewardTitle } from '../../src/ui/reward';
import type { GameState } from '../../src/types';
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
  buffLines,
  MAP_LEGEND,
  nextStageCard,
  stageBannerSub,
  stageLootText,
  stageTitle,
} from '../../src/ui/expeditionFormat';
import type { GearLoadout, GearSpec } from '../../src/data/gear';
import { getCharacter } from '../../src/data';

describe('lobby 「N단계 매칭」: double tap to risk the bag (5-2)', () => {
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
    // 기획 16차: one floor per stage — 1 item on a normal stage, 1 + the boss box on a boss stage
    expect(stageLootText(5)).toBe('장비 1');
    expect(stageLootText(9)).toBe('장비 2 · 유물 확률');
    expect(stageBannerSub(3)).toBe('보스 단계 · 장비 2 · 유물 확률');
    expect(stageBannerSub(4)).toBe('깨면 장비 1개');
    expect(MAP_LEGEND).toContain('1층');
    expect(nextStageCard(4)).toMatchObject({ line: '4단계 · 사무실 · 수문장 엘리베이터 걸', loot: '장비 1', boss: false });
    expect(nextStageCard(6)).toMatchObject({ line: '6단계 · 사무실 · ☠ 야근의 군주', loot: '보스 단계 · 장비 2 · 유물 확률', boss: true });
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

// ─────────────────────────── 기획 16차: the lobby with a run in progress ───────────────────────────

const LOCK = { characters: ['guardian', 'blade', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'], gear: [{}, {}, {}] };

/** A run that cleared stages start..start+n−1, one T(stage) item each. */
function runAfter(start: number, n: number): ExpeditionRun {
  const run = startRun(start, LOCK, 'testRun0001', 7);
  for (let k = 0; k < n; k++) {
    beginStage(run, { stage: run.stage, online: false, bootId: null, tabId: 't', aliveAt: 0 });
    const loot: GearSpec[] = [{ slot: 'armor', tier: run.stage, rarity: 'common' }];
    applyStageResult(run, { runId: run.id, stage: run.stage, outcome: 'cleared', loot, carry: { rewards: [{ rewardId: 'atk_common', partyIndex: null }], goedamTraces: [], ult: [0.5, 0, 1] }, bossClear: false });
  }
  return run;
}

describe('lobby run view (8-3)', () => {
  it('cleared 2 of a run from stage 1: path, bag, NEW, next card, risk, buttons', () => {
    const v = runLobbyView(runAfter(1, 2));
    expect(v.title).toBe('원정 진행 중 · 2단계까지 클리어');
    expect(v.path.map(p => p.dot).slice(0, 4)).toEqual(['done', 'done', 'next', 'todo']);
    expect(v.path.filter(p => p.boss).map(p => p.stage)).toEqual([3, 6, 9, 12]);
    expect(v.bagHead).toBe('가방 2개 · 최고 T2');
    expect(v.tiers).toEqual([
      [2, 1],
      [1, 1],
    ]);
    expect(v.isNew).toEqual([false, true]);
    expect(v.nextBoss).toBe(true);
    expect(v.nextLoot).toBe('보스 단계 · 장비 2 · 유물 확률');
    expect(v.risk).toBe('실패하면 가방 2개를 잃어요 (장착 장비는 안전)');
    expect(v.buffs).toBe(1);
    expect(v.claimSub).toBe('가방 2개 모두 보관함으로 · 버프 1개는 사라져요');
    expect(v.matchTitle).toBe('3단계 매칭');
    expect(v.matchSub).toBe('새 동료와 매칭 · 버프 1개 유지');
    expect(v.needConfirm).toBe(true);
    expect(v.waiting).toBe(false);
    expect(v.complete).toBe(false);
  });

  it('a run started at stage 4: earlier stages are skipped; an empty bag needs one tap only', () => {
    const run = startRun(4, LOCK, 'testRun0002', 1);
    const v = runLobbyView(run);
    expect(v.path.slice(0, 4).map(p => p.dot)).toEqual(['skip', 'skip', 'skip', 'next']);
    expect(v.title).toBe('원정 시작 · 4단계 대기');
    expect(v.needConfirm).toBe(false);
    expect(v.risk).toContain('잃을 장비가 없어요');
    expect(confirmTap(null, 0, v.needConfirm).go).toBe(true);
  });

  it('a stage running → waiting (no buttons); stage 12 cleared → complete', () => {
    const run = runAfter(1, 1);
    beginStage(run, { stage: run.stage, online: true, bootId: 'b', tabId: 't', aliveAt: 0 });
    expect(runLobbyView(run).waiting).toBe(true);
    expect(runLobbyView(runAfter(12, 1)).complete).toBe(true);
  });

  it('buff list: rewards with the bound character, traces with stages left', () => {
    const lines = buffLines(
      {
        rewards: [
          { rewardId: 'atk_common', partyIndex: null },
          { rewardId: 'dragdmg_rare', partyIndex: 1 },
        ],
        goedamTraces: [{ id: 'looked_back', floorsLeft: 2 }, { id: 'red_paper', floorsLeft: null }],
        ult: [0, 0, 0],
      },
      LOCK.characters,
    );
    expect(lines).toEqual(['✦ 공격력 강화', '✦ 블레이드 드래그스킬 강화', '👀 돌아본 자 · 2단계 남음', '🩸 빨간 휴지 · 원정 끝까지']);
    expect(buffLines(null, LOCK.characters)).toEqual([]);
  });

  it('floor reward title + note in an expedition', () => {
    expect(rewardTitle({ floor: 1, expedition: { stage: 4 } } as unknown as GameState)).toBe('4단계 클리어!');
    expect(rewardTitle({ floor: 7 } as unknown as GameState)).toBe('7층 클리어!');
    expect(EXP_REWARD_NOTE).toBe('수령하면 이 보상은 사라져요');
  });
});
