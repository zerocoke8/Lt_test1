import { describe, expect, it } from 'vitest';
import { applyDamage, hitDamage } from '../../src/sim/combat';
import { charCtx } from '../../src/sim/ctx';
import { effStats } from '../../src/sim/stats';
import { applyStatus } from '../../src/sim/status';
import { active, advance, clearEvents, eventsOf, HUMAN, makeGame, quietFloor, spawnAt } from './helpers';

const ENEMY_SRC = { casterId: null, team: 'enemy' as const, player: null, source: 'basic' as const, isDrag: false };

describe('damage formula', () => {
  it('def, vulnerable, shield absorb, invuln and invincible', () => {
    const tg = makeGame();
    quietFloor(tg);
    const e = active(tg); // guardian def 0.3
    e.invulnTime = 0;
    const hp0 = e.hp;
    expect(applyDamage(tg.w, ENEMY_SRC, e, 100, false)).toBeCloseTo(70);
    expect(e.hp).toBeCloseTo(hp0 - 70);
    applyStatus(e, 'vulnerable', 5, 0.5, null);
    expect(applyDamage(tg.w, ENEMY_SRC, e, 100, false)).toBeCloseTo(105);
    e.statuses.length = 0;
    e.shield = 50;
    e.rt.shieldTime = 5;
    const hp1 = e.hp;
    clearEvents(tg);
    applyDamage(tg.w, ENEMY_SRC, e, 100, false);
    expect(e.shield).toBe(0);
    expect(e.hp).toBeCloseTo(hp1 - 20);
    expect(eventsOf(tg, 'damage')[0]).toMatchObject({ amount: 70, absorbed: 50, targetTeam: 'ally' });
    e.invulnTime = 0.3;
    expect(applyDamage(tg.w, ENEMY_SRC, e, 100, false)).toBe(0);
    e.invulnTime = 0;
    tg.game.tunables.invincible = true;
    expect(applyDamage(tg.w, ENEMY_SRC, e, 100, false)).toBe(0);
  });

  it('bot damage multiplier, monster multipliers and floor statMult', () => {
    const tg = makeGame({ players: [{ ...HUMAN, isBot: true }], tunables: { botDamageMult: 2, monsterHpMult: 3 }, startFloor: 3 });
    quietFloor(tg);
    const m = spawnAt(tg, 'slime', { x: 30, y: 6 }); // test helper spawns with mult 1
    const me = active(tg);
    const ctx = charCtx(tg.w, me, 'basic', null);
    ctx.critChance = 0;
    expect(hitDamage(tg.w, ctx, m, 1)).toBeCloseTo(me.rt.base.atk * 2);
    // natural spawns get statMult × monsterHpMult
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 3 } });
    advance(tg, 1.2);
    const slime = tg.w.state.entities.find(e => e.kind === 'monster');
    expect(slime).toBeDefined();
    const plan = tg.game.state.plan;
    expect(slime!.maxHp).toBeCloseTo((slime!.rt.monDef!.stats.maxHp) * plan.statMult * 3);
    tg.game.tunables.monsterDmgMult = 2;
    expect(effStats(tg.w, slime!).atk).toBeCloseTo(slime!.rt.monDef!.stats.atk * plan.statMult * 2);
  });

  it('passive stats apply only on field; berserker gains atk at low hp', () => {
    const tg = makeGame({ players: [{ ...HUMAN, characters: ['guardian', 'berserker', 'ranger'] }] });
    quietFloor(tg);
    const g = active(tg);
    expect(g.maxHp).toBeCloseTo(900 * 1.1);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    expect(tg.game.state.players[0].party[0].maxHp).toBeCloseTo(900);
    const b = active(tg);
    const full = effStats(tg.w, b).atk;
    b.hp = b.maxHp * 0.25;
    expect(effStats(tg.w, b).atk).toBeCloseTo(full * (1 + 0.6 * 0.75));
  });

  it('projectiles home in and hit on arrival; burn ticks as absolute dps', () => {
    const tg = makeGame({ players: [{ ...HUMAN, characters: ['ranger', 'blade', 'mage'] }] });
    quietFloor(tg);
    const me = active(tg);
    me.pos = { x: 10, y: 6 };
    const m = spawnAt(tg, 'golem', { x: 15, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    tg.game.state.players[0].party[0].normalCooldownRemaining = 99;
    advance(tg, 1 / 30);
    expect(tg.game.state.projectiles.length).toBe(1);
    const hp0 = m.hp;
    advance(tg, 0.4);
    expect(m.hp).toBeLessThan(hp0);
    applyStatus(m, 'burn', 2, 10, 0, 'drag');
    const hp1 = m.hp;
    me.rt.base.atk = 0;
    advance(tg, 1.0);
    // 10 dps × 1 s × (1 − 0.2 def)
    expect(hp1 - m.hp).toBeCloseTo(8, 0);
  });
});

describe('relics', () => {
  it('relay_flag explodes where the leaving character stood', () => {
    const tg = makeGame();
    quietFloor(tg);
    tg.game.state.players[0].relics.push('relay_flag');
    const me = active(tg);
    me.pos = { x: 10, y: 6 };
    const m = spawnAt(tg, 'golem', { x: 11, y: 6 });
    const hp0 = m.hp;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 30, y: 6 } });
    expect(m.hp).toBeLessThan(hp0);
    expect(tg.game.state.players[0].stats.damageBySource.relic).toBeGreaterThan(0);
  });

  it('echo_seal repeats the drag skill 1 s later at the same spot with 50% power', () => {
    const tg = makeGame();
    quietFloor(tg);
    tg.game.state.players[0].relics.push('echo_seal');
    const m = spawnAt(tg, 'golem', { x: 20, y: 6 });
    m.rt.base.maxHp = m.maxHp = m.hp = 1e6;
    applyStatus(m, 'stun', 100, 0, null);
    tg.game.state.players[0].party[1].normalCooldownRemaining = 99;
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 20, y: 6 } });
    active(tg).rt.base.atk = 0;
    // the echo telegraphs its footprint for the relic delay (기획 13차: the rush back shares the dash's band)
    expect(tg.game.state.telegraphs.filter(t => Math.abs(t.total - 1) < 1e-9)).toHaveLength(2);
    advance(tg, 0.9); // the whole first pass (dash, rush back, burst)
    const first = 1e6 - m.hp;
    expect(first).toBeGreaterThan(0);
    const beforeEcho = m.hp;
    advance(tg, 0.9);
    const second = beforeEcho - m.hp;
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
    const casts = eventsOf(tg, 'skillCast').filter(c => c.slot === 'drag');
    expect(casts.length).toBe(6);
    expect(casts[3].center).toEqual({ x: 20, y: 6 });
  });

  it('vanguard_helm: +40% atk for 4 s after appearing', () => {
    const tg = makeGame();
    quietFloor(tg);
    tg.game.state.players[0].relics.push('vanguard_helm');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    const b = active(tg);
    expect(effStats(tg.w, b).atk).toBeCloseTo(32 * 1.4);
    advance(tg, 4.1);
    expect(effStats(tg.w, b).atk).toBeCloseTo(32);
  });

  it('hunter_mark cuts bench swap cooldowns on kills; rage_breaker vs mid bosses', () => {
    const tg = makeGame();
    quietFloor(tg);
    const p = tg.game.state.players[0];
    p.relics.push('hunter_mark', 'rage_breaker');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    advance(tg, 0.6);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 10, y: 6 } });
    const cd = p.party[1].swapCooldownRemaining;
    const m = spawnAt(tg, 'slime', { x: 30, y: 6 });
    const src = { casterId: null, team: 'ally' as const, player: 0, source: 'basic' as const, isDrag: false };
    applyDamage(tg.w, src, m, 1e6, false);
    expect(p.stats.kills).toBe(1);
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(cd - 0.5);
    const ogre = spawnAt(tg, 'ogre', { x: 30, y: 6 });
    const dealt = applyDamage(tg.w, src, ogre, 100, false);
    expect(dealt).toBeCloseTo(100 * 1.25 * (1 - 0.15));
  });

  it('blood_chalice heals the dragged-in character from drag damage', () => {
    const tg = makeGame();
    quietFloor(tg);
    tg.game.state.players[0].relics.push('blood_chalice');
    tg.game.state.players[0].party[1].hp = 300;
    const m = spawnAt(tg, 'golem', { x: 20, y: 6 });
    m.rt.base.maxHp = m.maxHp = m.hp = 1e6;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 20, y: 6 } });
    expect(active(tg).hp).toBeGreaterThan(300);
  });
});
