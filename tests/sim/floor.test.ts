import { describe, expect, it } from 'vitest';
import { BOSS_POS, DEFAULT_TUNABLES, FLOOR_WAVES, MONSTER_UNLOCK_FLOOR } from '../../src/config';
import { MID_BOSS_IDS } from '../../src/data';
import { planFloor } from '../../src/sim';
import { applyDamage } from '../../src/sim/combat';
import { effStats } from '../../src/sim/stats';
import { Rng } from '../../src/sim/rng';
import { active, advance, BOT1, BOT2, clearEvents, eventsOf, HUMAN, killActive, makeGame } from './helpers';

describe('planFloor', () => {
  it('boss every 5 floors, wave count first + 1 per floor number (capped), unlocks, mid boss alternates', () => {
    const t = DEFAULT_TUNABLES;
    const rng = new Rng(5);
    const plans = Array.from({ length: 20 }, (_, i) => planFloor(i + 1, rng, t));
    expect(plans.filter(p => p.kind === 'boss').map(p => p.floor)).toEqual([5, 10, 15, 20]);
    const normals = plans.filter(p => p.kind === 'normal');
    // 기획서 9-1 (가정) "1층 N웨이브, 층마다 +1": counted by floor number, so a boss floor in between does not shift it
    for (const p of normals) expect(p.waves.length).toBe(Math.min(FLOOR_WAVES.max, FLOOR_WAVES.first + (p.floor - 1) * FLOOR_WAVES.perFloor));
    expect(normals.slice(0, 5).map(p => p.waves.length)).toEqual([5, 6, 7, 8, 10]); // floors 1–4, 6
    expect(Math.max(...normals.map(p => p.waves.length))).toBe(FLOOR_WAVES.max);
    // the cap keeps the last wave well inside the time limit
    expect(1 + (FLOOR_WAVES.max - 1) * t.waveInterval).toBeLessThan(t.normalFloorTime * 0.65);
    for (const p of normals) {
      expect(p.timeLimit).toBe(t.normalFloorTime);
      expect(p.arena).toEqual({ width: 36, height: 12 });
      expect(MID_BOSS_IDS).toContain(p.midBossId);
      p.waves.forEach((wv, i) => {
        expect(wv.at).toBeCloseTo(1 + i * t.waveInterval);
        const n = wv.spawns.reduce((a, g) => a + g.count, 0);
        expect(n).toBeGreaterThanOrEqual(4);
        expect(n).toBeLessThanOrEqual(6);
        for (const g of wv.spawns) expect(MONSTER_UNLOCK_FLOOR[g.monsterId]).toBeLessThanOrEqual(p.floor);
      });
    }
    expect(normals[0].midBossId).not.toBe(normals[1].midBossId);
    const boss = plans[4];
    expect(boss.bossId).toBe('abyss_watcher');
    expect(boss.timeLimit).toBe(t.bossFloorTime);
    expect(boss.arena).toEqual({ width: 24, height: 12 });
    expect(plans[3].statMult).toBeCloseTo(1 + 3 * t.floorStatGrowth);
  });
});

describe('R15/R16 normal floor', () => {
  it('spawns waves with 1 s warnings, clears only after every wave and the mid boss are dead', () => {
    const tg = makeGame({ tunables: { invincible: true, midBossKillTrigger: 999, midBossTimeTrigger: 40 } });
    const s = tg.game.state;
    const plan = s.plan;
    const total = plan.waves.reduce((a, wv) => a + wv.spawns.reduce((b, g) => b + g.count, 0), 0);
    advance(tg, 0.5);
    expect(eventsOf(tg, 'spawnWarning').length).toBe(plan.waves[0].spawns.reduce((a, g) => a + g.count, 0));
    expect(eventsOf(tg, 'spawn').length).toBe(0);
    advance(tg, 0.6);
    expect(eventsOf(tg, 'spawn').length).toBe(eventsOf(tg, 'spawnWarning').length);
    // kill the first wave: floor is NOT clear (waves remain)
    tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    advance(tg, 1 / 30);
    expect(s.monstersAlive).toBe(0);
    expect(s.wavesRemaining).toBe(plan.waves.length - 1);
    expect(s.phase).toBe('combat');
    // kill everything as it comes until every wave is out
    for (let t = 0; t < 120 && s.wavesRemaining > 0; t++) {
      advance(tg, 1);
      tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    }
    advance(tg, 1 / 30);
    expect(s.wavesRemaining).toBe(0);
    expect(s.monstersAlive).toBe(0);
    expect(eventsOf(tg, 'spawn').filter(e => e.tier === 'normal').length).toBe(total);
    // all waves dead but the mid boss has not come yet → still not clear
    expect(s.midBossSpawned).toBe(false);
    expect(s.phase).toBe('combat');
    while (!s.midBossSpawned && s.floorTime < 45) advance(tg, 0.5);
    expect(s.floorTime).toBeGreaterThanOrEqual(40);
    const mid = s.entities.find(e => e.tier === 'mid');
    expect(mid?.defId).toBe(plan.midBossId);
    advance(tg, 1);
    expect(s.phase).toBe('combat'); // mid boss still alive
    clearEvents(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    advance(tg, 1 / 30);
    expect(eventsOf(tg, 'floorClear')).toEqual([{ type: 'floorClear', floor: 1 }]);
    expect(s.phase).toBe('reward');
    expect(tg.game.telemetry().floorTimes[0]).toMatchObject({ floor: 1, outcome: 'clear' });
  });

  it('mid boss is forced in at midBossTimeTrigger even with few kills', () => {
    const tg = makeGame({ tunables: { invincible: true, midBossTimeTrigger: 5, midBossKillTrigger: 999 } });
    advance(tg, 5.0);
    expect(tg.game.state.midBossSpawned).toBe(false);
    advance(tg, 1.1);
    expect(tg.game.state.midBossSpawned).toBe(true);
  });

  it('postpones (never drops) waves while the alive cap is reached', () => {
    const tg = makeGame({ tunables: { invincible: true, maxAliveMonsters: 6, waveInterval: 2, midBossTimeTrigger: 999, midBossKillTrigger: 999 } });
    const s = tg.game.state;
    const total = s.plan.waves.reduce((a, wv) => a + wv.spawns.reduce((b, g) => b + g.count, 0), 0);
    tg.game.state.players[0].party.forEach(m => (m.normalCooldownRemaining = 999));
    active(tg).rt.base.atk = 0; // nobody dies on their own
    advance(tg, 10);
    expect(s.monstersAlive).toBeLessThanOrEqual(6);
    expect(s.wavesRemaining).toBeGreaterThan(0);
    for (let i = 0; i < 20 && s.wavesRemaining > 0; i++) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
      advance(tg, 2);
    }
    expect(s.wavesRemaining).toBe(0);
    expect(eventsOf(tg, 'spawn').filter(e => e.tier === 'normal').length).toBe(total);
  });
});

describe('R17 normal floor timeout', () => {
  it('fails the run', () => {
    const tg = makeGame({ tunables: { invincible: true, normalFloorTime: 8 } });
    advance(tg, 7.9);
    expect(tg.game.state.phase).toBe('combat');
    expect(tg.game.state.timeRemaining).toBeCloseTo(0.1, 1);
    advance(tg, 0.2);
    expect(tg.game.state.phase).toBe('runOver');
    expect(tg.game.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'timeout', floorReached: 1 });
    expect(tg.game.telemetry().floorTimes).toEqual([{ floor: 1, seconds: expect.any(Number), outcome: 'fail' }]);
  });
});

describe('R18 boss floor', () => {
  it('stationary boss; timeout enrages and the fight goes on; boss HP 0 → retreat → clear with relic offers', () => {
    const tg = makeGame({ startFloor: 5, tunables: { invincible: true, bossFloorTime: 6 } });
    const s = tg.game.state;
    expect(s.plan.kind).toBe('boss');
    const boss = tg.w.state.entities.find(e => e.id === s.bossId)!;
    expect(boss.pos).toEqual(BOSS_POS);
    const atk0 = effStats(tg.w, boss).atk;
    advance(tg, 5.9);
    expect(s.bossEnraged).toBe(false);
    advance(tg, 0.2);
    expect(s.bossEnraged).toBe(true);
    expect(boss.enraged).toBe(true);
    expect(eventsOf(tg, 'enrage').length).toBe(1);
    expect(effStats(tg.w, boss).atk).toBeCloseTo(atk0 * 1.6);
    expect(s.phase).toBe('combat');
    expect(s.timeRemaining).toBe(0);
    advance(tg, 5);
    expect(s.phase).toBe('combat');
    expect(boss.pos).toEqual(BOSS_POS);
    // boss summons count as monsters but do not block the retreat-clear
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'basic', isDrag: false }, boss, 1e9, false);
    advance(tg, 1 / 30);
    expect(eventsOf(tg, 'bossRetreat').length).toBe(1);
    expect(eventsOf(tg, 'floorClear')).toEqual([{ type: 'floorClear', floor: 5 }]);
    expect(s.entities.some(e => e.team === 'enemy')).toBe(false);
    expect(s.phase).toBe('reward');
    const offers = s.rewardOffers!;
    expect(offers.length).toBe(3);
    expect(offers.every(o => o.isRelic)).toBe(true);
    expect(new Set(offers.map(o => o.rewardId)).size).toBe(3);
  });

  it('forceEnrage debug', () => {
    const tg = makeGame({ startFloor: 5 });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
    expect(tg.game.state.bossEnraged).toBe(true);
  });
});

describe('R19 floor carry-over', () => {
  it('heals alive members 20% maxHp, keeps everything else, re-appears without drag skill', () => {
    const tg = makeGame();
    const s = tg.game.state;
    const p = s.players[0];
    // character 3 on field, character 1 dead, character 2 on bench at 30%
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    p.party[1].hp = p.party[1].maxHp * 0.3;
    const e = active(tg);
    e.hp = e.maxHp * 0.5;
    p.party[0].dead = true;
    p.party[0].hp = 0;
    p.party[0].reviveRemaining = 17;
    advance(tg, 1);
    const ult = p.ult.charge;
    const cd2 = p.party[2].swapCooldownRemaining;
    const revive = p.party[0].reviveRemaining;
    clearEvents(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(s.phase).toBe('reward');
    expect(p.party[1].hp).toBeCloseTo(p.party[1].maxHp * 0.5);
    expect(e.hp).toBeCloseTo(e.maxHp * 0.7);
    expect(p.party[0].dead).toBe(true);
    expect(p.party[0].reviveRemaining).toBeCloseTo(revive);
    // time frozen during reward
    tg.game.step(0.25);
    tg.game.step(0.25);
    expect(p.ult.charge).toBe(ult);
    expect(p.party[0].reviveRemaining).toBeCloseTo(revive);
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(true);
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(2);
    expect(p.activeIndex).toBe(2);
    expect(active(tg).id).toBe(e.id);
    expect(p.party[2].swapCooldownRemaining).toBeCloseTo(cd2);
    expect(p.ult.charge).toBe(ult);
    const evs = eventsOf(tg, 'skillCast');
    expect(evs.filter(x => x.slot === 'drag').length).toBe(0);
    expect(eventsOf(tg, 'appear').length).toBe(0);
    expect(eventsOf(tg, 'floorStart')).toEqual([{ type: 'floorStart', floor: 2, kind: 'normal' }]);
  });

  it('an empty field stays empty on the next floor', () => {
    const tg = makeGame({ players: [HUMAN, BOT1] });
    killActive(tg, 0);
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 1 });
    expect(tg.game.state.floor).toBe(2);
    expect(tg.game.state.players[0].activeIndex).toBeNull();
    expect(tg.game.state.players[1].activeIndex).toBe(0);
  });
});

describe('R20 rewards', () => {
  it('3 distinct offers, bots auto-pick, human picks, character rewards are bound', () => {
    const tg = makeGame({ players: [HUMAN, BOT1, BOT2] });
    const s = tg.game.state;
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(s.phase).toBe('reward');
    const offers = s.rewardOffers!;
    expect(offers.length).toBe(3);
    expect(new Set(offers.map(o => o.rewardId.replace(/_(common|rare|epic)$/, ''))).size).toBe(3);
    for (const o of offers) {
      expect(o.isRelic).toBe(false);
      expect(['common', 'rare', 'epic']).toContain(o.rarity);
      expect(o.name).not.toContain('{char}');
      expect(o.description).not.toContain('{char}');
    }
    expect(s.players[1].rewards.length).toBe(1);
    expect(s.players[2].rewards.length).toBe(1);
    expect(s.players[0].rewards.length).toBe(0);
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 5 }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 3, y: 3 } })).toEqual({ ok: false, reason: '전투 중이 아님' });
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 2 }).ok).toBe(true);
    expect(s.players[0].rewards[0].rewardId).toBe(offers[2].rewardId);
    expect(s.players[0].rewards[0].partyIndex).toBe(offers[2].partyIndex);
    expect(s.rewardOffers).toBeNull();
    expect(tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }).ok).toBe(false);
  });

  it('boss floor offers relics excluding owned ones', () => {
    const tg = makeGame({ startFloor: 5 });
    const p = tg.game.state.players[0];
    p.relics.push('echo_seal', 'relay_flag', 'vanguard_helm', 'hunter_mark', 'phoenix_feather');
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    const ids = tg.game.state.rewardOffers!.map(o => o.rewardId).sort();
    expect(ids).toEqual(['beast_collar', 'blood_chalice', 'rage_breaker']);
  });

  it('auto-advances when player 0 is out or a bot', () => {
    const tg = makeGame({ players: [{ ...HUMAN, isBot: true }, BOT1] });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(tg.game.state.phase).toBe('combat');
    expect(tg.game.state.floor).toBe(2);
    expect(tg.game.state.players[0].rewards.length).toBe(1);
  });

  it('hp reward raises max HP and current HP', () => {
    const tg = makeGame();
    const e = active(tg);
    const max0 = e.maxHp;
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    const p = tg.game.state.players[0];
    tg.w.humanOffers!.offers[0] = { rewardId: 'hp_epic', partyIndex: null, name: '', description: '', rarity: 'epic', isRelic: false };
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    expect(e.maxHp).toBeCloseTo(max0 + 900 * 0.35);
    expect(p.party[1].maxHp).toBeCloseTo(600 * 1.35);
  });
});

describe('R21 run end', () => {
  it('clearing maxFloor is a victory', () => {
    const tg = makeGame({ tunables: { maxFloor: 2 } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(tg.game.state.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 2 });
  });

  it('jumpFloor starts a floor directly; quit ends the run', () => {
    const tg = makeGame();
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 10 } });
    expect(tg.game.state.floor).toBe(10);
    expect(tg.game.state.plan.kind).toBe('boss');
    expect(tg.game.state.phase).toBe('combat');
    tg.game.dispatch({ type: 'quit' });
    expect(tg.game.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'quit' });
    // frozen after run over
    const t = tg.game.state.time;
    tg.game.step(0.25);
    expect(tg.game.state.time).toBe(t);
  });
});
