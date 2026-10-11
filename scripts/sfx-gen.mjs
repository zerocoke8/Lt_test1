// Generate game sound effects with the ElevenLabs text-to-sound-effects API (docs/sfx.md 2-2).
// Reads scripts/sfx-prompts.json and writes src/audio/files/<id>.mp3 — the game then plays the file instead of the synth.
//
//   node scripts/sfx-gen.mjs --dry                 list what would be made (no API call, no credits)
//   node scripts/sfx-gen.mjs                       make every sound in the list that has no file yet
//   node scripts/sfx-gen.mjs --only=hit.basic,ui.tap   make just these
//   node scripts/sfx-gen.mjs --family=hit          make ids starting with "hit."
//   node scripts/sfx-gen.mjs --force --only=ui.tap make it again (the old file is kept as <id>.prev.mp3.bak)
//
// The API key is read from the environment or from .env.local (ELEVENLABS_API_KEY=...). It is never printed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'audio', 'files');
const LOG = join(OUT_DIR, 'generated.json');
const API = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_96';

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

function pick(sounds) {
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
  const family = typeof args.family === 'string' ? args.family + '.' : null;
  return sounds.filter(s => (!only || only.has(s.id)) && (!family || s.id.startsWith(family)));
}

async function generate(key, body) {
  const res = await fetch(API, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

const cfg = JSON.parse(readFileSync(join(ROOT, 'scripts', 'sfx-prompts.json'), 'utf8'));
const list = pick(cfg.sounds);
const todo = list.filter(s => args.force || !existsSync(join(OUT_DIR, `${s.id}.mp3`)));
const seconds = todo.reduce((a, s) => a + s.seconds, 0);
console.log(`${todo.length} to make (${list.length - todo.length} already there), ${seconds.toFixed(1)} s of audio in total`);

if (args.dry) {
  for (const s of todo) console.log(`  ${s.id}  ${s.seconds}s  ${s.text}`);
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
for (const s of todo) {
  const text = s.noStyle ? s.text : `${s.text} ${cfg.style}`;
  const body = { text, duration_seconds: s.seconds, prompt_influence: s.influence ?? cfg.influence ?? 0.3, ...(s.loop ? { loop: true } : {}) };
  try {
    const mp3 = await generate(key, body);
    const file = join(OUT_DIR, `${s.id}.mp3`);
    if (existsSync(file)) renameSync(file, join(OUT_DIR, `${s.id}.prev.mp3.bak`));
    writeFileSync(file, mp3);
    log[s.id] = { source: 'ElevenLabs text-to-sound-effects', text, seconds: s.seconds, bytes: mp3.length, at: new Date().toISOString() };
    writeFileSync(LOG, JSON.stringify(log, null, 1));
    made++;
    console.log(`  ok   ${s.id}  ${(mp3.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.log(`  FAIL ${s.id}  ${e.message}`);
    if (/HTTP 401|HTTP 402|quota/i.test(e.message)) break; // key or credits: stop instead of failing 20 times
  }
}
console.log(`made ${made} of ${todo.length}`);
