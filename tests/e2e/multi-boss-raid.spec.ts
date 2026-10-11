// 기획 19차 보스 레이드 멀티 (docs/boss-raid.md 6장): the built game server + three phone contexts. The host picks the mode
// (?mode=bossRaid = the main menu's third card) and makes a room — the 매칭 header, the room list row and the room view
// carry the 「보스 레이드」 label on every device, also for members who picked the classic tower and joined by code / from
// the list. The host starts: all three are in the same raid (mode, seed, floor 1 boss, 「보스 1/20」), the snapshots keep
// in step; the host's debug 「보스 고르기」 swaps the floor-1 boss on all three screens (a member cannot); 「다음 보스로」 +
// three reward picks lead everyone to the same floor-2 boss. A member who leaves keeps the floor
// they reached; a wipe shows the raid result on the others and each device stores its own record. The room stays a raid room.
// Second test (integration): three phones clear all 20 floors by the host's debug 「다음 보스로」, everyone picking a card
// on every reward screen (relics after 5 · 10 · 15) — 20 different bosses, the same on every screen, then the clear
// screen and a clear record on all three devices.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import type { AppPhase } from '../../src/ui/app';

const OUT = process.env.E2E_OUT || 'dist';
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const RECORD_KEY = 'swap-tower.bossRaid.v1';
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
  name: string;
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

/** A new phone (= another device) on the preset screen, online. `query` '?mode=bossRaid' = the 보스 레이드 card picked. */
async function openPlayer(browser: Browser, name: string, query = ''): Promise<Player> {
  const ctx = await browser.newContext(PHONE);
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

/** Real touch tap on the element's centre. */
async function tap(p: Player, selector: string): Promise<void> {
  const l = p.page.locator(selector).first();
  await expect(l).toBeVisible();
  await l.tap();
}

async function toLobby(p: Player, nick: string): Promise<void> {
  await tap(p, '.btn-start');
  await waitPhase(p.page, 'lobby');
  const input = p.page.locator('.lb-name input');
  await input.fill(nick);
  await input.press('Enter');
  await p.page.waitForFunction(n => document.querySelector<HTMLInputElement>('.lb-name input')?.value === n, nick);
}

interface Seen {
  mode: string | undefined;
  seed: number;
  floor: number;
  kind: string;
  bossId: string | undefined;
  tick: number;
  bossHp: number;
  bossMaxHp: number;
  phase: string;
}
const seen = (page: Page) =>
  page.evaluate((): Seen => {
    const s = window.__proto!.game!.state;
    const boss = s.entities.find(e => e.id === s.bossId);
    return {
      mode: s.mode,
      seed: s.seed,
      floor: s.floor,
      kind: s.plan.kind,
      bossId: s.plan.bossId,
      tick: s.tick,
      bossHp: boss?.hp ?? -1,
      bossMaxHp: boss?.maxHp ?? -1,
      phase: s.phase,
    };
  });
const record = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null') as { bestFloor: number; clears: number; runs: number } | null, RECORD_KEY);
const bossName = async (page: Page) => (await page.locator('.boss-name').textContent()) ?? '';

test('보스 레이드 방: 라벨(매칭 · 목록 · 방) → 시작 → 세 화면 같은 1층 보스 → 다음 보스로 → 같은 2층 보스 → 결과 · 기록', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser, 'A', '?mode=bossRaid');
  const B = await openPlayer(browser, 'B');
  const C = await openPlayer(browser, 'C');
  const all = [A, B, C];
  try {
    // ── the host picked 보스 레이드: the preset and the 매칭 screen say so ──
    await expect(A.page.locator('.ps-title')).toHaveText('보스 레이드 편성');
    await expect(B.page.locator('.ps-title')).toHaveText('클래식 탑 편성');
    await toLobby(A, '에이');
    await expect(A.page.locator('.lb-title-row .lb-mode')).toHaveText('보스 레이드');
    await expect(A.page.locator('.lb-sub')).toContainText('층마다 보스');
    await expect(A.page.locator('.lb-create .lb-btn-main')).toHaveText('방 만들기');
    await expect(A.page.locator('.lb-create-sub')).toHaveText('보스 레이드');
    await A.page.screenshot({ path: testInfo.outputPath('raid-lobby-a.png') });
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    await expect(A.page.locator('.lb-title-row .lb-mode')).toBeVisible();
    await expect(A.page.locator('.lb-roomname-row .lb-room-mode')).toHaveText('보스 레이드');

    // ── B picked the classic tower: no chip in its 매칭 header, a plain 「방 만들기」; it joins the raid room by code ──
    await toLobby(B, '비');
    await expect(B.page.locator('.lb-title-row .lb-mode')).toBeHidden();
    await expect(B.page.locator('.lb-create-sub')).toBeHidden();
    await B.page.locator('.lb-code-input').fill(code);
    await tap(B, '.lb-join');
    await waitPhase(B.page, 'room');
    await expect(B.page.locator('.lb-roomname-row .lb-room-mode')).toHaveText('보스 레이드');
    await expect(B.page.locator('.lb-title-row .lb-mode')).toBeVisible(); // in a room its mode counts, not my pick

    // ── C sees the tag on the room's row of the list and joins from there ──
    await toLobby(C, '씨');
    const row = C.page.locator(`.lb-room-row[data-code="${code}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-mode', 'bossRaid');
    await expect(row.locator('.lb-row-mode')).toHaveText('보스 레이드');
    await expect(row).toContainText('2/3');
    await C.page.screenshot({ path: testInfo.outputPath('raid-lobby-c.png') });
    await tap(C, `.lb-room-row[data-code="${code}"]`);
    await waitPhase(C.page, 'room');
    for (const p of all) {
      await expect(p.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(3);
      await expect(p.page.locator('.lb-roomname-row .lb-room-mode')).toBeVisible();
    }
    await sleep(250);
    await A.page.screenshot({ path: testInfo.outputPath('raid-room-a.png') });

    // ── 시작 (방장): the same raid on all three ──
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    // the floor banner (3.2 s) on the host's screen
    await expect(A.page.locator('.banner-raid .banner-big')).toBeVisible();
    const seedBoss1 = await bossName(A.page);
    await expect(A.page.locator('.banner-raid .banner-big')).toHaveText(`1층 · ${seedBoss1}`);
    const first = await Promise.all(all.map(p => seen(p.page)));
    for (const s of first) expect(s).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss', seed: first[0].seed, bossId: first[0].bossId, bossMaxHp: first[0].bossMaxHp });
    expect(first[0].bossId).toBeTruthy();
    expect(first[0].bossMaxHp).toBeGreaterThan(0);
    expect(await Promise.all(all.map(p => p.page.evaluate(() => [window.__proto!.mode, window.__proto!.localPlayer])))).toEqual([
      ['multi', 0],
      ['multi', 1],
      ['multi', 2],
    ]);
    expect(seedBoss1.length).toBeGreaterThan(1);
    for (const p of all) {
      await expect(p.page.locator('.boss-name')).toHaveText(seedBoss1);
      await expect(p.page.locator('.boss-lv')).toHaveText('1층');
      await expect(p.page.locator('.boss-raid-n')).toHaveText('1/20');
      await expect(p.page.locator('.floorinfo')).toBeHidden();
    }
    await sleep(600);
    await B.page.screenshot({ path: testInfo.outputPath('raid-combat-b.png') });

    // ── no desync: after a few seconds the three snapshots are the same game at (nearly) the same tick ──
    await sleep(2500);
    const later = await Promise.all(all.map(p => seen(p.page)));
    const ticks = later.map(s => s.tick);
    expect(Math.min(...ticks)).toBeGreaterThan(Math.max(...first.map(s => s.tick)));
    expect(Math.max(...ticks) - Math.min(...ticks)).toBeLessThan(30); // < 1 s apart (15 Hz snapshots, read one after another)
    for (const s of later) expect(s).toMatchObject({ phase: 'combat', floor: 1, bossId: first[0].bossId, bossMaxHp: first[0].bossMaxHp });
    const hps = later.map(s => s.bossHp / s.bossMaxHp);
    expect(Math.max(...hps) - Math.min(...hps)).toBeLessThan(0.1);
    for (const p of all) await expect(p.page.locator('.net-banner')).toBeHidden();

    // ── 「보스 고르기」 is the host's: the same floor again with 퇴근 못 한 모니터 on all three screens ──
    await expect(B.page.locator('.btn-dbg')).toBeHidden();
    await expect(C.page.locator('.btn-dbg')).toBeHidden();
    await tap(A, '.btn-dbg');
    const picker = A.page.locator('.debug-panel .dbg-raid-boss');
    await expect(picker.locator('option')).toHaveCount(20);
    await expect(picker).toHaveValue(first[0].bossId!);
    await picker.selectOption({ label: '퇴근 못 한 모니터' });
    await tap(A, '.dbg-raid-go');
    const boss1 = '퇴근 못 한 모니터';
    expect(boss1).not.toBe(seedBoss1);
    for (const p of all) {
      await p.page.waitForFunction(() => window.__proto!.game!.state.plan.bossId === 'dead_monitor', undefined, { timeout: 10_000 });
      await expect(p.page.locator('.boss-name')).toHaveText(boss1);
      await expect(p.page.locator('.boss-lv')).toHaveText('1층');
      await expect(p.page.locator('.boss-raid-n')).toHaveText('1/20');
    }
    const picked = await Promise.all(all.map(p => seen(p.page)));
    for (const s of picked) expect(s).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss', phase: 'combat', bossId: 'dead_monitor', bossMaxHp: picked[0].bossMaxHp });
    // a member cannot: the command is refused and nothing changes
    for (const p of [B, C]) {
      const r = await p.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'raidBoss', boss: 'inverted_moon' } }));
      expect(r).toEqual({ ok: false, reason: '방장만 할 수 있어요' });
    }
    await sleep(700);
    for (const p of all) expect((await seen(p.page)).bossId).toBe('dead_monitor');
    await B.page.screenshot({ path: testInfo.outputPath('raid-picked-b.png') });

    // ── the host's debug panel (still open) says 「다음 보스로」; everyone picks a reward; the same floor-2 boss ──
    await expect(A.page.locator('.dbg-skip')).toHaveText('다음 보스로');
    await A.page.locator('.dbg-skip').click();
    for (const p of all) await waitPhase(p.page, 'reward');
    await A.page.locator('.debug-panel [aria-label="닫기"]').click();
    for (const p of all) {
      await expect(p.page.locator('.rw-card').first()).toBeVisible();
      await tap(p, '.rw-card >> nth=0 >> .rw-pick');
    }
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.floor === 2 && window.__proto!.phase === 'combat', undefined, { timeout: 10_000 });
    const second = await Promise.all(all.map(p => seen(p.page)));
    for (const s of second) expect(s).toMatchObject({ mode: 'bossRaid', floor: 2, kind: 'boss', bossId: second[0].bossId });
    expect(second[0].bossId).not.toBe(first[0].bossId);
    expect(second[0].bossId).not.toBe('dead_monitor');
    const boss2 = await bossName(A.page);
    expect(boss2).not.toBe(boss1);
    for (const p of all) {
      await expect(p.page.locator('.boss-name')).toHaveText(boss2);
      await expect(p.page.locator('.boss-lv')).toHaveText('2층');
      await expect(p.page.locator('.boss-raid-n')).toHaveText('2/20');
    }

    // ── C leaves from the menu (「2층 · 보스 레이드」): its device keeps the floor it reached ──
    await tap(C, '[aria-label="일시정지"]');
    await expect(C.page.locator('.pause.is-multi')).toBeVisible();
    await expect(C.page.locator('.pause-info')).toContainText('2층 · 보스 레이드');
    await tap(C, '.pause-btns .btn-danger');
    await tap(C, '.pause-btns .btn-danger');
    await waitPhase(C.page, 'lobby');
    expect(await record(C.page)).toEqual({ bestFloor: 2, clears: 0, runs: 1 });
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[2].isBot === true, undefined, { timeout: 10_000 });

    // ── a wipe ends the run: the raid result on A and B, each device with its own record ──
    await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'wipeParty' } }));
    for (const p of [A, B]) {
      await waitPhase(p.page, 'result', 20_000);
      await expect(p.page.locator('.rs-title')).toHaveText('패배');
      await expect(p.page.locator('.rs-mode')).toHaveText('보스 레이드');
      await expect(p.page.locator('.rs-fact-floor .rs-fact-v')).toHaveText('2층');
      await expect(p.page.locator('.rs-fact-bosses .rs-fact-v')).toHaveText('1마리');
      await expect(p.page.locator('.rs-fact-best .rs-fact-v')).toHaveText('2층');
      await expect(p.page.locator('.rs-fact-best .rs-new')).toBeVisible();
      await expect(p.page.locator('.rs-floor .rs-floor-n')).toHaveText([`1층 · ${boss1}`, `2층 · ${boss2}`]);
      expect(await record(p.page)).toEqual({ bestFloor: 2, clears: 0, runs: 1 });
    }
    await B.page.screenshot({ path: testInfo.outputPath('raid-result-b.png') });

    // ── 방으로: the room is still a 보스 레이드 room (the host can start again) ──
    await tap(A, '.rs-foot .btn-primary');
    await waitPhase(A.page, 'room');
    await expect(A.page.locator('.lb-roomname-row .lb-room-mode')).toHaveText('보스 레이드');
    // C, back on the list, still sees the tag on the row
    await expect(C.page.locator(`.lb-room-row[data-code="${code}"] .lb-row-mode`)).toHaveText('보스 레이드');

    const errors = all.flatMap(p => p.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});

test('보스 레이드 방: 3명이 20층을 디버그로 완주 → 세 화면 모두 승리 화면 · 각자 클리어 기록', async ({ browser }, testInfo) => {
  test.setTimeout(280_000);
  const A = await openPlayer(browser, 'A', '?mode=bossRaid');
  const B = await openPlayer(browser, 'B');
  const C = await openPlayer(browser, 'C');
  const all = [A, B, C];
  try {
    await toLobby(A, '에이');
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    for (const [p, nick] of [[B, '비'], [C, '씨']] as const) {
      await toLobby(p, nick);
      await p.page.locator('.lb-code-input').fill(code);
      await tap(p, '.lb-join');
      await waitPhase(p.page, 'room');
    }
    for (const p of all) await expect(p.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(3);
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    const dbg = (action: object) => A.page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a as never }), action);
    // the host's sliders: nobody dies on the way, no 괴담 rooms between the floors
    expect((await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'tunables', patch: { invincible: true, goedamRoomsPerZone: 0 } }))).ok).toBe(true);
    await B.page.waitForFunction(() => window.__proto!.game!.tunables.invincible === true, undefined, { timeout: 5000 });

    const bosses: string[] = [];
    for (let f = 1; f <= 20; f++) {
      for (const p of all) {
        await p.page.waitForFunction(n => window.__proto!.phase === 'combat' && window.__proto!.game!.state.floor === n && window.__proto!.game!.state.phase === 'combat', f, { timeout: 15_000 });
      }
      const here = await Promise.all(all.map(p => seen(p.page)));
      for (const s of here) expect(s).toMatchObject({ mode: 'bossRaid', floor: f, kind: 'boss', bossId: here[0].bossId });
      bosses.push(here[0].bossId!);
      if (f === 20) for (const p of all) await expect(p.page.locator('.boss-raid-n')).toHaveText('20/20');
      expect((await dbg({ kind: 'skipFloor' })).ok).toBe(true);
      if (f === 20) break; // the last boss ends the run at once (no reward screen, like the classic floor 20)
      // everyone picks the first card (a relic on 5 · 10 · 15); the game goes on when all three have picked
      for (const p of all) {
        await waitPhase(p.page, 'reward', 15_000).catch(async e => {
          throw new Error(`floor ${f}, ${p.name}: no reward screen — ${JSON.stringify(await Promise.all(all.map(q => seen(q.page))))} app ${await p.page.evaluate(() => window.__proto!.phase)}
${e}`);
        });
        await expect(p.page.locator('.rw-card').first()).toBeVisible();
        if (f % 5 === 0) await expect(p.page.locator('.rw-card .rw-relic').first()).toBeVisible();
        await tap(p, '.rw-card >> nth=0 >> .rw-pick');
      }
    }
    // 20 floors, 20 different bosses, the watcher last — and the clear screen on all three
    expect(new Set(bosses).size).toBe(20);
    expect(bosses[19]).toBe('abyss_watcher');
    for (const p of all) {
      await waitPhase(p.page, 'result', 20_000);
      await expect(p.page.locator('.rs-title')).toHaveText('승리!');
      await expect(p.page.locator('.rs-mode')).toHaveText('보스 레이드');
      await expect(p.page.locator('.rs-reason')).toHaveText('보스 20종을 모두 쓰러뜨렸어요');
      await expect(p.page.locator('.rs-fact-floor .rs-fact-v')).toHaveText('20층');
      await expect(p.page.locator('.rs-fact-bosses .rs-fact-v')).toHaveText('20마리');
      await expect(p.page.locator('.rs-floor.is-clear')).toHaveCount(20);
      expect(await record(p.page)).toEqual({ bestFloor: 20, clears: 1, runs: 1 });
    }
    await C.page.screenshot({ path: testInfo.outputPath('raid-clear-c.png') });
    const errors = all.flatMap(p => p.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});
