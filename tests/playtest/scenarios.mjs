// Focused playtest scenarios with real input. Usage: node tests/playtest/scenarios.mjs [phone|desktop] [which=all]
//  boss    — jump to 5F through the debug panel's real buttons; 1× pattern watch, then natural 90 s enrage at 4×, fight on
//  force   — 5F at 1×, tap the debug "광폭화" button mid-fight, watch the enrage moment
//  empty   — make my field empty while the other cards cool down (monsterDmgMult 3), then all dead → spectate
//  swapdiag — 30 rapid real swaps at 2× with pointer/toast instrumentation (why do some drags not start?)
// 기획 10차: boss/force/empty jump to 5F (earlier 괴담 rooms skipped → GOEDAM forced off, slider 0); swapdiag plays from
// 1F and passes rooms with real taps by GOEDAM (lib.mjs goedamPolicy, default leave).

import fs from 'node:fs';
import {
  BASE, armGoedam, center, clusterFinger, closePanel, frameStats, goedamPolicy, launch, now, passGoedam, readyCard, realSwap,
  setSpeedViaPanel, sleep, snap, tapDebugAction, tapUlt, waitPhase,
} from './lib.mjs';

const profile = process.argv[2] ?? 'phone';
const which = process.argv[3] ?? 'all';
const out = { profile };
const L = (...a) => console.log(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

/** startFloor > 1: the scenario jumps there, so its 괴담 policy is forced off (pt.goedam). */
async function boot(tag, seed, startFloor = 1) {
  const pt = await launch(profile, { tag });
  await pt.page.goto(BASE);
  await waitPhase(pt.page, 'preset');
  await pt.input.tap(await center(pt.page, '.btn-start'));
  await waitPhase(pt.page, 'combat');
  if (seed != null) {
    await pt.page.evaluate(s => window.__proto.startRun({ seed: s }), seed);
    await waitPhase(pt.page, 'combat');
  }
  pt.goedam = goedamPolicy(undefined, startFloor);
  await armGoedam(pt.page, pt.goedam);
  // instrumentation: toasts + pointer lifecycle on cards
  await pt.page.evaluate(() => {
    const w = window;
    w.__toasts = [];
    w.__ptr = [];
    new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) w.__toasts.push([performance.now(), n.textContent]);
    }).observe(document.body, { childList: true, subtree: true });
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'gotpointercapture']) {
      document.addEventListener(t, e => {
        const el = e.target;
        if (el?.closest?.('.ccard,.pcard')) w.__ptr.push([performance.now(), t, e.pointerType, el.closest('.ccard,.pcard').className]);
      }, true);
    }
  });
  return pt;
}

async function jumpFloorViaPanel(pt, floor) {
  const { page, input } = pt;
  await input.tap(await center(page, '.btn-dbg'));
  await page.waitForSelector('.debug-panel:not(.is-hidden)');
  for (let k = 0; k < 25; k++) {
    const cur = Number((await page.locator('.dbg-floor').textContent()).replace(/[^0-9]/g, ''));
    if (cur === floor) break;
    const btn = page.locator('.dbg-step', { hasText: cur < floor ? '+' : '−' }).first();
    const b = await btn.boundingBox();
    await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    await sleep(40);
  }
  const go = page.locator('.dbg-go').first();
  const b = await go.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(150);
  return page.evaluate(() => window.__proto.game.state.floor);
}

/** Play: swap every gapSimSec of sim time onto clusters (boss included), ult when full. Calls onTick(s) each loop. */
async function play(pt, { untilFn, maxRealMs, gapSimSec = 4, onTick, noSwap = false }) {
  const { page } = pt;
  const t0 = Date.now();
  let lastSwapSim = -99;
  while (Date.now() - t0 < maxRealMs) {
    const s = await snap(page);
    if (!s || (await untilFn(s))) return s;
    if (onTick) await onTick(s);
    if (!noSwap && s.phase === 'combat' && !s.me.out) {
      if (s.me.ult >= 1 && s.me.active != null) await tapUlt(pt);
      if (s.time - lastSwapSim >= gapSimSec || s.me.active == null) {
        const i = await readyCard(page, [0, 1, 2].filter(k => k !== s.me.active));
        if (i >= 0) {
          const r = await realSwap(pt, i, { opts: { radius: 2.5, includeBoss: true } });
          if (r.ok) lastSwapSim = s.time;
        }
      }
    }
    await sleep(150);
  }
  return snap(page);
}

async function bossScenario() {
  const pt = await boot(`${profile}-boss`, 777, 5);
  const { page } = pt;
  const rec = { telegraphs: [], deaths: [] };
  try {
    const f = await jumpFloorViaPanel(pt, 5);
    await setSpeedViaPanel(pt, 1);
    await closePanel(pt);
    L('jumped to floor', f);
    await sleep(300);
    await pt.shot('start', 'boss floor start at 1x');
    const seen = new Set();
    const t0 = await now(page);
    // 1× for ~35 s: one screenshot per distinct boss pattern while telegraphed
    await play(pt, {
      maxRealMs: 36000,
      untilFn: s => s.phase !== 'combat',
      onTick: async s => {
        const tg = await page.evaluate(() => {
          const st = window.__proto.game.state;
          return st.telegraphs.filter(t => t.team === 'enemy').map(t => ({ shape: t.area.shape, r: t.area.radius ?? t.area.length, rem: +t.remaining.toFixed(2), tot: t.total }));
        });
        for (const t of tg) {
          const key = `${t.shape}-${t.r}`;
          if (!seen.has(key)) {
            seen.add(key);
            rec.telegraphs.push({ ...t, at: s.floorTime });
            await pt.shot(`tele-${key}`, `boss telegraph ${key} remaining ${t.rem}/${t.tot}s`);
          }
        }
        const summons = await page.evaluate(() => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss').length);
        if (summons >= 3 && !seen.has('summons')) {
          seen.add('summons');
          await pt.shot('summons', `boss summons alive=${summons}`);
        }
      },
    });
    rec.fps1x = await frameStats(page, t0, await now(page));
    const s1 = await snap(page);
    rec.after1x = { t: s1.floorTime, boss: s1.boss, me: s1.me.party };
    L('after 1x', rec.after1x);
    // now 4× until natural enrage (90 s) and beyond
    await setSpeedViaPanel(pt, 4);
    await closePanel(pt);
    let enrShots = 0;
    const tEnr0 = Date.now();
    const sEnd = await play(pt, {
      maxRealMs: 70000,
      gapSimSec: 5,
      untilFn: s => s.phase !== 'combat',
      onTick: async s => {
        if (s.enraged && enrShots === 0) {
          enrShots++;
          rec.enrage = { t: s.floorTime, boss: s.boss };
          // drop back to 1× to look at it
          await setSpeedViaPanel(pt, 1);
          await closePanel(pt);
          await pt.shot('enrage-0', `enrage t=${s.floorTime} hp=${s.boss?.hp}/${s.boss?.max}`);
          await sleep(1200);
          await pt.shot('enrage-1s', 'enrage +1.2 s');
          await sleep(4000);
          await pt.shot('enrage-5s', 'enrage +5 s (timer area)');
          await setSpeedViaPanel(pt, 4);
          await closePanel(pt);
        }
        s.me.party.forEach((m, i) => {
          if (m.dead && !rec.deaths.some(d => d.i === i && Math.abs(d.t - s.floorTime) < 20)) rec.deaths.push({ i, id: m.id, t: s.floorTime });
        });
      },
    });
    rec.end = { phase: sEnd?.phase, app: sEnd?.app, t: sEnd?.floorTime, boss: sEnd?.boss, result: sEnd?.runResult, bots: sEnd?.bots, realSec: (Date.now() - tEnr0) / 1000 };
    L('boss end', rec.end);
    await sleep(300);
    await pt.shot('end', `end phase=${sEnd?.app}`);
  } catch (e) {
    L('boss ERR', String(e?.stack ?? e));
    await pt.shot('error').catch(() => {});
  }
  rec.errors = pt.errors;
  rec.shots = pt.shots;
  out.boss = rec;
  await pt.browser.close();
}

async function forceScenario() {
  const pt = await boot(`${profile}-force`, 4242, 5);
  const { page } = pt;
  const rec = {};
  try {
    await jumpFloorViaPanel(pt, 5);
    await setSpeedViaPanel(pt, 2);
    await closePanel(pt);
    await play(pt, { maxRealMs: 9000, untilFn: s => s.phase !== 'combat' });
    await setSpeedViaPanel(pt, 1);
    await tapDebugAction(pt, '광폭화');
    await closePanel(pt);
    await sleep(100);
    await pt.shot('enrage-banner', 'forced enrage +0.1 s');
    await sleep(700);
    await pt.shot('enrage-0.8s', 'forced enrage +0.8 s');
    const s = await snap(page);
    rec.state = { t: s.floorTime, boss: s.boss, enraged: s.enraged, timer: await page.locator('.timer').textContent(), bossBox: await page.locator('.boss').getAttribute('class') };
    // look at enraged pattern cadence: count telegraphs over 20 sim s at 2×
    await setSpeedViaPanel(pt, 2);
    await closePanel(pt);
    let n = 0;
    const seenIds = new Set();
    const t0 = Date.now();
    await play(pt, {
      maxRealMs: 10000,
      untilFn: s2 => s2.phase !== 'combat',
      onTick: async () => {
        const ids = await page.evaluate(() => window.__proto.game.state.telegraphs.filter(t => t.team === 'enemy').map(t => t.id));
        for (const id of ids) if (!seenIds.has(id)) (seenIds.add(id), n++);
      },
    });
    rec.enragedTelegraphsPer10sReal = n;
    rec.realSec = (Date.now() - t0) / 1000;
    await pt.shot('enraged-fight', 'enraged fight');
  } catch (e) {
    L('force ERR', String(e?.stack ?? e));
  }
  rec.errors = pt.errors;
  rec.shots = pt.shots;
  out.force = rec;
  await pt.browser.close();
}

async function emptyScenario() {
  const pt = await boot(`${profile}-empty`, 99, 5);
  const { page } = pt;
  const rec = {};
  try {
    // boss floor (real debug-panel taps), swap twice (puts 2 cards on cooldown), then crank monster damage so the 3rd dies
    await jumpFloorViaPanel(pt, 5);
    await closePanel(pt);
    await sleep(800);
    for (const i of [1, 2]) {
      await sleep(700);
      const r = await realSwap(pt, i, { opts: { radius: 2.5, includeBoss: true } });
      L('swap', i, r.ok);
    }
    await page.evaluate(() => {
      const g = window.__proto.game;
      g.tunables.monsterDmgMult = 3;
      g.tunables.reviveTime = 60;
      g.tunables.invincible = false;
      // let the bots carry less so the scenario resolves
      g.tunables.botDamageMult = 0.3;
    });
    // wait until my field is empty
    await page.waitForFunction(() => {
      const me = window.__proto.game.state.players[0];
      return me.activeIndex == null || me.out;
    }, undefined, { timeout: 60000 });
    await sleep(250);
    const s = await snap(page);
    rec.atEmpty = { t: s.floorTime, party: s.me.party };
    rec.hint = await page.locator('.empty-hint').textContent().catch(() => null);
    rec.hintVisible = await page.locator('.empty-hint:not(.is-hidden)').count();
    await pt.shot('empty-field', 'my field empty');
    // keep refusing to swap: try a real drag of a cooling card to see the refusal
    const cooling = s.me.party.findIndex(m => !m.dead && m.cd > 0);
    if (cooling >= 0) {
      const target = await clusterFinger(page, {});
      const rel = await pt.input.dragHold(await center(page, `.ccard[data-idx="${cooling}"]`), target.finger);
      await sleep(150);
      await pt.shot('drag-cooling-card', 'dragging a card that is still cooling');
      await rel();
      await sleep(200);
      await pt.shot('drag-cooling-after', 'after releasing a cooling card');
      rec.toastsAfterCoolingDrag = await page.evaluate(() => window.__toasts.slice(-3).map(t => t[1]));
    }
    // now never swap again → all die → spectate
    await page.waitForFunction(() => window.__proto.phase === 'spectate' || window.__proto.phase === 'result', undefined, { timeout: 120000 }).catch(() => {});
    rec.phaseAfter = await page.evaluate(() => window.__proto.phase);
    await sleep(300);
    await pt.shot('spectate', `phase=${rec.phaseAfter}`);
  } catch (e) {
    L('empty ERR', String(e?.stack ?? e));
    await pt.shot('error').catch(() => {});
  }
  rec.errors = pt.errors;
  rec.shots = pt.shots;
  out.empty = rec;
  await pt.browser.close();
}

async function swapDiag() {
  const pt = await boot(`${profile}-diag`, 31337);
  const { page } = pt;
  const rec = { attempts: [] };
  try {
    await setSpeedViaPanel(pt, 2);
    await closePanel(pt);
    await page.evaluate(() => (window.__proto.game.tunables.invincible = true));
    for (let k = 0; k < 30; k++) {
      const s = await snap(page);
      if (s.app === 'reward') {
        await sleep(400);
        const b = await page.locator('.rw-card').first().boundingBox();
        await pt.input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
        await sleep(400);
        continue;
      }
      if (s.app === 'goedam') {
        const room = await passGoedam(pt, pt.goedam);
        L('goedam', room?.roomId, room?.optionId, '→', room?.outcome.id);
        continue;
      }
      const i = await readyCard(page, [0, 1, 2].filter(x => x !== s.me.active));
      if (i < 0) {
        await sleep(300);
        continue;
      }
      const tMark = await now(page);
      const r = await realSwap(pt, i, { opts: { radius: 2.5 } });
      const dbg = await page.evaluate(t => ({
        toasts: window.__toasts.filter(x => x[0] >= t).map(x => x[1]),
        ptr: window.__ptr.filter(x => x[0] >= t).map(x => x[1] + ':' + x[2]),
        phase: window.__proto.phase,
      }), tMark);
      rec.attempts.push({ k, i, ok: r.ok, hold: r.holdInfo, ...dbg, floorT: s.floorTime });
      if (!r.ok) {
        L('DIAG FAIL', rec.attempts[rec.attempts.length - 1]);
        await pt.shot(`fail-${k}`, 'failed drag');
      }
      await sleep(900);
    }
  } catch (e) {
    L('diag ERR', String(e?.stack ?? e));
  }
  rec.fails = rec.attempts.filter(a => !a.ok).length;
  rec.errors = pt.errors;
  out.diag = rec;
  await pt.browser.close();
}

if (which === 'all' || which === 'boss') await bossScenario();
if (which === 'all' || which === 'force') await forceScenario();
if (which === 'all' || which === 'empty') await emptyScenario();
if (which === 'all' || which === 'swapdiag') await swapDiag();
fs.writeFileSync(`/tmp/playtest-${profile}-scenarios-${which}.json`, JSON.stringify(out, null, 1));
L('done');
