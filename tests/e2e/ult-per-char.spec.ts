// 기획 14차 궁극기 개별 게이지 (debug toggle): open the debug panel on the phone, turn the rule on and move its slider,
// see the per-card ult rings, then tap the ult button and cast the FIELD character's ult (its gauge only).

import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
}

const tap = async (page: Page, selector: string, mobile: boolean) => {
  const l = page.locator(selector).first();
  if (mobile) await l.tap();
  else await l.click();
};

test('궁극기 개별 게이지: 디버그 토글 + 슬라이더 → 카드마다 링 → 필드 캐릭터 궁극기', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => window.__proto!.startRun({ seed: 21, tunables: { invincible: true } }));
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  // off (default): no ring on any card
  await expect(page.locator('.ccard')).toHaveCount(3);
  await expect(page.locator('.cc-ult:visible')).toHaveCount(0);

  // debug panel → 실험 규칙 → 궁극기 개별 게이지 on, its two sliders right under it
  await tap(page, '.btn-dbg', mobile);
  await expect(page.locator('.debug-panel')).toBeVisible();
  const block = page.locator('.dbg-mode[data-key="ultPerCharacter"]');
  await expect(block.locator('.dbg-slider[data-key="ultFieldChargeTime"]')).toBeVisible();
  await expect(block.locator('.dbg-slider[data-key="ultBenchRatio"] .dbg-slider-value')).toHaveText('0.33×');
  await block.locator('.dbg-toggle').click();
  await expect(block).toHaveClass(/is-on/);
  expect(await page.evaluate(() => window.__proto!.game!.tunables.ultPerCharacter)).toBe(true);
  await block.locator('.dbg-slider[data-key="ultFieldChargeTime"] input').fill('6');
  expect(await page.evaluate(() => window.__proto!.game!.tunables.ultFieldChargeTime)).toBe(6);
  await page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).click();
  await expect(page.locator('.debug-panel')).toBeHidden();

  // three rings; the field card fills in ~6 s, the bench ones at a third of that
  await expect(page.locator('.cc-ult:visible')).toHaveCount(3);
  await expect(page.locator('.ccard.is-active .cc-ult')).toHaveClass(/is-full/, { timeout: 12_000 });
  await expect(page.locator('.ult')).toHaveClass(/is-full/);
  const before = await page.evaluate(() => window.__proto!.game!.state.players[0].party.map(m => m.ult!.charge));
  const field = await page.evaluate(() => window.__proto!.game!.state.players[0].activeIndex!);
  expect(before[field]).toBe(1);
  for (let i = 0; i < 3; i++) if (i !== field) expect(before[i]).toBeLessThan(0.8);
  await expect(page.locator('.ccard:not(.is-active) .cc-ult.is-full')).toHaveCount(0);
  // the ring sits inside the card's row, clear of the normal-skill diamond on the other edge
  const ring = await page.locator('.ccard.is-active .cc-ult').boundingBox();
  const gem = await page.locator('.ccard.is-active .cc-norm').boundingBox();
  const card = await page.locator('.ccard.is-active').boundingBox();
  expect(ring && gem && card).toBeTruthy();
  expect(ring!.x).toBeGreaterThan(gem!.x + gem!.width);
  expect(ring!.y).toBeGreaterThan(card!.y);
  expect(ring!.y + ring!.height).toBeLessThan(card!.y + card!.height);
  // inside every card: never over the gap where the next card's diamond sits
  for (let i = 0; i < 3; i++) {
    const r = await page.locator(`.ccard[data-idx="${i}"] .cc-ult`).boundingBox();
    const c = await page.locator(`.ccard[data-idx="${i}"]`).boundingBox();
    expect(r!.x + r!.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5);
  }
  if (mobile) await page.screenshot({ path: 'docs/screenshots/ult-per-char.png' });

  // tap the ult: the field character casts, only its gauge empties
  await tap(page, '.ult', mobile);
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 1, undefined, { timeout: 3000 });
  const after = await page.evaluate(() => window.__proto!.game!.state.players[0].party.map(m => m.ult!.charge));
  expect(after[field]).toBeLessThan(0.1);
  for (let i = 0; i < 3; i++) if (i !== field) expect(after[i]).toBeGreaterThanOrEqual(before[i]);
  // the cut-in on my screen (not a bot's corner banner) is the field character's ult — the name under the button
  const ultName = await page.locator('.ult-name').textContent();
  await page.waitForFunction(n => window.__proto!.ui.cutIns.some(c => c.kind !== 'mini' && c.name === n), ultName, { timeout: 3000 });
  await expect(page.locator('.ccard.is-active .cc-ult')).not.toHaveClass(/is-full/);
  expect(errors, errors.join('\n')).toEqual([]);
});
