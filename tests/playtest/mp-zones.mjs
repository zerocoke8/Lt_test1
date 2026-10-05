// Multiplayer check for 기획 8차 (zones, new monsters, boss phases): the built game server + 3 phone pages
// (844×390@3x) in one room through the real lobby. The host jumps floors with the debug command (invincible party):
//   12F (폐병동: 질주 휠체어 charge, 간호 인형 blink, 복사기 괴물 fan) → 20F (심연의 감시자, phases forced by damage)
// On every page we record (a) a digest of each raw snapshot (tick → floor/theme/phase + every entity's id/def/hp/pos)
// and (b) the events the renderer receives (blink, monster dash, bossPhase, fan casts). Pass = for every tick all three
// saw, the digests are identical, and every page's renderer got the same events; plus screenshots of each page.
//   npm run build:all && node tests/playtest/mp-zones.mjs   (OUT=/tmp/mp-zones by default; PT_SPEED host speed, default 2)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const OUT = process.env.OUT ?? '/tmp/mp-zones';
const SPEED = Number(process.env.PT_SPEED ?? 2);
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const port = await new Promise((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
let serverLog = '';
const server = spawn(process.execPath, ['dist-server/index.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: path.resolve('dist'), END_LINGER_MS: '1500' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', d => (serverLog += d));
server.stderr.on('data', d => (serverLog += d));
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await (await fetch(`${base}healthz`)).text()) === 'ok') break;
  } catch {}
  await sleep(100);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const result = { ok: true, notes: [] };
const fail = msg => {
  result.ok = false;
  result.notes.push(msg);
};

async function open(name, preset) {
  const ctx = await browser.newContext(PHONE);
  if (preset) await ctx.addInitScript(p => localStorage.setItem('swapTower.preset.v1', JSON.stringify(p)), preset);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${name} console.error: ${m.text()}`));
  await page.goto(base);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  await page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10000 });
  return { name, ctx, page, errors };
}
const tap = async (p, sel) => {
  const b = await p.page.locator(sel).first().boundingBox();
  await p.page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
const waitPhase = (p, want, timeout = 20000) => p.page.waitForFunction(w => window.__proto?.phase === w, want, { timeout });
async function toLobby(p, nick) {
  await tap(p, '.btn-start');
  await waitPhase(p, 'lobby');
  const input = p.page.locator('.lb-name input');
  await input.fill(nick);
  await input.press('Enter');
}

/** Per-page recorder: raw snapshot digests by tick + render events. */
function record(page) {
  return page.evaluate(() => {
    const g = window.__proto.game;
    const w = window;
    w.__snaps = new Map();
    w.__fx = [];
    const origSnap = g.onSnap.bind(g);
    g.onSnap = m => {
      const s = m.state;
      const ents = s.entities
        .map(e => `${e.id}:${e.defId}:${e.tier ?? ''}:${Math.round(e.hp)}:${e.pos.x.toFixed(2)},${e.pos.y.toFixed(2)}`)
        .join(';');
      const tels = (s.telegraphs ?? []).map(t => `${t.id}:${t.area?.shape}`).join(';');
      const evs = m.events.filter(e => ['blink', 'dash', 'bossPhase'].includes(e.type) || (e.type === 'skillCast' && e.slot === 'monster')).map(e => `${e.type}:${e.entityId ?? e.sourceId}:${e.area?.shape ?? e.phase ?? ''}`).join(';');
      w.__snaps.set(m.tick, `${s.floor}|${s.plan.theme}|${s.phase}|${ents}|${tels}|${evs}`);
      if (w.__snaps.size > 4000) w.__snaps.delete(w.__snaps.keys().next().value);
      return origSnap(m);
    };
    const origDrain = g.drainEvents.bind(g);
    g.drainEvents = () => {
      const evs = origDrain();
      const st = g.state;
      for (const e of evs) {
        if (e.type === 'blink' || e.type === 'bossPhase') w.__fx.push(`${e.type}:${e.entityId}:${e.phase ?? ''}`);
        else if (e.type === 'dash') {
          const ent = st.entities.find(x => x.id === e.entityId);
          if (ent && ent.team === 'enemy') w.__fx.push(`charge:${e.entityId}`);
        } else if (e.type === 'skillCast' && e.area?.shape === 'fan') w.__fx.push(`fan:${e.sourceId}:${e.skillId}`);
      }
      return evs;
    };
  });
}

const digestOf = page =>
  page.evaluate(() => {
    const out = {};
    for (const [k, v] of window.__snaps) out[k] = v;
    return out;
  });

function compare(label, maps) {
  const ticks = Object.keys(maps[0]).filter(t => maps.every(m => t in m));
  let diff = 0;
  let first = null;
  for (const t of ticks) {
    if (!(maps[1][t] === maps[0][t] && maps[2][t] === maps[0][t])) {
      diff++;
      first ??= t;
    }
  }
  if (diff) fail(`${label}: ${diff}/${ticks.length} common ticks differ (first ${first})`);
  return { commonTicks: ticks.length, differing: diff };
}

const A = await open('A', { characters: ['blade', 'berserker', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] });
const B = await open('B', { characters: ['guardian', 'mage', 'ranger'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] });
const C = await open('C', { characters: ['warden', 'gunner', 'bard'], pets: ['fairy_heal', 'owl_frost', 'cat_void'] });
const all = [A, B, C];
try {
  await toLobby(A, '에이');
  await tap(A, '.lb-create');
  await waitPhase(A, 'room');
  const code = await A.page.evaluate(() => window.__proto.net.roomCode);
  for (const [p, n] of [[B, '비'], [C, '씨']]) {
    await toLobby(p, n);
    await p.page.locator('.lb-code-input').fill(code);
    await tap(p, '.lb-join');
    await waitPhase(p, 'room');
  }
  await tap(A, '.lb-start');
  for (const p of all) await waitPhase(p, 'combat');
  await A.page.evaluate(sp => window.__proto.game.dispatch({ type: 'tunables', patch: { invincible: true, gameSpeed: sp, midBossTimeTrigger: 4, waveInterval: 4 } }), SPEED);
  await sleep(500);
  for (const p of all) await record(p.page);

  // ── 12F 폐병동 ──
  await A.page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 12 } }));
  const t12 = Date.now();
  const seen = {};
  while (Date.now() - t12 < 40000) {
    await sleep(1000);
    const fx = await A.page.evaluate(() => window.__fx.join(' '));
    seen.blink = /blink/.test(fx);
    seen.charge = /charge/.test(fx);
    seen.fan = /fan/.test(fx);
    if (seen.blink && seen.charge && seen.fan && Date.now() - t12 > 12000) break;
  }
  const ward = await Promise.all(all.map(p => p.page.evaluate(() => ({ floor: window.__proto.game.state.floor, theme: window.__proto.game.state.plan.theme, zone: document.querySelector('.fi-zone')?.textContent, mid: document.querySelector('.fi-mid-name')?.textContent }))));
  result.ward = { hud: ward, seenOnA: seen };
  for (const [i, p] of all.entries()) await p.page.screenshot({ path: `${OUT}/ward-${p.name}.png` });
  if (!ward.every(w => w.floor === 12 && w.theme === 'ward' && w.zone === '· 폐병동층')) fail(`ward HUD ${JSON.stringify(ward)}`);
  for (const k of ['blink', 'charge', 'fan']) if (!seen[k]) fail(`12F: no ${k} seen on A in 40 s`);
  const fx12 = await Promise.all(all.map(p => p.page.evaluate(() => window.__fx.splice(0))));
  result.ward.fx = fx12.map(f => f.length);
  // same render events on every page (allow the last ~1 s to still be in flight → compare the common prefix)
  const n12 = Math.min(...fx12.map(f => f.length));
  if (!fx12.every(f => f.slice(0, n12 - 3).join() === fx12[0].slice(0, n12 - 3).join())) fail('12F: render event streams differ between pages');
  result.ward.compare = compare('12F', await Promise.all(all.map(p => digestOf(p.page))));

  // ── 20F 심연의 감시자: no debug "set boss HP" in multiplayer → the host lowers monsterHpMult (applied at spawn) first,
  // so the party pushes the boss through 60 % and 30 % within seconds ──
  await A.page.evaluate(() => window.__proto.game.dispatch({ type: 'tunables', patch: { monsterHpMult: 0.25 } }));
  await sleep(300);
  await A.page.evaluate(() => window.__proto.game.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 20 } }));
  for (const p of all) await p.page.evaluate(() => window.__snaps.clear());
  await sleep(4000);
  for (const p of all) await p.page.screenshot({ path: `${OUT}/boss20-${p.name}.png` });
  const t20 = Date.now();
  while (Date.now() - t20 < 60000) {
    await sleep(500);
    const ph = await all[2].page.evaluate(() => window.__fx.filter(x => x.startsWith('bossPhase')).length);
    if (ph >= 2) break;
  }
  await sleep(600);
  for (const p of all) await p.page.screenshot({ path: `${OUT}/boss20-phase-${p.name}.png` });
  const fx20 = await Promise.all(all.map(p => p.page.evaluate(() => window.__fx.filter(x => x.startsWith('bossPhase')))));
  const hud20 = await Promise.all(all.map(p => p.page.evaluate(() => ({ boss: document.querySelector('.boss-name')?.textContent, marks: document.querySelectorAll('.bp-mark.is-on').length, floor: window.__proto.game.state.floor, theme: window.__proto.game.state.plan.theme }))));
  result.boss20 = { phases: fx20, hud: hud20 };
  if (!fx20.every(f => f.length === 2 && f.join() === fx20[0].join())) fail(`20F: bossPhase events per page ${JSON.stringify(fx20)}`);
  if (!hud20.every(h => h.boss === hud20[0].boss && h.theme === 'rooftop')) fail(`20F HUD ${JSON.stringify(hud20)}`);
  result.boss20.compare = compare('20F', await Promise.all(all.map(p => digestOf(p.page))));
} catch (e) {
  fail(`threw: ${e.stack ?? e}`);
  for (const p of all) await p.page.screenshot({ path: `${OUT}/error-${p.name}.png` }).catch(() => {});
} finally {
  result.errors = all.flatMap(p => p.errors);
  if (result.errors.length) fail('console errors');
  await browser.close();
  server.kill();
}
console.log(JSON.stringify(result, null, 1));
if (!result.ok) {
  console.log(serverLog.slice(-2000));
  process.exitCode = 1;
}
