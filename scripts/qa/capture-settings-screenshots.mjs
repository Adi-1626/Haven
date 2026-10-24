import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const artifactDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/a066f0e7-90e7-4972-85bc-cf7168b2b3b5';
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

async function run() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  console.log('Navigating to http://127.0.0.1:5173/ ...');
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForLoadState('networkidle');

  // Open Settings
  console.log('Opening settings dialog...');
  await page.locator('.user-panel .icon-button[title="Settings"], button[aria-label="Settings"], .server-icon[aria-label="Settings"]').first().click();
  await page.waitForSelector('dialog.settings-dialog[open]');

  // 1. Screenshot Profile
  console.log('Capturing Profile...');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, 'profile.png') });

  // 2. Screenshot Voice & Video
  console.log('Capturing Voice & Video...');
  await page.locator('.settings-nav-btn').filter({ hasText: 'voice & video' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, 'voice_video.png') });

  // 3. Screenshot Desktop & Gaming
  console.log('Capturing Desktop & Gaming...');
  await page.locator('.settings-nav-btn').filter({ hasText: 'desktop & gaming' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, 'desktop_gaming.png') });

  // 4. Screenshot Notifications
  console.log('Capturing Notifications...');
  await page.locator('.settings-nav-btn').filter({ hasText: 'notifications' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, 'notifications.png') });

  // Close Settings Dialog
  console.log('Closing settings dialog...');
  await page.locator('.settings-close-button').click();
  await page.waitForTimeout(400);

  // Join voice channel to reveal the persistent voice dock with Input & Output options
  console.log('Joining voice channel Studio Room...');
  await page.locator('.channel-row button').filter({ hasText: 'Studio Room' }).first().click();
  await page.waitForSelector('.persistent-voice-controls', { timeout: 5000 });
  await page.waitForTimeout(500);

  // 5. Screenshot Input Options
  console.log('Capturing Input Options...');
  await page.locator('button[aria-label="Input Options"]').click();
  await page.waitForSelector('.voice-popover.mic-popover', { state: 'visible' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, 'input_options.png') });

  // Close Input Options by clicking outside or pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 6. Screenshot Output Options
  console.log('Capturing Output Options...');
  await page.locator('button[aria-label="Output Options"]').click();
  await page.waitForSelector('.voice-popover.headphone-popover', { state: 'visible' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifactDir, 'output_options.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Disconnect voice
  const leaveBtn = page.locator('.voice-dock-leave');
  if (await leaveBtn.count() > 0) {
    await leaveBtn.click();
    await page.waitForTimeout(300);
  }

  // Responsive viewports verification
  const viewports = [
    { width: 1920, height: 1080, name: '1920x1080' },
    { width: 1366, height: 768, name: '1366x768' },
    { width: 1280, height: 720, name: '1280x720' },
    { width: 800, height: 480, name: '800x480' },
    { width: 500, height: 550, name: '500x550' },
    { width: 390, height: 844, name: '390x844' },
  ];

  for (const vp of viewports) {
    console.log(`Verifying viewport ${vp.name}...`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);

    // Click settings trigger directly via evaluate to avoid scroll-boundary issues on constrained heights
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Settings"]') || 
                  document.querySelector('button[aria-label="Notification settings"]') || 
                  document.querySelector('button.user-settings');
      if (btn) btn.click();
    });

    await page.waitForSelector('dialog.settings-dialog[open]', { timeout: 5000 });
    
    // In compact mode (<= 860px), if detail is open, click back to see categories
    const backBtn = page.locator('.settings-compact-back-btn.is-visible');
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForTimeout(300);
    }

    await page.locator('.settings-nav-btn').filter({ hasText: 'voice & video' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(artifactDir, `responsive_${vp.name}.png`) });
    await page.locator('.settings-close-button').click();
    await page.waitForTimeout(300);
  }

  await browser.close();
  console.log('All screenshots and verifications completed successfully!');
}

run().catch(err => {
  console.error('Error during screenshot capture:', err);
  process.exit(1);
});
