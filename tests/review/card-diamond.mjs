// Independent review of the card normal-skill diamond (기획 4차 §17): phone 844×390@3x (touch), solo run.
// Measures geometry / overlaps / text size, checks the number and the sweep against the sim every frame, counts the
// flash per auto-skill cast, bench ticking, reward cooldown cut, dead / spectate, the removed widget, and how the
// skill sheet is reached. Screenshots (full + 3× crops of the card row) into OUT.
//   BASE=http://127.0.0.1:4391/ OUT=/tmp/x node tests/review/card-diamond.mjs
// (BASE = a game server or `vite preview` serving a fresh `vite build`.)

import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4391/';
const OUT = process.env.OUT ?? '/tmp/card-diamond';
const PROFILE = process.env.PROFILE ?? 'phone';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROFILES = {
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });
const context = await browser.newContext(PROFILES[PROFILE]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));

const waitPhase = (want, timeout = 20000) => page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
const report = { profile: PROFILE };

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${PROFILE}-${name}.png` });
  // crop: the card row (bottom-left) at device resolution
  const box = await page.evaluate(() => {
    const r = document.querySelector('.hud-bl').getBoundingClientRect();
    return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 40), width: r.width + 24, height: Math.min(window.innerHeight, r.bottom + 6) - Math.max(0, r.top - 40) };
  });
  await page.screenshot({ path: `${OUT}/${PROFILE}-${name}-cards.png`, clip: box });
}

/** Per-card probe: geometry, text, classes, sim values. */
const probe = () =>
  page.evaluate(() => {
    const g = window.__proto.game;
    const me = g.state.players[window.__proto.localPlayer];
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const k = stage.width / 1280;
    const R = el => {
      const b = el.getBoundingClientRect();
      return { x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    return {
      stageScale: +k.toFixed(4),
      cards: [...document.querySelectorAll('.ccard')].map((card, i) => {
        const n = card.querySelector('.cc-norm');
        const t = card.querySelector('.cc-norm-t');
        const cs = getComputedStyle(t);
        const m = me.party[i];
        return {
          i,
          cls: n.className,
          cardCls: card.className,
          p: n.style.getPropertyValue('--p'),
          text: t.textContent,
          fontLogical: parseFloat(cs.fontSize),
          fontCss: +(parseFloat(cs.fontSize) * k).toFixed(2),
          diamond: R(n),
          card: R(card),
          rem: m.normalCooldownRemaining,
          dead: m.dead,
          active: me.activeIndex === i,
          gemColorReady: getComputedStyle(n.querySelector('.cc-norm-gem'), '::before').backgroundImage.slice(0, 60),
        };
      }),
    };
  });

/** Overlap of each card's diamond (|dx|+|dy| ≤ r) with everything nearby that it must not cover. */
const overlaps = () =>
  page.evaluate(() => {
    const out = [];
    const cards = [...document.querySelectorAll('.ccard')];
    const vis = el => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
    cards.forEach((card, ci) => {
      const d = card.querySelector('.cc-norm').getBoundingClientRect();
      const cx = d.left + d.width / 2;
      const cy = d.top + d.height / 2;
      const r = d.width / 2;
      const hit = (b, label) => {
        const dx = Math.max(b.left - cx, 0, cx - b.right);
        const dy = Math.max(b.top - cy, 0, cy - b.bottom);
        if (b.width > 0 && b.height > 0 && dx + dy < r - 0.5) out.push(`card ${ci}: diamond over ${label} (${(r - dx - dy).toFixed(1)} px)`);
      };
      if (d.left < 0) out.push(`card ${ci}: diamond off-screen left (${d.left.toFixed(1)})`);
      if (d.bottom > window.innerHeight) out.push(`card ${ci}: diamond off-screen bottom`);
      for (const sel of ['.cc-slot', '.cc-name', '.cc-hp', '.cc-state', '.cc-info', '.cc-count', '.cc-pips']) {
        const el = card.querySelector(sel);
        if (vis(el)) hit(el.getBoundingClientRect(), sel);
      }
      // neighbours (the previous card's right edge, its texts)
      cards.forEach((o, oi) => {
        if (oi === ci) return;
        hit(o.getBoundingClientRect(), `card ${oi}`);
      });
      for (const sel of ['.hud-bc', '.sheet-tip:not(.is-hidden)', '.pcard']) for (const el of document.querySelectorAll(sel)) if (vis(el)) hit(el.getBoundingClientRect(), sel);
    });
    return out;
  });

// ── start a solo run ──
await page.goto(BASE);
await waitPhase('preset');
await sleep(300);
// solo run straight from the preset (with a server up, 출발 offers the lobby first)
await page.evaluate(() => window.__proto.startRun({ seed: 20261004 }));
await waitPhase('combat');
report.widgetGone = await page.locator('.nskill, .ns-ring, .ns-t').count();

// in-page monitor: each frame compare the diamond to the sim; count casts (timer jumps up) and flashes (is-fired added)
await page.evaluate(() => {
  const cdText = v => {
    const t = Math.ceil(v * 10 - 1e-6) / 10;
    if (t > 3) return String(Math.ceil(v - 1e-6)); // = src/ui/skillinfo.ts cdText
    return Math.max(0.1, t).toFixed(1);
  };
  const mon = { frames: 0, textMismatch: [], casts: [0, 0, 0], flashes: [0, 0, 0], benchSamples: [], maxTotals: [0, 0, 0], sweepBad: [] };
  window.__dm = mon;
  const prev = [null, null, null];
  // the HUD diffs at ~30 Hz, this loop runs per frame: the text may still show the previous frame's value
  const prevWant = [null, null, null];
  document.querySelectorAll('.ccard .cc-norm').forEach((n, i) => {
    // replayClass removes + re-adds in one task: walk the batched records (new value of record k = old value of k+1)
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
          mon.maxTotals[i] = Math.max(mon.maxTotals[i], rem);
        }
        prev[i] = rem;
        const t = card.querySelector('.cc-norm-t').textContent;
        const want = rem > 0.001 ? cdText(rem) : '';
        // allow one frame of lag (the previous frame's text), nothing else
        if (t !== want && t !== prevWant[i]) mon.textMismatch.push({ i, t, want, rem: +rem.toFixed(3), time: +g.state.time.toFixed(2) });
        prevWant[i] = want;
        if (me.activeIndex !== i && rem > 0 && mon.benchSamples.length < 4000) mon.benchSamples.push([i, +g.state.time.toFixed(2), +rem.toFixed(2), t]);
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

// let real combat run (normal skills fire, swaps happen via the bots; my field char auto-casts)
await page.waitForFunction(() => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length >= 3, null, { timeout: 30000 });
await sleep(4000);
report.start = await probe();
await shot('01-start');

// swap to card 2 by API (same path as a real drop) so card 1 goes to the bench with a running normal timer
const swap = idx =>
  page.evaluate(idx => {
    const g = window.__proto.game;
    const s = g.state;
    const me = s.players[window.__proto.localPlayer];
    const mine = s.entities.find(e => e.id === me.party[me.activeIndex ?? 0].entityId);
    const foe = s.entities.filter(e => e.team === 'enemy' && e.hp > 0).sort((a, b) => Math.hypot(a.pos.x - (mine?.pos.x ?? 0), a.pos.y - (mine?.pos.y ?? 0)) - Math.hypot(b.pos.x - (mine?.pos.x ?? 0), b.pos.y - (mine?.pos.y ?? 0)))[0];
    return window.__proto.ui.dragTo('swap', idx, foe ? foe.pos : mine.pos);
  }, idx);
report.swap1 = await swap(1);
await sleep(2500);
report.afterSwap = await probe();
await shot('02-after-swap');
report.overlapsAfterSwap = await overlaps();

// force a visible mix: bench card 0 cooling 7.25 s, bench card 2 ready; freeze the sim (gameSpeed ~0) so the HUD shows it
await page.evaluate(() => {
  const g = window.__proto.game;
  const me = g.state.players[window.__proto.localPlayer];
  me.party[0].normalCooldownRemaining = 7.25;
  me.party[2].normalCooldownRemaining = 0;
});
await sleep(1000); // bench timer runs 1 s
report.benchTick = await page.evaluate(() => {
  const me = window.__proto.game.state.players[window.__proto.localPlayer];
  return { rem0: +me.party[0].normalCooldownRemaining.toFixed(2), text0: document.querySelector('.ccard[data-idx="0"] .cc-norm-t').textContent };
});
await page.evaluate(() => (window.__proto.game.tunables.gameSpeed = 0.0001));
await sleep(300);
report.mix = await probe();
report.overlapsMix = await overlaps();
await shot('03-bench-cool-and-ready');

// skill sheet reachability: the "i" on the active card + the floor-1 tip
report.sheet = await page.evaluate(() => ({
  infoVisible: [...document.querySelectorAll('.ccard')].map(c => getComputedStyle(c.querySelector('.cc-info')).display),
  tip: document.querySelector('.sheet-tip')?.className + ' | ' + document.querySelector('.sheet-tip')?.textContent,
}));
const info = await page.locator('.ccard.is-active .cc-info').boundingBox();
if (PROFILE === 'phone') await page.touchscreen.tap(info.x + info.width / 2, info.y + info.height / 2);
else await page.mouse.click(info.x + info.width / 2, info.y + info.height / 2);
await sleep(250);
report.sheet.openByInfoTap = await page.evaluate(() => {
  const s = document.querySelector('.skill-sheet');
  return !!s && !s.classList.contains('is-hidden') && getComputedStyle(s).display !== 'none';
});
report.sheet.normalRow = await page.evaluate(() => [...document.querySelectorAll('.skill-sheet .ss-normal *')].map(e => e.textContent).filter(Boolean).slice(0, 6));
await shot('04-sheet');
// close sheet (tap the active card again)
const act = await page.locator('.ccard.is-active').boundingBox();
if (PROFILE === 'phone') await page.touchscreen.tap(act.x + act.width / 2, act.y + 10);
else await page.mouse.click(act.x + act.width / 2, act.y + 10);
await page.evaluate(() => (window.__proto.game.tunables.gameSpeed = 1));

// reward: −45% normal cooldown on the active card → next cast starts at the reduced total; sweep total must match
const rewardIdx = await page.evaluate(() => {
  const g = window.__proto.game;
  const me = g.state.players[window.__proto.localPlayer];
  me.rewards.push({ rewardId: 'normcd_epic', partyIndex: me.activeIndex });
  return me.activeIndex;
});
const castSeen = await page
  .waitForFunction(
    idx => {
      const m = window.__proto.game.state.players[window.__proto.localPlayer].party[idx];
      const n = document.querySelector(`.ccard[data-idx="${idx}"] .cc-norm`);
      // just cast: timer near its full length, flash running
      return m.normalCooldownRemaining > 0.3 && n.classList.contains('is-fired') ? { rem: m.normalCooldownRemaining } : false;
    },
    rewardIdx,
    { timeout: 20000, polling: 'raf' },
  )
  .then(h => h.jsonValue())
  .catch(() => null);
await page.evaluate(() => (window.__proto.game.tunables.gameSpeed = 0.0001));
await sleep(60);
report.reward = {
  idx: rewardIdx,
  castSeen,
  probe: (await probe()).cards[rewardIdx],
};
await shot('05-just-fired-with-reward');
// sweep check: --p = (1 − rem/total)·360 → total
{
  const c = report.reward.probe;
  const p = parseFloat(c.p);
  report.reward.inferredTotal = p < 360 ? +(c.rem / (1 - p / 360)).toFixed(2) : null;
}
await page.evaluate(() => (window.__proto.game.tunables.gameSpeed = 1));

// play on for ~20 s to collect casts / flashes / text consistency, swapping every 5 s
for (let k = 0; k < 4; k++) {
  await sleep(5000);
  const st = await page.evaluate(() => {
    const me = window.__proto.game.state.players[window.__proto.localPlayer];
    return { active: me.activeIndex, ready: me.party.map(m => m.swapCooldownRemaining <= 0 && !m.dead) };
  });
  const next = [0, 1, 2].find(i => i !== st.active && st.ready[i]);
  if (next != null) await swap(next);
}
report.monitor = await page.evaluate(() => {
  const m = window.__dm;
  return { frames: m.frames, casts: m.casts, flashes: m.flashes, textMismatch: m.textMismatch.slice(0, 12), mismatchCount: m.textMismatch.length, maxTotals: m.maxTotals.map(x => +x.toFixed(2)) };
});
// bench ticking: per bench interval, the timer must fall ~1 s per s
report.benchRate = await page.evaluate(() => {
  // consecutive samples of the same bench card (no cast in between): Δrem / Δsim-time
  const s = window.__dm.benchSamples;
  const last = {};
  let dt = 0;
  let dr = 0;
  for (const [i, t, rem] of s) {
    const p = last[i];
    if (p && t > p[0] && rem <= p[1] && t - p[0] < 0.2) {
      dt += t - p[0];
      dr += p[1] - rem;
    }
    last[i] = [t, rem];
  }
  return { simSeconds: +dt.toFixed(2), timerFell: +dr.toFixed(2) };
});

// dead bench card + its diamond
await page.evaluate(() => {
  const g = window.__proto.game;
  g.tunables.gameSpeed = 0.0001;
  const me = g.state.players[window.__proto.localPlayer];
  const i = [0, 1, 2].find(k => k !== me.activeIndex);
  me.party[i].dead = true;
  me.party[i].hp = 0;
  me.party[i].reviveRemaining = 9;
});
await sleep(300);
report.dead = (await probe()).cards.filter(c => c.dead);
await shot('06-dead-bench');

// a fired flash frame on the active card (forced via the HUD class, for the image only)
await page.evaluate(() => {
  const g = window.__proto.game;
  g.tunables.gameSpeed = 1;
});
await page
  .waitForFunction(() => document.querySelector('.ccard.is-active .cc-norm')?.classList.contains('is-fired'), null, { timeout: 15000, polling: 'raf' })
  .catch(() => {});
await sleep(90);
await shot('07-flash');
report.overlapsEnd = await overlaps();
report.errors = errors;
fs.writeFileSync(`${OUT}/${PROFILE}-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
