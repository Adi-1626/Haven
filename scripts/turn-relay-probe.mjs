// Forced-relay check of Haven's Turnix TURN service. CONSUMES TURN BANDWIDTH (well under 1 MB per run).
//
//   TURNIX_API_TOKEN=... node scripts/turn-relay-probe.mjs --yes [--region <slug> [--fixed]] [--ttl 600] [--hold 0] [--require-tls]
//
// Without --region no hint is sent and Turnix selects the region, exactly like the backend's default.
//
// Mints one credential exactly as the backend does, then for every relay URL Turnix returns (UDP, TCP and,
// if offered, TLS) connects two headless-Chromium peers with iceTransportPolicy "relay", so the only
// possible path is through Turnix. Reports the selected candidate types, relay transport, ICE round-trip
// time and data-channel round-trip time. Never prints the token or credentials.
// --ttl 60 --hold 300 keeps each relayed connection open (one ping per 5 s) past the credential's expiry,
// showing whether Turnix cuts an active relay when its credential expires.
//
// Each URL runs in its own browser context with an outer deadline, so a hung or crashed page fails only
// that URL. turns: failures do not fail the run unless --require-tls (Turnix's relay certificates expired
// on 4 June 2026, and browsers do not support TURN over DTLS).
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

/** Runs in the page: two relay-only peers, a data channel, RTT samples and the selected candidate pair. */
async function relayTest({ url, username, credential, holdUntil }) {
  const configuration = { iceServers: [{ urls: [url], username, credential }], iceTransportPolicy: 'relay' };
  const a = new RTCPeerConnection(configuration), b = new RTCPeerConnection(configuration);
  const candidates = { a: 0, b: 0 };
  a.onicecandidate = event => { if (event.candidate) { candidates.a++; void b.addIceCandidate(event.candidate).catch(() => {}); } };
  b.onicecandidate = event => { if (event.candidate) { candidates.b++; void a.addIceCandidate(event.candidate).catch(() => {}); } };
  const started = performance.now();
  try {
    const channel = a.createDataChannel('probe');
    const echo = new Promise(resolve => { b.ondatachannel = event => { event.channel.onmessage = message => event.channel.send(message.data); resolve(); }; });
    await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
    await Promise.race([
      Promise.all([new Promise(resolve => { channel.onopen = resolve; }), echo]),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`no relayed connection within 20 s (${candidates.a} relay candidates gathered)`)), 20_000)),
    ]);
    const connectedMs = Math.round(performance.now() - started);
    const rtts = [];
    for (let ping = 0; ping < 20; ping++) {
      const sent = performance.now();
      const answered = await Promise.race([
        new Promise(resolve => { channel.onmessage = () => resolve(true); channel.send('x'.repeat(64)); }),
        new Promise(resolve => setTimeout(() => resolve(false), 4000)),
      ]);
      if (!answered) throw new Error(`ping ${ping + 1} unanswered within 4 s after connecting`);
      rtts.push(performance.now() - sent);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const stats = [...(await a.getStats()).values()];
    const transport = stats.find(stat => stat.type === 'transport');
    const pair = stats.find(stat => stat.id === transport?.selectedCandidatePairId);
    const local = stats.find(stat => stat.id === pair?.localCandidateId);
    const remote = stats.find(stat => stat.id === pair?.remoteCandidateId);
    rtts.sort((x, y) => x - y);
    // Held connections: the last time a ping still came back, relative to the probe's start.
    let heldMs;
    while (Date.now() < holdUntil) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const answered = await Promise.race([
        new Promise(resolve => { channel.onmessage = () => resolve(true); channel.send('hold'); }),
        new Promise(resolve => setTimeout(() => resolve(false), 4000)),
      ]);
      if (!answered || channel.readyState !== 'open') break;
      heldMs = Math.round(performance.now() - started);
    }
    return {
      ok: true, connectedMs, relayCandidates: candidates.a,
      local: local?.candidateType, remote: remote?.candidateType, relayProtocol: local?.relayProtocol, relayAddress: local?.address,
      iceRttMs: pair?.currentRoundTripTime === undefined ? undefined : Math.round(pair.currentRoundTripTime * 1000),
      channelRttMs: { min: Math.round(rtts[0]), median: Math.round(rtts[10]), max: Math.round(rtts[19]) },
      bytes: (pair?.bytesSent ?? 0) + (pair?.bytesReceived ?? 0),
      ...(holdUntil > 0 ? { heldMs, survivedHold: Date.now() >= holdUntil } : {}),
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), relayCandidates: candidates.a };
  } finally { a.close(); b.close(); }
}

/**
 * Tests each URL in a fresh page from `openPage()` ({ page, close }). A page that throws, crashes or
 * misses `deadlineMs` yields { ok: false } for that URL only; its page is always closed.
 */
export async function probeUrls(urls, { openPage, holdSeconds = 0, deadlineMs = 45_000, log = () => {} }) {
  const results = [];
  for (const { url, server } of urls) {
    let opened, timer, result;
    const holdUntil = holdSeconds > 0 ? Date.now() + holdSeconds * 1000 : 0;
    try {
      opened = await openPage();
      result = await Promise.race([
        opened.page.evaluate(relayTest, { url, username: server.username, credential: server.credential, holdUntil }),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`no result within ${Math.round((deadlineMs + holdSeconds * 1000) / 1000)} s`)), deadlineMs + holdSeconds * 1000); }),
      ]);
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error).split('\n')[0] };
    } finally {
      clearTimeout(timer);
      await opened?.close().catch(() => {});
    }
    results.push({ url, ...result });
    log(url, result);
  }
  return results;
}

const relayed = result => result.ok && result.local === 'relay' && result.remote === 'relay';

/** Pass when every turn: URL relayed (and turns: too with requireTls); at least one URL must be plain TURN. */
export function verdict(results, { requireTls = false } = {}) {
  const plain = results.filter(result => /^turn:/i.test(result.url));
  const tls = results.filter(result => /^turns:/i.test(result.url));
  return plain.length > 0 && plain.every(relayed) && (!requireTls || tls.every(relayed));
}

async function main() {
  const args = process.argv.slice(2);
  const token = process.env.TURNIX_API_TOKEN?.trim();
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const region = option('--region', undefined);
  const ttl = Number(option('--ttl', '600')), holdSeconds = Number(option('--hold', '0'));
  if (!args.includes('--yes')) {
    console.error('This probe relays real traffic through Turnix and counts against the plan quota. Re-run with --yes.');
    process.exit(2);
  }
  if (!token) {
    console.error('Set TURNIX_API_TOKEN in this shell (never in a file in the repository).');
    process.exit(2);
  }

  const body = new URLSearchParams({ ttl: String(ttl), initiator_client: 'relay-probe', room: 'relay-probe' });
  if (region) body.set(args.includes('--fixed') ? 'fixed_region' : 'preferred_region', region);
  const minted = await fetch('https://turnix.io/api/v1/credentials/ice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!minted.ok) {
    console.error(`Turnix credential request failed: HTTP ${minted.status}`);
    process.exit(1);
  }
  const mintedAt = Date.now();
  const relays = ((await minted.json()).iceServers ?? []).filter(server => server.username && server.credential);
  const urls = relays.flatMap(server => [server.urls].flat().filter(url => /^turns?:/i.test(url)).map(url => ({ url, server })));
  console.log(`Turnix returned ${urls.length} relay URL(s):\n${urls.map(({ url }) => `  ${url}`).join('\n')}\n`);
  if (!urls.length) process.exit(1);

  let browser;
  const openPage = async () => {
    // A crashed browser is replaced, so one URL cannot take the remaining ones down with it.
    if (!browser?.isConnected()) browser = await chromium.launch();
    const context = await browser.newContext();
    return { page: await context.newPage(), close: () => context.close() };
  };
  const results = await probeUrls(urls, { openPage, holdSeconds, log: (url, result) => console.log(url, JSON.stringify(result)) });
  await browser?.close().catch(() => {});
  if (holdSeconds > 0) console.log(`\nCredential minted ${Math.round((Date.now() - mintedAt) / 1000)} s ago with ttl ${ttl} s.`);
  // Both peers sit on this machine, so each round trip crosses the client-to-relay path four times
  // (twice per direction); a single client's one-way latency to the relay is about a quarter of it.
  console.log('\nRound trips run peer A -> relay -> peer B -> relay -> peer A from this machine.');
  const failedTls = results.filter(result => /^turns:/i.test(result.url) && !relayed(result));
  if (failedTls.length && !args.includes('--require-tls')) console.log(`TURN/TLS: ${failedTls.length} URL(s) failed (known: Turnix relay certificates expired; not counted).`);
  const pass = verdict(results, { requireTls: args.includes('--require-tls') });
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
