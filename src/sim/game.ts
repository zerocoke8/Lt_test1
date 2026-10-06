// Game facade: world construction, fixed-tick loop, command dispatch, debug actions.

import type { AreaShape, Command, CommandResult, DebugAction, Game, GameEvent, GameSetup, Vec2 } from '../types';
import { PLAYER_COLORS, TICK_DT } from '../config';
import { GOEDAM_ROOMS, getCharacter, getPet, isFieldEventId } from '../data';
import { BOT } from './constants';
import { tickBots } from './bot';
import { killEntity, tickProjectiles } from './combat';
import { createCharacterEntity } from './entities';
import { forceFieldEvent, newFieldEventRt, tickFieldEvents } from './fieldEvents';
import { forceGroggy, tickGroggy } from './groggy';
import { chooseReward, clearRewardOffers, enrage, floorClear, goedamCommand, planFloor, setPlayerBot, startFloor, tickFloorState, tickSpawner } from './floor';
import { skillMod } from './modifiers';
import { previewPartsFor } from './preview';
import { canSwap, canUsePet, doSwap, syncMembers, tickPlayers, useUlt, usePet } from './players';
import { Rng } from './rng';
import { scaleArea, tickPending, tickZones } from './skills';
import { benchMaxHp } from './stats';
import { applyTunablesPatch, computeTelemetry, emptyContribution } from './telemetry';
import { tickUnits } from './units';
import {
  clampToArena,
  compactEntities,
  emit,
  endRun,
  isAlive,
  type SimMember,
  type SimPlayer,
  type SimState,
  type World,
} from './world';

export function createWorld(setup: GameSetup): World {
  const tunables = { ...setup.tunables };
  const rng = new Rng(setup.seed);
  const startFloorN = Math.max(1, Math.floor(setup.startFloor ?? 1));
  // Placeholder plan so the state is complete; startFloor() below re-plans with the run rng.
  const plan = planFloor(startFloorN, new Rng(setup.seed ^ 0x5bd1e995), tunables);
  const state: SimState = {
    seed: setup.seed,
    tick: 0,
    time: 0,
    phase: 'combat',
    floor: startFloorN,
    plan,
    floorTime: 0,
    timeRemaining: plan.timeLimit,
    entities: [],
    players: [],
    telegraphs: [],
    zones: [],
    projectiles: [],
    bossId: null,
    bossEnraged: false,
    wavesRemaining: 0,
    monstersAlive: 0,
    midBossSpawned: false,
    rewardOffers: null,
    rewardOffersByPlayer: [],
    goedam: null,
    fieldEvent: null,
    bossGroggy: null,
    runResult: null,
  };
  const w: World = {
    state,
    tunables,
    rng,
    events: [],
    nextId: 1,
    acc: 0,
    pending: [],
    spawner: { points: [], nextWave: 0, pending: [], kills: 0, midTriggered: false, deferred: [] },
    floorTimes: [],
    bossRetreat: false,
    enragedEmptyTime: 0,
    byId: new Map(),
    humanOffers: null,
    goedam: { forced: null, seen: [] },
    fieldEvents: newFieldEventRt(),
    groggy: { sinceGain: 0, breakSerial: 0 },
  };

  const n = setup.players.length;
  setup.players.forEach((ps, i) => {
    const party: SimMember[] = ps.characters.map(id => {
      const def = getCharacter(id);
      return {
        defId: def.id,
        hp: def.stats.maxHp,
        maxHp: def.stats.maxHp,
        shield: 0,
        statuses: [],
        dead: false,
        reviveRemaining: 0,
        swapCooldownRemaining: 0,
        swapCooldownTotal: def.swapCooldown,
        normalCooldownRemaining: 0,
        entityId: null,
        rt: { shieldTime: 0 },
      };
    });
    const p: SimPlayer = {
      id: i,
      name: ps.name,
      isBot: ps.isBot,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length] ?? '#ffffff',
      party,
      activeIndex: null,
      pets: ps.pets.map(id => {
        const def = getPet(id);
        return { defId: def.id, cooldownRemaining: 0, cooldownTotal: def.cooldown };
      }),
      ult: { charge: 0, fullSince: null },
      out: false,
      appearLock: 0,
      relics: [],
      rewards: [],
      stats: emptyContribution(),
      goedamTraces: [],
      goedamLog: [],
      rt: {
        bot: {
          thinkIn: (BOT.thinkInterval * (i + 1)) / (n + 1),
          nextSwapAt: rng.range(BOT.periodicSwap[0], BOT.periodicSwap[1]),
          reactAt: null,
          ultAt: null,
          viewX: null,
        },
      },
    };
    p.party.forEach((m, idx) => {
      m.maxHp = benchMaxHp(p, idx);
      m.hp = m.maxHp;
    });
    state.players.push(p);
  });

  // R1: character 1 starts on field; 2·3 are immediately swappable (cooldown 0).
  // R4 (기획 6차): a character's re-appear cooldown starts when it is swapped out, so character 1 has none while it
  // fights; swapping 1→2 starts 1's cooldown (no free 1→2→1 drag skill).
  for (const p of state.players) {
    if (p.party.length === 0) continue;
    createCharacterEntity(w, p, 0, { x: 0, y: 0 });
  }
  startFloor(w, startFloorN, false);
  syncMembers(w);
  return w;
}

export function tick(w: World): void {
  const s = w.state;
  // time is frozen outside combat (reward, 괴담 room, run over) — 기획 10차 guard; callers only tick in combat
  if (s.phase !== 'combat') return;
  const dt = TICK_DT;
  s.tick++;
  s.time += dt;
  s.floorTime += dt;
  s.timeRemaining = Math.max(0, s.plan.timeLimit - s.floorTime);
  tickPlayers(w, dt);
  tickSpawner(w, dt);
  tickFieldEvents(w, dt);
  tickUnits(w, dt);
  if (s.phase === 'combat') tickGroggy(w, dt); // 기획 13차: countdown / lock / decay
  if (s.phase === 'combat') tickProjectiles(w, dt);
  if (s.phase === 'combat') tickPending(w, dt);
  if (s.phase === 'combat') tickZones(w, dt);
  syncMembers(w);
  compactEntities(w);
  tickFloorState(w, dt);
  if (s.phase === 'combat') tickBots(w, dt, cmd => dispatch(w, cmd));
  compactEntities(w); // also after a run end this tick (its closed 돌발 괴담 units must not reach the last snapshot)
}

export function step(w: World, realDt: number): void {
  if (w.state.phase !== 'combat') return;
  if (!(realDt > 0)) return;
  const dt = Math.min(realDt, 0.25) * Math.max(0, w.tunables.gameSpeed);
  w.acc += dt;
  while (w.acc >= TICK_DT - 1e-9) {
    w.acc -= TICK_DT;
    tick(w);
    if (w.state.phase !== 'combat') {
      w.acc = 0;
      break;
    }
  }
}

export function dispatch(w: World, cmd: Command): CommandResult {
  const s = w.state;
  let r: CommandResult;
  switch (cmd.type) {
    case 'swap':
      r = doSwap(w, cmd.player, cmd.partyIndex, cmd.pos);
      break;
    case 'pet':
      r = usePet(w, cmd.player, cmd.petIndex, cmd.pos);
      break;
    case 'ult':
      r = useUlt(w, cmd.player);
      break;
    case 'chooseReward':
      r = chooseReward(w, cmd.player, cmd.offerIndex);
      break;
    case 'goedam':
      r = goedamCommand(w, cmd.player, cmd.option);
      break;
    case 'quit':
      if (s.phase === 'runOver') r = { ok: false, reason: '이미 끝남' };
      else {
        endRun(w, 'defeat', 'quit');
        clearRewardOffers(w);
        r = { ok: true };
      }
      break;
    case 'debug':
      r = debug(w, cmd.action);
      break;
    case 'tunables':
      r = applyTunablesPatch(w.tunables, cmd.patch);
      break;
    default:
      r = { ok: false, reason: '알 수 없는 명령' };
  }
  if (r.ok) {
    syncMembers(w);
    compactEntities(w);
  }
  return r;
}

function debug(w: World, a: DebugAction): CommandResult {
  const s = w.state;
  if (s.phase === 'runOver') return { ok: false, reason: '이미 끝남' };
  const pi = (a.kind === 'chargeUlt' || a.kind === 'resetCooldowns') && a.player != null ? a.player : 0;
  const p0 = Number.isInteger(pi) ? s.players[pi] : undefined;
  switch (a.kind) {
    case 'chargeUlt':
      if (!p0) return { ok: false, reason: '플레이어 없음' };
      p0.ult.charge = 1;
      if (p0.ult.fullSince == null) {
        p0.ult.fullSince = s.time;
        emit(w, { type: 'ultReady', player: p0.id });
      }
      return { ok: true };
    case 'resetCooldowns':
      if (!p0) return { ok: false, reason: '플레이어 없음' };
      for (const m of p0.party) {
        m.swapCooldownRemaining = 0;
        m.normalCooldownRemaining = 0;
      }
      for (const pet of p0.pets) pet.cooldownRemaining = 0;
      return { ok: true };
    case 'killAll':
      if (s.phase !== 'combat') return { ok: false, reason: '전투 중이 아님' };
      // 기획 12차: 돌발 괴담 units stay (killing them here would count as the event's success)
      for (const e of s.entities) if (e.team === 'enemy' && e.tier !== 'boss' && !e.eventTag && isAlive(e)) killEntity(w, e, null, { noOnDeath: true });
      w.spawner.deferred = [];
      return { ok: true };
    case 'skipFloor':
      if (s.phase !== 'combat') return { ok: false, reason: '전투 중이 아님' };
      floorClear(w);
      return { ok: true };
    case 'jumpFloor':
      startFloor(w, Math.min(Math.max(1, Math.floor(a.floor)), Math.max(1, w.tunables.maxFloor)), true);
      return { ok: true };
    case 'forceEnrage':
      if (s.phase !== 'combat' || s.plan.kind !== 'boss' || s.bossEnraged) return { ok: false, reason: '광폭화 불가' };
      enrage(w);
      return { ok: true };
    case 'goedamNext':
      if (a.room != null && !GOEDAM_ROOMS.some(r => r.id === a.room)) return { ok: false, reason: '알 수 없는 방' };
      w.goedam.forced = a.room ?? '';
      return { ok: true };
    case 'fieldEventNext':
      // 기획 12차: now (normal floor, early in combat) or 8 s into the next normal floor
      if (a.id != null && !isFieldEventId(a.id)) return { ok: false, reason: '알 수 없는 돌발 괴담' };
      forceFieldEvent(w, a.id);
      return { ok: true };
    case 'forceGroggy':
      // 기획 13차: fill the boss groggy gauge (1 = break now)
      return forceGroggy(w, a.fill ?? 1) ? { ok: true } : { ok: false, reason: '그로기 불가' };
  }
  return { ok: false, reason: '알 수 없는 디버그 명령' };
}

/** First preview part's area (kept for compatibility; the full footprint is previewParts). */
export function previewArea(w: World, player: number, kind: 'swap' | 'pet', index: number): AreaShape {
  return previewPartsFor(w.state, player, kind, index)[0]?.area ?? { shape: 'single' };
}

export function drainEvents(w: World): GameEvent[] {
  const out = w.events;
  w.events = [];
  return out;
}

/** Game plus its internal world (tests / tools). */
export function createGameWithWorld(setup: GameSetup): { game: Game; world: World } {
  const w = createWorld(setup);
  const game: Game = {
    get state() {
      return w.state;
    },
    get tunables() {
      return w.tunables;
    },
    dispatch: (cmd: Command) => dispatch(w, cmd),
    step: (realDt: number) => step(w, realDt),
    drainEvents: () => drainEvents(w),
    canSwap: (player: number, partyIndex: number) => canSwap(w, player, partyIndex),
    canUsePet: (player: number, petIndex: number) => canUsePet(w, player, petIndex),
    previewArea: (player: number, kind: 'swap' | 'pet', index: number) => previewArea(w, player, kind, index),
    previewParts: (player: number, kind: 'swap' | 'pet', index: number) => previewPartsFor(w.state, player, kind, index),
    setPlayerBot: (player: number, isBot: boolean) => {
      setPlayerBot(w, player, isBot);
      syncMembers(w);
    },
    clampToArena: (p: Vec2) => clampToArena(w, p),
    telemetry: (player?: number) => computeTelemetry(w, player ?? 0),
  };
  return { game, world: w };
}

export function createGame(setup: GameSetup): Game {
  return createGameWithWorld(setup).game;
}
