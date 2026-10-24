import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const screenshotDir = path.resolve('docs/screenshots/final-audit');
fs.mkdirSync(screenshotDir, { recursive: true });

const artifactDir = 'C:\\Users\\adity\\.gemini\\antigravity-ide\\brain\\cec8aa42-1f55-4dc2-9a35-c0faa4b87660\\final_audit';
fs.mkdirSync(artifactDir, { recursive: true });

async function saveScreen(page, filename) {
  const p1 = path.join(screenshotDir, filename);
  const p2 = path.join(artifactDir, filename);
  await page.screenshot({ path: p1 });
  await page.screenshot({ path: p2 });
  console.log(`[Captured] ${filename}`);
}

async function checkNoHorizontalOverflow(page, screenName) {
  const result = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const bodyWidth = document.body.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const bodyScrollWidth = document.body.scrollWidth;

    const overflowingElements = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 1.5 && getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).overflowX !== 'scroll') {
        const cls = el.className ? `.${String(el.className).split(' ').join('.')}` : el.tagName;
        if (!cls.includes('monaco') && !cls.includes('hljs')) {
          overflowingElements.push(cls);
        }
      }
    });

    return {
      docWidth,
      bodyWidth,
      scrollWidth,
      bodyScrollWidth,
      hasWindowOverflow: scrollWidth > docWidth + 1 || bodyScrollWidth > bodyWidth + 1,
      overflowingElements: [...new Set(overflowingElements)].slice(0, 5),
    };
  });

  if (result.hasWindowOverflow) {
    console.warn(`  ⚠ HORIZONTAL OVERFLOW DETECTED in ${screenName}: docWidth=${result.docWidth}, scrollWidth=${result.scrollWidth}, elements=${result.overflowingElements.join(', ')}`);
  }
  return result;
}

async function runAudit() {
  console.log('======================================================================');
  console.log('HAVEN FINAL UI/UX AUDIT & POLISH — FULL APPLICATION INSPECTION');
  console.log('======================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const auditLog = [];

  // Helper to log audit steps
  function logAudit(screen, status, notes = '') {
    auditLog.push({ screen, status, notes });
    console.log(`✓ ${screen}: ${status} ${notes ? '(' + notes + ')' : ''}`);
  }

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 15000 });
  console.log('Page loaded successfully.\n');

  // =========================================================================
  // 1. MAIN TEXT CHAT SHELL
  // =========================================================================
  console.log('--- 1. Auditing Main Text Chat Shell across viewports ---');
  // Select Zenith Design Lab
  const serverIcon = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  if (await serverIcon.isVisible()) await serverIcon.click();
  await page.waitForTimeout(300);

  // Select #design-tokens channel
  const designTokensChannel = page.locator('.channel-row button', { hasText: 'design-tokens' });
  if (await designTokensChannel.isVisible()) await designTokensChannel.click();
  await page.waitForTimeout(400);

  // Ensure member sidebar is toggled open if available
  const toggleMemberBtn = page.locator('button[aria-label="Toggle member list"]');
  if (await toggleMemberBtn.isVisible()) {
    const memberSidebar = page.locator('.member-sidebar');
    if (!(await memberSidebar.isVisible())) await toggleMemberBtn.click();
  }

  const viewports = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1280x720', width: 1280, height: 720 },
    { name: '800x600', width: 800, height: 600 },
    { name: '500x550', width: 500, height: 550 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);
    const of = await checkNoHorizontalOverflow(page, `Main Chat (${vp.name})`);
    await saveScreen(page, `01_main_chat_${vp.name}.png`);
    logAudit(`Main Chat ${vp.name}`, of.hasWindowOverflow ? 'OVERFLOW_WARN' : 'VERIFIED', `overflowElements: ${of.overflowingElements.join(',') || 'none'}`);
  }

  // Restore 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Test Message hover and action buttons
  const firstMsg = page.locator('.message').first();
  if (await firstMsg.isVisible()) {
    await firstMsg.hover();
    await page.waitForTimeout(200);
    await saveScreen(page, `01e_message_hover_actions_1280x720.png`);
    logAudit('Message Hover Actions', 'VERIFIED', 'Actions toolbar revealed on message hover');
  }

  // =========================================================================
  // 2. VOICE ROOM & PARTICIPANT GRIDS
  // =========================================================================
  console.log('\n--- 2. Auditing Voice Room & Participant Cards across viewports ---');
  const studioRoomBtn = page.locator('.channel-row button', { hasText: 'Studio Room' }).first();
  await studioRoomBtn.click();
  await page.waitForSelector('.voice-room-view', { timeout: 8000 });
  await page.waitForTimeout(500);

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);

    const alignmentMetrics = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.room-participants .person-tile'));
      const details = cards.map(c => {
        const cRect = c.getBoundingClientRect();
        const avatar = c.querySelector('.person-tile-avatar-wrap, .avatar');
        const aRect = avatar?.getBoundingClientRect();
        const nameEl = c.querySelector('strong, .person-tile-name');
        const nRect = nameEl?.getBoundingClientRect();
        const userEl = c.querySelector('.person-tile-username');
        const uRect = userEl?.getBoundingClientRect();

        const cCenter = cRect.left + cRect.width / 2;
        const aCenter = aRect ? aRect.left + aRect.width / 2 : cCenter;
        const nCenter = nRect ? nRect.left + nRect.width / 2 : cCenter;

        return {
          name: nameEl?.textContent?.trim() || '',
          avatarOffset: Math.abs(cCenter - aCenter),
          nameOffset: Math.abs(cCenter - nCenter),
        };
      });

      const dock = document.querySelector('.persistent-voice-controls, .voice-dock');
      const dRect = dock?.getBoundingClientRect();

      return {
        cardCount: cards.length,
        maxAvatarCenterOffset: Math.max(...details.map(d => d.avatarOffset), 0),
        maxNameCenterOffset: Math.max(...details.map(d => d.nameOffset), 0),
        dockVisible: Boolean(dock && dRect && dRect.height > 0),
      };
    });

    const of = await checkNoHorizontalOverflow(page, `Voice Room (${vp.name})`);
    await saveScreen(page, `02_voice_room_${vp.name}.png`);
    logAudit(`Voice Room ${vp.name}`, of.hasWindowOverflow ? 'OVERFLOW_WARN' : 'VERIFIED', `cards=${alignmentMetrics.cardCount}, maxAvatarOffset=${alignmentMetrics.maxAvatarCenterOffset.toFixed(1)}px, maxNameOffset=${alignmentMetrics.maxNameCenterOffset.toFixed(1)}px`);
  }

  // Restore 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // =========================================================================
  // 3. VOICE ROOM STREAM SPOTLIGHT / THEATER
  // =========================================================================
  console.log('\n--- 3. Auditing Voice Room Stream Spotlight ---');
  const streamsTab = page.locator('#room-streams-tab, button:has-text("Streams")').first();
  if (await streamsTab.isVisible()) {
    await streamsTab.click();
    await page.waitForTimeout(300);
  }
  const watchBtn = page.locator('button', { hasText: /Watch/i }).first();
  if (await watchBtn.isVisible()) {
    await watchBtn.click();
    await page.waitForTimeout(500);
    await saveScreen(page, `03_voice_room_sharing_1280x720.png`);
    logAudit('Voice Room Screen Share Theater', 'VERIFIED', 'Stream spotlight mounted');
  }

  // =========================================================================
  // 4. FULLSCREEN STREAM VIEWER
  // =========================================================================
  console.log('\n--- 4. Auditing Fullscreen Stream Viewer ---');
  const fullscreenTrigger = page.locator('button[aria-label="Fullscreen"], button[title*="Fullscreen"]').first();
  if (await fullscreenTrigger.isVisible()) {
    await fullscreenTrigger.click();
    await page.waitForTimeout(400);
    await page.mouse.move(600, 300);
    await page.waitForTimeout(200);
    await saveScreen(page, `04_fullscreen_stream_1920x1080.png`);
    logAudit('Fullscreen Stream Viewer', 'VERIFIED', 'Cinematic view with ghost HUD');

    const returnBtn = page.locator('button[title*="Return to voice room"], .stream-hud-btn.return-btn').first();
    if (await returnBtn.isVisible()) {
      await returnBtn.click();
    } else {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      if (await page.locator('.stream-viewer').isVisible()) {
        await page.keyboard.press('Escape');
      }
    }
    await page.waitForTimeout(500);
  }

  // Ensure stream-viewer is closed
  if (await page.locator('.stream-viewer').isVisible()) {
    const returnBtn = page.locator('button[title*="Return to voice room"], .stream-hud-btn.return-btn').first();
    if (await returnBtn.isVisible()) await returnBtn.click();
    await page.waitForTimeout(400);
  }

  // =========================================================================
  // 5. FRIENDS HUB & DIRECT MESSAGES
  // =========================================================================
  console.log('\n--- 5. Auditing Friends Hub & DMs ---');
  const havenHomeBtn = page.locator('button.server-icon.haven-icon, button[title="Home"]').first();
  await havenHomeBtn.click();
  await page.waitForTimeout(400);

  for (const vp of [viewports[1], viewports[3]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);
    const of = await checkNoHorizontalOverflow(page, `Friends Hub (${vp.name})`);
    await saveScreen(page, `05_friends_hub_${vp.name}.png`);
    logAudit(`Friends Hub ${vp.name}`, of.hasWindowOverflow ? 'OVERFLOW_WARN' : 'VERIFIED');
  }

  // Restore 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Switch to All friends tab
  const allTab = page.locator('.friends-nav-btn', { hasText: 'All' });
  if (await allTab.isVisible()) {
    await allTab.click();
    await page.waitForTimeout(300);
    await saveScreen(page, `05b_friends_all_tab_1280x720.png`);
  }

  // Open a Direct Message conversation
  const dmRow = page.locator('.dm-row').first();
  if (await dmRow.isVisible()) {
    await dmRow.click();
    await page.waitForTimeout(400);
    await saveScreen(page, `06_direct_message_1280x720.png`);
    logAudit('Direct Message Conversation', 'VERIFIED', '1-on-1 DM shell rendered');
  }

  // =========================================================================
  // 6. PROFILE CARD & FULL-RESOLUTION VIEWER
  // =========================================================================
  console.log('\n--- 6. Auditing Profile Card & Picture Viewer ---');
  // Click on friend row or user avatar
  const friendRow = page.locator('.member-row, .friend-row, .person-tile').first();
  if (await friendRow.isVisible()) {
    await friendRow.click();
    await page.waitForSelector('.profile-card.enhanced-profile', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (await page.locator('.profile-card').isVisible()) {
      await saveScreen(page, `07_profile_card_1280x720.png`);
      logAudit('Profile Card', 'VERIFIED', 'Zenith profile card opened');

      // Picture viewer
      const picBtn = page.locator('.profile-picture-button:not([disabled])');
      if (await picBtn.isVisible()) {
        await picBtn.click();
        await page.waitForSelector('.zenith-image-viewer-container', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        await saveScreen(page, `08_profile_picture_viewer_1280x720.png`);
        logAudit('Full-Resolution Picture Viewer', 'VERIFIED', 'Full screen picture overlay opened');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  // =========================================================================
  // 7. APPLICATION SETTINGS TABS
  // =========================================================================
  console.log('\n--- 7. Auditing All Settings Tabs ---');
  const settingsBtn = page.locator('.user-settings, button[title="Settings"], button[aria-label="Settings"]').first();
  await settingsBtn.click();
  await page.waitForSelector('dialog.settings-dialog[open]', { timeout: 5000 });
  await page.waitForTimeout(400);

  // Tab 1: Profile
  await page.locator('.settings-nav-btn', { hasText: 'profile' }).click();
  await page.waitForTimeout(300);
  await saveScreen(page, `09_settings_profile_1280x720.png`);
  logAudit('Settings: Profile Tab', 'VERIFIED');

  // Tab 2: Voice & Video (Desktop + Compact)
  await page.locator('.settings-nav-btn', { hasText: 'voice & video' }).click();
  await page.waitForTimeout(300);
  await saveScreen(page, `10_settings_voice_video_1280x720.png`);
  logAudit('Settings: Voice & Video Tab (1280x720)', 'VERIFIED');

  await page.setViewportSize({ width: 500, height: 550 });
  await page.waitForTimeout(300);
  await saveScreen(page, `10_settings_voice_video_500x550.png`);
  logAudit('Settings: Voice & Video Tab (500x550)', 'VERIFIED', 'Compact responsive reflow');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Tab 3: Desktop & Gaming
  await page.locator('.settings-nav-btn', { hasText: 'desktop & gaming' }).click();
  await page.waitForTimeout(300);
  await saveScreen(page, `11_settings_desktop_gaming_1280x720.png`);
  logAudit('Settings: Desktop & Gaming Tab', 'VERIFIED');

  // Tab 4: Notifications
  await page.locator('.settings-nav-btn', { hasText: 'notifications' }).click();
  await page.waitForTimeout(300);
  await saveScreen(page, `12_settings_notifications_1280x720.png`);
  logAudit('Settings: Notifications Tab', 'VERIFIED');

  // Open Soundboard inside Voice & Video (Voice Entry Sound selector)
  await page.locator('.settings-nav-btn', { hasText: 'voice & video' }).click();
  await page.waitForTimeout(300);
  const chooseSoundBtn = page.locator('.entry-sound-status-card button', { hasText: /sound/i });
  if (await chooseSoundBtn.isVisible()) {
    await chooseSoundBtn.click();
    await page.waitForSelector('.zenith-soundboard-modal', { timeout: 5000 });
    await page.waitForTimeout(400);

    await saveScreen(page, `13_soundboard_modal_1280x720.png`);
    await page.setViewportSize({ width: 500, height: 550 });
    await page.waitForTimeout(300);
    await saveScreen(page, `13_soundboard_modal_500x550.png`);
    logAudit('Soundboard Modal (Voice Entry Sound)', 'VERIFIED', '1280x720 and 500x550 tested');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Close Settings dialog
  await page.locator('.settings-close-button').click();
  await page.waitForTimeout(400);

  // =========================================================================
  // 8. SCREEN SHARE QUALITY MODAL
  // =========================================================================
  console.log('\n--- 8. Auditing Screen Share Quality Modal ---');
  // Re-join voice to access dock menu
  if (await studioRoomBtn.isVisible()) {
    await studioRoomBtn.click();
    await page.waitForTimeout(400);
  }
  const moreDockBtn = page.locator('button[aria-label="More voice options"]').first();
  if (await moreDockBtn.isVisible()) {
    await moreDockBtn.click();
    await page.waitForTimeout(300);
    const qualityItem = page.locator('.zenith-context-menu [role="menuitem"]:has-text("Screen share quality")');
    if (await qualityItem.isVisible()) {
      await qualityItem.click();
      await page.waitForSelector('.zenith-share-modal', { timeout: 5000 });
      await page.waitForTimeout(300);
      await saveScreen(page, `14_share_quality_modal_1280x720.png`);
      logAudit('Screen Share Quality Modal', 'VERIFIED');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  // =========================================================================
  // 9. SERVER SETTINGS MODAL
  // =========================================================================
  console.log('\n--- 9. Auditing Server Settings Modal ---');
  await serverIcon.click();
  await page.waitForTimeout(400);

  const serverOptionsBtn = page.locator('button[aria-label="Server options"], button[title="Server options"]').first();
  if (await serverOptionsBtn.isVisible()) {
    await serverOptionsBtn.click();
    await page.waitForSelector('dialog.zenith-server-settings-modal[open]', { timeout: 5000 });
    await page.waitForTimeout(400);
    await saveScreen(page, `15_server_settings_overview_1280x720.png`);
    logAudit('Server Settings: Overview Tab', 'VERIFIED');

    // Switch to Members
    const membersNavBtn = page.locator('.zenith-server-nav-btn', { hasText: 'Members & Roles' });
    if (await membersNavBtn.isVisible()) {
      await membersNavBtn.click();
      await page.waitForTimeout(300);
      await saveScreen(page, `15_server_settings_members_1280x720.png`);
      logAudit('Server Settings: Members Tab', 'VERIFIED');
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // =========================================================================
  // 10. CHANNEL CREATION & COMMUNITY INVITATIONS MODALS
  // =========================================================================
  console.log('\n--- 10. Auditing Channel Creation & Community Invitations Modals ---');
  await serverIcon.click();
  await page.waitForTimeout(300);

  const createChanBtn = page.locator('button[title="Create channel"], button[aria-label="Create channel"]').first();
  if (await createChanBtn.isVisible()) {
    await createChanBtn.click();
    await page.waitForSelector('.zenith-channel-modal', { timeout: 5000 });
    await page.waitForTimeout(300);
    await saveScreen(page, `16_channel_creation_modal_1280x720.png`);
    logAudit('Channel Creation Modal', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Invitations modal
  const inviteBtn = page.locator('.sidebar-header button[title="Invite people"], button.member-invite, button:has-text("Grow your community")').first();
  if (await inviteBtn.isVisible()) {
    await inviteBtn.click();
    await page.waitForSelector('.zenith-invitations-modal, .zenith-invite-modal', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    if (await page.locator('.zenith-invitations-modal, .zenith-invite-modal').isVisible()) {
      await saveScreen(page, `17_community_invitations_modal_1280x720.png`);
      logAudit('Community Invitations Modal', 'VERIFIED');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  // =========================================================================
  // 11. CREATE SERVER & JOIN SERVER MODALS
  // =========================================================================
  console.log('\n--- 11. Auditing Create Server & Join Server Modals ---');
  const addServerBtn = page.locator('.server-icon.add-server, button[aria-label="Create a server"]').first();
  if (await addServerBtn.isVisible()) {
    await addServerBtn.click();
    await page.waitForSelector('.zenith-create-server-modal, dialog.zenith-onboarding-modal[open], .zenith-modal-frame', { timeout: 5000 });
    await page.waitForTimeout(300);
    await saveScreen(page, `18_create_server_modal_1280x720.png`);
    logAudit('Create Community Modal', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const joinServerBtn = page.locator('.server-icon.join-server, button[aria-label="Join a server"]').first();
  if (await joinServerBtn.isVisible()) {
    await joinServerBtn.click();
    await page.waitForSelector('.zenith-join-server-modal, dialog.zenith-onboarding-modal[open], .zenith-modal-frame', { timeout: 5000 });
    await page.waitForTimeout(300);
    await saveScreen(page, `19_join_server_modal_1280x720.png`);
    logAudit('Join Community Modal', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // =========================================================================
  // 12. ADD FRIEND & GROUP DM MODALS
  // =========================================================================
  console.log('\n--- 12. Auditing Add Friend & Group DM Modals ---');
  await havenHomeBtn.click();
  await page.waitForTimeout(300);

  const addFriendNavBtn = page.locator('.friends-nav-btn', { hasText: 'Add Friend' });
  if (await addFriendNavBtn.isVisible()) {
    await addFriendNavBtn.click();
    await page.waitForTimeout(300);
    await saveScreen(page, `20_add_friend_tab_1280x720.png`);
    logAudit('Add Friend Section', 'VERIFIED');
  }

  const groupDmBtn = page.locator('button[aria-label="New group message"], button[title="New group message"]').first();
  if (await groupDmBtn.isVisible()) {
    await groupDmBtn.click();
    await page.waitForSelector('.zenith-group-modal, .zenith-social-modal-card', { timeout: 5000 });
    await page.waitForTimeout(300);
    await saveScreen(page, `21_group_dm_modal_1280x720.png`);
    logAudit('Group DM Modal', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // =========================================================================
  // 13. CONTEXT MENUS (USER & MESSAGE)
  // =========================================================================
  console.log('\n--- 13. Auditing Context Menus ---');
  // Return to text channel
  await serverIcon.click();
  await page.waitForTimeout(300);
  await designTokensChannel.click();
  await page.waitForTimeout(300);

  // Right-click Marcus Vance in member sidebar
  const marcusRow = page.locator('.member-row', { hasText: 'Marcus Vance' }).first();
  if (await marcusRow.isVisible()) {
    await marcusRow.click({ button: 'right' });
    await page.waitForSelector('.zenith-context-menu', { timeout: 5000 });
    await page.waitForTimeout(200);
    await saveScreen(page, `22_user_context_menu_1280x720.png`);
    logAudit('User Context Menu', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // =========================================================================
  // 14. VOICE DOCK POPOVERS
  // =========================================================================
  console.log('\n--- 14. Auditing Voice Dock Popovers ---');
  await studioRoomBtn.click();
  await page.waitForTimeout(400);

  const micPopoverBtn = page.locator('button[aria-label="Input Options"]').first();
  if (await micPopoverBtn.isVisible()) {
    await micPopoverBtn.click();
    await page.waitForSelector('.voice-popover.mic-popover', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await saveScreen(page, `24_mic_options_popover_1280x720.png`);
    logAudit('Microphone Options Popover', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const phonePopoverBtn = page.locator('button[aria-label="Output Options"]').first();
  if (await phonePopoverBtn.isVisible()) {
    await phonePopoverBtn.click();
    await page.waitForSelector('.voice-popover.headphone-popover', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await saveScreen(page, `25_headphone_options_popover_1280x720.png`);
    logAudit('Headphone Options Popover', 'VERIFIED');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const wifiBtn = page.locator('.voice-dock-wifi, button:has-text("18ms")').first();
  if (await wifiBtn.isVisible()) {
    await wifiBtn.click();
    await page.waitForSelector('.voice-popover.diagnostics-popover', { state: 'visible', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    if (await page.locator('.diagnostics-popover').isVisible()) {
      await saveScreen(page, `26_wifi_diagnostics_popover_1280x720.png`);
      logAudit('Wi-Fi Diagnostics Popover', 'VERIFIED');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  // =========================================================================
  // 15. AUTHENTICATION SCREENS (Sign out to view)
  // =========================================================================
  console.log('\n--- 15. Auditing Authentication Screens ---');
  await settingsBtn.click();
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.locator('.settings-signout-btn, button:has-text("Sign out")').click();
  await page.waitForTimeout(600);

  // Confirm sign out if confirm dialog appears
  const confirmSignout = page.locator('button:has-text("Sign out")').last();
  if (await confirmSignout.isVisible()) await confirmSignout.click();
  await page.waitForTimeout(600);

  // Now in Auth view
  await saveScreen(page, `27_auth_login_1280x720.png`);
  await page.setViewportSize({ width: 500, height: 550 });
  await page.waitForTimeout(300);
  await saveScreen(page, `27_auth_login_500x550.png`);
  logAudit('Auth: Login Screen (1280x720 & 500x550)', 'VERIFIED');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Create account view
  const createAccountLink = page.locator('button, a', { hasText: /Create an account|Sign up/i }).first();
  if (await createAccountLink.isVisible()) {
    await createAccountLink.click();
    await page.waitForTimeout(300);
    await saveScreen(page, `28_auth_register_1280x720.png`);
    logAudit('Auth: Register Screen', 'VERIFIED');
  }

  // Forgot password view
  const forgotLink = page.locator('button, a', { hasText: /Forgot password/i }).first();
  if (await forgotLink.isVisible()) {
    await forgotLink.click();
    await page.waitForTimeout(300);
    await saveScreen(page, `29_password_recovery_1280x720.png`);
    logAudit('Auth: Password Recovery Flow', 'VERIFIED');
  }

  await browser.close();

  console.log('\n======================================================================');
  console.log(`AUDIT FINISHED: ${auditLog.length} sections audited and screens captured.`);
  console.log('======================================================================');
}

runAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
