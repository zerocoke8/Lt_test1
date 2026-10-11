import { describe, expect, it } from 'vitest';
import { bestDropPoint, raidDropScore } from '../../src/sim/bot';
import { hitsArea } from '../../src/sim/geometry';
import { applyStatus } from '../../src/sim/status';
import { active, advance, BOT1, clearEvents, eventsOf, HUMAN, killActive, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';
import { BOT_RAID, arenaAt, safeRing } from '../../src/data/bosses';
import { unitCtx } from '../../src/sim/ctx';
import { startAction } from '../../src/sim/skills';
import type { SimEntity } from '../../src/sim/world';
import type { SkillAction, Vec2 } from '../../src/types';
import { bossOf, raidGame } from './bossRaidHelpers';

const BOT_P0 = { ...HUMAN, isBot: true };

describe('R23 bots', () => {
  it('swaps right away when the active character drops below 30% HP', () => {
    const tg = makeGame({ players: [BOT_P0] });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    const e = active(tg);
    e.hp = e.maxHp * 0.25;
    advance(tg, 0.6);
    expect(tg.game.state.players[0].activeIndex).not.toBe(0);
    expect(tg.game.state.players[0].stats.swaps).toBe(1);
  });

  it('refills an empty field after a 0.5–1.5 s reaction', () => {
    const tg = makeGame({ players: [BOT_P0, BOT1] });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    killActive(tg, 0);
    const t0 = tg.game.state.time;
    advance(tg, 0.45);
    expect(tg.game.state.players[0].activeIndex).toBeNull();
    for (let i = 0; i < 80 && tg.game.state.players[0].activeIndex == null; i++) advance(tg, 1 / 30);
    const dt = tg.game.state.time - t0;
    expect(tg.game.state.players[0].activeIndex).not.toBeNull();
    expect(dt).toBeGreaterThanOrEqual(0.5);
    expect(dt).toBeLessThanOrEqual(2.05);
  });

  it('uses the ult 0.5–3 s after it is full', () => {
    const tg = makeGame({ players: [BOT_P0], tunables: { ultFieldChargeTime: 5 } });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(m, 'stun', 100, 0, null);
    advance(tg, 9);
    const p = tg.game.state.players[0];
    expect(p.stats.ultsUsed).toBeGreaterThanOrEqual(1);
    const avg = p.stats.ultDelayTotal / p.stats.ultDelayCount;
    expect(avg).toBeGreaterThanOrEqual(0.5);
    expect(avg).toBeLessThanOrEqual(3.5);
  });

  it('drops the card where the drag skill covers the most enemies', () => {
    const tg = makeGame({ players: [BOT_P0] });
    quietFloor(tg);
    spawnAt(tg, 'slime', { x: 5, y: 6 });
    const cluster = [[25, 6], [25.8, 6.4], [24.4, 5.5], [25.3, 7]].map(([x, y]) => spawnAt(tg, 'slime', { x, y }));
    // blade: dash right 6 over a rect (R29: scored with the real footprint) → dropped LEFT of the cluster, path covers all
    const pos = bestDropPoint(tg.w, tg.w.state.players[0], 1);
    const part = tg.game.previewParts(0, 'swap', 1)[0];
    for (const s of cluster) expect(hitsArea(part.area, pos, pos, s.pos, s.radius)).toBe(true);
    expect(pos.x).toBeGreaterThan(17);
    expect(pos.x).toBeLessThan(25);
  });

  it('bots use the same command validation (no swaps while appearing / spectating)', () => {
    const tg = makeGame({ players: [BOT_P0, BOT1] });
    advance(tg, 60);
    for (const p of tg.game.state.players) {
      // every appear event belongs to a validated swap
      expect(eventsOf(tg, 'appear').filter(e => e.player === p.id).length).toBe(p.stats.swaps);
    }
  });
});

describe('기획 13차: bots aim the renewed multi-beat drags', () => {
  const cluster = (tg: ReturnType<typeof makeGame>, cx: number, cy: number) =>
    [[0, 0], [0.8, 0.4], [-0.6, -0.5], [0.3, 0.9]].map(([dx, dy]) => {
      const m = spawnAt(tg, 'slime', { x: cx + dx, y: cy + dy });
      m.rt.stationary = true;
      return m;
    });

  it('블레이드: dropped left of the pack so the dash, the rush back and the burst all sweep it', () => {
    const tg = makeGame({ players: [{ ...HUMAN, isBot: true, characters: ['guardian', 'blade', 'cleric'] }] });
    quietFloor(tg);
    active(tg).pos = { x: 12, y: 6 };
    const ms = cluster(tg, 15, 6);
    const pos = bestDropPoint(tg.w, tg.w.state.players[0], 1);
    const parts = tg.game.previewParts(0, 'swap', 1).filter(p => p.affects === 'enemies');
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      const c = { x: pos.x + p.offset.x, y: pos.y + p.offset.y };
      expect(ms.filter(m => hitsArea(p.area, c, c, m.pos, m.radius)).length).toBeGreaterThanOrEqual(3);
    }
    expect(pos.x).toBeLessThan(15);
  });

  it('a healer drag that also hits enemies (클레릭 종, 메딕 제세동) still aims at the hurt allies first', () => {
    for (const id of ['cleric', 'medic']) {
      const tg = makeGame({ players: [{ ...HUMAN, isBot: true, characters: ['guardian', id, 'blade'] }, { ...HUMAN, name: '둘' }] });
      quietFloor(tg);
      const hurt = active(tg, 1);
      hurt.pos = { x: 8, y: 6 };
      hurt.hp = hurt.maxHp * 0.3;
      active(tg, 0).pos = { x: 10, y: 3 };
      cluster(tg, 22, 6); // a pack far from the hurt ally
      const pos = bestDropPoint(tg.w, tg.w.state.players[0], 1);
      expect(Math.abs(pos.x - hurt.pos.x), id).toBeLessThan(3.6);
    }
  });
});

// ─────────────────────────── 기획 20차: 보스 레이드 봇 (docs/bosses.md 3장 「봇」) ───────────────────────────

describe('기획 20차: raid bots read zones, warnings, safe holes and marks (no rng; the classic tower is untouched)', () => {
  const HIT: SkillAction['effects'] = [{ kind: 'damage', amount: 1 }];
  const BOT_MAGE = { ...HUMAN, isBot: true, characters: ['guardian', 'mage', 'blade'] };

  /** A raid fight whose boss does nothing by itself and never dies; my seat is a bot that is not due to swap. */
  function quietRaid(bossId: string, players = [BOT_MAGE]): TestGame {
    const tg = raidGame(bossId, { hpMult: 80, players, tunables: { monsterDmgMult: 0.01, bossGroggyThreshold: 0 } });
    const b = bossOf(tg);
    b.rt.skillCds = b.rt.skillCds.map(() => 9999);
    b.rt.phase = 99;
    advance(tg, 1.1); // past the entrance pose
    b.rt.lockTime = 9999;
    b.rt.attackCd = 9999;
    for (const p of tg.w.state.players) p.rt.bot.nextSwapAt = tg.w.state.time + 999;
    clearEvents(tg);
    return tg;
  }

  /** The boss casts these parts as one cast at `target`. */
  function cast(tg: TestGame, parts: SkillAction[], target?: SimEntity): void {
    const b = bossOf(tg);
    if (target) b.targetId = target.id;
    const ctx = unitCtx(tg.w, b, 'syn_bot', '시험');
    for (const a of parts) startAction(tg.w, ctx, a);
  }

  const drop = (tg: TestGame, idx = 1) => bestDropPoint(tg.w, tg.w.state.players[0], idx);
  const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

  it('a safe ring is up (find the safe spot): the card is dropped inside the hole', () => {
    const tg = quietRaid('thunder_antenna');
    const hole = { x: 6, y: 8 };
    const before = drop(tg);
    expect(d(before, hole)).toBeGreaterThan(3); // without the ring it aims at the boss, far from that spot
    cast(tg, [{ ...arenaAt(hole.x, hole.y), area: safeRing(3), affects: 'enemies', delay: 2.5, effects: HIT }]);
    const pos = drop(tg);
    expect(d(pos, hole)).toBeLessThanOrEqual(3 - 0.45 + 1e-6);
    // every card: the hole wins over any enemy-covering spot outside it (BOT_RAID.safeIn / safeOut)
    expect(BOT_RAID.safeIn - BOT_RAID.safeOut).toBeGreaterThanOrEqual(4);
    for (const idx of [1, 2]) expect(d(drop(tg, idx), hole)).toBeLessThanOrEqual(3 - 0.45 + 1e-6);
  });

  it('the same ring in the classic tower changes nothing (the raid terms are not read there)', () => {
    const tg = makeGame({ players: [BOT_MAGE], startFloor: 5 });
    advance(tg, 0.5);
    const p = tg.w.state.players[0];
    const before = bestDropPoint(tg.w, p, 1);
    const boss = tg.w.state.entities.find(e => e.tier === 'boss')!;
    const ctx = unitCtx(tg.w, boss, 'syn_bot', '시험');
    startAction(tg.w, ctx, { center: 'point', area: safeRing(3), affects: 'enemies', delay: 2.5, effects: HIT });
    expect(tg.w.state.telegraphs.some(t => t.team === 'enemy' && t.area.shape === 'ring')).toBe(true);
    expect(bestDropPoint(tg.w, p, 1)).toEqual(before);
  });

  it('the hole wins even when the boss could be hit from outside it; a spot already in the hole keeps its aim', () => {
    const tg = quietRaid('thunder_antenna');
    const b = bossOf(tg);
    const usual = drop(tg);
    // a hole far from the boss: the drop goes to its rim on the boss's side (as near as a safe spot gets)
    const far = { x: b.pos.x > 12 ? 5 : 19, y: 9 };
    cast(tg, [{ ...arenaAt(far.x, far.y), area: safeRing(2.5), affects: 'enemies', delay: 2.5, effects: HIT }]);
    const pos = drop(tg);
    expect(d(pos, far)).toBeLessThanOrEqual(2.5 - 0.45 + 1e-6);
    expect(d(pos, far)).toBeGreaterThan(1); // not the middle: toward the boss
    expect(d(pos, b.pos)).toBeLessThan(d(far, b.pos));
    // a hole around the usual best spot: nothing to change
    const tg2 = quietRaid('thunder_antenna');
    const usual2 = drop(tg2);
    expect(usual2).toEqual(usual);
    cast(tg2, [{ ...arenaAt(usual2.x, usual2.y), area: safeRing(3), affects: 'enemies', delay: 2.5, effects: HIT }]);
    expect(drop(tg2)).toEqual(usual2);
  });

  it('score terms: a lingering enemy zone, a warning that lands soon (once), far-off warnings and the classic tower not at all', () => {
    const tg = quietRaid('thunder_antenna');
    const at = { x: 6, y: 8 };
    const away = { x: 18, y: 8 };
    expect(raidDropScore(tg.w, at)).toBe(0);
    // a warning still far off: nothing; two that land soon on the same spot: counted once
    cast(tg, [{ ...arenaAt(at.x, at.y), area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: BOT_RAID.soon + 1.5, effects: HIT }]);
    expect(raidDropScore(tg.w, at)).toBe(0);
    cast(tg, [
      { ...arenaAt(at.x, at.y), area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: BOT_RAID.soon - 0.2, effects: HIT },
      { ...arenaAt(at.x, at.y), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: BOT_RAID.soon - 0.4, effects: HIT },
    ]);
    expect(raidDropScore(tg.w, at)).toBe(BOT_RAID.telegraph);
    expect(raidDropScore(tg.w, away)).toBe(0);
    // a zone that lingers there
    const tz = quietRaid('thunder_antenna');
    cast(tz, [{ ...arenaAt(at.x, at.y), area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: 0, telegraphLead: 0, effects: HIT, zone: { duration: 8, tickInterval: 0.5 } }]);
    advance(tz, 0.1);
    expect(tz.w.state.zones.some(z => z.team === 'enemy')).toBe(true);
    expect(raidDropScore(tz.w, at)).toBe(BOT_RAID.zone);
    expect(raidDropScore(tz.w, away)).toBe(0);
    // safe ring: inside the hole / outside it
    const tr = quietRaid('thunder_antenna');
    cast(tr, [{ ...arenaAt(at.x, at.y), area: safeRing(3), affects: 'enemies', delay: 2.5, effects: HIT }]);
    expect(raidDropScore(tr.w, at)).toBe(BOT_RAID.safeIn);
    expect(raidDropScore(tr.w, away)).toBe(BOT_RAID.safeOut);
  });

  it('a boss with a front shield: right behind it is worth a little more than in front of it', () => {
    const tg = quietRaid('shredder_maw');
    const b = bossOf(tg);
    expect(b.rt.monDef && 'guard' in b.rt.monDef && b.rt.monDef.guard).toBeTruthy();
    b.facing = 0; // looks right
    const back = { x: b.pos.x - 3, y: b.pos.y };
    const front = { x: b.pos.x + 3, y: b.pos.y };
    const side = { x: b.pos.x, y: b.pos.y + 3 };
    expect(raidDropScore(tg.w, back)).toBe(BOT_RAID.back);
    expect(raidDropScore(tg.w, front)).toBe(0);
    expect(raidDropScore(tg.w, side)).toBe(0);
  });

  it('a warning that is still far off does not move the drop', () => {
    const tg = quietRaid('thunder_antenna');
    const best = drop(tg);
    cast(tg, [{ ...arenaAt(best.x, best.y), area: { shape: 'circle', radius: 1.6 }, affects: 'enemies', delay: BOT_RAID.soon + 1.5, effects: HIT }]);
    expect(drop(tg)).toEqual(best);
  });

  it('a mark (rule N6) on its field character: it waits, then swaps it out when the mark has ' + BOT_RAID.markSwapAt + ' s left — the mark is cleared', () => {
    const tg = quietRaid('endless_meeting');
    const me = active(tg, 0);
    const delay = 3;
    cast(tg, [{ center: 'target', area: { shape: 'single' }, affects: 'enemies', bound: true, delay, effects: HIT }], me);
    expect(tg.w.state.telegraphs.some(t => t.mark === me.id)).toBe(true);
    advance(tg, delay - BOT_RAID.markSwapAt - 0.3);
    expect(tg.w.state.players[0].activeIndex, 'not yet').toBe(0);
    expect(eventsOf(tg, 'markClear')).toHaveLength(0);
    // the bot thinks twice a second: the swap comes within its next thought, well before the mark goes off
    advance(tg, 0.75);
    expect(tg.w.state.players[0].activeIndex).not.toBe(0);
    expect(eventsOf(tg, 'markClear')).toHaveLength(1);
    expect(tg.w.state.telegraphs.some(t => t.mark != null)).toBe(false);
    // nobody was hit by it
    advance(tg, 1.5);
    expect(eventsOf(tg, 'damage').filter(e => e.targetTeam === 'ally' && e.skillName === '시험')).toHaveLength(0);
  });

  it('same seed, same raid bot run (the raid terms draw no random numbers)', () => {
    const run = () => {
      const tg = raidGame('endless_meeting', { seed: 77, players: [BOT_MAGE, BOT1] });
      advance(tg, 20);
      return JSON.stringify([tg.w.state.players.map(p => [p.activeIndex, p.stats.swaps]), tg.w.state.entities.map(e => [e.defId, +e.pos.x.toFixed(4), +e.pos.y.toFixed(4), Math.round(e.hp)])]);
    };
    expect(run()).toBe(run());
  });
});
