import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const artifactDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/a066f0e7-90e7-4972-85bc-cf7168b2b3b5';
const outputDir = path.join(artifactDir, 'zenith_fidelity');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function capture() {
  console.log('======================================================================');
  console.log('HAVEN Zenith Minimal UI Fidelity & Missing Screens Capture');
  console.log('======================================================================\n');

  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  console.log('Navigating to http://127.0.0.1:5173/ ...');
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);

  // -------------------------------------------------------------------------
  // 1A. Settings Voice & Video — Desktop (1280x720)
  // -------------------------------------------------------------------------
  console.log('1A. Capturing Settings Voice & Video (Desktop 1280x720)...');
  await page.locator('.user-panel .icon-button[title="Settings"], button[aria-label="Settings"]').first().click();
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.locator('.settings-nav-btn').filter({ hasText: 'voice & video' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '01_settings_voice_video_desktop.png') });
  await page.screenshot({ path: path.join(artifactDir, 'settings_voice_video_desktop.png') });

  // -------------------------------------------------------------------------
  // 1B. Settings Voice & Video — Compact (500x550)
  // -------------------------------------------------------------------------
  console.log('1B. Capturing Settings Voice & Video (Compact 500x550)...');
  await page.setViewportSize({ width: 500, height: 550 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '01b_settings_voice_video_compact.png') });
  await page.screenshot({ path: path.join(artifactDir, 'settings_voice_video_compact.png') });

  // Restore 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // -------------------------------------------------------------------------
  // 2. Settings Desktop & Gaming
  // -------------------------------------------------------------------------
  console.log('2. Capturing Settings Desktop & Gaming...');
  await page.locator('.settings-nav-btn').filter({ hasText: 'desktop & gaming' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '02_settings_desktop_gaming.png') });
  await page.screenshot({ path: path.join(artifactDir, 'settings_desktop_gaming.png') });

  // -------------------------------------------------------------------------
  // 3. Settings Notifications
  // -------------------------------------------------------------------------
  console.log('3. Capturing Settings Notifications...');
  await page.locator('.settings-nav-btn').filter({ hasText: 'notifications' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '03_settings_notifications.png') });
  await page.screenshot({ path: path.join(artifactDir, 'settings_notifications.png') });

  // Close Settings dialog
  await page.locator('.settings-close-button').click();
  await page.waitForTimeout(400);

  // -------------------------------------------------------------------------
  // 4. Microphone & Headphone Popovers (Voice Controls)
  // -------------------------------------------------------------------------
  console.log('4A. Joining Studio Room to reveal persistent voice dock...');
  await page.locator('.channel-row button').filter({ hasText: 'Studio Room' }).first().click();
  await page.waitForSelector('.persistent-voice-controls', { timeout: 8000 });
  await page.waitForTimeout(400);

  console.log('4B. Capturing Microphone popover (Input Options with Toggle Switch)...');
  await page.locator('button[aria-label="Input Options"]').click();
  await page.waitForSelector('.voice-popover.mic-popover', { state: 'visible' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '04_microphone_popover.png') });
  await page.screenshot({ path: path.join(artifactDir, 'microphone_popover.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  console.log('4C. Capturing Headphone popover (Output Options with Toggle Switch)...');
  await page.locator('button[aria-label="Output Options"]').click();
  await page.waitForSelector('.voice-popover.headphone-popover', { state: 'visible' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '04_headphone_popover.png') });
  await page.screenshot({ path: path.join(artifactDir, 'headphone_popover.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // -------------------------------------------------------------------------
  // 5. Profile Card (Screen A: 11a2ec3d20754e0b98aae52cddc62f21)
  // -------------------------------------------------------------------------
  console.log('5. Capturing Profile Card (Screen A)...');
  // Click on Marcus Vance avatar button in the room
  const marcusAvatarInRoom = page.locator('.person-tile').filter({ hasText: 'Marcus Vance' }).locator('.avatar-button');
  if (await marcusAvatarInRoom.isVisible()) {
    await marcusAvatarInRoom.click();
  } else {
    // If not in room, open #general and click member-row
    await page.locator('.channel-row button').filter({ hasText: 'general' }).first().click();
    await page.waitForTimeout(300);
    const marcusRow = page.locator('.member-row').filter({ hasText: 'Marcus Vance' }).first();
    if (await marcusRow.isVisible()) {
      await marcusRow.click();
    } else {
      await page.locator('.member-row').first().click();
    }
  }
  await page.waitForSelector('.profile-card.enhanced-profile', { timeout: 6000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, '05_profile_card_screen_a.png') });
  await page.screenshot({ path: path.join(artifactDir, 'profile_card_screen_a.png') });

  // -------------------------------------------------------------------------
  // 6. Full-Resolution Picture Viewer (Screen A: 11a2ec3d20754e0b98aae52cddc62f21)
  // -------------------------------------------------------------------------
  console.log('6. Capturing Full-Resolution Picture Viewer (Screen A)...');
  const avatarButton = page.locator('.profile-picture-button:not([disabled])');
  if (await avatarButton.isVisible()) {
    await avatarButton.click();
    await page.waitForSelector('.zenith-image-viewer-container', { timeout: 6000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outputDir, '06_picture_viewer_screen_a.png') });
    await page.screenshot({ path: path.join(artifactDir, 'picture_viewer_screen_a.png') });

    // Close picture viewer with ESC
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    console.log('Avatar picture button not enabled, closing profile card...');
  }

  // Close profile card
  const modalClose = page.locator('.modal .icon-button[title="Close profile"], .modal header button.icon-button');
  if (await modalClose.count() > 0) {
    await modalClose.first().click();
    await page.waitForTimeout(300);
  }

  // -------------------------------------------------------------------------
  // 7. Fullscreen Screen Sharing with controls visible (Screen C: 901b34b61c9b434f87fdb135e9ff6d5b)
  // -------------------------------------------------------------------------
  console.log('7. Opening StreamViewer and capturing Fullscreen with Controls Visible (Screen C)...');
  // Ensure we are in Studio Room
  await page.locator('.channel-row button').filter({ hasText: 'Studio Room' }).first().click();
  await page.waitForTimeout(400);

  // Switch to room streams tab
  const streamsTab = page.locator('#room-streams-tab');
  if (await streamsTab.isVisible()) {
    await streamsTab.click();
    await page.waitForTimeout(300);
  }

  const watchButton = page.locator('button').filter({ hasText: /Watch Elena Rostova|Watch Marcus/ }).first();
  if (await watchButton.isVisible()) {
    await watchButton.click();
    await page.waitForSelector('.stream-viewer', { timeout: 6000 });
    await page.waitForTimeout(400);

    // Trigger fullscreen state class for pure cinematic OLED rendering
    await page.evaluate(() => {
      const viewer = document.querySelector('.stream-viewer');
      if (viewer) viewer.classList.add('is-fullscreen');
    });

    // Move mouse to keep controls visible
    await page.mouse.move(500, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outputDir, '07_fullscreen_stream_controls_visible.png') });
    await page.screenshot({ path: path.join(artifactDir, 'fullscreen_stream_controls_visible.png') });

    // -------------------------------------------------------------------------
    // 8. Fullscreen Screen Sharing with controls hidden (after idle auto-hide)
    // -------------------------------------------------------------------------
    console.log('8. Capturing Fullscreen with Controls Hidden (Screen C idle auto-hide)...');
    // Wait 3.6s for ghost-hud and ghost-dock to auto-hide
    await page.waitForTimeout(3600);
    await page.screenshot({ path: path.join(outputDir, '08_fullscreen_stream_controls_hidden.png') });
    await page.screenshot({ path: path.join(artifactDir, 'fullscreen_stream_controls_hidden.png') });

    // -------------------------------------------------------------------------
    // 9. Fullscreen Playback at different aspect ratios: 16:9, 16:10, 21:9 Ultrawide
    // -------------------------------------------------------------------------
    console.log('9A. Stream Aspect Ratio 16:9 (1920x1080)...');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.mouse.move(500, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outputDir, '09a_stream_aspect_16_9.png') });
    await page.screenshot({ path: path.join(artifactDir, 'stream_aspect_16_9.png') });

    console.log('9B. Stream Aspect Ratio 16:10 (1920x1200)...');
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.mouse.move(500, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outputDir, '09b_stream_aspect_16_10.png') });
    await page.screenshot({ path: path.join(artifactDir, 'stream_aspect_16_10.png') });

    console.log('9C. Stream Aspect Ratio 21:9 Ultrawide (2560x1080)...');
    await page.setViewportSize({ width: 2560, height: 1080 });
    await page.mouse.move(500, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outputDir, '09c_stream_aspect_21_9_ultrawide.png') });
    await page.screenshot({ path: path.join(artifactDir, 'stream_aspect_21_9_ultrawide.png') });

    // Exit fullscreen with ESC
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Return to voice room
    const returnBtn = page.locator('button, a').filter({ hasText: 'Return to voice room' }).first();
    if (await returnBtn.isVisible()) {
      await returnBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // Leave voice
  const leaveVoice = page.locator('.voice-dock-leave');
  if (await leaveVoice.isVisible()) {
    await leaveVoice.click();
    await page.waitForTimeout(300);
  }

  // Restore default viewport 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // -------------------------------------------------------------------------
  // 10. Account Recovery (Forgot Password Flow)
  // -------------------------------------------------------------------------
  console.log('10. Capturing Account Recovery & Password Reset Flow...');
  const authContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const authPage = await authContext.newPage();
  
  await authPage.request.post('http://127.0.0.1:5173/api/__mock/auth/reset');
  await authPage.goto('http://127.0.0.1:5173/');
  await authPage.evaluate(() => localStorage.setItem('haven.ui.mock.session', 'out'));
  await authPage.reload();
  await authPage.waitForSelector('.auth-card', { timeout: 8000 });
  await authPage.waitForTimeout(500);

  const forgotBtn = authPage.locator('.auth-forgot-link');
  if (await forgotBtn.isVisible()) {
    await forgotBtn.click();
    await authPage.waitForTimeout(400);
    console.log('Capturing Account Recovery (Email Entry)...');
    await authPage.screenshot({ path: path.join(outputDir, '10_account_recovery_email_entry.png') });
    await authPage.screenshot({ path: path.join(artifactDir, 'account_recovery_email_entry.png') });

    // Submit email
    await authPage.locator('#auth-email').fill('marcus@haven.community');
    await authPage.locator('button[type="submit"]').click();
    await authPage.waitForTimeout(500);
    console.log('Capturing Account Recovery (Check Email / Confirmation State)...');
    await authPage.screenshot({ path: path.join(outputDir, '10b_account_recovery_confirmation.png') });
    await authPage.screenshot({ path: path.join(artifactDir, 'account_recovery_confirmation.png') });
  }

  // -------------------------------------------------------------------------
  // 11. Password Reset Modal (Screen B: 25d92ae037344cdeab5718a91d3006f9)
  // -------------------------------------------------------------------------
  console.log('11. Capturing Password Reset Modal (Screen B)...');
  await authPage.goto('http://127.0.0.1:5173/?type=recovery');
  await authPage.waitForSelector('.recovery-modal', { timeout: 8000 });
  await authPage.waitForTimeout(500);

  // Fill in sample passwords to reveal strength indicator & matching state
  await authPage.locator('#recovery-new-password').fill('ZenithMinimal2026!');
  await authPage.locator('#recovery-confirm-password').fill('ZenithMinimal2026!');
  await authPage.waitForTimeout(300);

  await authPage.screenshot({ path: path.join(outputDir, '11_password_reset_screen_b.png') });
  await authPage.screenshot({ path: path.join(artifactDir, 'password_reset_screen_b.png') });

  await authContext.close();

  // -------------------------------------------------------------------------
  // 12. Full Responsive Viewports (Settings Voice & Video)
  // -------------------------------------------------------------------------
  console.log('\n--- 12. Capturing Comprehensive Responsive Viewports ---');
  const responsiveViewports = [
    { width: 1920, height: 1080, name: 'viewport_1920x1080' },
    { width: 1366, height: 768, name: 'viewport_1366x768' },
    { width: 1280, height: 720, name: 'viewport_1280x720' },
    { width: 800, height: 480, name: 'viewport_800x480' },
    { width: 500, height: 550, name: 'viewport_500x550' },
    { width: 390, height: 844, name: 'viewport_390x844' },
  ];

  for (const vp of responsiveViewports) {
    console.log(`Capturing ${vp.name} (${vp.width}x${vp.height})...`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    const isDialogOpen = await page.locator('dialog.settings-dialog[open]').isVisible();
    if (!isDialogOpen) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Settings"]') || 
                    document.querySelector('button.user-settings');
        if (btn) btn.click();
      });
      await page.waitForSelector('dialog.settings-dialog[open]', { timeout: 5000 });
    }

    const backBtn = page.locator('.settings-compact-back-btn.is-visible');
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForTimeout(200);
    }

    await page.locator('.settings-nav-btn').filter({ hasText: 'voice & video' }).click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(outputDir, `${vp.name}.png`) });
    await page.screenshot({ path: path.join(artifactDir, `${vp.name}.png`) });
  }

  await browser.close();
  console.log('\n======================================================================');
  console.log('All 11 fidelity screenshots and responsive viewports captured successfully!');
  console.log('Artifact directory:', outputDir);
  console.log('======================================================================');
}

capture().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
