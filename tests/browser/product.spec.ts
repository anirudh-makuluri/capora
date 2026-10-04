import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8'));
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'http://localhost:5174' },
    data: { email: 'demo@capora.local', password: credentials.dashboardPassword },
  });
  expect(response.ok(), response.ok() ? '' : await response.text()).toBe(true);
});
test('marketplace discovers, filters, and opens machine-readable details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Marketplace', exact: true })).toBeVisible();
  await expect(page.locator('.capability-card')).toHaveCount(6);
  await page.getByRole('tab', { name: 'Datasets', exact: true }).click();
  await expect(page.locator('.capability-card')).toHaveCount(2);
  await page.getByRole('tab', { name: /All capabilities/ }).click();
  await page.getByRole('textbox', { name: 'Search capabilities' }).fill('registry');
  await expect(page.locator('.capability-card')).toHaveCount(1);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Company Registry Search', exact: true }) })
    .click();
  await expect(page.getByRole('heading', { name: 'Company Registry Search', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Input schema', exact: true }).click();
  await expect(page.locator('.detail-panel pre')).toContainText('company');
  await page.screenshot({ path: '.local/screenshots/capability-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('purchased computed tools deliver usable results with approval and queued execution', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/marketplace/document_fingerprint');
  await page.getByRole('textbox', { name: 'Invocation arguments' }).fill(JSON.stringify({ text: 'abc' }));
  await page.getByRole('button', { name: 'Get a quote' }).click();
  await page.getByRole('button', { name: 'Purchase capability' }).click();
  await page.getByRole('button', { name: 'Invoke capability' }).click();
  await expect(page.locator('.result-panel')).toContainText(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  await expect(page.locator('.result-panel')).toContainText('"synthetic": false');
  await page.goto('/marketplace/code_scan');
  await page
    .getByRole('textbox', { name: 'Invocation arguments' })
    .fill(JSON.stringify({ code: 'eval(req.body.code);' }));
  await page.getByRole('button', { name: 'Get a quote' }).click();
  await page.getByRole('button', { name: 'Purchase capability' }).click();
  await page.goto('/approvals');
  await page.getByRole('button', { name: 'Approve $3.00' }).click();
  await page.goto('/transactions');
  await page.locator('.table-capability').filter({ hasText: 'Code Pattern Scan' }).first().click();
  await page.getByRole('button', { name: 'Invoke capability' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsafe-eval', { timeout: 20_000 });
  await expect(page.getByRole('dialog')).toContainText('"synthetic": false');
  await expect(page.getByRole('dialog')).toContainText('DEMO-CAPTURE-');
  expect(errors).toEqual([]);
});

test('desktop and mobile navigation render without overflow', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.locator('.capability-card')).toHaveCount(6);
  await page.screenshot({ path: '.local/screenshots/marketplace-desktop.png', fullPage: true });
  for (const path of ['/overview', '/agents', '/transactions', '/providers', '/developers', '/']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.screenshot({ path: '.local/screenshots/landing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/marketplace');
  await expect(page.locator('.capability-card')).toHaveCount(6);
  await page.screenshot({ path: '.local/screenshots/marketplace-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'My agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My agents' })).toBeVisible();
});
