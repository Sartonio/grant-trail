require('dotenv').config({ path: '.env.local' });
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* 2 workers in CI: parallel speedup with low shared-account contention; locally scale with cores (2–4) — per-test seed data is Date.now()-suffixed, so cross-worker contention is low */
  workers: process.env.CI ? 2 : Math.max(2, Math.min(4, Math.floor(require('os').cpus().length / 2))),
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  /* Maximum time one test can run for. */
  timeout: 15000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     */
    timeout: 5000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || 'https://dummy.supabase.co',
      VITE_SUPABASE_KEY: process.env.VITE_SUPABASE_KEY || process.env.REACT_APP_SUPABASE_KEY || 'dummy-key',
    },
  },
});
