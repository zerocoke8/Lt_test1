import { chromium } from '@playwright/test';
// Preset screen check (12 cards fit, no overlap / clipping) → /tmp/preset-*.png
// 1) npx vite --port 5176   2) node tests/visual/shoot-preset.mjs   [FOCUS=<character name> also taps a card]
const BASE = process.env.UI_URL ?? 'http://localhost:5176/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
for (const [name, opts] of [['phone', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForSelector('.preset:not(.is-hidden)', { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/preset-${name}.png` });
  const focusId = process.env.FOCUS;
  if (focusId) {
    // tap a card by visible name
    await page.locator('.ps-char', { hasText: focusId }).first().click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `/tmp/preset-${name}-focus.png` });
  }
  // overlap / cut-off check: every card fully inside the stage and not overlapping others
  const bad = await page.evaluate(() => {
    const out = [];
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.preset .ps-card, .preset .slot-chip, .preset .btn-start, .preset .ps-detail')].map(e => [e.className, e.getBoundingClientRect()]);
    for (const [c, r] of cards) if (r.left < stage.left - 0.5 || r.right > stage.right + 0.5 || r.top < stage.top - 0.5 || r.bottom > stage.bottom + 0.5) out.push('outside ' + c);
    const cs = cards.filter(([c]) => c.includes('ps-card'));
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i][1], b = cs[j][1];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push('overlap ' + i + ' ' + j);
    }
    // text overflow inside cards
    for (const el of document.querySelectorAll('.ps-card *')) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push('clip ' + el.className + ' ' + el.textContent);
    }
    return out;
  });
  console.log(name, bad.length ? bad : 'layout ok');
  await ctx.close();
}
await browser.close();
if (errors.length) console.log('ERRORS', errors);
