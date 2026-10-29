// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 5-3): short phone clips of the 조준 / 드래그 ults for the designer — the
// real game on a phone screen (844×390 landscape, Playwright's recordVideo at the same size), solo against a fixed boss,
// a real finger on the ult button (CDP touch events, like ult-test-sheet.mjs): hold and drag onto the field (the live
// preview shows ~0.5 s), release, until the ult's finisher (src/data/ultTest/beats.ts) + 1 s.
// One clip per ult: test-results/ult-fx-video/<alt id>.webm (not committed; the main session sends them).
// The page's recording starts when the page opens (loading, the preset screen …): when an ffmpeg is on the PATH the clip
// is cut to [release − 0.6 s, finisher + 1 s] (~4 s); without one the whole recording is kept and the console says
// where the release is.
//
//   node tests/visual/ult-fx-video.mjs                          → its own Vite dev server, the default six
//   node tests/visual/ult-fx-video.mjs port=5192 only=mage_ua,guardian_ud
//   node tests/visual/ult-fx-video.mjs url=http://localhost:4502/ only=blade:aim,berserker
//
// Options: only= (alt ids `mage_ua` / `guardian_ud`, or `char:aim|drag`, or a bare character id = its 조준), url= (a
// running server), port= (a server already answering there is used, else its own dev server starts there), boss=
// (default elevator_keeper: fixed, top centre), point=x,y (the aimed / landing world point; default in front of the
// boss), out= (folder, default test-results/ult-fx-video), lead= (seconds before the release, default 0.6), tail=
// (seconds after the finisher, default 1).
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { VIEW, parseArgs } from './bossLive.mjs';

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const args = parseArgs(process.argv);
const OUT_DIR = args.out ?? 'test-results/ult-fx-video';
const BOSS = args.boss ?? 'elevator_keeper';
const POINT = args.point ? args.point.split(',').map(Number) : null;
const LEAD = Number(args.lead ?? 0.6);
const TAIL = Number(args.tail ?? 1);
/** 5-3 default list: 가디언 드래그, 버서커 드래그, 메이지 조준, 크로노 조준, 메딕 조준, 퍼펫티어 조준. */
const DEFAULT = ['guardian_ud', 'berserker_ud', 'mage_ua', 'chrono_ua', 'medic_ua', 'puppeteer_ua'];

/** `mage_ua` / `mage:aim` / `mage` → { id: 'mage', mode: 'aim', alt: 'mage_ua' }. */
function parseUlt(s) {
  const m = /^(.+)_u([ad])$/.exec(s);
  if (m) return { id: m[1], mode: m[2] === 'a' ? 'aim' : 'drag', alt: s };
  const [id, mode = 'aim'] = s.split(':');
  if (mode !== 'aim' && mode !== 'drag') throw new Error(`only=${s}: the mode is aim or drag`);
  return { id, mode, alt: `${id}_u${mode === 'aim' ? 'a' : 'd'}` };
}
const LIST = (args.only ? args.only.split(',') : DEFAULT).map(parseUlt);

/** The two bench members (not the tested one). */
const bench = id => ['cleric', 'guardian', 'mage'].filter(x => x !== id).slice(0, 2);

/** An ffmpeg that can cut a webm (the one on the PATH; Playwright's own build only encodes). */
function findFfmpeg() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
  return r.status === 0 ? 'ffmpeg' : null;
}

async function answers(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let server = null;
let base = args.url ?? null;
if (!base && args.port && (await answers(`http://127.0.0.1:${args.port}/`))) base = `http://127.0.0.1:${args.port}/`;
if (!base) {
  server = await createServer({ server: { port: Number(args.port ?? 0) || 5199, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const FFMPEG = findFfmpeg();
const RAW_DIR = path.join(OUT_DIR, '_raw');
mkdirSync(RAW_DIR, { recursive: true });
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
const errors = [];

/** One ult: a fresh recording page, the cast, the clip. */
async function record({ id, mode, alt }) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: RAW_DIR, size: VIEW } });
  const page = await ctx.newPage();
  const born = Date.now();
  page.on('pageerror', e => errors.push(`${alt}: ${String(e)}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${alt}: console.error: ${m.text()}`);
  });
  const gameTime = () => page.evaluate(() => window.__proto.game.state.time);
  const waitGameTime = t => page.waitForFunction(v => window.__proto.game.state.time >= v, t, { timeout: 15000, polling: 16 });
  await page.goto(`${base}?mode=ultTest&ult=${mode}&chars=${[id, ...bench(id)].join(',')}&boss=${BOSS}`);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', null, { timeout: 90000 });
  await page.addStyleTag({ content: '.banner.banner-raid { display: none !important; }' });
  await page.evaluate(() => window.__proto.startRun({ tunables: { invincible: true }, bossRaid: { hpMult: 6 } }));
  await page.waitForFunction(b => window.__proto.phase === 'combat' && window.__proto.game?.state.plan.bossId === b, BOSS, { timeout: 30000 });
  await waitGameTime((await gameTime()) + 1.4);
  // the finisher (s after the release) from the beats — the dev server's own module; a build has none: 2.5 s
  const fin = await page
    .evaluate(async a => (await import('/src/data/ultTest/index.ts')).ultBeats(a)?.finisherAt ?? null, alt)
    .catch(() => null);
  const point = await page.evaluate(
    ([pt]) => {
      const s = window.__proto.game.state;
      const b = s.entities.find(e => e.id === s.bossId);
      const a = s.plan.arena;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      return pt ? { x: pt[0], y: pt[1] } : { x: clamp(b.pos.x + 3, 2, a.width - 2), y: clamp(b.pos.y + b.radius + 3.2, 2, a.height - 2) };
    },
    [POINT],
  );
  await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }));
  await page.waitForFunction(() => document.querySelector('.ult')?.classList.contains('is-full'), null, { timeout: 5000 });
  const box = await page.locator('.ult').boundingBox();
  const btn = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const finger = await page.evaluate(w => window.__proto.ui.fingerFor(w), point);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', btn);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', { x: btn.x + ((finger.x - btn.x) * i) / 12, y: btn.y + ((finger.y - btn.y) * i) / 12 });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(500); // the live preview on screen for a moment
  await touch('touchEnd', null);
  const released = Date.now();
  await cdp.detach();
  const t0 = await gameTime();
  const until = (fin ?? 2.5) + TAIL;
  await waitGameTime(t0 + until);
  await page.waitForTimeout(150);
  const cast = await page.evaluate(() => window.__proto.game.state.players[0].stats.ultsUsed >= 1);
  const video = page.video();
  await ctx.close(); // the recording is written when its page closes
  const raw = await video.path();
  const out = path.join(OUT_DIR, `${alt}.webm`);
  const from = Math.max(0, (released - born) / 1000 - LEAD);
  const dur = LEAD + until + 0.2;
  let cut = false;
  if (FFMPEG) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', from.toFixed(2), '-i', raw, '-t', dur.toFixed(2), '-an', '-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'good', out], { encoding: 'utf8' });
    cut = r.status === 0 && existsSync(out) && statSync(out).size > 0;
    if (!cut) console.log(`  (ffmpeg could not cut ${alt}: ${r.stderr?.trim().split('\n').pop() ?? r.status}) — keeping the whole recording`);
  }
  if (!cut) copyFileSync(raw, out);
  rmSync(raw, { force: true });
  const kb = Math.round(statSync(out).size / 1024);
  console.log(
    `${alt.padEnd(13)} ${cast ? '' : '✗ 시전 안 됨 · '}마무리 ${fin ?? '?'}초 · ${out} (${kb} KB` + (cut ? `, ${dur.toFixed(1)} s)` : `, whole recording — the release is at ${((released - born) / 1000).toFixed(1)} s)`),
  );
  return cast;
}

let ok = true;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const u of LIST) ok = (await record(u)) && ok;
} finally {
  await browser.close();
  if (server) await server.close();
  rmSync(RAW_DIR, { recursive: true, force: true });
}
if (!FFMPEG) console.log('no ffmpeg on the PATH: the clips are whole recordings (see the release times above)');
if (errors.length) {
  console.log('ERRORS', errors);
  process.exitCode = 1;
} else if (!ok) process.exitCode = 1;
