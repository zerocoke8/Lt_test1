// 기획 20차 pattern toolkit (docs/bosses.md 3장 N2–N7): arena coordinates and "relative to the facing", tilted strips,
// once-per-cast hits, the turning beam / sliding line builders, charges with a recover and a trail, footprints, front
// shield / weak back, bound marks, alternating skills — each as a small fight, plus what the three 보스 튜닝 sliders do
// to them, 저스트 교대 on every new kind of attack, the wire, and determinism.
// A boss of the right form hosts hand-made parts (its own skills are silenced); numbers here are the test's, not a boss's.
import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { BOSS_FORM, ahead, arenaAt, chargeAt, rays, relocateTo, safeRing, scan, spokes } from '../../src/data/bosses';
import { getBoss } from '../../src/data';
import { applyDamage } from '../../src/sim/combat';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { areaDir, faceArea, faceVec, hitsArea, rectFrame, rotVec, scaleArea } from '../../src/sim/geometry';
import { forceGroggy } from '../../src/sim/groggy';
import { findJustThreats } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import type { PendingHit, SimEntity } from '../../src/sim/world';
import type { AreaShape, GameEvent, MonsterSkill, SkillAction, Tunables, Vec2 } from '../../src/types';
import { inBossBox } from './bossProbe';
import { HUMAN, active, advance, clearEvents, eventsOf, type TestGame } from './helpers';
import { bossOf, raidGame } from './bossRaidHelpers';

const HIT: SkillAction['effects'] = [{ kind: 'damage', amount: 1 }];
const TWO = [HUMAN, { ...HUMAN, name: '둘' }];
const R = 0.45;

/**
 * A fight whose boss does nothing by itself: skills silenced, no basic attacks, standing where the test puts it. Hits
 * land softly (the party is not invincible, so damage events are real) and the boss never dies.
 */
function host(id: string, tunables: Partial<Tunables> = {}, players = [HUMAN]): TestGame {
  const tg = raidGame(id, { hpMult: 80, players, tunables: { monsterDmgMult: 0.01, bossGroggyThreshold: 0, ...tunables } });
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
  advance(tg, 1.1); // past the entrance pose
  freeze(tg);
  tg.w.state.projectiles.length = 0;
  clearEvents(tg);
  return tg;
}

/** The boss stands still (as if casting) and never swings. */
function freeze(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
}

/** Hold a character still at a spot. */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 9999;
}

/** Cast these parts as ONE cast of the boss (one ctx, like a real skill) at `target`. */
function cast(tg: TestGame, parts: SkillAction[], target?: SimEntity, id = 'syn_cast'): (PendingHit | null)[] {
  const b = bossOf(tg);
  if (target) b.targetId = target.id;
  const ctx = unitCtx(tg.w, b, id, '시험');
  return parts.map(a => startAction(tg.w, ctx, a));
}

/** Give the boss exactly these skills (the first due now) and let it act again. */
function give(tg: TestGame, skills: MonsterSkill[]): void {
  const b = bossOf(tg);
  b.rt.skills = skills;
  b.rt.skillCds = skills.map(() => 0);
  b.rt.skillGap = 0;
  b.rt.lockTime = 0;
}

/** Damage events on a character so far. */
const hitsOn = (tg: TestGame, e: SimEntity): Extract<GameEvent, { type: 'damage' }>[] => eventsOf(tg, 'damage').filter(d => d.targetId === e.id);
const teles = (tg: TestGame) => tg.w.state.telegraphs.filter(t => t.team === 'enemy');
const near = (a: Vec2, b: Vec2, eps = 1e-6): boolean => Math.hypot(a.x - b.x, a.y - b.y) < eps;

describe('N3 geometry: a rect / cone with `rot`', () => {
  it('rotVec: quarter turns are exact; rot replaces dir; rot 0 / 90 / 180 / 270 are right / down / left / up', () => {
    expect(rotVec(0)).toEqual({ x: 1, y: 0 });
    expect(rotVec(90)).toEqual({ x: 0, y: 1 });
    expect(rotVec(180)).toEqual({ x: -1, y: 0 });
    expect(rotVec(270)).toEqual({ x: 0, y: -1 });
    expect(rotVec(-90)).toEqual({ x: 0, y: -1 });
    expect(rotVec(450)).toEqual({ x: 0, y: 1 });
    expect(areaDir({ dir: 'left' })).toEqual({ x: -1, y: 0 });
    expect(areaDir({ dir: 'left', rot: 90 })).toEqual({ x: 0, y: 1 });
    const c = { x: 5, y: 5 };
    for (const [dir, rot] of [['right', 0], ['down', 90], ['left', 180], ['up', 270]] as const) {
      const a: AreaShape = { shape: 'rect', dir, length: 6, width: 2 };
      const b: AreaShape = { shape: 'rect', dir: 'right', rot, length: 6, width: 2 };
      expect(rectFrame(b as Extract<AreaShape, { shape: 'rect' }>, c)).toEqual(rectFrame(a as Extract<AreaShape, { shape: 'rect' }>, c));
    }
  });

  it('a strip at 45°: a unit on its line is hit, one beside it is not; a centred strip reaches both ways', () => {
    const strip: AreaShape = { shape: 'rect', dir: 'right', rot: 45, length: 10, width: 2 };
    const c = { x: 5, y: 5 };
    expect(hitsArea(strip, c, c, { x: 8, y: 8 }, R)).toBe(true); // along (1, 1)
    expect(hitsArea(strip, c, c, { x: 8, y: 5 }, R)).toBe(false);
    expect(hitsArea(strip, c, c, { x: 2, y: 2 }, R)).toBe(false); // behind its start
    const both: AreaShape = { ...strip, anchor: 'center' };
    expect(hitsArea(both, c, c, { x: 2, y: 2 }, R)).toBe(true);
    expect(hitsArea(both, c, c, { x: 2, y: 8 }, R)).toBe(false);
  });

  it('a cone with rot opens that way; scaleArea keeps the rot and scales a strip in length and width', () => {
    const cone: AreaShape = { shape: 'cone', dir: 'right', rot: 135, radius: 6, angle: 60 };
    const c = { x: 10, y: 5 };
    expect(hitsArea(cone, c, c, { x: 7, y: 8 }, R)).toBe(true); // down-left
    expect(hitsArea(cone, c, c, { x: 13, y: 8 }, R)).toBe(false);
    expect(scaleArea({ shape: 'rect', dir: 'right', rot: 30, length: 10, width: 2, anchor: 'center' }, 0.5)).toEqual({ shape: 'rect', dir: 'right', rot: 30, length: 5, width: 1, anchor: 'center' });
    expect(scaleArea(cone, 2)).toEqual({ ...cone, radius: 12 });
    expect(scaleArea(safeRing(3.2), 0.5)).toEqual({ shape: 'ring', inner: 3.2, outer: 15 }); // the safe hole stays
  });

  it('faceArea / faceVec: "ahead of a caster that faces down" is +y; a strip across its facing lies along x', () => {
    const down = Math.PI / 2;
    expect(faceVec({ x: 3, y: 0 }, down)).toEqual({ x: 0, y: 3 });
    expect(faceVec({ x: 0, y: 2 }, down)).toEqual({ x: -2, y: 0 }); // its right, seen from above
    expect(faceVec({ x: 3, y: 1 }, 0)).toEqual({ x: 3, y: 1 });
    const across = faceArea({ shape: 'rect', dir: 'right', rot: 90, length: 26, width: 2, anchor: 'center' }, down);
    expect(areaDir(across as { dir: 'right'; rot: number })).toEqual({ x: -1, y: 0 });
    expect(faceArea({ shape: 'circle', radius: 2 }, down)).toEqual({ shape: 'circle', radius: 2 });
  });
});

describe('builders (src/data/bosses/helpers.ts)', () => {
  it('arenaAt / ahead / safeRing / chargeAt / relocateTo make the part fields the rules read', () => {
    expect(arenaAt(12, 6)).toEqual({ center: 'arena', offset: { x: 12, y: 6 } });
    expect(ahead(3)).toEqual({ center: 'self', rel: 'facing', offset: { x: 3, y: 0 } });
    expect(ahead(3, -2)).toEqual({ center: 'self', rel: 'facing', offset: { x: 3, y: -2 } });
    expect(safeRing(2.6)).toEqual({ shape: 'ring', inner: 2.6, outer: 30 });
    const ch = chargeAt({ distance: 9, width: 3.4, delay: 1.2, effects: HIT, recover: 3.2 });
    expect(ch).toMatchObject({ center: 'target', area: { shape: 'line', length: 9, width: 3.4 }, delay: 1.2, charge: { distance: 9, recover: 3.2 } });
    expect(chargeAt({ distance: 30, width: 3, delay: 1, effects: HIT }).charge).toEqual({ distance: 30 });
    expect(relocateTo({ radius: 3, delay: 1.3, effects: HIT })).toMatchObject({ area: { shape: 'circle', radius: 3 }, delay: 1.3, relocate: { to: 'next' } });
  });

  it('spokes: `count` centred strips through the pivot, `step`° apart, `gap` s apart, each `once` with a short warning; arms 2 adds the strip at +90°', () => {
    const one = spokes({ pivot: { x: 12, y: 6 }, from: 0, step: 30, count: 6, arms: 1, length: 22, width: 1.8, first: 1.5, gap: 0.45, lead: 0.9, effects: HIT });
    expect(one).toHaveLength(6);
    expect(one.map(p => (p.area as { rot: number }).rot)).toEqual([0, 30, 60, 90, 120, 150]);
    expect(one.map(p => p.delay)).toEqual([1.5, 1.95, 2.4, 2.85, 3.3, 3.75]);
    for (const p of one) expect(p).toMatchObject({ center: 'arena', offset: { x: 12, y: 6 }, once: true, telegraphLead: 0.9, area: { shape: 'rect', anchor: 'center', length: 22, width: 1.8 } });
    const cross = spokes({ pivot: { x: 12, y: 6 }, from: 0, step: -30, count: 3, arms: 2, length: 22, width: 1.6, first: 1.3, gap: 0.5, lead: 0.9, effects: HIT });
    expect(cross.map(p => [(p.area as { rot: number }).rot, p.delay])).toEqual([[0, 1.3], [90, 1.3], [-30, 1.8], [60, 1.8], [-60, 2.3], [30, 2.3]]);
  });

  it('rays: strips from the body at angles from its facing; scan: strips across the facing stepping away (or back)', () => {
    const fan = rays({ angles: [-25, 0, 25], length: 24, width: 2, delays: [2.5], lead: 1.2, effects: HIT, follow: true });
    expect(fan.map(p => (p.area as { rot: number }).rot)).toEqual([-25, 0, 25]);
    for (const p of fan) expect(p).toMatchObject({ center: 'self', rel: 'facing', follow: true, delay: 2.5, telegraphLead: 1.2 });
    expect(fan[0].once).toBeUndefined();
    const wipe = rays({ angles: [-50, -25, 0, 25, 50], length: 26, width: 1.4, delays: [1.2, 1.5, 1.8, 2.1, 2.4], lead: 0.9, effects: HIT, once: true });
    expect(wipe.map(p => p.delay)).toEqual([1.2, 1.5, 1.8, 2.1, 2.4]);
    expect(wipe.every(p => p.once === true)).toBe(true);
    const out = scan({ from: 2, to: 18, step: 2, length: 26, width: 2, first: 1.2, gap: 0.3, lead: 0.9, effects: HIT });
    expect(out).toHaveLength(9);
    expect(out.map(p => p.offset!.x)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(out[8].delay).toBeCloseTo(1.2 + 8 * 0.3, 6);
    for (const p of out) expect(p).toMatchObject({ center: 'self', rel: 'facing', once: true, telegraphLead: 0.9, area: { shape: 'rect', rot: 90, anchor: 'center' } });
    const back = scan({ from: 18, to: 2, step: 2, length: 26, width: 2, first: 1.2, gap: 0.24, lead: 0.9, effects: HIT });
    expect(back.map(p => p.offset!.x)).toEqual([18, 16, 14, 12, 10, 8, 6, 4, 2]);
  });
});

describe('N2 where a part lands: arena coordinates and "relative to the facing"', () => {
  it("center 'arena': the offset is the spot, wherever the boss stands; 보스 범위 크기 배율 does not move it", () => {
    for (const area of [1, 2]) {
      const tg = host('washer_drum', { bossAreaMult: area });
      bossOf(tg).pos = { x: 20, y: 9 };
      cast(tg, [{ ...arenaAt(5, 4), area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 1, effects: HIT }], active(tg));
      expect(teles(tg)[0].center).toEqual({ x: 5, y: 4 });
      expect(teles(tg)[0].area).toEqual({ shape: 'circle', radius: 2 * area });
    }
  });

  it("rel 'facing' on a relocating boss: `ahead` follows the seat's facing — and a `follow` part re-resolves after the move", () => {
    const tg = host('endless_meeting');
    const b = bossOf(tg);
    const spots = getBoss('endless_meeting').spots!; // E (21, 6) left · S (12, 10) up · …
    cast(tg, [{ ...ahead(4), area: { shape: 'circle', radius: 1 }, affects: 'enemies', delay: 1, effects: HIT }], active(tg));
    expect(near(teles(tg)[0].center, { x: 17, y: 6 })).toBe(true); // 4 ahead of a seat that faces left
    advance(tg, 1.2);
    // move to S, then a strip straight ahead that follows: it must come from the new seat, pointing up
    cast(tg, [
      relocateTo({ radius: 2, delay: 1, effects: HIT }),
      ...rays({ angles: [0], length: 10, width: 2, delays: [2], lead: 1, effects: HIT, follow: true }),
    ]);
    advance(tg, 1.2);
    expect(near(b.pos, spots[1])).toBe(true);
    const ray = teles(tg).find(t => t.area.shape === 'rect')!;
    expect(near(ray.center, spots[1])).toBe(true);
    expect(areaDir(ray.area as { dir: 'right'; rot?: number }).y).toBeCloseTo(-1, 9);
    const me = active(tg);
    pin(me, { x: 12, y: 3 }); // 7 above the new seat: in the strip
    clearEvents(tg);
    advance(tg, 1);
    expect(hitsOn(tg, me)).toHaveLength(1);
  });

  it("rel 'facing' on a roaming boss: a cone 'ahead' opens where it faces; one written with rot 180 opens behind it", () => {
    const tg = host('shredder_maw', {}, TWO);
    const b = bossOf(tg);
    b.pos = { x: 12, y: 6 };
    b.facing = 0;
    const [front, back] = [active(tg, 0), active(tg, 1)];
    pin(front, { x: 15, y: 6 });
    pin(back, { x: 9, y: 6 });
    const bite: SkillAction = { center: 'self', rel: 'facing', area: { shape: 'cone', dir: 'right', radius: 5.5, angle: 110 }, affects: 'enemies', delay: 1, effects: HIT };
    cast(tg, [bite], front);
    advance(tg, 1.1);
    expect(hitsOn(tg, front)).toHaveLength(1);
    expect(hitsOn(tg, back)).toHaveLength(0);
    clearEvents(tg);
    cast(tg, [{ ...bite, area: { shape: 'cone', dir: 'right', rot: 180, radius: 5, angle: 90 } }], front);
    advance(tg, 1.1);
    expect(hitsOn(tg, front)).toHaveLength(0);
    expect(hitsOn(tg, back)).toHaveLength(1);
  });
});

describe('N3 once per cast, the turning beam and the sliding line', () => {
  const strip = (rot: number, delay: number, once: boolean): SkillAction => ({
    ...arenaAt(12, 6), area: { shape: 'rect', dir: 'right', rot, length: 22, width: 2, anchor: 'center' }, affects: 'enemies', delay, effects: HIT, ...(once ? { once: true as const } : null),
  });

  it('two `once` strips that both cover a unit hit it once; without `once` twice; a unit only the second covers is hit by the second', () => {
    const tg = host('karaoke_room', {}, TWO);
    const [mid, side] = [active(tg, 0), active(tg, 1)];
    pin(mid, { x: 12.3, y: 6.2 }); // at the pivot: in every strip
    pin(side, { x: 12, y: 10 }); // straight below: only the 90° strip
    cast(tg, [strip(0, 1, true), strip(90, 1.5, true)], mid);
    advance(tg, 1.7);
    expect(hitsOn(tg, mid)).toHaveLength(1);
    expect(hitsOn(tg, side)).toHaveLength(1);
    clearEvents(tg);
    cast(tg, [strip(0, 1, false), strip(90, 1.5, false)], mid);
    advance(tg, 1.7);
    expect(hitsOn(tg, mid)).toHaveLength(2);
    // a new cast has a new hit set
    clearEvents(tg);
    cast(tg, [strip(0, 1, true)], mid);
    advance(tg, 1.1);
    expect(hitsOn(tg, mid)).toHaveLength(1);
  });

  it('spokes: the strips show one after the other (each for its last `lead` s, tagged sweep) and land in turning order', () => {
    const tg = host('karaoke_room');
    const me = active(tg);
    pin(me, { x: 12, y: 1 }); // straight above the pivot: only the 90° strip (the 4th) reaches it
    cast(tg, spokes({ pivot: { x: 12, y: 6 }, from: 0, step: 30, count: 6, arms: 1, length: 22, width: 1.8, first: 1.5, gap: 0.45, lead: 0.9, effects: HIT }), me);
    expect(teles(tg)).toHaveLength(0); // nothing yet: the first shows 0.6 s in
    const seen: number[] = [];
    let hitAt = -1;
    for (let t = 0; t < 4.2 * 30; t++) {
      tick(tg.w);
      for (const tele of teles(tg)) {
        expect(tele.motif).toBe('sweep');
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1 / 30 + 1e-6);
        const rot = (tele.area as { rot: number }).rot;
        if (!seen.includes(rot)) seen.push(rot);
      }
      if (hitAt < 0 && hitsOn(tg, me).length > 0) hitAt = (t + 1) / 30;
    }
    expect(seen).toEqual([0, 30, 60, 90, 120, 150]);
    expect(hitAt).toBeCloseTo(1.5 + 3 * 0.45, 1);
    expect(hitsOn(tg, me)).toHaveLength(1);
  });

  it('scan from a seat: the line slides away from the machine across its facing; a unit is hit when it arrives, once', () => {
    const tg = host('xray_machine');
    const me = active(tg);
    pin(me, { x: 9.5, y: 9 }); // 6 ahead of the west station (3.5, 6), which looks right
    cast(tg, scan({ from: 2, to: 8, step: 2, length: 26, width: 2, first: 1.2, gap: 0.3, lead: 0.9, effects: HIT }), me);
    let hitAt = -1;
    for (let t = 0; t < 3 * 30; t++) {
      tick(tg.w);
      if (hitAt < 0 && hitsOn(tg, me).length > 0) hitAt = (t + 1) / 30;
    }
    expect(hitAt).toBeCloseTo(1.2 + 2 * 0.3, 1); // the third strip (x 9.5)
    expect(hitsOn(tg, me)).toHaveLength(1);
  });
});

describe('charge on a form boss (existing `charge` + recover + trail)', () => {
  const rush = (o: Partial<Parameters<typeof chargeAt>[0]> = {}): SkillAction => chargeAt({ distance: 30, width: 3, delay: 1, effects: HIT, ...o });

  it('the path is warned at cast (tagged charge), the boss turns to it at once, runs to the edge of its box and hits along the way', () => {
    const tg = host('washer_drum', {}, TWO);
    const b = bossOf(tg);
    const [onPath, off] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 4, y: 6 };
    b.facing = Math.PI / 2;
    pin(onPath, { x: 14, y: 6 });
    pin(off, { x: 14, y: 10 });
    cast(tg, [rush()], onPath);
    const tele = teles(tg)[0];
    expect(tele.motif).toBe('charge');
    expect(tele.area.shape).toBe('line');
    expect(tele.origin).toEqual({ x: 4, y: 6 });
    expect(tele.center).toEqual({ x: BOSS_FORM.box.xMax, y: 6 }); // clamped to the box, not the arena wall
    expect(b.facing).toBe(0);
    expect(b.pos).toEqual({ x: 4, y: 6 });
    advance(tg, 1.1);
    expect(b.pos).toEqual({ x: BOSS_FORM.box.xMax, y: 6 });
    expect(inBossBox(b.pos)).toBe(true);
    expect(hitsOn(tg, onPath)).toHaveLength(1);
    expect(hitsOn(tg, off)).toHaveLength(0);
    expect(eventsOf(tg, 'dash').filter(e => e.entityId === b.id)).toHaveLength(1);
  });

  it('`recover`: after it lands the boss neither moves nor turns for that long; a shorter rush stops after `distance`', () => {
    const tg = host('shredder_maw');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 6, y: 6 };
    pin(me, { x: 20, y: 6 });
    give(tg, [{ id: 'syn_lunge', name: '시험 급지', cooldown: 99, action: rush({ distance: 9, recover: 3 }) }]);
    b.rt.attackCd = 9999;
    advance(tg, 1.2);
    expect(b.pos.x).toBeCloseTo(15, 6); // 9 cells, not to the wall
    expect(b.rt.lockTime).toBeGreaterThan(2.7);
    const facing = b.facing;
    me.pos = { x: 15, y: 11 };
    advance(tg, 2.5);
    expect(b.pos.x).toBeCloseTo(15, 6);
    expect(b.facing).toBe(facing);
    advance(tg, 2);
    expect(b.facing).not.toBe(facing); // free: it turns to its target
  });

  it('`trail`: circles every `spacing` along the path it ran, with the look; they do not hit when laid, then tick; 보스 범위 ×2 doubles their radius, not their spacing', () => {
    for (const area of [1, 2]) {
      const tg = host('answering_pencil', { bossAreaMult: area }, TWO);
      const b = bossOf(tg);
      const [target, onLine] = [active(tg, 0), active(tg, 1)];
      b.pos = { x: 4, y: 5 };
      pin(target, { x: 21, y: 5 });
      pin(onLine, { x: 8, y: 5 });
      const trail = { radius: 0.6, spacing: 1, duration: 10, tickInterval: 0.5, effects: [{ kind: 'damage' as const, amount: 0.3 }], look: 'graphite' };
      cast(tg, [rush({ distance: 13, width: 1.4, trail })], target);
      advance(tg, 1 + 1 / 30);
      const zones = tg.w.state.zones.filter(z => z.team === 'enemy');
      expect(zones).toHaveLength(14); // 13 cells / 1 + the start
      expect(zones.every(z => z.look === 'graphite' && z.kind === 'damage')).toBe(true);
      expect(zones[0].radius).toBeCloseTo(0.6 * area, 9);
      expect(zones.map(z => z.center.x)).toEqual(Array.from({ length: 14 }, (_, k) => 4 + k));
      expect(zones.every(z => Math.abs(z.center.y - 5) < 1e-9)).toBe(true);
      // the rush itself hit the character on the line once; the trail has not ticked yet
      expect(hitsOn(tg, onLine)).toHaveLength(1);
      advance(tg, 0.55);
      expect(hitsOn(tg, onLine)).toHaveLength(2);
      advance(tg, 10);
      expect(tg.w.state.zones.filter(z => z.team === 'enemy')).toHaveLength(0);
    }
  });
});

describe('N4 footprints (BossDef.trail)', () => {
  it('커피 머신: a puddle under the body every 1.2 cells walked, never more than 14 (the oldest goes), none while it stands', () => {
    const tg = raidGame('coffee_machine', { hpMult: 80, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    const b = bossOf(tg);
    b.rt.skillCds = b.rt.skillCds.map(() => 9999);
    const tr = getBoss('coffee_machine').trail!;
    expect(tr.radius).toBeLessThan(b.radius);
    advance(tg, 1); // entrance: stands
    expect(tg.w.state.zones.filter(z => z.look === 'coffee')).toHaveLength(0);
    let moved = 0;
    let last = { ...b.pos };
    let dropped = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 40 * 30; t++) {
      tick(tg.w);
      moved += Math.hypot(b.pos.x - last.x, b.pos.y - last.y);
      last = { ...b.pos };
      const mine = tg.w.state.zones.filter(z => z.look === 'coffee');
      expect(mine.length).toBeLessThanOrEqual(tr.max);
      for (const z of mine) {
        if (seen.has(z.id)) continue;
        seen.add(z.id);
        dropped++;
        expect(z.radius).toBe(tr.radius);
        expect(z.team).toBe('enemy');
      }
    }
    expect(dropped).toBe(Math.floor(moved / tr.every + 1e-6));
    expect(dropped).toBeGreaterThan(tr.max); // it walked far enough for the cap to matter
    // each puddle: 8 s, hurting whoever stands in it every 0.5 s (not on the tick it was laid)
    const z = tg.w.state.zones.filter(x => x.look === 'coffee').slice(-1)[0];
    expect(z.total).toBe(tr.duration);
  });

  it('a groggy boss lays nothing; a boss without `trail` (every other one) never does', () => {
    const tg = raidGame('coffee_machine', { hpMult: 80, tunables: { invincible: true } });
    bossOf(tg).rt.skillCds = bossOf(tg).rt.skillCds.map(() => 9999);
    advance(tg, 2);
    expect(forceGroggy(tg.w)).toBe(true);
    const n = tg.w.state.zones.filter(z => z.look === 'coffee').length;
    advance(tg, 3);
    expect(tg.w.state.zones.filter(z => z.look === 'coffee').length).toBeLessThanOrEqual(n);
    const other = raidGame('washer_drum', { hpMult: 80, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    bossOf(other).rt.skillCds = bossOf(other).rt.skillCds.map(() => 9999);
    pin(active(other), { x: 2, y: 10 });
    advance(other, 8);
    expect(other.w.state.zones.filter(z => z.team === 'enemy')).toHaveLength(0);
  });
});

describe('N5 front shield · weak back (BossDef.guard)', () => {
  /** One hit of 100 raw from `from` (a character at that spot) on the shredder facing +x; returns what landed. */
  function hit(tg: TestGame, from: Vec2, how: 'own' | 'pet' | 'zone' | 'burn' = 'own'): { dealt: number; flag?: string } {
    const b = bossOf(tg);
    const me = active(tg);
    me.pos = { ...from };
    clearEvents(tg);
    const base = { team: 'ally' as const, player: 0, source: 'drag' as const, isDrag: false };
    const src = how === 'own' ? { ...base, casterId: me.id } : how === 'zone' ? { ...base, casterId: me.id, fromZone: true } : { ...base, casterId: null, source: how === 'pet' ? ('pet' as const) : ('passive' as const) };
    applyDamage(tg.w, src, b, 100, false);
    const ev = eventsOf(tg, 'damage').find(d => d.targetId === b.id)!;
    return { dealt: ev.amount, flag: ev.guard };
  }

  function shredder(tunables: Partial<Tunables> = {}): TestGame {
    const tg = host('shredder_maw', tunables);
    const b = bossOf(tg);
    b.pos = { x: 12, y: 6 };
    b.facing = 0;
    pin(active(tg), { x: 16, y: 6 });
    return tg;
  }

  it('by where the hitting character stands: front 140° × 0.5, back 120° × 1.6, the sides × 1 — and the damage event says so', () => {
    const tg = shredder();
    const g = getBoss('shredder_maw').guard!;
    const side = hit(tg, { x: 12, y: 10 });
    expect(side.flag).toBeUndefined();
    const front = hit(tg, { x: 16, y: 6 });
    expect(front.dealt).toBeCloseTo(side.dealt * g.frontMult, 6);
    expect(front.flag).toBe('front');
    const back = hit(tg, { x: 8, y: 6 });
    expect(back.dealt).toBeCloseTo(side.dealt * g.backMult, 6);
    expect(back.flag).toBe('back');
    // the edges of the arcs: 69° off the front is still the shield, 71° is the side; 121° off is the back, 119° the side
    const at = (deg: number): Vec2 => ({ x: 12 + Math.cos((deg * Math.PI) / 180) * 4, y: 6 + Math.sin((deg * Math.PI) / 180) * 4 });
    expect(hit(tg, at(69)).flag).toBe('front');
    expect(hit(tg, at(71)).flag).toBeUndefined();
    expect(hit(tg, at(119)).flag).toBeUndefined();
    expect(hit(tg, at(121)).flag).toBe('back');
    // it turns with the boss
    bossOf(tg).facing = Math.PI;
    expect(hit(tg, { x: 16, y: 6 }).flag).toBe('back');
  });

  it('damage without a unit behind it (a pet, a burn) and a zone tick are never shielded or boosted', () => {
    const tg = shredder();
    const side = hit(tg, { x: 12, y: 10 }).dealt;
    for (const how of ['pet', 'zone', 'burn'] as const) {
      expect(hit(tg, { x: 16, y: 6 }, how), `${how} from the front`).toEqual({ dealt: side, flag: undefined });
      expect(hit(tg, { x: 8, y: 6 }, how), `${how} from the back`).toEqual({ dealt: side, flag: undefined });
    }
  });

  it('groggy: the front shield is off (× 1), the back still × 1.6 on top of the groggy multiplier', () => {
    const tg = shredder({ bossGroggyThreshold: 100 });
    const g = getBoss('shredder_maw').guard!;
    const plain = hit(tg, { x: 12, y: 10 }).dealt;
    bossOf(tg).rt.lockTime = 0;
    expect(forceGroggy(tg.w)).toBe(true);
    bossOf(tg).facing = 0;
    const k = tg.w.tunables.bossGroggyDamageMult;
    expect(hit(tg, { x: 12, y: 10 }).dealt).toBeCloseTo(plain * k, 6);
    const front = hit(tg, { x: 16, y: 6 });
    expect(front.dealt).toBeCloseTo(plain * k, 6);
    expect(front.flag).toBeUndefined();
    const back = hit(tg, { x: 8, y: 6 });
    expect(back.dealt).toBeCloseTo(plain * k * g.backMult, 6);
    expect(back.flag).toBe('back');
  });

  it('a boss without `guard` (every other one) takes the same from every side', () => {
    const tg = host('washer_drum');
    const b = bossOf(tg);
    b.pos = { x: 12, y: 6 };
    b.facing = 0;
    expect(hit(tg, { x: 16, y: 6 })).toEqual(hit(tg, { x: 8, y: 6 }));
  });
});

describe('N6 bound mark (표식)', () => {
  const mark = (delay = 3): SkillAction[] => [
    { center: 'target', area: { shape: 'single' }, affects: 'enemies', bound: true, delay, effects: [{ kind: 'damage', amount: 3 }] },
    { center: 'target', area: { shape: 'ring', inner: 1, outer: 3.2 }, affects: 'enemies', bound: true, delay, effects: HIT },
  ];

  it('both parts are tied to the unit targeted at cast: Telegraph.mark names it and the warnings follow it as it moves', () => {
    const tg = host('endless_meeting', {}, TWO);
    const [me, friend] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 8, y: 8 });
    pin(friend, { x: 20, y: 9 });
    cast(tg, mark(), me);
    expect(teles(tg)).toHaveLength(2);
    expect(teles(tg).map(t => t.mark)).toEqual([me.id, me.id]);
    expect(cleanState(tg.w.state).telegraphs.map(t => t.mark)).toEqual([me.id, me.id]);
    me.pos = { x: 10, y: 9 };
    advance(tg, 0.1);
    for (const t of teles(tg)) expect(near(t.center, { x: 10, y: 9 })).toBe(true);
    // it stays: it goes off on that unit, and on whoever stands in the ring around it
    friend.pos = { x: 12, y: 9 };
    clearEvents(tg);
    advance(tg, 3);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, friend)).toHaveLength(1);
    expect(eventsOf(tg, 'markClear')).toHaveLength(0);
  });

  it('swapping the marked character out drops the whole mark: warnings gone, one markClear, nobody is hit — it never jumps to the new character', () => {
    const tg = host('endless_meeting', {}, TWO);
    const [me, friend] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 8, y: 8 });
    pin(friend, { x: 10, y: 8 }); // inside the ring around the marked one
    cast(tg, mark(), me);
    advance(tg, 1);
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 8, y: 8 } }).ok).toBe(true);
    advance(tg, 0.1);
    expect(teles(tg)).toHaveLength(0);
    const cleared = eventsOf(tg, 'markClear');
    expect(cleared).toHaveLength(1);
    expect(cleared[0].targetId).toBe(me.id);
    advance(tg, 3);
    expect(eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally')).toHaveLength(0);
    expect(eventsOf(tg, 'interrupt')).toHaveLength(0); // dropped, not "끊김!"
  });

  it('a normal `follow` part re-targets after a swap — a bound one is the only kind that does not', () => {
    const tg = host('endless_meeting');
    const me = active(tg);
    pin(me, { x: 8, y: 8 });
    cast(tg, [{ center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', follow: true, delay: 2, effects: HIT }], me);
    advance(tg, 0.5);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 8, y: 8 } });
    bossOf(tg).rt.lockTime = 0; // it picks the new character as its target
    advance(tg, 0.2);
    freeze(tg);
    expect(teles(tg)).toHaveLength(1);
    expect(teles(tg)[0].mark).toBeUndefined();
  });
});

describe('N7 alternating skills (cycle)', () => {
  it('cast 1 = action, then cycle[0], cycle[1], and around again — a counter per skill, no rng', () => {
    const tg = host('morgue_drawers');
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    const at = (x: number): Pick<MonsterSkill, 'action'> => ({ action: { ...arenaAt(x, 6), area: { shape: 'circle', radius: 1 }, affects: 'enemies', delay: 0.8, effects: HIT } });
    const sk: MonsterSkill = { id: 'syn_cycle', name: '시험 번갈아', cooldown: 1, ...at(3), cycle: [at(9), at(15)] };
    const other: MonsterSkill = { id: 'syn_other', name: '시험 다른', cooldown: 9999, initialDelay: 9999, ...at(21) };
    give(tg, [sk, other]);
    bossOf(tg).rt.skillCds = [0, 9999];
    const xs: number[] = [];
    for (let t = 0; t < 14 * 30 && xs.length < 7; t++) {
      tick(tg.w);
      for (const e of tg.game.drainEvents()) if (e.type === 'skillCast' && e.skillId === 'syn_cycle') xs.push(e.center.x);
    }
    expect(xs).toEqual([3, 9, 15, 3, 9, 15, 3]);
  });
});

describe('보스 튜닝 sliders on the new parts', () => {
  it('보스 예고 시간 배율 ×2: the charge warning, the relocate warning and the gaps of a beam all double; recover and trail time stay', () => {
    const tg = host('endless_meeting', { bossTelegraphMult: 2 });
    cast(tg, [relocateTo({ radius: 3, delay: 1.2, effects: HIT })]);
    expect(teles(tg)[0].total).toBeCloseTo(2.4, 6);
    const beam = host('karaoke_room', { bossTelegraphMult: 2 });
    const parts = cast(beam, spokes({ pivot: { x: 12, y: 6 }, from: 0, step: 30, count: 3, arms: 1, length: 22, width: 1.8, first: 1.5, gap: 0.45, lead: 0.9, effects: HIT }), active(beam));
    expect(parts.map(p => p!.remaining)).toEqual([3, 3.9, 4.8]);
    expect(parts.map(p => p!.telegraphLead)).toEqual([1.8, 1.8, 1.8]);
    const run = host('shredder_maw', { bossTelegraphMult: 2 });
    const b = bossOf(run);
    b.pos = { x: 6, y: 6 };
    pin(active(run), { x: 20, y: 6 });
    give(run, [{ id: 'syn_lunge', name: '시험 급지', cooldown: 99, action: chargeAt({ distance: 9, width: 3, delay: 1, effects: HIT, recover: 3 }) }]);
    b.rt.attackCd = 9999;
    tick(run.w);
    expect(teles(run)[0].total).toBeCloseTo(2, 6);
    advance(run, 2.1);
    expect(b.pos.x).toBeCloseTo(15, 6);
    expect(b.rt.lockTime).toBeGreaterThan(2.7); // the recover is 3 s, not 6
    expect(b.rt.lockTime).toBeLessThanOrEqual(3);
  });

  it('보스 범위 크기 배율 ×0.5: a tilted strip halves in length and width, a charge path only in width (it runs as far), a safe hole stays', () => {
    const tg = host('karaoke_room', { bossAreaMult: 0.5 });
    const [p] = cast(tg, spokes({ pivot: { x: 12, y: 6 }, from: 30, step: 30, count: 1, arms: 1, length: 22, width: 1.8, first: 1, gap: 0.4, lead: 2, effects: HIT }), active(tg));
    expect(p!.area).toMatchObject({ shape: 'rect', rot: 30, length: 11, width: 0.9 });
    expect(p!.center).toEqual({ x: 12, y: 6 });
    cast(tg, [{ ...arenaAt(5, 6), area: safeRing(3.2), affects: 'enemies', delay: 2, effects: HIT }], active(tg));
    expect(teles(tg).find(t => t.area.shape === 'ring')!.area).toEqual({ shape: 'ring', inner: 3.2, outer: 15 });
    const run = host('washer_drum', { bossAreaMult: 0.5 });
    const b = bossOf(run);
    b.pos = { x: 4, y: 6 };
    pin(active(run), { x: 14, y: 6 });
    const [c] = cast(run, [chargeAt({ distance: 30, width: 3, delay: 1, effects: HIT })], active(run));
    expect(c!.chargeTo).toEqual({ x: BOSS_FORM.box.xMax, y: 6 });
    expect((c!.area as { width: number }).width).toBe(1.5);
  });
});

describe('저스트 교대 on the new attacks (no rule change: each is a telegraphed hit)', () => {
  /** Tick until the part has at most `left` s to go, then swap out; returns the justSwap events. */
  function swapAt(tg: TestGame, p: PendingHit, left: number, drop: Vec2): Extract<GameEvent, { type: 'justSwap' }>[] {
    for (let i = 0; i < 400 && p.remaining > left + 1e-9; i++) tick(tg.w);
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: drop }).ok).toBe(true);
    return eventsOf(tg, 'justSwap');
  }

  it('a charge: leaving its path 0.3 s before the rush lands is a just; the rush still runs and whiffs', () => {
    const tg = host('washer_drum');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 4, y: 6 };
    pin(me, { x: 14, y: 6 });
    const [p] = cast(tg, [chargeAt({ distance: 30, width: 3, delay: 1.3, effects: HIT })], me);
    expect(findJustThreats(tg.w, tg.w.state.players[0], me)).toHaveLength(0); // too early
    const ev = swapAt(tg, p!, 0.3, { x: 14, y: 10.5 });
    expect(ev).toHaveLength(1);
    expect(ev[0].boss).toBe(true);
    advance(tg, 0.5);
    expect(eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally')).toHaveLength(0);
    expect(b.pos.x).toBe(BOSS_FORM.box.xMax);
  });

  it('one step of a beam: a just against the strip that is about to land — not against one that already passed over the character', () => {
    const tg = host('karaoke_room');
    const me = active(tg);
    pin(me, { x: 12.2, y: 6.2 }); // at the pivot: every strip covers it
    const parts = cast(tg, spokes({ pivot: { x: 12, y: 6 }, from: 0, step: 30, count: 3, arms: 1, length: 22, width: 1.8, first: 1.5, gap: 0.6, lead: 0.9, effects: HIT }), me);
    for (let i = 0; i < 400 && parts[0]!.remaining > 0.2 + 1e-9; i++) tick(tg.w);
    expect(findJustThreats(tg.w, tg.w.state.players[0], me).map(t => t.telegraphId)).toEqual([parts[0]!.telegraphId]);
    advance(tg, 0.3); // the first strip hit it: the later ones cannot (once)
    expect(hitsOn(tg, me)).toHaveLength(1);
    for (let i = 0; i < 400 && parts[1]!.remaining > 0.2 + 1e-9; i++) tick(tg.w);
    expect(findJustThreats(tg.w, tg.w.state.players[0], me)).toHaveLength(0);
  });

  it('a relocate slam and a bound mark: both are just-able in their last 0.5 s (the mark is then cleared by the swap)', () => {
    const slam = host('endless_meeting');
    const spots = getBoss('endless_meeting').spots!;
    const me = active(slam);
    pin(me, { x: spots[1].x - 2, y: spots[1].y });
    const [p] = cast(slam, [relocateTo({ radius: 2.8, delay: 1.3, effects: HIT })], me);
    expect(swapAt(slam, p!, 0.3, { x: 4, y: 9 })).toHaveLength(1);

    const marked = host('endless_meeting');
    const who = active(marked);
    pin(who, { x: 8, y: 8 });
    const [m] = cast(marked, [{ center: 'target', area: { shape: 'single' }, affects: 'enemies', bound: true, delay: 3.5, effects: [{ kind: 'damage', amount: 3.4 }] }], who);
    const ev = swapAt(marked, m!, 0.4, { x: 8, y: 8 });
    expect(ev).toHaveLength(1);
    advance(marked, 0.6);
    expect(eventsOf(marked, 'markClear')).toHaveLength(1);
    expect(eventsOf(marked, 'damage').filter(d => d.targetTeam === 'ally')).toHaveLength(0);
  });
});

describe('the wire and determinism', () => {
  it('the new fields ride the snapshot only when set: Telegraph.motif / mark, Zone.look; hit sets and form state never do', () => {
    const tg = host('washer_drum');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 4, y: 6 };
    pin(me, { x: 14, y: 6 });
    cast(tg, [
      chargeAt({ distance: 8, width: 2, delay: 1, effects: HIT, trail: { radius: 0.6, spacing: 2, duration: 5, tickInterval: 0.5, effects: HIT, look: 'graphite' } }),
      { ...arenaAt(12, 6), area: { shape: 'rect', dir: 'right', rot: 30, length: 10, width: 2, anchor: 'center' }, affects: 'enemies', delay: 2, effects: HIT, once: true },
      { center: 'target', area: { shape: 'circle', radius: 2 }, affects: 'enemies', delay: 2, effects: HIT },
    ], me);
    const wire = cleanState(tg.w.state);
    expect(wire.telegraphs.map(t => t.motif)).toEqual(['charge', 'sweep', undefined]);
    expect(Object.keys(wire.telegraphs[2]).sort()).toEqual(['area', 'center', 'id', 'origin', 'remaining', 'team', 'total']);
    expect((wire.telegraphs[1].area as { rot?: number }).rot).toBe(30);
    advance(tg, 1.1);
    const zones = cleanState(tg.w.state).zones;
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every(z => z.look === 'graphite')).toBe(true);
    const text = JSON.stringify(cleanState(tg.w.state));
    for (const key of ['onceHit', 'bound', 'fromZone', 'tauntImmune', 'cycleNo', '"rt"']) expect(text.includes(key), key).toBe(false);
    const boss = cleanState(tg.w.state).entities.find(e => e.id === b.id)!;
    expect(Object.keys(boss)).not.toContain('form');
  });

  it('same seed → the same fight, tick for tick, with every new part in play (charge + trail, beam, mark, relocate, cycle)', () => {
    const digest = (seed: number): string => {
      const tg = raidGame('endless_meeting', { seed, hpMult: 30, players: [{ ...HUMAN, isBot: true }, { ...HUMAN, name: '둘', isBot: true }] });
      const kit: MonsterSkill[] = [
        { id: 'syn_a', name: '시험 가', cooldown: 7, initialDelay: 1.5, action: relocateTo({ radius: 2.8, delay: 1.3, effects: HIT }), extra: rays({ angles: [-25, 0, 25], length: 24, width: 2, delays: [2.5], lead: 1.2, effects: HIT, follow: true }) },
        { id: 'syn_b', name: '시험 나', cooldown: 8, initialDelay: 3, action: { center: 'target', area: { shape: 'single' }, affects: 'enemies', bound: true, delay: 3.5, effects: HIT } },
        { id: 'syn_c', name: '시험 다', cooldown: 9, initialDelay: 5, ...((): Pick<MonsterSkill, 'action' | 'extra'> => {
          const s = spokes({ pivot: { x: 12, y: 6 }, from: 0, step: 30, count: 6, arms: 1, length: 22, width: 1.8, first: 1.5, gap: 0.45, lead: 0.9, effects: HIT });
          return { action: s[0], extra: s.slice(1) };
        })(), cycle: [{ action: { ...arenaAt(5, 6), area: safeRing(3.2), affects: 'enemies', delay: 2.6, effects: HIT } }] },
      ];
      const b = bossOf(tg);
      b.rt.skills = kit;
      b.rt.skillCds = kit.map(k => k.initialDelay ?? 0);
      b.rt.phase = 99;
      let h = 2166136261;
      for (let t = 0; t < 40 * 30 && tg.w.state.phase === 'combat'; t++) {
        tick(tg.w);
        if (t % 5 !== 0) continue;
        const s = JSON.stringify(tg.w.state, (k, v) => (k === 'rt' ? undefined : v));
        for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
      }
      return `${h}:${tg.w.state.tick}`;
    };
    expect(digest(31)).toBe(digest(31));
    expect(digest(31)).not.toBe(digest(32));
  });
});
