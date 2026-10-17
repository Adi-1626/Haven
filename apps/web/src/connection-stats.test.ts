import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { connectionStatsInterval, connectionSummary, expireConnectionStatistics, readConnectionStatistics, startConnectionStatsPolling, subscribeConnectionReports, type ConnectionReportSample, type ConnectionStatsSource, type PacketHistory } from './connection-stats';

const report = (...entries: Record<string, unknown>[]) => new Map(entries.map((entry, index) => [String(index), entry])) as unknown as RTCStatsReport;
const source = (state: RTCPeerConnectionState = 'connected'): ConnectionStatsSource => ({ socketId: 'peer-1', name: 'Alice', connection: { connectionState: state, getStats: async () => report() } });
const audio = (received: number, lost: number) => ({ id: 'audio-1', type: 'inbound-rtp', kind: 'audio', packetsReceived: received, packetsLost: lost, jitter: .007 });

test('reads selected transport RTT in milliseconds and ignores unrelated video / candidate pairs', () => {
  const result = readConnectionStatistics(source(), report(
    { id: 'transport', type: 'transport', selectedCandidatePairId: 'selected' },
    { id: 'other', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .9 },
    { id: 'selected', type: 'candidate-pair', currentRoundTripTime: .042 },
    audio(100, 3), { id: 'video', type: 'inbound-rtp', kind: 'video', jitter: 9, packetsReceived: 1, packetsLost: 999 },
  ), new Map());
  assert.equal(result.rttMs, 42);
  assert.equal(result.jitterMs, 7);
  assert.equal(result.packetLossPercent, null);
});

test('packet loss uses deltas, returns unavailable for idle samples, and resets counter history', () => {
  const history: PacketHistory = new Map();
  const sample = (received: number, lost: number) => readConnectionStatistics(source(), report(audio(received, lost)), history);
  assert.equal(sample(1000, 100).packetLossPercent, null);
  assert.equal(sample(1098, 102).packetLossPercent, 2);
  assert.equal(sample(1098, 102).packetLossPercent, null);
  assert.equal(sample(20, 0).packetLossPercent, null);
  assert.equal(sample(29, 1).packetLossPercent, 10);
});

test('falls back to actual audio RTCP RTT and identifies the measurement source', () => {
  const result = readConnectionStatistics(source(), report(
    { id: 'local-audio', type: 'outbound-rtp', kind: 'audio' },
    { id: 'remote-audio', type: 'remote-inbound-rtp', localId: 'local-audio', roundTripTime: .065 },
    { id: 'remote-video', type: 'remote-inbound-rtp', kind: 'video', roundTripTime: 2 },
  ), new Map());
  assert.equal(result.rttMs, 65);
  assert.equal(result.rttSource, 'audio');
});

test('SSRC replacement starts fresh packet history even when stats id is reused', () => {
  const history: PacketHistory = new Map();
  readConnectionStatistics(source(), report({ ...audio(100, 3), ssrc: 1 }), history);
  const result = readConnectionStatistics(source(), report({ ...audio(200, 9), ssrc: 2 }), history);
  assert.equal(result.packetLossPercent, null);
  assert.equal(history.size, 1);
});

test('missing/invalid metrics stay unavailable and non-connected states cannot show stale ping', () => {
  assert.equal(readConnectionStatistics(source(), report({ id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: NaN }), new Map()).rttMs, null);
  const pending = readConnectionStatistics(source('disconnected'), report({ id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .02 }, audio(100, 0)), new Map());
  assert.equal(pending.rttMs, null);
  assert.equal(pending.jitterMs, null);
  assert.equal(connectionSummary('connecting', []).label, 'Connecting');
  assert.equal(connectionSummary('reconnecting', []).label, 'Reconnecting');
  assert.equal(connectionSummary('disconnected', []).label, 'Disconnected');
  assert.equal(connectionSummary('connected', []).label, 'Waiting for peers');
  assert.equal(connectionSummary('connected', [pending]).label, 'Peer reconnecting');
});

test('summary uses worst actual peer metrics', () => {
  const a = readConnectionStatistics(source(), report(), new Map());
  const b = { ...a, socketId: 'peer-2', rttMs: 300, jitterMs: 1 };
  assert.deepEqual(connectionSummary('connected', [{ ...a, rttMs: 20 }, b]), { label: '300 ms', tone: 'poor' });
  assert.equal(connectionSummary('connected', [{ ...a, rttMs: 20, packetLossPercent: 8 }]).tone, 'poor');
  assert.equal(connectionSummary('connected', [a]).label, 'Stats unavailable');
});

test('polling cleans timer and discards late async results after stop', async () => {
  let resolve!: (value: RTCStatsReport) => void;
  const peer = source();
  peer.connection.getStats = () => new Promise(done => { resolve = done; });
  let published = 0;
  let scheduled = 0;
  const stop = startConnectionStatsPolling(() => [peer], () => { published++; }, 2000, (() => { scheduled++; return 123; }) as unknown as typeof setTimeout);
  stop();
  resolve(report());
  await new Promise(done => setImmediate(done));
  assert.equal(published, 0);
  assert.equal(scheduled, 0);
  let canceled = false;
  const stopAgain = startConnectionStatsPolling(() => [], () => { published++; }, 2000, (() => 123) as unknown as typeof setTimeout, (() => { canceled = true; }) as typeof clearTimeout);
  await new Promise(done => setImmediate(done));
  stopAgain();
  assert.equal(canceled, true);
});

test('polling discards departed / replaced peers and handles getStats rejection', async () => {
  let resolve!: (value: RTCStatsReport) => void;
  const peer = source();
  peer.connection.getStats = () => new Promise(done => { resolve = done; });
  let peers = [peer];
  let output: unknown;
  const stop = startConnectionStatsPolling(() => peers, stats => { output = stats; });
  peers = [];
  resolve(report());
  await new Promise(done => setImmediate(done));
  assert.deepEqual(output, []);
  stop();
  const failed = source();
  failed.connection.getStats = async () => { throw new Error('not supported'); };
  const stopFailed = startConnectionStatsPolling(() => [failed], stats => { output = stats; });
  await new Promise(done => setImmediate(done));
  assert.equal((output as { rttMs: unknown }[])[0].rttMs, null);
  stopFailed();
});

test('a replaced peer connection never receives the old connection sample', async () => {
  let resolve!: (value: RTCStatsReport) => void;
  const old = source();
  old.connection.getStats = () => new Promise(done => { resolve = done; });
  let peers = [old];
  let output: { rttMs: number | null; state: RTCPeerConnectionState }[] = [];
  const stop = startConnectionStatsPolling(() => peers, stats => { output = stats; });
  peers = [source('connecting')];
  resolve(report({ id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .035 }));
  await new Promise(done => setImmediate(done));
  assert.equal(output[0].rttMs, null);
  assert.equal(output[0].state, 'connecting');
  stop();
});

function testClock() {
  let now = 1_800_000_000_000;
  let nextId = 0;
  const tasks = new Map<number, { callback: () => void; due: number }>();
  const runtime = {
    now: () => now,
    schedule: ((callback: () => void, delay: number) => { const id = ++nextId; tasks.set(id, { callback, due: now + delay }); return id; }) as unknown as typeof setTimeout,
    cancel: ((id: number) => { tasks.delete(id); }) as unknown as typeof clearTimeout,
  };
  return {
    runtime,
    pending: () => tasks.size,
    async advance(ms: number) {
      now += ms;
      for (const [id, task] of [...tasks]) if (task.due <= now) { tasks.delete(id); task.callback(); }
      await new Promise(done => setImmediate(done));
    },
  };
}

test('observer demand uses 2s viewed / 10s closed / 30s background and restores on foreground', () => {
  assert.equal(connectionStatsInterval(true, false), 2000);
  assert.equal(connectionStatsInterval(false, false), 10_000);
  assert.equal(connectionStatsInterval(true, true), 30_000);
  assert.equal(connectionStatsInterval(false, true), 30_000);
  assert.equal(connectionStatsInterval(true, false), 2000);
});

test('shared collection serves diagnostics and health without duplicate getStats and releases its last timer', async () => {
  const clock = testClock();
  const peer = source();
  let collections = 0;
  peer.connection.getStats = async () => { collections++; return report(); };
  const sources = () => [peer];
  let health = 0;
  let viewed = 0;
  const stopHealth = subscribeConnectionReports(sources, () => { health++; }, 5000, clock.runtime);
  let stopViewed = subscribeConnectionReports(sources, () => { viewed++; }, 2000, clock.runtime);
  await clock.advance(0);
  assert.equal(collections, 1);
  assert.equal(health, 1);
  assert.equal(viewed, 1);
  await clock.advance(2000);
  assert.equal(collections, 2);
  assert.equal(health, 1);
  assert.equal(viewed, 2);
  stopViewed();
  stopViewed = subscribeConnectionReports(sources, () => { viewed++; }, 10_000, clock.runtime);
  await clock.advance(0);
  const atClose = collections;
  await clock.advance(3000);
  assert.equal(collections, atClose + 1);
  assert.equal(health, 2);
  stopViewed();
  stopHealth();
  assert.equal(clock.pending(), 0);
});

test('late timer execution is reported as client delivery delay without inflating actual RTT', async () => {
  const clock = testClock();
  const peer = source();
  peer.connection.getStats = async () => report({ id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .028 });
  let latest: ConnectionReportSample[] = [];
  const stop = subscribeConnectionReports(() => [peer], samples => { latest = samples; }, 2000, clock.runtime);
  await clock.advance(0);
  await clock.advance(3500);
  assert.equal(latest[0].deliveryDelayMs, 1500);
  const stat = readConnectionStatistics(peer, latest[0].report!, new Map(), { now: latest[0].collectedAt, deliveryDelayMs: latest[0].deliveryDelayMs });
  assert.equal(stat.rttMs, 28);
  assert.equal(stat.deliveryDelayMs, 1500);
  stop();
});

test('slightly phase-shifted health/diagnostics deadlines reuse raw reports and preserve collection time', async () => {
  const clock = testClock();
  const peer = source();
  let collections = 0;
  peer.connection.getStats = async () => { collections++; return report(); };
  const sources = () => [peer];
  let healthSample: ConnectionReportSample | undefined;
  let diagnosticSample: ConnectionReportSample | undefined;
  const stopHealth = subscribeConnectionReports(sources, samples => { healthSample = samples[0]; }, 5000, clock.runtime);
  await clock.advance(0);
  await clock.advance(2);
  const stopDiagnostics = subscribeConnectionReports(sources, samples => { diagnosticSample = samples[0]; }, 10_000, clock.runtime);
  const firstCollectedAt = healthSample!.collectedAt;
  assert.equal(diagnosticSample!.collectedAt, firstCollectedAt);
  await clock.advance(4998);
  await clock.advance(5000);
  const actualCollection = healthSample!.collectedAt;
  assert.equal(collections, 3);
  await clock.advance(2);
  assert.equal(collections, 3);
  assert.equal(diagnosticSample!.collectedAt, actualCollection);
  assert.equal(diagnosticSample!.report, healthSample!.report);
  assert.equal(diagnosticSample!.deliveryDelayMs, 2);
  await clock.advance(4998);
  await clock.advance(5000);
  await clock.advance(2);
  assert.equal(collections, 5);
  stopHealth();
  stopDiagnostics();
  assert.equal(clock.pending(), 0);
});

test('a pending getStats is never overlapped by other observers or new timer deadlines', async () => {
  const clock = testClock();
  const peer = source();
  let collections = 0;
  let resolve!: (report: RTCStatsReport) => void;
  peer.connection.getStats = () => { collections++; return new Promise(done => { resolve = done; }); };
  const sources = () => [peer];
  let published = 0;
  const stopHealth = subscribeConnectionReports(sources, () => { published++; }, 5000, clock.runtime);
  const stopDiagnostics = subscribeConnectionReports(sources, () => { published++; }, 2000, clock.runtime);
  await clock.advance(20_000);
  assert.equal(collections, 1);
  stopHealth();
  stopDiagnostics();
  assert.equal(clock.pending(), 0);
  resolve(report());
  await clock.advance(0);
  assert.equal(published, 0);
});

test('default-runtime timer calls preserve the browser Window receiver', () => {
  // A fresh module captures browser-like timer functions rather than Node's
  // permissive timers. Neither scheduling nor cleanup may bind them to runtime.
  const script = `
    const originalSchedule = globalThis.setTimeout;
    const originalCancel = globalThis.clearTimeout;
    globalThis.setTimeout = function (...args) {
      if (this !== globalThis) throw new Error('Illegal invocation: setTimeout');
      return Reflect.apply(originalSchedule, globalThis, args);
    };
    globalThis.clearTimeout = function (...args) {
      if (this !== globalThis) throw new Error('Illegal invocation: clearTimeout');
      return Reflect.apply(originalCancel, globalThis, args);
    };
    const { startConnectionStatsPolling } = await import(${JSON.stringify(new URL('./connection-stats.ts', import.meta.url).href)});
    let publications = 0;
    const stop = startConnectionStatsPolling(() => [], () => { publications++; }, 1000);
    await new Promise(resolve => originalSchedule.call(globalThis, resolve, 20));
    if (publications !== 1) throw new Error('Default polling did not publish');
    stop();
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('old report timestamps and unchanged ICE/RTCP measurement counters become unavailable', () => {
  const now = 1_800_000_000_000;
  const history: PacketHistory = new Map();
  const stats = () => report(
    { id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .028, responsesReceived: 10 },
    { id: 'audio-remote', type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: .04, roundTripTimeMeasurements: 4 },
  );
  assert.equal(readConnectionStatistics(source(), stats(), history, { now }).rttMs, 28);
  assert.equal(readConnectionStatistics(source(), stats(), history, { now: now + 16_000 }).rttMs, null);
  const old = readConnectionStatistics(source(), report({ id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .028, timestamp: now - 20_000 }), new Map(), { now });
  assert.equal(old.rttMs, null);
  assert.equal(old.stale, true);
});

test('expired UI data clears metrics; disconnected samples reset histories before reconnection', () => {
  const now = 1_800_000_000_000;
  const history: PacketHistory = new Map();
  const first = readConnectionStatistics(source(), report(audio(100, 1)), history, { now });
  assert.equal(expireConnectionStatistics({ ...first, rttMs: 25 }, now + 20_000).rttMs, null);
  readConnectionStatistics(source('disconnected'), report(audio(200, 2)), history, { now: now + 1000 });
  assert.equal(history.size, 0);
  assert.equal(readConnectionStatistics(source(), report(audio(300, 3)), history, { now: now + 2000 }).packetLossPercent, null);
});
