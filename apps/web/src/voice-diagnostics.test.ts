import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceDiagnostics, summarizeIceStats, type VoiceDiagnostic } from './voice-diagnostics';

const stats = (entries: Record<string, unknown>[]) => new Map(entries.map((entry, index) => [String(index), entry])) as unknown as RTCStatsReport;
// What Firefox reports when every connectivity check fails: candidates on both sides, no pair in use.
const firefoxFailure = stats([
  { type: 'local-candidate', candidateType: 'host', address: '192.168.1.20', port: 50000 },
  { type: 'local-candidate', candidateType: 'srflx', address: '198.51.100.7', port: 61000 },
  { type: 'remote-candidate', candidateType: 'host', address: '10.0.0.5', port: 40000 },
  { type: 'remote-candidate', candidateType: 'srflx', address: '203.0.113.9', port: 62000 },
  ...['failed', 'failed', 'failed', 'failed'].map(state => ({ type: 'candidate-pair', state, nominated: false })),
]);
const connection = (report = firefoxFailure) => ({
  connectionState: 'failed', iceConnectionState: 'failed', signalingState: 'stable', iceGatheringState: 'complete',
  getStats: async () => report,
}) as unknown as RTCPeerConnection;
const context = { peer: 'peer-socket', retryCount: 0, startedAt: 0, checkingSince: 0, everConnected: false, resettable: true };

test('ICE statistics are reduced to counts; addresses and ports are never copied', () => {
  const summary = summarizeIceStats(firefoxFailure);
  assert.deepEqual(summary, {
    pairs: { total: 4, failed: 4, succeeded: 0, inProgress: 0, waiting: 0, frozen: 0, selected: false },
    local: { host: 1, srflx: 1 }, remote: { host: 1, srflx: 1 },
  });
  assert.ok(!/192\.168|198\.51|10\.0|203\.0|port/.test(JSON.stringify(summary)));
  assert.equal(summarizeIceStats(stats([{ type: 'transport', selectedCandidatePairId: 'pair' }])).pairs.selected, true);
  assert.equal(summarizeIceStats(stats([{ type: 'candidate-pair', state: 'succeeded', selected: true }])).pairs.selected, true);
});

test('each failure is reported once per peer and retry, within a per-minute budget', async () => {
  let clock = 30_000;
  const sent: VoiceDiagnostic[] = [];
  const diagnostics = createVoiceDiagnostics(report => sent.push(report), { perMinute: 3, now: () => clock });
  assert.equal(await diagnostics.report('ice_failed', connection(), context), true);
  assert.equal(await diagnostics.report('ice_failed', connection(), context), false);
  assert.deepEqual({ ...sent[0], browser: undefined, client: undefined }, {
    v: 1, type: 'ice_failed', peer: 'peer-socket', connectionState: 'failed', iceState: 'failed', signalingState: 'stable', gatheringState: 'complete',
    retryCount: 0, durationMs: 30_000, checkingMs: 30_000, everConnected: false, resettable: true, browser: undefined, client: undefined,
    ...summarizeIceStats(firefoxFailure),
  });
  assert.equal(sent[0].client, 'web');
  await diagnostics.report('ice_failed', connection(), { ...context, retryCount: 1 });
  await diagnostics.report('recovery_failed', connection(), { ...context, retryCount: 1 });
  assert.equal(await diagnostics.report('retries_exhausted', connection(), { ...context, retryCount: 5 }), false);
  clock += 20_000;
  assert.equal(await diagnostics.report('retries_exhausted', connection(), { ...context, retryCount: 5 }), true);
  assert.equal(sent.length, 4);
  // A connection that is already closed still reports its states.
  const closed = { ...connection(), getStats: async () => { throw new Error('closed'); } } as unknown as RTCPeerConnection;
  clock += 60_000;
  assert.equal(await diagnostics.report('ice_timeout', closed, context), true);
  assert.equal(sent.at(-1)?.pairs, undefined);
});
