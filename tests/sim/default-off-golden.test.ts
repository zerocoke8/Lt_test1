// Golden hashes of today's rules. New rules behind a toggle are OFF by default and must leave these bit-identical.
// 기획 15차: per-character ult is the default — re-recorded once for that intended rule change (the 14차 교체 에너지 and
// shared-gauge paths are gone). The new hashes equal the round-14 code run with ultPerCharacter: true, hashed without
// the old shared PlayerState.ult field — i.e. the 15차 refactor itself changed nothing else.
// 기획 16차 템포: re-recorded once (rich run only; the boss run is unchanged) for the intended classic tempo change —
// wave-on-clear, ring spawns near the party, normal arena width 24, waves per zone, LATE_STAT_GROWTH 1.36.
// A rich multiplayer run (human + 2 bots, 괴담 rooms, 돌발 괴담, rewards, swaps, pets, ults, debug actions, a disconnect)
// and a boss floor. The public state (sim-internal 'rt' stripped) is hashed every 10 ticks and every event is hashed in
// order. If one of these fails, a default rule changed. Only re-record them for an intended rule change of today's game.
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

describe('golden: today\'s rules stay bit-identical (기획 16차: tempo)', () => {
  it('rich 3-player run (rooms, field events, rewards, swaps, pets, ults, disconnect) matches the round-16 hashes', () => {
    expect(richRun()).toEqual(GOLDEN.rich);
  }, 120_000);
  it('boss floor (groggy, ult, bot) matches the round-15 hashes', () => {
    expect(bossRun()).toEqual(GOLDEN.boss);
  }, 60_000);
});

// 기획 15차: per-character ult is the default (recorded once for that rule change).
// 기획 16차 템포: rich re-recorded (wave-on-clear, ring spawns, width 24, zone waves, LATE 1.36) — one floor further in 300 s;
// re-recorded again for the round's review fixes (mid boss weight 2, members ≥ 2.5 from the party, wave 0 below the banner).
const GOLDEN = {
  rich: { state: 1537125942, events: 1743867907, ticks: 9000, floor: 7, kinds: 'bossGroggy,fieldEventEnd,goedamOpen,swapCdCut,ultCast,ultReady' },
  boss: { state: 1309462957, events: 1727523516, ticks: 2700, floor: 5, kinds: 'bossGroggy,swapCdCut,ultCast,ultReady' },
};
