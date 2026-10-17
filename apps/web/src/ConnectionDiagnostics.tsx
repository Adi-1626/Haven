import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wifi } from 'lucide-react';
import { connectionStatsInterval, connectionSummary, expireConnectionStatistics, startConnectionStatsPolling, type ConnectionStatsSource, type PacketHistory, type PeerConnectionStatistics } from './connection-stats';
import { useAppActivity } from './app-activity';
import './ConnectionDiagnostics.css';

const metric = (value: number | null, suffix: string, digits = 0) => value === null ? 'Unavailable' : `${value.toFixed(digits)}${suffix}`;
const peerState = (state: RTCPeerConnectionState) => state === 'connected' ? 'Connected' : state === 'failed' || state === 'disconnected' ? 'Reconnecting' : state === 'closed' ? 'Disconnected' : 'Connecting';

export default function ConnectionDiagnostics({ status, sources }: { status: string; sources: () => ConnectionStatsSource[] }) {
  const [peers, setPeers] = useState<PeerConnectionStatistics[]>([]);
  const [open, setOpen] = useState(false);
  const background = !useAppActivity();
  const histories = useRef(new Map<ConnectionStatsSource['connection'], PacketHistory>());
  const [position, setPosition] = useState({ left: 12, bottom: 90 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const intervalMs = connectionStatsInterval(open, background);
  useEffect(() => { if (background) close(); }, [background]);
  useEffect(() => { histories.current.clear(); setPeers([]); }, [status]);
  useEffect(() => {
    if (status !== 'connecting' && status !== 'connected' && status !== 'reconnecting') return;
    return startConnectionStatsPolling(sources, setPeers, intervalMs, undefined, undefined, histories.current);
  }, [status, sources, intervalMs]);
  const currentPeers = peers.map(peer => expireConnectionStatistics(peer, Date.now(), Math.max(15_000, intervalMs * 3)));
  const summary = connectionSummary(status, currentPeers);
  const quality = summary.tone === 'good' ? 'Excellent' : summary.tone === 'fair' ? 'Good' : summary.tone === 'poor' ? 'Poor' : summary.label;
  function cancelClose() { clearTimeout(closeTimer.current); }
  function show() { cancelClose(); setOpen(true); }
  function close() { cancelClose(); pinned.current = false; setOpen(false); }
  function deferClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!pinned.current && !trigger.current?.contains(document.activeElement) && !panel.current?.contains(document.activeElement)) setOpen(false);
    }, 140);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(12, Math.min(rect.left - 8, window.innerWidth - 352)), bottom: Math.max(12, window.innerHeight - rect.top + 10) });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') { close(); event.stopPropagation(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <>
    <button ref={trigger} className={`connection-diagnostics-trigger connection-tone-${summary.tone}`} aria-label={`Voice connection: ${quality}${summary.label.endsWith(' ms') ? `, worst measured peer round-trip ${summary.label}` : ''}`} aria-expanded={open} aria-describedby={open ? id : undefined} onMouseEnter={show} onMouseLeave={deferClose} onFocus={show} onBlur={deferClose} onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}><Wifi size={17} /></button>
    {open && createPortal(<div ref={panel} id={id} role="tooltip" className="connection-diagnostics" style={position} onMouseEnter={show} onMouseLeave={deferClose}>
      <header><span className={`connection-quality-dot connection-tone-${summary.tone}`} /><strong>Voice connection</strong><span className={`connection-quality connection-tone-${summary.tone}`}>{quality}</span></header>
      <div className="connection-overview"><strong>{summary.label}</strong><span>{summary.label.endsWith(' ms') ? 'Worst measured peer round-trip time' : 'Peer-to-peer voice'}</span></div>
      {status === 'connecting' || status === 'reconnecting' || status === 'disconnected' ? <p>{status === 'connecting' ? 'Establishing your voice connection…' : status === 'reconnecting' ? 'Restoring your voice connection…' : 'Voice is disconnected.'}</p> : currentPeers.length === 0 ? <p>Join another participant to measure voice quality.</p> : <div className="connection-peer-list">{currentPeers.map(peer => <section className="connection-peer" key={peer.socketId}>
        <div><strong title={peer.name}>{peer.name}</strong><span>{peer.stale ? 'Stale measurements' : peerState(peer.state)}</span></div>
        <dl><div><dt>{peer.rttSource === 'audio' ? 'Audio RTCP RTT' : 'Network ICE RTT'}</dt><dd>{metric(peer.rttMs, ' ms')}</dd></div><div><dt>Audio jitter</dt><dd>{metric(peer.jitterMs, ' ms', 1)}</dd></div><div><dt>Audio loss</dt><dd>{metric(peer.packetLossPercent, '%', 1)}</dd></div></dl>
        {(peer.deliveryDelayMs ?? 0) > 250 && <p className="connection-delivery-delay">Stats delivery delayed {Math.round(peer.deliveryDelayMs!)} ms on this device. This delay is separate from network RTT.</p>}
      </section>)}</div>}
      <footer>Updates every {intervalMs / 1000} seconds while viewed · WebRTC peer measurements<br />ICE RTT measures the selected network path; audio RTCP RTT is the fallback. Neither includes microphone or playback delay. Loss covers received audio over the latest interval. Quality uses available measurements.</footer>
    </div>, document.body)}
  </>;
}
