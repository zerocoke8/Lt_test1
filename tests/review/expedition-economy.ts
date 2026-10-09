// 기획 15차 원정 경제 bench (docs/expedition.md 11-1 진행 속도): a pure Monte Carlo of one solo player's progression,
// no combat sim. Stage clears use the rates the combat bench measured (tests/review/expedition-bench.ts MODE=chain: a run
// started at stage s in T(s − 1) commons with 2 bots, carrying its floor rewards on), stage times its stage-mode medians;
// loot is the real rollStageLoot and the stash the real one (src/expedition/stash.ts, 자동 장착 after every extraction).
// Run: npx vite-node tests/review/expedition-economy.ts
//
//   PLAYERS=400 SEED0=7    simulated players per policy
//   HOURS=15               stop a player after this much play
//   OVERHEAD=60            seconds outside combat per stage (reward picks, banners, room, choice, matching)
//   CHAIN=dir              read chain_<s>.json (expedition-bench MODE=chain STAGES=s) and stage times from d0_*.json
//                          in dir instead of the tables below
//
// Policies (start at the highest stage the gear allows unless named otherwise):
//   boss    = 「다음 보스까지 가고 나감」: continue until a boss stage (3·6·9·12) is cleared, then extract
//   k1..k3  = extract after k stages cleared (k1 = 「단계마다 바로 나감」)
//   greedy  = continue until a failure or stage 12
//   from1   = always start at stage 1 and go as far as possible (never extract before 12)
// A failure loses the bag. The clear rate of a stage depends on where the run started (the carry and the bots' gear grow
// with the stage, the player's own gear does not); a player whose gear is above the start rule's minimum is treated as
// exactly at it (conservative). Output per policy: hours (median / p25 / p75) until the 9 base slots are all ≥ T3 / T6 /
// T9 / T11 / T12, runs (extractions + losses) to T11, relics owned at 5 h, share of runs lost, stage 12 first cleared.

import fs from 'node:fs';
import { EXPEDITION_STAGES, isBossStage } from '../../src/data/stages';
import { addItems, autoEquip, discard, emptyStash, freeItems, isFirstBossClear, loadoutsFor, recordBossClear, type StashData } from '../../src/expedition/stash';
import { BASE_SLOTS, type GearLoadout, type GearSpec } from '../../src/data/gear';
import { rollStageLoot } from '../../src/sim/expedition';
import { Rng, mixSeed } from '../../src/sim/rng';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const PLAYERS = Number(env.PLAYERS ?? 400);
const SEED0 = Number(env.SEED0 ?? 7);
const HOURS = Number(env.HOURS ?? 15);
const OVERHEAD = Number(env.OVERHEAD ?? 60);
const PARTY = ['blade', 'mage', 'cleric'];

/**
 * CHAIN[s − 1][k] = clear % of stage s + k in a run started at stage s (T(s − 1), 직접 교체 + 2 bots, 240 runs each;
 * balance.md 15장). Cells with fewer than 20 runs reaching them fall back to the last measured one.
 */
const CHAIN: (number | null)[][] = [
  [100, 98.3, 88.1, 88, 89.6, 82.9, 92.6, 83.3, 82.9, 92, 90, 87.5],
  [98.8, 86.1, 93.1, 91.1, 86.1, 91.9, 89.8, 82.9, 94.1, 91.7, 76.1],
  [89.6, 87.9, 89.9, 85.9, 89, 90, 82.1, 94.8, 93.4, 74.1],
  [92.9, 91.5, 81.4, 89.2, 87.2, 76.7, 89.9, 91, 70.4],
  [86.3, 81.2, 92.9, 86.5, 80.7, 90.8, 89.9, 73],
  [81.7, 90.3, 84.7, 77.3, 84.5, 90.8, 76.4],
  [89.2, 89.7, 78.1, 90.7, 91.9, 76.8],
  [84.2, 76.7, 85.8, 86.5, 67],
  [75, 86.1, 87.1, 62.2],
  [88.8, 87.8, 64.2],
  [84.6, 69],
  [59.2],
];
/** Combat median seconds of each stage (stage mode, Δ = 0, 480 runs). */
const COMBAT_S = [178, 206.2, 253, 221.3, 225, 263.1, 254.2, 259.5, 276.4, 258, 247.5, 261.7];

function readJson(p: string): { cells: Record<string, unknown>[] } {
  const txt = fs.readFileSync(p, 'utf8');
  return JSON.parse(txt.slice(txt.indexOf('{')));
}

/** CHAIN=dir: chain_<s>.json and d0_*.json written by expedition-bench.ts. */
function loadDir(dir: string): void {
  for (let s = 1; s <= EXPEDITION_STAGES; s++) {
    const p = `${dir}/chain_${s}.json`;
    if (!fs.existsSync(p)) continue;
    const cell = readJson(p).cells[0] as { perStage: { n: number; clearPct: number }[] };
    CHAIN[s - 1] = cell.perStage.map(x => (x.n >= 20 ? x.clearPct : null));
  }
  for (const f of fs.readdirSync(dir).filter(x => /^d0_.*\.json$/.test(x))) {
    for (const c of readJson(`${dir}/${f}`).cells as { stage: number; combatMedS: number | null }[]) if (c.combatMedS != null) COMBAT_S[c.stage - 1] = c.combatMedS;
  }
}
if (env.CHAIN) loadDir(env.CHAIN);

/** Clear probability of `stage` in a run started at `start`. */
export function chainProb(start: number, stage: number): number {
  const row = CHAIN[start - 1];
  for (let k = stage - start; k >= 0; k--) if (row[k] != null) return row[k]! / 100;
  return 0.5;
}

const minTier = (party: GearLoadout[]) => Math.min(...party.flatMap(l => BASE_SLOTS.map(s => l[s]?.tier ?? 0)));

/** Keep the stash small: free items not better than what the party already wears in that slot go. */
function prune(s: StashData, party: GearLoadout[]): void {
  for (const it of freeItems(s)) {
    if (it.slot === 'relic') continue;
    const worst = Math.min(...party.map(l => l[it.slot]?.tier ?? 0));
    if (it.tier <= worst) discard(s, it.uid);
  }
}

type Policy = 'boss' | 'k1' | 'k2' | 'k3' | 'greedy' | 'from1';
const POLICIES: Policy[] = ['boss', 'k1', 'k2', 'k3', 'greedy', 'from1'];
const MILESTONES = [3, 6, 9, 11, 12];

function stopAfter(policy: Policy, stage: number, cleared: number): boolean {
  if (stage >= EXPEDITION_STAGES) return true;
  if (policy === 'boss') return isBossStage(stage);
  if (policy === 'greedy' || policy === 'from1') return false;
  return cleared >= Number(policy.slice(1));
}

interface PlayerRec {
  /** Hours until min base tier ≥ each milestone (Infinity = not within HOURS). */
  at: number[];
  runsTo11: number;
  relicsAt5h: number;
  runs: number;
  lostRuns: number;
  firstStage12: number;
}

const stageHours = (stage: number, cleared: boolean) => ((cleared ? COMBAT_S[stage - 1] : COMBAT_S[stage - 1] * 0.6) + OVERHEAD) / 3600;

function simulate(policy: Policy, k: number): PlayerRec {
  const rng = new Rng(mixSeed(SEED0, k, POLICIES.indexOf(policy)));
  const s = emptyStash();
  const rec: PlayerRec = { at: MILESTONES.map(() => Infinity), runsTo11: Infinity, relicsAt5h: 0, runs: 0, lostRuns: 0, firstStage12: Infinity };
  const relics = () => s.items.filter(x => x.slot === 'relic').length;
  let hours = 0;
  while (hours < HOURS) {
    const party = loadoutsFor(s, PARTY);
    const low = minTier(party);
    MILESTONES.forEach((m, i) => {
      if (low >= m && rec.at[i] === Infinity) rec.at[i] = hours;
    });
    if (low >= 11 && rec.runsTo11 === Infinity) rec.runsTo11 = rec.runs;
    if (low >= 12) break;
    const start = policy === 'from1' ? 1 : Math.min(EXPEDITION_STAGES, low + 1);
    const bag: GearSpec[] = [];
    let stage = start;
    let cleared = 0;
    rec.runs++;
    for (;;) {
      const ok = rng.chance(chainProb(start, stage));
      const before = hours;
      hours += stageHours(stage, ok);
      if (before < 5 && hours >= 5) rec.relicsAt5h = relics();
      if (!ok) {
        rec.lostRuns++;
        bag.length = 0;
        break;
      }
      if (stage === EXPEDITION_STAGES) rec.firstStage12 = Math.min(rec.firstStage12, hours);
      bag.push(...rollStageLoot(rng.int(0, 2 ** 31 - 1), stage, 0, party, isFirstBossClear(s, stage), cleared));
      recordBossClear(s, stage);
      cleared++;
      if (stopAfter(policy, stage, cleared)) break;
      stage++;
    }
    if (bag.length) {
      addItems(s, bag, stage);
      autoEquip(s, PARTY);
      prune(s, loadoutsFor(s, PARTY));
    }
  }
  if (hours < 5) rec.relicsAt5h = relics();
  return rec;
}

function pctl(xs: number[], q: number): number {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const h2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

const out: Record<string, unknown> = {};
for (const policy of POLICIES) {
  const recs = Array.from({ length: PLAYERS }, (_, k) => simulate(policy, k));
  const q = (xs: number[]) => ({ med: h2(pctl(xs, 0.5)), p25: h2(pctl(xs, 0.25)), p75: h2(pctl(xs, 0.75)) });
  out[policy] = {
    hoursToTier: Object.fromEntries(MILESTONES.map((m, i) => [`T${m}`, q(recs.map(r => r.at[i]))])),
    runsToT11: h2(pctl(recs.map(r => r.runsTo11), 0.5)),
    firstStage12ClearH: h2(pctl(recs.map(r => r.firstStage12), 0.5)),
    relicsAt5h: h2(recs.reduce((a, r) => a + r.relicsAt5h, 0) / PLAYERS),
    lostRunPct: h2((100 * recs.reduce((a, r) => a + r.lostRuns, 0)) / Math.max(1, recs.reduce((a, r) => a + r.runs, 0))),
  };
}
console.log(JSON.stringify({ players: PLAYERS, hours: HOURS, overheadS: OVERHEAD, policies: out }, null, 1));
