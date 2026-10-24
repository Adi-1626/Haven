import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputMonitor } from './input-monitor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(failure = '') {
  const tracks = [0, 0];
  const source = { onended: null as (() => void) | null, stop() { tracks[0]++; } };
  const outputTrack = { onended: null, stop() { tracks[1]++; } };
  const stream = { getTracks: () => [source] } as unknown as MediaStream;
  const output = { stream: { getTracks: () => [outputTrack] } } as unknown as MediaStreamAudioDestinationNode;
  const counts = { captures: 0, contexts: 0, closes: 0, pipelines: 0, stops: 0 };
  const capture = deferred<MediaStream>();
  const resumed = deferred<void>();
  let allowed = true;
  const monitor = createInputMonitor({
    canStart: () => allowed,
    capture: () => { counts.captures++; return failure === 'permission' ? Promise.reject(new Error('denied')) : capture.promise; },
    createContext: () => {
      counts.contexts++;
      if (failure === 'constructor') throw new Error('constructor');
      return {
        state: 'running',
        resume: () => failure === 'resume' ? Promise.reject(new Error('resume')) : resumed.promise,
        close: async () => { counts.closes++; },
        createMediaStreamDestination: () => { if (failure === 'output') throw new Error('output'); return output; },
      } as unknown as AudioContext;
    },
    createPipeline: () => {
      counts.pipelines++;
      if (failure === 'pipeline') throw new Error('pipeline');
      return { stop() { counts.stops++; } };
    },
  });
  return { monitor, counts, tracks, source, capture, resumed, stream, disallow() { allowed = false; } };
}

test('normal/concurrent monitor start owns one capture, pipeline and cleanup', async () => {
  const f = fixture();
  const first = f.monitor.start();
  assert.equal(f.monitor.start(), first);
  f.capture.resolve(f.stream); f.resumed.resolve(); await first;
  assert.equal(f.monitor.requested, true);
  assert.deepEqual(f.counts, { captures: 1, contexts: 1, closes: 0, pipelines: 1, stops: 0 });
  f.monitor.stop(); f.monitor.stop();
  assert.deepEqual(f.tracks, [1, 1]);
  assert.equal(f.counts.closes, 1); assert.equal(f.counts.stops, 1);
  assert.equal(f.source.onended, null);
});

test('stop before capture resolves disposes late tracks without creating a context', async () => {
  const f = fixture(); const pending = f.monitor.start();
  f.monitor.stop(); f.capture.resolve(f.stream); await pending;
  assert.deepEqual(f.tracks, [1, 0]);
  assert.equal(f.counts.contexts, 0); assert.equal(f.monitor.requested, false);
});

test('stop during resume releases resources immediately and never installs a pipeline', async () => {
  const f = fixture(); const pending = f.monitor.start();
  f.capture.resolve(f.stream); await Promise.resolve(); f.monitor.stop();
  assert.equal(f.tracks[0], 1); assert.equal(f.counts.closes, 1);
  f.resumed.resolve(); await pending;
  assert.equal(f.counts.pipelines, 0); assert.equal(f.counts.closes, 1);
});

for (const failure of ['permission', 'constructor', 'resume', 'output', 'pipeline']) {
  test(`monitor releases partial resources after ${failure} failure`, async () => {
    const f = fixture(failure); const pending = f.monitor.start();
    f.capture.resolve(f.stream); f.resumed.resolve(); await pending;
    assert.equal(f.monitor.requested, false);
    assert.equal(f.tracks[0], failure === 'permission' ? 0 : 1);
    assert.equal(f.counts.closes, ['permission', 'constructor'].includes(failure) ? 0 : 1);
    assert.equal(f.tracks[1], failure === 'pipeline' ? 1 : 0);
    f.monitor.stop();
  });
}

test('rapid stop/start never lets an old completion replace a new operation', async () => {
  const old = deferred<MediaStream>(); const fresh = deferred<MediaStream>();
  let captures = 0; let stopped = 0; let installed = 0;
  const stream = () => ({ getTracks: () => [{ onended: null, stop() { stopped++; } }] }) as unknown as MediaStream;
  const monitor = createInputMonitor({
    canStart: () => true, capture: () => ++captures === 1 ? old.promise : fresh.promise,
    createContext: () => ({ state: 'running', resume: async () => {}, close: async () => {}, createMediaStreamDestination: () => ({ stream: stream() }) }) as unknown as AudioContext,
    createPipeline: () => { installed++; return { stop() {} }; },
  });
  const a = monitor.start(); monitor.stop(); const b = monitor.start();
  fresh.resolve(stream()); await b; old.resolve(stream()); await a;
  assert.equal(installed, 1); assert.equal(monitor.requested, true);
  monitor.stop(); assert.equal(stopped, 3);
});

test('capture eligibility changes and ended tracks release monitoring', async () => {
  const f = fixture(); const pending = f.monitor.start();
  f.capture.resolve(f.stream); f.resumed.resolve(); await pending;
  f.source.onended!(); assert.equal(f.monitor.requested, false);
  assert.equal(f.counts.stops, 1);
  f.disallow(); await f.monitor.start(); assert.equal(f.counts.captures, 1);
});

test('a call or mic test taking ownership during capture cancels monitor startup', async () => {
  const f = fixture(); const pending = f.monitor.start(); f.disallow();
  f.capture.resolve(f.stream); await pending;
  assert.equal(f.counts.contexts, 0); assert.equal(f.tracks[0], 1);
  assert.equal(f.monitor.requested, false);
});

test('repeated completed start/stop cycles release every source and output track', async () => {
  let tracks = 0; let closes = 0; let stops = 0;
  const stream = () => ({ getTracks: () => [{ onended: null, stop() { tracks++; } }] }) as unknown as MediaStream;
  const monitor = createInputMonitor({
    canStart: () => true, capture: async () => stream(),
    createContext: () => ({ state: 'running', resume: async () => {}, close: async () => { closes++; }, createMediaStreamDestination: () => ({ stream: stream() }) }) as unknown as AudioContext,
    createPipeline: () => ({ stop() { stops++; } }),
  });
  for (let i = 0; i < 20; i++) { await monitor.start(); monitor.stop(); }
  assert.deepEqual({ tracks, closes, stops }, { tracks: 40, closes: 20, stops: 20 });
});
