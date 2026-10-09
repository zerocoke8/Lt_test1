// 기획 15차 원정: browser persistence of the stash + mode (src/ui/expeditionStore.ts) and the stash screen's pure view
// (src/ui/expeditionEquip.ts stashView). The stash model itself is covered in tests/sim/expedition-stash.test.ts.
import { describe, expect, it } from 'vitest';
import { GEAR_ART_KEY, loadGearArtFiles, loadMode, loadStash, saveGearArtFiles, saveMode, saveStash, type KeyValueStore } from '../../src/ui/expeditionStore';
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
  markSeen,
  maxStartStageFor,
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
    expect(loadStash(memStore({ [STASH_KEY]: JSON.stringify({ v: 2, items: [{ uid: 'g1', slot: 'weapon', tier: 3, rarity: 'common' }] }) })).items).toEqual([]);
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
