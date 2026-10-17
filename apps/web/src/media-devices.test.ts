import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreAudioDevices } from './media-devices';

test('named input and output devices recover origin-scoped IDs without guessing missing or ambiguous devices', () => {
  const settings = { inputDevice: 'old-mic', outputDevice: 'old-speaker', inputDeviceLabel: 'Selected mic', outputDeviceLabel: 'Selected speaker' };
  const devices = [{ kind: 'audioinput' as const, deviceId: 'new-mic', label: 'Selected mic' }, { kind: 'audiooutput' as const, deviceId: 'new-speaker', label: 'Selected speaker' }];
  assert.deepEqual(restoreAudioDevices(settings, devices), { inputDevice: 'new-mic', outputDevice: 'new-speaker' });
  assert.deepEqual(restoreAudioDevices(settings, []), {});
  assert.deepEqual(restoreAudioDevices(settings, [...devices, { ...devices[0], deviceId: 'other-mic' }]), { outputDevice: 'new-speaker' });
  assert.deepEqual(restoreAudioDevices({ ...settings, inputDevice: '', outputDevice: '' }, devices), {});
  assert.deepEqual(restoreAudioDevices({ ...settings, inputDevice: 'new-mic', outputDevice: 'new-speaker' }, devices), {});
});
