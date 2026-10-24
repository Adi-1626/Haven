import { defineConfig } from '@playwright/test';
import configuration from './streams.config';
// Bundled Chromium (the Electron engine) and Firefox: a Chrome channel would also be applied to Firefox.
export default defineConfig({ ...configuration, testMatch: 'voice-signaling.spec.ts', outputDir: '../test-results/voice-signaling', use: { ...configuration.use, channel: undefined } });
