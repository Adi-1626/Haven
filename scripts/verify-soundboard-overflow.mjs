import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const screenshotDir = path.resolve('docs/screenshots/soundboard-modal');
fs.mkdirSync(screenshotDir, { recursive: true });

const artifactDir = 'C:\\Users\\adity\\.gemini\\antigravity-ide\\brain\\cec8aa42-1f55-4dc2-9a35-c0faa4b87660';
fs.mkdirSync(artifactDir, { recursive: true });

async function runVerification() {
  console.log('Starting Soundboard Modal overflow verification...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('.user-panel');

  // Open settings
  await page.locator('.user-settings').click();
  await page.waitForSelector('.settings-layout');

  // Click Voice & Video tab
  const voiceNavBtn = page.locator('button.settings-nav-btn', { hasText: /voice & video/i });
  await voiceNavBtn.click();
  await page.waitForTimeout(600);

  // Click Change sound / Choose sound
  const chooseBtn = page.locator('.entry-sound-status-card button', { hasText: /sound/i });
  await chooseBtn.first().click();
  await page.waitForSelector('.zenith-soundboard-modal');
  await page.waitForTimeout(600);

  console.log('Opened Soundboard Modal in Voice Entry Sound selector mode.');

  // 1. Upload an audio file with an extremely long filename while modal is already open
  const longFileName = 'extremely_long_ambient_space_station_docking_airlock_decompression_sequence_master_remastered_final_v2_ultra_extended.wav';
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('.zenith-sound-upload-btn').click();
  const fileChooser = await fileChooserPromise;

  const tempWav = path.resolve('scripts/temp-test-audio.wav');
  fs.writeFileSync(tempWav, Buffer.alloc(1024));

  await fileChooser.setFiles([{
    name: longFileName,
    mimeType: 'audio/wav',
    buffer: Buffer.alloc(1024),
  }]);

  await page.waitForTimeout(1000);
  console.log('Uploaded sound with long filename while modal was open.');

  // Helper to extract modal and grid measurements
  async function evaluateModalMetrics() {
    return await page.evaluate(() => {
      const modal = document.querySelector('.zenith-media-card');
      const grid = document.querySelector('.zenith-sound-grid');
      const pads = Array.from(document.querySelectorAll('.zenith-sound-pad'));
      if (!modal || !grid) return null;

      const modalRect = modal.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();

      const padDetails = pads.map(pad => {
        const padRect = pad.getBoundingClientRect();
        const selectBtn = pad.querySelector('.zenith-sound-select-btn');
        const selectBtnRect = selectBtn?.getBoundingClientRect();
        const titleEl = pad.querySelector('.zenith-sound-pad-title');

        return {
          title: titleEl?.textContent?.trim() || '',
          padWidth: padRect.width,
          padRight: padRect.right,
          modalRight: modalRect.right,
          overflowsModal: padRect.right > modalRect.right + 1.5,
          selectBtnInside: selectBtnRect ? selectBtnRect.right <= padRect.right + 1.5 : true,
        };
      });

      const style = window.getComputedStyle(grid);
      const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length;

      return {
        modalWidth: Math.round(modalRect.width),
        modalHeight: Math.round(modalRect.height),
        gridWidth: Math.round(gridRect.width),
        gridScrollWidth: grid.scrollWidth,
        gridClientWidth: grid.clientWidth,
        gridScrollHeight: grid.scrollHeight,
        gridClientHeight: grid.clientHeight,
        hasHorizontalGridOverflow: grid.scrollWidth > grid.clientWidth + 1,
        hasVerticalScroll: grid.scrollHeight > grid.clientHeight,
        padCount: pads.length,
        anyPadOverflows: padDetails.some(p => p.overflowsModal),
        allSelectButtonsInside: padDetails.every(p => p.selectBtnInside),
        columnCount: cols,
      };
    });
  }

  // 2. Viewport verification: 1920x1080, 1280x720, 800x600, 500x550
  const viewports = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1280x720', width: 1280, height: 720 },
    { name: '800x600', width: 800, height: 600 },
    { name: '500x550', width: 500, height: 550 },
  ];

  const viewportResults = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);

    const metrics = await evaluateModalMetrics();
    viewportResults.push({ viewport: vp.name, ...metrics });

    const screenshotPath = path.join(screenshotDir, `soundboard_modal_${vp.name}.png`);
    await page.screenshot({ path: screenshotPath });
    const artifactPath = path.join(artifactDir, `soundboard_modal_${vp.name}.png`);
    await page.screenshot({ path: artifactPath });
    console.log(`Saved screenshot for viewport ${vp.name} to ${screenshotPath}`);
  }

  console.log('Viewport Test Results:', JSON.stringify(viewportResults, null, 2));

  // 3. Test sound counts: 1, 2, 4, 10, and 20 sounds, including very long filenames
  const countResults = [];
  const countsToTest = [1, 2, 4, 10, 20];

  // Reset viewport to standard 1280x720 for count tests
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  for (const count of countsToTest) {
    await page.evaluate(targetCount => {
      // Find the grid and populate mock pads to test rendering at exact counts
      const grid = document.querySelector('.zenith-sound-grid');
      if (!grid) return;

      const templatePad = grid.querySelector('.zenith-sound-pad');
      if (!templatePad) return;

      // Clear existing except retain template
      grid.innerHTML = '';

      for (let i = 0; i < targetCount; i++) {
        const clone = templatePad.cloneNode(true);
        const titleEl = clone.querySelector('.zenith-sound-pad-title');
        const metaEl = clone.querySelector('.zenith-sound-pad-meta');
        const selectBtn = clone.querySelector('.zenith-sound-select-btn span');
        const isSelected = i === 0;

        clone.classList.toggle('is-selected', isSelected);
        if (titleEl) {
          if (i % 2 === 0) {
            titleEl.textContent = `Long_File_Sound_${i + 1}_Hyper_Resonant_Orbital_Telemetry_Sample_Master_v2_Extended_Mix.wav`;
            titleEl.setAttribute('title', titleEl.textContent);
          } else {
            titleEl.textContent = `Clip #${i + 1} - Voice Entry Chime`;
            titleEl.setAttribute('title', titleEl.textContent);
          }
        }
        if (metaEl) {
          metaEl.textContent = isSelected ? 'Active entry sound' : 'Sound clip';
        }
        if (selectBtn) {
          selectBtn.textContent = isSelected ? 'Selected' : 'Select';
        }
        grid.appendChild(clone);
      }
    }, count);

    await page.waitForTimeout(400);

    const metrics = await evaluateModalMetrics();
    countResults.push({ count, ...metrics });

    const screenshotPath = path.join(screenshotDir, `soundboard_modal_count_${count}.png`);
    await page.screenshot({ path: screenshotPath });
    const artifactPath = path.join(artifactDir, `soundboard_modal_count_${count}.png`);
    await page.screenshot({ path: artifactPath });
    console.log(`Saved screenshot for ${count} sounds to ${screenshotPath}`);
  }

  console.log('Count Test Results:', JSON.stringify(countResults, null, 2));

  // Cleanup temp file
  try { fs.unlinkSync(tempWav); } catch {}

  const allViewportsPassed = viewportResults.every(r =>
    !r.hasHorizontalGridOverflow &&
    !r.anyPadOverflows &&
    r.allSelectButtonsInside
  );

  const allCountsPassed = countResults.every(r =>
    !r.hasHorizontalGridOverflow &&
    !r.anyPadOverflows &&
    r.allSelectButtonsInside &&
    (r.count <= 4 || r.hasVerticalScroll) // 10 and 20 sounds scroll vertically
  );

  console.log(`ALL VIEWPORTS PASSED: ${allViewportsPassed}`);
  console.log(`ALL SOUND COUNTS PASSED: ${allCountsPassed}`);

  await browser.close();

  if (!allViewportsPassed || !allCountsPassed) {
    console.error('Validation failed!');
    process.exit(1);
  }

  console.log('Verification finished successfully!');
}

runVerification().catch(err => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
