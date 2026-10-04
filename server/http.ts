// Static files from the client build (dist/) + GET /healthz. Small in-memory cache with gzip.

import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest)|image\/svg)/;

interface Cached {
  mtimeMs: number;
  size: number;
  body: Buffer;
  gz: Buffer | null;
  etag: string;
}

export function createStaticHandler(staticDir: string): (req: IncomingMessage, res: ServerResponse) => void {
  const root = path.resolve(staticDir);
  const cache = new Map<string, Cached>();

  const plain = (res: ServerResponse, code: number, text: string, extra: Record<string, string> = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(text);
  };

  async function load(file: string): Promise<Cached | null> {
    let st;
    try {
      st = await stat(file);
      if (st.isDirectory()) {
        file = path.join(file, 'index.html');
        st = await stat(file);
      }
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const body = await readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const gz = COMPRESSIBLE.test(type) && body.length > 1024 ? gzipSync(body, { level: 9 }) : null;
    const entry: Cached = { mtimeMs: st.mtimeMs, size: st.size, body, gz, etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"` };
    cache.set(file, entry);
    return entry;
  }

  return (req, res) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      plain(res, 400, 'Bad request');
      return;
    }
    if (pathname === '/healthz') {
      plain(res, 200, 'ok');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      plain(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? `${pathname}index.html` : pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      plain(res, 404, 'Not found');
      return;
    }
    load(file).then(
      entry => {
        if (!entry) {
          plain(res, 404, 'Not found');
          return;
        }
        const ext = path.extname(file).toLowerCase() || '.html';
        const type = TYPES[ext] ?? 'application/octet-stream';
        const headers: Record<string, string> = {
          'Content-Type': type,
          // the single-file build has no hashed names: always revalidate (ETag makes it cheap)
          'Cache-Control': 'no-cache',
          ETag: entry.etag,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          Vary: 'Accept-Encoding',
        };
        if (req.headers['if-none-match'] === entry.etag) {
          res.writeHead(304, headers);
          res.end();
          return;
        }
        const gzipOk = !!entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
        const body = gzipOk ? entry.gz! : entry.body;
        if (gzipOk) headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = String(body.length);
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : body);
      },
      () => plain(res, 500, 'Server error'),
    );
  };
}
