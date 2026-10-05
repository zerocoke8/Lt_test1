// E2E smoke: the real build (sim + render + ui) driven through a whole run with real pointer input.
// Phone (844×390 @3x, touch) and desktop (1280×720, mouse) projects — see playwright.config.ts.
// Phone screenshots go to docs/screenshots/*.png for the game designer; desktop ones to the test output dir.

import { expect, test, type BrowserContext, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import type { DebugAction, Vec2 } from '../../src/types';
import type { AppPhase } from '../../src/ui/app';
import { getCharacter } from '../../src/data';
import { basicSummary, secs, skillSummary } from '../../src/ui/skillinfo';

const SHOT_DIR = 'docs/screenshots';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
declare function visibleFoes(): number;

interface Input {
  tap(p: Vec2): Promise<void>;
  /** Press at `from`, slide to `to` and keep holding. Resolves to release(). */
  dragHold(from: Vec2, to: Vec2): Promise<() => Promise<void>>;
}

/** Real input: CDP touch events on the phone (pointerType 'touch' + pointer capture path), the mouse on desktop. */
async function makeInput(page: Page, context: BrowserContext, touch: boolean): Promise<Input> {
  const cdp: CDPSession | null = touch ? await context.newCDPSession(page) : null;
  const touchAt = (type: 'touchStart' | 'touchMove', p: Vec2) =>
    cdp!.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  return {
    async tap(p) {
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    },
    async dragHold(from, to) {
      const steps = 14;
      if (cdp) {
        await touchAt('touchStart', from);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await touchAt('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
          await sleep(16);
        }
        return async () => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
      }
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps });
      return async () => {
        await page.mouse.up();
      };
    },
  };
}

async function center(page: Page, selector: string): Promise<Vec2> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const phase = (page: Page) => page.evaluate(() => window.__proto!.phase);

async function waitPhase(page: Page, want: AppPhase, timeout = 15_000): Promise<void> {
  await page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}

/** Runs `fn` in the page with the live game (throws if no run). */
function inGame<T, A = undefined>(page: Page, fn: (g: NonNullable<NonNullable<Window['__proto']>['game']>, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(
    ([src, a]) => {
      const g = window.__proto!.game;
      if (!g) throw new Error('no game');
      // eslint-disable-next-line no-new-func
      return new Function('g', 'a', `return (${src})(g, a);`)(g, a) as T;
    },
    [fn.toString(), arg] as const,
  );
}

const debug = (page: Page, action: DebugAction) => page.evaluate(a => window.__proto!.game!.dispatch({ type: 'debug', action: a }), action);

/**
 * A finger position (client px) whose drop point lands on/near enemies and is a valid field drop:
 * the finger itself must be over the bare canvas (not a HUD block). Nearest enemy to my character first.
 */
async function fieldFinger(page: Page): Promise<Vec2> {
  return page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const me = s.players[0];
    const canvas = document.querySelector('canvas.stage-canvas');
    const mine = me.activeIndex != null ? s.entities.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
    const from = mine?.pos ?? { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 };
    const foes = s.entities
      .filter(e => e.team === 'enemy' && e.hp > 0 && e.tier !== 'boss')
      .sort((a, b) => Math.hypot(a.pos.x - from.x, a.pos.y - from.y) - Math.hypot(b.pos.x - from.x, b.pos.y - from.y));
    const candidates = [...foes.map(f => f.pos), { x: from.x + 1.5, y: from.y - 1 }, { x: from.x, y: from.y - 2 }, from];
    for (const w of candidates) {
      const f = api.ui.fingerFor(w);
      const hit = document.elementFromPoint(f.x, f.y);
      if (hit === canvas && f.x > 40 && f.x < window.innerWidth - 40) return f;
    }
    throw new Error('no valid drop point on the field');
  });
}

async function canvasStats(page: Page): Promise<{ w: number; h: number; lit: number; colors: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set<number>();
    let lit = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 61) {
      n++;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r + g + b > 90) lit++;
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
    return { w: c.width, h: c.height, lit: lit / n, colors: colors.size };
  });
}

/**
 * 괴담 방 layout check (기획 6장: no scroll at 1280×720 logical): every block of the room screen inside the stage, the right
 * column not overflowing, option texts not clipped, nothing in the left and right columns overlapping. Returns problems.
 */
function goedamLayoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const stage = document.querySelector('.stage')!.getBoundingClientRect();
    const k = stage.width / 1280;
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const blocks = [...document.querySelectorAll('.goedam .gd-strip > *, .goedam .gd-left > *, .goedam .gd-head > *, .goedam .gd-opt, .goedam .gd-card > *, .goedam .gd-line > *')].filter(visible);
    for (const el of blocks) {
      const b = el.getBoundingClientRect();
      const name = `${el.className} "${(el.textContent ?? '').slice(0, 16)}"`;
      if (b.left < stage.left - 1 || b.right > stage.right + 1 || b.top < stage.top - 1 || b.bottom > stage.bottom - 6 * k) out.push(`outside the stage: ${name}`);
    }
    for (const el of [...document.querySelectorAll('.goedam .gd-right, .goedam .gd-opt, .goedam .gd-line, .goedam .gd-card')].filter(visible)) {
      const h = el as HTMLElement;
      if (h.scrollHeight > h.clientHeight + 2 || h.scrollWidth > h.clientWidth + 2) out.push(`overflows: ${h.className}`);
    }
    const left = document.querySelector('.goedam .gd-left')!.getBoundingClientRect();
    const right = document.querySelector('.goedam .gd-right')!.getBoundingClientRect();
    if (left.right > right.left + 1) out.push('columns overlap');
    return out;
  });
}

test('full run: preset → combat → drag/pet/ult → reward → boss (enrage, retreat) → relic → quit → result', async ({ page, context }, testInfo: TestInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const shot = async (name: string) => {
    const path = phone ? `${SHOT_DIR}/${name}.png` : testInfo.outputPath(`${testInfo.project.name}-${name}.png`);
    await page.screenshot({ path });
  };
  const extraShot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`) });
  const input = await makeInput(page, context, phone);
  // in-page helper: enemies currently on screen (stage area)
  await page.addInitScript(() => {
    (window as unknown as { visibleFoes: () => number }).visibleFoes = () => {
      const api = window.__proto;
      const g = api?.game;
      const stage = document.querySelector('.stage');
      if (!api || !g || !stage) return 0;
      const r = stage.getBoundingClientRect();
      return g.state.entities.filter(e => {
        if (e.team !== 'enemy' || e.hp <= 0) return false;
        const f = api.ui.fingerFor(e.pos);
        return f.x > r.left + 30 && f.x < r.right - 30;
      }).length;
    };
  });

  // ── 프리셋 ──
  await page.goto('/');
  await waitPhase(page, 'preset');
  await expect(page.locator('.preset')).toBeVisible();
  await expect(page.locator('.ps-char.is-picked')).toHaveCount(3);
  await expect(page.locator('.ps-pet.is-picked')).toHaveCount(3);
  await sleep(300);
  await shot('preset');
  await input.tap(await center(page, '.btn-start'));
  await waitPhase(page, 'combat');
  const startSetup = await inGame(page, g => ({ chars: g.state.players[0].party.map(m => m.defId), pets: g.state.players[0].pets.map(p => p.defId), players: g.state.players.length }));
  expect(startSetup.players).toBe(3);
  expect(startSetup.chars).toHaveLength(3);
  expect(startSetup.pets).toHaveLength(3);
  // same preset, fixed seed → reproducible waves for the rest of the test
  await page.evaluate(() => window.__proto!.startRun({ seed: 20261004 }));
  await waitPhase(page, 'combat');
  expect(await inGame(page, g => g.state.players[0].activeIndex)).toBe(0);

  // ── 전투: wait for real play (a wave on screen around my character), canvas must be drawing ──
  await page
    .waitForFunction(min => visibleFoes() >= min, 5, { timeout: 30_000 })
    .catch(() => page.waitForFunction(min => visibleFoes() >= min, 3, { timeout: 15_000 }));
  const floorInfo = await inGame(page, g => ({ t: g.state.floorTime, alive: g.state.monstersAlive, phase: g.state.phase }));
  expect(floorInfo.phase).toBe('combat');
  expect(floorInfo.alive).toBeGreaterThanOrEqual(3);
  const px = await canvasStats(page);
  expect(px.w).toBeGreaterThanOrEqual(1280);
  expect(px.lit).toBeGreaterThan(0.25);
  expect(px.colors).toBeGreaterThan(60);
  await expect(page.locator('.ccard')).toHaveCount(3);
  await expect(page.locator('.ccard.is-active')).toHaveCount(1);
  await expect(page.locator('.pcard')).toHaveCount(3);
  await expect(page.locator('.timer-val')).toHaveText(/^\d\d:\d\d$/);
  await shot('combat');

  // ── 교체: real drag from card 2 onto the field ──
  const finger = await fieldFinger(page);
  const release = await input.dragHold(await center(page, '.ccard[data-idx="1"]'), finger);
  await sleep(250);
  await expect(page.locator('.drag-ghost')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('.drag-ghost')).not.toHaveClass(/is-invalid/);
  expect(await inGame(page, g => g.state.players[0].activeIndex)).toBe(0); // nothing happens until release
  await shot('drag');
  await release();
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].activeIndex === 1, undefined, { timeout: 3000 });
  const afterSwap = await inGame(page, g => {
    const me = g.state.players[0];
    return { swaps: me.stats.swaps, leftCd: me.party[0].swapCooldownRemaining, fieldCd: me.party[1].swapCooldownRemaining, active: me.activeIndex };
  });
  expect(afterSwap.active).toBe(1);
  expect(afterSwap.swaps).toBe(1);
  // 기획 6차: the card that left starts cooling, the one that came in has none
  expect(afterSwap.leftCd).toBeGreaterThan(5);
  expect(afterSwap.fieldCd).toBe(0);
  await expect(page.locator('.ccard[data-idx="1"]')).toHaveClass(/is-active/);
  await expect(page.locator('.ccard[data-idx="0"]')).toHaveClass(/is-cool/);
  // 기획 9차: the drag (= re-appear) cooldown is the big number on the portrait only — no badge, no seconds in the label
  await expect(page.locator('.ccard[data-idx="0"] .cc-count')).toHaveText(/^\d+$/);
  await expect(page.locator('.ccard[data-idx="0"] .cc-state')).toHaveText('쿨타임');
  await expect(page.locator('.ccard .cc-drag')).toHaveCount(0);

  // ── 쿨타임이 보임: each card's auto-skill diamond (목업의 마름모: lit = ready, else small seconds), no separate widget;
  //    drag (= re-appear) cooldowns on the cards ──
  await expect(page.locator('.nskill')).toHaveCount(0);
  await expect(page.locator('.ccard .cc-norm')).toHaveCount(3);
  await inGame(page, g => {
    const p = g.state.players[0].party;
    p[0].normalCooldownRemaining = 0; // benched: stays ready
    p[2].normalCooldownRemaining = 7.25; // benched: counts down (bench timers run)
  });
  await expect(page.locator('.ccard[data-idx="0"] .cc-norm')).toHaveClass(/is-ready/);
  await expect(page.locator('.ccard[data-idx="0"] .cc-norm-t')).toHaveText('');
  await expect(page.locator('.ccard[data-idx="2"] .cc-norm')).toHaveClass(/is-cool/);
  // whole seconds while ≥ 3 s ("8" … "4"), one decimal for the last 3 s (skillinfo cdText)
  await expect(page.locator('.ccard[data-idx="2"] .cc-norm-t')).toHaveText(/^[4-8]$/);
  // field card, ready but stunned (it cannot go off): still lit, dimmed = waiting
  await inGame(page, g => {
    const me = g.state.players[0];
    me.party[1].normalCooldownRemaining = 0;
    const e = g.state.entities.find(x => x.id === me.party[1].entityId)!;
    e.statuses.push({ id: 'stun', remaining: 1.5, total: 1.5, value: 0, sourcePlayer: null });
  });
  await expect(page.locator('.ccard[data-idx="1"] .cc-norm')).toHaveClass(/is-ready.*is-waiting|is-waiting.*is-ready/);
  await expect(page.locator('.ccard[data-idx="0"] .cc-norm')).not.toHaveClass(/is-waiting/); // bench: just ready
  // the hover help sits on the card (the diamond lets pointers through, so a title there could never show)
  const normName = getCharacter(await inGame(page, g => g.state.players[0].party[1].defId)).normal.name;
  expect(await page.locator('.ccard[data-idx="1"]').getAttribute('title')).toContain(`일반스킬 ${normName} 쿨`);
  expect(await page.locator('.ccard[data-idx="1"] .cc-norm').getAttribute('title')).toBeNull();
  // the "i" (tap → skill sheet) only on the field character's card
  await expect(page.locator('.ccard[data-idx="1"] .cc-info')).toBeVisible();
  await expect(page.locator('.ccard[data-idx="0"] .cc-info')).toBeHidden();
  // small, and clear of the card number, countdown, name, HP bar and label (diamond = |dx| + |dy| ≤ r)
  const clash = await page.evaluate(() =>
    [...document.querySelectorAll('.ccard')].flatMap(card => {
      const d = card.querySelector('.cc-norm')!.getBoundingClientRect();
      const cx = d.left + d.width / 2;
      const cy = d.top + d.height / 2;
      const r = d.width / 2;
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      const out: string[] = [];
      if (d.width / (stage.width / 1280) > 40) out.push(`${(card as HTMLElement).dataset.idx}: diamond ${d.width.toFixed(1)} px is not small`);
      for (const sel of ['.cc-slot', '.cc-count', '.cc-name', '.cc-hp', '.cc-state', '.cc-info']) {
        const el = card.querySelector(sel) as HTMLElement | null;
        if (!el || el.offsetParent === null) continue;
        const b = el.getBoundingClientRect();
        const dx = Math.max(b.left - cx, 0, cx - b.right);
        const dy = Math.max(b.top - cy, 0, cy - b.bottom);
        if (dx + dy < r - 0.5) out.push(`${(card as HTMLElement).dataset.idx}: diamond overlaps ${sel}`);
      }
      return out;
    }),
  );
  expect(clash).toEqual([]);
  for (let i = 0; i < 3; i++) {
    const st = await inGame(page, (g, idx) => {
      const me = g.state.players[0];
      const m = me.party[idx as number];
      return { active: me.activeIndex === idx, cd: m.swapCooldownRemaining, dead: m.dead };
    }, i);
    if (!st.active && !st.dead && st.cd > 0.3) {
      await expect(page.locator(`.ccard[data-idx="${i}"] .cc-state`)).toHaveText('쿨타임');
      await expect(page.locator(`.ccard[data-idx="${i}"] .cc-count`)).toHaveText(/^\d+$/);
    }
  }
  await expect(page.locator('.ult-sub')).toHaveText(/(\d+초 후|궁극기 준비)$/);
  // tap the field character's card → compact skill sheet over the field (never blocks it), tap again → closed
  await input.tap(await center(page, '.ccard[data-idx="1"]'));
  await expect(page.locator('.skill-sheet')).toBeVisible();
  await expect(page.locator('.skill-sheet .ss-row')).toHaveCount(5);
  await expect(page.locator('.skill-sheet .ss-type')).toHaveText(['평타', '패시브', '일반', '드래그', '궁극기']);
  // the sheet quotes the (retuned) data, not a copy of it: effect lines = skillSummary(data), drag cooldown = swapCooldown
  const sheetDef = getCharacter(await inGame(page, g => g.state.players[0].party[1].defId));
  await expect(page.locator('.skill-sheet .ss-sum')).toHaveText([
    basicSummary(sheetDef.basic),
    sheetDef.passive.description,
    skillSummary(sheetDef.normal),
    skillSummary(sheetDef.drag),
    skillSummary(sheetDef.ult),
  ]);
  await expect(page.locator('.skill-sheet .ss-drag .ss-trigger')).toHaveText(`등장 시 · 나가면 쿨 ${secs(sheetDef.swapCooldown)}초`);
  await expect(page.locator('.skill-sheet .ss-normal .ss-trigger')).toHaveText(`${secs(sheetDef.normal.cooldown ?? 6)}초마다 자동`);
  const sheetBox = (await page.locator('.skill-sheet').boundingBox())!;
  const stageBox = (await page.locator('.stage').boundingBox())!;
  expect(sheetBox.x).toBeGreaterThanOrEqual(stageBox.x - 1);
  expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
  expect(await page.locator('.skill-sheet').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await sleep(250);
  await shot('skills');
  await input.tap(await center(page, '.ccard[data-idx="1"]'));
  await expect(page.locator('.skill-sheet')).toBeHidden();
  // long-press a card that is re-appearing (cooldown): the sheet opens, no "재등장 대기" refusal / shake on the press;
  // a plain tap on it still says why it can't be used
  await inGame(page, g => {
    const m = g.state.players[0].party[2];
    m.swapCooldownTotal = 9;
    m.swapCooldownRemaining = 8;
  });
  await sleep(100);
  const c2 = await center(page, '.ccard[data-idx="2"]');
  const holdRelease = await input.dragHold(c2, c2);
  await sleep(650);
  await expect(page.locator('.skill-sheet')).toBeVisible();
  const refusal = page.locator('.toasts-hud .toast-warn', { hasText: '재등장 대기' });
  await expect(refusal).toHaveCount(0);
  await holdRelease();
  await sleep(150);
  await expect(refusal).toHaveCount(0);
  await expect(page.locator('.ccard[data-idx="2"]')).not.toHaveClass(/shake/);
  await input.tap(c2);
  await expect(refusal).toHaveCount(1);
  await input.tap(await center(page, '.ccard[data-idx="1"]'));
  await input.tap(await center(page, '.ccard[data-idx="1"]'));
  await expect(page.locator('.skill-sheet')).toBeHidden();

  // ── 펫: real drag of pet card 1 onto the field (not a swap) ──
  await sleep(200);
  const petRelease = await input.dragHold(await center(page, '.pcard >> nth=0'), await fieldFinger(page));
  await sleep(200);
  await expect(page.locator('.drag-ghost')).not.toHaveClass(/is-invalid/);
  await petRelease();
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].pets[0].cooldownRemaining > 0, undefined, { timeout: 3000 });
  const afterPet = await inGame(page, g => ({ used: g.state.players[0].stats.petsUsed, active: g.state.players[0].activeIndex }));
  expect(afterPet).toEqual({ used: 1, active: 1 });

  // ── 궁극기: debug charge, then tap the gauge ──
  expect((await debug(page, { kind: 'chargeUlt' })).ok).toBe(true);
  await expect(page.locator('.ult')).toHaveClass(/is-full/);
  await input.tap(await center(page, '.ult'));
  await page.waitForFunction(() => window.__proto!.game!.state.players[0].stats.ultsUsed === 1, undefined, { timeout: 3000 });
  expect(await inGame(page, g => g.state.players[0].ult.charge)).toBeLessThan(0.1);
  await sleep(350);
  await shot('ult');

  // ── 1층 클리어: high game speed + 적 전멸 until the reward overlay (기획 10차: a 괴담 room forced after it) ──
  expect((await debug(page, { kind: 'goedamNext', room: 'elevator_whisper' })).ok).toBe(true);
  await inGame(page, g => {
    g.tunables.invincible = true;
    g.tunables.gameSpeed = 6;
  });
  for (let i = 0; i < 200 && (await phase(page)) === 'combat'; i++) {
    await debug(page, { kind: 'killAll' });
    await sleep(150);
  }
  await waitPhase(page, 'reward');
  await inGame(page, g => {
    g.tunables.gameSpeed = 1;
  });
  const offers = await inGame(page, g => g.state.rewardOffers!.map(o => ({ relic: o.isRelic, name: o.name })));
  expect(offers).toHaveLength(3);
  expect(offers.every(o => !o.relic)).toBe(true);
  await expect(page.locator('.rw-card')).toHaveCount(3);
  await sleep(400);
  await shot('reward');
  const card = await center(page, '.rw-card >> nth=1');
  await input.tap(card);
  // a double-tap on the card must not pick the 괴담 option that opens under the finger on the same tick (ARM_MS)
  await sleep(200);
  await input.tap(card);

  // ── 괴담 방: reward → room → pick → result card → 계속 → floor 2 ──
  await waitPhase(page, 'goedam');
  expect(await inGame(page, g => g.state.goedam!.players[0].stage)).toBe('choosing');
  await expect(page.locator('.goedam')).toBeVisible();
  await expect(page.locator('.hud')).toHaveClass(/is-covered/);
  await expect(page.locator('.gd-floor')).toHaveText(/1½층.*로비·상가층/);
  await expect(page.locator('.gd-name')).toHaveText('엘리베이터 속삭임');
  await expect(page.locator('.gd-note')).toContainText('돌아보지 마');
  expect(await page.locator('.gd-opt').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.option))).toEqual(['ride', 'look_back', 'leave']);
  await expect(page.locator('.gd-opt[data-option="look_back"] .gd-line.has-bar')).toHaveCount(2);
  await expect(page.locator('.gd-opt[data-option="look_back"] .gd-tag')).toHaveText(['도박']);
  await sleep(500);
  expect(await goedamLayoutProblems(page)).toEqual([]);
  await shot('goedam');
  await input.tap(await center(page, '.gd-opt[data-option="ride"]'));
  await expect(page.locator('.gd-opt[data-option="ride"]')).toHaveClass(/is-picked/);
  await expect(page.locator('.gd-card')).toBeVisible();
  await expect(page.locator('.gd-card-title')).toHaveText('문이 열린다. 누군가 같이 내린다');
  await expect(page.locator('.gd-card .gd-trace')).toContainText('동승자');
  const cont = (await page.locator('.gd-continue').boundingBox())!;
  const scale = (await page.locator('.stage').boundingBox())!.width / 1280;
  expect(cont.height / scale).toBeGreaterThanOrEqual(79.5);
  expect(cont.width / scale).toBeGreaterThanOrEqual(239.5);
  await sleep(1300);
  expect(await goedamLayoutProblems(page)).toEqual([]);
  await shot('goedam-result');
  await input.tap(await center(page, '.gd-continue'));
  await waitPhase(page, 'combat');
  await expect(page.locator('.goedam')).toBeHidden();
  // 흔적 chip at the top (icon + floors left), the floor banner's trace line, then the pause list
  await expect(page.locator('.hud-trace[data-trace="passenger"]')).toHaveText('👤1');
  await expect(page.locator('.banner-trace')).toContainText('동승자가 따라 내렸다 — 받는 피해 +12%');
  const chip = (await page.locator('.hud-trace').first().boundingBox())!;
  expect(chip.height / scale).toBeGreaterThanOrEqual(30);
  await sleep(300);
  await extraShot('goedam-hud');
  await input.tap(await center(page, '.hud-tr .icon-btn[aria-label="일시정지"]'));
  await expect(page.locator('.pause-lists .pl-trace')).toContainText(['동승자']);
  await expect(page.locator('.pause-lists .pl-trace .pl-left')).toHaveText(['1층']);
  await extraShot('goedam-pause');
  await input.tap(await center(page, '.pause-btns .btn-primary'));
  expect(await page.evaluate(() => window.__proto!.paused)).toBe(false);
  const floor2 = await inGame(page, g => ({ floor: g.state.floor, rewards: g.state.players[0].rewards.length, times: g.telemetry().floorTimes }));
  expect(floor2.floor).toBe(2);
  expect(floor2.rewards).toBe(1);
  expect(floor2.times[0]).toMatchObject({ floor: 1, outcome: 'clear' });

  // ── 5층 보스: jump, let the boss act, force 광폭화 ──
  expect((await debug(page, { kind: 'jumpFloor', floor: 5 })).ok).toBe(true);
  await inGame(page, g => {
    g.tunables.invincible = false;
  });
  const boss0 = await inGame(page, g => ({ kind: g.state.plan.kind, floor: g.state.floor, boss: g.state.bossId != null }));
  expect(boss0).toEqual({ kind: 'boss', floor: 5, boss: true });
  await expect(page.locator('.boss')).toBeVisible();
  // forcing 광폭화 before the first 권속 소환 (6 s) brings it forward and makes it summon ×1.5
  await page.waitForFunction(() => window.__proto!.game!.state.floorTime >= 3, undefined, { timeout: 30_000 });
  // keep my field occupied for the screenshot (if my character fell, drop another one in)
  await page.evaluate(() => {
    const api = window.__proto!;
    const me = api.game!.state.players[0];
    if (me.activeIndex == null) {
      const idx = me.party.findIndex(m => !m.dead);
      if (idx >= 0) {
        api.game!.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
        api.ui.dragTo('swap', idx, { x: 12, y: 7 });
      }
    }
  });
  expect((await debug(page, { kind: 'forceEnrage' })).ok).toBe(true);
  expect(await inGame(page, g => g.state.bossEnraged)).toBe(true);
  await expect(page.locator('.boss-enrage')).toBeVisible();
  await expect(page.locator('.timer-val')).toHaveText('광폭화');
  // let the banner pass, then catch the summoned 권속 together with a telegraphed boss attack
  await sleep(2400);
  const bossScene = (minAdds: number, telegraph: boolean) =>
    page.waitForFunction(
      ([n, tg]) => {
        const s = window.__proto!.game!.state;
        const adds = s.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss' && e.hp > 0).length;
        return adds >= n && (!tg || s.telegraphs.some(t => t.team === 'enemy'));
      },
      [minAdds, telegraph] as const,
      { timeout: 6000 },
    );
  await bossScene(3, true).catch(() => bossScene(1, false).catch(() => undefined));
  await shot('boss');

  // ── 보스 처치 (debug): bots hit ×5000 → HP 0 → 퇴각 → relic offers ──
  await inGame(page, g => {
    g.tunables.botDamageMult = 5000;
    g.tunables.invincible = true;
  });
  await debug(page, { kind: 'killAll' });
  await page.waitForFunction(() => window.__proto!.phase === 'reward', undefined, { timeout: 30_000 });
  const relicOffers = await inGame(page, g => ({ floor: g.state.floor, offers: g.state.rewardOffers!.map(o => o.isRelic), times: g.telemetry().floorTimes }));
  expect(relicOffers.floor).toBe(5);
  expect(relicOffers.offers).toEqual([true, true, true]);
  expect(relicOffers.times.at(-1)).toMatchObject({ floor: 5, outcome: 'clear' });
  await expect(page.locator('.rw-relic')).toHaveCount(3);
  await inGame(page, g => {
    g.tunables.botDamageMult = 1;
    g.tunables.invincible = false;
  });
  await sleep(400);
  await shot('relic');
  await input.tap(await center(page, '.rw-card >> nth=0'));
  await waitPhase(page, 'combat');
  const floor6 = await inGame(page, g => ({ floor: g.state.floor, relics: g.state.players[0].relics.length, traces: g.state.players[0].goedamTraces.length }));
  expect(floor6).toEqual({ floor: 6, relics: 1, traces: 0 });
  // the 동승자 trace ran out at the boss clear (under the relic screen): its toast shows once the field is back
  await expect(page.locator('.toasts-hud .toast', { hasText: '동승자가 풀렸다' })).toHaveCount(1);
  await expect(page.locator('.hud-traces')).toBeHidden();

  // ── 포기 → 결과 ──
  await sleep(1500);
  await input.tap(await center(page, '.hud-tr .icon-btn[aria-label="일시정지"]'));
  await expect(page.locator('.pause')).toBeVisible();
  expect(await page.evaluate(() => window.__proto!.paused)).toBe(true);
  await input.tap(await center(page, '.pause-btns .btn-danger'));
  await expect(page.locator('.pause-btns .btn-danger')).toContainText('한 번 더');
  await input.tap(await center(page, '.pause-btns .btn-danger'));
  await waitPhase(page, 'result', 10_000);
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.locator('.rs-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.rs-goedam-row')).toHaveText(['1½층 엘리베이터 속삭임 — 끝까지 탔다 (동승자)']);
  const rr = await inGame(page, g => g.state.runResult);
  expect(rr).toMatchObject({ outcome: 'defeat', reason: 'quit', floorReached: 6 });
  await sleep(400);
  await shot('result');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('괴담 방: all 12 rooms and a result card each fit the stage without scrolling', async ({ page }, testInfo: TestInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/');
  await waitPhase(page, 'preset');
  await page.evaluate(() => window.__proto!.startRun({ seed: 7, tunables: { invincible: true, goedamRoomsPerZone: 0 } }));
  await waitPhase(page, 'combat');
  // a floor of each room's zone (cursed_relic: any floor 6–19)
  const ROOMS: [string, number][] = [
    ['broken_vending', 2], ['elevator_whisper', 4], ['ringing_phone', 3], ['overtime_roster', 7], ['copier', 8], ['endless_corridor', 9],
    ['red_blue_paper', 12], ['night_rounds', 13], ['iv_drip', 14], ['sky_eye', 17], ['red_mask', 18], ['cursed_relic', 11],
  ];
  const problems: string[] = [];
  for (const [room, floor] of ROOMS) {
    await page.evaluate(
      ([r, f]) => {
        const g = window.__proto!.game!;
        g.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: f as number } });
        g.dispatch({ type: 'debug', action: { kind: 'goedamNext', room: r as string } });
        g.dispatch({ type: 'debug', action: { kind: 'skipFloor' } });
        g.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      },
      [room, floor] as const,
    );
    await waitPhase(page, 'goedam');
    await expect(page.locator('.gd-opt').first()).toBeVisible();
    await sleep(450);
    problems.push(...(await goedamLayoutProblems(page)).map(p => `${room}: ${p}`));
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-room-${room}.png`) });
    // the boldest option (first one offered), then the card
    await page.locator('.gd-opt').first().click();
    await expect(page.locator('.gd-card')).toBeVisible();
    await sleep(900);
    problems.push(...(await goedamLayoutProblems(page)).map(p => `${room} (result): ${p}`));
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-room-${room}-result.png`) });
    await page.locator('.gd-continue').click();
    await waitPhase(page, 'combat');
  }
  expect(problems).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('돌발 괴담: the fleeing toad — banner + pill + gold ring, a real drop next to it locks on, the party reward shows', async ({ page, context }, testInfo: TestInfo) => {
  const phone = testInfo.project.name === 'phone';
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  const shot = (name: string) => page.screenshot({ path: phone ? `${SHOT_DIR}/${name}.png` : testInfo.outputPath(`${testInfo.project.name}-${name}.png`) });
  const input = await makeInput(page, context, phone);
  await page.goto('/');
  await waitPhase(page, 'preset');
  // floor 2 (the toad's floor); the scheduled events off so only the forced one runs
  await page.evaluate(() => window.__proto!.startRun({ seed: 12, startFloor: 2, tunables: { invincible: true, goedamRoomsPerZone: 0, fieldEventChance: 0 } }));
  await waitPhase(page, 'combat');
  await sleep(2500);
  expect((await debug(page, { kind: 'fieldEventNext', id: 'lucky_toad' })).ok).toBe(true);
  // warning: the pill names it; then it starts with the low banner (goal + reward generated from the numbers)
  await expect(page.locator('.fe-pill')).toBeVisible();
  await expect(page.locator('.fe-pill .fe-prog')).toHaveText('도망치는 금두꺼비');
  await page.waitForFunction(() => window.__proto!.game!.state.fieldEvent?.stage === 'active', undefined, { timeout: 4000 });
  await expect(page.locator('.banner-event .banner-big')).toContainText('도망치는 금두꺼비');
  await expect(page.locator('.banner-event .banner-sub')).toHaveText('18초 안에 잡으면 모두 궁극기 게이지 +40%');
  await sleep(250);
  await shot('combat-event'); // the banner is still up for a moment: banner + pill + the toad's gold ring
  await expect(page.locator('.fe-pill .fe-reward')).toHaveText('궁극기+40%');
  await expect(page.locator('.fe-pill .fe-secs')).toHaveText(/^1\d$/);
  // the pill sits under the floor box and above the field
  const pill = (await page.locator('.fe-pill').boundingBox())!;
  const stage = (await page.locator('.stage').boundingBox())!;
  expect((pill.y + pill.height - stage.y) / (stage.width / 1280)).toBeLessThan(150);

  // a real drag: the next ready card dropped right next to the toad → the character that appears locks onto it
  const ult0 = await inGame(page, g => g.state.players.map(p => p.ult.charge));
  const plan = await page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const toad = s.entities.find(e => e.id === s.fieldEvent!.entityIds[0])!;
    const me = s.players[0];
    const idx = [0, 1, 2].find(i => i !== me.activeIndex && api.game!.canSwap(0, i).ok)!;
    return { idx, finger: api.ui.fingerFor({ x: toad.pos.x - 1, y: toad.pos.y }), toad: toad.id };
  });
  const release = await input.dragHold(await center(page, `.ccard[data-idx="${plan.idx}"]`), plan.finger);
  await sleep(250);
  await release();
  await page.waitForFunction(i => window.__proto!.game!.state.players[0].activeIndex === i, plan.idx, { timeout: 3000 });
  const locked = await inGame(page, (g, a) => {
    const me = g.state.players[0];
    const e = g.state.entities.find(x => x.id === me.party[me.activeIndex!].entityId);
    return e?.targetId === a || !g.state.fieldEvent;
  }, plan.toad);
  expect(locked).toBe(true);
  // the party (two bots + my locked character) catches it within the 18 s
  await page.waitForFunction(() => window.__proto!.game!.state.fieldEvent === null, undefined, { timeout: 25_000 });
  const done = await inGame(page, g => ({ ok: g.telemetry(0).fieldEvents?.at(-1)?.success, ult: g.state.players.map(p => p.ult.charge) }));
  expect(done.ok).toBe(true);
  // my gauge (a human never fires it by itself; the bots may spend theirs at once)
  expect(done.ult[0]).toBeGreaterThanOrEqual(Math.min(1, ult0[0] + 0.4) - 1e-6);
  await expect(page.locator('.ult')).toHaveClass(/is-fe-reward/);
  await expect(page.locator('.toast').filter({ hasText: '금두꺼비를 잡았다! 모두 궁극기 게이지 +40%' })).toHaveCount(1);
  await sleep(200);
  await shot('combat-event-success');

  // 비상등 on a fresh floor: the lamp off my screen gets a gold edge arrow with its icon
  await debug(page, { kind: 'jumpFloor', floor: 13 });
  await sleep(1200);
  expect((await debug(page, { kind: 'fieldEventNext', id: 'dark_lamps' })).ok).toBe(true);
  await page.waitForFunction(() => window.__proto!.game!.state.fieldEvent?.stage === 'active', undefined, { timeout: 4000 });
  await sleep(300);
  await expect(page.locator('.fe-pill .fe-reward')).toHaveText('적 취약');
  await shot('combat-event-lamps');
  expect(errors, errors.join('\n')).toEqual([]);
});
