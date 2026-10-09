// 기획 15차: gear-bands contact sheet at phone size. 1) npx vite --port 5192  2) node tests/visual/shoot-gear.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.SANDBOX_URL ?? 'http://localhost:5192/tests/visual/gear-sandbox.html';
const OUT = process.env.OUT ?? 'docs/screenshots/gear-bands.png';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.goto(BASE);
await page.waitForFunction(() => window.__gear === true, null, { timeout: 60000 });
await page.screenshot({ path: OUT });
console.log(OUT);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
