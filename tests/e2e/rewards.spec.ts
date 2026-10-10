// 기획 17차 층 보상 화면 (docs/floor-rewards.md): 4 rarities (a 전설 card from the debug fixture), synergy tag chips with
// progress ('#공격 ●●○' → '3/3 완성!'), 「내 빌드」 sheet, 다시 뽑기 (count, new cards), 지명권 (tap a portrait: the card
// names that character, the pick goes to it), 「직업 특기」 following the tapped member's role, 욕심쟁이 (4 cards, pick 2,
// then the next screen as usual), 빚 (skipped screen toast). Phone screenshots: docs/screenshots/reward-legend.png,
// reward-build.png (reward.png itself is re-shot by smoke.spec.ts).

import { expect, test, type Page } from '@playwright/test';
import type { DebugAction, RewardOffer } from '../../src/types';
import type { AppPhase, RunOverrides } from '../../src/ui/app';

const SHOT_DIR = 'docs/screenshots';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  // every toast text that shows (they live < 2 s)
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('toast')) w.__toasts.push(n.textContent ?? '');
    }).observe(document.body, { childList: true, subtree: true });
  });
}

const start = (page: Page, setup: RunOverrides) => page.evaluate(s => window.__proto!.startRun(s), setup);
const waitPhase = (page: Page, want: AppPhase, timeout = 15_000) => page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
const debug = (page: Page, action: DebugAction) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a }), action);
const offers = (page: Page) => page.evaluate(() => window.__proto!.game!.state.rewardOffersByPlayer[0] ?? []) as Promise<RewardOffer[]>;
const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.slice());

async function grant(page: Page, rewardId: string, member: number | null = null): Promise<void> {
  expect((await debug(page, { kind: 'grantReward', rewardId, member })).ok, rewardId).toBe(true);
}

test('보상 화면: 전설 · 태그 진행 · 내 빌드 · 다시 뽑기 · 지명권', async ({ page }, testInfo) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 21, tunables: { invincible: true, goedamRoomsPerZone: 0 } });
  await page.waitForTimeout(800);
  // two #공격 cards and a few others → a #공격 card on the screen reads '3/3 완성!'
  for (const id of ['atk_common', 'crit_common', 'bolt_rare', 'relay_blast_common']) await grant(page, id);
  await grant(page, 'role_common', 0); // 근접딜러 특기: #등장 + #공격 → the third #공격
  await expect(page.locator('.rw-set-stamp .rw-set-big')).toHaveText('#공격 3개 모음!');
  await page.evaluate(() => {
    window.__proto!.game!.state.players[0].rerolls = 5;
  });
  expect((await debug(page, { kind: 'offerFixture' })).ok).toBe(true);
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  await waitPhase(page, 'reward');
  await expect(page.locator('.rw-card')).toHaveCount(3);
  // the fixture: a 전설 card in a new-family slot (never slot 1)
  await expect(page.locator('.rw-card.rarity-legendary')).toHaveCount(1);
  await expect(page.locator('.rw-card.rarity-legendary .rw-rarity')).toHaveText('전설');
  await expect(page.locator('.rw-card').first()).not.toHaveClass(/rarity-legendary/);
  await expect(page.locator('.rw-reroll')).toHaveText('다시 뽑기 5');
  // tag chips with progress on every card
  for (let i = 0; i < 3; i++) await expect(page.locator('.rw-card').nth(i).locator('.rw-tag').first()).toBeVisible();
  await sleep(500);
  if (testInfo.project.name === 'phone') await page.screenshot({ path: `${SHOT_DIR}/reward-legend.png` });

  // 내 빌드: 13 tag chips, the finished #공격 set first with its bonus, the rewards grouped
  await page.locator('.rw-build-chip').click();
  await expect(page.locator('.rw-build')).toBeVisible();
  await expect(page.locator('.rw-build .bp-tag')).toHaveCount(13);
  await expect(page.locator('.rw-build .bp-tag').first()).toHaveClass(/is-done/);
  await expect(page.locator('.rw-build .bp-bonus')).toContainText('#공격 모음');
  await expect(page.locator('.rw-build .bp-group').first()).toHaveText('파티');
  await expect(page.locator('.rw-build')).toContainText('특기');
  await sleep(300);
  if (testInfo.project.name === 'phone') await page.screenshot({ path: `${SHOT_DIR}/reward-build.png` });
  await page.locator('.rw-build').click();
  await expect(page.locator('.rw-build')).toBeHidden();

  // 다시 뽑기 until a card asks 「누구에게?」 (each one: count −1, different families)
  let who = await page.locator('.rw-card:has(.rw-who)').count();
  for (let n = 4; who === 0 && n >= 0; n--) {
    const before = (await offers(page)).map(o => o.family);
    await page.locator('.rw-reroll').click();
    await page.waitForFunction(b => (window.__proto!.game!.state.rewardOffersByPlayer[0] ?? []).map(o => o.family).join() !== b, before.join());
    const after = (await offers(page)).map(o => o.family);
    expect(after.some(f => before.includes(f))).toBe(false);
    await expect(page.locator('.rw-reroll')).toHaveText(`다시 뽑기 ${n}`);
    await sleep(450);
    who = await page.locator('.rw-card:has(.rw-who)').count();
  }
  expect(who, 'a member / role card within 5 rerolls').toBeGreaterThan(0);
  const card = page.locator('.rw-card:has(.rw-who)').first();
  const idx = await card.evaluate(el => [...el.parentElement!.children].indexOf(el));
  const offer = (await offers(page))[idx];
  const party = await page.evaluate(() => window.__proto!.game!.state.players[0].party.map(m => m.defId));
  // tap the third portrait: a member card names that character; a role card switches to that role
  await card.locator('.rw-who-p').nth(2).click();
  await expect(card.locator('.rw-who-p').nth(2)).toHaveClass(/is-picked/);
  const name = (await card.locator('.rw-name').textContent()) ?? '';
  if (offer.target === 'member') expect(name).toContain((await card.locator('.rw-who-p').nth(2).locator('.rw-who-n').textContent()) ?? '?');
  else expect(name).toMatch(/특기$/);
  await card.locator('.rw-pick').click();
  await waitPhase(page, 'combat');
  const got = await page.evaluate(() => window.__proto!.game!.state.players[0].rewards.at(-1));
  expect(got).toMatchObject({ rewardId: offer.rewardId, partyIndex: 2 });
  expect(party).toHaveLength(3);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('욕심쟁이 (4장 중 2장 → 다음 보상은 평소대로) · 빚쟁이 (보상 없음 알림)', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 22, tunables: { invincible: true, goedamRoomsPerZone: 0 } });
  await page.waitForTimeout(800);
  await grant(page, 'greedy_rare');
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  await waitPhase(page, 'reward');
  await expect(page.locator('.rw-card')).toHaveCount(4);
  await expect(page.locator('.rw-row')).toHaveClass(/is-four/);
  await expect(page.locator('.rw-sub')).toContainText('2장을 고르세요');
  await page.locator('.rw-card .rw-pick').first().click();
  await expect(page.locator('.rw-sub')).toHaveText('하나 더 고르세요 (1/2)');
  await expect(page.locator('.rw-card')).toHaveCount(3);
  await sleep(300);
  await page.locator('.rw-card .rw-pick').first().click();
  await waitPhase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.floor)).toBe(2);
  // 기획 17차 리뷰: the next normal screen comes as usual (3 cards, pick 1)
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  await waitPhase(page, 'reward');
  await expect(page.locator('.rw-card')).toHaveCount(3);
  await sleep(300);
  await page.locator('.rw-card .rw-pick').first().click();
  await waitPhase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.floor)).toBe(3);
  // 빚쟁이: an epic now, then the next normal screen goes ('빚 · 이번 보상 없음 (1층 남음)')
  const n0 = await page.evaluate(() => window.__proto!.game!.state.players[0].rewards.length);
  await grant(page, 'debt_rare');
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].rewards.length)).toBe(n0 + 2);
  await expect(page.locator('.hud-rwchip[data-chip="debt"]')).toHaveText('빚 2층');
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  await page.waitForFunction(() => window.__proto!.game!.state.floor === 4, undefined, { timeout: 10_000 });
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringContaining('빚 · 이번 보상 없음'));
  await expect(page.locator('.hud-rwchip[data-chip="debt"]')).toHaveText('빚 1층');
  expect(errors, errors.join('\n')).toEqual([]);
});
