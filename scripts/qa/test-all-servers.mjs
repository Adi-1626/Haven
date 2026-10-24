import { chromium } from 'playwright';

async function testAll() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(1500);

  // 1. Initial Home state
  console.log('=== 1. HOME STATE ===');
  const homeChannels = await page.$$eval('.channel-row span', els => els.map(e => e.textContent));
  console.log('Home channels:', homeChannels);

  // 2. Click Zenith Design Lab
  console.log('\n=== 2. ZENITH DESIGN LAB ===');
  await page.locator('.server-icon[title="Zenith Design Lab"]').click();
  await page.waitForTimeout(500);
  const zenithTextChannels = await page.$$eval('.channel-section:nth-of-type(1) .channel-row span', els => els.map(e => e.textContent));
  const zenithVoiceChannels = await page.$$eval('.channel-section:nth-of-type(2) .channel-row span', els => els.map(e => e.textContent));
  console.log('Zenith Text channels:', zenithTextChannels);
  console.log('Zenith Voice channels:', zenithVoiceChannels);

  // 3. Click Night Owl Lounge
  console.log('\n=== 3. NIGHT OWL LOUNGE ===');
  await page.locator('.server-icon[title="Night Owl Lounge"]').click();
  await page.waitForTimeout(500);
  const loungeTextChannels = await page.$$eval('.channel-section:nth-of-type(1) .channel-row span', els => els.map(e => e.textContent));
  const loungeVoiceChannels = await page.$$eval('.channel-section:nth-of-type(2) .channel-row span', els => els.map(e => e.textContent));
  console.log('Night Owl Lounge Text channels:', loungeTextChannels);
  console.log('Night Owl Lounge Voice channels:', loungeVoiceChannels);

  // 4. Click Haven Core Engineering
  console.log('\n=== 4. HAVEN CORE ENGINEERING ===');
  await page.locator('.server-icon[title="Haven Core Engineering"]').click();
  await page.waitForTimeout(500);
  const engTextChannels = await page.$$eval('.channel-section:nth-of-type(1) .channel-row span', els => els.map(e => e.textContent));
  const engVoiceChannels = await page.$$eval('.channel-section:nth-of-type(2) .channel-row span', els => els.map(e => e.textContent));
  console.log('Haven Core Engineering Text channels:', engTextChannels);
  console.log('Haven Core Engineering Voice channels:', engVoiceChannels);

  await browser.close();
}

testAll().catch(console.error);
