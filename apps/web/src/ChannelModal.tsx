import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Hash, PlusCircle, Trash2, Volume2, X } from 'lucide-react';
import type { Channel } from '@haven/shared/types';
import './zenith-channel-invites.css';
import { ConfirmDialog } from './ZenithDialog';

export interface ChannelModalProps {
  serverId: string;
  editChannel: Channel | null;
  initialType?: 'text' | 'voice';
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (values: { name: string; type: 'text' | 'voice'; topic: string; position?: number }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function ChannelModal({
  editChannel,
  initialType = 'text',
  busy: externalBusy = false,
  error: externalError = '',
  onClose,
  onSubmit,
  onDelete,
}: ChannelModalProps) {
  const [name, setName] = useState(editChannel?.name || '');
  const [type, setType] = useState<'text' | 'voice'>(editChannel?.type || initialType);
  const [topic, setTopic] = useState(editChannel?.topic || '');
  const [position, setPosition] = useState(editChannel?.position ?? 0);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const isBusy = externalBusy || localBusy;
  const currentError = localError || externalError;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || externalBusy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Channel name is required');
      return;
    }
    setLocalError('');
    pending.current = true;
    setLocalBusy(true);
    try {
      await onSubmit({
        name: trimmed,
        type,
        topic: topic.trim(),
        ...(editChannel ? { position: Number(position) } : {}),
      });
      if (mounted.current) onClose();
    } catch (err) {
      if (mounted.current) setLocalError((err as Error).message || 'Failed to save channel');
    } finally {
      pending.current = false;
      if (mounted.current) setLocalBusy(false);
    }
  };

  const handleDelete = () => {
    if (!editChannel || !onDelete || pending.current || externalBusy) return;
    setShowDeleteConfirm(true);
  };

  return (
    <div className="zenith-modal-inner">
      {/* Header */}
      <div className="zenith-modal-header">
        <div className="zenith-modal-title-group">
          <div className="zenith-modal-title-row">
            <span className="zenith-modal-icon-channel">
              <PlusCircle size={20} />
            </span>
            <h2 className="zenith-modal-heading">
              {editChannel ? 'Edit channel' : 'Create channel'}
            </h2>
          </div>
        </div>
        <button
          className="zenith-modal-close-btn"
          onClick={onClose}
          aria-label="Close dialog"
          title="Close dialog"
          type="button"
        >
          <X size={18} />
        </button>
      </div>

      {currentError && (
        <p className="form-error" role="alert" style={{ marginTop: '16px' }}>
          {currentError}
        </p>
      )}

      {/* Form Content */}
      <form onSubmit={handleSubmit} className="zenith-form-body">
        {/* Channel Type Selector (only when creating) */}
        {!editChannel && (
          <div className="zenith-form-section">
            <label className="zenith-eyebrow-label" id="channel-type-label">
              CHANNEL TYPE
            </label>
            <div
              className="zenith-channel-type-grid"
              role="radiogroup"
              aria-labelledby="channel-type-label"
            >
              {/* Option 1: Text Channel */}
              <div
                className={`zenith-type-card ${type === 'text' ? 'is-selected' : ''}`}
                onClick={() => { if (!isBusy) setType('text'); }}
                role="radio"
                aria-checked={type === 'text'}
                tabIndex={0}
                onKeyDown={e => {
                  if (!isBusy && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    setType('text');
                  }
                }}
              >
                <div className="zenith-type-icon">
                  <Hash size={20} />
                </div>
                <div className="zenith-type-content">
                  <div className="zenith-type-title-row">
                    <span className="zenith-type-title">Text</span>
                    <span className="zenith-radio-dot">
                      {type === 'text' && <span className="zenith-radio-dot-inner" />}
                    </span>
                  </div>
                  <p className="zenith-type-desc">
                    Post messages, links, images, and attachments.
                  </p>
                </div>
              </div>

              {/* Option 2: Voice Channel */}
              <div
                className={`zenith-type-card ${type === 'voice' ? 'is-selected' : ''}`}
                onClick={() => { if (!isBusy) setType('voice'); }}
                role="radio"
                aria-checked={type === 'voice'}
                tabIndex={0}
                onKeyDown={e => {
                  if (!isBusy && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    setType('voice');
                  }
                }}
              >
                <div className="zenith-type-icon">
                  <Volume2 size={20} />
                </div>
                <div className="zenith-type-content">
                  <div className="zenith-type-title-row">
                    <span className="zenith-type-title">Voice</span>
                    <span className="zenith-radio-dot">
                      {type === 'voice' && <span className="zenith-radio-dot-inner" />}
                    </span>
                  </div>
                  <p className="zenith-type-desc">
                    Talk, hang out, and share your screen in real time.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Channel Name Field */}
        <div className="zenith-form-section">
          <label className="zenith-eyebrow-label" htmlFor="zenith-channel-name">
            CHANNEL NAME
          </label>
          <div className="zenith-input-prefix-wrap">
            <span className="zenith-input-prefix" aria-hidden="true">
              #
            </span>
            <input
              id="zenith-channel-name"
              name="name"
              className="zenith-input has-prefix"
              placeholder={type === 'voice' ? 'lounge' : 'new-channel'}
              value={name}
              onChange={e => {
                setName(e.target.value);
                setLocalError('');
              }}
              required
              disabled={isBusy}
              maxLength={80}
              autoFocus
            />
          </div>
        </div>

        {/* Topic Field */}
        <div className="zenith-form-section">
          <label className="zenith-eyebrow-label" htmlFor="zenith-channel-topic">
            TOPIC
          </label>
          <input
            id="zenith-channel-topic"
            name="topic"
            className="zenith-input"
            placeholder="What's this channel about?"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            maxLength={300}
            disabled={isBusy}
          />
          <span className="zenith-input-help">
            Visible to participants in the channel top header.
          </span>
        </div>

        {/* Extra controls when editing an existing channel */}
        {editChannel && (
          <>
            <div className="zenith-form-section">
              <label className="zenith-eyebrow-label" htmlFor="zenith-channel-position">
                ORDER
              </label>
              <input
                id="zenith-channel-position"
                type="number"
                disabled={isBusy}
                min="0"
                name="position"
                className="zenith-input"
                value={position}
                onChange={e => setPosition(Number(e.target.value))}
              />
            </div>

            {onDelete && (
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  className="zenith-btn-danger-outline"
                  onClick={handleDelete}
                  disabled={isBusy}
                >
                  <Trash2 size={14} />
                  <span>Delete channel</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* Modal Footer Actions */}
        <div className="zenith-modal-footer">
          <button
            type="button"
            className="zenith-btn-cancel"
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
            <span>{isBusy ? 'Saving…' : editChannel ? 'Save changes' : 'Create channel'}</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </form>

      {showDeleteConfirm && editChannel && (
        <ConfirmDialog
          open={true}
          title="Delete channel"
          message={`Are you sure you want to delete #${editChannel.name}? All messages and media in this channel will be permanently removed. This action cannot be undone.`}
          confirmLabel="Delete channel"
          variant="danger"
          icon={<Trash2 size={20} />}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            if (!onDelete) return;
            setLocalBusy(true);
            pending.current = true;
            setLocalError('');
            try {
              await onDelete();
              setShowDeleteConfirm(false);
              if (mounted.current) onClose();
            } catch (err) {
              if (mounted.current) setLocalError((err as Error).message || 'Failed to delete channel');
              throw err;
            } finally {
              pending.current = false;
              if (mounted.current) setLocalBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

export default ChannelModal;
