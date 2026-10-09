// 기획 15차 원정: browser persistence of the stash + mode (src/ui/expeditionStore.ts) and the stash screen's pure view
// (src/ui/expeditionEquip.ts stashView). The stash model itself is covered in tests/sim/expedition-stash.test.ts.
import { describe, expect, it } from 'vitest';
import {
  GEAR_ART_KEY,
  SOLO_STALE_MS,
  TAB_ID,
  loadGearArtFiles,
  loadMode,
  loadStash,
  randomRunId,
  reconcileDecision,
  saveGearArtFiles,
  saveMode,
  saveStash,
  updateStash,
  type KeyValueStore,
  type ReconcileCtx,
} from '../../src/ui/expeditionStore';
import { applyStageResult, beginStage, startRun, toLobby, type ExpeditionRun } from '../../src/expedition/run';
import { RUN_ID_RE } from '../../src/expedition/runCheck';
import {
  MODE_KEY,
  STASH_KEY,
  addItems,
  autoEquip,
  emptyStash,
  equip,
  freeItems,
  grantPartySet,
  grantRandom,
  grantRelics,
  grantSet,
  loadoutsFor,
  applyResult,
  beginRun,
  claimRun,
  markSeen,
  maxStartStageFor,
  RUN_GONE_REASON,
  RUN_LOCK_REASON,
  resetStash,
  setPreset,
} from '../../src/expedition/stash';
import { maxStartStage } from '../../src/data/gear';
import { stashView } from '../../src/ui/expeditionEquip';

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const party = ['guardian', 'blade', 'cleric'];

describe('expedition store (10장)', () => {
  it('missing, corrupt, wrong-version or blocked storage → an empty stash (never throws)', () => {
    expect(loadStash(memStore()).items).toEqual([]);
    expect(loadStash(memStore({ [STASH_KEY]: '{not json' })).items).toEqual([]);
    expect(loadStash(memStore({ [STASH_KEY]: JSON.stringify({ v: 3, items: [{ uid: 'g1', slot: 'weapon', tier: 3, rarity: 'common' }] }) })).items).toEqual([]);
    expect(loadStash(broken)).toEqual(emptyStash());
    expect(loadStash(null)).toEqual(emptyStash());
    expect(saveStash(emptyStash(), broken)).toBe(false);
  });

  it('save → load keeps items, what each character wears, NEW marks, boss clears, the party and the unlock flag', () => {
    const st = memStore();
    const s = emptyStash();
    grantSet(s, 'blade', 4);
    const [r] = grantRelics(s, 6);
    equip(s, 'guardian', r.uid);
    markSeen(s, [r.uid]);
    s.bossFirstClears.push(3);
    setPreset(s, { characters: party, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
    s.unlockAll = true;
    expect(saveStash(s, st)).toBe(true);
    expect(st.data.has(STASH_KEY)).toBe(true);
    const back = loadStash(st);
    expect(back).toEqual(JSON.parse(JSON.stringify(s)));
    expect(back.equipped.blade.weapon).toBeTruthy();
    expect(back.equipped.guardian.relic).toBe(r.uid);
  });

  it('a stored item with a bad tier / slot / option is dropped, the rest survives', () => {
    const raw = {
      v: 1,
      nextUid: 9,
      items: [
        { uid: 'g1', slot: 'weapon', tier: 3, rarity: 'common', fromStage: 3 },
        { uid: 'g2', slot: 'weapon', tier: 99, rarity: 'common', fromStage: 3 },
        { uid: 'g3', slot: 'hat', tier: 3, rarity: 'common', fromStage: 3 },
        { uid: 'g4', slot: 'charm', tier: 5, rarity: 'rare', optionId: 'w_scorch', fromStage: 5 },
      ],
      equipped: { blade: { weapon: 'g1', armor: 'g2' } },
      seen: ['g1', 'gX'],
    };
    const s = loadStash(memStore({ [STASH_KEY]: JSON.stringify(raw) }));
    expect(s.items.map(i => i.uid)).toEqual(['g1']);
    expect(s.equipped).toEqual({ blade: { weapon: 'g1' } });
    expect(s.seen).toEqual(['g1']);
    expect(s.nextUid).toBe(9);
  });

  it('mode and the gear-art debug setting', () => {
    const st = memStore();
    expect(loadMode(st)).toBeNull();
    saveMode('expedition', st);
    expect(st.data.get(MODE_KEY)).toBe('expedition');
    expect(loadMode(st)).toBe('expedition');
    st.data.set(MODE_KEY, 'tower');
    expect(loadMode(st)).toBeNull();
    expect(loadMode(broken)).toBeNull();
    expect(loadGearArtFiles(st)).toBe(false);
    saveGearArtFiles(true, st);
    expect(st.data.get(GEAR_ART_KEY)).toBe('file');
    expect(loadGearArtFiles(st)).toBe(true);
  });

  it('equipping moves the item out of the free stash; the piece it replaces goes back', () => {
    const s = emptyStash();
    const [a, b] = addItems(s, [{ slot: 'armor', tier: 2, rarity: 'common' }, { slot: 'armor', tier: 5, rarity: 'common' }], 2);
    equip(s, 'blade', a.uid);
    expect(freeItems(s).map(i => i.uid)).toEqual([b.uid]);
    equip(s, 'blade', b.uid);
    expect(freeItems(s).map(i => i.uid)).toEqual([a.uid]);
    equip(s, 'mage', b.uid);
    expect(s.equipped.blade.armor).toBeUndefined();
    expect(s.equipped.mage.armor).toBe(b.uid);
  });

  it('auto-equip, start stage through loadoutsFor, debug grants and reset', () => {
    const s = emptyStash();
    expect(maxStartStageFor(s, party)).toBe(1);
    grantPartySet(s, party, 1);
    expect(maxStartStage(loadoutsFor(s, party))).toBe(2);
    expect(maxStartStageFor(s, party)).toBe(2);
    addItems(s, [{ slot: 'weapon', tier: 6, rarity: 'common' }], 6);
    expect(autoEquip(s, party)).toHaveLength(1);
    expect(loadoutsFor(s, party)[0].weapon?.tier).toBe(6);
    expect(maxStartStageFor(s, party)).toBe(2);
    grantRelics(s, 3);
    expect(maxStartStageFor(s, party)).toBe(2); // relics never count
    expect(grantRandom(s, 10)).toHaveLength(10);
    s.unlockAll = true;
    expect(maxStartStageFor(s, party)).toBe(12);
    setPreset(s, { characters: party, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
    const fresh = resetStash(s);
    expect(fresh.items).toEqual([]);
    expect(fresh.equipped).toEqual({});
    expect(fresh.preset?.characters).toEqual(party);
    expect(fresh.unlockAll).toBe(true);
  });
});

describe('stash grid view (8-3)', () => {
  const s = emptyStash();
  const items = addItems(
    s,
    [
      { slot: 'weapon', tier: 2, rarity: 'common' },
      { slot: 'armor', tier: 9, rarity: 'rare', optionId: 'a_evac' },
      { slot: 'weapon', tier: 9, rarity: 'epic', optionId: 'w_scorch' },
      { slot: 'charm', tier: 4, rarity: 'common' },
    ],
    1,
  );
  const uid = items.map(i => i.uid);

  it('tier order (then rarity), newest order, slot filter, NEW filter, minus what this character wears', () => {
    expect(stashView(s.items, new Set(), 'all', 'tier', []).map(i => i.uid)).toEqual([uid[2], uid[1], uid[3], uid[0]]);
    expect(stashView(s.items, new Set(), 'all', 'new', []).map(i => i.uid)).toEqual([uid[3], uid[2], uid[1], uid[0]]);
    expect(stashView(s.items, new Set(), 'weapon', 'tier', []).map(i => i.uid)).toEqual([uid[2], uid[0]]);
    expect(stashView(s.items, new Set(), 'new', 'tier', [uid[2], uid[1]]).map(i => i.uid)).toEqual([uid[3], uid[0]]);
    expect(stashView(s.items, new Set([uid[2]]), 'all', 'tier', []).map(i => i.uid)).toEqual([uid[1], uid[3], uid[0]]);
  });
});

// ─────────────────────────── 기획 16차: the run in the stash (10장) ───────────────────────────

const LOCK = { characters: party, pets: ['frog_bomb', 'fairy_heal', 'cat_void'], gear: [{}, {}, {}] };

/** A stash with a run that cleared stage 1 (one T1 armor in the bag). */
function stashWithRun(): { s: ReturnType<typeof emptyStash>; run: ExpeditionRun } {
  const s = emptyStash();
  const run = startRun(1, LOCK, randomRunId(), 3);
  beginRun(s, run);
  beginStage(s.run!, { stage: 1, online: false, bootId: null, tabId: TAB_ID, aliveAt: 0 });
  applyResult(s, { runId: run.id, stage: 1, outcome: 'cleared', loot: [{ slot: 'armor', tier: 1, rarity: 'common' }], carry: null, bossClear: false });
  return { s, run: s.run! };
}

describe('the run in the stash (기획 16차)', () => {
  it('ids are legal run ids; a v1 stash reads as v2 with no run', () => {
    expect(RUN_ID_RE.test(randomRunId())).toBe(true);
    expect(RUN_ID_RE.test(TAB_ID)).toBe(true);
    const v1 = { v: 1, nextUid: 2, items: [{ uid: 'g1', slot: 'weapon', tier: 3, rarity: 'common', fromStage: 3 }], equipped: {}, seen: [] };
    const s = loadStash(memStore({ [STASH_KEY]: JSON.stringify(v1) }));
    expect(s.v).toBe(2);
    expect(s.items).toHaveLength(1);
    expect(s.run).toBeNull();
  });

  it('a run in the lobby survives a reload (save → load)', () => {
    const st = memStore();
    const { s, run } = stashWithRun();
    saveStash(s, st);
    const back = loadStash(st);
    expect(back.run).toMatchObject({ id: run.id, stage: 2, cleared: 1, status: 'lobby' });
    expect(back.run?.bag).toEqual([{ slot: 'armor', tier: 1, rarity: 'common' }]);
  });

  it('locked while a run exists: equip / party / grants refused with the reason', () => {
    const { s } = stashWithRun();
    const [it] = addItems(s, [{ slot: 'weapon', tier: 1, rarity: 'common' }], 1);
    expect(equip(s, 'blade', it.uid)).toEqual({ ok: false, reason: RUN_LOCK_REASON });
    expect(setPreset(s, { characters: party, pets: LOCK.pets })).toEqual({ ok: false, reason: RUN_LOCK_REASON });
    expect(grantSet(s, 'blade', 3)).toEqual([]);
    expect(autoEquip(s, party)).toEqual([]);
    expect(resetStash(s)).toBe(s);
    markSeen(s, [it.uid]); // looking is fine
    expect(s.seen).toContain(it.uid);
  });

  it('updateStash re-reads what is stored: another tab’s claim wins, this tab’s stale copy cannot claim again', () => {
    const st = memStore();
    const { s } = stashWithRun();
    saveStash(s, st);
    const tabA = loadStash(st);
    const tabB = loadStash(st); // the other tab's copy, now stale after A's claim
    const a = updateStash(tabA, x => claimRun(x, x.run!.id), st);
    expect(a.result).toMatchObject({ ok: true });
    expect(a.stash.items).toHaveLength(1);
    expect(a.stash.run).toBeNull();
    const b = updateStash(tabB, x => claimRun(x, tabB.run!.id), st);
    expect(b.result).toEqual({ ok: false, reason: RUN_GONE_REASON });
    expect(loadStash(st).items).toHaveLength(1); // no double claim
  });

  it('updateStash on blocked storage works on the copy in memory', () => {
    const s = emptyStash();
    const r = updateStash(s, x => addItems(x, [{ slot: 'charm', tier: 2, rarity: 'common' }], 2).length, broken);
    expect(r.result).toBe(1);
    expect(r.stash).toBe(s);
  });

  it('a stage result applies once (a second delivery is ignored); a claim while a stage runs is refused', () => {
    const { s, run } = stashWithRun();
    beginStage(s.run!, { stage: 2, online: true, bootId: 'boot1', tabId: TAB_ID, aliveAt: 0 });
    expect(claimRun(s, run.id)).toEqual({ ok: false, reason: RUN_GONE_REASON });
    const res = { runId: run.id, stage: 2, outcome: 'cleared' as const, loot: [{ slot: 'weapon' as const, tier: 2, rarity: 'common' as const }], carry: null, bossClear: false };
    expect(applyResult(s, res).kind).toBe('cleared');
    expect(applyResult(s, res).kind).toBe('ignored');
    expect(s.run?.bag).toHaveLength(2);
  });
});

describe('reconcile a stored run (10-4)', () => {
  const base: ReconcileCtx = { now: 100_000, tabId: 'me', busy: false, matching: false, bootId: null };
  const inStage = (online: boolean, tabId: string, aliveAt: number, bootId: string | null = null): ExpeditionRun => {
    const run = startRun(1, LOCK, 'reconcile01', 1);
    beginStage(run, { stage: 1, online, bootId, tabId, aliveAt });
    return run;
  };

  it('nothing to settle without a run, while this page plays / queues, or in the lobby', () => {
    expect(reconcileDecision(null, base)).toBe('none');
    expect(reconcileDecision(inStage(false, 'other', 0), { ...base, busy: true })).toBe('none');
    const lobby = startRun(1, LOCK, 'reconcile02', 1);
    toLobby(lobby);
    expect(reconcileDecision(lobby, base)).toBe('none');
  });

  it("'matching' with no live match → back to the lobby", () => {
    const run = startRun(1, LOCK, 'reconcile03', 1);
    expect(reconcileDecision(run, base)).toBe('toLobby');
    expect(reconcileDecision(run, { ...base, matching: true })).toBe('none');
  });

  it('solo: another tab alive → wait; silent > 10 s or this tab after a reload → fail', () => {
    expect(reconcileDecision(inStage(false, 'other', base.now - 3000), base)).toBe('wait');
    expect(reconcileDecision(inStage(false, 'other', base.now - SOLO_STALE_MS - 1), base)).toBe('fail');
    expect(reconcileDecision(inStage(false, 'me', base.now), base)).toBe('fail');
  });

  it('solo, combat already won (pending.won saved): a stale stage settles as won, and the saved result survives a reload', () => {
    const won = { loot: [{ slot: 'weapon' as const, tier: 1, rarity: 'common' as const }], carry: { rewards: [{ rewardId: 'atk_common', partyIndex: null }], goedamTraces: [], ult: [0, 0, 0] }, bossClear: false };
    const run = inStage(false, 'other', base.now - SOLO_STALE_MS - 1);
    run.pending!.won = won;
    expect(reconcileDecision(run, base)).toBe('won');
    run.pending!.aliveAt = base.now - 3000;
    expect(reconcileDecision(run, base)).toBe('wait');
    const st = memStore();
    const s = emptyStash();
    s.run = run;
    saveStash(s, st);
    expect(loadStash(st).run?.pending?.won).toEqual(won);
    // a saved result that could not come out of this stage is dropped (the stage then counts as failed)
    run.pending!.won = { ...won, loot: [{ slot: 'weapon', tier: 5, rarity: 'common' }] };
    saveStash(s, st);
    expect(loadStash(st).run?.pending?.won).toBeUndefined();
    expect(loadStash(st).run?.status).toBe('inStage');
  });

  it('online: no server yet → wait; the same boot → ask (expStatus); another boot → void', () => {
    expect(reconcileDecision(inStage(true, 'other', 0, 'boot1'), base)).toBe('wait');
    expect(reconcileDecision(inStage(true, 'other', 0, 'boot1'), { ...base, bootId: 'boot1' })).toBe('status');
    expect(reconcileDecision(inStage(true, 'other', 0, 'boot1'), { ...base, bootId: 'boot2' })).toBe('void');
    expect(reconcileDecision(inStage(true, 'other', 0, null), { ...base, bootId: 'boot2' })).toBe('status');
  });

  it('a result applied after a void keeps the bag and plays the same stage again', () => {
    const run = inStage(true, 'me', 0, 'boot1');
    expect(applyStageResult(run, { runId: run.id, stage: 1, outcome: 'void', reason: 'server', loot: [], carry: null, bossClear: false })).toBe('void');
    expect(run).toMatchObject({ stage: 1, status: 'lobby', pending: null });
  });
});
