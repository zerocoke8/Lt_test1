// 기획 13차 보스 그로기 (docs/boss-groggy.md): gauge points, once per cast, human scaling, decay, lock + repeat growth,
// the groggy itself (stun, broken wind-ups, frozen cooldowns, wake gap), damage multipliers, phases / enrage / summons,
// cleanup and determinism.

import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { getCharacter, getPet } from '../../src/data';
import { applyDamage } from '../../src/sim/combat';
import { charCtx } from '../../src/sim/ctx';
import { groggyCard } from '../../src/sim/bot';
import { groggyMax } from '../../src/sim/groggy';
import { castSkill } from '../../src/sim/skills';
import { hasStatus } from '../../src/sim/status';
import { getEntity, type SimEntity } from '../../src/sim/world';
import type { PlayerSetup, Tunables } from '../../src/types';
import { BOT1, BOT2, active, advance, clearEvents, eventsOf, makeGame, spawnAt, type TestGame } from './helpers';

const party = (characters: string[], pets = ['owl_frost', 'cat_void', 'frog_bomb'], isBot = false): PlayerSetup => ({ name: isBot ? '봇' : '나', isBot, characters, pets });

function bossGame(opts: { floor?: number; players?: PlayerSetup[]; tunables?: Partial<Tunables>; seed?: number } = {}): TestGame {
  return makeGame({ seed: opts.seed ?? 7, startFloor: opts.floor ?? 10, players: opts.players ?? [party(['guardian', 'ranger', 'mage'])], tunables: { invincible: true, ...(opts.tunables ?? {}) } });
}

function bossOf(tg: TestGame): SimEntity {
  const b = getEntity(tg.w, tg.w.state.bossId);
  if (!b) throw new Error('no boss');
  return b;
}

/** No automatic normal skills (they could stun the boss in between). */
function holdNormals(tg: TestGame): void {
  for (const p of tg.w.state.players) for (const m of p.party) m.normalCooldownRemaining = 999;
}

const points = (tg: TestGame, player = 0) => tg.w.state.players[player].stats.groggyPoints;
const swapAt = (tg: TestGame, partyIndex: number, x: number, y: number, player = 0) => tg.game.dispatch({ type: 'swap', player, partyIndex, pos: { x, y } });

describe('groggy gauge: points per source', () => {
  it('drag hits (기획 13차 renewed beats): 가디언 성벽 강림 = 10 + 0.6 s stun (19), its wave tops the stun up to 1.2 s (28); 레인저 = 10; 메이지 = 10 once', () => {
    const tg = bossGame({ players: [party(['cleric', 'guardian', 'ranger'])] });
    holdNormals(tg);
    expect(swapAt(tg, 1, 12, 1).ok).toBe(true);
    expect(points(tg)).toBeCloseTo(19, 6); // slam: drag hit 10 + 0.6 s × 15
    advance(tg, 0.3);
    expect(points(tg)).toBeCloseTo(28, 6); // wave: only the longer stun counts (1.2 − 0.6 s more)
    expect(tg.w.state.bossGroggy!.fill).toBeCloseTo(28 / 100, 6);
    tg.w.state.players[0].appearLock = 0;
    expect(swapAt(tg, 2, 8, 0.6).ok).toBe(true);
    advance(tg, 1); // volleys from 0.25 s, the pierce at 0.75 s: one drag hit
    expect(points(tg)).toBeCloseTo(38, 6);

    const mg = bossGame({ players: [party(['cleric', 'mage', 'ranger'])] });
    holdNormals(mg);
    expect(swapAt(mg, 1, 12, 1).ok).toBe(true);
    advance(mg, 2.5); // every meteor landed (most of them on the boss)
    expect(points(mg)).toBeCloseTo(10, 6);
  });

  it('healer drags score only with their enemy beat (기획 13차): 클레릭 종 at 4 s (stun 0.6) = 19, 메딕 제세동 at 0.35 s (stun 0.8) = 22; the heals alone 0', () => {
    for (const [id, before, at, total] of [
      ['cleric', 3.8, 4.3, 19],
      ['medic', 0.25, 0.5, 22],
    ] as const) {
      const tg = bossGame({ players: [party(['guardian', id, 'ranger'])] });
      holdNormals(tg);
      expect(swapAt(tg, 1, 12, 1).ok).toBe(true);
      advance(tg, before);
      expect(points(tg), id).toBe(0);
      advance(tg, at - before);
      expect(points(tg), id).toBeCloseTo(total, 6);
    }
  });

  it('echo_seal recast gives 0 (one swap = one score)', () => {
    const tg = bossGame({ players: [party(['cleric', 'ranger', 'mage'])] });
    holdNormals(tg);
    tg.w.state.players[0].relics.push('echo_seal');
    expect(swapAt(tg, 1, 8, 0.6).ok).toBe(true);
    advance(tg, 3);
    expect(eventsOf(tg, 'skillCast').filter(e => e.skillId === 'ranger_d').length).toBe(4); // 2 beats × (cast + echo)
    expect(points(tg)).toBeCloseTo(10, 6);
  });

  it('stun seconds: ult ×10 (크로노 정지 2.5 s = 25, 기획 13차: a stasis counts as a stun of its full time), normal ×2 (가디언 방패 강타 = 2), pets ×5 (부엉이 5, 블랙홀 고양이 2.5)', () => {
    const tg = bossGame({ players: [party(['chrono', 'guardian', 'ranger'])] });
    holdNormals(tg);
    const c = active(tg);
    c.pos = { x: 12, y: 2 };
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    expect(points(tg)).toBe(0); // the cut-in: nothing lands before 0.45 s
    advance(tg, 0.5);
    expect(points(tg)).toBeCloseTo(25, 6);

    const g = bossGame({ players: [party(['guardian', 'ranger', 'mage'])] });
    const e = active(g);
    e.pos = { x: 12, y: 2 };
    e.targetId = bossOf(g).id;
    const def = getCharacter('guardian');
    castSkill(g.w, charCtx(g.w, e, 'normal', def.normal), def.normal.actions);
    expect(points(g)).toBeCloseTo(2, 6);

    const pets = bossGame({ players: [party(['guardian', 'ranger', 'mage'], ['owl_frost', 'cat_void', 'frog_bomb'])] });
    holdNormals(pets);
    expect(pets.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 12, y: 1 } }).ok).toBe(true);
    expect(points(pets)).toBeCloseTo(5, 6);
    expect(pets.game.dispatch({ type: 'pet', player: 0, petIndex: 1, pos: { x: 12, y: 1 } }).ok).toBe(true);
    expect(points(pets)).toBeCloseTo(7.5, 6);
    // the bomb frog has no stun: damage only = 0
    expect(pets.game.dispatch({ type: 'pet', player: 0, petIndex: 2, pos: { x: 12, y: 1 } }).ok).toBe(true);
    expect(points(pets)).toBeCloseTo(7.5, 6);
    expect(getPet('frog_bomb').action.effects.some(x => x.kind === 'status' && x.status === 'stun')).toBe(false);
  });

  it('basic attacks never fill it; the boss is still immune to character stuns', () => {
    const tg = bossGame({ players: [party(['ranger', 'mage', 'cleric'])] });
    holdNormals(tg);
    advance(tg, 8);
    expect(eventsOf(tg, 'attack').some(a => a.sourceId === active(tg).id)).toBe(true);
    expect(points(tg)).toBe(0);
    const g = bossGame({ players: [party(['cleric', 'guardian', 'ranger'])] });
    holdNormals(g);
    swapAt(g, 1, 12, 1);
    expect(hasStatus(bossOf(g), 'stun')).toBe(false);
  });

  it('gain events only from 5 points on, with the player and why', () => {
    const tg = bossGame({ players: [party(['cleric', 'guardian', 'ranger'])] });
    holdNormals(tg);
    swapAt(tg, 1, 12, 1);
    advance(tg, 0.3);
    expect(eventsOf(tg, 'groggyGain')).toEqual([
      { type: 'groggyGain', player: 0, amount: 19, why: 'drag' },
      { type: 'groggyGain', player: 0, amount: 9, why: 'drag' },
    ]);
  });
});

describe('groggy gauge: max, decay, lock, repeat', () => {
  it('max = 100 × boss (5층 0.8 · 10/15층 1 · 20층 1.1) × humans (1 / 1.4 / 1.8) × repeat', () => {
    const at = (floor: number, players?: PlayerSetup[]) => groggyMax(bossGame({ floor, players }).w);
    expect(at(5)).toBeCloseTo(80, 6);
    expect(at(10)).toBeCloseTo(100, 6);
    expect(at(15)).toBeCloseTo(100, 6);
    expect(at(20)).toBeCloseTo(110, 6);
    const h = (n: number) => [...Array(3)].map((_, i) => party(['guardian', 'ranger', 'mage'], undefined, i >= n));
    expect(at(10, h(1))).toBeCloseTo(100, 6);
    expect(at(10, h(2))).toBeCloseTo(140, 6);
    expect(at(10, h(3))).toBeCloseTo(180, 6);
    expect(at(10, [BOT1, BOT2])).toBeCloseTo(100, 6); // bots only = ×1
  });

  it('a seat turning bot changes the max live, never the fill', () => {
    const tg = bossGame({ players: [party(['cleric', 'guardian', 'ranger']), party(['cleric', 'guardian', 'ranger'])] });
    holdNormals(tg);
    swapAt(tg, 1, 12, 1);
    const g = tg.w.state.bossGroggy!;
    expect(g.fill).toBeCloseTo(19 / 140, 6);
    tg.game.setPlayerBot(1, true);
    expect(g.fill).toBeCloseTo(19 / 140, 6);
    expect(groggyMax(tg.w)).toBeCloseTo(100, 6);
  });

  it('no points for 4 s → −4 points per second (never below 0)', () => {
    const tg = bossGame({ players: [party(['cleric', 'guardian', 'ranger'])] });
    holdNormals(tg);
    swapAt(tg, 1, 12, 1);
    const g = tg.w.state.bossGroggy!;
    advance(tg, 0.3); // the wave's points land at 0.27 s
    advance(tg, 3.9);
    expect(g.fill).toBeCloseTo(0.28, 6);
    advance(tg, 1.1);
    expect(g.fill).toBeGreaterThan(0.28 - 0.05 - 0.01);
    expect(g.fill).toBeLessThan(0.28 - 0.03);
    advance(tg, 10);
    expect(g.fill).toBe(0);
  });

  it('near (≥ 80 %), then the break; the gauge takes no points while down or locked; next max ×1.5', () => {
    const tg = bossGame({ players: [party(['guardian', 'paladin', 'chrono'])] });
    holdNormals(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy', fill: 0.85 } });
    const g = tg.w.state.bossGroggy!;
    advance(tg, 1 / 30);
    expect(g.near).toBe(true);
    swapAt(tg, 1, 12, 1); // paladin brand 10 → 95 %, its pillar (0.5 s, stun 1.2 s) → full
    expect(g.left).toBe(0);
    expect(g.fill).toBeCloseTo(0.95, 6);
    advance(tg, 0.6);
    expect(g.left).toBeGreaterThan(4.8);
    expect(g.count).toBe(1);
    expect(g.breaker).toBe(0);
    expect(g.near).toBe(false);
    expect(tg.w.state.players[0].stats.groggyBreaks).toBe(1);
    const before = points(tg);
    tg.w.state.players[0].appearLock = 0;
    swapAt(tg, 2, 12, 1); // chrono drag while down (rift and stop): nothing
    advance(tg, 1);
    expect(points(tg)).toBe(before);
    advance(tg, 4);
    expect(g.left).toBe(0);
    expect(g.lock).toBeGreaterThan(9.8);
    expect(g.fill).toBe(0);
    tg.w.state.players[0].appearLock = 0;
    tg.w.state.players[0].party[1].swapCooldownRemaining = 0;
    swapAt(tg, 1, 12, 1); // locked: nothing
    advance(tg, 0.6);
    expect(points(tg)).toBe(before);
    advance(tg, 10);
    expect(g.lock).toBe(0);
    expect(groggyMax(tg.w)).toBeCloseTo(150, 6);
    tg.w.state.players[0].appearLock = 0;
    tg.w.state.players[0].party[2].swapCooldownRemaining = 0;
    swapAt(tg, 2, 12, 1);
    expect(g.fill).toBeCloseTo(10 / 150, 6); // the rift (no stun) — its stop adds the stun later
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    advance(tg, 15.1);
    expect(groggyMax(tg.w)).toBeCloseTo(200, 6);
  });
});

describe('groggy: the boss is down', () => {
  it('stun icon, every unstarted wind-up broken (interrupt), no attack / cast for 5 s, cooldowns frozen, first pattern ≥ 1.5 s after it stands up', () => {
    const tg = bossGame({ floor: 10, players: [party(['ranger', 'mage', 'cleric'])] });
    holdNormals(tg);
    const boss = bossOf(tg);
    // wait for a telegraphed pattern
    for (let i = 0; i < 30 * 30 && !tg.w.state.telegraphs.some(t => t.team === 'enemy'); i++) advance(tg, 1 / 30);
    expect(tg.w.state.telegraphs.some(t => t.team === 'enemy')).toBe(true);
    clearEvents(tg);
    const cds = [...boss.rt.skillCds];
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    expect(hasStatus(boss, 'stun')).toBe(true);
    expect(eventsOf(tg, 'bossGroggy')[0]).toMatchObject({ entityId: boss.id, player: null, count: 1, duration: 5 });
    advance(tg, 1 / 30);
    expect(eventsOf(tg, 'interrupt').length).toBeGreaterThan(0);
    expect(tg.w.state.telegraphs.some(t => t.team === 'enemy')).toBe(false);
    clearEvents(tg);
    advance(tg, 4.9);
    expect(eventsOf(tg, 'attack').filter(a => a.sourceId === boss.id)).toEqual([]);
    expect(eventsOf(tg, 'skillCast').filter(c => c.sourceId === boss.id)).toEqual([]);
    expect(boss.rt.skillCds).toEqual(cds);
    expect(boss.anim).toBe('stunned');
    clearEvents(tg);
    advance(tg, 0.15);
    expect(eventsOf(tg, 'bossGroggyEnd')).toEqual([{ type: 'bossGroggyEnd', entityId: boss.id }]);
    expect(hasStatus(boss, 'stun')).toBe(false);
    const wake = tg.w.state.time;
    for (let i = 0; i < 30 * 20 && !eventsOf(tg, 'skillCast').some(c => c.sourceId === boss.id); i++) advance(tg, 1 / 30);
    const first = tg.events.find(e => e.type === 'skillCast' && e.sourceId === boss.id);
    expect(first).toBeDefined();
    expect(tg.w.state.time - wake).toBeGreaterThanOrEqual(1.5 - 0.05);
  });

  it('damage: ×1.5 for everything, ×2 for a drag cast, flagged; a summon (not the boss) takes no multiplier', () => {
    const tg = bossGame();
    const boss = bossOf(tg);
    const src = (isDrag: boolean) => ({ casterId: null, team: 'ally' as const, player: 0, source: isDrag ? ('drag' as const) : ('basic' as const), isDrag });
    const hit = (e: SimEntity, isDrag: boolean) => applyDamage(tg.w, src(isDrag), e, 100, false);
    const base = hit(boss, false);
    const add = spawnAt(tg, 'goblin', { x: 6, y: 6 });
    add.hp = add.maxHp = 1e6;
    const addBase = hit(add, false);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    clearEvents(tg);
    expect(hit(boss, false)).toBeCloseTo(base * 1.5, 6);
    expect(hit(boss, true)).toBeCloseTo(base * 2, 6);
    expect(hit(add, true)).toBeCloseTo(addBase, 6);
    const dmg = eventsOf(tg, 'damage');
    expect(dmg[0]).toMatchObject({ groggy: true });
    expect(dmg[0].drag).toBeUndefined();
    expect(dmg[1]).toMatchObject({ groggy: true, drag: true });
    expect(dmg[2].groggy).toBeUndefined();
    expect(tg.w.state.players[0].stats.groggyDamage).toBeCloseTo(base * 3.5, 6);
  });

  it('a phase crossed while down: ◆ at once (bossPhase now), the opener only ≥ 1.5 s after it stands up', () => {
    const tg = bossGame({ floor: 10, players: [party(['ranger', 'mage', 'cleric'])] });
    holdNormals(tg);
    const boss = bossOf(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    clearEvents(tg);
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'basic', isDrag: false }, boss, (boss.hp - boss.maxHp * 0.45) / 1.5 / (1 - 0.2), false);
    expect(eventsOf(tg, 'bossPhase').length).toBe(1);
    expect(boss.rt.phase).toBe(1);
    advance(tg, 4.8);
    expect(eventsOf(tg, 'skillCast').filter(c => c.sourceId === boss.id)).toEqual([]);
    expect(tg.w.state.bossGroggy!.left).toBeGreaterThan(0);
    for (let i = 0; i < 30 && eventsOf(tg, 'bossGroggyEnd').length === 0; i++) advance(tg, 1 / 30);
    const wake = tg.w.state.time;
    clearEvents(tg);
    for (let i = 0; i < 30 * 5 && !eventsOf(tg, 'skillCast').some(c => c.sourceId === boss.id); i++) advance(tg, 1 / 30);
    const first = tg.events.find(e => e.type === 'skillCast' && e.sourceId === boss.id);
    expect(first && first.type === 'skillCast' ? first.skillId : null).toBe('ol_stamp_combo');
    expect(tg.w.state.time - wake).toBeGreaterThanOrEqual(1.5 - 0.05);
  });

  it('the enrage timer keeps running: enraged while down, it stays down the full 5 s', () => {
    const tg = bossGame({ tunables: { bossFloorTime: 3 } });
    holdNormals(tg);
    advance(tg, 2);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    advance(tg, 2);
    expect(tg.w.state.bossEnraged).toBe(true);
    expect(tg.w.state.bossGroggy!.left).toBeGreaterThan(2.5);
    expect(hasStatus(bossOf(tg), 'stun')).toBe(true);
  });

  it('summons keep fighting while the boss is down', () => {
    const tg = bossGame({ players: [party(['ranger', 'mage', 'cleric'])] });
    holdNormals(tg);
    const c = active(tg);
    const add = spawnAt(tg, 'goblin', { x: c.pos.x + 1, y: c.pos.y });
    add.hp = add.maxHp = 1e6;
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    clearEvents(tg);
    advance(tg, 3);
    expect(eventsOf(tg, 'attack').some(a => a.sourceId === add.id)).toBe(true);
  });

  it('HP 0 while down → retreat → floor clear, the gauge is gone', () => {
    const tg = bossGame();
    const boss = bossOf(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'basic', isDrag: false }, boss, 1e9, false);
    advance(tg, 1 / 30);
    expect(eventsOf(tg, 'bossRetreat').length).toBe(1);
    expect(tg.w.state.phase).toBe('reward');
    expect(tg.w.state.bossGroggy).toBeNull();
  });
});

describe('groggy: lifecycle and toggles', () => {
  it('normal floors and mid bosses have no gauge; floor jumps make a fresh one; run end / skip clears it', () => {
    const tg = bossGame({ floor: 4 });
    expect(tg.w.state.bossGroggy).toBeNull();
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 5 } });
    expect(tg.w.state.bossGroggy).toMatchObject({ fill: 0, left: 0, lock: 0, count: 0, breaker: null });
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 10 } });
    expect(tg.w.state.bossGroggy).toMatchObject({ fill: 0, left: 0, count: 0 });
    expect(hasStatus(bossOf(tg), 'stun')).toBe(false);
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    expect(tg.w.state.bossGroggy).toBeNull();
    const q = bossGame();
    q.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    q.game.dispatch({ type: 'quit' });
    expect(q.w.state.bossGroggy).toBeNull();
  });

  it('bossGroggyThreshold 0 turns it off (no gauge, no gain, debug refused); back on → a fresh gauge', () => {
    const tg = bossGame({ tunables: { bossGroggyThreshold: 0 }, players: [party(['cleric', 'guardian', 'ranger'])] });
    holdNormals(tg);
    expect(tg.w.state.bossGroggy).toBeNull();
    swapAt(tg, 1, 12, 1);
    expect(points(tg)).toBe(0);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(false);
    tg.game.dispatch({ type: 'tunables', patch: { bossGroggyThreshold: 100 } });
    advance(tg, 1 / 30);
    expect(tg.w.state.bossGroggy).not.toBeNull();
  });

  it('tunables: duration and multipliers are live', () => {
    const tg = bossGame({ tunables: { bossGroggyDuration: 2, bossGroggyDamageMult: 2, bossGroggyDragMult: 3 } });
    const boss = bossOf(tg);
    const hit = (isDrag: boolean) => applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'basic', isDrag }, boss, 100, false);
    const base = hit(false);
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    expect(tg.w.state.bossGroggy!.total).toBe(2);
    expect(hit(false)).toBeCloseTo(base * 2, 6);
    expect(hit(true)).toBeCloseTo(base * 3, 6);
    advance(tg, 2.1);
    expect(tg.w.state.bossGroggy!.left).toBe(0);
  });
});

describe('groggy: bots and determinism', () => {
  it('bots: after a break a bot with a ready card swaps soon to its finisher (no-stun drag, most damage); near full → the stun drag', () => {
    const tg = bossGame({ players: [party(['ranger', 'mage', 'cleric']), { name: '봇', isBot: true, characters: ['cleric', 'guardian', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'turtle_guard'] }] });
    holdNormals(tg);
    const bot = tg.w.state.players[1];
    bot.rt.bot.nextSwapAt = 1e9;
    advance(tg, 2);
    expect(groggyCard(tg.w, bot, [1, 2])).toBeNull();
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy', fill: 0.85 } });
    expect(groggyCard(tg.w, bot, [1, 2])).toBe(1); // guardian (stun) breaks it
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    expect(groggyCard(tg.w, bot, [1, 2])).toBe(2); // mage finishes
    clearEvents(tg);
    advance(tg, 2.05);
    const appear = eventsOf(tg, 'appear').filter(a => a.player === 1);
    expect(appear.length).toBe(1);
    expect(appear[0].partyIndex).toBe(2);
  });

  it('bots use a full ult on a groggy boss within 0.5 s (+ think step)', () => {
    const tg = bossGame({ players: [party(['ranger', 'mage', 'cleric']), { ...BOT1 }] });
    holdNormals(tg);
    advance(tg, 1);
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
    tg.w.state.players[1].rt.bot.ultAt = tg.w.state.time + 60;
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
    advance(tg, 1.05);
    expect(tg.w.state.players[1].stats.ultsUsed).toBe(1);
  });

  it('same seed → same break ticks and the same snapshot (1 human + 2 bots, floor 5, 60 s)', () => {
    const run = () => {
      const tg = bossGame({ floor: 5, seed: 99, players: [party(['guardian', 'paladin', 'chrono']), BOT1, BOT2] });
      const breaks: number[] = [];
      for (let i = 0; i < 30 * 60 && tg.w.state.phase === 'combat'; i++) {
        if (i % 150 === 40) tg.game.dispatch({ type: 'swap', player: 0, partyIndex: (i / 150) % 3 | 0, pos: { x: 12, y: 1 } });
        advance(tg, 1 / 30);
        breaks.push(...eventsOf(tg, 'bossGroggy').map(() => tg.w.state.tick));
        clearEvents(tg);
      }
      return { breaks, snap: JSON.stringify(cleanState(tg.w.state)) };
    };
    const a = run();
    const b = run();
    expect(a.breaks.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
