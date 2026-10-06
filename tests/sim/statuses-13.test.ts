// 기획 13차 스킬 리뉴얼 (docs/skill-renewal.md 5-2): the new statuses — taunt, tether, root, stasis, charm (enemies) and
// splashUp (allies): when they land, what they do, when they end, who is immune (bosses / mid bosses / summons), and how
// they meet stuns and the boss groggy gauge.

import { describe, expect, it } from 'vitest';
import { STASIS } from '../../src/config';
import { applyDamage } from '../../src/sim/combat';
import { charCtx } from '../../src/sim/ctx';
import { castSkill } from '../../src/sim/skills';
import { applyStatus, hasStatus, statusImmune } from '../../src/sim/status';
import { getEntity, type SimEntity } from '../../src/sim/world';
import type { PlayerSetup, SkillAction, StatusId, Vec2 } from '../../src/types';
import { active, advance, clearEvents, eventsOf, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const party = (characters: string[]): PlayerSetup => ({ name: '나', isBot: false, characters, pets: ['frog_bomb', 'fairy_heal', 'owl_frost'] });

function game(characters = ['guardian', 'blade', 'mage'], startFloor?: number): TestGame {
  const tg = makeGame({ players: [party(characters)], startFloor, tunables: { invincible: true } });
  quietFloor(tg);
  for (const m of tg.w.state.players[0].party) m.normalCooldownRemaining = 999;
  return tg;
}

function tough(tg: TestGame, id: string, pos: Vec2): SimEntity {
  const m = spawnAt(tg, id, pos);
  m.hp = m.maxHp = m.rt.base.maxHp = 1e7;
  return m;
}

/** Put `status` on the targets of a circle at `at`, cast by the active character as its ult (the real path). */
function inflict(tg: TestGame, status: StatusId, duration: number, value: number, at: Vec2, radius = 1.5): void {
  const e = active(tg);
  const ctx = charCtx(tg.w, e, 'ult', { id: 'test_u', name: '시험' });
  ctx.point = at;
  const action: SkillAction = { stage: 'x', center: 'point', area: { shape: 'circle', radius }, affects: 'enemies', effects: [{ kind: 'status', status, duration, value }] };
  castSkill(tg.w, ctx, [action]);
}

const bossy = (tg: TestGame) => getEntity(tg.w, tg.w.state.bossId)!;

describe('taunt (도발, 가디언)', () => {
  it('a taunted enemy targets the taunter over the nearest unit; released when it leaves the field', () => {
    const tg = makeGame({ players: [party(['blade', 'guardian', 'mage']), party(['ranger', 'cleric', 'bard'])], tunables: { invincible: true, appearLockTime: 0 } });
    quietFloor(tg);
    for (const p of tg.w.state.players) for (const c of p.party) c.normalCooldownRemaining = 999; // no 방패 강타 re-stun
    const other = active(tg, 1);
    const m = tough(tg, 'slime', { x: 14, y: 6 });
    other.pos = { x: 15, y: 6 }; // right next to the slime
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } }); // guardian wave reaches x 14.5
    advance(tg, 0.3);
    const g = active(tg);
    expect(m.statuses.find(s => s.id === 'taunt')?.data?.sourceEntityId).toBe(g.id);
    expect(eventsOf(tg, 'statusApplied').filter(e => e.status === 'taunt' && e.targetId === m.id)).toHaveLength(1);
    advance(tg, 1.3); // the wave's 1.2 s stun is over
    expect(m.targetId).toBe(g.id);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 30, y: 2 } });
    advance(tg, 1 / 30);
    expect(hasStatus(m, 'taunt')).toBe(false);
    advance(tg, 0.2);
    expect(m.targetId).not.toBe(g.id);
  });

  it('bosses, mid bosses and stationary units are immune', () => {
    const tg = game(['guardian', 'blade', 'mage'], 5);
    const mid = tough(tg, 'ogre', { x: 12, y: 6 });
    inflict(tg, 'taunt', 3, 0, { x: 12, y: 6 });
    expect(hasStatus(mid, 'taunt')).toBe(false);
    expect(statusImmune(bossy(tg), 'taunt')).toBe(true);
    const turretLike = tough(tg, 'slime', { x: 18, y: 6 });
    turretLike.rt.stationary = true;
    expect(statusImmune(turretLike, 'taunt')).toBe(true);
  });
});

describe('tether (묶기, 워든) and root (속박, 퇴마사)', () => {
  it('a tethered enemy never leaves the radius around the anchor — walking, knockback, separation — and is free when it ends', () => {
    const tg = game(['ranger', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 30, y: 6 }; // the slime wants to walk to it
    const m = tough(tg, 'slime', { x: 12, y: 6 });
    inflict(tg, 'tether', 1, 2.4, { x: 12, y: 6 });
    expect(m.statuses.find(s => s.id === 'tether')?.data).toEqual({ anchor: { x: 12, y: 6 }, radius: 2.4 });
    advance(tg, 0.8);
    expect(Math.hypot(m.pos.x - 12, m.pos.y - 6)).toBeLessThanOrEqual(2.4 + 1e-6);
    // a knockback cannot push it out either
    castSkill(tg.w, { ...charCtx(tg.w, me, 'drag', { id: 'kb', name: 'kb' }), point: { x: 11, y: 6 } }, [
      { center: 'point', area: { shape: 'circle', radius: 5 }, affects: 'enemies', effects: [{ kind: 'knockback', distance: 6 }] },
    ]);
    expect(Math.hypot(m.pos.x - 12, m.pos.y - 6)).toBeLessThanOrEqual(2.4 + 1e-6);
    advance(tg, 1.5);
    expect(hasStatus(m, 'tether')).toBe(false);
    expect(m.pos.x).toBeGreaterThan(14.4); // walking again
  });

  it('워든 사슬 감옥: the fence re-tethers every 0.5 s for 4 s, then lets go', () => {
    const tg = game(['guardian', 'warden', 'mage']);
    const m = tough(tg, 'slime', { x: 13, y: 6 });
    active(tg).pos = { x: 30, y: 6 };
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    active(tg).pos = { x: 30, y: 6 };
    advance(tg, 3.5);
    expect(hasStatus(m, 'tether')).toBe(true);
    expect(Math.hypot(m.pos.x - 12, m.pos.y - 6)).toBeLessThanOrEqual(2.4 + 1e-6);
    expect(eventsOf(tg, 'statusApplied').filter(e => e.status === 'tether')).toHaveLength(1); // once, not every tick
    advance(tg, 1.5);
    expect(hasStatus(m, 'tether')).toBe(false);
  });

  it('root: stays on the spot it was rooted (a second root keeps it), still attacks; bosses immune, mid bosses not', () => {
    const tg = game(['guardian', 'blade', 'mage']);
    const me = active(tg);
    const m = tough(tg, 'slime', { x: 12, y: 6 });
    me.pos = { x: 12.9, y: 6 };
    inflict(tg, 'root', 1.2, 0, { x: 11, y: 6 });
    const spot = { ...m.pos };
    advance(tg, 0.5);
    inflict(tg, 'root', 1.2, 0, { x: 11, y: 6 });
    expect(m.statuses.find(s => s.id === 'root')?.data?.anchor).toEqual(spot);
    me.pos = { x: 20, y: 6 };
    advance(tg, 0.6);
    expect(m.pos).toEqual(spot);
    expect(m.anim).not.toBe('move');
    expect(statusImmune(m, 'root')).toBe(false);
    const mid = tough(tg, 'ogre', { x: 5, y: 3 });
    expect(statusImmune(mid, 'root')).toBe(false);
    expect(statusImmune(mid, 'tether')).toBe(true);
  });

  it('a tethered / rooted monster never blinks or charges out of its anchor; a charge caught mid wind-up breaks', () => {
    const tg = game(['ranger', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 21, y: 6 };
    const mask = tough(tg, 'red_mask', { x: 12, y: 6 });
    mask.rt.skillCds = mask.rt.skillCds.map(() => 0);
    inflict(tg, 'tether', 3, 2.4, { x: 12, y: 6 });
    clearEvents(tg);
    advance(tg, 2.5);
    expect(eventsOf(tg, 'blink').filter(b => b.entityId === mask.id)).toEqual([]);
    expect(eventsOf(tg, 'skillCast').filter(c => c.sourceId === mask.id)).toEqual([]);
    expect(Math.hypot(mask.pos.x - 12, mask.pos.y - 6)).toBeLessThanOrEqual(2.4 + 1e-6);

    const tg2 = game(['ranger', 'guardian', 'mage']);
    const me2 = active(tg2);
    me2.pos = { x: 18, y: 6 };
    const chair = tough(tg2, 'wheelchair_rush', { x: 12, y: 6 });
    chair.rt.skillCds = chair.rt.skillCds.map(() => 0);
    chair.rt.skillGap = 0;
    for (let i = 0; i < 60 && !tg2.w.pending.some(p => p.kind === 'hit' && p.ctx.casterId === chair.id); i++) advance(tg2, 1 / 30);
    expect(tg2.w.pending.some(p => p.kind === 'hit' && p.ctx.casterId === chair.id)).toBe(true);
    const spot = { ...chair.pos };
    inflict(tg2, 'root', 2, 0, spot);
    clearEvents(tg2);
    advance(tg2, 1.2);
    expect(eventsOf(tg2, 'dash').filter(d => d.entityId === chair.id)).toEqual([]);
    expect(eventsOf(tg2, 'interrupt').filter(i => i.sourceId === chair.id)).toHaveLength(1);
    expect(chair.pos).toEqual(spot);
  });
});

describe('stasis (정지, 크로노)', () => {
  it('no move, no attack, no cooldowns, a wind-up waits (not broken); the stored damage comes back × value at the end', () => {
    const tg = game(['chrono', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 13, y: 6 };
    me.rt.lockTime = 999; // no basic attacks (or bolts in flight) adding to the store
    const m = tough(tg, 'ogre', { x: 12, y: 6 }); // a mid boss: its time ×0.6
    m.rt.skillCds = m.rt.skillCds.map(() => 0);
    advance(tg, 1 / 30); // it starts a wind-up (내려찍기)
    const windup = m.rt.windup[0];
    expect(windup).toBeDefined();
    const left = windup.remaining;
    const cds = [...m.rt.skillCds];
    const at = { ...m.pos };
    inflict(tg, 'stasis', 2.5, 0.3, { ...m.pos });
    const st = m.statuses.find(s => s.id === 'stasis')!;
    expect(st.remaining).toBeCloseTo(2.5 * STASIS.bossTimeMult, 6);
    const hp0 = m.hp;
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'ult', isDrag: false }, m, 1000, false);
    const stored = hp0 - m.hp;
    expect(st.data?.stored).toBeCloseTo(stored, 6);
    me.pos = { x: 20, y: 6 };
    me.rt.lockTime = 999; // no basic attacks adding to the store
    clearEvents(tg);
    advance(tg, 1.4);
    expect(m.pos).toEqual(at);
    expect(m.rt.skillCds).toEqual(cds);
    expect(windup.remaining).toBeCloseTo(left, 6);
    expect(windup.cancelled).toBeFalsy();
    expect(eventsOf(tg, 'attack').filter(a => a.sourceId === m.id)).toHaveLength(0);
    advance(tg, 0.2); // 1.5 s: over
    const end = eventsOf(tg, 'stasisEnd').filter(e => e.entityId === m.id);
    expect(end).toHaveLength(1);
    expect(end[0].amount).toBeCloseTo(stored * 0.3, 3);
    expect(end[0].player).toBe(0);
    // bosses / mid bosses: immune for a while after it
    expect(m.rt.stasisImmune).toBeGreaterThan(STASIS.immune - 0.2);
    inflict(tg, 'stasis', 2.5, 0.3, { ...m.pos });
    expect(hasStatus(m, 'stasis')).toBe(false);
    advance(tg, 0.5);
    expect(windup.remaining).toBeLessThan(left); // the wind-up runs again
  });

  it('on a boss: 1.5 s, the rebound capped at 6 % of its max HP; 크로노 시간 정지 also fills the groggy gauge (25)', () => {
    const tg = game(['chrono', 'guardian', 'mage'], 10);
    const me = active(tg);
    me.pos = { x: 12, y: 2 };
    const boss = bossy(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    tg.game.dispatch({ type: 'ult', player: 0 });
    advance(tg, 0.5);
    const st = boss.statuses.find(s => s.id === 'stasis')!;
    expect(st.total).toBeCloseTo(1.5, 6);
    expect(tg.w.state.players[0].stats.groggyPoints).toBeCloseTo(25, 6);
    expect(hasStatus(boss, 'stun')).toBe(false); // characters still never stun a boss
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'ult', isDrag: false }, boss, boss.maxHp * 0.5, false);
    clearEvents(tg);
    advance(tg, 1.6);
    const end = eventsOf(tg, 'stasisEnd')[0];
    expect(end.amount).toBeCloseTo(boss.maxHp * STASIS.bossReboundCap, 1);
  });

  it('a stun still breaks a stopped monster wind-up (stuns win)', () => {
    const tg = game(['chrono', 'guardian', 'mage']);
    const m = tough(tg, 'ogre', { x: 12, y: 6 });
    active(tg).pos = { x: 13, y: 6 };
    m.rt.skillCds = m.rt.skillCds.map(() => 0);
    advance(tg, 1 / 30);
    const windup = m.rt.windup[0];
    inflict(tg, 'stasis', 2.5, 0.3, { ...m.pos });
    applyStatus(m, 'stun', 1, 0, 0);
    expect(windup.cancelled).toBe(true);
  });
});

describe('charm (조종, 퍼펫티어)', () => {
  it('a charmed enemy attacks the nearest other enemy; its hits count for the charmer (source ult); it ends back on our side', () => {
    const tg = game(['puppeteer', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 4, y: 6 };
    me.rt.lockTime = 999;
    const traitor = tough(tg, 'golem', { x: 12, y: 6 });
    const victim = tough(tg, 'slime', { x: 13.5, y: 6 });
    applyStatus(victim, 'stun', 99, 0, null);
    clearEvents(tg);
    inflict(tg, 'charm', 2.5, 0, { x: 12, y: 6 }, 0.5);
    expect(hasStatus(traitor, 'charm')).toBe(true);
    expect(eventsOf(tg, 'statusApplied').find(e => e.status === 'charm')).toMatchObject({ targetId: traitor.id, player: 0, sourceId: me.id });
    const dealt0 = tg.w.state.players[0].stats.damageBySource.ult;
    advance(tg, 2.4);
    expect(traitor.targetId).toBe(victim.id);
    expect(eventsOf(tg, 'damage').some(d => d.targetId === victim.id)).toBe(true);
    expect(tg.w.state.players[0].stats.damageBySource.ult).toBeGreaterThan(dealt0);
    advance(tg, 0.4);
    expect(hasStatus(traitor, 'charm')).toBe(false);
    advance(tg, 0.2);
    expect(traitor.targetId).not.toBe(victim.id);
  });

  it('bosses, mid bosses and summons are immune', () => {
    const tg = game(['puppeteer', 'guardian', 'mage'], 5);
    expect(statusImmune(bossy(tg), 'charm')).toBe(true);
    expect(statusImmune(tough(tg, 'ogre', { x: 8, y: 6 }), 'charm')).toBe(true);
    const s = tough(tg, 'slime', { x: 9, y: 6 });
    s.kind = 'summon';
    expect(statusImmune(s, 'charm')).toBe(true);
  });
});

describe('splashUp (버서커 혈귀 강림)', () => {
  it('basic attacks splash value further (a character without splash gets one)', () => {
    const tg = game(['ranger', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 8, y: 6 };
    const a = tough(tg, 'slime', { x: 12, y: 6 });
    const b = tough(tg, 'slime', { x: 12.8, y: 6 });
    for (const m of [a, b]) applyStatus(m, 'stun', 99, 0, null);
    me.targetId = a.id;
    clearEvents(tg);
    advance(tg, 2);
    expect(eventsOf(tg, 'damage').some(d => d.targetId === b.id)).toBe(false);
    applyStatus(me, 'splashUp', 8, 1, 0);
    clearEvents(tg);
    advance(tg, 2);
    expect(eventsOf(tg, 'damage').some(d => d.targetId === b.id)).toBe(true);
  });
});

describe('the new statuses are debuffs only on enemies; invulnerable units shrug them', () => {
  it('appear-invulnerable enemies are skipped; allies are never hit by enemy-only actions', () => {
    const tg = game();
    const m = tough(tg, 'slime', { x: 12, y: 6 });
    m.invulnTime = 1;
    inflict(tg, 'taunt', 3, 0, { x: 12, y: 6 });
    expect(hasStatus(m, 'taunt')).toBe(false);
  });
});
