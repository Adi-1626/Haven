import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  Image as ImageIcon,
  Info,
  Maximize,
  Minimize,
  Shield,
  X,
} from 'lucide-react';
import type { Bootstrap, Role, User } from '@haven/shared/types';
import { Avatar, Modal } from './components';
import { ProfileActions } from './Friends';
import {
  openInNewTab,
  openOriginalImage,
  ORIGINAL_IMAGE_SUPPRESSION_WINDOW_MS,
  profileImageSource,
} from './profile-images';
import { copyWithFeedback } from './clipboard';
import { resolveApiUrl } from './api';
import { AuthenticatedImage } from './AuthenticatedImage';
import './zenith-social.css';

export { openInNewTab, openOriginalImage, ORIGINAL_IMAGE_SUPPRESSION_WINDOW_MS };

export function ImageViewer({
  source,
  name,
  onClose,
}: {
  source: string;
  name: string;
  onClose: () => void;
}) {
  const [actualSize, setActualSize] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const lastOpenTimeRef = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const resolved = resolveApiUrl(source);

  useEffect(() => {
    setFailed(false);
    setSize({ width: 0, height: 0 });
  }, [source]);

  const handleOpenOriginal = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    await openOriginalImage({
      source,
      resolved,
      onOpeningChange: setOpening,
      openingRef,
      lastOpenTimeRef,
    });
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(resolved);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.toLowerCase().replace(/\s+/g, '-')}-picture.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(resolved, '_blank');
    }
  };

  return (
    <Modal title={`${name} — original picture`} wide onClose={onClose}>
      <div className="zenith-image-viewer-container">
        {/* Technical Sub-Header */}
        <div className="image-viewer-sub-header">
          <div className="image-viewer-meta-left">
            <div className="image-viewer-icon-chip">
              <ImageIcon size={15} />
            </div>
            <span className="image-viewer-filename">{name} — original picture</span>
            <span className="image-viewer-format-pill">
              {size.width > 0 ? `${size.width} × ${size.height} · ORIGINAL` : 'RAW BITMAP'}
            </span>
          </div>
          <div className="image-viewer-header-actions">
            <button
              type="button"
              className="icon-btn image-viewer-zoom-toggle"
              disabled={failed}
              onClick={() => setActualSize(value => !value)}
              title={actualSize ? 'Fit to window' : 'Zoom to actual size'}
              aria-label={actualSize ? 'Fit to window' : 'Zoom to actual size'}
            >
              {actualSize ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
          </div>
        </div>

        {/* Viewport Canvas */}
        <div className={`profile-image-viewer ${actualSize ? 'actual-size' : ''}`}>
          <div className="profile-image-viewport">
            {failed ? (
              <div className="image-viewer-error" role="alert">
                <Info size={18} className="text-rose-400" />
                <p>
                  This image could not be loaded. Its host may block external viewing or the URL may
                  have expired.
                </p>
              </div>
            ) : (
              <div className="profile-image-containment">
                <AuthenticatedImage
                  src={source}
                  alt={`${name}'s full profile picture`}
                  referrerPolicy="no-referrer"
                  onLoad={event =>
                    setSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  onError={() => setFailed(true)}
                />
              </div>
            )}
          </div>

          {/* Floating Zoom HUD anchored at bottom right */}
          {!failed && (
            <div className="image-viewer-zoom-hud">
              <span className="image-viewer-hud-zoom-pill">
                {actualSize ? '100% ZOOM' : 'FIT TO WINDOW'}
              </span>
              <button
                type="button"
                className="image-viewer-hud-btn"
                onClick={() => setActualSize(value => !value)}
              >
                {actualSize ? <Minimize size={13} /> : <Maximize size={13} />}
                <span>{actualSize ? 'Fit to window' : 'Actual size'}</span>
              </button>
              <a
                href={resolved}
                target="_blank"
                rel="noreferrer noopener"
                className="image-viewer-hud-btn open-original-link"
                onClick={handleOpenOriginal}
              >
                <span>{opening ? 'Opening…' : 'Open original'}</span>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="image-viewer-hud-btn icon-only"
                onClick={handleDownload}
                title="Download original"
                aria-label="Download original image"
              >
                <Download size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Bottom Safety Strip */}
        <div className="image-viewer-safety-strip">
          <Info size={14} className="safety-strip-icon" aria-hidden="true" />
          <span>
            Haven uses the original URL, without requesting a thumbnail. A small source cannot become a
            higher-resolution image.
          </span>
        </div>
      </div>
    </Modal>
  );
}

export default function ProfileCard({
  data,
  user,
  role,
  initialViewing = false,
  onClose,
  onChanged,
  onMessage,
  notify,
}: {
  data: Bootstrap;
  user: User;
  role?: Role;
  initialViewing?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onMessage: (userId: string) => void;
  notify: (message: string) => void;
}) {
  const source = profileImageSource(user.avatar);
  const [viewing, setViewing] = useState(Boolean(initialViewing && source));
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // High-Res Image Inspection State
  const [actualSize, setActualSize] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const lastOpenTimeRef = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const resolved = source ? resolveApiUrl(source) : '';

  useEffect(() => {
    setFailed(false);
    setSize({ width: 0, height: 0 });
  }, [source]);

  useEffect(() => {
    if (initialViewing && source) {
      setViewing(true);
    }
  }, [initialViewing, source]);

  const copy = async (value: string, description: string, key: string) => {
    await copyWithFeedback(value, description, notify, () => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 2000);
    });
  };

  const handleOpenOriginal = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!source) return;
    await openOriginalImage({
      source,
      resolved,
      onOpeningChange: setOpening,
      openingRef,
      lastOpenTimeRef,
    });
  };

  const handleDownload = async () => {
    if (!source) return;
    try {
      const response = await fetch(resolved);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${user.displayName.toLowerCase().replace(/\s+/g, '-')}-picture.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(resolved, '_blank');
    }
  };

  const isOnline = user.status === 'online';
  const isDnd = user.status === 'dnd';
  const statusLabel = isDnd ? 'Do not disturb' : user.status ? user.status : 'Offline';

  const roleLabel =
    role === 'owner'
      ? 'Community owner'
      : role === 'admin'
      ? 'Community moderator'
      : 'Member';

  // Badges row: Online and Member identical height (26px), nowrap, vertically centered
  const badgesRow = (
    <div className="profile-badges">
      <span className={`profile-status ${isOnline ? 'is-online' : isDnd ? 'is-dnd' : 'is-offline'}`}>
        <span className="profile-status-dot-inner" />
        <span>{statusLabel}</span>
      </span>
      <span className="profile-role-badge">
        <Shield size={12} />
        <span>{roleLabel}</span>
      </span>
    </div>
  );

  const identityContent = (isDual: boolean) => (
    <div className="flex flex-col items-center text-center">
      {/* Avatar Block with 88px Gradient Ring & Status Indicator */}
      <div className="profile-avatar-wrap">
        <button
          type="button"
          className="profile-picture-button"
          disabled={!source}
          aria-label={`View ${user.displayName}'s original profile picture`}
          onClick={() => {
            if (source) setViewing(true);
          }}
          title={source ? 'View full resolution profile picture' : undefined}
        >
          <div className="profile-avatar-gradient-ring">
            <Avatar user={user} size={88} />
          </div>
          {source && !isDual && (
            <span className="profile-picture-zoom-badge" aria-hidden="true">
              <Maximize size={13} />
            </span>
          )}
        </button>
        <span
          className={`profile-avatar-status-dot ${isOnline ? 'is-online' : isDnd ? 'is-dnd' : 'is-offline'}`}
          title={statusLabel}
          aria-label={`Status: ${statusLabel}`}
        />
      </div>

      {/* User Display Name */}
      <h2 className="profile-display-name">{user.displayName}</h2>

      {/* Copyable Username Pill */}
      <button
        type="button"
        className="username-copy"
        title="Copy username"
        aria-label="Copy username"
        onClick={() => void copy(user.username, 'Username', 'username')}
      >
        <span>@{user.username}</span>
        {copiedKey === 'username' ? (
          <Check size={12} className="success-text" />
        ) : (
          <Copy size={12} />
        )}
      </button>

      {/* Badges Row */}
      {badgesRow}
    </div>
  );

  const aboutSection = (
    <section className="profile-about">
      <div className="profile-info-block">
        <h3 className="profile-info-label">ABOUT ME</h3>
        <p className="profile-info-content">{user.bio || 'No bio yet.'}</p>
      </div>
      <div className="profile-info-divider" />
      <div className="profile-info-block">
        <h3 className="profile-info-label">MEMBER SINCE</h3>
        <p className="profile-info-content profile-mono-date">
          {new Date(user.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>
    </section>
  );

  const actionsAndFooter = (
    <>
      <div className="profile-actions-wrapper">
        <ProfileActions
          data={data}
          user={user}
          onChanged={onChanged}
          onMessage={onMessage}
          notify={notify}
        />
      </div>

      <div className="profile-card-footer">
        <button
          type="button"
          className="text-link profile-copy-id"
          onClick={() => void copy(user.id, 'User ID', 'id')}
        >
          <Fingerprint size={12} />
          <span>{copiedKey === 'id' ? 'User ID copied!' : 'Copy user ID'}</span>
        </button>
      </div>
    </>
  );

  // If viewing picture and source exists, render Stitch Dual-Workspace Composition
  if (viewing && source) {
    return (
      <Modal title={`${user.displayName} — inspection`} wide onClose={onClose}>
        <div className="zenith-profile-dual-workspace-container">
          <div className="zenith-profile-dual-workspace">
            {/* PANE A: FULL-RESOLUTION PICTURE VIEWER LIGHTBOX (w-[670px]) */}
            <div className="zenith-inspection-viewer">
              {/* Technical Sub-Header */}
              <div className="image-viewer-sub-header">
                <div className="image-viewer-meta-left">
                  <div className="image-viewer-icon-chip">
                    <ImageIcon size={15} />
                  </div>
                  <span className="image-viewer-filename">{user.displayName} — original picture</span>
                  <span className="image-viewer-format-pill">
                    {size.width > 0 ? `${size.width} × ${size.height} · PNG` : 'RAW BITMAP'}
                  </span>
                </div>
                <div className="image-viewer-header-actions">
                  <button
                    type="button"
                    className="icon-btn image-viewer-zoom-toggle"
                    disabled={failed}
                    onClick={() => setActualSize(value => !value)}
                    title={actualSize ? 'Fit to window' : 'Zoom to actual size'}
                    aria-label={actualSize ? 'Fit to window' : 'Zoom to actual size'}
                  >
                    {actualSize ? <Minimize size={15} /> : <Maximize size={15} />}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Close Lightbox"
                    onClick={() => setViewing(false)}
                    aria-label="Close Lightbox"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Viewport Canvas */}
              <div className={`profile-image-viewer ${actualSize ? 'actual-size' : ''}`}>
                <div className="profile-image-viewport">
                  {failed ? (
                    <div className="image-viewer-error" role="alert">
                      <Info size={18} className="text-rose-400" />
                      <p>
                        This image could not be loaded. Its host may block external viewing or the URL may
                        have expired.
                      </p>
                    </div>
                  ) : (
                    <div className="profile-image-containment">
                      <AuthenticatedImage
                        src={source}
                        alt={`${user.displayName}'s full profile picture`}
                        referrerPolicy="no-referrer"
                        onLoad={event =>
                          setSize({
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                          })
                        }
                        onError={() => setFailed(true)}
                      />
                    </div>
                  )}
                </div>

                {/* Floating Zoom HUD anchored at bottom right */}
                {!failed && (
                  <div className="image-viewer-zoom-hud">
                    <span className="image-viewer-hud-zoom-pill">
                      {actualSize ? '100% ZOOM' : 'FIT TO WINDOW'}
                    </span>
                    <button
                      type="button"
                      className="image-viewer-hud-btn"
                      onClick={() => setActualSize(value => !value)}
                    >
                      {actualSize ? <Minimize size={13} /> : <Maximize size={13} />}
                      <span>{actualSize ? 'Fit to window' : 'Actual size'}</span>
                    </button>
                    <a
                      href={resolved}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="image-viewer-hud-btn open-original-link"
                      onClick={handleOpenOriginal}
                    >
                      <span>{opening ? 'Opening…' : 'Open original'}</span>
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      className="image-viewer-hud-btn icon-only"
                      onClick={handleDownload}
                      title="Download original"
                      aria-label="Download original image"
                    >
                      <Download size={13} />
                    </button>
                  </div>
                )}
              </div>

              {/* Bottom Safety Strip */}
              <div className="image-viewer-safety-strip">
                <Info size={14} className="safety-strip-icon" aria-hidden="true" />
                <span>
                  Haven uses the original URL, without requesting a thumbnail. A small source cannot become a
                  higher-resolution image.
                </span>
              </div>
            </div>

            {/* PANE B: PROFILE CARD (w-[440px]) */}
            <div className="zenith-inspection-card">
              {/* Card Sub-Header */}
              <div className="zenith-card-header">
                <div className="zenith-card-header-left">
                  <span className="zenith-header-dot" />
                  <h2 className="zenith-header-title">Profile</h2>
                </div>
                <button
                  type="button"
                  className="zenith-close-btn"
                  title="Close profile"
                  onClick={onClose}
                  aria-label="Close profile"
                >
                  <X size={16} />
                </button>
              </div>

              {identityContent(true)}
              {aboutSection}
              {actionsAndFooter}
            </div>
          </div>

          {/* Floating Shortcuts Bar */}
          <div className="zenith-inspection-shortcuts">
            <span>
              <kbd>ESC</kbd> to close inspection
            </span>
            <span className="divider">|</span>
            <span>
              <kbd>TAB</kbd> switch pane
            </span>
          </div>
        </div>
      </Modal>
    );
  }

  // Ordinary Profile Opening: Compact 440px Modal
  return (
    <Modal title="Profile" onClose={onClose}>
      <div className="profile-card enhanced-profile">
        {identityContent(false)}
        {aboutSection}
        {actionsAndFooter}
      </div>
    </Modal>
  );
}
