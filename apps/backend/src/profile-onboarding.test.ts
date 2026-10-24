import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createApp } from './app.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';
import { SqliteAdapter } from './db/sqlite.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1cAAAAASUVORK5CYII=', 'base64');
const newId = 'a1b2c3d4-0000-4000-8000-000000000001';
const accounts: Record<string, { id: string; email: string; metadata: Record<string, string> }> = {
  'token-new': { id: newId, email: 'brand.new@haven.example', metadata: {} },
  'token-new-2': { id: 'b1b2c3d4-0000-4000-8000-000000000002', email: 'second.one@haven.example', metadata: {} },
  'token-legacy': { id: 'a1b2c3d4-0000-4000-8000-000000000003', email: 'legacy@haven.example', metadata: { username: 'legacy_name', displayName: 'Legacy Person' } },
};

// Real SupabaseAuthVerifier and ensureHavenUser; only the hosted token lookup is simulated.
function fakeVerifier() {
  const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
  (verifier as any).client = { auth: { getUser: async (token: string) => {
    const account = accounts[token.split('#')[0]];
    return account ? { data: { user: { id: account.id, email: account.email, email_confirmed_at: new Date().toISOString(), user_metadata: account.metadata } }, error: null } : { data: { user: null }, error: new Error('invalid') };
  } } };
  return verifier;
}

async function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-onboarding-'));
  const db = new SqliteAdapter(path.join(directory, 'test.sqlite'));
  // Represents an explicitly reviewed legacy backfill, never Auth metadata inference.
  const legacy = accounts['token-legacy'];
  await db.createUser({ id: legacy.id, username: 'legacy_name', displayName: 'Legacy Person', settings: '{"profileCompleted":true}', createdAt: Date.now() });
  const instance = createApp({ dataDir: directory, db, supabaseVerifier: fakeVerifier() });
  const server = instance.httpServer.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (token: string, route: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) };
    const response = await fetch(`${base}/api${route}`, { ...init, headers, body: init.json ? JSON.stringify(init.json) : init.body });
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const close = async () => { await instance.close(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); };
  return { db, call, close, base };
}

test('incomplete profiles cannot bypass onboarding through HTTP, preferences, metadata or Socket.IO', async () => {
  const { call, base, close } = await harness();
  try {
    for (const route of ['/users/username-available?username=free_name', '/users/me/profile', '/users/me/avatar', `/users/${newId}/avatar`]) {
      assert.equal((await call('invalid-token', route, route.includes('/me/') ? { method: 'POST', json: {} } : {})).status, 401);
    }
    assert.equal((await call('token-new', '/users/me', { method: 'PATCH', json: { settings: { profileCompleted: true } } })).status, 403);
    assert.equal((await call('token-new', '/servers', { method: 'POST', json: { name: 'Bypass' } })).status, 403);
    const bootstrap = (await call('token-new', '/bootstrap')).data;
    assert.deepEqual(bootstrap.servers, []);
    assert.deepEqual(bootstrap.channels, []);
    assert.deepEqual(bootstrap.users.map((user: { id: string }) => user.id), [newId]);
    // User-editable Auth metadata must not override the persisted incomplete flag.
    accounts['token-new'].metadata = { username: 'claimed_identity' };
    assert.equal((await call('token-new#metadata-change', '/bootstrap')).data.user.settings.profileCompleted, false);
    const socket = io(base, { auth: { token: 'token-new' }, transports: ['websocket'], reconnection: false, timeout: 2000 });
    try {
      const error = await new Promise<Error>((resolve, reject) => { socket.once('connect_error', resolve); socket.once('connect', () => reject(new Error('Incomplete account connected'))); });
      assert.match(error.message, /Complete your profile/);
    } finally { socket.disconnect(); }
    const completed = await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'finished_name', displayName: 'Finished' } });
    assert.equal(completed.status, 200);
    assert.equal((await call('token-new', '/users/me', { method: 'PATCH', json: { settings: { profileCompleted: false } } })).status, 400);
    assert.equal((await call('token-new', '/servers', { method: 'POST', json: { name: 'Allowed' } })).status, 201);
  } finally { accounts['token-new'].metadata = {}; await close(); }
});

test('concurrent completion is atomic and a taken username does not partially update the profile', async () => {
  const { call, db, close } = await harness();
  try {
    await call('token-new', '/bootstrap');
    await call('token-legacy', '/bootstrap');
    const before = await db.getUser(newId);
    assert.equal(await db.completeUserProfile(newId, 'LEGACY_NAME', 'Should not persist'), 'unavailable');
    assert.deepEqual(await db.getUser(newId), before);
    const results = await Promise.all(['first_choice', 'second_choice'].map(username => call('token-new', '/users/me/profile', { method: 'POST', json: { username, displayName: username } })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.find(result => result.status === 200)!.data.user;
    assert.equal((await call('token-new#fresh', '/bootstrap')).data.user.username, winner.username);
    await db.updateUser(newId, { avatar: '🙂' });
    await fakeVerifier().ensureHavenUser(db, { id: newId });
    assert.equal((await db.getUser(newId))?.username, winner.username);
    assert.equal(JSON.parse((await db.getUser(newId))!.settings).profileCompleted, true);
  } finally { await close(); }
});

test('two accounts racing for a case-insensitive username have exactly one winner', async () => {
  const { call, close } = await harness();
  try {
    const bootstraps = await Promise.all([call('token-new', '/bootstrap'), call('token-new#parallel', '/bootstrap'), call('token-new-2', '/bootstrap')]);
    assert.ok(bootstraps.every(result => result.status === 200), 'concurrent first use must be idempotent');
    for (const token of ['token-new', 'token-new-2']) assert.equal((await call(token, '/users/username-available?username=Race_Name')).data.available, true);
    const results = await Promise.all(['token-new', 'token-new-2'].map((token, index) => call(token, '/users/me/profile', { method: 'POST', json: { username: index ? 'RACE_NAME' : 'race_name', displayName: 'Winner' } })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const loser = results[0].status === 409 ? 'token-new' : 'token-new-2';
    assert.equal((await call(loser, '/bootstrap')).data.user.settings.profileCompleted, false);
  } finally { await close(); }
});

test('reviewed legacy identities survive missing Auth metadata and persisted completion survives restart', async () => {
  const { call, db, close } = await harness();
  try {
    await db.createUser({ id: newId, username: 'chosen_long_ago', displayName: 'Existing Person', settings: '{"profileCompleted":true}', createdAt: Date.now() });
    const legacy = await call('token-new', '/bootstrap');
    assert.equal(legacy.data.user.settings.profileCompleted, true);
    assert.equal(legacy.data.user.username, 'chosen_long_ago');
    assert.equal(legacy.data.user.displayName, 'Existing Person');
  } finally { await close(); }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-profile-restart-'));
  const filename = path.join(directory, 'test.sqlite');
  const first = new SqliteAdapter(filename);
  try {
    await fakeVerifier().ensureHavenUser(first, { id: newId });
    assert.equal(await first.completeUserProfile(newId, 'persistent_name', 'Persistent'), 'completed');
  } finally { first.close(); }
  const reopened = new SqliteAdapter(filename);
  try {
    await fakeVerifier().ensureHavenUser(reopened, { id: newId });
    const saved = await reopened.getUser(newId);
    assert.equal(saved?.username, 'persistent_name');
    assert.equal(JSON.parse(saved!.settings).profileCompleted, true);
  } finally { reopened.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('email-only hosted accounts start with a neutral placeholder and must complete their profile', async () => {
  const { call, close } = await harness();
  try {
    const first = await call('token-new', '/bootstrap');
    assert.equal(first.status, 200);
    assert.equal(first.data.user.settings.profileCompleted, false);
    assert.match(first.data.user.username, /^user_[a-f0-9]{10}$/);
    assert.ok(!JSON.stringify(first.data.user).includes('brand.new'), 'the email local part must not become a public identity');
    assert.equal(first.data.user.displayName, first.data.user.username);
  } finally { await close(); }
});

test('forged metadata before first sign-in cannot complete a new profile or classify an unreviewed legacy row', async () => {
  const { call, db, close } = await harness();
  try {
    accounts['token-new'].metadata = { username: 'forged_name', displayName: 'Forged', profileCompleted: 'true' };
    const fresh = await call('token-new', '/bootstrap');
    assert.equal(fresh.status, 200);
    assert.equal(fresh.data.user.settings.profileCompleted, false);
    assert.notEqual(fresh.data.user.username, 'forged_name');
    const other = accounts['token-new-2'];
    other.metadata = { username: 'legacy_looking', display_name: 'Legacy looking' };
    await db.createUser({ id: other.id, username: 'legacy_looking', displayName: 'Legacy looking', createdAt: Date.now() });
    const before = await db.getUser(other.id);
    assert.equal((await call('token-new-2', '/bootstrap')).status, 503);
    assert.deepEqual(await db.getUser(other.id), before);
  } finally { accounts['token-new'].metadata = {}; accounts['token-new-2'].metadata = {}; await close(); }
});

test('invalid completion state is never repaired by metadata or application traffic', async () => {
  const { db, call, close } = await harness();
  try {
    await db.createUser({ id: newId, username: 'existing_person', displayName: 'Existing', settings: '{"profileCompleted":"true"}', createdAt: Date.now() });
    const before = await db.getUser(newId);
    assert.equal((await call('token-new', '/bootstrap')).status, 503);
    assert.equal((await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'attempted_new', displayName: 'Attempt' } })).status, 503);
    assert.deepEqual(await db.getUser(newId), before);
  } finally { await close(); }
});

test('database errors cannot persist partial completion or admit an incomplete account', async () => {
  const { db, call, close } = await harness();
  const original = db.completeUserProfile.bind(db);
  try {
    await call('token-new', '/bootstrap');
    const before = await db.getUser(newId);
    db.completeUserProfile = async () => { throw new Error('Injected database failure'); };
    const failed = await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'failed_choice', displayName: 'Failed' } });
    assert.equal(failed.status, 500);
    assert.equal(failed.data.error, 'Internal server error');
    assert.deepEqual(await db.getUser(newId), before);
    assert.equal((await call('token-new', '/servers', { method: 'POST', json: { name: 'Bypass' } })).status, 403);
    db.completeUserProfile = original;
    assert.equal((await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'recovered_choice', displayName: 'Recovered' } })).status, 200);
  } finally { db.completeUserProfile = original; await close(); }
});

test('explicitly grandfathered legacy profiles keep their identity and skip onboarding', async () => {
  const { call, close } = await harness();
  try {
    const legacy = await call('token-legacy', '/bootstrap');
    assert.equal(legacy.data.user.username, 'legacy_name');
    assert.equal(legacy.data.user.displayName, 'Legacy Person');
    assert.equal(legacy.data.user.settings.profileCompleted, true);
    assert.equal((await call('token-legacy', '/users/me/profile', { method: 'POST', json: { username: 'another_name', displayName: 'X' } })).status, 409);
  } finally { await close(); }
});

test('unreviewed legacy rows fail closed without renaming, classifying or exposing application data', async () => {
  const { call, db, close } = await harness();
  try {
    await db.createUser({ id: newId, username: 'brand.new', displayName: 'brand.new', createdAt: Date.now() });
    const before = await db.getUser(newId);
    const boot = await call('token-new', '/bootstrap');
    assert.equal(boot.status, 503);
    assert.match(boot.data.error, /migration review/);
    assert.deepEqual(await db.getUser(newId), before);
  } finally { await close(); }
});

test('username availability reports format, reserved, taken and own names', async () => {
  const { call, close } = await harness();
  try {
    await call('token-legacy', '/bootstrap');
    const check = async (name: string) => (await call('token-new', `/users/username-available?username=${encodeURIComponent(name)}`)).data;
    assert.deepEqual(await check('ab'), { available: false, reason: 'Use at least 3 characters' });
    assert.equal((await check('bad name!')).available, false);
    assert.equal((await check('Admin')).reason, 'That username is reserved');
    assert.equal((await check('LEGACY_NAME')).reason, 'That username is already taken');
    assert.deepEqual(await check('@fresh.name'), { available: true });
    const own = await call('token-legacy', '/users/username-available?username=legacy_name');
    assert.equal(own.data.available, true);
  } finally { await close(); }
});

test('completing the profile validates, rejects races, persists across sessions and cannot be repeated', async () => {
  const { call, close } = await harness();
  try {
    await call('token-legacy', '/bootstrap');
    await call('token-new', '/bootstrap');
    assert.equal((await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'no', displayName: 'Fine' } })).status, 400);
    assert.equal((await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'valid_name', displayName: '   ' } })).status, 400);
    const taken = await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'Legacy_Name', displayName: 'Fine' } });
    assert.equal(taken.status, 409);
    assert.equal((await call('token-new', '/bootstrap')).data.user.settings.profileCompleted, false, 'a failed attempt must not complete the profile');
    const done = await call('token-new', '/users/me/profile', { method: 'POST', json: { username: '@Orbit.Fan', displayName: '  Orbit Fan  ' } });
    assert.equal(done.status, 200);
    assert.equal(done.data.user.username, 'Orbit.Fan');
    assert.equal(done.data.user.displayName, 'Orbit Fan');
    // A new session (different token for the same account) sees the persisted result.
    const again = await call('token-new#session-2', '/bootstrap');
    assert.equal(again.data.user.username, 'Orbit.Fan');
    assert.equal(again.data.user.settings.profileCompleted, true);
    assert.equal((await call('token-new', '/users/me/profile', { method: 'POST', json: { username: 'second_try', displayName: 'Nope' } })).status, 409);
    assert.equal((await call('token-new-2', '/users/username-available?username=orbit.fan')).data.available, false);
  } finally { await close(); }
});

test('profile pictures are validated, stored privately, served to signed-in users and replaced cleanly', async () => {
  const { call, close } = await harness();
  try {
    await call('token-new', '/bootstrap');
    await call('token-legacy', '/bootstrap');
    const upload = (bytes: Buffer, type = 'image/png') => { const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type }), 'avatar.png'); return call('token-new', '/users/me/avatar', { method: 'POST', body: form }); };
    assert.equal((await upload(Buffer.from('not an image at all'))).status, 400);
    assert.equal((await upload(Buffer.alloc(1024 * 1024 + 1))).status, 400, 'the backend enforces the bucket size limit before storage');
    assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).status, 400, 'declared MIME cannot disguise SVG content');
    assert.equal((await call('token-new', '/users/me/avatar', { method: 'POST', body: new FormData() })).status, 400);
    const stored = await upload(png);
    assert.equal(stored.status, 200);
    const avatar = stored.data.user.avatar as string;
    assert.match(avatar, new RegExp(`^/api/users/${newId}/avatar\\?v=[a-f0-9-]+\\.png$`));
    const download = await call('token-legacy', avatar.slice('/api'.length));
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.compare(download.data as Buffer, png), 0);
    const replaced = await upload(png);
    assert.notEqual(replaced.data.user.avatar, avatar);
    assert.equal((await call('token-legacy', avatar.slice('/api'.length))).status, 200, 'the stable URL serves the current picture');
    assert.equal((await call('token-new', '/bootstrap')).data.user.avatar, replaced.data.user.avatar);
    assert.equal((await call('token-legacy', '/bootstrap')).data.user.avatar, '', 'upload can only update the authenticated owner');
    assert.equal((await call('token-new', `/users/${accounts['token-legacy'].id}/avatar`)).status, 404, 'a user without an uploaded picture has no avatar route');
  } finally { await close(); }
});
