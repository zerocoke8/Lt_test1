// 기획 22차 궁극기 테스트 (docs/ult-test.md): the solo flow with real gestures on the ult button.
// 메인 네 번째 카드 → 편성 (「궁극기 방식」 조준, the 궁극기 row says 조준) → 출발 → combat in mode ultTest (the HUD chip
// 「조준」) → hold the ult button and drag → the live preview follows the finger (window.__proto.ui.ultAim) → release →
// the guardian's ult lands at the aimed spot (its barrier zone there). Then debug 「궁극기 방식 → 드래그」 → drag the ult
// button onto the field → the guardian is THERE and casts there. A short tap = today's ult (no move); dragging back onto
// the button cancels (gauge kept). Phone: CDP touch events; desktop: the mouse.
// Phone screenshots: docs/screenshots/ult-test-{main,preset,aim,drag}.png.

import { expect, test, type Page } from '@playwright/test';
import type { Vec2 } from '../../src/types';
import type { AppPhase } from '../../src/ui/app';

const SHOTS = 'docs/screenshots';
const PRESET = { characters: ['guardian', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };

function watchErrors(page: Page, errors: string[]): void {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
}

const waitPhase = (page: Page, want: AppPhase, timeout = 15_000) => page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });

/** A finger (phone: CDP touch; desktop: the mouse) pressed at `from`, moved in steps to each point of `path`, then (optionally) lifted. */
async function gesture(page: Page, mobile: boolean, from: Vec2, path: Vec2[], hold: (() => Promise<void>) | null = null): Promise<void> {
  const steps = 10;
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p: Vec2 | null) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
    await touch('touchStart', from);
    let at = from;
    for (const to of path) {
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', { x: at.x + ((to.x - at.x) * i) / steps, y: at.y + ((to.y - at.y) * i) / steps });
        await page.waitForTimeout(16);
      }
      at = to;
    }
    if (hold) await hold();
    await touch('touchEnd', null);
    await cdp.detach();
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  let at = from;
  for (const to of path) {
    await page.mouse.move(to.x, to.y, { steps });
    at = to;
  }
  void at;
  if (hold) await hold();
  await page.mouse.up();
}

async function ultButton(page: Page): Promise<Vec2> {
  const b = (await page.locator('.ult').boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const fingerFor = (page: Page, w: Vec2) => page.evaluate(p => window.__proto!.ui.fingerFor(p), w);
const ultsUsed = (page: Page) => page.evaluate(() => window.__proto!.game!.state.players[0].stats.ultsUsed);
const fieldPos = (page: Page) =>
  page.evaluate(() => {
    const s = window.__proto!.game!.state;
    const p = s.players[0];
    const e = s.entities.find(x => x.id === p.party[p.activeIndex!]?.entityId);
    return { x: e!.pos.x, y: e!.pos.y };
  });
/** A zone of my guardian's ult (its barrier) centred within `eps` of `at`. */
const zoneAt = (page: Page, at: Vec2, eps = 0.05) =>
  page.waitForFunction(([p, e]) => window.__proto!.game!.state.zones.some(z => z.ownerPlayer === 0 && Math.hypot(z.center.x - p.x, z.center.y - p.y) <= e), [at, eps] as const, { timeout: 5000 });

async function chargeAndWait(page: Page): Promise<void> {
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }));
  await expect(page.locator('.ult')).toHaveClass(/is-full/);
}

test('궁극기 테스트: 메인 카드 → 편성 「조준」 → 버튼 끌어 겨누기 → 그 자리에 → 디버그 「드래그」 → 그 자리로 가서 → 탭 · 취소', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.addInitScript(p => {
    if (!sessionStorage.getItem('ultTestSeeded')) {
      localStorage.setItem('swapTower.preset.v1', JSON.stringify(p));
      sessionStorage.setItem('ultTestSeeded', '1');
    }
  }, PRESET);
  await page.goto('/?main=1');
  await waitPhase(page, 'main');

  // ── the fourth card ──
  await expect(page.locator('.main-menu .mm-card')).toHaveCount(4);
  await expect(page.locator('.mm-ult .mm-card-title')).toHaveText('궁극기 테스트');
  await expect(page.locator('.mm-ult .mm-card-sub')).toHaveText('보스 레이드 · 궁극기 조작 실험');
  await expect(page.locator('.mm-ult-foot')).toContainText('첫 도전');
  if (mobile) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/ult-test-main.png` });
  }
  if (mobile) await page.locator('.mm-ult').tap();
  else await page.locator('.mm-ult').click();
  await waitPhase(page, 'preset');
  expect(await page.evaluate(() => localStorage.getItem('swapTower.mode.v1'))).toBe('ultTest');
  await expect(page.locator('.ps-title')).toHaveText('궁극기 테스트 편성');

  // ── 「궁극기 방식」: 조준 ──
  await expect(page.locator('.ps-ult')).toBeVisible();
  await expect(page.locator('.ps-ult-btn')).toHaveText(['현재', '조준', '드래그']);
  const aimBtn = page.locator('.ps-ult-btn[data-mode="aim"]');
  if (mobile) await aimBtn.tap();
  else await aimBtn.click();
  await expect(aimBtn).toHaveClass(/is-on/);
  await expect(page.locator('.ps-ult-hint')).toContainText('끌어 겨누고');
  // the detail (the first pick, the guardian) shows its own 조준 궁극기 (성채 투척) — the FIRST row, in view on a phone
  await expect(page.locator('.dt-name')).toHaveText('가디언');
  await expect(page.locator('.sk-ult .sk-slot')).toHaveText('궁극기 · 조준');
  await expect(page.locator('.sk-ult .sk-name')).toHaveText('성채 투척');
  await expect(page.locator('.dt-skills > .sk-row').first()).toHaveClass(/sk-ult/);
  await expect(page.locator('.sk-ult')).toBeInViewport();
  if (mobile) await page.screenshot({ path: `${SHOTS}/ult-test-preset.png` });
  const start = page.locator('.preset .btn-start');
  if (mobile) await start.tap();
  else await start.click();
  await page.waitForFunction(() => ['lobby', 'combat'].includes(window.__proto!.phase));
  if ((await page.evaluate(() => window.__proto!.phase)) === 'lobby') {
    const solo = page.locator('.lb-solo');
    if (mobile) await solo.tap();
    else await solo.click();
  }
  await waitPhase(page, 'combat');
  const st = await page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return { mode: s.mode, ult: s.players.map(p => p.ultMode), lead: s.players[0].party[0].defId };
  });
  expect(st.mode).toBe('ultTest');
  expect(st.ult).toEqual(['aim', 'aim', 'aim']); // the bots play my mode
  await expect(page.locator('.ult-mode')).toHaveText('조준');
  await page.evaluate(() => {
    window.__proto!.game!.tunables.invincible = true;
    window.__proto!.game!.tunables.gameSpeed = 1;
  });
  expect(st.lead).toBe('guardian');
  await page.waitForTimeout(800);

  // ── 조준: hold the button, drag up onto the field, hold still: the preview is there ──
  await chargeAndWait(page);
  const P = { x: 6, y: 8 };
  const btn = await ultButton(page);
  await gesture(page, mobile, btn, [await fingerFor(page, P)], async () => {
    await page.waitForTimeout(200);
    const v = await page.evaluate(() => window.__proto!.ui.ultAim);
    expect(v).not.toBeNull();
    expect(v!.mode).toBe('aim');
    expect(v!.valid).toBe(true);
    expect(v!.cancel).toBe(false);
    expect(Math.hypot(v!.point.x - P.x, v!.point.y - P.y)).toBeLessThan(0.15);
    expect(v!.parts.length).toBeGreaterThan(0);
    await expect(page.locator('.ult-aim-tag')).toHaveText('놓으면 발사');
    if (mobile) await page.screenshot({ path: `${SHOTS}/ult-test-aim.png` });
  });
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 1, undefined, { timeout: 3000 });
  expect(await page.evaluate(() => window.__proto!.ui.ultAim)).toBeNull();
  // the aimed spot: the guardian's barrier (a zone of my ult) sits on it (± the finger's sub-pixel)
  await zoneAt(page, P, 0.15);

  // ── debug: 「궁극기 방식」 → 드래그 (+ 궁극기 충전 in the same section) ──
  const dbgBtn = page.locator('.btn-dbg');
  if (mobile) await dbgBtn.tap();
  else await dbgBtn.click();
  const sec = page.locator('.debug-panel .dbg-sec').filter({ has: page.locator('.dbg-sec-title', { hasText: '궁극기 방식' }) });
  await expect(sec).toBeVisible();
  await expect(sec.locator('.dbg-ult-mode.is-on')).toHaveText('조준');
  const dragMode = sec.locator('.dbg-ult-mode[data-mode="drag"]');
  if (mobile) await dragMode.tap();
  else await dragMode.click();
  expect(await page.evaluate(() => window.__proto!.game!.state.players.map(p => p.ultMode))).toEqual(['drag', 'drag', 'drag']);
  await expect(sec.locator('.dbg-ult-mode.is-on')).toHaveText('드래그');
  const charge = sec.locator('.dbg-ult-charge');
  if (mobile) await charge.tap();
  else await charge.click();
  const close = page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' });
  if (mobile) await close.tap();
  else await close.click();
  await expect(page.locator('.ult-mode')).toHaveText('드래그');
  await expect(page.locator('.ult')).toHaveClass(/is-full/);

  // ── 드래그: drag the button onto a spot within reach → the guardian is there and casts there ──
  const from = await fieldPos(page);
  const Q = { x: Math.min(22, Math.max(2, from.x + (from.x < 12 ? 5 : -5))), y: from.y < 6 ? from.y + 2 : from.y - 2 };
  await gesture(page, mobile, await ultButton(page), [await fingerFor(page, Q)], async () => {
    await page.waitForTimeout(150);
    const v = await page.evaluate(() => window.__proto!.ui.ultAim);
    expect(v?.mode).toBe('drag');
    expect(v?.move).not.toBeNull();
    if (mobile) await page.screenshot({ path: `${SHOTS}/ult-test-drag.png` });
  });
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 2, undefined, { timeout: 3000 });
  const landed = await fieldPos(page);
  expect(Math.hypot(landed.x - Q.x, landed.y - Q.y)).toBeLessThan(0.3);
  await zoneAt(page, landed, 0.4);

  // ── a short tap: today's ult where it stands (no move) ──
  await page.waitForTimeout(1500);
  await chargeAndWait(page);
  const before = await fieldPos(page);
  if (mobile) await page.locator('.ult').tap();
  else await page.locator('.ult').click();
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 3, undefined, { timeout: 3000 });
  const after = await fieldPos(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);

  // ── cancel: out onto the field and back onto the button → nothing cast, the gauge stays full ──
  await page.waitForTimeout(1000);
  await chargeAndWait(page);
  const b2 = await ultButton(page);
  await gesture(page, mobile, b2, [await fingerFor(page, { x: 12, y: 6 }), b2], async () => {
    await page.waitForTimeout(120);
    expect((await page.evaluate(() => window.__proto!.ui.ultAim))?.cancel).toBe(true);
    await expect(page.locator('.ult-aim-tag')).toHaveText('놓으면 취소');
  });
  await page.waitForTimeout(400);
  expect(await ultsUsed(page)).toBe(3);
  await expect(page.locator('.ult')).toHaveClass(/is-full/);

  // ── 기획 23차: the pause menu here has 「궁극기 연출 강화」 (on), the box still fits the screen; off is saved ──
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause')).toBeVisible();
  const fx = page.locator('.btn-ultfx');
  await expect(fx).toHaveText('궁극기 연출 강화 (궁극기 테스트): 켬');
  const box = (await page.locator('.pause-box').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  if (mobile) await fx.tap();
  else await fx.click();
  await expect(fx).toHaveText('궁극기 연출 강화 (궁극기 테스트): 끔');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('swap-tower.ultFx.v1') ?? '{}').boost)).toBe(false);
  if (mobile) await fx.tap();
  else await fx.click();
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
});
