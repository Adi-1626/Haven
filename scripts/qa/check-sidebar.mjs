import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });
  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.waitForTimeout(1000);

  const data = await page.evaluate(() => {
    const textChannels = Array.from(document.querySelectorAll('.channel-section:nth-of-type(1) .channel-row span')).map(el => el.textContent);
    const voiceChannels = Array.from(document.querySelectorAll('.channel-section:nth-of-type(2) .channel-row span')).map(el => el.textContent);
    const allChannels = Array.from(document.querySelectorAll('.channel-row span')).map(el => el.textContent);
    return { textChannels, voiceChannels, allChannels };
  });

  console.log('DOM Channels Data:', JSON.stringify(data, null, 2));
  await browser.close();
}

main().catch(console.error);
