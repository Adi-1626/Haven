import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBitrate, isCaptureCancellation, matchesShortcut, missingAudioDevice, releasesShortcut, voiceDescription } from './audio-policy';

test('screen picker cancellation is accepted across DOM and bridge error shapes', () => {
  for (const name of ['NotAllowedError', 'AbortError', 'NotFoundError']) assert.equal(isCaptureCancellation({ name }), true);
  assert.equal(isCaptureCancellation(new Error('Encoder failed')), false);
  assert.equal(isCaptureCancellation(null), false);
});

test('Opus uses mono, FEC, DTX and bounded voice bitrate without changing video codecs', () => {
  const sdp = 'v=0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=20;stereo=1;maxaveragebitrate=128000\r\na=rtpmap:96 VP8/90000\r\n';
  const result = voiceDescription({ type: 'offer', sdp }, true).sdp!;
  assert.match(result, /usedtx=1/);
  assert.match(result, /useinbandfec=1/);
  assert.match(result, /maxaveragebitrate=48000/);
  assert.doesNotMatch(result, /stereo=1/);
  assert.match(result, /a=rtpmap:96 VP8\/90000/);
  assert.equal(voiceDescription({ type: 'offer', sdp: result }, true).sdp, result);
  assert.equal(audioBitrate(false), 48_000);
  assert.equal(audioBitrate(true), audioBitrate(false));
  assert.equal(audioBitrate(true, true), 32_000);
  assert.equal(audioBitrate(false, false, 64), 64_000);
});

test('push to talk combinations match exact modifiers and configurable physical keys', () => {
  const event = { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
  assert.equal(matchesShortcut(event, 'Control+Shift+Space'), true);
  assert.equal(matchesShortcut({ ...event, altKey: true }, 'Control+Shift+Space'), false);
  assert.equal(matchesShortcut({ ...event, code: 'KeyV', key: 'v' }, 'Control+Shift+V'), true);
  assert.equal(matchesShortcut(event, 'Space'), false);
  assert.equal(releasesShortcut({ code: 'KeyE', key: 'e' }, 'Control+Shift+V'), false);
  assert.equal(releasesShortcut({ code: 'ShiftLeft', key: 'Shift' }, 'Control+Shift+V'), true);
  assert.equal(releasesShortcut({ code: 'KeyV', key: 'v' }, 'Control+Shift+V'), true);
  assert.equal(matchesShortcut({ ...event, code: 'ArrowLeft', key: 'ArrowLeft' }, 'Control+Shift+Left'), true);
  assert.equal(releasesShortcut({ code: 'ArrowLeft', key: 'ArrowLeft' }, 'Control+Shift+Left'), true);
});

test('device removal falls back only when an explicitly selected device is missing', () => {
  const devices = [{ kind: 'audioinput' as const, deviceId: 'mic' }, { kind: 'audiooutput' as const, deviceId: 'speakers' }];
  assert.equal(missingAudioDevice(devices, 'audioinput', 'mic'), false);
  assert.equal(missingAudioDevice(devices, 'audioinput', 'old'), true);
  assert.equal(missingAudioDevice([], 'audioinput', ''), false);
});
