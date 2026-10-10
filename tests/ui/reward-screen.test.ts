// 기획 17차 보상 화면 (src/ui/reward.ts, pure parts): subtitle (relic / 욕심 / 상자), countdown naming the bot-rule card,
// 다시 뽑기 button state, 지명권 (member cards rename, role cards follow the tapped member's role), tag progress chips
// ('#퇴장 ●●○ 2/3', '3/3 완성!'), kind chips, the particle helper.
import { describe, expect, it } from 'vitest';
import type { PlayerState, RewardOffer, SynergyTag } from '../../src/types';
import { RARITY_COLOR, RARITY_LABEL, REWARDS, ROLE_TAGS, SYNERGY_TAGS, TAG_SET_BONUS, getCharacter, getFamily, getReward } from '../../src/data';
import { botPickIndex } from '../../src/sim/rewards/botPick';
import { grantReward, rollOffers } from '../../src/sim/rewards/offers';
import { tagCounts } from '../../src/sim/rewards/query';
import { REROLL_MIN_LEFT, autoPickText, hasTarget, kindLabel, objParticle, offersFor, rerollState, resolvedCard, rewardSub, tagProgress, timerText } from '../../src/ui/reward';
import { HUMAN, makeGame, quietFloor } from '../sim/helpers';

function me(): { tg: ReturnType<typeof makeGame>; p: PlayerState } {
  const tg = makeGame({ seed: 77, players: [HUMAN], tunables: { invincible: true } });
  quietFloor(tg);
  return { tg, p: tg.w.state.players[0] };
}

const offer = (id: string, o: Partial<RewardOffer> = {}): RewardOffer => {
  const d = getReward(id);
  return { rewardId: id, name: d.name, description: d.description, rarity: d.rarity, isRelic: false, partyIndex: null, family: d.family, tags: [...d.tags], target: d.target, member: null, ...o } as RewardOffer;
};

const zero = (): Record<SynergyTag, number> => Object.fromEntries(SYNERGY_TAGS.map(t => [t.id, 0])) as Record<SynergyTag, number>;

describe('reward screen: data', () => {
  it('4 rarities with labels and colours (전설 주황)', () => {
    expect(RARITY_LABEL.legendary).toBe('전설');
    expect(RARITY_COLOR.legendary).toBe('#ff8c42');
    expect(Object.keys(RARITY_LABEL)).toEqual(['common', 'rare', 'epic', 'legendary']);
  });
});

describe('reward screen: card text fits the phone card', () => {
  // 기획 17차 리뷰: the phone card shows ~5 lines (.rw-desc line-clamp 5 / 6 in the 4-card layout); 96 chars (인수인계)
  // was the longest that still fit at 844×390 — the 직업 특기 영웅 card used to be 133 and lost its own epic line
  const CARD_MAX = 96;
  it('every reward (every role of 직업 특기) at most 96 chars on the card', () => {
    const roles = ['tank', 'melee', 'ranged', 'healer', 'support'] as const;
    for (const d of REWARDS) {
      const f = getFamily(d.family);
      const texts = f.target === 'role' ? roles.map(role => f.describe(d.params, { role, card: true })) : [f.describe(d.params, { char: '클레릭', card: true })];
      for (const t of texts) expect(t.length, `${d.id}: ${t}`).toBeLessThanOrEqual(CARD_MAX);
    }
  });
  it('the 직업 특기 영웅 card names the lower lines and spells out its own; the build sheet keeps every line', () => {
    const f = getFamily('role');
    const card = f.describe({ level: 3 }, { role: 'tank', card: true });
    expect(card).toContain('육중한 착지 · 버려진 방패 + 짚 인형:');
    expect(f.describe({ level: 3 }, { role: 'tank' })).toContain('반경 3 적 1칸 밀기');
  });
});

describe('reward screen: subtitle / timer / reroll', () => {
  it('subtitle: normal, relic, 욕심 pick 2 then 1, 상자 note', () => {
    const { p } = me();
    const n = [offer('atk_common')];
    expect(rewardSub(n, p)).toBe('보상을 하나 고르세요');
    expect(rewardSub([{ ...n[0], isRelic: true }], p)).toContain('유물');
    expect(rewardSub(n, { ...p, rewardPicksLeft: 2 })).toBe('2장을 고르세요 · 욕심쟁이 계약서');
    expect(rewardSub(n, { ...p, rewardPicksLeft: 1 })).toBe('하나 더 고르세요 (1/2)');
    expect(rewardSub([{ ...n[0], rarityBumped: true }], p)).toContain('상자 효과 · 등급 한 단계 ↑');
  });

  it("countdown names the card the server picks (botPickIndex) with the right particle", () => {
    const { tg, p } = me();
    const offers = rollOffers(tg.w, tg.w.state.players[0], false, { rollNo: 0 });
    const pick = offers[botPickIndex(p, offers)];
    const text = timerText(12, offers, p);
    const name = resolvedCard(p, pick, pick.member ?? pick.partyIndex ?? null).name;
    expect(text).toBe(`12초 안에 안 고르면 '${name}'${objParticle(name)} 골라요`);
    expect(timerText(5, null, p)).toBe('5초 뒤 자동 선택');
    expect(objParticle('교대선')).toBe('을');
    expect(objParticle('바통 터치')).toBe('를');
    expect(objParticle('ABC')).toBe('을(를)');
    // 기획 17차 리뷰: after the timeout the toast names the same card
    expect(autoPickText(p, offers)).toBe(`시간이 다 돼서 「${name}」${objParticle(name)} 받았어요`);
    expect(autoPickText(p, [])).toBeNull();
  });

  it('다시 뽑기: hidden on relic screens, disabled at 0 or with ≤ 3 s left', () => {
    const { p } = me();
    const n = [offer('atk_common')];
    expect(rerollState(n, { ...p, rerolls: 2 }, null)).toEqual({ visible: true, enabled: true, count: 2 });
    expect(rerollState(n, { ...p, rerolls: 0 }, null).enabled).toBe(false);
    expect(rerollState(n, { ...p, rerolls: 2 }, REROLL_MIN_LEFT).enabled).toBe(false);
    expect(rerollState(n, { ...p, rerolls: 2 }, REROLL_MIN_LEFT + 0.5).enabled).toBe(true);
    expect(rerollState([{ ...n[0], isRelic: true }], p, null).visible).toBe(false);
    expect(rerollState(null, p, null).visible).toBe(false);
  });

  it('offersFor: my slot only, reward phase only', () => {
    const { tg } = me();
    const s = tg.w.state;
    expect(offersFor(s, 0)).toBeNull();
    s.phase = 'reward';
    s.rewardOffersByPlayer = [[offer('hp_rare')], null, null];
    expect(offersFor(s, 0)?.[0].rewardId).toBe('hp_rare');
    expect(offersFor(s, 1)).toBeNull();
  });
});

describe('reward screen: 지명권', () => {
  it('member cards take the chosen character in name and text; party cards ask nobody', () => {
    const { p } = me();
    const o = offer('dragdmg_rare', { member: 0 });
    expect(hasTarget(o)).toBe(true);
    expect(kindLabel(o)).toBe('캐릭터');
    const a = resolvedCard(p, o, 0);
    const b = resolvedCard(p, o, 2);
    expect(a.name).toBe(`${getCharacter('guardian').name} 드래그스킬 강화`);
    expect(b.name).toBe(`${getCharacter('mage').name} 드래그스킬 강화`);
    expect(a.name).not.toBe(b.name);
    expect(a.name).not.toContain('{char}');
    expect(b.description).toContain('+40%');
    const party = offer('atk_common');
    expect(hasTarget(party)).toBe(false);
    expect(kindLabel(party)).toBe('파티');
    expect(kindLabel({ ...party, isRelic: true })).toBe('유물');
  });

  it("role card: tapping a member switches to that member's role (name, text and tags)", () => {
    const { p } = me();
    const o = offer('role_rare', { member: 0, role: 'tank' });
    expect(kindLabel(o)).toBe('직업');
    const tank = resolvedCard(p, o, 0);
    const melee = resolvedCard(p, o, 1);
    expect(tank.name).toBe('탱커 특기');
    expect(tank.tags).toEqual(ROLE_TAGS.tank);
    expect(melee.name).toBe('근접딜러 특기');
    expect(melee.role).toBe('melee');
    expect(melee.tags).toEqual(ROLE_TAGS.melee);
    expect(melee.description).not.toBe(tank.description);
  });
});

describe('reward screen: tag chips', () => {
  it("progress '2/3' with the new dot, '3/3 완성!' when this card completes the set, '완성됨' after", () => {
    const c = zero();
    c.leave = 1;
    expect(tagProgress(c, ['leave'])[0]).toMatchObject({ have: 1, after: 2, completes: false, already: false, label: '퇴장' });
    c.leave = 2;
    const done = tagProgress(c, ['leave'])[0];
    expect(done.completes).toBe(true);
    expect(done.bonus).toBe(TAG_SET_BONUS.leave);
    c.leave = 3;
    expect(tagProgress(c, ['leave'])[0].already).toBe(true);
  });

  it('counts come from my rewards + relics (same card twice = 2)', () => {
    const { tg, p } = me();
    grantReward(tg.w, tg.w.state.players[0], 'atk_common', null);
    grantReward(tg.w, tg.w.state.players[0], 'atk_rare', null);
    const counts = tagCounts(p);
    expect(tagProgress(counts, ['attack'])[0]).toMatchObject({ have: 2, completes: true });
  });
});
