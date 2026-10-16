import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as socketClient, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { inspectRaster } from './images.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j86sAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const animatedGif = Buffer.concat([gif.subarray(0, -1), gif.subarray(19, -1), Buffer.from([59])]);

async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-community-'));
  const instance = createApp({ dataDir: directory });
  await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
  const sockets: Socket[] = [];
  const request = async (route: string, cookie: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const register = async (username: string) => { const result = await request('/auth/register', '', 'POST', { username, password: 'community-password' }); assert.equal(result.status, 201); return { cookie: result.cookie, id: result.data.user.id as string }; };
  const connect = async (cookie: string) => { const socket = socketClient(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false }); sockets.push(socket); await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket; };
  const upload = async (route: string, cookie: string, bytes: Buffer, name = '', staticBytes?: Buffer) => {
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'image.png'); if (name) form.append('name', name); if (staticBytes) form.append('staticFile', new Blob([new Uint8Array(staticBytes)], { type: 'image/png' }), 'preview.png');
    const response = await fetch(`${base}/api${route}`, { method: 'POST', headers: { Cookie: cookie }, body: form }); return { status: response.status, data: await response.json() as any };
  };
  return { base, instance, request, register, connect, upload, close: async () => { sockets.forEach(socket => socket.disconnect()); await instance.close(); rmSync(directory, { recursive: true, force: true }); } };
}

const emit = (socket: Socket, event: string, payload: unknown) => new Promise<any>(resolve => socket.emit(event, payload, resolve));
const received = (socket: Socket, event: string) => new Promise<any>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`Missing ${event}`)), 3000); socket.once(event, result => { clearTimeout(timeout); resolve(result); }); });

test('community settings, raster icons and custom emoji enforce permissions, scope and deletion', async () => {
  const context = await fixture();
  try {
    const owner = await context.register('emoji-owner'); const member = await context.register('emoji-member'); const outsider = await context.register('emoji-outsider');
    const created = await context.request('/servers', owner.cookie, 'POST', { name: 'Community', description: 'A real description' }); const serverId = created.data.server.id; const channelId = created.data.channel.id;
    const invitation = await context.request(`/servers/${serverId}/invites`, owner.cookie, 'POST', {}); await context.request(`/invites/${invitation.data.code}/join`, member.cookie, 'POST', {});
    assert.equal((await context.request(`/servers/${serverId}`, member.cookie, 'PATCH', { description: 'Intrusion' })).status, 403);
    assert.equal((await context.request(`/servers/${serverId}`, owner.cookie, 'PATCH', { name: 'Updated', description: 'Saved', icon: 'https://example.com/icon.png' })).status, 200);
    assert.equal((await context.request(`/servers/${serverId}`, owner.cookie, 'PATCH', { icon: 'javascript:alert(1)' })).status, 400);
    const icon = await context.upload(`/servers/${serverId}/icon`, owner.cookie, png); assert.equal(icon.status, 200); assert.match(icon.data.server.icon, /^\/api\/servers\/.*\/icon\?v=/);
    const loadedIcon = await fetch(`${context.base}${icon.data.server.icon}`, { headers: { Cookie: member.cookie } }); assert.equal(loadedIcon.status, 200); assert.equal(loadedIcon.headers.get('content-type'), 'image/png');
    await context.request(`/servers/${serverId}`, owner.cookie, 'PATCH', { icon: '' }); assert.equal((await fetch(`${context.base}${icon.data.server.icon}`, { headers: { Cookie: member.cookie } })).status, 404);
    assert.equal((await context.upload(`/servers/${serverId}/icon`, owner.cookie, animatedGif)).status, 400);
    assert.equal((await context.upload(`/servers/${serverId}/emojis`, member.cookie, png, 'member_upload')).status, 403);
    assert.equal((await context.upload(`/servers/${serverId}/emojis`, owner.cookie, Buffer.from('<svg onload="alert(1)"></svg>'), 'unsafe_svg')).status, 400);
    assert.equal((await context.upload(`/servers/${serverId}/emojis`, owner.cookie, animatedGif, 'no_poster')).status, 400);
    const added = await context.upload(`/servers/${serverId}/emojis`, owner.cookie, animatedGif, 'animated_wave', png); assert.equal(added.status, 201); assert.equal(added.data.emoji.animated, true);
    const emoji = added.data.emoji; const token = `:hvn_${emoji.id}:`;
    assert.equal((await context.upload(`/servers/${serverId}/emojis`, owner.cookie, png, 'ANIMATED_WAVE')).status, 409);
    assert.equal((await context.request('/bootstrap', member.cookie)).data.serverEmojis[0].id, emoji.id);
    assert.equal((await context.request('/bootstrap', outsider.cookie)).data.serverEmojis.length, 0);
    assert.equal((await fetch(`${context.base}${emoji.url}`, { headers: { Cookie: outsider.cookie } })).status, 403);
    const poster = await fetch(`${context.base}${emoji.staticUrl}`, { headers: { Cookie: member.cookie } }); assert.equal(poster.status, 200); assert.equal(poster.headers.get('content-type'), 'image/png'); assert.match(poster.headers.get('cache-control')!, /must-revalidate/);
    const posted = await context.request('/messages', member.cookie, 'POST', { channelId, content: `Hello ${token}` }); assert.equal(posted.status, 201);
    assert.equal((await context.request(`/messages/${posted.data.message.id}/reactions`, member.cookie, 'POST', { emoji: token })).status, 200);
    const other = await context.request('/servers', owner.cookie, 'POST', { name: 'Other community' });
    assert.equal((await context.request('/messages', owner.cookie, 'POST', { channelId: other.data.channel.id, content: token })).status, 400);
    assert.equal((await context.request(`/messages/${posted.data.message.id}`, member.cookie, 'PATCH', { content: ':hvn_00000000-0000-0000-0000-000000000000:' })).status, 400);
    assert.equal((await context.request(`/emojis/${emoji.id}`, member.cookie, 'PATCH', { name: 'renamed' })).status, 403);
    assert.equal((await context.request(`/emojis/${emoji.id}`, owner.cookie, 'PATCH', { name: 'renamed' })).data.emoji.id, emoji.id);
    await context.request(`/servers/${serverId}/members/${member.id}`, owner.cookie, 'DELETE');
    assert.equal((await fetch(`${context.base}${emoji.url}`, { headers: { Cookie: member.cookie } })).status, 403);
    assert.equal((await context.request(`/emojis/${emoji.id}`, owner.cookie, 'DELETE')).status, 200);
    assert.equal((await fetch(`${context.base}${emoji.url}`, { headers: { Cookie: owner.cookie } })).status, 404);
    const bootstrap = await context.request('/bootstrap', owner.cookie); assert.equal(bootstrap.data.servers.find((server: any) => server.id === serverId).description, 'Saved');
  } finally { await context.close(); }
});

test('profile refreshes active voice snapshots and moderation persists and cannot be self-overridden', async () => {
  const context = await fixture();
  try {
    const owner = await context.register('profile-owner'); const member = await context.register('profile-member'); const admin = await context.register('profile-admin');
    const created = await context.request('/servers', owner.cookie, 'POST', { name: 'Voice community' }); const serverId = created.data.server.id;
    const invitation = await context.request(`/servers/${serverId}/invites`, owner.cookie, 'POST', {});
    for (const account of [member, admin]) await context.request(`/invites/${invitation.data.code}/join`, account.cookie, 'POST', {});
    await context.request(`/servers/${serverId}/members/${admin.id}`, owner.cookie, 'PATCH', { role: 'admin' });
    const bootstrap = await context.request('/bootstrap', owner.cookie); const channelId = bootstrap.data.channels.find((channel: any) => channel.type === 'voice').id;
    const ownerSocket = await context.connect(owner.cookie); const memberSocket = await context.connect(member.cookie);
    await emit(ownerSocket, 'voice:join', { channelId }); await emit(memberSocket, 'voice:join', { channelId });
    const update = received(ownerSocket, 'user:update');
    await context.request('/users/me', member.cookie, 'PATCH', { avatar: 'https://example.com/new-avatar.png', displayName: 'New profile', settings: { privateSetting: 'secret' } });
    const profile = await update; assert.equal(profile.id, member.id); assert.equal(profile.avatar, 'https://example.com/new-avatar.png'); assert.equal(profile.settings, undefined);
    const afterProfile = await context.request('/bootstrap', owner.cookie); assert.equal(afterProfile.data.voice.find((peer: any) => peer.user.id === member.id).user.avatar, profile.avatar);
    assert.equal((await context.request(`/servers/${serverId}/members/${owner.id}/voice`, admin.cookie, 'POST', { action: 'mute' })).status, 403);
    assert.equal((await context.request(`/servers/${serverId}/members/${admin.id}/voice`, admin.cookie, 'POST', { action: 'mute' })).status, 403);
    const moderation = received(memberSocket, 'voice:moderated');
    assert.equal((await context.request(`/servers/${serverId}/members/${member.id}/voice`, owner.cookie, 'POST', { action: 'mute' })).status, 200);
    assert.deepEqual(await moderation, { serverId, muted: true, deafened: false });
    await emit(memberSocket, 'voice:state', { muted: false, deafened: false, sharing: false });
    const muted = (await context.request('/bootstrap', owner.cookie)).data.voice.find((peer: any) => peer.user.id === member.id); assert.equal(muted.muted, true); assert.equal(muted.serverMuted, true);
    await emit(memberSocket, 'voice:leave', {}); const rejoined = await emit(memberSocket, 'voice:join', { channelId }); assert.deepEqual(rejoined.moderation, { serverId, muted: true, deafened: false });
    await context.request(`/servers/${serverId}/members/${member.id}/voice`, admin.cookie, 'POST', { action: 'mute', enabled: false });
    await emit(memberSocket, 'voice:state', { muted: false, deafened: false, sharing: false });
    assert.equal((await context.request('/bootstrap', owner.cookie)).data.voice.find((peer: any) => peer.user.id === member.id).muted, false);
    const disconnected = received(memberSocket, 'voice:disconnect');
    await context.request(`/servers/${serverId}/members/${member.id}/voice`, owner.cookie, 'POST', { action: 'disconnect' }); assert.equal((await disconnected).reason, 'moderator-disconnected');
    assert.equal((await context.request('/bootstrap', owner.cookie)).data.voice.some((peer: any) => peer.user.id === member.id), false);
  } finally { await context.close(); }
});

test('raster inspection bounds decoded dimensions, frame counts and malformed containers', () => {
  assert.equal(inspectRaster(png, 128).mime, 'image/png'); assert.equal(inspectRaster(animatedGif, 128).animated, true);
  const tooLarge = Buffer.from(png); tooLarge.writeUInt32BE(16384, 16); assert.throws(() => inspectRaster(tooLarge, 128), /dimensions/);
  assert.throws(() => inspectRaster(png.subarray(0, 30), 128), /valid/);
  assert.throws(() => inspectRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 128), /valid/);
  const manyFrames = Buffer.concat([gif.subarray(0, -1), ...Array.from({ length: 120 }, () => gif.subarray(19, -1)), Buffer.from([59])]); assert.throws(() => inspectRaster(manyFrames, 128), /120 frames/);
  const outOfCanvas = Buffer.from(gif); outOfCanvas.writeUInt16LE(1, 28); assert.throws(() => inspectRaster(outOfCanvas, 128), /valid/);
  const chunk = (type: string, data: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(type, 4); return Buffer.concat([header, data, Buffer.alloc(4)]); };
  const animation = Buffer.alloc(8); animation.writeUInt32BE(1); const control = Buffer.alloc(26); control.writeUInt32BE(1, 4); control.writeUInt32BE(1, 8);
  const animatedPng = (controls: Buffer[]) => Buffer.concat([png.subarray(0, 33), chunk('acTL', animation), ...controls.map(data => chunk('fcTL', data)), png.subarray(33)]);
  assert.equal(inspectRaster(animatedPng([control]), 128).animated, true);
  assert.throws(() => inspectRaster(animatedPng([control, control]), 128), /valid/);
  const oversizedControl = Buffer.from(control); oversizedControl.writeUInt32BE(2, 4); assert.throws(() => inspectRaster(animatedPng([oversizedControl]), 128), /valid/);
  assert.throws(() => inspectRaster(Buffer.concat([png.subarray(0, 33), png.subarray(-12)]), 128), /valid/);
  const webpChunk = (type: string, data: Buffer) => { const header = Buffer.alloc(8); header.write(type); header.writeUInt32LE(data.length, 4); return Buffer.concat([header, data, Buffer.alloc(data.length & 1)]); };
  const webp = (chunks: Buffer[]) => { const body = Buffer.concat(chunks); const header = Buffer.from('RIFF0000WEBP'); header.writeUInt32LE(body.length + 4, 4); return Buffer.concat([header, body]); };
  const webpHeader = Buffer.alloc(10); webpHeader[0] = 2; const encoded = webpChunk('VP8L', Buffer.from([47, 0, 0, 0, 0])); const frame = Buffer.alloc(16);
  assert.equal(inspectRaster(webp([webpChunk('VP8X', webpHeader), webpChunk('ANIM', Buffer.alloc(6)), webpChunk('ANMF', Buffer.concat([frame, encoded]))]), 128).animated, true);
  frame.writeUIntLE(1, 0, 3); assert.throws(() => inspectRaster(webp([webpChunk('VP8X', webpHeader), webpChunk('ANIM', Buffer.alloc(6)), webpChunk('ANMF', Buffer.concat([frame, encoded]))]), 128), /valid/);
  assert.throws(() => inspectRaster(webp([webpChunk('VP8X', webpHeader)]), 128), /valid/);
});
