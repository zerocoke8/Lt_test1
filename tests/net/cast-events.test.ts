// Multiplayer gets the cast-readability event fields (damage source/skillName, skillCast delay/hits/hitInterval):
// - through the real game server's snapshots (another player's drag skill arrives with its timing and names),
// - and the wire copy (rounded, internal keys dropped) renders exactly the same effects as the local events.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/config';
import { getCharacter } from '../../src/data';
import { createGame } from '../../src/sim';
import { newMemo, type UnitMemo } from '../../src/render/units';
import { Vfx } from '../../src/render/vfx';
import type { RunningServer } from '../../server/server';
import { cleanState, wireJson } from '../../server/snapshot';
import type { GameEvent, GameState } from '../../src/types';
import { PRESET_A, PRESET_B, sleep, startTestServer, TestClient } from './helpers';

type Cast = Extract<GameEvent, { type: 'skillCast' }>;
type Dmg = Extract<GameEvent, { type: 'damage' }>;

let srv: RunningServer | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.kill();
  if (srv) await srv.close();
  srv = null;
});

describe('cast events over the wire', () => {
  it("another player's drag skill reaches me with its part timings, and its hits carry source + skill name", async () => {
    srv = await startTestServer();
    const a = await TestClient.connect(srv.port, 'A');
    const b = await TestClient.connect(srv.port, 'B');
    clients.push(a, b);
    a.send({ t: 'createRoom', preset: PRESET_A });
    const code = (await a.next('room', m => !!m.room)).room!.code;
    b.send({ t: 'joinRoom', code, preset: PRESET_B });
    await b.next('room', m => !!m.room && m.room.code === code);
    a.mark();
    b.mark();
    a.send({ t: 'start' });
    await a.next('start');
    await b.next('start');
    a.send({ t: 'cmd', seq: 1, cmd: { type: 'tunables', patch: { gameSpeed: 2 } } });
    // wait for the first wave, then A drops the mage (PRESET_A slot 2) on a monster: 5 meteors, one after another
    const withFoe = await a.snap(m => m.state.entities.some(e => e.team === 'enemy' && e.hp > 0), 15_000);
    const foe = withFoe.state.entities.find(e => e.team === 'enemy' && e.hp > 0)!;
    b.mark();
    a.send({ t: 'cmd', seq: 2, cmd: { type: 'swap', player: 0, partyIndex: 2, pos: { ...foe.pos } } });
    expect((await a.next('cmdResult', m => m.seq === 2)).ok).toBe(true);
    const seen: GameEvent[] = [];
    const until = Date.now() + 6000;
    while (Date.now() < until) {
      const snap = await b.snap(() => true, 4000);
      seen.push(...snap.events);
      const casts = seen.filter((e): e is Cast => e.type === 'skillCast' && e.skillId === 'mage_d');
      if (casts.length >= 5 && seen.some(e => e.type === 'damage' && e.source === 'drag')) break;
      await sleep(10);
    }
    const meteors = seen.filter((e): e is Cast => e.type === 'skillCast' && e.skillId === 'mage_d');
    expect(meteors.map(m => m.player)).toEqual([0, 0, 0, 0, 0]);
    expect(meteors.map(m => m.slot)).toEqual(['drag', 'drag', 'drag', 'drag', 'drag']);
    expect(meteors.map(m => m.delay)).toEqual(getCharacter('mage').drag.actions.map(x => x.delay));
    const dmg = seen.filter((e): e is Dmg => e.type === 'damage' && e.targetTeam === 'enemy');
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every(d => typeof d.source === 'string')).toBe(true);
    const drag = dmg.filter(d => d.source === 'drag');
    expect(drag.length).toBeGreaterThan(0);
    expect(drag.every(d => d.skillName === '유성우')).toBe(true);
  }, 30_000);
});

/** What the renderer spawned (kinds/texts/counts; particle positions are random and left out). */
function signature(v: Vfx): string {
  const sfx = v.sfx.pool.items.slice(0, v.sfx.pool.count).map(f => f.kind).sort();
  const labels = v.labels.items.slice(0, v.labels.count).map(l => `${l.text}|${l.size}`).sort();
  const nums = v.floaters.items.slice(0, v.floaters.count).map(f => `${f.kind}|${f.text}|${f.label}|${f.size}`).sort();
  return JSON.stringify({ sfx, labels, nums, flashes: v.flashes.count, rings: v.rings.count, dashes: v.dashes.count, banner: v.banner.title });
}

function syncMemos(memos: Map<number, UnitMemo>, s: GameState): void {
  for (const e of s.entities) {
    const m = memos.get(e.id);
    if (!m) memos.set(e.id, newMemo(e, 0));
    else {
      m.x = e.pos.x;
      m.y = e.pos.y;
    }
  }
}

describe('wire copy renders the same casts', () => {
  it('local events and their snapshot copy spawn the same effects, numbers and names (me and the other player)', () => {
    const g = createGame({
      seed: 11,
      players: [
        { name: '나', isBot: false, characters: ['blade', 'mage', 'shadow'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
        { name: '둘', isBot: false, characters: ['ranger', 'bard', 'gunner'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] },
      ],
      tunables: { ...DEFAULT_TUNABLES, instantCooldowns: true },
    });
    g.drainEvents();
    for (let i = 0; i < 30 * 12 && !g.state.entities.some(e => e.team === 'enemy'); i++) g.step(1 / 30);
    g.drainEvents();
    const local = { v: new Vfx(), memos: new Map<number, UnitMemo>() };
    const remote = { v: new Vfx(), memos: new Map<number, UnitMemo>() };
    let casts = 0;
    const foePos = () => ({ ...(g.state.entities.find(e => e.team === 'enemy' && e.hp > 0)?.pos ?? { x: 14, y: 6 }) });
    // both players use drag skills (meteors, chained blasts, dash, band, cone) and ults (multi-hit) during 8 s
    const plan: Record<number, () => void> = {
      0: () => g.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: foePos() }),
      20: () => g.dispatch({ type: 'swap', player: 1, partyIndex: 1, pos: foePos() }),
      45: () => g.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: foePos() }),
      70: () => g.dispatch({ type: 'swap', player: 1, partyIndex: 2, pos: foePos() }),
      95: () => g.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: foePos() }),
      100: () => {
        g.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
        g.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
      },
      110: () => g.dispatch({ type: 'ult', player: 0 }),
      115: () => g.dispatch({ type: 'ult', player: 1 }),
    };
    for (let i = 0; i < 30 * 8; i++) {
      plan[i]?.();
      g.step(1 / 30);
      const evs = g.drainEvents();
      casts += evs.filter(e => e.type === 'skillCast').length;
      const wire = JSON.parse(wireJson({ events: evs, state: g.state })) as { events: GameEvent[]; state: GameState };
      syncMemos(local.memos, g.state);
      syncMemos(remote.memos, wire.state);
      const lc = { state: g.state, memos: local.memos, localPlayer: 0 };
      const rc = { state: cleanState(g.state), memos: remote.memos, localPlayer: 0 };
      for (const e of evs) local.v.handle(e, lc);
      for (const e of wire.events) remote.v.handle(e, rc);
      local.v.update(1 / 30, lc);
      remote.v.update(1 / 30, rc);
      expect(signature(remote.v), `frame ${i}`).toBe(signature(local.v));
    }
    expect(casts).toBeGreaterThan(10);
  });
});
