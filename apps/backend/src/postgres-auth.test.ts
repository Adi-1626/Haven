import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAdapter } from './db/postgres.js';

// Driver-boundary tests only. These execute the real adapter with a fake pg client;
// they do not claim to validate PostgreSQL SQL execution, indexes, RLS or triggers.
async function harness(result: { rows?: unknown[]; rowCount?: number; error?: unknown } = {}) {
  const db = new PostgresAdapter('postgres://unused:unused@127.0.0.1:1/unused');
  await db.close();
  const calls: { sql: string; params: unknown[] }[] = [];
  let releases = 0;
  (db as any).pool = { connect: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SET search_path')) return { rows: [], rowCount: 0 };
      calls.push({ sql, params });
      if (result.error) throw result.error;
      return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
    },
    release: () => releases++,
  }) };
  return { db, calls, releases: () => releases };
}

test('Postgres auth mapping handles JSONB settings and bigint timestamps unlike SQLite rows', async () => {
  const { db, calls, releases } = await harness({ rows: [{ id: 'account', username: 'Existing.Name', display_name: 'Existing', settings: { profileCompleted: false }, created_at: '1792242000000', status: 'offline' }] });
  const user = await db.getUserByUsername('EXISTING.NAME');
  assert.equal(user?.displayName, 'Existing');
  assert.equal(JSON.parse(user!.settings).profileCompleted, false);
  assert.equal(user?.createdAt, 1792242000000);
  assert.match(calls[0].sql, /LOWER\(username\) = LOWER\(\$1\)/);
  assert.deepEqual(calls[0].params, ['EXISTING.NAME']);
  assert.equal(releases(), 1);
});

test('Postgres completion uses one conditional statement and distinguishes conflicts from infrastructure failure', async () => {
  for (const [result, expected] of [
    [{ rowCount: 1 }, 'completed'], [{ rowCount: 0 }, 'already-complete'],
    [{ error: { code: '23505' } }, 'unavailable'],
  ] as const) {
    const { db, calls, releases } = await harness(result);
    assert.equal(await db.completeUserProfile('account', 'chosen_name', 'Chosen'), expected);
    assert.equal(calls.length, 1, 'identity and completion must be saved together');
    assert.match(calls[0].sql, /settings->'profileCompleted' = 'false'::jsonb/);
    assert.deepEqual(calls[0].params, ['chosen_name', 'Chosen', 'account']);
    assert.equal(releases(), 1);
  }
  const failure = new Error('connection failed');
  const { db, releases } = await harness({ error: failure });
  await assert.rejects(db.completeUserProfile('account', 'chosen_name', 'Chosen'), failure);
  assert.equal(releases(), 1);
});

test('Postgres concurrent account insertion never overwrites an existing identity and avatar updates do not replay stale settings', async () => {
  const { db, calls } = await harness();
  await db.createUser({ id: 'account', username: 'initial', displayName: 'Initial', settings: '{"profileCompleted":false}', createdAt: 1 });
  assert.match(calls[0].sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.equal(calls[0].params[4], '{"profileCompleted":false}');
  await db.updateUser('account', { avatar: '/api/users/account/avatar?v=new.png' });
  assert.equal(calls.length, 2, 'avatar writes must not read then rewrite completion or identity');
  assert.deepEqual(calls[1].params, [null, null, '/api/users/account/avatar?v=new.png', null, null, 'account']);
});
