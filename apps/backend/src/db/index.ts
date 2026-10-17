import path from 'node:path';
import type { DatabaseAdapter } from './types.js';
import { SqliteAdapter } from './sqlite.js';
import { PostgresAdapter } from './postgres.js';

export * from './types.js';
export { SqliteAdapter } from './sqlite.js';
export { PostgresAdapter } from './postgres.js';

export interface DatabaseOptions {
  dataDir?: string;
  databaseUrl?: string;
}

export function createDatabase(options: DatabaseOptions = {}): DatabaseAdapter {
  const isHosted = process.env.HAVEN_MODE === 'hosted' || (process.env.NODE_ENV === 'production' && !options.dataDir);
  const dbUrl = options.databaseUrl || process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

  if (isHosted && !dbUrl) {
    throw new Error('FATAL: Hosted mode requires a valid PostgreSQL connection URL (DATABASE_URL or SUPABASE_DATABASE_URL). Silent fallback to SQLite is strictly forbidden in hosted mode.');
  }

  if (dbUrl) {
    return new PostgresAdapter(dbUrl);
  }

  const dataDir = options.dataDir || path.resolve('data');
  return new SqliteAdapter(path.join(dataDir, 'relay.sqlite'));
}

