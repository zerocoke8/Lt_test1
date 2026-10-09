// 기획 15차 원정 모드: the pure stash model (src/expedition/stash.ts) and the run model (src/expedition/run.ts) that the
// solo controller and the server drive (docs/expedition.md 5장, 6장, 8-9, 10장).
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import type { GearSpec } from '../../src/data/gear';
import {
  addItems,
  autoEquip,
  canStartAt,
  discard,
  emptyStash,
  equip,
  equippedItem,
  freeItems,
  grantPartySet,
  grantRandom,
  grantRelics,
  grantSet,
  isFirstBossClear,
  isNew,
  loadoutOf,
  loadoutsFor,
  markSeen,
  maxStartStageFor,
  parseStash,
  recordBossClear,
  resetStash,
  serializeStash,
  setPreset,
  unequip,
  wearerOf,
} from '../../src/expedition/stash';
import { bagSummary, continueRun, extractRun, failRun, nextIsBoss, onStageCleared, runComplete, stageGameSetup, startRun } from '../../src/expedition/run';
import { createGameWithWorld } from '../../src/sim/game';

const PARTY = ['guardian', 'blade', 'mage'];
const W5: GearSpec = { slot: 'weapon', tier: 5, rarity: 'rare', optionId: 'w_scorch' };

describe('stash model', () => {
  it('survives garbage: corrupt / wrong version / bad items → cleaned or empty', () => {
    expect(parseStash(null)).toEqual(emptyStash());
    expect(parseStash('{not json')).toEqual(emptyStash());
    expect(parseStash({ v: 2, items: [] })).toEqual(emptyStash());
    const s = parseStash({
      v: 1,
      nextUid: 2,
      items: [
        { uid: 'g7', slot: 'weapon', tier: 3, rarity: 'common', fromStage: 3 },
        { uid: 'g8', slot: 'weapon', tier: 99, rarity: 'common', fromStage: 3 },
        { uid: 'g7', slot: 'armor', tier: 3, rarity: 'common', fromStage: 3 },
        { uid: 'g9', slot: 'relic', tier: 6, rarity: 'rare', relicId: 'relay_flag', fromStage: 6 },
      ],
      equipped: { guardian: { weapon: 'g7', armor: 'g9' }, nobody: { weapon: 'g7' }, blade: { relic: 'g9' }, mage: { weapon: 'g7' } },
      seen: ['g7', 'zz'],
      bossFirstClears: [3, 4, 6, 6],
      preset: { characters: ['guardian', 'blade'], pets: [] },
      unlockAll: 'yes',
    });
    expect(s.items.map(i => i.uid)).toEqual(['g7', 'g9']);
    expect(s.nextUid).toBe(10);
    expect(s.equipped).toEqual({ guardian: { weapon: 'g7' }, blade: { relic: 'g9' } });
    expect(s.seen).toEqual(['g7']);
    expect(s.bossFirstClears).toEqual([3, 6]);
    expect(s.preset).toBeNull();
    expect(s.unlockAll).toBe(false);
    expect(parseStash(serializeStash(s))).toEqual(s);
  });

  it('equip moves an item between characters; the replaced piece goes back to the stash', () => {
    const s = emptyStash();
    const [a, b] = addItems(s, [W5, { slot: 'weapon', tier: 7, rarity: 'common' }], 5);
    expect(a.uid).toBe('g1');
    expect(isNew(s, a.uid)).toBe(true);
    markSeen(s, [a.uid]);
    expect(isNew(s, a.uid)).toBe(false);
    expect(equip(s, 'guardian', a.uid).ok).toBe(true);
    expect(loadoutOf(s, 'guardian')).toEqual({ weapon: W5 });
    expect(equip(s, 'blade', a.uid).ok).toBe(true);
    expect(wearerOf(s, a.uid)).toBe('blade');
    expect(equippedItem(s, 'guardian', 'weapon')).toBeUndefined();
    equip(s, 'blade', b.uid);
    expect(freeItems(s).map(i => i.uid)).toEqual([a.uid]);
    expect(unequip(s, 'blade', 'weapon').ok).toBe(true);
    expect(unequip(s, 'blade', 'weapon').ok).toBe(false);
    expect(equip(s, 'nobody', a.uid).ok).toBe(false);
    expect(equip(s, 'blade', 'g99').ok).toBe(false);
    equip(s, 'mage', b.uid);
    expect(discard(s, b.uid).ok).toBe(true);
    expect(loadoutOf(s, 'mage')).toEqual({});
    expect(s.items).toHaveLength(1);
  });

  it('autoEquip takes the best free item per slot (tier → rarity → newer); others\' gear is left alone', () => {
    const s = emptyStash();
    addItems(s, [{ slot: 'armor', tier: 4, rarity: 'common' }, { slot: 'armor', tier: 4, rarity: 'epic', optionId: 'a_evac' }, { slot: 'armor', tier: 2, rarity: 'common' }], 4);
    const [held] = addItems(s, [{ slot: 'armor', tier: 9, rarity: 'common' }], 9);
    equip(s, 'cleric', held.uid);
    autoEquip(s, PARTY);
    expect(loadoutOf(s, 'guardian').armor).toMatchObject({ tier: 4, rarity: 'epic' });
    expect(loadoutOf(s, 'blade').armor).toMatchObject({ tier: 4, rarity: 'common' });
    expect(loadoutOf(s, 'mage').armor).toMatchObject({ tier: 2 });
    expect(wearerOf(s, held.uid)).toBe('cleric');
  });

  it('start-stage gating through loadoutsFor (relic excluded) and the unlock flag', () => {
    const s = emptyStash();
    expect(maxStartStageFor(s, PARTY)).toBe(1);
    grantPartySet(s, PARTY, 1);
    expect(maxStartStageFor(s, PARTY)).toBe(2);
    grantSet(s, 'guardian', 6);
    grantSet(s, 'blade', 4);
    expect(maxStartStageFor(s, PARTY)).toBe(2);
    grantSet(s, 'mage', 5);
    expect(maxStartStageFor(s, PARTY)).toBe(5);
    expect(canStartAt(s, PARTY, 5)).toBe(true);
    expect(canStartAt(s, PARTY, 6)).toBe(false);
    const relics = grantRelics(s, 12);
    expect(relics).toHaveLength(8);
    equip(s, 'mage', relics[0].uid);
    expect(maxStartStageFor(s, PARTY)).toBe(5);
    expect(loadoutsFor(s, PARTY)[2].relic).toMatchObject({ tier: 12, relicId: relics[0].relicId });
    s.unlockAll = true;
    expect(maxStartStageFor(s, PARTY)).toBe(12);
  });

  it('debug grants, boss first clears, preset, reset', () => {
    const s = emptyStash();
    const r = grantRandom(s, 10);
    expect(r).toHaveLength(10);
    expect(grantRandom(emptyStash(), 10).map(i => ({ ...i }))).toEqual(r.map(i => ({ ...i })));
    expect(isFirstBossClear(s, 6)).toBe(true);
    expect(isFirstBossClear(s, 5)).toBe(false);
    recordBossClear(s, 6);
    expect(isFirstBossClear(s, 6)).toBe(false);
    expect(setPreset(s, { characters: PARTY, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] }).ok).toBe(true);
    expect(setPreset(s, { characters: ['guardian', 'guardian', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] }).ok).toBe(false);
    s.unlockAll = true;
    const fresh = resetStash(s);
    expect(fresh.items).toEqual([]);
    expect(fresh.bossFirstClears).toEqual([]);
    expect(fresh.preset).toEqual(s.preset);
    expect(fresh.unlockAll).toBe(true);
  });
});

describe('run model', () => {
  it('stage 1 → clear → continue → stage 2 → clear → extract: bag in, carry along, bots fill seats', () => {
    const run = startRun(1, 1234);
    const seat = () => ({ name: '나', characters: PARTY, pets: ['frog_bomb', 'fairy_heal', 'cat_void'], gear: [{}, {}, {}], run, firstBossClear: false });
    const setup1 = stageGameSetup([seat()], { ...DEFAULT_TUNABLES, invincible: true });
    expect(setup1.players.map(p => p.isBot)).toEqual([false, true, true]);
    expect(setup1.expedition).toEqual({ stage: 1, carry: [null, null, null], firstBossClear: [false, false, false], clearedThisRun: [0, 0, 0] });
    const g1 = createGameWithWorld(setup1);
    g1.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    const loot1 = onStageCleared(run, g1.game.state, 0);
    expect(loot1).toHaveLength(2);
    expect(run.bag).toHaveLength(2);
    expect(run.status).toBe('choosing');
    expect(runComplete(run)).toBe(false);
    expect(nextIsBoss(run)).toBe(false);
    expect(continueRun(run)).toBe(true);
    expect(run.stage).toBe(2);
    const setup2 = stageGameSetup([seat()], DEFAULT_TUNABLES);
    expect(setup2.expedition!.carry![0]).toEqual(run.carry);
    expect(setup2.expedition!.clearedThisRun![0]).toBe(1);
    expect(setup2.seed).not.toBe(setup1.seed);
    const g2 = createGameWithWorld(setup2);
    expect(g2.game.state.expedition!.stage).toBe(2);
    expect(g2.game.state.players[1].gear).toHaveLength(3); // bots T1
    g2.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    onStageCleared(run, g2.game.state, 0);
    expect(bagSummary(run.bag)).toMatchObject({ count: 4, topTier: 2, byBand: [0, 4, 0, 0, 0] });
    const items = extractRun(run);
    expect(items).toHaveLength(4);
    expect(run.bag).toEqual([]);
    expect(run.status).toBe('extracted');
    const s = emptyStash();
    expect(addItems(s, items, 2)).toHaveLength(4);
  });

  it('failing loses only the bag; the last stage cannot be continued', () => {
    const run = startRun(12, 1);
    run.bag.push(W5);
    run.status = 'choosing';
    expect(runComplete(run)).toBe(true);
    expect(continueRun(run)).toBe(false);
    expect(failRun(run)).toBe(1);
    expect(run.bag).toEqual([]);
    expect(run.status).toBe('failed');
  });
});
