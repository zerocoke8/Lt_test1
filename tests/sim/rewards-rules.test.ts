// 기획 17차 Track C floor rewards (docs/floor-rewards.md 「규칙 변경·성장」 「괴담 저주·도박」 「멀티 협동」): each family
// fires when it should and not otherwise, with the numbers its card shows; stacking, run counters, the economy cards'
// screens, the coop team scope (bots and other humans count, out players do not), the #저주 #협동 #성장 sets and
// determinism.
import { describe, expect, it } from 'vitest';
import type { PlayerSetup, RewardOffer, Vec2 } from '../../src/types';
import { REWARDS, TAG_BONUS, getFamily, getReward } from '../../src/data';
import { CANDLES_KILLS, NAILS_MAX, RULES_FAMILIES } from '../../src/data/rewards/rules';
import { applyDamage, killEntity } from '../../src/sim/combat';
import { canSwapState } from '../../src/sim/players';
import { enrage } from '../../src/sim/floor';
import { tick } from '../../src/sim/game';
import { effStats } from '../../src/sim/stats';
import { rwChargeMult, rwDealtMult, rwGroggyMult, rwOnAppear, rwOnPet, rwTakenMult, rwUltMult } from '../../src/sim/rewards/hooks';
import { grantReward, rollOffers } from '../../src/sim/rewards/offers';
import { rewardCount, tagActive } from '../../src/sim/rewards/query';
import { deadlineOn } from '../../src/sim/rewards/rules';
import { charCtx } from '../../src/sim/ctx';
import { getEntity, type SimEntity, type SimPlayer } from '../../src/sim/world';
import { HUMAN, HUMAN2, active, advance, clearEvents, eventsOf, killActive, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const party = (characters: string[], name = '나'): PlayerSetup => ({ name, isBot: false, characters, pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] });
const HUMAN3 = party(['paladin', 'medic', 'bard'], '셋');

function setup(o: { players?: PlayerSetup[]; floor?: number; invincible?: boolean; seed?: number; expedition?: number } = {}): TestGame {
  const tg = makeGame({
    seed: o.seed ?? 99,
    players: o.players ?? [HUMAN],
    tunables: { invincible: o.invincible ?? true },
    ...(o.floor ? { startFloor: o.floor } : null),
    ...(o.expedition ? { expedition: { stage: o.expedition } } : null),
  });
  quietFloor(tg);
  for (let i = 0; i < 20; i++) tick(tg.w);
  clearEvents(tg);
  return tg;
}

const P = (tg: TestGame, i = 0): SimPlayer => tg.w.state.players[i];
const grant = (tg: TestGame, id: string, pi = 0, member: number | null = null) => grantReward(tg.w, P(tg, pi), id, member);
const procs = (tg: TestGame, key: string) => eventsOf(tg, 'rewardProc').filter(e => e.rewardId === key);

/** Swap card idx in at pos now (the appear lock cleared; cooldown cleared unless keepCd). */
function swap(tg: TestGame, idx: number, pos: Vec2, pi = 0, keepCd = false) {
  const p = P(tg, pi);
  p.appearLock = 0;
  if (!keepCd) p.party[idx].swapCooldownRemaining = 0;
  return tg.game.dispatch({ type: 'swap', player: pi, partyIndex: idx, pos });
}
function ult(tg: TestGame, pi = 0) {
  tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: pi } });
  return tg.game.dispatch({ type: 'ult', player: pi });
}
/** Clear the floor (debug), the reward screen of player 0. */
function clearFloor(tg: TestGame): RewardOffer[] | null {
  expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
  return tg.w.state.rewardOffersByPlayer[0];
}
/** Pick card 0 (and a second when the screen asks) for player 0, then let the next floor start. */
function pickAndGo(tg: TestGame): void {
  const s = tg.w.state;
  for (let i = 0; i < 3 && s.rewardOffersByPlayer[0]; i++) tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
  for (let i = 0; i < 400 && s.phase !== 'combat'; i++) tick(tg.w);
  expect(s.phase).toBe('combat');
  quietFloor(tg);
}
const atk = (tg: TestGame, pi = 0) => effStats(tg.w, active(tg, pi)).atk;
const appearInfo = (tg: TestGame, pi = 0) => {
  const e = active(tg, pi);
  return { idx: P(tg, pi).activeIndex!, e, at: { ...e.pos }, leave: null, just: false, sinceReady: 0, cooling: 0, forced: false };
};

// ─────────────────────────── data ───────────────────────────

describe('Track C data', () => {
  const KEYS = [
    'double_load', 'understudy', 'punch_in', 'window_fire', 'nails', 'candles',
    'blood_contract', 'coin', 'haste_cost', 'blood_entry', 'ledge', 'hungry_pet', 'soul_loan', 'red_moon', 'deadline', 'last_one', 'box_in_box', 'debt', 'greedy',
    'team_relay', 'joint_rite', 'three_incense', 'red_thread', 'stand_in', 'helping_hand', 'shared_soul', 'blood_oath',
  ];
  it('the 27 families of the spec, each id per rarity, short Korean text with its numbers', () => {
    expect(RULES_FAMILIES.map(f => f.key).sort()).toEqual([...KEYS].sort());
    for (const f of RULES_FAMILIES) {
      for (const r of REWARDS.filter(x => x.family === f.key)) {
        expect(r.id).toBe(`${f.key}_${r.rarity}`);
        expect(r.description.length, r.id).toBeLessThan(120);
        expect(r.description, r.id).toMatch(/[가-힣]/);
        if (r.cost) expect(r.cost, r.id).toMatch(/^대가: /);
      }
    }
    expect(getReward('punch_in_rare').description).toContain('3번');
    expect(getReward('window_fire_epic').description).toContain('45%');
    expect(getReward('haste_cost_rare').cost).toContain('8%');
    expect(getReward('blood_contract_epic').cost).toContain('80%');
  });

  it('flags, tags, bot weights and the two rule-changing legendaries', () => {
    const fam = (k: string) => getFamily(k);
    for (const k of ['double_load', 'three_incense']) {
      expect(fam(k).unique).toBe(true);
      expect(Object.keys(fam(k).params)).toEqual(['legendary']);
    }
    for (const k of ['box_in_box', 'debt', 'greedy']) {
      expect(fam(k).flag).toBe('economy');
      expect(fam(k).botWeight).toBe(0);
      expect(fam(k).tags).toEqual(['curse']);
    }
    for (const k of ['blood_contract', 'coin', 'haste_cost', 'blood_entry', 'ledge', 'hungry_pet', 'soul_loan', 'red_moon', 'last_one']) {
      expect(fam(k).flag, k).toBe('curse');
      expect(fam(k).botWeight, k).toBe(0.5);
      // 기획 17차 리뷰: 옥상 난간 위 / 최후의 1인 have a condition, not a cost (no red 대가 line, a plain 「선택」)
      expect(!!fam(k).cost, k).toBe(!['ledge', 'last_one'].includes(k));
    }
    for (const k of ['team_relay', 'joint_rite', 'three_incense', 'red_thread', 'stand_in', 'helping_hand', 'shared_soul', 'blood_oath']) expect(fam(k).flag, k).toBe('coop');
    for (const k of ['joint_rite', 'helping_hand', 'blood_oath']) expect(fam(k).botWeight, k).toBe(0.6);
    expect(fam('stand_in').requires).toBe('tank');
    expect(fam('double_load').target).toBe('member');
    // the economy keys are exactly the core's ECONOMY_STATE ones
    expect(getReward('blood_contract_epic').effect).toEqual({ kind: 'stat', mods: { atkPct: 0.3 } });
  });
});

// ─────────────────────────── 규칙 변경·성장 ───────────────────────────

describe('이중 장전 (double_load)', () => {
  it('2 charges: comes in on cooldown while one is left, refills one per finished cooldown, cooldown +10 % (기획 17차 밸런스: 30 → 10 %)', () => {
    const base = setup();
    expect(swap(base, 1, { x: 3, y: 0 }).ok).toBe(true);
    const plainCd = P(base).party[1].swapCooldownRemaining;
    expect(swap(base, 0, { x: 1, y: 0 }).ok).toBe(true);
    const plain = P(base).party[1].swapCooldownTotal;
    void plainCd;

    const tg = setup();
    const p = P(tg);
    grant(tg, 'double_load_legendary', 0, 1);
    expect(p.party[1].dragCharges).toBe(2);
    expect(swap(tg, 1, { x: 3, y: 0 }).ok).toBe(true); // ready appear: spends one
    expect(p.party[1].dragCharges).toBe(1);
    expect(swap(tg, 0, { x: 1, y: 0 }).ok).toBe(true);
    expect(p.party[1].swapCooldownTotal).toBeCloseTo(plain * 1.1, 5);
    expect(p.party[1].swapCooldownRemaining).toBeGreaterThan(0);
    // cooling but a charge left: allowed (the pure check agrees with the sim)
    p.appearLock = 0;
    expect(canSwapState(tg.w.state, 0, 1).ok).toBe(true);
    clearEvents(tg);
    expect(swap(tg, 1, { x: 2, y: 0 }, 0, true).ok).toBe(true);
    expect(p.party[1].dragCharges).toBe(0);
    expect(procs(tg, 'double_load').map(e => e.text)).toEqual(['장전!']);
    expect(swap(tg, 2, { x: 2, y: 1 }).ok).toBe(true);
    p.appearLock = 0;
    expect(canSwapState(tg.w.state, 0, 1)).toEqual({ ok: false, reason: '쿨타임' });
    // the cooldown ends on the bench → one charge, and the next one starts cooling
    advance(tg, p.party[1].swapCooldownRemaining + 0.1);
    expect(p.party[1].dragCharges).toBe(1);
    expect(p.party[1].swapCooldownRemaining).toBeGreaterThan(0);
    p.appearLock = 0;
    expect(canSwapState(tg.w.state, 0, 1).ok).toBe(true);
    advance(tg, p.party[1].swapCooldownRemaining + 0.1);
    expect(p.party[1].dragCharges).toBe(2);
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    // other cards are untouched
    expect(p.party[2].dragCharges).toBeUndefined();
  });
});

describe('빈자리의 대타 (understudy)', () => {
  it('the field character falls → the shortest-cooldown bench card appears at that spot (2 per floor, twice 3)', () => {
    const tg = setup({ invincible: false });
    const p = P(tg);
    grant(tg, 'understudy_rare');
    expect(p.rewardState?.understudyLeft).toBe(2);
    const me = active(tg);
    me.pos = { x: 4, y: 1 };
    p.party[1].swapCooldownRemaining = 5;
    p.party[2].swapCooldownRemaining = 2;
    killActive(tg);
    advance(tg, 0.1);
    expect(p.activeIndex).toBe(2);
    expect(active(tg).pos).toEqual({ x: 4, y: 1 });
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    expect(p.rewardState?.understudyLeft).toBe(1);
    expect(procs(tg, 'understudy').map(e => e.text)).toEqual(['대타!']);
    killActive(tg);
    advance(tg, 0.1);
    expect(p.activeIndex).toBe(1);
    expect(p.rewardState?.understudyLeft).toBe(0);
  });

  it('none left / nobody to send → the field stays empty; the next floor refills; twice = 3', () => {
    const tg = setup({ invincible: false });
    const p = P(tg);
    grant(tg, 'understudy_rare');
    p.rewardState!.understudyLeft = 0;
    killActive(tg);
    advance(tg, 0.1);
    expect(p.activeIndex).toBeNull();
    grant(tg, 'understudy_rare');
    expect(p.rewardState?.understudyLeft).toBe(3);
  });

  it('every floor start refills the uses', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'understudy_rare');
    p.rewardState!.understudyLeft = 0;
    clearFloor(tg);
    pickAndGo(tg);
    expect(p.rewardState?.understudyLeft).toBe(2);
  });
});

describe('출근 도장 (punch_in)', () => {
  it('the first 2 (rare 3) swaps of a floor put no cooldown on the leaver', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'punch_in_common');
    expect(swap(tg, 1, { x: 2, y: 0 }).ok).toBe(true);
    expect(p.party[0].swapCooldownRemaining).toBe(0);
    expect(swap(tg, 2, { x: 2, y: 0 }).ok).toBe(true);
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    expect(swap(tg, 0, { x: 2, y: 0 }).ok).toBe(true);
    expect(p.party[2].swapCooldownRemaining).toBeGreaterThan(3.9);
    expect(procs(tg, 'punch_in').length).toBe(2);
    grant(tg, 'punch_in_rare');
    expect(p.rewardState?.punchInLeft).toBe(3);
  });
});

describe('창문 너머 지원사격 (window_fire)', () => {
  it('every 5 s one bolt per living bench card at that card’s attack × 30 %; nothing while the field is empty', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'window_fire_rare');
    const foe = spawnAt(tg, 'goblin', { x: 11, y: 5 });
    foe.hp = foe.maxHp = 1e6;
    const bolts = () => tg.w.state.projectiles.filter(pr => pr.rt.ctx.skillId === 'window_fire');
    advance(tg, 4.9);
    expect(bolts().length).toBe(0);
    for (let i = 0; i < 12 && bolts().length === 0; i++) tick(tg.w);
    expect(bolts().length).toBe(2);
    expect(bolts().map(b => b.rt.amount)).toEqual([0.3, 0.3]);
    expect(bolts().map(b => b.rt.ctx.partyIndex).sort()).toEqual([1, 2]);
    const benchAtk = bolts().find(b => b.rt.ctx.partyIndex === 2)!.rt.ctx.atk;
    expect(benchAtk).toBeGreaterThan(0);
    expect(procs(tg, 'window_fire').length).toBe(1);
    // a dead bench card does not shoot
    p.party[2].dead = true;
    p.party[2].hp = 0;
    p.party[2].reviveRemaining = 999;
    tg.w.state.projectiles.length = 0;
    advance(tg, 4.5);
    for (let i = 0; i < 30 && bolts().length === 0; i++) tick(tg.w);
    expect(bolts().length).toBe(1);
  });
});

describe('자라는 손톱 · 백 개의 촛불 (growth)', () => {
  it('손톱: +2 % per floor start after picking (max 30)', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'nails_rare');
    const a0 = atk(tg);
    clearFloor(tg);
    pickAndGo(tg);
    expect(p.rewardState?.nails).toBe(2);
    p.rewardState!.nails = NAILS_MAX - 1;
    clearFloor(tg);
    pickAndGo(tg);
    expect(p.rewardState?.nails).toBe(NAILS_MAX);
    expect(a0).toBeGreaterThan(0);
  });

  it('촛불: every 40 team kills (any player) crit +1 % for the run, max 10', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    const p = P(tg);
    grant(tg, 'candles_rare');
    const crit0 = effStats(tg.w, active(tg)).critChance;
    for (let i = 0; i < CANDLES_KILLS; i++) {
      const foe = spawnAt(tg, 'goblin', { x: 8, y: 0 });
      killEntity(tg.w, foe, { casterId: null, team: 'ally', player: i % 2, source: 'basic', isDrag: false });
    }
    expect(p.rewardState?.candlesKills).toBe(CANDLES_KILLS);
    expect(p.rewardState?.candlesBonus).toBe(1);
    expect(effStats(tg.w, active(tg)).critChance).toBeCloseTo(crit0 + 0.01, 9);
    p.rewardState!.candlesBonus = 10;
    p.rewardState!.candlesKills = CANDLES_KILLS * 3 - 1;
    killEntity(tg.w, spawnAt(tg, 'goblin', { x: 8, y: 0 }), null);
    expect(p.rewardState?.candlesBonus).toBe(10);
  });
});

// ─────────────────────────── 괴담 저주·도박 ───────────────────────────

describe('피 묻은 계약서 (blood_contract)', () => {
  it('atk +30 % on every member; classic: no between-floor heal', () => {
    const tg = setup();
    const p = P(tg);
    const a0 = atk(tg);
    grant(tg, 'blood_contract_epic');
    expect(atk(tg) / a0).toBeCloseTo((1 + 0.3) / 1, 1);
    const me = active(tg);
    me.hp = me.maxHp * 0.5;
    p.party[1].hp = p.party[1].maxHp * 0.5;
    clearFloor(tg);
    expect(me.hp / me.maxHp).toBeCloseTo(0.5, 5);
    expect(p.party[1].hp / p.party[1].maxHp).toBeCloseTo(0.5, 5);
  });

  it('원정: every stage starts at 80 % HP instead', () => {
    const tg = makeGame({ players: [HUMAN], expedition: { stage: 2, carry: [{ rewards: [{ rewardId: 'blood_contract_epic', partyIndex: null }], goedamTraces: [], ult: [0, 0, 0] }] } });
    const p = P(tg);
    for (const m of p.party) expect(m.hp / m.maxHp).toBeCloseTo(0.8, 5);
    expect(active(tg).hp / active(tg).maxHp).toBeCloseTo(0.8, 5);
  });
});

describe('동전 던지기 (coin)', () => {
  it('each drag: heads ×1.8 or tails ×0.5 damage (heal untouched), on the run rng, same seed same faces', () => {
    const faces = (seed: number) => {
      const tg = setup({ seed });
      grant(tg, 'coin_common');
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        clearEvents(tg);
        const mods = rwOnAppear(tg.w, P(tg), appearInfo(tg));
        const text = procs(tg, 'coin')[0].text!;
        expect(mods.dmgMult).toBe(text === '앞면' ? 1.8 : 0.5);
        expect(mods.healMult).toBe(1);
        out.push(text);
      }
      return out;
    };
    const a = faces(5);
    expect(new Set(a)).toEqual(new Set(['앞면', '뒷면']));
    expect(faces(5)).toEqual(a);
  });
});

describe('서두르는 대가 · 피의 등장 (HP costs)', () => {
  it('서두르는 대가: cooldown −25 % (min 4); the leaver pays 8 % max HP, 16 % with a bench healer', () => {
    const base = setup();
    swap(base, 1, { x: 2, y: 0 });
    const plain = P(base).party[0].swapCooldownRemaining;

    const tg = setup();
    const p = P(tg);
    grant(tg, 'haste_cost_rare');
    const hp0 = active(tg).hp;
    swap(tg, 1, { x: 2, y: 0 });
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(Math.max(4, plain * 0.75), 5);
    expect(hp0 - p.party[0].hp).toBeCloseTo(p.party[0].maxHp * 0.08, 5);

    const med = setup({ players: [party(['guardian', 'medic', 'mage'])] });
    grant(med, 'haste_cost_rare');
    const m0 = active(med).hp;
    swap(med, 2, { x: 2, y: 0 });
    expect(m0 - P(med).party[0].hp).toBeCloseTo(P(med).party[0].maxHp * 0.16, 5);
  });

  it('피의 등장: appearing costs 10 % max HP, drag damage / heal +30 %; never below 1 HP', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'blood_entry_rare');
    swap(tg, 1, { x: 2, y: 0 });
    const e = active(tg);
    expect(e.maxHp - e.hp).toBeCloseTo(e.maxHp * 0.1, 3);
    const mods = rwOnAppear(tg.w, p, appearInfo(tg));
    expect(mods.dmgMult).toBeCloseTo(1.3, 9);
    expect(mods.healMult).toBeCloseTo(1.3, 9);
    e.hp = 1;
    rwOnAppear(tg.w, p, appearInfo(tg));
    expect(e.hp).toBe(1);
  });

  it('#저주 set (3 curse tags) halves the HP costs', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'haste_cost_rare');
    grant(tg, 'coin_common');
    grant(tg, 'ledge_rare');
    expect(tagActive(p, 'curse')).toBe(true);
    const hp0 = active(tg).hp;
    swap(tg, 1, { x: 2, y: 0 });
    expect(hp0 - p.party[0].hp).toBeCloseTo(p.party[0].maxHp * 0.08 * TAG_BONUS.curse.costMult, 5);
  });
});

describe('옥상 난간 위 · 최후의 1인 (conditional stats)', () => {
  it('ledge: ≤ 50 % HP atk +20 %; ≤ 25 % atk +45 % and crit +15 %', () => {
    const tg = setup();
    grant(tg, 'ledge_rare');
    const e = active(tg);
    const base = atk(tg);
    const crit0 = effStats(tg.w, e).critChance;
    e.hp = e.maxHp * 0.4;
    expect(atk(tg) / base).toBeCloseTo(1.2 / 1, 5);
    e.hp = e.maxHp * 0.2;
    expect(atk(tg) / base).toBeCloseTo(1.45, 5);
    expect(effStats(tg.w, e).critChance).toBeCloseTo(crit0 + 0.15, 9);
    e.hp = e.maxHp * 0.9;
    expect(atk(tg)).toBeCloseTo(base, 9);
  });

  it('last_one: one living member → atk +50 % (+15 % per other player out), damage taken −20 %', () => {
    const tg = setup({ players: [HUMAN, HUMAN2, HUMAN3] });
    const p = P(tg);
    grant(tg, 'last_one_rare');
    const base = atk(tg);
    expect(rwTakenMult(tg.w, active(tg), p)).toBe(1);
    p.party[1].dead = true;
    p.party[1].hp = 0;
    expect(atk(tg)).toBeCloseTo(base, 9);
    p.party[2].dead = true;
    p.party[2].hp = 0;
    expect(atk(tg) / base).toBeCloseTo(1.5, 5);
    expect(rwTakenMult(tg.w, active(tg), p)).toBeCloseTo(0.8, 9);
    P(tg, 1).out = true;
    expect(atk(tg) / base).toBeCloseTo(1.65, 5);
  });
});

describe('굶주린 펫 · 영혼 담보 대출 (pet / ult costs)', () => {
  it('hungry_pet: pet power +60 %, the field character pays 6 % max HP per use (no bench-heal doubling)', () => {
    const tg = setup({ players: [party(['guardian', 'medic', 'mage'])] });
    const p = P(tg);
    grant(tg, 'hungry_pet_rare');
    const e = active(tg);
    const hp0 = e.hp;
    expect(rwOnPet(tg.w, p, 0, { x: 2, y: 0 }).power).toBeCloseTo(1.6, 9);
    expect(hp0 - e.hp).toBeCloseTo(e.maxHp * 0.06, 5);
  });

  it('soul_loan: ult ×1.6 and charge ×1.2; the cast costs 20 % of the current HP', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'soul_loan_epic');
    expect(rwUltMult(p, 0)).toBeCloseTo(1.6, 9);
    expect(rwChargeMult(p, 0)).toBeCloseTo(1.2, 9);
    const e = active(tg);
    e.hp = e.maxHp * 0.5;
    const hp0 = e.hp;
    expect(ult(tg).ok).toBe(true);
    expect(hp0 - e.hp).toBeCloseTo(hp0 * 0.2, 3);
    expect(procs(tg, 'soul_loan').length).toBe(1);
  });
});

describe('붉은 달 (red_moon)', () => {
  it('boss floors: ×1.4 to an enraged boss, groggy ×1.5, my characters take ×1.15; nothing on normal floors', () => {
    const tg = setup({ floor: 5 });
    const p = P(tg);
    grant(tg, 'red_moon_epic');
    const boss = getEntity(tg.w, tg.w.state.bossId)!;
    const src = { casterId: null, team: 'ally' as const, player: 0, source: 'basic' as const, isDrag: false };
    expect(rwDealtMult(tg.w, src, boss)).toBe(1);
    enrage(tg.w);
    expect(boss.enraged).toBe(true);
    expect(rwDealtMult(tg.w, src, boss)).toBeCloseTo(1.4, 9);
    expect(rwGroggyMult(tg.w, charCtx(tg.w, active(tg), 'drag', null))).toBeCloseTo(1.5, 9);
    expect(rwTakenMult(tg.w, active(tg), p)).toBeCloseTo(1.15, 9);

    const n = setup({ floor: 4 });
    grant(n, 'red_moon_epic');
    expect(rwTakenMult(n.w, active(n), P(n))).toBe(1);
    expect(rwGroggyMult(n.w, charCtx(n.w, active(n), 'drag', null))).toBe(1);
  });
});

describe('마감 직전 (deadline)', () => {
  it('≤ 40 s left / enraged boss / boss ≤ 50 % → aspd +30 %, cooldowns set meanwhile −30 % (min 4)', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'deadline_rare');
    swap(tg, 1, { x: 2, y: 0 });
    const plain = p.party[0].swapCooldownRemaining;
    const sp0 = effStats(tg.w, active(tg)).atkSpeed;
    expect(deadlineOn(tg.w)).toBe(false);
    tg.w.state.plan.timeLimit = tg.w.state.floorTime + 39;
    advance(tg, 0.1);
    expect(deadlineOn(tg.w)).toBe(true);
    expect(procs(tg, 'deadline').map(e => e.text)).toEqual(['마감!']);
    expect(effStats(tg.w, active(tg)).atkSpeed - sp0).toBeCloseTo(active(tg).rt.base.atkSpeed * 0.3, 5);
    swap(tg, 2, { x: 2, y: 0 });
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(Math.max(4, plain * 0.7), 5);

    const boss = setup({ floor: 5 });
    expect(deadlineOn(boss.w)).toBe(false);
    const b = getEntity(boss.w, boss.w.state.bossId)!;
    b.hp = b.maxHp * 0.5;
    expect(deadlineOn(boss.w)).toBe(true);
  });
});

// ─────────────────────────── economy (screens) ───────────────────────────

describe('상자 속 상자 · 빚쟁이의 방문 · 욕심쟁이 계약서 (economy)', () => {
  it('상자: the next normal screen’s cards one rarity up (once)', () => {
    const tg = setup();
    grant(tg, 'box_in_box_common');
    expect(P(tg).rewardState?.boxBump).toBe(1);
    const offers = clearFloor(tg)!;
    expect(offers.some(o => o.rarityBumped)).toBe(true);
    expect(offers.every(o => o.rarity !== 'common' || !getFamily(o.family!).params.rare)).toBe(true);
    expect(P(tg).rewardState?.boxBump).toBe(0);
    pickAndGo(tg);
    expect(clearFloor(tg)!.some(o => o.rarityBumped)).toBe(false);
  });

  it('빚: one epic now, the next 2 normal screens skipped (with a toast), the third shows', () => {
    const tg = setup();
    const p = P(tg);
    const n0 = p.rewards.length;
    grant(tg, 'debt_rare');
    expect(p.rewards.length).toBe(n0 + 2);
    expect(getReward(p.rewards[p.rewards.length - 1].rewardId).rarity).toBe('epic');
    expect(p.rewardState?.debt).toBe(2);
    clearEvents(tg);
    expect(clearFloor(tg)).toBeNull();
    expect(procs(tg, 'debt').map(e => e.text)).toEqual(['빚 · 이번 보상 없음 (1층 남음)']);
    pickAndGo(tg);
    expect(clearFloor(tg)).toBeNull();
    pickAndGo(tg);
    expect(clearFloor(tg)?.length).toBe(3);
    expect(p.rewardState?.debt).toBe(0);
  });

  it('빚 never skips a relic screen (classic boss floor)', () => {
    const tg = setup({ floor: 5 });
    grant(tg, 'debt_rare');
    const offers = clearFloor(tg)!;
    expect(offers.some(o => o.isRelic)).toBe(true);
    expect(P(tg).rewardState?.debt).toBe(2);
  });

  it('욕심: the next screen 4 cards / pick 2, the one after as usual (the contract’s own screen is its cost)', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'greedy_rare');
    const offers = clearFloor(tg)!;
    expect(offers.length).toBe(4);
    expect(p.rewardPicksLeft).toBe(2);
    const n0 = p.rewards.length;
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(tg.w.state.rewardOffersByPlayer[0]?.length).toBe(3);
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(p.rewards.length).toBe(n0 + 2);
    pickAndGo(tg);
    clearEvents(tg);
    expect(clearFloor(tg)?.length).toBe(3);
    expect(procs(tg, 'greedy').length).toBe(0);
  });

  it('economy cards are never offered while their effect is pending', () => {
    const tg = setup();
    const p = P(tg);
    p.rewardState = { boxBump: 1, debt: 0, greedyPicks: 2 };
    const seen = new Set<string>();
    for (let k = 0; k < 300; k++) for (const o of rollOffers(tg.w, p, false, { rollNo: k })) seen.add(o.family!);
    expect(seen.has('box_in_box')).toBe(false);
    expect(seen.has('greedy')).toBe(false);
    expect(seen.has('debt')).toBe(true);
  });
});

// ─────────────────────────── 멀티 협동 ───────────────────────────

describe('팀 릴레이 (team_relay)', () => {
  it('I swap within 2 s of another player → both get drag +25 % / radius +20 % and ult +5 %; ICD 8 s', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    const [a, b] = [P(tg, 0), P(tg, 1)];
    grant(tg, 'team_relay_rare');
    grant(tg, 'atk_common', 1); // the partner needs a reward for its hooks to run
    expect(swap(tg, 1, { x: 6, y: 0 }, 1).ok).toBe(true);
    advance(tg, 1);
    const u0 = { a: a.party[2].ult.charge, b: b.party[1].ult.charge };
    clearEvents(tg);
    expect(swap(tg, 2, { x: 2, y: 0 }, 0).ok).toBe(true);
    expect(procs(tg, 'team_relay').map(e => e.player).sort()).toEqual([0, 1]);
    expect(a.party[2].ult.charge - u0.a).toBeCloseTo(0.05, 2);
    expect(b.party[1].ult.charge - u0.b).toBeCloseTo(0.05, 2);
    // the partner's next drag
    const mods = rwOnAppear(tg.w, b, appearInfo(tg, 1));
    expect(mods.dmgMult).toBeCloseTo(1.25, 9);
    expect(mods.radiusMult).toBeCloseTo(1.2, 9);
    expect(rwOnAppear(tg.w, b, appearInfo(tg, 1)).dmgMult).toBe(1); // used up
    // ICD: again within 8 s → nothing
    swap(tg, 2, { x: 6, y: 0 }, 1);
    clearEvents(tg);
    swap(tg, 0, { x: 2, y: 0 }, 0);
    expect(procs(tg, 'team_relay').length).toBe(0);
  });

  it('later than 2 s → nothing', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'team_relay_rare');
    swap(tg, 1, { x: 6, y: 0 }, 1);
    advance(tg, 2.2);
    clearEvents(tg);
    swap(tg, 2, { x: 2, y: 0 }, 0);
    expect(procs(tg, 'team_relay').length).toBe(0);
  });
});

describe('합동 의식 (joint_rite)', () => {
  it('two drops within 3 and 1.5 s → a 250 % blast at the midpoint + groggy; far apart → nothing', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'joint_rite_rare');
    const foe = spawnAt(tg, 'goblin', { x: 3, y: 3 });
    foe.hp = foe.maxHp = 1e6;
    swap(tg, 1, { x: 2, y: 3 }, 0);
    advance(tg, 0.5);
    clearEvents(tg);
    swap(tg, 1, { x: 4, y: 3 }, 1);
    const casts = eventsOf(tg, 'skillCast').filter(e => e.skillId === 'joint_rite');
    expect(casts.length).toBe(1);
    expect(casts[0].center).toEqual({ x: 3, y: 3 });
    expect(foe.hp).toBeLessThan(1e6);
    expect(procs(tg, 'joint_rite').length).toBe(1);

    const far = setup({ players: [HUMAN, HUMAN2] });
    grant(far, 'joint_rite_rare');
    swap(far, 1, { x: -6, y: 0 }, 0);
    swap(far, 1, { x: 6, y: 0 }, 1);
    expect(procs(far, 'joint_rite').length).toBe(0);
  });

  it('works the other way round (another player drops first, I land next to it)', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'joint_rite_rare');
    swap(tg, 1, { x: 4, y: 0 }, 1);
    advance(tg, 1);
    swap(tg, 1, { x: 2, y: 0 }, 0);
    expect(procs(tg, 'joint_rite').length).toBe(1);
  });
});

describe('삼인 분향 (three_incense)', () => {
  it('every player swaps within 5 s → enemies stunned (not the boss) and +20 % taken for 4 s; once per floor', () => {
    const tg = setup({ players: [HUMAN, HUMAN2, HUMAN3] });
    grant(tg, 'three_incense_legendary');
    const foe = spawnAt(tg, 'goblin', { x: 9, y: 4 });
    foe.hp = foe.maxHp = 1e6;
    swap(tg, 1, { x: 2, y: 0 }, 0);
    swap(tg, 1, { x: 2, y: 1 }, 1);
    expect(procs(tg, 'three_incense').length).toBe(0);
    advance(tg, 2);
    swap(tg, 1, { x: 2, y: -1 }, 2);
    expect(procs(tg, 'three_incense').length).toBe(1);
    expect(foe.statuses.find(s => s.id === 'stun')?.remaining).toBeCloseTo(1.5, 5);
    expect(foe.statuses.find(s => s.id === 'vulnerable')?.value).toBeCloseTo(0.2, 9);
    // once per team per floor
    swap(tg, 2, { x: 2, y: 0 }, 0);
    swap(tg, 2, { x: 2, y: 1 }, 1);
    swap(tg, 2, { x: 2, y: -1 }, 2);
    expect(procs(tg, 'three_incense').length).toBe(1);
  });

  it('boss floor: the boss is not stunned but takes +20 %, its groggy gauge gains 25 % (reward cap 30 % per cycle)', () => {
    const tg = setup({ players: [HUMAN, HUMAN2], floor: 5 });
    grant(tg, 'three_incense_legendary');
    const boss = getEntity(tg.w, tg.w.state.bossId)!;
    const g = tg.w.state.bossGroggy!;
    g.fill = 0;
    tg.w.groggy.rewardGain = 0;
    swap(tg, 1, { x: 2, y: 0 }, 0);
    const before = g.fill;
    swap(tg, 1, { x: 2, y: 1 }, 1);
    expect(procs(tg, 'three_incense').length).toBe(1);
    expect(boss.statuses.some(st => st.id === 'stun')).toBe(false);
    expect(boss.statuses.find(st => st.id === 'vulnerable')?.value).toBeCloseTo(0.2, 9);
    expect(g.fill - before).toBeCloseTo(0.25, 3);
    expect(tg.w.groggy.rewardGain).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('an out player is left out (2 left = both must swap); 5 s apart → nothing', () => {
    const tg = setup({ players: [HUMAN, HUMAN2, HUMAN3] });
    grant(tg, 'three_incense_legendary');
    P(tg, 2).out = true;
    swap(tg, 1, { x: 2, y: 0 }, 0);
    advance(tg, 5.2);
    swap(tg, 1, { x: 2, y: 1 }, 1);
    expect(procs(tg, 'three_incense').length).toBe(0);
    swap(tg, 2, { x: 2, y: 0 }, 0);
    expect(procs(tg, 'three_incense').length).toBe(1);
  });
});

describe('빨간 실 · 대신 맞아 줄게 · 손 내밀기 · 나눠 쓰는 영혼 · 피의 서약', () => {
  it('빨간 실: another player appears → my field shield 8 % (tank 12 %) 3 s, ICD 6 s', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'red_thread_common');
    const me = active(tg); // guardian (tank)
    swap(tg, 1, { x: 4, y: 0 }, 1);
    expect(me.shield).toBeCloseTo(me.maxHp * 0.12, 3);
    me.shield = 0;
    swap(tg, 2, { x: 4, y: 0 }, 1);
    expect(me.shield).toBe(0);
    advance(tg, 6.1);
    swap(tg, 1, { x: 2, y: 0 }, 0); // blade (melee)
    swap(tg, 0, { x: 4, y: 0 }, 1);
    expect(active(tg).shield).toBeCloseTo(active(tg).maxHp * 0.08, 3);
  });

  it('대신 맞아 줄게: my tank appears → others’ field shield 15 % 4 s, enemies within 4 taunted 3 s', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'stand_in_rare');
    swap(tg, 1, { x: 2, y: 0 }, 0);
    const foe = spawnAt(tg, 'goblin', { x: 3, y: 0 });
    const other = active(tg, 1);
    other.shield = 0;
    swap(tg, 0, { x: 2, y: 0 }, 0);
    expect(other.shield).toBeCloseTo(other.maxHp * 0.15, 3);
    expect(foe.statuses.find(s => s.id === 'taunt')?.remaining).toBeCloseTo(3, 5);
    other.shield = 0;
    swap(tg, 2, { x: 2, y: 0 }, 0); // not a tank
    expect(other.shield).toBe(0);
  });

  it('손 내밀기: drop within 3 of another player → their revive waits −50 %, they come back at 50 % HP', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'helping_hand_rare');
    const q = P(tg, 1);
    q.party[2].dead = true;
    q.party[2].hp = 0;
    q.party[2].reviveRemaining = 10;
    const other = active(tg, 1);
    swap(tg, 1, { x: other.pos.x + 1, y: other.pos.y }, 0);
    expect(q.party[2].reviveRemaining).toBeCloseTo(5, 9);
    expect(eventsOf(tg, 'reviveCut').some(e => e.player === 1 && e.from === 0)).toBe(true);
    advance(tg, 5.2);
    expect(q.party[2].dead).toBe(false);
    expect(q.party[2].hp / q.party[2].maxHp).toBeCloseTo(0.5, 5);
  });

  it('나눠 쓰는 영혼: my ult → every other field character’s ult +12 %; mine restarts at 15 %', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'shared_soul_common');
    const other = P(tg, 1).party[P(tg, 1).activeIndex!].ult;
    other.charge = 0.2;
    expect(ult(tg).ok).toBe(true);
    expect(other.charge).toBeCloseTo(0.32, 3);
    expect(P(tg).party[0].ult.charge).toBeCloseTo(0.15, 3);
  });

  it('피의 서약: appear near another player at ≤ 30 % HP → give 25 % of my current HP, they heal ×1.5', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'blood_oath_common');
    const other = active(tg, 1);
    other.hp = other.maxHp * 0.25;
    const before = other.hp;
    swap(tg, 1, { x: other.pos.x + 1, y: other.pos.y }, 0);
    const me = active(tg);
    const given = me.maxHp - me.hp;
    expect(given).toBeCloseTo(me.maxHp * 0.25, 3);
    expect(other.hp - before).toBeCloseTo(Math.min(other.maxHp - before, given * 1.5), 3);
    // a healthy partner → nothing
    other.hp = other.maxHp;
    advance(tg, 10.1);
    const hp0 = active(tg).hp;
    swap(tg, 2, { x: other.pos.x + 1, y: other.pos.y }, 0);
    expect(active(tg).hp).toBeCloseTo(active(tg).maxHp, 3);
    void hp0;
  });
});

describe('set bonuses #협동 · #성장', () => {
  it('#협동: atk +10 % while another player’s field character is within 5', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    for (const id of ['red_thread_common', 'shared_soul_common', 'blood_oath_common']) grant(tg, id);
    expect(tagActive(P(tg), 'coop')).toBe(true);
    const me = active(tg);
    const other = active(tg, 1);
    other.pos = { x: me.pos.x + 20, y: me.pos.y };
    const far = atk(tg);
    other.pos = { x: me.pos.x + 3, y: me.pos.y };
    expect(atk(tg) / far).toBeCloseTo(1.1, 5);
  });

  it('#성장: every floor start my 3 members’ ult +10 %', () => {
    const tg = setup();
    const p = P(tg);
    grant(tg, 'nails_rare');
    grant(tg, 'nails_epic');
    grant(tg, 'candles_rare');
    expect(tagActive(p, 'growth')).toBe(true);
    clearFloor(tg);
    for (const m of p.party) m.ult.charge = 0;
    pickAndGo(tg);
    for (const m of p.party) expect(m.ult.charge).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });
});

// ─────────────────────────── render ───────────────────────────

describe('render (rewardFx/rules.ts)', () => {
  it('coin face, red thread and rite link are kept briefly and drawn without throwing', async () => {
    const { RULES_FX, rulesFxMarks } = await import('../../src/render/rewardFx/rules');
    const calls: string[] = [];
    const host = { burst: () => calls.push('burst'), ring: () => calls.push('ring'), flash: () => calls.push('flash'), shake: () => calls.push('shake') };
    const tg = setup({ players: [HUMAN, HUMAN2] });
    const s = tg.w.state;
    const view = { cam: null, localPlayer: 0, host, state: s };
    const me = active(tg);
    const other = active(tg, 1);
    RULES_FX.onEvent({ type: 'appear', player: 1, partyIndex: 0, entityId: other.id, pos: { ...other.pos } }, view);
    RULES_FX.onEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: me.id, rewardId: 'red_thread', pos: { ...me.pos } }, view);
    RULES_FX.onEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: me.id, rewardId: 'coin', pos: { ...me.pos }, text: '앞면' }, view);
    RULES_FX.onEvent({ type: 'appear', player: 0, partyIndex: 0, entityId: me.id, pos: { x: 2, y: 0 } }, view);
    RULES_FX.onEvent({ type: 'rewardProc', player: 0, partyIndex: null, entityId: null, rewardId: 'joint_rite', pos: { x: 3, y: 0 } }, view);
    expect(rulesFxMarks()).toEqual({ coins: 1, threads: 1, links: 1 });
    expect(calls).toContain('ring');
    const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: (t, k, v) => ((t[k as string] = v), true) });
    const cam = { sx: (x: number) => x * 40, sy: (y: number) => y * 30 };
    RULES_FX.draw(ctx as unknown as CanvasRenderingContext2D, s, { ...view, cam: cam as never }, 1);
    s.time += 3;
    RULES_FX.draw(ctx as unknown as CanvasRenderingContext2D, s, { ...view, cam: cam as never }, 2);
    expect(rulesFxMarks()).toEqual({ coins: 0, threads: 0, links: 0 });
  });
});

// ─────────────────────────── determinism / bots ───────────────────────────

describe('determinism', () => {
  it('bots with every Track C reward: same seed → the same fight', () => {
    const run = () => {
      const tg = makeGame({ seed: 31, players: [HUMAN, { ...HUMAN2, isBot: true }, { ...HUMAN3, isBot: true }] });
      for (const p of tg.w.state.players) for (const f of RULES_FAMILIES) {
        const r = REWARDS.find(x => x.family === f.key)!;
        if (r.target === 'self') continue;
        tg.game.dispatch({ type: 'debug', action: { kind: 'grantReward', rewardId: r.id, member: r.target === 'member' ? 1 : null, player: p.id } });
      }
      advance(tg, 40);
      const s = tg.w.state;
      return JSON.stringify([s.time, s.floor, s.players.map(p => [p.stats, p.rewardState, p.party.map(m => [Math.round(m.hp), m.dragCharges])])]);
    };
    expect(run()).toBe(run());
  });

  it('a seat with no Track C reward is untouched by them (rewardCount guards)', () => {
    const tg = setup({ players: [HUMAN, HUMAN2] });
    grant(tg, 'atk_common', 1);
    for (const f of RULES_FAMILIES) expect(rewardCount(P(tg, 1), f.key)).toBe(0);
    const a0 = atk(tg, 1);
    grant(tg, 'ledge_rare', 0);
    active(tg, 1).hp = active(tg, 1).maxHp * 0.2;
    expect(atk(tg, 1)).toBeCloseTo(a0, 9);
    void applyDamage;
  });
});
