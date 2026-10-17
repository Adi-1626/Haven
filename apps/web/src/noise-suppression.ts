const workletUrl = new URL('../vendor/rnnoise/workletProcessor.js', import.meta.url).href;
const wasmUrl = new URL('../vendor/rnnoise/rnnoise.wasm', import.meta.url).href;
const initializationTimeout = 8_000;
const modules = new WeakMap<AudioContext, Promise<void>>();
let binary: Promise<ArrayBuffer> | undefined;

function bounded<T>(operation: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), initializationTimeout);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function loadBinary(): Promise<ArrayBuffer> {
  if (!binary) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), initializationTimeout);
    binary = bounded(fetch(wasmUrl, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`RNNoise download failed (${response.status})`);
      return response.arrayBuffer();
    }), 'RNNoise download timed out').finally(() => clearTimeout(timer)).catch(error => {
      binary = undefined;
      throw error;
    });
  }
  return binary;
}

/** A mono RNNoise stage. Callers own its graph connections and fallback policy. */
export async function createNoiseSuppressor(context: AudioContext): Promise<{ node: AudioNode; stop(): void }> {
  if (context.sampleRate !== 48_000) throw new Error('RNNoise requires a 48 kHz audio context');
  if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet is unavailable');
  let module = modules.get(context);
  if (!module) {
    module = bounded(context.audioWorklet.addModule(workletUrl), 'RNNoise worklet load timed out').catch(error => {
      modules.delete(context);
      throw error;
    });
    modules.set(context, module);
  }
  const [wasmBinary] = await Promise.all([loadBinary(), module]);
  const node = new AudioWorkletNode(context, '@sapphi-red/web-noise-suppressor/rnnoise', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { wasmBinary, maxChannels: 1 },
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    node.port.postMessage('destroy');
    node.port.onmessage = null;
    node.onprocessorerror = null;
    node.disconnect();
    node.port.close();
  };
  try {
    await bounded(new Promise<void>((resolve, reject) => {
      node.port.onmessage = event => {
        if (event.data?.type === 'ready') resolve();
        if (event.data?.type === 'error') reject(new Error('RNNoise initialization failed'));
      };
      node.onprocessorerror = () => reject(new Error('RNNoise processor failed'));
      node.port.start();
    }), 'RNNoise initialization timed out');
    node.port.onmessage = null;
    // A processor exception after startup must release its native state too.
    node.onprocessorerror = stop;
    return { node, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
