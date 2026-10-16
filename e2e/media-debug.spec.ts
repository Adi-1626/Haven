import { test, expect, type Page } from '@playwright/test';

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    const events: unknown[] = [];
    (window as any).__mediaEvents = events;
    (window as any).__connections = [];
    window.RTCPeerConnection = class extends Original {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        (window as any).__connections.push(this);
        for (const name of ['signalingstatechange', 'iceconnectionstatechange', 'connectionstatechange', 'icegatheringstatechange', 'negotiationneeded', 'track', 'icecandidate']) {
          this.addEventListener(name, event => events.push({ event: name, time: performance.now(), signaling: this.signalingState, ice: this.iceConnectionState, connection: this.connectionState, candidate: (event as RTCPeerConnectionIceEvent).candidate?.toJSON(), track: (event as RTCTrackEvent).track?.kind }));
        }
      }
      async setLocalDescription(description?: RTCLocalSessionDescriptionInit) {
        events.push({ method: 'setLocalDescription', description, state: this.signalingState, time: performance.now() });
        try { await super.setLocalDescription(description); events.push({ method: 'local-complete', description: this.localDescription?.toJSON(), time: performance.now() }); }
        catch (error) { events.push({ method: 'local-error', error: String(error), time: performance.now() }); throw error; }
      }
      async setRemoteDescription(description: RTCSessionDescriptionInit) {
        events.push({ method: 'setRemoteDescription', description, state: this.signalingState, time: performance.now() });
        try { await super.setRemoteDescription(description); events.push({ method: 'remote-complete', time: performance.now() }); }
        catch (error) { events.push({ method: 'remote-error', error: String(error), time: performance.now() }); throw error; }
      }
      async addIceCandidate(candidate?: RTCIceCandidateInit | null) {
        events.push({ method: 'addIceCandidate', candidate, time: performance.now() });
        try { await super.addIceCandidate(candidate); }
        catch (error) { events.push({ method: 'candidate-error', error: String(error), time: performance.now() }); throw error; }
      }
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      (window as any).__captureCanvas = canvas;
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => {
        context.fillStyle = `hsl(${frame++ % 360} 45% 35%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        requestAnimationFrame(draw);
      };
      draw();
      return canvas.captureStream(60);
    };
  });
}

test('repeated voice joins, screen source resizing and stopped-share cleanup', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  const suffix = Date.now().toString().slice(-8);
  await page.request.post('/api/auth/register', { data: { username: `debuga${suffix}`, displayName: 'Debug A', password: 'Password123456' } });
  const serverResult = await page.request.post('/api/servers', { data: { name: 'Debug voice' } });
  const server = (await serverResult.json()).server;
  const invitation = await page.request.post(`/api/servers/${server.id}/invites`);
  const code = (await invitation.json()).code;
  const context = await browser.newContext({ permissions: ['microphone'] });
  const second = await context.newPage();
  await second.request.post('/api/auth/register', { data: { username: `debugb${suffix}`, displayName: 'Debug B', password: 'Password123456' } });
  await second.request.post(`/api/invites/${code}/join`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`A: ${error.message}`));
  second.on('pageerror', error => errors.push(`B: ${error.message}`));
  await instrument(page);
  await instrument(second);
  await page.goto('/');
  await second.goto('/');
  await page.getByRole('button', { name: 'Debug voice', exact: true }).click();
  await second.getByRole('button', { name: 'Debug voice', exact: true }).click();
  await expect(page.locator('.my-profile')).toContainText('Online');
  await expect(second.locator('.my-profile')).toContainText('Online');
  try {
    for (let iteration = 0; iteration < 4; iteration++) {
      await page.getByRole('button', { name: 'Lounge', exact: true }).click();
      await expect(page.locator('.voice-connected')).toBeVisible();
      await second.getByRole('button', { name: 'Lounge', exact: true }).click();
      await expect(second.locator('.voice-connected')).toBeVisible();
      await expect.poll(async () => second.evaluate(async () => {
        const connections = (window as any).__connections as RTCPeerConnection[];
        const reports = await Promise.all(connections.filter(connection => connection.connectionState !== 'closed').map(connection => connection.getStats()));
        return reports.flatMap(report => [...report.values()]).filter(report => report.type === 'inbound-rtp' && report.kind === 'audio').reduce((sum, report) => sum + report.bytesReceived, 0);
      }), { timeout: 20_000 }).toBeGreaterThan(100);
      await page.getByRole('button', { name: 'Share screen', exact: true }).first().click();
      await expect.poll(async () => second.locator('video').evaluateAll(videos => videos.map(video => (video as HTMLVideoElement).videoHeight)), { timeout: 15_000 }).toEqual([720]);
      if (iteration === 0) {
        await page.evaluate(() => { const canvas = (window as any).__captureCanvas as HTMLCanvasElement; canvas.width = 640; canvas.height = 360; });
        await expect(page.locator('.stream-summary')).toContainText('640 × 360');
        await expect.poll(async () => second.locator('video').evaluateAll(videos => videos.map(video => (video as HTMLVideoElement).videoHeight)), { timeout: 15_000 }).toEqual([360]);
        await page.evaluate(() => { const canvas = (window as any).__captureCanvas as HTMLCanvasElement; canvas.width = 1920; canvas.height = 1080; });
        await expect(page.locator('.stream-summary')).toContainText('1920 × 1080');
        await expect.poll(async () => second.locator('video').evaluateAll(videos => videos.map(video => (video as HTMLVideoElement).videoHeight)), { timeout: 15_000 }).toEqual([1080]);
      }
      await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
      await expect(second.locator('video')).toHaveCount(0);
      await expect(second.locator('.call-header')).toContainText('2 connected');
      await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
      await second.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
    }
    expect(errors).toEqual([]);
  } finally {
    for (const [label, target] of [['A', page], ['B', second]] as const) {
      const diagnostics = await target.evaluate(async () => ({ events: (window as any).__mediaEvents, connections: await Promise.all(((window as any).__connections as RTCPeerConnection[]).map(async connection => ({ signaling: connection.signalingState, ice: connection.iceConnectionState, state: connection.connectionState, local: connection.localDescription?.toJSON(), remote: connection.remoteDescription?.toJSON(), stats: [...(await connection.getStats()).values()] }))), toast: document.querySelector('[role=status]')?.textContent }));
      await info.attach(`media-${label}.json`, { body: JSON.stringify({ errors, ...diagnostics }, null, 2), contentType: 'application/json' });
    }
    await context.close();
  }
});
