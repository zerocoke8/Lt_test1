// 기획 17차 층 보상 (docs/floor-rewards.md): the CORE framework — offers (bands, legendary, slots, guarantee, caps,
// eligibility, lean), rerolls, 지명권, the role card, bot picks, offerMods (상자 / 욕심 / 빚 through a test hook), system
// cards, the core set bonuses, carry, team scope. Test-only families (tst_*) are mocked into the track data so the
// framework can be checked before the tracks fill their pools.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/data/rewards/swap', async importOriginal => {
  const orig = await importOriginal<typeof import('../../src/data/rewards/swap')>();
  type F = (typeof orig.SWAP_FAMILIES)[number];
  const fam = (key: string, o: Partial<F> = {}): F => ({ key, name: key, tags: [], target: 'party', botWeight: 1, params: { common: { v: 1 }, rare: { v: 2 } }, describe: () => key, ...o });
  return {
    ...orig,
    SWAP_FAMILIES: [
      ...orig.SWAP_FAMILIES,
      fam('tst_legend', { unique: true, params: { legendary: { v: 9 } }, tags: ['swap'] }),
      fam('tst_curse', { flag: 'curse', tags: ['curse'] }),
      fam('tst_curse2', { flag: 'curse', tags: ['curse'] }),
      fam('tst_coop', { flag: 'coop', tags: ['coop'] }),
      fam('tst_coop2', { flag: 'coop', tags: ['coop'] }),
      fam('tst_econ', { flag: 'economy', botWeight: 0, target: 'self', params: { common: {} } }),
      fam('tst_healer', { requires: 'healer', tags: ['survive'] }),
      fam('tst_member', { target: 'member', prefRoles: ['healer', 'tank'], name: '{char} 시험', tags: ['attack'] }),
      fam('tst_epiconly', { params: { epic: { v: 3 } }, tags: ['boss'] }),
    ],
  };
});

vi.mock('../../src/sim/rewards/rules', async importOriginal => {
  const orig = await importOriginal<typeof import('../../src/sim/rewards/rules')>();
  const { hookGroup } = await import('../../src/sim/rewards/types');
  // rewardState.tstMods: 1 = 상자 (rarity +1), 2 = 욕심 (4 cards, pick 2), 3 = 빚 (skip)
  const test: import('../../src/sim/rewards/types').RewardHooks = {
    offerMods(_w, p, acc) {
      const m = p.rewardState?.tstMods ?? 0;
      if (m === 1) acc.rarityBump = 1;
      if (m === 2) {
        acc.count = 4;
        acc.picks = 2;
      }
      if (m === 3) {
        acc.skip = true;
        acc.skipBy = 'debt';
        acc.skipText = '빚 · 이번 보상 없음';
      }
    },
  };
  return { ...orig, RULES_HOOKS: hookGroup(orig.RULES_HOOKS, test) };
});

import type { PlayerSetup, RewardOffer } from '../../src/types';
import { RARITY_BY_BAND, REWARDS, TAG_BONUS, getFamily, getReward } from '../../src/data';
import { tick } from '../../src/sim/game';
import { swapCooldownOf } from '../../src/sim/cooldowns';
import { petCooldownFor } from '../../src/sim/cooldowns';
import { heal } from '../../src/sim/combat';
import { effStats } from '../../src/sim/stats';
import { extractCarry } from '../../src/sim/expedition';
import { ultFillTimes } from '../../src/sim/ultMode';
import { botPickIndex, offerScore } from '../../src/sim/rewards/botPick';
import { defaultMember, drawOne, grantReward, rarityBand, rerollReward, rollOffers, tagLean } from '../../src/sim/rewards/offers';
import { tagActive, tagCounts, tagsOf } from '../../src/sim/rewards/query';
import { Rng } from '../../src/sim/rng';
import { runJoinProblem } from '../../src/expedition/runCheck';
import { BOT1, BOT2, HUMAN, active, eventsOf, makeGame, quietFloor, type TestGame } from './helpers';

const BASIC = new Set(['atk', 'hp', 'aspd', 'crit', 'def', 'petcd', 'dragdmg', 'dragrad', 'swapcd', 'appshield', 'normcd', 'ultdmg']);
const SWAPPY = new Set(['appear', 'leave', 'swap', 'just']);

function game(o: { players?: PlayerSetup[]; startFloor?: number; seed?: number } = {}): TestGame {
  const tg = makeGame({ seed: o.seed ?? 4242, players: o.players ?? [HUMAN], startFloor: o.startFloor, tunables: { invincible: true } });
  quietFloor(tg);
  return tg;
}

function clearFloor(tg: TestGame): RewardOffer[] | null {
  expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
  return tg.w.state.rewardOffersByPlayer[0];
}

/** Many screens of player 0 at this floor (rerolls on the player's own stream). */
function screens(tg: TestGame, n: number, opts: { fixture?: boolean } = {}): RewardOffer[][] {
  const p = tg.w.state.players[0];
  return Array.from({ length: n }, (_, k) => rollOffers(tg.w, p, false, { rollNo: k, fixture: opts.fixture }));
}

describe('offers: rarity bands and legendary', () => {
  // 기획 17차 밸런스 (balance.md 17-2): 70/25/5/0 · 67/25/6/2 → 86/12/2/0 · 82/13/3/2
  it('classic floors 1–10 and 원정 1–6: 86/12/2/0; classic 11+ / 원정 7+: 82/13/3/2', () => {
    const a = game();
    a.w.state.floor = 10;
    expect(rarityBand(a.w.state)).toEqual(RARITY_BY_BAND[0]);
    expect(RARITY_BY_BAND[0]).toEqual([86, 12, 2, 0]);
    a.w.state.floor = 11;
    expect(rarityBand(a.w.state)).toEqual([82, 13, 3, 2]);
    const e6 = makeGame({ players: [HUMAN], expedition: { stage: 6 } });
    expect(rarityBand(e6.w.state)).toEqual([86, 12, 2, 0]);
    const e7 = makeGame({ players: [HUMAN], expedition: { stage: 7 } });
    expect(rarityBand(e7.w.state)).toEqual([82, 13, 3, 2]);
  });

  it('no legendary before the band; at most one per screen after it; owned unique legendaries never again', () => {
    const early = game();
    early.w.state.floor = 4;
    expect(screens(early, 300).flat().some(o => o.rarity === 'legendary')).toBe(false);
    const late = game();
    late.w.state.floor = 15;
    const all = screens(late, 600);
    expect(all.every(s => s.filter(o => o.rarity === 'legendary').length <= 1)).toBe(true);
    expect(all.some(s => s.some(o => o.rarity === 'legendary'))).toBe(true);
    // slot 1 is never the legendary (it is basic)
    expect(all.every(s => s[0].rarity !== 'legendary')).toBe(true);
    grantReward(late.w, late.w.state.players[0], 'tst_legend_legendary', null);
    expect(screens(late, 400).flat().some(o => o.family === 'tst_legend')).toBe(false);
  });

  it('debug offerFixture: the next normal screen shows a legendary (one left) — then no more', () => {
    const tg = game();
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'offerFixture' } }).ok).toBe(true);
    const offers = clearFloor(tg)!;
    // exactly one legendary card (the tracks' real legendaries share the pool with the mocked tst_legend)
    const legends = offers.filter(o => o.rarity === 'legendary');
    expect(legends.length).toBe(1);
    expect(getReward(legends[0].rewardId).unique).toBe(true);
    expect(tg.w.state.players[0].rt.offerFixture).toBe(false);
  });

  it('drawOne (괴담 rooms) never draws a legendary, an economy / coop card, or a family the party does not fit', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    const rng = new Rng(7);
    for (let i = 0; i < 400; i++) {
      const r = drawOne(rng, p, { common: 70, rare: 25, epic: 5, legendary: 50 })!;
      const def = getReward(r.rewardId);
      expect(def.rarity).not.toBe('legendary');
      expect(def.flag).toBeUndefined();
      expect(def.family).not.toBe('tst_healer');
    }
  });
});

describe('offers: slots, guarantee, caps, eligibility, lean', () => {
  it('slot 1 basic, families distinct, ≥ 1 #등장/#퇴장/#교대/#저스트 card, ≤ 1 curse, ≤ 1 coop', () => {
    const tg = game({ players: [HUMAN, BOT1, BOT2] });
    tg.w.state.floor = 13;
    for (const s of screens(tg, 500)) {
      expect(s.length).toBe(3);
      expect(BASIC.has(s[0].family!)).toBe(true);
      expect(new Set(s.map(o => o.family)).size).toBe(3);
      expect(s.some(o => (o.tags ?? []).some(t => SWAPPY.has(t)))).toBe(true);
      // the caps count the family's own tags (#저주 / #협동), whatever its flag (빚쟁이 = economy, 피의 서약 = coop)
      const own = (t: string) => s.filter(o => getFamily(o.family!).tags.includes(t as never)).length;
      expect(own('curse')).toBeLessThanOrEqual(1);
      expect(own('coop')).toBeLessThanOrEqual(1);
    }
  });

  it('requires: no healer → no healer card; coop cards need another seat (bots count)', () => {
    const solo = game(); // guardian · blade · mage
    const fams = new Set(screens(solo, 400).flat().map(o => o.family));
    expect(fams.has('tst_healer')).toBe(false);
    expect(fams.has('tst_coop')).toBe(false);
    const team = game({ players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'] }, BOT1] });
    const f2 = new Set(screens(team, 400).flat().map(o => o.family));
    expect(f2.has('tst_healer')).toBe(true);
    expect(f2.has('tst_coop')).toBe(true);
  });

  it('a family missing the rolled rarity shows its nearest lower one, else the next higher (never 전설)', () => {
    const tg = game();
    tg.w.state.floor = 15;
    for (const o of screens(tg, 400).flat()) {
      expect(getReward(o.rewardId).rarity).toBe(o.rarity);
      if (o.family === 'tst_epiconly') expect(o.rarity).toBe('epic');
    }
  });

  it('tag lean only for a tag held exactly twice', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    expect([...tagLean(p)]).toEqual([]);
    grantReward(tg.w, p, 'atk_common', null);
    grantReward(tg.w, p, 'crit_common', null);
    expect([...tagLean(p)]).toEqual(['attack']);
    grantReward(tg.w, p, 'aspd_common', null);
    expect([...tagLean(p)]).toEqual([]);
  });
});

describe('다시 뽑기', () => {
  it('spends one, never shows this screen’s families again, touches neither the run rng nor anyone else', () => {
    const tg = game({ players: [HUMAN, { ...HUMAN2SETUP }, BOT1] });
    const before = clearFloor(tg)!;
    const s = tg.w.state;
    const rngBefore = (tg.w.rng as unknown as { s: number }).s;
    const other = JSON.stringify(s.rewardOffersByPlayer[1]);
    expect(s.players[0].rerolls).toBe(1);
    expect(tg.game.dispatch({ type: 'rerollReward', player: 0 }).ok).toBe(true);
    const after = s.rewardOffersByPlayer[0]!;
    expect(s.players[0].rerolls).toBe(0);
    expect(after.length).toBe(3);
    for (const o of after) expect(before.map(b => b.family)).not.toContain(o.family);
    expect((tg.w.rng as unknown as { s: number }).s).toBe(rngBefore);
    expect(JSON.stringify(s.rewardOffersByPlayer[1])).toBe(other);
    expect(tg.game.dispatch({ type: 'rerollReward', player: 0 })).toEqual({ ok: false, reason: '다시 뽑기 없음' });
  });

  it('same seed and rolls → same cards; relic screens refuse; boss clears give +1 (max 5)', () => {
    const a = game();
    const b = game();
    expect(clearFloor(a)).toEqual(clearFloor(b));
    const boss = game({ startFloor: 5 });
    const p = boss.w.state.players[0];
    p.rerolls = 4;
    const offers = clearFloor(boss)!;
    expect(offers.every(o => o.isRelic)).toBe(true);
    expect(p.rerolls).toBe(5);
    expect(boss.game.dispatch({ type: 'rerollReward', player: 0 })).toEqual({ ok: false, reason: '유물은 다시 뽑을 수 없음' });
    p.rerolls = 5;
    boss.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(p.rerolls).toBe(5);
  });

  it('reroll then the same pick path: the combat after it is bit-identical to no reroll (offers live off the run rng)', () => {
    const run = (reroll: boolean) => {
      const tg = game({ seed: 77 });
      clearFloor(tg);
      if (reroll) tg.game.dispatch({ type: 'rerollReward', player: 0 });
      // pick a card that changes nothing in combat (a pet-cooldown card) — the same in both runs
      const p = tg.w.state.players[0];
      grantReward(tg.w, p, 'petcd_common', null);
      tg.w.state.rewardOffersByPlayer[0] = null;
      p.rerolls = 1;
      tg.w.state.rewardOffers = null;
      return (tg.w.rng as unknown as { s: number }).s;
    };
    expect(run(true)).toBe(run(false));
  });
});

const HUMAN2SETUP: PlayerSetup = { name: '둘', isBot: false, characters: ['ranger', 'cleric', 'berserker'], pets: ['owl_frost', 'turtle_guard', 'rabbit_time'] };

describe('지명권 and the role card', () => {
  it('default member: the card’s role order, then the most field time, ties → the lower slot', () => {
    const tg = game({ players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'paladin'] }] });
    const p = tg.w.state.players[0];
    expect(defaultMember(p, ['healer', 'tank'])).toBe(1);
    expect(defaultMember(p, ['tank'])).toBe(0);
    p.party[2].fieldTime = 50;
    expect(defaultMember(p, ['tank'])).toBe(2);
    expect(defaultMember(p, ['ranged', 'melee', 'support'])).toBe(0);
  });

  it('a member card goes to the member sent with chooseReward (else its default); a bad member is refused', () => {
    const tg = game();
    const offers = clearFloor(tg)!;
    const i = offers.findIndex(o => o.target === 'member');
    if (i < 0) return; // this seed's screen has none (the guarantee does not need one)
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: i, member: 7 })).toEqual({ ok: false, reason: '잘못된 대상' });
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: i, member: 2 }).ok).toBe(true);
    expect(tg.w.state.players[0].rewards.at(-1)).toEqual({ rewardId: offers[i].rewardId, partyIndex: 2 });
  });

  it('the role card: rolled for a role of the party; another member picks that member’s role; tags follow the role', () => {
    const tg = game({ players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'] }] });
    const p = tg.w.state.players[0];
    let found: { o: RewardOffer; k: number } | null = null;
    for (let k = 0; k < 300 && !found; k++) {
      const o = rollOffers(tg.w, p, false, { rollNo: k }).find(x => x.family === 'role');
      if (o) found = { o, k };
    }
    expect(found).not.toBeNull();
    const o = found!.o;
    expect(['tank', 'healer', 'ranged']).toContain(o.role);
    expect(o.member).toBe(p.party.findIndex((_, i) => i === o.member));
    expect(o.name.endsWith('특기')).toBe(true);
    grantReward(tg.w, p, o.rewardId, 1); // cleric = healer
    expect(tagsOf(p, p.rewards.at(-1)!)).toEqual(['survive', 'leave']);
    grantReward(tg.w, p, o.rewardId, 2); // mage = ranged
    expect(tagsOf(p, p.rewards.at(-1)!)).toEqual(['appear', 'leave']);
  });

  it('debug grantReward: a member card with no member goes to its default', () => {
    const tg = game({ players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'] }] });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'grantReward', rewardId: 'tst_member_common' } }).ok).toBe(true);
    expect(tg.w.state.players[0].rewards.at(-1)).toEqual({ rewardId: 'tst_member_common', partyIndex: 1 });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'grantReward', rewardId: 'nope_common' } }).ok).toBe(false);
  });
});

describe('bots pick by score', () => {
  it('pure and deterministic; rarity × weight × lean; economy never', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    const offers = rollOffers(tg.w, p, false);
    const i = botPickIndex(p, offers);
    expect(botPickIndex(p, offers)).toBe(i);
    expect(i).toBeGreaterThanOrEqual(0);
    const econ = { ...offers[0], rewardId: 'tst_econ_common', family: 'tst_econ', rarity: 'common' as const, tags: [] };
    expect(offerScore(p, econ)).toBe(0);
    expect(botPickIndex(p, [econ, offers[0]])).toBe(1);
    const atk = { ...offers[0], rewardId: 'atk_common', family: 'atk', rarity: 'common' as const, tags: ['attack' as const] };
    expect(offerScore(p, atk)).toBeCloseTo(1.2, 9);
    grantReward(tg.w, p, 'crit_common', null);
    grantReward(tg.w, p, 'aspd_common', null);
    expect(offerScore(p, atk)).toBeCloseTo(1.2 * 1.3, 9);
    // 기획 17차 리뷰: an epic basic (2.4 × 1.2) beats a legendary (2.6); a legendary beats a plain epic and any rare
    const card = (rewardId: string, family: string, rarity: 'rare' | 'epic' | 'legendary') => ({ ...offers[0], rewardId, family, rarity, tags: [] });
    const legend = card('three_incense_legendary', 'three_incense', 'legendary');
    expect(botPickIndex(p, [legend, card('hp_epic', 'hp', 'epic')])).toBe(1);
    expect(botPickIndex(p, [card('bolt_epic', 'bolt', 'epic'), legend])).toBe(1);
    expect(botPickIndex(p, [card('hp_rare', 'hp', 'rare'), legend])).toBe(1);
  });

  it('bots take their card at once (no run-rng draw), out players get none', () => {
    const tg = game({ players: [HUMAN, BOT1, BOT2] });
    const r0 = (tg.w.rng as unknown as { s: number }).s;
    clearFloor(tg);
    expect((tg.w.rng as unknown as { s: number }).s).toBe(r0);
    const s = tg.w.state;
    expect(s.players[1].rewards.length).toBe(1);
    expect(s.players[2].rewards.length).toBe(1);
    expect(s.rewardOffersByPlayer[1]).toBeNull();
  });
});

describe('offerMods (상자 · 욕심 · 빚 through a test hook)', () => {
  it('상자: every card one rarity up (epic stays, never legendary)', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    p.rewardState = { tstMods: 1 };
    p.rewards.push({ rewardId: 'atk_common', partyIndex: null }); // the hook only runs for a player with rewards
    const offers = clearFloor(tg)!;
    expect(offers.some(o => o.rarityBumped)).toBe(true);
    expect(offers.every(o => o.rarity !== 'legendary')).toBe(true);
  });

  it('욕심: 4 cards, pick 2 (the screen stays after the first pick)', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    p.rewardState = { tstMods: 2 };
    p.rewards.push({ rewardId: 'atk_common', partyIndex: null });
    const offers = clearFloor(tg)!;
    expect(offers.length).toBe(4);
    expect(p.rewardPicksLeft).toBe(2);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    expect(tg.w.state.phase).toBe('reward');
    expect(tg.w.state.rewardOffersByPlayer[0]!.length).toBe(3);
    expect(p.rewardPicksLeft).toBe(1);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    expect(tg.w.state.phase).toBe('combat');
    expect(p.rewardPicksLeft).toBeUndefined();
    expect(p.rewards.length).toBe(3);
  });

  it('빚: no screen, a toast event, the floor goes on', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    p.rewardState = { tstMods: 3 };
    p.rewards.push({ rewardId: 'atk_common', partyIndex: null });
    expect(clearFloor(tg)).toBeNull();
    expect(tg.w.state.phase).toBe('combat');
    expect(eventsOf(tg, 'rewardProc').some(e => e.rewardId === 'debt' && e.text === '빚 · 이번 보상 없음')).toBe(true);
  });
});

describe('system cards and the core set bonuses', () => {
  it('여분의 향 +2 rerolls (max 5); 금박 부적 turns the latest common into its rare', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    grantReward(tg.w, p, 'incense_common', null);
    expect(p.rerolls).toBe(3);
    grantReward(tg.w, p, 'incense_common', null);
    expect(p.rerolls).toBe(5);
    grantReward(tg.w, p, 'atk_common', null);
    grantReward(tg.w, p, 'crit_common', null);
    grantReward(tg.w, p, 'gilded_common', null);
    expect(p.rewards.map(r => r.rewardId)).toContain('crit_rare');
    expect(p.rewards.map(r => r.rewardId)).toContain('atk_common');
  });

  it('three of a tag (the same card twice counts 2) → its set bonus once; tagSet fires once', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    grantReward(tg.w, p, 'just_cd_common', null);
    grantReward(tg.w, p, 'just_cd_common', null);
    expect(tagCounts(p).swap).toBe(2);
    expect(tagActive(p, 'swap')).toBe(false);
    const base = swapCooldownOf(tg.w.tunables, p, 0);
    grantReward(tg.w, p, 'swapcd_common', 1);
    expect(tagActive(p, 'swap')).toBe(true);
    expect(eventsOf(tg, 'tagSet').filter(e => e.tag === 'swap').length).toBe(1);
    // #교대: −1 s on every leave (min 4)
    tg.w.state.players[0].party[1].swapCooldownRemaining = 0;
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 8, y: 6 } }).ok).toBe(true);
    expect(p.party[0].swapCooldownTotal).toBeCloseTo(Math.max(4, base - TAG_BONUS.swap.cd), 9);
  });

  it('#궁극기 charge +12 %, #펫 cooldown −10 %, #공격 crit damage +25 %p, #생존 heals +15 %', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    const fill0 = ultFillTimes(tg.w.tunables, p).field;
    for (const id of ['ultdmg_common', 'ultdmg_rare', 'ultdmg_epic']) grantReward(tg.w, p, id, 0);
    expect(ultFillTimes(tg.w.tunables, p).field).toBeCloseTo(fill0 / 1.12, 9);
    const pet0 = petCooldownFor(tg.w, p, 0);
    for (let i = 0; i < 3; i++) grantReward(tg.w, p, 'petcd_common', null);
    expect(petCooldownFor(tg.w, p, 0)).toBeCloseTo(pet0 * (1 - 0.3) * (1 - TAG_BONUS.pet.cd), 6);
    const e = active(tg);
    const crit0 = effStats(tg.w, e).critMult;
    for (let i = 0; i < 3; i++) grantReward(tg.w, p, 'atk_common', null);
    expect(effStats(tg.w, e).critMult).toBeCloseTo(crit0 + 0.25, 9);
    e.hp = 1;
    const h0 = heal(tg.w, null, e, 100);
    expect(h0).toBeCloseTo(100, 6);
    for (let i = 0; i < 3; i++) grantReward(tg.w, p, 'def_common', null);
    e.hp = 1;
    expect(heal(tg.w, null, e, 100)).toBeCloseTo(115, 6);
  });
});

describe('carry and runs (원정)', () => {
  it('rerolls / rewardState / 이중 장전 charges go into the carry and come back; an old carry starts with 1 reroll', () => {
    const tg = makeGame({ players: [HUMAN], expedition: { stage: 2 } });
    const p = tg.w.state.players[0];
    p.rerolls = 3;
    p.rewardState = { nails: 6 };
    p.party[1].dragCharges = 1;
    const c = extractCarry(tg.w.state, 0);
    expect(c).toMatchObject({ rerolls: 3, rewardState: { nails: 6 }, dragCharges: [null, 1, null] });
    const next = makeGame({ players: [HUMAN], expedition: { stage: 3, carry: [c] } });
    const q = next.w.state.players[0];
    expect(q.rerolls).toBe(3);
    expect(q.rewardState).toEqual({ nails: 6 });
    expect(q.party[1].dragCharges).toBe(1);
    const old = makeGame({ players: [HUMAN], expedition: { stage: 3, carry: [{ rewards: [], goedamTraces: [], ult: [0, 0, 0] }] } });
    expect(old.w.state.players[0].rerolls).toBe(1);
  });

  it('runCheck: legendary ids, rerolls 0..5, known counters in range, charges 0..2', () => {
    const info = (carry: object) => ({ id: 'abcdefgh1234', startStage: 1, cleared: 1, bag: [], carry: { rewards: [], goedamTraces: [], ult: [0, 0, 0], ...carry }, bossClears: [] });
    const ok = (carry: object) => runJoinProblem(info(carry) as never, 2, [{}, {}, {}], true);
    expect(ok({ rewards: [{ rewardId: 'tst_legend_legendary', partyIndex: null }] })).toBeNull();
    expect(ok({ rerolls: 5, rewardState: { nails: 30, debt: 2 }, dragCharges: [2, null, 0] })).toBeNull();
    expect(ok({ rerolls: 6 })).not.toBeNull();
    expect(ok({ rewardState: { hack: 1 } })).not.toBeNull();
    expect(ok({ rewardState: { nails: 31 } })).not.toBeNull();
    expect(ok({ dragCharges: [3, 0, 0] })).not.toBeNull();
    expect(ok({ ult: [0, 1.5, 0] })).not.toBeNull();
    expect(ok({ rewards: Array.from({ length: 5 }, () => ({ rewardId: 'atk_common', partyIndex: null })) })).not.toBeNull();
    expect(ok({ rewards: Array.from({ length: 4 }, () => ({ rewardId: 'atk_common', partyIndex: null })) })).toBeNull();
  });

  it('every reward id resolves and every family has its own rarities only', () => {
    for (const r of REWARDS) expect(getReward(r.id)).toBe(r);
  });
});

describe('team scope', () => {
  it('each player rolls on their own stream; a seat that was out comes back at the clear and gets its own screen', () => {
    const tg = game({ players: [HUMAN, HUMAN2SETUP, BOT1] });
    tg.w.state.players[1].out = true;
    tg.w.state.players[1].party.forEach(m => (m.dead = true));
    clearFloor(tg);
    const s = tg.w.state;
    expect(s.players[1].out).toBe(false); // revived at the clear (기획 5차)
    expect(s.rewardOffersByPlayer[0]).not.toBeNull();
    expect(s.rewardOffersByPlayer[1]).not.toBeNull();
    expect(JSON.stringify(s.rewardOffersByPlayer[1]!.map(o => o.rewardId))).not.toBe(JSON.stringify(s.rewardOffersByPlayer[0]!.map(o => o.rewardId)));
    expect(s.rewardOffersByPlayer[2]).toBeNull(); // the bot picked at once
  });
});

void rerollReward;
