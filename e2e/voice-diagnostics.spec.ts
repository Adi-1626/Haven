import { test, expect, firefox, type Browser, type BrowserContext } from '@playwright/test';
import { streamFixture, instrumentMedia, apiOrigin, probeOrigin } from './stream-fixture';
import { consoleSink, type DiagnosticEntry } from '../apps/backend/src/diagnostics.js';

// Deliberately failing ICE: relay-only transport without a TURN server gathers no candidates, so
// connectivity checks can never succeed. Both clients must report it, and the backend must log it.
const logs: DiagnosticEntry[] = [];
let fixture: Awaited<ReturnType<typeof streamFixture>>;
let gecko: Browser;
test.beforeAll(async () => {
  fixture = await streamFixture({ diagnosticsSink: entry => { logs.push(entry); consoleSink(entry); } });
  gecko = await firefox.launch({ firefoxUserPrefs: {
    'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true,
    'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false,
  } });
});
test.afterAll(async () => { await gecko?.close(); await fixture?.close(); });

async function participant(context: BrowserContext, index: number, setup: { invite: string; room: string }) {
  const response = await context.request.post(`${apiOrigin}/api/auth/register`, { data: { username: `diag${index}${Date.now()}`, displayName: `Diag ${index}`, password: 'Diagnostics-2026' } });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  if (!index) {
    const { server } = await (await context.request.post(`${apiOrigin}/api/servers`, { data: { name: `Diagnostics ${Date.now()}` } })).json();
    setup.room = (await (await context.request.get(`${apiOrigin}/api/bootstrap`)).json()).channels.find((channel: any) => channel.type === 'voice').id;
    setup.invite = (await (await context.request.post(`${apiOrigin}/api/servers/${server.id}/invites`)).json()).code;
  } else expect((await context.request.post(`${apiOrigin}/api/invites/${setup.invite}/join`)).ok()).toBe(true);
  const page = await context.newPage();
  await instrumentMedia(page, user.id);
  await page.addInitScript(() => {
    // While `blockIce` is set, every new peer connection is relay-only with no relay to use.
    window.qa.blockIce = true;
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(configuration: RTCConfiguration = {}) {
        super(window.qa.blockIce ? { ...configuration, iceServers: [], iceTransportPolicy: 'relay' } : configuration);
      }
    };
  });
  await page.goto(`${probeOrigin}/probe`);
  await page.waitForFunction(() => window.qa.media && window.qa.socket.connected);
  await page.evaluate(room => window.qa.media.join(room), setup.room);
  return page;
}

test('simulated ICE failures from Chromium and Firefox reach the backend log, then recovery is logged', async ({ browser }) => {
  test.setTimeout(240_000);
  const setup = { invite: '', room: '' };
  const chromeContext = await browser.newContext({ permissions: ['microphone'] });
  const firefoxContext = await gecko.newContext();
  try {
    const chrome = await participant(chromeContext, 0, setup);
    const fox = await participant(firefoxContext, 1, setup);
    const failures = () => logs.filter(entry => entry.event === 'voice.ice_failure' && entry.room === setup.room);
    // ICE that never connects is reported after the 12 s checking limit, then again for each failed recovery.
    await expect.poll(() => new Set(failures().map(entry => entry.browser)), { timeout: 60_000 }).toEqual(new Set(['chromium', 'firefox']));
    await expect.poll(() => failures().some(entry => entry.errorType === 'recovery_failed'), { timeout: 90_000 }).toBe(true);
    for (const entry of failures()) {
      expect(entry.level).toBe('warn');
      expect(['ice_timeout', 'recovery_failed', 'ice_failed']).toContain(entry.errorType);
      expect(entry.user).toMatch(/^u_[0-9a-f]{12}$/);
      expect(entry.session).toMatch(/^s_[0-9a-f]{12}$/);
      expect(entry.peerSession).toMatch(/^s_[0-9a-f]{12}$/);
      expect(entry).toMatchObject({ everConnected: false, resettable: true, signaling: 2, peerSignaling: 2 });
      expect(typeof entry.durationMs).toBe('number');
      // Relay-only without TURN: nothing gathered, so no pair could ever be checked.
      expect(entry.local ?? {}).toEqual({});
    }
    // The impolite side replaced the never-connected pair; the server saw each recovery attempt.
    expect(logs.some(entry => entry.event === 'voice.peer_reset' && entry.room === setup.room)).toBe(true);

    // Lift the block: the next replacement connects, and both sides report the recovery.
    await Promise.all([chrome, fox].map(page => page.evaluate(() => { window.qa.blockIce = false; })));
    await expect.poll(() => new Set(logs.filter(entry => entry.event === 'voice.ice_recovered' && entry.room === setup.room).map(entry => entry.browser)), { timeout: 120_000 })
      .toEqual(new Set(['chromium', 'firefox']));
    const recovered = logs.find(entry => entry.event === 'voice.ice_recovered')!;
    expect(recovered.level).toBe('info');
    expect(recovered.retryCount as number).toBeGreaterThan(0);

    // Nothing sensitive was written: no socket or user IDs, no SDP, no candidate lines.
    const written = JSON.stringify(logs);
    const ids = await Promise.all([chrome, fox].map(page => page.evaluate(() => [window.qa.socket.id, window.qa.userId])));
    for (const id of ids.flat()) expect(written).not.toContain(id);
    expect(written).not.toMatch(/a=ice-pwd|a=ice-ufrag|candidate:|127\.0\.0\.1|v=0/);
  } finally { await chromeContext.close(); await firefoxContext.close(); }
});
