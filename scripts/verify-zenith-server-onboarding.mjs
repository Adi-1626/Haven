import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import assert from 'node:assert';

const outputDir = path.resolve('C:/Users/adity/.gemini/antigravity-ide/brain/0b9ecf9c-7079-45b4-b037-48093840e2c6/screenshots');
fs.mkdirSync(outputDir, { recursive: true });

async function dismissScrim(page) {
  const scrim = page.locator('.nav-scrim');
  if (await scrim.isVisible()) {
    await scrim.click({ force: true });
    await page.waitForTimeout(200);
  }
}

async function openCreateServerModal(page) {
  await dismissScrim(page);
  await page.evaluate(() => {
    const btn = document.querySelector('.server-icon.add-server');
    if (btn) btn.click();
  });
  await page.waitForSelector('.zenith-create-server-modal', { timeout: 5000 });
}

async function openJoinServerModal(page) {
  await dismissScrim(page);
  await page.evaluate(() => {
    const btn = document.querySelector('.server-icon.join-server');
    if (btn) btn.click();
  });
  await page.waitForSelector('.zenith-join-server-modal', { timeout: 5000 });
}

async function run() {
  console.log('=== VERIFYING ZENITH MINIMAL SERVER ONBOARDING DIALOGS ===\n');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  const viewports = [
    { width: 1920, height: 1080, name: '1080p' },
    { width: 1280, height: 720, name: '720p' },
    { width: 800, height: 600, name: 'compact' },
    { width: 500, height: 550, name: 'minimal' },
  ];

  // --------------------------------------------------------------------------
  // 1. Create Server Dialog (Make a space of your own)
  // --------------------------------------------------------------------------
  console.log('--- 1. Testing Create Server Dialog ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail', { timeout: 10000 });

    await openCreateServerModal(page);
    console.log('✓ Create Server modal opened');

    const modal = page.locator('.zenith-create-server-modal');
    assert.ok(await modal.isVisible(), 'Create Server modal should be visible');

    const heading = await page.locator('.zenith-create-server-modal .zenith-onboarding-title').textContent();
    assert.strictEqual(heading?.trim(), 'Make a space of your own');

    // Fill in server name
    const nameInput = page.locator('#zenith-server-name-input');
    await nameInput.fill('Zenith Creators Space');
    assert.strictEqual(await nameInput.inputValue(), 'Zenith Creators Space');

    // Character counter check
    const counterText = await page.locator('.zenith-create-server-modal .zenith-onboarding-counter').textContent();
    assert.strictEqual(counterText?.trim(), '21/80');

    // Check preview initial
    const previewMock = page.locator('.zenith-server-rail-icon-mock');
    const previewInitial = await previewMock.textContent();
    assert.ok(previewInitial?.includes('Z'), 'Preview should display initial Z');

    // Click emoji chip '🚀'
    const emojiRocket = page.locator('.zenith-emoji-chip[aria-label="Select 🚀 icon"]');
    await emojiRocket.click();
    assert.strictEqual(await page.locator('#zenith-server-icon-input').inputValue(), '🚀');
    const previewEmoji = await previewMock.textContent();
    assert.ok(previewEmoji?.includes('🚀'), 'Preview should display rocket emoji');

    // Capture standard screenshot
    await page.screenshot({ path: path.join(outputDir, 'create_server_dialog_1280x720.png') });
    console.log('✓ Create Server modal screenshot captured at 1280x720');

    // Test switcher button transitions to Join Server
    const switchToJoinBtn = page.locator('.zenith-create-server-modal .zenith-onboarding-switch-btn');
    await switchToJoinBtn.click();
    await page.waitForSelector('.zenith-join-server-modal', { timeout: 3000 });
    console.log('✓ Seamless transition from Create Server to Join Server verified');

    // Close join modal
    await page.locator('.zenith-join-server-modal .zenith-onboarding-close-btn').click();
    await page.waitForTimeout(200);

    // Responsive captures for Create Server across all viewports
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await openCreateServerModal(page);
      await page.locator('#zenith-server-name-input').fill('The Cozy Corner');
      await page.locator('.zenith-emoji-chip[aria-label="Select 🌱 icon"]').click();
      await page.screenshot({ path: path.join(outputDir, `create_server_${vp.name}_${vp.width}x${vp.height}.png`) });
      await page.locator('.zenith-create-server-modal .zenith-onboarding-close-btn').click();
      await page.waitForTimeout(150);
    }
    console.log('✓ Create Server modal responsive viewports verified');

    await context.close();
  }

  // --------------------------------------------------------------------------
  // 2. Join Server Dialog (Find your people)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Join Server Dialog ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail', { timeout: 10000 });

    await openJoinServerModal(page);
    console.log('✓ Join Server modal opened');

    const modal = page.locator('.zenith-join-server-modal');
    assert.ok(await modal.isVisible(), 'Join Server modal should be visible');

    const heading = await page.locator('.zenith-join-server-modal .zenith-onboarding-title').textContent();
    assert.strictEqual(heading?.trim(), 'Find your people');

    // Test typing an invite code
    const inviteInput = page.locator('#zenith-invite-input');
    await inviteInput.fill('https://haven.app/invite/zenith-sample');
    assert.strictEqual(await inviteInput.inputValue(), 'https://haven.app/invite/zenith-sample');

    // Test clear button
    const clearBtn = page.locator('.zenith-onboarding-input-clear');
    await clearBtn.click();
    assert.strictEqual(await inviteInput.inputValue(), '');

    // Test error feedback on invalid submission
    await inviteInput.fill('invalid code with spaces!!');
    await page.locator('.zenith-join-server-modal button[type="submit"]').click();
    await page.waitForSelector('.zenith-onboarding-error', { timeout: 3000 });
    const errorText = await page.locator('.zenith-onboarding-error').textContent();
    assert.ok(errorText?.includes('invite code') || errorText?.includes('invitation link'), 'Should show clear validation error');
    console.log('✓ Validation error feedback verified');

    // Capture standard screenshot
    await page.screenshot({ path: path.join(outputDir, 'join_server_dialog_1280x720.png') });
    console.log('✓ Join Server modal screenshot captured at 1280x720');

    // Test switcher button transitions back to Create Server
    const switchToCreateBtn = page.locator('.zenith-join-server-modal .zenith-onboarding-switch-btn');
    await switchToCreateBtn.click();
    await page.waitForSelector('.zenith-create-server-modal', { timeout: 3000 });
    console.log('✓ Transition from Join Server back to Create Server verified');

    await page.locator('.zenith-create-server-modal .zenith-onboarding-close-btn').click();
    await page.waitForTimeout(150);

    // Responsive captures for Join Server across all viewports
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await openJoinServerModal(page);
      await page.locator('#zenith-invite-input').fill('https://haven.app/invite/alpha-community');
      await page.screenshot({ path: path.join(outputDir, `join_server_${vp.name}_${vp.width}x${vp.height}.png`) });
      await page.locator('.zenith-join-server-modal .zenith-onboarding-close-btn').click();
      await page.waitForTimeout(150);
    }
    console.log('✓ Join Server modal responsive viewports verified');

    await context.close();
  }

  // --------------------------------------------------------------------------
  // 3. Real Server Creation & Navigation
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing Real Server Creation Functionality ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail', { timeout: 10000 });

    const testServerName = `Test Server ${Date.now().toString().slice(-4)}`;
    await openCreateServerModal(page);
    await page.locator('#zenith-server-name-input').fill(testServerName);
    await page.locator('.zenith-emoji-chip[aria-label="Select ⚡ icon"]').click();

    // Submit real creation
    await page.locator('.zenith-create-server-modal button[type="submit"]').click();
    await page.waitForTimeout(1500);

    // Verify modal closed and server header updated to testServerName
    assert.strictEqual(await page.locator('.zenith-create-server-modal').count(), 0);
    const serverHeader = page.locator('.server-name');
    const headerText = await serverHeader.textContent();
    assert.strictEqual(headerText?.trim(), testServerName);
    console.log(`✓ Real server created and active in navigation: "${testServerName}"`);

    await context.close();
  }

  await browser.close();
  console.log('\n=== ALL SERVER ONBOARDING VERIFICATIONS COMPLETED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('Server onboarding verification failed:', err);
  process.exit(1);
});
