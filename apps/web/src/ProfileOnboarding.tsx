import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Camera, Check, Loader2, LogOut, Trash2, XCircle } from 'lucide-react';
import type { User } from '@haven/shared/types';
import { placeholderUsername, usernameProblem } from '@haven/shared/auth';
import { api } from './api';
import { OrbitalBackground } from './OrbitalBackground';
import { AuthSteps } from './AuthSteps';
import { GlassRefraction } from './GlassRefraction';
import { photoProblem, squareAvatar } from './profile-photo';

interface ProfileOnboardingProps {
  user: User;
  /** Called after the account profile is saved on the server. The parent reloads the account and enters Haven. */
  onComplete: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: string }
  | { state: 'error' };

const cleanUsername = (value: string) => value.trim().replace(/^@/, '');

export function ProfileOnboarding({ user, onComplete, onSignOut }: ProfileOnboardingProps) {
  // The placeholder identity assigned at registration is never offered as a suggestion.
  const [username, setUsername] = useState(placeholderUsername.test(user.username) ? '' : user.username);
  const [displayName, setDisplayName] = useState(placeholderUsername.test(user.displayName) ? '' : user.displayName);
  const [photo, setPhoto] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  const [existingAvatar] = useState(user.avatar);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const uploaded = useRef<Blob | null>(null);
  const identifier = useId();
  const statusId = `${identifier}-username-status`;

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  // Format problems are reported instantly; availability is checked against the server after a short pause.
  useEffect(() => {
    const candidate = cleanUsername(username);
    if (!candidate) { setAvailability({ state: 'idle' }); return; }
    const problem = usernameProblem(candidate);
    if (problem) { setAvailability({ state: 'unavailable', reason: problem }); return; }
    let cancelled = false;
    setAvailability({ state: 'checking' });
    const timer = setTimeout(() => {
      api<{ available: boolean; reason?: string }>(`/users/username-available?username=${encodeURIComponent(candidate)}`)
        .then(result => { if (!cancelled) setAvailability(result.available ? { state: 'available' } : { state: 'unavailable', reason: result.reason ?? 'That username is not available' }); })
        .catch(() => { if (!cancelled) setAvailability({ state: 'error' }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [username]);

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) { setPhotoError(problem); return; }
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const blob = await squareAvatar(file);
      setPhoto({ blob, previewUrl: URL.createObjectURL(blob) });
      uploaded.current = null;
    } catch (failure) {
      setPhotoError(failure instanceof Error ? failure.message : 'That image could not be used');
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void choosePhoto(event.dataTransfer.files[0]);
  };

  const ready = Boolean(displayName.trim()) && (availability.state === 'available' || availability.state === 'error') && !busy && !photoBusy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      if (photo && uploaded.current !== photo.blob) {
        const form = new FormData();
        form.append('file', photo.blob, 'avatar.webp');
        await api('/users/me/avatar', 'POST', form).catch(failure => { throw new Error(`Your picture could not be saved: ${failure instanceof Error ? failure.message : 'try again'}`); });
        uploaded.current = photo.blob;
      }
      await api('/users/me/profile', 'POST', { username: cleanUsername(username), displayName: displayName.trim() });
      await onComplete();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not complete your profile. Please try again.';
      if (/already taken/i.test(message)) {
        setAvailability({ state: 'unavailable', reason: 'That username was just taken. Try another.' });
        // The field is disabled while submitting; focus it once the form is enabled again.
        requestAnimationFrame(() => requestAnimationFrame(() => usernameInput.current?.focus()));
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const preview = photo?.previewUrl ?? null;
  const initial = Array.from(displayName.trim() || cleanUsername(username) || '?')[0]?.toUpperCase() ?? '?';
  const invalid = availability.state === 'unavailable';

  return (
    <div className="auth-page auth-onboarding-page">
      <OrbitalBackground />
      <GlassRefraction />
      <div className="auth-onboarding-container">
        <div className="auth-onboarding-brand">
          <img src="/haven_newlogo.png" alt="Haven" className="auth-brand-logo-centered" />
        </div>

        <div className="auth-card auth-onboarding-card">
          <div className="auth-card-header">
            <AuthSteps current={2} />
            <h2>Make it yours.</h2>
            <p className="auth-card-description">Add a photo and choose how people find and see you in Haven.</p>
          </div>

          {error && (
            <div className="auth-error-banner">
              <AlertCircle size={16} className="auth-alert-icon" aria-hidden="true" />
              <p className="form-error" role="alert">{error}</p>
            </div>
          )}

          <form className="auth-fields" onSubmit={submit} noValidate>
            <div className="onboarding-avatar-section">
              <div
                className={`onboarding-avatar-drop${dragging ? ' dragging' : ''}`}
                onDragOver={event => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
              >
                <button
                  type="button"
                  className="onboarding-avatar-circle"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                  aria-label={preview ? 'Change profile picture' : 'Upload profile picture'}
                >
                  {preview ? <img src={preview} alt="Your profile picture preview" className="onboarding-avatar-img" />
                    : existingAvatar && /^https:/i.test(existingAvatar) ? <img src={existingAvatar} alt="Your profile picture" className="onboarding-avatar-img" referrerPolicy="no-referrer" />
                    : <span className="onboarding-avatar-empty" aria-hidden="true">{photoBusy ? <Loader2 size={26} className="auth-spin" /> : displayName.trim() || username.trim() ? <b>{initial}</b> : <Camera size={28} />}</span>}
                  <span className="onboarding-avatar-overlay" aria-hidden="true"><Camera size={18} /></span>
                </button>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => void choosePhoto(event.target.files?.[0])} />
              </div>
              <div className="onboarding-avatar-actions">
                <button type="button" className="onboarding-link-btn" onClick={() => fileInput.current?.click()} disabled={busy || photoBusy}>
                  <Camera size={14} aria-hidden="true" />
                  <span>{preview ? 'Choose a different photo' : 'Upload a photo'}</span>
                </button>
                {preview && (
                  <button type="button" className="onboarding-link-btn subtle" onClick={() => { setPhoto(null); uploaded.current = null; }} disabled={busy}>
                    <Trash2 size={14} aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
              <span className="auth-field-hint">{photoError ? <span className="onboarding-photo-error" role="alert">{photoError}</span> : 'Optional · PNG, JPEG, WebP or GIF · you can change it later'}</span>
            </div>

            <div className="auth-field">
              <div className="auth-field-label"><label htmlFor={`${identifier}-username`}>USERNAME</label></div>
              <div className={`auth-input-wrap${invalid ? ' invalid' : availability.state === 'available' ? ' valid' : ''}`}>
                <span className="auth-input-prefix">@</span>
                <input
                  ref={usernameInput}
                  id={`${identifier}-username`}
                  name="username"
                  className="auth-input with-prefix with-status"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Pick a unique username"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  maxLength={33}
                  aria-invalid={invalid}
                  aria-describedby={statusId}
                  disabled={busy}
                />
                <span className="auth-input-status" aria-hidden="true">
                  {availability.state === 'checking' && <Loader2 size={16} className="auth-spin" />}
                  {availability.state === 'available' && <Check size={16} className="ok" />}
                  {availability.state === 'unavailable' && <XCircle size={16} className="bad" />}
                </span>
              </div>
              <p id={statusId} role="status" aria-live="polite" className={`auth-field-status ${availability.state}`}>
                {availability.state === 'idle' && '3–32 letters, numbers, underscores, dots or hyphens'}
                {availability.state === 'checking' && 'Checking availability…'}
                {availability.state === 'available' && `@${cleanUsername(username)} is available`}
                {availability.state === 'unavailable' && availability.reason}
                {availability.state === 'error' && 'Couldn’t check right now — we’ll confirm when you continue'}
              </p>
            </div>

            <div className="auth-field">
              <div className="auth-field-label"><label htmlFor={`${identifier}-display`}>DISPLAY NAME</label></div>
              <div className="auth-input-wrap">
                <input
                  id={`${identifier}-display`}
                  name="displayName"
                  className="auth-input"
                  autoComplete="nickname"
                  placeholder="What should we call you?"
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  maxLength={50}
                  disabled={busy}
                />
              </div>
            </div>

            <button type="submit" className="auth-submit-btn primary" disabled={!ready}>
              <span>{busy ? 'Setting up your profile…' : 'Complete Profile'}</span>
              <ArrowRight size={17} />
            </button>
          </form>

          <div className="auth-card-footer">
            <p className="auth-toggle">
              Not your account?{' '}
              <button type="button" disabled={busy} onClick={() => void onSignOut()}><LogOut size={13} aria-hidden="true" /> Sign out</button>
            </p>
          </div>
        </div>

        <div className="auth-privacy-note">
          <span>Private by default. Your profile is stored securely on Haven.</span>
        </div>
      </div>
    </div>
  );
}
export default ProfileOnboarding;
