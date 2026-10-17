import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCongestion, defaultRuntimePreferences, effectiveSharePreferences, initialCongestion, normalizeRuntimePreferences, statisticsInterval } from './runtime-policy';

test('gaming overrides are reversible through repeated toggles and persisted restarts', () => {
  const preferred = { ...defaultRuntimePreferences, shareHeight: 1440 as const, shareFps: 60 as const, shareBitrateMbps: 12, voiceBitrateKbps: 64 };
  for (let index = 0; index < 10; index++) {
    assert.deepEqual(effectiveSharePreferences(preferred, true), { height: 720, fps: 30, bitrateMbps: 3 });
    const restarted = normalizeRuntimePreferences(JSON.parse(JSON.stringify(preferred)));
    assert.deepEqual(effectiveSharePreferences(restarted, false), { height: 1440, fps: 60, bitrateMbps: 12 });
    assert.equal(restarted.voiceBitrateKbps, 64);
  }
});
test('explicit edits while gaming update saved preference, then restore that new choice', () => {
  const preferred = normalizeRuntimePreferences({ ...defaultRuntimePreferences, shareHeight: 1080, shareFps: 15, shareBitrateMbps: 2 });
  assert.deepEqual(effectiveSharePreferences(preferred, true), { height: 720, fps: 15, bitrateMbps: 2 });
  assert.deepEqual(effectiveSharePreferences(preferred, false), { height: 1080, fps: 15, bitrateMbps: 2 });
  assert.deepEqual(effectiveSharePreferences(defaultRuntimePreferences, false), { height: 'native', fps: 60, bitrateMbps: 8 });
  assert.equal(statisticsInterval(true, false, true), 5000);
  assert.equal(statisticsInterval(false, false, false), 5000);
  assert.equal(statisticsInterval(false, false, true), 1000);
  assert.equal(statisticsInterval(false, true, true), 2000);
});
test('congestion limits video before voice, ignores stable distant RTT, and recovers with hysteresis', () => {
  let state = adaptCongestion(initialCongestion, 0, .6);
  state = adaptCongestion(state, 0, .6);
  assert.equal(state.videoLimited, false);
  state = adaptCongestion(state, .1, .8);
  assert.equal(state.videoLimited, true);
  assert.equal(state.voiceLimited, false);
  state = adaptCongestion(state, .1, .9);
  state = adaptCongestion(state, .1, .9);
  assert.equal(state.voiceLimited, true);
  for (let index = 0; index < 3; index++) state = adaptCongestion(state, 0, .6);
  assert.equal(state.voiceLimited, false);
  assert.equal(state.videoLimited, false);
  assert.equal(adaptCongestion(state, null, null), state);
});
