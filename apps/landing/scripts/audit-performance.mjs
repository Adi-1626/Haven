// Resource and main-thread audit of the built site in real Chrome with GPU WebGL.
// Usage: node scripts/audit-performance.mjs [baseUrl] — serve dist first (npm run preview).
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:4184/';
const out = path.resolve('../../output/landing-premium-20261024');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const requests = [];
page.on('response', async response => {
  const headers = await response.allHeaders();
  requests.push({ url: response.url().replace(base, '/'), status: response.status(), bytes: Number(headers['content-length'] ?? 0) || (await response.body().catch(() => Buffer.alloc(0))).length });
});
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const window = async (label, action, ms) => {
  const before = await metrics();
  const frames = page.evaluate(duration => new Promise(resolve => {
    let count = 0;
    const start = performance.now();
    const tick = () => (performance.now() - start < duration ? (count++, requestAnimationFrame(tick)) : resolve(count));
    requestAnimationFrame(tick);
  }), ms);
  await action();
  const rafs = await frames;
  const after = await metrics();
  const seconds = ms / 1000;
  return {
    label,
    seconds,
    mainThreadBusyPct: +(((after.TaskDuration - before.TaskDuration) / seconds) * 100).toFixed(1),
    scriptPct: +(((after.ScriptDuration - before.ScriptDuration) / seconds) * 100).toFixed(1),
    displayRafPerSecond: +(rafs / seconds).toFixed(1),
    jsHeapMB: +(after.JSHeapUsedSize / 1048576).toFixed(1),
    nodes: after.Nodes,
  };
};

const results = [];
results.push(await window('hero idle (30 fps cadence after 2.5 s)', () => page.waitForTimeout(6000), 6000));
results.push(await window('scrolling through the tour', async () => {
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(200);
  }
}, 6000));
results.push(await window('click-to-travel flight', async () => {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);
  await page.locator('.hero-index a').nth(3).click();
  await page.waitForTimeout(3000);
}, 3500));
const quality = await page.evaluate(() => document.documentElement.dataset.cosmosQuality);

const total = requests.reduce((sum, r) => sum + r.bytes, 0);
const report = { base, quality, transferredKB: +(total / 1024).toFixed(1), requests, windows: results, external: requests.filter(r => !r.url.startsWith('/')).map(r => r.url) };
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ quality, transferredKB: report.transferredKB, requestCount: requests.length, external: report.external, windows: results }, null, 2));
await browser.close();
