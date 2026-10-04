// Adversarial review (R35 + server): the debug panel is host-only, but ANY player can be the host of their own room.
// How much server CPU can one room cost with the worst tunables the server accepts (sanitizeTunablesPatch bounds)?
// The Node server is single-threaded: a room that needs > 1 s of CPU per real second stalls every other room.
import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../../src/config';
import { createGame } from '../../src/sim';
import { sanitizeTunablesPatch } from '../../src/sim/telemetry';
import type { Tunables } from '../../src/types';

/** Real seconds of the server loop (30 step() calls each); stops early once one real second costs more than `cap` ms. */
function cpuPerRealSecond(patch: Partial<Tunables>, realSecs: number, cap = 5000): { per: number[]; entities: number } {
  const g = createGame({
    seed: 5,
    players: [BOT_PRESETS[0], BOT_PRESETS[1], BOT_PRESETS[0]].map(b => ({ ...b, isBot: true })),
    tunables: { ...DEFAULT_TUNABLES, ...sanitizeTunablesPatch(patch) },
  });
  const per: number[] = [];
  let maxEntities = 0;
  for (let s = 0; s < realSecs; s++) {
    const a = performance.now();
    for (let k = 0; k < 30; k++) {
      g.step(1 / 30);
      g.drainEvents();
    }
    per.push(Math.round(performance.now() - a));
    maxEntities = Math.max(maxEntities, g.state.entities.length);
    if (per[per.length - 1] > cap) break;
  }
  return { per, entities: maxEntities };
}

describe('one room with hostile host tunables', () => {
  it('stays well under one CPU-second per real second (otherwise one player can freeze every room on the server)', () => {
    const base = cpuPerRealSecond({}, 20);
    const hostile = cpuPerRealSecond({ gameSpeed: 99, maxAliveMonsters: 9999, monsterHpMult: 10, waveInterval: 0, invincible: true, normalFloorTime: 3600, bossFloorTime: 3600, floorStatGrowth: 0 }, 30);
    console.log(`room CPU ms per real second — default: ${base.per.join(' ')} (${base.entities} entities); hostile host: ${hostile.per.join(' ')} (${hostile.entities} entities)`);
    expect(Math.max(...hostile.per)).toBeLessThan(500);
  }, 300_000);
});
