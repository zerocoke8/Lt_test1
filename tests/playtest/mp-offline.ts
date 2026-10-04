// Network stall on a phone (tunnel / elevator: the socket is not closed, packets just stop) in a 2-human room.
// B goes offline for PT_OFF_SEC (default 40) s; 2 s in, B makes a REAL touch drag. We watch:
//   - B's screen: any banner? does the drag look accepted?    - A's screen: when does B's seat become a BOT?
//   - after B is back online: is B's stale swap applied late (at the old drop point)? how long until B is in control?
// Run: PT_BASE=http://127.0.0.1:8790/ npx vite-node tests/playtest/mp-offline.ts

import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';
import type { Vec2 } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const BASE = env.PT_BASE ?? 'http://127.0.0.1:8790/';
const OFF_SEC = Number(env.PT_OFF_SEC ?? 40);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

interface P {
  ctx: BrowserContext;
  page: Page;
  cdp: CDPSession;
  errors: string[];
}

async function open(browser: import('@playwright/test').Browser, preset: { characters: string[]; pets: string[] }): Promise<P> {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(p => localStorage.setItem('swapTower.preset.v1', JSON.stringify(p)), preset);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  return { ctx, page, cdp: await ctx.newCDPSession(page), errors };
}
async function tap(p: P, sel: string): Promise<void> {
  const b = (await p.page.locator(sel).first().boundingBox())!;
  await p.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}
const phase = (p: P, want: string, timeout = 15000) => p.page.waitForFunction(w => window.__proto?.phase === w, want, { timeout });

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });
  const A = await open(browser, { characters: ['guardian', 'cleric', 'bard'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
  const B = await open(browser, { characters: ['guardian', 'paladin', 'warden'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
  const log: string[] = [];
  const t00 = Date.now();
  const L = (...a: unknown[]) => {
    const line = `[${((Date.now() - t00) / 1000).toFixed(1)}s] ${a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
    log.push(line);
    console.log(line);
  };
  try {
    await tap(A, '.btn-start');
    await phase(A, 'lobby');
    await A.page.waitForFunction(() => window.__proto?.net.status === 'online');
    await tap(A, '.lb-create');
    await phase(A, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    await tap(B, '.btn-start');
    await phase(B, 'lobby');
    await B.page.waitForFunction(() => window.__proto?.net.status === 'online');
    await B.page.locator('.lb-code-input').fill(code);
    await tap(B, '.lb-join');
    await phase(B, 'room');
    await tap(A, '.lb-start');
    await phase(A, 'combat', 20000);
    await phase(B, 'combat', 20000);
    // invincible so nobody dies during the long stall (host debug, applies to everyone)
    await A.page.evaluate(() => (window.__proto!.game!.tunables.invincible = true));
    await sleep(5000);
    // A records where B's characters appear (drop points), with wall-clock time
    await A.page.evaluate(() => {
      const w = window as unknown as { __ap: { t: number; pos: { x: number; y: number }; idx: number }[] };
      w.__ap = [];
      const g = window.__proto!.game!;
      const orig = g.drainEvents.bind(g);
      g.drainEvents = () => {
        const evs = orig();
        for (const e of evs) if (e.type === 'appear' && e.player === 1) w.__ap.push({ t: Date.now(), pos: e.pos, idx: e.partyIndex });
        return evs;
      };
    });

    const before = await A.page.evaluate(() => {
      const p = window.__proto!.game!.state.players[1];
      return { swaps: p.stats.swaps, active: p.activeIndex };
    });
    const t0 = Date.now();
    await B.ctx.setOffline(true);
    L('B offline', before);
    await sleep(2000);
    // B: real touch drag of card 2 to the right of its character
    const r = await B.page.evaluate(() => {
      const api = window.__proto!;
      const s = api.game!.state;
      const me = s.players[api.localPlayer];
      const i = [0, 1, 2].find(k => api.game!.canSwap(api.localPlayer, k).ok) ?? 1;
      const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
      const w = { x: (mine?.pos.x ?? 12) + 3, y: Math.max(2, (mine?.pos.y ?? 6) - 1) };
      const c = document.querySelector(`.ccard[data-idx="${i}"]`)!.getBoundingClientRect();
      return { i, w, finger: api.ui.fingerFor(w), card: { x: c.x + c.width / 2, y: c.y + c.height / 2 } };
    });
    const pt = (q: Vec2) => [{ x: q.x, y: q.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }];
    await B.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(r.card) });
    for (let k = 1; k <= 12; k++) {
      await B.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt({ x: r.card.x + ((r.finger.x - r.card.x) * k) / 12, y: r.card.y + ((r.finger.y - r.card.y) * k) / 12 }) });
      await sleep(16);
    }
    await sleep(150);
    await B.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    const bView = await B.page.evaluate(() => ({
      toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent),
      banner: !document.querySelector('.net-banner')?.classList.contains('is-hidden') ? document.querySelector('.net-banner')?.textContent : null,
      online: window.__proto!.net.status,
    }));
    L('B dragged card', r.i, 'to', r.w, '→ B screen:', bView);
    await B.page.screenshot({ path: '/tmp/mp-offline-b-after-drag.png' });
    let botAt: number | null = null;
    let bannerAt: number | null = null;
    let statusChange: string | null = null;
    while (Date.now() - t0 < OFF_SEC * 1000) {
      await sleep(500);
      const a = await A.page.evaluate(() => window.__proto!.game!.state.players[1].isBot);
      if (a && botAt == null) {
        botAt = Date.now() - t0;
        L('A: B seat is BOT now', botAt, 'ms');
        await A.page.screenshot({ path: '/tmp/mp-offline-a-bot.png' });
      }
      const b = await B.page.evaluate(() => ({ banner: !document.querySelector('.net-banner')?.classList.contains('is-hidden'), st: window.__proto!.net.status }));
      if (b.banner && bannerAt == null) {
        bannerAt = Date.now() - t0;
        L('B: banner visible', bannerAt, 'ms');
      }
      if (b.st !== 'online' && statusChange == null) {
        statusChange = `${b.st}@${Date.now() - t0}`;
        L('B: net status', statusChange);
      }
    }
    await B.page.screenshot({ path: '/tmp/mp-offline-b-end.png' });
    const t1 = Date.now();
    await B.ctx.setOffline(false);
    L('B online again');
    let applied: number | null = null;
    let human: number | null = null;
    for (let k = 0; k < 120 && (applied == null || human == null); k++) {
      await sleep(100);
      const a = await A.page.evaluate(n => {
        const p = window.__proto!.game!.state.players[1];
        return { swaps: p.stats.swaps, bot: p.isBot, active: p.activeIndex };
      }, before.swaps);
      if (applied == null && a.swaps > before.swaps) {
        applied = Date.now() - t1;
        L('A: B swap count went up after reconnect', applied, 'ms', a);
      }
      if (human == null && !a.bot) human = Date.now() - t1;
    }
    const aps = await A.page.evaluate(() => (window as unknown as { __ap: unknown[] }).__ap);
    L('A saw B appear events (wall ms since online):', (aps as { t: number; pos: Vec2; idx: number }[]).map(a => ({ dt: a.t - t1, idx: a.idx, pos: a.pos })), 'B dropped at', r.w);
    L('after online: human again', human, 'ms; swap applied', applied, 'ms (null = dropped)');
    await sleep(1500);
    const tail = await B.page.evaluate(() => ({
      toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent),
      status: window.__proto!.net.status,
      phase: window.__proto!.phase,
    }));
    L('B after', tail);
    await B.page.screenshot({ path: '/tmp/mp-offline-b-back.png' });
    L('errors', { A: A.errors, B: B.errors });
    fs.writeFileSync('/tmp/mp-offline-report.json', JSON.stringify({ log, botAt, bannerAt, statusChange, applied, human }, null, 1));
  } finally {
    await browser.close();
  }
}

main().catch(e => console.error(e));
