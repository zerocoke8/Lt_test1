// Frame sequences around casts, for judging "what was used and when does it come back" by eye.
// Drives the real app (real sim + renderer + HUD) on a phone viewport (844×390 @3x) with Playwright's fake clock
// (installed and paused), so every frame is exactly N ms of game time apart no matter how slow the screenshot is. Each scenario writes a
// contact sheet (frames tiled, time stamped) to OUT/<name>.png; FRAMES=1 also keeps the single frames.
//   1) npx vite --port 5181   2) node tests/visual/cast-frames.mjs [scenario …]   (default: all)
// Scenarios: hud, sheet, basic, normal[-<characterId>], drag-<characterId> (e.g. drag-blade), ult-<characterId>.
// Env: N / STEP override the frame count / spacing (ms) of normal and drag sequences.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.UI_URL ?? 'http://localhost:5181/';
const OUT = process.env.OUT ?? '/tmp/cast-frames';
const KEEP = process.env.FRAMES === '1';
const LIFT = 80;
mkdirSync(OUT, { recursive: true });

/** Where to drop each drag skill relative to the enemy pack (fixed directions: aim so the shape covers the pack). */
const DROP_OFFSET = {
  blade: { x: -3, y: 0 },
  berserker: { x: -1.6, y: 0 },
  shadow: { x: -2.2, y: 0 },
  ranger: { x: -4, y: 0 },
  gunner: { x: 2.2, y: 0 },
  mage: { x: 0, y: 0 },
  guardian: { x: 0, y: 0 },
  paladin: { x: 0, y: 0 },
  warden: { x: 0, y: 0 },
  cleric: { x: -1.5, y: 0 },
  bard: { x: 0, y: 0 },
  chrono: { x: 0, y: 0 },
};

const all = ['hud', 'sheet', 'basic', 'normal', 'drag-blade', 'drag-mage', 'drag-gunner', 'drag-warden', 'drag-shadow', 'ult-blade', 'ult-mage'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  // fake clock, paused: only runFor() moves time (a screenshot takes ~300 ms of real time, which must not count)
  const t0 = new Date('2026-10-04T10:00:00Z');
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(new Date(t0.getTime() + 1000));
  await page.goto(BASE);
  await until(page, () => window.__proto?.phase === 'preset', 8000);
  return { ctx, page, errors };
}

/** Advance fake time in small steps until fn() is true (in the page). */
async function until(page, fn, maxMs, arg) {
  for (let t = 0; t <= maxMs; t += 50) {
    if (await page.evaluate(fn, arg)) return true;
    await page.clock.runFor(50);
  }
  return false;
}

async function stageInfo(page) {
  return page.evaluate(() => {
    const r = document.querySelector('.stage').getBoundingClientRect();
    return { left: r.left, top: r.top, s: r.width / 1280 };
  });
}

/** Logical stage px of a world point (camera of the last frame). */
async function toLogical(page, w) {
  return page.evaluate(([w, lift]) => {
    const f = window.__proto.ui.fingerFor(w);
    const r = document.querySelector('.stage').getBoundingClientRect();
    const s = r.width / 1280;
    return { x: (f.x - r.left) / s, y: (f.y - r.top) / s - lift };
  }, [w, LIFT]);
}

function clipFor(st, cx, cy, w = 600, h = 338) {
  const x = Math.max(0, Math.min(1280 - w, cx - w / 2));
  const y = Math.max(0, Math.min(720 - h, cy - h / 2));
  return { x: st.left + x * st.s, y: st.top + y * st.s, width: w * st.s, height: h * st.s };
}

/** Clip that follows a world point (the camera keeps moving while we shoot). */
function follow(page, world, w = 600, h = 338, dy = -20) {
  return async () => {
    const pt = typeof world === 'function' ? await world() : world;
    const l = await toLogical(page, pt);
    return clipFor(await stageInfo(page), l.x, l.y + dy, w, h);
  };
}

/** n frames, `stepMs` of game time apart; act(i) may run before frame i. clip: null (full), an object or async () => clip. */
async function sequence(page, name, n, stepMs, clip, act) {
  const shots = [];
  for (let i = 0; i < n; i++) {
    if (act) await act(i);
    const c = typeof clip === 'function' ? await clip() : clip;
    const buf = await page.screenshot(c ? { clip: c } : {});
    shots.push({ buf, label: `${(i * stepMs) / 1000}s` });
    if (KEEP) writeFileSync(`${OUT}/${name}-${String(i).padStart(2, '0')}.png`, buf);
    await page.clock.runFor(stepMs);
  }
  await sheet(name, shots, clip ? 3 : 2);
}

/** Tiles the frames into one PNG (drawn in a blank page so no image library is needed). */
async function sheet(name, shots, cols) {
  const p = await browser.newPage();
  const data = shots.map(s => ({ src: `data:image/png;base64,${s.buf.toString('base64')}`, label: s.label }));
  const b64 = await p.evaluate(
    async ([data, cols]) => {
      const imgs = await Promise.all(
        data.map(d => new Promise(res => {
          const im = new Image();
          im.onload = () => res(im);
          im.src = d.src;
        })),
      );
      const tw = cols === 3 ? 620 : 940;
      const th = Math.round((imgs[0].height / imgs[0].width) * tw);
      const rows = Math.ceil(imgs.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * tw + (cols + 1) * 6;
      c.height = rows * th + (rows + 1) * 6;
      const g = c.getContext('2d');
      g.fillStyle = '#222';
      g.fillRect(0, 0, c.width, c.height);
      imgs.forEach((im, i) => {
        const x = 6 + (i % cols) * (tw + 6);
        const y = 6 + Math.floor(i / cols) * (th + 6);
        g.drawImage(im, x, y, tw, th);
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(x, y, 64, 24);
        g.fillStyle = '#ffeb3b';
        g.font = 'bold 18px sans-serif';
        g.fillText(data[i].label, x + 5, y + 18);
      });
      return c.toDataURL('image/png').split(',')[1];
    },
    [data, cols],
  );
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
  await p.close();
  console.log(`${OUT}/${name}.png`);
}

async function startRun(page, chars, tunables = {}) {
  await page.evaluate(
    ([chars, tunables]) =>
      window.__proto.startRun({
        seed: 4242,
        players: [
          { name: '나', isBot: false, characters: chars, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
          { name: 'BOT 1', isBot: true, characters: ['guardian', 'ranger', 'cleric'], pets: ['turtle_guard', 'owl_frost', 'golem_turret'] },
          { name: 'BOT 2', isBot: true, characters: ['blade', 'mage', 'bard'], pets: ['drum_raccoon', 'rabbit_time', 'fairy_heal'] },
        ],
        tunables,
      }),
    [chars, tunables],
  );
  await page.clock.runFor(100);
}

/** Densest enemy spot (most enemies within 2.5) — or null. */
async function pack(page) {
  return page.evaluate(() => {
    const es = window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0 && e.tier !== 'boss');
    let best = null;
    let bn = 0;
    for (const a of es) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (const b of es) {
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) <= 2.5) {
          n++;
          sx += b.pos.x;
          sy += b.pos.y;
        }
      }
      if (n > bn) {
        bn = n;
        best = { x: sx / n, y: sy / n, n };
      }
    }
    return best;
  });
}

async function myPos(page) {
  return page.evaluate(() => {
    const g = window.__proto.game;
    const me = g.state.players[0];
    const m = me.activeIndex != null ? me.party[me.activeIndex] : null;
    const e = m ? g.state.entities.find(x => x.id === m.entityId) : null;
    return e ? { x: e.pos.x, y: e.pos.y } : null;
  });
}

// ─────────────────────────── scenarios ───────────────────────────

async function scenario(name) {
  const { ctx, page, errors } = await newPage();
  const [kind, charId] = name.split('-');
  if (kind === 'hud') {
    await startRun(page, ['blade', 'mage', 'cleric']);
    await page.clock.runFor(2500);
    await page.evaluate(() => window.__proto.ui.dragTo('swap', 1, { x: 10, y: 6 }));
    await sequence(page, name, 8, 700, null);
  } else if (kind === 'sheet') {
    await startRun(page, ['blade', 'mage', 'cleric']);
    await page.clock.runFor(3000);
    // long-press the benched mage card (real touch)
    const cdp = await ctx.newCDPSession(page);
    const box = await page.locator('.ccard[data-idx="1"]').boundingBox();
    const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await page.clock.runFor(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sequence(page, name, 2, 1500, null);
  } else if (kind === 'basic') {
    await startRun(page, ['blade', 'mage', 'cleric']);
    await until(page, () => {
      const g = window.__proto.game;
      const me = g.state.players[0];
      const e = g.state.entities.find(x => x.id === me.party[me.activeIndex].entityId);
      return e && e.anim === 'attack';
    }, 20000);
    await sequence(page, name, 12, 50, follow(page, async () => (await myPos(page)) ?? { x: 12, y: 6 }, 420, 236));
  } else if (kind === 'normal') {
    await startRun(page, [charId ?? 'blade', charId === 'mage' ? 'blade' : 'mage', 'cleric']);
    await page.clock.runFor(1000);
    // wait for a cast, then catch the next one in 20 ms steps (it fires only with a target in range)
    await until(page, () => window.__proto.game.state.players[0].party[0].normalCooldownRemaining > 3, 20000);
    await until(page, () => window.__proto.game.state.players[0].party[0].normalCooldownRemaining < 0.2, 20000);
    let prev = 0;
    for (let t = 0; t < 15000; t += 20) {
      const cd = await page.evaluate(() => window.__proto.game.state.players[0].party[0].normalCooldownRemaining);
      if (cd > prev + 1) break;
      prev = cd;
      await page.clock.runFor(20);
    }
    await sequence(page, name, Number(process.env.N ?? 15), Number(process.env.STEP ?? 70), follow(page, async () => (await myPos(page)) ?? { x: 12, y: 6 }, 600, 338, -30));
  } else if (kind === 'drag') {
    const id = charId;
    await startRun(page, [id === 'guardian' ? 'paladin' : 'guardian', id, id === 'cleric' ? 'bard' : 'cleric']);
    // wait for a pack of ≥3 enemies on screen
    await until(page, () => {
      const es = window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0);
      return es.length >= 4;
    }, 30000);
    await page.clock.runFor(1500);
    const pk = (await pack(page)) ?? { x: 12, y: 6 };
    const off = DROP_OFFSET[id] ?? { x: 0, y: 0 };
    const drop = { x: pk.x + off.x, y: pk.y + off.y };
    // frame the drop point and wherever the character ends up (dashes move it)
    const anchor = async () => {
      const me = await myPos(page);
      return me && Math.abs(me.x - drop.x) < 9 ? { x: (me.x + drop.x) / 2, y: (me.y + drop.y) / 2 } : drop;
    };
    await sequence(page, name, Number(process.env.N ?? 18), Number(process.env.STEP ?? 80), follow(page, anchor, 640, 360), async i => {
      if (i === 1) await page.evaluate(d => window.__proto.ui.dragTo('swap', 1, d), drop);
    });
  } else if (kind === 'ult') {
    await startRun(page, [charId, 'mage', 'cleric']);
    await until(page, () => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length >= 4, 30000);
    await page.clock.runFor(2500);
    await page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } }));
    await page.clock.runFor(100);
    await sequence(page, name, 15, 100, process.env.FULL ? null : follow(page, async () => (await myPos(page)) ?? { x: 12, y: 6 }, 760, 428, 10), async i => {
      if (i === 1) await page.evaluate(() => window.__proto.game.dispatch({ type: 'ult', player: 0 }));
    });
  }
  if (errors.length) console.log(name, 'ERRORS', errors.slice(0, 5));
  await ctx.close();
}

for (const w of wanted) {
  try {
    await scenario(w);
  } catch (e) {
    console.log(w, 'FAILED', e);
  }
}
await browser.close();
