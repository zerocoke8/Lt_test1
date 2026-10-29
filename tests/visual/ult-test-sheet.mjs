// 기획 22차 궁극기 테스트 (docs/ult-test.md): every character's 조준 / 드래그 ult as the PLAYER sees it on a phone
// (844×390) — the real game, a real finger on the ult button (CDP touch events, like tests/e2e/ult-test.spec.ts).
// Per character and mode: open /?mode=ultTest&ult=<mode>&chars=<char>,<a>,<b>&boss=<boss> → start the solo run
// (invincible party) → 「궁극기 충전」 (debug) → hold the ult button and drag it onto the field → picture of the live
// preview while the finger is still down → release → pictures after the release (game time).
// 기획 23차 (docs/ult-fx.md 5-2): the pictures of a row follow its ult's beats (src/data/ultTest/beats.ts, read from the
// dev server's own module): 0.25 s (the touchdown · 착지 컷) → 0.5 s (the first hit) → finisher + 0.05 s (the frozen
// blow) → finisher + 0.8 s (the floor mark), so rows may differ; each tile says its time. times= sets one list for
// every row (e.g. times=0.1,0.6,1.3); a server without the source modules (a build) falls back to 0.25,0.5,1.35,2.1.
// One row a character: [preview | 0.25 s | 0.5 s | finisher + 0.05 s | finisher + 0.8 s]; five characters a file:
//   docs/screenshots/ult-test-sheet-aim.png (가디언 … 버서커), -aim-2.png (섀도우 … 클레릭), -aim-3.png (메딕 … 퍼펫티어),
//   and the same for drag. A red frame = the cast did not happen / the preview was not "놓으면 …" / the dragged
// character did not land where the preview said. The console prints one line a shot (preview numbers vs the cast).
//
//   node tests/visual/ult-test-sheet.mjs                                  → its own Vite dev server, all 15 × 2
//   node tests/visual/ult-test-sheet.mjs url=http://localhost:4502/       → a running server (e.g. vite preview of a build)
//   node tests/visual/ult-test-sheet.mjs only=mage,blade modes=aim boss=karaoke_room scale=0.6 raw=<dir>
//
// Options: only= (character ids), modes= (aim,drag), boss= (default elevator_keeper: fixed, top centre), point=x,y (the
// aimed world point; default = just in front of the boss, a little to the right), out= (folder, default
// docs/screenshots), per= (characters a file, default 5), scale= (tile = phone × this, default 0.6), raw= (also keep
// every full-size picture there), times= (seconds after the release, default: from the beats, see above), banner=1 (keep
// the floor-start banner, hidden by default because it covers the preview), port= (own dev server port).
// The landing check (red frame) is taken 0.15 s after the release: a 드래그 must stand at the preview's landing spot, or
// at the end of the last dash the preview drew (a part that rushes on).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { VIEW, parseArgs, writeSheet } from './bossLive.mjs';

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const args = parseArgs(process.argv);
const OUT_DIR = args.out ?? 'docs/screenshots';
const BOSS = args.boss ?? 'elevator_keeper';
const MODES = (args.modes ?? 'aim,drag').split(',');
const PER = Number(args.per ?? 5);
const SCALE = Number(args.scale ?? 0.6);
const RAW = args.raw ?? null;
const POINT = args.point ? args.point.split(',').map(Number) : null;
/** times= (one list for every row) or null = each row from its ult's beats. */
const TIMES = args.times ? args.times.split(',').map(Number) : null;
/** No beats to read (a build without the source modules): these. */
const FALLBACK_TIMES = [0.25, 0.5, 1.35, 2.1];
/** 기획 23차: the row's pictures (s after the release) and what each shows. */
const BEAT_SHOTS = [
  { at: () => 0.25, label: () => '0.25초 (착지 · 착지 컷)' },
  { at: () => 0.5, label: () => '0.5초 (첫 타)' },
  { at: f => f + 0.05, label: f => `마무리 ${f}+0.05초 (멈춘 쾅)` },
  { at: f => f + 0.8, label: f => `마무리 ${f}+0.8초 (여운)` },
];
const PER_ROW = 1 + (TIMES ? TIMES.length : BEAT_SHOTS.length);

/** Roster order (src/data/characters.ts). */
const CHARS = [
  ['guardian', '가디언'],
  ['paladin', '팔라딘'],
  ['warden', '워든'],
  ['blade', '블레이드'],
  ['berserker', '버서커'],
  ['shadow', '섀도우'],
  ['ranger', '레인저'],
  ['mage', '메이지'],
  ['gunner', '거너'],
  ['cleric', '클레릭'],
  ['medic', '메딕'],
  ['exorcist', '퇴마사'],
  ['bard', '바드'],
  ['chrono', '크로노'],
  ['puppeteer', '퍼펫티어'],
];
const ONLY = args.only ? args.only.split(',') : null;
const LIST = ONLY ? CHARS.filter(([id]) => ONLY.includes(id)) : CHARS;
const MODE_LABEL = { aim: '조준', drag: '드래그' };

/** The two bench members (not the tested one). */
const bench = id => ['cleric', 'guardian', 'mage'].filter(x => x !== id).slice(0, 2);

let server = null;
let base = args.url ?? null;
if (!base) {
  server = await createServer({ server: { port: Number(args.port ?? 0) || 5198, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
if (RAW) mkdirSync(RAW, { recursive: true });

const gameTime = () => page.evaluate(() => window.__proto.game.state.time);
const waitGameTime = t => page.waitForFunction(v => window.__proto.game.state.time >= v, t, { timeout: 10000, polling: 16 });

/** One character in one mode: three pictures + what happened. */
async function shoot(id, name, mode) {
  const chars = [id, ...bench(id)].join(',');
  await page.goto(`${base}?mode=ultTest&ult=${mode}&chars=${chars}&boss=${BOSS}`);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', null, { timeout: 90000 });
  // the floor-start banner (3.2 s, top centre) would cover the preview: hidden unless banner=1
  if (args.banner !== '1') await page.addStyleTag({ content: '.banner.banner-raid { display: none !important; }' });
  await page.evaluate(() => window.__proto.startRun({ tunables: { invincible: true }, bossRaid: { hpMult: 6 } }));
  await page.waitForFunction(b => window.__proto.phase === 'combat' && window.__proto.game?.state.plan.bossId === b, BOSS, { timeout: 30000 });
  await waitGameTime((await gameTime()) + 1.4);
  // where to aim: in front of the boss (its own side), a little right; the same rule for every character
  const setup = await page.evaluate(
    ([pt]) => {
      const s = window.__proto.game.state;
      const p = s.players[0];
      const f = s.entities.find(e => e.id === p.party[p.activeIndex].entityId);
      const b = s.entities.find(e => e.id === s.bossId);
      const a = s.plan.arena;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const point = pt ? { x: pt[0], y: pt[1] } : { x: clamp(b.pos.x + 3, 2, a.width - 2), y: clamp(b.pos.y + b.radius + 3.2, 2, a.height - 2) };
      return { field: { x: f.pos.x, y: f.pos.y }, boss: { x: b.pos.x, y: b.pos.y, r: b.radius }, point, mode: p.ultMode };
    },
    [POINT],
  );
  await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } }));
  await page.waitForFunction(() => document.querySelector('.ult')?.classList.contains('is-full'), null, { timeout: 5000 });
  const btnBox = await page.locator('.ult').boundingBox();
  const btn = { x: btnBox.x + btnBox.width / 2, y: btnBox.y + btnBox.height / 2 };
  const finger = await page.evaluate(w => window.__proto.ui.fingerFor(w), setup.point);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', btn);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', { x: btn.x + ((finger.x - btn.x) * i) / steps, y: btn.y + ((finger.y - btn.y) * i) / steps });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250);
  const view = await page.evaluate(() => {
    const v = window.__proto.ui.ultAim;
    const tag = document.querySelector('.ult-aim-tag');
    const tr = tag?.getBoundingClientRect();
    const pct = document.querySelector('.ult .ult-pct')?.textContent ?? '';
    const ultName = document.querySelector('.ult-name')?.textContent ?? '';
    return {
      v,
      tag: tag && !tag.classList.contains('is-hidden') ? { text: tag.textContent, l: tr.left, r: tr.right, t: tr.top, b: tr.bottom } : null,
      pct,
      ultName,
      win: { w: innerWidth, h: innerHeight },
    };
  });
  // 기획 23차: this ult's picture times (its finisher from the beats), unless times= says otherwise
  const alt = `${id}_u${mode === 'aim' ? 'a' : 'd'}`;
  const fin = TIMES
    ? null
    : await page
        .evaluate(async a => {
          const m = await import('/src/data/ultTest/index.ts');
          return m.ultBeats(a)?.finisherAt ?? null;
        }, alt)
        .catch(() => null);
  const shots = TIMES
    ? TIMES.map(t => ({ t, label: `놓고 ${t}초` }))
    : fin == null
      ? FALLBACK_TIMES.map(t => ({ t, label: `놓고 ${t}초` }))
      : BEAT_SHOTS.map(b => ({ t: Math.round(b.at(fin) * 1000) / 1000, label: b.label(fin) }));
  const pre = await page.screenshot();
  await touch('touchEnd', null);
  await cdp.detach();
  const t0 = await gameTime();
  // the pictures (game time after the release) and, at 0.15 s, where the field character is just after the move (it
  // walks again once the cast lock ends)
  const LANDED = 0.15;
  const after = [];
  let landed = null;
  for (const t of [...new Set([...shots.map(x => x.t), LANDED])].sort((a, b) => a - b)) {
    await waitGameTime(t0 + t);
    for (const sh of shots) {
      if (sh.t !== t) continue;
      // the game runs on while the picture is taken: the console says when it really was (game time)
      const g = (await gameTime()) - t0;
      after.push({ t, label: sh.label, png: await page.screenshot(), took: [g, (await gameTime()) - t0] });
    }
    if (t === LANDED)
      landed = await page.evaluate(() => {
        const s = window.__proto.game.state;
        const p = s.players[0];
        const f = s.entities.find(e => e.id === p.party[p.activeIndex].entityId);
        return f ? { x: f.pos.x, y: f.pos.y } : null;
      });
  }
  const cast = await page.evaluate(() => window.__proto.game.state.players[0].stats.ultsUsed >= 1);

  // checks: the preview said 「놓으면 …」, the ult was cast, the dragged character is where the preview's arrow ended
  const problems = [];
  if (!view.v) problems.push('미리보기 없음');
  else if (!view.v.valid) problems.push('미리보기 invalid');
  if (!view.tag) problems.push('손가락 글자 없음');
  else if (view.tag.l < 0 || view.tag.r > view.win.w || view.tag.t < 0 || view.tag.b > view.win.h) problems.push(`글자 잘림 (${Math.round(view.tag.l)}..${Math.round(view.tag.r)} × ${Math.round(view.tag.t)}..${Math.round(view.tag.b)})`);
  if (!cast) problems.push('시전 안 됨');
  if (mode === 'drag' && view.v?.move && landed) {
    const ends = [view.v.move.to, ...view.v.parts.filter(p => p.dash).map(p => p.dash.to)];
    const d = Math.min(...ends.map(e => Math.hypot(landed.x - e.x, landed.y - e.y)));
    if (d > 0.6) problems.push(`착지 ${d.toFixed(1)}칸 어긋남`);
  }
  const parts = view.v ? view.v.parts.length : 0;
  const line =
    `${id.padEnd(9)} ${MODE_LABEL[mode]} · ${view.ultName} · 버튼 「${view.pct}」 · 글자 「${view.tag?.text ?? '-'}」 · 부분 ${parts}` +
    (view.v?.move ? ` · 이동 ${view.v.move.kind} → ${view.v.move.to.x.toFixed(1)},${view.v.move.to.y.toFixed(1)}` : '') +
    ` · 겨눈 곳 ${view.v ? `${view.v.point.x.toFixed(1)},${view.v.point.y.toFixed(1)}` : '-'} · 시작 ${setup.field.x.toFixed(1)},${setup.field.y.toFixed(1)}` +
    (fin != null ? ` · 마무리 ${fin}초` : '') +
    ` · 찍은 때 ${after.map(a => `${a.took[0].toFixed(2)}~${a.took[1].toFixed(2)}`).join(' / ')}` +
    (landed ? ` · 0.15초 뒤 ${landed.x.toFixed(1)},${landed.y.toFixed(1)}` : '') +
    (problems.length ? `  ✗ ${problems.join(' / ')}` : '');
  console.log(line);
  const bad = problems.length > 0;
  const head = `${name} · ${MODE_LABEL[mode]} · ${view.ultName}`;
  if (RAW) {
    writeFileSync(path.join(RAW, `${id}-${mode}-0-preview.png`), pre);
    after.forEach((a, i) => writeFileSync(path.join(RAW, `${id}-${mode}-${i + 1}-${String(a.t).replace('.', '')}s.png`), a.png));
  }
  return [
    { png: pre, label: `${head} · 미리보기${bad ? ` ✗ ${problems.join(', ')}` : ''}`, bad },
    ...after.map(a => ({ png: a.png, label: `${name} · ${a.label}`, bad: !cast })),
  ];
}

try {
  for (const mode of MODES) {
    const rows = [];
    for (const [id, name] of LIST) rows.push(await shoot(id, name, mode));
    for (let f = 0; f * PER < rows.length; f++) {
      const shots = rows.slice(f * PER, f * PER + PER).flat();
      const out = path.join(OUT_DIR, `ult-test-sheet-${mode}${f === 0 ? '' : `-${f + 1}`}.png`);
      await writeSheet(page, shots, out, { scale: SCALE, per: PER_ROW, label: 22 });
      console.log(out);
    }
  }
} finally {
  await browser.close();
  if (server) await server.close();
}
if (errors.length) {
  console.log('ERRORS', errors);
  process.exitCode = 1;
}
