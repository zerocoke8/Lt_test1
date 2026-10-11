// 기획 19차 보스 레이드 (review): all 20 bosses as the PLAYER sees them — the real game on a phone screen (844×390) with
// the HUD and the party around the boss. boss-sheet.mjs shows the art alone (a sandbox without the HUD); this one shows
// what is still readable in a fight (a boss hidden by the party or by the HUD shows up here).
// 기획 20차: a fixed boss is caught on its first warning, as before. A moving boss (배회형 · 자리 이동형 · 전장형) is caught
// on a warning AFTER it has travelled 3 cells or more from where it appeared (it must be found again once it moved) —
// or, when it never gets that far (a boss the party walks up to), on the first warning after `patience` seconds. The
// label says the form and how far it went. The console prints, per moving boss, how much of its body the HUD covers.
//
//   node tests/visual/boss-phone-sheet.mjs                       → <temp>/bosses-phone.png
//   node tests/visual/boss-phone-sheet.mjs out=docs/screenshots/bosses-20-phone.png
//   node tests/visual/boss-phone-sheet.mjs only=xray_machine,thunder_antenna scale=1 patience=20 port=5201
//
// It starts its own Vite dev server (no build needed) and plays each boss alone on its zone's first floor (invincible
// party, real time, 6–20 s a boss).
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bossList, openGame, parseArgs, startBoss, writeSheet } from './bossLive.mjs';

const args = parseArgs(process.argv);
const OUT = args.out ?? process.env.OUT ?? path.join(tmpdir(), 'bosses-phone.png');
const ONLY = args.only ? args.only.split(',') : null;
/** Tile size = the phone screen × this (0.5 → 422×195 a boss, 5 a row = one zone). */
const SCALE = Number(args.scale ?? 0.5);
/** A moving boss must have travelled this far (cells, along its path) before its picture is taken … */
const TRAVEL = Number(args.travel ?? 3);
/** … or this many seconds have passed (then the next warning is taken anyway). */
const PATIENCE = Number(args.patience ?? 16);

/** A warning that hurts, a little into its countdown (the banner is gone by then). */
const warningOn = () => window.__proto.game.state.telegraphs.some(t => t.team === 'enemy' && !t.self && t.remaining / t.total < 0.6);

/** In the page: sum the boss's path every 50 ms (a relocate counts as its straight jump). */
const trackTravel = () => {
  clearInterval(window.__travelTimer);
  const tr = (window.__travel = { dist: 0, last: null });
  window.__travelTimer = setInterval(() => {
    const s = window.__proto.game?.state;
    const b = s && s.bossId != null ? s.entities.find(e => e.id === s.bossId) : null;
    if (!b) return;
    if (tr.last) tr.dist += Math.hypot(b.pos.x - tr.last.x, b.pos.y - tr.last.y);
    tr.last = { x: b.pos.x, y: b.pos.y };
  }, 50);
};

/** In the page: how much of the moving boss's body box the HUD blocks cover (share of the box, 0..1) and which one most. */
const hudOverlap = async () => {
  const cam = await import('/src/render/camera.ts');
  const body = await import('/src/render/bosses/body.ts');
  const s = window.__proto.game.state;
  const b = s.entities.find(e => e.id === s.bossId);
  if (!b) return null;
  const stage = document.querySelector('.stage').getBoundingClientRect();
  const k = stage.width / 1280;
  const box = body.bodyBox(b.defId);
  const flat = !!body.bossBody(b.defId).flat;
  // world → client px: x through the game's own helper, y from the camera constants (the camera never moves in a raid)
  const cx = window.__proto.ui.fingerFor(b.pos).x;
  const cy = stage.top + (cam.GROUND_TOP + b.pos.y * cam.PX_PER_UNIT_Y) * k;
  const w = box.w * k;
  const h = (flat ? b.radius * 2 * cam.PX_PER_UNIT_Y : box.h) * k;
  const r = { l: cx - w / 2, r: cx + w / 2, t: flat ? cy - h / 2 : cy - h, b: flat ? cy + h / 2 : cy };
  const area = Math.max(1, (r.r - r.l) * (r.b - r.t));
  const hits = [];
  for (const el of document.querySelectorAll('.hud .hud-block, .hud .boss-raid, .hud .boss-form, .hud .boss-cast, .hud .toast')) {
    if (el.offsetParent === null) continue;
    const e = el.getBoundingClientRect();
    const ow = Math.min(r.r, e.right) - Math.max(r.l, e.left);
    const oh = Math.min(r.b, e.bottom) - Math.max(r.t, e.top);
    if (ow > 0 && oh > 0) hits.push({ block: [...el.classList].filter(c => c !== 'hud-block' && !c.startsWith('is-'))[0] ?? el.className, share: (ow * oh) / area });
  }
  hits.sort((a, c) => c.share - a.share);
  return { x: +b.pos.x.toFixed(1), y: +b.pos.y.toFixed(1), covered: Math.min(1, hits.reduce((n, x) => n + x.share, 0)), worst: hits[0]?.block ?? '' };
};

const game = await openGame(args.port);
const { page, errors } = game;
const shots = [];
const table = [];
try {
  const all = await bossList(page);
  const list = ONLY ? all.filter(b => ONLY.includes(b.id)) : all;
  for (const b of list) {
    await startBoss(page, b);
    const moving = b.form !== 'fixed';
    let travelled = 0;
    let far = true;
    if (moving) {
      await page.evaluate(trackTravel);
      far = await page
        .waitForFunction(need => window.__travel.dist >= need, TRAVEL, { timeout: PATIENCE * 1000 })
        .then(() => true)
        .catch(() => false);
    }
    // the first warning that hurts (after the travel, for a moving boss); 8 s at most
    await page.waitForFunction(warningOn, null, { timeout: 8000 }).catch(() => {});
    const png = await page.screenshot();
    if (moving) {
      travelled = await page.evaluate(() => window.__travel.dist);
      const o = await page.evaluate(hudOverlap);
      table.push({ boss: b.name, form: b.formLabel, travelled: +travelled.toFixed(1), at: o ? `${o.x}, ${o.y}` : '-', 'HUD covers': o ? `${Math.round(o.covered * 100)}%` : '-', by: o?.worst ?? '' });
    }
    const note = moving ? ` · ${travelled.toFixed(1)}칸 이동${far ? '' : ` (${TRAVEL}칸 못 감)`}` : '';
    shots.push({ png, label: `${b.name} · ${b.formLabel} · ${b.floor}층${note}` });
    console.log(`${b.id} ${b.name} · ${b.formLabel}${note}`);
  }
  await page.evaluate(() => clearInterval(window.__travelTimer));
  await writeSheet(page, shots, OUT, { scale: SCALE });
  if (table.length) {
    console.log('\nmoving bosses — how much of the body box the HUD covers at the shot:');
    console.table(table);
  }
  console.log(OUT);
} finally {
  await game.close();
}
if (errors.length) {
  console.log('ERRORS', errors);
  process.exitCode = 1;
}
