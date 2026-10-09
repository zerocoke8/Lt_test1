// 기획 15차 원정 밸런스 bench (docs/expedition.md 11장): headless expedition stages over the real sim (no rendering).
// Run: npx vite-node tests/review/expedition-bench.ts   (all knobs via env, output = one JSON object on stdout)
//
//   MODE=stage|chain          stage = each listed stage on its own, the party fresh (no carry) — the 11-1 target table
//                             chain = start at each listed stage and 「다음 단계 도전」 with the real carry until a
//                                     failure or stage 12 (STOP=boss: until the next boss stage is cleared)
//   STAGES=1-12 | 3,6,9,12    stages (range or list)
//   DELTAS=0 | -2,-1,0,1      human gear tier = stage − 1 + Δ (clamped 0..12; 0 = no gear), all 3 characters,
//                             common 무기 · 방어구 · 장신구 (no relic, no effect) — 「T(s−1) 한 벌」. GEAR=none: no gear at all.
//   RUNS=40 SEED0=1000        runs per (stage, Δ); seeds SEED0 + k × 7919 (same seeds for every cell)
//   POLICY=active|botseat     player 0 (the only human; 2 bots fill the seats like 혼자 하기)
//       active  = critic-20f.ts 「직접 교체」: swap every ~4 s to the best drag spot, pets on clusters, own ult 0.5 s
//                 after full, hold a near-full field gauge, swap in a full bench card for a fight worth it, plays the
//                 돌발 괴담 like a bot (once-per-event swap, event pet rules)
//       botseat = player 0's swaps / pets / ult by the stock bot AI (the sim still treats the seat as human)
//   BOT_GEAR=auto|start|match auto  = the sim's bots: T(stage − 1) commons (7장)
//                             start = T(run start stage − 1) for the whole run (chain mode: bots do not grow with the chain)
//                             match = the human's own loadout (all 3 seats short / over by Δ — 3 humans alike)
//   CARRY_REWARDS=all|half    chain mode: half = keep only every other carried floor reward (≈ 1 reward per stage)
//   PATCH='{"stageMult.4":0.95,"waves":[6,7,5],"guardianHp":1.6}'   EXPEDITION edits before the runs
//   TUN='{"ultFieldChargeTime":30}'                                    tunables override
//   OVERHEAD=60               seconds outside combat per stage (reward picks, banners, room, choice, matching) for
//                             the modelled stage total (spec 3-3: 45–75 s)
//
// Rewards: player 0 takes the first offer (active) or a random one (botseat); 괴담 rooms: '지나간다'.
// Bots get T(stage − 1) commons from the sim (seatGear). Per cell: clear / wipe / timeout %, combat seconds (3 floors,
// median / p90), per-floor median, modelled total (combat + OVERHEAD), guardian alive time, boss enrage %, groggy
// breaks, character deaths per run (all / player 0), loot of player 0 (rarity mix, relics per boss box).

import { DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { getPet } from '../../src/data';
import { EXPEDITION, type GearLoadout, type GearSpec } from '../../src/data/gear';
import { isBossStage } from '../../src/data/stages';
import { continueRun, onStageCleared, startRun, stageGameSetup, type ExpeditionRun, type RunSeat } from '../../src/expedition/run';
import { bestDropPoint, tickBots } from '../../src/sim/bot';
import { BOT } from '../../src/sim/constants';
import { eventPetPoint, eventThink } from '../../src/sim/botEvents';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { canSwap, canUsePet } from '../../src/sim/players';
import { fieldUltGauge, memberUltGauge } from '../../src/sim/ultMode';
import { activeEntity, clampToArena, dist, isAlive, type SimEntity, type World } from '../../src/sim/world';
import type { GameEvent, Tunables, Vec2 } from '../../src/types';
import { goedamPilot, parseGoedamPolicy, type RewardPick } from '../playtest/goedam-policy';

type Policy = 'active' | 'botseat';
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MODE = env.MODE === 'chain' ? 'chain' : 'stage';
const RUNS = Number(env.RUNS ?? 40);
const SEED0 = Number(env.SEED0 ?? 1000);
const POLICY = (env.POLICY === 'botseat' ? 'botseat' : 'active') as Policy;
const STOP = env.STOP === 'boss' ? 'boss' : 'end';
const NO_GEAR = env.GEAR === 'none';
const TUN: Partial<Tunables> = env.TUN ? JSON.parse(env.TUN) : {};
const OVERHEAD = Number(env.OVERHEAD ?? 60);
const BOT_GEAR = env.BOT_GEAR === 'start' || env.BOT_GEAR === 'match' ? env.BOT_GEAR : 'auto';
const CARRY_HALF = env.CARRY_REWARDS === 'half';

function parseStages(raw: string | undefined): number[] {
  if (!raw) return Array.from({ length: 12 }, (_, i) => i + 1);
  const m = /^(\d+)-(\d+)$/.exec(raw);
  if (m) return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i);
  return raw.split(',').map(Number);
}
const STAGES = parseStages(env.STAGES);
const DELTAS = (env.DELTAS ?? '0').split(',').map(Number);

// ─────────────────────────── data patches ───────────────────────────

/** {"stageMult.4": 0.95} = stage 4 (1-based) multiplier; other keys = EXPEDITION fields (value "*x" multiplies). */
function applyPatch(patch: Record<string, unknown>): void {
  const ex = EXPEDITION as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    const [head, idx] = k.split('.');
    if (!(head in ex)) throw new Error(`PATCH: unknown EXPEDITION.${head}`);
    if (idx != null) {
      const arr = ex[head] as number[];
      const i = head === 'stageMult' ? Number(idx) - 1 : Number(idx);
      arr[i] = typeof v === 'string' && v.startsWith('*') ? arr[i] * Number(v.slice(1)) : (v as number);
    } else ex[head] = typeof v === 'string' && v.startsWith('*') ? (ex[head] as number) * Number(v.slice(1)) : v;
  }
}
if (env.PATCH) applyPatch(JSON.parse(env.PATCH));

// ─────────────────────────── the seat ───────────────────────────

const HUMAN_CHARS = ['blade', 'mage', 'cleric'];
const HUMAN_PETS = ['frog_bomb', 'fairy_heal', 'cat_void'];

/** Common weapon / armor / charm of tier t (0 = nothing). */
export function commonSet(t: number): GearLoadout {
  if (t < 1) return {};
  const g = (slot: GearSpec['slot']): GearSpec => ({ slot, tier: t, rarity: 'common' });
  return { weapon: g('weapon'), armor: g('armor'), charm: g('charm') };
}

export function gearTier(stage: number, delta: number): number {
  return NO_GEAR ? 0 : Math.max(0, Math.min(12, stage - 1 + delta));
}

function petTarget(w: World, pi: number, petIdx: number): Vec2 | null {
  const p = w.state.players[pi];
  const fe = eventPetPoint(w, p, petIdx);
  if (fe !== undefined) return fe;
  const a = getPet(p.pets[petIdx].defId).action;
  const r = a.area.shape === 'circle' ? a.area.radius : 1;
  const foes = w.state.entities.filter(e => e.team === 'enemy' && isAlive(e));
  if (a.affects === 'enemies' || a.summon) {
    let best: { c: Vec2; n: number } | null = null;
    for (const f of foes) {
      let n = 0;
      for (const q of foes) if (dist(q.pos, f.pos) <= r + q.radius) n += q.tier === 'boss' ? 4 : q.tier === 'mid' ? 2 : 1;
      if (!best || n > best.n) best = { c: f.pos, n };
    }
    return best && best.n >= 3 ? clampToArena(w, best.c) : null;
  }
  const mine = activeEntity(w, p);
  const allies = w.state.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e));
  const heals = a.effects.some(e => e.kind === 'heal');
  const hurt = allies.filter(x => x.hp < x.maxHp * (heals ? 0.6 : 0.75));
  if (hurt.length === 0 || foes.length === 0) return null;
  return clampToArena(w, (mine && hurt.includes(mine) ? mine : hurt[0]).pos);
}

interface Brain {
  lastSwap: number;
  ultAt: number | null;
  react: number | null;
}

const ULT_HOLD = 0.85;
const ultWorthy = (foes: SimEntity[]) => foes.some(e => e.tier === 'boss' || e.tier === 'mid') || foes.length >= BOT.ultSwapEnemies;

/** critic-20f.ts 'active' (FE_SEAT=play), every 0.25 s. */
function activeThink(w: World, pi: number, st: Brain): void {
  const s = w.state;
  const p = s.players[pi];
  if (p.out || s.phase !== 'combat') return;
  const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
  const me = activeEntity(w, p);
  const ult = fieldUltGauge(p);
  if (ult && ult.charge >= 1 && me && foes.length) {
    if (st.ultAt == null) st.ultAt = s.time + 0.5;
    if (s.time >= st.ultAt && dispatch(w, { type: 'ult', player: pi }).ok) st.ultAt = null;
  }
  if (eventThink(w, p, cmd => dispatch(w, cmd))) st.lastSwap = s.time;
  const ready = [0, 1, 2].filter(i => canSwap(w, pi, i).ok);
  const holding = !!ult && ult.charge >= ULT_HOLD;
  const ultIn =
    me && !holding && ultWorthy(foes)
      ? ready.filter(i => (memberUltGauge(p, i)?.charge ?? 0) >= 1).sort((a, b) => (memberUltGauge(p, a)!.fullSince ?? 0) - (memberUltGauge(p, b)!.fullSince ?? 0))[0]
      : undefined;
  let go = false;
  if (!me) {
    if (ready.length) {
      if (st.react == null) st.react = s.time + 0.6;
      go = s.time >= st.react;
    }
  } else go = me.hp < me.maxHp * 0.35 || (s.time - st.lastSwap >= 4 && foes.length > 0 && !holding) || ultIn != null;
  const hpOf = (i: number) => p.party[i].hp / p.party[i].maxHp;
  const idx = go ? (ultIn ?? [...ready].sort((a, b) => hpOf(b) - hpOf(a))[0]) : undefined;
  if (idx != null && dispatch(w, { type: 'swap', player: pi, partyIndex: idx, pos: bestDropPoint(w, p, idx) }).ok) {
    st.lastSwap = s.time;
    st.react = null;
  }
  for (let i = 0; i < p.pets.length; i++) {
    if (!canUsePet(w, pi, i).ok) continue;
    const pos = petTarget(w, pi, i);
    if (pos && dispatch(w, { type: 'pet', player: pi, petIndex: i, pos }).ok) break;
  }
}

/** 'botseat': player 0's combat turn by the stock bot AI. */
function botSeatThink(w: World): void {
  const ps = w.state.players;
  const was = ps.map(q => q.isBot);
  ps.forEach((q, i) => (q.isBot = i === 0));
  tickBots(w, 1 / TICK_RATE, cmd => dispatch(w, cmd));
  ps.forEach((q, i) => (q.isBot = was[i]));
}

const rewardPick: RewardPick = POLICY === 'botseat' ? (offers, _pi, w) => w.rng.int(0, offers.length - 1) : () => 0;
const GOEDAM = parseGoedamPolicy('leave');

// ─────────────────────────── one stage ───────────────────────────

export interface StageRec {
  stage: number;
  outcome: 'clear' | 'wipe' | 'timeout';
  /** Combat seconds of the floors played (cleared floors + the failed one). */
  combat: number;
  floors: number[];
  failFloor: number | null;
  deaths: number;
  myDeaths: number;
  guardianAlive: number | null;
  enraged: boolean;
  groggy: number;
  loot: GearSpec[];
  rewards: number;
}

function playStage(run: ExpeditionRun, gear: GearLoadout[], tunables: Tunables): StageRec {
  const seat: RunSeat = { name: '나', characters: HUMAN_CHARS, pets: HUMAN_PETS, gear, run, firstBossClear: false };
  const setup = stageGameSetup([seat], tunables);
  for (const ps of setup.players) {
    if (!ps.isBot || BOT_GEAR === 'auto') continue;
    ps.gear = BOT_GEAR === 'match' ? gear.map(l => ({ ...l })) : [0, 1, 2].map(() => commonSet(run.startStage - 1));
  }
  const { game, world: w } = createGameWithWorld(setup);
  const s = w.state;
  game.drainEvents();
  const pilot = goedamPilot(w, GOEDAM);
  const brain: Brain = { lastSwap: -99, ultAt: null, react: null };
  const rec: StageRec = { stage: run.stage, outcome: 'wipe', combat: 0, floors: [], failFloor: null, deaths: 0, myDeaths: 0, guardianAlive: null, enraged: false, groggy: 0, loot: [], rewards: 0 };
  const mine = new Set<number>();
  let guardianSpawn: number | null = null;
  let guardianId: number | null = null;
  let thinkIn = 0;
  let floor = s.floor;
  for (let t = 0; t < TICK_RATE * 60 * 20; t++) {
    if (s.phase === 'reward' || s.phase === 'goedam') {
      pilot.settle([0], rewardPick);
      continue;
    }
    if (s.phase !== 'combat') break;
    if (s.floor !== floor) {
      floor = s.floor;
      brain.lastSwap = -99;
    }
    if (POLICY === 'active') {
      thinkIn -= 1 / TICK_RATE;
      if (thinkIn <= 0) {
        thinkIn = 0.25;
        activeThink(w, 0, brain);
      }
    } else botSeatThink(w);
    tick(w);
    for (const ev of game.drainEvents() as GameEvent[]) {
      if (ev.type === 'death' && ev.kind === 'character') {
        rec.deaths++;
        if (mine.has(ev.entityId)) rec.myDeaths++;
      } else if (ev.type === 'appear' && ev.player === 0) mine.add(ev.entityId);
      else if (ev.type === 'death' && ev.entityId === guardianId && guardianSpawn != null) rec.guardianAlive = s.floorTime - guardianSpawn;
      else if (ev.type === 'spawn' && ev.tier === 'mid' && s.floor === 3 && s.plan.guardian && guardianId == null) {
        guardianId = ev.entityId;
        guardianSpawn = s.floorTime;
      } else if (ev.type === 'enrage') rec.enraged = true;
      else if (ev.type === 'bossGroggy') rec.groggy++;
    }
  }
  rec.floors = w.floorTimes.map(f => f.seconds);
  rec.combat = rec.floors.reduce((a, b) => a + b, 0);
  rec.rewards = s.players[0].rewards.length;
  if ((s.phase as string) === 'stageClear') {
    rec.outcome = 'clear';
    rec.loot = onStageCleared(run, s, 0);
  } else {
    rec.outcome = s.runResult?.reason === 'timeout' ? 'timeout' : 'wipe';
    rec.failFloor = s.floor;
  }
  return rec;
}

// ─────────────────────────── aggregate ───────────────────────────

function pctl(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
/** Modelled stage total in minutes: combat + OVERHEAD. */
const mins = (combatS: number) => (Number.isFinite(combatS) ? Math.round(((combatS + OVERHEAD) / 60) * 100) / 100 : null);

function summarize(stage: number, delta: number, recs: StageRec[]): Record<string, unknown> {
  const n = recs.length;
  const clears = recs.filter(r => r.outcome === 'clear');
  const combat = clears.map(r => r.combat);
  const floorMed = [0, 1, 2].map(j => r1(pctl(clears.map(r => r.floors[j]), 0.5)));
  const loot = clears.flatMap(r => r.loot);
  const failFloors = [1, 2, 3].map(f => recs.filter(r => r.failFloor === f).length);
  const g = recs.map(r => r.guardianAlive).filter((x): x is number => x != null);
  return {
    stage,
    delta,
    tier: gearTier(stage, delta),
    runs: n,
    clearPct: pct(clears.length, n),
    wipePct: pct(recs.filter(r => r.outcome === 'wipe').length, n),
    timeoutPct: pct(recs.filter(r => r.outcome === 'timeout').length, n),
    failByFloor: failFloors,
    combatMedS: r1(pctl(combat, 0.5)),
    combatP90S: r1(pctl(combat, 0.9)),
    totalMedMin: mins(pctl(combat, 0.5)),
    totalP90Min: mins(pctl(combat, 0.9)),
    floorMedS: floorMed,
    guardianAliveMedS: isBossStage(stage) ? null : r1(pctl(g, 0.5)),
    guardianAliveP90S: isBossStage(stage) ? null : r1(pctl(g, 0.9)),
    enragePct: isBossStage(stage) ? pct(recs.filter(r => r.enraged && r.failFloor !== 1 && r.failFloor !== 2).length, recs.filter(r => r.failFloor !== 1 && r.failFloor !== 2).length) : null,
    groggyPerBoss: isBossStage(stage) ? r1(recs.reduce((a, r) => a + r.groggy, 0) / Math.max(1, recs.filter(r => r.failFloor == null || r.failFloor === 3).length)) : null,
    deathsPerRun: r1(recs.reduce((a, r) => a + r.deaths, 0) / n),
    myDeathsPerRun: r1(recs.reduce((a, r) => a + r.myDeaths, 0) / n),
    loot: {
      items: loot.length,
      rare: pct(loot.filter(x => x.rarity === 'rare' && x.slot !== 'relic').length, loot.filter(x => x.slot !== 'relic').length),
      epic: pct(loot.filter(x => x.rarity === 'epic' && x.slot !== 'relic').length, loot.filter(x => x.slot !== 'relic').length),
      relicPerClear: isBossStage(stage) ? r1(loot.filter(x => x.slot === 'relic').length / Math.max(1, clears.length)) : null,
    },
  };
}

const tunables: Tunables = { ...DEFAULT_TUNABLES, ...TUN };
const seeds = Array.from({ length: RUNS }, (_, k) => SEED0 + k * 7919);
const cells: unknown[] = [];

if (MODE === 'stage') {
  for (const stage of STAGES)
    for (const delta of DELTAS) {
      const gear = [0, 1, 2].map(() => commonSet(gearTier(stage, delta)));
      const recs = seeds.map(seed => playStage(startRun(stage, seed), gear, tunables));
      cells.push(summarize(stage, delta, recs));
    }
} else {
  for (const start of STAGES)
    for (const delta of DELTAS) {
      const gear = [0, 1, 2].map(() => commonSet(gearTier(start, delta)));
      const reach: number[] = [];
      const byStage: Record<number, { n: number; clear: number; combat: number[]; rewards: number[] }> = {};
      let bag = 0;
      for (const seed of seeds) {
        const run = startRun(start, seed);
        let cleared = 0;
        for (;;) {
          const r = playStage(run, gear, tunables);
          const b = (byStage[run.stage] ??= { n: 0, clear: 0, combat: [], rewards: [] });
          b.n++;
          b.rewards.push(r.rewards);
          if (r.outcome !== 'clear') break;
          b.clear++;
          b.combat.push(r.combat);
          cleared++;
          if (STOP === 'boss' && isBossStage(run.stage)) break;
          if (!continueRun(run)) break;
          // ≈ 1 floor reward per stage: the floor-2 reward of the stage just cleared stays behind
          if (CARRY_HALF) run.carry?.rewards.pop();
        }
        bag += run.bag.length;
        reach.push(cleared);
      }
      cells.push({
        start,
        delta,
        tier: gearTier(start, delta),
        runs: RUNS,
        meanCleared: r1(reach.reduce((a, b) => a + b, 0) / RUNS),
        reachPct: Array.from({ length: 13 - start }, (_, k) => pct(reach.filter(x => x >= k + 1).length, RUNS)),
        perStage: Object.entries(byStage).map(([st, b]) => ({ stage: Number(st), n: b.n, clearPct: pct(b.clear, b.n), combatMedS: r1(pctl(b.combat, 0.5)), rewardsIn: r1(b.rewards.reduce((a, x) => a + x, 0) / b.n) })),
        bagPerRun: r1(bag / RUNS),
      });
    }
}

console.log(JSON.stringify({ mode: MODE, policy: POLICY, botGear: BOT_GEAR, carryHalf: CARRY_HALF, runs: RUNS, seed0: SEED0, patch: env.PATCH ?? null, stageMult: EXPEDITION.stageMult, waves: EXPEDITION.waves, cells }, null, 1));
