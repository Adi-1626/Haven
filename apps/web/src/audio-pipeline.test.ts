import test from 'node:test';
import assert from 'node:assert/strict';
import { createMicrophonePipeline, measureInput, microphoneCaptureConstraints, normalizeAudioSettings, SpeechGate, type AudioProcessingSettings } from './audio-pipeline';

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

class AudioNodeMock {
  gain = { value: 1, calls: 0, setTargetAtTime(value: number) { this.value = value; this.calls++; } };
  threshold = { value: 0 }; knee = { value: 0 }; ratio = { value: 0 }; attack = { value: 0 }; release = { value: 0 };
  fftSize = 1024;
  routes: AudioNodeMock[] = [];
  onprocessorerror: (() => void) | null = null;
  connect(node: AudioNodeMock) { this.routes.push(node); return node; }
  disconnect() { this.routes = []; }
  getFloatTimeDomainData(samples: Float32Array) { samples.fill(0); }
}
function pipelineFixture(options: AudioProcessingSettings, load?: () => Promise<{ node: AudioNode; stop(): void }>) {
  const source = new AudioNodeMock();
  const nodes: AudioNodeMock[] = [];
  const create = () => { const node = new AudioNodeMock(); nodes.push(node); return node; };
  const context = { currentTime: 0, createMediaStreamSource: () => source, createGain: create, createDynamicsCompressor: create, createAnalyser: create } as unknown as AudioContext;
  const constraints: MediaTrackConstraints[] = [];
  const stream = { getAudioTracks: () => [{ getSettings: () => ({ noiseSuppression: options.noiseSuppressionMode !== 'enhanced' }), applyConstraints: async (value: MediaTrackConstraints) => { constraints.push(value); } }] } as unknown as MediaStream;
  let enabled = true;
  const statuses: string[] = [];
  const pipeline = createMicrophonePipeline(context, stream, new AudioNodeMock() as unknown as AudioNode, () => options, () => enabled, () => {}, status => statuses.push(status), load);
  return { pipeline, source, nodes, constraints, statuses, mute: () => { enabled = false; pipeline.refresh(); } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('capture preserves AEC and native suppression without automatic gain amplification', () => {
  assert.deepEqual(microphoneCaptureConstraints({ inputDevice: 'usb', noiseSuppression: true, echoCancellation: true }), {
    deviceId: { exact: 'usb' }, noiseSuppression: true, echoCancellation: true, autoGainControl: false, channelCount: { ideal: 1 },
  });
  assert.equal(microphoneCaptureConstraints({ inputDevice: '', noiseSuppression: false, echoCancellation: true }).noiseSuppression, false);
});

test('PTT passes quiet speech while held, mute clears transmission, and stop is idempotent', () => {
  const setup = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, pushToTalk: true });
  const gate = setup.nodes.at(-1)!;
  assert.equal(gate.gain.value, 1);
  setup.mute();
  assert.equal(gate.gain.value, 0);
  setup.pipeline.stop();
  setup.pipeline.stop();
  assert.equal(setup.source.routes.length, 0);
  assert.ok(setup.nodes.every(node => node.routes.length === 0));
});

test('steady microphone sampling does not accumulate redundant gain automation', () => {
  const setup = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, pushToTalk: true });
  try {
    for (let index = 0; index < 1000; index++) setup.pipeline.refresh();
    assert.equal(setup.nodes[0].gain.calls, 1);
    assert.equal(setup.nodes.at(-1)!.gain.calls, 1);
    setup.mute();
    assert.equal(setup.nodes.at(-1)!.gain.calls, 2);
  } finally { setup.pipeline.stop(); }
});

test('switching microphones disposes a late denoiser without reconnecting the old microphone', async () => {
  let ready!: (processor: { node: AudioNode; stop(): void }) => void;
  let stopped = 0;
  const setup = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, noiseSuppression: true, noiseSuppressionMode: 'enhanced' }, () => new Promise(resolve => { ready = resolve; }));
  setup.pipeline.stop();
  const replacement = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, noiseSuppression: false });
  try {
    ready({ node: new AudioNodeMock() as unknown as AudioNode, stop: () => { stopped++; } });
    await flush();
    assert.equal(stopped, 1);
    assert.equal(setup.source.routes.length, 0);
    assert.equal(setup.constraints.length, 0);
    assert.equal(replacement.source.routes.length, 1);
    assert.equal(replacement.statuses.at(-1), 'off');
  } finally { replacement.pipeline.stop(); }
});

test('enhanced mode never transmits unprocessed startup audio, including while PTT is held', async () => {
  let ready!: (processor: { node: AudioNode; stop(): void }) => void;
  const setup = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, pushToTalk: true, noiseSuppression: true, noiseSuppressionMode: 'enhanced' }, () => new Promise(resolve => { ready = resolve; }));
  try {
    assert.equal(setup.nodes.at(-1)!.gain.value, 0);
    ready({ node: new AudioNodeMock() as unknown as AudioNode, stop() {} });
    await flush();
    assert.equal(setup.nodes.at(-1)!.gain.value, 1);
    setup.mute();
    assert.equal(setup.nodes.at(-1)!.gain.value, 0);
  } finally { setup.pipeline.stop(); }
});

test('enhanced suppression processes only non-native capture and requests fallback on processor failure', async () => {
  const denoiser = new AudioNodeMock();
  let stopped = 0;
  const setup = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, noiseSuppression: true, noiseSuppressionMode: 'enhanced' }, async () => ({ node: denoiser as unknown as AudioNode, stop: () => { stopped++; denoiser.disconnect(); } }));
  try {
    await flush();
    assert.equal(setup.source.routes[0], denoiser);
    assert.deepEqual(setup.constraints, []);
    assert.equal(setup.statuses.at(-1), 'rnnoise');
    denoiser.onprocessorerror!();
    await flush();
    assert.equal(setup.source.routes[0], setup.nodes[0]);
    assert.deepEqual(setup.constraints, []);
    assert.equal(setup.statuses.at(-1), 'fallback');
    assert.equal(stopped, 1);
  } finally { setup.pipeline.stop(); }
});

test('unsupported enhanced suppression requests native recapture and can be disabled cleanly', async () => {
  const setup = pipelineFixture({ inputVolume: 1, inputSensitivity: -45, noiseSuppression: true, noiseSuppressionMode: 'enhanced' }, async () => { throw new Error('Unavailable'); });
  try {
    await flush();
    assert.equal(setup.statuses.at(-1), 'fallback');
    assert.equal(setup.source.routes[0], setup.nodes[0]);
    assert.equal(setup.constraints.length, 0);
  } finally { setup.pipeline.stop(); }
});

test('level readings use actual waveform RMS and settings cannot amplify beyond the intended range', () => {
  const silence = measureInput(new Float32Array(1024));
  const voice = measureInput(new Float32Array(1024).fill(0.1));
  assert.equal(silence.level, 0);
  assert.ok(Math.abs(voice.decibels + 20) < 0.0001);
  assert.ok(voice.level > silence.level);
  assert.deepEqual(normalizeAudioSettings({ inputVolume: 20, inputSensitivity: -100, outputVolume: 5 }), { inputVolume: 2, inputSensitivity: -60, outputVolume: 1 });
  assert.deepEqual(normalizeAudioSettings({ inputVolume: NaN, inputSensitivity: Infinity, outputVolume: -2 }), { inputVolume: 1, inputSensitivity: -45, outputVolume: 0 });
});

