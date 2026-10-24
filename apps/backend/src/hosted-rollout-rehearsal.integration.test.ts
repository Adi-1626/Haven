import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { PostgresAdapter } from './db/postgres.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';

// Full H-01 rollout + rollback rehearsal, executing the repository's actual migration files and
// supabase/manual/*.sql in docs/HOSTED-AUTH-ROLLOUT.md order on a disposable PostgreSQL database shaped
// like the audited production state. Supabase auth/storage/migration-history schemas and roles are
// minimal stubs; psql `:'var'` and `\i :var` are emulated; the migration role is a local superuser.
// The provider stub deliberately does NOT check sessions in getUser (the weakest documented behavior),
// so durable logout is proven by Haven's own auth.sessions check, not by the provider.
const connection = process.env.HAVEN_TEST_POSTGRES_URL;
const supabaseDir = new URL('../../../supabase/', import.meta.url);
const sqlFile = (name: string) => fs.readFileSync(new URL(name, supabaseDir), 'utf8');
const preRollout = fs.readdirSync(new URL('migrations/', supabaseDir)).filter(name => name.endsWith('.sql') && name < '20261018').sort();
const TRIGGER_MIGRATION = '20261018145338_trusted_profile_onboarding.sql';
const SESSION_MIGRATION = '20261021180000_auth_session_check.sql';
const asText = { getTypeParser: (oid: number, format?: any) => oid === 1184 ? (value: string) => value : pg.types.getTypeParser(oid, format) };

/** Executes a psql script the way `psql -X --set=ON_ERROR_STOP=on` would for our scripts. */
async function psql(client: pg.Client, script: string, vars: Record<string, string> = {}) {
  const notices: string[] = [];
  const onNotice = (notice: { message?: string }) => notices.push(notice.message ?? '');
  const expanded = script.split('\n').map(line => {
    const include = /^\\i\s+:(\w+)\s*$/.exec(line);
    if (include) return fs.readFileSync(vars[include[1]] ?? (() => { throw new Error(`Missing psql variable ${include[1]}`); })(), 'utf8');
    if (line.startsWith('\\')) throw new Error(`Unsupported psql meta-command: ${line}`);
    return line.replace(/:'(\w+)'/g, (_m, name: string) => {
      if (!(name in vars)) throw new Error(`Missing psql variable ${name}`);
      return client.escapeLiteral(vars[name]);
    });
  }).join('\n');
  client.on('notice', onNotice);
  try {
    const results = await client.query({ text: expanded, types: asText }) as unknown as pg.QueryResult[] | pg.QueryResult;
    return { results: Array.isArray(results) ? results : [results], notices };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.off('notice', onNotice); }
}

const jwt = (claims: Record<string, unknown>) => ['e30', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString('base64url'), 'sig'].join('.');
const claimsOf = (token: string) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return {}; } };

test('H-01 rehearsal: preflight, migrations, backfill, postflight, durable logout, every rollback and re-roll', { skip: !connection }, async () => {
  const url = new URL(connection!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This test only permits a disposable local PostgreSQL server');
  const admin = new pg.Client({ connectionString: connection, ssl: false });
  await admin.connect();
  for (const role of ['anon', 'authenticated', 'service_role']) await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  const database = `haven_qa_rehearsal_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.href, ssl: false });
  await client.connect();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-rehearsal-'));
  const instances: ReturnType<typeof createApp>[] = [];
  const sockets: Socket[] = [];
  try {
    // ---- Production-shaped starting point: 01–04 recorded by the CLI, legacy trigger live. ----
    await client.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), not_after timestamptz);
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text);`);
    const record = (file: string) => client.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1, $2)', [file.slice(0, 14), file.slice(15, -4)]);
    for (const file of preRollout) { await client.query(sqlFile(`migrations/${file}`)); await record(file); }

    const approved = [
      { id: '20000000-0000-4000-8000-000000000001', email: 'one@haven.example', meta: { username: 'river', display_name: 'River', avatar_url: 'https://cdn.example/r.png' }, created: '2026-10-10T10:00:00.123456Z' },
      { id: '20000000-0000-4000-8000-000000000002', email: 'two@haven.example', meta: { username: 'meadow' }, created: '2026-10-11T11:30:00.654321Z' },
    ];
    for (const account of approved) {
      await client.query('INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at) VALUES($1, $2, now(), $3, $4)', [account.id, account.email, account.meta, account.created]);
    }
    // Four Haven rows without Auth accounts: legacy local accounts (password hashes) with relationships
    // and only expired local sessions, matching the audited aggregates.
    for (const n of [3, 4, 5, 6]) await client.query("INSERT INTO haven.users(id, username, display_name, password, settings, created_at) VALUES($1, $2, $2, 'salt:00', '{}', 1)", [`legacy-${n}`, `legacy_${n}`]);
    await client.query(`
      INSERT INTO haven.sessions(token, user_id, expires_at) VALUES ('expired-local', 'legacy-3', 1);
      INSERT INTO haven.servers(id, name, owner_id, created_at) VALUES ('s1','One','legacy-3',1), ('s2','Two','legacy-4',1);
      INSERT INTO haven.members(server_id, user_id, role) VALUES ('s1','legacy-3','owner'), ('s2','legacy-4','owner'), ('s1','legacy-5','member');
      INSERT INTO haven.channels(id, server_id, name, type) VALUES ('c1','s1','general','text'), ('v1','s1','Lounge','voice');
      INSERT INTO haven.messages(id, channel_id, author_id, content, created_at) VALUES ('m1','c1','legacy-3','a',1), ('m2','c1','legacy-3','b',2), ('m3','c1','legacy-5','c',3), ('m4','c1','legacy-5','d',4);
      INSERT INTO haven.attachments(id, channel_id, uploader_id, message_id, name, mime, size, disk_name) VALUES
        ('a1','c1','legacy-3','m1','x','text/plain',1,'d1'), ('a2','c1','legacy-3','m2','y','text/plain',1,'d2'), ('a3','c1','legacy-5','m3','z','text/plain',1,'d3');`);
    const snapshot = async () => (await client.query('SELECT id, to_jsonb(u)::text AS row FROM haven.users u ORDER BY id')).rows as { id: string; row: string }[];
    const original = await snapshot();
    assert.equal(original.length, 6);

    // ---- Backend with a stub provider: getUser trusts any unexpired token of a known user. ----
    const users = new Map<string, { id: string; email: string }>(approved.map(a => [a.id, { id: a.id, email: a.email }]));
    const verifier = () => {
      const instance = new SupabaseAuthVerifier('https://example.supabase.co', 'service-role-key');
      (instance as any).client = { auth: {
        getUser: async (token: string) => {
          const account = users.get(claimsOf(token).sub);
          return account ? { data: { user: { ...account, email_confirmed_at: new Date().toISOString() } }, error: null } : { data: { user: null }, error: { status: 403, name: 'AuthApiError' } };
        },
        admin: { signOut: async (token: string, scope: string) => {
          // GoTrue /logout: 'local' deletes the token's own session, 'global' every session of the user.
          if (scope === 'local') await client.query('DELETE FROM auth.sessions WHERE id = $1', [claimsOf(token).session_id]);
          else if (scope === 'global') await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [claimsOf(token).sub]);
          else throw new Error(`unexpected scope ${scope}`);
          return { data: null, error: null };
        } },
      } };
      return instance;
    };
    const start = async () => {
      const authVerifier = verifier();
      const instance = createApp({ db: new PostgresAdapter({ connectionString: url.href, ssl: false }), dataDir: directory, supabaseVerifier: authVerifier, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon' });
      await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
      instances.push(instance);
      const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
      const call = async (route: string, token?: string, init: { method?: string; json?: unknown } = {}) => {
        const response = await fetch(`${base}/api${route}`, { method: init.method ?? 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.json ? { 'Content-Type': 'application/json' } : {}) }, body: init.json ? JSON.stringify(init.json) : undefined });
        return { status: response.status, data: await response.json() as any };
      };
      return { instance, base, call, verifier: authVerifier };
    };
    const signIn = async (userId: string) => {
      const sessionId = randomUUID();
      await client.query('INSERT INTO auth.sessions(id, user_id) VALUES ($1, $2)', [sessionId, userId]);
      return jwt({ sub: userId, session_id: sessionId });
    };

    // A backend deployed too early: legacy rows get a non-mutating 503; durable logout is not yet available.
    const early = await start();
    assert.equal((await early.call('/bootstrap', await signIn(approved[0].id))).status, 503);
    assert.deepEqual((await early.call('/ready')).data, { ok: true, version: '0.4.1', database: 'ok', sessionRevocation: 'unavailable' });
    assert.deepEqual(await snapshot(), original);
    await early.instance.close(); instances.length = 0;

    // ---- Step 1: read-only preflight (aggregates + rollback capture). ----
    const preflight = await psql(client, sqlFile('manual/rollout-preflight-readonly.sql'));
    const rows = (marker: string) => preflight.results.find(result => result.fields?.some(field => field.name === marker))!.rows;
    assert.match(preflight.notices.join('\n'), /migration_history: 20261016000001,20261016000002,20261016000003,20261016000004$/m);
    assert.deepEqual(rows('can_read_auth_sessions')[0], { can_read_auth_sessions: true, auth_sessions_shape_ok: true, session_check_installed: false });
    const triggerBefore = rows('definition_md5')[0];
    assert.equal(triggerBefore.already_trusted_onboarding, false);
    assert.equal(triggerBefore.function_owner, 'postgres');
    const profileCounts = rows('haven_users')[0];
    assert.deepEqual(Object.fromEntries(Object.entries(profileCounts).map(([key, value]) => [key, Number(value)])), {
      haven_users: 6, boolean_completion: 0, complete: 0, incomplete: 0, missing_completion: 6, malformed_completion: 0,
      auth_linked_verified: 2, auth_linked_unverified: 0, without_auth_account: 4, with_local_password: 4,
    });
    assert.deepEqual(Object.values(rows('local_sessions')[0]).map(Number), [1, 0, 2, 0]);
    const relationships = rows('servers')[0];
    const localOnly = rows('local_only_rows_sha256')[0];
    assert.equal(Number(localOnly.local_only_rows), 4);
    assert.equal(rows('duplicate_usernames')[0].legacy_modify_policies, '0');
    const capture = path.join(directory, 'captured-handle_new_auth_user.sql');
    fs.writeFileSync(capture, rows('rollback_capture_definition')[0].rollback_capture_definition);

    // ---- Step 2: reviewed candidate inputs (exact microsecond timestamps). ----
    const candidates = (await psql(client, sqlFile('manual/legacy-profile-preflight.sql'))).results.find(result => result.command === 'SELECT')!.rows;
    assert.deepEqual(candidates.map(row => row.candidate_id), approved.map(a => a.id));
    const inputs = {
      approved_id_1: approved[0].id, approved_auth_created_at_1: candidates[0].auth_created_at, approved_profile_sha256_1: candidates[0].profile_sha256,
      approved_id_2: approved[1].id, approved_auth_created_at_2: candidates[1].auth_created_at, approved_profile_sha256_2: candidates[1].profile_sha256,
    };

    // ---- Steps 4–5: trigger migration, session-check migration (each recorded), approved backfill. ----
    await psql(client, sqlFile(`migrations/${TRIGGER_MIGRATION}`)); await record(TRIGGER_MIGRATION);
    await psql(client, sqlFile(`migrations/${SESSION_MIGRATION}`)); await record(SESSION_MIGRATION);
    assert.deepEqual(await snapshot(), original, 'schema migrations change no rows');
    await psql(client, sqlFile('manual/approved-legacy-profile-backfill.sql'), inputs);

    // ---- Step 6: postflight assertions. ----
    const postflightVars = { approved_id_1: approved[0].id, approved_id_2: approved[1].id, expected_missing_completion: '4', expected_local_only_sha256: localOnly.local_only_rows_sha256 };
    const postflight = await psql(client, sqlFile('manual/rollout-postflight-readonly.sql'), postflightVars);
    assert.ok(postflight.notices.includes('postflight: OK'));
    assert.deepEqual(postflight.results.at(-2)!.rows[0], relationships, 'relationship counts unchanged');
    await assert.rejects(psql(client, sqlFile('manual/rollout-postflight-readonly.sql'), { ...postflightVars, expected_missing_completion: '3' }), /unexpected number of rows/);
    await assert.rejects(psql(client, sqlFile('manual/rollout-postflight-readonly.sql'), { ...postflightVars, approved_id_2: '20000000-0000-4000-8000-0000000000aa' }), /not both complete/);
    await assert.rejects(psql(client, sqlFile('manual/rollout-postflight-readonly.sql'), { ...postflightVars, expected_local_only_sha256: '0'.repeat(64) }), /local-only rows changed/);

    // ---- Step 7: deploy smoke on two instances (a replica, or the same service after a restart). ----
    const a = await start(); const b = await start();
    assert.equal((await a.call('/ready')).data.sessionRevocation, 'enforced');
    const riverToken = await signIn(approved[0].id);
    const river = await a.call('/bootstrap', riverToken);
    assert.equal(river.status, 200); assert.equal(river.data.user.username, 'river'); assert.equal(river.data.user.settings.profileCompleted, true);
    assert.equal((await a.call('/auth/login', undefined, { method: 'POST', json: { username: 'legacy_3', password: 'irrelevant1' } })).status, 403, 'legacy local accounts cannot sign in in Hosted Mode');
    const newcomerId = '20000000-0000-4000-8000-0000000000ff';
    await client.query("INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES ($1, 'new@haven.example', now(), '{\"username\":\"river\",\"profileCompleted\":true}')", [newcomerId]);
    users.set(newcomerId, { id: newcomerId, email: 'new@haven.example' });
    const newcomer = await a.call('/bootstrap', await signIn(newcomerId));
    assert.equal(newcomer.data.user.settings.profileCompleted, false); assert.match(newcomer.data.user.username, /^user_[a-f0-9]{10}$/);

    // Durable logout: instance A logs out this device; instance B (never saw the logout) rejects the same token,
    // while the account's other device stays signed in until the explicit all-devices action.
    const meadowToken = await signIn(approved[1].id);
    const otherDevice = await signIn(approved[1].id);
    assert.equal((await b.call('/auth/me', meadowToken)).status, 200);
    const socket = io(b.base, { auth: { token: otherDevice }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const logout = await a.call('/auth/logout', meadowToken, { method: 'POST' });
    assert.deepEqual(logout.data, { ok: true, providerSignedOut: true, scope: 'local' });
    // Make B's socket due for its periodic recheck (every two minutes, longer than the 30 s provider cache).
    const recheckDue = () => { b.instance.io.sockets.sockets.get(socket.id!)!.data.verifiedAt = 0; (b.verifier as any).tokenCache.clear(); };
    recheckDue();
    // B's 30 s provider cache still holds meadowToken; a restarted instance has no cache at all.
    const restarted = await start();
    assert.equal((await restarted.call('/auth/me', meadowToken)).status, 401, 'durable: rejected after restart');
    assert.equal((await restarted.call('/auth/me', otherDevice)).status, 200, 'local: the other device stays signed in');
    await b.instance.runMaintenance();
    assert.equal(socket.connected, true, "local: the other device's socket survives the recheck");
    // Explicit all-devices logout, from the other device on a third instance, ends every session durably.
    const laterDevice = await signIn(approved[1].id);
    const everywhere = await restarted.call('/auth/logout', otherDevice, { method: 'POST', json: { scope: 'global' } });
    assert.deepEqual(everywhere.data, { ok: true, providerSignedOut: true, scope: 'global' });
    recheckDue();
    const ended = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('socket not disconnected')), 5000); socket.once('disconnect', () => { clearTimeout(timer); resolve(); }); });
    await b.instance.runMaintenance();
    await ended;
    assert.equal((await (await start()).call('/auth/me', laterDevice)).status, 401, 'global: other devices of the account too');
    assert.equal((await restarted.call('/auth/me', riverToken)).status, 200, 'other accounts unaffected');
    // A client-side sign-out that never reached Haven is also enforced once the session row is gone.
    const quiet = await signIn(approved[0].id);
    assert.equal((await restarted.call('/auth/me', quiet)).status, 200);
    await client.query('DELETE FROM auth.sessions WHERE id = $1', [claimsOf(quiet).session_id]);
    const freshInstance = await start();
    assert.equal((await freshInstance.call('/auth/me', quiet)).status, 401);

    // ---- Rollback rehearsal (each is a separately approved action), newest change first. ----
    // R1: remove the session check; running backends fall back without failing requests.
    await psql(client, sqlFile('manual/rollback-auth-session-check.sql'));
    await client.query('DELETE FROM supabase_migrations.schema_migrations WHERE version = $1', [SESSION_MIGRATION.slice(0, 14)]);
    const stillLive = await signIn(approved[0].id);
    assert.equal((await freshInstance.call('/auth/me', stillLive)).status, 200);
    assert.equal((await freshInstance.call('/ready')).data.sessionRevocation, 'unavailable');

    // R2: backfill undo refuses a row edited after approval, then restores both rows exactly.
    const rollbackVars = { approved_id_1: approved[0].id, approved_profile_sha256_1: inputs.approved_profile_sha256_1, approved_id_2: approved[1].id, approved_profile_sha256_2: inputs.approved_profile_sha256_2 };
    await client.query("UPDATE haven.users SET bio = 'edited after go-live' WHERE id = $1", [approved[0].id]);
    await assert.rejects(psql(client, sqlFile('manual/rollback-approved-legacy-profile-backfill.sql'), rollbackVars), /changed since approval/);
    await client.query("UPDATE haven.users SET bio = '' WHERE id = $1", [approved[0].id]);
    await psql(client, sqlFile('manual/rollback-approved-legacy-profile-backfill.sql'), rollbackVars);
    const afterUndo = await snapshot();
    for (const row of original) assert.equal(afterUndo.find(item => item.id === row.id)!.row, row.row, `${row.id} restored byte-for-byte`);
    assert.equal((await freshInstance.call('/bootstrap', stillLive)).status, 503, 'undone accounts return to review-required');

    // R3: trigger restore refuses a wrong capture checksum, then restores the exact captured function.
    await assert.rejects(psql(client, sqlFile('manual/rollback-auth-trigger-function.sql'), { capture_file: capture, expected_definition_md5: '0'.repeat(32) }), /differs from the preflight capture/);
    assert.match((await client.query("SELECT prosrc FROM pg_proc WHERE oid = 'haven.handle_new_auth_user()'::regprocedure")).rows[0].prosrc, /"profileCompleted":false/);
    await psql(client, sqlFile('manual/rollback-auth-trigger-function.sql'), { capture_file: capture, expected_definition_md5: triggerBefore.definition_md5 });
    await client.query('DELETE FROM supabase_migrations.schema_migrations WHERE version = $1', [TRIGGER_MIGRATION.slice(0, 14)]);
    const restoredTrigger = (await psql(client, sqlFile('manual/rollout-preflight-readonly.sql'))).results.find(result => result.fields?.some(field => field.name === 'definition_md5'))!.rows[0];
    assert.deepEqual(restoredTrigger, triggerBefore, 'definition, owner, ACL and trigger identity match the capture');

    // ---- Recovery: the same reviewed forward steps re-apply cleanly after a rollback. ----
    await psql(client, sqlFile(`migrations/${TRIGGER_MIGRATION}`)); await record(TRIGGER_MIGRATION);
    await psql(client, sqlFile(`migrations/${SESSION_MIGRATION}`)); await record(SESSION_MIGRATION);
    await psql(client, sqlFile('manual/approved-legacy-profile-backfill.sql'), inputs);
    await psql(client, sqlFile('manual/approved-legacy-profile-backfill.sql'), inputs); // idempotent
    assert.ok((await psql(client, sqlFile('manual/rollout-postflight-readonly.sql'), { ...postflightVars, expected_missing_completion: '4' })).notices.includes('postflight: OK'));
  } finally {
    sockets.forEach(socket => socket.disconnect());
    for (const instance of instances) await instance.close().catch(() => {});
    await client.end();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
