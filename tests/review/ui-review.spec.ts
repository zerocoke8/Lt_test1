// UI rules review (real browser, touch): unavailable cards can't be dragged, drop point sits LIFT px above the
// finger, ult refuses on an empty field, sim timers frozen during pause and reward.
// Run: npx playwright test -c tests/review/playwright.review.config.ts

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { Vec2 } from '../../src/types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function touchDrag(cdp: CDPSession, from: Vec2, to: Vec2): Promise<() => Promise<void>> {
  const send = (type: 'touchStart' | 'touchMove', p: Vec2) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await send('touchStart', from);
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    await send('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await sleep(16);
  }
  await sleep(80);
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(80);
  };
}

async function cardCenter(page: Page, sel: string, i: number): Promise<Vec2> {
  const b = await page.locator(sel).nth(i).boundingBox();
  if (!b) throw new Error(`no ${sel} ${i}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const st = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const g = window.__proto.game; return (${fn}); })()`) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__proto);
  await page.evaluate(() => window.__proto!.startRun({ seed: 4242, tunables: { invincible: true } }));
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  await sleep(300);
});

test('unavailable cards cannot be dragged; drop point is LIFT (80 logical px) above the finger', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const scale = await page.evaluate(() => {
    const el = document.querySelector('.stage') as HTMLElement;
    return el.getBoundingClientRect().width / 1280;
  });

  // 1) active card (index 0) → refused, no ghost, nothing changes
  const c0 = await cardCenter(page, '.ccard', 0);
  let release = await touchDrag(cdp, c0, { x: c0.x + 120, y: c0.y - 170 });
  expect(await page.locator('.drag-ghost.is-hidden').count()).toBe(1);
  await release();
  expect(await st<number | null>(page, 'g.state.players[0].activeIndex')).toBe(0);
  expect(await st<number>(page, 'g.state.players[0].stats.swaps')).toBe(0);

  // 2) bench card 1: while holding, the drop marker is LIFT×scale client px above the finger
  const c1 = await cardCenter(page, '.ccard', 1);
  const finger = { x: c1.x + 200, y: c1.y - 140 };
  release = await touchDrag(cdp, c1, finger);
  const dot = await page.locator('.drag-dot').boundingBox();
  expect(dot).not.toBeNull();
  const dotCenter = { x: dot!.x + dot!.width / 2, y: dot!.y + dot!.height / 2 };
  expect(Math.abs(dotCenter.x - finger.x)).toBeLessThan(3);
  expect(Math.abs(finger.y - dotCenter.y - 80 * scale)).toBeLessThan(3);
  // the world point under the drop marker (camera is frozen while dragging) is where the character appears
  const map = await page.evaluate(() => [window.__proto!.ui.fingerFor({ x: 0, y: 0 }), window.__proto!.ui.fingerFor({ x: 1, y: 1 })]);
  const kx = map[1].x - map[0].x;
  const ky = map[1].y - map[0].y;
  // fingerFor(world) = finger whose marker lands on world → invert for our finger
  const expectWorld = { x: (finger.x - map[0].x) / kx, y: (finger.y - map[0].y) / ky };
  await release();
  expect(await st<number | null>(page, 'g.state.players[0].activeIndex')).toBe(1);
  const appearedAt = await st<Vec2>(page, 'g.state.entities.find(e => e.kind === "character" && e.ownerPlayer === 0).pos');
  expect(Math.abs(appearedAt.x - expectWorld.x)).toBeLessThan(0.15);
  expect(Math.abs(appearedAt.y - expectWorld.y)).toBeLessThan(0.15);

  // 3) during the appear lock (game speed 0 so it never runs out) card 2 is refused
  await page.evaluate(() => (window.__proto!.game!.tunables.gameSpeed = 0));
  const c2 = await cardCenter(page, '.ccard', 2);
  release = await touchDrag(cdp, c2, { x: c2.x + 250, y: c2.y - 150 });
  expect(await page.locator('.drag-ghost.is-hidden').count()).toBe(1);
  await release();
  expect(await st<number | null>(page, 'g.state.players[0].activeIndex')).toBe(1);
  expect(await st<number>(page, 'g.state.players[0].stats.swaps')).toBe(1);
});

test('ult is refused (and shown disabled) while the field is empty; gauge stays full', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__proto!.game!;
    g.tunables.invincible = false;
    g.tunables.monsterDmgMult = 200;
    g.tunables.gameSpeed = 4;
    g.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
  });
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].activeIndex === null, null, { timeout: 60_000 });
  await page.evaluate(() => (window.__proto!.game!.tunables.gameSpeed = 0));
  await sleep(150);
  await expect(page.locator('.ult')).toHaveClass(/is-disabled/);
  const b = await page.locator('.ult').boundingBox();
  await page.touchscreen.tap(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await sleep(150);
  expect(await st<number>(page, 'g.state.players[0].ult.charge')).toBe(1);
  expect(await st<number>(page, 'g.state.players[0].stats.ultsUsed')).toBe(0);
  await expect(page.locator('.empty-hint')).not.toHaveClass(/is-hidden/);
});

test('sim time frozen while paused and during the reward screen', async ({ page }) => {
  await page.evaluate(() => window.__proto!.setPaused(true));
  const t0 = await st<number>(page, 'g.state.time');
  await sleep(800);
  expect(await st<number>(page, 'g.state.time')).toBe(t0);
  await page.evaluate(() => window.__proto!.setPaused(false));
  await sleep(400);
  expect(await st<number>(page, 'g.state.time')).toBeGreaterThan(t0);
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }));
  await page.waitForFunction(() => window.__proto?.phase === 'reward');
  const snap = await st<string>(page, 'JSON.stringify([g.state.time, g.state.timeRemaining, g.state.players.map(p => [p.ult.charge, p.party.map(m => m.swapCooldownRemaining)])])');
  await sleep(800);
  expect(await st<string>(page, 'JSON.stringify([g.state.time, g.state.timeRemaining, g.state.players.map(p => [p.ult.charge, p.party.map(m => m.swapCooldownRemaining)])])')).toBe(snap);
  await expect(page.locator('.rw-card')).toHaveCount(3);
});
