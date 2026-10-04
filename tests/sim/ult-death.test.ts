import { describe, expect, it } from 'vitest';
import { applyStatus } from '../../src/sim/status';
import { active, advance, clearEvents, eventsOf, HUMAN, HUMAN2, killActive, makeGame, quietFloor, spawnAt } from './helpers';

describe('R9 ult gauge', () => {
  it('charges by time only (ultChargeTime), per player', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2], tunables: { ultChargeTime: 10 } });
    advance(tg, 5);
    const [p0, p1] = tg.game.state.players;
    expect(p0.ult.charge).toBeCloseTo(0.5, 2);
    expect(p1.ult.charge).toBeCloseTo(0.5, 2);
    expect(tg.game.dispatch({ type: 'ult', player: 0 })).toEqual({ ok: false, reason: '게이지 부족' });
    advance(tg, 5.05);
    expect(p0.ult.charge).toBe(1);
    expect(p0.ult.fullSince).not.toBeNull();
    expect(eventsOf(tg, 'ultReady').map(e => e.player).sort()).toEqual([0, 1]);
    advance(tg, 2);
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    expect(p0.ult.charge).toBe(0);
    expect(p0.ult.fullSince).toBeNull();
    expect(p0.stats.ultsUsed).toBe(1);
    expect(p0.stats.ultDelayTotal).toBeGreaterThanOrEqual(2);
    expect(p0.stats.ultDelayTotal).toBeLessThan(2.1);
    // other player's gauge is untouched
    expect(p1.ult.charge).toBe(1);
    const casts = eventsOf(tg, 'skillCast').filter(c => c.slot === 'ult');
    expect(casts.length).toBeGreaterThan(0);
    expect(casts[0].player).toBe(0);
    expect(tg.game.telemetry().avgUltDelay).toBeCloseTo(p0.stats.ultDelayTotal, 9);
  });

  it('is not affected by damage dealt or taken', () => {
    const a = makeGame({ seed: 7, tunables: { ultChargeTime: 30 } });
    const b = makeGame({ seed: 7, tunables: { ultChargeTime: 30, invincible: true, botDamageMult: 5 } });
    quietFloor(b);
    advance(a, 12);
    advance(b, 12);
    expect(a.game.state.players[0].ult.charge).toBeCloseTo(b.game.state.players[0].ult.charge, 9);
    expect(a.game.state.players[0].ult.charge).toBeCloseTo(12 / 30, 2);
  });

  it('cannot be used while the field is empty; gauge stays full', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    killActive(tg, 0);
    expect(tg.game.state.players[0].activeIndex).toBeNull();
    expect(tg.game.dispatch({ type: 'ult', player: 0 })).toEqual({ ok: false, reason: '필드에 캐릭터 없음' });
    expect(tg.game.state.players[0].ult.charge).toBe(1);
  });
});

describe('R10 death and revive', () => {
  it('death leaves the field empty (no auto swap); revives after reviveTime as a card', () => {
    const tg = makeGame({ tunables: { reviveTime: 30, reviveHpFrac: 0.5 } });
    quietFloor(tg);
    const p = tg.game.state.players[0];
    const deadId = active(tg).id;
    killActive(tg);
    expect(p.activeIndex).toBeNull();
    expect(p.party[0].dead).toBe(true);
    expect(p.party[0].entityId).toBeNull();
    expect(p.party[0].reviveRemaining).toBeCloseTo(30);
    expect(eventsOf(tg, 'death').some(d => d.entityId === deadId && d.kind === 'character')).toBe(true);
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '사망' });
    advance(tg, 10);
    // nothing appears by itself
    expect(p.activeIndex).toBeNull();
    expect(tg.game.state.entities.some(e => e.kind === 'character' && e.ownerPlayer === 0)).toBe(false);
    expect(p.out).toBe(false);
    advance(tg, 20.05);
    expect(p.party[0].dead).toBe(false);
    expect(p.party[0].hp).toBeCloseTo(p.party[0].maxHp * 0.5);
    expect(eventsOf(tg, 'revive')).toEqual([{ type: 'revive', player: 0, partyIndex: 0 }]);
    expect(p.activeIndex).toBeNull();
    expect(tg.game.canSwap(0, 0).ok).toBe(true);
  });

  it('phoenix_feather: 40% shorter revive and full HP', () => {
    const tg = makeGame({ tunables: { reviveTime: 30 } });
    quietFloor(tg);
    const p = tg.game.state.players[0];
    p.relics.push('phoenix_feather');
    killActive(tg);
    expect(p.party[0].reviveRemaining).toBeCloseTo(18);
    advance(tg, 18.05);
    expect(p.party[0].dead).toBe(false);
    expect(p.party[0].hp).toBeCloseTo(p.party[0].maxHp);
  });
});

describe('R11 player out and wipe', () => {
  function killAllOf(tg: ReturnType<typeof makeGame>, player: number) {
    for (let i = 0; i < 3; i++) {
      const p = tg.game.state.players[player];
      if (p.activeIndex == null) {
        const idx = p.party.findIndex(m => !m.dead);
        p.appearLock = 0;
        p.party[idx].swapCooldownRemaining = 0;
        expect(tg.game.dispatch({ type: 'swap', player, partyIndex: idx, pos: { x: 10, y: 6 } }).ok).toBe(true);
      }
      killActive(tg, player);
    }
  }

  it('all 3 dead at once → that player is out (spectating); all players out → wipe', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    clearEvents(tg);
    killAllOf(tg, 0);
    const s = tg.game.state;
    expect(s.players[0].out).toBe(true);
    expect(eventsOf(tg, 'playerOut')).toEqual([{ type: 'playerOut', player: 0 }]);
    expect(s.phase).toBe('combat');
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '관전 중' });
    const charge = s.players[0].ult.charge;
    advance(tg, 31);
    // out for the rest of this floor: no revive, no ult charge (기획 5차: back at the next floor if someone clears)
    expect(s.players[0].party.every(m => m.dead)).toBe(true);
    expect(s.players[0].ult.charge).toBe(charge);
    killAllOf(tg, 1);
    expect(s.phase).toBe('runOver');
    expect(s.runResult).toMatchObject({ outcome: 'defeat', reason: 'wipe' });
    expect(eventsOf(tg, 'runOver').length).toBe(1);
  });

  it('not out when a member revived before the last one died', () => {
    const tg = makeGame({ tunables: { reviveTime: 5 } });
    quietFloor(tg);
    const p = tg.game.state.players[0];
    killActive(tg);
    advance(tg, 5.1);
    expect(p.party[0].dead).toBe(false);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    killActive(tg);
    p.appearLock = 0;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    killActive(tg);
    expect(p.out).toBe(false);
    expect(tg.game.state.phase).toBe('combat');
  });
});

describe('R12 bench', () => {
  it('bench member takes no damage/DoT/regen; status timers and cooldowns keep running', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    const e = active(tg);
    e.hp = e.maxHp * 0.5;
    applyStatus(e, 'burn', 10, 50, null);
    applyStatus(e, 'regen', 10, 0.05, null);
    advance(tg, 1 / 30);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 30, y: 6 } }).ok).toBe(true);
    const hp = p.party[0].hp;
    const burn = p.party[0].statuses.find(s => s.id === 'burn')!;
    const before = burn.remaining;
    // enemies around and a heal pet next to the bench member's old spot: nothing reaches the bench
    spawnAt(tg, 'slime', { x: 30, y: 7 });
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 1, pos: { x: 30, y: 6 } }).ok).toBe(true); // fairy_heal
    advance(tg, 3);
    expect(p.party[0].hp).toBe(hp);
    expect(burn.remaining).toBeCloseTo(before - 3, 1);
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(10 - 3, 1);
    advance(tg, 8);
    expect(p.party[0].statuses.length).toBe(0);
  });

  it('zones left by a character persist after it swaps out', () => {
    const tg = makeGame({ players: [{ ...HUMAN2, characters: ['ranger', 'cleric', 'berserker'] }] });
    quietFloor(tg);
    // cleric's drag skill leaves a heal zone at the drop point
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    advance(tg, 0.6);
    expect(tg.game.state.zones.length).toBe(1); // cleric heal zone
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 20, y: 6 } });
    expect(tg.game.state.zones.length).toBe(1);
    advance(tg, 1);
    expect(tg.game.state.zones.length).toBe(1);
  });
});
