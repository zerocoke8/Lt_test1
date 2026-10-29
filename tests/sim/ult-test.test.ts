// 기획 22차 궁극기 테스트 (docs/ult-test.md): the mode (a raid with per-player ult modes), the aimed / dragged ult
// command, the FALLBACK for characters without their own design (조준: area ults re-centred on the point, direction
// ults turned toward it, self-buffs unchanged; 드래그: blink to the point — capped — then today's ult), the alt
// registry (rel 'aim', move dash / path), the bots, the debug switch — and that nothing changes in any other mode.
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import { ULT_GROUP_A_IDS, ULT_GROUP_B_IDS, ULT_TEST, setUltAltFixture, ultAltEntries } from '../../src/data/ultTest';
import { tick } from '../../src/sim/game';
import { aimFallback, botUltAim, planUlt, turnAimParts, ultPreviewParts } from '../../src/sim/ultTest';
import { BOT_ULT_HOLD, dragUltWaits, tickBots } from '../../src/sim/bot';
import { familyEligible } from '../../src/sim/rewards/offers';
import { getFamily } from '../../src/data/rewards';
import { hasStatus } from '../../src/sim/status';
import { activeEntity } from '../../src/sim/world';
import type { Command, CommandResult, GameEvent, PlayerSetup, SkillAction, UltAimMode } from '../../src/types';
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

// every character has its own 조준 / 드래그 design now: these tests turn it off (setUltAltFixture(id, {})) to keep the
// fallback (the safety net for a design that is removed) covered; afterEach puts the data back
describe('조준 fallback (a character without its own design)', () => {
  it('an area ult (가디언 불굴의 성채): its parts land on the aimed point, the whole-field shield stays on the caster', () => {
    setUltAltFixture('guardian', {});
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
    setUltAltFixture('mage', {});
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
    setUltAltFixture('blade', {});
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
    setUltAltFixture('berserker', {});
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
        setUltAltFixture(c.id, {});
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
    setUltAltFixture('guardian', {});
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
    setUltAltFixture('paladin', {}); // the fallback: today's spears re-centred around the point
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

// ─────────────────────────── 기획 22차 리뷰 fixes ───────────────────────────

describe('review fixes', () => {
  const stageOf = (tg: TestGame, skillId: string, stage: string) =>
    drain(tg).filter((e): e is Extract<GameEvent, { type: 'skillStage' }> => e.type === 'skillStage' && e.skillId === skillId && e.stage === stage);

  it('블레이드 조준: swapped out mid-storm, the remaining waves stay where the blade left — never on the aimed point', () => {
    const tg = ultGame('aim', { chars: ['blade', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const pt = { x: Math.min(22, me.pos.x + 10), y: me.pos.y };
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: pt } }).ok).toBe(true);
    advance(tg, 0.6);
    const left = { ...me.pos };
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 4, y: 9 } }).ok).toBe(true);
    advance(tg, 1.2);
    const waves = stageOf(tg, 'blade_ua', 'storm');
    expect(waves).toHaveLength(10);
    for (const w of waves) {
      expect(Math.hypot(w.center.x - pt.x, w.center.y - pt.y), `wave ${w.hit}`).toBeGreaterThan(5);
      expect(Math.hypot(w.center.x - left.x, w.center.y - left.y), `wave ${w.hit}`).toBeLessThan(0.6);
    }
  });

  it('블레이드 드래그 preview: the return slash is as long as the path really travelled (a wall cut the run short)', () => {
    const tg = ultGame('drag', { chars: ['blade', 'guardian', 'cleric'] });
    charge(tg);
    clearEvents(tg);
    const aim = { mode: 'drag' as const, point: { x: 12, y: 2.4 } };
    const plan = planUlt(tg.w.state, 0, aim)!;
    const preview = ultPreviewParts(tg.w.state, 0, plan);
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
    const ret = drain(tg).find((e): e is Extract<GameEvent, { type: 'skillCast' }> => e.type === 'skillCast' && e.skillId === 'blade_ud' && e.actionIndex === 1)!;
    expect(ret.area).toEqual(preview[1].area);
    expect(near(ret.center, preview[1].center)).toBe(true);
    expect(ret.area.shape === 'line' && ret.area.length).toBeLessThan(7);
  });

  it('드래그 onto a fixed boss body: lands at its near edge (the preview’s ring), still facing the boss', () => {
    const tg = ultGame('drag'); // guardian 성벽 대강림
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    me.pos.x = 12;
    me.pos.y = 8;
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    const aim = { mode: 'drag' as const, point: { x: 12, y: 0.6 } }; // on the boss (12, −1.2), radius 3
    const plan = planUlt(tg.w.state, 0, aim)!;
    const edge = { x: 12, y: boss.pos.y + boss.radius + me.radius };
    expect(near(plan.point, edge, 1e-9)).toBe(true);
    expect(near(plan.move!.to, edge, 1e-9)).toBe(true);
    expect(plan.aimDeg).toBe(270);
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
    expect(near(me.pos, edge, 1e-9)).toBe(true);
    advance(tg, 0.3);
    expect(Math.hypot(me.pos.x - edge.x, me.pos.y - edge.y)).toBeLessThan(0.05); // nothing pushes it any more
  });

  it('a 조준 / 드래그 aim is measured from where the sender’s screen had the character (within ULT_TEST.fromSlack)', () => {
    const tg = ultGame('aim', { chars: ['blade', 'guardian', 'cleric'] });
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    me.pos.x = 10;
    me.pos.y = 8;
    const point = { x: 10, y: 4 };
    // the screen had it 1.5 cells to the right: the aim runs from there; the parts still start at the real spot
    const p1 = planUlt(tg.w.state, 0, { mode: 'aim', point, from: { x: 11.5, y: 8 } })!;
    expect(p1.aimDeg).toBeCloseTo((Math.atan2(-4, -1.5) * 180) / Math.PI + 360, 6);
    expect(p1.caster).toEqual({ x: 10, y: 8 });
    // a from far away counts only ULT_TEST.fromSlack cells
    const p2 = planUlt(tg.w.state, 0, { mode: 'aim', point, from: { x: 30, y: 8 } })!;
    expect(p2.aimDeg).toBeCloseTo((Math.atan2(-4, -ULT_TEST.fromSlack) * 180) / Math.PI + 360, 6);
    // none (a bot) / not numbers: the real spot
    expect(planUlt(tg.w.state, 0, { mode: 'aim', point })!.aimDeg).toBe(270);
    expect(planUlt(tg.w.state, 0, { mode: 'aim', point, from: { x: NaN, y: 1 } })!.aimDeg).toBe(270);
  });

  it('a bot already touching the boss steps TOWARD it in 드래그 (its blade run goes into the boss, not away)', () => {
    const tg = makeGame({ seed: 12, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'drag' }, { ...BOT1, characters: ['blade', 'guardian', 'cleric'] }], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS, hpMult: 50 } });
    advance(tg, 0.5);
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    const bot = activeEntity(tg.w, tg.w.state.players[1])!;
    expect(bot.defId).toBe('blade');
    bot.pos.x = 13;
    bot.pos.y = boss.pos.y + boss.radius + bot.radius; // touching, a little right of the middle
    const aim = botUltAim(tg.w.state, 1)!;
    const toBoss = { x: boss.pos.x - bot.pos.x, y: boss.pos.y - bot.pos.y };
    expect((aim.point.x - bot.pos.x) * toBoss.x + (aim.point.y - bot.pos.y) * toBoss.y).toBeGreaterThan(0);
    const plan = planUlt(tg.w.state, 1, aim)!;
    const rad = (plan.aimDeg * Math.PI) / 180;
    expect(Math.cos(rad) * toBoss.x + Math.sin(rad) * toBoss.y).toBeGreaterThan(0); // the hop faces the boss
  });

  it('a bot’s ‘ally’ ult (클레릭) goes to the most hurt ally only below 90 % HP; with nobody hurt it aims like ‘enemy’', () => {
    const tg = makeGame({ seed: 12, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'aim' }, { ...BOT1, characters: ['cleric', 'guardian', 'blade'] }], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS, hpMult: 50 } });
    advance(tg, 0.5);
    const boss = tg.w.state.entities.find(e => e.id === tg.w.state.bossId)!;
    expect(botUltAim(tg.w.state, 1)!.point).toEqual(boss.pos);
    const mine = activeEntity(tg.w, tg.w.state.players[0])!;
    mine.hp = mine.maxHp * 0.5;
    expect(botUltAim(tg.w.state, 1)!.point).toEqual(mine.pos);
  });

  it('a bot’s 드래그 waits while its landing is under a warning about to land (at most BOT_ULT_HOLD s)', () => {
    const tg = makeGame({ seed: 12, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'drag' }, BOT1], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS, hpMult: 50 } });
    advance(tg, 0.5);
    const s = tg.w.state;
    const aim = botUltAim(s, 1)!;
    const landing = planUlt(s, 1, aim)!.point;
    expect(dragUltWaits(tg.w, 1, aim, s.time)).toBe(false);
    s.telegraphs.push({ id: 99999, team: 'enemy', center: { ...landing }, origin: { ...landing }, area: { shape: 'circle', radius: 2 }, remaining: 1, total: 1 });
    expect(dragUltWaits(tg.w, 1, aim, s.time)).toBe(true);
    expect(dragUltWaits(tg.w, 1, aim, s.time - BOT_ULT_HOLD - 0.01)).toBe(false); // waited long enough: goes anyway
    expect(dragUltWaits(tg.w, 1, { ...aim, mode: 'aim' }, s.time)).toBe(false); // 조준 never waits
    s.telegraphs.pop();
  });

  it('a card that filled on the bench long ago and was just swapped in still waits the full BOT_ULT_HOLD s (리뷰)', () => {
    const tg = makeGame({ seed: 12, mode: 'ultTest', players: [{ ...HUMAN, ultMode: 'drag' }, { ...BOT1, characters: ['guardian', 'blade', 'cleric'] }], tunables: { invincible: true }, bossRaid: { onlyBoss: BOSS, hpMult: 50 } });
    advance(tg, 0.5);
    const s = tg.w.state;
    const p = s.players[1];
    // the blade's gauge filled on the bench 15 s ago; the swap AI drops it inside a find-the-safe-spot hole
    const hole = { x: 6, y: 9 };
    p.party[1].ult = { charge: 1, fullSince: s.time - 15 };
    expect(tg.game.dispatch({ type: 'swap', player: 1, partyIndex: 1, pos: { ...hole } }).ok).toBe(true);
    // the drag lands in front of the boss, far outside the hole
    const landing = planUlt(s, 1, botUltAim(s, 1)!)!.point;
    expect(Math.hypot(landing.x - hole.x, landing.y - hole.y)).toBeGreaterThan(4);
    s.telegraphs.push({ id: 99998, team: 'enemy', center: hole, origin: hole, area: { shape: 'ring', inner: 2.5, outer: 30 }, remaining: 2.2, total: 2.2 });
    // think by think (the sim stands still: only the clock moves); the bot's swaps are refused here
    const ults: number[] = [];
    const dispatch = (cmd: Command): CommandResult => {
      if (cmd.type === 'ult') ults.push(s.time);
      return cmd.type === 'ult' ? { ok: true } : { ok: false, reason: 'test' };
    };
    const t0 = s.time;
    p.rt.bot.thinkIn = 0;
    for (let i = 0; i < 10 && ults.length === 0; i++) {
      tickBots(tg.w, 0.5, dispatch);
      s.time += 0.5;
    }
    s.telegraphs.pop();
    expect(ults.length).toBe(1);
    expect(ults[0] - t0).toBeGreaterThanOrEqual(BOT_ULT_HOLD - 1e-9); // waited from the swap-in, not from fullSince
    expect(ults[0] - t0).toBeLessThan(BOT_ULT_HOLD + 0.5 + 1e-9); // …and no longer
  });

  it('the drag’s path cast comes after the ultCast (the screens know the cut-in is on: the name is said once)', () => {
    const tg = ultGame('drag'); // guardian: a dash with a path hit
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: me.pos.x + 5, y: me.pos.y } } }).ok).toBe(true);
    const ev = drain(tg);
    const u = ev.findIndex(e => e.type === 'ultCast');
    const path = ev.findIndex(e => e.type === 'skillCast' && e.skillId === 'guardian_ud_path');
    expect(u).toBeGreaterThanOrEqual(0);
    expect(path).toBeGreaterThan(u);
  });

  it('a line beat of a 조준 / 드래그 ult says where it started (the renderer draws it from there); other modes do not', () => {
    const tg = ultGame('drag'); // guardian 성벽 대강림: the path is a line from where it stood
    charge(tg);
    clearEvents(tg);
    const me = activeEntity(tg.w, tg.w.state.players[0])!;
    const from = { ...me.pos };
    tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'drag', point: { x: from.x + 5, y: from.y } } });
    advance(tg, 0.6);
    const path = stageOf(tg, 'guardian_ud_path', 'rally')[0];
    expect(path.origin && near(path.origin, from)).toBe(true);
    // a circle beat never carries one
    expect(stageOf(tg, 'guardian_ud', 'slam')[0].origin).toBeUndefined(); // 23차: the landing part is 'slam' (the path keeps 'rally')
  });

  it('두 번 차는 게이지 · 궁극기 여운 (replays of today’s ult) are never offered in 궁극기 테스트; the raid keeps them', () => {
    const ut = makeGame({ seed: 3, mode: 'ultTest', players: [HUMAN], bossRaid: { onlyBoss: BOSS } });
    const raid = makeGame({ seed: 3, mode: 'bossRaid', players: [HUMAN], bossRaid: { onlyBoss: BOSS } });
    for (const key of ULT_TEST.rewardsOff) {
      expect(familyEligible(ut.w.state, ut.w.state.players[0], getFamily(key)), key).toBe(false);
      expect(familyEligible(raid.w.state, raid.w.state.players[0], getFamily(key)), key).toBe(true);
    }
  });
});
