// 기획 15차 원정 경제 bench (docs/expedition.md 11-1 진행 속도): a pure Monte Carlo of one solo player's progression,
// no combat sim. Stage clears use the rates the combat bench measured (tests/review/expedition-bench.ts MODE=chain: a run
// started at stage s in T(s − 1) commons with 2 bots, carrying its floor rewards on), stage times its stage-mode medians;
// loot is the real rollStageLoot (its counts = EXPEDITION.lootNormal / lootBossBase + the boss box) and the stash the
// real one (src/expedition/stash.ts, 자동 장착 after every claim). 기획 16차: a stage is one floor; every stage ends in
// the lobby, where the policy claims (「수령」) or matches the next stage.
// Run: npx vite-node tests/review/expedition-economy.ts
//
//   PLAYERS=400 SEED0=7    simulated players per policy
//   HOURS=15               stop a player after this much play
//   OVERHEAD=45            seconds outside combat per stage (banner, reward pick, room 1/5, lobby, matching)
//   CHAIN=dir              read chain_<s>.json (expedition-bench MODE=chain STAGES=s) and stage times from d0_*.json
//                          in dir instead of the tables below
//
// Policies (start at the highest stage the gear allows unless named otherwise):
//   boss    = 「다음 보스까지 가고 수령」: match on until a boss stage (3·6·9·12) is cleared, then claim
//   k1..k3  = claim after k stages cleared (k1 = 「단계마다 바로 수령」)
//   greedy  = match on until a failure or stage 12
//   from1   = always start at stage 1 and go as far as possible (never claim before 12)
// A failure loses the bag. The clear rate of a stage depends on where the run started (the carry and the bots' gear grow
// with the stage, the player's own gear does not); a player whose gear is above the start rule's minimum is treated as
// exactly at it (conservative). Output per policy: hours (median / p25 / p75) until the 9 base slots are all ≥ T3 / T6 /
// T9 / T11 / T12, runs (claims + losses) to T11, relics owned at 5 h, share of runs lost, stage 12 first cleared, and
// (기획 16차) the pace over the first 5 h: stages played and base items claimed per hour played.

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
const OVERHEAD = Number(env.OVERHEAD ?? 45);
const PARTY = ['blade', 'mage', 'cleric'];

/**
 * CHAIN[s − 1][k] = clear % of stage s + k in a run started at stage s (T(s − 1), 직접 교체 + 2 bots, 240 runs each).
 * Cells with fewer than 20 runs reaching them fall back to the last measured one.
 * 기획 16차 밸런스 (balance.md 16-7): one-floor stages, each stage started from the lobby with the real carry
 * (expedition-bench.ts MODE=chain STAGES=s RUNS=240), the tuned EXPEDITION numbers.
 */
const CHAIN: (number | null)[][] = [
  [100, 95, 90.8, 92.3, 88, 61.3, 88.3, 92.3, 50, 90.5, 78.9, 23.3],
  [94.6, 90.7, 97.1, 90.5, 61.9, 89.3, 84, 57.1, 89.6, 81.4, 37.1],
  [87.1, 96.2, 93.5, 66, 92.7, 86.1, 56.6, 89.3, 80, 40],
  [90, 90.7, 70.9, 90.6, 89.7, 58.4, 90.9, 83.3, 32],
  [88.3, 82.5, 92, 94.4, 68.4, 92.3, 79.2, 53.9],
  [84.2, 88.6, 89.9, 65.8, 89.6, 83.2, 48.1],
  [88.8, 91.1, 68.6, 93.2, 85.5, 54.7],
  [85.4, 75.1, 95.5, 89.8, 53],
  [68.3, 92.7, 87.5, 63.2],
  [88.3, 88.7, 66],
  [81.3, 66.2],
  [63.3],
];
/**
 * Combat median seconds of each stage (stage mode, Δ = 0). 기획 16차 밸런스 (balance.md 16장): one-floor stages, 960 runs,
 * the tuned EXPEDITION numbers.
 */
const COMBAT_S = [49.6, 63.7, 88.5, 65, 72.8, 112.3, 79.6, 81.3, 102.8, 74.2, 76.1, 88];

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
  /** 기획 16차: pace over the first 5 h — stages played, base items claimed into the stash. */
  stagesAt5h: number;
  itemsAt5h: number;
  /** Hours played within the first 5 h (less when the player is done sooner). */
  h5: number;
  runs: number;
  lostRuns: number;
  firstStage12: number;
}

const stageHours = (stage: number, cleared: boolean) => ((cleared ? COMBAT_S[stage - 1] : COMBAT_S[stage - 1] * 0.6) + OVERHEAD) / 3600;

function simulate(policy: Policy, k: number): PlayerRec {
  const rng = new Rng(mixSeed(SEED0, k, POLICIES.indexOf(policy)));
  const s = emptyStash();
  const rec: PlayerRec = { at: MILESTONES.map(() => Infinity), runsTo11: Infinity, relicsAt5h: 0, stagesAt5h: 0, itemsAt5h: 0, h5: 0, runs: 0, lostRuns: 0, firstStage12: Infinity };
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
      if (before < 5) rec.stagesAt5h++;
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
    if (bag.length && hours <= 5) rec.itemsAt5h += bag.filter(x => x.slot !== 'relic').length;
    if (bag.length) {
      addItems(s, bag, stage);
      autoEquip(s, PARTY);
      prune(s, loadoutsFor(s, PARTY));
    }
  }
  if (hours < 5) rec.relicsAt5h = relics();
  rec.h5 = Math.min(5, hours);
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
    stagesPerHour: h2(recs.reduce((a, r) => a + r.stagesAt5h, 0) / recs.reduce((a, r) => a + r.h5, 0)),
    itemsPerHour: h2(recs.reduce((a, r) => a + r.itemsAt5h, 0) / recs.reduce((a, r) => a + r.h5, 0)),
    lostRunPct: h2((100 * recs.reduce((a, r) => a + r.lostRuns, 0)) / Math.max(1, recs.reduce((a, r) => a + r.runs, 0))),
  };
}
console.log(JSON.stringify({ players: PLAYERS, hours: HOURS, overheadS: OVERHEAD, policies: out }, null, 1));
