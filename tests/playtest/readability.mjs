// Readability playtest (first-time player view). Usage:
//   npx vite preview --port 4195 --strictPort (dist built)   then
//   PT_BASE=http://localhost:4195/ node tests/playtest/readability.mjs <preset A|B|C|D> [floors=3] [noCast]
// Phone 844×390 @3x, real touch (CDP), real preset taps, real drags onto enemy clusters, ult taps, pet drags,
// skill sheet by long-press / tap. Floors 1..N at gameSpeed 1.
// Output: /tmp/read-<preset>-NN-*.png (screenshots), /tmp/read-<preset>-clip-*.png (real-time frame sequences from
// the CDP screencast, cropped around the cast), /tmp/read-<preset>-report.json.
import fs from 'node:fs';
import {
  BASE, center, clusterFinger, frameStats, hudBoxes, launch, now, pickReward, readyCard, readyPet, realPet, sleep, snap, tapUlt, waitPhase,
} from './lib.mjs';

const PRESETS = {
  A: ['블레이드', '메이지', '클레릭'],
  B: ['가디언', '레인저', '바드'],
  C: ['섀도우', '거너', '크로노'],
  D: ['팔라딘', '워든', '버서커'],
};
const key = process.argv[2] ?? 'A';
const FLOORS = Number(process.argv[3] ?? 3);
const CAST = process.argv[4] !== 'noCast';
const names = PRESETS[key];
const P = `/tmp/read-${key}`;
const pt = await launch('phone', { tag: `read-${key}` });
const { page, input, context } = pt;
const report = { preset: key, names, floors: [], swaps: [], sheet: {}, fonts: null, clips: [], counts: {}, errors: pt.errors, notes: [] };
const L = (...a) => console.log(`[${key}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))));

let shotN = 0;
/** Screencast frames that arrive while a screenshot is taken are rescaled by Chrome: drop them from clips. */
let shootingUntil = 0;
async function shot(name, clip) {
  const path = `${P}-${String(++shotN).padStart(2, '0')}-${name}.png`;
  shootingUntil = Infinity;
  try {
    await page.screenshot({ path, ...(clip ? { clip } : {}) });
  } finally {
    shootingUntil = Date.now() + 150;
  }
  return path;
}

// ───────────── screencast ring buffer (real-time frames as the browser composites them) ─────────────
const cdp = await context.newCDPSession(page);
const ring = []; // {ts(ms epoch), data(base64 jpeg)}
const pendingClips = [];
let castOn = false;
cdp.on('Page.screencastFrame', f => {
  const ts = f.metadata.timestamp * 1000;
  if (Date.now() >= shootingUntil && Math.abs(f.metadata.deviceWidth - 844) < 1) ring.push({ ts, data: f.data });
  while (ring.length && ring[0].ts < Date.now() - 6000) ring.shift();
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
async function castStart() {
  if (!CAST || castOn) return;
  castOn = true;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1266, maxHeight: 585, everyNthFrame: 1 });
}
async function castStop() {
  if (!castOn) return;
  castOn = false;
  await cdp.send('Page.stopScreencast').catch(() => {});
}
/** Ask for a clip of [t-before, t+after] ms around wall time t, cropped around client point c (CSS px). */
function requestClip(name, t, c, { before = 250, after = 1800, w = 440, h = 204, every = 110, note = '' } = {}) {
  if (!castOn) return;
  while (clipNames.has(name)) name += '_';
  clipNames.add(name);
  pendingClips.push({ name, t, c, before, after, w, h, every, note });
}
const savedClips = [];
const clipNames = new Set();
function flushClips(force = false) {
  for (let i = pendingClips.length - 1; i >= 0; i--) {
    const q = pendingClips[i];
    if (!force && Date.now() < q.t + q.after + 150) continue;
    pendingClips.splice(i, 1);
    const fr = ring.filter(f => f.ts >= q.t - q.before && f.ts <= q.t + q.after);
    const pick = [];
    let next = -Infinity;
    for (const f of fr) if (f.ts >= next) {
      pick.push(f);
      next = f.ts + q.every;
    }
    if (pick.length) savedClips.push({ ...q, frames: pick.map(f => ({ dt: Math.round(f.ts - q.t), data: f.data })), fps: +(fr.length / ((q.before + q.after) / 1000)).toFixed(1) });
  }
}

/** Tile clips into contact sheets (crop around c), done after the run so it does not disturb play. */
async function writeSheets(browser) {
  const p = await browser.newPage({ viewport: { width: 400, height: 300 } });
  for (const clip of savedClips) {
    const frames = clip.frames.slice(0, 15);
    const b64 = await p.evaluate(
      async ([frames, c, w, h]) => {
        const imgs = await Promise.all(frames.map(f => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = `data:image/jpeg;base64,${f.data}`; })));
        const k0 = imgs[0].width / 844; // frame px per CSS px
        const cw = Math.round(w * k0), ch = Math.round(h * k0);
        const cols = 3;
        const rows = Math.ceil(imgs.length / cols);
        const cv = document.createElement('canvas');
        cv.width = cols * cw + (cols + 1) * 4;
        cv.height = rows * ch + (rows + 1) * 4;
        const g = cv.getContext('2d');
        g.fillStyle = '#333';
        g.fillRect(0, 0, cv.width, cv.height);
        imgs.forEach((im, i) => {
          const x = 4 + (i % cols) * (cw + 4), y = 4 + Math.floor(i / cols) * (ch + 4);
          const k = im.width / 844;
          const sw = w * k, sh = h * k;
          const sx = Math.max(0, Math.min(im.width - sw, c.x * k - sw / 2));
          const sy = Math.max(0, Math.min(im.height - sh, c.y * k - sh / 2));
          g.drawImage(im, sx, sy, sw, sh, x, y, cw, ch);
          g.fillStyle = 'rgba(0,0,0,.75)';
          g.fillRect(x, y, 70, 20);
          g.fillStyle = '#ffeb3b';
          g.font = 'bold 15px sans-serif';
          g.fillText(`${frames[i].dt >= 0 ? '+' : ''}${frames[i].dt}ms`, x + 4, y + 15);
        });
        return cv.toDataURL('image/png').split(',')[1];
      },
      [frames, clip.c, clip.w, clip.h],
    );
    const path = `${P}-clip-${clip.name}.png`;
    fs.writeFileSync(path, Buffer.from(b64, 'base64'));
    report.clips.push({ path, note: clip.note, frames: frames.length, streamFps: clip.fps });
  }
  await p.close();
}

// ───────────── event tap (instrumentation only: wraps game.drainEvents, app still gets every event) ─────────────
async function tapEvents() {
  await page.evaluate(() => {
    const g = window.__proto?.game;
    if (!g || g.__tapped) return;
    window.__ev = window.__ev ?? [];
    window.__cnt = window.__cnt ?? { myAttacks: 0, mySkill: {}, otherSkill: {}, dmgLabels: 0 };
    const orig = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const ev = orig();
      if (!ev.length) return ev;
      const s = g.state;
      const lp = window.__proto.localPlayer;
      const me = s.players[lp];
      const myEnt = me.activeIndex != null ? me.party[me.activeIndex].entityId : null;
      for (const e of ev) {
        if (e.type === 'attack' && e.sourceId === myEnt) {
          window.__cnt.myAttacks++;
          if (window.__wantAttack) {
            window.__wantAttack = false;
            window.__ev.push({ wall: Date.now(), st: s.time, e: { type: 'myAttack', ranged: e.ranged, sourceId: e.sourceId } });
          }
        }
        if (e.type === 'skillCast' && e.player != null && e.slot !== 'monster') {
          const bucket = e.player === lp ? window.__cnt.mySkill : window.__cnt.otherSkill;
          bucket[e.slot] = (bucket[e.slot] ?? 0) + 1;
          window.__ev.push({ wall: Date.now(), st: s.time, e: { type: 'skillCast', player: e.player, slot: e.slot, name: e.name, skillId: e.skillId, center: e.center, delay: e.delay ?? 0, sourceId: e.sourceId } });
        }
        if (e.type === 'damage' && e.skillName) window.__cnt.dmgLabels++;
        if (e.type === 'ultReady' && e.player === lp) window.__ev.push({ wall: Date.now(), st: s.time, e: { type: 'ultReady' } });
      }
      return ev;
    };
    g.__tapped = true;
  });
}
const takeEvents = () => page.evaluate(() => { const ev = window.__ev ?? []; window.__ev = []; return ev; });
/** Client px of a world point (no finger lift). */
const clientOf = w => page.evaluate(w => { const f = window.__proto.ui.fingerFor(w); const r = document.querySelector('.stage').getBoundingClientRect(); return { x: f.x, y: f.y - 80 * (r.width / 1280) }; }, w);
const myPos = () => page.evaluate(() => {
  const s = window.__proto.game.state;
  const me = s.players[window.__proto.localPlayer];
  if (me.activeIndex == null) return null;
  const e = s.entities.find(x => x.id === me.party[me.activeIndex].entityId);
  return e ? { x: e.pos.x, y: e.pos.y } : null;
});

// ───────────── HUD text sizes as rendered on the phone (CSS px after the stage scale) ─────────────
async function fontAudit() {
  return page.evaluate(() => {
    const st = document.querySelector('.stage').getBoundingClientRect();
    const k = st.width / 1280;
    const sel = ['.cc-name', '.cc-state', '.cc-count', '.cc-norm-t', '.ult-pct', '.ult-sub', '.ult-name', '.pc-name', '.pc-state', '.bot-name', '.bot-char', '.fi-chip', '.timer-val', '.ss-type', '.ss-trigger', '.ss-skill', '.ss-sum', '.ss-live', '.ss-hint', '.toast'];
    const out = { stageScale: +k.toFixed(4), stage: { x: +st.x.toFixed(1), w: +st.width.toFixed(1), h: +st.height.toFixed(1) } };
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      out[s] = +(parseFloat(getComputedStyle(el).fontSize) * k).toFixed(1);
    }
    return out;
  });
}

// ───────────── skill sheet probes ─────────────
const sheetOpen = () => page.evaluate(() => { const e = document.querySelector('.skill-sheet'); return !!e && !e.classList.contains('is-hidden'); });
async function longPress(p, ms = 650) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 7, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function sheetTests(s) {
  const r = {};
  const me = s.me;
  const bench = [0, 1, 2].filter(i => i !== me.active && !me.party[i].dead);
  if (!bench.length || me.active == null) return null;
  // 1) long-press a benched card
  const before = await page.evaluate(() => window.__proto.game.state.players[0].activeIndex);
  await longPress(await center(page, `.ccard[data-idx="${bench[0]}"]`));
  await sleep(120);
  r.longPressOpens = await sheetOpen();
  r.longPressSwapped = (await page.evaluate(() => window.__proto.game.state.players[0].activeIndex)) !== before;
  r.toastAfterLongPress = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));
  await shot('sheet-longpress');
  // pass-through: what is under the sheet's centre?
  r.sheetBox = await page.evaluate(() => { const b = document.querySelector('.skill-sheet').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  r.underSheet = await page.evaluate(b => document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2)?.className ?? null, r.sheetBox);
  // 2) with the sheet up, drag another ready card → sheet should close, swap should go through
  const i = await readyCard(page, bench);
  if (i >= 0) {
    const tgt = await clusterFinger(page, { radius: 2.5 });
    if (tgt) {
      const release = await input.dragHold(await center(page, `.ccard[data-idx="${i}"]`), tgt.finger);
      await sleep(100);
      r.sheetWhileDragging = await sheetOpen();
      await release();
      await sleep(80);
      r.swapWithSheetUp = (await page.evaluate(() => window.__proto.game.state.players[0].activeIndex)) === i;
    }
  }
  // 3) tap the active card
  const act = await page.evaluate(() => window.__proto.game.state.players[0].activeIndex);
  if (act != null) {
    await input.tap(await center(page, `.ccard[data-idx="${act}"]`));
    await sleep(120);
    r.tapActiveOpens = await sheetOpen();
    await shot('sheet-tap-active');
    await input.tap(await center(page, `.ccard[data-idx="${act}"]`));
    await sleep(100);
    r.tapActiveAgainCloses = !(await sheetOpen());
  }
  // 4) tap the "i" on the field character's card (the card underneath takes the tap)
  await input.tap(await center(page, '.ccard.is-active .cc-info'));
  await sleep(120);
  r.tapInfoOpens = await sheetOpen();
  // auto close
  const t0 = Date.now();
  while ((await sheetOpen()) && Date.now() - t0 < 9000) await sleep(250);
  r.autoCloseMs = Date.now() - t0;
  // 5) plain tap on a benched card (no drag): which hint?
  const benchNow = [0, 1, 2].filter(k => k !== act);
  await input.tap(await center(page, `.ccard[data-idx="${benchNow[0]}"]`));
  await sleep(150);
  r.toastAfterTap = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));
  r.sheetAfterBenchTap = await sheetOpen();
  return r;
}

// ───────────── preset by real taps ─────────────
await page.goto(BASE);
await waitPhase(page, 'preset');
await sleep(500);
for (let guard = 0; guard < 8; guard++) {
  const chip = page.locator('.ps-slot-row .slot-chip:not(.is-empty):not(.slot-pet)').first();
  if (!(await chip.count())) break;
  const b = await chip.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(80);
}
for (const n of names) {
  const card = page.locator(`.ps-char[aria-label^="${n} "]`).first();
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(120);
}
const petCount = await page.locator('.ps-pet.is-picked').count();
for (let k = 0, n = petCount; n < 3 && k < 8; k++) {
  const c = page.locator('.ps-pet:not(.is-picked)').first();
  const b = await c.boundingBox();
  await input.tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  n++;
  await sleep(80);
}
await shot('preset');
report.presetPicked = await page.evaluate(() => [...document.querySelectorAll('.ps-slot-row .slot-chip:not(.is-empty)')].map(e => e.textContent));
await input.tap(await center(page, '.btn-start'));
await waitPhase(page, 'combat', 15000);
// matching screen? (server not running → solo straight away)
report.party = await page.evaluate(() => window.__proto.game.state.players[0].party.map(m => m.defId));
L('party', report.party);
await sleep(300);
await tapEvents();
report.hud = await hudBoxes(page);
report.fonts = await fontAudit();
await shot('floor1-start');
await castStart();

// ───────────── play loop ─────────────
const seen = { normal: {}, drag: {}, ult: 0, other: 0, attack: 0, ultReady: 0 };
let lastSwap = 0;
let lastPeriodic = Date.now();
let sheetDone = false;
let holdShots = 0;
let floor = 1;
let floorWall = Date.now();
let floorPerf = await now(page);
const start = Date.now();
let ultStateShots = new Set();
const charName = id => ({ guardian: '가디언', paladin: '팔라딘', warden: '워든', blade: '블레이드', berserker: '버서커', shadow: '섀도우', ranger: '레인저', mage: '메이지', gunner: '거너', cleric: '클레릭', bard: '바드', chrono: '크로노' })[id] ?? id;

while (Date.now() - start < 14 * 60_000) {
  flushClips();
  const s = await snap(page);
  if (!s) break;
  if (s.app === 'result' || s.phase === 'runOver') {
    report.result = s.runResult;
    L('RUN OVER', s.runResult?.outcome, 'floor', s.floor);
    await sleep(500);
    await shot(`runover-f${s.floor}`);
    break;
  }
  if (s.app === 'reward') {
    const fsx = await frameStats(page, floorPerf, await now(page));
    const tel = await page.evaluate(() => window.__proto.game.telemetry());
    const ft = tel.floorTimes[tel.floorTimes.length - 1];
    report.floors.push({ floor: s.floor, simSeconds: ft?.seconds, realSeconds: (Date.now() - floorWall) / 1000, fps: fsx, me: s.me.stats, deaths: s.me.party.filter(m => m.dead).length });
    L('clear', s.floor, ft?.seconds, fsx?.fps);
    await sleep(500);
    await shot(`reward-f${s.floor}`);
    if (s.floor >= FLOORS) break;
    await pickReward(pt, 0);
    await waitPhase(page, 'combat', 15000).catch(() => {});
    floor = s.floor + 1;
    floorWall = Date.now();
    floorPerf = await now(page);
    await sleep(200);
    await shot(`floor${floor}-start`);
    continue;
  }
  if (s.app === 'spectate') {
    report.spectate = { floor: s.floor, t: s.floorTime };
    await shot(`spectate-f${s.floor}`);
    break;
  }

  // events → clips
  const evs = await takeEvents();
  const castSeen = new Set();
  for (const { wall, e } of evs) {
    if (e.type === 'skillCast') {
      const ck = `${e.player}:${e.skillId}:${Math.round(wall / 300)}`;
      if (castSeen.has(ck)) continue;
      castSeen.add(ck);
      const mine = e.player === 0;
      const c = await clientOf(e.center);
      if (mine && e.slot === 'normal') {
        const id = e.skillId;
        seen.normal[id] = (seen.normal[id] ?? 0) + 1;
        if (seen.normal[id] <= 2) requestClip(`auto-${id}-${seen.normal[id]}`, wall, c, { note: `my auto skill ${e.name}` });
        if (seen.normal[id] === 1) {
          // the HUD widget: flash + reset
          await sleep(60);
          const hb = await page.locator('.hud-bl').boundingBox();
          await shot(`autoskill-${id}-hud`, { x: hb.x, y: hb.y - 4, width: Math.min(844 - hb.x, hb.width + 10), height: hb.height + 8 });
        }
      } else if (mine && e.slot === 'drag') {
        const id = e.skillId;
        seen.drag[id] = (seen.drag[id] ?? 0) + 1;
        if (seen.drag[id] <= 2) requestClip(`drag-${id}-${seen.drag[id]}`, wall, c, { w: 560, h: 260, after: 2200, note: `my drag ${e.name}` });
      } else if (mine && e.slot === 'ult') {
        seen.ult++;
        if (seen.ult <= 3) requestClip(`ult-${e.skillId}`, wall, { x: 422, y: 170 }, { w: 844, h: 390, after: 2600, every: 200, note: `my ult ${e.name}` });
      } else if (!mine && (e.slot === 'drag' || e.slot === 'ult')) {
        seen.other++;
        if (seen.other <= 6) requestClip(`other-p${e.player}-${e.slot}-${e.skillId}`, wall, c, { w: 560, h: 260, after: 1800, note: `player ${e.player} ${e.slot} ${e.name}` });
      }
    } else if (e.type === 'myAttack') {
      seen.attack++;
      const p = await myPos();
      if (p) requestClip(`basic-${seen.attack}`, wall, await clientOf(p), { before: 400, after: 1600, w: 300, h: 140, every: 70, note: `my basic attack (${e.ranged ? 'ranged' : 'melee'})` });
      lastSwap = Math.max(lastSwap, Date.now() - 2500);
    } else if (e.type === 'ultReady') {
      seen.ultReady++;
      if (seen.ultReady <= 1) {
        await sleep(80);
        const ub = await page.locator('.hud-bc').boundingBox();
        await shot('ult-ready-hud', { x: ub.x - 60, y: ub.y - 30, width: ub.width + 120, height: ub.height + 30 });
      }
    }
  }
  // basic-attack clips: once per character
  const activeId = s.me.active != null ? s.me.party[s.me.active].id : null;
  if (activeId && !(report.counts[`attackClip-${activeId}`]) && s.alive > 0) {
    report.counts[`attackClip-${activeId}`] = 1;
    await page.evaluate(() => (window.__wantAttack = true));
  }
  // ult gauge snapshots at a few charge levels
  for (const q of [0.25, 0.75]) if (s.me.ult >= q && s.me.ult < q + 0.1 && !ultStateShots.has(q)) {
    ultStateShots.add(q);
    const ub = await page.locator('.hud-bc').boundingBox();
    await shot(`ult-${Math.round(q * 100)}`, { x: ub.x - 60, y: ub.y - 30, width: ub.width + 120, height: ub.height + 30 });
  }

  // ult when full (wait 1.2 s after full so the READY state is visible)
  if (s.me.ult >= 1 && s.me.active != null) {
    if (!report.counts.ultFullAt) report.counts.ultFullAt = Date.now();
    if (Date.now() - report.counts.ultFullAt > 1200) {
      const ok = await tapUlt(pt);
      report.counts.ultFullAt = 0;
      if (ok && seen.ult < 1) {
        await sleep(250);
        await shot('ult-cutin');
      }
    }
  }

  // skill sheet tests once, after the first swap on floor 1
  if (!sheetDone && floor === 1 && report.swaps.length >= 2 && s.me.active != null) {
    sheetDone = true;
    report.sheet = await sheetTests(s).catch(e => ({ error: String(e) }));
    L('sheet', report.sheet);
  }

  // swap every ~4.5 s (or empty field), real drag; one hold shot per character
  if ((Date.now() - lastSwap > 4500 || s.me.active == null) && s.alive > 0) {
    const i = await readyCard(page, [0, 1, 2].filter(k => k !== s.me.active));
    if (i >= 0) {
      const tgt = await clusterFinger(page, { radius: 2.5 });
      if (tgt) {
        const id = s.me.party[i].id;
        const from = await center(page, `.ccard[data-idx="${i}"]`);
        const before = s.me.active;
        const release = await input.dragHold(from, tgt.finger, 14);
        await sleep(140);
        if (holdShots < 3 && !report.counts[`hold-${id}`]) {
          report.counts[`hold-${id}`] = 1;
          holdShots++;
          await shot(`hold-${id}`);
        }
        await release();
        await sleep(60);
        const after = await page.evaluate(() => window.__proto.game.state.players[0].activeIndex);
        report.swaps.push({ floor, t: s.floorTime, id, ok: after === i && before !== i, n: tgt.n });
        if (report.swaps.filter(x => x.ok).length === 1) {
          // first ever swap: what does the field look like 0.4 s later, full screen
          await sleep(300);
          await shot(`first-swap-${id}`);
        }
        lastSwap = Date.now();
        // card row right after: the benched card's countdown
        if (report.swaps.length === 3) {
          const hb = await page.locator('.hud-bl').boundingBox();
          await shot('cards-after-swap', { x: hb.x - 4, y: hb.y - 8, width: Math.min(844 - hb.x + 4, hb.width + 8), height: hb.height + 12 });
        }
      }
    }
  }
  // pets every so often
  if (Math.random() < 0.08) {
    const pi = await readyPet(page);
    if (pi >= 0 && s.alive >= 3) await realPet(pt, pi, {});
  }
  // periodic full shots
  if (Date.now() - lastPeriodic > 15000) {
    lastPeriodic = Date.now();
    await shot(`f${floor}-t${Math.round(s.floorTime)}`);
  }
  await sleep(90);
}
await castStop();
flushClips(true);
report.counts.seen = seen;
report.counts.page = await page.evaluate(() => window.__cnt ?? null);
L('writing sheets', savedClips.length);
await writeSheets(pt.browser);
fs.writeFileSync(`${P}-report.json`, JSON.stringify(report, null, 2));
L('errors', pt.errors);
await pt.browser.close();
