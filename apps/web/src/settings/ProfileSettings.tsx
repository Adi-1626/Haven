import { useState, useId, type FormEvent } from 'react';
import { Lock, Save, RotateCcw, Check, AlertCircle } from 'lucide-react';
import type { User } from '@haven/shared/types';
import { AvatarPicker } from './AvatarPicker';
import { SettingsSection } from './SettingsSection';

export interface ProfileDraft {
  displayName: string;
  avatar: string;
  bio: string;
  status: string;
  avatarFile: Blob | null;
  previewUrl: string | null;
}

interface ProfileSettingsProps {
  me: User;
  draft: ProfileDraft;
  onDraftChange: (
    updater: Partial<ProfileDraft> | ((prev: ProfileDraft) => ProfileDraft),
    field?: 'displayName' | 'avatar' | 'bio' | 'status'
  ) => void;
  onSave: () => Promise<void>;
  onReset: () => void;
  isDirty: boolean;
  busy: boolean;
  error?: string;
}

export function ProfileSettings({
  me,
  draft,
  onDraftChange,
  onSave,
  onReset,
  isDirty,
  busy,
  error,
}: ProfileSettingsProps) {
  const [validationError, setValidationError] = useState('');
  const displayNameId = useId();
  const bioId = useId();
  const statusId = useId();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setValidationError('');

    const trimmedName = draft.displayName.trim();
    if (!trimmedName) {
      setValidationError('Display name cannot be empty');
      return;
    }
    if (trimmedName.length > 50) {
      setValidationError('Display name must be 50 characters or fewer');
      return;
    }
    if (draft.bio.length > 500) {
      setValidationError('Bio must be 500 characters or fewer');
      return;
    }
    if (draft.avatar.length > 300) {
      setValidationError('Avatar URL must be 300 characters or fewer');
      return;
    }

    try {
      await onSave();
    } catch (caught) {
      setValidationError(caught instanceof Error ? caught.message : 'Could not save profile');
    }
  };

  return (
    <form className="profile-settings-form" onSubmit={handleSubmit} noValidate>
      {/* Avatar Header & Identity Banner */}
      <div className="profile-settings-header-card">
        <div className="profile-settings-avatar-wrapper">
          <AvatarPicker
            user={me}
            avatarValue={draft.avatar}
            avatarFile={draft.avatarFile}
            previewUrl={draft.previewUrl}
            disabled={busy}
            onChange={(avatar, file, preview) => {
              onDraftChange(prev => ({
                ...prev,
                avatar,
                avatarFile: file,
                previewUrl: preview,
              }), 'avatar');
            }}
          />
        </div>

        <div className="profile-settings-identity-summary">
          <div className="profile-settings-avatar">
            <span className="profile-settings-username">@{me.username}</span>
          </div>
          <p className="profile-settings-tagline">
            Your profile, your identity across Haven voice and chat.
          </p>
        </div>
      </div>

      {(validationError || error) && (
        <div className="form-error profile-form-error" role="alert">
          <AlertCircle size={15} />
          <span>{validationError || error}</span>
        </div>
      )}

      {/* Identity Fields Section */}
      <SettingsSection title="Identity & Presentation">
        <div className="settings-fields-group">
          {/* Display Name */}
          <label className="settings-field-label" htmlFor={displayNameId}>
            <div className="field-label-text">
              <span>DISPLAY NAME</span>
              <span className="field-limit-counter">{draft.displayName.length}/50</span>
            </div>
            <input
              id={displayNameId}
              name="displayName"
              type="text"
              required
              maxLength={50}
              disabled={busy}
              value={draft.displayName}
              onChange={event => {
                setValidationError('');
                onDraftChange({ displayName: event.target.value }, 'displayName');
              }}
              placeholder="How friends will see you"
            />
          </label>

          {/* Read-only Username */}
          <div className="settings-field-label">
            <div className="field-label-text">
              <span>USERNAME</span>
              <span className="field-badge-readonly">
                <Lock size={10} />
                <span>Read-only</span>
              </span>
            </div>
            <div className="readonly-username-container">
              <span className="readonly-username-prefix">@</span>
              <input
                type="text"
                readOnly
                disabled
                value={me.username}
                className="readonly-username-input"
                aria-label="Username (read-only)"
              />
            </div>
            <span className="field-hint">
              Username was chosen during account onboarding and cannot be modified.
            </span>
          </div>

          {/* Bio / About you */}
          <label className="settings-field-label" htmlFor={bioId}>
            <div className="field-label-text">
              <span>ABOUT YOU</span>
              <span className="field-limit-counter">{draft.bio.length}/500</span>
            </div>
            <textarea
              id={bioId}
              name="bio"
              rows={3}
              maxLength={500}
              disabled={busy}
              value={draft.bio}
              onChange={event => {
                setValidationError('');
                onDraftChange({ bio: event.target.value }, 'bio');
              }}
              placeholder="A little about yourself, your gaming tech, or projects…"
            />
          </label>

          {/* Presence Status */}
          <label className="settings-field-label" htmlFor={statusId}>
            <div className="field-label-text">
              <span>PRESENCE</span>
            </div>
            <div className="settings-select-wrapper">
              <select
                id={statusId}
                name="status"
                disabled={busy}
                value={draft.status}
                onChange={event => onDraftChange({ status: event.target.value }, 'status')}
              >
                <option value="online">Online · visible and active</option>
                <option value="idle">Away · idle</option>
                <option value="dnd">Do not disturb · mute notifications</option>
                <option value="offline">Invisible · appear offline</option>
              </select>
            </div>
          </label>
        </div>
      </SettingsSection>

      {/* Floating or Footer Action Bar */}
      <div className={`profile-actions-bar ${isDirty ? 'is-dirty' : ''}`}>
        <div className="profile-actions-status">
          {isDirty ? (
            <span className="profile-dirty-indicator">Unsaved changes in draft</span>
          ) : (
            <span className="profile-clean-indicator">
              <Check size={14} /> Profile is up to date
            </span>
          )}
        </div>

        <div className="profile-actions-buttons">
          {isDirty && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setValidationError('');
                onReset();
              }}
            >
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          )}

          <button
            type="submit"
            className="primary"
            disabled={busy || !isDirty}
          >
            <Save size={15} />
            <span>{busy ? 'Saving…' : 'Save profile'}</span>
          </button>
        </div>
      </div>
    </form>
  );
}
