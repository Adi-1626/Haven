import { useEffect, useState, type ReactNode } from 'react';
import {
  Ban,
  Check,
  Copy,
  Gavel,
  Hash,
  HeadphoneOff,
  Headphones,
  Image,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Play,
  Square,
  User as UserIcon,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Bootstrap, Server, User } from '@haven/shared/types';
import type { useMedia } from './media';
import type { CommunityMember } from './ServerSettings';
import { api } from './api';
import { copyWithFeedback } from './clipboard';
import { ContextMenu, MenuItem, type MenuPosition } from './ContextMenu';
import { profileImageSource } from './profile-images';
import { ConfirmDialog } from './ZenithDialog';

export default function UserContextMenu({
  user,
  data,
  server,
  members,
  media,
  position,
  onClose,
  onProfile,
  onPicture,
  onMessage,
  onChanged,
  notify,
  onWatch,
  onStopWatching,
  onExpand,
  watchingId,
}: {
  user: User;
  data: Bootstrap;
  server?: Server;
  members?: CommunityMember[];
  media: ReturnType<typeof useMedia>;
  position: MenuPosition;
  onClose: () => void;
  onProfile: () => void;
  onPicture: () => void;
  onMessage: () => void;
  onChanged: () => void;
  notify: (message: string) => void;
  onWatch?: (id: string) => void;
  onStopWatching?: (id: string) => void;
  onExpand?: (id: string) => void;
  watchingId?: string | null;
}) {
  const [loadedMembers, setLoadedMembers] = useState<CommunityMember[] | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    icon?: ReactNode;
    action: () => Promise<void>;
  } | null>(null);
  const [soundboardMuted, setSoundboardMuted] = useState(() => Boolean(media.isUserSoundboardMuted?.(user.id)));

  useEffect(() => {
    setSoundboardMuted(Boolean(media.isUserSoundboardMuted?.(user.id)));
  }, [media, user.id]);

  useEffect(() => {
    if (!server || members) return;
    let current = true;
    void api<{ members: CommunityMember[] }>(`/servers/${server.id}/members`).then(result => { if (current) setLoadedMembers(result.members); }).catch(() => {});
    return () => { current = false; };
  }, [server?.id, members]);
  const self = user.id === data.user.id;
  const friend = data.friends.includes(user.id);
  const blocked = data.blocked.includes(user.id);
  const pending = data.requests.find(request => request.fromId === user.id || request.toId === user.id);
  const incoming = pending?.toId === data.user.id;
  const peer = media.peers.find(value => value.user.id === user.id);
  const isSharing = Boolean(peer?.state.sharing);
  const isWatching = isSharing && Boolean(peer && (media.isWatchingStream(peer.socketId) || media.watchingStreams?.includes(peer.socketId) || watchingId === peer.socketId));
  const target = (members ?? loadedMembers)?.find(value => value.user.id === user.id);
  const canModerate = !self && target && target.role !== 'owner' && (server?.role === 'owner' || server?.role === 'admin' && target.role === 'member');

  // Authoritative Voice Presence Logic:
  // Disconnect from voice is only shown when the target is genuinely connected to a voice channel on this server.
  const targetVoice = data.voice.find(value => value.user.id === user.id && data.channels.find(channel => channel.id === value.channelId)?.serverId === server?.id);
  const isSameActiveVoice = Boolean(
    media.voiceChannelId &&
    media.connectionStatus === 'connected' &&
    targetVoice &&
    targetVoice.channelId === media.voiceChannelId
  );
  const isTargetInVoice = Boolean(targetVoice && (!isSameActiveVoice || peer));
  const canDisconnect = Boolean(canModerate && server && isTargetInVoice);

  const isOnline = user.status ? user.status !== 'offline' : true;
  const run = (operation: () => Promise<void>) => { onClose(); void operation().catch(error => notify(error instanceof Error ? error.message : 'Could not complete this action')); };
  const contact = (route: string, method: string, body?: unknown) => run(async () => { await api(route, method, body); onChanged(); });
  const copy = (value: string, message: string) => run(async () => { await copyWithFeedback(value, message, notify); });
  const moderate = (action: 'mute' | 'deafen' | 'disconnect', enabled = true) => run(async () => { await api(`/servers/${server!.id}/members/${user.id}/voice`, 'POST', { action, enabled }); onChanged(); });

  if (confirmDialog) {
    return (
      <ConfirmDialog
        open={true}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        icon={confirmDialog.icon}
        variant="danger"
        onCancel={() => {
          setConfirmDialog(null);
          onClose();
        }}
        onConfirm={async () => {
          try {
            await confirmDialog.action();
            setConfirmDialog(null);
            onClose();
          } catch (error) {
            notify(error instanceof Error ? error.message : 'Could not complete this action');
            throw error;
          }
        }}
      />
    );
  }

  return <ContextMenu position={position} width={240} label={`Actions for ${user.displayName}`} onClose={onClose}>
    <div className="context-heading zenith-context-header">
      <div className="zenith-context-header-main">
        <span className="zenith-context-name">{user.displayName}</span>
        <span className={`zenith-context-presence-dot ${isOnline ? 'online' : 'offline'}`} />
      </div>
      <div className="zenith-context-handle">@{user.username}</div>
    </div>
    <MenuItem icon={<UserIcon size={16} />} onClick={() => { onClose(); onProfile(); }}>View profile</MenuItem>
    {profileImageSource(user.avatar) && <MenuItem icon={<Image size={16} />} onClick={() => { onClose(); onPicture(); }}>View original picture</MenuItem>}
    {!self && <>
      <MenuItem icon={<MessageSquare size={16} />} disabled={blocked} onClick={() => { onClose(); onMessage(); }}>Message</MenuItem>
      {isSharing && peer && (
        <>
          <div role="separator" />
          {isWatching ? (
            <>
              <MenuItem icon={<Square size={16} />} onClick={() => { onClose(); onStopWatching?.(peer.socketId); }}>Stop Watching</MenuItem>
              <MenuItem icon={<Maximize size={16} />} onClick={() => { onClose(); (onExpand || onWatch)?.(peer.socketId); }}>View Stream</MenuItem>
            </>
          ) : (
            <MenuItem icon={<Play size={16} />} onClick={() => { onClose(); onWatch?.(peer.socketId); }}>Watch Stream</MenuItem>
          )}
        </>
      )}
      {peer && (
        <>
          <div role="separator" />
          <div className="context-volume zenith-context-volume">
            <div className="zenith-context-volume-header">
              <span>User volume</span>
              <span className="zenith-context-volume-val">{Math.round(peer.volume * 100)}%</span>
            </div>
            <input
              aria-label={`${user.displayName} volume`}
              className="zenith-volume-slider"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={peer.volume}
              onChange={event => media.setUserVolume(user.id, Number(event.target.value))}
            />
            <div className="context-note zenith-context-note">Local audio controls affect only you.</div>
          </div>
          <MenuItem
            icon={peer.localMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
            onClick={() => media.setUserLocallyMuted(user.id, !peer.localMuted)}
          >
            {peer.localMuted ? 'Unmute locally' : 'Mute locally'}
          </MenuItem>
          <MenuItem
            icon={soundboardMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
            onClick={() => {
              const next = !soundboardMuted;
              media.setUserSoundboardMuted?.(user.id, next);
              setSoundboardMuted(next);
            }}
          >
            {soundboardMuted ? 'Unmute Soundboard' : 'Mute Soundboard'}
          </MenuItem>
        </>
      )}
      <div role="separator" />
      {blocked ? (
        <MenuItem icon={<Check size={16} />} onClick={() => contact(`/users/${user.id}/block`, 'DELETE')}>Unblock</MenuItem>
      ) : friend ? (
        <MenuItem
          danger
          icon={<UserMinus size={16} />}
          onClick={() => {
            setConfirmDialog({
              title: 'Remove friend',
              message: `Remove ${user.displayName} as a friend? You can always send another friend request later.`,
              confirmLabel: 'Remove friend',
              icon: <UserMinus size={20} />,
              action: async () => {
                await api(`/friends/${user.id}`, 'DELETE');
                onChanged();
              },
            });
          }}
        >
          Remove friend
        </MenuItem>
      ) : pending ? incoming ? (
        <>
          <MenuItem icon={<UserCheck size={16} />} onClick={() => contact(`/friends/requests/${pending.id}/accept`, 'POST', {})}>Accept friend request</MenuItem>
          <MenuItem danger icon={<UserX size={16} />} onClick={() => contact(`/friends/requests/${pending.id}`, 'DELETE')}>Decline friend request</MenuItem>
        </>
      ) : (
        <MenuItem danger icon={<X size={16} />} onClick={() => contact(`/friends/requests/${pending.id}`, 'DELETE')}>Cancel friend request</MenuItem>
      ) : (
        <MenuItem icon={<UserPlus size={16} />} onClick={() => contact('/friends/requests', 'POST', { username: user.username })}>Add friend</MenuItem>
      )}
      {!blocked && (
        <MenuItem
          danger
          icon={<Ban size={16} />}
          onClick={() => {
            setConfirmDialog({
              title: `Block ${user.displayName}`,
              message: `Block ${user.displayName}? This prevents direct contact but does not remove shared communities.`,
              confirmLabel: 'Block user',
              icon: <Ban size={20} />,
              action: async () => {
                await api(`/users/${user.id}/block`, 'POST', {});
                onChanged();
              },
            });
          }}
        >
          Block
        </MenuItem>
      )}
    </>}
    {canModerate && server && (
      <>
        <div role="separator" />
        <div className="context-heading zenith-moderation-heading">Community moderation</div>
        <MenuItem icon={target.serverMuted ? <Mic size={16} /> : <MicOff size={16} />} onClick={() => moderate('mute', !target.serverMuted)}>{target.serverMuted ? 'Remove server mute' : 'Server mute'}</MenuItem>
        <MenuItem icon={target.serverDeafened ? <Headphones size={16} /> : <HeadphoneOff size={16} />} onClick={() => moderate('deafen', !target.serverDeafened)}>{target.serverDeafened ? 'Remove server deafen' : 'Server deafen'}</MenuItem>
        {canDisconnect && <MenuItem danger icon={<PhoneOff size={16} />} onClick={() => moderate('disconnect')}>Disconnect from voice</MenuItem>}
        <MenuItem
          danger
          icon={<Gavel size={16} />}
          onClick={() => {
            setConfirmDialog({
              title: 'Remove from community',
              message: `Remove ${user.displayName} from ${server.name}? They will need an invitation to rejoin.`,
              confirmLabel: 'Remove member',
              icon: <Gavel size={20} />,
              action: async () => {
                await api(`/servers/${server.id}/members/${user.id}`, 'DELETE');
                onChanged();
              },
            });
          }}
        >
          Remove from community
        </MenuItem>
      </>
    )}
    <div role="separator" />
    <MenuItem icon={<Copy size={16} />} onClick={() => copy(user.username, 'Username')}>Copy username</MenuItem>
    <MenuItem icon={<Hash size={16} />} onClick={() => copy(user.id, 'User ID')}>Copy user ID</MenuItem>
  </ContextMenu>;
}
