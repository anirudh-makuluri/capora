import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('.local/screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('Browser error:', msg.text());
});
page.on('pageerror', (error) => console.log('Page error:', error.message));
await page.goto('http://localhost:5173/marketplace');
await page.waitForTimeout(2000);
await page.screenshot({ path: '.local/screenshots/marketplace-desktop.png', fullPage: true });
console.log('Visible title:', await page.locator('h1').textContent());
await browser.close();
