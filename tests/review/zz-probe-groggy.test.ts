import { describe, expect, it } from 'vitest';
import { getEntity, type SimEntity } from '../../src/sim/world';
import type { PlayerSetup } from '../../src/types';
import { advance, clearEvents, eventsOf, makeGame, type TestGame } from '../sim/helpers';
import { tick } from '../../src/sim/game';

const party = (characters: string[]): PlayerSetup => ({ name: '나', isBot: false, characters, pets: ['owl_frost', 'cat_void', 'frog_bomb'] });

describe('probe: last groggy tick', () => {
  for (const floor of [5, 10, 15, 20]) it('boss acts on the last tick? floor ' + floor, () => {
    const tg = makeGame({ seed: 7, startFloor: floor, players: [party(['ranger', 'mage', 'cleric'])], tunables: { invincible: true } });
    for (const p of tg.w.state.players) for (const m of p.party) m.normalCooldownRemaining = 999;
    const boss = getEntity(tg.w, tg.w.state.bossId)!;
    advance(tg, 3);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    // make every pattern ready
    for (let i = 0; i < boss.rt.skillCds.length; i++) boss.rt.skillCds[i] = 0;
    boss.rt.skillGap = 0;
    boss.rt.attackCd = 0;
    clearEvents(tg);
    const log: string[] = [];
    for (let i = 0; i < 30 * 6; i++) {
      const g = tg.w.state.bossGroggy!;
      const leftBefore = g.left;
      tick(tg.w);
      const ev = tg.game.drainEvents();
      for (const e of ev) {
        if ((e.type === 'skillCast' || e.type === 'attack') && e.sourceId === boss.id) log.push(`${e.type} t=${tg.w.state.time.toFixed(3)} leftBefore=${leftBefore.toFixed(3)} left=${g.left.toFixed(3)}`);
        if (e.type === 'bossGroggyEnd') log.push(`END t=${tg.w.state.time.toFixed(3)}`);
      }
    }
    console.log(floor, log.slice(0, 6).join('\n'));
  });
});
