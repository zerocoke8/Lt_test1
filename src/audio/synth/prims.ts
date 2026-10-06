// 기획 13차 효과음: sound building blocks rendered in plain JS (no AudioContext needed → node tests can bake).
// A Recipe is a list of layers (tone, noise, bell, click) summed into one mono Float32Array at SR, then optional
// distortion / echo / reverb / reverse, then normalised to a peak. Times are seconds, frequencies Hz.

export const SR = 32000;

export type Wave = 'sin' | 'tri' | 'saw' | 'sq';
export type NoiseColor = 'white' | 'pink' | 'brown';
/**
 * exp: fast attack, exponential decay · lin: linear decay · flat: sustain then release over the last 30 % ·
 * swell: rises to the end then cuts (reverse-cymbal feel) · hump: up then down (wind gusts).
 */
export type EnvShape = 'exp' | 'lin' | 'flat' | 'swell' | 'hump';

interface Env {
  /** Start (s). */
  t: number;
  /** Duration (s). */
  d: number;
  /** Peak gain (linear, before normalisation). */
  g: number;
  /** Attack (s). */
  a: number;
  e: EnvShape;
  /** Amplitude tremolo rate (Hz), 0 = none. */
  trem: number;
}

export interface ToneLayer extends Env {
  k: 'tone';
  w: Wave;
  f: number;
  /** End frequency (exponential glide over d). */
  f2: number;
  /** Vibrato [rate Hz, depth semitones]. */
  vib?: [number, number];
  /** FM [modulator ratio, index at start, index at end]. */
  fm?: [number, number, number];
}

export interface NoiseLayer extends Env {
  k: 'noise';
  c: NoiseColor;
  /** Filter kind + cutoff sweep [from, to] + resonance. */
  flt?: 'lp' | 'hp' | 'bp';
  f: number;
  f2: number;
  q: number;
  /** Random grain gating (grains per second), 0 = continuous. */
  grain: number;
}

export interface BellLayer extends Env {
  k: 'bell';
  f: number;
  /** Partial ratios (inharmonic for bells). */
  parts: number[];
}

export type Layer = ToneLayer | NoiseLayer | BellLayer;

export interface Recipe {
  L: Layer[];
  /** tanh drive (0 = clean). */
  dist?: number;
  /** Echo [delay s, feedback, wet]. */
  echo?: [number, number, number];
  /** Reverb wet 0..1 (Schroeder, ~1.4 s). */
  rev?: number;
  reverse?: boolean;
  /** Seamless loop of this many seconds (crossfaded seam). */
  loop?: number;
  /** Normalise to this peak (default 0.9). */
  peak?: number;
}

// ─────────────────────────── layer helpers (short names keep recipes.ts compact) ───────────────────────────

export interface LayerOpts {
  t?: number;
  g?: number;
  a?: number;
  e?: EnvShape;
  trem?: number;
}

function env(d: number, o: LayerOpts = {}): Env {
  return { t: o.t ?? 0, d, g: o.g ?? 1, a: o.a ?? 0.004, e: o.e ?? 'exp', trem: o.trem ?? 0 };
}

/** Tone: wave from f to f2 over d. */
export function tone(w: Wave, f: number, f2: number, d: number, o: LayerOpts & { vib?: [number, number]; fm?: [number, number, number] } = {}): ToneLayer {
  return { k: 'tone', w, f, f2, vib: o.vib, fm: o.fm, ...env(d, o) };
}

/** Filtered noise; f/f2 = cutoff sweep. */
export function noise(c: NoiseColor, d: number, o: LayerOpts & { lp?: [number, number?]; hp?: [number, number?]; bp?: [number, number?]; q?: number; grain?: number } = {}): NoiseLayer {
  const [flt, sweep] = o.lp ? (['lp', o.lp] as const) : o.hp ? (['hp', o.hp] as const) : o.bp ? (['bp', o.bp] as const) : ([undefined, [0]] as const);
  const f = sweep[0] ?? 0;
  return { k: 'noise', c, flt, f, f2: sweep[1] ?? f, q: o.q ?? 0.8, grain: o.grain ?? 0, ...env(d, o) };
}

/** Bell / metal: inharmonic partials (default church-bell ratios). */
export function bell(f: number, d: number, o: LayerOpts & { parts?: number[] } = {}): BellLayer {
  return { k: 'bell', f, parts: o.parts ?? [1, 2.0, 2.76, 5.4, 8.93], ...env(d, o) };
}

/** Very short noise tick with a body tone (UI clicks, ratchets, coins). */
export function click(t: number, f = 2400, g = 1): Layer[] {
  return [noise('white', 0.012, { t, g: g * 0.8, hp: [f], a: 0.0005 }), tone('sin', f * 0.5, f * 0.45, 0.03, { t, g: g * 0.5, a: 0.0005 })];
}

/** n copies of a layer builder, `step` s apart. */
export function seq(n: number, step: number, fn: (i: number, t: number) => Layer | Layer[]): Layer[] {
  const out: Layer[] = [];
  for (let i = 0; i < n; i++) out.push(...[fn(i, i * step)].flat());
  return out;
}

/** Semitone ratio. */
export const st = (n: number): number => Math.pow(2, n / 12);

/** Chord intervals (semitones) by quality. */
export const CHORD: Record<'maj' | 'min' | 'dim' | 'sus', number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  sus: [0, 5, 7],
};

// ─────────────────────────── rendering ───────────────────────────

/** Tiny seeded PRNG (mulberry32) — sounds bake the same every time (variants differ by seed). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderOpts {
  seed?: number;
  /** Frequency scale (variants: 1, ≈1.03, ≈0.97). */
  pitch?: number;
}

const TAIL_REV = 1.3;
const MAX_LEN = 9;

function envAt(l: Env, x: number): number {
  // x = seconds since layer start (0..d)
  if (x < 0 || x > l.d) return 0;
  const a = Math.min(l.a, l.d * 0.5);
  let v: number;
  switch (l.e) {
    case 'swell':
      v = Math.pow(x / l.d, 2.2);
      if (l.d - x < 0.008) v *= (l.d - x) / 0.008;
      return v * l.g;
    case 'hump':
      v = Math.sin((Math.PI * x) / l.d);
      return v * v * l.g;
    case 'flat':
      v = x < a ? x / a : x > l.d * 0.7 ? (l.d - x) / (l.d * 0.3) : 1;
      return v * l.g;
    case 'lin':
      v = x < a ? x / a : 1 - (x - a) / (l.d - a);
      return v * l.g;
    default:
      v = x < a ? x / a : Math.exp((-5 * (x - a)) / Math.max(1e-3, l.d - a));
      // last 6 ms → 0 (no click)
      if (l.d - x < 0.006) v *= (l.d - x) / 0.006;
      return v * l.g;
  }
}

/** Envelope of a layer sampled every 16 samples (linear in between) — cheap per-sample gain. */
function envTable(l: Env, n: number): Float32Array {
  const m = (n >> 4) + 2;
  const t = new Float32Array(m);
  for (let j = 0; j < m; j++) {
    let g = envAt(l, Math.min(l.d, (j * 16) / SR));
    if (l.trem) g *= 0.55 + 0.45 * Math.sin((2 * Math.PI * l.trem * j * 16) / SR);
    t[j] = g;
  }
  return t;
}

function envGet(t: Float32Array, i: number): number {
  const j = i >> 4;
  const f = (i & 15) / 16;
  return t[j] + (t[j + 1] - t[j]) * f;
}

const SIN_N = 4096;
const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin((2 * Math.PI * i) / SIN_N);

/** sin(2π·ph) by table (ph in cycles). */
function fsin(ph: number): number {
  const p = (ph - Math.floor(ph)) * SIN_N;
  const i = p | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (p - i);
}

function osc(w: Wave, ph: number): number {
  const p = ph - Math.floor(ph);
  switch (w) {
    case 'sin':
      return fsin(p);
    case 'tri':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'saw':
      return 2 * p - 1;
    default:
      return p < 0.5 ? 1 : -1;
  }
}

function* renderTone(out: Float32Array, l: ToneLayer, pitch: number): Generator<void, void> {
  const i0 = Math.floor(l.t * SR);
  const n = Math.min(out.length - i0, Math.ceil(l.d * SR));
  if (n <= 0) return;
  const env = envTable(l, n);
  const f1 = l.f * pitch;
  // exponential glide as a per-sample multiplier
  const glide = Math.pow(l.f2 / l.f, 1 / Math.max(1, l.d * SR));
  let f = f1;
  let ph = 0;
  let mph = 0;
  // saw / square are bright: soften with a one-pole low-pass
  let lp = 0;
  const soft = l.w === 'saw' || l.w === 'sq';
  for (let i = 0; i < n; i++) {
    if ((i & CHUNK) === CHUNK) yield;
    let fi = f;
    if (l.vib) fi *= Math.pow(2, (l.vib[1] / 12) * fsin((l.vib[0] * i) / SR));
    let s: number;
    if (l.fm) {
      const idx = l.fm[1] + ((l.fm[2] - l.fm[1]) * i) / n;
      mph += (fi * l.fm[0]) / SR;
      s = fsin(ph + (idx * fsin(mph)) / (2 * Math.PI));
    } else s = osc(l.w, ph);
    ph += fi / SR;
    f *= glide;
    if (soft) {
      lp += 0.6 * (s - lp);
      s = lp;
    }
    out[i0 + i] += s * envGet(env, i);
  }
}

function* renderBell(out: Float32Array, l: BellLayer, pitch: number): Generator<void, void> {
  const i0 = Math.floor(l.t * SR);
  const n = Math.min(out.length - i0, Math.ceil(l.d * SR));
  if (n <= 0) return;
  const f = l.f * pitch;
  for (let k = 0; k < l.parts.length; k++) {
    const r = l.parts[k];
    const amp = 0.5 / (1 + k * 0.9);
    // higher partials die faster: same envelope, time-compressed
    const sub: Env = { ...l, d: l.d / (1 + k * 0.8) };
    const m = Math.min(n, Math.ceil(sub.d * SR));
    const env = envTable(sub, m);
    const inc = (f * r) / SR;
    if (inc >= 0.5) continue;
    let ph = 0;
    for (let i = 0; i < m; i++) {
      if ((i & CHUNK) === CHUNK) yield;
      out[i0 + i] += fsin(ph) * envGet(env, i) * amp;
      ph += inc;
    }
  }
}

function* renderNoise(out: Float32Array, l: NoiseLayer, pitch: number, rand: () => number): Generator<void, void> {
  const i0 = Math.floor(l.t * SR);
  const n = Math.min(out.length - i0, Math.ceil(l.d * SR));
  if (n <= 0) return;
  const env = envTable(l, n);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    br = 0;
  // TPT state-variable filter
  let ic1 = 0,
    ic2 = 0;
  let g = 0,
    k = 1 / Math.max(0.3, l.q),
    a1 = 0,
    a2 = 0,
    a3 = 0;
  let grainLeft = 0,
    grainAmp = 1,
    nextGrain = 0;
  for (let i = 0; i < n; i++) {
    if ((i & CHUNK) === CHUNK) yield;
    const x = i / SR;
    const w = rand() * 2 - 1;
    let s: number;
    if (l.c === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      s = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else if (l.c === 'brown') {
      br = (br + 0.02 * w) / 1.02;
      s = br * 3.5;
    } else s = w;
    if (l.flt) {
      if ((i & 15) === 0) {
        const fc = Math.min(SR * 0.45, Math.max(20, l.f * pitch * Math.pow(l.f2 / l.f, x / l.d)));
        g = Math.tan((Math.PI * fc) / SR);
        a1 = 1 / (1 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
      }
      const v3 = s - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      s = l.flt === 'lp' ? v2 : l.flt === 'bp' ? v1 * k * 1.4 : s - k * v1 - v2;
    }
    if (l.grain > 0) {
      if (grainLeft <= 0) {
        if (x >= nextGrain) {
          grainLeft = Math.floor((0.003 + rand() * 0.01) * SR);
          grainAmp = 0.35 + rand() * 0.65;
          nextGrain = x + (-Math.log(1 - rand() * 0.999) / l.grain);
        }
        s = 0;
      } else {
        grainLeft--;
        s *= grainAmp;
      }
    }
    out[i0 + i] += s * envGet(env, i);
  }
}

function* applyDist(buf: Float32Array, drive: number): Generator<void, void> {
  const norm = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) {
    if ((i & CHUNK) === CHUNK) yield;
    buf[i] = Math.tanh(buf[i] * drive) / norm;
  }
}

function* applyEcho(buf: Float32Array, [delay, fb, wet]: [number, number, number]): Generator<void, void> {
  const d = Math.max(1, Math.floor(delay * SR));
  const line = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    if ((i & CHUNK) === CHUNK) yield;
    const prev = i >= d ? line[i - d] : 0;
    line[i] = buf[i] + prev * fb;
    buf[i] += prev * wet;
  }
}

/** Schroeder reverb: 4 combs + 2 all-passes, mixed in at `wet` (yields between passes). */
function* applyReverb(buf: Float32Array, wet: number): Generator<void, void> {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map(t => Math.floor(t * SR));
  const fb = 0.82;
  const sum = new Float32Array(buf.length);
  for (const d of combs) {
    const line = new Float32Array(d);
    let p = 0,
      lp = 0;
    for (let i = 0; i < buf.length; i++) {
      if ((i & CHUNK) === CHUNK) yield;
      const y = line[p];
      lp = y * 0.7 + lp * 0.3;
      line[p] = buf[i] + lp * fb;
      sum[i] += y * 0.25;
      p = (p + 1) % d;
    }
    yield;
  }
  for (const t of [0.005, 0.0017]) {
    const d = Math.floor(t * SR);
    const line = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < buf.length; i++) {
      if ((i & CHUNK) === CHUNK) yield;
      const y = line[p];
      const x = sum[i];
      line[p] = x + y * 0.5;
      sum[i] = y - x * 0.5;
      p = (p + 1) % d;
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i] += sum[i] * wet;
}

/** Length in seconds a recipe renders to (layers + effect tails, capped). */
export function recipeLength(r: Recipe): number {
  if (r.loop) return r.loop;
  let end = 0;
  for (const l of r.L) end = Math.max(end, l.t + l.d);
  if (r.rev) end += TAIL_REV;
  if (r.echo) end += r.echo[0] * 5;
  return Math.min(MAX_LEN, Math.max(0.02, end));
}

/** Render a recipe to mono samples at SR. */
export function renderRecipe(r: Recipe, o: RenderOpts = {}): Float32Array {
  const it = renderSteps(r, o);
  for (;;) {
    const x = it.next();
    if (x.done) return x.value;
  }
}

/**
 * Samples between yields inside a layer (mask): 기획 13차 리뷰 — one long layer (drag.guardian.slam took 36 ms) no longer
 * overruns an idle slice; every ~4k samples is a place to stop.
 */
const CHUNK = 4095;

/** Resumable render: yields inside and after each layer / effect so idle baking can stop within its time slice. */
export function* renderSteps(r: Recipe, o: RenderOpts = {}): Generator<void, Float32Array> {
  const pitch = o.pitch ?? 1;
  const rand = rng(o.seed ?? 1);
  const loopXf = r.loop ? Math.min(0.25, r.loop * 0.2) : 0;
  const len = Math.ceil((recipeLength(r) + loopXf) * SR);
  const buf = new Float32Array(len);
  for (const l of r.L) {
    if (l.t * SR >= len) continue;
    if (l.k === 'tone') yield* renderTone(buf, l, pitch);
    else if (l.k === 'bell') yield* renderBell(buf, l, pitch);
    else yield* renderNoise(buf, l, pitch, rand);
    yield;
  }
  if (r.dist) yield* applyDist(buf, r.dist);
  if (r.echo) yield* applyEcho(buf, r.echo);
  yield;
  if (r.rev) {
    yield* applyReverb(buf, r.rev);
    yield;
  }
  if (r.reverse) buf.reverse();
  let out = buf;
  if (r.loop) {
    // fold the extra tail over the head (equal-power crossfade) → seamless loop of r.loop seconds
    const n = Math.floor(r.loop * SR);
    const xf = len - n;
    out = buf.slice(0, n);
    for (let i = 0; i < xf && i < n; i++) {
      const u = i / xf;
      out[i] = out[i] * Math.sin((Math.PI / 2) * u) + buf[n + i] * Math.cos((Math.PI / 2) * u);
    }
  } else {
    // 2 ms fades at both ends
    const f = Math.min(out.length >> 1, Math.floor(0.002 * SR));
    for (let i = 0; i < f; i++) {
      out[i] *= i / f;
      out[out.length - 1 - i] *= i / f;
    }
  }
  yield;
  normalize(out, r.peak ?? 0.9);
  return out;
}

function normalize(buf: Float32Array, peak: number): void {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m < 1e-6) return;
  const k = peak / m;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
}

/** Peak absolute sample (tests). */
export function peakOf(buf: Float32Array): number {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  return m;
}
