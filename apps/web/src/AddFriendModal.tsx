import { useState, useRef, type FormEvent } from 'react';
import { ArrowRight, Check, Clock, Copy, UserPlus, X } from 'lucide-react';
import type { Bootstrap } from '@haven/shared/types';
import { api } from './api';
import { copyWithFeedback } from './clipboard';
import './zenith-social-modals.css';

export interface AddFriendModalProps {
  data: Bootstrap;
  onClose: () => void;
  onPending: () => void;
  onChanged: () => void | Promise<void>;
  notify: (message: string) => void;
}

const failure = (error: unknown) =>
  error instanceof Error ? error.message : 'The request could not be completed. Try again.';

export function AddFriendModal({
  data,
  onClose,
  onPending,
  onChanged,
  notify,
}: AddFriendModalProps) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [copied, setCopied] = useState(false);
  const submitting = useRef(false);

  const ownUser = data.user;

  async function copyOwnUsername() {
    await copyWithFeedback(`@${ownUser.username}`, 'Username', notify, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const cleanUsername = username.trim().replace(/^@/, '');
    if (!cleanUsername) return;

    submitting.current = true;
    setBusy(true);
    setError('');
    setSent('');

    try {
      await api('/friends/requests', 'POST', { username: cleanUsername });
      setSent(cleanUsername);
      setUsername('');
      notify(`Friend request sent to @${cleanUsername}`);
      await onChanged();
    } catch (err) {
      setError(failure(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const totalPendingCount = data.requests.length;

  return (
    <section className="zenith-social-modal-card" aria-label="Add friend dialog">
      {/* Header */}
      <div className="zenith-social-header">
        <div className="zenith-social-title-group">
          <div className="zenith-social-icon-badge" aria-hidden="true">
            <UserPlus size={16} />
          </div>
          <h2 className="zenith-social-title">Add friend</h2>
        </div>
        <button
          type="button"
          className="zenith-social-close-btn"
          onClick={onClose}
          aria-label="Close dialog"
          title="Close dialog"
        >
          <X size={16} />
        </button>
      </div>

      {/* Explanatory Lead */}
      <p className="zenith-social-lead">
        Enter your friend’s account username, with or without @. A community invite joins a community; it does not add a friend.
      </p>

      {/* Own Username Banner */}
      <div className="zenith-own-username-box">
        <div className="zenith-own-username-left">
          <span className="zenith-emerald-dot" aria-hidden="true" />
          <span className="zenith-own-username-label">Your username:</span>
          <code className="zenith-own-username-chip">@{ownUser.username}</code>
        </div>
        <button
          type="button"
          className="zenith-own-copy-btn"
          onClick={() => void copyOwnUsername()}
          title="Copy your username to clipboard"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Username Input Field */}
        <div className="zenith-field-group">
          <label htmlFor="zenith-friend-username-input" className="zenith-field-label">
            Username
          </label>
          <div className="zenith-input-wrapper">
            <input
              id="zenith-friend-username-input"
              type="text"
              placeholder="Your friend's username"
              value={username}
              onChange={e => {
                setUsername(e.target.value);
                setError('');
              }}
              className="zenith-social-input font-mono"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={65}
              required
              disabled={busy}
            />
            {username.trim().length > 0 && (
              <div className="zenith-input-suffix" aria-hidden="true">
                <Check size={16} />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="form-error" role="alert" style={{ marginBottom: '12px' }}>
            {error}
          </div>
        )}

        {sent && (
          <div className="zenith-success-banner" role="status">
            <div className="zenith-success-header">
              <Check size={16} />
              <div className="zenith-success-text">
                Friend request sent to <strong>@{sent}</strong>. They can accept it from their Incoming requests, even if they were offline when you sent it.
              </div>
            </div>
            <button
              type="button"
              className="zenith-success-link"
              onClick={onPending}
            >
              <span>View pending requests</span>
              <ArrowRight size={13} />
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="zenith-social-footer">
          <button
            type="button"
            className="zenith-secondary-btn"
            onClick={onPending}
          >
            <Clock size={14} />
            <span>Pending requests{totalPendingCount > 0 ? ` (${totalPendingCount})` : ''}</span>
          </button>

          <button
            type="submit"
            className="zenith-primary-btn"
            disabled={busy || !username.trim()}
          >
            <UserPlus size={15} />
            <span>{busy ? 'Sending…' : 'Send friend request'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}
