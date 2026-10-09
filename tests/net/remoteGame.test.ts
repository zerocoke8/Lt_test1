// RemoteGame (src/net/remoteGame.ts) against a fake connection: snapshots → state, local validation with the same
// pure rules as the sim, optimistic locks, reward choice, rejected commands, host-only tunables diff, easing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../src/net/connection';
import type { ClientMsg, ServerMsg } from '../../src/net/protocol';
import { RemoteGame } from '../../src/net/remoteGame';
import { DEFAULT_TUNABLES } from '../../src/config';
import { cleanState } from '../../server/snapshot';
import type { Command, Game } from '../../src/types';
import { HUMAN, HUMAN2, BOT1, advance, makeGame } from '../sim/helpers';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

class FakeConn {
  online = true;
  latencyMs = 20;
  serverOffsetMs = 0;
  onlineSince = 0;
  reconnects = 0;
  sent: ClientMsg[] = [];
  reconnectNow() {
    this.reconnects++;
  }
  private handlers = new Map<string, ((m: ServerMsg) => void)[]>();
  on(t: string, fn: (m: ServerMsg) => void) {
    const list = this.handlers.get(t) ?? [];
    list.push(fn);
    this.handlers.set(t, list);
    return () => this.handlers.set(t, (this.handlers.get(t) ?? []).filter(f => f !== fn));
  }
  send(m: ClientMsg) {
    if (!this.online) return false;
    this.sent.push(m);
    return true;
  }
  emit(m: ServerMsg) {
    for (const fn of this.handlers.get(m.t) ?? []) fn(m);
  }
  cmds(): Extract<ClientMsg, { t: 'cmd' }>[] {
    return this.sent.filter((m): m is Extract<ClientMsg, { t: 'cmd' }> => m.t === 'cmd');
  }
}

function snapOf(game: Game, extra: Partial<Snap> = {}): Snap {
  return {
    t: 'snap',
    tick: game.state.tick,
    serverTime: Date.now(),
    state: cleanState(game.state),
    events: game.drainEvents(),
    tunables: { ...game.tunables },
    hostPlayerIndex: 0,
    rewardDeadline: null,
    goedamDeadline: null,
    telemetry: game.telemetry(1),
    ...extra,
  };
}

function setup(localPlayer = 1, hostPlayerIndex = 0) {
  const tg = makeGame({ players: [HUMAN, HUMAN2, BOT1] });
  const conn = new FakeConn();
  const rejected: [Command, string][] = [];
  const rg = new RemoteGame(conn as unknown as Connection, { t: 'start', playerIndex: localPlayer, hostPlayerIndex, seed: 1, tunables: { ...DEFAULT_TUNABLES } }, {
    onRejected: (c, r) => rejected.push([c, r]),
  });
  return { tg, conn, rg, rejected };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RemoteGame', () => {
  it('becomes ready on the first snapshot; state, events and telemetry come from the server', () => {
    const { tg, conn, rg } = setup();
    expect(rg.ready).toBe(false);
    expect(() => rg.state).toThrow();
    conn.emit(snapOf(tg.game, { events: [{ type: 'enrage' }] }));
    expect(rg.ready).toBe(true);
    expect(rg.localPlayer).toBe(1);
    expect(rg.isHost).toBe(false);
    expect(rg.state.players.map(p => p.name)).toEqual(['나', '둘', 'BOT 1']);
    expect(rg.drainEvents()).toEqual([{ type: 'enrage' }]);
    expect(rg.drainEvents()).toEqual([]);
    expect(rg.telemetry().floorTimes).toEqual([]);
    // clamp from the snapshot's arena
    const a = rg.state.plan.arena;
    expect(rg.clampToArena({ x: -5, y: 99 })).toEqual({ x: 0.5, y: a.height - 0.5 });
    expect(rg.previewParts(1, 'swap', 1).length).toBeGreaterThan(0);
    expect(rg.previewArea(1, 'swap', 1)).toEqual(tg.game.previewArea(1, 'swap', 1));
  });

  it('dispatch: validated locally, sent with my slot, answered optimistically; swaps are locked until the server catches up', () => {
    const { tg, conn, rg } = setup();
    conn.emit(snapOf(tg.game));
    // character 1 (index 0) is on the field → refused locally, nothing sent
    expect(rg.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 5, y: 5 } })).toEqual({ ok: false, reason: '이미 필드에 있음' });
    expect(conn.cmds()).toHaveLength(0);
    // a different player's index in the command is replaced by mine
    expect(rg.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 5, y: 5 } })).toEqual({ ok: true });
    expect(conn.cmds()[0].cmd).toEqual({ type: 'swap', player: 1, partyIndex: 1, pos: { x: 5, y: 5 } });
    // until the server answers, another swap is blocked (appear lock not in the snapshot yet)
    expect(rg.canSwap(1, 2)).toEqual({ ok: false, reason: '등장 중' });
    expect(rg.dispatch({ type: 'ult', player: 1 })).toEqual({ ok: false, reason: '게이지 부족' });
    // host-only commands
    expect(rg.dispatch({ type: 'debug', action: { kind: 'killAll' } })).toEqual({ ok: false, reason: '방장만 할 수 있어요' });
    // offline → refused
    conn.online = false;
    expect(rg.dispatch({ type: 'pet', player: 1, petIndex: 0, pos: { x: 5, y: 5 } })).toEqual({ ok: false, reason: '서버와 연결이 끊겼어요' });
  });

  it('기획 6차 on the client: once the server applied my swap, the card that left is cooling and the next one is free', () => {
    const { tg, conn, rg } = setup();
    conn.emit(snapOf(tg.game));
    expect(rg.dispatch({ type: 'swap', player: 1, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true);
    const sent = conn.cmds()[0];
    expect(tg.game.dispatch(sent.cmd).ok).toBe(true); // the server runs it
    conn.emit({ t: 'cmdResult', seq: sent.seq, ok: true });
    conn.emit(snapOf(tg.game));
    expect(rg.state.players[1].party.map(m => m.swapCooldownRemaining > 0)).toEqual([true, false, false]);
    expect(rg.canSwap(1, 0)).toEqual({ ok: false, reason: '쿨타임' });
    expect(rg.canSwap(1, 1)).toEqual({ ok: false, reason: '이미 필드에 있음' });
    expect(rg.canSwap(1, 2)).toEqual(tg.game.canSwap(1, 2)); // still the server's 0.5 s appear lock
    advance(tg, 0.5);
    conn.emit(snapOf(tg.game));
    expect(rg.canSwap(1, 2)).toEqual({ ok: true });
    for (let i = 0; i < 3; i++) expect(rg.canSwap(1, i)).toEqual(tg.game.canSwap(1, i));
  });

  it('a refused command is reported', () => {
    const { tg, conn, rg, rejected } = setup();
    conn.emit(snapOf(tg.game));
    rg.dispatch({ type: 'pet', player: 1, petIndex: 2, pos: { x: 5, y: 5 } });
    expect(rg.canUsePet(1, 2)).toEqual({ ok: false, reason: '쿨타임' });
    const seq = conn.cmds()[0].seq;
    conn.emit({ t: 'cmdResult', seq, ok: false, reason: '쿨타임' });
    expect(rejected).toEqual([[{ type: 'pet', player: 1, petIndex: 2, pos: { x: 5, y: 5 } }, '쿨타임']]);
  });

  it('reward choice hides my offers at once and keeps them hidden through stale snapshots; a refusal brings them back', () => {
    const { tg, conn, rg } = setup();
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    conn.emit(snapOf(tg.game, { rewardDeadline: Date.now() + 20_000 }));
    expect(rg.state.rewardOffersByPlayer[1]).toHaveLength(3);
    expect(rg.rewardDeadline).toBeGreaterThan(Date.now());
    expect(rg.dispatch({ type: 'chooseReward', player: 1, offerIndex: 7 })).toEqual({ ok: false, reason: '잘못된 선택' });
    expect(rg.dispatch({ type: 'chooseReward', player: 1, offerIndex: 2 }).ok).toBe(true);
    expect(rg.state.rewardOffersByPlayer[1]).toBeNull();
    // the server's next snapshot was built before it saw the command
    conn.emit(snapOf(tg.game));
    expect(rg.state.rewardOffersByPlayer[1]).toBeNull();
    const seq = conn.cmds().at(-1)!.seq;
    conn.emit({ t: 'cmdResult', seq, ok: false, reason: '보상 단계가 아님' });
    conn.emit(snapOf(tg.game));
    expect(rg.state.rewardOffersByPlayer[1]).toHaveLength(3);
  });

  it('기획 10차 괴담 room: the sim\'s own checks, sent for my slot, a double tap waits for the snapshot; the deadline rides along', () => {
    const { tg, conn, rg, rejected } = setup();
    conn.emit(snapOf(tg.game));
    expect(rg.goedamDeadline).toBeNull();
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'leave' })).toEqual({ ok: false, reason: '괴담 방이 아님' });
    tg.game.dispatch({ type: 'debug', action: { kind: 'goedamNext', room: 'broken_vending' } });
    tg.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    for (const player of [0, 1]) tg.game.dispatch({ type: 'chooseReward', player, offerIndex: 0 });
    expect(tg.game.state.phase).toBe('goedam');
    const deadline = Date.now() + 25_000;
    conn.emit(snapOf(tg.game, { goedamDeadline: deadline }));
    expect(rg.goedamDeadline).toBe(deadline); // serverOffsetMs 0
    // the same refusals as the sim, nothing sent
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'continue' })).toEqual({ ok: false, reason: '먼저 고르세요' });
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'nope' })).toEqual({ ok: false, reason: '잘못된 선택' });
    expect(conn.cmds()).toHaveLength(0);
    // another slot in the command is replaced by mine
    expect(rg.dispatch({ type: 'goedam', player: 0, option: 'press' })).toEqual({ ok: true });
    const sent = conn.cmds()[0];
    expect(sent.cmd).toEqual({ type: 'goedam', player: 1, option: 'press' });
    // double tap before the snapshot shows my choice: not sent twice
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'press' })).toEqual({ ok: false, reason: '이미 골랐음' });
    expect(conn.cmds()).toHaveLength(1);
    expect(tg.game.dispatch(sent.cmd).ok).toBe(true); // the server runs it
    conn.emit({ t: 'cmdResult', seq: sent.seq, ok: true });
    conn.emit(snapOf(tg.game, { goedamDeadline: deadline }));
    expect(rg.state.goedam!.players[1].stage).toBe('result');
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'continue' })).toEqual({ ok: true });
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'continue' })).toEqual({ ok: false, reason: '이미 끝남' });
    // a refusal frees the button at once
    const cont = conn.cmds()[1];
    conn.emit({ t: 'cmdResult', seq: cont.seq, ok: false, reason: '이미 끝남' });
    expect(rejected.at(-1)).toEqual([cont.cmd, '이미 끝남']);
    expect(rg.dispatch({ type: 'goedam', player: 1, option: 'continue' })).toEqual({ ok: true });
    // room over → no deadline
    tg.game.dispatch({ type: 'goedam', player: 0, option: 'leave' });
    for (const player of [0, 1]) tg.game.dispatch({ type: 'goedam', player, option: 'continue' });
    conn.emit(snapOf(tg.game));
    expect(rg.state.phase).toBe('combat');
    expect(rg.goedamDeadline).toBeNull();
  });

  it('기획 15차 원정 choice: the sim\'s own check, sent for my slot, one tap only; the choice deadline rides along', () => {
    const tg = makeGame({ players: [HUMAN, HUMAN2, BOT1], expedition: { stage: 1 } });
    const conn = new FakeConn();
    const rg = new RemoteGame(conn as unknown as Connection, {
      t: 'start',
      playerIndex: 1,
      hostPlayerIndex: 0,
      seed: 1,
      tunables: { ...DEFAULT_TUNABLES },
      mode: 'expedition',
    });
    conn.emit(snapOf(tg.game));
    expect(rg.choiceDeadline).toBeNull();
    expect(rg.dispatch({ type: 'expeditionChoice', player: 1, choice: 'continue' })).toEqual({ ok: false, reason: '단계 클리어가 아님' });
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }).ok).toBe(true);
    const deadline = Date.now() + 20_000;
    conn.emit(snapOf(tg.game, { choiceDeadline: deadline }));
    expect(rg.state.phase).toBe('stageClear');
    expect(rg.choiceDeadline).toBe(deadline);
    expect(rg.dispatch({ type: 'expeditionChoice', player: 0, choice: 'continue' })).toEqual({ ok: true });
    expect(conn.cmds()[0].cmd).toEqual({ type: 'expeditionChoice', player: 1, choice: 'continue' });
    expect(rg.dispatch({ type: 'expeditionChoice', player: 1, choice: 'extract' })).toEqual({ ok: false, reason: '이미 골랐음' });
    expect(conn.cmds()).toHaveLength(1);
    // the server's state shows the choice: still refused (by the sim rule now)
    tg.game.dispatch(conn.cmds()[0].cmd);
    conn.emit({ t: 'cmdResult', seq: conn.cmds()[0].seq, ok: true });
    conn.emit(snapOf(tg.game, { choiceDeadline: deadline }));
    expect(rg.state.expedition?.choices[1]).toBe('continue');
    expect(rg.dispatch({ type: 'expeditionChoice', player: 1, choice: 'extract' })).toEqual({ ok: false, reason: '이미 골랐음' });
  });

  it('host: debug-panel edits of game.tunables are diffed and sent; the server value wins afterwards', () => {
    const { tg, conn, rg } = setup(0, 0);
    conn.emit(snapOf(tg.game));
    expect(rg.isHost).toBe(true);
    rg.tunables.ultFieldChargeTime = 12;
    rg.tunables.invincible = true;
    rg.step(1 / 60);
    const sent = conn.cmds().map(c => c.cmd);
    expect(sent).toEqual([{ type: 'tunables', patch: { ultFieldChargeTime: 12, invincible: true } }]);
    // a snapshot from before the change does not undo the local edit
    conn.emit(snapOf(tg.game));
    expect(rg.tunables.ultFieldChargeTime).toBe(12);
    // the server applied it
    tg.game.dispatch({ type: 'tunables', patch: { ultFieldChargeTime: 12, invincible: true } });
    conn.emit(snapOf(tg.game));
    expect(rg.tunables.ultFieldChargeTime).toBe(12);
    rg.step(1 / 60);
    expect(conn.cmds()).toHaveLength(1);
  });

  it('non-host: local tunables edits are reverted, never sent', () => {
    const { tg, conn, rg } = setup(1, 0);
    conn.emit(snapOf(tg.game));
    rg.tunables.gameSpeed = 4;
    rg.step(1 / 60);
    expect(conn.cmds()).toHaveLength(0);
    expect(rg.tunables.gameSpeed).toBe(1);
  });

  it('entity positions are interpolated a little in the past: no jump, no stop when a snapshot is late; teleports snap', () => {
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { tg, conn, rg } = setup();
    const T = 1_700_000_000_000;
    const DT = 1000 / 15;
    conn.emit(snapOf(tg.game, { serverTime: T }));
    const id = rg.state.players[1].party[0].entityId!;
    const start = { ...rg.state.entities.find(e => e.id === id)!.pos };
    const e = tg.w.state.entities.find(x => x.id === id)!;
    const xOf = () => rg.state.entities.find(x => x.id === id)!.pos.x;
    // a unit walking right at 3 units/s, snapshots every 66.7 ms, one arrives 50 ms late (jitter)
    const xs: number[] = [];
    let k = 0;
    let nextArrival = DT;
    for (let f = 1; f <= 120; f++) {
      now += 1000 / 60;
      while (now - 10_000 >= nextArrival) {
        k++;
        e.pos = { x: start.x + 0.2 * k, y: start.y };
        conn.emit(snapOf(tg.game, { serverTime: T + DT * k }));
        nextArrival = DT * (k + 1) + (k === 12 ? 50 : 0);
      }
      rg.step(1 / 60);
      xs.push(xOf());
    }
    // drawn behind the newest snapshot (by about one interval + jitter), never ahead of it by more than a frame
    expect(xOf()).toBeLessThan(start.x + 0.2 * k);
    expect(xOf()).toBeGreaterThan(start.x + 0.2 * k - 0.2 * 4);
    expect(rg.interpDelayMs).toBeGreaterThan(DT * 0.9);
    // after the start-up second, every frame moves forward (no frame stuck in place), including around the late one
    const steps = xs.slice(30).map((x, i, a) => (i ? x - a[i - 1] : 1));
    expect(Math.min(...steps)).toBeGreaterThan(0);
    // and steadily (a frame's step stays within 3× the mean step)
    const mean = (xs[xs.length - 1] - xs[30]) / (xs.length - 31);
    expect(Math.max(...steps.slice(1))).toBeLessThan(mean * 3);
    // a long jump is not eased: it shows within a few frames, without passing through the middle
    k++;
    e.pos = { x: start.x + 50, y: start.y };
    conn.emit(snapOf(tg.game, { serverTime: T + DT * k }));
    const seen: number[] = [];
    for (let f = 0; f < 10; f++) {
      now += 1000 / 60;
      rg.step(1 / 60);
      seen.push(xOf());
    }
    expect(seen.at(-1)).toBeCloseTo(start.x + 50, 5);
    expect(seen.every(x => x < start.x + 30 || x === start.x + 50)).toBe(true);
  });

  it('silent stall: after 1.5 s without snapshots the game reports stalled and refuses inputs; after 5 s it asks for a new socket', () => {
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { tg, conn, rg } = setup();
    conn.emit(snapOf(tg.game, { serverTime: 1_000_000 }));
    expect(rg.stalled).toBe(false);
    // commands carry the newest snapshot tick so the server can drop stale ones
    expect(rg.dispatch({ type: 'pet', player: 1, petIndex: 0, pos: { x: 5, y: 5 } }).ok).toBe(true);
    expect(conn.cmds()[0].atTick).toBe(tg.game.state.tick);
    now += 1600;
    rg.step(1 / 60);
    expect(rg.stalled).toBe(true);
    expect(rg.canSwap(1, 1)).toEqual({ ok: false, reason: '연결이 불안정해요' });
    expect(rg.dispatch({ type: 'swap', player: 1, partyIndex: 1, pos: { x: 5, y: 5 } })).toEqual({ ok: false, reason: '연결이 불안정해요' });
    expect(conn.cmds()).toHaveLength(1);
    expect(conn.reconnects).toBe(0);
    now += 3500;
    rg.step(1 / 60);
    expect(conn.reconnects).toBe(1);
    // a fresh snapshot (after the reconnect) clears it
    conn.emit(snapOf(tg.game, { serverTime: 1_005_100 }));
    expect(rg.stalled).toBe(false);
    expect(rg.canSwap(1, 1).ok).toBe(true);
    // the run is over / the game ended: no stall banner while the result shows
    now += 3000;
    rg.ended = true;
    expect(rg.stalled).toBe(false);
  });

  it('dispose stops listening', () => {
    const { tg, conn, rg } = setup();
    rg.dispose();
    conn.emit(snapOf(tg.game));
    expect(rg.ready).toBe(false);
  });
});
