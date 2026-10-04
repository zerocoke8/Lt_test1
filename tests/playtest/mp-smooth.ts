// Interpolation smoothness + drop latency, one phone page (844×390@3, touch), solo vs multi (1 human + 2 bots).
// Records every rAF frame for ~12 s: positions of all units as drawn + WebSocket snapshot arrival times, then real
// touch drags (pointerup → swap visible in this page's state).
// Run: PT_MODE=multi PT_BASE=http://127.0.0.1:8791/ PT_TAG=proxy npx vite-node tests/playtest/mp-smooth.ts
//      PT_MODE=solo  PT_BASE=http://127.0.0.1:8790/ PT_TAG=solo  npx vite-node tests/playtest/mp-smooth.ts

import { chromium, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';
import type { Vec2 } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const BASE = env.PT_BASE ?? 'http://127.0.0.1:8790/';
const MODE = env.PT_MODE ?? 'multi';
const TAG = env.PT_TAG ?? MODE;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function probe(): void {
  const P = { snaps: [] as number[], frames: [] as { t: number; u: [number, number, number][] }[], rec: false, ups: [] as number[], swaps: [] as { t: number; n: number }[], prev: -1 };
  (window as unknown as { __sm: typeof P }).__sm = P;
  document.addEventListener('pointerup', () => P.ups.push(Date.now()), true);
  const Orig = window.WebSocket;
  class W extends Orig {
    constructor(u: string | URL, p?: string | string[]) {
      super(u, p);
      this.addEventListener('message', ev => {
        if (P.rec && typeof ev.data === 'string' && ev.data.startsWith('{"t":"snap"')) P.snaps.push(performance.now());
      });
    }
  }
  window.WebSocket = W as typeof WebSocket;
  const tick = (now: number) => {
    try {
      const api = window.__proto;
      const g = api?.game;
      if (g && api!.phase === 'combat') {
        const s = g.state;
        const me = s.players[api!.localPlayer];
        if (me.stats.swaps !== P.prev) {
          if (P.prev >= 0) P.swaps.push({ t: Date.now(), n: me.stats.swaps });
          P.prev = me.stats.swaps;
        }
        // record what the renderer draws: positions right after the app's game.step() (not at our rAF, which runs
        // before the app's and can see a mid-frame snapshot ease)
        const gw = g as unknown as { __smWrapped?: boolean; __smSolo?: boolean; step(dt: number): void };
        if (!gw.__smWrapped) {
          gw.__smWrapped = true;
          const orig = gw.step.bind(g);
          gw.step = (dt: number) => {
            orig(dt);
            if (!P.rec || gw.__smSolo) return;
            try {
              P.frames.push({ t: performance.now(), u: g.state.entities.filter(e => e.hp > 0).map(e => [e.id, e.pos.x, e.pos.y] as [number, number, number]) });
            } catch {
              /* no snapshot */
            }
          };
        }
        // solo: the sim state moves at 30 Hz; what is DRAWN is the tick-blended view (src/render/smooth.ts)
        if (P.rec && api!.mode === 'solo' && api!.ui.drawState) {
          gw.__smSolo = true;
          P.frames.push({ t: now, u: api!.ui.drawState.entities.filter(e => e.hp > 0).map(e => [e.id, e.pos.x, e.pos.y] as [number, number, number]) });
        }
        void now;
      }
    } catch {
      /* no snapshot yet */
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(probe);
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(e.message));
  const cdp: CDPSession = await ctx.newCDPSession(page);
  const tap = async (sel: string) => {
    const b = (await page.locator(sel).first().boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  await page.goto(BASE);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  await tap('.btn-start');
  await page.waitForFunction(() => window.__proto?.phase === 'lobby');
  await page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 15000 });
  if (MODE === 'solo') {
    await tap('.lb-solo');
  } else {
    await tap('.lb-create');
    await page.waitForFunction(() => window.__proto?.phase === 'room');
    await tap('.lb-start');
  }
  await page.waitForFunction(() => window.__proto?.phase === 'combat', undefined, { timeout: 20000 });
  await sleep(6000); // let the first wave walk in
  await page.evaluate(() => ((window as unknown as { __sm: { rec: boolean } }).__sm.rec = true));
  await sleep(12000);
  await page.evaluate(() => ((window as unknown as { __sm: { rec: boolean } }).__sm.rec = false));
  const data = await page.evaluate(() => {
    const P = (window as unknown as { __sm: { snaps: number[]; frames: { t: number; u: [number, number, number][] }[] } }).__sm;
    return { snaps: P.snaps, frames: P.frames };
  });
  // per-unit per-frame displacement series
  const series = new Map<number, { t: number; d: number }[]>();
  for (let i = 1; i < data.frames.length; i++) {
    const a = new Map(data.frames[i - 1].u.map(([id, x, y]) => [id, { x, y }]));
    for (const [id, x, y] of data.frames[i].u) {
      const p = a.get(id);
      if (!p) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > 1.5) continue; // teleport/dash
      if (!series.has(id)) series.set(id, []);
      series.get(id)!.push({ t: data.frames[i].t, d });
    }
  }
  let moving = 0;
  let stalls = 0;
  let jumps = 0;
  let dev = 0;
  let sum = 0;
  for (const s of series.values()) {
    for (let i = 4; i < s.length - 4; i++) {
      const win = s.slice(i - 4, i + 5).map(x => x.d);
      const avg = win.reduce((a, b) => a + b, 0) / win.length;
      if (avg < 0.01) continue; // standing
      if (win.slice(0, 3).every(x => x < 0.002) || win.slice(6).every(x => x < 0.002)) continue; // starting/stopping
      moving++;
      sum += s[i].d;
      dev += Math.abs(s[i].d - avg);
      if (s[i].d < avg * 0.2) stalls++;
      if (s[i].d > avg * 2) jumps++;
    }
  }
  const fr = data.frames.map(f => f.t);
  const fdt = fr.slice(1).map((t, i) => t - fr[i]).sort((a, b) => a - b);
  const gaps = data.snaps.slice(1).map((t, i) => t - data.snaps[i]).sort((a, b) => a - b);
  const q = (xs: number[], p: number) => (xs.length ? +xs[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(1) : NaN);
  const out: Record<string, unknown> = {
    tag: TAG,
    mode: MODE,
    frames: data.frames.length,
    fps: +((1000 * fdt.length) / fdt.reduce((a, b) => a + b, 0)).toFixed(1),
    frameP95: q(fdt, 0.95),
    snapGaps: gaps.length ? { n: gaps.length, p10: q(gaps, 0.1), p50: q(gaps, 0.5), p90: q(gaps, 0.9), max: q(gaps, 1) } : null,
    movingSamples: moving,
    // mean |d − local average| / mean d over moving units: 0 = perfectly even motion
    unevenness: +(dev / Math.max(1e-9, sum)).toFixed(3),
    stallPct: +((100 * stalls) / Math.max(1, moving)).toFixed(1),
    jumpPct: +((100 * jumps) / Math.max(1, moving)).toFixed(1),
  };
  // one representative unit trace for the report
  // a representative moving stretch: the unit with the most distance travelled
  const mover = [...series.values()].sort((a, b) => b.reduce((s, x) => s + x.d, 0) - a.reduce((s, x) => s + x.d, 0))[0] ?? [];
  let k0 = mover.findIndex(x => x.d > 0.01);
  if (k0 < 0) k0 = 0;
  out.sampleTrace = mover.slice(k0, k0 + 24).map(x => +x.d.toFixed(3));
  out.zeroFramePctWhileMoving = (() => {
    let mv = 0;
    let z = 0;
    for (const s of series.values()) {
      for (let i = 4; i < s.length - 4; i++) {
        const win = s.slice(i - 4, i + 5).map(x => x.d);
        const avg = win.reduce((a, b) => a + b, 0) / win.length;
        if (avg < 0.01) continue;
        mv++;
        if (s[i].d < 1e-6) z++;
      }
    }
    return +((100 * z) / Math.max(1, mv)).toFixed(1);
  })();

  // drop latency with real touch drags
  const lat: number[] = [];
  for (let k = 0; k < 6; k++) {
    await sleep(1600);
    const r = await page.evaluate(() => {
      const api = window.__proto!;
      const g = api.game!;
      const i = [0, 1, 2].find(j => g.canSwap(api.localPlayer, j).ok);
      if (i == null) return null;
      const s = g.state;
      const me = s.players[api.localPlayer];
      const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
      const w = mine ? { x: mine.pos.x + 1, y: Math.max(1.5, mine.pos.y - 1.5) } : { x: s.plan.arena.width / 2, y: 4 };
      const card = document.querySelector(`.ccard[data-idx="${i}"]`)!.getBoundingClientRect();
      return { finger: api.ui.fingerFor(w), card: { x: card.x + card.width / 2, y: card.y + card.height / 2 }, swaps: me.stats.swaps };
    });
    if (!r) continue;
    const pts = (p: Vec2) => [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(r.card) });
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts({ x: r.card.x + (r.finger.x - r.card.x) * t, y: r.card.y + (r.finger.y - r.card.y) * t }) });
      await sleep(16);
    }
    await sleep(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1200);
    const l = await page.evaluate(n => {
      const P = (window as unknown as { __sm: { ups: number[]; swaps: { t: number; n: number }[] } }).__sm;
      const up = P.ups[P.ups.length - 1];
      const sw = P.swaps.find(x => x.n > n);
      return sw && up ? sw.t - up : null;
    }, r.swaps);
    if (l != null) lat.push(l);
  }
  lat.sort((a, b) => a - b);
  out.dropToVisibleMs = { n: lat.length, all: lat, p50: lat[Math.floor(lat.length / 2)] };
  out.rtt = await page.evaluate(() => (window.__proto!.game as unknown as { latencyMs?: number | null }).latencyMs ?? null).catch(() => null);
  out.errors = errors;
  console.log(JSON.stringify(out));
  fs.writeFileSync(`/tmp/mp-smooth-${TAG}.json`, JSON.stringify(out, null, 1));
  await page.screenshot({ path: `/tmp/mp-smooth-${TAG}.png` });
  await browser.close();
}

main().catch(e => console.error(e));
