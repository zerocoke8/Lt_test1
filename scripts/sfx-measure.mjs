// 기획 21차: one loudness meter for both the synth sounds (node) and the decoded sound files (Chromium page).
// scripts/sfx-levels.mjs imports it in node and injects the same text into the page, so both sides measure alike.
// Plain JS on purpose (no imports, no helpers): the function body is sent to the browser as it is.

/**
 * Measure one sound. `chans` = Float32Array per channel (averaged to mono), `sr` = sample rate.
 * Returns peak (linear), lufs (K-weighted: max 400 ms momentary loudness, or the mean over the whole sound for a loop),
 * lead (s until the first sample above −40 dBFS; null when silent), tail (s after the last sample above −40 dB under
 * the peak) and seconds.
 */
export function measureSound(chans, sr, loop) {
  const n = chans[0].length;
  const x = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) x[i] += c[i] / chans.length;
  let peak = 0;
  let lead = null;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (lead == null && a > 0.01) lead = i / sr;
  }
  let tail = 0;
  for (let i = n - 1; i >= 0; i--)
    if (Math.abs(x[i]) > peak * 0.01) {
      tail = (i + 1) / sr;
      break;
    }
  // ITU-R BS.1770 K-weighting (pre-filter shelf + RLB high-pass), coefficients for any sample rate (libebur128)
  const biquad = (b, a, v) => {
    const out = new Float32Array(v.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < v.length; i++) {
      const y = b[0] * v[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = v[i]; y2 = y1; y1 = y;
      out[i] = y;
    }
    return out;
  };
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const pre = biquad(
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    x,
  );
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const kw = biquad([1, -2, 1], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0], pre);
  // cumulative energy → any window's mean square
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + kw[i] * kw[i];
  let ms;
  if (loop) ms = cum[n] / Math.max(1, n);
  else {
    const w = Math.round(0.4 * sr);
    const hop = Math.max(1, Math.round(0.01 * sr));
    ms = 0;
    // windows that start before the sound count the silence before it (a sound shorter than 400 ms = its energy / 400 ms)
    for (let s = -w + hop; s < n; s += hop) {
      const e = cum[Math.min(n, s + w)] - cum[Math.max(0, s)];
      if (e / w > ms) ms = e / w;
    }
  }
  const lufs = ms > 0 ? -0.691 + 10 * Math.log10(ms) : -120;
  // hit: where the loud part starts — the first 50 ms window (5 ms hop, plain energy) holding at least half the energy
  // of the loudest 50 ms window. Lines a file up with its synth sound / a stage cue's lead (sfx-levels).
  const raw = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) raw[i + 1] = raw[i] + x[i] * x[i];
  const hw = Math.max(1, Math.round(0.05 * sr));
  const hh = Math.max(1, Math.round(0.005 * sr));
  let best = 0;
  for (let s = 0; s + hw <= n || s === 0; s += hh) {
    best = Math.max(best, raw[Math.min(n, s + hw)] - raw[s]);
    if (s + hw > n) break;
  }
  let hit = null;
  if (best > 0)
    for (let s = 0; s < n; s += hh)
      if (raw[Math.min(n, s + hw)] - raw[s] >= best * 0.5) {
        hit = s / sr;
        break;
      }
  return { peak, lufs, lead, tail, hit, seconds: n / sr };
}
