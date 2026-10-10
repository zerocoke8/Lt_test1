// 기획 17차 저스트 교대 (docs/just-swap.md), solo: debug 「저스트 연습」 drops a weak 1.2 s attack under my field character
// every 3 s → the field card turns red (위험), then gold (지금!) with the learner chevrons over the ready cards → swapping
// right then is a 저스트: the attack whiffs, 「저스트!」 stamp, the incoming card wears '×1.5' and the outgoing card '−N초',
// the incoming drag's hits are 저스트 hits (gold numbers), this device's game clock dips to 0.3× for a moment (solo only),
// the result screen counts it. Phone screenshot: docs/screenshots/just-swap.png.

import { expect, test, type Page } from '@playwright/test';
import type { DebugAction, GameEvent } from '../../src/types';
import type { AppPhase, RunOverrides } from '../../src/ui/app';

const SHOT_DIR = 'docs/screenshots';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  await page.evaluate(() => {
    try {
      localStorage.removeItem('justTutor');
    } catch {
      /* ignore */
    }
  });
}

const start = (page: Page, setup: RunOverrides) => page.evaluate(s => window.__proto!.startRun(s), setup);
const waitPhase = (page: Page, want: AppPhase, timeout = 15_000) => page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
const debug = (page: Page, action: DebugAction) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a }), action);

/** Keep a copy of every event the app drains (the app consumes them). */
async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __ev: GameEvent[] };
    w.__ev = [];
    const g = window.__proto!.game!;
    const orig = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const e = orig();
      w.__ev.push(...e);
      return e;
    };
  });
}

/** Wait until the drill's telegraph under my field character lands within (lo, hi] s. */
const waitDrill = (page: Page, lo: number, hi: number) =>
  page.waitForFunction(
    ([lo, hi]) => {
      const s = window.__proto!.game!.state;
      const p = s.players[0];
      const id = p.activeIndex != null ? p.party[p.activeIndex].entityId : null;
      const me = s.entities.find(e => e.id === id);
      return !!me && s.telegraphs.some(t => t.team === 'enemy' && Math.hypot(t.center.x - me.pos.x, t.center.y - me.pos.y) < 0.6 && t.remaining > lo && t.remaining <= hi);
    },
    [lo, hi],
    { timeout: 12_000, polling: 'raf' },
  );

test('저스트 교대 (혼자): 위험 → 지금! → 저스트 도장 · 카드 ×1.5 · −N초 · 슬로 · 결과', async ({ page }, testInfo) => {
  const errors: string[] = [];
  await boot(page, errors);
  await start(page, { seed: 31, tunables: { invincible: true, monsterHpMult: 30, fieldEventChance: 0 } });
  await page.waitForTimeout(2500); // past the appear invulnerability
  await recordEvents(page);
  expect((await debug(page, { kind: 'justDrill' })).ok).toBe(true);

  await waitDrill(page, 0.65, 1.0);
  await expect(page.locator('.ccard.is-active')).toHaveClass(/is-just-danger/);
  await waitDrill(page, 0.2, 0.42);
  const cue = await page.evaluate(() => ({
    now: document.querySelector('.ccard.is-active')?.classList.contains('is-just-now') ?? false,
    chevrons: document.querySelectorAll('.ccard.is-just-hint .cc-just-chev').length,
  }));
  expect(cue.now).toBe(true);
  expect(cue.chevrons).toBeGreaterThan(0);

  // swap now: a ready card dropped on the nearest enemy; sample this device's clock for 0.5 s
  const r = await page.evaluate(async () => {
    const api = window.__proto!;
    const s = api.game!.state;
    const p = s.players[0];
    const out = p.activeIndex!;
    const idx = p.party.findIndex((m, i) => i !== out && !m.dead && m.swapCooldownRemaining <= 0);
    const me = s.entities.find(e => e.id === p.party[out].entityId)!;
    const foe = s.entities.filter(e => e.team === 'enemy' && e.hp > 0).sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.y - me.pos.y) - Math.hypot(b.pos.x - me.pos.x, b.pos.y - me.pos.y))[0];
    const res = api.ui.dragTo('swap', idx, foe ? { ...foe.pos } : { x: me.pos.x + 2, y: me.pos.y });
    let min = 1;
    let badge = '';
    let cut = '';
    const t0 = performance.now();
    while (performance.now() - t0 < 500) {
      await new Promise(f => requestAnimationFrame(() => f(null)));
      min = Math.min(min, api.ui.clockScale);
      badge ||= document.querySelector('.cc-just-badge')?.textContent ?? '';
      cut ||= document.querySelector('.cc-just-cut')?.textContent ?? '';
    }
    return { ok: res.ok, idx, out, min, badge, cut };
  });
  expect(r.ok).toBe(true);
  expect(r.min).toBeLessThan(0.5); // the solo slow (0.3× for 0.3 s)
  expect(r.badge).toBe('×1.5');
  expect(r.cut).toMatch(/^−[\d.]+초$/);
  const stats = await page.evaluate(() => window.__proto!.game!.state.players[0].stats);
  expect(stats.justSwaps).toBe(1);
  const stamps = await page.evaluate(() => window.__proto!.ui.justStamps);
  expect(stamps.at(-1)).toMatchObject({ text: '저스트!', mine: true, player: 0 });
  const ev = await page.evaluate(() => (window as unknown as { __ev: GameEvent[] }).__ev);
  const js = ev.find(e => e.type === 'justSwap') as Extract<GameEvent, { type: 'justSwap' }> | undefined;
  expect(js).toMatchObject({ player: 0, outIndex: r.out, inIndex: r.idx });
  expect(js!.cdCut).toBeGreaterThan(0);
  // the outgoing card's cooldown was cut (−40 %), the incoming drag hit as a 저스트 drag
  await page.waitForFunction(() => ((window as unknown as { __ev: GameEvent[] }).__ev).some(e => e.type === 'damage' && e.just), undefined, { timeout: 4000 });
  if (testInfo.project.name === 'phone') {
    // the card flourish is short: shoot again on the next drill to catch stamp + badge together
    await waitDrill(page, 0.2, 0.42);
    await page.evaluate(() => {
      const api = window.__proto!;
      const s = api.game!.state;
      const p = s.players[0];
      const idx = p.party.findIndex((m, i) => i !== p.activeIndex && !m.dead && m.swapCooldownRemaining <= 0);
      const me = s.entities.find(e => e.id === p.party[p.activeIndex!].entityId)!;
      if (idx >= 0) api.ui.dragTo('swap', idx, { x: me.pos.x + 2.5, y: me.pos.y });
    });
    await sleep(60);
    await page.screenshot({ path: `${SHOT_DIR}/just-swap.png` });
  }
  // the result counts it
  expect((await debug(page, { kind: 'justDrill' })).ok).toBe(true);
  await page.evaluate(() => window.__proto!.game!.dispatch({ type: 'quit' }));
  await waitPhase(page, 'result', 10_000);
  await expect(page.locator('.rs-kv-row', { hasText: '저스트 교대' })).toContainText('회');
  expect(errors, errors.join('\n')).toEqual([]);
});
