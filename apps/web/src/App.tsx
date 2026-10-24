import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowDown, ArrowLeft, Download, FileText, ArrowRight, Bell, Check, CheckCheck, ChevronDown, ChevronRight, Copy, File, Hash, Headphones, HeadphoneOff, Home, LogIn, LogOut, Menu, MessageCircle, Mic, MicOff, MonitorUp, MoreHorizontal, Plus, Search, Send, Settings, Shield, Smile, Trash2, User as UserIcon, UserPlus, Users, Volume2, X, PhoneOff, SlidersHorizontal, Music2, Pencil, Reply, Link, Wifi, WifiOff } from 'lucide-react';
import type { Attachment, Bootstrap, Channel, Conversation, Message, Server, Sound, User, VoicePeer } from '@haven/shared/types';
import { getChannelVoiceParticipants } from './voice-roster';
import { api, getApiBaseUrl, resolveApiUrl, downloadAttachment } from './api';
import { BackendUnavailableError } from './json-response';
import { initSupabase, getSupabase, getAccessToken, onSupabaseAuthStateChange } from './supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLoginUsername, usernameCharacters } from '@haven/shared/auth';
import { Avatar, Modal, Video } from './components';
import { Auth } from './Auth';
import { PasswordRecoveryModal } from './PasswordRecoveryModal';
import { ProfileOnboarding } from './ProfileOnboarding';
import { useMedia } from './media';
import StreamStatistics from './StreamStatistics';
import VoicePanel from './VoicePanel';
import ConversationOptions from './ConversationOptions';
import QuickSwitcher from './QuickSwitcher';
import VoiceConnection from './VoiceConnection';
import StreamViewer from './StreamViewer';
import { MicrophoneTest } from './MicrophoneTest';
import { CommunityJoin, InviteCreate, InviteRedeem } from './Invitations';
import { ChannelModal } from './ChannelModal';
import { inviteCodeFromPath } from './invite-links';
import { AddFriend, FriendsPage, ProfileActions } from './Friends';
import { AddFriendModal } from './AddFriendModal';
import { GroupModal } from './GroupModal';
import { SoundboardModal } from './SoundboardModal';
import { ShareQualityModal } from './ShareQualityModal';
import { CreateServerModal } from './CreateServerModal';
import { JoinServerModal } from './JoinServerModal';
import './zenith-social-modals.css';
import './zenith-server-onboarding.css';
import { Emoji, EmojiText, EmojiPicker, EmojiMotionProvider } from './emoji';
import { usePreferences, type Preferences } from './preferences';
import { DesktopSettings } from './desktop-settings';
import { SettingsDialog } from './settings/SettingsDialog';
import ProfileCard, { ImageViewer } from './ProfileCard';
import ServerSettings, { ServerIcon, type CommunityMember } from './ServerSettings';
import UserContextMenu from './UserContextMenu';
import { ContextMenu, MenuItem, type MenuPosition } from './ContextMenu';
import { ConfirmDialog } from './ZenithDialog';
import { profileImageSource } from './profile-images';
import { bootstrapUpdates, mergeBootstrapUpdates } from './bootstrap-updates';
import { copyWithFeedback } from './clipboard';
import './community.css';
import './chat-shell.css';

type AppContextTarget = MenuPosition & ({ kind: 'user'; userId: string; serverId?: string } | { kind: 'server'; serverId: string } | { kind: 'channel'; channelId: string });
type Selection = { channelId: string } | { conversationId: string } | null;
type Dialog = 'create-server' | 'join-server' | 'channel' | 'invite' | 'settings' | 'server-settings' | 'add-friend' | 'group' | 'soundboard' | 'share' | null;
const display = (user?: { displayName?: string; username?: string }) => user?.displayName || user?.username || 'Unknown user';
const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayLabel = (timestamp: number) => {
  const date = new Date(timestamp); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const monthDay = date.toLocaleDateString([], { month: 'long', day: 'numeric' });
  if (date.toDateString() === today.toDateString()) return `Today · ${monthDay}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${monthDay}`;
  return date.getFullYear() === today.getFullYear() ? date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
};
const statusLabel = (status?: string) => ({ online: 'Online', idle: 'Away', dnd: 'Do not disturb' } as Record<string, string>)[status || ''] || 'Offline';
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

// The server decides, once, whether an account still has to choose a username, display name and picture.
// Accounts without the flag (self-hosted accounts and every account created before onboarding existed) are complete.
const needsProfileSetup = (user?: User | null) => user?.settings?.profileCompleted === false;

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [pendingOnboardingBoot, setPendingOnboardingBoot] = useState<Bootstrap | null>(null);
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
  // The member list starts open only where the wide layout leaves room for it; the header toggle still works everywhere.
  const [showMembers, setShowMembers] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1600px)').matches);
  const [mobileNav, setMobileNav] = useState(false);
  const [friendTab, setFriendTab] = useState('all');
  const [voiceViewChannelId, setVoiceViewChannelId] = useState<string | null>(null);
  const [expandedStreamId, setExpandedStreamId] = useState<string | null>(null);
  const [initialFullscreen, setInitialFullscreen] = useState(false);
  const [dismissedStreams, setDismissedStreams] = useState<Set<string>>(new Set());
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => inviteCodeFromPath(window.location.pathname));
  const [authInviteOpen, setAuthInviteOpen] = useState(() => Boolean(inviteCodeFromPath(window.location.pathname)));
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [reply, setReply] = useState<Message | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const memberRequestVersion = useRef(0);
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [profile, setProfile] = useState<User | null>(null);
  const [contextTarget, setContextTarget] = useState<AppContextTarget | null>(null);
  const [pictureUser, setPictureUser] = useState<User | null>(null);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection);
  const bootRef = useRef(boot);
  const requestVersion = useRef(0);
  const deletedMessageIds = useRef(new Set<string>());
  const bootstrapRequest = useRef<{ userId: string; updates: ReturnType<typeof bootstrapUpdates> } | null>(null);
  const authRevision = useRef(0);
  selectionRef.current = selection;
  bootRef.current = boot;
  const notify = useCallback((message: string) => setToast(message), []);
  const media = useMedia(socket, boot?.user.id || '', notify, boot?.user);
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
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let sessionRetry: ReturnType<typeof setTimeout> | undefined;
    const loadSession = () => {
      clearTimeout(sessionRetry);
      const revision = authRevision.current;
      return api<Bootstrap>('/bootstrap').then(data => {
        if (active && revision === authRevision.current) {
          if (needsProfileSetup(data.user)) {
            setPendingOnboardingBoot(data);
          } else {
            setPendingOnboardingBoot(null);
            setBoot(data);
          }
        }
      }).catch(error => {
        if (active && revision === authRevision.current && (error instanceof BackendUnavailableError || error instanceof TypeError)) {
          sessionRetry = setTimeout(() => { if (active && revision === authRevision.current) void loadSession(); }, 2000);
        }
      });
    };
    void loadSession().finally(() => { if (active) setLoading(false); });
    const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
    const search = typeof window !== 'undefined' ? window.location.search || '' : '';
    if (hash.includes('type=recovery') || search.includes('type=recovery')) {
      setRecoveryOpen(true);
    }
    let authRetry: ReturnType<typeof setTimeout> | undefined;
    const connectAuth = () => { void initSupabase().then(client => {
      if (!active || !client) return;
      void onSupabaseAuthStateChange((event, session) => {
        if (!active) return;
        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryOpen(true);
          return;
        }
        if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          if (session.user?.email && !session.user.email_confirmed_at) {
            client.auth.signOut({ scope: 'local' }).catch(() => { });
            return;
          }
          void loadSession();
        } else if (event === 'SIGNED_OUT') {
          authRevision.current++;
          media.leave();
          setPendingOnboardingBoot(null);
          setBoot(null);
          setSelection(null);
          setDialog(null);
        }
      }).then(subscription => {
        if (active) unsubscribe = subscription.unsubscribe;
        else subscription.unsubscribe();
      });
    }).catch(() => { if (active) authRetry = setTimeout(connectAuth, 2000); }); };
    connectAuth();
    return () => { active = false; clearTimeout(authRetry); clearTimeout(sessionRetry); unsubscribe?.(); };
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
    let stopTokenRefresh: (() => void) | undefined;
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
      connection.on('invites:changed', detail => window.dispatchEvent(new CustomEvent('haven:invites-changed', { detail })));
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
      connection.on('voice:peer-joined', (peer: VoicePeer) => {
        setBoot(previous => {
          if (!previous) return previous;
          const remaining = previous.voice.filter(p => p.socketId !== peer.socketId && p.user.id !== peer.user.id);
          return { ...previous, voice: [...remaining, peer] };
        });
      });
      connection.on('voice:peer-left', ({ socketId }: { socketId: string }) => {
        setBoot(previous => {
          if (!previous) return previous;
          return { ...previous, voice: previous.voice.filter(p => p.socketId !== socketId) };
        });
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
      // Hosted sign-in: hand the server each refreshed access token so long calls outlive token rotation.
      const tokenRefresh = await onSupabaseAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' && session?.access_token && connection.connected) connection.emit('auth:refresh', { token: session.access_token });
      }).catch(() => null);
      if (cancelled) tokenRefresh?.unsubscribe(); else stopTokenRefresh = tokenRefresh?.unsubscribe;
    })();
    return () => {
      cancelled = true;
      stopTokenRefresh?.();
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
    const version = ++memberRequestVersion.current;
    if (!serverId || !boot?.servers.some(item => item.id === serverId)) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    setMembers([]);
    setMembersLoading(true);
    void api<{ members: typeof members }>(`/servers/${serverId}/members`)
      .then(result => {
        if (version === memberRequestVersion.current) {
          setMembers(result.members);
        }
      })
      .catch(error => {
        if (version === memberRequestVersion.current) {
          setMembers([]);
          notify(error.message);
        }
      })
      .finally(() => {
        if (version === memberRequestVersion.current) {
          setMembersLoading(false);
        }
      });
  }, [serverId, boot?.users, boot?.servers]);
  useEffect(() => { if (dialog === 'soundboard' && soundServerId) void api<{ sounds: Sound[] }>(`/servers/${soundServerId}/sounds`).then(result => setSounds(result.sounds)).catch(error => notify(error.message)); }, [dialog, soundServerId]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); setQuickOpen(true); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  useEffect(() => { if (!mobileNav) return; const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setMobileNav(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [mobileNav]);

  useEffect(() => {
    if (!media.voiceChannelId && media.connectionStatus === 'disconnected') {
      setVoiceViewChannelId(null);
      setExpandedStreamId(null);
    }
  }, [media.voiceChannelId, media.connectionStatus]);
  useEffect(() => {
    if (expandedStreamId === 'self' && !media.screenStream) setExpandedStreamId(null);
    else if (expandedStreamId && expandedStreamId !== 'self' && !media.peers.some(peer => peer.socketId === expandedStreamId && peer.state.sharing)) {
      setExpandedStreamId(null);
    }
  }, [expandedStreamId, media.screenStream, media.peers]);
  useEffect(() => { setVoiceViewChannelId(null); setExpandedStreamId(null); }, [scope, serverId]);

  const onWatch = useCallback((id: string) => {
    if (id !== 'self') {
      if (media.isWatchingStream(id)) return;
      media.watchStream(id);
      setDismissedStreams(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    if (media.voiceChannelId) {
      setVoiceViewChannelId(media.voiceChannelId);
    }
  }, [media]);

  const onStopWatching = useCallback((id: string) => {
    if (id !== 'self') {
      media.stopWatchingStream(id);
    }
    setExpandedStreamId(prev => (prev === id ? null : prev));
  }, [media]);

  const onDismissStream = useCallback((id: string) => {
    setDismissedStreams(prev => new Set(prev).add(id));
    setExpandedStreamId(prev => (prev === id ? null : prev));
    if (id !== 'self') {
      media.stopWatchingStream(id);
    }
  }, [media]);

  const onExpand = useCallback((id: string) => {
    if (id !== 'self' && !media.isWatchingStream(id)) {
      media.watchStream(id);
    }
    setInitialFullscreen(false);
    setExpandedStreamId(id);
  }, [media]);

  const onFullscreen = useCallback((id: string) => {
    if (id !== 'self' && !media.isWatchingStream(id)) {
      media.watchStream(id);
    }
    setInitialFullscreen(true);
    setExpandedStreamId(id);
  }, [media]);

  useEffect(() => {
    setDismissedStreams(prev => {
      if (!prev.size) return prev;
      const activeIds = new Set(media.peers.filter(p => p.state.sharing).map(p => p.socketId));
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => {
        if (activeIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [media.peers]);
  async function finishJoining(id: string) {
    const data = await refresh(); if (!data) return;
    const first = data.channels.find(item => item.serverId === id && item.type === 'text');
    setServerId(id); setSelection(first ? { channelId: first.id } : null); setPendingInvite(null); setDialog(null); setQuery(''); setMobileNav(false); history.replaceState({}, '', '/'); notify('Community joined');
  }
  function savePendingInvite(code: string) { setPendingInvite(code); setAuthInviteOpen(false); history.replaceState({}, '', `/invite/${code}`); }
  function chooseServer(id: string | null) {
    setVoiceViewChannelId(null); setExpandedStreamId(null);
    setServerId(id); localStorage.setItem('haven.server', id || ''); setQuery(''); setMobileNav(false);
    const first = boot?.channels.filter(item => item.serverId === id && item.type === 'text').sort((left, right) => left.position - right.position)[0];
    setSelection(first ? { channelId: first.id } : null);
  }
  useEffect(() => { if (boot && serverId && !selection) { const first = boot.channels.find(item => item.serverId === serverId && item.type === 'text'); if (first) setSelection({ channelId: first.id }); } }, [boot?.servers.length]);
  async function action(operation: () => Promise<void>) { setBusy(true); setFormError(''); try { await operation(); } catch (error) { setFormError((error as Error).message); notify((error as Error).message); } finally { setBusy(false); } }
  const showDialog = (next: Dialog) => { setDialog(next); setFormError(''); };
  const showSettings = (tab = 'profile') => { setSettingsTab(tab); showDialog('settings'); };
  async function startDM(userId: string) { await action(async () => { const result = await api<{ conversation: Conversation }>('/conversations', 'POST', { memberIds: [userId] }); await refresh(); setVoiceViewChannelId(null); setServerId(null); setSelection({ conversationId: result.conversation.id }); setProfile(null); }); }
  async function older() { if (!messages.length) return; const result = await api<{ messages: Message[]; hasMore: boolean }>(`/messages?${scope}&before=${messages[0].createdAt}&beforeId=${encodeURIComponent(messages[0].id)}${query ? `&q=${encodeURIComponent(query)}` : ''}`); const height = timeline.current?.scrollHeight || 0; setMessages(previous => [...result.messages, ...previous]); setHasMore(result.hasMore); requestAnimationFrame(() => { if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight - height; }); }

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

  const recoveryDialog = recoveryOpen && <PasswordRecoveryModal
    onClose={() => setRecoveryOpen(false)}
    onSuccess={data => {
      if (needsProfileSetup(data.user)) {
        setPendingOnboardingBoot(data);
      } else {
        setPendingOnboardingBoot(null);
        setBoot(data);
        setSelection(null);
      }
    }}
    notify={notify}
  />;

  if (loading) {
    return (
      <div className="loading zenith-app-loading" role="status" aria-label="Loading Haven">
        <img className="zenith-loading-logo" src="/haven-wordmark.webp" srcSet="/haven-wordmark.webp 1x, /haven-wordmark@2x.webp 2x, /haven-wordmark@3x.webp 3x" alt="" width={252} height={84} draggable={false} />
        <div className="zenith-loading-text-wrap">
          <span className="zenith-loading-ping-dot" aria-hidden="true" />
          <span>Finding your place…</span>
        </div>
      </div>
    );
  }
  if (pendingOnboardingBoot) {
    return <>
      <ProfileOnboarding
        user={pendingOnboardingBoot.user}
        onComplete={async () => {
          // Re-read the account from the server so what we show is exactly what was persisted.
          const fresh = await api<Bootstrap>('/bootstrap');
          setPendingOnboardingBoot(null);
          setBoot(fresh);
          setSelection(null);
          notify('Profile complete — welcome to Haven.');
        }}
        onSignOut={async () => {
          authRevision.current++;
          await api('/auth/logout', 'POST', { scope: 'local' }).catch(() => { });
          const sb = getSupabase();
          if (sb) await sb.auth.signOut({ scope: 'local' }).catch(() => { });
          if (window.haven?.clearAuthSession) await window.haven.clearAuthSession().catch(() => { });
          setPendingOnboardingBoot(null);
          setBoot(null);
        }}
      />
      {recoveryDialog}
    </>;
  }
  if (!boot) return <>
    <Auth
      onLogin={data => {
        if (needsProfileSetup(data.user)) {
          setPendingOnboardingBoot(data);
        } else {
          setBoot(data);
          setSelection(null);
        }
      }}
      notify={notify}
      pendingInvite={pendingInvite}
      onOpenInvite={() => setAuthInviteOpen(true)}
      communityEntry={<CommunityInvitationEntry onPending={savePendingInvite} />}
    />
    {pendingInvite && !authInviteOpen && <div className="pending-invite-note">Invitation saved. Sign in or create an account to continue.</div>}
    {pendingInvite && authInviteOpen && <Modal title="Community invitation" onClose={() => setAuthInviteOpen(false)}><InviteRedeem code={pendingInvite} authenticated={false} onJoined={() => { }} onAuthenticate={() => setAuthInviteOpen(false)} /></Modal>}
    {recoveryDialog}
  </>;
  const me = boot.user;
  const serverChannels = boot.channels.filter(item => item.serverId === serverId).sort((left, right) => left.position - right.position);
  const activeTyping = Object.keys(typing).map(id => display(users[id]));
  const currentVoice = boot.channels.find(item => item.id === media.voiceChannelId);
  // The member list belongs to a conversation or voice room; the Friends directory has no use for it.
  const memberListAvailable = Boolean(selection || voiceViewChannelId);
  const expandedPeer = media.peers.find(peer => peer.socketId === expandedStreamId && peer.state.sharing);
  const expandedStream = expandedStreamId === 'self' ? media.screenStream : expandedPeer?.stream?.getVideoTracks().length ? expandedPeer.stream : null;
  const expandedName = expandedStreamId === 'self' ? 'Your screen' : expandedPeer?.user.displayName || expandedPeer?.user.username || 'Participant';

  const profileUser = profile ? canonicalUser(profile.id) || profile : null;
  const picture = pictureUser ? canonicalUser(pictureUser.id) || pictureUser : null;
  const pictureSource = profileImageSource(picture?.avatar);
  const contextUser = contextTarget?.kind === 'user' ? canonicalUser(contextTarget.userId) : undefined;
  const contextServer = contextTarget && 'serverId' in contextTarget ? boot.servers.find(item => item.id === contextTarget.serverId) : undefined;
  const contextChannel = contextTarget?.kind === 'channel' ? boot.channels.find(item => item.id === contextTarget.channelId) : undefined;
  return <EmojiMotionProvider customEmojis={boot.serverEmojis || []} serverId={channel?.serverId} enabled={preferences.animateEmoji} gamingMode={media.settings.gamingMode} background={media.background}><div className={`app ${mobileNav ? 'nav-open' : ''}`}>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="shell-navigation">
      <nav className="server-rail" aria-label="Servers">
        <button className={`server-icon haven-icon ${!serverId ? 'selected' : ''}`} aria-label="Home" title="Home" onClick={() => chooseServer(null)}><Brand compact /></button>
        <div className="rail-divider" />
        {boot.servers.map(item => <button key={item.id} className={`server-icon ${serverId === item.id ? 'selected' : ''}`} title={item.name} aria-label={item.name} {...contextProps({ kind: 'server', serverId: item.id })} onClick={() => chooseServer(item.id)}><ServerIcon server={item} />{boot.channels.some(channelItem => channelItem.serverId === item.id && unread[channelItem.id]) && <span className="unread-dot" />}</button>)}
        <button className="server-icon add-server" aria-label="Create a server" title="Create a server" onClick={() => showDialog('create-server')}><Plus /></button>
        <button className="server-icon join-server" aria-label="Join a server" title="Join a community with an invite" onClick={() => showDialog('join-server')}><Link size={22} /></button>
      </nav>
      <aside className="channel-sidebar">
        <header className="sidebar-header"><span className="server-name" title={server?.description || server?.name}>{server?.name || 'Your space'}</span>{server && <button className="icon-button" title="Invite people" aria-label="Invite people" onClick={() => showDialog('invite')}><UserPlus size={17} /></button>}<button className="icon-button" title={server ? 'Server options' : 'Create group message'} aria-label={server ? 'Server options' : 'Create group message'} onClick={() => showDialog(server ? 'server-settings' : 'group')}>{server ? <ChevronDown size={19} /> : <Pencil size={17} />}</button></header>
        <div className="sidebar-scroll">
          {server ? <>
            <div className="channel-section"><div className="section-label"><span>TEXT CHANNELS</span>{canManage && <button title="Create channel" aria-label="Create channel" onClick={() => { setNewChannelType('text'); setEditChannel(null); showDialog('channel'); }}><Plus size={16} /></button>}</div>
              {serverChannels.filter(item => item.type === 'text').map(item => <div className={`channel-row ${channel?.id === item.id ? 'active' : ''} ${unread[item.id] > 0 ? 'unread' : ''}`} key={item.id}><button {...contextProps({ kind: 'channel', channelId: item.id })} onClick={() => { setVoiceViewChannelId(null); setSelection({ channelId: item.id }); setQuery(''); setMobileNav(false); }}><Hash size={18} /><span>{item.name}</span>{unread[item.id] > 0 && <b className="badge" aria-label={`${unread[item.id]} unread`}>{unread[item.id] > 99 ? '99+' : unread[item.id]}</b>}</button>{canManage && <button className="channel-edit" title={`Edit ${item.name}`} onClick={() => { setEditChannel(item); showDialog('channel'); }}><Settings size={13} /></button>}</div>)}
            </div>
            <div className="channel-section"><div className="section-label"><span>VOICE CHANNELS</span>{canManage && <button title="Create voice channel" aria-label="Create voice channel" onClick={() => { setNewChannelType('voice'); setEditChannel(null); showDialog('channel'); }}><Plus size={16} /></button>}</div>
              {serverChannels.filter(item => item.type === 'voice').map(item => {
                const participants = getChannelVoiceParticipants({
                  channelId: item.id,
                  me,
                  activeVoiceChannelId: media.voiceChannelId,
                  connectionStatus: media.connectionStatus,
                  mediaPeers: media.peers,
                  mediaSpeaking: media.speaking,
                  mediaMuted: media.muted,
                  mediaDeafened: media.deafened,
                  mediaSharing: media.sharing,
                  bootVoice: boot.voice,
                  canonicalUser,
                  localSocketId: socket?.id,
                });
                return (
                  <div key={item.id}>
                    <div className={`channel-row ${media.voiceChannelId === item.id ? 'voice-active' : ''}`}>
                      <button {...contextProps({ kind: 'channel', channelId: item.id })} onClick={async () => { if (media.voiceChannelId !== item.id) await media.join(item.id); setVoiceViewChannelId(item.id); setMobileNav(false); }}>
                        <Volume2 size={18} />
                        <span>{item.name}</span>
                        {media.voiceChannelId === item.id && <small className={`voice-state ${media.connectionStatus}`}>{media.connectionStatus === 'reconnecting' ? 'Reconnecting' : media.connectionStatus === 'connecting' ? 'Joining' : 'Connected'}</small>}
                      </button>
                      {canManage && <button className="channel-edit" title={`Edit ${item.name}`} onClick={() => { setEditChannel(item); showDialog('channel'); }}><Settings size={13} /></button>}
                    </div>
                    <div className="voice-roster">
                      {participants.map(peer => (
                        <button
                          {...contextProps({ kind: 'user', userId: peer.userId, serverId: item.serverId })}
                          className={peer.speaking ? 'speaking' : ''}
                          aria-label={`${display(peer.user)}${peer.isLocal ? ' (You)' : ''} in ${item.name}${peer.speaking ? ', speaking' : ''}${peer.muted ? ', muted' : ''}${peer.deafened ? ', deafened' : ''}${peer.sharing ? ', streaming' : ''}`}
                          key={peer.key}
                          onClick={() => {
                            if (media.voiceChannelId === item.id) {
                              setVoiceViewChannelId(item.id);
                              if (peer.sharing) onWatch(peer.isLocal ? 'self' : peer.socketId || '');
                            } else {
                              setProfile(peer.user);
                            }
                          }}
                        >
                          <Avatar user={peer.user} size={24} />
                          <span>{display(peer.user)}{peer.isLocal ? ' (You)' : ''}</span>
                          {peer.muted && <MicOff size={12} />}
                          {peer.deafened && <HeadphoneOff size={12} />}
                          {peer.sharing && <b className="live-tag">LIVE</b>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </> : <>
            <button className="sidebar-search" onClick={() => setQuickOpen(true)}><Search size={15} /> Find a conversation <kbd>Ctrl K</kbd></button>
            <button className={`home-item ${!selection ? 'active' : ''}`} onClick={() => { setVoiceViewChannelId(null); setSelection(null); }}><Users size={20} /> Friends {boot.requests.filter(item => item.toId === me.id).length > 0 && <b className="badge">{boot.requests.filter(item => item.toId === me.id).length}</b>}</button>
            <div className="section-label dm-label"><span>DIRECT MESSAGES</span><button title="New group message" aria-label="New group message" onClick={() => showDialog('group')}><Plus size={16} /></button></div>
            {boot.conversations.map(item => { const other = users[item.memberIds.find(id => id !== me.id) || me.id]; return <button key={item.id} className={`dm-row ${conversation?.id === item.id ? 'active' : ''}`} onClick={() => { setVoiceViewChannelId(null); setSelection({ conversationId: item.id }); setQuery(''); setMobileNav(false); }}><Avatar user={other} size={31} /><span>{item.name || (item.memberIds.length > 2 ? `${display(other)} + ${item.memberIds.length - 2}` : display(other))}<small>{item.memberIds.length > 2 ? `${item.memberIds.length} members` : other?.status || 'offline'}</small></span>{unread[item.id] > 0 && <b className="badge">{unread[item.id]}</b>}</button>; })}
            {!boot.conversations.length && <p className="quiet sidebar-empty">Good conversations start<br />with a hello. Add a friend.</p>}
          </>}
        </div>
        {dialog !== 'settings' && media.persistenceError && <p className="error" role="alert">{media.persistenceError}</p>}
        <div className="user-panel"><button className="my-profile" title={`${display(me)} · ${me.status === 'dnd' ? 'Do not disturb' : connected ? statusLabel(me.status) : 'Connecting…'}`} onClick={() => showSettings('profile')}><Avatar user={me} size={36} /><span>{display(me)}<small>@{me.username}</small></span></button><button className="icon-button user-settings" title="Settings" aria-label="Settings" onClick={() => showSettings('profile')}><Settings size={18} /></button></div>
      </aside>
    </div>
    <main className="main-panel">
      <header className="topbar"><button className="icon-button mobile-menu mobile-menu-button" onClick={() => setMobileNav(value => !value)} aria-label="Toggle navigation" aria-expanded={mobileNav}><Menu size={20} /><span className="mobile-menu-label">Menu</span></button><div className={`channel-title ${voiceViewChannelId ? 'voice-room-title' : ''}`}>{server ? <span className="topbar-mark" aria-hidden="true">{server.name.trim().charAt(0).toUpperCase()}</span> : <img className="topbar-mark topbar-brand-mark" src="/haven-mark.png" alt="" aria-hidden="true" draggable={false} />}{voiceViewChannelId ? <Volume2 size={23} /> : selection ? channel ? <Hash size={23} /> : <MessageCircle size={22} /> : <Users size={22} />}<strong>{channelName}</strong>{channel?.topic && <><span className="topbar-divider" /><span className="channel-topic">{channel.topic}</span></>}</div><div className="topbar-tools">{conversation && !voiceViewChannelId && <div className="conversation-options"><ConversationOptions conversation={conversation} onChanged={() => void refresh()} onLeft={() => { setSelection(null); void refresh(); }} /></div>}{selection && <button className="icon-button" title="Search messages" aria-label="Search messages" onClick={() => setSearchOpen(value => !value)}><Search size={20} /></button>}{memberListAvailable && <button className={`icon-button ${showMembers ? 'is-on' : ''}`} title="Toggle member list" aria-label="Toggle member list" aria-pressed={showMembers} onClick={() => setShowMembers(value => !value)}><Users size={20} /></button>}<button className="icon-button" title="Notification settings" aria-label="Notification settings" onClick={() => showSettings('notifications')}><Bell size={19} /></button></div></header>
      {!connected && (
        <div className="connection-banner zenith-reconnecting-banner" role="status">
          <div className="zenith-reconnect-left">
            <div className="zenith-reconnect-icon" aria-hidden="true">
              <WifiOff size={14} />
            </div>
            <div className="zenith-reconnect-text-group">
              <span className="zenith-reconnect-title">Restoring connection…</span>
              <span className="zenith-reconnect-subtitle">WebRTC Direct Mesh · Your messages are saved</span>
            </div>
          </div>
          <button
            type="button"
            className="zenith-reconnect-btn"
            onClick={() => {
              socket?.connect();
              void refresh();
            }}
          >
            Reconnect now
          </button>
        </div>
      )}
      {searchOpen && <div className="search-bar"><Search size={16} /><input autoFocus placeholder={selection ? 'Search this conversation…' : 'Find a person or channel…'} value={query} onChange={event => setQuery(event.target.value)} /><button className="icon-button" title="Close search" onClick={() => { setSearchOpen(false); setQuery(''); }}><X size={17} /></button></div>}
      <div className="content-row"><section className="conversation-panel">

        {voiceViewChannelId && media.voiceChannelId ? <VoicePanel key={voiceViewChannelId} media={media} me={me} onProfile={id => { const user = canonicalUser(id); if (user) setProfile(user); }} onUserContext={(event, id) => contextProps({ kind: 'user', userId: id, serverId: currentVoice?.serverId }).onContextMenu(event)} channel={currentVoice} onQuality={() => showDialog('share')} onSounds={() => showDialog('soundboard')} onWatch={onWatch} onStopWatching={onStopWatching} onExpand={onExpand} onFullscreen={onFullscreen} dismissedStreams={dismissedStreams} onDismissStream={onDismissStream} /> : selection ? <>
          <div className="message-list" ref={timeline}>
            {hasMore ? <button className="load-older" onClick={() => void older().catch(error => notify(error.message))}><ArrowDown size={14} /> Load earlier messages</button> : <div className="channel-welcome"><span className="welcome-icon">{channel ? <Hash size={32} /> : <MessageCircle size={30} />}</span><p className="eyebrow">THE BEGINNING OF SOMETHING GOOD</p><h1>{channel ? `Welcome to #${channel.name}` : channelName}</h1><p>{channel?.topic || (conversation ? 'A little space for your conversations.' : 'This is where your community comes together. Say hello.')}</p>{channel && <button className="text-link" onClick={() => showDialog('invite')}><UserPlus size={14} /> Invite a friend</button>}</div>}
            {messageLoading && <div className="quiet loading-messages">Loading messages…</div>}
            {query && <div className="search-results-label">{messages.length} matching messages</div>}
            {messages.map((message, index) => { const author = users[message.authorId]; const previous = messages[index - 1]; const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString(); const compact = !newDay && previous.authorId === message.authorId && message.createdAt - previous.createdAt < 300000 && !message.replyTo; return <div key={message.id}>{newDay && <div className="date-divider" role="separator"><span>{dayLabel(message.createdAt)}</span></div>}<MessageRow message={message} author={author} me={me} compact={compact} replyMessage={messages.find(item => item.id === message.replyTo)} users={users} canDelete={message.authorId === me.id || !!canManage} onReply={() => setReply(message)} onProfile={() => author && setProfile(author)} onError={notify} /></div>; })}
            <div ref={bottom} />
          </div>
          <div className="composer-area">{reply && <div className="reply-banner"><Reply size={15} /> Replying to <b>{display(users[reply.authorId])}</b><span>{reply.content.slice(0, 100)}</span><button className="icon-button" title="Cancel reply" onClick={() => setReply(null)}><X size={15} /></button></div>}<Composer key={`${me.id}:${scope}`} selection={selection} name={channelName} reply={reply} socket={socket} connected={connected} onSent={message => {
            // A send can finish after navigation (including leaving and returning).
            // Realtime and the destination's next load already deliver that message.
            if (selectionRef.current !== selection || bootRef.current?.user.id !== me.id || deletedMessageIds.current.has(message.id)) return;
            setMessages(previous => previous.some(item => item.id === message.id) ? previous : [...previous, message]);
            setReply(null);
            setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 30);
          }} onError={notify} /><div className={`composer-hint ${activeTyping.length ? 'typing' : ''}`}><span className="typing-status" aria-live="polite">{activeTyping.length > 0 && <><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><b>{activeTyping.length > 3 ? 'Several people' : activeTyping.join(', ')}</b> {activeTyping.length > 1 ? 'are' : 'is'} typing…</>}</span><span className="composer-keys">Enter to send · Shift+Enter for a new line</span></div></div>
        </> : <FriendsPage onUserContext={(event, id) => contextProps({ kind: 'user', userId: id }).onContextMenu(event)} data={boot} tab={friendTab} setTab={setFriendTab} query={query} onAdd={() => showDialog('add-friend')} onCreateServer={() => showDialog('create-server')} onMessage={id => void startDM(id)} onProfile={setProfile} onChanged={() => void refresh()} notify={notify} onWatch={onWatch} onJoinVoice={async channelId => { if (media.voiceChannelId !== channelId) await media.join(channelId); setVoiceViewChannelId(channelId); setMobileNav(false); }} />}
        <VoiceConnection media={media} channel={currentVoice} serverName={boot.servers.find(item => item.id === currentVoice?.serverId)?.name} onOpen={() => { setVoiceViewChannelId(media.voiceChannelId); setMobileNav(false); }} onSounds={() => showDialog('soundboard')} onQuality={() => showDialog('share')} onOpenSettings={showSettings} />
      </section>
        {showMembers && memberListAvailable && <aside className="member-sidebar" aria-label="Members">{server ? <>{membersLoading && members.length === 0 ? <p className="quiet" style={{ padding: '16px 8px', fontSize: '11px' }}>Loading members…</p> : ['online', 'offline'].map(group => { const list = members.filter(member => group === 'offline' ? (users[member.user.id]?.status || member.user.status) === 'offline' : (users[member.user.id]?.status || member.user.status) !== 'offline'); return list.length ? <div key={group}><p className="member-group section-label">{group.toUpperCase()} — {list.length}</p>{list.map(member => <button className="member-row" key={member.user.id} {...contextProps({ kind: 'user', userId: member.user.id, serverId: server.id })} onClick={() => setProfile(users[member.user.id] || member.user)}><Avatar user={users[member.user.id] || member.user} size={36} /><span>{display(users[member.user.id] || member.user)}<small>@{member.user.username} · {statusLabel(users[member.user.id]?.status || member.user.status)}</small></span>{member.role !== 'member' && <Shield size={13} aria-label={member.role === 'owner' ? 'Server owner' : 'Moderator'} />}</button>)}</div> : null; })}{!membersLoading && <button className="member-invite" onClick={() => showDialog('invite')}><Plus size={15} /> Grow your community</button>}</> : conversation ? <><div className="section-label"><span>IN THIS CONVERSATION</span></div>{conversation.memberIds.map(id => <button key={id} className="member-row" {...contextProps({ kind: 'user', userId: id })} onClick={() => setProfile(users[id])}><Avatar user={users[id]} size={31} /><span>{display(users[id])}</span></button>)}</> : null}</aside>}
      </div>
    </main>
    {quickOpen && <QuickSwitcher data={boot} onClose={() => setQuickOpen(false)} onSelect={(next, nextServer) => { setVoiceViewChannelId(null); if (dialog === 'channel') setDialog(null); setServerId(nextServer); setSelection(next); setQuery(''); setMobileNav(false); }} />}
    {expandedStream && expandedStreamId && <StreamViewer stream={expandedStream} name={expandedName} local={expandedStreamId === 'self'} initialFullscreen={initialFullscreen} streamVolume={expandedPeer?.streamVolume ?? 1} onStreamVolumeChange={volume => { if (expandedStreamId !== 'self') media.setStreamVolume(expandedStreamId, volume); }} muted={media.muted} deafened={media.deafened} onToggleMute={media.toggleMute} onToggleDeafen={media.toggleDeafen} onClose={() => { setExpandedStreamId(null); setInitialFullscreen(false); }} onStop={media.stopShare} onStopWatching={() => { if (expandedStreamId && expandedStreamId !== 'self') onStopWatching(expandedStreamId); setExpandedStreamId(null); setInitialFullscreen(false); }} onError={notify} />}
    {pendingInvite && <Modal title="Community invitation" onClose={() => { setPendingInvite(null); history.replaceState({}, '', '/'); }}><InviteRedeem code={pendingInvite} authenticated onJoined={id => void finishJoining(id)} /></Modal>}
    {recoveryDialog}
    {toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}
    {profileUser && <ProfileCard data={boot} user={profileUser} role={members.find(member => member.user.id === profileUser.id)?.role} initialViewing={Boolean(picture && picture.id === profileUser.id)} onClose={() => { setProfile(null); if (picture?.id === profileUser.id) setPictureUser(null); }} onChanged={() => void refresh()} onMessage={id => void startDM(id)} notify={notify} />}
    {picture && pictureSource && (!profileUser || profileUser.id !== picture.id) && <ProfileCard data={boot} user={picture} role={members.find(member => member.user.id === picture.id)?.role} initialViewing={true} onClose={() => setPictureUser(null)} onChanged={() => void refresh()} onMessage={id => void startDM(id)} notify={notify} />}
    {contextTarget?.kind === 'user' && contextUser && <UserContextMenu key={`${contextUser.id}:${contextTarget.serverId || ''}`} user={contextUser} data={boot} server={contextServer} members={contextServer?.id === serverId ? members : undefined} media={media} position={contextTarget} onClose={() => setContextTarget(null)} onProfile={() => setProfile(contextUser)} onPicture={() => setPictureUser(contextUser)} onMessage={() => void startDM(contextUser.id)} onChanged={() => void refresh()} notify={notify} onWatch={onWatch} onStopWatching={onStopWatching} onExpand={onExpand} />}
    {contextTarget?.kind === 'server' && contextServer && <ContextMenu position={contextTarget} width={220} label={`Actions for ${contextServer.name}`} onClose={() => setContextTarget(null)}>
      <MenuItem icon={<Settings size={16} />} onClick={() => { chooseServer(contextServer.id); setContextTarget(null); showDialog('server-settings'); }}>Server settings</MenuItem>
      {contextServer.role !== 'member' && <MenuItem icon={<UserPlus size={16} />} onClick={() => { chooseServer(contextServer.id); setContextTarget(null); showDialog('invite'); }}>Invite people</MenuItem>}
      <MenuItem icon={<CheckCheck size={16} />} onClick={() => { setUnread(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !boot.channels.some(item => item.id === id && item.serverId === contextServer.id)))); setContextTarget(null); }}>Mark community as read</MenuItem>
      <div role="separator" />
      <MenuItem icon={<Copy size={16} />} onClick={() => { setContextTarget(null); void copyWithFeedback(contextServer.id, 'Server ID', notify); }}>Copy server ID</MenuItem>
    </ContextMenu>}
    {contextTarget?.kind === 'channel' && contextChannel && <ContextMenu position={contextTarget} width={200} label={`Actions for ${contextChannel.name}`} onClose={() => setContextTarget(null)}>
      <MenuItem active icon={contextChannel.type === 'voice' ? <Volume2 size={16} /> : <LogIn size={16} />} onClick={() => { if (contextChannel.type === 'voice') { void media.join(contextChannel.id); setVoiceViewChannelId(contextChannel.id); } else { setVoiceViewChannelId(null); setSelection({ channelId: contextChannel.id }); } setContextTarget(null); }}>{contextChannel.type === 'voice' ? 'Join voice channel' : 'Open channel'}</MenuItem>
      {boot.servers.find(item => item.id === contextChannel.serverId)?.role !== 'member' && <MenuItem icon={<Pencil size={16} />} onClick={() => { setEditChannel(contextChannel); setContextTarget(null); showDialog('channel'); }}>Edit channel</MenuItem>}
      <MenuItem icon={<CheckCheck size={16} />} onClick={() => { setUnread(previous => ({ ...previous, [contextChannel.id]: 0 })); setContextTarget(null); }}>Mark channel as read</MenuItem>
      <div role="separator" />
      <MenuItem icon={<Hash size={16} />} onClick={() => { setContextTarget(null); void copyWithFeedback(contextChannel.id, 'Channel ID', notify); }}>Copy channel ID</MenuItem>
    </ContextMenu>}
    {dialog === 'settings' && <SettingsDialog
      me={me}
      media={media}
      servers={boot.servers}
      busy={busy}
      preferences={preferences}
      onPreferences={setPreferences}
      initialTab={settingsTab}
      onSaveProfile={async ({ displayName, bio, avatar, status, avatarFile }) => {
        setBusy(true);
        let uploadedAvatar: string | undefined;
        try {
          if (avatarFile) {
            const form = new FormData();
            form.append('file', avatarFile, 'avatar.webp');
            const avatarRes = await api<{ user: User }>('/users/me/avatar', 'POST', form);
            uploadedAvatar = avatarRes.user.avatar;
          }
          let patchRes: { user: User } | null = null;
          try {
            patchRes = await api<{ user: User }>('/users/me', 'PATCH', {
              displayName,
              bio,
              ...(avatarFile ? {} : { avatar }),
              status,
            });
          } catch (patchErr) {
            if (uploadedAvatar) {
              (patchErr as any).uploadedAvatar = uploadedAvatar;
              await refresh().catch(() => {});
            }
            throw patchErr;
          }
          const refreshed = await refresh();
          notify('Settings saved');
          return patchRes?.user || refreshed?.user || (uploadedAvatar ? { ...me, avatar: uploadedAvatar } : me);
        } finally {
          setBusy(false);
        }
      }}
      onLogout={(scope = 'local') => void action(async () => {
        authRevision.current++;
        media.leave();
        // 'local' ends only this device's session; 'global' is the explicit "all devices" action.
        await api('/auth/logout', 'POST', { scope }).catch(() => { });
        const sb = getSupabase();
        if (sb) await sb.auth.signOut({ scope }).catch(() => { });
        if (window.haven?.clearAuthSession) await window.haven.clearAuthSession().catch(() => { });
        socket?.disconnect();
        setBoot(null);
        setSelection(null);
        setDialog(null);
      })}
      onClose={() => setDialog(null)}
    />}
    {dialog && dialog !== 'settings' && <Modal title={({ 'create-server': 'Make a space of your own', 'join-server': 'Find your people', channel: editChannel ? 'Edit channel' : 'Create a channel', invite: 'Good company starts with an invite', 'server-settings': 'Community settings', 'add-friend': 'Add a friend', group: 'Start a conversation', soundboard: 'A little more expression', share: 'Screen sharing' } as Record<string, string>)[dialog]} wide={dialog === 'server-settings'} hideHeader={dialog === 'server-settings' || dialog === 'channel' || dialog === 'invite' || dialog === 'soundboard' || dialog === 'share' || dialog === 'add-friend' || dialog === 'group' || dialog === 'create-server' || dialog === 'join-server'} className={dialog === 'server-settings' ? 'zenith-server-settings-modal' : dialog === 'channel' ? 'zenith-modal-frame zenith-channel-modal' : dialog === 'invite' ? 'zenith-modal-frame zenith-invite-modal' : dialog === 'soundboard' ? 'zenith-modal-frame zenith-soundboard-modal' : dialog === 'share' ? 'zenith-modal-frame zenith-share-modal' : dialog === 'add-friend' ? 'zenith-modal-frame zenith-add-friend-modal' : dialog === 'group' ? 'zenith-modal-frame zenith-group-modal' : dialog === 'create-server' ? 'zenith-modal-frame zenith-create-server-modal' : dialog === 'join-server' ? 'zenith-modal-frame zenith-join-server-modal' : ''} onClose={() => setDialog(null)}>
      {formError && dialog !== 'channel' && dialog !== 'create-server' && dialog !== 'join-server' && <p className="form-error" role="alert">{formError}</p>}
      {dialog === 'create-server' && (
        <CreateServerModal
          busy={busy}
          error={formError}
          onClose={() => setDialog(null)}
          onOpenJoin={() => showDialog('join-server')}
          onSubmit={async values => {
            const result = await api<{ server: Server; channel: Channel }>('/servers', 'POST', values);
            await refresh();
            setServerId(result.server.id);
            setSelection({ channelId: result.channel.id });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'join-server' && (
        <JoinServerModal
          authenticated={true}
          onClose={() => setDialog(null)}
          onOpenCreate={() => showDialog('create-server')}
          onJoined={id => void finishJoining(id)}
          onPending={savePendingInvite}
          notify={notify}
        />
      )}
      {dialog === 'channel' && (serverId || editChannel?.serverId) && <ChannelModal key={`${serverId}:${editChannel?.id || 'new'}`} serverId={serverId || editChannel!.serverId} editChannel={editChannel} initialType={newChannelType} onClose={() => setDialog(null)} onSubmit={async values => {
        const result = editChannel
          ? await api<{ channel: Channel }>(`/channels/${editChannel.id}`, 'PATCH', { name: values.name, topic: values.topic, position: Number(values.position) })
          : await api<{ channel: Channel }>(`/servers/${serverId}/channels`, 'POST', values);
        if (!result.channel?.id) throw new Error('Haven returned an invalid channel response. Please refresh before retrying.');
        await refresh();
      }} onDelete={editChannel ? async () => {
        const result = await api<{ ok: boolean }>(`/channels/${editChannel.id}`, 'DELETE');
        if (result.ok !== true) throw new Error('Haven returned an invalid deletion response. Please refresh before retrying.');
        await refresh();
      } : undefined} />}
      {dialog === 'invite' && server && <InviteCreate server={server} notify={notify} onClose={() => setDialog(null)} onOpenSettings={() => showDialog('server-settings')} />}
      {dialog === 'add-friend' && <AddFriendModal
        data={boot}
        onClose={() => setDialog(null)}
        onChanged={() => void refresh()}
        onPending={() => {
          setServerId(null);
          setSelection(null);
          setFriendTab('pending');
          setDialog(null);
        }}
        notify={notify}
      />}
      {dialog === 'group' && <GroupModal
        friends={boot.friends.map(id => users[id]).filter(Boolean)}
        busy={busy}
        onClose={() => setDialog(null)}
        onOpenAddFriend={() => showDialog('add-friend')}
        onSubmit={async values => {
          const result = await api<{ conversation: Conversation }>('/conversations', 'POST', values);
          await refresh();
          setServerId(null);
          setSelection({ conversationId: result.conversation.id });
          setDialog(null);
        }}
      />}
      {dialog === 'server-settings' && server && <ServerSettings server={server} members={members.map(member => ({ ...member, user: canonicalUser(member.user.id) || member.user }))} emojis={(boot.serverEmojis || []).filter(emoji => emoji.serverId === server.id)} me={me} onChanged={refresh} onLeft={() => { chooseServer(null); setDialog(null); }} notify={notify} onClose={() => setDialog(null)} loading={membersLoading} />}
      {dialog === 'soundboard' && <SoundboardModal
        sounds={sounds}
        soundServerId={soundServerId}
        currentVoiceChannelId={media.voiceChannelId}
        connected={connected}
        canManage={soundCanManage}
        me={me}
        media={media}
        onClose={() => setDialog(null)}
        onPlay={async sound => {
          return new Promise<void>((resolve, reject) => {
            socket?.emit('sound:play', { soundId: sound.id }, (result: { error?: string }) => {
              if (result?.error) {
                notify(result.error);
                reject(new Error(result.error));
              } else {
                resolve();
              }
            });
          });
        }}
        onDelete={async soundId => {
          await api(`/sounds/${soundId}`, 'DELETE');
          setSounds(previous => previous.filter(item => item.id !== soundId));
        }}
        onUpload={async file => {
          const data = new FormData();
          data.append('name', file.name.replace(/\.[^.]+$/, '').slice(0, 120));
          data.append('file', file);
          const result = await api<{ sound: Sound }>(`/servers/${soundServerId}/sounds`, 'POST', data);
          setSounds(previous => [...previous, result.sound]);
        }}
      />}
      {dialog === 'share' && <ShareQualityModal
        media={media}
        onClose={() => setDialog(null)}
      />}
    </Modal>}
  </div></EmojiMotionProvider>;
}

function Brand({ compact = false }: { compact?: boolean }) { return compact ? <img className="brand-mark" src="/haven-mark.png" alt="" draggable={false} /> : <img className="brand" src="/haven_newlogo.png" alt="Haven" draggable={false} />; }
function CommunityInvitationEntry({ onPending }: { onPending: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="auth-community-invite">
      <button className="text-link" onClick={() => setOpen(true)}>
        Join a community
      </button>
      {open && (
        <Modal
          title="Join a community"
          hideHeader={true}
          className="zenith-modal-frame zenith-join-server-modal"
          onClose={() => setOpen(false)}
        >
          <JoinServerModal
            authenticated={false}
            onJoined={() => { }}
            onPending={code => {
              onPending(code);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div>{icon}</div><h2>{title}</h2><p>{text}</p>{action && <section>{action}</section>}</div>; }
function SimpleForm({ children, submit, onSubmit, busy }: { children: ReactNode; submit: string; onSubmit: (values: Record<string, string>) => Promise<void>; busy: boolean }) { return <form className="simple-form" onSubmit={event => { event.preventDefault(); void onSubmit(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>); }}>{children}<div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'Working…' : submit}<ArrowRight size={16} /></button></div></form>; }
function FriendPicker({ friends }: { friends: User[] }) { const [selected, setSelected] = useState<string[]>([]); return <div className="friend-picker"><input type="hidden" name="memberIds" value={selected.join(',')} />{friends.map(user => <label key={user.id}><Avatar user={user} size={28} /><span>{display(user)}</span><input type="checkbox" checked={selected.includes(user.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, user.id] : previous.filter(id => id !== user.id))} /></label>)}</div>; }

function MessageRow({ message, author, me, compact, replyMessage, users, canDelete, onReply, onProfile, onError }: { message: Message; author?: User; me: User; compact: boolean; replyMessage?: Message; users: Record<string, User>; canDelete: boolean; onReply: () => void; onProfile: () => void; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false); const [content, setContent] = useState(message.content); const [reactionMenu, setReactionMenu] = useState(false);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function react(emoji: string) { try { await api(`/messages/${message.id}/reactions`, 'POST', { emoji }); setReactionMenu(false); } catch (error) { onError((error as Error).message); } }
  return <article tabIndex={-1} className={`message ${compact ? 'compact' : ''}`} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); const rectangle = event.currentTarget.getBoundingClientRect(); setMenu({ x: rectangle.left + 50, y: rectangle.top + 30 }); } }}>
    <div className="message-avatar">{compact ? <span className="compact-time">{time(message.createdAt)}</span> : <button className="avatar-button" onClick={onProfile}><Avatar user={author} size={38} /></button>}</div><div className="message-content">{!compact && <div className="message-heading"><button onClick={onProfile}>{display(author)}</button><time dateTime={new Date(message.createdAt).toISOString()}>{time(message.createdAt)}</time></div>}{message.replyTo && <div className="reply-context"><Reply size={13} /><span>{replyMessage ? `${display(users[replyMessage.authorId])}: ${replyMessage.content.slice(0, 140)}` : 'Reply to an earlier message'}</span></div>}{editing ? <form className="edit-message" onSubmit={async event => { event.preventDefault(); try { await api(`/messages/${message.id}`, 'PATCH', { content }); setEditing(false); } catch (error) { onError((error as Error).message); } }}><textarea aria-label="Edit message" value={content} onChange={event => setContent(event.target.value)} autoFocus maxLength={4000} /><span><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="text-link" type="submit">Save changes</button></span></form> : <p className="message-text"><EmojiText text={message.content} />{message.editedAt && <small className="edited"> (edited)</small>}</p>}
      {message.attachments.map(file => <a key={file.id} className="attachment" href={resolveApiUrl(file.url)} target="_blank" rel="noreferrer" download={file.name} onClick={event => { event.preventDefault(); void downloadAttachment(file.url, file.name).catch(error => onError(error.message)); }}><FileText size={22} /><span><b>{file.name}</b><small>{fileSize(file.size)} · Download attachment</small></span><Download size={18} /></a>)}
      {!!message.reactions.length && <div className="reactions">{message.reactions.map(reaction => <button className={reaction.userIds.includes(me.id) ? 'own' : ''} key={reaction.emoji} onClick={() => void react(reaction.emoji)}><Emoji value={reaction.emoji} /><span>{reaction.userIds.length}</span></button>)}</div>}</div>
    <div className="message-actions"><button title="Add reaction" aria-label="Add reaction" onClick={() => setReactionMenu(!reactionMenu)}><Smile size={16} /></button><button title="Reply" aria-label="Reply" onClick={onReply}><Reply size={16} /></button>{message.authorId === me.id && <button title="Edit message" aria-label="Edit message" onClick={() => { setContent(message.content); setEditing(true); }}><Pencil size={15} /></button>}{canDelete && <button title="Delete message" aria-label="Delete message" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>}</div>{reactionMenu && <div className="emoji-menu"><EmojiPicker onSelect={emoji => void react(emoji)} /></div>}
    {menu && <ContextMenu position={menu} width={190} label="Message actions" onClose={() => setMenu(null)}>
      <MenuItem active icon={<Reply size={16} />} onClick={() => { setMenu(null); onReply(); }}>Reply</MenuItem>
      <MenuItem icon={<UserIcon size={16} />} onClick={() => { setMenu(null); onProfile(); }}>View author profile</MenuItem>
      <MenuItem icon={<Copy size={16} />} onClick={() => { setMenu(null); void copyWithFeedback(message.content, 'Message text', undefined, undefined, onError); }}>Copy message text</MenuItem>
      {message.authorId === me.id && <MenuItem icon={<Pencil size={16} />} onClick={() => { setMenu(null); setContent(message.content); setEditing(true); }}>Edit message</MenuItem>}
      {canDelete && <>
        <div role="separator" />
        <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { setMenu(null); setConfirmDelete(true); }}>Delete message</MenuItem>
      </>}
    </ContextMenu>}
    {confirmDelete && (
      <ConfirmDialog
        title="Delete message"
        message="Are you sure you want to delete this message? This action cannot be undone."
        confirmLabel="Delete message"
        variant="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await api(`/messages/${message.id}`, 'DELETE');
            setConfirmDelete(false);
          } catch (error) {
            onError((error as Error).message);
            throw error;
          }
        }}
      />
    )}
  </article>;
}

function Composer({ selection, name, reply, socket, connected, onSent, onError }: { selection: NonNullable<Selection>; name: string; reply: Message | null; socket: Socket | null; connected: boolean; onSent: (message: Message) => void; onError: (message: string) => void }) {
  const [text, setText] = useState(''); const [attachments, setAttachments] = useState<Attachment[]>([]); const [busy, setBusy] = useState(false); const [emojiOpen, setEmojiOpen] = useState(false); const fileInput = useRef<HTMLInputElement>(null); const lastTyping = useRef(0);
  useEffect(() => { setText(''); setAttachments([]); }, [JSON.stringify(selection)]);
  async function send(event?: FormEvent) { event?.preventDefault(); if (busy || !connected || (!text.trim() && !attachments.length)) return; setBusy(true); try { const result = await api<{ message: Message }>('/messages', 'POST', { ...selection, content: text.trim(), replyTo: reply?.id, attachmentIds: attachments.map(item => item.id) }); setText(''); setAttachments([]); onSent(result.message); } catch (error) { onError((error as Error).message); } finally { setBusy(false); } }
  return <form className={`composer-wrap ${connected ? '' : 'offline'}`} onSubmit={event => void send(event)}>{attachments.length > 0 && <div className="pending-files">{attachments.map(item => <span key={item.id}><File size={14} />{item.name}<button type="button" title="Remove attachment" onClick={() => setAttachments(previous => previous.filter(file => file.id !== item.id))}><X size={13} /></button></span>)}</div>}<div className="composer"><input ref={fileInput} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 25 * 1024 * 1024) { onError('Files must be 25 MB or smaller'); return; } setBusy(true); const form = new FormData(); Object.entries(selection).forEach(([key, value]) => form.append(key, value)); form.append('file', file); void api<{ attachment: Attachment }>('/attachments', 'POST', form).then(result => setAttachments(previous => [...previous, result.attachment])).catch(error => onError(error.message)).finally(() => { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }); }} /><button type="button" className="attach-button" title="Attach a file" aria-label="Attach a file" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={19} /></button><textarea placeholder={`Message ${'channelId' in selection ? '#' : ''}${name}`} aria-label="Message" value={text} maxLength={4000} rows={1} disabled={busy} onChange={event => { setText(event.target.value); if (Date.now() - lastTyping.current > 1500) { socket?.emit('typing', selection); lastTyping.current = Date.now(); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button className="icon-button" type="button" title="Emoji" aria-label="Emoji" onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={21} /></button><button type="submit" className="send-button" title="Send message" aria-label="Send message" disabled={busy || !connected || (!text.trim() && !attachments.length)}><Send size={18} /></button></div>{emojiOpen && <div className="composer-emojis"><EmojiPicker onSelect={emoji => { setText(previous => previous + emoji); setEmojiOpen(false); }} /></div>}</form>;
}
