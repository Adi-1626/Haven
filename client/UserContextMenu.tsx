import { useEffect, useState } from 'react';
import type { Bootstrap, Server, User } from '../shared/types';
import type { useMedia } from './media';
import type { CommunityMember } from './ServerSettings';
import { api } from './api';
import { ContextMenu, MenuItem, type MenuPosition } from './ContextMenu';
import { profileImageSource } from './profile-images';

export default function UserContextMenu({ user, data, server, members, media, position, onClose, onProfile, onPicture, onMessage, onChanged, notify }: { user: User; data: Bootstrap; server?: Server; members?: CommunityMember[]; media: ReturnType<typeof useMedia>; position: MenuPosition; onClose: () => void; onProfile: () => void; onPicture: () => void; onMessage: () => void; onChanged: () => void; notify: (message: string) => void }) {
  const [loadedMembers, setLoadedMembers] = useState<CommunityMember[] | null>(null);
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
  const target = (members ?? loadedMembers)?.find(value => value.user.id === user.id);
  const canModerate = !self && target && target.role !== 'owner' && (server?.role === 'owner' || server?.role === 'admin' && target.role === 'member');
  const voice = data.voice.find(value => value.user.id === user.id && data.channels.find(channel => channel.id === value.channelId)?.serverId === server?.id);
  const run = (operation: () => Promise<void>) => { onClose(); void operation().catch(error => notify(error instanceof Error ? error.message : 'Could not complete this action')); };
  const contact = (route: string, method: string, body?: unknown) => run(async () => { await api(route, method, body); onChanged(); });
  const copy = (value: string, message: string) => run(async () => { await navigator.clipboard.writeText(value); notify(`${message} copied`); });
  const moderate = (action: 'mute' | 'deafen' | 'disconnect', enabled = true) => run(async () => { await api(`/servers/${server!.id}/members/${user.id}/voice`, 'POST', { action, enabled }); onChanged(); });
  return <ContextMenu position={position} label={`Actions for ${user.displayName}`} onClose={onClose}>
    <div className="context-heading">{user.displayName}<small>@{user.username}</small></div>
    <MenuItem onClick={() => { onClose(); onProfile(); }}>View profile</MenuItem>
    {profileImageSource(user.avatar) && <MenuItem onClick={() => { onClose(); onPicture(); }}>View original picture</MenuItem>}
    {!self && <><MenuItem disabled={blocked} onClick={() => { onClose(); onMessage(); }}>Message</MenuItem>
      {peer && <><div role="separator" /><label className="context-volume">User volume <b>{Math.round(peer.volume * 100)}%</b><input aria-label={`${user.displayName} volume`} type="range" min="0" max="1" step="0.05" value={peer.volume} onChange={event => media.setUserVolume(user.id, Number(event.target.value))} /></label><MenuItem onClick={() => media.setUserLocallyMuted(user.id, !peer.localMuted)}>{peer.localMuted ? 'Unmute locally' : 'Mute locally'}</MenuItem><small className="context-note">Local audio controls affect only you.</small></>}
      <div role="separator" />
      {blocked ? <MenuItem onClick={() => contact(`/users/${user.id}/block`, 'DELETE')}>Unblock</MenuItem> : friend ? <MenuItem danger onClick={() => { if (confirm(`Remove ${user.displayName} as a friend?`)) contact(`/friends/${user.id}`, 'DELETE'); }}>Remove friend</MenuItem> : pending ? incoming ? <><MenuItem onClick={() => contact(`/friends/requests/${pending.id}/accept`, 'POST', {})}>Accept friend request</MenuItem><MenuItem onClick={() => contact(`/friends/requests/${pending.id}`, 'DELETE')}>Decline friend request</MenuItem></> : <MenuItem onClick={() => contact(`/friends/requests/${pending.id}`, 'DELETE')}>Cancel friend request</MenuItem> : <MenuItem onClick={() => contact('/friends/requests', 'POST', { username: user.username })}>Add friend</MenuItem>}
      {!blocked && <MenuItem danger onClick={() => { if (confirm(`Block ${user.displayName}? This prevents direct contact but does not remove shared communities.`)) contact(`/users/${user.id}/block`, 'POST', {}); }}>Block</MenuItem>}
    </>}
    {canModerate && server && <><div role="separator" /><div className="context-heading">Community moderation</div><MenuItem onClick={() => moderate('mute', !target.serverMuted)}>{target.serverMuted ? 'Remove server mute' : 'Server mute'}</MenuItem><MenuItem onClick={() => moderate('deafen', !target.serverDeafened)}>{target.serverDeafened ? 'Remove server deafen' : 'Server deafen'}</MenuItem>{voice && <MenuItem danger onClick={() => moderate('disconnect')}>Disconnect from voice</MenuItem>}<MenuItem danger onClick={() => { if (confirm(`Remove ${user.displayName} from ${server.name}?`)) contact(`/servers/${server.id}/members/${user.id}`, 'DELETE'); }}>Remove from community</MenuItem></>}
    <div role="separator" /><MenuItem onClick={() => copy(user.username, 'Username')}>Copy username</MenuItem><MenuItem onClick={() => copy(user.id, 'User ID')}>Copy user ID</MenuItem>
  </ContextMenu>;
}
