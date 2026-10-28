import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedPairRelayed } from './relay-path';

const report = (...stats: object[]) => new Map(stats.map((stat: any) => [stat.id, stat])) as unknown as RTCStatsReport;
const candidates = (local: string, remote: string) => [
  { id: 'L', type: 'local-candidate', candidateType: local },
  { id: 'R', type: 'remote-candidate', candidateType: remote },
  { id: 'L2', type: 'local-candidate', candidateType: 'relay' },
];

test('Chromium: the transport\'s selected pair decides, on either side', () => {
  const pair = { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', state: 'succeeded' };
  // An unselected relay pair exists, but the selected pair is direct.
  const backup = { id: 'B', type: 'candidate-pair', localCandidateId: 'L2', remoteCandidateId: 'R', state: 'succeeded' };
  assert.equal(selectedPairRelayed(report({ id: 'T', type: 'transport', selectedCandidatePairId: 'P' }, pair, backup, ...candidates('host', 'srflx'))), false);
  assert.equal(selectedPairRelayed(report({ id: 'T', type: 'transport', selectedCandidatePairId: 'P' }, pair, ...candidates('host', 'relay'))), true, 'viewer behind TURN');
  assert.equal(selectedPairRelayed(report({ id: 'T', type: 'transport', selectedCandidatePairId: 'P' }, pair, ...candidates('relay', 'prflx'))), true, 'sharer behind TURN');
});

test('Firefox: the flagged or nominated succeeded pair decides', () => {
  assert.equal(selectedPairRelayed(report({ id: 'P', type: 'candidate-pair', selected: true, localCandidateId: 'L', remoteCandidateId: 'R' }, ...candidates('relay', 'host'))), true);
  assert.equal(selectedPairRelayed(report({ id: 'P', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L', remoteCandidateId: 'R' }, ...candidates('srflx', 'host'))), false);
  assert.equal(selectedPairRelayed(report({ id: 'P', type: 'candidate-pair', nominated: true, state: 'in-progress', localCandidateId: 'L', remoteCandidateId: 'R' }, ...candidates('relay', 'host'))), undefined);
});

test('missing data is unknown, never "relayed": direct viewers are not degraded on a gap', () => {
  assert.equal(selectedPairRelayed(undefined), undefined);
  assert.equal(selectedPairRelayed(report()), undefined);
  assert.equal(selectedPairRelayed(report({ id: 'T', type: 'transport' }, ...candidates('relay', 'relay'))), undefined, 'still checking');
  assert.equal(selectedPairRelayed(report({ id: 'T', type: 'transport', selectedCandidatePairId: 'gone' })), undefined);
  assert.equal(selectedPairRelayed(report({ id: 'T', type: 'transport', selectedCandidatePairId: 'P' }, { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'missing' }, ...candidates('host', 'host'))), undefined);
});
