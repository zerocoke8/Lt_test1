import { defineConfig } from '@playwright/test';

// E2E against the production single-file build (dist/index.html served by `vite preview`).
// Chromium is preinstalled at /opt/pw-browsers/chromium — never run `playwright install`.
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
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
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
