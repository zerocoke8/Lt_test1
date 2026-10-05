import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { getMonster } from '../../src/data';
import { createUnit } from '../../src/sim/entities';
import { createGameWithWorld, tick } from '../../src/sim/game';
import { applyDamage } from '../../src/sim/combat';
import { activeEntity, type SimEntity, type World } from '../../src/sim/world';
import type { Game, GameEvent, PlayerSetup, Tunables, Vec2 } from '../../src/types';

export const HUMAN: PlayerSetup = {
  name: '나',
  isBot: false,
  characters: ['guardian', 'blade', 'mage'],
  pets: ['frog_bomb', 'fairy_heal', 'golem_turret'],
};
export const HUMAN2: PlayerSetup = {
  name: '둘',
  isBot: false,
  characters: ['ranger', 'cleric', 'berserker'],
  pets: ['owl_frost', 'turtle_guard', 'rabbit_time'],
};
export const BOT1: PlayerSetup = { ...BOT_PRESETS[0], isBot: true };
export const BOT2: PlayerSetup = { ...BOT_PRESETS[1], isBot: true };

export interface TestGame {
  game: Game;
  w: World;
  events: GameEvent[];
}

export function makeGame(opts: { seed?: number; players?: PlayerSetup[]; tunables?: Partial<Tunables>; startFloor?: number } = {}): TestGame {
  const { game, world } = createGameWithWorld({
    seed: opts.seed ?? 1234,
    players: opts.players ?? [HUMAN],
    // 기획 10차: 괴담 rooms off unless a test turns them on (most tests cross floors 2–4 and expect the next floor);
    // 기획 12차: 돌발 괴담 off too (explicit, like the rooms) — tests/sim/field-events.test.ts turns them on
    tunables: { ...DEFAULT_TUNABLES, goedamRoomsPerZone: 0, fieldEventChance: 0, ...(opts.tunables ?? {}) },
    startFloor: opts.startFloor,
  });
  const tg: TestGame = { game, w: world, events: [] };
  tg.events.push(...game.drainEvents());
  return tg;
}

/** Advance whole sim ticks (independent of gameSpeed); stops when combat ends. */
export function advance(tg: TestGame, seconds: number): void {
  const n = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < n; i++) {
    if (tg.w.state.phase !== 'combat') break;
    tick(tg.w);
  }
  tg.events.push(...tg.game.drainEvents());
}

export function drain(tg: TestGame): GameEvent[] {
  tg.events.push(...tg.game.drainEvents());
  return tg.events;
}

export function eventsOf<T extends GameEvent['type']>(tg: TestGame, type: T): Extract<GameEvent, { type: T }>[] {
  drain(tg);
  return tg.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export function clearEvents(tg: TestGame): void {
  tg.game.drainEvents();
  tg.events.length = 0;
}

/**
 * Stop wave/mid-boss spawning and remove every enemy (no death events, no kills).
 * The floor never clears by itself afterwards (mid boss marked triggered but never spawned).
 */
export function quietFloor(tg: TestGame): void {
  const { w } = tg;
  const s = w.state;
  w.spawner.nextWave = s.plan.waves.length;
  w.spawner.pending = [];
  w.spawner.midTriggered = true;
  s.midBossSpawned = false;
  for (const e of s.entities) if (e.team === 'enemy' && e.tier !== 'boss') e.rt.gone = true;
}

export function spawnAt(tg: TestGame, monsterId: string, pos: Vec2): SimEntity {
  return createUnit(tg.w, getMonster(monsterId), pos, 'enemy', { kind: 'monster', ownerPlayer: null, expiresIn: null, hpMult: 1, atkMult: 1 });
}

export function active(tg: TestGame, player = 0): SimEntity {
  const e = activeEntity(tg.w, tg.w.state.players[player]);
  if (!e) throw new Error(`player ${player} has no active entity`);
  return e;
}

/** Kill player's active character with a huge hit. */
export function killActive(tg: TestGame, player = 0): void {
  const e = active(tg, player);
  e.invulnTime = 0;
  e.shield = 0;
  applyDamage(tg.w, { casterId: null, team: 'enemy', player: null, source: 'basic', isDrag: false }, e, 1e9, false);
}

export function entityById(tg: TestGame, id: number | null): SimEntity | undefined {
  return tg.w.state.entities.find(e => e.id === id && !e.rt.gone);
}
