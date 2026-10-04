// Screenshots of the 12 drag-skill footprints (3차 2) for a visual check → /tmp/shapes-*.png
// 1) npx vite --port 5176   2) node tests/visual/shoot-shapes.mjs   [ONLY=grid|phone]
import { chromium } from '@playwright/test';

const BASE = process.env.SANDBOX_URL ?? 'http://localhost:5176/tests/visual/render-sandbox.html';
const only = process.env.ONLY;
const IDS = ['guardian', 'paladin', 'warden', 'blade', 'berserker', 'shadow', 'ranger', 'mage', 'gunner', 'cleric', 'bard', 'chrono'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const files = [];
async function shoot(ctxOpts, q, file) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${file}: ${e}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${file}: ${m.text()}`));
  await page.goto(`${BASE}?scene=shapes&${q}`);
  await page.waitForFunction(() => window.__sandbox?.ready === true, null, { timeout: 60000 });
  await page.screenshot({ path: file });
  files.push(file);
  await ctx.close();
}
const desktop = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
if (!only || only === 'grid') {
  await shoot(desktop, 'mode=preview&t=0.6', '/tmp/shapes-grid-preview.png');
  await shoot(desktop, 'mode=preview&t=0.6&valid=0', '/tmp/shapes-grid-invalid.png');
  await shoot(desktop, 'mode=cast&t=0.2', '/tmp/shapes-grid-cast.png');
  await shoot(desktop, 'mode=cast&t=0.62', '/tmp/shapes-grid-cast-late.png');
}
if (!only || only === 'phone') {
  for (const id of (process.env.IDS ?? IDS.join(',')).split(',')) await shoot(phone, `char=${id}&mode=preview&t=0.6`, `/tmp/shapes-${id}.png`);
  for (const [id, t] of [['blade', 0.2], ['mage', 0.5], ['shadow', 0.15], ['warden', 0.05], ['bard', 0.05]]) await shoot(phone, `char=${id}&mode=cast&t=${t}`, `/tmp/shapes-${id}-cast.png`);
}
await browser.close();
if (errors.length) console.log('ERRORS', errors);
console.log(files.join('\n'));
