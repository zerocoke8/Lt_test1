// 기획 17차: the shared reward effect helpers (src/sim/rewards/fx.ts) and the three seed families every track copies
// (bolt → hooks.onAppear, just_cd → onJustSwap, nails → onFloorStart + statMods + rewardState).
import { describe, expect, it } from 'vitest';
import { tick } from '../../src/sim/game';
import { applyDamage } from '../../src/sim/combat';
import { forceGroggy } from '../../src/sim/groggy';
import { charCtx } from '../../src/sim/ctx';
import { effStats } from '../../src/sim/stats';
import { startAction } from '../../src/sim/skills';
import { grantReward } from '../../src/sim/rewards/offers';
import { rwTakenMult } from '../../src/sim/rewards/hooks';
import {
  REWARD_ZONE_CAP,
  addRewardGroggy,
  blast,
  guardAdd,
  hpCost,
  lineHit,
  memberCtx,
  placeMine,
  rewardCtx,
  spawnDecoy,
  spawnShooter,
  zoneAt,
} from '../../src/sim/rewards/fx';
import type { CastCtx } from '../../src/sim/world';
import { HUMAN, active, eventsOf, clearEvents, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

function setup(startFloor?: number): TestGame {
  const tg = makeGame({ players: [HUMAN], tunables: { invincible: true }, ...(startFloor ? { startFloor } : null) });
  quietFloor(tg);
  for (let i = 0; i < 20; i++) tick(tg.w);
  clearEvents(tg);
  return tg;
}

const ctxOf = (tg: TestGame): CastCtx => rewardCtx(charCtx(tg.w, active(tg), 'passive', null), 'bolt', active(tg).pos);

describe('fx helpers', () => {
  it('reward contexts: no groggy, no multipliers, relic damage; a bench member’s context uses its own attack', () => {
    const tg = setup();
    const c = ctxOf(tg);
    expect(c).toMatchObject({ source: 'relic', noGroggy: true, dmgMult: 1, isDrag: false, casterId: null });
    expect(c.groggyMark).toBeUndefined();
    const m = memberCtx(tg.w, tg.w.state.players[0], 2, 'bolt', { x: 1, y: 1 });
    expect(m.atk).toBeGreaterThan(0);
    expect(m.partyIndex).toBe(2);
  });

  it('blast and lineHit hit the enemies they touch, counted as relic damage', () => {
    const tg = setup();
    const a = spawnAt(tg, 'golem', { x: 10, y: 6 });
    spawnAt(tg, 'golem', { x: 20, y: 6 });
    expect(blast(tg.w, ctxOf(tg), { x: 10, y: 6 }, 1.5, 1)).toBe(1);
    expect(lineHit(tg.w, ctxOf(tg), { x: 9, y: 6 }, { x: 9.5, y: 6 }, 1, 3, 1)).toBe(1); // extended to 3 toward +x
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(tg.w.state.players[0].stats.damageBySource.relic).toBeGreaterThan(0);
  });

  it('caps: reward zones 4, afterimages 2, turret 1, mines per call; reward summons are never targeted or hit', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    for (let i = 0; i < 6; i++) zoneAt(tg.w, p, { ...ctxOf(tg), point: { x: 4 + i, y: 6 } }, 1, 5, 0.5, 'allies', [{ kind: 'heal', amount: 0.01 }]);
    expect((p.rt.rewardZones ?? []).filter(id => tg.w.state.zones.some(z => z.id === id)).length).toBe(REWARD_ZONE_CAP);
    for (let i = 0; i < 3; i++) spawnShooter(tg.w, p, i === 2 ? 'duet' : 'shade', { x: 5 + i, y: 5 }, { duration: 5, interval: 0.6, range: 5, amount: 0.5 });
    for (let i = 0; i < 2; i++) spawnShooter(tg.w, p, 'turret', { x: 8, y: 8 + i }, { duration: 5, interval: 0.8, range: 6, amount: 0.4 });
    const alive = (id: string) => tg.w.state.entities.filter(e => !e.rt.gone && e.defId === id).length;
    expect(alive('rw_shade') + alive('rw_duet')).toBe(2);
    expect(alive('rw_turret')).toBe(1);
    for (let i = 0; i < 4; i++) placeMine(tg.w, p, { x: 3 + i, y: 3 }, { duration: 20, radius: 1.5, amount: 1.2, root: 1.5, cap: 2, ctx: ctxOf(tg), family: 'mine' });
    expect(alive('rw_mine')).toBe(2);
    const shade = tg.w.state.entities.find(e => !e.rt.gone && e.defId === 'rw_duet')!;
    expect(applyDamage(tg.w, { casterId: null, team: 'enemy', player: null, source: 'basic', isDrag: false }, shade, 100, false)).toBe(0);
  });

  it('a mine goes off under an enemy (blast + root) and is gone', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    placeMine(tg.w, p, { x: 15, y: 6 }, { duration: 20, radius: 1.5, amount: 1.2, root: 1.5, cap: 2, ctx: ctxOf(tg), family: 'mine' });
    const g = spawnAt(tg, 'golem', { x: 15.5, y: 6 });
    tick(tg.w);
    expect(g.hp).toBeLessThan(g.maxHp);
    expect(g.statuses.some(s => s.id === 'root')).toBe(true);
    expect(tg.w.state.entities.filter(e => !e.rt.gone && e.defId === 'rw_mine').length).toBe(0);
    expect(eventsOf(tg, 'rewardProc').some(e => e.rewardId === 'mine')).toBe(true);
  });

  it('straw doll decoy: taunts nearby enemies; never removes the puppeteer’s dolls', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    const g = spawnAt(tg, 'goblin', { x: 12, y: 6 });
    const d = spawnDecoy(tg.w, p, { x: 11, y: 6 }, { hp: 300, duration: 4, tauntRadius: 4 })!;
    expect(d.maxHp).toBeCloseTo(300, 6);
    expect(g.statuses.find(s => s.id === 'taunt')?.data?.sourceEntityId).toBe(d.id);
  });

  it('straw dolls share the cap of 2 with the puppeteer’s paper dolls (2 paper dolls → no straw doll)', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    const paper = (x: number) => {
      const e = spawnAt(tg, 'paper_doll', { x, y: 3 });
      e.team = 'ally';
      e.ownerPlayer = p.id;
      return e;
    };
    const o = { hp: 300, duration: 4, tauntRadius: 4 };
    paper(3);
    const s1 = spawnDecoy(tg.w, p, { x: 11, y: 6 }, o)!;
    const s2 = spawnDecoy(tg.w, p, { x: 12, y: 6 }, o)!;
    expect(s1.rt.gone).toBe(true); // 1 paper doll + 1 straw doll: the older straw doll leaves
    expect(s2.rt.gone).toBeFalsy();
    paper(4);
    expect(spawnDecoy(tg.w, p, { x: 13, y: 6 }, o)).toBeNull();
    const dolls = tg.w.state.entities.filter(e => !e.rt.gone && e.hp > 0 && e.ownerPlayer === p.id && ['paper_doll', 'rw_straw'].includes(e.defId));
    expect(dolls.length).toBe(3); // the 2 paper dolls + the straw doll already standing (only new ones are refused)
  });

  it('guards add up to at most −50 % damage taken; HP costs never go below 1', () => {
    const tg = setup();
    const e = active(tg);
    const p = tg.w.state.players[0];
    guardAdd(tg.w, e, 0.3, 3);
    guardAdd(tg.w, e, 0.4, 3);
    expect(rwTakenMult(tg.w, e, p)).toBeCloseTo(0.5, 9);
    e.hp = 5;
    expect(hpCost(tg.w, p, e, 0.5)).toBeCloseTo(4, 9);
    expect(e.hp).toBe(1);
    expect(hpCost(tg.w, p, e, 0.5)).toBe(0);
  });

  it('direct groggy fill: at most 30 % per cycle, never while groggy or locked', () => {
    const tg = setup(5);
    expect(addRewardGroggy(tg.w, 0.2, 0)).toBeCloseTo(0.2, 9);
    expect(addRewardGroggy(tg.w, 0.2, 0)).toBeCloseTo(0.1, 9);
    expect(addRewardGroggy(tg.w, 0.2, 0)).toBe(0);
    expect(forceGroggy(tg.w, 1)).toBe(true);
    expect(addRewardGroggy(tg.w, 0.2, 0)).toBe(0);
  });
});

describe('seed families', () => {
  it('등장 에너지탄 (bolt): bolts at the nearest enemies on appear, relic damage, a head pill', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    grantReward(tg.w, p, 'bolt_rare', null);
    for (let i = 0; i < 4; i++) spawnAt(tg, 'golem', { x: 8 + i, y: 6 });
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 8, y: 7 } }).ok).toBe(true);
    expect(tg.w.state.projectiles.filter(pr => (pr as { rt: { ctx: CastCtx } }).rt.ctx.skillId === 'bolt').length).toBe(3);
    expect(eventsOf(tg, 'rewardProc').some(e => e.rewardId === 'bolt' && e.partyIndex === 1)).toBe(true);
    for (let i = 0; i < 20; i++) tick(tg.w);
    expect(p.stats.damageBySource.relic).toBeGreaterThan(0);
  });

  it('간발의 차 (just_cd): a 저스트 교대 cuts the bench cooldowns', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    grantReward(tg.w, p, 'just_cd_rare', null);
    p.party[2].swapCooldownRemaining = 8;
    const me = active(tg);
    const ctx: CastCtx = { ...ctxOf(tg), team: 'enemy', player: null, source: 'basic', slot: 'monster', point: { ...me.pos }, noGroggy: undefined };
    const pd = startAction(tg.w, ctx, { center: 'point', area: { shape: 'circle', radius: 1.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }], delay: 1.2 })!;
    while (pd.remaining > 0.3) tick(tg.w);
    const cd2 = p.party[2].swapCooldownRemaining;
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 3, y: 3 } }).ok).toBe(true);
    expect(eventsOf(tg, 'justSwap').length).toBe(1);
    expect(p.party[2].swapCooldownRemaining).toBeCloseTo(cd2 - 2.5, 6);
  });

  it('자라는 손톱 (nails): +3 % attack at each floor start after picking (counter in rewardState, max 30)', () => {
    const tg = setup();
    const p = tg.w.state.players[0];
    grantReward(tg.w, p, 'nails_epic', null);
    const atk0 = effStats(tg.w, active(tg)).atk;
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: tg.w.state.rewardOffers!.findIndex(o => !['atk', 'nails'].includes(o.family ?? '')) });
    expect(p.rewardState?.nails).toBe(3);
    expect(effStats(tg.w, active(tg)).atk / atk0).toBeCloseTo(1.03 / 1, 2);
    p.rewardState!.nails = 29;
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    expect(p.rewardState?.nails).toBe(30);
  });
});
