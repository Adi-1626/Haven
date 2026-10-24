import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'C:/Users/adity/OneDrive/Desktop/space/docs/screenshots/dock-verification';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const viewports = [
  { name: 'fullhd_1920x1080', width: 1920, height: 1080 },
  { name: 'desktop_1440x900', width: 1440, height: 900 },
  { name: 'laptop_1366x768', width: 1366, height: 768 },
  { name: 'laptop_1280x720', width: 1280, height: 720 },
  { name: 'tablet_768x1024', width: 768, height: 1024 },
  { name: 'compact_500x550', width: 500, height: 550 },
  { name: 'mobile_390x844', width: 390, height: 844 },
];

async function verify() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const results = [];

  try {
    for (const vp of viewports) {
      console.log(`\n======================================================`);
      console.log(`Testing viewport: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`======================================================`);
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
      });

      await page.goto('http://127.0.0.1:5173/');
      await page.waitForSelector('.app', { timeout: 10000 });

      const isMobile = vp.width <= 860;

      // Step 1: Select Zenith Design Lab
      if (isMobile) {
        const menuBtn = page.locator('.mobile-menu-button');
        await menuBtn.waitFor({ state: 'visible', timeout: 5000 });
        await menuBtn.click();
        await page.waitForTimeout(250);
      }

      await page.locator('.server-icon[title="Zenith Design Lab"]').click();
      await page.waitForTimeout(250);

      // Step 2: Join Studio Room voice channel
      if (isMobile) {
        const menuBtn = page.locator('.mobile-menu-button');
        await menuBtn.waitFor({ state: 'visible', timeout: 5000 });
        await menuBtn.click();
        await page.waitForTimeout(250);
      }

      const studioRoomBtn = page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first();
      await studioRoomBtn.waitFor({ state: 'visible', timeout: 5000 });
      await studioRoomBtn.click();
      await page.waitForSelector('.voice-room-view', { timeout: 10000 });
      console.log(`  [Pass] Joined Studio Room voice channel.`);

      // Step 3: Navigate to #design-tokens text channel
      if (isMobile) {
        const menuBtn = page.locator('.mobile-menu-button');
        await menuBtn.waitFor({ state: 'visible', timeout: 5000 });
        await menuBtn.click();
        await page.waitForTimeout(250);
      }

      const designTokensBtn = page.locator('.channel-row button', { hasText: 'design-tokens' });
      await designTokensBtn.waitFor({ state: 'visible', timeout: 5000 });
      await designTokensBtn.click();
      await page.waitForSelector('.message-list', { timeout: 10000 });
      console.log(`  [Pass] Navigated to #design-tokens text channel.`);

      // Step 4: Verify single floating dock
      const docks = page.locator('.voice-dock');
      const dockCount = await docks.count();
      if (dockCount !== 1) {
        throw new Error(`Expected exactly 1 voice dock, found ${dockCount}`);
      }
      console.log(`  [Pass] Exactly 1 floating voice dock exists.`);

      // Step 5: Verify room name button is visible and has display: flex
      const roomButton = page.locator('.voice-dock .connected-room');
      const isVisible = await roomButton.isVisible();
      const roomNameText = await roomButton.locator('strong').textContent();
      const buttonDisplay = await roomButton.evaluate(el => window.getComputedStyle(el).display);

      console.log(`  [Pass] .connected-room: visible=${isVisible}, display="${buttonDisplay}", label="${roomNameText}"`);
      if (!isVisible || buttonDisplay !== 'flex' || !roomNameText.includes('Studio Room')) {
        throw new Error(`Room button failed assertion at ${vp.width}x${vp.height}!`);
      }

      // Step 6: Verify all dock controls exist
      const micBtn = page.locator('.voice-dock .voice-action-btn[title*="microphone" i], .voice-dock .voice-action-btn[aria-label*="mic" i]');
      const deafenBtn = page.locator('.voice-dock .voice-action-btn[title*="deafen" i], .voice-dock .voice-action-btn[aria-label*="deafen" i]');
      const shareBtn = page.locator('.voice-dock .voice-dock-button[aria-label*="shar" i]');
      const soundBtn = page.locator('.voice-dock .voice-dock-button[aria-label="Soundboard"]');
      const moreBtn = page.locator('.voice-dock .voice-dock-button[aria-label="More voice options"]');
      const leaveBtn = page.locator('.voice-dock .voice-dock-leave');

      const hasAllControls = (await micBtn.count() > 0) &&
                             (await deafenBtn.count() > 0) &&
                             (await shareBtn.count() > 0) &&
                             (await soundBtn.count() > 0) &&
                             (await moreBtn.count() > 0) &&
                             (await leaveBtn.count() > 0);
      if (!hasAllControls) {
        throw new Error(`Missing audio controls in dock at ${vp.width}x${vp.height}!`);
      }
      console.log(`  [Pass] All controls preserved: Mic, Deafen, Share, Soundboard, More, Leave.`);

      // Step 7: Check horizontal overflow
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      console.log(`  [Pass] Horizontal overflow: ${hasOverflow ? 'DETECTED' : 'None (Clean)'}`);
      if (hasOverflow) {
        throw new Error(`Horizontal overflow detected at ${vp.width}x${vp.height}!`);
      }

      // Capture screenshot in text channel with voice dock active
      const chatDockScreenshot = path.join(outDir, `chat_dock_${vp.name}.png`);
      await page.screenshot({ path: chatDockScreenshot });

      // Step 8: Click room name button to reopen active Voice Room
      await roomButton.click();
      await page.waitForSelector('.voice-room-view', { timeout: 10000 });
      console.log(`  [Pass] Successfully reopened active Voice Room from floating dock!`);

      // Capture screenshot after reopening room
      const reopenedScreenshot = path.join(outDir, `reopened_${vp.name}.png`);
      await page.screenshot({ path: reopenedScreenshot });

      results.push({
        viewport: vp.name,
        resolution: `${vp.width}x${vp.height}`,
        dockCount,
        roomButtonVisible: isVisible,
        reopenedVoiceRoom: true,
        horizontalOverflow: hasOverflow ? 'FAIL' : 'PASS',
      });

      await page.close();
    }

    console.log('\n======================================================');
    console.log('ALL 7 VIEWPORT TESTS PASSED SUCCESSFULLY');
    console.log('======================================================');
    console.table(results);
  } finally {
    await browser.close();
  }
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
