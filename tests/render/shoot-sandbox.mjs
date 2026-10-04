// Screenshots of tests/visual/render-sandbox.html for a visual check of the renderer.
// 1) npx vite --port 5174   2) node tests/render/shoot-sandbox.mjs   → /tmp/render-*.png
import { chromium } from '@playwright/test';

const BASE = process.env.SANDBOX_URL ?? 'http://localhost:5174/tests/visual/render-sandbox.html';
const shots = [
  { name: 'normal', q: 'scene=normal&t=0.6' },
  { name: 'normal-cutin', q: 'scene=normal&t=0.5&cutin=1&drag=none' },
  { name: 'normal-appear', q: 'scene=normal&t=0.3&appear=1&drag=none' },
  { name: 'normal-drag-invalid', q: 'scene=normal&t=1.2&drag=invalid' },
  { name: 'normal-drag-pet', q: 'scene=normal&t=0.9&drag=pet' },
  { name: 'boss', q: 'scene=boss&t=0.5' },
  { name: 'boss-enraged', q: 'scene=boss&t=0.4&enraged=1' },
  { name: 'boss-cutin', q: 'scene=boss&t=0.45&cutin=1' },
  // real sim (all players bot-controlled) — integration check; prints an error in the HUD if the sim is WIP
  { name: 'sim-floor1', q: 'scene=sim&t=14' },
  { name: 'sim-floor5', q: 'scene=sim&floor=5&t=12' },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
for (const dpr of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const s of dpr === 1 ? shots : shots.filter(x => x.name === 'normal' || x.name === 'boss')) {
    await page.goto(`${BASE}?${s.q}`);
    await page.waitForFunction(() => window.__sandbox?.ready === true, null, { timeout: 60000 });
    const info = await page.evaluate(() => ({ avgMs: window.__sandbox.avgMs, error: window.__sandbox.error }));
    if (info.error) errors.push(`${s.name}: ${info.error}`);
    const file = `/tmp/render-${s.name}${dpr === 2 ? '-dpr2' : ''}.png`;
    await page.screenshot({ path: file });
    results.push({ file, avgMs: info.avgMs.toFixed(2) });
  }
  if (errors.length) console.log('ERRORS', errors);
  await page.close();
}
await browser.close();
console.table(results);
