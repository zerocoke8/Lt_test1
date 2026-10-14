// 기획 13차 효과음: real sound files replace synth sounds one id at a time (docs/sfx.md 2-2).
// Drop `src/audio/files/<id>.mp3` (or .m4a / .wav) in and that id plays the file; `skill.<skillId>.mp3` replaces a
// whole drag / ult. The single-file artifact build inlines the files; with no files the build is unchanged.
// Lookup: ① skill.<skillId> file → ② id file → ③ the id's synth recipe → ④ family default synth → ⑤ silence.
// 기획 21차: every id has a file (≈ 6 MB in all, budget in tests/ui/audio.test.ts); files/levels.json matches each file's
// level to its synth sound and trims its silent head / tail (scripts/sfx-levels.mjs). No ogg (old iOS Safari). Note each
// hand-made file's source + licence below.

import levelsJson from './files/levels.json';

export interface ManifestEntry {
  /** File names in src/audio/files (several = random variant). */
  src: string[];
  /** Linear gain (default 1). */
  gain?: number;
  /** Random playback-rate range (default [1, 1]). */
  rate?: [number, number];
  /** 출처. */
  source?: string;
  /** 라이선스. */
  license?: string;
}

/** Per-id overrides. Example: 'drag.guardian.wave': { src: ['wave-a.mp3', 'wave-b.mp3'], gain: 0.8, rate: [0.96, 1.04], source: '…', license: 'CC0' }. */
export const SFX_MANIFEST: Record<string, ManifestEntry> = {
  // 기획 18차: first batch made with ElevenLabs text-to-sound-effects (scripts/sfx-gen.mjs; prompts in scripts/sfx-prompts.json,
  // what was sent per file in files/generated.json). The sounds that fire many times a second get a small random pitch
  // so one file does not sound like a machine gun. Every other generated file plays as it is (picked up by its name).
  ...Object.fromEntries(
    ['hit.basic', 'hit.skill', 'hit.boss', 'hurt.char', 'atk.swing.melee', 'atk.swing.tank', 'atk.shot.mage', 'heal.tick'].map(id => [
      id,
      { src: [`${id}.mp3`], rate: [0.94, 1.06] as [number, number], source: 'ElevenLabs sound effects (generated)', license: 'ElevenLabs terms of the generating account' },
    ]),
  ),
};

export interface FileSource {
  urls: string[];
  gain: number;
  rate: [number, number];
  /** Seconds of leading silence skipped (loops loop from here). */
  start: number;
  /** Seconds where a one-shot stops (its silent tail is not played); absent = the whole file. */
  end?: number;
  /** Seconds the file starts later than asked (a stage cue's hit would come early otherwise). */
  delay?: number;
  /** start was moved into the sound (a stage cue's lead): the engine fades the head in. */
  align?: boolean;
}

/**
 * 기획 21차: per-file level match (scripts/sfx-levels.mjs → files/levels.json): gain makes the file as loud as the synth
 * sound it replaces, start skips leading silence, end cuts a silent tail, off = a failed file (silent or far too quiet):
 * the id keeps its synth sound until the file is remade.
 */
export interface FileLevel {
  gain: number;
  start: number;
  end?: number;
  off?: boolean;
  /**
   * 기획 21차 리뷰: a stage cue with a lead (stages.ts) — the file's hit is lined up with the synth's: `align` = start was
   * moved later into the build-up (the head fades in), `delay` = the hit came early, so the file starts this much later.
   */
  align?: boolean;
  delay?: number;
}

const LEVELS = levelsJson as Record<string, FileLevel>;

/** Bundled files: './files/<name>' → url (data: URI in the single-file build). Empty folder → {}. */
const BUNDLED = import.meta.glob('./files/*.{mp3,m4a,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const idOf = (name: string): string => name.replace(/\.(mp3|m4a|wav)$/i, '');

/**
 * id → file source, from the bundled files (by name), their levels (gain / start / end; `off` drops the id so its synth
 * plays) and the manifest (explicit lists; its gain / rate win over the levels).
 */
export function buildFileTable(files: Record<string, string>, manifest: Record<string, ManifestEntry>, levels: Record<string, FileLevel> = {}): Map<string, FileSource> {
  const byName = new Map(Object.entries(files).map(([p, url]) => [baseName(p), url]));
  const out = new Map<string, FileSource>();
  const lv = (id: string): Omit<FileSource, 'urls' | 'rate'> => {
    const l = levels[id];
    return {
      gain: l?.gain ?? 1,
      start: Math.max(0, l?.start ?? 0),
      ...(l?.end != null ? { end: l.end } : null),
      ...(l?.delay ? { delay: l.delay } : null),
      ...(l?.align ? { align: true } : null),
    };
  };
  for (const [name, url] of byName) {
    const id = idOf(name);
    if (!levels[id]?.off) out.set(id, { urls: [url], rate: [1, 1], ...lv(id) });
  }
  for (const [id, m] of Object.entries(manifest)) {
    if (levels[id]?.off) continue;
    const urls = m.src.map(n => byName.get(n)).filter((u): u is string => !!u);
    if (urls.length) out.set(id, { urls, ...lv(id), gain: m.gain ?? lv(id).gain, rate: m.rate ?? [1, 1] });
  }
  return out;
}

export const FILE_TABLE: Map<string, FileSource> = buildFileTable(BUNDLED, SFX_MANIFEST, LEVELS);

export type Source = { kind: 'file'; id: string } | { kind: 'synth'; id: string } | null;

export interface ResolveDeps {
  /** Ids that have a usable file (only `has` is asked). */
  files: { has(id: string): boolean };
  hasRecipe(id: string): boolean;
  family(id: string): string | null;
}

/** Where id's sound comes from (2-2 lookup order). `skill` = the casting skill for drag / ult sounds. */
export function resolveSource(id: string, deps: ResolveDeps, skill?: string): Source {
  if (skill && deps.files.has(`skill.${skill}`)) return { kind: 'file', id: `skill.${skill}` };
  if (deps.files.has(id)) return { kind: 'file', id };
  if (deps.hasRecipe(id)) return { kind: 'synth', id };
  const fam = deps.family(id);
  if (fam && deps.files.has(fam)) return { kind: 'file', id: fam };
  if (fam && deps.hasRecipe(fam)) return { kind: 'synth', id: fam };
  return null;
}
