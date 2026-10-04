// Real-time frame check (opt-in): PERF=1 npx playwright test perf
// A) 40 s of floor-1 play at gameSpeed 1 with a swap every ~4 s (+ pets/ult when ready).
// B) Stress (기획서 15장 리스크 메모): ~30 monsters with frequent ults from all 3 players.
// Frame times come from an in-page rAF counter; sim cost from wrapping game.step. Headless Chromium here has no GPU.

import { test, type Page } from '@playwright/test';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
test.skip(!env.PERF, 'set PERF=1 to run the frame-time check');
test.setTimeout(240_000);

interface FrameReport {
  scenario: string;
  seconds: number;
  frames: number;
  fps: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  over33ms: number;
  over50ms: number;
  jsAvgMs: number;
  jsP95Ms: number;
  jsMaxMs: number;
  simAvgMs: number;
  simMaxMs: number;
  maxEntities: number;
  maxMonsters: number;
  swaps: number;
  ults: number;
  longTasks: number;
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const probe = { frames: [] as number[], busy: [] as number[], sim: [] as number[], last: 0, maxEnt: 0, maxMon: 0, longTasks: 0, on: false };
    w.__perf = probe;
    // Registered after the app's own rAF callback, so (performance.now() - frame timestamp) here ≈ the app's JS time this frame.
    const tick = (now: number) => {
      if (probe.on) probe.busy.push(performance.now() - now);
      if (probe.on && probe.last > 0) probe.frames.push(now - probe.last);
      probe.last = now;
      const g = window.__proto?.game;
      if (probe.on && g) {
        probe.maxEnt = Math.max(probe.maxEnt, g.state.entities.length);
        probe.maxMon = Math.max(probe.maxMon, g.state.monstersAlive);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver(list => {
        if (probe.on) probe.longTasks += list.getEntries().length;
      }).observe({ type: 'longtask', buffered: false });
    } catch {
      /* longtask not supported */
    }
  });
}

/** Wrap the live game's step() to time the sim (call after each startRun). */
async function wrapStep(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__proto!.game! as unknown as { step: (dt: number) => void };
    const probe = (window as unknown as { __perf: { sim: number[]; on: boolean } }).__perf;
    const orig = g.step;
    g.step = (dt: number) => {
      const t0 = performance.now();
      orig(dt);
      if (probe.on) probe.sim.push(performance.now() - t0);
    };
  });
}

async function measure(page: Page, scenario: string, seconds: number, everyTick: (i: number) => Promise<void>): Promise<FrameReport> {
  await page.evaluate(() => {
    const p = (window as unknown as { __perf: { frames: number[]; busy: number[]; sim: number[]; maxEnt: number; maxMon: number; longTasks: number; on: boolean } }).__perf;
    p.frames = [];
    p.busy = [];
    p.sim = [];
    p.maxEnt = 0;
    p.maxMon = 0;
    p.longTasks = 0;
    p.on = true;
  });
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await everyTick(i++);
    await page.waitForTimeout(250);
  }
  return page.evaluate(
    ([name]) => {
      const p = (window as unknown as { __perf: { frames: number[]; busy: number[]; sim: number[]; maxEnt: number; maxMon: number; longTasks: number; on: boolean } }).__perf;
      p.on = false;
      const f = [...p.frames].sort((a, b) => a - b);
      const sum = f.reduce((a, b) => a + b, 0);
      const sim = p.sim;
      const busy = [...p.busy].sort((a, b) => a - b);
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const me = window.__proto!.game!.state.players[0].stats;
      return {
        scenario: name as string,
        seconds: Math.round(sum / 100) / 10,
        frames: f.length,
        fps: Math.round((f.length / (sum / 1000)) * 10) / 10,
        avgMs: Math.round((sum / f.length) * 100) / 100,
        p95Ms: Math.round(f[Math.floor(f.length * 0.95)] * 100) / 100,
        maxMs: Math.round(f[f.length - 1] * 100) / 100,
        over33ms: f.filter(x => x > 33.4).length,
        over50ms: f.filter(x => x > 50).length,
        jsAvgMs: r2(busy.reduce((a, b) => a + b, 0) / Math.max(1, busy.length)),
        jsP95Ms: r2(busy[Math.floor(busy.length * 0.95)] ?? 0),
        jsMaxMs: r2(busy[busy.length - 1] ?? 0),
        simAvgMs: Math.round((sim.reduce((a, b) => a + b, 0) / Math.max(1, sim.length)) * 1000) / 1000,
        simMaxMs: Math.round(Math.max(0, ...sim) * 100) / 100,
        maxEntities: p.maxEnt,
        maxMonsters: p.maxMon,
        swaps: me.swaps,
        ults: me.ultsUsed,
        longTasks: p.longTasks,
      };
    },
    [scenario, seconds] as const,
  );
}

/** Swap to the next ready card near the nearest enemy (same path as a real drop); pick rewards; use pets/ult. */
async function play(page: Page, i: number, swapEvery: number): Promise<void> {
  await page.evaluate(
    ([step, every]) => {
      const api = window.__proto!;
      const g = api.game!;
      const s = g.state;
      if (s.phase === 'reward' && s.rewardOffers) {
        g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
        return;
      }
      if (s.phase !== 'combat') return;
      const me = s.players[0];
      const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
      const from = mine?.pos ?? { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 };
      const foe = s.entities
        .filter(e => e.team === 'enemy' && e.hp > 0 && e.tier !== 'boss')
        .sort((a, b) => Math.hypot(a.pos.x - from.x, a.pos.y - from.y) - Math.hypot(b.pos.x - from.x, b.pos.y - from.y))[0];
      const at = foe ? foe.pos : from;
      if (step % every === 0 || me.activeIndex == null) {
        for (let k = 1; k <= 3; k++) {
          const idx = ((me.activeIndex ?? -1) + k + 3) % 3;
          if (g.canSwap(0, idx).ok) {
            api.ui.dragTo('swap', idx, at);
            break;
          }
        }
      }
      if (foe && step % 6 === 3) {
        const pet = me.pets.findIndex((_, k) => g.canUsePet(0, k).ok);
        if (pet >= 0) api.ui.dragTo('pet', pet, at);
      }
      if (me.ult.charge >= 1) g.dispatch({ type: 'ult', player: 0 });
    },
    [i, swapEvery] as const,
  );
}

test('frame time: 40 s normal play + stress', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  await installProbe(page);
  const reports: FrameReport[] = [];

  // A) floor 1 at gameSpeed 1, a swap every ~4 s
  await page.evaluate(() => window.__proto!.startRun({ seed: 777 }));
  await wrapStep(page);
  await page.waitForTimeout(1000);
  reports.push(await measure(page, `normal 40s (${testInfo.project.name})`, 40, i => play(page, i, 16)));

  // B) stress: floor 9 (10 waves), a wave every second up to the 30-alive cap, tanky monsters so they pile up,
  //    ult gauge 3 s for all three players (bots fire theirs 0.5–3 s after full), invincible party
  await page.evaluate(() =>
    window.__proto!.startRun({
      seed: 4040,
      startFloor: 9,
      tunables: { waveInterval: 1, monsterHpMult: 25, ultChargeTime: 3, invincible: true, midBossTimeTrigger: 3 },
    }),
  );
  await wrapStep(page);
  await page.waitForFunction(() => window.__proto!.game!.state.monstersAlive >= 26, undefined, { timeout: 40_000 }).catch(() => undefined);
  reports.push(await measure(page, `stress 15s (${testInfo.project.name})`, 15, i => play(page, i, 12)));
  await page.screenshot({ path: testInfo.outputPath('stress.png') });

  const text = JSON.stringify(reports, null, 2);
  console.log(text);
  await testInfo.attach('frame-report.json', { body: text, contentType: 'application/json' });
});
