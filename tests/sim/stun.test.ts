import { describe, expect, it } from 'vitest';
import { CHARACTERS, PETS, getMonster } from '../../src/data';
import { createUnit } from '../../src/sim/entities';
import { applyStatus, hasStatus } from '../../src/sim/status';
import { cleanState } from '../../server/snapshot';
import type { SkillAction } from '../../src/types';
import { active, advance, eventsOf, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const stunDurations = (actions: readonly SkillAction[]) =>
  actions.flatMap(a => a.effects.filter(e => e.kind === 'status' && e.status === 'stun').map(e => (e as { duration: number }).duration));

// 기획 4차: 기절하면 공격 대기시간이 멈춤.
describe('stun pauses the attack timer', () => {
  it('a stunned monster keeps its remaining attack wait and cannot hit right after the stun ends', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    m.rt.attackCd = 1.5;
    applyStatus(m, 'stun', 2, 0, null);
    advance(tg, 1.9);
    expect(m.rt.attackCd).toBeCloseTo(1.5, 5);
    advance(tg, 0.5); // stun over after 2.0 s → 0.4 s of ticking
    expect(m.rt.attackCd).toBeGreaterThan(1.0);
    expect(m.rt.attackCd).toBeLessThan(1.5);
  });

  it('an unstunned unit still counts down normally', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const m = spawnAt(tg, 'golem', { x: 30, y: 6 });
    m.rt.attackCd = 1.5;
    advance(tg, 1);
    expect(m.rt.attackCd).toBeCloseTo(0.5, 1);
  });

  it('a stunned character keeps its attack wait, cannot attack, and its normal-skill timer keeps running', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    advance(tg, 2); // appear lock over
    const c = active(tg);
    const p = tg.w.state.players[0];
    const m = p.party[p.activeIndex!];
    const mon = spawnAt(tg, 'golem', { x: c.pos.x + 1, y: c.pos.y });
    mon.rt.attackCd = 99; // dummy target that never swings back
    c.rt.attackCd = 1.2;
    m.normalCooldownRemaining = 3;
    c.invulnTime = 0;
    expect(applyStatus(c, 'stun', 1, 0, null)).toBe(true);
    const hpBefore = mon.hp;
    advance(tg, 1); // exactly 30 ticks
    expect(c.rt.attackCd).toBeCloseTo(1.2, 6);
    expect(m.normalCooldownRemaining).toBeCloseTo(2, 1);
    expect(mon.hp).toBe(hpBefore);
    expect(hasStatus(c, 'stun')).toBe(false);
    advance(tg, 0.5);
    expect(c.rt.attackCd).toBeCloseTo(0.7, 1);
  });

  it('the pause is exactly the stun length (re-stun extends it)', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const g = spawnAt(tg, 'golem', { x: 30, y: 6 });
    g.rt.attackCd = 5;
    applyStatus(g, 'stun', 0.3, 0, null);
    advance(tg, 0.2);
    applyStatus(g, 'stun', 1, 0, null); // refreshed to 1 s
    advance(tg, 1);
    expect(g.rt.attackCd).toBeCloseTo(5, 6);
    advance(tg, 1);
    expect(g.rt.attackCd).toBeCloseTo(4, 1);
  });

  it('mid boss (ogre) is stunnable: attack wait paused, its skill cooldown keeps running (assumption)', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const o = spawnAt(tg, 'ogre', { x: 30, y: 6 });
    o.rt.attackCd = 1.5;
    o.rt.skillCds[0] = 3;
    expect(applyStatus(o, 'stun', 2, 0, null)).toBe(true);
    advance(tg, 2);
    expect(o.rt.attackCd).toBeCloseTo(1.5, 6);
    expect(o.rt.skillCds[0]).toBeCloseTo(1, 1);
  });

  it('the floor-5 boss is immune: no stun, attack timer never paused', () => {
    const tg = makeGame({ tunables: { invincible: true }, startFloor: 5 });
    const boss = tg.w.state.entities.find(e => e.tier === 'boss')!;
    expect(boss).toBeTruthy();
    boss.rt.attackCd = 2;
    expect(applyStatus(boss, 'stun', 2, 0, null)).toBe(false);
    expect(hasStatus(boss, 'stun')).toBe(false);
    const before = boss.rt.attackCd;
    advance(tg, 0.5);
    // it may have attacked in between (reset to 1/atkSpeed); either way it was not frozen
    expect(boss.rt.attackCd).not.toBeCloseTo(before, 3);
  });

  it('ogre slam (0.8 s) on a character pauses the character too', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    advance(tg, 2);
    const c = active(tg);
    c.invulnTime = 0;
    const o = spawnAt(tg, 'ogre', { x: c.pos.x + 1.5, y: c.pos.y });
    o.rt.skillCds[0] = 0;
    o.rt.skillGap = 0;
    let stunnedTicks = 0;
    let minCd = Infinity;
    let maxCd = -Infinity;
    for (let i = 0; i < 30 * 4; i++) {
      advance(tg, 1 / 30);
      if (hasStatus(c, 'stun')) {
        stunnedTicks++;
        minCd = Math.min(minCd, c.rt.attackCd);
        maxCd = Math.max(maxCd, c.rt.attackCd);
      }
    }
    expect(stunnedTicks).toBeGreaterThan(20);
    expect(maxCd - minCd).toBeLessThan(1e-9);
  });

  it('a summon (golem turret pet) obeys the same rule', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const t = createUnit(tg.w, getMonster('golem'), { x: 20, y: 6 }, 'ally', { kind: 'summon', ownerPlayer: 0, expiresIn: 30, hpMult: 1, atkMult: 1 });
    t.rt.attackCd = 1;
    applyStatus(t, 'stun', 1, 0, null);
    advance(tg, 1);
    expect(t.rt.attackCd).toBeCloseTo(1, 6);
  });

  it('wire: attack timers stay server-side; the stun status (what clients draw) is on the snapshot', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    quietFloor(tg);
    const g = spawnAt(tg, 'golem', { x: 30, y: 6 });
    applyStatus(g, 'stun', 1, 0, null);
    const s = cleanState(tg.w.state);
    const wg = s.entities.find(e => e.id === g.id)!;
    expect((wg as unknown as { rt?: unknown }).rt).toBeUndefined();
    expect(wg.statuses.find(x => x.id === 'stun')?.remaining).toBe(1);
  });

  it('descriptions: every stun duration in the data is written in its description, and nothing else is called 기절', () => {
    const bad: string[] = [];
    const check = (label: string, desc: string, durs: number[]) => {
      const written = [...desc.matchAll(/(\d+(?:\.\d+)?)초 기절|기절 (\d+(?:\.\d+)?)초/g)].map(x => Number(x[1] ?? x[2]));
      const want = [...new Set(durs)].sort();
      const got = [...new Set(written)].sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(`${label}: data ${want} vs text ${got} — ${desc}`);
    };
    for (const c of CHARACTERS) {
      check(`${c.id}.normal`, c.normal.description, stunDurations(c.normal.actions));
      check(`${c.id}.drag`, c.drag.description, stunDurations(c.drag.actions));
      check(`${c.id}.ult`, c.ult.description, stunDurations(c.ult.actions));
    }
    for (const p of PETS) check(`pet ${p.id}`, p.description, stunDurations([p.action]));
    expect(bad).toEqual([]);
  });
});

// A stun during a monster's telegraphed wind-up (오우거 내려찍기 1.2초, 리치 저주 장판 0.8초) breaks it: the red area goes
// away and nothing lands; the skill's cooldown stays spent. (Bosses cannot be stunned; characters' own casts always land.)
describe('stun breaks a monster wind-up', () => {
  /** Ogre next to the field character with its slam ready; ticks until the slam's telegraph is up. */
  function slamWindup(tg: TestGame) {
    quietFloor(tg);
    advance(tg, 2);
    const c = active(tg);
    c.invulnTime = 0;
    const o = spawnAt(tg, 'ogre', { x: c.pos.x + 1.5, y: c.pos.y });
    o.rt.skillCds[0] = 0;
    o.rt.skillGap = 0;
    for (let i = 0; i < 90 && tg.w.state.telegraphs.length === 0; i++) advance(tg, 1 / 30);
    expect(tg.w.state.telegraphs.filter(t => t.team === 'enemy')).toHaveLength(1);
    return { c, o };
  }

  it('a stunned ogre loses its slam: telegraph gone, no hit, no stun on the character, cooldown still spent', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    const { c, o } = slamWindup(tg);
    advance(tg, 0.3); // mid wind-up
    expect(applyStatus(o, 'stun', 0.3, 0, null)).toBe(true);
    advance(tg, 1 / 30);
    expect(tg.w.state.telegraphs).toHaveLength(0);
    expect(o.rt.lockTime).toBe(0);
    // render cue ("끊김!" over the ogre, no impact flash for that telegraph)
    const ints = eventsOf(tg, 'interrupt');
    expect(ints).toHaveLength(1);
    expect(ints[0]).toMatchObject({ sourceId: o.id, name: getMonster('ogre').skills![0].name });
    let stunned = false;
    for (let i = 0; i < 60; i++) {
      advance(tg, 1 / 30);
      stunned ||= hasStatus(c, 'stun');
    }
    expect(stunned).toBe(false);
    expect(o.rt.skillCds[0]).toBeGreaterThan(4);
  });

  it('without the stun the same slam lands (control)', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    const { c } = slamWindup(tg);
    let stunned = false;
    for (let i = 0; i < 60; i++) {
      advance(tg, 1 / 30);
      stunned ||= hasStatus(c, 'stun');
    }
    expect(stunned).toBe(true);
  });

  it('a stun after the slam landed changes nothing (no stale wind-up)', () => {
    const tg = makeGame({ tunables: { invincible: true } });
    const { c, o } = slamWindup(tg);
    advance(tg, 1.3); // landed
    expect(hasStatus(c, 'stun')).toBe(true);
    const pendingBefore = tg.w.pending.length;
    applyStatus(o, 'stun', 0.5, 0, null);
    advance(tg, 1 / 30);
    expect(tg.w.pending.length).toBeLessThanOrEqual(pendingBefore);
    expect(o.rt.windup).toBeNull();
    expect(eventsOf(tg, 'interrupt')).toHaveLength(0);
  });
});
