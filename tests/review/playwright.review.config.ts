import { defineConfig } from '@playwright/test';

// UI rules review against the Vite dev server (no build, so it never touches dist/ used by other runs).
// Run: npx playwright test -c tests/review/playwright.review.config.ts
const PORT = 5297;

export default defineConfig({
  testDir: '.',
  testMatch: /ui-review\.spec\.ts$/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  projects: [{ name: 'phone', use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
