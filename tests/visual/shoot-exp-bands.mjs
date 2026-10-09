// 기획 15차 원정: gear in a real battle at the 4 tier bands (T1 낡은 · T4 강화 · T7 퇴마 · T10 심연, every slot + a relic),
// as a 2×2 contact sheet at phone size → docs/screenshots/expedition-gear-bands.png.
// 1) npx vite build --outDir dist-shots && npx vite preview --outDir dist-shots --port 4199
// 2) BASE=http://localhost:4199/ node tests/visual/shoot-exp-bands.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4199/';
const OUT = process.env.OUT ?? 'docs/screenshots/expedition-gear-bands.png';
const LIFT = 80; // src/ui/drag.ts
const BANDS = [
  { tier: 1, relicTier: 3, relic: 'vanguard_helm', label: '묶음 1 · 낡은 (T1~3)', color: '#adb5bd' },
  { tier: 4, relicTier: 6, relic: 'relay_flag', label: '묶음 2 · 강화 (T4~6)', color: '#4cc9f0' },
  { tier: 7, relicTier: 9, relic: 'echo_seal', label: '묶음 3 · 퇴마 (T7~9)', color: '#c77dff' },
  { tier: 10, relicTier: 12, relic: 'phoenix_feather', label: '묶음 4 · 심연 (T10~12)', color: '#ffd166' },
];
const PARTIES = [
  { name: '나', characters: ['blade', 'guardian', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] },
  { name: 'BOT 1', characters: ['ranger', 'guardian', 'cleric'], pets: ['frog_bomb', 'turtle_guard', 'owl_frost'] },
  { name: 'BOT 2', characters: ['mage', 'blade', 'berserker'], pets: ['fairy_heal', 'cat_void', 'drum_raccoon'] },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text()));

const shots = [];
for (const b of BANDS) {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__proto?.phase === 'preset');
  const loadout = { weapon: { slot: 'weapon', tier: b.tier, rarity: 'common' }, armor: { slot: 'armor', tier: b.tier, rarity: 'common' }, charm: { slot: 'charm', tier: b.tier, rarity: 'common' }, relic: { slot: 'relic', tier: b.relicTier, rarity: 'rare', relicId: b.relic } };
  await page.evaluate(
    ({ parties, loadout }) => {
      window.__proto.startRun({
        players: parties.map((p, i) => ({ ...p, isBot: i > 0, gear: [loadout, loadout, loadout] })),
        expedition: { stage: 1 },
        tunables: { invincible: true },
      });
    },
    { parties: PARTIES, loadout },
  );
  await page.waitForFunction(() => window.__proto?.phase === 'combat');
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.__proto.setPaused(true));
  // the battle only: no pause menu, no HUD over the heroes
  await page.evaluate(() => {
    document.querySelector('.pause')?.classList.add('is-hidden');
    for (const el of document.querySelectorAll('.layer-hud, .layer-top')) el.style.visibility = 'hidden';
  });
  await page.waitForTimeout(200);
  // the box around the three heroes on the field
  const pts = await page.evaluate(() => {
    const s = window.__proto.ui.drawState ?? window.__proto.game.state;
    return s.entities.filter(e => e.kind === 'character' && e.ownerPlayer != null && e.hp > 0).map(e => window.__proto.ui.fingerFor(e.pos));
  });
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y - LIFT);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 20;
  const w = 422;
  const h = 195;
  const clip = { x: Math.max(0, Math.min(844 - w, cx - w / 2)), y: Math.max(0, Math.min(390 - h, cy - h / 2)), width: w, height: h };
  const buf = await page.screenshot({ clip });
  shots.push({ ...b, src: `data:image/png;base64,${buf.toString('base64')}` });
}

// the contact sheet
const sheet = await ctx.newPage();
await sheet.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#0b0d14;width:844px;height:390px;display:grid;grid-template-columns:422px 422px;grid-template-rows:195px 195px;font-family:sans-serif">
${shots
  .map(
    s => `<div style="position:relative;overflow:hidden"><img src="${s.src}" style="width:422px;height:195px;display:block"><div style="position:absolute;left:6px;top:5px;padding:2px 8px;border-radius:8px;background:rgba(0,0,0,.65);border:2px solid ${s.color};color:${s.color};font-weight:700;font-size:13px">${s.label}</div><div style="position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)"></div></div>`,
  )
  .join('')}
</body></html>`);
await sheet.waitForTimeout(300);
await sheet.screenshot({ path: OUT });
console.log(OUT);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
