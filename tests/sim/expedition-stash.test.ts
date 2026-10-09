// 기획 15차 원정 모드: the pure stash model (src/expedition/stash.ts) (docs/expedition.md 5장, 6장, 8-9, 10장).
// 기획 16차: version 2 keeps the run in progress (StashData.run) — v1 migration, the gear / party lock while a run
// exists, the one-step claim and its refusals. The run model itself: tests/sim/expedition-run.test.ts.
import { describe, expect, it } from 'vitest';
import type { GearSpec } from '../../src/data/gear';
import {
  RUN_GONE_REASON,
  RUN_LOCK_REASON,
  addItems,
  applyResult,
  autoEquip,
  beginRun,
  claimRun,
  dropEmptyRun,
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
  runBuffCount,
  setPreset,
  stashLocked,
  unequip,
  wearerOf,
  type StashData,
} from '../../src/expedition/stash';
import { beginStage, startRun, type ExpeditionRun } from '../../src/expedition/run';

const PARTY = ['guardian', 'blade', 'mage'];
const W5: GearSpec = { slot: 'weapon', tier: 5, rarity: 'rare', optionId: 'w_scorch' };

describe('stash model', () => {
  it('survives garbage: corrupt / wrong version / bad items → cleaned or empty', () => {
    expect(parseStash(null)).toEqual(emptyStash());
    expect(parseStash('{not json')).toEqual(emptyStash());
    expect(parseStash({ v: 3, items: [] })).toEqual(emptyStash());
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

// ─────────────────────────── 기획 16차: the run in the stash ───────────────────────────

const PETS = ['frog_bomb', 'fairy_heal', 'cat_void'];
const RUN_ID = 'abcdEFGH12345678';

function withRun(): { s: StashData; run: ExpeditionRun } {
  const s = emptyStash();
  grantPartySet(s, PARTY, 3);
  const run = startRun(3, { characters: PARTY, pets: PETS, gear: loadoutsFor(s, PARTY) }, RUN_ID, 9);
  expect(beginRun(s, run).ok).toBe(true);
  return { s, run };
}

const cleared = (stage: number, loot: GearSpec[], bossClear = false) => ({
  runId: RUN_ID,
  stage,
  outcome: 'cleared' as const,
  loot,
  carry: { rewards: [{ rewardId: 'atk_common', partyIndex: null }], goedamTraces: [{ id: 'silence', floorsLeft: 1 }], ult: [0, 0.5, 1] },
  bossClear,
});

describe('stash v2: the run (기획 16차)', () => {
  it('v1 reads as v2 with no run; a run survives a save / load; a broken run is dropped', () => {
    const v1 = parseStash({ v: 1, nextUid: 1, items: [], equipped: {}, seen: [], bossFirstClears: [], preset: null, unlockAll: false });
    expect(v1.v).toBe(2);
    expect(v1.run).toBeNull();
    const { s } = withRun();
    expect(applyResult(s, cleared(3, [{ slot: 'relic', tier: 3, rarity: 'epic', relicId: 'echo_seal' }, { slot: 'weapon', tier: 3, rarity: 'common' }], true)).kind).toBe('cleared');
    expect(s.run!.bag).toHaveLength(2);
    const back = parseStash(serializeStash(s));
    expect(back.run).toEqual(s.run);
    expect(back).toEqual(s);
    beginStage(s.run!, { stage: 4, online: true, bootId: 'b1', tabId: 't1', aliveAt: 5 });
    expect(parseStash(serializeStash(s)).run).toEqual(s.run);
    const bad = (patch: Partial<ExpeditionRun>) => parseStash(JSON.stringify({ ...s, run: { ...s.run, ...patch } })).run;
    expect(bad({ id: 'x' })).toBeNull();
    expect(bad({ stage: 9 })).toBeNull(); // stage ≠ startStage + cleared
    expect(bad({ bag: [{ slot: 'weapon', tier: 9, rarity: 'common' }] })).toBeNull(); // tier above the stages played
    expect(bad({ status: 'choosing' as never })).toBeNull();
    expect(bad({ pending: null })).toBeNull(); // inStage without its pending
    expect(bad({ carry: 'x' as never })).toBeNull();
    expect(bad({ bag: 5 as never })).toBeNull();
    expect(parseStash(JSON.stringify({ ...s, run: 'garbage' })).run).toBeNull();
  });

  it('gear / party changes are locked while a run exists (read-only); seen marks and boss clears still work', () => {
    const { s } = withRun();
    const [extra] = addItems(s, [W5], 5);
    const before = serializeStash(s);
    expect(stashLocked(s)).toBe(true);
    expect(equip(s, 'guardian', extra.uid)).toEqual({ ok: false, reason: RUN_LOCK_REASON });
    expect(unequip(s, 'guardian', 'weapon')).toEqual({ ok: false, reason: RUN_LOCK_REASON });
    expect(discard(s, extra.uid)).toEqual({ ok: false, reason: RUN_LOCK_REASON });
    expect(setPreset(s, { characters: PARTY, pets: PETS })).toEqual({ ok: false, reason: RUN_LOCK_REASON });
    expect(autoEquip(s, PARTY)).toEqual([]);
    expect(grantSet(s, 'guardian', 9)).toEqual([]);
    expect(grantPartySet(s, PARTY, 9)).toEqual([]);
    expect(grantRandom(s, 3)).toEqual([]);
    expect(grantRelics(s)).toEqual([]);
    expect(resetStash(s)).toBe(s);
    expect(serializeStash(s)).toBe(before);
    markSeen(s, [extra.uid]);
    recordBossClear(s, 3);
    expect(isNew(s, extra.uid)).toBe(false);
    expect(s.bossFirstClears).toEqual([3]);
    const other = startRun(1, s.run!.lock, 'otherRUN12345678', 1);
    expect(beginRun(s, other).ok).toBe(false);
  });

  it('applyResult: cleared fills the bag once; failed drops the run (bag lost, worn gear kept); void keeps it', () => {
    const { s } = withRun();
    const worn = serializeStash({ ...s, run: null });
    beginStage(s.run!, { stage: 3, online: false, bootId: null, tabId: 't', aliveAt: 0 });
    const loot: GearSpec[] = [{ slot: 'armor', tier: 3, rarity: 'common' }, { slot: 'relic', tier: 3, rarity: 'rare', relicId: 'relay_flag' }];
    expect(applyResult(s, cleared(3, loot, true))).toEqual({ kind: 'cleared', loot });
    expect(applyResult(s, cleared(3, loot, true))).toEqual({ kind: 'ignored' }); // a second delivery
    expect(s.run).toMatchObject({ stage: 4, cleared: 1, bag: loot, bossClears: [3], status: 'lobby', pending: null });
    expect(runBuffCount(s.run)).toBe(2);
    beginStage(s.run!, { stage: 4, online: true, bootId: 'b', tabId: 't', aliveAt: 0 });
    expect(applyResult(s, { runId: RUN_ID, stage: 4, outcome: 'void', reason: 'server', loot: [], carry: null, bossClear: false })).toEqual({ kind: 'void' });
    expect(s.run).toMatchObject({ stage: 4, status: 'lobby', bag: loot });
    beginStage(s.run!, { stage: 4, online: true, bootId: 'b', tabId: 't', aliveAt: 0 });
    expect(applyResult(s, { runId: 'someoneElse12345', stage: 4, outcome: 'failed', loot: [], carry: null, bossClear: false }).kind).toBe('ignored');
    expect(applyResult(s, { runId: RUN_ID, stage: 4, outcome: 'failed', reason: 'wipe', loot: [], carry: null, bossClear: false })).toEqual({ kind: 'failed', lost: 2 });
    expect(s.run).toBeNull();
    expect(serializeStash(s)).toBe(worn);
    expect(isFirstBossClear(s, 3)).toBe(true); // a lost run records nothing
  });

  it('claimRun: the whole bag into the stash and the run gone in one step; refused for another / running / no run', () => {
    const { s } = withRun();
    const n = s.items.length;
    beginStage(s.run!, { stage: 3, online: false, bootId: null, tabId: 't', aliveAt: 0 });
    applyResult(s, cleared(3, [{ slot: 'charm', tier: 3, rarity: 'common' }, { slot: 'relic', tier: 3, rarity: 'common', relicId: 'beast_collar' }], true));
    beginStage(s.run!, { stage: 4, online: false, bootId: null, tabId: 't', aliveAt: 0 });
    expect(claimRun(s, RUN_ID)).toEqual({ ok: false, reason: RUN_GONE_REASON }); // a stage is running
    s.run!.status = 'lobby';
    s.run!.pending = null;
    expect(claimRun(s, 'otherRUN12345678')).toEqual({ ok: false, reason: RUN_GONE_REASON });
    const r = claimRun(s, RUN_ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map(i => [i.slot, i.fromStage])).toEqual([['charm', 3], ['relic', 3]]);
    expect(r.buffs).toBe(2);
    expect(s.items).toHaveLength(n + 2);
    expect(r.items.every(i => isNew(s, i.uid))).toBe(true);
    expect(s.run).toBeNull();
    expect(isFirstBossClear(s, 3)).toBe(false);
    expect(claimRun(s, RUN_ID)).toEqual({ ok: false, reason: RUN_GONE_REASON }); // double claim (stale tab)
    expect(stashLocked(s)).toBe(false);
  });

  it('a cancelled first match drops an empty run only', () => {
    const { s } = withRun();
    expect(dropEmptyRun(s)).toBe(true);
    expect(s.run).toBeNull();
    const w = withRun();
    beginStage(w.s.run!, { stage: 3, online: false, bootId: null, tabId: 't', aliveAt: 0 });
    expect(dropEmptyRun(w.s)).toBe(false); // a stage is running
    applyResult(w.s, cleared(3, []));
    expect(w.s.run).toMatchObject({ status: 'lobby', cleared: 1 });
    expect(dropEmptyRun(w.s)).toBe(false); // it cleared a stage: 수령 only
  });
});
