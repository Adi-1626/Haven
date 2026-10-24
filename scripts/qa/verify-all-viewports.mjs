import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const screenshotDir = path.resolve('docs/screenshots/voice-refinement');
fs.mkdirSync(screenshotDir, { recursive: true });

const artifactScreenshotDir = 'C:\\Users\\adity\\.gemini\\antigravity-ide\\brain\\c9def907-10db-40af-9ac0-6bf2c9c22b72\\screenshots';
fs.mkdirSync(artifactScreenshotDir, { recursive: true });

async function verifyAll() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const viewports = [
    { name: '390x844', width: 390, height: 844, isDesktop: false },
    { name: '500x550', width: 500, height: 550, isDesktop: false },
    { name: '768x1024', width: 768, height: 1024, isDesktop: false },
    { name: '1280x720', width: 1280, height: 720, isDesktop: true },
    { name: '1366x768', width: 1366, height: 768, isDesktop: true },
    { name: '1920x1080', width: 1920, height: 1080, isDesktop: true },
  ];

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail');
  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
  await page.waitForSelector('.voice-room-view');
  await page.waitForTimeout(1000);

  const results = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(600);

    const data = await page.evaluate(() => {
      const view = document.querySelector('.voice-room-view');
      const topbar = document.querySelector('.topbar');
      const theater = document.querySelector('.screen-theater-card');
      const dock = document.querySelector('.voice-dock');
      const participants = Array.from(document.querySelectorAll('.room-participants .person-tile'));
      const video = document.querySelector('.screen-theater-card video');

      const dockRect = dock?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const dockCenter = dockRect ? dockRect.left + dockRect.width / 2 : 0;
      const expectedCenter = viewportWidth / 2;

      // Studio headings inside the page
      const studioHeadings = Array.from(document.querySelectorAll('.voice-room-title strong, .voice-room-view h1, .voice-room-view h2'))
        .map(el => ({ tag: el.tagName, text: el.textContent?.trim() }));

      return {
        viewClientHeight: view?.clientHeight,
        viewScrollHeight: view?.scrollHeight,
        isViewScrolling: view ? view.scrollHeight > view.clientHeight : false,
        participantCount: participants.length,
        participantNames: participants.map(p => p.querySelector('strong')?.childNodes[0]?.textContent?.trim() || p.querySelector('strong')?.textContent?.trim()),
        theaterWidth: theater ? Math.round(theater.getBoundingClientRect().width) : null,
        theaterHeight: theater ? Math.round(theater.getBoundingClientRect().height) : null,
        aspectRatio: (theater && theater.getBoundingClientRect().height) 
          ? (theater.getBoundingClientRect().width / theater.getBoundingClientRect().height).toFixed(2)
          : null,
        dockVisible: !!dock && dockRect.height > 0,
        dockWidth: dockRect ? Math.round(dockRect.width) : 0,
        dockHeight: dockRect ? Math.round(dockRect.height) : 0,
        dockTop: dockRect ? Math.round(dockRect.top) : 0,
        studioHeadings,
        hasLatency18ms: document.body.textContent?.includes('18ms') ?? false,
      };
    });

    const screenshotPath = path.join(screenshotDir, `voice-room-${vp.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const artifactPath = path.join(artifactScreenshotDir, `voice_room_${vp.name}.png`);
    await page.screenshot({ path: artifactPath, fullPage: true });

    results.push({
      viewport: vp.name,
      width: vp.width,
      height: vp.height,
      isDesktop: vp.isDesktop,
      ...data,
      screenshot: screenshotPath,
      artifactScreenshot: artifactPath,
    });

    console.log(`Verified ${vp.name}: isViewScrolling=${data.isViewScrolling} (scroll=${data.viewScrollHeight} vs client=${data.viewClientHeight}), participants=${data.participantCount}, theater=${data.theaterWidth}x${data.theaterHeight} (${data.aspectRatio}), dockVisible=${data.dockVisible}, has18ms=${data.hasLatency18ms}`);
  }

  await browser.close();
  console.log('\n--- Full Summary ---');
  console.log(JSON.stringify(results, null, 2));
}

verifyAll().catch(console.error);
