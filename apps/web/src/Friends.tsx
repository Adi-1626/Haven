import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import {
  ArrowRight,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Headphones,
  MessageCircle,
  MoreHorizontal,
  Radio,
  Search,
  ShieldOff,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type { Bootstrap, FriendRequest, User } from '@haven/shared/types';
import { api } from './api';
import { copyWithFeedback } from './clipboard';
import { Avatar } from './components';
import './friends.css';
import './zenith-social.css';

type FeedbackProps = {
  data: Bootstrap;
  onChanged: () => void | Promise<void>;
  notify: (message: string) => void;
};

const display = (user?: User) => user?.displayName || user?.username || 'Unknown user';
const failure = (error: unknown) =>
  error instanceof Error ? error.message : 'The request could not be completed. Try again.';

export function YourUsername({
  user,
  notify,
}: {
  user: User;
  notify: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyWithFeedback(`@${user.username}`, 'Username', notify, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="own-username-bar">
      <div className="own-username-info">
        <span className="online-indicator-dot" aria-hidden="true" />
        <span className="own-username-label">Your username:</span>
        <code className="own-username-chip">@{user.username}</code>
      </div>
      <button
        type="button"
        className="own-username-copy-btn"
        onClick={() => void copy()}
        aria-label="Copy your username"
      >
        {copied ? (
          <>
            <Check size={14} className="success-icon" />
            <span>Copied!</span>
          </>
        ) : (
          <>
            <Copy size={14} />
            <span>Copy username</span>
          </>
        )}
      </button>
    </div>
  );
}

export function AddFriend({
  data,
  onChanged,
  onPending,
  notify,
}: FeedbackProps & { onPending: () => void }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setSent('');
    const normalized = username.trim().replace(/^@/, '').toLowerCase();
    try {
      await api('/friends/requests', 'POST', { username });
      setSent(normalized);
      setUsername('');
      notify(`Friend request sent to @${normalized}`);
      await onChanged();
    } catch (error) {
      setError(failure(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const totalPendingCount = data.requests.length;

  return (
    <form className="add-friend-dialog" onSubmit={event => void submit(event)}>
      <p className="lead-text">
        Enter your friend’s account username, with or without @. A community invite joins a community; it does not add a friend.
      </p>

      <YourUsername user={data.user} notify={notify} />

      <div className="form-field">
        <label htmlFor="friend-username-input">USERNAME</label>
        <div className="input-wrap">
          <input
            id="friend-username-input"
            name="username"
            aria-label="Friend username"
            placeholder="Your friend’s username"
            value={username}
            onChange={event => {
              setUsername(event.target.value);
              setError('');
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={65}
            required
            autoFocus
            disabled={busy}
          />
          {username.trim().length > 0 && (
            <div className="valid-icon" aria-hidden="true">
              <Check size={16} />
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {sent && (
        <div className="friend-request-success" role="status">
          <div className="friend-request-success-header">
            <Check size={16} />
            <p>
              Friend request sent to <b>@{sent}</b>. They can accept it from their Incoming requests, even if they were offline when you sent it.
            </p>
          </div>
          <button type="button" className="view-pending-link" onClick={onPending}>
            <span>View pending requests</span>
            <ArrowRight size={13} />
          </button>
        </div>
      )}

      <div className="add-friend-footer">
        <button type="button" className="pending-btn" onClick={onPending}>
          <Clock size={14} />
          <span>Pending requests{totalPendingCount > 0 ? ` (${totalPendingCount})` : ''}</span>
        </button>
        <button type="submit" className="submit-btn" disabled={busy || !username.trim()}>
          <UserPlus size={15} />
          <span>{busy ? 'Sending…' : 'Send friend request'}</span>
        </button>
      </div>
    </form>
  );
}

export function FriendsPage({
  data,
  tab,
  setTab,
  query,
  onAdd,
  onCreateServer,
  onMessage,
  onProfile,
  onChanged,
  notify,
  onUserContext,
  onWatch,
  onJoinVoice,
}: FeedbackProps & {
  tab: string;
  setTab: (tab: string) => void;
  query: string;
  onAdd: () => void;
  onCreateServer: () => void;
  onMessage: (userId: string) => void;
  onProfile: (user: User) => void;
  onUserContext?: (event: MouseEvent<HTMLElement>, userId: string) => void;
  onWatch?: (socketId: string) => void;
  onJoinVoice?: (channelId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const running = useRef(false);

  useEffect(() => {
    setCompleted(previous =>
      previous.filter(key =>
        key.startsWith('block:')
          ? (data.blocked ?? []).includes(key.slice(6))
          : key.startsWith('friend:')
          ? data.friends.includes(key.slice(7))
          : data.requests.some(request => request.id === key)
      )
    );
  }, [data.blocked, data.friends, data.requests]);

  const users = Object.fromEntries(data.users.map(user => [user.id, user]));
  const effectiveSearch = (query || localQuery).trim().replace(/^@/, '').toLowerCase();
  const matches = (user?: User) =>
    !effectiveSearch ||
    `${user?.displayName ?? ''} ${user?.username ?? ''}`.toLowerCase().includes(effectiveSearch);

  const requests = data.requests.filter(request => !completed.includes(request.id));
  const friendIds = data.friends.filter(userId => !completed.includes(`friend:${userId}`));
  const blocked = (data.blocked ?? []).filter(userId => !completed.includes(`block:${userId}`));

  const isOnline = (user?: User) => Boolean(user?.status && user.status !== 'offline');
  const onlineFriendIds = friendIds.filter(userId => isOnline(users[userId]));

  const selected = (
    tab === 'blocked'
      ? blocked
      : tab === 'online'
      ? onlineFriendIds
      : friendIds
  ).filter(userId => matches(users[userId]));

  const filteredRequests = requests.filter(request =>
    matches(users[request.fromId === data.user.id ? request.toId : request.fromId])
  );
  const incoming = filteredRequests.filter(request => request.toId === data.user.id);
  const outgoing = filteredRequests.filter(request => request.fromId === data.user.id);

  async function change(key: string, route: string, method: string, message: string) {
    if (running.current) return;
    running.current = true;
    setBusy(key);
    setError('');
    try {
      await api(route, method, method === 'POST' ? {} : undefined);
      setCompleted(previous => [...previous, key]);
      notify(message);
      await onChanged();
    } catch (error) {
      setError(failure(error));
    } finally {
      running.current = false;
      setBusy('');
    }
  }

  function userStatusLabel(status?: string) {
    switch (status) {
      case 'online':
        return 'Online';
      case 'idle':
        return 'Away';
      case 'dnd':
        return 'Do Not Disturb';
      case 'offline':
      default:
        return 'Offline';
    }
  }

  function personContent(userId: string, contextStatus?: string) {
    const user = users[userId];
    const voicePeer = data.voice?.find(v => v.user.id === userId);
    const inVoiceChannel = voicePeer ? data.channels.find(c => c.id === voicePeer.channelId) : undefined;
    const inVoiceServer = inVoiceChannel ? data.servers.find(s => s.id === inVoiceChannel.serverId) : undefined;

    let statusText = contextStatus;
    if (!statusText) {
      if (voicePeer?.sharing) {
        statusText = `Streaming in #${inVoiceChannel?.name || 'voice'}${inVoiceServer ? ` · ${inVoiceServer.name}` : ''}`;
      } else if (voicePeer) {
        statusText = `In #${inVoiceChannel?.name || 'voice'}${inVoiceServer ? ` · ${inVoiceServer.name}` : ''}`;
      } else if (user?.bio) {
        statusText = user.bio;
      } else {
        statusText = userStatusLabel(user?.status);
      }
    }

    return (
      <div className="friend-row-person">
        <button
          type="button"
          className="avatar-button"
          aria-label={`View profile for ${display(user)}`}
          onClick={() => user && onProfile(user)}
        >
          <Avatar user={user} size={38} />
        </button>
        <div className="friend-row-details">
          <div className="friend-row-identity">
            <span className="friend-row-name">{display(user)}</span>
            <span className="friend-row-username">@{user?.username ?? userId}</span>
          </div>
          <span className={`friend-row-subtext ${voicePeer?.sharing ? 'is-streaming' : ''}`}>
            {statusText}
          </span>
        </div>
      </div>
    );
  }

  function pendingRow(request: FriendRequest, received: boolean) {
    const userId = received ? request.fromId : request.toId;
    const user = users[userId];
    const directionLabel = received ? 'Incoming friend request' : 'Outgoing friend request';
    return (
      <div
        className="friend-row"
        key={request.id}
        onContextMenu={event => onUserContext?.(event, userId)}
      >
        <div className="friend-row-person">
          <button
            type="button"
            className="avatar-button"
            aria-label={`View profile for ${display(user)}`}
            onClick={() => user && onProfile(user)}
          >
            <Avatar user={user} size={38} />
          </button>
          <div className="friend-row-details">
            <span className="friend-row-name">{display(user)}</span>
            <span className="friend-row-subtext">
              @{user?.username ?? userId} • {directionLabel}
            </span>
          </div>
        </div>

        <div className="friend-row-actions">
          {received ? (
            <>
              <button
                type="button"
                className="friend-action-accept"
                disabled={Boolean(busy)}
                aria-label={`Accept request from ${display(user)}`}
                title="Accept request"
                onClick={() =>
                  void change(
                    request.id,
                    `/friends/requests/${request.id}/accept`,
                    'POST',
                    `You and ${display(user)} are now friends`
                  )
                }
              >
                <Check size={14} />
                <span>Accept</span>
              </button>
              <button
                type="button"
                className="friend-action-decline"
                disabled={Boolean(busy)}
                aria-label={`Decline request from ${display(user)}`}
                title="Decline request"
                onClick={() =>
                  void change(
                    request.id,
                    `/friends/requests/${request.id}`,
                    'DELETE',
                    'Friend request declined'
                  )
                }
              >
                <span>Decline</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="friend-action-cancel"
              disabled={Boolean(busy)}
              aria-label={`Cancel request to ${display(user)}`}
              title="Cancel request"
              onClick={() =>
                void change(
                  request.id,
                  `/friends/requests/${request.id}`,
                  'DELETE',
                  'Friend request cancelled'
                )
              }
            >
              <span>Cancel request</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const tabsConfig = [
    { id: 'online', label: `Online (${onlineFriendIds.length})` },
    { id: 'all', label: `All Friends (${friendIds.length})` },
    { id: 'pending', label: 'Pending', count: requests.length },
    { id: 'blocked', label: `Blocked (${blocked.length})` },
  ];

  const activeVoiceFriends = friendIds
    .map(id => {
      const peer = data.voice?.find(v => v.user.id === id);
      if (!peer) return null;
      const channel = data.channels.find(c => c.id === peer.channelId);
      const server = channel ? data.servers.find(s => s.id === channel.serverId) : undefined;
      return { user: users[id], peer, channel, server };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item && item.user));

  return (
    <div className="friends-page">
      {/* 1. Friends Toolbar */}
      <div className="friends-toolbar">
        <div className="tabs friends-toolbar-tabs" role="tablist" aria-label="Friends directory filter">
          {tabsConfig.map(item => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setError('');
              }}
            >
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <b className="friends-tab-badge">{item.count}</b>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="friends-toolbar-add-btn"
          onClick={onAdd}
          aria-label="Add friend"
        >
          <UserPlus size={15} />
          <span>Add friend</span>
        </button>
      </div>

      {/* 2. Main Body Layout (Content + Contextual Right Rail) */}
      <div className="friends-body-layout">
        <div className="friends-content">
          {/* Hero Title (meets e2e 'Better, together.' assertion with Zenith Minimal refinement) */}
          <div className="friends-hero">
            <p className="eyebrow">A PLACE TO BELONG</p>
            <h1>
              Better, together<span>.</span>
            </h1>
            <p>Your people are just a conversation away.</p>
          </div>

          {/* Own username banner */}
          <YourUsername user={data.user} notify={notify} />

          {/* In-page Search Bar */}
          <div className="friends-search-container">
            <Search size={16} className="friends-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="friends-search-input"
              placeholder="Search friends by name or handle..."
              aria-label="Search friends"
              value={localQuery}
              onChange={event => setLocalQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setLocalQuery('');
                }
              }}
            />
            <span className="friends-search-shortcut" aria-hidden="true">ESC to clear</span>
            {localQuery && (
              <button
                type="button"
                className="friends-search-clear"
                onClick={() => setLocalQuery('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {/* 3. Friend List / Directory */}
          <div className="friends-list-container" aria-busy={Boolean(busy)}>
            {tab === 'pending' ? (
              <>
                {incoming.length > 0 && (
                  <>
                    <div className="friends-section-label">
                      <span>INCOMING — {incoming.length}</span>
                      <span className="friends-section-subtitle">DIRECT INVITATIONS</span>
                    </div>
                    {incoming.map(request => pendingRow(request, true))}
                  </>
                )}
                {outgoing.length > 0 && (
                  <>
                    <div className="friends-section-label">
                      <span>OUTGOING — {outgoing.length}</span>
                      <span className="friends-section-subtitle">AWAITING CONFIRMATION</span>
                    </div>
                    {outgoing.map(request => pendingRow(request, false))}
                  </>
                )}
                {!filteredRequests.length && (
                  <div className="friends-empty-card">
                    <div className="friends-empty-icon">
                      <CheckCheck size={30} />
                    </div>
                    <h3>{effectiveSearch ? 'No matching requests' : 'All caught up'}</h3>
                    <p>
                      {effectiveSearch
                        ? 'Try another username or display name.'
                        : 'Incoming and outgoing friend requests appear here. Offline recipients will see their requests when they return.'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="friends-section-label">
                  <span>
                    {tab === 'blocked'
                      ? 'BLOCKED'
                      : tab === 'online'
                      ? 'ONLINE'
                      : 'ALL FRIENDS'}{' '}
                    — {selected.length}
                  </span>
                  <span className="friends-section-subtitle">DIRECT COMMUNICATION</span>
                </div>

                {selected.map(userId => {
                  const user = users[userId];
                  const voicePeer = data.voice?.find(v => v.user.id === userId);
                  const inVoiceChannel = voicePeer ? data.channels.find(c => c.id === voicePeer.channelId) : undefined;

                  return (
                    <div
                      className="friend-row"
                      key={userId}
                      onContextMenu={event => onUserContext?.(event, userId)}
                    >
                      {personContent(
                        userId,
                        tab === 'blocked' ? 'Blocked account' : undefined
                      )}

                      <div className="friend-row-actions">
                        {tab === 'blocked' ? (
                          <button
                            type="button"
                            className="friend-action-unblock"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void change(
                                `block:${userId}`,
                                `/users/${userId}/block`,
                                'DELETE',
                                `${display(user)} was unblocked. You can send a new friend request.`
                              )
                            }
                          >
                            <ShieldOff size={14} />
                            <span>Unblock</span>
                          </button>
                        ) : (
                          <>
                            {voicePeer?.sharing && (
                              <button
                                type="button"
                                className="friend-action-watch"
                                title={`Watch ${display(user)}’s stream`}
                                aria-label={`Watch ${display(user)}’s stream`}
                                onClick={() => {
                                  if (inVoiceChannel) {
                                    void onJoinVoice?.(inVoiceChannel.id).then(() => {
                                      if (voicePeer.socketId) onWatch?.(voicePeer.socketId);
                                    });
                                  }
                                }}
                              >
                                <Radio size={14} className="live-icon" />
                                <span className="action-text">Watch Stream</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="friend-action-msg"
                              title={`Message ${display(user)}`}
                              aria-label={`Message ${display(user)}`}
                              onClick={() => onMessage(userId)}
                            >
                              <MessageCircle size={15} />
                              <span className="action-text">Message</span>
                            </button>
                            <button
                              type="button"
                              className="friend-action-more"
                              title="More options"
                              aria-label={`More options for ${display(user)}`}
                              onClick={event => {
                                if (onUserContext) {
                                  onUserContext(event, userId);
                                } else if (user) {
                                  onProfile(user);
                                }
                              }}
                            >
                              <MoreHorizontal size={17} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {tab === 'blocked' && selected.length > 0 && (
                  <div className="friends-blocked-note">
                    Blocking prevents direct contact. Shared communities remain available.
                  </div>
                )}

                {!selected.length && (
                  <div className="friends-empty-card">
                    <div className="friends-empty-icon">
                      <Users size={30} />
                    </div>
                    <h3>
                      {effectiveSearch
                        ? 'No matching people'
                        : tab === 'blocked'
                        ? 'No blocked accounts'
                        : tab === 'online'
                        ? 'Your friends are away'
                        : 'Your circle starts here'}
                    </h3>
                    <p>
                      {effectiveSearch
                        ? 'Search by username or display name.'
                        : tab === 'blocked'
                        ? 'Accounts you block appear here. Blocking prevents direct contact while preserving shared community and group spaces.'
                        : tab === 'online'
                        ? 'Offline friends are still in All friends. You can leave them a direct message.'
                        : 'Add a friend by username, or create a server and invite your people.'}
                    </p>
                    {!effectiveSearch && tab === 'all' && (
                      <div className="friends-empty-actions">
                        <button
                          type="button"
                          className="friends-toolbar-add-btn"
                          onClick={onAdd}
                        >
                          <span>Add your first friend</span>
                          <ArrowRight size={14} />
                        </button>
                        <button
                          type="button"
                          className="friend-action-unblock"
                          onClick={onCreateServer}
                        >
                          Create a server
                        </button>
                      </div>
                    )}
                    {!effectiveSearch && tab === 'online' && (
                      <div className="friends-empty-actions">
                        <button
                          type="button"
                          className="friend-action-unblock"
                          onClick={() => setTab('all')}
                        >
                          View all friends
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 3. Contextual Right Column (Pending Requests & Active Now) */}
        <aside className="friends-context-column" aria-label="Friend Activity and Requests">
          {/* PENDING REQUESTS SECTION */}
          <div className="friends-context-section">
            <div className="friends-context-header">
              <h3>Pending Requests</h3>
              <span className="friends-context-badge">{requests.length}</span>
            </div>

            <div className="friends-context-list">
              {incoming.length > 0 && incoming.slice(0, 4).map(request => {
                const reqUser = users[request.fromId];
                return (
                  <div key={request.id} className="friends-context-req-card">
                    <div className="friends-context-req-top">
                      <Avatar user={reqUser} size={32} />
                      <div className="friends-context-req-info">
                        <span className="friends-context-req-name">{display(reqUser)}</span>
                        <span className="friends-context-req-sub">@{reqUser?.username || request.fromId}</span>
                      </div>
                    </div>
                    <div className="friends-context-req-actions">
                      <button
                        type="button"
                        className="friends-context-accept-btn"
                        disabled={Boolean(busy)}
                        onClick={() => void change(request.id, `/friends/requests/${request.id}/accept`, 'POST', `You and ${display(reqUser)} are now friends`)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="friends-context-decline-btn"
                        disabled={Boolean(busy)}
                        onClick={() => void change(request.id, `/friends/requests/${request.id}`, 'DELETE', 'Friend request declined')}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}

              {outgoing.length > 0 && outgoing.slice(0, 4).map(request => {
                const reqUser = users[request.toId];
                return (
                  <div key={request.id} className="friends-context-req-card outgoing">
                    <div className="friends-context-req-top">
                      <Avatar user={reqUser} size={32} />
                      <div className="friends-context-req-info">
                        <span className="friends-context-req-name">{display(reqUser)}</span>
                        <span className="friends-context-req-sub">@{reqUser?.username || request.toId} · Outgoing</span>
                      </div>
                    </div>
                    <div className="friends-context-req-actions-cancel">
                      <button
                        type="button"
                        className="friends-context-cancel-btn"
                        disabled={Boolean(busy)}
                        onClick={() => void change(request.id, `/friends/requests/${request.id}`, 'DELETE', 'Friend request cancelled')}
                      >
                        Cancel Request
                      </button>
                    </div>
                  </div>
                );
              })}

              {!requests.length && (
                <div className="friends-context-empty">
                  All caught up · No pending requests
                </div>
              )}
            </div>
          </div>

          {/* ACTIVE NOW SECTION */}
          <div className="friends-context-section">
            <div className="friends-context-header">
              <h3>Active Now</h3>
              <span className="friends-context-pulse-dot" aria-hidden="true" />
            </div>

            <div className="friends-context-list">
              {activeVoiceFriends.length > 0 ? (
                activeVoiceFriends.map(item => (
                  <div key={item.user.id} className={`friends-active-card ${item.peer.sharing ? 'is-live' : ''}`}>
                    <div className="friends-active-card-top">
                      <div className="friends-active-card-user">
                        <Avatar user={item.user} size={30} />
                        <div>
                          <span className="friends-active-name">{display(item.user)}</span>
                          <span className="friends-active-location">
                            In {item.server?.name || 'Community'} #{item.channel?.name || 'voice'}
                          </span>
                        </div>
                      </div>
                      {item.peer.sharing ? (
                        <span className="friends-active-live-tag">LIVE</span>
                      ) : (
                        <span className="friends-active-voice-tag">VOICE</span>
                      )}
                    </div>

                    {item.peer.sharing && (
                      <div className="friends-active-preview-box">
                        <div className="friends-active-preview-title">
                          {display(item.user)}'s Screen
                        </div>
                        <div className="friends-active-preview-meta">
                          Sharing screen · In voice
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="friends-active-watch-btn"
                      onClick={() => {
                        if (item.channel) {
                          void onJoinVoice?.(item.channel.id).then(() => {
                            if (item.peer.sharing && item.peer.socketId) {
                              onWatch?.(item.peer.socketId);
                            }
                          });
                        }
                      }}
                    >
                      {item.peer.sharing ? (
                        <>
                          <Radio size={14} />
                          <span>Watch Stream</span>
                        </>
                      ) : (
                        <>
                          <Volume2 size={14} />
                          <span>Join Voice</span>
                        </>
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <div className="friends-active-ambient-card">
                  <div className="friends-active-ambient-top">
                    <Headphones size={15} />
                    <span>Ambient Stage</span>
                  </div>
                  <p>Quiet for now. When friends join voice or share their screen, you'll see them active here.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

type ContactState = 'friend' | 'blocked' | 'incoming' | 'outgoing' | 'none';

export function ProfileActions({
  data,
  user,
  onChanged,
  onMessage,
  notify,
}: FeedbackProps & { user: User; onMessage: (userId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [override, setOverride] = useState<ContactState | null>(null);
  const [localRequest, setLocalRequest] = useState<FriendRequest | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    setOverride(null);
    setError('');
    setStatus('');
    setConfirmBlock(false);
    setConfirmRemove(false);
  }, [user.id]);

  const actualRequest = data.requests.find(
    request =>
      (request.fromId === user.id && request.toId === data.user.id) ||
      (request.toId === user.id && request.fromId === data.user.id)
  );

  const actualState: ContactState = (data.blocked ?? []).includes(user.id)
    ? 'blocked'
    : data.friends.includes(user.id)
    ? 'friend'
    : actualRequest
    ? actualRequest.toId === data.user.id
      ? 'incoming'
      : 'outgoing'
    : 'none';

  useEffect(() => {
    setOverride(null);
    setLocalRequest(null);
  }, [user.id, actualState, actualRequest?.id]);

  const pending = localRequest ?? actualRequest;
  const state = override ?? actualState;

  async function change(
    route: string,
    method: string,
    next: ContactState,
    message: string,
    body?: unknown
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await api<{ request?: FriendRequest }>(route, method, body);
      setLocalRequest(result.request ?? null);
      setOverride(next);
      setConfirmBlock(false);
      setConfirmRemove(false);
      setStatus(message);
      notify(message);
      await onChanged();
    } catch (error) {
      setError(failure(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (user.id === data.user.id) return <YourUsername user={data.user} notify={notify} />;

  return (
    <div className="profile-friend-actions">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="quiet" role="status">
          {status}
        </p>
      )}
      {state === 'outgoing' && (
        <p className="quiet">
          Your friend request is pending. @{user.username} can accept it when they return.
        </p>
      )}
      {state === 'incoming' && (
        <p className="quiet">@{user.username} sent you a friend request.</p>
      )}
      {state === 'blocked' && (
        <p className="quiet">
          You blocked this account. Existing group and community spaces remain shared.
        </p>
      )}
      <div className="form-actions">
        {state === 'friend' && (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onMessage(user.id)}
            >
              <MessageCircle size={15} />
              <span>Message</span>
            </button>
            <button
              type="button"
              className="secondary danger"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              <span>Remove friend</span>
            </button>
          </>
        )}
        {state === 'none' && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void change(
                '/friends/requests',
                'POST',
                'outgoing',
                `Friend request sent to @${user.username}`,
                { username: user.username }
              )
            }
          >
            <UserPlus size={15} />
            <span>Add friend</span>
          </button>
        )}
        {state === 'incoming' && pending && (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void change(
                  `/friends/requests/${pending.id}/accept`,
                  'POST',
                  'friend',
                  `You and ${display(user)} are now friends`,
                  {}
                )
              }
            >
              <span>Accept request</span>
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void change(
                  `/friends/requests/${pending.id}`,
                  'DELETE',
                  'none',
                  'Friend request declined'
                )
              }
            >
              <span>Decline request</span>
            </button>
          </>
        )}
        {state === 'outgoing' && pending && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void change(
                `/friends/requests/${pending.id}`,
                'DELETE',
                'none',
                'Friend request cancelled'
              )
            }
          >
            <span>Cancel request</span>
          </button>
        )}
        {state === 'blocked' ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void change(
                `/users/${user.id}/block`,
                'DELETE',
                'none',
                `${display(user)} was unblocked. You can send a new friend request.`
              )
            }
          >
            <span>Unblock</span>
          </button>
        ) : (
          <button
            type="button"
            className="secondary danger"
            disabled={busy}
            onClick={() => setConfirmBlock(true)}
          >
            <span>Block</span>
          </button>
        )}
      </div>

      {confirmRemove && (
        <div className="friend-confirmation">
          <p className="quiet">
            Remove @{user.username} from your friends? Existing message history stays available.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirmRemove(false)}
            >
              Keep friend
            </button>
            <button
              type="button"
              className="secondary danger"
              disabled={busy}
              onClick={() =>
                void change(`/friends/${user.id}`, 'DELETE', 'none', 'Friend removed')
              }
            >
              Confirm remove friend
            </button>
          </div>
        </div>
      )}

      {confirmBlock && (
        <div className="friend-confirmation">
          <p className="quiet">
            Block @{user.username}? This removes your friendship and pending requests and prevents direct messages. Community messages, group conversations and shared voice rooms remain available.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirmBlock(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="secondary danger"
              disabled={busy}
              onClick={() =>
                void change(
                  `/users/${user.id}/block`,
                  'POST',
                  'blocked',
                  `@${user.username} was blocked`,
                  {}
                )
              }
            >
              Confirm block
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
