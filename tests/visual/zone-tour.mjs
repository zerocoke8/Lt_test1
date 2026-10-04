// Real-app zone/boss tour (기획 8차 통합 확인): the real sim + renderer + HUD on a phone (844×390 @3x), Playwright's
// fake clock paused so each shot is exactly N ms of game time apart. Debug jumpFloor to 1, 5, 6, 10, 11, 15, 16, 20:
//   normal floors → docs/screenshots/zone-<floor>.png (zone background, that zone's monsters, the mid boss on screen)
//   boss floors   → docs/screenshots/boss-<floor>.png (phase 1) and boss-<floor>-p<N>.png (each phase, forced by
//                   setting the boss's HP just above the threshold and letting the party hit it)
//   landing       → docs/screenshots/landing-seq.png (my drag landing, 17 ms frames: hit-stop hold + shake)
// Prints what each floor actually had (theme, zone label, monster ids, mid boss / boss name, phase banner) as JSON.
//   1) npx vite --port 5181  (or any server of the build)   2) node tests/visual/zone-tour.mjs [floors…|landing]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.UI_URL ?? 'http://localhost:5181/';
const OUT = process.env.OUT ?? 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const FLOORS = args.filter(a => /^\d+$/.test(a)).map(Number);
const floors = FLOORS.length || !args.length ? (FLOORS.length ? FLOORS : [1, 5, 6, 10, 11, 15, 16, 20]) : [];
const wantLanding = !args.length || args.includes('landing');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
const t0 = new Date('2026-10-04T10:00:00Z');
await page.clock.install({ time: t0 });
await page.clock.pauseAt(new Date(t0.getTime() + 1000));
await page.goto(BASE);
await until(() => window.__proto?.phase === 'preset', 8000);

async function until(fn, maxMs, arg, step = 100) {
  for (let t = 0; t <= maxMs; t += step) {
    if (await page.evaluate(fn, arg)) return true;
    await page.clock.runFor(step);
  }
  return false;
}
const ev = (fn, arg) => page.evaluate(fn, arg);
const dbg = action => ev(a => window.__proto.game.dispatch({ type: 'debug', action: a }), action);

await ev(() =>
  window.__proto.startRun({
    seed: 2020,
    players: [
      { name: '나', isBot: false, characters: ['blade', 'berserker', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
      { name: 'BOT 1', isBot: true, characters: ['guardian', 'ranger', 'cleric'], pets: ['turtle_guard', 'owl_frost', 'golem_turret'] },
      { name: 'BOT 2', isBot: true, characters: ['blade', 'mage', 'bard'], pets: ['drum_raccoon', 'rabbit_time', 'fairy_heal'] },
    ],
    tunables: { invincible: true },
  }),
);
await page.clock.runFor(300);

/** Recorded render-side events (wraps drainEvents once; startRun keeps the same game object for the run). */
await ev(() => {
  const g = window.__proto.game;
  window.__ev = [];
  const orig = g.drainEvents.bind(g);
  g.drainEvents = () => {
    const evs = orig();
    for (const e of evs) {
      if (['bossPhase', 'blink', 'dash'].includes(e.type)) window.__ev.push({ type: e.type, phase: e.phase, name: e.name });
      else if (e.type === 'skillCast' && e.area?.shape === 'fan') window.__ev.push({ type: 'fanCast', name: e.skillName ?? e.name });
    }
    return evs;
  };
});

function hudInfo() {
  return ev(() => {
    const s = window.__proto.game.state;
    const q = sel => document.querySelector(sel)?.textContent?.trim() ?? null;
    const vis = sel => {
      const el = document.querySelector(sel);
      return !!el && !el.classList.contains('is-hidden') && el.getBoundingClientRect().width > 0;
    };
    const ids = {};
    for (const e of s.entities) if (e.team === 'enemy' && e.hp > 0) ids[e.defId] = (ids[e.defId] ?? 0) + 1;
    return {
      floor: s.floor,
      kind: s.plan.kind,
      theme: s.plan.theme,
      floorLabel: vis('.floorinfo') ? `${q('.fi-floor')} ${q('.fi-zone')}` : null,
      mid: vis('.fi-mid') ? q('.fi-mid-name') : null,
      boss: vis('.boss') ? `${q('.boss-lv')} ${q('.boss-name')} ${vis('.boss-phase') ? q('.boss-phase') : ''}`.trim() : null,
      enemies: ids,
      events: window.__ev.splice(0).reduce((a, e) => ((a[e.type === 'bossPhase' ? `bossPhase${e.phase}:${e.name}` : e.type] = (a[e.type === 'bossPhase' ? `bossPhase${e.phase}:${e.name}` : e.type] ?? 0) + 1), a), {}),
    };
  });
}

/** Swap a ready card (cooldowns reset) onto a world point → camera goes there. */
async function dropAt(p) {
  await dbg({ kind: 'resetCooldowns', player: 0 });
  return ev(p => {
    const g = window.__proto.game;
    const me = g.state.players[0];
    for (let i = 0; i < 3; i++) if (i !== me.activeIndex && g.canSwap(0, i).ok) return window.__proto.ui.dragTo('swap', i, p).ok;
    return false;
  }, p);
}

const report = [];
for (const F of floors) {
  await dbg({ kind: 'jumpFloor', floor: F });
  await page.clock.runFor(200);
  const kind = await ev(() => window.__proto.game.state.plan.kind);
  if (kind === 'normal') {
    await ev(() => (window.__proto.game.tunables.midBossTimeTrigger = 6));
    await until(() => window.__proto.game.state.midBossSpawned, 20000, undefined, 250);
    await page.clock.runFor(3500);
    const mid = await ev(() => window.__proto.game.state.entities.find(e => e.tier === 'mid' && e.hp > 0)?.pos ?? null);
    if (mid) await dropAt({ x: mid.x - 1.6, y: mid.y + 0.6 });
    await page.clock.runFor(1600);
    await page.screenshot({ path: `${OUT}/zone-${F}.png` });
    report.push({ shot: `zone-${F}.png`, ...(await hudInfo()) });
  } else {
    await page.clock.runFor(6000);
    await page.screenshot({ path: `${OUT}/boss-${F}.png` });
    report.push({ shot: `boss-${F}.png`, ...(await hudInfo()) });
    const phases = await ev(() => {
      const s = window.__proto.game.state;
      const b = s.entities.find(e => e.id === s.bossId);
      return b ? b.maxHp : 0;
    });
    const thresholds = await ev(() => {
      // phase thresholds as the HUD draws them (ticks on the bar)
      return [...document.querySelectorAll('.boss-tick')].map(el => parseFloat(el.style.left) / 100).filter(x => x > 0).sort((a, b) => b - a);
    });
    const ths = thresholds.length ? thresholds : [];
    for (let i = 0; i < ths.length; i++) {
      await ev(th => {
        const s = window.__proto.game.state;
        const b = s.entities.find(e => e.id === s.bossId);
        b.hp = Math.min(b.hp, b.maxHp * th + b.maxHp * 0.004);
      }, ths[i]);
      await until(n => window.__ev.some(e => e.type === 'bossPhase' && e.phase === n), 8000, i + 2, 50);
      await page.clock.runFor(450);
      await page.screenshot({ path: `${OUT}/boss-${F}-p${i + 2}.png` });
      const info = await hudInfo();
      report.push({ shot: `boss-${F}-p${i + 2}.png`, ...info });
      await page.clock.runFor(2500);
    }
    report.push({ floor: F, maxHp: Math.round(phases), thresholds: ths });
  }
}

if (wantLanding) {
  await dbg({ kind: 'jumpFloor', floor: 7 });
  await ev(() => (window.__proto.game.tunables.waveInterval = 3));
  await until(() => window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0).length >= 6, 30000, undefined, 250);
  await page.clock.runFor(2500);
  const pack = await ev(() => {
    const es = window.__proto.game.state.entities.filter(e => e.team === 'enemy' && e.hp > 0 && e.tier !== 'boss');
    let best = null;
    for (const a of es) {
      const near = es.filter(b => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) <= 2.5);
      if (!best || near.length > best.n) best = { x: near.reduce((s, b) => s + b.pos.x, 0) / near.length, y: near.reduce((s, b) => s + b.pos.y, 0) / near.length, n: near.length };
    }
    return best;
  });
  await dbg({ kind: 'resetCooldowns', player: 0 });
  // berserker (card 2): 오른쪽 부채꼴 — drop left of the pack
  const drop = { x: pack.x - 1.6, y: pack.y };
  const st = await ev(() => {
    const r = document.querySelector('.stage').getBoundingClientRect();
    return { left: r.left, top: r.top, s: r.width / 1280 };
  });
  const shots = [];
  for (let i = 0; i < 16; i++) {
    if (i === 1) await ev(d => window.__proto.ui.dragTo('swap', 1, d), drop);
    const l = await ev(w => {
      const f = window.__proto.ui.fingerFor(w);
      const r = document.querySelector('.stage').getBoundingClientRect();
      const s = r.width / 1280;
      return { x: (f.x - r.left) / s, y: (f.y - r.top) / s - 80 };
    }, drop);
    const W = 560;
    const H = 315;
    const x = Math.max(0, Math.min(1280 - W, l.x - W / 2 + 60));
    const y = Math.max(0, Math.min(720 - H, l.y - H / 2 - 30));
    const buf = await page.screenshot({ clip: { x: st.left + x * st.s, y: st.top + y * st.s, width: W * st.s, height: H * st.s } });
    shots.push({ buf, label: `${i * 17}ms` });
    await page.clock.runFor(17);
  }
  await sheet(`${OUT}/landing-seq.png`, shots, 4);
  report.push({ shot: 'landing-seq.png', pack });
}

console.log(JSON.stringify(report, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.close();

/** Tiles frames into one PNG (drawn in a blank page so no image library is needed). */
async function sheet(path, shots, cols) {
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
      const tw = 560;
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
        g.fillRect(x, y, 78, 24);
        g.fillStyle = '#ffeb3b';
        g.font = 'bold 18px sans-serif';
        g.fillText(data[i].label, x + 5, y + 18);
      });
      return c.toDataURL('image/png').split(',')[1];
    },
    [data, cols],
  );
  writeFileSync(path, Buffer.from(b64, 'base64'));
  await p.close();
}
