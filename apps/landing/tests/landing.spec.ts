import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const APP_URL = 'https://haven-ea6.pages.dev';
const INSTALLER_URL = 'https://github.com/Adi-1626/Haven/releases/download/v1.0.0/Haven-Setup.exe';
const INSTALLER_SHA256 = '76bb06a6cf3a8fd005bc125a7cebfa87a32ddec956961272b6a72f0eab63dd52';
const WIDTHS = [320, 360, 375, 390, 430, 600, 768, 800, 900, 1024, 1100, 1280, 1366, 1440, 1920, 2560];

async function settle(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A little space.');
}

/** Waits for a travel to finish: the copy is visible again and focus has landed on the destination heading. */
async function arrived(page: Page, headingId: string) {
  await expect(page.locator(`#${headingId}`)).toBeFocused({ timeout: 6000 });
  await expect(page.locator('html')).not.toHaveAttribute('data-travel', /.*/);
}

test('primary actions are honest: hosted app and the published v1.0.0 installer', async ({ page }) => {
  await settle(page);
  const open = page.getByRole('link', { name: /^Open Haven/ });
  expect(await open.count()).toBeGreaterThanOrEqual(3);
  for (const href of await open.evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href))) {
    expect(href).toBe(`${APP_URL}/`);
  }
  const hrefs = await page.locator('a[href]').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href));
  expect(hrefs.filter(href => /localhost|127\.0\.0\.1:(?!4184)/.test(href))).toEqual([]);
  expect([...new Set(hrefs.filter(href => href.endsWith('.exe')))]).toEqual([INSTALLER_URL]);
  await expect(page.getByRole('link', { name: 'Download for Windows' }).first()).toHaveAttribute('href', INSTALLER_URL);
  await expect(page.getByRole('link', { name: 'Download Haven-Setup.exe' })).toHaveAttribute('href', INSTALLER_URL);
  await expect(page.locator('#download')).toContainText('Version 1.0.0');
  await expect(page.locator('#download code')).toContainText(INSTALLER_SHA256.toUpperCase());
  await expect(page.getByRole('link', { name: /All releases on GitHub/ })).toHaveAttribute('href', 'https://github.com/Adi-1626/Haven/releases');
});

test('destinations fly the camera and land focus on the section heading', async ({ page }) => {
  await settle(page);
  await page.getByRole('navigation', { name: 'Explore Haven' }).getByRole('link', { name: /Communities/ }).click();
  await arrived(page, 'communities-title');
  await expect(page).toHaveURL(/#communities$/);
  await expect(page.locator('#communities-title')).toBeInViewport();

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'FAQ' }).click();
  await arrived(page, 'faq-title');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'FAQ' })).toHaveAttribute('aria-current', 'location');

  await page.getByRole('navigation', { name: 'Get Haven' }).getByRole('link', { name: 'Windows app' }).click();
  await expect(page.locator('#download')).toBeFocused({ timeout: 6000 });
  await expect(page).toHaveURL(/#download$/);
});

test('waypoints ride on the scene and stay out of the accessibility tree', async ({ page }) => {
  await settle(page);
  const layer = page.locator('.waypoints');
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  await expect(layer.locator('.waypoint')).toHaveCount(5);
  await page.waitForFunction(() => !!document.documentElement.dataset.cosmosQuality || !!document.querySelector('.cosmos-fallback'));
  const webgl = await page.evaluate(() => !!document.documentElement.dataset.cosmosQuality);
  if (webgl) {
    await expect.poll(() => layer.locator('.waypoint:not(.is-hidden)').count()).toBeGreaterThan(0);
    const moved = await page.evaluate(async () => {
      const marker = document.querySelector<HTMLElement>('.waypoint:not(.is-hidden)')!;
      const before = marker.style.transform;
      await new Promise(resolve => setTimeout(resolve, 1500));
      return before !== marker.style.transform;
    });
    expect(moved).toBe(true);
  }
});

test('one window carries chat, voice and screen sharing', async ({ page }) => {
  await settle(page);
  await page.locator('#product').scrollIntoViewIfNeeded();
  const window = page.locator('.haven-window');
  await page.getByRole('button', { name: /Drop into voice/ }).click();
  await expect(page.getByRole('button', { name: /Drop into voice/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(window.getByRole('list', { name: 'In Lounge' })).toContainText('You');
  const mute = window.getByRole('button', { name: 'Mute microphone' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');

  await window.getByRole('button', { name: 'Share your screen' }).click();
  await expect(window.getByRole('img', { name: /Sample shared screen/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Put your screen up/ })).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: 'Focus' }).click();
  await expect(window.getByRole('button', { name: 'Show people' })).toHaveAttribute('aria-pressed', 'true');

  const composer = window.getByLabel(/Message #general/);
  await composer.fill('see you at nine');
  await composer.press('Enter');
  await expect(window.locator('.hw-message').last()).toContainText('see you at nine');

  const fire = window.getByRole('button', { name: 'fire, 2' });
  await fire.click();
  await expect(window.getByRole('button', { name: 'fire, 3' })).toHaveAttribute('aria-pressed', 'true');

  await window.getByRole('button', { name: 'Leave voice' }).click();
  await expect(page.getByRole('button', { name: /Talk it through/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(window.getByRole('region', { name: 'Voice room' })).toBeHidden();
});

test('push-to-talk is explained, not simulated; diagram and questions respond', async ({ page }) => {
  await settle(page);
  await expect(page.getByText('Microphone closed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Hold to talk/ })).toHaveCount(0);
  await expect(page.getByText(/Your people\. Your place\./i)).toHaveCount(0);
  const shortcuts = page.getByRole('heading', { name: 'Push-to-talk on your key' });
  await expect(shortcuts).toBeAttached();
  await expect(page.locator('.shortcuts')).toContainText('a lone modifier such as Right Ctrl');

  const relayed = page.getByRole('button', { name: 'Relayed', exact: true });
  await relayed.scrollIntoViewIfNeeded();
  await expect(page.locator('.diagram-wrap')).toHaveCSS('opacity', '1');
  await relayed.click();
  await expect(page.getByRole('img', { name: 'Relayed connection' })).toBeVisible();

  const question = page.locator('summary', { hasText: 'Why does Windows warn me' });
  await question.scrollIntoViewIfNeeded();
  await question.click();
  await expect(page.locator('details', { has: question })).toHaveAttribute('open', '');
  await expect(page.getByText('More info', { exact: true })).toBeVisible();
});

test('narrow menu is an accessible modal dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  const trigger = page.getByRole('button', { name: 'Open menu' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Site menu' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close menu' })).toBeFocused();
  await expect(dialog.getByRole('link', { name: /How it works/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole('link', { name: /Communities/ }).click();
  await expect(dialog).toBeHidden();
  await arrived(page, 'communities-title');
});

test('no horizontal overflow at any width', async ({ page }) => {
  await settle(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 700 ? 820 : 900 });
    await page.waitForTimeout(120);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
    const wrapped = await page.evaluate(() => {
      const nav = document.querySelector('.header-nav');
      if (!nav || getComputedStyle(nav).display === 'none') return false;
      const tops = [...nav.querySelectorAll('a')].map(a => a.getBoundingClientRect().top);
      return Math.max(...tops) - Math.min(...tops) > 2;
    });
    expect(wrapped, `header nav wraps at ${width}px`).toBe(false);
  }
});

test('reduced motion keeps everything visible and travels instantly', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await settle(page);
  const infinite = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity && a.playState === 'running').length);
  expect(infinite).toBe(0);
  for (const id of ['product-title', 'communities-title', 'desktop-title', 'how-title', 'faq-title', 'finale-title']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('opacity', '1');
  }
  await page.getByRole('navigation', { name: 'Explore Haven' }).getByRole('link', { name: /How it works/ }).click();
  await expect(page.locator('#how-title')).toBeFocused({ timeout: 1000 });
  await context.close();
});

test('without WebGL the still artwork stands in and navigation still works', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
  });
  const page = await context.newPage();
  await settle(page);
  await expect(page.locator('.cosmos-fallback')).toBeVisible();
  await expect(page.locator('.waypoints')).toBeHidden();
  await page.getByRole('navigation', { name: 'Explore Haven' }).getByRole('link', { name: /Questions/ }).click();
  await expect(page.locator('#faq-title')).toBeFocused();
  await context.close();
});

test('axe finds no violations, and nothing leaves the origin', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4184') && !request.url().startsWith('data:')) external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => message.type() === 'error' && errors.push(message.text()));
  await settle(page);
  // Copy fades in as it arrives; walk the page once so the audit sees it as a visitor would.
  for (let y = 0; y < (await page.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
    await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1300);
  const top = await new AxeBuilder({ page }).analyze();
  expect(top.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);

  await page.locator('#product').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Put your screen up/ }).click();
  await page.locator('summary').first().click();
  await expect(page.locator('.hw-message').last()).toContainText('the fog reads', { timeout: 6000 });
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  const interactive = await new AxeBuilder({ page }).analyze();
  expect(interactive.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  const menu = await new AxeBuilder({ page }).analyze();
  expect(menu.violations.map(v => `${v.id}: ${v.nodes.map(n => `${n.target.join(' ')} ${n.any.map(c => c.message).join(';')}`).join(', ')}`)).toEqual([]);

  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
