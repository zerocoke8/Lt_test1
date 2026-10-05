import { describe, expect, it } from 'vitest';
import { PETS, getPet } from '../../src/data';
import { applyStatus } from '../../src/sim/status';
import { active, advance, clearEvents, eventsOf, makeGame, quietFloor, spawnAt } from './helpers';

describe('R14 pets', () => {
  it('fires at the drop point, goes on its own cooldown and is not a swap', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    const me = active(tg);
    const m = spawnAt(tg, 'golem', { x: 25, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    const hp0 = m.hp;
    const swapCds = p.party.map(x => x.swapCooldownRemaining);
    clearEvents(tg);
    // frog_bomb: 0.5 s telegraph then explosion
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 25, y: 6 } }).ok).toBe(true);
    expect(p.pets[0].cooldownRemaining).toBeCloseTo(getPet('frog_bomb').cooldown);
    expect(tg.game.canUsePet(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    expect(tg.game.canUsePet(0, 1).ok).toBe(true);
    // not a swap: same character, no appear lock, swap cooldowns untouched
    expect(p.activeIndex).toBe(0);
    expect(active(tg).id).toBe(me.id);
    expect(p.appearLock).toBe(0);
    expect(p.party.map(x => x.swapCooldownRemaining)).toEqual(swapCds);
    expect(p.stats.swaps).toBe(0);
    expect(p.stats.petsUsed).toBe(1);
    expect(tg.game.state.telegraphs.length).toBe(1);
    expect(eventsOf(tg, 'skillCast')[0]).toMatchObject({ slot: 'pet', skillId: 'frog_bomb', center: { x: 25, y: 6 } });
    advance(tg, 0.6);
    expect(tg.game.state.telegraphs.length).toBe(0);
    expect(m.hp).toBeLessThan(hp0);
    expect(p.stats.damageBySource.pet).toBeGreaterThan(0);
    advance(tg, getPet('frog_bomb').cooldown);
    expect(tg.game.canUsePet(0, 0).ok).toBe(true);
  });

  it('cooldown = def × petCooldownMult × (1 − rewards) × beast_collar', () => {
    const tg = makeGame({ tunables: { petCooldownMult: 0.5 } });
    const p = tg.game.state.players[0];
    p.rewards.push({ rewardId: 'petcd_common', partyIndex: null }); // −10%
    p.relics.push('beast_collar'); // ×0.7
    tg.game.dispatch({ type: 'pet', player: 0, petIndex: 1, pos: { x: 10, y: 6 } });
    expect(p.pets[1].cooldownRemaining).toBeCloseTo(getPet('fairy_heal').cooldown * 0.5 * 0.9 * 0.7);
  });

  it('pet heals ally characters in the area (power and owner rules)', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = active(tg);
    me.hp = me.maxHp * 0.5;
    tg.game.dispatch({ type: 'pet', player: 0, petIndex: 1, pos: me.pos });
    expect(me.hp).toBeCloseTo(me.maxHp * 0.75, 0);
  });

  it('turret summon shoots enemies and expires', () => {
    const tg = makeGame();
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    tg.game.dispatch({ type: 'pet', player: 0, petIndex: 2, pos: { x: 27, y: 6 } });
    const turret = tg.game.state.entities.find(e => e.defId === 'turret');
    expect(turret).toBeDefined();
    expect(turret!.team).toBe('ally');
    expect(turret!.ownerPlayer).toBe(0);
    advance(tg, 3);
    expect(tg.game.state.players[0].stats.damageBySource.summon).toBeGreaterThan(0);
    advance(tg, 7.1);
    expect(tg.game.state.entities.find(e => e.defId === 'turret')).toBeUndefined();
  });

  it('rejects pets while spectating or outside combat', () => {
    const tg = makeGame();
    tg.game.state.players[0].out = true;
    expect(tg.game.canUsePet(0, 0)).toEqual({ ok: false, reason: '관전 중' });
    expect(tg.game.canUsePet(0, 9)).toEqual({ ok: false, reason: '잘못된 대상' });
  });

  it('기획 12차: every pet cooldown is ×0.8 of the old one (35→28, 40→32, 45→36, 50→40)', () => {
    const cds = Object.fromEntries(PETS.map(p => [p.id, p.cooldown]));
    expect(cds).toEqual({ frog_bomb: 28, fairy_heal: 32, turtle_guard: 32, owl_frost: 28, golem_turret: 36, cat_void: 32, drum_raccoon: 36, rabbit_time: 40 });
  });
});
