import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { ArrowRight, Check, CheckCheck, Copy, MessageCircle, MoreHorizontal, ShieldOff, UserPlus, Users, X } from 'lucide-react';
import type { Bootstrap, FriendRequest, User } from '@haven/shared/types';
import { api } from './api';
import { copyWithFeedback } from './clipboard';
import { Avatar } from './components';

type FeedbackProps = { data: Bootstrap; onChanged: () => void; notify: (message: string) => void };
const display = (user?: User) => user?.displayName || user?.username || 'Unknown user';
const failure = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Try again.';

function YourUsername({ user, notify }: { user: User; notify: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await copyWithFeedback(user.username, 'Username', notify, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return <div className="own-username"><span className="quiet">Your username: <code>@{user.username}</code></span><button type="button" className="text-link" onClick={() => void copy()} aria-label="Copy your username">{copied ? <><Check size={14} className="success-text" />Copied!</> : <><Copy size={14} />Copy</>}</button></div>;
}

export function AddFriend({ data, onChanged, onPending, notify }: FeedbackProps & { onPending: () => void }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setSent('');
    const normalized = username.trim().replace(/^@/, '').toLowerCase();
    try {
      await api('/friends/requests', 'POST', { username });
      setSent(normalized); setUsername(''); notify(`Friend request sent to @${normalized}`);
      await onChanged();
    } catch (error) { setError(failure(error)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <form className="simple-form add-friend-form" onSubmit={event => void submit(event)}>
    <p className="quiet">Enter your friend’s account username, with or without @. You must both be connected to the same Haven backend. A community invite joins a community; it does not add a friend.</p>
    <YourUsername user={data.user} notify={notify} />
    <label>USERNAME<input name="username" aria-label="Friend username" placeholder="Your friend’s username" value={username} onChange={event => { setUsername(event.target.value); setError(''); }} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={65} required autoFocus disabled={busy} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {sent && <div className="friend-request-success" role="status"><p>Friend request sent to <b>@{sent}</b>. They can accept it from their Incoming requests, even if they were offline when you sent it.</p><button type="button" className="text-link" onClick={onPending}>View pending requests <ArrowRight size={14} /></button></div>}
    <div className="form-actions"><button type="button" className="secondary" onClick={onPending}>Pending requests</button><button type="submit" className="primary" disabled={busy || !username.trim()}><UserPlus size={16} />{busy ? 'Sending…' : 'Send friend request'}</button></div>
  </form>;
}

export function FriendsPage({ data, tab, setTab, query, onAdd, onCreateServer, onMessage, onProfile, onChanged, notify, onUserContext }: FeedbackProps & { tab: string; setTab: (tab: string) => void; query: string; onAdd: () => void; onCreateServer: () => void; onMessage: (userId: string) => void; onProfile: (user: User) => void; onUserContext?: (event: MouseEvent<HTMLElement>, userId: string) => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const running = useRef(false);
  useEffect(() => {
    setCompleted(previous => previous.filter(key => key.startsWith('block:') ? (data.blocked ?? []).includes(key.slice(6)) : key.startsWith('friend:') ? data.friends.includes(key.slice(7)) : data.requests.some(request => request.id === key)));
  }, [data.blocked, data.friends, data.requests]);
  const users = Object.fromEntries(data.users.map(user => [user.id, user]));
  const search = query.trim().replace(/^@/, '').toLowerCase();
  const matches = (user?: User) => !search || `${user?.displayName ?? ''} ${user?.username ?? ''}`.toLowerCase().includes(search);
  const requests = data.requests.filter(request => !completed.includes(request.id));
  const friendIds = data.friends.filter(userId => !completed.includes(`friend:${userId}`));
  const blocked = (data.blocked ?? []).filter(userId => !completed.includes(`block:${userId}`));
  const selected = (tab === 'blocked' ? blocked : friendIds.filter(userId => tab !== 'online' || (users[userId]?.status && users[userId].status !== 'offline'))).filter(userId => matches(users[userId]));
  const filteredRequests = requests.filter(request => matches(users[request.fromId === data.user.id ? request.toId : request.fromId]));
  const incoming = filteredRequests.filter(request => request.toId === data.user.id);
  const outgoing = filteredRequests.filter(request => request.fromId === data.user.id);
  async function change(key: string, route: string, method: string, message: string) {
    if (running.current) return; running.current = true; setBusy(key); setError('');
    try { await api(route, method, method === 'POST' ? {} : undefined); setCompleted(previous => [...previous, key]); notify(message); await onChanged(); }
    catch (error) { setError(failure(error)); }
    finally { running.current = false; setBusy(''); }
  }
  function person(userId: string) {
    const user = users[userId];
    return <><button className="avatar-button" aria-label={`View profile for ${display(user)}`} onClick={() => user && onProfile(user)}><Avatar user={user} /></button><span><b>{display(user)}</b><small>@{user?.username ?? userId} · {user?.status ?? 'offline'}</small></span></>;
  }
  function pendingRow(request: FriendRequest, received: boolean) {
    const userId = received ? request.fromId : request.toId; const user = users[userId];
    return <div className="friend-row" key={request.id} onContextMenu={event => onUserContext?.(event, userId)}>{person(userId)}<small className="friend-request-direction">{received ? 'Incoming' : 'Outgoing'}</small>{received && <button className="secondary small-button success-text" disabled={!!busy} aria-label={`Accept request from ${display(user)}`} title="Accept request" onClick={() => void change(request.id, `/friends/requests/${request.id}/accept`, 'POST', `You and ${display(user)} are now friends`)}><Check size={16} />Accept</button>}<button className="icon-button" disabled={!!busy} aria-label={received ? `Decline request from ${display(user)}` : `Cancel request to ${display(user)}`} title={received ? 'Decline request' : 'Cancel request'} onClick={() => void change(request.id, `/friends/requests/${request.id}`, 'DELETE', received ? 'Friend request declined' : 'Friend request cancelled')}><X size={18} /></button></div>;
  }
  return <div className="friends-page">
    <div className="friends-toolbar"><div className="tabs">{[{ id: 'all', label: 'All friends' }, { id: 'online', label: 'Online' }, { id: 'pending', label: 'Pending' }, { id: 'blocked', label: 'Blocked' }].map(item => <button className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => { setTab(item.id); setError(''); }}>{item.label}{item.id === 'pending' && requests.length > 0 && <b>{requests.length}</b>}</button>)}</div><button className="primary small-button" onClick={onAdd}><UserPlus size={15} /> Add friend</button></div>
    <div className="friends-heading"><p className="eyebrow">A PLACE TO BELONG</p><h1>Better, together<span>.</span></h1><p>Your people are just a conversation away.</p><YourUsername user={data.user} notify={notify} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="friend-list" aria-busy={!!busy}>
      {tab === 'pending' ? <>
        {incoming.length > 0 && <><div className="section-label"><span>INCOMING — {incoming.length}</span></div>{incoming.map(request => pendingRow(request, true))}</>}
        {outgoing.length > 0 && <><div className="section-label"><span>OUTGOING — {outgoing.length}</span></div>{outgoing.map(request => pendingRow(request, false))}</>}
        {!filteredRequests.length && <div className="empty-state"><CheckCheck size={32} /><h3>{search ? 'No matching requests' : 'All caught up'}</h3><p>{search ? 'Try another username or display name.' : 'Incoming and outgoing friend requests appear here. Offline recipients will see their requests when they return.'}</p></div>}
      </> : <>
        <div className="section-label"><span>{tab === 'blocked' ? 'BLOCKED' : tab === 'online' ? 'ONLINE' : 'ALL FRIENDS'} — {selected.length}</span></div>
        {selected.map(userId => <div className="friend-row" key={userId} onContextMenu={event => onUserContext?.(event, userId)}>{person(userId)}{tab === 'blocked' ? <button className="secondary small-button" disabled={!!busy} onClick={() => void change(`block:${userId}`, `/users/${userId}/block`, 'DELETE', `${display(users[userId])} was unblocked. You can send a new friend request.`)}><ShieldOff size={15} />Unblock</button> : <><button className="round-button" title={`Message ${display(users[userId])}`} aria-label={`Message ${display(users[userId])}`} onClick={() => onMessage(userId)}><MessageCircle size={19} /></button><button className="icon-button" title="View profile" aria-label={`View profile for ${display(users[userId])}`} onClick={() => users[userId] && onProfile(users[userId])}><MoreHorizontal size={19} /></button></>}</div>)}
        {!selected.length && <div className="empty-state"><Users size={35} /><h3>{search ? 'No matching people' : tab === 'blocked' ? 'No blocked accounts' : tab === 'online' ? 'Your friends are away' : 'Your circle starts here'}</h3><p>{search ? 'Search by username or display name.' : tab === 'blocked' ? 'Accounts you block appear here. Blocking prevents direct contact while preserving shared community and group spaces.' : tab === 'online' ? 'Offline friends are still in All friends. You can leave them a direct message.' : 'Add a friend by username on this Haven backend, or create a server and invite your people.'}</p>{!search && tab === 'all' && <div className="form-actions"><button className="primary" onClick={onAdd}>Add your first friend <ArrowRight size={16} /></button><button className="secondary" onClick={onCreateServer}>Create a server</button></div>}</div>}
      </>}
    </div>
  </div>;
}

type ContactState = 'friend' | 'blocked' | 'incoming' | 'outgoing' | 'none';
export function ProfileActions({ data, user, onChanged, onMessage, notify }: FeedbackProps & { user: User; onMessage: (userId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [override, setOverride] = useState<ContactState | null>(null);
  const [localRequest, setLocalRequest] = useState<FriendRequest | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const running = useRef(false);
  useEffect(() => { setOverride(null); setError(''); setStatus(''); setConfirmBlock(false); setConfirmRemove(false); }, [user.id]);
  const actualRequest = data.requests.find(request => (request.fromId === user.id && request.toId === data.user.id) || (request.toId === user.id && request.fromId === data.user.id));
  const actualState: ContactState = (data.blocked ?? []).includes(user.id) ? 'blocked' : data.friends.includes(user.id) ? 'friend' : actualRequest ? actualRequest.toId === data.user.id ? 'incoming' : 'outgoing' : 'none';
  useEffect(() => { setOverride(null); setLocalRequest(null); }, [user.id, actualState, actualRequest?.id]);
  const pending = localRequest ?? actualRequest;
  const state = override ?? actualState;
  async function change(route: string, method: string, next: ContactState, message: string, body?: unknown) {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setStatus('');
    try { const result = await api<{ request?: FriendRequest }>(route, method, body); setLocalRequest(result.request ?? null); setOverride(next); setConfirmBlock(false); setConfirmRemove(false); setStatus(message); notify(message); await onChanged(); }
    catch (error) { setError(failure(error)); }
    finally { running.current = false; setBusy(false); }
  }
  if (user.id === data.user.id) return <YourUsername user={data.user} notify={notify} />;
  return <div className="profile-friend-actions">
    {error && <p className="form-error" role="alert">{error}</p>}{status && <p className="quiet" role="status">{status}</p>}
    {state === 'outgoing' && <p className="quiet">Your friend request is pending. @{user.username} can accept it when they return.</p>}
    {state === 'incoming' && <p className="quiet">@{user.username} sent you a friend request.</p>}
    {state === 'blocked' && <p className="quiet">You blocked this account. Existing group and community spaces remain shared.</p>}
    <div className="form-actions">
      {state === 'friend' && <><button className="primary" disabled={busy} onClick={() => onMessage(user.id)}><MessageCircle size={16} />Message</button><button className="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove friend</button></>}
      {state === 'none' && <button className="primary" disabled={busy} onClick={() => void change('/friends/requests', 'POST', 'outgoing', `Friend request sent to @${user.username}`, { username: user.username })}><UserPlus size={16} />Add friend</button>}
      {state === 'incoming' && pending && <><button className="primary" disabled={busy} onClick={() => void change(`/friends/requests/${pending.id}/accept`, 'POST', 'friend', `You and ${display(user)} are now friends`, {})}>Accept request</button><button className="secondary" disabled={busy} onClick={() => void change(`/friends/requests/${pending.id}`, 'DELETE', 'none', 'Friend request declined')}>Decline request</button></>}
      {state === 'outgoing' && pending && <button className="secondary" disabled={busy} onClick={() => void change(`/friends/requests/${pending.id}`, 'DELETE', 'none', 'Friend request cancelled')}>Cancel request</button>}
      {state === 'blocked' ? <button className="secondary" disabled={busy} onClick={() => void change(`/users/${user.id}/block`, 'DELETE', 'none', `${display(user)} was unblocked. You can send a new friend request.`)}>Unblock</button> : <button className="secondary danger" disabled={busy} onClick={() => setConfirmBlock(true)}>Block</button>}
    </div>
    {confirmRemove && <div className="friend-confirmation"><p className="quiet">Remove @{user.username} from your friends? Existing message history stays available.</p><div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep friend</button><button className="secondary danger" disabled={busy} onClick={() => void change(`/friends/${user.id}`, 'DELETE', 'none', 'Friend removed')}>Confirm remove friend</button></div></div>}
    {confirmBlock && <div className="friend-confirmation"><p className="quiet">Block @{user.username}? This removes your friendship and pending requests and prevents direct messages. Community messages, group conversations and shared voice rooms remain available.</p><div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setConfirmBlock(false)}>Cancel</button><button className="secondary danger" disabled={busy} onClick={() => void change(`/users/${user.id}/block`, 'POST', 'blocked', `@${user.username} was blocked`, {})}>Confirm block</button></div></div>}
  </div>;
}
