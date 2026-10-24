import { test, expect } from '@playwright/test';
import { registerLocal } from './local-auth';

// 1x1 transparent PNG
const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe('F05: Original image opening and tab suppression', () => {
  test('public image: single click, double-click (150ms), rapid clicks, deliberate later clicks and opener isolation', async ({ page, context }) => {
    const username = `f05_pub_${Date.now()}`;
    await registerLocal(page, username);

    const publicImageUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500';
    const patchRes = await page.request.patch('/api/users/me', {
      data: { avatar: publicImageUrl, bio: 'F05 public test' },
    });
    expect(patchRes.ok()).toBe(true);

    await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
    await page.getByLabel('SERVER NAME').fill('F05 Public Server');
    await page.getByRole('button', { name: 'Create server', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to #general' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('F05 public message');
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
    await expect(page.locator('.message-text', { hasText: 'F05 public message' })).toBeVisible();

    const authorBtn = page.locator('.message-heading button').filter({ hasText: username }).first();
    await authorBtn.click();
    const profileCardModal = page.locator('dialog.modal:has(.enhanced-profile)');
    await expect(profileCardModal).toBeVisible();

    const avatarPicBtn = page.locator('.profile-picture-button:not([disabled])');
    await expect(avatarPicBtn).toBeVisible();
    await avatarPicBtn.click();

    const imageViewerModal = page.locator('dialog.modal:has(.profile-image-viewer)');
    await expect(imageViewerModal).toBeVisible();

    const openOriginalLink = imageViewerModal.locator('a.open-original-link');
    await expect(openOriginalLink).toBeVisible();
    await expect(openOriginalLink).toHaveAttribute('rel', 'noreferrer noopener');

    expect(context.pages().length).toBe(1);

    // 1. Single click: exactly 1 new tab
    const [page1] = await Promise.all([
      context.waitForEvent('page'),
      openOriginalLink.click(),
    ]);
    expect(context.pages().length).toBe(2);
    expect(await page1.evaluate(() => window.opener)).toBeNull();
    await page1.close();
    expect(context.pages().length).toBe(1);

    await page.waitForTimeout(700);

    // 2. Normal double-click with 150ms separation: exactly 1 new tab
    const pagePromise2 = context.waitForEvent('page');
    await openOriginalLink.click();
    await page.waitForTimeout(150);
    await openOriginalLink.click();

    const page2 = await pagePromise2;
    await page.waitForTimeout(400);
    expect(context.pages().length).toBe(2);
    expect(await page2.evaluate(() => window.opener)).toBeNull();
    await page2.close();
    expect(context.pages().length).toBe(1);

    await page.waitForTimeout(700);

    // 3. Rapid repeated clicks (4 clicks in 200ms): exactly 1 new tab
    const pagePromise3 = context.waitForEvent('page');
    await openOriginalLink.click();
    await page.waitForTimeout(50);
    await openOriginalLink.click();
    await page.waitForTimeout(50);
    await openOriginalLink.click();
    await page.waitForTimeout(50);
    await openOriginalLink.click();

    const page3 = await pagePromise3;
    await page.waitForTimeout(400);
    expect(context.pages().length).toBe(2);
    await page3.close();
    expect(context.pages().length).toBe(1);

    // 4. Later deliberate click after suppression window (800ms later)
    await page.waitForTimeout(800);
    const [page4] = await Promise.all([
      context.waitForEvent('page'),
      openOriginalLink.click(),
    ]);
    expect(context.pages().length).toBe(2);
    expect(await page4.evaluate(() => window.opener)).toBeNull();
    await page4.close();
    expect(context.pages().length).toBe(1);
  });

  test('protected hosted image: authenticated bearer fetch, blob isolation, double-click suppression and opener protection', async ({ page, context }) => {
    const username = `f05_prot_${Date.now()}`;
    await registerLocal(page, username);

    // Upload an actual avatar to create an internal protected /api/users/:id/avatar resource
    const uploadRes = await page.request.post('/api/users/me/avatar', {
      multipart: {
        file: {
          name: 'avatar.png',
          mimeType: 'image/png',
          buffer: samplePng,
        },
      },
    });
    const uploaded = await uploadRes.json();
    const avatarUrl = uploaded.user?.avatar || uploaded.avatar;
    expect(avatarUrl).toMatch(/^\/api\/users\/[A-Za-z0-9-]+\/avatar\?v=/);

    await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
    await page.getByLabel('SERVER NAME').fill('F05 Protected Server');
    await page.getByRole('button', { name: 'Create server', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to #general' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('F05 protected message');
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
    await expect(page.locator('.message-text', { hasText: 'F05 protected message' })).toBeVisible();

    const authorBtn = page.locator('.message-heading button').filter({ hasText: username }).first();
    await authorBtn.click();
    const profileCardModal = page.locator('dialog.modal:has(.enhanced-profile)');
    await expect(profileCardModal).toBeVisible();

    const avatarPicBtn = page.locator('.profile-picture-button:not([disabled])');
    await expect(avatarPicBtn).toBeVisible();
    await avatarPicBtn.click();

    const imageViewerModal = page.locator('dialog.modal:has(.profile-image-viewer)');
    await expect(imageViewerModal).toBeVisible();

    const openOriginalLink = imageViewerModal.locator('a.open-original-link');
    await expect(openOriginalLink).toBeVisible();
    await expect(openOriginalLink).toHaveAttribute('rel', 'noreferrer noopener');

    expect(context.pages().length).toBe(1);

    // 1. Single click: opens 1 tab, URL is safe (blob or API url without tokens), opener is null
    const [protPage1] = await Promise.all([
      context.waitForEvent('page'),
      openOriginalLink.click(),
    ]);
    expect(context.pages().length).toBe(2);
    const openedUrl1 = protPage1.url();
    expect(openedUrl1.includes('token=')).toBe(false);
    expect(openedUrl1.includes('Bearer')).toBe(false);
    expect(await protPage1.evaluate(() => window.opener)).toBeNull();
    await protPage1.close();
    expect(context.pages().length).toBe(1);

    await page.waitForTimeout(700);

    // 2. Normal double-click on protected image: exactly 1 new tab
    const protPromise2 = context.waitForEvent('page');
    await openOriginalLink.click();
    await page.waitForTimeout(150);
    await openOriginalLink.click();

    const protPage2 = await protPromise2;
    await page.waitForTimeout(400);
    expect(context.pages().length).toBe(2);
    expect(await protPage2.evaluate(() => window.opener)).toBeNull();
    await protPage2.close();
    expect(context.pages().length).toBe(1);

    await page.waitForTimeout(700);

    // 3. Rapid repeated clicks (4 clicks in 200ms) on protected image: exactly 1 new tab
    const protPromise3 = context.waitForEvent('page');
    await openOriginalLink.click();
    await page.waitForTimeout(50);
    await openOriginalLink.click();
    await page.waitForTimeout(50);
    await openOriginalLink.click();
    await page.waitForTimeout(50);
    await openOriginalLink.click();

    const protPage3 = await protPromise3;
    await page.waitForTimeout(400);
    expect(context.pages().length).toBe(2);
    await protPage3.close();
    expect(context.pages().length).toBe(1);

    // 4. Later deliberate click after suppression window (800ms later)
    await page.waitForTimeout(800);
    const [protPage4] = await Promise.all([
      context.waitForEvent('page'),
      openOriginalLink.click(),
    ]);
    expect(context.pages().length).toBe(2);
    expect(await protPage4.evaluate(() => window.opener)).toBeNull();
    await protPage4.close();
    expect(context.pages().length).toBe(1);
  });
});
