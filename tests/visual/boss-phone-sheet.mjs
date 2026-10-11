// 기획 19차 보스 레이드 (review): all 20 bosses as the PLAYER sees them — the real game on a phone screen (844×390) with
// the HUD and the party under the boss, each caught on its first warning. boss-sheet.mjs shows the art alone (a sandbox
// without the HUD); this one shows what is still readable in a fight (a boss hidden by the party shows up here).
//
//   node tests/visual/boss-phone-sheet.mjs                       → <temp>/bosses-phone.png
//   node tests/visual/boss-phone-sheet.mjs out=docs/screenshots/bosses-20-phone.png
//   node tests/visual/boss-phone-sheet.mjs only=xray_machine,thunder_antenna scale=1
//
// It starts its own Vite dev server (no build needed) and plays each boss alone on its zone's first floor (invincible
// party, real time, about 6 s a boss). Chromium: the same rule as playwright.config.ts.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
const OUT = args.out ?? process.env.OUT ?? path.join(tmpdir(), 'bosses-phone.png');
const ONLY = args.only ? args.only.split(',') : null;
/** Tile size = the phone screen × this (0.5 → 422×195 a boss, 5 a row = one zone). */
const SCALE = Number(args.scale ?? 0.5);
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const VIEW = { width: 844, height: 390 };
const LABEL = 22;

const server = await createServer({ server: { port: Number(args.port ?? 0) || 5197, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
const errors = [];
const shots = [];
try {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?mode=bossRaid`);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', null, { timeout: 90000 });
  // the 20 ids and names, zone by zone: the debug panel's 「보스 고르기」 list (built once a raid runs)
  await page.evaluate(() => window.__proto.startRun({ seed: 1, mode: 'bossRaid' }));
  await page.waitForFunction(() => window.__proto.phase === 'combat', null, { timeout: 30000 });
  const all = await page.evaluate(() => [...document.querySelectorAll('.debug-panel .dbg-raid-boss option')].map(o => ({ id: o.value, name: o.textContent.replace(/\s*\(꺼짐\)$/, '') })));
  const list = ONLY ? all.filter(b => ONLY.includes(b.id)) : all;
  for (const b of list) {
    const floor = 1 + 5 * Math.floor(all.findIndex(x => x.id === b.id) / 5);
    await page.evaluate(([id, floor]) => window.__proto.startRun({ seed: 4242, startFloor: floor, mode: 'bossRaid', bossRaid: { onlyBoss: id, hpMult: 6 }, tunables: { invincible: true } }), [b.id, floor]);
    await page.waitForFunction(id => window.__proto.phase === 'combat' && window.__proto.game?.state.plan.bossId === id && window.__proto.game.state.time < 1, b.id, { timeout: 30000 });
    // the first warning that hurts, a little into its countdown (the banner is gone by then); 8 s at most
    await page
      .waitForFunction(() => window.__proto.game.state.telegraphs.some(t => t.team === 'enemy' && !t.self && t.remaining / t.total < 0.6), null, { timeout: 8000 })
      .catch(() => {});
    shots.push({ ...b, floor, png: await page.screenshot() });
    console.log(`${b.id} ${b.name}`);
  }
  const b64 = await page.evaluate(
    async ([data, w, h, label]) => {
      const imgs = await Promise.all(data.map(d => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = d.src; })));
      const per = 5;
      const rows = Math.ceil(imgs.length / per);
      const c = document.createElement('canvas');
      c.width = Math.min(imgs.length, per) * (w + 4) + 4;
      c.height = rows * (h + label + 4) + 4;
      const g = c.getContext('2d');
      g.fillStyle = '#15171c';
      g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = 'high';
      imgs.forEach((im, i) => {
        const x = 4 + (i % per) * (w + 4);
        const y = 4 + Math.floor(i / per) * (h + label + 4);
        g.drawImage(im, x, y + label, w, h);
        g.fillStyle = '#ffffff';
        g.font = 'bold 14px "Malgun Gothic","Noto Sans KR",sans-serif';
        g.textBaseline = 'middle';
        g.fillText(`${data[i].name} · ${data[i].floor}층`, x + 4, y + label / 2);
      });
      return c.toDataURL('image/png').split(',')[1];
    },
    [shots.map(s => ({ src: `data:image/png;base64,${s.png.toString('base64')}`, name: s.name, floor: s.floor })), Math.round(VIEW.width * SCALE), Math.round(VIEW.height * SCALE), LABEL],
  );
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
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
