import { chromium } from 'playwright';

async function testWatch() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });

  // Check if watch stream button is visible
  const watchBtn = page.locator('button.stream-watch-btn');
  if (await watchBtn.isVisible()) {
    console.log('Clicking Watch Stream...');
    await watchBtn.click();
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: 'scratch/studio-watched.png' });

  const data = await page.evaluate(() => {
    const strip = document.querySelector('.participant-strip');
    const tiles = Array.from(document.querySelectorAll('.person-tile'));
    return {
      hasStrip: !!strip,
      parentClass: document.querySelector('.room-participants')?.className,
      tiles: tiles.map(t => {
        const cardRect = t.getBoundingClientRect();
        const avatar = t.querySelector('.avatar-button, .avatar');
        const avatarRect = avatar?.getBoundingClientRect();
        const strong = t.querySelector('strong');
        const strongRect = strong?.getBoundingClientRect();
        const meta = t.querySelector('.participant-meta');
        const metaRect = meta?.getBoundingClientRect();
        const more = t.querySelector('.participant-more');
        const moreRect = more?.getBoundingClientRect();
        const cardCenter = cardRect.left + cardRect.width / 2;

        return {
          name: strong?.textContent?.trim(),
          tileClass: t.className,
          tileFlexDir: window.getComputedStyle(t).flexDirection,
          cardWidth: Math.round(cardRect.width),
          cardHeight: Math.round(cardRect.height),
          cardCenter: Math.round(cardCenter),
          avatarCenter: avatarRect ? Math.round(avatarRect.left + avatarRect.width / 2) : null,
          strongCenter: strongRect ? Math.round(strongRect.left + strongRect.width / 2) : null,
          metaCenter: metaRect ? Math.round(metaRect.left + metaRect.width / 2) : null,
          morePosition: more ? window.getComputedStyle(more).position : null,
        };
      })
    };
  });

  console.log(JSON.stringify(data, null, 2));

  await browser.close();
}

testWatch().catch(console.error);
