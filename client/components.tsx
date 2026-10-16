import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { User } from '../shared/types';
import { profileFallback, profileImageSource } from './profile-images';

export function Avatar({ user, size = 36 }: { user?: { id?: string; displayName?: string; username?: string; avatar?: string | null; status?: string }; size?: number }) {
  const name = user?.displayName || user?.username || '?';
  const source = profileImageSource(user?.avatar);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const hue = Array.from(user?.id || name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return <span className="avatar" style={{ width: size, height: size, background: `hsl(${hue} 24% 38%)`, fontSize: size * .38 }}>
    {source && source !== failedSource ? <img key={source} src={source} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} /> : profileFallback(user?.avatar, name)}
    <i className={`presence ${user?.status || 'offline'}`} />
  </span>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>
    {children}
  </dialog>;
}

export function Video({ stream, label, local = false, onExpand }: { stream: MediaStream; label: string; local?: boolean; onExpand?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => {}); } }, [stream]);
  return <div className="video-tile"><video ref={video} autoPlay playsInline muted /><span>{local && <b>LIVE</b>} {label}</span><button className="video-expand" title="Expand stream" aria-label={`Expand ${label} stream`} onClick={() => { if (onExpand) onExpand(); else void video.current?.requestFullscreen().catch(() => {}); }}>⛶</button></div>;
}
