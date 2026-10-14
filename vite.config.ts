import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build so the prototype can be shared as one HTML page (code, styles and pictures inside index.html).
// 기획 21차 리뷰: the sound files (src/audio/files, ≈ 6 MB) are inlined only in the claude.ai artifact build
// (`vite build --mode artifact`, npm run build:artifact). The regular build (Fly, e2e) emits them as hashed files in
// assets/ — the page stays ≈ 1.3 MB, a phone fetches a sound only when a scene prepares it, and the game server sends
// them with a long cache (server/http.ts), so a deploy re-downloads just the page.
// Dev multiplayer: `npm run dev` + `npm run dev:server` (game server on :8787); /ws and /healthz are proxied to it.
const GAME_SERVER = process.env.GAME_SERVER ?? 'http://localhost:8787';
const SOUND_FILE = /\.(mp3|m4a|wav)$/i;

/**
 * 기획 21차 리뷰: a sound file whose levels.json row says `off` (a failed generation — the synth plays) is not shipped:
 * its `?url` import becomes an empty string (manifest.ts drops off ids before it reads the url).
 */
function skipOffSounds(): Plugin {
  const levels = JSON.parse(readFileSync(fileURLToPath(new URL('./src/audio/files/levels.json', import.meta.url)), 'utf8')) as Record<string, { off?: boolean }>;
  return {
    name: 'swap-tower:skip-off-sounds',
    enforce: 'pre',
    apply: 'build',
    load(id) {
      const m = id.match(/[\\/]src[\\/]audio[\\/]files[\\/]([^\\/?]+)\.(?:mp3|m4a|wav)\?url$/i);
      if (m && levels[m[1]]?.off) return 'export default "";';
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const inlineSounds = mode === 'artifact';
  return {
    base: './',
    plugins: [skipOffSounds(), viteSingleFile({ useRecommendedBuildConfig: false })],
    build: {
      // vite-plugin-singlefile's recommended settings, except that sound files stay separate outside the artifact build
      assetsInlineLimit: (file: string) => inlineSounds || !SOUND_FILE.test(file),
      chunkSizeWarningLimit: 100_000_000,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
    experimental: {
      // the code is inlined into index.html, so an asset url must resolve against the page (./assets/…), not the chunk
      renderBuiltUrl: (filename: string, { hostType }: { hostType: 'js' | 'css' | 'html' }) => (hostType === 'js' ? `./${filename}` : { relative: true }),
    },
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
  } as any;
});
