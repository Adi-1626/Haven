import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('artifacts/alignment-verification');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { width: 1920, height: 1080, name: '1920x1080' },
  { width: 1280, height: 720, name: '1280x720' },
  { width: 800, height: 600, name: '800x600' },
  { width: 500, height: 550, name: '500x550' },
];

const COUNTS = [1, 2, 4, 6, 8];

async function measureCards(page) {
  return await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.person-tile'));
    return tiles.map(t => {
      const cardRect = t.getBoundingClientRect();
      const cardCenter = cardRect.left + cardRect.width / 2;

      const avatar = t.querySelector('.avatar');
      const avatarRect = avatar ? avatar.getBoundingClientRect() : null;
      const avatarCenter = avatarRect ? avatarRect.left + avatarRect.width / 2 : null;

      const strong = t.querySelector('strong');
      let textCenter = null;
      let textWidth = null;
      if (strong) {
        const range = document.createRange();
        range.selectNodeContents(strong);
        const rect = range.getBoundingClientRect();
        textCenter = rect.left + rect.width / 2;
        textWidth = rect.width;
      }

      const meta = t.querySelector('.participant-meta');
      let metaCenter = null;
      let metaWidth = null;
      let metaChildren = [];
      if (meta) {
        const children = Array.from(meta.children).filter(c => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (children.length > 0) {
          const first = children[0].getBoundingClientRect();
          const last = children[children.length - 1].getBoundingClientRect();
          const left = first.left;
          const right = last.right;
          metaCenter = left + (right - left) / 2;
          metaWidth = right - left;
          metaChildren = children.map(c => ({
            cls: c.className,
            text: c.textContent?.trim(),
            width: Math.round(c.getBoundingClientRect().width)
          }));
        }
      }

      const moreBtn = t.querySelector('.participant-more');
      const moreRect = moreBtn ? moreBtn.getBoundingClientRect() : null;

      return {
        name: strong?.textContent?.trim(),
        cardRect: { left: Math.round(cardRect.left), width: Math.round(cardRect.width), top: Math.round(cardRect.top), height: Math.round(cardRect.height) },
        avatarCenter: avatarCenter ? Math.round(avatarCenter * 10) / 10 : null,
        cardCenter: Math.round(cardCenter * 10) / 10,
        textCenter: textCenter ? Math.round(textCenter * 10) / 10 : null,
        textWidth: textWidth ? Math.round(textWidth) : null,
        metaCenter: metaCenter ? Math.round(metaCenter * 10) / 10 : null,
        metaWidth: metaWidth ? Math.round(metaWidth) : null,
        metaChildren,
        moreAtTopRight: Boolean(
          moreRect &&
          moreRect.right <= cardRect.right + 2 &&
          moreRect.right >= cardRect.right - 24 &&
          moreRect.top >= cardRect.top - 2 &&
          moreRect.top <= cardRect.top + 20
        ),
        diffAvatarToCard: (avatarCenter && cardCenter) ? Math.abs(Math.round((avatarCenter - cardCenter) * 10) / 10) : null,
        diffTextToAvatar: (textCenter && avatarCenter) ? Math.abs(Math.round((textCenter - avatarCenter) * 10) / 10) : null,
        diffMetaToAvatar: (metaCenter && avatarCenter) ? Math.abs(Math.round((metaCenter - avatarCenter) * 10) / 10) : null,
      };
    });
  });
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let totalFailures = 0;
  let totalTests = 0;

  console.log('=== STARTING HAVEN PARTICIPANT ALIGNMENT MATRIX VERIFICATION ===\n');

  for (const vp of VIEWPORTS) {
    for (const count of COUNTS) {
      for (const layout of ['grid', 'strip']) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        try {
          await page.goto(`http://127.0.0.1:5173/?count=${count}`);
          await page.waitForSelector('.server-rail', { timeout: 8000 });
          await page.locator('.server-icon[title="Zenith Design Lab"]').click();
          await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
          await page.waitForSelector('.voice-room-view', { timeout: 8000 });
          await page.waitForTimeout(400);

          if (layout === 'strip') {
            // Click Watch Stream or Share Screen
            const watchBtn = page.locator('.stream-watch-btn').first();
            if (await watchBtn.isVisible()) {
              await watchBtn.click();
            } else {
              const shareBtn = page.locator('button[title*="Share screen"], button:has-text("Share screen")').first();
              if (await shareBtn.isVisible()) {
                await shareBtn.click();
              }
            }
            await page.waitForTimeout(500);
          }

          const metrics = await measureCards(page);
          const screenshotName = `${vp.name}_count${count}_${layout}.png`;
          await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName) });

          let scenarioPassed = true;
          const errors = [];

          for (const card of metrics) {
            totalTests++;
            // Check avatar centered in card: tolerance 1.0px (fractional pixel rounding in subgrid)
            if (card.diffAvatarToCard === null || card.diffAvatarToCard > 1.0) {
              errors.push(`Avatar off center in card for "${card.name}": diff=${card.diffAvatarToCard}px`);
              scenarioPassed = false;
            }
            // Check display name text centered beneath avatar: tolerance 1.0px
            if (card.diffTextToAvatar === null || card.diffTextToAvatar > 1.0) {
              errors.push(`Display name off center beneath avatar for "${card.name}": diff=${card.diffTextToAvatar}px`);
              scenarioPassed = false;
            }
            // Check meta row centered beneath avatar: tolerance 1.5px (due to odd/even integer icon width + text width)
            if (card.diffMetaToAvatar === null || card.diffMetaToAvatar > 1.5) {
              errors.push(`Meta off center beneath avatar for "${card.name}": diff=${card.diffMetaToAvatar}px`);
              scenarioPassed = false;
            }
            // Check three dot button top right
            if (!card.moreAtTopRight) {
              errors.push(`More button not at top right for "${card.name}"`);
              scenarioPassed = false;
            }
          }

          if (scenarioPassed) {
            console.log(`✅ PASS: Viewport ${vp.name} | Count ${count} | Layout: ${layout} (${metrics.length} cards checked)`);
          } else {
            totalFailures++;
            console.log(`❌ FAIL: Viewport ${vp.name} | Count ${count} | Layout: ${layout}`);
            errors.forEach(e => console.log(`   - ${e}`));
            metrics.forEach(c => console.log(`   card: ${c.name} | cardCenter:${c.cardCenter} | avatarCenter:${c.avatarCenter} | textCenter:${c.textCenter} | metaCenter:${c.metaCenter}`));
          }
        } catch (err) {
          totalFailures++;
          console.error(`💥 ERROR during ${vp.name} count ${count} ${layout}:`, err.message);
        } finally {
          await page.close();
        }
      }
    }
  }

  await browser.close();

  console.log('\n=== MATRIX VERIFICATION SUMMARY ===');
  console.log(`Total card checks: ${totalTests}`);
  console.log(`Total scenario failures: ${totalFailures}`);
  if (totalFailures === 0) {
    console.log('🎉 ALL MATRIX CHECKS PASSED PERFECTLY!');
  } else {
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
