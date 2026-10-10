// 기획 17차 밸런스: what one floor reward is worth when it is picked at a typical floor (docs/balance.md 17장).
// Run: npx vite-node tests/review/reward-bench.ts   (all knobs via env, output = one JSON object on stdout)
//
//   SEEDS=48 SEED0=5000    matched seeds; seed k plays floor FLOORS[k % n] with party COMPS[k % 4] for player 0
//   FLOORS=11-20           the floor each seed plays (one floor per run; boss floors 15 / 20 included)
//   IDS=all | atk_rare,bolt_common   rewards to test (economy cards are skipped: they change offers, not fights)
//   SETS=1                 instead: the 13 tag set bonuses (3 cards of the tag, bonus on vs the TAG_BONUS numbers
//                          zeroed) — the bonus value next to one card's
//   PAR=4                  split the ids over n child processes (SHARD=i/n, RAW_OUT=file) and merge
//   TUN='{"botJustChance":0}'  tunables override
//
// Each run: the game starts on the floor with the floors before it picked by botPickIndex for every seat (a typical
// build), then player 0 gets the tested reward (its default member) on top and the floor is played to its end by the
// sim's bots (all 3 seats). Baseline = the same seeds without the extra reward.
// Per reward: Δ output = player 0's share of the team's damage dealt + healing done vs the baseline (ratio of the
// sums; the raw Δ is dRaw), Δ deaths = player 0's
// character deaths per floor, clear %, Δ floor time, reward ('relic') damage share of player 0, and the value index
//   V = Δ output % + K × (−Δ deaths per floor),
// K chosen so the survive basics (체력 강화, 방어 태세) average the attack basics (공격력, 공격 속도) — the 16차 design
// treats the basic 12 at one rarity as equal. Outliers: top / bottom 10 % of V within each rarity.

import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE } from '../../src/config';
import { FAMILIES, REWARDS, TAG_BONUS, getFamily, getReward, rewardFamily } from '../../src/data';
import { createGameWithWorld, tick } from '../../src/sim/game';
import { applyOffer, botPickIndex, defaultMember, grantReward, requiresOk, rollOffers } from '../../src/sim/rewards';
import type { PlayerSetup, Rarity, SynergyTag, Tunables } from '../../src/types';
import { REWARD_CATEGORY } from './reward-cats';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(env.SEEDS ?? 48);
const SEED0 = Number(env.SEED0 ?? 5000);
const FLOORS = parseRange(env.FLOORS ?? '11-20');
const SETS = env.SETS === '1';
const PAR = Math.max(1, Number(env.PAR ?? 1));
const SHARD = env.SHARD ? env.SHARD.split('/').map(Number) : null;
const TUN: Partial<Tunables> = env.TUN ? JSON.parse(env.TUN) : {};

function parseRange(s: string): number[] {
  if (s.includes('-')) {
    const [a, b] = s.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return s.split(',').map(Number);
}

/** Player 0's parties (the roles every 'requires' needs show up in at least one). */
const COMPS = [
  ['blade', 'mage', 'cleric'],
  ['guardian', 'gunner', 'bard'],
  ['berserker', 'ranger', 'medic'],
  ['ranger', 'mage', 'chrono'],
];
const PETS = [['frog_bomb', 'fairy_heal', 'cat_void'], [...BOT_PRESETS[0].pets], [...BOT_PRESETS[1].pets]];

/** Not measurable in one fight (they change the next reward screens). */
const SKIP = new Set(['box_in_box', 'debt', 'greedy', 'incense']);

interface Row {
  seed: number;
  ok: boolean;
  out: number;
  /** The other two seats' output (damage + healing): player 0's share removes most of the floor-to-floor noise. */
  team: number;
  relic: number;
  deaths: number;
  sec: number;
  eligible: boolean;
}
type Grant = { ids: string[]; zeroTag?: SynergyTag };

function seedOf(k: number): number {
  return SEED0 + k * 7919;
}

function runOne(k: number, grant: Grant): Row {
  const floor = FLOORS[k % FLOORS.length];
  const players: PlayerSetup[] = [COMPS[k % COMPS.length], [...BOT_PRESETS[0].characters], [...BOT_PRESETS[1].characters]].map((chars, i) => ({
    name: i === 0 ? '나' : `P${i}`,
    isBot: true,
    characters: [...chars],
    pets: [...PETS[i]],
  }));
  const tunables: Tunables = { ...DEFAULT_TUNABLES, fieldEventChance: 0, ...TUN };
  const { game, world: w } = createGameWithWorld({ seed: seedOf(k), players, tunables, startFloor: floor });
  const s = w.state;
  for (let f = 1; f < floor; f++) {
    for (const p of s.players) {
      const offers = rollOffers(w, p, f % 5 === 0);
      if (offers.length) applyOffer(w, p, offers[Math.max(0, botPickIndex(p, offers))]);
    }
  }
  const p0 = s.players[0];
  let eligible = true;
  for (const id of grant.ids) {
    const def = getReward(id);
    if (!requiresOk(s, p0, getFamily(def.family))) eligible = false;
    const bound = def.target === 'member' || def.target === 'role';
    grantReward(w, p0, id, bound ? defaultMember(p0, def.prefRoles) : null);
  }
  const saved = grant.zeroTag ? zeroTag(grant.zeroTag) : null;
  game.drainEvents();
  const mine = new Set(p0.party.map(m => m.entityId));
  let deaths = 0;
  const start = s.floor;
  let ok = false;
  for (let t = 0; t < TICK_RATE * 60 * 10; t++) {
    tick(w);
    for (const ev of game.drainEvents()) if (ev.type === 'death' && mine.has(ev.entityId)) deaths++;
    for (const m of p0.party) mine.add(m.entityId);
    if (s.phase === 'runOver') {
      ok = s.runResult?.outcome === 'victory';
      break;
    }
    if (s.phase !== 'combat' || s.floor !== start) {
      ok = true;
      break;
    }
  }
  if (saved) saved();
  const sec = w.floorTimes.find(f => f.floor === start)?.seconds ?? s.floorTime;
  const outOf = (i: number) => s.players[i].stats.damageDealt + s.players[i].stats.healing;
  return { seed: k, ok, out: outOf(0), team: outOf(1) + outOf(2), relic: p0.stats.damageBySource.relic ?? 0, deaths, sec, eligible };
}

/** SETS=1: switch one tag's set bonus off (numbers → neutral) for one run; returns the undo. */
function zeroTag(tag: SynergyTag): () => void {
  const o = TAG_BONUS[tag] as unknown as Record<string, number>;
  const keep = { ...o };
  for (const key of Object.keys(o)) if (!(tag === 'coop' && key === 'range')) o[key] = tag === 'curse' ? 1 : 0;
  return () => Object.assign(o, keep);
}

// ─────────────────────────── jobs ───────────────────────────

interface Job {
  key: string;
  grant: Grant;
}

function rewardJobs(): Job[] {
  const want = env.IDS && env.IDS !== 'all' ? new Set(env.IDS.split(',')) : null;
  const ids = REWARDS.map(r => r.id).filter(id => !SKIP.has(rewardFamily(id)) && (!want || want.has(id) || want.has(rewardFamily(id))));
  return [{ key: 'base', grant: { ids: [] } }, ...ids.map(id => ({ key: id, grant: { ids: [id] } }))];
}

/** Three non-legendary cards of the tag (lowest rarity of each family), for the set-bonus runs. */
function setJobs(): Job[] {
  const tags: SynergyTag[] = ['appear', 'leave', 'swap', 'just', 'ult', 'pet', 'status', 'boss', 'survive', 'attack', 'curse', 'coop', 'growth'];
  const jobs: Job[] = [{ key: 'base', grant: { ids: [] } }];
  for (const tag of tags) {
    const fams = FAMILIES.filter(f => f.tags.includes(tag) && !SKIP.has(f.key) && !f.unique && !f.requires && f.key !== 'role').slice(0, 3);
    const ids = fams.map(f => `${f.key}_${(['rare', 'common', 'epic'] as Rarity[]).find(r => f.params[r])}`);
    while (ids.length < 3) ids.push(ids[ids.length - 1]);
    jobs.push({ key: `${tag}:on`, grant: { ids } }, { key: `${tag}:off`, grant: { ids, zeroTag: tag } });
  }
  return jobs;
}

const JOBS = SETS ? setJobs() : rewardJobs();

async function runAll(): Promise<Record<string, Row[]>> {
  const mineJobs = SHARD ? JOBS.filter((_, i) => i % SHARD[1] === SHARD[0] || JOBS[i].key === 'base') : JOBS;
  if (SHARD || PAR <= 1) {
    const out: Record<string, Row[]> = {};
    for (const j of mineJobs) out[j.key] = Array.from({ length: SEEDS }, (_, k) => runOne(k, j.grant));
    return out;
  }
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbench-'));
  const files = Array.from({ length: PAR }, (_, i) => path.join(dir, `shard${i}.json`));
  await Promise.all(
    files.map(
      (f, i) =>
        new Promise<void>((res, rej) => {
          const ch = spawn('npx', ['vite-node', 'tests/review/reward-bench.ts'], { env: { ...env, SHARD: `${i}/${PAR}`, RAW_OUT: f, PAR: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
          ch.on('exit', code => (code === 0 ? res() : rej(new Error(`shard ${i} exit ${code}`))));
        }),
    ),
  );
  const out: Record<string, Row[]> = {};
  for (const f of files) Object.assign(out, JSON.parse(fs.readFileSync(f, 'utf8')));
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

const rows = await runAll();
if (SHARD) {
  fs.writeFileSync(env.RAW_OUT!, JSON.stringify(rows));
  (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(0);
}

// ─────────────────────────── report ───────────────────────────

const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const base = rows.base;

interface Stat {
  n: number;
  /** Δ of player 0's share of the team output (relative %, matched seeds). */
  dOut: number;
  /** Δ of player 0's own output (relative %). */
  dRaw: number;
  dDeaths: number;
  clear: number;
  dSec: number;
  relicPct: number;
}
/** Matched-seed deltas vs the baseline (only seeds where the reward can work, e.g. its role is in the party). */
function stat(rs: Row[]): Stat {
  const keep = rs.filter(r => r.eligible);
  const b = keep.map(r => base[r.seed]);
  const sum = (xs: Row[], f: (r: Row) => number) => xs.reduce((a, r) => a + f(r), 0);
  const n = keep.length;
  return {
    n,
    dOut: ((sum(keep, r => r.out) / Math.max(1, sum(keep, r => r.team))) / (sum(b, r => r.out) / Math.max(1, sum(b, r => r.team))) - 1) * 100,
    dRaw: (sum(keep, r => r.out) / Math.max(1, sum(b, r => r.out)) - 1) * 100,
    dDeaths: (sum(keep, r => r.deaths) - sum(b, r => r.deaths)) / Math.max(1, n),
    clear: (keep.filter(r => r.ok).length / Math.max(1, n)) * 100,
    dSec: (sum(keep, r => r.sec) / Math.max(1, sum(b, r => r.sec)) - 1) * 100,
    relicPct: (sum(keep, r => r.relic) / Math.max(1, sum(keep, r => r.out))) * 100,
  };
}

const stats: Record<string, Stat> = Object.fromEntries(Object.entries(rows).map(([k, rs]) => [k, stat(rs)]));
const baseClear = stats.base.clear;

if (SETS) {
  const out = Object.fromEntries(
    Object.keys(TAG_BONUS).map(tag => {
      const on = stats[`${tag}:on`];
      const off = stats[`${tag}:off`];
      return [tag, { on: { dOut: r1(on.dOut), dDeaths: r2(on.dDeaths) }, bonus: { dOut: r1(on.dOut - off.dOut), dDeaths: r2(on.dDeaths - off.dDeaths), clear: r1(on.clear - off.clear) } }];
    }),
  );
  console.log(JSON.stringify({ cfg: { SEEDS, SEED0, FLOORS, TUN }, base: { clear: r1(baseClear) }, sets: out }, null, 1));
} else {
  // K: survive basics (hp, def) average the attack basics (atk, aspd), over all rarities
  const ids = (fams: string[]) => Object.keys(stats).filter(k => k !== 'base' && fams.includes(rewardFamily(k)));
  const mean = (ks: string[], f: (s: Stat) => number) => ks.reduce((a, k) => a + f(stats[k]), 0) / Math.max(1, ks.length);
  const atkIds = ids(['atk', 'aspd']);
  const surIds = ids(['hp', 'def']);
  const gapOut = mean(atkIds, s => s.dOut) - mean(surIds, s => s.dOut);
  const gapDeaths = mean(atkIds, s => -s.dDeaths) - mean(surIds, s => -s.dDeaths);
  const K = gapDeaths < -1e-6 ? Math.min(400, gapOut / -gapDeaths) : 100;
  const value = (s: Stat) => s.dOut + K * -s.dDeaths;
  const table = Object.entries(stats)
    .filter(([k]) => k !== 'base')
    .map(([k, s]) => {
      const def = getReward(k);
      return { id: k, cat: REWARD_CATEGORY[def.family], rarity: def.rarity, n: s.n, V: value(s), dOut: s.dOut, dRaw: s.dRaw, dDeaths: s.dDeaths, clear: s.clear - baseClear, dSec: s.dSec, relicPct: s.relicPct };
    });
  const byRarity: Record<string, unknown> = {};
  for (const rar of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
    const rs = table.filter(t => t.rarity === rar).sort((a, b) => b.V - a.V);
    if (!rs.length) continue;
    const cut = Math.max(1, Math.round(rs.length * 0.1));
    const vs = rs.map(r => r.V);
    byRarity[rar] = {
      n: rs.length,
      medianV: r1(vs[Math.floor(vs.length / 2)]),
      meanV: r1(vs.reduce((a, b) => a + b, 0) / vs.length),
      top: rs.slice(0, cut).map(r => `${r.id} ${r1(r.V)}`),
      bottom: rs.slice(-cut).map(r => `${r.id} ${r1(r.V)}`),
    };
  }
  const fmt = (t: (typeof table)[number]) => ({ ...t, V: r1(t.V), dOut: r1(t.dOut), dRaw: r1(t.dRaw), dDeaths: r2(t.dDeaths), clear: r1(t.clear), dSec: r1(t.dSec), relicPct: r1(t.relicPct) });
  console.log(
    JSON.stringify(
      {
        cfg: { SEEDS, SEED0, FLOORS, TUN },
        base: { clear: r1(baseClear), outPerFloor: r1(base.reduce((a, r) => a + r.out, 0) / base.length), deathsPerFloor: r2(base.reduce((a, r) => a + r.deaths, 0) / base.length) },
        K: r1(K),
        byRarity,
        table: table.sort((a, b) => a.rarity.localeCompare(b.rarity) || b.V - a.V).map(fmt),
      },
      null,
      1,
    ),
  );
}
