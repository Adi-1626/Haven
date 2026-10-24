import test from 'node:test';
import assert from 'node:assert/strict';
import type { User, VoicePeer } from '@haven/shared/types';
import type { MediaPeer } from './media';
import { getChannelVoiceParticipants } from './voice-roster';

const makeUser = (id: string, name: string): User => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  bio: '',
  avatar: '',
  status: 'online',
  createdAt: 1000,
});

test('1. One user joins an empty voice channel: local user is immediately first', () => {
  const me = makeUser('usr-a', 'Alice');
  const participants = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me,
    activeVoiceChannelId: 'chn-voice-1',
    connectionStatus: 'connecting',
    mediaPeers: [],
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [],
  });

  assert.equal(participants.length, 1);
  assert.equal(participants[0].userId, 'usr-a');
  assert.equal(participants[0].isLocal, true);
  assert.equal(participants[0].user.displayName, 'Alice');
});

test('2 & 4. Two users in same channel: each user sees themselves FIRST regardless of join order', () => {
  const alice = makeUser('usr-a', 'Alice');
  const bob = makeUser('usr-b', 'Bob');

  const aliceMediaPeers: MediaPeer[] = [
    {
      socketId: 'sock-bob',
      user: bob,
      stream: null,
      state: { muted: false, deafened: false, sharing: false, speaking: false },
      volume: 1,
    },
  ];

  // On Alice's screen (Alice is local):
  const onAliceScreen = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me: alice,
    activeVoiceChannelId: 'chn-voice-1',
    connectionStatus: 'connected',
    mediaPeers: aliceMediaPeers,
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [],
  });

  assert.equal(onAliceScreen.length, 2);
  assert.equal(onAliceScreen[0].userId, 'usr-a', 'Alice must see Alice first');
  assert.equal(onAliceScreen[0].isLocal, true);
  assert.equal(onAliceScreen[1].userId, 'usr-b', 'Alice must see Bob second');
  assert.equal(onAliceScreen[1].isLocal, false);

  // On Bob's screen (Bob is local, Alice joined earlier):
  const bobMediaPeers: MediaPeer[] = [
    {
      socketId: 'sock-alice',
      user: alice,
      stream: null,
      state: { muted: false, deafened: false, sharing: false, speaking: false },
      volume: 1,
    },
  ];

  const onBobScreen = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me: bob,
    activeVoiceChannelId: 'chn-voice-1',
    connectionStatus: 'connected',
    mediaPeers: bobMediaPeers,
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [],
  });

  assert.equal(onBobScreen.length, 2);
  assert.equal(onBobScreen[0].userId, 'usr-b', 'Bob must see Bob first even though Alice joined earlier');
  assert.equal(onBobScreen[0].isLocal, true);
  assert.equal(onBobScreen[1].userId, 'usr-a', 'Bob must see Alice second');
  assert.equal(onBobScreen[1].isLocal, false);
});

test('3. Six participants in same channel: local user is first, remaining five below in stable order', () => {
  const me = makeUser('usr-local', 'LocalUser');
  const names = ['Elena', 'Marcus', 'Sarah', 'Devon', 'Kai'];
  const mediaPeers: MediaPeer[] = names.map((name, i) => ({
    socketId: `sock-${name.toLowerCase()}`,
    user: makeUser(`usr-${i}`, name),
    stream: null,
    state: { muted: false, deafened: false, sharing: false, speaking: false },
    volume: 1,
  }));

  const participants = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me,
    activeVoiceChannelId: 'chn-voice-1',
    connectionStatus: 'connected',
    mediaPeers,
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [],
  });

  assert.equal(participants.length, 6);
  assert.equal(participants[0].userId, 'usr-local');
  assert.equal(participants[0].isLocal, true);
  for (let i = 0; i < names.length; i++) {
    assert.equal(participants[i + 1].user.displayName, names[i]);
    assert.equal(participants[i + 1].isLocal, false);
  }
});

test('5. One participant leaves: updated media peers removes participant immediately', () => {
  const me = makeUser('usr-local', 'LocalUser');
  const bob = makeUser('usr-b', 'Bob');
  const mediaPeers: MediaPeer[] = [
    {
      socketId: 'sock-bob',
      user: bob,
      stream: null,
      state: { muted: false, deafened: false, sharing: false, speaking: false },
      volume: 1,
    },
  ];

  const before = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me,
    activeVoiceChannelId: 'chn-voice-1',
    connectionStatus: 'connected',
    mediaPeers,
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [],
  });
  assert.equal(before.length, 2);

  // Bob leaves: mediaPeers becomes empty
  const after = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me,
    activeVoiceChannelId: 'chn-voice-1',
    connectionStatus: 'connected',
    mediaPeers: [],
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [],
  });
  assert.equal(after.length, 1);
  assert.equal(after[0].userId, 'usr-local');
});

test('6. Current user leaves: local participant is removed immediately, even with stale boot.voice', () => {
  const me = makeUser('usr-local', 'LocalUser');
  const bob = makeUser('usr-b', 'Bob');

  // Stale boot snapshot that still lists me in chn-voice-1
  const staleBootVoice: VoicePeer[] = [
    {
      socketId: 'sock-bob',
      user: bob,
      channelId: 'chn-voice-1',
      muted: false,
      deafened: false,
      sharing: false,
    },
    {
      socketId: 'sock-local',
      user: me,
      channelId: 'chn-voice-1',
      muted: false,
      deafened: false,
      sharing: false,
    },
  ];

  // User has disconnected (activeVoiceChannelId = null, connectionStatus = 'disconnected')
  const participants = getChannelVoiceParticipants({
    channelId: 'chn-voice-1',
    me,
    activeVoiceChannelId: null,
    connectionStatus: 'disconnected',
    mediaPeers: [],
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: staleBootVoice,
  });

  // Must only contain Bob; stale local user must be filtered out!
  assert.equal(participants.length, 1);
  assert.equal(participants[0].userId, 'usr-b');
  assert.equal(participants[0].isLocal, false);
});

test('7. Current user switches channels: removed from previous channel and first in new channel', () => {
  const me = makeUser('usr-local', 'LocalUser');
  const bob = makeUser('usr-b', 'Bob');
  const charlie = makeUser('usr-c', 'Charlie');

  const bootVoice: VoicePeer[] = [
    {
      socketId: 'sock-bob',
      user: bob,
      channelId: 'chn-room-1',
      muted: false,
      deafened: false,
      sharing: false,
    },
    {
      socketId: 'sock-charlie',
      user: charlie,
      channelId: 'chn-room-2',
      muted: false,
      deafened: false,
      sharing: false,
    },
  ];

  // Local user is connected to Room 2
  const room1Participants = getChannelVoiceParticipants({
    channelId: 'chn-room-1',
    me,
    activeVoiceChannelId: 'chn-room-2',
    connectionStatus: 'connected',
    mediaPeers: [],
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice,
  });

  const room2Participants = getChannelVoiceParticipants({
    channelId: 'chn-room-2',
    me,
    activeVoiceChannelId: 'chn-room-2',
    connectionStatus: 'connected',
    mediaPeers: [
      {
        socketId: 'sock-charlie',
        user: charlie,
        stream: null,
        state: { muted: false, deafened: false, sharing: false },
        volume: 1,
      },
    ],
    mediaSpeaking: false,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice,
  });

  // Room 1 should only have Bob (no local user)
  assert.equal(room1Participants.length, 1);
  assert.equal(room1Participants[0].userId, 'usr-b');

  // Room 2 should have LocalUser FIRST, then Charlie
  assert.equal(room2Participants.length, 2);
  assert.equal(room2Participants[0].userId, 'usr-local');
  assert.equal(room2Participants[0].isLocal, true);
  assert.equal(room2Participants[1].userId, 'usr-c');
  assert.equal(room2Participants[1].isLocal, false);
});

test('8. Reconnection: local user remains first during reconnecting status', () => {
  const me = makeUser('usr-local', 'LocalUser');
  const bob = makeUser('usr-b', 'Bob');

  const participants = getChannelVoiceParticipants({
    channelId: 'chn-room-1',
    me,
    activeVoiceChannelId: 'chn-room-1',
    connectionStatus: 'reconnecting',
    mediaPeers: [],
    mediaSpeaking: false,
    mediaMuted: true,
    mediaDeafened: false,
    mediaSharing: false,
    bootVoice: [
      {
        socketId: 'sock-bob',
        user: bob,
        channelId: 'chn-room-1',
        muted: false,
        deafened: false,
        sharing: false,
      },
    ],
  });

  assert.equal(participants.length, 2);
  assert.equal(participants[0].userId, 'usr-local');
  assert.equal(participants[0].isLocal, true);
  assert.equal(participants[0].muted, true);
  assert.equal(participants[1].userId, 'usr-b');
});

test('Speaking, mute, deafen and sharing states are preserved accurately', () => {
  const me = makeUser('usr-local', 'LocalUser');
  const bob = makeUser('usr-b', 'Bob');

  const participants = getChannelVoiceParticipants({
    channelId: 'chn-room-1',
    me,
    activeVoiceChannelId: 'chn-room-1',
    connectionStatus: 'connected',
    mediaPeers: [
      {
        socketId: 'sock-bob',
        user: bob,
        stream: null,
        state: { muted: false, deafened: true, sharing: true, speaking: true },
        volume: 1,
      },
    ],
    mediaSpeaking: true,
    mediaMuted: false,
    mediaDeafened: false,
    mediaSharing: true,
    bootVoice: [],
  });

  // Local user: speaking, sharing, not muted, not deafened
  assert.equal(participants[0].isLocal, true);
  assert.equal(participants[0].speaking, true);
  assert.equal(participants[0].muted, false);
  assert.equal(participants[0].deafened, false);
  assert.equal(participants[0].sharing, true);

  // Bob: deafened (so speaking is false even if audio activity), sharing
  assert.equal(participants[1].isLocal, false);
  assert.equal(participants[1].deafened, true);
  assert.equal(participants[1].speaking, false);
  assert.equal(participants[1].sharing, true);
});
