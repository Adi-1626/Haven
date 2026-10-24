import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchResource, isApiResource } from './api';
import { initSupabase, resetAuthClientForTesting } from './supabase';

test('private media authenticates, surfaces API failures and never sends tokens to third-party URLs', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __HAVEN_CONFIG__: { apiUrl: 'https://haven-api.example', supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test-publishable-key' },
    location: { origin: 'https://haven.pages.dev' },
  } });
  resetAuthClientForTesting();
  try {
    const client = await initSupabase();
    assert.ok(client);
    client.auth.getSession = (async () => ({ data: { session: { access_token: 'private-test-token' } }, error: null })) as typeof client.auth.getSession;
    const requests: { url: string; authorization: string | null; credentials?: RequestCredentials }[] = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), authorization: new Headers(init?.headers).get('Authorization'), credentials: init?.credentials });
      return Response.json({ ok: true });
    }) as typeof fetch;
    assert.equal(isApiResource('/api/sounds/one/audio'), true);
    assert.equal(isApiResource('https://haven-api.example/api/emojis/one/image'), true);
    assert.equal(isApiResource('https://haven-api.example.evil.example/api/emojis/one/image'), false);
    assert.equal(isApiResource('//evil.example/api/sounds/one/audio'), false);
    await fetchResource('/api/sounds/one/audio');
    await fetchResource('https://external.example/api/picture');
    await fetchResource('data:image/png;base64,AAAA');
    assert.deepEqual(requests, [
      // Hosted files redirect to signed Storage URLs (`Access-Control-Allow-Origin: *`), which a
      // credentialed request cannot follow. The bearer token authenticates; cookies are omitted.
      { url: 'https://haven-api.example/api/sounds/one/audio', authorization: 'Bearer private-test-token', credentials: 'omit' },
      { url: 'https://external.example/api/picture', authorization: null, credentials: 'omit' },
      { url: 'data:image/png;base64,AAAA', authorization: null, credentials: 'omit' },
    ]);
    globalThis.fetch = async () => Response.json({ error: 'Server permission denied' }, { status: 403 });
    await assert.rejects(fetchResource('/api/attachments/one'), /Server permission denied/);
  } finally {
    globalThis.fetch = previousFetch;
    resetAuthClientForTesting();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('cookie-authenticated Local Mode includes credentials for private media only', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://127.0.0.1:3107', hostname: '127.0.0.1' } } });
  resetAuthClientForTesting();
  try {
    const requests: { url: string; authorization: string | null; credentials?: RequestCredentials }[] = [];
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith('/api/config')) return Response.json({ mode: 'local' });
      requests.push({ url: String(input), authorization: new Headers(init?.headers).get('Authorization'), credentials: init?.credentials });
      return Response.json({ ok: true });
    }) as typeof fetch;
    await fetchResource('/api/sounds/one/audio');
    await fetchResource('https://external.example/api/picture');
    assert.deepEqual(requests, [
      { url: '/api/sounds/one/audio', authorization: null, credentials: 'include' },
      { url: 'https://external.example/api/picture', authorization: null, credentials: 'omit' },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    resetAuthClientForTesting();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
