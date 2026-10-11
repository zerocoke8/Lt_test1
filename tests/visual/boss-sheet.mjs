// 기획 19차 보스 레이드: all 20 bosses on one picture — idle and wind-up side by side, one zone per row — to read the
// looks by eye (silhouettes apart, faces clear of the HUD boss box, nothing cut off).
// 기획 20차: a moving boss (배회형 · 자리 이동형 · 전장형) is shown where it fights — in the middle of the arena (12, 6.5) with
// three characters around it, one right behind it (its X-ray ghost must show through the body) — walking and winding
// up; a fixed boss stays the set piece at the top (idle and wind-up). The label says the form.
//
//   node tests/visual/boss-sheet.mjs                        → <temp>/boss-sheet.png
//   node tests/visual/boss-sheet.mjs out=C:/tmp/sheet.png poses=idle,windup,groggy,enraged phase=2 only=claw_machine,washer_drum
//
// It starts its own Vite dev server (no build needed) and opens tests/visual/render-sandbox.html?scene=zoo&boss=<id>&pose=…
// for every boss. Chromium: /opt/pw-browsers/chromium in a cloud session, else Playwright's own browser
// (`npx playwright install chromium` once) — the same rule as playwright.config.ts. A boss without art yet shows the
// fallback (the watcher); a boss without data shows its id instead of a name.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const OUT = args.out ?? process.env.OUT ?? path.join(tmpdir(), 'boss-sheet.png');
const POSES = (args.poses ?? 'idle,windup').split(',');
/** Without poses=…: a moving boss walks where a fixed one idles. */
const AUTO_POSES = !args.poses;
const PHASE = args.phase ?? '1';
const ONLY = args.only ? args.only.split(',') : null;
const T = args.t ?? '0.9';
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';

// a fixed boss's art sits at the top centre of the 1280×720 stage; a moving boss is framed around where it stands
const CLIP = { x: 250, y: 0, width: 780, height: 390 };
const STAGE = { width: 1280, height: 720 };
/** The frame of a moving boss: its feet a little under the middle (the body rises above them). */
const moverClip = focus => ({
  x: Math.round(Math.max(0, Math.min(STAGE.width - CLIP.width, focus.x - CLIP.width / 2))),
  y: Math.round(Math.max(0, Math.min(STAGE.height - CLIP.height, focus.y - CLIP.height * 0.68))),
  width: CLIP.width,
  height: CLIP.height,
});
const TILE = { w: 390, h: 195 };
const LABEL = 26;

// no hot reload: a file saved while the tool runs must not reload the page mid-capture
const server = await createServer({ server: { port: Number(args.port ?? 0) || 5199, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const base = `http://127.0.0.1:${port}/tests/visual/render-sandbox.html?scene=zoo`;
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
const errors = [];
const shots = [];
let names = {};
let forms = {};
let moving = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const open = async q => {
    await page.goto(`${base}&${q}`);
    await page.waitForFunction(() => window.__sandbox?.ready === true, null, { timeout: 90000 });
  };
  await open('boss=abyss_watcher&pose=idle&t=0.1');
  const all = await page.evaluate(() => [...(window.__sandbox.bossIds ?? [])]);
  names = await page.evaluate(() => window.__sandbox.bossNames ?? {});
  forms = await page.evaluate(() => window.__sandbox.forms ?? {});
  moving = await page.evaluate(() => window.__sandbox.moving ?? {});
  const ids = ONLY ? all.filter(id => ONLY.includes(id)) : all;
  for (const id of ids) {
    for (const p of POSES) {
      const pose = AUTO_POSES && p === 'idle' && moving[id] ? 'walk' : p;
      await open(`boss=${id}&pose=${pose}&phase=${PHASE}&t=${T}`);
      const focus = moving[id] ? await page.evaluate(() => window.__sandbox.focus ?? null) : null;
      shots.push({ id, pose, png: await page.screenshot({ clip: focus ? moverClip(focus) : CLIP }) });
    }
    console.log(`${id} ${names[id] ?? '(no data yet)'} · ${forms[id] ?? '?'}`);
  }
  // compose: 5 bosses a row (= one zone) with two poses; fewer bosses a row with more poses
  const perRow = Math.max(1, Math.floor(10 / POSES.length)) * POSES.length;
  const b64 = await page.evaluate(
    async ([data, tile, label, perRowN]) => {
      const imgs = await Promise.all(data.map(d => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = d.src; })));
      const rows = Math.ceil(imgs.length / perRowN);
      const c = document.createElement('canvas');
      c.width = Math.min(imgs.length, perRowN) * (tile.w + 4) + 4;
      c.height = rows * (tile.h + label + 4) + 4;
      const g = c.getContext('2d');
      g.fillStyle = '#15171c';
      g.fillRect(0, 0, c.width, c.height);
      imgs.forEach((im, i) => {
        const x = 4 + (i % perRowN) * (tile.w + 4);
        const y = 4 + Math.floor(i / perRowN) * (tile.h + label + 4);
        g.drawImage(im, x, y + label, tile.w, tile.h);
        g.fillStyle = data[i].has ? '#ffffff' : '#ff9aa2';
        g.font = 'bold 15px "Malgun Gothic","Noto Sans KR",sans-serif';
        g.textBaseline = 'middle';
        g.fillText(`${data[i].name} · ${data[i].form} · ${data[i].id} · ${data[i].pose}`, x + 4, y + label / 2, tile.w - 8);
      });
      return c.toDataURL('image/png').split(',')[1];
    },
    [shots.map(s => ({ src: `data:image/png;base64,${s.png.toString('base64')}`, id: s.id, pose: s.pose, name: names[s.id] ?? '(데이터 없음)', form: forms[s.id] ?? '?', has: !!names[s.id] })), TILE, LABEL, perRow],
  );
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(b64, 'base64'));
  console.log(OUT);
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.log('ERRORS', errors);
  process.exitCode = 1;
}
