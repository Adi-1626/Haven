import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';
import { LocalStorageService, SupabaseStorageService } from './storage/index.js';
import { PostgresAdapter } from './db/postgres.js';
import { SqliteAdapter } from './db/sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('SupabaseAuthVerifier caches verified tokens and syncs users into DatabaseAdapter', async () => {
  const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
  
  // Inject mock verification for deterministic unit testing
  const mockPayload = {
    id: 'user-supabase-123',
    email: 'test@haven.example',
  };

  (verifier as any).client = {
    auth: {
      getUser: async (token: string) => {
        if (token === 'valid-test-token') {
          return {
            data: {
              user: {
                id: mockPayload.id,
                email: mockPayload.email,
                email_confirmed_at: new Date().toISOString(),
                user_metadata: { username: 'haven_user', display_name: 'Haven Tester', profileCompleted: true },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: new Error('Invalid or expired token') };
      },
    },
  };

  (verifier as any).tokenCache.set('valid-test-token', {
    user: mockPayload,
    expiresAt: Date.now() + 60_000,
  });

  const verified = await verifier.verifyAccessToken('valid-test-token');
  assert.ok(verified);
  assert.equal(verified.id, 'user-supabase-123');
  assert.equal(verified.email, 'test@haven.example');
  assert.deepEqual(verified, { id: mockPayload.id, email: mockPayload.email });

  // Test expired token cache invalidation
  (verifier as any).tokenCache.set('expired-token', {
    user: mockPayload,
    expiresAt: Date.now() - 1000,
  });
  // Since network call to example.supabase.co will fail, verify it returns null on network/auth failure
  const expired = await verifier.verifyAccessToken('expired-token');
  assert.equal(expired, null);

  // Test ensureHavenUser with SqliteAdapter
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-sb-test-'));
  try {
    const db = new SqliteAdapter(path.join(tmpDir, 'test.sqlite'));
    await verifier.ensureHavenUser(db, verified);

    const user = await db.getUser(verified.id);
    assert.ok(user);
    assert.equal(user.id, verified.id);
    assert.match(user.username, /^user_[a-f0-9]{10}$/);
    assert.equal(user.displayName, user.username);
    assert.equal(JSON.parse(user.settings).profileCompleted, false);
    assert.equal(user.avatar, '');

    // Calling again does not overwrite existing profile if already present
    await db.updateUser(verified.id, { displayName: 'Custom Name' });
    await verifier.ensureHavenUser(db, verified);
    const updated = await db.getUser(verified.id);
    assert.equal(updated?.displayName, 'Custom Name');

    db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StorageService handles local file operations and download URL resolution', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-storage-test-'));
  try {
    const storage = new LocalStorageService(tmpDir);
    assert.equal(storage.isSupabase, false);

    const buffer = Buffer.from('hello haven storage');
    await storage.upload('attachments', 'test-file.txt', buffer);

    const info = await storage.getDownloadInfo('attachments', 'test-file.txt', 'download.txt');
    assert.equal(info.type, 'local');
    assert.ok(info.filePath);
    assert.ok(fs.existsSync(info.filePath));

    await storage.remove('attachments', 'test-file.txt');
    assert.equal(fs.existsSync(info.filePath), false);

    // Verify SupabaseStorageService initialization
    const sbStorage = new SupabaseStorageService('https://example.supabase.co', 'service-role-key');
    assert.equal(sbStorage.isSupabase, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createApp exposes hosted mode Supabase config and dual auth headers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-app-test-'));
  const mockPostgresDb = Object.assign(new SqliteAdapter(path.join(tmpDir, 'test.sqlite')), { isPostgres: true });
  const appInstance = createApp({
    dataDir: tmpDir,
    db: mockPostgresDb,
    supabaseUrl: 'https://tswmpzeckmquvrlzvtsy.supabase.co',
    supabaseAnonKey: 'mock-anon-key',
    supabaseServiceKey: 'mock-service-key',
  });

  const server = appInstance.httpServer.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const configRes = await fetch(`${base}/api/config`);
    const config = await configRes.json();
    assert.equal(config.mode, 'hosted');
    assert.equal(config.supabaseUrl, 'https://tswmpzeckmquvrlzvtsy.supabase.co');
    assert.equal(config.supabaseAnonKey, 'mock-anon-key');

    // Verify unauthenticated request to protected endpoint returns 401
    const unauthRes = await fetch(`${base}/api/bootstrap`);
    assert.equal(unauthRes.status, 401);
  } finally {
    await appInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createApp with SqliteAdapter never exposes hosted mode config even if supabaseUrl is set', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-app-test-sqlite-'));
  const appInstance = createApp({
    dataDir: tmpDir,
    supabaseUrl: 'https://tswmpzeckmquvrlzvtsy.supabase.co',
    supabaseAnonKey: 'mock-anon-key',
  });

  const server = appInstance.httpServer.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const configRes = await fetch(`${base}/api/config`);
    const config = await configRes.json();
    assert.equal(config.mode, 'local');
    assert.equal(config.supabaseUrl, undefined);
    assert.equal(config.supabaseAnonKey, undefined);
  } finally {
    await appInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createStorage throws in hosted mode if Supabase credentials are missing', async () => {
  const prevMode = process.env.HAVEN_MODE;
  process.env.HAVEN_MODE = 'hosted';
  try {
    const { createStorage } = await import('./storage/index.js');
    assert.throws(() => {
      createStorage({});
    }, /FATAL: Hosted mode requires valid Supabase Storage configuration/);
  } finally {
    if (prevMode !== undefined) process.env.HAVEN_MODE = prevMode;
    else delete process.env.HAVEN_MODE;
  }
});

test('SupabaseAuthVerifier rejects unconfirmed email addresses and HTTP/Socket.IO enforce 403', async () => {
  const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');

  // Inject a mock getUser implementation for testing unconfirmed email accounts
  (verifier as any).client = {
    auth: {
      getUser: async (token: string) => {
        if (token === 'unconfirmed-user-token') {
          return {
            data: {
              user: {
                id: 'unconfirmed-user-id',
                email: 'unconfirmed@haven.example',
                email_confirmed_at: null,
                user_metadata: { username: 'unconfirmed_user' },
              },
            },
            error: null,
          };
        }
        if (token === 'confirmed-user-token') {
          return {
            data: {
              user: {
                id: 'confirmed-user-id',
                email: 'confirmed@haven.example',
                email_confirmed_at: new Date().toISOString(),
                user_metadata: { username: 'confirmed_user' },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: new Error('Invalid token') };
      },
    },
  };

  // 1. Direct verifier check
  const unconfirmedResult = await verifier.verifyAccessTokenWithDetails('unconfirmed-user-token');
  assert.equal(unconfirmedResult.unconfirmedEmail, true);
  assert.equal(unconfirmedResult.user, undefined);
  const unconfirmedUser = await verifier.verifyAccessToken('unconfirmed-user-token');
  assert.equal(unconfirmedUser, null);

  const confirmedResult = await verifier.verifyAccessTokenWithDetails('confirmed-user-token');
  assert.equal(confirmedResult.unconfirmedEmail, undefined);
  assert.ok(confirmedResult.user);
  assert.equal(confirmedResult.user.id, 'confirmed-user-id');

  // 2. HTTP API check: verify unconfirmed email returns 403
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-auth-boundary-'));
  const appInstance = createApp({
    dataDir: tmpDir,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'dummy-anon',
    supabaseServiceKey: 'dummy-service',
    supabaseVerifier: verifier,
  });

  const server = appInstance.httpServer.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Attempt request with unconfirmed user token
    const res = await fetch(`${base}/api/bootstrap`, {
      headers: { Authorization: 'Bearer unconfirmed-user-token' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /Email address must be verified/);
  } finally {
    await appInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Hosted mode fail-fast prevents silent fallback to SQLite', async () => {
  const originalMode = process.env.HAVEN_MODE;
  const originalDbUrl = process.env.DATABASE_URL;
  const originalSbDbUrl = process.env.SUPABASE_DATABASE_URL;

  try {
    process.env.HAVEN_MODE = 'hosted';
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DATABASE_URL;

    const { createDatabase } = await import('./db/index.js');
    assert.throws(
      () => createDatabase({}),
      /FATAL: Hosted mode requires a valid PostgreSQL connection URL/
    );
  } finally {
    if (originalMode !== undefined) process.env.HAVEN_MODE = originalMode;
    else delete process.env.HAVEN_MODE;
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    if (originalSbDbUrl !== undefined) process.env.SUPABASE_DATABASE_URL = originalSbDbUrl;
  }
});

test('explicit Local Mode refuses Hosted database and Supabase settings instead of switching databases', () => {
  const entry = fileURLToPath(new URL('./index.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', entry], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HAVEN_MODE: 'local', DATA_DIR: os.tmpdir(), PORT: '0', DATABASE_URL: 'postgresql://haven@example.invalid/haven', SUPABASE_URL: 'https://example.supabase.co' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Local Mode uses only its own SQLite data, but Hosted settings are present: DATABASE_URL, SUPABASE_URL/);
});

test('Authorization boundaries enforce cross-user, cross-server, DM, and blocked-user isolation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-boundary-test-'));
  const appInstance = createApp({ dataDir: tmpDir });
  const server = appInstance.httpServer.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  const registerUser = async (username: string) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'password123', displayName: username }),
    });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    const data = await res.json();
    return { cookie, user: data.user };
  };

  try {
    const userA = await registerUser('alice_bound');
    const userB = await registerUser('bob_bound');

    // 1. Cross-server isolation: Alice creates server
    const serverRes = await fetch(`${base}/api/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie! },
      body: JSON.stringify({ name: "Alice's Castle" }),
    });
    const serverData = await serverRes.json();
    const serverId = serverData.server.id;

    // Bob attempts to fetch Alice's server members without membership -> 403
    const bobMemberRes = await fetch(`${base}/api/servers/${serverId}/members`, {
      headers: { Cookie: userB.cookie! },
    });
    assert.equal(bobMemberRes.status, 403);

    // 2. Block boundary: Alice blocks Bob
    const blockRes = await fetch(`${base}/api/users/${userB.user.id}/block`, {
      method: 'POST',
      headers: { Cookie: userA.cookie! },
    });
    assert.equal(blockRes.status, 200);

    // Bob tries to send Alice a friend request -> 403
    const friendReqRes = await fetch(`${base}/api/friends/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userB.cookie! },
      body: JSON.stringify({ username: 'alice_bound' }),
    });
    assert.equal(friendReqRes.status, 403);

    // Bob tries to DM Alice -> 403
    const dmRes = await fetch(`${base}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userB.cookie! },
      body: JSON.stringify({ memberIds: [userA.user.id] }),
    });
    assert.equal(dmRes.status, 403);

    // 3. Moderator boundary: Bob tries to delete Alice's server -> 403
    const deleteServerRes = await fetch(`${base}/api/servers/${serverId}`, {
      method: 'DELETE',
      headers: { Cookie: userB.cookie! },
    });
    assert.equal(deleteServerRes.status, 403);
  } finally {
    await appInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SupabaseAuthVerifier ignores editable identity metadata and allows invalidation', async () => {
  const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
  
  (verifier as any).client = {
    auth: {
      getUser: async (token: string) => {
        if (token === 'camel-case-token') {
          return {
            data: {
              user: {
                id: 'user-camel-1',
                email: 'camel@haven.example',
                email_confirmed_at: new Date().toISOString(),
                user_metadata: { username: 'camel_pilot', displayName: 'Pilot Camel' },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: new Error('Invalid token') };
      },
    },
  };

  const user = await verifier.verifyAccessToken('camel-case-token');
  assert.ok(user);
  assert.deepEqual(user, { id: 'user-camel-1', email: 'camel@haven.example' });

  // Verify caching and invalidation
  verifier.invalidateToken('camel-case-token');
  assert.equal((verifier as any).tokenCache.has('camel-case-token'), false);
});

