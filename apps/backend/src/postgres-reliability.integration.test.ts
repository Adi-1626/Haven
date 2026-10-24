import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { PostgresAdapter } from './db/postgres.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';

// Real PostgreSQL, Express and Socket.IO in Hosted Mode. Only Supabase getUser is simulated.
// Requires HAVEN_TEST_POSTGRES_URL pointing at a disposable loopback server.
const connection = process.env.HAVEN_TEST_POSTGRES_URL;

function verifier() {
  const instance = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
  (instance as any).client = { auth: { getUser: async (token: string) => {
    const id = token.split('#')[0];
    return id ? { data: { user: { id, email: `${id}@haven.example`, email_confirmed_at: new Date().toISOString() } }, error: null } : { data: { user: null }, error: { status: 403, name: 'AuthApiError' } };
  } } };
  return instance;
}

test('real PostgreSQL Hosted Mode: auth boundary, voice cap, attachment claims, ordering, shutdown and query counts', { skip: !connection }, async () => {
  const url = new URL(connection!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This test only permits a disposable local PostgreSQL server');
  const admin = new pg.Client({ connectionString: connection, ssl: false });
  await admin.connect();
  const database = `haven_qa_reliability_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  const observer = new pg.Client({ connectionString: url.href, ssl: false });
  await observer.connect();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-pg-reliability-'));
  const db = new PostgresAdapter({ connectionString: url.href, ssl: false });
  const sockets: Socket[] = [];
  let instance: ReturnType<typeof createApp> | undefined;
  const failures: unknown[] = [];
  const onUnhandled = (error: unknown) => failures.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const source = fs.readFileSync(new URL('../../../supabase/migrations/20261016000002_haven_schema.sql', import.meta.url), 'utf8');
    await observer.query(source.split('-- 17. Enable Row Level Security')[0].replace(/^CREATE EXTENSION[^\n]*$/gm, '').replace(/^(?:GRANT |ALTER DEFAULT PRIVILEGES )[^\n]*$/gm, ''));
    for (const id of ['owner', 'friend', 'stranger']) await db.createUser({ id, username: id, displayName: id, settings: '{"profileCompleted":true}', createdAt: Date.now() });
    await db.createServer({ id: 'server', name: 'Server', icon: '', description: '', ownerId: 'owner', createdAt: Date.now() }, 'text', 'voice');
    const originalGetServer = db.getServer.bind(db);
    let serverReads = 0; let releaseServerReads!: () => void;
    const serverBarrier = new Promise<void>(resolve => { releaseServerReads = resolve; });
    db.getServer = async serverId => {
      const row = await originalGetServer(serverId);
      if (++serverReads === 2) releaseServerReads();
      await serverBarrier; return row;
    };
    try { await Promise.all([db.updateServer('server', { name: 'Renamed server' }), db.updateServer('server', { description: 'Concurrent description' })]); }
    finally { db.getServer = originalGetServer; }
    const changedServer = await db.getServer('server');
    assert.equal(changedServer?.name, 'Renamed server');
    assert.equal(changedServer?.description, 'Concurrent description', 'disjoint server patches cannot overwrite each other');
    instance = createApp({ db, dataDir: directory, supabaseVerifier: verifier(), supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-anon-key' });
    await new Promise<void>(resolve => instance!.httpServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
    const call = async (route: string, method = 'GET', body?: unknown, token = 'owner') => {
      const response = await fetch(`${base}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json() as any };
    };
    const connect = async (token = 'owner') => {
      const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      return socket;
    };
    const emit = (socket: Socket, name: string, payload: unknown = {}) => new Promise<any>((resolve, reject) => socket.timeout(3000).emit(name, payload, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value)));

    // B-01: Hosted Mode refuses local accounts.
    assert.equal((await call('/config')).data.mode, 'hosted');
    const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bypass-verified-email', password: 'test-password-123' }) });
    assert.equal(registration.status, 403);
    assert.equal(registration.headers.get('set-cookie'), null);
    assert.equal((await observer.query("SELECT count(*)::int AS n FROM haven.users WHERE username = 'bypass-verified-email'")).rows[0].n, 0);

    // B-08: an event emitted synchronously on `connect` is handled.
    const eager = io(base, { auth: { token: 'owner' }, transports: ['websocket'], reconnection: false }); sockets.push(eager);
    const eagerJoin = await new Promise<any>((resolve, reject) => eager.once('connect', () => eager.timeout(3000).emit('voice:join', { channelId: 'voice' }, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value))));
    assert.equal(eagerJoin.error, undefined);
    await emit(eager, 'voice:leave');

    // B-04: seven sequential joins, then two concurrent joins: exactly one fits.
    const clients = await Promise.all(Array.from({ length: 9 }, () => connect()));
    for (const socket of clients.slice(0, 7)) assert.equal((await emit(socket, 'voice:join', { channelId: 'voice' })).error, undefined);
    const contested = await Promise.all(clients.slice(7).map(socket => emit(socket, 'voice:join', { channelId: 'voice' })));
    assert.deepEqual(contested.map(result => result.error ? 'full' : result.peers.length).sort(), [7, 'full']);
    assert.equal((await call('/bootstrap')).data.voice.length, 8);
    // Ten concurrent joins into an empty room: eight succeed with consistent snapshots.
    await Promise.all(clients.map(socket => emit(socket, 'voice:leave')));
    const burst = [...clients, await connect()];
    const burstResults = await Promise.all(burst.map(socket => emit(socket, 'voice:join', { channelId: 'voice' })));
    assert.deepEqual(burstResults.filter(result => !result.error).map(result => result.peers.length).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal((await call('/bootstrap')).data.voice.length, 8);

    // B-05: two concurrent messages claiming one attachment.
    const form = new FormData(); form.set('channelId', 'text'); form.set('file', new Blob(['private attachment'], { type: 'text/plain' }), 'probe.txt');
    const attachment = (await (await fetch(`${base}/api/attachments`, { method: 'POST', headers: { Authorization: 'Bearer owner' }, body: form })).json() as any).attachment;
    const posted = await Promise.all(['one', 'two'].map(content => call('/messages', 'POST', { channelId: 'text', content, attachmentIds: [attachment.id] })));
    assert.deepEqual(posted.map(result => result.status).sort(), [201, 403]);
    const winner = posted.find(result => result.status === 201)!.data.message;
    assert.equal(winner.attachments[0].id, attachment.id);
    const history = (await call('/messages?channelId=text')).data.messages;
    assert.deepEqual(history.map((item: any) => [item.content, item.attachments.length]), [[winner.content, 1]]);

    // B-06: concurrent writers with an identical clock still get distinct, ordered timestamps.
    const realNow = Date.now; const fixed = realNow() + 10_000; Date.now = () => fixed;
    try { await Promise.all(Array.from({ length: 6 }, (_, index) => db.createMessage({ id: `concurrent-${index}`, channelId: 'text', authorId: 'owner', content: 'concurrent', attachmentIds: [] }))); }
    finally { Date.now = realNow; }
    const stamps = (await observer.query("SELECT count(DISTINCT created_at)::int AS n FROM haven.messages WHERE id LIKE 'concurrent-%'")).rows[0].n;
    assert.equal(stamps, 6);
    // Legacy rows that already share a timestamp remain reachable with the (createdAt, id) cursor.
    for (const id of ['legacy-a', 'legacy-b', 'legacy-c']) await observer.query("INSERT INTO haven.messages(id, channel_id, author_id, content, created_at) VALUES($1, 'text', 'owner', 'legacy tie', 5)", [id]);
    const seen: string[] = [];
    let page = (await call('/messages?channelId=text&q=legacy%20tie&limit=1')).data;
    while (page.messages.length) {
      seen.push(page.messages[0].id);
      if (!page.hasMore) break;
      page = (await call(`/messages?channelId=text&q=legacy%20tie&limit=1&before=${page.messages[0].createdAt}&beforeId=${page.messages[0].id}`)).data;
    }
    assert.deepEqual(seen, ['legacy-c', 'legacy-b', 'legacy-a']);
    assert.equal((await call('/messages?channelId=text&q=%25')).data.messages.length, 0, "search is literal: '%' is not a wildcard");

    // Concurrent reaction toggles and reciprocal friend requests no longer surface as HTTP 500.
    const reactions = await Promise.all([call(`/messages/${winner.id}/reactions`, 'POST', { emoji: '🔥' }), call(`/messages/${winner.id}/reactions`, 'POST', { emoji: '🔥' })]);
    assert.deepEqual(reactions.map(result => result.status), [200, 200]);
    // Three simultaneous toggles are three state transitions, even when all inserts
    // complete before either losing caller proceeds to its delete.
    const originalExecute = (db as any).execute.bind(db);
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    (db as any).execute = async (sql: string, values: unknown[]) => {
      const result = await originalExecute(sql, values);
      if (sql.startsWith('INSERT INTO haven.reactions')) { if (++arrived === 3) release(); await barrier; }
      return result;
    };
    try { await Promise.all(Array.from({ length: 3 }, () => db.toggleReaction(winner.id, 'owner', '👍'))); }
    finally { (db as any).execute = originalExecute; }
    assert.equal((await observer.query("SELECT count(*)::int AS n FROM haven.reactions WHERE emoji = '👍'")).rows[0].n, 1, 'odd concurrent toggles leave the reaction enabled');
    const friendRaces = await Promise.all([
      call('/friends/requests', 'POST', { username: 'friend' }, 'owner'),
      call('/friends/requests', 'POST', { username: 'owner' }, 'friend'),
      call('/friends/requests', 'POST', { username: 'friend' }, 'owner'),
    ]);
    assert.deepEqual(friendRaces.map(result => result.status).sort(), [201, 409, 409]);
    assert.equal((await observer.query('SELECT count(*)::int AS n FROM haven.friend_requests')).rows[0].n, 1);

    // B-09: bootstrap and history query counts are independent of community/conversation size.
    const pool = (db as any).pool; const realConnect = pool.connect.bind(pool); let statements = 0;
    const counting = async () => { const client = await realConnect(); const query = client.query.bind(client); return { release: () => client.release(), query: async (sql: string, params?: unknown[]) => { statements++; return query(sql, params); } }; };
    const measure = async (route: string) => { statements = 0; pool.connect = counting; try { assert.equal((await call(route)).status, 200); } finally { pool.connect = realConnect; } return statements; };
    const small = await measure('/bootstrap');
    for (let n = 0; n < 20; n++) { await db.createUser({ id: `visible-${n}`, username: `visible-${n}`, displayName: 'Visible', settings: '{"profileCompleted":true}', createdAt: Date.now() }); await db.addMember('server', `visible-${n}`); }
    for (let n = 0; n < 10; n++) await db.createConversation(`conversation-${n}`, 'Probe', ['owner', `visible-${n}`], Date.now());
    const large = await measure('/bootstrap');
    assert.equal(large, small, `bootstrap statements: ${small} small vs ${large} large`);
    assert.ok(large <= 12, `bootstrap used ${large} statements`);
    const boot = (await call('/bootstrap')).data;
    assert.equal(boot.users.length, 22); // owner, 20 members, pending-request contact assert.equal(boot.conversations.length, 10);
    assert.ok(boot.conversations.every((item: any) => item.memberIds.length === 2));
    for (let n = 0; n < 40; n++) await db.createMessage({ id: `bulk-${n}`, channelId: 'text', authorId: 'owner', content: `bulk ${n}`, attachmentIds: [] });
    const historyStatements = await measure('/messages?channelId=text&limit=50');
    assert.ok(historyStatements <= 8, `history used ${historyStatements} statements`);
    console.log(JSON.stringify({ bootstrapStatements: { small, large }, historyStatements }));

    // B-07: shutdown with active voice participants completes their cleanup before the pool ends.
    assert.ok((await call('/bootstrap')).data.voice.length > 0);
    await instance.close();
    instance = undefined;
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(failures, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    sockets.forEach(socket => socket.disconnect());
    if (instance) await instance.close(); else await db.close().catch(() => {});
    await observer.end();
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
