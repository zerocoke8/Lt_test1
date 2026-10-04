// 기획 8차 mechanics: 'fan' area, monster charge / blink, onDeath splits (clear + alive cap), boss phases, monster heals,
// stun vs. the new wind-ups, multi-part monster skills (`extra`), and determinism on the new zones.
import { describe, expect, it } from 'vitest';
import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { BOSSES, getBoss, getMonster, MONSTERS } from '../../src/data';
import { createGame } from '../../src/sim';
import { applyDamage, killEntity } from '../../src/sim/combat';
import { aimSamples, areaExtent, chargeEnd, containsPoint, hitsArea, scaleArea } from '../../src/sim/geometry';
import { effStats } from '../../src/sim/stats';
import { applyStatus } from '../../src/sim/status';
import { tick } from '../../src/sim/game';
import { monsterCdMult } from '../../src/sim/units';
import type { AreaShape, GameSetup, SkillAction } from '../../src/types';
import { active, advance, clearEvents, eventsOf, HUMAN, HUMAN2, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const ALLY = { casterId: null, team: 'ally' as const, player: 0, source: 'basic' as const, isDrag: false };

/** Make a unit unkillable and keep it from acting on its own (skills / basic attacks) unless asked. */
function tank(e: { hp: number; maxHp: number; rt: { base: { maxHp: number } } }): void {
  e.hp = e.maxHp = e.rt.base.maxHp = 1e9;
}

/** Freeze every monster skill and basic attack of `e`; then arm skill `i` to fire on the next tick. */
function armSkill(e: ReturnType<typeof spawnAt>, i: number): void {
  e.rt.skillCds = e.rt.skillCds.map(() => 999);
  e.rt.skillCds[i] = 0;
  e.rt.skillGap = 0;
  e.rt.attackCd = 999;
}

/** My field character, far from walls, unkillable, not attacking. */
function heroAt(tg: TestGame, x: number, y: number) {
  const me = active(tg);
  me.pos = { x, y };
  me.rt.base.maxHp = 1e9;
  me.hp = me.maxHp = 1e9;
  me.rt.attackCd = 999;
  me.rt.base.moveSpeed = 0;
  me.rt.base.atk = 0;
  me.invulnTime = 0;
  me.rt.lockTime = 0;
  me.anim = 'idle';
  tg.w.state.players[0].party.forEach(m => (m.normalCooldownRemaining = 999));
  return me;
}

describe("'fan' area (기획 8차): auto-aimed sector from the caster toward the center", () => {
  const fan: AreaShape = { shape: 'fan', radius: 7, angle: 50 };
  const O = { x: 0, y: 0 };
  const C = { x: 10, y: 0 };

  it('hits inside the opening and radius, misses outside, grows by the unit radius', () => {
    expect(hitsArea(fan, C, O, { x: 5, y: 0 }, 0)).toBe(true);
    expect(hitsArea(fan, C, O, { x: 5, y: 2 }, 0)).toBe(true); // 21.8° < 25°
    expect(hitsArea(fan, C, O, { x: 5, y: 3 }, 0)).toBe(false); // 31° > 25°
    expect(hitsArea(fan, C, O, { x: 5, y: 3 }, 0.7)).toBe(true); // its body reaches the edge
    expect(hitsArea(fan, C, O, { x: 8, y: 0 }, 0)).toBe(false);
    expect(hitsArea(fan, C, O, { x: 8, y: 0 }, 1.2)).toBe(true);
    expect(hitsArea(fan, C, O, { x: -2, y: 0 }, 0)).toBe(false); // behind the caster
    // the center only aims: a fan toward +y
    expect(hitsArea(fan, { x: 0, y: 3 }, O, { x: 0, y: 6 }, 0)).toBe(true);
    expect(hitsArea(fan, { x: 0, y: 3 }, O, { x: 6, y: 0 }, 0)).toBe(false);
    // origin == center → fallback direction (caster facing)
    expect(hitsArea(fan, O, O, { x: 0, y: 4 }, 0, { x: 0, y: 1 })).toBe(true);
    expect(hitsArea(fan, O, O, { x: 4, y: 0 }, 0, { x: 0, y: 1 })).toBe(false);
  });

  it('pure helpers handle it (scale, extent, samples, contains)', () => {
    expect(scaleArea(fan, 1.5)).toEqual({ shape: 'fan', radius: 10.5, angle: 50 });
    expect(areaExtent(fan)).toBe(7);
    expect(aimSamples(fan)).toEqual([{ x: 0, y: 0 }]);
    expect(containsPoint(fan, O, { x: 3, y: 0 })).toBe(true);
  });

  it('a monster fan (눈알 줄기) telegraphs from the caster and hits the target, not an ally off to the side', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    quietFloor(tg);
    const me = heroAt(tg, 14, 6);
    const other = active(tg, 1);
    other.pos = { x: 10, y: 2.5 }; // 90° off the eye→me direction, inside 7 units
    other.rt.base.maxHp = other.hp = other.maxHp = 1e9;
    other.rt.base.moveSpeed = 0;
    other.rt.attackCd = 999;
    tg.w.state.players[1].party.forEach(m => (m.normalCooldownRemaining = 999));
    const eye = spawnAt(tg, 'eye_stalk', { x: 10, y: 6 });
    tank(eye);
    eye.targetId = me.id;
    armSkill(eye, 0);
    advance(tg, 1 / TICK_RATE);
    const t = tg.w.state.telegraphs.find(x => x.area.shape === 'fan')!;
    expect(t).toBeTruthy();
    expect(t.origin).toEqual({ x: 10, y: 6 });
    expect(t.center.x).toBeCloseTo(14);
    clearEvents(tg);
    advance(tg, 1.05);
    const hits = eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally');
    expect(hits.some(d => d.targetId === me.id)).toBe(true);
    expect(hits.some(d => d.targetId === other.id)).toBe(false);
    expect(eye.pos).toEqual({ x: 10, y: 6 }); // stationary
  });
});

describe('charge (질주 휠체어 폭주): telegraphed line, then the rush along it', () => {
  it('stands still during the wind-up, rushes the full distance, hits along the path, emits dash', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = heroAt(tg, 14, 6);
    const wc = spawnAt(tg, 'wheelchair_rush', { x: 10, y: 6 });
    tank(wc);
    wc.targetId = me.id;
    armSkill(wc, 0);
    advance(tg, 1 / TICK_RATE);
    const sk = getMonster('wheelchair_rush').skills![0];
    const t = tg.w.state.telegraphs.find(x => x.area.shape === 'line')!;
    expect(t.origin.x).toBeCloseTo(10);
    expect(t.center.x).toBeCloseTo(10 + sk.action.charge!.distance); // the path end
    expect((t.area as { length: number }).length).toBeCloseTo(sk.action.charge!.distance + wc.radius);
    clearEvents(tg);
    advance(tg, 0.9);
    expect(wc.pos.x).toBeCloseTo(10, 1); // wind-up: no walking
    expect(eventsOf(tg, 'dash')).toHaveLength(0);
    advance(tg, 0.2);
    const dash = eventsOf(tg, 'dash');
    expect(dash).toHaveLength(1);
    expect(dash[0]).toMatchObject({ entityId: wc.id, duration: sk.action.charge!.duration });
    expect(dash[0].from.x).toBeCloseTo(10, 1);
    expect(dash[0].to.x).toBeCloseTo(19, 1);
    expect(wc.pos.x).toBeGreaterThan(18.5);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id).length).toBe(1); // one hit (no basic attacks: frozen)
  });

  it('the end is clamped into the arena along the same line (never bent)', () => {
    const A = { width: 36, height: 12 };
    expect(chargeEnd({ x: 30, y: 6 }, { x: 33, y: 6 }, 9, A, 0.5)).toEqual({ x: 35.5, y: 6 });
    const e = chargeEnd({ x: 30, y: 9 }, { x: 33, y: 11 }, 9, A, 0.5);
    expect(e.y).toBeCloseTo(11.5);
    expect((e.x - 30) / (e.y - 9)).toBeCloseTo(3 / 2); // same direction
    expect(chargeEnd({ x: 5, y: 6 }, { x: 8, y: 6 }, 2, A, 0.5)).toEqual({ x: 7, y: 6 }); // up to distance only
    // in a real cast near the wall the caster stops inside, and the telegraph is just that long
    const tg = makeGame();
    quietFloor(tg);
    const me = heroAt(tg, 33, 6);
    const wc = spawnAt(tg, 'wheelchair_rush', { x: 30, y: 6 });
    tank(wc);
    wc.targetId = me.id;
    armSkill(wc, 0);
    advance(tg, 1 / TICK_RATE);
    const t = tg.w.state.telegraphs.find(x => x.area.shape === 'line')!;
    expect(t.center.x).toBeCloseTo(35.5);
    clearEvents(tg);
    advance(tg, 1.0);
    const d = eventsOf(tg, 'dash');
    expect(d).toHaveLength(1);
    expect(d[0].to.x).toBeCloseTo(35.5, 1);
    expect(d[0].to.y).toBeCloseTo(6, 1);
  });

  it('a stun during the wind-up breaks it: no rush, no hit (interrupt), the cooldown stays spent', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = heroAt(tg, 14, 6);
    const wc = spawnAt(tg, 'wheelchair_rush', { x: 10, y: 6 });
    tank(wc);
    wc.targetId = me.id;
    armSkill(wc, 0);
    advance(tg, 1 / TICK_RATE);
    clearEvents(tg);
    applyStatus(wc, 'stun', 0.5, 0, 0);
    advance(tg, 1.2);
    expect(eventsOf(tg, 'interrupt')).toHaveLength(1);
    expect(eventsOf(tg, 'dash')).toHaveLength(0);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id)).toHaveLength(0);
    expect(wc.pos.x).toBeLessThan(12); // only walked a little after the stun, no 9-unit rush
    expect(wc.rt.skillCds[0]).toBeGreaterThan(0);
  });
});

describe('blink (간호 인형 주사 바늘 / 붉은 마스크): appear next to the target, then the telegraphed hit', () => {
  it('teleports beside its target on the side it came from (blink event), stands there, then stabs', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = heroAt(tg, 15, 6);
    const doll = spawnAt(tg, 'nurse_doll', { x: 8, y: 6 });
    tank(doll);
    doll.targetId = me.id;
    armSkill(doll, 0);
    advance(tg, 1 / TICK_RATE);
    const bl = eventsOf(tg, 'blink');
    expect(bl).toHaveLength(1);
    expect(bl[0].from).toEqual({ x: 8, y: 6 });
    const gap = me.radius + doll.radius + getMonster('nurse_doll').skills![0].action.blink!.offset;
    expect(bl[0].to.x).toBeCloseTo(15 - gap, 1);
    expect(doll.pos.x).toBeCloseTo(15 - gap, 1);
    const t = tg.w.state.telegraphs.find(x => x.area.shape === 'circle')!;
    expect(t.center.x).toBeCloseTo(doll.pos.x);
    clearEvents(tg);
    advance(tg, 0.4);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id && d.amount > 30)).toHaveLength(0);
    advance(tg, 0.3);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id && d.amount > 30).length).toBe(1);
    expect(me.statuses.some(s => s.id === 'slow')).toBe(true);
  });

  it('a stun right after the blink breaks the stab', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = heroAt(tg, 15, 6);
    const mask = spawnAt(tg, 'red_mask', { x: 6, y: 6 });
    tank(mask);
    mask.targetId = me.id;
    armSkill(mask, 0);
    advance(tg, 1 / TICK_RATE);
    expect(eventsOf(tg, 'blink')).toHaveLength(1);
    clearEvents(tg);
    applyStatus(mask, 'stun', 0.5, 0, 0);
    advance(tg, 0.6);
    expect(eventsOf(tg, 'interrupt')).toHaveLength(1);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id)).toHaveLength(0);
  });

  it('stationary units never blink', () => {
    const tg = makeGame();
    quietFloor(tg);
    const me = heroAt(tg, 15, 6);
    const eye = spawnAt(tg, 'eye_stalk', { x: 10, y: 6 });
    const a: SkillAction = { center: 'self', area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [], blink: { offset: 0.2 } };
    eye.rt.skills = [{ id: 'x', name: 'x', cooldown: 5, action: a }];
    eye.rt.skillCds = [0];
    eye.targetId = me.id;
    advance(tg, 1 / TICK_RATE);
    expect(eventsOf(tg, 'blink')).toHaveLength(0);
    expect(eye.pos).toEqual({ x: 10, y: 6 });
  });
});

describe('onDeath split (복사 인간 → 복사본 ×2)', () => {
  it('the copies appear at the death spot, count toward the clear, and the floor clears only after them', () => {
    const tg = makeGame({ startFloor: 7 });
    const s = tg.w.state;
    quietFloor(tg);
    s.midBossSpawned = true;
    heroAt(tg, 30, 10);
    const cm = spawnAt(tg, 'copy_man', { x: 10, y: 6 });
    advance(tg, 1 / TICK_RATE);
    clearEvents(tg);
    killEntity(tg.w, cm, ALLY);
    const spawns = eventsOf(tg, 'spawn');
    expect(spawns).toHaveLength(2);
    const kids = s.entities.filter(e => e.defId === 'copy_mini' && e.hp > 0 && !e.rt.gone);
    expect(kids).toHaveLength(2);
    for (const k of kids) {
      expect(Math.hypot(k.pos.x - 10, k.pos.y - 6)).toBeLessThan(1.5);
      expect(k.tier).toBe('normal');
      expect(k.maxHp).toBeCloseTo(getMonster('copy_mini').stats.maxHp * s.plan.statMult);
    }
    advance(tg, 0.5);
    expect(s.phase).toBe('combat');
    expect(s.monstersAlive).toBe(2);
    killEntity(tg.w, kids[0], ALLY);
    advance(tg, 1 / TICK_RATE);
    expect(s.phase).toBe('combat');
    killEntity(tg.w, kids[1], ALLY);
    advance(tg, 1 / TICK_RATE);
    expect(s.phase).toBe('reward');
  });

  it('copies that do not fit under the alive cap wait (no clear meanwhile) and come out when there is room', () => {
    const tg = makeGame({ startFloor: 7, tunables: { maxAliveMonsters: 3 } });
    const s = tg.w.state;
    quietFloor(tg);
    s.midBossSpawned = true;
    heroAt(tg, 30, 10);
    const a = spawnAt(tg, 'slime', { x: 3, y: 3 });
    const b = spawnAt(tg, 'slime', { x: 3, y: 9 });
    for (const m of [a, b]) {
      tank(m);
      m.rt.base.moveSpeed = 0;
    }
    const cm = spawnAt(tg, 'copy_man', { x: 10, y: 6 });
    advance(tg, 1 / TICK_RATE);
    killEntity(tg.w, cm, ALLY);
    const alive = () => s.entities.filter(e => e.team === 'enemy' && e.hp > 0 && !e.rt.gone).length;
    expect(alive()).toBe(3);
    expect(tg.w.spawner.deferred).toHaveLength(1);
    killEntity(tg.w, a, ALLY);
    advance(tg, 1 / TICK_RATE);
    expect(tg.w.spawner.deferred).toHaveLength(0);
    expect(eventsOf(tg, 'spawnWarning').length).toBe(1); // a marker, like a wave
    advance(tg, 1.1);
    expect(s.entities.filter(e => e.defId === 'copy_mini' && !e.rt.gone)).toHaveLength(2);
    expect(alive()).toBeLessThanOrEqual(3);
    // nothing else clears it early: kill everything → clear
    for (const e of s.entities.filter(x => x.team === 'enemy' && !x.rt.gone)) killEntity(tg.w, e, ALLY);
    advance(tg, 1 / TICK_RATE);
    expect(s.phase).toBe('reward');
  });

  it('debug "적 전멸" clears the field without splitting', () => {
    const tg = makeGame({ startFloor: 7 });
    quietFloor(tg);
    spawnAt(tg, 'copy_man', { x: 10, y: 6 });
    spawnAt(tg, 'copy_man', { x: 12, y: 6 });
    clearEvents(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } });
    expect(eventsOf(tg, 'spawn')).toHaveLength(0);
    expect(tg.w.state.entities.filter(e => e.team === 'enemy' && !e.rt.gone)).toHaveLength(0);
  });
});

describe('boss phases (BossDef.phases)', () => {
  function bossOf(tg: TestGame) {
    return tg.w.byId.get(tg.w.state.bossId!)!;
  }

  it('crossing a threshold fires bossPhase once, puts the phase skills first in the rotation and applies its multipliers', () => {
    const tg = makeGame({ startFloor: 10, tunables: { invincible: true } });
    const boss = bossOf(tg);
    const def = getBoss('overtime_lord');
    const ph = def.phases![0];
    const aspd0 = effStats(tg.w, boss).atkSpeed;
    const cds0 = boss.rt.skillCds.slice();
    expect(boss.rt.skills.map(s => s.id)).toEqual(def.skills.map(s => s.id));
    applyDamage(tg.w, ALLY, boss, boss.hp * 0.45 / (1 - effStats(tg.w, boss).def), false); // → ~55 %
    expect(eventsOf(tg, 'bossPhase')).toHaveLength(0);
    applyDamage(tg.w, ALLY, boss, boss.maxHp * 0.1 / (1 - effStats(tg.w, boss).def), false); // → ~45 %
    const evs = eventsOf(tg, 'bossPhase');
    expect(evs).toEqual([{ type: 'bossPhase', entityId: boss.id, phase: 2, name: ph.name }]);
    expect(boss.rt.skills.map(s => s.id)).toEqual([...ph.skills!.map(s => s.id), ...def.skills.map(s => s.id)]);
    expect(boss.rt.skillCds[0]).toBe(ph.skills![0].initialDelay);
    boss.rt.skillCds.slice(1).forEach((c, i) => expect(c).toBeCloseTo(cds0[i] * ph.cooldownMult!));
    expect(effStats(tg.w, boss).atkSpeed).toBeCloseTo(aspd0 * ph.atkSpeedMult!);
    applyDamage(tg.w, ALLY, boss, boss.maxHp * 0.1, false);
    advance(tg, 1);
    expect(eventsOf(tg, 'bossPhase')).toHaveLength(1); // once
    // the opener is cast soon after (3 parts → 3 skillCast events with their delays)
    clearEvents(tg);
    boss.rt.skillGap = 0;
    advance(tg, 2.2);
    const casts = eventsOf(tg, 'skillCast').filter(c => c.skillId === ph.skills![0].id);
    expect(casts.map(c => c.delay)).toEqual([1, 1.5, 2]);
  });

  it('one big hit through two thresholds fires both phases in order; a killing blow starts none (retreat)', () => {
    const tg = makeGame({ startFloor: 15, tunables: { invincible: true } });
    const boss = bossOf(tg);
    applyDamage(tg.w, ALLY, boss, boss.maxHp * 0.8 / (1 - effStats(tg.w, boss).def), false); // → 20 %
    expect(eventsOf(tg, 'bossPhase').map(e => e.phase)).toEqual([2, 3]);
    expect(boss.rt.phase).toBe(2);
    expect(boss.rt.phaseCdMult).toBeCloseTo(0.85 * 0.7);

    const tg2 = makeGame({ startFloor: 20, tunables: { invincible: true } });
    const b2 = bossOf(tg2);
    applyDamage(tg2.w, ALLY, b2, 1e12, false);
    expect(eventsOf(tg2, 'bossPhase')).toHaveLength(0);
    advance(tg2, 1 / TICK_RATE);
    expect(eventsOf(tg2, 'bossRetreat')).toHaveLength(1);
    expect(tg2.w.state.runResult).toMatchObject({ outcome: 'victory', reason: 'cleared', floorReached: 20 }); // the rooftop: top of the building
  });

  it('phases stack with enrage (cooldowns and attack speed multiply)', () => {
    const tg = makeGame({ startFloor: 10, tunables: { invincible: true } });
    const boss = bossOf(tg);
    const def = getBoss('overtime_lord');
    const aspd0 = effStats(tg.w, boss).atkSpeed;
    tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } });
    applyDamage(tg.w, ALLY, boss, boss.maxHp * 0.6 / (1 - effStats(tg.w, boss).def), false);
    expect(monsterCdMult(boss)).toBeCloseTo(def.enrage.cooldownMult * def.phases![0].cooldownMult!);
    expect(effStats(tg.w, boss).atkSpeed).toBeCloseTo(aspd0 * def.enrage.atkSpeedMult * def.phases![0].atkSpeedMult!);
  });

  it('every boss has descending thresholds and Korean phase names', () => {
    for (const b of BOSSES) {
      const th = b.phases!.map(p => p.hpBelow);
      expect(th.length).toBeGreaterThan(0);
      for (let i = 1; i < th.length; i++) expect(th[i]).toBeLessThan(th[i - 1]);
      for (const p of b.phases!) expect(p.name).toMatch(/[가-힣]/);
    }
  });
});

describe('monster heals (링거 환자 / 수간호사): affects allies = the monsters', () => {
  it('heals hurt monsters around it, never a character and never a boss', () => {
    const tg = makeGame({ startFloor: 15, tunables: { invincible: true } });
    const s = tg.w.state;
    const boss = tg.w.byId.get(s.bossId!)!;
    boss.hp = boss.maxHp * 0.7;
    const me = heroAt(tg, 12, 9);
    me.hp = me.maxHp * 0.5;
    const z = spawnAt(tg, 'iv_zombie', { x: 12, y: 1.2 }); // right under the boss
    tank(z);
    const hurt = spawnAt(tg, 'slime', { x: 13.5, y: 1.5 });
    hurt.hp = hurt.maxHp * 0.5;
    z.targetId = me.id;
    armSkill(z, 0);
    clearEvents(tg);
    const bossHp = boss.hp;
    const meHp = me.hp;
    advance(tg, 1 / TICK_RATE);
    const heals = eventsOf(tg, 'heal');
    expect(heals.some(h => h.targetId === hurt.id)).toBe(true);
    const healEff = getMonster('iv_zombie').skills![0].action.effects[0] as { amount: number };
    expect(hurt.hp).toBeCloseTo(hurt.maxHp * (0.5 + healEff.amount));
    expect(boss.hp).toBe(bossHp);
    expect(me.hp).toBe(meHp);
  });
});

describe('content data sanity (기획 8차)', () => {
  it('every monster has a look, a Korean name and valid references; charge pairs with a line of the same length', () => {
    for (const m of [...MONSTERS, ...BOSSES]) {
      if (m.tier === 'summon') continue;
      expect(m.look, m.id).toBeTruthy();
      expect(m.name).toMatch(/[가-힣]/);
      const parts = (m.skills ?? []).flatMap(sk => [sk.action, ...(sk.extra ?? [])]);
      for (const p of (m as { phases?: { skills?: { action: SkillAction; extra?: SkillAction[] }[] }[] }).phases ?? []) {
        for (const sk of p.skills ?? []) parts.push(sk.action, ...(sk.extra ?? []));
      }
      for (const a of parts) {
        if (a.summon) expect(() => getMonster(a.summon!.unitId)).not.toThrow();
        if (a.charge) {
          expect(a.area.shape, m.id).toBe('line');
          expect((a.area as { length: number }).length).toBe(a.charge.distance);
          expect(a.delay ?? 0, `${m.id} charge is telegraphed`).toBeGreaterThan(0);
        }
        if (a.blink) expect(a.delay ?? 0, `${m.id} blink hit is telegraphed`).toBeGreaterThan(0);
      }
      if (m.onDeath?.summon) expect(getMonster(m.onDeath.summon.unitId).tier).toBe('normal');
    }
    expect(getMonster('copy_man').onDeath).toEqual({ summon: { unitId: 'copy_mini', count: 2 } });
  });
});

describe('determinism on the new zones', () => {
  function setup(seed: number, startFloor: number): GameSetup {
    return {
      seed,
      startFloor,
      tunables: { ...DEFAULT_TUNABLES },
      players: [
        { name: 'P0', isBot: true, characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] },
        { ...BOT_PRESETS[0], isBot: true },
        { ...BOT_PRESETS[1], isBot: true },
      ],
    };
  }
  function run(seed: number, floor: number, seconds: number): string {
    const g = createGame(setup(seed, floor));
    const frames = [1 / 60, 1 / 30, 0.05, 1 / 144, 0.1];
    let i = 0;
    while (g.state.time < seconds && g.state.phase === 'combat') {
      g.step(frames[i++ % frames.length]);
      g.drainEvents();
    }
    return JSON.stringify(g.state);
  }

  it.each([8, 10, 13, 15, 17, 20])('floor %i: same seed → identical state after 40 s', f => {
    expect(run(7, f, 40)).toBe(run(7, f, 40));
  });

  it('a long bot run on the rooftop keeps the invariants (no NaN, cap held, no stray telegraphs)', () => {
    const tg = makeGame({ seed: 3, startFloor: 17, players: [{ ...HUMAN, isBot: true }, { ...HUMAN2, isBot: true }] });
    const s = tg.w.state;
    for (let t = 0; t < 90 * TICK_RATE && s.phase === 'combat'; t++) {
      tick(tg.w);
      tg.game.drainEvents();
      for (const e of s.entities) {
        expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y) && Number.isFinite(e.hp)).toBe(true);
      }
      expect(s.monstersAlive).toBeLessThanOrEqual(tg.w.tunables.maxAliveMonsters + 1);
    }
  });
});

describe('onDeath action (눈알 줄기 파열)', () => {
  it('a telegraphed burst at the death spot after the unit is gone; it still lands (the caster is dead, not stunned)', () => {
    const tg = makeGame({ startFloor: 16 });
    quietFloor(tg);
    const me = heroAt(tg, 11, 6);
    const eye = spawnAt(tg, 'eye_stalk', { x: 10, y: 6 });
    advance(tg, 1 / TICK_RATE);
    clearEvents(tg);
    killEntity(tg.w, eye, ALLY);
    const od = getMonster('eye_stalk').onDeath!.action!;
    const cast = eventsOf(tg, 'skillCast');
    expect(cast).toHaveLength(1);
    expect(cast[0]).toMatchObject({ sourceId: eye.id, slot: 'monster', center: { x: 10, y: 6 }, area: od.area, delay: od.delay, team: 'enemy' });
    expect(tg.w.state.telegraphs).toHaveLength(1);
    advance(tg, (od.delay ?? 0) + 0.05);
    expect(eventsOf(tg, 'damage').filter(d => d.targetId === me.id)).toHaveLength(1);
    expect(tg.w.state.telegraphs).toHaveLength(0);
  });
});
