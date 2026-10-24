import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  User as UserIcon,
  Mic,
  Monitor,
  Bell,
  LogOut,
  X,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import type { Server, User } from '@haven/shared/types';
import type { useMedia } from '../media';
import type { Preferences } from '../preferences';
import { ProfileSettings, type ProfileDraft } from './ProfileSettings';
import { VoiceSettings } from './VoiceSettings';
import { AppGamingSettings } from './AppGamingSettings';
import { NotificationSettings } from './NotificationSettings';
import { isHostedAuth } from '../supabase';
import './settings.css';

export type SettingsCategory = 'profile' | 'voice & video' | 'desktop & gaming' | 'notifications';

interface SettingsDialogProps {
  me: User;
  media: ReturnType<typeof useMedia>;
  servers?: Server[];
  busy: boolean;
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
  initialTab?: string;
  onSaveProfile: (patch: {
    displayName: string;
    bio: string;
    avatar?: string;
    status: string;
    avatarFile: Blob | null;
  }) => Promise<User | void>;
  /** 'local' (default) ends this device's session; 'global' signs out every device (Hosted Mode only). */
  onLogout: (scope?: 'local' | 'global') => void;
  onClose: () => void;
}

export function SettingsDialog({
  me,
  media,
  servers,
  busy,
  preferences,
  onPreferences,
  initialTab = 'profile',
  onSaveProfile,
  onLogout,
  onClose,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const discardTitleId = useId();
  const discardOpenerRef = useRef<HTMLElement | null>(null);
  const keepEditingBtnRef = useRef<HTMLButtonElement>(null);
  const discardBtnRef = useRef<HTMLButtonElement>(null);

  // Capture the external opener on first render before the dialog becomes modal and focuses itself.
  // Never capture document.body or an element inside the dialog itself.
  if (!openerRef.current && typeof document !== 'undefined') {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !dialogRef.current?.contains(active)) {
      openerRef.current = active;
    }
  }

  // Restore focus to opener when settings dialog unmounts
  useEffect(() => {
    // If not captured during initial render, capture only if outside dialog and not body
    if (!openerRef.current) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !dialogRef.current?.contains(active)) {
        openerRef.current = active;
      }
    }

    return () => {
      // Close native dialog if still open to remove modal inertness on outer document
      if (dialogRef.current?.open) {
        try {
          dialogRef.current.close();
        } catch {}
      }
      const opener = openerRef.current;
      if (opener && opener.isConnected) {
        opener.focus();
      } else {
        const fallback = document.querySelector<HTMLElement>(
          '.user-panel .user-settings, .server-icon[aria-label="Settings"], .my-profile'
        );
        fallback?.focus();
      }
    };
  }, []);

  // Active category tab
  const [tab, setTab] = useState<SettingsCategory>(
    (['profile', 'voice & video', 'desktop & gaming', 'notifications'].includes(initialTab)
      ? initialTab
      : 'profile') as SettingsCategory
  );

  // In compact single-pane view, whether we are viewing the category list or the detail panel
  const [compactDetailOpen, setCompactDetailOpen] = useState(true);

  // Authoritative baseline user state (tracks server baseline)
  const [baseline, setBaseline] = useState<User>(me);

  // Track which fields have been touched/edited by the user
  const [touchedFields, setTouchedFields] = useState<Set<'displayName' | 'avatar' | 'bio' | 'status'>>(
    () => new Set()
  );

  // Unsaved profile draft state
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    displayName: me.displayName || '',
    avatar: me.avatar || '',
    bio: me.bio || '',
    status: me.status || 'online',
    avatarFile: null,
    previewUrl: null,
  }));

  // Discard confirmation dialog
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<'close' | 'logout' | 'logout-all' | null>(null);

  // Focus Keep editing button when discard confirm opens
  useEffect(() => {
    if (showDiscardConfirm) {
      discardOpenerRef.current = document.activeElement as HTMLElement | null;
      keepEditingBtnRef.current?.focus();
    }
  }, [showDiscardConfirm]);

  // Calculate dirty state
  const isDirty = useMemo(() => {
    const nameDirty = touchedFields.has('displayName') && draft.displayName.trim() !== (baseline.displayName || '').trim();
    const avatarDirty = draft.avatarFile !== null || (touchedFields.has('avatar') && draft.avatar !== (baseline.avatar || ''));
    const bioDirty = touchedFields.has('bio') && draft.bio !== (baseline.bio || '');
    const statusDirty = touchedFields.has('status') && draft.status !== (baseline.status || 'online');
    return nameDirty || avatarDirty || bioDirty || statusDirty;
  }, [draft, baseline, touchedFields]);

  // Sync draft when authenticated user updates externally:
  // Pristine fields adopt canonical updates; genuine local edits remain protected
  useEffect(() => {
    setDraft(prev => {
      let changed = false;
      const next = { ...prev };

      // Display name
      if (!touchedFields.has('displayName') || prev.displayName.trim() === (baseline.displayName || '').trim()) {
        if (next.displayName !== (me.displayName || '')) {
          next.displayName = me.displayName || '';
          changed = true;
        }
      }

      // Avatar (if no local avatar file selected and avatar wasn't edited away from baseline)
      if (prev.avatarFile === null && (!touchedFields.has('avatar') || prev.avatar === (baseline.avatar || ''))) {
        if (next.avatar !== (me.avatar || '')) {
          next.avatar = me.avatar || '';
          changed = true;
        }
      }

      // Bio
      if (!touchedFields.has('bio') || prev.bio === (baseline.bio || '')) {
        if (next.bio !== (me.bio || '')) {
          next.bio = me.bio || '';
          changed = true;
        }
      }

      // Status
      if (!touchedFields.has('status') || prev.status === (baseline.status || 'online')) {
        if (next.status !== (me.status || 'online')) {
          next.status = me.status || 'online';
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    setBaseline(me);
  }, [me]);

  // Clean up preview object URL on unmount
  useEffect(() => {
    return () => {
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    };
  }, [draft.previewUrl]);

  // Native HTML Dialog open & cancel listener
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (!element.open) {
      element.showModal();
    }

    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (showDiscardConfirm) {
        cancelDiscard();
        return;
      }
      attemptClose();
    };

    element.addEventListener('cancel', handleCancel);
    return () => element.removeEventListener('cancel', handleCancel);
  });

  const attemptClose = () => {
    if (isDirty) {
      setPendingAction('close');
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const attemptLogout = (scope: 'local' | 'global' = 'local') => {
    if (isDirty) {
      setPendingAction(scope === 'global' ? 'logout-all' : 'logout');
      setShowDiscardConfirm(true);
    } else {
      onLogout(scope);
    }
  };

  const confirmDiscard = () => {
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    setDraft({
      displayName: baseline.displayName || '',
      avatar: baseline.avatar || '',
      bio: baseline.bio || '',
      status: baseline.status || 'online',
      avatarFile: null,
      previewUrl: null,
    });
    setTouchedFields(new Set());
    setShowDiscardConfirm(false);

    if (pendingAction === 'close') {
      onClose();
    } else if (pendingAction === 'logout') {
      onLogout('local');
    } else if (pendingAction === 'logout-all') {
      onLogout('global');
    }
    setPendingAction(null);
  };

  const cancelDiscard = () => {
    setShowDiscardConfirm(false);
    setPendingAction(null);
    if (discardOpenerRef.current && discardOpenerRef.current.isConnected) {
      discardOpenerRef.current.focus();
    }
  };

  const handleDiscardKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelDiscard();
      return;
    }
    if (event.key === 'Tab') {
      const keepBtn = keepEditingBtnRef.current;
      const discBtn = discardBtnRef.current;
      if (!keepBtn || !discBtn) return;
      if (document.activeElement !== keepBtn && document.activeElement !== discBtn) {
        event.preventDefault();
        keepBtn.focus();
        return;
      }
      if (event.shiftKey) {
        if (document.activeElement === keepBtn) {
          event.preventDefault();
          discBtn.focus();
        }
      } else {
        if (document.activeElement === discBtn) {
          event.preventDefault();
          keepBtn.focus();
        }
      }
    }
  };

  const handleResetDraft = () => {
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    setDraft({
      displayName: baseline.displayName || '',
      avatar: baseline.avatar || '',
      bio: baseline.bio || '',
      status: baseline.status || 'online',
      avatarFile: null,
      previewUrl: null,
    });
    setTouchedFields(new Set());
  };

  const handleDraftChange = (
    updater: Partial<ProfileDraft> | ((prev: ProfileDraft) => ProfileDraft),
    field?: 'displayName' | 'avatar' | 'bio' | 'status'
  ) => {
    if (field) {
      setTouchedFields(prev => {
        if (prev.has(field)) return prev;
        const next = new Set(prev);
        next.add(field);
        return next;
      });
    }
    setDraft(prev => {
      const patch = typeof updater === 'function' ? updater(prev) : updater;
      if (!field) {
        setTouchedFields(touched => {
          let updated = false;
          const next = new Set(touched);
          if ('displayName' in patch && !next.has('displayName')) { next.add('displayName'); updated = true; }
          if (('avatar' in patch || 'avatarFile' in patch) && !next.has('avatar')) { next.add('avatar'); updated = true; }
          if ('bio' in patch && !next.has('bio')) { next.add('bio'); updated = true; }
          if ('status' in patch && !next.has('status')) { next.add('status'); updated = true; }
          return updated ? next : touched;
        });
      }
      return typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
    });
  };

  const handleSaveProfile = async () => {
    try {
      const savedUser = await onSaveProfile({
        displayName: draft.displayName.trim(),
        bio: draft.bio,
        avatar: draft.avatarFile ? undefined : draft.avatar,
        status: draft.status,
        avatarFile: draft.avatarFile,
      });

      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);

      const confirmedAvatar = (savedUser && 'avatar' in savedUser ? savedUser.avatar : null) ?? (draft.avatarFile ? (me.avatar ?? '') : draft.avatar);
      const nextUser: User = {
        ...me,
        ...(savedUser || {}),
        displayName: draft.displayName.trim(),
        bio: draft.bio,
        status: (draft.status as User['status']) || 'online',
        avatar: confirmedAvatar || '',
      };

      setBaseline(nextUser);
      setDraft({
        displayName: nextUser.displayName || '',
        avatar: confirmedAvatar || '',
        bio: nextUser.bio || '',
        status: nextUser.status || 'online',
        avatarFile: null,
        previewUrl: null,
      });
      setTouchedFields(new Set());
    } catch (caught: any) {
      if (caught?.uploadedAvatar) {
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
        setDraft(prev => ({
          ...prev,
          avatar: caught.uploadedAvatar,
          avatarFile: null,
          previewUrl: null,
        }));
        setBaseline(prev => ({ ...prev, avatar: caught.uploadedAvatar }));
        setTouchedFields(prev => {
          const next = new Set(prev);
          next.delete('avatar');
          return next;
        });
      }
      throw caught;
    }
  };

  const selectTab = (nextTab: SettingsCategory) => {
    setTab(nextTab);
    setCompactDetailOpen(true);
    if (nextTab === 'voice & video') {
      void media.enumerateDevices();
    }
  };

  const categories: Array<{ id: SettingsCategory; label: string; icon: typeof UserIcon; description: string }> = [
    {
      id: 'profile',
      label: 'profile',
      icon: UserIcon,
      description: 'Avatar, display name, presence & bio',
    },
    {
      id: 'voice & video',
      label: 'voice & video',
      icon: Mic,
      description: 'Audio devices, volume, suppression & mic test',
    },
    {
      id: 'desktop & gaming',
      label: 'desktop & gaming',
      icon: Monitor,
      description: 'Gaming mode, shortcuts & tray options',
    },
    {
      id: 'notifications',
      label: 'notifications',
      icon: Bell,
      description: 'Desktop alerts & system permissions',
    },
  ];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="modal wide settings-dialog"
      onClick={event => {
        if (event.target === dialogRef.current) {
          if (!showDiscardConfirm) {
            attemptClose();
          }
        }
      }}
    >
      {/* Modal Top Bar */}
      <header className="settings-dialog-header">
        <div className="settings-header-left">
          {/* Back button for compact view */}
          <button
            type="button"
            className={`icon-button settings-compact-back-btn ${compactDetailOpen ? 'is-visible' : ''}`}
            onClick={() => setCompactDetailOpen(false)}
            aria-label="Back to categories"
            title="Back to categories"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="settings-header-branding">
            <span className="settings-accent-dot" aria-hidden="true" />
            <h2 id={titleId} className="settings-dialog-title">
              Settings
            </h2>
            <span className="visually-hidden">Your settings</span>
          </div>

          <div className="settings-active-category-crumb">
            <span className="crumb-separator">/</span>
            <span className="crumb-label">{tab}</span>
          </div>
        </div>

        <div className="settings-header-right">
          <button
            type="button"
            className="icon-button settings-close-button"
            onClick={attemptClose}
            aria-label="Close dialog"
            title="Close dialog (Escape)"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Main Two-Column or Single-Pane Body */}
      <div className={`settings-layout ${compactDetailOpen ? 'detail-open' : 'category-list-open'}`}>
        {/* Navigation Rail */}
        <nav className="settings-navigation-rail" aria-label="Settings categories">
          <div className="settings-nav-section-title">User Settings</div>

          <div className="settings-nav-items">
            {categories.map(item => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-btn ${isActive ? 'active' : ''}`}
                  onClick={() => selectTab(item.id)}
                  aria-selected={isActive}
                >
                  <Icon size={16} className="settings-nav-icon" />
                  <span className="settings-nav-label">{item.label}</span>
                  {item.id === 'profile' && isDirty && (
                    <span className="settings-nav-dirty-dot" title="Unsaved changes" />
                  )}
                  <ChevronRight size={14} className="settings-nav-chevron" />
                </button>
              );
            })}
          </div>

          {/* Bottom Danger Sign Out */}
          <div className="settings-nav-footer">
            <button
              type="button"
              className="danger-text settings-signout-btn"
              onClick={() => attemptLogout('local')}
            >
              <LogOut size={15} />
              <span>Sign out</span>
            </button>
            {isHostedAuth() && (
              <button
                type="button"
                className="settings-signout-btn settings-signout-all-btn"
                onClick={() => attemptLogout('global')}
              >
                <LogOut size={15} />
                <span>Sign out of all devices</span>
              </button>
            )}
          </div>
        </nav>

        {/* Content Panel */}
        <section className="settings-content-pane" aria-label={`${tab} settings`}>
          {media.persistenceError && (
            <p className="error persistence-error-banner" role="alert">
              {media.persistenceError}
            </p>
          )}

          {tab === 'profile' && (
            <ProfileSettings
              me={me}
              draft={draft}
              onDraftChange={handleDraftChange}
              onSave={handleSaveProfile}
              onReset={handleResetDraft}
              isDirty={isDirty}
              busy={busy}
            />
          )}

          {tab === 'voice & video' && (
            <VoiceSettings
              media={media}
              me={me}
              servers={servers}
              onNavigateToGaming={() => selectTab('desktop & gaming')}
            />
          )}

          {tab === 'desktop & gaming' && (
            <AppGamingSettings
              media={media}
              preferences={preferences}
              onPreferences={onPreferences}
            />
          )}

          {tab === 'notifications' && (
            <NotificationSettings
              preferences={preferences}
              onPreferences={onPreferences}
            />
          )}
        </section>
      </div>

      {/* Discard Confirmation Modal / Alert */}
      {showDiscardConfirm && (
        <div
          className="settings-discard-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={discardTitleId}
          onKeyDown={handleDiscardKeyDown}
        >
          <div className="settings-discard-card">
            <div className="settings-discard-header">
              <AlertTriangle size={20} className="discard-warning-icon" />
              <h3 id={discardTitleId}>Discard unsaved changes?</h3>
            </div>
            <p className="settings-discard-message">
              You have unsaved changes to your profile. Leaving or closing will discard your edits.
            </p>
            <div className="settings-discard-actions">
              <button
                ref={keepEditingBtnRef}
                type="button"
                className="secondary"
                onClick={cancelDiscard}
              >
                Keep editing
              </button>
              <button
                ref={discardBtnRef}
                type="button"
                className="primary danger-bg"
                onClick={confirmDiscard}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
