// 기획 15차 · 16차 원정 online (docs/expedition.md 5장 · 7장, server/expedition.ts): the built game server serving the
// built client. 기획 16차: one floor per stage, every stage ends in each player's own 원정 lobby.
//  1) Two phones (A, B) → 메인 → 원정 → the same stage-1 queue (A first = seat 0 = the room's debug host) → the 15 s wait
//     fills the third seat with a bot → stage 1 → debug clear → each picks a floor reward → both lobbies show the same
//     loot table's own share → A 「수령」 (A's stash +1), B 「2단계 매칭」 (double tap) → alone in the stage-2 queue → bots
//     after 15 s → stage 2 carries B's floor reward and bag → clear → lobby (bag 2) → 「수령」 (B's stash +2).
//  2) Two phones (C, D) play stage 1 → both 「2단계 매칭」 together → C leaves mid-stage: only C's bag is lost (failure
//     screen), D clears and keeps its bag. A new run's 「취소」 in the queue goes back to the lobby with no run.
//  3) Two phones (E, F) clear stage 1 → F reloads in the lobby (the run stays) → both 「2단계 매칭」 → the party wipes
//     (debug 'wipeParty'): each loses only its bag; stash and worn gear stay.
// No page errors on any phone. Screenshot: docs/screenshots/expedition-match-online.png (phone, @3x).

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const OUT = process.env.E2E_OUT || 'dist';
const SERVER_JS = OUT === 'dist' ? 'dist-server/index.js' : `${OUT}-server/index.js`;
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
  // its own server bundle (parallel agents may build dist-server at the same time)
  execSync(`npx esbuild server/main.ts --bundle --platform=node --format=esm --target=node20 --packages=external --outfile=${SERVER_JS} --log-level=warning`, { stdio: 'ignore' });
  const port = await freePort();
  // the real queue (15 s); a short end linger
  server = spawn(process.execPath, [SERVER_JS], {
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

interface RunInfo {
  stage: number;
  cleared: number;
  status: string;
  bag: unknown[];
}
const storedRun = (p: Phone) => p.page.evaluate(k => (JSON.parse(localStorage.getItem(k) ?? 'null')?.run ?? null) as RunInfo | null, STASH_KEY);

/** After the clear: pick the floor reward, pass a 괴담 room, until the phone is back in its 원정 lobby. */
async function finishStage(phones: Phone[]): Promise<void> {
  const left = new Set(phones);
  for (let i = 0; i < 160 && left.size; i++) {
    for (const p of [...left]) {
      const ph = await p.page.evaluate(() => window.__proto!.phase);
      if (ph === 'expHub') {
        left.delete(p);
        continue;
      }
      if (ph === 'reward') {
        const card = p.page.locator('.rw-card').first();
        if (await card.isVisible()) await card.tap().catch(() => {});
      } else if (ph === 'goedam') await p.page.evaluate(() => {
          // 「지나간다」, then read the result card away
          const me = window.__proto!.localPlayer;
          window.__proto!.game!.dispatch({ type: 'goedam', player: me, option: 'leave' });
          window.__proto!.game!.dispatch({ type: 'goedam', player: me, option: 'continue' });
        });
    }
    await sleep(250);
  }
  if (left.size) throw new Error(`never reached the lobby: ${[...left].map(p => p.name).join(', ')}`);
}

async function startFresh(p: Phone, stage = 1): Promise<void> {
  await tap(p, '.mm-exp');
  await waitPhase(p.page, 'expHub');
  await tap(p, `.exp-stage[data-stage="${stage}"]`);
  await tap(p, '.exp-go');
  await waitPhase(p.page, 'expMatch');
}

/** The lobby after a cleared stage: the loot reveal, then the run panel. */
async function closeReveal(p: Phone): Promise<void> {
  await expect(p.page.locator('.exp-reveal')).toBeVisible();
  await tap(p, '.exp-reveal-ok');
  await expect(p.page.locator('.exp-run')).toBeVisible();
}

test('원정 온라인: 2명 + 봇 1단계 → 각자 로비 → 한 명 수령, 한 명 2단계 매칭(봇) → 버프·가방 유지 → 수령', async ({ browser }) => {
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
  await tap(A, '.exp-go');
  await waitPhase(A.page, 'expMatch');
  await expect(A.page.locator('.exp-mt-title')).toHaveText('1단계 동료 찾는 중');
  await expect(A.page.locator('.exp-start-now')).toBeVisible();
  await expect(A.page.locator('.exp-cancel')).toHaveText('취소');
  // the run is saved as 'inStage' before the join (its result comes back by run id)
  expect(await storedRun(A)).toMatchObject({ stage: 1, cleared: 0, status: 'inStage' });

  await startFresh(B);
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
  await expect(B.page.locator('.fi-floor')).toHaveText('1단계');

  // A (seat 0 = host) clears the stage; both pick a floor reward; the loot table is the same on both screens
  expect(await debugAct(A, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await waitPhase(A.page, 'reward', 10_000);
  const lootA = await A.page.evaluate(() => JSON.stringify(window.__proto!.game!.state.expedition!.loot));
  const lootB = await B.page.evaluate(() => JSON.stringify(window.__proto!.game!.state.expedition!.loot));
  expect(lootA).toBe(lootB);
  await finishStage([A, B]);
  for (const p of [A, B]) {
    await expect(p.page.locator('.exp-reveal .exp-loot')).toHaveCount(1);
    await closeReveal(p);
    await expect(p.page.locator('.exp-run-bag .exp-tile')).toHaveCount(1);
    expect(await storedRun(p)).toMatchObject({ stage: 2, cleared: 1, status: 'lobby' });
  }

  // A claims: the bag (1 item) goes into A's stash
  const aBefore = await stashItems(A);
  await tap(A, '.exp-claim');
  await waitPhase(A.page, 'expResult', 10_000);
  await expect(A.page.locator('.exp-rs-title')).toHaveText('수령 완료!');
  expect(await stashItems(A)).toBe(aBefore + 1);
  expect(await storedRun(A)).toBeNull();

  // B goes on (double tap: the bag is at stake) — alone in the stage-2 queue, its buffs kept
  await tap(B, '.exp-next-match');
  await expect(B.page.locator('.exp-next-match .exp-choice-sub')).toContainText('한 번 더 누르면 매칭');
  await tap(B, '.exp-next-match');
  await waitPhase(B.page, 'expMatch', 10_000);
  await expect(B.page.locator('.exp-mt-title')).toHaveText('2단계 동료 찾는 중');
  await expect(B.page.locator('.exp-seat.is-me .exp-seat-note')).toContainText('유지');
  await waitPhase(B.page, 'combat', 25_000);
  const st2 = await B.page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return { stage: s.expedition?.stage, me: window.__proto!.localPlayer, bots: s.players.map(p => p.isBot), rewards: s.players[0].rewards.length, botGear: s.players[1].gear?.map(l => l.armor?.tier ?? 0) ?? null };
  });
  expect(st2.stage).toBe(2);
  expect(st2.me).toBe(0);
  expect(st2.bots).toEqual([false, true, true]);
  expect(st2.rewards).toBeGreaterThanOrEqual(1);
  expect(st2.botGear).toEqual([1, 1, 1]);
  await expect(B.page.locator('.exp-pill-bag')).toHaveText('가방 1');

  const bBefore = await stashItems(B);
  expect(await debugAct(B, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await finishStage([B]);
  await closeReveal(B);
  await expect(B.page.locator('.exp-run-bag .exp-tile')).toHaveCount(2);
  await tap(B, '.exp-claim');
  await waitPhase(B.page, 'expResult', 10_000);
  expect(await stashItems(B)).toBe(bBefore + 2);
  await tap(B, '.exp-rs-hub');
  await waitPhase(B.page, 'expHub');
  await expect(B.page.locator('.exp-stash-chip')).toHaveText(`보관함 ${bBefore + 2}`);

  expect([...A.errors, ...B.errors]).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

test('원정 온라인: 둘이 2단계 → 한 명이 도중에 나가면 그 사람 가방만 잃음 · 매칭 「취소」 = 로비', async ({ browser }) => {
  test.setTimeout(200_000);
  const C = await openPhone(browser, '씨');
  const D = await openPhone(browser, '디');
  await startFresh(C);
  await startFresh(D);
  for (const p of [C, D]) await expect(p.page.locator('.exp-seat.is-human')).toHaveCount(2);
  await tap(C, '.exp-start-now');
  await waitPhase(C.page, 'combat', 10_000);
  await waitPhase(D.page, 'combat', 10_000);
  expect(await debugAct(C, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await finishStage([C, D]);
  for (const p of [C, D]) await closeReveal(p);

  // both go on to stage 2 together (C first = seat 0)
  for (const p of [C, D]) {
    await tap(p, '.exp-next-match');
    await tap(p, '.exp-next-match');
    await waitPhase(p.page, 'expMatch', 10_000);
  }
  for (const p of [C, D]) await expect(p.page.locator('.exp-seat.is-human')).toHaveCount(2);
  await tap(C, '.exp-start-now');
  await waitPhase(C.page, 'combat', 10_000);
  await waitPhase(D.page, 'combat', 10_000);
  const cBefore = await stashItems(C);

  // C's pause menu 나가기 (a personal leave even as seat 0): C's failure screen, C's stash untouched
  await C.page.evaluate(() => window.__proto!.setPaused(true));
  await expect(C.page.locator('.pause-note')).toContainText('내 가방을 잃고');
  await C.page.locator('.pause .btn-danger').tap();
  await C.page.locator('.pause .btn-danger').tap();
  await waitPhase(C.page, 'expResult', 10_000);
  await expect(C.page.locator('.exp-rs-title')).toHaveText('원정 실패');
  await expect(C.page.locator('.exp-rs-lost .exp-tile')).toHaveCount(1);
  expect(await stashItems(C)).toBe(cBefore);
  expect(await storedRun(C)).toBeNull();

  // D plays on (C's seat is a bot now) and keeps its bag
  expect(await D.page.evaluate(() => window.__proto!.game!.state.players[0].isBot)).toBe(true);
  expect(await debugAct(D, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await finishStage([D]);
  await closeReveal(D);
  await expect(D.page.locator('.exp-run-bag .exp-tile')).toHaveCount(2);
  expect(await storedRun(D)).toMatchObject({ stage: 3, cleared: 2, status: 'lobby' });

  // a new run's 「취소」 in the queue: back to the lobby, the empty run is gone
  await tap(C, '.exp-rs-hub');
  await waitPhase(C.page, 'expHub');
  await tap(C, '.exp-go');
  await waitPhase(C.page, 'expMatch');
  await tap(C, '.exp-cancel');
  await waitPhase(C.page, 'expHub', 10_000);
  await expect(C.page.locator('.exp-map')).toBeVisible();
  expect(await storedRun(C)).toBeNull();

  expect([...C.errors, ...D.errors]).toEqual([]);
  await C.ctx.close();
  await D.ctx.close();
});

test('원정 온라인 (기획 16차): 로비에서 새로고침해도 런 유지 · 둘이 2단계에서 전멸하면 각자 가방만 잃음', async ({ browser }) => {
  test.setTimeout(200_000);
  const E = await openPhone(browser, '이');
  const F = await openPhone(browser, '에프');
  const stashOf = (p: Phone) => p.page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null') as { items: unknown[]; equipped: unknown } | null, STASH_KEY);
  await startFresh(E);
  await startFresh(F);
  for (const p of [E, F]) await expect(p.page.locator('.exp-seat.is-human')).toHaveCount(2);
  await tap(E, '.exp-start-now');
  await waitPhase(E.page, 'combat', 10_000);
  await waitPhase(F.page, 'combat', 10_000);
  expect(await debugAct(E, { kind: 'expeditionClearStage' })).toMatchObject({ ok: true });
  await finishStage([E, F]);
  for (const p of [E, F]) await closeReveal(p);

  // F reloads in the lobby: the run (bag 1, stage 2 next) is still there, the lobby shows it again
  const runF = await storedRun(F);
  expect(runF).toMatchObject({ stage: 2, cleared: 1, status: 'lobby' });
  await F.page.reload();
  await waitPhase(F.page, 'main');
  await F.page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10_000 });
  await expect(F.page.locator('.mm-exp-foot')).toContainText('2단계 대기');
  await tap(F, '.mm-exp');
  await waitPhase(F.page, 'expHub');
  await expect(F.page.locator('.exp-run')).toBeVisible();
  await expect(F.page.locator('.exp-run-bag .exp-tile')).toHaveCount(1);
  expect(await storedRun(F)).toEqual(runF);

  // both go on to stage 2 and the party wipes: each loses only its bag (stash and worn gear stay)
  const before = { E: await stashOf(E), F: await stashOf(F) };
  for (const p of [E, F]) {
    await tap(p, '.exp-next-match');
    await tap(p, '.exp-next-match');
    await waitPhase(p.page, 'expMatch', 10_000);
  }
  for (const p of [E, F]) await expect(p.page.locator('.exp-seat.is-human')).toHaveCount(2);
  await tap(E, '.exp-start-now');
  await waitPhase(E.page, 'combat', 10_000);
  await waitPhase(F.page, 'combat', 10_000);
  expect(await debugAct(E, { kind: 'wipeParty' })).toMatchObject({ ok: true });
  for (const p of [E, F]) {
    await waitPhase(p.page, 'expResult', 15_000);
    await expect(p.page.locator('.exp-rs-title')).toHaveText('원정 실패');
    await expect(p.page.locator('.exp-rs-reason')).toHaveText('전멸');
    await expect(p.page.locator('.exp-rs-lost .exp-tile')).toHaveCount(1);
    const after = await stashOf(p);
    const b = before[p.name === '이' ? 'E' : 'F'];
    expect(after?.items).toEqual(b?.items);
    expect(after?.equipped).toEqual(b?.equipped);
    expect(await storedRun(p)).toBeNull();
    await tap(p, '.exp-rs-hub');
    await waitPhase(p.page, 'expHub');
    await expect(p.page.locator('.exp-map')).toBeVisible();
  }

  expect([...E.errors, ...F.errors]).toEqual([]);
  await E.ctx.close();
  await F.ctx.close();
});
