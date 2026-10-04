// E2E rule paths not covered by the smoke run: 일반층 시간 초과 실패 (R17), 보스층 시간 초과 광폭화 (R18),
// 최고층 도달 승리 (R21), 내 캐릭터 전멸 → 관전 → 결과 (R11), portrait overlay pause, desktop keyboard shortcuts.

import { expect, test, type Page } from '@playwright/test';
import type { DebugAction } from '../../src/types';
import type { AppPhase, RunOverrides } from '../../src/ui/app';

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
}

const start = (page: Page, setup: RunOverrides) => page.evaluate(s => window.__proto!.startRun(s), setup);

const waitPhase = (page: Page, want: AppPhase, timeout = 15_000) =>
  page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });

const debug = (page: Page, action: DebugAction) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a }), action);

test('일반층 제한시간 초과 → 런 실패 → 결과', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 11, tunables: { normalFloorTime: 4, invincible: true, monsterHpMult: 50 } });
  await expect(page.locator('.timer-label')).toHaveText('남은 시간');
  await waitPhase(page, 'result', 20_000);
  await expect(page.locator('.rs-title')).toHaveText('패배');
  await expect(page.locator('.rs-reason')).toHaveText('제한시간 초과 (일반층)');
  expect(await page.evaluate(() => window.__proto!.game!.state.runResult)).toMatchObject({ outcome: 'defeat', reason: 'timeout', floorReached: 1 });
  await expect(page.locator('.rs-floor.is-fail')).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('보스층 제한시간 초과 → 광폭화, 전투는 계속', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 12, startFloor: 5, tunables: { bossFloorTime: 3, invincible: true } });
  await expect(page.locator('.timer-label')).toHaveText('광폭화까지');
  await page.waitForFunction(() => window.__proto!.game!.state.bossEnraged, undefined, { timeout: 15_000 });
  await expect(page.locator('.timer-val')).toHaveText('광폭화');
  await expect(page.locator('.boss.is-enraged')).toBeVisible();
  const t0 = await page.evaluate(() => window.__proto!.game!.state.floorTime);
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({ phase: window.__proto!.phase, t: window.__proto!.game!.state.floorTime }));
  expect(s.phase).toBe('combat');
  expect(s.t).toBeGreaterThan(t0 + 0.5);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('최고층(maxFloor) 클리어 → 승리', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 13, tunables: { maxFloor: 2 } });
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  await waitPhase(page, 'reward');
  await page.locator('.rw-card').first().click();
  await waitPhase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.floor)).toBe(2);
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  await waitPhase(page, 'result');
  await expect(page.locator('.rs-title')).toHaveText('승리!');
  await expect(page.locator('.rs-floor.is-clear')).toHaveCount(2);
  // 다시 하기 → a fresh run on floor 1
  await page.locator('.rs-foot .btn-primary').click();
  await waitPhase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.floor)).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('내 캐릭터 3명 전멸 → 관전 → 결과 보기', async ({ page }, testInfo) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 14, tunables: { monsterDmgMult: 300, monsterHpMult: 30, reviveTime: 999 } });
  // keep dropping whoever is alive onto an enemy until all three have fallen
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const api = window.__proto!;
          const g = api.game!;
          const s = g.state;
          const me = s.players[0];
          if (me.out) return true;
          if (s.phase === 'reward' && s.rewardOffers) g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
          if (me.activeIndex == null && s.phase === 'combat') {
            g.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
            const idx = me.party.findIndex(m => !m.dead);
            const foe = s.entities.find(e => e.team === 'enemy' && e.hp > 0);
            if (idx >= 0 && foe) api.ui.dragTo('swap', idx, foe.pos);
          }
          return false;
        }),
      { timeout: 60_000, intervals: [250] },
    )
    .toBe(true);
  const ph = await page.evaluate(() => window.__proto!.phase);
  if (ph === 'spectate') {
    await expect(page.locator('.spectate')).toBeVisible();
    await expect(page.locator('.ult')).toHaveClass(/is-disabled/);
    // no frozen revive / pet countdowns while spectating (the timers stop with the player): the cards just say 사망
    await expect(page.locator('.ccard .cc-cd:visible')).toHaveCount(0);
    await expect(page.locator('.pcard .pc-cd:visible')).toHaveCount(0);
    await expect(page.locator('.ccard .cc-state')).toHaveText(['사망', '사망', '사망']);
    await expect(page.locator('.ult-sub')).toHaveText('관전 중');
    // the spectate bar sits under the arena floor (the fight stays visible) and above the card row
    const bar = (await page.locator('.spectate-box').boundingBox())!;
    const cards = (await page.locator('.hud-bl').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(cards.y + 2);
    expect(bar.height).toBeLessThan(page.viewportSize()!.height * 0.14);
    // toasts (e.g. "메이지 쓰러짐") stack above the bar, never on it
    const toasts = (await page.locator('.toasts-hud').boundingBox())!;
    expect(toasts.y + toasts.height).toBeLessThanOrEqual(bar.y + 1);
    if (testInfo.project.name === 'phone') await page.screenshot({ path: 'docs/screenshots/spectate.png' });
    // cards refuse while spectating
    expect(await page.evaluate(() => window.__proto!.ui.dragTo('swap', 0, { x: 18, y: 6 }).reason)).toBe('관전 중');
    await page.locator('.spectate-box .btn').click();
  }
  await waitPhase(page, 'result');
  const r = await page.evaluate(() => window.__proto!.game!.state.runResult);
  if (r?.reason === 'quit') await expect(page.locator('.rs-reason')).toHaveText('내 캐릭터 전멸 후 관전 종료');
  else expect(r?.reason).toBe('wipe'); // the bots died too in the meantime
  await expect(page.locator('.rs-pname .rs-out').first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('바닥 아래쪽 조준: 손가락이 카드 줄 위여도 착지 지점이 바닥이면 놓을 수 있고, 카드 깊숙이 내리면 취소', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone only');
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 17, tunables: { invincible: true } });
  await page.waitForTimeout(700);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
  // a spot on the lowest floor rows whose finger point (LIFT px below) is on a card of the bottom row (a HUD block)
  const aim = await page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    for (const y of [s.plan.arena.height - 0.6, s.plan.arena.height - 1]) {
      for (let x = 1; x < s.plan.arena.width - 1; x += 0.25) {
        const world = { x, y };
        const f = api.ui.fingerFor(world);
        if (f.x < 30 || f.x > window.innerWidth - 30) continue;
        const el = document.elementFromPoint(f.x, f.y);
        if (el && el.closest('.ccard, .pcard')) return { world, f };
      }
    }
    return null;
  });
  expect(aim, 'no floor spot whose finger lands on the card row').not.toBeNull();
  const box = (await page.locator('.ccard[data-idx="1"]').boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch('touchStart', from);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', { x: from.x + (aim!.f.x - from.x) * (i / 12), y: from.y + (aim!.f.y - from.y) * (i / 12) });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  const pv = await page.evaluate(() => window.__proto!.ui.dragPreview);
  expect(pv?.valid).toBe(true);
  expect(Math.abs(pv!.pos.y - aim!.world.y)).toBeLessThan(0.4);
  await expect(page.locator('.drag-ghost')).not.toHaveClass(/is-invalid/);
  // finger all the way down on the card: the drop point leaves the floor → cancel
  await touch('touchMove', from);
  await page.waitForTimeout(150);
  expect((await page.evaluate(() => window.__proto!.ui.dragPreview))?.valid).toBe(false);
  await touch('touchMove', aim!.f);
  await page.waitForTimeout(150);
  await touch('touchEnd');
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].activeIndex === 1, undefined, { timeout: 3000 });
  const y = await page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return s.entities.find(e => e.id === s.players[0].party[1].entityId)!.pos.y;
  });
  expect(y).toBeGreaterThan(aim!.world.y - 1.5);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('세로 화면: 안내 오버레이 + 게임 정지', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone only');
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 15 });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.rotate-overlay')).toBeVisible();
  await expect(page.locator('.rotate-title')).toHaveText('가로로 돌려 주세요');
  await page.waitForTimeout(200);
  const t0 = await page.evaluate(() => window.__proto!.game!.state.time);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__proto!.game!.state.time)).toBe(t0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.rotate-overlay')).toBeHidden();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__proto!.game!.state.time)).toBeGreaterThan(t0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('PC 단축키: Space 궁극기, Esc 일시정지, ` 디버그 패널', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop only');
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 16 });
  await debug(page, { kind: 'chargeUlt' });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].stats.ultsUsed)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause')).toBeVisible();
  const t0 = await page.evaluate(() => window.__proto!.game!.state.time);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__proto!.game!.state.time)).toBe(t0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause')).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(page.locator('.debug-panel')).toBeVisible();
  // the panel never pauses the game and its speed buttons drive game.tunables
  await page.locator('.dbg-speed', { hasText: '4×' }).click();
  expect(await page.evaluate(() => window.__proto!.game!.tunables.gameSpeed)).toBe(4);
  await page.keyboard.press('Backquote');
  await expect(page.locator('.debug-panel')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
