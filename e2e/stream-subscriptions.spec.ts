import { test, expect, type Browser, type Page, type BrowserContext } from '@playwright/test';
import { streamFixture, instrumentMedia, metrics, apiOrigin, probeOrigin } from './stream-fixture';

let fixture: Awaited<ReturnType<typeof streamFixture>>;
test.beforeAll(async () => { fixture = await streamFixture(); });
test.afterAll(async () => { await fixture?.close(); });

async function group(browser: Browser, count: number) {
  const contexts: BrowserContext[] = [], pages: Page[] = [], userIds: string[] = [];
  let room = '', otherRoom = '', invite = '';
  const name = `Streams ${Date.now()}`;
  for (let index = 0; index < count; index++) {
    const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
    const response = await context.request.post(`${apiOrigin}/api/auth/register`, { data: { username: `streams${index}${Date.now()}`, displayName: `Person ${index}`, password: 'Stream-regression-2026' } });
    expect(response.status()).toBe(201); const { user } = await response.json(); userIds.push(user.id);
    if (!index) {
      const { server } = await (await context.request.post(`${apiOrigin}/api/servers`, { data: { name } })).json();
      const bootstrap = await (await context.request.get(`${apiOrigin}/api/bootstrap`)).json();
      room = bootstrap.channels.find((channel: any) => channel.type === 'voice').id;
      invite = (await (await context.request.post(`${apiOrigin}/api/servers/${server.id}/invites`)).json()).code;
      otherRoom = (await (await context.request.post(`${apiOrigin}/api/servers/${server.id}/channels`, { data: { name: 'Alternate', type: 'voice' } })).json()).channel.id;
    } else expect((await context.request.post(`${apiOrigin}/api/invites/${invite}/join`)).ok()).toBe(true);
    const page = await context.newPage(); pages.push(page); await instrumentMedia(page, user.id);
    await page.goto(`${probeOrigin}/probe`); await page.waitForFunction(() => window.qa.media && window.qa.socket.connected);
    await page.evaluate(room => window.qa.media.join(room), room);
  }
  return { pages, contexts, userIds, room, otherRoom, name, close: () => Promise.all(contexts.map(context => context.close())) };
}
const socketId = (page: Page) => page.evaluate(() => window.qa.socket.id as string);
async function watch(page: Page, id: string) {
  await page.evaluate(id => window.qa.media.watchStream(id), id);
  try {
    await expect.poll(async () => (await metrics(page)).peers.find((p: any) => p.id === id)?.video).toBe(1);
  } catch (error) {
    console.log('Watch failure', JSON.stringify(await metrics(page)));
    console.log('Lanes', JSON.stringify(await page.evaluate(() => window.qa.media.connectionStatsSources().map((s: any) => ({ id: s.socketId, state: s.connection.connectionState, lanes: s.connection.getTransceivers().map((t: RTCRtpTransceiver) => ({ mid: t.mid, direction: t.currentDirection, sending: t.sender.track?.kind, receiving: t.receiver.track.kind, muted: t.receiver.track.muted })) })))));
    throw error;
  }
}
async function stopWatching(page: Page, id: string) {
  await page.evaluate(id => window.qa.media.stopWatchingStream(id), id);
  await expect.poll(async () => (await metrics(page)).watching.includes(id)).toBe(false);
}

test('four real clients: independent broadcasts, repeated subscriptions, audio controls, recovery and cleanup', async ({ browser }, info) => {
  const users = await group(browser, 4); const [a, b, c, d] = users.pages;
  try {
    await expect.poll(async () => (await metrics(a)).peers.length).toBe(3);
    await expect.poll(async () => (await metrics(c)).audio).toBeGreaterThan(100);
    let [aid, bid] = await Promise.all([socketId(a), socketId(b)]);
    await a.evaluate(() => window.qa.media.startShare()); await b.evaluate(() => window.qa.media.startShare());
    await d.evaluate(() => window.qa.media.leave());
    await d.evaluate(room => window.qa.media.join(room), users.room);
    expect((await metrics(d)).watching).toEqual([]);
    expect((await metrics(a)).sentVideo).toBe(0);
    expect((await metrics(b)).sentVideo).toBe(0);
    expect((await metrics(c)).watching).toEqual([]);
    await watch(c, aid); await watch(d, bid); await watch(a, bid); await watch(b, aid);
    await watch(c, bid);
    const voiceBefore = (await metrics(c)).audio;
    const bFrames = (await metrics(a, bid)).video;
    await stopWatching(b, aid);
    await expect.poll(async () => (await metrics(a, bid)).video).toBeGreaterThan(bFrames + 3);
    expect((await metrics(b)).peers.find((p: any) => p.id === aid)?.video).toBe(0);
    // No SDP growth, renegotiation, or microphone interruption during repeated viewing.
    const lanes = (await metrics(c, aid)).lanes;
    for (let i = 0; i < 12; i++) { await stopWatching(c, aid); await watch(c, aid); }
    expect((await metrics(c, aid)).lanes).toEqual(lanes);
    expect(lanes).toEqual([3]);
    // Duplicate clicks and overlapping subscribe/cancel packets must converge without extra lanes.
    await c.evaluate(id => {
      for (let i = 0; i < 10; i++) {
        window.qa.media.stopWatchingStream(id);
        window.qa.media.watchStream(id);
        window.qa.media.watchStream(id);
      }
    }, aid);
    await expect.poll(async () => (await metrics(c)).peers.find((p: any) => p.id === aid)?.video).toBe(1);
    expect((await metrics(c, aid)).lanes).toEqual(lanes);
    // Exercise real simultaneous ICE restart offers and perfect-negotiation glare handling.
    const cId = await socketId(c);
    await Promise.all([
      a.evaluate(id => window.qa.media.connectionStatsSources().find((s: any) => s.socketId === id).connection.restartIce(), cId),
      c.evaluate(id => window.qa.media.connectionStatsSources().find((s: any) => s.socketId === id).connection.restartIce(), aid),
    ]);
    const beforeRestart = (await metrics(c, aid)).video;
    await expect.poll(async () => (await metrics(c, aid)).video).toBeGreaterThan(beforeRestart + 3);
    await expect.poll(async () => (await metrics(c)).audio).toBeGreaterThan(voiceBefore + 100);
    await c.evaluate(id => window.qa.showViewer(id), aid);
    const viewer = c.getByRole('dialog', { name: 'Remote stream viewer' });
    await expect(viewer.locator('video')).toHaveJSProperty('muted', true);
    await viewer.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect.poll(() => c.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await b.evaluate(() => window.qa.media.toggleMute());
    await expect.poll(() => c.evaluate(() => window.qa.media.peers.some((p: any) => p.state.muted))).toBe(true);
    expect(await c.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await viewer.getByRole('button', { name: 'Deafen audio', exact: true }).click();
    expect(await c.evaluate(() => window.qa.audios.filter((a: HTMLAudioElement) => a.srcObject).every((a: HTMLAudioElement) => a.muted))).toBe(true);
    expect(await c.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await viewer.getByRole('button', { name: 'Undeafen incoming audio', exact: true }).click();
    await viewer.getByRole('slider', { name: 'Stream volume' }).fill('0.25');
    await c.evaluate(id => window.qa.media.setUserVolume(window.qa.media.peers.find((p: any) => p.socketId === id).user.id, 0.4), aid);
    const volumes = await c.evaluate(id => {
      const pc = window.qa.media.connectionStatsSources().find((s: any) => s.socketId === id).connection as RTCPeerConnection;
      return pc.getTransceivers().filter(t => t.receiver.track.kind === 'audio').map(t => window.qa.audios.find((a: HTMLAudioElement) => (a.srcObject as MediaStream | null)?.getAudioTracks()[0]?.id === t.receiver.track.id)?.volume);
    }, aid);
    expect(volumes[0]).toBeCloseTo(0.4); expect(volumes[1]).toBeCloseTo(0.1);
    await c.evaluate(id => window.qa.media.setUserLocallyMuted(id, true), users.userIds[0]);
    expect(await c.evaluate(() => document.querySelector<HTMLVideoElement>('video')?.muted)).toBe(true);
    await c.evaluate(id => window.qa.media.setUserLocallyMuted(id, false), users.userIds[0]);
    // Physical browser key events exercise PTT without touching captured system audio.
    await d.evaluate(() => window.qa.media.setSettings({ pushToTalk: true, pushToTalkKey: 'Control+Shift+Space', gamingMode: true, voiceBitrateKbps: 32 }));
    const micEnabled = () => d.evaluate(() => window.qa.media.connectionStatsSources()[0].connection.getSenders()[0].track.enabled);
    await expect.poll(micEnabled).toBe(false);
    await d.keyboard.down('Control'); await d.keyboard.down('Shift'); await d.keyboard.down('Space');
    await expect.poll(micEnabled).toBe(true);
    await d.keyboard.up('Shift'); await expect.poll(micEnabled).toBe(false);
    await d.keyboard.up('Space'); await d.keyboard.up('Control');
    expect(await d.evaluate(() => window.qa.media.connectionStatsSources()[0].connection.getSenders()[0].getParameters().encodings[0].maxBitrate)).toBeLessThanOrEqual(32_000);
    await d.evaluate(() => window.qa.media.setSettings({ pushToTalk: false }));
    await c.keyboard.press('Escape');
    await expect.poll(() => c.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(viewer).toBeVisible(); await c.keyboard.press('Escape'); await expect(viewer).toHaveCount(0);
    // D has explicitly stopped B: a reconnect must not restore that dismissed intention.
    await stopWatching(d, bid); await watch(d, aid);
    const oldViewerIds = await Promise.all([socketId(c), socketId(d)]);
    await Promise.all([c.evaluate(() => window.qa.socket.io.engine.close()), d.evaluate(() => window.qa.socket.io.engine.close())]);
    for (const [index, page] of [c, d].entries()) await expect.poll(() => page.evaluate(old => window.qa.media.connectionStatus === 'connected' && !!window.qa.socket.id && window.qa.socket.id !== old, oldViewerIds[index])).toBe(true);
    await expect.poll(async () => (await metrics(c)).peers.filter((p: any) => p.video).length).toBe(2);
    await expect.poll(async () => (await metrics(d)).peers.filter((p: any) => p.video).length).toBe(1);
    expect((await metrics(d)).watching).toEqual([aid]);
    // Rebinding by broadcast identity survives the broadcaster's socket changing too.
    await a.evaluate(() => window.qa.socket.io.engine.close());
    await expect.poll(() => a.evaluate(old => window.qa.media.connectionStatus === 'connected' && !!window.qa.socket.id && window.qa.socket.id !== old, aid)).toBe(true); aid = await socketId(a);
    await expect.poll(async () => (await metrics(c)).watching.includes(aid)).toBe(true);
    await expect.poll(async () => (await metrics(c)).peers.find((p: any) => p.id === aid)?.video).toBe(1);
    expect((await metrics(b)).watching).toEqual([]);
    // A genuinely new capture requires fresh consent, even with the same user/socket.
    const oldBroadcast = (await metrics(c)).peers.find((p: any) => p.id === aid).broadcastId;
    await a.evaluate(() => window.qa.media.stopShare());
    await expect.poll(async () => (await metrics(c)).watching.includes(aid)).toBe(false);
    await a.evaluate(() => window.qa.media.startShare());
    await expect.poll(async () => (await metrics(c)).peers.find((p: any) => p.id === aid)?.broadcastId).not.toBe(oldBroadcast);
    expect((await metrics(c)).watching.includes(aid)).toBe(false);
    await watch(c, aid);
    await a.evaluate(async () => { const canvas = window.qa.canvases.at(-1); canvas.width = 1280; canvas.height = 720; await window.qa.media.setShareQuality('native', 30, 4); });
    await expect.poll(() => c.evaluate(id => {
      const pc = window.qa.media.connectionStatsSources().find((s: any) => s.socketId === id).connection;
      return pc.getStats().then((r: RTCStatsReport) => [...r.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'video')?.frameWidth);
    }, aid)).toBe(1280);
    await d.evaluate(room => window.qa.media.join(room), users.otherRoom);
    expect((await metrics(d)).watching).toEqual([]);
    await d.evaluate(async () => { window.qa.captureDenied = true; await window.qa.media.startShare(); });
    expect(await d.evaluate(() => window.qa.media.sharing)).toBe(false);
    // A real backend process lifecycle, with persistent disposable SQLite sessions.
    await fixture.restart();
    await expect.poll(() => a.evaluate(() => window.qa.media.connectionStatus), { timeout: 25_000 }).toBe('connected');
    await expect.poll(async () => (await metrics(c)).peers.filter((p: any) => p.video).length, { timeout: 25_000 }).toBe(2);
    expect((await metrics(d)).watching).toEqual([]);
    for (const page of users.pages) {
      expect((await metrics(page)).errors).toEqual([]);
      await page.evaluate(() => { window.qa.media.leave(); window.qa.root.unmount(); });
      expect(await page.evaluate(() => window.qa.connections.every((p: RTCPeerConnection) => p.connectionState === 'closed'))).toBe(true);
      expect(await page.evaluate(() => window.qa.connections.every((p: RTCPeerConnection) => !p.ontrack && !p.onicecandidate && !p.onnegotiationneeded && !p.onconnectionstatechange && p.getTransceivers().every(t => t.receiver.track.readyState === 'ended')))).toBe(true);
      expect(await page.evaluate(() => [...window.qa.captures, ...window.qa.microphones].every((s: MediaStream) => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
      expect(await page.evaluate(() => window.qa.socket.listeners('voice:signal').length)).toBe(0);
    }
    await info.attach('real-webrtc', { body: JSON.stringify({ clients: 4, actualRtp: true, syntheticCapture: true, viewingCycles: 12, transceiversPerPeer: lanes[0], viewerAndStreamerReconnect: true, backendRestart: true }), contentType: 'application/json' });
  } finally { await users.close(); }
});

test('real application Watch buttons all stay embedded; Stop Watching and explicit fullscreen remain separate', async ({ browser }) => {
  const users = await group(browser, 2); const [owner, viewer] = users.pages;
  try {
    for (const page of users.pages) {
      await page.goto(apiOrigin);
      await page.getByRole('button', { name: users.name, exact: true }).click();
      await page.getByRole('button', { name: 'Lounge', exact: true }).click();
      await expect(page.locator('.voice-room-view')).toBeVisible();
    }
    await owner.getByRole('button', { name: 'Share screen', exact: true }).first().click();
    const embedded = async () => {
      await expect.poll(() => viewer.locator('.remote-screen video').evaluateAll(videos => videos.some(v => (v as HTMLVideoElement).videoWidth > 0)) ).toBe(true);
      await expect(viewer.locator('.stream-viewer')).toHaveCount(0);
      expect(await viewer.evaluate(() => !!document.fullscreenElement)).toBe(false);
    };
    await viewer.locator('.stream-available-bar .stream-watch-btn').click(); await embedded();
    await viewer.getByRole('button', { name: 'Stop Watching', exact: true }).click();
    await viewer.getByRole('tab', { name: /Streams/ }).click();
    await viewer.locator('.placeholder-watch-btn').click(); await embedded();
    await viewer.getByRole('button', { name: 'Stop Watching', exact: true }).click();
    await viewer.getByRole('tab', { name: /Participants/ }).click();
    await viewer.locator('.voice-room-view .person-tile').filter({ hasText: 'Person 0' }).click({ button: 'right' });
    await viewer.getByRole('menuitem', { name: 'Watch Stream', exact: true }).click(); await embedded();
    await viewer.locator('.stream-fullscreen-btn').click();
    await expect(viewer.locator('.stream-viewer video')).toHaveJSProperty('muted', true);
    await viewer.locator('.stream-viewer').getByRole('button', { name: 'Stop Watching', exact: true }).first().click();
    await expect(viewer.locator('.stream-viewer')).toHaveCount(0);
    await expect(viewer.locator('.remote-screen video')).toHaveCount(0);
    await expect(owner.getByRole('button', { name: 'Stop sharing', exact: true }).first()).toBeVisible();
  } finally { await users.close(); }
});

test('unsupported backend and missing subscription acknowledgment report errors while voice remains connected', async ({ browser }) => {
  const users = await group(browser, 2); const [a, b] = users.pages;
  try {
    await a.evaluate(() => window.qa.media.startShare()); const aid = await socketId(a);
    const serverSocket = fixture.backend.io.sockets.sockets.get(await socketId(b))!;
    const handler = serverSocket.listeners('voice:stream-watch')[0]; serverSocket.removeAllListeners('voice:stream-watch');
    await b.evaluate(id => window.qa.media.watchStream(id), aid);
    await expect.poll(() => b.evaluate(id => window.qa.media.streamError(id), aid)).toMatch(/acknowledge/);
    expect((await metrics(b)).watching).toEqual([]);
    expect(await b.evaluate(() => window.qa.media.connectionStatus)).toBe('connected');
    serverSocket.on('voice:stream-watch', handler);
    await watch(b, aid);
    // Lost cancellation acknowledgments retry idempotently; a stalled handler reports a clear error.
    const unwatch = serverSocket.listeners('voice:stream-unwatch')[0];
    serverSocket.removeAllListeners('voice:stream-unwatch');
    await stopWatching(b, aid);
    await expect.poll(() => b.evaluate(id => window.qa.media.streamError(id), aid), { timeout: 20_000 }).toMatch(/confirm Stop Watching/);
    serverSocket.on('voice:stream-unwatch', unwatch);
    await watch(b, aid);
    await stopWatching(b, aid);
    const sent = (await metrics(a)).sentVideo;
    await expect.poll(async () => {
      const before = (await metrics(a)).sentVideo;
      await new Promise(resolve => setTimeout(resolve, 300));
      return (await metrics(a)).sentVideo === before;
    }).toBe(true);
    expect((await metrics(a)).sentVideo).toBeGreaterThanOrEqual(sent);
    await b.evaluate(() => window.qa.media.leave());
    const join = serverSocket.listeners('voice:join')[0]; serverSocket.removeAllListeners('voice:join');
    serverSocket.on('voice:join', (payload, ack) => join(payload, (result: any) => { delete result.capabilities; ack(result); }));
    await b.evaluate(room => window.qa.media.join(room), users.room);
    await b.evaluate(() => window.qa.media.startShare());
    expect((await metrics(b)).errors.at(-1)).toMatch(/updated Haven backend/);
    expect(await b.evaluate(() => window.qa.media.sharing)).toBe(false);
    expect(await b.evaluate(() => window.qa.media.connectionStatus)).toBe('connected');
    expect(await b.evaluate(() => window.qa.media.connectionStatsSources()[0].connection.getSenders().filter((s: RTCRtpSender) => s.track?.kind === 'video').length)).toBe(0);
    // Restore protocol support, but simulate an acknowledged request whose broadcaster never sends.
    serverSocket.removeAllListeners('voice:join'); serverSocket.on('voice:join', join);
    await b.evaluate(() => window.qa.media.leave()); await b.evaluate(room => window.qa.media.join(room), users.room);
    serverSocket.removeAllListeners('voice:stream-watch');
    serverSocket.on('voice:stream-watch', (payload, ack) => ack({ protocol: 1, broadcastId: payload.broadcastId }));
    await b.evaluate(id => window.qa.media.watchStream(id), aid);
    await expect.poll(() => b.evaluate(id => window.qa.media.streamError(id), aid), { timeout: 20_000 }).toMatch(/did not deliver video/);
    expect((await metrics(b)).watching).toEqual([]);
    serverSocket.removeAllListeners('voice:stream-watch'); serverSocket.on('voice:stream-watch', handler);
    await watch(b, aid);
  } finally { await users.close(); }
});
