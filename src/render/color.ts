// Colour helpers (cached, no per-frame churn). A leaf module (기획 19차: split from look.ts so the boss art kit can use
// them without importing look.ts, which imports the creature / boss registries). look.ts re-exports all of it.

const rgbCache = new Map<string, [number, number, number]>();

export function parseColor(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (c) return c;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  c = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [160, 160, 160];
  rgbCache.set(hex, c);
  return c;
}

const mixCache = new Map<string, string>();

/** Mix `hex` toward `toward` by t (0..1). Result cached as css string. */
export function mix(hex: string, toward: string, t: number): string {
  const key = hex + toward + t.toFixed(3);
  let s = mixCache.get(key);
  if (s) return s;
  const a = parseColor(hex);
  const b = parseColor(toward);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  s = `rgb(${r},${g},${bl})`;
  mixCache.set(key, s);
  return s;
}

export const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number) => mix(hex, '#000000', t);
