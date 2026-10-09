// 궁극기 개별 게이지 (기획 14차 option C; the rule since 기획 15차 — the shared gauge is gone) — src/sim/ultMode.ts.
import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { addGoedamTrace } from '../../src/sim/goedam';
import { applyReward } from '../../src/sim/fieldEvents';
import { killEntity } from '../../src/sim/combat';
import { tick } from '../../src/sim/game';
import { canUltState } from '../../src/sim/players';
import { fieldUltGauge, memberUltGauge, ultFillTime, ultFocusIndex, ultSecondsLeft } from '../../src/sim/ultMode';
import type { GameState, Tunables } from '../../src/types';
import { active, advance, BOT1, BOT2, clearEvents, eventsOf, HUMAN, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

function game(t: Partial<Tunables> = {}): TestGame {
  const tg = makeGame({ players: [HUMAN], tunables: t });
  quietFloor(tg);
  return tg;
}

const charges = (tg: TestGame, pi = 0) => tg.w.state.players[pi].party.map(m => m.ult.charge);

function swap(tg: TestGame, idx: number): void {
  expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: idx, pos: { x: 12, y: 6 } })).toEqual({ ok: true });
}

describe('궁극기 개별 게이지 (기획 15차: the rule)', () => {
  it('every card has its own gauge: the field one fills in 30 s, the bench at 1/3 of that rate', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    expect(charges(tg)).toEqual([0, 0, 0]);
    expect(fieldUltGauge(p)).toBe(p.party[0].ult);
    expect('ult' in p).toBe(false); // no shared gauge
    clearEvents(tg);
    advance(tg, 15);
    expect(charges(tg)[0]).toBeCloseTo(0.5, 2);
    expect(charges(tg)[1]).toBeCloseTo(0.5 / 3, 2);
    expect(charges(tg)[2]).toBeCloseTo(0.5 / 3, 2);
    advance(tg, 15.1);
    expect(memberUltGauge(p, 0)).toEqual({ charge: 1, fullSince: expect.any(Number) });
    expect(eventsOf(tg, 'ultReady')).toEqual([{ type: 'ultReady', player: 0, partyIndex: 0 }]);
    // bench: 90 s in all
    advance(tg, 60);
    expect(charges(tg)).toEqual([1, 1, 1]);
    expect(eventsOf(tg, 'ultReady').map(e => e.partyIndex)).toEqual([0, 1, 2]);
  });

  it('the two sliders: field charge time and bench ratio (0 = the bench never fills)', () => {
    const tg = game({ ultFieldChargeTime: 10, ultBenchRatio: 0.5 });
    const p = tg.w.state.players[0];
    expect(ultFillTime(tg.game.tunables, p, 0)).toBeCloseTo(10, 9);
    expect(ultFillTime(tg.game.tunables, p, 1)).toBeCloseTo(20, 9);
    advance(tg, 10.05);
    expect(charges(tg)[0]).toBe(1);
    expect(charges(tg)[1]).toBeCloseTo(0.5, 2);
    tg.game.tunables.ultBenchRatio = 0;
    const before = charges(tg)[2]!;
    advance(tg, 5);
    expect(charges(tg)[2]).toBe(before);
    expect(ultSecondsLeft(tg.game.tunables, p, 2)).toBe(Infinity);
  });

  it('the ult casts the field character\'s gauge only; a swapped-in full card can ult right away', () => {
    const tg = game();
    const s = tg.w.state;
    const p = s.players[0];
    spawnAt(tg, 'golem', { x: 14, y: 6 });
    advance(tg, 1);
    p.party[1].ult = { charge: 1, fullSince: s.time };
    expect(tg.game.dispatch({ type: 'ult', player: 0 })).toEqual({ ok: false, reason: '게이지 부족' });
    swap(tg, 1);
    const r = tg.game.dispatch({ type: 'ult', player: 0 });
    expect(r).toEqual({ ok: true });
    expect(charges(tg)[1]).toBe(0);
    expect(charges(tg)[0]).toBeGreaterThan(0); // the benched one keeps what it had
    expect(eventsOf(tg, 'ultCast')[0].defId).toBe(p.party[1].defId);
    expect(p.stats.ultsUsed).toBe(1);
  });

  it('client check on a snapshot agrees with the sim (empty field = 필드에 캐릭터 없음)', () => {
    const tg = game();
    const s = tg.w.state;
    const p = s.players[0];
    p.party[0].ult = { charge: 1, fullSince: s.time };
    const snap = (): GameState => cleanState(s);
    expect(canUltState(snap(), 0)).toEqual({ ok: true });
    p.party[0].ult.charge = 0.5;
    expect(canUltState(snap(), 0)).toEqual({ ok: false, reason: '게이지 부족' });
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).reason).toBe('게이지 부족');
    // the field character dies → nobody to cast with, whatever the bench gauges hold
    p.party[1].ult = { charge: 1, fullSince: s.time };
    killEntity(tg.w, active(tg), null);
    expect(p.activeIndex).toBe(null);
    expect(canUltState(snap(), 0)).toEqual({ ok: false, reason: '필드에 캐릭터 없음' });
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).reason).toBe('필드에 캐릭터 없음');
  });

  it('gains and costs hit the field character only (금두꺼비 +40%, 괴담 가득 / 0); trace rates hit every gauge', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    applyReward(tg.w, { kind: 'ultAdd', value: 0.4 });
    expect(charges(tg)).toEqual([0.4, 0, 0]);
    swap(tg, 2);
    applyReward(tg.w, { kind: 'ultAdd', value: 0.4 });
    expect(charges(tg)).toEqual([0.4, 0, 0.4]);
    // 혼선 (rate 0.7): field 30/0.7 s, bench 90/0.7 s
    addGoedamTrace(tg.w, p, 'crossed_line');
    expect(ultFillTime(tg.game.tunables, p, 2)).toBeCloseTo(30 / 0.7, 9);
    expect(ultFillTime(tg.game.tunables, p, 0)).toBeCloseTo(90 / 0.7, 9);
    expect(ultSecondsLeft(tg.game.tunables, p)).toBeCloseTo((0.6 * 30) / 0.7, 9);
  });

  it('괴담 room: 전화를 받는다 (ultSet 1) fills the field character only; 내려놓는다 (ultSet 0) empties only it', () => {
    for (const [option, want] of [
      ['answer', 1],
      ['hang_up', 0],
    ] as const) {
      const tg = makeGame({ players: [HUMAN], tunables: { goedamRoomsPerZone: 1 } });
      const p = tg.w.state.players[0];
      p.party.forEach(m => (m.ult = { charge: 0.5, fullSince: null }));
      tg.game.dispatch({ type: 'debug', action: { kind: 'goedamNext', room: 'ringing_phone' } });
      tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
      if (tg.w.state.phase === 'reward') tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      expect(tg.w.state.phase).toBe('goedam');
      clearEvents(tg);
      expect(tg.game.dispatch({ type: 'goedam', player: 0, option }).ok).toBe(true);
      expect(charges(tg)).toEqual([want, 0.5, 0.5]);
      expect(eventsOf(tg, 'ultReady')).toEqual(want === 1 ? [{ type: 'ultReady', player: 0, partyIndex: 0 }] : []);
    }
  });

  it('a gain with an empty field goes to the first living card (the one that starts the next floor after a rejoin)', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    p.activeIndex = null;
    p.party[0].dead = true;
    expect(ultFocusIndex(p)).toBe(1);
    applyReward(tg.w, { kind: 'ultAdd', value: 0.3 });
    expect(charges(tg)).toEqual([0, 0.3, 0]);
    p.party.forEach(m => (m.dead = true));
    expect(ultFocusIndex(p)).toBe(null);
    applyReward(tg.w, { kind: 'ultAdd', value: 0.3 }); // no-op, no throw
    expect(charges(tg)).toEqual([0, 0.3, 0]);
  });

  it('debug 궁극기 충전 fills every card; an ult still in its cut-in at the floor clear is given back to its caster', () => {
    const tg = game();
    const p = tg.w.state.players[0];
    spawnAt(tg, 'golem', { x: 14, y: 6 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    expect(charges(tg)).toEqual([1, 1, 1]);
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    swap(tg, 1);
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    expect(charges(tg)).toEqual([0, 0, 1]);
    expect(p.stats.ultsUsed).toBe(2);
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    expect(charges(tg)).toEqual([1, 1, 1]);
    expect(p.stats.ultsUsed).toBe(0);
    expect(eventsOf(tg, 'ultReady').map(e => e.partyIndex).sort()).toEqual([0, 1]);
  });

  it('nothing charges while the player is out; dead cards charge at the bench rate', () => {
    const tg = makeGame({ players: [HUMAN, BOT1], tunables: { invincible: false } });
    quietFloor(tg);
    const p = tg.w.state.players[0];
    p.party[2].dead = true;
    p.party[2].reviveRemaining = 999;
    advance(tg, 3);
    expect(charges(tg)[2]).toBeCloseTo(3 / 90, 3);
    p.out = true;
    const before = charges(tg);
    advance(tg, 3);
    expect(charges(tg)).toEqual(before);
  });

  it('the ult-delay stat counts a bench-filled card from its swap-in (it could not be cast on the bench)', () => {
    const tg = game();
    const s = tg.w.state;
    const p = s.players[0];
    spawnAt(tg, 'golem', { x: 14, y: 6 });
    advance(tg, 1);
    p.party[1].ult = { charge: 1, fullSince: s.time - 40 }; // full on the bench for 40 s
    swap(tg, 1);
    advance(tg, 2);
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    expect(p.stats.ultDelayCount).toBe(1);
    expect(p.stats.ultDelayTotal).toBeCloseTo(2, 1);
  });

  it('sanitized like every tunable (server bounds); the dropped 14차 toggle keys are ignored', () => {
    const tg = game();
    const patch = { ultPerCharacter: false, ultChargeTime: 9, swapEnergyMode: true, ultFieldChargeTime: -5, ultBenchRatio: 7 };
    expect(tg.game.dispatch({ type: 'tunables', patch } as never).ok).toBe(true);
    expect(Object.keys(tg.game.tunables)).not.toContain('ultPerCharacter');
    expect(Object.keys(tg.game.tunables)).not.toContain('ultChargeTime');
    expect(Object.keys(tg.game.tunables)).not.toContain('swapEnergyMode');
    expect(tg.game.tunables.ultFieldChargeTime).toBe(1);
    expect(tg.game.tunables.ultBenchRatio).toBe(1);
  });
});

describe('bots with per-character gauges', () => {
  it('bots ult with the field character\'s gauge and bring in a card whose own ult is full', () => {
    const tg = makeGame({ seed: 9, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2], tunables: { invincible: true } });
    let fullSwaps = 0;
    let castSoon = 0;
    const s = tg.w.state;
    const lastFull = [-99, -99, -99];
    for (let t = 0; t < 30 * 150 && s.phase !== 'runOver'; t++) {
      if (s.phase !== 'combat') {
        for (let i = 0; i < 3; i++) if (s.rewardOffersByPlayer[i]) tg.game.dispatch({ type: 'chooseReward', player: i, offerIndex: 0 });
        continue;
      }
      tick(tg.w);
      for (const e of tg.game.drainEvents()) {
        if (e.type === 'appear' && s.players[e.player].party[e.partyIndex].ult.charge >= 1) {
          fullSwaps++;
          lastFull[e.player] = s.time;
        }
        if (e.type === 'ultCast' && s.time - lastFull[e.player] < 4) castSoon++;
      }
    }
    const used = s.players.reduce((n, p) => n + p.stats.ultsUsed, 0);
    expect(used).toBeGreaterThanOrEqual(9);
    expect(fullSwaps).toBeGreaterThan(3);
    expect(castSoon).toBeGreaterThan(3); // …and use it within a few seconds
    for (const p of s.players) for (const m of p.party) expect(m.ult.charge).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
