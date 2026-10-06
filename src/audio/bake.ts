// 기획 13차 효과음: synth sounds are rendered once (32 kHz mono, plain JS) and kept in memory (2-1 bake.ts).
// Frequent ids get 3 variants (seed + ±3 % pitch). Rendering happens in idle slices of ≤ 8 ms, never inside a
// combat frame: the run's roster / pets / boss are queued at the scene start; a miss on a low-priority id only queues it.

import { recipeFor } from './synth/recipes';
import { renderRecipe, renderSteps } from './synth/prims';

export const VARIANT_PITCH = [1, 1.03, 0.97];
/** Idle-slice budget (ms). */
export const BAKE_SLICE_MS = 8;
/** 기획 13차 통합: budget when the idle callback only ran because its timeout passed (the page is busy). */
export const BAKE_BUSY_MS = 2;

/** How long one idle slice may bake: what the browser says is idle (at most a slice), a sliver when it is busy. */
export function bakeBudget(deadline?: { didTimeout: boolean; timeRemaining(): number }): number {
  if (!deadline) return BAKE_SLICE_MS;
  if (deadline.didTimeout) return BAKE_BUSY_MS;
  return Math.max(1, Math.min(BAKE_SLICE_MS, deadline.timeRemaining()));
}

/** Stable 32-bit hash of an id (variant seeds). */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Render variant v of a synth id (null = no recipe). */
export function bakeSamples(id: string, v = 0): Float32Array | null {
  const r = recipeFor(id);
  if (!r) return null;
  return renderRecipe(r, { seed: hashId(id) + v * 7919, pitch: VARIANT_PITCH[v % VARIANT_PITCH.length] });
}

export class Baker {
  private readonly cache = new Map<string, Float32Array | null>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  /** The sound being baked across idle slices. */
  private job: { key: string; it: Generator<void, Float32Array> } | null = null;

  private static key(id: string, v: number): string {
    return `${id}#${v}`;
  }

  has(id: string, v = 0): boolean {
    return this.cache.has(Baker.key(id, v));
  }

  /** Baked samples, rendering now if needed (null = no recipe). */
  now(id: string, v = 0): Float32Array | null {
    const k = Baker.key(id, v);
    if (!this.cache.has(k)) this.cache.set(k, bakeSamples(id, v));
    return this.cache.get(k) ?? null;
  }

  /** Queue ids (× variants) for idle baking. */
  enqueue(ids: Iterable<string>, variants = 1): void {
    for (const id of ids)
      for (let v = 0; v < variants; v++) {
        const k = Baker.key(id, v);
        if (this.cache.has(k) || this.queued.has(k)) continue;
        this.queued.add(k);
        this.queue.push(k);
      }
  }

  get pending(): number {
    return this.queue.length + (this.job ? 1 : 0);
  }

  /** Bake queued sounds until `budgetMs` is spent (a long sound continues next slice); returns how many finished. */
  pump(budgetMs = BAKE_SLICE_MS, clock: () => number = () => performance.now()): number {
    const t0 = clock();
    let n = 0;
    while ((this.job || this.queue.length) && clock() - t0 < budgetMs) {
      if (!this.job) {
        const key = this.queue.shift()!;
        this.queued.delete(key);
        if (this.cache.has(key)) continue;
        const [id, v] = key.split('#');
        const r = recipeFor(id);
        if (!r) {
          this.cache.set(key, null);
          continue;
        }
        const vi = Number(v);
        this.job = { key, it: renderSteps(r, { seed: hashId(id) + vi * 7919, pitch: VARIANT_PITCH[vi % VARIANT_PITCH.length] }) };
      }
      const step = this.job.it.next();
      if (step.done) {
        if (!this.cache.has(this.job.key)) this.cache.set(this.job.key, step.value);
        this.job = null;
        n++;
      }
    }
    return n;
  }

  /** Approximate memory of the baked samples (bytes). */
  bytes(): number {
    let b = 0;
    for (const s of this.cache.values()) b += s ? s.byteLength : 0;
    return b;
  }

  /** Drop everything (debug 다시 굽기). */
  clear(): void {
    this.cache.clear();
    this.job = null;
  }
}
