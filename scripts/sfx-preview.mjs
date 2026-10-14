// Build one self-contained page to listen to the generated sound files: node scripts/sfx-preview.mjs
// Writes sfx-preview.html in the project folder (not committed). 기획 21차: every file in src/audio/files is listed,
// grouped by its prompt batch (scripts/sfx-prompts.json = the 18차 first batch, then scripts/sfx-prompts.d/*.json),
// with its Korean label. 「게임 크기」 plays it as the game does (files/levels.json: level, leading silence skipped,
// silent tail cut); 「원본」 plays the file as it was made. Files marked off in levels.json are flagged (the game keeps
// the synth sound for them until they are remade).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'audio', 'files');
const PD = join(ROOT, 'scripts', 'sfx-prompts.d');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

/** Batch titles (Korean) in listening order; an unknown batch keeps its name. */
const BATCH_KO = {
  first: '18차 첫 묶음 (자주 나는 소리)',
  drag: '교대 스킬 (drag)',
  ult: '궁극기 (ult)',
  combat: '전투 · 캐릭터 · 몬스터',
  'boss-kinds': '보스 공통 패턴',
  'boss-voices': '보스별 등장 · 페이즈 · 퇴장',
  goedam: '괴담 방 · 돌발 괴담',
  meta: '화면 · 메뉴 · 시스템',
};

const batches = [{ batch: 'first', sounds: readJson(join(ROOT, 'scripts', 'sfx-prompts.json')).sounds }];
if (existsSync(PD)) for (const f of readdirSync(PD).filter(f => f.endsWith('.json')).sort()) batches.push(readJson(join(PD, f)));
const order = Object.keys(BATCH_KO);
batches.sort((a, b) => (order.indexOf(a.batch) + 1 || 99) - (order.indexOf(b.batch) + 1 || 99));

const levels = existsSync(join(DIR, 'levels.json')) ? readJson(join(DIR, 'levels.json')) : {};
const files = new Set(existsSync(DIR) ? readdirSync(DIR).filter(f => /\.mp3$/i.test(f)).map(f => f.replace(/\.mp3$/i, '')) : []);
const listed = new Set();
const groups = [];
for (const b of batches) {
  const ids = b.sounds.filter(s => files.has(s.id) && !listed.has(s.id));
  for (const s of ids) listed.add(s.id);
  if (ids.length) groups.push({ title: BATCH_KO[b.batch] ?? b.batch, sounds: ids });
}
const rest = [...files].filter(id => !listed.has(id)).sort();
if (rest.length) groups.push({ title: '묶음 밖 파일', sounds: rest.map(id => ({ id })) });

let n = 0;
let offCount = 0;
const sections = groups.map(g => {
  const rows = g.sounds.map(s => {
    n++;
    const lv = levels[s.id] ?? { gain: 1, start: 0 };
    if (lv.off) offCount++;
    const data = readFileSync(join(DIR, `${s.id}.mp3`)).toString('base64');
    const tags = [esc(s.id), s.seconds ? `${s.seconds}초` : '', lv.off ? '' : `크기 ×${lv.gain}`, lv.start ? `앞 ${lv.start}초 건너뜀` : '', lv.end ? `${lv.end}초에서 끝` : '', lv.align ? '타격에 맞춰 앞을 자름' : '', lv.delay ? `타격에 맞춰 ${lv.delay}초 늦게` : '']
      .filter(Boolean)
      .join(' · ');
    const off = lv.off ? '<em class="off">게임에선 합성 소리 (다시 만들 것)</em>' : '';
    return `<button class="row${lv.off ? ' is-off' : ''}" data-id="${esc(s.id)}" data-gain="${lv.gain}" data-start="${lv.start ?? 0}" data-end="${lv.end ?? ''}" data-src="data:audio/mpeg;base64,${data}"><span class="no">${n}</span><span class="name"><b>${esc(s.ko ?? s.id)}</b><small>${tags}</small>${off}</span><span class="play">▶</span></button>`;
  });
  return `<h2>${esc(g.title)} <span>${rows.length}</span></h2><div class="list">${rows.join('\n')}</div>`;
});

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>효과음 미리 듣기</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 16px; background: #0b0d14; color: #e8ebf2; font: 16px/1.4 system-ui, 'Malgun Gothic', sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 22px 0 8px; color: #c9d1e3; }
  h2 span { color: #6b7386; font-weight: 400; font-size: 13px; }
  p { color: #9aa3b5; margin: 0 0 10px; font-size: 14px; max-width: 560px; }
  .bar { position: sticky; top: 0; display: flex; gap: 8px; padding: 8px 0; background: #0b0d14; z-index: 1; }
  .bar button { padding: 8px 14px; border-radius: 999px; border: 1px solid #262b3a; background: #141826; color: inherit; font: inherit; font-size: 14px; }
  .bar button.on { border-color: #4ade80; color: #4ade80; }
  .list { display: grid; gap: 8px; max-width: 560px; }
  .row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1px solid #262b3a; background: #141826; color: inherit; font: inherit; cursor: pointer; }
  .row.on { border-color: #4ade80; background: #15241c; }
  .row.is-off { border-style: dashed; }
  .no { width: 30px; color: #6b7386; font-variant-numeric: tabular-nums; }
  .name { flex: 1; display: grid; min-width: 0; }
  small { color: #8791a6; font-size: 12px; overflow-wrap: anywhere; }
  .off { color: #fbbf24; font-size: 12px; font-style: normal; }
  .play { font-size: 18px; color: #4ade80; }
</style></head><body>
<h1>효과음 미리 듣기 (${n}개)</h1>
<p>줄을 누르면 소리가 나요. 마음에 안 드는 건 번호나 이름으로 알려 주세요. 「게임 크기」는 게임에서 나는 크기와 길이(앞의 빈 부분 건너뜀, 끝의 조용한 부분 자름)로, 「원본」은 만든 파일 그대로 들려줘요.${offCount ? ` 점선 줄 ${offCount}개는 거의 소리가 없어서 게임에서는 원래 합성 소리가 나요.` : ''}</p>
<div class="bar"><button id="game" class="on">게임 크기</button><button id="raw">원본</button></div>
${sections.join('\n')}
<script>
  let mode = 'game';
  let ctx = null;
  let cur = null;
  const bufs = new Map();
  const setMode = m => { mode = m; document.getElementById('game').classList.toggle('on', m === 'game'); document.getElementById('raw').classList.toggle('on', m === 'raw'); };
  document.getElementById('game').onclick = () => setMode('game');
  document.getElementById('raw').onclick = () => setMode('raw');
  async function play(b) {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') await ctx.resume();
    if (cur) { try { cur.stop(); } catch {} }
    document.querySelectorAll('.row.on').forEach(x => x.classList.remove('on'));
    const id = b.dataset.id;
    let buf = bufs.get(id);
    if (!buf) { buf = await ctx.decodeAudioData(await (await fetch(b.dataset.src)).arrayBuffer()); bufs.set(id, buf); }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const game = mode === 'game' && !b.classList.contains('is-off');
    // game level relative to the synth sound it replaces (0.6 leaves headroom: the loudest files reach about +3 dB)
    g.gain.value = game ? Number(b.dataset.gain) * 0.6 : 1;
    src.connect(g).connect(ctx.destination);
    const start = game ? Number(b.dataset.start) || 0 : 0;
    const end = game && b.dataset.end ? Number(b.dataset.end) : buf.duration;
    src.start(0, start, Math.max(0.01, end - start));
    b.classList.add('on');
    src.onended = () => b.classList.remove('on');
    cur = src;
  }
  for (const b of document.querySelectorAll('.row')) b.addEventListener('click', () => void play(b));
</script></body></html>`;

const out = join(ROOT, 'sfx-preview.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${n} sounds in ${groups.length} groups, ${offCount} off, ${(html.length / 1024 / 1024).toFixed(1)} MB)`);
