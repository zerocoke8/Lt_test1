// 기획 12차 돌발 괴담 (docs/combat-events.md): schedule, the world staying bit-identical until the first warning, every
// event's success and failure, party rewards, targeting rules, ward immunity, floor-clear safety, cleanup, no stalls.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import { CHARACTERS, FIELD_EVENTS, getCharacter, getFieldEvent, getMonster, lockRadius } from '../../src/data';
import { applyDamage } from '../../src/sim/combat';
import { createUnit } from '../../src/sim/entities';
import { dropOutcome } from '../../src/sim/fieldEventPreview';
import { fieldEventSchedule, fieldEventSpan } from '../../src/sim/fieldEvents';
import { planFloor } from '../../src/sim/floor';
import { tick } from '../../src/sim/game';
import { Rng } from '../../src/sim/rng';
import { countEnemies, endRun, getEntity, isAlive, type SimEntity } from '../../src/sim/world';
import type { FieldEventId, FieldEventState, PlayerSetup, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, eventsOf, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const ON = { fieldEventChance: 0.6 };
const P_CLERIC: PlayerSetup = { name: '힐', isBot: false, characters: ['guardian', 'cleric', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] };
const FLOOR_OF: Record<FieldEventId, number> = {
  lucky_toad: 3,
  possessed_printer: 7,
  sleeping_patient: 12,
  open_shaft: 3,
  midnight_surge: 8,
  dark_lamps: 13,
  sleepwalker: 3,
};

/** A quiet normal floor (no waves, no monsters, never clears by itself) with the event forced and started. */
function started(id: FieldEventId, players: PlayerSetup[] = [HUMAN, HUMAN2], seed = 5): { tg: TestGame; ev: FieldEventState } {
  const tg = makeGame({ seed, players, startFloor: FLOOR_OF[id], tunables: { invincible: true } });
  quietFloor(tg);
  expect(tg.game.dispatch({ type: 'debug', action: { kind: 'fieldEventNext', id } }).ok).toBe(true);
  expect(tg.w.state.fieldEvent?.stage).toBe('warn');
  advance(tg, getFieldEvent(id).warn + 0.05);
  const ev = tg.w.state.fieldEvent!;
  expect(ev.stage).toBe('active');
  return { tg, ev };
}

function unit(tg: TestGame, ev: FieldEventState): SimEntity {
  const u = getEntity(tg.w, ev.entityIds[0]);
  if (!u) throw new Error('no event unit');
  return u;
}

/** Move every field character far away from p (x ≥ 10 units off). */
function parkChars(tg: TestGame, at: Vec2): void {
  for (const e of tg.w.state.entities) if (e.kind === 'character') e.pos = { x: at.x, y: at.y };
}

const dragHit = (player: number) => ({ casterId: null, team: 'ally' as const, player, source: 'drag' as const, isDrag: true });
const basicHit = (player: number) => ({ casterId: null, team: 'ally' as const, player, source: 'basic' as const, isDrag: false });

describe('schedule (pure, by seed)', () => {
  const planOf = (f: number) => planFloor(f, new Rng(1), DEFAULT_TUNABLES);
  it('is deterministic, floor 2 = the toad, never floor 1 / boss floors / floor 20, no repeats in a row, ≤ 2 of each', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const a = fieldEventSchedule(seed, DEFAULT_TUNABLES, planOf);
      expect(fieldEventSchedule(seed, DEFAULT_TUNABLES, planOf)).toEqual(a);
      expect(a[0]).toMatchObject({ floor: 2, id: 'lucky_toad' });
      const counts: Record<string, number> = {};
      a.forEach((p, i) => {
        expect(p.floor).toBeGreaterThanOrEqual(2);
        expect(p.floor).toBeLessThanOrEqual(19);
        expect(p.floor % 5).not.toBe(0);
        expect(getFieldEvent(p.id).from).toBeLessThanOrEqual(p.floor);
        if ((p.floor + 1) % 5 === 0) expect(getFieldEvent(p.id).notBeforeBoss, `${p.id} on ${p.floor}`).toBeFalsy();
        if (i > 0 && a[i - 1].floor === p.floor - 1) expect(a[i - 1].id).not.toBe(p.id);
        counts[p.id] = (counts[p.id] ?? 0) + 1;
        // the whole event (warning + time + 23:59 spawn-in) ends ≥ 2 s before the last wave
        const last = planOf(p.floor).waves.at(-1)!.at;
        expect(p.startAt).toBeGreaterThanOrEqual(8);
        expect(p.startAt + fieldEventSpan(getFieldEvent(p.id))).toBeLessThanOrEqual(last - 2 + 1e-9);
      });
      for (const n of Object.values(counts)) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('about 9 per run at 0.6, none at 0 (also no floor-2 toad)', () => {
    let n = 0;
    for (let seed = 1; seed <= 200; seed++) n += fieldEventSchedule(seed, DEFAULT_TUNABLES, planOf).length;
    expect(n / 200).toBeGreaterThan(7);
    expect(n / 200).toBeLessThan(10.5);
    expect(fieldEventSchedule(3, { ...DEFAULT_TUNABLES, fieldEventChance: 0 }, planOf)).toEqual([]);
  });
});

describe('slider 0 = off; events on = same world until the first warning', () => {
  it('chance 0: no state and no event unit on any tick', () => {
    const tg = makeGame({ seed: 9, players: [BOT1, BOT2], startFloor: 2, tunables: { fieldEventChance: 0, invincible: true, maxFloor: 4 } });
    for (let t = 0; t < 30 * 200 && tg.w.state.phase !== 'runOver'; t++) {
      if (tg.w.state.phase !== 'combat') break;
      tick(tg.w);
      expect(tg.w.state.fieldEvent).toBeNull();
      expect(tg.w.state.entities.some(e => e.eventTag)).toBe(false);
    }
  });

  it('chance 0.6 vs 0: identical rng state and positions on every tick before the first fieldEventWarn', () => {
    const a = makeGame({ seed: 21, players: [HUMAN, BOT1, BOT2], tunables: { fieldEventChance: 0 } });
    const b = makeGame({ seed: 21, players: [HUMAN, BOT1, BOT2], tunables: ON });
    const rngOf = (tg: TestGame) => (tg.w.rng as unknown as { s: number }).s;
    let ticks = 0;
    for (;;) {
      tick(a.w);
      tick(b.w);
      if (b.game.drainEvents().some(e => e.type === 'fieldEventWarn')) break;
      a.game.drainEvents();
      expect(rngOf(b)).toBe(rngOf(a));
      expect(b.w.state.entities.map(e => [e.id, e.pos.x, e.pos.y])).toEqual(a.w.state.entities.map(e => [e.id, e.pos.x, e.pos.y]));
      if (a.w.state.phase !== 'combat') {
        // both reach the reward screen the same way: pick the same offer and go on
        for (const tg of [a, b]) tg.game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      }
      expect(++ticks).toBeLessThan(30 * 400);
    }
    expect(b.w.state.floor).toBe(2);
  });
});

describe('도망치는 금두꺼비', () => {
  it('success: the killing blow credits its player, every non-out player gets ult +40%, an out player nothing', () => {
    const { tg, ev } = started('lucky_toad', [HUMAN, HUMAN2, BOT1]);
    const ps = tg.w.state.players;
    ps[2].out = true;
    ps.forEach(p => (p.ult.charge = 0.1));
    applyDamage(tg.w, dragHit(1), unit(tg, ev), 1e6, false);
    const end = eventsOf(tg, 'fieldEventEnd').at(-1)!;
    expect(end).toMatchObject({ id: 'lucky_toad', success: true, player: 1 });
    expect(tg.w.state.fieldEvent).toBeNull();
    expect(ps[0].ult.charge).toBeCloseTo(0.5, 5);
    expect(ps[1].ult.charge).toBeCloseTo(0.5, 5);
    expect(ps[2].ult.charge).toBeCloseTo(0.1, 5);
    expect(ps[1].stats.fieldEvents).toBe(1);
    expect(tg.w.fieldEvents.history.at(-1)).toMatchObject({ id: 'lucky_toad', success: true, credit: 1 });
  });

  it('failure after 18 s: it sinks away, nobody is rewarded', () => {
    const { tg, ev } = started('lucky_toad');
    const id = ev.entityIds[0];
    unit(tg, ev).hp = unit(tg, ev).maxHp = 1e9; // nobody can kill it in time
    tg.w.state.players[0].ult.charge = 0;
    advance(tg, 18.2);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ success: false, player: null });
    expect(getEntity(tg.w, id)).toBeNull();
    // only the natural charge (18.2 s of 30), no +40 %
    expect(tg.w.state.players[0].ult.charge).toBeLessThan(18.5 / 30);
  });

  it('flees an ally nearby and hops away; a stun cancels the hop', () => {
    const { tg, ev } = started('lucky_toad', [HUMAN]);
    const t = unit(tg, ev);
    t.hp = t.maxHp = 1e9;
    t.pos = { x: 18, y: 6 };
    active(tg).pos = { x: 16, y: 6 };
    advance(tg, 1);
    expect(t.pos.x).toBeGreaterThan(19);
    advance(tg, 7); // every 4 s of fleeing (a stun from a hit pauses it)
    expect(eventsOf(tg, 'dash').some(d => d.entityId === t.id)).toBe(true);
    // stunned through a whole hop cycle: no new hop
    const hops = eventsOf(tg, 'dash').filter(d => d.entityId === t.id).length;
    t.statuses.push({ id: 'stun', remaining: 6, total: 6, value: 0, sourcePlayer: 0 });
    advance(tg, 5);
    expect(eventsOf(tg, 'dash').filter(d => d.entityId === t.id).length).toBe(hops);
  });
});

describe('targeting rules (2-1)', () => {
  it('1+4: auto-target skips the target while another enemy is up, takes it when it is the only one', () => {
    const { tg, ev } = started('lucky_toad', [HUMAN]);
    const me = active(tg);
    const toad = unit(tg, ev);
    toad.statuses.push({ id: 'stun', remaining: 30, total: 30, value: 0, sourcePlayer: 0 }); // holds it still
    toad.pos = { x: me.pos.x + 1.5, y: me.pos.y };
    const slime = spawnAt(tg, 'slime', { x: me.pos.x - 5, y: me.pos.y });
    me.targetId = null;
    tick(tg.w);
    expect(me.targetId).toBe(slime.id);
    slime.rt.gone = true;
    me.targetId = null;
    tick(tg.w);
    expect(me.targetId).toBe(toad.id);
  });

  it('2: a character dropped within max(2.5, range + 1) locks onto the target; 3: let go beyond 8', () => {
    const { tg, ev } = started('lucky_toad', [HUMAN]);
    const toad = unit(tg, ev);
    toad.statuses.push({ id: 'stun', remaining: 30, total: 30, value: 0, sourcePlayer: 0 });
    toad.pos = { x: 20, y: 6 };
    const slime = spawnAt(tg, 'slime', { x: 14, y: 6 });
    slime.statuses.push({ id: 'stun', remaining: 30, total: 30, value: 0, sourcePlayer: 0 });
    // mage (range 5–6): dropped ~5 away still locks
    const r = lockRadius(getCharacter('mage').stats.range);
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 20 - toad.radius - r + 0.3, y: 6 } }).ok).toBe(true);
    const mage = active(tg);
    expect(mage.targetId).toBe(toad.id);
    advance(tg, 1);
    expect(mage.targetId).toBe(toad.id);
    toad.pos = { x: mage.pos.x + 9, y: 6 };
    tick(tg.w);
    expect(mage.targetId).toBe(slime.id);
  });

  it('5: drag skills and pets hit a target ×2 (damage event tagged weak), basic attacks ×1', () => {
    const { tg, ev } = started('possessed_printer', [HUMAN]);
    const pr = unit(tg, ev);
    const a = applyDamage(tg.w, dragHit(0), pr, 100, false);
    const b = applyDamage(tg.w, basicHit(0), pr, 100, false);
    expect(a).toBeCloseTo(2 * b, 6);
    const dmg = eventsOf(tg, 'damage').filter(d => d.targetId === pr.id);
    expect(dmg.map(d => !!d.weak)).toEqual([true, false]);
  });

  it('7: wards never take damage and monsters never pick them', () => {
    const { tg, ev } = started('sleeping_patient', [HUMAN]);
    const pt = unit(tg, ev);
    expect(applyDamage(tg.w, { casterId: null, team: 'enemy', player: null, source: 'basic', isDrag: false }, pt, 1e6, false)).toBe(0);
    parkChars(tg, { x: pt.pos.x > 18 ? 2 : 34, y: 6 });
    const m = spawnAt(tg, 'goblin', { x: pt.pos.x + 0.6, y: pt.pos.y });
    advance(tg, 1);
    expect(m.targetId).not.toBe(pt.id);
    expect(pt.hp).toBeGreaterThan(0);
  });
});

describe('floor safety', () => {
  it('event units never block the floor clear nor count toward the mid boss', () => {
    const tg = makeGame({ seed: 4, players: [HUMAN], startFloor: 3, tunables: { invincible: true } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'fieldEventNext', id: 'lucky_toad' } });
    advance(tg, 1.6);
    const ev = tg.w.state.fieldEvent!;
    const kills = tg.w.spawner.kills;
    const toad = unit(tg, ev);
    expect(countEnemies(tg.w)).toBe(tg.w.state.entities.filter(e => e.team === 'enemy' && !e.eventTag && e.hp > 0).length);
    applyDamage(tg.w, dragHit(0), toad, 1e6, false);
    expect(tg.w.spawner.kills).toBe(kills);
    // floor clears with only an event unit left
    tg.game.dispatch({ type: 'debug', action: { kind: 'fieldEventNext', id: 'possessed_printer' } });
    const w = tg.w;
    w.spawner.nextWave = w.state.plan.waves.length;
    w.spawner.pending = [];
    w.state.midBossSpawned = true;
    for (const e of w.state.entities) if (e.team === 'enemy' && !e.eventTag) e.rt.gone = true;
    advance(tg, 2);
    expect(w.state.phase).toBe('reward');
    expect(w.state.fieldEvent).toBeNull();
    expect(w.state.entities.some(e => e.eventTag)).toBe(false);
  });

  it('cleanup on skipFloor, jumpFloor and quit (silent fail logged)', () => {
    for (const action of ['skip', 'jump', 'quit'] as const) {
      const { tg } = started('sleepwalker', [HUMAN]);
      if (action === 'skip') tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
      if (action === 'jump') tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 6 } });
      if (action === 'quit') tg.game.dispatch({ type: 'quit' });
      expect(tg.w.state.fieldEvent, action).toBeNull();
      expect(tg.w.state.entities.some(e => e.eventTag), action).toBe(false);
      // logged under the floor it was on (a jump changes the floor after closing it)
      expect(tg.w.fieldEvents.history.at(-1), action).toMatchObject({ floor: FLOOR_OF.sleepwalker, id: 'sleepwalker', success: false });
    }
  });

  it('a run that ends mid-event (wipe) logs it as failed and leaves no event unit behind', () => {
    const { tg } = started('midnight_surge', [HUMAN]);
    advance(tg, 3);
    expect(tg.w.state.entities.filter(e => e.eventTag === 'minion' && isAlive(e)).length).toBeGreaterThan(0);
    endRun(tg.w, 'defeat', 'wipe');
    expect(tg.w.state.fieldEvent).toBeNull();
    expect(tg.w.state.entities.filter(e => e.eventTag && !e.rt.gone)).toEqual([]);
    expect(tg.w.fieldEvents.history.at(-1)).toMatchObject({ floor: FLOOR_OF.midnight_surge, id: 'midnight_surge', success: false });
  });

  it('debug killAll leaves 돌발 괴담 units alone (it is not a success)', () => {
    const { tg, ev } = started('lucky_toad', [HUMAN]);
    const toad = unit(tg, ev);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'killAll' } }).ok).toBe(true);
    expect(isAlive(toad)).toBe(true);
    expect(tg.w.state.fieldEvent?.id).toBe('lucky_toad');
    expect(eventsOf(tg, 'fieldEventEnd')).toEqual([]);
  });

  it('debug fieldEventNext later in a floor waits for 8 s of the next normal floor; unknown ids are refused', () => {
    const tg = makeGame({ seed: 4, players: [HUMAN], startFloor: 4, tunables: { invincible: true } });
    advance(tg, 31);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'fieldEventNext', id: 'dark_lamps' } }).ok).toBe(true);
    expect(tg.w.state.fieldEvent).toBeNull();
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'fieldEventNext', id: 'nope' as FieldEventId } }).ok).toBe(false);
    tg.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 6 } });
    advance(tg, 7.9);
    expect(tg.w.state.fieldEvent).toBeNull();
    advance(tg, 0.2);
    expect(tg.w.state.fieldEvent?.id).toBe('dark_lamps');
  });
});

describe('멈추지 않는 프린터', () => {
  it('prints 2 every printEvery s (not while stunned); destroyed → its prints vanish (no kill credit) and pets reset for all', () => {
    const { tg, ev } = started('possessed_printer', [HUMAN, HUMAN2]);
    const pr = unit(tg, ev);
    parkChars(tg, { x: pr.pos.x > 18 ? 2 : 34, y: 6 });
    pr.statuses.push({ id: 'stun', remaining: 6, total: 6, value: 0, sourcePlayer: 0 });
    advance(tg, 5.5);
    expect(ev.printed).toBe(0);
    advance(tg, getFieldEvent('possessed_printer').params.printEvery + 0.7);
    expect(ev.printed).toBe(2);
    const minions = tg.w.state.entities.filter(e => e.team === 'enemy' && !e.eventTag);
    expect(minions.length).toBe(2);
    for (const p of tg.w.state.players) p.pets.forEach(s => (s.cooldownRemaining = 20));
    const kills = tg.w.state.players[0].stats.kills;
    applyDamage(tg.w, dragHit(0), pr, 1e7, false);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ success: true, player: 0 });
    expect(minions.every(m => m.rt.gone)).toBe(true);
    expect(tg.w.state.players[0].stats.kills).toBe(kills + 1);
    for (const p of tg.w.state.players) expect(p.pets.every(s => s.cooldownRemaining === 0)).toBe(true);
  });

  it('times out → it switches off, the prints stay', () => {
    const { tg, ev } = started('possessed_printer', [HUMAN]);
    const pr = unit(tg, ev);
    parkChars(tg, { x: pr.pos.x > 18 ? 2 : 34, y: 6 });
    tg.w.tunables.invincible = true;
    advance(tg, 20.2);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ success: false });
    expect(tg.w.state.entities.filter(e => e.team === 'enemy' && !e.eventTag && e.hp > 0).length).toBeGreaterThan(0);
  });
});

describe('깨어나지 않는 환자', () => {
  it('starts at startPct; heals fill it; full → everyone heals 20 % (bench too) and revive −10 s', () => {
    const { tg, ev } = started('sleeping_patient', [HUMAN, HUMAN2]);
    const pt = unit(tg, ev);
    expect(ev.progress).toBeCloseTo(getFieldEvent('sleeping_patient').params.startPct, 5);
    const p1 = tg.w.state.players[1];
    p1.party[1].hp = p1.party[1].maxHp * 0.5;
    p1.party[2].dead = true;
    p1.party[2].hp = 0;
    p1.party[2].reviveRemaining = 25;
    pt.hp = pt.maxHp - 1;
    advance(tg, 0.2); // the near-character regen or the next tick reaches 100 % only with help:
    pt.hp = pt.maxHp;
    advance(tg, 0.1);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ id: 'sleeping_patient', success: true });
    expect(p1.party[1].hp).toBeCloseTo(p1.party[1].maxHp * 0.7, 3);
    expect(p1.party[2].reviveRemaining).toBeCloseTo(15 - 0.1, 0);
  });

  it('an enemy dying within 4 adds killBonus %; nobody near and no heals → it falls back asleep', () => {
    const { tg, ev } = started('sleeping_patient', [HUMAN]);
    const pt = unit(tg, ev);
    const prm = getFieldEvent('sleeping_patient').params;
    parkChars(tg, { x: pt.pos.x > 18 ? 2 : 34, y: 6 });
    const m = spawnAt(tg, 'slime', { x: pt.pos.x + 1, y: pt.pos.y });
    applyDamage(tg.w, basicHit(0), m, 1e6, false);
    expect(ev.progress).toBeCloseTo(prm.startPct + prm.killBonus, 3);
    advance(tg, 22.2);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ success: false });
  });
});

describe('열린 엘리베이터 통로', () => {
  it('normal monsters on the hole fall (count as kills for the floor, no player credit); the mid boss stumbles once', () => {
    const { tg, ev } = started('open_shaft', [HUMAN]);
    const hole = ev.marks[0].pos;
    parkChars(tg, { x: hole.x > 18 ? 2 : 34, y: 6 });
    const kills = tg.w.spawner.kills;
    const ogre = spawnAt(tg, 'ogre', { ...hole });
    tick(tg.w);
    expect(ogre.hp).toBeLessThan(ogre.maxHp * 0.9);
    expect(ogre.statuses.some(s => s.id === 'stun')).toBe(true);
    expect(ev.progress).toBe(2);
    const hp = ogre.hp;
    advance(tg, 0.5);
    expect(ogre.hp).toBe(hp);
    ogre.pos = { x: hole.x + 6, y: hole.y };
    // a monster at the rim slides in (the pit breathes in), one on the hole falls at once
    const rim = spawnAt(tg, 'slime', { x: hole.x + 2.5, y: hole.y });
    rim.statuses.push({ id: 'stun', remaining: 9, total: 9, value: 0, sourcePlayer: null });
    advance(tg, 1);
    expect(rim.rt.gone).toBe(true);
    expect(ev.progress).toBe(3);
    spawnAt(tg, 'slime', { x: hole.x + 0.3, y: hole.y });
    tick(tg.w);
    expect(tg.w.spawner.kills).toBe(kills + 2);
    expect(tg.w.state.players[0].stats.kills).toBe(0);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ id: 'open_shaft', success: true, player: null });
    const p = tg.w.state.players[0];
    expect(p.party.every((m, i) => i === p.activeIndex || m.swapCooldownRemaining === 0)).toBe(true);
  });
});

describe('23:59 정각', () => {
  it('12 shadows over 2 s (not counted for the floor); 10 kills → 아침 햇살 for everyone; leftovers vanish', () => {
    const { tg, ev } = started('midnight_surge', [HUMAN, HUMAN2]);
    parkChars(tg, { x: 1, y: 1 });
    advance(tg, 2.1);
    expect(tg.w.fieldEvents.spawned).toBe(12);
    const shadows = tg.w.state.entities.filter(e => e.eventTag === 'minion' && e.hp > 0);
    expect(shadows.length).toBeGreaterThanOrEqual(10);
    expect(countEnemies(tg.w)).toBe(0);
    expect(ev.remaining).toBeGreaterThan(getFieldEvent('midnight_surge').duration - 0.2);
    for (const s of shadows) if (tg.w.state.fieldEvent) applyDamage(tg.w, basicHit(1), s, 1e6, false);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ id: 'midnight_surge', success: true, player: 1 });
    for (const p of tg.w.state.players) expect(p.goedamTraces.some(t => t.id === 'morning_light')).toBe(true);
    expect(tg.w.state.entities.some(e => e.eventTag === 'minion' && !e.rt.gone)).toBe(false);
  });
});

describe('꺼지는 비상등', () => {
  afterEach(() => {
    const g = CHARACTERS.find(c => c.id === 'guardian')!;
    g.drag.actions[1].area = { shape: 'single' };
  });

  it('lit by a drop point, by a heal footprint, by standing 1.5 s; never by a self-only part; 3 → enemies exposed', () => {
    const { tg, ev } = started('dark_lamps', [P_CLERIC]);
    const [l0, l1, l2] = ev.marks;
    const s = tg.w.state;
    // self-only part: even a huge one does not light (mutated data, restored in afterEach)
    CHARACTERS.find(c => c.id === 'guardian')!.drag.actions[1].area = { shape: 'circle', radius: 6 };
    const far = { x: l0.pos.x, y: l0.pos.y + (l0.pos.y > 6 ? -3.5 : 3.5) };
    expect(dropOutcome(s, 0, 'swap', 0, far)!.lamps).not.toContain(0);
    // heal footprint (cleric spring, radius 3) from 2.5 away
    expect(dropOutcome(s, 0, 'swap', 1, { x: l1.pos.x + 2.5, y: l1.pos.y })!.lamps).toContain(1);
    // a drop right on a lamp
    const slime = spawnAt(tg, 'slime', { x: l0.pos.x + 1, y: l0.pos.y });
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { ...l0.pos } }).ok).toBe(true);
    expect(l0.doneBy).toBe(0);
    expect(slime.statuses.some(x => x.id === 'stun')).toBe(true);
    // standing
    const me = active(tg);
    me.pos = { x: l2.pos.x + 0.5, y: l2.pos.y };
    me.targetId = null;
    advance(tg, 1.0);
    expect(l2.doneBy).toBeNull();
    me.pos = { x: l2.pos.x + 0.5, y: l2.pos.y };
    advance(tg, 0.6);
    expect(l2.doneBy).toBe(0);
    const ogre = spawnAt(tg, 'ogre', { x: 2, y: 2 });
    ogre.statuses.push({ id: 'stun', remaining: 9, total: 9, value: 0, sourcePlayer: 0 });
    me.pos = { x: l1.pos.x, y: l1.pos.y };
    me.statuses.push({ id: 'stun', remaining: 3, total: 3, value: 0, sourcePlayer: null }); // stays put
    advance(tg, 1.6);
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ id: 'dark_lamps', success: true, player: 0 });
    expect(ogre.statuses.find(x => x.id === 'vulnerable')?.value).toBeCloseTo(0.25, 5);
  });
});

describe('깨우면 안 되는 아이', () => {
  it('walks only with an escort; an enemy footprint startles it (back 3, cries), a heal footprint does not; exit → 작은 손', () => {
    const { tg, ev } = started('sleepwalker', [P_CLERIC, HUMAN2]);
    const ch = unit(tg, ev);
    parkChars(tg, { x: ch.pos.x > 18 ? 2 : 34, y: 1 });
    advance(tg, 1);
    expect(ev.progress).toBe(0);
    const s = tg.w.state;
    expect(dropOutcome(s, 0, 'swap', 1, { ...ch.pos })!.startle).toBe(false); // cleric spring: allies only
    expect(dropOutcome(s, 0, 'swap', 2, { ...ch.pos })!.startle).toBe(true); // mage meteors
    // escort: stand next to it
    for (const e of s.entities) if (e.kind === 'character') e.pos = { x: ch.pos.x, y: ch.pos.y + 1 };
    advance(tg, 4);
    expect(ev.progress).toBeGreaterThan(3.5);
    const before = ev.progress;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { ...ch.pos } });
    expect(ev.progress).toBeCloseTo(before - 3, 3);
    expect(ev.startled).toBeGreaterThan(1.9);
    expect(eventsOf(tg, 'fieldEventProgress').at(-1)).toMatchObject({ kind: 'startle', player: 0 });
    // walk the rest with an escort glued to it
    for (let t = 0; t < 30 * 24 && tg.w.state.fieldEvent; t++) {
      for (const e of s.entities) if (e.kind === 'character') e.pos = { x: ch.pos.x, y: ch.pos.y + 1 };
      tick(tg.w);
    }
    expect(eventsOf(tg, 'fieldEventEnd').at(-1)).toMatchObject({ id: 'sleepwalker', success: true });
    for (const p of s.players) expect(p.goedamTraces.some(t => t.id === 'small_hand')).toBe(true);
  });
});

describe('every event both ways, and no stalls', () => {
  it('each event can be forced, succeed is reachable through its own rules and failure ends it on time', () => {
    for (const def of FIELD_EVENTS) {
      const { tg, ev } = started(def.id, [HUMAN]);
      const total = def.duration + (def.id === 'midnight_surge' ? def.params.spawnIn : 0);
      parkChars(tg, { x: 1, y: 1 });
      if (ev.id === 'possessed_printer') tg.w.tunables.maxAliveMonsters = 0; // no prints to fight
      advance(tg, total + 0.2);
      expect(tg.w.state.fieldEvent, def.id).toBeNull();
      expect(tg.w.fieldEvents.history.at(-1), def.id).toMatchObject({ id: def.id });
      expect(tg.w.state.entities.some(e => e.eventTag), def.id).toBe(false);
    }
  });

  it('bots only, slider at 1, seeds 1..12 × floors 2–9: every floor ends, never with an event open', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const tg = makeGame({ seed, players: [BOT1, BOT2], startFloor: 2, tunables: { fieldEventChance: 1, invincible: true, maxFloor: 9, monsterHpMult: 0.4 } });
      const s = tg.w.state;
      let floor = s.floor;
      let floorTicks = 0;
      for (let t = 0; t < 30 * 60 * 15 && s.phase !== 'runOver'; t++) {
        if (s.phase !== 'combat') {
          expect(s.fieldEvent).toBeNull();
          continue;
        }
        tick(tg.w);
        floorTicks = s.floor === floor ? floorTicks + 1 : 0;
        floor = s.floor;
        expect(floorTicks, `seed ${seed} floor ${floor}`).toBeLessThan(30 * 125);
      }
      expect(s.runResult?.outcome, `seed ${seed}`).toBe('victory');
      expect(tg.w.fieldEvents.history.length).toBeGreaterThan(4);
    }
  }, 30_000);
});

describe('integration with the 12차 characters', () => {
  it('메딕 응급 주사 (woundedAlly) picks the sleeping patient when it is the most hurt ally in range', () => {
    const P_MEDIC: PlayerSetup = { name: '메', isBot: false, characters: ['medic', 'guardian', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'golem_turret'] };
    const { tg, ev } = started('sleeping_patient', [P_MEDIC]);
    const pt = unit(tg, ev);
    const me = active(tg);
    me.pos = { x: pt.pos.x + 2, y: pt.pos.y };
    // something to fight in reach so the normal skill is "in combat"
    spawnAt(tg, 'slime', { x: me.pos.x + 1, y: me.pos.y }).statuses.push({ id: 'stun', remaining: 9, total: 9, value: 0, sourcePlayer: null });
    tg.w.state.players[0].party[0].normalCooldownRemaining = 0;
    const before = pt.hp;
    advance(tg, 1);
    const cast = eventsOf(tg, 'skillCast').find(c => c.skillId === 'medic_n');
    expect(cast).toBeTruthy();
    expect(cast!.center).toEqual(pt.pos);
    expect(pt.hp).toBeGreaterThan(before);
  });

  it('a pet summon dropped next to a target locks onto it; an inert 종이 인형 never does', () => {
    const P_PET: PlayerSetup = { name: '펫', isBot: false, characters: ['puppeteer', 'guardian', 'mage'], pets: ['golem_turret', 'fairy_heal', 'frog_bomb'] };
    const { tg, ev } = started('possessed_printer', [P_PET]);
    const pr = unit(tg, ev);
    const spot = { x: pr.pos.x + (pr.pos.x > 18 ? -1.5 : 1.5), y: pr.pos.y };
    spawnAt(tg, 'slime', { x: spot.x + 0.5, y: spot.y + 0.5 }).statuses.push({ id: 'stun', remaining: 9, total: 9, value: 0, sourcePlayer: null });
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: spot }).ok).toBe(true);
    const turret = tg.w.state.entities.find(e => e.defId === 'turret')!;
    expect(turret.targetId).toBe(pr.id);
    expect(dropOutcome(tg.w.state, 0, 'swap', 0, spot)!.lockTargetId).toBe(pr.id); // the puppeteer herself locks
    for (const e of tg.w.state.entities) if (e.defId === 'paper_doll') expect(e.targetId).toBeNull();
    // the turret is the pet's: its shots are 약점 hits (×2) too
    advance(tg, 3);
    const shots = eventsOf(tg, 'damage').filter(d => d.targetId === pr.id && d.source === 'summon');
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every(d => d.weak)).toBe(true);
  });

  it("a paper doll's burst (part of the drag skill) is a 약점 hit on a target", () => {
    const P_DOLL: PlayerSetup = { name: '인형', isBot: false, characters: ['puppeteer', 'guardian', 'mage'], pets: ['golem_turret', 'fairy_heal', 'frog_bomb'] };
    const { tg, ev } = started('possessed_printer', [P_DOLL]);
    const pr = unit(tg, ev);
    const at = { x: pr.pos.x + (pr.pos.x > 18 ? -1.2 : 1.2), y: pr.pos.y };
    const doll = createUnit(tg.w, getMonster('paper_doll'), at, 'ally', { kind: 'summon', ownerPlayer: 0, expiresIn: 6, hpMult: 1, atkMult: 1 });
    doll.rt.summonSlot = 'drag';
    applyDamage(tg.w, { casterId: null, team: 'enemy', player: null, source: 'basic', isDrag: false }, doll, 1e6, false);
    advance(tg, 0.2);
    const burst = eventsOf(tg, 'damage').filter(d => d.targetId === pr.id && d.source === 'drag');
    expect(burst.length).toBe(1);
    expect(burst[0].weak).toBe(true);
  });
});
