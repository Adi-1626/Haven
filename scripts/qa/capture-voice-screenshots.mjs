import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/c9def907-10db-40af-9ac0-6bf2c9c22b72/screenshots';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const viewports = [
  { name: 'voice_1920x1080', width: 1920, height: 1080 },
  { name: 'voice_1366x768', width: 1366, height: 768 },
  { name: 'voice_1280x720', width: 1280, height: 720 },
  { name: 'voice_768x1024', width: 768, height: 1024 },
  { name: 'voice_500x550', width: 500, height: 550 },
  { name: 'voice_390x844', width: 390, height: 844 },
];

async function capture() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail', { timeout: 10000 });

    // Click Zenith Design Lab
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();

    // Join Studio Room voice channel
    await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
    await page.waitForSelector('.voice-room-view', { timeout: 10000 });

    // Toggle member sidebar off so Voice Room gets full viewport width across all resolutions
    const memberToggle = page.locator('.topbar-tools .icon-button[title="Toggle member list"]');
    if (await memberToggle.isVisible()) {
      const hasOn = await memberToggle.evaluate(el => el.classList.contains('is-on'));
      if (hasOn) {
        await memberToggle.click();
        await page.waitForTimeout(300);
      }
    }
    await page.waitForTimeout(600);

    // 1. Capture 1920x1080 Focus Mode
    await page.screenshot({ path: path.join(outDir, 'voice_1920x1080.png') });
    console.log('Captured voice_1920x1080.png');

    // 2. Capture 1920x1080 Grid Mode
    const focusBtn = page.locator('button.voice-action-btn', { hasText: 'Focus' });
    if (await focusBtn.isVisible()) {
      await focusBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, 'voice_grid_1920x1080.png') });
      console.log('Captured voice_grid_1920x1080.png');

      // Return to focus mode
      const gridBtn = page.locator('button.voice-action-btn', { hasText: 'Grid' });
      if (await gridBtn.isVisible()) await gridBtn.click();
      await page.waitForTimeout(300);
    }

    // 3. Capture across all remaining responsive viewports
    for (const vp of viewports.slice(1)) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500);

      // Verify no horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      console.log(`Viewport ${vp.name} (${vp.width}x${vp.height}) - Horizontal overflow: ${overflow}`);

      const filePath = path.join(outDir, `${vp.name}.png`);
      await page.screenshot({ path: filePath });
      console.log(`Captured ${vp.name}.png`);
    }

    // 4. Capture reconnecting state at 500x550 matching Stitch reference
    await page.setViewportSize({ width: 500, height: 550 });
    await page.evaluate(() => {
      const view = document.querySelector('.voice-room-view');
      const tabs = document.querySelector('.voice-room-tabs');
      if (view && tabs) {
        const banner = document.createElement('div');
        banner.className = 'voice-state-banner reconnecting';
        banner.setAttribute('role', 'alert');
        banner.innerHTML = `
          <div class="voice-state-banner-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
            <div>
              <strong>Restoring voice connection…</strong>
              <small>Attempt 2 of 5 • WebRTC Direct Mesh</small>
            </div>
          </div>
          <button class="voice-reconnect-btn">Reconnect now</button>
        `;
        tabs.before(banner);
      }
    });
    await page.waitForTimeout(300);
    const reconPath = path.join(outDir, 'voice_reconnecting_500x550.png');
    await page.screenshot({ path: reconPath });
    console.log(`Captured voice_reconnecting_500x550.png`);

    console.log('All responsive voice screenshots captured successfully!');
  } finally {
    await browser.close();
  }
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
