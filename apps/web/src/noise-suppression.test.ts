import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createNoiseSuppressor } from './noise-suppression';

test('RNNoise waits for readiness, caches assets, and releases failed and stopped nodes', async t => {
  const originalFetch = globalThis.fetch;
  const originalNode = globalThis.AudioWorkletNode;
  let fetches = 0;
  let modules = 0;
  let mode: 'ready' | 'error' | 'processorerror' | 'pending' = 'ready';
  let downloadFails = true;
  let moduleFails = true;
  const nodes: FakeNode[] = [];
  class FakeNode {
    onprocessorerror: (() => void) | null = null;
    messages: unknown[] = [];
    disconnected = 0;
    closed = 0;
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (data: unknown) => this.messages.push(data),
      close: () => this.closed++,
      start: () => queueMicrotask(() => {
        if (mode === 'pending') return;
        if (mode === 'processorerror') this.onprocessorerror?.();
        else this.port.onmessage?.({ data: { type: mode } });
      }),
    };
    constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) {
      assert.equal(name, '@sapphi-red/web-noise-suppressor/rnnoise');
      assert.deepEqual(options.outputChannelCount, [1]);
      assert.equal(options.processorOptions.maxChannels, 1);
      nodes.push(this);
    }
    disconnect() { this.disconnected++; }
  }
  globalThis.fetch = (async () => {
    fetches++;
    if (downloadFails) throw new Error('offline');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
  }) as typeof fetch;
  globalThis.AudioWorkletNode = FakeNode as unknown as typeof AudioWorkletNode;
  const context = {
    sampleRate: 48_000,
    audioWorklet: { addModule: async (url: string) => { assert.match(url, /workletProcessor\.js$/); modules++; if (moduleFails) throw new Error('offline'); } },
  } as unknown as AudioContext;
  try {
    await assert.rejects(createNoiseSuppressor(context), /offline/);
    downloadFails = false;
    moduleFails = false;
    const first = await createNoiseSuppressor(context);
    const second = await createNoiseSuppressor(context);
    assert.equal(fetches, 2);
    assert.equal(modules, 2);
    first.stop(); first.stop(); second.stop();
    assert.deepEqual(nodes[0].messages, ['destroy']);
    assert.equal(nodes[0].disconnected, 1);
    assert.equal(nodes[0].closed, 1);
    mode = 'error';
    await assert.rejects(createNoiseSuppressor(context), /initialization failed/);
    assert.deepEqual(nodes[2].messages, ['destroy']);
    mode = 'processorerror';
    await assert.rejects(createNoiseSuppressor(context), /processor failed/);
    assert.equal(nodes[3].closed, 1);
    mode = 'pending';
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = createNoiseSuppressor(context);
    const timeout = assert.rejects(pending, /initialization timed out/);
    await new Promise<void>(done => setImmediate(done));
    t.mock.timers.tick(8_000);
    await timeout;
    assert.equal(nodes[4].closed, 1);
    t.mock.timers.reset();
    await assert.rejects(createNoiseSuppressor({ sampleRate: 44_100 } as AudioContext), /48 kHz/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.AudioWorkletNode = originalNode;
  }
});

test('vendored processor destroys late native initialization and reports readiness or failure', async () => {
  const source = await readFile(new URL('../vendor/rnnoise/workletProcessor.js', import.meta.url), 'utf8');
  const suffix = source.slice(source.indexOf('// Haven patch:'), source.indexOf('/*! Bundled license information:'));
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  let destroyed = 0;
  let Processor!: new (options: unknown) => { process(inputs: unknown[], outputs: unknown[]): boolean; destroy(): void; port: { listener: (event: unknown) => void; messages: unknown[]; started: boolean } };
  const sandbox = {
    q: { loadBinary: () => new Promise((yes, no) => { resolve = yes; reject = no; }) },
    me: () => ({ destroy: () => destroyed++, process: () => undefined }),
    Se: 'rnnoise',
    AudioWorkletProcessor: class { port = { messages: [] as unknown[], started: false, listener: (_event: unknown) => {}, addEventListener(_type: string, listener: (event: unknown) => void) { this.listener = listener; }, start() { this.started = true; }, postMessage(message: unknown) { this.messages.push(message); } }; },
    registerProcessor: (_name: string, constructor: typeof Processor) => { Processor = constructor; },
  };
  vm.runInNewContext(suffix, sandbox);
  const options = { processorOptions: { wasmBinary: new ArrayBuffer(8), maxChannels: 1 } };
  const late = new Processor(options);
  assert.equal(late.port.started, true);
  late.port.listener({ data: 'destroy' });
  resolve({}); await new Promise<void>(done => setImmediate(done));
  assert.equal(destroyed, 1);
  assert.equal(late.process([], []), false);
  assert.equal(late.port.messages.length, 0);
  const ready = new Processor(options);
  resolve({}); await new Promise<void>(done => setImmediate(done));
  assert.equal((ready.port.messages[0] as { type: string }).type, 'ready');
  ready.destroy(); ready.destroy();
  assert.equal(destroyed, 2);
  const failed = new Processor(options);
  reject(new Error('bad WASM')); await new Promise<void>(done => setImmediate(done));
  assert.equal((failed.port.messages[0] as { type: string }).type, 'error');
  assert.equal(failed.process([], []), false);
});

test('vendored WASM initializes and processes finite mono audio', { timeout: 5_000 }, async () => {
  const source = await readFile(new URL('../vendor/rnnoise/workletProcessor.js', import.meta.url), 'utf8');
  const wasm = await readFile(new URL('../vendor/rnnoise/rnnoise.wasm', import.meta.url));
  let Processor!: new (options: unknown) => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; destroy(): void };
  let ready!: () => void;
  let failed!: (error: Error) => void;
  const initialized = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
  vm.runInNewContext(source.replaceAll('import.meta.url', '"https://localhost/workletProcessor.js"'), {
    WebAssembly, console, TextDecoder, TextEncoder,
    AudioWorkletProcessor: class {
      port = {
        addEventListener() {}, start() {},
        postMessage(message: { type: string }) {
          if (message.type === 'ready') ready();
          else failed(new Error('Vendored WASM could not initialize'));
        },
      };
    },
    registerProcessor: (_name: string, constructor: typeof Processor) => { Processor = constructor; },
  });
  const processor = new Processor({ processorOptions: { wasmBinary: wasm, maxChannels: 1 } });
  await initialized;
  try {
    const input = new Float32Array(128).fill(0.05);
    const output = new Float32Array(128);
    for (let i = 0; i < 100; i++) {
      assert.equal(processor.process([[input]], [[output]]), true);
      assert.ok(output.every(Number.isFinite));
    }
  } finally {
    processor.destroy();
  }
  assert.equal(processor.process([], []), false);
});
