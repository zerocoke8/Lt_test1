// 기획 15차 원정 online (docs/expedition.md 5장 · 7장, server/expedition.ts): the built game server serving the built
// client, two phones (A, B) → 메인 → 원정 → stage 1 → the same stage queue (A first = seat 0 = the room's debug host) →
// the 15 s wait fills the third seat with a bot → stage 1 (A's debug-granted T1 gear is in B's snapshot too) → floor 1
// reward → debug stage clear → both see the same loot table and the 20 s choice timer → A 「장비 수령하고 나가기」 (A's
// stash gets the bag), B 「다음 단계 도전」 (double tap) → B alone in the stage-2 queue → bots after 15 s → stage 2 carries
// B's floor reward → clear → extract → B's stash has stage 1 + stage 2 loot. No page errors on either phone.
// Screenshots: docs/screenshots/expedition-match-online.png, expedition-choice-online.png (phone, @3x).

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const OUT = process.env.E2E_OUT || 'dist';
const SHOT_DIR = 'docs/screenshots';
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const STASH_KEY = 'swapTower.expedition.v1';
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
  const port = await freePort();
  // real queue (15 s) and choice (20 s) timings; a short end linger
  server = spawn(process.execPath, ['dist-server/index.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: path.resolve(OUT), END_LINGER_MS: '1500', EXP_SHARED_DEBUG: '1' },
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

interface Phone {
  name: string;
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

async function openPhone(browser: Browser, name: string): Promise<Phone> {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(n => {
    if (!localStorage.getItem('swapTower.nickname.v1')) localStorage.setItem('swapTower.nickname.v1', JSON.stringify(n));
  }, name);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`);
  });
  await page.goto(`${base}?main=1`);
  await waitPhase(page, 'main');
  await page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10_000 });
  return { name, ctx, page, errors };
}

async function waitPhase(page: Page, want: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}

async function tap(p: Phone, selector: string): Promise<void> {
  const l = p.page.locator(selector).first();
  await expect(l).toBeVisible();
  await l.tap();
}

const stashItems = (p: Phone) => p.page.evaluate(k => (JSON.parse(localStorage.getItem(k) ?? 'null')?.items ?? []).length as number, STASH_KEY);

const debugAct = (p: Phone, action: object) => p.page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a as never }), action);

/** Answer whatever the stage asks between floors (floor reward, a 괴담 room) until floor `floor` is in combat. */
async function playTo(phones: Phone[], floor: number): Promise<void> {
  for (let i = 0; i < 120; i++) {
    let done = true;
    for (const p of phones) {
      const st = await p.page.evaluate(() => {
        const g = window.__proto?.game;
        if (!g) return null;
        const s = g.state;
        const me = window.__proto!.localPlayer;
        return { phase: s.phase, floor: s.floor, me, offers: !!s.rewardOffersByPlayer[me]?.length, goedam: s.goedam?.players[me]?.stage ?? null };
      });
      if (!st || st.floor !== floor || st.phase !== 'combat') done = false;
      if (st?.phase === 'reward' && st.offers) await p.page.evaluate(me => window.__proto!.game!.dispatch({ type: 'chooseReward', player: me, offerIndex: 0 }), st.me);
      if (st?.phase === 'goedam') await p.page.evaluate(me => window.__proto!.game!.dispatch({ type: 'goedam', player: me, option: 'leave' }), st.me);
    }
    if (done) return;
    await sleep(250);
  }
  throw new Error(`floor ${floor} never started`);
}

test('원정 온라인: 2명 + 봇 1단계 → 한 명 수령, 한 명 도전 → 2단계 재매칭(봇) → 버프 유지 → 수령', async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await openPhone(browser, '에이');
  const B = await openPhone(browser, '비');

  // A: T1 gear for the whole party (hub DBG) — B must see it in its own snapshots
  await tap(A, '.mm-exp');
  await waitPhase(A.page, 'expHub');
  await tap(A, '.exp-dbg');
  await tap(A, '.exp-dbg-party[data-tier="1"]');
  await tap(A, '.exp-dbg-panel .dbg-hbtn');
  await tap(A, '.exp-stage[data-stage="1"]');
  await expect(A.page.locator('.exp-go')).toHaveText('1단계부터 출발');
  await tap(A, '.exp-go');
  await waitPhase(A.page, 'expMatch');
  await expect(A.page.locator('.exp-mt-title')).toHaveText('1단계 동료 찾는 중');
  await expect(A.page.locator('.exp-start-now')).toBeVisible();

  await tap(B, '.mm-exp');
  await waitPhase(B.page, 'expHub');
  await tap(B, '.exp-go');
  await waitPhase(B.page, 'expMatch');
  // both see two people in the queue and the countdown
  for (const p of [A, B]) await expect(p.page.locator('.exp-seat.is-human')).toHaveCount(2);
  await expect(B.page.locator('.exp-seat.is-me .exp-seat-name')).toHaveText('나 · 비');
  await B.page.waitForTimeout(600);
  await B.page.screenshot({ path: `${SHOT_DIR}/expedition-match-online.png` });

  // nobody else comes: after the 15 s wait the third seat is a bot and the stage starts
  const t0 = Date.now();
  await waitPhase(A.page, 'combat', 25_000);
  await waitPhase(B.page, 'combat', 10_000);
  expect(Date.now() - t0).toBeGreaterThan(8_000);
  const seen = await B.page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return { stage: s.expedition?.stage, me: window.__proto!.localPlayer, mode: window.__proto!.mode, bots: s.players.map(p => p.isBot), gearA: s.players[0].gear?.map(l => l.weapon?.tier ?? 0) ?? null };
  });
  expect(seen).toEqual({ stage: 1, me: 1, mode: 'multi', bots: [false, false, true], gearA: [1, 1, 1] });
  expect(await A.page.evaluate(() => window.__proto!.localPlayer)).toBe(0);
  await expect(B.page.locator('.fi-floor')).toHaveText('1단계 1층');

  // floor 1 → reward (each picks one) → floor 2; then A (seat 0 = host) clears the stage
  await debugAct(A, { kind: 'skipFloor' });
  await playTo([A, B], 2);
  expect(await debugAct(A, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await waitPhase(A.page, 'expChoice', 15_000);
  await waitPhase(B.page, 'expChoice', 15_000);
  // the same stage result on both screens (no desync): the loot table of every seat
  const lootA = await A.page.evaluate(() => JSON.stringify(window.__proto!.game!.state.expedition!.loot));
  const lootB = await B.page.evaluate(() => JSON.stringify(window.__proto!.game!.state.expedition!.loot));
  expect(lootA).toBe(lootB);
  for (const p of [A, B]) {
    await expect(p.page.locator('.exp-loot')).toHaveCount(2);
    await expect(p.page.locator('.exp-ch-timer')).toContainText('초 뒤 자동으로 수령해요');
  }
  await B.page.waitForTimeout(1300); // the reveal flips
  await B.page.screenshot({ path: `${SHOT_DIR}/expedition-choice-online.png` });

  // A claims: the bag (2 items) goes into A's stash; B goes on (double tap: the bag is at stake)
  const aBefore = await stashItems(A);
  await tap(A, '.exp-extract');
  await waitPhase(A.page, 'expResult', 15_000);
  await expect(A.page.locator('.exp-rs-title')).toHaveText('탈출 성공!');
  await expect.poll(() => stashItems(A)).toBe(aBefore + 2);

  await tap(B, '.exp-continue');
  await expect(B.page.locator('.exp-choice-risk')).toContainText('한 번 더 누르면 도전');
  await tap(B, '.exp-continue');
  await waitPhase(B.page, 'expMatch', 15_000);
  await expect(B.page.locator('.exp-mt-title')).toHaveText('2단계 동료 찾는 중');
  await expect(B.page.locator('.exp-seat.is-me .exp-seat-note')).toHaveText('버프 1개 유지');
  await expect(B.page.locator('.exp-cancel')).toHaveText('그만두고 수령하기');

  // alone in the stage-2 queue: bots after the 15 s wait; B is seat 0 (host) and keeps its floor reward
  await waitPhase(B.page, 'combat', 25_000);
  const st2 = await B.page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return { stage: s.expedition?.stage, me: window.__proto!.localPlayer, bots: s.players.map(p => p.isBot), rewards: s.players[0].rewards.length, botGear: s.players[1].gear?.map(l => l.armor?.tier ?? 0) ?? null };
  });
  expect(st2).toEqual({ stage: 2, me: 0, bots: [false, true, true], rewards: 1, botGear: [1, 1, 1] });
  await expect(B.page.locator('.exp-pill-bag')).toHaveText('가방 2');

  const bBefore = await stashItems(B);
  expect(await debugAct(B, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await waitPhase(B.page, 'expChoice', 15_000);
  await expect(B.page.locator('.exp-ch-bag .exp-tile')).toHaveCount(4);
  await tap(B, '.exp-extract');
  await waitPhase(B.page, 'expResult', 15_000);
  await expect.poll(() => stashItems(B)).toBe(bBefore + 4);
  await tap(B, '.exp-rs-hub');
  await waitPhase(B.page, 'expHub');
  await expect(B.page.locator('.exp-stash-chip')).toHaveText(`보관함 ${bBefore + 4}`);

  expect([...A.errors, ...B.errors]).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

test('원정 온라인: 혼자 「바로 출발」 → 봇 2명 · 도중에 나가면 가방만 잃음', async ({ browser }) => {
  const C = await openPhone(browser, '씨');
  await tap(C, '.mm-exp');
  await waitPhase(C.page, 'expHub');
  await tap(C, '.exp-go');
  await waitPhase(C.page, 'expMatch');
  await tap(C, '.exp-start-now');
  await waitPhase(C.page, 'combat', 10_000);
  expect(await C.page.evaluate(() => window.__proto!.game!.state.players.map(p => p.isBot))).toEqual([false, true, true]);
  // clear stage 1 and go on: the bag (2) is at stake in stage 2
  expect(await debugAct(C, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await waitPhase(C.page, 'expChoice', 15_000);
  await tap(C, '.exp-continue');
  await tap(C, '.exp-continue');
  await waitPhase(C.page, 'expMatch', 15_000);
  await tap(C, '.exp-start-now');
  await waitPhase(C.page, 'combat', 10_000);
  const before = await stashItems(C);
  // the pause menu's 나가기 (personal leave even as seat 0): the failure screen, the stash untouched
  await C.page.evaluate(() => window.__proto!.setPaused(true));
  await expect(C.page.locator('.pause-note')).toContainText('내 가방을 잃고');
  await C.page.locator('.pause .btn-danger').tap();
  await C.page.locator('.pause .btn-danger').tap();
  await waitPhase(C.page, 'expResult', 10_000);
  await expect(C.page.locator('.exp-rs-title')).toHaveText('원정 실패');
  await expect(C.page.locator('.exp-rs-lost .exp-tile')).toHaveCount(2);
  await sleep(1000);
  expect(await stashItems(C)).toBe(before);
  // a new run can start right away
  await tap(C, '.exp-rs-hub');
  await waitPhase(C.page, 'expHub');
  await tap(C, '.exp-go');
  await waitPhase(C.page, 'expMatch');
  await tap(C, '.exp-cancel');
  await waitPhase(C.page, 'expHub', 10_000);
  expect(C.errors).toEqual([]);
  await C.ctx.close();
});
