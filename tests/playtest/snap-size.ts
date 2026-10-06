// Snapshot size on the wire, without a server or browsers (기획 13차 integration: before/after the groggy / renewal
// round). Runs the sim with 3 bot seats and builds every snapshot frame exactly like server/room.ts (wireJson of the
// state + the events since the last frame, at SNAPSHOT_HZ), then measures:
//   raw  = JSON bytes per frame (avg / max)
//   wire = bytes after permessage-deflate with context takeover (one zlib stream per client, level 4, sync flush)
// Same seeds and scenarios on any checkout, so an old tree can be measured by copying this file into it.
// Run: npx vite-node tests/playtest/snap-size.ts   (env SNAP_SEC = seconds per scenario, default 40;
// SNAP_TUN = JSON tunables over every scenario, e.g. '{"ultPerCharacter":true,"swapEnergyMode":true}' — 기획 14차)

import { constants, createDeflateRaw, type DeflateRaw } from 'node:zlib';
import { wireJson } from '../../server/snapshot';
import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { SNAPSHOT_HZ } from '../../src/net/protocol';
import { createGameWithWorld, tick } from '../../src/sim/game';
import type { GameEvent, PlayerSetup, Tunables } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEC = Number(env.SNAP_SEC ?? 40);
const EXTRA = JSON.parse(env.SNAP_TUN ?? '{}') as Partial<Tunables>;

interface Scenario {
  name: string;
  seed: number;
  startFloor: number;
  tunables: Partial<Tunables>;
}

const SCENARIOS: Scenario[] = [
  { name: 'normal 1F', seed: 101, startFloor: 1, tunables: {} },
  { name: 'boss 5F', seed: 505, startFloor: 5, tunables: { invincible: true } },
  { name: 'boss 20F + ult every 3 s', seed: 2020, startFloor: 20, tunables: { invincible: true, ultChargeTime: 3 } },
  { name: 'stress 9F (30 alive, ult every 3 s)', seed: 4040, startFloor: 9, tunables: { waveInterval: 1, monsterHpMult: 25, ultChargeTime: 3, invincible: true, midBossTimeTrigger: 3 } },
];

const SEATS: PlayerSetup[] = [0, 1, 2].map(i => ({ ...BOT_PRESETS[i % BOT_PRESETS.length], name: `P${i}`, isBot: true }));

function deflater(): { def: DeflateRaw; push(s: string): Promise<number> } {
  const def = createDeflateRaw({ level: 4, memLevel: 8, windowBits: 15 });
  let out = 0;
  def.on('data', (c: Buffer) => (out += c.length));
  return {
    def,
    push: s =>
      new Promise<number>(resolve => {
        const before = out;
        def.write(s);
        def.flush(constants.Z_SYNC_FLUSH, () => resolve(out - before - 4)); // ws strips the 00 00 ff ff tail
      }),
  };
}

async function run(sc: Scenario) {
  const { game, world } = createGameWithWorld({
    seed: sc.seed,
    players: SEATS,
    tunables: { ...DEFAULT_TUNABLES, goedamRoomsPerZone: 0, fieldEventChance: 0, ...sc.tunables, ...EXTRA },
    startFloor: sc.startFloor,
  });
  game.drainEvents();
  const z = deflater();
  const every = Math.round(TICK_RATE / SNAPSHOT_HZ);
  const raw: number[] = [];
  const wire: number[] = [];
  const evBytes: number[] = [];
  let events: GameEvent[] = [];
  let maxEnt = 0;
  const ticks = SEC * TICK_RATE;
  for (let i = 1; i <= ticks && world.state.phase === 'combat'; i++) {
    tick(world);
    events.push(...game.drainEvents());
    if (i % every) continue;
    const eventsJson = wireJson(events);
    const msg =
      `{"t":"snap","tick":${world.state.tick},"serverTime":${1_700_000_000_000 + i * 33},"state":${wireJson(world.state)}` +
      `,"events":${eventsJson},"hostPlayerIndex":0,"rewardDeadline":null,"goedamDeadline":null}`;
    events = [];
    evBytes.push(Buffer.byteLength(eventsJson));
    raw.push(Buffer.byteLength(msg));
    wire.push(await z.push(msg));
    maxEnt = Math.max(maxEnt, world.state.entities.length);
  }
  z.def.close();
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const kb = (x: number) => +(x / 1024).toFixed(1);
  return {
    scenario: sc.name,
    frames: raw.length,
    maxEntities: maxEnt,
    rawAvgKB: kb(avg(raw)),
    rawMaxKB: kb(Math.max(...raw)),
    eventsAvgKB: kb(avg(evBytes)),
    wireAvgKB: kb(avg(wire)),
    wireKBps: kb(avg(wire) * SNAPSHOT_HZ),
  };
}

const rows = [];
for (const sc of SCENARIOS) rows.push(await run(sc));
console.table(rows);
console.log(JSON.stringify(rows));
