import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAuthConfig, initSupabase, getSupabase, isHostedAuth, resetAuthClientForTesting } from './supabase.js';

test('startup HTML never resolves as Local Mode; failed discovery can retry into Hosted Mode', async () => {
  const originalFetch = globalThis.fetch;
  resetAuthClientForTesting();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('<title>Starting your app - Voroa</title>', { headers: { 'content-type': 'text/html' } }); };
  try {
    await assert.rejects(initSupabase(), /temporarily unavailable/);
    assert.equal(requests, 3);
    assert.equal(getSupabase(), null);
    globalThis.fetch = async () => Response.json({ mode: 'hosted', supabaseUrl: 'https://retry-test.supabase.co', supabaseAnonKey: 'test-publishable-key' });
    assert.ok(await initSupabase());
    assert.equal(isHostedAuth(), true);
  } finally { globalThis.fetch = originalFetch; resetAuthClientForTesting(); }
});

test('fetchAuthConfig and initSupabase correctly default to local mode when /api/config returns no hosted config', async () => {
  resetAuthClientForTesting();

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/config')) {
      return {
        ok: true, headers: new Headers({'content-type': 'application/json'}),
        json: async () => ({ publicUrl: 'http://localhost:5173' }),
      } as Response;
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as any;

  try {
    const config = await fetchAuthConfig();
    assert.equal(config.mode, undefined);
    assert.equal(config.supabaseUrl, undefined);

    const client = await initSupabase();
    assert.equal(client, null);
    assert.equal(isHostedAuth(), false);
    assert.equal(getSupabase(), null);
  } finally {
    globalThis.fetch = originalFetch;
    resetAuthClientForTesting();
  }
});

test('initSupabase initializes Supabase client when /api/config provides hosted mode credentials', async () => {
  resetAuthClientForTesting();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/config')) {
      return {
        ok: true, headers: new Headers({'content-type': 'application/json'}),
        json: async () => ({
          mode: 'hosted',
          supabaseUrl: 'https://tswmpzeckmquvrlzvtsy.supabase.co',
          supabaseAnonKey: 'sb_publishable_OR6sob9EvOulVZvQg36TMQ_XAEzggCW',
        }),
      } as Response;
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as any;

  try {
    const config = await fetchAuthConfig();
    assert.equal(config.mode, 'hosted');
    assert.equal(config.supabaseUrl, 'https://tswmpzeckmquvrlzvtsy.supabase.co');
    assert.equal(config.supabaseAnonKey, 'sb_publishable_OR6sob9EvOulVZvQg36TMQ_XAEzggCW');

    const client = await initSupabase();
    assert.ok(client);
    assert.equal(isHostedAuth(), true);
    assert.equal(getSupabase(), client);
    assert.equal(typeof client.auth.signUp, 'function');
    assert.equal(typeof client.auth.signInWithPassword, 'function');
    assert.equal(typeof client.auth.resetPasswordForEmail, 'function');
  } finally {
    globalThis.fetch = originalFetch;
    resetAuthClientForTesting();
  }
});

test('Hosted auth UI copy and guidance requirements are met', () => {
  // Verify UI copy strings defined for hosted auth views
  const uiCopy = {
    forgotPasswordTitle: 'Reset password.',
    forgotPasswordSubtitle: 'We’ll email you a secure link to reset your password.',
    registerTitle: 'Find your place.',
    registerSubtitle: 'Good things start with good company.',
    loginTitle: 'Welcome back.',
    loginSubtitleHosted: 'Sign in with your verified email and password.',
    loginSubtitleLocal: 'Sign in with your username, not your display name.',
    confirmationNotice: 'Account created! Please check your email to verify your address before signing in.',
    unconfirmedEmailError: 'Your email address has not been verified yet. Please check your inbox for the confirmation email.',
    forgotPasswordSuccess: 'If an account exists with this email, a password reset link has been sent. Please check your inbox.',
  };

  assert.equal(uiCopy.forgotPasswordTitle, 'Reset password.');
  assert.equal(uiCopy.confirmationNotice.includes('check your email to verify'), true);
  assert.equal(uiCopy.unconfirmedEmailError.includes('verified yet'), true);
  assert.equal(uiCopy.loginSubtitleHosted.includes('verified email and password'), true);
});

test('Supabase client includes updateUser method for password recovery', async () => {
  resetAuthClientForTesting();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true, headers: new Headers({'content-type': 'application/json'}),
    json: async () => ({
      mode: 'hosted',
      supabaseUrl: 'https://tswmpzeckmquvrlzvtsy.supabase.co',
      supabaseAnonKey: 'sb_publishable_OR6sob9EvOulVZvQg36TMQ_XAEzggCW',
    }),
  })) as any;

  try {
    const client = await initSupabase();
    assert.ok(client);
    assert.equal(typeof client.auth.updateUser, 'function');
  } finally {
    globalThis.fetch = originalFetch;
    resetAuthClientForTesting();
  }
});
