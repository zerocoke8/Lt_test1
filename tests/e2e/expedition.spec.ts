// 기획 15차 원정 (docs/expedition.md): the solo expedition from the main menu — stage 1 → (debug clear) → loot + choice →
// 다음 단계 도전 (double tap: the bag is at stake) → stage 2 → 수령하고 나가기 → the stash has the items → equipping shows on
// the doll and in battle; the start-stage rule with debug-granted T1 gear; a lost stage loses the bag only.
// Phone screenshots: docs/screenshots/expedition-{main,hub,match,choice,equip,gear-battle}.png.

import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'docs/screenshots';

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  // automation lands on the classic preset; ?main=1 opens the main menu like a person sees it
  await page.goto('/?main=1');
  await page.waitForFunction(() => window.__proto?.phase === 'main');
}

const tapper = (page: Page, mobile: boolean) => async (selector: string) => {
  const l = page.locator(selector).first();
  await expect(l).toBeVisible();
  if (mobile) await l.tap();
  else await l.click();
};

const phase = (page: Page, p: string, timeout = 15_000) => page.waitForFunction(x => window.__proto?.phase === x, p, { timeout });

const stash = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('swapTower.expedition.v1') ?? 'null') as { items: { uid: string; slot: string; tier: number }[]; equipped: Record<string, Record<string, string>> } | null);

const clearStage = (page: Page) => page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }));

test('원정: 1단계 → 클리어 → 도전(두 번 탭) → 2단계 → 수령 → 보관함 → 장착하면 인형이 바뀜', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const shots = mobile;
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  await boot(page, errors);
  await expect(page.locator('.main-menu .mm-card')).toHaveCount(2);
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-main.png` });

  await tap('.mm-exp');
  await phase(page, 'expHub');
  expect(await page.evaluate(() => localStorage.getItem('swapTower.mode.v1'))).toBe('expedition');
  await expect(page.locator('.exp-stage')).toHaveCount(12);
  await expect(page.locator('.exp-stage.is-locked')).toHaveCount(11); // empty slots → stage 1 only
  await expect(page.locator('.exp-stage.is-boss')).toHaveCount(4);
  await expect(page.locator('.exp-go')).toHaveText('1단계부터 출발');

  // stage 1: solo match = 「혼자 하기 · 봇 2명과 출발」 then the stage starts
  await tap('.exp-go');
  await phase(page, 'expMatch');
  await expect(page.locator('.exp-mt-title')).toHaveText('혼자 하기 · 봇 2명과 출발');
  await expect(page.locator('.exp-seat')).toHaveCount(3);
  await phase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.expedition?.stage)).toBe(1);
  await expect(page.locator('.fi-floor')).toHaveText('1단계 1층');
  await expect(page.locator('.exp-pill-bag')).toHaveText('가방 0');

  await clearStage(page);
  await phase(page, 'expChoice');
  await expect(page.locator('.exp-ch-title')).toHaveText('1단계 클리어!');
  await expect(page.locator('.exp-loot')).toHaveCount(2);
  await expect(page.locator('.exp-ch-bag .exp-tile')).toHaveCount(2);
  await page.waitForTimeout(1300); // the reveal flips
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-choice.png` });
  // every loot / bag tile opens a read-only sheet (name, slot, stats, compare); a tap anywhere closes it
  await expect(page.locator('.exp-loot-name')).toHaveCount(2);
  await tap('.exp-ch-bag .exp-tile');
  await expect(page.locator('.exp-info')).toBeVisible();
  await expect(page.locator('.exp-info .exp-cmp-name')).not.toHaveText('');
  await expect(page.locator('.exp-info .exp-cmp-cap')).toContainText('T1');
  await tap('.exp-info');
  await expect(page.locator('.exp-info')).toHaveCount(0);

  // the bag is at stake: the first tap only warns
  await tap('.exp-continue');
  await expect(page.locator('.exp-choice-risk')).toContainText('한 번 더 누르면 도전');
  expect(await page.evaluate(() => window.__proto!.phase)).toBe('expChoice');
  await tap('.exp-continue');
  await phase(page, 'expMatch');
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-match.png` });
  await phase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.expedition?.stage)).toBe(2);
  await expect(page.locator('.exp-pill-bag')).toHaveText('가방 2');

  await clearStage(page);
  await phase(page, 'expChoice');
  await expect(page.locator('.exp-ch-bag .exp-tile')).toHaveCount(4);
  await tap('.exp-extract');
  await phase(page, 'expResult');
  await expect(page.locator('.exp-rs-title')).toHaveText('탈출 성공!');
  await expect(page.locator('.exp-rs-gained .exp-tile')).toHaveCount(4);
  const s1 = await stash(page);
  expect(s1?.items).toHaveLength(4);

  // straight to the equip screen (NEW items), equip the first one on the first party member
  await tap('.exp-rs-equip');
  await phase(page, 'expEquip');
  await expect(page.locator('.exp-grid .exp-tile')).toHaveCount(4);
  const charId = await page.locator('.exp-char.is-current').getAttribute('data-char');
  await tap('.exp-grid .exp-tile');
  await expect(page.locator('.exp-drawer')).toBeVisible();
  await tap('.exp-equip-btn');
  await expect(page.locator('.exp-drawer')).toBeHidden();
  const s2 = await stash(page);
  const worn = Object.values(s2!.equipped[charId!] ?? {});
  expect(worn).toHaveLength(1);
  await expect(page.locator('.exp-slot:not(.is-empty) .exp-tile')).toHaveCount(1);
  await expect(page.locator('.exp-char.is-current .exp-pip:not(.is-empty)')).toHaveCount(1);
  // the doll is drawn from the same loadout the battle uses
  const bands = await page.evaluate(id => {
    const s = JSON.parse(localStorage.getItem('swapTower.expedition.v1')!);
    const uid = Object.values(s.equipped[id] as Record<string, string>)[0];
    return s.items.find((i: { uid: string }) => i.uid === uid);
  }, charId!);
  expect(bands.tier).toBeGreaterThanOrEqual(1);
  // auto-equip puts the rest on the party
  await tap('.exp-auto');
  const s3 = await stash(page);
  const wornAll = Object.values(s3!.equipped).flatMap(x => Object.values(x));
  expect(wornAll.length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-equip.png` });

  await tap('.exp-equip .exp-back');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-stash-chip')).toHaveText('보관함 4');
  expect(errors).toEqual([]);
});

test('원정: 시작 단계 규칙 (디버그 T1 한 벌 → 2단계까지) · 실패하면 가방만 잃음', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  await boot(page, errors);
  await tap('.mm-exp');
  await phase(page, 'expHub');
  await tap('.exp-dbg');
  await tap('.exp-dbg-party[data-tier="1"]');
  await tap('.exp-dbg-panel .dbg-hbtn');
  await expect(page.locator('.exp-stage.is-locked')).toHaveCount(10);
  await expect(page.locator('.exp-stage[data-stage="2"]')).toHaveClass(/is-reco/);
  await expect(page.locator('.exp-stage[data-stage="3"]')).toHaveClass(/is-locked/);
  await expect(page.locator('.exp-go')).toHaveText('2단계부터 출발');
  await expect(page.locator('.exp-start-info')).toHaveText('출발 가능: 2단계까지');
  await expect(page.locator('.exp-hint')).toContainText('3단계:');
  // a locked stage cannot be picked; stage 1 can
  await tap('.exp-stage[data-stage="3"]');
  await expect(page.locator('.exp-go')).toHaveText('2단계부터 출발');
  await tap('.exp-stage[data-stage="1"]');
  await expect(page.locator('.exp-go')).toHaveText('1단계부터 출발');
  await tap('.exp-stage[data-stage="2"]');

  // the party's dolls show their gear dots (3 bands + an empty relic)
  await expect(page.locator('.exp-party-card').first().locator('.exp-pip:not(.is-empty)')).toHaveCount(3);

  // play stage 2, then lose it (quit = the stage is lost): the failure screen, worn gear kept
  const before = await stash(page);
  await tap('.exp-go');
  await phase(page, 'combat');
  const g = await page.evaluate(() => window.__proto!.game!.state.players.map(p => p.gear?.map(l => l.weapon?.tier ?? 0) ?? null));
  expect(g[0]).toEqual([1, 1, 1]); // mine
  expect(g[1]).toEqual([1, 1, 1]); // bots: T(stage − 1) commons
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'quit' }));
  await phase(page, 'expResult');
  await expect(page.locator('.exp-rs-title')).toHaveText('원정 실패');
  await expect(page.locator('.exp-rs-safe .exp-rs-doll')).toHaveCount(3);
  const after = await stash(page);
  expect(after?.items.length).toBe(before?.items.length);
  expect(after?.equipped).toEqual(before?.equipped);
  await tap('.exp-rs-hub');
  await phase(page, 'expHub');

  // the expedition party lives apart from the classic preset; ← 메인 → 클래식 탑 is today's preset
  await tap('.exp-hub .exp-back');
  await phase(page, 'main');
  await tap('.mm-classic');
  await phase(page, 'preset');
  await expect(page.locator('.preset .ps-title')).toHaveText('클래식 탑 편성');
  await expect(page.locator('.preset .btn-start')).toHaveText('출발');
  await expect(page.locator('.preset .ps-gear:visible')).toHaveCount(0);
  await tap('.preset .ps-back');
  await phase(page, 'main');
  expect(errors).toEqual([]);
});

test('원정: 장비가 전투 화면에 보임 (원정대 T12 + 유물, 10단계)', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  await boot(page, errors);
  await tap('.mm-exp');
  await phase(page, 'expHub');
  await tap('.exp-dbg');
  await tap('.exp-dbg-party[data-tier="9"]');
  await tap('.exp-dbg-panel .dbg-btn:has-text("유물 8종")');
  await tap('.exp-dbg-panel .dbg-hbtn');
  await tap('.exp-party-card');
  await phase(page, 'expEquip');
  await tap('.exp-auto');
  await tap('.exp-equip .exp-back');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-go')).toHaveText('10단계부터 출발');
  if (testInfo.project.name === 'phone') await page.screenshot({ path: `${SHOTS}/expedition-hub.png` });
  await tap('.exp-go');
  await phase(page, 'combat');
  const gear = await page.evaluate(() => window.__proto!.game!.state.players[0].gear!);
  expect(gear.every(l => l.weapon?.tier === 9 && l.armor?.tier === 9 && l.charm?.tier === 9)).toBe(true);
  expect(gear.filter(l => l.relic).length).toBe(3);
  await expect(page.locator('.fi-floor')).toHaveText('10단계 1층');
  await page.waitForTimeout(5000);
  if (testInfo.project.name === 'phone') await page.screenshot({ path: `${SHOTS}/expedition-gear-battle.png` });
  expect(errors).toEqual([]);
});
