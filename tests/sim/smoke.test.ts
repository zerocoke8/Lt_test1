import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, DEFAULT_TUNABLES } from '../../src/config';
import { createGame } from '../../src/sim';
import type { GameEvent } from '../../src/types';
import { ultOf } from './helpers';

describe('headless smoke', () => {
  it('3 bots, large steps, ~10 sim minutes: no exceptions and reaches floor 3+', () => {
    const g = createGame({
      seed: 20261004,
      tunables: { ...DEFAULT_TUNABLES, gameSpeed: 8 },
      players: [
        { name: 'P0', isBot: true, characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] },
        { ...BOT_PRESETS[0], isBot: true },
        { ...BOT_PRESETS[1], isBot: true },
      ],
    });
    const counts: Partial<Record<GameEvent['type'], number>> = {};
    const t0 = Date.now();
    // 0.25 s real × gameSpeed 8 = 2 s of sim per step
    for (let i = 0; i < 300 && g.state.phase !== 'runOver'; i++) {
      g.step(0.25);
      for (const ev of g.drainEvents()) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
      const s = g.state;
      // invariants
      for (const p of s.players) {
        expect(ultOf(p).charge).toBeGreaterThanOrEqual(0);
        expect(ultOf(p).charge).toBeLessThanOrEqual(1);
        if (p.activeIndex != null) expect(p.party[p.activeIndex].dead).toBe(false);
        for (const m of p.party) expect(Number.isFinite(m.hp)).toBe(true);
      }
      for (const e of s.entities) {
        expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y)).toBe(true);
        expect(e.hp).toBeGreaterThan(0);
      }
      expect(s.monstersAlive).toBeLessThanOrEqual(g.tunables.maxAliveMonsters + 30);
    }
    const s = g.state;
    const tel = g.telemetry();
    const summary = {
      simSeconds: Math.round(s.time),
      wallMs: Date.now() - t0,
      floor: s.floor,
      phase: s.phase,
      result: s.runResult,
      floorTimes: tel.floorTimes.map(f => `${f.floor}:${f.seconds.toFixed(1)}s:${f.outcome}`).join(' '),
      swapsPerMinute: +tel.swapsPerMinute.toFixed(2),
      avgUltDelay: +tel.avgUltDelay.toFixed(2),
      damageShare: Object.fromEntries(Object.entries(tel.damageShareBySource).map(([k, v]) => [k, +v.toFixed(3)])),
      players: s.players.map(p => ({ name: p.name, out: p.out, dmg: Math.round(p.stats.damageDealt), boss: Math.round(p.stats.damageToBoss), taken: Math.round(p.stats.damageTaken), kills: p.stats.kills, swaps: p.stats.swaps, ults: p.stats.ultsUsed, pets: p.stats.petsUsed, relics: p.relics })),
      events: counts,
    };
    console.log('[smoke]', JSON.stringify(summary, null, 1));
    const reached = s.runResult ? s.runResult.floorReached : s.floor;
    expect(reached).toBeGreaterThanOrEqual(3);
  });
});
