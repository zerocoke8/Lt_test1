// 기획 22차 궁극기 테스트 (docs/ult-test.md): the solo flow with real gestures on the ult button.
// 메인 네 번째 카드 → 편성 (「궁극기 방식」 조준, the 궁극기 row says 조준) → 출발 → combat in mode ultTest (the HUD chip
// 「조준」) → hold the ult button and drag → the live preview follows the finger (window.__proto.ui.ultAim) → release →
// the guardian's ult lands at the aimed spot (its barrier zone there). Then debug 「궁극기 방식 → 드래그」 → drag the ult
// button onto the field → the guardian is THERE and casts there. A short tap = today's ult (no move); dragging back onto
// the button cancels (gauge kept). Phone: CDP touch events; desktop: the mouse.
// Phone screenshots: docs/screenshots/ult-test-{main,preset,aim,drag}.png.
// 기획 24차 (docs/ult-fx.md 8-4): the 「충전」 button right of the ult — only in this mode's combat (a classic and a raid run
// have none), a press fills my three gauges with no toast, dim once all three are full; faint and untouchable while the ult
// is aimed or a card dragged; the aimed ult released on it is cancelled; a press slid onto the ult starts no aim; on a
// phone its box (+ touch rim) clears the ult's press box, the cards, the pets and the longest alt ult name.

import { expect, test, type Page } from '@playwright/test';
import type { Command, Vec2 } from '../../src/types';
import type { AppPhase } from '../../src/ui/app';
import { ultAltEntries } from '../../src/data/ultTest';

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

  // ── 기획 23차 검토: the in-game skill sheet with the (longer) 드래그 ult line stays inside the stage — its name row on
  // screen (the ult row's 「궁극기 · 드래그」 badge spans both of its lines) ──
  await expect(page.locator('.pause')).toBeHidden();
  const field = await page.evaluate(() => window.__proto!.game!.state.players[0].activeIndex!);
  const card = page.locator(`.ccard[data-idx="${field}"]`);
  if (mobile) await card.tap();
  else await card.click();
  await expect(page.locator('.skill-sheet')).toBeVisible();
  await expect(page.locator('.skill-sheet .ss-ult.ss-alt')).toHaveCount(1);
  const sheetBox = (await page.locator('.skill-sheet').boundingBox())!;
  const stageBox = (await page.locator('.stage').boundingBox())!;
  expect(sheetBox.y).toBeGreaterThanOrEqual(stageBox.y - 1);
  expect((await page.locator('.skill-sheet .ss-head').boundingBox())!.y).toBeGreaterThanOrEqual(stageBox.y);
  if (mobile) await card.tap();
  else await card.click();

  expect(errors).toEqual([]);
});

// ─────────────────────────── 기획 24차 「충전」 ───────────────────────────

/**
 * 기획 24차 검토: every 조준 / 드래그 ult name — the page measures them all in the HUD's own .ult-name and keeps the
 * widest (today 거너 드래그 「펌프 버스트 · 대구경 슬러그」; the test once used 레인저 조준's shorter name).
 */
const ALT_ULT_NAMES = ultAltEntries().flatMap(([, set]) => [set.aim?.name, set.drag?.name].filter((n): n is string => !!n));
const LONGEST_ULT_NAME = '펌프 버스트 · 대구경 슬러그';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxesOf = (page: Page, sel: string): Promise<Box[]> =>
  page.locator(sel).evaluateAll(els =>
    els.map(e => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const centre = (b: Box): Vec2 => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function press(page: Page, mobile: boolean, sel: string): Promise<void> {
  if (mobile) await page.locator(sel).tap();
  else await page.locator(sel).click();
}

test('기획 24차 「충전」: 클래식 탑 · 보스 레이드에는 버튼이 없음', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  for (const [q, mode] of [
    ['/', undefined],
    ['/?mode=bossRaid', 'bossRaid'],
  ] as const) {
    await page.goto(q);
    await waitPhase(page, 'preset');
    await page.evaluate(() => window.__proto!.startRun({ tunables: { invincible: true } }));
    await waitPhase(page, 'combat');
    expect(await page.evaluate(() => window.__proto!.game!.state.mode)).toBe(mode);
    await expect(page.locator('.ult')).toBeVisible();
    await expect(page.locator('.ult-charge')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('기획 24차 「충전」: 누르면 세 게이지 가득 · 알림 없음 · 다 차면 흐림 · 겨누는 동안 못 누름 · 겹침 없음', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.addInitScript(p => {
    if (!sessionStorage.getItem('ultTestSeeded')) {
      localStorage.setItem('swapTower.preset.v1', JSON.stringify(p));
      sessionStorage.setItem('ultTestSeeded', '1');
    }
  }, PRESET);
  await page.goto('/?mode=ultTest&ult=aim&boss=elevator_keeper');
  await waitPhase(page, 'preset');
  // the field gauge fills by itself in 2 s, the bench never (ratio 0): the field can be aimed while 「충전」 still has work
  await page.evaluate(() => window.__proto!.startRun({ tunables: { invincible: true, ultFieldChargeTime: 2, ultBenchRatio: 0 } }));
  await waitPhase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.state.mode)).toBe('ultTest');
  const charge = page.locator('.ult-charge');
  await expect(charge).toBeVisible();
  await expect(charge).toContainText('충전');
  await expect(charge).toHaveAttribute('aria-label', '궁극기 게이지 채우기 (궁극기 테스트)');
  // the ult's sibling, after it (a press on it never reaches the ult's gesture; the CSS `.ult.is-aiming ~`)
  expect(await page.evaluate(() => document.querySelector('.ult ~ .ult-charge') !== null && !document.querySelector('.ult .ult-charge'))).toBe(true);

  // ── layout: Ø 80 logical px, centred on the ult's height, 24 px right of it; its box + the 10 px touch rim clears the
  // ult's press box (+ BUTTON_SLACK 6 CSS px), the three cards, the three pets, the longest ult name and the mode chip ──
  // the widest of the 30 names, measured where it is shown (the HUD writes it again only when the field character changes)
  const widest = await page.evaluate(names => {
    const el = document.querySelector('.ult-name') as HTMLElement;
    let best = '';
    let w = -1;
    for (const n of names) {
      el.textContent = n;
      const x = el.getBoundingClientRect().width;
      if (x > w) {
        w = x;
        best = n;
      }
    }
    el.textContent = best;
    return best;
  }, ALT_ULT_NAMES);
  expect(ALT_ULT_NAMES.length).toBe(30);
  expect(widest).toBe(LONGEST_ULT_NAME);
  const scale = await page.evaluate(() => document.querySelector('.stage')!.getBoundingClientRect().width / 1280);
  const [cb] = await boxesOf(page, '.ult-charge');
  const [ub] = await boxesOf(page, '.ult');
  expect(Math.abs(cb.width - 80 * scale)).toBeLessThan(1);
  expect(Math.abs(centre(cb).y - centre(ub).y)).toBeLessThan(1);
  expect(Math.abs(cb.x - (ub.x + ub.width) - 24 * scale)).toBeLessThan(1);
  const others: Record<string, Box[]> = {
    'ult press box': [grow(ub, 6)],
    cards: await boxesOf(page, '.ccard'),
    pets: await boxesOf(page, '.pcard'),
    'ult name': await boxesOf(page, '.ult-name'),
    'ult mode chip': await boxesOf(page, '.ult-mode'),
  };
  expect(others.cards).toHaveLength(3);
  expect(others.pets).toHaveLength(3);
  const rim = grow(cb, 10 * scale);
  for (const [k, list] of Object.entries(others)) for (const b of list) expect(overlaps(rim, b), k).toBe(false);
  const stageBox = (await boxesOf(page, '.stage'))[0];
  expect(rim.x + rim.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
  expect(rim.y + rim.height).toBeLessThanOrEqual(stageBox.y + stageBox.height);

  // what the app sends from here on, and every toast that shows
  await page.evaluate(() => {
    const g = window.__proto!.game!;
    const send = g.dispatch.bind(g);
    const w = window as unknown as { __sent: Command[]; __toasts: string[] };
    w.__sent = [];
    w.__toasts = [];
    g.dispatch = c => {
      w.__sent.push(c);
      return send(c);
    };
    new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) w.__toasts.push(n.textContent ?? '');
    }).observe(document.querySelector('.toasts-hud')!, { childList: true });
  });
  const chargesSent = () => page.evaluate(() => (window as unknown as { __sent: Command[] }).__sent.filter(c => c.type === 'debug' && c.action.kind === 'chargeUlt'));
  const gauges = () => page.evaluate(() => window.__proto!.game!.state.players[0].party.map(m => m.ult.charge));

  // ── the field is full (by time), the bench is not: 「충전」 stays pressable ──
  await expect(page.locator('.ult')).toHaveClass(/is-full/, { timeout: 8000 });
  await expect(charge).not.toHaveClass(/is-full/);

  // ── aiming: 「충전」 is faint and takes no press; the aim released on it is cancelled (no ult, no charge, gauge kept) ──
  const chargeAt = centre(cb);
  await gesture(page, mobile, await ultButton(page), [await fingerFor(page, { x: 12, y: 6 }), chargeAt], async () => {
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__proto!.ui.ultAim)).not.toBeNull();
    const st = await charge.evaluate(e => ({ opacity: Number(getComputedStyle(e).opacity), pe: getComputedStyle(e).pointerEvents }));
    expect(st.pe).toBe('none');
    expect(st.opacity).toBeLessThan(0.3);
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ult-charge'), [chargeAt.x, chargeAt.y] as const)).toBe(false);
  });
  await page.waitForTimeout(400);
  expect(await ultsUsed(page)).toBe(0);
  await expect(page.locator('.ult')).toHaveClass(/is-full/);
  expect(await chargesSent()).toEqual([]);
  const field = await page.evaluate(() => window.__proto!.game!.state.players[0].activeIndex!);
  expect((await gauges()).filter((_, i) => i !== field).every(c => c < 1)).toBe(true);
  await expect(charge).toHaveCSS('opacity', '1');

  // ── a press on 「충전」 slid onto the ult starts no aim (and casts nothing) ──
  await gesture(page, mobile, chargeAt, [await ultButton(page)], async () => {
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__proto!.ui.ultAim)).toBeNull();
    await expect(page.locator('.ult')).not.toHaveClass(/is-aiming/);
  });
  await page.waitForTimeout(400);
  expect(await ultsUsed(page)).toBe(0);
  expect(await chargesSent()).toEqual([]);

  // ── today's ult (a tap) empties the field; nothing fills by itself any more ──
  await page.evaluate(() => {
    window.__proto!.game!.tunables.ultFieldChargeTime = 600;
  });
  await press(page, mobile, '.ult');
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 1, undefined, { timeout: 3000 });
  await expect(page.locator('.ult')).not.toHaveClass(/is-full/);
  expect((await gauges()).every(c => c < 1)).toBe(true);
  await page.waitForTimeout(700); // past the cast's own toasts / sounds

  // ── 「충전」: all three full at once, 「끌기!」, no toast; then dim, and a press sends nothing ──
  await page.evaluate(() => {
    (window as unknown as { __toasts: string[] }).__toasts = [];
  });
  // 기획 24차 검토: the app's own click sound stays out (chargeMyUlt plays ui.tap / ui.ult.denied itself)
  await expect(charge).toHaveAttribute('data-sfx', '');
  await press(page, mobile, '.ult-charge');
  await expect(page.locator('.ult')).toHaveClass(/is-full/);
  await expect(page.locator('.ult-pct')).toHaveText('끌기!');
  expect((await gauges()).every(c => c >= 1)).toBe(true);
  expect(await chargesSent()).toEqual([{ type: 'debug', action: { kind: 'chargeUlt', player: 0 } }]);
  await expect(charge).toHaveClass(/is-full/);
  await expect(charge).toHaveAttribute('data-sfx', 'ui.refuse'); // a dim press sounds as a refusal, not a tap
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)).toEqual([]);
  await press(page, mobile, '.ult-charge');
  await page.waitForTimeout(300);
  expect(await chargesSent()).toHaveLength(1);

  // ── a card held over the field: 「충전」 faint and untouchable too (the card goes back: released on its own spot) ──
  const bench = await page.evaluate(() => [0, 1, 2].find(i => i !== window.__proto!.game!.state.players[0].activeIndex)!);
  const card = (await boxesOf(page, `.ccard[data-idx="${bench}"]`))[0];
  await gesture(page, mobile, centre(card), [await fingerFor(page, { x: 8, y: 5 }), centre(card)], async () => {
    await page.waitForTimeout(150);
    await expect(page.locator('.hud')).toHaveClass(/is-drag/);
    expect(await charge.evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
  });

  // ── outside combat (the floor reward): hidden ──
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }));
  await page.waitForFunction(() => window.__proto!.game!.state.phase !== 'combat');
  await expect(charge).toBeHidden();

  expect(errors).toEqual([]);
});
