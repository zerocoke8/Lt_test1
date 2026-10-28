// 기획 22차 궁극기 테스트 (docs/ult-test.md): the mode (a raid with per-player ult modes), the aimed / dragged ult
// command, the FALLBACK for characters without their own design (조준: area ults re-centred on the point, direction
// ults turned toward it, self-buffs unchanged; 드래그: blink to the point — capped — then today's ult), the alt
// registry (rel 'aim', move dash / path), the bots, the debug switch — and that nothing changes in any other mode.
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import { ULT_GROUP_A_IDS, ULT_GROUP_B_IDS, ULT_TEST, setUltAltFixture, ultAltEntries } from '../../src/data/ultTest';
import { tick } from '../../src/sim/game';
import { aimFallback, botUltAim, planUlt, turnAimParts } from '../../src/sim/ultTest';
import { hasStatus } from '../../src/sim/status';
import { activeEntity } from '../../src/sim/world';
import type { Command, GameEvent, PlayerSetup, SkillAction, UltAimMode } from '../../src/types';
import { BOT1, BOT2, HUMAN, advance, clearEvents, drain, makeGame, type TestGame } from './helpers';

const BOSS = 'elevator_keeper'; // fixed at the top centre (12, −1.2), radius 3

function ultGame(mode: UltAimMode, opts: { chars?: string[]; players?: PlayerSetup[]; seed?: number } = {}): TestGame {
  const human: PlayerSetup = { ...HUMAN, ...(opts.chars ? { characters: opts.chars } : null), ultMode: mode };
  const tg = makeGame({
    seed: opts.seed ?? 22,
    mode: 'ultTest',
    players: opts.players ?? [human],
    tunables: { invincible: true },
    bossRaid: { onlyBoss: BOSS, hpMult: 50 },
  });
  advance(tg, 0.5);
  return tg;
}

function charge(tg: TestGame): void {
  tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
}

/** Every 'skillCast' of my ult since the last clear (ult slot), after letting it land. */
function ultCasts(tg: TestGame): Extract<GameEvent, { type: 'skillCast' }>[] {
  return drain(tg).filter((e): e is Extract<GameEvent, { type: 'skillCast' }> => e.type === 'skillCast' && e.slot === 'ult' && e.player === 0);
}

function lastUltCast(tg: TestGame): Extract<GameEvent, { type: 'ultCast' }> | undefined {
  return drain(tg).filter((e): e is Extract<GameEvent, { type: 'ultCast' }> => e.type === 'ultCast' && e.player === 0).pop();
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;

afterEach(() => {
  for (const id of CHARACTERS.map(c => c.id)) setUltAltFixture(id, null);
});

describe('the mode', () => {
  it('is a raid (the raid plan on every floor) with a per-player ult mode; bot seats play the first human’s mode', () => {
    const tg = makeGame({ seed: 3, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'drag' }, BOT1, BOT2], bossRaid: { onlyBoss: BOSS } });
    const s = tg.w.state;
    expect(s.mode).toBe('ultTest');
    expect(tg.w.bossRaid).toBeDefined();
    expect(s.plan.kind).toBe('boss');
    expect(s.plan.bossId).toBe(BOSS);
    expect(s.players.map(p => p.ultMode)).toEqual(['drag', 'drag', 'drag']);
    // a seat without a mode (a human who never picked) is 'now'
    const t2 = makeGame({ seed: 3, mode: 'ultTest', players: [HUMAN, { ...BOT1, ultMode: 'aim' }] });
    expect(t2.w.state.players.map(p => p.ultMode)).toEqual(['now', 'aim']);
    // the raid itself never has the field
    const raid = makeGame({ seed: 3, mode: 'bossRaid', players: [{ ...HUMAN, ultMode: 'aim' }] });
    expect(raid.w.state.mode).toBe('bossRaid');
    expect(raid.w.state.players[0].ultMode).toBeUndefined();
  });

  it('the boss order is the raid’s (same seed → same 20 bosses)', () => {
    const a = makeGame({ seed: 77, mode: 'ultTest' });
    const b = makeGame({ seed: 77, mode: 'bossRaid' });
    expect(a.w.bossRaid!.order).toEqual(b.w.bossRaid!.order);
  });

  it('the content split covers the roster in order, each character once; every registered key is a character', () => {
    expect([...ULT_GROUP_A_IDS, ...ULT_GROUP_B_IDS]).toEqual(CHARACTERS.map(c => c.id));
    const ids = new Set(CHARACTERS.map(c => c.id));
    for (const [id, set] of ultAltEntries()) {
      expect(ids.has(id), id).toBe(true);
      for (const def of [set.aim, set.drag]) {
        if (!def) continue;
        expect(def.slot, def.id).toBe('ult');
        expect(def.actions.length, def.id).toBeGreaterThan(0);
        if (def.move) expect(def.move.maxRange, def.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('tap = today', () => {
  it('a tap (no aim) in 조준 mode casts today’s ult exactly like the raid', () => {
    const run = (mode: 'ultTest' | 'bossRaid') => {
      const tg = makeGame({ seed: 9, mode, players: [{ ...HUMAN, ultMode: 'aim' }], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS, hpMult: 50 } });
      advance(tg, 0.5);
      charge(tg);
      clearEvents(tg);
      expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
      advance(tg, 1.5);
      return JSON.stringify(drain(tg));
    };
    expect(run('ultTest')).toBe(run('bossRaid'));
  });

  it('the aim of a command is ignored in the classic tower, the raid and 원정 (same events as a tap)', () => {
    const aim = { mode: 'aim' as const, point: { x: 2, y: 2 } };
    for (const setup of [{}, { mode: 'bossRaid' as const, bossRaid: { onlyBoss: BOSS } }, { expedition: { stage: 3 } }]) {
      const run = (withAim: boolean) => {
        const tg = makeGame({ seed: 4, players: [HUMAN], tunables: { invincible: true }, ...setup });
        advance(tg, 0.5);
        charge(tg);
        clearEvents(tg);
        tg.game.dispatch(withAim ? { type: 'ult', player: 0, aim } : { type: 'ult', player: 0 });
        advance(tg, 2);
        return JSON.stringify(drain(tg)) + JSON.stringify(tg.w.state.entities.map(e => [e.id, e.pos, e.hp]));
      };
      expect(run(true), JSON.stringify(setup)).toBe(run(false));
    }
  });
});

describe('조준 fallback (no own design yet)', () => {
  it('an area ult (가디언 불굴의 성채): its parts land on the aimed point, the whole-field shield stays on the caster', () => {
    const tg = ultGame('aim');
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { ...me.pos };
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 4, y: 9 } } }).ok).toBe(true);
    expect(me.pos).toEqual(from); // 조준 never moves the caster
    advance(tg, 1.2);
    const casts = ultCasts(tg);
    const byStage = (st: string) => casts.filter(c => c.stage === st);
    expect(near(byStage('aegis')[0].center, from)).toBe(true); // ALL: every ally, where it always was
    for (const st of ['rally', 'citadel', 'barrier']) for (const c of byStage(st)) expect(near(c.center, { x: 4, y: 9 }), st).toBe(true);
    expect(lastUltCast(tg)?.aim).toEqual({ mode: 'aim', x: 4, y: 9 });
  });

  it('a target ult (메이지 블리자드): the enemy nearest the point is the target, else the point itself', () => {
    const tg = ultGame('aim', { chars: ['mage', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 5, y: 10 } } });
    advance(tg, 0.6);
    for (const c of ultCasts(tg)) expect(near(c.center, { x: 5, y: 10 }), c.stage).toBe(true);
    // next one at the boss's feet (edge within the snap radius) → on the boss
    advance(tg, 6);
    charge(tg);
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 2 } } });
    advance(tg, 0.6);
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    for (const c of ultCasts(tg)) expect(near(c.center, boss.pos, 1e-6), c.stage).toBe(true);
  });

  it('a direction ult (블레이드 천검난무): the horizontal cut is turned toward the point; nothing else moves', () => {
    const tg = ultGame('aim', { chars: ['blade', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const pt = { x: me.pos.x, y: me.pos.y + 4 }; // straight down = 90°
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: pt } });
    advance(tg, 3);
    const issen = ultCasts(tg).find(c => c.stage === 'issen')!;
    expect(issen.area).toMatchObject({ shape: 'rect', rot: 90 });
    const hop = ultCasts(tg).find(c => c.stage === 'hop')!;
    expect(hop.area).toEqual({ shape: 'circle', radius: 1.3 });
  });

  it('pure: a line ult and a dash ult are turned toward the aim; a self buff never changes', () => {
    const line: SkillAction = { center: 'target', follow: true, area: { shape: 'line', length: 8, width: 1.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] };
    const dash: SkillAction = { center: 'self', area: { shape: 'rect', dir: 'right', anchor: 'start', length: 6, width: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }], dash: { dir: 'right', distance: 6 } };
    const buff: SkillAction = { center: 'self', area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'status', status: 'atkUp', duration: 8, value: 0.5 }] };
    const zone: SkillAction = { center: 'self', delay: 0.45, area: { shape: 'circle', radius: 4 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] };
    // a line: aimed at the point (center 'point', no follow)
    const [l] = aimFallback([line], 135);
    expect(l.center).toBe('point');
    expect(l.follow).toBeUndefined();
    // a dash + its path band: turned by aim − its own direction (0°) → 270° (up); the buff as it was
    const [d, b, z] = aimFallback([dash, buff, zone], 270);
    expect(d.dash).toEqual({ dir: 'right', distance: 6, rot: 270 });
    expect(d.area).toMatchObject({ shape: 'rect', rot: 270 });
    expect(b).toEqual(buff);
    expect(z.center).toBe('self'); // a direction ult keeps its centres
    // an area ult: the circle goes to the point, the buff stays on the caster
    const [b2, z2] = aimFallback([buff, zone], 45);
    expect(b2).toEqual(buff);
    expect(z2.center).toBe('point');
    // a dash ult cast for real: the caster dashes up toward the point (the dash part is an alt with rel 'aim')
    setUltAltFixture('blade', { aim: { id: 'blade_ua', name: '시험 돌진', slot: 'ult', description: '', castTime: 0.5, actions: [{ ...dash, rel: 'aim' }] } });
    const tg = ultGame('aim', { chars: ['blade', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { ...me.pos };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: from.x, y: from.y - 3 } } });
    const ev = drain(tg).find(e => e.type === 'dash');
    expect(ev).toBeDefined();
    expect(me.pos.x).toBeCloseTo(from.x, 6);
    expect(me.pos.y).toBeLessThan(from.y - 2.5); // went up (clamped at the top edge)
    expect(lastUltCast(tg)).toMatchObject({ skillId: 'blade_ua', name: '시험 돌진', aim: { mode: 'aim', alt: true } });
  });

  it('a self buff (버서커 광란) stays on the caster; its roar goes to the point', () => {
    const tg = ultGame('aim', { chars: ['berserker', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 3, y: 3 } } });
    advance(tg, 0.6);
    const casts = ultCasts(tg);
    expect(near(casts.find(c => c.stage === 'roar')!.center, { x: 3, y: 3 })).toBe(true);
    expect(hasStatus(me, 'atkUp')).toBe(true);
    expect(hasStatus(me, 'lifesteal')).toBe(true);
  });

  it('the aimed point is clamped to the arena', () => {
    const tg = ultGame('aim');
    charge(tg);
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: -50, y: 99 } } });
    expect(lastUltCast(tg)?.aim).toMatchObject({ x: 0.5, y: tg.w.state.plan.arena.height - 0.5 });
  });

  it('every one of the 15 casts its fallback 조준 and 드래그 without a bad number', () => {
    for (const c of CHARACTERS) {
      for (const mode of ['aim', 'drag'] as const) {
        const tg = ultGame(mode, { chars: [c.id, c.id === 'guardian' ? 'blade' : 'guardian', c.id === 'cleric' ? 'bard' : 'cleric'], seed: 5 });
        charge(tg);
        clearEvents(tg);
        expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point: { x: 6, y: 4 } } }).ok, `${c.id} ${mode}`).toBe(true);
        advance(tg, 9);
        const casts = ultCasts(tg);
        expect(casts.length, `${c.id} ${mode}`).toBe(getCharacter(c.id).ult.actions.length);
        for (const k of casts) expect(Number.isFinite(k.center.x) && Number.isFinite(k.center.y), `${c.id} ${mode} ${k.stage}`).toBe(true);
        expect(tg.w.state.players[0].stats.ultsUsed).toBe(1);
      }
    }
  });
});

describe('드래그', () => {
  it('fallback: blinks to the point (at most ULT_TEST.dragRange away) and casts today’s ult there', () => {
    const tg = ultGame('drag');
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { ...me.pos };
    const far = { x: 23, y: 11 };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: far } });
    const blink = drain(tg).find((e): e is Extract<GameEvent, { type: 'blink' }> => e.type === 'blink' && e.entityId === me.id);
    expect(blink).toBeDefined();
    const moved = Math.hypot(me.pos.x - from.x, me.pos.y - from.y);
    expect(moved).toBeCloseTo(Math.min(ULT_TEST.dragRange, Math.hypot(far.x - from.x, far.y - from.y)), 6);
    // along the line toward the point
    const u = { x: (far.x - from.x) / Math.hypot(far.x - from.x, far.y - from.y), y: (far.y - from.y) / Math.hypot(far.x - from.x, far.y - from.y) };
    expect(near(me.pos, { x: from.x + u.x * moved, y: from.y + u.y * moved }, 1e-6)).toBe(true);
    const at = { ...me.pos };
    advance(tg, 1.2);
    const casts = ultCasts(tg);
    // today's ult, centred where it landed
    for (const c of casts.filter(c => c.stage === 'rally' || c.stage === 'citadel')) expect(near(c.center, at, 1e-6)).toBe(true);
    expect(lastUltCast(tg)?.aim).toMatchObject({ mode: 'drag', x: at.x, y: at.y });
  });

  it('a point within range: lands exactly there; an alt with move dash + path hits along the way', () => {
    setUltAltFixture('guardian', {
      drag: {
        id: 'guardian_ud',
        name: '시험 돌격',
        slot: 'ult',
        description: '',
        castTime: 0.5,
        move: { kind: 'dash', maxRange: 6, path: { width: 2, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] } },
        actions: [{ stage: 'land', center: 'self', delay: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] }],
      },
    });
    const tg = ultGame('drag');
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { ...me.pos };
    const pt = { x: from.x + 3, y: from.y + 1 };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: pt } });
    expect(near(me.pos, pt, 1e-9)).toBe(true);
    const ev = drain(tg);
    expect(ev.some(e => e.type === 'dash' && e.entityId === me.id)).toBe(true);
    advance(tg, 1);
    const casts = ultCasts(tg);
    expect(casts.map(c => c.stage)).toEqual(['path', 'land']);
    expect(casts[0].area).toMatchObject({ shape: 'line', width: 2 });
    expect(lastUltCast(tg)).toMatchObject({ skillId: 'guardian_ud', aim: { mode: 'drag', alt: true } });
    // capped by the alt's own range
    advance(tg, 3);
    charge(tg);
    clearEvents(tg);
    const f2 = { ...me.pos };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: f2.x - 20, y: f2.y } } });
    expect(Math.hypot(me.pos.x - f2.x, me.pos.y - f2.y)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('rel aim parts of an alt are turned the way the character moved', () => {
    const cone: SkillAction = { rel: 'aim', center: 'self', offset: { x: 2, y: 0 }, area: { shape: 'cone', radius: 4, angle: 60, dir: 'right' }, affects: 'enemies', effects: [] };
    const [t] = turnAimParts([cone], 90);
    expect(t.rel).toBeUndefined();
    expect(t.area).toMatchObject({ shape: 'cone', rot: 90 });
    expect(t.offset).toEqual({ x: 0, y: 2 });
  });
});

describe('the command and its checks', () => {
  it('an aim of the other mode is refused (gauge kept); the debug switch changes every player, or one', () => {
    const tg = makeGame({ seed: 8, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'aim' }, BOT1], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS } });
    advance(tg, 0.3);
    charge(tg);
    const r = tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: 5, y: 5 } } });
    expect(r).toEqual({ ok: false, reason: '궁극기 방식이 바뀌었어요' });
    expect(tg.w.state.players[0].stats.ultsUsed).toBe(0);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'ultMode', mode: 'drag' } }).ok).toBe(true);
    expect(tg.w.state.players.map(p => p.ultMode)).toEqual(['drag', 'drag']);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'ultMode', mode: 'now', player: 1 } }).ok).toBe(true);
    expect(tg.w.state.players.map(p => p.ultMode)).toEqual(['drag', 'now']);
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: 5, y: 5 } } }).ok).toBe(true);
    // outside the mode the switch is refused
    const raid = makeGame({ seed: 8, mode: 'bossRaid' });
    expect(raid.game.dispatch({ type: 'debug', action: { kind: 'ultMode', mode: 'aim' } })).toEqual({ ok: false, reason: '궁극기 테스트 전용' });
  });

  it('the plan is pure and equals what is cast (the client previews exactly this)', () => {
    const tg = ultGame('aim', { chars: ['paladin', 'guardian', 'cleric'] });
    charge(tg);
    const plan = planUlt(tg.w.state, 0, { mode: 'aim', point: { x: 7, y: 8 } })!;
    expect(plan.point).toEqual({ x: 7, y: 8 });
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 7, y: 8 } } });
    advance(tg, 1.5);
    const casts = ultCasts(tg);
    // the 8 spears keep their offsets around the point
    const spears = casts.filter(c => c.stage === 'spear');
    expect(spears).toHaveLength(8);
    plan.actions.filter(a => a.stage === 'spear').forEach((a, i) => expect(near(spears[i].center, { x: 7 + a.offset!.x, y: 8 + a.offset!.y })).toBe(true));
  });
});

describe('the docs/ult-test.md 5-3 examples (the content contract)', () => {
  it('mage 조준 meteor on the point · blade 드래그 dash + path + turned cut · cleric 조준 self buff + ally zone', () => {
    setUltAltFixture('mage', {
      aim: {
        id: 'mage_ua', name: '유성 낙하', slot: 'ult', castTime: 0.5, description: '',
        actions: [{ stage: 'meteor', center: 'point', delay: 0.8, area: { shape: 'circle', radius: 3.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 4 }, { kind: 'status', status: 'stun', duration: 1, value: 0 }] }],
      },
    });
    setUltAltFixture('blade', {
      drag: {
        id: 'blade_ud', name: '질풍 일섬', slot: 'ult', castTime: 0.5, description: '',
        move: { kind: 'dash', maxRange: 8, path: { width: 2, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] } },
        actions: [{ stage: 'issen', rel: 'aim', center: 'self', delay: 0.6, area: { shape: 'rect', dir: 'right', anchor: 'start', length: 7, width: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 3 }] }],
      },
    });
    setUltAltFixture('cleric', {
      aim: {
        id: 'cleric_ua', name: '성역', slot: 'ult', castTime: 0.5, botAim: 'ally', description: '',
        actions: [
          { stage: 'grace', center: 'self', delay: 0.45, area: { shape: 'single' }, affects: 'self', effects: [{ kind: 'status', status: 'defUp', duration: 6, value: 0.2 }] },
          { stage: 'halo', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 3 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.04 }], zone: { duration: 5, tickInterval: 0.5 } },
        ],
      },
    });
    // mage
    let tg = ultGame('aim', { chars: ['mage', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 7, y: 9 } } });
    advance(tg, 1);
    expect(ultCasts(tg).map(c => [c.skillId, c.stage, c.center])).toEqual([['mage_ua', 'meteor', { x: 7, y: 9 }]]);
    // blade: dashes up to 8 cells toward the point, the cut turned the way it moved
    tg = ultGame('drag', { chars: ['blade', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { ...me.pos };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: from.x, y: 11.5 } } });
    expect(me.pos.x).toBeCloseTo(from.x, 6);
    advance(tg, 1);
    const bc = ultCasts(tg);
    expect(bc.map(c => c.stage)).toEqual(['path', 'issen']);
    expect(bc[1].area).toMatchObject({ shape: 'rect', rot: 90 });
    // cleric: the buff on itself, the healing zone on the point
    tg = ultGame('aim', { chars: ['cleric', 'guardian', 'mage'] });
    charge(tg);
    clearEvents(tg);
    const cl = activeEntity(tg.w, tg.w.state.players[0])!;
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 4, y: 4 } } });
    advance(tg, 0.6);
    expect(hasStatus(cl, 'defUp')).toBe(true);
    expect(tg.w.state.zones.some(z => z.ownerPlayer === 0 && near(z.center, { x: 4, y: 4 }) && z.kind === 'heal')).toBe(true);
  });
});

describe('bots and determinism', () => {
  it('a bot in 조준 aims at the boss; in 드래그 it lands next to it', () => {
    for (const mode of ['aim', 'drag'] as const) {
      const tg = makeGame({ seed: 12, mode: 'ultTest', players: [{ ...HUMAN, ultMode: mode }, BOT1], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS, hpMult: 50 } });
      advance(tg, 0.5);
      const aim = botUltAim(tg.w.state, 1)!;
      expect(aim.mode).toBe(mode);
      const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
      if (mode === 'aim') expect(aim.point).toEqual(boss.pos);
      else expect(Math.hypot(aim.point.x - boss.pos.x, aim.point.y - boss.pos.y)).toBeCloseTo(boss.radius + 0.45 + 0.5, 6);
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
      advance(tg, 4);
      const cast = tg.events.find((e): e is Extract<GameEvent, { type: 'ultCast' }> => e.type === 'ultCast' && e.player === 1);
      expect(cast?.aim?.mode, mode).toBe(mode);
    }
  });

  it('the same seed and commands → the same game (bots aiming included)', () => {
    const run = () => {
      const tg = makeGame({ seed: 31, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'aim' }, BOT1, BOT2], tunables: { ultFieldChargeTime: 3 }, bossRaid: { onlyBoss: BOSS, hpMult: 3 } });
      const plan: Record<number, Command> = {
        60: { type: 'debug', action: { kind: 'chargeUlt' } },
        61: { type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 2 } } },
        200: { type: 'debug', action: { kind: 'ultMode', mode: 'drag' } },
        201: { type: 'debug', action: { kind: 'chargeUlt' } },
        202: { type: 'ult', player: 0, aim: { mode: 'drag', point: { x: 8, y: 3 } } },
      };
      let h = '';
      for (let t = 0; t < 900 && tg.w.state.phase === 'combat'; t++) {
        if (plan[t]) tg.game.dispatch(plan[t]);
        tick(tg.w);
        if (t % 30 === 0) h += JSON.stringify(tg.w.state.entities.map(e => [e.id, Math.round(e.pos.x * 1e6), Math.round(e.hp * 1e6)]));
      }
      const ev = drain(tg);
      return { h, ults: ev.filter(e => e.type === 'ultCast').length, n: ev.length };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.ults).toBeGreaterThan(2);
  });
});
