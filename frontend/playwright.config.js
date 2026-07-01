require('dotenv').config({ path: '.env.local' });
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1, /* 2 workers in CI: parallel speedup with low shared-account contention; single worker locally so a dev can pause/intervene */
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
