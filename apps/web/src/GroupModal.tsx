import { useState, type FormEvent } from 'react';
import { ArrowRight, UserPlus, Users, X } from 'lucide-react';
import type { User } from '@haven/shared/types';
import { Avatar } from './components';
import './zenith-social-modals.css';

export interface GroupModalProps {
  friends: User[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: { name?: string; memberIds: string[] }) => Promise<void>;
  onOpenAddFriend?: () => void;
}

const display = (user?: User) => user?.displayName || user?.username || 'Unknown user';

export function GroupModal({
  friends,
  busy,
  onClose,
  onSubmit,
  onOpenAddFriend,
}: GroupModalProps) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleUser = (userId: string) => {
    setSelected(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (selected.length === 0) {
      setError('Choose at least one friend to start a conversation');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim() || undefined,
        memberIds: selected,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create conversation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="zenith-social-modal-card" aria-label="Start group conversation dialog">
      {/* Modal Header */}
      <div className="zenith-social-header">
        <div className="zenith-social-title-group">
          <div className="zenith-social-icon-badge" aria-hidden="true">
            <Users size={16} />
          </div>
          <h2 className="zenith-social-title">Start group conversation</h2>
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

      <form onSubmit={handleSubmit}>
        {/* Group Name Input */}
        <div className="zenith-field-group">
          <div className="zenith-field-header">
            <label htmlFor="group-name-input" className="zenith-field-label">
              Group Name (Optional)
            </label>
            <span className="zenith-char-counter" aria-hidden="true">
              {name.length}/32
            </span>
          </div>
          <div className="zenith-input-wrapper">
            <input
              id="group-name-input"
              type="text"
              placeholder="The usual suspects"
              value={name}
              maxLength={32}
              className="zenith-social-input"
              onChange={e => setName(e.target.value)}
              autoFocus
              disabled={submitting || busy}
            />
          </div>
        </div>

        {/* Friend Checklist */}
        <div className="zenith-field-group">
          <div className="zenith-field-header">
            <label className="zenith-field-label">Select Friends</label>
            <span className="zenith-selected-pill">
              {selected.length} selected
            </span>
          </div>

          <div
            className="zenith-friend-checklist"
            role="group"
            aria-label="Friends list for group conversation"
          >
            {friends.length === 0 ? (
              <div className="zenith-checklist-empty">
                <p style={{ margin: '0 0 10px 0' }}>Add a friend first to start a conversation.</p>
                {onOpenAddFriend && (
                  <button
                    type="button"
                    className="zenith-secondary-btn"
                    style={{ margin: '0 auto' }}
                    onClick={() => {
                      onClose();
                      onOpenAddFriend();
                    }}
                  >
                    <UserPlus size={14} />
                    <span>Add a friend</span>
                  </button>
                )}
              </div>
            ) : (
              friends.map(user => {
                const isChecked = selected.includes(user.id);
                const status = user.status || 'offline';
                return (
                  <label
                    key={user.id}
                    className={`zenith-friend-row ${isChecked ? 'is-selected' : ''}`}
                    onClick={e => {
                      // Prevent label double-trigger on checkbox click
                      if ((e.target as HTMLElement).tagName !== 'INPUT') {
                        toggleUser(user.id);
                      }
                    }}
                  >
                    <div className="zenith-friend-row-left">
                      <div className="zenith-avatar-wrap">
                        <Avatar user={user} size={32} />
                        <span
                          className={`zenith-presence-dot ${status}`}
                          aria-label={`Status: ${status}`}
                        />
                      </div>
                      <div className="zenith-friend-meta">
                        <span className="zenith-friend-display-name">
                          {display(user)}
                        </span>
                        <span className="zenith-friend-username">
                          @{user.username}
                        </span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      className="zenith-checkbox"
                      aria-label={`Select ${display(user)}`}
                      onChange={() => toggleUser(user.id)}
                      disabled={submitting || busy}
                    />
                  </label>
                );
              })
            )}
          </div>
        </div>

        {error && (
          <div className="form-error" role="alert" style={{ marginBottom: '12px' }}>
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="zenith-social-footer">
          <button
            type="submit"
            className="zenith-primary-btn zenith-full-btn"
            disabled={selected.length === 0 || submitting || busy}
          >
            <span>{submitting ? 'Creating conversation…' : 'Start conversation'}</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </section>
  );
}
