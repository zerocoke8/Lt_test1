// 기획 19차 보스 레이드 (docs/boss-raid.md): the solo run from the main menu. 메인 화면 세 번째 카드 → 편성 → 출발 →
// floor 1 is a boss (HUD 「1층」 + boss name + 「보스 1/20」, the banner with the boss's 괴담 line) → 디버그 「다음 보스로」 →
// floor reward → floor 2 is another boss → a few more floors → 전멸 → the result (보스 레이드 chip, 쓰러뜨린 보스, 내 최고
// 기록 · 신기록, floor chips with boss names) → the record survives a reload (card foot + lamps) → 「다시 하기」 stays a raid.
// On floor 1 the debug 「보스 고르기」 list (20 names, four zone groups) swaps the boss for 문서 파쇄기 — still floor 1, and
// the result chip names the boss that was fought. A second test runs all 20 floors by debug to the win line and
// 「클리어 1회」. A third: '?mode=bossRaid&boss=<id>' starts on that boss (once), the 「보스 예고 시간 배율」 slider at ×2
// doubles the next run's first telegraph, a classic run has no boss list.
// Phone screenshots: docs/screenshots/boss-raid-{main,hud,result,debug}.png.

import { expect, test, type Page } from '@playwright/test';
import type { DebugAction } from '../../src/types';
import type { AppPhase, RunOverrides } from '../../src/ui/app';

const SHOTS = 'docs/screenshots';
const RECORD_KEY = 'swap-tower.bossRaid.v1';

function watchErrors(page: Page, errors: string[]): void {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
}

const tapper = (page: Page, mobile: boolean) => async (selector: string) => {
  const l = page.locator(selector).first();
  await expect(l).toBeVisible();
  if (mobile) await l.tap();
  else await l.click();
};

const waitPhase = (page: Page, want: AppPhase, timeout = 15_000) => page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
const debug = (page: Page, action: DebugAction) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a }), action);
const record = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null') as { bestFloor: number; clears: number; runs: number } | null, RECORD_KEY);

interface Sim {
  phase: string;
  floor: number;
  mode: string | undefined;
  kind: string;
  bossId: string | undefined;
  outcome: string | undefined;
}
const sim = (page: Page) =>
  page.evaluate((): Sim => {
    const s = window.__proto!.game!.state;
    return { phase: s.phase, floor: s.floor, mode: s.mode, kind: s.plan.kind, bossId: s.plan.bossId, outcome: s.runResult?.outcome };
  });

/**
 * By debug: beat the boss on screen, take the first reward card (relic floors too), pass a 괴담 room, until the next
 * floor's combat (or the run's end). Resolves to the sim state then.
 */
async function nextBoss(page: Page): Promise<Sim> {
  const from = (await sim(page)).floor;
  expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => {
      const g = window.__proto!.game!;
      const s = g.state;
      if (s.phase === 'reward' && (s.rewardOffersByPlayer[0]?.length ?? 0) > 0) {
        // a member card needs its target; any other card refuses one
        if (!g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0, member: 0 }).ok) g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      } else if (s.phase === 'goedam') {
        g.dispatch({ type: 'goedam', player: 0, option: 'leave' });
        g.dispatch({ type: 'goedam', player: 0, option: 'continue' });
      }
      return { phase: s.phase, floor: s.floor };
    });
    if (st.phase === 'runOver' || (st.phase === 'combat' && st.floor > from)) return sim(page);
    await page.waitForTimeout(80);
  }
  throw new Error(`floor ${from} never led to the next one: ${JSON.stringify(await sim(page))}`);
}

test('보스 레이드: 메인 카드 → 1층 보스 배너 → 다음 보스로 → 보상 → 2층 다른 보스 → 결과 · 최고 기록 → 새로고침', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  watchErrors(page, errors);
  // automation lands on the classic preset; ?main=1 opens the main menu like a person sees it
  await page.goto('/?main=1');
  await waitPhase(page, 'main');

  // ── main menu: the third card ──
  await expect(page.locator('.main-menu .mm-card')).toHaveCount(3);
  await expect(page.locator('.mm-raid .mm-card-title')).toHaveText('보스 레이드');
  await expect(page.locator('.mm-raid .mm-card-sub')).toHaveText('20층 · 층마다 보스 · 보스 20종');
  await expect(page.locator('.mm-raid-foot')).toHaveText('첫 도전');
  await expect(page.locator('.mm-raid-lamp')).toHaveCount(20);
  await expect(page.locator('.mm-raid-lamp.is-on')).toHaveCount(0);
  // the three cards fit side by side on the stage
  const boxes = await page.locator('.main-menu .mm-card').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right, t: r.top })));
  const vw = page.viewportSize()!.width;
  expect(boxes[0].l).toBeGreaterThanOrEqual(0);
  expect(boxes[2].r).toBeLessThanOrEqual(vw + 0.5);
  expect(boxes[1].l).toBeGreaterThan(boxes[0].r);
  expect(boxes[2].l).toBeGreaterThan(boxes[1].r);
  expect(Math.abs(boxes[0].t - boxes[2].t)).toBeLessThan(1);
  if (mobile) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/boss-raid-main.png` });
  }

  // ── card → the (classic) preset under the raid's name → 출발 ──
  await tap('.mm-raid');
  await waitPhase(page, 'preset');
  expect(await page.evaluate(() => localStorage.getItem('swapTower.mode.v1'))).toBe('bossRaid');
  await expect(page.locator('.ps-title')).toHaveText('보스 레이드 편성');
  await tap('.btn-start');
  // a game server → the 매칭 screen with the mode chip and 「혼자 하기」; none (this preview) → straight into the run
  await page.waitForFunction(() => ['lobby', 'combat'].includes(window.__proto!.phase));
  if ((await page.evaluate(() => window.__proto!.phase)) === 'lobby') {
    await expect(page.locator('.lb-title-row .lb-mode')).toHaveText('보스 레이드');
    await tap('.lb-solo');
  }
  await waitPhase(page, 'combat');

  // ── floor 1 is a boss: HUD + banner ──
  const f1 = await sim(page);
  expect(f1).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss', phase: 'combat' });
  expect(f1.bossId).toBeTruthy();
  await expect(page.locator('.banner-raid .banner-big')).toBeVisible();
  const seedBoss1 = (await page.locator('.boss-name').textContent())!;
  expect(seedBoss1.length).toBeGreaterThan(1);
  expect(seedBoss1).not.toBe('보스');
  await expect(page.locator('.banner-raid .banner-big')).toHaveText(`1층 · ${seedBoss1}`);
  const bannerLore = (await page.locator('.banner-raid .banner-lore').textContent()) ?? '';
  expect(bannerLore.length).toBeGreaterThan(5);
  expect(bannerLore.length, 'one short sentence (기획 19차 review)').toBeLessThanOrEqual(28);
  await expect(page.locator('.banner-raid .banner-sub')).toHaveText('보스 1/20 · HP를 0으로 만들면 퇴각해요');
  await expect(page.locator('.boss')).toBeVisible();
  await expect(page.locator('.floorinfo')).toBeHidden();
  await expect(page.locator('.boss-lv')).toHaveText('1층');
  await expect(page.locator('.boss-raid-k')).toHaveText('보스');
  await expect(page.locator('.boss-raid-n')).toHaveText('1/20');
  // the banner and the progress block stay on the stage and clear of the boss box / the top-right buttons
  const rects = await page.evaluate(() => {
    const r = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom };
    };
    return { stage: r('.stage'), banner: r('.banner-raid .banner-big'), lore: r('.banner-raid .banner-lore'), pill: r('.boss-raid'), box: r('.boss-bar'), tr: r('.hud-tr') };
  });
  expect(rects.banner.l).toBeGreaterThanOrEqual(rects.stage.l);
  expect(rects.banner.r).toBeLessThanOrEqual(rects.stage.r);
  expect(rects.lore.l).toBeGreaterThanOrEqual(rects.stage.l);
  expect(rects.lore.r).toBeLessThanOrEqual(rects.stage.r);
  expect(rects.pill.l).toBeGreaterThan(rects.box.r);
  expect(rects.pill.r).toBeLessThan(rects.tr.l);
  if (mobile) {
    await page.waitForTimeout(450); // the banner's scale-in
    await page.screenshot({ path: `${SHOTS}/boss-raid-hud.png` });
  }

  // pause: 「1층 · 보스 레이드」
  await tap('[aria-label="일시정지"]');
  await expect(page.locator('.pause-info')).toContainText('1층 · 보스 레이드');
  await tap('.pause-btns .btn-primary');
  await expect(page.locator('.pause')).toBeHidden();

  // ── 디버그 「보스 고르기」: 20 names in four zone groups; 문서 파쇄기 → this floor again with it (still floor 1) ──
  await tap('.btn-dbg');
  const picker = page.locator('.debug-panel .dbg-raid-boss');
  await expect(picker).toBeVisible();
  await expect(picker.locator('optgroup')).toHaveCount(4);
  await expect(picker.locator('option')).toHaveCount(20);
  await expect(picker).toHaveValue(f1.bossId!); // opens on the boss of this floor
  await expect(page.locator('.debug-panel .dbg-raid-go')).toHaveText('이 보스로');
  await picker.selectOption({ label: '문서 파쇄기' });
  await expect(picker).toHaveValue('shredder_maw');
  if (mobile) {
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/boss-raid-debug.png` });
  }
  await tap('.dbg-raid-go');
  await page.waitForFunction(() => window.__proto!.game!.state.plan.bossId === 'shredder_maw');
  expect(await sim(page)).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss', phase: 'combat', bossId: 'shredder_maw' });
  const boss1 = '문서 파쇄기';
  expect(boss1).not.toBe(seedBoss1); // an office boss never opens the run by seed
  await expect(page.locator('.boss-name')).toHaveText(boss1);
  await expect(page.locator('.boss-lv')).toHaveText('1층');
  await expect(page.locator('.boss-raid-n')).toHaveText('1/20');
  await expect(page.locator('.banner-raid .banner-big')).toHaveText(`1층 · ${boss1}`);
  // one boss on the field: the picked one
  expect(await page.evaluate(() => window.__proto!.game!.state.entities.filter(e => e.tier === 'boss').map(e => e.defId))).toEqual(['shredder_maw']);

  // ── 디버그 「다음 보스로」 (the panel is still open) → floor reward → floor 2: another boss ──
  await expect(page.locator('.dbg-skip')).toHaveText('다음 보스로');
  await tap('.dbg-skip');
  await waitPhase(page, 'reward');
  const closeDbg = page.locator('.debug-panel [aria-label="닫기"]');
  if (await closeDbg.isVisible()) await closeDbg.click();
  // floor 1 gives a normal floor reward (relic screens only on 5 · 10 · 15 · 20)
  expect(await page.evaluate(() => (window.__proto!.game!.state.rewardOffersByPlayer[0] ?? []).some(o => o.isRelic))).toBe(false);
  await expect(page.locator('.rw-card').first()).toBeVisible();
  await tap('.rw-card >> nth=0 >> .rw-pick');
  await page.waitForFunction(() => window.__proto!.game!.state.floor === 2 && window.__proto!.phase === 'combat');
  const f2 = await sim(page);
  expect(f2).toMatchObject({ mode: 'bossRaid', floor: 2, kind: 'boss' });
  expect(f2.bossId).not.toBe(f1.bossId);
  expect(f2.bossId).not.toBe('shredder_maw');
  await expect(page.locator('.boss-lv')).toHaveText('2층');
  await expect(page.locator('.boss-raid-n')).toHaveText('2/20');
  const boss2 = (await page.locator('.boss-name').textContent())!;
  expect(boss2).not.toBe(boss1);
  await expect(page.locator('.banner-raid .banner-big')).toHaveText(`2층 · ${boss2}`);

  // ── on to floor 6 (a relic screen after floor 5), then a wipe → the result ──
  let relicOffered = false;
  for (let f = 2; f < 6; f++) {
    if (f === 5) {
      // floor 5's clear: the relic screen
      expect((await debug(page, { kind: 'skipFloor' })).ok).toBe(true);
      await waitPhase(page, 'reward');
      relicOffered = await page.evaluate(() => (window.__proto!.game!.state.rewardOffersByPlayer[0] ?? []).every(o => o.isRelic));
      await tap('.rw-card >> nth=0 >> .rw-pick');
      await page.waitForFunction(() => window.__proto!.game!.state.floor === 6 && window.__proto!.phase === 'combat');
    } else await nextBoss(page);
  }
  expect(relicOffered).toBe(true);
  expect(await sim(page)).toMatchObject({ floor: 6, kind: 'boss', mode: 'bossRaid' });
  await expect(page.locator('.boss-lv')).toHaveText('6층');
  const boss6 = (await page.locator('.boss-name').textContent())!;
  expect((await debug(page, { kind: 'wipeParty' })).ok).toBe(true);
  await waitPhase(page, 'result');

  await expect(page.locator('.rs-title')).toHaveText('패배');
  await expect(page.locator('.rs-mode')).toHaveText('보스 레이드');
  await expect(page.locator('.rs-fact-floor .rs-fact-v')).toHaveText('6층');
  await expect(page.locator('.rs-fact-bosses .rs-fact-v')).toHaveText('5마리');
  await expect(page.locator('.rs-fact-best .rs-fact-v')).toHaveText('6층');
  await expect(page.locator('.rs-fact-best .rs-new')).toHaveText('신기록');
  await expect(page.locator('.rs-floor')).toHaveCount(6);
  await expect(page.locator('.rs-floor >> nth=0 >> .rs-floor-n')).toHaveText(`1층 · ${boss1}`);
  await expect(page.locator('.rs-floor >> nth=1 >> .rs-floor-n')).toHaveText(`2층 · ${boss2}`);
  await expect(page.locator('.rs-floor >> nth=5 >> .rs-floor-n')).toHaveText(`6층 · ${boss6}`);
  await expect(page.locator('.rs-floor.is-clear')).toHaveCount(5);
  await expect(page.locator('.rs-floor.is-fail')).toHaveCount(1);
  // floor 1 = the picked boss (from the run's log, not the seed order); floors 2–5 = four different lobby bosses
  const chipNames = (await page.locator('.rs-floor-n').allTextContents()).map(t => t.split(' · ')[1]);
  expect(chipNames[0]).toBe(boss1);
  expect(new Set(chipNames.slice(1, 5)).size).toBe(4);
  expect(chipNames.slice(1, 5)).not.toContain(boss1);
  expect(await record(page)).toEqual({ bestFloor: 6, clears: 0, runs: 1 });
  // the head row stays on one line inside the stage
  const head = await page.evaluate(() => {
    const s = document.querySelector('.stage')!.getBoundingClientRect();
    const facts = [...document.querySelectorAll('.rs-fact')].map(e => e.getBoundingClientRect());
    return { stageR: s.right, right: Math.max(...facts.map(f => f.right)), tops: facts.map(f => Math.round(f.top)) };
  });
  expect(head.right).toBeLessThanOrEqual(head.stageR);
  expect(new Set(head.tops).size).toBe(1);
  if (mobile) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/boss-raid-result.png` });
  }

  // ── 「다시 하기」 is a raid again; a lower floor keeps the record ──
  await tap('.rs-foot .btn-primary');
  await waitPhase(page, 'combat');
  expect(await sim(page)).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss' });
  expect((await debug(page, { kind: 'wipeParty' })).ok).toBe(true);
  await waitPhase(page, 'result');
  await expect(page.locator('.rs-fact-floor .rs-fact-v')).toHaveText('1층');
  await expect(page.locator('.rs-fact-bosses .rs-fact-v')).toHaveText('0마리');
  await expect(page.locator('.rs-fact-best .rs-fact-v')).toHaveText('6층');
  await expect(page.locator('.rs-new')).toHaveCount(0);
  expect(await record(page)).toEqual({ bestFloor: 6, clears: 0, runs: 2 });

  // ── the record survives a reload: card foot, lamps, last-mode highlight ──
  await page.goto('/?main=1');
  await waitPhase(page, 'main');
  await expect(page.locator('.mm-raid-foot')).toHaveText('최고 기록 6층 · 클리어 0회');
  await expect(page.locator('.mm-raid-lamp.is-on')).toHaveCount(6);
  await expect(page.locator('.mm-raid')).toHaveClass(/is-last/);
  await expect(page.locator('.mm-classic')).not.toHaveClass(/is-last/);
  // the other two cards still open their own modes
  await tap('.mm-classic');
  await waitPhase(page, 'preset');
  await expect(page.locator('.ps-title')).toHaveText('클래식 탑 편성');
  await tap('.btn-start');
  await waitPhase(page, 'combat');
  expect((await sim(page)).mode).toBeUndefined();
  expect((await sim(page)).kind).toBe('normal');
  await expect(page.locator('.boss-raid')).toBeHidden();

  expect(errors).toEqual([]);
});

test('보스 레이드: 20층 완주 → 승리 문구 · 클리어 1회 (?mode=bossRaid)', async ({ page }) => {
  const errors: string[] = [];
  watchErrors(page, errors);
  // the query picks the mode for automation: the preset under the raid's name, 출발 = a raid
  await page.goto('/?mode=bossRaid');
  await waitPhase(page, 'preset');
  await expect(page.locator('.ps-title')).toHaveText('보스 레이드 편성');

  // the longest boss name on the last floor: the name row never wraps and never cuts the name — enraged too (the floor
  // chip then makes room for 「광폭화」; the floor stays in the 「보스 20/20」 block)
  const long: RunOverrides = { seed: 1, startFloor: 20, bossRaid: { onlyBoss: 'reverse_escalator' }, tunables: { invincible: true } };
  await page.evaluate(s => window.__proto!.startRun(s), long);
  await waitPhase(page, 'combat');
  const nameRow = () =>
    page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('.boss-row')!;
      const name = row.querySelector<HTMLElement>('.boss-name')!;
      const shown = ([...row.children] as HTMLElement[]).filter(c => c.offsetParent !== null);
      const box = row.getBoundingClientRect();
      return {
        name: name.textContent,
        cut: name.scrollWidth > name.clientWidth + 1,
        wrapped: shown.some(c => c.getBoundingClientRect().height > box.height + 2),
        inside: shown.every(c => c.getBoundingClientRect().right <= box.right + 1),
      };
    });
  await expect(page.locator('.boss-lv')).toHaveText('20층');
  await expect(page.locator('.boss-raid-n')).toHaveText('20/20');
  expect(await nameRow()).toEqual({ name: '거꾸로 가는 에스컬레이터', cut: false, wrapped: false, inside: true });
  expect((await debug(page, { kind: 'forceEnrage' })).ok).toBe(true);
  await expect(page.locator('.boss.is-enraged .boss-enrage')).toBeVisible();
  await expect(page.locator('.boss-lv')).toBeHidden();
  expect(await nameRow()).toEqual({ name: '거꾸로 가는 에스컬레이터', cut: false, wrapped: false, inside: true });

  const setup: RunOverrides = { seed: 20261011, tunables: { invincible: true } };
  await page.evaluate(s => window.__proto!.startRun(s), setup);
  await page.waitForFunction(() => window.__proto!.game!.state.floor === 1);
  await waitPhase(page, 'combat');
  expect(await sim(page)).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss' });

  const seen: string[] = [];
  let last = await sim(page);
  for (let f = 1; f <= 20; f++) {
    expect(last).toMatchObject({ phase: 'combat', floor: f, kind: 'boss' });
    seen.push(last.bossId!);
    if (f === 20) {
      await expect(page.locator('.boss-lv')).toHaveText('20층');
      await expect(page.locator('.boss-raid-n')).toHaveText('20/20');
    }
    last = await nextBoss(page);
  }
  // 20 floors, 20 different bosses, the watcher last
  expect(new Set(seen).size).toBe(20);
  expect(seen[19]).toBe('abyss_watcher');
  expect(last).toMatchObject({ phase: 'runOver', outcome: 'victory' });
  await waitPhase(page, 'result');
  await expect(page.locator('.rs-title')).toHaveText('승리!');
  await expect(page.locator('.rs-reason')).toHaveText('보스 20종을 모두 쓰러뜨렸어요');
  await expect(page.locator('.rs-fact-floor .rs-fact-v')).toHaveText('20층');
  await expect(page.locator('.rs-fact-bosses .rs-fact-v')).toHaveText('20마리');
  await expect(page.locator('.rs-fact-best .rs-fact-v')).toHaveText('20층');
  await expect(page.locator('.rs-floor.is-clear')).toHaveCount(20);
  expect(await record(page)).toEqual({ bestFloor: 20, clears: 1, runs: 1 });

  await page.goto('/?main=1');
  await waitPhase(page, 'main');
  await expect(page.locator('.mm-raid-foot')).toHaveText('최고 기록 20층 · 클리어 1회');
  await expect(page.locator('.mm-raid-lamp.is-on')).toHaveCount(20);
  expect(errors).toEqual([]);
});

/** The first enemy danger telegraph of the run on screen (lowest id; a boss's own yellow ring is not one). */
const firstTelegraph = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const t = window.__proto!.game!.state.telegraphs.filter(x => x.team === 'enemy' && !x.self).sort((a, b) => a.id - b.id)[0];
        return t ? { id: t.id, total: t.total } : null;
      },
      undefined,
      { timeout: 30_000 },
    )
    .then(h => h.jsonValue() as Promise<{ id: number; total: number }>);

test('보스 레이드 디버그: ?boss= 로 시작 보스 · 예고 시간 ×2 슬라이더 · 클래식에는 보스 고르기 없음', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  watchErrors(page, errors);
  // ── the query starts the first solo raid of the page on that boss ──
  await page.goto('/?mode=bossRaid&boss=dead_monitor');
  await waitPhase(page, 'preset');
  await tap('.btn-start');
  await page.waitForFunction(() => ['lobby', 'combat'].includes(window.__proto!.phase));
  if ((await page.evaluate(() => window.__proto!.phase)) === 'lobby') await tap('.lb-solo');
  await waitPhase(page, 'combat');
  expect(await sim(page)).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss', phase: 'combat', bossId: 'dead_monitor' });
  await expect(page.locator('.boss-name')).toHaveText('퇴근 못 한 모니터');
  await expect(page.locator('.boss-lv')).toHaveText('1층');
  await expect(page.locator('.boss-raid-n')).toHaveText('1/20');
  await expect(page.locator('.banner-raid .banner-big')).toHaveText('1층 · 퇴근 못 한 모니터');
  expect(await page.evaluate(() => window.__proto!.game!.state.entities.filter(e => e.tier === 'boss').map(e => e.defId))).toEqual(['dead_monitor']);
  // the picker opens on it
  await tap('.btn-dbg');
  await expect(page.locator('.debug-panel .dbg-raid-boss')).toHaveValue('dead_monitor');
  await page.locator('.debug-panel [aria-label="닫기"]').click();

  // ── once: the next run follows its seed again (a lobby boss on floor 1) ──
  const fixed: RunOverrides = { seed: 7, bossRaid: { onlyBoss: 'shredder_maw' }, tunables: { invincible: true, gameSpeed: 2 } };
  await page.evaluate(() => window.__proto!.startRun({ seed: 5 }));
  await waitPhase(page, 'combat');
  const bySeed = await sim(page);
  expect(bySeed).toMatchObject({ mode: 'bossRaid', floor: 1, kind: 'boss' });
  expect(bySeed.bossId).not.toBe('dead_monitor');

  // ── 「보스 예고 시간 배율」: the same run (seed, boss) at ×1 and at ×2 — the first warning lasts twice as long ──
  await page.evaluate(s => window.__proto!.startRun(s), fixed);
  await waitPhase(page, 'combat');
  const base = await firstTelegraph(page);
  expect(base.total).toBeGreaterThan(0.3);
  await tap('.btn-dbg');
  const sec = page.locator('.debug-panel .dbg-sec', { has: page.locator('.dbg-sec-title', { hasText: '보스 튜닝' }) });
  await expect(sec.locator('.dbg-slider')).toHaveCount(4);
  await expect(sec.locator('.dbg-slider-label')).toHaveText(['보스 예고 시간 배율', '보스 범위 크기 배율', '보스 레이드 HP 배율', '보스 레이드 공격 배율']);
  await expect(sec.locator('.dbg-slider-value')).toHaveText(['1.00×', '1.00×', '1.00×', '1.25×']);
  // 기획 19차 review: in a raid the four sliders sit right under 「보스 고르기」 (not eight screens down the list)
  expect(await page.evaluate(() => document.querySelector('.debug-panel .dbg-raid')!.closest('.dbg-sec')!.nextElementSibling!.querySelector('.dbg-sec-title')!.textContent)).toBe('보스 튜닝');
  const tele = sec.locator('.dbg-slider[data-key="bossTelegraphMult"]');
  await tele.locator('input').fill('2');
  await expect(tele.locator('.dbg-slider-value')).toHaveText('2.00×');
  await expect(tele).toHaveClass(/is-changed/);
  expect(await page.evaluate(() => window.__proto!.game!.tunables.bossTelegraphMult)).toBe(2);
  // solo tuning is saved on this device and applies to the next run
  await page.waitForFunction(() => (localStorage.getItem('swapTower.debugTunables.v1') ?? '').includes('bossTelegraphMult'));
  await page.locator('.debug-panel [aria-label="닫기"]').click();
  await page.evaluate(s => window.__proto!.startRun(s), fixed);
  await waitPhase(page, 'combat');
  expect(await page.evaluate(() => window.__proto!.game!.tunables.bossTelegraphMult)).toBe(2);
  const slow = await firstTelegraph(page);
  expect(slow.id).toBe(base.id);
  expect(slow.total).toBeCloseTo(base.total * 2, 3);

  // ── a classic run: no boss list, the skip button keeps its classic words ──
  await page.evaluate(() => window.__proto!.startRun({ mode: undefined, tunables: { bossTelegraphMult: 1 } }));
  await waitPhase(page, 'combat');
  expect((await sim(page)).mode).toBeUndefined();
  await tap('.btn-dbg');
  await expect(page.locator('.debug-panel .dbg-skip')).toHaveText('층 건너뛰기');
  await expect(page.locator('.debug-panel .dbg-raid-boss')).toBeHidden();
  expect(errors).toEqual([]);
});
