import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const screenshotDir = path.resolve('docs/screenshots/ui-testing-mode');
fs.mkdirSync(screenshotDir, { recursive: true });

test.describe('Haven Local UI Testing Mode', () => {

  test('1. Opens automatically with fictional authenticated test account and renders Zenith workspace', async ({ page }) => {
    const blockedExternalUrls: string[] = [];
    page.on('request', request => {
      const url = request.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        blockedExternalUrls.push(url);
      }
    });

    await page.goto('/');

    // Wait for App to mount and load session
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.user-panel')).toContainText('Alex Mercer');

    // Click Zenith Design Lab in server rail
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await expect(page.locator('.server-name')).toContainText('Zenith Design Lab');

    // Confirm channel navigation is populated
    await expect(page.locator('.channel-row', { hasText: 'design-tokens' })).toBeVisible();
    await expect(page.locator('.channel-row', { hasText: 'feedback' })).toBeVisible();
    await expect(page.locator('.channel-row', { hasText: 'announcements' })).toBeVisible();
    await expect(page.locator('.channel-row', { hasText: 'Studio Room' })).toBeVisible();
    await expect(page.locator('.channel-row', { hasText: 'Design Lounge' })).toBeVisible();

    // Verify absolute isolation: ZERO external requests to Supabase or production services
    expect(blockedExternalUrls).toEqual([]);
  });

  test('2. Supports main chat navigation, message composer, reactions, and attachments', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    // Select Zenith Design Lab
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();

    // Navigate to #design-tokens
    await page.locator('.channel-row button', { hasText: 'design-tokens' }).click();
    await expect(page.locator('.channel-title')).toContainText('design-tokens');

    // Verify messages are rendered with author and reactions
    await expect(page.locator('.message-heading button', { hasText: 'Sarah Chen' })).toBeVisible();
    await expect(page.locator('.message-text', { hasText: 'Space Grotesk' })).toBeVisible();
    await expect(page.locator('.message-text', { hasText: 'contrast ratios' })).toBeVisible();

    // Send a message via Composer
    const composerInput = page.locator('.composer textarea');
    await expect(composerInput).toBeVisible();
    const testContent = `Testing Zenith Minimal UI message flow [${Date.now()}]`;
    await composerInput.fill(testContent);
    await composerInput.press('Enter');

    // Message appears immediately in the timeline
    await expect(page.locator('.message-text', { hasText: testContent })).toBeVisible();

    // Navigate to #feedback to inspect file attachments
    await page.locator('.channel-row button', { hasText: 'feedback' }).click();
    await expect(page.locator('.channel-title')).toContainText('feedback');
    await expect(page.locator('.attachment', { hasText: 'zenith-ui-spec.pdf' })).toBeVisible();
    await expect(page.locator('.attachment', { hasText: 'zenith-color-tokens.png' })).toBeVisible();

    // Test reaction toggle
    const reactionButton = page.locator('.reactions button').first();
    if (await reactionButton.isVisible()) {
      await reactionButton.click();
    }
  });

  test('3. Supports Friends page, Direct Messages, and Group Conversations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    // Click Haven Home icon
    await page.locator('.server-icon.haven-icon').click();
    await expect(page.locator('.home-item')).toContainText('Friends');

    // Friends list check
    await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
    await expect(page.locator('.friend-row', { hasText: 'Elena Rostova' })).toBeVisible();
    await expect(page.locator('.friend-row', { hasText: 'Marcus Vance' })).toBeVisible();

    // Check Pending tab for Kai Tanaka
    await page.getByRole('tab', { name: /Pending/ }).click();
    await expect(page.locator('.friend-row', { hasText: 'Kai Tanaka' })).toBeVisible();

    // Check Direct Messages in sidebar
    await expect(page.locator('.dm-row', { hasText: 'Elena Rostova' })).toBeVisible();
    await page.locator('.dm-row', { hasText: 'Elena Rostova' }).click();
    await expect(page.locator('.channel-title')).toContainText('Elena Rostova');
    await expect(page.locator('.message-text', { hasText: 'audio pipeline spatial mix' })).toBeVisible();

    // Check Group conversation
    await page.locator('.dm-row', { hasText: 'Design System Working Group' }).click();
    await expect(page.locator('.channel-title')).toContainText('Design System Working Group');
    await expect(page.locator('.message-text', { hasText: 'Electron min' })).toBeVisible();
  });

  test('4. Supports Voice Room layouts, simulated screen sharing, and StreamViewer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    // Select Zenith Design Lab server
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();

    // Join Studio Room voice channel
    await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();

    // Confirm voice view channel panel opens
    await expect(page.locator('.voice-room-view')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.voice-room-title')).toContainText('Studio Room');

    // Confirm participant tiles rendered with realistic states
    await expect(page.locator('.person-tile', { hasText: 'Alex Mercer' })).toBeVisible();
    await expect(page.locator('.person-tile', { hasText: 'Elena Rostova' })).toBeVisible();
    await expect(page.locator('.person-tile', { hasText: 'Sarah Chen' })).toBeVisible();
    await expect(page.locator('.person-tile', { hasText: 'Devon Knox' })).toBeVisible();
    await expect(page.locator('.person-tile')).toHaveCount(4);

    // Elena has LIVE tag for screen share
    const elenaTile = page.locator('.person-tile', { hasText: 'Elena Rostova' });
    await expect(elenaTile.locator('.live-tag')).toBeVisible();

    // Check Streams tab
    await page.locator('#room-streams-tab').click();
    await expect(page.locator('.room-streams')).toBeVisible();
    const watchElenaButton = page.getByRole('region', { name: 'Elena Rostova’s stream preview' }).getByRole('button', { name: 'Watch Stream', exact: true });
    await expect(watchElenaButton).toBeVisible();

    // Take screenshot of voice room
    await page.screenshot({ path: path.join(screenshotDir, 'voice-room-studio.png') });

    // Subscribe first, then expand the received stream into StreamViewer.
    await watchElenaButton.click();
    await page.getByRole('button', { name: 'Fullscreen Elena Rostova’s stream', exact: true }).click();
    const viewer = page.locator('.stream-viewer');
    await expect(viewer).toBeVisible({ timeout: 5_000 });
    await expect(viewer).toContainText('Elena Rostova’s Screen');
    await expect(viewer.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();

    // Take screenshot of StreamViewer
    await page.screenshot({ path: path.join(screenshotDir, 'stream-viewer.png') });

    // Close StreamViewer
    await page.locator('button', { hasText: 'Return to voice room' }).click();
    await expect(viewer).toBeHidden();

    // Navigate to Design Lounge directly from visible sidebar UI
    await expect(page.locator('.channel-row', { hasText: 'Design Lounge' })).toBeVisible();
    await page.locator('.channel-row', { hasText: 'Design Lounge' }).locator('button').first().click();

    // Confirm Design Lounge voice room view is active
    await expect(page.locator('.voice-room-view')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.voice-room-title')).toContainText('Design Lounge');

    // The default lounge fixture has Kai plus the current user, without screen sharing.
    await expect(page.locator('.person-tile')).toHaveCount(2);
    await expect(page.locator('.person-tile', { hasText: 'Alex Mercer' })).toBeVisible();
    await expect(page.locator('.person-tile', { hasText: 'Kai Tanaka' })).toBeVisible();

    // Verify 0 active screen shares in Design Lounge
    await expect(page.locator('.person-tile .live-tag')).toHaveCount(0);
    await expect(page.locator('.screen-theater-card')).toHaveCount(0);

    // Take screenshot of the default Design Lounge fixture.
    await page.screenshot({ path: path.join(screenshotDir, 'voice-room-design-lounge.png') });

    // Verify returning to Studio Room via sidebar UI works cleanly
    await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
    await expect(page.locator('.voice-room-title')).toContainText('Studio Room');
    await expect(page.locator('.person-tile', { hasText: 'Elena Rostova' }).locator('.live-tag')).toBeVisible();
  });

  test('5. Supports Settings, Microphone Test, Server Settings, and Soundboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    // Open User Settings
    await page.locator('.user-panel .user-settings').click();
    const settingsModal = page.locator('dialog.modal', { hasText: 'Your settings' });
    await expect(settingsModal).toBeVisible();

    // Profile tab
    await expect(page.locator('.profile-settings-avatar')).toContainText('@alex_zenith');

    // Switch to voice & video tab
    await page.locator('.settings-layout nav button', { hasText: 'voice & video' }).click();
    await expect(page.locator('.microphone-test')).toBeVisible();

    // Test Microphone Test widget
    const micTestBtn = page.locator('.mic-test-controls button');
    await expect(micTestBtn).toContainText("Let's Check");
    await micTestBtn.click();
    await expect(micTestBtn).toContainText('Stop Test');
    await page.screenshot({ path: path.join(screenshotDir, 'user-settings-voice.png') });
    await micTestBtn.click();
    await expect(micTestBtn).toContainText("Let's Check");

    // Close Settings
    await page.locator('dialog.modal button[aria-label="Close dialog"]').click();
    await expect(settingsModal).toBeHidden();

    // Select Zenith Design Lab
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();

    // Open Server Settings dialog
    await page.locator('.icon-button[title="Server options"]').click();
    const serverSettingsModal = page.locator('dialog.modal', { hasText: 'Community settings' });
    await expect(serverSettingsModal).toBeVisible();
    await page.locator('dialog.modal button[aria-label="Close dialog"]').click();
    await expect(serverSettingsModal).toBeHidden();
  });

  // Authentication and first-time profile tests (tests 6, 8 and 9 before the two-stage redesign) live in dev-ui-auth.spec.ts.

  test('7. Responsive Viewport Inspections across all target resolutions', async ({ page }) => {
    const viewports = [
      { name: 'mobile-390x844', width: 390, height: 844 },
      { name: 'electron-min-500x550', width: 500, height: 550 },
      { name: 'tablet-768x1024', width: 768, height: 1024 },
      { name: 'laptop-1280x720', width: 1280, height: 720 },
      { name: 'desktop-1366x768', width: 1366, height: 768 },
      { name: 'fullhd-1920x1080', width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await expect(page.locator('.app')).toBeVisible();

      // On mobile viewports (width <= 700), check mobile menu button
      if (vp.width <= 700) {
        const mobileMenuBtn = page.locator('.mobile-menu-button');
        await expect(mobileMenuBtn).toBeVisible();

        // Open mobile navigation drawer
        await mobileMenuBtn.click();
        await expect(page.locator('.app')).toHaveClass(/nav-open/);

        // Capture screenshot of mobile drawer open
        await page.screenshot({ path: path.join(screenshotDir, `${vp.name}-drawer-open.png`) });

        // Close drawer
        await page.locator('.nav-scrim').click();
        await expect(page.locator('.app')).not.toHaveClass(/nav-open/);
      }

      // Capture main workspace screenshot
      await page.screenshot({ path: path.join(screenshotDir, `${vp.name}.png`) });

      // Verify no horizontal document body overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth - clientWidth, `${vp.name}: horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });

});
