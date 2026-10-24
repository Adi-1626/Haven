import { chromium } from 'playwright';
import assert from 'node:assert';

async function main() {
  console.log('=== STARTING HAVEN CHANNEL HEADER LAYOUT TEST SUITE ===');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.channel-sidebar', { timeout: 10000 });

  // Select Zenith Design Lab
  const serverIcon = page.locator('.server-icon[title*="Zenith Design Lab"]');
  if (await serverIcon.count() > 0) {
    await serverIcon.click();
    await page.waitForTimeout(500);
  }

  // 1. CONNECTED VOICE CHANNEL TEST
  console.log('\n--- 1. Testing Connected Voice Channel (Studio Room) ---');
  const studioBtn = page.locator('button:has-text("Studio Room")').first();
  await studioBtn.click();
  await page.waitForTimeout(1000);

  // Move mouse away and blur activeElement to test clean resting state
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(300);

  const studioRow = page.locator('.channel-row:has-text("Studio Room")').first();
  
  // Non-hover state
  let nonHoverData = await page.evaluate(() => {
    const row = document.querySelector('.channel-row.voice-active');
    const editBtn = row?.querySelector('.channel-edit');
    return {
      editOpacity: editBtn ? window.getComputedStyle(editBtn).opacity : null,
      editWidth: editBtn?.getBoundingClientRect().width,
    };
  });
  console.log('Non-hover edit button opacity:', nonHoverData.editOpacity, '(expected 0)');
  assert.strictEqual(nonHoverData.editOpacity, '0');
  assert.strictEqual(nonHoverData.editWidth, 24);

  // Hover state
  await studioRow.hover();
  await page.waitForTimeout(300);

  let hoverData = await page.evaluate(() => {
    const row = document.querySelector('.channel-row.voice-active');
    const btn = row.querySelector('button:first-child');
    const icon = btn?.querySelector('svg');
    const span = btn?.querySelector('span');
    const voiceState = btn?.querySelector('.voice-state');
    const editBtn = row.querySelector('.channel-edit');

    const b = el => el ? el.getBoundingClientRect() : null;
    const vBox = b(voiceState);
    const eBox = b(editBtn);
    const sBox = b(span);

    // Overlap checks
    const voiceEditOverlap = vBox && eBox ? Math.max(0, Math.min(vBox.right, eBox.right) - Math.max(vBox.left, eBox.left)) : 0;
    const spanVoiceOverlap = sBox && vBox ? Math.max(0, Math.min(sBox.right, vBox.right) - Math.max(sBox.left, vBox.left)) : 0;

    return {
      spanText: span?.textContent,
      voiceStateText: voiceState?.textContent,
      voiceBox: vBox,
      editBox: eBox,
      voiceEditOverlap,
      spanVoiceOverlap,
      editOpacity: editBtn ? window.getComputedStyle(editBtn).opacity : null,
    };
  });

  console.log('Hover state:');
  console.log('  Channel Name:', hoverData.spanText);
  console.log('  Status Label:', hoverData.voiceStateText);
  console.log('  Voice state right:', hoverData.voiceBox.right, 'Edit button left:', hoverData.editBox.left);
  console.log('  Voice-Edit Overlap:', hoverData.voiceEditOverlap, 'px');
  console.log('  Span-Voice Overlap:', hoverData.spanVoiceOverlap, 'px');
  assert.strictEqual(hoverData.voiceEditOverlap, 0, 'Voice status and edit button must NOT overlap');
  assert.strictEqual(hoverData.spanVoiceOverlap, 0, 'Channel name and voice status must NOT overlap');
  assert.strictEqual(hoverData.editOpacity, '1', 'Edit button must be visible on hover');

  // 2. DISCONNECTED VOICE CHANNEL TEST
  console.log('\n--- 2. Testing Disconnected Voice Channel (Design Lounge) ---');
  const loungeRow = page.locator('.channel-row:has-text("Design Lounge")').first();
  await loungeRow.hover();
  await page.waitForTimeout(300);

  let loungeData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.channel-row'));
    const row = rows.find(r => r.textContent.includes('Design Lounge'));
    const btn = row?.querySelector('button:first-child');
    const span = btn?.querySelector('span');
    const editBtn = row?.querySelector('.channel-edit');
    const voiceState = btn?.querySelector('.voice-state');

    const b = el => el ? el.getBoundingClientRect() : null;
    const sBox = b(span);
    const eBox = b(editBtn);

    const overlap = sBox && eBox ? Math.max(0, Math.min(sBox.right, eBox.right) - Math.max(sBox.left, eBox.left)) : 0;

    return {
      hasVoiceState: !!voiceState,
      spanText: span?.textContent,
      overlap,
      editOpacity: editBtn ? window.getComputedStyle(editBtn).opacity : null,
    };
  });
  console.log('Disconnected channel:', loungeData.spanText);
  console.log('Has voice state (expected false):', loungeData.hasVoiceState);
  console.log('Span-Edit Overlap:', loungeData.overlap, 'px');
  assert.strictEqual(loungeData.hasVoiceState, false);
  assert.strictEqual(loungeData.overlap, 0);

  // 3. TEXT CHANNEL TEST
  console.log('\n--- 3. Testing Text Channel (design-tokens) ---');
  const textRow = page.locator('.channel-row:has-text("design-tokens")').first();
  await textRow.hover();
  await page.waitForTimeout(300);

  let textData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.channel-row'));
    const row = rows.find(r => r.textContent.includes('design-tokens'));
    const btn = row?.querySelector('button:first-child');
    const span = btn?.querySelector('span');
    const editBtn = row?.querySelector('.channel-edit');
    const badge = btn?.querySelector('.badge');

    const b = el => el ? el.getBoundingClientRect() : null;
    const sBox = b(span);
    const eBox = b(editBtn);

    const overlap = sBox && eBox ? Math.max(0, Math.min(sBox.right, eBox.right) - Math.max(sBox.left, eBox.left)) : 0;

    return {
      spanText: span?.textContent,
      overlap,
      editOpacity: editBtn ? window.getComputedStyle(editBtn).opacity : null,
    };
  });
  console.log('Text channel:', textData.spanText);
  console.log('Text-Edit Overlap:', textData.overlap, 'px');
  assert.strictEqual(textData.overlap, 0);

  // 4. SETTINGS GEAR CLICK FUNCTIONALITY
  console.log('\n--- 4. Testing Settings Gear Modal Trigger ---');
  await studioRow.hover();
  const editButton = studioRow.locator('.channel-edit');
  await editButton.click();
  await page.waitForTimeout(500);

  const modalHeading = page.locator('.modal h2');
  const modalCount = await modalHeading.count();
  console.log('Channel edit modal opened count:', modalCount);
  if (modalCount > 0) {
    const headingText = await modalHeading.innerText();
    console.log('Modal heading text:', headingText);
    assert.ok(headingText.toLowerCase().includes('channel'), 'Modal should be Channel settings');
    // Close modal
    const closeBtn = page.locator('.modal .icon-button').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // 5. SIDEBAR WIDTH VARIATIONS & RESPONSIVE CONSTRAINTS
  console.log('\n--- 5. Testing Sidebar Widths (Responsive Behavior) ---');
  const testWidths = [260, 240, 224, 200, 185, 150];

  for (const width of testWidths) {
    await page.evaluate((w) => {
      document.querySelector('.app')?.style.setProperty('--shell-sidebar', `${w}px`);
      const sidebar = document.querySelector('.channel-sidebar');
      if (sidebar) sidebar.style.width = `${w}px`;
    }, width);
    await page.waitForTimeout(300);

    await studioRow.hover();
    await page.waitForTimeout(200);

    const check = await page.evaluate(() => {
      const row = document.querySelector('.channel-row.voice-active');
      const btn = row.querySelector('button:first-child');
      const span = btn?.querySelector('span');
      const voiceState = btn?.querySelector('.voice-state');
      const editBtn = row.querySelector('.channel-edit');

      const b = el => el ? el.getBoundingClientRect() : null;
      const vBox = b(voiceState);
      const eBox = b(editBtn);
      const sBox = b(span);

      const voiceEditOverlap = vBox && eBox ? Math.max(0, Math.min(vBox.right, eBox.right) - Math.max(vBox.left, eBox.left)) : 0;
      const isVoiceStateVisible = voiceState ? window.getComputedStyle(voiceState).display !== 'none' : false;

      return {
        isVoiceStateVisible,
        voiceStateText: voiceState?.textContent,
        voiceWidth: vBox?.width,
        voiceEditOverlap,
      };
    });

    console.log(`Width ${width}px: visible=${check.isVoiceStateVisible}, text="${check.voiceStateText}", voiceWidth=${check.voiceWidth?.toFixed(1)}px, overlap=${check.voiceEditOverlap}px`);
    assert.strictEqual(check.voiceEditOverlap, 0, `At width ${width}px, voice state and edit button must NEVER overlap`);
  }

  // Reset custom style
  await page.evaluate(() => {
    document.querySelector('.app')?.style.removeProperty('--shell-sidebar');
    const sidebar = document.querySelector('.channel-sidebar');
    if (sidebar) sidebar.style.removeProperty('width');
  });

  // 6. NARROW ELECTRON WINDOW SIZES
  console.log('\n--- 6. Testing Window Resizing Down to Minimum Electron Width (500px) ---');
  const windowSizes = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 700, height: 600 },
    { width: 500, height: 550 },
  ];

  for (const size of windowSizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);

    // If on narrow width (<=860px), open navigation drawer if closed
    const isNavOpen = await page.evaluate(() => document.querySelector('.app')?.classList.contains('nav-open'));
    if (size.width <= 860 && !isNavOpen) {
      const menuBtn = page.locator('.mobile-menu-button');
      if (await menuBtn.count() > 0 && await menuBtn.isVisible()) {
        await menuBtn.click();
        await page.waitForTimeout(400);
      }
    }

    const check = await page.evaluate(() => {
      const row = document.querySelector('.channel-row.voice-active') || document.querySelector('.channel-row:has-text("Studio Room")');
      const btn = row?.querySelector('button:first-child');
      const span = btn?.querySelector('span');
      const voiceState = btn?.querySelector('.voice-state');
      const editBtn = row?.querySelector('.channel-edit');

      const b = el => el ? el.getBoundingClientRect() : null;
      const vBox = b(voiceState);
      const eBox = b(editBtn);

      const voiceEditOverlap = vBox && eBox && window.getComputedStyle(voiceState).display !== 'none'
        ? Math.max(0, Math.min(vBox.right, eBox.right) - Math.max(vBox.left, eBox.left))
        : 0;

      return {
        voiceEditOverlap,
        voiceDisplay: voiceState ? window.getComputedStyle(voiceState).display : null,
      };
    });

    console.log(`Window ${size.width}x${size.height}: overlap=${check.voiceEditOverlap}px, voiceDisplay=${check.voiceDisplay}`);
    assert.strictEqual(check.voiceEditOverlap, 0, `At window ${size.width}x${size.height}, overlap must be 0`);
  }

  // Restore default viewport and take final screenshot
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);

  const finalRow = page.locator('.channel-row.voice-active');
  await finalRow.hover();
  await page.waitForTimeout(300);

  const sidebar = page.locator('.channel-sidebar');
  await sidebar.screenshot({ path: 'C:/Users/adity/.gemini/antigravity-ide/brain/49d8b3b2-aa46-4db3-8ffc-b31c0a0d3e1b/sidebar_final.png' });
  console.log('Saved C:/Users/adity/.gemini/antigravity-ide/brain/49d8b3b2-aa46-4db3-8ffc-b31c0a0d3e1b/sidebar_final.png');

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
  await browser.close();
}

main().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
