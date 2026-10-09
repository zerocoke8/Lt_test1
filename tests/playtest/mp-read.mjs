// Multiplayer readability check: 3 phones (844×390 @3x, CDP touch) in one room through the real lobby, floor 1 at
// speed 1, real drags/ults on every phone. Each client taps its own event stream (wraps game.drainEvents; the app
// still gets every event) → per client: which players' casts arrived, and screenshots right after ANOTHER
// player's drag/ult so we can see it rendered there.
//   PORT=8795 STATIC_DIR=<dist> node <server bundle>    then
//   PT_BASE=http://127.0.0.1:8795/ node tests/playtest/mp-read.mjs [seconds=50]
// Output: /tmp/read-mp-<A|B|C>-NN-*.png, /tmp/read-mp-report.json
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.PT_BASE ?? 'http://127.0.0.1:8795/';
const SECS = Number(process.argv[2] ?? 50);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PRESETS = { A: ['블레이드', '메이지', '클레릭'], B: ['가디언', '레인저', '바드'], C: ['섀도우', '거너', '크로노'] };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const report = { clients: {}, errors: {} };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });

async function open(key) {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errors.push(`console.${m.type()}: ${m.text()}`));
  await page.addInitScript(() => {
    const p = { frames: [], last: 0 };
    window.__pt = p;
    const tick = t => {
      if (p.last) p.frames.push(t - p.last);
      p.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cdp = await ctx.newCDPSession(page);
  const d = { key, ctx, page, cdp, errors, n: 0, otherShots: 0 };
  report.errors[key] = errors;
  await page.goto(BASE);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', undefined, { timeout: 20000 });
  return d;
}
const box = async (d, sel) => {
  const b = await d.page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`${d.key}: no ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const tap = async (d, sel) => {
  const p = await box(d, sel);
  await d.page.touchscreen.tap(p.x, p.y);
};
const touch = (d, type, p) => d.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
const shot = (d, name) => d.page.screenshot({ path: `/tmp/read-mp-${d.key}-${String(++d.n).padStart(2, '0')}-${name}.png` });
const phase = (d, want, timeout = 20000) => d.page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });

async function preset(d) {
  for (let g = 0; g < 6; g++) {
    const chip = d.page.locator('.ps-slot-row .slot-chip:not(.is-empty):not(.slot-pet)').first();
    if (!(await chip.count())) break;
    const b = await chip.boundingBox();
    await d.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(60);
  }
  for (const n of PRESETS[d.key]) {
    const c = d.page.locator(`.ps-char[aria-label^="${n} "]`).first();
    await c.scrollIntoViewIfNeeded();
    const b = await c.boundingBox();
    await d.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(80);
  }
  for (let k = 0; k < 6 && (await d.page.locator('.ps-pet.is-picked').count()) < 3; k++) {
    const b = await d.page.locator('.ps-pet:not(.is-picked)').first().boundingBox();
    await d.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(60);
  }
}
async function nick(d, name) {
  await tap(d, '.lb-name input');
  await d.page.keyboard.press('Control+A');
  await d.page.keyboard.type(name);
  await d.page.keyboard.press('Enter');
  await sleep(150);
}

async function tapEvents(d) {
  await d.page.evaluate(() => {
    const g = window.__proto.game;
    if (!g || g.__tapped) return;
    window.__ev = [];
    window.__casts = {};
    const orig = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const ev = orig();
      for (const e of ev) {
        if (e.type === 'skillCast' && e.player != null && e.slot !== 'monster') {
          const k = `p${e.player}.${e.slot}`;
          window.__casts[k] = (window.__casts[k] ?? 0) + 1;
          if (e.slot === 'drag' || e.slot === 'ult') window.__ev.push({ wall: Date.now(), player: e.player, slot: e.slot, name: e.name, delay: e.delay ?? 0 });
        }
      }
      return ev;
    };
    g.__tapped = true;
  });
}

/** Densest enemy point on MY screen (multi: localPlayer is not 0). */
function target(d) {
  return d.page.evaluate(() => {
    const api = window.__proto;
    const s = api.game.state;
    const me = s.players[api.localPlayer];
    const canvas = document.querySelector('canvas.stage-canvas');
    const foes = s.entities.filter(e => e.team === 'enemy' && e.hp > 0);
    const cands = foes.map(f => ({ w: f.pos, n: foes.filter(q => Math.hypot(q.pos.x - f.pos.x, q.pos.y - f.pos.y) < 2.5).length })).sort((a, b) => b.n - a.n);
    const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex].entityId) : null;
    if (mine) cands.push({ w: { x: mine.pos.x + 1, y: mine.pos.y - 1 }, n: 0 });
    cands.push({ w: { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 }, n: 0 });
    for (const c of cands) {
      const f = api.ui.fingerFor(c.w);
      if (f.x < 20 || f.x > innerWidth - 20 || f.y < 10 || f.y > innerHeight - 4) continue;
      if (document.elementFromPoint(f.x, f.y) !== canvas) continue;
      return f;
    }
    return null;
  });
}

async function act(d) {
  const st = await d.page.evaluate(() => {
    const api = window.__proto;
    const g = api.game;
    const lp = api.localPlayer;
    const me = g.state.players[lp];
    const ready = [0, 1, 2].filter(i => g.canSwap(lp, i).ok);
    return { ready, ult: me.activeIndex != null ? me.party[me.activeIndex].ult.charge : 0, active: me.activeIndex, phase: api.phase };
  });
  if (st.phase !== 'combat') return;
  if (st.ult >= 1 && st.active != null) await tap(d, '.ult');
  if (st.ready.length && Date.now() - (d.lastSwap ?? 0) > 4000 + (d.key.charCodeAt(0) - 65) * 700) {
    const f = await target(d);
    if (!f) return;
    const from = await box(d, `.ccard[data-idx="${st.ready[0]}"]`);
    await touch(d, 'touchStart', from);
    for (let i = 1; i <= 12; i++) {
      await touch(d, 'touchMove', { x: from.x + (f.x - from.x) * (i / 12), y: from.y + (f.y - from.y) * (i / 12) });
      await sleep(16);
    }
    await sleep(60);
    await touch(d, 'touchEnd', f);
    d.lastSwap = Date.now();
  }
}

const A = await open('A');
const B = await open('B');
const C = await open('C');
const devs = [A, B, C];
try {
  for (const d of devs) await preset(d);
  await tap(A, '.btn-start');
  await phase(A, 'lobby');
  await A.page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10000 });
  await nick(A, '에이');
  await tap(A, '.lb-create');
  await phase(A, 'room');
  const code = await A.page.evaluate(() => window.__proto.net.roomCode);
  for (const [d, n] of [[B, '비'], [C, '씨']]) {
    await tap(d, '.btn-start');
    await phase(d, 'lobby');
    await d.page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10000 });
    await nick(d, n);
    await tap(d, '.lb-code-input');
    await d.page.keyboard.type(code.toLowerCase(), { delay: 40 });
    await tap(d, '.lb-join');
    await phase(d, 'room');
  }
  await sleep(300);
  await tap(A, '.lb-start');
  await Promise.all(devs.map(d => phase(d, 'combat', 20000)));
  for (const d of devs) await tapEvents(d);
  await Promise.all(devs.map(d => d.page.evaluate(() => (window.__pt.frames = []))));
  const t0 = Date.now();
  while (Date.now() - t0 < SECS * 1000) {
    for (const d of devs) {
      await act(d).catch(() => {});
      const evs = await d.page.evaluate(() => { const e = window.__ev ?? []; window.__ev = []; return e; });
      const lp = await d.page.evaluate(() => window.__proto.localPlayer);
      const other = evs.find(e => e.player !== lp && !e.delay);
      if (other && d.otherShots < 3) {
        d.otherShots++;
        await sleep(Math.max(0, 260 - (Date.now() - other.wall)));
        await shot(d, `other-p${other.player}-${other.slot}`);
      }
    }
    await sleep(120);
  }
  for (const d of devs) {
    report.clients[d.key] = await d.page.evaluate(() => {
      const f = window.__pt.frames;
      const sum = f.reduce((a, x) => a + x, 0);
      return { localPlayer: window.__proto.localPlayer, casts: window.__casts, fps: +(f.length / (sum / 1000)).toFixed(1), over50: f.filter(x => x > 50).length, phase: window.__proto.phase, players: window.__proto.game.state.players.map(p => ({ name: p.name, bot: p.isBot, swaps: p.stats.swaps, ults: p.stats.ultsUsed })) };
    });
    await shot(d, 'end');
  }
} finally {
  fs.writeFileSync('/tmp/read-mp-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
}
