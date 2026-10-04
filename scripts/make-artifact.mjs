// Turns the single-file build (dist/index.html) into a body fragment for publishing as a claude.ai Artifact.
// The Artifact host wraps the page in its own <!doctype>/<head>/<body>, so we keep only title, styles, app root and script.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '스왑 타워 프로토';
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m => m[0].replace(/<style[^>]*>/, '<style>'));
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map(m => m[0].replace(/<script[^>]*>/, '<script type="module">'));
if (!scripts.length) throw new Error('no script found in dist/index.html — run npm run build first');

const out = [
  `<title>${title}</title>`,
  // Single dark look by design (game screen); set ground and color-scheme explicitly.
  '<style>:root{color-scheme:dark;background:#0b0d14}body{background:#0b0d14;color:#e8ecf4}</style>',
  ...styles,
  '<div id="app"></div>',
  ...scripts,
].join('\n');

mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/index.html', out);
console.log(`dist-artifact/index.html (${(out.length / 1024).toFixed(1)} KB)`);
