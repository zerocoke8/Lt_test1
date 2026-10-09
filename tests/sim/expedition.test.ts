// 기획 15차 원정 모드 (docs/expedition.md 3장, 4-5, 5장, 7장): stage plans, the stage flow up to 'stageClear', loot rolls,
// choices, the carry between stages, bots, failure, determinism — and the classic tower untouched.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES, floorStatMult } from '../../src/config';
import { GOEDAM_ROOMS } from '../../src/data';
import { EXPEDITION, botLoadout, equivFloor, maxStartStage, type GearLoadout, type GearSpec } from '../../src/data/gear';
import {
  expeditionChoiceTimeoutCommands,
  expeditionDecided,
  expeditionRoomAfter,
  expeditionStatMult,
  extractCarry,
  planExpeditionFloor,
  rollStageLoot,
} from '../../src/sim/expedition';
import { tick } from '../../src/sim/game';
import { Rng } from '../../src/sim/rng';
import type { ExpeditionSetup, PlayerSetup } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, eventsOf, makeGame, type TestGame } from './helpers';

/** Spec 3-3 monster multipliers (floor 1 / 2 / 3) per stage. */
const TABLE = [
  [1.0, 1.06, 1.12],
  [1.18, 1.24, 1.3],
  [1.36, 1.42, 1.48],
  [1.64, 1.72, 1.8],
  [1.88, 1.96, 2.04],
  [2.12, 2.2, 2.28],
  [2.44, 2.52, 2.6],
  [2.68, 2.76, 2.84],
  [2.92, 3.0, 3.08],
  [3.24, 3.32, 3.4],
  [3.48, 3.56, 3.64],
  [3.72, 3.8, 3.87],
];
const MIDS = [
  ['ogre', 'lich', 'elevator_girl'],
  ['lich', 'elevator_girl', 'ogre'],
  ['ogre', 'elevator_girl', 'elevator_keeper'],
  ['copier_beast', 'lich', 'elevator_girl'],
  ['lich', 'elevator_girl', 'copier_beast'],
  ['copier_beast', 'elevator_girl', 'overtime_lord'],
  ['head_nurse', 'copier_beast', 'signal_man'],
  ['copier_beast', 'signal_man', 'head_nurse'],
  ['signal_man', 'head_nurse', 'surgeon_director'],
  ['signal_man', 'copier_beast', 'head_nurse'],
  ['copier_beast', 'head_nurse', 'signal_man'],
  ['head_nurse', 'signal_man', 'abyss_watcher'],
];
const THEMES = ['lobby', 'office', 'ward', 'rooftop'];

const set = (t: number): GearLoadout => ({ weapon: { slot: 'weapon', tier: t, rarity: 'common' }, armor: { slot: 'armor', tier: t, rarity: 'common' }, charm: { slot: 'charm', tier: t, rarity: 'common' } });

function expGame(expedition: ExpeditionSetup, opts: { seed?: number; players?: PlayerSetup[]; invincible?: boolean } = {}): TestGame {
  return makeGame({
    seed: opts.seed ?? 4242,
    players: opts.players ?? [HUMAN, BOT1, BOT2],
    tunables: opts.invincible === false ? {} : { invincible: true },
    expedition,
  });
}

/** Clear the current floor at once (debug), pick the first offer for every waiting human, leave any room. */
function clearFloor(tg: TestGame): void {
  const s = tg.w.state;
  tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
  for (let guard = 0; guard < 10 && (s.phase === 'reward' || s.phase === 'goedam'); guard++) {
    if (s.phase === 'reward') s.rewardOffersByPlayer.forEach((o, pi) => o && tg.game.dispatch({ type: 'chooseReward', player: pi, offerIndex: 0 }));
    else s.goedam!.players.forEach((pr, pi) => tg.game.dispatch({ type: 'goedam', player: pi, option: pr.stage === 'choosing' ? 'leave' : 'continue' }));
  }
}

/** Play with bots only until the stage ends (or `limit` s). */
function playOut(tg: TestGame, limit = 900): void {
  const s = tg.w.state;
  for (let t = 0; t < limit * 30 && s.phase === 'combat'; t++) tick(tg.w);
}

describe('stage plans (3-1 ~ 3-3)', () => {
  it('monster multipliers, mid bosses, guardians and bosses match the 12-stage table', () => {
    for (let st = 1; st <= 12; st++) {
      for (let f = 1; f <= 3; f++) {
        const p = planExpeditionFloor(st, f, new Rng(st * 10 + f), DEFAULT_TUNABLES);
        // the spec table is rounded (a few cells by up to 0.0052); the classic formula at e is the rule, × the stage's
        // 단계 배율 (기획 15차 밸런스, balance.md 15장)
        const k = EXPEDITION.stageMult[st - 1];
        expect(Math.abs(p.statMult / k - TABLE[st - 1][f - 1])).toBeLessThan(0.006);
        expect(p.statMult).toBeCloseTo(expeditionStatMult(equivFloor(st, f), DEFAULT_TUNABLES.floorStatGrowth) * k, 12);
        expect(p.stage).toBe(st);
        expect(p.stageFloor).toBe(f);
        expect(p.floor).toBe(f);
        expect(p.theme).toBe(THEMES[Math.floor((st - 1) / 3)]);
        expect(p.equivFloor).toBe(equivFloor(st, f));
        if (f === 3 && st % 3 === 0) {
          expect(p.kind).toBe('boss');
          expect(p.bossId).toBe(MIDS[st - 1][2]);
          expect(p.equivFloor).toBe((st / 3) * 5);
          expect(p.timeLimit).toBe(120);
          expect(p.bossHpMult).toBe(EXPEDITION.bossHp);
          expect(p.waves).toHaveLength(0);
        } else {
          expect(p.kind).toBe('normal');
          expect(p.midBossId).toBe(MIDS[st - 1][f - 1]);
          expect(p.waves).toHaveLength(EXPEDITION.waves[f - 1]);
          expect(p.timeLimit).toBe([120, 120, 150][f - 1]);
          expect(p.waves[1].at - p.waves[0].at).toBe(EXPEDITION.waveGap);
          if (f === 3) expect(p.guardian).toEqual({ monsterId: MIDS[st - 1][2], hpMult: EXPEDITION.guardianHp, atkMult: 1.1, at: 10 });
          else expect(p.guardian).toBeUndefined();
        }
      }
    }
  });

  it('boss floors are exactly classic 5 · 10 · 15 · 20 (same multiplier as the classic boss floor)', () => {
    for (const [st, f] of [[3, 5], [6, 10], [9, 15], [12, 20]]) {
      expect(equivFloor(st, 3)).toBe(f);
      expect(expeditionStatMult(f, 0.12)).toBeCloseTo(floorStatMult(f, 0.12), 12);
    }
  });

  it('stageMult scales a stage (bench knob)', () => {
    const keep = EXPEDITION.stageMult[3];
    const before = planExpeditionFloor(4, 2, new Rng(1), DEFAULT_TUNABLES).statMult;
    EXPEDITION.stageMult[3] = keep * 1.1;
    try {
      expect(planExpeditionFloor(4, 2, new Rng(1), DEFAULT_TUNABLES).statMult).toBeCloseTo(before * 1.1, 9);
    } finally {
      EXPEDITION.stageMult[3] = keep;
    }
  });

  it('the guardian spawns at 10 s, enhanced (HP × guardianHp, atk ×1.1); the boss gets HP × bossHp', () => {
    const tg = expGame({ stage: 2 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    const s = tg.w.state;
    expect(s.floor).toBe(3);
    expect(s.expedition!.stageFloor).toBe(3);
    advance(tg, 11.5);
    const g = s.entities.find(e => e.tier === 'mid')!;
    expect(g.defId).toBe('ogre');
    expect(g.rt.base.maxHp).toBeCloseTo(g.rt.monDef!.stats.maxHp * s.plan.statMult * EXPEDITION.guardianHp, 6);
    expect(g.rt.base.atk).toBeCloseTo(g.rt.monDef!.stats.atk * s.plan.statMult * 1.1, 6);
    const tb = expGame({ stage: 3 });
    tb.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    const boss = tb.w.byId.get(tb.w.state.bossId!)!;
    expect(boss.defId).toBe('elevator_keeper');
    expect(boss.maxHp).toBeCloseTo(boss.rt.monDef!.stats.maxHp * tb.w.state.plan.statMult * EXPEDITION.bossHp, 6);
    expect(tb.w.state.bossGroggy).not.toBeNull();
  });
});

describe('stage flow → stageClear (5장)', () => {
  it('floor 1 → reward → floor 2 → reward → floor 3 → stageClear with loot and choices; no relic offers', () => {
    const tg = expGame({ stage: 1 });
    const s = tg.w.state;
    expect(s.expedition).toMatchObject({ stage: 1, stageFloor: 1, boss: false, outcome: 'running', humans: [true, false, false] });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(s.phase).toBe('reward');
    expect(s.rewardOffersByPlayer[0]!.some(o => o.isRelic)).toBe(false);
    clearFloor(tg);
    expect(s.floor).toBe(2);
    clearFloor(tg);
    expect(s.floor).toBe(3);
    expect(s.phase).toBe('combat');
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(s.phase).toBe('stageClear');
    expect(s.expedition!.outcome).toBe('cleared');
    expect(s.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 3 });
    expect(s.expedition!.loot[0]).toHaveLength(2);
    expect(s.expedition!.loot[0].every(g => g.tier === 1 && g.slot !== 'relic')).toBe(true);
    expect(s.expedition!.loot[1]).toEqual([]);
    expect(s.expedition!.choices).toEqual([null, 'extract', 'extract']);
    expect(eventsOf(tg, 'stageClear')).toEqual([{ type: 'stageClear', stage: 1 }]);
    // frozen: ticking does nothing, quit / debug refused
    const t = s.tick;
    tg.game.step(1);
    expect(s.tick).toBe(t);
    expect(tg.game.dispatch({ type: 'quit' }).ok).toBe(false);
    expect(s.expedition!.outcome).toBe('cleared');
    // choice
    expect(expeditionDecided(s)).toBe(false);
    expect(expeditionChoiceTimeoutCommands(s)).toEqual([{ type: 'expeditionChoice', player: 0, choice: 'extract' }]);
    expect(tg.game.dispatch({ type: 'expeditionChoice', player: 0, choice: 'continue' }).ok).toBe(true);
    expect(tg.game.dispatch({ type: 'expeditionChoice', player: 0, choice: 'extract' }).ok).toBe(false);
    expect(s.expedition!.choices[0]).toBe('continue');
    expect(expeditionDecided(s)).toBe(true);
  });

  it('debug expeditionClearStage jumps straight to the stage clear (also from a reward phase)', () => {
    const tg = expGame({ stage: 6 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(tg.w.state.phase).toBe('reward');
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }).ok).toBe(true);
    expect(tg.w.state.phase).toBe('stageClear');
    expect(tg.w.state.expedition!.loot[0]).toHaveLength(3);
    const classic = makeGame();
    expect(classic.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }).ok).toBe(false);
  });

  it('a seat that drops at the clear extracts automatically; choice commands are checked', () => {
    const tg = expGame({ stage: 1 }, { players: [HUMAN, { ...HUMAN, name: '둘' }, BOT1] });
    tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    const s = tg.w.state;
    expect(s.expedition!.humans).toEqual([true, true, false]);
    expect(s.expedition!.loot[1]).toHaveLength(2);
    tg.game.setPlayerBot(1, true);
    expect(s.expedition!.choices).toEqual([null, 'extract', 'extract']);
    expect(eventsOf(tg, 'expeditionChoice').find(e => e.player === 1)).toMatchObject({ auto: true, choice: 'extract' });
    expect(tg.game.dispatch({ type: 'expeditionChoice', player: 0, choice: 'stay' as never }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'expeditionChoice', player: 9, choice: 'extract' }).ok).toBe(false);
  });

  it('wipe / timeout / quit lose the stage (outcome failed)', () => {
    const tg = expGame({ stage: 1 });
    tg.game.dispatch({ type: 'quit' });
    expect(tg.w.state.expedition!.outcome).toBe('failed');
    expect(tg.w.state.phase).toBe('runOver');
    const tw = expGame({ stage: 12 }, { invincible: false, players: [HUMAN] });
    tw.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 2 } });
    playOut(tw, 400);
    expect(tw.w.state.phase).toBe('runOver');
    expect(tw.w.state.expedition!.outcome).toBe('failed');
    expect(['wipe', 'timeout']).toContain(tw.w.state.runResult!.reason);
  });

  it('bots stage 1 ... 3 clear in a sane time (sanity, not the balance bench)', () => {
    for (const stage of [1, 3]) {
      const tg = expGame({ stage }, { invincible: false, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2] });
      playOut(tg, 600);
      const s = tg.w.state;
      expect(s.expedition!.outcome).toBe('cleared');
      expect(s.time).toBeGreaterThan(120);
      expect(s.time).toBeLessThan(420);
      expect(tg.w.floorTimes.map(f => f.floor)).toEqual([1, 2, 3]);
    }
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
      playOut(tg, 700);
      return JSON.stringify(tg.w.state, (k, v) => (k === 'rt' || k === 'loot' ? undefined : v));
    };
    expect(run(true)).toBe(run(false));
  });

  it('normal stage: 2 base items at tier = stage; boss stage: + a sure relic on the first clear, else chance', () => {
    for (let seed = 0; seed < 40; seed++) {
      const n = rollStageLoot(seed, 5, 0, party, false, 0);
      expect(n).toHaveLength(2);
      expect(n.every(g => g.tier === 5 && g.slot !== 'relic')).toBe(true);
      const b = rollStageLoot(seed, 9, 0, party, true, 0);
      expect(b).toHaveLength(3);
      expect(b[2]).toMatchObject({ slot: 'relic', tier: 9 });
      expect(maxStartStage([{ relic: b[2] }, {}, {}])).toBe(1);
    }
    let relics = 0;
    for (let seed = 0; seed < 400; seed++) if (rollStageLoot(seed, 12, 0, party, false, 0)[2].slot === 'relic') relics++;
    expect(relics / 400).toBeGreaterThan(0.72);
    expect(relics / 400).toBeLessThan(0.88);
  });

  it('slot picks lean toward the slot the party lacks; T1–3 always common, options only on rare / epic', () => {
    const counts = { weapon: 0, armor: 0, charm: 0, relic: 0 };
    const all: GearSpec[] = [];
    for (let seed = 0; seed < 300; seed++) for (const g of rollStageLoot(seed, 2, 0, party, false, 0)) (counts[g.slot]++, all.push(g));
    expect(counts.charm / 600).toBeGreaterThan(0.5); // 4 / (1 + 1 + 4) ≈ 67 %
    expect(all.every(g => g.rarity === 'common' && g.optionId == null)).toBe(true);
    const late: GearSpec[] = [];
    for (let seed = 0; seed < 300; seed++) late.push(...rollStageLoot(seed, 11, 0, party, false, 3));
    expect(late.some(g => g.rarity === 'epic')).toBe(true);
    for (const g of late) expect(g.rarity === 'common' ? g.optionId == null : !!g.optionId).toBe(true);
    // streak bonus: more rare at +30 %p than without
    const rare = (cleared: number) => {
      let n = 0;
      for (let seed = 0; seed < 300; seed++) n += rollStageLoot(seed, 7, 0, party, false, cleared).filter(g => g.rarity !== 'common').length;
      return n;
    };
    expect(rare(3)).toBeGreaterThan(rare(0));
  });
});

describe('carry between stages (7장)', () => {
  it('rewards, traces and per-character ult charge come along; HP and cooldowns are fresh', () => {
    const a = expGame({ stage: 1 });
    clearFloor(a);
    clearFloor(a);
    const sa = a.w.state;
    sa.players[0].party[1].ult.charge = 0.6;
    sa.players[0].party[2].ult.charge = 1;
    sa.players[0].goedamTraces.push({ id: 'silence', floorsLeft: 2 }, { id: 'red_paper', floorsLeft: null });
    a.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } });
    const carry = extractCarry(sa, 0);
    expect(carry.rewards).toEqual(sa.players[0].rewards);
    expect(carry.rewards).toHaveLength(2);
    expect(carry.ult[1]).toBeCloseTo(0.6, 9);
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
    // the setup's gear objects are copied (the sim never shares them)
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
  it('rooms only after stage floor 1, about 1 in 3, from the stage zone, never 저주받은 유물, never twice a run', () => {
    let opened = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const tg = makeGame({ seed, players: [HUMAN], tunables: { goedamRoomsPerZone: 1 }, expedition: { stage: 5 } });
      expect(expeditionRoomAfter(tg.w, 2)).toBeNull();
      const r = expeditionRoomAfter(tg.w, 1);
      if (!r) continue;
      opened++;
      expect(r.zone).toBe('office');
      expect(r.id).not.toBe('cursed_relic');
      tg.w.goedam.seen.push(...GOEDAM_ROOMS.filter(x => x.zone === 'office').map(x => x.id));
      expect(expeditionRoomAfter(tg.w, 1)).toBeNull();
    }
    expect(opened / 300).toBeGreaterThan(0.25);
    expect(opened / 300).toBeLessThan(0.42);
    const off = makeGame({ seed: 3, players: [HUMAN], tunables: { goedamRoomsPerZone: 0 }, expedition: { stage: 5 } });
    expect(expeditionRoomAfter(off.w, 1)).toBeNull();
  });

  it('stage 1 floor 2 plans the toad; no event on floor 3', () => {
    const tg = makeGame({ seed: 5, players: [HUMAN], tunables: { fieldEventChance: 0.6, invincible: true }, expedition: { stage: 1 } });
    clearFloor(tg);
    expect(tg.w.state.floor).toBe(2);
    expect(tg.w.fieldEvents.plan?.id).toBe('lucky_toad');
    clearFloor(tg);
    expect(tg.w.state.floor).toBe(3);
    expect(tg.w.fieldEvents.plan).toBeNull();
  });
});

describe('determinism', () => {
  it('same seed + setup + loadouts → identical stage', () => {
    const run = () => {
      const tg = expGame({ stage: 7, clearedThisRun: [2] }, { seed: 321, invincible: false, players: [{ ...HUMAN, isBot: true, gear: [set(6), set(6), set(6)] }, BOT1, BOT2] });
      tg.w.state.players[0].isBot = false; // a human seat that never acts (bots on the other seats)
      playOut(tg, 500);
      return JSON.stringify(tg.w.state, (k, v) => (k === 'rt' ? undefined : v));
    };
    expect(run()).toBe(run());
  });
});
