import { describe, expect, it } from 'vitest';
import { getCharacter } from '../../src/data';
import { active, advance, clearEvents, eventsOf, killActive, makeGame, quietFloor, spawnAt } from './helpers';

describe('R1 start state', () => {
  it('starts with character 1 on field and 2·3 immediately swappable', () => {
    const tg = makeGame({ players: [{ name: 'a', isBot: false, characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'owl_frost'] }] });
    const s = tg.game.state;
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(1);
    const p = s.players[0];
    expect(p.activeIndex).toBe(0);
    const e = active(tg);
    expect(e.kind).toBe('character');
    expect(e.defId).toBe('guardian');
    expect(e.partyIndex).toBe(0);
    expect(p.party[0].entityId).toBe(e.id);
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    // R4 (기획 6차): the cooldown starts when a character is swapped OUT, so the starting field character has none
    expect(p.party[0].swapCooldownRemaining).toBe(0);
    expect(tg.game.canSwap(0, 1).ok).toBe(true);
    expect(tg.game.canSwap(0, 2).ok).toBe(true);
    // R3: the field character cannot be dragged again
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '이미 필드에 있음' });
    expect(p.ult.charge).toBe(0);
    expect(p.pets.every(x => x.cooldownRemaining === 0)).toBe(true);
    expect(tg.game.canUsePet(0, 0).ok).toBe(true);
    // characters spawn inside the arena
    const a = s.plan.arena;
    expect(e.pos.x).toBeGreaterThan(0);
    expect(e.pos.x).toBeLessThan(a.width);
  });

  it('step clamps realDt and applies gameSpeed in whole 1/30 s ticks', () => {
    const tg = makeGame();
    tg.game.step(10); // clamped to 0.25 s
    expect(tg.game.state.tick).toBe(7);
    tg.game.tunables.gameSpeed = 2;
    tg.game.step(0.25); // 0.5 s (+ leftover)
    expect(tg.game.state.tick).toBe(22);
  });
});

describe('R2–R4 swap', () => {
  it('appears at the drop point, old character leaves, drag skill fires there', () => {
    const tg = makeGame();
    quietFloor(tg);
    advance(tg, 0.1);
    const old = active(tg);
    clearEvents(tg);
    const r = tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 4 } });
    expect(r.ok).toBe(true);
    const s = tg.game.state;
    expect(s.players[0].activeIndex).toBe(1);
    expect(s.entities.find(e => e.id === old.id)).toBeUndefined();
    const e = active(tg);
    expect(e.defId).toBe('blade');
    // blade's drag skill (질풍 삼연섬) appears at the drop point, then dashes 6 to the right (R28)
    expect(eventsOf(tg, 'appear')[0].pos).toEqual({ x: 10, y: 4 });
    expect(eventsOf(tg, 'dash')[0]).toMatchObject({ entityId: e.id, from: { x: 10, y: 4 }, to: { x: 16, y: 4 } });
    expect(e.pos).toEqual({ x: 16, y: 4 });
    expect(e.anim).toBe('appear');
    expect(e.invulnTime).toBeCloseTo(tg.game.tunables.appearInvulnTime);
    const types = eventsOf(tg, 'leave').length + eventsOf(tg, 'appear').length;
    expect(types).toBe(2);
    // 기획 13차: every beat is cast (telegraphed) at once — dash, rush back, burst
    const casts = eventsOf(tg, 'skillCast').filter(c => c.slot === 'drag');
    expect(casts.map(c => c.stage)).toEqual(['dash', 'return', 'burst']);
    expect(casts[0].center).toEqual({ x: 10, y: 4 });
    expect(s.players[0].stats.swaps).toBe(1);
  });

  it('drop point is clamped into the arena', () => {
    const tg = makeGame();
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: -5, y: 99 } }); // mage: no dash
    const e = active(tg);
    const a = tg.game.state.plan.arena;
    expect(e.pos).toEqual({ x: 0.5, y: a.height - 0.5 });
    expect(tg.game.clampToArena({ x: 1000, y: -3 })).toEqual({ x: a.width - 0.5, y: 0.5 });
  });

  it('R4 (기획 6차): the cooldown starts when a character is swapped out, no global cooldown, 0.5 s appear lock', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    const guardCd = getCharacter('guardian').swapCooldown;
    const bladeCd = getCharacter('blade').swapCooldown;
    // A→B: A (guardian) leaves → its cooldown starts; B (blade) appears with none
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true);
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(guardCd);
    expect(p.party[0].swapCooldownTotal).toBeCloseTo(guardCd);
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    // appear lock blocks every swap for 0.5 s
    expect(tg.game.canSwap(0, 2)).toEqual({ ok: false, reason: '등장 중' });
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 12, y: 6 } }).ok).toBe(false);
    advance(tg, 0.5);
    // the field character's card never cools while it fights
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    // no shared cooldown: B→C right after the lock; now B's cooldown starts (full), C has none
    expect(tg.game.canSwap(0, 2).ok).toBe(true);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 14, y: 6 } }).ok).toBe(true);
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(bladeCd);
    expect(p.party[1].swapCooldownTotal).toBeCloseTo(bladeCd);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    advance(tg, 0.6);
    expect(tg.game.canSwap(0, 1)).toEqual({ ok: false, reason: '쿨타임' });
    // C→A blocked until A's cooldown (counted from when A left at t = 0) ends
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(guardCd - 1.1, 1);
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    advance(tg, guardCd - 1.1 - 0.1);
    expect(tg.game.canSwap(0, 0)).toEqual({ ok: false, reason: '쿨타임' });
    advance(tg, 0.15);
    expect(tg.game.canSwap(0, 0).ok).toBe(true);
    // B left 0.5 s after A, so it is ready 0.5 s later
    expect(tg.game.canSwap(0, 1)).toEqual({ ok: false, reason: '쿨타임' });
    advance(tg, 0.5);
    expect(tg.game.canSwap(0, 1).ok).toBe(true);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 12, y: 6 } }).ok).toBe(true);
    expect(p.party[0].swapCooldownRemaining).toBe(0);
    expect(p.party[2].swapCooldownRemaining).toBeCloseTo(getCharacter('mage').swapCooldown);
  });

  it('a character that dies on the field starts no swap cooldown (the revive timer covers it); revived it is ready', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true);
    killActive(tg); // blade dies on the field
    expect(p.activeIndex).toBeNull();
    expect(p.party[1].dead).toBe(true);
    expect(p.party[1].swapCooldownRemaining).toBe(0);
    expect(tg.game.canSwap(0, 1)).toEqual({ ok: false, reason: '사망' });
    advance(tg, tg.game.tunables.reviveTime + 0.1);
    expect(p.party[1].dead).toBe(false);
    expect(tg.game.canSwap(0, 1).ok).toBe(true);
  });

  it('swapCooldownMult scales and swap rewards have a 4 s floor (applied to the leaving character)', () => {
    const tg = makeGame({ tunables: { swapCooldownMult: 0.5 } });
    const p = tg.game.state.players[0];
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 12, y: 6 } });
    expect(p.party[0].swapCooldownRemaining).toBeCloseTo(getCharacter('guardian').swapCooldown * 0.5);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
    advance(tg, 0.6);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    expect(p.party[2].swapCooldownRemaining).toBeCloseTo(getCharacter('mage').swapCooldown * 0.5);
    expect(p.party[2].swapCooldownTotal).toBeCloseTo(getCharacter('mage').swapCooldown * 0.5);
    // −9 s of rewards on blade: max(4, 10 − 9) × 0.5, set when blade leaves
    p.rewards.push({ rewardId: 'swapcd_epic', partyIndex: 1 }, { rewardId: 'swapcd_epic', partyIndex: 1 }, { rewardId: 'swapcd_epic', partyIndex: 1 });
    advance(tg, getCharacter('guardian').swapCooldown * 0.5);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 12, y: 6 } }).ok).toBe(true);
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(4 * 0.5);
    expect(p.party[1].swapCooldownTotal).toBeCloseTo(4 * 0.5);
  });

  it('previewArea shows the drag skill area with radius rewards', () => {
    const tg = makeGame();
    const p = tg.game.state.players[0];
    expect(tg.game.previewArea(0, 'swap', 1)).toEqual({ shape: 'rect', dir: 'right', anchor: 'start', length: 6, width: 1.6 });
    p.rewards.push({ rewardId: 'dragrad_epic', partyIndex: 1 });
    const a = tg.game.previewArea(0, 'swap', 1);
    expect(a.shape === 'rect' && a.length).toBeCloseTo(6 * 1.5);
    expect(a.shape === 'rect' && a.width).toBeCloseTo(1.6 * 1.5);
    expect(tg.game.previewParts(0, 'swap', 1)[0].dash?.distance).toBeCloseTo(6 * 1.5);
    expect(tg.game.previewArea(0, 'pet', 0)).toEqual({ shape: 'circle', radius: 2.5 });
  });
});

describe('R24 debug actions', () => {
  it('chargeUlt / resetCooldowns / instantCooldowns / killAll', () => {
    const tg = makeGame();
    const p = tg.game.state.players[0];
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }).ok).toBe(true);
    expect(p.ult.charge).toBe(1);
    expect(eventsOf(tg, 'ultReady').length).toBe(1);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 10, y: 6 } });
    expect(p.party[0].swapCooldownRemaining).toBeGreaterThan(0); // card 1 left the field
    tg.game.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
    expect(p.party.every(m => m.swapCooldownRemaining === 0 && m.normalCooldownRemaining === 0)).toBe(true);
    expect(p.pets[0].cooldownRemaining).toBe(0);
    tg.game.tunables.instantCooldowns = true;
    advance(tg, 0.6);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    expect(p.party[1].swapCooldownRemaining).toBe(0); // the leaving card gets no cooldown with instantCooldowns
    expect(tg.game.canSwap(0, 0).ok).toBe(false); // still the 0.5 s appear lock
    advance(tg, 0.6);
    expect(tg.game.canSwap(0, 1).ok).toBe(true);
    spawnAt(tg, 'golem', { x: 30, y: 6 });
    spawnAt(tg, 'ogre', { x: 32, y: 6 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    expect(tg.game.state.entities.some(e => e.team === 'enemy')).toBe(false);
  });
});
