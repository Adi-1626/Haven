import { test, expect, type Browser, type Page, type BrowserContext } from '@playwright/test';
import os from 'node:os';
import { createRequire } from 'node:module';
import { streamFixture, instrumentMedia, metrics, apiOrigin, probeOrigin } from './stream-fixture';

// Real Chromium clients, backend and a local TURN relay (node-turn). User D stands in for a peer behind
// endpoint-dependent NAT: its connections gather relay candidates only. Everyone else uses Haven's
// normal configuration, so ICE chooses per connection; nothing here forces A, B or C through TURN.
const Turn = createRequire(import.meta.url)('node-turn');
const lan = Object.values(os.networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address;
let fixture: Awaited<ReturnType<typeof streamFixture>>;
let relay: { start(): void; stop(): void } | undefined;
const previousIce = process.env.ICE_SERVERS_JSON;

test.beforeAll(async () => {
  test.skip(!lan, 'needs a non-loopback IPv4 address for the TURN relay');
  relay = new Turn({ listeningIps: [lan], relayIps: [lan], listeningPort: 3479, authMech: 'long-term', credentials: { haven: 'relay-test' }, realm: 'haven.test', debugLevel: 'OFF' });
  relay!.start();
  process.env.ICE_SERVERS_JSON = JSON.stringify([{ urls: [`turn:${lan}:3479?transport=udp`], username: 'haven', credential: 'relay-test' }]);
  fixture = await streamFixture();
});
test.afterAll(async () => {
  await fixture?.close();
  relay?.stop();
  if (previousIce === undefined) delete process.env.ICE_SERVERS_JSON; else process.env.ICE_SERVERS_JSON = previousIce;
});

/** Forces relay-only ICE in this page (the emulated NAT). Must run before instrumentMedia wraps the class. */
async function behindStrictNat(page: Page) {
  await page.addInitScript(() => {
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(configuration: RTCConfiguration = {}) { super({ ...configuration, iceTransportPolicy: 'relay' }); }
      setConfiguration(configuration: RTCConfiguration = {}) { super.setConfiguration({ ...configuration, iceTransportPolicy: configuration.iceTransportPolicy ?? 'relay' }); }
    };
  });
}

/** A synthetic screen of a chosen size (window.qa.captureSize), replacing the fixture's 640 × 360 one. */
async function sizedCapture(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const qa = window.qa, size = qa.captureSize ?? { width: 2560, height: 1440 };
      const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
      qa.canvases.push(canvas);
      const context = canvas.getContext('2d')!; let frame = 0;
      const timer = setInterval(() => { context.fillStyle = `hsl(${frame++ % 360} 70% 40%)`; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#fff'; context.fillRect((frame * 37) % canvas.width, 40, 300, 300); }, 33);
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      qa.captures.push(stream); return stream;
    };
  });
}

async function group(browser: Browser, strict: boolean[]) {
  const contexts: BrowserContext[] = [], pages: Page[] = [];
  let room = '', invite = '';
  for (let index = 0; index < strict.length; index++) {
    const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
    const response = await context.request.post(`${apiOrigin}/api/auth/register`, { data: { username: `turnmix${index}${Date.now()}`, displayName: `Person ${'ABCD'[index]}`, password: 'Turn-regression-2026' } });
    expect(response.status()).toBe(201);
    const { user } = await response.json();
    if (!index) {
      const { server } = await (await context.request.post(`${apiOrigin}/api/servers`, { data: { name: `Turn ${Date.now()}` } })).json();
      room = (await (await context.request.get(`${apiOrigin}/api/bootstrap`)).json()).channels.find((channel: any) => channel.type === 'voice').id;
      invite = (await (await context.request.post(`${apiOrigin}/api/servers/${server.id}/invites`)).json()).code;
    } else expect((await context.request.post(`${apiOrigin}/api/invites/${invite}/join`)).ok()).toBe(true);
    const page = await context.newPage(); pages.push(page);
    if (strict[index]) await behindStrictNat(page);
    await instrumentMedia(page, user.id);
    await sizedCapture(page);
    await page.goto(`${probeOrigin}/probe`); await page.waitForFunction(() => window.qa.media && window.qa.socket.connected);
    await page.evaluate(room => window.qa.media.join(room), room);
  }
  const ids = await Promise.all(pages.map(page => page.evaluate(() => window.qa.socket.id as string)));
  return { pages, ids, room, close: () => Promise.all(contexts.map(context => context.close())) };
}

interface Path { peer: string; state: string; pair?: string; local?: string; remote?: string; relayed: boolean; audioIn: number }
/** Selected candidate pair of each of this page's peer connections, from getStats(). */
async function paths(page: Page): Promise<Path[]> {
  return page.evaluate(async () => Promise.all(window.qa.media.connectionStatsSources().map(async (source: any) => {
    const stats = [...(await source.connection.getStats()).values()] as any[];
    const transport = stats.find(stat => stat.type === 'transport');
    const pair = stats.find(stat => stat.id === transport?.selectedCandidatePairId);
    const type = (id?: string) => stats.find(stat => stat.id === id)?.candidateType;
    const local = type(pair?.localCandidateId), remote = type(pair?.remoteCandidateId);
    const audioIn = stats.filter(stat => stat.type === 'inbound-rtp' && stat.kind === 'audio').reduce((total, stat) => total + (stat.bytesReceived || 0), 0);
    return { peer: source.socketId, state: source.connection.connectionState, pair: pair?.id, local, remote, relayed: local === 'relay' || remote === 'relay', audioIn };
  })));
}
const pathTo = async (page: Page, peer: string) => (await paths(page)).find(path => path.peer === peer);

/** Parameters and live encoder output of this page's screen video sender towards one peer. */
async function screenSender(page: Page, peer: string) {
  return page.evaluate(async peer => {
    const source = window.qa.media.connectionStatsSources().find((item: any) => item.socketId === peer);
    if (!source) return undefined;
    const connection: RTCPeerConnection = source.connection;
    const video = connection.getSenders().find(sender => sender.track?.kind === 'video');
    const audio = connection.getSenders().filter(sender => sender.track?.kind === 'audio').map(sender => sender.getParameters().encodings?.[0]?.maxBitrate);
    const encoding = video?.getParameters().encodings?.[0];
    const stats = [...(await connection.getStats()).values()] as any[];
    const outbound = stats.find(stat => stat.type === 'outbound-rtp' && stat.kind === 'video');
    return { maxBitrate: encoding?.maxBitrate, maxFramerate: encoding?.maxFramerate, scale: encoding?.scaleResolutionDownBy, frameHeight: outbound?.frameHeight ?? 0, bytesSent: outbound?.bytesSent ?? 0, audioMaxBitrate: audio[0] };
  }, peer);
}
const framesDecoded = (page: Page) => page.evaluate(async () => {
  const reports = await Promise.all(window.qa.media.connectionStatsSources().map((source: any) => source.connection.getStats()));
  return reports.flatMap((report: any) => [...report.values()]).filter((stat: any) => stat.type === 'inbound-rtp' && stat.kind === 'video').reduce((total: number, stat: any) => total + (stat.framesDecoded || 0), 0);
});
async function watch(page: Page, id: string) {
  await page.evaluate(id => window.qa.media.watchStream(id), id);
  await expect.poll(async () => (await metrics(page)).peers.find((peer: any) => peer.id === id)?.video).toBe(1);
}

test('one user needing TURN relays only their own connections; direct pairs survive their ICE restarts and rejoin', async ({ browser }) => {
  const users = await group(browser, [false, false, false, true]);
  const [a, b, c, d] = users.pages, [aid, bid, cid, did] = users.ids;
  try {
    // Every page has three connected peers with audio flowing.
    for (const page of users.pages) await expect.poll(async () => (await paths(page)).filter(path => path.state === 'connected' && path.pair && path.audioIn > 100).length, { timeout: 30_000 }).toBe(3);
    const direct = [[a, bid], [a, cid], [b, aid], [b, cid], [c, aid], [c, bid]] as const;
    for (const [page, peer] of direct) expect((await pathTo(page, peer))?.relayed, 'A, B and C stay direct with each other').toBe(false);
    for (const [page, peer] of [[a, did], [b, did], [c, did]] as const) {
      const path = await pathTo(page, peer);
      expect(path?.relayed).toBe(true);
      expect(path?.local, 'only D\'s side uses the relay').not.toBe('relay');
    }
    for (const path of await paths(d)) expect(path.local).toBe('relay');

    const before = new Map(await Promise.all(direct.map(async ([page, peer]) => [`${users.pages.indexOf(page)}:${peer}`, await pathTo(page, peer)] as const)));
    const watchDirect = async () => {
      for (const [page, peer] of direct) {
        const now = await pathTo(page, peer), then = before.get(`${users.pages.indexOf(page)}:${peer}`)!;
        expect(now?.state, 'direct connection stays connected').toBe('connected');
        expect(now?.pair, 'direct connection keeps its selected pair').toBe(then.pair);
      }
    };

    // ICE restarts on all of D's connections (Haven negotiates them), while A, B and C keep talking.
    const audioBefore = (await pathTo(a, bid))!.audioIn;
    await d.evaluate(() => window.qa.media.connectionStatsSources().forEach((source: any) => source.connection.restartIce()));
    for (let sample = 0; sample < 10; sample++) { await watchDirect(); await d.waitForTimeout(500); }
    for (const page of [a, b, c]) await expect.poll(async () => (await pathTo(page, did))?.state, { timeout: 20_000 }).toBe('connected');
    await watchDirect();
    expect((await pathTo(a, bid))!.audioIn, 'A–B audio kept flowing during D\'s restarts').toBeGreaterThan(audioBefore);

    // D drops out of voice and rejoins: new connections, relayed again; the direct mesh is untouched.
    await d.evaluate(() => window.qa.media.leave());
    await expect.poll(async () => (await paths(a)).length).toBe(2);
    await watchDirect();
    await d.evaluate(room => window.qa.media.join(room), users.room);
    const rejoined = await d.evaluate(() => window.qa.socket.id as string);
    for (const page of [a, b, c]) await expect.poll(async () => { const path = await pathTo(page, rejoined); return path?.state === 'connected' && path.relayed && path.audioIn > 100; }, { timeout: 30_000 }).toBe(true);
    await watchDirect();
    expect(await a.evaluate(() => window.qa.errors)).toEqual([]);
  } finally { await users.close(); }
});

test('screen sharing caps only relayed viewers, follows a relay-to-direct switch, and Native reports the real source', async ({ browser }, info) => {
  // C watches directly; B and D start behind the emulated strict NAT.
  const users = await group(browser, [false, true, false, true]);
  const [a, b, c, d] = users.pages, [aid, bid, cid, did] = users.ids;
  try {
    for (const page of [a, b, c, d]) await expect.poll(async () => (await paths(page)).filter(path => path.state === 'connected').length, { timeout: 30_000 }).toBe(3);
    await a.evaluate(() => window.qa.media.startShare());
    // Native is the capture's real size, independent of any viewer's cap.
    await expect.poll(() => a.evaluate(() => [window.qa.media.quality.nativeWidth, window.qa.media.quality.nativeHeight])).toEqual([2560, 1440]);
    expect(await a.evaluate(() => window.qa.media.shareOptions[0].label)).toBe('Native (2560 × 1440)');
    await watch(c, aid); await watch(b, aid); await watch(d, aid);
    const caps = async (peer: string) => { const sender = await screenSender(a, peer); return [sender?.maxBitrate, sender?.maxFramerate, sender?.scale]; };

    // Direct viewer C: full quality. Relayed viewers B and D: 1 Mbps, 15 fps, 720p. Voice identical for all.
    await expect.poll(() => caps(cid)).toEqual([8_000_000, 60, 1]);
    await expect.poll(() => caps(did)).toEqual([1_000_000, 15, 2]);
    await expect.poll(() => caps(bid)).toEqual([1_000_000, 15, 2]);
    await expect.poll(async () => (await screenSender(a, did))?.frameHeight, { timeout: 20_000 }).toBeGreaterThan(0);
    expect((await screenSender(a, did))!.frameHeight).toBeLessThanOrEqual(720);
    await expect.poll(async () => (await screenSender(a, cid))?.frameHeight, { timeout: 30_000 }).toBeGreaterThan(720);
    expect((await screenSender(a, did))!.audioMaxBitrate).toBe((await screenSender(a, cid))!.audioMaxBitrate);
    expect(await a.evaluate(() => [window.qa.media.quality.nativeWidth, window.qa.media.quality.nativeHeight]), 'relayed viewers never change the source').toEqual([2560, 1440]);

    // Measured cost over 10 s: relayed (capped) versus direct (uncapped) screen bytes from A.
    const [c0, d0] = [(await screenSender(a, cid))!.bytesSent, (await screenSender(a, did))!.bytesSent];
    await a.waitForTimeout(10_000);
    const [c1, d1] = [(await screenSender(a, cid))!.bytesSent, (await screenSender(a, did))!.bytesSent];
    const kbps = (bytes: number) => Math.round(bytes * 8 / 10 / 1000);
    info.annotations.push({ type: 'screen bitrate', description: `direct viewer ${kbps(c1 - c0)} kbps, relayed viewer ${kbps(d1 - d0)} kbps` });
    console.log(`screen bitrate: direct viewer ${kbps(c1 - c0)} kbps, relayed viewer ${kbps(d1 - d0)} kbps`);
    expect(kbps(d1 - d0)).toBeLessThanOrEqual(1_150);

    // B's connection to A switches from the relay to a direct path (ICE restart, the stream is not
    // renegotiated): A lifts that one viewer's cap while B keeps decoding and D keeps its cap.
    // (Chromium keeps a working higher-priority pair through a restart, so the opposite switch only
    // happens when the direct path actually fails; the same code path handles it.)
    await b.evaluate(aid => {
      const source = window.qa.media.connectionStatsSources().find((item: any) => item.socketId === aid);
      source.connection.setConfiguration({ ...source.connection.getConfiguration(), iceTransportPolicy: 'all' });
      source.connection.restartIce();
    }, aid);
    await expect.poll(async () => (await pathTo(b, aid))?.relayed, { timeout: 30_000 }).toBe(false);
    await expect.poll(() => caps(bid), { timeout: 20_000 }).toEqual([8_000_000, 60, 1]);
    const framesDirect = await framesDecoded(b);
    await expect.poll(() => framesDecoded(b), { timeout: 10_000 }).toBeGreaterThan(framesDirect);
    expect(await caps(did)).toEqual([1_000_000, 15, 2]);
    expect(await caps(cid)).toEqual([8_000_000, 60, 1]);

    // Gaming Mode: its own cap for direct viewers, the relay cap still holds for D.
    await a.evaluate(() => window.qa.media.setSettings({ gamingMode: true }));
    await expect.poll(() => caps(cid)).toEqual([3_000_000, 30, 2]);
    expect(await caps(did)).toEqual([1_000_000, 15, 2]);
    await a.evaluate(() => window.qa.media.setSettings({ gamingMode: false }));
    await expect.poll(() => caps(cid)).toEqual([8_000_000, 60, 1]);

    // The captured window resizes, then a different source is chosen: Native follows each time.
    await a.evaluate(() => { const canvas = window.qa.canvases.at(-1); canvas.width = 1920; canvas.height = 1032; });
    await expect.poll(() => a.evaluate(() => window.qa.media.shareOptions[0].label), { timeout: 20_000 }).toBe('Native (1920 × 1032)');
    await a.evaluate(() => window.qa.media.stopShare());
    await a.evaluate(() => { window.qa.captureSize = { width: 3840, height: 2160 }; return window.qa.media.startShare(); });
    await expect.poll(() => a.evaluate(() => window.qa.media.shareOptions[0].label), { timeout: 20_000 }).toBe('Native (3840 × 2160)');
    expect(await a.evaluate(() => window.qa.media.shareOptions.map((option: any) => option.label))).toEqual(['Native (3840 × 2160)', '1440p', '1080p', '720p', '480p']);
    await a.evaluate(() => window.qa.media.stopShare());
    expect(await a.evaluate(() => window.qa.media.shareOptions[0].label), 'no size is claimed before a source is chosen').toBe('Native (resolution of the screen or window you choose)');
    expect(await a.evaluate(() => window.qa.errors)).toEqual([]);
  } finally { await users.close(); }
});
