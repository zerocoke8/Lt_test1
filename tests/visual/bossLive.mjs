// 기획 20차: shared by boss-phone-sheet.mjs and boss-pattern-sheet.mjs — the REAL game on a phone screen (844×390) from
// its own Vite dev server, one raid boss at a time (alone on its zone's first floor, invincible party, a fat HP bar),
// and the picture sheet both tools end with. Chromium: the same rule as playwright.config.ts.
// The page talks to the game through window.__proto; the boss data (names, forms, signature patterns) is read from the
// dev server's own modules (import('/src/data/index.ts') — the same module the running game uses).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
export const VIEW = { width: 844, height: 390 };

/** `key=value` arguments of a tool. */
export const parseArgs = argv => Object.fromEntries(argv.slice(2).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));

/** Dev server + browser + one phone page on the raid's preset screen. `close()` ends all of it. */
export async function openGame(port) {
  // no hot reload: a file saved while the tool runs (another session at work) must not reload the page mid-capture
  const server = await createServer({ server: { port: Number(port ?? 0) || 5197, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=bossRaid`);
  await page.waitForFunction(() => window.__proto?.phase === 'preset', null, { timeout: 90000 });
  return {
    page,
    errors,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * The 20 raid bosses in run order: id, name, form ('fixed' …) and its Korean label, the signature pattern (id + name)
 * and the first floor of its zone.
 */
export async function bossList(page) {
  return page.evaluate(async () => {
    const data = await import('/src/data/index.ts');
    const forms = await import('/src/data/bosses/forms.ts');
    return data.RAID_BOSS_IDS.map((id, i) => {
      const b = data.getBoss(id);
      const form = b.form ?? 'fixed';
      const all = [...b.skills, ...(b.phases ?? []).flatMap(p => p.skills ?? [])];
      const sig = all.find(s => s.id === b.signature);
      return { id, name: b.name, form, formLabel: forms.BOSS_FORM_LABEL[form], signature: b.signature ?? null, signatureName: sig?.name ?? null, floor: 1 + 5 * Math.floor(i / 5) };
    });
  });
}

/** Start a raid with only this boss and wait until its fight has begun. */
export async function startBoss(page, boss, tunables = {}) {
  await page.evaluate(
    ([id, floor, t]) => window.__proto.startRun({ seed: 4242, startFloor: floor, mode: 'bossRaid', bossRaid: { onlyBoss: id, hpMult: 6 }, tunables: { invincible: true, ...t } }),
    [boss.id, boss.floor, tunables],
  );
  await page.waitForFunction(id => window.__proto.phase === 'combat' && window.__proto.game?.state.plan.bossId === id && window.__proto.game.state.time < 1, boss.id, { timeout: 30000 });
}

/** Solo only: the debug game speed, live. */
export const setSpeed = (page, speed) => page.evaluate(v => (window.__proto.game.tunables.gameSpeed = v), speed);

/**
 * Compose the shots (each { png, label, bad? }) into one picture, `per` tiles a row, and write it. A `bad` tile gets a
 * red label and a red frame.
 */
export async function writeSheet(page, shots, out, { scale = 0.5, per = 5, label = 22 } = {}) {
  const b64 = await page.evaluate(
    async ([data, w, h, labelH, perRow]) => {
      const imgs = await Promise.all(
        data.map(
          d =>
            new Promise(res => {
              const im = new Image();
              im.onload = () => res(im);
              im.src = d.src;
            }),
        ),
      );
      const rows = Math.ceil(imgs.length / perRow);
      const c = document.createElement('canvas');
      c.width = Math.min(imgs.length, perRow) * (w + 4) + 4;
      c.height = rows * (h + labelH + 4) + 4;
      const g = c.getContext('2d');
      g.fillStyle = '#15171c';
      g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = 'high';
      imgs.forEach((im, i) => {
        const x = 4 + (i % perRow) * (w + 4);
        const y = 4 + Math.floor(i / perRow) * (h + labelH + 4);
        g.drawImage(im, x, y + labelH, w, h);
        if (data[i].bad) {
          g.strokeStyle = '#ff4d5e';
          g.lineWidth = 3;
          g.strokeRect(x + 1.5, y + labelH + 1.5, w - 3, h - 3);
        }
        g.fillStyle = data[i].bad ? '#ff7a85' : '#ffffff';
        g.font = 'bold 14px "Malgun Gothic","Noto Sans KR",sans-serif';
        g.textBaseline = 'middle';
        g.fillText(data[i].label, x + 4, y + labelH / 2, w - 8);
      });
      return c.toDataURL('image/png').split(',')[1];
    },
    [shots.map(s => ({ src: `data:image/png;base64,${s.png.toString('base64')}`, label: s.label, bad: !!s.bad })), Math.round(VIEW.width * scale), Math.round(VIEW.height * scale), label, per],
  );
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, Buffer.from(b64, 'base64'));
}
