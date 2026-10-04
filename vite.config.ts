import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build so the prototype can be shared as one HTML page.
// Dev multiplayer: `npm run dev` + `npm run dev:server` (game server on :8787); /ws and /healthz are proxied to it.
const GAME_SERVER = process.env.GAME_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  server: {
    proxy: {
      '/ws': { target: GAME_SERVER.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      '/healthz': {
        target: GAME_SERVER,
        changeOrigin: true,
        // game server not running: answer "not a game server" (200, not "ok") instead of vite's 500, so the page goes
        // solo-only quietly (no console error, no probe retries); 매칭 "다시 시도" probes again once it is up
        configure: (proxy: { on(ev: 'error', fn: (err: Error, req: unknown, res: unknown) => void): void }) => {
          proxy.on('error', (_err, _req, res) => {
            const r = res as { headersSent?: boolean; writeHead?: (code: number, h: Record<string, string>) => { end(body: string): void } };
            if (r && typeof r.writeHead === 'function' && !r.headersSent) r.writeHead(200, { 'content-type': 'text/plain' }).end('no game server (npm run dev:server)');
          });
        },
      },
    },
  },
  // `vite preview` (static e2e build) would inherit server.proxy: no game server there → solo only
  preview: { proxy: {} },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
