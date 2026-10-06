// Headless drag-skill bench over the real sim (no rendering): what each of the 15 drag skills is worth per cast and
// per second of cooldown (docs/balance.md), and how much aiming by position matters for it.
// Run: npx vite-node tests/playtest/drag-bench.ts
//   env: BENCH_SEEDS=12 BENCH_SEED0=0 BENCH_FLOORS=5 BENCH_CHARS=blade,mage BENCH_POLICIES=designer,best,naive BENCH_SWAP_EVERY=4
//        BENCH_OUT=path.json (machine-readable result)  BENCH_QUIET=1 (only the value table)
//        BENCH_PARTY=same|mixed1|mixed2 (기획 12차: player 0 = X×3 | X+블레이드+메이지 | X+가디언+레인저; mixed parties
//        count only X's casts and X-only effects: its own hits, heals, 흡혼 marks, drag summons, and the statuses the
//        two partners' drags cannot apply — meant for 메딕 / 퇴마사 / 퍼펫티어, whose value depends on the rest of the party)
//        BENCH_PATCH='[["mage","drag","bigmeteor","*1.2"]]' (기획 13차 tuning sweeps without editing the data, see
//        bench-run.ts applyBenchPatch)
//        GOEDAM=leave (기획 10차 괴담 rooms after floors 2–4: off|leave|random|first|greedy|forced:<room>:<opt>, see
//        goedam-policy.ts; 'leave' = 'off' bit for bit, so the drag numbers stay on base values)
//
// Player 0 = a human-like player whose party is the SAME character 3 times (so every drag effect of player 0 belongs to
// that character), swapping every 4 s when a card is ready, ult 0.5 s after full, no pets. 기획 6차 (a card's cooldown
// starts when it LEAVES): with 3 cards one is back every ≈ cd/2 s at best, so this rhythm is cooldown-bound (one swap
// per 4.8–7.2 s, "secPerCast"). The 크로노 cut measured here (크로노×3) is priced via drag-value.ts cdSec, which is
// calibrated on mixed parties by cd-cut.ts. Players 1–2 = the stock bots. Floor rewards: player 0 always takes the offer that least touches drag skills (pet cd > normal cd > ult >
// def > hp > …) so every character is measured on its base numbers. Executed aim policies:
//   best     — bot aim (R29: real footprint, the whole visible screen) = a perfect aimer
//   designer — cluster centre + the offset a designer reads off the card (start LEFT of the pack for → shapes, etc.)
//              = the "realistic aim" the balance targets use
//   naive    — finger right on the densest cluster (what a new player does)
// At every drop all 4 candidate drops (best / designer / naive / self = on my own character) are also scored on the
// same tick (enemies inside the footprint, mid ×2, boss ×3) → counterfactual aim value without extra runs.
//
// Measured per cast (realised in the run, not nominal): drag damage incl. DoT / delayed parts / zone ticks (no
// overkill); enemy-seconds stunned / Σ slow×seconds and the party HP they actually kept (only while the enemy is in
// range of the character it targets — a stun freezes the attack timer, so each such second = one second of its DPS —
// at its DPS after that character's defence); pull / knockback distance actually moved (priced 0, see drag-value.ts);
// ally HP healed (no overheal), shield actually absorbed, damage prevented by a def buff, extra ally damage from
// atk / attack-speed buffs (applied multiplicatively), bench swap cooldown removed; 기획 13차: delayed / zone heals and
// ally shields by attribution, extra party damage on enemies the drag made vulnerable, taunt (tank defence gap).
// drag-value.ts weighs them; the run itself lives in bench-run.ts (shared with ult-bench.ts). Cross-check by removing
// effects from the live sim and measuring what the run loses: tests/review/drag-ablation.ts (docs/balance.md 5장).

import fs from 'node:fs';
import { CHARACTERS, getCharacter } from '../../src/data';
import { applyBenchPatch, newAcc, runOne, type Acc, type BenchOpts, type Party, type Policy } from './bench-run';
import { VALUE_WEIGHTS, valueOf, zeroComponents, type DragComponents } from './drag-value';
import { parseGoedamPolicy } from './goedam-policy';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEEDS = Number(env.BENCH_SEEDS ?? 12);
const FLOORS = Number(env.BENCH_FLOORS ?? 5);
const GOEDAM = parseGoedamPolicy(env.GOEDAM);
const CHARS = env.BENCH_CHARS ? env.BENCH_CHARS.split(',') : CHARACTERS.map(c => c.id);
const POLICIES = (env.BENCH_POLICIES ?? 'designer,best,naive').split(',') as Policy[];
const SWAP_EVERY = Number(env.BENCH_SWAP_EVERY ?? 4);
/** Seed set offset (noise check: run with 0 and e.g. 100 and compare). */
const SEED0 = Number(env.BENCH_SEED0 ?? 0);
const QUIET = env.BENCH_QUIET === '1';
const PARTY = (env.BENCH_PARTY ?? 'same') as Party;

const OPTS: BenchOpts = { slot: 'drag', floors: FLOORS, swapEvery: SWAP_EVERY, party: PARTY, goedam: GOEDAM };

applyBenchPatch(env.BENCH_PATCH);

const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);
const perCast = (c: DragComponents, n: number): DragComponents => {
  const o = zeroComponents();
  for (const k of Object.keys(o) as (keyof DragComponents)[]) o[k] = c[k] / Math.max(1, n);
  return o;
};

interface Result {
  char: string;
  name: string;
  aim: Policy;
  cd: number;
  casts: number;
  comp: DragComponents;
  perFloor: { floor: number; casts: number; comp: DragComponents }[];
  hitsPerCast: number;
  enemiesPerCast: number;
  alliesPerCast: number;
  acc: Acc;
}

const results: Result[] = [];
const cfRows: Record<string, unknown>[] = [];
const rows: Record<string, unknown>[] = [];
let lanchester = { dealt: 0, taken: 0, healed: 0 };
const t0 = Date.now();
for (const id of CHARS) {
  const def = getCharacter(id);
  for (const pol of POLICIES) {
    const acc = newAcc();
    for (let k = 0; k < SEEDS; k++) runOne(id, pol, 7001 + (SEED0 + k) * 104729, acc, OPTS);
    const tot = acc.totalDmg || 1;
    results.push({
      char: id,
      name: def.name,
      aim: pol,
      cd: def.swapCooldown,
      casts: acc.casts,
      comp: perCast(acc.comp, acc.casts),
      perFloor: [...acc.perFloor.entries()].filter(([f]) => f <= FLOORS).sort((a, b) => a[0] - b[0]).map(([floor, b]) => ({ floor, casts: b.casts, comp: perCast(b.comp, b.casts) })),
      hitsPerCast: acc.hitsExec / Math.max(1, acc.casts),
      enemiesPerCast: acc.enemiesExec / Math.max(1, acc.casts),
      alliesPerCast: acc.allyHits / Math.max(1, acc.casts),
      acc,
    });
    if (pol === 'designer') {
      lanchester = { dealt: lanchester.dealt + acc.partyDealt, taken: lanchester.taken + acc.partyTaken, healed: lanchester.healed + acc.partyHealed };
    }
    rows.push({
      char: id,
      aim: pol,
      cd: def.swapCooldown,
      casts: acc.casts,
      secPerCast: r1(acc.simSec / Math.max(1, acc.casts)),
      hitsPerCast: r1(acc.hitsExec / Math.max(1, acc.casts)),
      alliesPerCast: r1(acc.allyHits / Math.max(1, acc.casts)),
      dragPerCast: r0(acc.comp.dmg / Math.max(1, acc.casts)),
      dragPct: r1((100 * (acc.bySrc.drag ?? 0)) / tot),
      basicPct: r1((100 * (acc.bySrc.basic ?? 0)) / tot),
      normalPct: r1((100 * (acc.bySrc.normal ?? 0)) / tot),
      ultPct: r1((100 * (acc.bySrc.ult ?? 0)) / tot),
      dpm: r0(acc.totalDmg / Math.max(1, acc.simSec / 60)),
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

// value per cooldown-second; the 크로노 cooldown cut is priced at the mean of the OTHER skills (same aim policy)
function valueTable(pol: Policy, wt = VALUE_WEIGHTS) {
  const rs = results.filter(r => r.aim === pol);
  const base = rs.map(r => ({ r, v: valueOf(r.comp, 0, wt) }));
  const others = base.filter(x => x.r.comp.cdSec < 1e-6);
  const meanVps = others.reduce((a, x) => a + x.v.total / x.r.cd, 0) / Math.max(1, others.length);
  const vals = rs.map(r => ({ r, v: valueOf(r.comp, meanVps, wt) }));
  const allMean = vals.reduce((a, x) => a + x.v.total / x.r.cd, 0) / Math.max(1, vals.length);
  return { meanVps, allMean, vals };
}

const summary: Record<string, unknown> = { seeds: SEEDS, floors: FLOORS, swapEvery: SWAP_EVERY, party: PARTY, weights: VALUE_WEIGHTS };
for (const pol of POLICIES) {
  const { meanVps, allMean, vals } = valueTable(pol);
  const table = vals.map(({ r, v }) => ({
    char: r.char,
    cd: r.cd,
    hits: r1(r.enemiesPerCast),
    allies: r1(r.alliesPerCast),
    dmg: r0(r.comp.dmg),
    stunS: r1(r.comp.stunSec),
    stunEngS: r1(r.comp.stunEngSec),
    stunHp: r0(r.comp.stunHp),
    slowS: r1(r.comp.slowSec),
    slowHp: r0(r.comp.slowHp),
    disp: r1(r.comp.dispUnits),
    heal: r0(r.comp.heal),
    shieldG: r0(r.comp.shieldGranted),
    shield: r0(r.comp.shield),
    defHp: r0(r.comp.defHp),
    buffAllyS: r1(r.comp.buffAllySec),
    buffDmg: r0(r.comp.buffDmg),
    cdSec: r1(r.comp.cdSec),
    benchH: r0(r.comp.benchHealHp),
    drainH: r0(r.comp.drainHealHp),
    decoy: r0(r.comp.decoyHp),
    atkDnHp: r0(r.comp.atkDownHp),
    vulnD: r0(r.comp.vulnDmg),
    tauntHp: r0(r.comp.tauntHp),
    holdS: r1(r.comp.holdSec),
    vDmg: r0(v.damage),
    vCC: r0(v.cc),
    vSup: r0(v.support),
    vSpec: r0(v.special),
    value: r0(v.total),
    perSec: r1(v.total / r.cd),
    vsMean: `${Math.round((100 * v.total) / r.cd / allMean)}%`,
  }));
  console.log(`=== value per cast [aim=${pol}] (weights: ${JSON.stringify(VALUE_WEIGHTS)}; cd-cut priced at ${r1(meanVps)}/s) ===`);
  console.table(table);
  const spread = vals.map(x => x.v.total / x.r.cd / allMean);
  console.log(`value/sec mean ${r1(allMean)}, min ${Math.round(100 * Math.min(...spread))}%, max ${Math.round(100 * Math.max(...spread))}%`);
  summary[pol] = { meanVps, allMean, table };
  if (pol === 'designer' && !QUIET) {
    const fl: Record<string, unknown>[] = [];
    for (const { r } of vals) {
      const row: Record<string, unknown> = { char: r.char };
      for (const f of r.perFloor) {
        const v = valueOf(f.comp, meanVps);
        row[`F${f.floor}`] = `${r0(v.total)} (${r0(f.comp.dmg)}d/${f.casts})`;
      }
      fl.push(row);
    }
    console.log('=== designer aim: value per cast by floor — "value (raw damage d / casts)"; F1–F4 normal floors incl. mid boss, F5 boss ===');
    console.table(fl);
    summary.perFloor = fl;
  }
}
// sensitivity: the same measurements under other weights (value/sec as % of the roster mean, designer aim)
if (POLICIES.includes('designer')) {
  const variants: [string, Partial<typeof VALUE_WEIGHTS>][] = [
    ['base', {}],
    ['hp×0.5', { hp: VALUE_WEIGHTS.hp * 0.5 }],
    ['hp×1.5', { hp: VALUE_WEIGHTS.hp * 1.5 }],
    ['cc×0.5', { stun: VALUE_WEIGHTS.stun * 0.5, slow: VALUE_WEIGHTS.slow * 0.5, displace: VALUE_WEIGHTS.displace * 0.5 }],
    ['cc×1.5', { stun: VALUE_WEIGHTS.stun * 1.5, slow: VALUE_WEIGHTS.slow * 1.5, displace: VALUE_WEIGHTS.displace * 1.5 }],
    ['buff×0.5', { buff: VALUE_WEIGHTS.buff * 0.5 }],
    ['cdSec 0', { cdSec: 0 }],
    ['cdSec 1', { cdSec: 1 }],
  ];
  const sens: Record<string, Record<string, string>> = {};
  for (const [name, patch] of variants) {
    const { allMean, vals } = valueTable('designer', { ...VALUE_WEIGHTS, ...patch });
    for (const { r, v } of vals) (sens[r.char] ??= {})[name] = `${Math.round((100 * v.total) / r.cd / allMean)}%`;
  }
  console.log('=== sensitivity (designer aim): value/sec as % of roster mean under other weights ===');
  console.table(sens);
  summary.sensitivity = sens;
}
console.log(
  `party (all 3 players, designer runs): dealt ${r0(lanchester.dealt)}, taken ${r0(lanchester.taken)}, healed ${r0(lanchester.healed)} → dealt/taken ${r1(lanchester.dealt / Math.max(1, lanchester.taken))}`,
);
summary.lanchester = lanchester;
if (!QUIET) {
  console.log('=== executed aim policy → outcome (player 0 = same character ×3, swap every', SWAP_EVERY, 's) ===');
  console.table(rows);
  console.log('=== counterfactual footprint score at the same decision points (enemies in footprint; mid ×2, boss ×3; cleric = allies) ===');
  console.table(cfRows);
}
summary.rows = rows;
summary.cfRows = cfRows;
if (env.BENCH_OUT) {
  fs.writeFileSync(env.BENCH_OUT, JSON.stringify(summary, null, 1));
}
