import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import {
  aimSamples,
  areaCentroid,
  containsPoint,
  dashEnd,
  dirVec,
  hitsArea,
  rectFrame,
  scaleArea,
} from '../../src/sim/geometry';
import { previewPartsFor } from '../../src/sim/preview';
import { charCtx } from '../../src/sim/ctx';
import { castSkill } from '../../src/sim/skills';
import { applyStatus } from '../../src/sim/status';
import type { AreaShape, GameEvent, SkillAction, Vec2 } from '../../src/types';
import { active, advance, clearEvents, eventsOf, HUMAN, makeGame, quietFloor, spawnAt } from './helpers';

const C: Vec2 = { x: 10, y: 6 };
const at = (dx: number, dy: number): Vec2 => ({ x: C.x + dx, y: C.y + dy });
const hit = (a: AreaShape, dx: number, dy: number, r = 0) => hitsArea(a, C, C, at(dx, dy), r);

describe('geometry: directions', () => {
  it('right(1,0) left(-1,0) up(0,-1) down(0,1)', () => {
    expect(dirVec('right')).toEqual({ x: 1, y: 0 });
    expect(dirVec('left')).toEqual({ x: -1, y: 0 });
    expect(dirVec('up')).toEqual({ x: 0, y: -1 });
    expect(dirVec('down')).toEqual({ x: 0, y: 1 });
  });
});

describe('geometry: circle / single / line (existing behaviour)', () => {
  const circle: AreaShape = { shape: 'circle', radius: 3 };
  it('circle counts a unit whose body touches the edge', () => {
    expect(hit(circle, 0, 0)).toBe(true);
    expect(hit(circle, 3, 0)).toBe(true);
    expect(hit(circle, 3.4, 0)).toBe(false);
    expect(hit(circle, 3.4, 0, 0.45)).toBe(true);
    expect(hit(circle, 2.2, 2.2, 0)).toBe(false); // 3.11 > 3
    expect(hit(circle, 2.2, 2.2, 0.2)).toBe(true);
  });
  it('line runs from origin toward center, grown by the unit radius', () => {
    const line: AreaShape = { shape: 'line', length: 9, width: 1.2 };
    const o = { x: 2, y: 6 };
    const c = { x: 5, y: 6 }; // direction +x from origin
    expect(hitsArea(line, c, o, { x: 10.9, y: 6 }, 0)).toBe(true);
    expect(hitsArea(line, c, o, { x: 11.2, y: 6 }, 0)).toBe(false);
    expect(hitsArea(line, c, o, { x: 11.2, y: 6 }, 0.3)).toBe(true);
    expect(hitsArea(line, c, o, { x: 6, y: 6.7 }, 0)).toBe(false);
    expect(hitsArea(line, c, o, { x: 6, y: 6.7 }, 0.2)).toBe(true);
    expect(hitsArea(line, c, o, { x: 1.5, y: 6 }, 0)).toBe(false); // behind the origin
    // origin == center → fallback direction (caster facing)
    expect(hitsArea(line, o, o, { x: 2, y: 9 }, 0, { x: 0, y: 1 })).toBe(true);
    expect(hitsArea(line, o, o, { x: 5, y: 6 }, 0, { x: 0, y: 1 })).toBe(false);
  });
  it('single reaches 1 unit past the body edge', () => {
    expect(hit({ shape: 'single' }, 1.4, 0, 0.45)).toBe(true);
    expect(hit({ shape: 'single' }, 1.6, 0, 0.45)).toBe(false);
  });
});

describe('geometry: rect (fixed direction)', () => {
  it("anchor 'start' (default) begins at center and extends toward dir", () => {
    const r: AreaShape = { shape: 'rect', dir: 'right', length: 12, width: 1.2 };
    expect(hit(r, 0, 0)).toBe(true);
    expect(hit(r, 6, 0)).toBe(true);
    expect(hit(r, 12, 0)).toBe(true);
    expect(hit(r, 12.3, 0)).toBe(false);
    expect(hit(r, 12.3, 0, 0.4)).toBe(true);
    expect(hit(r, -0.5, 0)).toBe(false); // nothing behind the start
    expect(hit(r, -0.3, 0, 0.4)).toBe(true);
    expect(hit(r, 5, 0.6)).toBe(true);
    expect(hit(r, 5, 0.8)).toBe(false);
    expect(hit(r, 5, -0.9, 0.35)).toBe(true);
    // corners are rounded by the unit radius (exact circle–rectangle distance)
    expect(hit(r, 12.3, 0.9, 0.4)).toBe(false);
    expect(hit(r, 12.2, 0.75, 0.4)).toBe(true);
  });
  it('left / up / down point the other ways', () => {
    const left: AreaShape = { shape: 'rect', dir: 'left', length: 5, width: 1 };
    expect(hit(left, -4, 0)).toBe(true);
    expect(hit(left, 1, 0)).toBe(false);
    const up: AreaShape = { shape: 'rect', dir: 'up', length: 5, width: 1 };
    expect(hit(up, 0, -4)).toBe(true);
    expect(hit(up, 0, 4)).toBe(false);
    expect(hit(up, 2, -2)).toBe(false);
    const down: AreaShape = { shape: 'rect', dir: 'down', length: 5, width: 1 };
    expect(hit(down, 0, 4)).toBe(true);
    expect(hit(down, 0, -1)).toBe(false);
  });
  it("anchor 'center' is centered on the drop point (가디언 가로 띠 / 바드 세로 띠)", () => {
    const band: AreaShape = { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 };
    expect(hit(band, -3.5, 0)).toBe(true);
    expect(hit(band, 3.5, 0)).toBe(true);
    expect(hit(band, -3.7, 0)).toBe(false);
    expect(hit(band, 0, 1)).toBe(true);
    expect(hit(band, 0, 1.2)).toBe(false);
    const vbar: AreaShape = { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.6 };
    expect(hit(vbar, 0, -6)).toBe(true);
    expect(hit(vbar, 0, 6)).toBe(true);
    expect(hit(vbar, 1.3, 0)).toBe(true);
    expect(hit(vbar, 1.6, 0)).toBe(false);
    expect(hit(vbar, 3, 0)).toBe(false);
    expect(rectFrame(vbar as Extract<AreaShape, { shape: 'rect' }>, C)).toEqual({ sx: 10, sy: 0, ux: 0, uy: 1, len: 12, hw: 1.3 });
  });
});

describe('geometry: cone', () => {
  const cone: AreaShape = { shape: 'cone', dir: 'right', radius: 4.5, angle: 100 };
  it('fans toward dir with the given total opening', () => {
    expect(hit(cone, 2, 0)).toBe(true);
    expect(hit(cone, 4.5, 0)).toBe(true);
    expect(hit(cone, 4.7, 0)).toBe(false);
    expect(hit(cone, 4.7, 0, 0.3)).toBe(true);
    // 45° is inside a 100° fan (±50°), 60° is not
    const p45 = { x: Math.cos(Math.PI / 4) * 3, y: Math.sin(Math.PI / 4) * 3 };
    const p60 = { x: Math.cos(Math.PI / 3) * 3, y: Math.sin(Math.PI / 3) * 3 };
    expect(hit(cone, p45.x, p45.y)).toBe(true);
    expect(hit(cone, p60.x, -p60.y)).toBe(false);
    // ...but a body overlapping the edge counts (distance from 60° @3 to the 50° edge ≈ 0.52)
    expect(hit(cone, p60.x, p60.y, 0.6)).toBe(true);
    expect(hit(cone, p60.x, p60.y, 0.45)).toBe(false);
    // nothing behind the apex, except a body that covers the apex itself
    expect(hit(cone, -1, 0)).toBe(false);
    expect(hit(cone, -1, 0, 0.45)).toBe(false);
    expect(hit(cone, -0.3, 0, 0.45)).toBe(true);
  });
  it('left cone (거너) mirrors the right one', () => {
    const left: AreaShape = { shape: 'cone', dir: 'left', radius: 5, angle: 70 };
    expect(hit(left, -4, 0)).toBe(true);
    expect(hit(left, -4, 2)).toBe(true); // ~26.6°
    expect(hit(left, -2, 2)).toBe(false); // 45° > 35°
    expect(hit(left, 3, 0)).toBe(false);
  });
});

describe('geometry: ring', () => {
  const ring: AreaShape = { shape: 'ring', inner: 1.2, outer: 4 };
  it('inner < d ≤ outer, with unit radius tolerance on both edges', () => {
    expect(hit(ring, 0, 0)).toBe(false);
    expect(hit(ring, 0, 0, 0.45)).toBe(false);
    expect(hit(ring, 1.0, 0)).toBe(false);
    expect(hit(ring, 1.0, 0, 0.3)).toBe(true);
    expect(hit(ring, 2.5, 0)).toBe(true);
    expect(hit(ring, 0, -4)).toBe(true);
    expect(hit(ring, 4.2, 0)).toBe(false);
    expect(hit(ring, 4.2, 0, 0.3)).toBe(true);
    expect(containsPoint(ring, C, at(1.0, 0))).toBe(false);
    expect(containsPoint(ring, C, at(3, 0))).toBe(true);
  });
});

describe('geometry: cross', () => {
  const plus: AreaShape = { shape: 'cross', length: 3.5, width: 1.3 };
  it("'+' covers both axes up to `length` from the center", () => {
    expect(hit(plus, 0, 0)).toBe(true);
    for (const [x, y] of [[3.4, 0], [-3.4, 0], [0, 3.4], [0, -3.4], [2, 0.6], [0.6, -2]]) expect(hit(plus, x, y)).toBe(true);
    expect(hit(plus, 3.7, 0)).toBe(false);
    expect(hit(plus, 3.7, 0, 0.3)).toBe(true);
    // the corners between the arms stay free
    expect(hit(plus, 2, 2)).toBe(false);
    expect(hit(plus, 2, 2, 0.45)).toBe(false);
    expect(hit(plus, 1.5, 1.5)).toBe(false);
    expect(hit(plus, 1, 1, 0.45)).toBe(true);
  });
  it("diagonal 'X' turns the arms 45°", () => {
    const x: AreaShape = { shape: 'cross', diagonal: true, length: 3.5, width: 1.3 };
    const d = 3.4 * Math.SQRT1_2;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) expect(hit(x, sx * d, sy * d)).toBe(true);
    expect(hit(x, 3, 0)).toBe(false);
    expect(hit(x, 0, -3)).toBe(false);
    expect(hit(x, 2.6, 2.6)).toBe(false); // 3.68 > 3.5
  });
});

describe('geometry: scaling, dash, helpers', () => {
  it('scaleArea scales every shape evenly (circle r, rect/line length+width, cone r, ring outer only, cross length+width)', () => {
    expect(scaleArea({ shape: 'circle', radius: 2 }, 1.5)).toEqual({ shape: 'circle', radius: 3 });
    expect(scaleArea({ shape: 'line', length: 8, width: 1 }, 1.5)).toEqual({ shape: 'line', length: 12, width: 1.5 });
    expect(scaleArea({ shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2 }, 1.5)).toEqual({ shape: 'rect', dir: 'down', anchor: 'center', length: 18, width: 3 });
    expect(scaleArea({ shape: 'cone', dir: 'left', radius: 4, angle: 70 }, 1.5)).toEqual({ shape: 'cone', dir: 'left', radius: 6, angle: 70 });
    // the hole keeps its size: a bigger ring still hits next to the drop point (review 3차 LOW 5)
    expect(scaleArea({ shape: 'ring', inner: 1, outer: 4 }, 1.5)).toEqual({ shape: 'ring', inner: 1, outer: 6 });
    expect(scaleArea({ shape: 'ring', inner: 1, outer: 4 }, 2)).toEqual({ shape: 'ring', inner: 1, outer: 8 });
    // arms get longer and thicker, like the bands and lines
    expect(scaleArea({ shape: 'cross', diagonal: true, length: 3, width: 1 }, 1.5)).toEqual({ shape: 'cross', diagonal: true, length: 4.5, width: 1.5 });
    expect(scaleArea({ shape: 'single' }, 2)).toEqual({ shape: 'single' });
    const same: AreaShape = { shape: 'ring', inner: 1, outer: 2 };
    expect(scaleArea(same, 1)).toBe(same);
  });
  it('dashEnd moves along dir and stays inside the arena', () => {
    const arena = { width: 36, height: 12 };
    expect(dashEnd({ x: 10, y: 6 }, 'right', 6, arena)).toEqual({ x: 16, y: 6 });
    expect(dashEnd({ x: 33, y: 6 }, 'right', 6, arena)).toEqual({ x: 35.5, y: 6 });
    expect(dashEnd({ x: 2, y: 6 }, 'left', 6, arena)).toEqual({ x: 0.5, y: 6 });
    expect(dashEnd({ x: 5, y: 3 }, 'up', 6, arena)).toEqual({ x: 5, y: 0.5 });
  });
  it('centroid and aim samples sit inside the shape', () => {
    const shapes: AreaShape[] = [
      { shape: 'rect', dir: 'right', length: 12, width: 1.2 },
      { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.6 },
      { shape: 'cone', dir: 'left', radius: 5, angle: 70 },
      { shape: 'ring', inner: 1.2, outer: 4 },
      { shape: 'cross', length: 3.5, width: 1.3 },
      { shape: 'cross', diagonal: true, length: 3.5, width: 1.3 },
      { shape: 'circle', radius: 1.5 },
    ];
    for (const a of shapes) {
      for (const s of aimSamples(a)) expect(hitsArea(a, C, C, at(s.x, s.y), 0)).toBe(true);
      if (a.shape !== 'ring') expect(hitsArea(a, C, C, areaCentroid(a, C), 0)).toBe(true);
    }
    expect(areaCentroid({ shape: 'rect', dir: 'right', length: 12, width: 1 }, C)).toEqual(at(6, 0));
    expect(areaCentroid({ shape: 'cone', dir: 'left', radius: 4, angle: 90 }, C)).toEqual(at(-2, 0));
  });
});

// ─────────────────────────── executor ───────────────────────────

/** Fresh quiet game with `id` in party slot 1 (slot 0 is some other character). */
function gameWith(id: string) {
  const first = id === 'guardian' ? 'paladin' : 'guardian';
  const tg = makeGame({ players: [{ ...HUMAN, characters: [first, id, 'cleric'] }] });
  quietFloor(tg);
  tg.game.state.players[0].party[1].normalCooldownRemaining = 99;
  return tg;
}

describe('executor: every drag skill hits exactly what its preview shows (R27)', () => {
  for (const def of CHARACTERS) {
    const enemyParts = def.drag.actions.filter(a => a.affects === 'enemies').length;
    if (enemyParts === 0) continue;
    it(`${def.id} (${def.drag.name})`, () => {
      const tg = gameWith(def.id);
      const drop = { x: 15.2, y: 6.1 };
      // grid of stationary, very tough slimes around the drop point (stationary: no separation / pull / knockback)
      const enemies = [];
      for (let x = 2.5; x <= 30; x += 0.9) {
        for (let y = 0.6; y <= 11.5; y += 0.9) {
          const m = spawnAt(tg, 'slime', { x, y });
          m.rt.stationary = true;
          m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
          enemies.push(m);
        }
      }
      // 기획 13차: parts ↔ actions (a woundedAlly pick has no part); only damaging parts that land within the window
      const parts = tg.game.previewParts(0, 'swap', 1);
      const actions = def.drag.actions.filter(a => a.center !== 'woundedAlly');
      const window = watchWindow(def.drag.actions);
      expect(parts).toHaveLength(actions.length);
      const want = new Set<number>();
      for (const e of enemies) {
        parts.forEach((p, i) => {
          const a = actions[i];
          if (p.affects !== 'enemies' || !a.effects.some(x => x.kind === 'damage') || p.delay > window - 0.2) return;
          const c = { x: drop.x + p.offset.x, y: drop.y + p.offset.y };
          if (hitsArea(p.area, c, c, e.pos, e.radius)) want.add(e.id);
        });
      }
      expect(want.size).toBeGreaterThan(2);
      clearEvents(tg);
      expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: drop }).ok).toBe(true);
      active(tg).rt.base.atk = 0; // no basic attacks muddying the count
      const got = new Set<number>();
      const count = (evs: GameEvent[]) => {
        for (const ev of evs) if (ev.type === 'damage' && ev.targetTeam === 'enemy' && ev.amount > 0) got.add(ev.targetId);
      };
      count(tg.game.drainEvents());
      // tick by tick; DoT statuses are wiped so only direct hits produce damage events
      for (let i = 0; i < Math.round(window * 30); i++) {
        for (const e of enemies) e.statuses.length = 0;
        advance(tg, 1 / 30);
        count(tg.events.splice(0));
      }
      expect([...got].sort((a, b) => a - b)).toEqual([...want].sort((a, b) => a - b));
    });
  }
});

/**
 * Seconds the R27 check watches: past the last damaging beat (at least 1.5 s; cleric's bell lands at 4 s), never as long
 * as the 종이 인형 live (their burst is not part of the preview).
 */
function watchWindow(actions: readonly SkillAction[]): number {
  const last = Math.max(0, ...actions.filter(a => !a.zone && a.effects.some(e => e.kind === 'damage')).map(a => a.delay ?? 0));
  return Math.max(1.5, last + 0.3);
}

describe('executor: shapes in play', () => {
  it('blade dashes right 6 (clamped at the wall), hits along the path, then rushes back to the drop point (기획 13차)', () => {
    const tg = gameWith('blade');
    const a = tg.game.state.plan.arena;
    const X = a.width - 6; // 기획 16차: 24-wide arena — the drop 6 from the right wall
    const near = spawnAt(tg, 'golem', { x: X + 1, y: 6 });
    near.hp = near.maxHp = near.rt.base.maxHp = 1e9;
    applyStatus(near, 'stun', 100, 0, null);
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: X, y: 6 } });
    const e = active(tg);
    expect(e.pos.x).toBeCloseTo(a.width - 0.5);
    const d = eventsOf(tg, 'dash');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ entityId: e.id, from: { x: X, y: 6 }, duration: 0.16 });
    expect(near.hp).toBeLessThan(1e9);
    const afterDash = near.hp;
    advance(tg, 0.4);
    // stopAtCenter: back on the drop point, not past it; the way back hits again
    expect(e.pos.x).toBeCloseTo(X, 1); // (it may already step toward its target)
    expect(eventsOf(tg, 'dash')).toHaveLength(2);
    expect(near.hp).toBeLessThan(afterDash);
  });

  it('gunner knockback always pushes left (two blasts and the slug), the recoil shoves the gunner right; warden pulls ring targets toward the drop point', () => {
    const tg = gameWith('gunner');
    const m = spawnAt(tg, 'golem', { x: 12, y: 6.5 });
    m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
    applyStatus(m, 'stun', 100, 0, null); // stands still, knockback still moves it
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 6 } });
    const g = active(tg);
    clearEvents(tg);
    advance(tg, 1);
    expect(m.pos.x).toBeCloseTo(8); // 1 + 1 + 2 left
    expect(m.pos.y).toBeCloseTo(6.5);
    // atFire recoil at 0.85 s: 1.2 right from where the gunner stood, facing kept
    const recoil = eventsOf(tg, 'dash').filter(d => d.entityId === g.id);
    expect(recoil).toHaveLength(1);
    expect(recoil[0].to.x - recoil[0].from.x).toBeCloseTo(1.2);

    const tw = gameWith('warden');
    const r = spawnAt(tw, 'golem', { x: 18, y: 6 });
    // the hole is small (inner 0.6, playtest 3차): only a unit right on the drop point is spared
    const inHole = spawnAt(tw, 'slime', { x: 15.1, y: 6 });
    r.hp = r.maxHp = r.rt.base.maxHp = 1e9;
    inHole.hp = inHole.maxHp = inHole.rt.base.maxHp = 1e9;
    tw.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 6 } });
    expect(r.pos.x).toBeCloseTo(15.3); // 3 away, pulled 2.8 (never closer than 0.3)
    expect(r.hp).toBeLessThan(1e9);
    expect(inHole.hp).toBe(1e9); // inside the hole of the ring
  });

  it('mage meteors are telegraphed at their offsets and land in order, the big one last', () => {
    const tg = gameWith('mage');
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 6 } });
    const tele = tg.game.state.telegraphs;
    const r = (v: number) => Math.round(v * 100) / 100;
    expect(tele.map(t => [r(t.center.x), r(t.center.y)])).toEqual([[12.4, 6], [13.6, 4.4], [16.4, 4.4], [17.6, 6], [16.4, 7.6], [13.6, 7.6], [15, 6]]);
    expect(tele.map(t => t.total)).toEqual([0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 1.15]); // lava: telegraphLead 0
    advance(tg, 0.5);
    expect(tg.game.state.telegraphs).toHaveLength(4);
    advance(tg, 0.7);
    expect(tg.game.state.telegraphs).toHaveLength(0);
  });

  it('chrono cuts the bench swap cooldowns by its data seconds; bard buffs allies inside its vertical band', () => {
    const cut = getCharacter('chrono').drag.actions.flatMap(a => a.effects).find(e => e.kind === 'swapCooldownReduce');
    const sec = cut?.kind === 'swapCooldownReduce' ? cut.seconds : 0;
    expect(sec).toBeGreaterThan(0);
    const tg = makeGame({ players: [{ ...HUMAN, characters: ['guardian', 'chrono', 'bard'] }] });
    quietFloor(tg);
    const p = tg.game.state.players[0];
    p.party[2].swapCooldownRemaining = 5;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 6 } });
    expect(p.party[2].swapCooldownRemaining).toBeCloseTo(5 - sec);
    expect(p.party[0].swapCooldownRemaining).toBeLessThanOrEqual(getCharacter('guardian').swapCooldown - sec + 1e-6);

    const tb = makeGame({
      players: [
        { ...HUMAN, characters: ['guardian', 'bard', 'cleric'] },
        { ...HUMAN, name: '둘' },
        { ...HUMAN, name: '셋' },
      ],
    });
    quietFloor(tb);
    const inBand = active(tb, 1);
    const outBand = active(tb, 2);
    inBand.pos = { x: 15.5, y: 8.5 }; // band x ∈ [13.7, 16.3], y ∈ [-3, 9] (12 long, centered on the drop)
    outBand.pos = { x: 19, y: 3 };
    inBand.statuses.length = 0;
    outBand.statuses.length = 0;
    tb.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 3 } });
    expect(inBand.statuses.some(s => s.id === 'haste')).toBe(true);
    expect(inBand.statuses.some(s => s.id === 'atkUp')).toBe(true);
    expect(outBand.statuses.some(s => s.id === 'haste')).toBe(false);
  });

  it('non-circle persistent zones keep their footprint (rect zone ticks only inside the band)', () => {
    const tg = gameWith('ranger');
    const caster = active(tg);
    const inside = spawnAt(tg, 'golem', { x: 20, y: 6.3 });
    const outside = spawnAt(tg, 'golem', { x: 20, y: 9 });
    for (const m of [inside, outside]) {
      m.rt.stationary = true;
      m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
    }
    const ctx = charCtx(tg.w, caster, 'drag', { id: 'test_zone', name: '테스트' });
    ctx.point = { x: 14, y: 6 };
    castSkill(tg.w, ctx, [
      { center: 'point', area: { shape: 'rect', dir: 'right', length: 10, width: 1.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.1 }], zone: { duration: 2, tickInterval: 0.5 } },
    ]);
    const z = tg.game.state.zones[0];
    expect(z.area).toEqual({ shape: 'rect', dir: 'right', length: 10, width: 1.5 });
    advance(tg, 1.6);
    expect(inside.hp).toBeLessThan(1e9);
    expect(outside.hp).toBe(1e9);
  });

  it('echo_seal repeats a dash skill without moving the caster again (no dash, no rush back)', () => {
    const tg = gameWith('blade');
    tg.game.state.players[0].relics.push('echo_seal');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    const e = active(tg);
    expect(e.pos.x).toBeCloseTo(16);
    advance(tg, 1.8);
    expect(e.pos.x).toBeCloseTo(10);
    expect(eventsOf(tg, 'dash')).toHaveLength(2);
  });

  it('echo_seal telegraphs every part of a multi-spot skill (mage: six meteors, the big one, the lava), then clears them', () => {
    const tg = gameWith('mage');
    tg.game.state.players[0].relics.push('echo_seal');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    // the echo's telegraphs last the relic delay (1 s); the meteors' own ones are shorter
    const echoTgs = tg.game.state.telegraphs.filter(t => Math.abs(t.total - 1) < 1e-9);
    const r = (v: number) => Math.round(v * 100) / 100;
    expect(echoTgs.map(t => [r(t.center.x), r(t.center.y)])).toEqual([
      [7.4, 6],
      [8.6, 4.4],
      [11.4, 4.4],
      [12.6, 6],
      [11.4, 7.6],
      [8.6, 7.6],
      [10, 6],
      [10, 6],
    ]);
    advance(tg, 1.05);
    expect(tg.game.state.telegraphs.some(t => echoTgs.some(e => e.id === t.id))).toBe(false);
  });
});

describe('preview parts', () => {
  it('include offsets, delays, affects, dash and radius rewards (= the sim values)', () => {
    const tg = makeGame({ players: [{ ...HUMAN, characters: ['mage', 'blade', 'chrono'] }] });
    const s = tg.game.state;
    const mage = previewPartsFor(s, 0, 'swap', 0);
    expect(mage.map(p => p.offset)).toEqual([
      { x: -2.6, y: 0 },
      { x: -1.4, y: -1.6 },
      { x: 1.4, y: -1.6 },
      { x: 2.6, y: 0 },
      { x: 1.4, y: 1.6 },
      { x: -1.4, y: 1.6 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(mage.map(p => p.delay)).toEqual([0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 1.15, 1.15]);
    const blade = previewPartsFor(s, 0, 'swap', 1);
    const bd = getCharacter('blade').drag.actions;
    expect(blade).toEqual([
      { area: bd[0].area, offset: { x: 0, y: 0 }, delay: 0, affects: 'enemies', dash: { dir: 'right', distance: 6 } },
      // 기획 13차: the rush back is drawn as the band it sweeps (dash end → drop point)
      { area: { shape: 'rect', dir: 'right', anchor: 'start', length: 6, width: 1.6 }, offset: { x: 0, y: 0 }, delay: 0.32, affects: 'enemies' },
      { area: bd[2].area, offset: { x: 3, y: 0 }, delay: 0.58, affects: 'enemies' },
    ]);
    const chrono = previewPartsFor(s, 0, 'swap', 2);
    expect(chrono.map(p => p.affects)).toEqual(['enemies', 'self', 'enemies', 'enemies']);
    s.players[0].rewards.push({ rewardId: 'dragrad_rare', partyIndex: 1 });
    const scaled = previewPartsFor(s, 0, 'swap', 1)[0];
    expect(scaled.area).toEqual({ shape: 'rect', dir: 'right', anchor: 'start', length: 6 * 1.3, width: 1.6 * 1.3 });
    expect(scaled.dash).toEqual({ dir: 'right', distance: 6 * 1.3 });
    // game facade = pure function; previewArea = first part
    expect(tg.game.previewParts(0, 'swap', 1)).toEqual(previewPartsFor(s, 0, 'swap', 1));
    expect(tg.game.previewArea(0, 'swap', 0)).toEqual(mage[0].area);
    expect(tg.game.previewParts(0, 'pet', 0)[0].area).toEqual({ shape: 'circle', radius: 2.5 });
    expect(previewPartsFor(s, 5, 'swap', 0)[0].area).toEqual({ shape: 'single' });
  });

  it('a self part after a dash sits at the dash end', async () => {
    const { partsForActions } = await import('../../src/sim/preview');
    const parts = partsForActions(
      [
        { center: 'point', area: { shape: 'rect', dir: 'right', length: 4, width: 1 }, affects: 'enemies', effects: [], dash: { dir: 'right', distance: 4 } },
        { center: 'self', area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [] },
      ],
      1.5,
    );
    expect(parts[1].offset).toEqual({ x: 6, y: 0 });
  });

  it('radius rewards scale the executed area exactly like the preview', () => {
    const tg = gameWith('ranger');
    tg.game.state.players[0].rewards.push({ rewardId: 'dragrad_epic', partyIndex: 1 });
    const far = spawnAt(tg, 'golem', { x: 10 + 14 * 1.5 - 0.3, y: 6 });
    far.rt.stationary = true;
    far.hp = far.maxHp = far.rt.base.maxHp = 1e9;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    advance(tg, 1); // 기획 13차: the volley lands from 0.25 s
    expect(far.hp).toBeLessThan(1e9);
  });
});

describe('R29 bots aim with the real footprint', () => {
  const cluster = (tg: ReturnType<typeof makeGame>, cx: number, cy: number) =>
    [[0, 0], [0.8, 0.4], [-0.6, -0.5], [0.3, 0.9]].map(([dx, dy]) => {
      const m = spawnAt(tg, 'slime', { x: cx + dx, y: cy + dy });
      m.rt.stationary = true;
      return m;
    });
  const covered = (tg: ReturnType<typeof makeGame>, idx: number, pos: Vec2, ms: { pos: Vec2; radius: number }[]) => {
    const parts = tg.game.previewParts(0, 'swap', idx).filter(p => p.affects === 'enemies');
    return ms.filter(m => parts.some(p => hitsArea(p.area, { x: pos.x + p.offset.x, y: pos.y + p.offset.y }, pos, m.pos, m.radius))).length;
  };

  it('fixed-direction skills are dropped behind the cluster: gunner (← cone) to its RIGHT, ranger (→ line) to its LEFT', async () => {
    const { bestDropPoint } = await import('../../src/sim/bot');
    for (const [id, side] of [['gunner', 1], ['ranger', -1], ['berserker', -1], ['shadow', -1]] as const) {
      const tg = makeGame({ players: [{ ...HUMAN, isBot: true, characters: ['guardian', id, 'cleric'] }] });
      quietFloor(tg);
      active(tg).pos = { x: 12, y: 6 };
      const ms = cluster(tg, 14, 6);
      const pos = bestDropPoint(tg.w, tg.w.state.players[0], 1);
      expect(covered(tg, 1, pos, ms), id).toBe(4);
      expect(Math.sign(pos.x - 14), id).toBe(side);
    }
  });

  it('symmetric shapes still center on the cluster (paladin + / warden ring pulls from around it)', async () => {
    const { bestDropPoint } = await import('../../src/sim/bot');
    for (const id of ['paladin', 'chrono', 'warden', 'mage']) {
      const tg = makeGame({ players: [{ ...HUMAN, isBot: true, characters: ['blade', id, 'cleric'] }] });
      quietFloor(tg);
      active(tg).pos = { x: 10, y: 6 };
      const ms = cluster(tg, 15, 6);
      const pos = bestDropPoint(tg.w, tg.w.state.players[0], 1);
      expect(covered(tg, 1, pos, ms), id).toBeGreaterThanOrEqual(3);
      expect(Math.abs(pos.x - 15), id).toBeLessThan(4.5);
    }
  });
});
