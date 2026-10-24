import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outputDir = path.resolve('output/zenith-3screens');
fs.mkdirSync(outputDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.app', { timeout: 10000 });

  // Select Zenith Design Lab server
  const serverBtn = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  if (await serverBtn.count() > 0) {
    await serverBtn.click();
    await page.waitForTimeout(400);
  }

  // Join a voice channel
  const voiceChannel = page.locator('.channel-row').filter({ hasText: /voice|lounge|stage/i }).first();
  if (await voiceChannel.count() > 0) {
    await voiceChannel.click();
    await page.waitForTimeout(600);
  }

  // Check for persistent voice connection dock
  const voiceDock = page.locator('.voice-connected, .voice-dock');
  if (await voiceDock.count() > 0) {
    console.log('✓ Connected to voice');

    // 1. Open Soundboard
    const soundboardBtn = page.locator('button[aria-label="Soundboard"]').first();
    if (await soundboardBtn.count() > 0) {
      await soundboardBtn.click();
      await page.waitForSelector('.zenith-soundboard-modal', { timeout: 5000 });
      await page.screenshot({ path: path.join(outputDir, 'screen3_soundboard_modal.png') });
      console.log('✓ Captured Soundboard Modal');

      // Close soundboard
      await page.locator('.zenith-soundboard-modal .zenith-media-close-btn').click();
      await page.waitForTimeout(200);
    }

    // 2. Open Screen Share Quality
    const moreBtn = page.locator('button[aria-label="More voice options"]').first();
    if (await moreBtn.count() > 0) {
      await moreBtn.click();
      await page.waitForTimeout(300);
      const qualityItem = page.locator('.zenith-context-menu [role="menuitem"]:has-text("Screen share quality")').first();
      if (await qualityItem.count() > 0) {
        await qualityItem.click();
        await page.waitForSelector('.zenith-share-modal', { timeout: 5000 });
        await page.screenshot({ path: path.join(outputDir, 'screen3_share_quality_modal.png') });
        console.log('✓ Captured Share Quality Modal');
      } else {
        console.log('Quality menu item count:', await qualityItem.count());
      }
    }
  }

  await browser.close();
  console.log('Done!');
}

run().catch(console.error);
