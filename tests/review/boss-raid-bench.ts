// 기획 19차 보스 레이드 bench (docs/boss-raid.md 9장): tests/review/critic-20f.ts in MODE=bossRaid, with the knobs as
// `name=value` arguments (so it reads the same in PowerShell, cmd and bash) or as env variables.
//
//   npx vite-node tests/review/boss-raid-bench.ts
//   npx vite-node tests/review/boss-raid-bench.ts RUNS=240 POLICY=active
//   npx vite-node tests/review/boss-raid-bench.ts RUNS=240 POLICY=bot PAR=4 OUT=raid-bot.json
//   npx vite-node tests/review/boss-raid-bench.ts BOSS=overtime_lord RUNS=60 RAID_HP=0.9
//   npx vite-node tests/review/boss-raid-bench.ts RUNS=60 OFF=karaoke_room,dead_monitor TELE=1.5 AREA=0.8
//
//   RUNS=240            runs (seeds SEED0 + k × 7919 — the same seeds for every policy and knob)
//   POLICY=active|bot   active = a human seat that swaps every ~4 s (+ 2 bots); bot = three bots (also dodge, botseat …)
//   SEED0=1000
//   RAID_HP=0.8         보스 레이드 HP 배율 (Tunables.bossRaidHpMult — the debug slider's value)
//   RAID_ATK=1          보스 레이드 공격 배율 (Tunables.bossRaidAtkMult)
//   TELE=1              보스 예고 시간 배율 (Tunables.bossTelegraphMult: every part's wind-up and the gaps of a sweep)
//   AREA=1              보스 범위 크기 배율 (Tunables.bossAreaMult)
//   BOSS=<id>           that boss on floors 1–20 (looking at one boss)
//   OFF=<id>,<id>       run as if those bosses had `raid: false` (preview a cut; the rest of their zone fills in)
//   OUT=<file.json>     the whole report as JSON (per-floor rows, per-boss rows, skill table, rewards …)
//   PAR=4               child processes
//   TABLE=0             print the JSON instead of the tables
//   any other critic-20f knob too (COMP, HCOMP, TUN, PATCH, GOEDAM, JUST …)
//
// Prints: per floor (most common boss, reached, clear %, median / p90 seconds, enrage %, groggy breaks, wipes) and per
// BOSS (fights, clear %, mean / median / p90 seconds, enrage %, breaks per fight, wipes, deaths per fight, the pattern
// that kills most and its share), the run length in minutes and the #보스 tag's share of the reward picks.
// Bosses that never came up (off, or on a floor no run reached) are listed under 「이번 벤치에 안 나온 보스」.
// 기획 19차 is a ROUGH pass only (docs/boss-raid.md 9장) — RUNS=60 is enough: one boss median about 45–120 s, the 20-floor
// clear with POLICY=active neither 0 % nor 100 %, no boss enraged in more than half its fights, no pattern above half of
// a boss's deaths. Fix an outlier with one coarse edit in its data file, then `npx vite-node tests/review/boss-table.ts`.

const proc = (globalThis as { process?: { env: Record<string, string | undefined>; argv: string[] } }).process!;

const DEFAULTS: Record<string, string> = { RUNS: '240', POLICY: 'active', SEED0: '1000' };

for (const arg of proc.argv.slice(2)) {
  const eq = arg.indexOf('=');
  if (eq <= 0) continue;
  proc.env[arg.slice(0, eq).toUpperCase()] = arg.slice(eq + 1);
}
for (const [k, v] of Object.entries(DEFAULTS)) proc.env[k] ??= v;
proc.env.MODE = 'bossRaid';

await import('./critic-20f');

export {};
