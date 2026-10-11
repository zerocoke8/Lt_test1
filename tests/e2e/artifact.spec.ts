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

test('artifact build (기획 17차): floor reward (다시 뽑기 · 지명권) and a 저스트 교대, solo, zero console errors', async ({ page }) => {
  pageMode = 'artifact';
  const w = watch(page);
  await page.goto(base);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  const box = (await page.locator('.preset .btn-start').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__proto?.phase === 'combat', undefined, { timeout: 10_000 });
  await page.evaluate(() => {
    const g = window.__proto!.game!;
    g.tunables.invincible = true;
    g.tunables.goedamRoomsPerZone = 0;
    g.state.players[0].rerolls = 5;
  });
  await page.waitForTimeout(800);
  // the floor reward screen: 다시 뽑기 until a card asks 「누구에게?」, give it to the third character
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'skipFloor' } }));
  await page.waitForFunction(() => window.__proto?.phase === 'reward');
  await expect(page.locator('.rw-card')).toHaveCount(3);
  await expect(page.locator('.rw-reroll')).toHaveText('다시 뽑기 5');
  for (let n = 4; (await page.locator('.rw-card:has(.rw-who)').count()) === 0 && n >= 0; n--) {
    const before = await page.evaluate(() => (window.__proto!.game!.state.rewardOffersByPlayer[0] ?? []).map(o => o.rewardId).join());
    await page.locator('.rw-reroll').click();
    await page.waitForFunction(b => (window.__proto!.game!.state.rewardOffersByPlayer[0] ?? []).map(o => o.rewardId).join() !== b, before);
    await page.waitForTimeout(450);
  }
  const card = page.locator('.rw-card:has(.rw-who)').first();
  await expect(card).toBeVisible();
  const idx = await card.evaluate(el => [...el.parentElement!.children].indexOf(el));
  const id = await page.evaluate(i => window.__proto!.game!.state.rewardOffersByPlayer[0]![i].rewardId, idx);
  await card.locator('.rw-who-p').nth(2).click();
  await card.locator('.rw-pick').click();
  await page.waitForFunction(() => window.__proto?.phase === 'combat' && window.__proto.game!.state.floor === 2);
  expect(await page.evaluate(() => window.__proto!.game!.state.players[0].rewards.at(-1))).toMatchObject({ rewardId: id, partyIndex: 2 });
  await page.waitForTimeout(2500); // past the appear invulnerability

  // 저스트 연습: swap on the gold cue → 「저스트!」 stamp, this device's clock dips (solo)
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'justDrill' } }));
  let just = 0;
  for (let k = 0; k < 4 && just === 0; k++) {
    await page.evaluate(async () => {
      const api = window.__proto!;
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        await new Promise(f => requestAnimationFrame(() => f(null)));
        const s = api.game!.state;
        const p = s.players[0];
        const me = s.entities.find(e => e.id === p.party[p.activeIndex ?? 0]?.entityId);
        const t = me && s.telegraphs.find(x => x.team === 'enemy' && Math.hypot(x.center.x - me.pos.x, x.center.y - me.pos.y) < 0.6);
        if (!me || !t || t.remaining > 0.4 || t.remaining <= 0.2) continue;
        const i = p.party.findIndex((m, j) => j !== p.activeIndex && !m.dead && m.swapCooldownRemaining <= 0);
        if (i >= 0 && api.ui.dragTo('swap', i, { x: me.pos.x + 2.5, y: me.pos.y }).ok) return;
      }
    });
    await page.waitForTimeout(300);
    just = await page.evaluate(() => window.__proto!.game!.state.players[0].stats.justSwaps);
  }
  expect(just).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__proto!.ui.justStamps.some(s => s.mine))).toBe(true);
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'justDrill' } }));
  await page.waitForTimeout(1000);
  expect(w.errors, w.errors.join('\n')).toEqual([]);
  expect(w.requests).toEqual(['/']);
});

test('artifact build (기획 15차 · 16차 원정): solo expedition without a server, the run and the stash survive a reload, zero console errors', async ({ page }) => {
  pageMode = 'artifact';
  const w = watch(page);
  const tapSel = async (sel: string) => {
    const l = page.locator(sel).first();
    await expect(l).toBeVisible();
    await l.click();
  };
  const phase = (p: string) => page.waitForFunction(x => window.__proto?.phase === x, p, { timeout: 15_000 });
  /** After the debug clear: the floor reward (and a 괴담 room, if one opens) until the 원정 lobby. */
  const toLobby = async () => {
    for (let i = 0; i < 80; i++) {
      const p = await page.evaluate(() => window.__proto!.phase);
      if (p === 'expHub') return;
      if (p === 'reward') await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 }));
      else if (p === 'goedam') await page.evaluate(() => {
          // the room: 「지나간다」, then read the result card away
          window.__proto!.game!.dispatch({ type: 'goedam', player: 0, option: 'leave' });
          window.__proto!.game!.dispatch({ type: 'goedam', player: 0, option: 'continue' });
        });
      await page.waitForTimeout(250);
    }
    throw new Error('never reached the lobby');
  };
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
  await toLobby();
  await tapSel('.exp-reveal-ok');
  await expect(page.locator('.exp-run-bag .exp-tile')).toHaveCount(1);

  // reload in the lobby: the run (localStorage, inside the artifact's own origin) is still there → 수령
  await page.reload();
  await phase('main');
  await tapSel('.mm-exp');
  await phase('expHub');
  await expect(page.locator('.exp-run-bag .exp-tile')).toHaveCount(1);
  await tapSel('.exp-claim');
  await phase('expResult');
  await expect(page.locator('.exp-rs-title')).toHaveText('수령 완료!');
  await tapSel('.exp-rs-hub');
  await phase('expHub');
  await expect(page.locator('.exp-stash-chip')).toHaveText('보관함 1');
  expect(w.errors, w.errors.join('\n')).toEqual([]);
  expect(w.requests.every(r => r === '/')).toBe(true);
});

test('artifact build (기획 19차 보스 레이드): solo raid without a server — floor 1 boss, 보스 고르기 (one boss of each 기획 20차 form), reward → floor 2, the best floor survives a reload, zero console errors', async ({
  page,
}) => {
  pageMode = 'artifact';
  const w = watch(page);
  const tapSel = async (sel: string) => {
    const l = page.locator(sel).first();
    await expect(l).toBeVisible();
    await l.click();
  };
  const phase = (p: string) => page.waitForFunction(x => window.__proto?.phase === x, p, { timeout: 15_000 });
  const debug = (action: object) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a as never }), action);
  await page.goto(`${base}?main=1`);
  await phase('main');
  await expect(page.locator('.mm-raid .mm-card-sub')).toHaveText('20층 · 층마다 보스 · 보스 20종');
  await expect(page.locator('.mm-raid-foot')).toHaveText('첫 도전');
  await tapSel('.mm-raid');
  await phase('preset');
  await expect(page.locator('.ps-title')).toHaveText('보스 레이드 편성');
  // 출발 → no game server, so straight into the solo raid with two bots
  await tapSel('.preset .btn-start');
  await phase('combat');
  expect(
    await page.evaluate(() => {
      const s = window.__proto!.game!.state;
      return [window.__proto!.mode, s.mode, s.floor, s.plan.kind, s.players.map(p => p.isBot)];
    }),
  ).toEqual(['solo', 'bossRaid', 1, 'boss', [false, true, true]]);
  await expect(page.locator('.boss-lv')).toHaveText('1층');
  await expect(page.locator('.boss-raid-n')).toHaveText('1/20');
  const seedBoss = await page.evaluate(() => window.__proto!.game!.state.plan.bossId!);
  // the sound table of all 20 bosses is inside the single file (intro / phase / death per boss, the three new kinds)
  const ids = await page.evaluate(() => window.__proto!.sfx.ids());
  for (const id of [`boss.intro.${seedBoss}`, 'boss.intro.inverted_moon', 'boss.phase.claw_machine', 'boss.death.dead_monitor', 'boss.windup.water', 'boss.impact.chime']) expect(ids).toContain(id);

  // debug 「보스 고르기」: the same floor again with a boss of another zone, and it plays
  const other = seedBoss === 'inverted_moon' ? 'dead_monitor' : 'inverted_moon';
  expect((await debug({ kind: 'raidBoss', boss: other })).ok).toBe(true);
  await page.waitForFunction(b => window.__proto!.game!.state.plan.bossId === b && window.__proto!.phase === 'combat', other);
  await expect(page.locator('.boss-lv')).toHaveText('1층');
  await expect(page.locator('.boss-name')).toHaveText(other === 'inverted_moon' ? '거꾸로 뜬 달' : '퇴근 못 한 모니터');
  await page.evaluate(() => (window.__proto!.game!.tunables.invincible = true));
  // a few seconds of the fight: the boss casts (a warning shows up) with the renderer and the sound live
  await page.waitForFunction(() => window.__proto!.game!.state.telegraphs.some(t => t.team === 'enemy'), undefined, { timeout: 20_000 });
  await page.waitForTimeout(1500);

  // 기획 20차 보스 형태 (integration): one boss of each form plays inside the single file — the form chip, a body in the
  // arena that walks (배회형) / changes its seat (자리 이동형) / moves on its stage (전장형), the set piece on top (고정형),
  // and a warning of each on the floor
  const bossAt = () =>
    page.evaluate(() => {
      const s = window.__proto!.game!.state;
      const b = s.entities.find(e => e.id === s.bossId)!;
      return { x: b.pos.x, y: b.pos.y };
    });
  const FORMS: [id: string, label: string, travels: number][] = [
    ['washer_drum', '배회형', 3],
    ['dead_monitor', '자리 이동형', 5],
    ['answering_pencil', '전장형', 1],
    ['morgue_drawers', '고정형', 0], // a ward boss: never the seed's floor-2 boss (checked below)
  ];
  for (const [id, label, travels] of FORMS) {
    expect((await debug({ kind: 'raidBoss', boss: id })).ok, id).toBe(true);
    await page.waitForFunction(b => window.__proto!.game!.state.plan.bossId === b && window.__proto!.phase === 'combat', id);
    await page.evaluate(() => (window.__proto!.game!.tunables.gameSpeed = 2));
    await expect(page.locator('.boss-form')).toHaveText(label);
    const from = await bossAt();
    if (travels > 0) {
      expect(from.y, `${id}: a body inside the arena`).toBeGreaterThanOrEqual(3 - 0.01);
      await expect(page.locator('.boss-tag')).toBeVisible();
      await page.waitForFunction(
        ([x, y, need]) => {
          const s = window.__proto!.game!.state;
          const b = s.entities.find(e => e.id === s.bossId);
          return !!b && Math.hypot(b.pos.x - x, b.pos.y - y) >= need;
        },
        [from.x, from.y, travels],
        { timeout: 30_000 },
      );
    } else {
      expect(from.y, `${id}: the set piece above the arena`).toBeLessThan(0);
      await expect(page.locator('.boss-tag')).toBeHidden();
    }
    await page.waitForFunction(() => window.__proto!.game!.state.telegraphs.some(t => t.team === 'enemy' && !t.self), undefined, { timeout: 20_000 });
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => (window.__proto!.game!.tunables.gameSpeed = 1));

  // 「다음 보스로」 → the floor reward → floor 2, another boss
  expect((await debug({ kind: 'skipFloor' })).ok).toBe(true);
  await phase('reward');
  await expect(page.locator('.rw-card')).toHaveCount(3);
  for (let i = 0; i < 80; i++) {
    const p = await page.evaluate(() => {
      const g = window.__proto!.game!;
      const s = g.state;
      if (s.phase === 'reward' && (s.rewardOffersByPlayer[0]?.length ?? 0) > 0) {
        if (!g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0, member: 0 }).ok) g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      } else if (s.phase === 'goedam') {
        g.dispatch({ type: 'goedam', player: 0, option: 'leave' });
        g.dispatch({ type: 'goedam', player: 0, option: 'continue' });
      }
      return { phase: s.phase, floor: s.floor };
    });
    if (p.phase === 'combat' && p.floor === 2) break;
    await page.waitForTimeout(150);
  }
  await phase('combat');
  const f2 = await page.evaluate(() => ({ floor: window.__proto!.game!.state.floor, boss: window.__proto!.game!.state.plan.bossId }));
  expect(f2.floor).toBe(2);
  expect(f2.boss).not.toBe('morgue_drawers');
  await expect(page.locator('.boss-raid-n')).toHaveText('2/20');
  await page.waitForTimeout(800);

  // a wipe → the raid result; the record is on this device
  expect((await debug({ kind: 'wipeParty' })).ok).toBe(true);
  await phase('result');
  await expect(page.locator('.rs-title')).toHaveText('패배');
  await expect(page.locator('.rs-mode')).toHaveText('보스 레이드');
  await expect(page.locator('.rs-fact-floor .rs-fact-v')).toHaveText('2층');
  await expect(page.locator('.rs-fact-best .rs-fact-v')).toHaveText('2층');
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('swap-tower.bossRaid.v1') ?? 'null'));
  expect(await record()).toEqual({ bestFloor: 2, clears: 0, runs: 1 });

  // reload (localStorage inside the artifact's own origin): the card still shows the best floor
  await page.goto(`${base}?main=1`);
  await phase('main');
  await expect(page.locator('.mm-raid-foot')).toHaveText('최고 기록 2층 · 클리어 0회');
  await expect(page.locator('.mm-raid-lamp.is-on')).toHaveCount(2);
  await expect(page.locator('.mm-raid')).toHaveClass(/is-last/);
  expect(await record()).toEqual({ bestFloor: 2, clears: 0, runs: 1 });
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
