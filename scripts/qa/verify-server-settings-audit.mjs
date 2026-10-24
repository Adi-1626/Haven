import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import assert from 'node:assert';

const outputDir = path.resolve('output/server-settings');
fs.mkdirSync(outputDir, { recursive: true });

const artifactDir = path.resolve('C:/Users/adity/.gemini/antigravity-ide/brain/7bae0332-cf92-474d-8b13-452573987a41/screenshots');
fs.mkdirSync(artifactDir, { recursive: true });

async function run() {
  console.log('=== VERIFYING HAVEN ZENITH SERVER SETTINGS FIXES & EDGE CASES ===');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // --------------------------------------------------------------------------
  // TEST 1: Accessibility & Stitch Fidelity at 1920x1080
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Testing Accessibility & Modal Attributes (1920x1080) ---');
  let context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  let page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  // Select a community
  const serverIcon = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  if (await serverIcon.count() > 0) {
    await serverIcon.click();
    await page.waitForTimeout(300);
  }

  // Open Server Settings dialog
  const optionsBtn = page.locator('button[aria-label="Server options"], button[title="Server options"]').first();
  await optionsBtn.click();
  await page.waitForSelector('dialog.zenith-server-settings-modal[open]', { timeout: 5000 });

  // Verification 3: Modal dialog accessible name when hideHeader is true
  const dialog = page.getByRole('dialog', { name: 'Community settings' });
  assert.ok(await dialog.isVisible(), 'Dialog must have accessible name "Community settings" via getByRole');
  const ariaLabel = await dialog.getAttribute('aria-label');
  const ariaLabelledBy = await dialog.getAttribute('aria-labelledby');
  console.log(`✓ Dialog accessibility: aria-label="${ariaLabel}", aria-labelledby=${ariaLabelledBy}`);
  assert.strictEqual(ariaLabel, 'Community settings', 'aria-label must match modal title');
  assert.strictEqual(ariaLabelledBy, null, 'aria-labelledby must be omitted when hideHeader is true');

  // Screenshot Overview tab at 1920x1080
  await page.waitForTimeout(200);
  const shot1920 = path.join(outputDir, '01_server_settings_overview_1920x1080.png');
  await page.screenshot({ path: shot1920 });
  fs.copyFileSync(shot1920, path.join(artifactDir, '01_server_settings_overview_1920x1080.png'));
  console.log('✓ Captured 1920x1080 overview screenshot');

  // Switch to Members tab
  console.log('\n--- 2. Testing Members & Permissions Tab (1280x720) ---');
  await context.close();

  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });

  const sIcon1280 = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  if (await sIcon1280.count() > 0) await sIcon1280.click();
  await page.waitForTimeout(200);

  await page.locator('button[aria-label="Server options"]').first().click();
  await page.waitForSelector('dialog.zenith-server-settings-modal[open]');

  // Click Members tab
  const membersTab = page.locator('.zenith-server-nav-tab', { hasText: 'Members' });
  await membersTab.click();
  await page.waitForSelector('.zenith-members-list', { timeout: 5000 });

  // Add dummy moderation badges (Server muted + Server deafened) to test simultaneous badges
  await page.evaluate(() => {
    const list = document.querySelector('.zenith-members-list');
    if (!list) return;

    // Check if test row already exists
    if (document.getElementById('test-dual-badge-row')) return;

    const testRow = document.createElement('div');
    testRow.id = 'test-dual-badge-row';
    testRow.className = 'permission-row zenith-member-row';
    testRow.innerHTML = `
      <div class="zenith-member-identity">
        <div class="avatar" style="width: 36px; height: 36px; background: #3b4252;">MR</div>
        <div class="zenith-member-names">
          <div class="zenith-member-primary-line">
            <span class="zenith-member-display-name">Marcus Vance</span>
          </div>
          <div class="zenith-member-username">@marcus_vance</div>
        </div>
      </div>
      <div class="zenith-member-controls">
        <div class="zenith-status-pill muted" title="Server muted">
          <span>Server muted</span>
        </div>
        <div class="zenith-status-pill deafened" title="Server deafened">
          <span>Server deafened</span>
        </div>
        <span class="zenith-role-static-pill">Admin</span>
        <button type="button" class="zenith-member-remove-btn" title="Remove Marcus Vance"><span style="font-size:14px">✕</span></button>
      </div>
    `;
    list.prepend(testRow);
  });

  // Verify Stitch fidelity: padding = 14px, gap = 12px
  const rowBox = await page.locator('.zenith-member-row').first();
  const padding = await rowBox.evaluate(el => window.getComputedStyle(el).padding);
  const gap = await rowBox.evaluate(el => window.getComputedStyle(el).gap);
  console.log(`✓ Stitch member row fidelity: computed padding="${padding}", gap="${gap}"`);
  assert.strictEqual(padding, '14px', 'Member row padding must be exactly 14px (Stitch p-3.5)');
  assert.strictEqual(gap, '12px', 'Member row gap must be 12px (Stitch gap-3)');

  const shot1280 = path.join(outputDir, '02_server_settings_members_1280x720.png');
  await page.screenshot({ path: shot1280 });
  fs.copyFileSync(shot1280, path.join(artifactDir, '02_server_settings_members_1280x720.png'));
  console.log('✓ Captured 1280x720 members screenshot with dual moderation badges');

  // --------------------------------------------------------------------------
  // TEST 3: Responsive Reflow at 800x600
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing 800x600 Viewport ---');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(300);

  const shot800 = path.join(outputDir, '03_server_settings_members_800x600.png');
  await page.screenshot({ path: shot800 });
  fs.copyFileSync(shot800, path.join(artifactDir, '03_server_settings_members_800x600.png'));
  console.log('✓ Captured 800x600 members screenshot');

  // --------------------------------------------------------------------------
  // TEST 4: Responsive Reflow & Non-Overlap at 500x550 (Critical Bug 2)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testing 500x550 Viewport (Bug 2 Non-Overlap Verification) ---');
  await page.setViewportSize({ width: 500, height: 550 });
  await page.waitForTimeout(300);

  // Assert that identity and controls do NOT overlap vertically or horizontally
  const overlapCheck = await page.evaluate(() => {
    const row = document.getElementById('test-dual-badge-row');
    if (!row) return null;
    const identity = row.querySelector('.zenith-member-identity');
    const controls = row.querySelector('.zenith-member-controls');
    if (!identity || !controls) return null;

    const idRect = identity.getBoundingClientRect();
    const ctrlRect = controls.getBoundingClientRect();

    // Check vertical overlap: in reflowed column layout, controls must be positioned BELOW identity
    const doesOverlap = !(
      idRect.bottom <= ctrlRect.top ||
      ctrlRect.bottom <= idRect.top ||
      idRect.right <= ctrlRect.left ||
      ctrlRect.right <= idRect.left
    );

    return {
      flexDirection: window.getComputedStyle(row).flexDirection,
      idBottom: idRect.bottom,
      ctrlTop: ctrlRect.top,
      doesOverlap,
    };
  });

  console.log('500x550 reflow metrics:', overlapCheck);
  assert.ok(overlapCheck, 'Test row must be found');
  assert.strictEqual(overlapCheck.flexDirection, 'column', 'Member row must reflow to column at 500x550');
  assert.strictEqual(overlapCheck.doesOverlap, false, 'Identity and controls MUST NOT overlap at 500x550');
  assert.ok(overlapCheck.ctrlTop >= overlapCheck.idBottom - 1, 'Controls must be positioned below identity');
  console.log('✓ Verified: ZERO overlap at 500x550 with both muted and deafened badges');

  // Ensure row is cleanly scrolled into view for screenshot
  await page.evaluate(() => {
    const row = document.getElementById('test-dual-badge-row');
    if (row) {
      row.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  });
  await page.waitForTimeout(200);

  const shot500 = path.join(outputDir, '04_server_settings_members_500x550.png');
  await page.screenshot({ path: shot500 });
  fs.copyFileSync(shot500, path.join(artifactDir, '04_server_settings_members_500x550.png'));
  console.log('✓ Captured 500x550 members screenshot');

  // --------------------------------------------------------------------------
  // TEST 5: Context Menu Escape & Focus (Bug 5)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Testing Context Menu Focus & Escape Key (Bug 5) ---');
  // Reset viewport for desktop context menu test
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Close settings dialog via close button
  await page.locator('.zenith-server-close-btn').click();
  await page.waitForTimeout(300);

  // Right-click on server icon to trigger Context Menu
  const targetServer = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  await targetServer.click({ button: 'right' });
  await page.waitForSelector('.haven-context-menu', { timeout: 3000 });
  console.log('✓ Context menu mounted');

  // Verify context menu is visible and active
  const contextMenu = page.locator('.haven-context-menu');
  assert.ok(await contextMenu.isVisible(), 'Context menu must be visible');

  // Capture screenshot of open context menu
  const shotMenu = path.join(outputDir, '06_context_menu_escape_verified.png');
  await page.screenshot({ path: shotMenu });
  fs.copyFileSync(shotMenu, path.join(artifactDir, '06_context_menu_escape_verified.png'));

  // Press Escape to test reliable closing
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const isMenuStillOpen = (await page.locator('.haven-context-menu').count()) > 0;
  assert.strictEqual(isMenuStillOpen, false, 'Context menu must close immediately and reliably upon pressing Escape');
  console.log('✓ Verified: Escape closes Context Menu reliably after portal mount');

  // --------------------------------------------------------------------------
  // TEST 6: Invitation Permissions for Member Role (Bug 4)
  // --------------------------------------------------------------------------
  const serverTitles = await page.evaluate(() => Array.from(document.querySelectorAll('.server-rail .server-icon')).map(el => el.getAttribute('title')));
  console.log('Available servers in rail:', serverTitles);

  const loungeServer = page.locator('.server-icon[title="Night Owl Lounge"]').first();
  await loungeServer.click();
  await page.waitForTimeout(500);

  // Open Invite Dialog
  await page.locator('button[aria-label="Invite people"], button[title="Invite people"]').first().click();
  await page.waitForSelector('.zenith-invite-modal', { timeout: 5000 });

  // Verify Bug 4: Member restrictions
  const restrictionNotice = page.locator('.zenith-member-restriction-notice');
  assert.ok(await restrictionNotice.isVisible(), 'Member restriction notice must be visible for ordinary members');
  
  const createInviteBtn = page.locator('.zenith-invite-modal button:has-text("Create invitation")');
  assert.strictEqual(await createInviteBtn.count(), 0, 'Ordinary members MUST NOT see "Create invitation" button');

  const expireRow = page.locator('.zenith-invite-modal .zenith-expire-row');
  assert.strictEqual(await expireRow.count(), 0, 'Ordinary members MUST NOT see expiration selector');

  const editPermsBtn = page.locator('.zenith-invite-modal button:has-text("Edit permissions")');
  assert.strictEqual(await editPermsBtn.count(), 0, 'Ordinary members MUST NOT see "Edit permissions" button');

  console.log('✓ Verified: Ordinary member restrictions enforced cleanly (Bug 4)');

  const shotInvite = path.join(outputDir, '05_member_invitation_permissions.png');
  await page.screenshot({ path: shotInvite });
  fs.copyFileSync(shotInvite, path.join(artifactDir, '05_member_invitation_permissions.png'));
  console.log('✓ Captured ordinary member invitation permissions screenshot');

  await page.locator('.zenith-modal-close-btn').first().click();
  await page.waitForTimeout(200);

  await browser.close();
  console.log('\n=== ALL SIX VERIFICATIONS PASSED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
