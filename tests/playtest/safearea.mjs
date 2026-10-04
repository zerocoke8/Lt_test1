// Safe-area check: headless Chromium reports env(safe-area-inset-*) = 0, so emulate an iPhone 14 in landscape
// (notch side 47 px, other side 47 px, home indicator 21 px) by overriding the stage's safe-area probe padding.
// Also measures HUD hit-target sizes in css px and finds overlaps between HUD blocks.
import fs from 'node:fs';
import { BASE, center, hudBoxes, launch, sleep, waitPhase } from './lib.mjs';

const pt = await launch('phone', { tag: 'phone-safe' });
const { page, input } = pt;
const res = {};
await page.goto(BASE);
await waitPhase(page, 'preset');
await page.addStyleTag({ content: '.safe-probe{padding:0 47px 21px 47px !important}' });
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await sleep(300);
await pt.shot('preset', 'preset with iPhone insets');
await input.tap(await center(page, '.btn-start'));
await waitPhase(page, 'combat');
await page.waitForFunction(() => window.__proto.game.state.monstersAlive >= 3, undefined, { timeout: 20000 });
await sleep(500);
await pt.shot('combat', 'combat with iPhone insets (L/R 47, bottom 21)');
res.boxes = await hudBoxes(page);
res.targets = await page.evaluate(() => {
  const q = s => [...document.querySelectorAll(s)].map(e => {
    const r = e.getBoundingClientRect();
    return { s, w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1), bottomGap: +(innerHeight - r.bottom).toFixed(1) };
  });
  return [...q('.ccard'), ...q('.pcard'), ...q('.ult'), ...q('.hud-tr .icon-btn'), ...q('.btn-dbg')];
});
// pause menu + debug panel sizes
await input.tap(await center(page, '.hud-tr .icon-btn:last-child'));
await sleep(300);
await pt.shot('pause', 'pause menu');
res.pauseBtns = await page.evaluate(() => [...document.querySelectorAll('.pause .btn')].map(b => {
  const r = b.getBoundingClientRect();
  return { t: b.textContent, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
}));
const resume = page.locator('.pause .btn').first();
const rb = await resume.boundingBox();
await input.tap({ x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 });
await sleep(200);
await input.tap(await center(page, '.btn-dbg'));
await sleep(200);
res.dbg = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.debug-panel button, .debug-panel input[type=range], .debug-panel .dbg-toggle')];
  const sz = all.map(b => b.getBoundingClientRect()).map(r => ({ w: +r.width.toFixed(1), h: +r.height.toFixed(1) }));
  return { count: sz.length, minH: Math.min(...sz.map(s => s.h)), small: sz.filter(s => s.h < 30).length };
});
await pt.shot('debug', 'debug panel with insets');
fs.writeFileSync('/tmp/playtest-phone-safe.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
console.log('errors', pt.errors);
await pt.browser.close();
