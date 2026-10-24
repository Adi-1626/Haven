import { chromium } from 'playwright';

async function diagnose() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view', { timeout: 10000 });

  const data = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.person-tile'));
    return tiles.map(tile => {
      const cardRect = tile.getBoundingClientRect();
      const avatar = tile.querySelector('.avatar-button, .avatar');
      const avatarRect = avatar?.getBoundingClientRect();
      const strong = tile.querySelector('strong');
      const strongRect = strong?.getBoundingClientRect();
      const meta = tile.querySelector('.participant-meta');
      const metaRect = meta?.getBoundingClientRect();
      const handle = tile.querySelector('.participant-handle');
      const handleRect = handle?.getBoundingClientRect();
      const state = tile.querySelector('.participant-state');
      const stateRect = state?.getBoundingClientRect();
      const more = tile.querySelector('.participant-more');
      const moreRect = more?.getBoundingClientRect();
      const details = tile.querySelector('.participant-details');
      const detailsStyle = details ? window.getComputedStyle(details) : null;
      const tileStyle = window.getComputedStyle(tile);
      const metaStyle = meta ? window.getComputedStyle(meta) : null;

      const cardCenter = cardRect.left + cardRect.width / 2;
      const avatarCenter = avatarRect ? avatarRect.left + avatarRect.width / 2 : null;
      const strongCenter = strongRect ? strongRect.left + strongRect.width / 2 : null;
      const metaCenter = metaRect ? metaRect.left + metaRect.width / 2 : null;

      return {
        name: strong?.textContent?.trim(),
        tileClass: tile.className,
        parentClass: tile.parentElement?.className,
        tileFlexDir: tileStyle.flexDirection,
        tileAlignItems: tileStyle.alignItems,
        tileJustifyContent: tileStyle.justifyContent,
        tileTextAlign: tileStyle.textAlign,
        detailsTextAlign: detailsStyle?.textAlign,
        metaJustifyContent: metaStyle?.justifyContent,
        cardWidth: cardRect.width,
        cardCenter: Math.round(cardCenter),
        avatarCenter: avatarCenter ? Math.round(avatarCenter) : null,
        avatarDiffFromCard: avatarCenter ? Math.round(avatarCenter - cardCenter) : null,
        strongCenter: strongCenter ? Math.round(strongCenter) : null,
        strongDiffFromCard: strongCenter ? Math.round(strongCenter - cardCenter) : null,
        metaCenter: metaCenter ? Math.round(metaCenter) : null,
        metaDiffFromCard: metaCenter ? Math.round(metaCenter - cardCenter) : null,
        moreRect: moreRect ? { left: Math.round(moreRect.left - cardRect.left), top: Math.round(moreRect.top - cardRect.top), position: window.getComputedStyle(more).position } : null,
      };
    });
  });

  console.log('=== STUDIO ROOM (STREAM SHARING / FOCUS) ===');
  console.log(JSON.stringify(data, null, 2));

  // Now switch to Grid mode if available
  const focusBtn = page.locator('button.voice-action-btn', { hasText: 'Focus' });
  if (await focusBtn.isVisible()) {
    await focusBtn.click();
    await page.waitForTimeout(400);

    const gridData = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.person-tile'));
      return tiles.map(tile => {
        const cardRect = tile.getBoundingClientRect();
        const avatar = tile.querySelector('.avatar-button, .avatar');
        const avatarRect = avatar?.getBoundingClientRect();
        const strong = tile.querySelector('strong');
        const strongRect = strong?.getBoundingClientRect();
        const meta = tile.querySelector('.participant-meta');
        const metaRect = meta?.getBoundingClientRect();
        const more = tile.querySelector('.participant-more');
        const moreRect = more?.getBoundingClientRect();
        const details = tile.querySelector('.participant-details');
        const detailsStyle = details ? window.getComputedStyle(details) : null;
        const tileStyle = window.getComputedStyle(tile);
        const metaStyle = meta ? window.getComputedStyle(meta) : null;

        const cardCenter = cardRect.left + cardRect.width / 2;
        const avatarCenter = avatarRect ? avatarRect.left + avatarRect.width / 2 : null;
        const strongCenter = strongRect ? strongRect.left + strongRect.width / 2 : null;
        const metaCenter = metaRect ? metaRect.left + metaRect.width / 2 : null;

        return {
          name: strong?.textContent?.trim(),
          tileClass: tile.className,
          parentClass: tile.parentElement?.className,
          tileFlexDir: tileStyle.flexDirection,
          cardWidth: Math.round(cardRect.width),
          cardCenter: Math.round(cardCenter),
          avatarCenter: avatarCenter ? Math.round(avatarCenter) : null,
          avatarDiffFromCard: avatarCenter ? Math.round(avatarCenter - cardCenter) : null,
          strongCenter: strongCenter ? Math.round(strongCenter) : null,
          strongDiffFromCard: strongCenter ? Math.round(strongCenter - cardCenter) : null,
          metaCenter: metaCenter ? Math.round(metaCenter) : null,
          metaDiffFromCard: metaCenter ? Math.round(metaCenter - cardCenter) : null,
          detailsTextAlign: detailsStyle?.textAlign,
          metaJustifyContent: metaStyle?.justifyContent,
          moreRect: moreRect ? { left: Math.round(moreRect.left - cardRect.left), top: Math.round(moreRect.top - cardRect.top), position: window.getComputedStyle(more).position } : null,
        };
      });
    });

    console.log('=== STUDIO ROOM (GRID MODE) ===');
    console.log(JSON.stringify(gridData, null, 2));
  }

  // Also check Design Lounge (pure grid mode, 6 participants)
  await page.locator('.channel-row', { hasText: 'Design Lounge' }).locator('button').first().click();
  await page.waitForTimeout(600);

  const loungeData = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.person-tile'));
    return tiles.map(tile => {
      const cardRect = tile.getBoundingClientRect();
      const avatar = tile.querySelector('.avatar-button, .avatar');
      const avatarRect = avatar?.getBoundingClientRect();
      const strong = tile.querySelector('strong');
      const strongRect = strong?.getBoundingClientRect();
      const meta = tile.querySelector('.participant-meta');
      const metaRect = meta?.getBoundingClientRect();
      const more = tile.querySelector('.participant-more');
      const moreRect = more?.getBoundingClientRect();
      const details = tile.querySelector('.participant-details');
      const detailsStyle = details ? window.getComputedStyle(details) : null;
      const tileStyle = window.getComputedStyle(tile);
      const metaStyle = meta ? window.getComputedStyle(meta) : null;

      const cardCenter = cardRect.left + cardRect.width / 2;
      const avatarCenter = avatarRect ? avatarRect.left + avatarRect.width / 2 : null;
      const strongCenter = strongRect ? strongRect.left + strongRect.width / 2 : null;
      const metaCenter = metaRect ? metaRect.left + metaRect.width / 2 : null;

      return {
        name: strong?.textContent?.trim(),
        tileClass: tile.className,
        parentClass: tile.parentElement?.className,
        cardWidth: Math.round(cardRect.width),
        cardCenter: Math.round(cardCenter),
        avatarCenter: avatarCenter ? Math.round(avatarCenter) : null,
        avatarDiffFromCard: avatarCenter ? Math.round(avatarCenter - cardCenter) : null,
        strongCenter: strongCenter ? Math.round(strongCenter) : null,
        strongDiffFromCard: strongCenter ? Math.round(strongCenter - cardCenter) : null,
        metaCenter: metaCenter ? Math.round(metaCenter) : null,
        metaDiffFromCard: metaCenter ? Math.round(metaCenter - cardCenter) : null,
        detailsTextAlign: detailsStyle?.textAlign,
        metaJustifyContent: metaStyle?.justifyContent,
      };
    });
  });

  console.log('=== DESIGN LOUNGE (GRID MODE 6 PARTICIPANTS) ===');
  console.log(JSON.stringify(loungeData, null, 2));

  await browser.close();
}

diagnose().catch(err => {
  console.error(err);
  process.exit(1);
});
