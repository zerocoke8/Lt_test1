// Multi-human sim support (기획 3차 멀티): R33 per-player rewards, R34 setPlayerBot, per-player telemetry/debug,
// 'tunables' command, and the pure state checks shared with the multiplayer client.
import { describe, expect, it } from 'vitest';
import { canSwapState, canUltState, canUsePetState } from '../../src/sim/players';
import { sanitizeTunablesPatch } from '../../src/sim/telemetry';
import type { GameState, PlayerSetup } from '../../src/types';
import { advance, BOT1, BOT2, eventsOf, HUMAN, HUMAN2, killActive, makeGame, quietFloor, spawnAt } from './helpers';

const HUMAN3: PlayerSetup = { name: '셋', isBot: false, characters: ['mage', 'guardian', 'cleric'], pets: ['cat_void', 'owl_frost', 'frog_bomb'] };
const skip = { type: 'debug', action: { kind: 'skipFloor' } } as const;

describe('R33 per-player rewards', () => {
  it('3 humans each get their own offers; the next floor waits for all of them', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, HUMAN3] });
    const s = tg.game.state;
    expect(s.rewardOffersByPlayer).toEqual([null, null, null]);
    expect(tg.game.dispatch(skip).ok).toBe(true);
    expect(s.phase).toBe('reward');
    for (let i = 0; i < 3; i++) expect(s.rewardOffersByPlayer[i]).toHaveLength(3);
    expect(s.rewardOffers).toBe(s.rewardOffersByPlayer[0]);
    const o1 = s.rewardOffersByPlayer[1]!;
    // order does not matter: 1, then 0, then 2
    expect(tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 2 }).ok).toBe(true);
    expect(s.phase).toBe('reward');
    expect(s.rewardOffersByPlayer[1]).toBeNull();
    expect(s.players[1].rewards.length + s.players[1].relics.length).toBe(1);
    expect(s.players[1].rewards[0]?.rewardId ?? s.players[1].relics[0]).toBe(o1[2].rewardId);
    // a second pick by the same player is refused
    expect(tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    expect(s.rewardOffers).toBeNull();
    expect(s.phase).toBe('reward');
    // time stays frozen while waiting for the last human
    const t = s.time;
    tg.game.step(0.5);
    expect(s.time).toBe(t);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 2, offerIndex: 1 }).ok).toBe(true);
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(2);
    expect(s.rewardOffersByPlayer).toEqual([null, null, null]);
    expect(eventsOf(tg, 'floorStart').map(e => e.floor)).toContain(2);
  });

  it('bots pick instantly, humans wait; non-human or chosen slots are refused', () => {
    const tg = makeGame({ players: [HUMAN, BOT1, HUMAN2] });
    const s = tg.game.state;
    tg.game.dispatch(skip);
    expect(s.rewardOffersByPlayer[0]).toHaveLength(3);
    expect(s.rewardOffersByPlayer[1]).toBeNull();
    expect(s.rewardOffersByPlayer[2]).toHaveLength(3);
    expect(s.players[1].rewards.length).toBe(1);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 })).toEqual({ ok: false, reason: '고를 보상이 없음' });
    expect(tg.game.dispatch({ type: 'chooseReward', player: 7, offerIndex: 0 }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 2, offerIndex: 9 }).ok).toBe(false);
    tg.game.dispatch({ type: 'chooseReward', player: 2, offerIndex: 0 });
    expect(s.phase).toBe('reward');
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(s.phase).toBe('combat');
  });

  it('기획 5차: a player who was out is revived at the clear and chooses a reward like everyone else', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    const s = tg.game.state;
    const p0 = s.players[0];
    p0.party[1].dead = true;
    p0.party[1].reviveRemaining = 25;
    p0.party[2].dead = true;
    p0.party[2].reviveRemaining = 25;
    killActive(tg, 0);
    expect(p0.out).toBe(true);
    tg.game.dispatch(skip);
    expect(s.phase).toBe('reward');
    expect(p0.out).toBe(false);
    expect(s.rewardOffersByPlayer[0]).toHaveLength(3);
    expect(s.rewardOffersByPlayer[1]).toHaveLength(3);
    tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 });
    expect(s.phase).toBe('reward'); // still waiting for the revived player 0
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(2);
  });

  it('boss floors offer relics to every human', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2], startFloor: 5 });
    tg.game.dispatch(skip);
    const s = tg.game.state;
    expect(s.rewardOffersByPlayer[0]!.every(o => o.isRelic)).toBe(true);
    expect(s.rewardOffersByPlayer[1]!.every(o => o.isRelic)).toBe(true);
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 1 });
    expect(s.players[0].relics.length).toBe(1);
    expect(s.players[1].relics.length).toBe(1);
    expect(s.floor).toBe(6);
  });

  it('quit during the reward phase clears every pending offer', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    tg.game.dispatch(skip);
    expect(tg.game.dispatch({ type: 'quit' }).ok).toBe(true);
    const s = tg.game.state;
    expect(s.phase).toBe('runOver');
    expect(s.rewardOffers).toBeNull();
    expect(s.rewardOffersByPlayer).toEqual([null, null]);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 }).ok).toBe(false);
  });
});

describe('R34 setPlayerBot', () => {
  it('disconnect → bot drives the slot → reconnect hands it back', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, BOT2], tunables: { invincible: true } });
    const s = tg.game.state;
    const p1 = s.players[1];
    spawnAt(tg, 'slime', { x: 18, y: 6 });
    tg.game.setPlayerBot(1, true);
    expect(p1.isBot).toBe(true);
    expect(p1.disconnected).toBe(true);
    // a full gauge is used by the bot within its 0.5~3 s delay
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
    advance(tg, 4);
    expect(p1.stats.ultsUsed).toBe(1);
    tg.game.setPlayerBot(1, false);
    expect(p1.isBot).toBe(false);
    expect(p1.disconnected).toBe(false);
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
    advance(tg, 5);
    expect(p1.stats.ultsUsed).toBe(1);
    expect(p1.ult.charge).toBe(1);
  });

  it('becoming a bot during the reward phase auto-picks; the last pending human advances the floor', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, HUMAN3] });
    const s = tg.game.state;
    tg.game.dispatch(skip);
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    tg.game.setPlayerBot(2, true);
    expect(s.rewardOffersByPlayer[2]).toBeNull();
    expect(s.players[2].rewards.length).toBe(1);
    expect(s.phase).toBe('reward');
    tg.game.setPlayerBot(1, true);
    expect(s.players[1].rewards.length).toBe(1);
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(2);
    // back to human: no offers to make up for
    tg.game.setPlayerBot(1, false);
    expect(s.players[1].isBot).toBe(false);
  });

  it('ignores bad indices', () => {
    const tg = makeGame({ players: [HUMAN, BOT1] });
    expect(() => tg.game.setPlayerBot(5, true)).not.toThrow();
    expect(() => tg.game.setPlayerBot(-1, false)).not.toThrow();
    expect(tg.game.state.players.map(p => p.isBot)).toEqual([false, true]);
  });
});

describe('per-player telemetry and debug', () => {
  it('telemetry(player) reads that player; default is player 0', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2], tunables: { invincible: true } });
    advance(tg, 1);
    expect(tg.game.dispatch({ type: 'swap', player: 1, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true);
    advance(tg, 2);
    expect(tg.game.telemetry(1).swapsPerMinute).toBeGreaterThan(0);
    expect(tg.game.telemetry(0).swapsPerMinute).toBe(0);
    expect(tg.game.telemetry().swapsPerMinute).toBe(0);
  });

  it('chargeUlt / resetCooldowns target the given player (default 0)', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, HUMAN3] });
    const s = tg.game.state;
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 2 } });
    expect(s.players.map(p => p.ult.charge >= 1)).toEqual([false, false, true]);
    expect(eventsOf(tg, 'ultReady').map(e => e.player)).toEqual([2]);
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    expect(s.players[0].ult.charge).toBe(1);
    // 기획 6차: the card that leaves the field starts cooling (slot 0 for both players here)
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    tg.game.dispatch({ type: 'swap', player: 1, partyIndex: 1, pos: { x: 12, y: 6 } });
    expect(s.players[1].party[0].swapCooldownRemaining).toBeGreaterThan(0);
    tg.game.dispatch({ type: 'debug', action: { kind: 'resetCooldowns', player: 1 } });
    expect(s.players[1].party[0].swapCooldownRemaining).toBe(0);
    expect(s.players[0].party[0].swapCooldownRemaining).toBeGreaterThan(0);
  });
});

describe("command 'tunables'", () => {
  it('applies a validated patch to game.tunables', () => {
    const tg = makeGame();
    const t = tg.game.tunables;
    expect(tg.game.dispatch({ type: 'tunables', patch: { ultChargeTime: 12, invincible: true } }).ok).toBe(true);
    expect(t.ultChargeTime).toBe(12);
    expect(t.invincible).toBe(true);
    // clamped, ints rounded, junk dropped
    tg.game.dispatch({ type: 'tunables', patch: { gameSpeed: 99, maxFloor: 7.6, swapCooldownMult: -3 } });
    expect(t.gameSpeed).toBe(8);
    expect(t.maxFloor).toBe(8);
    expect(t.swapCooldownMult).toBe(0);
    const before = { ...t };
    const bad = tg.game.dispatch({ type: 'tunables', patch: { nope: 1, ultChargeTime: 'x', invincible: 1 } as never });
    expect(bad.ok).toBe(false);
    expect(tg.game.tunables).toEqual(before);
    expect(tg.game.dispatch({ type: 'tunables', patch: { reviveTime: Number.NaN } }).ok).toBe(false);
    expect(sanitizeTunablesPatch(null)).toEqual({});
    expect(sanitizeTunablesPatch([1, 2])).toEqual({});
    expect(sanitizeTunablesPatch({ __proto__: { gameSpeed: 2 } })).toEqual({});
  });
});

describe('pure state checks (shared with the multiplayer client)', () => {
  it('canSwapState / canUsePetState agree with the sim on the public state and a JSON snapshot of it', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, BOT1] });
    const g = tg.game;
    const check = () => {
      const snap = JSON.parse(JSON.stringify(g.state, (k, v) => (k === 'rt' || k === 'src' ? undefined : v))) as GameState;
      for (let p = -1; p <= 3; p++)
        for (let i = -1; i <= 3; i++) {
          expect(canSwapState(snap, p, i)).toEqual(g.canSwap(p, i));
          expect(canUsePetState(snap, p, i)).toEqual(g.canUsePet(p, i));
        }
    };
    check();
    g.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    g.dispatch({ type: 'pet', player: 1, petIndex: 2, pos: { x: 10, y: 6 } });
    check();
    advance(tg, 0.6);
    check();
    killActive(tg, 1);
    check();
    g.dispatch(skip);
    check();
  });

  it('canUltState mirrors the ult rules', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    const s = tg.game.state;
    expect(canUltState(s, 0)).toEqual({ ok: false, reason: '게이지 부족' });
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
    expect(canUltState(s, 0).ok).toBe(true);
    killActive(tg, 0);
    expect(canUltState(s, 0)).toEqual({ ok: false, reason: '필드에 캐릭터 없음' });
    expect(canUltState(s, 9).ok).toBe(false);
  });
});
