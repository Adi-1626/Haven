// Visual capture of the landing page in real Chrome with GPU WebGL.
// Usage: node scripts/capture.mjs [baseUrl] [outDir] [widths=1440x900,...] [--stations] [--travel]
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const base = args[0] ?? 'http://127.0.0.1:5174/';
const out = path.resolve(args[1] ?? '../../output/landing-premium-20261024/screenshots');
const sizes = (args[2] ?? '1440x900').split(',').map(s => s.split('x').map(Number));
const stations = ['top', 'product', 'communities', 'desktop', 'how-it-works', 'faq', 'home'];
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: flags.has('--nogl') ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const log = [];
for (const [width, height] of sizes) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: flags.has('--reduced') ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  page.on('console', msg => msg.type() === 'error' && log.push(`[${width}] console: ${msg.text()}`));
  page.on('pageerror', err => log.push(`[${width}] pageerror: ${err.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  const quality = await page.evaluate(() => document.documentElement.dataset.cosmosQuality ?? 'none');
  log.push(`[${width}x${height}] quality=${quality} scrollHeight=${await page.evaluate(() => document.documentElement.scrollHeight)}`);
  const tag = `${width}x${height}${flags.has('--reduced') ? '-reduced' : ''}${flags.has('--nogl') ? '-nogl' : ''}`;
  if (flags.has('--stations')) {
    for (const id of stations) {
      await page.evaluate(sid => {
        const el = document.getElementById(sid);
        const top = sid === 'top' ? 0 : el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.min(top, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' });
      }, id);
      await page.waitForTimeout(1900);
      await page.screenshot({ path: path.join(out, `${tag}-${id}.png`) });
    }
  } else {
    await page.screenshot({ path: path.join(out, `${tag}-top.png`) });
  }
  if (flags.has('--travel')) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(1500);
    await page.locator('.hero-index a').nth(1).click();
    for (const t of [250, 700, 1100, 1600, 2300]) {
      await page.waitForTimeout(t - (t > 250 ? [250, 700, 1100, 1600, 2300][[250, 700, 1100, 1600, 2300].indexOf(t) - 1] : 0));
      await page.screenshot({ path: path.join(out, `${tag}-travel-${t}.png`) });
    }
  }
  if (flags.has('--demo')) {
    await page.evaluate(() => window.scrollTo({ top: document.getElementById('product').offsetTop + 120, behavior: 'instant' }));
    await page.waitForTimeout(1600);
    const steps = page.locator('.scene-step');
    await steps.nth(1).click();
    await page.waitForTimeout(2600);
    await page.locator('.product-stage').screenshot({ path: path.join(out, `${tag}-demo-voice.png`) });
    await steps.nth(2).click();
    await page.waitForTimeout(3600);
    await page.locator('.product-stage').screenshot({ path: path.join(out, `${tag}-demo-share.png`) });
    await steps.nth(0).click();
    await page.waitForTimeout(800);
    await page.locator('.product-stage').screenshot({ path: path.join(out, `${tag}-demo-chat.png`) });
  }
  // --at=<selector>: viewport shot with that element just below the header (e.g. --at=.desktop-more).
  for (const flag of flags) {
    if (!flag.startsWith('--at=')) continue;
    const selector = flag.slice(5);
    await page.evaluate(sel => {
      const el = document.querySelector(sel);
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: 'instant' });
    }, selector);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(out, `${tag}-at-${selector.replace(/[^a-z0-9]+/gi, '')}.png`) });
  }
  if (flags.has('--full')) await page.screenshot({ path: path.join(out, `${tag}-full.png`), fullPage: true });
  await context.close();
}
await browser.close();
console.log(log.join('\n'));
