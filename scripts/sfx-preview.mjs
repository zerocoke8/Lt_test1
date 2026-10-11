// Build one self-contained page to listen to the generated sound files: node scripts/sfx-preview.mjs
// Writes sfx-preview.html in the project folder (not committed). Every file in src/audio/files is listed, newest names
// from scripts/sfx-prompts.json; tap a row to play it.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'audio', 'files');
const cfg = JSON.parse(readFileSync(join(ROOT, 'scripts', 'sfx-prompts.json'), 'utf8'));
const info = new Map(cfg.sounds.map(s => [s.id, s]));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const files = existsSync(DIR) ? readdirSync(DIR).filter(f => /\.mp3$/i.test(f)) : [];
const order = id => { const i = cfg.sounds.findIndex(s => s.id === id); return i < 0 ? 999 : i; };
const rows = files
  .map(f => f.replace(/\.mp3$/i, ''))
  .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  .map((id, n) => {
    const s = info.get(id);
    const data = readFileSync(join(DIR, `${id}.mp3`)).toString('base64');
    return `<button class="row" data-i="${n}"><span class="no">${n + 1}</span><span class="name"><b>${esc(s?.ko ?? id)}</b><small>${esc(id)}${s ? ` · ${s.seconds}초` : ''}</small></span><span class="play">▶</span><audio preload="auto" src="data:audio/mpeg;base64,${data}"></audio></button>`;
  });

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>효과음 미리 듣기</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 16px; background: #0b0d14; color: #e8ebf2; font: 16px/1.4 system-ui, 'Malgun Gothic', sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: #9aa3b5; margin: 0 0 14px; font-size: 14px; }
  .list { display: grid; gap: 8px; max-width: 560px; }
  .row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1px solid #262b3a; background: #141826; color: inherit; font: inherit; cursor: pointer; }
  .row.on { border-color: #4ade80; background: #15241c; }
  .no { width: 26px; color: #6b7386; font-variant-numeric: tabular-nums; }
  .name { flex: 1; display: grid; }
  small { color: #8791a6; font-size: 12px; }
  .play { font-size: 18px; color: #4ade80; }
</style></head><body>
<h1>효과음 미리 듣기 (${rows.length}개)</h1>
<p>줄을 누르면 소리가 나요. 마음에 안 드는 건 번호로 알려 주세요.</p>
<div class="list">${rows.join('\n')}</div>
<script>
  for (const b of document.querySelectorAll('.row')) b.addEventListener('click', () => {
    const a = b.querySelector('audio');
    a.currentTime = 0; a.play();
    b.classList.add('on'); a.onended = () => b.classList.remove('on');
  });
</script></body></html>`;

const out = join(ROOT, 'sfx-preview.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${rows.length} sounds, ${(html.length / 1024).toFixed(0)} KB)`);
