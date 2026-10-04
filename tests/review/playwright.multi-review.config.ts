import { defineConfig } from '@playwright/test';

// Multiplayer UI review (tests/review/multi-ui-review.spec.ts). Builds the client into its own folder
// (REVIEW_OUT, default /tmp/swap-tower-review-dist) and runs the game server from source with vite-node on a free port,
// so it never touches dist/ or dist-server/ used by other runs.
// Run: npx playwright test -c tests/review/playwright.multi-review.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: /multi-ui-review\.spec\.ts$/,
  outputDir: process.env.E2E_RESULTS || '/tmp/swap-tower-review-results',
  timeout: 240_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  projects: [{ name: 'phone', use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }],
});
