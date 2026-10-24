import { test, expect, type Page } from '@playwright/test';

// Destinations in DESTINATIONS order: the planet, then the four moons.
const TARGETS = [
  { name: 'Haven', hash: 'product', heading: 'product-title' },
  { name: 'Communities', hash: 'communities', heading: 'communities-title' },
  { name: 'Windows app', hash: 'desktop', heading: 'desktop-title' },
  { name: 'How it works', hash: 'how-it-works', heading: 'how-title' },
  { name: 'Questions', hash: 'faq', heading: 'faq-title' },
];

interface Probe {
  index: number;
  visible: boolean;
  x: number;
  y: number;
  /** The topmost element at the body's centre is its own waypoint. */
  own: boolean;
  /** A real control sits over the centre and rightly takes the click. */
  control: boolean;
}

/** Waits for the scene to decide (WebGL scene or still fallback) instead of racing the first render. */
async function hasWebGL(page: Page) {
  await page.waitForFunction(() => !!document.documentElement.dataset.cosmosQuality || !!document.querySelector('.cosmos-fallback'));
  return page.evaluate(() => !!document.documentElement.dataset.cosmosQuality);
}

async function load(page: Page, orbit: number) {
  await page.goto(`/?orbit=${orbit}`);
  await page.waitForFunction(() => document.querySelectorAll('.waypoint[style*="translate3d"]').length === 5);
  await page.waitForTimeout(200);
}

/** Reads where each body is drawn right now and what is on top at its centre. */
async function probe(page: Page): Promise<Probe[]> {
  return page.evaluate(() => {
    const markers = [...document.querySelectorAll<HTMLElement>('.waypoint')];
    const at = (el: HTMLElement) => {
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
      return { x: Number(m?.[1]), y: Number(m?.[2]) };
    };
    const planet = at(markers[0]);
    const planetR = parseFloat(markers[0].style.getPropertyValue('--ring')) / 2 - 9;
    return markers.map((marker, index) => {
      const { x, y } = at(marker);
      const onScreen = x >= 4 && y >= 4 && x <= innerWidth - 4 && y <= innerHeight - 4;
      const behind = index > 0 && marker.dataset.depth === 'back' && Math.hypot(x - planet.x, y - planet.y) < planetR;
      const visible = onScreen && !behind;
      const top = visible ? document.elementFromPoint(x, y) : null;
      const own = !!top && top.closest('.waypoint') === marker;
      const control = !!top && !own && !!top.closest('a, button, summary, input');
      return { index, visible, x, y, own, control };
    });
  });
}

async function arrived(page: Page, target: (typeof TARGETS)[number]) {
  await expect(page.locator(`#${target.heading}`)).toBeFocused({ timeout: 6000 });
  await expect(page).toHaveURL(new RegExp(`#${target.hash}$`));
  await expect(page.locator('html')).not.toHaveAttribute('data-travel', /.*/);
}

/** Finds an orbital phase where the body is visible and its own waypoint is on top. */
async function phaseWhereClickable(page: Page, index: number, phases: number[]) {
  for (const orbit of phases) {
    await load(page, orbit);
    const body = (await probe(page))[index];
    if (body.visible && body.own) return orbit;
  }
  return null;
}

/** A real click at wherever the body is at this instant; it keeps orbiting between move and press. */
async function clickBody(page: Page, index: number) {
  const body = (await probe(page))[index];
  await page.mouse.move(body.x, body.y, { steps: 4 });
  const live = (await probe(page))[index];
  await page.mouse.click(live.x, live.y, { delay: 60 });
}

const PHASES = Array.from({ length: 21 }, (_, i) => i * 20);

test.describe('moving planets are selectable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    test.skip(!(await hasWebGL(page)), 'This browser build has no WebGL2, so the still artwork is shown instead.');
  });

  for (const [width, height, scale] of [[1440, 900, 1], [1024, 720, 1.25], [853, 600, 1.5], [640, 450, 2], [390, 844, 3]] as const) {
    test(`every visible body is clickable across its orbit at ${width}x${height} @${scale}x`, async ({ browser }) => {
      // CSS viewport plus device scale reproduces 100–200% browser zoom of a 1280–1440 px window.
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
      const page = await context.newPage();
      let visible = 0;
      const dead: string[] = [];
      for (const orbit of PHASES) {
        await load(page, orbit);
        for (const body of await probe(page)) {
          if (!body.visible) continue;
          visible++;
          if (!body.own && !body.control) dead.push(`${TARGETS[body.index].name} @orbit ${orbit} (${Math.round(body.x)},${Math.round(body.y)})`);
        }
      }
      expect(visible).toBeGreaterThan(PHASES.length * 2);
      expect(dead).toEqual([]);
      await context.close();
    });
  }

  for (const [index, target] of TARGETS.entries()) {
    test(`mouse click on the moving ${target.name} body travels there`, async ({ page }) => {
      const orbit = await phaseWhereClickable(page, index, PHASES);
      expect(orbit, `${target.name} is never clickable in the sampled orbit`).not.toBeNull();
      await clickBody(page, index);
      await arrived(page, target);
    });
  }

  test('labels are part of the target', async ({ page }) => {
    await load(page, 0);
    const label = page.locator('.waypoint:not(.is-hidden):not(.is-quiet) .waypoint-label').first();
    const name = await label.locator('.waypoint-name').textContent();
    const target = TARGETS.find(t => t.name === name)!;
    const box = (await label.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await arrived(page, target);
  });

  test('a body can be picked while the camera is already moving away', async ({ page }) => {
    await load(page, 0);
    // Scroll part-way into the first flight: the scene is mid-transition but the waypoints are still up.
    await page.evaluate(() => window.scrollTo({ top: innerHeight * 0.3, behavior: 'instant' }));
    await page.waitForTimeout(500);
    const presence = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.waypoints')!).getPropertyValue('--waypoint-presence')));
    expect(presence).toBeGreaterThan(0.05);
    expect(presence).toBeLessThan(1);
    const body = (await probe(page)).find(b => b.index > 0 && b.visible && b.own);
    expect(body, 'no moon available mid-transition').toBeTruthy();
    await clickBody(page, body!.index);
    await arrived(page, TARGETS[body!.index]);
  });

  test('rapid repeated clicks settle on the last choice without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const orbit = await phaseWhereClickable(page, 1, PHASES);
    expect(orbit).not.toBeNull();
    const body = (await probe(page))[1];
    await page.mouse.click(body.x, body.y, { clickCount: 3 });
    await arrived(page, TARGETS[1]);

    // Raw clicks on four different destinations within a few milliseconds: the first one wins, the
    // rest land on faded, inert copy, and the page ends in a clean state.
    await page.goto('/');
    const list = page.getByRole('navigation', { name: 'Explore Haven' });
    const points = [];
    for (const name of ['Communities', 'Windows app', 'How it works', 'Questions']) {
      const box = (await list.getByRole('link', { name: new RegExp(name) }).boundingBox())!;
      points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    }
    for (const point of points) await page.mouse.click(point.x, point.y);
    await arrived(page, TARGETS[1]);

    // Two moons clicked back to back: the camera retargets and lands on the second.
    await load(page, 0);
    const bodies = (await probe(page)).filter(b => b.index > 0 && b.visible && b.own);
    if (bodies.length >= 2) {
      await page.mouse.click(bodies[0].x, bodies[0].y);
      await page.mouse.click(bodies[1].x, bodies[1].y);
      const expected = await page.evaluate(() => location.hash.slice(1));
      await arrived(page, TARGETS.find(t => t.hash === expected)!);
    }
    expect(errors).toEqual([]);
  });

  test('keyboard selects planets through the destination list', async ({ page, browserName }) => {
    await page.goto('/');
    const list = page.getByRole('navigation', { name: 'Explore Haven' });
    await list.getByRole('link', { name: /Haven/ }).focus();
    for (const [index, target] of TARGETS.entries()) {
      const link = list.getByRole('link', { name: new RegExp(target.name) });
      // WebKit, like Safari's default setting, leaves links out of the Tab order, so focus each one directly there.
      if (index > 0) await (browserName === 'webkit' ? link.focus() : page.keyboard.press('Tab'));
      await expect(link).toBeFocused();
      await expect(page.locator('.waypoint').nth(index)).toHaveClass(/is-highlighted/);
    }
    await page.keyboard.press('Enter');
    await arrived(page, TARGETS[4]);
  });
});

test.describe('touch', () => {
  // Firefox has touch input but no mobile-device emulation, so it runs the same taps without isMobile.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 });
  test.use({ isMobile: async ({ browserName }, use) => use(browserName !== 'firefox') });

  for (const [index, target] of TARGETS.entries()) {
    test(`tapping the moving ${target.name} body travels there`, async ({ page }) => {
      await page.goto('/');
      test.skip(!(await hasWebGL(page)), 'No WebGL2 in this browser build.');
      const orbit = await phaseWhereClickable(page, index, PHASES);
      expect(orbit, `${target.name} is never tappable in the sampled orbit`).not.toBeNull();
      const body = (await probe(page))[index];
      await page.touchscreen.tap(body.x, body.y);
      await arrived(page, target);
    });
  }
});

test('reduced motion: still bodies are clickable', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/');
  test.skip(!(await hasWebGL(page)), 'No WebGL2 in this browser build.');
  const orbit = await phaseWhereClickable(page, 2, PHASES);
  expect(orbit).not.toBeNull();
  const first = (await probe(page))[2];
  await page.waitForTimeout(600);
  const second = (await probe(page))[2];
  expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeLessThan(0.5);
  await page.mouse.click(second.x, second.y);
  await arrived(page, TARGETS[2]);
  await context.close();
});
