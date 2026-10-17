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

if (instance.adapter.isPostgres && typeof (instance.adapter as any).checkConnection === 'function') {
  try {
    await (instance.adapter as any).checkConnection();
    console.log('Haven PostgreSQL connection verified successfully.');
  } catch (error) {
    console.error('FATAL: Failed to connect to PostgreSQL database in hosted mode:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

instance.httpServer.listen(port, host, () => {
  console.log(`Haven backend listening at http://${host}:${port}`);
});


for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void instance.close().then(() => process.exit(0));
  });
}
