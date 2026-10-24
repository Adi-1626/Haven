import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createApp } from './app.js';
import { PostgresAdapter } from './db/postgres.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';

// Executes the repository's actual migration files and prepared manual rollout SQL on a disposable
// PostgreSQL server. Supabase's auth/storage schemas and roles are replaced by minimal stubs, and
// psql variable interpolation is emulated; this is a rehearsal, not Supabase CLI/staging certification.
const connection = process.env.HAVEN_TEST_POSTGRES_URL;
const repository = new URL('../../../supabase/', import.meta.url);
const migrations = fs.readdirSync(new URL('migrations/', repository)).filter(name => name.endsWith('.sql')).sort();
const readSql = (file: string) => fs.readFileSync(new URL(file, repository), 'utf8');

async function disposableDatabase(prefix: string) {
  const url = new URL(connection!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This test only permits a disposable local PostgreSQL server');
  const admin = new pg.Client({ connectionString: connection, ssl: false });
  await admin.connect();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }
  const database = `${prefix}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.href, ssl: false });
  await client.connect();
  await client.query(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), not_after timestamptz);
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`);
  const apply = async (file: string) => { await client.query(readSql(file)); };
  const close = async () => { await client.end(); await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); await admin.end(); };
  return { client, url: url.href, apply, close };
}

/** psql `:'name'` interpolation, quoted exactly as psql would quote a literal. Missing names fail. */
function psqlVariables(client: pg.Client, sql: string, values: Record<string, string>) {
  return sql.replace(/:'(\w+)'/g, (_match, name: string) => {
    if (!(name in values)) throw new Error(`Missing psql variable ${name}`);
    return client.escapeLiteral(values[name]);
  });
}

/** Runs the prepared manual backfill as `psql -X --set=ON_ERROR_STOP=on` would: one script, abort on error. */
async function backfillWith(client: pg.Client, values: Record<string, string>) {
  try { await client.query(psqlVariables(client, readSql('manual/approved-legacy-profile-backfill.sql'), values)); }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}

test('the repository migration chain replays cleanly to the hardened production-equivalent state (B-03)', { skip: !connection }, async () => {
  const context = await disposableDatabase('haven_qa_migrations');
  try {
    for (const file of migrations) await context.apply(`migrations/${file}`);
    const { client } = context;
    const policies = (await client.query("SELECT schemaname, policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname IN ('haven','storage')")).rows;
    assert.equal(policies.filter(row => row.policyname.endsWith('_modify')).length, 0);
    assert.deepEqual(policies.filter(row => row.schemaname === 'storage').map(row => row.roles), Array(4).fill(['service_role']));
    const role = (await client.query("SELECT rolcanlogin, rolinherit, rolbypassrls FROM pg_roles WHERE rolname = 'haven_app'")).rows[0];
    assert.deepEqual(role, { rolcanlogin: true, rolinherit: false, rolbypassrls: true });
    const access = (await client.query(`SELECT
      has_schema_privilege('anon', 'haven', 'USAGE') AS anon_usage, has_schema_privilege('authenticated', 'haven', 'USAGE') AS auth_usage,
      has_table_privilege('authenticated', 'haven.users', 'SELECT') AS auth_select, has_table_privilege('haven_app', 'haven.messages', 'INSERT') AS app_insert,
      has_function_privilege('authenticated', 'haven.handle_new_auth_user()', 'EXECUTE') AS auth_trigger_exec`)).rows[0];
    assert.deepEqual(access, { anon_usage: false, auth_usage: false, auth_select: false, app_insert: true, auth_trigger_exec: false });
    // Re-applying the onboarding trigger migration is idempotent.
    await context.apply('migrations/20261018145338_trusted_profile_onboarding.sql');
    await client.query("INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-4000-8000-0000000000aa', 'fresh@haven.example', '{\"username\":\"admin\",\"avatar_url\":\"https://evil.example/a.png\"}')");
    const fresh = (await client.query("SELECT username, display_name, avatar, settings FROM haven.users WHERE id = '00000000-0000-4000-8000-0000000000aa'")).rows[0];
    assert.match(fresh.username, /^user_[a-f0-9]{10}$/);
    assert.equal(fresh.display_name, fresh.username);
    assert.equal(fresh.avatar, '');
    assert.deepEqual(fresh.settings, { profileCompleted: false });
  } finally { await context.close(); }
});

test('rehearsal: hosted profile rollout on a synthetic copy of the six-row production topology (H-01)', { skip: !connection }, async () => {
  const context = await disposableDatabase('haven_qa_rollout');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-rollout-'));
  let instance: ReturnType<typeof createApp> | undefined;
  try {
    const { client } = context;
    // Production-equivalent pre-rollout state: 01–04 applied, legacy (metadata-copying) trigger live.
    for (const file of migrations.filter(name => name < '20261018')) await context.apply(`migrations/${file}`);
    const approved = [
      { id: '10000000-0000-4000-8000-000000000001', email: 'one@haven.example', meta: { username: 'river', display_name: 'River' }, created: '2026-10-10T10:00:00.123456Z' },
      { id: '10000000-0000-4000-8000-000000000002', email: 'two@haven.example', meta: { username: 'meadow' }, created: '2026-10-11T11:30:00.654321Z' },
    ];
    for (const account of approved) {
      await client.query('INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at) VALUES($1, $2, now(), $3, $4)', [account.id, account.email, account.meta, account.created]);
    }
    // Four Haven rows with no Auth account, plus their relationships (2 servers, 3 memberships, 4 messages, 3 attachments).
    for (const n of [3, 4, 5, 6]) await client.query("INSERT INTO haven.users(id, username, display_name, settings, created_at) VALUES($1, $2, $2, '{}', 1)", [`unmatched-${n}`, `legacy_${n}`]);
    await client.query(`
      INSERT INTO haven.servers(id, name, owner_id, created_at) VALUES ('s1','One','unmatched-3',1), ('s2','Two','unmatched-4',1);
      INSERT INTO haven.members(server_id, user_id, role) VALUES ('s1','unmatched-3','owner'), ('s2','unmatched-4','owner'), ('s1','unmatched-5','member');
      INSERT INTO haven.channels(id, server_id, name, type) VALUES ('c1','s1','general','text');
      INSERT INTO haven.messages(id, channel_id, author_id, content, created_at) VALUES ('m1','c1','unmatched-3','a',1), ('m2','c1','unmatched-3','b',2), ('m3','c1','unmatched-5','c',3), ('m4','c1','unmatched-5','d',4);
      INSERT INTO haven.attachments(id, channel_id, uploader_id, message_id, name, mime, size, disk_name) VALUES
        ('a1','c1','unmatched-3','m1','x','text/plain',1,'d1'), ('a2','c1','unmatched-3','m2','y','text/plain',1,'d2'), ('a3','c1','unmatched-5','m3','z','text/plain',1,'d3');`);
    const snapshot = async () => (await client.query('SELECT id, to_jsonb(u)::text AS row FROM haven.users u ORDER BY id')).rows;
    const counts = async () => (await client.query(`SELECT (SELECT count(*) FROM haven.servers) s, (SELECT count(*) FROM haven.members) m,
      (SELECT count(*) FROM haven.messages) msg, (SELECT count(*) FROM haven.attachments) a, (SELECT count(*) FROM haven.users) u`)).rows[0];
    const before = await snapshot();
    const relationships = await counts();
    assert.equal(before.length, 6);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM haven.users WHERE jsonb_typeof(settings->'profileCompleted') = 'boolean'")).rows[0].n, 0, 'matches production: no completion flags');

    // Current backend against that state: legacy accounts get a non-mutating 503 (the H-01 incompatibility).
    const accounts = new Map(approved.map(account => [`token-${account.id}`, account.id]));
    accounts.set('token-new', '10000000-0000-4000-8000-0000000000ff');
    const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
    (verifier as any).client = { auth: { getUser: async (token: string) => accounts.has(token)
      ? { data: { user: { id: accounts.get(token), email: 'x@haven.example', email_confirmed_at: new Date().toISOString() } }, error: null }
      : { data: { user: null }, error: { status: 403, name: 'AuthApiError' } } } };
    const db = new PostgresAdapter({ connectionString: context.url, ssl: false });
    instance = createApp({ db, dataDir: directory, supabaseVerifier: verifier, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-anon-key' });
    await new Promise<void>(resolve => instance!.httpServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
    const bootstrap = async (token: string) => { const response = await fetch(`${base}/api/bootstrap`, { headers: { Authorization: `Bearer ${token}` } }); return { status: response.status, data: await response.json() as any }; };
    assert.equal((await bootstrap(`token-${approved[0].id}`)).status, 503);
    assert.deepEqual(await snapshot(), before, 'the review-required path never mutates rows');

    // Step 4: the reviewed trigger migration in its own transaction.
    await context.apply('migrations/20261018145338_trusted_profile_onboarding.sql');
    assert.deepEqual(await snapshot(), before, 'the trigger migration changes no existing row');

    // Preflight (read-only) yields the review inputs; it lists only verified Auth-linked rows.
    // Timestamps are read as exact text, as psql prints them. A JS Date would truncate Auth's
    // microseconds and the backfill would (safely) refuse the mismatched creation time.
    const asText = { getTypeParser: (oid: number, format?: any) => oid === 1184 ? (value: string) => value : pg.types.getTypeParser(oid, format) };
    const preflight = await client.query({ text: readSql('manual/legacy-profile-preflight.sql'), types: asText }) as unknown as pg.QueryResult[];
    const candidates = preflight.find(result => result.command === 'SELECT')!.rows;
    assert.deepEqual(candidates.map(row => row.candidate_id), approved.map(account => account.id));
    const inputs = (overrides: Record<string, string> = {}) => ({
      approved_id_1: approved[0].id, approved_auth_created_at_1: candidates[0].auth_created_at, approved_profile_sha256_1: candidates[0].profile_sha256,
      approved_id_2: approved[1].id, approved_auth_created_at_2: candidates[1].auth_created_at, approved_profile_sha256_2: candidates[1].profile_sha256,
      ...overrides,
    });
    // Millisecond-truncated input is refused rather than matched loosely.
    await assert.rejects(backfillWith(client, inputs({ approved_auth_created_at_1: new Date(candidates[0].auth_created_at).toISOString() })), /exactly two/);
    const backfill = (values: Record<string, string>) => backfillWith(client, values);
    // Guardrails: each refusal leaves every row untouched.
    await assert.rejects(backfill(inputs({ approved_profile_sha256_1: 'f'.repeat(64) })), /snapshot\/state changed/);
    await assert.rejects(backfill(inputs({ approved_auth_created_at_2: '2026-10-11T11:30:00Z' })), /exactly two/);
    await assert.rejects(backfill(inputs({ approved_id_2: '10000000-0000-4000-8000-000000000003' })), /exactly two/);
    await assert.rejects(backfill(inputs({ approved_id_2: approved[0].id })), /duplicate key/);
    // A row carrying a Local Mode password is never a Hosted backfill candidate, even if Auth-linked.
    await client.query("UPDATE haven.users SET password = 'salt:00' WHERE id = $1", [approved[0].id]);
    await assert.rejects(backfill(inputs()), /exactly two/);
    await client.query("UPDATE haven.users SET password = '' WHERE id = $1", [approved[0].id]);
    assert.throws(() => psqlVariables(client, readSql('manual/approved-legacy-profile-backfill.sql'), { approved_id_1: approved[0].id }), /Missing psql variable/);
    assert.deepEqual(await snapshot(), before);

    // Step 5: approved backfill, then a re-run that must be a no-op.
    await backfill(inputs());
    const after = await snapshot();
    await backfill(inputs());
    assert.deepEqual(await snapshot(), after, 'second run is a no-op');
    for (const [index, row] of after.entries()) {
      const previous = JSON.parse(before[index].row); const current = JSON.parse(row.row);
      if (approved.some(account => account.id === row.id)) {
        assert.deepEqual(current, { ...previous, settings: { ...previous.settings, profileCompleted: true } }, 'only the completion key is added');
      } else {
        assert.equal(row.row, before[index].row, 'unmatched rows are byte-for-byte unchanged');
      }
    }
    assert.deepEqual(await counts(), relationships);

    // Step 7 smoke: approved accounts keep their identity and skip onboarding; new accounts stay incomplete.
    const river = await bootstrap(`token-${approved[0].id}`);
    assert.equal(river.status, 200);
    assert.equal(river.data.user.username, 'river');
    assert.equal(river.data.user.settings.profileCompleted, true);
    await client.query("INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES ('10000000-0000-4000-8000-0000000000ff', 'new@haven.example', now(), '{\"username\":\"river\",\"profileCompleted\":true}')");
    const newcomer = await bootstrap('token-new');
    assert.equal(newcomer.status, 200);
    assert.equal(newcomer.data.user.settings.profileCompleted, false);
    assert.match(newcomer.data.user.username, /^user_[a-f0-9]{10}$/);
    assert.equal((await fetch(`${base}/api/servers`, { method: 'POST', headers: { Authorization: 'Bearer token-new', 'Content-Type': 'application/json' }, body: '{"name":"x"}' })).status, 403);
  } finally {
    if (instance) await instance.close();
    await context.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
