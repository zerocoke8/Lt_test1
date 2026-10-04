// Clean frame-rate measurement (no screenshots while measuring). Usage: node tests/playtest/perf.mjs [phone|desktop] [cpuThrottle=1]
// A) floor 1 at gameSpeed 1 with real swaps every ~4 s (25 s)
// B) heavy fight: floor 4, many monsters alive (wave interval 2 s, cap 60, monster HP ×4, bots weakened), my character
//    invincible, ults spammed (debug chargeUlt + real tap), real swaps every 2 s (25 s)
import fs from 'node:fs';
import { BASE, center, launch, readyCard, realSwap, sleep, snap, tapUlt, waitPhase } from './lib.mjs';

const profile = process.argv[2] ?? 'phone';
const throttle = Number(process.argv[3] ?? 1);
const pt = await launch(profile, { tag: `${profile}-perf-x${throttle}` });
const { page, context } = pt;
if (throttle > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}
const res = { profile, throttle };

async function probe() {
  await page.evaluate(() => {
    const p = { frames: [], busy: [], last: 0, on: false, maxMon: 0, maxEnt: 0 };
    window.__pf = p;
    const tick = t => {
      if (p.on) {
        p.busy.push(performance.now() - t);
        if (p.last) p.frames.push(t - p.last);
        const g = window.__proto?.game;
        if (g) {
          p.maxMon = Math.max(p.maxMon, g.state.monstersAlive);
          p.maxEnt = Math.max(p.maxEnt, g.state.entities.length);
        }
      }
      p.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const start = () => page.evaluate(() => Object.assign(window.__pf, { frames: [], busy: [], on: true, maxMon: 0, maxEnt: 0, last: 0 }));
const stop = () =>
  page.evaluate(() => {
    const p = window.__pf;
    p.on = false;
    const f = [...p.frames].sort((a, b) => a - b);
    const b = [...p.busy].sort((a, b2) => a - b2);
    const sum = f.reduce((a, x) => a + x, 0);
    const q = (arr, k) => +(arr[Math.min(arr.length - 1, Math.floor(arr.length * k))] ?? 0).toFixed(1);
    return {
      fps: +(f.length / (sum / 1000)).toFixed(1),
      frameP50: q(f, 0.5),
      frameP95: q(f, 0.95),
      frameP99: q(f, 0.99),
      frameMax: q(f, 1),
      over33: f.filter(x => x > 33.4).length,
      over50: f.filter(x => x > 50).length,
      frames: f.length,
      jsAvg: +(b.reduce((a, x) => a + x, 0) / Math.max(1, b.length)).toFixed(2),
      jsP95: q(b, 0.95),
      jsMax: q(b, 1),
      maxMonsters: p.maxMon,
      maxEntities: p.maxEnt,
    };
  });

try {
  await page.goto(BASE);
  await waitPhase(page, 'preset');
  await pt.input.tap(await center(page, '.btn-start'));
  await waitPhase(page, 'combat');
  await page.evaluate(() => window.__proto.startRun({ seed: 5150 }));
  await waitPhase(page, 'combat');
  await probe();
  await page.waitForFunction(() => window.__proto.game.state.monstersAlive >= 3, undefined, { timeout: 20000 });
  // A
  await start();
  let t0 = Date.now();
  let last = 0;
  while (Date.now() - t0 < 25000) {
    const s = await snap(page);
    if (s.app !== 'combat') break;
    if (Date.now() - last > 4000) {
      const i = await readyCard(page, [0, 1, 2].filter(k => k !== s.me.active));
      if (i >= 0) (await realSwap(pt, i, {}), (last = Date.now()));
    }
    if (s.me.ult >= 1 && s.me.active != null) await tapUlt(pt);
    await sleep(200);
  }
  res.normal = await stop();
  console.log('normal', res.normal);
  // B
  await page.evaluate(() => {
    window.__proto.startRun({
      seed: 6060,
      startFloor: 4,
      tunables: { waveInterval: 2, maxAliveMonsters: 60, monsterHpMult: 4, botDamageMult: 0.15, midBossTimeTrigger: 5, normalFloorTime: 300 },
    });
  });
  await waitPhase(page, 'combat');
  await page.evaluate(() => (window.__proto.game.tunables.invincible = true));
  await page.waitForFunction(() => window.__proto.game.state.monstersAlive >= 25, undefined, { timeout: 30000 }).catch(() => {});
  await start();
  t0 = Date.now();
  last = 0;
  let ults = 0;
  while (Date.now() - t0 < 25000) {
    const s = await snap(page);
    if (s.app !== 'combat') break;
    if (s.me.ult < 1) await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }));
    else if (s.me.active != null && (await tapUlt(pt))) ults++;
    if (Date.now() - last > 2000) {
      const i = await readyCard(page, [0, 1, 2].filter(k => k !== s.me.active));
      if (i >= 0) (await realSwap(pt, i, {}), (last = Date.now()));
    }
    await sleep(150);
  }
  res.heavy = { ...(await stop()), ults };
  console.log('heavy', res.heavy);
  await pt.shot('heavy', 'heavy fight (after measurement)');
} catch (e) {
  console.log('ERR', String(e?.stack ?? e));
}
res.errors = pt.errors;
fs.writeFileSync(`/tmp/playtest-${profile}-perf-x${throttle}.json`, JSON.stringify(res, null, 1));
await pt.browser.close();
