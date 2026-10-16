import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import configuration from '../playwright.config';
export default defineConfig({ ...configuration, testDir: '.', testMatch: 'media-debug.spec.ts', webServer: { ...(configuration.webServer as object), command: 'npx tsx e2e/serve.ts', cwd: fileURLToPath(new URL('..', import.meta.url)) } });
