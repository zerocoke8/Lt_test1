import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import { active, advance, clearEvents, eventsOf, HUMAN, HUMAN2, killActive, makeGame, quietFloor } from './helpers';

// 기획 5차: 전부 사망해도 다른 누군가가 클리어하면 다음 층에선 부활.
describe('out players come back on the next floor when someone else clears', () => {
  function knockOut(tg: ReturnType<typeof makeGame>, player: number) {
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
    expect(tg.game.state.players[player].out).toBe(true);
  }

  it('revives the whole party at floor clear, offers a reward, and fields slot 0 next floor', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    knockOut(tg, 0);
    clearEvents(tg);
    const s = tg.game.state;

    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    expect(s.phase).toBe('reward');
    const p0 = s.players[0];
    expect(p0.out).toBe(false);
    expect(p0.party.every(m => !m.dead)).toBe(true);
    for (const m of p0.party) {
      expect(m.hp).toBeCloseTo(m.maxHp * DEFAULT_TUNABLES.reviveHpFrac, 5);
      expect(m.reviveRemaining).toBe(0);
    }
    expect(eventsOf(tg, 'revive').filter(e => e.player === 0).length).toBe(3);
    // back in → gets their own reward choice like everyone else
    expect(s.rewardOffersByPlayer[0]?.length).toBe(3);
    expect(s.rewardOffersByPlayer[1]?.length).toBe(3);

    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 }).ok).toBe(true);
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(2);
    expect(p0.activeIndex).toBe(0);
    expect(active(tg, 0).partyIndex).toBe(0);
    // 기획 6차: like the run start, slot 0 fights with no cooldown (it starts when it is swapped out); all cards reset
    expect(p0.party.map(m => m.swapCooldownRemaining)).toEqual([0, 0, 0]);
    advance(tg, 0.6); // past the 0.5 s floor-start appear window
    expect(tg.game.canSwap(0, 1).ok).toBe(true);
    expect(tg.game.canSwap(0, 2).ok).toBe(true);
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '이미 필드에 있음' });
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }).ok).toBe(true);
    expect(p0.party[0].swapCooldownRemaining).toBeGreaterThan(0);
  });

  it('a player who was not out keeps an empty field and dead members keep their revive timers (R19)', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    killActive(tg, 0); // only the field character dies → not out
    const s = tg.game.state;
    const p0 = s.players[0];
    expect(p0.out).toBe(false);
    const timer = p0.party[0].reviveRemaining;
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    expect(p0.party[0].dead).toBe(true);
    expect(p0.party[0].reviveRemaining).toBeCloseTo(timer, 5);
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 });
    expect(s.floor).toBe(2);
    expect(p0.activeIndex).toBeNull();
  });

  it('when every player is out at once nobody can clear: still a wipe', () => {
    const tg = makeGame({ players: [HUMAN] });
    quietFloor(tg);
    knockOut(tg, 0);
    expect(tg.game.state.phase).toBe('runOver');
    expect(tg.game.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'wipe' });
  });
});
