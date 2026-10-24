import { chromium } from 'playwright';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const outputDir = path.resolve('output/settings-dedup');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const artifactDir = 'C:/Users/adity/.gemini/antigravity-ide/brain/7bae0332-cf92-474d-8b13-452573987a41/screenshots';
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

async function run() {
  console.log('=== VERIFYING HAVEN SETTINGS GEAR REMOVAL & SINGLE SETTINGS ENTRY ===');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // 1. Load web app in dev:ui mode
  console.log('Navigating to http://127.0.0.1:5173...');
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForSelector('.app', { timeout: 10000 });

  // Ensure server rail and user panel are visible
  await page.waitForSelector('.server-rail', { timeout: 5000 });
  await page.waitForSelector('.user-panel', { timeout: 5000 });

  // --------------------------------------------------------------------------
  // TEST 1: Verify Server Rail has NO Settings gear and NO spacer
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Testing Far-Left Server Rail ---');
  const railSettingsIcons = await page.locator('.server-rail [aria-label="Settings"], .server-rail [title="Settings"]').count();
  console.log(`Settings icons in server rail: ${railSettingsIcons}`);
  assert.strictEqual(railSettingsIcons, 0, 'Server rail MUST NOT contain any Settings buttons');

  const railSpacers = await page.locator('.server-rail .rail-spacer').count();
  console.log(`Spacers in server rail: ${railSpacers}`);
  assert.strictEqual(railSpacers, 0, 'Server rail MUST NOT contain any rail-spacer');

  const railSmallIcons = await page.locator('.server-rail .server-icon.small').count();
  console.log(`Small server icons in rail: ${railSmallIcons}`);
  assert.strictEqual(railSmallIcons, 0, 'Server rail MUST NOT contain small orphaned icon buttons');

  // Verify alignment: last element in rail is join-server
  const lastRailButtonClass = await page.locator('.server-rail > :last-child').getAttribute('class');
  console.log(`Last element class in server rail: "${lastRailButtonClass}"`);
  assert.ok(lastRailButtonClass?.includes('join-server'), 'Last button in server rail should be join-server button');

  // --------------------------------------------------------------------------
  // TEST 2: Verify User Panel HAS single Settings gear beside Alex Mercer
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing User Panel Settings Button ---');
  const userPanelSettings = page.locator('.user-panel .user-settings');
  assert.strictEqual(await userPanelSettings.count(), 1, 'User panel MUST have exactly one Settings button');
  assert.ok(await userPanelSettings.isVisible(), 'User panel Settings button MUST be visible');

  const titleAttr = await userPanelSettings.getAttribute('title');
  const ariaAttr = await userPanelSettings.getAttribute('aria-label');
  console.log(`User panel settings title: "${titleAttr}", aria-label: "${ariaAttr}"`);
  assert.strictEqual(titleAttr, 'Settings');
  assert.strictEqual(ariaAttr, 'Settings');

  // Capture desktop screenshot (1280x720)
  const shotDesktop = path.join(outputDir, 'settings_dedup_desktop_1280x720.png');
  await page.screenshot({ path: shotDesktop });
  fs.copyFileSync(shotDesktop, path.join(artifactDir, 'settings_dedup_desktop_1280x720.png'));
  console.log('✓ Captured desktop screenshot (1280x720)');

  // --------------------------------------------------------------------------
  // TEST 3: Verify Settings Gear Opens Settings Dialog
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing Settings Dialog Activation ---');
  await userPanelSettings.click();
  await page.waitForSelector('dialog.modal', { timeout: 5000 });
  const settingsModal = page.locator('dialog.modal');
  assert.ok(await settingsModal.isVisible(), 'Settings modal must be visible after clicking Settings');

  const modalTitle = await settingsModal.locator('h2').first().textContent();
  console.log(`Settings modal title: "${modalTitle}"`);
  assert.ok(modalTitle?.toLowerCase().includes('settings'), 'Modal should display user settings');

  // Capture settings dialog open screenshot
  const shotModal = path.join(outputDir, 'settings_dialog_open_1280x720.png');
  await page.screenshot({ path: shotModal });
  fs.copyFileSync(shotModal, path.join(artifactDir, 'settings_dialog_open_1280x720.png'));
  console.log('✓ Captured settings dialog open screenshot');

  // Close Settings dialog
  const closeBtn = settingsModal.locator('button[aria-label="Close dialog"]').first();
  await closeBtn.click();
  await page.waitForSelector('dialog.modal', { state: 'detached', timeout: 5000 });
  console.log('✓ Settings dialog closed cleanly');

  // --------------------------------------------------------------------------
  // TEST 4: Compact Electron Window Size (500x550)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testing Compact Electron Window Size (500x550) ---');
  await page.setViewportSize({ width: 500, height: 550 });
  await page.waitForTimeout(300);

  // In compact window, open mobile navigation to view server rail and user panel
  const mobileMenuBtn = page.locator('.mobile-menu-button');
  if (await mobileMenuBtn.isVisible()) {
    console.log('Opening mobile nav scrim...');
    await mobileMenuBtn.click();
    await page.waitForTimeout(300);
  }

  // Check that server rail and user panel remain properly aligned
  const compactRailSettings = await page.locator('.server-rail [aria-label="Settings"]').count();
  assert.strictEqual(compactRailSettings, 0, 'No Settings in rail at 500x550');

  const compactUserPanelSettings = page.locator('.user-panel .user-settings');
  assert.ok(await compactUserPanelSettings.isVisible(), 'User panel settings button is visible in mobile nav');

  const shotCompact = path.join(outputDir, 'settings_dedup_compact_500x550.png');
  await page.screenshot({ path: shotCompact });
  fs.copyFileSync(shotCompact, path.join(artifactDir, 'settings_dedup_compact_500x550.png'));
  console.log('✓ Captured compact Electron screenshot (500x550)');

  // --------------------------------------------------------------------------
  // TEST 5: Intermediate Window Size (800x600)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Testing Intermediate Window Size (800x600) ---');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(300);

  const shot800 = path.join(outputDir, 'settings_dedup_window_800x600.png');
  await page.screenshot({ path: shot800 });
  fs.copyFileSync(shot800, path.join(artifactDir, 'settings_dedup_window_800x600.png'));
  console.log('✓ Captured 800x600 screenshot');

  await browser.close();
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
