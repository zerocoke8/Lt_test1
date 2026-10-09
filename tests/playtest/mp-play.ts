// Multiplayer designer playtest (기획 3차): 3 humans in one room through the REAL lobby, floors 1–5, real input.
//   A = phone (844×390@3, CDP touch, host), B = phone (touch), C = desktop (1280×720, mouse).
// Every drag is a real touch/mouse gesture from the card to a finger point aimed the way a designer reads the card
// (dash/cone/burst → drop on the side the shape opens from). For each drop we also score, on the same snapshot:
//   naive = finger right on the cluster, best = grid search over the visible field (what a perfect aimer gets).
// Measures: drop→appear latency on the dropper's and the others' screens, snapshot gaps, interpolation stalls/jumps,
// fps per page per floor, reward wait / auto-pick timing, offline → BOT → back, tab close → reopen, console errors.
// 기획 10차 괴담 room (one in floors 2–4 at the default slider): A takes the top option, B follows GOEDAM (leave|first|
// random, default leave), C walks away and the server's 25 s room deadline leaves for it; others' rows, wait text.
//
// Run (game server already up, e.g. PORT=8790 node dist-server/index.js):
//   PT_BASE=http://127.0.0.1:8790/ PT_SET=1 PT_TAG=m1 npx vite-node tests/playtest/mp-play.ts
//   PT_SET=2 → the other 6 characters on the phones. PT_SPEED (default 2) = host debug speed.
// Output: /tmp/mp-<tag>-NN-<name>.png screenshots, /tmp/mp-<tag>-report.json.

import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';
import { hitsArea } from '../../src/sim/geometry';
import { previewPartsFor } from '../../src/sim/preview';
import { PETS, getCharacter } from '../../src/data';
import type { GameState, PreviewPart, Vec2 } from '../../src/types';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const BASE = env.PT_BASE ?? 'http://127.0.0.1:8790/';
const SET = Number(env.PT_SET ?? 1);
const TAG = env.PT_TAG ?? `m${SET}`;
const SPEED = Number(env.PT_SPEED ?? 2);
const MAX_FLOOR = Number(env.PT_FLOORS ?? 5);
const OUT = '/tmp';
/** Skip floors 1–5: go straight to the 3-player stress window (many monsters, invincible). */
const STRESS_ONLY = env.PT_STRESS_ONLY === '1';
const NO_HOLD_SHOTS = env.PT_NOSHOTS === '1';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r2 = (x: number) => Math.round(x * 100) / 100;

const PRESETS: Record<number, Record<'A' | 'B' | 'C', { characters: string[]; pets: string[] }>> = {
  1: {
    A: { characters: ['blade', 'berserker', 'shadow'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
    B: { characters: ['ranger', 'mage', 'gunner'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] },
    C: { characters: ['guardian', 'paladin', 'warden'], pets: ['fairy_heal', 'owl_frost', 'cat_void'] },
  },
  2: {
    A: { characters: ['cleric', 'bard', 'chrono'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
    B: { characters: ['guardian', 'paladin', 'warden'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] },
    C: { characters: ['blade', 'ranger', 'gunner'], pets: ['fairy_heal', 'owl_frost', 'cat_void'] },
  },
};

/** Designer's reading of each card: where to put the drop point relative to the enemy cluster centre. */
const AIM_OFFSET: Record<string, Vec2> = {
  blade: { x: -3, y: 0 }, // 오른쪽 6칸 돌진: start left of the pack
  berserker: { x: -1.6, y: 0 }, // 오른쪽 부채꼴
  shadow: { x: -2.2, y: 0 }, // 오른쪽 3연속 폭발 (0 / 2.2 / 4.4)
  ranger: { x: -2.5, y: 0 }, // 오른쪽 긴 직선
  gunner: { x: 2, y: 0 }, // 왼쪽 부채꼴
};

interface Dev {
  key: 'A' | 'B' | 'C';
  nick: string;
  kind: 'phone' | 'desktop';
  ctx: BrowserContext;
  page: Page;
  cdp: CDPSession | null;
  errors: string[];
  busy: boolean;
  hold: boolean; // loop paused by the scenario
  lastCard: number;
  iter: number;
}

interface DropRec {
  dev: string;
  device: string;
  char: string;
  floor: number;
  foes: number;
  aimed: number;
  naive: number;
  best: number;
  preview: number;
  valid: boolean;
  blocked: number;
  aimNote: string;
  dragDmg?: number;
  upAt: number;
  appearSelf?: number;
  appearOthers?: (number | null)[];
}

const report: Record<string, unknown> & {
  drops: DropRec[];
  timeline: string[];
  floors: unknown[];
  errors: Record<string, string[]>;
  shots: string[];
} = { set: SET, tag: TAG, base: BASE, speed: SPEED, drops: [], timeline: [], floors: [], errors: {}, shots: [] };
const T0 = Date.now();
const L = (...a: unknown[]) => {
  const line = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ` + a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  report.timeline.push(line);
  console.log(line);
};

let shotN = 0;
async function shot(d: Dev, name: string): Promise<string> {
  const path = `${OUT}/mp-${TAG}-${String(++shotN).padStart(2, '0')}-${name}-${d.key}.png`;
  try {
    await d.page.screenshot({ path });
    report.shots.push(path);
  } catch (e) {
    L('shot failed', name, String(e).slice(0, 80));
  }
  return path;
}

// ─────────────────────────── in-page probe ───────────────────────────

function initProbe(): void {
  type Ent = { x: number; y: number; d1: number; d2: number };
  const P = {
    frames: [] as [number, number][],
    longTasks: 0,
    ups: [] as number[],
    swaps: [] as { t: number; player: number; swaps: number; floor: number }[],
    prevSwaps: null as number[] | null,
    ent: new Map<number, Ent>(),
    smooth: { moving: 0, stalls: 0, jumps: 0, dsum: 0, dd: 0 },
    snapGaps: [] as number[],
    lastSnap: 0,
    msgs: 0,
  };
  (window as unknown as { __pt: typeof P }).__pt = P;
  document.addEventListener('pointerup', () => P.ups.push(Date.now()), true);
  const Orig = window.WebSocket;
  class ProbeWS extends Orig {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener('message', ev => {
        P.msgs++;
        if (typeof ev.data === 'string' && ev.data.startsWith('{"t":"snap"')) {
          const now = performance.now();
          if (P.lastSnap) P.snapGaps.push(now - P.lastSnap);
          if (P.snapGaps.length > 20000) P.snapGaps.splice(0, 10000);
          P.lastSnap = now;
        }
      });
    }
  }
  window.WebSocket = ProbeWS as typeof WebSocket;
  let last = 0;
  const tick = (now: number) => {
    if (last > 0) {
      P.frames.push([now, now - last]);
      if (P.frames.length > 80000) P.frames.splice(0, 40000);
    }
    last = now;
    try {
      const api = window.__proto;
      const g = api?.game;
      if (g && api && api.phase === 'combat') {
        const s = g.state;
        const sw = s.players.map(p => p.stats.swaps);
        if (P.prevSwaps && P.prevSwaps.length === sw.length) {
          sw.forEach((n, i) => {
            if (n !== P.prevSwaps![i]) P.swaps.push({ t: Date.now(), player: i, swaps: n, floor: s.floor });
          });
        }
        P.prevSwaps = sw;
        const seen = new Set<number>();
        for (const e of s.entities) {
          if (e.hp <= 0) continue;
          seen.add(e.id);
          const k = P.ent.get(e.id);
          if (!k) {
            P.ent.set(e.id, { x: e.pos.x, y: e.pos.y, d1: -1, d2: -1 });
            continue;
          }
          const d = Math.hypot(e.pos.x - k.x, e.pos.y - k.y);
          if (k.d1 >= 0 && k.d2 >= 0 && d < 1.2 && k.d1 < 1.2 && k.d2 < 1.2) {
            const nb = Math.min(k.d2, d);
            if (nb > 0.004) {
              P.smooth.moving++;
              P.smooth.dsum += k.d1;
              P.smooth.dd += Math.abs(k.d1 - k.d2);
              if (k.d1 < 0.0008) P.smooth.stalls++;
              else if (k.d1 > 2.2 * Math.max(k.d2, d)) P.smooth.jumps++;
            }
          }
          k.d2 = k.d1;
          k.d1 = d;
          k.x = e.pos.x;
          k.y = e.pos.y;
        }
        for (const id of P.ent.keys()) if (!seen.has(id)) P.ent.delete(id);
      }
    } catch {
      /* no snapshot yet */
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(l => (P.longTasks += l.getEntries().length)).observe({ type: 'longtask' });
  } catch {
    /* unsupported */
  }
}

// ─────────────────────────── devices + input ───────────────────────────

const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };

async function attachPage(d: Dev, page: Page): Promise<void> {
  d.page = page;
  page.on('pageerror', e => d.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') d.errors.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) d.errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  d.cdp = d.kind === 'phone' ? await d.ctx.newCDPSession(page) : null;
}

async function openDev(browser: Browser, key: Dev['key'], nick: string, kind: Dev['kind']): Promise<Dev> {
  const ctx = await browser.newContext(kind === 'phone' ? PHONE : DESKTOP);
  await ctx.addInitScript(initProbe);
  const d: Dev = { key, nick, kind, ctx, page: null as unknown as Page, cdp: null, errors: [], busy: false, hold: false, lastCard: 0, iter: 0 };
  await attachPage(d, await ctx.newPage());
  await d.page.goto(BASE);
  await waitPhase(d, 'preset');
  return d;
}

async function waitPhase(d: Dev, want: string, timeout = 20000): Promise<void> {
  await d.page.waitForFunction(p => window.__proto?.phase === p, want, { timeout });
}
const phaseOf = (d: Dev) => d.page.evaluate(() => window.__proto?.phase ?? null).catch(() => null);

async function centerOf(d: Dev, sel: string): Promise<Vec2> {
  const b = await d.page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`${d.key}: no box for ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function tapAt(d: Dev, p: Vec2): Promise<void> {
  if (d.kind === 'phone') await d.page.touchscreen.tap(p.x, p.y);
  else await d.page.mouse.click(p.x, p.y);
}
async function tap(d: Dev, sel: string): Promise<void> {
  await tapAt(d, await centerOf(d, sel));
}

async function touch(d: Dev, type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Vec2): Promise<void> {
  await d.cdp!.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' || !p ? [] : [{ x: p.x, y: p.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
  });
}

/** Press `from`, slide to `to` like a thumb (ease-out, ~230 ms), keep holding. Resolves to release(). */
async function dragHold(d: Dev, from: Vec2, to: Vec2, steps = 14): Promise<() => Promise<void>> {
  const at = (t: number) => {
    const e = 1 - (1 - t) * (1 - t);
    return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
  };
  if (d.kind === 'phone') {
    await touch(d, 'touchStart', from);
    for (let i = 1; i <= steps; i++) {
      await touch(d, 'touchMove', at(i / steps));
      await sleep(16);
    }
    return async () => touch(d, 'touchEnd');
  }
  await d.page.mouse.move(from.x, from.y);
  await d.page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = at(i / steps);
    await d.page.mouse.move(p.x, p.y);
    await sleep(16);
  }
  return async () => d.page.mouse.up();
}

// ─────────────────────────── lobby ───────────────────────────

async function pickPresetViaUi(d: Dev, want: { characters: string[]; pets: string[] }): Promise<void> {
  const page = d.page;
  for (let guard = 0; guard < 6; guard++) {
    const picked = page.locator('.ps-char.is-picked');
    if ((await picked.count()) === 0) break;
    await picked.first().scrollIntoViewIfNeeded();
    await tap(d, '.ps-char.is-picked');
    await sleep(60);
  }
  for (let guard = 0; guard < 6; guard++) {
    const picked = page.locator('.ps-pet.is-picked');
    if ((await picked.count()) === 0) break;
    await picked.first().scrollIntoViewIfNeeded();
    await tap(d, '.ps-pet.is-picked');
    await sleep(60);
  }
  for (const id of want.characters) {
    const name = getCharacter(id).name;
    const sel = `.ps-char[aria-label^="${name} "]`;
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await tap(d, sel);
    await sleep(80);
  }
  // pet cards carry no id: tap by name
  for (const id of want.pets) {
    const name = PETS.find(p => p.id === id)!.name;
    const loc = page.locator('.ps-pet', { has: page.locator('.ps-card-name', { hasText: name }) }).first();
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error(`no pet card ${name}`);
    await tapAt(d, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    await sleep(80);
  }
  const v = await page.evaluate(() => {
    const raw = localStorage.getItem('swapTower.preset.v1');
    return {
      badges: [...document.querySelectorAll('.ps-char.is-picked')].map(e => `${e.getAttribute('aria-label')?.split(' ')[0]}#${e.querySelector('.ps-badge')?.textContent}`),
      pets: document.querySelectorAll('.ps-pet.is-picked').length,
      saved: raw,
    };
  });
  L(d.key, 'preset picked', v.badges, 'pets', v.pets);
}

async function setNick(d: Dev, nick: string): Promise<void> {
  await tap(d, '.lb-name input');
  await d.page.keyboard.press('Control+A');
  await d.page.keyboard.type(nick);
  await d.page.keyboard.press('Enter');
  await sleep(150);
}

// ─────────────────────────── combat helpers ───────────────────────────

interface View {
  lp: number;
  state: GameState;
  f0: Vec2;
  fx: Vec2;
  fy: Vec2;
  lift: number;
  canvas: { x: number; y: number; w: number; h: number };
  vw: number;
  vh: number;
}

async function view(d: Dev): Promise<View | null> {
  return d.page
    .evaluate(() => {
      const api = window.__proto;
      if (!api || !api.game || api.phase !== 'combat') return null;
      let state: GameState;
      try {
        state = api.game.state;
      } catch {
        return null;
      }
      const c = document.querySelector('canvas.stage-canvas')!.getBoundingClientRect();
      const f0 = api.ui.fingerFor({ x: 0, y: 0 });
      const fx = api.ui.fingerFor({ x: 10, y: 0 });
      const fy = api.ui.fingerFor({ x: 0, y: 10 });
      return {
        lp: api.localPlayer,
        state: JSON.parse(JSON.stringify(state)) as GameState,
        f0,
        fx,
        fy,
        lift: 80 * (c.width / 1280),
        canvas: { x: c.x, y: c.y, w: c.width, h: c.height },
        vw: innerWidth,
        vh: innerHeight,
      };
    })
    .catch(() => null);
}

function fingerOf(v: View, w: Vec2): Vec2 {
  return {
    x: v.f0.x + ((v.fx.x - v.f0.x) * w.x) / 10 + ((v.fy.x - v.f0.x) * w.y) / 10,
    y: v.f0.y + ((v.fx.y - v.f0.y) * w.x) / 10 + ((v.fy.y - v.f0.y) * w.y) / 10,
  };
}
function onCanvas(v: View, c: Vec2, pad = 4): boolean {
  return c.x >= v.canvas.x + pad && c.x <= v.canvas.x + v.canvas.w - pad && c.y >= v.canvas.y + pad && c.y <= v.canvas.y + v.canvas.h - pad;
}
function worldVisible(v: View, w: Vec2): boolean {
  const f = fingerOf(v, w);
  return onCanvas(v, { x: f.x, y: f.y - v.lift }, 6);
}

type Unit = { id: number; pos: Vec2; radius: number; tier?: string; team: string; kind: string; hp: number; maxHp: number; ownerPlayer?: number | null };

function clampArena(s: GameState, p: Vec2): Vec2 {
  const a = s.plan.arena;
  const m = 0.6;
  return { x: Math.min(a.width - m, Math.max(m, p.x)), y: Math.min(a.height - m, Math.max(m, p.y)) };
}

function countHits(parts: PreviewPart[], drop: Vec2, units: Unit[], affects: 'enemies' | 'allies'): number {
  const hit = new Set<number>();
  for (const p of parts) {
    if (p.affects !== affects) continue;
    const c = { x: drop.x + p.offset.x, y: drop.y + p.offset.y };
    for (const u of units) if (hitsArea(p.area, c, drop, u.pos, u.radius ?? 0.4)) hit.add(u.id);
  }
  return hit.size;
}

function aimPlan(v: View, idx: number) {
  const s = v.state;
  const me = s.players[v.lp];
  const defId = me.party[idx].defId;
  const parts = previewPartsFor(s, v.lp, 'swap', idx);
  const ents = s.entities as unknown as Unit[];
  const foes = ents.filter(e => e.team === 'enemy' && e.hp > 0 && worldVisible(v, e.pos));
  const allies = ents.filter(e => e.team === 'ally' && e.kind === 'character' && e.hp > 0);
  const healer = !parts.some(p => p.affects === 'enemies');
  const affects: 'enemies' | 'allies' = healer ? 'allies' : 'enemies';
  const pool = healer ? allies : foes;
  // densest group (radius 2.5), weighted by tier
  let cluster: Vec2 | null = null;
  let bestN = 0;
  for (const f of pool) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const q of pool) {
      if (Math.hypot(q.pos.x - f.pos.x, q.pos.y - f.pos.y) > 2.5) continue;
      const w = healer ? 1 + (1 - q.hp / q.maxHp) * 3 : q.tier === 'mid' ? 2 : q.tier === 'boss' ? 3 : 1;
      n += w;
      sx += q.pos.x * w;
      sy += q.pos.y * w;
      sw += w;
    }
    if (n > bestN) {
      bestN = n;
      cluster = { x: sx / sw, y: sy / sw };
    }
  }
  const mine = me.activeIndex != null ? ents.find(e => e.id === me.party[me.activeIndex!].entityId) : undefined;
  const fallback = mine?.pos ?? { x: s.plan.arena.width / 2, y: s.plan.arena.height / 2 };
  const naive = clampArena(s, cluster ?? fallback);
  const off = AIM_OFFSET[defId] ?? { x: 0, y: 0 };
  const aimed = clampArena(s, cluster ? { x: cluster.x + off.x, y: cluster.y + off.y } : fallback);
  // perfect aim: grid over the visible field
  let best = { pos: aimed, n: countHits(parts, aimed, pool, affects) };
  const a = s.plan.arena;
  for (let x = 0.6; x <= a.width - 0.6; x += 0.3) {
    for (let y = 0.6; y <= a.height - 0.6; y += 0.3) {
      const p = { x, y };
      if (!worldVisible(v, p)) continue;
      const n = countHits(parts, p, pool, affects);
      if (n > best.n) best = { pos: p, n };
    }
  }
  return {
    defId,
    parts,
    pool,
    affects,
    foes: foes.length,
    cluster,
    aimed,
    naive,
    best,
    nAimed: countHits(parts, aimed, pool, affects),
    nNaive: countHits(parts, naive, pool, affects),
  };
}

/** Finger for a world drop point, nudged up if the finger would land on the HUD (cards / ult / pets). */
async function fingerFor(d: Dev, v: View, w: Vec2): Promise<{ finger: Vec2; world: Vec2; blocked: number } | null> {
  const cands: { finger: Vec2; world: Vec2 }[] = [];
  for (const dy of [0, -0.6, -1.2, -1.8, -2.4, 0.6]) {
    const ww = clampArena(v.state, { x: w.x, y: w.y + dy });
    cands.push({ finger: fingerOf(v, ww), world: ww });
  }
  const ok = await d.page.evaluate(
    fs => {
      const canvas = document.querySelector('canvas.stage-canvas');
      return fs.map(f => f.x > 6 && f.x < innerWidth - 6 && f.y > 6 && f.y < innerHeight - 4 && document.elementFromPoint(f.x, f.y) === canvas);
    },
    cands.map(c => c.finger),
  );
  const i = ok.indexOf(true);
  return i < 0 ? null : { ...cands[i], blocked: i };
}

const firstShotFor = new Set<string>();
let dropSeq = 0;

async function doSwap(d: Dev, others: Dev[], idx: number): Promise<void> {
  const v = await view(d);
  if (!v) return;
  const plan = aimPlan(v, idx);
  const f = await fingerFor(d, v, plan.aimed);
  if (!f) {
    L(d.key, 'no valid finger for', plan.defId, plan.aimed);
    return;
  }
  const from = await centerOf(d, `.ccard[data-idx="${idx}"]`);
  const me0 = v.state.players[v.lp];
  const swapsBefore = me0.stats.swaps;
  const dragBefore = me0.stats.damageBySource.drag;
  const release = await dragHold(d, from, f.finger);
  await sleep(140);
  const pv = await d.page.evaluate(() => window.__proto!.ui.dragPreview).catch(() => null);
  const key = `${d.key}:${plan.defId}`;
  const first = !NO_HOLD_SHOTS && !firstShotFor.has(key);
  if (first) {
    firstShotFor.add(key);
    await shot(d, `hold-${plan.defId}`);
  }
  // footprint at release time, on the freshest snapshot
  const v2 = (await view(d)) ?? v;
  const ents2 = v2.state.entities as unknown as Unit[];
  const pool2 = plan.affects === 'enemies' ? ents2.filter(e => e.team === 'enemy' && e.hp > 0) : ents2.filter(e => e.team === 'ally' && e.kind === 'character' && e.hp > 0);
  const previewHits = pv ? countHits(plan.parts, pv.pos, pool2, plan.affects) : -1;
  await release();
  const upAt = Date.now();
  const rec: DropRec = {
    dev: d.key,
    device: d.kind,
    char: plan.defId,
    floor: v.state.floor,
    foes: plan.foes,
    aimed: plan.nAimed,
    naive: plan.nNaive,
    best: plan.best.n,
    preview: previewHits,
    valid: !!pv?.valid,
    blocked: f.blocked,
    aimNote: `aim(${r2(plan.aimed.x)},${r2(plan.aimed.y)}) best(${r2(plan.best.pos.x)},${r2(plan.best.pos.y)}) pv(${pv ? `${r2(pv.pos.x)},${r2(pv.pos.y)}` : '-'})`,
    upAt,
  };
  report.drops.push(rec);
  const n = ++dropSeq;
  if (first) {
    const other = others.find(o => o.kind === 'phone' && !o.hold) ?? others[0];
    await sleep(Math.max(0, 230 - (Date.now() - upAt)));
    await Promise.all([shot(d, `impact-${plan.defId}`), other ? shot(other, `impact-${plan.defId}-by${d.key}`) : null]);
  }
  // latency + drag damage, a bit later
  setTimeout(async () => {
    try {
      const lat = await Promise.all(
        [d, ...others].map(async o => {
          if (o.hold) return null;
          const hit = await o.page
            .evaluate(
              ([pi, n]) => (window as unknown as { __pt: { swaps: { t: number; player: number; swaps: number }[] } }).__pt.swaps.find(x => x.player === pi && x.swaps > n)?.t ?? null,
              [v.lp, swapsBefore] as const,
            )
            .catch(() => null);
          return hit == null ? null : hit - upAt;
        }),
      );
      rec.appearSelf = lat[0] ?? undefined;
      rec.appearOthers = lat.slice(1);
      const after = await d.page.evaluate(lp => window.__proto!.game!.state.players[lp].stats.damageBySource.drag, v.lp).catch(() => null);
      if (after != null) rec.dragDmg = Math.round(after - dragBefore);
    } catch {
      /* page gone */
    }
  }, 1600);
  if (n % 6 === 1) L(d.key, `drop#${n}`, plan.defId, `hits aimed/naive/best/preview ${plan.nAimed}/${plan.nNaive}/${plan.best.n}/${previewHits}`, `foes ${plan.foes}`, f.blocked ? `nudged ${f.blocked}` : '');
}

async function doPet(d: Dev): Promise<void> {
  const v = await view(d);
  if (!v) return;
  const ready = await d.page.evaluate(lp => [0, 1, 2].filter(i => window.__proto!.game!.canUsePet(lp, i).ok), v.lp);
  if (!ready.length) return;
  const i = ready[0];
  const ents = v.state.entities as unknown as Unit[];
  const foes = ents.filter(e => e.team === 'enemy' && e.hp > 0 && worldVisible(v, e.pos));
  if (foes.length < 3) return;
  const c = foes.reduce((a, e) => ({ x: a.x + e.pos.x / foes.length, y: a.y + e.pos.y / foes.length }), { x: 0, y: 0 });
  const f = await fingerFor(d, v, c);
  if (!f) return;
  const rel = await dragHold(d, await centerOf(d, `.pcard >> nth=${i}`), f.finger, 10);
  await sleep(90);
  await rel();
}

async function tryUlt(d: Dev): Promise<boolean> {
  const can = await d.page.evaluate(() => {
    const api = window.__proto!;
    const s = api.game!.state;
    const me = s.players[api.localPlayer];
    return me.activeIndex != null && me.party[me.activeIndex].ult.charge >= 1 && !me.out;
  });
  if (!can) return false;
  await tap(d, '.ult');
  return true;
}

async function playerLoop(d: Dev, others: () => Dev[], stop: () => boolean): Promise<void> {
  while (!stop()) {
    await sleep(rand(1500, 2800));
    if (stop()) break;
    if (d.hold || d.busy) continue;
    d.busy = true;
    try {
      const ph = await phaseOf(d);
      if (ph !== 'combat') continue;
      const st = await d.page.evaluate(() => {
        const api = window.__proto!;
        const s = api.game!.state;
        const me = s.players[api.localPlayer];
        return { phase: s.phase, out: me.out, ready: [0, 1, 2].filter(i => api.game!.canSwap(api.localPlayer, i).ok), active: me.activeIndex };
      });
      if (st.phase !== 'combat' || st.out) continue;
      d.iter++;
      if (await tryUlt(d)) await sleep(300);
      if (d.iter % 3 === 0) await doPet(d);
      if (st.ready.length) {
        // rotate through the party so every card gets used
        const order = [1, 2, 0].map(k => (d.lastCard + k) % 3);
        const idx = order.find(i => st.ready.includes(i))!;
        d.lastCard = idx;
        await doSwap(d, others().filter(o => o !== d), idx);
      }
    } catch (e) {
      L(d.key, 'loop error', String(e).slice(0, 160));
    } finally {
      d.busy = false;
    }
  }
}

async function frameStatsOf(d: Dev, since: number): Promise<Record<string, number> | null> {
  return d.page
    .evaluate(t0 => {
      const P = (window as unknown as { __pt: { frames: [number, number][]; longTasks: number; snapGaps: number[]; smooth: Record<string, number> } }).__pt;
      const fr = P.frames.filter(([t]) => t >= t0).map(([, dt]) => dt);
      if (!fr.length) return null;
      const s = [...fr].sort((a, b) => a - b);
      const sum = fr.reduce((a, b) => a + b, 0);
      const g = [...P.snapGaps].sort((a, b) => a - b);
      const sm = P.smooth;
      return {
        fps: +(fr.length / (sum / 1000)).toFixed(1),
        p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
        max: +s[s.length - 1].toFixed(1),
        over50: fr.filter(x => x > 50).length,
        longTasks: P.longTasks,
        snapP50: g.length ? +g[Math.floor(g.length / 2)].toFixed(1) : -1,
        snapP95: g.length ? +g[Math.floor(g.length * 0.95)].toFixed(1) : -1,
        snapMax: g.length ? +g[g.length - 1].toFixed(1) : -1,
        movingFrames: sm.moving,
        stallPct: sm.moving ? +((100 * sm.stalls) / sm.moving).toFixed(2) : 0,
        jumpPct: sm.moving ? +((100 * sm.jumps) / sm.moving).toFixed(2) : 0,
        jerk: sm.dsum ? +(sm.dd / sm.dsum).toFixed(3) : 0,
      };
    }, since)
    .catch(() => null);
}

async function resetSmooth(d: Dev): Promise<number> {
  return d.page
    .evaluate(() => {
      const P = (window as unknown as { __pt: { smooth: Record<string, number>; snapGaps: number[] } }).__pt;
      P.smooth = { moving: 0, stalls: 0, jumps: 0, dsum: 0, dd: 0 };
      P.snapGaps = [];
      return performance.now();
    })
    .catch(() => 0);
}

async function gameSnap(d: Dev) {
  return d.page
    .evaluate(() => {
      const api = window.__proto;
      const g = api?.game;
      if (!g) return null;
      try {
        const s = g.state;
        return {
          app: api!.phase,
          phase: s.phase,
          floor: s.floor,
          kind: s.plan.kind,
          t: +s.floorTime.toFixed(1),
          left: +s.timeRemaining.toFixed(1),
          alive: s.monstersAlive,
          ents: s.entities.length,
          players: s.players.map(p => ({ n: p.name, bot: p.isBot, dc: !!p.disconnected, out: p.out, swaps: p.stats.swaps, dead: p.party.filter(m => m.dead).length, dmg: Math.round(p.stats.damageDealt) })),
          result: s.runResult,
        };
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

// ─────────────────────────── scenario ───────────────────────────

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-gpu'] });
  const A = await openDev(browser, 'A', '에이', 'phone');
  const B = await openDev(browser, 'B', '비', 'phone');
  const C = await openDev(browser, 'C', '씨데스크탑', 'desktop');
  const devs = [A, B, C];
  try {
    // ── 편성 (real taps on the preset screen) ──
    await shot(A, 'preset');
    for (const d of devs) await pickPresetViaUi(d, PRESETS[SET][d.key]);
    await shot(A, 'preset-picked');

    // ── 매칭: A creates, B joins by code, C joins from the list ──
    let t = Date.now();
    await tap(A, '.btn-start');
    await waitPhase(A, 'lobby');
    await A.page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10000 });
    L('A preset→lobby online', Date.now() - t, 'ms');
    await setNick(A, A.nick);
    await shot(A, 'lobby-empty');
    t = Date.now();
    await tap(A, '.lb-create');
    await waitPhase(A, 'room');
    L('A create→room', Date.now() - t, 'ms');
    const code = (await A.page.evaluate(() => window.__proto!.net.roomCode))!;
    await shot(A, 'room-host-alone');

    await tap(B, '.btn-start');
    await waitPhase(B, 'lobby');
    await B.page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10000 });
    await setNick(B, B.nick);
    await tap(B, '.lb-code-input');
    await B.page.keyboard.type(code.toLowerCase(), { delay: 60 });
    await shot(B, 'lobby-code-typed');
    t = Date.now();
    await tap(B, '.lb-join');
    await waitPhase(B, 'room');
    L('B join by code→room', Date.now() - t, 'ms');

    await tap(C, '.btn-start');
    await waitPhase(C, 'lobby');
    await C.page.waitForFunction(() => window.__proto?.net.status === 'online', undefined, { timeout: 10000 });
    await setNick(C, C.nick);
    await C.page.locator(`.lb-room-row[data-code="${code}"]`).waitFor({ timeout: 8000 });
    await shot(C, 'lobby-list');
    t = Date.now();
    await tap(C, `.lb-room-row[data-code="${code}"]`);
    await waitPhase(C, 'room');
    L('C join from list→room', Date.now() - t, 'ms');
    await sleep(400);
    await Promise.all(devs.map(d => shot(d, 'room-full')));

    // B changes its party from the room (프리셋 변경 → preset → 출발 → back in the room)
    t = Date.now();
    await tap(B, '.lb-preset');
    await waitPhase(B, 'preset');
    await shot(B, 'preset-from-room');
    await tap(B, '.btn-start');
    await waitPhase(B, 'room');
    L('B 프리셋 변경 round trip', Date.now() - t, 'ms');

    // ── 시작 ──
    t = Date.now();
    await tap(A, '.lb-start');
    await Promise.all(devs.map(d => waitPhase(d, 'combat', 20000)));
    L('start → combat on all', Date.now() - t, 'ms');
    const lps = await Promise.all(devs.map(d => d.page.evaluate(() => [window.__proto!.mode, window.__proto!.localPlayer])));
    L('mode/localPlayer', lps);
    await sleep(700);
    await Promise.all(devs.map(d => shot(d, 'combat-start')));

    // host: 2× through the real debug panel
    await tap(A, '.btn-dbg');
    await A.page.waitForSelector('.debug-panel:not(.is-hidden)');
    await sleep(250);
    await shot(A, 'debug-panel');
    const sp = A.page.locator('.dbg-speed', { hasText: `${SPEED}×` }).first();
    const spb = await sp.boundingBox();
    if (spb) await tapAt(A, { x: spb.x + spb.width / 2, y: spb.y + spb.height / 2 });
    await sleep(150);
    await tap(A, '.debug-panel .dbg-hbtn:has-text("✕")');
    await sleep(600);
    const speeds = await Promise.all(devs.map(d => d.page.evaluate(() => window.__proto!.game!.tunables.gameSpeed)));
    L('gameSpeed on A/B/C', speeds);

    // ── floors ──
    let stopAll = false;
    const loops = devs.map(d => playerLoop(d, () => devs, () => stopAll));
    let floor = 1;
    let floorT0 = Date.now();
    let fpsSince = await Promise.all(devs.map(d => resetSmooth(d)));
    let scenarioDone: Record<string, boolean> = {};
    let lastLog = 0;
    while (!STRESS_ONLY) {
      await sleep(500);
      const s = await gameSnap(A);
      if (!s) continue;
      if (Date.now() - lastLog > 8000) {
        lastLog = Date.now();
        L('A sees', { f: s.floor, ph: s.phase, t: s.t, left: s.left, alive: s.alive, ents: s.ents, players: s.players });
      }
      // disconnect test: floor 2, ~6 s in: B goes offline (tunnel / elevator) for 8 s
      if (s.floor === 2 && s.phase === 'combat' && s.t > 8 && !scenarioDone.offline) {
        scenarioDone.offline = true;
        await offlineTest(A, B, C);
      }
      // tab-close test: floor 4, B's tab is killed, reopened 4 s later
      if (s.floor === 4 && s.phase === 'combat' && s.t > 8 && !scenarioDone.reopen) {
        scenarioDone.reopen = true;
        await reopenTest(browser, A, B);
      }
      if (s.phase === 'reward' || s.phase === 'runOver' || s.floor !== floor) {
        const fpsRows = await Promise.all(devs.map(d => frameStatsOf(d, fpsSince[devs.indexOf(d)])));
        const rec = { floor, wallSec: r2((Date.now() - floorT0) / 1000), simSec: s.t, outcome: s.phase, fps: Object.fromEntries(devs.map((d, i) => [d.key, fpsRows[i]])), players: s.players };
        report.floors.push(rec);
        L('floor end', JSON.stringify(rec));
        if (s.phase === 'runOver') break;
        if (s.phase === 'reward') {
          await rewardRound(devs, s.floor);
          if (s.floor >= MAX_FLOOR) break;
        }
        if ((await gameSnap(A))?.phase === 'goedam') await goedamRound(devs);
        const s2 = await gameSnap(A);
        floor = s2?.floor ?? floor + 1;
        floorT0 = Date.now();
        fpsSince = await Promise.all(devs.map(d => resetSmooth(d)));
      }
    }

    // ── stress: many monsters with 3 players dragging ──
    const s3 = await gameSnap(A);
    if (s3 && s3.phase === 'combat') {
      // floor 4 has 8 waves (≈40 monsters): with waves 1 s apart and ×4 HP most of them are alive at once
      await A.page.evaluate(stressOnly => {
        const t = window.__proto!.game!.tunables;
        t.waveInterval = 1;
        t.maxAliveMonsters = 45;
        t.monsterHpMult = 4;
        t.gameSpeed = 1;
        if (stressOnly) t.invincible = true;
      }, STRESS_ONLY);
      L('stress tunables sent');
      if (STRESS_ONLY) {
        // the wave plan is made at floor start: jump AFTER the tunables reached the server
        await sleep(800);
        await A.page.evaluate(() => window.__proto!.game!.dispatch({ type: 'debug', action: { kind: 'jumpFloor', floor: 4 } }));
        await sleep(1000);
      }
      let since: number[] | null = null;
      let stressSec = 0;
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const s = await gameSnap(A);
        if (i % 5 === 0) L('stress poll', { f: s?.floor, ph: s?.phase, alive: s?.alive, ents: s?.ents, t: s?.t });
        if (!s || s.phase !== 'combat') break;
        if (since == null && s.alive >= 25) {
          since = await Promise.all(devs.map(d => resetSmooth(d)));
          L('stress window starts, alive', s.alive, 'ents', s.ents);
          await Promise.all(devs.map(d => shot(d, 'stress')));
        }
        if (since && ++stressSec >= 20) break;
      }
      if (since) {
        const s = await gameSnap(A);
        const rows = await Promise.all(devs.map((d, i) => frameStatsOf(d, since![i])));
        report.stress = { alive: s?.alive, ents: s?.ents, fps: Object.fromEntries(devs.map((d, i) => [d.key, rows[i]])) };
        L('stress', JSON.stringify(report.stress));
      }
    }

    // ── host ends the run → result on all ──
    stopAll = true;
    await Promise.all(loops);
    const live = devs.filter(d => !d.page.isClosed());
    t = Date.now();
    if ((await phaseOf(A)) === 'combat') {
      await tap(A, '[aria-label="일시정지"]');
      await sleep(300);
      await shot(A, 'menu');
      await tap(A, '.pause-btns .btn-danger');
      await sleep(200);
      await tap(A, '.pause-btns .btn-danger');
    }
    await Promise.all(live.map(d => waitPhase(d, 'result', 20000).catch(() => L(d.key, 'no result screen'))));
    L('host quit → result on all', Date.now() - t, 'ms');
    await sleep(600);
    await Promise.all(live.map(d => shot(d, 'result')));
    report.telemetry = Object.fromEntries(
      await Promise.all(live.map(async d => [d.key, await d.page.evaluate(() => window.__proto!.game!.telemetry()).catch(() => null)] as const)),
    );
    report.finalPlayers = await A.page.evaluate(() =>
      window.__proto!.game!.state.players.map(p => ({ name: p.name, party: p.party.map(m => m.defId), stats: { ...p.stats } })),
    );
    // back to the room; C leaves the room
    await tap(A, '.rs-foot .btn-primary');
    await waitPhase(A, 'room').catch(() => L('A not back in room'));
    await tap(B, '.rs-foot .btn-primary').catch(() => {});
    await waitPhase(B, 'room').catch(() => L('B not back in room'));
    const leaveBtn = C.page.locator('.rs-foot .btn-secondary');
    if (await leaveBtn.count()) {
      L('C result secondary button:', await leaveBtn.first().textContent());
      await tap(C, '.rs-foot .btn-secondary');
    }
    await sleep(2500);
    await Promise.all(live.map(d => shot(d, 'after-result')));
    L('phases after', await Promise.all(live.map(d => phaseOf(d))));
  } catch (e) {
    L('FAILED', String(e));
    await Promise.all(devs.map(d => shot(d, 'failure').catch(() => '')));
    report.failure = String(e);
  } finally {
    for (const d of devs) report.errors[d.key] = d.errors;
    fs.writeFileSync(`${OUT}/mp-${TAG}-report.json`, JSON.stringify(report, null, 1));
    summarize();
    await browser.close();
  }
}

async function rewardRound(devs: Dev[], floor: number): Promise<void> {
  const [A, B, C] = devs;
  const t0 = Date.now();
  await Promise.all(devs.map(d => d.page.waitForSelector('.rw-card', { timeout: 15000 }).catch(() => L(d.key, 'no reward cards'))));
  L(`reward floor ${floor}: cards on all after`, Date.now() - t0, 'ms');
  await sleep(700);
  if (floor === 1) await Promise.all(devs.map(d => shot(d, 'reward')));
  const pick = async (d: Dev, i: number) => {
    const cards = d.page.locator('.rw-card');
    if ((await cards.count()) === 0) return;
    const b = await cards.nth(Math.min(i, (await cards.count()) - 1)).boundingBox();
    if (b) await tapAt(d, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  };
  await pick(A, 0);
  await sleep(500);
  const waitTxt = await A.page.locator('.rw-wait-text').textContent().catch(() => null);
  L('A wait text', waitTxt);
  if (floor === 1 || floor === 3) await shot(A, `reward-wait-f${floor}`);
  await sleep(2500);
  await pick(B, 1);
  if (floor === 3) {
    // C walks away: the server auto-picks at the deadline
    const tC = Date.now();
    await sleep(11000);
    const timerTxt = await C.page.locator('.rw-timer').textContent().catch(() => null);
    L('C timer text ~14 s in', timerTxt);
    await shot(C, 'reward-timer-c');
    await shot(B, 'reward-wait-b');
    await C.page.waitForFunction(() => window.__proto?.game?.state.phase === 'combat', undefined, { timeout: 30000 }).catch(() => L('C never left reward'));
    L(`reward floor 3: auto-pick after C idle`, Date.now() - tC, 'ms', 'total', Date.now() - t0, 'ms');
  } else {
    await sleep(2500);
    await pick(C, 2);
  }
  await Promise.all(devs.map(d => d.page.waitForFunction(() => window.__proto?.game?.state.phase !== 'reward', undefined, { timeout: 30000 }).catch(() => L(d.key, 'stuck in reward'))));
  L(`reward floor ${floor} done in`, Date.now() - t0, 'ms');
}

/** The room's visible option ids for this page's player (null when the page is not in a 괴담 room). */
function goedamOptionsOf(d: Dev): Promise<{ room: string; floor: number; options: string[] } | null> {
  return d.page
    .evaluate(() => {
      const api = window.__proto!;
      const g = api.game?.state.goedam;
      const pr = g?.players[api.localPlayer];
      return g && pr ? { room: g.roomId, floor: g.floor, options: pr.options.filter(o => !o.hidden).map(o => o.id) } : null;
    })
    .catch(() => null);
}

/** Tap option `id` (real input), then 계속 once the result card is up. */
async function goedamPick(d: Dev, id: string): Promise<void> {
  await d.page.waitForSelector('.gd-options:not(.is-arming) .gd-opt', { timeout: 15000 }); // option taps count from ARM_MS
  await tap(d, `.gd-opt[data-option="${id}"]`);
  await d.page.waitForSelector('.gd-continue', { state: 'visible', timeout: 15000 });
  await sleep(600);
  await tap(d, '.gd-continue');
}

/** 기획 10차: one 괴담 room with three humans — A bold, B by GOEDAM, C idle until the server's 25 s deadline. */
async function goedamRound(devs: Dev[]): Promise<void> {
  const [A, B, C] = devs;
  const t0 = Date.now();
  await Promise.all(devs.map(d => d.page.waitForSelector('.gd-opt', { timeout: 15000 }).catch(() => L(d.key, 'no room options'))));
  const views = await Promise.all(devs.map(d => goedamOptionsOf(d)));
  L('goedam room', views[0]?.room, 'after floor', views[0]?.floor, 'options on all after', Date.now() - t0, 'ms');
  await sleep(700);
  await Promise.all(devs.map(d => shot(d, 'goedam')));
  const policy = env.GOEDAM ?? 'leave';
  const bOpts = views[1]?.options ?? ['leave'];
  const bPick = policy === 'first' ? bOpts[0] : policy === 'random' ? bOpts[Math.floor(Math.random() * bOpts.length)] : 'leave';
  await goedamPick(A, views[0]?.options[0] ?? 'leave');
  await sleep(400);
  const others = await A.page.locator('.gd-other').allTextContents().catch(() => []);
  L('A others rows after its pick', others);
  await shot(A, 'goedam-result');
  await goedamPick(B, bPick);
  await sleep(500);
  const waitTxt = await A.page.locator('.gd-wait-text').textContent().catch(() => null);
  const timerTxt = await C.page.locator('.gd-timer').textContent().catch(() => null);
  L('A wait text', waitTxt, '· C timer', timerTxt);
  await shot(A, 'goedam-wait');
  await shot(C, 'goedam-timer-c');
  const tC = Date.now();
  await C.page.waitForFunction(() => window.__proto?.game?.state.phase !== 'goedam', undefined, { timeout: 45000 }).catch(() => L('C never left the room'));
  const cLog = await A.page.evaluate(() => window.__proto!.game!.state.players[2].goedamLog.at(-1) ?? null).catch(() => null);
  L('goedam: C timed out after', Date.now() - tC, 'ms; C log', cLog, '; total', Date.now() - t0, 'ms');
  report.goedam = { room: views[0]?.room, floor: views[0]?.floor, others, waitTxt, timerTxt, cTimeoutMs: Date.now() - tC, cLog, totalMs: Date.now() - t0 };
  await Promise.all(devs.map(d => d.page.waitForFunction(() => window.__proto?.game?.state.phase !== 'goedam', undefined, { timeout: 10000 }).catch(() => L(d.key, 'stuck in goedam'))));
}

async function offlineTest(A: Dev, B: Dev, C: Dev): Promise<void> {
  B.hold = true;
  while (B.busy) await sleep(50);
  const t0 = Date.now();
  await B.ctx.setOffline(true);
  L('B offline');
  let botAt: number | null = null;
  let bannerAt: number | null = null;
  for (let i = 0; i < 40 && (botAt == null || bannerAt == null); i++) {
    await sleep(250);
    if (botAt == null && (await A.page.evaluate(() => window.__proto!.game!.state.players[1].isBot).catch(() => false))) botAt = Date.now() - t0;
    if (bannerAt == null && (await B.page.locator('.net-banner:not(.is-hidden)').count().catch(() => 0))) bannerAt = Date.now() - t0;
  }
  L('offline: A sees BOT after', botAt, 'ms; B banner after', bannerAt, 'ms');
  await shot(B, 'offline-b');
  await shot(A, 'offline-bot-a');
  // B tries to swap while offline
  const tryRes = await B.page.evaluate(() => {
    const api = window.__proto!;
    const i = [0, 1, 2].find(k => api.game!.canSwap(api.localPlayer, k).ok) ?? 0;
    return api.ui.dragTo('swap', i, { x: 10, y: 6 });
  }).catch(e => ({ ok: false, reason: String(e) }));
  L('B swap while offline →', tryRes);
  await sleep(Math.max(0, 8000 - (Date.now() - t0)));
  const t1 = Date.now();
  await B.ctx.setOffline(false);
  L('B online again');
  let backAt: number | null = null;
  let bannerGone: number | null = null;
  for (let i = 0; i < 120 && (backAt == null || bannerGone == null); i++) {
    await sleep(250);
    if (backAt == null && (await A.page.evaluate(() => window.__proto!.game!.state.players[1].isBot === false).catch(() => false))) backAt = Date.now() - t1;
    if (bannerGone == null && !(await B.page.locator('.net-banner:not(.is-hidden)').count().catch(() => 1))) bannerGone = Date.now() - t1;
  }
  L('reconnect: A sees human again after', backAt, 'ms; B banner gone after', bannerGone, 'ms');
  report.offline = { botAfterMs: botAt, bannerAfterMs: bannerAt, swapWhileOffline: tryRes, backAfterMs: backAt, bannerGoneMs: bannerGone };
  await shot(B, 'back-online-b');
  void C;
  B.hold = false;
}

async function reopenTest(browser: Browser, A: Dev, B: Dev): Promise<void> {
  void browser;
  B.hold = true;
  while (B.busy) await sleep(50);
  const t0 = Date.now();
  await B.page.close();
  let botAt: number | null = null;
  for (let i = 0; i < 40 && botAt == null; i++) {
    await sleep(100);
    if (await A.page.evaluate(() => window.__proto!.game!.state.players[1].isBot).catch(() => false)) botAt = Date.now() - t0;
  }
  L('tab closed: A sees BOT after', botAt, 'ms');
  await shot(A, 'tabclosed-bot-a');
  await sleep(4000);
  const t1 = Date.now();
  await attachPage(B, await B.ctx.newPage());
  await B.page.goto(BASE);
  let landed: string | null = null;
  try {
    await B.page.waitForFunction(() => window.__proto?.phase === 'combat' || window.__proto?.phase === 'spectate', undefined, { timeout: 15000 });
  } catch {
    /* reported below */
  }
  landed = await phaseOf(B);
  const inCombat = Date.now() - t1;
  let humanAt: number | null = null;
  for (let i = 0; i < 40 && humanAt == null; i++) {
    if (await A.page.evaluate(() => window.__proto!.game!.state.players[1].isBot === false).catch(() => false)) humanAt = Date.now() - t1;
    else await sleep(100);
  }
  L('reopen: B lands on', landed, 'after', inCombat, 'ms; A sees human after', humanAt, 'ms');
  report.reopen = { botAfterMs: botAt, landed, combatAfterMs: inCombat, humanAfterMs: humanAt };
  await sleep(500);
  await shot(B, 'reopened-b');
  B.hold = false;
}

function summarize(): void {
  const by = new Map<string, DropRec[]>();
  for (const r of report.drops) {
    const k = r.char;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }
  const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : NaN);
  const rows: Record<string, unknown>[] = [];
  for (const [k, all] of by) {
    const rs = all.filter(r => r.foes > 0);
    if (!rs.length) continue;
    rows.push({
      char: k,
      n: rs.length,
      zeroFoeDrops: all.length - rs.length,
      foes: avg(rs.map(r => r.foes)),
      aimed: avg(rs.map(r => r.aimed)),
      naive: avg(rs.map(r => r.naive)),
      best: avg(rs.map(r => r.best)),
      preview: avg(rs.map(r => r.preview).filter(x => x >= 0)),
      dragDmg: avg(rs.map(r => r.dragDmg ?? NaN).filter(Number.isFinite)),
      nudged: rs.filter(r => r.blocked > 0).length,
      invalid: rs.filter(r => !r.valid).length,
    });
  }
  report.byChar = rows;
  const lat = report.drops.filter(r => r.appearSelf != null);
  const pct = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
  };
  const self = lat.map(r => r.appearSelf!);
  const oth = lat.flatMap(r => (r.appearOthers ?? []).filter((x): x is number => x != null));
  report.latency = { n: lat.length, selfP50: pct(self, 0.5), selfP90: pct(self, 0.9), selfMax: pct(self, 1), othersP50: pct(oth, 0.5), othersP90: pct(oth, 0.9), othersMax: pct(oth, 1) };
  console.log('\n=== by character ===');
  console.table(rows);
  console.log('latency (ms, pointerup → swap visible in state on screen):', JSON.stringify(report.latency));
  for (const [k, e] of Object.entries(report.errors)) console.log(`errors ${k}:`, e.length ? e.slice(0, 8) : 'none');
}

main().catch(e => {
  console.error(e);
});
