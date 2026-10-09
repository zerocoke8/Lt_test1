// Playtest helpers (designer/QA pass). Plain ESM so it runs with `node tests/playtest/<script>.mjs`.
// Assumes `npx vite preview --port 4174 --strictPort` is serving dist/.
// Real input only: CDP touch events on the phone profile, the mouse on desktop.

import { chromium } from '@playwright/test';

export const BASE = process.env.PT_BASE ?? 'http://localhost:4174/';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const PROFILES = {
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  /** Same phone, but DPR = 3 × stage scale 0.5417 ≈ 1.625: what the backing store would be if sized to the displayed canvas. */
  phone16: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1.625, isMobile: true, hasTouch: true },
};

/** In-page probes: rAF frame deltas (always on), long tasks, errors. */
function initProbe() {
  const p = { frames: [], marks: [], last: 0, longTasks: 0 };
  window.__pt = p;
  const tick = now => {
    if (p.last > 0) p.frames.push([now, now - p.last]);
    p.last = now;
    if (p.frames.length > 40000) p.frames.splice(0, 20000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(l => (p.longTasks += l.getEntries().length)).observe({ type: 'longtask', buffered: false });
  } catch {}
}

export async function launch(profileName, { tag = profileName } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });
  const context = await browser.newContext(PROFILES[profileName]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.addInitScript(initProbe);
  const touch = profileName.startsWith('phone');
  const cdp = touch ? await context.newCDPSession(page) : null;
  const touchEv = (type, p) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });

  const input = {
    async tap(p) {
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    },
    /** Press at from, slide to to (steps×16ms), keep holding. Returns release(). */
    async dragHold(from, to, steps = 12) {
      if (touch) {
        await touchEv('touchStart', from);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await touchEv('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
          await sleep(16);
        }
        return async () => touchEv('touchEnd', to);
      }
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps });
      return async () => page.mouse.up();
    },
    async moveTo(p) {
      if (touch) await touchEv('touchMove', p);
      else await page.mouse.move(p.x, p.y);
    },
  };

  let shotN = 0;
  const shots = [];
  const shot = async (name, note = '') => {
    const path = `/tmp/playtest-${tag}-${String(++shotN).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path });
    shots.push({ path, note });
    return path;
  };
  return { browser, context, page, input, errors, shot, shots, touch, profileName };
}

export async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function box(page, selector) {
  return page.locator(selector).first().boundingBox();
}

export const phase = page => page.evaluate(() => window.__proto?.phase);

export async function waitPhase(page, want, timeout = 20000) {
  await page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}

/** Compact state snapshot. */
export function snap(page) {
  return page.evaluate(() => {
    const g = window.__proto?.game;
    if (!g) return null;
    const s = g.state;
    const me = s.players[0];
    const boss = s.bossId != null ? s.entities.find(e => e.id === s.bossId) : null;
    return {
      phase: s.phase,
      app: window.__proto.phase,
      floor: s.floor,
      kind: s.plan.kind,
      floorTime: +s.floorTime.toFixed(2),
      time: +s.time.toFixed(2),
      timeRemaining: +s.timeRemaining.toFixed(1),
      alive: s.monstersAlive,
      waves: s.wavesRemaining,
      mid: s.midBossSpawned,
      boss: boss ? { hp: Math.round(boss.hp), max: Math.round(boss.maxHp) } : null,
      enraged: s.bossEnraged,
      speed: g.tunables.gameSpeed,
      me: {
        active: me.activeIndex,
        out: me.out,
        ult: +(me.activeIndex != null ? me.party[me.activeIndex].ult.charge : 0).toFixed(2), // the field character's gauge
        party: me.party.map(m => ({ id: m.defId, hp: Math.round(m.hp), max: Math.round(m.maxHp), dead: m.dead, cd: +m.swapCooldownRemaining.toFixed(1), rv: +m.reviveRemaining.toFixed(1) })),
        pets: me.pets.map(p => +p.cooldownRemaining.toFixed(1)),
        stats: { swaps: me.stats.swaps, ults: me.stats.ultsUsed, pets: me.stats.petsUsed, kills: me.stats.kills, dmg: Math.round(me.stats.damageDealt), taken: Math.round(me.stats.damageTaken) },
      },
      bots: s.players.slice(1).map(p => ({ out: p.out, active: p.activeIndex, dead: p.party.filter(m => m.dead).length, swaps: p.stats.swaps, dmg: Math.round(p.stats.damageDealt) })),
      runResult: s.runResult,
    };
  });
}

/**
 * Finger (client px) whose drop point (80 logical px above) hits the densest enemy cluster on screen,
 * and the finger itself is over bare canvas. Falls back to near my character.
 * opts.radius = cluster radius (world units); opts.avoidBoss.
 */
export function clusterFinger(page, opts = {}) {
  return page.evaluate(o => {
    const api = window.__proto;
    const g = api.game;
    const s = g.state;
    const canvas = document.querySelector('canvas.stage-canvas');
    const R = o.radius ?? 2.5;
    const me = s.players[0];
    const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex].entityId) : null;
    const foes = s.entities.filter(e => e.team === 'enemy' && e.hp > 0 && (o.includeBoss || e.tier !== 'boss'));
    const cands = [];
    for (const f of foes) {
      let n = 0;
      for (const q of foes) if (Math.hypot(q.pos.x - f.pos.x, q.pos.y - f.pos.y) <= R) n += q.tier === 'mid' ? 2 : 1;
      cands.push({ w: f.pos, n });
    }
    cands.sort((a, b) => b.n - a.n);
    const from = mine?.pos ?? { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 };
    cands.push({ w: { x: from.x + 1.5, y: from.y - 1 }, n: 0 }, { w: { x: from.x, y: from.y - 2 }, n: 0 }, { w: from, n: 0 });
    if (o.bossPoint && s.bossId != null) cands.unshift({ w: { x: s.plan.arena.width / 2, y: 1.2 }, n: 99 });
    for (const c of cands) {
      const f = api.ui.fingerFor(c.w);
      if (f.x < 20 || f.x > window.innerWidth - 20 || f.y < 10 || f.y > window.innerHeight - 4) continue;
      if (document.elementFromPoint(f.x, f.y) !== canvas) continue;
      return { finger: f, world: c.w, n: c.n };
    }
    return null;
  }, opts);
}

/** Frame stats for frames whose timestamp is in [t0, t1] (performance.now ms). */
export function frameStats(page, t0, t1) {
  return page.evaluate(
    ([a, b]) => {
      const fr = window.__pt.frames.filter(([t]) => t >= a && t <= b).map(([, d]) => d);
      if (!fr.length) return null;
      const sorted = [...fr].sort((x, y) => x - y);
      const sum = fr.reduce((x, y) => x + y, 0);
      return {
        frames: fr.length,
        fps: +(fr.length / (sum / 1000)).toFixed(1),
        p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
        p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
        max: +sorted[sorted.length - 1].toFixed(1),
        over33: fr.filter(x => x > 33.4).length,
        over50: fr.filter(x => x > 50).length,
        longTasks: window.__pt.longTasks,
      };
    },
    [t0, t1],
  );
}

export const now = page => page.evaluate(() => performance.now());

/** Open debug panel through the real DBG button, set speed via its real button, then close it with ✕. */
export async function setSpeedViaPanel(pt, speed) {
  const { page, input } = pt;
  const open = await page.locator('.debug-panel:not(.is-hidden)').count();
  if (!open) await input.tap(await center(page, '.btn-dbg'));
  await page.waitForSelector('.debug-panel:not(.is-hidden)');
  const btn = page.locator('.dbg-speed', { hasText: `${speed}×` }).first();
  const b = await btn.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(100);
  return page.evaluate(() => window.__proto.game.tunables.gameSpeed);
}

export async function closePanel(pt) {
  const { page, input } = pt;
  if (!(await page.locator('.debug-panel:not(.is-hidden)').count())) return;
  const x = page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).first();
  const b = await x.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(80);
}

export async function tapDebugAction(pt, label) {
  const { page, input } = pt;
  if (!(await page.locator('.debug-panel:not(.is-hidden)').count())) await input.tap(await center(page, '.btn-dbg'));
  await page.waitForSelector('.debug-panel:not(.is-hidden)');
  const btn = page.locator('.debug-panel .dbg-btn', { hasText: label }).first();
  await btn.scrollIntoViewIfNeeded();
  const b = await btn.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(80);
}

/** Card index ready to swap (not active, not dead, cooldown 0), preferring `prefer`. */
export function readyCard(page, prefer = []) {
  return page.evaluate(pr => {
    const g = window.__proto.game;
    const ok = i => g.canSwap(0, i).ok;
    for (const i of pr) if (ok(i)) return i;
    for (let i = 0; i < 3; i++) if (ok(i)) return i;
    return -1;
  }, prefer);
}

export function readyPet(page) {
  return page.evaluate(() => {
    const g = window.__proto.game;
    for (let i = 0; i < 3; i++) if (g.canUsePet(0, i).ok) return i;
    return -1;
  });
}

/**
 * One real swap: drag card i onto the best cluster. Optionally screenshot while holding / after landing.
 * Returns {ok, world, n, before, after}.
 */
export async function realSwap(pt, i, { holdShot, landShots = [], holdMs = 120, opts = {} } = {}) {
  const { page, input } = pt;
  const target = await clusterFinger(page, opts);
  if (!target) return { ok: false, why: 'no target' };
  const from = await center(page, `.ccard[data-idx="${i}"]`);
  const before = await page.evaluate(() => window.__proto.game.state.players[0].activeIndex);
  const release = await input.dragHold(from, target.finger);
  await sleep(holdMs);
  const holdInfo = await page.evaluate(() => {
    const gh = document.querySelector('.drag-ghost');
    return { ghost: gh && !gh.classList.contains('is-hidden'), invalid: gh?.classList.contains('is-invalid') };
  });
  if (holdShot) await pt.shot(holdShot, 'holding drag');
  await release();
  const t0 = Date.now();
  for (const [name, ms] of landShots) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await pt.shot(name, `+${ms}ms after drop`);
  }
  await sleep(30);
  const after = await page.evaluate(() => window.__proto.game.state.players[0].activeIndex);
  return { ok: after === i && before !== i, world: target.world, n: target.n, before, after, holdInfo };
}

export async function realPet(pt, i, { shotName, opts = {} } = {}) {
  const { page, input } = pt;
  const target = await clusterFinger(page, { radius: 3, ...opts });
  if (!target) return { ok: false };
  const before = await page.evaluate(k => window.__proto.game.state.players[0].pets[k].cooldownRemaining, i);
  const release = await input.dragHold(await center(page, `.pcard:nth-child(${i + 1})`), target.finger);
  await sleep(80);
  if (shotName) await pt.shot(shotName, 'pet drag hold');
  await release();
  await sleep(40);
  const after = await page.evaluate(k => window.__proto.game.state.players[0].pets[k].cooldownRemaining, i);
  return { ok: after > before, n: target.n };
}

export async function tapUlt(pt) {
  const { page, input } = pt;
  const before = await page.evaluate(() => window.__proto.game.state.players[0].stats.ultsUsed);
  await input.tap(await center(page, '.ult'));
  await sleep(40);
  const after = await page.evaluate(() => window.__proto.game.state.players[0].stats.ultsUsed);
  return after > before;
}

/** Pick reward card by real tap (best rarity first, then first). Returns the picked offer. */
export async function pickReward(pt, pref = 0) {
  const { page, input } = pt;
  await page.waitForSelector('.rw-card', { timeout: 15000 });
  await sleep(450); // cards animate in
  const offers = await page.evaluate(() => window.__proto.game.state.rewardOffers);
  const cards = page.locator('.rw-card');
  const n = await cards.count();
  const idx = Math.min(pref, n - 1);
  const b = await cards.nth(idx).boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(150);
  return offers?.[idx] ?? null;
}

/** Bounding boxes of the main HUD blocks (client px). */
export function hudBoxes(page) {
  return page.evaluate(() => {
    const out = {};
    const sel = {
      bots: '.hud-tl',
      top: '.hud-tc',
      tr: '.hud-tr',
      cards: '.hud-bl',
      ult: '.hud-bc',
      pets: '.hud-br',
      stage: '.stage',
      ccard0: '.ccard[data-idx="0"]',
      ccard1: '.ccard[data-idx="1"]',
      ccard2: '.ccard[data-idx="2"]',
      pcard0: '.pcard',
      ultBtn: '.ult',
      gear: '.hud-tr .icon-btn:last-child',
      dbg: '.btn-dbg',
      timer: '.timer',
    };
    for (const [k, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[k] = { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    }
    out.vw = innerWidth;
    out.vh = innerHeight;
    return out;
  });
}

// ─────────────────────────── 괴담 rooms (기획 10차) ───────────────────────────
// GOEDAM=off|leave|random|first|forced:<room>:<option> (env, default leave). The headless benches have the same knob
// plus 'greedy' (goedam-policy.ts); here 'greedy' falls back to 'leave'. A run that starts mid-way skips the earlier
// rooms, so callers pass start > 1 to force 'off'.

/** GOEDAM env → { kind, room?, option?, name }. */
export function goedamPolicy(raw = process.env.GOEDAM, start = 1) {
  const name = (raw ?? 'leave').trim() || 'leave';
  if (start > 1 && name !== 'off') {
    console.warn(`[goedam] start floor ${start}: earlier rooms are skipped, GOEDAM=${name} forced to 'off'`);
    return { kind: 'off', name: 'off' };
  }
  if (name.startsWith('forced:')) {
    const [, room, option] = name.split(':');
    return { kind: 'forced', room, option, name };
  }
  if (name === 'greedy') console.warn("[goedam] GOEDAM=greedy is headless only (goedam-policy.ts): using 'leave'");
  return { kind: ['off', 'random', 'first'].includes(name) ? name : 'leave', name };
}

/**
 * Right after a run starts: 'off' moves the 괴담 slider to 0 (the same tunables command the debug slider sends);
 * 'forced' also arms the room once (debug goedamNext → it opens after this floor's clear).
 */
export async function armGoedam(page, pol) {
  if (pol.kind !== 'off' && pol.kind !== 'forced') return;
  await page.evaluate(
    p => {
      const g = window.__proto.game;
      g.dispatch({ type: 'tunables', patch: { goedamRoomsPerZone: 0 } });
      if (p.kind === 'forced') g.dispatch({ type: 'debug', action: { kind: 'goedamNext', room: p.room } });
    },
    { kind: pol.kind, room: pol.room },
  );
}

/** The option id the policy takes, from the visible options (random: fixed by seed + floor, like the headless one). */
function goedamChoice(pol, st) {
  const ids = st.options;
  if (pol.kind === 'first') return ids[0];
  if (pol.kind === 'random') return ids[Math.abs((st.seed * 31 + st.floor * 7) | 0) % ids.length];
  if (pol.kind === 'forced' && st.roomId === pol.room && ids.includes(pol.option)) return pol.option;
  return 'leave';
}

/**
 * In a 괴담 room: tap the policy's option button, wait for the result card, tap 계속 (real taps). Solo returns once the
 * next floor started; in multiplayer (`waitOthers` false) it returns at the wait panel. Returns the 수첩 entry.
 */
export async function passGoedam(pt, pol = goedamPolicy(), { shot = null, waitOthers = true } = {}) {
  const { page, input } = pt;
  await page.waitForSelector('.gd-options:not(.is-arming) .gd-opt', { timeout: 15000 }); // option taps count from ARM_MS
  await sleep(400); // the room fades in
  const st = await page.evaluate(() => {
    const api = window.__proto;
    const s = api.game.state;
    const pr = s.goedam?.players[api.localPlayer];
    return pr && { roomId: s.goedam.roomId, floor: s.goedam.floor, seed: s.seed, stage: pr.stage, options: pr.options.filter(o => !o.hidden).map(o => o.id) };
  });
  if (!st) return null;
  if (shot) await pt.shot(`${shot}-room`, `괴담 room ${st.roomId}`);
  if (st.stage === 'choosing') {
    const option = goedamChoice(pol, st);
    await input.tap(await center(page, `.gd-opt[data-option="${option}"]`));
  }
  await page.waitForSelector('.gd-continue', { state: 'visible', timeout: 15000 });
  await sleep(500); // the card turns over
  if (shot) await pt.shot(`${shot}-result`, '괴담 result card');
  await input.tap(await center(page, '.gd-continue'));
  if (waitOthers) await page.waitForFunction(() => window.__proto.game.state.phase !== 'goedam', undefined, { timeout: 40000 });
  return page.evaluate(() => {
    const api = window.__proto;
    const log = api.game.state.players[api.localPlayer].goedamLog;
    return log[log.length - 1] ?? null;
  });
}

/** After a reward pick (solo): pass the floor's 괴담 room if one opened, then wait for combat. Returns the 수첩 entry or null. */
export async function afterReward(pt, pol = goedamPolicy(), opts = {}) {
  const { page } = pt;
  await page.waitForFunction(() => ['combat', 'goedam', 'result', 'spectate'].includes(window.__proto.phase), undefined, { timeout: 15000 }).catch(() => {});
  if ((await phase(page)) !== 'goedam') return null;
  return passGoedam(pt, pol, opts);
}
