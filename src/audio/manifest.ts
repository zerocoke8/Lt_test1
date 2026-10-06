// 기획 13차 효과음: real sound files replace synth sounds one id at a time (docs/sfx.md 2-2).
// Drop `src/audio/files/<id>.mp3` (or .m4a / .wav) in and that id plays the file; `skill.<skillId>.mp3` replaces a
// whole drag / ult. The single-file artifact build inlines the files; with no files the build is unchanged.
// Lookup: ① skill.<skillId> file → ② id file → ③ the id's synth recipe → ④ family default synth → ⑤ silence.
// Prefer mono mp3 / m4a 96 kbps, ≤ 3 MB in all; no ogg (old iOS Safari). Note each file's source + licence below.

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
export const SFX_MANIFEST: Record<string, ManifestEntry> = {};

export interface FileSource {
  urls: string[];
  gain: number;
  rate: [number, number];
}

/** Bundled files: './files/<name>' → url (data: URI in the single-file build). Empty folder → {}. */
const BUNDLED = import.meta.glob('./files/*.{mp3,m4a,wav}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const idOf = (name: string): string => name.replace(/\.(mp3|m4a|wav)$/i, '');

/** id → file source, from the bundled files (by name) and the manifest (explicit lists, gain, rate). */
export function buildFileTable(files: Record<string, string>, manifest: Record<string, ManifestEntry>): Map<string, FileSource> {
  const byName = new Map(Object.entries(files).map(([p, url]) => [baseName(p), url]));
  const out = new Map<string, FileSource>();
  for (const [name, url] of byName) out.set(idOf(name), { urls: [url], gain: 1, rate: [1, 1] });
  for (const [id, m] of Object.entries(manifest)) {
    const urls = m.src.map(n => byName.get(n)).filter((u): u is string => !!u);
    if (urls.length) out.set(id, { urls, gain: m.gain ?? 1, rate: m.rate ?? [1, 1] });
  }
  return out;
}

export const FILE_TABLE: Map<string, FileSource> = buildFileTable(BUNDLED, SFX_MANIFEST);

export type Source = { kind: 'file'; id: string } | { kind: 'synth'; id: string } | null;

export interface ResolveDeps {
  files: ReadonlyMap<string, unknown>;
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
