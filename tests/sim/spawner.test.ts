// 기획 16차 템포 (docs/tempo.md 2): the next wave once the field is almost clear (or after the max gap), spawns on a
// ring near the party inside the screen, the mid boss with wave n − 2 (weight WAVE_NEXT.midWeight), the target rotation, the alive cap,
// determinism.
import { describe, expect, it } from 'vitest';
import { ARENA_NORMAL, VIEW_WIDTH_UNITS } from '../../src/config';
import { FIRST_WAVE_Y_TOP, MID_RING, SPAWN_RING, SPAWN_SCATTER, WAVE_NEXT } from '../../src/sim/constants';
import { midPoint, nextWaveDue, wavePoint, weightedAlive } from '../../src/sim/floor';
import { tick } from '../../src/sim/game';
import { activeEntity, dist, isAlive, type World } from '../../src/sim/world';
import type { Vec2 } from '../../src/types';
import { active, advance, BOT1, BOT2, eventsOf, HUMAN, HUMAN2, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const TICK = 1 / 30;

/** Nobody kills anything on their own: no damage from the party, monsters walk but nobody dies. */
function pacify(tg: TestGame): void {
  for (const p of tg.w.state.players) {
    p.party.forEach(m => (m.normalCooldownRemaining = 1e9));
    const e = activeEntity(tg.w, p);
    if (e) e.rt.base.atk = 0;
  }
}

function killAll(tg: TestGame): void {
  tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
}

/** Floor seconds of every wave warning so far (the spawner's own record, one entry per wave). */
function warnTimes(tg: TestGame, run: (onWarn: (t: number) => void) => void): number[] {
  const out: number[] = [];
  run(t => out.push(t));
  return out;
}

function fieldChars(w: World) {
  return w.state.players.map(p => activeEntity(w, p)).filter(isAlive);
}

function inBox(p: Vec2, W = ARENA_NORMAL.width, H = ARENA_NORMAL.height): boolean {
  const r = SPAWN_RING;
  return p.x >= r.xMargin - 1e-9 && p.x <= W - r.xMargin + 1e-9 && p.y >= r.yTop - 1e-9 && p.y <= H - r.yBottom + 1e-9;
}

describe('기획 16차 템포: the next wave', () => {
  it('comes ≤ minGap after the field empties (never waits for the nominal schedule)', () => {
    const tg = makeGame({ tunables: { invincible: true, midBossTimeTrigger: 999 } });
    const s = tg.w.state;
    const sp = tg.w.spawner;
    const n = s.plan.waves.length;
    let lastWarn = -Infinity;
    let clearedAt: number | null = null;
    const gaps: number[] = [];
    for (let i = 0; i < 30 * 40 && sp.nextWave < n; i++) {
      const before = sp.nextWave;
      advance(tg, TICK);
      if (sp.nextWave > before) {
        if (clearedAt != null) gaps.push(s.floorTime - Math.max(clearedAt, lastWarn + WAVE_NEXT.minGap));
        lastWarn = s.floorTime;
        clearedAt = null;
      }
      // the moment a wave stands, kill it all: the field is empty from here
      if (sp.pending.length === 0 && s.monstersAlive > 0) {
        killAll(tg);
        clearedAt = s.floorTime;
      }
    }
    expect(sp.nextWave).toBe(n);
    expect(gaps.length).toBe(n - 1);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(TICK + 1e-9); // warned on the first tick it may be
    expect(s.floorTime).toBeLessThan(s.plan.waves[n - 1].at); // ahead of the 8 s schedule
  });

  it('comes at the max gap even with enemies alive (classic waveInterval, plan.maxGap when set)', () => {
    for (const maxGap of [undefined, 5]) {
      const tg = makeGame({ tunables: { invincible: true, midBossTimeTrigger: 999 } });
      if (maxGap) tg.w.state.plan.maxGap = maxGap;
      pacify(tg);
      const sp = tg.w.spawner;
      const times = warnTimes(tg, on => {
        for (let i = 0; i < 30 * 30 && sp.nextWave < 3; i++) {
          const before = sp.nextWave;
          advance(tg, TICK);
          if (sp.nextWave > before) on(tg.w.state.floorTime);
        }
      });
      const gap = maxGap ?? tg.w.tunables.waveInterval;
      expect(times.length).toBe(3);
      expect(weightedAlive(tg.w)).toBeGreaterThan(WAVE_NEXT.alive);
      expect(times[1] - times[0]).toBeCloseTo(gap, 1);
      expect(times[2] - times[1]).toBeCloseTo(gap, 1);
    }
  });

  it('a mid boss counts WAVE_NEXT.midWeight (2): alone it lets the next wave come; with one more enemy it holds to the max gap', () => {
    const setup = () => {
      const tg = makeGame({ tunables: { invincible: true, midBossTimeTrigger: 999 } });
      const s = tg.w.state;
      advance(tg, 1.2); // wave 0 stands
      killAll(tg);
      tg.w.spawner.lastWarnAt = s.floorTime; // as if a wave was just warned
      const mid = spawnAt(tg, s.plan.midBossId!, { x: 20, y: 6 });
      mid.rt.base.moveSpeed = 0;
      mid.hp = mid.maxHp = mid.rt.base.maxHp = 1e9;
      pacify(tg);
      return tg;
    };
    const waitNext = (tg: TestGame) => {
      const s = tg.w.state;
      const at = s.floorTime;
      const before = tg.w.spawner.nextWave;
      while (tg.w.spawner.nextWave === before && s.floorTime < at + 20) advance(tg, TICK);
      return s.floorTime - at;
    };
    const alone = setup();
    expect(weightedAlive(alone.w)).toBe(WAVE_NEXT.midWeight);
    expect(WAVE_NEXT.midWeight).toBeLessThanOrEqual(WAVE_NEXT.alive);
    expect(waitNext(alone)).toBeCloseTo(WAVE_NEXT.minGap, 1); // no 수문장-only lull
    const withOne = setup();
    const slime = spawnAt(withOne, 'slime', { x: 3, y: 3 });
    slime.rt.base.moveSpeed = 0;
    slime.hp = slime.maxHp = slime.rt.base.maxHp = 1e9;
    expect(weightedAlive(withOne.w)).toBe(WAVE_NEXT.midWeight + 1);
    expect(waitNext(withOne)).toBeCloseTo(withOne.w.tunables.waveInterval, 1);
  });

  it('nothing is due before wave 0 time, and never past the last wave', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    expect(nextWaveDue(tg.w)).toBe(true); // wave 0 at 1 s, warned 1 s earlier = now
    tg.w.spawner.nextWave = tg.w.state.plan.waves.length;
    expect(nextWaveDue(tg.w)).toBe(false);
  });

  it('postpones by the alive cap (never drops), at most one wave per tick', () => {
    const tg = makeGame({ tunables: { invincible: true, maxAliveMonsters: 8, waveInterval: 2, midBossTimeTrigger: 999 } });
    const s = tg.w.state;
    const sp = tg.w.spawner;
    pacify(tg);
    let maxAlive = 0;
    for (let i = 0; i < 30 * 12; i++) {
      const before = sp.nextWave;
      advance(tg, TICK);
      expect(sp.nextWave - before).toBeLessThanOrEqual(1);
      maxAlive = Math.max(maxAlive, s.monstersAlive + sp.pending.length);
    }
    expect(maxAlive).toBeLessThanOrEqual(8 + Math.max(...s.plan.waves.map(w => w.spawns.reduce((a, g) => a + g.count, 0))));
    expect(sp.nextWave).toBeLessThan(s.plan.waves.length); // held back by the cap
    const total = s.plan.waves.reduce((a, wv) => a + wv.spawns.reduce((b, g) => b + g.count, 0), 0);
    for (let i = 0; i < 40 && s.wavesRemaining > 0; i++) {
      killAll(tg);
      advance(tg, 2);
    }
    expect(s.wavesRemaining).toBe(0);
    expect(eventsOf(tg, 'spawn').filter(e => e.tier === 'normal').length).toBe(total);
  });
});

describe('기획 16차 템포: where waves spawn', () => {
  it('every warning is inside the spawn box (the whole screen, below the HUD) and near the party', () => {
    for (const seed of [1, 2, 3]) {
      const tg = makeGame({ seed, players: [HUMAN, BOT1, BOT2], tunables: { invincible: true } });
      const s = tg.w.state;
      expect(s.plan.arena.width).toBe(VIEW_WIDTH_UNITS); // the camera never scrolls: inside the arena = on screen
      for (let i = 0; i < 30 * 40 && s.phase === 'combat'; i++) {
        const nBefore = tg.events.length;
        advance(tg, TICK);
        const chars = fieldChars(tg.w);
        for (const ev of tg.events.slice(nBefore)) {
          if (ev.type !== 'spawnWarning') continue;
          expect(inBox(ev.pos), `seed ${seed} ${JSON.stringify(ev.pos)}`).toBe(true);
          // a group point is ≥ clear from every character; scattered members ≥ memberClear (pushed out when closer)
          const d = Math.min(...chars.map(c => dist(c.pos, ev.pos)));
          expect(d, `seed ${seed} ${JSON.stringify(ev.pos)}`).toBeGreaterThanOrEqual(SPAWN_RING.memberClear - 0.1);
          expect(d).toBeLessThanOrEqual(MID_RING.max + SPAWN_SCATTER * Math.SQRT2 + 0.5);
        }
        if (s.monstersAlive > 0 && i % 45 === 0) killAll(tg);
      }
    }
  });

  it('a group point is on the ring around the target, ≥ clear from every ally field character (many seeds and layouts)', () => {
    const layouts: Vec2[][] = [
      [{ x: 10.4, y: 6.9 }, { x: 12, y: 5.1 }, { x: 13.6, y: 6.9 }], // the start positions
      [{ x: 2, y: 2 }, { x: 22, y: 10 }, { x: 12, y: 6 }], // spread out, corners
      [{ x: 1, y: 11 }, { x: 2, y: 10 }, { x: 3, y: 11 }], // huddled in a corner
    ];
    for (let seed = 1; seed <= 60; seed++) {
      for (const layout of layouts) {
        const tg = makeGame({ seed, players: [HUMAN, HUMAN2, BOT1], tunables: { invincible: true } });
        quietFloor(tg);
        tg.w.state.players.forEach((p, i) => (activeEntity(tg.w, p)!.pos = { ...layout[i] }));
        const chars = fieldChars(tg.w);
        for (let wave = 0; wave < 3; wave++) {
          const target = chars[((tg.w.spawner.targetOffset ?? 0) + wave) % chars.length];
          const p = wavePoint(tg.w, wave);
          expect(inBox(p)).toBe(true);
          expect(Math.min(...chars.map(c => dist(c.pos, p))), `seed ${seed} ${JSON.stringify(layout)}`).toBeGreaterThanOrEqual(SPAWN_RING.clear);
          expect(dist(target.pos, p)).toBeLessThanOrEqual(SPAWN_RING.max + 1e-9); // clamping into the box only pulls it closer
        }
        const m = midPoint(tg.w);
        expect(inBox(m)).toBe(true);
        const cx = chars.reduce((a, c) => a + c.pos.x, 0) / chars.length;
        const cy = chars.reduce((a, c) => a + c.pos.y, 0) / chars.length;
        expect(dist({ x: cx, y: cy }, m)).toBeLessThanOrEqual(MID_RING.max + 1e-9);
      }
    }
  });

  it('the target rotates over the players with a field character, from the floor offset; nobody on the field → the arena centre', () => {
    const tg = makeGame({ seed: 11, players: [HUMAN, HUMAN2, BOT1], tunables: { invincible: true } });
    quietFloor(tg);
    const w = tg.w;
    const spots = [{ x: 3, y: 3 }, { x: 21, y: 3 }, { x: 12, y: 10 }];
    w.state.players.forEach((p, i) => (activeEntity(w, p)!.pos = { ...spots[i] }));
    for (const offset of [0, 1, 2, 4]) {
      w.spawner.targetOffset = offset;
      for (let wave = 0; wave < 6; wave++) {
        const want = (offset + wave) % 3;
        expect(dist(spots[want], wavePoint(w, wave))).toBeLessThanOrEqual(SPAWN_RING.max + 1e-9);
      }
    }
    // player 1 leaves the field: the rotation runs over players 0 and 2 only
    const p1 = w.state.players[1];
    activeEntity(w, p1)!.rt.gone = true;
    w.byId.delete(p1.party[p1.activeIndex!].entityId!);
    p1.activeIndex = null;
    w.spawner.targetOffset = 0;
    const live = [0, 2];
    for (let wave = 0; wave < 4; wave++) expect(dist(spots[live[wave % 2]], wavePoint(w, wave))).toBeLessThanOrEqual(SPAWN_RING.max + 1e-9);
    // nobody on the field: around the arena centre
    for (const p of w.state.players) {
      const e = activeEntity(w, p);
      if (e) e.rt.gone = true;
      p.activeIndex = null;
    }
    const c = { x: ARENA_NORMAL.width / 2, y: ARENA_NORMAL.height / 2 };
    for (let wave = 0; wave < 5; wave++) expect(dist(c, wavePoint(w, wave))).toBeLessThanOrEqual(SPAWN_RING.max + 1e-9);
  });

  it('the mid boss is warned in the same tick as wave n − midBossFromEnd (default 2), at the latest at midBossTimeTrigger', () => {
    for (const fromEnd of [2, 1, 3]) {
      const tg = makeGame({ seed: 3, tunables: { invincible: true, midBossFromEnd: fromEnd } });
      const sp = tg.w.spawner;
      const n = tg.w.state.plan.waves.length;
      let midAtWave: number | null = null;
      for (let i = 0; i < 30 * 60 && midAtWave == null; i++) {
        const before = sp.midTriggered;
        tick(tg.w);
        if (!before && sp.midTriggered) midAtWave = sp.nextWave - 1;
        if (tg.w.state.monstersAlive > 0 && sp.pending.length === 0) killAll(tg);
      }
      expect(midAtWave, `fromEnd ${fromEnd}`).toBe(n - fromEnd);
    }
  });

  it('determinism: the same seed gives the same warnings (time and place)', () => {
    const trace = () => {
      const tg = makeGame({ seed: 77, players: [HUMAN, BOT1, BOT2] });
      advance(tg, 40);
      return eventsOf(tg, 'spawnWarning').map(e => `${e.pos.x.toFixed(6)},${e.pos.y.toFixed(6)}`);
    };
    const a = trace();
    expect(a.length).toBeGreaterThan(15);
    expect(trace()).toEqual(a);
  });

  it('wave 0 (warned under the floor-start banner) stays at y ≥ FIRST_WAVE_Y_TOP; later waves may use the whole box', () => {
    let later = Infinity;
    for (let seed = 1; seed <= 40; seed++) {
      const tg = makeGame({ seed, players: [HUMAN, BOT1, BOT2], tunables: { invincible: true } });
      advance(tg, 0.05);
      const first = eventsOf(tg, 'spawnWarning');
      expect(first.length).toBeGreaterThan(0);
      for (const e of first) expect(e.pos.y, `seed ${seed}`).toBeGreaterThanOrEqual(FIRST_WAVE_Y_TOP - 1e-9);
      for (let i = 0; i < 30 * 20; i++) {
        const n = tg.events.length;
        advance(tg, TICK);
        for (const e of tg.events.slice(n)) if (e.type === 'spawnWarning') later = Math.min(later, e.pos.y);
        if (tg.w.state.monstersAlive > 0 && i % 30 === 0) killAll(tg);
      }
    }
    expect(later).toBeLessThan(FIRST_WAVE_Y_TOP); // the rule is wave 0 only
  });

  it('the human seat is a valid target too: a solo floor spawns around the one character', () => {
    const tg = makeGame({ seed: 5, tunables: { invincible: true } });
    advance(tg, 0.05);
    const me = active(tg);
    const warns = eventsOf(tg, 'spawnWarning');
    expect(warns.length).toBeGreaterThan(0);
    for (const w of warns) expect(dist(w.pos, me.pos)).toBeLessThanOrEqual(SPAWN_RING.max + SPAWN_SCATTER * Math.SQRT2 + 0.2);
  });
});
