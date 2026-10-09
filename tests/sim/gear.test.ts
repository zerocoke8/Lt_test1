// 기획 15차 원정 모드: gear data, main stats on effStats / bench HP, per-character relics, the 12 special effects
// (docs/expedition.md 4장, 6장). The classic path (no gear) must stay exactly as it was.
import { describe, expect, it } from 'vitest';
import {
  GEAR_OPTIONS,
  RELIC_TIER_MULT,
  bandOf,
  botLoadout,
  cleanPartyGear,
  gearBandsOf,
  gearMainLines,
  gearMainMods,
  gearSpecProblem,
  maxStartStage,
  optionLevel,
  rarityWeights,
  slotWeights,
  type GearLoadout,
  type GearSpec,
} from '../../src/data/gear';
import { getCharacter } from '../../src/data';
import { normalCooldownFor, swapCooldownOf } from '../../src/sim/cooldowns';
import { charCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { benchMaxHp, effStats } from '../../src/sim/stats';
import type { PlayerSetup } from '../../src/types';
import { active, advance, clearEvents, eventsOf, killActive, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const W = (tier: number, extra: Partial<GearSpec> = {}): GearSpec => ({ slot: 'weapon', tier, rarity: 'common', ...extra });
const A = (tier: number, extra: Partial<GearSpec> = {}): GearSpec => ({ slot: 'armor', tier, rarity: 'common', ...extra });
const C = (tier: number, extra: Partial<GearSpec> = {}): GearSpec => ({ slot: 'charm', tier, rarity: 'common', ...extra });
const R = (relicId: string, tier = 3): GearSpec => ({ slot: 'relic', tier, rarity: 'common', relicId });
const set = (t: number): GearLoadout => ({ weapon: W(t), armor: A(t), charm: C(t) });

function geared(gear: GearLoadout[], chars = ['guardian', 'blade', 'mage']): PlayerSetup {
  return { name: '나', isBot: false, characters: chars, pets: ['frog_bomb', 'fairy_heal', 'golem_turret'], gear };
}

describe('gear data (4-1, 4-2)', () => {
  it('main stats follow the 4-2 table for T1..T12', () => {
    const atk = [5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38];
    const hp = [6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50];
    for (let t = 1; t <= 12; t++) {
      expect(gearMainMods(W(t)).atkPct).toBeCloseTo(atk[t - 1] / 100, 10);
      const a = gearMainMods(A(t));
      expect(a.hpPct).toBeCloseTo(hp[t - 1] / 100, 10);
      expect(a.defFlat).toBeCloseTo(0.005 * t, 10);
      const c = gearMainMods(C(t));
      expect(c.atkSpeedPct).toBeCloseTo(0.015 * t, 10);
      expect(c.critChance).toBeCloseTo(0.0075 * t, 10);
    }
    expect(gearMainMods(R('echo_seal', 12))).toEqual({});
    expect(gearMainLines(A(5))).toEqual(['최대 HP +22%', '받는 피해 −2.5%']);
    expect(gearMainLines(C(3))).toEqual(['공격 속도 +4.5%', '치명타 +2.5%p']);
  });

  it('epic gear has main stats ×1.2', () => {
    expect(gearMainMods(W(10, { rarity: 'epic', optionId: 'w_scorch' })).atkPct).toBeCloseTo(0.32 * 1.2, 10);
    expect(gearMainMods(A(4, { rarity: 'epic', optionId: 'a_evac' })).hpPct).toBeCloseTo(0.18 * 1.2, 10);
    expect(gearMainMods(W(10, { rarity: 'rare', optionId: 'w_scorch' })).atkPct).toBeCloseTo(0.32, 10);
  });

  it('bands: 0 none, 1..3 → 1, 4..6 → 2, 7..9 → 3, 10..12 → 4; option level by tier', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(bandOf)).toEqual([0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect(bandOf(undefined)).toBe(0);
    expect([4, 6, 7, 9, 10, 12].map(optionLevel)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(GEAR_OPTIONS.map(o => o.id).sort()).toEqual(
      ['a_appear_shield', 'a_drop_shield', 'a_evac', 'a_heal_echo', 'c_normal_haste', 'c_quick_swap', 'c_rested_rage', 'c_ult_charge', 'w_appear_bolt', 'w_execute', 'w_relay_blast', 'w_scorch'].sort(),
    );
    for (const o of GEAR_OPTIONS) for (const lv of [1, 2, 3] as const) expect(o.description(lv)).not.toMatch(/undefined|NaN/);
  });

  it('maxStartStage: empty slot → 1, all T1 → 2, relic ignored, min over 9 slots, cap 12', () => {
    expect(maxStartStage([{}, {}, {}])).toBe(1);
    expect(maxStartStage([set(1), set(1), set(1)])).toBe(2);
    expect(maxStartStage([set(3), set(3), { weapon: W(3), armor: A(3) }])).toBe(1);
    expect(maxStartStage([set(5), set(4), set(9)])).toBe(5);
    expect(maxStartStage([{ ...set(2), relic: R('echo_seal', 12) }, set(2), set(2)])).toBe(3);
    expect(maxStartStage([set(12), set(12), set(12)])).toBe(12);
    expect(maxStartStage([set(11), set(11), set(11)])).toBe(12);
  });

  it('slot weights lean to what the party lacks; rarity table with boss / streak shifts (T4+)', () => {
    expect(slotWeights([{}, {}, {}], 1)).toEqual({ weapon: 10, armor: 10, charm: 10 });
    expect(slotWeights([set(2), set(2), { weapon: W(2), armor: A(2) }], 2)).toEqual({ weapon: 1, armor: 1, charm: 4 });
    expect(slotWeights([set(2), set(2), set(1)], 2)).toEqual({ weapon: 4, armor: 4, charm: 4 });
    expect(rarityWeights(3, true, 3)).toEqual({ common: 100, rare: 0, epic: 0 });
    expect(rarityWeights(5, false, 0)).toEqual({ common: 65, rare: 30, epic: 5 });
    expect(rarityWeights(6, true, 0)).toEqual({ common: 50, rare: 45, epic: 5 });
    expect(rarityWeights(8, false, 5)).toEqual({ common: 15, rare: 75, epic: 10 });
    expect(rarityWeights(12, true, 3)).toEqual({ common: 0, rare: 85, epic: 15 });
  });

  it('validation: bad tier / slot / relic tier / option slot are refused; clean party gear', () => {
    expect(gearSpecProblem(W(5))).toBeNull();
    expect(gearSpecProblem(W(13))).not.toBeNull();
    expect(gearSpecProblem(W(2.5))).not.toBeNull();
    expect(gearSpecProblem({ slot: 'hat', tier: 1, rarity: 'common' })).not.toBeNull();
    expect(gearSpecProblem(R('echo_seal', 4))).not.toBeNull();
    expect(gearSpecProblem(R('nope', 3))).not.toBeNull();
    expect(gearSpecProblem(W(5, { rarity: 'rare', optionId: 'a_evac' }))).not.toBeNull();
    expect(gearSpecProblem(W(5, { rarity: 'rare', optionId: 'w_scorch' }))).toBeNull();
    // only combinations that can drop (기획 15차 review): no options below T4, rare/epic ⇔ one option, relic stars = its own
    expect(gearSpecProblem(W(1, { rarity: 'epic', optionId: 'w_execute' }))).not.toBeNull();
    expect(gearSpecProblem(W(5, { rarity: 'rare' }))).not.toBeNull();
    expect(gearSpecProblem(W(5, { optionId: 'w_scorch' }))).not.toBeNull();
    expect(gearSpecProblem({ slot: 'relic', tier: 3, rarity: 'epic', relicId: 'echo_seal' })).toBeNull();
    expect(gearSpecProblem({ slot: 'relic', tier: 3, rarity: 'rare', relicId: 'echo_seal' })).not.toBeNull();
    expect(cleanPartyGear([set(1), {}, null])).toEqual([set(1), {}, {}]);
    expect(cleanPartyGear([set(1), {}])).toBeNull();
    expect(cleanPartyGear([{ armor: W(1) }, {}, {}])).toBeNull();
    expect(cleanPartyGear([{ weapon: { ...W(1), junk: 1 } }, {}, {}])).toEqual([{ weapon: W(1) }, {}, {}]);
  });

  it('render bands: null without gear, relic icon index and band', () => {
    expect(gearBandsOf(undefined)).toBeNull();
    expect(gearBandsOf({})).toBeNull();
    expect(gearBandsOf({ weapon: W(10), relic: R('relay_flag', 6) })).toEqual({ w: 4, a: 0, c: 0, r: 2, rb: 2 });
    expect(botLoadout(1)).toEqual({});
    expect(botLoadout(5)).toEqual(set(4));
  });
});

describe('gear on the sim (stats)', () => {
  it('no gear ⇒ effStats identical to a party with empty loadouts and to the classic numbers', () => {
    const a = makeGame({ seed: 9 });
    const b = makeGame({ seed: 9, players: [geared([{}, {}, {}])] });
    expect(effStats(b.w, active(b))).toEqual(effStats(a.w, active(a)));
    expect(benchMaxHp(b.w.state.players[0], 1)).toBe(benchMaxHp(a.w.state.players[0], 1));
  });

  it('empty loadouts run bit-identical to no gear (60 s with swaps; only the gear field differs)', () => {
    const run = (tg: TestGame) => {
      for (let t = 0; t < 1800; t++) {
        if (t % 150 === 100) tg.game.dispatch({ type: 'swap', player: 0, partyIndex: ((t / 150) | 0) % 3, pos: { x: 8 + (t % 13), y: 5 } });
        if (tg.w.state.phase !== 'combat') break;
        tick(tg.w);
      }
      return JSON.stringify(tg.w.state, (k, v) => (k === 'rt' || k === 'gear' ? undefined : v));
    };
    expect(run(makeGame({ seed: 31, players: [geared([{}, {}, {}])] }))).toBe(run(makeGame({ seed: 31 })));
  });

  it('weapon / charm / armor add to the wearer only; armor HP counts on the bench', () => {
    const tg = makeGame({ players: [geared([{ weapon: W(5), charm: C(4) }, { armor: A(5) }, {}])] });
    const p = tg.w.state.players[0];
    const g = getCharacter('guardian');
    const st = effStats(tg.w, active(tg));
    expect(st.atk).toBeCloseTo(g.stats.atk * (1 + 0.17 + (g.passive.stats?.atkPct ?? 0)), 6);
    expect(st.critChance).toBeCloseTo(g.stats.critChance + 0.03 + (g.passive.stats?.critChance ?? 0), 9);
    const blade = getCharacter('blade');
    expect(benchMaxHp(p, 1)).toBeCloseTo(blade.stats.maxHp * 1.22, 6);
    expect(p.party[1].maxHp).toBeCloseTo(blade.stats.maxHp * 1.22, 6);
    expect(p.party[1].hp).toBeCloseTo(p.party[1].maxHp, 6);
    expect(benchMaxHp(p, 2)).toBe(getCharacter('mage').stats.maxHp);
    // armor damage reduction on the field
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    expect(effStats(tg.w, active(tg)).def).toBeCloseTo(Math.min(0.9, blade.stats.def + 0.025 + (blade.passive.stats?.defFlat ?? 0)), 9);
  });
});

describe('equipped relics work for their wearer only (4-4)', () => {
  it('선봉의 투구 on slot 0: +40% atk after appearing for slot 0 only, ×1.45 at T12', () => {
    const tg = makeGame({ players: [geared([{ relic: R('vanguard_helm', 12) }, {}, {}])] });
    quietFloor(tg);
    const g = getCharacter('guardian');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    const blade = getCharacter('blade');
    expect(effStats(tg.w, active(tg)).atk).toBeCloseTo(blade.stats.atk * (1 + (blade.passive.stats?.atkPct ?? 0)), 6);
    advance(tg, 12);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 12, y: 6 } });
    expect(effStats(tg.w, active(tg)).atk).toBeCloseTo(g.stats.atk * (1 + 0.4 * RELIC_TIER_MULT[12] + (g.passive.stats?.atkPct ?? 0)), 6);
  });

  it('메아리 인장 echoes only its wearer\'s drag (power × tier mult)', () => {
    const tg = makeGame({ players: [geared([{}, { relic: R('echo_seal', 9) }, {}])] });
    quietFloor(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    expect(tg.w.pending.some(p => p.kind === 'echo')).toBe(false);
    advance(tg, 12);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    const echo = tg.w.pending.find(p => p.kind === 'echo');
    expect(echo).toBeDefined();
    expect(echo!.ctx.dmgMult).toBeCloseTo(0.5 * 1.3, 9);
  });

  it('불사조 깃털: shorter revive for the wearer only', () => {
    const tg = makeGame({ players: [geared([{ relic: R('phoenix_feather', 3) }, {}, {}])] });
    quietFloor(tg);
    killActive(tg);
    const p = tg.w.state.players[0];
    expect(p.party[0].reviveRemaining).toBeCloseTo(tg.w.tunables.reviveTime * 0.6, 6);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    killActive(tg);
    expect(p.party[1].reviveRemaining).toBeCloseTo(tg.w.tunables.reviveTime, 6);
  });
});

describe('special effects (4-3)', () => {
  const opt = (slot: 'weapon' | 'armor' | 'charm', id: string, tier = 10): GearSpec => ({ slot, tier, rarity: 'rare', optionId: id });

  it('빠른 교대 / 일반스킬 가속 shorten the wearer\'s cooldowns (min 4 s)', () => {
    const tg = makeGame({ players: [geared([{ charm: opt('charm', 'c_quick_swap', 10) }, { charm: opt('charm', 'c_normal_haste', 7) }, {}])] });
    const p = tg.w.state.players[0];
    const t = tg.w.tunables;
    expect(swapCooldownOf(t, p, 0)).toBeCloseTo(Math.max(4, getCharacter('guardian').swapCooldown - 1.5), 9);
    expect(swapCooldownOf(t, p, 1)).toBe(getCharacter('blade').swapCooldown);
    expect(normalCooldownFor(t, p, 1)).toBeCloseTo((getCharacter('blade').normal.cooldown ?? 6) * 0.85, 9);
    // a common charm has no effect
    const tg2 = makeGame({ players: [geared([{ charm: { slot: 'charm', tier: 10, rarity: 'common', optionId: 'c_quick_swap' } }, {}, {}])] });
    expect(swapCooldownOf(t, tg2.w.state.players[0], 0)).toBe(getCharacter('guardian').swapCooldown);
  });

  it('등장 보호막 / 교대 충전 / 등장 에너지탄 on appear', () => {
    const tg = makeGame({
      players: [geared([{}, { armor: opt('armor', 'a_appear_shield', 4), charm: opt('charm', 'c_ult_charge', 12), weapon: opt('weapon', 'w_appear_bolt', 7) }, {}])],
    });
    quietFloor(tg);
    const a = spawnAt(tg, 'golem', { x: 11, y: 6 });
    const b = spawnAt(tg, 'golem', { x: 12, y: 6 });
    const c = spawnAt(tg, 'golem', { x: 13, y: 6 });
    const far = spawnAt(tg, 'golem', { x: 30, y: 6 });
    const hp = [a, b, c, far].map(x => x.hp);
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    const e = active(tg);
    expect(e.shield).toBeGreaterThanOrEqual(0.1 * e.maxHp - 1e-6);
    expect(tg.w.state.players[0].party[1].ult.charge).toBeCloseTo(0.08, 9);
    const bolts = eventsOf(tg, 'damage').filter(d => d.source === 'relic' && d.skillName === undefined);
    expect(bolts.length).toBeGreaterThan(0);
    expect(far.hp).toBe(hp[3]);
    expect(eventsOf(tg, 'gearProc').map(x => x.id).sort()).toEqual(['a_appear_shield', 'c_ult_charge', 'w_appear_bolt']);
  });

  it('처형 착지 kills low-HP normal enemies in radius 2 (not mid bosses)', () => {
    const tg = makeGame({ players: [geared([{}, { weapon: opt('weapon', 'w_execute', 4) }, {}])] });
    quietFloor(tg);
    const weak = spawnAt(tg, 'golem', { x: 10.5, y: 6 });
    weak.hp = weak.maxHp * 0.1;
    const healthy = spawnAt(tg, 'golem', { x: 10, y: 7 });
    const mid = spawnAt(tg, 'ogre', { x: 9.5, y: 6 });
    mid.hp = mid.maxHp * 0.05;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    expect(weak.rt.gone).toBe(true);
    expect(mid.rt.gone).toBe(false);
    expect(healthy.rt.gone || healthy.hp > 0).toBe(true);
  });

  it('교대 폭발 + 교대의 깃발 on the leaving character merge into one bigger blast', () => {
    const blastAt = (gear: GearLoadout) => {
      const tg = makeGame({ players: [geared([gear, {}, {}])] });
      quietFloor(tg);
      const e = active(tg);
      e.pos = { x: 10, y: 6 };
      const t = spawnAt(tg, 'golem', { x: 11.4, y: 6 });
      t.rt.base.def = 0;
      const ctx = charCtx(tg.w, e, 'passive', null);
      clearEvents(tg);
      tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 25, y: 6 } });
      const casts = eventsOf(tg, 'skillCast').filter(c => c.slot === 'passive');
      return { casts, atk: ctx.atk, hit: eventsOf(tg, 'damage').filter(d => d.targetId === t.id && d.source === 'relic') };
    };
    const both = blastAt({ weapon: opt('weapon', 'w_relay_blast', 4), relic: R('relay_flag', 3) });
    expect(both.casts).toHaveLength(1);
    expect(both.casts[0].area).toEqual({ shape: 'circle', radius: 2.5 });
    const flag = blastAt({ relic: R('relay_flag', 3) });
    expect(flag.casts[0].area).toEqual({ shape: 'circle', radius: 2 });
    // +50 % power (the T4 weapon also adds its +14 % attack to the wearer)
    if (!both.hit[0].crit && !flag.hit[0].crit) expect(both.hit[0].amount / flag.hit[0].amount).toBeCloseTo((1.5 * both.atk) / flag.atk, 6);
    const bl = blastAt({ weapon: opt('weapon', 'w_relay_blast', 4) });
    expect(bl.casts[0].area).toEqual({ shape: 'circle', radius: 1.5 });
  });

  it('치유의 잔향 / 버려진 방패 leave zones; 그을린 발자국 burns where it landed', () => {
    const tg = makeGame({ players: [geared([{ armor: { slot: 'armor', tier: 7, rarity: 'epic', optionId: 'a_heal_echo' } }, { weapon: opt('weapon', 'w_scorch', 7) }, {}])] });
    quietFloor(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 20, y: 6 } });
    const z = tg.w.state.zones.map(z => z.rt.ctx.skillId).sort();
    expect(z).toEqual(['a_heal_echo', 'w_scorch']);
    const tg2 = makeGame({ players: [geared([{ armor: opt('armor', 'a_drop_shield', 10) }, {}, {}])] });
    quietFloor(tg2);
    tg2.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 6 } });
    expect(tg2.w.state.zones.map(z => z.rt.ctx.skillId)).toContain('a_drop_shield');
  });

  it('응급 후송: leaving at ≤35% HP heals on the bench for 4 s (once per 20 s)', () => {
    const tg = makeGame({ players: [geared([{ armor: opt('armor', 'a_evac', 4) }, {}, {}])] });
    quietFloor(tg);
    const e = active(tg);
    e.hp = e.maxHp * 0.3;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 6 } });
    const m = tg.w.state.players[0].party[0];
    const before = m.hp;
    advance(tg, 5);
    expect(m.hp - before).toBeCloseTo(m.maxHp * 0.05 * 4, 3);
    expect(m.rt.evac).toBeUndefined();
  });

  it('오래 쉰 자의 분노: ready-time stacks raise the next drag damage', () => {
    const tg = makeGame({ players: [geared([{}, { charm: opt('charm', 'c_rested_rage', 10) }, {}])] });
    quietFloor(tg);
    advance(tg, 12);
    expect(tg.w.state.players[0].party[1].rt.rested).toBe(10);
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    expect(eventsOf(tg, 'gearProc').map(x => x.id)).toEqual(['c_rested_rage']);
    expect(tg.w.state.players[0].party[1].rt.rested).toBe(0);
  });

  it('gear damage never fills the boss groggy gauge', () => {
    const tg = makeGame({ startFloor: 5, players: [geared([{}, { weapon: opt('weapon', 'w_appear_bolt', 10) }, {}])] });
    const g = tg.w.state.bossGroggy!;
    const before = g.fill;
    clearEvents(tg);
    // dropped far below the boss: the drag itself misses it, only the bolt reaches it
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 2, y: 11 } });
    const relicHits = eventsOf(tg, 'damage').filter(d => d.source === 'relic' && d.targetId === tg.w.state.bossId);
    expect(relicHits.length).toBe(1);
    expect(eventsOf(tg, 'groggyGain')).toHaveLength(0);
    expect(g.fill).toBe(before);
  });
});
