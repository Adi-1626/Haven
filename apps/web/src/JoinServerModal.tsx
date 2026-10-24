import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Compass, Link as LinkIcon, Plus, Shield, X, AlertCircle } from 'lucide-react';
import { api, getApiBaseUrl } from './api';
import { isCurrentInvitation, isLoopback, parseInvitation } from './invite-links';
import { InvitationIcon } from './Invitations';
import './zenith-server-onboarding.css';

export interface JoinServerModalProps {
  authenticated: boolean;
  initialCode?: string;
  onClose: () => void;
  onOpenCreate?: () => void;
  onJoined: (serverId: string) => void;
  onPending?: (code: string) => void;
  notify?: (message: string) => void;
}

interface Preview {
  community: { name: string; icon: string };
  expiresAt: number | null;
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

export function JoinServerModal({
  authenticated,
  initialCode = '',
  onClose,
  onOpenCreate,
  onJoined,
  onPending,
  notify,
}: JoinServerModalProps) {
  const [value, setValue] = useState(initialCode);
  const [parsedCode, setParsedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const origin = window.haven ? getApiBaseUrl() || window.location.origin : window.location.origin;

  // Resolve invitation preview when a valid code is extracted
  const resolveCode = async (codeToResolve: string) => {
    setResolving(true);
    setError('');
    try {
      const data = await api<Preview>(`/invites/${encodeURIComponent(codeToResolve)}`);
      if (mounted.current) {
        setPreview(data);
      }
    } catch (err) {
      if (mounted.current) {
        setPreview(null);
        setError((err as Error).message || 'This invitation is invalid or has expired.');
      }
    } finally {
      if (mounted.current) {
        setResolving(false);
      }
    }
  };

  // Live auto-parse as user types or pastes
  const handleInputChange = (raw: string) => {
    setValue(raw);
    setError('');
    const trimmed = raw.trim();
    if (!trimmed) {
      setParsedCode(null);
      setPreview(null);
      return;
    }

    try {
      const parsed = parseInvitation(trimmed, origin);
      if (!isCurrentInvitation(parsed.origin, window.location.origin, getApiBaseUrl())) {
        setError('This invitation belongs to a different Haven service. Ask for an invitation to this Haven.');
        setParsedCode(null);
        setPreview(null);
        return;
      }
      setParsedCode(parsed.code);
      void resolveCode(parsed.code);
    } catch {
      // Input might still be incomplete; clear active preview
      setParsedCode(null);
      setPreview(null);
    }
  };

  // Form submission (Verify or Join)
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || busy || resolving) return;

    let targetCode = parsedCode;
    if (!targetCode) {
      const trimmed = value.trim();
      if (!trimmed) {
        setError('Enter an invite code or link to continue.');
        return;
      }
      try {
        const parsed = parseInvitation(trimmed, origin);
        if (!isCurrentInvitation(parsed.origin, window.location.origin, getApiBaseUrl())) {
          setError('This invitation belongs to a different Haven service. Ask for an invitation to this Haven.');
          return;
        }
        targetCode = parsed.code;
        setParsedCode(parsed.code);
      } catch (err) {
        setError((err as Error).message || 'Enter an invite code or a complete Haven invitation link.');
        return;
      }
    }

    if (!preview) {
      await resolveCode(targetCode);
      return;
    }

    // If unauthenticated, save code and trigger authentication flow
    if (!authenticated) {
      onPending?.(targetCode);
      onClose();
      return;
    }

    // Authenticated joining
    pending.current = true;
    setBusy(true);
    setError('');

    try {
      const result = await api<{ serverId: string }>(`/invites/${encodeURIComponent(targetCode)}/join`, 'POST');
      if (result.serverId) {
        notify?.(`Joined ${preview.community.name}!`);
        onJoined(result.serverId);
        onClose();
      } else {
        throw new Error('Failed to join community. Please try again.');
      }
    } catch (err) {
      if (mounted.current) {
        setError((err as Error).message || 'Failed to join community.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  return (
    <section className="zenith-onboarding-card" aria-label="Find your people">
      {/* Header */}
      <div className="zenith-onboarding-header">
        <div className="zenith-onboarding-title-group">
          <div className="zenith-onboarding-title-row">
            <div className="zenith-onboarding-icon-badge join" aria-hidden="true">
              <Compass size={18} />
            </div>
            <h2 className="zenith-onboarding-title">Find your people</h2>
          </div>
          <p className="zenith-onboarding-subtitle">
            Enter an invite link or code to join an existing community.
          </p>
        </div>
        <button
          type="button"
          className="zenith-onboarding-close-btn"
          onClick={onClose}
          aria-label="Close dialog"
          title="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      <form className="zenith-onboarding-form" onSubmit={handleSubmit}>
        {/* Invite Code or Link Input */}
        <div className="zenith-onboarding-field">
          <div className="zenith-onboarding-field-header">
            <label htmlFor="zenith-invite-input" className="zenith-onboarding-label join">
              Invite Code or Link
            </label>
          </div>
          <div className="zenith-onboarding-input-wrap">
            <input
              id="zenith-invite-input"
              type="text"
              placeholder="https://haven.app/invite/code or code"
              required
              autoFocus
              value={value}
              onChange={e => handleInputChange(e.target.value)}
              disabled={busy}
              className="zenith-onboarding-input join"
              autoComplete="off"
            />
            {value.length > 0 && !busy && (
              <button
                type="button"
                className="zenith-onboarding-input-clear"
                onClick={() => {
                  setValue('');
                  setParsedCode(null);
                  setPreview(null);
                  setError('');
                }}
                aria-label="Clear invitation input"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <p className="zenith-onboarding-help">
            Paste a full invitation link or the unique code provided by a server member.
          </p>
        </div>

        {/* Loopback warning */}
        {isLoopback(origin) && (
          <div className="zenith-onboarding-help" style={{ color: '#e5c07b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Shield size={13} />
            <span>Local Mode active: invitations connect to this local host.</span>
          </div>
        )}

        {/* Resolving preview spinner state */}
        {resolving && (
          <div className="zenith-server-preview-box" style={{ justifyContent: 'center', padding: '18px' }}>
            <span style={{ fontSize: '13px', color: '#a7aab7' }}>Checking your invitation…</span>
          </div>
        )}

        {/* Resolved Invite Preview Card */}
        {preview && !resolving && (
          <div className="zenith-invite-preview-card" role="region" aria-label="Community Invitation Details">
            <div className="zenith-invite-preview-header">
              <div className="zenith-invite-community-avatar">
                <InvitationIcon icon={preview.community.icon} name={preview.community.name} />
              </div>
              <div className="zenith-invite-community-meta">
                <div className="zenith-invite-pill-row">
                  <span className="zenith-invite-verified-badge">
                    <Check size={11} /> Verified Invite
                  </span>
                </div>
                <h3 className="zenith-invite-community-name">
                  {preview.community.name}
                </h3>
                <span className="zenith-invite-expiry-text">
                  {formatExpiration(preview.expiresAt)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="zenith-onboarding-error" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        {/* Switcher to Create Server */}
        {onOpenCreate && (
          <button
            type="button"
            className="zenith-onboarding-switch-btn join"
            onClick={onOpenCreate}
          >
            <Plus size={14} />
            <span>Don&apos;t have an invite? Create a server</span>
          </button>
        )}

        {/* Actions */}
        <div className="zenith-onboarding-actions">
          <button
            type="button"
            className="zenith-btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="zenith-btn-primary join"
            disabled={busy || resolving || !value.trim()}
          >
            <span>
              {busy
                ? 'Joining…'
                : preview
                ? authenticated
                  ? `Join ${preview.community.name}`
                  : 'Continue to sign in'
                : 'Join server'}
            </span>
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </section>
  );
}
