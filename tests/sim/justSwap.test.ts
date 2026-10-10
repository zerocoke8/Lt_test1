// 기획 17차 저스트 교대 (docs/just-swap.md): which attacks count, the window, the rewards, credit, bots, determinism.
import { describe, expect, it } from 'vitest';
import type { AreaShape, GameEvent, Tunables, Vec2 } from '../../src/types';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { findJustThreats, justCooldown, justCue, justParams, justWindow } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import { applyStatus } from '../../src/sim/status';
import { forceGroggy } from '../../src/sim/groggy';
import type { CastCtx, PendingHit, SimEntity } from '../../src/sim/world';
import { BOT1, BOT2, HUMAN, active, eventsOf, clearEvents, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const PARTY = { ...HUMAN, characters: ['guardian', 'blade', 'mage'] };

function setup(t: Partial<Tunables> = {}, startFloor?: number): TestGame {
  const tg = makeGame({ players: [PARTY], tunables: { invincible: true, ...t }, ...(startFloor ? { startFloor } : null) });
  quietFloor(tg);
  for (let i = 0; i < 20; i++) tick(tg.w); // past the run-start appear window
  clearEvents(tg);
  return tg;
}

function enemyCtx(tg: TestGame, at: Vec2, caster?: SimEntity): CastCtx {
  if (caster) return { ...unitCtx(tg.w, caster, 'test_skill', '테스트'), point: { ...at } };
  return {
    casterId: null, selfId: null, team: 'enemy', player: null, partyIndex: null, slot: 'monster', source: 'basic', skillId: 'test_skill', name: '테스트',
    atk: 10, critChance: 0, critMult: 1, dmgMult: 1, healMult: 1, shieldMult: 1, radiusMult: 1, point: { ...at }, targetId: null, targetPos: null,
    allyTargetId: null, origin: { ...at }, isDrag: false, summonMult: 1,
  };
}

/** A telegraphed enemy part landing `delay` s from now at `at`. */
function threat(tg: TestGame, at: Vec2, delay: number, o: { area?: AreaShape; caster?: SimEntity; targetId?: number; amount?: number; lead?: number } = {}): PendingHit {
  const ctx = enemyCtx(tg, at, o.caster);
  if (o.targetId != null) ctx.targetId = o.targetId;
  const p = startAction(tg.w, ctx, {
    center: o.targetId != null ? 'target' : 'point',
    area: o.area ?? { shape: 'circle', radius: 1.5 },
    affects: 'enemies',
    effects: [{ kind: 'damage', amount: o.amount ?? 0.5 }],
    delay,
    ...(o.lead != null ? { telegraphLead: o.lead } : null),
  });
  return p!;
}

/** Tick until the part has at most `left` s to go. */
function until(tg: TestGame, p: PendingHit, left: number): void {
  for (let i = 0; i < 300 && p.remaining > left + 1e-9; i++) tick(tg.w);
}

function swap(tg: TestGame, idx = 1, pos: Vec2 = { x: 3, y: 3 }) {
  return tg.game.dispatch({ type: 'swap', player: 0, partyIndex: idx, pos });
}

const justs = (tg: TestGame) => eventsOf(tg, 'justSwap');

describe('저스트 교대: which attacks count', () => {
  it('an area attack the field character stands in, inside the window → just (event, credit, stats)', () => {
    const tg = setup();
    const me = active(tg);
    const p = threat(tg, me.pos, 1.2);
    until(tg, p, 0.4);
    expect(swap(tg).ok).toBe(true);
    const ev = justs(tg);
    expect(ev.length).toBe(1);
    expect(ev[0]).toMatchObject({ player: 0, outIndex: 0, inIndex: 1, dodged: 1, telegraphIds: [p.telegraphId], boss: false });
    expect(ev[0].landIn).toBeGreaterThan(0);
    expect(ev[0].landIn).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(tg.w.state.players[0].stats.justSwaps).toBe(1);
    expect(tg.w.state.players[0].stats.justDodged).toBe(1);
  });

  it('outside the area, or before the window → no just', () => {
    const tg = setup();
    const me = active(tg);
    const far = threat(tg, { x: me.pos.x + 6, y: me.pos.y }, 1.2);
    until(tg, far, 0.3);
    expect(swap(tg).ok).toBe(true);
    expect(justs(tg).length).toBe(0);
    const tg2 = setup();
    const p = threat(tg2, active(tg2).pos, 1.2);
    until(tg2, p, 0.7);
    expect(swap(tg2).ok).toBe(true);
    expect(justs(tg2).length).toBe(0);
  });

  it('a single-target attack counts only when aimed at the leaving character', () => {
    const tg = setup();
    const me = active(tg);
    const mon = spawnAt(tg, 'golem', { x: me.pos.x + 6, y: me.pos.y }); // out of the guardian's stun reach
    const p = threat(tg, me.pos, 1, { area: { shape: 'single' }, caster: mon, targetId: me.id });
    until(tg, p, 0.3);
    expect(swap(tg).ok).toBe(true);
    expect(justs(tg).length).toBe(1);
    const tg2 = setup();
    const me2 = active(tg2);
    const mon2 = spawnAt(tg2, 'golem', { x: me2.pos.x + 6, y: me2.pos.y });
    const p2 = threat(tg2, me2.pos, 1, { area: { shape: 'single' }, caster: mon2, targetId: mon2.id });
    until(tg2, p2, 0.3);
    expect(swap(tg2).ok).toBe(true);
    expect(justs(tg2).length).toBe(0);
  });

  it('short telegraphs: the window is 60 % of the telegraph (0.6 s → 0.36 s)', () => {
    const jp = justParams(setup().w, setup().w.state.players[0]);
    expect(justWindow(jp, 0.6)).toBeCloseTo(0.36, 9);
    expect(justWindow(jp, 0.8)).toBeCloseTo(0.48, 9);
    expect(justWindow(jp, 2)).toBeCloseTo(0.5, 9);
    const tg = setup();
    const p = threat(tg, active(tg).pos, 0.6);
    until(tg, p, 0.4);
    expect(p.remaining).toBeGreaterThan(0.36);
    expect(swap(tg).ok).toBe(true);
    expect(justs(tg).length).toBe(0);
    const tg2 = setup();
    const p2 = threat(tg2, active(tg2).pos, 0.6);
    until(tg2, p2, 0.3);
    expect(swap(tg2).ok).toBe(true);
    expect(justs(tg2).length).toBe(1);
  });

  it('a part whose telegraph is not shown yet (telegraphLead) does not count', () => {
    const tg = setup();
    const me = active(tg);
    const p = threat(tg, me.pos, 1.2, { lead: 0.2 });
    until(tg, p, 0.35);
    expect(p.telegraphId).toBeNull();
    expect(findJustThreats(tg.w, tg.w.state.players[0], me)).toEqual([]);
  });

  it('broken / frozen / charmed casters do not count: stunned, cancelled, stasis, groggy boss, charm', () => {
    const cases: [string, (tg: TestGame, mon: SimEntity, p: PendingHit) => void][] = [
      ['stunned', (_tg, mon) => void applyStatus(mon, 'stun', 2, 0, 0)],
      ['cancelled', (_tg, _mon, p) => void (p.cancelled = true)],
      ['stasis', (_tg, mon) => void applyStatus(mon, 'stasis', 2, 0, 0)],
      ['charmed', (_tg, mon) => void applyStatus(mon, 'charm', 2, 0, 0)],
    ];
    for (const [why, spoil] of cases) {
      const tg = setup();
      const me = active(tg);
      const mon = spawnAt(tg, 'goblin', { x: me.pos.x + 3, y: me.pos.y });
      const p = threat(tg, me.pos, 1, { caster: mon });
      until(tg, p, 0.45);
      spoil(tg, mon, p);
      expect(findJustThreats(tg.w, tg.w.state.players[0], me), why).toEqual([]);
    }
    // a groggy boss's unstarted part
    const tg = setup({}, 5);
    const boss = tg.w.state.entities.find(e => e.tier === 'boss')!;
    const me = active(tg);
    const p = threat(tg, me.pos, 1, { caster: boss });
    until(tg, p, 0.45);
    expect(findJustThreats(tg.w, tg.w.state.players[0], me).length).toBe(1);
    expect(forceGroggy(tg.w, 1)).toBe(true);
    expect(findJustThreats(tg.w, tg.w.state.players[0], me)).toEqual([]);
  });

  it('a leaving character invulnerable until after the hit gets no just', () => {
    const tg = setup();
    const me = active(tg);
    const p = threat(tg, me.pos, 1.2);
    until(tg, p, 0.4);
    me.invulnTime = 1;
    expect(swap(tg).ok).toBe(true);
    expect(justs(tg).length).toBe(0);
  });

  it('several attacks: one just, ×N dodged, the source is the one landing first (then the bigger one)', () => {
    const tg = setup();
    const me = active(tg);
    const late = threat(tg, me.pos, 1.3, { amount: 3 });
    const early = threat(tg, me.pos, 1.2, { amount: 0.5 });
    until(tg, early, 0.3);
    expect(swap(tg).ok).toBe(true);
    const ev = justs(tg);
    expect(ev.length).toBe(1);
    expect(ev[0].dodged).toBe(2);
    expect(ev[0].telegraphIds).toEqual([early.telegraphId, late.telegraphId]);
    const tg2 = setup();
    const me2 = active(tg2);
    const small = threat(tg2, me2.pos, 1.2, { amount: 0.5 });
    const big = threat(tg2, me2.pos, 1.2, { amount: 2 });
    until(tg2, small, 0.3);
    const th = findJustThreats(tg2.w, tg2.w.state.players[0], me2);
    expect(th.map(t => t.telegraphId)).toEqual([big.telegraphId, small.telegraphId]);
  });

  it('one telegraph is credited once per player (the incoming character standing in it gets no second just)', () => {
    const tg = setup({ appearLockTime: 0 });
    const me = active(tg);
    const p = threat(tg, me.pos, 1.2);
    until(tg, p, 0.45);
    expect(swap(tg, 1, { ...me.pos }).ok).toBe(true);
    expect(justs(tg).length).toBe(1);
    const inc = active(tg);
    inc.invulnTime = 0;
    expect(findJustThreats(tg.w, tg.w.state.players[0], inc)).toEqual([]);
  });

  it('HUD cue from the public telegraphs: danger while one covers me, now inside the window (earlier by the age given)', () => {
    const tg = setup();
    const me = active(tg);
    expect(justCue(tg.w.state, tg.w.tunables, 0)).toEqual({ danger: false, now: false, landIn: null });
    const p = threat(tg, me.pos, 1.2);
    until(tg, p, 0.8);
    expect(justCue(tg.w.state, tg.w.tunables, 0)).toMatchObject({ danger: true, now: false });
    expect(justCue(tg.w.state, tg.w.tunables, 0, 0.35).now).toBe(true);
    until(tg, p, 0.4);
    const cue = justCue(tg.w.state, tg.w.tunables, 0);
    expect(cue.now).toBe(true);
    expect(cue.landIn).toBeCloseTo(p.remaining, 6);
  });

  it('window 0 turns it off', () => {
    const tg = setup({ justSwapWindow: 0 });
    const p = threat(tg, active(tg).pos, 1.2);
    until(tg, p, 0.3);
    expect(swap(tg).ok).toBe(true);
    expect(justs(tg).length).toBe(0);
  });
});

describe('저스트 교대: rewards', () => {
  it('leaving cooldown ×0.6 after every other rule, never below 2.4 s; the ring keeps its full length', () => {
    expect(justCooldown(10, 0.4)).toBeCloseTo(6, 9);
    expect(justCooldown(4, 0.4)).toBeCloseTo(2.4, 9);
    expect(justCooldown(2, 0.4)).toBe(2);
    const tg = setup();
    const p = threat(tg, active(tg).pos, 1.2);
    until(tg, p, 0.3);
    expect(swap(tg).ok).toBe(true);
    const m = tg.w.state.players[0].party[0];
    expect(m.swapCooldownTotal).toBeCloseTo(10, 6); // guardian 10 s
    expect(m.swapCooldownRemaining).toBeCloseTo(6, 6);
    expect(justs(tg)[0].cdCut).toBeCloseTo(4, 6);
  });

  /** Damage numbers of the incoming drag (blade) with and without the just. */
  function dragHits(t: Partial<Tunables>): { amounts: number[]; just: boolean[]; stuns: number[] } {
    const tg = setup(t);
    const me = active(tg);
    for (let i = 0; i < 4; i++) spawnAt(tg, 'golem', { x: 12 + i * 0.4, y: 6 });
    const p = threat(tg, me.pos, 1.2);
    until(tg, p, 0.3);
    clearEvents(tg);
    expect(swap(tg, 2, { x: 12.5, y: 6 }).ok).toBe(true); // mage
    for (let i = 0; i < 45; i++) tick(tg.w);
    const dmg = eventsOf(tg, 'damage').filter(e => e.source === 'drag');
    const stuns = eventsOf(tg, 'statusApplied').map(e => e.duration);
    return { amounts: dmg.map(e => e.amount), just: dmg.map(e => !!e.just), stuns };
  }

  it('the incoming drag hits ×1.5 (gold numbers); status times stay', () => {
    const on = dragHits({});
    const off = dragHits({ justSwapWindow: 0 });
    expect(on.amounts.length).toBeGreaterThan(0);
    expect(on.amounts.length).toBe(off.amounts.length);
    on.amounts.forEach((a, i) => expect(a / off.amounts[i]).toBeCloseTo(1.5, 6));
    // hits of the cast are gold; burn ticks (a status) are not, but carry the power in their value
    expect(on.just.filter(Boolean).length).toBeGreaterThan(on.amounts.length / 2);
    expect(off.just.some(Boolean)).toBe(false);
    expect(on.stuns).toEqual(off.stuns);
  });

  it('the drag shield ×1.5; the paper doll attack ×1.5 (its HP stays)', () => {
    const run = (t: Partial<Tunables>) => {
      const tg = makeGame({ players: [{ ...HUMAN, characters: ['blade', 'guardian', 'puppeteer'] }], tunables: { invincible: true, ...t } });
      quietFloor(tg);
      for (let i = 0; i < 20; i++) tick(tg.w);
      const p = threat(tg, active(tg).pos, 1.2);
      until(tg, p, 0.3);
      expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 6, y: 6 } }).ok).toBe(true);
      const g = active(tg);
      return { shield: g.shield, tg };
    };
    const a = run({});
    const b = run({ justSwapWindow: 0 });
    expect(a.shield / b.shield).toBeCloseTo(1.5, 6);
    // puppeteer: the doll's attack (burst) ×1.5
    const doll = (t: Partial<Tunables>) => {
      const tg = makeGame({ players: [{ ...HUMAN, characters: ['blade', 'puppeteer', 'guardian'] }], tunables: { invincible: true, ...t } });
      quietFloor(tg);
      for (let i = 0; i < 20; i++) tick(tg.w);
      const p = threat(tg, active(tg).pos, 1.2);
      until(tg, p, 0.3);
      expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true);
      for (let i = 0; i < 8; i++) tick(tg.w);
      return tg.w.state.entities.filter(e => e.defId === 'paper_doll');
    };
    const dj = doll({});
    const dn = doll({ justSwapWindow: 0 });
    expect(dj.length).toBe(2);
    expect(dj[0].rt.base.atk / dn[0].rt.base.atk).toBeCloseTo(1.5, 6);
    expect(dj[0].maxHp).toBeCloseTo(dn[0].maxHp, 6);
  });

  it('groggy points of the just drag are unchanged', () => {
    const pts = (t: Partial<Tunables>) => {
      const tg = setup(t, 5);
      const boss = tg.w.state.entities.find(e => e.tier === 'boss')!;
      const p = threat(tg, active(tg).pos, 1.2);
      until(tg, p, 0.3);
      expect(swap(tg, 1, { x: boss.pos.x, y: 1 }).ok).toBe(true);
      for (let i = 0; i < 10; i++) tick(tg.w);
      return tg.w.state.players[0].stats.groggyPoints;
    };
    expect(pts({})).toBeCloseTo(pts({ justSwapWindow: 0 }), 9);
  });
});

describe('저스트 교대: bots and determinism', () => {
  function botRun(t: Partial<Tunables>, seed = 99): { justs: number; draws: number[]; hash: string } {
    const tg = makeGame({ seed, players: [{ ...HUMAN, isBot: true }, BOT1, BOT2], tunables: { invincible: true, ...t } });
    const rng = tg.w.rng;
    const orig = rng.chance.bind(rng);
    const draws: number[] = [];
    rng.chance = (p: number) => {
      if (p === t.botJustChance) draws.push(p);
      return orig(p);
    };
    for (let i = 0; i < 30 * 90 && tg.w.state.phase === 'combat'; i++) tick(tg.w);
    const evs = tg.game.drainEvents();
    const s = tg.w.state;
    return { justs: evs.filter((e: GameEvent) => e.type === 'justSwap').length, draws, hash: JSON.stringify([s.tick, s.floor, (rng as unknown as { s: number }).s]) };
  }

  it('bots try a just on some attacks (chance > 0) and never draw for it at chance 0', () => {
    const on = botRun({ botJustChance: 0.77 });
    expect(on.draws.length).toBeGreaterThan(0);
    const off = botRun({ botJustChance: 0 });
    expect(off.draws.length).toBe(0);
  });

  it('window 0: no just events, the bots draw nothing for it, the run is the same with any bot chance', () => {
    const a = botRun({ justSwapWindow: 0, botJustChance: 0.4321 });
    const b = botRun({ justSwapWindow: 0, botJustChance: 0 });
    expect(a.justs).toBe(0);
    expect(a.draws.length).toBe(0);
    expect(a.hash).toBe(b.hash);
  });

  it('same seed, same run (justs included)', () => {
    expect(botRun({ botJustChance: 0.5 }, 7)).toEqual(botRun({ botJustChance: 0.5 }, 7));
  });
});
