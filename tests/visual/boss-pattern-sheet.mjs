// 기획 20차 (docs/bosses.md 5장): one frame of every boss's SIGNATURE pattern (BossDef.signature) — 5 × 4 tiles, the real
// game on a phone screen (844×390) with the HUD, to see by eye that the 20 patterns look different from each other.
// Each boss fights alone (invincible party, fat HP bar so no phase starts); the game runs fast until the boss casts its
// signature, then at normal speed until the first warning of that cast is about half-way, and the frame is taken.
//   · a signature without a warning (a summon) is taken 2.5 s after the cast, the label says 「예고 없음」
//   · a signature that was never cast in `limit` seconds gets a RED label and frame
//   · a boss without a signature in its data (the classic four, untouched in 기획 20차) shows its FIRST pattern instead
//
//   node tests/visual/boss-pattern-sheet.mjs                                   → <temp>/boss-patterns.png
//   node tests/visual/boss-pattern-sheet.mjs out=docs/screenshots/boss-patterns-20.png
//   node tests/visual/boss-pattern-sheet.mjs only=karaoke_room,answering_pencil scale=1 at=0.5 limit=45 port=5203
//
// It starts its own Vite dev server (no build needed); about 5 s a boss.
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bossList, openGame, parseArgs, setSpeed, startBoss, writeSheet } from './bossLive.mjs';

const args = parseArgs(process.argv);
const OUT = args.out ?? process.env.OUT ?? path.join(tmpdir(), 'boss-patterns.png');
const ONLY = args.only ? args.only.split(',') : null;
const SCALE = Number(args.scale ?? 0.5);
/** How far into its countdown the first warning is when the frame is taken (0..1). */
const AT = Number(args.at ?? 0.5);
/** Game seconds a boss gets to cast its signature. */
const LIMIT = Number(args.limit ?? 40);
/** Game speed until the cast (the debug slider's maximum). */
const FAST = 4;
/** Game seconds waited for a warning after the cast before the pattern counts as one without. */
const NO_WARNING = 2.5;

/**
 * In the page, every animation frame: watch the boss box's pattern pill (「⚠ 이름」, set by the HUD on every boss cast).
 * When it names the signature (any pattern when `sigName` is null): remember which warnings were already there, drop
 * to normal speed, then wait for the first NEW enemy warning to reach `at` of its countdown.
 * Resolves to { found, warned, time, cast } (cast = the pattern's name).
 */
const watchSignature = ([sigName, at, limit, noWarning]) =>
  new Promise(resolve => {
    let maxId = 0;
    let castAt = -1;
    let castMax = 0;
    let castName = '';
    const done = r => {
      r.cast = castName;
      // nearly frozen while the picture is taken
      window.__proto.game.tunables.gameSpeed = 0.25;
      resolve(r);
    };
    const tick = () => {
      const g = window.__proto.game;
      const s = g?.state;
      if (!s || s.phase !== 'combat') return resolve({ found: false, warned: false, time: s?.time ?? 0 });
      const enemy = s.telegraphs.filter(t => t.team === 'enemy' && !t.self);
      if (castAt < 0) {
        const pill = document.querySelector('.boss-cast')?.textContent ?? '';
        if (sigName ? pill === `⚠ ${sigName}` : pill.startsWith('⚠ ')) {
          castName = pill.slice(2);
          castAt = s.time;
          castMax = maxId;
          g.tunables.gameSpeed = 1;
        } else if (s.time > limit) return done({ found: false, warned: false, time: s.time });
        else for (const t of s.telegraphs) maxId = Math.max(maxId, t.id);
      }
      if (castAt >= 0) {
        const mine = enemy.filter(t => t.id > castMax).sort((a, b) => a.id - b.id)[0];
        if (mine && mine.total > 0 && 1 - mine.remaining / mine.total >= at) return done({ found: true, warned: true, time: s.time });
        // no warning came with the cast: a summon / an instant pattern — its frame a moment after the cast
        if (!mine && s.time - castAt >= noWarning) return done({ found: true, warned: false, time: s.time });
        // the first warning was missed (it landed between two frames): take what is on screen now
        if (s.time - castAt > 6) return done({ found: true, warned: enemy.length > 0, time: s.time });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const game = await openGame(args.port ?? 5203);
const { page, errors } = game;
const shots = [];
const missing = [];
try {
  // the game runs fast up to the cast, so the floor banner and the tip toasts (real-time) would still cover the field
  await page.addStyleTag({ content: '.banners, .toasts-hud, .sheet-tip { display: none !important; }' });
  const all = await bossList(page);
  const list = ONLY ? all.filter(b => ONLY.includes(b.id)) : all;
  for (const b of list) {
    await startBoss(page, b, { gameSpeed: FAST });
    const r = await page.evaluate(watchSignature, [b.signatureName, AT, LIMIT, NO_WARNING]);
    const png = await page.screenshot();
    await setSpeed(page, 1);
    // no signature in the data: its first pattern, marked 「첫 패턴」 instead of the star
    const sig = b.signatureName ? `★ ${b.signatureName}` : `첫 패턴 ${r.cast || '(없음)'}`;
    const note = !r.found ? ` — ${LIMIT}초 안에 안 나옴` : r.warned ? '' : ' (예고 없음)';
    if (!r.found) missing.push(b.id);
    shots.push({ png, label: `${b.name} · ${b.formLabel} · ${sig}${note}`, bad: !r.found });
    console.log(`${b.id} ${b.name} · ${b.formLabel} · ${b.signature ?? '-'} ${sig}${note} @${r.time.toFixed(1)}s`);
  }
  await writeSheet(page, shots, OUT, { scale: SCALE });
  console.log(OUT);
} finally {
  await game.close();
}
if (missing.length) console.log(`signature not seen: ${missing.join(', ')}`);
if (errors.length) console.log('ERRORS', errors);
if (missing.length || errors.length) process.exitCode = 1;
