import type { Bootstrap, User, VoicePeer } from '../shared/types';

export function bootstrapUpdates() {
  return { users: new Map<string, Partial<User>>(), voice: new Map<string, Partial<VoicePeer>>() };
}

export function mergeBootstrapUpdates(snapshot: Bootstrap, updates: ReturnType<typeof bootstrapUpdates>): Bootstrap {
  const profile = (user: User): User => ({ ...user, ...updates.users.get(user.id) });
  return {
    ...snapshot,
    user: profile(snapshot.user),
    users: snapshot.users.map(profile),
    voice: snapshot.voice.map(peer => ({ ...peer, ...updates.voice.get(peer.socketId), user: profile(peer.user) })),
  };
}
