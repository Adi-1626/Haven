import type { Page } from '@playwright/test';

// Check the actual user-facing measurements rather than requiring a raw JSON
// debugging panel to remain in the product for the benefit of the test suite.
export async function streamStatistics(page: Page) {
  const samples = await page.locator('.stat-sample').evaluateAll(elements => elements.map(element => {
    const values = [...element.querySelectorAll('b')].map(value => [...value.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''));
    const [width, height] = values[0].split('×').map(Number);
    return { direction: element.querySelector('span')?.textContent, width, height, fps: parseFloat(values[1]), bitrateMbps: parseFloat(values[2]) };
  }));
  return { outbound: samples.filter(sample => sample.direction === 'Sending'), inbound: samples.filter(sample => sample.direction === 'Receiving') };
}
