// 기획 15차 원정: gear pictures art/gear/*.png (1024×1024 originals) → src/assets/gear/*.png (256×256, docs/expedition.md 9-6).
// Resizes in the preinstalled Chromium (canvas, no new dependency). Names must match docs/gear-art-prompts.md 6장.
// Usage: npm run art:gear [-- <srcDir> <outDir>]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [srcDir = 'art/gear', outDir = 'src/assets/gear'] = process.argv.slice(2);
const SIZE = 256;
const MAX_FILE = 60 * 1024;
const MAX_TOTAL = 3.5 * 1024 * 1024;
const NAME = /^gear-(weapon-(shield|sword|axe|bow|orb|staff|hammer|gun|lute)-b[1-4]|armor-b[1-4]|charm-b[1-4]|relic-(echo_seal|relay_flag|vanguard_helm|hunter_mark|phoenix_feather|beast_collar|rage_breaker|blood_chalice))\.png$/;

if (!existsSync(srcDir)) {
  console.error(`${srcDir} 폴더가 없어요 (원본 그림을 여기에 넣어 주세요)`);
  process.exit(1);
}
const files = readdirSync(srcDir).filter(f => f.toLowerCase().endsWith('.png'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
let total = 0;
for (const f of files) {
  if (!NAME.test(f)) {
    console.warn(`건너뜀 (이름이 목록에 없음): ${f}`);
    continue;
  }
  const src = `data:image/png;base64,${readFileSync(path.join(srcDir, f)).toString('base64')}`;
  const out = await page.evaluate(
    async ({ src, size }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const k = Math.min(size / img.width, size / img.height);
      ctx.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
      return c.toDataURL('image/png');
    },
    { src, size: SIZE },
  );
  const buf = Buffer.from(out.split(',')[1], 'base64');
  const dest = path.join(outDir, f);
  writeFileSync(dest, buf);
  total += buf.length;
  console.log(`${dest} ${(buf.length / 1024).toFixed(1)} KB${buf.length > MAX_FILE ? '  ⚠ 60KB 넘음' : ''}`);
}
await browser.close();
const all = readdirSync(outDir).filter(f => f.endsWith('.png')).reduce((s, f) => s + statSync(path.join(outDir, f)).size, 0);
console.log(`합계 ${(all / 1024 / 1024).toFixed(2)} MB${all > MAX_TOTAL ? '  ⚠ 3.5MB 넘음' : ''} (이번에 ${(total / 1024).toFixed(0)} KB)`);
