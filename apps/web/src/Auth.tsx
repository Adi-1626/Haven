import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MessageSquare,
  MonitorUp,
  Shield,
  User as UserIcon,
  AlertCircle,
  Users
} from 'lucide-react';
import type { Bootstrap } from '@haven/shared/types';
import { normalizeLoginUsername, usernameCharacters } from '@haven/shared/auth';
import { api } from './api';
import { initSupabase, setRememberSession as configureSessionPersistence } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OrbitalBackground } from './OrbitalBackground';
import { AuthSteps } from './AuthSteps';
import { GlassRefraction } from './GlassRefraction';

export interface AuthProps {
  onLogin: (data: Bootstrap) => void;
  notify: (message: string) => void;
  pendingInvite?: string | null;
  onOpenInvite?: (code: string) => void;
  communityEntry?: ReactNode;
  initialView?: 'login' | 'register' | 'forgot_password';
}

export function Auth({
  onLogin,
  notify,
  pendingInvite,
  onOpenInvite,
  communityEntry,
  initialView = 'login'
}: AuthProps) {
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
  const [view, setView] = useState<'login' | 'register' | 'forgot_password'>(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configAttempt, setConfigAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setConfigError('');
    void initSupabase().then(client => {
      if (active) { setSupabaseClient(client); setAuthReady(true); }
    }).catch(failure => { if (active) setConfigError(failure.message || 'Unable to connect to Haven. Please try again.'); });
    return () => { active = false; };
  }, [configAttempt]);

  const isHosted = Boolean(supabaseClient);

  const handleHostedSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !supabaseClient) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      if (view === 'forgot_password') {
        if (!email) throw new Error('Please enter your account email');
        const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (resetError) throw resetError;
        setSuccess('If an account exists with this email, a password reset link has been sent. Please check your inbox.');
        return;
      }

      if (view === 'register') {
        if (!email) throw new Error('Please enter your email address');
        // Stage 1 collects credentials only. The username, display name and picture are chosen in
        // the separate first-time profile setup after the email address has been verified.
        const { data, error: signUpError } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (signUpError) throw signUpError;
        if (data.session && data.user?.email_confirmed_at) {
          const bootstrapData = await api<Bootstrap>('/bootstrap');
          onLogin(bootstrapData);
        } else {
          setSuccess('Account created! Please check your email to verify your address before signing in.');
          setView('login');
        }
      } else {
        if (!email) throw new Error('Please enter your email');
        await configureSessionPersistence(rememberSession);
        const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (data.user && !data.user.email_confirmed_at) {
          await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => {});
          throw new Error('Your email address has not been verified yet. Please check your inbox for the confirmation email.');
        }
        if (data.session) {
          const bootstrapData = await api<Bootstrap>('/bootstrap');
          onLogin(bootstrapData);
        }
      }
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : 'Authentication failed. Please try again.';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
        setError('Cannot reach Haven. Check your connection and try again.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLocalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.username = view === 'register' ? String(values.username).trim() : normalizeLoginUsername(String(values.username));
    setBusy(true);
    setError('');

    try {
      await api(`/auth/${view === 'register' ? 'register' : 'login'}`, 'POST', { ...values, rememberSession });
      const data = await api<Bootstrap>('/bootstrap');
      onLogin(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Dynamic Animated Cosmic Background */}
      <OrbitalBackground />
      <GlassRefraction />

      {/* ================= LEFT HERO PANEL (Desktop >= 900px) ================= */}
      <section className="auth-art">
        {/* Brand Header */}
        <div className="auth-hero-top">
          <img
            src="/haven_newlogo.png"
            alt="Haven"
            className="auth-brand-logo"
          />
        </div>

        {/* Center: Main Showcase Block */}
        <div className="auth-hero-center">
          {/* Eyebrow Chip */}
          <div className="auth-eyebrow-chip">
            <span className="auth-dot" />
            <span>YOUR PEOPLE. YOUR PLACE.</span>
          </div>

          {/* Headline */}
          <h1 className="auth-headline">
            A little space.<br />
            A lot of <span className="auth-headline-highlight">connection.</span>
          </h1>

          {/* Subtitle */}
          <p className="auth-subtitle">
            For late-night conversations, crystal-clear shared screens, and the people who get you. Zero tracking, zero telemetry.
          </p>

          {/* Feature List (Approved Reference Layout) */}
          <div className="auth-feature-rows">
            <div className="auth-feature-row">
              <div className="auth-feature-row-icon">
                <MessageSquare size={17} />
              </div>
              <span className="auth-feature-row-text">Crystal-clear voice & video</span>
            </div>
            <div className="auth-feature-row">
              <div className="auth-feature-row-icon">
                <MonitorUp size={17} />
              </div>
              <span className="auth-feature-row-text">Native 60fps screen sharing</span>
            </div>
            <div className="auth-feature-row">
              <div className="auth-feature-row-icon">
                <Shield size={17} />
              </div>
              <span className="auth-feature-row-text">Private & telemetry-free</span>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="auth-hero-footer">
          <span className="auth-footer-tag">MAKE YOURSELF AT HOME · EST. 2026</span>
        </div>
      </section>

      {/* ================= RIGHT AUTHENTICATION PANEL ================= */}
      <section className="auth-form-wrap">
        <div className="auth-container">
          {/* Compact Viewport Header (Visible when Left Hero is hidden: 500x550 / Mobile) */}
          <div className="auth-compact-header">
            <img
              src="/haven_newlogo.png"
              alt="Haven"
              className="auth-brand-logo-compact"
            />
          </div>

          {/* Pending Community Invitation Card */}
          {pendingInvite && (
            <div
              className="auth-invite-banner"
              onClick={() => onOpenInvite?.(pendingInvite)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') onOpenInvite?.(pendingInvite); }}
            >
              <div className="auth-invite-left">
                <div className="auth-invite-icon">
                  <Users size={18} />
                </div>
                <div className="auth-invite-text">
                  <strong>Community Invitation</strong>
                  <small>Invite code: {pendingInvite}</small>
                </div>
              </div>
              <span className="auth-invite-badge">Accept on sign in</span>
            </div>
          )}

          {/* Main Authentication Card */}
          <div className="auth-card">
            {/* Card Header */}
            <div className="auth-card-header">
              {isHosted && view === 'register' ? <AuthSteps current={1} /> : (
                <div className="auth-card-meta">
                  <span className="auth-meta-eyebrow">WELCOME TO HAVEN</span>
                </div>
              )}

              <h2>
                {view === 'forgot_password'
                  ? 'Reset password.'
                  : view === 'register'
                    ? 'Find your place.'
                    : 'Welcome back.'}
              </h2>

              <p className="auth-card-description">
                {view === 'forgot_password'
                  ? 'We’ll email you a secure link to reset your password.'
                  : view === 'register'
                    ? isHosted
                      ? 'Start with your email. You’ll choose your name and picture next.'
                      : 'Good things start with good company.'
                    : isHosted
                      ? 'Sign in with your email and password.'
                      : 'Sign in with your username, not your display name.'}
              </p>
            </div>

            {/* Status / Success Alert */}
            {success && (
              <div className="auth-success-banner">
                <CheckCircle2 size={16} className="auth-alert-icon" aria-hidden="true" />
                <p className="auth-success" role="status">{success}</p>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="auth-error-banner">
                <AlertCircle size={16} className="auth-alert-icon" aria-hidden="true" />
                <p className="form-error" role="alert">{error}</p>
              </div>
            )}

            {/* Auth Form */}
            {!authReady ? <div className="auth-fields">
              <p className="quiet" role={configError ? 'alert' : 'status'}>{configError || 'Connecting to Haven…'}</p>
              {configError && <button className="auth-submit-btn primary" type="button" onClick={() => setConfigAttempt(value => value + 1)}>Retry connection</button>}
            </div> : <form
              className="auth-fields"
              onSubmit={isHosted ? handleHostedSubmit : handleLocalSubmit}
            >
              {isHosted ? (
                <>
                  <div className="auth-field">
                    <div className="auth-field-label">
                      <label htmlFor="auth-email">EMAIL ADDRESS</label>
                    </div>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon left">
                        <Mail size={16} />
                      </span>
                      <input
                        id="auth-email"
                        type="email"
                        name="email"
                        className="auth-input with-left-icon"
                        autoComplete="email"
                        placeholder="you@example.com"
                        required
                        disabled={busy}
                      />
                    </div>
                  </div>

                  {view !== 'forgot_password' && (
                    <div className="auth-field">
                      <div className="auth-field-label">
                        <label htmlFor="auth-password">PASSWORD</label>
                        {view === 'login' && (
                          <button
                            type="button"
                            className="auth-forgot-link"
                            onClick={() => {
                              setView('forgot_password');
                              setError('');
                              setSuccess('');
                            }}
                          >
                            Forgot your password?
                          </button>
                        )}
                      </div>
                      <div className="auth-input-wrap">
                        <span className="auth-input-icon left">
                          <Lock size={16} />
                        </span>
                        <input
                          id="auth-password"
                          type={showPassword ? 'text' : 'password'}
                          name="password"
                          className="auth-input with-left-icon font-mono"
                          autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                          placeholder={view === 'register' ? 'At least 8 characters' : 'Your password'}
                          required
                          minLength={8}
                          maxLength={128}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="auth-input-action"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          title={showPassword ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {view === 'login' && (
                    <div className="auth-remember-row">
                      <label htmlFor="auth-remember" className="auth-checkbox-label">
                        <input
                          type="checkbox"
                          id="auth-remember"
                          checked={rememberSession}
                          onChange={e => setRememberSession(e.target.checked)}
                          className="auth-checkbox"
                        />
                        <span>Remember this session</span>
                      </label>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="auth-submit-btn primary"
                    disabled={busy}
                  >
                    <span>
                      {busy
                        ? 'One moment…'
                        : view === 'forgot_password'
                          ? 'Send recovery link'
                          : view === 'register'
                            ? 'Create your account'
                            : 'Sign in'}
                    </span>
                    <ArrowRight size={17} />
                  </button>
                </>
              ) : (
                <>
                  {view === 'register' && (
                    <div className="auth-field">
                      <div className="auth-field-label">
                        <label htmlFor="local-display-name">DISPLAY NAME</label>
                      </div>
                      <div className="auth-input-wrap">
                        <span className="auth-input-icon left">
                          <UserIcon size={16} />
                        </span>
                        <input
                          id="local-display-name"
                          name="displayName"
                          className="auth-input with-left-icon"
                          autoComplete="nickname"
                          placeholder="What should we call you?"
                          maxLength={50}
                          disabled={busy}
                        />
                      </div>
                    </div>
                  )}

                  <div className="auth-field">
                    <div className="auth-field-label">
                      <label htmlFor="local-username">USERNAME</label>
                    </div>
                    <div className="auth-input-wrap">
                      <span className="auth-input-prefix">@</span>
                      <input
                        id="local-username"
                        name="username"
                        className="auth-input with-prefix"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder={view === 'register' ? 'Your unique username' : 'Username or @username'}
                        required
                        minLength={view === 'register' ? 3 : undefined}
                        maxLength={view === 'register' ? 32 : 128}
                        pattern={view === 'register' ? usernameCharacters : undefined}
                        title={view === 'register' ? '3–32 letters, numbers, underscores, dots or hyphens' : undefined}
                        disabled={busy}
                      />
                    </div>
                  </div>

                  <div className="auth-field">
                    <div className="auth-field-label">
                      <label htmlFor="local-password">PASSWORD</label>
                    </div>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon left">
                        <Lock size={16} />
                      </span>
                      <input
                        id="local-password"
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        className="auth-input with-left-icon font-mono"
                        autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                        placeholder={view === 'register' ? 'At least 8 characters' : 'Your password'}
                        required
                        minLength={view === 'register' ? 8 : 1}
                        maxLength={128}
                        disabled={busy}
                      />
                      <button
                        type="button"
                        className="auth-input-action"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        title={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {view === 'register' && error === 'Username is already taken' && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setView('login');
                        setError('');
                      }}
                    >
                      Sign into this account
                    </button>
                  )}

                  {view === 'login' && (
                    <div className="auth-remember-row">
                      <label htmlFor="local-remember" className="auth-checkbox-label">
                        <input
                          type="checkbox"
                          id="local-remember"
                          checked={rememberSession}
                          onChange={e => setRememberSession(e.target.checked)}
                          className="auth-checkbox"
                        />
                        <span>Remember this session</span>
                      </label>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="auth-submit-btn primary"
                    disabled={busy}
                  >
                    <span>
                      {busy
                        ? 'One moment…'
                        : view === 'register'
                          ? 'Create your account'
                          : 'Sign in'}
                    </span>
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
            </form>}

            {/* Footer View Switch */}
            <div className="auth-card-footer">
              {view === 'forgot_password' ? (
                <p className="auth-toggle">
                  Remembered your password?{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setView('login');
                      setError('');
                      setSuccess('');
                    }}
                  >
                    Back to sign in
                  </button>
                </p>
              ) : (
                <p className="auth-toggle">
                  {view === 'register' ? 'Already have a place here?' : 'New around here?'}{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setView(view === 'register' ? 'login' : 'register');
                      setError('');
                      setSuccess('');
                    }}
                  >
                    {view === 'register' ? 'Sign in' : 'Join Haven'}
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* Bottom Security Guarantee (Approved Reference Layout) */}
          <div className="auth-privacy-note">
            <Shield size={16} className="auth-shield-icon" />
            <div className="auth-privacy-text">
              <strong>Your conversations belong to you.</strong>
              <span>Private by default. No tracking. No telemetry.</span>
            </div>
          </div>
        </div>
      </section>
      {communityEntry}
    </div>
  );
}
export default Auth;
