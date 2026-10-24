import { test, expect, _electron as electron, type APIRequestContext, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectCleanProductUI } from './production-ui-assertions';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const frontend = 'http://127.0.0.1:3111';
const api = 'http://127.0.0.1:3110';
const auth = 'https://haven-hosted-test.supabase.co/auth/v1';

test('hosted registration requires email verification and preserves sign-in and password recovery', async ({ page }, info) => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  await page.route(`${auth}/**`, async route => {
    const request = route.request();
    requests.push({ url: request.url(), body: request.postDataJSON() || {} });
    if (request.url().includes('/signup')) return route.fulfill({ json: { id: 'unverified-user', email: 'unverified@haven.example', email_confirmed_at: null, identities: [], user_metadata: {} } });
    if (request.url().includes('/token')) return route.fulfill({ status: 400, json: { code: 'email_not_confirmed', msg: 'Email not confirmed' } });
    if (request.url().includes('/recover')) return route.fulfill({ json: {} });
    throw new Error(`Unexpected auth request: ${request.url()}`);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Join Haven', exact: true }).click();
  await expect(page.getByLabel('EMAIL ADDRESS', { exact: true })).toBeVisible();
  // Stage 1 collects credentials only; the profile is chosen after verification.
  await expect(page.getByLabel('USERNAME', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('DISPLAY NAME', { exact: true })).toHaveCount(0);
  await expectCleanProductUI(page);
  await page.screenshot({ path: info.outputPath('hosted-registration.png') });
  await page.getByLabel('EMAIL ADDRESS', { exact: true }).fill('unverified@haven.example');
  await page.getByLabel('PASSWORD', { exact: true }).fill('Hosted-password-2026');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('check your email to verify');
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await page.getByLabel('EMAIL ADDRESS', { exact: true }).fill('unverified@haven.example');
  await page.getByLabel('PASSWORD', { exact: true }).fill('Hosted-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email not confirmed');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Forgot your password?', exact: true }).click();
  await page.getByLabel('EMAIL ADDRESS', { exact: true }).fill('unverified@haven.example');
  await page.getByRole('button', { name: 'Send recovery link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('a password reset link has been sent');
  await expectCleanProductUI(page);
  const signup = requests.find(request => request.url.includes('/signup'))!;
  expect(signup.body.email).toBe('unverified@haven.example');
  expect(JSON.stringify(signup.body), 'no profile data is sent to the auth service at registration').not.toMatch(/username|display/i);
  expect(requests.find(request => request.url.includes('/recover'))?.body.email).toBe('unverified@haven.example');
  expect(requests.some(request => new URL(request.url).searchParams.get('redirect_to') === `${frontend}/`)).toBe(true);
});

test('password reset form validates confirmation and sends the new password through hosted auth', async ({ page, request }) => {
  const registered = await request.post(`${api}/api/auth/register`, { data: { username: `recovery_${Date.now()}`, password: 'Recovery-initial-2026' } });
  expect(registered.status()).toBe(201);
  const { user } = await registered.json();
  const token = registered.headers()['set-cookie'].split(';')[0].split('=')[1];
  const verifiedUser = { ...user, email: 'recovery@haven.example', email_confirmed_at: new Date().toISOString(), user_metadata: {} };
  let password: string | undefined;
  await page.route(`${auth}/**`, async route => {
    if (route.request().method() === 'PUT') password = route.request().postDataJSON().password;
    await route.fulfill({ json: verifiedUser });
  });
  const fragment = new URLSearchParams({ access_token: token, refresh_token: 'test-refresh', expires_in: '3600', token_type: 'bearer', type: 'recovery' });
  await page.goto(`/#${fragment}`);
  const dialog = page.getByRole('dialog', { name: 'Choose a new password', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('NEW PASSWORD', { exact: true }).fill('Recovery-updated-2026');
  await dialog.getByLabel('CONFIRM NEW PASSWORD', { exact: true }).fill('Recovery-mismatch-2026');
  await dialog.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Passwords do not match');
  expect(password).toBeUndefined();
  await dialog.getByLabel('CONFIRM NEW PASSWORD', { exact: true }).fill('Recovery-updated-2026');
  await dialog.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(password).toBe('Recovery-updated-2026');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expectCleanProductUI(page);
});

// ---------------------------------------------------------------------------------------------------------------------
// Real hosted-mode integration: the production web build, the real Haven backend (SQLite + local file storage in a
// disposable directory) and the backend's real Supabase token path (SupabaseAuthVerifier -> ensureHavenUser -> profile
// onboarding endpoints). Only the Supabase GoTrue HTTP service and JWT lookup are simulated; no real Supabase project,
// mailbox or production data is touched. Email delivery and a real GoTrue server are NOT covered here.
// ---------------------------------------------------------------------------------------------------------------------
type Accounts = Record<string, { verified: boolean; legacy?: boolean }>;
const accountEmail = (name: string) => `${name}.${Date.now()}@haven.example`;
const jwt = (email: string, legacy = false) => `hosted-jwt${legacy ? '-legacy' : ''}:${email}`;
const bearer = (email: string, legacy = false) => ({ Authorization: `Bearer ${jwt(email, legacy)}` });

async function simulateGoTrue(page: Page, accounts: Accounts, signups: Record<string, unknown>[] = []) {
  // Like real GoTrue, every issued session carries a distinct access token (the backend denies a
  // signed-out token for its remaining lifetime, so a reused token would look like a revoked one).
  let issued = 0;
  const session = (email: string) => {
    const account = accounts[email];
    return { access_token: `${jwt(email, account.legacy)}#${++issued}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh:${email}`, user: { id: 'gotrue-user', aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() } };
  };
  await page.route(`${auth}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.method() === 'POST' ? (request.postDataJSON() || {}) : {};
    if (url.pathname.endsWith('/signup')) {
      signups.push(body);
      accounts[body.email] = { verified: false };
      return route.fulfill({ json: { id: 'gotrue-user', email: body.email, email_confirmed_at: null, identities: [{}], user_metadata: body.data || {} } });
    }
    if (url.pathname.endsWith('/token')) {
      const email: string = url.searchParams.get('grant_type') === 'refresh_token' ? String(body.refresh_token).replace('refresh:', '') : body.email;
      const account = accounts[email];
      if (!account) return route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } });
      if (!account.verified) return route.fulfill({ status: 400, json: { code: 'email_not_confirmed', msg: 'Email not confirmed' } });
      return route.fulfill({ json: session(email) });
    }
    if (url.pathname.endsWith('/user')) {
      const email = (request.headers()['authorization'] || '').replace(/^Bearer hosted-jwt(?:-legacy)?:/, '').replace(/#\d+$/, '');
      return accounts[email] ? route.fulfill({ json: session(email).user }) : route.fulfill({ status: 401, json: {} });
    }
    return route.fulfill({ status: url.pathname.endsWith('/logout') ? 204 : 200, json: {} });
  });
}

async function signIn(page: Page, email: string) {
  await page.getByLabel('EMAIL ADDRESS', { exact: true }).fill(email);
  await page.getByLabel('PASSWORD', { exact: true }).fill('Hosted-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
}

async function testPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 700; canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3b82f6'; context.fillRect(0, 0, 700, 480);
    context.fillStyle = '#fff'; context.beginPath(); context.arc(350, 240, 120, 0, Math.PI * 2); context.fill();
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    let binary = ''; new Uint8Array(await blob.arrayBuffer()).forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

async function me(request: APIRequestContext, email: string, legacy = false) {
  const response = await request.get(`${api}/api/bootstrap`, { headers: bearer(email, legacy) });
  expect(response.status()).toBe(200);
  return (await response.json()).user;
}

test('hosted new account: credentials -> verification -> real-backend profile setup -> Haven, persisted across reload and sign-in', async ({ page, request }, info) => {
  const accounts: Accounts = {};
  const signups: Record<string, unknown>[] = [];
  await simulateGoTrue(page, accounts, signups);
  const taken = `taken_${Date.now().toString(36)}`;
  expect((await request.post(`${api}/api/auth/register`, { data: { username: taken, password: 'Hosted-password-2026' } })).status()).toBe(201);

  const email = accountEmail('new.person');
  await page.goto('/');
  await page.getByRole('button', { name: 'Join Haven', exact: true }).click();
  await page.getByLabel('EMAIL ADDRESS', { exact: true }).fill(email);
  await page.getByLabel('PASSWORD', { exact: true }).fill('Hosted-password-2026');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('check your email to verify');
  expect(JSON.stringify(signups[0]), 'registration sends credentials only').not.toMatch(/username|display/i);

  await signIn(page, email); // not verified yet
  await expect(page.getByRole('alert')).toContainText('Email not confirmed');
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toHaveCount(0);
  accounts[email].verified = true; // the person clicked the verification link
  await signIn(page, email);

  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('USERNAME', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('DISPLAY NAME', { exact: true })).toHaveValue('');
  await page.screenshot({ path: info.outputPath('hosted-onboarding-empty.png') });
  const placeholder = await me(request, email);
  expect(placeholder.settings.profileCompleted).toBe(false);
  expect(placeholder.username).toMatch(/^user_[a-f0-9]{10}$/);
  expect(JSON.stringify(placeholder), 'the email address is not turned into a public identity').not.toContain('new.person');

  const username = page.getByLabel('USERNAME', { exact: true });
  const status = page.locator('.auth-field-status');
  await username.fill(taken);
  await expect(status).toHaveText('That username is already taken'); // answered by the real backend
  await username.fill('Admin');
  await expect(status).toHaveText('That username is reserved');
  const chosen = `new_person_${Date.now().toString(36)}`;
  await username.fill(chosen);
  await expect(status).toHaveText(`@${chosen} is available`);
  await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await testPhoto(page) });
  await expect(page.locator('img.onboarding-avatar-img')).toBeVisible();
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill('New Person');
  await page.getByRole('button', { name: 'Complete Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 15_000 });

  // Persisted in the backend database and storage, not just in the browser
  const saved = await me(request, email);
  expect(saved).toMatchObject({ username: chosen, displayName: 'New Person', settings: { profileCompleted: true } });
  expect(saved.avatar).toMatch(/^\/api\/users\/[a-f0-9-]+\/avatar\?v=[a-f0-9-]+\.(webp|jpg|png)$/);
  const picture = await request.get(`${api}${saved.avatar}`, { headers: bearer(email) });
  expect(picture.status()).toBe(200);
  expect(picture.headers()['content-type']).toMatch(/^image\//);
  expect((await picture.body()).length).toBeGreaterThan(100);
  expect((await request.post(`${api}/api/users/me/profile`, { headers: bearer(email), data: { username: 'second_attempt', displayName: 'Nope' } })).status()).toBe(409);

  await page.reload(); // a fresh load restores the session and goes straight to Haven
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toHaveCount(0);
  await signOut(page);
  await signIn(page, email);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('hosted-haven-after-onboarding.png') });
});

test('hosted incomplete profile returns to onboarding on reload and on every sign-in until it is completed', async ({ page, request }) => {
  const email = accountEmail('half.done');
  const accounts: Accounts = { [email]: { verified: true } };
  await simulateGoTrue(page, accounts);
  await page.goto('/');
  await signIn(page, email);
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill('Half Done');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await signIn(page, email);
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible({ timeout: 15_000 });
  expect((await me(request, email)).settings.profileCompleted).toBe(false);
  const chosen = `half_done_${Date.now().toString(36)}`;
  await page.getByLabel('USERNAME', { exact: true }).fill(chosen);
  await expect(page.locator('.auth-field-status')).toHaveText(`@${chosen} is available`);
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill('Half Done');
  await page.getByRole('button', { name: 'Complete Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await me(request, email)).toMatchObject({ username: chosen, settings: { profileCompleted: true } });
});

test('hosted email-verification link lands in profile setup, not in Haven', async ({ page, request }) => {
  const email = accountEmail('link.click');
  const accounts: Accounts = { [email]: { verified: true } };
  await simulateGoTrue(page, accounts);
  // What GoTrue redirects to after the person clicks the confirmation link in the verification email.
  const fragment = new URLSearchParams({ access_token: jwt(email), refresh_token: `refresh:${email}`, expires_in: '3600', token_type: 'bearer', type: 'signup' });
  await page.goto(`/#${fragment}`);
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  expect((await me(request, email)).settings.profileCompleted).toBe(false);
});

test('hosted existing member with a completed profile signs in straight to Haven and keeps their identity', async ({ page, request }) => {
  const email = accountEmail('old.hand');
  const accounts: Accounts = { [email]: { verified: true, legacy: true } };
  await simulateGoTrue(page, accounts);
  await page.goto('/');
  await signIn(page, email);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toHaveCount(0);
  const profile = await me(request, email, true);
  expect(profile).toMatchObject({ displayName: 'Existing Member', settings: { profileCompleted: true } });
  expect(profile.username).toMatch(/^old_hand_/);
});

test('password recovery remains accessible for an incomplete hosted profile and returns to onboarding', async ({ page, request }) => {
  const email = accountEmail('recover.incomplete');
  await simulateGoTrue(page, { [email]: { verified: true } });
  const fragment = new URLSearchParams({ access_token: jwt(email), refresh_token: `refresh:${email}`, expires_in: '3600', token_type: 'bearer', type: 'recovery' });
  await page.goto(`/#${fragment}`);
  const dialog = page.getByRole('dialog', { name: 'Choose a new password', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('NEW PASSWORD', { exact: true }).fill('Recovered-password-2026');
  await dialog.getByLabel('CONFIRM NEW PASSWORD', { exact: true }).fill('Recovered-password-2026');
  await dialog.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  expect((await me(request, email)).settings.profileCompleted).toBe(false);
});

test('Electron uses its configured hosted address without a host picker or starting a local backend', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'haven-clean-hosted-'));
  const env = { ...process.env, HAVEN_PROFILE_DIR: profile, HAVEN_SERVER: frontend, NODE_ENV: 'production' };
  for (const key of Object.keys(env)) if (/SUPABASE|DATABASE_URL|HAVEN_ENV_FILE|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key as keyof typeof env];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [root], env });
    const page = await app.firstWindow();
    await expect(page.getByLabel('EMAIL ADDRESS', { exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(frontend);
    expect(await page.evaluate(() => window.haven!.getConnection())).toEqual({ url: frontend, local: true });
    expect(existsSync(path.join(profile, 'server'))).toBe(false);
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)).toBe(true);
    await expectCleanProductUI(page);
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forgot your password?', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__HAVEN_CONFIG__?.apiUrl)).toBe(api);
  } finally {
    await app?.close();
    expect(path.dirname(path.resolve(profile))).toBe(path.resolve(tmpdir()));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
