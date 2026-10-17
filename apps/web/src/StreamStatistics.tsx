import type { ShareQuality } from './media';

export default function StreamStatistics({ quality, onToggle }: { quality: ShareQuality; onToggle: (open: boolean) => void }) {
  const samples = [
    ...quality.stats.outbound.map(sample => ({ ...sample, direction: 'Sending' })),
    ...quality.stats.inbound.map(sample => ({ ...sample, direction: 'Receiving' })),
  ];
  return <details className="stream-stats" onToggle={event => onToggle(event.currentTarget.open)}>
    <summary>Live connection statistics</summary>
    <p className="quiet">Live video measurements refresh while these details are visible. Background collection is reduced; voice health monitoring continues.</p>
    {samples.length ? <div className="stat-samples">{samples.map(sample => <div className="stat-sample" key={`${sample.direction}-${sample.socketId}`}>
      <span>{sample.direction} · participant {sample.socketId.slice(0, 5)}</span>
      <div><b>{sample.width} × {sample.height}<small>Actual dimensions</small></b><b>{Math.round(sample.fps)} fps<small>Actual frame rate</small></b></div>
      <div><b>{sample.bitrateMbps.toFixed(2)} Mbps<small>Current video bitrate</small></b><b>{sample.packetsLost ?? 'Unavailable'}<small>Reported packets lost</small></b></div>
      {sample.qualityLimitationReason && sample.qualityLimitationReason !== 'none' && <p>Quality limited by {sample.qualityLimitationReason === 'cpu' ? 'encoding capacity' : sample.qualityLimitationReason}.</p>}
    </div>)}</div> : <p className="quiet">Video samples appear when a participant is sending or receiving a screen.</p>}
    <details className="raw-statistics"><summary>Detailed samples</summary><pre>{JSON.stringify(quality.stats, null, 2)}</pre></details>
  </details>;
}
