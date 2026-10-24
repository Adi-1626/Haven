import { chromium } from 'playwright';

async function measure() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const viewports = [
    { name: '1280x720', width: 1280, height: 720 },
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1920x1080', width: 1920, height: 1080 },
  ];

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.server-rail');
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await page.locator('.channel-row', { hasText: 'Studio Room' }).locator('button').first().click();
    await page.waitForSelector('.voice-room-view');
    await page.waitForTimeout(1000);

    const m = await page.evaluate(() => {
      const view = document.querySelector('.voice-room-view');
      const header = document.querySelector('.call-header');
      const tabs = document.querySelector('.voice-room-tabs');
      const strip = document.querySelector('.room-participants');
      const theater = document.querySelector('.screen-theater-card');
      const dock = document.querySelector('.voice-dock');
      const conversationPanel = document.querySelector('.conversation-panel');
      const topbar = document.querySelector('.topbar');

      return {
        topbarHeight: topbar?.getBoundingClientRect().height,
        conversationPanelHeight: conversationPanel?.clientHeight,
        viewClientHeight: view?.clientHeight,
        viewScrollHeight: view?.scrollHeight,
        viewPadding: view ? window.getComputedStyle(view).padding : null,
        overflowY: view ? window.getComputedStyle(view).overflowY : null,
        isViewScrolling: view ? view.scrollHeight > view.clientHeight : false,
        headerHeight: header?.getBoundingClientRect().height,
        tabsHeight: tabs?.getBoundingClientRect().height,
        stripHeight: strip?.getBoundingClientRect().height,
        streamsHeight: document.querySelector('.room-streams')?.getBoundingClientRect().height,
        callTilesHeight: document.querySelector('.call-tiles')?.getBoundingClientRect().height,
        theaterHeight: theater?.getBoundingClientRect().height,
        theaterWidth: theater?.getBoundingClientRect().width,
        dockHeight: dock?.getBoundingClientRect().height,
      };
    });

    console.log(`\n--- Viewport: ${vp.name} ---`);
    console.log(m);
    await page.close();
  }

  await browser.close();
}

measure().catch(console.error);
