import { defineConfig } from '@playwright/test';
import configuration from './streams.config';
// Bundled Chromium (the Electron engine) and Firefox, as in voice-signaling.config.ts.
export default defineConfig({ ...configuration, testMatch: 'voice-diagnostics.spec.ts', outputDir: '../test-results/voice-diagnostics', use: { ...configuration.use, channel: undefined } });
