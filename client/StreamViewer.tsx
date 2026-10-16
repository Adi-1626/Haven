import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, Maximize, Mic, MicOff, Minimize, Square, VolumeX } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function StreamViewer({ stream, name, local, muted, deafened, onToggleMute, onToggleDeafen, onClose, onStop, onError }: { stream: MediaStream; name: string; local: boolean; muted: boolean; deafened: boolean; onToggleMute: () => void; onToggleDeafen: () => void; onClose: () => void; onStop: () => void; onError: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement;
    const element = container.current;
    element?.focus();
    if (video.current) { video.current.srcObject = stream; void video.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
    const ended = () => { if (!stream.getVideoTracks().some(track => track.readyState === 'live')) onClose(); };
    stream.addEventListener('removetrack', ended); stream.getVideoTracks().forEach(track => track.addEventListener('ended', ended));
    return () => { if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {}); stream.removeEventListener('removetrack', ended); stream.getVideoTracks().forEach(track => track.removeEventListener('ended', ended)); previousFocus?.focus(); };
  }, [stream]);
  useEffect(() => { const changed = () => setFullscreen(document.fullscreenElement === container.current); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);
  async function toggleFullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else { if (!container.current?.requestFullscreen) throw new Error('Fullscreen is unavailable. The expanded viewer remains available.'); await container.current.requestFullscreen(); } } catch (failure) { onError((failure as Error).message); } }
  async function close() { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); onClose(); }
  return createPortal(<div ref={container} className="stream-viewer" role="dialog" aria-modal="true" aria-label={`${name} stream viewer`} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape' && !fullscreen) { event.preventDefault(); void close(); }
    if (event.key === 'Tab') {
      const buttons = Array.from(container.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><button className="secondary" onClick={() => void close()}><ArrowLeft size={17} />Return to voice room</button><span className="live-tag">LIVE</span><strong>{local ? 'Your screen' : `${name}’s screen`}</strong><span className="viewer-size">{size.width > 0 && `${size.width} × ${size.height}`}</span></header>
    <div className="stream-viewer-canvas"><video ref={video} muted autoPlay playsInline onResize={() => setSize({ width: video.current?.videoWidth || 0, height: video.current?.videoHeight || 0 })} onLoadedMetadata={() => setSize({ width: video.current?.videoWidth || 0, height: video.current?.videoHeight || 0 })} style={{ maxWidth: size.width ? `min(100%, ${size.width}px)` : '100%', maxHeight: '100%' }} />{!playing && <button className="primary" onClick={() => void video.current?.play().then(() => setPlaying(true)).catch(failure => onError(failure.message))}>Play stream</button>}</div>
    <footer><span>Voice stays connected · Aspect ratio preserved · Native size or smaller</span><button className="secondary" aria-label={muted ? 'Unmute in viewer' : 'Mute in viewer'} onClick={onToggleMute}>{muted ? <MicOff size={16} /> : <Mic size={16} />}</button><button className="secondary" aria-label={deafened ? 'Undeafen in viewer' : 'Deafen in viewer'} onClick={onToggleDeafen}>{deafened ? <VolumeX size={16} /> : <Headphones size={16} />}</button>{local && <button className="secondary danger" aria-label="Stop sharing in viewer" onClick={() => { onStop(); void close(); }}><Square size={14} />Stop sharing</button>}<button className="primary" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}{fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}</button></footer>
  </div>, document.body);
}
