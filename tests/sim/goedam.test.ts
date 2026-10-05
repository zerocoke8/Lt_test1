// 기획 10차: 층 사이 괴담 방 (docs/goedam-rooms.md 8장 6단계 sim 항목).
import { describe, expect, it } from 'vitest';
import { ZONES, zoneOf } from '../../src/config';
import {
  CHARACTERS,
  GOEDAM_LINE_MAX,
  GOEDAM_ROOMS,
  GOEDAM_TRACES,
  RELICS,
  REWARDS,
  getGoedamRoom,
  getGoedamTrace,
  getReward,
  goedamLogText,
  goedamOptionView,
  goedamResultView,
  goedamRoomWeight,
  goedamTraceExpiredText,
} from '../../src/data';
import { applyDamage } from '../../src/sim/combat';
import { tick } from '../../src/sim/game';
import { addGoedamTrace, goedamSchedule, goedamTimeoutCommands } from '../../src/sim/goedam';
import { setUltCharge, ultChargeTimeFor } from '../../src/sim/players';
import { Rng } from '../../src/sim/rng';
import type { GameState, GoedamParams, GoedamRoomDef, PlayerSetup } from '../../src/types';
import { active, advance, BOT1, BOT2, clearEvents, eventsOf, HUMAN, HUMAN2, makeGame, type TestGame } from './helpers';

const HUMAN3: PlayerSetup = { name: '셋', isBot: false, characters: ['paladin', 'gunner', 'bard'], pets: ['cat_void', 'drum_raccoon', 'frog_bomb'] };
const ON = { goedamRoomsPerZone: 1 };
const LAST = ZONES[ZONES.length - 1].to;

function dispatchOk(tg: TestGame, cmd: Parameters<TestGame['game']['dispatch']>[0]): void {
  const r = tg.game.dispatch(cmd);
  expect(r, JSON.stringify(cmd)).toEqual({ ok: true });
}

/** Every human still holding offers picks the first one. */
function pickRewards(tg: TestGame): void {
  const s = tg.game.state;
  s.rewardOffersByPlayer.forEach((o, i) => {
    if (o && s.phase === 'reward') dispatchOk(tg, { type: 'chooseReward', player: i, offerIndex: 0 });
  });
}

/** Clear the floor with a room forced after it and choose rewards → the room is open. */
function enterRoom(tg: TestGame, room?: string): GameState {
  dispatchOk(tg, { type: 'debug', action: { kind: 'goedamNext', ...(room ? { room } : {}) } });
  dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
  pickRewards(tg);
  const s = tg.game.state;
  expect(s.phase).toBe('goedam');
  if (room) expect(s.goedam!.roomId).toBe(room);
  return s;
}

function pick(tg: TestGame, player: number, option: string): void {
  dispatchOk(tg, { type: 'goedam', player, option });
}

// ─────────────────────────── Data ───────────────────────────

describe('goedam data', () => {
  it('12 rooms and ~20 traces; every option is well formed and every room ends with leave', () => {
    expect(GOEDAM_ROOMS).toHaveLength(12);
    expect(GOEDAM_TRACES.length).toBeGreaterThanOrEqual(18);
    for (const room of GOEDAM_ROOMS) {
      expect(room.options[room.options.length - 1].id, room.id).toBe('leave');
      expect(new Set(room.options.map(o => o.id)).size, room.id).toBe(room.options.length);
      for (const o of room.options) {
        const rolled = o.outcomes.filter(x => !x.when);
        if (rolled.length) expect(rolled.reduce((a, x) => a + (x.chance ?? 0), 0), `${room.id}/${o.id}`).toBeCloseTo(1, 9);
        for (const e of [...(o.cost ?? []), ...o.outcomes.flatMap(x => x.effects)]) {
          if (e.kind === 'trace') expect(() => getGoedamTrace(e.traceId)).not.toThrow();
          if (e.kind === 'rewardFixed') expect(() => getReward(e.rewardId)).not.toThrow();
        }
      }
    }
    // crit only ever +; traces never touch def
    for (const t of GOEDAM_TRACES) expect(t.mods?.critChance ?? 0, t.id).toBeGreaterThanOrEqual(0);
  });

  it('button lines stay within the line limit for every room, option and per-player value', () => {
    const party = CHARACTERS.slice(0, 3).map(c => ({ defId: c.id }));
    const longest = [...CHARACTERS].sort((a, b) => b.name.length - a.name.length).slice(0, 3).map(c => ({ defId: c.id }));
    const params: GoedamParams[] = [
      {},
      { relicId: null, copy: null, anomaly: null },
      ...RELICS.map(r => ({ relicId: r.id })),
      ...REWARDS.filter(r => r.rarity !== 'epic').flatMap(r => [0, 1, 2].map(i => ({ copy: { rewardId: r.id, partyIndex: r.scope === 'character' ? i : null } }))),
      { anomaly: 'clock' as const },
    ];
    for (const room of GOEDAM_ROOMS) {
      for (const o of room.options) {
        expect(o.label.length, o.label).toBeLessThanOrEqual(16);
        for (const pr of params) {
          for (const pt of [party, longest]) {
            const v = goedamOptionView(room.id, o.id, pr, pt);
            for (const l of v.lines) expect(l.text.length, `${room.id}/${o.id}: ${l.text}`).toBeLessThanOrEqual(GOEDAM_LINE_MAX);
            if (o.id !== 'leave') expect(v.lines.length, `${room.id}/${o.id}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('button text comes from the numbers (odds, %, durations)', () => {
    const party = CHARACTERS.slice(0, 3).map(c => ({ defId: c.id }));
    const press = goedamOptionView('broken_vending', 'press', {}, party);
    expect(press.lines.map(l => [l.lead, l.text])).toEqual([
      ['대체로 70%', '보상 1개'],
      ['드물게 30%', 'HP −10%'],
      ['확정', 'HP −10%'],
    ]);
    expect(press.lines[0].detail).toBe('일반 55 · 희귀 40 · 영웅 5%');
    const ride = goedamOptionView('elevator_whisper', 'ride', {}, party);
    expect(ride.lines.map(l => [l.tone, l.text])).toEqual([
      ['gain', '모든 쿨 0 + 궁극기 +50%'],
      ['cost', '받는 피해 +12% (1층)'],
    ]);
    const signIn = goedamOptionView('overtime_roster', 'sign_in', {}, party);
    expect(signIn.lines.map(l => l.text)).toEqual(['공격력 +20% (영구)', '최대 HP −8% (영구)']);
    const walk = goedamOptionView('endless_corridor', 'walk', {}, party);
    expect(walk.lines.map(l => l.lead)).toEqual(['같으면', '다르면']);
    expect(goedamOptionView('red_mask', 'leave', {}, party).lines).toEqual([]);
    expect(goedamTraceExpiredText('crossed_line')).toBe('혼선이 풀렸다');
    expect(goedamTraceExpiredText('passenger')).toBe('동승자가 풀렸다');
  });
});

// ─────────────────────────── Schedule ───────────────────────────

describe('goedam schedule', () => {
  const zoneIndex = (f: number) => ZONES.findIndex(z => f >= z.from && f <= z.to);

  it('is fixed by the seed, one room per zone by default, never after floor 1, a boss floor or the last floor', () => {
    expect(goedamSchedule(42, 1)).toEqual(goedamSchedule(42, 1));
    expect(goedamSchedule(42, 0)).toEqual([]);
    const variety = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const sch = goedamSchedule(seed, 1);
      variety.add(JSON.stringify(sch));
      expect(sch.map(x => zoneIndex(x.floor)), `seed ${seed}`).toEqual([0, 1, 2, 3]);
      for (const x of sch) {
        expect(x.floor).not.toBe(1);
        expect(x.floor % 5).not.toBe(0);
        expect(x.floor).toBeLessThan(LAST);
        expect(goedamRoomWeight(getGoedamRoom(x.roomId), x.floor, zoneOf(x.floor).theme)).toBeGreaterThan(0);
      }
    }
    expect(variety.size).toBeGreaterThan(50);
  });

  it('slider 2: two per zone, never two floors in a row, no room twice', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const sch = goedamSchedule(seed, 2);
      expect(sch).toHaveLength(8);
      expect(new Set(sch.map(x => x.roomId)).size).toBe(sch.length);
      for (let i = 1; i < sch.length; i++) expect(sch[i].floor - sch[i - 1].floor, `seed ${seed}`).toBeGreaterThan(1);
    }
  });

  it('elevator only after 3–4 (twice as likely after 4); cursed relic at most once, 6–19', () => {
    let at3 = 0;
    let at4 = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      for (const x of goedamSchedule(seed, 1)) {
        if (x.roomId === 'elevator_whisper') {
          expect([3, 4]).toContain(x.floor);
          if (x.floor === 3) at3++;
          else at4++;
        }
        if (x.roomId === 'cursed_relic') expect(x.floor).toBeGreaterThanOrEqual(6);
      }
    }
    expect(at4).toBeGreaterThan(at3);
  });

  it('8-room subset with slider 2, seeds 1..500: never throws, never repeats, skips slots with no candidate', () => {
    const ids = ['broken_vending', 'elevator_whisper', 'overtime_roster', 'copier', 'red_blue_paper', 'night_rounds', 'sky_eye', 'cursed_relic'];
    const subset: GoedamRoomDef[] = ids.map(getGoedamRoom);
    let skipped = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const sch = goedamSchedule(seed, 2, subset);
      expect(new Set(sch.map(x => x.roomId)).size).toBe(sch.length);
      for (let z = 0; z < ZONES.length; z++) expect(sch.filter(x => zoneIndex(x.floor) === z).length).toBeLessThanOrEqual(2);
      for (const x of sch) expect(goedamRoomWeight(getGoedamRoom(x.roomId), x.floor, zoneOf(x.floor).theme)).toBeGreaterThan(0);
      skipped += 8 - sch.length;
    }
    expect(skipped).toBeGreaterThan(0);
  });
});

// ─────────────────────────── Flow ───────────────────────────

describe('goedam flow', () => {
  it('opens only after the reward is chosen, as its own phase; continue leads to the next floor', () => {
    const seed = 99;
    const slot = goedamSchedule(seed, 1)[0];
    const tg = makeGame({ seed, tunables: ON, startFloor: slot.floor });
    clearEvents(tg);
    dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
    const s = tg.game.state;
    expect(s.phase).toBe('reward');
    expect(s.goedam).toBeNull();
    pickRewards(tg);
    expect(s.phase).toBe('goedam');
    expect(s.goedam).toMatchObject({ roomId: slot.roomId, floor: slot.floor, label: `${slot.floor}½층` });
    expect(eventsOf(tg, 'goedamOpen')).toEqual([{ type: 'goedamOpen', floor: slot.floor, roomId: slot.roomId }]);
    // time is frozen: ticks and step do nothing
    const t0 = s.time;
    tick(tg.w);
    tg.game.step(1);
    expect(s.time).toBe(t0);
    expect(tg.game.canSwap(0, 1).ok).toBe(false);
    pick(tg, 0, 'leave');
    expect(s.goedam!.players[0]).toMatchObject({ stage: 'result', choice: 'leave', outcome: { id: 'leave' } });
    pick(tg, 0, 'continue');
    expect(s.phase).toBe('combat');
    expect(s.floor).toBe(slot.floor + 1);
    expect(s.goedam).toBeNull();
    expect(s.players[0].goedamLog).toHaveLength(1);
  });

  it('a floor without a room goes straight on; slider 0 never opens one', () => {
    const tg = makeGame({ seed: 5, tunables: { goedamRoomsPerZone: 0 } });
    for (let f = 1; f < 12; f++) {
      dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
      pickRewards(tg);
      expect(tg.game.state.phase).toBe('combat');
    }
    expect(eventsOf(tg, 'goedamOpen')).toEqual([]);
  });

  it('bots leave at once (logged as auto) and the room waits only for humans', () => {
    const tg = makeGame({ players: [HUMAN, BOT1, BOT2] });
    const s = enterRoom(tg, 'red_mask');
    expect(s.goedam!.players.map(p => p.stage)).toEqual(['choosing', 'done', 'done']);
    for (const i of [1, 2]) {
      expect(s.players[i].goedamLog).toEqual([expect.objectContaining({ optionId: 'leave', auto: true, outcome: { id: 'leave', reward: null, relicId: null, traces: [] } })]);
    }
    pick(tg, 0, 'so_so');
    expect(s.phase).toBe('goedam');
    pick(tg, 0, 'continue');
    expect(s.phase).toBe('combat');
  });

  it('a bot-only party never stalls in a room (20 floors, slider 2)', () => {
    const tg = makeGame({ seed: 3, players: [BOT1, BOT2], tunables: { goedamRoomsPerZone: 2 } });
    const s = tg.game.state;
    while (s.phase !== 'runOver') {
      dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
      expect(s.phase).not.toBe('goedam');
    }
    expect(s.runResult?.outcome).toBe('victory');
    expect(s.players[0].goedamLog.length).toBe(8);
    expect(s.players[0].goedamLog.every(e => e.optionId === 'leave' && e.auto)).toBe(true);
  });

  it('rejects a second pick, continue before picking, hidden / unknown options, and commands outside the room', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'leave' }).ok).toBe(false);
    const s = enterRoom(tg, 'copier');
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'continue' })).toEqual({ ok: false, reason: '먼저 고르세요' });
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'press' })).toEqual({ ok: false, reason: '잘못된 선택' });
    s.goedam!.players[0].options.find(o => o.id === 'insert')!.hidden = true;
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'insert' })).toEqual({ ok: false, reason: '잘못된 선택' });
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'nope' }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'goedam', player: 7, option: 'leave' }).ok).toBe(false);
    expect(tg.game.dispatch({ type: 'goedam', player: 0.5, option: 'leave' }).ok).toBe(false);
    pick(tg, 0, 'tray');
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'leave' })).toEqual({ ok: false, reason: '이미 골랐음' });
    pick(tg, 0, 'continue');
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'continue' })).toEqual({ ok: false, reason: '이미 끝남' });
    expect(tg.game.state.phase).toBe('goedam'); // player 1 still choosing
  });

  it('a disconnect leaves for that slot (choosing → leave, result → continue); the timeout commands finish the room', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, HUMAN3] });
    const s = enterRoom(tg, 'iv_drip');
    pick(tg, 1, 'drip');
    tg.game.setPlayerBot(0, true);
    expect(s.goedam!.players[0]).toMatchObject({ stage: 'done', choice: 'leave' });
    expect(s.players[0].goedamLog[0].auto).toBe(true);
    tg.game.setPlayerBot(1, true);
    expect(s.goedam!.players[1]).toMatchObject({ stage: 'done', choice: 'drip' });
    expect(s.phase).toBe('goedam');
    const cmds = goedamTimeoutCommands(s);
    expect(cmds).toEqual([
      { type: 'goedam', player: 2, option: 'leave' },
      { type: 'goedam', player: 2, option: 'continue' },
    ]);
    for (const c of cmds) dispatchOk(tg, c);
    expect(s.phase).toBe('combat');
    expect(goedamTimeoutCommands(s)).toEqual([]);
  });

  it('run end and debug floor jumps clear the room', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    enterRoom(tg, 'sky_eye');
    dispatchOk(tg, { type: 'debug', action: { kind: 'jumpFloor', floor: 7 } });
    expect(tg.game.state).toMatchObject({ phase: 'combat', floor: 7, goedam: null });
    enterRoom(tg, 'red_mask');
    dispatchOk(tg, { type: 'quit' });
    expect(tg.game.state).toMatchObject({ phase: 'runOver', goedam: null });
  });

  it('3 players: each outcome is fixed by seed + floor + player, whatever the click order', () => {
    const run = (order: number[]) => {
      const tg = makeGame({ seed: 777, players: [HUMAN, HUMAN2, HUMAN3] });
      const s = enterRoom(tg, 'broken_vending');
      for (const i of order) pick(tg, i, 'press');
      const out = s.goedam!.players.map(p => p.outcome);
      for (const i of order) pick(tg, i, 'continue');
      return { out, players: JSON.stringify(s.players, (k, v) => (k === 'rt' ? undefined : v)) };
    };
    const a = run([0, 1, 2]);
    const b = run([2, 0, 1]);
    expect(b.out).toEqual(a.out);
    expect(b.players).toBe(a.players);
  });

  it('several seeds: always picking something reaches the end without a stall (all 12 rooms, slider 2)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const tg = makeGame({ seed, players: [HUMAN, BOT1], tunables: { goedamRoomsPerZone: 2 } });
      const s = tg.game.state;
      const r = new Rng(seed);
      for (let guard = 0; s.phase !== 'runOver' && guard < 200; guard++) {
        if (s.phase === 'combat') dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
        else if (s.phase === 'reward') pickRewards(tg);
        else if (s.phase === 'goedam') {
          const pr = s.goedam!.players[0];
          pick(tg, 0, pr.stage === 'choosing' ? r.pick(pr.options.filter(o => !o.hidden)).id : 'continue');
        }
      }
      expect(s.runResult?.outcome, `seed ${seed}`).toBe('victory');
      expect(s.players[0].goedamLog.length).toBe(8);
      for (const e of s.players[0].goedamLog) expect(goedamLogText(e)).toContain(`${e.floor}½층`);
    }
  });
});

// ─────────────────────────── Effects ───────────────────────────

describe('goedam effects', () => {
  it('never kill: HP losses stop at 1 on field and bench, dead members stay as they are', () => {
    const tg = makeGame({ seed: 11 });
    const s = enterRoom(tg, 'broken_vending');
    const p = s.players[0];
    active(tg).hp = 1.4;
    p.party[1].hp = 0.9;
    p.party[2].hp = 50;
    pick(tg, 0, 'press'); // sure −10%, maybe −10% more
    expect(active(tg).hp).toBeGreaterThanOrEqual(1);
    expect(p.party[0].hp).toBe(active(tg).hp);
    expect(p.party[1].hp).toBe(0.9); // never raised either
    expect(p.party[2].hp).toBeLessThanOrEqual(50 * 0.9 + 1e-9);
    expect(p.party.every(m => !m.dead)).toBe(true);
  });

  it('every option of every room keeps living members alive (many seeds, low HP)', () => {
    for (const room of GOEDAM_ROOMS) {
      for (const o of room.options) {
        for (let seed = 1; seed <= 6; seed++) {
          const tg = makeGame({ seed, players: [HUMAN, HUMAN2] });
          const s = enterRoom(tg, room.id);
          const p = s.players[0];
          if (s.goedam!.players[0].options.find(x => x.id === o.id)!.hidden) continue;
          active(tg).hp = 1.2;
          for (const m of p.party) if (m.entityId == null) m.hp = 1.1;
          pick(tg, 0, o.id);
          for (const m of p.party) expect(m.dead || m.hp >= 1, `${room.id}/${o.id}`).toBe(true);
          for (const m of p.party) expect(m.hp).toBeLessThanOrEqual(m.maxHp + 1e-9);
          expect(p.ult.charge >= 1).toBe(p.ult.fullSince != null);
        }
      }
    }
  });

  it('ult gauge: full → ultReady + fullSince; emptied → fullSince cleared; first combat tick keeps the invariant', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2] });
    const s = enterRoom(tg, 'ringing_phone');
    clearEvents(tg);
    pick(tg, 0, 'answer');
    expect(s.players[0].ult).toEqual({ charge: 1, fullSince: s.time });
    expect(eventsOf(tg, 'ultReady').map(e => e.player)).toEqual([0]);
    s.players[1].ult = { charge: 1, fullSince: s.time - 3 };
    pick(tg, 1, 'hang_up');
    expect(s.players[1].ult).toEqual({ charge: 0, fullSince: null });
    pick(tg, 0, 'continue');
    pick(tg, 1, 'continue');
    expect(s.phase).toBe('combat');
    tick(tg.w);
    for (const p of s.players) expect(p.ult.charge >= 1).toBe(p.ult.fullSince != null);
    expect(s.players[1].ult.charge).toBeGreaterThan(0);
  });

  it('ult gauge: a sum that lands a hair under full (0.7 of tick charge + 0.3) snaps to full like tickPlayers', () => {
    const tg = makeGame({ players: [HUMAN] });
    const p = tg.w.state.players[0];
    clearEvents(tg);
    setUltCharge(tg.w, p, 0.9999999999999933);
    expect(p.ult).toEqual({ charge: 1, fullSince: tg.w.state.time });
    expect(eventsOf(tg, 'ultReady')).toHaveLength(1);
  });

  it('ult charge time goes through one function (혼선 30 s → ~43 s) and the sim charges at that speed', () => {
    const tg = makeGame({ players: [HUMAN] });
    const p = tg.w.state.players[0];
    addGoedamTrace(tg.w, p, 'crossed_line');
    expect(ultChargeTimeFor(tg.game.tunables, p)).toBeCloseTo(30 / 0.7, 9);
    addGoedamTrace(tg.w, p, 'silence');
    expect(ultChargeTimeFor(tg.game.tunables, p)).toBeCloseTo(30, 9);
    p.goedamTraces = [];
    addGoedamTrace(tg.w, p, 'crossed_line');
    p.ult = { charge: 0, fullSince: null };
    advance(tg, 30);
    expect(p.ult.charge).toBeCloseTo(0.7, 2);
  });

  it('damage taken × trace multiplier on my characters only', () => {
    const hit = (traceId?: string) => {
      const tg = makeGame({ seed: 4 });
      if (traceId) addGoedamTrace(tg.w, tg.w.state.players[0], traceId);
      const e = active(tg);
      e.invulnTime = 0;
      const before = e.hp;
      // a fixed raw hit through the normal damage path
      applyDamage(tg.w, { casterId: null, team: 'enemy', player: null, source: 'basic', isDrag: false }, e, 100, false);
      return before - e.hp;
    };
    const base = hit();
    expect(hit('passenger')).toBeCloseTo(base * 1.12, 6);
    expect(hit('blue_paper')).toBeCloseTo(base * (1 + getGoedamTrace('blue_paper').damageTaken!), 6);
  });

  it('traces: same one refreshes, different ones add; expiry at floor clear before the heal; max HP follows (floor 30%)', () => {
    const tg = makeGame({ seed: 8 });
    const s = tg.w.state;
    const p = s.players[0];
    const e = active(tg);
    const base = e.maxHp;
    const raw = (i: number) => CHARACTERS.find(c => c.id === p.party[i].defId)!.stats.maxHp;
    addGoedamTrace(tg.w, p, 'looked_back');
    expect(e.maxHp).toBeCloseTo(base - 0.12 * raw(0), 6);
    expect(p.party[1].maxHp).toBeCloseTo(raw(1) * 0.88, 6);
    addGoedamTrace(tg.w, p, 'torn_smile');
    expect(e.maxHp).toBeCloseTo(base - 0.2 * raw(0), 6);
    expect(e.hp).toBeLessThanOrEqual(e.maxHp);
    p.goedamTraces[0].floorsLeft = 1;
    addGoedamTrace(tg.w, p, 'looked_back');
    expect(p.goedamTraces).toEqual([
      { id: 'looked_back', floorsLeft: 3 },
      { id: 'torn_smile', floorsLeft: 3 },
    ]);
    // three floor clears: gone at the third, before the 20% heal (heal reaches the restored max)
    clearEvents(tg);
    for (let i = 0; i < 3; i++) {
      e.hp = 10;
      dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
      // a reward that does not touch HP, so the heal is easy to check
      const i = s.rewardOffersByPlayer[0]!.findIndex(o => !o.rewardId.startsWith('hp_'));
      dispatchOk(tg, { type: 'chooseReward', player: 0, offerIndex: i });
    }
    expect(p.goedamTraces).toEqual([]);
    expect(eventsOf(tg, 'goedamTraceExpired').map(x => x.traceId).sort()).toEqual(['looked_back', 'torn_smile']);
    expect(e.maxHp).toBeCloseTo(base, 6);
    expect(e.hp).toBeCloseTo(10 + 0.2 * base, 6);
    // max HP never below 30% of the base however many curses stack
    for (const id of ['looked_back', 'torn_smile', 'red_paper', 'overtime_pay', 'box_owner', 'box_owner_weak']) addGoedamTrace(tg.w, p, id);
    for (let k = 0; k < 6; k++) p.goedamTraces.push({ id: 'red_paper', floorsLeft: null });
    addGoedamTrace(tg.w, p, 'needle');
    expect(e.maxHp).toBeCloseTo(raw(0) * 0.3, 6);
    expect(p.party[1].maxHp).toBeCloseTo(raw(1) * 0.3, 6);
    expect(e.hp).toBeGreaterThanOrEqual(1);
  });

  it('cursed relic: a missing relic, or an epic reward for someone who owns them all; the scheduled room needs a missing relic', () => {
    const tg = makeGame({ seed: 21, players: [HUMAN, HUMAN2] });
    const s0 = tg.w.state;
    s0.players[1].relics = RELICS.map(r => r.id);
    const s = enterRoom(tg, 'cursed_relic');
    const [a, b] = s.goedam!.players;
    expect(a.params.relicId).toBeTruthy();
    expect(b.params.relicId).toBeNull();
    expect(goedamOptionView('cursed_relic', 'open', b.params, s.players[1].party).lines[0].text).toBe('영웅 보상 1개');
    pick(tg, 0, 'open');
    pick(tg, 1, 'open');
    expect(s.players[0].relics).toContain(a.params.relicId);
    expect(a.outcome).toMatchObject({ relicId: a.params.relicId, reward: null, traces: ['box_owner'] });
    expect(b.outcome!.relicId).toBeNull();
    expect(getReward(b.outcome!.reward!.rewardId).rarity).toBe('epic');
    expect(goedamResultView('cursed_relic', 'open', b.outcome!, b.params, s.players[1].party).lines[0].text).toContain('(영웅)');

    // scheduled (not forced): skipped when nobody lacks a relic
    let seed = 1;
    while (!goedamSchedule(seed, 1).some(x => x.roomId === 'cursed_relic')) seed++;
    const slot = goedamSchedule(seed, 1).find(x => x.roomId === 'cursed_relic')!;
    const tg2 = makeGame({ seed, tunables: ON, startFloor: slot.floor });
    tg2.w.state.players[0].relics = RELICS.map(r => r.id);
    dispatchOk(tg2, { type: 'debug', action: { kind: 'skipFloor' } });
    pickRewards(tg2);
    expect(tg2.game.state.phase).toBe('combat');
  });

  it('copier: hidden with nothing to copy; copies the most recent common/rare reward with its character', () => {
    const tg = makeGame({ seed: 2, players: [HUMAN, HUMAN2] });
    const s = tg.w.state;
    dispatchOk(tg, { type: 'debug', action: { kind: 'goedamNext', room: 'copier' } });
    dispatchOk(tg, { type: 'debug', action: { kind: 'skipFloor' } });
    // this floor's reward is an epic one for both; player 0 had nothing before, player 1 a rare drag reward
    const epic = { rewardId: 'atk_epic', partyIndex: null, name: '공격력 강화', description: '', rarity: 'epic' as const, isRelic: false };
    s.rewardOffersByPlayer = [[epic], [epic]];
    s.players[0].rewards = [];
    s.players[1].rewards = [{ rewardId: 'dragdmg_rare', partyIndex: 2 }];
    pickRewards(tg);
    expect(s.phase).toBe('goedam');
    const [a, b] = s.goedam!.players;
    expect(a.options.find(o => o.id === 'insert')!.hidden).toBe(true);
    expect(b.options.find(o => o.id === 'insert')!.hidden).toBe(false);
    expect(b.params.copy).toEqual({ rewardId: 'dragdmg_rare', partyIndex: 2 });
    expect(goedamOptionView('copier', 'insert', b.params, s.players[1].party).lines[0].text).toBe('버서커 드래그스킬 강화 (희귀) 1장 더');
    expect(tg.game.dispatch({ type: 'goedam', player: 0, option: 'insert' })).toEqual({ ok: false, reason: '잘못된 선택' });
    pick(tg, 1, 'insert');
    expect(s.players[1].rewards.slice(-1)[0]).toEqual({ rewardId: 'dragdmg_rare', partyIndex: 2 });
    expect(s.players[1].rewards).toHaveLength(3);
    expect(s.players[1].goedamTraces).toEqual([{ id: 'smeared_ink', floorsLeft: 2 }]);
  });

  it('night rounds: heal the living, revive the fallen at 50%, needle mark for one floor', () => {
    const tg = makeGame({ seed: 6, players: [HUMAN, HUMAN2] });
    const s = enterRoom(tg, 'night_rounds');
    const p = s.players[0];
    const m = p.party[2];
    m.dead = true;
    m.hp = 0;
    m.reviveRemaining = 20;
    clearEvents(tg);
    pick(tg, 0, 'lie_down');
    expect(m.dead).toBe(false);
    expect(m.hp).toBeCloseTo(m.maxHp * 0.5, 6);
    expect(eventsOf(tg, 'revive').map(e => [e.player, e.partyIndex])).toEqual([[0, 2]]);
    expect(p.goedamTraces).toEqual([{ id: 'needle_mark', floorsLeft: 1 }]);
    expect(eventsOf(tg, 'goedamTrace')).toEqual([{ type: 'goedamTrace', player: 0, traceId: 'needle_mark', floorsLeft: 1 }]);
    expect(s.goedam!.players[0].outcome!.revived).toBe(1);
    const card = goedamResultView('night_rounds', 'lie_down', s.goedam!.players[0].outcome!, {}, p.party).lines.map(l => l.text);
    expect(card).toContain('쓰러진 캐릭터 부활');
  });

  it('night rounds with nobody down: the card does not claim a revive', () => {
    const tg = makeGame({ seed: 6, players: [HUMAN] });
    const s = enterRoom(tg, 'night_rounds');
    pick(tg, 0, 'lie_down');
    const out = s.goedam!.players[0].outcome!;
    expect(out.revived).toBe(0);
    const card = goedamResultView('night_rounds', 'lie_down', out, {}, s.players[0].party).lines.map(l => l.text);
    expect(card.some(t => t.includes('부활'))).toBe(false);
    expect(card.length).toBeGreaterThan(0);
  });

  it('IV drip 맑은 수액: HP 가득 then +5% max HP leaves every living member at full HP (field and bench)', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const tg = makeGame({ seed, players: [HUMAN] });
      const s = enterRoom(tg, 'iv_drip');
      const p = s.players[0];
      for (const m of p.party) m.hp = Math.max(1, m.hp * 0.5);
      active(tg, 0).hp *= 0.5;
      pick(tg, 0, 'drip');
      if (s.goedam!.players[0].outcome!.id !== 'clear') continue;
      seen++;
      for (const m of p.party) if (!m.dead) expect(m.hp, `seed ${seed}`).toBeCloseTo(m.maxHp, 6);
      const f = active(tg, 0);
      expect(f.hp).toBeCloseTo(f.maxHp, 6);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('corridor: the right answer depends on what this player saw, and the card says what differed', () => {
    const saw = { normal: 0, anomaly: 0 };
    for (let seed = 1; seed <= 20; seed++) {
      const tg = makeGame({ seed, players: [HUMAN, HUMAN2] });
      const s = enterRoom(tg, 'endless_corridor');
      const pr = s.goedam!.players[0];
      const right = pr.params.anomaly ? 'turn_back' : 'walk';
      saw[pr.params.anomaly ? 'anomaly' : 'normal']++;
      pick(tg, 0, right);
      expect(pr.outcome!.id).toBe('right');
      expect(pr.outcome!.reward).not.toBeNull();
      const view = goedamResultView('endless_corridor', right, pr.outcome!, pr.params, s.players[0].party);
      expect(view.tone).toBe('good');
      expect(view.note).toBeTruthy();
    }
    expect(saw.normal).toBeGreaterThan(0);
    expect(saw.anomaly).toBeGreaterThan(0);
  });

  it('result card: a second HP loss after the sure cost says 더 (no duplicate line)', () => {
    const mimic = { id: 'mimic', reward: null, relicId: null, traces: [] };
    const lines = goedamResultView('broken_vending', 'press', mimic, {}, []).lines.map(l => l.text);
    expect(lines).toEqual(['전원 HP 10% 잃음', '전원 HP 10% 더 잃음']);
  });
});

// ─────────────────────────── Baseline ───────────────────────────

describe('goedam baseline', () => {
  /** Combat ticks; reward → first offer; room → leave + continue. */
  function scripted(goedamRoomsPerZone: number) {
    const tg = makeGame({ seed: 31337, players: [HUMAN, BOT1], tunables: { goedamRoomsPerZone, maxFloor: 12, monsterHpMult: 0.15 } });
    const s = tg.w.state;
    let rooms = 0;
    for (let t = 0; t < 30 * 60 * 8 && s.phase !== 'runOver'; t++) {
      if (s.phase === 'reward') pickRewards(tg);
      else if (s.phase === 'goedam') {
        rooms++;
        pick(tg, 0, 'leave');
        pick(tg, 0, 'continue');
      } else tick(tg.w);
      tg.game.drainEvents();
    }
    const state = JSON.stringify(s, (k, v) => (k === 'rt' || k === 'goedamLog' ? undefined : v));
    return { state, rng: [tg.w.rng.next(), tg.w.rng.next()], rooms, floor: s.floor };
  }

  it('leaving every room is bit-identical to rooms off (state minus the 수첩, same run rng)', () => {
    const off = scripted(0);
    const on = scripted(2);
    expect(on.rooms).toBeGreaterThan(0);
    expect(on.floor).toBeGreaterThan(4);
    expect(on.state).toBe(off.state);
    expect(on.rng).toEqual(off.rng);
  });
});
