// 기획 6차 (R4): "캐릭터가 소환된 순간부터 드래그스킬이나 스왑의 쿨타임이 도는게 아니라, 캐릭터가 스왑되서 나간 순간부터
// 쿨타임이 돌아야해." — a card's re-appear (= drag skill) cooldown starts when it is swapped OUT; the field card has none.
import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, TICK_RATE } from '../../src/config';
import { getCharacter, getPet } from '../../src/data';
import { relicParam } from '../../src/sim/modifiers';
import { canSwapState } from '../../src/sim/players';
import { tick } from '../../src/sim/game';
import { applyDamage } from '../../src/sim/combat';
import { cleanState } from '../../server/snapshot';
import type { GameState } from '../../src/types';
import { advance, HUMAN, HUMAN2, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const cdOf = (id: string) => getCharacter(id).swapCooldown;
const cds = (tg: TestGame, player = 0) => tg.game.state.players[player].party.map(m => m.swapCooldownRemaining);

describe('기획 6차: the swap cooldown starts when a character leaves the field', () => {
  it('the field card never cools: 20 s on the field, then swapping it out gives it the full cooldown', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      tick(tg.w);
      expect(p.party[0].swapCooldownRemaining).toBe(0);
    }
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 12, y: 6 } }).ok).toBe(true);
    // full guardian cooldown from now (the 20 s on the field did not count), total set for the card's ring
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(cdOf('guardian'));
    expect(p.party[0].swapCooldownTotal).toBeCloseTo(cdOf('guardian'));
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    // mage now fights: its card stays at 0 for as long as it is out there
    advance(tg, 8);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(cdOf('guardian') - 8, 1);
  });

  it('A→B→C→A timeline: B→C right after the appear lock, C→A only once A’s cooldown (from when A left) ran out', () => {
    const tg = makeGame();
    quietFloor(tg);
    const g = tg.game;
    expect(g.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true); // t = 0: A leaves
    expect(cds(tg)).toEqual([cdOf('guardian'), 0, 0]);
    advance(tg, 0.5);
    expect(g.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 12, y: 6 } }).ok).toBe(true); // t = 0.5: B leaves
    expect(cds(tg)[1]).toBeCloseTo(cdOf('blade'));
    expect(cds(tg)[2]).toBe(0);
    // A's cooldown is counted from t = 0, not from t = 0.5 and not from when it first appeared
    advance(tg, cdOf('guardian') - 0.5 - 2 / TICK_RATE);
    expect(g.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 12, y: 6 } })).toEqual({ ok: false, reason: '쿨타임' });
    advance(tg, 3 / TICK_RATE);
    expect(g.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 12, y: 6 } }).ok).toBe(true); // C leaves
    expect(cds(tg)[0]).toBe(0);
    expect(cds(tg)[2]).toBeCloseTo(cdOf('mage'));
  });

  it('swapCooldownMult and the "빠른 교대" reward size the cooldown of the character that leaves', () => {
    const tg = makeGame({ tunables: { swapCooldownMult: 1.5 } });
    quietFloor(tg);
    const p = tg.game.state.players[0];
    p.rewards.push({ rewardId: 'swapcd_epic', partyIndex: 0 }); // guardian −3 s
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo((cdOf('guardian') - 3) * 1.5);
    expect(p.party[0].swapCooldownTotal).toBeCloseTo((cdOf('guardian') - 3) * 1.5);
    advance(tg, 0.5);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 12, y: 6 } });
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(cdOf('blade') * 1.5); // no reward on blade
  });

  it('relic hunter_mark: each kill cuts the cooling bench cards, never the field card', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    p.relics.push('hunter_mark');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    const before = cds(tg);
    const m = spawnAt(tg, 'slime', { x: 30, y: 6 });
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'basic', isDrag: false }, m, 1e6, false);
    const cut = relicParam('hunter_mark', 'seconds');
    expect(cds(tg)[0]).toBeCloseTo(before[0] - cut);
    expect(cds(tg)[1]).toBe(0); // field
    expect(cds(tg)[2]).toBe(0); // ready card stays at 0
  });

  it('chrono’s drag skill cuts the card that just left it the field (its fresh cooldown) and the other cooling card', () => {
    const tg = makeGame({ players: [{ ...HUMAN, characters: ['guardian', 'chrono', 'bard'] }] });
    quietFloor(tg);
    const p = tg.game.state.players[0];
    const cut = getCharacter('chrono').drag.actions.flatMap(a => a.effects).find(e => e.kind === 'swapCooldownReduce');
    const sec = cut?.kind === 'swapCooldownReduce' ? cut.seconds : 0;
    expect(sec).toBeGreaterThan(0);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 15, y: 6 } }); // guardian leaves
    advance(tg, 0.5);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 6 } }); // bard leaves, chrono appears
    expect(p.party[2].swapCooldownRemaining).toBeCloseTo(cdOf('bard') - sec);
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(cdOf('guardian') - 0.5 - sec);
    expect(p.party[1].swapCooldownRemaining).toBe(0); // chrono itself: on the field
    // the ring keeps the full total, so the cut shows as a jump in the card's sweep
    expect(p.party[2].swapCooldownTotal).toBeCloseTo(cdOf('bard'));
  });

  it('pet rabbit_time cuts the cooling bench cards, never the field card, and never below 0', () => {
    const tg = makeGame({ players: [HUMAN2] }); // ranger / cleric / berserker, pet 2 = rabbit_time
    quietFloor(tg);
    const p = tg.game.state.players[0];
    expect(p.pets[2].defId).toBe('rabbit_time');
    const act = getPet('rabbit_time').action;
    const eff = act.effects.find(e => e.kind === 'swapCooldownReduce');
    const sec = eff?.kind === 'swapCooldownReduce' ? eff.seconds : 0;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }); // ranger leaves
    advance(tg, 7);
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 2, pos: { x: 10, y: 6 } }).ok).toBe(true);
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(Math.max(0, cdOf('ranger') - 7 - sec), 1);
    expect(p.party[0].swapCooldownRemaining).toBeGreaterThanOrEqual(0);
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
  });

  it('floor change (R19): bench cooldowns are kept, frozen during the reward, the re-appearing card gets none; then they tick on', () => {
    const tg = makeGame();
    quietFloor(tg);
    const g = tg.game;
    const s = g.state;
    const p = s.players[0];
    g.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    advance(tg, 0.5);
    g.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    advance(tg, 2);
    const atClear = cds(tg);
    expect(atClear[0]).toBeGreaterThan(0);
    expect(atClear[1]).toBeGreaterThan(0);
    expect(atClear[2]).toBe(0);
    expect(g.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
    expect(s.phase).toBe('reward');
    for (let i = 0; i < 20; i++) g.step(0.25); // 5 s of real time on the reward screen
    expect(cds(tg)).toEqual(atClear);
    expect(g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(2);
    // the previous field character (mage) re-appears without a drag skill and without starting a cooldown
    expect(p.activeIndex).toBe(2);
    expect(cds(tg)).toEqual(atClear);
    advance(tg, 1);
    expect(cds(tg)[0]).toBeCloseTo(atClear[0] - 1, 1);
    expect(cds(tg)[1]).toBeCloseTo(atClear[1] - 1, 1);
    expect(cds(tg)[2]).toBe(0);
    expect(g.canSwap(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    advance(tg, atClear[0] - 1 + 0.05);
    expect(g.canSwap(0, 0).ok).toBe(true);
  });

  it('multiplayer: canSwapState on the server snapshot agrees with the sim through swaps, locks, cooldowns and a floor change', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, { ...BOT_PRESETS[0], isBot: true }] });
    quietFloor(tg);
    const g = tg.game;
    const check = (where: string) => {
      const snap = JSON.parse(JSON.stringify(cleanState(g.state))) as GameState;
      for (let pi = 0; pi < 3; pi++)
        for (let i = 0; i < 3; i++) expect(canSwapState(snap, pi, i), `${where} p${pi} card ${i}`).toEqual(g.canSwap(pi, i));
    };
    check('start');
    expect(g.canSwap(0, 0)).toEqual({ ok: false, reason: '이미 필드에 있음' });
    g.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    g.dispatch({ type: 'swap', player: 1, partyIndex: 2, pos: { x: 14, y: 6 } });
    check('appear lock');
    advance(tg, 0.5);
    check('after lock');
    expect(g.canSwap(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    expect(g.canSwap(1, 0)).toEqual({ ok: false, reason: '쿨타임' });
    expect(g.canSwap(0, 2).ok).toBe(true);
    expect(g.canSwap(1, 1).ok).toBe(true);
    g.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    advance(tg, 3);
    check('two cooling');
    g.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    check('reward');
    g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    g.dispatch({ type: 'chooseReward', player: 1, offerIndex: 0 });
    check('next floor');
    advance(tg, 0.6);
    check('next floor after lock');
    advance(tg, 12);
    check('all ready');
  });
});
