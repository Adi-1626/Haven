export interface PeerConnectionStatistics {
  socketId: string;
  name: string;
  state: RTCPeerConnectionState;
  rttMs: number | null;
  rttSource: 'ice' | 'audio' | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  sampledAt: number | null;
  deliveryDelayMs?: number;
  stale?: boolean;
}

export interface ConnectionStatsSource {
  socketId: string;
  name: string;
  connection: Pick<RTCPeerConnection, 'connectionState' | 'getStats'>;
}

type Stat = { id: string; type: string; [key: string]: unknown };
export type PacketHistory = Map<string, { received: number; lost: number }>;
const measurementHistories = new WeakMap<PacketHistory, Map<string, { value: number; changedAt: number }>>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const milliseconds = (value: unknown) => finite(value) && value >= 0 ? value * 1000 : null;

/** WebRTC reports seconds and cumulative packet counters; expose milliseconds and interval loss. */
export function readConnectionStatistics(source: ConnectionStatsSource, report: RTCStatsReport, history: PacketHistory, context: { now?: number; deliveryDelayMs?: number; maxAgeMs?: number } = {}): PeerConnectionStatistics {
  const now = context.now ?? Date.now();
  const maxAge = context.maxAgeMs ?? 15_000;
  let measurements = measurementHistories.get(history);
  if (!measurements) { measurements = new Map(); measurementHistories.set(history, measurements); }
  let stale = false;
  function fresh(stat: Stat | undefined, counter?: unknown) {
    if (!stat) return false;
    if (finite(counter) && counter <= 0) return false;
    // Some browsers report epoch timestamps; others use performance.timeOrigin.
    if (finite(stat.timestamp)) {
      const timestamp = stat.timestamp > 1e12 ? stat.timestamp : (typeof performance !== 'undefined' ? performance.timeOrigin : 0) + stat.timestamp;
      if (now - timestamp > maxAge) { stale = true; return false; }
    }
    if (finite(counter)) {
      const previous = measurements!.get(stat.id);
      if (!previous || previous.value !== counter) measurements!.set(stat.id, { value: counter, changedAt: now });
      else if (now - previous.changedAt > maxAge) { stale = true; return false; }
    }
    return true;
  }
  const stats: Stat[] = [];
  report.forEach(stat => stats.push(stat as Stat));
  const transport = stats.find(stat => stat.type === 'transport' && typeof stat.selectedCandidatePairId === 'string');
  const pair = transport ? stats.find(stat => stat.id === transport.selectedCandidatePairId) : stats.find(stat => stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated === true);
  const audio = stats.filter(stat => stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio') && !stat.isRemote);
  const audioRoundTrips = stats.filter(stat => stat.type === 'remote-inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio' || stats.some(local => local.id === stat.localId && local.type === 'outbound-rtp' && (local.kind === 'audio' || local.mediaType === 'audio'))) && fresh(stat, stat.roundTripTimeMeasurements)).map(stat => milliseconds(stat.roundTripTime)).filter((value): value is number => value !== null);
  const iceRtt = fresh(pair, pair?.responsesReceived) ? milliseconds(pair?.currentRoundTripTime) : null;
  const audioRtt = audioRoundTrips.length ? Math.max(...audioRoundTrips) : null;
  let received = 0;
  let lost = 0;
  let hasDelta = false;
  const active = new Set<string>();
  for (const stat of audio) {
    const streamKey = `${stat.id}:${stat.ssrc ?? ''}`;
    active.add(streamKey);
    if (!fresh(stat) || !finite(stat.packetsReceived) || !finite(stat.packetsLost)) continue;
    const previous = history.get(streamKey);
    history.set(streamKey, { received: stat.packetsReceived, lost: stat.packetsLost });
    // Counter resets (e.g. a replaced SSRC) start a fresh interval.
    if (!previous || stat.packetsReceived < previous.received || stat.packetsLost < previous.lost) continue;
    received += stat.packetsReceived - previous.received;
    lost += stat.packetsLost - previous.lost;
    hasDelta = true;
  }
  for (const id of history.keys()) if (!active.has(id)) history.delete(id);
  const jitters = audio.filter(stat => fresh(stat)).map(stat => milliseconds(stat.jitter)).filter((value): value is number => value !== null);
  const connected = source.connection.connectionState === 'connected';
  if (!connected) { history.clear(); measurements.clear(); }
  const activeMeasurements = new Set(stats.map(stat => stat.id));
  for (const id of measurements.keys()) if (!activeMeasurements.has(id)) measurements.delete(id);
  return {
    socketId: source.socketId, name: source.name, state: source.connection.connectionState,
    rttMs: connected ? iceRtt ?? audioRtt : null,
    rttSource: !connected ? null : iceRtt !== null ? 'ice' : audioRtt !== null ? 'audio' : null,
    jitterMs: connected && jitters.length ? Math.max(...jitters) : null,
    packetLossPercent: connected && hasDelta && received + lost > 0 ? 100 * lost / (received + lost) : null,
    sampledAt: now, deliveryDelayMs: context.deliveryDelayMs ?? 0, stale,
  };
}

export function unavailableConnectionStatistics(source: ConnectionStatsSource): PeerConnectionStatistics {
  return { socketId: source.socketId, name: source.name, state: source.connection.connectionState, rttMs: null, rttSource: null, jitterMs: null, packetLossPercent: null, sampledAt: null };
}

export function expireConnectionStatistics(stat: PeerConnectionStatistics, now = Date.now(), maxAgeMs = 15_000): PeerConnectionStatistics {
  if (stat.sampledAt === null || (now - stat.sampledAt <= maxAgeMs && stat.state === 'connected')) return stat;
  return { ...stat, rttMs: null, rttSource: null, jitterMs: null, packetLossPercent: null, stale: stat.state === 'connected' };
}

export interface ConnectionReportSample {
  source: ConnectionStatsSource;
  report: RTCStatsReport | null;
  collectedAt: number;
  deliveryDelayMs: number;
}
interface Subscription { listener: (samples: ConnectionReportSample[]) => void; intervalMs: number; due: number }
interface CollectionRuntime { schedule: typeof setTimeout; cancel: typeof clearTimeout; now: () => number }
// Browser timer functions require their Window receiver. The runtime is an
// ordinary object, so calling an unbound timer through it can throw in Electron.
const collectionRuntime: CollectionRuntime = {
  schedule: globalThis.setTimeout.bind(globalThis),
  cancel: globalThis.clearTimeout.bind(globalThis),
  now: Date.now,
};
const collectors = new WeakMap<() => ConnectionStatsSource[], { add: (subscription: Subscription) => () => void }>();

/** One raw WebRTC collection shared by media health, video statistics, and diagnostics. */
export function subscribeConnectionReports(
  sources: () => ConnectionStatsSource[],
  listener: (samples: ConnectionReportSample[]) => void,
  intervalMs: number,
  runtime: CollectionRuntime = collectionRuntime,
) {
  let collector = collectors.get(sources);
  if (!collector) {
    const subscribers = new Set<Subscription>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;
    let cached: { samples: ConnectionReportSample[]; at: number } | undefined;
    function recentSamples() {
      if (!cached || runtime.now() - cached.at >= 250) return undefined;
      const current = sources();
      if (current.length !== cached.samples.length) return undefined;
      const samples: ConnectionReportSample[] = [];
      for (const source of current) {
        const sample = cached.samples.find(item => item.source.connection === source.connection && item.source.socketId === source.socketId);
        if (!sample) return undefined;
        samples.push({ ...sample, source, deliveryDelayMs: sample.deliveryDelayMs + Math.max(0, runtime.now() - sample.collectedAt) });
      }
      return samples;
    }
    function deliver(samples: ConnectionReportSample[]) {
      const deliveredAt = runtime.now();
      for (const subscriber of subscribers) {
        if (subscriber.due > deliveredAt) continue;
        subscriber.due = deliveredAt + subscriber.intervalMs;
        // One observer cannot prevent realtime health monitoring for the others.
        try { subscriber.listener(samples); } catch {}
      }
      scheduleNext();
    }
    function scheduleNext() {
      if (timer !== undefined) runtime.cancel(timer);
      timer = undefined;
      if (running || stopped || !subscribers.size) return;
      const due = Math.min(...Array.from(subscribers, subscriber => subscriber.due));
      timer = runtime.schedule(() => { timer = undefined; void collect(due); }, Math.max(0, due - runtime.now()));
    }
    async function collect(due: number) {
      if (stopped || running) return;
      // Independent observers can drift a few milliseconds apart. Reuse a recent
      // collection at scheduled deadlines too, retaining its actual collectedAt.
      const recent = recentSamples();
      if (recent) { deliver(recent); return; }
      running = true;
      const started = runtime.now();
      const snapshot = sources();
      const samples = await Promise.all(snapshot.map(async source => {
        let report: RTCStatsReport | null = null;
        try { if (source.connection.connectionState === 'connected') report = await source.connection.getStats(); } catch {}
        const collectedAt = runtime.now();
        return { source, report, collectedAt, deliveryDelayMs: Math.max(0, started - due) + Math.max(0, collectedAt - started) };
      }));
      running = false;
      if (stopped) return;
      const current = sources();
      const valid = current.map(source => {
        const sample = samples.find(item => item.source.connection === source.connection && item.source.socketId === source.socketId);
        return sample ? { ...sample, source } : { source, report: null, collectedAt: runtime.now(), deliveryDelayMs: 0 };
      });
      const completed = runtime.now();
      cached = { samples: valid, at: completed };
      deliver(valid);
    }
    collector = { add(subscription) {
      // Hover/focus/cadence transitions can consume the collection just delivered to media health.
      const recent = !running ? recentSamples() : undefined;
      if (recent) {
        subscription.due = runtime.now() + subscription.intervalMs;
        try { subscription.listener(recent); } catch {}
      }
      subscribers.add(subscription);
      if (!running && subscribers.size === 1) void collect(subscription.due);
      else scheduleNext();
      return () => {
        subscribers.delete(subscription);
        if (!subscribers.size) {
          stopped = true;
          if (timer !== undefined) runtime.cancel(timer);
          collectors.delete(sources);
        } else scheduleNext();
      };
    } };
    collectors.set(sources, collector);
  }
  return collector.add({ listener, intervalMs: Math.max(250, intervalMs), due: runtime.now() });
}

export function connectionStatsInterval(open: boolean, background: boolean) {
  return background ? 30_000 : open ? 2000 : 10_000;
}

/** Observer-local history and UI updates; raw collection is shared with media health. */
export function startConnectionStatsPolling(
  sources: () => ConnectionStatsSource[],
  publish: (stats: PeerConnectionStatistics[]) => void,
  intervalMs = 2000,
  schedule: typeof setTimeout = collectionRuntime.schedule,
  cancel: typeof clearTimeout = collectionRuntime.cancel,
  histories = new Map<ConnectionStatsSource['connection'], PacketHistory>(),
) {
  return subscribeConnectionReports(sources, samples => {
    const live = new Set(samples.map(sample => sample.source.connection));
    for (const connection of histories.keys()) if (!live.has(connection)) histories.delete(connection);
    publish(samples.map(({ source, report, collectedAt, deliveryDelayMs }) => {
      let history = histories.get(source.connection);
      if (!history) { history = new Map(); histories.set(source.connection, history); }
      if (!report) { history.clear(); return unavailableConnectionStatistics(source); }
      return readConnectionStatistics(source, report, history, { now: collectedAt, deliveryDelayMs, maxAgeMs: Math.max(15_000, intervalMs * 3) });
    }));
  }, intervalMs, { ...collectionRuntime, schedule, cancel });
}

export function connectionSummary(status: string, peers: PeerConnectionStatistics[]) {
  if (status === 'connecting') return { label: 'Connecting', tone: 'pending' };
  if (status === 'reconnecting') return { label: 'Reconnecting', tone: 'pending' };
  if (status === 'disconnected') return { label: 'Disconnected', tone: 'pending' };
  if (!peers.length) return { label: 'Waiting for peers', tone: 'pending' };
  if (peers.some(peer => peer.state === 'failed' || peer.state === 'disconnected' || peer.state === 'closed')) return { label: 'Peer reconnecting', tone: 'poor' };
  if (peers.some(peer => peer.state !== 'connected')) return { label: 'Peer connecting', tone: 'pending' };
  const measured = peers.filter(peer => peer.rttMs !== null);
  if (!measured.length) return { label: 'Stats unavailable', tone: 'pending' };
  const worstRtt = Math.max(...measured.map(peer => peer.rttMs!));
  const worstLoss = Math.max(...peers.map(peer => peer.packetLossPercent ?? 0));
  const worstJitter = Math.max(...peers.map(peer => peer.jitterMs ?? 0));
  const tone = worstRtt >= 250 || worstLoss >= 5 || worstJitter >= 50 ? 'poor' : worstRtt >= 120 || worstLoss >= 2 || worstJitter >= 25 ? 'fair' : 'good';
  return { label: `${Math.round(worstRtt)} ms`, tone };
}
