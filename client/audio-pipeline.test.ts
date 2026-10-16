import test from 'node:test';
import assert from 'node:assert/strict';
import { measureInput, normalizeAudioSettings, SpeechGate } from './audio-pipeline';

test('speech gate preserves words through short pauses, applies hysteresis, and clears immediately on mute or PTT release', () => {
  const gate = new SpeechGate();
  assert.equal(gate.sample(-70, -45, true, 0), false);
  assert.equal(gate.sample(-35, -45, true, 50), true);
  assert.equal(gate.sample(-48, -45, true, 350), true);
  assert.equal(gate.sample(-70, -45, true, 800), true);
  assert.equal(gate.sample(-70, -45, true, 850), false);
  assert.equal(gate.sample(-30, -45, true, 900), true);
  assert.equal(gate.sample(-30, -45, false, 950), false);
  assert.equal(gate.sample(-70, -45, true, 1000), false);
});

test('level readings use actual waveform RMS and settings cannot amplify beyond the intended range', () => {
  const silence = measureInput(new Float32Array(1024));
  const voice = measureInput(new Float32Array(1024).fill(0.1));
  assert.equal(silence.level, 0);
  assert.ok(Math.abs(voice.decibels + 20) < 0.0001);
  assert.ok(voice.level > silence.level);
  assert.deepEqual(normalizeAudioSettings({ inputVolume: 20, inputSensitivity: -100 }), { inputVolume: 2, inputSensitivity: -60 });
  assert.deepEqual(normalizeAudioSettings({ inputVolume: NaN, inputSensitivity: Infinity }), { inputVolume: 1, inputSensitivity: -45 });
});
