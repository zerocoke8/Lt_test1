// 기획 20차 보스 형태 (docs/bosses.md 1장 · 3장 N1 · N2): where a boss appears, how a roaming / arena boss walks, turns
// and stands while it casts, the box, heavy bodies, groggy, taunt (redirect, 6 s immunity, who is immune), patrol /
// keep-away / axis movers, a relocating boss's seats, and the debug knob 「보스 이동 속도 배율」.
// The fights use the real bosses (their form data) with their skills silenced; a pattern under test is cast by hand.
import { describe, expect, it } from 'vitest';
import { BOSS_POS } from '../../src/config';
import { BOSSES, BOSS_IDS, getBoss } from '../../src/data';
import { BOSS_FORM, relocateTo } from '../../src/data/bosses';
import { bossFormOf, bossSpawnPos, isHeavy, isTauntable } from '../../src/sim/bossForm';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { forceGroggy } from '../../src/sim/groggy';
import { applyEffects, startAction } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { applyStatus, hasStatus } from '../../src/sim/status';
import type { SimEntity } from '../../src/sim/world';
import type { MonsterSkill, SkillAction, Tunables, Vec2 } from '../../src/types';
import { inBossBox } from './bossProbe';
import { HUMAN, active, advance, clearEvents, eventsOf, type TestGame } from './helpers';
import { bossOf, raidGame } from './bossRaidHelpers';

const CALM: Partial<Tunables> = { invincible: true, bossGroggyThreshold: 0 };
const DEG = Math.PI / 180;
const MOVING = BOSSES.filter(b => bossFormOf(b) !== 'fixed').map(b => b.id);

/** A fight against `id` whose boss casts nothing by itself (and never dies): it only walks, turns and swings. */
function quiet(id: string, tunables: Partial<Tunables> = {}, past = 1.1): TestGame {
  const tg = raidGame(id, { hpMult: 50, tunables: { ...CALM, ...tunables } });
  silence(tg);
  if (past > 0) run(tg, past); // past the entrance pose
  clearEvents(tg);
  return tg;
}

function silence(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
}

/** Advance `seconds`, keeping the boss silent. */
function run(tg: TestGame, seconds: number): void {
  advance(tg, seconds);
}

/** Hold a character still at a spot (it no longer walks or attacks). */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 9999;
}

/** Give the boss exactly these skills, the first one due now. */
function give(tg: TestGame, skills: MonsterSkill[]): void {
  const b = bossOf(tg);
  b.rt.skills = skills;
  b.rt.skillCds = skills.map((_, i) => (i === 0 ? 0 : 9999));
  b.rt.skillGap = 0;
}

function angleOff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

const HIT: SkillAction['effects'] = [{ kind: 'damage', amount: 1 }];

describe('보스 형태: where a boss appears', () => {
  it('the classic four have no form: top centre, radius 3, no form state, not heavy — exactly as before', () => {
    for (const id of BOSS_IDS) {
      const def = getBoss(id);
      expect(def.form, id).toBeUndefined();
      expect(bossSpawnPos(def)).toBe(BOSS_POS);
      const tg = raidGame(id, { tunables: CALM });
      const b = bossOf(tg);
      expect(b.pos).toEqual(BOSS_POS);
      expect(b.rt.form).toBeUndefined();
      expect(isHeavy(b)).toBe(false);
      expect(b.rt.lockTime).toBe(0);
    }
  });

  it('6 fixed · 8 roaming · 3 relocating · 3 arena', () => {
    const count: Record<string, number> = {};
    for (const b of BOSSES) count[bossFormOf(b)] = (count[bossFormOf(b)] ?? 0) + 1;
    expect(count).toEqual({ fixed: 6, roaming: 8, relocating: 3, arena: 3 });
  });

  it.each(MOVING)('%s: appears inside the box at its spawn / first seat, stands 1 s in its entrance pose, then acts', id => {
    const def = getBoss(id);
    const tg = raidGame(id, { hpMult: 50, tunables: CALM });
    const b = bossOf(tg);
    const form = bossFormOf(def);
    const want = form === 'relocating' ? { x: def.spots![0].x, y: def.spots![0].y } : (def.spawn ?? def.move!.waypoints![0]);
    expect(b.pos).toEqual(want);
    expect(inBossBox(b.pos)).toBe(true);
    expect(b.rt.form?.form).toBe(form);
    expect(isHeavy(b)).toBe(form !== 'relocating');
    expect(b.anim).toBe('appear');
    expect(b.rt.lockTime).toBeCloseTo(BOSS_FORM.entrance, 6);
    silence(tg);
    const at = { ...b.pos };
    const facing = b.facing;
    advance(tg, BOSS_FORM.entrance - 0.1);
    expect(b.pos).toEqual(at);
    expect(b.facing).toBe(facing);
    expect(eventsOf(tg, 'attack').filter(e => e.sourceId === b.id)).toHaveLength(0);
  });

  it('a relocating boss faces the way its seat says; the fixed new bosses (노래방 · 서랍) are set pieces like the classic ones', () => {
    for (const id of ['dead_monitor', 'endless_meeting', 'xray_machine']) {
      const tg = raidGame(id, { tunables: CALM });
      const want = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[getBoss(id).spots![0].facing];
      expect(angleOff(bossOf(tg).facing, want), id).toBeLessThan(1e-9);
      expect(bossOf(tg).rt.stationary).toBe(true);
    }
    for (const id of ['karaoke_room', 'morgue_drawers']) {
      const tg = raidGame(id, { tunables: CALM });
      expect(bossOf(tg).pos).toEqual(BOSS_POS);
      expect(bossOf(tg).rt.form).toBeUndefined();
    }
  });
});

describe('보스 형태: a pursuing boss reaches its target anywhere', () => {
  const PURSUERS = BOSSES.filter(b => b.move?.mode === 'pursue' && !b.move.axis).map(b => b.id);
  const CORNERS: Vec2[] = [{ x: 0.5, y: 0.5 }, { x: 23.5, y: 0.5 }, { x: 0.5, y: 11.5 }, { x: 23.5, y: 11.5 }, { x: 12, y: 11.5 }, { x: 12, y: 0.5 }];

  it.each(PURSUERS)('%s: walks to a character in every corner and hits it, never leaving its box', id => {
    for (const corner of CORNERS) {
      const tg = quiet(id);
      const b = bossOf(tg);
      const me = active(tg);
      pin(me, corner);
      b.targetId = me.id;
      let hit = false;
      for (let t = 0; t < 40 * 30 && !hit; t++) {
        tick(tg.w);
        expect(inBossBox(b.pos, 1e-6)).toBe(true);
        hit = tg.game.drainEvents().some(e => e.type === 'attack' && e.sourceId === b.id && e.targetId === me.id);
      }
      expect(hit, `${id} reaches (${corner.x}, ${corner.y})`).toBe(true);
    }
  });

  it('a melee character walks up to a roaming boss and hits it; it is pushed out of the heavy body, the boss is not moved', () => {
    const tg = quiet('defibrillator');
    const b = bossOf(tg);
    const me = active(tg);
    me.pos = { x: 3, y: 9 };
    b.rt.lockTime = 9999; // the boss just stands
    const at = { ...b.pos };
    advance(tg, 12);
    expect(eventsOf(tg, 'damage').some(e => e.targetId === b.id)).toBe(true);
    expect(b.pos).toEqual(at);
    // overlap: only the character gives way
    me.pos = { x: b.pos.x + 0.3, y: b.pos.y };
    me.rt.lockTime = 9999;
    advance(tg, 0.5);
    expect(b.pos).toEqual(at);
    expect(Math.hypot(me.pos.x - b.pos.x, me.pos.y - b.pos.y)).toBeGreaterThanOrEqual(b.radius + me.radius - 0.01);
  });
});

describe('보스 형태: turning, the walk cone and the cast lock', () => {
  it('turns at its turn rate (파쇄기 60°/s) and walks only once the way is within the walk cone', () => {
    const tg = quiet('shredder_maw');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 12, y: 6 };
    b.facing = 0; // looking right
    pin(me, { x: 4, y: 6 }); // straight behind it
    b.targetId = me.id;
    const at = { ...b.pos };
    advance(tg, 1);
    // 1 s at 60°/s: turned 60°, still 120° off — it has not taken a step
    expect(angleOff(b.facing, 0) / DEG).toBeCloseTo(60, 0);
    expect(b.pos).toEqual(at);
    advance(tg, 1.2); // 132° turned: within 60° of the way → walking
    expect(b.pos.x).toBeLessThan(at.x);
    advance(tg, 1.5);
    expect(angleOff(b.facing, Math.PI)).toBeLessThan(1e-6);
  });

  it('a default boss turns 180°/s; enraged it turns and walks 1.25× as fast', () => {
    const turned = (enraged: boolean): { deg: number; speed: number } => {
      const tg = quiet('empty_beds');
      const b = bossOf(tg);
      b.enraged = enraged;
      b.pos = { x: 12, y: 6 };
      b.facing = 0;
      pin(active(tg), { x: 4, y: 6 });
      b.targetId = active(tg).id;
      advance(tg, 0.5);
      return { deg: angleOff(b.facing, 0) / DEG, speed: effStats(tg.w, b).moveSpeed };
    };
    // no turnRate on this boss: BOSS_FORM.turnRate (180°/s)
    expect(turned(false).deg).toBeCloseTo(90, 0);
    expect(turned(true).deg).toBeCloseTo(112.5, 0);
    expect(turned(true).speed).toBeCloseTo(turned(false).speed * BOSS_FORM.enrageMove, 6);
  });

  const twoBeats: MonsterSkill = {
    id: 'syn_two', name: '시험 두 박자', cooldown: 99,
    action: { center: 'target', area: { shape: 'circle', radius: 1 }, affects: 'enemies', delay: 1, effects: HIT },
    extra: [{ center: 'target', area: { shape: 'circle', radius: 1 }, affects: 'enemies', delay: 2.5, effects: HIT }],
  };

  it('a roaming boss stands — and keeps its facing — until the LAST part of a skill landed', () => {
    const tg = quiet('washer_drum');
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 4, y: 9 });
    b.pos = { x: 18, y: 5 };
    b.targetId = me.id;
    give(tg, [twoBeats]);
    tick(tg.w);
    expect(b.rt.lockTime).toBeCloseTo(2.5, 1);
    const at = { ...b.pos };
    const facing = b.facing;
    me.pos = { x: 20, y: 9 }; // the target moves to its other side: it does not turn after it
    advance(tg, 2.3);
    expect(b.pos).toEqual(at);
    expect(b.facing).toBe(facing);
    advance(tg, 1.5);
    expect(b.pos).not.toEqual(at); // free again: it walks
  });

  it('the lock follows the 보스 예고 시간 배율; a `castMove` skill and a `move.castMove` boss (달) keep walking', () => {
    const tg = quiet('washer_drum', { bossTelegraphMult: 2 });
    const b = bossOf(tg);
    pin(active(tg), { x: 4, y: 9 });
    b.targetId = active(tg).id;
    give(tg, [twoBeats]);
    tick(tg.w);
    expect(b.rt.lockTime).toBeCloseTo(5, 1);

    const free = quiet('washer_drum');
    const fb = bossOf(free);
    pin(active(free), { x: 4, y: 9 });
    fb.pos = { x: 18, y: 5 };
    fb.targetId = active(free).id;
    give(free, [{ ...twoBeats, id: 'syn_walk', castMove: true }]);
    tick(free.w);
    expect(fb.rt.lockTime).toBe(0);
    const at = { ...fb.pos };
    advance(free, 1);
    expect(fb.pos).not.toEqual(at);

    const moon = quiet('inverted_moon');
    const mb = bossOf(moon);
    give(moon, [twoBeats]);
    tick(moon.w);
    expect(mb.rt.lockTime).toBe(0);
    const mat = { ...mb.pos };
    advance(moon, 1);
    expect(Math.hypot(mb.pos.x - mat.x, mb.pos.y - mat.y)).toBeGreaterThan(0.5);
  });

  it('groggy: the boss stops where it is and does not turn; it walks again when it stands up', () => {
    const tg = raidGame('washer_drum', { hpMult: 50, tunables: { invincible: true } });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 3, y: 9 });
    b.targetId = me.id;
    advance(tg, 0.5);
    expect(forceGroggy(tg.w)).toBe(true);
    const at = { ...b.pos };
    const facing = b.facing;
    me.pos = { x: 21, y: 9 };
    advance(tg, tg.w.tunables.bossGroggyDuration - 0.2);
    expect(b.pos).toEqual(at);
    expect(b.facing).toBe(facing);
    advance(tg, 2);
    expect(b.pos).not.toEqual(at);
  });
});

describe('보스 형태: heavy bodies and the box', () => {
  it('knock-back, pull and a directed push do not move a roaming / arena boss; a relocating one neither', () => {
    for (const id of ['washer_drum', 'answering_pencil', 'dead_monitor']) {
      const tg = quiet(id);
      const b = bossOf(tg);
      const me = active(tg);
      b.rt.lockTime = 9999;
      const at = { ...b.pos };
      const ctx = { ...unitCtx(tg.w, me, 'syn_push', '시험'), team: 'ally' as const };
      for (const eff of [{ kind: 'knockback' as const, distance: 4 }, { kind: 'pull' as const, distance: 4 }, { kind: 'knockback' as const, distance: 4, dir: 'down' as const }]) {
        const push: SkillAction = { center: 'point', area: { shape: 'circle', radius: 30 }, affects: 'enemies', effects: [eff] };
        expect(applyEffects(tg.w, ctx, push, { x: b.pos.x + 1, y: b.pos.y + 1 }, me.pos, push.area)).toBeGreaterThan(0);
        expect(b.pos, `${id} ${eff.kind}`).toEqual(at);
      }
    }
  });

  it('stun never lands on a boss of any form (the groggy is the one exception)', () => {
    for (const id of ['washer_drum', 'answering_pencil', 'dead_monitor', 'karaoke_room']) {
      const tg = quiet(id);
      expect(applyStatus(bossOf(tg), 'stun', 2, 0, 0, 'drag'), id).toBe(false);
      expect(applyStatus(bossOf(tg), 'root', 2, 0, 0, 'drag'), id).toBe(false);
      expect(applyStatus(bossOf(tg), 'tether', 2, 3, 0, 'drag', { anchor: { x: 1, y: 1 } }), id).toBe(false);
    }
  });

  it('a boss set outside its box is brought back by its next step', () => {
    const tg = quiet('washer_drum');
    const b = bossOf(tg);
    pin(active(tg), { x: 23, y: 11.5 });
    b.targetId = active(tg).id;
    b.pos = { x: 23.5, y: 11.8 };
    advance(tg, 0.2);
    expect(inBossBox(b.pos)).toBe(true);
  });
});

describe('보스 형태: taunt (도발)', () => {
  const taunt = (tg: TestGame, by: SimEntity, seconds = 3): boolean => applyStatus(bossOf(tg), 'taunt', seconds, 0, 0, 'drag', { sourceEntityId: by.id });

  it('only a roaming boss can be taunted: fixed, relocating and arena bosses (and every classic one) are immune', () => {
    for (const b of BOSSES) {
      const tg = quiet(b.id, {}, bossFormOf(b) === 'fixed' ? 0.2 : 1.1);
      const want = bossFormOf(b) === 'roaming';
      expect(isTauntable(bossOf(tg)), b.id).toBe(want);
      expect(taunt(tg, active(tg)), b.id).toBe(want);
    }
  });

  it('a taunted roaming boss turns to its taunter and walks to it; when the taunt ends it cannot be taunted for 6 s', () => {
    const tg = raidGame('defibrillator', { hpMult: 50, players: [HUMAN, { ...HUMAN, name: '둘' }], tunables: CALM });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const [a, c] = [active(tg, 0), active(tg, 1)];
    pin(a, { x: 20, y: 9 });
    pin(c, { x: 3, y: 9 });
    b.pos = { x: 18, y: 6 };
    b.targetId = a.id;
    advance(tg, 0.5);
    expect(b.targetId).toBe(a.id);
    expect(taunt(tg, c, 3)).toBe(true);
    const far = Math.hypot(b.pos.x - c.pos.x, b.pos.y - c.pos.y);
    advance(tg, 2.5);
    expect(b.targetId).toBe(c.id);
    expect(Math.hypot(b.pos.x - c.pos.x, b.pos.y - c.pos.y)).toBeLessThan(far - 1.5);
    advance(tg, 0.7); // the taunt ran out
    expect(hasStatus(b, 'taunt')).toBe(false);
    expect(b.rt.form!.tauntImmune).toBeGreaterThan(5);
    expect(taunt(tg, a)).toBe(false);
    advance(tg, 5);
    expect(taunt(tg, a)).toBe(false);
    advance(tg, 1.2);
    expect(taunt(tg, a)).toBe(true);
  });

  it('the taunt ends at once when the taunter leaves the field (swap), and the immunity starts then', () => {
    const tg = quiet('defibrillator');
    const b = bossOf(tg);
    const me = active(tg);
    expect(taunt(tg, me, 5)).toBe(true);
    advance(tg, 0.3);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 4, y: 9 } }).ok).toBe(true);
    advance(tg, 0.2);
    expect(hasStatus(b, 'taunt')).toBe(false);
    expect(b.rt.form!.tauntImmune).toBeGreaterThan(5);
  });

  it('a patrol boss (커피 머신) leaves its route for the taunter and heads for the nearest route point afterwards', () => {
    const tg = quiet('coffee_machine');
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 8 });
    advance(tg, 2); // on its way along the top edge
    expect(b.pos.y).toBeCloseTo(3, 6);
    expect(taunt(tg, me, 2.5)).toBe(true);
    advance(tg, 2.4);
    expect(b.pos.y).toBeGreaterThan(3.5); // off the route, toward the taunter
    advance(tg, 0.3);
    const wps = getBoss('coffee_machine').move!.waypoints!;
    const nearest = wps.map((p, i) => ({ i, d: Math.hypot(p.x - b.pos.x, p.y - b.pos.y) })).sort((x, y) => x.d - y.d)[0].i;
    expect(b.rt.form!.wp).toBe(nearest);
    advance(tg, 12);
    expect(wps.some(p => Math.abs(p.x - b.pos.x) < 0.05 || Math.abs(p.y - b.pos.y) < 0.05)).toBe(true); // back on the square
  });
});

describe('보스 형태: move modes', () => {
  it('patrol (커피 머신): rounds its four points in order, resting 0.6 s on each, shooting on the move; nobody pulls it off', () => {
    const tg = quiet('coffee_machine');
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    const wps = getBoss('coffee_machine').move!.waypoints!;
    const seen: number[] = [];
    let moved = 0;
    let last = { ...b.pos };
    for (let t = 0; t < 45 * 30; t++) {
      tick(tg.w);
      moved += Math.hypot(b.pos.x - last.x, b.pos.y - last.y);
      last = { ...b.pos };
      const i = wps.findIndex(p => Math.hypot(p.x - b.pos.x, p.y - b.pos.y) < 1e-6);
      if (i >= 0 && seen[seen.length - 1] !== i) seen.push(i);
    }
    expect(seen.join('')).toContain('12301');
    expect(moved).toBeGreaterThan(40);
    expect(eventsOf(tg, 'attack').filter(e => e.sourceId === b.id).length).toBeGreaterThan(5);
  });

  it('path (달 · 에스컬레이터의 손): the same round, and a taunt does nothing', () => {
    for (const id of ['inverted_moon', 'reverse_escalator']) {
      const tg = quiet(id);
      const b = bossOf(tg);
      const wps = getBoss(id).move!.waypoints!;
      expect(applyStatus(b, 'taunt', 3, 0, 0, 'drag', { sourceEntityId: active(tg).id })).toBe(false);
      advance(tg, (Math.hypot(wps[1].x - wps[0].x, wps[1].y - wps[0].y) + 0.5) / getBoss(id).stats.moveSpeed);
      expect(Math.hypot(b.pos.x - wps[1].x, b.pos.y - wps[1].y), id).toBeLessThan(1);
    }
  });

  it('keepAway (천둥 안테나): backs off when someone is inside 4 cells, closes in beyond 7, and shoots all the while', () => {
    const tg = quiet('thunder_antenna');
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { x: 12, y: 6 };
    pin(me, { x: 10, y: 6 });
    b.targetId = me.id;
    advance(tg, 2);
    expect(b.pos.x).toBeGreaterThan(13.9); // 4 cells from the character
    expect(Math.hypot(b.pos.x - me.pos.x, b.pos.y - me.pos.y)).toBeGreaterThanOrEqual(4 - 0.05);
    me.pos = { x: 2, y: 6 };
    advance(tg, 6);
    expect(Math.hypot(b.pos.x - me.pos.x, b.pos.y - me.pos.y)).toBeLessThanOrEqual(7.05);
    expect(eventsOf(tg, 'attack').filter(e => e.sourceId === b.id).length).toBeGreaterThan(2);
    // cornered: it stops at the box and keeps shooting
    b.pos = { x: 21, y: 6 };
    me.pos = { x: 19, y: 6 };
    clearEvents(tg);
    advance(tg, 4);
    expect(b.pos.x).toBeCloseTo(BOSS_FORM.box.xMax, 6);
    expect(eventsOf(tg, 'attack').filter(e => e.sourceId === b.id).length).toBeGreaterThan(1);
  });

  it('axis (인형 뽑기 기계): lines its x up first, then moves along y only; it goes for the FARTHEST character', () => {
    const tg = raidGame('claw_machine', { hpMult: 50, players: [HUMAN, { ...HUMAN, name: '둘' }], tunables: CALM });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const [near, far] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 6, y: 3 };
    pin(near, { x: 7, y: 5 });
    pin(far, { x: 19, y: 11.5 }); // 8.5 below once the x is lined up: out of its range 3 → it comes down
    b.rt.form!.retargetIn = 0; // picks again now
    advance(tg, 0.3);
    expect(b.targetId).toBe(far.id);
    b.rt.form!.retargetIn = 9999; // keep this target for the walk
    let xPhase = true;
    for (let t = 0; t < 12 * 30; t++) {
      const before = { ...b.pos };
      tick(tg.w);
      const dx = Math.abs(b.pos.x - before.x);
      const dy = Math.abs(b.pos.y - before.y);
      expect(dx < 1e-9 || dy < 1e-9, 'one axis at a time').toBe(true);
      if (dy > 1e-9) xPhase = false;
      if (xPhase && dx > 1e-9) expect(Math.abs(far.pos.x - before.x)).toBeGreaterThan(BOSS_FORM.axisSnap);
    }
    expect(Math.abs(b.pos.x - far.pos.x)).toBeLessThanOrEqual(BOSS_FORM.axisSnap + 1e-6);
    expect(xPhase).toBe(false);
  });

  it('retarget: a `farthest` boss picks again every `retarget` s — never while it is casting', () => {
    const tg = raidGame('washer_drum', { hpMult: 50, players: [HUMAN, { ...HUMAN, name: '둘' }], tunables: CALM });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const [a, c] = [active(tg, 0), active(tg, 1)];
    b.pos = { x: 12, y: 6 };
    pin(a, { x: 3, y: 6 });
    pin(c, { x: 18, y: 6 });
    b.rt.form!.retargetIn = 0;
    advance(tg, 0.1);
    expect(b.targetId).toBe(a.id); // 9 cells away vs 6
    a.pos = { x: 11, y: 9 };
    c.pos = { x: 22, y: 9 };
    advance(tg, 4);
    expect(b.targetId).toBe(a.id); // held: 5 s have not passed
    advance(tg, 1.2);
    expect(b.targetId).toBe(c.id);
  });

  it('보스 이동 속도 배율: ×2 walks twice as far in the same time; a fixed boss and a mid boss are not touched', () => {
    const walked = (mult: number): number => {
      const tg = quiet('washer_drum', { bossMoveMult: mult });
      const b = bossOf(tg);
      pin(active(tg), { x: 2, y: 10 });
      b.pos = { x: 20, y: 4 };
      b.facing = Math.atan2(6, -18);
      b.targetId = active(tg).id;
      advance(tg, 2);
      return Math.hypot(b.pos.x - 20, b.pos.y - 4);
    };
    expect(walked(2)).toBeCloseTo(walked(1) * 2, 1);
    expect(walked(0.5)).toBeCloseTo(walked(1) * 0.5, 1);
    const tg = raidGame('overtime_lord', { tunables: { ...CALM, bossMoveMult: 2 } });
    expect(effStats(tg.w, bossOf(tg)).moveSpeed).toBe(0);
  });
});

describe('보스 형태: a relocating boss and its seats', () => {
  const hop: SkillAction = relocateTo({ radius: 3, delay: 1.2, effects: HIT });

  function castHop(tg: TestGame): void {
    const b = bossOf(tg);
    startAction(tg.w, unitCtx(tg.w, b, 'syn_hop', '시험 이동'), hop);
  }

  it.each(['dead_monitor', 'endless_meeting', 'xray_machine'])('%s: moves to the next seat in order, faces the way it says, and comes round to the first again', id => {
    const tg = quiet(id);
    const b = bossOf(tg);
    const spots = getBoss(id).spots!;
    const FACE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
    for (let k = 1; k <= spots.length; k++) {
      const to = spots[k % spots.length];
      const from = { ...b.pos };
      castHop(tg);
      // the warning sits on the seat it will take, tagged 'arrive'; the boss is still on the old one (and can be hit)
      const tele = tg.w.state.telegraphs[tg.w.state.telegraphs.length - 1];
      expect(tele.center).toEqual({ x: to.x, y: to.y });
      expect(tele.motif).toBe('arrive');
      advance(tg, 1.0);
      expect(b.pos).toEqual(from);
      clearEvents(tg);
      advance(tg, 0.3);
      expect(b.pos).toEqual({ x: to.x, y: to.y });
      expect(angleOff(b.facing, FACE[to.facing])).toBeLessThan(1e-9);
      expect(b.rt.form!.spot).toBe(k % spots.length);
      expect(eventsOf(tg, 'blink').filter(e => e.entityId === b.id)).toHaveLength(1);
      expect(b.anim).toBe('appear');
      advance(tg, 0.6);
    }
  });

  it('the landing hits around the NEW seat: a character there is hit, one next to the old seat is not', () => {
    const tg = raidGame('endless_meeting', { hpMult: 50, players: [HUMAN, { ...HUMAN, name: '둘' }], tunables: { bossGroggyThreshold: 0 } });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const [atNew, atOld] = [active(tg, 0), active(tg, 1)];
    const spots = getBoss('endless_meeting').spots!;
    pin(atNew, { x: spots[1].x - 2.2, y: spots[1].y });
    pin(atOld, { x: spots[0].x, y: spots[0].y + 2.4 });
    b.rt.attackCd = 9999;
    tg.w.state.projectiles.length = 0; // a shot already in the air is not the landing
    clearEvents(tg);
    castHop(tg);
    advance(tg, 1.4);
    const hits = eventsOf(tg, 'damage').map(e => e.targetId);
    expect(hits).toContain(atNew.id);
    expect(hits).not.toContain(atOld.id);
  });

  it('a groggy during the warning cancels the move: the boss stays, and its next move goes to the same seat', () => {
    const tg = raidGame('dead_monitor', { hpMult: 50, tunables: { invincible: true } });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const spots = getBoss('dead_monitor').spots!;
    castHop(tg);
    advance(tg, 0.5);
    expect(forceGroggy(tg.w)).toBe(true);
    advance(tg, 1.5);
    expect(b.pos).toEqual({ x: spots[0].x, y: spots[0].y });
    expect(tg.w.state.telegraphs).toHaveLength(0);
    advance(tg, tg.w.tunables.bossGroggyDuration);
    castHop(tg);
    advance(tg, 1.3);
    expect(b.pos).toEqual({ x: spots[1].x, y: spots[1].y });
  });
});
