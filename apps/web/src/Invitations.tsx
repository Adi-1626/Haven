import { AuthenticatedImage } from './AuthenticatedImage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Copy, Link, Plus, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { api, getApiBaseUrl } from './api';
import { copyWithFeedback } from './clipboard';
import { invitationHost, isCurrentInvitation, isLoopback, parseInvitation } from './invite-links';
import type { Server } from '@haven/shared/types';
import { profileFallback, profileImageSource } from './profile-images';
import './zenith-channel-invites.css';

export function InvitationIcon({ icon, name }: { icon: string; name: string }) {
  const source = profileImageSource(icon, true);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="invited-community-icon">
      {source && source !== failed ? (
        <AuthenticatedImage
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(source)}
        />
      ) : (
        profileFallback(icon, name)
      )}
    </span>
  );
}

interface Preview {
  community: { name: string; icon: string };
  expiresAt: number | null;
}

interface Invite {
  code: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

function formatExpiration(expiresAt: number | null): string {
  if (!expiresAt) return 'Never expires';
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return 'Expired';
  const hours = Math.round(remainingMs / 3600_000);
  if (hours < 24) return `Expires in ${hours}h`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

type InviteCreateProps = {
  server: Server;
  notify: (message: string) => void;
  onClose?: () => void;
  onOpenSettings?: () => void;
};

export function InviteCreate(props: InviteCreateProps) {
  // A server or permission change must never render another scope's codes,
  // even for the frame before an effect runs.
  return <InviteCreateSession key={`${props.server.id}:${props.server.role}`} {...props} />;
}

function InviteCreateSession({ server, notify, onClose, onOpenSettings }: InviteCreateProps) {
  const [host, setHost] = useState(() => window.haven ? getApiBaseUrl() || window.location.origin : window.location.origin);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [hours, setHours] = useState('168');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<'link' | 'code' | null>(null);
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const pending = useRef(false);
  const currentInvites = useRef<Invite[]>([]);
  const moderate = server.role === 'owner' || server.role === 'admin';
  const usable = (item: Invite) => item.revokedAt === null && (item.expiresAt === null || item.expiresAt > Date.now());

  const refresh = useCallback(async (preferredCode?: string): Promise<void> => {
    if (!moderate) return;
    const version = ++requestVersion.current;
    try {
      const result = await api<{ invites: Invite[] }>(`/servers/${server.id}/invites`);
      if (!Array.isArray(result.invites)) throw new Error('Unable to load invitations. Please try again.');
      if (!alive.current || version !== requestVersion.current) return;
      const active = result.invites.filter(usable);
      currentInvites.current = result.invites;
      setInvites(result.invites);
      setSelectedCode(current => active.find(item => item.code === (preferredCode || current))?.code || active[0]?.code || null);
      setClock(Date.now());
    } catch (failure) {
      if (alive.current && version === requestVersion.current) {
        currentInvites.current = [];
        setInvites([]);
        setSelectedCode(null);
        setError((failure as Error).message);
      }
    }
  }, [server.id, moderate]);

  useEffect(() => {
    alive.current = true;
    void api<{ publicUrl?: string }>('/config').then(config => {
      if (alive.current) setHost(invitationHost(window.haven ? getApiBaseUrl() || window.location.origin : window.location.origin, config.publicUrl));
    }).catch(() => {});
    void refresh();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId: string; revokedCode?: string }>).detail;
      if (detail.serverId !== server.id) return;
      if (detail.revokedCode) {
        currentInvites.current = currentInvites.current.filter(item => item.code !== detail.revokedCode);
        setInvites(previous => previous.filter(item => item.code !== detail.revokedCode));
        setSelectedCode(current => current === detail.revokedCode ? null : current);
      }
      void refresh();
    };
    const revalidate = () => { setClock(Date.now()); void refresh(); };
    const poll = setInterval(() => { if (document.visibilityState === 'visible') revalidate(); }, 15000);
    window.addEventListener('haven:invites-changed', changed);
    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    return () => {
      alive.current = false;
      requestVersion.current++;
      clearInterval(poll);
      window.removeEventListener('haven:invites-changed', changed);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
    };
  }, [server.id, refresh]);

  useEffect(() => {
    const next = Math.min(...invites.filter(item => item.expiresAt !== null && item.expiresAt > Date.now()).map(item => item.expiresAt!));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(2147483647, Math.max(1, next - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [invites, clock]);

  const activeInvites = invites.filter(usable);
  const invite = activeInvites.find(item => item.code === selectedCode) || null;

  const createInvite = async () => {
    if (!moderate || pending.current) return;
    pending.current = true;
    requestVersion.current++;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ code: string; expiresAt: number | null }>(`/servers/${server.id}/invites`, 'POST', { expiresInHours: hours === 'never' ? null : +hours });
      if (!result.code || (result.expiresAt !== null && typeof result.expiresAt !== 'number')) throw new Error('Haven returned an invalid invitation response. Please refresh before retrying.');
      if (!alive.current) return;
      await refresh(result.code);
      if (alive.current) notify('Invite created');
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const revokeInvite = async (code: string) => {
    if (pending.current || !moderate) return;
    pending.current = true;
    requestVersion.current++;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ ok: boolean }>(`/invites/${encodeURIComponent(code)}`, 'DELETE');
      if (result.ok !== true) throw new Error('Haven returned an invalid revocation response. Please refresh before retrying.');
      if (!alive.current) return;
      currentInvites.current = currentInvites.current.filter(item => item.code !== code);
      setInvites(previous => previous.filter(item => item.code !== code));
      setSelectedCode(current => current === code ? null : current);
      await refresh();
      if (alive.current) notify('Invitation revoked');
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const copyInvite = async (field: 'link' | 'code') => {
    if (!invite || pending.current || !usable(invite)) { setClock(Date.now()); return; }
    pending.current = true;
    setError('');
    try {
      // Also works against older backends without invitation realtime events.
      // Never copy a known-dead link from a disconnected or stale dialog.
      await api(`/invites/${encodeURIComponent(invite.code)}`);
      const current = currentInvites.current.find(item => item.code === invite.code);
      if (!alive.current || !current || !usable(current)) { if (alive.current) setClock(Date.now()); return; }
      await copyWithFeedback(field === 'link' ? `${host}/invite/${invite.code}` : invite.code, field === 'link' ? 'Invite link' : 'Invite code', notify, () => {
        if (alive.current) setCopiedField(field);
        setTimeout(() => { if (alive.current) setCopiedField(current => current === field ? null : current); }, 2000);
      });
    } catch (failure) {
      if (alive.current) { setSelectedCode(null); setError((failure as Error).message); void refresh(); }
    } finally { pending.current = false; }
  };

  const roleLabel =
    server.role === 'owner'
      ? 'Server Owner'
      : server.role === 'admin'
      ? 'Moderator'
      : 'Regular Member';

  return (
    <div className="zenith-modal-inner">
      {/* Header */}
      <div className="zenith-modal-header">
        <div className="zenith-modal-title-group">
          <div className="zenith-modal-title-row">
            <span className="zenith-modal-icon-invite">
              <UserPlus size={20} />
            </span>
            <h2 className="zenith-modal-heading">
              Invite people to {server.name}
            </h2>
          </div>
          <div className="zenith-modal-subtitle-row">
            <span className="zenith-status-dot" />
            <span className="zenith-modal-subtitle">
              Community · Public link
            </span>
          </div>
        </div>
        {onClose && (
          <button
            className="zenith-modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close dialog"
            type="button"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Description */}
      <p className="zenith-invite-desc">
        Invite someone into <b>{server.name}</b> in Haven. They can create their own account after opening the link.
      </p>

      {/* Loopback warning */}
      {isLoopback(host) && (
        <div className="notice zenith-notice-box">
          <Shield size={16} />
          <span>This invitation works only on this computer.</span>
        </div>
      )}

      {/* Expiration selection (moderators/owners only) */}
      {moderate && (
        <div className="zenith-expire-row">
          <label className="zenith-eyebrow-label" htmlFor="zenith-invite-expire" style={{ marginBottom: 0 }}>
            EXPIRE LINK
          </label>
          <div className="zenith-select-wrap">
            <select
              id="zenith-invite-expire"
              aria-label="Invite expiration"
              className="zenith-select"
              value={hours}
              onChange={e => setHours(e.target.value)}
            >
              <option value="24">In 24 hours</option>
              <option value="168">In 7 days</option>
              <option value="720">In 30 days</option>
              <option value="never">Never expire</option>
            </select>
            <span className="zenith-select-icon">
              <ChevronsUpDown size={14} />
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert" style={{ marginTop: '14px' }}>
          {error}
        </p>
      )}

      {/* Generated Invite Card */}
      {invite ? (
        <div className="zenith-invite-card">
          <div className="zenith-invite-link-row">
            <input
              aria-label="Invitation link"
              className="zenith-invite-link-input"
              value={`${host}/invite/${invite.code}`}
              readOnly
              onFocus={event => event.target.select()}
            />
            <button
              className="zenith-btn-copy-link"
              type="button"
              disabled={busy}
              onClick={() => void copyInvite('link')}
            >
              {copiedField === 'link' ? (
                <>
                  <Check size={14} />
                  <span>Copied invite link!</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  <span>Copy invite link</span>
                </>
              )}
            </button>
          </div>

          <div className="zenith-invite-code-row">
            <div className="zenith-direct-code-group">
              <span>Direct code:</span>
              <code className="zenith-direct-code-badge">{invite.code}</code>
            </div>
            <button
              className="zenith-btn-copy-code"
              type="button"
              disabled={busy}
              onClick={() => void copyInvite('code')}
            >
              {copiedField === 'code' ? (
                <>
                  <Check size={12} />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy code</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : !moderate ? (
        <div className="notice zenith-notice-box zenith-member-restriction-notice" style={{ marginTop: '16px' }}>
          <Shield size={16} />
          <span>Only server owners and moderators can create new invitations.</span>
        </div>
      ) : null}

      {/* Primary Action Button to generate or re-create (moderators/owners only) */}
      {moderate && (
        <div style={{ marginTop: invite ? '10px' : '16px' }}>
          <button
            className="zenith-btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={busy}
            onClick={createInvite}
            type="button"
          >
            <Link size={15} />
            <span>{busy ? 'Creating invite…' : 'Create invitation'}</span>
          </button>
        </div>
      )}

      {/* Active Invitations Section (moderators/owners) */}
      {moderate && (
        <div className="zenith-active-invites-section">
          <div className="zenith-active-invites-header">
            <span className="zenith-eyebrow-label" style={{ marginBottom: 0 }}>
              ACTIVE INVITATIONS
            </span>
            <span className="zenith-active-count">
              {activeInvites.length} active
            </span>
          </div>

          <div className="zenith-invites-list">
            {activeInvites.map(item => (
              <div key={item.code} className="zenith-invite-item">
                <div className="zenith-invite-item-left">
                  <span className="zenith-pulse-wrapper">
                    <span className="zenith-pulse-ping" />
                    <span className="zenith-pulse-dot" />
                  </span>
                  <div className="zenith-invite-item-info">
                    <span className="zenith-invite-item-code">{item.code}</span>
                    <span className="zenith-invite-item-sub">
                      {formatExpiration(item.expiresAt)}
                    </span>
                  </div>
                </div>

                <button
                  title={`Revoke ${item.code}`}
                  aria-label={`Revoke ${item.code}`}
                  className="zenith-invite-item-delete"
                  type="button"
                  disabled={busy}
                  onClick={() => void revokeInvite(item.code)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {activeInvites.length === 0 && (
              <span className="zenith-input-help">No active invitations yet.</span>
            )}
          </div>
        </div>
      )}

      {/* Footer Note */}
      <div className="zenith-invite-footer">
        <div className="zenith-role-indicator">
          <Shield size={14} />
          <span>Role: {roleLabel} (Default)</span>
        </div>
        {onOpenSettings && moderate && (
          <button
            type="button"
            className="zenith-link-btn"
            onClick={onOpenSettings}
          >
            Edit permissions
          </button>
        )}
      </div>
    </div>
  );
}

export function InviteRedeem({
  code,
  authenticated,
  onJoined,
  onAuthenticate,
}: {
  code: string;
  authenticated: boolean;
  onJoined: (serverId: string) => void;
  onAuthenticate?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setError('');
    setPreview(null);
    void api<Preview>(`/invites/${encodeURIComponent(code)}`)
      .then(value => {
        if (active) setPreview(value);
      })
      .catch(failure => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [code]);

  return (
    <div className="invite-preview">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !preview ? (
        <p className="quiet">Checking your invitation…</p>
      ) : (
        <>
          <InvitationIcon icon={preview.community.icon} name={preview.community.name} />
          <p className="eyebrow">YOU’RE INVITED TO</p>
          <h2>{preview.community.name}</h2>
          <p className="quiet">
            {authenticated
              ? 'Join this community with your current account.'
              : 'Create an account or sign in, then accept your invitation.'}
          </p>
          {preview.expiresAt && (
            <small className="quiet">Invite expires {new Date(preview.expiresAt).toLocaleString()}</small>
          )}
          {authenticated ? (
            <button
              className="primary zenith-btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  onJoined(
                    (await api<{ serverId: string }>(`/invites/${encodeURIComponent(code)}/join`, 'POST'))
                      .serverId
                  );
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Joining…' : `Join ${preview.community.name}`}
            </button>
          ) : (
            onAuthenticate && (
              <button className="primary zenith-btn-primary" onClick={onAuthenticate}>
                Continue to sign in or create an account
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}

export function CommunityJoin({
  authenticated,
  onJoined,
  onPending,
}: {
  authenticated: boolean;
  onJoined: (serverId: string) => void;
  onPending: (code: string) => void;
}) {
  const [value, setValue] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseInvitation> | null>(null);
  const [error, setError] = useState('');

  return (
    <div className="community-join">
      <form
        className="simple-form"
        onSubmit={event => {
          event.preventDefault();
          setError('');
          try {
            const invitation = parseInvitation(value, getApiBaseUrl() || window.location.origin);
            if (!isCurrentInvitation(invitation.origin, window.location.origin, getApiBaseUrl())) {
              throw new Error(
                'This invitation belongs to a different Haven service. Ask for an invitation to this Haven.'
              );
            }
            setParsed(invitation);
          } catch (failure) {
            setParsed(null);
            setError((failure as Error).message);
          }
        }}
      >
        <p className="quiet">Paste an invitation link or code to join a community.</p>
        <label>
          INVITE CODE OR LINK
          <input
            aria-label="INVITE CODE"
            value={value}
            onChange={event => {
              setValue(event.target.value);
              setParsed(null);
            }}
            required
            placeholder="Invitation link or code"
            autoFocus
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary zenith-btn-primary" type="submit">
          Join server
        </button>
      </form>
      {parsed && (
        <InviteRedeem
          code={parsed.code}
          authenticated={authenticated}
          onJoined={onJoined}
          onAuthenticate={() => onPending(parsed.code)}
        />
      )}
    </div>
  );
}
