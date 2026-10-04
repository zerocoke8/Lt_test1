// Adversarial review (R23/R29): do bots aim the 3차 directional/offset skills at something, in real play?
// 3 bots, long invincible runs over several floors and seeds; every bot swap (stats.swaps++) is a drag cast at the
// drop point the bot picked. A cast "connects" when that player's drag damage grew within 1.3 s.
import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../src/config';
import { getCharacter } from '../../src/data';
import { tick } from '../../src/sim/game';
import type { PlayerSetup } from '../../src/types';
import { makeGame } from '../sim/helpers';

const PRESETS: string[][][] = [
  [
    ['guardian', 'paladin', 'warden'],
    ['blade', 'berserker', 'shadow'],
    ['ranger', 'mage', 'gunner'],
  ],
  [
    ['chrono', 'bard', 'gunner'],
    ['shadow', 'blade', 'ranger'],
    ['warden', 'paladin', 'berserker'],
  ],
];
const PETS = ['frog_bomb', 'owl_frost', 'fairy_heal'];
const WINDOW_TICKS = 40;

interface Cast {
  player: number;
  defId: string;
  at: number;
  before: number;
  enemies: number;
}

describe('R29 bots connect with their drag skills in real play', () => {
  it('every enemy-hitting drag skill connects on most bot casts while enemies are around', () => {
    const tally = new Map<string, { casts: number; hits: number }>();
    for (const [pi, preset] of PRESETS.entries()) {
      for (const seed of [11, 202, 3003]) {
        const players: PlayerSetup[] = preset.map((c, i) => ({ name: `봇${i}`, isBot: true, characters: c, pets: PETS }));
        const tg = makeGame({ seed: seed + pi, players, tunables: { invincible: true } });
        const s = tg.w.state;
        const lastSwaps = s.players.map(p => p.stats.swaps);
        let prevDrag = s.players.map(p => p.stats.damageBySource.drag);
        const open: Cast[] = [];
        const ticks = 600 * TICK_RATE;
        for (let t = 0; t < ticks; t++) {
          if (s.phase === 'runOver') break;
          if (s.phase === 'combat') tick(tg.w);
          tg.game.drainEvents();
          for (const p of s.players) {
            if (p.stats.swaps !== lastSwaps[p.id]) {
              lastSwaps[p.id] = p.stats.swaps;
              const defId = p.party[p.activeIndex ?? 0].defId;
              // a still-open window of the same player is cut (its damage would mix)
              for (let i = open.length - 1; i >= 0; i--) if (open[i].player === p.id) open.splice(i, 1);
              const enemies = s.entities.filter(e => e.team === 'enemy' && e.hp > 0).length;
              open.push({ player: p.id, defId, at: t, before: prevDrag[p.id], enemies });
            }
          }
          for (let i = open.length - 1; i >= 0; i--) {
            const c = open[i];
            if (t - c.at < WINDOW_TICKS) continue;
            open.splice(i, 1);
            if (c.enemies === 0) continue;
            const hit = s.players[c.player].stats.damageBySource.drag > c.before + 1e-9;
            const row = tally.get(c.defId) ?? { casts: 0, hits: 0 };
            row.casts++;
            if (hit) row.hits++;
            tally.set(c.defId, row);
          }
          prevDrag = s.players.map(p => p.stats.damageBySource.drag);
        }
        expect(s.floor, `seed ${seed}: the run kept going`).toBeGreaterThanOrEqual(5);
      }
    }
    const rows = [...tally.entries()]
      .filter(([id]) => getCharacter(id).drag.actions.some(a => a.affects === 'enemies'))
      .map(([id, r]) => ({ id, casts: r.casts, rate: r.hits / Math.max(1, r.casts) }))
      .sort((a, b) => a.rate - b.rate);
    console.log('bot drag connect rate (enemies present):\n' + rows.map(r => `  ${r.id.padEnd(10)} ${(r.rate * 100).toFixed(0).padStart(3)}% of ${r.casts}`).join('\n'));
    for (const r of rows) {
      expect(r.casts, r.id).toBeGreaterThanOrEqual(8);
      expect(r.rate, `${r.id} connects on ${(r.rate * 100).toFixed(0)}% of ${r.casts} casts`).toBeGreaterThanOrEqual(0.6);
    }
  }, 120_000);
});
