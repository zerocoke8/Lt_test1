// 기획 16차 원정 모드 (docs/expedition.md 3장, 4-5, 5장, 7장): a stage is ONE floor. Stage plans, the normal stage
// (combat clear → floor reward → (괴담 room) → 'stageClear') and the boss stage (clear → 'stageClear'), loot rolls, a quit
// after the clear (still a clear), the carry between stages, the room / 돌발 괴담 rates, bots, failure, determinism —
// and the classic tower untouched.
import { describe, expect, it } from 'vitest';
import { ARENA_BOSS, ARENA_NORMAL, DEFAULT_TUNABLES, floorStatMult } from '../../src/config';
import { FIELD_EVENT_EARLIEST, FIELD_EVENT_LATEST, GOEDAM_ROOMS } from '../../src/data';
import { EXPEDITION, STAGE_FOE, botLoadout, equivFloor, maxStartStage, type GearLoadout, type GearSpec } from '../../src/data/gear';
import {
  expeditionRoomAfter,
  expeditionStatMult,
  extractCarry,
  planExpeditionFieldEvent,
  planExpeditionFloor,
  rollStageLoot,
  stageResultFromState,
  wonResultFromState,
} from '../../src/sim/expedition';
import { tick } from '../../src/sim/game';
import { Rng } from '../../src/sim/rng';
import type { ExpeditionSetup, PlayerSetup } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, eventsOf, makeGame, type TestGame } from './helpers';

/** Spec 3-3: the classic floor multiplier at each stage's equivalent floor (rounded to 0.01, late growth 1.36). */
const TABLE = [1.12, 1.3, 1.48, 1.81, 2.05, 2.3, 2.62, 2.87, 3.11, 3.44, 3.68, 3.93];
const EQUIV = [2, 3.5, 5, 7, 8.5, 10, 12, 13.5, 15, 17, 18.5, 20];
const FOES = ['elevator_girl', 'ogre', 'elevator_keeper', 'elevator_girl', 'copier_beast', 'overtime_lord', 'signal_man', 'head_nurse', 'surgeon_director', 'head_nurse', 'signal_man', 'abyss_watcher'];
const THEMES = ['lobby', 'office', 'ward', 'rooftop'];

const set = (t: number): GearLoadout => ({ weapon: { slot: 'weapon', tier: t, rarity: 'common' }, armor: { slot: 'armor', tier: t, rarity: 'common' }, charm: { slot: 'charm', tier: t, rarity: 'common' } });

function expGame(expedition: ExpeditionSetup, opts: { seed?: number; players?: PlayerSetup[]; invincible?: boolean; tunables?: Record<string, number | boolean> } = {}): TestGame {
  return makeGame({
    seed: opts.seed ?? 4242,
    players: opts.players ?? [HUMAN, BOT1, BOT2],
    tunables: { ...(opts.invincible === false ? {} : { invincible: true }), ...(opts.tunables ?? {}) },
    expedition,
  });
}

/** Win the stage's combat now (debug), then pick the first offer for every waiting human and leave any room. */
function clearStage(tg: TestGame): void {
  const s = tg.w.state;
  expect(tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }).ok).toBe(true);
  for (let guard = 0; guard < 10 && (s.phase === 'reward' || s.phase === 'goedam'); guard++) {
    if (s.phase === 'reward') s.rewardOffersByPlayer.forEach((o, pi) => o && tg.game.dispatch({ type: 'chooseReward', player: pi, offerIndex: 0 }));
    else s.goedam!.players.forEach((pr, pi) => tg.game.dispatch({ type: 'goedam', player: pi, option: pr.stage === 'choosing' ? 'leave' : 'continue' }));
  }
}

/** Play with bots only until the stage's combat ends (or `limit` s). */
function playOut(tg: TestGame, limit = 900): void {
  const s = tg.w.state;
  for (let t = 0; t < limit * 30 && s.phase === 'combat'; t++) tick(tg.w);
}

describe('stage plans (3-1 ~ 3-3): one floor per stage', () => {
  it('multipliers, foes, waves, arenas and timers match the 12-stage table', () => {
    for (let st = 1; st <= 12; st++) {
      const p = planExpeditionFloor(st, new Rng(st), DEFAULT_TUNABLES);
      const k = EXPEDITION.stageMult[st - 1];
      expect(equivFloor(st)).toBe(EQUIV[st - 1]);
      expect(Math.abs(p.statMult / k - TABLE[st - 1])).toBeLessThan(0.006);
      expect(p.statMult).toBeCloseTo(expeditionStatMult(equivFloor(st), DEFAULT_TUNABLES.floorStatGrowth) * k, 12);
      expect(p).toMatchObject({ floor: 1, stage: st, equivFloor: EQUIV[st - 1], theme: THEMES[Math.floor((st - 1) / 3)] });
      expect('stageFloor' in p).toBe(false);
      expect(STAGE_FOE[st - 1]).toBe(FOES[st - 1]);
      if (st % 3 === 0) {
        expect(p).toMatchObject({ kind: 'boss', bossId: FOES[st - 1], timeLimit: EXPEDITION.bossEnrage, bossHpMult: EXPEDITION.bossHp, arena: ARENA_BOSS });
        expect(p.waves).toHaveLength(0);
        expect(p.guardian).toBeUndefined();
        expect(p.maxGap).toBeUndefined();
      } else {
        expect(p).toMatchObject({ kind: 'normal', midBossId: FOES[st - 1], timeLimit: 150, maxGap: 11, arena: ARENA_NORMAL });
        expect(p.waves).toHaveLength(st <= 2 ? 7 : 6);
        p.waves.forEach((w, i) => expect(w.at).toBe(1 + i * EXPEDITION.waveGap));
        expect(p.guardian).toEqual({ monsterId: FOES[st - 1], hpMult: EXPEDITION.guardianHp, atkMult: EXPEDITION.guardianAtk });
      }
    }
    expect(ARENA_NORMAL.width).toBe(24);
    expect(EXPEDITION.waves).toEqual([7, 7, 0, 6, 6, 0, 6, 6, 0, 6, 6, 0]);
  });

  it('boss stages are exactly classic 5 · 10 · 15 · 20 (same multiplier as the classic boss floor)', () => {
    for (const [st, f] of [[3, 5], [6, 10], [9, 15], [12, 20]]) {
      expect(equivFloor(st)).toBe(f);
      expect(expeditionStatMult(f, 0.12)).toBeCloseTo(floorStatMult(f, 0.12), 12);
    }
  });

  it('stageMult scales a stage (bench knob)', () => {
    const keep = EXPEDITION.stageMult[3];
    const before = planExpeditionFloor(4, new Rng(1), DEFAULT_TUNABLES).statMult;
    EXPEDITION.stageMult[3] = keep * 1.1;
    try {
      expect(planExpeditionFloor(4, new Rng(1), DEFAULT_TUNABLES).statMult).toBeCloseTo(before * 1.1, 9);
    } finally {
      EXPEDITION.stageMult[3] = keep;
    }
  });

  it('the 수문장 comes as the stage mid boss, enhanced by guardianHp / guardianAtk; the boss gets HP × bossHp', () => {
    const keep = [EXPEDITION.guardianHp, EXPEDITION.guardianAtk];
    EXPEDITION.guardianHp = 1.25;
    EXPEDITION.guardianAtk = 1.1;
    try {
      const tg = expGame({ stage: 2 });
      const s = tg.w.state;
      for (let t = 0; t < 150 && !s.entities.some(e => e.tier === 'mid'); t++) advance(tg, 1);
      const g = s.entities.find(e => e.tier === 'mid')!;
      expect(g.defId).toBe('ogre');
      expect(g.rt.base.maxHp).toBeCloseTo(g.rt.monDef!.stats.maxHp * s.plan.statMult * 1.25, 6);
      expect(g.rt.base.atk).toBeCloseTo(g.rt.monDef!.stats.atk * s.plan.statMult * 1.1, 6);
    } finally {
      [EXPEDITION.guardianHp, EXPEDITION.guardianAtk] = keep;
    }
    const tb = expGame({ stage: 3 });
    const boss = tb.w.byId.get(tb.w.state.bossId!)!;
    expect(boss.defId).toBe('elevator_keeper');
    expect(boss.maxHp).toBeCloseTo(boss.rt.monDef!.stats.maxHp * tb.w.state.plan.statMult * EXPEDITION.bossHp, 6);
    expect(tb.w.state.bossGroggy).not.toBeNull();
  });

  it('a debug floor jump stays on floor 1 (it restarts the stage floor)', () => {
    const tg = expGame({ stage: 4 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    expect(tg.w.state.floor).toBe(1);
    expect(tg.w.state.plan.stage).toBe(4);
  });
});

describe('normal stage: clear → floor reward → (room) → stageClear (5-2)', () => {
  it('the combat clear rolls the loot and is final; one reward pick ends the stage', () => {
    const tg = expGame({ stage: 1 });
    const s = tg.w.state;
    expect(s.expedition).toEqual({ stage: 1, boss: false, outcome: 'running', loot: [[], [], []], humans: [true, false, false], goedamSeen: [] });
    expect(stageResultFromState(s, 0)).toBeNull();
    expect(wonResultFromState(s, 0)).toBeNull();
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(s.phase).toBe('reward');
    expect(s.expedition!.outcome).toBe('cleared');
    expect(s.expedition!.loot[0]).toHaveLength(EXPEDITION.lootNormal);
    expect(s.expedition!.loot[0].every(g => g.tier === 1 && g.slot !== 'relic')).toBe(true);
    expect(s.expedition!.loot[1]).toEqual([]);
    expect(eventsOf(tg, 'stageClear')).toEqual([{ type: 'stageClear', stage: 1 }]);
    expect(s.rewardOffersByPlayer[0]!.some(o => o.isRelic)).toBe(false);
    expect(stageResultFromState(s, 0)).toBeNull(); // not over yet
    // 기획 16차: what a drop now would give (saved by the solo controller): the loot + one of the open offers
    const early = wonResultFromState(s, 0)!;
    expect(early.loot).toEqual(s.expedition!.loot[0]);
    expect(early.carry.rewards).toHaveLength(1);
    expect(s.rewardOffersByPlayer[0]!.map(o => o.rewardId)).toContain(early.carry.rewards[0].rewardId);
    // a won stage can no longer be lost
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }).ok).toBe(false);
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(s.phase).toBe('stageClear');
    expect(s.floor).toBe(1);
    expect(s.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 1 });
    const res = stageResultFromState(s, 0)!;
    expect(wonResultFromState(s, 0)).toEqual(res);
    expect(res.loot).toEqual(s.expedition!.loot[0]);
    expect(res.bossClear).toBe(false);
    expect(res.carry.rewards).toHaveLength(1);
    expect(res.carry.rewards).toEqual(s.players[0].rewards);
    // frozen: ticking does nothing, quit / debug refused
    const t = s.tick;
    tg.game.step(1);
    expect(s.tick).toBe(t);
    expect(tg.game.dispatch({ type: 'quit' }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } }).ok).toBe(false);
    expect(s.expedition!.outcome).toBe('cleared');
  });

  it('a 괴담 room after the reward, then the stage ends', () => {
    const tg = expGame({ stage: 4 });
    const s = tg.w.state;
    tg.game.dispatch({ type: 'debug', action: { kind: 'goedamNext' } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(s.phase).toBe('goedam');
    tg.game.dispatch({ type: 'goedam', player: 0, option: 'leave' });
    tg.game.dispatch({ type: 'goedam', player: 0, option: 'continue' });
    expect(s.phase).toBe('stageClear');
    expect(extractCarry(s, 0).goedamSeen).toContain(s.players[0].goedamLog[0].roomId);
  });

  it('「나가기」 after the clear is still a clear: a random reward, the room passed, the stage ends', () => {
    const tg = expGame({ stage: 2 });
    const s = tg.w.state;
    tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    expect(s.phase).toBe('reward');
    expect(tg.game.dispatch({ type: 'quit' }).ok).toBe(true);
    expect(s.phase).toBe('stageClear');
    expect(s.expedition!.outcome).toBe('cleared');
    expect(s.players[0].rewards).toHaveLength(1);
    expect(stageResultFromState(s, 0)!.loot).toHaveLength(1);
    // in the room
    const tr = expGame({ stage: 5 });
    tr.game.dispatch({ type: 'debug', action: { kind: 'goedamNext' } });
    tr.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    tr.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(tr.w.state.phase).toBe('goedam');
    tr.game.dispatch({ type: 'quit' });
    expect(tr.w.state.phase).toBe('stageClear');
    expect(tr.w.state.players[0].goedamLog[0].optionId).toBe('leave');
  });

  it('two humans: one drops during the reward (random pick), the stage ends when the other picks', () => {
    const tg = expGame({ stage: 1 }, { players: [HUMAN, { ...HUMAN, name: '둘' }, BOT1] });
    const s = tg.w.state;
    tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    expect(s.expedition!.humans).toEqual([true, true, false]);
    expect(s.expedition!.loot[1]).toHaveLength(1);
    tg.game.setPlayerBot(1, true);
    expect(s.players[1].rewards).toHaveLength(1);
    expect(s.phase).toBe('reward');
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 1 });
    expect(s.phase).toBe('stageClear');
    expect(stageResultFromState(s, 1)!.loot).toEqual(s.expedition!.loot[1]);
  });

  it('wipe / timeout / quit before the clear lose the stage (outcome failed)', () => {
    const tg = expGame({ stage: 1 });
    tg.game.dispatch({ type: 'quit' });
    expect(tg.w.state.expedition!.outcome).toBe('failed');
    expect(tg.w.state.phase).toBe('runOver');
    expect(stageResultFromState(tg.w.state, 0)).toBeNull();
    const tw = expGame({ stage: 11 }, { invincible: false, players: [HUMAN] });
    playOut(tw, 400);
    expect(tw.w.state.phase).toBe('runOver');
    expect(tw.w.state.expedition!.outcome).toBe('failed');
    expect(['wipe', 'timeout']).toContain(tw.w.state.runResult!.reason);
  });

  it('bots clear stage 1 within the time limit (sanity, not the balance bench)', () => {
    const tg = expGame({ stage: 1 }, { invincible: false, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
    playOut(tg, 200);
    const s = tg.w.state;
    expect(s.expedition!.outcome).toBe('cleared');
    expect(s.phase).toBe('stageClear'); // bots picked their reward at once
    expect(s.time).toBeGreaterThan(20);
    expect(s.time).toBeLessThan(150);
    expect(tg.w.floorTimes.map(f => f.floor)).toEqual([1]);
  });
});

describe('boss stage: clear → stageClear, no floor reward (5-2)', () => {
  it('debug clear: straight to the stage end with the boss box', () => {
    const tg = expGame({ stage: 6, firstBossClear: [true] });
    const s = tg.w.state;
    expect(s.expedition!.boss).toBe(true);
    tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    expect(s.phase).toBe('stageClear');
    expect(s.rewardOffersByPlayer.every(o => o == null)).toBe(true);
    expect(s.players[0].rewards).toEqual([]);
    const res = stageResultFromState(s, 0)!;
    expect(res.bossClear).toBe(true);
    expect(res.loot).toHaveLength(EXPEDITION.lootBossBase + 1);
    expect(res.loot[res.loot.length - 1]).toMatchObject({ slot: 'relic', tier: 6 });
    const classic = makeGame();
    expect(classic.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }).ok).toBe(false);
  });

  it('debug wipe (기획 16차 integration): the stage is lost in combat only, never after the clear', () => {
    const tg = expGame({ stage: 2 });
    const s = tg.w.state;
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'wipeParty' } }).ok).toBe(true);
    expect(s.phase).toBe('runOver');
    expect(s.runResult).toMatchObject({ outcome: 'defeat', reason: 'wipe' });
    expect(s.expedition!.outcome).toBe('failed');
    expect(stageResultFromState(s, 0)).toBeNull();
    const won = expGame({ stage: 2 });
    won.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    expect(won.w.state.phase).toBe('reward');
    expect(won.game.dispatch({ type: 'debug', action: { kind: 'wipeParty' } }).ok).toBe(false);
    expect(won.w.state.expedition!.outcome).toBe('cleared');
  });

  it('bots clear boss stage 3 (sanity)', () => {
    const tg = expGame({ stage: 3 }, { invincible: false, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
    playOut(tg, 400);
    expect(tg.w.state.phase).toBe('stageClear');
    expect(tg.w.state.time).toBeLessThan(300);
  });
});

describe('loot (4-5)', () => {
  const party: GearLoadout[] = [set(2), set(2), { weapon: set(2).weapon, armor: set(2).armor }];

  it('is deterministic per seed / stage / player and independent of the run rng', () => {
    const a = rollStageLoot(77, 4, 0, party, false, 0);
    expect(rollStageLoot(77, 4, 0, party, false, 0)).toEqual(a);
    const others = [rollStageLoot(77, 4, 1, party, false, 0), rollStageLoot(78, 4, 0, party, false, 0), rollStageLoot(77, 5, 0, party, false, 0)];
    expect(others.some(o => JSON.stringify(o) !== JSON.stringify(a))).toBe(true);
    // the loot never perturbs the combat: first-clear (relic) vs not → the same fight, only the loot differs
    const run = (first: boolean) => {
      const tg = expGame({ stage: 3, firstBossClear: [first] }, { seed: 99, invincible: false, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
      playOut(tg, 300);
      return JSON.stringify(tg.w.state, (k, v) => (k === 'rt' || k === 'loot' ? undefined : v));
    };
    expect(run(true)).toBe(run(false));
  });

  it('normal stage: lootNormal (1) base item at tier = stage; boss stage: lootBossBase (1) + the boss box', () => {
    for (let seed = 0; seed < 40; seed++) {
      const n = rollStageLoot(seed, 5, 0, party, false, 0);
      expect(n).toHaveLength(1);
      expect(n.every(g => g.tier === 5 && g.slot !== 'relic')).toBe(true);
      const b = rollStageLoot(seed, 9, 0, party, true, 0);
      expect(b).toHaveLength(2);
      expect(b[1]).toMatchObject({ slot: 'relic', tier: 9 });
      expect(maxStartStage([{ relic: b[1] }, {}, {}])).toBe(1);
    }
    let relics = 0;
    for (let seed = 0; seed < 400; seed++) if (rollStageLoot(seed, 12, 0, party, false, 0)[1].slot === 'relic') relics++;
    expect(relics / 400).toBeGreaterThan(0.72);
    expect(relics / 400).toBeLessThan(0.88);
  });

  it('loot counts follow the EXPEDITION knobs', () => {
    const keep = [EXPEDITION.lootNormal, EXPEDITION.lootBossBase];
    EXPEDITION.lootNormal = 2;
    EXPEDITION.lootBossBase = 0;
    try {
      expect(rollStageLoot(1, 4, 0, party, false, 0)).toHaveLength(2);
      expect(rollStageLoot(1, 6, 0, party, true, 0)).toEqual([expect.objectContaining({ slot: 'relic' })]);
    } finally {
      [EXPEDITION.lootNormal, EXPEDITION.lootBossBase] = keep;
    }
  });

  it('slot picks lean toward the slot the party lacks; T1–3 always common, options only on rare / epic', () => {
    const counts = { weapon: 0, armor: 0, charm: 0, relic: 0 };
    const all: GearSpec[] = [];
    for (let seed = 0; seed < 600; seed++) for (const g of rollStageLoot(seed, 2, 0, party, false, 0)) (counts[g.slot]++, all.push(g));
    expect(counts.charm / 600).toBeGreaterThan(0.5); // 4 / (1 + 1 + 4) ≈ 67 %
    expect(all.every(g => g.rarity === 'common' && g.optionId == null)).toBe(true);
    const late: GearSpec[] = [];
    for (let seed = 0; seed < 600; seed++) late.push(...rollStageLoot(seed, 11, 0, party, false, 3));
    expect(late.some(g => g.rarity === 'epic')).toBe(true);
    for (const g of late) expect(g.rarity === 'common' ? g.optionId == null : !!g.optionId).toBe(true);
    const rare = (cleared: number) => {
      let n = 0;
      for (let seed = 0; seed < 600; seed++) n += rollStageLoot(seed, 7, 0, party, false, cleared).filter(g => g.rarity !== 'common').length;
      return n;
    };
    expect(rare(3)).toBeGreaterThan(rare(0));
  });
});

describe('carry between stages (7장)', () => {
  it('rewards, traces (ticking once per stage) and per-character ult charge come along; HP and cooldowns are fresh', () => {
    const a = expGame({ stage: 1 });
    const sa = a.w.state;
    sa.players[0].party[1].ult.charge = 0.6;
    sa.players[0].party[2].ult.charge = 1;
    sa.players[0].goedamTraces.push({ id: 'silence', floorsLeft: 2 }, { id: 'red_paper', floorsLeft: null }, { id: 'passenger', floorsLeft: 1 });
    clearStage(a);
    expect(sa.phase).toBe('stageClear');
    const carry = stageResultFromState(sa, 0)!.carry;
    expect(carry).toEqual(extractCarry(sa, 0));
    expect(carry.rewards).toHaveLength(1);
    expect(carry.ult[1]).toBeCloseTo(0.6, 9);
    // one stage clear = one tick of the trace timers (expired ones gone)
    expect(carry.goedamTraces).toEqual([
      { id: 'silence', floorsLeft: 1 },
      { id: 'red_paper', floorsLeft: null },
    ]);
    const b = expGame({ stage: 2, carry: [carry], clearedThisRun: [1] });
    const p = b.w.state.players[0];
    expect(p.rewards).toEqual(carry.rewards);
    expect(p.goedamTraces).toEqual(carry.goedamTraces);
    expect(p.party[1].ult.charge).toBeCloseTo(0.6, 9);
    expect(p.party[2].ult).toEqual({ charge: 1, fullSince: 0 });
    for (const m of p.party) {
      expect(m.hp).toBeCloseTo(m.maxHp, 6);
      expect(m.swapCooldownRemaining).toBe(0);
    }
    expect(b.w.state.players[1].rewards).toEqual([]);
    clearStage(b);
    expect(stageResultFromState(b.w.state, 0)!.carry.goedamTraces).toEqual([{ id: 'red_paper', floorsLeft: null }]);
  });

  it('a carried +max-HP reward raises every member and the field character, all at full HP', () => {
    const plain = expGame({ stage: 2 }).w.state.players[0];
    const b = expGame({ stage: 2, carry: [{ rewards: [{ rewardId: 'hp_epic', partyIndex: null }], goedamTraces: [], ult: [0, 0, 0] }], clearedThisRun: [1] });
    const p = b.w.state.players[0];
    p.party.forEach((m, i) => {
      expect(m.maxHp).toBeGreaterThan(plain.party[i].maxHp * 1.3);
      expect(m.hp).toBeCloseTo(m.maxHp, 6);
    });
    const e = b.w.byId.get(p.party[p.activeIndex!].entityId!)!;
    expect(e.maxHp).toBeGreaterThan(plain.party[0].maxHp * 1.3);
    expect(e.hp).toBeGreaterThanOrEqual(p.party[p.activeIndex!].maxHp - 1e-6);
  });

  it('rooms seen earlier in the run never come again', () => {
    const office = GOEDAM_ROOMS.filter(r => r.zone === 'office').map(r => r.id);
    const tg = makeGame({ seed: 8, players: [HUMAN], tunables: { goedamRoomsPerZone: 99 }, expedition: { stage: 5, carry: [{ rewards: [], goedamTraces: [], ult: [0, 0, 0], goedamSeen: office }] } });
    expect(expeditionRoomAfter(tg.w)).toBeNull();
    expect(tg.w.state.expedition!.goedamSeen).toEqual(office);
  });
});

describe('bots and gear seats (7장)', () => {
  it('bots get T(stage − 1) commons (none on stage 1); humans keep exactly their gear', () => {
    const g1 = expGame({ stage: 1 });
    expect(g1.w.state.players[1].gear).toBeUndefined();
    expect(g1.w.state.players[0].gear).toBeUndefined();
    const mine: GearLoadout[] = [set(4), set(5), { relic: { slot: 'relic', tier: 3, rarity: 'common', relicId: 'echo_seal' } }];
    const g5 = expGame({ stage: 5 }, { players: [{ ...HUMAN, gear: mine }, BOT1, BOT2] });
    expect(g5.w.state.players[0].gear).toEqual(mine);
    expect(g5.w.state.players[1].gear).toEqual([botLoadout(5), botLoadout(5), botLoadout(5)]);
    expect(g5.w.state.players[0].gear![0]).not.toBe(mine[0]);
  });

  it('a classic game never has an expedition state or gear', () => {
    const tg = makeGame({ players: [HUMAN, BOT1] });
    expect('expedition' in tg.w.state).toBe(false);
    expect(tg.w.expedition).toBeUndefined();
    expect(tg.w.state.players.every(p => !('gear' in p))).toBe(true);
  });
});

describe('괴담 room and 돌발 괴담 in a stage (3-2)', () => {
  it('rooms after a normal stage about 1 in 5, from the stage zone, never 저주받은 유물, never after a boss stage', () => {
    let opened = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const tg = makeGame({ seed, players: [HUMAN], tunables: { goedamRoomsPerZone: 1 }, expedition: { stage: 5 } });
      const r = expeditionRoomAfter(tg.w);
      if (!r) continue;
      opened++;
      expect(r.zone).toBe('office');
      expect(r.id).not.toBe('cursed_relic');
      tg.w.goedam.seen.push(...GOEDAM_ROOMS.filter(x => x.zone === 'office').map(x => x.id));
      expect(expeditionRoomAfter(tg.w)).toBeNull();
    }
    expect(opened / 400).toBeGreaterThan(0.14);
    expect(opened / 400).toBeLessThan(0.27);
    const off = makeGame({ seed: 3, players: [HUMAN], tunables: { goedamRoomsPerZone: 0 }, expedition: { stage: 5 } });
    expect(expeditionRoomAfter(off.w)).toBeNull();
    for (let seed = 1; seed <= 50; seed++) {
      const boss = makeGame({ seed, players: [HUMAN], tunables: { goedamRoomsPerZone: 99 }, expedition: { stage: 6 } });
      expect(expeditionRoomAfter(boss.w)).toBeNull();
    }
  });

  it('stage 1 = the toad; other normal stages about 40 %; never on a boss stage; start in [8, 12] s', () => {
    const on = { fieldEventChance: 0.6, invincible: true };
    const t1 = makeGame({ seed: 5, players: [HUMAN], tunables: on, expedition: { stage: 1 } });
    expect(t1.w.fieldEvents.plan?.id).toBe('lucky_toad');
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const tg = makeGame({ seed, players: [HUMAN], tunables: on, expedition: { stage: 7 } });
      const plan = tg.w.fieldEvents.plan;
      if (!plan) continue;
      n++;
      expect(plan.startAt).toBeGreaterThanOrEqual(FIELD_EVENT_EARLIEST);
      expect(plan.startAt).toBeLessThanOrEqual(FIELD_EVENT_LATEST);
      expect(planExpeditionFieldEvent(tg.w, null)).toEqual(plan);
    }
    expect(n / 300).toBeGreaterThan(0.32);
    expect(n / 300).toBeLessThan(0.48);
    for (let seed = 1; seed <= 30; seed++) expect(makeGame({ seed, players: [HUMAN], tunables: on, expedition: { stage: 9 } }).w.fieldEvents.plan).toBeNull();
    // the tunable 0 switches them off (the toad too)
    expect(makeGame({ seed: 5, players: [HUMAN], tunables: { fieldEventChance: 0 }, expedition: { stage: 1 } }).w.fieldEvents.plan).toBeNull();
  });
});

describe('determinism', () => {
  it('same seed + setup + loadouts → identical stage', () => {
    const run = () => {
      const tg = expGame({ stage: 7, clearedThisRun: [2] }, { seed: 321, invincible: false, players: [{ ...HUMAN, isBot: true, gear: [set(6), set(6), set(6)] }, BOT1, BOT2] });
      tg.w.state.players[0].isBot = false; // a human seat that never acts (bots on the other seats)
      playOut(tg, 200);
      return JSON.stringify(tg.w.state, (k, v) => (k === 'rt' ? undefined : v));
    };
    expect(run()).toBe(run());
  });
});
