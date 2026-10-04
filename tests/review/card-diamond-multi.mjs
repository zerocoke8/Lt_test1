// Independent review: the card normal-skill diamond on a MULTIPLAYER client (B joins A's room; both phones 844×390@3x).
// On B (non-host, state from 15 Hz snapshots): diamond text vs B's own snapshot timers every frame, flashes per auto
// cast, bench ticking, the sweep's implied total vs the data cooldown. Screenshots of B's card row.
//   BASE=http://127.0.0.1:4391/ OUT=/tmp/x node tests/review/card-diamond-multi.mjs   (BASE = the built game server)

import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4391/';
const OUT = process.env.OUT ?? '/tmp/card-diamond';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });
const errors = [];

async function open(name) {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${name} console.error: ${m.text()}`));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', null, { timeout: 20000 });
  await page.waitForFunction(() => window.__proto?.net.status === 'online', null, { timeout: 10000 });
  return page;
}
const waitPhase = (page, want, timeout = 20000) => page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
async function tap(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

const A = await open('A');
const B = await open('B');
await tap(A, '.btn-start');
await waitPhase(A, 'lobby');
await tap(B, '.btn-start');
await waitPhase(B, 'lobby');
await tap(A, '.lb-create');
await waitPhase(A, 'room');
const code = await A.evaluate(() => window.__proto.net.roomCode);
await B.locator('.lb-code-input').fill(code);
await tap(B, '.lb-join');
await waitPhase(B, 'room');
await A.waitForFunction(() => document.querySelectorAll('.lb-slot:not(.is-empty)').length >= 2, null, { timeout: 10000 });
await tap(A, '.lb-start');
await waitPhase(A, 'combat', 30000);
await waitPhase(B, 'combat', 30000);
await B.waitForFunction(() => window.__proto.game?.state.players.length === 3, null, { timeout: 10000 });

const report = { localB: await B.evaluate(() => window.__proto.localPlayer), mode: await B.evaluate(() => window.__proto.mode) };
report.widgetGone = await B.locator('.nskill').count();

await B.evaluate(() => {
  const cdText = v => {
    const t = Math.ceil(v * 10 - 1e-6) / 10;
    if (t > 3) return String(Math.ceil(v - 1e-6)); // = src/ui/skillinfo.ts cdText
    return Math.max(0.1, t).toFixed(1);
  };
  const mon = { frames: 0, mism: [], casts: [0, 0, 0], flashes: [0, 0, 0], castStart: [[], [], []], implied: [[], [], []], bench: { dt: 0, dr: 0 } };
  window.__dm = mon;
  const prev = [null, null, null];
  // snapshots + a ~30 Hz HUD diff vs this per-frame loop: the text may still show the previous frame's value
  const prevWant = [null, null, null];
  const prevT = [null, null, null];
  document.querySelectorAll('.ccard .cc-norm').forEach((n, i) => {
    new MutationObserver(recs => {
      const vals = recs.map(r => r.oldValue ?? '').concat(n.className);
      for (let k = 0; k + 1 < vals.length; k++) if (!/\bis-fired\b/.test(vals[k]) && /\bis-fired\b/.test(vals[k + 1])) mon.flashes[i]++;
    }).observe(n, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
  const loop = () => {
    const g = window.__proto?.game;
    if (g && window.__proto.phase === 'combat') {
      const me = g.state.players[window.__proto.localPlayer];
      mon.frames++;
      document.querySelectorAll('.ccard').forEach((card, i) => {
        const m = me.party[i];
        const rem = me.out || m.dead ? 0 : Math.max(0, m.normalCooldownRemaining);
        if (prev[i] != null && rem > prev[i] + 0.5) {
          mon.casts[i]++;
          mon.castStart[i].push(+rem.toFixed(2));
        } else if (prev[i] != null && me.activeIndex !== i && rem > 0 && rem < prev[i] && g.state.time > prevT[i]) {
          mon.bench.dt += g.state.time - prevT[i];
          mon.bench.dr += prev[i] - rem;
        }
        prev[i] = rem;
        prevT[i] = g.state.time;
        const n = card.querySelector('.cc-norm');
        const t = card.querySelector('.cc-norm-t').textContent;
        const want = rem > 0.001 ? cdText(rem) : '';
        if (t !== want && t !== prevWant[i]) mon.mism.push({ i, t, want, rem: +rem.toFixed(2) });
        prevWant[i] = want;
        const p = parseFloat(n.style.getPropertyValue('--p'));
        if (rem > 0.5 && p > 20 && p < 340 && mon.implied[i].length < 50) mon.implied[i].push(+(rem / (1 - p / 360)).toFixed(2));
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const swapB = idx =>
  B.evaluate(idx => {
    const s = window.__proto.game.state;
    const me = s.players[window.__proto.localPlayer];
    const mine = s.entities.find(e => e.id === me.party[me.activeIndex ?? 0]?.entityId);
    const foe = s.entities.filter(e => e.team === 'enemy' && e.hp > 0)[0];
    return window.__proto.ui.dragTo('swap', idx, foe ? foe.pos : mine ? mine.pos : { x: 10, y: 6 });
  }, idx);

await sleep(6000);
for (let k = 0; k < 5; k++) {
  const st = await B.evaluate(() => {
    const me = window.__proto.game.state.players[window.__proto.localPlayer];
    return { active: me.activeIndex, ready: me.party.map(m => m.swapCooldownRemaining <= 0 && !m.dead) };
  });
  const next = [0, 1, 2].find(i => i !== st.active && st.ready[i]);
  if (next != null) report[`swap${k}`] = await swapB(next);
  await sleep(4000);
  if (k === 1) {
    await B.screenshot({ path: `${OUT}/multi-B-${k}.png` });
    const box = await B.evaluate(() => {
      const r = document.querySelector('.hud-bl').getBoundingClientRect();
      return { x: Math.max(0, r.left - 12), y: r.top - 40, width: r.width + 24, height: Math.min(window.innerHeight, r.bottom + 6) - (r.top - 40) };
    });
    await B.screenshot({ path: `${OUT}/multi-B-${k}-cards.png`, clip: box });
  }
}
report.monitor = await B.evaluate(() => {
  const m = window.__dm;
  return { frames: m.frames, casts: m.casts, flashes: m.flashes, castStart: m.castStart, mismCount: m.mism.length, mism: m.mism.slice(0, 10), bench: { simS: +m.bench.dt.toFixed(2), fell: +m.bench.dr.toFixed(2) }, implied: m.implied.map(xs => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null)) };
});
report.party = await B.evaluate(() => {
  const me = window.__proto.game.state.players[window.__proto.localPlayer];
  return { defs: me.party.map(m => m.defId), rewardsOnWire: Array.isArray(me.rewards), sheetTriggers: null };
});
report.errors = errors;
fs.writeFileSync(`${OUT}/multi-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
