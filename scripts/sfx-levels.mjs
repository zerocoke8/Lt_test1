// 기획 21차: level-match the sound files to the synth sounds they replace, and skip their leading silence.
//   npx vite-node scripts/sfx-levels.mjs            → writes src/audio/files/levels.json
//   npx vite-node scripts/sfx-levels.mjs --dry      → only prints the table
// Every src/audio/files/<id>.mp3 is decoded in Playwright's Chromium (decodeAudioData, the same decoder the game uses);
// the synth sound of the same id is rendered with the game's own recipes (bake.ts, variant 0). Both are measured by
// scripts/sfx-measure.mjs (K-weighted loudness: loudest 400 ms for a one-shot, the whole sound for a loop).
//   gain  = synth loudness − file loudness (as a linear factor), so the file plays as loud as the synth sound did
//           (the mixing row's dB in ids.ts still applies on top, exactly as for the synth); capped so the file's peak
//           stays within +3 dB of the synth's peak, and kept in 0.05–16.
//   start = seconds of leading silence (first sample above −40 dBFS, minus 5 ms) when that is over 15 ms; 0 for loops
//           (a seamless loop is never cut).
//   end   = (one-shots, only when it saves over 50 ms) 30 ms after the last sample above −40 dB under the file's peak:
//           the silent tail is not played, so a short hit does not hold a voice (4-2 voice caps) for half a second.
//   off   = true when the file is (nearly) silent or would need more than +24 dB (gain 16) to match, or when the peak
//           cap leaves it more than 12 dB quieter than the synth sound (one sharp spike, a near-silent body): a failed
//           generation. The game keeps the synth sound for that id until the file is remade.
//   hit (기획 21차 리뷰) = where the loud part starts (sfx-measure). A stage cue with a `lead` (stages.ts: its impact lands
//           `lead` s after the sound starts) is lined up with its synth sound's hit: a late file hit moves `start` later
//           (align: the build-up before it is shortened, the engine fades the cut head in), an early one gets `delay`
//           (the file starts that much later). Either only when it is over 0.06 s off.
// Printed for a remake: files the peak cap leaves 6–12 dB short ("short"), and one-shots without a lead whose loud part
// starts over 0.3 s later than the synth's ("late"; a long sting / boss phase may build up on purpose — listen first).
// Re-run after any file is added or remade (scripts/sfx-gen.mjs --force --only=<id>).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { measureSound } from './sfx-measure.mjs';
import { bakeSamples } from '../src/audio/bake';
import { recipeFor } from '../src/audio/synth/recipes';
import { SR } from '../src/audio/synth/prims';
import { STAGE_CUES } from '../src/audio/stages';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'audio', 'files');
const OUT = join(DIR, 'levels.json');
const dry = process.argv.includes('--dry');

const PEAK_HEADROOM = Math.pow(10, 3 / 20);
const GAIN_MIN = 0.05;
const GAIN_MAX = 16;
const TAIL_PAD = 0.03;
const TAIL_MIN_SAVE = 0.05;
const LEAD_MIN = 0.015;
const LEAD_PREROLL = 0.005;
/** Peak cap shortfall (dB): warn above SHORT_WARN, keep the synth sound above SHORT_OFF. */
const SHORT_WARN = 6;
const SHORT_OFF = 12;
/** A lead cue's file hit may be this far off its synth's hit (s) before it is lined up (start moved / delay). */
const LEAD_TOL = 0.06;
/** A one-shot whose hit is this much later than the synth's is printed (s). */
const HIT_LATE = 0.3;

/** id → lead (s) of the stage cues that are scheduled so their impact meets the hit (director: on land + lead). */
const LEADS = {};
for (const char of Object.values(STAGE_CUES))
  for (const slot of [char.drag, char.ult])
    for (const c of Object.values(slot)) for (const cue of c == null ? [] : Array.isArray(c) ? c : [c]) if (cue.lead && (!cue.on || cue.on === 'land')) LEADS[cue.id] = cue.lead;

const gen = existsSync(join(DIR, 'generated.json')) ? JSON.parse(readFileSync(join(DIR, 'generated.json'), 'utf8')) : {};
const files = readdirSync(DIR).filter(f => /\.(mp3|m4a|wav)$/i.test(f)).sort();
const r3 = v => Math.round(v * 1000) / 1000;

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {});
const page = await browser.newPage();
const meterSrc = readFileSync(join(ROOT, 'scripts', 'sfx-measure.mjs'), 'utf8').replace(/^export /m, '');
await page.addScriptTag({ content: `${meterSrc}\nwindow.measureSound = measureSound;` });

const levels = {};
const rows = [];
for (const f of files) {
  const id = f.replace(/\.(mp3|m4a|wav)$/i, '');
  const recipe = recipeFor(id);
  const loop = !!(recipe?.loop || gen[id]?.loop);
  const b64 = readFileSync(join(DIR, f)).toString('base64');
  const file = await page.evaluate(
    async ({ b64, loop }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ctx = new OfflineAudioContext(1, 1, 48000);
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      return { ...window.measureSound(chans, buf.sampleRate, loop), channels: buf.numberOfChannels };
    },
    { b64, loop },
  );
  const samples = bakeSamples(id, 0);
  const synth = samples ? measureSound([samples], SR, loop) : null;
  let gain = 1;
  let need = 1;
  let short = 0;
  if (synth && file.lufs > -100 && synth.lufs > -100) {
    const full = Math.pow(10, (synth.lufs - file.lufs) / 20);
    need = file.peak > 0 ? Math.min(full, (synth.peak * PEAK_HEADROOM) / file.peak) : full;
    short = 20 * Math.log10(full / need);
    gain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, need));
  }
  const off = file.lead == null || need > GAIN_MAX || short > SHORT_OFF;
  let start = 0;
  if (!loop && file.lead != null && file.lead > LEAD_MIN) start = Math.floor((file.lead - LEAD_PREROLL) * 1000) / 1000;
  const lead = LEADS[id];
  let aligned = false;
  let delay = 0;
  // the synth sound's own hit is the target (it lands on the lead: measured ≈ lead − 0.025 s); the lead itself if none
  const target = lead == null ? null : synth?.hit ?? lead;
  if (!loop && target != null && file.hit != null) {
    const shift = file.hit - start - target;
    if (shift > LEAD_TOL) {
      start = Math.floor((file.hit - target) * 1000) / 1000;
      aligned = true;
    } else if (-shift > LEAD_TOL) delay = Math.ceil(-shift * 1000) / 1000;
  }
  let end = null;
  const cut = Math.ceil((file.tail + TAIL_PAD) * 1000) / 1000;
  if (!loop && !off && file.seconds - cut > TAIL_MIN_SAVE && cut > start) end = cut;
  levels[id] = { gain: off ? 1 : r3(gain), start: r3(start), ...(end != null ? { end: r3(end) } : null), ...(off ? { off: true } : null), ...(aligned && !off ? { align: true } : null), ...(delay && !off ? { delay: r3(delay) } : null) };
  const hitAt = file.hit == null ? null : r3(file.hit - start);
  rows.push({ id, loop, off, need: r3(need), gain: r3(gain), start: r3(start), end, tail: r3(file.tail), fileLufs: r3(file.lufs), synthLufs: synth ? r3(synth.lufs) : null, filePeak: r3(file.peak), synthPeak: synth ? r3(synth.peak) : null, fileSec: r3(file.seconds), synthSec: synth ? r3(synth.seconds) : null, lead: file.lead == null ? null : r3(file.lead), channels: file.channels, short: r3(short), hit: hitAt, synthHit: synth?.hit == null ? null : r3(synth.hit), cueLead: lead ?? null, aligned, delay });
}
await browser.close();

const sum = (k, list = rows) => list.reduce((a, r) => a + (r[k] ?? 0), 0);
const silent = rows.filter(r => r.lead == null);
const clamped = rows.filter(r => !r.off && (r.gain <= GAIN_MIN || r.gain >= GAIN_MAX));
const offs = rows.filter(r => r.off);
const shorts = rows.filter(r => !r.off && r.short > SHORT_WARN);
const late = rows.filter(r => !r.off && !r.loop && r.cueLead == null && r.hit != null && r.synthHit != null && r.hit - r.synthHit > HIT_LATE);
const trimmed = rows.filter(r => r.start > 0);
const ended = rows.filter(r => r.end != null);
const byGain = rows.filter(r => !r.off).sort((a, b) => a.gain - b.gain);
console.log(`files ${rows.length} · file seconds ${sum('fileSec').toFixed(1)} · synth seconds ${sum('synthSec').toFixed(1)} · channels ${[...new Set(rows.map(r => r.channels))].join('/')}`);
console.log(`trimmed ${trimmed.length} (mean ${(sum('start', trimmed) / Math.max(1, trimmed.length)).toFixed(3)} s, max ${Math.max(0, ...trimmed.map(r => r.start))} s) · silent ${silent.map(r => r.id).join(', ') || 'none'} · gain at a clamp ${clamped.map(r => r.id).join(', ') || 'none'}`);
const med = byGain[Math.floor(byGain.length / 2)]?.gain;
console.log(`tail cut ${ended.length} (saves ${ended.reduce((a, r) => a + r.fileSec - r.end, 0).toFixed(1)} s of playing time in all)`);
console.log(`off (synth kept, remake these) ${offs.length}: ${offs.map(r => `${r.id} (${r.lead == null ? 'silent' : r.short > SHORT_OFF ? `${r.short.toFixed(1)} dB short under the peak cap` : `needs ×${r.need}`})`).join(', ') || 'none'}`);
console.log(`short (peak cap leaves it ${SHORT_WARN}–${SHORT_OFF} dB quieter than the synth, remake these) ${shorts.length}: ${shorts.map(r => `${r.id} (${r.short.toFixed(1)} dB)`).join(', ') || 'none'}`);
console.log(`lead cues: start moved ${rows.filter(r => r.aligned).map(r => `${r.id} (start ${r.start})`).join(', ') || 'none'} · delayed ${rows.filter(r => r.delay).map(r => `${r.id} (+${r.delay} s)`).join(', ') || 'none'}`);
console.log(`late (loud part over ${HIT_LATE} s later than the synth's, remake these) ${late.length}: ${late.map(r => `${r.id} (${r.hit} vs ${r.synthHit})`).join(', ') || 'none'}`);
console.log(`gain min ${byGain[0]?.gain} (${byGain[0]?.id}) · median ${med} · max ${byGain.at(-1)?.gain} (${byGain.at(-1)?.id})`);
for (const r of [...byGain.slice(0, 6), ...byGain.slice(-6)]) console.log('  ', JSON.stringify(r));
if (process.argv.includes('--table')) for (const r of rows) console.log(JSON.stringify(r));

if (!dry) {
  // one id per line: small diffs when one file is remade
  const body = Object.entries(levels).map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n');
  writeFileSync(OUT, `{\n${body}\n}\n`);
  console.log(`wrote ${OUT} (${rows.length} ids)`);
}
