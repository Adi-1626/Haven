import { createApp } from './app.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';

const envFile = process.env.HAVEN_ENV_FILE || (process.argv.includes('--hosted') ? '.env.hosted' : undefined);
if (envFile) {
  const candidatePaths = [
    envFile,
    path.resolve(envFile),
    path.resolve('../../', envFile),
    path.resolve('../', envFile),
  ];
  const resolvedEnv = candidatePaths.find(p => existsSync(p));
  if (resolvedEnv) {
    try {
      loadEnvFile(resolvedEnv);
      console.log(`Loaded environment from ${resolvedEnv}`);
    } catch (error) {
      console.error(`FATAL: Failed to load specified env file "${resolvedEnv}":`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    console.error(`FATAL: Specified environment file "${envFile}" does not exist. Please copy .env.hosted.example to ${envFile} and configure your Supabase credentials.`);
    process.exit(1);
  }
} else if (process.env.NODE_ENV !== 'production') {
  for (const envPath of ['.env', '../../.env', '../.env']) {
    if (existsSync(envPath)) {
      try { loadEnvFile(envPath); break; } catch {}
    }
  }
}

if (process.argv.includes('--hosted')) {
  process.env.HAVEN_MODE = 'hosted';
}

// Explicit Local Mode (the desktop's private backend) never reaches the Hosted database or Storage.
// A stray Hosted setting is a configuration error, not a reason to switch databases.
if (process.env.HAVEN_MODE === 'local') {
  const hostedSettings = ['DATABASE_URL', 'SUPABASE_DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_KEY'].filter(name => process.env[name]);
  if (hostedSettings.length) {
    console.error(`FATAL: Local Mode uses only its own SQLite data, but Hosted settings are present: ${hostedSettings.join(', ')}. Remove them or run Hosted Mode instead.`);
    process.exit(1);
  }
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const isHosted = process.env.HAVEN_MODE === 'hosted' || (process.env.NODE_ENV === 'production' && !process.env.DATA_DIR);
if (isHosted) {
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!dbUrl) {
    console.error('FATAL: Hosted mode requires a valid PostgreSQL connection URL (DATABASE_URL or SUPABASE_DATABASE_URL). Silent fallback to SQLite is strictly forbidden.');
    process.exit(1);
  }
  if (dbUrl.includes('[YOUR') || dbUrl.includes('[YOUR-DB-PASSWORD]')) {
    console.error('FATAL: DATABASE_URL in environment still contains placeholder text. Please provide your real Supabase database connection URL.');
    process.exit(1);
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl) {
    console.error('FATAL: Hosted mode requires SUPABASE_URL to be set. Silent fallback to SQLite/local mode is strictly forbidden.');
    process.exit(1);
  }
  if (!supabaseAnonKey) {
    console.error('FATAL: Hosted mode requires SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) for client Supabase Auth.');
    process.exit(1);
  }
  if (!supabaseServiceKey) {
    console.error('FATAL: Hosted mode requires SUPABASE_SERVICE_ROLE_KEY for secure storage operations and backend auth verification.');
    process.exit(1);
  }
  if (supabaseServiceKey.includes('[YOUR') || supabaseServiceKey.includes('YOUR_')) {
    console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY in environment contains a placeholder. Please configure your real secret service_role key from Supabase Dashboard -> Project Settings -> API Keys.');
    process.exit(1);
  }
}

const instance = createApp({
  dataDir: process.env.DATA_DIR,
  databaseUrl: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
  origins,
  publicUrl: process.env.PUBLIC_URL,
  serveStatic: process.env.SERVE_STATIC === 'true',
  staticDir: process.env.STATIC_DIR,
});

if (instance.adapter.isPostgres) {
  // A transient pooler/DNS failure during a deploy should not crash-loop the service; a persistent
  // misconfiguration (bad credentials, TLS) still exits after the bounded retries.
  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      await instance.adapter.checkConnection();
      console.log('Haven PostgreSQL connection verified successfully.');
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts) {
        console.error('FATAL: Failed to connect to PostgreSQL database in hosted mode:', message);
        process.exit(1);
      }
      console.warn(`PostgreSQL connection attempt ${attempt}/${attempts} failed: ${message}. Retrying.`);
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

instance.httpServer.listen(port, host, () => {
  console.log(`Haven backend listening at http://${host}:${port}`);
});


let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Bounded: a hung database or client must not block the platform's restart indefinitely.
    setTimeout(() => { console.error('Graceful shutdown timed out; exiting.'); process.exit(1); }, 15_000).unref();
    instance.close().then(() => process.exit(0), error => {
      console.error('Graceful shutdown failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
  });
}
