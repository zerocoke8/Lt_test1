// 기획 19차 보스 레이드 (docs/boss-raid.md): the solo run from the main menu. 메인 화면 세 번째 카드 → 편성 → 출발 →
// floor 1 is a boss (HUD 「1층」 + boss name + 「보스 1/20」, the banner with the boss's 괴담 line) → 디버그 「다음 보스로」 →
// floor reward → floor 2 is another boss → a few more floors → 전멸 → the result (보스 레이드 chip, 쓰러뜨린 보스, 내 최고
// 기록 · 신기록, floor chips with boss names) → the record survives a reload (card foot + lamps) → 「다시 하기」 stays a raid.
// On floor 1 the debug 「보스 고르기」 list (20 names, four zone groups) swaps the boss for 문서 파쇄기 — still floor 1, and
// the result chip names the boss that was fought. A second test runs all 20 floors by debug to the win line and
// 「클리어 1회」. A third: '?mode=bossRaid&boss=<id>' starts on that boss (once), the 「보스 예고 시간 배율」 slider at ×2
// doubles the next run's first telegraph, a classic run has no boss list.
// 기획 20차 (보스 형태): a fourth test walks one boss of each form through the debug 「보스 고르기」 list (every row says
// the form) — a roaming boss stays inside the arena box, walks, wears its name tag and is pulled by a tank's taunt; a
// relocating boss warns where it will arrive and then stands on its next seat; a mark on my field character turns its
// card into 「교체!」 until I swap it out; an arena boss lays its floor over the
// whole map; a fixed boss has no tag. Each floor banner and the boss box say the form; a pattern's tip shows once a run.
// Phone screenshots: docs/screenshots/boss-raid-{main,hud,result,debug}.png (hud = a roaming boss fight, 기획 20차).

import { expect, test, type Page } from '@playwright/test';
import type { DebugAction } from '../../src/types';
import type { AppPhase, RunOverrides } from '../../src/ui/app';
import { getBoss } from '../../src/data';
import { BOSS_FORM, BOSS_FORM_LABEL, BOSS_FORM_TIP } from '../../src/data/bosses/forms';

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
  await expect(page.locator('.main-menu .mm-card')).toHaveCount(4); // 기획 22차: + 궁극기 테스트
  await expect(page.locator('.mm-raid .mm-card-title')).toHaveText('보스 레이드');
  await expect(page.locator('.mm-raid .mm-card-sub')).toHaveText('20층 · 층마다 보스 · 보스 20종');
  await expect(page.locator('.mm-raid-foot')).toHaveText('첫 도전');
  await expect(page.locator('.mm-raid-lamp')).toHaveCount(20);
  await expect(page.locator('.mm-raid-lamp.is-on')).toHaveCount(0);
  // the cards fit side by side on the stage (기획 22차: four)
  const boxes = await page.locator('.main-menu .mm-card').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right, t: r.top })));
  const vw = page.viewportSize()!.width;
  expect(boxes[0].l).toBeGreaterThanOrEqual(0);
  expect(boxes[3].r).toBeLessThanOrEqual(vw + 0.5);
  expect(boxes[1].l).toBeGreaterThan(boxes[0].r);
  expect(boxes[2].l).toBeGreaterThan(boxes[1].r);
  expect(boxes[3].l).toBeGreaterThan(boxes[2].r);
  expect(Math.abs(boxes[0].t - boxes[3].t)).toBeLessThan(1);
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
  // 기획 20차: the banner and the boss box say the boss's form (boss-raid-hud.png is taken in the form test below)
  const form1 = getBoss(f1.bossId!).form ?? 'fixed';
  await expect(page.locator('.banner-raid .banner-form')).toHaveText(`${BOSS_FORM_LABEL[form1]} · ${BOSS_FORM_TIP[form1]}`);
  await expect(page.locator('.boss-form')).toHaveText(BOSS_FORM_LABEL[form1]);

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
  // 기획 20차: every row says the form after the name
  await expect(picker.locator('option[value="shredder_maw"]')).toHaveText('문서 파쇄기 · 배회형');
  await expect(picker.locator('option[value="elevator_keeper"]')).toHaveText(`${getBoss('elevator_keeper').name} · 고정형`);
  await picker.selectOption('shredder_maw');
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
  // 기획 20차: + 「보스 이동 속도 배율」 (the fifth slider)
  await expect(sec.locator('.dbg-slider')).toHaveCount(5);
  await expect(sec.locator('.dbg-slider-label')).toHaveText(['보스 예고 시간 배율', '보스 범위 크기 배율', '보스 레이드 HP 배율', '보스 레이드 공격 배율', '보스 이동 속도 배율']);
  await expect(sec.locator('.dbg-slider-value')).toHaveText(['1.00×', '1.00×', '1.00×', '1.25×', '1.00×']);
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

// ─────────────────────────── 기획 20차: boss forms ───────────────────────────

interface BossSeen {
  defId: string;
  x: number;
  y: number;
  facing: number;
  radius: number;
}
const bossNow = (page: Page) =>
  page.evaluate((): BossSeen | null => {
    const s = window.__proto!.game!.state;
    const b = s.entities.find(e => e.id === s.bossId);
    return b ? { defId: b.defId, x: b.pos.x, y: b.pos.y, facing: b.facing, radius: b.radius } : null;
  });

interface BossTrack {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  path: number;
  last: { x: number; y: number } | null;
  id: string;
}
type WatchWindow = Window & { __toasts?: string[]; __tips?: string[]; __track?: BossTrack; __trackTimer?: number };

/**
 * In the page: every toast ever shown (they leave after 2 s), every pattern tip the tip slot said (기획 20차 점검: its
 * own slot, not a toast), and the box the boss stayed in + how far it went.
 */
const startWatch = (page: Page) =>
  page.evaluate(() => {
    const w = window as WatchWindow;
    if (!w.__toasts) {
      const seen = (w.__toasts = [] as string[]);
      new MutationObserver(list => {
        for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('toast')) seen.push(n.textContent ?? '');
      }).observe(document.body, { childList: true, subtree: true });
    }
    w.__toasts.length = 0;
    if (!w.__tips) {
      const said = (w.__tips = [] as string[]);
      let last = '';
      window.setInterval(() => {
        const tip = document.querySelector('.raid-tip');
        const on = !!tip && !tip.classList.contains('is-hidden');
        const text = on ? (tip!.querySelector('.raid-tip-t')?.textContent ?? '') : '';
        if (text && text !== last) said.push(text);
        last = text;
      }, 50);
    }
    w.__tips.length = 0;
    clearInterval(w.__trackTimer);
    const tr: BossTrack = (w.__track = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, path: 0, last: null, id: '' });
    w.__trackTimer = window.setInterval(() => {
      const s = window.__proto?.game?.state;
      const b = s && s.bossId != null ? s.entities.find(e => e.id === s.bossId) : undefined;
      if (!b) return;
      if (b.defId !== tr.id) {
        tr.id = b.defId;
        tr.last = null;
      }
      tr.minX = Math.min(tr.minX, b.pos.x);
      tr.maxX = Math.max(tr.maxX, b.pos.x);
      tr.minY = Math.min(tr.minY, b.pos.y);
      tr.maxY = Math.max(tr.maxY, b.pos.y);
      if (tr.last) tr.path += Math.hypot(b.pos.x - tr.last.x, b.pos.y - tr.last.y);
      tr.last = { x: b.pos.x, y: b.pos.y };
    }, 40);
  });
const track = (page: Page) => page.evaluate(() => (window as WatchWindow).__track!);
const toasts = (page: Page) => page.evaluate(() => [...((window as WatchWindow).__toasts ?? [])]);
const tips = (page: Page) => page.evaluate(() => [...((window as WatchWindow).__tips ?? [])]);
const walked = (page: Page, cells: number, timeout: number) => page.waitForFunction(n => ((window as WatchWindow).__track?.path ?? 0) >= n, cells, { timeout });

/** Tag centre vs the boss's place on screen (client px): dx, and how far the tag's foot is above the boss's feet. */
const tagVsBoss = (page: Page) =>
  page.evaluate(() => {
    const s = window.__proto!.game!.state;
    const b = s.entities.find(e => e.id === s.bossId)!;
    const tag = document.querySelector('.boss-tag')!.getBoundingClientRect();
    const stage = document.querySelector('.stage')!.getBoundingClientRect();
    const k = stage.width / 1280;
    const f = window.__proto!.ui.fingerFor(b.pos);
    // fingerFor = the finger of a drop on that spot: 80 logical px (ui/drag.ts LIFT) under the spot itself
    const footY = f.y - 80 * k;
    return { dx: (tag.left + tag.right) / 2 - f.x, above: footY - tag.bottom, k, inStage: tag.left >= stage.left - 1 && tag.right <= stage.right + 1 && tag.top >= stage.top - 1 };
  });

/** The tag is by its boss: over the head (|dx| < 70 px) or hung beside the body (within a body and a tag's width). */
const tagNear = (t: { dx: number; k: number }): boolean => Math.abs(t.dx) < Math.max(70, 240 * t.k);

/** Colours of a grid of floor points of the game canvas (the arena floor between the top HUD and the cards). */
const floorColours = (page: Page) =>
  page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('canvas.stage-canvas')!;
    const g = cv.getContext('2d')!;
    const out: number[][] = [];
    for (let iy = 0; iy < 4; iy++) {
      for (let ix = 0; ix < 8; ix++) {
        const d = g.getImageData(Math.round(cv.width * (0.12 + 0.76 * (ix / 7))), Math.round(cv.height * (0.3 + 0.36 * (iy / 3))), 1, 1).data;
        out.push([d[0], d[1], d[2]]);
      }
    }
    return out;
  });

const FORM_PETS = ['frog_bomb', 'fairy_heal', 'cat_void'];
const FORM_PARTY: RunOverrides['players'] = [
  // my guardian sits on the bench: dragging it in casts 성벽 강림 (its wave taunts); no other tank in the run
  { name: '나', isBot: false, characters: ['blade', 'guardian', 'cleric'], pets: FORM_PETS },
  { name: 'BOT 1', isBot: true, characters: ['ranger', 'mage', 'cleric'], pets: FORM_PETS },
  { name: 'BOT 2', isBot: true, characters: ['mage', 'blade', 'bard'], pets: FORM_PETS },
];

test('보스 형태 (기획 20차): 보스 고르기 → 배회형은 걷고 · 이름표 · 도발 / 자리 이동형은 자리 바꿈 / 전장형은 바닥 / 고정형은 그대로', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'phone';
  const tap = tapper(page, mobile);
  const errors: string[] = [];
  watchErrors(page, errors);
  await page.goto('/?mode=bossRaid');
  await waitPhase(page, 'preset');
  const box = BOSS_FORM.box;
  const formOf = (id: string) => getBoss(id).form ?? 'fixed';
  const start = async (setup: RunOverrides, bossId?: string) => {
    await page.evaluate(s => window.__proto!.startRun(s), { seed: 2020, players: FORM_PARTY, ...setup, tunables: { invincible: true, ...(setup.tunables ?? {}) } });
    await page.waitForFunction(id => window.__proto!.phase === 'combat' && (id == null || window.__proto!.game!.state.plan.bossId === id) && window.__proto!.game!.state.time < 1.5, bossId ?? null);
    await startWatch(page);
  };
  /** The form in the banner and in the boss box; the tag over a moving boss (none over a fixed one). */
  const expectFormHud = async (id: string) => {
    const def = getBoss(id);
    const form = formOf(id);
    await expect(page.locator('.boss-name')).toHaveText(def.name);
    await expect(page.locator('.banner-raid .banner-form')).toHaveText(`${BOSS_FORM_LABEL[form]} · ${BOSS_FORM_TIP[form]}`);
    await expect(page.locator('.boss-form')).toHaveText(BOSS_FORM_LABEL[form]);
    await expect(page.locator('.boss-form')).toHaveAttribute('data-form', form);
    if (form === 'fixed') await expect(page.locator('.boss-tag')).toBeHidden();
    else {
      await expect(page.locator('.boss-tag')).toBeVisible();
      await expect(page.locator('.boss-tag')).toHaveAttribute('data-form', form);
      await expect(page.locator('.boss-tag-n')).toHaveText(def.name);
    }
  };
  const insideBox = (b: { x: number; y: number }) => {
    expect(b.x).toBeGreaterThanOrEqual(box.xMin - 0.01);
    expect(b.x).toBeLessThanOrEqual(box.xMax + 0.01);
    expect(b.y).toBeGreaterThanOrEqual(box.yMin - 0.01);
    expect(b.y).toBeLessThanOrEqual(box.yMax + 0.01);
  };

  // ── 배회형 (혼자 도는 세탁기) through the debug list ──
  await start({});
  await tap('.btn-dbg');
  const picker = page.locator('.debug-panel .dbg-raid-boss');
  await expect(picker.locator('option')).toHaveCount(20);
  for (const id of ['washer_drum', 'dead_monitor', 'answering_pencil', 'karaoke_room', 'abyss_watcher']) {
    await expect(picker.locator(`option[value="${id}"]`)).toHaveText(`${getBoss(id).name} · ${BOSS_FORM_LABEL[formOf(id)]}`);
  }
  await picker.selectOption('washer_drum');
  await tap('.dbg-raid-go');
  await page.waitForFunction(() => window.__proto!.game!.state.plan.bossId === 'washer_drum');
  await page.locator('.debug-panel [aria-label="닫기"]').click();
  await startWatch(page);
  const washer = getBoss('washer_drum');
  expect(washer.form).toBe('roaming');
  await expectFormHud('washer_drum');
  const spawn = (await bossNow(page))!;
  expect(spawn.defId).toBe('washer_drum');
  expect(spawn.radius).toBeLessThanOrEqual(1.8); // about half the set piece (radius 3)
  insideBox(spawn);
  // the form chip hangs under 「보스 N/20」, clear of the boss bar and the top-right buttons
  const chip = await page.evaluate(() => {
    const r = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom };
    };
    return { chip: r('.boss-form'), pill: r('.boss-raid'), bar: r('.boss-bar'), tr: r('.hud-tr') };
  });
  expect(chip.chip.l).toBeGreaterThan(chip.bar.r);
  expect(chip.chip.r).toBeLessThan(chip.tr.l);
  expect(chip.chip.t).toBeGreaterThanOrEqual(chip.pill.b - 1);
  // it walks: 3 cells or more along its path within a few seconds, never out of the box
  await walked(page, 3, 20_000);
  const went = await track(page);
  insideBox({ x: went.minX, y: went.minY });
  insideBox({ x: went.maxX, y: went.maxY });
  // the tag rides over the boss's head — or, when the top HUD row leaves no room there, beside the body (기획 20차 점검:
  // never pushed down onto the body) —, inside the stage
  await expect.poll(async () => tagNear(await tagVsBoss(page))).toBe(true);
  const tag = await tagVsBoss(page);
  expect(tag.above).toBeGreaterThan(0);
  expect(tag.inStage).toBe(true);
  // a pattern's tip (기획 20차: per run in a raid — also on a device that saw it in an earlier run; 기획 20차 점검: in
  // its own slot under the boss box — never a toast —, at least 4 s on screen, with the pattern's name)
  const hinted = [...washer.skills, ...(washer.phases ?? []).flatMap(p => p.skills ?? [])].filter(sk => sk.hint);
  const hints = hinted.map(sk => sk.hint!);
  expect(hints.length).toBeGreaterThan(0);
  for (const h of hints) expect(h.length, h).toBeLessThanOrEqual(21);
  await expect.poll(async () => (await tips(page)).some(t => hints.includes(t)), { timeout: 25_000 }).toBe(true);
  const slot = page.locator('.raid-tip');
  await expect(slot).toBeVisible();
  expect(hinted.map(sk => sk.name)).toContain(await slot.locator('.raid-tip-k').textContent());
  await expect(slot.locator('.raid-tip-more')).toBeVisible(); // the first tips say where to read them again
  const tipBox = (await slot.boundingBox())!;
  const stageBox = (await page.locator('.stage').boundingBox())!;
  expect(tipBox.x).toBeGreaterThanOrEqual(stageBox.x);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
  expect((await toasts(page)).filter(t => hints.some(h => t.includes(h)))).toEqual([]);
  if (mobile) {
    // docs: a roaming boss fight on a phone — a warning on the floor, the tag over the body, the form under 「보스 1/20」,
    // the pattern's tip in its slot
    await page.waitForFunction(() => window.__proto!.game!.state.telegraphs.some(t => t.team === 'enemy' && !t.self && t.remaining / t.total < 0.6), undefined, { timeout: 20_000 }).catch(() => {});
    await page.screenshot({ path: `${SHOTS}/boss-raid-hud.png` });
  }
  // a pattern's tip is said on its first two casts of a run, then no more
  const said = await tips(page);
  for (const h of hints) expect(said.filter(t => t === h).length, h).toBeLessThanOrEqual(2);

  // ── a tank's taunt pulls a roaming boss: 천둥 안테나 keeps its distance — until my guardian's wave taunts it ──
  expect(formOf('thunder_antenna')).toBe('roaming');
  await start({ bossRaid: { onlyBoss: 'thunder_antenna', hpMult: 6 } }, 'thunder_antenna');
  await expectFormHud('thunder_antenna');
  // let it settle, then drop the guardian 3 cells beside it (the wave is a 9-cell band through the drop point)
  await page.waitForFunction(() => window.__proto!.game!.state.time > 2.2);
  const before = (await bossNow(page))!;
  const dropX = before.x > 12 ? before.x - 3 : before.x + 3;
  const drop = await page.evaluate(([x, y]) => window.__proto!.ui.dragTo('swap', 1, { x, y }), [dropX, before.y]);
  expect(drop.ok).toBe(true);
  await page.waitForFunction(() => window.__proto!.game!.state.entities.some(e => e.tier === 'boss' && e.statuses.some(st => st.id === 'taunt')), undefined, { timeout: 5000 });
  const pulled = await page.evaluate(async () => {
    const g = window.__proto!.game!;
    const gap = () => {
      const s = g.state;
      const b = s.entities.find(e => e.id === s.bossId)!;
      const t = s.entities.find(e => e.kind === 'character' && e.defId === 'guardian');
      return { taunted: b.statuses.some(st => st.id === 'taunt'), target: b.targetId, guardian: t?.id ?? -1, d: t ? Math.hypot(b.pos.x - t.pos.x, b.pos.y - t.pos.y) : NaN };
    };
    const first = gap();
    let min = first.d;
    let targeted = first.target === first.guardian;
    // while the taunt lasts (2.5 s) it comes closer
    for (let i = 0; i < 100 && gap().taunted; i++) {
      await new Promise(r => setTimeout(r, 40));
      const now = gap();
      if (Number.isFinite(now.d)) min = Math.min(min, now.d);
      targeted = targeted || now.target === now.guardian;
    }
    return { first: first.d, min, targeted };
  });
  expect(pulled.targeted, 'the taunted boss targets my guardian').toBe(true);
  expect(pulled.min, `it walked toward the guardian (distance ${pulled.first.toFixed(2)} → ${pulled.min.toFixed(2)})`).toBeLessThan(pulled.first - 0.5);
  insideBox((await bossNow(page))!);

  // ── 자리 이동형 (퇴근 못 한 모니터): it warns where it arrives, then stands on its next seat, facing that seat's way ──
  const monitor = getBoss('dead_monitor');
  expect(monitor.form).toBe('relocating');
  const seats = monitor.spots!;
  expect(seats.length).toBeGreaterThanOrEqual(3);
  for (const sp of seats) insideBox(sp);
  await start({ bossRaid: { onlyBoss: 'dead_monitor', hpMult: 6 }, tunables: { gameSpeed: 2 } }, 'dead_monitor');
  await expectFormHud('dead_monitor');
  // the longest form label (「자리 이동형」) still ends before the top-right buttons
  const longChip = await page.evaluate(() => [document.querySelector('.boss-form')!.getBoundingClientRect().right, document.querySelector('.hud-tr')!.getBoundingClientRect().left]);
  expect(longChip[0]).toBeLessThan(longChip[1]);
  const seat0 = (await bossNow(page))!;
  expect(seat0.x).toBeCloseTo(seats[0].x, 3);
  expect(seat0.y).toBeCloseTo(seats[0].y, 3);
  const arrive = await page
    .waitForFunction(
      () => {
        const t = window.__proto!.game!.state.telegraphs.find(x => x.team === 'enemy' && x.motif === 'arrive');
        return t ? { x: t.center.x, y: t.center.y } : null;
      },
      undefined,
      { timeout: 30_000 },
    )
    .then(h => h.jsonValue() as Promise<{ x: number; y: number }>);
  expect(arrive.x).toBeCloseTo(seats[1].x, 3);
  expect(arrive.y).toBeCloseTo(seats[1].y, 3);
  await page.waitForFunction(
    ([x, y]) => {
      const s = window.__proto!.game!.state;
      const b = s.entities.find(e => e.id === s.bossId);
      return !!b && Math.hypot(b.pos.x - x, b.pos.y - y) < 0.01;
    },
    [seats[1].x, seats[1].y],
    { timeout: 15_000 },
  );
  const seat1 = (await bossNow(page))!;
  const DIR = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 } as const;
  expect(Math.cos(seat1.facing - DIR[seats[1].facing])).toBeGreaterThan(0.99);
  // 기획 20차 점검 (가짜 찾기): a fake window stands on the desk it left, so the jump is NOT announced — no tag (and no
  // flash, no name) for decoy.hide seconds; then the 「보스」 chip is back, by the real screen
  expect(monitor.decoy).toEqual({ unit: 'fake_monitor', hide: 4 });
  expect(await page.evaluate(() => window.__proto!.game!.state.entities.some(e => e.defId === 'fake_monitor' && e.hp > 0))).toBe(true);
  await expect(page.locator('.boss-tag')).toBeHidden();
  await expect(page.locator('.boss-tag')).toBeVisible({ timeout: 9_000 });
  await expect.poll(async () => tagNear(await tagVsBoss(page))).toBe(true);

  // ── 표식 (끝나지 않는 회의 「발표 지명」, rule N6): my marked card says 「교체!」; swapping that character out clears the mark ──
  expect(formOf('endless_meeting')).toBe('relocating');
  await start({ players: [FORM_PARTY![0]], bossRaid: { onlyBoss: 'endless_meeting', hpMult: 6 }, tunables: { gameSpeed: 2 } }, 'endless_meeting');
  await expectFormHud('endless_meeting');
  await expect(page.locator('.ccard.is-marked')).toHaveCount(0);
  const marked = () => {
    const s = window.__proto!.game!.state;
    const me = s.players[0];
    const id = me.activeIndex != null ? me.party[me.activeIndex].entityId : null;
    return id != null && s.telegraphs.some(t => t.team === 'enemy' && t.mark === id);
  };
  await page.waitForFunction(marked, undefined, { timeout: 30_000 });
  // slow down to read the card while the mark runs
  await page.evaluate(() => (window.__proto!.game!.tunables.gameSpeed = 0.5));
  const card = page.locator('.ccard.is-marked');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/is-active/);
  await expect(card.locator('.cc-mark')).toBeVisible();
  await expect(card.locator('.cc-mark')).toHaveText('교체!');
  const at = await page.evaluate(() => {
    const s = window.__proto!.game!.state;
    const me = s.players[0];
    const e = s.entities.find(x => x.id === me.party[me.activeIndex!].entityId)!;
    return { x: e.pos.x, y: e.pos.y };
  });
  expect((await page.evaluate(([x, y]) => window.__proto!.ui.dragTo('swap', 1, { x, y }), [at.x, at.y])).ok).toBe(true);
  await page.waitForFunction(() => !window.__proto!.game!.state.telegraphs.some(t => t.mark != null), undefined, { timeout: 5000 });
  await expect(page.locator('.ccard.is-marked')).toHaveCount(0);
  await expect(page.locator('.cc-mark:visible')).toHaveCount(0);

  // ── 전장형 (대답하는 연필): its floor covers the map — the same floor under a fixed boss of that zone looks different ──
  const pencil = getBoss('answering_pencil');
  expect(pencil.form).toBe('arena');
  expect(pencil.stage?.floor).toBeTruthy();
  await start({ startFloor: 16, bossRaid: { onlyBoss: 'abyss_watcher', hpMult: 6 } }, 'abyss_watcher');
  await expectFormHud('abyss_watcher');
  expect((await bossNow(page))!.y).toBeLessThan(0); // the set piece above the arena, as before
  await page.waitForFunction(() => window.__proto!.game!.state.time > 1.2);
  const plain = await floorColours(page);
  await start({ startFloor: 16, bossRaid: { onlyBoss: 'answering_pencil', hpMult: 6 } }, 'answering_pencil');
  await expectFormHud('answering_pencil');
  insideBox((await bossNow(page))!);
  await page.waitForFunction(() => window.__proto!.game!.state.time > 1.2);
  const staged = await floorColours(page);
  const shift = staged.map((c, i) => Math.hypot(c[0] - plain[i][0], c[1] - plain[i][1], c[2] - plain[i][2])).sort((a, b) => a - b);
  expect(shift[Math.floor(shift.length / 2)], 'most floor points changed colour: the paper lies over the whole map').toBeGreaterThan(25);
  // the core moves on its stage too
  await walked(page, 1, 25_000);
  insideBox((await bossNow(page))!);

  // ── 고정형 새 보스 (지하 7번 노래방): still the set piece at the top, no tag ──
  await start({ bossRaid: { onlyBoss: 'karaoke_room', hpMult: 6 } }, 'karaoke_room');
  await expectFormHud('karaoke_room');
  const fixed = (await bossNow(page))!;
  expect(fixed.y).toBeLessThan(0);
  expect(fixed.radius).toBe(3);
  await page.waitForTimeout(1500);
  expect((await track(page)).path).toBe(0);

  expect(errors).toEqual([]);
});
