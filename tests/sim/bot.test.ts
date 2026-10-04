import { describe, expect, it } from 'vitest';
import { bestDropPoint } from '../../src/sim/bot';
import { hitsArea } from '../../src/sim/geometry';
import { applyStatus } from '../../src/sim/status';
import { active, advance, BOT1, eventsOf, HUMAN, killActive, makeGame, quietFloor, spawnAt } from './helpers';

const BOT_P0 = { ...HUMAN, isBot: true };

describe('R23 bots', () => {
  it('swaps right away when the active character drops below 30% HP', () => {
    const tg = makeGame({ players: [BOT_P0] });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    const e = active(tg);
    e.hp = e.maxHp * 0.25;
    advance(tg, 0.6);
    expect(tg.game.state.players[0].activeIndex).not.toBe(0);
    expect(tg.game.state.players[0].stats.swaps).toBe(1);
  });

  it('refills an empty field after a 0.5–1.5 s reaction', () => {
    const tg = makeGame({ players: [BOT_P0, BOT1] });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    killActive(tg, 0);
    const t0 = tg.game.state.time;
    advance(tg, 0.45);
    expect(tg.game.state.players[0].activeIndex).toBeNull();
    for (let i = 0; i < 80 && tg.game.state.players[0].activeIndex == null; i++) advance(tg, 1 / 30);
    const dt = tg.game.state.time - t0;
    expect(tg.game.state.players[0].activeIndex).not.toBeNull();
    expect(dt).toBeGreaterThanOrEqual(0.5);
    expect(dt).toBeLessThanOrEqual(2.05);
  });

  it('uses the ult 0.5–3 s after it is full', () => {
    const tg = makeGame({ players: [BOT_P0], tunables: { ultChargeTime: 5 } });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    advance(tg, 9);
    const p = tg.game.state.players[0];
    expect(p.stats.ultsUsed).toBeGreaterThanOrEqual(1);
    const avg = p.stats.ultDelayTotal / p.stats.ultDelayCount;
    expect(avg).toBeGreaterThanOrEqual(0.5);
    expect(avg).toBeLessThanOrEqual(3.5);
  });

  it('drops the card where the drag skill covers the most enemies', () => {
    const tg = makeGame({ players: [BOT_P0] });
    quietFloor(tg);
    spawnAt(tg, 'slime', { x: 5, y: 6 });
    const cluster = [[25, 6], [25.8, 6.4], [24.4, 5.5], [25.3, 7]].map(([x, y]) => spawnAt(tg, 'slime', { x, y }));
    // blade: dash right 6 over a rect (R29: scored with the real footprint) → dropped LEFT of the cluster, path covers all
    const pos = bestDropPoint(tg.w, tg.w.state.players[0], 1);
    const part = tg.game.previewParts(0, 'swap', 1)[0];
    for (const s of cluster) expect(hitsArea(part.area, pos, pos, s.pos, s.radius)).toBe(true);
    expect(pos.x).toBeGreaterThan(17);
    expect(pos.x).toBeLessThan(25);
  });

  it('bots use the same command validation (no swaps while appearing / spectating)', () => {
    const tg = makeGame({ players: [BOT_P0, BOT1] });
    advance(tg, 60);
    for (const p of tg.game.state.players) {
      // every appear event belongs to a validated swap
      expect(eventsOf(tg, 'appear').filter(e => e.player === p.id).length).toBe(p.stats.swaps);
    }
  });
});
