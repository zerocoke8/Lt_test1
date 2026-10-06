// 기획 14차 교체 에너지 (test toggle Tunables.swapEnergyMode) — src/sim/energy.ts.
import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { CHARACTERS, getCharacter } from '../../src/data';
import { applyReward } from '../../src/sim/fieldEvents';
import { killEntity } from '../../src/sim/combat';
import { tick } from '../../src/sim/game';
import { canSwapState } from '../../src/sim/players';
import { canAffordSwap, cardReady, ENERGY, energyMode, energySecondsTo, swapCostNow, swapEnergyCost } from '../../src/sim/energy';
import type { Tunables } from '../../src/types';
import { active, advance, BOT1, BOT2, clearEvents, eventsOf, HUMAN, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const ON: Partial<Tunables> = { swapEnergyMode: true };
const AT = { x: 12, y: 6 };

function game(t: Partial<Tunables> = ON, chars = HUMAN.characters, pets = HUMAN.pets): TestGame {
  const tg = makeGame({ players: [{ ...HUMAN, characters: chars, pets }], tunables: t });
  quietFloor(tg);
  return tg;
}

const pool = (tg: TestGame, pi = 0) => tg.w.state.players[pi].energy!.value;
const swap = (tg: TestGame, idx: number) => tg.game.dispatch({ type: 'swap', player: 0, partyIndex: idx, pos: AT });
/** Skip the 0.5 s appear lock without regen: the lock is the only thing in the way. */
const unlock = (tg: TestGame) => (tg.w.state.players[0].appearLock = 0);

describe('기획 14차 교체 에너지 — data', () => {
  it('every character costs a whole 4–8 (from the measured drag value per cast)', () => {
    for (const c of CHARACTERS) {
      expect(Number.isInteger(c.swapEnergy), c.id).toBe(true);
      expect(c.swapEnergy, c.id).toBeGreaterThanOrEqual(4);
      expect(c.swapEnergy, c.id).toBeLessThanOrEqual(8);
    }
    // the strongest measured drag costs the most, the cheapest ones the least (docs/balance.md 13-4)
    expect(getCharacter('paladin').swapEnergy).toBe(7);
    expect(getCharacter('berserker').swapEnergy).toBe(7);
    expect(getCharacter('ranger').swapEnergy).toBe(5);
  });
});

describe('기획 14차 교체 에너지 — off (default)', () => {
  it('no pool on the state; cooldowns as today; the energy sliders change nothing', () => {
    const tg = game({ swapEnergyMax: 4, swapEnergyRegen: 3 });
    const p = tg.w.state.players[0];
    expect(energyMode(p)).toBe(false);
    expect('energy' in p).toBe(false);
    expect(swap(tg, 1).ok).toBe(true);
    expect(p.party[0].swapCooldownRemaining).toBe(getCharacter('guardian').swapCooldown);
    unlock(tg);
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    expect(cardReady(p, 0)).toBe(false);
    expect(canAffordSwap(p, 0)).toBe(true);
  });
});

describe('기획 14차 교체 에너지 — on', () => {
  it('the run starts full; a swap spends the card\'s cost; no re-appear cooldown — the card that left may come back at once', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    expect(p.energy).toEqual({ value: 10, max: 10, regen: 1 });
    expect(swap(tg, 1).ok).toBe(true); // 블레이드 6
    expect(pool(tg)).toBe(4);
    expect(p.party[0].swapCooldownRemaining).toBe(0);
    // short of energy is the more useful reason; with enough energy the 0.5 s appear lock still stays
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '에너지 부족' });
    p.energy!.value = 10;
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '등장 중' });
    p.energy!.value = 4;
    advance(tg, 0.5);
    expect(pool(tg)).toBeCloseTo(4.5, 6);
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '에너지 부족' }); // 가디언 6
    advance(tg, 1.5);
    expect(pool(tg)).toBeCloseTo(6, 6);
    expect(swap(tg, 0).ok).toBe(true); // the guardian is back 2 s after it left
    expect(pool(tg)).toBeCloseTo(0, 6);
    expect(p.stats.swaps).toBe(2);
  });

  it('refusal reason: 에너지 부족 (a dead card says 사망, the field card 이미 필드에 있음 first)', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    p.energy!.value = 2;
    expect(tg.game.canSwap(0, 1)).toEqual({ ok: false, reason: '에너지 부족' });
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: AT })).toEqual({ ok: false, reason: '에너지 부족' });
    expect(pool(tg)).toBe(2); // a refused swap costs nothing
    expect(tg.game.canSwap(0, 0).reason).toBe('이미 필드에 있음');
    p.party[2].dead = true;
    expect(tg.game.canSwap(0, 2).reason).toBe('사망');
    expect(energySecondsTo(p, 1, 1)).toBeCloseTo(4, 6);
    expect(energySecondsTo(p, 1, 0)).toBe(Infinity);
  });

  it('regen: +swapEnergyRegen per second up to swapEnergyMax; only in combat; not while out', () => {
    const tg = game({ ...ON, swapEnergyMax: 15, swapEnergyRegen: 2 });
    const p = tg.w.state.players[0];
    expect(p.energy).toEqual({ value: 15, max: 15, regen: 2 }); // the pool carries the regen slider (client checks)
    p.energy!.value = 0;
    advance(tg, 3);
    expect(pool(tg)).toBeCloseTo(6, 6);
    advance(tg, 10);
    expect(pool(tg)).toBe(15); // capped
    p.energy!.value = 1;
    p.out = true;
    advance(tg, 3);
    expect(pool(tg)).toBe(1);
    p.out = false;
    // time is frozen outside combat (reward, 괴담 room): tick() returns before the players tick
    tg.w.state.phase = 'reward';
    tick(tg.w);
    expect(pool(tg)).toBe(1);
  });

  it('the max slider: lowering clamps the pool, raising does not refill it; a cost above max costs the whole (full) pool', () => {
    const tg = game({ ...ON, swapEnergyRegen: 0 });
    const p = tg.w.state.players[0];
    tg.game.tunables.swapEnergyMax = 4; // the solo debug panel edits in place
    tick(tg.w);
    expect(p.energy).toEqual({ value: 4, max: 4, regen: 0 });
    expect(swapCostNow(p, 1)).toBe(4); // 블레이드 6 > max 4 → the full pool
    expect(swap(tg, 1).ok).toBe(true);
    expect(pool(tg)).toBe(0);
    expect(tg.game.dispatch({ type: 'tunables', patch: { swapEnergyMax: 12 } }).ok).toBe(true);
    expect(p.energy).toEqual({ value: 0, max: 12, regen: 0 });
  });

  it('carries over between floors; a player revived at a floor start starts full', () => {
    const tg = makeGame({ players: [HUMAN, BOT1], tunables: { ...ON, swapEnergyRegen: 0, invincible: false } });
    quietFloor(tg);
    const [p, b] = tg.w.state.players;
    p.energy!.value = 3;
    b.energy!.value = 2;
    b.out = true;
    for (const m of b.party) {
      m.dead = true;
      m.hp = 0;
    }
    b.activeIndex = null;
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    if (tg.w.state.phase === 'reward') tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(tg.w.state.floor).toBe(2);
    expect(p.energy!.value).toBe(3); // carried over
    expect(b.out).toBe(false);
    expect(b.energy!.value).toBe(10); // rejoined full
  });

  it('cooldown cuts become regen seconds: 크로노 정지 (4 s, every player), 시간 토끼 (4 s), 사냥꾼의 표식 (0.5 s); 크로노 균열 = a fixed 2', () => {
    const tg = game({ ...ON, swapEnergyRegen: 1.5 }, ['guardian', 'chrono', 'mage'], ['rabbit_time', 'frog_bomb', 'owl_frost']);
    const p = tg.w.state.players[0];
    p.energy!.value = 6;
    clearEvents(tg);
    expect(swap(tg, 1).ok).toBe(true); // 크로노 6 → 0, its rift gives back a fixed 2 (priced into its cost), not 2 s × 1.5
    advance(tg, 1);
    expect(eventsOf(tg, 'swapCdCut').map(e => e.seconds)).toEqual([2]);
    expect(pool(tg)).toBeCloseTo(2 + 1.5, 4); // + 1 s of regen
    expect(p.party.every(m => m.swapCooldownRemaining === 0)).toBe(true);
    // 시간 토끼: 4 s × 1.5
    p.energy!.value = 0;
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: AT }).ok).toBe(true);
    expect(pool(tg)).toBeCloseTo(6, 6);
    // 사냥꾼의 표식: 0.5 s × 1.5 per kill
    p.relics.push('hunter_mark');
    p.energy!.value = 0;
    const foe = spawnAt(tg, 'slime', { x: 13, y: 6 });
    killEntity(tg.w, foe, { player: 0, source: 'basic', casterId: active(tg).id, team: 'ally', isDrag: false } as never);
    expect(pool(tg)).toBeCloseTo(0.75, 6);
    // 크로노 정지 (ult, every player): 4 s × 1.5
    p.energy!.value = 0;
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    spawnAt(tg, 'golem', { x: 13, y: 6 });
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    clearEvents(tg);
    advance(tg, 1);
    expect(eventsOf(tg, 'swapCdCut').map(e => e.seconds)).toEqual([4]);
    expect(pool(tg)).toBeCloseTo(6 + 1.5, 4);
  });

  it('크로노\'s net swap price (cost − its own rift refund) is the same at every regen slider value', () => {
    for (const regen of [0.25, 1, 3]) {
      const tg = game({ ...ON, swapEnergyRegen: regen }, ['guardian', 'chrono', 'mage']);
      tg.w.state.players[0].energy!.value = 6;
      expect(swap(tg, 1).ok).toBe(true);
      advance(tg, 0.5); // the rift lands at once; 0.5 s of regen on top
      expect(pool(tg)).toBeCloseTo(2 + 0.5 * regen, 4);
    }
  });

  it('\'쿨 0\' = a full pool: 괴담 엘리베이터 (모든 쿨 0), 돌발 괴담 교체 쿨 0, debug 쿨 초기화', () => {
    const tg = makeGame({ players: [HUMAN], tunables: { ...ON, swapEnergyRegen: 0, goedamRoomsPerZone: 1 } });
    const p = tg.w.state.players[0];
    tg.game.dispatch({ type: 'debug', action: { kind: 'goedamNext', room: 'elevator_whisper' } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    if (tg.w.state.phase === 'reward') tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(tg.w.state.phase).toBe('goedam');
    p.energy!.value = 1;
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'ride' }).ok).toBe(true);
    expect(pool(tg)).toBe(10);
    p.energy!.value = 1;
    applyReward(tg.w, { kind: 'benchSwapReset' });
    expect(pool(tg)).toBe(10);
    p.energy!.value = 1;
    tg.w.state.phase = 'combat';
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } }).ok).toBe(true);
    expect(pool(tg)).toBe(10);
  });

  it('빠른 교대 (−v s of one card\'s re-appear cooldown, min 4 s) = that card\'s cost −v/2 s of regen', () => {
    const tg = game({ ...ON, swapEnergyRegen: 1 });
    const p = tg.w.state.players[0];
    expect(swapEnergyCost(p, 1)).toBe(6);
    p.rewards.push({ rewardId: 'swapcd_common', partyIndex: 1 }); // −1 s
    expect(swapEnergyCost(p, 1)).toBe(6 - ENERGY.rewardPerSec);
    p.rewards.push({ rewardId: 'swapcd_epic', partyIndex: 1 }); // −3 s more
    expect(swapEnergyCost(p, 1)).toBe(4);
    for (let k = 0; k < 4; k++) p.rewards.push({ rewardId: 'swapcd_epic', partyIndex: 1 }); // stops at today's 4 s floor
    expect(swapEnergyCost(p, 1)).toBe(6 - (10 - 4) * ENERGY.rewardPerSec);
    expect(swapEnergyCost(p, 2)).toBe(6); // other cards untouched
    expect(swap(tg, 1).ok).toBe(true);
    expect(pool(tg)).toBe(10 - 3);
    // the exchange rate follows the regen slider like every other cut (rule c): v/2 s × regen
    expect(tg.game.dispatch({ type: 'tunables', patch: { swapEnergyRegen: 0.5 } }).ok).toBe(true);
    expect(swapEnergyCost(p, 1)).toBe(6 - (10 - 4) * ENERGY.rewardPerSec * 0.5);
    expect(tg.game.dispatch({ type: 'tunables', patch: { swapEnergyRegen: 3 } }).ok).toBe(true);
    expect(swapEnergyCost(p, 1)).toBe(ENERGY.minCost);
  });

  it('debug 쿨타임 없음: the pool stays full and swaps are free', () => {
    const tg = game({ ...ON, instantCooldowns: true });
    expect(swap(tg, 1).ok).toBe(true);
    expect(pool(tg)).toBe(10);
  });

  it('client check on a snapshot agrees with the sim (wire rounding included)', () => {
    const tg = makeGame({ players: [HUMAN, BOT1, BOT2], tunables: { ...ON, invincible: true } });
    for (let k = 0; k < 30 * 40; k++) {
      if (tg.w.state.phase !== 'combat') break;
      tick(tg.w);
      if (k % 15 !== 0) continue;
      const snap = cleanState(tg.w.state);
      for (let pi = 0; pi < 3; pi++) {
        for (let i = 0; i < 3; i++) {
          const a = canSwapState(snap, pi, i);
          const b = tg.game.canSwap(pi, i);
          // the wire rounds the pool to 0.01: only a pool within 0.01 of a cost may read differently
          if (a.ok !== b.ok) expect(Math.abs(tg.w.state.players[pi].energy!.value - swapCostNow(tg.w.state.players[pi], i))).toBeLessThan(0.01);
          else expect(a.reason).toBe(b.reason);
        }
      }
    }
    expect(cleanState(tg.w.state).players[0].energy).toEqual({ value: expect.any(Number), max: 10, regen: 1 });
  });

  it('toggling mid-run: on → a full pool, running cooldowns dropped; off → no pool, every card ready', () => {
    const tg = game({});
    const p = tg.w.state.players[0];
    expect(swap(tg, 1).ok).toBe(true);
    expect(p.party[0].swapCooldownRemaining).toBeGreaterThan(0);
    tg.game.tunables.swapEnergyMode = true; // the solo debug panel edits in place
    tick(tg.w);
    expect(p.energy).toEqual({ value: 10, max: 10, regen: 1 });
    expect(p.party.every(m => m.swapCooldownRemaining === 0)).toBe(true);
    unlock(tg);
    expect(swap(tg, 0).ok).toBe(true);
    expect(pool(tg)).toBe(4);
    // the host's tunables command syncs at once
    expect(tg.game.dispatch({ type: 'tunables', patch: { swapEnergyMode: false } }).ok).toBe(true);
    expect('energy' in p).toBe(false);
    expect(p.party.every(m => m.swapCooldownRemaining === 0)).toBe(true);
    unlock(tg);
    expect(swap(tg, 2).ok).toBe(true); // today's rule again: the guardian leaves with its cooldown
    expect(p.party[0].swapCooldownRemaining).toBe(getCharacter('guardian').swapCooldown);
  });

  it('sanitized like every tunable (server bounds)', () => {
    const tg = game({});
    expect(tg.game.dispatch({ type: 'tunables', patch: { swapEnergyMode: 1, swapEnergyMax: 0, swapEnergyRegen: 99 } as never }).ok).toBe(true);
    expect(tg.game.tunables.swapEnergyMode).toBe(false);
    expect(tg.game.tunables.swapEnergyMax).toBe(1);
    expect(tg.game.tunables.swapEnergyRegen).toBe(20);
    expect(tg.game.dispatch({ type: 'tunables', patch: { swapEnergyMode: true, swapEnergyMax: Number.NaN } }).ok).toBe(true);
    expect(tg.game.tunables.swapEnergyMax).toBe(1);
    expect(tg.w.state.players[0].energy).toEqual({ value: 1, max: 1, regen: 20 });
  });
});

describe('기획 14차 bots with the energy pool', () => {
  it('bots swap only when the pool affords the card; emergency swaps too; the pool never goes negative', () => {
    const tg = makeGame({ seed: 9, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2], tunables: { ...ON, invincible: false } });
    const s = tg.w.state;
    let swaps = 0;
    const before = s.players.map(p => p.energy!.value);
    for (let t = 0; t < 30 * 150 && s.phase !== 'runOver'; t++) {
      if (s.phase !== 'combat') {
        for (let i = 0; i < 3; i++) if (s.rewardOffersByPlayer[i]) tg.game.dispatch({ type: 'chooseReward', player: i, offerIndex: 0 });
        if (s.phase === 'goedam') break;
        continue;
      }
      s.players.forEach((p, i) => (before[i] = p.energy!.value));
      tick(tg.w);
      for (const e of tg.game.drainEvents()) {
        if (e.type !== 'appear') continue;
        swaps++;
        const p = s.players[e.player];
        // the pool had the card's cost before this tick (+ at most one tick of regen and cut refunds)
        expect(before[e.player] + 1 / 30 + 1e-6).toBeGreaterThanOrEqual(swapCostNow(p, e.partyIndex) - 1e-6);
      }
      for (const p of s.players) {
        expect(p.energy!.value).toBeGreaterThanOrEqual(0);
        expect(p.energy!.value).toBeLessThanOrEqual(p.energy!.max + 1e-9);
        for (const m of p.party) expect(m.swapCooldownRemaining).toBe(0);
      }
    }
    expect(swaps).toBeGreaterThan(10); // bots swap every 20–30 s (BOT.periodicSwap) + emergencies
  }, 60_000);

  it('an emergency swap (field < 30 % HP) waits for the pool', () => {
    const tg = makeGame({ players: [{ ...HUMAN, isBot: true }], tunables: { ...ON, swapEnergyRegen: 0, invincible: true } });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    spawnAt(tg, 'golem', { x: 14, y: 6 });
    const e = active(tg);
    e.hp = e.maxHp * 0.1;
    p.energy!.value = 4.5;
    p.rt.bot.nextSwapAt = 1e9;
    clearEvents(tg);
    advance(tg, 2);
    expect(eventsOf(tg, 'appear')).toEqual([]);
    p.energy!.value = 6;
    e.hp = e.maxHp * 0.1; // (the guardian's passive regen moved it meanwhile)
    advance(tg, 1);
    expect(eventsOf(tg, 'appear').length).toBe(1);
    expect(p.energy!.value).toBeLessThan(1.5);
  });
});
