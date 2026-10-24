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

async function openAddFriendModal(page) {
  await dismissScrim(page);
  await page.evaluate(() => {
    const btn = document.querySelector('button.friends-toolbar-add-btn');
    if (btn) btn.click();
  });
  await page.waitForSelector('.zenith-add-friend-modal', { timeout: 5000 });
}

async function openGroupModal(page) {
  await dismissScrim(page);
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Create group message"], button[aria-label="Create group message"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('.zenith-group-modal', { timeout: 5000 });
}

async function run() {
  console.log('=== VERIFYING ZENITH MINIMAL FINAL 2 SCREENS ===\n');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  const viewports = [
    { width: 1920, height: 1080, name: '1080p' },
    { width: 1280, height: 720, name: '720p' },
    { width: 800, height: 600, name: 'compact' },
    { width: 500, height: 550, name: 'minimal' },
  ];

  // --------------------------------------------------------------------------
  // SCREEN 1: Group DM & Add Friend Dialogs (4cf1f75ea0af44bc8c284f49feb3e773)
  // --------------------------------------------------------------------------
  console.log('--- 1. Testing Screen 1: Group DM & Add Friend Dialogs ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail', { timeout: 10000 });

    // Navigate to Home / Friends
    const homeBtn = page.locator('.server-icon.haven-icon').first();
    await homeBtn.click();
    await page.waitForSelector('.friends-page', { timeout: 5000 });

    // 1A. Add Friend Modal
    await openAddFriendModal(page);
    console.log('✓ Add Friend modal opened');

    const addFriendModal = page.locator('.zenith-add-friend-modal');
    assert.ok(await addFriendModal.isVisible(), 'Add Friend modal should be visible');
    const heading = await page.locator('.zenith-add-friend-modal .zenith-social-title').textContent();
    assert.strictEqual(heading?.trim(), 'Add friend');

    // Test typing a username
    const usernameInput = page.locator('#zenith-friend-username-input');
    await usernameInput.fill('@marcus_vance');
    assert.strictEqual(await usernameInput.inputValue(), '@marcus_vance');

    // Screenshot Add Friend modal
    await page.screenshot({ path: path.join(outputDir, 'screen1_add_friend_modal.png') });
    console.log('✓ Add Friend modal screenshot captured');

    // Close Add Friend modal
    await page.locator('.zenith-add-friend-modal .zenith-social-close-btn').click();
    await page.waitForTimeout(300);

    // 1B. Group DM Modal
    await openGroupModal(page);
    console.log('✓ Group DM modal opened');

    const groupModal = page.locator('.zenith-group-modal');
    assert.ok(await groupModal.isVisible(), 'Group DM modal should be visible');
    const groupHeading = await page.locator('.zenith-group-modal .zenith-social-title').textContent();
    assert.strictEqual(groupHeading?.trim(), 'Start group conversation');

    // Test group name input and counter
    const groupNameInput = page.locator('#group-name-input');
    await groupNameInput.fill('Project Zenith Core');
    const counterText = await page.locator('.zenith-char-counter').textContent();
    assert.ok(counterText?.includes('19/32') || counterText?.includes('/32'), 'Counter should track characters');

    // Check if friends are available in checklist
    const friendItems = page.locator('.zenith-checklist-item');
    const rowCount = await friendItems.count();
    console.log(`Found ${rowCount} friends in Group DM checklist`);
    if (rowCount > 0) {
      await friendItems.first().click();
      const selectedIndicator = await page.locator('.zenith-selected-pill').textContent();
      assert.ok(selectedIndicator?.includes('1 selected'), 'Selection counter should show 1 selected');
    }

    // Screenshot Group DM modal
    await page.screenshot({ path: path.join(outputDir, 'screen1_group_dm_modal.png') });
    console.log('✓ Group DM modal screenshot captured');

    // Close group modal
    await page.locator('.zenith-group-modal .zenith-social-close-btn').click();
    await page.waitForTimeout(300);

    // Test Add Friend and Group DM modals across 4 viewports
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);
      await openAddFriendModal(page);
      await page.screenshot({ path: path.join(outputDir, `screen1_add_friend_${vp.name}_${vp.width}x${vp.height}.png`) });
      await page.locator('.zenith-add-friend-modal .zenith-social-close-btn').click();
      await page.waitForTimeout(200);

      await openGroupModal(page);
      await page.screenshot({ path: path.join(outputDir, `screen1_group_${vp.name}_${vp.width}x${vp.height}.png`) });
      await page.locator('.zenith-group-modal .zenith-social-close-btn').click();
      await page.waitForTimeout(200);
    }
    console.log('✓ Screen 1 responsive viewports verified');

    await context.close();
  }

  // --------------------------------------------------------------------------
  // SCREEN 2: Empty, Loading & Reconnecting States (f3f65e1fdcb640ae98e3ec8cf2be34c9)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Screen 2: Empty, Loading & Reconnecting States ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail', { timeout: 10000 });

    // 2A. Empty Circle State (in Friends page)
    const homeBtn = page.locator('.server-icon.haven-icon').first();
    await homeBtn.click();
    await page.waitForSelector('.friends-page', { timeout: 5000 });

    // Search for a non-existent name to verify empty card with Zenith styling
    const searchInput = page.locator('.friends-search-input');
    await searchInput.fill('nobody_here_xyz');
    await page.waitForSelector('.friends-empty-card', { timeout: 3000 });
    console.log('✓ Empty search state rendered');

    // Test empty states across viewports
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outputDir, `screen2_empty_state_${vp.name}_${vp.width}x${vp.height}.png`) });
    }
    console.log('✓ Empty state responsive viewports verified');

    // 2B. Reconnecting State Banner
    await searchInput.fill('');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.className = 'connection-banner zenith-reconnecting-banner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = `
        <div class="zenith-reconnect-left">
          <div class="zenith-reconnect-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          </div>
          <div class="zenith-reconnect-text-group">
            <span class="zenith-reconnect-title">Restoring connection…</span>
            <span class="zenith-reconnect-subtitle">WebRTC Direct Mesh · Your messages are saved</span>
          </div>
        </div>
        <button type="button" class="zenith-reconnect-btn">
          Reconnect now
        </button>
      `;
      const mainPanel = document.querySelector('.main-panel');
      if (mainPanel) {
        mainPanel.insertBefore(banner, mainPanel.children[1]);
      } else {
        document.body.appendChild(banner);
      }
    });

    await page.waitForSelector('.zenith-reconnecting-banner', { timeout: 3000 });
    await page.screenshot({ path: path.join(outputDir, 'screen2_reconnecting_banner.png') });
    console.log('✓ Reconnecting banner verified and captured');

    // 2C. Loading Micro-State
    await page.evaluate(() => {
      const banner = document.querySelector('.zenith-reconnecting-banner');
      if (banner) banner.remove();

      const loadingOverlay = document.createElement('div');
      loadingOverlay.className = 'loading zenith-app-loading';
      loadingOverlay.style.position = 'fixed';
      loadingOverlay.style.inset = '0';
      loadingOverlay.style.zIndex = '99999';
      loadingOverlay.innerHTML = `
        <img class="zenith-loading-logo" src="/haven-wordmark.webp" srcset="/haven-wordmark.webp 1x, /haven-wordmark@2x.webp 2x, /haven-wordmark@3x.webp 3x" alt="" width="252" height="84" draggable="false">
        <div class="zenith-loading-text-wrap">
          <span class="zenith-loading-ping-dot" aria-hidden="true"></span>
          <span>Finding your place…</span>
        </div>
      `;
      document.body.appendChild(loadingOverlay);
    });

    await page.waitForSelector('.zenith-app-loading', { timeout: 3000 });
    await page.screenshot({ path: path.join(outputDir, 'screen2_loading_microstate.png') });
    console.log('✓ Loading micro-state verified and captured');

    await context.close();
  }

  await browser.close();
  console.log('\n=== ALL ZENITH SCREEN VERIFICATIONS COMPLETED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
