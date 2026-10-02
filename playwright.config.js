import { defineConfig, devices } from '@playwright/test';

/**
 * UI tests run against the esbuild dev build (`npm run dev`), which bundles
 * src/dev-entry.js — i.e. the app wired to src/dev-shim.js, a deterministic fake
 * of the Luna service + HA WebSocket. Tests assert on stable ids / class
 * contracts, never pixels, so a restyle keeps them green.
 */
export default defineConfig({
  testDir: './test/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
