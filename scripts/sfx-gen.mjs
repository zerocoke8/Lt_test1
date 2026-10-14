// Generate game sound effects with the ElevenLabs text-to-sound-effects API (docs/sfx.md 2-2).
// Reads scripts/sfx-prompts.json plus every scripts/sfx-prompts.d/*.json and writes src/audio/files/<id>.mp3 — the game
// then plays the file instead of the synth.
//
//   node scripts/sfx-gen.mjs --dry                 list what would be made (no API call, no credits)
//   node scripts/sfx-gen.mjs                       make every sound in the lists that has no file yet
//   node scripts/sfx-gen.mjs --only=hit.basic,ui.tap   make just these
//   node scripts/sfx-gen.mjs --family=hit          make ids starting with "hit."
//   node scripts/sfx-gen.mjs --force --only=ui.tap make it again (the old file is kept as <id>.prev.mp3.bak)
//   node scripts/sfx-gen.mjs --jobs=3              requests in flight at once (default 2)
//
// A list file: { "style"?, "influence"?, "format"?, "sounds": [{ id, ko, seconds, text, loop?, noStyle?, influence? }] }.
// The style / influence / format of scripts/sfx-prompts.json are the defaults for the other files.
// The API key is read from the environment or from .env.local (ELEVENLABS_API_KEY=...). It is never printed.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'audio', 'files');
const LOG = join(OUT_DIR, 'generated.json');
const API = 'https://api.elevenlabs.io/v1/sound-generation';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const file = join(ROOT, '.env.local');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const named = text.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+)\s*$/m);
  return (named ? named[1] : text).trim().replace(/^["']|["']$/g, '') || null;
}

/** Every sound of every list, each carrying its list's style / influence / format. Later lists may not repeat an id. */
function loadSounds() {
  const main = JSON.parse(readFileSync(join(ROOT, 'scripts', 'sfx-prompts.json'), 'utf8'));
  const lists = [main];
  const dir = join(ROOT, 'scripts', 'sfx-prompts.d');
  if (existsSync(dir)) for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) lists.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const seen = new Set();
  const out = [];
  for (const l of lists) {
    for (const s of l.sounds) {
      if (seen.has(s.id)) throw new Error(`duplicate id in the prompt lists: ${s.id}`);
      seen.add(s.id);
      out.push({ ...s, style: l.style ?? main.style, influence: s.influence ?? l.influence ?? main.influence ?? 0.3, format: l.format ?? main.format ?? 'mp3_44100_96' });
    }
  }
  return out;
}

function pick(sounds) {
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
  const family = typeof args.family === 'string' ? args.family + '.' : null;
  return sounds.filter(s => (!only || only.has(s.id)) && (!family || s.id.startsWith(family)));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** The API refuses a text (prompt + style line) over this many characters (HTTP 400 text_too_long). */
const TEXT_MAX = 450;
const fullText = s => (s.noStyle ? s.text : `${s.text} ${s.style}`);

/** One sound; retries a rate limit / server error twice. Throws 'STOP: …' on a key or credit problem. */
async function generate(key, s) {
  const body = { text: fullText(s), duration_seconds: s.seconds, prompt_influence: s.influence, ...(s.loop ? { loop: true } : {}) };
  if (body.text.length > TEXT_MAX) throw new Error(`text is ${body.text.length} characters (max ${TEXT_MAX} with the style line): shorten it`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}?output_format=${s.format}`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return { mp3: Buffer.from(await res.arrayBuffer()), text: body.text };
    const msg = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 402 || /quota|credit|limit_reached|insufficient/i.test(msg)) throw new Error(`STOP: HTTP ${res.status}: ${msg}`);
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(attempt === 0 ? 5000 : 15000);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
}

const list = pick(loadSounds());
const todo = list.filter(s => args.force || !existsSync(join(OUT_DIR, `${s.id}.mp3`)));
const seconds = todo.reduce((a, s) => a + s.seconds, 0);
console.log(`${todo.length} to make (${list.length - todo.length} already there), ${seconds.toFixed(1)} s of audio in total`);

if (args.dry) {
  for (const s of todo) console.log(`  ${s.id}  ${s.seconds}s${s.loop ? ' loop' : ''}${fullText(s).length > TEXT_MAX ? `  TOO LONG (${fullText(s).length} > ${TEXT_MAX})` : ''}  ${s.text}`);
  process.exit(0);
}

const key = apiKey();
if (!key) {
  console.error('No API key: put ELEVENLABS_API_KEY=... in .env.local (project folder).');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : {};
let made = 0;
let failed = 0;
let stop = null;
const queue = [...todo];

async function worker() {
  while (queue.length && !stop) {
    const s = queue.shift();
    try {
      const { mp3, text } = await generate(key, s);
      const file = join(OUT_DIR, `${s.id}.mp3`);
      if (existsSync(file)) renameSync(file, join(OUT_DIR, `${s.id}.prev.mp3.bak`));
      writeFileSync(file, mp3);
      log[s.id] = { source: 'ElevenLabs text-to-sound-effects', text, seconds: s.seconds, loop: !!s.loop, format: s.format, bytes: mp3.length, at: new Date().toISOString() };
      writeFileSync(LOG, JSON.stringify(log, null, 1));
      made++;
      console.log(`  ok   ${s.id}  ${(mp3.length / 1024).toFixed(1)} KB  (${made}/${todo.length})`);
    } catch (e) {
      if (String(e.message).startsWith('STOP:')) stop = e.message;
      else failed++;
      console.log(`  FAIL ${s.id}  ${e.message}`);
    }
  }
}

const jobs = Math.max(1, Math.min(6, Number(args.jobs) || 2));
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`made ${made} of ${todo.length}, failed ${failed}${stop ? `; stopped: ${stop}` : ''}`);
if (stop) process.exit(2);
