// 기획 20차: the light soft-lock check in the suite — every boss × 2 seeds × 90 s of a bots-only fight, with both the
// mixed party and the melee-only party on the moving bosses. The full probe (more seeds, 240 s, the sliders) is the
// tool: npx vite-node tests/review/boss-softlock.ts [BOSS=<id>] [COMP=melee] [RUNS=8].
import { describe, expect, it } from 'vitest';
import { BOSSES, RAID_BOSS_IDS } from '../../src/data';
import { bossFormOf } from '../../src/sim/bossForm';
import { MELEE_PARTY, MIXED_PARTY, probeFight } from './bossProbe';

const SEEDS = [2020, 9939];
const MOVING = BOSSES.filter(b => bossFormOf(b) !== 'fixed').map(b => b.id);

/** 'no-end' is not judged here: 90 s is shorter than a slow fight (the tool runs 240 s). */
const judged = (fails: string[]): string[] => fails.filter(f => f !== 'no-end');

describe('no soft lock in a bots-only boss fight (90 s)', () => {
  it.each([...RAID_BOSS_IDS])('%s: the boss stays reachable, takes damage and keeps to its box; characters keep moving; nothing is left after the clear', id => {
    for (const seed of SEEDS) {
      const r = probeFight(id, { seed, seconds: 90, players: MIXED_PARTY });
      expect(judged(r.fails), `${id} seed ${seed}: ${JSON.stringify(r)}`).toEqual([]);
      expect(r.clutterMax, `${id}: zones + warnings on screen`).toBeLessThanOrEqual(60);
    }
  });

  it.each(MOVING)('%s vs a melee-only party: every character can walk up to the body and hit it', id => {
    const r = probeFight(id, { seed: SEEDS[0], seconds: 90, players: MELEE_PARTY });
    expect(judged(r.fails), `${id}: ${JSON.stringify(r)}`).toEqual([]);
    expect(r.noDamageMax).toBeLessThan(12);
  });

  it('the same seed gives the same probe (no rng of its own)', () => {
    expect(probeFight('coffee_machine', { seed: 77, seconds: 30 })).toEqual(probeFight('coffee_machine', { seed: 77, seconds: 30 }));
  });
});
