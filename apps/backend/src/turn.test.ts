import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';
import { SqliteAdapter } from './db/sqlite.js';
import type { DiagnosticEntry } from './diagnostics.js';
import { createTurnCredentials, turnOptionsFromEnv, TURNIX_ICE_URL, type TurnFailure, type TurnOptions } from './turn.js';

const apiToken = 'turnix-project-token-never-leaves-backend';
// Shape of Turnix's POST /credentials/ice response (turnix.io/docs/api-ice-credentials), with entries a
// browser cannot use mixed in.
const turnix = (username = 'minted-username', credential = 'minted-credential') => ({
  iceServers: [
    { urls: ['stun:stun.turnix.io:3478', 'stun:stun.turnix.io:53'] },
    {
      username, credential, extra: 'dropped',
      urls: [
        'turn:singapore.turnix.io:3478?transport=udp', 'turn:singapore.turnix.io:3478?transport=tcp',
        'turns:singapore.turnix.io:443?transport=tcp', 'turn:singapore.turnix.io:53?transport=udp', 'https://singapore.turnix.io',
      ],
    },
  ],
});
const expected = (username = 'minted-username', credential = 'minted-credential') => [
  { urls: ['stun:stun.turnix.io:3478'] },
  { urls: ['turn:singapore.turnix.io:3478?transport=udp', 'turn:singapore.turnix.io:3478?transport=tcp', 'turns:singapore.turnix.io:443?transport=tcp'], username, credential },
];

/** Fake Turnix endpoint plus a controllable clock. */
function harness(respond: (call: number, init: RequestInit) => Response | Promise<Response> = () => Response.json(turnix()), options: TurnOptions = {}) {
  let clock = 1_000_000;
  const calls: { url: string; init: RequestInit; body: Record<string, string> }[] = [];
  const events: { severity: string; event: string; fields: Record<string, unknown> }[] = [];
  const failures: [TurnFailure, number?][] = [];
  const turnixFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: Object.fromEntries(init.body as URLSearchParams) });
    return respond(calls.length, init);
  }) as typeof fetch;
  const turn = createTurnCredentials({ apiToken, now: () => clock, fetch: turnixFetch, ...options }, (severity, event, fields) => {
    events.push({ severity, event, fields });
    if (event === 'rtc.turn_unavailable') failures.push([fields.errorType as TurnFailure, fields.status as number | undefined]);
  });
  return { turn, calls, events, failures, advance: (ms: number) => { clock += ms; } };
}

test('mints credentials with Turnix\'s documented request and returns only usable relay and STUN entries', async () => {
  const { turn, calls, events, failures } = harness();
  assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), expected());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TURNIX_ICE_URL);
  assert.equal(TURNIX_ICE_URL, 'https://turnix.io/api/v1/credentials/ice');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
  // Form fields as sent by the official turnix-js SDK. Without ttl Turnix issues 30-second credentials.
  // No region hint: Turnix selects the relay region itself.
  assert.deepEqual(calls[0].body, { ttl: '43200', initiator_client: 'u_aaaaaaaaaaaa' });
  assert.deepEqual(failures, []);
  // Region and transports are visible in logs; credentials are not.
  assert.deepEqual(events.find(entry => entry.event === 'rtc.turn_servers')?.fields, {
    relays: 'turn:singapore.turnix.io:3478?transport=tcp turn:singapore.turnix.io:3478?transport=udp turns:singapore.turnix.io:443?transport=tcp',
  });
  assert.doesNotMatch(JSON.stringify(events), /minted-|turnix-project-token/);
});

test('a configured region is sent, fixed taking precedence over preferred', async () => {
  const preferred = harness(undefined, { preferredRegion: 'eu-central' });
  await preferred.turn.servers('u_aaaaaaaaaaaa');
  assert.deepEqual(preferred.calls[0].body, { ttl: '43200', initiator_client: 'u_aaaaaaaaaaaa', preferred_region: 'eu-central' });
  const { turn, calls } = harness(undefined, { fixedRegion: 'singapore', preferredRegion: 'eu-central' });
  await turn.servers('u_aaaaaaaaaaaa');
  assert.deepEqual(calls[0].body, { ttl: '43200', initiator_client: 'u_aaaaaaaaaaaa', fixed_region: 'singapore' });
});

test('environment: the token enables Turnix; no region is requested unless one is configured', () => {
  assert.deepEqual(turnOptionsFromEnv({}), { apiToken: undefined, fixedRegion: undefined, preferredRegion: undefined });
  assert.deepEqual(turnOptionsFromEnv({ TURNIX_API_TOKEN: ` ${apiToken} `, TURNIX_PREFERRED_REGION: ' ', TURNIX_FIXED_REGION: '' }), { apiToken, fixedRegion: undefined, preferredRegion: undefined });
  assert.deepEqual(turnOptionsFromEnv({ TURNIX_API_TOKEN: apiToken, TURNIX_PREFERRED_REGION: 'eu-central' }), { apiToken, fixedRegion: undefined, preferredRegion: 'eu-central' });
  assert.deepEqual(turnOptionsFromEnv({ TURNIX_API_TOKEN: apiToken, TURNIX_FIXED_REGION: 'singapore', TURNIX_PREFERRED_REGION: 'eu-central' }), { apiToken, fixedRegion: 'singapore', preferredRegion: undefined });
});

test('without a token nothing is requested', async () => {
  for (const options of [{ apiToken: undefined }, { apiToken: '' }]) {
    const { turn, calls } = harness(undefined, options);
    assert.equal(turn.enabled, false);
    assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), []);
    assert.equal(calls.length, 0);
  }
});

test('the credential lifetime outlasts the browser\'s six-hour ICE refresh plus reuse', async () => {
  // apps/web/src/media.ts refreshes /api/rtc every 6h. A served credential has at least ttl - reuse left, so
  // the one a client holds between refreshes must still be valid when the next refresh replaces it.
  const { turn, calls } = harness();
  await turn.servers('u_aaaaaaaaaaaa');
  const ttlMs = Number(calls[0].body.ttl) * 1000, reuseMs = 3_600_000, refreshMs = 6 * 3_600_000;
  assert.ok(ttlMs - reuseMs > refreshMs, `ttl ${ttlMs} - reuse ${reuseMs} must exceed the ${refreshMs} refresh`);
});

test('invalid responses serve no relay and report only the category', async () => {
  const bodies: (() => Response)[] = [
    () => new Response('<html>maintenance</html>', { headers: { 'content-type': 'text/html' } }),
    () => Response.json({}),
    () => Response.json({ iceServers: 'turn:singapore.turnix.io:3478' }),
    () => Response.json({ iceServers: [] }),
    // STUN only: no relay, so nothing worth serving over the static list.
    () => Response.json({ iceServers: [{ urls: ['stun:stun.turnix.io:3478'] }] }),
    // TURN without credentials cannot allocate.
    () => Response.json({ iceServers: [{ urls: ['turn:singapore.turnix.io:3478?transport=udp'], username: 'minted-username' }] }),
    () => Response.json({ iceServers: [{ urls: ['turn:singapore.turnix.io:53?transport=udp'], username: 'minted-username', credential: 'minted-credential' }] }),
    () => Response.json({ iceServers: [null, 7, { urls: [42] }] }),
  ];
  for (const body of bodies) {
    const { turn, failures, events } = harness(body);
    assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), []);
    assert.deepEqual(failures, [['invalid_response', undefined]]);
    assert.doesNotMatch(JSON.stringify(events), /minted-|maintenance/);
  }
});

test('API errors serve no relay and never log the response body', async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const { turn, failures, events } = harness(() => new Response(`{"error":"bad token ${apiToken}"}`, { status }));
    assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), []);
    assert.deepEqual(failures, [['http_error', status]]);
    assert.doesNotMatch(JSON.stringify(events), /turnix-project-token/);
  }
});

test('a timeout or network failure serves no relay', async () => {
  const hang = (_call: number, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  });
  const slow = harness(hang, { timeoutMs: 20 });
  const started = Date.now();
  // AbortSignal.timeout's timer is unref'd; in production the HTTP server keeps the event loop alive.
  const alive = setTimeout(() => {}, 5000);
  try { assert.deepEqual(await slow.turn.servers('u_aaaaaaaaaaaa'), []); } finally { clearTimeout(alive); }
  assert.ok(Date.now() - started < 2000, 'the request is abandoned at the timeout');
  assert.deepEqual(slow.failures, [['timeout', undefined]]);

  const offline = harness(() => { throw new TypeError('fetch failed'); });
  assert.deepEqual(await offline.turn.servers('u_aaaaaaaaaaaa'), []);
  assert.deepEqual(offline.failures, [['network', undefined]]);
});

test('after a failure Turnix is skipped for the backoff, then retried', async () => {
  const { turn, calls, advance } = harness(call => call === 1 ? new Response(null, { status: 503 }) : Response.json(turnix()));
  assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), []);
  assert.deepEqual(await turn.servers('u_bbbbbbbbbbbb'), []);
  assert.equal(calls.length, 1);
  advance(30_000);
  assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), expected());
  assert.equal(calls.length, 2);
});

test('one user\'s credential is reused for an hour; users never share one', async () => {
  const { turn, calls, advance } = harness(call => Response.json(turnix(`user-${call}`, `secret-${call}`)));
  const [first, concurrent] = await Promise.all([turn.servers('u_aaaaaaaaaaaa'), turn.servers('u_aaaaaaaaaaaa')]);
  assert.equal(calls.length, 1, 'concurrent joins share one request');
  assert.deepEqual(first, expected('user-1', 'secret-1'));
  assert.deepEqual(concurrent, first);
  advance(3_600_000 - 1);
  assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), first);
  assert.deepEqual(await turn.servers('u_bbbbbbbbbbbb'), expected('user-2', 'secret-2'));
  advance(1);
  assert.deepEqual(await turn.servers('u_aaaaaaaaaaaa'), expected('user-3', 'secret-3'));
  assert.equal(calls.length, 3);
});

test('a region Turnix substitutes for the requested one is reported', async () => {
  const fallback = () => Response.json({ iceServers: [{ username: 'minted-username', credential: 'minted-credential', urls: ['turn:eu-central.turnix.io:3478?transport=udp', 'turns:eu-central.turnix.io:443?transport=tcp'] }] });
  const { turn, events } = harness(fallback, { preferredRegion: 'singapore' });
  assert.equal((await turn.servers('u_aaaaaaaaaaaa')).length, 1, 'the substitute relay is still served');
  assert.deepEqual(events.find(entry => entry.event === 'rtc.turn_region_fallback')?.fields, {
    requested: 'singapore', relays: 'turn:eu-central.turnix.io:3478?transport=udp turns:eu-central.turnix.io:443?transport=tcp',
  });
  for (const options of [{ preferredRegion: 'singapore' }, {}]) {
    // Requested region honored, or none requested (any region Turnix picks is accepted).
    const honored = harness(undefined, options);
    await honored.turn.servers('u_aaaaaaaaaaaa');
    assert.equal(honored.events.some(entry => entry.event === 'rtc.turn_region_fallback'), false);
  }
});

test('Turnix\'s reported expiry caps reuse, and a lifetime shorter than requested is reported', async () => {
  let clock = 1_000_000;
  const respond = (lifetimeSeconds: number) => () => Response.json({ ...turnix(), expiresAt: new Date(clock + lifetimeSeconds * 1000).toISOString() });
  // Requested lifetime honored: reused for the full hour, nothing reported.
  const honored = harness(respond(43_200), { now: () => clock });
  await honored.turn.servers('u_aaaaaaaaaaaa');
  clock += 3_600_000 - 1;
  await honored.turn.servers('u_aaaaaaaaaaaa');
  assert.equal(honored.calls.length, 1);
  assert.equal(honored.events.some(entry => entry.event === 'rtc.turn_short_ttl'), false);
  // Turnix ignored the ttl (its default is 30 s): every join gets a fresh credential and the operator is told.
  const ignored = harness(respond(30), { now: () => clock });
  assert.deepEqual(await ignored.turn.servers('u_aaaaaaaaaaaa'), expected());
  assert.deepEqual(await ignored.turn.servers('u_aaaaaaaaaaaa'), expected());
  assert.equal(ignored.calls.length, 2, 'a credential that would expire before the next refresh is never reused');
  assert.deepEqual(ignored.events.find(entry => entry.event === 'rtc.turn_short_ttl')?.fields, { requestedSeconds: 43_200, effectiveSeconds: 30 });
});

// Real Express app in Hosted Mode (isPostgres on a disposable SQLite file); only Supabase's getUser and
// Turnix's endpoint are simulated.
async function hostedApp(respond: () => Response | Promise<Response>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-turn-'));
  const db = Object.assign(new SqliteAdapter(path.join(directory, 'test.sqlite')), { isPostgres: true });
  await db.createUser({ id: 'alice', username: 'alice', displayName: 'alice', settings: '{"profileCompleted":true}', createdAt: Date.now() });
  const token = ['e30', Buffer.from(JSON.stringify({ sub: 'alice', exp: Math.floor(Date.now() / 1000) + 3600, jti: randomUUID() })).toString('base64url'), 'signature'].join('.');
  const verifier = new SupabaseAuthVerifier('https://example.supabase.co', 'dummy-key');
  (verifier as any).client = { auth: { getUser: async (value: string) => value === token
    ? { data: { user: { id: 'alice', email: 'alice@haven.example', email_confirmed_at: new Date().toISOString() } }, error: null }
    : { data: { user: null }, error: Object.assign(new Error('invalid JWT'), { name: 'AuthApiError', status: 403 }) } } };
  const logs: DiagnosticEntry[] = [];
  const calls: RequestInit[] = [];
  const instance = createApp({
    dataDir: directory, db, supabaseVerifier: verifier, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-anon-key',
    diagnosticsSink: entry => logs.push(entry),
    turn: { apiToken, fetch: (async (_url: string, init: RequestInit) => { calls.push(init); return respond(); }) as typeof fetch },
  });
  await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
  const rtc = async (bearer?: string) => {
    const response = await fetch(`${base}/api/rtc`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    return { status: response.status, cache: response.headers.get('cache-control'), text: await response.text() };
  };
  return { token, rtc, logs, calls, close: async () => { await instance.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('Hosted /api/rtc serves Turnix relays ahead of the static STUN list, uncached, to signed-in users only', async () => {
  const previous = process.env.ICE_SERVERS_JSON;
  delete process.env.ICE_SERVERS_JSON;
  const context = await hostedApp(() => Response.json(turnix()));
  try {
    assert.equal((await context.rtc()).status, 401);
    assert.equal(context.calls.length, 0, 'unauthenticated requests never reach Turnix');
    const served = await context.rtc(context.token);
    assert.equal(served.status, 200);
    assert.equal(served.cache, 'no-store');
    assert.deepEqual(JSON.parse(served.text), { iceServers: [...expected(), { urls: 'stun:stun.l.google.com:19302' }] });
    assert.doesNotMatch(served.text, /turnix-project-token/);
    // Turnix sees a pseudonym, never the account id.
    const body = Object.fromEntries(context.calls[0].body as URLSearchParams);
    assert.match(body.initiator_client, /^u_[0-9a-f]{12}$/);
    assert.doesNotMatch(JSON.stringify(context.logs), /turnix-project-token|minted-/);
  } finally {
    await context.close();
    if (previous === undefined) delete process.env.ICE_SERVERS_JSON; else process.env.ICE_SERVERS_JSON = previous;
  }
});

test('Hosted /api/rtc falls back to STUN when Turnix fails', async () => {
  const previous = process.env.ICE_SERVERS_JSON;
  delete process.env.ICE_SERVERS_JSON;
  const context = await hostedApp(() => new Response(null, { status: 500 }));
  try {
    const served = await context.rtc(context.token);
    assert.equal(served.status, 200);
    assert.deepEqual(JSON.parse(served.text), { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    assert.deepEqual(context.logs.filter(entry => entry.event === 'rtc.turn_unavailable').map(({ errorType, status }) => ({ errorType, status })), [{ errorType: 'http_error', status: 500 }]);
  } finally {
    await context.close();
    if (previous === undefined) delete process.env.ICE_SERVERS_JSON; else process.env.ICE_SERVERS_JSON = previous;
  }
});

test('Local Mode never contacts Turnix, even with a token configured', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-turn-local-'));
  const previous = process.env.ICE_SERVERS_JSON;
  process.env.ICE_SERVERS_JSON = '[{"urls":"stun:stun.example:3478"}]';
  const calls: unknown[] = [];
  const logs: DiagnosticEntry[] = [];
  const instance = createApp({
    dataDir: directory, supabaseUrl: '', supabaseAnonKey: '', supabaseVerifier: null, diagnosticsSink: entry => logs.push(entry),
    turn: { apiToken, fetch: (async () => { calls.push(1); return Response.json(turnix()); }) as typeof fetch },
  });
  try {
    await new Promise<void>(resolve => instance.httpServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(instance.httpServer.address() as { port: number }).port}`;
    const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'localuser', password: 'local-password-123' }) });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const served = await fetch(`${base}/api/rtc`, { headers: { Cookie: cookie } });
    assert.equal(served.status, 200);
    assert.deepEqual(await served.json(), { iceServers: [{ urls: 'stun:stun.example:3478' }] });
    assert.equal(calls.length, 0);
    assert.ok(logs.some(entry => entry.event === 'turn.disabled_local_mode'));
  } finally {
    await instance.close();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ICE_SERVERS_JSON; else process.env.ICE_SERVERS_JSON = previous;
  }
});
