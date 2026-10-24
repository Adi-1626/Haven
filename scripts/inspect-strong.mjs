import { chromium } from 'playwright';

async function inspectStrong() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });

  const result = await page.evaluate(() => {
    const tile = document.querySelector('.person-tile');
    const strong = tile.querySelector('strong');
    const details = tile.querySelector('.participant-details');
    const meta = tile.querySelector('.participant-meta');

    return {
      tile: {
        display: window.getComputedStyle(tile).display,
        alignItems: window.getComputedStyle(tile).alignItems,
        justifyContent: window.getComputedStyle(tile).justifyContent,
        textAlign: window.getComputedStyle(tile).textAlign,
        rect: tile.getBoundingClientRect()
      },
      details: {
        display: window.getComputedStyle(details).display,
        alignItems: window.getComputedStyle(details).alignItems,
        justifyContent: window.getComputedStyle(details).justifyContent,
        textAlign: window.getComputedStyle(details).textAlign,
        width: window.getComputedStyle(details).width,
        rect: details.getBoundingClientRect()
      },
      strong: {
        display: window.getComputedStyle(strong).display,
        textAlign: window.getComputedStyle(strong).textAlign,
        width: window.getComputedStyle(strong).width,
        rect: strong.getBoundingClientRect(),
        textRect: (() => {
          const r = document.createRange();
          r.selectNodeContents(strong);
          return r.getBoundingClientRect();
        })()
      },
      meta: {
        display: window.getComputedStyle(meta).display,
        alignItems: window.getComputedStyle(meta).alignItems,
        justifyContent: window.getComputedStyle(meta).justifyContent,
        textAlign: window.getComputedStyle(meta).textAlign,
        width: window.getComputedStyle(meta).width,
        rect: meta.getBoundingClientRect()
      }
    };
  });

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

inspectStrong().catch(console.error);
