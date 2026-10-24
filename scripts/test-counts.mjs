import { chromium } from 'playwright';

async function testCounts() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const count of [1, 2, 4, 6, 8]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:5173/?count=${count}`);
    await page.waitForSelector('.server-rail', { timeout: 10000 });
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
    await page.waitForSelector('.voice-room-view', { timeout: 10000 });
    // wait a moment for voice connection
    await page.waitForTimeout(500);
    const tilesCount = await page.locator('.person-tile').count();
    const names = await page.locator('.person-tile strong').allTextContents();
    console.log(`count=${count}: found ${tilesCount} tiles -> ${names.join(', ')}`);
    await page.close();
  }
  await browser.close();
}

testCounts().catch(console.error);
