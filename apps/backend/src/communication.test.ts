import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { io as socketClient, type Socket } from 'socket.io-client';
import { createApp } from './app.js';

async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-communication-'));
  let instance = createApp({ dataDir: directory, publicUrl: 'https://haven.example' });
  let base = '';
  const listen = async () => {
    await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
  };
  await listen();
  const request = async (route: string, method = 'GET', body?: unknown, cookie?: string) => {
    const result = await fetch(`${base}/api${route}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, data: await result.json() as any, cookie: result.headers.get('set-cookie')?.split(';')[0] };
  };
  const register = async (username: string) => {
    const result = await request('/auth/register', 'POST', { username, password: 'communication-test-password' });
    assert.equal(result.status, 201);
    return { id: result.data.user.id as string, cookie: result.cookie! };
  };
  return {
    request, register, get base() { return base; }, get db() { return instance.db as Database.Database; },
    restart: async () => { await instance.close(); instance = createApp({ dataDir: directory, publicUrl: 'https://haven.example' }); await listen(); },
    close: async () => { await instance.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

const connect = (base: string, cookie: string) => new Promise<Socket>((resolve, reject) => {
  const socket = socketClient(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false });
  socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
});
const emit = (socket: Socket, name: string, payload: unknown = {}) => new Promise<any>((resolve, reject) => socket.timeout(3000).emit(name, payload, (error: Error | null, result: unknown) => error ? reject(error) : resolve(result)));
const receive = (socket: Socket, event: string) => new Promise<any>((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)); }, 3000);
  const listener = (payload: unknown) => { clearTimeout(timer); resolve(payload); };
  socket.once(event, listener);
});

test('friend requests identify offline users, handle reciprocal races, sync both accounts and persist mutual friendship', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const first = await context.register('MixedCasePerson'); const second = await context.register('friend-recipient');
    assert.equal((await context.request('/friends/requests', 'POST', { username: '@MIXEDCASEPERSON' }, first.cookie)).status, 400);
    assert.equal((await context.request('/friends/requests', 'POST', { username: 'missing-person' }, first.cookie)).status, 404);
    const pending = await context.request('/friends/requests', 'POST', { username: '  @FRIEND-RECIPIENT  ' }, first.cookie);
    assert.equal(pending.status, 201);
    const offline = await context.request('/bootstrap', 'GET', undefined, second.cookie);
    assert.equal(offline.data.requests[0].id, pending.data.request.id);
    assert.equal(offline.data.users.find((person: any) => person.id === first.id).username, 'MixedCasePerson');
    assert.equal(offline.data.users.find((person: any) => person.id === first.id).status, 'offline');
    const duplicate = await context.request('/friends/requests', 'POST', { username: 'friend-recipient' }, first.cookie);
    assert.equal(duplicate.status, 409); assert.match(duplicate.data.error, /already sent/);
    const reciprocal = await context.request('/friends/requests', 'POST', { username: 'mixedcaseperson' }, second.cookie);
    assert.equal(reciprocal.status, 409); assert.match(reciprocal.data.error, /Incoming/);
    assert.throws(() => context.db.prepare('INSERT INTO friendRequests VALUES(?,?,?,?)').run('reverse-duplicate', second.id, first.id, Date.now()), /already exists/);
    const firstSocket = await connect(context.base, first.cookie); const secondSocket = await connect(context.base, second.cookie); sockets.push(firstSocket, secondSocket);
    assert.equal((await context.request(`/friends/requests/${pending.data.request.id}/accept`, 'POST', {}, first.cookie)).status, 403);
    const firstSync = receive(firstSocket, 'sync'); const secondSync = receive(secondSocket, 'sync');
    assert.equal((await context.request(`/friends/requests/${pending.data.request.id}/accept`, 'POST', {}, second.cookie)).status, 200);
    await Promise.all([firstSync, secondSync]);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, first.cookie)).data.friends, [second.id]);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, second.cookie)).data.friends, [first.id]);
    assert.equal((await context.request('/friends/requests', 'POST', { username: 'friend-recipient' }, first.cookie)).status, 409);
    const direct = await context.request('/conversations', 'POST', { memberIds: [second.id] }, first.cookie);
    assert.equal((await context.request('/messages', 'POST', { conversationId: direct.data.conversation.id, content: 'A real direct message' }, first.cookie)).status, 201);
    assert.equal((await context.request(`/messages?conversationId=${direct.data.conversation.id}`, 'GET', undefined, second.cookie)).data.messages[0].content, 'A real direct message');
    sockets.forEach(socket => socket.disconnect()); await context.restart();
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, second.cookie)).data.friends, [first.id]);
    await context.request(`/friends/${second.id}`, 'DELETE', undefined, first.cookie);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, second.cookie)).data.friends, []);
    const races = await Promise.all([
      context.request('/friends/requests', 'POST', { username: 'friend-recipient' }, first.cookie),
      context.request('/friends/requests', 'POST', { username: 'mixedcaseperson' }, second.cookie),
      context.request('/friends/requests', 'POST', { username: 'friend-recipient' }, first.cookie),
    ]);
    assert.deepEqual(races.map(result => result.status).sort(), [201, 409, 409]);
    assert.equal((await context.request('/bootstrap', 'GET', undefined, first.cookie)).data.requests.length, 1);
    const requestId = (await context.request('/bootstrap', 'GET', undefined, second.cookie)).data.requests[0].id;
    await context.request(`/friends/requests/${requestId}`, 'DELETE', undefined, second.cookie);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, first.cookie)).data.requests, []);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('persistent blocks atomically clear contacts, reject requests and direct-message contact, and can be removed', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const first = await context.register('block-first'); const second = await context.register('block-second');
    const pending = await context.request('/friends/requests', 'POST', { username: 'block-second' }, first.cookie);
    await context.request(`/friends/requests/${pending.data.request.id}/accept`, 'POST', {}, second.cookie);
    const direct = await context.request('/conversations', 'POST', { memberIds: [second.id] }, first.cookie); const conversationId = direct.data.conversation.id;
    const original = await context.request('/messages', 'POST', { conversationId, content: 'Preserved history' }, first.cookie);
    const deletable = await context.request('/messages', 'POST', { conversationId, content: 'Own message can still be deleted' }, second.cookie);
    assert.equal((await context.request(`/users/${first.id}/block`, 'POST', {}, first.cookie)).status, 400);
    assert.equal((await context.request(`/users/${second.id}/block`, 'POST', {}, first.cookie)).status, 200);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, first.cookie)).data.blocked, [second.id]);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, second.cookie)).data.friends, []);
    assert.equal((await context.request('/messages', 'POST', { conversationId, content: 'Forbidden' }, second.cookie)).status, 403);
    assert.equal((await context.request(`/messages/${original.data.message.id}`, 'PATCH', { content: 'Bypass block by editing' }, first.cookie)).status, 403);
    assert.equal((await context.request(`/messages/${deletable.data.message.id}`, 'PATCH', { content: 'Bypass block by editing' }, second.cookie)).status, 403);
    assert.equal((await context.request(`/conversations/${conversationId}`, 'PATCH', { name: 'Bypass block by renaming' }, first.cookie)).status, 403);
    assert.equal((await context.request(`/conversations/${conversationId}`, 'PATCH', { name: 'Bypass block by renaming' }, second.cookie)).status, 403);
    assert.equal((await context.request(`/messages/${deletable.data.message.id}`, 'DELETE', undefined, second.cookie)).status, 200);
    assert.equal((await context.request(`/messages/${original.data.message.id}/reactions`, 'POST', { emoji: 'Hi' }, second.cookie)).status, 403);
    assert.equal((await context.request('/conversations', 'POST', { memberIds: [first.id] }, second.cookie)).status, 403);
    assert.equal((await context.request('/friends/requests', 'POST', { username: 'block-first' }, second.cookie)).status, 403);
    assert.equal((await context.request('/friends/requests', 'POST', { username: 'block-second' }, first.cookie)).status, 403);
    const secondSocket = await connect(context.base, second.cookie); sockets.push(secondSocket);
    assert.ok((await emit(secondSocket, 'typing', { conversationId })).error);
    sockets.forEach(socket => socket.disconnect()); await context.restart();
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, first.cookie)).data.blocked, [second.id]);
    assert.equal((await context.request(`/messages?conversationId=${conversationId}`, 'GET', undefined, second.cookie)).data.messages[0].content, 'Preserved history');
    await context.request(`/users/${second.id}/block`, 'DELETE', undefined, first.cookie);
    const fresh = await context.request('/friends/requests', 'POST', { username: 'block-first' }, second.cookie); assert.equal(fresh.status, 201);
    await context.request(`/users/${second.id}/block`, 'POST', {}, first.cookie);
    assert.deepEqual((await context.request('/bootstrap', 'GET', undefined, second.cookie)).data.requests, []);
    assert.equal((await context.request(`/friends/requests/${fresh.data.request.id}/accept`, 'POST', {}, first.cookie)).status, 403);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('public invite previews protect membership, authenticate redemption, enforce expiry and revocation, and preserve owner roles', async () => {
  const context = await fixture();
  try {
    const owner = await context.register('invite-owner'); const guest = await context.register('invite-guest');
    const community = await context.request('/servers', 'POST', { name: 'Invitation community', icon: '🌿' }, owner.cookie); const serverId = community.data.server.id;
    assert.deepEqual((await context.request('/config')).data, { publicUrl: 'https://haven.example' });
    assert.equal((await context.request(`/servers/${serverId}/invites`, 'POST', {}, guest.cookie)).status, 403);
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie);
    assert.equal(invite.status, 201); assert.ok(invite.data.expiresAt > Date.now() + 6 * 86400_000);
    const preview = await context.request(`/invites/${invite.data.code}`);
    assert.deepEqual(preview.data, { community: { name: 'Invitation community', icon: '🌿' }, expiresAt: invite.data.expiresAt });
    assert.equal((await context.request('/bootstrap', 'GET', undefined, guest.cookie)).data.servers.length, 0);
    assert.equal((await context.request(`/invites/${invite.data.code}/join`, 'POST', {})).status, 401);
    assert.equal((await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie)).status, 200);
    await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie);
    await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, owner.cookie);
    assert.equal((await context.request(`/servers/${serverId}/members`, 'GET', undefined, owner.cookie)).data.members.length, 2);
    assert.equal((await context.request('/bootstrap', 'GET', undefined, owner.cookie)).data.servers[0].role, 'owner');
    assert.equal((await context.request(`/servers/${serverId}/invites`, 'GET', undefined, guest.cookie)).status, 403);
    assert.equal((await context.request(`/invites/${invite.data.code}`, 'DELETE', undefined, guest.cookie)).status, 403);
    await context.request(`/invites/${invite.data.code}`, 'DELETE', undefined, owner.cookie);
    assert.equal((await context.request(`/invites/${invite.data.code}`)).status, 404);
    assert.equal((await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie)).status, 404);
    const permanent = await context.request(`/servers/${serverId}/invites`, 'POST', { expiresInHours: null }, owner.cookie); assert.equal(permanent.data.expiresAt, null);
    const expired = await context.request(`/servers/${serverId}/invites`, 'POST', { expiresInHours: 1 }, owner.cookie);
    context.db.prepare('UPDATE invites SET expiresAt=? WHERE code=?').run(Date.now() - 1, expired.data.code);
    assert.equal((await context.request(`/invites/${expired.data.code}`)).status, 410);
    assert.equal((await context.request(`/invites/${expired.data.code}/join`, 'POST', {}, guest.cookie)).status, 410);
    assert.equal((await context.request('/invites/not-real')).status, 404);
    await context.request(`/servers/${serverId}/members/${guest.id}`, 'PATCH', { role: 'admin' }, owner.cookie);
    assert.equal((await context.request(`/invites/${permanent.data.code}`, 'DELETE', undefined, guest.cookie)).status, 200);
    await context.restart();
    const list = await context.request(`/servers/${serverId}/invites`, 'GET', undefined, owner.cookie);
    assert.equal(list.data.invites.length, 3); assert.equal(list.data.invites.filter((value: any) => value.revokedAt !== null).length, 2);
  } finally { await context.close(); }
});

test('voice activity reaches authorized sidebar observers without bootstrap sync and is cleared by mute, room switch and disconnect', async () => {
  const context = await fixture(); const sockets: Socket[] = [];
  try {
    const owner = await context.register('activity-owner'); const guest = await context.register('activity-guest'); const outsider = await context.register('activity-outsider');
    const community = await context.request('/servers', 'POST', { name: 'Activity room' }, owner.cookie); const serverId = community.data.server.id;
    const invite = await context.request(`/servers/${serverId}/invites`, 'POST', {}, owner.cookie); await context.request(`/invites/${invite.data.code}/join`, 'POST', {}, guest.cookie);
    const bootstrap = await context.request('/bootstrap', 'GET', undefined, owner.cookie); const roomId = bootstrap.data.channels.find((value: any) => value.type === 'voice').id;
    const nextRoom = await context.request(`/servers/${serverId}/channels`, 'POST', { name: 'other-room', type: 'voice' }, owner.cookie);
    const ownerSocket = await connect(context.base, owner.cookie); const guestSocket = await connect(context.base, guest.cookie); const outsiderSocket = await connect(context.base, outsider.cookie); sockets.push(ownerSocket, guestSocket, outsiderSocket);
    assert.ok((await emit(outsiderSocket, 'voice:activity', { speaking: true })).error);
    await emit(ownerSocket, 'voice:join', { channelId: roomId });
    const peerJoined = receive(ownerSocket, 'voice:peer-joined'); await emit(guestSocket, 'voice:join', { channelId: roomId });
    assert.equal((await peerJoined).speaking, false);
    await emit(guestSocket, 'voice:leave');
    const activity = receive(guestSocket, 'voice:activity'); let syncs = 0; let leaks = 0;
    guestSocket.on('sync', () => syncs++); outsiderSocket.on('voice:activity', () => leaks++);
    assert.equal((await emit(ownerSocket, 'voice:activity', { speaking: true })).ok, true);
    assert.deepEqual(await activity, { socketId: ownerSocket.id, channelId: roomId, speaking: true });
    assert.equal(syncs, 0); assert.equal(leaks, 0);
    assert.equal((await context.request('/bootstrap', 'GET', undefined, owner.cookie)).data.voice[0].speaking, true);
    const stateUpdate = receive(guestSocket, 'voice:state');
    await emit(ownerSocket, 'voice:state', { muted: true, deafened: false, sharing: true });
    assert.equal((await stateUpdate).muted, true);
    assert.equal(syncs, 0);
    await emit(ownerSocket, 'voice:activity', { speaking: true });
    const muted = (await context.request('/bootstrap', 'GET', undefined, guest.cookie)).data.voice[0]; assert.equal(muted.speaking, false); assert.equal(muted.sharing, true);
    await emit(ownerSocket, 'voice:join', { channelId: nextRoom.data.channel.id });
    const switched = (await context.request('/bootstrap', 'GET', undefined, guest.cookie)).data.voice;
    assert.equal(switched.length, 1); assert.equal(switched[0].channelId, nextRoom.data.channel.id); assert.equal(switched[0].speaking, false);
    assert.equal((await context.request('/bootstrap', 'GET', undefined, outsider.cookie)).data.voice.length, 0);
    const left = receive(guestSocket, 'sync'); ownerSocket.disconnect(); await left;
    assert.equal((await context.request('/bootstrap', 'GET', undefined, guest.cookie)).data.voice.length, 0);
    assert.ok((await emit(guestSocket, 'voice:activity', { speaking: 'yes' })).error);
  } finally { sockets.forEach(socket => socket.disconnect()); await context.close(); }
});

test('legacy databases migrate invitation expiry additively and keep legacy codes redeemable', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-legacy-invites-'));
  const previous = new Database(path.join(directory, 'relay.sqlite'));
  previous.exec('CREATE TABLE invites(code TEXT PRIMARY KEY,serverId TEXT NOT NULL,createdAt INTEGER NOT NULL)');
  previous.prepare('INSERT INTO invites VALUES(?,?,?)').run('legacy-code', 'legacy-server', 1);
  previous.close();
  const instance = createApp({ dataDir: directory });
  try {
    const db = instance.db as Database.Database;
    const legacy = db.prepare('SELECT * FROM invites').get() as any;
    assert.equal(legacy.code, 'legacy-code'); assert.equal(legacy.expiresAt, null); assert.equal(legacy.revokedAt, null);
    db.prepare('INSERT INTO users(id,username,displayName,password,createdAt) VALUES(?,?,?,?,?)').run('legacy-owner', 'legacy-owner', 'Legacy owner', 'unused-password', 1);
    db.prepare('INSERT INTO servers(id,name,icon,ownerId,createdAt) VALUES(?,?,?,?,?)').run('legacy-server', 'Legacy community', '🌱', 'legacy-owner', 1);
    db.prepare('INSERT INTO members(serverId,userId,role) VALUES(?,?,?)').run('legacy-server', 'legacy-owner', 'owner');
    await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
    const preview = await fetch(`${base}/api/invites/legacy-code`);
    assert.deepEqual(await preview.json(), { community: { name: 'Legacy community', icon: '🌱' }, expiresAt: null });
    const guest = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'legacy-guest', password: 'legacy-test-password' }) });
    const cookie = guest.headers.get('set-cookie')!.split(';')[0];
    const redeemed = await fetch(`${base}/api/invites/legacy-code/join`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(redeemed.status, 200); assert.deepEqual(await redeemed.json(), { serverId: 'legacy-server' });
    assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), {});
    assert.throws(() => createApp({ dataDir: directory, publicUrl: 'http://192.168.1.10:3001' }), /HTTPS/);
    assert.throws(() => createApp({ dataDir: directory, publicUrl: 'https://user:secret@haven.example' }), /HTTPS/);
  } finally { await instance.close(); rmSync(directory, { recursive: true, force: true }); }
});
