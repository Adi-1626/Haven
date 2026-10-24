import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { PostgresAdapter } from './db/postgres.js';
import { InviteUnavailableError } from './db/invites.js';
import { createApp } from './app.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';
import { io as socketClient } from 'socket.io-client';

const connection = process.env.HAVEN_TEST_POSTGRES_URL;
test('isolated real PostgreSQL: invite locking, expiry, roles, duplicate joins and concurrent channel patches', { skip: !connection }, async () => {
  const url = new URL(connection!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This test only permits a disposable local PostgreSQL server');
  const admin = new pg.Client({ connectionString: connection, ssl: false });
  await admin.connect();
  const database = `haven_qa_invites_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const observer = new pg.Client({ connectionString: url.href, ssl: false });
  await observer.connect();
  const db = new PostgresAdapter({ connectionString: url.href, ssl: false, application_name: 'haven-invite-qa' });
  let apiApp: ReturnType<typeof createApp> | undefined;
  try {
    // Use the repository's actual table definitions. Supabase roles/RLS/auth
    // triggers are intentionally outside this local transaction test.
    const source = readFileSync(new URL('../../../supabase/migrations/20261016000002_haven_schema.sql', import.meta.url), 'utf8');
    const tables = source.split('-- 17. Enable Row Level Security')[0]
      .replace(/^CREATE EXTENSION[^\n]*$/gm, '')
      .replace(/^(?:GRANT |ALTER DEFAULT PRIVILEGES )[^\n]*$/gm, '');
    await observer.query(tables);
    for (const id of ['owner', 'guest', 'admin', 'newcomer']) await db.createUser({ id, username: id, displayName: id, settings: '{"profileCompleted":true}', createdAt: Date.now() });
    await db.createServer({ id: 'server', name: 'Postgres QA', icon: '', description: '', ownerId: 'owner', createdAt: Date.now() }, 'text', 'voice');
    const makeInvite = (code: string, expiresAt: number | null = null) => db.createInvite({ code, serverId: 'server', createdAt: Date.now(), expiresAt });
    const waitForLock = async () => {
      for (let i = 0; i < 200; i++) {
        const result = await observer.query("SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name = 'haven-invite-qa' AND wait_event_type = 'Lock'", [database]);
        if (result.rowCount) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Expected a real PostgreSQL lock wait');
    };

    // A completed revocation must win against a join queued behind its lock.
    await makeInvite('revoke-first');
    const locker = new pg.Client({ connectionString: url.href, ssl: false }); await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query("SELECT * FROM haven.invites WHERE code='revoke-first' FOR UPDATE");
      const joining = db.joinInvite('revoke-first', 'guest');
      const rejected = assert.rejects(joining, (error: unknown) => error instanceof InviteUnavailableError && error.status === 404);
      await waitForLock();
      await locker.query("UPDATE haven.invites SET revoked_at=$1 WHERE code='revoke-first'", [Date.now()]);
      await locker.query('COMMIT'); await rejected;
      assert.equal(await db.getMember('server', 'guest'), undefined);

      // Expiry is checked after acquiring a contested row, not before waiting.
      await makeInvite('expire-wait', Date.now() + 100);
      await locker.query('BEGIN');
      await locker.query("SELECT * FROM haven.invites WHERE code='expire-wait' FOR UPDATE");
      const expired = assert.rejects(db.joinInvite('expire-wait', 'guest'), (error: unknown) => error instanceof InviteUnavailableError && error.status === 410);
      await waitForLock(); await new Promise(resolve => setTimeout(resolve, 120));
      await locker.query('COMMIT'); await expired;
      assert.equal(await db.getMember('server', 'guest'), undefined);
    } finally { await locker.query('ROLLBACK'); await locker.end(); }

    // When the join already holds the row lock it commits first; revoke waits.
    // The wrapper delays real SQL at a deterministic point; it does not mock pg.
    await makeInvite('join-first');
    const pool = (db as any).pool as pg.Pool;
    const connect = pool.connect.bind(pool);
    let resume!: () => void, inserted!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const reached = new Promise<void>(resolve => { inserted = resolve; });
    (pool as any).connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      return { query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO haven.members')) { inserted(); await gate; }
        return query(sql, params);
      }, release: () => client.release() };
    };
    const joined = db.joinInvite('join-first', 'guest'); await reached;
    const revoked = db.revokeInvite('join-first', Date.now());
    await waitForLock(); resume(); await joined; await revoked;
    (pool as any).connect = connect;
    assert.equal((await db.getMember('server', 'guest'))?.role, 'member');
    await assert.rejects(db.joinInvite('join-first', 'guest'), InviteUnavailableError);
    await makeInvite('valid');
    await Promise.all([db.joinInvite('valid', 'admin'), db.joinInvite('valid', 'admin')]);
    await db.updateMemberRole('server', 'admin', 'admin');
    await db.joinInvite('valid', 'admin'); await db.joinInvite('valid', 'owner');
    assert.equal((await db.getMember('server', 'admin'))?.role, 'admin');
    assert.equal((await db.getMember('server', 'owner'))?.role, 'owner');
    assert.equal((await db.getServerMembers('server')).length, 3);
    await Promise.all([db.updateChannel('text', { name: 'Concurrent rename' }), db.updateChannel('text', { topic: 'Concurrent topic' })]);
    assert.equal((await db.getChannel('text'))?.name, 'Concurrent rename');
    assert.equal((await db.getChannel('text'))?.topic, 'Concurrent topic');

    // Real Hosted Express + real PostgreSQL + real Socket.IO. Only the remote
    // Supabase identity-provider lookup is simulated; no external accounts exist.
    const verifier = new SupabaseAuthVerifier('https://haven-pg-qa.supabase.co', 'test-service-key');
    (verifier as any).client = { auth: { getUser: async (token: string) => ({ data: { user: ['owner', 'guest', 'admin', 'newcomer'].includes(token) ? { id: token, email: `${token}@qa.example`, email_confirmed_at: new Date().toISOString() } : null }, error: null }) } };
    apiApp = createApp({ db, dataDir: 'scratch/pg-invites-api', supabaseVerifier: verifier, supabaseUrl: 'https://haven-pg-qa.supabase.co', supabaseAnonKey: 'test-publishable-key', supabaseServiceKey: '' });
    await new Promise<void>(resolve => apiApp!.httpServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(apiApp.httpServer.address() as { port: number }).port}`;
    const request = async (route: string, method = 'GET', body?: unknown, actor = 'owner') => {
      const response = await fetch(`${base}/api${route}`, { method, headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() as any };
    };
    assert.equal((await request('/config')).data.mode, 'hosted');
    assert.equal((await request('/bootstrap', 'GET', undefined, 'invalid')).status, 401);
    assert.equal((await request('/servers/server/invites', 'POST', {}, 'guest')).status, 403);
    const created = await request('/servers/server/channels', 'POST', { name: 'Hosted channel', type: 'voice' });
    assert.equal(created.status, 201);
    const channelId = created.data.channel.id;
    assert.equal((await request(`/channels/${channelId}`, 'PATCH', { name: 'Hosted renamed' }, 'admin')).status, 200);
    assert.equal((await request(`/channels/${channelId}`, 'DELETE', undefined, 'guest')).status, 403);
    assert.equal((await request(`/channels/${channelId}`, 'DELETE', undefined, 'admin')).status, 200);
    const invitation = await request('/servers/server/invites', 'POST', { expiresInHours: 24 });
    assert.equal(invitation.status, 201);
    assert.equal((await request(`/invites/${invitation.data.code}/join`, 'POST', {}, 'newcomer')).status, 200);
    assert.equal((await db.getMember('server', 'newcomer'))?.role, 'member');
    const clients = ['owner', 'admin'].map(token => socketClient(base, { auth: { token }, transports: ['websocket'], reconnection: false }));
    try {
      await Promise.all(clients.map(client => new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); })));
      const changes = clients.map(client => new Promise<any>(resolve => client.once('invites:changed', resolve)));
      assert.equal((await request(`/invites/${invitation.data.code}`, 'DELETE', undefined, 'admin')).status, 200);
      for (const change of await Promise.all(changes)) assert.equal(change.revokedCode, invitation.data.code);
      assert.equal((await request(`/invites/${invitation.data.code}/join`, 'POST', {}, 'newcomer')).status, 404);
    } finally { clients.forEach(client => client.disconnect()); }
  } finally {
    if (apiApp) await apiApp.close(); else await db.close();
    await observer.end();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); await admin.end();
  }
});
