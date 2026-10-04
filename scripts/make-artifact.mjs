// Turns the single-file build (dist/index.html) into a body fragment for publishing as a claude.ai Artifact.
// The Artifact host wraps the page in its own <!doctype>/<head>/<body>, so we keep only title, styles, app root and script.
// Usage: node scripts/make-artifact.mjs [input = dist/index.html] [outDir = dist-artifact]  (tests pass their own paths)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [input = 'dist/index.html', outDir = 'dist-artifact'] = process.argv.slice(2);
const html = readFileSync(input, 'utf8');
const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '스왑 타워 프로토';
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m => m[0].replace(/<style[^>]*>/, '<style>'));
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map(m => m[0].replace(/<script[^>]*>/, '<script type="module">'));
if (!scripts.length) throw new Error(`no script found in ${input} — run npm run build first`);

const out = [
  `<title>${title}</title>`,
  // Single dark look by design (game screen); set ground and color-scheme explicitly.
  '<style>:root{color-scheme:dark;background:#0b0d14}body{background:#0b0d14;color:#e8ecf4}</style>',
  ...styles,
  '<div id="app"></div>',
  // solo-only (기획 3차: claude.ai 링크는 혼자 하기만): no /healthz probe, no WebSocket → no network errors in the console
  '<script>window.__SWAP_TOWER_SOLO__=true</script>',
  ...scripts,
].join('\n');

mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'index.html');
writeFileSync(outFile, out);
console.log(`${outFile} (${(out.length / 1024).toFixed(1)} KB)`);
