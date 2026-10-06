// 기획 14차: the round-14 debug toggles (궁극기 개별 게이지, 교체 에너지) are OFF by default and must leave today's rules
// bit-identical. These hashes were recorded with the round-13 code (before any round-14 change): a rich multiplayer run
// (human + 2 bots, 괴담 rooms, 돌발 괴담, rewards, swaps, pets, ults, debug actions, a disconnect) and a boss floor.
// The public state (sim-internal 'rt' stripped) is hashed every 10 ticks and every event is hashed in order.
// If one of these fails, a default-off rule changed. Only re-record them for an intended rule change of today's game.
import { describe, expect, it } from 'vitest';
import { tick } from '../../src/sim/game';
import type { Command } from '../../src/types';
import { makeGame, type TestGame } from './helpers';

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const pub = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'rt' ? undefined : x));

type RunHash = { state: number; events: number; ticks: number; floor: number; kinds: string };

function hashRun(tg: TestGame, ticks: number, plan: Record<number, Command>, hooks: (t: number) => void = () => {}): RunHash {
  const s = tg.w.state;
  let hs = 2166136261;
  let he = 2166136261;
  let t = 0;
  const kinds = new Set<string>();
  for (; t < ticks; t++) {
    if (s.phase === 'reward') {
      tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: t % 3 });
    } else if (s.phase === 'goedam') {
      const pr = s.goedam!.players[0];
      const opts = pr.options.filter(o => !o.hidden);
      tg.game.dispatch({ type: 'goedam', player: 0, option: pr.stage === 'choosing' ? opts[t % opts.length].id : 'continue' });
    } else if (s.phase === 'combat') {
      const cmd = plan[t];
      if (cmd) tg.game.dispatch(cmd);
      hooks(t);
      tick(tg.w);
    } else break;
    for (const e of tg.game.drainEvents()) {
      he = fnv(he, pub(e));
      if (e.type === 'ultCast' || e.type === 'ultReady' || e.type === 'goedamOpen' || e.type === 'fieldEventEnd' || e.type === 'bossGroggy' || e.type === 'swapCdCut') kinds.add(e.type);
    }
    if (t % 10 === 0) hs = fnv(hs, pub(s));
  }
  hs = fnv(hs, pub(s));
  return { state: hs, events: he, ticks: t, floor: s.floor, kinds: [...kinds].sort().join(',') };
}

function richRun(): RunHash {
  const tg = makeGame({
    seed: 1414,
    players: [
      { name: '나', isBot: false, characters: ['blade', 'chrono', 'cleric'], pets: ['frog_bomb', 'rabbit_time', 'golem_turret'] },
      { name: '봇1', isBot: true, characters: ['gunner', 'warden', 'bard'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] },
      { name: '봇2', isBot: true, characters: ['medic', 'paladin', 'shadow'], pets: ['frog_bomb', 'owl_frost', 'fairy_heal'] },
    ],
    tunables: { invincible: true, goedamRoomsPerZone: 2, fieldEventChance: 1 },
  });
  const plan: Record<number, Command> = {};
  for (let k = 0; k < 60; k++) {
    plan[120 + k * 150] = { type: 'swap', player: 0, partyIndex: (k % 3 === 0 ? 1 : k % 3 === 1 ? 2 : 0), pos: { x: 6 + ((k * 7) % 24), y: 2 + (k % 8) } };
    plan[200 + k * 150] = { type: 'pet', player: 0, petIndex: k % 3, pos: { x: 10 + (k % 12), y: 6 } };
    plan[230 + k * 150] = { type: 'ult', player: 0 };
  }
  plan[700] = { type: 'debug', action: { kind: 'chargeUlt' } };
  plan[1500] = { type: 'debug', action: { kind: 'resetCooldowns' } };
  return hashRun(tg, 30 * 300, plan, t => {
    if (t === 2400) tg.game.setPlayerBot(0, true);
    if (t === 3000) tg.game.setPlayerBot(0, false);
  });
}

function bossRun(): RunHash {
  const tg = makeGame({
    seed: 77,
    players: [{ name: '나', isBot: true, characters: ['guardian', 'mage', 'chrono'], pets: ['owl_frost', 'cat_void', 'frog_bomb'] }],
    startFloor: 5,
  });
  return hashRun(tg, 30 * 90, { 60: { type: 'debug', action: { kind: 'forceGroggy', fill: 0.85 } }, 90: { type: 'debug', action: { kind: 'chargeUlt' } } });
}

describe('기획 14차: default-off toggles keep today\'s rules bit-identical', () => {
  it('rich 3-player run (rooms, field events, rewards, swaps, pets, ults, disconnect) matches the round-13 hashes', () => {
    expect(richRun()).toEqual(GOLDEN.rich);
  }, 120_000);
  it('boss floor (groggy, ult, bot) matches the round-13 hashes', () => {
    expect(bossRun()).toEqual(GOLDEN.boss);
  }, 60_000);
});

const GOLDEN = {
  rich: { state: 371063629, events: 2192069161, ticks: 9000, floor: 5, kinds: 'bossGroggy,fieldEventEnd,goedamOpen,swapCdCut,ultCast,ultReady' },
  boss: { state: 2383060135, events: 2966003938, ticks: 1843, floor: 5, kinds: 'bossGroggy,swapCdCut,ultCast,ultReady' },
};
