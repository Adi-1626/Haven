import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('output/phase3-verification');
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  { width: 1920, height: 1080, name: '1920x1080' },
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1280, height: 720, name: '1280x720' },
  { width: 800, height: 480, name: '800x480' },
  { width: 500, height: 550, name: '500x550' },
  { width: 390, height: 844, name: '390x844' },
];

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const report = [];

for (const vp of viewports) {
  console.log(`\nTesting viewport: ${vp.name} (${vp.width}×${vp.height})`);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await page.goto('http://127.0.0.1:5198');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);

  // 1. Open User Settings
  // In compact layout (<= 800 or when mobile nav button visible), ensure navigation is accessible
  const userSettingsBtn = page.locator('.server-icon.small[title="Settings"], button.user-settings').first();
  if (!(await userSettingsBtn.isVisible())) {
    // Check if mobile menu button is present
    const mobileMenu = page.locator('.mobile-menu-button');
    if (await mobileMenu.isVisible()) {
      await mobileMenu.click();
      await page.waitForTimeout(200);
    }
  }

  await userSettingsBtn.click();
  const settingsModal = page.locator('dialog.settings-dialog, dialog.modal.wide');
  await settingsModal.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);

  // Helper to switch categories accounting for compact single-pane navigation
  async function selectCategory(name) {
    const backBtn = page.locator('.settings-compact-back-btn');
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForTimeout(150);
    }
    const btn = page.locator('.settings-layout nav button, .settings-nav-btn').filter({ hasText: new RegExp(name, 'i') }).first();
    await btn.waitFor({ state: 'visible' });
    await btn.click();
    await page.waitForTimeout(200);
  }

  // Check Profile Settings category
  await page.screenshot({ path: path.join(outDir, `settings-profile-${vp.name}.png`) });

  // For compact viewports, also capture the category rail screenshot
  const compactBackBtn = page.locator('.settings-compact-back-btn');
  if (await compactBackBtn.isVisible()) {
    await compactBackBtn.click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `settings-categories-${vp.name}.png`) });
    // Go back into profile
    await page.locator('.settings-layout nav button, .settings-nav-btn').filter({ hasText: /profile/i }).first().click();
    await page.waitForTimeout(150);
  }

  // 2. Switch to Voice & Audio category
  await selectCategory('voice & video');
  await page.screenshot({ path: path.join(outDir, `settings-voice-${vp.name}.png`) });

  // 3. Switch to Desktop & Gaming category
  await selectCategory('desktop & gaming');
  await page.screenshot({ path: path.join(outDir, `settings-gaming-${vp.name}.png`) });

  // 4. Switch to Notifications category
  await selectCategory('notifications');
  await page.screenshot({ path: path.join(outDir, `settings-notifications-${vp.name}.png`) });

  // 5. Test Profile Draft persistence and Discard Prompt
  await selectCategory('profile');

  // Modify Display Name to create dirty draft
  const displayNameInput = page.locator('input[name="displayName"]');
  await displayNameInput.fill('Alex Mercer (Draft Test)');

  // Switch to Voice & Video while draft is dirty
  await selectCategory('voice & video');

  // Switch back to Profile - verify draft persisted!
  await selectCategory('profile');
  const persistedValue = await displayNameInput.inputValue();
  const draftPersisted = persistedValue === 'Alex Mercer (Draft Test)';

  // Now attempt to close while dirty -> Discard prompt appears!
  const closeBtn = page.locator('button[aria-label="Close dialog"]').first();
  await closeBtn.click();
  await page.waitForTimeout(200);

  const discardOverlay = page.locator('.settings-discard-overlay');
  const discardPromptVisible = await discardOverlay.isVisible();
  if (discardPromptVisible) {
    await page.screenshot({ path: path.join(outDir, `settings-discard-prompt-${vp.name}.png`) });
    // Click "Discard changes" to dismiss
    await page.locator('.settings-discard-actions button.danger-bg').click();
  }

  await settingsModal.waitFor({ state: 'hidden' });

  // 6. Test Profile Card & Image Viewer
  const serverIcon = page.locator('.server-icon[title="Zenith Design Lab"]').first();
  if (!(await serverIcon.isVisible())) {
    const mobileMenu = page.locator('.mobile-menu-button');
    if (await mobileMenu.isVisible()) {
      await mobileMenu.click();
      await page.waitForTimeout(200);
    }
  }
  if (await serverIcon.isVisible()) {
    await serverIcon.click();
    await page.waitForTimeout(300);
  }

  // In compact layout, ensure chat area is visible
  const authorBtn = page.locator('.message-heading button').first();
  if (!(await authorBtn.isVisible())) {
    const generalChannel = page.locator('.channel-item').filter({ hasText: 'general' }).first();
    if (await generalChannel.isVisible()) {
      await generalChannel.click();
      await page.waitForTimeout(300);
    }
  }

  if (await authorBtn.isVisible()) {
    await authorBtn.click();
    const profileCardModal = page.locator('dialog.modal:has(.enhanced-profile)');
    await profileCardModal.waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, `profile-card-${vp.name}.png`) });

    // Open Image Viewer if avatar clickable
    const avatarPicBtn = page.locator('.profile-picture-button:not([disabled])');
    if (await avatarPicBtn.isVisible()) {
      await avatarPicBtn.click();
      const imageViewerModal = page.locator('dialog.modal:has(.profile-image-viewer)');
      await imageViewerModal.waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, `profile-image-viewer-${vp.name}.png`) });

      // Toggle Fit / Actual size
      const fitToggle = imageViewerModal.locator('button', { hasText: /Actual size|Fit to window/ });
      if (await fitToggle.isVisible()) {
        await fitToggle.click();
        await page.waitForTimeout(150);
      }
      // Close Image Viewer
      await imageViewerModal.locator('button[aria-label="Close dialog"]').click();
      await imageViewerModal.waitFor({ state: 'hidden' });
    }

    // Close Profile Card
    await profileCardModal.locator('button[aria-label="Close dialog"]').click();
    await profileCardModal.waitFor({ state: 'hidden' });
  }

  // Check horizontal overflow
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );

  report.push({
    viewport: vp.name,
    dimensions: `${vp.width}×${vp.height}`,
    horizontalOverflow: hasHorizontalOverflow,
    draftPersisted,
    discardPromptVisible,
  });

  await context.close();
}

await browser.close();

fs.writeFileSync(
  path.join(outDir, 'verification-report.json'),
  JSON.stringify(report, null, 2)
);
console.log('\nVerification complete! Report:');
console.table(report);
