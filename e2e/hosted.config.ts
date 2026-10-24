import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: ['hosted.spec.ts', 'hosted-ui.spec.ts'],
  timeout: 90_000,
  workers: 1,
  outputDir: '../test-results/hosted',
  expect: { timeout: 12_000 },
  use: {
    baseURL: 'http://127.0.0.1:3111',
    channel: 'chrome', headless: true,
    viewport: { width: 1440, height: 940 },
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: { command: 'npx tsx e2e/hosted-serve.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:3111', reuseExistingServer: false, timeout: 30_000 },
});
