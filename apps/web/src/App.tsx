import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowDown, ArrowLeft, ArrowRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, Copy, File, Hash, Headphones, HeadphoneOff, Home, LogOut, MessageCircle, Mic, MicOff, MonitorUp, MoreHorizontal, Plus, Search, Send, Settings, Shield, Smile, Sparkles, Trash2, UserPlus, Users, Volume2, X, PhoneOff, Radio, SlidersHorizontal, Music2, Pencil, Reply, Link, Wifi, WifiOff } from 'lucide-react';
import type { Attachment, Bootstrap, Channel, Conversation, Message, Server, Sound, User } from '@haven/shared/types';
import { api, getApiBaseUrl, resolveApiUrl } from './api';
import { initSupabase, getSupabase, getAccessToken, onSupabaseAuthStateChange } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLoginUsername, usernameCharacters } from '@haven/shared/auth';
import { Avatar, Modal, Video } from './components';
import { useMedia } from './media';
import StreamStatistics from './StreamStatistics';
import VoicePanel from './VoicePanel';
import ConversationOptions from './ConversationOptions';
import QuickSwitcher from './QuickSwitcher';
import VoiceConnection from './VoiceConnection';
import StreamViewer from './StreamViewer';
import { MicrophoneTest } from './MicrophoneTest';
import { ClientTools, parseHavenAddress } from './desktop-tools';
import { CommunityJoin, InviteCreate, InviteRedeem } from './Invitations';
import { inviteCodeFromPath } from './invite-links';
import { AddFriend, FriendsPage, ProfileActions } from './Friends';
import { Emoji, EmojiText, EmojiPicker, EmojiMotionProvider } from './emoji';
import { usePreferences, type Preferences } from './preferences';
import { DesktopSettings } from './desktop-settings';
import ProfileCard, { ImageViewer } from './ProfileCard';
import ServerSettings, { ServerIcon, type CommunityMember } from './ServerSettings';
import UserContextMenu from './UserContextMenu';
import { ContextMenu, MenuItem, type MenuPosition } from './ContextMenu';
import { profileImageSource } from './profile-images';
import { bootstrapUpdates, mergeBootstrapUpdates } from './bootstrap-updates';
import { VoiceControls } from './VoiceControlDropdowns';
import { copyWithFeedback } from './clipboard';
import './community.css';

type AppContextTarget = MenuPosition & ({ kind: 'user'; userId: string; serverId?: string } | { kind: 'server'; serverId: string } | { kind: 'channel'; channelId: string });
type Selection = { channelId: string } | { conversationId: string } | null;
type Dialog = 'create-server' | 'join-server' | 'channel' | 'invite' | 'settings' | 'server-settings' | 'add-friend' | 'group' | 'soundboard' | 'share' | null;
const display = (user?: { displayName?: string; username?: string }) => user?.displayName || user?.username || 'Unknown user';
const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [serverId, setServerId] = useState<string | null>(localStorage.getItem('haven.server'));
  const [selection, setSelection] = useState<Selection>(() => { try { const saved = JSON.parse(localStorage.getItem('haven.selection') || 'null'); return saved && (typeof saved.channelId === 'string' || typeof saved.conversationId === 'string') ? saved : null; } catch { return null; } });
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [settingsTab, setSettingsTab] = useState('profile');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [friendTab, setFriendTab] = useState('all');
  const [voiceViewChannelId, setVoiceViewChannelId] = useState<string | null>(null);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => inviteCodeFromPath(window.location.pathname));
  const [authInviteOpen, setAuthInviteOpen] = useState(() => Boolean(inviteCodeFromPath(window.location.pathname)));
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [reply, setReply] = useState<Message | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [profile, setProfile] = useState<User | null>(null);
  const [contextTarget, setContextTarget] = useState<AppContextTarget | null>(null);
  const [pictureUser, setPictureUser] = useState<User | null>(null);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection);
  const bootRef = useRef(boot);
  const requestVersion = useRef(0);
  const deletedMessageIds = useRef(new Set<string>());
  const bootstrapRequest = useRef<{ userId: string; updates: ReturnType<typeof bootstrapUpdates> } | null>(null);
  selectionRef.current = selection;
  bootRef.current = boot;
  const notify = useCallback((message: string) => setToast(message), []);
  const media = useMedia(socket, boot?.user.id || '', notify);
  const { preferences, setPreferences } = usePreferences();
  const preferencesRef = useRef(preferences);
  const backgroundRef = useRef(false);
  const deferredVoiceActivity = useRef(new Map<string, boolean>());
  preferencesRef.current = preferences;
  backgroundRef.current = media.background;
  useEffect(() => {
    document.documentElement.dataset.gaming = String(media.settings.gamingMode);
    document.documentElement.dataset.background = String(media.background);
  }, [media.settings.gamingMode, media.background]);
  useEffect(() => {
    if (media.background || !deferredVoiceActivity.current.size) return;
    const pending = new Map(deferredVoiceActivity.current);
    deferredVoiceActivity.current.clear();
    setBoot(previous => previous && ({ ...previous, voice: previous.voice.map(peer => pending.has(peer.socketId) ? { ...peer, speaking: pending.get(peer.socketId)! } : peer) }));
  }, [media.background]);
  const soundServerId = boot?.channels.find(item => item.id === media.voiceChannelId)?.serverId || serverId;
  const soundCanManage = boot?.servers.find(item => item.id === soundServerId)?.role !== 'member';
  const scope = selection ? 'channelId' in selection ? `channelId=${encodeURIComponent(selection.channelId)}` : `conversationId=${encodeURIComponent(selection.conversationId)}` : '';
  const channel = boot?.channels.find(item => selection && 'channelId' in selection && item.id === selection.channelId);
  const conversation = boot?.conversations.find(item => selection && 'conversationId' in selection && item.id === selection.conversationId);
  const server = boot?.servers.find(item => item.id === serverId);
  const canManage = server?.role === 'owner' || server?.role === 'admin';
  const users = useMemo(() => Object.fromEntries((boot?.users || []).map(user => [user.id, user])), [boot?.users]);
  const viewedVoice = boot?.channels.find(item => item.id === voiceViewChannelId);
  const channelName = (voiceViewChannelId && viewedVoice ? viewedVoice.name : '') || channel?.name || (conversation ? conversation.name || conversation.memberIds.filter(id => id !== boot?.user.id).map(id => display(users[id])).join(', ') : 'Friends');

  const refresh = useCallback(async () => {
    const request = { userId: bootRef.current?.user.id || '', updates: bootstrapUpdates() };
    bootstrapRequest.current = request;
    try {
      const data = await api<Bootstrap>('/bootstrap');
      if (bootstrapRequest.current === request) setBoot(current => current?.user.id === request.userId ? mergeBootstrapUpdates(data, request.updates) : current);
      return data;
    }
    catch (error) { if (!(error instanceof Error && /sign|auth|session/i.test(error.message))) notify((error as Error).message); return null; }
    finally { if (bootstrapRequest.current === request) bootstrapRequest.current = null; }
  }, [notify]);

  useEffect(() => {
    void api<Bootstrap>('/bootstrap').then(setBoot).catch(() => {}).finally(() => setLoading(false));
    let active = true;
    const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
    const search = typeof window !== 'undefined' ? window.location.search || '' : '';
    if (hash.includes('type=recovery') || search.includes('type=recovery')) {
      setRecoveryOpen(true);
    }
    void initSupabase().then(client => {
      if (!active || !client) return;
      onSupabaseAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryOpen(true);
          return;
        }
        if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          if (session.user?.email && !session.user.email_confirmed_at) {
            client.auth.signOut().catch(() => {});
            return;
          }
          api<Bootstrap>('/bootstrap').then(setBoot).catch(() => {});
        } else if (event === 'SIGNED_OUT') {
          setBoot(null);
          setSelection(null);
        }
      });
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { localStorage.setItem('haven.server', serverId || ''); }, [serverId]);
  useEffect(() => { localStorage.setItem('haven.selection', JSON.stringify(selection)); }, [selection]);
  useEffect(() => {
    if (!boot) return;
    if (serverId && !boot.servers.some(item => item.id === serverId)) { setServerId(null); setSelection(null); return; }
    if (selection && !('channelId' in selection ? boot.channels.some(item => item.id === selection.channelId) : boot.conversations.some(item => item.id === selection.conversationId))) setSelection(null);
  }, [boot?.servers, boot?.channels, boot?.conversations]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setFormError(''); setInvite(''); }, [dialog]);
  useEffect(() => {
    if (!boot?.user.id) return;
    let cancelled = false;
    let activeSocket: Socket | null = null;
    (async () => {
      const token = await getAccessToken().catch(() => null);
      if (cancelled) return;
      const connection = io(getApiBaseUrl() || undefined, {
        withCredentials: true,
        reconnection: true,
        auth: (cb: (data: Record<string, unknown>) => void) => {
          getAccessToken().then(tok => cb(tok ? { token: tok } : {})).catch(() => cb({}));
        },
      });
      activeSocket = connection;
      setSocket(connection);
      connection.on('connect', () => { setConnected(true); void refresh(); void loadCurrentMessages(); });
      connection.on('disconnect', () => setConnected(false));
      connection.on('connect_error', error => { setConnected(false); notify(`Connection: ${error.message}`); });
      connection.on('sync', () => void refresh());
      connection.on('user:update', (updated: User) => {
        bootstrapRequest.current?.updates.users.set(updated.id, { ...bootstrapRequest.current.updates.users.get(updated.id), ...updated });
        setBoot(previous => previous && ({ ...previous, user: previous.user.id === updated.id ? { ...previous.user, ...updated } : previous.user, users: previous.users.map(user => user.id === updated.id ? { ...user, ...updated } : user), voice: previous.voice.map(peer => peer.user.id === updated.id ? { ...peer, user: { ...peer.user, ...updated } } : peer) }));
      });
      connection.on('voice:activity', ({ socketId, speaking }) => {
        bootstrapRequest.current?.updates.voice.set(socketId, { ...bootstrapRequest.current.updates.voice.get(socketId), speaking });
      if (backgroundRef.current) { deferredVoiceActivity.current.set(socketId, speaking); return; }
      setBoot(previous => previous && previous.voice.some(peer => peer.socketId === socketId && peer.speaking !== speaking) ? ({ ...previous, voice: previous.voice.map(peer => peer.socketId === socketId ? { ...peer, speaking } : peer) }) : previous);
      });
      connection.on('voice:state', ({ socketId, ...state }) => {
        bootstrapRequest.current?.updates.voice.set(socketId, { ...bootstrapRequest.current.updates.voice.get(socketId), ...state });
        setBoot(previous => previous && ({ ...previous, voice: previous.voice.map(peer => peer.socketId === socketId ? { ...peer, ...state } : peer) }));
      });
      connection.on('presence', ({ userId, status }) => {
        bootstrapRequest.current?.updates.users.set(userId, { ...bootstrapRequest.current.updates.users.get(userId), status });
        setBoot(previous => previous && ({ ...previous, users: previous.users.map(user => user.id === userId ? { ...user, status } : user) }));
      });
      connection.on('typing', ({ scope: typingScope, userId }) => {
        const selected = selectionRef.current;
        const id = selected && ('channelId' in selected ? selected.channelId : selected.conversationId);
        if (typingScope === id && userId !== bootRef.current?.user.id) setTyping(previous => ({ ...previous, [userId]: Date.now() + 3500 }));
      });
      connection.on('message', (message: Message) => {
        const selected = selectionRef.current;
        const active = selected && ('channelId' in selected ? message.channelId === selected.channelId : message.conversationId === selected.conversationId);
        if (active) {
          setMessages(previous => previous.some(item => item.id === message.id) ? previous.map(item => item.id === message.id ? message : item) : [...previous, message]);
          if (!timeline.current || timeline.current.scrollHeight - timeline.current.scrollTop - timeline.current.clientHeight < 160 || message.authorId === bootRef.current?.user.id) setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 40);
        } else if (message.authorId !== bootRef.current?.user.id) {
          const id = message.channelId || message.conversationId!;
          setUnread(previous => ({ ...previous, [id]: (previous[id] || 0) + 1 }));
          if ((document.hidden || backgroundRef.current) && preferencesRef.current.notifications && bootRef.current?.user.status !== 'dnd' && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`Haven · ${display(bootRef.current?.users.find(user => user.id === message.authorId))}`, { body: message.content.slice(0, 160) || 'Sent an attachment' });
        }
      });
      connection.on('message:delete', ({ id }) => { deletedMessageIds.current.add(id); setMessages(previous => previous.filter(message => message.id !== id)); });
      connection.on('message:update', (message: Message) => setMessages(previous => previous.map(item => item.id === message.id ? message : item)));
    })();
    return () => {
      cancelled = true;
      deferredVoiceActivity.current.clear();
      if (activeSocket) activeSocket.disconnect();
      setSocket(null);
    };
  }, [boot?.user.id, refresh, notify]);

  async function loadCurrentMessages() {
    const selected = selectionRef.current;
    if (!selected) return;
    const params = new URLSearchParams(selected);
    try { const result = await api<{ messages: Message[]; hasMore: boolean }>(`/messages?${params}`); if (selectionRef.current === selected) { setMessages(result.messages); setHasMore(result.hasMore); } } catch (error) { notify((error as Error).message); }
  }

  useEffect(() => {
    const version = ++requestVersion.current;
    deletedMessageIds.current.clear();
    setReply(null); setTyping({}); setMessages([]);
    if (!scope) return;
    setMessageLoading(true);
    void api<{ messages: Message[]; hasMore: boolean }>(`/messages?${scope}${query ? `&q=${encodeURIComponent(query)}` : ''}`).then(result => { if (version === requestVersion.current) { setMessages(result.messages); setHasMore(result.hasMore); setTimeout(() => bottom.current?.scrollIntoView(), 30); } }).catch(error => notify(error.message)).finally(() => { if (version === requestVersion.current) setMessageLoading(false); });
    const id = selection && ('channelId' in selection ? selection.channelId : selection.conversationId);
    if (id) setUnread(previous => ({ ...previous, [id]: 0 }));
  }, [scope, query]);
  useEffect(() => {
    const expiry = Math.min(...Object.values(typing));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setTyping(previous => Object.fromEntries(Object.entries(previous).filter(([, expires]) => expires > Date.now()))), Math.max(1, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [typing]);
  useEffect(() => {
    if (!serverId || !boot?.servers.some(item => item.id === serverId)) { setMembers([]); return; }
    void api<{ members: typeof members }>(`/servers/${serverId}/members`).then(result => setMembers(result.members)).catch(error => notify(error.message));
  }, [serverId, boot?.users, boot?.servers]);
  useEffect(() => { if (dialog === 'soundboard' && soundServerId) void api<{ sounds: Sound[] }>(`/servers/${soundServerId}/sounds`).then(result => setSounds(result.sounds)).catch(error => notify(error.message)); }, [dialog, soundServerId]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); setQuickOpen(true); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);

  useEffect(() => { if (!media.voiceChannelId && media.connectionStatus === 'disconnected') { setVoiceViewChannelId(null); setWatchingId(null); } }, [media.voiceChannelId, media.connectionStatus]);
  useEffect(() => {
    if (watchingId === 'self' && !media.screenStream) setWatchingId(null);
    else if (watchingId && watchingId !== 'self' && !media.peers.some(peer => peer.socketId === watchingId && peer.state.sharing)) setWatchingId(null);
  }, [watchingId, media.screenStream, media.peers]);
  useEffect(() => { setVoiceViewChannelId(null); setWatchingId(null); }, [scope, serverId]);
  async function finishJoining(id: string) {
    const data = await refresh(); if (!data) return;
    const first = data.channels.find(item => item.serverId === id && item.type === 'text');
    setServerId(id); setSelection(first ? { channelId: first.id } : null); setPendingInvite(null); setDialog(null); setQuery(''); setMobileNav(false); history.replaceState({}, '', '/'); notify('Community joined');
  }
  function savePendingInvite(code: string) { setPendingInvite(code); setAuthInviteOpen(false); history.replaceState({}, '', `/invite/${code}`); }
  function chooseServer(id: string | null) {
    setVoiceViewChannelId(null); setWatchingId(null);
    setServerId(id); localStorage.setItem('haven.server', id || ''); setQuery(''); setMobileNav(false);
    const first = boot?.channels.filter(item => item.serverId === id && item.type === 'text').sort((left, right) => left.position - right.position)[0];
    setSelection(first ? { channelId: first.id } : null);
  }
  useEffect(() => { if (boot && serverId && !selection) { const first = boot.channels.find(item => item.serverId === serverId && item.type === 'text'); if (first) setSelection({ channelId: first.id }); } }, [boot?.servers.length]);
  async function action(operation: () => Promise<void>) { setBusy(true); setFormError(''); try { await operation(); } catch (error) { setFormError((error as Error).message); notify((error as Error).message); } finally { setBusy(false); } }
  const showDialog = (next: Dialog) => { setDialog(next); setFormError(''); };
  const showSettings = (tab = 'profile') => { setSettingsTab(tab); showDialog('settings'); };
  async function startDM(userId: string) { await action(async () => { const result = await api<{ conversation: Conversation }>('/conversations', 'POST', { memberIds: [userId] }); await refresh(); setServerId(null); setSelection({ conversationId: result.conversation.id }); setProfile(null); }); }
  async function older() { if (!messages.length) return; const result = await api<{ messages: Message[]; hasMore: boolean }>(`/messages?${scope}&before=${messages[0].createdAt}${query ? `&q=${encodeURIComponent(query)}` : ''}`); const height = timeline.current?.scrollHeight || 0; setMessages(previous => [...result.messages, ...previous]); setHasMore(result.hasMore); requestAnimationFrame(() => { if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight - height; }); }

  function contextProps(target: { kind: 'user'; userId: string; serverId?: string } | { kind: 'server'; serverId: string } | { kind: 'channel'; channelId: string }) {
    const open = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation();
      const rectangle = event.currentTarget.getBoundingClientRect();
      const pointer = 'clientX' in event && (event.clientX || event.clientY);
      setContextTarget({ ...target, x: pointer ? event.clientX : rectangle.left + 12, y: pointer ? event.clientY : rectangle.bottom });
    };
    return { onContextMenu: open, onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') open(event); } };
  }
  const canonicalUser = (userId: string) => boot?.user.id === userId ? boot.user : users[userId] || boot?.voice.find(peer => peer.user.id === userId)?.user;

  const handleUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('newPassword') || '');
    const confirmPassword = String(form.get('confirmPassword') || '');
    if (newPassword.length < 8) {
      setRecoveryError('Password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoveryError('Passwords do not match');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase client not initialized');
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw error;
      notify('Password updated successfully! Welcome back to Haven.');
      setRecoveryOpen(false);
      if (window.location.hash.includes('access_token') || window.location.search.includes('code=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      const data = await api<Bootstrap>('/bootstrap');
      setBoot(data);
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const renderRecoveryModal = () => (
    <Modal title="Choose a new password" onClose={() => setRecoveryOpen(false)}>
      <form className="simple-form" onSubmit={handleUpdatePassword}>
        <p className="quiet">Enter a new secure password for your Haven account (at least 8 characters).</p>
        {recoveryError && <p className="form-error" role="alert">{recoveryError}</p>}
        <label>NEW PASSWORD<input type="password" name="newPassword" autoComplete="new-password" placeholder="At least 8 characters" required minLength={8} maxLength={128} autoFocus /></label>
        <label>CONFIRM NEW PASSWORD<input type="password" name="confirmPassword" autoComplete="new-password" placeholder="Repeat new password" required minLength={8} maxLength={128} /></label>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={recoveryBusy}>
            {recoveryBusy ? 'Updating…' : 'Update password'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );

  if (loading) return <div className="loading"><Brand /><span>Finding your place…</span></div>;
  if (!boot) return <>
    <Auth onLogin={data => { setBoot(data); setSelection(null); }} notify={notify} />
    <ServerConnection onPending={savePendingInvite} />
    {pendingInvite && !authInviteOpen && <div className="pending-invite-note">Invitation saved. Sign in or create an account to continue.</div>}
    {pendingInvite && authInviteOpen && <Modal title="Community invitation" onClose={() => setAuthInviteOpen(false)}><InviteRedeem code={pendingInvite} authenticated={false} onJoined={() => {}} onAuthenticate={() => setAuthInviteOpen(false)} /></Modal>}
    {recoveryOpen && renderRecoveryModal()}
  </>;
  const me = boot.user;
  const serverChannels = boot.channels.filter(item => item.serverId === serverId).sort((left, right) => left.position - right.position);
  const activeTyping = Object.keys(typing).map(id => display(users[id]));
  const currentVoice = boot.channels.find(item => item.id === media.voiceChannelId);
  const watchedPeer = media.peers.find(peer => peer.socketId === watchingId && peer.state.sharing);
  const watchedStream = watchingId === 'self' ? media.screenStream : watchedPeer?.stream?.getVideoTracks().length ? watchedPeer.stream : null;
  const watchedName = watchingId === 'self' ? 'Your screen' : watchedPeer?.user.displayName || watchedPeer?.user.username || 'Participant';
  const onWatch = (id: string) => setWatchingId(id);

  const profileUser = profile ? canonicalUser(profile.id) || profile : null;
  const picture = pictureUser ? canonicalUser(pictureUser.id) || pictureUser : null;
  const pictureSource = profileImageSource(picture?.avatar);
  const contextUser = contextTarget?.kind === 'user' ? canonicalUser(contextTarget.userId) : undefined;
  const contextServer = contextTarget && 'serverId' in contextTarget ? boot.servers.find(item => item.id === contextTarget.serverId) : undefined;
  const contextChannel = contextTarget?.kind === 'channel' ? boot.channels.find(item => item.id === contextTarget.channelId) : undefined;
  return <EmojiMotionProvider customEmojis={boot.serverEmojis || []} serverId={channel?.serverId} enabled={preferences.animateEmoji} gamingMode={media.settings.gamingMode} background={media.background}><div className={`app ${mobileNav ? 'nav-open' : ''}`}>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <nav className="server-rail" aria-label="Servers">
      <button className={`server-icon haven-icon ${!serverId ? 'selected' : ''}`} aria-label="Home" title="Home" onClick={() => chooseServer(null)}><Brand compact /></button>
      <div className="rail-divider" />
      {boot.servers.map(item => <button key={item.id} className={`server-icon ${serverId === item.id ? 'selected' : ''}`} title={item.name} aria-label={item.name} {...contextProps({ kind: 'server', serverId: item.id })} onClick={() => chooseServer(item.id)}><ServerIcon server={item} />{boot.channels.some(channelItem => channelItem.serverId === item.id && unread[channelItem.id]) && <span className="unread-dot" />}</button>)}
      <button className="server-icon add-server" aria-label="Create a server" title="Create a server" onClick={() => showDialog('create-server')}><Plus /></button>
      <button className="server-icon join-server" aria-label="Join a server" title="Join a community with an invite" onClick={() => showDialog('join-server')}><Link size={22} /></button>
      <div className="rail-spacer" /><span className="rail-label">HAVEN</span><button className="server-icon small" title="Settings" aria-label="Settings" onClick={() => showSettings('profile')}><Settings size={20} /></button>
    </nav>
    <aside className="channel-sidebar">
      <header className="sidebar-header"><span className="server-name" title={server?.description || server?.name}>{server?.name || 'Your space'}</span><button className="icon-button" title={server ? 'Server options' : 'Create group message'} aria-label={server ? 'Server options' : 'Create group message'} onClick={() => showDialog(server ? 'server-settings' : 'group')}>{server ? <ChevronDown size={19} /> : <Pencil size={17} />}</button></header>
      <div className="sidebar-scroll">
        {server ? <>
          <div className="server-banner"><div className="banner-orbit" /><span>GOOD COMPANY.<br />GREAT CONVERSATIONS.</span><Sparkles size={19} /></div>
          <button className="invite-button" onClick={() => showDialog('invite')}><UserPlus size={16} /> Invite your people <ArrowRight size={15} /></button>
          <div className="channel-section"><div className="section-label"><span><ChevronDown size={13} /> TEXT CHANNELS</span>{canManage && <button title="Create channel" aria-label="Create channel" onClick={() => { setEditChannel(null); showDialog('channel'); }}><Plus size={16} /></button>}</div>
            {serverChannels.filter(item => item.type === 'text').map(item => <div className={`channel-row ${channel?.id === item.id ? 'active' : ''}`} key={item.id}><button {...contextProps({ kind: 'channel', channelId: item.id })} onClick={() => { setVoiceViewChannelId(null); setSelection({ channelId: item.id }); setQuery(''); setMobileNav(false); }}><Hash size={20} /><span>{item.name}</span>{unread[item.id] > 0 && <b className="badge">{unread[item.id]}</b>}</button>{canManage && <button className="channel-edit" title={`Edit ${item.name}`} onClick={() => { setEditChannel(item); showDialog('channel'); }}><Settings size={13} /></button>}</div>)}
          </div>
          <div className="channel-section"><div className="section-label"><span><ChevronDown size={13} /> VOICE CHANNELS</span>{canManage && <button title="Create voice channel" aria-label="Create voice channel" onClick={() => { setEditChannel(null); showDialog('channel'); }}><Plus size={16} /></button>}</div>
            {serverChannels.filter(item => item.type === 'voice').map(item => <div key={item.id}><div className={`channel-row ${media.voiceChannelId === item.id ? 'voice-active' : ''}`}><button {...contextProps({ kind: 'channel', channelId: item.id })} onClick={async () => { if (media.voiceChannelId !== item.id) await media.join(item.id); setVoiceViewChannelId(item.id); setMobileNav(false); }}><Volume2 size={19} /><span>{item.name}</span>{media.voiceChannelId === item.id && <Radio size={14} />}</button>{canManage && <button className="channel-edit" title={`Edit ${item.name}`} onClick={() => { setEditChannel(item); showDialog('channel'); }}><Settings size={13} /></button>}</div><div className="voice-roster">{boot.voice.filter(peer => peer.channelId === item.id).map(peer => { const local = peer.socketId === socket?.id; const speaking = local ? media.speaking : peer.speaking; const muted = local ? media.muted : peer.muted; const deafened = local ? media.deafened : peer.deafened; const sharing = local ? media.sharing : peer.sharing; return <button {...contextProps({ kind: 'user', userId: peer.user.id, serverId: item.serverId })} className={speaking && !muted && !deafened ? 'speaking' : ''} aria-label={`${display(peer.user)} in ${item.name}${speaking ? ', speaking' : ''}${muted ? ', muted' : ''}${deafened ? ', deafened' : ''}${sharing ? ', streaming' : ''}`} key={peer.socketId} onClick={() => { if (media.voiceChannelId === item.id) { setVoiceViewChannelId(item.id); if (sharing) onWatch(local ? 'self' : peer.socketId); } else setProfile(peer.user); }}><Avatar user={canonicalUser(peer.user.id) || peer.user} size={24} /><span>{display(canonicalUser(peer.user.id) || peer.user)}</span>{muted && <MicOff size={12} />}{deafened && <HeadphoneOff size={12} />}{sharing && <b className="live-tag">LIVE</b>}</button>; })}</div></div>)}
          </div>
          <div className="sidebar-note"><Shield size={17} /><span>Your community.<br /><small>Your own little corner.</small></span></div>
        </> : <>
          <button className="sidebar-search" onClick={() => setQuickOpen(true)}><Search size={15} /> Find a conversation <kbd>Ctrl K</kbd></button>
          <button className={`home-item ${!selection ? 'active' : ''}`} onClick={() => setSelection(null)}><Users size={20} /> Friends {boot.requests.filter(item => item.toId === me.id).length > 0 && <b className="badge">{boot.requests.filter(item => item.toId === me.id).length}</b>}</button>
          <div className="section-label dm-label"><span>DIRECT MESSAGES</span><button title="New group message" aria-label="New group message" onClick={() => showDialog('group')}><Plus size={16} /></button></div>
          {boot.conversations.map(item => { const other = users[item.memberIds.find(id => id !== me.id) || me.id]; return <button key={item.id} className={`dm-row ${conversation?.id === item.id ? 'active' : ''}`} onClick={() => { setSelection({ conversationId: item.id }); setQuery(''); setMobileNav(false); }}><Avatar user={other} size={31} /><span>{item.name || (item.memberIds.length > 2 ? `${display(other)} + ${item.memberIds.length - 2}` : display(other))}<small>{item.memberIds.length > 2 ? `${item.memberIds.length} members` : other?.status || 'offline'}</small></span>{unread[item.id] > 0 && <b className="badge">{unread[item.id]}</b>}</button>; })}
          {!boot.conversations.length && <p className="quiet sidebar-empty">Good conversations start<br />with a hello. Add a friend.</p>}
        </>}
      </div>
      <VoiceConnection media={media} channel={currentVoice} serverName={boot.servers.find(item => item.id === currentVoice?.serverId)?.name} onOpen={() => setVoiceViewChannelId(media.voiceChannelId)} onSounds={() => showDialog('soundboard')} />
      <div className="client-tools-entry"><ClientTools onError={notify} /></div>
      {dialog !== 'settings' && media.persistenceError && <p className="error" role="alert">{media.persistenceError}</p>}
      <div className="user-panel"><button className="my-profile" onClick={() => showSettings('profile')}><Avatar user={me} size={33} /><span>{display(me)}<small>{me.status === 'dnd' ? 'Do not disturb' : connected ? 'Online' : 'Connecting…'}</small></span></button><VoiceControls media={media} onOpenSettings={showSettings} /></div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(value => !value)} aria-label="Toggle navigation"><MoreHorizontal /></button><div className="channel-title">{voiceViewChannelId ? <Volume2 size={23} /> : selection ? channel ? <Hash size={23} /> : <MessageCircle size={22} /> : <Users size={22} />}<strong>{channelName}</strong>{channel?.topic && <><span className="topbar-divider" /><span className="channel-topic">{channel.topic}</span></>}</div><div className="topbar-tools"><span className={`connection-dot ${connected ? '' : 'disconnected'}`} title={connected ? 'Connected' : 'Reconnecting'} />{selection && <button className="icon-button" title="Search messages" aria-label="Search messages" onClick={() => setSearchOpen(value => !value)}><Search size={20} /></button>}<button className={`icon-button ${showMembers ? 'is-on' : ''}`} title="Toggle member list" aria-label="Toggle member list" onClick={() => setShowMembers(value => !value)}><Users size={20} /></button><button className="icon-button" title="Notification settings" aria-label="Notification settings" onClick={() => showSettings('notifications')}><Bell size={19} /></button></div></header>
      {!connected && <div className="connection-banner"><WifiOff size={14} /> Reconnecting. Your messages are saved on the server.</div>}
      {searchOpen && <div className="search-bar"><Search size={16} /><input autoFocus placeholder={selection ? 'Search this conversation…' : 'Find a person or channel…'} value={query} onChange={event => setQuery(event.target.value)} /><button className="icon-button" title="Close search" onClick={() => { setSearchOpen(false); setQuery(''); }}><X size={17} /></button></div>}
      <div className="content-row"><section className="conversation-panel">

        {voiceViewChannelId && media.voiceChannelId ? <VoicePanel media={media} me={me} onProfile={id => { const user = canonicalUser(id); if (user) setProfile(user); }} onUserContext={(event, id) => contextProps({ kind: 'user', userId: id, serverId: currentVoice?.serverId }).onContextMenu(event)} channel={currentVoice} onQuality={() => showDialog('share')} onSounds={() => showDialog('soundboard')} onWatch={onWatch} /> : selection ? <>
          <div className="message-list" ref={timeline}>
            {hasMore ? <button className="load-older" onClick={() => void older().catch(error => notify(error.message))}><ArrowDown size={14} /> Load earlier messages</button> : <div className="channel-welcome"><span className="welcome-icon">{channel ? <Hash size={32} /> : <MessageCircle size={30} />}</span><p className="eyebrow">THE BEGINNING OF SOMETHING GOOD</p><h1>{channel ? `Welcome to #${channel.name}` : channelName}</h1><p>{channel?.topic || (conversation ? 'A little space for your conversations.' : 'This is where your community comes together. Say hello.')}</p>{channel && <button className="text-link" onClick={() => showDialog('invite')}><UserPlus size={14} /> Invite a friend</button>}</div>}
            {messageLoading && <div className="quiet loading-messages">Loading messages…</div>}
            {query && <div className="search-results-label">{messages.length} matching messages</div>}
            {messages.map((message, index) => { const author = users[message.authorId]; const previous = messages[index - 1]; const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString(); const compact = !newDay && previous.authorId === message.authorId && message.createdAt - previous.createdAt < 300000 && !message.replyTo; return <div key={message.id}>{newDay && <div className="date-divider"><span>{new Date(message.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>}<MessageRow message={message} author={author} me={me} compact={compact} replyMessage={messages.find(item => item.id === message.replyTo)} users={users} canDelete={message.authorId === me.id || !!canManage} onReply={() => setReply(message)} onProfile={() => author && setProfile(author)} onError={notify} /></div>; })}
            <div ref={bottom} />
          </div>
          <div className="composer-area">{reply && <div className="reply-banner"><Reply size={15} /> Replying to <b>{display(users[reply.authorId])}</b><span>{reply.content.slice(0, 100)}</span><button className="icon-button" title="Cancel reply" onClick={() => setReply(null)}><X size={15} /></button></div>}<Composer key={`${me.id}:${scope}`} selection={selection} name={channelName} reply={reply} socket={socket} connected={connected} onSent={message => {
            // A send can finish after navigation (including leaving and returning).
            // Realtime and the destination's next load already deliver that message.
            if (selectionRef.current !== selection || bootRef.current?.user.id !== me.id || deletedMessageIds.current.has(message.id)) return;
            setMessages(previous => previous.some(item => item.id === message.id) ? previous : [...previous, message]);
            setReply(null);
            setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 30);
          }} onError={notify} /><div className="composer-hint">{activeTyping.length ? <span className="typing-dots">●●● <b>{activeTyping.join(', ')}</b> {activeTyping.length > 1 ? 'are' : 'is'} typing…</span> : <><span>Make yourself at home.</span><span><kbd>Enter</kbd> to send · <kbd>Shift + Enter</kbd> for a new line</span></>}</div></div>
        </> : <FriendsPage onUserContext={(event, id) => contextProps({ kind: 'user', userId: id }).onContextMenu(event)} data={boot} tab={friendTab} setTab={setFriendTab} query={query} onAdd={() => showDialog('add-friend')} onCreateServer={() => showDialog('create-server')} onMessage={id => void startDM(id)} onProfile={setProfile} onChanged={() => void refresh()} notify={notify} />}
      </section>
      {showMembers && <aside className="member-sidebar">{server ? <><div className="section-label"><span>MEMBERS — {members.length}</span><Users size={14} /></div>{['online', 'offline'].map(group => { const list = members.filter(member => group === 'offline' ? (users[member.user.id]?.status || member.user.status) === 'offline' : (users[member.user.id]?.status || member.user.status) !== 'offline'); return list.length ? <div key={group}><p className="member-group">{group.toUpperCase()} — {list.length}</p>{list.map(member => <button className="member-row" key={member.user.id} {...contextProps({ kind: 'user', userId: member.user.id, serverId: server.id })} onClick={() => setProfile(users[member.user.id] || member.user)}><Avatar user={users[member.user.id] || member.user} size={31} /><span>{display(users[member.user.id] || member.user)}<small>{member.role === 'owner' ? 'Server owner' : member.role === 'admin' ? 'Moderator' : member.user.bio.slice(0, 28)}</small></span>{member.role !== 'member' && <Shield size={13} />}</button>)}</div> : null; })}<button className="member-invite" onClick={() => showDialog('invite')}><Plus size={15} /> Grow your community</button></> : conversation ? <><div className="section-label"><span>IN THIS CONVERSATION</span></div>{conversation.memberIds.map(id => <button key={id} className="member-row" {...contextProps({ kind: 'user', userId: id })} onClick={() => setProfile(users[id])}><Avatar user={users[id]} size={31} /><span>{display(users[id])}</span></button>)}</> : <><div className="section-label"><span>MAKE ROOM FOR MORE</span><Sparkles size={15} /></div><div className="activity-card"><div className="activity-illustration"><i /><i /><i /><Users size={32} /></div><h3>A little closer,<br />even from far away.</h3><p>Hang out in voice. Share what’s on your screen. Build a space that’s yours.</p><button onClick={() => showDialog('create-server')}>Create your community <ArrowRight size={15} /></button></div><div className="sidebar-tip"><MonitorUp size={19} /><h4>The whole picture.</h4><p>Share at your screen’s native resolution, up to 60 fps. You set the pace.</p></div></>}</aside>}
      </div>
    </main>
    {conversation && <div className="conversation-options"><ConversationOptions conversation={conversation} onChanged={() => void refresh()} onLeft={() => { setSelection(null); void refresh(); }} /></div>}
    {quickOpen && <QuickSwitcher data={boot} onClose={() => setQuickOpen(false)} onSelect={(next, nextServer) => { setServerId(nextServer); setSelection(next); setQuery(''); setMobileNav(false); }} />}
    {watchedStream && watchingId && <StreamViewer stream={watchedStream} name={watchedName} local={watchingId === 'self'} muted={media.muted} deafened={media.deafened} onToggleMute={media.toggleMute} onToggleDeafen={media.toggleDeafen} onClose={() => setWatchingId(null)} onStop={media.stopShare} onError={notify} />}
    {pendingInvite && <Modal title="Community invitation" onClose={() => { setPendingInvite(null); history.replaceState({}, '', '/'); }}><InviteRedeem code={pendingInvite} authenticated onJoined={id => void finishJoining(id)} /></Modal>}
    {recoveryOpen && renderRecoveryModal()}
    {toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}
    {profileUser && <ProfileCard data={boot} user={profileUser} role={members.find(member => member.user.id === profileUser.id)?.role} onClose={() => setProfile(null)} onChanged={() => void refresh()} onMessage={id => void startDM(id)} notify={notify} />}
    {picture && pictureSource && <ImageViewer source={pictureSource} name={picture.displayName} onClose={() => setPictureUser(null)} />}
    {contextTarget?.kind === 'user' && contextUser && <UserContextMenu key={`${contextUser.id}:${contextTarget.serverId || ''}`} user={contextUser} data={boot} server={contextServer} members={contextServer?.id === serverId ? members : undefined} media={media} position={contextTarget} onClose={() => setContextTarget(null)} onProfile={() => setProfile(contextUser)} onPicture={() => setPictureUser(contextUser)} onMessage={() => void startDM(contextUser.id)} onChanged={() => void refresh()} notify={notify} />}
    {contextTarget?.kind === 'server' && contextServer && <ContextMenu position={contextTarget} label={`Actions for ${contextServer.name}`} onClose={() => setContextTarget(null)}>
      <MenuItem onClick={() => { chooseServer(contextServer.id); setContextTarget(null); showDialog('server-settings'); }}>Server settings</MenuItem>
      {contextServer.role !== 'member' && <MenuItem onClick={() => { chooseServer(contextServer.id); setContextTarget(null); showDialog('invite'); }}>Invite people</MenuItem>}
      <MenuItem onClick={() => { setUnread(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !boot.channels.some(item => item.id === id && item.serverId === contextServer.id)))); setContextTarget(null); }}>Mark community as read</MenuItem>
      <MenuItem onClick={() => { setContextTarget(null); void copyWithFeedback(contextServer.id, 'Server ID', notify); }}>Copy server ID</MenuItem>
    </ContextMenu>}
    {contextTarget?.kind === 'channel' && contextChannel && <ContextMenu position={contextTarget} label={`Actions for ${contextChannel.name}`} onClose={() => setContextTarget(null)}>
      <MenuItem onClick={() => { if (contextChannel.type === 'voice') { void media.join(contextChannel.id); setVoiceViewChannelId(contextChannel.id); } else { setVoiceViewChannelId(null); setSelection({ channelId: contextChannel.id }); } setContextTarget(null); }}>{contextChannel.type === 'voice' ? 'Join voice channel' : 'Open channel'}</MenuItem>
      {boot.servers.find(item => item.id === contextChannel.serverId)?.role !== 'member' && <MenuItem onClick={() => { setEditChannel(contextChannel); setContextTarget(null); showDialog('channel'); }}>Edit channel</MenuItem>}
      <MenuItem onClick={() => { setUnread(previous => ({ ...previous, [contextChannel.id]: 0 })); setContextTarget(null); }}>Mark channel as read</MenuItem>
      <MenuItem onClick={() => { setContextTarget(null); void copyWithFeedback(contextChannel.id, 'Channel ID', notify); }}>Copy channel ID</MenuItem>
    </ContextMenu>}
    {dialog && <Modal title={({ 'create-server': 'Make a space of your own', 'join-server': 'Find your people', channel: editChannel ? 'Edit channel' : 'Create a channel', invite: 'Good company starts with an invite', settings: 'Your settings', 'server-settings': 'Community settings', 'add-friend': 'Add a friend', group: 'Start a conversation', soundboard: 'A little more expression', share: 'Screen sharing' })[dialog]} wide={dialog === 'settings' || dialog === 'server-settings'} onClose={() => setDialog(null)}>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      {dialog === 'settings' && media.persistenceError && <p className="error" role="alert">{media.persistenceError}</p>}
      {dialog === 'create-server' && <SimpleForm submit="Create server" busy={busy} onSubmit={values => action(async () => { const result = await api<{ server: Server; channel: Channel }>('/servers', 'POST', values); await refresh(); setServerId(result.server.id); setSelection({ channelId: result.channel.id }); setDialog(null); })}><p className="quiet">A home for your friends, your project, your thing.</p><label>SERVER NAME<input name="name" placeholder="The cozy corner" required maxLength={80} autoFocus /></label><label>ICON <small>Optional emoji</small><input name="icon" placeholder="🌱" maxLength={8} /></label><button type="button" className="text-link" onClick={() => showDialog('join-server')}>Have an invite? Join a server</button></SimpleForm>}
      {dialog === 'join-server' && <CommunityJoin authenticated onJoined={id => void finishJoining(id)} onPending={savePendingInvite} />}
      {dialog === 'channel' && <SimpleForm submit={editChannel ? 'Save changes' : 'Create channel'} busy={busy} onSubmit={values => action(async () => { if (editChannel) await api(`/channels/${editChannel.id}`, 'PATCH', { name: values.name, topic: values.topic, position: Number(values.position) }); else await api(`/servers/${serverId}/channels`, 'POST', values); await refresh(); setDialog(null); })}><label>CHANNEL NAME<input name="name" defaultValue={editChannel?.name} placeholder="general" required maxLength={80} autoFocus /></label>{!editChannel && <label>CHANNEL TYPE<select name="type"><option value="text">Text · messages and attachments</option><option value="voice">Voice · talk and share your screen</option></select></label>}<label>TOPIC<input name="topic" defaultValue={editChannel?.topic} placeholder="What’s this channel about?" maxLength={300} /></label>{editChannel && <><label>ORDER<input type="number" min="0" name="position" defaultValue={editChannel.position} /></label><button className="danger secondary" type="button" onClick={() => { if (confirm(`Delete #${editChannel.name} and its messages?`)) void action(async () => { await api(`/channels/${editChannel.id}`, 'DELETE'); if (channel?.id === editChannel.id) setSelection(null); await refresh(); setDialog(null); }); }}><Trash2 size={15} /> Delete channel</button></>}</SimpleForm>}
      {dialog === 'invite' && server && <InviteCreate server={server} notify={notify} />}
      {dialog === 'add-friend' && <AddFriend data={boot} onChanged={() => void refresh()} onPending={() => { setServerId(null); setSelection(null); setFriendTab('pending'); setDialog(null); }} notify={notify} />}
      {dialog === 'group' && <SimpleForm submit="Start conversation" busy={busy} onSubmit={values => action(async () => { const memberIds = values.memberIds?.split(',').filter(Boolean) || []; if (!memberIds.length) throw new Error('Choose at least one friend'); const result = await api<{ conversation: Conversation }>('/conversations', 'POST', { memberIds, name: values.name }); await refresh(); setServerId(null); setSelection({ conversationId: result.conversation.id }); setDialog(null); })}><label>GROUP NAME <small>Optional</small><input name="name" placeholder="The usual suspects" maxLength={80} /></label><FriendPicker friends={boot.friends.map(id => users[id]).filter(Boolean)} />{!boot.friends.length && <p className="quiet">Add a friend first to start a conversation.</p>}</SimpleForm>}
      {dialog === 'settings' && <SettingsForm me={me} media={media} busy={busy} preferences={preferences} onPreferences={setPreferences} initialTab={settingsTab} onSave={values => action(async () => { await api('/users/me', 'PATCH', values); await refresh(); notify('Settings saved'); })} onLogout={() => void action(async () => { media.leave(); const sb = getSupabase(); if (sb) await sb.auth.signOut().catch(() => {}); if (window.haven?.clearAuthSession) await window.haven.clearAuthSession().catch(() => {}); await api('/auth/logout', 'POST').catch(() => {}); socket?.disconnect(); setBoot(null); setSelection(null); setDialog(null); })} />}
      {dialog === 'server-settings' && server && <ServerSettings server={server} members={members.map(member => ({ ...member, user: canonicalUser(member.user.id) || member.user }))} emojis={(boot.serverEmojis || []).filter(emoji => emoji.serverId === server.id)} me={me} onChanged={refresh} onLeft={() => { chooseServer(null); setDialog(null); }} notify={notify} />}
      {dialog === 'soundboard' && <div className="soundboard"><p className="quiet">Custom sounds travel through your voice connection. Join a voice channel to play for everyone.</p><div className="sound-grid">{sounds.map(sound => <div key={sound.id}><button disabled={!media.voiceChannelId || !connected} onClick={() => { socket?.emit('sound:play', { soundId: sound.id }, (result: { error?: string }) => { if (result?.error) notify(result.error); else void media.playSound(sound.url); }); }}><Music2 size={25} /><span>{sound.name}</span></button>{(soundCanManage || sound.uploaderId === me.id) && <button className="delete-sound" title="Delete sound" onClick={() => void action(async () => { await api(`/sounds/${sound.id}`, 'DELETE'); setSounds(previous => previous.filter(item => item.id !== sound.id)); })}><X size={13} /></button>}</div>)}</div>{!sounds.length && <p className="quiet">Your soundboard is waiting for its first sound.</p>}<label className="upload-sound secondary"><Plus size={16} /> Upload a sound <input type="file" accept="audio/*" hidden disabled={!soundServerId || busy} onChange={event => { const file = event.target.files?.[0]; if (!file) return; void action(async () => { const data = new FormData(); data.append('name', file.name.replace(/\.[^.]+$/, '').slice(0, 50)); data.append('file', file); const result = await api<{ sound: Sound }>(`/servers/${soundServerId}/sounds`, 'POST', data); setSounds(previous => [...previous, result.sound]); }); }} /></label><small className="quiet">Audio files up to 5 MB. Keep clips short.</small></div>}
      {dialog === 'share' && <ShareControls media={media} />}
    </Modal>}
  </div></EmojiMotionProvider>;
}

function Brand({ compact = false }: { compact?: boolean }) { return compact ? <span className="brand-mark">h<span>✳</span></span> : <div className="brand"><span className="brand-mark">h<span>✳</span></span><b>haven</b></div>; }
function ServerConnection({ onPending }: { onPending: (code: string) => void }) {
  const [mode, setMode] = useState<'host' | 'invite' | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="server-switcher"><button className="text-link" onClick={() => setMode('invite')}>Join a community</button><button className="text-link" onClick={() => setMode('host')}>Connect to a Haven host <ArrowRight size={13} /></button>{mode && <Modal title={mode === 'invite' ? 'Join a community' : 'Connect to a Haven host'} onClose={() => setMode(null)}>{mode === 'invite' ? <CommunityJoin authenticated={false} onJoined={() => {}} onPending={code => { onPending(code); setMode(null); }} /> : <SimpleForm submit="Connect" busy={busy} onSubmit={async values => { setBusy(true); setError(''); try { const target = parseHavenAddress(values.address); if (window.haven) await window.haven.connectServer(target.href); else window.location.assign(target.href); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}><p className="quiet">A host runs Haven and holds its accounts and communities. Enter its HTTPS address or a complete invitation link. An invite code alone is redeemed using Join a community.</p><label>HOST ADDRESS OR INVITATION LINK<input type="url" name="address" placeholder="https://haven.example.com" required autoFocus /></label>{error && <p className="form-error" role="alert">{error}</p>}</SimpleForm>}</Modal>}</div>;
}
function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div>{icon}</div><h2>{title}</h2><p>{text}</p>{action && <section>{action}</section>}</div>; }
function SimpleForm({ children, submit, onSubmit, busy }: { children: ReactNode; submit: string; onSubmit: (values: Record<string, string>) => Promise<void>; busy: boolean }) { return <form className="simple-form" onSubmit={event => { event.preventDefault(); void onSubmit(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>); }}>{children}<div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'Working…' : submit}<ArrowRight size={16} /></button></div></form>; }
function FriendPicker({ friends }: { friends: User[] }) { const [selected, setSelected] = useState<string[]>([]); return <div className="friend-picker"><input type="hidden" name="memberIds" value={selected.join(',')} />{friends.map(user => <label key={user.id}><Avatar user={user} size={28} /><span>{display(user)}</span><input type="checkbox" checked={selected.includes(user.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, user.id] : previous.filter(id => id !== user.id))} /></label>)}</div>; }

function Auth({ onLogin, notify }: { onLogin: (data: Bootstrap) => void; notify: (message: string) => void }) {
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
  const [view, setView] = useState<'login' | 'register' | 'forgot_password'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    void initSupabase().then(client => {
      setSupabaseClient(client);
    });
  }, []);

  const isHosted = Boolean(supabaseClient);

  const handleHostedSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !supabaseClient) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    const username = String(form.get('username') || '').trim();
    const displayName = String(form.get('displayName') || '').trim();

    setBusy(true); setError(''); setSuccess('');
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
        if (!username) throw new Error('Please enter a username');
        const { data, error: signUpError } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              username,
              displayName: displayName || username,
              display_name: displayName || username,
            },
          },
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
        const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (data.user && !data.user.email_confirmed_at) {
          await supabaseClient.auth.signOut().catch(() => {});
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
        setError('Cannot reach Haven server. Please verify that the backend is running.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  // Google OAuth is preserved for future use but disabled for initial launch
  const handleGoogleLogin = async () => {
    if (!supabaseClient) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const { error: oauthError } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) throw oauthError;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Google sign-in failed');
      setBusy(false);
    }
  };

  const handleLocalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.username = view === 'register' ? String(values.username).trim() : normalizeLoginUsername(String(values.username));
    setBusy(true); setError('');
    try {
      await api(`/auth/${view === 'register' ? 'register' : 'login'}`, 'POST', values);
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
      <div className="auth-art">
        <Brand />
        <div className="auth-message">
          <p className="eyebrow">YOUR PEOPLE. YOUR PLACE.</p>
          <h1>A little space.<br />A lot of<br /><em>connection.</em></h1>
          <p>For late-night conversations, shared screens,<br />and the people who get you.</p>
          <div className="auth-orbits"><i /><i /><i /><span>✳</span></div>
        </div>
        <footer>MAKE YOURSELF AT HOME. <span>EST. 2026</span></footer>
      </div>
      <div className="auth-form">
        <div>
          <p className="eyebrow">WELCOME TO HAVEN</p>
          <h2>{view === 'forgot_password' ? 'Reset password.' : view === 'register' ? 'Find your place.' : 'Welcome back.'}</h2>
          <p className="quiet">{view === 'forgot_password' ? 'We’ll email you a secure link to reset your password.' : view === 'register' ? 'Good things start with good company.' : isHosted ? 'Sign in with your verified email and password.' : 'Sign in with your username, not your display name.'}</p>


          {success && <p className="auth-success" role="status">{success}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}

          <form onSubmit={isHosted ? handleHostedSubmit : handleLocalSubmit}>
            {isHosted ? (
              <>
                {view === 'register' && (
                  <>
                    <label>DISPLAY NAME<input name="displayName" autoComplete="nickname" placeholder="What should we call you?" maxLength={50} /></label>
                    <label>USERNAME<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Unique username (3–32 chars)" required minLength={3} maxLength={32} pattern={usernameCharacters} title="3–32 letters, numbers, underscores, dots or hyphens" /></label>
                  </>
                )}
                <label>EMAIL ADDRESS<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required /></label>
                {view !== 'forgot_password' && (
                  <label>PASSWORD<input type="password" name="password" autoComplete={view === 'register' ? 'new-password' : 'current-password'} placeholder={view === 'register' ? 'At least 8 characters' : 'Your password'} required minLength={8} maxLength={128} /></label>
                )}
                {view === 'login' && (
                  <div className="auth-subactions">
                    <button type="button" className="text-link" onClick={() => { setView('forgot_password'); setError(''); setSuccess(''); }}>Forgot your password?</button>
                  </div>
                )}
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? 'One moment…' : view === 'forgot_password' ? 'Send recovery link' : view === 'register' ? 'Create your account' : 'Sign in'}
                  <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <>
                {view === 'register' && <label>DISPLAY NAME<input name="displayName" autoComplete="nickname" placeholder="What should we call you?" maxLength={50} /></label>}
                <label>USERNAME<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={view === 'register' ? 'Your unique username' : 'Username or @username'} required minLength={view === 'register' ? 3 : undefined} maxLength={view === 'register' ? 32 : 128} pattern={view === 'register' ? usernameCharacters : undefined} title={view === 'register' ? '3–32 letters, numbers, underscores, dots or hyphens' : undefined} /></label>
                <label>PASSWORD<input type="password" name="password" autoComplete={view === 'register' ? 'new-password' : 'current-password'} placeholder={view === 'register' ? 'At least 8 characters' : 'Your password'} required minLength={view === 'register' ? 8 : 1} maxLength={128} /></label>
                {view === 'register' && error === 'Username is already taken' && <button type="button" className="text-link" onClick={() => { setView('login'); setError(''); }}>Sign into this account</button>}
                <button type="submit" className="primary" disabled={busy}>{busy ? 'One moment…' : view === 'register' ? 'Create your account' : 'Sign in'}<ArrowRight size={17} /></button>
              </>
            )}
          </form>

          {view === 'forgot_password' ? (
            <p className="auth-toggle">Remembered your password? <button disabled={busy} onClick={() => { setView('login'); setError(''); setSuccess(''); }}>Back to sign in</button></p>
          ) : (
            <p className="auth-toggle">{view === 'register' ? 'Already have a place here?' : 'New around here?'} <button disabled={busy} onClick={() => { setView(view === 'register' ? 'login' : 'register'); setError(''); setSuccess(''); }}>{view === 'register' ? 'Sign in' : 'Join Haven'}</button></p>
          )}

          {!isHosted && view !== 'register' && <p className="quiet">Current Haven host: <span aria-label="Current Haven host" style={{ overflowWrap: 'anywhere' }}>{getApiBaseUrl() || window.location.origin}</span></p>}
          {!isHosted && view !== 'register' && !window.haven && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) && <p className="notice">Using a Desktop account? Open Haven Desktop → Test with another account → Copy backend URL, then open that exact address here. A separately started localhost:3001 server has a different account database.</p>}
          <div className="auth-privacy"><Shield size={16} /><span>Your conversations, on your community’s server.<br />Independent. Self-hosted. Yours.</span></div>
        </div>
      </div>
    </div>
  );
}
function MessageRow({ message, author, me, compact, replyMessage, users, canDelete, onReply, onProfile, onError }: { message: Message; author?: User; me: User; compact: boolean; replyMessage?: Message; users: Record<string, User>; canDelete: boolean; onReply: () => void; onProfile: () => void; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false); const [content, setContent] = useState(message.content); const [reactionMenu, setReactionMenu] = useState(false);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  async function react(emoji: string) { try { await api(`/messages/${message.id}/reactions`, 'POST', { emoji }); setReactionMenu(false); } catch (error) { onError((error as Error).message); } }
  return <article className={`message ${compact ? 'compact' : ''}`} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); const rectangle = event.currentTarget.getBoundingClientRect(); setMenu({ x: rectangle.left + 50, y: rectangle.top + 30 }); } }}>
    {message.replyTo && <div className="reply-context"><Reply size={13} /><span>{replyMessage ? `${display(users[replyMessage.authorId])}: ${replyMessage.content.slice(0, 140)}` : 'Reply to an earlier message'}</span></div>}
    <div className="message-avatar">{compact ? <span className="compact-time">{time(message.createdAt)}</span> : <button className="avatar-button" onClick={onProfile}><Avatar user={author} size={38} /></button>}</div><div className="message-content">{!compact && <div className="message-heading"><button onClick={onProfile}>{display(author)}</button><time dateTime={new Date(message.createdAt).toISOString()}>{time(message.createdAt)}</time></div>}{editing ? <form className="edit-message" onSubmit={async event => { event.preventDefault(); try { await api(`/messages/${message.id}`, 'PATCH', { content }); setEditing(false); } catch (error) { onError((error as Error).message); } }}><textarea aria-label="Edit message" value={content} onChange={event => setContent(event.target.value)} autoFocus maxLength={4000} /><span><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="text-link" type="submit">Save changes</button></span></form> : <p className="message-text"><EmojiText text={message.content} />{message.editedAt && <small className="edited"> (edited)</small>}</p>}
    {message.attachments.map(file => <a key={file.id} className="attachment" href={resolveApiUrl(file.url)} target="_blank" rel="noreferrer" download={file.name}><File size={22} /><span>{file.name}<small>{(file.size / 1024).toFixed(1)} KB · Download attachment</small></span><ArrowDown size={16} /></a>)}
    {!!message.reactions.length && <div className="reactions">{message.reactions.map(reaction => <button className={reaction.userIds.includes(me.id) ? 'own' : ''} key={reaction.emoji} onClick={() => void react(reaction.emoji)}><Emoji value={reaction.emoji} /><span>{reaction.userIds.length}</span></button>)}</div>}</div>
    <div className="message-actions"><button title="Add reaction" aria-label="Add reaction" onClick={() => setReactionMenu(!reactionMenu)}><Smile size={16} /></button><button title="Reply" aria-label="Reply" onClick={onReply}><Reply size={16} /></button>{message.authorId === me.id && <button title="Edit message" aria-label="Edit message" onClick={() => { setContent(message.content); setEditing(true); }}><Pencil size={15} /></button>}{canDelete && <button title="Delete message" aria-label="Delete message" onClick={() => { if (confirm('Delete this message?')) void api(`/messages/${message.id}`, 'DELETE').catch(error => onError(error.message)); }}><Trash2 size={15} /></button>}</div>{reactionMenu && <div className="emoji-menu"><EmojiPicker onSelect={emoji => void react(emoji)} /></div>}
    {menu && <ContextMenu position={menu} label="Message actions" onClose={() => setMenu(null)}>
      <MenuItem onClick={() => { setMenu(null); onReply(); }}>Reply</MenuItem>
      <MenuItem onClick={() => { setMenu(null); onProfile(); }}>View author profile</MenuItem>
      <MenuItem onClick={() => { setMenu(null); void copyWithFeedback(message.content, 'Message text', undefined, undefined, onError); }}>Copy message text</MenuItem>
      {message.authorId === me.id && <MenuItem onClick={() => { setMenu(null); setContent(message.content); setEditing(true); }}>Edit message</MenuItem>}
      {canDelete && <MenuItem danger onClick={() => { setMenu(null); if (confirm('Delete this message?')) void api(`/messages/${message.id}`, 'DELETE').catch(error => onError(error.message)); }}>Delete message</MenuItem>}
    </ContextMenu>}
  </article>;
}

function Composer({ selection, name, reply, socket, connected, onSent, onError }: { selection: NonNullable<Selection>; name: string; reply: Message | null; socket: Socket | null; connected: boolean; onSent: (message: Message) => void; onError: (message: string) => void }) {
  const [text, setText] = useState(''); const [attachments, setAttachments] = useState<Attachment[]>([]); const [busy, setBusy] = useState(false); const [emojiOpen, setEmojiOpen] = useState(false); const fileInput = useRef<HTMLInputElement>(null); const lastTyping = useRef(0);
  useEffect(() => { setText(''); setAttachments([]); }, [JSON.stringify(selection)]);
  async function send(event?: FormEvent) { event?.preventDefault(); if (busy || !connected || (!text.trim() && !attachments.length)) return; setBusy(true); try { const result = await api<{ message: Message }>('/messages', 'POST', { ...selection, content: text.trim(), replyTo: reply?.id, attachmentIds: attachments.map(item => item.id) }); setText(''); setAttachments([]); onSent(result.message); } catch (error) { onError((error as Error).message); } finally { setBusy(false); } }
  return <form className="composer-wrap" onSubmit={event => void send(event)}>{attachments.length > 0 && <div className="pending-files">{attachments.map(item => <span key={item.id}><File size={14} />{item.name}<button type="button" title="Remove attachment" onClick={() => setAttachments(previous => previous.filter(file => file.id !== item.id))}><X size={13} /></button></span>)}</div>}<div className="composer"><input ref={fileInput} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 25 * 1024 * 1024) { onError('Files must be 25 MB or smaller'); return; } setBusy(true); const form = new FormData(); Object.entries(selection).forEach(([key, value]) => form.append(key, value)); form.append('file', file); void api<{ attachment: Attachment }>('/attachments', 'POST', form).then(result => setAttachments(previous => [...previous, result.attachment])).catch(error => onError(error.message)).finally(() => { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }); }} /><button type="button" className="attach-button" title="Attach a file" aria-label="Attach a file" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={19} /></button><textarea placeholder={`Message ${'channelId' in selection ? '#' : ''}${name}`} aria-label="Message" value={text} maxLength={4000} rows={1} disabled={busy} onChange={event => { setText(event.target.value); if (Date.now() - lastTyping.current > 1500) { socket?.emit('typing', selection); lastTyping.current = Date.now(); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button className="icon-button" type="button" title="Emoji" aria-label="Emoji" onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={21} /></button><button type="submit" className="send-button" title="Send message" aria-label="Send message" disabled={busy || !connected || (!text.trim() && !attachments.length)}><Send size={18} /></button></div>{emojiOpen && <div className="composer-emojis"><EmojiPicker onSelect={emoji => { setText(previous => previous + emoji); setEmojiOpen(false); }} /></div>}</form>;
}

function SettingsForm({ me, media, busy, preferences, onPreferences, onSave, onLogout, initialTab = 'profile' }: { me: User; media: ReturnType<typeof useMedia>; busy: boolean; preferences: Preferences; onPreferences: (patch: Partial<Preferences>) => void; onSave: (values: unknown) => Promise<void>; onLogout: () => void; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab);
  const [notification, setNotification] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const [notificationError, setNotificationError] = useState('');
  return <div className="settings-layout">
    <nav>{['profile', 'voice & video', 'desktop & gaming', 'notifications', 'connection & testing'].map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); if (item === 'voice & video') void media.enumerateDevices(); }}>{item}</button>)}<button className="danger-text" onClick={onLogout}><LogOut size={15} /> Sign out</button></nav>
    <section>{tab === 'profile' ? <SimpleForm busy={busy} submit="Save profile" onSubmit={onSave}><div className="profile-settings-avatar"><Avatar user={me} size={60} /><span>@{me.username}<small>Your profile, your personality.</small></span></div><label>DISPLAY NAME<input name="displayName" defaultValue={me.displayName} maxLength={50} required /></label><label>AVATAR <small>Emoji or HTTPS image URL</small><input name="avatar" defaultValue={me.avatar} maxLength={500} /></label><label>ABOUT YOU<textarea name="bio" defaultValue={me.bio} maxLength={300} placeholder="A little about yourself…" /></label><label>PRESENCE<select name="status" defaultValue={me.status}><option value="online">Online</option><option value="idle">Away</option><option value="dnd">Do not disturb</option><option value="offline">Invisible</option></select></label></SimpleForm> : tab === 'voice & video' ? <div className="audio-settings">
      <p className="quiet">Changes are saved immediately and apply to your active voice room. Use Detect audio devices to grant microphone permission and reveal device names.</p>
      <label>INPUT DEVICE<select aria-label="Input device" value={media.settings.inputDevice} onChange={event => media.setSettings({ inputDevice: event.target.value })}><option value="">System default</option>{media.devices.filter(device => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1} — permission needed`}</option>)}</select></label>
      <label>OUTPUT DEVICE<select value={media.settings.outputDevice} onChange={event => media.setSettings({ outputDevice: event.target.value })}><option value="">System default</option>{media.devices.filter(device => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${index + 1} — permission needed`}</option>)}</select></label>
      {(['noiseSuppression', 'echoCancellation', 'pushToTalk'] as const).map((key, index) => <label className="toggle-label" key={key}><span>{['Noise suppression', 'Echo cancellation', 'Push to talk'][index]}<small>{['Reduce background noise locally before sending your microphone', 'Keep speaker audio out of your microphone', 'Configure the shortcut under desktop & gaming'][index]}</small></span><input type="checkbox" checked={media.settings[key]} onChange={event => media.setSettings({ [key]: event.target.checked })} /></label>)}
      <label>NOISE SUPPRESSION MODE<select aria-label="Noise suppression mode" disabled={!media.settings.noiseSuppression} value={media.settings.noiseSuppressionMode} onChange={event => media.setSettings({ noiseSuppressionMode: event.target.value as 'standard' | 'enhanced' })}><option value="standard">Standard · browser processing</option><option value="enhanced">Enhanced · RNNoise</option></select></label>
      <label>VOICE BITRATE<select aria-label="Voice bitrate" value={media.settings.voiceBitrateKbps} onChange={event => media.setSettings({ voiceBitrateKbps: Number(event.target.value) })}>{[24, 32, 48, 64].map(value => <option key={value} value={value}>{value} kbps{value === 48 ? ' · balanced' : ''}</option>)}</select></label>
      <p className="quiet">Voice bitrate is a maximum per participant. Gaming Mode keeps your choice; sustained packet loss can temporarily reduce it.</p>
      <p className="quiet">Standard uses your browser’s built-in suppression with minimal overhead. Enhanced adds local speech denoising for noisy rooms and uses more CPU. Compare both with Mic Test; keep Standard if speech sounds more natural. Automatic gain amplification is disabled.</p>
      <p className="quiet" role="status">{media.micTest.status === 'running' || media.micTest.status === 'starting' ? 'Mic test' : media.voiceChannelId ? 'Outgoing microphone' : 'Suppression'}: {(!media.voiceChannelId && media.micTest.status !== 'running' && media.micTest.status !== 'starting') ? 'applied when you join voice or start Mic Test' : ({ off: 'off', native: 'browser suppression active', unverified: 'browser suppression requested; confirmation unavailable', unavailable: 'browser reports suppression unavailable', starting: 'loading enhanced denoising…', rnnoise: 'RNNoise active · on device', fallback: 'enhanced unavailable; using browser suppression where supported' })[media.micTest.status === 'running' || media.micTest.status === 'starting' ? media.testProcessing : media.microphoneProcessing]}</p>
      <MicrophoneTest media={media} />
      <button className="secondary" onClick={() => void media.refreshDevices()}>Detect audio devices</button>
      {media.deviceError && <p className="error" role="alert">{media.deviceError}</p>}
      <p className="quiet">Devices refresh automatically when connected or removed. An unavailable device falls back to the system default. Output selection depends on browser support.</p>
    </div> : tab === 'desktop & gaming' ? <DesktopSettings media={media} preferences={preferences} onPreferences={onPreferences} /> : tab === 'connection & testing' ? <section className="connection-settings">
      <h3>One host, independent accounts</h3><p className="quiet">Keep this account signed in while opening another client on the same Haven host.</p><ClientTools /><p className="quiet">An invitation joins a community on this host. To change hosts, sign out and choose Connect to a Haven host.</p>
    </section> : <div className="notification-settings">
      <Bell size={32} /><h3>Stay in the loop.</h3>
      <label className="toggle-label"><span>Desktop notifications<small>Notify about new messages outside this conversation while Haven is in the background. Do not disturb silences them.</small></span><input aria-label="Desktop notifications" type="checkbox" checked={preferences.notifications} onChange={event => onPreferences({ notifications: event.target.checked })} /></label>
      <p>Permission: <b>{notification}</b></p>
      <button className="primary" disabled={typeof Notification === 'undefined' || notification === 'granted'} onClick={() => { setNotificationError(''); void Notification.requestPermission().then(setNotification).catch(() => setNotificationError('Notification permission could not be requested. Check Windows and browser permissions.')); }}>Enable notifications</button>
      {notification === 'denied' && <p className="quiet">Allow notifications in Windows or your browser site settings, then reopen this panel.</p>}
      {notificationError && <p className="error" role="alert">{notificationError}</p>}
    </div>}</section>
  </div>;
}

function ShareControls({ media }: { media: ReturnType<typeof useMedia> }) {
  const [height, setHeight] = useState<number | 'native'>(media.settings.shareHeight); const [fps, setFps] = useState<15 | 30 | 60>(media.settings.shareFps); const [bitrate, setBitrate] = useState(media.settings.shareBitrateMbps); const [busy, setBusy] = useState(false);
  useEffect(() => () => media.setVideoDetailsOpen(false), [media.setVideoDetailsOpen]);
  useEffect(() => { setHeight(media.settings.shareHeight); setFps(media.settings.shareFps); setBitrate(media.settings.shareBitrateMbps); }, [media.settings.shareHeight, media.settings.shareFps, media.settings.shareBitrateMbps]);
  return <div className="share-settings">
    <p className="quiet">Choose a window or display using the capture picker. Resolution options follow its actual source size. Native is always the maximum.</p>
    {media.settings.gamingMode && <p className="notice">Gaming Mode temporarily caps sharing at 720p, 30 fps and 3 Mbps per viewer. Your selections below are saved and restored when it is turned off, including changes you make now.</p>}
    {!media.sharing ? <button className="primary" disabled={!media.voiceChannelId} onClick={() => void media.startShare()}><MonitorUp size={18} />Choose a screen to share</button> : <>
      <div className="source-resolution"><MonitorUp size={23} /><span>Captured source<b>{media.quality.nativeWidth} × {media.quality.nativeHeight}</b></span><span className="live-tag">LIVE</span></div>
      <label>RESOLUTION<select aria-label="RESOLUTION" value={height} onChange={event => setHeight(event.target.value === 'native' ? 'native' : +event.target.value)}>{!media.shareOptions.some(option => option.height === height) && <option value={height}>Saved {height === 'native' ? 'native' : `${height}p`} · limited by current source</option>}{media.shareOptions.map(option => <option key={option.height} value={option.height}>{option.label}</option>)}</select></label>
      <p className="quiet">Current output target: {media.quality.width} × {media.quality.height}, {media.quality.fps} fps, up to {media.quality.bitrateMbps} Mbps per viewer.</p>
      <label>FRAME RATE<select aria-label="FRAME RATE" value={fps} onChange={event => setFps(+event.target.value as 15 | 30 | 60)}><option value="60">60 fps · smooth motion</option><option value="30">30 fps · balanced</option><option value="15">15 fps · save bandwidth</option></select></label>
      <label>BITRATE BUDGET · {bitrate} Mbps<input type="range" min="1" max="50" step="1" value={bitrate} onChange={event => setBitrate(+event.target.value)} /></label>
      <p className="quiet fine-print">Budget is per viewer. WebRTC adapts to congestion; achieved quality depends on your hardware and connection.</p>
      <div className="form-actions"><button className="secondary danger" onClick={media.stopShare}>Stop sharing</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { await media.setShareQuality(height, fps, bitrate); } finally { setBusy(false); } }}>{busy ? 'Applying…' : 'Apply quality'}</button></div>
    </>}
    <StreamStatistics quality={media.quality} onToggle={media.setVideoDetailsOpen} />
  </div>;
}
