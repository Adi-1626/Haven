import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as socketClient, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { consoleSink, createDiagnostics, type DiagnosticEntry } from './diagnostics.js';

async function room(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-diagnostics-'));
  const logs: DiagnosticEntry[] = [];
  const instance = createApp({ dataDir: directory, diagnosticsSink: entry => logs.push(entry) });
  await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
  const request = async (route: string, method: string, cookie?: string, body?: unknown) => {
    const result = await fetch(`${base}/api${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { data: await result.json() as any, cookie: result.headers.get('set-cookie')?.split(';')[0] };
  };
  const users = [];
  for (const index of [0, 1, 2]) {
    const { data, cookie } = await request('/auth/register', 'POST', undefined, { username: `${prefix}-${index}`, password: 'test-password-123' });
    users.push({ id: data.user.id as string, cookie: cookie! });
  }
  const serverId = (await request('/servers', 'POST', users[0].cookie, { name: prefix })).data.server.id;
  const invite = (await request(`/servers/${serverId}/invites`, 'POST', users[0].cookie, {})).data.code;
  await request(`/invites/${invite}/join`, 'POST', users[1].cookie, {});
  const channelId = (await request('/bootstrap', 'GET', users[0].cookie)).data.channels.find((channel: any) => channel.type === 'voice').id;
  const sockets: Socket[] = [];
  const connect = (cookie: string) => new Promise<Socket>((resolve, reject) => {
    const socket = socketClient(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
  return { base, users, channelId, logs, connect, close: async () => { sockets.forEach(socket => socket.disconnect()); await instance.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const emit = (socket: Socket, name: string, payload: unknown = {}) => new Promise<any>((resolve, reject) => { socket.timeout(3000).emit(name, payload, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value)); });
const settle = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const report = (peer: string, overrides: Record<string, unknown> = {}) => ({
  v: 1, type: 'ice_timeout', peer, connectionState: 'connecting', iceState: 'checking', signalingState: 'stable', gatheringState: 'complete',
  retryCount: 0, durationMs: 12_004, checkingMs: 12_004, everConnected: false, resettable: true,
  pairs: { total: 4, failed: 4, succeeded: 0, inProgress: 0, waiting: 0, frozen: 0, selected: false },
  local: { host: 2, srflx: 1 }, remote: { host: 2, srflx: 1 }, browser: 'firefox', client: 'desktop', ...overrides,
});

test('client ICE failures are logged as structured, pseudonymous entries with the right severity', async () => {
  const context = await room('ice-report');
  try {
    const [a, b] = [await context.connect(context.users[0].cookie), await context.connect(context.users[1].cookie)];
    const session = 'private-voice-session-key-0001';
    await emit(a, 'voice:join', { channelId: context.channelId, signaling: 2, session });
    await emit(b, 'voice:join', { channelId: context.channelId });
    assert.deepEqual(await emit(a, 'voice:diagnostic', report(b.id!)), { ok: true });
    assert.deepEqual(await emit(a, 'voice:diagnostic', report(b.id!, { type: 'retries_exhausted', retryCount: 5, connectionState: 'failed', iceState: 'failed' })), { ok: true });
    assert.deepEqual(await emit(a, 'voice:diagnostic', report(b.id!, { type: 'recovered', retryCount: 2, connectionState: 'connected', iceState: 'connected', checkingMs: undefined })), { ok: true });
    const failure = context.logs.find(entry => entry.event === 'voice.ice_failure' && entry.errorType === 'ice_timeout')!;
    assert.equal(failure.level, 'warn');
    assert.match(failure.ts, /^\d{4}-\d\d-\d\dT/);
    assert.equal(failure.room, context.channelId);
    assert.match(String(failure.user), /^u_[0-9a-f]{12}$/);
    assert.match(String(failure.session), /^s_[0-9a-f]{12}$/);
    assert.match(String(failure.peerSession), /^s_[0-9a-f]{12}$/);
    assert.deepEqual([failure.iceState, failure.retryCount, failure.durationMs, failure.browser], ['checking', 0, 12_004, 'firefox']);
    assert.deepEqual(failure.pairs, { total: 4, failed: 4, succeeded: 0, inProgress: 0, waiting: 0, frozen: 0, selected: false });
    // The reporter advertised signaling 2; its peer is an older client, which explains a missing reset.
    assert.deepEqual([failure.signaling, failure.peerSignaling], [2, 1]);
    assert.equal(context.logs.find(entry => entry.errorType === 'retries_exhausted')?.level, 'error');
    assert.equal(context.logs.find(entry => entry.event === 'voice.ice_recovered')?.level, 'info');
    assert.ok(context.logs.some(entry => entry.event === 'voice.legacy_client' && entry.signaling === 1));
    // Raw identifiers and the private session key never reach the log.
    const written = JSON.stringify(context.logs);
    for (const secret of [a.id!, b.id!, context.users[0].id, context.users[1].id, session]) assert.ok(!written.includes(secret), `leaked ${secret}`);
  } finally { await context.close(); }
});

test('diagnostic reports are authenticated, schema-strict and rate limited', async () => {
  const context = await room('ice-guard');
  try {
    const [a, b] = [await context.connect(context.users[0].cookie), await context.connect(context.users[1].cookie)];
    const outsider = await context.connect(context.users[2].cookie);
    // Signed-out clients cannot connect at all.
    await assert.rejects(new Promise((resolve, reject) => { const anonymous = socketClient(context.base, { transports: ['websocket'], reconnection: false }); anonymous.once('connect', resolve); anonymous.once('connect_error', reject); }), /sign in/i);
    assert.match((await emit(outsider, 'voice:diagnostic', report(a.id!))).error, /join voice/i);
    await emit(a, 'voice:join', { channelId: context.channelId, signaling: 2 });
    await emit(b, 'voice:join', { channelId: context.channelId, signaling: 2 });
    // Fields that could carry SDP, addresses or credentials are rejected rather than logged.
    assert.ok((await emit(a, 'voice:diagnostic', { ...report(b.id!), sdp: 'v=0\r\na=ice-pwd:secret' })).error);
    assert.ok((await emit(a, 'voice:diagnostic', { ...report(b.id!), local: { host: 1, address: 10 } })).error);
    assert.ok((await emit(a, 'voice:diagnostic', report(b.id!, { iceState: '192.168.1.20' }))).error);
    assert.ok(!JSON.stringify(context.logs).includes('ice-pwd') && !JSON.stringify(context.logs).includes('192.168'));
    assert.ok(context.logs.some(entry => entry.event === 'voice.diagnostic_rejected' && entry.errorType === 'invalid_payload'));
    // A flooding client is capped at 30 reports a minute, and the cap does not touch its chat budget.
    const results = await Promise.all(Array.from({ length: 40 }, (_value, retryCount) => emit(a, 'voice:diagnostic', report(b.id!, { retryCount }))));
    assert.ok(results.filter(result => /too many/i.test(result.error ?? '')).length >= 10);
    assert.deepEqual(await emit(a, 'voice:state', { muted: false, deafened: false, sharing: false }), { ok: true });
  } finally { await context.close(); }
});

test('rejected and dropped voice signals are logged once per pair and cause, with a repeat summary', async () => {
  const context = await room('signal-log');
  try {
    const [a, b] = [await context.connect(context.users[0].cookie), await context.connect(context.users[1].cookie)];
    await emit(a, 'voice:join', { channelId: context.channelId, signaling: 2 });
    await emit(b, 'voice:join', { channelId: context.channelId, signaling: 2 });
    const flood = await Promise.all(Array.from({ length: 400 }, () => emit(a, 'voice:signal', { target: b.id, candidate: { candidate: 'candidate:1 1 udp 1 203.0.113.9 5000 typ host', usernameFragment: 'abcd' } })));
    const rejected = flood.filter(result => result.error).length;
    assert.ok(rejected > 100);
    const limited = context.logs.filter(entry => entry.event === 'voice.signal_rejected' && entry.errorType === 'rate_limited');
    assert.equal(limited.length, 1);
    assert.deepEqual([limited[0].level, limited[0].kind, limited[0].room], ['warn', 'candidate', context.channelId]);
    assert.match(String(limited[0].peerSession), /^s_/);
    assert.ok(!JSON.stringify(context.logs).includes('203.0.113.9'), 'candidate address leaked');
    // Invalid payloads and peers outside the room are classified separately.
    await emit(a, 'voice:signal', { target: b.id, description: { type: 'bogus' } });
    await emit(a, 'voice:signal', { target: 'not-a-peer', reset: true });
    assert.ok(context.logs.some(entry => entry.errorType === 'invalid_payload'));
    assert.ok(context.logs.some(entry => entry.errorType === 'peer_unavailable' && entry.level === 'info'));
  } finally { await context.close(); }
  // Closing flushes the deduplicated repeats as one summary line.
  const summary = context.logs.find(entry => entry.errorType === 'rate_limited' && typeof entry.repeated === 'number');
  assert.ok(summary && (summary.repeated as number) >= 100, JSON.stringify(summary));
});

test('deduplication, the global line budget and severity filtering bound log volume', () => {
  let clock = 0;
  const lines: DiagnosticEntry[] = [];
  const diagnostics = createDiagnostics({ sink: entry => lines.push(entry), dedupeMs: 1000, budget: 5, now: () => clock, level: 'info', salt: 'fixed' });
  try {
    diagnostics.log('debug', 'noise');
    for (let index = 0; index < 50; index++) diagnostics.log('warn', 'same', { n: 1 }, 'key');
    assert.equal(lines.length, 1);
    clock = 1500; diagnostics.sweep();
    assert.equal(lines[1].repeated, 49);
    for (let index = 0; index < 20; index++) diagnostics.log('warn', 'distinct', {}, String(index));
    assert.equal(lines.length, 5);
    clock = 61_500; diagnostics.sweep();
    assert.equal(lines.at(-1)?.event, 'diagnostics.dropped');
    assert.equal(diagnostics.anonymize('u', 'user-1'), diagnostics.anonymize('u', 'user-1'));
    assert.notEqual(diagnostics.anonymize('u', 'user-1'), diagnostics.anonymize('s', 'user-1'));
  } finally { diagnostics.close(); }
  // The production sink writes one JSON object per line; errors go to stderr.
  const written: string[] = [];
  const [stdout, stderr] = [process.stdout.write, process.stderr.write];
  process.stdout.write = ((chunk: string) => { written.push(`out ${chunk}`); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => { written.push(`err ${chunk}`); return true; }) as typeof process.stderr.write;
  try {
    consoleSink({ ts: 't', level: 'warn', event: 'a' });
    consoleSink({ ts: 't', level: 'error', event: 'b' });
  } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
  assert.deepEqual(written, ['out {"ts":"t","level":"warn","event":"a"}\n', 'err {"ts":"t","level":"error","event":"b"}\n']);
});
