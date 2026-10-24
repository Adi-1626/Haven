import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['hosted.spec.ts', 'hosted-ui.spec.ts', 'dev-ui.spec.ts', 'dev-ui-auth.spec.ts', 'media-debug.spec.ts', 'stream-subscriptions.spec.ts', 'zenith-dialogs-and-voice.spec.ts'],
  timeout: 90_000,
  workers: 1,
  expect: { timeout: 12_000 },
  use: {
    baseURL: 'http://127.0.0.1:3107',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 940 },
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npx tsx e2e/serve.ts', url: 'http://127.0.0.1:3107/api/health', reuseExistingServer: true, timeout: 30_000 },
});
