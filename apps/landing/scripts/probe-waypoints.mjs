// Walks every destination body through its orbit and reports where a visible planet or moon cannot be
// clicked. A body counts as visible when its centre is on screen and not behind the planet's disk.
// A point is acceptable when the topmost element there is the body's waypoint, or a real control
// (link, button, summary, input) that rightly wins; anything else is a dead zone.
// Usage: node scripts/probe-waypoints.mjs [baseUrl] [sizes=1440x900,...] [stepSeconds=10] [maxSeconds=400]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5194/';
const sizes = (process.argv[3] ?? '1440x900,1280x720,1024x768,390x844').split(',').map(s => s.split('x').map(Number));
const step = Number(process.argv[4] ?? 10);
const max = Number(process.argv[5] ?? 400);

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let total = 0;
let dead = 0;
let underControl = 0;
const samples = [];
for (const [width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height } });
  for (let t = 0; t <= max; t += step) {
    await page.goto(`${base}?orbit=${t}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.waypoint[style*="translate3d"]').length === 5);
    await page.waitForTimeout(250);
    const result = await page.evaluate(() => {
      const markers = [...document.querySelectorAll('.waypoint')];
      const centre = el => {
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
      };
      const planet = centre(markers[0]);
      const planetR = parseFloat(markers[0].style.getPropertyValue('--ring')) / 2 - 9;
      return markers.map((marker, index) => {
        const c = centre(marker);
        const onScreen = c && c.x >= 4 && c.y >= 4 && c.x <= innerWidth - 4 && c.y <= innerHeight - 4;
        const behind = index > 0 && marker.dataset.depth === 'back' && Math.hypot(c.x - planet.x, c.y - planet.y) < planetR;
        const visible = !!onScreen && !behind;
        const top = visible ? document.elementFromPoint(c.x, c.y) : null;
        const ownTarget = !!top && top.closest('.waypoint') === marker;
        const control = !!top && !!top.closest('a, button, summary, input, [role="button"]') && !ownTarget;
        return {
          name: marker.querySelector('.waypoint-name')?.textContent,
          visible,
          x: c && Math.round(c.x),
          y: c && Math.round(c.y),
          ok: !visible || ownTarget || control,
          coveredByControl: control,
          top: top ? `${top.tagName.toLowerCase()}.${[...top.classList].join('.')}` : null,
          classes: marker.className,
        };
      });
    });
    for (const r of result) {
      if (!r.visible) continue;
      total++;
      if (r.coveredByControl) underControl++;
      if (!r.ok) {
        dead++;
        samples.push({ size: `${width}x${height}`, t, ...r });
      }
    }
  }
  await page.close();
}
await browser.close();
console.log(`visible body samples: ${total}, dead (visible but not clickable): ${dead}, centre under a real control: ${underControl}`);
const byName = {};
for (const s of samples) byName[`${s.size} ${s.name}`] = (byName[`${s.size} ${s.name}`] ?? 0) + 1;
console.log(byName);
console.log(samples.slice(0, 12).map(s => `${s.size} t=${s.t} ${s.name} @${s.x},${s.y} top=${s.top} [${s.classes}]`).join('\n'));
process.exitCode = dead ? 1 : 0;
