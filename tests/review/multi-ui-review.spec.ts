// Multiplayer UI review (R32–R35): the browser player sits in slot 1 (not 0), so every "localPlayer" use is exercised
// with a non-zero index: HUD (others list, my cards), camera follow, reward offers, result row; plus the multiplayer
// menu (no pause) and keyboard input under it. The host is a raw protocol client (cheap); slot 2 is a bot.
import { expect, test, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';
import type { GameState } from '../../src/types';

const OUT = process.env.REVIEW_OUT || '/tmp/swap-tower-review-dist';
const PRESET_A = { characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
const PRESET_B = { characters: ['ranger', 'gunner', 'cleric'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: ChildProcess | null = null;
let port = 0;
let log = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  execSync(`npx vite build --outDir ${OUT} --emptyOutDir`, { stdio: 'ignore', cwd: path.resolve('.') });
  port = await freePort();
  server = spawn(process.execPath, [path.resolve('node_modules/vite-node/vite-node.mjs'), 'server/main.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: OUT, END_LINGER_MS: '1500', REWARD_TIMEOUT_SEC: '60' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', d => (log += String(d)));
  server.stderr?.on('data', d => (log += String(d)));
  for (let i = 0; i < 300; i++) {
    try {
      if ((await (await fetch(`http://127.0.0.1:${port}/healthz`)).text()) === 'ok') return;
    } catch {
      /* not up */
    }
    await sleep(100);
  }
  throw new Error(`server did not start\n${log}`);
});

test.afterAll(() => {
  server?.kill();
});

/** Raw protocol host. */
class Host {
  ws!: WebSocket;
  msgs: Record<string, unknown>[] = [];
  seq = 0;
  async open(): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', d => this.msgs.push(JSON.parse(String(d))));
    await new Promise(r => this.ws.once('open', r));
    this.send({ t: 'hello', v: 1, name: '호스트' });
    await this.wait(m => m.t === 'welcome');
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  cmd(cmd: unknown): void {
    this.send({ t: 'cmd', seq: ++this.seq, cmd });
  }
  async wait(pred: (m: Record<string, unknown>) => boolean, timeout = 10_000): Promise<Record<string, unknown>> {
    const until = Date.now() + timeout;
    let from = 0;
    while (Date.now() < until) {
      for (let i = from; i < this.msgs.length; i++) if (pred(this.msgs[i])) return this.msgs[i];
      from = this.msgs.length;
      await sleep(30);
    }
    throw new Error('host wait timeout');
  }
  lastState(): GameState {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === 'snap') return this.msgs[i].state as GameState;
    throw new Error('no snapshot');
  }
}

const proto = <T>(page: Page, fn: () => T) => page.evaluate(fn);

test('slot-1 browser player: HUD, camera, rewards, result row and the no-pause menu all use localPlayer = 1', async ({ browser }) => {
  const errors: string[] = [];
  const host = new Host();
  await host.open();
  host.send({ t: 'createRoom', preset: PRESET_A });
  const room = (await host.wait(m => m.t === 'room' && !!m.room)).room as { code: string };

  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(p => {
    localStorage.setItem('swapTower.preset.v1', JSON.stringify(p));
    localStorage.setItem('swapTower.nickname.v1', JSON.stringify('비'));
  }, PRESET_B);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__proto?.net.status === 'online');
  await page.locator('.btn-start').first().tap();
  await page.waitForFunction(() => window.__proto?.phase === 'lobby');
  await page.locator('.lb-code-input').fill(room.code);
  await page.locator('.lb-join').tap();
  await page.waitForFunction(() => window.__proto?.phase === 'room');
  host.send({ t: 'start' });
  await page.waitForFunction(() => window.__proto?.phase === 'combat', undefined, { timeout: 15_000 });
  expect(await proto(page, () => [window.__proto!.mode, window.__proto!.localPlayer])).toEqual(['multi', 1]);

  // HUD: "others" = players 0 and 2; my cards = my preset
  await expect(page.locator('.hud-tl .bot-name')).toHaveText(['호스트', 'BOT 1']);
  await expect(page.locator('.hud-bl .cc-name')).toHaveText(['레인저', '거너', '클레릭']);

  // camera follows MY field character: I swap far right, the host stays left
  host.cmd({ type: 'swap', partyIndex: 1, pos: { x: 3, y: 6 } });
  await page.waitForTimeout(700);
  expect((await proto(page, () => window.__proto!.ui.dragTo('swap', 1, { x: 31, y: 6 }))).ok).toBe(true);
  await page.waitForTimeout(2500);
  const vw = page.viewportSize()!.width;
  const mine = await proto(page, () => {
    const s = window.__proto!.game!.state;
    const me = s.players[1];
    const e = s.entities.find(x => x.id === me.party[me.activeIndex!].entityId)!;
    return window.__proto!.ui.fingerFor(e.pos).x;
  });
  expect(mine).toBeGreaterThan(vw * 0.2);
  expect(mine).toBeLessThan(vw * 0.8);

  // menu = no pause (R35): time keeps going under it; no keyboard ult under the open menu
  host.cmd({ type: 'tunables', patch: { ultChargeTime: 0.5 } });
  await page.waitForFunction(() => window.__proto!.game!.state.players[1].ult.charge >= 1, undefined, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause')).toBeVisible();
  const t0 = await proto(page, () => window.__proto!.game!.state.time);
  await page.waitForTimeout(800);
  const t1 = await proto(page, () => window.__proto!.game!.state.time);
  expect(t1).toBeGreaterThan(t0 + 0.4);
  expect(await proto(page, () => window.__proto!.paused)).toBe(false);
  const before = await proto(page, () => window.__proto!.game!.state.players[1].stats.ultsUsed);
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const after = await proto(page, () => window.__proto!.game!.state.players[1].stats.ultsUsed);
  test.info().annotations.push({ type: 'space-under-menu', description: `ultsUsed ${before} → ${after}` });
  // review LOW 4 (fixed): the keyboard ult is ignored while the multiplayer menu covers the HUD
  expect(after).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause')).toBeHidden();

  // rewards: MY offers (slot 1), not the host's
  host.cmd({ type: 'debug', action: { kind: 'skipFloor' } });
  await page.waitForFunction(() => window.__proto!.phase === 'reward', undefined, { timeout: 10_000 });
  const offers = await proto(page, () => window.__proto!.game!.state.rewardOffersByPlayer[1]!.map(o => o.name));
  await expect(page.locator('.rw-card .rw-name')).toHaveText(offers);
  await page.locator('.rw-card').first().tap();
  await expect(page.locator('.rw-wait')).toBeVisible();
  await expect(page.locator('.rw-wait-text')).toContainText('(2/3)');
  host.cmd({ type: 'chooseReward', offerIndex: 0 });
  await page.waitForFunction(() => window.__proto!.phase === 'combat' && window.__proto!.game!.state.floor === 2, undefined, { timeout: 10_000 });
  const mineRewards = await proto(page, () => window.__proto!.game!.state.players[1].rewards.length + window.__proto!.game!.state.players[1].relics.length);
  expect(mineRewards).toBe(1);

  // host ends the run → my result row is highlighted
  host.cmd({ type: 'quit' });
  await page.waitForFunction(() => window.__proto!.phase === 'result', undefined, { timeout: 15_000 });
  await expect(page.locator('.rs-table tr.is-me')).toHaveCount(1);
  await expect(page.locator('.rs-table tr.is-me')).toContainText('비');
  expect(errors).toEqual([]);
  console.log(`space under the open multiplayer menu: ultsUsed ${before} → ${after}`);
  await ctx.close();
  host.ws.close();
});
