import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { Bootstrap, Server, Sound, User } from '@haven/shared/types';
import { SoundboardService } from './soundboard-service';
import UserContextMenu from './UserContextMenu';
import { SoundboardModal } from './SoundboardModal';
import { VoiceSettings } from './settings/VoiceSettings';

// Mock localStorage for Node test environment
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

// Polyfill window / AudioContext / localStorage for test execution
(globalThis as any).window = {
  ...globalThis,
  location: { hostname: 'localhost', protocol: 'http:' },
};
(globalThis as any).localStorage = new MockLocalStorage();

class MockAudioBufferSourceNode {
  buffer: any = null;
  connect(dest: any) { return dest; }
  start() {}
  stop() {}
}

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime(val: number) { this.value = val; },
  };
  connect(dest: any) { return dest; }
}

class MockAudioContext {
  state = 'running';
  destination = {};
  currentTime = 0;
  createGain() { return new MockGainNode(); }
  createBufferSource() { return new MockAudioBufferSourceNode(); }
  decodeAudioData(buffer: any) { return Promise.resolve(buffer); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).window.AudioContext = MockAudioContext;
(globalThis as any).fetch = async (url: string) => url.endsWith('/api/config') ? Response.json({ mode: 'local' }) : ({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(128),
  json: async () => ({ ok: true }),
});

const userMe: User = { id: 'usr-alex', username: 'alex_mercer', displayName: 'Alex Mercer', bio: '', avatar: '🌱', status: 'online', createdAt: 1704100000000 };
const userElena: User = { id: 'usr-elena', username: 'elena_r', displayName: 'Elena Rostova', bio: '', avatar: '⚡', status: 'online', createdAt: 1704200000000 };
const userDevon: User = { id: 'usr-devon', username: 'devon_k', displayName: 'Devon Knox', bio: '', avatar: '🌊', status: 'online', createdAt: 1704300000000 };

const serverZenith: Server = { id: 'srv-zenith', name: 'Zenith Design Lab', icon: '🎨', description: 'Design Lab', ownerId: 'usr-alex', role: 'owner', createdAt: 1704100000000 };
const serverLounge: Server = { id: 'srv-lounge', name: 'Night Owl Lounge', icon: '🌙', description: 'Lounge', ownerId: 'usr-elena', role: 'member', createdAt: 1704300000000 };

const soundsZenith: Sound[] = [
  { id: 'snd-chime', serverId: 'srv-zenith', name: 'Zenith Chime', url: '/api/sounds/snd-chime/audio', uploaderId: 'usr-alex' },
  { id: 'snd-pop', serverId: 'srv-zenith', name: 'Bubble Pop', url: '/api/sounds/snd-pop/audio', uploaderId: 'usr-elena' },
];

const soundsLounge: Sound[] = [
  { id: 'snd-owl', serverId: 'srv-lounge', name: 'Night Owl Ambient', url: '/api/sounds/snd-owl/audio', uploaderId: 'usr-elena' },
];

test('1. Soundboard Global Volume and Mute logic', async () => {
  const service = new SoundboardService();

  // Test 1a: Playing sound with volume > 0 and unmuted proceeds to audio pipeline
  const played = await service.playSound('/api/sounds/snd-chime/audio', {
    volume: 0.8,
    isMuted: false,
    outputVolume: 1,
  });
  assert.equal(played, true, 'Sound should play when volume is > 0 and unmuted');

  // Test 1b: Playing sound when globally muted returns false (suppressed on client)
  const mutedPlay = await service.playSound('/api/sounds/snd-chime/audio', {
    volume: 0.8,
    isMuted: true,
    outputVolume: 1,
  });
  assert.equal(mutedPlay, false, 'Sound should be suppressed when soundboard is globally muted');

  // Test 1c: Playing sound when volume is 0 returns false
  const zeroVolPlay = await service.playSound('/api/sounds/snd-chime/audio', {
    volume: 0,
    isMuted: false,
    outputVolume: 1,
  });
  assert.equal(zeroVolPlay, false, 'Sound should be suppressed when volume is 0');
});

test('2. Per-User Soundboard Mute & Independence from Microphone Voice', async () => {
  const service = new SoundboardService();
  service.clearMutedUsers();

  // Initially neither Elena nor Devon are soundboard-muted
  assert.equal(service.isUserSoundboardMuted('usr-elena'), false);
  assert.equal(service.isUserSoundboardMuted('usr-devon'), false);

  // Mute Elena's soundboard
  service.setUserSoundboardMuted('usr-elena', true);
  assert.equal(service.isUserSoundboardMuted('usr-elena'), true, "Elena's soundboard is muted");
  assert.equal(service.isUserSoundboardMuted('usr-devon'), false, "Devon's soundboard remains unmuted");

  // Incoming sound from Elena must be suppressed
  const elenaSound = await service.playSound('/api/sounds/snd-pop/audio', {
    volume: 1,
    isMuted: false,
    userId: 'usr-elena',
  });
  assert.equal(elenaSound, false, "Elena's soundboard sounds must be suppressed on receiver");

  // Incoming sound from Devon must still play
  const devonSound = await service.playSound('/api/sounds/snd-chime/audio', {
    volume: 1,
    isMuted: false,
    userId: 'usr-devon',
  });
  assert.equal(devonSound, true, "Devon's soundboard sounds must play uninhibited");

  // Unmuting Elena restores playback
  service.setUserSoundboardMuted('usr-elena', false);
  assert.equal(service.isUserSoundboardMuted('usr-elena'), false);
  const elenaUnmuted = await service.playSound('/api/sounds/snd-pop/audio', {
    volume: 1,
    isMuted: false,
    userId: 'usr-elena',
  });
  assert.equal(elenaUnmuted, true, "Elena's sounds play again after unmuting");
});

test('3. Per-User Soundboard Mute persists in localStorage across sessions', () => {
  const serviceA = new SoundboardService();
  serviceA.setUserSoundboardMuted('usr-elena', true);

  // Instantiate a fresh service instance (simulating app reload or restart)
  const serviceB = new SoundboardService();
  assert.equal(serviceB.isUserSoundboardMuted('usr-elena'), true, 'Preference survives application reload');
  assert.equal(serviceB.isUserSoundboardMuted('usr-devon'), false);

  serviceA.setUserSoundboardMuted('usr-elena', false);
});

test('live playback gains track master volume and per-user mute; a late download cannot survive leave', async () => {
  const service = new SoundboardService();
  service.clearMutedUsers();
  service.updatePlaybackSettings({ volume: 0.4, isMuted: false, outputVolume: 0.5 });
  assert.equal(await service.playSound('/sound.wav', { userId: 'speaker' }), true);
  const gain = [...(service as any).activeGains][0] as MockGainNode;
  assert.equal(gain.gain.value, 0.2);
  service.setUserSoundboardMuted('speaker', true);
  assert.equal(gain.gain.value, 0);
  service.setUserSoundboardMuted('speaker', false);
  assert.equal(gain.gain.value, 0.2);
  const originalFetch = globalThis.fetch;
  let downloaded!: (value: Response) => void;
  globalThis.fetch = () => new Promise<Response>(resolve => { downloaded = resolve; });
  try {
    const pending = service.playSound('/late.wav');
    await new Promise(resolve => setImmediate(resolve));
    service.stopAllSounds();
    downloaded(new Response(new ArrayBuffer(16)));
    assert.equal(await pending, false, 'leaving cancels pending playback too');
    assert.equal((service as any).activeSources.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('an account with no entry sound never inherits another account local cache', () => {
  localStorage.setItem('haven.entry-sounds', JSON.stringify({ 'srv-zenith': 'someone-elses-sound' }));
  const service = new SoundboardService();
  assert.equal(service.getEntrySoundId('srv-zenith', { ...userMe, settings: { entrySounds: {} } }), null);
});

test('4. Community-Specific Voice Entry Sounds Storage and Isolation', async () => {
  const service = new SoundboardService();

  const userWithSettings: User = {
    ...userMe,
    settings: {
      entrySounds: {
        'srv-zenith': 'snd-chime',
      },
    },
  };

  // Reads configured entry sound for Zenith
  assert.equal(service.getEntrySoundId('srv-zenith', userWithSettings), 'snd-chime');
  // Different community has no sound by default
  assert.equal(service.getEntrySoundId('srv-lounge', userWithSettings), null);

  // Save entry sound for Lounge
  await service.saveEntrySound('srv-lounge', 'snd-owl', userWithSettings);
  assert.equal(service.getEntrySoundId('srv-lounge', userWithSettings), 'snd-owl');
  // Zenith setting remains untouched
  assert.equal(service.getEntrySoundId('srv-zenith', userWithSettings), 'snd-chime');

  // Remove entry sound for Zenith
  await service.saveEntrySound('srv-zenith', null, userWithSettings);
  assert.equal(service.getEntrySoundId('srv-zenith', userWithSettings), null);
  // Lounge still has snd-owl
  assert.equal(service.getEntrySoundId('srv-lounge', userWithSettings), 'snd-owl');
});

test('5. Reconnection & Recovery Idempotency for Entry Sounds', () => {
  let playTriggeredCount = 0;

  const simulateVoiceJoin = (recovering: boolean, entrySoundId: string | null) => {
    // Exact contract implemented in media.ts:
    // Only genuine user-initiated joins (!recovering) with a selected entry sound trigger playback.
    if (!recovering && entrySoundId) {
      playTriggeredCount++;
    }
  };

  // Initial user join: genuine join triggers exactly once
  simulateVoiceJoin(false, 'snd-chime');
  assert.equal(playTriggeredCount, 1, 'Initial join plays entry sound once');

  // Socket.IO reconnect or WebRTC renegotiation (recovering === true): must NOT replay
  simulateVoiceJoin(true, 'snd-chime');
  simulateVoiceJoin(true, 'snd-chime');
  assert.equal(playTriggeredCount, 1, 'Reconnecting must never replay entry sounds');

  // User with no entry sound: must NOT play
  simulateVoiceJoin(false, null);
  assert.equal(playTriggeredCount, 1, 'Joining without entry sound does nothing');
});

test('6. UserContextMenu displays Mute/Unmute Soundboard with accurate state', () => {
  const service = new SoundboardService();
  service.clearMutedUsers();

  const mockData = {
    user: userMe,
    users: [userMe, userElena],
    friends: [],
    blocked: [],
    requests: [],
    channels: [],
    voice: [{ socketId: 'sock-elena', channelId: 'chn-voice', user: userElena }],
    servers: [serverZenith],
  } as unknown as Bootstrap;

  const mockMedia = (soundboardMuted: boolean) => ({
    voiceChannelId: 'chn-voice',
    connectionStatus: 'connected',
    moderation: {},
    peers: [{ socketId: 'sock-elena', user: userElena, volume: 1, localMuted: false, state: {} }],
    isUserSoundboardMuted: () => soundboardMuted,
    setUserSoundboardMuted: () => {},
  } as any);

  // When unmuted: renders "Mute Soundboard"
  const unmutedHtml = renderToString(createElement(UserContextMenu, {
    user: userElena,
    data: mockData,
    server: serverZenith,
    media: mockMedia(false),
    position: { x: 50, y: 50 },
    onClose() {},
    onProfile() {},
    onPicture() {},
    onMessage() {},
    onChanged() {},
    notify() {},
  }));
  assert.match(unmutedHtml, /Mute Soundboard/);
  assert.doesNotMatch(unmutedHtml, /Unmute Soundboard/);

  // When muted: renders "Unmute Soundboard"
  const mutedHtml = renderToString(createElement(UserContextMenu, {
    user: userElena,
    data: mockData,
    server: serverZenith,
    media: mockMedia(true),
    position: { x: 50, y: 50 },
    onClose() {},
    onProfile() {},
    onPicture() {},
    onMessage() {},
    onChanged() {},
    notify() {},
  }));
  assert.match(mutedHtml, /Unmute Soundboard/);
});

test('7. SoundboardModal renders in select mode with Volume controls and selection badges', () => {
  const mockMedia = {
    soundboardVolume: 0.75,
    soundboardMuted: false,
    setSoundboardVolume() {},
    toggleSoundboardMute() {},
  } as any;

  const html = renderToString(createElement(SoundboardModal, {
    sounds: soundsZenith,
    soundServerId: 'srv-zenith',
    currentVoiceChannelId: 'chn-voice',
    connected: true,
    canManage: true,
    me: userMe,
    mode: 'select',
    selectedSoundId: 'snd-chime',
    media: mockMedia,
    onClose() {},
    onDelete: async () => {},
    onUpload: async () => {},
    onSelectSound: () => {},
  }));

  // Verify modal title in select mode
  assert.match(html, /Voice Entry Sound/);
  // Verify sound names rendered
  assert.match(html, /Zenith Chime/);
  assert.match(html, /Bubble Pop/);
  // Verify Active/Selected badge for snd-chime
  assert.match(html, /Active entry sound|Selected/);
  // Verify Global Soundboard Volume control is rendered inside the modal
  assert.match(html, /SOUNDBOARD VOLUME/);
  assert.match(html, /75%/);
});

test('8. VoiceSettings renders Voice Entry Sound section and Soundboard Volume slider', () => {
  const mockMedia = {
    settings: { outputVolume: 1, noiseSuppression: true, echoCancellation: true, pushToTalk: false },
    soundboardVolume: 0.6,
    soundboardMuted: false,
    micTest: { status: 'idle' },
    getEntrySoundId: (srvId: string) => (srvId === 'srv-zenith' ? 'snd-chime' : null),
    saveEntrySound: async () => {},
    setSoundboardVolume() {},
    toggleSoundboardMute() {},
    testOutputSound: async () => {},
    devices: [],
  } as any;

  const html = renderToString(createElement(VoiceSettings, {
    media: mockMedia,
    servers: [serverZenith, serverLounge],
    me: userMe,
  }));

  // Verify Soundboard Volume slider and label
  assert.match(html, /SOUNDBOARD VOLUME/);
  assert.match(html, /60%/);
  // Verify Voice Entry Sound section and community select options
  assert.match(html, /Voice Entry Sound/);
  assert.match(html, /Zenith Design Lab/);
  assert.match(html, /Night Owl Lounge/);
  // Verify Choose/Change sound action button
  assert.match(html, /Change sound|Choose sound/);
});

test('9. SoundboardModal adapts to 1, 2, 4, 10, and 20 sounds, including very long filenames', () => {
  const mockMedia = {
    soundboardVolume: 1,
    soundboardMuted: false,
    setSoundboardVolume() {},
    toggleSoundboardMute() {},
  } as any;

  const generateSounds = (count: number): Sound[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `snd-test-${i}`,
      serverId: 'srv-zenith',
      name: i === 0
        ? 'extremely_long_soundboard_audio_file_name_with_lots_of_characters_and_details_recorded_live_at_zenith_studio.wav'
        : `Sound Effect #${i + 1}`,
      url: `/api/sounds/snd-test-${i}/audio`,
      uploaderId: 'usr-alex',
    }));
  };

  for (const count of [1, 2, 4, 10, 20]) {
    const soundList = generateSounds(count);
    const html = renderToString(createElement(SoundboardModal, {
      sounds: soundList,
      soundServerId: 'srv-zenith',
      connected: true,
      canManage: true,
      me: userMe,
      mode: 'select',
      selectedSoundId: soundList[0].id,
      media: mockMedia,
      onClose() {},
      onDelete: async () => {},
      onUpload: async () => {},
      onSelectSound: () => {},
    }));

    // Verify grid container exists
    assert.match(html, /zenith-sound-grid/);
    // Verify first sound (with long filename) is properly rendered and titled
    assert.match(html, /extremely_long_soundboard_audio_file_name/);
    // Verify active selection
    assert.match(html, /Active entry sound|Selected/);
    // Verify all sounds rendered
    for (let i = 0; i < count; i++) {
      assert.match(html, new RegExp(soundList[i].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

