import { test, expect, type Page } from '@playwright/test';

async function ensureMemberSidebar(page: Page) {
  const sidebar = page.locator('.member-sidebar');
  if (!(await sidebar.isVisible())) {
    const toggleBtn = page.locator('button[aria-label="Toggle member list"]');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await expect(sidebar).toBeVisible();
    }
  }
}

test.describe('Haven Zenith Minimal Dialogs & Voice Context Actions', () => {
  test.beforeEach(async ({ page }) => {
    // Fail immediately if ANY native browser dialog is triggered
    page.on('dialog', dialog => {
      throw new Error(`UNEXPECTED NATIVE DIALOG TRIGGERED: [${dialog.type()}] "${dialog.message()}"`);
    });
  });

  test('1. Voice context menu: Marcus Vance (disconnected) hides "Disconnect from voice", Elena (connected) shows it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible({ timeout: 15_000 });

    // Zenith Design Lab
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await expect(page.locator('.server-name')).toContainText('Zenith Design Lab');

    // Go to text channel #design-tokens
    await page.locator('.channel-row button', { hasText: 'design-tokens' }).click();

    // Ensure member sidebar is visible
    await ensureMemberSidebar(page);
    const memberSidebar = page.locator('.member-sidebar');
    await expect(memberSidebar).toBeVisible();

    // Find Marcus Vance in member sidebar and right-click
    const marcusRow = memberSidebar.locator('.member-row', { hasText: 'Marcus Vance' });
    await expect(marcusRow).toBeVisible();
    await marcusRow.click({ button: 'right' });

    // Zenith context menu should appear
    const contextMenu = page.locator('.zenith-context-menu');
    await expect(contextMenu).toBeVisible();

    // Verify Marcus Vance does NOT have "Disconnect from voice" because he is not connected to voice!
    await expect(contextMenu.locator('[role="menuitem"]', { hasText: 'Disconnect from voice' })).toHaveCount(0);

    // Verify moderation items that are valid DO exist (Server mute, Server deafen, Remove from community)
    await expect(contextMenu.locator('[role="menuitem"]', { hasText: 'Server mute' })).toBeVisible();
    await expect(contextMenu.locator('[role="menuitem"]', { hasText: 'Server deafen' })).toBeVisible();
    await expect(contextMenu.locator('[role="menuitem"]', { hasText: 'Remove from community' })).toBeVisible();

    // Close menu by pressing Escape
    await page.keyboard.press('Escape');
    await expect(contextMenu).not.toBeVisible();

    // Now find Elena Rostova (who is connected in Studio Room) and right click
    const elenaRow = memberSidebar.locator('.member-row', { hasText: 'Elena Rostova' });
    await expect(elenaRow).toBeVisible();
    await elenaRow.click({ button: 'right' });

    await expect(contextMenu).toBeVisible();
    // Elena IS in voice, so as owner, Alex can see "Disconnect from voice"
    await expect(contextMenu.locator('[role="menuitem"]', { hasText: 'Disconnect from voice' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(contextMenu).not.toBeVisible();
  });

  test('2. Message deletion: hover trash button triggers Zenith Minimal ConfirmDialog with zero native popups', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await page.locator('.channel-row button', { hasText: 'design-tokens' }).click();

    // Send a unique test message
    const msgText = `Ephemeral test message for Zenith dialog ${Date.now()}`;
    const composerInput = page.locator('.composer textarea');
    await composerInput.fill(msgText);
    await composerInput.press('Enter');

    // Locate the newly created message row
    const messageRow = page.locator('.message', { hasText: msgText });
    await expect(messageRow).toBeVisible();

    // Hover over message to reveal actions
    await messageRow.hover();
    const deleteButton = messageRow.locator('button[aria-label="Delete message"]');
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Zenith Minimal ConfirmDialog should open
    const dialog = page.locator('dialog.zenith-dialog-modal[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.zenith-dialog-title')).toHaveText('Delete message');
    await expect(dialog.locator('.zenith-dialog-body')).toContainText('Are you sure you want to delete this message?');

    // Test Cancel / Escape dismissal: message must NOT be deleted
    await dialog.locator('button', { hasText: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(messageRow).toBeVisible();

    // Re-open dialog and confirm deletion
    await messageRow.hover();
    await deleteButton.click();
    await expect(dialog).toBeVisible();

    const confirmBtn = dialog.locator('button.zenith-dialog-btn-danger', { hasText: 'Delete message' });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Dialog closes and message is deleted
    await expect(dialog).not.toBeVisible();
    await expect(messageRow).toHaveCount(0);
  });

  test('3. Context menu message deletion: keyboard Shift+F10 triggers Zenith ConfirmDialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await page.locator('.channel-row button', { hasText: 'design-tokens' }).click();

    // Send message
    const msgText = `Keyboard context menu delete test ${Date.now()}`;
    const composerInput = page.locator('.composer textarea');
    await composerInput.fill(msgText);
    await composerInput.press('Enter');

    const messageRow = page.locator('.message', { hasText: msgText });
    await expect(messageRow).toBeVisible();

    // Trigger context menu via keyboard accessibility (Shift+F10)
    await messageRow.focus();
    await messageRow.press('Shift+F10');

    const contextMenu = page.locator('.zenith-context-menu');
    await expect(contextMenu).toBeVisible();

    // Click "Delete message" in context menu
    const deleteItem = contextMenu.locator('[role="menuitem"]', { hasText: 'Delete message' });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    // Zenith ConfirmDialog appears
    const dialog = page.locator('dialog.zenith-dialog-modal[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.zenith-dialog-title')).toHaveText('Delete message');

    // Escape closes without deletion
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(messageRow).toBeVisible();

    // Open again and confirm deletion
    await messageRow.focus();
    await messageRow.press('Shift+F10');
    await expect(contextMenu).toBeVisible();
    await contextMenu.locator('[role="menuitem"]', { hasText: 'Delete message' }).click();
    await expect(dialog).toBeVisible();
    await dialog.locator('button.zenith-dialog-btn-danger').click();
    await expect(messageRow).toHaveCount(0);
  });

  test('4. User context menu: "Remove from community" triggers Zenith ConfirmDialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await page.locator('.channel-row button', { hasText: 'design-tokens' }).click();

    await ensureMemberSidebar(page);
    const memberSidebar = page.locator('.member-sidebar');
    const elenaRow = memberSidebar.locator('.member-row', { hasText: 'Elena Rostova' });
    await elenaRow.click({ button: 'right' });

    const contextMenu = page.locator('.zenith-context-menu');
    await expect(contextMenu).toBeVisible();

    // Click "Remove from community"
    await contextMenu.locator('[role="menuitem"]', { hasText: 'Remove from community' }).click();

    // Zenith ConfirmDialog opens
    const dialog = page.locator('dialog.zenith-dialog-modal[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.zenith-dialog-title')).toHaveText('Remove from community');
    await expect(dialog.locator('.zenith-dialog-body')).toContainText('Remove Elena Rostova from Zenith Design Lab?');

    // Dismiss with Cancel
    await dialog.locator('button', { hasText: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('5. Channel modal: "Delete channel" triggers Zenith ConfirmDialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();

    await page.locator('.server-icon[title="Zenith Design Lab"]').click();

    // Find the edit button on channel #feedback
    const feedbackChannelRow = page.locator('.channel-row', { hasText: 'feedback' });
    await expect(feedbackChannelRow).toBeVisible();
    const editBtn = feedbackChannelRow.locator('button.channel-edit');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Channel modal opens
    const channelModal = page.locator('.zenith-channel-modal');
    await expect(channelModal).toBeVisible();

    // Click "Delete channel" inside channel modal
    const deleteChannelBtn = channelModal.locator('button.zenith-btn-danger-outline', { hasText: 'Delete channel' });
    await expect(deleteChannelBtn).toBeVisible();
    await deleteChannelBtn.click();

    // Zenith ConfirmDialog opens
    const dialog = page.locator('dialog.zenith-dialog-modal[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.zenith-dialog-title')).toHaveText('Delete channel');
    await expect(dialog.locator('.zenith-dialog-body')).toContainText('Are you sure you want to delete #feedback');

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await channelModal.locator('button[aria-label="Close dialog"]').click();
  });

  test('6. Responsive viewports: 1920×1080, 1280×720, 800×600, 500×550 without horizontal overflow or clipped dialogs', async ({ page }) => {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 800, height: 600 },
      { width: 500, height: 550 },
    ];

    // Load app once at standard size
    await page.goto('/');
    await expect(page.locator('.server-rail')).toBeVisible();
    await page.locator('.server-icon[title="Zenith Design Lab"]').click();
    await page.locator('.channel-row button', { hasText: 'design-tokens' }).click();

    // Send a message to delete across viewports
    const msgText = `Responsive viewport test message ${Date.now()}`;
    const composerInput = page.locator('.composer textarea');
    await expect(composerInput).toBeVisible();
    await composerInput.fill(msgText);
    await composerInput.press('Enter');

    const messageRow = page.locator('.message', { hasText: msgText });
    await expect(messageRow).toBeVisible();

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Trigger delete dialog on the message
      await messageRow.hover();
      const delBtn = messageRow.locator('button[aria-label="Delete message"]');
      await expect(delBtn).toBeVisible();
      await delBtn.click();

      const dialog = page.locator('dialog.zenith-dialog-modal[open]');
      await expect(dialog).toBeVisible();

      // Verify dialog fits within viewport
      const boundingBox = await dialog.boundingBox();
      expect(boundingBox).not.toBeNull();
      if (boundingBox) {
        expect(boundingBox.width).toBeLessThanOrEqual(vp.width);
        expect(boundingBox.height).toBeLessThanOrEqual(vp.height);
        expect(boundingBox.x).toBeGreaterThanOrEqual(0);
        expect(boundingBox.y).toBeGreaterThanOrEqual(0);
      }

      // Check no horizontal scrollbar was introduced to the document
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);

      // Dismiss dialog
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });
});
