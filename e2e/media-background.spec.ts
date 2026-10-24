import { expect, test, type Page } from '@playwright/test';

interface MediaHarness {
  sockets: WebSocket[];
  connections: RTCPeerConnection[];
  microphones: MediaStream[];
  captures: MediaStream[];
  inputs: string[];
  extraMicrophone: boolean;
  cancelCapture: boolean;
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const harness: MediaHarness = { sockets: [], connections: [], microphones: [], captures: [], inputs: [], extraMicrophone: true, cancelCapture: false };
    Object.assign(window, { mediaHarness: harness });
    const OriginalSocket = window.WebSocket;
    window.WebSocket = class extends OriginalSocket {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); harness.sockets.push(this); }
    };
    const OriginalConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalConnection {
      constructor(configuration?: RTCConfiguration) { super(configuration); harness.connections.push(this); }
    };
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const audio = constraints?.audio;
      const selected = audio && typeof audio === 'object' ? audio.deviceId : undefined;
      const id = typeof selected === 'object' && 'exact' in selected ? String(selected.exact) : '';
      harness.inputs.push(id);
      const stream = await originalCapture(id === 'test-hotplug' ? { ...constraints, audio: { ...(audio as MediaTrackConstraints), deviceId: undefined } } : constraints);
      harness.microphones.push(stream);
      return stream;
    };
    const originalDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const devices = await originalDevices();
      if (harness.extraMicrophone) devices.push({ deviceId: 'test-hotplug', groupId: 'test-group', kind: 'audioinput', label: 'Hotplug test microphone', toJSON() { return {}; } });
      return devices;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (harness.cancelCapture) throw new DOMException('User cancelled the source picker', 'AbortError');
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#aabbcc'; context.fillRect(0, 0, 960, 540);
      const stream = canvas.captureStream(15);
      let frame = 0;
      const animation = setInterval(() => { context.fillStyle = frame++ % 2 ? '#aabbcc' : '#bbaacc'; context.fillRect(0, 0, 960, 540); }, 200);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(animation), { once: true });
      harness.captures.push(stream);
      return stream;
    };
  });
}

async function setup(page: Page, name: string) {
  await instrument(page);
  const username = `${name}${Date.now().toString(36)}`;
  expect((await page.request.post('/api/auth/register', { data: { username, password: 'Media-Background-2026' } })).ok()).toBe(true);
  const server = (await (await page.request.post('/api/servers', { data: { name: username } })).json()).server;
  await page.goto('/');
  await page.getByRole('button', { name: username, exact: true }).click();
  await page.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect(page.locator('.voice-connected')).toBeVisible();
  return server;
}

async function audioReceived(page: Page) {
  return page.evaluate(async () => {
    const harness = (window as unknown as { mediaHarness: MediaHarness }).mediaHarness;
    const reports = await Promise.all(harness.connections.filter(connection => connection.connectionState === 'connected').map(connection => connection.getStats()));
    return reports.flatMap(report => [...report.values()]).filter(report => report.type === 'inbound-rtp' && report.kind === 'audio').reduce((sum, report) => sum + (report.bytesReceived ?? 0), 0);
  });
}

test('cancelling capture preserves voice, socket reconnect preserves active capture, and mute/deafen survive reload', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = await setup(page, 'reconnect');
  const guest = await browser.newPage({ permissions: ['microphone'] });
  try {
  await instrument(guest);
  const username = `reconnectguest${Date.now().toString(36)}`;
  expect((await guest.request.post('/api/auth/register', { data: { username, password: 'Media-Background-2026' } })).ok()).toBe(true);
  const code = (await (await page.request.post(`/api/servers/${server.id}/invites`)).json()).code;
  expect((await guest.request.post(`/api/invites/${code}/join`)).ok()).toBe(true);
  await guest.goto('/');
  await guest.getByRole('button', { name: server.name, exact: true }).click();
  await guest.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect.poll(() => audioReceived(guest)).toBeGreaterThan(100);
  const encoding = await page.evaluate(() => {
    const connection = (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.connections.find(connection => connection.connectionState === 'connected')!;
    const sender = connection.getSenders().find(sender => sender.track?.kind === 'audio')!;
    return { bitrate: sender.getParameters().encodings[0].maxBitrate, sdp: connection.localDescription?.sdp ?? '' };
  });
  expect(encoding.bitrate).toBe(48_000);
  expect(encoding.sdp).toContain('usedtx=1');
  expect(encoding.sdp).toContain('useinbandfec=1');
  await page.evaluate(() => { (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.cancelCapture = true; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).first().click();
  await expect(page.locator('.voice-connected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.microphones[0].active)).toBe(true);
  await page.evaluate(() => { (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.cancelCapture = false; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true }).first()).toBeVisible();
  const channelId = (await (await page.request.get('/api/bootstrap')).json()).voice[0].channelId;
  await guest.getByRole('button', { name: 'Watch Stream', exact: true }).click();
  await expect.poll(() => guest.locator('video').evaluateAll(videos => videos.some(video => (video as HTMLVideoElement).videoWidth > 0))).toBe(true);
  const previousConnections = await page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.connections.length);
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.sockets.some(socket => socket.readyState === WebSocket.OPEN))).toBe(true);
  await page.evaluate(() => { (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.sockets.filter(socket => socket.readyState === WebSocket.OPEN).forEach(socket => socket.close()); });
  await expect.poll(async () => {
    const response = await page.request.get('/api/bootstrap');
    const data = await response.json();
    return data.voice.some((peer: { channelId: string; sharing: boolean }) => peer.channelId === channelId && peer.sharing);
  }, { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.sockets.filter(socket => socket.readyState === WebSocket.OPEN).length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.connections.length)).toBeGreaterThan(previousConnections);
  await expect.poll(() => guest.locator('video').evaluateAll(videos => videos.some(video => (video as HTMLVideoElement).videoWidth > 0))).toBe(true);
  await expect.poll(() => audioReceived(guest)).toBeGreaterThan(100);
  const before = await audioReceived(guest);
  await expect.poll(() => audioReceived(guest)).toBeGreaterThan(before + 100);
  expect(await page.evaluate(() => {
    const harness = (window as unknown as { mediaHarness: MediaHarness }).mediaHarness;
    return { captures: harness.captures.length, captureLive: harness.captures[0].active, microphones: harness.microphones.length, micLive: harness.microphones[0].active };
  })).toEqual({ captures: 1, captureLive: true, microphones: 1, micLive: true });
  await page.locator('.persistent-voice-controls').getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await page.locator('.voice-connected').getByRole('button', { name: 'Deafen audio', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: server.name, exact: true }).click();
  await page.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect(page.locator('.voice-connected').getByRole('button', { name: 'Unmute microphone', exact: true })).toBeVisible();
  await expect(page.locator('.voice-connected').getByRole('button', { name: 'Undeafen audio', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  } finally { await guest.close(); }
});

test('device labels, switching, unplug fallback and microphone test changes release superseded captures', async ({ page }) => {
  await setup(page, 'devices');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'voice & video', exact: true }).click();
  const input = page.locator('select').filter({ has: page.locator('option', { hasText: 'Hotplug test microphone' }) });
  await expect(input).toHaveCount(1);
  await input.selectOption('test-hotplug');
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.inputs.at(-1))).toBe('test-hotplug');
  await page.getByRole('button', { name: "Let's Check", exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop Test', exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Input volume', exact: true }).fill('0.6');
  await page.getByRole('slider', { name: 'Input sensitivity', exact: true }).fill('-55');
  await page.evaluate(() => {
    const harness = (window as unknown as { mediaHarness: MediaHarness }).mediaHarness;
    harness.extraMicrophone = false;
    harness.microphones.filter(stream => stream.active).forEach(stream => stream.getAudioTracks().forEach(track => { track.stop(); track.dispatchEvent(new Event('ended')); }));
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('haven.media.settings')!).inputDevice)).toBe('');
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.microphones.filter(stream => stream.active).length)).toBe(2);
  await page.getByRole('button', { name: 'Stop Test', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.microphones.filter(stream => stream.active).length)).toBe(1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('haven.media.settings')!);
    return { inputDevice: saved.inputDevice, inputVolume: saved.inputVolume, inputSensitivity: saved.inputSensitivity };
  })).toEqual({ inputDevice: '', inputVolume: 0.6, inputSensitivity: -55 });
});

test('browser push-to-talk applies combinations, rejects conflicts and gaming mode persists', async ({ page }) => {
  await setup(page, 'shortcuts');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'voice & video', exact: true }).click();
  await page.getByRole('switch', { name: /^Push to talk/ }).check();
  await page.getByRole('button', { name: 'desktop & gaming', exact: true }).click();
  const transmitting = () => page.evaluate(() => (window as unknown as { mediaHarness: MediaHarness }).mediaHarness.microphones.filter(stream => stream.active).some(stream => stream.getAudioTracks().some(track => track.enabled)));
  const recorder = page.getByRole('button', { name: 'Push-to-talk shortcut', exact: true });
  await recorder.click();
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Space');
  expect(await transmitting()).toBe(false);
  await page.keyboard.up('Space'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await expect(recorder).toHaveAttribute('aria-pressed', 'false');
  await recorder.click();
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('alert')).toContainText('conflicts');
  await page.keyboard.press('Escape');
  await expect(recorder).toContainText('Control+Shift+Space');
  await recorder.click();
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('V');
  await page.keyboard.up('V'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await expect(recorder).toContainText('Control+Shift+V');
  await page.getByRole('button', { name: 'Apply shortcut', exact: true }).click();
  await expect(page.getByText('Push-to-talk shortcut applied', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Low-resource gaming mode', exact: true }).check();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(await transmitting()).toBe(false);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('V');
  await expect.poll(transmitting).toBe(true);
  await page.keyboard.press('E');
  expect(await transmitting()).toBe(true);
  await page.keyboard.up('Shift');
  await expect.poll(transmitting).toBe(false);
  await page.keyboard.up('V'); await page.keyboard.up('Control');
  await page.reload();
  expect(await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('haven.media.settings')!);
    return { pushToTalk: settings.pushToTalk, pushToTalkKey: settings.pushToTalkKey, gamingMode: settings.gamingMode };
  })).toEqual({ pushToTalk: true, pushToTalkKey: 'Control+Shift+V', gamingMode: true });
});
