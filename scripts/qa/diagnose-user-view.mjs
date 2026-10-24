import { chromium } from 'playwright';

async function diagnose() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  // Clean context without any pre-existing localStorage
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('--- 1. Clean load of http://127.0.0.1:5173/ ---');
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(2000);

  const initialUrl = page.url();
  const initialHtml = await page.evaluate(() => {
    return {
      serverRailIcons: Array.from(document.querySelectorAll('.server-rail .server-icon')).map(el => ({
        title: el.getAttribute('title') || el.getAttribute('aria-label') || el.className,
        className: el.className,
      })),
      sidebarHeader: document.querySelector('.sidebar-header')?.textContent || '',
      sectionLabels: Array.from(document.querySelectorAll('.section-label')).map(el => el.textContent),
      channelRows: Array.from(document.querySelectorAll('.channel-row span')).map(el => el.textContent),
      dmRows: Array.from(document.querySelectorAll('.dm-row span')).map(el => el.textContent),
      localStorageServer: localStorage.getItem('haven.server'),
      localStorageSelection: localStorage.getItem('haven.selection'),
    };
  });
  console.log('Initial page state:', JSON.stringify(initialHtml, null, 2));

  await page.screenshot({ path: 'initial_load.png' });
  console.log('Saved initial_load.png');

  await browser.close();
}

diagnose().catch(console.error);
