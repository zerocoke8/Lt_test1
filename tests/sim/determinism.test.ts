import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../../src/config';
import { createGame } from '../../src/sim';
import type { Command, Game, GameSetup } from '../../src/types';

function setup(seed: number): GameSetup {
  return {
    seed,
    tunables: { ...DEFAULT_TUNABLES },
    players: [
      { name: 'P0', isBot: true, characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] },
      { ...BOT_PRESETS[0], isBot: true },
      { ...BOT_PRESETS[1], isBot: true },
    ],
  };
}

/** Same scripted extra commands at the same ticks. */
function run(seed: number, seconds: number): Game {
  const g = createGame(setup(seed));
  const script: Record<number, Command> = {
    90: { type: 'debug', action: { kind: 'chargeUlt' } },
    300: { type: 'pet', player: 1, petIndex: 0, pos: { x: 18, y: 6 } },
    600: { type: 'debug', action: { kind: 'resetCooldowns' } },
  };
  // uneven real frame times exercise the accumulator
  const frames = [1 / 60, 1 / 30, 0.05, 1 / 144, 0.1];
  let i = 0;
  while (g.state.time < seconds && g.state.phase === 'combat') {
    g.step(frames[i++ % frames.length]);
    const cmd = script[g.state.tick];
    if (cmd) {
      g.dispatch(cmd);
      delete script[g.state.tick];
    }
    g.drainEvents();
  }
  return g;
}

describe('determinism', () => {
  it('same seed + same commands → identical state after 60 s with bot players', () => {
    const a = run(42, 60);
    const b = run(42, 60);
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.tick).toBeGreaterThan(1700);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.telemetry())).toBe(JSON.stringify(b.telemetry()));
  });

  it('a different seed diverges', () => {
    const a = run(1, 20);
    const b = run(2, 20);
    expect(JSON.stringify(a.state.entities)).not.toBe(JSON.stringify(b.state.entities));
  });
});
