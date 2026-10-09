// 기획 15차 · 16차 원정 (docs/expedition.md): the solo expedition from the main menu. 기획 16차: one floor per stage and
// every stage ends in the 원정 lobby — stage 1 → (debug clear) → floor reward → the lobby with the run (loot reveal, bag 1,
// equipment / party locked) → a reload keeps the run → 「2단계 매칭」 (double tap: the bag is at stake) → stage 2 → the
// lobby (bag 2) → 「수령」 → the stash has both items → equipping works again. A lost stage loses the bag only; a reload
// mid-stage is a loss too (after the combat was won it is a clear); the in-game debug 「단계 즉시 클리어」 on a boss stage
// goes straight to the lobby (loot + box).
// Phone screenshots: docs/screenshots/expedition-{main,hub,stage-clear,lobby-run,match,equip,gear-battle}.png.

import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'docs/screenshots';
const STASH_KEY = 'swapTower.expedition.v1';

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

interface StoredRun {
  id: string;
  stage: number;
  cleared: number;
  status: string;
  bag: { tier: number }[];
}
interface Stored {
  items: { uid: string; slot: string; tier: number }[];
  equipped: Record<string, Record<string, string>>;
  bossFirstClears: number[];
  run: StoredRun | null;
}
const stash = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null') as Stored | null, STASH_KEY);

const clearStage = (page: Page) => page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }));

/** After the clear: pick the floor reward by tapping a card, pass a 괴담 room if one opens, until the lobby is up. */
async function finishStage(page: Page, tap: (s: string) => Promise<void>): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const p = await page.evaluate(() => window.__proto!.phase);
    if (p === 'expHub' || p === 'expResult') return;
    if (p === 'reward') {
      await expect(page.locator('.rw-exp-note')).toHaveText('수령하면 이 보상은 사라져요');
      await tap('.rw-card');
    } else if (p === 'goedam') await page.evaluate(() => {
          // the room: 「지나간다」, then read the result card away
          window.__proto!.game!.dispatch({ type: 'goedam', player: 0, option: 'leave' });
          window.__proto!.game!.dispatch({ type: 'goedam', player: 0, option: 'continue' });
        });
    await page.waitForTimeout(250);
  }
  throw new Error(`the stage never reached the lobby (phase ${await page.evaluate(() => window.__proto!.phase)}, sim ${await page.evaluate(() => window.__proto!.game?.state.phase)})`);
}

test('원정: 1단계 → 클리어 → 층 보상 → 로비(런 진행 중, 잠금) → 새로고침 → 2단계 매칭(두 번 탭) → 수령 → 장착', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const shots = mobile;
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  await boot(page, errors);
  await expect(page.locator('.main-menu .mm-card')).toHaveCount(2);
  await expect(page.locator('.mm-exp .mm-card-sub')).toHaveText('12단계 · 단계마다 로비 · 나가면 장비를 지켜요');
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-main.png` });

  await tap('.mm-exp');
  await phase(page, 'expHub');
  expect(await page.evaluate(() => localStorage.getItem('swapTower.mode.v1'))).toBe('expedition');
  await expect(page.locator('.exp-stage')).toHaveCount(12);
  await expect(page.locator('.exp-stage.is-locked')).toHaveCount(11); // empty slots → stage 1 only
  await expect(page.locator('.exp-stage.is-boss')).toHaveCount(4);
  await expect(page.locator('.exp-stage[data-stage="1"] .exp-stage-loot')).toHaveText('장비 1');
  await expect(page.locator('.exp-stage[data-stage="3"] .exp-stage-loot')).toHaveText('장비 2 · 유물 확률');
  await expect(page.locator('.exp-go')).toHaveText('1단계부터 출발');
  await expect(page.locator('.exp-run')).toBeHidden();

  // stage 1: solo match = 「혼자 하기 · 봇 2명과 출발」 then the stage starts (the run is saved before the game)
  await tap('.exp-go');
  await phase(page, 'expMatch');
  await expect(page.locator('.exp-mt-title')).toHaveText('혼자 하기 · 봇 2명과 출발');
  await expect(page.locator('.exp-seat')).toHaveCount(3);
  if (shots) {
    await page.waitForTimeout(350); // the screen's fade-in (the solo match shows for 1 s)
    await page.screenshot({ path: `${SHOTS}/expedition-match.png` });
  }
  await phase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.expedition?.stage)).toBe(1);
  await expect(page.locator('.fi-floor')).toHaveText('1단계');
  await expect(page.locator('.fi-zone')).toHaveText('· 로비');
  await expect(page.locator('.exp-pill-bag')).toHaveText('가방 0');
  await expect(page.locator('.exp-pill-dot')).toHaveCount(0);
  expect((await stash(page))?.run).toMatchObject({ stage: 1, cleared: 0, status: 'inStage' });

  // clear → floor reward (「수령하면 이 보상은 사라져요」) → the lobby with the loot reveal
  await clearStage(page);
  await finishStage(page, tap);
  await phase(page, 'expHub');
  await expect(page.locator('.exp-reveal')).toBeVisible();
  await expect(page.locator('.exp-reveal-title')).toHaveText('1단계 클리어!');
  await expect(page.locator('.exp-reveal .exp-loot')).toHaveCount(1);
  await page.waitForTimeout(1200); // the flip
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-stage-clear.png` });
  await tap('.exp-reveal-ok');
  await expect(page.locator('.exp-reveal')).toBeHidden();
  await expect(page.locator('.exp-run')).toBeVisible();
  await expect(page.locator('.exp-map')).toBeHidden();
  await expect(page.locator('.exp-run-title')).toHaveText('원정 진행 중 · 1단계까지 클리어');
  await expect(page.locator('.exp-run-bag .exp-tile')).toHaveCount(1);
  await expect(page.locator('.exp-run-bag .exp-tile-new')).toHaveCount(1);
  await expect(page.locator('.exp-path-dot.is-done')).toHaveCount(1);
  await expect(page.locator('.exp-path-dot.is-next')).toHaveAttribute('data-stage', '2');
  await expect(page.locator('.exp-next-match .exp-choice-title')).toHaveText('2단계 매칭');
  await expect(page.locator('.exp-run-risk')).toHaveText('실패하면 가방 1개를 잃어요 (장착 장비는 안전)');
  // the floor reward (+ whatever a 괴담 room gave) is carried
  await expect(page.locator('.exp-buff-chip')).toContainText('버프');
  await tap('.exp-buff-chip');
  expect(await page.locator('.exp-buff-row').count()).toBeGreaterThanOrEqual(1);
  await tap('.exp-buff-list');
  expect((await stash(page))?.run).toMatchObject({ stage: 2, cleared: 1, status: 'lobby' });
  expect((await stash(page))?.items).toHaveLength(0); // the bag is not in the stash yet

  // a bag tile opens the read-only sheet
  await tap('.exp-run-bag .exp-tile');
  await expect(page.locator('.exp-info')).toBeVisible();
  await expect(page.locator('.exp-info .exp-cmp-cap')).toContainText('T1');
  await tap('.exp-info');
  await expect(page.locator('.exp-info')).toHaveCount(0);

  // locked: the party and the equipment (the equip screen opens read-only)
  await tap('.exp-edit-party');
  await expect(page.locator('.toasts-exp .toast').last()).toHaveText('원정 중에는 장비·편성을 바꿀 수 없어요');
  expect(await page.evaluate(() => window.__proto!.phase)).toBe('expHub');
  await tap('.exp-party-card');
  await phase(page, 'expEquip');
  await expect(page.locator('.exp-readonly')).toBeVisible();
  await tap('.exp-auto');
  await expect(page.locator('.toasts-exp .toast').last()).toHaveText('원정 중에는 장비·편성을 바꿀 수 없어요');
  await tap('.exp-equip .exp-back');
  await phase(page, 'expHub');

  // a reload in the lobby keeps the run (main card: 「진행 중: 2단계 대기 · 가방 1」)
  await page.reload();
  await phase(page, 'main');
  await expect(page.locator('.mm-exp-foot')).toHaveText('진행 중: 2단계 대기 · 가방 1');
  await tap('.mm-exp');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-run-bag .exp-tile')).toHaveCount(1);

  // 「2단계 매칭」: the bag is at stake → the first tap only warns
  await tap('.exp-next-match');
  await expect(page.locator('.exp-next-match .exp-choice-sub')).toContainText('한 번 더 누르면 매칭');
  expect(await page.evaluate(() => window.__proto!.phase)).toBe('expHub');
  await tap('.exp-next-match');
  await phase(page, 'expMatch');
  await phase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.expedition?.stage)).toBe(2);
  // the floor reward of stage 1 is carried
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].rewards.length)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.exp-pill-bag')).toHaveText('가방 1');

  await clearStage(page);
  await finishStage(page, tap);
  await phase(page, 'expHub');
  await tap('.exp-reveal-ok');
  await expect(page.locator('.exp-run-bag .exp-tile')).toHaveCount(2);
  await expect(page.locator('.exp-run-bag .exp-tile-new')).toHaveCount(1);
  await page.waitForTimeout(700);
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-lobby-run.png` });

  // 「수령」: the whole bag into the stash, the run ends
  await tap('.exp-claim');
  await phase(page, 'expResult');
  await expect(page.locator('.exp-rs-title')).toHaveText('수령 완료!');
  await expect(page.locator('.exp-rs-gained .exp-tile')).toHaveCount(2);
  const s1 = await stash(page);
  expect(s1?.items).toHaveLength(2);
  expect(s1?.run).toBeNull();

  // straight to the equip screen (NEW items): not read-only any more — equip the first one
  await tap('.exp-rs-equip');
  await phase(page, 'expEquip');
  await expect(page.locator('.exp-readonly')).toBeHidden();
  await expect(page.locator('.exp-grid .exp-tile')).toHaveCount(2);
  const charId = await page.locator('.exp-char.is-current').getAttribute('data-char');
  await tap('.exp-grid .exp-tile');
  await expect(page.locator('.exp-drawer')).toBeVisible();
  await tap('.exp-equip-btn');
  await expect(page.locator('.exp-drawer')).toBeHidden();
  const s2 = await stash(page);
  expect(Object.values(s2!.equipped[charId!] ?? {})).toHaveLength(1);
  await expect(page.locator('.exp-slot:not(.is-empty) .exp-tile')).toHaveCount(1);
  await tap('.exp-auto');
  const s3 = await stash(page);
  expect(Object.values(s3!.equipped).flatMap(x => Object.values(x)).length).toBe(2);
  await page.waitForTimeout(2600); // the toast fades
  if (shots) await page.screenshot({ path: `${SHOTS}/expedition-equip.png` });

  await tap('.exp-equip .exp-back');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-stash-chip')).toHaveText('보관함 2');
  await expect(page.locator('.exp-map')).toBeVisible();
  expect(errors).toEqual([]);
});

test('원정: 시작 단계 규칙 · 실패하면 가방만 잃음 · 단계 도중 새로고침 = 실패', async ({ page }, testInfo) => {
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
  await expect(page.locator('.exp-go')).toHaveText('2단계부터 출발');
  await expect(page.locator('.exp-start-info')).toHaveText('출발 가능: 2단계까지');
  await expect(page.locator('.exp-hint')).toContainText('3단계:');
  await tap('.exp-stage[data-stage="3"]'); // locked: not picked
  await expect(page.locator('.exp-go')).toHaveText('2단계부터 출발');
  await tap('.exp-stage[data-stage="1"]');
  await expect(page.locator('.exp-go')).toHaveText('1단계부터 출발');
  await expect(page.locator('.exp-party-card').first().locator('.exp-pip:not(.is-empty)')).toHaveCount(3);

  // stage 1 cleared → lobby (bag 1) → stage 2 → quit = the stage is lost: the bag goes, worn gear stays
  const before = await stash(page);
  await tap('.exp-go');
  await phase(page, 'combat');
  const g = await page.evaluate(() => window.__proto!.game!.state.players.map(p => p.gear?.map(l => l.weapon?.tier ?? 0) ?? null));
  expect(g[0]).toEqual([1, 1, 1]); // mine
  await clearStage(page);
  await finishStage(page, tap);
  await tap('.exp-reveal-ok');
  // DBG grants are locked while the run exists
  await tap('.exp-dbg');
  await expect(page.locator('.exp-dbg-note')).toBeVisible();
  await tap('.exp-dbg-party[data-tier="3"]');
  await expect(page.locator('.toasts-exp .toast').last()).toHaveText('원정 중에는 장비·편성을 바꿀 수 없어요');
  await tap('.exp-dbg-panel .dbg-hbtn');
  expect((await stash(page))?.items.length).toBe(before?.items.length);
  await tap('.exp-next-match');
  await tap('.exp-next-match');
  await phase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.players[1].gear?.map(l => l.weapon?.tier ?? 0))).toEqual([1, 1, 1]); // bots: T(stage − 1)
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'quit' }));
  await phase(page, 'expResult');
  await expect(page.locator('.exp-rs-title')).toHaveText('원정 실패');
  await expect(page.locator('.exp-rs-lost .exp-tile')).toHaveCount(1);
  await expect(page.locator('.exp-rs-safe .exp-rs-doll')).toHaveCount(3);
  const after = await stash(page);
  expect(after?.run).toBeNull();
  expect(after?.items.length).toBe(before?.items.length);
  expect(after?.equipped).toEqual(before?.equipped);
  await tap('.exp-rs-hub');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-map')).toBeVisible();

  // a solo stage cut by a reload is a loss (after the tab's 10 s heartbeat window)
  await tap('.exp-go');
  await phase(page, 'combat');
  await page.reload();
  await phase(page, 'main');
  await tap('.mm-exp');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-run-wait')).toBeVisible();
  await phase(page, 'expResult', 20_000);
  await expect(page.locator('.exp-rs-reason')).toHaveText('단계 도중에 창을 닫았어요');
  expect((await stash(page))?.run).toBeNull();
  await tap('.exp-rs-hub');
  await phase(page, 'expHub');

  // 기획 16차 fix: a reload after the combat was won (floor reward open) is still a clear — loot in the bag, reward picked
  await tap('.exp-go');
  await phase(page, 'combat');
  const wonStage = await page.evaluate(() => window.__proto!.game!.state.expedition!.stage);
  await clearStage(page);
  await phase(page, 'reward');
  await page.waitForFunction(k => !!JSON.parse(localStorage.getItem(k) ?? 'null')?.run?.pending?.won, STASH_KEY);
  await page.reload();
  await phase(page, 'main');
  await tap('.mm-exp');
  await phase(page, 'expHub');
  await expect(page.locator('.exp-reveal')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.exp-reveal-title')).toHaveText(`${wonStage}단계 클리어!`);
  expect((await stash(page))?.run).toMatchObject({ stage: wonStage + 1, cleared: 1, status: 'lobby' });
  expect((await stash(page))?.run?.bag).toHaveLength(1);
  await tap('.exp-reveal-ok');
  await tap('.exp-claim');
  await phase(page, 'expResult');
  await tap('.exp-rs-hub');
  await phase(page, 'expHub');

  // the expedition party lives apart from the classic preset; ← 메인 → 클래식 탑 is today's preset
  await tap('.exp-hub .exp-back');
  await phase(page, 'main');
  await tap('.mm-classic');
  await phase(page, 'preset');
  await expect(page.locator('.preset .ps-title')).toHaveText('클래식 탑 편성');
  await expect(page.locator('.preset .ps-gear:visible')).toHaveCount(0);
  await tap('.preset .ps-back');
  await phase(page, 'main');
  expect(errors).toEqual([]);
});

test('원정: 보스 단계 「단계 즉시 클리어」 → 바로 로비 (장비 1 + 보스 상자 = 첫 클리어 유물) → 수령', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  await boot(page, errors);
  await tap('.mm-exp');
  await phase(page, 'expHub');
  await tap('.exp-dbg');
  await tap('.exp-dbg-unlock');
  await tap('.exp-dbg-panel .dbg-hbtn');
  await tap('.exp-stage[data-stage="3"]');
  await expect(page.locator('.exp-go')).toHaveText('3단계부터 출발');
  await tap('.exp-go');
  await phase(page, 'combat');
  expect(await page.evaluate(() => [window.__proto!.game!.state.plan.kind, window.__proto!.game!.state.expedition?.boss])).toEqual(['boss', true]);
  await expect(page.locator('.boss-lv')).toHaveText('3단계'); // the boss bar names the stage (no pill label)
  await expect(page.locator('.hud-tr .exp-pill-bag')).toHaveText('가방 0');
  // the in-game debug panel's button (solo: Backquote opens it)
  await page.keyboard.press('Backquote');
  await tap('.dbg-exp-clear');
  // no floor reward on a boss stage: the clear banner, then the lobby
  await phase(page, 'expHub', 10_000);
  await expect(page.locator('.exp-reveal .exp-loot')).toHaveCount(2);
  await expect(page.locator('.exp-reveal .exp-loot.is-relic')).toHaveCount(1);
  await tap('.exp-reveal-ok');
  await expect(page.locator('.exp-path-dot[data-stage="3"]')).toHaveClass(/is-done/);
  await expect(page.locator('.exp-run-next')).toHaveText(/4단계 · 사무실/);
  await tap('.exp-claim');
  await phase(page, 'expResult');
  const s = await stash(page);
  expect(s?.items).toHaveLength(2);
  expect(s?.items.filter(i => i.slot === 'relic')).toHaveLength(1);
  expect(s?.bossFirstClears).toEqual([3]);
  expect(errors).toEqual([]);
});

test('원정: 장비가 전투 화면에 보임 (원정대 T9 + 유물, 10단계)', async ({ page }, testInfo) => {
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
  await page.waitForTimeout(2600); // the debug toasts fade
  if (testInfo.project.name === 'phone') await page.screenshot({ path: `${SHOTS}/expedition-hub.png` });
  await tap('.exp-go');
  await phase(page, 'combat');
  const gear = await page.evaluate(() => window.__proto!.game!.state.players[0].gear!);
  expect(gear.every(l => l.weapon?.tier === 9 && l.armor?.tier === 9 && l.charm?.tier === 9)).toBe(true);
  expect(gear.filter(l => l.relic).length).toBe(3);
  await expect(page.locator('.fi-floor')).toHaveText('10단계');
  await page.waitForTimeout(5000);
  if (testInfo.project.name === 'phone') await page.screenshot({ path: `${SHOTS}/expedition-gear-battle.png` });
  expect(errors).toEqual([]);
});
