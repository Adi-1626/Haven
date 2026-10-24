import { chromium } from 'playwright';

async function captureZenith() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(1000);
  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'zenith_sidebar.png' });
  console.log('Saved zenith_sidebar.png');
  await browser.close();
}

captureZenith().catch(console.error);
