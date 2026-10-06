// 기획 13차 ult bench (docs/skill-renewal.md 4-4, docs/balance.md 12장): what each of the 15 ults is worth per cast,
// with the drag bench's value model (drag-value.ts) and the same headless runs (bench-run.ts, slot 'ult').
// Run: npx vite-node tests/playtest/ult-bench.ts
//   env: BENCH_SEEDS=48 BENCH_SEED0=0 BENCH_FLOORS=5 BENCH_CHARS=blade,mage BENCH_SWAP_EVERY=4 BENCH_PARTY=same|mixed1|mixed2
//        ULT_CDSEC_VALUE=23.1 (a removed bench-cooldown / revive second = cdSec weight × this; default = the renewed
//        drags' roster mean value per cooldown-second, docs/balance.md 12-2)
//        BENCH_OUT=path.json
//
// Player 0 = the character ×3 (designer drag aim every 4 s, ult 0.5 s after full, no pets), players 1–2 = stock bots.
// Every ult gauge is 30 s for everyone, so the comparison is per cast: spread = value ÷ the roster median
// (target 0.6–1.6×). What counts: ult damage (incl. charm hits and the stasis rebound), heals / shields / bench heals it
// made, control that kept hits off us (stun, stasis, slow, attack-down, taunt, charm), buffs on any player's field
// characters (incl. bench cards that carried them in), extra damage on enemies it made vulnerable, cooldown and revive
// seconds it removed.

import fs from 'node:fs';
import { CHARACTERS, getCharacter } from '../../src/data';
import { applyBenchPatch, newAcc, runOne, type BenchOpts, type Party } from './bench-run';
import { VALUE_WEIGHTS, valueOf, zeroComponents, type DragComponents } from './drag-value';
import { parseGoedamPolicy } from './goedam-policy';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEEDS = Number(env.BENCH_SEEDS ?? 48);
const SEED0 = Number(env.BENCH_SEED0 ?? 0);
const CHARS = env.BENCH_CHARS ? env.BENCH_CHARS.split(',') : CHARACTERS.map(c => c.id);
const CDSEC_VALUE = Number(env.ULT_CDSEC_VALUE ?? 23.1);
const OPTS: BenchOpts = {
  slot: 'ult',
  floors: Number(env.BENCH_FLOORS ?? 5),
  swapEvery: Number(env.BENCH_SWAP_EVERY ?? 4),
  party: (env.BENCH_PARTY ?? 'same') as Party,
  goedam: parseGoedamPolicy(env.GOEDAM),
};

applyBenchPatch(env.BENCH_PATCH);

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

function perCast(c: DragComponents, n: number): DragComponents {
  const o = zeroComponents();
  for (const k of Object.keys(o) as (keyof DragComponents)[]) o[k] = c[k] / Math.max(1, n);
  return o;
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

interface Row {
  char: string;
  casts: number;
  comp: DragComponents;
  value: ReturnType<typeof valueOf>;
}

const rows: Row[] = [];
const t0 = Date.now();
for (const id of CHARS) {
  const acc = newAcc();
  for (let k = 0; k < SEEDS; k++) runOne(id, 'designer', 7001 + (SEED0 + k) * 104729, acc, OPTS);
  const comp = perCast(acc.comp, acc.casts);
  rows.push({ char: id, casts: acc.casts, comp, value: valueOf(comp, CDSEC_VALUE) });
  console.error(`${id} done ${((Date.now() - t0) / 1000).toFixed(0)} s (${acc.casts} ults)`);
}

const med = median(rows.map(r => r.value.total));
const table = rows.map(({ char, casts, comp: c, value: v }) => ({
  char,
  name: getCharacter(char).ult.name,
  casts,
  dmg: r0(c.dmg),
  stunHp: r0(c.stunHp),
  slowHp: r0(c.slowHp),
  atkDnHp: r0(c.atkDownHp),
  tauntHp: r0(c.tauntHp),
  charmHp: r0(c.charmHp),
  heal: r0(c.heal),
  shield: r0(c.shield),
  benchH: r0(c.benchHealHp),
  drainH: r0(c.drainHealHp),
  decoy: r0(c.decoyHp),
  defHp: r0(c.defHp),
  buffDmg: r0(c.buffDmg),
  vulnD: r0(c.vulnDmg),
  cdSec: r1(c.cdSec),
  reviveS: r1(c.reviveSec),
  vDmg: r0(v.damage),
  vCC: r0(v.cc),
  vSup: r0(v.support),
  vSpec: r0(v.special),
  value: r0(v.total),
  vsMedian: r1(v.total / med),
}));
console.log(`=== ult value per cast (designer drag aim, weights ${JSON.stringify(VALUE_WEIGHTS)}, cd/revive second = ${CDSEC_VALUE}) ===`);
console.table(table);
const spread = rows.map(r => r.value.total / med);
console.log(`median ${r0(med)}, min ×${r1(Math.min(...spread))}, max ×${r1(Math.max(...spread))} (target 0.6–1.6)`);
if (env.BENCH_OUT) fs.writeFileSync(env.BENCH_OUT, JSON.stringify({ seeds: SEEDS, opts: { ...OPTS, goedam: OPTS.goedam.name }, median: med, table }, null, 1));
