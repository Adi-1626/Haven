import { chromium } from 'playwright';

async function checkTextCenters() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });

  const textMetrics = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.person-tile'));
    return tiles.map(t => {
      const cardRect = t.getBoundingClientRect();
      const cardCenter = cardRect.left + cardRect.width / 2;

      const avatar = t.querySelector('.avatar');
      const avatarRect = avatar?.getBoundingClientRect();
      const avatarCenter = avatarRect ? avatarRect.left + avatarRect.width / 2 : null;

      const strong = t.querySelector('strong');
      // Get exact text bounding rect using Range
      let textCenter = null;
      if (strong && strong.firstChild) {
        const range = document.createRange();
        range.selectNodeContents(strong);
        const rect = range.getBoundingClientRect();
        textCenter = rect.left + rect.width / 2;
      }

      // Get combined bounding rect of all visible items in participant-meta
      const meta = t.querySelector('.participant-meta');
      let metaContentCenter = null;
      let metaItems = [];
      if (meta) {
        const children = Array.from(meta.children);
        if (children.length > 0) {
          const first = children[0].getBoundingClientRect();
          const last = children[children.length - 1].getBoundingClientRect();
          const left = first.left;
          const right = last.right;
          metaContentCenter = left + (right - left) / 2;
          metaItems = children.map(c => ({
            tag: c.className,
            text: c.textContent?.trim(),
            rect: { left: Math.round(c.getBoundingClientRect().left), width: Math.round(c.getBoundingClientRect().width) }
          }));
        }
      }

      return {
        name: strong?.textContent?.trim(),
        cardCenter: Math.round(cardCenter),
        avatarCenter: avatarCenter ? Math.round(avatarCenter) : null,
        displayNameTextCenter: textCenter ? Math.round(textCenter) : null,
        displayNameDiffFromAvatar: (textCenter && avatarCenter) ? Math.round(textCenter - avatarCenter) : null,
        metaContentCenter: metaContentCenter ? Math.round(metaContentCenter) : null,
        metaContentDiffFromAvatar: (metaContentCenter && avatarCenter) ? Math.round(metaContentCenter - avatarCenter) : null,
        metaItems
      };
    });
  });

  console.log('=== TEXT CENTERING METRICS ===');
  console.log(JSON.stringify(textMetrics, null, 2));

  await browser.close();
}

checkTextCenters().catch(console.error);
