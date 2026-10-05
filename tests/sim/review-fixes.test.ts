// Regression tests for the rules-review / playtest fixes (boss retreat vs. wipe, boss soft-lock guard, summon counts).

import { describe, expect, it } from 'vitest';
import { BOSS_ENRAGED_EMPTY_FIELD_FAIL, TICK_RATE } from '../../src/config';
import { applyDamage } from '../../src/sim/combat';
import { tick } from '../../src/sim/game';
import { active, advance, BOT1, BOT2, clearEvents, eventsOf, HUMAN, HUMAN2, killActive, makeGame } from './helpers';

const ALLY = { casterId: null, team: 'ally' as const, player: 0, source: 'basic' as const, isDrag: false };

describe('boss retreat beats a same-tick wipe', () => {
  function bossZeroThenWipe(maxFloor: number) {
    const tg = makeGame({ startFloor: 5, players: [HUMAN, HUMAN2], tunables: { maxFloor } });
    const s = tg.w.state;
    const boss = tg.w.byId.get(s.bossId!)!;
    // boss to 0 HP first …
    applyDamage(tg.w, ALLY, boss, 1e12, false);
    expect(tg.w.bossRetreat).toBe(true);
    // … then, before the floor state is checked, every player goes out (e.g. a pending boss hit)
    for (const pi of [0, 1]) {
      const p = s.players[pi];
      p.party.forEach((m, i) => {
        if (i !== p.activeIndex) {
          m.dead = true;
          m.reviveRemaining = 20;
        }
      });
      killActive(tg, pi);
    }
    expect(s.players.every(p => p.out)).toBe(true);
    expect(s.phase).toBe('combat'); // the wipe waits for the retreat
    tick(tg.w);
    return tg;
  }

  it('the floor counts as cleared (retreat, no reward screen for nobody), then the run ends as a wipe', () => {
    const tg = bossZeroThenWipe(20);
    const s = tg.w.state;
    expect(eventsOf(tg, 'bossRetreat').length).toBe(1);
    expect(eventsOf(tg, 'floorClear')).toEqual([{ type: 'floorClear', floor: 5 }]);
    expect(s.runResult).toMatchObject({ outcome: 'defeat', reason: 'wipe', floorReached: 5 });
    expect(tg.game.telemetry().floorTimes).toEqual([expect.objectContaining({ floor: 5, outcome: 'clear' })]);
  });

  it('at maxFloor the retreat is a victory', () => {
    const tg = bossZeroThenWipe(5);
    expect(tg.w.state.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 5 });
  });

  it('without a retreat the last player out still ends the run at once', () => {
    const tg = makeGame({ startFloor: 5 });
    const p = tg.w.state.players[0];
    p.party[1].dead = true;
    p.party[2].dead = true;
    killActive(tg);
    expect(tg.w.state.runResult).toMatchObject({ outcome: 'defeat', reason: 'wipe' });
  });
});

describe('boss floor soft-lock guard (enraged + nobody on the field)', () => {
  it(`fails the run after ${BOSS_ENRAGED_EMPTY_FIELD_FAIL} s with no ally character on the field once enraged`, () => {
    // human AFK with an empty field (bench alive), both bots out → nothing can ever end the floor
    const tg = makeGame({ startFloor: 5, seed: 9, players: [HUMAN, BOT1, BOT2], tunables: { bossFloorTime: 10 } });
    const s = tg.w.state;
    for (const pi of [1, 2]) {
      const p = s.players[pi];
      p.party.forEach((m, i) => {
        if (i !== p.activeIndex) {
          m.dead = true;
          m.reviveRemaining = 999;
        }
      });
      killActive(tg, pi);
    }
    killActive(tg, 0); // my field is empty, my bench is alive (not out)
    expect(s.players[0].out).toBe(false);
    advance(tg, 10.1);
    expect(s.bossEnraged).toBe(true);
    expect(s.phase).toBe('combat');
    advance(tg, BOSS_ENRAGED_EMPTY_FIELD_FAIL - 0.5);
    expect(s.phase).toBe('combat');
    advance(tg, 1);
    expect(s.runResult).toMatchObject({ outcome: 'defeat', reason: 'timeout', floorReached: 5 });
    expect(tg.game.telemetry().floorTimes.at(-1)).toMatchObject({ floor: 5, outcome: 'fail' });
  });

  it('the empty-field clock resets whenever someone is on the field, and never runs before enrage', () => {
    const tg = makeGame({ startFloor: 5, tunables: { bossFloorTime: 20 } });
    const s = tg.w.state;
    killActive(tg); // empty field from t = 0, but the boss is not enraged yet
    advance(tg, 19.9);
    expect(s.bossEnraged).toBe(false);
    expect(tg.w.enragedEmptyTime).toBe(0);
    advance(tg, BOSS_ENRAGED_EMPTY_FIELD_FAIL - 5);
    expect(s.phase).toBe('combat');
    // drop a card in: clock resets
    tg.game.tunables.invincible = true;
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 8 } }).ok).toBe(true);
    advance(tg, 1);
    expect(tg.w.enragedEmptyTime).toBe(0);
    advance(tg, BOSS_ENRAGED_EMPTY_FIELD_FAIL + 5);
    expect(s.phase).toBe('combat');
    expect(s.runResult).toBeNull();
  });
});

describe('boss summons 4~6 (×1.5 when enraged), capped by maxAliveMonsters', () => {
  function summonCounts(enraged: boolean): number[] {
    const tg = makeGame({ startFloor: 5, seed: 31, tunables: { invincible: true, bossFloorTime: 1e6 } });
    if (enraged) tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } });
    const counts: number[] = [];
    const boss = tg.w.byId.get(tg.w.state.bossId!)!;
    for (let k = 0; k < 12; k++) {
      clearEvents(tg);
      boss.rt.skillCds[1] = 0; // 5층 닫히지 않는 엘리베이터: 그림자 아이 호출 now
      boss.rt.skillGap = 0;
      for (let i = 0; i < boss.rt.skillCds.length; i++) if (i !== 1) boss.rt.skillCds[i] = 99;
      for (let t = 0; t < 2 * TICK_RATE; t++) tick(tg.w);
      counts.push(eventsOf(tg, 'spawn').filter(e => e.tier === 'normal').length);
      tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    }
    return counts;
  }

  it('normal: every cast summons 4–6, and the count varies', () => {
    const c = summonCounts(false);
    expect(c.every(n => n >= 4 && n <= 6)).toBe(true);
    expect(new Set(c).size).toBeGreaterThan(1);
  });

  it('enraged: × summonCountMult 1.5 → 6–9', () => {
    const c = summonCounts(true);
    expect(c.every(n => n >= 6 && n <= 9)).toBe(true);
  });

  it('never above the alive cap', () => {
    const tg = makeGame({ startFloor: 5, tunables: { invincible: true, bossFloorTime: 1e6, maxAliveMonsters: 3 } });
    const boss = tg.w.byId.get(tg.w.state.bossId!)!;
    boss.rt.skillCds[1] = 0;
    boss.rt.skillGap = 0;
    for (let t = 0; t < 2 * TICK_RATE; t++) tick(tg.w);
    expect(tg.w.state.monstersAlive).toBeLessThanOrEqual(3);
    expect(active(tg)).toBeTruthy();
  });
});
