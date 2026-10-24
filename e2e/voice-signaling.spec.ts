import { test, expect, firefox, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { streamFixture, instrumentMedia, metrics, apiOrigin, probeOrigin } from './stream-fixture';

// Firefox reports a candidate for an ICE generation it has not (or no longer) applied as
// `Unknown ufrag`; Chromium rejects it as well. These cases reproduce Haven v1.0.0's failure.
let fixture: Awaited<ReturnType<typeof streamFixture>>;
let gecko: Browser;
test.beforeAll(async () => {
  fixture = await streamFixture();
  gecko = await firefox.launch({ firefoxUserPrefs: {
    'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true,
    'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false,
  } });
});
test.afterAll(async () => { await gecko?.close(); await fixture?.close(); });

const pages: Page[] = [];
async function participant(context: BrowserContext, index: number, setup: { invite: string; room: string; name: string }) {
  const response = await context.request.post(`${apiOrigin}/api/auth/register`, { data: { username: `signal${index}${Date.now()}`, displayName: `Person ${index}`, password: 'Signal-regression-2026' } });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  if (!index) {
    const { server } = await (await context.request.post(`${apiOrigin}/api/servers`, { data: { name: setup.name } })).json();
    setup.room = (await (await context.request.get(`${apiOrigin}/api/bootstrap`)).json()).channels.find((channel: any) => channel.type === 'voice').id;
    setup.invite = (await (await context.request.post(`${apiOrigin}/api/servers/${server.id}/invites`)).json()).code;
  } else expect((await context.request.post(`${apiOrigin}/api/invites/${setup.invite}/join`)).ok()).toBe(true);
  const page = await context.newPage();
  const crashes: string[] = [];
  page.on('pageerror', error => crashes.push(error.message));
  await instrumentMedia(page, user.id);
  await page.addInitScript(() => {
    // Firefox rejects every constraint on the fixture's canvas capture (a real screen capture accepts
    // frame-rate constraints). Treat them as satisfied so the synthetic share exercises transport only.
    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async options => {
      const stream = await getDisplayMedia(options);
      if (/Firefox/.test(navigator.userAgent)) stream.getVideoTracks().forEach(track => { track.applyConstraints = async () => {}; });
      return stream;
    };
    // Every candidate the application adds, with the browser's verdict, for failure diagnostics.
    const add = RTCPeerConnection.prototype.addIceCandidate;
    window.qa.added = [];
    RTCPeerConnection.prototype.addIceCandidate = function (this: RTCPeerConnection, candidate?: RTCIceCandidateInit) {
      const entry = `${candidate?.usernameFragment}:${(candidate?.candidate ?? '').split(' ').slice(4, 8).join(' ')}`;
      return add.call(this, candidate).then(() => { window.qa.added.push(`ok ${entry}`); }, (error: Error) => { window.qa.added.push(`fail ${entry} ${error.message}`); throw error; });
    } as RTCPeerConnection['addIceCandidate'];
  });
  pages.push(page);
  await page.goto(`${probeOrigin}/probe`);
  await page.waitForFunction(() => window.qa.media && window.qa.socket.connected);
  // Record signaling as the application sees it, in arrival order.
  await page.evaluate(() => {
    const qa = window.qa; qa.received = []; qa.sent = [];
    qa.socket.on('voice:signal', (signal: any) => qa.received.push(signal));
    const emit = qa.socket.emit.bind(qa.socket);
    qa.socket.emit = (event: string, ...args: any[]) => { if (event === 'voice:signal') qa.sent.push(args[0]); return emit(event, ...args); };
  });
  await page.evaluate(room => window.qa.media.join(room), setup.room);
  return { page, crashes };
}

const socketId = (page: Page) => page.evaluate(() => window.qa.socket.id as string);
const errors = (page: Page) => page.evaluate(() => window.qa.errors as string[]);
const ufrag = (sdp?: string) => /^a=ice-ufrag:(\S+)/m.exec(sdp ?? '')?.[1];
const peerState = (page: Page, id: string) => page.evaluate(id => {
  const connection = window.qa.media.connectionStatsSources().find((source: any) => source.socketId === id)?.connection as RTCPeerConnection | undefined;
  return { state: connection?.connectionState, remote: connection?.remoteDescription?.sdp };
}, id);
const peer = (page: Page, id: string) => page.evaluate(id => window.qa.media.peers.find((value: any) => value.socketId === id)?.state, id);
async function flowing(receiver: Page) {
  const before = (await metrics(receiver)).audio;
  try { await expect.poll(async () => (await metrics(receiver)).audio, { timeout: 20_000 }).toBeGreaterThan(before + 500); }
  catch (error) { await diagnose(); throw error; }
}
async function connected(page: Page, id: string) {
  try { await expect.poll(async () => (await peerState(page, id)).state, { timeout: 25_000 }).toBe('connected'); }
  catch (error) { await diagnose(); throw error; }
}
async function diagnose() {
  for (const page of pages) console.log('Peer state', JSON.stringify(await page.evaluate(() => Promise.all((window.qa.media.connectionStatsSources() as any[]).map(async ({ connection }: { connection: RTCPeerConnection }) => {
    const ufrag = (sdp?: string) => /^a=ice-ufrag:(\S+)/m.exec(sdp ?? '')?.[1];
    const signal = (value: any) => value.description ? `${value.description.type}:${ufrag(value.description.sdp)}` : `candidate:${value.candidate?.usernameFragment}`;
    const stats = [...(await connection.getStats()).values()];
    return {
      self: window.qa.socket.id, state: connection.connectionState, ice: connection.iceConnectionState, signaling: connection.signalingState,
      local: ufrag(connection.localDescription?.sdp), remote: ufrag(connection.remoteDescription?.sdp), errors: window.qa.errors,
      pairs: stats.filter(stat => stat.type === 'candidate-pair').map(stat => `${stat.state}${stat.nominated ? '*' : ''}`),
      added: window.qa.added.slice(-25), received: window.qa.received.slice(-30).map(signal), sent: window.qa.sent.slice(-30).map(signal),
    };
  })))));
}
/** ICE restart whose offer is held back after its candidates start trickling to the peer. */
async function delayedRestart(page: Page, id: string, delay = 750) {
  await page.evaluate(({ id, delay }) => {
    const connection = window.qa.media.connectionStatsSources().find((source: any) => source.socketId === id).connection as RTCPeerConnection;
    const original = connection.setLocalDescription.bind(connection);
    connection.setLocalDescription = (async (description?: RTCLocalSessionDescriptionInit) => {
      await original(description);
      connection.setLocalDescription = original;
      await new Promise(resolve => setTimeout(resolve, delay));
    }) as RTCPeerConnection['setLocalDescription'];
    connection.restartIce();
  }, { id, delay });
}
/** Proves the scenario happened: a candidate of the new generation preceded its description. */
async function candidateOvertookDescription(receiver: Page, from: string, generation: string) {
  const order = await receiver.evaluate(({ from, generation }) => (window.qa.received as any[]).filter(signal => signal.from === from)
    .map(signal => signal.description ? `description:${/^a=ice-ufrag:(\S+)/m.exec(signal.description.sdp)?.[1]}` : `candidate:${signal.candidate?.usernameFragment}`)
    .filter(entry => entry.endsWith(`:${generation}`)), { from, generation });
  expect(order[0]).toBe(`candidate:${generation}`);
  expect(order).toContain(`description:${generation}`);
}
/** A Chromium (Electron engine) member and a Firefox member, connected in one voice channel. */
async function pair(browser: Browser) {
  pages.length = 0;
  const setup = { invite: '', room: '', name: `Signals ${Date.now()}` };
  const chromeContext = await browser.newContext({ permissions: ['microphone'] });
  const firefoxContext = await gecko.newContext();
  const close = async () => { await chromeContext.close(); await firefoxContext.close(); };
  try {
    const chrome = await participant(chromeContext, 0, setup);
    const fox = await participant(firefoxContext, 1, setup);
    const [a, b] = [chrome.page, fox.page];
    const [aid, bid] = await Promise.all([socketId(a), socketId(b)]);
    await connected(a, bid); await connected(b, aid);
    await flowing(a); await flowing(b);
    return { a, b, aid, bid, crashes: () => [...chrome.crashes, ...fox.crashes], close };
  } catch (error) { await close(); throw error; }
}

test('delayed restart offers and stale candidates of replaced ICE generations keep voice connected', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, aid, bid, crashes, close } = await pair(browser);
  try {
    // Delayed restart offer from Chromium: Firefox receives `candidate` before `offer`.
    const firstGeneration = ufrag((await peerState(b, aid)).remote);
    await delayedRestart(a, bid);
    await expect.poll(async () => ufrag((await peerState(b, aid)).remote)).not.toBe(firstGeneration);
    const chromeGeneration = ufrag((await peerState(b, aid)).remote)!;
    await candidateOvertookDescription(b, aid, chromeGeneration);
    await connected(b, aid); await flowing(b); await flowing(a);
    expect(await errors(b)).toEqual([]);

    // A stale candidate from the replaced generation is still in flight and lands afterwards.
    const stale = await a.evaluate(({ bid, current }) => (window.qa.sent as any[]).find(signal => signal.target === bid && signal.candidate?.usernameFragment && signal.candidate.usernameFragment !== current && signal.candidate.candidate), { bid, current: chromeGeneration });
    expect(stale.candidate.usernameFragment).toBe(firstGeneration);
    const staleArrivals = () => b.evaluate(({ from, generation }) => (window.qa.received as any[]).filter(signal => signal.from === from && signal.candidate?.usernameFragment === generation).length, { from: aid, generation: firstGeneration });
    const staleBefore = await staleArrivals();
    await a.evaluate(signal => window.qa.socket.emit('voice:signal', signal), stale);
    await expect.poll(staleArrivals).toBe(staleBefore + 1);
    await flowing(b);
    expect(await errors(b)).toEqual([]);

    // The reverse direction: Firefox's delayed restart offer reaches Chromium last.
    const foxBefore = ufrag((await peerState(a, bid)).remote);
    await delayedRestart(b, aid);
    await expect.poll(async () => ufrag((await peerState(a, bid)).remote)).not.toBe(foxBefore);
    await candidateOvertookDescription(a, bid, ufrag((await peerState(a, bid)).remote)!);
    await connected(a, bid); await flowing(a); await flowing(b);
    expect([...await errors(a), ...await errors(b)]).toEqual([]);
    expect(crashes()).toEqual([]);
  } finally { await close(); }
});

test('simultaneous ICE restarts, Firefox reconnection, voice controls and mutual streams', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, aid, bid: firstBid, crashes, close } = await pair(browser);
  try {
    // Simultaneous negotiation: both peers restart ICE at once and resolve the collision.
    const glare = [ufrag((await peerState(a, firstBid)).remote), ufrag((await peerState(b, aid)).remote)];
    await Promise.all([delayedRestart(a, firstBid, 200), delayedRestart(b, aid, 200)]);
    await expect.poll(async () => [ufrag((await peerState(a, firstBid)).remote), ufrag((await peerState(b, aid)).remote)].every((value, index) => value !== glare[index]), { timeout: 20_000 }).toBe(true);
    await connected(a, firstBid); await connected(b, aid);
    await flowing(a); await flowing(b);
    expect([...await errors(a), ...await errors(b)]).toEqual([]);

    // Firefox loses its signaling transport and rejoins with a new socket. No duplicate peers.
    await b.evaluate(() => window.qa.socket.io.engine.close());
    await expect.poll(() => socketId(b), { timeout: 20_000 }).not.toBe(firstBid);
    await expect.poll(() => b.evaluate(() => window.qa.media.connectionStatus), { timeout: 20_000 }).toBe('connected');
    const bid = await socketId(b);
    await expect.poll(async () => (await metrics(a)).peers.map((value: any) => value.id)).toEqual([bid]);
    await expect.poll(async () => (await metrics(b)).peers.map((value: any) => value.id)).toEqual([aid]);
    await connected(a, bid); await connected(b, aid);
    await flowing(a); await flowing(b);
    for (const page of [a, b]) expect(await page.evaluate(() => (window.qa.connections as RTCPeerConnection[]).filter(connection => connection.connectionState !== 'closed').length)).toBe(1);

    // Voice controls and mutual screen streams still work across browsers after recovery.
    await b.evaluate(() => window.qa.media.toggleMute());
    await expect.poll(async () => (await peer(a, bid))?.muted).toBe(true);
    await b.evaluate(() => window.qa.media.toggleMute());
    await expect.poll(async () => (await peer(a, bid))?.muted).toBe(false);
    await a.evaluate(() => window.qa.media.toggleDeafen());
    await expect.poll(async () => (await peer(b, aid))?.deafened).toBe(true);
    expect(await a.evaluate(() => (window.qa.audios as HTMLAudioElement[]).filter(audio => audio.srcObject).every(audio => audio.muted))).toBe(true);
    await a.evaluate(() => window.qa.media.toggleDeafen());
    expect(await a.evaluate(() => (window.qa.audios as HTMLAudioElement[]).filter(audio => audio.srcObject).some(audio => !audio.muted))).toBe(true);
    await a.evaluate(() => window.qa.media.startShare()); await b.evaluate(() => window.qa.media.startShare());
    await expect.poll(async () => (await peer(b, aid))?.sharing).toBe(true);
    await expect.poll(async () => (await peer(a, bid))?.sharing).toBe(true);
    await b.evaluate(id => window.qa.media.watchStream(id), aid); await a.evaluate(id => window.qa.media.watchStream(id), bid);
    await expect.poll(async () => (await metrics(b, aid)).video, { timeout: 20_000 }).toBeGreaterThan(5);
    await expect.poll(async () => (await metrics(a, bid)).video, { timeout: 20_000 }).toBeGreaterThan(5);
    await flowing(a); await flowing(b);
    await a.evaluate(() => window.qa.media.stopShare()); await b.evaluate(() => window.qa.media.stopShare());
    await expect.poll(async () => (await peer(b, aid))?.sharing).toBe(false);
    await flowing(a); await flowing(b);
    expect([...await errors(a), ...await errors(b)]).toEqual([]);
    expect(crashes()).toEqual([]);
  } finally { await close(); }
});
