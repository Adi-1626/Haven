import { createApp } from './app.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const instance = createApp({ dataDir: process.env.DATA_DIR, origins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').filter(Boolean) });
instance.httpServer.listen(port, host, () => console.log(`Haven server listening at http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void instance.close().then(() => process.exit(0)); });
