// Headless balance sweep over the real sim (no rendering). Run: npx vite-node tests/playtest/balance.ts [runs=20] [floors=6] [policy]
// 기획 8차 (20층): `npx vite-node tests/playtest/balance.ts 40 20` → per floor + `<policy>_runs` (victories, where runs end).
// Player 0 policies:
//   idle   — never swaps/pets/ults (AFK lower bound)
//   bot    — player 0 driven by the same bot AI as the 2 bots (swaps every 20–30 s)
//   active — human-like: swap every ~4 s to the best drag-skill spot, pets on clusters, ult 0.5 s after full
// Reports per floor: clear time, timeouts, my character deaths, player outs, boss enrage/retreat timing.
// 기획 10차: GOEDAM=off|leave|random|first|greedy|forced:<room>:<opt> (env, default leave) — the human's 괴담 room policy
// (tests/playtest/goedam-policy.ts); `<policy>_goedam` = room report. START > 1 forces off.
// 기획 12차: FIELD_EVENTS=off|on (env, default off = the old numbers) — 돌발 괴담 at tunables.fieldEventChance (0.6).
// The event report (per event success, seconds, cost) is in tests/review/critic-20f.ts (same seeds, same 'active').

import { BOT_PRESETS, DEFAULT_TUNABLES, LATE_STAT_GROWTH, TICK_RATE } from '../../src/config';
import { BOSSES, MONSTERS, getPet } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { WAVE_SIZE, WAVES } from '../../src/sim/constants';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { canSwap, canUsePet } from '../../src/sim/players';
import { applyOffer, rollOffers } from '../../src/sim/rewards';
import { activeEntity, clampToArena, dist, isAlive, type SimEntity, type World } from '../../src/sim/world';
import type { PlayerSetup, SimPhase, Tunables, Vec2 } from '../../src/types';
import { goedamPilot, goedamRunRec, goedamSummary, goedamTunables, parseGoedamPolicy, type GoedamRunRec } from './goedam-policy';

type Policy = 'idle' | 'bot' | 'active';

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
const RUNS = Number(argv[2] ?? 20);
const FLOORS = Number(argv[3] ?? 6);
const ONLY = argv[4] as Policy | undefined;
const OVERRIDES: Partial<Tunables> = argv[5] ? JSON.parse(argv[5]) : {};
/** Simulated data edits (what a src/data change would do): {normalHp, normalAtk, midHp, midAtk, bossHp, bossAtk} multipliers. */
const DATA: Record<string, number> = argv[6] ? JSON.parse(argv[6]) : {};
for (const m of MONSTERS) {
  if (m.tier === 'normal') {
    m.stats.maxHp *= DATA.normalHp ?? 1;
    m.stats.atk *= DATA.normalAtk ?? 1;
  } else if (m.tier === 'mid') {
    m.stats.maxHp *= DATA.midHp ?? 1;
    m.stats.atk *= DATA.midAtk ?? 1;
  }
}
for (const b of BOSSES) {
  b.stats.maxHp *= DATA.bossHp ?? 1;
  b.stats.atk *= DATA.bossAtk ?? 1;
}
/** Simulated src/config.ts edits (FLOOR_WAVES / WAVE_SIZE): {wavesFirst, wavesPerFloor, wavesMax, waveMin, waveMax}. */
const CONSTS: Record<string, number> = argv[7] ? JSON.parse(argv[7]) : {};
const W = WAVES as { first: number; perFloor: number; max: number };
const WS = WAVE_SIZE as { min: number; max: number };
if (CONSTS.wavesFirst) W.first = CONSTS.wavesFirst;
if (CONSTS.wavesPerFloor) W.perFloor = CONSTS.wavesPerFloor;
if (CONSTS.wavesMax) W.max = CONSTS.wavesMax;
if (CONSTS.waveMin) WS.min = CONSTS.waveMin;
if (CONSTS.waveMax) WS.max = CONSTS.waveMax;
if (CONSTS.lateFactor != null) LATE_STAT_GROWTH.factor = CONSTS.lateFactor;
if (CONSTS.lateFrom != null) LATE_STAT_GROWTH.from = CONSTS.lateFrom;
/** Simulated per-monster edits: {"<id>": {"hp": mult, "atk": mult}} (argv[8]). */
const PER: Record<string, { hp?: number; atk?: number }> = argv[8] ? JSON.parse(argv[8]) : {};
for (const m of [...MONSTERS, ...BOSSES]) {
  const e = PER[m.id];
  if (!e) continue;
  m.stats.maxHp *= e.hp ?? 1;
  m.stats.atk *= e.atk ?? 1;
}
/**
 * START=n (env): every run starts at floor n with the rewards it would have picked on floors 1..n−1 already applied
 * (human: first offer, bots: random — like a real run; relics on boss floors). Tunes a late zone with full samples.
 */
const START = Math.max(1, Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.START ?? 1));
const LAST = START + FLOORS - 1;
/** SEED0=n (env): first seed (default 1000), run k uses SEED0 + k × 7919. */
const SEED0 = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SEED0 ?? 1000);
const GOEDAM = parseGoedamPolicy((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.GOEDAM, START);
const runGoedam: GoedamRunRec[] = [];
const runTele: { drag: number; ult: number; pet: number; basic: number; normal: number; myShare: number; spm: number }[] = [];

const HUMAN: PlayerSetup = { name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };

interface FloorRec {
  floor: number;
  kind: 'normal' | 'boss';
  outcome: 'clear' | 'timeout' | 'wipe' | 'cut';
  seconds: number;
  myDeaths: number;
  allDeaths: number;
  outs: number;
  enragedAt: number | null;
  bossHpAtEnrage: number | null;
  myEmptySec: number;
  /** Seconds with zero enemies alive (waiting for the next wave). */
  idleSec: number;
  mySwaps: number;
  maxAlive: number;
  midSpawnAt: number | null;
  midKilledAt: number | null;
  lastWaveAt: number | null;
}

function enemies(w: World): SimEntity[] {
  return w.state.entities.filter(e => e.team === 'enemy' && isAlive(e));
}

function petTarget(w: World, petIdx: number): Vec2 | null {
  const p = w.state.players[0];
  const def = getPet(p.pets[petIdx].defId);
  const a = def.action;
  const r = a.area.shape === 'circle' ? a.area.radius : 1;
  const foes = enemies(w);
  const mine = activeEntity(w, p);
  if (a.affects === 'enemies' || a.summon) {
    let best: { c: Vec2; n: number } | null = null;
    for (const f of foes) {
      let n = 0;
      for (const q of foes) if (dist(q.pos, f.pos) <= r + q.radius) n += q.tier === 'boss' ? 4 : q.tier === 'mid' ? 2 : 1;
      if (!best || n > best.n) best = { c: f.pos, n };
    }
    return best && best.n >= 3 ? clampToArena(w, best.c) : null;
  }
  const allies = w.state.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e));
  const heals = a.effects.some(e => e.kind === 'heal');
  const hurt = allies.filter(x => x.hp < x.maxHp * (heals ? 0.6 : 0.75));
  if (hurt.length === 0 || foes.length === 0) return null;
  const anchor = mine && hurt.includes(mine) ? mine : hurt[0];
  return clampToArena(w, anchor.pos);
}

function activeThink(w: World, st: { lastSwap: number; ultAt: number | null; react: number | null }): void {
  const s = w.state;
  const p = s.players[0];
  if (p.out || s.phase !== 'combat') return;
  const foes = enemies(w);
  const me = activeEntity(w, p);
  // ult 0.5 s after full
  if (p.ult.charge >= 1 && me && foes.length) {
    if (st.ultAt == null) st.ultAt = s.time + 0.5;
    if (s.time >= st.ultAt && dispatch(w, { type: 'ult', player: 0 }).ok) st.ultAt = null;
  }
  const ready = [0, 1, 2].filter(i => canSwap(w, 0, i).ok);
  if (ready.length) {
    const lowHp = me && me.hp < me.maxHp * 0.35;
    const due = s.time - st.lastSwap >= 4 && foes.length > 0;
    let go = false;
    if (!me) {
      if (st.react == null) st.react = s.time + 0.6;
      go = s.time >= st.react;
    } else go = !!lowHp || due;
    if (go) {
      // prefer the healthiest ready card
      const idx = [...ready].sort((a, b) => p.party[b].hp / p.party[b].maxHp - p.party[a].hp / p.party[a].maxHp)[0];
      if (dispatch(w, { type: 'swap', player: 0, partyIndex: idx, pos: bestDropPoint(w, p, idx) }).ok) {
        st.lastSwap = s.time;
        st.react = null;
      }
    }
  }
  for (let i = 0; i < p.pets.length; i++) {
    if (!canUsePet(w, 0, i).ok) continue;
    const pos = petTarget(w, i);
    if (pos && dispatch(w, { type: 'pet', player: 0, petIndex: i, pos }).ok) break;
  }
}

function teleOf(w: World): void {
  const p0 = w.state.players[0].stats;
  const tot = w.state.players.reduce((a, p) => a + p.stats.damageDealt, 0);
  const by = p0.damageBySource;
  const mine = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  runTele.push({
    drag: by.drag / mine, ult: by.ult / mine, pet: by.pet / mine, basic: by.basic / mine, normal: by.normal / mine,
    myShare: tot > 0 ? p0.damageDealt / tot : 0,
    spm: w.state.time > 0 ? p0.swaps / (w.state.time / 60) : 0,
  });
}

function runOnce(seed: number, policy: Policy, floors: number): FloorRec[] {
  const { recs, w } = runInner(seed, policy, floors);
  teleOf(w);
  const last = recs[recs.length - 1];
  runGoedam.push(goedamRunRec(w, !!last && last.outcome === 'clear' && last.floor >= LAST, last?.floor ?? START));
  return recs;
}

function runInner(seed: number, policy: Policy, floors: number): { recs: FloorRec[]; w: World } {
  const fe: Partial<Tunables> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FIELD_EVENTS === 'on' ? {} : { fieldEventChance: 0 };
  const tunables: Tunables = { ...DEFAULT_TUNABLES, ...fe, ...OVERRIDES, ...goedamTunables(GOEDAM) };
  const players: PlayerSetup[] = [
    { ...HUMAN, isBot: policy === 'bot' },
    ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] })),
  ];
  const { game, world: w } = createGameWithWorld({ seed, players, tunables, startFloor: START });
  const s = w.state;
  for (let f = 1; f < START; f++) {
    for (const p of s.players) {
      const offers = rollOffers(w, p, f % 5 === 0);
      if (offers.length) applyOffer(w, p, p.isBot ? offers[w.rng.int(0, offers.length - 1)] : offers[0]);
    }
  }
  game.drainEvents();
  const humans = s.players.filter(p => !p.isBot).map(p => p.id);
  const pilot = goedamPilot(w, GOEDAM);
  const recs: FloorRec[] = [];
  const st = { lastSwap: -99, ultAt: null as number | null, react: null as number | null };
  let thinkIn = 0;
  const newRec = (): FloorRec => ({
    floor: s.floor, kind: s.plan.kind, outcome: 'cut', seconds: 0, myDeaths: 0, allDeaths: 0, outs: 0, enragedAt: null, bossHpAtEnrage: null,
    myEmptySec: 0, idleSec: 0, mySwaps: s.players[0].stats.swaps, maxAlive: 0, midSpawnAt: null, midKilledAt: null, lastWaveAt: null,
  });
  let rec = newRec();
  const maxTicks = TICK_RATE * 60 * 60;
  for (let t = 0; t < maxTicks; t++) {
    if (s.phase === 'reward') {
      // human picks the first offer (deterministic), then the 괴담 room by policy
      rec.mySwaps = s.players[0].stats.swaps - rec.mySwaps;
      recs.push(rec);
      if (recs.length >= floors) return { recs, w };
      pilot.settle(humans);
      rec = newRec();
      st.lastSwap = -99;
      continue;
    }
    if (s.phase === 'runOver') {
      rec.outcome = s.runResult?.reason === 'timeout' ? 'timeout' : s.runResult?.reason === 'wipe' ? 'wipe' : 'clear';
      rec.seconds = s.floorTime;
      rec.mySwaps = s.players[0].stats.swaps - rec.mySwaps;
      recs.push(rec);
      return { recs, w };
    }
    const floorBefore = s.floor;
    if (policy === 'active') {
      thinkIn -= 1 / TICK_RATE;
      if (thinkIn <= 0) {
        thinkIn = 0.25;
        activeThink(w, st);
      }
    }
    const deadBefore = s.players.map(p => p.party.map(m => m.dead));
    const outBefore = s.players.map(p => p.out);
    const wavesBefore = w.spawner.nextWave;
    tick(w);
    for (const ev of game.drainEvents()) {
      if (ev.type === 'enrage') {
        rec.enragedAt = s.floorTime;
        const b = s.entities.find(e => e.id === s.bossId);
        rec.bossHpAtEnrage = b ? b.hp / b.maxHp : null;
      }
      if (ev.type === 'spawn' && ev.tier === 'mid') rec.midSpawnAt = s.floorTime;
      if (ev.type === 'death' && ev.tier === 'mid') rec.midKilledAt = s.floorTime;
    }
    if (w.spawner.nextWave > wavesBefore) rec.lastWaveAt = s.floorTime;
    if (s.phase === 'combat' && s.floor === floorBefore) {
      s.players.forEach((p, pi) => {
        p.party.forEach((m, i) => {
          if (m.dead && !deadBefore[pi][i]) {
            rec.allDeaths++;
            if (pi === 0) rec.myDeaths++;
          }
        });
        if (p.out && !outBefore[pi]) rec.outs++;
      });
      if (s.players[0].activeIndex == null && !s.players[0].out) rec.myEmptySec += 1 / TICK_RATE;
      rec.maxAlive = Math.max(rec.maxAlive, s.monstersAlive);
      if (s.monstersAlive === 0) rec.idleSec += 1 / TICK_RATE;
      rec.seconds = s.floorTime;
    }
    const phaseAfter = s.phase as SimPhase; // tick() mutates it; TS narrowed it from the loop-top checks
    if (phaseAfter === 'reward' || phaseAfter === 'runOver') {
      const ft = w.floorTimes[w.floorTimes.length - 1];
      if (ft && ft.floor === rec.floor) {
        rec.outcome = 'clear';
        rec.seconds = ft.seconds;
      }
    } else if (s.floor !== floorBefore) {
      // nobody human to pick a reward (all bots): the sim went straight to the next floor
      const ft = w.floorTimes[w.floorTimes.length - 1];
      rec.outcome = 'clear';
      rec.seconds = ft?.seconds ?? rec.seconds;
      rec.mySwaps = s.players[0].stats.swaps - rec.mySwaps;
      recs.push(rec);
      if (recs.length >= floors) return { recs, w };
      rec = newRec();
      st.lastSwap = -99;
    }
  }
  recs.push(rec);
  return { recs, w };
}

function pctl(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

const policies: Policy[] = ONLY ? [ONLY] : ['idle', 'bot', 'active'];
const out: Record<string, unknown> = { runs: RUNS, start: START, seed0: SEED0, goedam: GOEDAM.name, overrides: OVERRIDES, data: DATA, consts: CONSTS };
for (const pol of policies) {
  const all: FloorRec[][] = [];
  for (let k = 0; k < RUNS; k++) all.push(runOnce(SEED0 + k * 7919, pol, FLOORS));
  const summary: unknown[] = [];
  for (let f = START; f <= LAST; f++) {
    const recs = all.map(r => r.find(x => x.floor === f)).filter((x): x is FloorRec => !!x);
    if (!recs.length) continue;
    const clears = recs.filter(r => r.outcome === 'clear');
    const secs = clears.map(r => r.seconds);
    summary.push({
      floor: f,
      kind: recs[0].kind,
      reached: recs.length,
      cleared: clears.length,
      timeouts: recs.filter(r => r.outcome === 'timeout').length,
      wipes: recs.filter(r => r.outcome === 'wipe').length,
      clearSec: { p10: r1(pctl(secs, 0.1)), med: r1(pctl(secs, 0.5)), p90: r1(pctl(secs, 0.9)), max: r1(Math.max(...secs)) },
      myDeathsAvg: r1(recs.reduce((a, r) => a + r.myDeaths, 0) / recs.length),
      allDeathsAvg: r1(recs.reduce((a, r) => a + r.allDeaths, 0) / recs.length),
      outsTotal: recs.reduce((a, r) => a + r.outs, 0),
      myEmptyAvg: r1(recs.reduce((a, r) => a + r.myEmptySec, 0) / recs.length),
      idleAvg: r1(recs.reduce((a, r) => a + r.idleSec, 0) / recs.length),
      mySwapsAvg: r1(recs.reduce((a, r) => a + r.mySwaps, 0) / recs.length),
      maxAliveMed: pctl(recs.map(r => r.maxAlive), 0.5),
      midSpawnMed: r1(pctl(recs.map(r => r.midSpawnAt ?? NaN).filter(Number.isFinite), 0.5)),
      midKillMed: r1(pctl(recs.map(r => r.midKilledAt ?? NaN).filter(Number.isFinite), 0.5)),
      lastWaveMed: r1(pctl(recs.map(r => r.lastWaveAt ?? NaN).filter(Number.isFinite), 0.5)),
      enraged: recs.filter(r => r.enragedAt != null).length,
      bossHpAtEnrageMed: r1(pctl(recs.map(r => (r.bossHpAtEnrage ?? NaN) * 100).filter(Number.isFinite), 0.5)),
      clearedAfterEnrage: clears.filter(r => r.enragedAt != null).length,
    });
  }
  out[pol] = summary;
  // run-level: how far runs get, where and how they end (기획 8차: 20-floor curve)
  const ends: Record<string, number> = {};
  let victories = 0;
  for (const r of all) {
    const last = r[r.length - 1];
    if (!last) continue;
    if (last.outcome === 'clear' && last.floor >= LAST) victories++;
    else ends[`${last.floor}:${last.outcome}`] = (ends[`${last.floor}:${last.outcome}`] ?? 0) + 1;
  }
  out[`${pol}_runs`] = {
    victories,
    reachedFloorMed: pctl(all.map(r => r[r.length - 1]?.floor ?? 0), 0.5),
    ends: Object.fromEntries(Object.entries(ends).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))),
  };
  const avg = (k: keyof (typeof runTele)[number]) => r1((runTele.reduce((a, t) => a + t[k], 0) / Math.max(1, runTele.length)) * (k === 'spm' ? 1 : 100));
  out[`${pol}_tele`] = { dragPct: avg('drag'), ultPct: avg('ult'), petPct: avg('pet'), basicPct: avg('basic'), normalPct: avg('normal'), myTeamSharePct: avg('myShare'), swapsPerMin: avg('spm') };
  runTele.length = 0;
  out[`${pol}_goedam`] = goedamSummary(GOEDAM, runGoedam);
  runGoedam.length = 0;
}
console.log(JSON.stringify(out, null, 1));
