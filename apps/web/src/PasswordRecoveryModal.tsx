import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Eye, EyeOff, Lock, AlertCircle } from 'lucide-react';
import { Modal } from './components';
import { getSupabase } from './supabase';
import { api } from './api';
import type { Bootstrap } from '@haven/shared/types';

export function PasswordRecoveryModal({
  onClose,
  onSuccess,
  notify,
}: {
  onClose: () => void;
  onSuccess: (data: Bootstrap) => void;
  notify: (message: string) => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isMatching = Boolean(newPassword && confirmPassword && newPassword === confirmPassword);
  const isStrong = newPassword.length >= 10;
  const isMedium = newPassword.length >= 8 && newPassword.length < 10;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Password recovery is unavailable. Reopen the reset link and try again.');
      const { error: updateError } = await sb.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      notify('Password updated successfully! Welcome back to Haven.');
      onClose();

      if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      const data = await api<Bootstrap>('/bootstrap');
      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        <div className="recovery-header-title-group">
          <div className="recovery-lock-badge" aria-hidden="true">
            <Lock size={15} />
          </div>
          <span>Choose a new password</span>
        </div>
      }
      onClose={onClose}
    >
      <div className="recovery-modal">
        <p className="recovery-modal-description">
          Enter a new secure password for your Haven account (at least 8 characters).
        </p>

        {error && (
          <div className="auth-error-banner" role="alert">
            <AlertCircle size={16} className="auth-alert-icon" aria-hidden="true" />
            <p className="form-error">{error}</p>
          </div>
        )}

        <form className="auth-fields" onSubmit={handleSubmit}>
          {/* New Password */}
          <div className="auth-field">
            <div className="auth-field-label">
              <label htmlFor="recovery-new-password">NEW PASSWORD</label>
              <span className="auth-field-hint">
                {newPassword.length < 8 ? (
                  'MIN. 8 CHARS'
                ) : (
                  <span className="text-emerald font-semibold">
                    {isStrong ? 'STRONG' : 'SUFFICIENT'}
                  </span>
                )}
              </span>
            </div>
            <div className="auth-input-wrap">
              <input
                id="recovery-new-password"
                name="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                className="auth-input font-mono"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                required
                minLength={8}
                maxLength={128}
                autoFocus
                disabled={busy}
                value={newPassword}
                onChange={e => {
                  setNewPassword(e.target.value);
                  setError('');
                }}
              />
              <button
                type="button"
                className="auth-input-action"
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                title={showNewPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowNewPassword(!showNewPassword)}
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Visual Password Strength Meter Bar */}
            <div className="recovery-strength-meter-wrap">
              <div className="recovery-strength-meter">
                <div className={`meter-segment ${newPassword.length >= 4 ? 'filled active' : ''}`} />
                <div className={`meter-segment ${newPassword.length >= 8 ? 'filled active' : ''}`} />
                <div className={`meter-segment ${newPassword.length >= 10 ? 'filled active' : ''}`} />
                <div className={`meter-segment ${newPassword.length >= 14 ? 'filled active' : ''}`} />
              </div>
              {newPassword.length >= 8 && (
                <span className="recovery-strength-badge">
                  {isStrong ? 'STRONG' : 'SUFFICIENT'}
                </span>
              )}
            </div>
          </div>

          {/* Confirm Password */}
          <div className="auth-field">
            <div className="auth-field-label">
              <label htmlFor="recovery-confirm-password">CONFIRM NEW PASSWORD</label>
              {isMatching && (
                <span className="auth-match-indicator text-emerald">
                  <Check size={13} />
                  MATCHES
                </span>
              )}
            </div>
            <div className="auth-input-wrap">
              <input
                id="recovery-confirm-password"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                className="auth-input font-mono"
                autoComplete="new-password"
                placeholder="Repeat new password"
                required
                minLength={8}
                maxLength={128}
                disabled={busy}
                value={confirmPassword}
                onChange={e => {
                  setConfirmPassword(e.target.value);
                  setError('');
                }}
              />
              <button
                type="button"
                className="auth-input-action"
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-actions pt-2">
            <button
              type="submit"
              className="auth-submit-btn primary recovery-submit-btn"
              disabled={busy}
            >
              <span>{busy ? 'Updating…' : 'Update password'}</span>
              <ArrowRight size={17} />
            </button>

            <button
              type="button"
              className="recovery-cancel-btn"
              disabled={busy}
              onClick={onClose}
            >
              Cancel and return to sign in
            </button>
          </div>
        </form>

        {/* Security Note Footer */}
        <div className="recovery-security-footer">
          <span className="security-hash-tag">
            <span className="security-dot-pulse" />
            <span>Argon2id Hash Enforced</span>
          </span>
          <span className="security-shield-tag">HAVEN AUTH SHIELD</span>
        </div>
      </div>
    </Modal>
  );
}
export default PasswordRecoveryModal;
