// E2E: the claude.ai Artifact build (solo only, 기획 3차) on a plain static host with no game server.
// The artifact fragment (scripts/make-artifact.mjs) is wrapped in a document like the Artifact host does; every other
// path answers 404. Expect: no request besides the page (no /healthz probe, no WebSocket), zero console errors, a neutral
// "혼자 하기 전용" note, and 출발 → solo run with bots that plays (a swap goes through) — with the synthesized sound live
// (기획 13차: the first click unlocks audio, the drop's drag stages are played).
// For comparison the regular build on the same host: exactly one /healthz probe (404, no retries) → solo only.

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT = process.env.E2E_OUT || 'dist';
let server: Server | null = null;
let base = '';
let artifactHtml = '';
let regularHtml = '';
let pageMode: 'artifact' | 'regular' = 'artifact';
const served: string[] = [];

test.beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'swap-tower-artifact-'));
  execFileSync(process.execPath, ['scripts/make-artifact.mjs', path.join(OUT, 'index.html'), dir], { stdio: 'ignore' });
  const fragment = readFileSync(path.join(dir, 'index.html'), 'utf8');
  artifactHtml =
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    // the host sets the tab icon itself (otherwise the browser asks for /favicon.ico — the host's 404, not ours)
    '<link rel="icon" href="data:,">' +
    `</head><body>${fragment}</body></html>`;
  regularHtml = readFileSync(path.join(OUT, 'index.html'), 'utf8');
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    served.push(url);
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(pageMode === 'artifact' ? artifactHtml : regularHtml);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server!.address() as { port: number }).port}/`;
});

test.afterAll(async () => {
  await new Promise<void>(r => (server ? server.close(() => r()) : r()));
  server = null;
});

function watch(page: Page) {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('request', r => requests.push(new URL(r.url()).pathname + (r.resourceType() === 'websocket' ? ' (ws)' : '')));
  page.on('websocket', ws => requests.push(`ws ${ws.url()}`));
  return { errors, requests };
}

test('artifact build: solo only, no network probe, zero console errors, plays', async ({ page }) => {
  pageMode = 'artifact';
  const w = watch(page);
  await page.goto(base);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  await page.waitForFunction(() => window.__proto?.net.status === 'offline');
  const note = page.locator('.ps-net-note');
  await expect(note).toBeVisible();
  await expect(note).toHaveClass(/is-solo/);
  await expect(note).toContainText('혼자 하기 전용');

  // 출발 → straight into a solo run (no 매칭 screen)
  const box = (await page.locator('.preset .btn-start').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__proto?.phase === 'combat', undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__proto!.sfx.recent.map(e => e.id))).toContain('ui.start');
  expect(await page.evaluate(() => [window.__proto!.mode, window.__proto!.localPlayer, window.__proto!.game!.state.players.map(p => p.isBot)])).toEqual([
    'solo',
    0,
    [false, true, true],
  ]);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return window.__proto!.ui.dragTo('swap', 1, { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 });
  });
  expect(r.ok).toBe(true);
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].activeIndex === 1);
  // 기획 13차 효과음: the synth sound table is inside the single file; the 출발 click unlocked the AudioContext and the
  // drop is heard (button → drag stages), all without a request or a console error
  expect(await page.evaluate(() => window.__proto!.sfx.ids().length)).toBeGreaterThan(300);
  await page.waitForFunction(() => window.__proto!.sfx.unlocked && !window.__proto!.sfx.muted);
  await page.waitForFunction(() => window.__proto!.sfx.recent.some(e => e.id.startsWith('drag.')), undefined, { timeout: 3000 });
  await page.waitForTimeout(1500);

  // 기획 10차: a forced 괴담 room (inline SVG art, no files) → pick → result card → 계속 → floor 2
  await page.evaluate(() => {
    const g = window.__proto!.game!;
    g.dispatch({ type: 'debug', action: { kind: 'goedamNext', room: 'broken_vending' } });
    g.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
    g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
  });
  await page.waitForFunction(() => window.__proto?.phase === 'goedam');
  await expect(page.locator('.goedam .gd-art svg')).toBeVisible();
  await page.locator('.gd-opt').first().click();
  await expect(page.locator('.gd-card')).toBeVisible();
  await page.locator('.gd-continue').click();
  await page.waitForFunction(() => window.__proto?.phase === 'combat' && window.__proto.game!.state.floor === 2);
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].goedamLog.length)).toBe(1);
  await page.waitForTimeout(800);

  expect(w.errors, w.errors.join('\n')).toEqual([]);
  expect(w.requests).toEqual(['/']);
});

test('artifact build (기획 15차): per-character ult gauges with the debug 「궁극기 게이지」 slider, cooldown swaps, solo, zero console errors', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  pageMode = 'artifact';
  const w = watch(page);
  await page.goto(base);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  const box = (await page.locator('.preset .btn-start').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__proto?.phase === 'combat', undefined, { timeout: 10_000 });
  await page.evaluate(() => (window.__proto!.game!.tunables.invincible = true));
  // the rule from the start: a ring on every card, no 14차 energy UI
  await expect(page.locator('.cc-ult:visible')).toHaveCount(3);
  await expect(page.locator('.hud-energy, .cc-cost')).toHaveCount(0);
  // the debug panel → 「궁극기 게이지」: 필드 충전 시간 5초
  const dbg = page.locator('.btn-dbg');
  if (mobile) await dbg.tap();
  else await dbg.click();
  await expect(page.locator('.debug-panel')).toBeVisible();
  await expect(page.locator('.debug-panel .dbg-mode')).toHaveCount(0);
  await page.locator('.debug-panel .dbg-slider[data-key="ultFieldChargeTime"] input').fill('5');
  await page.locator('.debug-panel .dbg-hbtn', { hasText: '✕' }).click();
  expect(await page.evaluate(() => window.__proto!.game!.tunables.ultFieldChargeTime)).toBe(5);

  // a swap: the card that left starts its re-appear cooldown (the only swap rule)
  const r = await page.evaluate(() => {
    const s = window.__proto!.game!.state;
    return window.__proto!.ui.dragTo('swap', 1, { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 });
  });
  expect(r.ok).toBe(true);
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].activeIndex === 1);
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].party[0].swapCooldownRemaining)).toBeGreaterThan(0);

  // the field card's own gauge fills (~5 s) → the ult button casts that character's ult only
  await expect(page.locator('.ccard.is-active .cc-ult')).toHaveClass(/is-full/, { timeout: 12_000 });
  const ultBtn = page.locator('.ult');
  if (mobile) await ultBtn.tap();
  else await ultBtn.click();
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 1, undefined, { timeout: 3000 });
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].party[1].ult.charge)).toBeLessThan(0.2);
  await page.waitForTimeout(1500);
  expect(w.errors, w.errors.join('\n')).toEqual([]);
  expect(w.requests).toEqual(['/']);
});

test('artifact build (기획 15차 원정): solo expedition without a server, the stash survives a reload, zero console errors', async ({ page }) => {
  pageMode = 'artifact';
  const w = watch(page);
  const tapSel = async (sel: string) => {
    const l = page.locator(sel).first();
    await expect(l).toBeVisible();
    await l.click();
  };
  const phase = (p: string) => page.waitForFunction(x => window.__proto?.phase === x, p, { timeout: 15_000 });
  await page.goto(`${base}?main=1`);
  await phase('main');
  await tapSel('.mm-exp');
  await phase('expHub');
  await tapSel('.exp-go');
  await phase('expMatch');
  await expect(page.locator('.exp-mt-title')).toHaveText('혼자 하기 · 봇 2명과 출발');
  await phase('combat');
  expect(await page.evaluate(() => [window.__proto!.mode, window.__proto!.game!.state.expedition?.stage])).toEqual(['solo', 1]);
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'expeditionClearStage' } }));
  await phase('expChoice');
  await tapSel('.exp-extract');
  await phase('expResult');
  await expect(page.locator('.exp-rs-title')).toHaveText('탈출 성공!');
  await tapSel('.exp-rs-hub');
  await phase('expHub');
  await expect(page.locator('.exp-stash-chip')).toHaveText('보관함 2');

  // reload: the stash (localStorage, inside the artifact's own origin) is still there
  await page.reload();
  await phase('main');
  await tapSel('.mm-exp');
  await phase('expHub');
  await expect(page.locator('.exp-stash-chip')).toHaveText('보관함 2');
  expect(w.errors, w.errors.join('\n')).toEqual([]);
  expect(w.requests.every(r => r === '/')).toBe(true);
});

test('regular build on a static host: one /healthz probe (404), no retries, solo only', async ({ page }) => {
  pageMode = 'regular';
  served.length = 0;
  const w = watch(page);
  await page.goto(base);
  await page.waitForFunction(() => window.__proto?.net.status === 'offline');
  const note = page.locator('.ps-net-note');
  await expect(note).toBeVisible();
  await expect(note).not.toHaveClass(/is-solo/);
  // the probe would retry after 3 s on a network error; a 404 is definitive
  await page.waitForTimeout(3800);
  expect(served).toEqual(['/', '/healthz']);
  expect(w.requests.filter(u => u.includes('ws'))).toEqual([]);
  // the browser itself logs the 404 of the probe; nothing else
  expect(w.errors.filter(e => !/404/.test(e)), w.errors.join('\n')).toEqual([]);
  expect(w.errors.length).toBeLessThanOrEqual(1);
});
