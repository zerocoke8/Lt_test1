// 기획 14차 교체 에너지 (debug toggle): open the debug panel, turn the rule on and move its two sliders (최대 에너지,
// 에너지 차는 속도), see the segmented bar above the cards and each card's '⚡N', drag a card in (the pool pays its cost,
// no re-appear cooldown), then try a card the pool cannot afford: refused with '에너지 부족'.

import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import type { Vec2 } from '../../src/types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
}

async function center(page: Page, selector: string): Promise<Vec2> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point on the field canvas near my character (screen px). */
function fieldFinger(page: Page): Promise<Vec2> {
  return page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const me = s.players[api.localPlayer];
    const canvas = document.querySelector('canvas.stage-canvas');
    const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
    const from = mine?.pos ?? { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 };
    for (const w of [{ x: from.x + 1.5, y: from.y - 1 }, { x: from.x - 1.5, y: from.y - 1 }, { x: from.x, y: from.y - 2 }, from]) {
      const f = api.ui.fingerFor(w);
      if (document.elementFromPoint(f.x, f.y) === canvas && f.x > 40 && f.x < window.innerWidth - 40) return f;
    }
    return api.ui.fingerFor(from);
  });
}

/** Real input: CDP touch on the phone, the mouse on desktop. */
async function drag(page: Page, context: BrowserContext, touch: boolean, from: Vec2, to: Vec2): Promise<void> {
  const steps = 14;
  if (touch) {
    const cdp: CDPSession = await context.newCDPSession(page);
    const at = (type: 'touchStart' | 'touchMove', p: Vec2) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await at('touchStart', from);
    for (let i = 1; i <= steps; i++) {
      await at('touchMove', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

const pool = (page: Page) => page.evaluate(() => window.__proto!.game!.state.players[0].energy?.value ?? null);

test('교체 에너지: 디버그 토글 + 두 슬라이더 → 에너지 바·카드 비용 → 교체가 에너지를 씀 → 비싼 카드는 거절', async ({ page, context }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => window.__proto!.startRun({ seed: 33, tunables: { invincible: true } }));
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  // off (default): no bar, no cost chip
  await expect(page.locator('.ccard')).toHaveCount(3);
  await expect(page.locator('.hud-energy')).toBeHidden();
  await expect(page.locator('.cc-cost:visible')).toHaveCount(0);

  // debug panel → 실험 규칙 → 교체 에너지 on, its two sliders right under it, live
  const dbg = page.locator('.btn-dbg');
  if (mobile) await dbg.tap();
  else await dbg.click();
  await expect(page.locator('.debug-panel')).toBeVisible();
  const block = page.locator('.dbg-mode[data-key="swapEnergyMode"]');
  await expect(block.locator('.dbg-slider[data-key="swapEnergyMax"] .dbg-slider-value')).toHaveText('10');
  await expect(block.locator('.dbg-slider[data-key="swapEnergyRegen"] .dbg-slider-value')).toHaveText('1.00/초');
  await block.locator('.dbg-toggle').click();
  await expect(block).toHaveClass(/is-on/);
  expect(await page.evaluate(() => window.__proto!.game!.tunables.swapEnergyMode)).toBe(true);
  await block.locator('.dbg-slider[data-key="swapEnergyMax"] input').fill('12');
  await expect(block.locator('.dbg-slider[data-key="swapEnergyMax"] .dbg-slider-value')).toHaveText('12');
  await block.locator('.dbg-slider[data-key="swapEnergyRegen"] input').fill('0.25');
  await expect(block.locator('.dbg-slider[data-key="swapEnergyRegen"] .dbg-slider-value')).toHaveText('0.25/초');
  expect(await page.evaluate(() => [window.__proto!.game!.tunables.swapEnergyMax, window.__proto!.game!.tunables.swapEnergyRegen])).toEqual([12, 0.25]);
  await page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).click();
  await expect(page.locator('.debug-panel')).toBeHidden();

  // the bar: one segment per energy (the max slider), full at the start; every card shows its cost
  await expect(page.locator('.hud-energy')).toBeVisible();
  await expect(page.locator('.hud-energy .en-seg')).toHaveCount(12);
  await expect(page.locator('.hud-energy .en-seg.is-full')).toHaveCount(12);
  await expect(page.locator('.cc-cost:visible')).toHaveCount(3);
  const costs = await page.evaluate(() => {
    const me = window.__proto!.game!.state.players[0];
    return me.party.map(m => m.defId);
  });
  const chips = await page.locator('.cc-cost').allTextContents();
  expect(chips.every(t => /^⚡[4-8]$/.test(t))).toBe(true);
  expect(costs.length).toBe(3);
  // the bar sits above the card row, clear of the cards
  const bar = await page.locator('.hud-energy').boundingBox();
  const active = await page.locator('.ccard.is-active').boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(active!.y + 1);

  // drag card 2 onto the field: the pool pays its cost; the card that left gets no cooldown number
  const cost1 = Number((await page.locator('.ccard[data-idx="1"] .cc-cost').textContent())!.slice(1));
  const before = (await pool(page))!;
  await drag(page, context, mobile, await center(page, '.ccard[data-idx="1"]'), await fieldFinger(page));
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].activeIndex === 1, undefined, { timeout: 3000 });
  const after = (await pool(page))!;
  expect(after).toBeGreaterThan(before - cost1 - 0.01);
  expect(after).toBeLessThan(before - cost1 + 1); // + a little regen at 0.25/s
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].party.map(m => m.swapCooldownRemaining))).toEqual([0, 0, 0]);
  await expect(page.locator('.ccard[data-idx="0"] .cc-cd')).toBeHidden();

  // empty the pool down to 2 (as if more swaps happened): every card is short — dimmed, red cost, '에너지 부족'
  await page.evaluate(() => (window.__proto!.game!.state.players[0].energy!.value = 2));
  await expect(page.locator('.ccard[data-idx="0"]')).toHaveClass(/is-short/);
  await expect(page.locator('.ccard[data-idx="0"] .cc-cost')).toHaveClass(/is-short/);
  await expect(page.locator('.ccard[data-idx="0"] .cc-state')).toHaveText('에너지 부족');
  await expect(page.locator('.hud-energy .en-seg.is-full')).toHaveCount(2);
  // dragging it is refused: the toast says how much it needs; nothing is spent
  await drag(page, context, mobile, await center(page, '.ccard[data-idx="0"]'), await fieldFinger(page));
  await expect(page.locator('.toast', { hasText: '에너지 부족' }).first()).toBeVisible({ timeout: 3000 });
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].activeIndex)).toBe(1);
  expect(await pool(page)).toBeLessThan(3);
  if (mobile) {
    await sleep(150);
    await page.screenshot({ path: 'docs/screenshots/energy-mode.png' });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

// 기획 14차: the debug panel's 「실험 규칙」 section with both test rules on — each toggle, its note and its own two sliders
// right under it, inside the panel (no sideways scroll). Phone run saves docs/screenshots/debug-modes.png.
test('디버그 패널 실험 규칙: 두 토글 + 각자의 슬라이더 두 개가 바로 아래', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => window.__proto!.startRun({ seed: 7, tunables: { invincible: true } }));
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  const dbg = page.locator('.btn-dbg');
  if (mobile) await dbg.tap();
  else await dbg.click();
  await expect(page.locator('.debug-panel')).toBeVisible();
  const blocks = page.locator('.dbg-mode');
  await expect(blocks).toHaveCount(2);
  expect(await blocks.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key))).toEqual(['ultPerCharacter', 'swapEnergyMode']);
  const want: Record<string, string[]> = {
    ultPerCharacter: ['ultFieldChargeTime', 'ultBenchRatio'],
    swapEnergyMode: ['swapEnergyMax', 'swapEnergyRegen'],
  };
  for (const [key, sliders] of Object.entries(want)) {
    const b = page.locator(`.dbg-mode[data-key="${key}"]`);
    expect(await b.locator('.dbg-slider').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key))).toEqual(sliders);
    await b.locator('.dbg-toggle').click();
    await expect(b).toHaveClass(/is-on/);
  }
  expect(await page.evaluate(() => [window.__proto!.game!.tunables.ultPerCharacter, window.__proto!.game!.tunables.swapEnergyMode])).toEqual([true, true]);
  await page.locator('.dbg-mode[data-key="swapEnergyMode"] .dbg-slider[data-key="swapEnergyMax"] input').fill('14');
  await page.locator('.dbg-mode[data-key="swapEnergyMode"] .dbg-slider[data-key="swapEnergyRegen"] input').fill('1.5');
  await expect(page.locator('.dbg-slider[data-key="swapEnergyRegen"] .dbg-slider-value')).toHaveText('1.50/초');
  // the panel never scrolls sideways; each block sits inside it
  const panel = page.locator('.debug-panel .dbg-body');
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // show the whole section: scroll the first block to the top of the panel body
  await page.locator('.dbg-mode[data-key="ultPerCharacter"]').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await sleep(200);
  // HUD behind the panel follows both rules at once
  await expect(page.locator('.hud-energy .en-seg')).toHaveCount(14);
  await expect(page.locator('.cc-ult:visible')).toHaveCount(3);
  if (mobile) await page.screenshot({ path: 'docs/screenshots/debug-modes.png' });
  expect(errors, errors.join('\n')).toEqual([]);
});

// 기획 14차 리뷰: on the phone a vertical swipe that starts on a slider scrolls the panel and leaves the value alone
// (in multiplayer the host would broadcast every accidental value); a sideways drag still sets it. The skill sheet's
// names are never cut to '…' with both test rules on (long names next to the per-character / energy triggers wrap).
test('폰: 슬라이더 위에서 세로로 밀면 패널만 스크롤 · 스킬 정보 이름이 잘리지 않음', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch gestures: phone only');
  const errors: string[] = [];
  await boot(page, errors);
  const party = ['gunner', 'chrono', 'mage'];
  await page.evaluate(p => window.__proto!.startRun({ seed: 5, players: [{ name: '나', isBot: false, characters: p, pets: ['frog_bomb', 'fairy_heal', 'owl_frost'] }], tunables: { invincible: true } }), party);
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  const cdp: CDPSession = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Vec2) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
  const swipe = async (from: Vec2, to: Vec2) => {
    await touch('touchStart', from);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
      await sleep(16);
    }
    await touch('touchEnd');
    await sleep(150);
  };
  await page.locator('.btn-dbg').tap();
  await expect(page.locator('.debug-panel')).toBeVisible();
  const keys = ['ultFieldChargeTime', 'ultBenchRatio', 'swapEnergyMax', 'swapEnergyRegen'] as const;
  const read = () => page.evaluate(k => k.map(x => window.__proto!.game!.tunables[x]), [...keys]);
  const before = await read();
  const body = page.locator('.debug-panel .dbg-body');
  const top0 = await body.evaluate(el => el.scrollTop);
  for (const key of keys) {
    const inp = page.locator(`.dbg-slider[data-key="${key}"] input`);
    await inp.scrollIntoViewIfNeeded();
    const box = (await inp.boundingBox())!;
    const from = { x: box.x + box.width * 0.85, y: box.y + box.height / 2 };
    await swipe(from, { x: from.x - 6, y: from.y - 80 });
  }
  expect(await read()).toEqual(before);
  expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(top0);
  // a sideways drag on the track still moves it
  const max = page.locator('.dbg-slider[data-key="swapEnergyMax"] input');
  await max.scrollIntoViewIfNeeded();
  const mb = (await max.boundingBox())!;
  await swipe({ x: mb.x + mb.width * 0.3, y: mb.y + mb.height / 2 }, { x: mb.x + mb.width * 0.8, y: mb.y + mb.height / 2 });
  expect(await page.evaluate(() => window.__proto!.game!.tunables.swapEnergyMax)).toBeGreaterThan(10);
  // both rules on → long-press each card: no skill name is cut off
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'tunables', patch: { ultPerCharacter: true, swapEnergyMode: true } }));
  await page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).tap();
  for (let i = 0; i < 3; i++) {
    const b = (await page.locator(`.ccard[data-idx="${i}"]`).boundingBox())!;
    await touch('touchStart', { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    await sleep(650);
    await touch('touchEnd');
    await expect(page.locator('.skill-sheet .ss-skill').first()).toBeVisible();
    const cut = await page.evaluate(() => [...document.querySelectorAll('.skill-sheet .ss-skill')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    expect(cut, `card ${i}`).toEqual([]);
    await touch('touchStart', { x: 420, y: 150 });
    await touch('touchEnd');
    await sleep(150);
  }
  await cdp.detach();
  expect(errors, errors.join('\n')).toEqual([]);
});
