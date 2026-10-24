import { AuthenticatedImage } from './AuthenticatedImage';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Headphones,
  Info,
  LogOut,
  MicOff,
  Search,
  Shield,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { Role, Server, ServerEmoji, User } from '@haven/shared/types';
import { api } from './api';
import { copyWithFeedback } from './clipboard';
import { Avatar } from './components';
import { InviteCreate } from './Invitations';
import { ServerEmojiManager } from './ServerEmojis';
import { profileFallback, profileImageSource } from './profile-images';
import { ConfirmDialog } from './ZenithDialog';

export interface CommunityMember {
  user: User;
  role: Role;
  userId?: string;
  joinedAt?: number;
  serverMuted?: boolean;
  serverDeafened?: boolean;
}

export function ServerIcon({ server }: { server: Pick<Server, 'name' | 'icon'> }) {
  const source = profileImageSource(server.icon, true);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="community-icon">
      {source && failed !== source ? (
        <AuthenticatedImage
          key={source}
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setFailed(source)}
        />
      ) : (
        profileFallback(server.icon, server.name)
      )}
    </span>
  );
}

export default function ServerSettings({
  server,
  members,
  emojis,
  me,
  onChanged,
  onLeft,
  notify,
  onClose,
  loading = false,
}: {
  server: Server;
  members: CommunityMember[];
  emojis: ServerEmoji[];
  me: User;
  onChanged: () => void | Promise<unknown>;
  onLeft: () => void;
  notify: (message: string) => void;
  onClose?: () => void;
  loading?: boolean;
}) {
  const [tab, setTab] = useState<'Overview' | 'Members' | 'Emoji' | 'Invites'>('Overview');
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const [draft, setDraft] = useState({
    name: server.name,
    icon: server.icon,
    description: server.description || '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const canManage = server.role !== 'member';

  useEffect(() => {
    setDraft({
      name: server.name,
      icon: server.icon,
      description: server.description || '',
    });
  }, [server.id, server.name, server.icon, server.description]);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this community');
    } finally {
      setBusy(false);
    }
  };

  const rolePriority: Record<Role, number> = { owner: 0, admin: 1, member: 2 };
  const filteredMembers = members.filter(
    m =>
      (m.user.displayName || '').toLowerCase().includes(filterQuery.toLowerCase()) ||
      (m.user.username || '').toLowerCase().includes(filterQuery.toLowerCase())
  );
  const sortedMembers = [...filteredMembers].sort((a, b) => {
    const roleDiff = (rolePriority[a.role] ?? 3) - (rolePriority[b.role] ?? 3);
    if (roleDiff !== 0) return roleDiff;
    return (a.user.displayName || '').localeCompare(b.user.displayName || '');
  });

  return (
    <div className="community-settings zenith-server-settings-root">
      {/* Accessible Title for screen readers & e2e assertions */}
      <h2 className="sr-only">Community settings</h2>

      {/* 1. Server Summary Header */}
      <header className="zenith-server-header">
        <div className="zenith-server-header-left">
          <div className="zenith-server-header-icon-wrap">
            <ServerIcon server={server} />
          </div>
          <div className="zenith-server-header-meta">
            <div className="zenith-server-header-title-row">
              <h1 className="zenith-server-header-title">{server.name}</h1>
              <span className="zenith-server-header-badge">Zenith 0.4.1</span>
            </div>
            <p className="zenith-server-header-subtitle">
              {members.length} members · {server.role === 'owner' ? 'Owner' : server.role === 'admin' ? 'Moderator' : 'Member'}
            </p>
          </div>
        </div>
        <div className="zenith-server-header-right">
          <button
            type="button"
            className="zenith-server-copy-btn"
            onClick={() => void copyWithFeedback(server.id, 'Server ID', notify)}
          >
            <Copy size={14} />
            <span>Copy server ID</span>
          </button>
          <div className="zenith-server-header-divider" />
          <button
            type="button"
            className="zenith-server-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close Settings (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* 2. Horizontal Navigation Tabs (44px) */}
      <nav className="zenith-server-nav" aria-label="Community settings sections">
        {(['Overview', 'Members', 'Emoji', 'Invites'] as const).map(item => {
          const isActive = tab === item;
          return (
            <button
              type="button"
              className={`zenith-server-nav-tab ${isActive ? 'active' : ''}`}
              key={item}
              onClick={() => {
                setTab(item);
                setError('');
              }}
            >
              {item === 'Members' && <Users size={16} className="zenith-nav-tab-icon" />}
              <span>{item}</span>
              {item === 'Members' && (
                <span className="zenith-nav-count-badge">{members.length}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Error alert if present */}
      {error && (
        <div className="zenith-server-error-banner" role="alert">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* 3. Tab Content Area */}
      <main className="zenith-server-content">
        {tab === 'Overview' && (
          <div className="zenith-tab-overview">
            <form
              className="simple-form zenith-overview-form"
              onSubmit={event => {
                event.preventDefault();
                void run(async () => {
                  await api(`/servers/${server.id}`, 'PATCH', draft);
                  await onChanged();
                  notify('Community updated');
                });
              }}
            >
              <label>
                SERVER NAME
                <input
                  aria-label="SERVER NAME"
                  required
                  maxLength={80}
                  value={draft.name}
                  disabled={!canManage || busy}
                  onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))}
                />
              </label>
              <label>
                DESCRIPTION
                <textarea
                  aria-label="Community description"
                  maxLength={1000}
                  rows={4}
                  placeholder="What brings your people together?"
                  value={draft.description}
                  disabled={!canManage || busy}
                  onChange={event => setDraft(previous => ({ ...previous, description: event.target.value }))}
                />
              </label>
              <label>
                ICON <small>Emoji or HTTPS image URL; clear to use initials</small>
                <input
                  aria-label="Community icon"
                  maxLength={300}
                  value={draft.icon}
                  disabled={!canManage || busy}
                  onChange={event => setDraft(previous => ({ ...previous, icon: event.target.value }))}
                />
              </label>
              {canManage ? (
                <button type="submit" className="primary zenith-save-btn" disabled={busy}>
                  Save community
                </button>
              ) : (
                <p className="quiet">Only the owner and moderators can edit this community.</p>
              )}
            </form>

            {canManage && (
              <section className="community-icon-upload zenith-icon-upload-card">
                <h3>Upload a server icon</h3>
                <p className="quiet">
                  PNG, JPEG or static WebP; at most 1 MB and 1024 × 1024 pixels. No SVG or animation.
                </p>
                <input
                  aria-label="Upload community icon"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={event => setFile(event.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="secondary zenith-upload-btn"
                  disabled={busy || !file}
                  onClick={() =>
                    void run(async () => {
                      const body = new FormData();
                      body.append('file', file!);
                      await api(`/servers/${server.id}/icon`, 'POST', body);
                      setFile(null);
                      await onChanged();
                      notify('Server icon updated');
                    })
                  }
                >
                  <Upload size={15} />
                  <span>Upload icon</span>
                </button>
              </section>
            )}

            <div className="community-metadata zenith-metadata-row">
              <span>Created {new Date(server.createdAt).toLocaleDateString()}</span>
              <button
                type="button"
                className="text-link"
                onClick={() => void copyWithFeedback(server.id, 'Server ID', notify)}
              >
                Copy server ID
              </button>
            </div>
          </div>
        )}

        {tab === 'Members' && (
          <div className="zenith-tab-members">
            {/* Section Descriptor */}
            <div className="zenith-members-header">
              <h2 className="zenith-members-title">People & permissions</h2>
              <p className="zenith-members-desc">
                Owners manage roles. Moderators manage channels, invites, emoji and members below their role.
                Right-click a voice participant for local audio and moderation controls.
              </p>
            </div>

            {/* Filter / Search Toolbar */}
            <div className="zenith-members-toolbar">
              <div className="zenith-search-input-wrap">
                <Search size={14} className="zenith-search-icon" />
                <input
                  type="text"
                  className="zenith-search-input"
                  placeholder="Filter members..."
                  value={filterQuery}
                  onChange={event => setFilterQuery(event.target.value)}
                />
              </div>
              <div className="zenith-members-count">
                Showing <span className="zenith-count-number">{sortedMembers.length}</span> of{' '}
                <span className="zenith-count-number">{members.length}</span> members
              </div>
            </div>

            {/* Roster List */}
            <div className="zenith-members-list">
              {loading && members.length === 0 ? (
                <div className="zenith-members-loading quiet" style={{ padding: '24px', textAlign: 'center', fontSize: '13px' }}>
                  Loading members…
                </div>
              ) : sortedMembers.length === 0 ? (
                <div className="zenith-members-empty quiet" style={{ padding: '24px', textAlign: 'center', fontSize: '13px' }}>
                  {filterQuery ? 'No members matching filter.' : 'No members in this community.'}
                </div>
              ) : (
                sortedMembers.map(member => {
                  const removable =
                    member.user.id !== me.id &&
                    member.role !== 'owner' &&
                    (server.role === 'owner' || (server.role === 'admin' && member.role === 'member'));

                  return (
                    <div className="permission-row zenith-member-row" key={member.user.id}>
                      {/* Left: Avatar + Identity */}
                      <div className="zenith-member-identity">
                        <Avatar user={member.user} size={36} />
                        <div className="zenith-member-names">
                          <div className="zenith-member-primary-line">
                            <span className="zenith-member-display-name">{member.user.displayName}</span>
                            {member.user.id === me.id && (
                              <span className="zenith-member-you-badge">(you)</span>
                            )}
                          </div>
                          <div className="zenith-member-username">@{member.user.username}</div>
                        </div>
                      </div>

                      {/* Right: Status Badges + Role Controls + Actions */}
                      <div className="zenith-member-controls">
                        {member.serverMuted && (
                          <div className="zenith-status-pill muted" title="Server muted">
                            <MicOff size={13} />
                            <span>Server muted</span>
                          </div>
                        )}
                        {member.serverDeafened && (
                          <div className="zenith-status-pill deafened" title="Server deafened">
                            <Headphones size={13} />
                            <span>Server deafened</span>
                          </div>
                        )}

                        {/* Role representation */}
                        {server.role === 'owner' && member.role !== 'owner' ? (
                          <div className="zenith-role-dropdown-wrap">
                            <select
                              aria-label={`Role for ${member.user.displayName}`}
                              value={member.role}
                              disabled={busy}
                              onChange={event =>
                                void run(async () => {
                                  await api(`/servers/${server.id}/members/${member.user.id}`, 'PATCH', {
                                    role: event.target.value,
                                  });
                                  await onChanged();
                                  notify('Member role updated');
                                })
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                            </select>
                            <ChevronDown size={14} className="zenith-role-chevron" />
                          </div>
                        ) : member.role === 'owner' ? (
                          <span className="zenith-owner-pill">
                            <Shield size={14} />
                            <span>Owner</span>
                          </span>
                        ) : (
                          <span className="zenith-role-static-pill">
                            {member.role === 'admin' ? 'Admin' : 'Member'}
                          </span>
                        )}

                        {/* Remove member button */}
                        {removable ? (
                          <button
                            type="button"
                            className="zenith-member-remove-btn"
                            disabled={busy}
                            title={`Remove ${member.user.displayName}`}
                            aria-label={`Remove ${member.user.displayName}`}
                            onClick={() => {
                              setConfirmDialog({
                                title: 'Remove from community',
                                message: `Remove ${member.user.displayName} from ${server.name}? They will need an invitation to rejoin.`,
                                confirmLabel: 'Remove member',
                                action: async () => {
                                  await api(`/servers/${server.id}/members/${member.user.id}`, 'DELETE');
                                  await onChanged();
                                },
                              });
                            }}
                          >
                            <X size={16} />
                          </button>
                        ) : (
                          <div className="zenith-btn-placeholder" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Contextual Zen Notice */}
            <div className="zenith-members-notice">
              <Info size={14} className="zenith-notice-icon" />
              <span>All permission edits apply immediately without requiring client reconnection.</span>
            </div>
          </div>
        )}

        {tab === 'Emoji' && (
          <ServerEmojiManager
            serverId={server.id}
            canManage={canManage}
            emojis={emojis}
            onChanged={async () => {
              await onChanged();
            }}
          />
        )}

        {tab === 'Invites' && <InviteCreate server={server} notify={notify} />}
      </main>

      {/* 4. Bottom Danger Zone Footer */}
      <footer className="zenith-server-footer">
        <div className="zenith-footer-warning">
          <AlertTriangle size={18} className="zenith-warning-icon" />
          <p className="zenith-warning-text">
            {server.role === 'owner'
              ? 'Permanently delete this community, its channels, and all message history.'
              : 'Leave this community and remove it from your workspace.'}
          </p>
        </div>
        <button
          type="button"
          className="zenith-danger-btn"
          disabled={busy}
          onClick={() => {
            if (server.role === 'owner') {
              setConfirmDialog({
                title: 'Delete community',
                message: `Are you sure you want to delete ${server.name}? All channels, messages, attachments, and invite codes will be permanently removed. This action cannot be undone.`,
                confirmLabel: 'Delete server',
                action: async () => {
                  await api(`/servers/${server.id}`, 'DELETE');
                  await onChanged();
                  onLeft();
                },
              });
            } else {
              setConfirmDialog({
                title: 'Leave community',
                message: `Are you sure you want to leave ${server.name}? You will lose access to its channels and conversations until reinvited.`,
                confirmLabel: 'Leave server',
                action: async () => {
                  await api(`/servers/${server.id}/members/${me.id}`, 'DELETE');
                  await onChanged();
                  onLeft();
                },
              });
            }
          }}
        >
          {server.role === 'owner' ? <Trash2 size={15} /> : <LogOut size={15} />}
          <span>{server.role === 'owner' ? 'Delete server' : 'Leave server'}</span>
        </button>
      </footer>

      {confirmDialog && (
        <ConfirmDialog
          open={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          variant="danger"
          onCancel={() => setConfirmDialog(null)}
          onConfirm={async () => {
            await confirmDialog.action();
            setConfirmDialog(null);
          }}
        />
      )}
    </div>
  );
}
