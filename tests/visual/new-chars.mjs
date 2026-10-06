// 기획 12차 → 13차: full phone-screen shots (844×390 @3x) of every character's drag skill and ult in the real app (real
// sim + renderer + HUD), with Playwright's fake clock paused so every frame is exact game time.
//   1) npx vite --port 5181   2) node tests/visual/new-chars.mjs [guardian|paladin|… (default: all 15)]
// Writes OUT/skill-<id>-drag.png and OUT/skill-<id>-ult.png (OUT default: /tmp/skills-renewal — scratch, not the docs).
// FRAMES=<dir> also keeps every candidate frame (around each skill's big beat) there, to pick a better moment by eye.
// SHEET=<png> composes all shots into one contact sheet (docs/screenshots/skills-renewal.png).
// CUTIN=<png> also shoots my ult cut-in mid-band (docs/screenshots/ult-cutin.png), CUTIN_ID picks whose (default blade).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = process.env.UI_URL ?? 'http://localhost:5181/';
const OUT = process.env.OUT ?? '/tmp/skills-renewal';
const FRAMES = process.env.FRAMES ?? '';
const SHEET = process.env.SHEET ?? '';
const CUTIN = process.env.CUTIN ?? '';
const CUTIN_ID = process.env.CUTIN_ID ?? 'blade';
mkdirSync(OUT, { recursive: true });
if (FRAMES) mkdirSync(FRAMES, { recursive: true });

/**
 * When the big beat lands (ms after the drop / the ult tap — ults: the 0.45 s cut-in first). The kept shot is a few
 * frames after it (the burst, before the freeze ends); the candidates bracket it.
 */
const BEAT_MS = {
  guardian: { drag: 260, ult: 860 },
  paladin: { drag: 510, ult: 1210 },
  warden: { drag: 330, ult: 920 },
  blade: { drag: 600, ult: 2460 },
  berserker: { drag: 140, ult: 470 },
  shadow: { drag: 520, ult: 1620 },
  ranger: { drag: 770, ult: 2770 },
  mage: { drag: 1170, ult: 4870 },
  gunner: { drag: 870, ult: 2420 },
  cleric: { drag: 4020, ult: 970 },
  medic: { drag: 370, ult: 480 },
  exorcist: { drag: 620, ult: 3520 },
  bard: { drag: 720, ult: 1670 },
  chrono: { drag: 870, ult: 700 },
  puppeteer: { drag: 420, ult: 3020 },
};
const AFTER = 120;
const ALL = Object.keys(BEAT_MS);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

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
        // the bots stay out of the way (their ults would cover mine); every hit counts, nobody dies
        tunables: { invincible: true, fieldEventChance: 0, goedamRoomsPerZone: 0, botDamageMult: 0.05 },
      }),
    chars,
  );
  await page.clock.runFor(100);
  // a pack of enemies near the party, so the shapes have something to hit
  await until(page, () => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length >= 6, 30000);
  await page.clock.runFor(2500);
  // keep the pack alive for the whole storyboard, gathered in front of my character (the shapes have a crowd to hit)
  await page.evaluate(() => {
    const s = window.__proto.game.state;
    const me = s.entities.find(e => e.id === s.players[0].party[s.players[0].activeIndex].entityId);
    const cx = Math.max(7, Math.min(s.plan.arena.width - 7, (me?.pos.x ?? 12) + 2.5));
    let i = 0;
    for (const e of s.entities) {
      if (e.team !== 'enemy') continue;
      e.maxHp *= 20;
      e.hp = e.maxHp;
      e.pos.x = cx + ((i % 4) - 1.5) * 1.3;
      e.pos.y = 5.6 + (Math.floor(i / 4) - 0.5) * 1.4;
      i++;
    }
  });
  await page.clock.runFor(200);
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
      let n = 0,
        sx = 0,
        sy = 0;
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

async function shoot(page, id, what, act, cutin = false) {
  const beat = BEAT_MS[id][what];
  const keep = beat + AFTER;
  const delays = [...new Set([...(cutin ? [200] : []), Math.max(80, beat - 220), Math.max(100, beat - 60), keep, beat + 200, beat + 450])].sort((a, b) => a - b);
  await act();
  let t = 0;
  let kept = null;
  for (const d of delays) {
    await page.clock.runFor(d - t);
    t = d;
    const buf = await page.screenshot();
    if (FRAMES) writeFileSync(`${FRAMES}/${id}-${what}-${d}.png`, buf);
    if (d === keep) kept = buf;
    if (cutin && d === 200) {
      mkdirSync(dirname(CUTIN), { recursive: true });
      writeFileSync(CUTIN, buf);
      console.log(CUTIN);
    }
  }
  kept ??= await page.screenshot();
  writeFileSync(`${OUT}/skill-${id}-${what}.png`, kept);
  console.log(`${OUT}/skill-${id}-${what}.png`);
}

for (const id of ids) {
  // drag: X on the bench (card 2), dropped on the pack (메딕: on the hurt allies)
  {
    const { ctx, page, errors } = await newPage();
    await startRun(page, [id === 'blade' ? 'mage' : 'blade', id, 'cleric']);
    if (id === 'medic' || id === 'cleric') await hurtParty(page, 0.45);
    const at = await aim(page, id === 'medic' || id === 'cleric');
    await shoot(page, id, 'drag', () => page.evaluate(at => window.__proto.ui.dragTo('swap', 1, at), at));
    if (errors.length) (failed = true), console.log(id, 'drag ERRORS', errors.slice(0, 5));
    await ctx.close();
  }
  // ult: X on the field, gauge charged, tap
  {
    const { ctx, page, errors } = await newPage();
    await startRun(page, [id, id === 'blade' ? 'mage' : 'blade', 'cleric']);
    // wait until a few enemies are close to my character, so the ult has something to land on
    await until(page, () => {
      const s = window.__proto.game.state;
      const me = s.entities.find(e => e.id === s.players[0].party[s.players[0].activeIndex].entityId);
      return me && s.entities.filter(e => e.team === 'enemy' && e.hp > 0 && Math.hypot(e.pos.x - me.pos.x, e.pos.y - me.pos.y) < 4.5).length >= 3;
    }, 15000);
    if (id === 'medic' || id === 'cleric') await hurtParty(page, 0.45);
    await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } }));
    await page.clock.runFor(100);
    await shoot(page, id, 'ult', () => page.evaluate(() => window.__proto.game.dispatch({ type: 'ult', player: 0 })), !!CUTIN && id === CUTIN_ID);
    if (errors.length) (failed = true), console.log(id, 'ult ERRORS', errors.slice(0, 5));
    await ctx.close();
  }
}

if (SHEET) await contactSheet(ids.length === ALL.length ? ALL : ids);
await browser.close();
if (failed) process.exitCode = 1;

/** All shots on one page: 3 characters per row, drag | ult side by side, half size, with the character name. */
async function contactSheet(list) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const tiles = list.map(id => ({
    id,
    drag: 'data:image/png;base64,' + readFileSync(`${OUT}/skill-${id}-drag.png`).toString('base64'),
    ult: 'data:image/png;base64,' + readFileSync(`${OUT}/skill-${id}-ult.png`).toString('base64'),
  }));
  const png = await page.evaluate(async tiles => {
    const TW = 422;
    const TH = 195;
    const LABEL = 22;
    const PER = 3;
    const rows = Math.ceil(tiles.length / PER);
    const c = document.createElement('canvas');
    c.width = PER * (TW * 2 + 12) + 12;
    c.height = rows * (TH + LABEL + 10) + 10;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0d14';
    g.fillRect(0, 0, c.width, c.height);
    const load = src => new Promise(r => {
      const im = new Image();
      im.onload = () => r(im);
      im.src = src;
    });
    for (let i = 0; i < tiles.length; i++) {
      const x = 12 + (i % PER) * (TW * 2 + 12);
      const y = 10 + Math.floor(i / PER) * (TH + LABEL + 10);
      g.fillStyle = '#e6ebf5';
      g.font = '700 16px sans-serif';
      g.fillText(`${tiles[i].id} — 드래그 | 궁극기`, x, y + 16);
      g.drawImage(await load(tiles[i].drag), x, y + LABEL, TW - 2, TH);
      g.drawImage(await load(tiles[i].ult), x + TW, y + LABEL, TW - 2, TH);
    }
    return c.toDataURL('image/png');
  }, tiles);
  mkdirSync(dirname(SHEET), { recursive: true });
  writeFileSync(SHEET, Buffer.from(png.split(',')[1], 'base64'));
  console.log(SHEET);
  await ctx.close();
}
