import { chromium } from 'playwright';

async function testMobileNav() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 500, height: 550 } });
  await page.goto('http://127.0.0.1:5173/?count=4');
  await page.waitForTimeout(500);

  const mobileBtn = page.locator('.mobile-menu-button');
  console.log('Mobile menu button visible:', await mobileBtn.isVisible());
  if (await mobileBtn.isVisible()) {
    await mobileBtn.click();
    await page.waitForTimeout(300);
  }

  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 8000 });
  await page.waitForTimeout(400);

  const tiles = await page.locator('.person-tile').count();
  console.log('Found tiles at 500x550:', tiles);

  await browser.close();
}

testMobileNav().catch(console.error);
