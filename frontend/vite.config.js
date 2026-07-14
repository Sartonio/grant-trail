/// <reference types="vitest" />
import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Upload source maps + create a release only when an auth token is present
// (production/CI builds). Local dev and token-less builds skip it silently.
const sentryEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN);

const transformJsxInJs = () => ({
  name: 'transform-jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    if (!id.includes('src/')) return null;
    if (!id.endsWith('.js')) return null;
    return await transformWithOxc(code, id, { lang: 'jsx' });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    transformJsxInJs(),
    // Keep last so it can post-process the final bundle + maps.
    sentryEnabled &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
      }),
  ],
  optimizeDeps: {
    rolldownOptions: {
      moduleTypes: {
        '.js': 'jsx',
      },
    },
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    // Emit source maps so Sentry can de-minify production stack traces.
    // The vite-plugin deletes them from the bundle after upload.
    sourcemap: sentryEnabled,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    // Report-only coverage (no thresholds this wave) over the logic layers.
    // Records a baseline so a later wave can ratchet a floor at these numbers.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/hooks/**'],
      reporter: ['text', 'text-summary'],
    },
  },
});
