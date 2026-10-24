import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as socketClient, type Socket } from 'socket.io-client';
import { createApp, HAVEN_VERSION, type AppOptions } from './app.js';
import { SqliteAdapter } from './db/sqlite.js';
import type { DatabaseAdapter } from './db/types.js';

async function fixture(database?: (directory: string) => DatabaseAdapter, options: Partial<AppOptions> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-test-'));
  let instance = createApp({ ...options, dataDir: directory, ...(database ? { db: database(directory) } : {}) });
  await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const address = instance.httpServer.address() as { port: number };
  let base = `http://127.0.0.1:${address.port}`;
  const request = async (route: string, method = 'GET', body?: unknown, cookie?: string) => {
    const result = await fetch(`${base}/api${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, data: await result.json() as any, cookie: result.headers.get('set-cookie')?.split(';')[0] };
  };
  const register = async (username: string) => { const result = await request('/auth/register', 'POST', { username, password: 'test-password-123' }); assert.equal(result.status, 201); return { id: result.data.user.id as string, cookie: result.cookie! }; };
  return {
    request, register, get base() { return base; },
    restart: async () => { await instance.close(); instance = createApp({ dataDir: directory }); await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`; },
    close: async () => { await instance.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('one release version across manifests, lockfile and health endpoints', async () => {
  const manifest = (relative: string) => JSON.parse(readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8'));
  const release = manifest('package.json').version;
  for (const workspace of ['apps/backend', 'apps/web', 'apps/desktop', 'apps/landing', 'packages/shared']) assert.equal(manifest(`${workspace}/package.json`).version, release, workspace);
  const lock = manifest('package-lock.json');
  assert.equal(lock.version, release);
  for (const [location, entry] of Object.entries(lock.packages as Record<string, { version?: string }>)) if (location === '' || /^(apps|packages)\/[^/]+$/.test(location)) assert.equal(entry.version, release, `package-lock ${location || 'root'}`);
  assert.equal(HAVEN_VERSION, release);
  const context = await fixture();
  try {
    assert.equal((await context.request('/health')).data.version, release);
    assert.equal((await (await fetch(`${context.base}/health`)).json() as any).version, release);
    assert.equal((await (await fetch(`${context.base}/`, { headers: { Accept: 'application/json' } })).json() as any).version, release);
  } finally {
    await context.close();
  }
});

test('accounts, sessions, channels, history and edits persist across restart', async () => {
  const context = await fixture();
  try {
    const owner = await context.register('persist-owner');
    const defaultName = await context.request('/auth/register', 'POST', { username: 'blank-display-name', password: 'test-password-123', displayName: '   ' });
    assert.equal(defaultName.status, 201); assert.equal(defaultName.data.user.displayName, 'blank-display-name');
    const longName = await context.request('/users/me', 'PATCH', { displayName: 'A'.repeat(50) }, defaultName.cookie);
    assert.equal(longName.status, 200); assert.equal(longName.data.user.displayName.length, 50);
    const community = await context.request('/servers', 'POST', { name: 'Persistent community' }, owner.cookie);
    assert.equal(community.status, 201);
    const channelId = community.data.channel.id;
    const first = await context.request('/messages', 'POST', { channelId, content: 'A persistent message' }, owner.cookie);
    assert.equal(first.status, 201);
    const edited = await context.request(`/messages/${first.data.message.id}`, 'PATCH', { content: 'Edited persistent message' }, owner.cookie);
    assert.equal(edited.data.message.content, 'Edited persistent message');
    await context.restart();
    const history = await context.request(`/messages?channelId=${channelId}&q=persistent`, 'GET', undefined, owner.cookie);
    assert.equal(history.status, 200); assert.equal(history.data.messages.length, 1); assert.equal(history.data.messages[0].content, 'Edited persistent message');
    const bootstrap = await context.request('/bootstrap', 'GET', undefined, owner.cookie);
    assert.equal(bootstrap.data.servers[0].role, 'owner'); assert.equal(bootstrap.data.users.length, 1);
    const login = await context.request('/auth/login', 'POST', { username: 'persist-owner', password: 'test-password-123' }); assert.equal(login.status, 200);
    const denied = await context.request('/auth/login', 'POST', { username: 'persist-owner', password: 'wrong-password' }); assert.equal(denied.status, 401);
  } finally { await context.close(); }
});

test('returning accounts accept copied usernames without changing password matching or host isolation', async () => {
  const context = await fixture();
  const otherHost = await fixture();
  try {
    const owner = await context.register('return.user-name');
    await context.request('/auth/logout', 'POST', {}, owner.cookie);
    await context.restart();
    const login = await context.request('/auth/login', 'POST', { username: '  @RETURN.USER-NAME  ', password: 'test-password-123', displayName: '' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, owner.id);
    assert.ok(login.cookie);
    const bootstrap = await context.request('/bootstrap', 'GET', undefined, login.cookie);
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.data.user.id, owner.id);
    for (const password of ['wrong-password', 'TEST-PASSWORD-123', ' test-password-123', 'test-password-123 ']) {
      assert.equal((await context.request('/auth/login', 'POST', { username: 'return.user-name', password })).status, 401);
    }
    assert.equal((await otherHost.request('/auth/login', 'POST', { username: 'return.user-name', password: 'test-password-123' })).status, 401);
    assert.equal((await context.request('/auth/login', 'POST', { username: 'unknown-user', password: 'test-password-123' })).status, 401);
    assert.equal((await context.request('/auth/register', 'POST', { username: 'RETURN.USER-NAME', password: 'test-password-123' })).status, 409);
  } finally { await context.close(); await otherHost.close(); }
});

test('membership, author rights, attachments and friend conversations enforce access', async () => {
  const context = await fixture();
  try {
    const owner = await context.register('scope-owner'); const outsider = await context.register('scope-outsider');
    const community = await context.request('/servers', 'POST', { name: 'Private space' }, owner.cookie);
    const serverId = community.data.server.id; const channelId = community.data.channel.id;
    const post = await context.request('/messages', 'POST', { channelId, content: 'Private' }, owner.cookie); const messageId = post.data.message.id;
    assert.equal((await context.request(`/messages?channelId=${channelId}`, 'GET', undefined, outsider.cookie)).status, 403);
    assert.equal((await context.request('/messages', 'POST', { channelId, content: 'Intrusion' }, outsider.cookie)).status, 403);
    const form = new FormData(); form.append('channelId', channelId); form.append('file', new Blob(['private bytes'], { type: 'text/plain' }), 'secret.txt');
    const uploaded = await fetch(`${context.base}/api/attachments`, { method: 'POST', headers: { Cookie: owner.cookie }, body: form });
    assert.equal(uploaded.status, 201); const upload = await uploaded.json() as any;
    assert.equal((await fetch(`${context.base}${upload.attachment.url}`, { headers: { Cookie: outsider.cookie } })).status, 403);
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie);
    assert.equal((await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, outsider.cookie)).status, 200);
    assert.equal((await context.request(`/messages/${messageId}`, 'PATCH', { content: 'Steal authorship' }, outsider.cookie)).status, 403);
    assert.equal((await context.request(`/servers/${serverId}/channels`, 'POST', { name: 'Forbidden', type: 'text' }, outsider.cookie)).status, 403);
    const friendRequest = await context.request('/friends/requests', 'POST', { username: 'scope-outsider' }, owner.cookie);
    await context.request(`/friends/requests/${friendRequest.data.request.id}/accept`, 'POST', {}, outsider.cookie);
    const conversation = await context.request('/conversations', 'POST', { memberIds: [outsider.id] }, owner.cookie);
    assert.equal(conversation.status, 201);
    const direct = await context.request('/messages', 'POST', { conversationId: conversation.data.conversation.id, content: 'Private DM' }, owner.cookie); assert.equal(direct.status, 201);
    const third = await context.register('third-person');
    assert.equal((await context.request(`/messages?conversationId=${conversation.data.conversation.id}`, 'GET', undefined, third.cookie)).status, 403);
    await context.request(`/servers/${serverId}/members/${outsider.id}`, 'DELETE', undefined, owner.cookie);
    assert.equal((await context.request(`/messages?channelId=${channelId}`, 'GET', undefined, outsider.cookie)).status, 403);
    assert.equal((await fetch(`${context.base}${upload.attachment.url}`, { headers: { Cookie: outsider.cookie } })).status, 403);
    await context.request('/auth/logout', 'POST', {}, owner.cookie);
    assert.equal((await context.request('/bootstrap', 'GET', undefined, owner.cookie)).status, 401);
  } finally { await context.close(); }
});

const connect = (base: string, cookie: string) => new Promise<Socket>((resolve, reject) => { const socket = socketClient(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false }); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject); });
const emit = (socket: Socket, name: string, payload: unknown = {}) => new Promise<any>((resolve, reject) => { socket.timeout(3000).emit(name, payload, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value)); });

test('stream subscriptions acknowledge protocol, reject stale/unauthorized watches and serialize cancellation', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const owner = await context.register('stream-owner'), viewer = await context.register('stream-viewer'), outsider = await context.register('stream-outsider');
    const community = await context.request('/servers', 'POST', { name: 'Stream room' }, owner.cookie);
    const serverId = community.data.server.id;
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie);
    await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, viewer.cookie);
    const boot = await context.request('/bootstrap', 'GET', undefined, owner.cookie);
    const channelId = boot.data.channels.find((c: any) => c.type === 'voice').id;
    const a = await connect(context.base, owner.cookie), b = await connect(context.base, viewer.cookie), c = await connect(context.base, outsider.cookie);
    sockets.push(a, b, c);
    const joined = await emit(a, 'voice:join', { channelId, streamProtocol: 1 });
    assert.equal(joined.capabilities.streamSubscriptions, 1);
    await emit(b, 'voice:join', { channelId, streamProtocol: 1 });
    const broadcastId = '00000000-0000-4000-8000-000000000001';
    await emit(a, 'voice:state', { muted: false, deafened: false, sharing: true, broadcastId });
    assert.match((await emit(c, 'voice:stream-watch', { target: a.id, broadcastId })).error, /permission/i);
    assert.match((await emit(b, 'voice:stream-watch', { target: a.id, broadcastId: '00000000-0000-4000-8000-000000000002' })).error, /ended/i);
    const watched = new Promise<any>(resolve => a.once('voice:stream-watch', resolve));
    assert.deepEqual(await emit(b, 'voice:stream-watch', { target: a.id, broadcastId }), { protocol: 1, broadcastId });
    assert.deepEqual(await watched, { viewerSocketId: b.id, broadcastId });
    const cancelled = new Promise<any>(resolve => a.once('voice:stream-unwatch', resolve));
    // Packet order must win even though authorization uses asynchronous database calls.
    await Promise.all([
      emit(b, 'voice:stream-watch', { target: a.id, broadcastId }),
      emit(b, 'voice:stream-unwatch', { target: a.id, broadcastId }),
    ]);
    assert.deepEqual(await cancelled, { viewerSocketId: b.id, broadcastId });
    await emit(b, 'voice:stream-watch', { target: a.id, broadcastId });
    const onLeave = new Promise<any>(resolve => a.once('voice:stream-unwatch', resolve));
    await emit(b, 'voice:leave');
    assert.equal((await onLeave).broadcastId, broadcastId);
    await emit(a, 'voice:state', { muted: false, deafened: false, sharing: false });
    await emit(b, 'voice:join', { channelId, streamProtocol: 1 });
    assert.match((await emit(b, 'voice:stream-watch', { target: a.id, broadcastId })).error, /ended/i);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('socket voice signaling and kick revocation stay inside authorized rooms', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const owner = await context.register('voice-owner'); const guest = await context.register('voice-guest'); const stranger = await context.register('voice-stranger');
    const community = await context.request('/servers', 'POST', { name: 'Voice space' }, owner.cookie); const serverId = community.data.server.id;
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie); await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie);
    const bootstrap = await context.request('/bootstrap', 'GET', undefined, owner.cookie); const channelId = bootstrap.data.channels.find((channel: any) => channel.type === 'voice').id;
    const ownerSocket = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); const strangerSocket = await connect(context.base, stranger.cookie); sockets.push(ownerSocket, guestSocket, strangerSocket);
    assert.ok((await emit(strangerSocket, 'voice:join', { channelId })).error);
    assert.deepEqual((await emit(ownerSocket, 'voice:join', { channelId })).peers, []);
    assert.equal((await emit(guestSocket, 'voice:join', { channelId })).peers[0].socketId, ownerSocket.id);
    const received = new Promise<any>(resolve => guestSocket.once('voice:signal', resolve));
    await emit(ownerSocket, 'voice:signal', { target: guestSocket.id, description: { type: 'offer', sdp: 'test-sdp' } });
    assert.equal((await received).from, ownerSocket.id);
    assert.ok((await emit(strangerSocket, 'voice:signal', { target: guestSocket.id, description: { type: 'offer', sdp: 'intrusion' } })).error);
    const revoked = new Promise<any>(resolve => guestSocket.once('voice:disconnect', resolve));
    await context.request(`/servers/${serverId}/members/${guest.id}`, 'DELETE', undefined, owner.cookie);
    assert.equal((await revoked).reason, 'membership-revoked');
    assert.ok((await emit(guestSocket, 'voice:state', { muted: false, deafened: false, sharing: true })).error);
    assert.ok((await emit(ownerSocket, 'voice:signal', { target: guestSocket.id, description: { type: 'offer', sdp: 'revoked' } })).error);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('voice signals are forwarded in packet order when authorization latency varies', async () => {
  // Hosted Postgres answers concurrent authorization queries in any order. An ICE-restart
  // offer must still reach the peer before the candidates of its new ICE generation.
  const delays: number[] = [];
  const context = await fixture(directory => {
    const adapter = new SqliteAdapter(path.join(directory, 'relay.sqlite'));
    return new Proxy(adapter, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key !== 'getChannel' || typeof value !== 'function') return typeof value === 'function' ? value.bind(target) : value;
        return async (...args: unknown[]) => {
          const delay = delays.shift() ?? 0;
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          return value.apply(target, args);
        };
      },
    });
  });
  const sockets: Socket[] = [];
  try {
    const owner = await context.register('order-owner'); const guest = await context.register('order-guest');
    const community = await context.request('/servers', 'POST', { name: 'Ordered voice' }, owner.cookie); const serverId = community.data.server.id;
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie); await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie);
    const channelId = (await context.request('/bootstrap', 'GET', undefined, owner.cookie)).data.channels.find((channel: any) => channel.type === 'voice').id;
    const ownerSocket = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); sockets.push(ownerSocket, guestSocket);
    await emit(ownerSocket, 'voice:join', { channelId }); await emit(guestSocket, 'voice:join', { channelId });
    const received: string[] = [];
    const complete = new Promise<void>(resolve => guestSocket.on('voice:signal', signal => {
      received.push(signal.description ? signal.description.type : signal.candidate.candidate);
      if (received.length === 4) resolve();
    }));
    // The offer's two authorization lookups are slow; every candidate's lookups are instant.
    delays.push(80, 80);
    const signals = [
      emit(ownerSocket, 'voice:signal', { target: guestSocket.id, description: { type: 'offer', sdp: 'restart-offer' } }),
      ...['first', 'second', 'third'].map(candidate => emit(ownerSocket, 'voice:signal', { target: guestSocket.id, candidate: { candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'next' } })),
    ];
    assert.ok((await Promise.all(signals)).every(result => !result.error));
    await complete;
    assert.deepEqual(received, ['offer', 'first', 'second', 'third']);
    // A rejected signal releases its turn without stalling later traffic.
    assert.ok((await emit(ownerSocket, 'voice:signal', { target: 'missing-peer', candidate: { candidate: 'lost' } })).error);
    const after = new Promise<any>(resolve => guestSocket.once('voice:signal', resolve));
    await emit(ownerSocket, 'voice:signal', { target: guestSocket.id, candidate: { candidate: 'after-error', usernameFragment: 'next' } });
    assert.equal((await after).candidate.candidate, 'after-error');
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

async function voiceRoom(context: Awaited<ReturnType<typeof fixture>>, prefix: string, members = 2) {
  const users = [];
  for (let index = 0; index < members; index++) users.push(await context.register(`${prefix}-${index}`));
  const community = await context.request('/servers', 'POST', { name: `${prefix} space` }, users[0].cookie); const serverId = community.data.server.id;
  const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, users[0].cookie);
  for (const member of users.slice(1)) await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, member.cookie);
  const channelId = (await context.request('/bootstrap', 'GET', undefined, users[0].cookie)).data.channels.find((channel: any) => channel.type === 'voice').id;
  return { users, serverId, channelId };
}
const next = (socket: Socket, name: string) => new Promise<any>(resolve => socket.once(name, resolve));
const settle = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));

test('voice signaling has its own burst budget: chat traffic cannot starve it, floods are capped and acknowledged', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const { users: [owner, guest], channelId } = await voiceRoom(context, 'signal-budget');
    const ownerSocket = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); sockets.push(ownerSocket, guestSocket);
    await emit(ownerSocket, 'voice:join', { channelId }); await emit(guestSocket, 'voice:join', { channelId });
    // Exhaust the shared per-user socket budget that signaling used to draw from.
    const typing = await Promise.all(Array.from({ length: 310 }, () => emit(ownerSocket, 'typing', { channelId: 'missing' })));
    assert.ok(typing.some(result => /too many/i.test(result.error ?? '')));
    // Several ICE generations from a multi-homed host still arrive in full.
    let arrived = 0;
    guestSocket.on('voice:signal', () => { arrived++; });
    const candidates = await Promise.all(Array.from({ length: 140 }, (_value, index) => emit(ownerSocket, 'voice:signal', { target: guestSocket.id, candidate: { candidate: `candidate:${index}`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'burst' } })));
    assert.deepEqual(candidates.filter(result => result.error), []);
    await settle();
    assert.equal(arrived, 140);
    // A flood far beyond any ICE burst is capped, and every rejection is acknowledged.
    const flood = await Promise.all(Array.from({ length: 200 }, () => emit(ownerSocket, 'voice:signal', { target: guestSocket.id, candidate: { candidate: 'flood', usernameFragment: 'burst' } })));
    const rejected = flood.filter(result => result.error);
    assert.ok(rejected.length >= 150, `rejected ${rejected.length}`);
    assert.ok(rejected.every(result => result.error === 'Voice signaling rate exceeded'));
    // Descriptions carry large SDP and have a tighter budget of their own.
    const offers = await Promise.all(Array.from({ length: 40 }, () => emit(guestSocket, 'voice:signal', { target: ownerSocket.id, description: { type: 'offer', sdp: 'v=0' } })));
    assert.equal(offers.filter(result => !result.error).length, 30);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('a reconnecting voice session replaces its stale socket at once; nobody else can evict it', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const { users: [owner, guest, other], channelId } = await voiceRoom(context, 'voice-session', 3);
    const session = 'session-key-0123456789abcdef';
    const stale = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); sockets.push(stale, guestSocket);
    await emit(stale, 'voice:join', { channelId, session }); await emit(guestSocket, 'voice:join', { channelId });
    const staleId = stale.id;
    const left = next(guestSocket, 'voice:peer-left'); const joined = next(guestSocket, 'voice:peer-joined'); const dropped = next(stale, 'disconnect');
    const resumed = await connect(context.base, owner.cookie); sockets.push(resumed);
    const result = await emit(resumed, 'voice:join', { channelId, session, resume: true });
    assert.deepEqual(result.peers.map((peer: any) => peer.socketId), [guestSocket.id]);
    assert.equal(result.capabilities.voiceSessions, 1);
    assert.deepEqual(await left, { socketId: staleId, reason: 'replaced' });
    const announced = await joined;
    assert.equal(announced.socketId, resumed.id); assert.equal(announced.resumed, true); assert.equal(announced.entrySound, false);
    assert.equal('session' in announced, false);
    await dropped;
    // Another account presenting the same key cannot retire this session.
    const intruder = await connect(context.base, other.cookie); sockets.push(intruder);
    await emit(intruder, 'voice:join', { channelId, session });
    await settle();
    assert.equal(resumed.connected, true);
    const voice = (await context.request('/bootstrap', 'GET', undefined, guest.cookie)).data.voice.map((peer: any) => peer.socketId).sort();
    assert.deepEqual(voice, [resumed.id, guestSocket.id, intruder.id].sort());
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('peers learn why someone left, and an abruptly lost connection leaves within the heartbeat bound', async () => {
  const context = await fixture(undefined, { heartbeat: { interval: 200, timeout: 200 } }); const sockets: Socket[] = [];
  try {
    const { users: [owner, guest], channelId } = await voiceRoom(context, 'leave-reason');
    const ownerSocket = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); sockets.push(ownerSocket, guestSocket);
    await emit(ownerSocket, 'voice:join', { channelId }); await emit(guestSocket, 'voice:join', { channelId });
    let left = next(ownerSocket, 'voice:peer-left');
    await emit(guestSocket, 'voice:leave');
    assert.deepEqual(await left, { socketId: guestSocket.id, reason: 'leave' });
    await emit(guestSocket, 'voice:join', { channelId });
    // The network vanishes: nothing more is read or delivered, not even a close frame or FIN.
    // Only the server heartbeat can notice.
    const guestId = guestSocket.id;
    left = next(ownerSocket, 'voice:peer-left');
    const started = Date.now();
    const tcp = (guestSocket.io.engine.transport as any).ws._socket;
    tcp.pause(); tcp.write = () => true;
    assert.deepEqual(await left, { socketId: guestId, reason: 'disconnect' });
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    tcp.destroy();
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('the server plays a deliberate join entry sound once, never for a resumed session or a foreign sound', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const { users: [owner, guest], serverId, channelId } = await voiceRoom(context, 'entry-sound');
    const upload = async (target: string) => {
      const form = new FormData(); form.append('name', 'Entrance'); form.append('file', new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }), 'entrance.wav');
      return (await (await fetch(`${context.base}/api/servers/${target}/sounds`, { method: 'POST', headers: { Cookie: owner.cookie }, body: form })).json() as any).sound;
    };
    const sound = await upload(serverId);
    await context.request('/users/me', 'PATCH', { settings: { entrySounds: { [serverId]: sound.id } } }, owner.cookie);
    const guestSocket = await connect(context.base, guest.cookie); sockets.push(guestSocket);
    await emit(guestSocket, 'voice:join', { channelId });
    const played: any[] = []; guestSocket.on('sound:play', value => played.push(value));
    const joined = next(guestSocket, 'voice:peer-joined');
    const ownerSocket = await connect(context.base, owner.cookie); sockets.push(ownerSocket);
    const heardBySelf = next(ownerSocket, 'sound:play');
    const result = await emit(ownerSocket, 'voice:join', { channelId, session: 'entry-session-0123456789', entrySound: true });
    assert.equal(result.capabilities.entrySounds, 1);
    const announced = await joined;
    assert.equal(announced.entrySound, true); assert.equal(announced.resumed, false);
    assert.equal(announced.user.settings, undefined);
    assert.equal((await heardBySelf).sound.id, sound.id);
    await settle();
    assert.deepEqual(played.map(value => [value.sound.id, value.userId, value.entry]), [[sound.id, owner.id, true]]);
    // A resumed session stays silent even when the flag is sent.
    await emit(ownerSocket, 'voice:leave');
    await emit(ownerSocket, 'voice:join', { channelId, session: 'entry-session-0123456789', resume: true, entrySound: true });
    await settle();
    assert.equal(played.length, 1);
    // A sound of a different community is never played here.
    const elsewhere = (await context.request('/servers', 'POST', { name: 'Elsewhere' }, owner.cookie)).data.server.id;
    const foreign = await upload(elsewhere);
    await context.request('/users/me', 'PATCH', { settings: { entrySounds: { [serverId]: foreign.id } } }, owner.cookie);
    await emit(ownerSocket, 'voice:leave');
    const rejoined = next(guestSocket, 'voice:peer-joined');
    await emit(ownerSocket, 'voice:join', { channelId, session: 'entry-session-abcdef0123456', entrySound: true });
    assert.equal((await rejoined).entrySound, false);
    await settle();
    assert.equal(played.length, 1);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('attachments, replies, reactions, soundboard and group history persist with scope checks', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const owner = await context.register('features-owner'); const guest = await context.register('features-guest'); const third = await context.register('features-third');
    const community = await context.request('/servers', 'POST', { name: 'Feature community' }, owner.cookie); const serverId = community.data.server.id; const channelId = community.data.channel.id;
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie); await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie);
    const upload = new FormData(); upload.append('channelId', channelId); upload.append('file', new Blob(['shared attachment'], { type: 'text/plain' }), 'test.txt');
    const uploaded = await fetch(`${context.base}/api/attachments`, { method: 'POST', headers: { Cookie: owner.cookie }, body: upload }); assert.equal(uploaded.status, 201); const attachment = (await uploaded.json() as any).attachment;
    const parent = await context.request('/messages', 'POST', { channelId, content: 'Attached message', attachmentIds: [attachment.id] }, owner.cookie); assert.equal(parent.status, 201); assert.equal(parent.data.message.attachments[0].id, attachment.id);
    const reply = await context.request('/messages', 'POST', { channelId, content: 'A reply', replyTo: parent.data.message.id }, guest.cookie); assert.equal(reply.data.message.replyTo, parent.data.message.id);
    const reaction = await context.request(`/messages/${reply.data.message.id}/reactions`, 'POST', { emoji: '👍' }, owner.cookie); assert.deepEqual(reaction.data.message.reactions, [{ emoji: '👍', userIds: [owner.id] }]);
    const toggle = await context.request(`/messages/${reply.data.message.id}/reactions`, 'POST', { emoji: '👍' }, owner.cookie); assert.deepEqual(toggle.data.message.reactions, []);
    const reused = await context.request('/messages', 'POST', { channelId, content: 'Reuse forbidden', attachmentIds: [attachment.id] }, owner.cookie); assert.equal(reused.status, 403);
    const second = await context.request(`/servers/${serverId}/channels`, 'POST', { name: 'other', type: 'text' }, owner.cookie);
    const badReply = await context.request('/messages', 'POST', { channelId: second.data.channel.id, content: 'Cross scope reply', replyTo: parent.data.message.id }, owner.cookie); assert.equal(badReply.status, 400);
    const soundUpload = new FormData(); soundUpload.append('name', 'Test tone'); soundUpload.append('file', new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }), 'tone.wav');
    const soundResponse = await fetch(`${context.base}/api/servers/${serverId}/sounds`, { method: 'POST', headers: { Cookie: owner.cookie }, body: soundUpload }); assert.equal(soundResponse.status, 201); const sound = (await soundResponse.json() as any).sound;
    assert.equal((await fetch(`${context.base}${sound.url}`, { headers: { Cookie: third.cookie } })).status, 403);
    assert.equal((await fetch(`${context.base}${sound.url}`, { headers: { Cookie: guest.cookie } })).status, 200);
    const ownerSocket = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); sockets.push(ownerSocket, guestSocket);
    assert.ok((await emit(ownerSocket, 'sound:play', { soundId: sound.id })).error);
    const bootstrap = await context.request('/bootstrap', 'GET', undefined, owner.cookie); const voiceChannel = bootstrap.data.channels.find((channel: any) => channel.type === 'voice').id;
    await emit(ownerSocket, 'voice:join', { channelId: voiceChannel }); await emit(guestSocket, 'voice:join', { channelId: voiceChannel });
    const soundHeard = new Promise<any>(resolve => guestSocket.once('sound:play', resolve)); await emit(ownerSocket, 'sound:play', { soundId: sound.id }); assert.equal((await soundHeard).sound.id, sound.id);
    for (const friend of [guest, third]) { const pending = await context.request('/friends/requests', 'POST', { username: friend === guest ? 'features-guest' : 'features-third' }, owner.cookie); await context.request(`/friends/requests/${pending.data.request.id}/accept`, 'POST', {}, friend.cookie); }
    const group = await context.request('/conversations', 'POST', { memberIds: [guest.id, third.id], name: 'Group conversation' }, owner.cookie); assert.equal(group.data.conversation.memberIds.length, 3);
    const groupMessage = await context.request('/messages', 'POST', { conversationId: group.data.conversation.id, content: 'Group history' }, owner.cookie); assert.equal(groupMessage.status, 201);
    await context.request(`/conversations/${group.data.conversation.id}/members/me`, 'DELETE', undefined, third.cookie);
    assert.equal((await context.request(`/messages?conversationId=${group.data.conversation.id}`, 'GET', undefined, third.cookie)).status, 403);
    sockets.forEach(socket => socket.disconnect()); await context.restart();
    const history = await context.request(`/messages?channelId=${channelId}`, 'GET', undefined, guest.cookie); assert.equal(history.data.messages.length, 2); assert.equal(history.data.messages[0].attachments[0].id, attachment.id);
    const download = await fetch(`${context.base}${attachment.url}`, { headers: { Cookie: guest.cookie } }); assert.equal(await download.text(), 'shared attachment');
    assert.equal((await context.request(`/servers/${serverId}/sounds`, 'GET', undefined, guest.cookie)).data.sounds[0].id, sound.id);
    await context.request(`/messages/${parent.data.message.id}`, 'DELETE', undefined, owner.cookie);
    assert.equal((await fetch(`${context.base}${attachment.url}`, { headers: { Cookie: guest.cookie } })).status, 404);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('voice roster reflects mute/share state and allows eight connections but rejects ninth', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const owner = await context.register('voice-cap-owner'); await context.request('/servers', 'POST', { name: 'Capacity' }, owner.cookie);
    const initial = await context.request('/bootstrap', 'GET', undefined, owner.cookie); const channelId = initial.data.channels.find((channel: any) => channel.type === 'voice').id;
    for (let index = 0; index < 9; index++) { const socket = await connect(context.base, owner.cookie); sockets.push(socket); const result = await emit(socket, 'voice:join', { channelId }); if (index < 8) assert.equal(result.peers.length, index); else assert.match(result.error, /full/); }
    await emit(sockets[0], 'voice:state', { muted: true, deafened: false, sharing: true });
    const current = await context.request('/bootstrap', 'GET', undefined, owner.cookie); assert.equal(current.data.voice.length, 8);
    const changed = current.data.voice.find((peer: any) => peer.socketId === sockets[0].id); assert.equal(changed.muted, true); assert.equal(changed.sharing, true);
    await emit(sockets[0], 'voice:leave'); assert.equal((await emit(sockets[8], 'voice:join', { channelId })).peers.length, 7);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});
