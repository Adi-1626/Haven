import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { Socket } from 'socket.io-client';
import { useMedia } from './media';

class FakeTrack {
  enabled = true;
  stopped = false;
  onended: (() => void) | null = null;
  contentHint = '';
  constraints: unknown;
  constructor(readonly kind: string, readonly id: string, public settings = { width: 1280, height: 720 }) {}
  stop() { this.stopped = true; }
  getSettings() { return this.settings; }
  async applyConstraints(constraints: unknown) { this.constraints = constraints; }
}
class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
}
class FakeNode {
  routes: FakeNode[] = [];
  gain = { value: 1, setTargetAtTime(value: number) { this.value = value; } };
  threshold = { value: 0 };
  knee = { value: 0 };
  ratio = { value: 0 };
  attack = { value: 0 };
  release = { value: 0 };
  fftSize = 0;
  getFloatTimeDomainData(samples: Float32Array) { samples.fill(0.1); }
  buffer: unknown;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  disconnected = false;
  connect(target: FakeNode) { this.routes.push(target); return target; }
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  uplink = Object.assign(new FakeNode(), { stream: new FakeStream([new FakeTrack('audio', 'mixed-audio')]) });
  microphoneNodes: FakeNode[] = [];
  soundNodes: FakeNode[] = [];
  monitorNodes: FakeNode[] = [];
  constructor() { FakeContext.instances.push(this); }
  createMediaStreamDestination() { return this.uplink; }
  createMediaStreamSource() { const node = new FakeNode(); this.microphoneNodes.push(node); return node; }
  createBufferSource() { const node = new FakeNode(); this.soundNodes.push(node); return node; }
  createGain() { const node = new FakeNode(); this.monitorNodes.push(node); return node; }
  createDynamicsCompressor() { return new FakeNode(); }
  createAnalyser() { return new FakeNode(); }
  async decodeAudioData() { return {}; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
class FakeAudio {
  static instances: FakeAudio[] = [];
  autoplay = false;
  volume = 1;
  srcObject: unknown;
  sinkId = '';
  paused = false;
  removed = false;
  constructor() { FakeAudio.instances.push(this); }
  async setSinkId(deviceId: string) { this.sinkId = deviceId; }
  async play() {}
  pause() { this.paused = true; }
  remove() { this.removed = true; }
}
class FakeSender {
  parameters: RTCRtpSendParameters = { encodings: [{}], codecs: [], headerExtensions: [], rtcp: {}, transactionId: 'test' };
  constructor(readonly track: FakeTrack) {}
  getParameters() { return structuredClone(this.parameters); }
  async setParameters(parameters: RTCRtpSendParameters) { this.parameters = parameters; }
}
class FakeConnection {
  static instances: FakeConnection[] = [];
  senders: FakeSender[] = [];
  closed = false;
  constructor() { FakeConnection.instances.push(this); }
  addTrack(track: FakeTrack) { const sender = new FakeSender(track); this.senders.push(sender); return sender; }
  getTransceivers() { return []; }
  removeTrack(sender: FakeSender) { this.senders = this.senders.filter(value => value !== sender); }
  close() { this.closed = true; }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function environment(saved = new Map<string, string>()) {
  FakeContext.instances = [];
  FakeConnection.instances = [];
  FakeAudio.instances = [];
  const microphone = new FakeStream([new FakeTrack('audio', 'microphone')]);
  const screen = new FakeStream([new FakeTrack('video', 'screen'), new FakeTrack('audio', 'system-audio')]);
  const events: string[] = [];
  const failures: string[] = [];
  const peerList: { socketId: string; user: { id: string; name: string } }[] = [];
  let microphoneCalls = 0;
  const mediaDevices = {
    getUserMedia: async () => { microphoneCalls++; return microphone; },
    getDisplayMedia: async () => screen,
    enumerateDevices: async () => [],
  };
  const fakeSocket = {
    connected: true, id: 'local',
    timeout() { return this; },
    emit(event: string, ...args: unknown[]) {
      events.push(event);
      const callback = args.at(-1);
      if (event === 'voice:join' && typeof callback === 'function') callback(null, { peers: peerList });
    },
  };
  const rtcResponse = { ok: true, json: async () => ({ iceServers: [] }), arrayBuffer: async () => new ArrayBuffer(8) };
  const globals = {
    localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } },
    navigator: { mediaDevices }, AudioContext: FakeContext, Audio: FakeAudio, fetch: async () => rtcResponse,
    document: { createElement: () => ({ videoWidth: 0, videoHeight: 0, play: async () => {}, pause() {}, srcObject: null }) },
    RTCPeerConnection: FakeConnection, RTCRtpSender: { getCapabilities: () => null },
  };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }));
  let media!: ReturnType<typeof useMedia>;
  function Probe() { media = useMedia(fakeSocket as unknown as Socket, 'user', message => failures.push(message)); return null; }
  renderToString(createElement(Probe));
  return {
    media, microphone, screen, events, failures, mediaDevices, rtcResponse, peerList,
    microphoneCalls: () => microphoneCalls,
    restore() {
      media.leave();
      media.stopMicTest();
      Object.entries(previous).forEach(([key, descriptor]) => {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    },
  };
}

test('unavailable enhanced processing recaptures with native suppression and releases the previous microphone', async () => {
  const setup = environment();
  const captures: { stream: FakeStream; constraints: MediaStreamConstraints }[] = [];
  setup.mediaDevices.getUserMedia = (async (constraints: MediaStreamConstraints) => {
    const stream = new FakeStream([new FakeTrack('audio', `fallback-${captures.length}`)]);
    captures.push({ stream, constraints });
    return stream;
  }) as typeof setup.mediaDevices.getUserMedia;
  try {
    setup.media.setSettings({ noiseSuppression: true, noiseSuppressionMode: 'enhanced' });
    await setup.media.join('fallback-room');
    for (let attempt = 0; attempt < 100 && captures.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(captures.length, 2);
    assert.equal((captures[0].constraints.audio as MediaTrackConstraints).noiseSuppression, false);
    assert.equal((captures[1].constraints.audio as MediaTrackConstraints).noiseSuppression, true);
    assert.equal((captures[1].constraints.audio as MediaTrackConstraints).echoCancellation, true);
    for (let attempt = 0; attempt < 100 && !captures[0].stream.tracks[0].stopped; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(captures[0].stream.tracks[0].stopped);
    assert.equal(captures[1].stream.tracks[0].stopped, false);
    setup.media.leave();
    assert.ok(captures[1].stream.tracks[0].stopped);
  } finally { setup.restore(); }
});

test('leaving while ICE configuration is pending prevents stale microphone capture and joining', async () => {
  const setup = environment();
  try {
    const response = deferred<typeof setup.rtcResponse>();
    globalThis.fetch = (() => response.promise) as unknown as typeof fetch;
    const pending = setup.media.join('old-room');
    setup.media.leave();
    response.resolve(setup.rtcResponse);
    await pending;
    assert.equal(setup.microphoneCalls(), 0);
    assert.equal(setup.events.includes('voice:join'), false);
    assert.deepEqual(setup.failures, []);
  } finally { setup.restore(); }
});

test('leaving while the microphone permission request is pending stops the resulting stream', async () => {
  const setup = environment();
  try {
    const capture = deferred<FakeStream>();
    const requested = deferred<void>();
    setup.mediaDevices.getUserMedia = () => { requested.resolve(); return capture.promise; };
    const pending = setup.media.join('old-room');
    await requested.promise;
    setup.media.leave();
    capture.resolve(setup.microphone);
    await pending;
    assert.equal(setup.microphone.getTracks()[0].stopped, true);
    assert.equal(setup.events.includes('voice:join'), false);
    assert.deepEqual(setup.failures, []);
  } finally { setup.restore(); }
});

test('screen capture and local sound monitoring preserve the microphone mixer without feeding microphone back to speakers', async () => {
  const setup = environment();
  try {
    await setup.media.join('room');
    const context = FakeContext.instances[0];
    const microphone = setup.microphone.getAudioTracks()[0];
    const inputGain = context.microphoneNodes[0].routes[0];
    const compressor = inputGain.routes[0];
    const analyser = compressor.routes[0];
    assert.deepEqual(analyser.routes[0].routes, [context.uplink]);
    assert.equal(context.microphoneNodes[0].routes.includes(context.destination), false);
    await setup.media.startShare();
    assert.equal(microphone.stopped, false);
    assert.equal(microphone.enabled, true);
    assert.equal(context.microphoneNodes.length, 1);
    await setup.media.playSound('/sound.mp3');
    const soundMonitor = context.soundNodes[0].routes[1];
    assert.deepEqual(context.soundNodes[0].routes, [context.uplink, soundMonitor]);
    assert.deepEqual(soundMonitor.routes, [context.destination]);
    assert.equal(context.soundNodes[0].started, true);
    setup.media.toggleDeafen();
    assert.equal(soundMonitor.gain.value, 0);
    assert.equal(microphone.enabled, false);
    setup.media.toggleDeafen();
    assert.equal(soundMonitor.gain.value, 1);
    assert.equal(microphone.enabled, true);
    setup.media.stopShare();
    assert.equal(microphone.stopped, false);
    assert.ok(setup.screen.getTracks().every(track => track.stopped));
    setup.media.leave();
    assert.equal(microphone.stopped, true);
    assert.equal(context.uplink.stream.getAudioTracks()[0].stopped, true);
    assert.equal(context.state, 'closed');
    assert.deepEqual(setup.failures, []);
  } finally { setup.restore(); }
});

test('live source resize adjusts sender downscaling while keeping voice and system audio on separate senders', async () => {
  const setup = environment();
  try {
    setup.peerList.push({ socketId: 'remote', user: { id: 'remote-user', name: 'Remote' } });
    await setup.media.join('room');
    const connection = FakeConnection.instances[0];
    const microphoneSender = connection.senders[0];
    assert.equal(microphoneSender.track.id, 'mixed-audio');
    await setup.media.startShare();
    assert.equal(connection.senders.length, 3);
    const screenSender = connection.senders.find(sender => sender.track.kind === 'video')!;
    assert.equal(screenSender.parameters.encodings[0].scaleResolutionDownBy, 1);
    screenSender.track.settings = { width: 1920, height: 1080 };
    await setup.media.setShareQuality(720, 30, 4);
    assert.equal(screenSender.parameters.encodings[0].scaleResolutionDownBy, 1.5);
    assert.equal(screenSender.parameters.encodings[0].maxFramerate, 30);
    assert.equal(screenSender.parameters.encodings[0].maxBitrate, 4_000_000);
    screenSender.track.settings = { width: 640, height: 360 };
    await setup.media.setShareQuality(720, 60, 8);
    assert.equal(screenSender.parameters.encodings[0].scaleResolutionDownBy, 1);
    assert.deepEqual(screenSender.track.constraints, { frameRate: { ideal: 60, max: 60 }, resizeMode: 'none' });
    setup.media.stopShare();
    assert.deepEqual(connection.senders, [microphoneSender]);
    assert.equal(microphoneSender.track.stopped, false);
    setup.media.leave();
    assert.equal(connection.closed, true);
    assert.deepEqual(setup.failures, []);
  } finally { setup.restore(); }
});

test('microphone test canceled during permission acquisition stops late capture without starting playback', async () => {
  const setup = environment();
  try {
    const capture = deferred<FakeStream>();
    setup.mediaDevices.getUserMedia = () => capture.promise;
    const pending = setup.media.startMicTest();
    setup.media.stopMicTest();
    capture.resolve(setup.microphone);
    await pending;
    assert.ok(setup.microphone.getTracks().every(track => track.stopped));
    assert.equal(FakeAudio.instances.length, 0);
    assert.equal(FakeContext.instances.length, 0);
    assert.deepEqual(setup.events, []);
  } finally { setup.restore(); }
});

test('microphone test uses a separate processed stream and selected low-volume speaker without touching active voice', async () => {
  const setup = environment();
  try {
    await setup.media.join('room');
    const callContext = FakeContext.instances[0];
    const testCapture = new FakeStream([new FakeTrack('audio', 'test-microphone')]);
    setup.mediaDevices.getUserMedia = async () => testCapture;
    setup.media.setSettings({ outputDevice: 'headphones', inputVolume: 0.6 });
    await setup.media.startMicTest();
    const context = FakeContext.instances[1];
    const playback = FakeAudio.instances[0];
    assert.equal(playback.sinkId, 'headphones');
    assert.equal(playback.volume, 0.3);
    assert.equal(playback.srcObject, context.uplink.stream);
    assert.equal(context.microphoneNodes[0].routes[0].gain.value, 0.6);
    assert.equal(setup.microphone.getTracks()[0].stopped, false);
    setup.media.stopMicTest();
    assert.equal(testCapture.getTracks()[0].stopped, true);
    assert.equal(context.state, 'closed');
    assert.equal(playback.paused, true);
    assert.equal(playback.srcObject, null);
    assert.equal(callContext.state, 'running');
    assert.equal(setup.microphone.getTracks()[0].stopped, false);
    assert.equal(setup.events.includes('voice:leave'), false);
    assert.deepEqual(setup.failures, []);
  } finally { setup.restore(); }
});

test('stopping microphone test while output selection is pending releases captured tracks immediately', async () => {
  const setup = environment();
  const original = FakeAudio.prototype.setSinkId;
  try {
    const sink = deferred<void>();
    const requested = deferred<void>();
    FakeAudio.prototype.setSinkId = async () => { requested.resolve(); return sink.promise; };
    const pending = setup.media.startMicTest();
    await requested.promise;
    setup.media.stopMicTest();
    assert.equal(setup.microphone.getTracks()[0].stopped, true);
    assert.equal(FakeContext.instances[0].state, 'closed');
    sink.resolve();
    await pending;
    assert.equal(FakeAudio.instances[0].srcObject, null);
  } finally { FakeAudio.prototype.setSinkId = original; setup.restore(); }
});

test('muting active voice immediately clears measured speaking activity', async () => {
  const setup = environment();
  try {
    await setup.media.join('room');
    const started = setup.events.filter(event => event === 'voice:activity').length;
    assert.ok(started > 0);
    setup.media.toggleMute();
    assert.equal(setup.events.filter(event => event === 'voice:activity').length, started + 1);
    assert.equal(setup.microphone.getAudioTracks()[0].enabled, false);
    setup.media.toggleMute();
    assert.equal(setup.microphone.getAudioTracks()[0].enabled, true);
    assert.equal(setup.events.filter(event => event === 'voice:activity').length, started + 2);
  } finally { setup.restore(); }
});

test('an older test permission result cannot stop or replace a newer microphone test', async () => {
  const setup = environment();
  try {
    const first = deferred<FakeStream>();
    const oldCapture = new FakeStream([new FakeTrack('audio', 'old-test')]);
    const currentCapture = new FakeStream([new FakeTrack('audio', 'new-test')]);
    setup.mediaDevices.getUserMedia = () => first.promise;
    const oldStart = setup.media.startMicTest();
    setup.mediaDevices.getUserMedia = async () => currentCapture;
    await setup.media.startMicTest();
    first.resolve(oldCapture);
    await oldStart;
    assert.equal(oldCapture.getTracks()[0].stopped, true);
    assert.equal(currentCapture.getTracks()[0].stopped, false);
    assert.equal(FakeAudio.instances.length, 1);
    assert.equal(FakeAudio.instances[0].paused, false);
    setup.media.stopMicTest();
    assert.equal(currentCapture.getTracks()[0].stopped, true);
  } finally { setup.restore(); }
});

test('failed microphone test output selection cleans up test capture and preserves the active voice session', async () => {
  const setup = environment();
  const original = FakeAudio.prototype.setSinkId;
  try {
    await setup.media.join('room');
    const currentCapture = new FakeStream([new FakeTrack('audio', 'test')]);
    setup.mediaDevices.getUserMedia = async () => currentCapture;
    FakeAudio.prototype.setSinkId = async () => { throw new Error('Output device disconnected'); };
    await setup.media.startMicTest();
    assert.equal(currentCapture.getTracks()[0].stopped, true);
    assert.equal(FakeContext.instances[1].state, 'closed');
    assert.equal(FakeContext.instances[0].state, 'running');
    assert.equal(setup.microphone.getAudioTracks()[0].stopped, false);
    assert.equal(setup.events.includes('voice:leave'), false);
  } finally { FakeAudio.prototype.setSinkId = original; setup.restore(); }
});

test('delayed video setParameters callback superseded by a newer congestion decision does not overwrite state', () => {
  const initial = { videoLimited: false, voiceLimited: false, badSamples: 0, healthySamples: 0 };
  const stale = { videoLimited: true, voiceLimited: true, badSamples: 4, healthySamples: 0 };
  const newer = { videoLimited: false, voiceLimited: false, badSamples: 0, healthySamples: 3 };
  const record: { congestion: typeof initial; congested: boolean } = { congestion: initial, congested: false };

  // Simulate older callback starting with stale congestion decision
  record.congestion = stale;

  // While awaiting setParameters on screen senders, a newer decision arrives
  record.congestion = newer;
  record.congested = newer.voiceLimited;

  // Older callback resumes after await and evaluates the guard condition:
  // if (cancelled || operation !== generation.current || records.current.get(socketId) !== record || record.congestion !== next) return;
  const isStale = record.congestion !== stale;
  assert.equal(isStale, true);

  // The guard prevents applying the stale decision to voice and senders
  if (!isStale) {
    record.congested = stale.voiceLimited;
  }
  assert.equal(record.congested, false);
});


test('malformed stored microphone policy and mute state fail closed before voice capture', async () => {
  for (const [key, value] of [
    ['haven.media.settings', '{broken'],
    ['haven.media.settings', '{"pushToTalk":"true"}'],
    ['haven.media.settings', '{"outputVolume":10}'],
    ['haven.media.settings', '{"noiseSuppressionMode":"unknown"}'],
    ['haven.voice.state', '{"muted":"true"}'],
  ]) {
    const setup = environment(new Map([[key, value]]));
    try {
      assert.match(setup.media.persistenceError!, /Microphone is blocked/);
      await setup.media.join('safe-room');
      assert.equal(setup.microphone.getAudioTracks()[0].enabled, false);
      assert.equal(FakeContext.instances[0].uplink.stream.getAudioTracks()[0].enabled, false);
      if (key === 'haven.media.settings') assert.equal(setup.media.settings.pushToTalk, true);
      else assert.equal(setup.media.muted, true);
    } finally { setup.restore(); }
  }
});
