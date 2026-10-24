import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createScreenTransport } from './screen-transport';
import VoicePanel from './VoicePanel';
import UserContextMenu from './UserContextMenu';
import type { useMedia } from './media';
import type { User, Bootstrap } from '@haven/shared/types';

// Driver-boundary tests only. Real SDP and lifecycle coverage is in
// e2e/stream-subscriptions.spec.ts, using Chromium and the actual hook/server.
function transport() {
  const lanes: any[] = [];
  const connection = {
    signalingState: 'stable',
    addTransceiver(kind: string, options: object) {
      const lane = { kind, ...options, sender: { track: null as unknown, async replaceTrack(track: unknown) { this.track = track; } } };
      lanes.push(lane);
      return lane;
    },
  };
  return { lanes, screen: createScreenTransport(connection as unknown as RTCPeerConnection) };
}
const capture = () => ({ getVideoTracks: () => [{ kind: 'video' }], getAudioTracks: () => [{ kind: 'audio' }] }) as unknown as MediaStream;

test('screen lanes remain fixed through 100 viewing cycles without changing receive directions', async () => {
  const { screen, lanes } = transport();
  for (let i = 0; i < 100; i++) {
    await screen.setStream(capture());
    assert.ok(screen.video.sender.track);
    await screen.setStream(null);
    assert.equal(screen.video.sender.track, null);
    assert.equal(screen.audio.sender.track, null);
  }
  assert.equal(lanes.length, 2);
  assert.ok(lanes.every(lane => lane.direction === 'sendrecv'));
});

test('rapid attachment cancellation coalesces to stopped and close cancels queued work', async () => {
  const { screen } = transport();
  await Promise.all([screen.setStream(capture()), screen.setStream(null), screen.setStream(capture()), screen.setStream(null)]);
  assert.equal(screen.video.sender.track, null);
  assert.equal(screen.audio.sender.track, null);
  const pending = screen.setStream(capture());
  screen.close();
  await pending;
  assert.equal(screen.video.sender.track, null);
});

test('stopping one sending lane leaves the independent broadcaster untouched', async () => {
  const a = transport(), b = transport();
  await a.screen.setStream(capture());
  await b.screen.setStream(capture());
  await a.screen.setStream(null);
  assert.ok(b.screen.video.sender.track);
  assert.equal(b.screen.video.direction, 'sendrecv');
});

test('answerer adopts the offered lanes instead of creating extra SDP sections', async () => {
  const offerer = transport();
  const connection = { signalingState: 'stable', addTransceiver() { throw new Error('must adopt'); } };
  const answerer = createScreenTransport(connection as unknown as RTCPeerConnection, { video: offerer.screen.video, audio: offerer.screen.audio });
  await answerer.setStream(capture());
  assert.equal(answerer.video, offerer.screen.video);
  assert.equal(offerer.lanes.length, 2);
});

const me = { id: 'me', username: 'me', displayName: 'Me' } as User;
const streamer = { id: 'streamer', username: 'streamer', displayName: 'Streamer' } as User;
function mediaFixture(watching: boolean) {
  return {
    voiceChannelId: 'room', connectionStatus: 'connected', moderation: {},
    peers: [{ socketId: 'peer', user: streamer, state: { sharing: true }, volume: 1,
      stream: watching ? { getVideoTracks: () => [{ readyState: 'live' }] } : null }],
    watchingStreams: watching ? ['peer'] : [], isWatchingStream: () => watching,
    streamError: () => undefined, screenStream: null,
  } as unknown as ReturnType<typeof useMedia>;
}

test('Watch Stream renders an embedded stage with a separate explicit fullscreen action', () => {
  const render = (watching: boolean) => renderToString(createElement(VoicePanel, {
    media: mediaFixture(watching), me, onQuality() {}, onSounds() {}, onWatch() {}, onProfile() {}, onUserContext() {},
  }));
  assert.match(render(false), /stream-available-bar/);
  const html = render(true);
  assert.match(html, /screen-theater-card/);
  assert.match(html, /stream-fullscreen-btn/);
  assert.match(html, /Stop Watching/);
  assert.doesNotMatch(html, /zenith-fullscreen-stream/);
});

test('menu uses the MenuPosition contract and renders Watch versus Stop Watching without server portals', () => {
  const data = { user: me, users: [me, streamer], friends: [], blocked: [], requests: [], channels: [], voice: [], servers: [] } as unknown as Bootstrap;
  const render = (watching: boolean) => renderToString(createElement(UserContextMenu, {
    user: streamer, data, media: mediaFixture(watching), position: { x: 100, y: 100 },
    onClose() {}, onProfile() {}, onPicture() {}, onMessage() {}, onChanged() {}, notify() {}, onWatch() {}, onStopWatching() {},
  }));
  assert.match(render(false), /Watch Stream/);
  assert.doesNotMatch(render(false), /Stop Watching/);
  assert.match(render(true), /Stop Watching/);
  assert.match(render(true), /View Stream/);
});
