import { chromium } from 'playwright';

async function testStreamMode() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });
  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });
  await page.waitForTimeout(600);

  const btns = await page.locator('.voice-room-view button').evaluateAll(nodes => nodes.map(n => ({
    text: n.innerText.trim(),
    className: n.className,
    title: n.title,
    ariaLabel: n.getAttribute('aria-label')
  })));
  console.log('Voice Room Buttons:', JSON.stringify(btns, null, 2));

  // What about "Share screen" button?
  const shareBtn = page.locator('button[title*="Share screen"], button:has-text("Share screen")').first();
  if (await shareBtn.isVisible()) {
    console.log('Clicking Share Screen...');
    await shareBtn.click();
    await page.waitForTimeout(600);
    console.log('Participants class after share:', await page.locator('.room-participants').getAttribute('class'));
  }

  await browser.close();
}

testStreamMode().catch(console.error);
