// 기획 22차 궁극기 테스트 멀티 (docs/ult-test.md 1장 · 3장): the built game server + three phone contexts. A picks the mode
// (?mode=ultTest&ult=aim = the fourth card, 「조준」 on its preset), B picks 「드래그」 (?mode=ultTest&ult=drag), C the
// classic tower. A makes the room (its tag 「궁극기 테스트」 on the 매칭 header, the list row and the room view), B joins
// by code, C from the list. Started: all three are in the same ultTest game with the modes [조준, 드래그, 현재].
// A holds its ult button and drags onto the field → releases: the guardian's ult lands at that spot on ALL THREE screens
// (its barrier zone, the same centre). B drags its ult button onto the field → its guardian appears there and casts there,
// seen the same on all three. 기획 23차: each ult's ★ finisher warning sits at the same spot on all three screens too. The host's debug 「궁극기 방식」 switches everyone; a member has no debug button.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import type { Vec2 } from '../../src/types';
import type { AppPhase } from '../../src/ui/app';

const OUT = process.env.E2E_OUT || 'dist';
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const PRESET = { characters: ['guardian', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: ChildProcess | null = null;
let base = '';
let serverLog = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

test.beforeAll(async () => {
  execSync('npm run build:server', { stdio: 'ignore' });
  // E2E_GAME_PORT: a fixed port for the game server (parallel agents each get their own), else a free one
  const port = Number(process.env.E2E_GAME_PORT) || (await freePort());
  server = spawn(process.execPath, ['dist-server/index.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: path.resolve(OUT), END_LINGER_MS: '1500' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', d => (serverLog += String(d)));
  server.stderr?.on('data', d => (serverLog += String(d)));
  base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await (await fetch(`${base}healthz`)).text()) === 'ok') return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`game server did not start:\n${serverLog}`);
});

test.afterAll(() => {
  server?.kill();
  server = null;
});

interface Player {
  name: string;
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

async function openPlayer(browser: Browser, name: string, query = ''): Promise<Player> {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(p => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('swapTower.preset.v1', JSON.stringify(p));
      sessionStorage.setItem('seeded', '1');
    }
  }, PRESET);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`${name} HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(base + query);
  await waitPhase(page, 'preset');
  await page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10_000 });
  return { name, ctx, page, errors };
}

async function waitPhase(page: Page, want: AppPhase, timeout = 15_000): Promise<void> {
  await page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}

async function tap(p: Player, selector: string): Promise<void> {
  const l = p.page.locator(selector).first();
  await expect(l).toBeVisible();
  await l.tap();
}

async function toLobby(p: Player, nick: string): Promise<void> {
  await tap(p, '.preset .btn-start');
  await waitPhase(p.page, 'lobby');
  const input = p.page.locator('.lb-name input');
  await input.fill(nick);
  await input.press('Enter');
  await p.page.waitForFunction(n => document.querySelector<HTMLInputElement>('.lb-name input')?.value === n, nick);
}

/** A real finger (CDP touch) pressed on the ult button, dragged to the client point `to`, held a moment, lifted. */
async function dragUlt(p: Player, to: Vec2, onHold?: () => Promise<void>): Promise<void> {
  const b = (await p.page.locator('.ult').boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = await p.ctx.newCDPSession(p.page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: Vec2 | null) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at.x, y: at.y, id: 1 }] : [] });
  await touch('touchStart', from);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
    await p.page.waitForTimeout(16);
  }
  await p.page.waitForTimeout(150);
  if (onHold) await onHold();
  await touch('touchEnd', null);
  await cdp.detach();
}

const fingerFor = (p: Player, w: Vec2) => p.page.evaluate(x => window.__proto!.ui.fingerFor(x), w);
/** Wait until this screen shows a zone of player `pi`'s ult centred within `eps` of `at`; resolves to its centre. */
const zoneOf = (p: Player, pi: number, at: Vec2, eps: number) =>
  p.page
    .waitForFunction(
      ([who, c, e]) => window.__proto!.game!.state.zones.find(z => z.ownerPlayer === who && Math.hypot(z.center.x - c.x, z.center.y - c.y) <= e)?.center ?? null,
      [pi, at, eps] as const,
      { timeout: 8000 },
    )
    .then(h => h.jsonValue() as Promise<Vec2>);
/**
 * 기획 23차: wait until this screen shows an ally warning with exactly this footprint (the ★ finisher's: 성채 전개 circle
 * 4.5 / 성벽 돌파 rect 5 × 13 — no other part of those ults has it); resolves to its centre.
 */
const finisherWarning = (p: Player, area: Record<string, number | string>) =>
  p.page
    .waitForFunction(
      want => {
        const t = window.__proto!.game!.state.telegraphs.find(x => x.team === 'ally' && Object.entries(want).every(([k, v]) => (x.area as unknown as Record<string, unknown>)[k] === v));
        return t ? { x: t.center.x, y: t.center.y } : null;
      },
      area,
      { timeout: 8000, polling: 16 },
    )
    .then(h => h.jsonValue() as Promise<Vec2>);

test('궁극기 테스트 방: 라벨 → 시작 → 방식 [조준 · 드래그 · 현재] → A 조준 → 세 화면 같은 자리 → B 드래그 → 세 화면 같은 자리', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser, 'A', '?mode=ultTest&ult=aim');
  const B = await openPlayer(browser, 'B', '?mode=ultTest&ult=drag');
  const C = await openPlayer(browser, 'C');
  const all = [A, B, C];
  try {
    await expect(A.page.locator('.ps-title')).toHaveText('궁극기 테스트 편성');
    await expect(A.page.locator('.ps-ult-btn.is-on')).toHaveText('조준');
    await expect(B.page.locator('.ps-ult-btn.is-on')).toHaveText('드래그');
    await expect(C.page.locator('.ps-ult')).toBeHidden();

    // ── A makes the room (tagged), B joins by code, C from the list ──
    await toLobby(A, '에이');
    await expect(A.page.locator('.lb-title-row .lb-mode')).toHaveText('궁극기 테스트');
    await expect(A.page.locator('.lb-create-sub')).toHaveText('궁극기 테스트');
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    await expect(A.page.locator('.lb-roomname-row .lb-room-mode')).toHaveText('궁극기 테스트');
    await toLobby(B, '비');
    await B.page.locator('.lb-code-input').fill(code);
    await tap(B, '.lb-join');
    await waitPhase(B.page, 'room');
    await toLobby(C, '씨');
    const row = C.page.locator(`.lb-room-row[data-code="${code}"]`);
    await expect(row).toHaveAttribute('data-mode', 'ultTest');
    await expect(row.locator('.lb-row-mode')).toHaveText('궁극기 테스트');
    await tap(C, `.lb-room-row[data-code="${code}"]`);
    await waitPhase(C.page, 'room');
    for (const p of all) await expect(p.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(3);

    // ── start: one game, three modes ──
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    for (const p of all) {
      await p.page.waitForFunction(() => window.__proto!.game!.state.mode === 'ultTest');
      expect(await p.page.evaluate(() => window.__proto!.game!.state.players.map(x => x.ultMode))).toEqual(['aim', 'drag', 'now']);
    }
    await expect(A.page.locator('.ult-mode')).toHaveText('조준');
    await expect(B.page.locator('.ult-mode')).toHaveText('드래그');
    await expect(C.page.locator('.ult-mode')).toBeHidden();
    await expect(B.page.locator('.btn-dbg')).toBeHidden();
    // the host: nobody dies, gauges fill in 2 s (the room's tunables)
    await A.page.evaluate(() => {
      const t = window.__proto!.game!.tunables;
      t.invincible = true;
      t.ultFieldChargeTime = 2;
    });
    await sleep(1500);

    // ── A (조준): hold + drag onto the field → release → the cast lands at the aimed spot on every screen ──
    await expect(A.page.locator('.ult')).toHaveClass(/is-full/, { timeout: 8000 });
    const P = { x: 5, y: 9 };
    await dragUlt(A, await fingerFor(A, P), async () => {
      const v = await A.page.evaluate(() => window.__proto!.ui.ultAim);
      expect(v?.mode).toBe('aim');
      expect(v?.valid).toBe(true);
      await A.page.screenshot({ path: testInfo.outputPath('ult-aim-a.png') });
    });
    // its barrier (0.85 s) and its ★ finisher 성채 전개 (1.5 s, warned from 1.15 s) at the same spot on every screen
    const [centres, finA] = await Promise.all([
      Promise.all(all.map(p => zoneOf(p, 0, P, 0.2))),
      Promise.all(all.map(p => finisherWarning(p, { shape: 'circle', radius: 4.5 }))),
    ]);
    for (const c of centres) expect(c).toEqual(centres[0]);
    for (const c of finA) expect(c).toEqual(finA[0]);
    expect(Math.hypot(finA[0].x - centres[0].x, finA[0].y - centres[0].y)).toBeLessThan(0.05);
    await sleep(300);
    await C.page.screenshot({ path: testInfo.outputPath('ult-aim-seen-by-c.png') });

    // ── B (드래그): drag onto the field → B's guardian goes there and casts there, the same on every screen ──
    await expect(B.page.locator('.ult')).toHaveClass(/is-full/, { timeout: 8000 });
    const fromB = await B.page.evaluate(() => {
      const s = window.__proto!.game!.state;
      const me = s.players[window.__proto!.localPlayer];
      const e = s.entities.find(x => x.id === me.party[me.activeIndex!]?.entityId)!;
      return { x: e.pos.x, y: e.pos.y };
    });
    const Q = { x: fromB.x < 12 ? fromB.x + 5 : fromB.x - 5, y: fromB.y < 6 ? fromB.y + 2 : fromB.y - 2 };
    await dragUlt(B, await fingerFor(B, Q));
    // its wall (0.75 s) and its ★ finisher 성벽 돌파 (1.6 s, the band in front of the wall) the same on every screen
    const [landed, finB] = await Promise.all([
      Promise.all(all.map(p => zoneOf(p, 1, Q, 0.6))),
      Promise.all(all.map(p => finisherWarning(p, { shape: 'rect', length: 5, width: 13 }))),
    ]);
    for (const c of landed) expect(c).toEqual(landed[0]);
    for (const c of finB) expect(c).toEqual(finB[0]);
    await sleep(300);
    await A.page.screenshot({ path: testInfo.outputPath('ult-drag-seen-by-a.png') });

    // ── 기획 23차 검토: the host's 「메뉴」 on a phone (the 「궁극기 연출 강화」 row + the room note) fits the screen: 나가기,
    // the sound sliders and the note all inside it ──
    await A.page.keyboard.press('Escape');
    await expect(A.page.locator('.pause')).toBeVisible();
    await expect(A.page.locator('.pause')).toHaveClass(/is-multi/);
    await expect(A.page.locator('.btn-ultfx')).toBeVisible();
    const vh = A.page.viewportSize()!.height;
    for (const sel of ['.pause-box', '.pause-btns > .btn-danger', '.pause-box .snd-panel', '.pause-note']) {
      const b = (await A.page.locator(sel).first().boundingBox())!;
      expect(b.y, sel).toBeGreaterThanOrEqual(-1);
      expect(b.y + b.height, sel).toBeLessThanOrEqual(vh + 1);
    }
    await A.page.screenshot({ path: testInfo.outputPath('ult-menu-host.png') });
    await A.page.keyboard.press('Escape');
    await expect(A.page.locator('.pause')).toBeHidden();

    // ── the host's debug 「궁극기 방식」 → 현재: every screen's players are 'now' ──
    await tap(A, '.btn-dbg');
    await tap(A, '.dbg-ult-mode[data-mode="now"]');
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.players.every(x => x.ultMode === 'now'));
    await expect(B.page.locator('.ult-mode')).toBeHidden();

    for (const p of all) expect(p.errors).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close();
  }
});
