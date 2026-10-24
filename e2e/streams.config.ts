import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'stream-subscriptions.spec.ts', workers: 1,
  timeout: 180_000, expect: { timeout: 15_000 },
  outputDir: '../test-results/streams',
  use: {
    channel: 'chrome', headless: true, viewport: { width: 1440, height: 940 },
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
