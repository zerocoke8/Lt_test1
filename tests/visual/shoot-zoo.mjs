// Screenshots of the 기획 8차 sandbox scenes (zones, looks, bosses, mechanics) at phone size 844×390 @3x.
// 1) npx vite --port 5191   2) node tests/visual/shoot-zoo.mjs [name=query …]   (default: the full set) → OUT/*.png
// FRAMES=name=query,n,ms → a contact sheet of n frames ms apart (sandbox fixed-step clock), e.g. the hit-stop landing.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.SANDBOX_URL ?? 'http://localhost:5191/tests/visual/render-sandbox.html';
const OUT = process.env.OUT ?? '/tmp/zoo';
mkdirSync(OUT, { recursive: true });
const DEFAULT = [
  'gallery-lobby=zone=lobby&gallery=1&t=1.3',
  'gallery-rooftop=zone=rooftop&gallery=1&t=0.4',
  'pack-lobby=zone=lobby&pack=1',
  'pack-office=zone=office&pack=1',
  'pack-ward=zone=ward&pack=1',
  'pack-rooftop=zone=rooftop&pack=1',
  'boss-lobby=zone=lobby&boss=1',
  'boss-office=zone=office&boss=1',
  'boss-ward=zone=ward&boss=1',
  'boss-rooftop=zone=rooftop&boss=1',
  'boss-rooftop-p3=zone=rooftop&boss=1&phase=3&t=0.3',
  'fx-fan=zone=rooftop&fx=fan&t=0.3',
  'fx-charge=zone=ward&fx=charge&t=1.15',
  'fx-blink=zone=ward&fx=blink&t=0.2',
  'fx-split=zone=office&fx=split&t=0.25',
  'fx-heal=zone=ward&fx=heal&t=0.5',
];
const list = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const phone = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const errors = [];
for (const item of list) {
  const i = item.indexOf('=');
  const name = item.slice(0, i);
  const q = item.slice(i + 1);
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${BASE}?scene=zoo&${q}`);
  await page.waitForFunction(() => window.__sandbox?.ready === true, null, { timeout: 60000 });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
  await ctx.close();
}
if (process.env.FRAMES) {
  const [spec, n, ms] = process.env.FRAMES.split(',');
  const i = spec.indexOf('=');
  const name = spec.slice(0, i);
  const q = spec.slice(i + 1);
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  await page.goto(`${BASE}?scene=zoo&${q}`);
  await page.waitForFunction(() => window.__sandbox?.ready === true, null, { timeout: 60000 });
  const shots = [];
  // CLIP=x,y,w,h (CSS px of the 844×390 page) zooms the sheet onto the action
  const clip = process.env.CLIP ? (([x, y, width, height]) => ({ x, y, width, height }))(process.env.CLIP.split(',').map(Number)) : undefined;
  for (let k = 0; k < Number(n); k++) {
    shots.push(await page.screenshot(clip ? { clip } : {}));
    await page.evaluate(m => window.__sandbox.step(m), Number(ms));
  }
  const p = await browser.newPage();
  const b64 = await p.evaluate(async ([data, ms]) => {
    const imgs = await Promise.all(data.map(src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; })));
    const cols = 3;
    const tw = 620;
    const th = Math.round((imgs[0].height / imgs[0].width) * tw);
    const rows = Math.ceil(imgs.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * tw + (cols + 1) * 6;
    c.height = rows * th + (rows + 1) * 6;
    const g = c.getContext('2d');
    g.fillStyle = '#222';
    g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => {
      const x = 6 + (i % cols) * (tw + 6);
      const y = 6 + Math.floor(i / cols) * (th + 6);
      g.drawImage(im, x, y, tw, th);
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(x, y, 84, 24);
      g.fillStyle = '#ffeb3b';
      g.font = 'bold 18px sans-serif';
      g.fillText(`${i * ms}ms`, x + 5, y + 18);
    });
    return c.toDataURL('image/png').split(',')[1];
  }, [shots.map(b => `data:image/png;base64,${b.toString('base64')}`), Number(ms)]);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
if (errors.length) console.log('ERRORS', errors);
