import { test, expect, type Page } from '@playwright/test';
import type { Bootstrap } from '@haven/shared/types';

const password = 'Haven-Communication-2026';
const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function register(page: Page, username: string, navigate = true) {
  if (navigate) await page.goto('/');
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill(username);
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
}

async function bootstrap(page: Page): Promise<Bootstrap> {
  const result = await page.request.get('/api/bootstrap');
  expect(result.ok()).toBe(true);
  return result.json();
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __connections: RTCPeerConnection[];
      __microphones: MediaStream[];
      __playback: HTMLAudioElement[];
      __captures: MediaStream[];
      __soundStarts: number;
    };
    state.__connections = []; state.__microphones = []; state.__playback = []; state.__captures = []; state.__soundStarts = 0;
    const OriginalConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalConnection {
      constructor(configuration?: RTCConfiguration) { super(configuration); state.__connections.push(this); }
    };
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await originalCapture(constraints);
      state.__microphones.push(stream);
      return stream;
    };
    const OriginalAudio = window.Audio;
    window.Audio = class extends OriginalAudio {
      constructor(source?: string) { super(source); state.__playback.push(this); }
    };
    const originalBufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = originalBufferSource.call(this);
      const originalStart = source.start.bind(source);
      source.start = (...parameters: Parameters<AudioBufferSourceNode['start']>) => { state.__soundStarts++; originalStart(...parameters); };
      return source;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => { context.fillStyle = `hsl(${frame++ % 360} 55% 45%)`; context.fillRect(0, 0, canvas.width, canvas.height); requestAnimationFrame(draw); };
      draw();
      const stream = canvas.captureStream(30);
      state.__captures.push(stream);
      return stream;
    };
  });
}

async function receivedAudio(page: Page) {
  return page.evaluate(async () => {
    const connections = (window as unknown as { __connections: RTCPeerConnection[] }).__connections;
    const reports = await Promise.all(connections.filter(connection => connection.connectionState !== 'closed').map(connection => connection.getStats()));
    return reports.flatMap(report => [...report.values()]).filter(report => report.type === 'inbound-rtp' && report.kind === 'audio').reduce((sum, report) => sum + (report.bytesReceived || 0), 0);
  });
}

async function receivedAudioEnergy(page: Page) {
  return page.evaluate(async () => {
    const connections = (window as unknown as { __connections: RTCPeerConnection[] }).__connections;
    const reports = await Promise.all(connections.filter(connection => connection.connectionState !== 'closed').map(connection => connection.getStats()));
    const audio = reports.flatMap(report => [...report.values()]).filter(report => report.type === 'inbound-rtp' && report.kind === 'audio' && Number.isFinite(report.totalAudioEnergy));
    if (!audio.length) throw new Error('Remote WebRTC audio-energy statistics are unavailable');
    return audio.reduce((total, report) => total + report.totalAudioEnergy, 0);
  });
}

function soundClip() {
  const rate = 16000;
  const samples = rate / 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) buffer.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 440 / rate) * 4096), 44 + sample * 2);
  return buffer;
}

test('UI invitation survives registration, friend requests update both clients, and friends exchange DMs', async ({ page, browser }) => {
  const unique = suffix();
  const ownerName = `invitea${unique}`;
  const guestName = `inviteb${unique}`;
  const communityName = `Invitation lab ${unique}`;
  await register(page, ownerName);
  await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
  await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
  await page.getByLabel('SERVER NAME').fill(communityName);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await page.getByRole('button', { name: /Invite your people/ }).click();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const inviteURL = await page.getByRole('textbox', { name: 'Invitation link', exact: true }).inputValue();
  expect(new URL(inviteURL).pathname).toMatch(/^\/invite\/[A-Za-z0-9_-]+$/);
  await expect(page.getByText('This link works on this computer only.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const owner = (await bootstrap(page)).user;
  const otherContext = await browser.newContext();
  try {
    const guest = await otherContext.newPage();
    await guest.goto(inviteURL);
    await expect(guest.getByRole('heading', { name: communityName, exact: true })).toBeVisible();
    const continueButton = guest.getByRole('button', { name: 'Continue to sign in or create an account', exact: true });
    if (await continueButton.count()) await continueButton.click();
    await register(guest, guestName, false);
    await guest.getByRole('button', { name: `Join ${communityName}`, exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Welcome to #general', exact: true })).toBeVisible();
    expect((await bootstrap(page)).user.id).toBe(owner.id);
    const guestUser = (await bootstrap(guest)).user;
    expect(guestUser.id).not.toBe(owner.id);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Add friend', exact: true }).click();
    await page.getByRole('textbox', { name: 'Friend username', exact: true }).fill(`@${guestName.toUpperCase()}`);
    await page.getByRole('button', { name: 'Send friend request', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View pending requests', exact: true })).toBeVisible();
    expect((await page.request.post('/api/friends/requests', { data: { username: guestName } })).status()).toBe(409);
    expect((await page.request.post('/api/friends/requests', { data: { username: ownerName } })).status()).toBe(400);
    await page.getByRole('button', { name: 'View pending requests', exact: true }).click();
    await guest.getByRole('button', { name: 'Home', exact: true }).click();
    await guest.getByRole('button', { name: /^Pending/ }).click();
    await guest.getByRole('button', { name: `Accept request from ${ownerName}`, exact: true }).click();
    await page.getByRole('button', { name: 'All friends', exact: true }).click();
    await expect(page.getByRole('button', { name: `Message ${guestName}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Message ${guestName}`, exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Friends can talk across independent sessions');
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
    await guest.locator('.dm-row').filter({ hasText: ownerName }).click();
    await expect(guest.getByText('Friends can talk across independent sessions', { exact: true })).toBeVisible();
    await guest.getByRole('textbox', { name: 'Message', exact: true }).fill('Reply from the browser account');
    await guest.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
    await expect(page.getByText('Reply from the browser account', { exact: true })).toBeVisible();
    expect((await guest.request.post(`/api/users/${owner.id}/block`)).ok()).toBe(true);
    await expect.poll(async () => (await bootstrap(page)).friends.includes(guestUser.id)).toBe(false);
    expect((await page.request.post('/api/friends/requests', { data: { username: guestName } })).status()).toBe(403);
    expect((await page.request.post('/api/messages', { data: { conversationId: (await bootstrap(page)).conversations.find(conversation => conversation.memberIds.includes(guestUser.id))!.id, content: 'Blocked message' } })).status()).toBe(403);
    expect((await guest.request.delete(`/api/users/${owner.id}/block`)).ok()).toBe(true);
    expect((await page.request.post('/api/friends/requests', { data: { username: guestName } })).status()).toBe(201);
    await guest.getByRole('button', { name: 'Home', exact: true }).click();
    await guest.getByRole('button', { name: /^Pending/ }).click();
    await guest.getByRole('button', { name: `Decline request from ${ownerName}`, exact: true }).click();
    await expect.poll(async () => (await bootstrap(page)).requests.length).toBe(0);
    expect((await page.request.post('/api/friends/requests', { data: { username: guestName } })).status()).toBe(201);
  } finally { await otherContext.close(); }
});

test('revoked and invalid invitations show errors without creating membership', async ({ page, browser }) => {
  const unique = suffix();
  await page.request.post('/api/auth/register', { data: { username: `revokea${unique}`, password } });
  const server = (await (await page.request.post('/api/servers', { data: { name: `Revoked ${unique}` } })).json()).server;
  const code = (await (await page.request.post(`/api/servers/${server.id}/invites`)).json()).code;
  expect((await page.request.delete(`/api/invites/${code}`)).ok()).toBe(true);
  const otherContext = await browser.newContext();
  try {
    const guest = await otherContext.newPage();
    await guest.request.post('/api/auth/register', { data: { username: `revokeb${unique}`, password } });
    await guest.goto(`/invite/${code}`);
    await expect(guest.getByRole('alert')).toContainText(/invalid|expired|revoked/i);
    expect((await bootstrap(guest)).servers).toHaveLength(0);
    expect((await guest.request.post(`/api/invites/${code}/join`)).ok()).toBe(false);
    await guest.goto(`/invite/not-an-invitation-${unique}`);
    await expect(guest.getByRole('alert')).toContainText(/invalid|expired|revoked|not found/i);
    expect((await bootstrap(guest)).servers).toHaveLength(0);
  } finally { await otherContext.close(); }
});

test('persistent community voice, microphone test playback, fullscreen streams and stop cleanup work together', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const unique = suffix();
  const ownerName = `voicea${unique}`;
  const guestName = `voiceb${unique}`;
  const communityName = `Persistent voice ${unique}`;
  await instrument(page);
  await page.request.post('/api/auth/register', { data: { username: ownerName, displayName: ownerName, password } });
  const server = (await (await page.request.post('/api/servers', { data: { name: communityName } })).json()).server;
  const code = (await (await page.request.post(`/api/servers/${server.id}/invites`)).json()).code;
  const soundResult = await page.request.post(`/api/servers/${server.id}/sounds`, { multipart: { name: 'Communication chime', file: { name: 'chime.wav', mimeType: 'audio/wav', buffer: soundClip() } } });
  expect(soundResult.ok()).toBe(true);
  const otherContext = await browser.newContext({ permissions: ['microphone'] });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const guest = await otherContext.newPage();
    guest.on('pageerror', error => errors.push(error.message));
    await instrument(guest);
    await guest.request.post('/api/auth/register', { data: { username: guestName, displayName: guestName, password } });
    await guest.request.post(`/api/invites/${code}/join`);
    await page.goto('/'); await guest.goto('/');
    await page.getByRole('button', { name: communityName, exact: true }).click();
    await guest.getByRole('button', { name: communityName, exact: true }).click();
    await page.getByRole('button', { name: 'Lounge', exact: true }).click();
    await guest.getByRole('button', { name: 'Lounge', exact: true }).click();
    await expect(page.locator('.voice-connected')).toBeVisible();
    await expect(guest.locator('.voice-roster')).toContainText(ownerName);
    await expect(page.locator('.voice-roster')).toContainText(guestName);
    await expect.poll(() => receivedAudio(guest), { timeout: 25_000 }).toBeGreaterThan(100);
    await page.getByRole('button', { name: /^Voice connection:/ }).hover();
    const diagnostics = page.getByRole('tooltip');
    await expect(diagnostics).toContainText(guestName);
    await expect(diagnostics.locator('.connection-overview strong')).toHaveText(/^\d+ ms$/, { timeout: 15_000 });
    await expect(diagnostics).toContainText('Network ICE RTT');
    await page.keyboard.press('Escape');
    await expect(diagnostics).toBeHidden();
    await expect.poll(async () => guest.locator('.voice-roster button.speaking').filter({ hasText: ownerName }).count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.locator('.persistent-voice-controls').getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect.poll(async () => (await bootstrap(guest)).voice.find(peer => peer.user.username === ownerName)?.muted).toBe(true);
    await expect(guest.locator('.voice-room-view .person-tile').filter({ hasText: ownerName }).getByText('Muted', { exact: true })).toBeVisible();
    await page.locator('.voice-connected').getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    await page.locator('.voice-connected').getByRole('button', { name: 'Deafen audio', exact: true }).click();
    await expect.poll(async () => (await bootstrap(guest)).voice.find(peer => peer.user.username === ownerName)?.deafened).toBe(true);
    await expect(guest.locator('.voice-room-view .person-tile').filter({ hasText: ownerName }).getByText('Deafened', { exact: true })).toBeVisible();
    await page.locator('.voice-connected').getByRole('button', { name: 'Undeafen audio', exact: true }).click();
    await page.getByRole('button', { name: 'general', exact: true }).click();
    await expect(page.locator('.voice-room-view')).toHaveCount(0);
    await expect(page.locator('.voice-connected')).toBeVisible();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Text navigation keeps voice connected');
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
    expect((await bootstrap(guest)).voice).toHaveLength(2);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'voice & video', exact: true }).click();
    await page.getByRole('combobox', { name: 'Noise suppression mode', exact: true }).selectOption('enhanced');
    await expect(page.getByRole('status').filter({ hasText: 'Outgoing microphone:' })).toContainText('RNNoise active', { timeout: 15_000 });
    const suppression = page.getByRole('checkbox', { name: /^Noise suppression/ });
    await suppression.uncheck();
    await expect(page.getByRole('status').filter({ hasText: 'Outgoing microphone:' })).toContainText('off');
    await suppression.check();
    await expect(page.getByRole('status').filter({ hasText: 'Outgoing microphone:' })).toContainText('RNNoise active', { timeout: 15_000 });
    await page.getByRole('combobox', { name: 'Input device', exact: true }).selectOption({ index: 1 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __microphones: MediaStream[] }).__microphones.filter(stream => stream.getTracks().some(track => track.readyState === 'live')).length)).toBe(1);
    await page.getByRole('combobox', { name: 'Noise suppression mode', exact: true }).selectOption('standard');
    await expect(page.getByRole('status').filter({ hasText: 'Outgoing microphone:' })).toContainText('browser suppression active');
    await page.getByRole('slider', { name: 'Input sensitivity', exact: true }).fill('-60');
    await page.getByRole('button', { name: "Let's Check", exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop Test', exact: true })).toBeVisible();
    await expect.poll(async () => Number(await page.locator('meter[aria-label="Microphone input level"]').getAttribute('value'))).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __playback: HTMLAudioElement[] }).__playback.some(audio => audio.volume === .3 && !audio.paused && audio.srcObject instanceof MediaStream && audio.srcObject.getAudioTracks().some(track => track.readyState === 'live')))).toBe(true);
    await page.getByRole('button', { name: 'Stop Test', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __microphones: MediaStream[] }).__microphones.filter(stream => stream.getTracks().some(track => track.readyState === 'live')).length)).toBe(1);
    await page.getByRole('button', { name: "Let's Check", exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop Test', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __microphones: MediaStream[] }).__microphones.filter(stream => stream.getTracks().some(track => track.readyState === 'live')).length)).toBe(1);
    const before = await receivedAudio(guest);
    await expect.poll(() => receivedAudio(guest)).toBeGreaterThan(before + 100);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'voice & video', exact: true }).click();
    await page.getByRole('slider', { name: 'Input volume', exact: true }).fill('0');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    let previousEnergy = await receivedAudioEnergy(guest);
    let quietSamples = 0;
    await expect.poll(async () => {
      const currentEnergy = await receivedAudioEnergy(guest);
      quietSamples = currentEnergy - previousEnergy < .000001 ? quietSamples + 1 : 0;
      previousEnergy = currentEnergy;
      return quietSamples;
    }, { intervals: [250], timeout: 10_000 }).toBeGreaterThanOrEqual(4);
    const silentEnergy = await receivedAudioEnergy(guest);
    await page.locator('.voice-connected').getByRole('button', { name: 'Soundboard', exact: true }).click();
    await page.getByRole('button', { name: 'Communication chime', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __soundStarts: number }).__soundStarts)).toBeGreaterThan(0);
    await expect.poll(() => receivedAudioEnergy(guest), { timeout: 10_000 }).toBeGreaterThan(silentEnergy + .0001);
    const soundEnergy = await receivedAudioEnergy(guest) - silentEnergy;
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'voice & video', exact: true }).click();
    await page.getByRole('slider', { name: 'Input volume', exact: true }).fill('1');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.locator('.voice-connected').getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(page.locator('.voice-connected').getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: `Watch ${ownerName}`, exact: true }).click();
    const viewer = guest.getByRole('dialog', { name: `${ownerName} stream viewer`, exact: true });
    await expect.poll(() => viewer.locator('video').evaluate(element => ({ width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight })), { timeout: 20_000 }).toEqual({ width: 960, height: 540 });
    await viewer.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement?.classList.contains('stream-viewer') || false)).toBe(true);
    await viewer.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => guest.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await viewer.getByRole('button', { name: 'Return to voice room', exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await guest.getByRole('button', { name: `Watch ${ownerName}`, exact: true }).click();
    await page.locator('.voice-connected').getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await expect(guest.getByRole('button', { name: `Watch ${ownerName}`, exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __captures: MediaStream[] }).__captures.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
    await expect(page.locator('.voice-connected')).toBeVisible(); await expect(guest.locator('.voice-connected')).toBeVisible();
    expect((await bootstrap(guest)).voice).toHaveLength(2);
    const afterStop = await receivedAudio(guest);
    await expect.poll(() => receivedAudio(guest)).toBeGreaterThan(afterStop + 100);
    await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __microphones: MediaStream[] }).__microphones.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
    await expect(guest.locator('.voice-roster')).not.toContainText(ownerName);
    await guest.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
    await expect.poll(async () => (await bootstrap(guest)).voice.length).toBe(0);
    expect(errors).toEqual([]);
    await info.attach('communication-verification', { body: JSON.stringify({ syntheticMicrophone: true, syntheticScreen: '960x540 at 30 fps', fullscreenAPI: true, actualRtp: true, audioBefore: before, audioAfterStop: afterStop, receivedSoundboardEnergyAboveSilentMicrophone: soundEnergy, hardwareAudioTested: false }, null, 2), contentType: 'application/json' });
  } finally { await otherContext.close(); }
});
