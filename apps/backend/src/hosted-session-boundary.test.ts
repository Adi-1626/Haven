import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';
import { SqliteAdapter } from './db/sqlite.js';

// Real Express, Socket.IO, SQLite and SupabaseAuthVerifier. Only the provider's getUser lookup is
// simulated, and database latency is injected to make cross-request races deterministic.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const jwt = (sub: string, expiresInSeconds: number, sessionId?: string) =>
  ['e30', Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expiresInSeconds, jti: randomUUID(), ...(sessionId ? { session_id: sessionId } : {}) })).toString('base64url'), 'signature'].join('.');

function provider() {
  const sessions = new Map<string, string>();
  let outage = false;
  const signOuts: string[] = [];
  const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
  (verifier as any).client = { auth: {
    getUser: async (token: string) => {
      if (outage) return { data: { user: null }, error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 }) };
      const id = sessions.get(token);
      return id
        ? { data: { user: { id, email: `${id}@haven.example`, email_confirmed_at: new Date().toISOString() } }, error: null }
        : { data: { user: null }, error: Object.assign(new Error('invalid JWT'), { name: 'AuthApiError', status: 403 }) };
    },
    // Records the requested scope only. Like a real provider, already-issued access JWTs stay accepted by
    // getUser until they expire, so Haven's own revocation is what is being tested.
    admin: { signOut: async (_token: string, scope: string) => { signOuts.push(scope); return { data: null, error: null }; } },
  } };
  return {
    verifier,
    signOuts,
    issue: (id: string, expiresInSeconds = 3600, sessionId?: string) => { const token = jwt(id, expiresInSeconds, sessionId); sessions.set(token, id); return token; },
    revoke: (token: string) => { sessions.delete(token); verifier.invalidateToken(token); },
    setOutage: (value: boolean) => { outage = value; },
  };
}

async function hosted() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-hosted-boundary-'));
  // isPostgres:true selects Hosted Mode (same switch as production) on a disposable SQLite file.
  const db = Object.assign(new SqliteAdapter(path.join(directory, 'test.sqlite')), { isPostgres: true });
  const auth = provider();
  for (const id of ['alice', 'bob']) await db.createUser({ id, username: id, displayName: id, settings: '{"profileCompleted":true}', createdAt: Date.now() });
  await db.createServer({ id: 'server', name: 'Hosted', icon: '', description: '', ownerId: 'alice', createdAt: Date.now() }, 'text', 'voice');
  await db.addMember('server', 'bob');
  const instance = createApp({ dataDir: directory, db, supabaseVerifier: auth.verifier, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-anon-key' });
  await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
  const sockets: Socket[] = [];
  const call = async (route: string, init: { method?: string; token?: string; cookie?: string; json?: unknown } = {}) => {
    const response = await fetch(`${base}/api${route}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}), ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
      body: init.json ? JSON.stringify(init.json) : undefined,
    });
    return { status: response.status, data: await response.json() as any };
  };
  const connect = async (auth: { token?: string; cookie?: string }) => {
    const socket = io(base, { auth: auth.token ? { token: auth.token } : {}, extraHeaders: auth.cookie ? { Cookie: auth.cookie } : undefined, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };
  const serverSocket = (client: Socket) => instance.io.sockets.sockets.get(client.id!)!;
  const close = async () => { sockets.forEach(socket => socket.disconnect()); await instance.close(); fs.rmSync(directory, { recursive: true, force: true }); };
  return { db, auth, instance, base, call, connect, serverSocket, close };
}

const emit = (socket: Socket, name: string, payload: unknown = {}) =>
  new Promise<any>((resolve, reject) => socket.timeout(3000).emit(name, payload, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value)));
const disconnected = (socket: Socket) => new Promise<void>((resolve, reject) => {
  if (!socket.connected) return resolve();
  const timer = setTimeout(() => reject(new Error('Socket was not disconnected')), 5000);
  socket.once('disconnect', () => { clearTimeout(timer); resolve(); });
});

test('Hosted Mode rejects local registration, login, cookies and local session tokens (B-01)', async () => {
  const context = await hosted();
  try {
    assert.equal((await context.call('/config')).data.mode, 'hosted');
    const registration = await context.call('/auth/register', { method: 'POST', json: { username: 'bypass-user', password: 'test-password-123' } });
    assert.equal(registration.status, 403);
    assert.equal(await context.db.getUserByUsername('bypass-user'), undefined, 'registration must not persist an account');
    // A legacy local account and session (for example created before this fix) can no longer be used.
    await context.db.createUser({ id: 'local', username: 'local-user', displayName: 'Local', password: 'salt:00', createdAt: Date.now() });
    const { createHash } = await import('node:crypto');
    await context.db.createSession(createHash('sha256').update('legacy-session').digest('hex'), 'local', Date.now() + 60_000);
    assert.equal((await context.call('/auth/login', { method: 'POST', json: { username: 'local-user', password: 'whatever-123' } })).status, 403);
    assert.equal((await context.call('/bootstrap', { cookie: 'relay_session=legacy-session' })).status, 401);
    assert.equal((await context.call('/bootstrap', { token: 'legacy-session' })).status, 401);
    assert.equal((await context.call('/servers', { method: 'POST', cookie: 'relay_session=legacy-session', json: { name: 'Bypass' } })).status, 401);
    await assert.rejects(context.connect({ cookie: 'relay_session=legacy-session' }), /Sign in/);
    await assert.rejects(context.connect({ token: 'legacy-session' }), /Sign in/);
    // Verified hosted identities still work.
    assert.equal((await context.call('/bootstrap', { token: context.auth.issue('alice') })).status, 200);
  } finally { await context.close(); }
});

test('explicit all-devices Hosted logout ends every hosted socket of the account and the token stays revoked (B-02)', async () => {
  const context = await hosted();
  try {
    const older = context.auth.issue('alice');
    const current = context.auth.issue('alice');
    const bobToken = context.auth.issue('bob');
    const olderHttpToken = context.auth.issue('alice');
    assert.equal((await context.call('/auth/me', { token: olderHttpToken })).status, 200);
    const [olderSocket, currentSocket, bobSocket] = [await context.connect({ token: older }), await context.connect({ token: current }), await context.connect({ token: bobToken })];
    assert.deepEqual(await emit(currentSocket, 'typing', { channelId: 'text' }), { ok: true });
    assert.deepEqual(await emit(olderSocket, 'auth:refresh', { token: context.auth.issue('alice') }), { ok: true });
    const ended = Promise.all([disconnected(olderSocket), disconnected(currentSocket)]);
    const logout = await context.call('/auth/logout', { method: 'POST', token: current, json: { scope: 'global' } });
    assert.deepEqual(logout.data, { ok: true, providerSignedOut: true, scope: 'global' });
    assert.deepEqual(context.auth.signOuts, ['global']);
    await ended;
    assert.equal(bobSocket.connected, true, 'another account is unaffected');
    assert.deepEqual(await emit(bobSocket, 'typing', { channelId: 'text' }), { ok: true });
    // The provider still accepts the access token until it expires; Haven does not.
    assert.equal((await context.call('/auth/me', { token: current })).status, 401);
    await assert.rejects(context.connect({ token: current }), /Sign in/);
    assert.equal((await context.call('/auth/me', { token: older })).status, 401, 'a disconnected older token cannot immediately sign back in');
    await assert.rejects(context.connect({ token: older }), /Sign in/);
    assert.equal((await context.call('/auth/me', { token: olderHttpToken })).status, 401, 'previously observed HTTP tokens end with the account logout too');
    assert.equal((await context.call('/auth/me', { token: context.auth.issue('alice') })).status, 200, 'a new sign-in works');
  } finally { await context.close(); }
});

test('default Hosted logout ends only the current session; other devices keep HTTP, refresh and reconnect', async () => {
  const context = await hosted();
  try {
    const [laptop, phone] = [randomUUID(), randomUUID()];
    const laptopFirst = context.auth.issue('alice', 3600, laptop);
    const laptopSocket = await context.connect({ token: laptopFirst });
    // The laptop's token rotates: the refreshed token keeps the session's session_id.
    const laptopRefreshed = context.auth.issue('alice', 3600, laptop);
    assert.deepEqual(await emit(laptopSocket, 'auth:refresh', { token: laptopRefreshed }), { ok: true });
    const laptopSecondTab = await context.connect({ token: laptopFirst });
    const phoneToken = context.auth.issue('alice', 3600, phone);
    const phoneSocket = await context.connect({ token: phoneToken });
    const bobSocket = await context.connect({ token: context.auth.issue('bob', 3600, randomUUID()) });

    const ended = Promise.all([disconnected(laptopSocket), disconnected(laptopSecondTab)]);
    const logout = await context.call('/auth/logout', { method: 'POST', token: laptopRefreshed });
    assert.deepEqual(logout.data, { ok: true, providerSignedOut: true, scope: 'local' });
    assert.deepEqual(context.auth.signOuts, ['local'], 'the provider is asked to end only this session');
    await ended;

    // Every token of the ended session is refused, on HTTP and on reconnect.
    for (const token of [laptopFirst, laptopRefreshed]) {
      assert.equal((await context.call('/auth/me', { token })).status, 401);
      await assert.rejects(context.connect({ token }), /Sign in/);
    }
    // The phone is untouched: its socket, HTTP, token refresh and a fresh reconnect all keep working.
    assert.equal(phoneSocket.connected, true);
    assert.deepEqual(await emit(phoneSocket, 'typing', { channelId: 'text' }), { ok: true });
    assert.equal((await context.call('/auth/me', { token: phoneToken })).status, 200);
    const phoneRefreshed = context.auth.issue('alice', 3600, phone);
    assert.deepEqual(await emit(phoneSocket, 'auth:refresh', { token: phoneRefreshed }), { ok: true });
    context.serverSocket(phoneSocket).data.verifiedAt = 0;
    await context.instance.runMaintenance();
    assert.equal(phoneSocket.connected, true, 'the periodic recheck keeps the other device');
    phoneSocket.disconnect();
    const phoneReconnected = await context.connect({ token: phoneRefreshed });
    assert.deepEqual(await emit(phoneReconnected, 'typing', { channelId: 'text' }), { ok: true });
    assert.equal(bobSocket.connected, true, 'another account is unaffected');

    // The explicit all-devices action from the phone then ends every remaining session of the account.
    const allEnded = disconnected(phoneReconnected);
    const all = await context.call('/auth/logout', { method: 'POST', token: phoneRefreshed, json: { scope: 'global' } });
    assert.deepEqual(all.data, { ok: true, providerSignedOut: true, scope: 'global' });
    await allEnded;
    assert.equal((await context.call('/auth/me', { token: phoneToken })).status, 401);
    assert.equal(bobSocket.connected, true);
    assert.equal((await context.call('/auth/logout', { method: 'POST', token: context.auth.issue('bob', 3600, randomUUID()), json: { scope: 'everything' } })).status, 400, 'unknown scopes are refused');
  } finally { await context.close(); }
});

test('hosted sockets enforce token expiry, accept same-account refresh and reject foreign tokens (B-02)', async () => {
  const context = await hosted();
  try {
    const expiredToken = context.auth.issue('alice', 2);
    const expiring = await context.connect({ token: expiredToken });
    const refreshed = await context.connect({ token: context.auth.issue('alice', 2) });
    assert.deepEqual(await emit(refreshed, 'auth:refresh', { token: context.auth.issue('alice', 3600) }), { ok: true });
    await sleep(2200);
    assert.equal((await context.call('/auth/me', { token: expiredToken })).status, 401, 'HTTP cache must not extend JWT expiry');
    await assert.rejects(context.connect({ token: expiredToken }), /Sign in/);
    assert.match((await emit(expiring, 'typing', { channelId: 'text' })).error, /Session expired/);
    await disconnected(expiring);
    assert.deepEqual(await emit(refreshed, 'typing', { channelId: 'text' }), { ok: true }, 'a refreshed socket outlives its original token');
    assert.match((await emit(refreshed, 'auth:refresh', { token: 'not-a-provider-token' })).error, /Session expired/);
    await disconnected(refreshed);
    const hijack = await context.connect({ token: context.auth.issue('alice') });
    assert.match((await emit(hijack, 'auth:refresh', { token: context.auth.issue('bob') })).error, /Session expired/);
    await disconnected(hijack);
  } finally { await context.close(); }
});

test('periodic revalidation drops provider-revoked sockets but tolerates provider outages (B-02)', async () => {
  const context = await hosted();
  try {
    const revokedToken = context.auth.issue('alice');
    const revoked = await context.connect({ token: revokedToken });
    const surviving = await context.connect({ token: context.auth.issue('bob') });
    // Make the next maintenance pass due for a provider recheck (normally every two minutes).
    const due = () => {
      for (const socket of [revoked, surviving]) if (socket.connected) context.serverSocket(socket).data.verifiedAt = 0;
      (context.auth.verifier as any).tokenCache.clear();
    };
    due();
    context.auth.setOutage(true);
    await context.instance.runMaintenance();
    assert.equal(revoked.connected && surviving.connected, true, 'an outage is not a revocation');
    assert.equal((await context.call('/bootstrap', { token: context.auth.issue('alice') })).status, 503, 'HTTP reports a retryable outage instead of signing users out');
    context.auth.setOutage(false);
    context.auth.revoke(revokedToken);
    const ended = disconnected(revoked);
    due();
    await context.instance.runMaintenance();
    await ended;
    assert.equal(surviving.connected, true);
  } finally { await context.close(); }
});

test('events emitted immediately after connect are handled even with slow presence queries (B-08)', async () => {
  const context = await hosted();
  try {
    const original = context.db.getVisibleUsers.bind(context.db);
    context.db.getVisibleUsers = async (userId: string) => { await sleep(400); return original(userId); };
    const socket = io(context.base, { auth: { token: context.auth.issue('alice') }, transports: ['websocket'], reconnection: false });
    try {
      const joined = await new Promise<any>((resolve, reject) => socket.once('connect', () => socket.timeout(3000).emit('voice:join', { channelId: 'voice' }, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value))));
      assert.equal(joined.error, undefined);
      assert.deepEqual(joined.peers, []);
    } finally { socket.disconnect(); }
  } finally { await context.close(); }
});

test('concurrent voice joins never exceed eight participants and snapshots are consistent (B-04)', async () => {
  const context = await hosted();
  try {
    // Latency between the capacity check and insertion is what the race needs; inject it.
    for (const method of ['getChannel', 'getMember', 'getUser'] as const) {
      const original = (context.db as any)[method].bind(context.db);
      (context.db as any)[method] = async (...args: unknown[]) => { await sleep(5 + Math.random() * 20); return original(...args); };
    }
    const token = context.auth.issue('alice');
    const sockets = await Promise.all(Array.from({ length: 10 }, () => context.connect({ token })));
    const results = await Promise.all(sockets.map(socket => emit(socket, 'voice:join', { channelId: 'voice' })));
    const joined = results.filter(result => !result.error);
    assert.equal(joined.length, 8);
    assert.equal(results.filter(result => /full/.test(result.error ?? '')).length, 2);
    assert.deepEqual(joined.map(result => result.peers.length).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], 'each joiner sees everyone inserted before it');
    assert.equal((await context.call('/bootstrap', { token })).data.voice.length, 8);
  } finally { await context.close(); }
});

test('graceful shutdown drains active-voice cleanup before closing the database (B-07)', async () => {
  const context = await hosted();
  const failures: unknown[] = [];
  const onUnhandled = (error: unknown) => failures.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    let closed = false;
    const order: string[] = [];
    const originalClose = context.db.close.bind(context.db);
    context.db.close = async () => { order.push('close'); closed = true; return originalClose(); };
    for (const method of ['getChannel', 'getServerAudience', 'getVisibleUsers'] as const) {
      const original = (context.db as any)[method].bind(context.db);
      (context.db as any)[method] = async (...args: unknown[]) => {
        await sleep(50);
        if (closed) throw new Error('Cannot use a pool after calling end on the pool');
        order.push(method);
        return original(...args);
      };
    }
    const socket = await context.connect({ token: context.auth.issue('alice') });
    assert.equal((await emit(socket, 'voice:join', { channelId: 'voice' })).error, undefined);
    order.length = 0;
    await context.instance.close();
    await sleep(100);
    assert.deepEqual(failures, []);
    assert.equal(order.at(-1), 'close');
    assert.ok(order.includes('getServerAudience'), 'voice leave sync ran before the database closed');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    fs.rmSync(path.dirname((context.db as any).getRawDatabase().name), { recursive: true, force: true });
  }
});

test('concurrent sends cannot both claim one attachment; duplicate ids in one message are harmless (B-05)', async () => {
  const context = await hosted();
  try {
    const token = context.auth.issue('alice');
    const originalGet = context.db.getAttachment.bind(context.db);
    context.db.getAttachment = async (id: string) => { const found = await originalGet(id); await sleep(50); return found; };
    const upload = async () => {
      const form = new FormData(); form.set('channelId', 'text'); form.set('file', new Blob(['payload'], { type: 'text/plain' }), 'note.txt');
      const response = await fetch(`${context.base}/api/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      return (await response.json() as any).attachment.id as string;
    };
    const contested = await upload();
    const posted = await Promise.all(['one', 'two'].map(content => context.call('/messages', { method: 'POST', token, json: { channelId: 'text', content, attachmentIds: [contested] } })));
    assert.deepEqual(posted.map(result => result.status).sort(), [201, 403]);
    const history = (await context.call('/messages?channelId=text', { token })).data.messages;
    assert.equal(history.length, 1, 'the rejected message is rolled back entirely');
    assert.equal(history[0].attachments[0].id, contested);
    const twice = await upload();
    const duplicate = await context.call('/messages', { method: 'POST', token, json: { channelId: 'text', content: 'twice', attachmentIds: [twice, twice] } });
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.data.message.attachments.length, 1);
    // Another user cannot claim someone else's upload even with no preflight race.
    const other = await upload();
    context.db.getAttachment = originalGet;
    assert.equal((await context.call('/messages', { method: 'POST', token: context.auth.issue('bob'), json: { channelId: 'text', content: 'steal', attachmentIds: [other] } })).status, 403);
  } finally { await context.close(); }
});

test('history pagination continues across messages that share a timestamp (B-06)', async () => {
  const context = await hosted();
  try {
    const token = context.auth.issue('alice');
    const raw = (context.db as any).getRawDatabase();
    for (const [id, createdAt] of [['old', 1000], ['tie-a', 2000], ['tie-b', 2000], ['tie-c', 2000], ['new', 3000]] as const) {
      raw.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,NULL)').run(id, 'text', null, 'alice', id, null, createdAt);
    }
    const seen: string[] = [];
    let page = (await context.call('/messages?channelId=text&limit=1', { token })).data;
    while (page.messages.length) {
      seen.push(page.messages[0].id);
      if (!page.hasMore) break;
      page = (await context.call(`/messages?channelId=text&limit=1&before=${page.messages[0].createdAt}&beforeId=${page.messages[0].id}`, { token })).data;
    }
    assert.deepEqual(seen, ['new', 'tie-c', 'tie-b', 'tie-a', 'old']);
    assert.equal((await context.call('/messages?channelId=text&before=1.5', { token })).status, 400);
  } finally { await context.close(); }
});

test('oversized JSON bodies are a 413 client error, not an internal error', async () => {
  const context = await hosted();
  try {
    const response = await fetch(`${context.base}/api/messages`, { method: 'POST', headers: { Authorization: `Bearer ${context.auth.issue('alice')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: 'text', content: 'x'.repeat(200_000) }) });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Request is too large' });
  } finally { await context.close(); }
});
