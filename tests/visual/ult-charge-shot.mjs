// 기획 24차 (docs/ult-fx.md 8-4 · 8-6): the 「충전」 button right of the ult button on a phone (844×390) — the real game in
// 궁극기 테스트 (its own Vite dev server, or url=), a real finger (CDP touch) on the button. One picture, two columns:
// before the press (gauges near empty, the button bright) and after it (the ult full 「끌기!」, the button dim — all three
// gauges full); the second row is the bottom of the screen at twice the size. The ult name under the button is set to the
// longest alt ult name (거너 드래그 「펌프 버스트 · 대구경 슬러그」 — 기획 24차 검토: was 레인저 조준's shorter one) for the picture. A red frame = the press did not fill the gauges.
// The console prints the button's box in logical px (1280×720) and anything its box + 10 px touch rim overlaps (the
// ult's press box + 6 CSS px slack, the three cards, the three pets, the ult name, the 조준 / 드래그 chip) — exit 1 then.
//
//   node tests/visual/ult-charge-shot.mjs                               → docs/screenshots/ult-charge-button.png
//   node tests/visual/ult-charge-shot.mjs url=http://localhost:4502/    → a running server (e.g. vite preview of a build)
//   node tests/visual/ult-charge-shot.mjs out=<file> chars=ranger,guardian,cleric ult=aim|drag boss=<id> port=<dev port>
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { VIEW, parseArgs, writeSheet } from './bossLive.mjs';

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const args = parseArgs(process.argv);
const OUT = args.out ?? 'docs/screenshots/ult-charge-button.png';
const CHARS = (args.chars ?? 'ranger,guardian,cleric').split(',');
const ULT = args.ult ?? 'aim';
const BOSS = args.boss ?? 'elevator_keeper';
const PETS = ['frog_bomb', 'fairy_heal', 'cat_void'];
const LONGEST_ULT_NAME = '펌프 버스트 · 대구경 슬러그';
/** Logical px of the touch rim around the button (ultTest.css .ult-charge::before) and the ult's press slack (CSS px). */
const RIM = 10;
const SLACK_CSS = 6;

let server = null;
let base = args.url ?? null;
if (!base) {
  // no hot reload: a file saved while the tool runs (another session at work) must not reload the page mid-capture
  server = await createServer({ server: { port: Number(args.port ?? 0) || 5199, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(p => localStorage.setItem('swapTower.preset.v1', JSON.stringify(p)), { characters: CHARS, pets: PETS });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});

let code = 0;
try {
  await page.goto(`${base}?mode=ultTest&ult=${ULT}&chars=${CHARS.join(',')}&boss=${BOSS}`);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', null, { timeout: 90000 });
  // the floor-start banner (top centre) is not what this picture is about
  await page.addStyleTag({ content: '.banner.banner-raid { display: none !important; }' });
  await page.evaluate(() => window.__proto.startRun({ tunables: { invincible: true }, bossRaid: { hpMult: 6 } }));
  await page.waitForFunction(b => window.__proto.phase === 'combat' && window.__proto.game?.state.plan.bossId === b, BOSS, { timeout: 30000 });
  await page.waitForSelector('.ult-charge:not(.is-hidden)', { timeout: 5000 });
  await page.evaluate(n => {
    document.querySelector('.ult-name').textContent = n; // the HUD writes it again only when the field character changes
  }, LONGEST_ULT_NAME);
  await page.waitForTimeout(1500);

  // ── layout (logical px) ──
  const lay = await page.evaluate(() => {
    const st = document.querySelector('.stage').getBoundingClientRect();
    const k = st.width / 1280;
    const L = r => ({ x: (r.left - st.left) / k, y: (r.top - st.top) / k, w: r.width / k, h: r.height / k });
    const all = sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => L(e.getBoundingClientRect()));
    return { k, stage: { x: st.left, y: st.top }, charge: all('.ult-charge')[0], ult: all('.ult')[0], cards: all('.ccard'), pets: all('.pcard'), name: all('.ult-name'), chip: all('.ult-mode') };
  });
  const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const f = v => v.toFixed(0);
  const c = lay.charge;
  const rim = grow(c, RIM);
  console.log(`stage ×${lay.k.toFixed(3)} · 충전 x ${f(c.x)}–${f(c.x + c.w)} · y ${f(c.y)}–${f(c.y + c.h)} (Ø ${f(c.w)}, ${f(c.w * lay.k)} CSS px) · ult x ${f(lay.ult.x)}–${f(lay.ult.x + lay.ult.w)}`);
  const against = [
    ['ult press box', [grow(lay.ult, SLACK_CSS / lay.k)]],
    ['card', lay.cards],
    ['pet', lay.pets],
    ['ult name', lay.name],
    ['mode chip', lay.chip],
  ];
  const bad = [];
  for (const [k, list] of against)
    for (const b of list) {
      const gap = Math.max(b.x - (c.x + c.w), c.x - (b.x + b.w), b.y - (c.y + c.h), c.y - (b.y + b.h));
      console.log(`  ${k.padEnd(13)} x ${f(b.x)}–${f(b.x + b.w)} · y ${f(b.y)}–${f(b.y + b.h)} · gap ${f(gap)}${hit(rim, b) ? '  ← OVERLAP (rim)' : ''}`);
      if (hit(rim, b)) bad.push(k);
    }
  if (lay.cards.length !== 3 || lay.pets.length !== 3) bad.push(`cards ${lay.cards.length} / pets ${lay.pets.length} (want 3 / 3)`);

  // the bottom of the screen around the two buttons, twice the size (CSS px; the tiles keep the phone's aspect)
  const mid = { x: lay.stage.x + ((lay.ult.x + c.x + c.w) / 2) * lay.k, y: lay.stage.y + (c.y + c.h / 2) * lay.k };
  const zw = VIEW.width / 2;
  const zh = VIEW.height / 2;
  const clip = { x: Math.max(0, Math.min(VIEW.width - zw, mid.x - zw / 2)), y: VIEW.height - zh, width: zw, height: zh };

  const shots = [];
  const before = { full: await page.screenshot(), zoom: await page.screenshot({ clip }) };
  const gaugesBefore = await page.evaluate(() => window.__proto.game.state.players[0].party.map(m => m.ult.charge));

  // ── a real finger on 「충전」 ──
  const at = { x: lay.stage.x + (c.x + c.w / 2) * lay.k, y: lay.stage.y + (c.y + c.h / 2) * lay.k };
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', at);
  await page.waitForTimeout(60);
  await touch('touchEnd', null);
  await cdp.detach();
  const filled = await page
    .waitForFunction(() => document.querySelector('.ult-charge')?.classList.contains('is-full') && document.querySelector('.ult')?.classList.contains('is-full'), null, { timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  await page.waitForTimeout(500); // the pop (0.35 s) is over: the resting look
  const after = { full: await page.screenshot(), zoom: await page.screenshot({ clip }) };
  const state = await page.evaluate(() => ({
    gauges: window.__proto.game.state.players[0].party.map(m => m.ult.charge),
    pct: document.querySelector('.ult-pct')?.textContent,
    toasts: [...document.querySelectorAll('.toasts-hud .toast')].map(t => t.textContent),
  }));
  const ok = filled && state.gauges.every(g => g >= 1);
  const pct = gs => gs.map(g => `${Math.round(g * 100)}%`).join(' · ');
  console.log(`before: ${pct(gaugesBefore)} → after: ${pct(state.gauges)} · ult 「${state.pct}」 · toasts ${JSON.stringify(state.toasts)}`);

  shots.push({ png: before.full, label: `누르기 전 — 게이지 ${pct(gaugesBefore)} · 「충전」 밝음` });
  shots.push({ png: after.full, label: `누른 뒤 0.5초 — 게이지 ${pct(state.gauges)} · 「${state.pct}」 · 「충전」 흐림`, bad: !ok });
  shots.push({ png: before.zoom, label: '누르기 전 (아래쪽 ×2)' });
  shots.push({ png: after.zoom, label: '누른 뒤 (아래쪽 ×2)', bad: !ok });
  await writeSheet(page, shots, OUT, { scale: 1, per: 2, label: 28 });
  console.log(`→ ${OUT}`);
  if (!ok) {
    console.log('FAIL: the press did not fill all three gauges');
    code = 1;
  }
  if (bad.length) {
    console.log(`FAIL: overlaps ${bad.join(', ')}`);
    code = 1;
  }
} finally {
  if (errors.length) {
    console.log('ERRORS', errors);
    code = 1;
  }
  await browser.close();
  await server?.close();
}
process.exit(code);
