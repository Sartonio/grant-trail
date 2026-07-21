require('dotenv').config({ path: '.env.local' });
const { defineConfig, devices } = require('@playwright/test');

/* Per-worktree stacks (scripts/stack-env.sh) export E2E_PORT so each worktree's
   Vite + e2e run on their own port; the main checkout stays on 3000. */
const PORT = Number(process.env.E2E_PORT || 3000);

module.exports = defineConfig({
  testDir: './tests/e2e',
  /* Fail fast with an actionable message when the stack env isn't exported
     (see tests/e2e/global-setup.js) instead of every spec failing in beforeAll. */
  globalSetup: require.resolve('./tests/e2e/global-setup.js'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* 2 workers in CI: parallel speedup with low shared-account contention; locally scale with cores (2–4) — per-test seed data is Date.now()-suffixed, so cross-worker contention is low */
  workers: process.env.CI ? 2 : Math.max(2, Math.min(4, Math.floor(require('os').cpus().length / 2))),
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
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
    /* --strictPort: a silent Vite fallback to another port would make every
       test hit the wrong (or another worktree's) app. */
    command: `npm start -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || 'https://dummy.supabase.co',
      VITE_SUPABASE_KEY: process.env.VITE_SUPABASE_KEY || process.env.REACT_APP_SUPABASE_KEY || 'dummy-key',
    },
  },
});
