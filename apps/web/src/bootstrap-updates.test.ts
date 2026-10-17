import test from 'node:test';
import assert from 'node:assert/strict';
import type { Bootstrap, User, VoicePeer } from '@haven/shared/types';
import { bootstrapUpdates, mergeBootstrapUpdates } from './bootstrap-updates';

test('in-flight bootstrap responses cannot replace newer profile, presence or voice events', () => {
  const user = { id: 'user', avatar: 'https://images.test/old.png', displayName: 'Before', status: 'online', settings: { saved: true } } as unknown as User;
  const peer = { socketId: 'peer', user, muted: false, deafened: false, speaking: false } as VoicePeer;
  const snapshot = { user, users: [user], voice: [peer], servers: [], channels: [] } as unknown as Bootstrap;
  const updates = bootstrapUpdates();
  updates.users.set(user.id, { avatar: 'https://images.test/new.png', displayName: 'After', status: 'dnd' });
  updates.voice.set('peer', { speaking: true, sharing: true });
  updates.voice.set('removed-peer', { speaking: true });
  const result = mergeBootstrapUpdates(snapshot, updates);
  assert.equal(result.user.avatar, 'https://images.test/new.png');
  assert.deepEqual(result.user.settings, { saved: true });
  assert.equal(result.users[0].status, 'dnd');
  assert.equal(result.voice[0].user.displayName, 'After');
  assert.equal(result.voice[0].speaking, true);
  assert.equal(result.voice[0].sharing, true);
  assert.equal(result.voice.length, 1);
  assert.equal(snapshot.voice[0].speaking, false);
  assert.equal(snapshot.user.avatar, 'https://images.test/old.png');
});
