// 기획 13차 스킬 리뉴얼 (docs/skill-renewal.md 5장): the shared executor rules — stage events, follow, telegraphLead,
// guaranteed crits, atFire recoil, stopAtCenter, the ult cut-in guard + 'ultCast', blink chains, maxTargets,
// healPerHit, overflow shields, the woundedAlly drag pick, bench buffs, cooldown cuts for everyone, sequences that
// outlive their caster, out players, and multiplayer determinism.

import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { ULT_CUTIN } from '../../src/config';
import { CHARACTERS } from '../../src/data';
import { applyDamage } from '../../src/sim/combat';
import { charCtx } from '../../src/sim/ctx';
import { castSkill } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { applyStatus } from '../../src/sim/status';
import type { SimEntity } from '../../src/sim/world';
import type { GameEvent, PlayerSetup, SkillAction, Vec2 } from '../../src/types';
import { active, advance, clearEvents, eventsOf, killActive, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const PETS = ['frog_bomb', 'fairy_heal', 'owl_frost'];
const party = (characters: string[], name = '나', isBot = false): PlayerSetup => ({ name, isBot, characters, pets: PETS });

function game(characters = ['guardian', 'blade', 'mage'], players?: PlayerSetup[]): TestGame {
  const tg = makeGame({ players: players ?? [party(characters)] });
  quietFloor(tg);
  for (const p of tg.w.state.players) for (const m of p.party) m.normalCooldownRemaining = 999;
  return tg;
}

/** A tough enemy that never moves or acts (stun 100 s; knockback / pull still move it unless stationary). */
function dummy(tg: TestGame, pos: Vec2, id = 'golem', stationary = true): SimEntity {
  const m = spawnAt(tg, id, pos);
  m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
  m.rt.stationary = stationary;
  applyStatus(m, 'stun', 100, 0, null);
  return m;
}

/** Cast `actions` as the active character's drag (or slot) skill at `point`. */
function cast(tg: TestGame, actions: SkillAction[], point: Vec2 | null = null, slot: 'drag' | 'ult' | 'normal' = 'drag'): void {
  const e = active(tg);
  const ctx = charCtx(tg.w, e, slot, { id: `test_${slot}`, name: '시험' });
  ctx.point = point;
  castSkill(tg.w, ctx, actions);
}

/** The caster stands still and never swings (its casts keep their attack snapshot). */
function freeze(e: SimEntity): void {
  e.rt.lockTime = 999;
}

const dmgOn = (tg: TestGame, id: number) => eventsOf(tg, 'damage').filter(d => d.targetId === id);

describe('stages: skillCast carries stage + index, every landed hit emits skillStage', () => {
  it('ranger 매의 일격: volley ×3 then pierce — skillCast at the drop, skillStage per hit with the units it reached', () => {
    const tg = game(['guardian', 'ranger', 'mage']);
    const a = dummy(tg, { x: 14, y: 6 });
    const b = dummy(tg, { x: 18, y: 6 });
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    freeze(active(tg));
    const casts = eventsOf(tg, 'skillCast').filter(c => c.skillId === 'ranger_d');
    expect(casts.map(c => [c.stage, c.actionIndex, c.delay, c.hits])).toEqual([
      ['volley', 0, 0.25, 3],
      ['pierce', 1, 0.75, undefined],
    ]);
    expect(eventsOf(tg, 'skillStage')).toHaveLength(0); // nothing landed yet
    advance(tg, 1);
    const stages = eventsOf(tg, 'skillStage').filter(s => s.skillId === 'ranger_d');
    expect(stages.map(s => [s.stage, s.hit, s.hits, s.targets])).toEqual([
      ['volley', 0, 3, 2],
      ['volley', 1, 3, 2],
      ['volley', 2, 3, 2],
      ['pierce', 0, 1, 2],
    ]);
    expect(stages.every(s => s.player === 0 && s.slot === 'drag' && s.team === 'ally')).toBe(true);
    expect(dmgOn(tg, a.id)).toHaveLength(4);
    expect(dmgOn(tg, b.id)).toHaveLength(4);
  });

  it('a staged zone emits skillStage on creation and on every tick (워든 울타리)', () => {
    const tg = game(['guardian', 'warden', 'mage']);
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 10, y: 6 } });
    advance(tg, 5);
    const fence = eventsOf(tg, 'skillStage').filter(s => s.stage === 'fence');
    expect(fence.map(f => f.hit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(fence.every(f => f.hits === 8)).toBe(true);
  });

  it('monster and pet casts keep their old events (no stage, no skillStage)', () => {
    const tg = game();
    clearEvents(tg);
    tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 12, y: 6 } });
    advance(tg, 1);
    expect(eventsOf(tg, 'skillCast').filter(c => c.slot === 'pet').every(c => c.stage === undefined)).toBe(true);
    expect(eventsOf(tg, 'skillStage').filter(s => s.slot === 'pet')).toHaveLength(0);
  });
});

describe('follow: a delayed self / target beat lands where it is when it lands', () => {
  const strike = (follow: boolean): SkillAction => ({ stage: 'x', center: 'target', ...(follow ? { follow } : null), delay: 0.5, area: { shape: 'circle', radius: 0.6 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] });

  it('a moved target is still hit (and the telegraph moved with it); without follow the beat misses', () => {
    for (const follow of [true, false]) {
      const tg = game();
      const m = dummy(tg, { x: 14, y: 6 });
      active(tg).targetId = m.id;
      freeze(active(tg));
      clearEvents(tg);
      cast(tg, [strike(follow)]);
      const tele = tg.w.state.telegraphs[0];
      expect(tele.center).toEqual({ x: 14, y: 6 });
      m.pos = { x: 18, y: 8 };
      advance(tg, 0.2);
      expect(tele.center, `follow ${follow}`).toEqual(follow ? { x: 18, y: 8 } : { x: 14, y: 6 });
      advance(tg, 0.4);
      expect(dmgOn(tg, m.id).length > 0, `follow ${follow}`).toBe(follow);
    }
  });

  it("a dead target hands over to the caster's current target; with none the beat keeps the last spot", () => {
    const tg = game();
    const first = dummy(tg, { x: 14, y: 6 });
    const next = dummy(tg, { x: 20, y: 3 });
    const me = active(tg);
    me.targetId = first.id;
    cast(tg, [strike(true)]);
    first.rt.gone = true;
    me.targetId = next.id;
    clearEvents(tg);
    advance(tg, 0.6);
    expect(dmgOn(tg, next.id)).toHaveLength(1);

    const t2 = game();
    const only = dummy(t2, { x: 14, y: 6 });
    const near = dummy(t2, { x: 16.5, y: 6 });
    active(t2).targetId = only.id;
    cast(t2, [{ ...strike(true), area: { shape: 'circle', radius: 3 } }]);
    advance(t2, 0.2);
    only.pos = { x: 15, y: 6 }; // last spot it was followed to …
    advance(t2, 1 / 30);
    only.rt.gone = true; // … then it is gone and the caster has nobody else
    active(t2).targetId = null;
    active(t2).rt.lockTime = 99; // and does not pick anyone either
    clearEvents(t2);
    advance(t2, 0.4);
    expect(dmgOn(t2, near.id)).toHaveLength(1); // landed at x 15 (r 3 reaches 16.5)
  });

  it("follow re-reads the caster's attack when it lands (버서커 마무리 carries 광란 +50 %)", () => {
    const tg = game(['berserker', 'guardian', 'mage']);
    const m = dummy(tg, { x: 14, y: 6 });
    const me = active(tg);
    me.pos = { x: 13, y: 6 };
    me.rt.base.critChance = 0;
    const base = effStats(tg.w, me).atk;
    cast(tg, [{ stage: 'x', center: 'self', follow: true, delay: 0.3, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] }]);
    applyStatus(me, 'atkUp', 5, 0.5, 0);
    clearEvents(tg);
    advance(tg, 0.4);
    const hit = dmgOn(tg, m.id)[0];
    const def = effStats(tg.w, m).def;
    expect(hit.amount).toBeCloseTo(effStats(tg.w, me).atk * (1 - def), 3);
    expect(effStats(tg.w, me).atk).toBeGreaterThan(base * 1.4);
  });
});

describe('telegraphLead', () => {
  const at = (lead?: number): SkillAction => ({ stage: 'x', center: 'point', delay: 2, ...(lead != null ? { telegraphLead: lead } : null), area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] });
  it('absent: the whole delay; N: only the last N s; 0: never — the beat lands either way', () => {
    for (const [lead, before, after] of [
      [undefined, 1, 1],
      [0.5, 0, 1],
      [0, 0, 0],
    ] as const) {
      const tg = game();
      const m = dummy(tg, { x: 12, y: 6 });
      freeze(active(tg));
      cast(tg, [at(lead)], { x: 12, y: 6 });
      advance(tg, 1.4);
      expect(tg.w.state.telegraphs.length, `lead ${lead} early`).toBe(before);
      advance(tg, 0.3);
      expect(tg.w.state.telegraphs.length, `lead ${lead} late`).toBe(after);
      if (lead === 0.5) expect(tg.w.state.telegraphs[0].total).toBeCloseTo(0.5, 1);
      clearEvents(tg);
      advance(tg, 0.4);
      expect(dmgOn(tg, m.id), `lead ${lead} lands`).toHaveLength(1);
    }
  });
});

describe("crit: 'always'", () => {
  it('a guaranteed crit needs no roll and deals the crit multiplier (레인저 관통 일격)', () => {
    const tg = game(['ranger', 'guardian', 'mage']);
    const m = dummy(tg, { x: 14, y: 6 });
    const me = active(tg);
    me.rt.base.critChance = 0;
    clearEvents(tg);
    cast(tg, [{ stage: 'x', center: 'point', area: { shape: 'circle', radius: 1 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1, crit: 'always' }] }], { x: 14, y: 6 });
    const st = effStats(tg.w, me);
    const hit = dmgOn(tg, m.id)[0];
    expect(hit.crit).toBe(true);
    expect(hit.amount).toBeCloseTo(st.atk * st.critMult * (1 - effStats(tg.w, m).def), 3);
  });
});

describe('dash.atFire and charge.stopAtCenter', () => {
  it('atFire moves the caster from where it stands when the beat lands, keeps its facing; an echo recast does not move it', () => {
    const tg = game(['guardian', 'gunner', 'mage']);
    tg.w.state.players[0].relics.push('echo_seal');
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 15, y: 6 } });
    const g = active(tg);
    g.rt.base.moveSpeed = 0;
    g.rt.base.atk = 0;
    g.pos = { x: 16, y: 7 }; // shoved somewhere before the slug fires
    g.facing = Math.PI;
    clearEvents(tg);
    advance(tg, 0.9);
    const d = eventsOf(tg, 'dash').filter(x => x.entityId === g.id);
    expect(d).toHaveLength(1);
    expect(d[0].from.x).toBeCloseTo(16);
    expect(d[0].to.x).toBeCloseTo(17.2);
    expect(g.facing).toBeCloseTo(Math.PI);
    advance(tg, 1.5); // the echo (1 s later) fires the slug again: no second recoil
    expect(eventsOf(tg, 'dash').filter(x => x.entityId === g.id)).toHaveLength(1);
  });

  it('stopAtCenter: the rush ends on the center even when its distance reaches further', () => {
    const tg = game();
    const me = active(tg);
    me.pos = { x: 20, y: 6 };
    cast(tg, [{ stage: 'x', center: 'point', delay: 0.1, area: { shape: 'line', length: 9, width: 1 }, affects: 'enemies', effects: [], charge: { distance: 9, stopAtCenter: true } }], { x: 16, y: 6 });
    advance(tg, 0.2);
    expect(me.pos.x).toBeCloseTo(16, 5);
  });
});

describe('ult cut-in (2-3): ultCast first, castTime 0.5, caster invulnerable 0.5 s, nothing lands before 0.45 s', () => {
  it('every renewed ult: no damage / heal / status from it before 0.45 s, something by 3 s', () => {
    for (const c of CHARACTERS) {
      const tg = game([c.id, 'guardian', 'blade']);
      const me = active(tg);
      me.pos = { x: 12, y: 6 };
      const foes = [dummy(tg, { x: 14, y: 6 }, 'golem', false), dummy(tg, { x: 10, y: 5 }, 'slime', false)];
      me.targetId = foes[0].id;
      me.hp = me.maxHp * 0.5;
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
      clearEvents(tg);
      expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok, c.id).toBe(true);
      const first = tg.game.drainEvents();
      const iCut = first.findIndex(e => e.type === 'ultCast');
      const iCast = first.findIndex(e => e.type === 'skillCast' && e.skillId === c.ult.id);
      expect(iCut, c.id).toBeGreaterThanOrEqual(0);
      expect(iCut, c.id).toBeLessThan(iCast);
      expect(first[iCut]).toMatchObject({ type: 'ultCast', player: 0, entityId: me.id, defId: c.id, skillId: c.ult.id, name: c.ult.name });
      expect(me.invulnTime, c.id).toBeGreaterThanOrEqual(ULT_CUTIN.guard - 1e-9);
      expect(me.rt.lockTime, c.id).toBeCloseTo(0.5, 6);
      const landed = (evs: GameEvent[]) => evs.filter(e => e.type === 'skillStage' && e.skillId === c.ult.id && e.stage !== 'vanish');
      expect(landed(first), c.id).toHaveLength(0);
      for (let t = 0; t < 13; t++) {
        advance(tg, 1 / 30); // up to 0.433 s
        expect(landed(tg.events), `${c.id} at tick ${t + 1}`).toHaveLength(0);
      }
      advance(tg, 3);
      expect(landed(tg.events).length, c.id).toBeGreaterThan(0);
    }
  });

  it('the guard: the caster takes no damage during the cut-in, then does again', () => {
    const tg = game();
    const me = active(tg);
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    tg.game.dispatch({ type: 'ult', player: 0 });
    const hit = () => applyDamage(tg.w, { casterId: null, team: 'enemy', player: null, source: 'basic', isDrag: false }, me, 50, false);
    expect(hit()).toBe(0);
    advance(tg, 0.4);
    expect(hit()).toBe(0);
    advance(tg, 0.15);
    expect(me.invulnTime).toBe(0);
    expect(hit()).toBeGreaterThan(0);
  });
});

describe('ult cut-in vs floor clear (기획 13차)', () => {
  it('a floor cleared before any ult part fired gives the gauge back (not counted as used); a landed ult is spent', () => {
    for (const [wait, refunded] of [
      [0.2, true],
      [1.5, false],
    ] as const) {
      const tg = game(['mage', 'guardian', 'blade']);
      dummy(tg, { x: 14, y: 6 }, 'golem', false);
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
      expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
      const p = tg.w.state.players[0];
      expect(p.ult.charge).toBe(0);
      advance(tg, wait);
      clearEvents(tg);
      expect(tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }).ok).toBe(true);
      expect(p.ult.charge === 1, `wait ${wait}`).toBe(refunded);
      expect(p.stats.ultsUsed).toBe(refunded ? 0 : 1);
      expect(eventsOf(tg, 'ultReady').length).toBe(refunded ? 1 : 0);
    }
  });
});

describe('blinkChain (블레이드 천검난무)', () => {
  it('hops to enemies in reach, unhit first, at most 2 per enemy; a hop with nobody left hits where it stands', () => {
    const tg = game(['blade', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 12, y: 6 };
    const a = dummy(tg, { x: 14, y: 6 });
    const b = dummy(tg, { x: 9, y: 6 });
    const far = dummy(tg, { x: 30, y: 6 }); // out of reach (7)
    me.targetId = a.id;
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0 });
    advance(tg, 1.0);
    const hops = eventsOf(tg, 'blink').filter(e => e.entityId === me.id);
    expect(hops.map(h => [h.hop, h.hops])).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
    ]);
    const hopStages = eventsOf(tg, 'skillStage').filter(s => s.stage === 'hop');
    expect(hopStages).toHaveLength(5);
    expect(dmgOn(tg, a.id).length).toBeGreaterThanOrEqual(2);
    expect(dmgOn(tg, b.id).length).toBeGreaterThanOrEqual(2);
    expect(dmgOn(tg, far.id)).toHaveLength(0);
    // first hop: the nearer unhit enemy (a at 2, b at 3)
    expect(Math.abs(hops[0].to.x - a.pos.x)).toBeLessThan(Math.abs(hops[0].to.x - b.pos.x));
  });

  it('a gone caster ends the chain (no hits, no error)', () => {
    const tg = game(['blade', 'guardian', 'mage']);
    const me = active(tg);
    const a = dummy(tg, { x: 14, y: 6 });
    me.targetId = a.id;
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    tg.game.dispatch({ type: 'ult', player: 0 });
    advance(tg, 0.55);
    killActive(tg);
    clearEvents(tg);
    advance(tg, 3);
    expect(eventsOf(tg, 'skillStage').filter(s => s.stage === 'hop')).toHaveLength(0);
  });
});

describe('maxTargets, healPerHit, overflowShield, woundedAlly drag', () => {
  it('maxTargets: the n nearest, units immune to its status last (퍼펫티어 조종: a mid boss never takes a slot)', () => {
    const tg = game(['puppeteer', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 12, y: 6 };
    const mid = dummy(tg, { x: 12.8, y: 6 }, 'ogre');
    const near = [1.5, 2, 2.5, 3, 3.5].map(d => dummy(tg, { x: 12 + d, y: 7 }, 'slime'));
    cast(tg, [{ stage: 'charm', center: 'self', area: { shape: 'circle', radius: 7 }, affects: 'enemies', effects: [{ kind: 'status', status: 'charm', duration: 2.5, value: 0 }], maxTargets: 4 }], null, 'ult');
    const charmed = (e: SimEntity) => e.statuses.some(s => s.id === 'charm');
    expect(charmed(mid)).toBe(false);
    expect(near.map(charmed)).toEqual([true, true, true, true, false]);
  });

  it('healPerHit: allies near the center heal amount × enemies hit (capped), once, from the first enemy (퇴마사 멸)', () => {
    const tg = game(['exorcist', 'guardian', 'mage']);
    const me = active(tg);
    me.pos = { x: 12, y: 6 };
    me.hp = me.maxHp * 0.3;
    const foes = [0, 1, 2, 3, 4, 5, 6].map(i => dummy(tg, { x: 10 + i * 0.6, y: 7 }, 'slime'));
    clearEvents(tg);
    cast(tg, [{ stage: 'destroy', center: 'point', area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.01 }], healPerHit: { radius: 4.5, amount: 0.03, maxHits: 5 } }], { x: 12, y: 6 });
    const heals = eventsOf(tg, 'heal').filter(h => h.targetId === me.id);
    expect(heals).toHaveLength(1);
    expect(heals[0].amount).toBeCloseTo(me.maxHp * 0.03 * 5, 3);
    expect(heals[0].from).toBe(foes[0].id);
  });

  it('overflowShield: the heal past max HP becomes a shield, never above cap × max HP from this source (클레릭)', () => {
    const tg = game(['cleric', 'guardian', 'mage']);
    const me = active(tg);
    me.hp = me.maxHp - 10;
    me.shield = 0;
    const spring: SkillAction = { stage: 'x', center: 'point', area: { shape: 'circle', radius: 2 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.08, overflowShield: { frac: 1, cap: 0.12, duration: 4 } }] };
    cast(tg, [spring], { ...me.pos });
    expect(me.hp).toBeCloseTo(me.maxHp, 6);
    expect(me.shield).toBeCloseTo(me.maxHp * 0.08 - 10, 3);
    cast(tg, [spring], { ...me.pos });
    expect(me.shield).toBeCloseTo(me.maxHp * 0.12, 3); // capped
    expect(me.rt.shieldTime).toBeCloseTo(4, 6);
  });

  it("woundedAlly drag (메딕 주사): the lowest HP ratio within 8 of the drop point — any player's, ties nearer", () => {
    const tg = game(['guardian', 'medic', 'mage'], [party(['guardian', 'medic', 'mage']), party(['ranger', 'blade', 'cleric'], '둘'), party(['bard', 'blade', 'cleric'], '셋')]);
    const [p0, p1, p2] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    p0.pos = { x: 5, y: 6 };
    p1.pos = { x: 14, y: 6 };
    p1.hp = p1.maxHp * 0.5;
    p2.pos = { x: 25, y: 6 }; // lower, but 13 away from the drop
    p2.hp = p2.maxHp * 0.2;
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    const regen = (e: SimEntity) => e.statuses.find(s => s.id === 'regen');
    expect(regen(p1)?.value).toBeCloseTo(0.015, 6);
    expect(regen(p2)).toBeUndefined();
    const cast0 = eventsOf(tg, 'skillCast').find(c => c.stage === 'syringe');
    expect(cast0?.center).toEqual(p1.pos);
  });
});

describe('bench buffs, cooldown cuts for all players (기획 13차 5-3)', () => {
  it('바드 앙코르: every living bench card gets the buff (benchBuff), it ticks on the bench and comes onto the field', () => {
    const tg = game(['guardian', 'bard', 'blade']);
    const p = tg.w.state.players[0];
    p.party[2].dead = true;
    p.party[2].hp = 0;
    p.party[2].reviveRemaining = 30;
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    const buffs = eventsOf(tg, 'benchBuff');
    expect(buffs.map(b => [b.partyIndex, b.status])).toEqual([
      [0, 'atkUp'],
      [0, 'haste'],
    ]); // the guardian that just left; the dead blade gets nothing
    expect(p.party[0].statuses.find(s => s.id === 'atkUp')?.value).toBeCloseTo(0.15, 6);
    advance(tg, 3);
    expect(p.party[0].statuses.find(s => s.id === 'atkUp')?.remaining).toBeCloseTo(7, 1);
    p.appearLock = 0;
    p.party[0].swapCooldownRemaining = 0;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 12, y: 6 } });
    const g = active(tg);
    expect(effStats(tg.w, g).atk).toBeGreaterThan(g.rt.base.atk * 1.14);
  });

  it('대합창 · 앙코르 and 시간 정지: every non-out player gets the bench buff / the cooldown cut (swapCdCut)', () => {
    const players = [party(['bard', 'guardian', 'blade']), party(['chrono', 'ranger', 'mage'], '둘'), party(['paladin', 'warden', 'cleric'], '셋')];
    const tg = game(undefined, players);
    const [, p1, p2] = tg.w.state.players;
    p2.out = true;
    for (const p of tg.w.state.players) p.party[2].swapCooldownRemaining = 8;
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0 });
    tg.game.dispatch({ type: 'ult', player: 1 });
    advance(tg, 0.5);
    expect(new Set(eventsOf(tg, 'benchBuff').map(b => b.player))).toEqual(new Set([0, 1]));
    expect(eventsOf(tg, 'swapCdCut').map(c => [c.player, c.seconds, c.from])).toEqual([
      [0, 4, 1],
      [1, 4, 1],
    ]);
    expect(p1.party[2].swapCooldownRemaining).toBeCloseTo(8 - 0.5 - 4, 1);
    expect(p2.party[2].swapCooldownRemaining).toBe(8); // out players are skipped (and their timers stand still)
  });
});

describe('sequences outlive their caster (5-5): swapped out, dead, out player', () => {
  it('the guardian swapped out after the slam: the wave still lands at the drop point, its taunt finds no taunter and is dropped', () => {
    const tg = makeGame({ players: [party(['blade', 'guardian', 'mage'])], tunables: { appearLockTime: 0, swapCooldownMult: 0 } });
    quietFloor(tg);
    const m = spawnAt(tg, 'slime', { x: 14, y: 6 });
    m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } });
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 30, y: 2 } });
    clearEvents(tg);
    advance(tg, 0.3);
    expect(eventsOf(tg, 'skillStage').some(s => s.stage === 'wave' && s.targets === 1)).toBe(true);
    advance(tg, 0.2);
    expect(m.statuses.some(s => s.id === 'taunt')).toBe(false);
  });

  it('a player who goes out mid-sequence: the beats still land and count for that player', () => {
    const tg = makeGame({ players: [party(['mage', 'guardian', 'blade']), party(['ranger', 'cleric', 'bard'], '둘')], tunables: { reviveTime: 60 } });
    quietFloor(tg);
    const m = dummy(tg, { x: 14, y: 6 });
    const p0 = tg.w.state.players[0];
    p0.appearLock = 0;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 14, y: 6 } });
    // the rest of the party is already down: killing the field card puts the player out
    for (const i of [0, 2]) {
      p0.party[i].dead = true;
      p0.party[i].hp = 0;
      p0.party[i].reviveRemaining = 60;
    }
    killActive(tg, 0);
    expect(p0.out).toBe(true);
    const before = p0.stats.damageDealt;
    clearEvents(tg);
    advance(tg, 0.5);
    expect(eventsOf(tg, 'skillStage').some(s => s.stage === 'wave' && s.player === 0)).toBe(true);
    expect(p0.stats.damageDealt).toBeGreaterThan(before);
    expect(m.hp).toBeLessThan(1e9);
  });
});

describe('multiplayer determinism with every renewed skill', () => {
  const run = (ids: string[]) => {
    const tg = makeGame({
      seed: 4242,
      players: [0, 1, 2].map(i => party(ids.slice(i * 3, i * 3 + 3), `P${i}`)),
      tunables: { invincible: true, appearLockTime: 0, swapCooldownMult: 0 },
    });
    quietFloor(tg);
    const snaps: string[] = [];
    const ps = tg.w.state.players;
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 6; i++) spawnAt(tg, i % 3 ? 'slime' : 'golem', { x: 8 + i * 3, y: 2 + (i % 3) * 3 });
      for (const p of ps) {
        const idx = round % 3;
        if (p.activeIndex !== idx) tg.game.dispatch({ type: 'swap', player: p.id, partyIndex: idx, pos: { x: 10 + p.id * 4, y: 6 } });
        tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: p.id } });
        tg.game.dispatch({ type: 'ult', player: p.id });
      }
      advance(tg, 3);
      snaps.push(JSON.stringify(cleanState(tg.w.state)));
    }
    return snaps;
  };
  const ids = CHARACTERS.map(c => c.id);
  // two runs of 3 players × 3 cards cover all 15 characters
  for (const slice of [ids.slice(0, 9), ids.slice(6, 15)]) {
    it(`3 humans casting ${slice.join(', ')}: the same seed gives the same snapshots`, () => {
      expect(run(slice)).toEqual(run(slice));
    });
  }
});
