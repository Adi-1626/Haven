import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// MOCK UI TEST MODE (npm run dev:ui). The real web app runs in a real browser against a dev-server stand-in for
// Supabase Auth and the Haven API (apps/web/src/ui-mode). This verifies the UI flow and visuals. It is NOT a real
// hosted-mode integration test: see hosted-ui.spec.ts for the real backend, and docs/AUTH-ONBOARDING.md.

const shots = path.resolve('docs/screenshots/ui-testing-mode/auth');
fs.mkdirSync(shots, { recursive: true });

const sizes = [
  { name: '390x844-mobile', width: 390, height: 844 },
  { name: '500x550-compact', width: 500, height: 550 },
  { name: '768x1024-tablet', width: 768, height: 1024 },
  { name: '1280x720-laptop', width: 1280, height: 720 },
  { name: '1366x768-desktop', width: 1366, height: 768 },
  { name: '1920x1080-fullhd', width: 1920, height: 1080 },
];

async function emulateTransparency(page: Page, value: 'reduce' | 'no-preference') {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });
}

async function signedOut(page: Page, transparency: 'reduce' | 'no-preference' = 'no-preference') {
  await emulateTransparency(page, transparency);
  await page.request.post('/api/__mock/auth/reset');
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('haven.ui.mock.session', 'out'));
  await page.reload();
  await expect(page.locator('.auth-card')).toBeVisible();
  await expect(page.locator('.orbital-canvas')).toBeVisible();
}

async function register(page: Page, email: string, password = 'zenithpass123') {
  await page.locator('.auth-toggle button', { hasText: 'Join Haven' }).click();
  await expect(page.locator('.auth-card-header h2')).toContainText('Find your place');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
}

async function signIn(page: Page, email: string, password = 'zenithpass123') {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
}

async function signOutFromOnboarding(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('.auth-card-header h2')).toContainText('Welcome back');
}

/** A real, decodable, non-square PNG so the circular crop has something to crop. */
async function photo(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 420;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 640, 420);
    gradient.addColorStop(0, '#ff7a59'); gradient.addColorStop(1, '#3b82f6');
    context.fillStyle = gradient; context.fillRect(0, 0, 640, 420);
    context.fillStyle = '#fff'; context.beginPath(); context.arc(320, 210, 90, 0, Math.PI * 2); context.fill();
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth, offenders: [...document.querySelectorAll('.auth-card *')].filter(element => { const rect = element.getBoundingClientRect(); const card = element.closest('.auth-card')!.getBoundingClientRect(); return rect.width > 0 && (rect.right > card.right + 1 || rect.left < card.left - 1); }).map(element => element.tagName + '.' + element.className).slice(0, 5) }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.offenders, 'no control may extend past the glass card').toEqual([]);
}

/** Labels, headings, helper text, inputs and buttons must not overlap each other. */
async function noOverlaps(page: Page) {
  const overlaps = await page.evaluate(() => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const items = [...document.querySelectorAll('.auth-card label, .auth-card h2, .auth-card .auth-card-description, .auth-card input:not([type=checkbox]):not([hidden]), .auth-card button[type=submit], .auth-card .auth-field-status, .auth-card .auth-field-hint, .auth-card .auth-steps, .auth-card .onboarding-avatar-circle, .auth-card .onboarding-link-btn, .auth-card .auth-toggle')].filter(visible);
    const found: string[] = [];
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      if (items[a].contains(items[b]) || items[b].contains(items[a])) continue;
      const first = items[a].getBoundingClientRect(); const second = items[b].getBoundingClientRect();
      const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      if (width > 1.5 && height > 1.5) found.push(`${items[a].tagName}.${items[a].className || items[a].textContent?.slice(0, 18)} x ${items[b].tagName}.${items[b].className || items[b].textContent?.slice(0, 18)}`);
    }
    return found;
  });
  expect(overlaps).toEqual([]);
}

/** Every control is reachable: the page (or card) scrolls vertically and the submit button can be brought fully into view. */
async function reachable(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
}

/**
 * Worst-case text contrast over the glass. The scene is frozen (reduced motion), text is made transparent, the card is
 * photographed, and each text box is compared against the brightest (for light text) or darkest (for dark text)
 * backdrop pixel it sits on.
 */
async function contrastReport(page: Page) {
  const items = await page.evaluate(() => [...document.querySelectorAll('.auth-card .auth-field-label label, .auth-card .auth-checkbox-label span, .auth-card h2, .auth-card .auth-card-description, .auth-card .auth-field-status, .auth-card .auth-field-hint, .auth-card .auth-toggle, .auth-card .auth-step-label, .auth-card button[type=submit] span')]
    .filter(element => element.getBoundingClientRect().width > 0 && element.textContent?.trim())
    .map(element => { const rect = element.getBoundingClientRect(); const color = getComputedStyle(element).color.match(/[\d.]+/g)!.map(Number); return { text: element.textContent!.trim().slice(0, 30), x: rect.x, y: rect.y, w: rect.width, h: rect.height, color }; }));
  const style = await page.addStyleTag({ content: '.auth-card * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } .auth-card input::placeholder { color: transparent !important; }' });
  await page.waitForTimeout(250);
  const image = (await page.screenshot()).toString('base64');
  await style.evaluate(node => node.remove());
  return page.evaluate(async ({ items, image }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${image}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const scale = bitmap.width / window.innerWidth;
    const channel = (value: number) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
    const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    return items.map(item => {
      const data = context.getImageData(Math.max(0, Math.floor(item.x * scale)), Math.max(0, Math.floor(item.y * scale)), Math.max(1, Math.floor(item.w * scale)), Math.max(1, Math.floor(item.h * scale))).data;
      const values: number[] = [];
      for (let index = 0; index < data.length; index += 16) values.push(luminance(data[index], data[index + 1], data[index + 2]));
      const text = luminance(item.color[0], item.color[1], item.color[2]);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      const background = text > average ? Math.max(...values) : Math.min(...values);
      const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      return { text: item.text, ratio: +ratio.toFixed(2) };
    });
  }, { items, image });
}

test.describe('Authentication and first-time profile (mock UI test mode)', () => {
  test('1. Registration collects credentials only: no username or display name, with the two-stage indicator', async ({ page }) => {
    await signedOut(page);
    await expect(page.locator('.auth-card-header h2')).toContainText('Welcome back');
    await page.locator('.auth-toggle button', { hasText: 'Join Haven' }).click();
    await expect(page.locator('.auth-card-header h2')).toContainText('Find your place');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="username"]')).toHaveCount(0);
    await expect(page.locator('input[name="displayName"]')).toHaveCount(0);
    await expect(page.getByLabel('USERNAME')).toHaveCount(0);
    await expect(page.getByLabel('DISPLAY NAME')).toHaveCount(0);
    await expect(page.locator('.auth-steps')).toHaveAccessibleName('Step 1 of 2: Create your account');
    await expect(page.locator('.auth-card-description')).toContainText('choose your name and picture next');
    await page.screenshot({ path: path.join(shots, 'flow-1-register-credentials-only.png') });
  });

  test('2. New user: register -> verify email -> sign in -> profile setup -> Haven, persisted across reload and sign-in', async ({ page }) => {
    await signedOut(page);
    const email = `voyager.${Date.now()}@haven.test`;
    await register(page, email);
    await expect(page.locator('.auth-success')).toContainText('check your email to verify');
    await expect(page.locator('.auth-card-header h2')).toContainText('Welcome back');

    // The email has not been verified yet: no session, no onboarding, no Haven.
    await signIn(page, email);
    await expect(page.locator('.auth-error-banner')).toContainText('Email not confirmed');
    await expect(page.locator('.auth-onboarding-card')).toHaveCount(0);
    await expect(page.locator('.server-rail')).toHaveCount(0);

    // Clicking the verification link (simulated by the test-mode server), then signing in.
    expect((await page.request.post('/api/__mock/auth/confirm', { data: { email } })).ok()).toBe(true);
    await signIn(page, email);

    // Stage 2: dedicated profile setup. The placeholder identity is never offered as a default.
    const card = page.locator('.auth-onboarding-card');
    await expect(card).toBeVisible();
    await expect(card.locator('h2')).toContainText('Make it yours');
    await expect(page.locator('.auth-steps')).toHaveAccessibleName('Step 2 of 2: Set up your profile');
    await expect(page.getByLabel('USERNAME')).toHaveValue('');
    await expect(page.getByLabel('DISPLAY NAME')).toHaveValue('');
    const complete = page.getByRole('button', { name: 'Complete Profile' });
    await expect(complete).toBeDisabled();
    await page.screenshot({ path: path.join(shots, 'flow-2a-profile-empty.png') });

    // Username validation and availability feedback
    const username = page.getByLabel('USERNAME');
    const status = page.locator('.auth-field-status');
    await username.fill('ab');
    await expect(status).toHaveText('Use at least 3 characters');
    await username.fill('bad name!');
    await expect(status).toHaveText('Use letters, numbers, underscores, dots or hyphens');
    await username.fill('Admin');
    await expect(status).toHaveText('That username is reserved');
    await username.fill('alex_zenith');
    await expect(status).toHaveText('That username is already taken');
    await expect(username).toHaveAttribute('aria-invalid', 'true');
    await page.screenshot({ path: path.join(shots, 'flow-2b-username-taken.png') });
    await username.fill('cosmic.voyager');
    await expect(status).toHaveText('@cosmic.voyager is available');
    await expect(page.locator('.auth-input-wrap.valid')).toBeVisible();
    await expect(complete).toBeDisabled(); // a display name is still required

    // Avatar: real file -> circular preview
    const circle = page.locator('.onboarding-avatar-circle');
    await expect(circle).toHaveCSS('border-radius', '50%');
    await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await photo(page) });
    const preview = circle.locator('img.onboarding-avatar-img');
    await expect(preview).toBeVisible();
    const size = await preview.evaluate((image: HTMLImageElement) => ({ natural: [image.naturalWidth, image.naturalHeight], box: [image.getBoundingClientRect().width, image.getBoundingClientRect().height], radius: getComputedStyle(image).borderRadius }));
    expect(size.natural[0]).toBe(size.natural[1]); // cropped to a square
    expect(size.natural[0]).toBeLessThanOrEqual(512);
    expect(Math.abs(size.box[0] - size.box[1])).toBeLessThan(1);
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
    await page.getByLabel('DISPLAY NAME').fill('Cosmic Voyager');
    await expect(complete).toBeEnabled();
    await page.waitForTimeout(300); // let the button's enable transition finish before photographing it
    await page.screenshot({ path: path.join(shots, 'flow-2c-profile-ready.png') });

    await complete.click();
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.user-panel')).toContainText('Cosmic Voyager');
    await expect(page.locator('.user-panel .avatar img')).toBeVisible();
    await expect(page.locator('.auth-onboarding-card')).toHaveCount(0);

    // Persistence: a reload (new page load, same stored session) goes straight to Haven.
    await page.reload();
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.user-panel')).toContainText('Cosmic Voyager');
    await expect(page.locator('.auth-onboarding-card')).toHaveCount(0);

    // And so does signing out and back in.
    await page.locator('.user-panel .user-settings').click();
    await page.locator('.settings-layout nav button.danger-text', { hasText: 'Sign out' }).click();
    await expect(page.locator('.auth-card-header h2')).toContainText('Welcome back');
    await signIn(page, email);
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.user-panel')).toContainText('Cosmic Voyager');
    await expect(page.locator('.auth-onboarding-card')).toHaveCount(0);
    // The picture was really stored and served back.
    const identity = JSON.parse(await page.evaluate(() => localStorage.getItem('haven.ui.mock.session')!));
    const headers = { Authorization: `Bearer mock-ui-token:${identity.id}` };
    const profile = (await (await page.request.get('/api/bootstrap', { headers })).json()).user;
    expect(profile).toMatchObject({ username: 'cosmic.voyager', displayName: 'Cosmic Voyager', settings: { profileCompleted: true } });
    expect(profile.avatar).toMatch(/^\/api\/users\/.+\/avatar\?v=[a-f0-9]+\.(webp|jpg|png)$/);
    const served = await page.request.get(profile.avatar, { headers });
    expect(served.ok()).toBe(true);
    expect(served.headers()['content-type']).toMatch(/^image\//);
    expect((await served.body()).length).toBeGreaterThan(100);
  });

  test('3. Incomplete profile: onboarding returns after reload and after signing in again, until completed', async ({ page }) => {
    await signedOut(page);
    const email = `halfway.${Date.now()}.autoverify@haven.test`;
    await register(page, email);
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    await page.getByLabel('DISPLAY NAME').fill('Half Way');

    await page.reload(); // nothing saved yet: the server still says the profile is incomplete
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.server-rail')).toHaveCount(0);

    await signOutFromOnboarding(page);
    await signIn(page, email);
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.server-rail')).toHaveCount(0);

    await page.getByLabel('USERNAME').fill('half_way');
    await expect(page.locator('.auth-field-status')).toHaveText('@half_way is available');
    await page.getByLabel('DISPLAY NAME').fill('Half Way');
    await page.getByRole('button', { name: 'Complete Profile' }).click();
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.user-panel')).toContainText('Half Way');
  });

  test('4. Existing user with a completed profile signs in straight to Haven', async ({ page }) => {
    await signedOut(page);
    await signIn(page, 'alex.zenith@haven.local', 'password123');
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.user-panel')).toContainText('Alex Mercer');
    await expect(page.locator('.auth-onboarding-card')).toHaveCount(0);
  });

  test('5. Username races and server-side validation surface clearly and keep the form usable', async ({ page }) => {
    await signedOut(page);
    await register(page, `race.${Date.now()}.autoverify@haven.test`);
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    await page.getByLabel('USERNAME').fill('free_name');
    await expect(page.locator('.auth-field-status')).toHaveText('@free_name is available');
    await page.getByLabel('DISPLAY NAME').fill('Racer');
    // Someone else claims the name between the availability check and submitting.
    await page.route('**/api/users/me/profile', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'That username is already taken' }) }));
    await page.getByRole('button', { name: 'Complete Profile' }).click();
    await expect(page.locator('.auth-field-status')).toHaveText('That username was just taken. Try another.');
    await expect(page.getByLabel('USERNAME')).toBeFocused();
    await expect(page.locator('.server-rail')).toHaveCount(0);
    await page.unroute('**/api/users/me/profile');
    await page.getByLabel('USERNAME').fill('free_name_2');
    await expect(page.locator('.auth-field-status')).toHaveText('@free_name_2 is available');
    await page.getByRole('button', { name: 'Complete Profile' }).click();
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
  });

  test('6. Photo validation: unsupported or oversized files are rejected before upload; the picture is optional', async ({ page }) => {
    await signedOut(page);
    await register(page, `photo.${Date.now()}.autoverify@haven.test`);
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    let uploads = 0;
    page.on('request', request => { if (request.url().includes('/api/users/me/avatar')) uploads++; });
    await page.locator('input[type=file]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.locator('.onboarding-photo-error')).toContainText('PNG, JPEG, WebP or GIF');
    await page.locator('input[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('definitely not a png') });
    await expect(page.locator('.onboarding-photo-error')).toContainText('could not be read');
    await expect(page.locator('img.onboarding-avatar-img')).toHaveCount(0);
    // Remove after choosing a valid photo restores the empty circle; completing without any photo works.
    await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await photo(page) });
    await expect(page.locator('img.onboarding-avatar-img')).toBeVisible();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('img.onboarding-avatar-img')).toHaveCount(0);
    await page.getByLabel('USERNAME').fill('no_photo');
    await expect(page.locator('.auth-field-status')).toHaveText('@no_photo is available');
    await page.getByLabel('DISPLAY NAME').fill('No Photo');
    await page.getByRole('button', { name: 'Complete Profile' }).click();
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 8_000 });
    expect(uploads).toBe(0);
  });

  test('7. Responsive layout: no overflow, overlap or clipping on login, register and onboarding at every required size', async ({ page }) => {
    await signedOut(page);
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(200);
      await expect(page.locator('.auth-card-header h2')).toContainText('Welcome back');
      await noHorizontalOverflow(page); await noOverlaps(page); await reachable(page, 'button[type=submit]');
      await page.screenshot({ path: path.join(shots, `${size.name}-login.png`) });
      await page.locator('.auth-toggle button', { hasText: 'Join Haven' }).click();
      await expect(page.locator('.auth-card-header h2')).toContainText('Find your place');
      await noHorizontalOverflow(page); await noOverlaps(page); await reachable(page, 'button[type=submit]');
      await page.screenshot({ path: path.join(shots, `${size.name}-register.png`) });
      await page.locator('.auth-toggle button', { hasText: 'Sign in' }).click();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await register(page, `layout.${Date.now()}.autoverify@haven.test`);
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    await page.getByLabel('USERNAME').fill('ab');
    await expect(page.locator('.auth-field-status')).toHaveText('Use at least 3 characters');
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(200);
      await noHorizontalOverflow(page); await noOverlaps(page);
      await reachable(page, 'button[type=submit]');
      await reachable(page, '.onboarding-avatar-circle');
      await page.locator('.auth-onboarding-page').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(shots, `${size.name}-onboarding.png`) });
    }
    // The page can really scroll to the very bottom on the shortest window.
    await page.setViewportSize({ width: 500, height: 550 });
    await page.locator('.auth-onboarding-page').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('.auth-privacy-note')).toBeInViewport();
  });

  test('8. Liquid glass: the scene shows through, refracts at the bevel in Chromium, stays readable, and honours reduced transparency', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await signedOut(page, 'no-preference');
    await expect(page.locator('.auth-page')).toHaveAttribute('data-glass', 'refract', { timeout: 5_000 });
    const glass = await page.locator('.auth-card').evaluate(element => { const style = getComputedStyle(element); return { filter: style.backdropFilter, background: style.backgroundColor }; });
    expect(glass.filter).toContain('blur(');
    expect(glass.filter).toContain('haven-glass-refraction');
    const alpha = Number(glass.background.match(/[\d.]+/g)![3] ?? 1);
    expect(alpha, 'glass tint is light enough to see the scene').toBeLessThanOrEqual(0.4);
    const rim = await page.locator('.auth-card').evaluate(element => getComputedStyle(element, '::before').backgroundImage);
    expect(rim).not.toMatch(/rgba\((?:222|192|160), ?(?:224|193|162), ?255/); // the old lavender rim colours are gone
    expect(rim).toMatch(/^radial-gradient\(120% 70% at [^,]+, rgba\(255, 255, 255, 0\.[5-9]/); // the key light on the rim is neutral white
    await page.screenshot({ path: path.join(shots, 'glass-login-1366x768.png') });

    // Readability over the animated scene (frozen via reduced motion so measurements are repeatable)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    for (const view of ['login', 'register']) {
      if (view === 'register') await page.locator('.auth-toggle button', { hasText: 'Join Haven' }).click();
      const report = await contrastReport(page);
      expect(report.length).toBeGreaterThan(4);
      for (const item of report) expect(item.ratio, `${view}: "${item.text}" contrast`).toBeGreaterThanOrEqual(4.5);
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Onboarding shares the same glass
    await page.locator('.auth-toggle button', { hasText: 'Sign in' }).click();
    await register(page, `glass.${Date.now()}.autoverify@haven.test`);
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    const onboarding = await page.locator('.auth-onboarding-card').evaluate(element => { const style = getComputedStyle(element); return { filter: style.backdropFilter, background: style.backgroundColor, radius: style.borderRadius }; });
    expect(onboarding.filter).toContain('haven-glass-refraction');
    expect(onboarding.background).toBe(glass.background);
    await page.screenshot({ path: path.join(shots, 'glass-onboarding-1366x768.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const onboardingReport = await contrastReport(page);
    for (const item of onboardingReport) expect(item.ratio, `onboarding: "${item.text}" contrast`).toBeGreaterThanOrEqual(4.5);
  });

  test('9. Reduced transparency (OS setting) switches the glass to a dense, still readable surface on every auth screen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await signedOut(page, 'reduce');
    const dense = await page.locator('.auth-card').evaluate(element => { const style = getComputedStyle(element); return { filter: style.backdropFilter, background: style.backgroundColor }; });
    expect(dense.filter).toBe('none');
    expect(Number(dense.background.match(/[\d.]+/g)![3])).toBeGreaterThanOrEqual(0.9);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const item of await contrastReport(page)) expect(item.ratio, `reduced transparency: "${item.text}" contrast`).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(shots, 'glass-reduced-transparency-login.png') });
    await page.locator('.auth-toggle button', { hasText: 'Join Haven' }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('input[name="email"]').fill(`dense.${Date.now()}.autoverify@haven.test`);
    await page.locator('input[name="password"]').fill('zenithpass123');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.auth-onboarding-card')).toBeVisible({ timeout: 8_000 });
    expect(await page.locator('.auth-onboarding-card').evaluate(element => getComputedStyle(element).backdropFilter)).toBe('none');
    await page.screenshot({ path: path.join(shots, 'glass-reduced-transparency-onboarding.png') });
  });
});
