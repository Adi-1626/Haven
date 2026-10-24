import { AuthenticatedImage } from './AuthenticatedImage';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { User } from '@haven/shared/types';
import { profileFallback, profileImageSource } from './profile-images';
import { useVideoPlayback } from './video-playback';

export function Avatar({ user, size = 36 }: { user?: { id?: string; displayName?: string; username?: string; avatar?: string | null; status?: string }; size?: number }) {
  const name = user?.displayName || user?.username || '?';
  const source = profileImageSource(user?.avatar);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const hue = Array.from(user?.id || name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, background: `hsl(${hue} 24% 38%)`, fontSize: size * 0.38 }}>
      {source && source !== failedSource ? (
        <AuthenticatedImage key={source} src={source} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
      ) : (
        profileFallback(user?.avatar, name)
      )}
      <i className={`presence ${user?.status || 'offline'}`} />
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  hideHeader = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  hideHeader?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) {
      element.showModal();
    }
    const handleCancel = (event: Event) => {
      if (Date.now() - ((window as unknown as { __havenShortcutCancelledAt?: number }).__havenShortcutCancelledAt || 0) < 500) {
        event.preventDefault();
        return;
      }
      onClose();
    };
    element.addEventListener('cancel', handleCancel);
    return () => element.removeEventListener('cancel', handleCancel);
  }, [onClose]);
  const effectiveAriaLabel = ariaLabel ?? (typeof title === 'string' ? title : undefined);
  const effectiveAriaLabelledBy = ariaLabelledBy ?? (!hideHeader ? titleId : undefined);
  return (
    <dialog
      ref={dialog}
      aria-label={effectiveAriaLabelledBy ? undefined : effectiveAriaLabel}
      aria-labelledby={effectiveAriaLabelledBy}
      className={`modal ${wide ? 'wide' : ''} ${className}`.trim()}
      onClick={event => { if (event.target === dialog.current) onClose(); }}
    >
      {!hideHeader && (
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </header>
      )}
      {children}
    </dialog>
  );
}

export function Video({ stream, label, local = false, onExpand }: { stream: MediaStream; label: string; local?: boolean; onExpand?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useVideoPlayback(video, stream);
  return (
    <div className="video-tile">
      <video ref={video} autoPlay playsInline muted />
      <span>{local && <b>LIVE</b>} {label}</span>
      <button className="video-expand" title="Expand stream" aria-label={`Expand ${label} stream`} onClick={() => { if (onExpand) onExpand(); else void video.current?.requestFullscreen().catch(() => {}); }}>
        ⛶
      </button>
    </div>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  icon,
  disabled,
  ...props
}: ButtonProps) {
  const sizeClass = size === 'sm' ? 'small-button' : size === 'lg' ? 'large-button' : '';
  const variantClass = variant === 'icon' ? 'icon-button' : variant;
  const classes = [variantClass, sizeClass, className].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={disabled} {...props}>
      {icon}
      {children}
    </button>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className = '', id, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;

  if (!label) {
    return <input id={inputId} className={`input ${className}`} {...props} />;
  }

  return (
    <label htmlFor={inputId}>
      {label}
      <input id={inputId} className={`input ${error ? 'input-error' : ''} ${className}`} {...props} />
      {hint && !error && <small>{hint}</small>}
      {error && <small className="danger-text">{error}</small>}
    </label>
  );
}

export function Badge({
  children,
  variant = 'accent',
  className = '',
}: {
  children: ReactNode;
  variant?: 'accent' | 'unread' | 'live' | 'neutral';
  className?: string;
}) {
  const variantClass = variant === 'live' ? 'live-tag' : variant === 'unread' ? 'unread-badge' : 'badge';
  return <span className={`${variantClass} ${className}`}>{children}</span>;
}

export function Divider({ className = '', vertical = false }: { className?: string; vertical?: boolean }) {
  return <hr className={`divider ${vertical ? 'divider-vertical' : ''} ${className}`} />;
}
