// 기획 12차: full phone-screen shots (844×390 @3x) of the three new characters' drag skill and ult in the real app
// (real sim + renderer + HUD), with Playwright's fake clock paused so every frame is exact game time.
//   1) npx vite --port 5181   2) node tests/visual/new-chars.mjs [medic|exorcist|puppeteer …]
// Writes OUT/skill-<id>-drag.png and OUT/skill-<id>-ult.png (OUT default docs/screenshots). FRAMES=<dir> also keeps
// every candidate frame (DELAYS ms after the cast) there, to pick a better moment by eye.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.UI_URL ?? 'http://localhost:5181/';
const OUT = process.env.OUT ?? 'docs/screenshots';
const FRAMES = process.env.FRAMES ?? '';
mkdirSync(OUT, { recursive: true });
if (FRAMES) mkdirSync(FRAMES, { recursive: true });

/** When to take the kept shot (ms after the drop / the ult tap; ults have a 0.4 s cast): the moment the shape reads best. */
const SHOT_MS = {
  medic: { drag: 250, ult: 650 },
  exorcist: { drag: 250, ult: 650 },
  puppeteer: { drag: 650, ult: 600 },
};
const DELAYS = [100, 250, 400, 650, 900, 1300];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOT_MS);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failed = false;

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const t0 = new Date('2026-10-05T10:00:00Z');
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(new Date(t0.getTime() + 1000));
  await page.goto(BASE);
  await until(page, () => window.__proto?.phase === 'preset', 8000);
  return { ctx, page, errors };
}

async function until(page, fn, maxMs, arg) {
  for (let t = 0; t <= maxMs; t += 50) {
    if (await page.evaluate(fn, arg)) return true;
    await page.clock.runFor(50);
  }
  return false;
}

async function startRun(page, chars) {
  await page.evaluate(
    chars =>
      window.__proto.startRun({
        seed: 4242,
        startFloor: 3,
        players: [
          { name: '나', isBot: false, characters: chars, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
          { name: 'BOT 1', isBot: true, characters: ['guardian', 'ranger', 'cleric'], pets: ['turtle_guard', 'owl_frost', 'golem_turret'] },
          { name: 'BOT 2', isBot: true, characters: ['blade', 'mage', 'bard'], pets: ['drum_raccoon', 'rabbit_time', 'fairy_heal'] },
        ],
        tunables: { invincible: true, fieldEventChance: 0, goedamRoomsPerZone: 0 },
      }),
    chars,
  );
  await page.clock.runFor(100);
  // a pack of enemies near the party, so the shapes have something to hit
  await until(page, () => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length >= 6, 30000);
  await page.clock.runFor(2500);
}

/** Hurt every ally character (field + bench) so heals show; solo state is the live sim state. */
async function hurtParty(page, frac) {
  await page.evaluate(frac => {
    const s = window.__proto.game.state;
    for (const e of s.entities) if (e.kind === 'character' && e.hp > 0) e.hp = Math.max(1, e.maxHp * frac);
    for (const p of s.players) for (const m of p.party) if (!m.dead) m.hp = Math.max(1, m.maxHp * frac);
  }, frac);
}

/** Densest enemy spot (most enemies within 2.5) — or the allies' centre. */
async function aim(page, allies) {
  return page.evaluate(allies => {
    const s = window.__proto.game.state;
    const pool = s.entities.filter(e => e.hp > 0 && (allies ? e.kind === 'character' : e.team === 'enemy' && e.tier !== 'boss' && !e.eventTag));
    let best = null;
    let bn = 0;
    for (const a of pool) {
      let n = 0, sx = 0, sy = 0;
      for (const b of pool) {
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) <= (allies ? 3.5 : 2.5)) {
          n++;
          sx += b.pos.x;
          sy += b.pos.y;
        }
      }
      if (n > bn) {
        bn = n;
        best = { x: sx / n, y: sy / n };
      }
    }
    return best ?? { x: 16, y: 6 };
  }, allies);
}

async function shoot(page, id, what, act) {
  await act();
  let t = 0;
  let kept = null;
  for (const d of DELAYS) {
    await page.clock.runFor(d - t);
    t = d;
    const buf = await page.screenshot();
    if (FRAMES) writeFileSync(`${FRAMES}/${id}-${what}-${d}.png`, buf);
    if (d === SHOT_MS[id][what]) kept = buf;
  }
  kept ??= await page.screenshot();
  writeFileSync(`${OUT}/skill-${id}-${what}.png`, kept);
  console.log(`${OUT}/skill-${id}-${what}.png`);
}

for (const id of ids) {
  // drag: X on the bench (card 2), dropped on the pack (메딕: on the hurt allies)
  {
    const { ctx, page, errors } = await newPage();
    await startRun(page, ['blade', id, 'mage']);
    if (id === 'medic') await hurtParty(page, 0.45);
    const at = await aim(page, id === 'medic');
    await shoot(page, id, 'drag', () => page.evaluate(at => window.__proto.ui.dragTo('swap', 1, at), at));
    if (errors.length) (failed = true), console.log(id, 'drag ERRORS', errors.slice(0, 5));
    await ctx.close();
  }
  // ult: X on the field, gauge charged, tap
  {
    const { ctx, page, errors } = await newPage();
    await startRun(page, [id, 'blade', 'mage']);
    // wait until a few enemies are close to my character, so the ult has something to land on
    await until(page, () => {
      const s = window.__proto.game.state;
      const me = s.entities.find(e => e.id === s.players[0].party[s.players[0].activeIndex].entityId);
      return me && s.entities.filter(e => e.team === 'enemy' && e.hp > 0 && Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y) < 4.5).length >= 3;
    }, 15000);
    if (id === 'medic') await hurtParty(page, 0.45);
    await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } }));
    await page.clock.runFor(100);
    await shoot(page, id, 'ult', () => page.evaluate(() => window.__proto.game.dispatch({ type: 'ult', player: 0 })));
    if (errors.length) (failed = true), console.log(id, 'ult ERRORS', errors.slice(0, 5));
    await ctx.close();
  }
}
await browser.close();
if (failed) process.exitCode = 1;
