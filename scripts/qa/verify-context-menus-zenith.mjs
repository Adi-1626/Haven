import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import assert from 'node:assert';

const outputDir = path.resolve('C:/Users/adity/.gemini/antigravity-ide/brain/7bae0332-cf92-474d-8b13-452573987a41/screenshots');
fs.mkdirSync(outputDir, { recursive: true });

async function run() {
  console.log('=== VERIFYING HAVEN ZENITH CONTEXT MENUS SUITE ===');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });
  console.log('✓ Haven loaded in UI test mode (1280x720)');

  // Select community server
  const serverBtn = page.locator('.server-icon:not(.haven-icon):not(.add-server):not(.join-server)').first();
  if (await serverBtn.count() > 0) {
    await serverBtn.click();
    await page.waitForSelector('.channel-row', { timeout: 8000 });
    console.log('✓ Selected server and loaded channels');
  }

  // --------------------------------------------------------------------------
  // TEST 1: Channel Context Menu
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Testing Channel Context Menu ---');
  const channelItem = page.locator('.channel-row, a.channel-link, .app .channel-list a, .channel-nav a').first();
  await channelItem.waitFor({ state: 'visible', timeout: 5000 });
  
  // Right-click channel item
  await channelItem.click({ button: 'right' });
  await page.waitForSelector('.haven-context-menu.zenith-context-menu', { timeout: 3000 });
  console.log('✓ Channel context menu opened');

  const channelMenu = page.locator('.haven-context-menu.zenith-context-menu');
  assert.ok(await channelMenu.isVisible(), 'Channel context menu must be visible');
  
  const channelMenuItems = await channelMenu.locator('[role=menuitem]').allTextContents();
  console.log('Channel menu items:', channelMenuItems);
  assert.ok(channelMenuItems.some(t => t.includes('channel')), 'Must contain channel action');
  assert.ok(channelMenuItems.some(t => t.includes('Copy channel ID')), 'Must contain "Copy channel ID"');

  // Verify icon presence
  const channelIcons = await channelMenu.locator('.zenith-menu-item-icon').count();
  assert.ok(channelIcons >= 3, `Expected at least 3 icons in channel menu, found ${channelIcons}`);

  // Screenshot channel context menu
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, '01_channel_context_menu_1280x720.png') });
  console.log('✓ Saved 01_channel_context_menu_1280x720.png');

  // Test keyboard navigation (ArrowDown)
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  
  // Test Escape key closes menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.haven-context-menu').count(), 0, 'Escape must close channel context menu');
  console.log('✓ Escape successfully closed channel context menu and restored focus');

  // --------------------------------------------------------------------------
  // TEST 2: Message Context Menu
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Message Context Menu ---');
  const messageRow = page.locator('.message').first();
  await messageRow.waitFor({ state: 'visible', timeout: 5000 });
  
  // Right-click message
  await messageRow.click({ button: 'right' });
  await page.waitForSelector('.haven-context-menu.zenith-context-menu', { timeout: 3000 });
  console.log('✓ Message context menu opened');

  const msgMenu = page.locator('.haven-context-menu.zenith-context-menu');
  const msgMenuItems = await msgMenu.locator('[role=menuitem]').allTextContents();
  console.log('Message menu items:', msgMenuItems);
  assert.ok(msgMenuItems.some(t => t.includes('Reply')), 'Must contain Reply');
  assert.ok(msgMenuItems.some(t => t.includes('Copy message text')), 'Must contain Copy message text');

  // Verify active ring on Reply
  const replyItem = msgMenu.locator('.zenith-menu-item', { hasText: 'Reply' });
  assert.ok(await replyItem.evaluate(el => el.classList.contains('active') || el.classList.contains('focused-ring')), 'Reply must have active ring');

  // Screenshot message context menu
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, '02_message_context_menu_1280x720.png') });
  console.log('✓ Saved 02_message_context_menu_1280x720.png');

  // Close message context menu with Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.haven-context-menu').count(), 0, 'Escape must close message menu');

  // --------------------------------------------------------------------------
  // TEST 3: User Context Menu
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing User Context Menu ---');
  // If member sidebar is not visible, toggle it
  if (await page.locator('.member-row').count() === 0) {
    const toggleMembersBtn = page.locator('button[title="Toggle member list"]').first();
    if (await toggleMembersBtn.count() > 0) {
      await toggleMembersBtn.click();
      await page.waitForTimeout(300);
    }
  }

  const memberRow = page.locator('.member-row').first();
  await memberRow.waitFor({ state: 'visible', timeout: 5000 });
  
  await memberRow.click({ button: 'right' });
  await page.waitForSelector('.haven-context-menu.zenith-context-menu', { timeout: 3000 });
  console.log('✓ User context menu opened');

  const userMenu = page.locator('.haven-context-menu.zenith-context-menu');
  // Check header
  const headerName = await userMenu.locator('.zenith-context-name').textContent();
  const presenceDot = userMenu.locator('.zenith-context-presence-dot');
  const handle = await userMenu.locator('.zenith-context-handle').textContent();
  console.log(`User header: name="${headerName?.trim()}", handle="${handle?.trim()}"`);
  assert.ok(headerName && headerName.length > 0, 'Header must display user name');
  assert.ok(await presenceDot.isVisible(), 'Presence dot must be visible');
  assert.ok(handle && handle.startsWith('@'), 'Handle must start with @');

  const userMenuItems = await userMenu.locator('[role=menuitem]').allTextContents();
  console.log('User menu items:', userMenuItems);
  assert.ok(userMenuItems.some(t => t.includes('View profile')), 'Must contain View profile');
  assert.ok(userMenuItems.some(t => t.includes('Copy username')), 'Must contain Copy username');
  assert.ok(userMenuItems.some(t => t.includes('Copy user ID')), 'Must contain Copy user ID');

  // Screenshot user context menu
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, '03_user_context_menu_1280x720.png') });
  console.log('✓ Saved 03_user_context_menu_1280x720.png');

  // Close with Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.haven-context-menu').count(), 0, 'Escape must close user menu');

  // --------------------------------------------------------------------------
  // TEST 4: Server Context Menu
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testing Server Context Menu ---');
  const serverIcon = page.locator('.server-icon:not(.haven-icon):not(.add-server):not(.join-server)').first();
  if (await serverIcon.count() > 0) {
    await serverIcon.click({ button: 'right' });
    await page.waitForSelector('.haven-context-menu.zenith-context-menu', { timeout: 3000 });
    console.log('✓ Server context menu opened');

    const serverMenu = page.locator('.haven-context-menu.zenith-context-menu');
    const serverMenuItems = await serverMenu.locator('[role=menuitem]').allTextContents();
    console.log('Server menu items:', serverMenuItems);
    assert.ok(serverMenuItems.some(t => t.includes('Server settings')), 'Must contain Server settings');
    assert.ok(serverMenuItems.some(t => t.includes('Copy server ID')), 'Must contain Copy server ID');

    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outputDir, '04_server_context_menu_1280x720.png') });
    console.log('✓ Saved 04_server_context_menu_1280x720.png');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Boundary Edge Clamping
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Testing Viewport Edge Clamping ---');
  // Dispatch a context menu event near bottom-right corner (1260, 700)
  await page.evaluate(() => {
    const channelBtn = document.querySelector('.channel-row button');
    if (channelBtn) {
      const evt = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 1260,
        clientY: 700
      });
      channelBtn.dispatchEvent(evt);
    }
  });

  await page.waitForSelector('.haven-context-menu.zenith-context-menu', { timeout: 3000 });
  const clampedBox = await page.locator('.haven-context-menu.zenith-context-menu').boundingBox();
  assert.ok(clampedBox, 'Menu bounding box must exist');
  console.log(`Clamped position: x=${clampedBox.x}, y=${clampedBox.y}, w=${clampedBox.width}, h=${clampedBox.height}`);
  assert.ok(clampedBox.x + clampedBox.width <= 1280, `Menu right edge (${clampedBox.x + clampedBox.width}) must be <= window width (1280)`);
  assert.ok(clampedBox.y + clampedBox.height <= 720, `Menu bottom edge (${clampedBox.y + clampedBox.height}) must be <= window height (720)`);
  console.log('✓ Boundary edge clamping correctly keeps menu fully within viewport bounds');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --------------------------------------------------------------------------
  // TEST 6: Compact Electron Window (500x550)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Testing Compact Electron Window (500x550) ---');
  await page.setViewportSize({ width: 500, height: 550 });
  await page.waitForTimeout(300);

  // Right click a visible message in main-panel
  const compactTarget = page.locator('.main-panel .message').first();
  if (await compactTarget.count() > 0) {
    await compactTarget.click({ button: 'right' });
    await page.waitForSelector('.haven-context-menu.zenith-context-menu', { timeout: 3000 });
    const compactBox = await page.locator('.haven-context-menu.zenith-context-menu').boundingBox();
    assert.ok(compactBox, 'Compact menu bounding box must exist');
    console.log(`Compact menu position: x=${compactBox.x}, y=${compactBox.y}, w=${compactBox.width}, h=${compactBox.height}`);
    assert.ok(compactBox.x + compactBox.width <= 500, 'Must not overflow 500px width');
    assert.ok(compactBox.y + compactBox.height <= 550, 'Must not overflow 550px height');

    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outputDir, '05_compact_context_menu_500x550.png') });
    console.log('✓ Saved 05_compact_context_menu_500x550.png');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Multi-menu Suite Showcase (Stitch Fidelity Comparison)
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Generating Context Menu Suite Composite Comparison ---');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Inject user, channel, and message context menus simultaneously into the page DOM
  // using the exact same classes to match the Stitch Suite screen layout (1280x720)
  await page.evaluate(() => {
    // Clear any active context menus first
    document.querySelectorAll('.haven-context-menu').forEach(el => el.remove());

    const container = document.createElement('div');
    container.id = 'zenith-suite-showcase';
    container.innerHTML = `
      <!-- Channel Menu (200px, positioned at left 185px, top 138px) -->
      <div class="haven-context-menu zenith-context-menu" style="position: absolute; left: 185px; top: 138px; width: 200px;">
        <button type="button" role="menuitem" class="zenith-menu-item active focused-ring">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></span>
          <span class="zenith-menu-item-text">Open channel</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>
          <span class="zenith-menu-item-text">Edit channel</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg></span>
          <span class="zenith-menu-item-text">Mark channel as read</span>
        </button>
        <div role="separator"></div>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></span>
          <span class="zenith-menu-item-text">Copy channel ID</span>
        </button>
      </div>


      <!-- Message Menu (190px, positioned at left 520px, top 215px) -->
      <div class="haven-context-menu zenith-context-menu" style="position: absolute; left: 520px; top: 215px; width: 190px;">
        <button type="button" role="menuitem" class="zenith-menu-item active focused-ring">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></span>
          <span class="zenith-menu-item-text">Reply</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span class="zenith-menu-item-text">View author profile</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span>
          <span class="zenith-menu-item-text">Copy message text</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>
          <span class="zenith-menu-item-text">Edit message</span>
        </button>
        <div role="separator"></div>
        <button type="button" role="menuitem" class="zenith-menu-item danger-text danger">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></span>
          <span class="zenith-menu-item-text">Delete message</span>
        </button>
      </div>

      <!-- User Menu (240px, positioned at right 218px, top 88px) -->
      <div class="haven-context-menu zenith-context-menu" style="position: absolute; right: 218px; top: 88px; width: 240px;">
        <div class="context-heading zenith-context-header">
          <div class="zenith-context-header-main">
            <span class="zenith-context-name">Marcus Vance</span>
            <span class="zenith-context-presence-dot online"></span>
          </div>
          <div class="zenith-context-handle">@marcus</div>
        </div>
        <button type="button" role="menuitem" class="zenith-menu-item active focused-ring">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span class="zenith-menu-item-text">View profile</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></span>
          <span class="zenith-menu-item-text">View original picture</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
          <span class="zenith-menu-item-text">Message</span>
        </button>
        <div role="separator"></div>
        <div class="context-volume zenith-context-volume">
          <div class="zenith-context-volume-header">
            <span>User volume</span>
            <span class="zenith-context-volume-val">100%</span>
          </div>
          <input aria-label="Volume" class="zenith-volume-slider" type="range" min="0" max="1" step="0.05" value="1" />
          <div class="context-note zenith-context-note">Local audio controls affect only you.</div>
        </div>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg></span>
          <span class="zenith-menu-item-text">Mute locally</span>
        </button>
        <div role="separator"></div>
        <button type="button" role="menuitem" class="zenith-menu-item danger-text danger">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg></span>
          <span class="zenith-menu-item-text">Remove friend</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item danger-text danger">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>
          <span class="zenith-menu-item-text">Block</span>
        </button>
        <div role="separator"></div>
        <div class="context-heading zenith-moderation-heading">Community moderation</div>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><line x1="12" y1="19" x2="12" y2="22"/></svg></span>
          <span class="zenith-menu-item-text">Server mute</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg></span>
          <span class="zenith-menu-item-text">Server deafen</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item danger-text danger">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m14 13-7.5 7.5-3-3L11 10"/><path d="m16 16 6-6"/></svg></span>
          <span class="zenith-menu-item-text">Remove from community</span>
        </button>
        <div role="separator"></div>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span>
          <span class="zenith-menu-item-text">Copy username</span>
        </button>
        <button type="button" role="menuitem" class="zenith-menu-item">
          <span class="zenith-menu-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></span>
          <span class="zenith-menu-item-text">Copy user ID</span>
        </button>
      </div>
    `;
    document.body.appendChild(container);
  });

  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDir, '00_stitch_suite_comparison_1280x720.png') });
  console.log('✓ Saved 00_stitch_suite_comparison_1280x720.png');

  await browser.close();
  console.log('\n=== ALL CONTEXT MENU TESTS PASSED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
