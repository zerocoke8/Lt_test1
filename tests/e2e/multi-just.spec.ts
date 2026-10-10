// 기획 17차 multiplayer (docs/just-swap.md 멀티, docs/floor-rewards.md): three phones in one room. The floor reward
// screen counts down from 30 s and names the card the server would take; each player picks their own (B's 다시 뽑기
// changes only B's cards; the host A re-rolls with 여분의 향 (debug is host-only) until a member / role card shows and
// gives it to a non-default character by tapping a portrait — 지명권). A co-op card (나눠 쓰는 영혼, granted to A) fills B's and C's ult on A's
// ult. Then the host's 「저스트 연습」 aims a weak attack at the host's field character; swapping on
// the gold cue is judged by the server: the host sees the big stamp, the other two see a small stamp in the host's
// colour, and nobody's game clock slows (multiplayer keeps time; only the look desaturates on the host's screen); every
// screen ends with the same rewards, rerolls, counters and 저스트 counts (no desync).

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import type { DebugAction, RewardOffer } from '../../src/types';
import type { AppPhase } from '../../src/ui/app';

const OUT = process.env.E2E_OUT || 'dist';
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
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
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

async function openPlayer(browser: Browser, name: string): Promise<Player> {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`);
  });
  await page.goto(base);
  await waitPhase(page, 'preset');
  await page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10_000 });
  return { ctx, page, errors };
}

async function waitPhase(page: Page, want: AppPhase, timeout = 15_000): Promise<void> {
  await page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}

async function toLobby(p: Player, nick: string): Promise<void> {
  await p.page.locator('.btn-start:not(.lb-start)').click();
  await waitPhase(p.page, 'lobby');
  const input = p.page.locator('.lb-name input');
  await input.fill(nick);
  await input.press('Enter');
}

const debug = (page: Page, action: DebugAction) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a }), action);
/** Debug 「보상 주기」 for the sender (the server fills in the player). */
async function grantTo(page: Page, rewardId: string): Promise<void> {
  expect((await debug(page, { kind: 'grantReward', rewardId, member: null })).ok, rewardId).toBe(true);
  await page.waitForFunction(id => window.__proto!.game!.state.players[window.__proto!.localPlayer].rewards.some(r => r.rewardId === id), rewardId, { timeout: 5000 });
}
const myOffers = (page: Page) => page.evaluate(() => window.__proto!.game!.state.rewardOffersByPlayer[window.__proto!.localPlayer] ?? []) as Promise<RewardOffer[]>;

/** Host: swap on the gold cue of the drill attack under my field character (snapshot telegraph within (0.2, 0.4] s). */
async function justOnce(page: Page): Promise<{ ok: boolean; minScale: number }> {
  return page.evaluate(async () => {
    const api = window.__proto!;
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      await new Promise(f => requestAnimationFrame(() => f(null)));
      const s = api.game!.state;
      const p = s.players[api.localPlayer];
      const id = p.activeIndex != null ? p.party[p.activeIndex].entityId : null;
      const me = s.entities.find(e => e.id === id);
      if (!me) continue;
      const t = s.telegraphs.find(x => x.team === 'enemy' && Math.hypot(x.center.x - me.pos.x, x.center.y - me.pos.y) < 0.6);
      if (!t || t.remaining > 0.4 || t.remaining <= 0.2) continue;
      const idx = p.party.findIndex((m, i) => i !== p.activeIndex && !m.dead && m.swapCooldownRemaining <= 0);
      if (idx < 0) continue;
      const r = api.ui.dragTo('swap', idx, { x: me.pos.x + 2.5, y: me.pos.y });
      let min = 1;
      const t1 = performance.now();
      while (performance.now() - t1 < 500) {
        await new Promise(f => requestAnimationFrame(() => f(null)));
        min = Math.min(min, api.ui.clockScale);
      }
      return { ok: r.ok, minScale: min };
    }
    return { ok: false, minScale: 1 };
  });
}

test('3 players: reward timer 30 s · each picks · own reroll · 지명권 · co-op reward; host 저스트 → small stamp on the others, no clock change', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const A = await openPlayer(browser, 'A');
  const B = await openPlayer(browser, 'B');
  const C = await openPlayer(browser, 'C');
  const all = [A, B, C];
  try {
    await toLobby(A, '에이');
    await A.page.locator('.lb-create').click();
    await waitPhase(A.page, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    for (const [p, n] of [[B, '비'], [C, '씨']] as const) {
      await toLobby(p, n);
      await p.page.locator('.lb-code-input').fill(code);
      await p.page.locator('.lb-join').click();
      await waitPhase(p.page, 'room');
    }
    await expect(A.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(3);
    await A.page.locator('.lb-start').click();
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    expect(await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'tunables', patch: { invincible: true, goedamRoomsPerZone: 0, fieldEventChance: 0 } }).ok)).toBe(true);
    await sleep(600); // the host's tunables reach the server

    // ── floor reward: 30 s, the timer names the server's pick, each player chooses their own ──
    await grantTo(A.page, 'incense_common'); // 여분의 향: A's rerolls 1 → 3 (A only)
    expect((await debug(A.page, { kind: 'skipFloor' })).ok).toBe(true);
    for (const p of all) await waitPhase(p.page, 'reward');
    for (const p of all) {
      await expect(p.page.locator('.rw-card')).toHaveCount(3);
      await expect(p.page.locator('.rw-timer')).toContainText('안 고르면');
    }
    const left = await A.page.evaluate(() => (window.__proto!.game as unknown as { rewardDeadline: number | null }).rewardDeadline! - Date.now());
    expect(left).toBeGreaterThan(24_000);
    expect(left).toBeLessThanOrEqual(31_000);
    await expect(A.page.locator('.rw-reroll')).toHaveText('다시 뽑기 3');
    await expect(B.page.locator('.rw-reroll')).toHaveText('다시 뽑기 1');
    const aBefore = (await myOffers(A.page)).map(o => o.rewardId).join();
    const bBefore = (await myOffers(B.page)).map(o => o.rewardId).join();
    await B.page.locator('.rw-reroll').click();
    await B.page.waitForFunction(b => (window.__proto!.game!.state.rewardOffersByPlayer[window.__proto!.localPlayer] ?? []).map(o => o.rewardId).join() !== b, bBefore, { timeout: 5000 });
    await expect(B.page.locator('.rw-reroll')).toHaveText('다시 뽑기 0');
    await expect(B.page.locator('.rw-reroll')).toBeDisabled();
    expect((await myOffers(A.page)).map(o => o.rewardId).join()).toBe(aBefore);
    // 지명권 on A (the host — debug is host-only): re-roll (3 with 여분의 향) until a member / role card shows, tap a portrait that is not the default
    let who = await A.page.locator('.rw-card:has(.rw-who)').count();
    for (let n = 0; who === 0 && n < 3; n++) {
      const before = (await myOffers(A.page)).map(o => o.rewardId).join();
      await A.page.locator('.rw-reroll').click();
      await A.page.waitForFunction(b => (window.__proto!.game!.state.rewardOffersByPlayer[window.__proto!.localPlayer] ?? []).map(o => o.rewardId).join() !== b, before, { timeout: 5000 });
      await sleep(450);
      who = await A.page.locator('.rw-card:has(.rw-who)').count();
    }
    expect(who, 'A: a member / role card within 3 rerolls').toBeGreaterThan(0);
    const aCard = A.page.locator('.rw-card:has(.rw-who)').first();
    const aIdx = await aCard.evaluate(el => [...el.parentElement!.children].indexOf(el));
    const aOffer = (await myOffers(A.page))[aIdx];
    const target = [0, 1, 2].find(i => i !== aOffer.member)!;
    await aCard.locator('.rw-who-p').nth(target).click();
    await expect(aCard.locator('.rw-who-p').nth(target)).toHaveClass(/is-picked/);
    await sleep(300);
    await aCard.locator('.rw-pick').click();
    for (const p of [B, C]) await p.page.locator('.rw-card .rw-pick').first().click();
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.floor === 2 && window.__proto!.phase === 'combat', undefined, { timeout: 10_000 });
    // A: 여분의 향 + the 지명권 pick (server-side: the chosen member, the rerolls spent)
    const picked = await A.page.evaluate(() => window.__proto!.game!.state.players.map(p => ({ n: p.rewards.length, last: p.rewards.at(-1), rerolls: p.rerolls })));
    expect(picked.map(p => p.n)).toEqual([2, 1, 1]); // A: 여분의 향 + the pick
    expect(picked[0].last).toMatchObject({ rewardId: aOffer.rewardId, partyIndex: target });
    expect(picked[1].rerolls).toBe(0);

    // ── a co-op reward reaches the team: A's 나눠 쓰는 영혼 → on A's ult, B's and C's field characters get +12 % ult ──
    await grantTo(A.page, 'shared_soul_common');
    expect((await debug(A.page, { kind: 'chargeUlt' })).ok).toBe(true);
    await A.page.waitForFunction(() => {
      const p = window.__proto!.game!.state.players[window.__proto!.localPlayer];
      return p.activeIndex != null && p.party[p.activeIndex].ult.charge >= 1;
    }, undefined, { timeout: 5000 });
    const fieldUlt = (page: Page, pi: number) =>
      page.evaluate(i => {
        const p = window.__proto!.game!.state.players[i];
        return p.activeIndex != null ? p.party[p.activeIndex].ult.charge : -1;
      }, pi);
    const before = [await fieldUlt(B.page, 1), await fieldUlt(C.page, 2)];
    expect(before.every(v => v >= 0 && v < 0.85), `B / C gauges ${before}`).toBe(true);
    expect((await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'ult', player: window.__proto!.localPlayer }))).ok).toBe(true);
    await B.page.waitForFunction(b => {
      const p = window.__proto!.game!.state.players[1];
      return p.activeIndex != null && p.party[p.activeIndex].ult.charge >= b + 0.1;
    }, before[0], { timeout: 4000 });
    await C.page.waitForFunction(b => {
      const p = window.__proto!.game!.state.players[2];
      return p.activeIndex != null && p.party[p.activeIndex].ult.charge >= b + 0.1;
    }, before[1], { timeout: 4000 });

    // ── 저스트 교대 by the host (server-judged) ──
    await sleep(2500);
    expect((await debug(A.page, { kind: 'justDrill' })).ok).toBe(true);
    let done = 0;
    for (let k = 0; k < 4 && done === 0; k++) {
      const r = await justOnce(A.page);
      expect(r.minScale).toBe(1); // multiplayer never slows the clock
      await sleep(400);
      done = await A.page.evaluate(() => window.__proto!.game!.state.players[0].stats.justSwaps);
    }
    expect(done, 'a 저스트 within 4 drills').toBeGreaterThan(0);
    await A.page.waitForFunction(() => window.__proto!.ui.justStamps.some(s => s.mine), undefined, { timeout: 3000 });
    for (const p of [B, C]) {
      await p.page.waitForFunction(() => window.__proto!.ui.justStamps.some(s => !s.mine && s.player === 0), undefined, { timeout: 3000 });
      expect(await p.page.evaluate(() => window.__proto!.ui.clockScale)).toBe(1);
    }
    await B.page.screenshot({ path: testInfo.outputPath('multi-just-b.png') });
    expect((await debug(A.page, { kind: 'justDrill' })).ok).toBe(true);
    // no desync: every screen holds the same rewards (ids + targets), rerolls, reward counters and 저스트 counts
    const view = (page: Page) =>
      page.evaluate(() => {
        const s = window.__proto!.game!.state;
        return JSON.stringify({
          floor: s.floor,
          players: s.players.map(p => ({ rewards: p.rewards, rerolls: p.rerolls, rs: p.rewardState ?? null, just: p.stats.justSwaps, dodged: p.stats.justDodged })),
        });
      });
    await sleep(500);
    const views = [await view(A.page), await view(B.page), await view(C.page)];
    expect(views[1]).toBe(views[0]);
    expect(views[2]).toBe(views[0]);
    for (const p of all) expect(p.errors, p.errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});
