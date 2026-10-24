import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/c9def907-10db-40af-9ac0-6bf2c9c22b72';

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Fresh load directly to Haven
  console.log('Navigating to http://127.0.0.1:5173/ ...');
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.channel-sidebar', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Take screenshot showing both voice channels in sidebar
  const sidebarScreenshot = path.join(artifactDir, 'both_voice_channels_sidebar.png');
  await page.screenshot({ path: sidebarScreenshot });
  console.log(`Saved screenshot to: ${sidebarScreenshot}`);

  // 2. Click Studio Room and capture
  console.log('Clicking Studio Room...');
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });
  await page.waitForTimeout(1000);
  const studioScreenshot = path.join(artifactDir, 'studio_room_ui.png');
  await page.screenshot({ path: studioScreenshot });
  console.log(`Saved screenshot to: ${studioScreenshot}`);

  // 3. Click Design Lounge directly from sidebar and capture
  console.log('Clicking Design Lounge from sidebar...');
  await page.locator('.channel-row', { hasText: 'Design Lounge' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });
  await page.waitForTimeout(1000);
  const loungeScreenshot = path.join(artifactDir, 'design_lounge_ui.png');
  await page.screenshot({ path: loungeScreenshot });
  console.log(`Saved screenshot to: ${loungeScreenshot}`);

  await browser.close();
}

main().catch(console.error);
