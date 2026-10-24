import { test, expect, chromium, firefox, type Browser, type Page } from '@playwright/test';
import net from 'node:net';
import { streamFixture, instrumentMedia, metrics, apiOrigin, probeOrigin } from './stream-fixture';

// Soundboard, entry sounds and join/leave cues between real Chromium (the Electron engine) and
// Firefox participants. Each engine keeps its default autoplay policy; participants have clicked
// the page, as a user who chose to join voice has.
let fixture: Awaited<ReturnType<typeof streamFixture>>;
let blink: Browser; let gecko: Browser;
test.beforeAll(async () => {
  fixture = await streamFixture();
  blink = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  gecko = await firefox.launch({ firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } });
});
test.afterAll(async () => { await blink?.close(); await gecko?.close(); await fixture?.close(); });

function tone() {
  const rate = 16000, samples = rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) buffer.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 440 / rate) * 12000), 44 + sample * 2);
  return buffer;
}

/** A TCP relay for one participant's signaling that can drop the network without closing anything. */
function networkPath(listenPort: number, targetPort: number) {
  const links = new Set<{ client: net.Socket; upstream: net.Socket }>();
  let online = true;
  const server = net.createServer(client => {
    if (!online) { client.destroy(); return; }
    const upstream = net.connect(targetPort, '127.0.0.1');
    const link = { client, upstream };
    links.add(link);
    client.on('data', data => upstream.write(data));
    upstream.on('data', data => { if (!client.destroyed) client.write(data); });
    // The backend never learns that the client side vanished: no FIN, no close frame.
    client.on('error', () => {}); upstream.on('error', () => {});
    upstream.on('close', () => { client.destroy(); links.delete(link); });
  });
  server.listen(listenPort, '127.0.0.1');
  return {
    url: `http://127.0.0.1:${listenPort}`,
    /** The local network drops: the browser sees its connection fail, the backend sees silence. */
    cut(stayOffline: boolean) {
      online = !stayOffline;
      for (const link of links) { link.client.destroy(); link.upstream.pause(); }
    },
    restore() { online = true; },
    close() { for (const link of links) { link.client.destroy(); link.upstream.destroy(); } server.close(); },
  };
}

interface Participant { page: Page; user: { id: string }; socketId: () => Promise<string> }
async function participant(browser: Browser, name: string, setup: { server?: string; room?: string; invite?: string; sound?: string }, options: { entrySound?: boolean; socket?: string } = {}): Promise<Participant> {
  const context = await browser.newContext(browser === blink ? { permissions: ['microphone'] } : {});
  const registered = await context.request.post(`${apiOrigin}/api/auth/register`, { data: { username: `${name}${Date.now()}`, displayName: name, password: 'Voice-sounds-2026' } });
  expect(registered.status()).toBe(201);
  let { user } = await registered.json();
  if (!setup.server) {
    const { server } = await (await context.request.post(`${apiOrigin}/api/servers`, { data: { name: `Sounds ${Date.now()}` } })).json();
    setup.server = server.id;
    setup.room = (await (await context.request.get(`${apiOrigin}/api/bootstrap`)).json()).channels.find((channel: any) => channel.type === 'voice').id;
    setup.invite = (await (await context.request.post(`${apiOrigin}/api/servers/${server.id}/invites`)).json()).code;
    const uploaded = await context.request.post(`${apiOrigin}/api/servers/${server.id}/sounds`, { multipart: { name: 'Tone', file: { name: 'tone.wav', mimeType: 'audio/wav', buffer: tone() } } });
    setup.sound = (await uploaded.json()).sound.id;
  } else expect((await context.request.post(`${apiOrigin}/api/invites/${setup.invite}/join`)).ok()).toBe(true);
  if (options.entrySound) {
    const updated = await context.request.patch(`${apiOrigin}/api/users/me`, { data: { settings: { entrySounds: { [setup.server!]: setup.sound } } } });
    user = (await updated.json()).user;
  }
  const page = await context.newPage();
  page.on('pageerror', error => console.log(`[${name}] page error`, error.message));
  await instrumentMedia(page, user.id);
  await page.addInitScript(account => {
    const qa = (window as any).qa;
    qa.account = account; qa.sounds = []; qa.cues = []; qa.analysers = [];
    // Every node that reaches the speakers is also measured, so "played" means rendered audio.
    const connect = AudioNode.prototype.connect as any;
    AudioNode.prototype.connect = function (this: AudioNode, target: any, ...rest: any[]) {
      if (target instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        connect.call(this, analyser); qa.analysers.push(analyser);
      }
      return connect.call(this, target, ...rest);
    } as any;
    const startSound = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: any[]) { qa.sounds.push(this.context.state); return (startSound as any).apply(this, args); } as any;
    const schedule = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (this: any, value: number, time: number) { (this.__values ??= []).push(value); return schedule.call(this, value, time); };
    const startTone = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (this: any, ...args: any[]) {
      const [first, second] = this.frequency.__values ?? [];
      if (first === 659.25 && second === 880) qa.cues.push(`join:${this.context.state}`);
      if (first === 880 && second === 587.33) qa.cues.push(`leave:${this.context.state}`);
      return (startTone as any).apply(this, args);
    } as any;
    qa.peak = () => Math.max(0, ...qa.analysers.map((analyser: AnalyserNode) => {
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
      return data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    }));
  }, user);
  await page.goto(`${probeOrigin}/probe${options.socket ? `?socket=${encodeURIComponent(options.socket)}` : ''}`);
  await page.waitForFunction(() => window.qa.media && window.qa.socket.connected);
  await page.mouse.click(5, 5);
  return { page, user, socketId: () => page.evaluate(() => window.qa.socket.id as string) };
}

const sounds = (page: Page) => page.evaluate(() => window.qa.sounds as string[]);
const cues = (page: Page) => page.evaluate(() => window.qa.cues as string[]);
const peers = (page: Page) => page.evaluate(() => (window.qa.media.peers as any[]).map(peer => peer.socketId).sort());
const inVoice = new Set<Participant>();
async function join(member: Participant, room: string) {
  await member.page.evaluate(room => window.qa.media.join(room), room);
  const id = await member.socketId();
  for (const other of inVoice) await expect.poll(() => peers(other.page)).toContain(id);
  inVoice.add(member);
  // Let collapse windows and entry sounds settle before the next step.
  await member.page.waitForTimeout(700);
}
async function flowing(receiver: Page) {
  const before = (await metrics(receiver)).audio;
  await expect.poll(async () => (await metrics(receiver)).audio, { timeout: 20_000 }).toBeGreaterThan(before + 500);
}
/** Plays the sound like the soundboard does and returns how many new starts each page rendered. */
async function play(sender: Participant, sound: string, everyone: Participant[]) {
  const before = await Promise.all(everyone.map(member => sounds(member.page)));
  const ack = await sender.page.evaluate(sound => new Promise<any>(resolve => window.qa.socket.emit('sound:play', { soundId: sound }, resolve)), sound);
  expect(ack.error).toBeUndefined();
  await sender.page.waitForTimeout(900);
  return Promise.all(everyone.map(async (member, index) => {
    const after = await sounds(member.page);
    return { started: after.length - before[index].length, running: after.slice(before[index].length).every(state => state === 'running'), peak: await member.page.evaluate(() => window.qa.peak()) };
  }));
}

test('soundboard reaches every participant once in Chromium and Firefox; deafen, soundboard mute and per-user mute suppress it', async () => {
  test.setTimeout(180_000);
  const setup: { server?: string; room?: string; invite?: string; sound?: string } = {};
  const a = await participant(blink, 'Amber', setup);
  const b = await participant(gecko, 'Basil', setup);
  const c = await participant(blink, 'Cedar', setup);
  const everyone = [a, b, c];
  inVoice.clear();
  await join(a, setup.room!); await join(b, setup.room!); await join(c, setup.room!);
  await flowing(a.page); await flowing(b.page); await flowing(c.page);

  let heard = await play(a, setup.sound!, everyone);
  for (const result of heard) { expect(result.started).toBe(1); expect(result.running).toBe(true); expect(result.peak).toBeGreaterThan(0.05); }
  heard = await play(b, setup.sound!, everyone);
  for (const result of heard) { expect(result.started).toBe(1); expect(result.peak).toBeGreaterThan(0.05); }

  // Deafened listeners hear nothing; everyone else is unaffected.
  await b.page.evaluate(() => window.qa.media.toggleDeafen());
  heard = await play(a, setup.sound!, everyone);
  expect(heard.map(result => result.started)).toEqual([1, 0, 1]);
  await b.page.evaluate(() => window.qa.media.toggleDeafen());
  // The listener's own soundboard mute.
  await c.page.evaluate(() => window.qa.media.setSoundboardMuted(true));
  heard = await play(a, setup.sound!, everyone);
  expect(heard.map(result => result.started)).toEqual([1, 1, 0]);
  await c.page.evaluate(() => window.qa.media.setSoundboardMuted(false));
  // Muting one member's sounds affects only that member.
  await b.page.evaluate(id => window.qa.media.setUserSoundboardMuted(id, true), a.user.id);
  expect((await play(a, setup.sound!, everyone)).map(result => result.started)).toEqual([1, 0, 1]);
  expect((await play(c, setup.sound!, everyone)).map(result => result.started)).toEqual([1, 1, 1]);
  await b.page.evaluate(id => window.qa.media.setUserSoundboardMuted(id, false), a.user.id);
  // Soundboard playback is local Web Audio; voice keeps flowing.
  await flowing(a.page); await flowing(b.page); await flowing(c.page);
  for (const member of everyone) expect(await member.page.evaluate(() => window.qa.errors)).toEqual([]);
  for (const member of everyone) await member.page.context().close();
});

test('entry sounds and join/leave cues: once per real join or leave, silent across reconnects and stale-socket replacement', async () => {
  test.setTimeout(240_000);
  const setup: { server?: string; room?: string; invite?: string; sound?: string } = {};
  const network = networkPath(3158, 3157);
  try {
    const a = await participant(blink, 'Aster', setup);
    const b = await participant(gecko, 'Birch', setup, { entrySound: true });
    const c = await participant(blink, 'Clove', setup, { socket: network.url });
    const everyone = [a, b, c];
    inVoice.clear();
    await join(a, setup.room!);
    expect(await cues(a.page)).toEqual(['join:running']);
    // Birch has an entry sound: it replaces the join cue for everyone, and plays exactly once.
    await join(b, setup.room!);
    expect(await cues(a.page)).toEqual(['join:running']);
    expect(await cues(b.page)).toEqual([]);
    expect(await sounds(a.page)).toEqual(['running']);
    expect(await sounds(b.page)).toEqual(['running']);
    await join(c, setup.room!);
    expect(await cues(a.page)).toEqual(['join:running', 'join:running']);
    expect(await cues(b.page)).toEqual(['join:running']);
    expect(await cues(c.page)).toEqual(['join:running']);
    await flowing(a.page); await flowing(b.page); await flowing(c.page);
    const snapshot = async () => Promise.all(everyone.map(async member => [await cues(member.page), await sounds(member.page)]));
    let quiet = await snapshot();

    // Birch's signaling transport drops and reconnects: no cues, no entry sound replay.
    const firstB = await b.socketId();
    await b.page.evaluate(() => window.qa.socket.io.engine.close());
    await expect.poll(async () => { const id = await b.socketId(); return Boolean(id && id !== firstB); }, { timeout: 20_000 }).toBe(true);
    await expect.poll(() => b.page.evaluate(() => window.qa.media.connectionStatus), { timeout: 20_000 }).toBe('connected');
    const secondB = await b.socketId();
    await expect.poll(() => peers(a.page)).toEqual([secondB, await c.socketId()].sort());
    await flowing(a.page); await flowing(b.page);
    await a.page.waitForTimeout(6000); // longer than the leave-cue grace period
    expect(await snapshot()).toEqual(quiet);

    // Clove's network drops without closing anything. The server cannot see it go, but Clove's
    // resumed session retires the stale socket at once instead of after the heartbeat timeout.
    const firstC = await c.socketId();
    const cut = Date.now();
    network.cut(false);
    await expect.poll(async () => { const id = await c.socketId(); return Boolean(id && id !== firstC); }, { timeout: 20_000 }).toBe(true);
    const secondC = await c.socketId();
    await expect.poll(() => peers(a.page), { timeout: 8000 }).toEqual([secondB, secondC].sort());
    await expect.poll(() => peers(b.page), { timeout: 8000 }).toEqual([await a.socketId(), secondC].sort());
    const replacedAfter = Date.now() - cut;
    expect(replacedAfter).toBeLessThan(8000);
    await flowing(a.page); await flowing(c.page);
    await a.page.waitForTimeout(6000);
    expect(await snapshot()).toEqual(quiet);

    // A deliberate leave is announced once, to the leaver as well.
    await b.page.evaluate(() => window.qa.media.leave());
    await expect.poll(() => cues(a.page)).toEqual([...quiet[0][0], 'leave:running']);
    await expect.poll(() => cues(c.page)).toEqual([...quiet[2][0], 'leave:running']);
    await expect.poll(() => cues(b.page)).toEqual([...quiet[1][0], 'leave:running']);
    quiet = await snapshot();

    // Clove's network goes away for good: after the heartbeat and the grace period, one leave cue.
    const lost = Date.now();
    network.cut(true);
    await expect.poll(() => peers(a.page), { timeout: 30_000 }).toEqual([]);
    const detectedAfter = Date.now() - lost;
    await expect.poll(() => cues(a.page), { timeout: 10_000 }).toEqual([...quiet[0][0], 'leave:running']);
    // When it comes back, the return is announced because the departure was.
    network.restore();
    await expect.poll(() => peers(a.page), { timeout: 30_000 }).toHaveLength(1);
    await expect.poll(() => cues(a.page)).toEqual([...quiet[0][0], 'leave:running', 'join:running']);
    await flowing(a.page); await flowing(c.page);
    expect(await sounds(a.page)).toEqual(quiet[0][1]);
    console.log(JSON.stringify({ staleSocketReplacedMs: replacedAfter, abruptLossDetectedMs: detectedAfter }));
    for (const member of everyone) expect(await member.page.evaluate(() => window.qa.errors)).toEqual([]);
    for (const member of everyone) await member.page.context().close();
  } finally { network.close(); }
});

test('ICE stuck in checking because candidates were lost recovers within the bounded recovery budget', async () => {
  test.setTimeout(150_000);
  const setup: { server?: string; room?: string; invite?: string; sound?: string } = {};
  const a = await participant(blink, 'Alder', setup);
  const b = await participant(gecko, 'Bramble', setup);
  for (const { page } of [a, b]) await page.evaluate(() => {
    // Lose every remote candidate in transit, as a dropped relay message would.
    const qa = window.qa; qa.dropped = 0; qa.losing = true;
    const onevent = qa.socket.onevent;
    qa.socket.onevent = function (packet: any) {
      if (qa.losing && packet.data?.[0] === 'voice:signal' && packet.data[1]?.candidate) { qa.dropped++; return; }
      return onevent.call(this, packet);
    };
    qa.states = [];
    const Peer = RTCPeerConnection.prototype;
    const restart = Peer.restartIce; qa.restarts = 0;
    Peer.restartIce = function (this: RTCPeerConnection) { qa.restarts++; qa.states.push(`restart:${this.connectionState}`); return restart.call(this); };
  });
  await a.page.evaluate(room => window.qa.media.join(room), setup.room);
  await b.page.evaluate(room => window.qa.media.join(room), setup.room);
  const state = (page: Page) => page.evaluate(() => (window.qa.media.connectionStatsSources() as any[])[0]?.connection.connectionState);
  await expect.poll(() => state(a.page)).toBeDefined();
  // Stuck: well past normal ICE completion, still checking, nothing has failed.
  await a.page.waitForTimeout(8000);
  const stuck = [await state(a.page), await state(b.page)];
  console.log('stuck states', JSON.stringify(stuck));
  // Chromium waits in `new`/`connecting` indefinitely without remote candidates; Firefox gives up.
  expect(['new', 'connecting']).toContain(stuck[0]);
  expect(['new', 'connecting', 'failed']).toContain(stuck[1]);
  expect(await a.page.evaluate(() => window.qa.dropped)).toBeGreaterThan(0);
  // The candidates of the next ICE generation arrive.
  for (const { page } of [a, b]) await page.evaluate(() => { window.qa.losing = false; });
  await expect.poll(() => state(a.page), { timeout: 40_000 }).toBe('connected');
  await expect.poll(() => state(b.page), { timeout: 20_000 }).toBe('connected');
  const detail = (page: Page) => page.evaluate(async () => Promise.all((window.qa.media.connectionStatsSources() as any[]).map(async ({ connection }: { connection: RTCPeerConnection }) => ({
    state: connection.connectionState, ice: connection.iceConnectionState, signaling: connection.signalingState,
    rtp: [...(await connection.getStats()).values()].filter(stat => stat.type === 'inbound-rtp' || stat.type === 'outbound-rtp').map(stat => `${stat.type}:${stat.kind}:${stat.bytesReceived ?? stat.bytesSent}:ssrc${stat.ssrc}`),
    transport: [...(await connection.getStats()).values()].filter(stat => stat.type === 'transport' || (stat.type === 'candidate-pair' && (stat.nominated || stat.selected))).map(stat => `${stat.type}:${stat.dtlsState ?? stat.state}:rx${stat.bytesReceived}:tx${stat.bytesSent}`),
    remoteSsrc: (connection.remoteDescription?.sdp.match(/^a=ssrc:\d+/gm) ?? []).join(','), remoteSetup: (connection.remoteDescription?.sdp.match(/^a=setup:\S+/gm) ?? []).join(','), localSetup: (connection.localDescription?.sdp.match(/^a=setup:\S+/gm) ?? []).join(','),
    transceivers: connection.getTransceivers().map(lane => `${lane.mid}:${lane.direction}:${lane.currentDirection}:${lane.sender.track?.kind ?? '-'}`),
    errors: window.qa.errors, states: window.qa.states,
  }))));
  try { await flowing(a.page); await flowing(b.page); }
  catch (error) { console.log('A', JSON.stringify(await detail(a.page))); console.log('B', JSON.stringify(await detail(b.page))); throw error; }
  const recovery = await Promise.all([a, b].map(({ page }) => page.evaluate(() => ({
    restarts: window.qa.restarts, replaced: (window.qa.connections as RTCPeerConnection[]).length - 1,
    live: (window.qa.connections as RTCPeerConnection[]).filter(connection => connection.connectionState !== 'closed').length,
  }))));
  console.log(JSON.stringify(recovery));
  // Bounded: a handful of attempts, one live connection each, audio in both directions.
  for (const side of recovery) expect(side.live).toBe(1);
  expect(recovery.reduce((total, side) => total + side.restarts, 0) + recovery[0].replaced).toBeLessThanOrEqual(5);
  for (const { page } of [a, b]) expect(await page.evaluate(() => window.qa.errors)).toEqual([]);
  for (const { page } of [a, b]) await page.context().close();
});
