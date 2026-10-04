import { defineConfig } from '@playwright/test';

// E2E against the production single-file build (dist/index.html served by `vite preview`).
// Chromium is preinstalled at /opt/pw-browsers/chromium — never run `playwright install`.
// Multiplayer specs (tests/e2e/multi*.spec.ts, project 'multi') start the built game server themselves on a free port.
// Env (lets two checkouts/agents run e2e side by side): E2E_PORT (preview port, default 4173), E2E_OUT (build dir,
// default dist), E2E_RESULTS (Playwright output dir, default test-results).
const PORT = Number(process.env.E2E_PORT) || 4173;
const OUT = process.env.E2E_OUT || 'dist';
const MULTI = /multi.*\.spec\.ts$/;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: process.env.E2E_RESULTS || 'test-results',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // the game loop is real-time; two heavy canvases at once on a 4-CPU box makes timings flaky
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      testIgnore: MULTI,
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      testIgnore: MULTI,
      use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    },
    {
      // several browser contexts (phone + desktop) against the real game server; viewports are set per context
      name: 'multi',
      testMatch: MULTI,
      timeout: 300_000,
    },
  ],
  webServer: {
    // vite build only (no tsc): a type error elsewhere must not block the browser tests
    command: `npx vite build --outDir ${OUT} --emptyOutDir && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { E2E_OUT: OUT },
  },
});
