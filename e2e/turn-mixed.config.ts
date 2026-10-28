import { defineConfig } from '@playwright/test';
import configuration from './streams.config';
// Bundled Chromium (the Electron engine); a local TURN relay is started by the spec itself.
export default defineConfig({ ...configuration, testMatch: 'turn-mixed.spec.ts', outputDir: '../test-results/turn-mixed', use: { ...configuration.use, channel: undefined } });
