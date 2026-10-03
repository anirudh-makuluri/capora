import { test, expect } from '@playwright/test';
test('marketplace discovers, filters, and opens machine-readable details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Marketplace', exact: true })).toBeVisible();
  await expect(page.locator('.capability-card')).toHaveCount(10);
  await page.getByRole('tab', { name: 'Datasets', exact: true }).click();
  await expect(page.locator('.capability-card')).toHaveCount(4);
  await page.getByRole('tab', { name: /All capabilities/ }).click();
  await page.getByRole('textbox', { name: 'Search capabilities' }).fill('headcount');
  await expect(page.locator('.capability-card')).toHaveCount(2);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'DataPulse Employment Intelligence', exact: true }) })
    .click();
  await expect(
    page.getByRole('heading', { name: 'DataPulse Employment Intelligence', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Input schema', exact: true }).click();
  await expect(page.locator('.detail-panel pre')).toContainText('company');
  await page.screenshot({ path: '.local/screenshots/capability-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('scripted playground completes autonomous purchase and human-approved queued execution', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/demo');
  await page.getByRole('button', { name: /Run the acquisition demo/ }).click();
  await expect(page.getByRole('heading', { name: 'The signals point to Arizona expansion.' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Request security analysis' }).click();
  await expect(page.getByRole('button', { name: 'Approve $3.00' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve $3.00' })).toBeEnabled();
  await expect(page.locator('.approval-trust')).toContainText('12s expected');
  await expect(page.locator('.approval-trust')).toContainText('4.9 reputation');
  await page.screenshot({ path: '.local/screenshots/approval-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve $3.00' }).click();
  await expect(page.locator('.job-result').getByText('completed', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.job-result')).toContainText('unsafe-eval');
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page.locator('.transactions-table tbody')).toContainText('DataPulse Employment Intelligence');
  await expect(page.locator('.transactions-table tbody')).toContainText('SecureScan Advanced');
  await page.locator('.table-capability').filter({ hasText: 'SecureScan Advanced' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('DEMO-CAPTURE-');
  await expect(page.getByRole('dialog')).toContainText('Execution result');
  expect(errors).toEqual([]);
});
test('desktop and mobile navigation render without overflow', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.locator('.capability-card')).toHaveCount(10);
  await page.screenshot({ path: '.local/screenshots/marketplace-desktop.png', fullPage: true });
  for (const path of ['/overview', '/agents', '/transactions', '/providers', '/developers', '/']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.screenshot({ path: '.local/screenshots/landing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/marketplace');
  await expect(page.locator('.capability-card')).toHaveCount(10);
  await page.screenshot({ path: '.local/screenshots/marketplace-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'My agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My agents' })).toBeVisible();
});
