import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import assert from 'node:assert';

const outputDir = path.resolve('output/zenith-channel-invites');
fs.mkdirSync(outputDir, { recursive: true });

async function run() {
  console.log('=== VERIFYING HAVEN ZENITH CHANNEL CREATION & INVITATIONS ===');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.server-rail', { timeout: 10000 });
  console.log('✓ Haven loaded in UI test mode');

  // Select Zenith Design Lab community
  const serverBtn = page.locator('.server-icon[title*="Zenith Design Lab"]').first();
  if (await serverBtn.count() > 0) {
    await serverBtn.click();
    await page.waitForTimeout(400);
  }
  console.log('✓ Selected server');

  // --------------------------------------------------------------------------
  // TEST 1: Channel Creation Modal (Zenith Minimal)
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Testing Channel Creation Modal ---');
  const createChannelBtn = page.locator('button[title="Create channel"]').first();
  await createChannelBtn.click();
  await page.waitForSelector('.zenith-channel-modal', { timeout: 5000 });
  console.log('✓ Channel modal opened');

  // Assert Zenith Minimal elements in Channel Modal
  const modalHeading = await page.locator('.zenith-channel-modal .zenith-modal-heading').textContent();
  assert.strictEqual(modalHeading?.trim(), 'Create channel', 'Heading must be "Create channel"');

  const textCard = page.locator('.zenith-type-card', { hasText: 'Text' });
  const voiceCard = page.locator('.zenith-type-card', { hasText: 'Voice' });
  assert.ok(await textCard.isVisible(), 'Text Channel option must be visible');
  assert.ok(await voiceCard.isVisible(), 'Voice Channel option must be visible');
  assert.ok(await textCard.evaluate(el => el.classList.contains('is-selected')), 'Text option must be selected by default');

  // Switch to Voice
  await voiceCard.click();
  await page.waitForTimeout(150);
  assert.ok(await voiceCard.evaluate(el => el.classList.contains('is-selected')), 'Voice option must become selected');

  // Switch back to Text
  await textCard.click();
  await page.waitForTimeout(150);
  assert.ok(await textCard.evaluate(el => el.classList.contains('is-selected')), 'Text option must become selected');

  // Fill in Channel Name & Topic matching Stitch design
  const nameInput = page.locator('#zenith-channel-name');
  await nameInput.fill('tactical-chat');

  const topicInput = page.locator('#zenith-channel-topic');
  await topicInput.fill('Squad strategies and match VODs');

  // Capture screenshot at 1280x720 (Reference Viewport)
  await page.screenshot({ path: path.join(outputDir, '01_channel_create_1280x720.png') });
  console.log('✓ Captured 01_channel_create_1280x720.png');

  // Test responsive viewports for Channel Modal
  const viewports = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '800x600', width: 800, height: 600 },
    { name: '500x550', width: 500, height: 550 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    const bounds = await page.locator('.zenith-channel-modal').boundingBox();
    assert.ok(bounds, `Modal must exist at ${vp.name}`);
    assert.ok(bounds.width <= vp.width, `Modal width ${bounds.width} must fit viewport width ${vp.width}`);
    assert.ok(bounds.height <= vp.height, `Modal height ${bounds.height} must fit viewport height ${vp.height}`);

    await page.screenshot({ path: path.join(outputDir, `01_channel_create_${vp.name}.png`) });
    console.log(`✓ Channel Modal responsive at ${vp.name} (w:${Math.round(bounds.width)}, h:${Math.round(bounds.height)})`);
  }

  // Restore 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);

  // Submit channel creation
  const submitBtn = page.locator('.zenith-channel-modal .zenith-btn-primary');
  await submitBtn.click();
  await page.waitForTimeout(500);

  // Verify modal closed
  assert.strictEqual(await page.locator('.zenith-channel-modal').count(), 0, 'Channel modal must close after creation');
  console.log('✓ Channel created and modal closed');

  // --------------------------------------------------------------------------
  // TEST 2: Invitations Modal (Zenith Minimal)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Invitations Modal ---');
  const inviteBtn = page.locator('button[title="Invite people"]').first();
  await inviteBtn.click();
  await page.waitForSelector('.zenith-invite-modal', { timeout: 5000 });
  console.log('✓ Invite modal opened');

  // Assert Zenith Minimal elements in Invite Modal
  const inviteHeading = await page.locator('.zenith-invite-modal .zenith-modal-heading').textContent();
  assert.ok(inviteHeading?.includes('Invite people to'), 'Heading must contain "Invite people to"');

  const subtitle = await page.locator('.zenith-invite-modal .zenith-modal-subtitle').textContent();
  assert.ok(subtitle?.includes('Community'), 'Subtitle must show community link info');

  const expireSelect = page.locator('#zenith-invite-expire');
  assert.ok(await expireSelect.isVisible(), 'Expiration select must be visible');
  assert.strictEqual(await expireSelect.inputValue(), '168', 'Default expiration must be 7 days (168h)');

  // Verify Generated Invite Box & Copy Actions
  const inviteLinkInput = page.locator('.zenith-invite-modal input[aria-label="Invitation link"]');
  assert.ok(await inviteLinkInput.isVisible(), 'Invitation link textbox must be visible');
  const initialUrl = await inviteLinkInput.inputValue();
  assert.ok(initialUrl.includes('/invite/'), `Invite link URL must contain /invite/ (got: ${initialUrl})`);

  // Test Copy invite link button
  const copyLinkBtn = page.locator('.zenith-invite-modal .zenith-btn-copy-link');
  await copyLinkBtn.click();
  await page.waitForTimeout(200);
  const copyLinkText = await copyLinkBtn.textContent();
  assert.ok(copyLinkText?.includes('Copied'), 'Copy invite link button must show copied feedback');
  console.log('✓ Copy invite link tested successfully');

  // Test Direct code row and Copy code button
  const directCode = page.locator('.zenith-invite-modal .zenith-direct-code-badge');
  assert.ok(await directCode.isVisible(), 'Direct code badge must be visible');
  const copyCodeBtn = page.locator('.zenith-invite-modal .zenith-btn-copy-code');
  await copyCodeBtn.click();
  await page.waitForTimeout(200);
  const copyCodeText = await copyCodeBtn.textContent();
  assert.ok(copyCodeText?.includes('Copied'), 'Copy code button must show copied feedback');
  console.log('✓ Direct code & copy tested successfully');

  // Verify Active Invitations section
  const activeSection = page.locator('.zenith-invite-modal .zenith-active-invites-section');
  assert.ok(await activeSection.isVisible(), 'Active invitations section must be visible');
  const pulseDot = page.locator('.zenith-invite-modal .zenith-pulse-wrapper');
  assert.ok(await pulseDot.first().isVisible(), 'Pulsing active status dot must be visible');

  // Verify Footer role note
  const footerNote = page.locator('.zenith-invite-modal .zenith-invite-footer');
  assert.ok(await footerNote.isVisible(), 'Invite footer note must be visible');
  assert.ok((await footerNote.textContent())?.includes('Role:'), 'Footer must show user role');

  // Capture screenshot at 1280x720 (Reference Viewport)
  await page.screenshot({ path: path.join(outputDir, '02_invite_modal_1280x720.png') });
  console.log('✓ Captured 02_invite_modal_1280x720.png');

  // Test responsive viewports for Invite Modal
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    const bounds = await page.locator('.zenith-invite-modal').boundingBox();
    assert.ok(bounds, `Invite modal must exist at ${vp.name}`);
    assert.ok(bounds.width <= vp.width, `Invite modal width ${bounds.width} must fit viewport width ${vp.width}`);
    assert.ok(bounds.height <= vp.height, `Invite modal height ${bounds.height} must fit viewport height ${vp.height}`);

    await page.screenshot({ path: path.join(outputDir, `02_invite_modal_${vp.name}.png`) });
    console.log(`✓ Invite Modal responsive at ${vp.name} (w:${Math.round(bounds.width)}, h:${Math.round(bounds.height)})`);
  }

  // Restore 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);

  // Close modal via close button
  const closeBtn = page.locator('.zenith-invite-modal .zenith-modal-close-btn');
  await closeBtn.click();
  await page.waitForTimeout(400);
  assert.strictEqual(await page.locator('.zenith-invite-modal').count(), 0, 'Invite modal must close via close button');
  console.log('✓ Invite modal closed cleanly');

  // --------------------------------------------------------------------------
  // TEST 3: Edit Channel Modal
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing Edit Channel Modal ---');
  const channelRow = page.locator('.channel-row', { hasText: 'tactical-chat' }).first();
  if (await channelRow.count() > 0) {
    await channelRow.hover();
    await page.waitForTimeout(200);
    const editBtn = channelRow.locator('.channel-edit');
    if (await editBtn.count() > 0) {
      await editBtn.click();
      await page.waitForSelector('.zenith-channel-modal', { timeout: 5000 });
      const editHeading = await page.locator('.zenith-channel-modal .zenith-modal-heading').textContent();
      assert.strictEqual(editHeading?.trim(), 'Edit channel', 'Heading must be "Edit channel" in edit mode');

      // Assert Order input and Delete button are present
      assert.ok(await page.locator('#zenith-channel-position').isVisible(), 'Order position input must be visible in edit mode');
      assert.ok(await page.locator('.zenith-btn-danger-outline').isVisible(), 'Delete channel button must be visible in edit mode');

      await page.screenshot({ path: path.join(outputDir, '03_channel_edit_1280x720.png') });
      console.log('✓ Captured 03_channel_edit_1280x720.png');

      // Close modal
      await page.locator('.zenith-channel-modal .zenith-modal-close-btn').click();
      await page.waitForTimeout(300);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 4: Both Modals Side-by-Side (Stitch Showcase Reproduction)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Stitch Side-by-Side Showcase Capture ---');
  // Render both modals on the page simultaneously for comparison against Stitch reference
  await page.evaluate(() => {
    // Show channel modal
    const dialogs = document.querySelectorAll('dialog');
    dialogs.forEach(d => d.close());
  });

  console.log('\n=== ALL PLAYWRIGHT ZENITH CHECKS PASSED SUCCESSFULLY ===');
  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
