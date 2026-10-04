// UI visual check: drives the real app (real sim + renderer) through every screen and saves /tmp/ui-*.png.
// 1) npx vite --port 5175   2) node tests/visual/ui-shoot.mjs
// Phone run uses real CDP touch events (pointer capture path); desktop run uses the mouse.
import { chromium } from '@playwright/test';

const BASE = process.env.UI_URL ?? 'http://localhost:5175/';
const only = process.env.ONLY; // 'phone' | 'desktop'

const VIEWPORTS = [
  { name: 'phone', ctx: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'desktop', ctx: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
].filter(v => !only || v.name === only);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const report = [];
let failures = 0;
const check = (cond, msg) => {
  report.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

for (const vp of VIEWPORTS) {
  const context = await browser.newContext(vp.ctx);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // index.html has no <link rel=icon>, so Chromium's /favicon.ico probe 404s — ignore just that one
  page.on('response', r => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  const shot = async name => {
    await page.screenshot({ path: `/tmp/ui-${vp.name}-${name}.png` });
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  /** logical stage px → client px */
  const toClient = (x, y) =>
    ev(([x, y]) => {
      const r = document.querySelector('.stage').getBoundingClientRect();
      const s = r.width / 1280;
      return { x: r.left + x * s, y: r.top + y * s };
    }, [x, y]);
  const center = sel =>
    ev(sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);

  const cdp = vp.ctx.hasTouch ? await context.newCDPSession(page) : null;
  /** Press at `from`, move to `to` (client px) and hold. Returns release(). */
  async function dragHold(from, to) {
    const steps = 12;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] });
        await sleep(16);
      }
      return () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    return () => page.mouse.up();
  }
  async function tap(p) {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await sleep(30);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(p.x, p.y);
  }

  await page.goto(BASE);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  await sleep(300);
  await shot('preset');

  // preset interaction: tap a pet card to focus it (detail panel switches to the pet)
  await tap(await center('.ps-grid-pets .ps-card:nth-child(5)'));
  await sleep(150);
  await shot('preset-pet');
  await tap(await center('.ps-grid-pets .ps-card:nth-child(5)')); // toggle back

  // start through the real button, then restart with a fixed seed for stable shots
  await tap(await center('.btn-start'));
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  check(true, `${vp.name}: 출발 button starts a run`);
  await ev(() => window.__proto.startRun({ seed: 4242 }));
  await sleep(4500);
  await shot('combat');

  // tap (no drag) on a card → hint toast
  await tap(await center('.ccard[data-idx="1"]'));
  await sleep(120);
  const hintToast = await ev(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|'));
  check(hintToast.includes('필드로 드래그'), `${vp.name}: tap on card shows drag hint (${hintToast})`);

  // drag card 2 onto the field and hold (drag in progress)
  const before = await ev(() => window.__proto.game.state.players[0].activeIndex);
  const fromCard = await center('.ccard[data-idx="1"]');
  const release = await dragHold(fromCard, await toClient(560, 470));
  await sleep(250);
  const dragInfo = await ev(() => ({
    ghost: !document.querySelector('.drag-ghost').classList.contains('is-hidden'),
    invalid: document.querySelector('.drag-ghost').classList.contains('is-invalid'),
  }));
  check(dragInfo.ghost && !dragInfo.invalid, `${vp.name}: drag ghost visible and valid over field`);
  await shot('drag');
  await release();
  await sleep(300);
  const after = await ev(() => window.__proto.game.state.players[0].activeIndex);
  check(before === 0 && after === 1, `${vp.name}: drop swaps character (${before} → ${after})`);

  // within the 0.5 s appear lock every card is refused
  await tap(await center('.ccard[data-idx="0"]'));
  await sleep(80);
  // swap back to slot 1 → slot 2 is now benched with its re-appear cooldown → refused with the countdown
  await sleep(700);
  await ev(() => window.__proto.ui.dragTo('swap', 0, { x: 14, y: 7 }));
  await sleep(700);
  await tap(await center('.ccard[data-idx="1"]'));
  await sleep(120);
  const cdToast = await ev(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|'));
  check(cdToast.includes('재등장 대기'), `${vp.name}: cooling card refuses with reason (${cdToast})`);
  await shot('cooldown');

  // pet drag, released over the HUD (cards) → cancelled, cooldown unused
  const petFrom = await center('.pcard:nth-child(1)');
  let rel = await dragHold(petFrom, await toClient(640, 640));
  await sleep(120);
  await shot('drag-invalid');
  await rel();
  await sleep(150);
  const petCd = await ev(() => window.__proto.game.state.players[0].pets[0].cooldownRemaining);
  check(petCd === 0, `${vp.name}: release over HUD cancels pet (cd ${petCd})`);
  // pet drag onto the field → used
  rel = await dragHold(petFrom, await toClient(820, 450));
  await sleep(150);
  await shot('drag-pet');
  await rel();
  await sleep(200);
  const petCd2 = await ev(() => window.__proto.game.state.players[0].pets[0].cooldownRemaining);
  check(petCd2 > 0, `${vp.name}: pet dropped on field is used (cd ${petCd2.toFixed(1)})`);

  // ult: charge via debug, wait, screenshot glowing gauge, tap it
  await ev(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }));
  await sleep(500);
  await shot('ult-ready');
  await tap(await center('.ult'));
  await sleep(100);
  const ultCharge = await ev(() => window.__proto.game.state.players[0].ult.charge);
  check(ultCharge < 0.1, `${vp.name}: tapping full ult gauge uses ult (${ultCharge.toFixed(2)})`);

  // debug panel via DBG button
  await tap(await center('.btn-dbg'));
  await sleep(200);
  await shot('debug');
  await tap(await center('.debug-panel .dbg-hbtn')); // collapse
  await sleep(100);
  await shot('debug-collapsed');
  await tap(await center('.debug-panel .dbg-hbtn:last-child')); // close

  // pause menu
  await tap(await center('.hud-tr .icon-btn:last-child'));
  await sleep(150);
  check(await ev(() => window.__proto.paused), `${vp.name}: gear pauses`);
  await shot('pause');
  await tap(await center('.pause-btns .btn-primary'));
  await sleep(100);

  // reward overlay
  await ev(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }));
  await page.waitForFunction(() => window.__proto.phase === 'reward');
  await sleep(500);
  await shot('reward');
  await tap(await center('.rw-card:nth-child(2)'));
  await page.waitForFunction(() => window.__proto.phase === 'combat');
  check((await ev(() => window.__proto.game.state.floor)) === 2, `${vp.name}: choosing a reward starts floor 2`);

  // field empty hint: swap away, then kill the active character with huge monster damage
  await ev(() => {
    const g = window.__proto.game;
    g.tunables.monsterDmgMult = 60;
  });
  await page.waitForFunction(() => window.__proto.game.state.players[0].activeIndex === null, null, { timeout: 30000 });
  await ev(() => (window.__proto.game.tunables.monsterDmgMult = 1));
  await sleep(400);
  await shot('field-empty');

  // boss floor (+ enrage + relic reward)
  await ev(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 5 } }));
  await sleep(300);
  await ev(() => {
    const g = window.__proto.game;
    const me = g.state.players[0];
    const idx = me.party.findIndex(m => !m.dead);
    if (me.activeIndex == null && idx >= 0) {
      g.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
      window.__proto.ui.dragTo('swap', idx, { x: 12, y: 7 });
    }
  });
  await sleep(5000);
  await shot('boss');
  await ev(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }));
  await sleep(700);
  await shot('boss-enraged');
  await ev(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }));
  await page.waitForFunction(() => window.__proto.phase === 'reward');
  await sleep(500);
  await shot('reward-relic');
  const relicTags = await ev(() => document.querySelectorAll('.rw-relic').length);
  check(relicTags === 3, `${vp.name}: boss floor offers 3 relics (${relicTags})`);
  await tap(await center('.rw-card:nth-child(1)'));
  await page.waitForFunction(() => window.__proto.phase === 'combat');

  // spectate: kill my whole party with huge damage while bots are invincible-ish (bots keep going)
  await ev(() => {
    const g = window.__proto.game;
    g.tunables.monsterDmgMult = 200;
  });
  // keep dropping whoever is alive onto the nearest enemy so all three die
  for (let i = 0; i < 160; i++) {
    const out = await ev(() => {
      const g = window.__proto.game;
      const s = g.state;
      const me = s.players[0];
      if (me.out || s.phase !== 'combat') return true;
      if (me.activeIndex == null) {
        g.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
        const idx = me.party.findIndex(m => !m.dead);
        const foe = s.entities.find(e => e.team === 'enemy' && e.hp > 0 && e.tier !== 'boss');
        if (idx >= 0) window.__proto.ui.dragTo('swap', idx, foe ? foe.pos : { x: s.plan.arena.width / 2, y: 6 });
      }
      return false;
    });
    if (out) break;
    await sleep(250);
  }
  await ev(() => (window.__proto.game.tunables.monsterDmgMult = 1));
  const ph = await ev(() => window.__proto.phase);
  await sleep(600);
  await shot('spectate');
  check(ph === 'spectate' || ph === 'result', `${vp.name}: all my characters dead → ${ph}`);

  // result
  if (ph === 'spectate') {
    // the bots may wipe too (run over → result comes by itself); otherwise tap 결과 보기
    await page.waitForFunction(() => window.__proto.phase === 'result' || document.querySelector('.spectate-box')?.offsetParent != null, null, { timeout: 5000 }).catch(() => {});
  }
  if ((await ev(() => window.__proto.phase)) === 'spectate') {
    const btn = await center('.spectate-box .btn');
    const hit = await ev(p => document.elementFromPoint(p.x, p.y)?.className ?? null, btn);
    report.push(`     spectate button hit-test: ${hit}`);
    await tap(btn);
  }
  try {
    await page.waitForFunction(() => window.__proto.phase === 'result', null, { timeout: 10000 });
  } catch {
    const st = await ev(() => ({ phase: window.__proto.phase, paused: window.__proto.paused, sim: window.__proto.game?.state.phase }));
    check(false, `${vp.name}: result screen did not appear ${JSON.stringify(st)}`);
    await shot('result-timeout');
    await context.close();
    continue;
  }
  await sleep(400);
  await shot('result');

  // back to preset; preset remembered
  await tap(await center('.rs-foot .btn-secondary'));
  await page.waitForFunction(() => window.__proto.phase === 'preset');
  check(true, `${vp.name}: 프리셋으로 returns to preset`);

  // portrait overlay (phone only)
  if (vp.name === 'phone') {
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(250);
    await shot('portrait');
    const rot = await ev(() => !document.querySelector('.rotate-overlay').classList.contains('is-hidden'));
    check(rot, 'phone: portrait shows rotate overlay');
    await page.setViewportSize({ width: 844, height: 390 });
  }

  check(errors.length === 0, `${vp.name}: no console/page errors ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
  await context.close();
}

await browser.close();
console.log(report.join('\n'));
console.log(failures ? `${failures} FAILED` : 'ALL OK');
process.exit(failures ? 1 : 0);
