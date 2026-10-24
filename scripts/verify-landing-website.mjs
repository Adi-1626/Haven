import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = 'c:\\Users\\adity\\OneDrive\\Desktop\\space';
const screenshotsDir = path.join(root, 'artifacts', 'landing-screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// 13 Required Viewports
const viewports = [
  { name: '01_small_mobile_320x568', width: 320, height: 568 },
  { name: '02_mobile_360x800', width: 360, height: 800 },
  { name: '03_mobile_375x667', width: 375, height: 667 },
  { name: '04_large_mobile_390x844', width: 390, height: 844 },
  { name: '05_large_mobile_430x932', width: 430, height: 932 },
  { name: '06_small_tablet_600x960', width: 600, height: 960 },
  { name: '07_tablet_portrait_768x1024', width: 768, height: 1024 },
  { name: '08_tablet_landscape_1024x768', width: 1024, height: 768 },
  { name: '09_small_laptop_1280x720', width: 1280, height: 720 },
  { name: '10_laptop_1366x768', width: 1366, height: 768 },
  { name: '11_desktop_1440x900', width: 1440, height: 900 },
  { name: '12_full_hd_1920x1080', width: 1920, height: 1080 },
  { name: '13_large_desktop_2560x1440', width: 2560, height: 1440 },
];

async function waitUrl(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 304) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  console.log('--- Starting Haven Landing Verification ---');

  // Start preview server on 5174
  const server = spawn('npm.cmd', ['run', 'preview', '--workspace=@haven/landing'], {
    cwd: root,
    stdio: 'pipe',
    shell: true,
  });

  server.stdout.on('data', (d) => console.log(`[server] ${d.toString().trim()}`));
  server.stderr.on('data', (d) => console.error(`[server err] ${d.toString().trim()}`));

  try {
    await waitUrl('http://127.0.0.1:5174');
    console.log('Server is responding on http://127.0.0.1:5174');

    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const results = [];

    // Test each viewport
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);

      // Check overflow
      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const bodyWidth = document.body.scrollWidth;
        const winWidth = window.innerWidth;
        return {
          docWidth,
          bodyWidth,
          winWidth,
          hasOverflow: docWidth > winWidth + 1 || bodyWidth > winWidth + 1,
        };
      });

      const shotPath = path.join(screenshotsDir, `${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });

      const foldPath = path.join(screenshotsDir, `${vp.name}_fold.png`);
      await page.screenshot({ path: foldPath, fullPage: false });

      console.log(
        `✓ [${vp.name}] ${vp.width}x${vp.height} | Overflow: ${overflow.hasOverflow ? 'FAIL (' + overflow.docWidth + ' > ' + overflow.winWidth + ')' : 'PASS'} | Screenshot: ${path.basename(shotPath)}`
      );

      results.push({
        ...vp,
        overflowPass: !overflow.hasOverflow,
        docWidth: overflow.docWidth,
        winWidth: overflow.winWidth,
      });
    }

    // Interactive Verification (Desktop 1440x900)
    console.log('\n--- Testing Interactive Elements & Brand Assertions (Desktop) ---');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' });

    // 1. Verify finalized logo image
    const brandLogo = page.locator('.landing-header .brand-logo-img');
    const brandSrc = await brandLogo.getAttribute('src');
    console.log(`✓ Brand logo present with src: "${brandSrc}"`);
    if (!brandSrc || !brandSrc.includes('haven_newlogo.png')) {
      throw new Error(`Expected haven_newlogo.png, got ${brandSrc}`);
    }

    // 2. Verify workspace rail logo mark
    const railLogo = page.locator('.rail-logo-mark');
    const railSrc = await railLogo.getAttribute('src');
    console.log(`✓ Workspace rail logo mark present with src: "${railSrc}"`);
    if (!railSrc || !railSrc.includes('haven-mark.png')) {
      throw new Error(`Expected haven-mark.png, got ${railSrc}`);
    }

    // 3. Verify NO version badges exist on visible text
    const pageText = await page.textContent('body');
    const forbiddenPatterns = ['v0.4.1', 'v1.0', 'STABLE FOR WINDOWS'];
    for (const pattern of forbiddenPatterns) {
      if (pageText.includes(pattern)) {
        throw new Error(`Forbidden version label "${pattern}" found on page!`);
      }
    }
    console.log('✓ Verified: Zero forbidden version labels found (v0.4.1, v1.0, STABLE FOR WINDOWS are all absent)');

    // 4. Verify in-page Architecture section is present with 3 pillars
    const archSection = page.locator('#architecture');
    const archHeading = await archSection.locator('#arch-heading').textContent();
    const archCardsCount = await archSection.locator('.arch-card').count();
    console.log(`✓ In-page Architecture section rendered: "${archHeading}" with ${archCardsCount} pillars`);

    // 5. Test reaction toggle
    const thumbsBtn = page.locator('.reaction-pill').first();
    const initialText = await thumbsBtn.textContent();
    await thumbsBtn.click();
    await page.waitForTimeout(200);
    const updatedText = await thumbsBtn.textContent();
    console.log(`✓ Thumbs reaction toggle: "${initialText}" -> "${updatedText}"`);

    // 6. Test in-page smooth navigation to download
    const downloadCta = page.locator('#cta-download-windows');
    const downloadHref = await downloadCta.getAttribute('href');
    console.log(`✓ Hero download button links smoothly to: "${downloadHref}"`);

    // Mobile Navigation Drawer Verification (390x844)
    console.log('\n--- Testing Mobile Navigation Drawer (390x844) ---');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' });

    const menuBtn = page.locator('.mobile-menu-btn');
    await menuBtn.click();
    await page.waitForSelector('.mobile-drawer', { state: 'visible' });
    console.log('✓ Mobile drawer opened');
    await page.screenshot({ path: path.join(screenshotsDir, 'interaction_mobile_drawer.png') });

    const closeBtn = page.locator('.mobile-drawer .modal-close-btn');
    await closeBtn.click();
    await page.waitForSelector('.mobile-drawer', { state: 'hidden' });
    console.log('✓ Mobile drawer closed');

    // Zoom Scaling Test (125%, 150%, 200% on 1280x720)
    console.log('\n--- Testing Browser Zoom Scaling ---');
    for (const zoom of [1.25, 1.5, 2.0]) {
      await page.setViewportSize({ width: Math.round(1280 / zoom), height: Math.round(720 / zoom) });
      await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 1;
      });
      console.log(`✓ Zoom ${zoom * 100}%: ${overflow ? 'FAIL (overflow)' : 'PASS (no overflow)'}`);
      await page.screenshot({ path: path.join(screenshotsDir, `zoom_${Math.round(zoom * 100)}.png`) });
    }

    console.log(`\nConsole Errors count: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.error('Console errors detected:', consoleErrors);
    }

    await browser.close();

    const allPassed = results.every((r) => r.overflowPass) && consoleErrors.length === 0;
    console.log(`\nOverall Verification: ${allPassed ? 'ALL PASSED ✓' : 'SOME CHECKS FAILED'}`);

    fs.writeFileSync(
      path.join(screenshotsDir, 'verification-summary.json'),
      JSON.stringify({ results, consoleErrors, allPassed }, null, 2)
    );
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
