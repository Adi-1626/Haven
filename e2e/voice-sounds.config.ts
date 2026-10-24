import { defineConfig } from '@playwright/test';
import configuration from './streams.config';
// Launches its own Chromium and Firefox with each engine's default autoplay policy. The other
// configurations allow audio without a user gesture, which hides suspended Web Audio playback.
export default defineConfig({ ...configuration, testMatch: 'voice-sounds.spec.ts', outputDir: '../test-results/voice-sounds', use: { ...configuration.use, channel: undefined } });
