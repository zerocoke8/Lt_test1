// Headless drag-skill bench over the real sim (no rendering): how much each of the 12 drag skills is worth, and how
// much aiming by position matters for it.
// Run: npx vite-node tests/playtest/drag-bench.ts            (env: BENCH_SEEDS=6 BENCH_FLOORS=5 BENCH_CHARS=blade,mage)
//
// Player 0 = a human-like player whose party is the SAME character 3 times (so every point of player-0 damage belongs
// to that character), swapping every 4 s when a card is ready, ult 0.5 s after full, no pets. Players 1–2 = the stock
// bots. Executed aim policies:
//   best     — bot aim (R29: real footprint, the whole visible screen) = a perfect aimer
//   designer — cluster centre + the offset a designer reads off the card (start LEFT of the pack for → shapes, etc.)
//   naive    — finger right on the densest cluster (what a new player does)
// At every drop all 4 candidate drops (best / designer / naive / self = on my own character) are also scored on the
// same tick (enemies inside the footprint, mid ×2, boss ×3) → counterfactual aim value without extra runs.

import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE, VIEW_WIDTH_UNITS } from '../../src/config';
import { CHARACTERS, getCharacter } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { canSwap } from '../../src/sim/players';
import { previewPartsFor } from '../../src/sim/preview';
import { activeEntity, clampToArena, isAlive, type SimEntity, type World } from '../../src/sim/world';
import type { PlayerSetup, PreviewPart, Vec2 } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEEDS = Number(env.BENCH_SEEDS ?? 6);
const FLOORS = Number(env.BENCH_FLOORS ?? 5);
const CHARS = env.BENCH_CHARS ? env.BENCH_CHARS.split(',') : CHARACTERS.map(c => c.id);
const POLICIES = (env.BENCH_POLICIES ?? 'best,designer,naive').split(',') as Policy[];
const SWAP_EVERY = Number(env.BENCH_SWAP_EVERY ?? 4);

type Policy = 'best' | 'designer' | 'naive' | 'self';

const AIM_OFFSET: Record<string, Vec2> = {
  blade: { x: -3, y: 0 },
  berserker: { x: -1.6, y: 0 },
  shadow: { x: -2.2, y: 0 },
  ranger: { x: -2.5, y: 0 },
  gunner: { x: 2, y: 0 },
};

const weight = (e: SimEntity) => (e.tier === 'boss' ? 3 : e.tier === 'mid' ? 2 : 1);

function viewOf(w: World, me: SimEntity | null | undefined): { lo: number; hi: number } {
  const a = w.state.plan.arena;
  const half = VIEW_WIDTH_UNITS / 2;
  const x = me?.pos.x ?? a.width / 2;
  const cx = a.width <= VIEW_WIDTH_UNITS ? a.width / 2 : Math.min(a.width - half, Math.max(half, x));
  return { lo: cx - half, hi: cx + half };
}

function score(parts: PreviewPart[], drop: Vec2, units: SimEntity[], affects: 'enemies' | 'allies'): number {
  let n = 0;
  const seen = new Set<number>();
  for (const p of parts) {
    if (p.affects !== affects) continue;
    const c = { x: drop.x + p.offset.x, y: drop.y + p.offset.y };
    for (const u of units) {
      if (seen.has(u.id)) continue;
      if (hitsArea(p.area, c, drop, u.pos, u.radius)) {
        seen.add(u.id);
        n += affects === 'enemies' ? weight(u) : 1;
      }
    }
  }
  return n;
}

function cluster(units: SimEntity[], healer: boolean): Vec2 | null {
  let best: Vec2 | null = null;
  let bestN = 0;
  for (const f of units) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (const q of units) {
      if (Math.hypot(q.pos.x - f.pos.x, q.pos.y - f.pos.y) > 2.5) continue;
      const wq = healer ? 1 + (1 - q.hp / q.maxHp) * 3 : weight(q);
      n += wq;
      sx += q.pos.x * wq;
      sy += q.pos.y * wq;
    }
    if (n > bestN) {
      bestN = n;
      best = { x: sx / n, y: sy / n };
    }
  }
  return best;
}

interface Acc {
  casts: number;
  dragDmg: number;
  totalDmg: number;
  bySrc: Record<string, number>;
  simSec: number;
  hitsExec: number;
  cf: Record<Policy, number>;
  naiveUnderHalf: number;
  cfN: number;
  floorsCleared: number;
  runs: number;
  wipes: number;
  myDeaths: number;
  floorSec: number[];
  /** Ally characters (any player) inside the ally parts of the executed drop. */
  allyHits: number;
}

const newAcc = (): Acc => ({
  casts: 0,
  dragDmg: 0,
  totalDmg: 0,
  bySrc: {},
  simSec: 0,
  hitsExec: 0,
  cf: { best: 0, designer: 0, naive: 0, self: 0 },
  naiveUnderHalf: 0,
  cfN: 0,
  floorsCleared: 0,
  runs: 0,
  wipes: 0,
  myDeaths: 0,
  floorSec: [],
  allyHits: 0,
});

function runOne(charId: string, policy: Policy, seed: number, acc: Acc): void {
  const human: PlayerSetup = { name: '나', isBot: false, characters: [charId, charId, charId], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
  const players: PlayerSetup[] = [human, ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] }))];
  const { world: w } = createGameWithWorld({ seed, players, tunables: { ...DEFAULT_TUNABLES } });
  const s = w.state;
  const p = s.players[0];
  let lastSwap = -99;
  let ultAt: number | null = null;
  let think = 0;
  let card = 0;
  let floorsDone = 0;
  const maxTicks = TICK_RATE * 60 * 30;
  let deadPrev = p.party.map(m => m.dead);
  for (let t = 0; t < maxTicks; t++) {
    if (s.phase === 'reward') {
      floorsDone++;
      acc.floorSec.push(w.floorTimes[w.floorTimes.length - 1]?.seconds ?? 0);
      if (floorsDone >= FLOORS) break;
      dispatch(w, { type: 'chooseReward', player: 0, offerIndex: 0 });
      lastSwap = -99;
      continue;
    }
    if (s.phase === 'runOver') {
      if (s.runResult?.reason === 'wipe') acc.wipes++;
      break;
    }
    think -= 1 / TICK_RATE;
    if (think <= 0 && s.phase === 'combat' && !p.out) {
      think = 0.25;
      const me = activeEntity(w, p);
      const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
      if (p.ult.charge >= 1 && me && foes.length) {
        if (ultAt == null) ultAt = s.time + 0.5;
        if (s.time >= ultAt && dispatch(w, { type: 'ult', player: 0 }).ok) ultAt = null;
      }
      const ready = [0, 1, 2].filter(i => canSwap(w, 0, i).ok);
      const due = (s.time - lastSwap >= SWAP_EVERY || !me) && (foes.length > 0 || !me);
      if (ready.length && due) {
        const idx = [1, 2, 0].map(k => (card + k) % 3).find(i => ready.includes(i))!;
        const parts = previewPartsFor(s, 0, 'swap', idx);
        const healer = !parts.some(pt => pt.affects === 'enemies');
        const affects = healer ? 'allies' : 'enemies';
        const view = viewOf(w, me);
        const inView = (e: SimEntity) => e.pos.x >= view.lo && e.pos.x <= view.hi;
        const pool = healer ? s.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e)) : foes.filter(inView);
        const c = cluster(pool, healer);
        const selfPos = me ? { ...me.pos } : { x: (view.lo + view.hi) / 2, y: s.plan.arena.height / 2 };
        const off = AIM_OFFSET[charId] ?? { x: 0, y: 0 };
        const clampView = (q: Vec2) => clampToArena(w, { x: Math.min(view.hi, Math.max(view.lo, q.x)), y: q.y });
        const cand: Record<Policy, Vec2> = {
          best: bestDropPoint(w, p, idx),
          naive: clampView(c ?? selfPos),
          designer: clampView(c ? { x: c.x + off.x, y: c.y + off.y } : selfPos),
          self: clampView(selfPos),
        };
        const sc = {} as Record<Policy, number>;
        for (const k of Object.keys(cand) as Policy[]) sc[k] = score(parts, cand[k], pool, affects);
        if (pool.length) {
          acc.cfN++;
          for (const k of Object.keys(cand) as Policy[]) acc.cf[k] += sc[k];
          if (sc.best > 0 && sc.naive < sc.best / 2) acc.naiveUnderHalf++;
        }
        if (dispatch(w, { type: 'swap', player: 0, partyIndex: idx, pos: cand[policy] }).ok) {
          lastSwap = s.time;
          card = idx;
          acc.casts++;
          acc.hitsExec += sc[policy];
          if (parts.some(pt => pt.affects === 'allies')) {
            const allies = s.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e));
            acc.allyHits += score(parts, cand[policy], allies, 'allies');
          }
        }
      }
    }
    tick(w);
    p.party.forEach((m, i) => {
      if (m.dead && !deadPrev[i]) acc.myDeaths++;
    });
    deadPrev = p.party.map(m => m.dead);
  }
  acc.floorsCleared += floorsDone;
  acc.runs++;
  acc.simSec += s.time;
  acc.dragDmg += p.stats.damageBySource.drag;
  acc.totalDmg += p.stats.damageDealt;
  for (const [k, v] of Object.entries(p.stats.damageBySource)) acc.bySrc[k] = (acc.bySrc[k] ?? 0) + v;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const rows: Record<string, unknown>[] = [];
const cfRows: Record<string, unknown>[] = [];
const t0 = Date.now();
for (const id of CHARS) {
  const def = getCharacter(id);
  for (const pol of POLICIES) {
    const acc = newAcc();
    for (let k = 0; k < SEEDS; k++) runOne(id, pol, 7001 + k * 104729, acc);
    const tot = acc.totalDmg || 1;
    rows.push({
      char: id,
      aim: pol,
      cd: def.swapCooldown,
      casts: acc.casts,
      hitsPerCast: r1(acc.hitsExec / Math.max(1, acc.casts)),
      alliesPerCast: r1(acc.allyHits / Math.max(1, acc.casts)),
      dragPerCast: Math.round(acc.dragDmg / Math.max(1, acc.casts)),
      dragPct: r1((100 * acc.dragDmg) / tot),
      basicPct: r1((100 * (acc.bySrc.basic ?? 0)) / tot),
      normalPct: r1((100 * (acc.bySrc.normal ?? 0)) / tot),
      ultPct: r1((100 * (acc.bySrc.ult ?? 0)) / tot),
      dpm: Math.round(acc.totalDmg / Math.max(1, acc.simSec / 60)),
      floors: r1(acc.floorsCleared / acc.runs),
      wipes: acc.wipes,
      myDeaths: r1(acc.myDeaths / acc.runs),
    });
    if (pol === POLICIES[0]) {
      cfRows.push({
        char: id,
        shape: def.drag.name,
        best: r1(acc.cf.best / Math.max(1, acc.cfN)),
        designer: r1(acc.cf.designer / Math.max(1, acc.cfN)),
        naive: r1(acc.cf.naive / Math.max(1, acc.cfN)),
        self: r1(acc.cf.self / Math.max(1, acc.cfN)),
        naiveUnderHalfPct: r1((100 * acc.naiveUnderHalf) / Math.max(1, acc.cfN)),
        n: acc.cfN,
      });
    }
  }
  console.error(`${id} done ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log('=== executed aim policy → outcome (player 0 = same character ×3, swap every', SWAP_EVERY, 's) ===');
console.table(rows);
console.log('=== counterfactual footprint score at the same decision points (enemies in footprint; mid ×2, boss ×3; cleric = allies) ===');
console.table(cfRows);
console.log(JSON.stringify({ rows, cfRows }));
