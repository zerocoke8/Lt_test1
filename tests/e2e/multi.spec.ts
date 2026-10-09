// E2E multiplayer (기획 3차 3, R30–R35): the built game server (dist-server) serving the built client, three isolated
// browser contexts (phone 844×390@3x, touch) → preset → 매칭 → room (create / join by code / join from the list) →
// host starts → combat with distinct localPlayer → REAL touch drags of directional drag skills (B: 블레이드 오른쪽 돌진,
// C: 거너 왼쪽 부채꼴): the drag preview is only on the dragger's screen, the dash/cast reaches everyone → per-player
// rewards (all three must choose) → B's page closes (slot → BOT) → B opens the link again on the same device (back in
// its seat, in control) → a member quits → the host ends the run → result → room → the host leaves the room (host
// handoff: the next member can start). Plus: a 괴담 room (기획 10차: two pick, one idles until the server's room deadline),
// a 1-human room (host + 2 bots, reload mid-game). 기획 12차: a new healer picked on the preset screen reaches the server's
// party; a forced 돌발 괴담 shows the same event at the same place on all three screens and a real drop wins the party reward.
// Screenshots: docs/screenshots/multi-*.png (phone, @3x).

import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import type { GameEvent, Vec2 } from '../../src/types';
import type { AppPhase } from '../../src/ui/app';

const OUT = process.env.E2E_OUT || 'dist';
const SHOT_DIR = 'docs/screenshots';
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
  name: string;
  ctx: BrowserContext;
  page: Page;
  cdp: CDPSession;
  errors: string[];
}

interface PresetChoice {
  characters: string[];
  pets: string[];
}

/** New phone context (= another device). `preset` is stored like the preset screen would before the page loads. */
async function openPlayer(browser: Browser, name: string, preset?: PresetChoice): Promise<Player> {
  const ctx = await browser.newContext(PHONE);
  if (preset) await ctx.addInitScript(p => localStorage.setItem('swapTower.preset.v1', JSON.stringify(p)), preset);
  return openPage(ctx, name);
}

/** Another tab on the same device (same localStorage): the page loads to `landing` (preset; combat when it reclaims a seat), online. */
async function openPage(ctx: BrowserContext, name: string, landing: AppPhase = 'preset'): Promise<Player> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`${name} HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(base);
  await waitPhase(page, landing);
  await page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10_000 });
  const cdp = await ctx.newCDPSession(page);
  return { name, ctx, page, cdp, errors };
}

const phase = (page: Page) => page.evaluate(() => window.__proto!.phase);

async function waitPhase(page: Page, want: AppPhase, timeout = 15_000): Promise<void> {
  await page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}

async function center(page: Page, selector: string): Promise<Vec2> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real touch tap (CDP touch events → pointer events with pointerType 'touch'). */
async function tap(p: Player, selector: string): Promise<void> {
  const c = await center(p.page, selector);
  await p.page.touchscreen.tap(c.x, c.y);
}

/** Real touch drag that keeps holding at `to`; resolves to release(). */
async function touchDragHold(p: Player, from: Vec2, to: Vec2): Promise<() => Promise<void>> {
  const at = (type: 'touchStart' | 'touchMove', q: Vec2) =>
    p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: q.x, y: q.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  await at('touchStart', from);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await at('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await sleep(16);
  }
  return async () => {
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
}

/** Real touch drag: press `from`, slide to `to`, hold a moment, release. */
async function touchDrag(p: Player, from: Vec2, to: Vec2): Promise<void> {
  const release = await touchDragHold(p, from, to);
  await sleep(200);
  await release();
}

type DashEv = Extract<GameEvent, { type: 'dash' }>;
type CastEv = Extract<GameEvent, { type: 'skillCast' }>;

/** Record the dash / drag-skill events this client's renderer receives (wraps the live game's drainEvents). */
async function recordFx(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __fx: GameEvent[] };
    w.__fx = [];
    const g = window.__proto!.game!;
    const orig = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const evs = orig();
      for (const e of evs) if (e.type === 'dash' || (e.type === 'skillCast' && e.slot === 'drag')) w.__fx.push(e);
      return evs;
    };
  });
}

/** First recorded dash of player `pi`'s party member `idx` (waits for it). */
async function dashOf(page: Page, pi: number, idx: number): Promise<DashEv> {
  const h = await page.waitForFunction(
    ([pi, idx]) => {
      const id = window.__proto!.game!.state.players[pi].party[idx].entityId;
      const fx = (window as unknown as { __fx: GameEvent[] }).__fx;
      return (id != null && fx.find(e => e.type === 'dash' && e.entityId === id)) || null;
    },
    [pi, idx] as const,
    { timeout: 5000 },
  );
  return (await h.jsonValue()) as DashEv;
}

/** First recorded drag-skill cast of player `pi` (waits for it). */
async function dragCastOf(page: Page, pi: number): Promise<CastEv> {
  const h = await page.waitForFunction(
    pi => (window as unknown as { __fx: GameEvent[] }).__fx.find(e => e.type === 'skillCast' && e.player === pi) || null,
    pi,
    { timeout: 5000 },
  );
  return (await h.jsonValue()) as CastEv;
}

/** Finger (client px) whose drop point is on the bare canvas near my field character. */
async function fieldFinger(page: Page): Promise<Vec2> {
  return page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const me = s.players[api.localPlayer];
    const canvas = document.querySelector('canvas.stage-canvas');
    const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
    const from = mine?.pos ?? { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 };
    const candidates = [{ x: from.x + 1.5, y: from.y - 1 }, { x: from.x - 1.5, y: from.y - 1 }, { x: from.x, y: from.y - 2 }, from];
    for (const w of candidates) {
      const f = api.ui.fingerFor(w);
      if (document.elementFromPoint(f.x, f.y) === canvas && f.x > 40 && f.x < window.innerWidth - 40) return f;
    }
    throw new Error('no valid drop point on the field');
  });
}

async function setNickname(p: Player, name: string): Promise<void> {
  const input = p.page.locator('.lb-name input');
  await input.fill(name);
  await input.press('Enter');
  await p.page.waitForFunction(n => document.querySelector<HTMLInputElement>('.lb-name input')?.value === n, name);
}

async function toLobby(p: Player, nick: string): Promise<void> {
  await tap(p, '.btn-start');
  await waitPhase(p.page, 'lobby');
  await setNickname(p, nick);
}

async function shot(p: Player, name: string): Promise<void> {
  await sleep(250);
  await p.page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

const state = <T>(page: Page, fn: string): Promise<T> =>
  page.evaluate(`(() => { const api = window.__proto; const g = api.game; const s = g && g.state; return (${fn}); })()`) as Promise<T>;

async function openMenuAndLeave(p: Player): Promise<void> {
  await tap(p, '[aria-label="일시정지"]');
  await expect(p.page.locator('.pause.is-multi')).toBeVisible();
  await expect(p.page.locator('.pause-btns .btn-danger')).toHaveText('나가기');
  await tap(p, '.pause-btns .btn-danger');
  await expect(p.page.locator('.pause-btns .btn-danger')).toContainText('한 번 더');
  await tap(p, '.pause-btns .btn-danger');
}

test('3 players: lobby → room → start → directional drags seen by all → rewards wait → drop/reconnect/quit → host ends → result → host handoff', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const A = await openPlayer(browser, 'A');
  const B = await openPlayer(browser, 'B', { characters: ['guardian', 'blade', 'gunner'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
  const C = await openPlayer(browser, 'C', { characters: ['warden', 'gunner', 'bard'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] });
  const all = [A, B, C];
  const extra: Player[] = [];
  try {
    // ── 매칭 ──
    await toLobby(A, '에이');
    await expect(A.page.locator('.lb-status')).toContainText('서버 연결됨');
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    await expect(A.page.locator('.lb-roomcode')).toHaveText(code);

    // B joins by typing the code (lower case on purpose)
    await toLobby(B, '비');
    await B.page.locator('.lb-code-input').fill(code.toLowerCase());
    await expect(B.page.locator('.lb-code-input')).toHaveValue(code);
    await tap(B, '.lb-join');
    await waitPhase(B.page, 'room');

    // C joins from the live room list
    await toLobby(C, '씨');
    const row = C.page.locator(`.lb-room-row[data-code="${code}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('2/3');
    await shot(C, 'multi-lobby');
    await tap(C, `.lb-room-row[data-code="${code}"]`);
    await waitPhase(C.page, 'room');

    for (const p of all) await expect(p.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(3);
    await expect(A.page.locator('.lb-slot.is-me .lb-badge-host')).toBeVisible();
    await expect(B.page.locator('.lb-start')).toBeHidden();
    await expect(B.page.locator('.lb-wait')).toBeVisible();
    await shot(A, 'multi-room');

    // ── 시작 (방장) ──
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    const locals = await Promise.all(all.map(p => p.page.evaluate(() => [window.__proto!.mode, window.__proto!.localPlayer] as const)));
    expect(locals).toEqual([
      ['multi', 0],
      ['multi', 1],
      ['multi', 2],
    ]);
    const names = await state<string[]>(A.page, 's.players.map(p => p.name)');
    expect(names).toEqual(['에이', '비', '씨']);
    // the other two players top-left, by name, no BOT tags yet
    await expect(B.page.locator('.hud-tl .bot')).toHaveCount(2);
    await expect(B.page.locator('.hud-tl .bot-name')).toHaveText(['에이', '씨']);
    await expect(B.page.locator('.hud-tl .bot-tag:visible')).toHaveCount(0);
    // DBG only for the host
    await expect(A.page.locator('.btn-dbg')).toBeVisible();
    await expect(B.page.locator('.btn-dbg')).toBeHidden();

    // ── B: real touch drag of card 2 (블레이드 · 질풍 돌파 = 오른쪽 돌진). While held, only B sees the preview. ──
    await sleep(800);
    for (const p of all) await recordFx(p.page);
    expect(await state<number | null>(A.page, 's.players[1].activeIndex')).toBe(0);
    const releaseB = await touchDragHold(B, await center(B.page, '.ccard[data-idx="1"]'), await fieldFinger(B.page));
    await sleep(120);
    const pv = await B.page.evaluate(() => window.__proto!.ui.dragPreview);
    expect(pv?.valid).toBe(true);
    expect(pv?.parts?.some(part => part.dash?.dir === 'right' && part.area.shape === 'rect')).toBe(true);
    expect(await A.page.evaluate(() => window.__proto!.ui.dragPreview)).toBeNull();
    expect(await C.page.evaluate(() => window.__proto!.ui.dragPreview)).toBeNull();
    await shot(B, 'multi-drag-preview-b');
    await releaseB();
    // everyone gets the dash: from the drop point straight to the right; on A's screen B's blade lands at its end
    const dashA = await dashOf(A.page, 1, 1);
    await A.page.screenshot({ path: `${SHOT_DIR}/multi-dash-a.png` }); // streak + afterimages on another player's screen
    const dashC = await dashOf(C.page, 1, 1);
    expect(dashC).toEqual(dashA);
    expect(dashA.to.x - dashA.from.x).toBeGreaterThan(1);
    expect(Math.abs(dashA.to.y - dashA.from.y)).toBeLessThan(0.05);
    expect(Math.abs(dashA.from.x - pv!.pos.x)).toBeLessThan(0.05);
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[1].activeIndex === 1, undefined, { timeout: 5000 });
    await C.page.waitForFunction(() => window.__proto!.game!.state.players[1].activeIndex === 1, undefined, { timeout: 5000 });
    expect(await state<number>(A.page, 's.players[1].stats.swaps')).toBe(1);
    expect(await state<number | null>(A.page, 's.players[0].activeIndex')).toBe(0);
    await expect(B.page.locator('.ccard[data-idx="1"]')).toHaveClass(/is-active/);

    // ── C: real touch drag of card 2 (거너 · 산탄 사격 = 왼쪽 부채꼴) → A and B see the cast with its fixed direction ──
    await touchDrag(C, await center(C.page, '.ccard[data-idx="1"]'), await fieldFinger(C.page));
    for (const p of [A, B]) {
      const cast = await dragCastOf(p.page, 2);
      if (p === A) await A.page.screenshot({ path: `${SHOT_DIR}/multi-cone-a.png` }); // C's left cone on A's screen
      expect(cast.area).toMatchObject({ shape: 'cone', dir: 'left' });
    }
    expect(await B.page.evaluate(() => window.__proto!.ui.dragPreview)).toBeNull();
    await sleep(900);
    await shot(A, 'multi-combat-a');
    await shot(B, 'multi-combat-b');
    await shot(C, 'multi-combat-c');

    // ── reward (R33): the host clears the floor from the debug panel; all three choose ──
    await tap(A, '.btn-dbg');
    await expect(A.page.locator('.debug-panel')).toBeVisible();
    await A.page.locator('.debug-panel .dbg-btn', { hasText: '층 건너뛰기' }).click();
    for (const p of all) await waitPhase(p.page, 'reward');
    await A.page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).click();
    for (const p of all) {
      await expect(p.page.locator('.rw-card')).toHaveCount(3);
      await expect(p.page.locator('.rw-timer')).toContainText('초');
    }
    await tap(A, '.rw-card >> nth=0');
    await expect(A.page.locator('.rw-wait')).toBeVisible();
    await expect(A.page.locator('.rw-wait-text')).toHaveText('다른 플레이어 선택 대기 중 (1/3)');
    await expect(B.page.locator('.rw-card')).toHaveCount(3); // B still choosing
    await tap(B, '.rw-card >> nth=1');
    await expect(A.page.locator('.rw-wait-text')).toHaveText('다른 플레이어 선택 대기 중 (2/3)');
    expect(await state<string>(A.page, 's.phase')).toBe('reward');
    expect(await state<number>(A.page, 's.floor')).toBe(1);
    await shot(A, 'multi-reward-wait');
    await tap(C, '.rw-card >> nth=2');
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.floor === 2 && window.__proto!.phase === 'combat', undefined, { timeout: 8000 });
    const picked = await state<number[]>(A.page, 's.players.map(p => p.rewards.length + p.relics.length)');
    expect(picked).toEqual([1, 1, 1]);

    // ── R34: B's page closes → its slot is driven by a bot; A's HUD tags it ──
    await B.page.close();
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[1].isBot === true, undefined, { timeout: 10_000 });
    expect(await state<boolean>(A.page, 's.players[1].disconnected')).toBe(true);
    await expect(A.page.locator('.hud-tl .bot[data-player="1"] .bot-tag')).toBeVisible();
    await expect(A.page.locator('.hud-tl .bot[data-player="1"] .bot-name')).toHaveText('비');
    await shot(A, 'multi-bot-tag');

    // ── R34: B opens the link again on the same device → straight back into its seat, in control ──
    const B2 = await openPage(B.ctx, 'B2', 'combat');
    extra.push(B2);
    expect(await B2.page.evaluate(() => [window.__proto!.mode, window.__proto!.localPlayer])).toEqual(['multi', 1]);
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[1].isBot === false, undefined, { timeout: 10_000 });
    expect(await state<boolean | undefined>(A.page, 's.players[1].disconnected')).toBeFalsy();
    await expect(A.page.locator('.hud-tl .bot[data-player="1"] .bot-tag')).toBeHidden();
    const swapsBefore = await state<number>(A.page, 's.players[1].stats.swaps');
    const card = await B2.page.evaluate(() => [0, 1, 2].find(i => window.__proto!.game!.canSwap(1, i).ok) ?? -1);
    expect(card).toBeGreaterThanOrEqual(0);
    await touchDrag(B2, await center(B2.page, `.ccard[data-idx="${card}"]`), await fieldFinger(B2.page));
    await A.page.waitForFunction(n => window.__proto!.game!.state.players[1].stats.swaps > n, swapsBefore, { timeout: 5000 });
    await shot(B2, 'multi-reconnected-b');

    // ── C quits (menu → 나가기): back to the 매칭 list, its slot becomes a bot too ──
    await openMenuAndLeave(C);
    await waitPhase(C.page, 'lobby');
    expect(await C.page.evaluate(() => window.__proto!.mode)).toBe('solo');
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[2].isBot === true, undefined, { timeout: 10_000 });
    await expect(A.page.locator('.hud-tl .bot[data-player="2"] .bot-tag')).toBeVisible();
    expect(await state<string>(A.page, 's.phase')).toBe('combat'); // the run goes on

    // ── host ends the run → result (my row highlighted) → back to the room ──
    await openMenuAndLeave(A);
    await waitPhase(A.page, 'result', 15_000);
    await expect(A.page.locator('.rs-table tr.is-me')).toHaveCount(1);
    await expect(A.page.locator('.rs-table tr.is-me')).toContainText('에이');
    await expect(A.page.locator('.rs-table .rs-bot')).toHaveCount(1); // C (left); B came back and played on
    await expect(A.page.locator('.rs-foot .btn-primary')).toHaveText('방으로');
    // the tuning log comes with the runOver snapshots only: it must be filled in (floor 1 cleared, floor 2 quit)
    await expect(A.page.locator('.rs-floor .rs-floor-n')).toHaveText(['1층', '2층']);
    await shot(A, 'multi-result');
    await tap(A, '.rs-foot .btn-primary');
    await waitPhase(A.page, 'room');
    // B (reconnected) saw the result too and comes back to the room; C had left
    await waitPhase(B2.page, 'result', 15_000);
    await tap(B2, '.rs-foot .btn-primary');
    await waitPhase(B2.page, 'room');
    // after the server's linger the room is waiting again with A and B
    await expect(A.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(2, { timeout: 10_000 });
    await expect(A.page.locator('.lb-start')).not.toHaveClass(/is-disabled/, { timeout: 10_000 });
    await expect(B2.page.locator('.lb-start')).toBeHidden();

    // ── 방장 넘김: the host leaves the room → B becomes host and can start; A sees the room listed under B ──
    await tap(A, '.lb-leave');
    await waitPhase(A.page, 'lobby');
    await expect(B2.page.locator('.lb-slot.is-me .lb-badge-host')).toBeVisible({ timeout: 5000 });
    await expect(B2.page.locator('.lb-start')).toBeVisible();
    await expect(B2.page.locator('.lb-slot:not(.is-empty)')).toHaveCount(1);
    const listed = A.page.locator(`.lb-room-row[data-code="${code}"]`);
    await expect(listed).toContainText('1/3');
    await expect(listed).toContainText('방장 비');
    await expect(listed).toContainText('비의 방'); // the automatic room name follows the host
    await expect(B2.page.locator('.lb-roomname')).toHaveText('비의 방');
    await shot(B2, 'multi-host-handoff');
    await tap(B2, '.lb-start');
    await waitPhase(B2.page, 'combat', 20_000);
    expect(await B2.page.evaluate(() => window.__proto!.localPlayer)).toBe(0);
    await expect(B2.page.locator('.btn-dbg')).toBeVisible();

    const errors = [A, C, B2].flatMap(p => p.errors).concat(B.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of [...all, ...extra]) await p.ctx.close().catch(() => {});
  }
});

/** Everything that must match on every screen after the room (desync check). */
const syncView = (page: Page) =>
  state<string>(
    page,
    `JSON.stringify({ floor: s.floor, phase: s.phase, goedam: s.goedam, logs: s.players.map(p => p.goedamLog.map(e => ({ ...e, outcome: { ...e.outcome } }))), traces: s.players.map(p => p.goedamTraces), rewards: s.players.map(p => p.rewards.length) })`,
  );

test('3 players: 괴담 room (기획 10차) — two choose, one idles → room deadline → 그냥 지나간다 → next floor, same state on every screen', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser, 'A');
  const B = await openPlayer(browser, 'B', { characters: ['guardian', 'blade', 'gunner'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
  const C = await openPlayer(browser, 'C', { characters: ['warden', 'gunner', 'bard'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] });
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
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);

    // host: force 고장 난 자판기 after this floor, clear it, everyone takes a reward
    const dbg = (action: object) => A.page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a as never }), action);
    expect((await dbg({ kind: 'goedamNext', room: 'broken_vending' })).ok).toBe(true);
    expect((await dbg({ kind: 'skipFloor' })).ok).toBe(true);
    for (const p of all) await waitPhase(p.page, 'reward');
    for (const p of all) await tap(p, '.rw-card >> nth=0');

    // ── the same room opens on all three screens, with a fresh 25 s deadline ──
    for (const p of all) await waitPhase(p.page, 'goedam', 10_000);
    const opened = Date.now();
    for (const p of all) {
      await expect(p.page.locator('.gd-name')).toHaveText('고장 난 자판기');
      await expect(p.page.locator('.gd-floor')).toHaveText(/1½층.*로비·상가층/);
      await expect(p.page.locator('.gd-timer')).toHaveText(/^\d+초 · 안 고르면 '그냥 지나간다'$/);
      await expect(p.page.locator('.gd-pchip')).toHaveCount(2);
    }
    const left = Number((await A.page.locator('.gd-timer').textContent())!.match(/^(\d+)/)![1]);
    expect(left).toBeGreaterThan(20);
    expect(left).toBeLessThanOrEqual(25);
    const deadlines = await Promise.all(all.map(p => p.page.evaluate(() => (window.__proto!.game as unknown as { goedamDeadline: number | null }).goedamDeadline)));
    for (const d of deadlines) expect(Math.abs(d! - deadlines[0]!)).toBeLessThan(1500);

    // A gambles on the button: result card; the others' rows say who is still choosing
    for (const p of all) await expect(p.page.locator('.gd-options')).not.toHaveClass(/is-arming/); // taps count from ARM_MS
    await tap(A, '.gd-opt[data-option="press"]');
    await expect(A.page.locator('.gd-card')).toBeVisible();
    const titleA = (await A.page.locator('.gd-card-title').textContent())!;
    expect(['덜컹! 캔이 떨어졌다', '자판기 미믹이었다']).toContain(titleA);
    await expect(A.page.locator('.gd-other-t')).toHaveText(['비 — 고르는 중…', '씨 — 고르는 중…']);
    // C (has not chosen) sees only ✓ on A's chip, never what A got
    await expect(C.page.locator('.gd-pchip.is-done')).toHaveCount(1);
    await expect(C.page.locator('.gd-others')).toBeHidden();
    expect(await C.page.locator('.goedam').innerText()).not.toContain(titleA);

    // B puts a hand in the change slot; A sees B's pick and result
    await tap(B, '.gd-opt[data-option="coin_slot"]');
    await expect(B.page.locator('.gd-card')).toBeVisible();
    const titleB = (await B.page.locator('.gd-card-title').textContent())!;
    await expect(A.page.locator('.gd-other-t')).toHaveText([`비 — 거스름돈 구멍에 손을 넣는다 → ${titleB}`, '씨 — 고르는 중…']);

    // 계속 → the wait panel counts who is done (n/3)
    await tap(A, '.gd-continue');
    await expect(A.page.locator('.gd-wait-text')).toHaveText('다른 플레이어 기다리는 중 (1/3)');
    await expect(A.page.locator('.gd-timer')).toHaveText(/^\d+초 안에 다음 층$/);
    await tap(B, '.gd-continue');
    for (const p of [A, B]) await expect(p.page.locator('.gd-wait-text')).toHaveText('다른 플레이어 기다리는 중 (2/3)');
    await expect(B.page.locator('.gd-other-t')).toHaveText([`에이 — 이름 없는 버튼을 누른다 → ${titleA}`, '씨 — 고르는 중…']);
    expect(await state<string>(A.page, 's.phase')).toBe('goedam');
    await shot(A, 'goedam-multi');
    await shot(C, 'goedam-multi-idle');

    // ── C never taps: at the deadline the server picks 'leave' for C and everyone goes on to floor 2 ──
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.floor === 2 && window.__proto!.phase === 'combat', undefined, { timeout: 40_000 });
    const waited = Date.now() - opened;
    expect(waited).toBeGreaterThan(15_000); // not before the deadline
    for (const p of all) await expect(p.page.locator('.goedam')).toBeHidden();
    const logs = await state<{ optionId: string; auto: boolean; roomId: string; label: string }[][]>(A.page, 's.players.map(p => p.goedamLog)');
    expect(logs.map(l => l.map(e => [e.roomId, e.label, e.optionId, e.auto]))).toEqual([
      [['broken_vending', '1½층', 'press', false]],
      [['broken_vending', '1½층', 'coin_slot', false]],
      [['broken_vending', '1½층', 'leave', false]], // a human's timeout is not a bot pick
    ]);
    // no desync: the same floor, phase, room logs, traces and rewards on all three screens
    const views = await Promise.all(all.map(p => syncView(p.page)));
    expect(views[1]).toBe(views[0]);
    expect(views[2]).toBe(views[0]);

    // the idle player's 괴담 수첩 on the result screen says it passed by
    await openMenuAndLeave(A);
    for (const p of all) await waitPhase(p.page, 'result', 15_000);
    await expect(C.page.locator('.rs-goedam-row')).toHaveText(['1½층 고장 난 자판기 — 그냥 지나갔다']);
    await expect(A.page.locator('.rs-goedam-row')).toHaveText([/^1½층 고장 난 자판기 — 버튼을 눌렀다/]);

    const errors = all.flatMap(p => p.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});

type FeEv = Extract<GameEvent, { type: 'fieldEventWarn' | 'fieldEventStart' | 'fieldEventEnd' }>;

/** Record the 돌발 괴담 warn/start/end events this client receives (wraps the live game's drainEvents). */
async function recordFieldEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __fe: GameEvent[] };
    w.__fe = [];
    const g = window.__proto!.game!;
    const orig = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const evs = orig();
      for (const e of evs) if (e.type === 'fieldEventWarn' || e.type === 'fieldEventStart' || e.type === 'fieldEventEnd') w.__fe.push(e);
      return evs;
    };
  });
}

/** The same event as every screen sees it: id, spawn point, units, goal (positions of moving units are compared apart). */
const eventView = (page: Page) =>
  state<string>(page, `JSON.stringify(s.fieldEvent && { id: s.fieldEvent.id, pos: s.fieldEvent.pos, ids: s.fieldEvent.entityIds, total: s.fieldEvent.total, goal: s.fieldEvent.goal })`);

/** Finger (client px) of a drop 1 unit left of the toad, when that spot is on this phone's field; else null. */
const toadFinger = (page: Page) =>
  page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const toad = s.fieldEvent && s.entities.find(e => e.id === s.fieldEvent!.entityIds[0]);
    if (!toad) return null;
    const f = api.ui.fingerFor({ x: toad.pos.x - 1, y: toad.pos.y });
    const canvas = document.querySelector('canvas.stage-canvas');
    return document.elementFromPoint(f.x, f.y) === canvas && f.x > 40 && f.x < window.innerWidth - 40 ? f : null;
  });

test('3 players (기획 12차): B picks 메딕 on the preset screen; a forced 돌발 괴담 is the same on all three screens, a real drop catches it, every player gets the party reward', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser, 'A');
  const B = await openPlayer(browser, 'B');
  const C = await openPlayer(browser, 'C', { characters: ['exorcist', 'puppeteer', 'guardian'], pets: ['golem_turret', 'fairy_heal', 'drum_raccoon'] });
  const all = [A, B, C];
  try {
    // ── B: swap the third character for the new healer 메딕 (real taps on the 5×3 preset grid) ──
    await expect(B.page.locator('.ps-char')).toHaveCount(15);
    await expect(B.page.locator('.ps-role-head')).toHaveText(['탱커', '근접딜러', '원거리딜러', '힐러', '서포터']);
    await tap(B, '.ps-slot-row >> nth=0 >> .slot-chip >> nth=2'); // the chip removes that pick
    await expect(B.page.locator('.ps-char.is-picked')).toHaveCount(2);
    await tap(B, '.ps-char[aria-label^="메딕 · 힐러"]');
    await expect(B.page.locator('.ps-char[aria-label^="메딕 · 힐러"]')).toHaveClass(/is-picked/);
    await expect(B.page.locator('.ps-slot-row >> nth=0 >> .slot-name >> nth=2')).toHaveText('메딕');
    const pickedB = await B.page.evaluate(() => JSON.parse(localStorage.getItem('swapTower.preset.v1') ?? 'null')?.characters ?? null);

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
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    // the server built the parties from each phone's preset: B carries 메딕, C the 퇴마사 + 퍼펫티어
    const parties = await state<string[][]>(A.page, 's.players.map(p => p.party.map(m => m.defId))');
    expect(parties[1][2]).toBe('medic');
    if (pickedB) expect(parties[1]).toEqual(pickedB);
    expect(parties[2]).toEqual(['exorcist', 'puppeteer', 'guardian']);

    // host: only the forced event runs; a soft toad and no deaths so the catch never depends on real-time luck
    const dbg = (action: object) => A.page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a as never }), action);
    const tune = (patch: object) => A.page.evaluate(pa => window.__proto!.game!.dispatch({ type: 'tunables', patch: pa as never }), patch);
    // 기획 15차: gauges nearly frozen (field 600 s, bench 0) so each +40% stands out whichever card is on the field at the catch
    expect((await tune({ fieldEventChance: 0, invincible: true, monsterHpMult: 0.3, ultFieldChargeTime: 600, ultBenchRatio: 0 })).ok).toBe(true);
    await B.page.waitForFunction(() => window.__proto!.game!.tunables.monsterHpMult === 0.3, undefined, { timeout: 5000 });
    await sleep(800);
    for (const p of all) await recordFieldEvents(p.page);
    // 기획 15차: every card's own gauge (the +40% goes to each player's field character at the catch)
    const ult0 = await state<number[][]>(A.page, 's.players.map(p => p.party.map(m => m.ult.charge))');
    expect((await dbg({ kind: 'fieldEventNext', id: 'lucky_toad' })).ok).toBe(true);

    // ── the same event, at the same place, on all three screens ──
    for (const p of all) await expect(p.page.locator('.fe-pill .fe-prog')).toHaveText('도망치는 금두꺼비');
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.fieldEvent?.stage === 'active', undefined, { timeout: 5000 });
    for (const p of all) await expect(p.page.locator('.banner-event .banner-big')).toContainText('도망치는 금두꺼비');
    const views = await Promise.all(all.map(p => eventView(p.page)));
    expect(views[0]).not.toBe('null');
    expect(views[1]).toBe(views[0]);
    expect(views[2]).toBe(views[0]);
    const starts = await Promise.all(all.map(p => p.page.evaluate(() => (window as unknown as { __fe: FeEv[] }).__fe.filter(e => e.type === 'fieldEventStart'))));
    for (const s of starts) expect(s).toEqual([starts[0][0]]);
    // the toad itself: one unit, tagged as a target, within a hop of the same spot on every screen (snapshots differ by ticks)
    const toads = await Promise.all(
      all.map(p => state<{ pos: { x: number; y: number }; eventTag: string }>(p.page, `(() => { const e = s.entities.find(x => x.id === s.fieldEvent.entityIds[0]); return { pos: e.pos, eventTag: e.eventTag }; })()`)),
    );
    for (const t of toads) {
      expect(t.eventTag).toBe('target');
      expect(Math.hypot(t.pos.x - toads[0].pos.x, t.pos.y - toads[0].pos.y)).toBeLessThan(3.5);
    }
    await shot(B, 'combat-event-multi');

    // ── a real touch drop next to the toad by whoever has it on screen (repeat with the next ready card if it got away) ──
    const deadline = Date.now() + 22_000;
    while (Date.now() < deadline && (await state<boolean>(A.page, 's.fieldEvent !== null'))) {
      for (const p of all) {
        const finger = await toadFinger(p.page);
        const idx = await p.page.evaluate(() => {
          const api = window.__proto!;
          const me = api.game!.state.players[api.localPlayer];
          return [0, 1, 2].find(i => i !== me.activeIndex && api.game!.canSwap(api.localPlayer, i).ok) ?? null;
        });
        if (!finger || idx == null) continue;
        await touchDrag(p, await center(p.page, `.ccard[data-idx="${idx}"]`), finger);
        break;
      }
      await sleep(1500);
    }

    // ── success reached every phone, and every (not-out) player got ult +40% ──
    for (const p of all) {
      const end = await p.page.waitForFunction(() => (window as unknown as { __fe: FeEv[] }).__fe.find(e => e.type === 'fieldEventEnd') || null, undefined, { timeout: 10_000 });
      expect(((await end.jsonValue()) as Extract<FeEv, { type: 'fieldEventEnd' }>).success).toBe(true);
    }
    for (const p of all) await p.page.waitForFunction(() => window.__proto!.game!.state.fieldEvent === null, undefined, { timeout: 5000 });
    const after = await Promise.all(
      all.map(p => state<{ ult: number[][]; credits: number }>(p.page, `({ ult: s.players.map(p => p.party.map(m => m.ult.charge)), credits: s.players.reduce((n, p) => n + p.stats.fieldEvents, 0) })`)),
    );
    for (const a of after) {
      // humans never fire the ult by themselves: exactly one card of each player (the field one at the catch) holds the +40%
      a.ult.forEach((cards, i) => expect(cards.filter((u, k) => u - ult0[i][k] >= 0.4 - 0.05).length).toBe(1));
      expect(a.credits).toBe(1);
    }
    await shot(A, 'combat-event-multi-success');

    const errors = all.flatMap(p => p.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});

type GroggyEv = Extract<GameEvent, { type: 'bossGroggy' | 'bossGroggyEnd' | 'groggyGain' | 'ultCast' }>;

/** Record the groggy and ult cut-in events this client receives (wraps the live game's drainEvents). */
async function recordGroggy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gg: GameEvent[] };
    w.__gg = [];
    const g = window.__proto!.game!;
    const orig = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const evs = orig();
      for (const e of evs) if (e.type === 'bossGroggy' || e.type === 'bossGroggyEnd' || e.type === 'groggyGain' || e.type === 'ultCast') w.__gg.push(e);
      return evs;
    };
  });
}

const groggyEvents = (page: Page) => page.evaluate(() => (window as unknown as { __gg: GroggyEv[] }).__gg);

/** Finger (client px) of a drop just below the boss, when that spot is on this phone's field; else null. */
const bossFinger = (page: Page) =>
  page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const boss = s.entities.find(e => e.id === s.bossId);
    if (!boss) return null;
    const canvas = document.querySelector('canvas.stage-canvas');
    for (const dy of [boss.radius + 0.4, boss.radius + 0.9, boss.radius + 1.4]) {
      const f = api.ui.fingerFor({ x: boss.pos.x, y: boss.pos.y + dy });
      if (document.elementFromPoint(f.x, f.y) === canvas && f.x > 40 && f.x < window.innerWidth - 40) return f;
    }
    return null;
  });

test('3 players (기획 13차): the boss groggy gauge fills and breaks the same on all three screens; my ult is the full cut-in, the others see the corner banner', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const A = await openPlayer(browser, 'A', { characters: ['blade', 'guardian', 'berserker'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
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
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);

    // host: straight to the 5층 boss, nobody dies, no 괴담 room / 돌발 괴담 in the way
    const dbg = (action: object) => A.page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a as never }), action);
    const tune = (patch: object) => A.page.evaluate(pa => window.__proto!.game!.dispatch({ type: 'tunables', patch: pa as never }), patch);
    expect((await tune({ invincible: true, fieldEventChance: 0, goedamRoomsPerZone: 0 })).ok).toBe(true);
    expect((await dbg({ kind: 'jumpFloor', floor: 5 })).ok).toBe(true);
    for (const p of all) {
      await p.page.waitForFunction(() => {
        const s = window.__proto!.game!.state;
        return s.floor === 5 && s.phase === 'combat' && s.bossId != null && s.bossGroggy != null && s.floorTime > 1.5;
      }, undefined, { timeout: 15_000 });
      await expect(p.page.locator('.boss-groggy')).toBeVisible();
      await recordGroggy(p.page);
    }
    // three humans: the gauge is 100 × 0.8 (5층) × 1.8 on every screen
    const totals = await Promise.all(all.map(p => state<number>(p.page, 's.bossGroggy.total')));
    expect(totals).toEqual([totals[0], totals[0], totals[0]]);

    // ── a real touch drop of A's 가디언 next to the boss: the same points reach every screen ──
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (await state<number>(A.page, 's.bossGroggy.fill')) === 0) {
      const finger = await bossFinger(A.page);
      const idx = await A.page.evaluate(() => {
        const g = window.__proto!.game!;
        return [1, 2].find(i => g.canSwap(0, i).ok && g.state.players[0].activeIndex !== i) ?? null;
      });
      if (finger && idx != null) await touchDrag(A, await center(A.page, `.ccard[data-idx="${idx}"]`), finger);
      await sleep(1200);
    }
    const fillA = await state<number>(A.page, 's.bossGroggy.fill');
    expect(fillA).toBeGreaterThan(0);
    for (const p of [B, C]) await p.page.waitForFunction(f => window.__proto!.game!.state.bossGroggy!.fill === f, fillA, { timeout: 3000 });
    const gains = await Promise.all(all.map(p => groggyEvents(p.page).then(evs => evs.filter(e => e.type === 'groggyGain'))));
    expect(gains[0].length).toBeGreaterThan(0);
    expect(gains[0][0]).toMatchObject({ player: 0, why: 'drag' });
    expect(gains[1]).toEqual(gains[0]);
    expect(gains[2]).toEqual(gains[0]);

    // ── almost full → the ⚡ row on every screen; full → the same break, the same countdown ──
    expect((await dbg({ kind: 'forceGroggy', fill: 0.85 })).ok).toBe(true);
    for (const p of all) await expect(p.page.locator('.boss-groggy')).toHaveClass(/is-near/);
    expect((await dbg({ kind: 'forceGroggy' })).ok).toBe(true);
    for (const p of all) {
      await expect(p.page.locator('.boss-gpill')).toHaveText(/^그로기! [345]\.\d초 · 드래그 ×2$/);
      await expect(p.page.locator('.boss-groggy')).toHaveClass(/is-down/);
    }
    const breaks = await Promise.all(all.map(p => groggyEvents(p.page).then(evs => evs.filter(e => e.type === 'bossGroggy'))));
    expect(breaks[0]).toHaveLength(1);
    expect(breaks[0][0]).toMatchObject({ count: 1, duration: 5 });
    expect(breaks[1]).toEqual(breaks[0]);
    expect(breaks[2]).toEqual(breaks[0]);
    const downs = await Promise.all(all.map(p => state<{ left: number; count: number; total: number }>(p.page, '({ left: s.bossGroggy.left, count: s.bossGroggy.count, total: s.bossGroggy.total })')));
    for (const d of downs) {
      expect(d.count).toBe(1);
      expect(d.total).toBe(downs[0].total);
      expect(Math.abs(d.left - downs[0].left)).toBeLessThan(0.6); // the three reads are a few snapshots apart
    }
    await shot(B, 'multi-groggy-b');

    // ── A's ult while the boss is down: the full cut-in on A's screen, the corner banner on B's and C's ──
    expect((await dbg({ kind: 'chargeUlt' })).ok).toBe(true);
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[0].party.every(m => m.ult.charge >= 1), undefined, { timeout: 5000 });
    await tap(A, '.ult');
    const ultName = await A.page.waitForFunction(() => window.__proto!.ui.cutIns.find(c => c.kind === 'full')?.name ?? null, undefined, { timeout: 5000 });
    const name = (await ultName.jsonValue()) as string;
    expect(name.length).toBeGreaterThan(0);
    expect(await A.page.evaluate(() => window.__proto!.ui.cutIns.filter(c => c.kind === 'mini').length)).toBe(0);
    for (const p of [B, C]) {
      await p.page.waitForFunction(n => window.__proto!.ui.cutIns.some(c => c.kind === 'mini' && c.name === n), name, { timeout: 5000 });
      const kinds = await p.page.evaluate(() => window.__proto!.ui.cutIns.map(c => `${c.kind}:${c.who}`));
      expect(kinds).toEqual(['mini:에이']);
    }
    const ults = await Promise.all(all.map(p => groggyEvents(p.page).then(evs => evs.filter(e => e.type === 'ultCast'))));
    expect(ults[0]).toHaveLength(1);
    expect(ults[0][0]).toMatchObject({ player: 0, name });
    expect(ults[1]).toEqual(ults[0]);
    expect(ults[2]).toEqual(ults[0]);

    // ── stands up: the same end on every screen, then the lock ──
    for (const p of all) {
      await p.page.waitForFunction(() => (window as unknown as { __gg: GameEvent[] }).__gg.some(e => e.type === 'bossGroggyEnd'), undefined, { timeout: 10_000 });
      await expect(p.page.locator('.boss-groggy')).toHaveClass(/is-lock/);
      await expect(p.page.locator('.boss-gpill')).toBeHidden();
    }
    const ends = await Promise.all(all.map(p => groggyEvents(p.page).then(evs => evs.filter(e => e.type === 'bossGroggyEnd'))));
    expect(ends[1]).toEqual(ends[0]);
    expect(ends[2]).toEqual(ends[0]);
    const after = await Promise.all(all.map(p => state<string>(p.page, 'JSON.stringify({ floor: s.floor, phase: s.phase, count: s.bossGroggy.count, total: s.bossGroggy.total, stats: s.players.map(q => [q.stats.groggyBreaks, q.stats.ultsUsed]) })')));
    expect(after[1]).toBe(after[0]);
    expect(after[2]).toBe(after[0]);

    const errors = all.flatMap(p => p.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});

/**
 * 기획 15차: record, per sim tick, every player's field card and each card's own ult gauge and re-appear cooldown. Two
 * screens that saw the same tick must hold the same values.
 */
async function recordGauges(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gauges: Record<number, string> };
    w.__gauges = {};
    const loop = () => {
      const s = window.__proto?.game?.state;
      if (s && s.phase === 'combat') w.__gauges[s.tick] = JSON.stringify(s.players.map(p => [p.activeIndex, p.party.map(m => [m.ult, m.swapCooldownRemaining])]));
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

/** Ticks seen by all pages, and how many of those disagree (should be 0). */
async function compareGauges(pages: Page[]): Promise<{ common: number; diff: string[] }> {
  const recs = await Promise.all(pages.map(p => p.evaluate(() => (window as unknown as { __gauges: Record<number, string> }).__gauges)));
  const diff: string[] = [];
  let common = 0;
  for (const tick of Object.keys(recs[0])) {
    if (!recs.every(r => tick in r)) continue;
    common++;
    if (!recs.every(r => r[Number(tick)] === recs[0][Number(tick)])) diff.push(`tick ${tick}: ${recs.map(r => r[Number(tick)]).join(' | ')}`);
  }
  return { common, diff };
}

test('3 players (기획 15차): per-character ult gauges on every screen; the host moves the 「궁극기 게이지」 slider, a non-host cannot; C\'s ult empties only its field card', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const A = await openPlayer(browser, 'A');
  const B = await openPlayer(browser, 'B', { characters: ['guardian', 'blade', 'gunner'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
  const C = await openPlayer(browser, 'C', { characters: ['warden', 'gunner', 'bard'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] });
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
    await tap(A, '.lb-start');
    for (const p of all) await waitPhase(p.page, 'combat', 20_000);
    // nobody dies, no 괴담 room / 돌발 괴담 in the way; the 5층 boss (×10 HP) keeps the floor in combat for the whole test
    const tune = (p: Player, patch: object) => p.page.evaluate(pa => window.__proto!.game!.dispatch({ type: 'tunables', patch: pa as never }), patch);
    expect((await tune(A, { invincible: true, fieldEventChance: 0, goedamRoomsPerZone: 0, monsterHpMult: 10 })).ok).toBe(true);
    expect((await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 5 } }))).ok).toBe(true);
    for (const p of all)
      await p.page.waitForFunction(() => {
        const s = window.__proto!.game!.state;
        return s.floor === 5 && s.phase === 'combat' && s.bossId != null && s.floorTime > 1;
      }, undefined, { timeout: 15_000 });
    // the rule from the start on every screen: a ring on each of my 3 cards, no 14차 energy bar / cost chips
    for (const p of all) {
      await expect(p.page.locator('.ccard')).toHaveCount(3);
      await expect(p.page.locator('.cc-ult:visible')).toHaveCount(3);
      await expect(p.page.locator('.hud-energy, .cc-cost')).toHaveCount(0);
      expect(await state<boolean>(p.page, 's.players.every(q => !("ult" in q) && !("energy" in q) && q.party.every(m => m.ult != null))')).toBe(true);
    }
    for (const p of all) await recordGauges(p.page);

    // ── the host's debug panel (real taps) → 「궁극기 게이지」 → 필드 충전 시간 6초 ──
    await expect(B.page.locator('.btn-dbg')).toBeHidden();
    await tap(A, '.btn-dbg');
    await expect(A.page.locator('.debug-panel')).toBeVisible();
    await expect(A.page.locator('.debug-panel .dbg-mode')).toHaveCount(0);
    await A.page.locator('.debug-panel .dbg-slider[data-key="ultFieldChargeTime"] input').fill('6');
    await A.page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).click();
    for (const p of all) {
      await p.page.waitForFunction(() => window.__proto!.game!.tunables.ultFieldChargeTime === 6, undefined, { timeout: 10_000 });
      // the field card's ring fills in ~6 s, the bench ones at a third of that
      await expect(p.page.locator('.ccard.is-active .cc-ult')).toHaveClass(/is-full/, { timeout: 12_000 });
      await expect(p.page.locator('.ccard:not(.is-active) .cc-ult.is-full')).toHaveCount(0);
    }

    // ── a non-host cannot tune: the client refuses, a mutated panel object snaps back, a raw command is refused ──
    expect(await tune(B, { ultBenchRatio: 1 })).toEqual({ ok: false, reason: '방장만 할 수 있어요' });
    await B.page.evaluate(() => (window.__proto!.game!.tunables.ultBenchRatio = 1));
    await B.page.waitForFunction(() => window.__proto!.game!.tunables.ultBenchRatio < 0.5, undefined, { timeout: 5000 });
    await B.page.evaluate(() => {
      const conn = (window.__proto!.game as unknown as { conn: { send(m: unknown): boolean } }).conn;
      conn.send({ t: 'cmd', seq: 9_000_001, cmd: { type: 'tunables', patch: { ultBenchRatio: 1, ultFieldChargeTime: 90 } } });
    });
    await sleep(800);
    for (const p of all) expect(await p.page.evaluate(() => [window.__proto!.game!.tunables.ultFieldChargeTime, window.__proto!.game!.tunables.ultBenchRatio < 0.5])).toEqual([6, true]);

    // ── C taps the ult: C's field character casts, only that gauge empties — on every screen ──
    const fieldC = await state<number>(C.page, 's.players[2].activeIndex');
    const beforeC = await state<number[]>(C.page, 's.players[2].party.map(m => m.ult.charge)');
    expect(beforeC[fieldC]).toBe(1);
    await tap(C, '.ult');
    for (const p of all) {
      await p.page.waitForFunction(() => window.__proto!.game!.state.players[2].stats.ultsUsed === 1, undefined, { timeout: 5000 });
      const after = await state<number[]>(p.page, 's.players[2].party.map(m => m.ult.charge)');
      expect(after[fieldC]).toBeLessThan(0.2);
      for (let i = 0; i < 3; i++) if (i !== fieldC) expect(after[i]).toBeGreaterThanOrEqual(beforeC[i]);
      // A's and B's own field gauges are untouched (still full, nobody else cast)
      expect(await state<number[]>(p.page, '[0, 1].map(pi => s.players[pi].party[s.players[pi].activeIndex].ult.charge)')).toEqual([1, 1]);
      expect(await state<number[]>(p.page, 's.players.map(q => q.stats.ultsUsed)')).toEqual([0, 0, 1]);
    }
    await expect(C.page.locator('.ccard.is-active .cc-ult')).not.toHaveClass(/is-full/);

    // ── B: a real touch drag of card 2 → the card that left starts its re-appear cooldown (the only swap rule) ──
    expect(await state<number | null>(B.page, 's.players[1].activeIndex')).toBe(0);
    await touchDrag(B, await center(B.page, '.ccard[data-idx="1"]'), await fieldFinger(B.page));
    for (const p of all) {
      await p.page.waitForFunction(() => window.__proto!.game!.state.players[1].activeIndex === 1, undefined, { timeout: 5000 });
      expect(await state<number>(p.page, 's.players[1].party[0].swapCooldownRemaining')).toBeGreaterThan(0);
    }

    // ── no desync: every sim tick that two or three screens saw holds the same gauges / cooldowns ──
    const cmp = await compareGauges(all.map(p => p.page));
    expect(cmp.common).toBeGreaterThan(100);
    expect(cmp.diff, cmp.diff.slice(0, 3).join('\n')).toEqual([]);

    const errors = all.flatMap(p => p.errors);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of all) await p.ctx.close().catch(() => {});
  }
});

test('1-human room: the host plays with 2 bots', async ({ browser }) => {
  const A = await openPlayer(browser, 'A');
  try {
    await toLobby(A, '혼자방');
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    await expect(A.page.locator('.lb-slot.is-empty')).toHaveCount(2);
    await expect(A.page.locator('.lb-slot.is-empty').first()).toContainText('빈자리 → 봇');
    await tap(A, '.lb-start');
    await waitPhase(A.page, 'combat', 20_000);
    const ps = await state<{ name: string; isBot: boolean }[]>(A.page, 's.players.map(p => ({ name: p.name, isBot: p.isBot }))');
    expect(ps).toEqual([
      { name: '혼자방', isBot: false },
      { name: 'BOT 1', isBot: true },
      { name: 'BOT 2', isBot: true },
    ]);
    expect(await A.page.evaluate(() => window.__proto!.localPlayer)).toBe(0);
    await expect(A.page.locator('.hud-tl .bot-name')).toHaveText(['BOT 1', 'BOT 2']);
    // stock bots carry no extra BOT tag (their name already says so)
    await expect(A.page.locator('.hud-tl .bot-tag:visible')).toHaveCount(0);
    // the game keeps running under the menu (no pause in multiplayer)
    await tap(A, '[aria-label="일시정지"]');
    const t0 = await state<number>(A.page, 's.time');
    await sleep(1200);
    expect(await state<number>(A.page, 's.time')).toBeGreaterThan(t0 + 0.5);
    expect(await A.page.evaluate(() => window.__proto!.paused)).toBe(false);
    await tap(A, '.pause-btns .btn-primary');
    await expect(A.page.locator('.pause')).toBeHidden();
    // ult through the same Game interface: debug charge (host) + tap the gauge
    expect(await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }).ok)).toBe(true);
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[0].party.every(m => m.ult.charge >= 1), undefined, { timeout: 5000 });
    await tap(A, '.ult');
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 1, undefined, { timeout: 5000 });
    expect(await phase(A.page)).toBe('combat');
    // R34 from the browser side: a reload mid-game comes straight back into the same seat (token in this tab)
    const floorTime = await state<number>(A.page, 's.time');
    await A.page.reload();
    await waitPhase(A.page, 'combat', 15_000);
    expect(await A.page.evaluate(() => [window.__proto!.mode, window.__proto!.localPlayer])).toEqual(['multi', 0]);
    expect(await state<number>(A.page, 's.time')).toBeGreaterThan(floorTime);
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[0].isBot === false, undefined, { timeout: 5000 });
    expect(await state<number>(A.page, 's.players[0].stats.ultsUsed')).toBe(1);
    expect(A.errors, A.errors.join('\n')).toEqual([]);
  } finally {
    await A.ctx.close().catch(() => {});
  }
});

test('silent network stall (tunnel): banner + refused input on that phone, its slot → bot within ~10 s, back in control after, nothing stale replayed', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const A = await openPlayer(browser, 'A');
  const B = await openPlayer(browser, 'B', { characters: ['guardian', 'paladin', 'warden'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
  try {
    await toLobby(A, '에이');
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    await toLobby(B, '비');
    await B.page.locator('.lb-code-input').fill(code);
    await tap(B, '.lb-join');
    await waitPhase(B.page, 'room');
    await tap(A, '.lb-start');
    for (const p of [A, B]) await waitPhase(p.page, 'combat', 20_000);
    await sleep(800);
    await A.page.evaluate(() => {
      const w = window as unknown as { __appear: { player: number; pos: Vec2 }[] };
      w.__appear = [];
      const g = window.__proto!.game!;
      const orig = g.drainEvents.bind(g);
      g.drainEvents = () => {
        const evs = orig();
        for (const e of evs) if (e.type === 'appear') w.__appear.push({ player: e.player, pos: e.pos });
        return evs;
      };
    });

    // B's link goes silent: the socket stays "open", nothing gets through either way
    await B.cdp.send('Network.enable');
    await B.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const t0 = Date.now();
    // a drag right away, before anything can tell: it goes into the dead socket
    const card = await B.page.evaluate(() => [1, 2].find(i => window.__proto!.game!.canSwap(1, i).ok) ?? -1);
    expect(card).toBeGreaterThan(0);
    const releaseStale = await touchDragHold(B, await center(B.page, `.ccard[data-idx="${card}"]`), await fieldFinger(B.page));
    const stalePos = (await B.page.evaluate(() => window.__proto!.ui.dragPreview))!.pos;
    await releaseStale();
    // within ~2 s B's screen says so, and new input is refused instead of being swallowed
    await expect(B.page.locator('.net-banner')).toBeVisible({ timeout: 4000 });
    await expect(B.page.locator('.net-banner')).toContainText('연결이 불안정해요');
    expect(Date.now() - t0).toBeLessThan(4000);
    const other = card === 1 ? 2 : 1;
    expect((await B.page.evaluate(i => window.__proto!.ui.dragTo('swap', i, { x: 10, y: 6 }), other)).reason).toBe('연결이 불안정해요');
    await shot(B, 'multi-stall-b');
    // the server notices the silent socket (5 s heartbeat): B's slot is driven by a bot for the others
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[1].isBot === true, undefined, { timeout: 14_000 });
    const botAfter = Date.now() - t0;
    expect(botAfter).toBeLessThan(13_000);
    await sleep(Math.max(0, 12_000 - (Date.now() - t0)));

    // signal is back: B reconnects by itself (same token) and is in control again
    await B.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const t1 = Date.now();
    await A.page.waitForFunction(() => window.__proto!.game!.state.players[1].isBot === false, undefined, { timeout: 25_000 });
    await B.page.waitForFunction(() => window.__proto!.phase === 'combat' && window.__proto!.net.status === 'online', undefined, { timeout: 10_000 });
    await expect(B.page.locator('.net-banner')).toBeHidden({ timeout: 5000 });
    const backAfter = Date.now() - t1;
    // the drag made into the dead socket never lands seconds later at its old spot
    await sleep(1500);
    const appears = await A.page.evaluate(() => (window as unknown as { __appear: { player: number; pos: Vec2 }[] }).__appear);
    const stale = appears.filter(a => a.player === 1 && Math.hypot(a.pos.x - stalePos.x, a.pos.y - stalePos.y) < 0.05);
    expect(stale).toEqual([]);
    // and B can play again
    const ready = await B.page.evaluate(() => [0, 1, 2].find(i => window.__proto!.game!.canSwap(1, i).ok) ?? -1);
    if (ready >= 0) {
      const swaps = await state<number>(A.page, 's.players[1].stats.swaps');
      await touchDrag(B, await center(B.page, `.ccard[data-idx="${ready}"]`), await fieldFinger(B.page));
      await A.page.waitForFunction(n => window.__proto!.game!.state.players[1].stats.swaps > n, swaps, { timeout: 5000 });
    }
    console.log(`stall: banner < 4 s, bot after ${botAfter} ms, back in control ${backAfter} ms after the signal returned`);
    // no console errors either: while the device is offline the client waits for 'online' instead of failing sockets
    const errors = [...A.errors, ...B.errors];
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    for (const p of [A, B]) await p.ctx.close().catch(() => {});
  }
});

test('duplicated tab (same session token in two tabs): the newer tab keeps the seat, the older one stops — no ping-pong — until 여기서 계속', async ({
  browser,
}) => {
  const A = await openPlayer(browser, 'A');
  const extra: Page[] = [];
  try {
    await toLobby(A, '탭');
    await tap(A, '.lb-create');
    await waitPhase(A.page, 'room');
    await tap(A, '.lb-start');
    await waitPhase(A.page, 'combat', 20_000);
    // "duplicate tab" copies sessionStorage: a second tab presents the same session token
    const token = await A.page.evaluate(() => sessionStorage.getItem('swapTower.netToken.tab.v1'));
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const dup = await A.ctx.newPage();
    extra.push(dup);
    const dupErrors: string[] = [];
    dup.on('pageerror', e => dupErrors.push(`dup pageerror: ${e.message}`));
    dup.on('console', m => m.type() === 'error' && dupErrors.push(`dup console.error: ${m.text()}`));
    await dup.addInitScript(t => {
      if (!sessionStorage.getItem('swapTower.netToken.tab.v1')) sessionStorage.setItem('swapTower.netToken.tab.v1', t);
    }, token!);
    await dup.goto(base);
    await waitPhase(dup, 'combat', 15_000);
    // the old tab stops (no reconnect) and says why, on the 매칭 screen
    await A.page.waitForFunction(() => window.__proto!.net.status === 'replaced', undefined, { timeout: 5000 });
    await waitPhase(A.page, 'lobby');
    await expect(A.page.locator('.lb-offline')).toBeVisible();
    await expect(A.page.locator('.lb-offline-text')).toContainText('다른 탭에서 접속 중');
    await expect(A.page.locator('.lb-retry')).toHaveText('여기서 계속');
    await expect(A.page.locator('.lb-status')).toHaveText('다른 탭에서 접속 중');
    // stable for a while: nobody kicks anybody
    const sid = await dup.evaluate(() => window.__proto!.net.sessionId);
    await sleep(4000);
    expect(await A.page.evaluate(() => window.__proto!.net.status)).toBe('replaced');
    expect(await dup.evaluate(() => [window.__proto!.net.status, window.__proto!.phase, window.__proto!.net.sessionId])).toEqual(['online', 'combat', sid]);
    await shot(A, 'multi-replaced-tab');
    // 여기서 계속: this tab takes the seat back (same player), the other one stops instead
    await tap(A, '.lb-retry');
    await waitPhase(A.page, 'combat', 15_000);
    expect(await A.page.evaluate(() => [window.__proto!.localPlayer, window.__proto!.net.sessionId])).toEqual([0, sid]);
    await dup.waitForFunction(() => window.__proto!.net.status === 'replaced', undefined, { timeout: 5000 });
    await sleep(2000);
    expect(await A.page.evaluate(() => window.__proto!.net.status)).toBe('online');
    const errors = [...A.errors, ...dupErrors];
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await A.ctx.close().catch(() => {});
  }
});
