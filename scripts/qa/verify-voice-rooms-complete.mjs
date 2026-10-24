import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/c9def907-10db-40af-9ac0-6bf2c9c22b72/voice-scenarios';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const viewports = [
  { name: '1920x1080', width: 1920, height: 1080, type: 'desktop' },
  { name: '1366x768', width: 1366, height: 768, type: 'desktop' },
  { name: '1280x720', width: 1280, height: 720, type: 'desktop' },
  { name: '768x1024', width: 768, height: 1024, type: 'tablet' },
  { name: '500x550', width: 500, height: 550, type: 'compact' },
  { name: '390x844', width: 390, height: 844, type: 'mobile' },
];

async function measureLayout(page, isDesktop) {
  return await page.evaluate((isDesktop) => {
    const voiceView = document.querySelector('.voice-room-view');
    const theaterCard = document.querySelector('.screen-theater-card, .remote-screen');
    const video = document.querySelector('.screen-theater-card video, .room-streams video');
    const tiles = document.querySelectorAll('.person-tile');
    const grid = document.querySelector('.room-participants.grid-mode');
    const strip = document.querySelector('.room-participants.participant-strip');
    const dock = document.querySelector('.voice-dock');

    const result = {
      tileCount: tiles.length,
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      voiceViewScrollsVertically: voiceView ? voiceView.scrollHeight > voiceView.clientHeight + 2 : false,
      voiceViewScrollHeight: voiceView?.scrollHeight,
      voiceViewClientHeight: voiceView?.clientHeight,
      dockVisible: !!dock && dock.offsetParent !== null,
    };

    if (theaterCard) {
      const rect = theaterCard.getBoundingClientRect();
      result.theaterWidth = Math.round(rect.width);
      result.theaterHeight = Math.round(rect.height);
      result.theaterRatio = (rect.width / (rect.height || 1)).toFixed(2);
    }

    if (video) {
      const rect = video.getBoundingClientRect();
      result.videoRenderedWidth = Math.round(rect.width);
      result.videoRenderedHeight = Math.round(rect.height);
      result.videoIntrinsicWidth = video.videoWidth;
      result.videoIntrinsicHeight = video.videoHeight;
      result.videoIntrinsicRatio = video.videoHeight ? (video.videoWidth / video.videoHeight).toFixed(2) : 'N/A';
      result.videoObjectFit = window.getComputedStyle(video).objectFit;
    }

    if (grid) {
      const style = window.getComputedStyle(grid);
      result.gridColumns = style.gridTemplateColumns;
    }

    return result;
  }, isDesktop);
}

async function run() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const results = {
    studioRoom: {},
    designLounge: {},
    singleParticipant: {},
    portraitStream: {},
  };

  try {
    // ══════════════════════════════════════════════════════════════
    // SCENARIO 1: STUDIO ROOM (6 PARTICIPANTS, 1 SCREEN SHARING)
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- SCENARIO 1: Studio Room (6 participants, 1 screen sharing) ---');
    {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto('http://127.0.0.1:5173/');
      await page.waitForSelector('.server-rail', { timeout: 10000 });

      await page.locator('.server-icon[title="Zenith Design Lab"]').click();
      await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
      await page.waitForSelector('.voice-room-view', { timeout: 10000 });

      const memberToggle = page.locator('.topbar-tools .icon-button[title="Toggle member list"]');
      if (await memberToggle.isVisible()) {
        const hasOn = await memberToggle.evaluate(el => el.classList.contains('is-on'));
        if (hasOn) await memberToggle.click();
      }

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(500);

        const metrics = await measureLayout(page, vp.type === 'desktop');
        results.studioRoom[vp.name] = metrics;

        const screenshotFile = `scenario1_studio_${vp.name}.png`;
        await page.screenshot({ path: path.join(outDir, screenshotFile) });
        console.log(`[Studio Room ${vp.name}] Tiles: ${metrics.tileCount}, Stream Theater: ${metrics.theaterWidth}x${metrics.theaterHeight} (Ratio: ${metrics.theaterRatio}), Video intrinsic: ${metrics.videoIntrinsicWidth}x${metrics.videoIntrinsicHeight} (${metrics.videoIntrinsicRatio}), V-Scroll: ${metrics.voiceViewScrollsVertically}, H-Overflow: ${metrics.hasHorizontalOverflow}`);
      }
      await page.close();
    }

    // ══════════════════════════════════════════════════════════════
    // SCENARIO 2: DESIGN LOUNGE (6 PARTICIPANTS, NO SCREEN SHARING)
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- SCENARIO 2: Design Lounge (6 participants, 0 screen sharing) ---');
    {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto('http://127.0.0.1:5173/');
      await page.waitForSelector('.server-rail', { timeout: 10000 });

      await page.locator('.server-icon[title="Zenith Design Lab"]').click();
      await page.locator('.channel-row', { hasText: 'Design Lounge' }).locator('button').first().click();
      await page.waitForSelector('.voice-room-view', { timeout: 10000 });

      const memberToggle = page.locator('.topbar-tools .icon-button[title="Toggle member list"]');
      if (await memberToggle.isVisible()) {
        const hasOn = await memberToggle.evaluate(el => el.classList.contains('is-on'));
        if (hasOn) await memberToggle.click();
      }

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(500);

        const metrics = await measureLayout(page, vp.type === 'desktop');
        results.designLounge[vp.name] = metrics;

        const screenshotFile = `scenario2_lounge_6p_${vp.name}.png`;
        await page.screenshot({ path: path.join(outDir, screenshotFile) });
        console.log(`[Design Lounge 6p ${vp.name}] Tiles: ${metrics.tileCount}, Grid columns: ${metrics.gridColumns}, V-Scroll: ${metrics.voiceViewScrollsVertically}, H-Overflow: ${metrics.hasHorizontalOverflow}`);
      }
      await page.close();
    }

    // ══════════════════════════════════════════════════════════════
    // SCENARIO 3: SINGLE PARTICIPANT (DESIGN LOUNGE SOLO)
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- SCENARIO 3: Single Participant (Design Lounge solo) ---');
    {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto('http://127.0.0.1:5173/?scenario=single');
      await page.waitForSelector('.server-rail', { timeout: 10000 });

      await page.locator('.server-icon[title="Zenith Design Lab"]').click();
      await page.locator('.channel-row', { hasText: 'Design Lounge' }).locator('button').first().click();
      await page.waitForSelector('.voice-room-view', { timeout: 10000 });

      const memberToggle = page.locator('.topbar-tools .icon-button[title="Toggle member list"]');
      if (await memberToggle.isVisible()) {
        const hasOn = await memberToggle.evaluate(el => el.classList.contains('is-on'));
        if (hasOn) await memberToggle.click();
      }

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(500);

        const metrics = await measureLayout(page, vp.type === 'desktop');
        results.singleParticipant[vp.name] = metrics;

        const screenshotFile = `scenario3_single_1p_${vp.name}.png`;
        await page.screenshot({ path: path.join(outDir, screenshotFile) });
        console.log(`[Design Lounge 1p ${vp.name}] Tiles: ${metrics.tileCount}, V-Scroll: ${metrics.voiceViewScrollsVertically}, H-Overflow: ${metrics.hasHorizontalOverflow}`);
      }
      await page.close();
    }

    // ══════════════════════════════════════════════════════════════
    // BONUS: PORTRAIT SCREEN SHARE VERIFICATION (9:16 MOBILE STREAM)
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- BONUS: Portrait Mobile Screen Share (9:16) ---');
    {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto('http://127.0.0.1:5173/?stream=portrait');
      await page.waitForSelector('.server-rail', { timeout: 10000 });

      await page.locator('.server-icon[title="Zenith Design Lab"]').click();
      await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
      await page.waitForSelector('.voice-room-view', { timeout: 10000 });

      const memberToggle = page.locator('.topbar-tools .icon-button[title="Toggle member list"]');
      if (await memberToggle.isVisible()) {
        const hasOn = await memberToggle.evaluate(el => el.classList.contains('is-on'));
        if (hasOn) await memberToggle.click();
      }

      for (const vp of [viewports[0], viewports[3], viewports[5]]) { // 1920x1080, 768x1024, 390x844
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(500);

        const metrics = await measureLayout(page, vp.type === 'desktop');
        results.portraitStream[vp.name] = metrics;

        const screenshotFile = `portrait_stream_${vp.name}.png`;
        await page.screenshot({ path: path.join(outDir, screenshotFile) });
        console.log(`[Portrait Stream ${vp.name}] Video intrinsic: ${metrics.videoIntrinsicWidth}x${metrics.videoIntrinsicHeight} (${metrics.videoIntrinsicRatio}), Rendered: ${metrics.videoRenderedWidth}x${metrics.videoRenderedHeight}, Object-Fit: ${metrics.videoObjectFit}`);
      }
      await page.close();
    }

    // Write summary JSON
    fs.writeFileSync(path.join(outDir, 'verification-results.json'), JSON.stringify(results, null, 2));
    console.log('\nSaved all verification results to verification-results.json');

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
