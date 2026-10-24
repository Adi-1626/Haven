import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createApp, HAVEN_VERSION } from './app.js';
import { PostgresAdapter } from './db/postgres.js';

// Real PostgreSQL. Requires HAVEN_TEST_POSTGRES_URL pointing at a disposable loopback server.
const connection = process.env.HAVEN_TEST_POSTGRES_URL;

test('terminated pooled connections do not crash the backend and requests recover; readiness reflects the database', { skip: !connection }, async () => {
  const url = new URL(connection!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This test only permits a disposable local PostgreSQL server');
  const admin = new pg.Client({ connectionString: connection, ssl: false });
  await admin.connect();
  const database = `haven_qa_resilience_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-resilience-'));
  const instances: ReturnType<typeof createApp>[] = [];
  const failures: unknown[] = [];
  const onCrash = (error: unknown) => failures.push(error);
  process.on('uncaughtException', onCrash);
  try {
    const setup = new pg.Client({ connectionString: url.href, ssl: false }); await setup.connect();
    const source = fs.readFileSync(new URL('../../../supabase/migrations/20261016000002_haven_schema.sql', import.meta.url), 'utf8');
    await setup.query(source.split('-- 17. Enable Row Level Security')[0].replace(/^CREATE EXTENSION[^\n]*$/gm, '').replace(/^(?:GRANT |ALTER DEFAULT PRIVILEGES )[^\n]*$/gm, ''));
    await setup.end();
    const start = async (connectionString: string) => {
      const instance = createApp({ db: new PostgresAdapter({ connectionString, ssl: false, application_name: 'haven-resilience' }), dataDir: directory });
      await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
      instances.push(instance);
      return `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
    };
    const base = await start(url.href);
    const ready = async (target: string) => { const response = await fetch(`${target}/api/ready`); return { status: response.status, data: await response.json() as any }; };
    assert.deepEqual(await ready(base), { status: 200, data: { ok: true, version: HAVEN_VERSION, database: 'ok' } });

    // Idle pooled connections terminated by a restart/failover/pooler recycle (SQLSTATE 57P01).
    const terminated = await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND application_name = 'haven-resilience'", [database]);
    assert.ok(terminated.rowCount! >= 1);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(failures, [], 'the process did not hit an unhandled pool error');
    assert.equal((await ready(base)).status, 200, 'the next request reconnects');
    assert.equal((await fetch(`${base}/api/invites/does-not-exist`)).status, 404, 'database-backed routes work again');

    // An unreachable database is reported as not ready instead of hanging or claiming health.
    const unreachable = new URL(url.href); unreachable.port = '1';
    const down = await start(unreachable.href);
    const startedAt = Date.now();
    assert.deepEqual(await ready(down), { status: 503, data: { ok: false, database: 'unavailable' } });
    assert.ok(Date.now() - startedAt < 12_000);
    assert.equal((await fetch(`${down}/api/health`)).status, 200, 'liveness stays independent of the database');
  } finally {
    process.off('uncaughtException', onCrash);
    for (const instance of instances) await instance.close().catch(() => {});
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
