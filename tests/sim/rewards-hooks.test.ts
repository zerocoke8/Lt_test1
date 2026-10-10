// 기획 17차 hook bus: groups run in a fixed order (BASE → SWAP → COMBAT → RULES), multipliers multiply, adds add, a player
// with no reward and no relic is skipped. Recorder hooks are mocked into the three track groups.
import { describe, expect, it, vi } from 'vitest';

const order: string[] = [];
function recorder(name: string): import('../../src/sim/rewards/types').RewardHooks {
  return {
    onAppear: (_w, _p, _info, mods) => {
      order.push(name);
      mods.dmgMult *= 2;
    },
    dragRadiusAdd: () => 0.1,
    chargeMult: () => 1.5,
  };
}
vi.mock('../../src/sim/rewards/swap', async io => {
  const o = await io<typeof import('../../src/sim/rewards/swap')>();
  const { hookGroup } = await import('../../src/sim/rewards/types');
  return { ...o, SWAP_HOOKS: hookGroup(o.SWAP_HOOKS, recorder('swap')) };
});
vi.mock('../../src/sim/rewards/combat', async io => {
  const o = await io<typeof import('../../src/sim/rewards/combat')>();
  const { hookGroup } = await import('../../src/sim/rewards/types');
  return { ...o, COMBAT_HOOKS: hookGroup(o.COMBAT_HOOKS, recorder('combat')) };
});
vi.mock('../../src/sim/rewards/rules', async io => {
  const o = await io<typeof import('../../src/sim/rewards/rules')>();
  const { hookGroup } = await import('../../src/sim/rewards/types');
  return { ...o, RULES_HOOKS: hookGroup(o.RULES_HOOKS, recorder('rules')) };
});

import { tick } from '../../src/sim/game';
import { rwChargeMult, rwDragRadiusAdd, rwOnAppear } from '../../src/sim/rewards/hooks';
import { HUMAN, active, makeGame, quietFloor } from './helpers';

describe('hook bus', () => {
  it('fixed group order, multipliers multiply, adds add; no reward and no relic → skipped', () => {
    const tg = makeGame({ players: [HUMAN], tunables: { invincible: true } });
    quietFloor(tg);
    for (let i = 0; i < 20; i++) tick(tg.w);
    const p = tg.w.state.players[0];
    const info = { idx: 0, e: active(tg), at: { x: 1, y: 1 }, leave: null, just: false, sinceReady: 0, cooling: 0, forced: false };
    order.length = 0;
    expect(rwOnAppear(tg.w, p, info).dmgMult).toBe(1);
    expect(order).toEqual([]);
    expect(rwDragRadiusAdd(p, 0)).toBe(0);
    p.rewards.push({ rewardId: 'atk_common', partyIndex: null });
    expect(rwOnAppear(tg.w, p, info).dmgMult).toBe(8);
    expect(order).toEqual(['swap', 'combat', 'rules']);
    expect(rwDragRadiusAdd(p, 0)).toBeCloseTo(0.3, 9);
    expect(rwChargeMult(p, 0)).toBeCloseTo(1.5 ** 3, 9);
    // a classic relic alone also wakes the hooks
    p.rewards.length = 0;
    p.relics.push('echo_seal');
    order.length = 0;
    rwOnAppear(tg.w, p, info);
    expect(order).toEqual(['swap', 'combat', 'rules']);
  });
});
