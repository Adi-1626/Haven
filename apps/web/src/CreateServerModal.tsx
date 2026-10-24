import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Sparkles, X, Link, AlertCircle } from 'lucide-react';
import './zenith-server-onboarding.css';

export interface CreateServerModalProps {
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onOpenJoin: () => void;
  onSubmit: (values: { name: string; icon?: string }) => Promise<void>;
}

const POPULAR_EMOJIS = ['🌱', '🎮', '🚀', '🎨', '⚡', '☕', '🌟', '🎧', '🔥', '💬'];

export function CreateServerModal({
  busy: externalBusy = false,
  error: externalError = '',
  onClose,
  onOpenJoin,
  onSubmit,
}: CreateServerModalProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isBusy = externalBusy || localBusy;
  const currentError = localError || externalError;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || isBusy) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setLocalError('Server name is required.');
      return;
    }

    setLocalError('');
    pending.current = true;
    setLocalBusy(true);

    try {
      await onSubmit({
        name: trimmedName,
        icon: icon.trim() || undefined,
      });
      if (mounted.current) {
        onClose();
      }
    } catch (err) {
      if (mounted.current) {
        setLocalError((err as Error).message || 'Failed to create server. Please try again.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setLocalBusy(false);
      }
    }
  };

  // Compute preview initial if no emoji
  const previewInitial = (name.trim().charAt(0) || 'H').toUpperCase();

  return (
    <section className="zenith-onboarding-card" aria-label="Make a space of your own">
      {/* Header */}
      <div className="zenith-onboarding-header">
        <div className="zenith-onboarding-title-group">
          <div className="zenith-onboarding-title-row">
            <div className="zenith-onboarding-icon-badge create" aria-hidden="true">
              <Sparkles size={18} />
            </div>
            <h2 className="zenith-onboarding-title">Make a space of your own</h2>
          </div>
          <p className="zenith-onboarding-subtitle">
            A home for your friends, your project, your thing.
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
        {/* Server Rail Preview Card */}
        <div className="zenith-server-preview-box">
          <div
            className={`zenith-server-rail-icon-mock ${icon.trim() ? 'has-emoji' : ''}`}
            aria-hidden="true"
          >
            <span className="zenith-server-rail-indicator" />
            {icon.trim() || previewInitial}
          </div>
          <div className="zenith-server-preview-info">
            <div className="zenith-onboarding-label" style={{ fontSize: '10px' }}>
              SERVER RAIL PREVIEW
            </div>
            <div className="zenith-server-preview-name">
              {name.trim() || 'Your Community'}
            </div>
            <span className="zenith-server-preview-hint">
              This is how your server will appear in the navigation rail.
            </span>
          </div>
        </div>

        {/* Server Name Field */}
        <div className="zenith-onboarding-field">
          <div className="zenith-onboarding-field-header">
            <label htmlFor="zenith-server-name-input" className="zenith-onboarding-label">
              Server Name
            </label>
            <span className="zenith-onboarding-counter" aria-hidden="true">
              {name.length}/80
            </span>
          </div>
          <div className="zenith-onboarding-input-wrap">
            <input
              id="zenith-server-name-input"
              type="text"
              placeholder="The cozy corner"
              required
              maxLength={80}
              autoFocus
              value={name}
              onChange={e => {
                setName(e.target.value);
                setLocalError('');
              }}
              disabled={isBusy}
              className="zenith-onboarding-input"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Server Icon Field */}
        <div className="zenith-onboarding-field">
          <div className="zenith-onboarding-field-header">
            <label htmlFor="zenith-server-icon-input" className="zenith-onboarding-label">
              Server Icon (Optional Emoji)
            </label>
            {icon && (
              <button
                type="button"
                className="zenith-emoji-clear-btn"
                onClick={() => setIcon('')}
                title="Remove custom emoji"
              >
                Clear
              </button>
            )}
          </div>
          <div className="zenith-onboarding-input-wrap">
            <input
              id="zenith-server-icon-input"
              type="text"
              placeholder="🌱 or custom emoji"
              maxLength={8}
              value={icon}
              onChange={e => setIcon(e.target.value)}
              disabled={isBusy}
              className="zenith-onboarding-input"
              autoComplete="off"
            />
          </div>
          {/* Quick Select Row */}
          <div className="zenith-emoji-quick-row" role="group" aria-label="Suggested server emojis">
            {POPULAR_EMOJIS.map(emoji => (
              <button
                key={emoji}
                type="button"
                className={`zenith-emoji-chip ${icon === emoji ? 'active' : ''}`}
                onClick={() => setIcon(emoji)}
                aria-label={`Select ${emoji} icon`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Error message */}
        {currentError && (
          <div className="zenith-onboarding-error" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{currentError}</span>
          </div>
        )}

        {/* Switcher to Join Server */}
        <button
          type="button"
          className="zenith-onboarding-switch-btn"
          onClick={onOpenJoin}
        >
          <Link size={14} />
          <span>Have an invite already? Join a server</span>
        </button>

        {/* Actions */}
        <div className="zenith-onboarding-actions">
          <button
            type="button"
            className="zenith-btn-secondary"
            onClick={onClose}
            disabled={isBusy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="zenith-btn-primary"
            disabled={isBusy || !name.trim()}
          >
            <span>{isBusy ? 'Creating…' : 'Create server'}</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </section>
  );
}
