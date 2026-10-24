import type { User, VoicePeer } from '@haven/shared/types';
import type { MediaPeer } from './media';

export interface VoiceRosterParticipant {
  key: string;
  userId: string;
  user: User;
  isLocal: boolean;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  socketId?: string;
}

export interface GetVoiceParticipantsOptions {
  channelId: string;
  me: User | null | undefined;
  activeVoiceChannelId: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  mediaPeers: MediaPeer[];
  mediaSpeaking: boolean;
  mediaMuted: boolean;
  mediaDeafened: boolean;
  mediaSharing: boolean;
  bootVoice: VoicePeer[];
  canonicalUser?: (userId: string) => User | undefined;
  localSocketId?: string;
}

/**
 * Returns the participant list for a voice channel in the left sidebar.
 *
 * Rules:
 * 1. If the authenticated user is currently in or connecting to this channel,
 *    they MUST always appear FIRST in the list.
 * 2. Other connected participants appear below the current user in stable order.
 * 3. When the user is not in this channel, or leaves/switches channels, the local user
 *    must never appear in this channel (purging any stale bootstrap snapshots).
 * 4. In the active channel, uses live WebRTC peer membership (mediaPeers) when connected
 *    to guarantee real-time synchronisation with the main Voice Room view without flickering.
 * 5. Uses the real authenticated user ID (me.id) to identify the local participant.
 */
export function getChannelVoiceParticipants(options: GetVoiceParticipantsOptions): VoiceRosterParticipant[] {
  const {
    channelId,
    me,
    activeVoiceChannelId,
    connectionStatus,
    mediaPeers,
    mediaSpeaking,
    mediaMuted,
    mediaDeafened,
    mediaSharing,
    bootVoice,
    canonicalUser = () => undefined,
    localSocketId,
  } = options;

  // 1. Determine whether the authenticated user is in this voice channel based on
  // actual voice connection state (not just viewing/selecting a channel).
  const isLocalInThisChannel = Boolean(
    me &&
    activeVoiceChannelId === channelId &&
    connectionStatus !== 'disconnected'
  );

  // 2. Collect remote participants.
  // Pre-seed seenUserIds with the local user ID so `me` can NEVER be duplicated
  // or included in the remote list under any circumstance.
  const remoteParticipants: VoiceRosterParticipant[] = [];
  const seenUserIds = new Set<string>();
  if (me?.id) {
    seenUserIds.add(me.id);
  }

  // When the user is actively in this channel:
  // - If connected, mediaPeers is the authoritative WebRTC mesh roster (same source as Voice Room).
  // - If connecting and mediaPeers is still empty, fall back to bootVoice peers for smooth non-flickering entry.
  const shouldUseMediaPeers = isLocalInThisChannel && (
    mediaPeers.length > 0 || connectionStatus === 'connected'
  );

  if (shouldUseMediaPeers) {
    for (const peer of mediaPeers) {
      if (seenUserIds.has(peer.user.id)) continue;
      seenUserIds.add(peer.user.id);
      const userObj = (canonicalUser(peer.user.id) || peer.user) as User;
      remoteParticipants.push({
        key: peer.socketId || `peer-${peer.user.id}`,
        userId: peer.user.id,
        user: userObj,
        isLocal: false,
        speaking: Boolean(peer.state.speaking && !peer.state.muted && !peer.state.deafened),
        muted: Boolean(peer.state.muted || peer.state.serverMuted),
        deafened: Boolean(peer.state.deafened || peer.state.serverDeafened),
        sharing: Boolean(peer.state.sharing),
        socketId: peer.socketId,
      });
    }
  } else {
    // For channels the local user is not connected to (or while initial connection is starting):
    const channelPeers = bootVoice.filter(p => p.channelId === channelId);
    for (const peer of channelPeers) {
      if (seenUserIds.has(peer.user.id)) continue;
      seenUserIds.add(peer.user.id);
      const userObj = (canonicalUser(peer.user.id) || peer.user) as User;
      remoteParticipants.push({
        key: peer.socketId || `voice-${peer.user.id}`,
        userId: peer.user.id,
        user: userObj,
        isLocal: false,
        speaking: Boolean(peer.speaking && !peer.muted && !peer.deafened),
        muted: Boolean(peer.muted || peer.serverMuted),
        deafened: Boolean(peer.deafened || peer.serverDeafened),
        sharing: Boolean(peer.sharing),
        socketId: peer.socketId,
      });
    }
  }

  // 3. Prepend the authenticated local user FIRST if they are in this channel.
  if (isLocalInThisChannel && me) {
    const localUserObj = (canonicalUser(me.id) || me) as User;
    const localParticipant: VoiceRosterParticipant = {
      key: localSocketId ? `local-${localSocketId}` : `local-${me.id}`,
      userId: me.id,
      user: localUserObj,
      isLocal: true,
      speaking: Boolean(mediaSpeaking && !mediaMuted && !mediaDeafened),
      muted: Boolean(mediaMuted),
      deafened: Boolean(mediaDeafened),
      sharing: Boolean(mediaSharing),
      socketId: localSocketId || 'local',
    };
    return [localParticipant, ...remoteParticipants];
  }

  return remoteParticipants;
}
