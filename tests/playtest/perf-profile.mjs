// CPU profile of the heavy-fight scenario (same setup as perf.mjs B). Build unminified for readable names:
//   npx vite build --minify false --outDir <dir> && npx vite preview --port 4197 --outDir <dir>
//   PT_BASE=http://localhost:4197/ node tests/playtest/perf-profile.mjs [seconds=10]
// Prints self time per function (top 30) and per source area (render/vfx, skillfx, units, ui, sim …).
import { center, launch, sleep, tapUlt, waitPhase } from './lib.mjs';

const SECS = Number(process.argv[2] ?? 10);
const pt = await launch('phone', { tag: 'prof' });
const { page, context } = pt;
await page.goto(process.env.PT_BASE ?? 'http://localhost:4197/');
await waitPhase(page, 'preset');
await pt.input.tap(await center(page, '.btn-start'));
await waitPhase(page, 'combat');
await page.evaluate(() =>
  window.__proto.startRun({
    seed: 6060,
    startFloor: 4,
    tunables: { waveInterval: 2, maxAliveMonsters: 60, monsterHpMult: 4, botDamageMult: 0.15, midBossTimeTrigger: 5, normalFloorTime: 300 },
  }),
);
await waitPhase(page, 'combat');
await page.evaluate(() => (window.__proto.game.tunables.invincible = true));
await page.waitForFunction(() => window.__proto.game.state.monstersAlive >= 25, undefined, { timeout: 30000 }).catch(() => {});
const cdp = await context.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  const u = await page.evaluate(() => window.__proto.game.state.players[0].ult.charge);
  if (u < 1) await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }));
  else await tapUlt(pt);
  await sleep(150);
}
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byNode = new Map(profile.nodes.map(n => [n.id, n]));
const dt = profile.timeDeltas;
const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
let total = 0;
for (const [id, us] of counts) {
  const n = byNode.get(id);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} @${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + us);
  total += us;
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log('total sampled ms', (total / 1000).toFixed(0));
for (const [k, us] of top) console.log(((us / total) * 100).toFixed(1).padStart(5) + '%', k);
await pt.browser.close();
