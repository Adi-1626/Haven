import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const outDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/c9def907-10db-40af-9ac0-6bf2c9c22b72/screenshots';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function run() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const viewports = [
    { name: 'friends_1920x1080', width: 1920, height: 1080, tab: 'online' },
    { name: 'friends_1280x720', width: 1280, height: 720, tab: 'online' },
    { name: 'friends_1366x768', width: 1366, height: 768, tab: 'online' },
    { name: 'friends_768x1024', width: 768, height: 1024, tab: 'online' },
    { name: 'friends_500x550', width: 500, height: 550, tab: 'online' },
    { name: 'friends_390x844', width: 390, height: 844, tab: 'online' },
    { name: 'friends_pending_1280x720', width: 1280, height: 720, tab: 'pending' },
    { name: 'friends_blocked_500x550', width: 500, height: 550, tab: 'blocked' },
  ];

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.friends-page');
    await page.waitForTimeout(500);

    // Switch to desired tab
    if (vp.tab === 'online') {
      await page.getByRole('button', { name: 'Online', exact: true }).click();
    } else if (vp.tab === 'pending') {
      await page.getByRole('button', { name: /Pending/ }).click();
    } else if (vp.tab === 'blocked') {
      await page.getByRole('button', { name: 'Blocked', exact: true }).click();
    }

    await page.waitForTimeout(300);
    const dest = path.join(outDir, `${vp.name}.png`);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`Saved screenshot: ${vp.name}.png`);
    await page.close();
  }

  // Capture Add Friend modal
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.friends-page');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Add friend', exact: true }).click();
    await page.waitForSelector('.add-friend-dialog');
    await page.waitForTimeout(400);
    const dest = path.join(outDir, 'add_friend_modal.png');
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`Saved screenshot: add_friend_modal.png`);
    await page.close();
  }

  // Capture Group conversation modal
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.friends-page');
    await page.waitForTimeout(300);
    // Click '+' icon in DIRECT MESSAGES header
    const addGroupBtn = page.locator('.dm-label button, button[aria-label="New group message"], button[title="New group message"]').first();
    if (await addGroupBtn.isVisible()) {
      await addGroupBtn.click();
      await page.waitForSelector('.friend-picker');
      await page.waitForTimeout(400);
      const dest = path.join(outDir, 'group_conversation_modal.png');
      await page.screenshot({ path: dest, fullPage: false });
      console.log(`Saved screenshot: group_conversation_modal.png`);
    }
    await page.close();
  }

  await browser.close();
  console.log('All screenshots captured successfully.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
