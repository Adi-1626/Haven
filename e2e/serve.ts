import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../apps/backend/src/app.js';

const directory = mkdtempSync(path.join(tmpdir(), 'haven-e2e-'));
const instance = createApp({ dataDir: directory, serveStatic: true, staticDir: path.resolve('apps/web/dist') });
instance.httpServer.listen(3107, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void instance.close().then(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); }); });
