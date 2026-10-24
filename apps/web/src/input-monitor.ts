interface MonitorPipeline { stop(): void }
interface MonitorOptions {
  canStart(): boolean;
  capture(): Promise<MediaStream>;
  createContext(): AudioContext;
  createPipeline(context: AudioContext, stream: MediaStream, output: MediaStreamAudioDestinationNode): MonitorPipeline;
}

/** Owns only the optional input monitor, never the call or microphone test. */
export function createInputMonitor(options: MonitorOptions) {
  type Operation = {
    stream?: MediaStream;
    context?: AudioContext;
    output?: MediaStreamAudioDestinationNode;
    pipeline?: MonitorPipeline;
    disposed: boolean;
    promise?: Promise<void>;
  };
  let current: Operation | undefined;
  const dispose = (operation: Operation) => {
    if (operation.disposed) return;
    operation.disposed = true;
    try { operation.pipeline?.stop(); } catch {}
    for (const stream of [operation.stream, operation.output?.stream]) {
      for (const track of stream?.getTracks() ?? []) {
        track.onended = null;
        try { track.stop(); } catch {}
      }
    }
    const context = operation.context;
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}); } catch {}
    }
  };
  const stop = () => {
    const operation = current;
    current = undefined; // Invalidate before closing resources or awaiting permission.
    if (operation) dispose(operation);
  };
  const start = (): Promise<void> => {
    if (current) return current.promise!;
    if (!options.canStart()) return Promise.resolve();
    const operation: Operation = { disposed: false };
    current = operation;
    const valid = () => current === operation && !operation.disposed && options.canStart();
    operation.promise = (async () => {
      let captured: MediaStream | undefined;
      try {
        captured = await options.capture();
        if (!valid()) {
          // Stop may already have disposed this operation before capture resolved.
          captured.getTracks().forEach(track => { track.onended = null; track.stop(); });
          return;
        }
        operation.stream = captured;
        operation.context = options.createContext();
        await operation.context.resume();
        if (!valid()) return;
        operation.output = operation.context.createMediaStreamDestination();
        operation.pipeline = options.createPipeline(operation.context, captured, operation.output);
        for (const track of captured.getTracks()) track.onended = () => { if (current === operation) stop(); };
      } catch {
        // Permission denial and partial initialization both release owned resources.
        if (current === operation) current = undefined;
      } finally {
        if (!valid() || !operation.pipeline) {
          if (current === operation) current = undefined;
          dispose(operation);
        }
      }
    })();
    return operation.promise;
  };
  return { start, stop, get requested() { return current !== undefined; } };
}
